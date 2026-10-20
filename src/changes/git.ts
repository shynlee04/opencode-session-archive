/**
 * Real git adapter for the change-set trace (Iteration 2 — Batched & Project-Agnostic).
 *
 * Read-only by construction: every command is run with `GIT_OPTIONAL_LOCKS=0`
 * and `-c core.quotePath=false`, and no command mutates the index or working tree.
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import {
  type ChangeState,
  type HistoryEntry,
  type Op,
  type RawChange,
  type WorktreeState,
  fullHash,
} from "./model.ts"

export { readOtherTouches, readRelatedFromArchive } from "./store.ts"

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
  headCommitMs: number
  state: ChangeState
  files: GitFile[]
  worktrees: WorktreeState[]
  history: HistoryEntry[]
  baseline: Map<string, string | null>
  mtimes: Map<string, number>
  headContents: Map<string, string>
  diskContents: Map<string, string>
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
  headContents: Map<string, string>
  diskContents: Map<string, string>
}

function isSafeCommitRef(ref: string | undefined): ref is string {
  return typeof ref === "string" && ref.trim().length > 0 && !ref.trim().startsWith("-")
}

function runGit(
  cwd: string,
  args: string[],
  stdinText?: string,
): { ok: boolean; code: number; stdout: Buffer; stderr: string } {
  const proc = Bun.spawnSync({
    cmd: ["git", "-c", "core.quotePath=false", "-C", cwd, ...args],
    stdin: stdinText !== undefined ? Buffer.from(stdinText, "utf8") : undefined,
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

interface BatchBlobInfo {
  sha256: string
  lines: number
  text?: string
}

/**
 * Reads an arbitrary list of `<rev>:<path>` specs in a single `git cat-file --batch`
 * subprocess instead of spawning one process per file. Skips UTF-8 decoding for binary blobs.
 */
function batchReadBlobs(cwd: string, specs: string[]): Map<string, BatchBlobInfo> {
  const out = new Map<string, BatchBlobInfo>()
  const unique = [...new Set(specs.filter(Boolean))]
  if (unique.length === 0) return out

  const r = runGit(cwd, ["cat-file", "--batch"], `${unique.join("\n")}\n`)
  if (!r.ok && r.stdout.length === 0) return out

  const buf = r.stdout
  let offset = 0
  let specIdx = 0
  while (offset < buf.length && specIdx < unique.length) {
    const nl = buf.indexOf(10, offset)
    if (nl === -1) break
    const header = buf.subarray(offset, nl).toString("utf8")
    const spec = unique[specIdx++]!
    offset = nl + 1
    if (header.endsWith(" missing") || header.endsWith(" ambiguous")) {
      continue
    }
    const parts = header.split(" ")
    const size = Number.parseInt(parts[parts.length - 1] ?? "0", 10)
    if (!Number.isFinite(size) || size < 0 || offset + size > buf.length) {
      break
    }
    const content = buf.subarray(offset, offset + size)
    offset += size + 1 // skip trailing LF after blob payload
    const sha256 = fullHash(content)
    const isBinary = content.includes(0)
    const text = !isBinary && size <= 512 * 1024 ? content.toString("utf8") : undefined
    const lines = text !== undefined ? countLines(text) : 0
    out.set(spec, { sha256, lines, text })
  }
  return out
}

function readDiskFile(absPath: string): { sha256: string | null; mtime: number; text?: string; lines: number } {
  if (!existsSync(absPath)) return { sha256: null, mtime: 0, lines: 0 }
  try {
    const st = statSync(absPath)
    if (!st.isFile()) return { sha256: null, mtime: st.mtimeMs, lines: 0 }
    const buf = readFileSync(absPath)
    const sha256 = fullHash(buf)
    const isBinary = buf.includes(0)
    const text = !isBinary && buf.length <= 512 * 1024 ? buf.toString("utf8") : undefined
    const lines = text !== undefined ? countLines(text) : 0
    return { sha256, mtime: st.mtimeMs, text, lines }
  } catch {
    return { sha256: null, mtime: 0, lines: 0 }
  }
}

function numstatMap(cwd: string, args: string[]): Map<string, { adds: number; dels: number }> {
  const out = runGitText(cwd, [...args, "-z"])
  const map = new Map<string, { adds: number; dels: number }>()
  const tokens = out.split("\0")
  for (let i = 0; i < tokens.length; i++) {
    const rec = tokens[i]
    if (!rec) continue
    const parts = rec.split("\t")
    if (parts.length < 3) continue
    const adds = Number.parseInt(parts[0] ?? "0", 10) || 0
    const dels = Number.parseInt(parts[1] ?? "0", 10) || 0
    let rel = parts.slice(2).join("\t")
    // With --numstat -z, renames have an empty path field followed by NUL old\0new\0
    if (rel === "" && i + 2 < tokens.length) {
      i += 1 // old path
      rel = tokens[++i] ?? ""
    }
    if (!rel) continue
    map.set(rel, { adds, dels })
  }
  return map
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
}

