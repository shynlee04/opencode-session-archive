import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  foldSessionLedgers,
  harnessOf,
  normalizeDelegationTurns,
  normalizeMessage,
  sessionHeader,
  sha256hex,
} from "./normalize.ts"
import { laneOf, sessionRelDir } from "./layout.ts"
import {
  configureWalPragmas,
  initSyncDatabase,
  readRootWatermarks,
  writeIncrementalIndex,
  writeIndex,
} from "./index-db.ts"
import { resolveShadowRepoDir, batchExtractGitBlobs, sinkShadowSnapshots } from "./snapshots.ts"
import { sinkExternalSpills } from "./spills.ts"
import type {
  DelegationFact,
  DelegationTurnRow,
  FileReadLedgerRow,
  FileTouchRow,
  HostMessageRow,
  HostSessionRow,
  KvBindingRow,
  MessageRecord,
  MessageRow,
  SessionRow,
  SkillLoadLedgerRow,
  SnapshotArtifactRow,
  SpillArtifactRow,
  SyncWatermarkRow,
} from "./types.ts"
import type { SessionSource } from "./source.ts"
import type {
  IndexCompactionRow,
  IndexDelegationRow,
  IndexInstructionRow,
  IndexMessageRow,
  IndexSessionRow,
  IndexToolCallRow,
} from "./index-db.ts"

export type { SessionSource } from "./source.ts"
export { sqliteSource, decodeHostKvKey, decodeUtf16BeHex, ingestHostKv } from "./source.ts"
export { configureWalPragmas, initSyncDatabase, writeIncrementalIndex, writeIndex } from "./index-db.ts"
export { resolveShadowRepoDir, batchExtractGitBlobs, sinkShadowSnapshots } from "./snapshots.ts"
export { sinkExternalSpills } from "./spills.ts"
export {
  classifyMessagesOutcome,
  extractSessionLedgers,
  foldSessionLedgers,
  normalizeDelegationTurns,
  normalizeMessage,
  segmentChildStops,
  sessionHeader,
  sha256hex,
} from "./normalize.ts"
export type {
  ArchiveRecord,
  AssistantRecord,
  BoundaryRecord,
  ChildStopSegment,
  CompactionRecord,
  ContextRecord,
  DelegationFact,
  DelegationTurnRow,
  FileReadLedgerRow,
  FileTouchRow,
  HostMessageRow,
  HostSessionRow,
  KvBindingRow,
  KvContextPruneRow,
  KvForeignIndexRow,
  KvState,
  Lane,
  MessageRecord,
  MessageRow,
  ProjectRow,
  ReportedOutcome,
  SessionHeader,
  SessionRow,
  ShellRecord,
  SkillLoadLedgerRow,
  SkillRecord,
  SnapshotArtifactRow,
  SpillArtifactRow,
  SyncWatermarkRow,
  UnknownRecord,
  UserRecord,
  VerifiedOutcome,
} from "./types.ts"

export interface PersistOptions {
  readonly sessionID: string
  readonly projectID: string
  readonly projectRoot: string
  readonly dir?: string
  readonly snapshotRootDir?: string
  readonly opencodeDataDir?: string
  readonly forceColdFull?: boolean
}

export interface PersistReport {
  rootID: string
  archiveDir: string
  sessions: number
  messages: number
  delegations: number
  written: string[]
  unchanged: number
  mode: "cold_full" | "incremental_delta" | "noop_delta"
  dirtySessionsCount: number
  messagesProcessed: number
  kvRowsProcessed: number
  delegationTurnsProcessed: number
  snapshotsExtracted: number
  spillsSunk: number
  elapsedMs: number
}

interface TreeNode {
  readonly row: SessionRow
  readonly hostRow: HostSessionRow
  readonly depth: number
  readonly relDir: string
  readonly children: readonly SessionRow[]
}

const asRecordObj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const toHostSessionRow = (row: SessionRow): HostSessionRow => ({
  id: row.id,
  project_id: row.project_id,
  parent_id: row.parent_id,
  slug: null,
  directory: row.directory,
  title: row.title,
  version: null,
  agent: row.agent,
  model_id: row.model?.id ?? null,
  provider_id: row.model?.providerID ?? null,
  variant: row.model?.variant ?? null,
  idle_outcome: row.idle_outcome,
  time_created: row.time_created,
  time_updated: row.time_updated,
})

