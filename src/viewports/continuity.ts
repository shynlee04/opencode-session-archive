import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  computeDiskSliceSha,
  estimateTokens,
  formatStalenessStatus,
  normalizeRepoPath,
  resolveDiskPath,
  sha256Hex,
} from "../archive/primitives.ts"

export { estimateTokens, normalizeRepoPath }

export type FileStalenessStatus =
  | "FRESH — DO NOT REREAD"
  | `SLICE L${number}-L${number}${" — FRESH SLICE" | ` of ${number} — FRESH SLICE`}`
  | "STALE (modified since read/review — re-verify slice)"
  | string

export type ProvenanceStalenessStatus =
  | "VERIFIED_FRESH"
  | "verified_fresh"
  | "SLICE_FRESH"
  | "FRESH — DO NOT REREAD"
  | "verified_stale_by_later_touch"
  | "STALE_BY_LATER_TOUCH"
  | "STALE (modified since read/review — re-verify slice)"

export type SessionResolutionSource =
  | "explicit_input"
  | "hook_context"
  | "sqlite_latest_root"

export interface ProvenanceChainRow {
  readonly chain_id: string
  readonly root_session_id: string
  readonly finding_id: string
  readonly finding_seq?: number
  readonly finding_session_id?: string
  readonly finding_summary: string
  readonly child_session_id: string | null
  readonly decision_seq?: number | null
  readonly decision_pivot_seq: number | null
  readonly target_path: string
  readonly read_or_review_blob_sha: string
  readonly repair_seq?: number | null
  readonly repair_session_id?: string | null
  readonly repair_blob_sha: string | null
  readonly receipt_command?: string | null
  readonly verification_command: string | null
  readonly receipt_exit_code?: number | null
  readonly verification_exit_code: number | null
  readonly receipt_blob_sha?: string | null
  readonly verification_blob_ref: string | null
  readonly head_sha?: string | null
  readonly worktree_tree_sha?: string | null
  readonly disk_blob_sha: string
  readonly staleness_status: ProvenanceStalenessStatus
  readonly updated_at: string
}

export interface FileReadLedgerRow {
  readonly session_id: string
  readonly path: string
  readonly normalized_path?: string
  readonly line_range: string
  readonly start_line?: number | null
  readonly end_line?: number | null
  readonly total_lines?: number | null
  readonly is_truncated?: number | boolean
  readonly blob_sha?: string
  readonly blob_sha256?: string
  readonly read_blob_sha: string
  readonly read_seq: number
  readonly disk_blob_sha: string
  readonly staleness_status: FileStalenessStatus
}

export interface SkillLoadLedgerRow {
  readonly session_id: string
  readonly skill_name: string
  readonly blob_sha: string
  readonly blob_ref: string
  readonly load_seq: number
  readonly status: "ACTIVE — DO NOT RE-INVOKE" | string
}

export interface StalenessReconciliationResult {
  readonly sessionId: string
  readonly sessionID: string
  readonly totalFilesChecked: number
  readonly freshFilesCount: number
  readonly sliceFilesCount: number
  readonly staleFilesCount: number
  readonly freshFiles: readonly FileReadLedgerRow[]
  readonly sliceFiles: readonly FileReadLedgerRow[]
  readonly staleFiles: readonly FileReadLedgerRow[]
  readonly totalChainsChecked: number
  readonly verifiedFreshChainsCount: number
  readonly staleChainsCount: number
  readonly transitionedFilePaths: readonly string[]
  readonly transitionedChainIds: readonly string[]
  readonly fileRows: readonly FileReadLedgerRow[]
  readonly chainRows: readonly ProvenanceChainRow[]
  readonly elapsedMs: number
}

export type ReconcileResult = StalenessReconciliationResult

export interface CompactionPacketOptions {
  readonly sessionID?: string
  readonly sessionId?: string
  readonly hookContext?: { readonly sessionID?: string | null; readonly sessionId?: string | null }
  readonly canonicalRoot?: string
  readonly projectRoot?: string
  readonly rootDir?: string
  readonly seq?: number
  readonly compactionSeq?: number
  readonly maxTokens?: number
  readonly maxTokensBudget?: number
  readonly currentDiskHashes?: ReadonlyMap<string, string> | Record<string, string>
}

export interface CompactionContinuationPacket {
  readonly sessionId: string
  readonly sessionID: string
  readonly compactionSeq: number
  readonly compactionReason: string
  readonly compactionTokensInput: number
  readonly headline: string
  readonly verificationGateStatus: string
  readonly markdown: string
  readonly charCount: number
  readonly tokenCount: number
  readonly tokenEstimate: number
  readonly withinBudget: boolean
  readonly sections: {
    readonly headlineAndGate: string
    readonly intentPivotsCount: number
    readonly activeSkillsCount: number
    readonly filesReadCount: number
    readonly freshFilesCount: number
    readonly staleFilesCount: number
    readonly delegationTurnsCount: number
    readonly flaggedDelegationCount: number
    readonly provenanceChainsCount: number
    readonly staleProvenanceCount: number
    readonly repoMapFilesCount: number
    readonly cochangeAlertsCount: number
  }
}

export type SubstrateContinuityAction =
  | "status"
  | "overview"
  | "timeline"
  | "intents"
  | "provenance"
  | "latest"
  | "session"
  | "search"

export interface SubstrateContinuityInput {
  readonly action?: SubstrateContinuityAction
  readonly sessionID?: string
  readonly query?: string
  readonly seq?: number
}

export interface SubstrateHookContext {
  readonly sessionID?: string | null
  readonly sessionId?: string | null
}

export interface SubstrateContinuityResult {
  readonly ok: boolean
  readonly action: SubstrateContinuityAction
  readonly resolvedSessionID: string
  readonly resolutionSource: SessionResolutionSource
  readonly content: string
  readonly data: Record<string, unknown>
}

export interface ResolvedSessionId {
  readonly sessionId: string
  readonly sessionID: string
  readonly rootSessionId: string
  readonly rootSessionID: string
  readonly resolvedChildSessionID: string | null
  readonly source: SessionResolutionSource
}

const CONTINUITY_BASE_DDL = `
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

CREATE TABLE IF NOT EXISTS compaction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT,
  status TEXT,
  summary_ref TEXT,
  tok_input INTEGER,
  PRIMARY KEY (session_id, seq)
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

CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL DEFAULT 0,
  t TEXT NOT NULL DEFAULT '',
  prompt_excerpt TEXT NOT NULL DEFAULT '',
  blob_ref TEXT NOT NULL DEFAULT '',
  pivot_kind TEXT NOT NULL DEFAULT 'followup'
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

CREATE TABLE IF NOT EXISTS provenance_chain (
  chain_id TEXT PRIMARY KEY,
  root_session_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  finding_seq INTEGER NOT NULL DEFAULT 0,
  finding_session_id TEXT NOT NULL DEFAULT '',
  finding_summary TEXT NOT NULL DEFAULT '',
  child_session_id TEXT,
  decision_seq INTEGER,
  decision_pivot_seq INTEGER,
  target_path TEXT NOT NULL,
  read_or_review_blob_sha TEXT NOT NULL DEFAULT '',
  repair_seq INTEGER,
  repair_session_id TEXT,
  repair_blob_sha TEXT,
  receipt_command TEXT,
  verification_command TEXT,
  receipt_exit_code INTEGER,
  verification_exit_code INTEGER,
  receipt_blob_sha TEXT,
  verification_blob_ref TEXT,
  head_sha TEXT,
  worktree_tree_sha TEXT,
  disk_blob_sha TEXT NOT NULL DEFAULT '',
  staleness_status TEXT NOT NULL DEFAULT 'VERIFIED_FRESH',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_provenance_chain_session ON provenance_chain(root_session_id);
CREATE INDEX IF NOT EXISTS idx_provenance_chain_target ON provenance_chain(root_session_id, target_path);

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

CREATE TABLE IF NOT EXISTS compaction_continuation_ledger (
  session_id TEXT NOT NULL,
  compaction_seq INTEGER NOT NULL,
  compaction_reason TEXT NOT NULL DEFAULT 'auto',
  reason TEXT NOT NULL DEFAULT 'auto',
  tok_input INTEGER NOT NULL DEFAULT 0,
  headline TEXT NOT NULL DEFAULT '',
  verification_gate_status TEXT NOT NULL DEFAULT 'in_progress_or_unverified',
  packet_markdown TEXT NOT NULL,
  packet_chars INTEGER NOT NULL DEFAULT 0,
  packet_tokens INTEGER NOT NULL,
  summary_hash TEXT,
  fresh_files_count INTEGER NOT NULL DEFAULT 0,
  stale_files_count INTEGER NOT NULL DEFAULT 0,
  active_skills_count INTEGER NOT NULL DEFAULT 0,
  provenance_chains_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (session_id, compaction_seq)
);
`

const initializedContinuityDbs = new WeakSet<Database>()

