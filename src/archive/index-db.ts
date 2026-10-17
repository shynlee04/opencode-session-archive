import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import type { DelegationFact, Harness } from "./types.ts"

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
}

const DDL = `
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
  tok_input INTEGER
);
CREATE TABLE IF NOT EXISTS instruction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  blob_sha TEXT
);
`

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

const insertSql = (table: string, cols: readonly string[]) =>
  `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`

type Value = string | number | null

const rowsEqual = (a: readonly Value[][], b: readonly Value[][]) =>
  a.length === b.length && a.every((row, i) => JSON.stringify(row) === JSON.stringify(b[i]))

const sortRows = (rows: Value[][]): Value[][] =>
  [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

const bool = (v: boolean | null | undefined): number | null => (v === null || v === undefined ? null : v ? 1 : 0)

export function writeIndex(targetPath: string, input: IndexInput): "written" | "unchanged" {
  const sessionValues: Value[][] = input.sessions.map((s) => [
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
  ])
  const delegationValues: Value[][] = input.delegations.map((d) => [
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
  ])
  const messageValues: Value[][] = input.messages.map((m) => [
    m.session_id,
    m.seq,
    m.id,
    m.kind,
    m.t,
    m.agent,
    m.model_id,
    m.tok_in,
    m.tok_out,
  ])
  const toolCallValues: Value[][] = input.toolCalls.map((t) => [
    t.call_id,
    t.session_id,
    t.seq,
    t.name,
    t.status,
    t.duration_ms,
    t.truncated ? 1 : 0,
    t.output_path,
  ])
  const compactionValues: Value[][] = input.compactions.map((c) => [
    c.session_id,
    c.seq,
    c.reason,
    c.status,
    c.summary_ref,
    c.tok_input,
  ])
  const instructionValues: Value[][] = input.instructions.map((i) => [
    i.session_id,
    i.seq,
    i.path,
    i.blob_sha,
  ])

  if (existsSync(targetPath) && indexMatches(targetPath, input, {
    session: sessionValues,
    delegation: delegationValues,
    message: messageValues,
    tool_call: toolCallValues,
    compaction: compactionValues,
    instruction: instructionValues,
  })) {
    return "unchanged"
  }

  const db = new Database(targetPath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec(DDL)
  const rebuild = db.transaction(() => {
    db.query("DELETE FROM session WHERE root_id = ?").run(input.rootID)
    db.query("DELETE FROM delegation WHERE root_id = ?").run(input.rootID)
    for (const table of ["message", "tool_call", "compaction", "instruction"] as const) {
      const stmt = db.query(`DELETE FROM ${table} WHERE session_id = ?`)
      for (const id of input.sessionIDs) stmt.run(id)
    }
    const insertSession = db.query(insertSql("session", SESSION_COLS))
    for (const row of sessionValues) insertSession.run(...row)
    const insertDelegation = db.query(insertSql("delegation", DELEGATION_COLS))
    for (const row of delegationValues) insertDelegation.run(...row)
    const insertMessage = db.query(
      insertSql("message", ["session_id", "seq", "id", "kind", "t", "agent", "model_id", "tok_in", "tok_out"]),
    )
    for (const row of messageValues) insertMessage.run(...row)
    const insertToolCall = db.query(
      insertSql("tool_call", ["call_id", "session_id", "seq", "name", "status", "duration_ms", "truncated", "output_path"]),
    )
    for (const row of toolCallValues) insertToolCall.run(...row)
    const insertCompaction = db.query(
      insertSql("compaction", ["session_id", "seq", "reason", "status", "summary_ref", "tok_input"]),
    )
    for (const row of compactionValues) insertCompaction.run(...row)
    const insertInstruction = db.query(
      insertSql("instruction", ["session_id", "seq", "path", "blob_sha"]),
    )
    for (const row of instructionValues) insertInstruction.run(...row)
  })
  rebuild()
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
  return "written"
}

function indexMatches(
  targetPath: string,
  input: IndexInput,
  expected: Record<string, Value[][]>,
): boolean {
  const db = new Database(targetPath, { readonly: true })
  const tables = new Set(
    db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => (r as { name: string }).name),
  )
  const wanted = ["session", "delegation", "message", "tool_call", "compaction", "instruction"]
  if (wanted.some((t) => !tables.has(t))) {
    db.close()
    return false
  }
  const inList = input.sessionIDs.map(() => "?").join(", ")
  const existing: Record<string, Value[][]> = {
    session: fetchAll(db, "SELECT * FROM session WHERE root_id = ?", [input.rootID]),
    delegation: fetchAll(db, "SELECT * FROM delegation WHERE root_id = ?", [input.rootID]),
    message: fetchAll(db, `SELECT * FROM message WHERE session_id IN (${inList})`, [...input.sessionIDs]),
    tool_call: fetchAll(db, `SELECT * FROM tool_call WHERE session_id IN (${inList})`, [...input.sessionIDs]),
    compaction: fetchAll(db, `SELECT * FROM compaction WHERE session_id IN (${inList})`, [...input.sessionIDs]),
    instruction: fetchAll(db, `SELECT * FROM instruction WHERE session_id IN (${inList})`, [...input.sessionIDs]),
  }
  db.close()
  return wanted.every((table) => rowsEqual(sortRows(existing[table]), sortRows(expected[table])))
}

const fetchAll = (db: Database, sql: string, params: Value[]): Value[][] =>
  db
    .query(sql)
    .all(...params)
    .map((row) => Object.values(row as Record<string, unknown>) as Value[])
