import { Database } from "bun:sqlite"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// Verbatim host DDL from opencode v2.0.31 (`sqlite3 opencode.db ".schema ..."`).
export const DDL = `
CREATE TABLE session_v2 (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  workspace_id text,
  parent_id text,
  fork_session_id text,
  fork_boundary text,
  slug text NOT NULL,
  directory text NOT NULL,
  path text,
  title text,
  version text NOT NULL,
  share_url text,
  summary_additions integer,
  summary_deletions integer,
  summary_files integer,
  summary_diffs text,
  metadata text,
  cost real DEFAULT 0 NOT NULL,
  tokens_input integer DEFAULT 0 NOT NULL,
  tokens_output integer DEFAULT 0 NOT NULL,
  tokens_reasoning integer DEFAULT 0 NOT NULL,
  tokens_cache_read integer DEFAULT 0 NOT NULL,
  tokens_cache_write integer DEFAULT 0 NOT NULL,
  revert text,
  permission text,
  agent text,
  model text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_idle integer,
  time_viewed integer,
  idle_outcome text,
  time_compacting integer,
  time_archived integer,
  time_suspended integer,
  resume_attempts integer DEFAULT 0 NOT NULL,
  CONSTRAINT fk_session_v2_project_id_project_id_fk FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX session_v2_project_idx ON session_v2 (project_id);
CREATE INDEX session_v2_workspace_idx ON session_v2 (workspace_id);
CREATE INDEX session_v2_parent_idx ON session_v2 (parent_id);
CREATE INDEX session_v2_time_suspended_idx ON session_v2 (time_suspended) WHERE session_v2.time_suspended is not null;
CREATE TABLE session_message (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  type text NOT NULL,
  seq integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data text NOT NULL,
  CONSTRAINT fk_session_message_session_id_session_v2_id_fk FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX session_message_session_seq_idx ON session_message (session_id, seq);
CREATE INDEX session_message_session_type_seq_idx ON session_message (session_id, type, seq);
CREATE INDEX session_message_session_time_created_id_idx ON session_message (session_id, time_created, id);
CREATE INDEX session_message_time_created_idx ON session_message (time_created);
CREATE TABLE project (
  id text PRIMARY KEY,
  worktree text NOT NULL,
  vcs text,
  name text,
  icon_url text,
  icon_url_override text,
  icon_color text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_initialized integer,
  time_active integer DEFAULT 0 NOT NULL,
  sandboxes text NOT NULL,
  commands text,
  time_archived integer
);
CREATE TABLE kv (
  key text PRIMARY KEY,
  value text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
`

export const PROJECT_ID = "proj_test"

export const makeTmpDir = (): string => mkdtempSync(path.join(tmpdir(), "session-archive-test-"))

/** Creates a real SQLite file with the host schema; returns its path. */
export const makeDbFile = (dir: string): { db: Database; dbPath: string } => {
  const dbPath = path.join(dir, "opencode.db")
  const db = new Database(dbPath)
  db.exec(DDL)
  return { db, dbPath }
}

export const addProject = (db: Database, id = PROJECT_ID, worktree = "/repo") => {
  db.query("INSERT INTO project (id, worktree, sandboxes, time_created, time_updated) VALUES (?, ?, '[]', 0, 0)").run(
    id,
    worktree,
  )
}

export interface SessionSeed {
  readonly id: string
  readonly project_id?: string
  readonly parent_id?: string | null
  readonly fork_session_id?: string | null
  readonly fork_boundary?: string | null
  readonly directory?: string
  readonly title?: string | null
  readonly agent?: string | null
  readonly model?: unknown
  readonly idle_outcome?: string | null
  readonly cost?: number
  readonly time_created?: number
  readonly time_updated?: number
  readonly resume_attempts?: number
}

export const addSession = (db: Database, seed: SessionSeed) => {
  db.query(
    `INSERT INTO session_v2 (id, project_id, parent_id, fork_session_id, fork_boundary, slug, directory, title,
      version, agent, model, idle_outcome, cost, tokens_input, tokens_output, tokens_reasoning,
      tokens_cache_read, tokens_cache_write, summary_additions, summary_deletions, summary_files,
      time_created, time_updated, resume_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2.0.31', ?, ?, ?, ?, 10, 20, 5, 3, 2, 4, 6, 2, ?, ?, ?)`,
  ).run(
    seed.id,
    seed.project_id ?? PROJECT_ID,
    seed.parent_id ?? null,
    seed.fork_session_id ?? null,
    seed.fork_boundary ?? null,
    `slug-${seed.id}`,
    seed.directory ?? "/repo",
    seed.title ?? null,
    seed.agent ?? "build",
    seed.model === undefined ? JSON.stringify({ id: "gpt-6.1-sol", providerID: "openai", variant: "max" }) : seed.model === null ? null : JSON.stringify(seed.model),
    seed.idle_outcome ?? "succeeded",
    seed.cost ?? 0.5,
    seed.time_created ?? 1000,
    seed.time_updated ?? 2000,
    seed.resume_attempts ?? 0,
  )
}

export interface MessageSeed {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly seq: number
  readonly data: unknown
  readonly time_created?: number
  readonly time_updated?: number
}

export const addMessage = (db: Database, seed: MessageSeed) => {
  db.query(
    "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    seed.id,
    seed.session_id,
    seed.type,
    seed.seq,
    seed.time_created ?? 1000 + seed.seq,
    seed.time_updated ?? 1000 + seed.seq,
    JSON.stringify(seed.data),
  )
}

export const encodeUtf16BeHex = (input: string): string =>
  Array.from(input)
    .map((ch) => ch.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("")

export const addKv = (
  db: Database,
  seed: { key: string; value: unknown; time_created?: number; time_updated?: number },
) => {
  db.query("INSERT OR REPLACE INTO kv (key, value, time_created, time_updated) VALUES (?, ?, ?, ?)").run(
    seed.key,
    typeof seed.value === "string" ? seed.value : JSON.stringify(seed.value),
    seed.time_created ?? 1000,
    seed.time_updated ?? 2000,
  )
}