export function readWorktrees(root: string, activeRootDirtyCount?: number): WorktreeState[] {
  const out = runGitText(root, ["worktree", "list", "--porcelain"])
  const worktrees: WorktreeState[] = []
  let current: { root?: string; head?: string; branch?: string } = {}
  let statusChecks = 0
  const flush = () => {
    if (!current.root) return
    const dir = current.root
    let dirty = 0
    if (path.resolve(dir) === path.resolve(root) && activeRootDirtyCount !== undefined) {
      dirty = activeRootDirtyCount
    } else if (statusChecks < 6 && existsSync(dir)) {
      statusChecks++
      const status = runGitText(dir, ["status", "--porcelain=v2", "-uno"])
      dirty = status.split("\n").filter(Boolean).length
    }
    worktrees.push({
      root: dir,
      branch: current.branch ?? "HEAD",
      base: current.head ?? "",
      dirty,
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
      t: (Number.parseInt(ts ?? "0", 10) || 0) * 1000,
    })
  }
  return entries
}

export function readFileDiffExcerpt(root: string, relPath: string, commit?: string, maxLines = 60): string | undefined {
  if (!relPath || relPath.startsWith("-")) return undefined
  if (commit !== undefined && !isSafeCommitRef(commit)) return undefined

  const raw = commit
    ? runGitText(root, ["show", "--format=", "--unified=2", commit, "--", relPath])
    : runGitText(root, ["diff", "--unified=2", "HEAD", "--", relPath])

  if (raw.trim()) {
    const lines = raw.trim().split("\n")
    if (lines.length <= maxLines) return lines.join("\n")
    return `${lines.slice(0, maxLines).join("\n")}\n… (+${lines.length - maxLines} diff lines)`
  }

  // Fallback for untracked newly added files (`??`): render synthetic unified diff
  if (!commit) {
    const disk = readDiskFile(path.join(root, relPath))
    if (disk.text !== undefined) {
      const contentLines = disk.text.replace(/\r\n/g, "\n").split("\n")
      if (contentLines.length > 1 && contentLines[contentLines.length - 1] === "") {
        contentLines.pop()
      }
      const header = `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${contentLines.length} @@`
      const body = contentLines.map((l) => `+${l}`)
      const all = [header, ...body]
      if (all.length <= maxLines) return all.join("\n")
      return `${all.slice(0, maxLines).join("\n")}\n… (+${all.length - maxLines} diff lines)`
    }
  }
  return undefined
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
      headCommitMs: 0,
      state: "dirty",
      files: [],
      worktrees: [],
      history: [],
      baseline: new Map(),
      mtimes: new Map(),
      headContents: new Map(),
      diskContents: new Map(),
    }
  }
  const top = topRes.stdout.toString("utf8").trim()
  const branch = runGitText(top, ["rev-parse", "--abbrev-ref", "HEAD"]).trim() || "HEAD"
  const base = runGitText(top, ["rev-parse", "HEAD"]).trim()
  const headTsSec = Number.parseInt(runGitText(top, ["show", "-s", "--format=%ct", "HEAD"]).trim() || "0", 10) || 0
  const headCommitMs = headTsSec * 1000
  const status = runGit(top, ["status", "--porcelain=v2", "-z", "--untracked-files=all"])
  const entries = parsePorcelainV2(status.stdout.toString("utf8"))
  const numstat = numstatMap(top, ["diff", "--numstat", "HEAD"])
  const files: GitFile[] = []
  const baseline = new Map<string, string | null>()
  const mtimes = new Map<string, number>()
  const headContents = new Map<string, string>()
  const diskContents = new Map<string, string>()

  const headSpecs = entries
    .filter((e) => e.xy !== "??")
    .map((e) => `HEAD:${e.origPath ?? e.path}`)
  const headBlobs = batchReadBlobs(top, headSpecs)

  for (const entry of entries) {
    const beforeRel = entry.origPath ?? entry.path
    const headInfo = entry.xy === "??" ? undefined : headBlobs.get(`HEAD:${beforeRel}`)
    const before = headInfo?.sha256 ?? null
    if (headInfo?.text !== undefined) {
      headContents.set(entry.path, headInfo.text)
    }

    const disk = entry.xy.includes("D")
      ? { sha256: null, mtime: 0, text: undefined, lines: 0 }
      : readDiskFile(path.join(top, entry.path))
    const after = disk.sha256
    if (disk.text !== undefined) {
      diskContents.set(entry.path, disk.text)
    }

    const stat = numstat.get(entry.path)
    let adds = stat?.adds ?? 0
    let dels = stat?.dels ?? 0
    if (entry.xy === "??" && after) {
      adds = disk.lines
    }
    if (entry.xy.includes("D") && headInfo) {
      dels = headInfo.lines
    }
    files.push({
      path: entry.path,
      op: opFromStatus(entry.xy, entry.origPath),
      before,
      after,
      adds,
      dels,
      mtime: disk.mtime,
    })
    baseline.set(entry.path, before)
    mtimes.set(entry.path, disk.mtime)
  }

  return {
    ok: true,
    root: top,
    branch,
    base,
    headCommitMs,
    state: files.length > 0 ? "dirty" : "committed",
    files,
    worktrees: readWorktrees(top, files.length),
    history: readHistory(top),
    baseline,
    mtimes,
    headContents,
    diskContents,
  }
}