function ensureColumnsExist(
  db: Database,
  table: string,
  requiredColumns: readonly { readonly name: string; readonly ddl: string }[],
): void {
  const existing = new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  )
  for (const col of requiredColumns) {
    if (!existing.has(col.name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`)
    }
  }
}

export function ensureContinuitySchema(db: Database): void {
  if (initializedContinuityDbs.has(db)) {
    const hasChain = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'provenance_chain'")
      .get()
    if (hasChain) return
  }

  const checkAndDropIncompatible = (table: string, requiredCol: string) => {
    const cols = new Set(
      (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    )
    if (cols.size > 0 && !cols.has(requiredCol)) {
      db.exec(`DROP TABLE IF EXISTS ${table};`)
    }
  }

  checkAndDropIncompatible("provenance_chain", "target_path")
  checkAndDropIncompatible("compaction_continuation_ledger", "packet_markdown")
  checkAndDropIncompatible("session_semantic_digest", "headline")
  checkAndDropIncompatible("intent_pivot", "seq")
  checkAndDropIncompatible("code_file", "loc")
  checkAndDropIncompatible("code_symbol", "qualified_name")
  checkAndDropIncompatible("git_cochange", "co_commits")

  const dtInfo = db.query("PRAGMA table_info(delegation_turn)").all() as {
    name: string
    notnull: number
    dflt_value: string | null
  }[]
  const dtStartSeq = dtInfo.find((c) => c.name === "start_seq")
  if (dtStartSeq && dtStartSeq.notnull === 1 && dtStartSeq.dflt_value === null) {
    const dtCount = (db.query("SELECT COUNT(*) as c FROM delegation_turn").get() as { c: number }).c
    if (dtCount === 0) {
      db.exec("DROP TABLE IF EXISTS delegation_turn;")
    }
  }

  db.exec(CONTINUITY_BASE_DDL)

  const frlInfo = db.query("PRAGMA table_info(file_read_ledger)").all() as {
    name: string
    notnull: number
    dflt_value: string | null
  }[]
  const normCol = frlInfo.find((c) => c.name === "normalized_path")
  if (normCol && normCol.notnull === 1 && normCol.dflt_value === null) {
    ensureColumnsExist(db, "file_read_ledger", [
      { name: "total_lines", ddl: "INTEGER" },
      { name: "is_truncated", ddl: "INTEGER NOT NULL DEFAULT 0" },
    ])
    db.exec(`
      CREATE TABLE file_read_ledger_migrated (
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
        read_blob_sha TEXT NOT NULL DEFAULT '',
        disk_blob_sha TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        staleness_status TEXT NOT NULL DEFAULT 'FRESH — DO NOT REREAD',
        t INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (session_id, path)
      );
      INSERT INTO file_read_ledger_migrated (
        session_id, path, normalized_path, call_id, message_id, seq, read_seq,
        line_range, start_line, end_line, total_lines, is_truncated, chars, char_len,
        blob_sha, blob_sha256, read_blob_sha, disk_blob_sha, summary, staleness_status, t, updated_at
      )
      SELECT
        session_id, path, COALESCE(normalized_path, path), COALESCE(call_id, ''),
        COALESCE(message_id, ''), COALESCE(seq, 0), COALESCE(read_seq, 0),
        COALESCE(line_range, 'L1-L120'), start_line, end_line, total_lines, COALESCE(is_truncated, 0),
        COALESCE(chars, 0), COALESCE(char_len, 0), COALESCE(blob_sha, ''), COALESCE(blob_sha256, ''),
        COALESCE(read_blob_sha, ''), COALESCE(disk_blob_sha, ''), COALESCE(summary, ''),
        COALESCE(staleness_status, 'FRESH — DO NOT REREAD'), COALESCE(t, 0), COALESCE(CAST(updated_at AS TEXT), '')
      FROM file_read_ledger;
      DROP TABLE file_read_ledger;
      ALTER TABLE file_read_ledger_migrated RENAME TO file_read_ledger;
      CREATE INDEX IF NOT EXISTS idx_file_read_ledger_session ON file_read_ledger(session_id, read_seq);
    `)
  } else {
    ensureColumnsExist(db, "file_read_ledger", [
      { name: "normalized_path", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "call_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "message_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "read_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "line_range", ddl: "TEXT NOT NULL DEFAULT 'L1-L120'" },
      { name: "start_line", ddl: "INTEGER" },
      { name: "end_line", ddl: "INTEGER" },
      { name: "total_lines", ddl: "INTEGER" },
      { name: "is_truncated", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "char_len", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_sha256", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "read_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "disk_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "summary", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "staleness_status", ddl: "TEXT NOT NULL DEFAULT 'FRESH — DO NOT REREAD'" },
      { name: "t", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" },
    ])
  }

  const sllInfo = db.query("PRAGMA table_info(skill_load_ledger)").all() as {
    name: string
    notnull: number
    dflt_value: string | null
  }[]
  const sllCallCol = sllInfo.find((c) => c.name === "call_id")
  if (sllCallCol && sllCallCol.notnull === 1 && sllCallCol.dflt_value === null) {
    db.exec(`
      CREATE TABLE skill_load_ledger_migrated (
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
      INSERT INTO skill_load_ledger_migrated (
        session_id, skill_name, call_id, message_id, seq, loaded_seq, load_seq,
        chars, char_len, blob_sha, blob_sha256, skill_blob_sha, blob_ref, summary, status, t
      )
      SELECT
        session_id, skill_name, COALESCE(call_id, ''), COALESCE(message_id, ''),
        COALESCE(seq, 0), COALESCE(loaded_seq, 0), COALESCE(load_seq, 0),
        COALESCE(chars, 0), COALESCE(char_len, 0), COALESCE(blob_sha, ''),
        COALESCE(blob_sha256, ''), COALESCE(skill_blob_sha, ''), COALESCE(blob_ref, ''),
        COALESCE(summary, ''), COALESCE(status, 'ACTIVE — DO NOT RE-INVOKE'), COALESCE(t, 0)
      FROM skill_load_ledger;
      DROP TABLE skill_load_ledger;
      ALTER TABLE skill_load_ledger_migrated RENAME TO skill_load_ledger;
      CREATE INDEX IF NOT EXISTS idx_skill_load_ledger_session ON skill_load_ledger(session_id, load_seq);
    `)
  } else {
    ensureColumnsExist(db, "skill_load_ledger", [
      { name: "call_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "message_id", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "loaded_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "load_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "char_len", ddl: "INTEGER NOT NULL DEFAULT 0" },
      { name: "blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_sha256", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "skill_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "blob_ref", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "summary", ddl: "TEXT NOT NULL DEFAULT ''" },
      { name: "status", ddl: "TEXT NOT NULL DEFAULT 'ACTIVE — DO NOT RE-INVOKE'" },
      { name: "t", ddl: "INTEGER NOT NULL DEFAULT 0" },
    ])
  }

  ensureColumnsExist(db, "provenance_chain", [
    { name: "session_id", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "finding_seq", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "finding_session_id", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "finding_summary", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "child_session_id", ddl: "TEXT" },
    { name: "decision_seq", ddl: "INTEGER" },
    { name: "decision_pivot_seq", ddl: "INTEGER" },
    { name: "read_or_review_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "repair_seq", ddl: "INTEGER" },
    { name: "repair_session_id", ddl: "TEXT" },
    { name: "repair_blob_sha", ddl: "TEXT" },
    { name: "receipt_command", ddl: "TEXT" },
    { name: "verification_command", ddl: "TEXT" },
    { name: "receipt_exit_code", ddl: "INTEGER" },
    { name: "verification_exit_code", ddl: "INTEGER" },
    { name: "receipt_blob_sha", ddl: "TEXT" },
    { name: "verification_blob_ref", ddl: "TEXT" },
    { name: "head_sha", ddl: "TEXT" },
    { name: "worktree_tree_sha", ddl: "TEXT" },
    { name: "disk_blob_sha", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "staleness_status", ddl: "TEXT NOT NULL DEFAULT 'VERIFIED_FRESH'" },
    { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" },
  ])

  ensureColumnsExist(db, "compaction_continuation_ledger", [
    { name: "compaction_reason", ddl: "TEXT NOT NULL DEFAULT 'auto'" },
    { name: "reason", ddl: "TEXT NOT NULL DEFAULT 'auto'" },
    { name: "tok_input", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "headline", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "verification_gate_status", ddl: "TEXT NOT NULL DEFAULT 'in_progress_or_unverified'" },
    { name: "packet_markdown", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "packet_chars", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "packet_tokens", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "summary_hash", ddl: "TEXT" },
    { name: "fresh_files_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "stale_files_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "active_skills_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "provenance_chains_count", ddl: "INTEGER NOT NULL DEFAULT 0" },
    { name: "created_at", ddl: "TEXT NOT NULL DEFAULT ''" },
    { name: "updated_at", ddl: "TEXT NOT NULL DEFAULT ''" },
  ])

  const symbolCols = new Set(
    (db.query("PRAGMA table_info(code_symbol)").all() as { name: string }[]).map((c) => c.name),
  )
  if (symbolCols.size > 0) {
    if (!symbolCols.has("qualified_name")) {
      db.exec("ALTER TABLE code_symbol ADD COLUMN qualified_name TEXT NOT NULL DEFAULT ''")
      db.exec(
        "UPDATE code_symbol SET qualified_name = CASE WHEN parent_symbol IS NOT NULL AND parent_symbol != '' THEN parent_symbol || '.' || name ELSE name END WHERE qualified_name = ''",
      )
    }
    if (!symbolCols.has("blob_sha")) {
      db.exec("ALTER TABLE code_symbol ADD COLUMN blob_sha TEXT NOT NULL DEFAULT ''")
    }
  }

  try {
    db.exec(`
      DELETE FROM provenance_chain WHERE target_path IN ('session', '(unknown)', '');
      UPDATE file_read_ledger
      SET line_range = 'L1-L' || COALESCE(NULLIF(end_line, 0), NULLIF(total_lines, 0), 1)
      WHERE line_range IN ('all', '#all');
    `)
  } catch {
    // ignore cleanup errors on partial schemas
  }

  initializedContinuityDbs.add(db)
}

export function shortBlobRef(shaOrRef: string | null | undefined): string {
  if (!shaOrRef) return "blob:unknown"
  const raw = shaOrRef.startsWith("blob:") ? shaOrRef.slice(5) : shaOrRef
  return `blob:${raw.slice(0, 12)}`
}

function stripBlobPrefix(shaOrRef: string | null | undefined): string {
  if (!shaOrRef) return ""
  return shaOrRef.startsWith("blob:") ? shaOrRef.slice(5) : shaOrRef
}

function toHashMap(
  input?: ReadonlyMap<string, string> | Record<string, string>,
): ReadonlyMap<string, string> {
  if (!input) return new Map()
  if (input instanceof Map) return input
  return new Map(Object.entries(input as Record<string, string>))
}

function hashesMatch(expectedSha: string, diskSha: string): boolean {
  const a = stripBlobPrefix(expectedSha)
  const b = stripBlobPrefix(diskSha)
  if (!a || !b) return a === b
  if (a === b) return true
  const minLen = Math.min(a.length, b.length)
  if (minLen >= 12 && (a.startsWith(b) || b.startsWith(a))) return true
  return false
}

export function isSliceStatus(status: string): boolean {
  return status.startsWith("SLICE ") && status.endsWith("— FRESH SLICE")
}

export function isFreshOrSliceStatus(status: string): boolean {
  return status === "FRESH — DO NOT REREAD" || isSliceStatus(status)
}

function classifyProvenanceStaleness(params: {
  readonly expectedBlobSha: string
  readonly diskBlobSha: string
  readonly verificationExitCode: number | null
  readonly preferLowercaseFresh: boolean
}): ProvenanceStalenessStatus {
  const matches = hashesMatch(params.expectedBlobSha, params.diskBlobSha)
  const verifiedPass = params.verificationExitCode === 0 || params.verificationExitCode === null
  if (matches) {
    if (verifiedPass) {
      return params.preferLowercaseFresh ? "verified_fresh" : "VERIFIED_FRESH"
    }
    return "FRESH — DO NOT REREAD"
  }
  return verifiedPass
    ? "verified_stale_by_later_touch"
    : "STALE (modified since read/review — re-verify slice)"
}

export function formatProvenanceStatusLabel(status: ProvenanceStalenessStatus | string): string {
  if (status === "VERIFIED_FRESH" || status === "verified_fresh" || status === "verified_pass") {
    return "VERIFIED_FRESH (FRESH — DO NOT REREAD)"
  }
  if (status === "SLICE_FRESH") {
    return "SLICE_FRESH (FRESH SLICE — DO NOT REREAD SLICE)"
  }
  if (status === "FRESH — DO NOT REREAD" || isSliceStatus(status)) {
    return status
  }
  if (status === "verified_stale_by_later_touch" || status === "STALE_BY_LATER_TOUCH") {
    return "STALE (modified since read/review — re-verify slice) [verified_stale_by_later_touch]"
  }
  return "STALE (modified since read/review — re-verify slice)"
}

export function formatVerificationGateLabel(
  verificationState: string | null | undefined,
  stalePaths?: readonly string[],
): string {
  const state = (verificationState ?? "unverified").trim() || "unverified"
  if (state === "verified_stale_by_later_touch" || state === "STALE_BY_LATER_TOUCH") {
    const suffix =
      stalePaths && stalePaths.length > 0
        ? `${stalePaths.length} file(s) modified since last test pass: ${stalePaths.slice(0, 3).join(", ")}`
        : "tracked files modified since last test pass"
    return `verified_stale_by_later_touch — NEEDS RE-VERIFY (${suffix})`
  }
  if (state === "verified_passed" || state === "verified_pass") {
    return "verified_passed — PASS (all verified files fresh on disk)"
  }
  if (state === "verified_failed_or_blocked" || state === "verified_fail") {
    return `${state} — FAILED / BLOCKED`
  }
  if (state === "completed_report_only") {
    return "completed_report_only — UNVERIFIED (edits recorded without test receipt)"
  }
  return `${state} — UNVERIFIED (no test/typecheck receipt recorded yet)`
}

function sanitizeLineRange(
  rawLineRange: string | null | undefined,
  totalLines?: number | null,
  endLine?: number | null,
): string {
  const stripped = (rawLineRange ?? "").trim().replace(/^#+/, "")
  if (stripped === "" || stripped.toLowerCase() === "all") {
    if (typeof totalLines === "number" && totalLines > 0) {
      return `L1-L${totalLines}`
    }
    if (typeof endLine === "number" && endLine > 0 && endLine < 1_000_000) {
      return `L1-L${endLine}`
    }
    return "L1-L1"
  }
  return stripped
}

function cleanupProvenanceChainsForSession(db: Database, sessionId: string): void {
  db.query(
    `DELETE FROM provenance_chain
     WHERE (root_session_id = ? OR session_id = ?)
       AND (TRIM(COALESCE(target_path, '')) IN ('session', '(unknown)', ''))`,
  ).run(sessionId, sessionId)

  db.query(
    `DELETE FROM provenance_chain
     WHERE (root_session_id = ? OR session_id = ?)
       AND rowid NOT IN (
         SELECT rowid FROM (
           SELECT rowid,
                  ROW_NUMBER() OVER (
                    PARTITION BY target_path
                    ORDER BY COALESCE(finding_seq, 0) DESC, updated_at DESC, rowid DESC
                  ) AS rn
           FROM provenance_chain
           WHERE root_session_id = ? OR session_id = ?
         )
         WHERE rn = 1
       )`,
  ).run(sessionId, sessionId, sessionId, sessionId)
}

function resolveCandidateToRoot(
  db: Database,
  candidateId: string,
): { readonly rootId: string; readonly childId: string | null } {
  const row = db
    .query("SELECT id, root_id, depth FROM session WHERE id = ? LIMIT 1")
    .get(candidateId) as { id: string; root_id: string | null; depth: number } | null
  if (row && row.depth > 0 && row.root_id && row.root_id !== candidateId) {
    return { rootId: row.root_id, childId: candidateId }
  }
  return { rootId: candidateId, childId: null }
}

/**
 * Resolves the target session ID in strict priority order:
 * 1. Explicit non-empty sessionID argument (`source: "explicit_input"`)
 * 2. Hook/execution context sessionID (`source: "hook_context"`, mapped to root session if child)
 * 3. Latest `depth = 0` root session in SQLite (`ORDER BY COALESCE(t_updated, t_created, 0) DESC LIMIT 1`, `source: "sqlite_latest_root"`)
 * Never throws `"Specify action and sessionID"`.
 */
export function resolveDefaultSessionId(
  db: Database,
  explicitSessionIdOrOptions?:
    | string
    | null
    | {
        readonly sessionID?: string | null
        readonly sessionId?: string | null
        readonly hookContext?: SubstrateHookContext
      },
  hookContext?: SubstrateHookContext,
): ResolvedSessionId {
  ensureContinuitySchema(db)

  let explicitSessionId: string | null | undefined
  let effectiveHookCtx: SubstrateHookContext | undefined = hookContext

  if (typeof explicitSessionIdOrOptions === "string" || explicitSessionIdOrOptions === null) {
    explicitSessionId = explicitSessionIdOrOptions
  } else if (explicitSessionIdOrOptions && typeof explicitSessionIdOrOptions === "object") {
    explicitSessionId = explicitSessionIdOrOptions.sessionID ?? explicitSessionIdOrOptions.sessionId
    effectiveHookCtx = explicitSessionIdOrOptions.hookContext ?? hookContext
  }

  if (typeof explicitSessionId === "string" && explicitSessionId.trim().length > 0) {
    const trimmed = explicitSessionId.trim()
    const { rootId, childId } = resolveCandidateToRoot(db, trimmed)
    return {
      sessionId: rootId,
      sessionID: rootId,
      rootSessionId: rootId,
      rootSessionID: rootId,
      resolvedChildSessionID: childId,
      source: "explicit_input",
    }
  }

  const rawHookId = effectiveHookCtx?.sessionID ?? effectiveHookCtx?.sessionId
  if (typeof rawHookId === "string" && rawHookId.trim().length > 0) {
    const trimmed = rawHookId.trim()
    const { rootId, childId } = resolveCandidateToRoot(db, trimmed)
    return {
      sessionId: rootId,
      sessionID: rootId,
      rootSessionId: rootId,
      rootSessionID: rootId,
      resolvedChildSessionID: childId,
      source: "hook_context",
    }
  }

  const latestRoot = db
    .query(
      "SELECT id FROM session WHERE depth = 0 ORDER BY COALESCE(t_updated, t_created, 0) DESC, id DESC LIMIT 1",
    )
    .get() as { id: string } | null
  if (latestRoot?.id) {
    return {
      sessionId: latestRoot.id,
      sessionID: latestRoot.id,
      rootSessionId: latestRoot.id,
      rootSessionID: latestRoot.id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root",
    }
  }

  const digestRow = db
    .query("SELECT session_id FROM session_semantic_digest LIMIT 1")
    .get() as { session_id: string } | null
  if (digestRow?.session_id) {
    return {
      sessionId: digestRow.session_id,
      sessionID: digestRow.session_id,
      rootSessionId: digestRow.session_id,
      rootSessionID: digestRow.session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root",
    }
  }

  const latestComp = db
    .query("SELECT session_id FROM compaction ORDER BY rowid DESC LIMIT 1")
    .get() as { session_id: string } | null
  if (latestComp?.session_id) {
    return {
      sessionId: latestComp.session_id,
      sessionID: latestComp.session_id,
      rootSessionId: latestComp.session_id,
      rootSessionID: latestComp.session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root",
    }
  }

  const provRow = db
    .query("SELECT root_session_id FROM provenance_chain LIMIT 1")
    .get() as { root_session_id: string } | null
  if (provRow?.root_session_id) {
    return {
      sessionId: provRow.root_session_id,
      sessionID: provRow.root_session_id,
      rootSessionId: provRow.root_session_id,
      rootSessionID: provRow.root_session_id,
      resolvedChildSessionID: null,
      source: "sqlite_latest_root",
    }
  }

  const fileRow = db
    .query("SELECT session_id FROM file_read_ledger LIMIT 1")
    .get() as { session_id: string } | null
  const fallbackId = fileRow?.session_id ?? "ses_default"
  return {
    sessionId: fallbackId,
    sessionID: fallbackId,
    rootSessionId: fallbackId,
    rootSessionID: fallbackId,
    resolvedChildSessionID: null,
    source: "sqlite_latest_root",
  }
}

function isLikelySessionId(db: Database, candidate: string): boolean {
  if (candidate.startsWith("ses_")) return true
  if (candidate.includes("/") || candidate.includes("\\") || candidate.startsWith(".")) return false
  if (existsSync(candidate)) {
    try {
      if (statSync(candidate).isDirectory()) return false
    } catch {
      // ignore stat errors
    }
  }
  const hasSession = db
    .query(
      "SELECT 1 FROM session WHERE id = ? UNION SELECT 1 FROM file_read_ledger WHERE session_id = ? UNION SELECT 1 FROM provenance_chain WHERE root_session_id = ? LIMIT 1",
    )
    .get(candidate, candidate, candidate)
  return Boolean(hasSession)
}

function computeFullDiskShaForPath(
  canonicalRoot: string | undefined,
  rawPath: string,
  normPath: string,
  memo: Map<string, string | null>,
): string | null {
  if (!canonicalRoot && !path.isAbsolute(rawPath)) return null
  const cacheKey = `${canonicalRoot ?? ""}::${normPath}::${rawPath}`
  if (memo.has(cacheKey)) {
    return memo.get(cacheKey)!
  }

  const absResolved = resolveDiskPath(rawPath, canonicalRoot)
  const candidates = path.isAbsolute(rawPath)
    ? [rawPath, ...(canonicalRoot ? [path.join(canonicalRoot, normPath)] : [])]
    : [
        absResolved,
        ...(canonicalRoot ? [path.join(canonicalRoot, normPath), path.join(canonicalRoot, rawPath)] : []),
      ]

  for (const absPath of candidates) {
    if (absPath && existsSync(absPath)) {
      try {
        const st = statSync(absPath)
        if (st.isFile()) {
          const sha = sha256Hex(readFileSync(absPath))
          memo.set(cacheKey, sha)
          return sha
        }
      } catch {
        // ignore read error
      }
    }
  }

  memo.set(cacheKey, null)
  return null
}

function extractCaptureBounds(row: FileReadLedgerRow): {
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number | null
  readonly isTruncated: boolean
  readonly explicitPartialSlice: boolean
} {
  const lineRange = row.line_range ?? ""
  const rangeMatch = /L(\d+)-L(\d+)(?:\s+of\s+(\d+))?/.exec(lineRange)
  const parsedStart = rangeMatch ? Number.parseInt(rangeMatch[1]!, 10) : null
  const parsedEnd = rangeMatch ? Number.parseInt(rangeMatch[2]!, 10) : null
  const parsedTotal = rangeMatch?.[3] ? Number.parseInt(rangeMatch[3]!, 10) : null

  const startLine =
    typeof row.start_line === "number" && row.start_line > 0
      ? row.start_line
      : (parsedStart ?? 1)
  const totalLines =
    typeof row.total_lines === "number" && row.total_lines > 0
      ? row.total_lines
      : parsedTotal

  const isTruncated =
    Boolean(row.is_truncated) ||
    lineRange.startsWith("SLICE ") ||
    lineRange.includes("truncated") ||
    isSliceStatus(row.staleness_status ?? "")

  const endLine =
    typeof row.end_line === "number" && row.end_line >= startLine
      ? row.end_line
      : parsedEnd && parsedEnd >= startLine
        ? parsedEnd
        : (totalLines ?? 1_000_000)

  const explicitPartialSlice =
    isTruncated ||
    startLine > 1 ||
    (totalLines !== null && endLine < totalLines)

  return {
    startLine,
    endLine,
    totalLines,
    isTruncated,
    explicitPartialSlice,
  }
}

/**
 * Reconciles recorded `read_blob_sha` and `repair_blob_sha` in `file_read_ledger` and `provenance_chain`
 * against live working-tree file SHA-256 hashes (slice-aware via `computeDiskSliceSha` or supplied `currentDiskHashes`) in < 2 ms.
 *
 * Supports both calling conventions:
 * - `reconcileProvenanceStaleness(db, canonicalRoot, sessionId?)`
 * - `reconcileProvenanceStaleness(db, sessionId, currentDiskHashesOrOptions?)`
 */
export function reconcileProvenanceStaleness(
  db: Database,
  secondArg?:
    | string
    | {
        readonly canonicalRoot?: string
        readonly projectRoot?: string
        readonly rootDir?: string
        readonly sessionId?: string
        readonly sessionID?: string
        readonly currentDiskHashes?: ReadonlyMap<string, string> | Record<string, string>
      },
  thirdArg?:
    | string
    | ReadonlyMap<string, string>
    | Record<string, string>
    | {
        readonly canonicalRoot?: string
        readonly projectRoot?: string
        readonly rootDir?: string
        readonly sessionId?: string
        readonly sessionID?: string
        readonly currentDiskHashes?: ReadonlyMap<string, string> | Record<string, string>
      },
): StalenessReconciliationResult {
  const t0 = performance.now()
  ensureContinuitySchema(db)

  let canonicalRoot: string | undefined
  let explicitSessionId: string | undefined
  let currentDiskHashes: ReadonlyMap<string, string> | Record<string, string> | undefined
  let calledWithCanonicalRoot = false

  if (typeof secondArg === "string") {
    if (typeof thirdArg === "string") {
      canonicalRoot = secondArg
      explicitSessionId = thirdArg
      calledWithCanonicalRoot = true
    } else if (isLikelySessionId(db, secondArg)) {
      explicitSessionId = secondArg
      if (thirdArg instanceof Map) {
        currentDiskHashes = thirdArg
      } else if (thirdArg && typeof thirdArg === "object") {
        const maybeOpts = thirdArg as Record<string, unknown>
        if (
          "canonicalRoot" in maybeOpts ||
          "projectRoot" in maybeOpts ||
          "rootDir" in maybeOpts ||
          "currentDiskHashes" in maybeOpts
        ) {
          canonicalRoot = (maybeOpts.canonicalRoot ??
            maybeOpts.projectRoot ??
            maybeOpts.rootDir) as string | undefined
          currentDiskHashes = maybeOpts.currentDiskHashes as
            | ReadonlyMap<string, string>
            | Record<string, string>
            | undefined
          if (canonicalRoot) calledWithCanonicalRoot = true
        } else {
          currentDiskHashes = thirdArg as Record<string, string>
        }
      }
    } else {
      canonicalRoot = secondArg
      calledWithCanonicalRoot = true
      if (thirdArg && typeof thirdArg === "object" && !(thirdArg instanceof Map)) {
        const maybeOpts = thirdArg as Record<string, unknown>
        explicitSessionId = (maybeOpts.sessionID ?? maybeOpts.sessionId) as string | undefined
        currentDiskHashes = maybeOpts.currentDiskHashes as
          | ReadonlyMap<string, string>
          | Record<string, string>
          | undefined
      }
    }
  } else if (secondArg && typeof secondArg === "object") {
    canonicalRoot = secondArg.canonicalRoot ?? secondArg.projectRoot ?? secondArg.rootDir
    explicitSessionId = secondArg.sessionID ?? secondArg.sessionId
    currentDiskHashes = secondArg.currentDiskHashes
    if (canonicalRoot) calledWithCanonicalRoot = true
  }

  const resolved = resolveDefaultSessionId(db, explicitSessionId)
  const sessionId = resolved.sessionId
  const hashMap = toHashMap(currentDiskHashes)
  const diskMemo = new Map<string, string | null>()
  const nowIso = new Date().toISOString()

  cleanupProvenanceChainsForSession(db, sessionId)

  const fileRowsBefore = db
    .query(
      `SELECT session_id, path, normalized_path, line_range, start_line, end_line,
              total_lines, is_truncated, blob_sha, blob_sha256, read_blob_sha, read_seq,
              disk_blob_sha, staleness_status
       FROM file_read_ledger
       WHERE session_id = ?
       ORDER BY read_seq ASC, path ASC`,
    )
    .all(sessionId) as FileReadLedgerRow[]

  const chainRowsBefore = db
    .query(
      "SELECT * FROM provenance_chain WHERE root_session_id = ? OR session_id = ? ORDER BY chain_id ASC",
    )
    .all(sessionId, sessionId) as ProvenanceChainRow[]

  const updateFileStmt = db.prepare(
    "UPDATE file_read_ledger SET line_range = ?, disk_blob_sha = ?, staleness_status = ? WHERE session_id = ? AND path = ?",
  )
  const updateChainStmt = db.prepare(
    "UPDATE provenance_chain SET disk_blob_sha = ?, staleness_status = ?, updated_at = ? WHERE chain_id = ?",
  )
  const updateDigestGateStmt = db.prepare(
    "UPDATE session_semantic_digest SET verification_state = ? WHERE session_id = ? OR root_id = ?",
  )

  const transitionedFilePaths: string[] = []
  const transitionedChainIds: string[] = []
  const updatedFiles: FileReadLedgerRow[] = []
  const updatedChains: ProvenanceChainRow[] = []

  const tx = db.transaction(() => {
    for (const row of fileRowsBefore) {
      const norm = normalizeRepoPath(row.path, canonicalRoot)
      const recordedSha = stripBlobPrefix(row.read_blob_sha || row.blob_sha256 || row.blob_sha)
      const rawBlobSha = stripBlobPrefix(row.blob_sha256 || row.blob_sha || row.read_blob_sha)
      const bounds = extractCaptureBounds(row)
      const overrideHash = hashMap.get(row.path) ?? hashMap.get(norm)

      let nextDiskSha = row.disk_blob_sha || recordedSha
      let nextStatus: FileStalenessStatus = row.staleness_status
      let nextLineRange = sanitizeLineRange(row.line_range, bounds.totalLines, bounds.endLine)

      if (overrideHash !== undefined) {
        nextDiskSha = stripBlobPrefix(overrideHash)
        const matches = hashesMatch(recordedSha, nextDiskSha)
        if (matches) {
          nextStatus = bounds.explicitPartialSlice
            ? formatStalenessStatus("SLICE", bounds.startLine, bounds.endLine, bounds.totalLines)
            : "FRESH — DO NOT REREAD"
        } else {
          nextStatus = "STALE (modified since read/review — re-verify slice)"
        }
      } else {
        const absPath =
          canonicalRoot || path.isAbsolute(row.path)
            ? resolveDiskPath(row.path, canonicalRoot)
            : ""

        if (canonicalRoot || (absPath && existsSync(absPath))) {
          const reconciled = computeDiskSliceSha(absPath, {
            startLine: bounds.startLine,
            endLine: bounds.endLine,
            totalLines: bounds.totalLines,
            isTruncated: bounds.isTruncated,
            sliceSha: recordedSha,
            rawBlobSha,
          })
          nextStatus = reconciled.stalenessStatus
          if (reconciled.state === "FRESH") {
            nextDiskSha = reconciled.diskFullSha ?? recordedSha
            nextLineRange = sanitizeLineRange(
              row.line_range,
              reconciled.currentTotalLines ?? bounds.totalLines,
              bounds.endLine,
            )
          } else if (reconciled.state === "SLICE") {
            nextDiskSha = reconciled.diskSliceSha ?? recordedSha
            nextLineRange = sanitizeLineRange(
              reconciled.lineRange,
              reconciled.currentTotalLines ?? bounds.totalLines,
              bounds.endLine,
            )
          } else {
            nextDiskSha =
              reconciled.diskSliceSha ??
              reconciled.diskFullSha ??
              "missing"
            nextLineRange = sanitizeLineRange(
              row.line_range,
              reconciled.currentTotalLines ?? bounds.totalLines,
              bounds.endLine,
            )
          }
        } else {
          const matches = hashesMatch(recordedSha, nextDiskSha)
          if (matches) {
            nextStatus = bounds.explicitPartialSlice
              ? formatStalenessStatus("SLICE", bounds.startLine, bounds.endLine, bounds.totalLines)
              : "FRESH — DO NOT REREAD"
          } else {
            nextStatus = "STALE (modified since read/review — re-verify slice)"
          }
        }
      }

      if (
        nextDiskSha !== row.disk_blob_sha ||
        nextStatus !== row.staleness_status ||
        nextLineRange !== row.line_range
      ) {
        updateFileStmt.run(nextLineRange, nextDiskSha, nextStatus, row.session_id, row.path)
        transitionedFilePaths.push(row.path)
      }
      updatedFiles.push({
        ...row,
        line_range: nextLineRange,
        disk_blob_sha: nextDiskSha,
        staleness_status: nextStatus,
      })
    }

    for (const chain of chainRowsBefore) {
      const norm = normalizeRepoPath(chain.target_path, canonicalRoot)
      const expectedSha =
        chain.repair_blob_sha ||
        chain.read_or_review_blob_sha ||
        chain.receipt_blob_sha ||
        chain.disk_blob_sha
      const overrideHash = hashMap.get(chain.target_path) ?? hashMap.get(norm)
      const exitCode = chain.verification_exit_code ?? chain.receipt_exit_code ?? 0
      const preferLowercaseFresh =
        calledWithCanonicalRoot || chain.staleness_status === "verified_fresh"

      const matchingFile = updatedFiles.find(
        (f) =>
          f.path === chain.target_path ||
          normalizeRepoPath(f.path, canonicalRoot) === norm,
      )

      let nextDiskSha: string
      let nextStatus: ProvenanceStalenessStatus

      if (overrideHash === undefined && matchingFile) {
        if (
          isSliceStatus(matchingFile.staleness_status) &&
          (hashesMatch(expectedSha, matchingFile.read_blob_sha) ||
            hashesMatch(expectedSha, matchingFile.disk_blob_sha))
        ) {
          nextDiskSha = matchingFile.disk_blob_sha || expectedSha
          nextStatus = "SLICE_FRESH"
        } else if (
          matchingFile.staleness_status === "FRESH — DO NOT REREAD" &&
          (hashesMatch(expectedSha, matchingFile.disk_blob_sha) ||
            hashesMatch(expectedSha, matchingFile.read_blob_sha))
        ) {
          nextDiskSha = matchingFile.disk_blob_sha || expectedSha
          nextStatus = preferLowercaseFresh ? "verified_fresh" : "VERIFIED_FRESH"
        } else if (!isFreshOrSliceStatus(matchingFile.staleness_status)) {
          nextDiskSha = matchingFile.disk_blob_sha || "missing"
          nextStatus =
            exitCode === 0 || exitCode === null
              ? "verified_stale_by_later_touch"
              : "STALE (modified since read/review — re-verify slice)"
        } else {
          const liveDiskSha = computeFullDiskShaForPath(
            canonicalRoot,
            chain.target_path,
            norm,
            diskMemo,
          )
          nextDiskSha =
            liveDiskSha ??
            (canonicalRoot ? "missing" : chain.disk_blob_sha || expectedSha)
          nextStatus = classifyProvenanceStaleness({
            expectedBlobSha: expectedSha,
            diskBlobSha: nextDiskSha,
            verificationExitCode: exitCode,
            preferLowercaseFresh,
          })
        }
      } else {
        const liveDiskSha =
          overrideHash ?? computeFullDiskShaForPath(canonicalRoot, chain.target_path, norm, diskMemo)
        nextDiskSha =
          liveDiskSha ??
          (canonicalRoot ? "missing" : chain.disk_blob_sha || expectedSha)
        nextStatus = classifyProvenanceStaleness({
          expectedBlobSha: expectedSha,
          diskBlobSha: nextDiskSha,
          verificationExitCode: exitCode,
          preferLowercaseFresh,
        })
      }

      if (nextDiskSha !== chain.disk_blob_sha || nextStatus !== chain.staleness_status) {
        updateChainStmt.run(nextDiskSha, nextStatus, nowIso, chain.chain_id)
        transitionedChainIds.push(chain.chain_id)
      }
      updatedChains.push({
        ...chain,
        disk_blob_sha: nextDiskSha,
        staleness_status: nextStatus,
        updated_at: nowIso,
      })
    }

    const hasStaleChain = updatedChains.some(
      (c) =>
        c.staleness_status === "verified_stale_by_later_touch" ||
        c.staleness_status === "STALE_BY_LATER_TOUCH" ||
        c.staleness_status.startsWith("STALE"),
    )
    const hasStaleFile = updatedFiles.some((f) => !isFreshOrSliceStatus(f.staleness_status))
    const allChainsFresh =
      updatedChains.length > 0 &&
      updatedChains.every(
        (c) =>
          c.staleness_status === "VERIFIED_FRESH" ||
          c.staleness_status === "verified_fresh" ||
          c.staleness_status === "SLICE_FRESH" ||
          c.staleness_status === "FRESH — DO NOT REREAD",
      )

    if (hasStaleChain || (hasStaleFile && (updatedChains.length > 0 || transitionedFilePaths.length > 0))) {
      updateDigestGateStmt.run("verified_stale_by_later_touch", sessionId, sessionId)
    } else if (allChainsFresh && !hasStaleFile) {
      updateDigestGateStmt.run("verified_passed", sessionId, sessionId)
    }
  })
  tx()

  const freshFiles = updatedFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status))
  const sliceFiles = updatedFiles.filter((f) => isSliceStatus(f.staleness_status))
  const staleFiles = updatedFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status))

  const verifiedFreshChainsCount = updatedChains.filter(
    (c) =>
      c.staleness_status === "VERIFIED_FRESH" ||
      c.staleness_status === "verified_fresh" ||
      c.staleness_status === "SLICE_FRESH" ||
      c.staleness_status === "FRESH — DO NOT REREAD",
  ).length
  const staleChainsCount = updatedChains.length - verifiedFreshChainsCount
  const elapsedMs = performance.now() - t0

  return {
    sessionId,
    sessionID: sessionId,
    totalFilesChecked: updatedFiles.length,
    freshFilesCount: freshFiles.length,
    sliceFilesCount: sliceFiles.length,
    staleFilesCount: staleFiles.length,
    freshFiles,
    sliceFiles,
    staleFiles,
    totalChainsChecked: updatedChains.length,
    verifiedFreshChainsCount,
    staleChainsCount,
    transitionedFilePaths,
    transitionedChainIds,
    fileRows: updatedFiles,
    chainRows: updatedChains,
    elapsedMs,
  }
}

function selectFilesForPacket(
  allFiles: readonly FileReadLedgerRow[],
): readonly FileReadLedgerRow[] {
  const stale = allFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status))
  const fresh = allFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status))
  return [...stale, ...fresh.slice(0, Math.max(0, 14 - stale.length))]
}

function selectSkillsForPacket(
  allSkills: readonly SkillLoadLedgerRow[],
): readonly SkillLoadLedgerRow[] {
  return allSkills.slice(0, 12)
}

/**
 * Synthesizes a deterministic `< 1,200`-token `CompactionContinuationPacket` across all 6 required sections:
 * `Headline & Gate`, `Intent Pivot Timeline`, `Working-Memory Manifest`, `Delegation Trajectory`,
 * `Provenance Chain`, and `Tier-1 RepoMap & Co-Change Alerts`, persisting it into `compaction_continuation_ledger`.
 */
export function buildCompactionContinuationPacket(
  db: Database,
  sessionIdOrOptions?: string | CompactionPacketOptions,
  maybeOptions?: CompactionPacketOptions,
): CompactionContinuationPacket {
  ensureContinuitySchema(db)

  let explicitSessionId: string | undefined
  let options: CompactionPacketOptions = {}

  if (typeof sessionIdOrOptions === "string") {
    explicitSessionId = sessionIdOrOptions
    options = maybeOptions ?? {}
  } else if (sessionIdOrOptions && typeof sessionIdOrOptions === "object") {
    options = sessionIdOrOptions
    explicitSessionId = options.sessionID ?? options.sessionId
  } else if (maybeOptions) {
    options = maybeOptions
    explicitSessionId = options.sessionID ?? options.sessionId
  }

  const resolved = resolveDefaultSessionId(db, explicitSessionId, options.hookContext)
  const sessionId = resolved.sessionId
  const maxTokensBudget = options.maxTokens ?? options.maxTokensBudget ?? 1200
  const requestedSeq = options.compactionSeq ?? options.seq
  const canonicalRoot = options.canonicalRoot ?? options.projectRoot ?? options.rootDir

  cleanupProvenanceChainsForSession(db, sessionId)

  if (options.currentDiskHashes || canonicalRoot) {
    reconcileProvenanceStaleness(db, {
      sessionID: sessionId,
      canonicalRoot,
      currentDiskHashes: options.currentDiskHashes,
    })
  }

  const compactionRow = (
    requestedSeq !== undefined
      ? db
          .query(
            "SELECT session_id, seq, reason, status, summary_ref, tok_input FROM compaction WHERE session_id = ? AND seq = ? LIMIT 1",
          )
          .get(sessionId, requestedSeq)
      : db
          .query(
            "SELECT session_id, seq, reason, status, summary_ref, tok_input FROM compaction WHERE session_id = ? ORDER BY seq DESC LIMIT 1",
          )
          .get(sessionId)
  ) as {
    session_id: string
    seq: number
    reason: string | null
    status: string | null
    summary_ref: string | null
    tok_input: number | null
  } | null

  const compactionSeq = compactionRow?.seq ?? requestedSeq ?? 0
  const compactionReason = compactionRow?.reason ?? "auto"
  const compactionTokensInput = compactionRow?.tok_input ?? 0

  const digestRow = db
    .query(
      "SELECT headline, verification_state, touched_files_json FROM session_semantic_digest WHERE session_id = ? LIMIT 1",
    )
    .get(sessionId) as {
    headline: string
    verification_state: string
    touched_files_json: string
  } | null

  const headline = digestRow?.headline ?? `[Root] Session ${sessionId}`

  // 1. Intent Pivots
  const pivots = db
    .query(
      "SELECT seq, pivot_kind, prompt_excerpt, blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT 5",
    )
    .all(sessionId) as {
    seq: number
    pivot_kind: string
    prompt_excerpt: string
    blob_ref: string
  }[]

  // 2. Working-Memory Manifest (Skills + Files with Staleness)
  const allSkills = db
    .query(
      "SELECT session_id, skill_name, blob_sha, blob_ref, load_seq, status FROM skill_load_ledger WHERE session_id = ? ORDER BY load_seq ASC",
    )
    .all(sessionId) as SkillLoadLedgerRow[]
  const packetSkills = selectSkillsForPacket(allSkills)

  const allFilesRaw = db
    .query(
      "SELECT session_id, path, line_range, start_line, end_line, total_lines, is_truncated, read_blob_sha, read_seq, disk_blob_sha, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC",
    )
    .all(sessionId) as FileReadLedgerRow[]
  const allFiles = allFilesRaw.map((f) => ({
    ...f,
    line_range: sanitizeLineRange(f.line_range, f.total_lines, f.end_line),
  }))
  const packetFiles = selectFilesForPacket(allFiles)
  const staleFiles = allFiles.filter((f) => !isFreshOrSliceStatus(f.staleness_status))
  const freshFiles = packetFiles.filter((f) => isFreshOrSliceStatus(f.staleness_status))
  const sliceFiles = freshFiles.filter((f) => isSliceStatus(f.staleness_status))
  const fullFreshFiles = freshFiles.filter((f) => !isSliceStatus(f.staleness_status))

  // 3. Delegation Trajectory & Verified Outcomes
  const delegationTurns = db
    .query(
      `SELECT call_id, turn_index, child_session_id, mode, harness, agent,
              reported_outcome, verified_outcome, tool_error_count, blocker_summary
       FROM delegation_turn
       WHERE parent_session_id = ?
       ORDER BY start_seq ASC, turn_index ASC`,
    )
    .all(sessionId) as {
    call_id: string
    turn_index: number
    child_session_id: string
    mode: string
    harness: string
    agent: string | null
    reported_outcome: string | null
    verified_outcome: string
    tool_error_count: number
    blocker_summary: string | null
  }[]

  const flaggedDelegations = delegationTurns
    .filter(
      (d) =>
        d.verified_outcome === "blocked_in_text" ||
        d.verified_outcome === "tool_error_inside" ||
        d.tool_error_count > 0,
    )
    .sort((a, b) => b.tool_error_count - a.tool_error_count)

  // 4. Provenance Chains
  const provenanceChains = db
    .query(
      "SELECT * FROM provenance_chain WHERE root_session_id = ? OR session_id = ? ORDER BY chain_id ASC",
    )
    .all(sessionId, sessionId) as ProvenanceChainRow[]
  const staleChains = provenanceChains.filter(
    (c) =>
      c.staleness_status === "verified_stale_by_later_touch" ||
      c.staleness_status === "STALE_BY_LATER_TOUCH" ||
      c.staleness_status === "STALE (modified since read/review — re-verify slice)",
  )

  const stalePathsList = [
    ...new Set([
      ...staleChains.map((c) => c.target_path),
      ...staleFiles.map((f) => f.path),
    ]),
  ]

  const verificationGateStatus =
    staleChains.length > 0
      ? "verified_stale_by_later_touch"
      : (digestRow?.verification_state ??
        (provenanceChains.length > 0 && staleFiles.length === 0
          ? "verified_passed"
          : "in_progress_or_unverified"))
  const formattedGateLabel = formatVerificationGateLabel(verificationGateStatus, stalePathsList)

  // 5. Compact Top-Centrality RepoMap & Co-Change Alerts
  const topCodeFiles = db
    .query(
      "SELECT path, pagerank, loc, skeleton_tokens FROM code_file ORDER BY pagerank DESC LIMIT 4",
    )
    .all() as { path: string; pagerank: number; loc: number; skeleton_tokens: number }[]

  const topSymbolsStmt = db.prepare(
    "SELECT name, start_line, end_line FROM code_symbol WHERE path = ? AND depth = 1 AND exported = 1 ORDER BY start_line ASC LIMIT 1",
  )

  const cochangeAlerts = db
    .query(
      `SELECT file_a, file_b, co_commits, prob_a_given_b, prob_b_given_a, has_static_edge
       FROM git_cochange
       WHERE (prob_a_given_b >= 0.40 OR prob_b_given_a >= 0.40)
       ORDER BY has_static_edge ASC, co_commits DESC, MAX(prob_a_given_b, prob_b_given_a) DESC
       LIMIT 3`,
    )
    .all() as {
    file_a: string
    file_b: string
    co_commits: number
    prob_a_given_b: number
    prob_b_given_a: number
    has_static_edge: number
  }[]

  const lines: string[] = []
  const headlineAndGateLine = `**Headline:** ${headline} | **Gate:** \`${formattedGateLabel}\` | **Session:** \`${sessionId}\``
  lines.push(
    `## Substrate Continuity · Headline & Gate · \`${sessionId}\` (seq=${compactionSeq}, ${compactionReason}, ${compactionTokensInput} tok_in)`,
  )
  lines.push(headlineAndGateLine)

  // Section 1: Intent Pivot Timeline
  lines.push("", `### 1. Intent Pivot Timeline (${pivots.length})`)
  if (pivots.length === 0) {
    lines.push(`- \`seq=1\` [initial_goal] ${headline} (\`blob:000000000000\`)`)
  } else {
    for (const p of pivots) {
      const clean = p.prompt_excerpt.replace(/\s+/g, " ").trim().slice(0, 38)
      lines.push(`- \`seq=${p.seq}\` [${p.pivot_kind}] ${clean} (\`${shortBlobRef(p.blob_ref)}\`)`)
    }
  }

  // Section 2: Working-Memory Manifest
  lines.push(
    "",
    `### 2. Working-Memory Manifest (FRESH=${freshFiles.length}, SLICE=${sliceFiles.length}, STALE=${staleFiles.length}, Skills=${packetSkills.length})`,
  )
  if (packetSkills.length > 0) {
    const skillTokens = packetSkills
      .map((s) => `@${s.skill_name}(${s.blob_sha.slice(0, 6)})`)
      .join(", ")
    lines.push(`- **Skills (ACTIVE — DO NOT RE-INVOKE):** ${skillTokens}`)
  }
  if (staleFiles.length > 0) {
    for (const sf of staleFiles) {
      lines.push(
        `- **${sf.staleness_status}:** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`,
      )
    }
  }
  if (sliceFiles.length > 0) {
    for (const sl of sliceFiles) {
      lines.push(
        `- **${sl.staleness_status}:** \`${sl.path}#${sl.line_range}\` (\`${shortBlobRef(sl.read_blob_sha)}\`)`,
      )
    }
  }
  if (fullFreshFiles.length > 0) {
    const freshEntries = fullFreshFiles
      .map((f) => `${f.path}#${f.line_range}(${f.read_blob_sha.slice(0, 6)})`)
      .join(", ")
    lines.push(`- **FRESH — DO NOT REREAD:** ${freshEntries}`)
  }

  // Section 3: Delegation Trajectory
  lines.push(
    "",
    `### 3. Delegation Trajectory (${delegationTurns.length} turns, ${flaggedDelegations.length} flagged)`,
  )
  const toolErrorTurn = flaggedDelegations.find((d) => d.verified_outcome === "tool_error_inside")
  const blockedTextTurn = flaggedDelegations.find((d) => d.verified_outcome === "blocked_in_text")
  const prioritizedFlagged = [
    ...(toolErrorTurn ? [toolErrorTurn] : []),
    ...(blockedTextTurn && blockedTextTurn !== toolErrorTurn ? [blockedTextTurn] : []),
    ...flaggedDelegations.filter((d) => d !== toolErrorTurn && d !== blockedTextTurn),
  ]
  const turnsToRender =
    prioritizedFlagged.length > 0
      ? [
          ...prioritizedFlagged.slice(0, 2),
          ...delegationTurns.filter((d) => !prioritizedFlagged.includes(d)).slice(0, 1),
        ].slice(0, 2)
      : delegationTurns.slice(0, 2)
  for (const d of turnsToRender) {
    const blockerSuffix = d.blocker_summary
      ? ` — ${d.blocker_summary.replace(/\s+/g, " ").slice(0, 38)}`
      : ""
    lines.push(
      `- \`${d.child_session_id}\` (t${d.turn_index} ${d.harness}): reported=\`${d.reported_outcome ?? "unknown"}\` -> verified=\`${d.verified_outcome}\` (err=${d.tool_error_count})${blockerSuffix}`,
    )
  }

  // Section 4: Provenance Chain
  lines.push(
    "",
    `### 4. Provenance Chain (${provenanceChains.length} chains, ${staleChains.length} stale)`,
  )
  for (const c of provenanceChains) {
    const statusLabel = formatProvenanceStatusLabel(c.staleness_status)
    const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha
    const decSeq = c.decision_pivot_seq ?? c.decision_seq ?? 0
    const exitCode = c.verification_exit_code ?? c.receipt_exit_code ?? "none"
    lines.push(
      `- \`${c.finding_id}\` (seq=${decSeq}, \`${c.child_session_id ?? "root"}\`) -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`, exit=${exitCode}) => **${statusLabel}**`,
    )
  }

  // Section 5: Tier-1 RepoMap & Co-Change Alerts
  lines.push("", `### 5. Tier-1 RepoMap & Co-Change Alerts`)
  const repoItems: string[] = []
  for (const cf of topCodeFiles) {
    const syms = (
      topSymbolsStmt.all(cf.path) as { name: string; start_line: number; end_line: number }[]
    )
      .map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`)
      .join(",")
    repoItems.push(`\`${cf.path}\`(PR=${cf.pagerank.toFixed(3)}${syms ? `:${syms}` : ""})`)
  }
  lines.push(`- **RepoMap:** ${repoItems.join("; ")}`)

  const cochangeItems = cochangeAlerts.map((cc) => {
    const maxProb = Math.max(cc.prob_a_given_b, cc.prob_b_given_a) * 100
    const edgeTag = cc.has_static_edge === 0 ? "HIDDEN" : "static"
    return `\`${cc.file_a}<->${cc.file_b}\`(${maxProb.toFixed(1)}%,${edgeTag})`
  })
  lines.push(`- **Co-Change:** ${cochangeItems.join("; ")}`)

  let markdown = lines.join("\n")
  const maxChars = Math.max(200, (maxTokensBudget - 1) * 4)
  if (markdown.length > maxChars) {
    markdown = markdown.slice(0, maxChars - 16) + "\n...(truncated)"
  }

  const charCount = markdown.length
  const tokenCount = estimateTokens(markdown)
  const nowIso = new Date().toISOString()

  db.query(
    `INSERT OR REPLACE INTO compaction_continuation_ledger (
      session_id, compaction_seq, compaction_reason, reason, tok_input,
      headline, verification_gate_status, packet_markdown, packet_chars,
      packet_tokens, fresh_files_count, stale_files_count,
      active_skills_count, provenance_chains_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    compactionSeq,
    compactionReason,
    compactionReason,
    compactionTokensInput,
    headline,
    verificationGateStatus,
    markdown,
    charCount,
    tokenCount,
    freshFiles.length,
    staleFiles.length,
    packetSkills.length,
    provenanceChains.length,
    nowIso,
    nowIso,
  )

  return {
    sessionId,
    sessionID: sessionId,
    compactionSeq,
    compactionReason,
    compactionTokensInput,
    headline,
    verificationGateStatus,
    markdown,
    charCount,
    tokenCount,
    tokenEstimate: tokenCount,
    withinBudget: tokenCount < maxTokensBudget,
    sections: {
      headlineAndGate: headlineAndGateLine,
      intentPivotsCount: pivots.length,
      activeSkillsCount: packetSkills.length,
      filesReadCount: packetFiles.length,
      freshFilesCount: freshFiles.length,
      staleFilesCount: staleFiles.length,
      delegationTurnsCount: delegationTurns.length,
      flaggedDelegationCount: flaggedDelegations.length,
      provenanceChainsCount: provenanceChains.length,
      staleProvenanceCount: staleChains.length,
      repoMapFilesCount: topCodeFiles.length,
      cochangeAlertsCount: cochangeAlerts.length,
    },
  }
}

/**
 * Renders the Provenance & Staleness report for `substrate.viewport({ action: "provenance" })`.
 */
export function renderProvenanceReport(
  db: Database,
  sessionId?: string,
  optionsOrCanonicalRoot?:
    | string
    | {
        readonly canonicalRoot?: string
        readonly hookContext?: SubstrateHookContext
        readonly currentDiskHashes?: ReadonlyMap<string, string> | Record<string, string>
      },
): string {
  ensureContinuitySchema(db)
  const options =
    typeof optionsOrCanonicalRoot === "string"
      ? { canonicalRoot: optionsOrCanonicalRoot }
      : optionsOrCanonicalRoot
  const resolved = resolveDefaultSessionId(db, sessionId, options?.hookContext)
  const targetSessionId = resolved.sessionId

  cleanupProvenanceChainsForSession(db, targetSessionId)

  if (options?.canonicalRoot || options?.currentDiskHashes) {
    reconcileProvenanceStaleness(db, {
      sessionID: targetSessionId,
      canonicalRoot: options.canonicalRoot,
      currentDiskHashes: options.currentDiskHashes,
    })
  }

  const chains = db
    .query(
      "SELECT * FROM provenance_chain WHERE root_session_id = ? OR session_id = ? ORDER BY chain_id ASC",
    )
    .all(targetSessionId, targetSessionId) as ProvenanceChainRow[]
  const filesRaw = db
    .query("SELECT * FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC")
    .all(targetSessionId) as FileReadLedgerRow[]
  const files = filesRaw.map((f) => ({
    ...f,
    line_range: sanitizeLineRange(f.line_range, f.total_lines, f.end_line),
  }))
  const freshFiles = files.filter((f) => isFreshOrSliceStatus(f.staleness_status))
  const sliceFiles = files.filter((f) => isSliceStatus(f.staleness_status))
  const fullFreshFiles = freshFiles.filter((f) => !isSliceStatus(f.staleness_status))
  const staleFiles = files.filter((f) => !isFreshOrSliceStatus(f.staleness_status))

  const digestRow = db
    .query("SELECT verification_state FROM session_semantic_digest WHERE session_id = ? LIMIT 1")
    .get(targetSessionId) as { verification_state: string } | null
  const staleChainPaths = chains
    .filter(
      (c) =>
        c.staleness_status === "verified_stale_by_later_touch" ||
        c.staleness_status === "STALE_BY_LATER_TOUCH" ||
        c.staleness_status.startsWith("STALE"),
    )
    .map((c) => c.target_path)
  const stalePathsList = [...new Set([...staleChainPaths, ...staleFiles.map((f) => f.path)])]
  const rawGateState =
    staleChainPaths.length > 0
      ? "verified_stale_by_later_touch"
      : (digestRow?.verification_state ??
        (chains.length > 0 && staleFiles.length === 0 ? "verified_passed" : "unverified"))
  const gateLabel = formatVerificationGateLabel(rawGateState, stalePathsList)

  const lines = [
    `## Provenance & Staleness Ledger · \`${targetSessionId}\``,
    `**Gate:** \`${gateLabel}\``,
    ...chains.map((c) => {
      const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha
      return `- \`${c.chain_id}\` (\`${c.finding_id}\`) -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`) | **${formatProvenanceStatusLabel(c.staleness_status)}** [${c.staleness_status}]`
    }),
    `- Files tracked: ${files.length} (${freshFiles.length} FRESH [${sliceFiles.length} SLICE], ${staleFiles.length} STALE)`,
    ...(fullFreshFiles.length > 0
      ? [
          `  - **FRESH — DO NOT REREAD:** ${fullFreshFiles
            .slice(0, 14)
            .map((f) => `\`${f.path}#${f.line_range}\`(${f.read_blob_sha.slice(0, 6)})`)
            .join(", ")}`,
        ]
      : []),
    ...sliceFiles.map(
      (sl) =>
        `  - **${sl.staleness_status}:** \`${sl.path}#${sl.line_range}\` (slice=\`${shortBlobRef(sl.read_blob_sha)}\`, disk=\`${shortBlobRef(sl.disk_blob_sha)}\`)`,
    ),
    ...staleFiles.map(
      (sf) =>
        `  - **${sf.staleness_status}:** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`,
    ),
  ]

  return lines.join("\n")
}

export const renderProvenanceViewport = renderProvenanceReport

export function recordCompactionSummaryHash(
  db: Database,
  sessionId: string,
  summaryText: string,
  compactionSeq?: number,
): string {
  ensureContinuitySchema(db)
  const summaryHash = sha256Hex(summaryText)
  if (compactionSeq !== undefined) {
    db.query(
      "UPDATE compaction_continuation_ledger SET summary_hash = ?, updated_at = ? WHERE session_id = ? AND compaction_seq = ?",
    ).run(summaryHash, new Date().toISOString(), sessionId, compactionSeq)
  } else {
    db.query(
      `UPDATE compaction_continuation_ledger
       SET summary_hash = ?, updated_at = ?
       WHERE session_id = ?
         AND compaction_seq = (
           SELECT MAX(compaction_seq) FROM compaction_continuation_ledger WHERE session_id = ?
         )`,
    ).run(summaryHash, new Date().toISOString(), sessionId, sessionId)
  }
  return summaryHash
}

export function applyCompactionContinuityHook(
  db: Database,
  compactionEvent: {
    readonly sessionID: string
    readonly seq?: number
    system: Array<{ readonly type: "text"; readonly text: string }>
  },
  options: CompactionPacketOptions = {},
): CompactionContinuationPacket {
  const packet = buildCompactionContinuationPacket(db, compactionEvent.sessionID, {
    ...options,
    seq: compactionEvent.seq ?? options.seq,
  })
  compactionEvent.system = [
    ...compactionEvent.system,
    {
      type: "text",
      text: packet.markdown,
    },
  ]
  return packet
}

export function querySubstrateContinuity(
  db: Database,
  input: SubstrateContinuityInput = {},
  hookContext?: SubstrateHookContext,
): SubstrateContinuityResult {
  ensureContinuitySchema(db)
  const action: SubstrateContinuityAction = input.action ?? "status"
  const resolved = resolveDefaultSessionId(db, input.sessionID, hookContext)
  const sessionId = resolved.sessionId

  if (action === "overview") {
    const rows = db
      .query(
        `SELECT c.session_id, c.seq, c.reason, c.tok_input, d.headline, d.verification_state
         FROM compaction c
         LEFT JOIN session_semantic_digest d ON d.session_id = c.session_id
         ORDER BY c.session_id, c.seq`,
      )
      .all() as {
      session_id: string
      seq: number
      reason: string
      tok_input: number
      headline: string | null
      verification_state: string | null
    }[]
    const lines = [
      `## Compaction Continuity Overview (${rows.length} compactions; default session: \`${sessionId}\`)`,
      ...rows.map(
        (r) =>
          `- \`${r.session_id}\` \`seq=${r.seq}\` (${r.reason}, ${r.tok_input} tok_in) | ${r.headline ?? "session"} | gate=\`${r.verification_state ?? "unknown"}\``,
      ),
    ]
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: lines.join("\n"),
      data: { compactions: rows, defaultSessionId: sessionId },
    }
  }

  if (action === "intents" || action === "timeline") {
    const pivots = db
      .query(
        "SELECT seq, message_id, pivot_kind, prompt_excerpt, blob_ref, t FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC",
      )
      .all(sessionId) as {
      seq: number
      message_id: string
      pivot_kind: string
      prompt_excerpt: string
      blob_ref: string
      t: string
    }[]
    const digest = db
      .query("SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ?")
      .get(sessionId) as { headline: string; verification_state: string } | null
    const lines = [
      `## Intent Pivot Timeline · \`${sessionId}\` (${pivots.length} pivots)`,
      `**Headline:** ${digest?.headline ?? sessionId} | **Gate:** \`${digest?.verification_state ?? "unknown"}\``,
      ...pivots.map(
        (p) => `- \`seq=${p.seq}\` [${p.pivot_kind}] ${p.prompt_excerpt} (\`${shortBlobRef(p.blob_ref)}\`)`,
      ),
    ]
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: lines.join("\n"),
      data: {
        sessionId,
        headline: digest?.headline ?? sessionId,
        verificationState: digest?.verification_state ?? "unknown",
        userIntents: pivots,
      },
    }
  }

  if (action === "provenance") {
    const chains = db
      .query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC")
      .all(sessionId) as ProvenanceChainRow[]
    const files = db
      .query("SELECT * FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC")
      .all(sessionId) as FileReadLedgerRow[]
    const staleFiles = files.filter((f) => !isFreshOrSliceStatus(f.staleness_status))
    const sliceFiles = files.filter((f) => isSliceStatus(f.staleness_status))
    const content = renderProvenanceReport(db, sessionId)
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content,
      data: {
        sessionId,
        provenanceChains: chains,
        staleFiles,
        sliceFiles,
        totalFiles: files.length,
      },
    }
  }

  if (action === "search" && input.query) {
    const q = `%${input.query.toLowerCase()}%`
    const matches = db
      .query(
        `SELECT session_id, headline, verification_state
         FROM session_semantic_digest
         WHERE lower(headline) LIKE ? OR lower(key_decisions_json) LIKE ? OR lower(touched_files_json) LIKE ?`,
      )
      .all(q, q, q) as { session_id: string; headline: string; verification_state: string }[]
    return {
      ok: true,
      action,
      resolvedSessionID: sessionId,
      resolutionSource: resolved.source,
      content: JSON.stringify(matches, null, 2),
      data: { query: input.query, matches },
    }
  }

  const packet = buildCompactionContinuationPacket(db, sessionId, { seq: input.seq })
  return {
    ok: true,
    action,
    resolvedSessionID: sessionId,
    resolutionSource: resolved.source,
    content: packet.markdown,
    data: {
      sessionId: packet.sessionId,
      compactionSeq: packet.compactionSeq,
      tokenCount: packet.tokenCount,
      withinBudget: packet.withinBudget,
      sections: packet.sections,
    },
  }
}

