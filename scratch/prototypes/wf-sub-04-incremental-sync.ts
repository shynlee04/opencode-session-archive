// PROTOTYPE: WF-SUB-04 — Watermark-Gated Incremental SQLite Sync Against the 2.15 GB Host DB
// Disposable discovery artifact per the prototype skill. Never mutates opencode.db or steward .session-archive.

import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { laneOf, sessionRelDir } from "../../src/archive/layout.ts"
import { harnessOf, normalizeMessage, sessionHeader } from "../../src/archive/normalize.ts"
import type { DelegationFact, MessageRecord, MessageRow, SessionRow } from "../../src/archive/types.ts"
import {
  type DelegationTurnRow,
  type HostMessageRow,
  type HostSessionRow,
  type KvBindingRow,
  type KvContextPruneRow,
  type KvForeignIndexRow,
  type SnapshotArtifactRow,
  type SpillArtifactRow,
  createDiskBlobSinker,
  decodeHostKvKey,
  normalizeDelegationTurns,
  sinkExternalSpills,
  sinkShadowSnapshots,
} from "./wf-sub-03-spine-ingestion.ts"

export interface SyncWatermarkRow {
  readonly session_id: string
  readonly root_id: string
  readonly last_time_updated: number
  readonly last_max_seq: number
  readonly last_message_id: string
  readonly last_kv_updated: number
  readonly synced_at: string
}

export interface TreeScopeOptions {
  readonly maxRootMessages?: number
  readonly maxChildSessions?: number
  readonly maxRootSeq?: number
}

export interface SyncExecutionReport {
  readonly mode: "cold_full" | "noop_delta" | "incremental_delta"
  readonly rootSessionId: string
  readonly elapsedMs: number
  readonly queryTreeMs: number
  readonly queryMessagesMs: number
  readonly queryKvMs: number
  readonly normalizeAndSinkMs: number
  readonly sqliteWriteMs: number
  readonly sessionsInTree: number
  readonly dirtySessionsCount: number
  readonly messagesProcessed: number
  readonly kvRowsProcessed: number
  readonly toolCallsProcessed: number
  readonly delegationsProcessed: number
  readonly delegationTurnsProcessed: number
  readonly snapshotsExtracted: number
  readonly spillsSunk: number
  readonly blobsWritten: number
  readonly sqliteWrites: number
  readonly errorCount: number
}

export interface QueryPlanInspection {
  readonly hostDbSizeBytes: number
  readonly hostDbSizeGiB: number
  readonly hostDbSizeGB: number
  readonly sessionV2TotalRows: number
  readonly sessionMessageTotalRows: number
  readonly kvTotalRows: number
  readonly sessionByIdPlan: readonly string[]
  readonly sessionByParentIdPlan: readonly string[]
  readonly recursiveTreePlan: readonly string[]
  readonly messageBySessionIdPlan: readonly string[]
  readonly messageBySessionAndSeqDeltaPlan: readonly string[]
  readonly kvByPrimaryKeyPlan: readonly string[]
  readonly kvByTimeUpdatedScanPlan: readonly string[]
  readonly hasSessionParentIndex: boolean
  readonly hasMessageSessionSeqIndex: boolean
  readonly hasKvPrimaryKeyIndex: boolean
  readonly hasKvTimeUpdatedIndex: boolean
}

export interface WalWorkerLaneResult {
  readonly lane: number
  readonly processType: "child_process" | "in_process"
  readonly busyErrors: number
  readonly otherErrors: number
  readonly completedWrites: number
  readonly completedReads: number
  readonly elapsedMs: number
}

export interface WalConcurrencyReport {
  readonly journalMode: string
  readonly synchronousMode: number
  readonly busyTimeoutMs: number
  readonly totalOperations: number
  readonly totalWrites: number
  readonly totalReads: number
  readonly totalBusyErrors: number
  readonly totalOtherErrors: number
  readonly laneResults: readonly WalWorkerLaneResult[]
  readonly elapsedMs: number
}

export interface BenchmarkTreatmentSummary {
  readonly treatment:
    | "cold_full_tree"
    | "warm_noop_watermark"
    | "incremental_1turn_5msg_1kv"
    | "incremental_1turn_5msg_1kv_with_snapshot"
  readonly samples: number
  readonly medianMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly meanMs: number
  readonly spreadMs: number
  readonly rowsProcessedPerRun: number
  readonly kvRowsProcessedPerRun: number
  readonly snapshotsExtractedPerRun: number
  readonly sqliteWritesPerRun: number
  readonly errorCount: number
  readonly trialElapsedMs: readonly number[]
}

export interface InterleavedBenchmarkReport {
  readonly rootSessionId: string
  readonly rounds: number
  readonly coldFullTree: BenchmarkTreatmentSummary
  readonly warmNoopWatermark: BenchmarkTreatmentSummary
  readonly incremental1Turn5Msg1Kv: BenchmarkTreatmentSummary
  readonly incremental1Turn5Msg1KvWithSnapshot: BenchmarkTreatmentSummary
  readonly pinned287CheckpointColdMs: number
  readonly pinned287CheckpointNoopMs: number
  readonly pinned287CheckpointDeltaMs: number
  readonly speedupNoopVsCold: number
  readonly speedupIncrementalVsCold: number
  readonly speedupIncrementalWithSnapVsCold: number
}

export interface WorkingMemorySnapshot {
  readonly sessionId: string
  readonly rootId: string
  readonly stepWatermarkSeq: number
  readonly lastSyncedMessageId: string
  readonly activeBreadcrumbCount: number
  readonly manifestFilePaths: readonly string[]
  readonly updatedAtMs: number
}

export interface ContextHookResult {
  readonly sessionId: string
  readonly elapsedMs: number
  readonly sqliteQueriesExecuted: number
  readonly injectedManifestHeader: string
  readonly activeBreadcrumbCount: number
  readonly stepWatermarkSeq: number
}

export interface LifecycleHookReport {
  readonly contextHookResults: readonly ContextHookResult[]
  readonly maxContextHookMs: number
  readonly totalContextHookSqliteQueries: number
  readonly idleHookReport: SyncExecutionReport
  readonly compactionHookReport: SyncExecutionReport
  readonly nonIdleIgnoredCount: number
}

const HIVEMIND_PLUGIN_HEX =
  "plugin:0068006900760065006d0069006e0064002d0073007400650077006100720064002d006f0063002d0064006500760069006e"
const CONTEXT_PRUNE_PLUGIN_HEX = "plugin:0063006f006e0074006500780074002d007000720075006e0065"

const SYNC_DDL = `
CREATE TABLE IF NOT EXISTS sync_watermark (
  session_id TEXT PRIMARY KEY,
  root_id TEXT,
  last_time_updated INTEGER,
  last_max_seq INTEGER,
  last_message_id TEXT,
  last_kv_updated INTEGER,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  depth INTEGER NOT NULL,
  lane_kind TEXT NOT NULL,
  lane_path TEXT NOT NULL,
  title TEXT,
  agent TEXT,
  provider TEXT,
  model_id TEXT,
  variant TEXT,
  harness TEXT,
  outcome TEXT,
  cost REAL,
  tok_in INTEGER,
  tok_out INTEGER,
  tok_reason INTEGER,
  tok_cache_r INTEGER,
  tok_cache_w INTEGER,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  t_created INTEGER,
  t_updated INTEGER,
  t_idle INTEGER,
  t_compacting INTEGER,
  t_archived INTEGER,
  resume_attempts INTEGER,
  message_count INTEGER,
  transcript_path TEXT
);

CREATE TABLE IF NOT EXISTS delegation (
  call_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  parent_session TEXT NOT NULL,
  parent_message_id TEXT,
  child_session TEXT,
  tool TEXT,
  agent TEXT,
  harness TEXT,
  mode TEXT,
  background INTEGER,
  description TEXT,
  prompt_ref TEXT,
  status TEXT,
  t_created INTEGER,
  t_completed INTEGER,
  PRIMARY KEY (parent_session, call_id)
);

CREATE TABLE IF NOT EXISTS message (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  t INTEGER,
  agent TEXT,
  model_id TEXT,
  tok_in INTEGER,
  tok_out INTEGER,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS tool_call (
  call_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER,
  name TEXT,
  status TEXT,
  duration_ms INTEGER,
  truncated INTEGER,
  output_path TEXT,
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS compaction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT,
  status TEXT,
  summary_ref TEXT,
  tok_input INTEGER,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS instruction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  blob_sha TEXT,
  PRIMARY KEY (session_id, seq, path)
);

CREATE TABLE IF NOT EXISTS kv_binding (
  child_session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  driver_kind TEXT,
  harness TEXT,
  foreign_session_id TEXT,
  parent_session_id TEXT,
  call_id TEXT,
  title TEXT,
  cwd TEXT,
  agent TEXT,
  model TEXT,
  effort TEXT,
  mode TEXT,
  background INTEGER,
  requested_model TEXT,
  confirmed_model TEXT,
  confirmed_effort TEXT,
  turn INTEGER,
  phase TEXT,
  foreign_ack_turn INTEGER,
  foreign_ack_stop_reason TEXT,
  serving_witness_model TEXT,
  serving_witness_at TEXT,
  consumed_inputs_json TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  source_origin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_foreign_index (
  harness TEXT NOT NULL,
  foreign_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  PRIMARY KEY (harness, foreign_session_id)
);

CREATE TABLE IF NOT EXISTS kv_context_prune (
  session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  mode TEXT,
  anchor_message_id TEXT,
  recorded_at TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS delegation_turn (
  parent_session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  child_session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  harness TEXT NOT NULL,
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  start_message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL,
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL,
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);

CREATE TABLE IF NOT EXISTS snapshot_artifact (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  start_tree_sha TEXT NOT NULL,
  end_tree_sha TEXT NOT NULL,
  start_blob_sha TEXT,
  end_blob_sha TEXT,
  start_git_blob_sha TEXT,
  end_git_blob_sha TEXT,
  start_byte_len INTEGER,
  end_byte_len INTEGER,
  byte_len INTEGER NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, message_id, path)
);

CREATE TABLE IF NOT EXISTS spill_artifact (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  spill_kind TEXT NOT NULL,
  spill_source TEXT NOT NULL,
  inline_byte_len INTEGER NOT NULL,
  full_byte_len INTEGER NOT NULL,
  blob_sha TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS wal_concurrency_probe (
  probe_id TEXT PRIMARY KEY,
  lane INTEGER NOT NULL,
  op_index INTEGER NOT NULL,
  worker_kind TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_watermark_root_idx ON sync_watermark(root_id);
CREATE INDEX IF NOT EXISTS session_root_idx ON session(root_id);
CREATE INDEX IF NOT EXISTS delegation_turn_child_idx ON delegation_turn(child_session_id);
`

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null)

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