function parseNameStatusZ(text: string): Array<{ path: string; origPath: string | null; op: Op }> {
  const out: Array<{ path: string; origPath: string | null; op: Op }> = []
  const tokens = text.split("\0")
  for (let i = 0; i < tokens.length; i++) {
    const code = (tokens[i] ?? "").trim()
    if (!code) continue
    if (code.startsWith("R") || code.startsWith("C")) {
      const origPath = tokens[++i] ?? ""
      const next = tokens[++i] ?? ""
      if (next) out.push({ path: next, origPath: origPath || null, op: "rename" })
      continue
    }
    const rel = tokens[++i] ?? ""
    if (!rel) continue
    const op: Op = code.startsWith("A") ? "add" : code.startsWith("D") ? "delete" : "modify"
    out.push({ path: rel, origPath: null, op })
  }
  return out
}

export function readCommitSnapshot(rootArg: string, commit: string): CommitSnapshot {
  const root = path.resolve(rootArg)
  const empty: CommitSnapshot = {
    ok: false,
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
    headContents: new Map(),
    diskContents: new Map(),
  }
  if (!isSafeCommitRef(commit)) {
    return { ...empty, error: `invalid commit ref: ${commit}` }
  }
  const topRes = runGit(root, ["rev-parse", "--show-toplevel"])
  if (!topRes.ok) {
    return { ...empty, error: `not a git worktree: ${root}` }
  }
  const top = topRes.stdout.toString("utf8").trim()
  const verify = runGit(top, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`])
  if (!verify.ok) {
    return { ...empty, root: top, error: `unknown commit: ${commit}` }
  }
  const resolved = verify.stdout.toString("utf8").trim() || commit
  const meta = runGitText(top, ["show", "--no-patch", "--format=%H%x00%s%x00%ct", resolved]).trim()
  const [, subject, ts] = meta.split("\0")
  const parent = runGitText(top, ["rev-parse", "--verify", "--quiet", `${resolved}^`]).trim()
  const nameStatus = runGitText(top, ["diff-tree", "--no-commit-id", "--name-status", "-r", "-z", "--root", resolved])
  const numstat = numstatMap(top, ["show", "--numstat", "--format=", resolved])
  const files: GitFile[] = []
  const commitFiles = new Map<string, string | null>()
  const baseline = new Map<string, string | null>()
  const mtimes = new Map<string, number>()
  const headContents = new Map<string, string>()
  const diskContents = new Map<string, string>()

  const parsedEntries = parseNameStatusZ(nameStatus)
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
  const specs: string[] = []
  for (const entry of parsedEntries) {
    const beforeSpec = entry.origPath
      ? `${parent || emptyTree}:${entry.origPath}`
      : parent
        ? `${parent}:${entry.path}`
        : ""
    if (beforeSpec) specs.push(beforeSpec)
    if (entry.op !== "delete") specs.push(`${resolved}:${entry.path}`)
  }
  const blobs = batchReadBlobs(top, specs)

  for (const entry of parsedEntries) {
    const beforeSpec = entry.origPath
      ? `${parent || emptyTree}:${entry.origPath}`
      : parent
        ? `${parent}:${entry.path}`
        : ""
    const beforeInfo = beforeSpec ? blobs.get(beforeSpec) : undefined
    const afterInfo = entry.op === "delete" ? undefined : blobs.get(`${resolved}:${entry.path}`)
    const before = beforeInfo?.sha256 ?? null
    const after = afterInfo?.sha256 ?? null
    if (beforeInfo?.text !== undefined) headContents.set(entry.path, beforeInfo.text)
    if (afterInfo?.text !== undefined) diskContents.set(entry.path, afterInfo.text)

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
    t: (Number.parseInt(ts ?? "0", 10) || 0) * 1000,
    files,
    commitFiles,
    baseline,
    mtimes,
    history: readHistory(top),
    headContents,
    diskContents,
  }
}
