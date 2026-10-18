import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import type {
  DelegationTurnRow,
  FileReadLedgerRow,
  FileTouchRow,
  Harness,
  KvBindingRow,
  KvContextPruneRow,
  KvForeignIndexRow,
  ProvenanceChainRow,
  SkillLoadLedgerRow,
  SnapshotArtifactRow,
  SpillArtifactRow,
  SyncWatermarkRow,
} from "./types.ts"

export interface IndexSessionRow {
  readonly id: string
  readonly project_id: string
  readonly parent_id: string | null
  readonly depth: number
  readonly lane_kind: string
  readonly lane_path: string
  readonly title: string | null
  readonly agent: string | null
  readonly provider: string | null
  readonly model_id: string | null
  readonly variant: string | null
  readonly harness: Harness
  readonly outcome: string | null
  readonly cost: number
  readonly tok_in: number
  readonly tok_out: number
  readonly tok_reason: number
  readonly tok_cache_r: number
  readonly tok_cache_w: number
  readonly files_changed: number | null
  readonly additions: number | null
  readonly deletions: number | null
  readonly t_created: number
  readonly t_updated: number
  readonly t_idle: number | null
  readonly t_compacting: number | null
  readonly t_archived: number | null
  readonly resume_attempts: number
  readonly message_count: number
  readonly transcript_path: string
}

export interface IndexDelegationRow {
  readonly call_id: string
  readonly parent_session: string
  readonly parent_message_id: string | null
  readonly child_session: string | null
  readonly tool: string | null
  readonly agent: string | null
  readonly harness: Harness | null
  readonly mode: "spawn" | "continue" | null
  readonly background: boolean | null
  readonly description: string | null
  readonly prompt_ref: string | null
  readonly status: string | null
  readonly t_created: number | null
  readonly t_completed: number | null
}

export interface IndexMessageRow {
  readonly session_id: string
  readonly seq: number
  readonly id: string
  readonly kind: string
  readonly t: number
  readonly agent: string | null
  readonly model_id: string | null
  readonly tok_in: number | null
  readonly tok_out: number | null
}

export interface IndexToolCallRow {
  readonly call_id: string
  readonly session_id: string
  readonly seq: number
  readonly name: string
  readonly status: string | null
  readonly duration_ms: number | null
  readonly truncated: boolean
  readonly output_path: string | null
}

export interface IndexCompactionRow {
  readonly session_id: string
  readonly seq: number
  readonly reason: string | null
  readonly status: string | null
  readonly summary_ref: string | null
  readonly tok_input: number | null
}

export interface IndexInstructionRow {
  readonly session_id: string
  readonly seq: number
  readonly path: string
  readonly blob_sha: string
}

export interface IndexInput {
  readonly rootID: string
  readonly sessionIDs: readonly string[]
  readonly sessions: readonly IndexSessionRow[]
  readonly delegations: readonly IndexDelegationRow[]
  readonly messages: readonly IndexMessageRow[]
  readonly toolCalls: readonly IndexToolCallRow[]
  readonly compactions: readonly IndexCompactionRow[]
  readonly instructions: readonly IndexInstructionRow[]
  readonly kvBindings?: readonly KvBindingRow[]
  readonly kvForeignIndex?: readonly KvForeignIndexRow[]
  readonly kvContextPrunes?: readonly KvContextPruneRow[]
  readonly delegationTurns?: readonly DelegationTurnRow[]
  readonly fileReads?: readonly FileReadLedgerRow[]
  readonly skillLoads?: readonly SkillLoadLedgerRow[]
  readonly fileTouches?: readonly FileTouchRow[]
  readonly snapshotArtifacts?: readonly SnapshotArtifactRow[]
  readonly spillArtifacts?: readonly SpillArtifactRow[]
  readonly provenanceChains?: readonly ProvenanceChainRow[]
  readonly watermarks?: readonly SyncWatermarkRow[]
  readonly fileCount?: number
}

