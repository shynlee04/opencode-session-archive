/**
 * Real git adapter for the change-set trace.
 *
 * Read-only by construction: every command is run with `GIT_OPTIONAL_LOCKS=0`
 * and no command mutates the index or the working tree.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  type ChangeState,
  type HistoryEntry,
  type LedgerEntry,
  type Op,
  type RawChange,
  type RelatedSession,
  type TicketState,
  type WorktreeState,
  fullHash,
} from "./model.ts"

export interface GitStatusEntry {
  path: string
  origPath: string | null
  xy: string
}

export interface GitFile extends RawChange {
  mtime: number
}

export interface GitSnapshot {
  ok: boolean
  error?: string
  root: string
  branch: string
  base: string
  state: ChangeState
  files: GitFile[]
  worktrees: WorktreeState[]
  history: HistoryEntry[]
  baseline: Map<string, string | null>
  mtimes: Map<string, number>
}

export interface CommitSnapshot {
  ok: boolean
  error?: string
  root: string
  commit: string
  subject: string
  branch: string
  base: string
  t: number
  files: GitFile[]
  commitFiles: Map<string, string | null>
  baseline: Map<string, string | null>
  mtimes: Map<string, number>
  history: HistoryEntry[]
}

function runGit(cwd: string, args: string[]): { ok: boolean; code: number; stdout: Buffer; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", cwd, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_PAGER: "cat",
    },
  })
  return {
    ok: proc.exitCode === 0,
    code: proc.exitCode ?? 1,
    stdout: Buffer.from(proc.stdout ?? []),
    stderr: Buffer.from(proc.stderr ?? []).toString("utf8").trim(),
  }
}

function runGitText(cwd: string, args: string[]): string {
  const r = runGit(cwd, args)
  return r.ok ? r.stdout.toString("utf8") : ""
}

export function parsePorcelainV2(text: string): GitStatusEntry[] {
  const records = text.split("\0")
  const entries: GitStatusEntry[] = []
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (!rec) continue
    const type = rec[0]
    if (type === "1") {
      const parts = rec.split(" ")
      entries.push({ xy: parts[1] ?? "..", path: parts.slice(8).join(" "), origPath: null })
    } else if (type === "2") {
      const parts = rec.split(" ")
      const orig = records[++i] ?? ""
      entries.push({ xy: parts[1] ?? "..", path: parts.slice(9).join(" "), origPath: orig || null })
    } else if (type === "u") {
      const parts = rec.split(" ")
      entries.push({ xy: parts[1] ?? "..", path: parts.slice(10).join(" "), origPath: null })
    } else if (type === "?") {
      entries.push({ xy: "??", path: rec.slice(2), origPath: null })
    }
  }
  return entries
}

export function opFromStatus(xy: string, origPath: string | null): Op {
  if (xy === "??") return "add"
  if (xy.includes("R") || origPath) return "rename"
  if (xy.includes("A")) return "add"
  if (xy.includes("D")) return "delete"
  return "modify"
}

function blobAt(cwd: string, spec: string): string | null {
  const r = runGit(cwd, ["cat-file", "blob", spec])
  if (!r.ok) return null
  return fullHash(r.stdout)
}

function headBlob(cwd: string, relPath: string): string | null {
  return blobAt(cwd, `HEAD:${relPath}`)
}

function commitBlob(cwd: string, commit: string, relPath: string): string | null {
  return blobAt(cwd, `${commit}:${relPath}`)
}

function fileHash(absPath: string): string | null {
  if (!existsSync(absPath)) return null
  try {
    return fullHash(readFileSync(absPath))
  } catch {
    return null
  }
}

function fileMtime(absPath: string): number {
  try {
    return statSync(absPath).mtimeMs
  } catch {
    return 0
  }
}

function numstatMap(cwd: string, args: string[]): Map<string, { adds: number; dels: number }> {
  const out = runGitText(cwd, args)
  const map = new Map<string, { adds: number; dels: number }>()
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [a, d, ...rest] = line.split("\t")
    const rel = rest.join("\t")
    if (!rel) continue
    map.set(rel, { adds: Number.parseInt(a, 10) || 0, dels: Number.parseInt(d, 10) || 0 })
  }
  return map
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

function ticketStatus(body: string): string {
  const m = body.match(/^\s*(?:status|state)\s*:\s*([^\n]+)$/im)
  return m ? m[1].trim() : "unknown"
}

function walkTickets(root: string): string[] {
  const phases = path.join(root, ".planning", "phases")
  if (!existsSync(phases)) return []
  const out: string[] = []
  for (const phase of readdirSync(phases, { withFileTypes: true })) {
    if (!phase.isDirectory()) continue
    const dir = path.join(phases, phase.name, "tickets")
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) out.push(path.join(dir, entry.name))
    }
  }
  return out
}

export function readTickets(root: string): TicketState[] {
  const tickets: TicketState[] = []
  for (const file of walkTickets(root)) {
    let body = ""
    try {
      body = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const rel = path.relative(root, file).replace(/\\/g, "/")
    const phase = rel.split("/")[2] ?? ""
    const id = path.basename(file, ".md")
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id
    const passed = (body.match(/^\s*-\s*\[[xX]\]/gm) ?? []).length
    const total = passed + (body.match(/^\s*-\s*\[\s\]/gm) ?? []).length
    tickets.push({
      id,
      title: heading,
      phase,
      status: ticketStatus(body),
      acceptance: { passed, total },
      path: rel,
    })
  }
  return tickets.sort((a, b) => a.id.localeCompare(b.id))
}

export function readWorktrees(root: string): WorktreeState[] {
  const out = runGitText(root, ["worktree", "list", "--porcelain"])
  const worktrees: WorktreeState[] = []
  let current: { root?: string; head?: string; branch?: string } = {}
  const flush = () => {
    if (!current.root) return
    const dir = current.root
    const status = runGitText(dir, ["status", "--porcelain=v2", "--untracked-files=normal"])
    worktrees.push({
      root: dir,
      branch: current.branch ?? "HEAD",
      base: current.head ?? "",
      dirty: status.split("\n").filter(Boolean).length,
      ahead: 0,
      behind: 0,
    })
    current = {}
  }
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush()
      current.root = line.slice("worktree ".length)
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length)
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "")
    } else if (line.trim() === "") {
      flush()
    }
  }
  flush()
  return worktrees
}

export function readHistory(root: string, limit = 5): HistoryEntry[] {
  const out = runGitText(root, ["log", `-${limit}`, "--format=%H%x00%s%x00%ct"])
  const entries: HistoryEntry[] = []
  for (const line of out.split("\n")) {
    if (!line.trim()) continue
    const [commit, subject, ts] = line.split("\0")
    if (!commit) continue
    entries.push({
      commit: commit.slice(0, 12),
      subject: subject ?? "",
      worktree: root,
      t: Number.parseInt(ts ?? "0", 10) || 0,
    })
  }
  return entries
}

export function readGitSnapshot(rootArg: string): GitSnapshot {
  const root = path.resolve(rootArg)
  const topRes = runGit(root, ["rev-parse", "--show-toplevel"])
  if (!topRes.ok) {
    return {
      ok: false,
      error: `not a git worktree: ${root}`,
      root,
      branch: "",
      base: "",
      state: "dirty",
      files: [],
      worktrees: [],
      history: [],
      baseline: new Map(),
      mtimes: new Map(),
    }
  }
  const top = topRes.stdout.toString("utf8").trim()
  const branch = runGitText(top, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD"
  const base = runGitText(top, ["rev-parse", "HEAD"]).trim()
  const status = runGit(top, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
  const entries = parsePorcelainV2(status.stdout.toString("utf8"))
  const numstat = numstatMap(top, ["diff", "--numstat", "HEAD"])
  const files: GitFile[] = []
  const baseline = new Map<string, string | null>()
  const mtimes = new Map<string, number>()

  for (const entry of entries) {
    const beforeRel = entry.origPath ?? entry.path
    const before = headBlob(top, beforeRel)
    const after = entry.xy.includes("D") ? null : fileHash(path.join(top, entry.path))
    const stat = numstat.get(entry.path)
    let adds = stat?.adds ?? 0
    let dels = stat?.dels ?? 0
    if (entry.xy === "??" && after) {
      try {
        adds = countLines(readFileSync(path.join(top, entry.path), "utf8"))
      } catch {
        adds = 0
      }
    }
    if (entry.xy.includes("D") && before) {
      const r = runGit(top, ["cat-file", "blob", `HEAD:${beforeRel}`])
      if (r.ok) dels = countLines(r.stdout.toString("utf8"))
    }
    files.push({
      path: entry.path,
      op: opFromStatus(entry.xy, entry.origPath),
      before,
      after,
      adds,
      dels,
      mtime: fileMtime(path.join(top, entry.path)),
    })
    baseline.set(entry.path, before)
    mtimes.set(entry.path, fileMtime(path.join(top, entry.path)))
  }

  return {
    ok: true,
    root: top,
    branch,
    base,
    state: files.length > 0 ? "dirty" : "committed",
    files,
    worktrees: readWorktrees(top),
    history: readHistory(top),
    baseline,
    mtimes,
  }
}

function parseNameStatus(text: string): Array<{ path: string; origPath: string | null; op: Op }> {
  const out: Array<{ path: string; origPath: string | null; op: Op }> = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const parts = line.split("\t")
    const code = parts[0] ?? ""
    if (code.startsWith("R") || code.startsWith("C")) {
      const origPath = parts[1] ?? ""
      const next = parts[2] ?? ""
      if (next) out.push({ path: next, origPath, op: "rename" })
      continue
    }
    const rel = parts[1] ?? ""
    if (!rel) continue
    const op: Op = code.startsWith("A") ? "add" : code.startsWith("D") ? "delete" : "modify"
    out.push({ path: rel, origPath: null, op })
  }
  return out
}

export function readCommitSnapshot(rootArg: string, commit: string): CommitSnapshot {
  const root = path.resolve(rootArg)
  const topRes = runGit(root, ["rev-parse", "--show-toplevel"])
  if (!topRes.ok) {
    return {
      ok: false,
      error: `not a git worktree: ${root}`,
      root,
      commit,
      subject: "",
      branch: "",
      base: "",
      t: 0,
      files: [],
      commitFiles: new Map(),
      baseline: new Map(),
      mtimes: new Map(),
      history: [],
    }
  }
  const top = topRes.stdout.toString("utf8").trim()
  const meta = runGitText(top, ["show", "--no-patch", "--format=%H%x00%s%x00%ct", commit]).trim()
  const [sha, subject, ts] = meta.split("\0")
  const resolved = sha || commit
  const parent = runGitText(top, ["rev-parse", `${resolved}^`]).trim()
  const nameStatus = runGitText(top, ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", resolved])
  const numstat = numstatMap(top, ["show", "--numstat", "--format=", resolved])
  const files: GitFile[] = []
  const commitFiles = new Map<string, string | null>()
  const baseline = new Map<string, string | null>()
  const mtimes = new Map<string, number>()

  for (const entry of parseNameStatus(nameStatus)) {
    const before = entry.origPath ? commitBlob(top, parent || "4b825dc642cb6eb9a060e54bf8d69288fbee4904", entry.origPath) : parent ? commitBlob(top, parent, entry.path) : null
    const after = entry.op === "delete" ? null : commitBlob(top, resolved, entry.path)
    const stat = numstat.get(entry.path)
    files.push({
      path: entry.path,
      op: entry.op,
      before,
      after,
      adds: stat?.adds ?? 0,
      dels: stat?.dels ?? 0,
      mtime: 0,
    })
    commitFiles.set(entry.path, after)
    baseline.set(entry.path, before)
  }

  return {
    ok: true,
    root: top,
    commit: resolved,
    subject: subject ?? "",
    branch: runGitText(top, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD",
    base: parent,
    t: Number.parseInt(ts ?? "0", 10) || 0,
    files,
    commitFiles,
    baseline,
    mtimes,
    history: readHistory(top),
  }
}

export function readOtherTouches(
  indexDbPath: string,
  paths: string[],
  excludeSessions: readonly string[],
): LedgerEntry[] {
  if (!existsSync(indexDbPath) || paths.length === 0) return []
  let db: Database | null = null
  try {
    db = new Database(indexDbPath, { readonly: true })
    const hasTouch = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='file_touch'")
      .get() as { name?: string } | null
    if (!hasTouch?.name) return []
    const placeholders = paths.map(() => "?").join(",")
    const exclude = excludeSessions.length > 0 ? excludeSessions.map(() => "?").join(",") : null
    const sql = `SELECT session_id, normalized_path, tool, op, t FROM file_touch
      WHERE normalized_path IN (${placeholders})${exclude ? ` AND session_id NOT IN (${exclude})` : ""}
      ORDER BY t DESC`
    const rows = db.query(sql).all(...paths, ...excludeSessions) as Array<{
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

export function readRelatedFromArchive(indexDbPath: string, paths: string[], excludeSession: string): RelatedSession[] {
  if (!existsSync(indexDbPath) || paths.length === 0) return []
  let db: Database | null = null
  try {
    db = new Database(indexDbPath, { readonly: true })
    const hasTouch = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='file_touch'")
      .get() as { name?: string } | null
    if (!hasTouch?.name) return []
    const placeholders = paths.map(() => "?").join(",")
    const rows = db
      .query(
        `SELECT session_id, normalized_path, MAX(t) AS t FROM file_touch
         WHERE normalized_path IN (${placeholders}) AND session_id != ?
         GROUP BY session_id, normalized_path ORDER BY t DESC LIMIT 20`,
      )
      .all(...paths, excludeSession) as Array<{ session_id: string; normalized_path: string; t: number }>
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
