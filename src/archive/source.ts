import { Database } from "bun:sqlite"
import type { MessageRow, ProjectRow, SessionRow } from "./types.ts"

export interface SessionSource {
  project(id: string): ProjectRow | undefined
  session(id: string): SessionRow | undefined
  children(id: string): SessionRow[]
  messages(sessionID: string): MessageRow[]
}

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  project: ["id", "worktree"],
  session_v2: [
    "id",
    "project_id",
    "parent_id",
    "fork_session_id",
    "fork_boundary",
    "directory",
    "title",
    "agent",
    "model",
    "idle_outcome",
    "cost",
    "tokens_input",
    "tokens_output",
    "tokens_reasoning",
    "tokens_cache_read",
    "tokens_cache_write",
    "summary_additions",
    "summary_deletions",
    "summary_files",
    "time_created",
    "time_updated",
    "time_idle",
    "time_compacting",
    "time_archived",
    "resume_attempts",
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "time_updated", "data"],
}

const parseJson = (text: unknown): unknown => {
  if (typeof text !== "string") return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const toSessionRow = (raw: Record<string, unknown>): SessionRow => ({
  id: raw.id as string,
  project_id: raw.project_id as string,
  parent_id: (raw.parent_id as string | null) ?? null,
  fork_session_id: (raw.fork_session_id as string | null) ?? null,
  fork_boundary: (raw.fork_boundary as string | null) ?? null,
  directory: raw.directory as string,
  title: (raw.title as string | null) ?? null,
  agent: (raw.agent as string | null) ?? null,
  model: (() => {
    const parsed = parseJson(raw.model)
    if (typeof parsed !== "object" || parsed === null) return null
    const m = parsed as Record<string, unknown>
    return typeof m.id === "string" && typeof m.providerID === "string"
      ? typeof m.variant === "string"
        ? { id: m.id, providerID: m.providerID, variant: m.variant }
        : { id: m.id, providerID: m.providerID }
      : null
  })(),
  idle_outcome: (raw.idle_outcome as string | null) ?? null,
  cost: (raw.cost as number) ?? 0,
  tokens_input: (raw.tokens_input as number) ?? 0,
  tokens_output: (raw.tokens_output as number) ?? 0,
  tokens_reasoning: (raw.tokens_reasoning as number) ?? 0,
  tokens_cache_read: (raw.tokens_cache_read as number) ?? 0,
  tokens_cache_write: (raw.tokens_cache_write as number) ?? 0,
  summary_additions: (raw.summary_additions as number | null) ?? null,
  summary_deletions: (raw.summary_deletions as number | null) ?? null,
  summary_files: (raw.summary_files as number | null) ?? null,
  time_created: raw.time_created as number,
  time_updated: raw.time_updated as number,
  time_idle: (raw.time_idle as number | null) ?? null,
  time_compacting: (raw.time_compacting as number | null) ?? null,
  time_archived: (raw.time_archived as number | null) ?? null,
  resume_attempts: (raw.resume_attempts as number) ?? 0,
})

export function sqliteSource(dbPath: string): SessionSource & { close(): void } {
  const db = new Database(dbPath, { readonly: true })

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(
      db
        .query("SELECT name FROM pragma_table_info(?)")
        .all(table)
        .map((row) => (row as { name: string }).name),
    )
    for (const column of columns) {
      if (!present.has(column)) {
        db.close()
        throw new Error(`session-archive: host schema drift: ${table}.${column} missing`)
      }
    }
  }

  return {
    project(id) {
      const row = db.query("SELECT id, worktree FROM project WHERE id = ?").get(id)
      return row === null ? undefined : (row as ProjectRow)
    },
    session(id) {
      const row = db.query("SELECT * FROM session_v2 WHERE id = ?").get(id)
      return row === null ? undefined : toSessionRow(row as Record<string, unknown>)
    },
    children(id) {
      return db
        .query("SELECT * FROM session_v2 WHERE parent_id = ? ORDER BY time_created, id")
        .all(id)
        .map((row) => toSessionRow(row as Record<string, unknown>))
    },
    messages(sessionID) {
      return db
        .query(
          "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq",
        )
        .all(sessionID)
        .map((row) => {
          const r = row as Omit<MessageRow, "data"> & { data: string }
          return { ...r, data: parseJson(r.data) }
        })
    },
    close() {
      db.close()
    },
  }
}
