/**
 * Change-set trace orchestrator (Iteration 2 — Seeded Proof, Real Evidence & Diff Leaf).
 *
 * One live computation, three disclosure levels:
 *   signal  — one short injection naming the exact trace call
 *   package — bounded branch tree with handles
 *   leaf    — one branch/path/actor/evidence, full proof + bounded diff
 */

import path from "node:path"
import {
  type Change,
  type PackageView,
  buildChange,
  formatPackage,
  renderPackage,
  renderSignal,
  resolveHandle,
} from "./model.ts"
import {
  type CommitSnapshot,
  type GitSnapshot,
  readCommitSnapshot,
  readFileDiffExcerpt,
  readGitSnapshot,
} from "./git.ts"
import { readOtherTouches, readRelatedFromArchive } from "./store.ts"
import { type HostLedger, readHostLedger } from "./host-ledger.ts"

export interface TraceInput {
  readonly root: string
  readonly hostDbPath: string
  readonly sessionID?: string
  readonly commit?: string
  readonly archiveDbPath?: string
}

export interface TraceCoverage {
  files: number
  actors: number
  sessions: number
  missingFiles: string[]
  missingActors: string[]
}

export interface TraceResult {
  mode: "dirty" | "committed"
  root: string
  change: Change
  signal: string | null
  packageView: PackageView
  packageMarkdown: string
  coverage: TraceCoverage
  ledger: HostLedger
  notes: string[]
}

function relatedFor(
  archiveDbPath: string,
  snapshot: GitSnapshot | CommitSnapshot,
  ledger: HostLedger,
): ReturnType<typeof readRelatedFromArchive> {
  const paths = snapshot.files.map((f) => f.path)
  const excludeSessions = ledger.sessions.length > 0 ? ledger.sessions.map((s) => s.id) : [ledger.rootSession]
  return readRelatedFromArchive(archiveDbPath, paths, excludeSessions)
}

function assertCoverage(change: Change, ledger: HostLedger, paths: readonly string[]): TraceCoverage {
  const fileSet = new Set(change.files.map((f) => f.path))
  const missingFiles = paths.filter((p) => !fileSet.has(p))
  const actorSet = new Set(change.actors.map((a) => a.session))
  const missingActors = ledger.sessions.map((s) => s.id).filter((id) => !actorSet.has(id))
  if (missingFiles.length > 0 || missingActors.length > 0) {
    throw new Error(
      `trace coverage failed: files=[${missingFiles.join(", ")}] actors=[${missingActors.join(", ")}]`,
    )
  }
  return {
    files: change.files.length,
    actors: change.actors.length,
    sessions: ledger.sessions.length,
    missingFiles,
    missingActors,
  }
}

