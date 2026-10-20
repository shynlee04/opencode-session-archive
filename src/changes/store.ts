/**
 * Durable signal/change store.
 *
 * The signal is generated on idle from the real git + host ledger. The trace
 * action is live-first, so a stored row is an audit record and a stable target
 * for the one-line injection; it is never the only way to see the change.
 */

import { Database } from "bun:sqlite"
import type { Change } from "./model.ts"
import { renderSignal } from "./model.ts"

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

export function persistTrace(db: Database, change: Change, signal: string): void {
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
  db.query(
    `INSERT OR REPLACE INTO pending_signal (session_id, change_id, signal, created_at, consumed_at)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(change.session, change.id, signal, change.t)
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
    const change = JSON.parse(row.payload) as Change
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