export interface IncrementalIndexInput {
  readonly isCold: boolean
  readonly rootID: string
  readonly sessions: readonly IndexSessionRow[]
  readonly delegations: readonly IndexDelegationRow[]
  readonly messages: readonly IndexMessageRow[]
  readonly toolCalls: readonly IndexToolCallRow[]
  readonly compactions: readonly IndexCompactionRow[]
  readonly instructions: readonly IndexInstructionRow[]
  readonly kvBindings: readonly KvBindingRow[]
  readonly kvForeignIndex: readonly KvForeignIndexRow[]
  readonly kvContextPrunes: readonly KvContextPruneRow[]
  readonly delegationTurns: readonly DelegationTurnRow[]
  readonly fileReads: readonly FileReadLedgerRow[]
  readonly skillLoads: readonly SkillLoadLedgerRow[]
  readonly fileTouches: readonly FileTouchRow[]
  readonly snapshotArtifacts: readonly SnapshotArtifactRow[]
  readonly spillArtifacts: readonly SpillArtifactRow[]
  readonly provenanceChains?: readonly ProvenanceChainRow[]
  readonly watermarks: readonly SyncWatermarkRow[]
  readonly fileCount: number
}

export const DDL = `
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT '',
  parent_id TEXT,
  depth INTEGER NOT NULL DEFAULT 0,
  lane_kind TEXT NOT NULL DEFAULT 'root',
  lane_path TEXT NOT NULL DEFAULT '',
  title TEXT,
  agent TEXT,
  provider TEXT,
  model_id TEXT,
  variant TEXT,
  harness TEXT DEFAULT 'opencode',
  outcome TEXT,
  cost REAL DEFAULT 0,
  tok_in INTEGER DEFAULT 0,
  tok_out INTEGER DEFAULT 0,
  tok_reason INTEGER DEFAULT 0,
  tok_cache_r INTEGER DEFAULT 0,
  tok_cache_w INTEGER DEFAULT 0,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  t_created INTEGER DEFAULT 0,
  t_updated INTEGER DEFAULT 0,
  t_idle INTEGER,
  t_compacting INTEGER,
  t_archived INTEGER,
  resume_attempts INTEGER DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  transcript_path TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS delegation (
  call_id TEXT NOT NULL,
  root_id TEXT NOT NULL DEFAULT '',
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
  source_origin TEXT DEFAULT 'host_db'
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
  child_session_id TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'spawn',
  harness TEXT NOT NULL DEFAULT 'opencode',
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL DEFAULT 0,
  end_seq INTEGER NOT NULL DEFAULT 0,
  start_message_id TEXT NOT NULL DEFAULT '',
  end_message_id TEXT NOT NULL DEFAULT '',
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL DEFAULT 'clean',
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);
CREATE TABLE IF NOT EXISTS file_read_ledger (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL DEFAULT '',
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  read_seq INTEGER NOT NULL DEFAULT 0,
  line_range TEXT NOT NULL DEFAULT 'L1-L120',
  start_line INTEGER,
  end_line INTEGER,
  total_lines INTEGER,
  is_truncated INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  slice_sha TEXT,
  read_blob_sha TEXT NOT NULL DEFAULT '',
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'FRESH — DO NOT REREAD',
  t INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, path)
);
CREATE INDEX IF NOT EXISTS idx_file_read_ledger_session ON file_read_ledger(session_id, read_seq);
CREATE TABLE IF NOT EXISTS skill_load_ledger (
  session_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  call_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  loaded_seq INTEGER NOT NULL DEFAULT 0,
  load_seq INTEGER NOT NULL DEFAULT 0,
  chars INTEGER NOT NULL DEFAULT 0,
  char_len INTEGER NOT NULL DEFAULT 0,
  blob_sha TEXT NOT NULL DEFAULT '',
  blob_sha256 TEXT NOT NULL DEFAULT '',
  skill_blob_sha TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE — DO NOT RE-INVOKE',
  t INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_skill_load_ledger_session ON skill_load_ledger(session_id, load_seq);
CREATE TABLE IF NOT EXISTS file_touch (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  op TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  detail TEXT,
  t INTEGER NOT NULL,
  PRIMARY KEY (session_id, seq, call_id, path, op)
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
CREATE TABLE IF NOT EXISTS sync_watermark (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  last_time_updated INTEGER NOT NULL,
  last_max_seq INTEGER NOT NULL,
  last_message_id TEXT NOT NULL,
  last_kv_updated INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_watermark_root ON sync_watermark(root_id);
CREATE TABLE IF NOT EXISTS sync_root_meta (
  root_id TEXT PRIMARY KEY,
  file_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS provenance_chain (
  chain_id TEXT PRIMARY KEY,
  root_session_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  finding_id TEXT NOT NULL DEFAULT '',
  finding_seq INTEGER NOT NULL DEFAULT 0,
  finding_session_id TEXT NOT NULL DEFAULT '',
  finding_summary TEXT NOT NULL DEFAULT '',
  child_session_id TEXT,
  intent_seq INTEGER NOT NULL DEFAULT 0,
  intent_message_id TEXT NOT NULL DEFAULT '',
  intent_summary TEXT NOT NULL DEFAULT '',
  decision_seq INTEGER,
  decision_pivot_seq INTEGER,
  decision_summary TEXT,
  target_path TEXT NOT NULL DEFAULT '',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  read_or_review_blob_sha TEXT NOT NULL DEFAULT '',
  repair_seq INTEGER,
  repair_session_id TEXT,
  repair_blob_sha TEXT,
  receipt_command TEXT,
  verification_command TEXT,
  receipt_exit_code INTEGER,
  verification_exit_code INTEGER,
  verification_seq INTEGER,
  receipt_blob_sha TEXT,
  verification_blob_ref TEXT,
  head_sha TEXT,
  worktree_tree_sha TEXT,
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'VERIFIED_FRESH',
  outcome TEXT NOT NULL DEFAULT 'VERIFIED_PASS',
  created_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_session ON provenance_chain(root_session_id);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_target ON provenance_chain(root_session_id, target_path);
CREATE TABLE IF NOT EXISTS compaction_continuation_ledger (
  session_id TEXT NOT NULL,
  compaction_seq INTEGER NOT NULL,
  compaction_reason TEXT NOT NULL DEFAULT 'auto',
  reason TEXT NOT NULL DEFAULT 'auto',
  tok_input INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL DEFAULT '',
  verification_gate_status TEXT NOT NULL DEFAULT 'in_progress_or_unverified',
  packet_markdown TEXT NOT NULL DEFAULT '',
  packet_chars INTEGER NOT NULL DEFAULT 0,
  packet_tokens INTEGER NOT NULL DEFAULT 0,
  summary_hash TEXT,
  fresh_files_count INTEGER NOT NULL DEFAULT 0,
  stale_files_count INTEGER NOT NULL DEFAULT 0,
  active_skills_count INTEGER NOT NULL DEFAULT 0,
  provenance_chains_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, compaction_seq)
);
CREATE TABLE IF NOT EXISTS session_semantic_digest (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL DEFAULT '',
  headline TEXT NOT NULL DEFAULT '',
  intent_pivots_json TEXT NOT NULL DEFAULT '[]',
  touched_files_json TEXT NOT NULL DEFAULT '[]',
  key_decisions_json TEXT NOT NULL DEFAULT '[]',
  verification_state TEXT NOT NULL DEFAULT 'in_progress_or_unverified'
);
CREATE INDEX IF NOT EXISTS idx_semantic_digest_root ON session_semantic_digest(root_id);
CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  t TEXT NOT NULL DEFAULT '',
  prompt_excerpt TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  prompt_blob_ref TEXT,
  pivot_kind TEXT NOT NULL DEFAULT 'followup'
);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_session_seq ON intent_pivot(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_blob_ref ON intent_pivot(blob_ref);
CREATE TABLE IF NOT EXISTS milestone (
  id TEXT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'decision',
  summary TEXT,
  text TEXT,
  prompt_text TEXT,
  blob_ref TEXT,
  reported_outcome TEXT,
  verified_outcome TEXT,
  t INTEGER,
  PRIMARY KEY (session_id, seq, kind)
);
CREATE VIRTUAL TABLE IF NOT EXISTS substrate_fts USING fts5(
  session_id,
  kind,
  symbol_or_path,
  body,
  tokenize = 'porter unicode61'
);
CREATE TABLE IF NOT EXISTS code_file (
  path TEXT PRIMARY KEY,
  blob_sha TEXT NOT NULL DEFAULT '',
  loc INTEGER NOT NULL DEFAULT 0,
  raw_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_tokens INTEGER NOT NULL DEFAULT 0,
  skeleton_text TEXT NOT NULL DEFAULT '',
  pagerank REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS code_symbol (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'function',
  depth INTEGER NOT NULL DEFAULT 1,
  parent_symbol TEXT,
  exported INTEGER NOT NULL DEFAULT 0,
  start_line INTEGER NOT NULL DEFAULT 1,
  end_line INTEGER NOT NULL DEFAULT 1,
  signature TEXT NOT NULL DEFAULT '',
  blob_sha TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, start_line, qualified_name)
);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_name ON code_symbol(path, name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_parent ON code_symbol(path, parent_symbol);
CREATE TABLE IF NOT EXISTS code_import_edge (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  specifier TEXT NOT NULL DEFAULT '',
  symbols_json TEXT NOT NULL DEFAULT '[]',
  specifiers_json TEXT NOT NULL DEFAULT '[]',
  is_type_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_path, to_path)
);
CREATE INDEX IF NOT EXISTS idx_code_import_edge_to ON code_import_edge(to_path);
CREATE TABLE IF NOT EXISTS git_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  co_commits INTEGER NOT NULL DEFAULT 0,
  commits_a INTEGER NOT NULL DEFAULT 0,
  commits_b INTEGER NOT NULL DEFAULT 0,
  prob_a_given_b REAL NOT NULL DEFAULT 0,
  prob_b_given_a REAL NOT NULL DEFAULT 0,
  jaccard REAL NOT NULL DEFAULT 0,
  has_static_edge INTEGER NOT NULL DEFAULT 0,
  recent_subjects_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (file_a, file_b)
);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_a ON git_cochange(file_a);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_b ON git_cochange(file_b);
CREATE INDEX IF NOT EXISTS idx_git_cochange_hidden ON git_cochange(has_static_edge, co_commits DESC);
CREATE TABLE IF NOT EXISTS git_cochange_file_stats (
  path TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS git_cochange_commit (
  hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL DEFAULT '',
  files_json TEXT NOT NULL DEFAULT '[]',
  applied_at INTEGER NOT NULL DEFAULT 0
);
`