export function buildTrace(input: TraceInput): TraceResult {
  const root = path.resolve(input.root)
  const archiveDbPath = input.archiveDbPath ?? path.join(root, ".session-archive", "index.sqlite")
  const isCommitted = Boolean(input.commit)
  const snapshot = isCommitted ? readCommitSnapshot(root, input.commit!) : readGitSnapshot(root)
  if (!snapshot.ok) {
    throw new Error(snapshot.error ?? (isCommitted ? `cannot read commit ${input.commit}` : `cannot inspect worktree ${root}`))
  }

  const ledger = readHostLedger(
    input.hostDbPath,
    root,
    input.sessionID,
    snapshot.headContents,
    snapshot.diskContents,
  )
  const notes: string[] = []
  if (!ledger.ok && ledger.error) notes.push(`ledger: ${ledger.error}`)

  const runStart = isCommitted ? (snapshot as CommitSnapshot).t || 0 : ledger.runStart || 0
  const headCommitMs = isCommitted ? (snapshot as CommitSnapshot).t || 0 : (snapshot as GitSnapshot).headCommitMs || 0
  const minOtherTime = Math.max(runStart, headCommitMs)
  const otherLedger = readOtherTouches(
    archiveDbPath,
    snapshot.files.map((f) => f.path),
    ledger.sessions.map((s) => s.id),
    minOtherTime,
  )

  const change = buildChange({
    worktree: snapshot.root,
    branch: snapshot.branch,
    base: snapshot.base,
    state: isCommitted ? "committed" : "dirty",
    commit: isCommitted ? (snapshot as CommitSnapshot).commit : undefined,
    sealedFrom: isCommitted ? snapshot.base : undefined,
    session: ledger.sessionID || input.sessionID || "unknown",
    root: ledger.rootSession || input.sessionID || "unknown",
    t: isCommitted ? (snapshot as CommitSnapshot).t || Date.now() : Date.now(),
    changes: snapshot.files,
    baseline: snapshot.baseline,
    runLedger: ledger.entries,
    otherLedger,
    shellWrites: ledger.shellWrites,
    runStart,
    headCommitMs,
    mtimes: snapshot.mtimes,
    commitFiles: isCommitted ? (snapshot as CommitSnapshot).commitFiles : undefined,
    diskContents: snapshot.diskContents,
    evidence: isCommitted
      ? ledger.evidence.map((ev) => ({ ...ev, revision: (snapshot as CommitSnapshot).commit.slice(0, 12) }))
      : ledger.evidence,
    related: relatedFor(archiveDbPath, snapshot, ledger),
    worktrees: isCommitted ? [] : (snapshot as GitSnapshot).worktrees,
    actors: ledger.actors,
    history: snapshot.history,
  })
  change.preExisting = change.files.filter((f) => f.attribution === "pre_existing").map((f) => f.path)
  const activeFragments = change.files.filter((f) => f.proof.rule === "ledger-fragment" && !f.proof.equal).length
  if (activeFragments > 0) notes.push(`${activeFragments} edit fragment(s) not promotable to full-file proof`)
  if (ledger.skippedOutsideRoot > 0) notes.push(`${ledger.skippedOutsideRoot} tool write(s) outside this worktree`)
  const packageView = renderPackage(change)
  const coverage = assertCoverage(change, ledger, snapshot.files.map((f) => f.path))
  return {
    mode: isCommitted ? "committed" : "dirty",
    root: snapshot.root,
    change,
    signal: renderSignal(change),
    packageView,
    packageMarkdown: formatPackage(packageView),
    coverage,
    ledger: { ...ledger, fragments: activeFragments },
    notes,
  }
}

export function renderTracePackage(result: TraceResult, requestedID?: string): string {
  const requested =
    requestedID && requestedID !== result.change.id
      ? `\nrequested ${requestedID}; live ${result.change.id} (working tree changed since the signal)`
      : ""
  const first = result.packageView.branches[0]?.handle
  const leafHint = first
    ? `\nleaf: substrate.viewport({ action:"trace", handle:"${first}" })`
    : ""
  const notes = result.notes.length > 0 ? `\nnotes: ${result.notes.join("; ")}` : ""
  return `${result.packageMarkdown}${requested}${leafHint}${notes}`
}

export function renderTraceLeaf(
  result: TraceResult,
  handle?: string,
  branch?: string,
  filePath?: string,
  maxTokens?: number,
): string {
  const value = resolveHandle(result.change, handle, branch, filePath)
  if (
    value &&
    typeof value === "object" &&
    "file" in (value as Record<string, unknown>) &&
    (value as { file?: { path?: string; diffExcerpt?: string; blocked?: boolean; materiality?: string } }).file?.path
  ) {
    const fileObj = (value as {
      file: { path: string; diffExcerpt?: string; blocked?: boolean; materiality?: string }
    }).file
    if (!fileObj.blocked && fileObj.materiality !== "blocked" && fileObj.diffExcerpt === undefined) {
      const diff = readFileDiffExcerpt(result.root, fileObj.path, result.change.commit)
      if (diff) fileObj.diffExcerpt = diff
    }
  }
  const text = JSON.stringify(value, null, 2)
  const maxChars =
    typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
      ? Math.max(200, Math.floor(maxTokens * 4))
      : 20000
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n… truncated (${text.length} chars; narrow with path or maxTokens)`
}
