/**
 * Durable signal/change store & archive touch queries.
 *
 * The signal is generated on idle from the real git + host ledger. The trace
 * action is live-first, so a stored row is an audit record and a stable target
 * for the one-line injection; it is never the only way to see the change.
 */

import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import {
  type Change,
  type Kind,
  type LedgerEntry,
  type Op,
  type RelatedSession,
  classify,
  materiality,
  renderSignal,
} from "./model.ts"

export const TRACE_SCHEMA = `
CREATE TABLE IF NOT EXISTS change (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  worktree TEXT NOT NULL,
  branch TEXT NOT NULL,
  base TEXT NOT NULL,
  commit_sha TEXT,
  session_id TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_session ON change(session_id, t DESC);
CREATE INDEX IF NOT EXISTS idx_change_root ON change(root_session_id, t DESC);
CREATE TABLE IF NOT EXISTS pending_signal (
  session_id TEXT NOT NULL,
  change_id TEXT NOT NULL,
  signal TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  PRIMARY KEY (session_id, change_id)
);
CREATE INDEX IF NOT EXISTS idx_pending_signal_session ON pending_signal(session_id, created_at DESC);
`

export function ensureTraceSchema(db: Database): void {
  db.exec(TRACE_SCHEMA)
}

export function persistTrace(db: Database, change: Change, signal: string): { alreadyConsumed: boolean } {
  ensureTraceSchema(db)
  db.query(
    `INSERT OR REPLACE INTO change
      (id, state, worktree, branch, base, commit_sha, session_id, root_session_id, t, summary, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    change.id,
    change.state,
    change.worktree,
    change.branch,
    change.base,
    change.commit ?? null,
    change.session,
    change.root,
    change.t,
    change.summary,
    JSON.stringify(change),
  )

  const existing = db
    .query("SELECT consumed_at FROM pending_signal WHERE session_id = ? AND change_id = ? LIMIT 1")
    .get(change.session, change.id) as { consumed_at?: number | null } | null
  if (existing && existing.consumed_at != null) {
    db.query("UPDATE pending_signal SET signal = ? WHERE session_id = ? AND change_id = ?").run(
      signal,
      change.session,
      change.id,
    )
    return { alreadyConsumed: true }
  }

  db.query(
    `INSERT OR REPLACE INTO pending_signal (session_id, change_id, signal, created_at, consumed_at)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(change.session, change.id, signal, change.t)
  return { alreadyConsumed: false }
}

const VALID_KINDS = new Set<Kind>([
  "source",
  "test",
  "config",
  "docs",
  "generated",
  "vendored",
  "archive",
  "secret",
  "ignore",
  "unknown",
])

function normalizeStoredChange(raw: Change): Change {
  const files = (raw.files ?? []).map((f) => {
    const kind = VALID_KINDS.has(f.kind) ? f.kind : classify(f.path)
    const mat = materiality(kind, f.attribution, false)
    return { ...f, kind, materiality: mat }
  })
  const byKind: Partial<Record<Kind, number>> = {}
  for (const f of files) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1
  return {
    ...raw,
    files,
    evidence: raw.evidence ?? [],
    actors: raw.actors ?? [],
    preExisting: raw.preExisting ?? [],
    worktrees: raw.worktrees ?? [],
    related: raw.related ?? [],
    history: raw.history ?? [],
    counts: {
      ...raw.counts,
      files: files.length,
      material: files.filter((f) => f.materiality === "material").length,
      context: files.filter((f) => f.materiality === "context").length,
      noise: files.filter((f) => f.materiality === "noise").length,
      blocked: files.filter((f) => f.materiality === "blocked").length,
      byKind,
    },
  }
}

export interface StoredTrace {
  change: Change
  signal: string
}

export function readStoredTrace(db: Database, opts: { changeID?: string; sessionID?: string }): StoredTrace | null {
  try {
    const table = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='change'")
      .get() as { name?: string } | null
    if (!table?.name) return null
    const row = opts.changeID
      ? (db
          .query(
            `SELECT c.payload, p.signal
             FROM change c LEFT JOIN pending_signal p ON p.change_id = c.id
             WHERE c.id = ? LIMIT 1`,
          )
          .get(opts.changeID) as { payload?: string; signal?: string } | null)
      : opts.sessionID
        ? (db
            .query(
              `SELECT c.payload, p.signal
               FROM change c LEFT JOIN pending_signal p ON p.change_id = c.id
               WHERE c.session_id = ? OR c.root_session_id = ?
               ORDER BY c.t DESC LIMIT 1`,
            )
            .get(opts.sessionID, opts.sessionID) as { payload?: string; signal?: string } | null)
        : null
    if (!row?.payload) return null
    const change = normalizeStoredChange(JSON.parse(row.payload) as Change)
    return { change, signal: row.signal ?? renderSignal(change) ?? "" }
  } catch {
    return null
  }
}

export function markSignalConsumed(db: Database, sessionID: string, changeID: string): void {
  try {
    db.query("UPDATE pending_signal SET consumed_at = ? WHERE session_id = ? AND change_id = ?").run(
      Date.now(),
      sessionID,
      changeID,
    )
  } catch {
    // Non-fatal: the in-memory signal map is authoritative for the hook.
  }
}

export function readOtherTouches(
  indexDbPath: string,
  paths: readonly string[],
  excludeSessions: readonly string[],
  minTimeMs = 0,
): LedgerEntry[] {
  if (!existsSync(indexDbPath) || paths.length === 0) return []
  let db: Database | null = null
  try {
    db = new Database(indexDbPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 5000;")
    const hasTouch = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='file_touch'")
      .get() as { name?: string } | null
    if (!hasTouch?.name) return []
    const placeholders = paths.map(() => "?").join(",")
    const exclude = excludeSessions.length > 0 ? excludeSessions.map(() => "?").join(",") : null
    const timeClause = minTimeMs > 0 ? " AND t >= ?" : ""
    const sql = `SELECT session_id, normalized_path, tool, op, t FROM file_touch
      WHERE normalized_path IN (${placeholders})${exclude ? ` AND session_id NOT IN (${exclude})` : ""}${timeClause}
      ORDER BY t DESC`
    const params: Array<string | number> = [...paths, ...excludeSessions]
    if (minTimeMs > 0) params.push(minTimeMs)
    const rows = db.query(sql).all(...params) as Array<{
      session_id: string
      normalized_path: string
      tool: string
      op: string
      t: number
    }>
    const seen = new Set<string>()
    const out: LedgerEntry[] = []
    for (const row of rows) {
      if (seen.has(row.normalized_path)) continue
      seen.add(row.normalized_path)
      const op: Op = row.op.includes("add")
        ? "add"
        : row.op.includes("delete")
          ? "delete"
          : row.op.includes("rename")
            ? "rename"
            : "modify"
      out.push({
        session: row.session_id,
        root: row.session_id,
        path: row.normalized_path,
        op,
        tool: row.tool === "write" ? "write" : row.tool === "patch" ? "patch" : row.tool === "shell" ? "shell" : "edit",
        before: null,
        after: null,
        scope: "fragment",
        t: Number(row.t ?? 0),
      })
    }
    return out
  } catch {
    return []
  } finally {
    db?.close()
  }
}

export function readRelatedFromArchive(
  indexDbPath: string,
  paths: readonly string[],
  excludeSessions: readonly string[],
): RelatedSession[] {
  if (!existsSync(indexDbPath) || paths.length === 0) return []
  let db: Database | null = null
  try {
    db = new Database(indexDbPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 5000;")
    const hasTouch = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='file_touch'")
      .get() as { name?: string } | null
    if (!hasTouch?.name) return []
    const placeholders = paths.map(() => "?").join(",")
    const exclude = excludeSessions.length > 0 ? excludeSessions.map(() => "?").join(",") : null
    const rows = db
      .query(
        `SELECT session_id, normalized_path, MAX(t) AS t FROM file_touch
         WHERE normalized_path IN (${placeholders})${exclude ? ` AND session_id NOT IN (${exclude})` : ""}
         GROUP BY session_id, normalized_path ORDER BY t DESC LIMIT 20`,
      )
      .all(...paths, ...excludeSessions) as Array<{ session_id: string; normalized_path: string; t: number }>
    const seen = new Set<string>()
    const out: RelatedSession[] = []
    for (const row of rows) {
      if (seen.has(row.session_id)) continue
      seen.add(row.session_id)
      out.push({
        session: row.session_id,
        root: row.session_id,
        reason: "path",
        handle: `session:${row.session_id}`,
        t: Number(row.t ?? 0),
      })
    }
    return out.slice(0, 5)
  } catch {
    return []
  } finally {
    db?.close()
  }
}