export interface CompactionBenchmarkEntry {
  readonly sessionId: string
  readonly seq: number
  readonly reason: string
  readonly tokInput: number
  readonly packetChars: number
  readonly packetTokens: number
  readonly within1200Budget: boolean
  readonly buildPacketMedianMs: number
  readonly buildPacketMinMs: number
  readonly buildPacketMaxMs: number
  readonly buildPacketSamplesMs: readonly number[]
  readonly reconcileMedianMs: number
  readonly reconcileMinMs: number
  readonly reconcileMaxMs: number
  readonly reconcileSamplesMs: readonly number[]
}

export interface CompactionBenchmarkReport {
  readonly samples: number
  readonly compactionsEvaluated: number
  readonly entries: readonly CompactionBenchmarkEntry[]
  readonly aggregateBuildPacketMedianMs: number
  readonly aggregateReconcileMedianMs: number
  readonly limiter: string
}

function computeStats(samples: readonly number[]): {
  readonly medianMs: number
  readonly minMs: number
  readonly maxMs: number
  readonly samplesMs: readonly number[]
} {
  if (samples.length === 0) {
    return { medianMs: 0, minMs: 0, maxMs: 0, samplesMs: [] }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    medianMs: Number(sorted[mid]!.toFixed(4)),
    minMs: Number(sorted[0]!.toFixed(4)),
    maxMs: Number(sorted[sorted.length - 1]!.toFixed(4)),
    samplesMs: sorted.map((n) => Number(n.toFixed(4))),
  }
}

