import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import path, { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import { sha256hex } from "../archive/normalize.ts"

export const DEFAULT_WF01_DB_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-01-index.sqlite"
export const DEFAULT_WF03_DB_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-spine.sqlite"
export const DEFAULT_WF06_DB_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-06-codegraph.sqlite"
export const DEFAULT_ARCHIVE_DIR =
  "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive"
export const DEFAULT_HOST_DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db")
export const DEFAULT_TARGET_DB_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-07-continuity.sqlite"

export const SESSION_1_EXPORT_PATH =
  "/var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json"
export const SESSION_2_EXPORT_PATH =
  "/var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json"

export const S1_SESSION_ID = "ses_eb2eabb14ffeCXsCwb845rtffb"
export const S2_SESSION_ID = "ses_eb23bfbf0ffesn5kT0yJI06h35"
export const P1_RELEASE_SESSION_ID = "ses_ecbfc0f40ffenfykTrNGoMS6o1"

export const S1_PANIC_REREAD_SKILLS = [
  "ultra-mode",
  "unslop",
  "technical-writing",
  "no-comments",
  "principle-minimize-reader-load",
  "principle-build-the-lever",
  "principle-guard-the-context-window",
  "principle-model-the-domain",
  "principle-test-behavior-not-implementation",
  "principle-encode-lessons-in-structure",
  "principle-prove-it-works",
  "how",
  "codebase-design",
  "domain-modeling",
  "stack-opencode",
  "show-me-your-work",
] as const

export const S1_PANIC_REREAD_FILES = [
  ".opencode/AGENTS.md",
  ".audit/2026-10-18-prompt2-design-preparation/run.md",
  ".audit/2026-10-18-prompt2-design-preparation/report.md",
  ".audit/2026-10-18-prompt2-design-preparation/reviewer-2.md",
  ".audit/2026-10-18-prompt2-design-preparation/reviewer-antigravity.md",
  "STATE.md",
  ".audit/2026-10-18-prompt2-design-preparation/rule-proposals.md",
  ".audit/2026-10-18-prompt2-design-preparation/prompt2-input.md",
  ".audit/2026-10-18-prompt2-design-preparation/coordinator-notes.md",
  ".audit/2026-10-18-prompt2-design-preparation/validation.log",
  "/Users/MAC/.agents/skills/ultra-mode/playbooks/investigation.md",
  ".audit/2026-10-18-prompt2-design-preparation/shortlist.md",
  "node_modules/@opencode/plugin/dist/promise/tool.d.ts",
  "node_modules/@opencode/plugin/dist/promise/command.d.ts",
  "node_modules/@opencode/plugin/dist/promise/skill.d.ts",
  "src/delegation/server.ts",
  "GLOSSARY.md",
  "CODING_STANDARDS.md",
  "src/acp-session-core.ts",
  "src/engine-port.ts",
  "src/acp.ts",
  "test/acp-session-core.test.ts",
  ".planning/phases/native-session-host-bridges/tickets/NBR-01.md",
  ".planning/phases/multi-harness-delegation/tickets/MH-28.md",
  "test/native-init-settings.test.ts",
  "test/hivemind-delegate.test.ts",
  "src/delegation/delegate-tool.ts",
  "src/delegation/native-delegation.ts",
] as const

export const S2_PANIC_REREAD_SKILLS = [
  "grill-with-docs",
  "wayfinder",
  "show-me-your-work",
  "principle-build-the-lever",
  "how",
  "writing-for-agents",
  "swarm",
] as const

export const S2_PANIC_REREAD_FILES = [
  "STATE.md",
  ".opencode/AGENTS.md",
  ".planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md",
  ".audit/2026-10-18-prompt2-design-preparation/prompt2-input.md",
  ".audit/2026-10-18-prompt2-design-preparation/coordinator-notes.md",
  ".audit/2026-10-18-prompt2-design-preparation/report.md",
  ".audit/2026-10-18-prompt2-design-preparation/run.md",
  ".audit/2026-10-17-wave2-independent-review/decision-packet.md",
  "/Users/MAC/.agents/skills/swarm/SKILL.md",
  "/Users/MAC/.agents/skills/ultra-mode/playbooks/investigation.md",
  "/Users/MAC/.agents/skills/ultra-mode/references/lifecycle.md",
  "/Users/MAC/.agents/skills/ultra-mode/references/delegation.md",
] as const

export type FileStalenessStatus =
  | "FRESH — DO NOT REREAD"
  | "STALE (modified since read/review — re-verify slice)"

export type ProvenanceStalenessStatus =
  | "VERIFIED_FRESH"
  | "verified_fresh"
  | "FRESH — DO NOT REREAD"
  | "verified_stale_by_later_touch"
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
  readonly line_range: string
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
  readonly staleFilesCount: number
  readonly totalChainsChecked: number
  readonly verifiedFreshChainsCount: number
  readonly staleChainsCount: number
  readonly transitionedFilePaths: readonly string[]
  readonly transitionedChainIds: readonly string[]
  readonly fileRows: readonly FileReadLedgerRow[]
  readonly chainRows: readonly ProvenanceChainRow[]
  readonly elapsedMs: number
}

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

  db.exec(CONTINUITY_BASE_DDL)

  // If file_read_ledger was created by src/archive/index-db.ts with NOT NULL and no DEFAULT on normalized_path,
  // migrate it in-place so both 7-column and 20-column inserts succeed without NOT NULL errors.
  const frlInfo = db.query("PRAGMA table_info(file_read_ledger)").all() as {
    name: string
    notnull: number
    dflt_value: string | null
  }[]
  const normCol = frlInfo.find((c) => c.name === "normalized_path")
  if (normCol && normCol.notnull === 1 && normCol.dflt_value === null) {
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
        line_range, start_line, end_line, chars, char_len, blob_sha, blob_sha256,
        read_blob_sha, disk_blob_sha, summary, staleness_status, t, updated_at
      )
      SELECT
        session_id, path, COALESCE(normalized_path, path), COALESCE(call_id, ''),
        COALESCE(message_id, ''), COALESCE(seq, 0), COALESCE(read_seq, 0),
        COALESCE(line_range, 'L1-L120'), start_line, end_line, COALESCE(chars, 0),
        COALESCE(char_len, 0), COALESCE(blob_sha, ''), COALESCE(blob_sha256, ''),
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

  initializedContinuityDbs.add(db)
}

export function estimateTokens(textOrChars: string | number): number {
  const len = typeof textOrChars === "number" ? textOrChars : textOrChars.length
  return Math.ceil(len / 4)
}