const parseJsonObj = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string") return {}
  try {
    return asObj(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function configureWalPragmas(db: Database): {
  readonly journalMode: string
  readonly synchronousMode: number
  readonly busyTimeoutMs: number
} {
  db.exec("PRAGMA busy_timeout = 5000;")
  const jmRow = db.query("PRAGMA journal_mode = WAL;").get() as { journal_mode?: string } | null
  db.exec("PRAGMA synchronous = NORMAL;")
  const syncRow = db.query("PRAGMA synchronous;").get() as { synchronous?: number } | null
  const btRow = db.query("PRAGMA busy_timeout;").get() as { timeout?: number } | null
  return {
    journalMode: String(jmRow?.journal_mode ?? "wal").toLowerCase(),
    synchronousMode: Number(syncRow?.synchronous ?? 1),
    busyTimeoutMs: Number(btRow?.timeout ?? 5000),
  }
}

export function initSyncDatabase(sqlitePath: string): Database {
  mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath)
  configureWalPragmas(db)
  db.exec(SYNC_DDL)
  return db
}

const toSessionRow = (raw: Record<string, unknown>): SessionRow => {
  const parsedModel = parseJsonObj(raw.model)
  const model =
    typeof parsedModel.id === "string" && typeof parsedModel.providerID === "string"
      ? typeof parsedModel.variant === "string"
        ? { id: parsedModel.id, providerID: parsedModel.providerID, variant: parsedModel.variant }
        : { id: parsedModel.id, providerID: parsedModel.providerID }
      : null
  return {
    id: raw.id as string,
    project_id: (raw.project_id as string) ?? "",
    parent_id: asStr(raw.parent_id),
    fork_session_id: asStr(raw.fork_session_id),
    fork_boundary: asStr(raw.fork_boundary),
    directory: (raw.directory as string) ?? "",
    title: asStr(raw.title),
    agent: asStr(raw.agent),
    model,
    idle_outcome: asStr(raw.idle_outcome),
    cost: asNum(raw.cost) ?? 0,
    tokens_input: asNum(raw.tokens_input) ?? 0,
    tokens_output: asNum(raw.tokens_output) ?? 0,
    tokens_reasoning: asNum(raw.tokens_reasoning) ?? 0,
    tokens_cache_read: asNum(raw.tokens_cache_read) ?? 0,
    tokens_cache_write: asNum(raw.tokens_cache_write) ?? 0,
    summary_additions: asNum(raw.summary_additions),
    summary_deletions: asNum(raw.summary_deletions),
    summary_files: asNum(raw.summary_files),
    time_created: asNum(raw.time_created) ?? 0,
    time_updated: asNum(raw.time_updated) ?? 0,
    time_idle: asNum(raw.time_idle),
    time_compacting: asNum(raw.time_compacting),
    time_archived: asNum(raw.time_archived),
    resume_attempts: asNum(raw.resume_attempts) ?? 0,
  }
}

const toHostSessionRow = (s: SessionRow): HostSessionRow => ({
  id: s.id,
  project_id: s.project_id,
  parent_id: s.parent_id,
  directory: s.directory,
  title: s.title,
  agent: s.agent,
  model_id: s.model?.id ?? null,
  provider_id: s.model?.providerID ?? null,
  variant: s.model?.variant ?? null,
  idle_outcome: s.idle_outcome,
  time_created: s.time_created,
  time_updated: s.time_updated,
})

interface FlattenedTreeNode {
  readonly row: SessionRow
  readonly hostRow: HostSessionRow
  readonly depth: number
  readonly relDir: string
  readonly children: readonly SessionRow[]
}

export function querySessionTreeFromHost(
  hostDb: Database,
  sessionID: string,
  scope?: TreeScopeOptions,
): {
  readonly root: SessionRow
  readonly nodes: readonly FlattenedTreeNode[]
  readonly sessionsById: ReadonlyMap<string, HostSessionRow>
} {
  let currentRaw = hostDb.query("SELECT * FROM session_v2 WHERE id = ?").get(sessionID) as Record<string, unknown> | null
  if (!currentRaw) {
    throw new Error(`session-archive: session ${sessionID} not found in opencode.db`)
  }
  const seenUp = new Set<string>([sessionID])
  while (typeof currentRaw.parent_id === "string" && currentRaw.parent_id.length > 0) {
    const parentId = currentRaw.parent_id
    if (seenUp.has(parentId)) break
    seenUp.add(parentId)
    const parentRaw = hostDb.query("SELECT * FROM session_v2 WHERE id = ?").get(parentId) as Record<string, unknown> | null
    if (!parentRaw) break
    currentRaw = parentRaw
  }
  const rootId = currentRaw.id as string

  const rawTreeRows = hostDb
    .query(`
      WITH RECURSIVE tree AS (
        SELECT * FROM session_v2 WHERE id = ?
        UNION ALL
        SELECT s.* FROM session_v2 s
        JOIN tree t ON s.parent_id = t.id
      )
      SELECT * FROM tree
    `)
    .all(rootId) as Array<Record<string, unknown>>

  const allRows = rawTreeRows.map(toSessionRow)
  const root = allRows.find((r) => r.id === rootId)!
  const childrenByParent = new Map<string, SessionRow[]>()
  for (const r of allRows) {
    if (r.parent_id) {
      const list = childrenByParent.get(r.parent_id) ?? []
      list.push(r)
      childrenByParent.set(r.parent_id, list)
    }
  }
  for (const [pid, list] of childrenByParent.entries()) {
    list.sort((a, b) => a.time_created - b.time_created || a.id.localeCompare(b.id))
    if (pid === rootId && scope?.maxChildSessions !== undefined) {
      childrenByParent.set(pid, list.slice(0, scope.maxChildSessions))
    }
  }

  const nodes: FlattenedTreeNode[] = []
  const sessionsById = new Map<string, HostSessionRow>()
  const visit = (row: SessionRow, depth: number, parentRelDir: string | null) => {
    const relDir = sessionRelDir(parentRelDir, row.id)
    const children = childrenByParent.get(row.id) ?? []
    const hostRow = toHostSessionRow(row)
    nodes.push({ row, hostRow, depth, relDir, children })
    sessionsById.set(row.id, hostRow)
    for (const child of children) {
      visit(child, depth + 1, relDir)
    }
  }
  visit(root, 0, null)

  return { root, nodes, sessionsById }
}

export function queryTreeKvDelta(
  hostDb: Database,
  nodes: readonly FlattenedTreeNode[],
  watermarksBySession: ReadonlyMap<string, SyncWatermarkRow>,
  forceFullKv: boolean,
): {
  readonly bindings: readonly KvBindingRow[]
  readonly foreignIndex: readonly KvForeignIndexRow[]
  readonly contextPrunes: readonly KvContextPruneRow[]
  readonly maxKvUpdatedBySession: ReadonlyMap<string, number>
  readonly rawRowsProcessed: number
} {
  const kvByKeyAndUpdatedStmt = hostDb.query(
    "SELECT key, value, time_created, time_updated FROM kv WHERE key = ? AND time_updated > ?",
  )
  const kvByKeyFullStmt = hostDb.query("SELECT key, value, time_created, time_updated FROM kv WHERE key = ?")

  const updatedSessionIds = new Set<string>()
  const maxKvUpdatedBySession = new Map<string, number>()
  let rawRowsProcessed = 0

  for (const node of nodes) {
    const sid = node.row.id
    const wm = watermarksBySession.get(sid)
    const minUpdated = forceFullKv || !wm ? -1 : wm.last_kv_updated
    const candidateKeys = [
      `${HIVEMIND_PLUGIN_HEX}:bindings/${sid}`,
      `${HIVEMIND_PLUGIN_HEX}:bindings/v1/${sid}`,
      `${HIVEMIND_PLUGIN_HEX}:delegate-mode/child/${sid}`,
      `${CONTEXT_PRUNE_PLUGIN_HEX}:context-prune:${sid}`,
      `session:${sid}:context-prune:${sid}`,
    ]
    let maxSeen = wm?.last_kv_updated ?? 0
    let sessionHadKvUpdate = false
    for (const key of candidateKeys) {
      const row = kvByKeyAndUpdatedStmt.get(key, minUpdated) as {
        key: string
        value: string
        time_created: number
        time_updated: number
      } | null
      if (row) {
        sessionHadKvUpdate = true
        rawRowsProcessed++
        if (row.time_updated > maxSeen) maxSeen = row.time_updated
      }
    }
    if (sessionHadKvUpdate) {
      updatedSessionIds.add(sid)
    }
    maxKvUpdatedBySession.set(sid, maxSeen)
  }

  if (updatedSessionIds.size === 0) {
    return {
      bindings: [],
      foreignIndex: [],
      contextPrunes: [],
      maxKvUpdatedBySession,
      rawRowsProcessed: 0,
    }
  }

  const bindings: KvBindingRow[] = []
  const foreignIndex: KvForeignIndexRow[] = []
  const contextPrunes: KvContextPruneRow[] = []

  for (const sid of updatedSessionIds) {
    const node = nodes.find((n) => n.row.id === sid)
    if (!node) continue
    const sRow = node.hostRow

    const bindingRow =
      (kvByKeyFullStmt.get(`${HIVEMIND_PLUGIN_HEX}:bindings/${sid}`) as {
        key: string
        value: string
        time_created: number
        time_updated: number
      } | null) ??
      (kvByKeyFullStmt.get(`${HIVEMIND_PLUGIN_HEX}:bindings/v1/${sid}`) as {
        key: string
        value: string
        time_created: number
        time_updated: number
      } | null)

    const delegateChildRow = kvByKeyFullStmt.get(`${HIVEMIND_PLUGIN_HEX}:delegate-mode/child/${sid}`) as {
      key: string
      value: string
      time_created: number
      time_updated: number
    } | null

    if (bindingRow || delegateChildRow) {
      const bVal = bindingRow ? parseJsonObj(bindingRow.value) : {}
      const dVal = delegateChildRow ? parseJsonObj(delegateChildRow.value) : {}
      const rawKey = bindingRow?.key ?? delegateChildRow!.key
      const { scope } = decodeHostKvKey(rawKey, null)

      const creationApplied = asObj(bVal.creationApplied)
      const receipts = asObj(creationApplied.receipts)
      const modelReceipt = asObj(receipts.model)
      const thinkingReceipt = asObj(receipts.thinking)
      const witness = asObj(bVal.servingWitness)
      const roleDelivery = asObj(bVal.roleDelivery)
      const foreignAck = asObj(bVal.foreignAck)

      const foreignId = asStr(bVal.foreignSessionID) ?? asStr(bVal.foreignSessionId)
      const agent = asStr(bVal.agent) ?? asStr(roleDelivery.agent) ?? sRow.agent
      const title = asStr(bVal.title) ?? sRow.title
      const rawHarness = asStr(bVal.harness) ?? asStr(dVal.harness)
      const harness =
        rawHarness === "devin" || rawHarness === "antigravity" || rawHarness === "opencode"
          ? rawHarness
          : sRow.provider_id === "devin-native"
            ? "devin"
            : sRow.provider_id === "antigravity-native"
              ? "antigravity"
              : agent?.includes("antigravity") || title?.startsWith("Antigravity")
                ? "antigravity"
                : agent?.includes("devin") || title?.startsWith("Devin")
                  ? "devin"
                  : "opencode"

      const confirmedModel =
        asStr(dVal.confirmedModel) ?? asStr(modelReceipt.applied) ?? asStr(witness.model)
      const model =
        asStr(bVal.model) ??
        asStr(creationApplied.model) ??
        confirmedModel ??
        sRow.model_id
      const confirmedEffort = asStr(dVal.confirmedEffort) ?? asStr(thinkingReceipt.applied)
      const effort = asStr(bVal.effort) ?? confirmedEffort ?? sRow.variant
      const turn = asNum(bVal.turn)
      const rawMode = asStr(dVal.mode)
      const mode: "spawn" | "send" | "continue" =
        rawMode === "spawn" || rawMode === "send" || rawMode === "continue"
          ? rawMode
          : (turn ?? 1) > 1
            ? "send"
            : "spawn"
      const bg = asBool(dVal.background)
      const launchMode = asStr(dVal.launchMode)
      const background = bg !== null ? bg : launchMode !== null ? launchMode === "background" : null

      const createdAt =
        asNum(bVal.createdAt) ??
        asNum(dVal.createdAt) ??
        bindingRow?.time_created ??
        delegateChildRow?.time_created ??
        sRow.time_created
      const updatedAt = Math.max(
        asNum(bVal.updatedAt) ?? 0,
        asNum(dVal.updatedAt) ?? 0,
        asNum(dVal.releasedAt) ?? 0,
        bindingRow?.time_updated ?? 0,
        delegateChildRow?.time_updated ?? 0,
      )

      bindings.push({
        child_session_id: sid,
        raw_key: rawKey,
        scope,
        driver_kind: asStr(bVal.driverKind) ?? asStr(bVal.creationTransportRef) ?? "acp-W",
        harness,
        foreign_session_id: foreignId,
        parent_session_id: asStr(bVal.parentSessionID) ?? asStr(dVal.parentSessionID) ?? sRow.parent_id,
        call_id: asStr(dVal.callID),
        title,
        cwd: asStr(bVal.cwd) ?? sRow.directory,
        agent,
        model,
        effort,
        mode,
        background,
        requested_model: asStr(dVal.requestedModel) ?? asStr(modelReceipt.requested),
        confirmed_model: confirmedModel,
        confirmed_effort: confirmedEffort,
        turn,
        phase: asStr(bVal.phase),
        foreign_ack_turn: asNum(foreignAck.turn),
        foreign_ack_stop_reason: asStr(foreignAck.stopReason),
        serving_witness_model: asStr(witness.model),
        serving_witness_at: asStr(witness.observedAt),
        consumed_inputs_json: Array.isArray(bVal.consumedInputs) ? JSON.stringify(bVal.consumedInputs) : null,
        created_at: createdAt,
        updated_at: updatedAt > 0 ? updatedAt : sRow.time_updated,
        source_origin: "host_db",
      })

      if (foreignId) {
        foreignIndex.push({
          harness,
          foreign_session_id: foreignId,
          child_session_id: sid,
          raw_key: `derived:${rawKey}`,
        })
      }
    }

    const pruneRow =
      (kvByKeyFullStmt.get(`${CONTEXT_PRUNE_PLUGIN_HEX}:context-prune:${sid}`) as {
        key: string
        value: string
        time_created: number
        time_updated: number
      } | null) ??
      (kvByKeyFullStmt.get(`session:${sid}:context-prune:${sid}`) as {
        key: string
        value: string
        time_created: number
        time_updated: number
      } | null)

    if (pruneRow) {
      const pVal = parseJsonObj(pruneRow.value)
      const { scope } = decodeHostKvKey(pruneRow.key, null)
      contextPrunes.push({
        session_id: sid,
        raw_key: pruneRow.key,
        scope,
        mode: asStr(pVal.mode),
        anchor_message_id: asStr(pVal.anchor),
        recorded_at: asStr(pVal.at),
        updated_at: pruneRow.time_updated,
      })
    }
  }

  return {
    bindings,
    foreignIndex,
    contextPrunes,
    maxKvUpdatedBySession,
    rawRowsProcessed,
  }
}

const tokenNum = (tokens: unknown, key: string): number | null => {
  if (typeof tokens !== "object" || tokens === null) return null
  const v = (tokens as Record<string, unknown>)[key]
  return typeof v === "number" ? v : null
}

export interface SyncSessionTreeOptions {
  readonly sessionID: string
  readonly hostDbPath?: string
  readonly hostDb?: Database
  readonly opencodeDataDir?: string
  readonly targetSqlitePath: string
  readonly targetBlobDir: string
  readonly projectRoot?: string
  readonly forceColdFull?: boolean
  readonly skipSnapshots?: boolean
  readonly scope?: TreeScopeOptions
}

export function syncSessionTreeIncremental(options: SyncSessionTreeOptions): SyncExecutionReport {
  const tStart = performance.now()
  const opencodeDataDir = options.opencodeDataDir ?? "/Users/MAC/.local/share/opencode"
  const hostDbPath = options.hostDbPath ?? path.join(opencodeDataDir, "opencode.db")
  const projectRoot =
    options.projectRoot ?? "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"

  const ownHostDb = options.hostDb === undefined
  const hostDb = options.hostDb ?? new Database(hostDbPath, { readonly: true })
  const syncDb = initSyncDatabase(options.targetSqlitePath)

  try {
    // 1. Discover tree in opencode.db using indexed recursive CTE
    const tTree0 = performance.now()
    const { root, nodes, sessionsById } = querySessionTreeFromHost(hostDb, options.sessionID, options.scope)
    const queryTreeMs = performance.now() - tTree0

    // 2. Read existing sync_watermark rows for this root_id
    const existingWatermarks = new Map<string, SyncWatermarkRow>()
    if (!options.forceColdFull) {
      const wmRows = syncDb
        .query(
          "SELECT session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at FROM sync_watermark WHERE root_id = ?",
        )
        .all(root.id) as SyncWatermarkRow[]
      for (const wm of wmRows) {
        existingWatermarks.set(wm.session_id, wm)
      }
    }

    const isCold = options.forceColdFull === true || existingWatermarks.size === 0

    // 3. Determine which sessions have time_updated > watermark.last_time_updated
    const dirtyNodes: FlattenedTreeNode[] = []
    for (const node of nodes) {
      const wm = existingWatermarks.get(node.row.id)
      if (isCold || !wm || node.row.time_updated > wm.last_time_updated) {
        dirtyNodes.push(node)
      }
    }

    // 4. Query KV delta for the session tree
    const tKv0 = performance.now()
    const kvDelta = queryTreeKvDelta(hostDb, nodes, existingWatermarks, isCold)
    const queryKvMs = performance.now() - tKv0

    // Fast no-op exit when 0 sessions and 0 KV bindings changed
    if (!isCold && dirtyNodes.length === 0 && kvDelta.rawRowsProcessed === 0) {
      return {
        mode: "noop_delta",
        rootSessionId: root.id,
        elapsedMs: performance.now() - tStart,
        queryTreeMs,
        queryMessagesMs: 0,
        queryKvMs,
        normalizeAndSinkMs: 0,
        sqliteWriteMs: 0,
        sessionsInTree: nodes.length,
        dirtySessionsCount: 0,
        messagesProcessed: 0,
        kvRowsProcessed: 0,
        toolCallsProcessed: 0,
        delegationsProcessed: 0,
        delegationTurnsProcessed: 0,
        snapshotsExtracted: 0,
        spillsSunk: 0,
        blobsWritten: 0,
        sqliteWrites: 0,
        errorCount: 0,
      }
    }

    // 5. Fetch delta messages ONLY for dirty sessions using session_message_session_seq_idx (session_id, seq)
    const tMsg0 = performance.now()
    const deltaMsgStmt = hostDb.query(
      "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq ASC",
    )
    const deltaMsgBoundedStmt = hostDb.query(
      "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND seq > ? AND seq <= ? ORDER BY seq ASC",
    )
    const deltaRawBySession = new Map<string, MessageRow[]>()
    const deltaHostMsgsBySession = new Map<string, HostMessageRow[]>()
    let totalDeltaMessages = 0

    for (const node of dirtyNodes) {
      const sid = node.row.id
      const wm = existingWatermarks.get(sid)
      const afterSeq = isCold || !wm ? -1 : wm.last_max_seq
      const maxSeq = sid === root.id ? options.scope?.maxRootSeq : undefined
      let rawRows = (
        maxSeq !== undefined ? deltaMsgBoundedStmt.all(sid, afterSeq, maxSeq) : deltaMsgStmt.all(sid, afterSeq)
      ) as Array<{
        id: string
        session_id: string
        type: string
        seq: number
        time_created: number
        time_updated: number
        data: string
      }>
      if (sid === root.id && options.scope?.maxRootMessages !== undefined && afterSeq === -1) {
        rawRows = rawRows.slice(0, options.scope.maxRootMessages)
      }
      if (rawRows.length === 0) continue

      const msgRows: MessageRow[] = []
      const hostMsgRows: HostMessageRow[] = []
      for (const r of rawRows) {
        const parsed = parseJsonObj(r.data)
        msgRows.push({
          id: r.id,
          session_id: r.session_id,
          type: r.type,
          seq: r.seq,
          time_created: r.time_created,
          time_updated: r.time_updated,
          data: parsed,
        })
        hostMsgRows.push({
          id: r.id,
          session_id: r.session_id,
          type: r.type,
          seq: r.seq,
          time_created: r.time_created,
          time_updated: r.time_updated,
          data: parsed,
        })
      }
      deltaRawBySession.set(sid, msgRows)
      deltaHostMsgsBySession.set(sid, hostMsgRows)
      totalDeltaMessages += msgRows.length
    }
    const queryMessagesMs = performance.now() - tMsg0

    if (!isCold && totalDeltaMessages === 0 && kvDelta.rawRowsProcessed === 0) {
      return {
        mode: "noop_delta",
        rootSessionId: root.id,
        elapsedMs: performance.now() - tStart,
        queryTreeMs,
        queryMessagesMs,
        queryKvMs,
        normalizeAndSinkMs: 0,
        sqliteWriteMs: 0,
        sessionsInTree: nodes.length,
        dirtySessionsCount: 0,
        messagesProcessed: 0,
        kvRowsProcessed: 0,
        toolCallsProcessed: 0,
        delegationsProcessed: 0,
        delegationTurnsProcessed: 0,
        snapshotsExtracted: 0,
        spillsSunk: 0,
        blobsWritten: 0,
        sqliteWrites: 0,
        errorCount: 0,
      }
    }

    // 6. Normalize delta messages, extract shadow snapshots & spills for delta messages only
    const tNorm0 = performance.now()
    const sinker = createDiskBlobSinker(options.targetBlobDir)
    const nodesById = new Map(nodes.map((n) => [n.row.id, n]))

    interface PreparedSessionDelta {
      readonly node: FlattenedTreeNode
      readonly messageCount: number
      readonly lastSeq: number
      readonly lastMessageId: string
      readonly lastTimeUpdated: number
      readonly records: readonly MessageRecord[]
      readonly delegations: readonly DelegationFact[]
    }

    const preparedDeltas: PreparedSessionDelta[] = []
    const messageDirtyChildIds = new Set<string>()
    const kvOnlyChildBindings: KvBindingRow[] = []

    const countMsgStmt = syncDb.query("SELECT COUNT(*) as c FROM message WHERE session_id = ?")

    for (const node of dirtyNodes) {
      const sid = node.row.id
      const wm = existingWatermarks.get(sid)
      const deltaRows = deltaRawBySession.get(sid) ?? []
      let prevSeq: number | null = wm ? wm.last_max_seq : null
      const records: MessageRecord[] = []
      const delegations: DelegationFact[] = []

      for (const row of deltaRows) {
        const norm = normalizeMessage(row, sinker.sinkText, prevSeq)
        records.push(norm.record)
        delegations.push(...norm.delegations)
        for (const d of norm.delegations) {
          messageDirtyChildIds.add(d.child_session_id)
        }
        prevSeq = row.seq
      }

      if (sid !== root.id && deltaRows.length > 0) {
        messageDirtyChildIds.add(sid)
      }

      const priorCount = isCold || !wm ? 0 : ((countMsgStmt.get(sid) as { c: number } | null)?.c ?? 0)
      const lastRow = deltaRows[deltaRows.length - 1]
      const lastSeq = lastRow ? lastRow.seq : (wm?.last_max_seq ?? 0)
      const lastMessageId = lastRow ? lastRow.id : (wm?.last_message_id ?? "")
      const lastTimeUpdated = Math.max(
        node.row.time_updated,
        lastRow ? lastRow.time_updated : 0,
        wm?.last_time_updated ?? 0,
      )

      preparedDeltas.push({
        node,
        messageCount: priorCount + deltaRows.length,
        lastSeq,
        lastMessageId,
        lastTimeUpdated,
        records,
        delegations,
      })
    }

    for (const b of kvDelta.bindings) {
      if (!isCold && !messageDirtyChildIds.has(b.child_session_id)) {
        kvOnlyChildBindings.push(b)
      }
    }

    const dirtyHostSessions = dirtyNodes.map((n) => n.hostRow)
    const snapshotArtifacts: SnapshotArtifactRow[] = options.skipSnapshots
      ? []
      : sinkShadowSnapshots(
          dirtyHostSessions,
          deltaHostMsgsBySession,
          path.join(opencodeDataDir, "snapshot"),
          sinker.sinkBuffer,
          "host_db",
        )

    const spillArtifacts: SpillArtifactRow[] = sinkExternalSpills(
      dirtyHostSessions,
      deltaHostMsgsBySession,
      opencodeDataDir,
      sinker.sinkBuffer,
      "host_db",
    )

    // Recompute delegation_turn rows only for child sessions whose messages or parent delegation calls changed
    let delegationTurns: DelegationTurnRow[] = []
    if (messageDirtyChildIds.size > 0 || isCold) {
      const targetChildren = isCold
        ? nodes.filter((n) => n.row.parent_id === root.id).map((n) => n.hostRow)
        : nodes
            .filter((n) => n.row.parent_id === root.id && messageDirtyChildIds.has(n.row.id))
            .map((n) => n.hostRow)

      if (targetChildren.length > 0) {
        const fullMsgStmt = hostDb.query(
          "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq ASC",
        )
        const loadFullHostMsgs = (sid: string): readonly HostMessageRow[] => {
          if (isCold && deltaHostMsgsBySession.has(sid)) {
            return deltaHostMsgsBySession.get(sid)!
          }
          const rows = fullMsgStmt.all(sid) as Array<{
            id: string
            session_id: string
            type: string
            seq: number
            time_created: number
            time_updated: number
            data: string
          }>
          const limited =
            sid === root.id && options.scope?.maxRootMessages !== undefined
              ? rows.slice(0, options.scope.maxRootMessages)
              : rows
          return limited.map((r) => ({
            ...r,
            data: parseJsonObj(r.data),
          }))
        }

        const parentFullMsgs = isCold ? loadFullHostMsgs(root.id) : (deltaHostMsgsBySession.get(root.id) ?? [])
        const childFullMsgsMap = new Map<string, readonly HostMessageRow[]>()
        for (const c of targetChildren) {
          childFullMsgsMap.set(c.id, loadFullHostMsgs(c.id))
        }

        const kvByChildId = new Map<string, KvBindingRow>()
        if (!isCold) {
          const existingKvRows = syncDb.query("SELECT * FROM kv_binding").all() as KvBindingRow[]
          for (const b of existingKvRows) kvByChildId.set(b.child_session_id, b)
        }
        for (const b of kvDelta.bindings) {
          kvByChildId.set(b.child_session_id, b)
        }

        delegationTurns = normalizeDelegationTurns(
          root.id,
          parentFullMsgs,
          targetChildren,
          childFullMsgsMap,
          kvByChildId,
          sinker.sinkText,
          "host_db",
        )
      }
    }
    const normalizeAndSinkMs = performance.now() - tNorm0

    // 7. Commit all incremental changes + sync_watermark in a single BEGIN IMMEDIATE WAL transaction
    const tWrite0 = performance.now()
    let sqliteWrites = 0
    let toolCallsProcessed = 0
    let delegationsProcessed = 0
    const syncedAtIso = new Date().toISOString()

    const insSession = syncDb.query(`
      INSERT OR REPLACE INTO session (
        id, root_id, project_id, parent_id, depth, lane_kind, lane_path, title, agent,
        provider, model_id, variant, harness, outcome, cost, tok_in, tok_out, tok_reason,
        tok_cache_r, tok_cache_w, files_changed, additions, deletions, t_created, t_updated,
        t_idle, t_compacting, t_archived, resume_attempts, message_count, transcript_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insMessage = syncDb.query(`
      INSERT OR REPLACE INTO message (session_id, seq, id, kind, t, agent, model_id, tok_in, tok_out)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insToolCall = syncDb.query(`
      INSERT OR REPLACE INTO tool_call (call_id, session_id, seq, name, status, duration_ms, truncated, output_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insCompaction = syncDb.query(`
      INSERT OR REPLACE INTO compaction (session_id, seq, reason, status, summary_ref, tok_input)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    const insInstruction = syncDb.query(`
      INSERT OR REPLACE INTO instruction (session_id, seq, path, blob_sha)
      VALUES (?, ?, ?, ?)
    `)
    const insDelegation = syncDb.query(`
      INSERT OR REPLACE INTO delegation (
        call_id, root_id, parent_session, parent_message_id, child_session, tool, agent,
        harness, mode, background, description, prompt_ref, status, t_created, t_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insKvBinding = syncDb.query(`
      INSERT OR REPLACE INTO kv_binding (
        child_session_id, raw_key, scope, driver_kind, harness, foreign_session_id,
        parent_session_id, call_id, title, cwd, agent, model, effort, mode, background,
        requested_model, confirmed_model, confirmed_effort, turn, phase,
        foreign_ack_turn, foreign_ack_stop_reason, serving_witness_model, serving_witness_at,
        consumed_inputs_json, created_at, updated_at, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insKvForeign = syncDb.query(`
      INSERT OR REPLACE INTO kv_foreign_index (harness, foreign_session_id, child_session_id, raw_key)
      VALUES (?, ?, ?, ?)
    `)
    const insKvPrune = syncDb.query(`
      INSERT OR REPLACE INTO kv_context_prune (session_id, raw_key, scope, mode, anchor_message_id, recorded_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    const insTurn = syncDb.query(`
      INSERT OR REPLACE INTO delegation_turn (
        parent_session_id, call_id, turn_index, child_session_id, mode, harness,
        agent, model, foreign_session_id, start_seq, end_seq, start_message_id, end_message_id,
        reported_outcome, verified_outcome, blocker_summary,
        tool_error_count, tool_completed_count, text_char_count,
        prompt_blob, response_blob, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const updTurnKvMetadata = syncDb.query(`
      UPDATE delegation_turn
      SET harness = COALESCE(?, harness),
          agent = COALESCE(?, agent),
          model = COALESCE(?, model),
          foreign_session_id = COALESCE(?, foreign_session_id)
      WHERE child_session_id = ?
    `)
    const insSnapshot = syncDb.query(`
      INSERT OR REPLACE INTO snapshot_artifact (
        session_id, message_id, seq, path, start_tree_sha, end_tree_sha,
        start_blob_sha, end_blob_sha, start_git_blob_sha, end_git_blob_sha,
        start_byte_len, end_byte_len, byte_len, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insSpill = syncDb.query(`
      INSERT OR REPLACE INTO spill_artifact (
        session_id, call_id, message_id, seq, tool_name, spill_kind,
        spill_source, inline_byte_len, full_byte_len, blob_sha, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insWatermark = syncDb.query(`
      INSERT OR REPLACE INTO sync_watermark (
        session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const writeTx = syncDb.transaction(() => {
      if (isCold) {
        syncDb.query("DELETE FROM sync_watermark WHERE root_id = ?").run(root.id)
        syncDb.query("DELETE FROM session WHERE root_id = ?").run(root.id)
        syncDb.query("DELETE FROM delegation WHERE root_id = ?").run(root.id)
      }

      for (const prep of preparedDeltas) {
        const { node } = prep
        const header = sessionHeader(node.row, {
          root_id: root.id,
          depth: node.depth,
          lane: laneOf(node.row.directory, projectRoot),
          children: node.children.map((c) => c.id),
          message_count: prep.messageCount,
        })
        const transcriptRel = path.join(node.relDir, `${node.row.id}.jsonl`).split(path.sep).join("/")

        insSession.run(
          header.id,
          root.id,
          header.project_id,
          header.parent_id,
          header.depth,
          header.lane.kind,
          header.lane.path,
          header.title,
          header.agent,
          header.model?.providerID ?? null,
          header.model?.id ?? null,
          header.model?.variant ?? null,
          header.harness,
          header.outcome,
          header.cost,
          header.tokens.input,
          header.tokens.output,
          header.tokens.reasoning,
          header.tokens.cache_read,
          header.tokens.cache_write,
          header.summary.files,
          header.summary.additions,
          header.summary.deletions,
          header.time.created,
          prep.lastTimeUpdated,
          header.time.idle,
          header.time.compacting,
          header.time.archived,
          header.resume_attempts,
          prep.messageCount,
          transcriptRel,
        )
        sqliteWrites++

        for (const record of prep.records) {
          insMessage.run(
            node.row.id,
            record.raw_ref.seq,
            record.id,
            record.kind,
            record.t,
            record.kind === "assistant" ? record.agent : record.kind === "boundary" ? (record.agent ?? null) : null,
            record.kind === "assistant" ? (record.model?.id ?? null) : null,
            record.kind === "assistant" ? tokenNum(record.tokens, "input") : null,
            record.kind === "assistant" ? tokenNum(record.tokens, "output") : null,
          )
          sqliteWrites++

          if (record.kind === "assistant") {
            for (const part of record.parts) {
              if (part.type !== "tool") continue
              const dur =
                part.time.completed !== null
                  ? part.time.completed - (part.time.ran ?? part.time.created ?? part.time.completed)
                  : null
              insToolCall.run(
                part.call_id,
                node.row.id,
                record.raw_ref.seq,
                part.name,
                part.status,
                dur,
                part.truncated ? 1 : 0,
                part.output_path,
              )
              toolCallsProcessed++
              sqliteWrites++
            }
          } else if (record.kind === "compaction") {
            insCompaction.run(
              node.row.id,
              record.raw_ref.seq,
              record.reason,
              record.status,
              record.summary === null ? null : sinker.sinkText(record.summary),
              tokenNum(record.tokens, "input"),
            )
            sqliteWrites++
          } else if (record.kind === "context" && record.text_ref !== null) {
            const sha = record.text_ref.slice("blob:".length)
            for (const p of record.paths) {
              insInstruction.run(node.row.id, record.raw_ref.seq, p, sha)
              sqliteWrites++
            }
          }
        }

        for (const fact of prep.delegations) {
          const childNode = nodesById.get(fact.child_session_id)
          insDelegation.run(
            fact.call_id,
            root.id,
            node.row.id,
            fact.message_id,
            fact.child_session_id,
            fact.tool,
            fact.agent,
            fact.harness ?? (childNode ? harnessOf(childNode.row.model) : null),
            fact.mode,
            fact.background ? 1 : 0,
            fact.description,
            fact.prompt_ref,
            fact.status,
            fact.t_created,
            fact.t_completed,
          )
          delegationsProcessed++
          sqliteWrites++
        }

        const kvMax = kvDelta.maxKvUpdatedBySession.get(node.row.id) ?? existingWatermarks.get(node.row.id)?.last_kv_updated ?? 0
        insWatermark.run(
          node.row.id,
          root.id,
          prep.lastTimeUpdated,
          prep.lastSeq,
          prep.lastMessageId,
          kvMax,
          syncedAtIso,
        )
        sqliteWrites++
      }

      // Also advance sync_watermark for sessions that had KV updates without new session_message rows
      const preparedIds = new Set(preparedDeltas.map((p) => p.node.row.id))
      for (const b of kvDelta.bindings) {
        const sid = b.child_session_id
        if (!preparedIds.has(sid) && sessionsById.has(sid)) {
          const wm = existingWatermarks.get(sid)
          const sRow = sessionsById.get(sid)!
          const kvMax = kvDelta.maxKvUpdatedBySession.get(sid) ?? b.updated_at ?? 0
          insWatermark.run(
            sid,
            root.id,
            wm?.last_time_updated ?? sRow.time_updated,
            wm?.last_max_seq ?? 0,
            wm?.last_message_id ?? "",
            kvMax,
            syncedAtIso,
          )
          sqliteWrites++
        }
      }

      for (const b of kvDelta.bindings) {
        insKvBinding.run(
          b.child_session_id,
          b.raw_key,
          b.scope,
          b.driver_kind,
          b.harness,
          b.foreign_session_id,
          b.parent_session_id,
          b.call_id,
          b.title,
          b.cwd,
          b.agent,
          b.model,
          b.effort,
          b.mode,
          b.background === null ? null : b.background ? 1 : 0,
          b.requested_model,
          b.confirmed_model,
          b.confirmed_effort,
          b.turn,
          b.phase,
          b.foreign_ack_turn,
          b.foreign_ack_stop_reason,
          b.serving_witness_model,
          b.serving_witness_at,
          b.consumed_inputs_json,
          b.created_at,
          b.updated_at,
          b.source_origin,
        )
        sqliteWrites++
      }

      for (const b of kvOnlyChildBindings) {
        updTurnKvMetadata.run(
          b.harness,
          b.agent,
          b.confirmed_model ?? b.model,
          b.foreign_session_id,
          b.child_session_id,
        )
        sqliteWrites++
      }

      for (const f of kvDelta.foreignIndex) {
        insKvForeign.run(f.harness, f.foreign_session_id, f.child_session_id, f.raw_key)
        sqliteWrites++
      }

      for (const p of kvDelta.contextPrunes) {
        insKvPrune.run(p.session_id, p.raw_key, p.scope, p.mode, p.anchor_message_id, p.recorded_at, p.updated_at)
        sqliteWrites++
      }

      for (const t of delegationTurns) {
        insTurn.run(
          t.parent_session_id,
          t.call_id,
          t.turn_index,
          t.child_session_id,
          t.mode,
          t.harness,
          t.agent,
          t.model,
          t.foreign_session_id,
          t.start_seq,
          t.end_seq,
          t.start_message_id,
          t.end_message_id,
          t.reported_outcome,
          t.verified_outcome,
          t.blocker_summary,
          t.tool_error_count,
          t.tool_completed_count,
          t.text_char_count,
          t.prompt_blob,
          t.response_blob,
          t.source_origin,
        )
        sqliteWrites++
      }

      for (const s of snapshotArtifacts) {
        insSnapshot.run(
          s.session_id,
          s.message_id,
          s.seq,
          s.path,
          s.start_tree_sha,
          s.end_tree_sha,
          s.start_blob_sha,
          s.end_blob_sha,
          s.start_git_blob_sha,
          s.end_git_blob_sha,
          s.start_byte_len,
          s.end_byte_len,
          s.byte_len,
          s.source_origin,
        )
        sqliteWrites++
      }

      for (const sp of spillArtifacts) {
        insSpill.run(
          sp.session_id,
          sp.call_id,
          sp.message_id,
          sp.seq,
          sp.tool_name,
          sp.spill_kind,
          sp.spill_source,
          sp.inline_byte_len,
          sp.full_byte_len,
          sp.blob_sha,
          sp.source_origin,
        )
        sqliteWrites++
      }
    })

    writeTx.immediate()
    const sqliteWriteMs = performance.now() - tWrite0

    return {
      mode: isCold ? "cold_full" : "incremental_delta",
      rootSessionId: root.id,
      elapsedMs: performance.now() - tStart,
      queryTreeMs,
      queryMessagesMs,
      queryKvMs,
      normalizeAndSinkMs,
      sqliteWriteMs,
      sessionsInTree: nodes.length,
      dirtySessionsCount: dirtyNodes.length,
      messagesProcessed: totalDeltaMessages,
      kvRowsProcessed: kvDelta.rawRowsProcessed,
      toolCallsProcessed,
      delegationsProcessed,
      delegationTurnsProcessed: delegationTurns.length + kvOnlyChildBindings.length,
      snapshotsExtracted: snapshotArtifacts.length,
      spillsSunk: spillArtifacts.length,
      blobsWritten: sinker.blobsWritten(),
      sqliteWrites,
      errorCount: 0,
    }
  } finally {
    syncDb.close()
    if (ownHostDb) {
      hostDb.close()
    }
  }
}

export function syncSessionTreeFullBaseline(options: SyncSessionTreeOptions): SyncExecutionReport {
  return syncSessionTreeIncremental({
    ...options,
    forceColdFull: true,
  })
}

export function rewindWatermarkForDeltaTurn(options: {
  readonly targetSqlitePath: string
  readonly rootSessionId: string
  readonly rewindMessageCount?: number
  readonly capAtSeq?: number
}): {
  readonly rewoundFromSeq: number
  readonly rewoundToSeq: number
  readonly rewoundToMessageId: string
  readonly rewoundToTimeUpdated: number
  readonly rewoundKvSessionId: string
  readonly rewoundKvFromUpdated: number
} {
  const rewindCount = options.rewindMessageCount ?? 5
  const db = initSyncDatabase(options.targetSqlitePath)
  try {
    if (options.capAtSeq !== undefined) {
      db.query("DELETE FROM message WHERE session_id = ? AND seq > ?").run(options.rootSessionId, options.capAtSeq)
      db.query("DELETE FROM tool_call WHERE session_id = ? AND seq > ?").run(options.rootSessionId, options.capAtSeq)
      db.query("DELETE FROM snapshot_artifact WHERE session_id = ? AND seq > ?").run(
        options.rootSessionId,
        options.capAtSeq,
      )
    }

    const tailMsgs = db
      .query("SELECT seq, id, t FROM message WHERE session_id = ? ORDER BY seq DESC LIMIT ?")
      .all(options.rootSessionId, rewindCount + 1) as Array<{ seq: number; id: string; t: number }>

    if (tailMsgs.length <= rewindCount) {
      throw new Error(`Not enough messages in ${options.rootSessionId} to rewind by ${rewindCount}`)
    }

    const tipMsg = tailMsgs[0]!
    const anchorMsg = tailMsgs[rewindCount]!

    const latestChildWm = db
      .query(
        "SELECT session_id, last_kv_updated FROM sync_watermark WHERE root_id = ? AND session_id != ? AND last_kv_updated > 0 ORDER BY last_kv_updated DESC LIMIT 1",
      )
      .get(options.rootSessionId, options.rootSessionId) as { session_id: string; last_kv_updated: number } | null

    const tx = db.transaction(() => {
      db.query("DELETE FROM message WHERE session_id = ? AND seq > ?").run(options.rootSessionId, anchorMsg.seq)
      db.query("DELETE FROM tool_call WHERE session_id = ? AND seq > ?").run(options.rootSessionId, anchorMsg.seq)
      db.query("DELETE FROM snapshot_artifact WHERE session_id = ? AND seq > ?").run(
        options.rootSessionId,
        anchorMsg.seq,
      )
      db.query("DELETE FROM spill_artifact WHERE session_id = ? AND seq > ?").run(
        options.rootSessionId,
        anchorMsg.seq,
      )

      const remainingCount = (
        db.query("SELECT COUNT(*) as c FROM message WHERE session_id = ?").get(options.rootSessionId) as { c: number }
      ).c
      db.query("UPDATE session SET message_count = ?, t_updated = ? WHERE id = ?").run(
        remainingCount,
        anchorMsg.t,
        options.rootSessionId,
      )
      db.query(
        "UPDATE sync_watermark SET last_time_updated = ?, last_max_seq = ?, last_message_id = ? WHERE session_id = ?",
      ).run(anchorMsg.t, anchorMsg.seq, anchorMsg.id, options.rootSessionId)

      if (latestChildWm) {
        db.query("UPDATE sync_watermark SET last_kv_updated = ? WHERE session_id = ?").run(
          latestChildWm.last_kv_updated - 1,
          latestChildWm.session_id,
        )
      }
    })
    tx.immediate()

    return {
      rewoundFromSeq: tipMsg.seq,
      rewoundToSeq: anchorMsg.seq,
      rewoundToMessageId: anchorMsg.id,
      rewoundToTimeUpdated: anchorMsg.t,
      rewoundKvSessionId: latestChildWm?.session_id ?? "",
      rewoundKvFromUpdated: latestChildWm?.last_kv_updated ?? 0,
    }
  } finally {
    db.close()
  }
}

export class SubstrateSyncCoordinator {
  private readonly workingSetBySession = new Map<string, WorkingMemorySnapshot>()
  private contextHookSqliteQueries = 0
  private nonIdleEventsIgnored = 0

  constructor(
    private readonly config: {
      readonly hostDbPath: string
      readonly opencodeDataDir: string
      readonly targetSqlitePath: string
      readonly targetBlobDir: string
      readonly keepRecentSteps?: number
    },
  ) {}

  public getSqliteQueriesInContextHook(): number {
    return this.contextHookSqliteQueries
  }

  public getNonIdleIgnoredCount(): number {
    return this.nonIdleEventsIgnored
  }

  public getWorkingSetSnapshot(sessionId: string): WorkingMemorySnapshot | undefined {
    return this.workingSetBySession.get(sessionId)
  }

  public onContextHook(
    sessionId: string,
    activeMessages: readonly { readonly id: string; readonly seq: number; readonly kind: string; readonly toolCount?: number }[],
  ): ContextHookResult {
    const t0 = performance.now()
    const keepRecent = this.config.keepRecentSteps ?? 8
    const assistantSteps = activeMessages.filter((m) => m.kind === "assistant")
    const watermarkIdx = Math.max(0, assistantSteps.length - keepRecent)
    const stepWatermarkSeq = assistantSteps[watermarkIdx]?.seq ?? 0

    let activeBreadcrumbCount = 0
    for (const m of activeMessages) {
      if (m.seq < stepWatermarkSeq && (m.toolCount ?? 0) > 0) {
        activeBreadcrumbCount += m.toolCount ?? 0
      }
    }

    const cached = this.workingSetBySession.get(sessionId)
    const manifestHeader = cached
      ? `[WorkingMemoryManifest root=${cached.rootId} synced_msg=${cached.lastSyncedMessageId} step_watermark=${stepWatermarkSeq} breadcrumbs=${activeBreadcrumbCount} files=${cached.manifestFilePaths.length}]`
      : `[WorkingMemoryManifest session=${sessionId} unhydrated=true step_watermark=${stepWatermarkSeq} breadcrumbs=${activeBreadcrumbCount}]`

    const elapsedMs = performance.now() - t0
    return {
      sessionId,
      elapsedMs,
      sqliteQueriesExecuted: this.contextHookSqliteQueries,
      injectedManifestHeader: manifestHeader,
      activeBreadcrumbCount,
      stepWatermarkSeq,
    }
  }

  public onSessionStatus(event: {
    readonly sessionID: string
    readonly status: "idle" | "running" | "busy"
    readonly hostDb?: Database
  }): SyncExecutionReport | null {
    if (event.status !== "idle") {
      this.nonIdleEventsIgnored++
      return null
    }
    const report = syncSessionTreeIncremental({
      sessionID: event.sessionID,
      hostDbPath: this.config.hostDbPath,
      hostDb: event.hostDb,
      opencodeDataDir: this.config.opencodeDataDir,
      targetSqlitePath: this.config.targetSqlitePath,
      targetBlobDir: this.config.targetBlobDir,
    })
    this.refreshInMemorySnapshot(event.sessionID, report.rootSessionId)
    return report
  }

  public onCompaction(event: {
    readonly sessionID: string
    readonly reason: string
    readonly hostDb?: Database
  }): SyncExecutionReport {
    const report = syncSessionTreeIncremental({
      sessionID: event.sessionID,
      hostDbPath: this.config.hostDbPath,
      hostDb: event.hostDb,
      opencodeDataDir: this.config.opencodeDataDir,
      targetSqlitePath: this.config.targetSqlitePath,
      targetBlobDir: this.config.targetBlobDir,
    })
    this.refreshInMemorySnapshot(event.sessionID, report.rootSessionId)
    return report
  }

  private refreshInMemorySnapshot(sessionId: string, rootId: string): void {
    const db = new Database(this.config.targetSqlitePath, { readonly: true })
    try {
      const wm = db
        .query("SELECT last_max_seq, last_message_id FROM sync_watermark WHERE session_id = ?")
        .get(sessionId) as { last_max_seq: number; last_message_id: string } | null
      const snapPaths = db
        .query("SELECT DISTINCT path FROM snapshot_artifact WHERE session_id = ? ORDER BY path LIMIT 25")
        .all(sessionId) as Array<{ path: string }>
      const toolCount = (
        db.query("SELECT COUNT(*) as c FROM tool_call WHERE session_id = ?").get(sessionId) as { c: number } | null
      )?.c ?? 0

      this.workingSetBySession.set(sessionId, {
        sessionId,
        rootId,
        stepWatermarkSeq: wm?.last_max_seq ?? 0,
        lastSyncedMessageId: wm?.last_message_id ?? "",
        activeBreadcrumbCount: toolCount,
        manifestFilePaths: snapPaths.map((p) => p.path),
        updatedAtMs: Date.now(),
      })
    } finally {
      db.close()
    }
  }
}

export function inspectHostQueryPlans(hostDbPath = "/Users/MAC/.local/share/opencode/opencode.db"): QueryPlanInspection {
  const sizeBytes = statSync(hostDbPath).size
  const db = new Database(hostDbPath, { readonly: true })
  try {
    const explain = (sql: string, ...params: (string | number)[]): string[] =>
      (db.query(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>).map((r) => r.detail)

    const sessionByIdPlan = explain("SELECT * FROM session_v2 WHERE id = ?", "ses_eb23bfbf0ffesn5kT0yJI06h35")
    const sessionByParentIdPlan = explain(
      "SELECT * FROM session_v2 WHERE parent_id = ? ORDER BY time_created, id",
      "ses_eb23bfbf0ffesn5kT0yJI06h35",
    )
    const recursiveTreePlan = explain(
      `WITH RECURSIVE tree AS (
        SELECT * FROM session_v2 WHERE id = ?
        UNION ALL
        SELECT s.* FROM session_v2 s JOIN tree t ON s.parent_id = t.id
      ) SELECT * FROM tree`,
      "ses_eb23bfbf0ffesn5kT0yJI06h35",
    )
    const messageBySessionIdPlan = explain(
      "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq",
      "ses_eb23bfbf0ffesn5kT0yJI06h35",
    )
    const messageBySessionAndSeqDeltaPlan = explain(
      "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq ASC",
      "ses_eb23bfbf0ffesn5kT0yJI06h35",
      4347,
    )
    const kvByPrimaryKeyPlan = explain(
      "SELECT key, value, time_created, time_updated FROM kv WHERE key = ? AND time_updated > ?",
      `${HIVEMIND_PLUGIN_HEX}:bindings/ses_eb2380061ffe43a9MAykqZYTQb`,
      0,
    )
    const kvByTimeUpdatedScanPlan = explain("SELECT key, value FROM kv WHERE time_updated > ?", 1790000000000)

    const sCount = (db.query("SELECT COUNT(*) as c FROM session_v2").get() as { c: number }).c
    const mCount = (db.query("SELECT COUNT(*) as c FROM session_message").get() as { c: number }).c
    const kvCount = (db.query("SELECT COUNT(*) as c FROM kv").get() as { c: number }).c

    return {
      hostDbSizeBytes: sizeBytes,
      hostDbSizeGiB: Number((sizeBytes / 1024 ** 3).toFixed(2)),
      hostDbSizeGB: Number((sizeBytes / 1000 ** 3).toFixed(2)),
      sessionV2TotalRows: sCount,
      sessionMessageTotalRows: mCount,
      kvTotalRows: kvCount,
      sessionByIdPlan,
      sessionByParentIdPlan,
      recursiveTreePlan,
      messageBySessionIdPlan,
      messageBySessionAndSeqDeltaPlan,
      kvByPrimaryKeyPlan,
      kvByTimeUpdatedScanPlan,
      hasSessionParentIndex: sessionByParentIdPlan.some((d) => d.includes("USING INDEX session_v2_parent_idx")),
      hasMessageSessionSeqIndex: messageBySessionAndSeqDeltaPlan.some((d) =>
        d.includes("USING INDEX session_message_session_seq_idx"),
      ),
      hasKvPrimaryKeyIndex: kvByPrimaryKeyPlan.some((d) => d.includes("USING INDEX sqlite_autoindex_kv_1")),
      hasKvTimeUpdatedIndex: kvByTimeUpdatedScanPlan.some((d) => d.includes("USING INDEX")),
    }
  } finally {
    db.close()
  }
}

export async function verifyWalConcurrency(options: {
  readonly targetSqlitePath: string
  readonly childProcessLanes?: number
  readonly opsPerChildLane?: number
  readonly inProcessLanes?: number
  readonly opsPerInProcessLane?: number
}): Promise<WalConcurrencyReport> {
  const t0 = performance.now()
  const childLanes = options.childProcessLanes ?? 4
  const opsPerChild = options.opsPerChildLane ?? 12
  const inProcLanes = options.inProcessLanes ?? 2
  const opsPerInProc = options.opsPerInProcessLane ?? 10

  const initDb = initSyncDatabase(options.targetSqlitePath)
  const pragmas = configureWalPragmas(initDb)
  initDb.query("DELETE FROM wal_concurrency_probe").run()
  initDb.close()

  const childWorkerScript = `
import { Database } from "bun:sqlite";
const [dbPath, laneStr, opsStr] = Bun.argv.slice(1);
const lane = Number(laneStr);
const ops = Number(opsStr);
const t0 = performance.now();
const db = new Database(dbPath);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");

const insProbe = db.query("INSERT OR REPLACE INTO wal_concurrency_probe (probe_id, lane, op_index, worker_kind, updated_at) VALUES (?, ?, ?, 'child_process', ?)");
const updWatermark = db.query("INSERT OR REPLACE INTO sync_watermark (session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at) VALUES (?, 'ses_wal_concurrency_root', ?, ?, ?, ?, ?)");
const readWatermark = db.query("SELECT COUNT(*) as c FROM sync_watermark WHERE root_id = 'ses_wal_concurrency_root' OR root_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'");
const readProbes = db.query("SELECT COUNT(*) as c FROM wal_concurrency_probe WHERE lane = ?");

const writeTx = db.transaction((opIndex: number, now: number) => {
  insProbe.run(\`proc-\${lane}-\${opIndex}\`, lane, opIndex, now);
  updWatermark.run(\`ses_wal_lane_\${lane}\`, now, opIndex, \`msg_lane_\${lane}_\${opIndex}\`, now, new Date(now).toISOString());
});

let busyErrors = 0;
let otherErrors = 0;
let completedWrites = 0;
let completedReads = 0;

for (let i = 0; i < ops; i++) {
  try {
    writeTx.immediate(i, Date.now());
    completedWrites++;
    const r1 = readWatermark.get() as { c: number };
    const r2 = readProbes.get(lane) as { c: number };
    if (r1.c >= 0 && r2.c > 0) completedReads++;
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes("SQLITE_BUSY") || msg.includes("database is locked")) {
      busyErrors++;
    } else {
      otherErrors++;
    }
  }
}
db.close();
console.log(JSON.stringify({
  lane,
  processType: "child_process",
  busyErrors,
  otherErrors,
  completedWrites,
  completedReads,
  elapsedMs: performance.now() - t0,
}));
`

  const childTasks = Array.from({ length: childLanes }, (_, lane) => {
    const proc = Bun.spawn(["bun", "-e", childWorkerScript, options.targetSqlitePath, String(lane), String(opsPerChild)], {
      stdout: "pipe",
      stderr: "pipe",
    })
    return (async (): Promise<WalWorkerLaneResult> => {
      const stdout = await new Response(proc.stdout).text()
      const stderr = await new Response(proc.stderr).text()
      const code = await proc.exited
      if (code !== 0) {
        throw new Error(`WAL child worker lane ${lane} exited with ${code}: ${stderr}`)
      }
      return JSON.parse(stdout.trim()) as WalWorkerLaneResult
    })()
  })

  const inProcessTasks = Array.from({ length: inProcLanes }, async (_, idx): Promise<WalWorkerLaneResult> => {
    const lane = childLanes + idx
    const laneStart = performance.now()
    const db = new Database(options.targetSqlitePath)
    configureWalPragmas(db)

    const insProbe = db.query(
      "INSERT OR REPLACE INTO wal_concurrency_probe (probe_id, lane, op_index, worker_kind, updated_at) VALUES (?, ?, ?, 'in_process', ?)",
    )
    const readSessions = db.query("SELECT COUNT(*) as c FROM session")
    const readProbes = db.query("SELECT COUNT(*) as c FROM wal_concurrency_probe WHERE lane = ?")
    const writeTx = db.transaction((opIndex: number, now: number) => {
      insProbe.run(`inproc-${lane}-${opIndex}`, lane, opIndex, now)
    })

    let busyErrors = 0
    let otherErrors = 0
    let completedWrites = 0
    let completedReads = 0

    try {
      for (let i = 0; i < opsPerInProc; i++) {
        await Bun.sleep(1)
        try {
          writeTx.immediate(i, Date.now())
          completedWrites++
          const s = readSessions.get() as { c: number }
          const p = readProbes.get(lane) as { c: number }
          if (s.c >= 0 && p.c > 0) completedReads++
        } catch (err: unknown) {
          const msg = String((err as Error)?.message ?? err)
          if (msg.includes("SQLITE_BUSY") || msg.includes("database is locked")) {
            busyErrors++
          } else {
            otherErrors++
          }
        }
      }
    } finally {
      db.close()
    }

    return {
      lane,
      processType: "in_process",
      busyErrors,
      otherErrors,
      completedWrites,
      completedReads,
      elapsedMs: performance.now() - laneStart,
    }
  })

  const laneResults = await Promise.all([...childTasks, ...inProcessTasks])

  const cleanDb = initSyncDatabase(options.targetSqlitePath)
  cleanDb.query("DELETE FROM sync_watermark WHERE root_id = 'ses_wal_concurrency_root'").run()
  cleanDb.close()

  const totalWrites = laneResults.reduce((acc, r) => acc + r.completedWrites, 0)
  const totalReads = laneResults.reduce((acc, r) => acc + r.completedReads, 0)
  const totalBusyErrors = laneResults.reduce((acc, r) => acc + r.busyErrors, 0)
  const totalOtherErrors = laneResults.reduce((acc, r) => acc + r.otherErrors, 0)

  return {
    journalMode: pragmas.journalMode,
    synchronousMode: pragmas.synchronousMode,
    busyTimeoutMs: pragmas.busyTimeoutMs,
    totalOperations: totalWrites + totalReads,
    totalWrites,
    totalReads,
    totalBusyErrors,
    totalOtherErrors,
    laneResults,
    elapsedMs: performance.now() - t0,
  }
}

const summarizeTrials = (
  treatment: BenchmarkTreatmentSummary["treatment"],
  reports: readonly SyncExecutionReport[],
): BenchmarkTreatmentSummary => {
  const times = reports.map((r) => Number(r.elapsedMs.toFixed(3)))
  const sorted = [...times].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianMs =
    sorted.length % 2 === 1 ? sorted[mid]! : Number(((sorted[mid - 1]! + sorted[mid]!) / 2).toFixed(3))
  const minMs = sorted[0] ?? 0
  const maxMs = sorted[sorted.length - 1] ?? 0
  const meanMs = Number((times.reduce((a, b) => a + b, 0) / Math.max(1, times.length)).toFixed(3))
  const spreadMs = Number((maxMs - minMs).toFixed(3))
  const sample0 = reports[0]!

  return {
    treatment,
    samples: reports.length,
    medianMs,
    minMs,
    maxMs,
    meanMs,
    spreadMs,
    rowsProcessedPerRun: sample0?.messagesProcessed ?? 0,
    kvRowsProcessedPerRun: sample0?.kvRowsProcessed ?? 0,
    snapshotsExtractedPerRun: sample0?.snapshotsExtracted ?? 0,
    sqliteWritesPerRun: sample0?.sqliteWrites ?? 0,
    errorCount: reports.reduce((acc, r) => acc + r.errorCount, 0),
    trialElapsedMs: times,
  }
}

export function runInterleavedBenchmark(options?: {
  readonly hostDbPath?: string
  readonly opencodeDataDir?: string
  readonly rounds?: number
  readonly rootSessionId?: string
}): InterleavedBenchmarkReport {
  const opencodeDataDir = options?.opencodeDataDir ?? "/Users/MAC/.local/share/opencode"
  const hostDbPath = options?.hostDbPath ?? path.join(opencodeDataDir, "opencode.db")
  const rounds = options?.rounds ?? 7
  const rootSessionId = options?.rootSessionId ?? "ses_eb23bfbf0ffesn5kT0yJI06h35"

  const benchRoot = mkdtempSync(path.join(os.tmpdir(), "wf-sub-04-bench-"))
  const hostDb = new Database(hostDbPath, { readonly: true })

  try {
    const coldSqlitePath = path.join(benchRoot, "cold.sqlite")
    const coldBlobDir = path.join(benchRoot, "cold-blobs")
    const warmSqlitePath = path.join(benchRoot, "warm.sqlite")
    const warmBlobDir = path.join(benchRoot, "warm-blobs")
    const snapDeltaSqlitePath = path.join(benchRoot, "snap-delta.sqlite")
    const snapDeltaBlobDir = path.join(benchRoot, "snap-delta-blobs")

    syncSessionTreeFullBaseline({
      sessionID: rootSessionId,
      hostDb,
      opencodeDataDir,
      targetSqlitePath: warmSqlitePath,
      targetBlobDir: warmBlobDir,
    })
    syncSessionTreeFullBaseline({
      sessionID: rootSessionId,
      hostDb,
      opencodeDataDir,
      targetSqlitePath: snapDeltaSqlitePath,
      targetBlobDir: snapDeltaBlobDir,
    })

    const coldReports: SyncExecutionReport[] = []
    const noopReports: SyncExecutionReport[] = []
    const deltaReports: SyncExecutionReport[] = []
    const deltaSnapReports: SyncExecutionReport[] = []

    const runColdTrial = () => {
      rmSync(coldSqlitePath, { force: true })
      rmSync(`${coldSqlitePath}-wal`, { force: true })
      rmSync(`${coldSqlitePath}-shm`, { force: true })
      rmSync(coldBlobDir, { recursive: true, force: true })
      coldReports.push(
        syncSessionTreeFullBaseline({
          sessionID: rootSessionId,
          hostDb,
          opencodeDataDir,
          targetSqlitePath: coldSqlitePath,
          targetBlobDir: coldBlobDir,
        }),
      )
    }

    const runNoopTrial = () => {
      noopReports.push(
        syncSessionTreeIncremental({
          sessionID: rootSessionId,
          hostDb,
          opencodeDataDir,
          targetSqlitePath: warmSqlitePath,
          targetBlobDir: warmBlobDir,
        }),
      )
    }

    const runDelta1TurnTrial = () => {
      rewindWatermarkForDeltaTurn({
        targetSqlitePath: warmSqlitePath,
        rootSessionId,
        rewindMessageCount: 5,
      })
      deltaReports.push(
        syncSessionTreeIncremental({
          sessionID: rootSessionId,
          hostDb,
          opencodeDataDir,
          targetSqlitePath: warmSqlitePath,
          targetBlobDir: warmBlobDir,
        }),
      )
    }

    const runDeltaWithSnapshotTrial = () => {
      rewindWatermarkForDeltaTurn({
        targetSqlitePath: snapDeltaSqlitePath,
        rootSessionId,
        rewindMessageCount: 5,
        capAtSeq: 4281,
      })
      deltaSnapReports.push(
        syncSessionTreeIncremental({
          sessionID: rootSessionId,
          hostDb,
          opencodeDataDir,
          targetSqlitePath: snapDeltaSqlitePath,
          targetBlobDir: snapDeltaBlobDir,
          scope: { maxRootSeq: 4281 },
        }),
      )
    }

    for (let r = 0; r < rounds; r++) {
      if (r % 2 === 0) {
        runColdTrial()
        runNoopTrial()
        runDelta1TurnTrial()
        runDeltaWithSnapshotTrial()
      } else {
        runDeltaWithSnapshotTrial()
        runDelta1TurnTrial()
        runNoopTrial()
        runColdTrial()
      }
    }

    const pinnedSqlitePath = path.join(benchRoot, "pinned-287.sqlite")
    const pinnedBlobDir = path.join(benchRoot, "pinned-287-blobs")
    const pinnedScope: TreeScopeOptions = { maxRootMessages: 287, maxChildSessions: 9 }

    const pinnedCold = syncSessionTreeFullBaseline({
      sessionID: rootSessionId,
      hostDb,
      opencodeDataDir,
      targetSqlitePath: pinnedSqlitePath,
      targetBlobDir: pinnedBlobDir,
      scope: pinnedScope,
    })
    const pinnedNoop = syncSessionTreeIncremental({
      sessionID: rootSessionId,
      hostDb,
      opencodeDataDir,
      targetSqlitePath: pinnedSqlitePath,
      targetBlobDir: pinnedBlobDir,
      scope: pinnedScope,
    })
    rewindWatermarkForDeltaTurn({
      targetSqlitePath: pinnedSqlitePath,
      rootSessionId,
      rewindMessageCount: 5,
      capAtSeq: 3193,
    })
    const pinnedDelta = syncSessionTreeIncremental({
      sessionID: rootSessionId,
      hostDb,
      opencodeDataDir,
      targetSqlitePath: pinnedSqlitePath,
      targetBlobDir: pinnedBlobDir,
      scope: { maxRootMessages: 287, maxChildSessions: 9, maxRootSeq: 3193 },
    })

    const coldSummary = summarizeTrials("cold_full_tree", coldReports)
    const noopSummary = summarizeTrials("warm_noop_watermark", noopReports)
    const deltaSummary = summarizeTrials("incremental_1turn_5msg_1kv", deltaReports)
    const deltaSnapSummary = summarizeTrials("incremental_1turn_5msg_1kv_with_snapshot", deltaSnapReports)

    return {
      rootSessionId,
      rounds,
      coldFullTree: coldSummary,
      warmNoopWatermark: noopSummary,
      incremental1Turn5Msg1Kv: deltaSummary,
      incremental1Turn5Msg1KvWithSnapshot: deltaSnapSummary,
      pinned287CheckpointColdMs: Number(pinnedCold.elapsedMs.toFixed(3)),
      pinned287CheckpointNoopMs: Number(pinnedNoop.elapsedMs.toFixed(3)),
      pinned287CheckpointDeltaMs: Number(pinnedDelta.elapsedMs.toFixed(3)),
      speedupNoopVsCold: Number((coldSummary.medianMs / Math.max(0.001, noopSummary.medianMs)).toFixed(1)),
      speedupIncrementalVsCold: Number((coldSummary.medianMs / Math.max(0.001, deltaSummary.medianMs)).toFixed(1)),
      speedupIncrementalWithSnapVsCold: Number(
        (coldSummary.medianMs / Math.max(0.001, deltaSnapSummary.medianMs)).toFixed(1),
      ),
    }
  } finally {
    hostDb.close()
    rmSync(benchRoot, { recursive: true, force: true })
  }
}

export interface WfSub04PrototypeReport {
  readonly sqlitePath: string
  readonly blobDir: string
  readonly queryPlanInspection: QueryPlanInspection
  readonly p2SyncReport: SyncExecutionReport
  readonly p1SyncReport: SyncExecutionReport
  readonly p2NoopReport: SyncExecutionReport
  readonly p2Delta1TurnReport: SyncExecutionReport
  readonly lifecycleHookReport: LifecycleHookReport
  readonly walConcurrencyReport: WalConcurrencyReport
  readonly benchmarkReport: InterleavedBenchmarkReport
}

export async function runWfSub04Prototype(options?: {
  readonly hostDbPath?: string
  readonly opencodeDataDir?: string
  readonly targetSqlitePath?: string
  readonly targetBlobDir?: string
  readonly benchmarkRounds?: number
}): Promise<WfSub04PrototypeReport> {
  const opencodeDataDir = options?.opencodeDataDir ?? "/Users/MAC/.local/share/opencode"
  const hostDbPath = options?.hostDbPath ?? path.join(opencodeDataDir, "opencode.db")
  const targetSqlitePath =
    options?.targetSqlitePath ??
    "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-sync.sqlite"
  const targetBlobDir =
    options?.targetBlobDir ??
    "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-blobs"

  rmSync(targetSqlitePath, { force: true })
  rmSync(`${targetSqlitePath}-wal`, { force: true })
  rmSync(`${targetSqlitePath}-shm`, { force: true })
  rmSync(targetBlobDir, { recursive: true, force: true })

  const queryPlanInspection = inspectHostQueryPlans(hostDbPath)
  const hostDb = new Database(hostDbPath, { readonly: true })

  let p2SyncReport: SyncExecutionReport
  let p1SyncReport: SyncExecutionReport
  let p2NoopReport: SyncExecutionReport
  let p2Delta1TurnReport: SyncExecutionReport
  let lifecycleHookReport: LifecycleHookReport

  try {
    p2SyncReport = syncSessionTreeFullBaseline({
      sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      hostDb,
      opencodeDataDir,
      targetSqlitePath,
      targetBlobDir,
    })

    p1SyncReport = syncSessionTreeFullBaseline({
      sessionID: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
      hostDb,
      opencodeDataDir,
      targetSqlitePath,
      targetBlobDir,
    })

    p2NoopReport = syncSessionTreeIncremental({
      sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      hostDb,
      opencodeDataDir,
      targetSqlitePath,
      targetBlobDir,
    })

    rewindWatermarkForDeltaTurn({
      targetSqlitePath,
      rootSessionId: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      rewindMessageCount: 5,
    })
    p2Delta1TurnReport = syncSessionTreeIncremental({
      sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      hostDb,
      opencodeDataDir,
      targetSqlitePath,
      targetBlobDir,
    })

    const coordinator = new SubstrateSyncCoordinator({
      hostDbPath,
      opencodeDataDir,
      targetSqlitePath,
      targetBlobDir,
      keepRecentSteps: 8,
    })

    coordinator.onSessionStatus({ sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35", status: "running", hostDb })
    coordinator.onSessionStatus({ sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35", status: "busy", hostDb })

    rewindWatermarkForDeltaTurn({
      targetSqlitePath,
      rootSessionId: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      rewindMessageCount: 5,
    })
    const idleHookReport = coordinator.onSessionStatus({
      sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      status: "idle",
      hostDb,
    })!

    const syntheticActiveMessages = Array.from({ length: 40 }, (_, i) => ({
      id: `msg_${i}`,
      seq: (i + 1) * 10,
      kind: i % 3 === 0 ? "user" : "assistant",
      toolCount: i % 2 === 0 ? 3 : 1,
    }))
    const contextHookResults: ContextHookResult[] = []
    for (let i = 0; i < 20; i++) {
      contextHookResults.push(coordinator.onContextHook("ses_eb23bfbf0ffesn5kT0yJI06h35", syntheticActiveMessages))
    }

    rewindWatermarkForDeltaTurn({
      targetSqlitePath,
      rootSessionId: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      rewindMessageCount: 5,
    })
    const compactionHookReport = coordinator.onCompaction({
      sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
      reason: "context_limit",
      hostDb,
    })

    lifecycleHookReport = {
      contextHookResults,
      maxContextHookMs: Number(Math.max(...contextHookResults.map((c) => c.elapsedMs)).toFixed(4)),
      totalContextHookSqliteQueries: coordinator.getSqliteQueriesInContextHook(),
      idleHookReport,
      compactionHookReport,
      nonIdleIgnoredCount: coordinator.getNonIdleIgnoredCount(),
    }
  } finally {
    hostDb.close()
  }

  const walConcurrencyReport = await verifyWalConcurrency({
    targetSqlitePath,
    childProcessLanes: 4,
    opsPerChildLane: 12,
    inProcessLanes: 2,
    opsPerInProcessLane: 10,
  })

  const benchmarkReport = runInterleavedBenchmark({
    hostDbPath,
    opencodeDataDir,
    rounds: options?.benchmarkRounds ?? 7,
    rootSessionId: "ses_eb23bfbf0ffesn5kT0yJI06h35",
  })

  return {
    sqlitePath: targetSqlitePath,
    blobDir: targetBlobDir,
    queryPlanInspection,
    p2SyncReport,
    p1SyncReport,
    p2NoopReport,
    p2Delta1TurnReport,
    lifecycleHookReport,
    walConcurrencyReport,
    benchmarkReport,
  }
}

if (import.meta.main) {
  const report = await runWfSub04Prototype()
  console.log(JSON.stringify(report, null, 2))
}