export const SCHEMA_DDL = DDL

const FILE_READ_LEDGER_MIGRATION_COLS: ReadonlyArray<readonly [string, string]> = [
  ["start_line", "INTEGER"],
  ["end_line", "INTEGER"],
  ["total_lines", "INTEGER"],
  ["is_truncated", "INTEGER DEFAULT 0"],
  ["slice_sha", "TEXT"],
]

const PROVENANCE_CHAIN_MIGRATION_COLS: ReadonlyArray<readonly [string, string]> = [
  ["session_id", "TEXT NOT NULL DEFAULT ''"],
  ["finding_seq", "INTEGER NOT NULL DEFAULT 0"],
  ["finding_session_id", "TEXT NOT NULL DEFAULT ''"],
  ["finding_summary", "TEXT NOT NULL DEFAULT ''"],
  ["child_session_id", "TEXT"],
  ["intent_seq", "INTEGER NOT NULL DEFAULT 0"],
  ["intent_message_id", "TEXT NOT NULL DEFAULT ''"],
  ["intent_summary", "TEXT NOT NULL DEFAULT ''"],
  ["decision_seq", "INTEGER"],
  ["decision_summary", "TEXT"],
  ["touched_files_json", "TEXT NOT NULL DEFAULT '[]'"],
  ["verification_seq", "INTEGER"],
  ["outcome", "TEXT NOT NULL DEFAULT 'VERIFIED_PASS'"],
  ["created_at", "INTEGER NOT NULL DEFAULT 0"],
  ["decision_pivot_seq", "INTEGER"],
  ["read_or_review_blob_sha", "TEXT NOT NULL DEFAULT ''"],
  ["repair_seq", "INTEGER"],
  ["repair_session_id", "TEXT"],
  ["repair_blob_sha", "TEXT"],
  ["receipt_command", "TEXT"],
  ["verification_command", "TEXT"],
  ["receipt_exit_code", "INTEGER"],
  ["verification_exit_code", "INTEGER"],
  ["receipt_blob_sha", "TEXT"],
  ["verification_blob_ref", "TEXT"],
  ["head_sha", "TEXT"],
  ["worktree_tree_sha", "TEXT"],
  ["disk_blob_sha", "TEXT NOT NULL DEFAULT ''"],
  ["staleness_status", "TEXT NOT NULL DEFAULT 'VERIFIED_FRESH'"],
  ["updated_at", "TEXT NOT NULL DEFAULT ''"],
]

