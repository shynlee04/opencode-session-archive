import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { harnessOf, normalizeMessage, sessionHeader, sha256hex } from "./normalize.ts"
import { laneOf, sessionRelDir } from "./layout.ts"
import { writeIndex } from "./index-db.ts"
import type {
  DelegationFact,
  MessageRecord,
  MessageRow,
  SessionRow,
} from "./types.ts"
import type { SessionSource } from "./source.ts"
import type {
  IndexCompactionRow,
  IndexDelegationRow,
  IndexInput,
  IndexInstructionRow,
  IndexMessageRow,
  IndexSessionRow,
  IndexToolCallRow,
} from "./index-db.ts"

export type { SessionSource } from "./source.ts"
export { sqliteSource } from "./source.ts"
export type {
  ArchiveRecord,
  AssistantRecord,
  BoundaryRecord,
  CompactionRecord,
  ContextRecord,
  Lane,
  MessageRecord,
  MessageRow,
  ProjectRow,
  SessionHeader,
  SessionRow,
  UnknownRecord,
  UserRecord,
} from "./types.ts"

export interface PersistReport {
  rootID: string
  archiveDir: string
  sessions: number
  messages: number
  delegations: number
  written: string[]
  unchanged: number
}

interface TreeNode {
  readonly row: SessionRow
  readonly depth: number
  readonly relDir: string
  readonly children: readonly SessionRow[]
}

export function persist(
  input: { sessionID: string; projectID: string; projectRoot: string; dir?: string },
  source: SessionSource,
): PersistReport {
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
  const archiveDir = path.join(input.projectRoot, input.dir ?? ".session-archive")
  const blobs = new Map<string, string>()
  const sink = (text: string): string => {
    const sha = sha256hex(text)
    if (!blobs.has(sha)) blobs.set(sha, text)
    return `blob:${sha}`
  }

  const written: string[] = []
  let unchanged = 0
  const writeIfChanged = (rel: string, content: string | Buffer) => {
    const target = path.join(archiveDir, rel)
    const bytes = typeof content === "string" ? Buffer.from(content) : content
    if (existsSync(target) && readFileSync(target).equals(bytes)) {
      unchanged += 1
      return
    }
    mkdirSync(path.dirname(target), { recursive: true })
    const tmp = `${target}.tmp`
    writeFileSync(tmp, bytes)
    renameSync(tmp, target)
    written.push(rel)
  }

  const byID = new Map(nodes.map((node) => [node.row.id, node]))
  const sessionRows: IndexSessionRow[] = []
  const delegationRows: IndexDelegationRow[] = []
  const messageRows: IndexMessageRow[] = []
  const toolCallRows: IndexToolCallRow[] = []
  const compactionRows: IndexCompactionRow[] = []
  const instructionRows: IndexInstructionRow[] = []
  let messageCount = 0

  for (const node of nodes) {
    const rows = source.messages(node.row.id)
    messageCount += rows.length
    const records: MessageRecord[] = []
    const facts: DelegationFact[] = []
    let prevSeq: number | null = null
    for (const row of rows) {
      const normalized = normalizeMessage(row, sink, prevSeq)
      records.push(normalized.record)
      facts.push(...normalized.delegations)
      prevSeq = row.seq
    }

    const header = sessionHeader(node.row, {
      root_id: root.id,
      depth: node.depth,
      lane: laneOf(node.row.directory, input.projectRoot),
      children: node.children.map((child) => child.id),
      message_count: rows.length,
    })

    const transcriptRel = path.join(node.relDir, `${node.row.id}.jsonl`)
    writeIfChanged(
      transcriptRel,
      [header, ...records].map((record) => JSON.stringify(record)).join("\n") + "\n",
    )
    writeIfChanged(path.join(node.relDir, "info.json"), JSON.stringify(header, null, 2) + "\n")

    sessionRows.push(indexSession(node, header, root.id, transcriptRel))
    for (const fact of facts) {
      delegationRows.push(indexDelegation(fact, node.row.id, byID))
    }
    collectRows(records, node.row.id, sink, messageRows, toolCallRows, compactionRows, instructionRows)
  }

  for (const node of nodes) {
    for (const child of node.children) {
      const covered = delegationRows.some((row) => row.child_session === child.id)
      if (!covered) {
        delegationRows.push(edgeDelegation(child, node.row.id))
      }
    }
  }

  for (const [sha, text] of blobs) {
    writeIfChanged(path.join("blobs", `${sha}.txt`), text)
  }

  const indexInput: IndexInput = {
    rootID: root.id,
    sessionIDs: nodes.map((node) => node.row.id),
    sessions: sessionRows,
    delegations: delegationRows,
    messages: messageRows,
    toolCalls: toolCallRows,
    compactions: compactionRows,
    instructions: instructionRows,
  }
  if (writeIndex(path.join(archiveDir, "index.sqlite"), indexInput) === "written") {
    written.push("index.sqlite")
  } else {
    unchanged += 1
  }

  return {
    rootID: root.id,
    archiveDir,
    sessions: nodes.length,
    messages: messageCount,
    delegations: delegationRows.length,
    written,
    unchanged,
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
    nodes.push({ row, depth, relDir, children })
    for (const child of children) visit(child, depth + 1, relDir)
  }
  visit(root, 0, null)
  return nodes
}

const indexSession = (
  node: TreeNode,
  header: ReturnType<typeof sessionHeader>,
  rootID: string,
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