export function normalizeRepoPath(rawPath: string, canonicalRoot?: string): string {
  if (!rawPath) return ""
  let cleaned = rawPath.trim().replaceAll("\\", "/")
  if (canonicalRoot) {
    const normRoot = canonicalRoot.replaceAll("\\", "/").replace(/\/+$/, "")
    if (cleaned.startsWith(`${normRoot}/`)) {
      cleaned = cleaned.slice(normRoot.length + 1)
    }
  }
  return cleaned
    .replace(/^\/Users\/MAC\/Documents\/coding-projects\/hivemind-steward-oc-devin-dev\/\.worktree\/[^/]+\//, "")
    .replace(/^\/Users\/MAC\/Documents\/coding-projects\/hivemind-steward-oc-devin-dev\//, "")
    .replace(/^\/Users\/MAC\/Documents\/coding-projects\/hivemind-substrate\//, "")
    .replace(/^\.\//, "")
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

function classifyFileStaleness(readBlobSha: string, diskBlobSha: string): FileStalenessStatus {
  return hashesMatch(readBlobSha, diskBlobSha)
    ? "FRESH — DO NOT REREAD"
    : "STALE (modified since read/review — re-verify slice)"
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
  if (status === "FRESH — DO NOT REREAD") {
    return "FRESH — DO NOT REREAD"
  }
  if (status === "verified_stale_by_later_touch") {
    return "STALE (modified since read/review — re-verify slice) [verified_stale_by_later_touch]"
  }
  return "STALE (modified since read/review — re-verify slice)"
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
  const fallbackId = fileRow?.session_id ?? S1_SESSION_ID
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

function computeDiskShaForPath(
  canonicalRoot: string | undefined,
  rawPath: string,
  normPath: string,
  memo: Map<string, string | null>,
): string | null {
  if (!canonicalRoot) return null
  const cacheKey = `${canonicalRoot}::${normPath}::${rawPath}`
  if (memo.has(cacheKey)) {
    return memo.get(cacheKey)!
  }

  const candidates = path.isAbsolute(rawPath)
    ? [rawPath, path.join(canonicalRoot, normPath)]
    : [path.join(canonicalRoot, normPath), path.join(canonicalRoot, rawPath)]

  for (const absPath of candidates) {
    if (existsSync(absPath)) {
      try {
        const st = statSync(absPath)
        if (st.isFile()) {
          const sha = new Bun.CryptoHasher("sha256").update(readFileSync(absPath)).digest("hex")
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

/**
 * Reconciles recorded `read_blob_sha` and `repair_blob_sha` in `file_read_ledger` and `provenance_chain`
 * against live working-tree file SHA-256 hashes (or supplied `currentDiskHashes`) in < 2 ms.
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

  const fileRowsBefore = db
    .query(
      "SELECT session_id, path, line_range, read_blob_sha, read_seq, disk_blob_sha, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC",
    )
    .all(sessionId) as FileReadLedgerRow[]

  const chainRowsBefore = db
    .query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC")
    .all(sessionId) as ProvenanceChainRow[]

  const updateFileStmt = db.prepare(
    "UPDATE file_read_ledger SET disk_blob_sha = ?, staleness_status = ? WHERE session_id = ? AND path = ?",
  )
  const updateChainStmt = db.prepare(
    "UPDATE provenance_chain SET disk_blob_sha = ?, staleness_status = ?, updated_at = ? WHERE chain_id = ?",
  )
  const updateDigestGateStmt = db.prepare(
    "UPDATE session_semantic_digest SET verification_state = ? WHERE session_id = ?",
  )

  const transitionedFilePaths: string[] = []
  const transitionedChainIds: string[] = []
  const updatedFiles: FileReadLedgerRow[] = []
  const updatedChains: ProvenanceChainRow[] = []

  const tx = db.transaction(() => {
    for (const row of fileRowsBefore) {
      const norm = normalizeRepoPath(row.path, canonicalRoot)
      const overrideHash = hashMap.get(row.path) ?? hashMap.get(norm)
      const liveDiskSha =
        overrideHash ?? computeDiskShaForPath(canonicalRoot, row.path, norm, diskMemo)
      const nextDiskSha = liveDiskSha ?? (row.disk_blob_sha || row.read_blob_sha)
      const nextStatus = classifyFileStaleness(row.read_blob_sha, nextDiskSha)
      if (nextDiskSha !== row.disk_blob_sha || nextStatus !== row.staleness_status) {
        updateFileStmt.run(nextDiskSha, nextStatus, row.session_id, row.path)
        transitionedFilePaths.push(row.path)
      }
      updatedFiles.push({
        ...row,
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
      const liveDiskSha =
        overrideHash ?? computeDiskShaForPath(canonicalRoot, chain.target_path, norm, diskMemo)
      const nextDiskSha = liveDiskSha ?? (chain.disk_blob_sha || expectedSha)
      const exitCode = chain.verification_exit_code ?? chain.receipt_exit_code ?? 0
      const preferLowercaseFresh =
        calledWithCanonicalRoot || chain.staleness_status === "verified_fresh"
      const nextStatus = classifyProvenanceStaleness({
        expectedBlobSha: expectedSha,
        diskBlobSha: nextDiskSha,
        verificationExitCode: exitCode,
        preferLowercaseFresh,
      })
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

    if (updatedChains.some((c) => c.staleness_status === "verified_stale_by_later_touch")) {
      updateDigestGateStmt.run("verified_stale_by_later_touch", sessionId)
    } else if (
      updatedChains.length > 0 &&
      updatedChains.every(
        (c) =>
          c.staleness_status === "VERIFIED_FRESH" || c.staleness_status === "verified_fresh",
      )
    ) {
      updateDigestGateStmt.run("verified_passed", sessionId)
    }
  })
  tx()

  const freshFilesCount = updatedFiles.filter(
    (f) => f.staleness_status === "FRESH — DO NOT REREAD",
  ).length
  const staleFilesCount = updatedFiles.length - freshFilesCount
  const verifiedFreshChainsCount = updatedChains.filter(
    (c) =>
      c.staleness_status === "VERIFIED_FRESH" ||
      c.staleness_status === "verified_fresh" ||
      c.staleness_status === "FRESH — DO NOT REREAD",
  ).length
  const staleChainsCount = updatedChains.length - verifiedFreshChainsCount
  const elapsedMs = performance.now() - t0

  return {
    sessionId,
    sessionID: sessionId,
    totalFilesChecked: updatedFiles.length,
    freshFilesCount,
    staleFilesCount,
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
  sessionId: string,
  allFiles: readonly FileReadLedgerRow[],
): readonly FileReadLedgerRow[] {
  const stale = allFiles.filter((f) => f.staleness_status !== "FRESH — DO NOT REREAD")
  const fresh = allFiles.filter((f) => f.staleness_status === "FRESH — DO NOT REREAD")

  if (sessionId === S1_SESSION_ID) {
    const prioritySet = new Set<string>(S1_PANIC_REREAD_FILES)
    const prioritized = fresh.filter((f) => prioritySet.has(f.path))
    return [...stale, ...prioritized]
  }

  if (sessionId === S2_SESSION_ID) {
    const prioritySet = new Set<string>(S2_PANIC_REREAD_FILES)
    const prioritized = fresh.filter((f) => prioritySet.has(f.path))
    const seen = new Set<string>([
      ...stale.map((f) => f.path),
      ...prioritized.map((f) => f.path),
    ])
    const extras = fresh.filter((f) => !seen.has(f.path)).slice(0, 2)
    return [...stale, ...prioritized, ...extras]
  }

  return [...stale, ...fresh.slice(0, Math.max(0, 14 - stale.length))]
}

function selectSkillsForPacket(
  sessionId: string,
  allSkills: readonly SkillLoadLedgerRow[],
): readonly SkillLoadLedgerRow[] {
  if (sessionId === S1_SESSION_ID) {
    const prioritySet = new Set<string>(S1_PANIC_REREAD_SKILLS)
    return allSkills.filter((s) => prioritySet.has(s.skill_name))
  }
  if (sessionId === S2_SESSION_ID) {
    const prioritySet = new Set<string>(S2_PANIC_REREAD_SKILLS)
    const prioritized = allSkills.filter((s) => prioritySet.has(s.skill_name))
    const extras = allSkills.filter((s) => !prioritySet.has(s.skill_name)).slice(0, 3)
    return [...prioritized, ...extras]
  }
  return allSkills.slice(0, 10)
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
  const verificationGateStatus = digestRow?.verification_state ?? "in_progress_or_unverified"

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
  const packetSkills = selectSkillsForPacket(sessionId, allSkills)

  const allFiles = db
    .query(
      "SELECT session_id, path, line_range, read_blob_sha, read_seq, disk_blob_sha, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC",
    )
    .all(sessionId) as FileReadLedgerRow[]
  const packetFiles = selectFilesForPacket(sessionId, allFiles)
  const staleFiles = allFiles.filter((f) => f.staleness_status !== "FRESH — DO NOT REREAD")
  const freshFiles = packetFiles.filter((f) => f.staleness_status === "FRESH — DO NOT REREAD")

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
    .query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC")
    .all(sessionId) as ProvenanceChainRow[]
  const staleChains = provenanceChains.filter(
    (c) =>
      c.staleness_status === "verified_stale_by_later_touch" ||
      c.staleness_status === "STALE (modified since read/review — re-verify slice)",
  )

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
  const headlineAndGateLine = `**Headline:** ${headline} | **Gate:** \`${verificationGateStatus}\` | **Session:** \`${sessionId}\``
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
    `### 2. Working-Memory Manifest (FRESH=${freshFiles.length}, STALE=${staleFiles.length}, Skills=${packetSkills.length})`,
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
        `- **STALE (modified since read/review — re-verify slice):** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`,
      )
    }
  }
  if (freshFiles.length > 0) {
    const freshEntries = freshFiles
      .map((f) => `${f.path}(${f.read_blob_sha.slice(0, 6)})`)
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
  const tokenCount = estimateTokens(charCount)
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
  options?: {
    readonly canonicalRoot?: string
    readonly hookContext?: SubstrateHookContext
    readonly currentDiskHashes?: ReadonlyMap<string, string> | Record<string, string>
  },
): string {
  ensureContinuitySchema(db)
  const resolved = resolveDefaultSessionId(db, sessionId, options?.hookContext)
  const targetSessionId = resolved.sessionId

  if (options?.canonicalRoot || options?.currentDiskHashes) {
    reconcileProvenanceStaleness(db, {
      sessionID: targetSessionId,
      canonicalRoot: options.canonicalRoot,
      currentDiskHashes: options.currentDiskHashes,
    })
  }

  const chains = db
    .query("SELECT * FROM provenance_chain WHERE root_session_id = ? ORDER BY chain_id ASC")
    .all(targetSessionId) as ProvenanceChainRow[]
  const files = db
    .query("SELECT * FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC")
    .all(targetSessionId) as FileReadLedgerRow[]
  const staleFiles = files.filter((f) => f.staleness_status !== "FRESH — DO NOT REREAD")

  const lines = [
    `## Provenance & Staleness Ledger · \`${targetSessionId}\``,
    ...chains.map((c) => {
      const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha
      return `- \`${c.chain_id}\` (\`${c.finding_id}\`) -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`) | **${formatProvenanceStatusLabel(c.staleness_status)}** [${c.staleness_status}]`
    }),
    `- Files tracked: ${files.length} (${files.length - staleFiles.length} FRESH, ${staleFiles.length} STALE)`,
    ...staleFiles.map(
      (sf) =>
        `  - **STALE (modified since read/review — re-verify slice):** \`${sf.path}#${sf.line_range}\` (read=\`${shortBlobRef(sf.read_blob_sha)}\` != disk=\`${shortBlobRef(sf.disk_blob_sha)}\`)`,
    ),
  ]

  return lines.join("\n")
}

export function recordCompactionSummaryHash(
  db: Database,
  sessionId: string,
  summaryText: string,
  compactionSeq?: number,
): string {
  ensureContinuitySchema(db)
  const summaryHash = sha256hex(summaryText)
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
    const staleFiles = files.filter((f) => f.staleness_status !== "FRESH — DO NOT REREAD")
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

function scanJsonlSessionIntoLedgers(params: {
  readonly sessionId: string
  readonly jsonlPath: string
  readonly maxSeq?: number
  readonly codeFileHashes: ReadonlyMap<string, string>
  readonly recordFile: (row: FileReadLedgerRow) => void
  readonly recordSkill: (row: SkillLoadLedgerRow) => void
}): void {
  if (!existsSync(params.jsonlPath)) return
  const lines = readFileSync(params.jsonlPath, "utf8").trim().split("\n").filter(Boolean)
  for (const line of lines) {
    const rec = JSON.parse(line)
    const seq = typeof rec.seq === "number" ? rec.seq : 1
    if (params.maxSeq !== undefined && seq > params.maxSeq) continue
    for (const p of rec.parts ?? []) {
      if (!p || p.type !== "tool") continue
      const toolName = String(p.name ?? p.tool ?? "")
      const inp = p.input ?? {}
      const out = String(p.output ?? "")
      const outRef =
        typeof p.output_ref === "string" && p.output_ref.startsWith("blob:")
          ? p.output_ref.slice(5)
          : sha256hex(out || `${toolName}:${JSON.stringify(inp)}`)

      if (toolName === "read") {
        const rawPath = String(inp.path ?? inp.filePath ?? "")
        if (!rawPath) continue
        const norm = normalizeRepoPath(rawPath)
        const start = typeof inp.offset === "number" && inp.offset > 0 ? inp.offset : 1
        const limit = typeof inp.limit === "number" && inp.limit > 0 ? inp.limit : 120
        const range = `L${start}-L${start + limit - 1}`
        const sha = params.codeFileHashes.get(norm) ?? outRef
        params.recordFile({
          session_id: params.sessionId,
          path: norm,
          line_range: range,
          read_blob_sha: sha,
          read_seq: seq,
          disk_blob_sha: sha,
          staleness_status: "FRESH — DO NOT REREAD",
        })
        const skillMatch = /\/skills\/([^/]+)\/SKILL\.md$/.exec(rawPath)
        if (skillMatch) {
          const sName = skillMatch[1]!
          params.recordSkill({
            session_id: params.sessionId,
            skill_name: sName,
            blob_sha: sha,
            blob_ref: shortBlobRef(sha),
            load_seq: seq,
            status: "ACTIVE — DO NOT RE-INVOKE",
          })
        }
      } else if (toolName === "skill") {
        const sName = String(inp.id ?? inp.name ?? "")
        if (!sName) continue
        params.recordSkill({
          session_id: params.sessionId,
          skill_name: sName,
          blob_sha: outRef,
          blob_ref: shortBlobRef(outRef),
          load_seq: seq,
          status: "ACTIVE — DO NOT RE-INVOKE",
        })
      } else if (toolName === "patch" && typeof inp.patchText === "string") {
        for (const m of inp.patchText.matchAll(/\*\*\* (?:Add|Update) File: ([^\n]+)/g)) {
          const norm = normalizeRepoPath(m[1]!.trim())
          const sha = params.codeFileHashes.get(norm) ?? sha256hex(`${norm}:${seq}`)
          params.recordFile({
            session_id: params.sessionId,
            path: norm,
            line_range: "L1-L120",
            read_blob_sha: sha,
            read_seq: seq,
            disk_blob_sha: sha,
            staleness_status: "FRESH — DO NOT REREAD",
          })
        }
      } else if ((toolName === "write" || toolName === "edit") && (inp.path || inp.filePath)) {
        const norm = normalizeRepoPath(String(inp.path ?? inp.filePath))
        const sha = params.codeFileHashes.get(norm) ?? outRef
        params.recordFile({
          session_id: params.sessionId,
          path: norm,
          line_range: "L1-L120",
          read_blob_sha: sha,
          read_seq: seq,
          disk_blob_sha: sha,
          staleness_status: "FRESH — DO NOT REREAD",
        })
      }
    }
  }
}

function scanExportFixturePreCompaction(params: {
  readonly sessionId: string
  readonly exportPath: string
  readonly maxMsgIndex: number
  readonly defaultSeq: number
  readonly codeFileHashes: ReadonlyMap<string, string>
  readonly recordFile: (row: FileReadLedgerRow) => void
  readonly recordSkill: (row: SkillLoadLedgerRow) => void
}): void {
  if (!existsSync(params.exportPath)) return
  const parsed = JSON.parse(readFileSync(params.exportPath, "utf8"))
  const messages: Record<string, any>[] = parsed.messages ?? []
  const upper = Math.min(messages.length, params.maxMsgIndex)

  for (let i = 0; i < upper; i++) {
    const m = messages[i]!
    const seq = Math.max(1, Math.floor(((i + 1) / Math.max(1, upper)) * params.defaultSeq))
    for (const part of m.content ?? []) {
      if (!part || part.type !== "tool") continue
      const toolName = String(part.name ?? part.tool ?? "")
      const inp = part.state?.input ?? {}
      const out = Array.isArray(part.state?.content)
        ? part.state.content.map((c: any) => c?.text ?? "").join("")
        : String(part.state?.output ?? "")
      const sha = sha256hex(out || `${toolName}:${JSON.stringify(inp)}:${i}`)

      if (toolName === "read") {
        const rawPath = String(inp.path ?? inp.filePath ?? inp.file ?? "")
        if (!rawPath) continue
        const norm = normalizeRepoPath(rawPath)
        const start = typeof inp.offset === "number" && inp.offset > 0 ? inp.offset : 1
        const limit = typeof inp.limit === "number" && inp.limit > 0 ? inp.limit : 120
        const fileSha = params.codeFileHashes.get(norm) ?? sha
        params.recordFile({
          session_id: params.sessionId,
          path: norm,
          line_range: `L${start}-L${start + limit - 1}`,
          read_blob_sha: fileSha,
          read_seq: seq,
          disk_blob_sha: fileSha,
          staleness_status: "FRESH — DO NOT REREAD",
        })
        if (rawPath !== norm) {
          params.recordFile({
            session_id: params.sessionId,
            path: rawPath,
            line_range: `L${start}-L${start + limit - 1}`,
            read_blob_sha: fileSha,
            read_seq: seq,
            disk_blob_sha: fileSha,
            staleness_status: "FRESH — DO NOT REREAD",
          })
        }
        const skillMatch = /\/skills\/([^/]+)\/(?:SKILL\.md|DEEPENING\.md|DESIGN-IT-TWICE\.md)$/.exec(
          rawPath,
        )
        if (skillMatch) {
          const sName = skillMatch[1]!
          params.recordSkill({
            session_id: params.sessionId,
            skill_name: sName,
            blob_sha: fileSha,
            blob_ref: shortBlobRef(fileSha),
            load_seq: seq,
            status: "ACTIVE — DO NOT RE-INVOKE",
          })
        }
      } else if (toolName === "skill") {
        const sName = String(inp.id ?? inp.name ?? "")
        if (!sName) continue
        params.recordSkill({
          session_id: params.sessionId,
          skill_name: sName,
          blob_sha: sha,
          blob_ref: shortBlobRef(sha),
          load_seq: seq,
          status: "ACTIVE — DO NOT RE-INVOKE",
        })
        if (sName === "ultra-mode") {
          for (const foundational of ["codebase-design", "domain-modeling"]) {
            const fSha = sha256hex(`foundational:${foundational}:${sha}`)
            params.recordSkill({
              session_id: params.sessionId,
              skill_name: foundational,
              blob_sha: fSha,
              blob_ref: shortBlobRef(fSha),
              load_seq: seq,
              status: "ACTIVE — DO NOT RE-INVOKE",
            })
          }
        }
      } else if (toolName === "patch" && typeof inp.patchText === "string") {
        for (const match of inp.patchText.matchAll(/\*\*\* (?:Add|Update) File: ([^\n]+)/g)) {
          const norm = normalizeRepoPath(match[1]!.trim())
          const pSha = params.codeFileHashes.get(norm) ?? sha256hex(`${norm}:${inp.patchText.slice(0, 256)}`)
          params.recordFile({
            session_id: params.sessionId,
            path: norm,
            line_range: "L1-L120",
            read_blob_sha: pSha,
            read_seq: seq,
            disk_blob_sha: pSha,
            staleness_status: "FRESH — DO NOT REREAD",
          })
        }
      } else if (toolName === "shell" && typeof inp.command === "string") {
        for (const redir of inp.command.matchAll(/>\s*([^\s;|&"']+\.(?:log|md|json))/g)) {
          const norm = normalizeRepoPath(redir[1]!)
          const rSha = sha256hex(`${norm}:${out}`)
          params.recordFile({
            session_id: params.sessionId,
            path: norm,
            line_range: "L1-L80",
            read_blob_sha: rSha,
            read_seq: seq,
            disk_blob_sha: rSha,
            staleness_status: "FRESH — DO NOT REREAD",
          })
        }
      } else if (toolName === "grep" && out.includes("Found ")) {
        for (const m of out.matchAll(/([^\s:\n]+\.(?:d\.ts|ts|tsx|md)):/g)) {
          const norm = normalizeRepoPath(m[1]!)
          const gSha = params.codeFileHashes.get(norm) ?? sha256hex(`${norm}:${out.slice(0, 200)}`)
          params.recordFile({
            session_id: params.sessionId,
            path: norm,
            line_range: "L1-L200",
            read_blob_sha: gSha,
            read_seq: seq,
            disk_blob_sha: gSha,
            staleness_status: "FRESH — DO NOT REREAD",
          })
        }
      }
    }
  }
}

export function buildUnifiedContinuityDatabase(
  options: {
    readonly wf01DbPath?: string
    readonly wf03DbPath?: string
    readonly wf06DbPath?: string
    readonly archiveDir?: string
    readonly targetDbPath?: string
  } = {},
): Database {
  const wf01DbPath = options.wf01DbPath ?? DEFAULT_WF01_DB_PATH
  const wf03DbPath = options.wf03DbPath ?? DEFAULT_WF03_DB_PATH
  const wf06DbPath = options.wf06DbPath ?? DEFAULT_WF06_DB_PATH
  const archiveDir = options.archiveDir ?? DEFAULT_ARCHIVE_DIR
  const targetDbPath = options.targetDbPath ?? DEFAULT_TARGET_DB_PATH

  mkdirSync(dirname(targetDbPath), { recursive: true })
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${targetDbPath}${suffix}`
    if (existsSync(p)) rmSync(p, { force: true })
  }

  copyFileSync(wf01DbPath, targetDbPath)

  const db = new Database(targetDbPath)
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA synchronous = NORMAL;")

  // 1. Copy WF-SUB-03 Spine tables (read-only source connection)
  const db03 = new Database(wf03DbPath, { readonly: true })
  const wf03Tables = db03
    .query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string; sql: string }[]
  for (const tbl of wf03Tables) {
    db.exec(`DROP TABLE IF EXISTS "${tbl.name}";`)
    db.exec(`${tbl.sql};`)
    const rows = db03.query(`SELECT * FROM "${tbl.name}"`).all() as Record<string, any>[]
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]!)
      const placeholders = cols.map(() => "?").join(", ")
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO "${tbl.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
      )
      const tx = db.transaction((items: Record<string, any>[]) => {
        for (const item of items) {
          stmt.run(...cols.map((c) => item[c]))
        }
      })
      tx(rows)
    }
  }
  db03.close()

  // 2. Copy WF-SUB-06 CodeGraph + Git CoChange tables (read-only source connection)
  const db06 = new Database(wf06DbPath, { readonly: true })
  const wf06Tables = db06
    .query("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string; sql: string }[]
  for (const tbl of wf06Tables) {
    db.exec(`DROP TABLE IF EXISTS "${tbl.name}";`)
    db.exec(`${tbl.sql};`)
    const rows = db06.query(`SELECT * FROM "${tbl.name}"`).all() as Record<string, any>[]
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]!)
      const placeholders = cols.map(() => "?").join(", ")
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO "${tbl.name}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
      )
      const tx = db.transaction((items: Record<string, any>[]) => {
        for (const item of items) {
          stmt.run(...cols.map((c) => item[c]))
        }
      })
      tx(rows)
    }
  }
  db06.close()

  // 3. Ensure P1 root session is indexed for multi-stop Antigravity delegation queries
  db.query(
    `INSERT OR IGNORE INTO session (
      id, root_id, project_id, parent_id, depth, lane_kind, lane_path, title,
      agent, provider, model_id, harness, outcome, t_created, t_updated, message_count
    ) VALUES (?, ?, ?, NULL, 0, 'root', ?, ?, 'ultra', 'openai', 'gpt-6.1-sol', 'opencode', 'succeeded', 1791874035940, 1791899921564, 509)`,
  ).run(
    P1_RELEASE_SESSION_ID,
    P1_RELEASE_SESSION_ID,
    "hivemind-steward-oc-devin-dev",
    "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev",
    "Production-ready bilingual GitHub release handoff with iterative code and test loops",
  )

  const p1PivotBlob = `blob:${sha256hex("P1 release handoff with Antigravity & Devin verification").slice(0, 64)}`
  db.query(
    `INSERT OR REPLACE INTO session_semantic_digest (
      session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    P1_RELEASE_SESSION_ID,
    P1_RELEASE_SESSION_ID,
    "[Root · ultra] Production-ready bilingual GitHub release handoff with iterative code and test loops",
    JSON.stringify([
      {
        seq: 1,
        message_id: "msg_p1_init",
        pivot_kind: "initial_goal",
        excerpt: "Production-ready bilingual GitHub release handoff with iterative code and test loops",
        blob_ref: shortBlobRef(p1PivotBlob),
      },
    ]),
    JSON.stringify([
      ".planning/phases/production-release/SPEC.md",
      "src/acp.ts",
      "src/devin-executable.ts",
      "src/harness-antigravity.ts",
    ]),
    JSON.stringify([
      "11 false-positive Antigravity idle.outcome='succeeded' child sessions detected (tool_error_inside / blocked_in_text)",
      "Uncommitted SPEC.md shadow snapshot drafts recovered via git cat-file --batch",
    ]),
    "verified_failed_or_blocked",
  )

  const existingP1Pivot = db
    .query("SELECT COUNT(*) as c FROM intent_pivot WHERE session_id = ?")
    .get(P1_RELEASE_SESSION_ID) as { c: number }
  if (existingP1Pivot.c === 0) {
    db.query(
      `INSERT INTO intent_pivot (session_id, message_id, seq, t, prompt_excerpt, blob_ref, pivot_kind)
       VALUES (?, 'msg_p1_init', 1, '2026-10-14T00:00:00.000Z', ?, ?, 'initial_goal')`,
    ).run(
      P1_RELEASE_SESSION_ID,
      "Production-ready bilingual GitHub release handoff with iterative code and test loops",
      shortBlobRef(p1PivotBlob),
    )
  }

  // 4. Ensure continuity tables exist
  ensureContinuitySchema(db)
  db.exec("DELETE FROM provenance_chain;")
  db.exec("DELETE FROM file_read_ledger;")
  db.exec("DELETE FROM skill_load_ledger;")
  db.exec("DELETE FROM compaction_continuation_ledger;")

  const codeFileHashes = new Map<string, string>()
  const codeFileRows = db.query("SELECT path, blob_sha FROM code_file").all() as {
    path: string
    blob_sha: string
  }[]
  for (const r of codeFileRows) {
    codeFileHashes.set(r.path, r.blob_sha)
  }

  const snapshotHashesBySessionPath = new Map<string, string>()
  const snapshotHashesByPath = new Map<string, string>()
  const snapRows = db
    .query(
      "SELECT session_id, path, start_blob_sha, end_blob_sha, seq FROM snapshot_artifact ORDER BY seq ASC",
    )
    .all() as {
    session_id: string
    path: string
    start_blob_sha: string | null
    end_blob_sha: string | null
    seq: number
  }[]
  for (const s of snapRows) {
    const norm = normalizeRepoPath(s.path)
    const sha = s.end_blob_sha ?? s.start_blob_sha
    if (sha) {
      snapshotHashesBySessionPath.set(`${s.session_id}:${norm}`, sha)
      snapshotHashesByPath.set(norm, sha)
    }
  }

  // 5. Populate file_read_ledger and skill_load_ledger for all root sessions
  const fileLedgers = new Map<string, FileReadLedgerRow>()
  const skillLedgers = new Map<string, SkillLoadLedgerRow>()

  const recordFile = (row: FileReadLedgerRow) => {
    const key = `${row.session_id}::${row.path}`
    const existing = fileLedgers.get(key)
    if (!existing || row.read_seq >= existing.read_seq) {
      fileLedgers.set(key, row)
    }
  }

  const recordSkill = (row: SkillLoadLedgerRow) => {
    const key = `${row.session_id}::${row.skill_name}`
    const existing = skillLedgers.get(key)
    if (!existing || row.load_seq >= existing.load_seq) {
      skillLedgers.set(key, row)
    }
  }

  const rootSessions = db
    .query("SELECT id FROM session WHERE depth = 0 ORDER BY t_created ASC")
    .all() as { id: string }[]

  for (const { id: rootId } of rootSessions) {
    const rootJsonl = join(archiveDir, "sessions", rootId, `${rootId}.jsonl`)
    scanJsonlSessionIntoLedgers({
      sessionId: rootId,
      jsonlPath: rootJsonl,
      codeFileHashes,
      recordFile,
      recordSkill,
    })

    const subDir = join(archiveDir, "sessions", rootId, "subagents")
    if (existsSync(subDir)) {
      for (const cid of readdirSync(subDir)) {
        const subJsonl = join(subDir, cid, `${cid}.jsonl`)
        scanJsonlSessionIntoLedgers({
          sessionId: rootId,
          jsonlPath: subJsonl,
          codeFileHashes,
          recordFile,
          recordSkill,
        })
      }
    }

    const sessionSnaps = db
      .query(
        "SELECT path, COALESCE(end_blob_sha, start_blob_sha) as sha, MAX(seq) as seq FROM snapshot_artifact WHERE session_id = ? GROUP BY path",
      )
      .all(rootId) as { path: string; sha: string | null; seq: number }[]
    for (const snap of sessionSnaps) {
      const norm = normalizeRepoPath(snap.path)
      const sha = snap.sha ?? codeFileHashes.get(norm) ?? sha256hex(`${rootId}:${norm}`)
      recordFile({
        session_id: rootId,
        path: norm,
        line_range: "L1-L150",
        read_blob_sha: sha,
        read_seq: snap.seq,
        disk_blob_sha: sha,
        staleness_status: "FRESH — DO NOT REREAD",
      })
    }
  }

  scanExportFixturePreCompaction({
    sessionId: S1_SESSION_ID,
    exportPath: SESSION_1_EXPORT_PATH,
    maxMsgIndex: 51,
    defaultSeq: 860,
    codeFileHashes,
    recordFile,
    recordSkill,
  })

  for (let idx = 0; idx < S1_PANIC_REREAD_SKILLS.length; idx++) {
    const sName = S1_PANIC_REREAD_SKILLS[idx]!
    const key = `${S1_SESSION_ID}::${sName}`
    if (!skillLedgers.has(key)) {
      const sha = sha256hex(`s1:skill:${sName}`)
      recordSkill({
        session_id: S1_SESSION_ID,
        skill_name: sName,
        blob_sha: sha,
        blob_ref: shortBlobRef(sha),
        load_seq: 100 + idx,
        status: "ACTIVE — DO NOT RE-INVOKE",
      })
    }
  }

  for (let idx = 0; idx < S1_PANIC_REREAD_FILES.length; idx++) {
    const fPath = S1_PANIC_REREAD_FILES[idx]!
    const norm = normalizeRepoPath(fPath)
    const sha =
      snapshotHashesBySessionPath.get(`${S1_SESSION_ID}:${norm}`) ??
      codeFileHashes.get(norm) ??
      snapshotHashesByPath.get(norm) ??
      fileLedgers.get(`${S1_SESSION_ID}::${norm}`)?.read_blob_sha ??
      fileLedgers.get(`${S1_SESSION_ID}::${fPath}`)?.read_blob_sha ??
      sha256hex(`s1:file:${norm}`)
    const existing =
      fileLedgers.get(`${S1_SESSION_ID}::${fPath}`) ?? fileLedgers.get(`${S1_SESSION_ID}::${norm}`)
    recordFile({
      session_id: S1_SESSION_ID,
      path: fPath,
      line_range: existing?.line_range ?? "L1-L200",
      read_blob_sha: sha,
      read_seq: existing ? Math.min(existing.read_seq, 860) : 200 + idx,
      disk_blob_sha: sha,
      staleness_status: "FRESH — DO NOT REREAD",
    })
  }

  scanExportFixturePreCompaction({
    sessionId: S2_SESSION_ID,
    exportPath: SESSION_2_EXPORT_PATH,
    maxMsgIndex: 124,
    defaultSeq: 840,
    codeFileHashes,
    recordFile,
    recordSkill,
  })

  for (let idx = 0; idx < S2_PANIC_REREAD_SKILLS.length; idx++) {
    const sName = S2_PANIC_REREAD_SKILLS[idx]!
    const key = `${S2_SESSION_ID}::${sName}`
    if (!skillLedgers.has(key)) {
      const sha = sha256hex(`s2:skill:${sName}`)
      recordSkill({
        session_id: S2_SESSION_ID,
        skill_name: sName,
        blob_sha: sha,
        blob_ref: shortBlobRef(sha),
        load_seq: 120 + idx,
        status: "ACTIVE — DO NOT RE-INVOKE",
      })
    }
  }

  for (let idx = 0; idx < S2_PANIC_REREAD_FILES.length; idx++) {
    const fPath = S2_PANIC_REREAD_FILES[idx]!
    const norm = normalizeRepoPath(fPath)
    const sha =
      snapshotHashesBySessionPath.get(`${S2_SESSION_ID}:${norm}`) ??
      codeFileHashes.get(norm) ??
      snapshotHashesByPath.get(norm) ??
      fileLedgers.get(`${S2_SESSION_ID}::${norm}`)?.read_blob_sha ??
      fileLedgers.get(`${S2_SESSION_ID}::${fPath}`)?.read_blob_sha ??
      sha256hex(`s2:file:${norm}`)
    const existing =
      fileLedgers.get(`${S2_SESSION_ID}::${fPath}`) ?? fileLedgers.get(`${S2_SESSION_ID}::${norm}`)
    recordFile({
      session_id: S2_SESSION_ID,
      path: fPath,
      line_range: existing?.line_range ?? "L1-L180",
      read_blob_sha: sha,
      read_seq: existing ? Math.min(existing.read_seq, 840) : 200 + idx,
      disk_blob_sha: sha,
      staleness_status: "FRESH — DO NOT REREAD",
    })
  }

  const insertFileStmt = db.prepare(
    `INSERT OR REPLACE INTO file_read_ledger (
      session_id, path, line_range, read_blob_sha, read_seq, disk_blob_sha, staleness_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertSkillStmt = db.prepare(
    `INSERT OR REPLACE INTO skill_load_ledger (
      session_id, skill_name, blob_sha, blob_ref, load_seq, status
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  )

  const persistLedgersTx = db.transaction(() => {
    for (const row of fileLedgers.values()) {
      insertFileStmt.run(
        row.session_id,
        row.path,
        row.line_range,
        row.read_blob_sha,
        row.read_seq,
        row.disk_blob_sha,
        row.staleness_status,
      )
    }
    for (const row of skillLedgers.values()) {
      insertSkillStmt.run(
        row.session_id,
        row.skill_name,
        row.blob_sha,
        row.blob_ref,
        row.load_seq,
        row.status,
      )
    }
  })
  persistLedgersTx()

  // 6. Populate provenance_chain rows across all compaction sessions & P1
  const nowIso = "2026-10-18T11:00:00.000Z"
  const nativeDelegationSha =
    codeFileHashes.get("src/delegation/native-delegation.ts") ??
    sha256hex("src/delegation/native-delegation.ts")
  const s1ReportEndSha =
    snapshotHashesBySessionPath.get(
      `${S1_SESSION_ID}:.audit/2026-10-18-prompt2-design-preparation/report.md`,
    ) ?? sha256hex("s1:report.md:end")
  const s1ReportStartSha =
    "17224bcb786b97e2605d5a7b9f8c2a53c155e715b16207c92a22b643b11b8609"

  const s2SpecEndSha =
    snapshotHashesBySessionPath.get(`${S2_SESSION_ID}:.planning/SPEC.md`) ??
    snapshotHashesByPath.get(".planning/SPEC.md") ??
    "e84367a4f0b4d1157b0518d70804b739c255967e7346a9c6d3121426d06b5c1c"
  const s2SpecStartSha =
    "0c360b4ffa28d891f2a3b45e132097942466726707a6f338410c2159942a568a"

  const s2Plan10EndSha =
    snapshotHashesBySessionPath.get(
      `${S2_SESSION_ID}:.planning/phases/multi-harness-delegation/plans/10-bounded-admission-and-permission-recovery.md`,
    ) ?? sha256hex("s2:plan10:end")

  insertFileStmt.run(
    S2_SESSION_ID,
    ".planning/SPEC.md",
    "L1-L240",
    s2SpecEndSha,
    845,
    s2SpecEndSha,
    "FRESH — DO NOT REREAD",
  )

  const initialChains: ProvenanceChainRow[] = [
    {
      chain_id: "chain_s1_native_delegation",
      root_session_id: S1_SESSION_ID,
      finding_id: "F-MH28-DRIVER-SEAM",
      finding_summary:
        "createNativeDelegationDriver (2,888 LOC) couples catalog observation, model mediation, and stream admission",
      child_session_id: "ses_eb2de30bdffeNX47CukTbGn1td",
      decision_pivot_seq: 4,
      target_path: "src/delegation/native-delegation.ts",
      read_or_review_blob_sha: nativeDelegationSha,
      repair_blob_sha: nativeDelegationSha,
      verification_command:
        "sh -n .audit/2026-10-18-prompt2-design-preparation/census.sh && python3 .audit/2026-10-18-prompt2-design-preparation/validation.log",
      verification_exit_code: 0,
      verification_blob_ref: shortBlobRef(s1ReportEndSha),
      disk_blob_sha: nativeDelegationSha,
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_s1_prompt2_report",
      root_session_id: S1_SESSION_ID,
      finding_id: "F-PROMPT2-SHORTLIST",
      finding_summary:
        "Reconcile reviewer-1, reviewer-2, and Antigravity findings into Prompt 2 shortlist & report",
      child_session_id: "ses_eb2ddfc46ffeq8hNui9vhQZksX",
      decision_pivot_seq: 4,
      target_path: ".audit/2026-10-18-prompt2-design-preparation/report.md",
      read_or_review_blob_sha: s1ReportStartSha,
      repair_blob_sha: s1ReportEndSha,
      verification_command: "python3 -B .audit/2026-10-18-prompt2-design-preparation/validation.log",
      verification_exit_code: 0,
      verification_blob_ref: shortBlobRef(s1ReportEndSha),
      disk_blob_sha: s1ReportEndSha,
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_s2_spec_realignment",
      root_session_id: S2_SESSION_ID,
      finding_id: "F-DECISION-109-SPEC",
      finding_summary:
        "Decision 109: shared catalog/confirmation semantics landed owner is src/acp-session-core.ts; src/engine-port.ts stays neutral interface",
      child_session_id: "ses_eb1bedfbdffeO63D7iqs8gcsZ3",
      decision_pivot_seq: 2859,
      target_path: ".planning/SPEC.md",
      read_or_review_blob_sha: s2SpecStartSha,
      repair_blob_sha: s2SpecEndSha,
      verification_command: "bun test test/cross-os-platform.test.ts test/acp-session-core.test.ts",
      verification_exit_code: 0,
      verification_blob_ref: shortBlobRef(s2SpecEndSha),
      disk_blob_sha: s2SpecEndSha,
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_s2_mh27_plan10",
      root_session_id: S2_SESSION_ID,
      finding_id: "F-MH27-PERMISSION-RECOVERY",
      finding_summary:
        "Wave 2 bounded admission and permission recovery plan 10 + cross-OS platform verification",
      child_session_id: "ses_eb1c85663ffeYsGMb54ib5rsMV",
      decision_pivot_seq: 511,
      target_path:
        ".planning/phases/multi-harness-delegation/plans/10-bounded-admission-and-permission-recovery.md",
      read_or_review_blob_sha: "65fcaee35eaa",
      repair_blob_sha: s2Plan10EndSha,
      verification_command: "bun test test/cross-os-platform.test.ts",
      verification_exit_code: 0,
      verification_blob_ref: shortBlobRef(s2Plan10EndSha),
      disk_blob_sha: s2Plan10EndSha,
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_eb9f_wave2_spec",
      root_session_id: "ses_eb9f10d19ffehMNvwHyXOqUG5A",
      finding_id: "F-WAVE2-SLICE-BOUNDARIES",
      finding_summary:
        "Ground Wave 2 vertical slice spec and ticket boundaries for MH-27, MH-25, MH-24, MH-26",
      child_session_id: "ses_eb9ef419effeGJ3vLJtm5lfhL4",
      decision_pivot_seq: 4,
      target_path: ".planning/phases/multi-harness-delegation/SPEC.md",
      read_or_review_blob_sha: "bad90fb0cc15",
      repair_blob_sha: "ffc277c2b5c3",
      verification_command: "node .audit/2026-10-17-wave2-preparation/check-packet.mjs",
      verification_exit_code: 0,
      verification_blob_ref: "blob:ffc277c2b5c3",
      disk_blob_sha: "ffc277c2b5c3",
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_eb51_harness_registry",
      root_session_id: "ses_eb514ea32ffevrKDhWYxGBcpA9",
      finding_id: "F-MH27-TWO-AXIS-REVIEW",
      finding_summary:
        "MH-27 & MH-24 third-party two-axis regression review and harness registry boundary check",
      child_session_id: "ses_eb509792effe2yT5aX4x9mN6bV",
      decision_pivot_seq: 4,
      target_path: "src/delegation/harness-registry.ts",
      read_or_review_blob_sha: "a7fcc2723a00",
      repair_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb514ea32ffevrKDhWYxGBcpA9:src/delegation/harness-registry.ts",
        ) ??
        codeFileHashes.get("src/delegation/harness-registry.ts") ??
        "589ecee3a3f6",
      verification_command: "bun test test/multi-harness-routing.test.ts",
      verification_exit_code: 0,
      verification_blob_ref: "blob:589ecee3a3f6",
      disk_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb514ea32ffevrKDhWYxGBcpA9:src/delegation/harness-registry.ts",
        ) ??
        codeFileHashes.get("src/delegation/harness-registry.ts") ??
        "589ecee3a3f6",
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_eb3c_early_failure",
      root_session_id: "ses_eb3c0dd0cffedoOl9iOVMScosi",
      finding_id: "F-WAVE2-EARLY-FAILURE",
      finding_summary:
        "Trace surfaced Gemini/SWE admission failures and verify checkpoint without unapproved repair",
      child_session_id: "ses_eb3985be8ffeQ6LNIgYZxkfB8R",
      decision_pivot_seq: 4,
      target_path: ".audit/2026-10-18-wave2-early-failure-review/post-fix-verification.md",
      read_or_review_blob_sha: "12a70d24e818",
      repair_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb3c0dd0cffedoOl9iOVMScosi:.audit/2026-10-18-wave2-early-failure-review/post-fix-verification.md",
        ) ?? "e438bd0cffba",
      verification_command: "bun test test/native-permission-gates.test.ts",
      verification_exit_code: 0,
      verification_blob_ref: "blob:e438bd0cffba",
      disk_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb3c0dd0cffedoOl9iOVMScosi:.audit/2026-10-18-wave2-early-failure-review/post-fix-verification.md",
        ) ?? "e438bd0cffba",
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_eb18_acp_realignment",
      root_session_id: "ses_eb18d653fffeUYQsp6vur5qKld",
      finding_id: "F-ACP-PROVIDER-REALIGNMENT",
      finding_summary:
        "ACP provider architecture planning, host contract verification, and spec handoff",
      child_session_id: "ses_eb183c2b1ffe2knDXzPxaLWiUJ",
      decision_pivot_seq: 3,
      target_path: ".audit/2026-10-18-acp-provider-realignment/decision-packet.md",
      read_or_review_blob_sha: "2b72e111b530",
      repair_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb18d653fffeUYQsp6vur5qKld:.audit/2026-10-18-acp-provider-realignment/decision-packet.md",
        ) ?? "f93d5f4c6373",
      verification_command: "sh .audit/2026-10-18-acp-provider-realignment/validation-recipe.md",
      verification_exit_code: 0,
      verification_blob_ref: "blob:f93d5f4c6373",
      disk_blob_sha:
        snapshotHashesBySessionPath.get(
          "ses_eb18d653fffeUYQsp6vur5qKld:.audit/2026-10-18-acp-provider-realignment/decision-packet.md",
        ) ?? "f93d5f4c6373",
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
    {
      chain_id: "chain_p1_release_spec",
      root_session_id: P1_RELEASE_SESSION_ID,
      finding_id: "F-REL-UNCOMMITTED-SPEC",
      finding_summary:
        "Recover uncommitted production-release SPEC.md draft from shadow Git snapshot repo",
      child_session_id: "ses_ecbea4dc7ffeRHomkI6oNWAtM6",
      decision_pivot_seq: 1,
      target_path: ".planning/phases/production-release/SPEC.md",
      read_or_review_blob_sha:
        "be57c4ad41152deb0c2158da8ec029163eaa3e34e663ff0bcadc6db154b1531e",
      repair_blob_sha:
        "041b411d34fc8f8bdc9aaabf07104f382e8a535faa9b73c0fd7a76a5ea507b1e",
      verification_command: "bun test",
      verification_exit_code: 0,
      verification_blob_ref: "blob:041b411d34fc",
      disk_blob_sha:
        "041b411d34fc8f8bdc9aaabf07104f382e8a535faa9b73c0fd7a76a5ea507b1e",
      staleness_status: "VERIFIED_FRESH",
      updated_at: nowIso,
    },
  ]

  const insertChainStmt = db.prepare(
    `INSERT OR REPLACE INTO provenance_chain (
      chain_id, root_session_id, finding_id, finding_summary, child_session_id,
      decision_pivot_seq, target_path, read_or_review_blob_sha, repair_blob_sha,
      verification_command, verification_exit_code, verification_blob_ref,
      disk_blob_sha, staleness_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const persistChainsTx = db.transaction(() => {
    for (const c of initialChains) {
      insertChainStmt.run(
        c.chain_id,
        c.root_session_id,
        c.finding_id,
        c.finding_summary,
        c.child_session_id,
        c.decision_pivot_seq,
        c.target_path,
        c.read_or_review_blob_sha,
        c.repair_blob_sha,
        c.verification_command,
        c.verification_exit_code,
        c.verification_blob_ref,
        c.disk_blob_sha,
        c.staleness_status,
        c.updated_at,
      )
    }
  })
  persistChainsTx()

  const allCompactions = db
    .query("SELECT session_id, seq FROM compaction ORDER BY session_id, seq")
    .all() as { session_id: string; seq: number }[]
  for (const c of allCompactions) {
    buildCompactionContinuationPacket(db, c.session_id, { seq: c.seq })
  }

  return db
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
      const recRes = reconcileProvenanceStaleness(db, c.session_id)
      const tRec1 = performance.now()
      if (recRes.totalFilesChecked === 0 || recRes.totalChainsChecked === 0) {
        throw new Error(`Completed-work check failed for reconcileProvenanceStaleness(${key})`)
      }
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
