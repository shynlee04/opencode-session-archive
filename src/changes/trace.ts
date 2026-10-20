/**
 * Change-set trace orchestrator.
 *
 * One live computation, three disclosure levels:
 *   signal  — one short injection naming the exact trace call
 *   package — bounded branch tree with handles
 *   leaf    — one branch/path, full proof
 */

import path from "node:path"
import { existsSync } from "node:fs"
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
  readGitSnapshot,
  readOtherTouches,
  readRelatedFromArchive,
  readTickets,
  readWorktrees,
} from "./git.ts"
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
  const actorIDs = new Set(ledger.sessions.map((s) => s.id))
  return readRelatedFromArchive(archiveDbPath, paths, ledger.rootSession).filter((r) => !actorIDs.has(r.session))
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
  const ledger = readHostLedger(input.hostDbPath, root, input.sessionID)
  const notes: string[] = []
  if (!ledger.ok && ledger.error) notes.push(`ledger: ${ledger.error}`)
  if (ledger.fragments > 0) notes.push(`${ledger.fragments} edit fragment(s) not promotable to full-file proof`)
  if (ledger.skippedOutsideRoot > 0) notes.push(`${ledger.skippedOutsideRoot} tool write(s) outside this worktree`)

  if (input.commit) {
    const snapshot = readCommitSnapshot(root, input.commit)
    if (!snapshot.ok) throw new Error(snapshot.error ?? `cannot read commit ${input.commit}`)
    const otherLedger = readOtherTouches(
      archiveDbPath,
      snapshot.files.map((f) => f.path),
      ledger.sessions.map((s) => s.id),
    )
    const change = buildChange({
      worktree: snapshot.root,
      branch: snapshot.branch,
      base: snapshot.base,
      state: "committed",
      commit: snapshot.commit,
      sealedFrom: snapshot.base,
      session: ledger.sessionID || input.sessionID || "unknown",
      root: ledger.rootSession || input.sessionID || "unknown",
      t: snapshot.t || Date.now(),
      changes: snapshot.files,
      baseline: snapshot.baseline,
      runLedger: ledger.entries,
      otherLedger,
      shellWrites: ledger.shellWrites,
      runStart: snapshot.t || 0,
      mtimes: snapshot.mtimes,
      commitFiles: snapshot.commitFiles,
      tickets: readTickets(snapshot.root),
      related: relatedFor(archiveDbPath, snapshot, ledger),
      worktrees: readWorktrees(snapshot.root),
      actors: ledger.actors,
      history: snapshot.history,
    })
    change.preExisting = change.files.filter((f) => f.attribution === "pre_existing").map((f) => f.path)
    const packageView = renderPackage(change)
    const coverage = assertCoverage(change, ledger, snapshot.files.map((f) => f.path))
    return {
      mode: "committed",
      root: snapshot.root,
      change,
      signal: renderSignal(change),
      packageView,
      packageMarkdown: formatPackage(packageView),
      coverage,
      ledger,
      notes,
    }
  }

  const snapshot = readGitSnapshot(root)
  if (!snapshot.ok) throw new Error(snapshot.error ?? `cannot inspect worktree ${root}`)
  const otherLedger = readOtherTouches(
    archiveDbPath,
    snapshot.files.map((f) => f.path),
    ledger.sessions.map((s) => s.id),
  )
  const change = buildChange({
    worktree: snapshot.root,
    branch: snapshot.branch,
    base: snapshot.base,
    state: "dirty",
    session: ledger.sessionID || input.sessionID || "unknown",
    root: ledger.rootSession || input.sessionID || "unknown",
    t: Date.now(),
    changes: snapshot.files,
    baseline: snapshot.baseline,
    runLedger: ledger.entries,
    otherLedger,
    shellWrites: ledger.shellWrites,
    runStart: ledger.runStart || Date.now(),
    mtimes: snapshot.mtimes,
    tickets: readTickets(snapshot.root),
    related: relatedFor(archiveDbPath, snapshot, ledger),
    worktrees: snapshot.worktrees,
    actors: ledger.actors,
    history: snapshot.history,
  })
  change.preExisting = change.files.filter((f) => f.attribution === "pre_existing").map((f) => f.path)
  const packageView = renderPackage(change)
  const coverage = assertCoverage(change, ledger, snapshot.files.map((f) => f.path))
  return {
    mode: "dirty",
    root: snapshot.root,
    change,
    signal: renderSignal(change),
    packageView,
    packageMarkdown: formatPackage(packageView),
    coverage,
    ledger,
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
): string {
  const value = resolveHandle(result.change, handle, branch, filePath)
  const text = JSON.stringify(value, null, 2)
  if (text.length <= 20000) return text
  return `${text.slice(0, 20000)}\n… truncated (${text.length} chars; narrow with path)`
}

export function traceExists(root: string): boolean {
  return existsSync(path.join(path.resolve(root), ".session-archive"))
}