export function ensureHoneycombSchema(db: Database): void {
  db.exec(DDL)
  const existingCols = new Set(
    (db.query("PRAGMA table_info(file_read_ledger)").all() as Array<{ name: string }>).map((c) => c.name),
  )
  for (const [colName, colDef] of FILE_READ_LEDGER_MIGRATION_COLS) {
    if (!existingCols.has(colName)) {
      db.exec(`ALTER TABLE file_read_ledger ADD COLUMN ${colName} ${colDef}`)
    }
  }
  const provCols = new Set(
    (db.query("PRAGMA table_info(provenance_chain)").all() as Array<{ name: string }>).map((c) => c.name),
  )
  for (const [colName, colDef] of PROVENANCE_CHAIN_MIGRATION_COLS) {
    if (!provCols.has(colName)) {
      db.exec(`ALTER TABLE provenance_chain ADD COLUMN ${colName} ${colDef}`)
    }
  }
  // Self-heal pre-A3 watermarks where file_read_ledger rows lack slice_sha or provenance_chain was never extracted
  try {
    const legacyCount = (
      db
        .query("SELECT COUNT(*) AS cnt FROM file_read_ledger WHERE slice_sha IS NULL OR slice_sha = '' OR read_blob_sha = blob_sha")
        .get() as { cnt?: number } | null
    )?.cnt ?? 0
    if (legacyCount > 0) {
      db.exec(
        "DELETE FROM sync_watermark WHERE session_id IN (SELECT DISTINCT session_id FROM file_read_ledger WHERE slice_sha IS NULL OR slice_sha = '' OR read_blob_sha = blob_sha)",
      )
    }
  } catch {
    // ignore if tables are empty
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
  ensureHoneycombSchema(db)
  return db
}

export function readRootWatermarks(
  targetPath: string,
  rootID: string,
): {
  readonly watermarks: Map<string, SyncWatermarkRow>
  readonly fileCount: number
  readonly totalMessages: number
  readonly totalDelegations: number
} | null {
  if (!existsSync(targetPath)) return null
  const db = new Database(targetPath, { readonly: true })
  try {
    db.exec("PRAGMA busy_timeout = 5000;")
    const hasWm = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_watermark'")
      .get()
    if (!hasWm) return null

    const rows = db
      .query(
        "SELECT session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at FROM sync_watermark WHERE root_id = ?",
      )
      .all(rootID) as SyncWatermarkRow[]
    if (rows.length === 0) return null

    const watermarks = new Map<string, SyncWatermarkRow>()
    for (const r of rows) {
      watermarks.set(r.session_id, r)
    }

    const metaRow = db
      .query("SELECT file_count FROM sync_root_meta WHERE root_id = ?")
      .get(rootID) as { file_count: number } | null
    const msgRow = db
      .query("SELECT COALESCE(SUM(message_count), 0) AS m FROM session WHERE root_id = ?")
      .get(rootID) as { m: number } | null
    const delRow = db
      .query("SELECT COUNT(*) AS d FROM delegation WHERE root_id = ?")
      .get(rootID) as { d: number } | null

    return {
      watermarks,
      fileCount: metaRow?.file_count ?? 0,
      totalMessages: msgRow?.m ?? 0,
      totalDelegations: delRow?.d ?? 0,
    }
  } finally {
    db.close()
  }
}

const SESSION_COLS = [
  "id",
  "root_id",
  "project_id",
  "parent_id",
  "depth",
  "lane_kind",
  "lane_path",
  "title",
  "agent",
  "provider",
  "model_id",
  "variant",
  "harness",
  "outcome",
  "cost",
  "tok_in",
  "tok_out",
  "tok_reason",
  "tok_cache_r",
  "tok_cache_w",
  "files_changed",
  "additions",
  "deletions",
  "t_created",
  "t_updated",
  "t_idle",
  "t_compacting",
  "t_archived",
  "resume_attempts",
  "message_count",
  "transcript_path",
] as const

const DELEGATION_COLS = [
  "call_id",
  "root_id",
  "parent_session",
  "parent_message_id",
  "child_session",
  "tool",
  "agent",
  "harness",
  "mode",
  "background",
  "description",
  "prompt_ref",
  "status",
  "t_created",
  "t_completed",
] as const

const insertOrReplaceSql = (table: string, cols: readonly string[]) =>
  `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`

const bool = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0)