const toHostMessageRow = (row: MessageRow): HostMessageRow => ({
  id: row.id,
  session_id: row.session_id,
  seq: row.seq,
  type: row.type,
  time_created: row.time_created,
  time_updated: row.time_updated,
  data: asRecordObj(row.data),
})

export function persist(input: PersistOptions, source: SessionSource): PersistReport {
  const tStart = performance.now()
  const seed = source.session(input.sessionID)
  if (seed === undefined) {
    throw new Error(`session-archive: session ${input.sessionID} not found`)
  }
  const root = findRoot(seed, source)
  if (root.project_id !== input.projectID) {
    throw new Error(
      `session-archive: session ${input.sessionID} belongs to project ${root.project_id}, not ${input.projectID}`,
    )
  }

  const nodes = flattenTree(root, source)
  const archiveDir = path.isAbsolute(input.dir ?? "") ? path.resolve(input.dir!) : path.resolve(input.projectRoot, input.dir ?? ".session-archive")
  if (archiveDir.split(path.sep).includes(".opencode")) {
    throw new Error(`session-archive: archive directory must not reside inside .opencode/: ${archiveDir}`)
  }
  const sqlitePath = path.join(archiveDir, "index.sqlite")

  const existing = input.forceColdFull ? null : readRootWatermarks(sqlitePath, root.id)
  const isCold = existing === null

  interface NodeSyncPlan {
    readonly node: TreeNode
    readonly wm: SyncWatermarkRow | undefined
    readonly isColdNode: boolean
    readonly dirty: boolean
    readonly deltaRows: readonly MessageRow[]
  }

  const plans: NodeSyncPlan[] = []
  let messagesProcessed = 0

  for (const node of nodes) {
    const wm = existing?.watermarks.get(node.row.id)
    const transcriptAbs = path.join(archiveDir, node.relDir, `${node.row.id}.jsonl`)
    const infoAbs = path.join(archiveDir, node.relDir, "info.json")
    const hasFilesOnDisk = existsSync(transcriptAbs) && existsSync(infoAbs)

    if (wm && hasFilesOnDisk && !isCold) {
      const deltaRows = source.messages(node.row.id, wm.last_max_seq)
      if (deltaRows.length === 0 && node.row.time_updated <= wm.last_time_updated) {
        plans.push({
          node,
          wm,
          isColdNode: false,
          dirty: false,
          deltaRows: [],
        })
      } else {
        const effectiveRows =
          deltaRows.length > 0
            ? deltaRows
            : source.messages(node.row.id, Math.max(0, wm.last_max_seq - 1))
        messagesProcessed += effectiveRows.length
        plans.push({
          node,
          wm,
          isColdNode: false,
          dirty: true,
          deltaRows: effectiveRows,
        })
      }
    } else {
      const allRows = source.messages(node.row.id)
      messagesProcessed += allRows.length
      plans.push({
        node,
        wm: undefined,
        isColdNode: true,
        dirty: true,
        deltaRows: allRows,
      })
    }
  }

  const dirtyPlans = plans.filter((p) => p.dirty)
  const sessionIDs = nodes.map((n) => n.row.id)
  const minKvUpdated =
    !isCold && existing
      ? Math.max(0, ...Array.from(existing.watermarks.values(), (w) => w.last_kv_updated))
      : 0
  const kvState = source.kvState
    ? source.kvState(sessionIDs, isCold ? 0 : minKvUpdated)
    : { bindings: [], foreignIndex: [], contextPrunes: [] }
  const kvRowsProcessed =
    kvState.bindings.length + kvState.foreignIndex.length + kvState.contextPrunes.length

  if (!isCold && existing && dirtyPlans.length === 0 && kvRowsProcessed === 0) {
    return {
      rootID: root.id,
      archiveDir,
      sessions: nodes.length,
      messages: existing.totalMessages,
      delegations: existing.totalDelegations,
      written: [],
      unchanged: existing.fileCount,
      mode: "noop_delta",
      dirtySessionsCount: 0,
      messagesProcessed: 0,
      kvRowsProcessed: 0,
      delegationTurnsProcessed: 0,
      snapshotsExtracted: 0,
      spillsSunk: 0,
      elapsedMs: performance.now() - tStart,
    }
  }

  const blobs = new Map<string, string | Buffer>()
  const sinkRawSha = (text: string): string => {
    const sha = sha256hex(text)
    if (!blobs.has(sha)) blobs.set(sha, text)
    return sha
  }
  const sink = (text: string): string => `blob:${sinkRawSha(text)}`
  const sinkBuffer = (buf: Buffer): string => {
    const sha = sha256hex(buf)
    if (!blobs.has(sha)) blobs.set(sha, buf)
    return sha
  }

  const written: string[] = []
  let unchanged = 0
  let newBlobFilesCount = 0
  let newSessionsCount = 0

  const writeIfChanged = (rel: string, content: string | Buffer, isBlob = false) => {
    const target = path.join(archiveDir, rel)
    const existedBefore = existsSync(target)
    const bytes = typeof content === "string" ? Buffer.from(content) : content
    if (existedBefore && readFileSync(target).equals(bytes)) {
      unchanged += 1
      return
    }
    mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
    writeFileSync(tmp, bytes)
    renameSync(tmp, target)
    written.push(rel)
    if (isBlob && !existedBefore) {
      newBlobFilesCount += 1
    }
  }

  const byID = new Map(nodes.map((node) => [node.row.id, node]))
  const sessionRows: IndexSessionRow[] = []
  const delegationRows: IndexDelegationRow[] = []
  const messageRows: IndexMessageRow[] = []
  const toolCallRows: IndexToolCallRow[] = []
  const compactionRows: IndexCompactionRow[] = []
  const instructionRows: IndexInstructionRow[] = []
  const fileReadRows: FileReadLedgerRow[] = []
  const skillLoadRows: SkillLoadLedgerRow[] = []
  const fileTouchRows: FileTouchRow[] = []
  const watermarksToWrite: SyncWatermarkRow[] = []
  const deltaHostMsgsBySession = new Map<string, readonly HostMessageRow[]>()
  const dirtySessionIds = new Set<string>()
  const syncedAtIso = new Date().toISOString()

  const maxKvUpdatedAcrossDelta = Math.max(
    minKvUpdated,
    ...kvState.bindings.map((b) => b.updated_at ?? 0),
    ...kvState.contextPrunes.map((p) => p.updated_at ?? 0),
  )

  for (const plan of plans) {
    const { node, wm, isColdNode, dirty, deltaRows } = plan
    if (!dirty) {
      unchanged += 2 // <id>.jsonl + info.json
      continue
    }

    if (isColdNode && !isCold) {
      newSessionsCount += 1
    }
    dirtySessionIds.add(node.row.id)

    const records: MessageRecord[] = []
    const facts: DelegationFact[] = []
    const rawReads: FileReadLedgerRow[] = []
    const rawSkills: SkillLoadLedgerRow[] = []
    const rawTouches: FileTouchRow[] = []
    const firstDeltaSeq = deltaRows[0]?.seq ?? Infinity
    let prevSeq: number | null =
      !isColdNode && wm && firstDeltaSeq > wm.last_max_seq ? wm.last_max_seq : null

    for (const row of deltaRows) {
      const normalized = normalizeMessage(row, sink, prevSeq)
      records.push(normalized.record)
      facts.push(...normalized.delegations)
      rawReads.push(...normalized.fileReads)
      rawSkills.push(...normalized.skillLoads)
      rawTouches.push(...normalized.fileTouches)
      prevSeq = row.seq
    }

    const hostDeltaRows = deltaRows.map(toHostMessageRow)
    deltaHostMsgsBySession.set(node.row.id, hostDeltaRows)
    const ledgers = foldSessionLedgers(rawReads, rawSkills, rawTouches)
    fileReadRows.push(...ledgers.fileReads)
    skillLoadRows.push(...ledgers.skillLoads)
    fileTouchRows.push(...ledgers.fileTouches)

    const transcriptRel = path.join(node.relDir, `${node.row.id}.jsonl`)
    const transcriptAbs = path.join(archiveDir, transcriptRel)
    let priorRecordLines: string[] = []
    if (!isColdNode && existsSync(transcriptAbs)) {
      const existingLines = readFileSync(transcriptAbs, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .slice(1)
      priorRecordLines = existingLines.filter((line) => {
        try {
          const parsed = JSON.parse(line) as { raw_ref?: { seq?: number } }
          return typeof parsed.raw_ref?.seq === "number" && parsed.raw_ref.seq < firstDeltaSeq
        } catch {
          return false
        }
      })
    }

    const totalSessionMessages = priorRecordLines.length + records.length
    const header = sessionHeader(node.row, {
      root_id: root.id,
      depth: node.depth,
      lane: laneOf(node.row.directory, input.projectRoot),
      children: node.children.map((child) => child.id),
      message_count: totalSessionMessages,
    })

    const allJsonlLines = [
      JSON.stringify(header),
      ...priorRecordLines,
      ...records.map((r) => JSON.stringify(r)),
    ]
    writeIfChanged(transcriptRel, allJsonlLines.join("\n") + "\n")
    writeIfChanged(path.join(node.relDir, "info.json"), JSON.stringify(header, null, 2) + "\n")

    sessionRows.push(indexSession(node, header, root.id, transcriptRel))
    for (const fact of facts) {
      delegationRows.push(indexDelegation(fact, node.row.id, byID))
    }
    collectRows(records, node.row.id, sink, messageRows, toolCallRows, compactionRows, instructionRows)

    const lastRow = deltaRows[deltaRows.length - 1]
    const lastMaxSeq = lastRow ? lastRow.seq : (wm?.last_max_seq ?? 0)
    const lastMsgId = lastRow ? lastRow.id : (wm?.last_message_id ?? "")
    const lastTimeUpdated = Math.max(
      node.row.time_updated,
      lastRow ? lastRow.time_updated : 0,
      wm?.last_time_updated ?? 0,
    )

    watermarksToWrite.push({
      session_id: node.row.id,
      root_id: root.id,
      last_time_updated: lastTimeUpdated,
      last_max_seq: lastMaxSeq,
      last_message_id: lastMsgId,
      last_kv_updated: maxKvUpdatedAcrossDelta,
      synced_at: syncedAtIso,
    })
  }

  if (isCold) {
    for (const node of nodes) {
      for (const child of node.children) {
        const covered = delegationRows.some((row) => row.child_session === child.id)
        if (!covered) {
          delegationRows.push(edgeDelegation(child, node.row.id))
        }
      }
    }
  } else {
    for (const plan of dirtyPlans) {
      if (plan.isColdNode && plan.node.row.parent_id !== null) {
        const covered = delegationRows.some((row) => row.child_session === plan.node.row.id)
        if (!covered) {
          delegationRows.push(edgeDelegation(plan.node.row, plan.node.row.parent_id))
        }
      }
    }
  }

  // Compute delegation_turn rows for parents whose messages or children changed
  const kvByChildId = new Map<string, KvBindingRow>()
  for (const b of kvState.bindings) {
    kvByChildId.set(b.child_session_id, b)
  }
  const delegationTurnRows: DelegationTurnRow[] = []
  for (const node of nodes) {
    if (node.children.length === 0) continue
    const parentDirty = dirtySessionIds.has(node.row.id)
    const anyChildDirty = node.children.some((c) => dirtySessionIds.has(c.id))
    if (!isCold && !parentDirty && !anyChildDirty) continue

    const parentHostMsgs =
      isCold && deltaHostMsgsBySession.has(node.row.id)
        ? deltaHostMsgsBySession.get(node.row.id)!
        : source.messages(node.row.id).map(toHostMessageRow)

    const childHostRows: HostSessionRow[] = []
    const childMsgsMap = new Map<string, readonly HostMessageRow[]>()
    for (const child of node.children) {
      if (!isCold && !parentDirty && !dirtySessionIds.has(child.id)) continue
      const childNode = byID.get(child.id)
      if (!childNode) continue
      childHostRows.push(childNode.hostRow)
      const cMsgs =
        isCold && deltaHostMsgsBySession.has(child.id)
          ? deltaHostMsgsBySession.get(child.id)!
          : source.messages(child.id).map(toHostMessageRow)
      childMsgsMap.set(child.id, cMsgs)
    }

    if (childHostRows.length > 0) {
      const turns = normalizeDelegationTurns(
        node.row.id,
        parentHostMsgs,
        childHostRows,
        childMsgsMap,
        kvByChildId,
        sinkRawSha,
        "host_db",
      )
      delegationTurnRows.push(...turns)
    }
  }

  // Extract shadow snapshots and external spills if configured
  const dirtyHostSessions = dirtyPlans.map((p) => p.node.hostRow)
  const snapshotRootDir =
    input.snapshotRootDir ?? (input.opencodeDataDir ? path.join(input.opencodeDataDir, "snapshot") : undefined)
  const snapshotArtifacts: SnapshotArtifactRow[] =
    snapshotRootDir && existsSync(snapshotRootDir)
      ? sinkShadowSnapshots(dirtyHostSessions, deltaHostMsgsBySession, snapshotRootDir, sinkBuffer, "host_db")
      : []

  const spillArtifacts: SpillArtifactRow[] =
    input.opencodeDataDir && existsSync(input.opencodeDataDir)
      ? sinkExternalSpills(dirtyHostSessions, deltaHostMsgsBySession, input.opencodeDataDir, sinkBuffer, "host_db")
      : []

  for (const [sha, content] of blobs) {
    writeIfChanged(path.join("blobs", `${sha}.txt`), content, true)
  }

  written.push("index.sqlite")
  const fileCount = isCold
    ? written.length + unchanged
    : (existing?.fileCount ?? 0) + newBlobFilesCount + newSessionsCount * 2

  const { totalMessages, totalDelegations } = writeIncrementalIndex(sqlitePath, {
    isCold,
    rootID: root.id,
    sessions: sessionRows,
    delegations: delegationRows,
    messages: messageRows,
    toolCalls: toolCallRows,
    compactions: compactionRows,
    instructions: instructionRows,
    kvBindings: kvState.bindings,
    kvForeignIndex: kvState.foreignIndex,
    kvContextPrunes: kvState.contextPrunes,
    delegationTurns: delegationTurnRows,
    fileReads: fileReadRows,
    skillLoads: skillLoadRows,
    fileTouches: fileTouchRows,
    snapshotArtifacts,
    spillArtifacts,
    watermarks: watermarksToWrite,
    fileCount,
  })

  return {
    rootID: root.id,
    archiveDir,
    sessions: nodes.length,
    messages: totalMessages,
    delegations: totalDelegations,
    written,
    unchanged,
    mode: isCold ? "cold_full" : "incremental_delta",
    dirtySessionsCount: dirtyPlans.length,
    messagesProcessed,
    kvRowsProcessed,
    delegationTurnsProcessed: delegationTurnRows.length,
    snapshotsExtracted: snapshotArtifacts.length,
    spillsSunk: spillArtifacts.length,
    elapsedMs: performance.now() - tStart,
  }
}

function findRoot(seed: SessionRow, source: SessionSource): SessionRow {
  const seen = new Set([seed.id])
  let current = seed
  while (current.parent_id !== null) {
    if (seen.has(current.parent_id)) {
      throw new Error(`session-archive: parent cycle at ${current.parent_id}`)
    }
    seen.add(current.parent_id)
    const parent = source.session(current.parent_id)
    if (parent === undefined) return current
    current = parent
  }
  return current
}

function flattenTree(root: SessionRow, source: SessionSource): TreeNode[] {
  const nodes: TreeNode[] = []
  const visit = (row: SessionRow, depth: number, parentRelDir: string | null) => {
    const relDir = sessionRelDir(parentRelDir, row.id)
    const children = source.children(row.id)
    nodes.push({ row, hostRow: toHostSessionRow(row), depth, relDir, children })
    for (const child of children) visit(child, depth + 1, relDir)
  }
  visit(root, 0, null)
  return nodes
}

const indexSession = (
  _node: TreeNode,
  header: ReturnType<typeof sessionHeader>,
  _rootID: string,
  transcriptPath: string,
): IndexSessionRow => ({
  id: header.id,
  project_id: header.project_id,
  parent_id: header.parent_id,
  depth: header.depth,
  lane_kind: header.lane.kind,
  lane_path: header.lane.path,
  title: header.title,
  agent: header.agent,
  provider: header.model?.providerID ?? null,
  model_id: header.model?.id ?? null,
  variant: header.model?.variant ?? null,
  harness: header.harness,
  outcome: header.outcome,
  cost: header.cost,
  tok_in: header.tokens.input,
  tok_out: header.tokens.output,
  tok_reason: header.tokens.reasoning,
  tok_cache_r: header.tokens.cache_read,
  tok_cache_w: header.tokens.cache_write,
  files_changed: header.summary.files,
  additions: header.summary.additions,
  deletions: header.summary.deletions,
  t_created: header.time.created,
  t_updated: header.time.updated,
  t_idle: header.time.idle,
  t_compacting: header.time.compacting,
  t_archived: header.time.archived,
  resume_attempts: header.resume_attempts,
  message_count: header.message_count,
  transcript_path: transcriptPath.split(path.sep).join("/"),
})

const indexDelegation = (
  fact: DelegationFact,
  parentSession: string,
  byID: Map<string, TreeNode>,
): IndexDelegationRow => {
  const child = byID.get(fact.child_session_id)
  return {
    call_id: fact.call_id,
    parent_session: parentSession,
    parent_message_id: fact.message_id,
    child_session: fact.child_session_id,
    tool: fact.tool,
    agent: fact.agent,
    harness: fact.harness ?? (child ? harnessOf(child.row.model) : null),
    mode: fact.mode,
    background: fact.background,
    description: fact.description,
    prompt_ref: fact.prompt_ref,
    status: fact.status,
    t_created: fact.t_created,
    t_completed: fact.t_completed,
  }
}

const edgeDelegation = (child: SessionRow, parentID: string): IndexDelegationRow => ({
  call_id: `parent:${child.id}`,
  parent_session: parentID,
  parent_message_id: null,
  child_session: child.id,
  tool: null,
  agent: child.agent,
  harness: harnessOf(child.model),
  mode: "spawn",
  background: null,
  description: null,
  prompt_ref: null,
  status: null,
  t_created: null,
  t_completed: null,
})

const tokenNum = (tokens: unknown, key: string): number | null => {
  if (typeof tokens !== "object" || tokens === null) return null
  const v = (tokens as Record<string, unknown>)[key]
  return typeof v === "number" ? v : null
}

function collectRows(
  records: readonly MessageRecord[],
  sessionID: string,
  sink: (text: string) => string,
  messages: IndexMessageRow[],
  toolCalls: IndexToolCallRow[],
  compactions: IndexCompactionRow[],
  instructions: IndexInstructionRow[],
): void {
  for (const record of records) {
    messages.push({
      session_id: sessionID,
      seq: record.raw_ref.seq,
      id: record.id,
      kind: record.kind,
      t: record.t,
      agent: record.kind === "assistant" ? record.agent : record.kind === "boundary" ? (record.agent ?? null) : null,
      model_id: record.kind === "assistant" ? (record.model?.id ?? null) : null,
      tok_in: record.kind === "assistant" ? tokenNum(record.tokens, "input") : null,
      tok_out: record.kind === "assistant" ? tokenNum(record.tokens, "output") : null,
    })
    if (record.kind === "assistant") {
      for (const part of record.parts) {
        if (part.type !== "tool") continue
        toolCalls.push({
          call_id: part.call_id,
          session_id: sessionID,
          seq: record.raw_ref.seq,
          name: part.name,
          status: part.status,
          duration_ms:
            part.time.completed !== null
              ? part.time.completed - (part.time.ran ?? part.time.created ?? part.time.completed)
              : null,
          truncated: part.truncated,
          output_path: part.output_path,
        })
      }
      continue
    }
    if (record.kind === "compaction") {
      compactions.push({
        session_id: sessionID,
        seq: record.raw_ref.seq,
        reason: record.reason,
        status: record.status,
        summary_ref: record.summary === null ? null : sink(record.summary),
        tok_input: tokenNum(record.tokens, "input"),
      })
      continue
    }
    if (record.kind === "context" && record.text_ref !== null) {
      const sha = record.text_ref.slice("blob:".length)
      for (const p of record.paths) {
        instructions.push({ session_id: sessionID, seq: record.raw_ref.seq, path: p, blob_sha: sha })
      }
    }
  }
}