export function runSevenSampleCompactionBenchmark(
  db: Database,
  samples = 7,
): CompactionBenchmarkReport {
  const compactionRows = db
    .query(
      "SELECT session_id, seq, COALESCE(reason, 'auto') as reason, COALESCE(tok_input, 0) as tok_input FROM compaction ORDER BY rowid ASC",
    )
    .all() as { session_id: string; seq: number; reason: string; tok_input: number }[]

  for (const c of compactionRows) {
    reconcileProvenanceStaleness(db, c.session_id)
    buildCompactionContinuationPacket(db, c.session_id, { seq: c.seq })
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);")

  const buildTimes = new Map<string, number[]>()
  const reconcileTimes = new Map<string, number[]>()
  const latestPackets = new Map<string, CompactionContinuationPacket>()

  for (const c of compactionRows) {
    const key = `${c.session_id}:${c.seq}`
    buildTimes.set(key, [])
    reconcileTimes.set(key, [])
  }

  for (let sampleIdx = 0; sampleIdx < samples; sampleIdx++) {
    const ordered = sampleIdx % 2 === 0 ? compactionRows : [...compactionRows].reverse()
    for (const c of ordered) {
      const key = `${c.session_id}:${c.seq}`

      const tRec0 = performance.now()
      reconcileProvenanceStaleness(db, c.session_id)
      const tRec1 = performance.now()
      reconcileTimes.get(key)!.push(tRec1 - tRec0)

      const tPkt0 = performance.now()
      const pkt = buildCompactionContinuationPacket(db, c.session_id, { seq: c.seq })
      const tPkt1 = performance.now()
      if (!pkt.withinBudget || pkt.tokenCount >= 1200 || pkt.charCount === 0) {
        throw new Error(
          `Completed-work or token-budget check failed for buildCompactionContinuationPacket(${key}): ${pkt.tokenCount} tokens`,
        )
      }
      buildTimes.get(key)!.push(tPkt1 - tPkt0)
      latestPackets.set(key, pkt)
    }
  }

  const entries: CompactionBenchmarkEntry[] = compactionRows.map((c) => {
    const key = `${c.session_id}:${c.seq}`
    const bStats = computeStats(buildTimes.get(key)!)
    const rStats = computeStats(reconcileTimes.get(key)!)
    const pkt = latestPackets.get(key)!
    return {
      sessionId: c.session_id,
      seq: c.seq,
      reason: c.reason,
      tokInput: c.tok_input,
      packetChars: pkt.charCount,
      packetTokens: pkt.tokenCount,
      within1200Budget: pkt.withinBudget,
      buildPacketMedianMs: bStats.medianMs,
      buildPacketMinMs: bStats.minMs,
      buildPacketMaxMs: bStats.maxMs,
      buildPacketSamplesMs: bStats.samplesMs,
      reconcileMedianMs: rStats.medianMs,
      reconcileMinMs: rStats.minMs,
      reconcileMaxMs: rStats.maxMs,
      reconcileSamplesMs: rStats.samplesMs,
    }
  })

  const allBuildMedians = entries.map((e) => e.buildPacketMedianMs)
  const allReconcileMedians = entries.map((e) => e.reconcileMedianMs)

  return {
    samples,
    compactionsEvaluated: entries.length,
    entries,
    aggregateBuildPacketMedianMs: computeStats(allBuildMedians).medianMs,
    aggregateReconcileMedianMs: computeStats(allReconcileMedians).medianMs,
    limiter:
      "In-process bun:sqlite B-tree index scans across intent_pivot, file_read_ledger, skill_load_ledger, delegation_turn, provenance_chain, code_file, and git_cochange + single WAL transaction write to compaction_continuation_ledger; zero child subprocesses and zero JSONL file rescans during compaction hook execution.",
  }
}