export function writeIncrementalIndex(
  targetPath: string,
  input: IncrementalIndexInput,
): { readonly totalMessages: number; readonly totalDelegations: number } {
  const db = initSyncDatabase(targetPath)
  try {
    let totalMessages = 0
    let totalDelegations = 0

    const tx = db.transaction(() => {
      if (input.isCold) {
        db.query("DELETE FROM sync_watermark WHERE root_id = ?").run(input.rootID)
        db.query("DELETE FROM session WHERE root_id = ?").run(input.rootID)
        db.query("DELETE FROM delegation WHERE root_id = ?").run(input.rootID)
      }

      const insSession = db.query(insertOrReplaceSql("session", SESSION_COLS))
      for (const s of input.sessions) {
        insSession.run(
          s.id,
          input.rootID,
          s.project_id,
          s.parent_id,
          s.depth,
          s.lane_kind,
          s.lane_path,
          s.title,
          s.agent,
          s.provider,
          s.model_id,
          s.variant,
          s.harness,
          s.outcome,
          s.cost,
          s.tok_in,
          s.tok_out,
          s.tok_reason,
          s.tok_cache_r,
          s.tok_cache_w,
          s.files_changed,
          s.additions,
          s.deletions,
          s.t_created,
          s.t_updated,
          s.t_idle,
          s.t_compacting,
          s.t_archived,
          s.resume_attempts,
          s.message_count,
          s.transcript_path,
        )
      }

      const insDelegation = db.query(insertOrReplaceSql("delegation", DELEGATION_COLS))
      for (const d of input.delegations) {
        insDelegation.run(
          d.call_id,
          input.rootID,
          d.parent_session,
          d.parent_message_id,
          d.child_session,
          d.tool,
          d.agent,
          d.harness,
          d.mode,
          bool(d.background),
          d.description,
          d.prompt_ref,
          d.status,
          d.t_created,
          d.t_completed,
        )
      }

      const insMessage = db.query(
        insertOrReplaceSql("message", [
          "session_id",
          "seq",
          "id",
          "kind",
          "t",
          "agent",
          "model_id",
          "tok_in",
          "tok_out",
        ]),
      )
      for (const m of input.messages) {
        insMessage.run(m.session_id, m.seq, m.id, m.kind, m.t, m.agent, m.model_id, m.tok_in, m.tok_out)
      }

      const insToolCall = db.query(
        insertOrReplaceSql("tool_call", [
          "call_id",
          "session_id",
          "seq",
          "name",
          "status",
          "duration_ms",
          "truncated",
          "output_path",
        ]),
      )
      for (const t of input.toolCalls) {
        insToolCall.run(
          t.call_id,
          t.session_id,
          t.seq,
          t.name,
          t.status,
          t.duration_ms,
          t.truncated ? 1 : 0,
          t.output_path,
        )
      }

      const insCompaction = db.query(
        insertOrReplaceSql("compaction", ["session_id", "seq", "reason", "status", "summary_ref", "tok_input"]),
      )
      for (const c of input.compactions) {
        insCompaction.run(c.session_id, c.seq, c.reason, c.status, c.summary_ref, c.tok_input)
      }

      const insInstruction = db.query(
        insertOrReplaceSql("instruction", ["session_id", "seq", "path", "blob_sha"]),
      )
      for (const i of input.instructions) {
        insInstruction.run(i.session_id, i.seq, i.path, i.blob_sha)
      }

      if (input.kvBindings.length > 0) {
        const insKvBinding = db.query(`
          INSERT OR REPLACE INTO kv_binding (
            child_session_id, raw_key, scope, driver_kind, harness, foreign_session_id,
            parent_session_id, call_id, title, cwd, agent, model, effort, mode, background,
            requested_model, confirmed_model, confirmed_effort, turn, phase,
            foreign_ack_turn, foreign_ack_stop_reason, serving_witness_model, serving_witness_at,
            consumed_inputs_json, created_at, updated_at, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const b of input.kvBindings) {
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
            bool(b.background),
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
            b.source_origin ?? "host_db",
          )
        }
      }

      if (input.kvForeignIndex.length > 0) {
        const insForeign = db.query(`
          INSERT OR REPLACE INTO kv_foreign_index (harness, foreign_session_id, child_session_id, raw_key)
          VALUES (?, ?, ?, ?)
        `)
        for (const f of input.kvForeignIndex) {
          insForeign.run(f.harness, f.foreign_session_id, f.child_session_id, f.raw_key)
        }
      }

      if (input.kvContextPrunes.length > 0) {
        const insPrune = db.query(`
          INSERT OR REPLACE INTO kv_context_prune (
            session_id, raw_key, scope, mode, anchor_message_id, recorded_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const p of input.kvContextPrunes) {
          insPrune.run(
            p.session_id,
            p.raw_key,
            p.scope,
            p.mode,
            p.anchor_message_id,
            p.recorded_at,
            p.updated_at,
          )
        }
      }

      if (input.delegationTurns.length > 0) {
        const insTurn = db.query(`
          INSERT OR REPLACE INTO delegation_turn (
            parent_session_id, call_id, turn_index, child_session_id, mode, harness,
            agent, model, foreign_session_id, start_seq, end_seq, start_message_id, end_message_id,
            reported_outcome, verified_outcome, blocker_summary,
            tool_error_count, tool_completed_count, text_char_count,
            prompt_blob, response_blob, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const t of input.delegationTurns) {
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
        }
      }

      if (input.fileReads.length > 0) {
        const insRead = db.query(`
          INSERT OR REPLACE INTO file_read_ledger (
            session_id, path, normalized_path, call_id, message_id, seq, read_seq,
            line_range, start_line, end_line, total_lines, is_truncated, chars, char_len,
            blob_sha, blob_sha256, slice_sha, read_blob_sha, disk_blob_sha,
            summary, staleness_status, t, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const r of input.fileReads) {
          const isTruncatedInt =
            typeof r.is_truncated === "boolean" ? (r.is_truncated ? 1 : 0) : (r.is_truncated ?? 0)
          insRead.run(
            r.session_id,
            r.path,
            r.normalized_path,
            r.call_id,
            r.message_id,
            r.seq,
            r.read_seq,
            r.line_range,
            r.start_line,
            r.end_line,
            r.total_lines ?? null,
            isTruncatedInt,
            r.chars,
            r.char_len,
            r.blob_sha,
            r.blob_sha256,
            r.slice_sha ?? r.read_blob_sha,
            r.read_blob_sha,
            r.disk_blob_sha,
            r.summary,
            r.staleness_status,
            r.t,
            r.updated_at,
          )
        }
      }

      if (input.skillLoads.length > 0) {
        const insSkill = db.query(`
          INSERT OR REPLACE INTO skill_load_ledger (
            session_id, skill_name, call_id, message_id, seq, loaded_seq, load_seq,
            chars, char_len, blob_sha, blob_sha256, skill_blob_sha, blob_ref,
            summary, status, t
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const s of input.skillLoads) {
          insSkill.run(
            s.session_id,
            s.skill_name,
            s.call_id,
            s.message_id,
            s.seq,
            s.loaded_seq,
            s.load_seq,
            s.chars,
            s.char_len,
            s.blob_sha,
            s.blob_sha256,
            s.skill_blob_sha,
            s.blob_ref,
            s.summary,
            s.status,
            s.t,
          )
        }
      }

      if (input.fileTouches.length > 0) {
        const insTouch = db.query(`
          INSERT OR REPLACE INTO file_touch (
            session_id, seq, call_id, tool, op, path, normalized_path, detail, t
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const ft of input.fileTouches) {
          insTouch.run(
            ft.session_id,
            ft.seq,
            ft.call_id,
            ft.tool,
            ft.op ?? ft.operation,
            ft.path,
            ft.normalized_path,
            ft.detail ?? null,
            ft.t,
          )
        }
      }

      if (input.snapshotArtifacts.length > 0) {
        const insSnap = db.query(`
          INSERT OR REPLACE INTO snapshot_artifact (
            session_id, message_id, seq, path, start_tree_sha, end_tree_sha,
            start_blob_sha, end_blob_sha, start_git_blob_sha, end_git_blob_sha,
            start_byte_len, end_byte_len, byte_len, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const sa of input.snapshotArtifacts) {
          insSnap.run(
            sa.session_id,
            sa.message_id,
            sa.seq,
            sa.path,
            sa.start_tree_sha,
            sa.end_tree_sha,
            sa.start_blob_sha,
            sa.end_blob_sha,
            sa.start_git_blob_sha,
            sa.end_git_blob_sha,
            sa.start_byte_len,
            sa.end_byte_len,
            sa.byte_len,
            sa.source_origin,
          )
        }
      }

      if (input.spillArtifacts.length > 0) {
        const insSpill = db.query(`
          INSERT OR REPLACE INTO spill_artifact (
            session_id, call_id, message_id, seq, tool_name, spill_kind,
            spill_source, inline_byte_len, full_byte_len, blob_sha, source_origin
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const sp of input.spillArtifacts) {
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
        }
      }

      if ((input.provenanceChains?.length ?? 0) > 0) {
        const insChain = db.query(`
          INSERT OR REPLACE INTO provenance_chain (
            chain_id, root_session_id, session_id, finding_id, finding_seq, finding_session_id,
            finding_summary, child_session_id, intent_seq, intent_message_id, intent_summary,
            decision_seq, decision_pivot_seq, decision_summary, target_path, touched_files_json,
            read_or_review_blob_sha, repair_seq, repair_session_id, repair_blob_sha,
            receipt_command, verification_command, receipt_exit_code, verification_exit_code,
            verification_seq, receipt_blob_sha, verification_blob_ref, head_sha,
            worktree_tree_sha, disk_blob_sha, staleness_status, outcome, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const pc of input.provenanceChains ?? []) {
          insChain.run(
            pc.chain_id,
            pc.root_session_id,
            pc.session_id,
            pc.finding_id,
            pc.finding_seq,
            pc.finding_session_id,
            pc.finding_summary,
            pc.child_session_id,
            pc.intent_seq,
            pc.intent_message_id,
            pc.intent_summary,
            pc.decision_seq,
            pc.decision_pivot_seq,
            pc.decision_summary,
            pc.target_path,
            pc.touched_files_json,
            pc.read_or_review_blob_sha,
            pc.repair_seq,
            pc.repair_session_id,
            pc.repair_blob_sha,
            pc.receipt_command,
            pc.verification_command,
            pc.receipt_exit_code,
            pc.verification_exit_code,
            pc.verification_seq,
            pc.receipt_blob_sha,
            pc.verification_blob_ref,
            pc.head_sha,
            pc.worktree_tree_sha,
            pc.disk_blob_sha,
            pc.staleness_status,
            pc.outcome,
            pc.created_at,
            pc.updated_at,
          )
        }
      }

      if (input.watermarks.length > 0) {
        const insWm = db.query(`
          INSERT OR REPLACE INTO sync_watermark (
            session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const wm of input.watermarks) {
          insWm.run(
            wm.session_id,
            wm.root_id,
            wm.last_time_updated,
            wm.last_max_seq,
            wm.last_message_id,
            wm.last_kv_updated,
            wm.synced_at,
          )
        }
      }

      db.query("INSERT OR REPLACE INTO sync_root_meta (root_id, file_count) VALUES (?, ?)").run(
        input.rootID,
        input.fileCount,
      )

      const msgRow = db
        .query("SELECT COALESCE(SUM(message_count), 0) AS m FROM session WHERE root_id = ?")
        .get(input.rootID) as { m: number } | null
      const delRow = db
        .query("SELECT COUNT(*) AS d FROM delegation WHERE root_id = ?")
        .get(input.rootID) as { d: number } | null
      totalMessages = msgRow?.m ?? 0
      totalDelegations = delRow?.d ?? 0
    })

    tx.immediate()
    return { totalMessages, totalDelegations }
  } finally {
    db.close()
  }
}

export function writeIndex(targetPath: string, input: IndexInput): "written" | "unchanged" {
  writeIncrementalIndex(targetPath, {
    isCold: true,
    rootID: input.rootID,
    sessions: input.sessions,
    delegations: input.delegations,
    messages: input.messages,
    toolCalls: input.toolCalls,
    compactions: input.compactions,
    instructions: input.instructions,
    kvBindings: input.kvBindings ?? [],
    kvForeignIndex: input.kvForeignIndex ?? [],
    kvContextPrunes: input.kvContextPrunes ?? [],
    delegationTurns: input.delegationTurns ?? [],
    fileReads: input.fileReads ?? [],
    skillLoads: input.skillLoads ?? [],
    fileTouches: input.fileTouches ?? [],
    snapshotArtifacts: input.snapshotArtifacts ?? [],
    spillArtifacts: input.spillArtifacts ?? [],
    provenanceChains: input.provenanceChains ?? [],
    watermarks: input.watermarks ?? [],
    fileCount: input.fileCount ?? 0,
  })
  return "written"
}
