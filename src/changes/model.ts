/**
 * Change-set trace model.
 *
 * The unit is a change set, not a commit. A commit seals a change; it does not
 * define it. Everything here is pure: the git adapter and the ledger adapter
 * feed it real hashes, and the renderers emit the three disclosure levels.
 */

import { createHash } from "node:crypto"

export type Kind =
  | "source"
  | "test"
  | "spec"
  | "plan"
  | "ticket"
  | "evidence"
  | "config"
  | "docs"
  | "generated"
  | "vendored"
  | "archive"
  | "secret"
  | "ignore"
  | "unknown"

export type Attribution =
  | "agent"
  | "agent_sealed"
  | "agent_fragment"
  | "agent_shell"
  | "agent_then_changed"
  | "other_session"
  | "owner_or_external"
  | "pre_existing"
  | "unknown"

export type Materiality = "material" | "context" | "noise" | "blocked"
export type Fresh = "fresh" | "stale" | "missing"
export type ChangeState = "dirty" | "committed" | "merged"
export type Op = "add" | "modify" | "delete" | "rename"
export type LedgerScope = "file" | "fragment" | "none"

export interface Proof {
  rule: "commit" | "ledger" | "ledger-fragment" | "shell" | "other-session" | "baseline" | "mtime" | "none"
  current: string | null
  expected: string | null
  equal: boolean
  session?: string
  t?: number
  tool?: string
  command?: string
  baseline?: string | null
  scope?: LedgerScope
}

export interface FileChange {
  path: string
  op: Op
  before: string | null
  after: string | null
  adds?: number
  dels?: number
  worktree: string
  kind: Kind
  attribution: Attribution
  materiality: Materiality
  fresh: Fresh
  proof: Proof
}

export interface WorktreeState {
  root: string
  branch: string
  base: string
  dirty: number
  ahead: number
  behind: number
  mergedInto?: string
}

export interface LedgerEntry {
  session: string
  root: string
  parent?: string
  path: string
  op: Op
  tool: "write" | "edit" | "patch" | "read" | "shell"
  before: string | null
  after: string | null
  scope: LedgerScope
  t: number
  callId?: string
  command?: string
}

export interface ShellWrite {
  t: number
  known: boolean
  after?: string | null
  command: string
}

export interface TicketState {
  id: string
  title: string
  phase: string
  status: string
  acceptance: { passed: number; total: number }
  path: string
  issue?: string
}

export interface EvidenceState {
  command: string
  exit: number
  revision: string
  outcome: string
  blob?: string
}

export interface RelatedSession {
  session: string
  root: string
  reason: "path" | "ticket"
  handle: string
  t: number
}

export interface HistoryEntry {
  commit: string
  subject: string
  worktree: string
  t: number
}

export interface Actor {
  session: string
  parent?: string
  depth: number
  role: string
  harness: string
  model: string
  worktree: string
}

export interface Artifact {
  kind: Kind
  path: string
  sha: string
  owner: string
  fresh: Fresh
}

export interface Counts {
  files: number
  material: number
  context: number
  noise: number
  blocked: number
  byKind: Partial<Record<Kind, number>>
  byAttribution: Partial<Record<Attribution, number>>
}

export interface Change {
  id: string
  state: ChangeState
  worktree: string
  branch: string
  base: string
  commit?: string
  sealedFrom?: string
  session: string
  root: string
  t: number
  summary: string
  counts: Counts
  files: FileChange[]
  preExisting: string[]
  worktrees: WorktreeState[]
  actors: Actor[]
  tickets: TicketState[]
  artifacts: Artifact[]
  evidence: EvidenceState[]
  related: RelatedSession[]
  history: HistoryEntry[]
}

export interface RawChange {
  path: string
  op: Op
  before: string | null
  after: string | null
  adds?: number
  dels?: number
}

export interface BuildInput {
  worktree: string
  branch: string
  base: string
  state: ChangeState
  commit?: string
  sealedFrom?: string
  session: string
  root: string
  t: number
  changes: RawChange[]
  baseline: Map<string, string | null>
  runLedger: LedgerEntry[]
  otherLedger: LedgerEntry[]
  shellWrites?: Map<string, ShellWrite>
  runStart: number
  mtimes?: Map<string, number>
  commitFiles?: Map<string, string | null>
  tickets?: TicketState[]
  evidence?: EvidenceState[]
  related?: RelatedSession[]
  worktrees?: WorktreeState[]
  actors?: Actor[]
  history?: HistoryEntry[]
  preExisting?: string[]
  focus?: string[]
}

export interface BranchView {
  name: string
  count: number
  top: unknown[]
  handle: string
}

export interface PackageView {
  change: {
    id: string
    state: ChangeState
    worktree: string
    branch: string
    base: string
    commit?: string
    sealedFrom?: string
    session: string
    root: string
    t: number
    summary: string
  }
  counts: Counts
  branches: BranchView[]
}

export function fullHash(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex")
}

export function shortHash(hex: string, length = 12): string {
  return hex.slice(0, length)
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function globToRegExp(glob: string): RegExp {
  let out = "^"
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*"
        i++
        if (glob[i + 1] === "/") {
          out += "/?"
          i++
        }
      } else {
        out += "[^/]*"
      }
    } else if (c === "?") {
      out += "[^/]"
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(out + "$")
}

const RULES: Array<{ kind: Kind; globs: string[] }> = [
  {
    kind: "secret",
    globs: ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/credentials*", "**/*.p12"],
  },
  {
    kind: "ignore",
    globs: [".git/**", "**/.git/**", ".cache/**", "**/.cache/**", "tmp/**", "**/tmp/**", "**/*.log", "**/.DS_Store"],
  },
  {
    kind: "archive",
    globs: [
      ".session-archive/**",
      "**/.session-archive/**",
      ".opencode/compaction-history/**",
      "**/.opencode/compaction-history/**",
    ],
  },
  {
    kind: "generated",
    globs: ["dist/**", "**/dist/**", ".local-builds/**", "**/.local-builds/**", "coverage/**", "**/coverage/**", "**/*.snap"],
  },
  {
    kind: "vendored",
    globs: ["node_modules/**", "**/node_modules/**", "vendor/**", "**/vendor/**", "third_party/**", "**/third_party/**"],
  },
  {
    kind: "test",
    globs: ["test/**", "tests/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
  },
  {
    kind: "spec",
    globs: [
      ".planning/**/SPEC.md",
      "**/SPEC.md",
      "PROJECT.md",
      "ROADMAP.md",
      "GLOSSARY.md",
      ".planning/architecture/ADR-*",
      "**/ADR-*.md",
    ],
  },
  {
    kind: "plan",
    globs: [
      ".planning/**/PLAN.md",
      "**/PLAN.md",
      ".planning/**/STATE.md",
      "**/STATE.md",
      ".planning/decisions.tsv",
      "**/decisions.tsv",
      "decisions.tsv",
    ],
  },
  { kind: "ticket", globs: [".planning/**/tickets/**", "**/tickets/**"] },
  {
    kind: "evidence",
    globs: [".audit/**", "**/.audit/**", "**/UAT.md", "**/*receipt*", "**/*verification*"],
  },
  {
    kind: "config",
    globs: [
      "package.json",
      "tsconfig*.json",
      "**/tsconfig*.json",
      "bunfig.toml",
      "**/*.config.*",
      ".github/**",
      "**/Dockerfile",
      "**/*.lock",
      ".gitignore",
      "**/.gitignore",
      ".gitattributes",
      "**/.gitattributes",
      ".editorconfig",
      "**/.editorconfig",
      ".npmrc",
      "**/.npmrc",
      ".nvmrc",
      ".prettierrc",
      "**/.prettierrc",
      ".prettierignore",
      ".eslintrc*",
      "biome.json",
      "**/biome.json",
      "opencode.json",
      "**/opencode.json",
      "opencode.jsonc",
      "**/opencode.jsonc",
      "**/Cargo.toml",
      "**/go.mod",
      "**/pyproject.toml",
      "**/requirements*.txt",
      "Makefile",
      "justfile",
    ],
  },
  { kind: "docs", globs: ["README.md", "docs/**", "**/AGENTS.md", "**/*.md"] },
  {
    kind: "source",
    globs: [
      "src/**",
      "packages/*/src/**",
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.mjs",
      "**/*.py",
      "**/*.go",
      "**/*.rs",
    ],
  },
]

const REGEX_CACHE = new Map<string, RegExp>()

function matches(glob: string, path: string): boolean {
  let re = REGEX_CACHE.get(glob)
  if (!re) {
    re = globToRegExp(glob)
    REGEX_CACHE.set(glob, re)
  }
  return re.test(path)
}

export function classify(path: string): Kind {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "")
  for (const rule of RULES) {
    for (const glob of rule.globs) {
      if (matches(glob, normalized)) return rule.kind
    }
  }
  return "unknown"
}

export function materiality(kind: Kind, attribution: Attribution, focus: boolean): Materiality {
  if (kind === "secret") return "blocked"
  if (kind === "ignore" || kind === "archive" || kind === "generated" || kind === "vendored") {
    return "noise"
  }
  if (attribution === "pre_existing" || attribution === "other_session" || attribution === "unknown") {
    return "context"
  }
  if (attribution === "owner_or_external") return "context"
  if (kind === "docs" && !focus) return "context"
  if (kind === "config" && !focus) return "context"
  return "material"
}

export interface AttributeInput {
  path: string
  current: string | null
  baseline: Map<string, string | null>
  runLedger: LedgerEntry[]
  otherLedger: LedgerEntry[]
  shellWrites: Map<string, ShellWrite>
  runStart: number
  mtime: number
  commitFiles?: Map<string, string | null>
}

export interface AttributeResult {
  attribution: Attribution
  fresh: Fresh
  proof: Proof
}

export function attribute(input: AttributeInput): AttributeResult {
  const { path, current, baseline, runLedger, otherLedger, shellWrites, runStart, mtime, commitFiles } = input

  if (commitFiles?.has(path)) {
    const expected = commitFiles.get(path) ?? null
    return {
      attribution: "agent_sealed",
      fresh: expected === current ? "fresh" : "stale",
      proof: { rule: "commit", current, expected, equal: expected === current },
    }
  }

  // Ledger order is chronological and is the tie-break for tool calls that
  // share the same message timestamp. Do not sort by `t` alone: several tool
  // parts in one assistant message can have the same millisecond.
  const rows = runLedger.filter((e) => e.path === path && e.scope !== "none")
  const latest = rows[rows.length - 1]
  let exactIndex = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].scope === "file") {
      exactIndex = i
      break
    }
  }
  const exact = exactIndex >= 0 ? rows[exactIndex] : undefined
  if (exact) {
    if (latest && latest.scope === "fragment" && rows.length - 1 > exactIndex) {
      return {
        attribution: "agent_then_changed",
        fresh: "stale",
        proof: {
          rule: "ledger-fragment",
          current,
          expected: exact.after,
          equal: exact.after === current,
          session: latest.session,
          t: latest.t,
          tool: latest.tool,
          scope: "fragment",
        },
      }
    }
    return {
      attribution: exact.after === current ? "agent" : "agent_then_changed",
      fresh: exact.after === current ? "fresh" : "stale",
      proof: {
        rule: "ledger",
        current,
        expected: exact.after,
        equal: exact.after === current,
        session: exact.session,
        t: exact.t,
        tool: exact.tool,
        scope: "file",
      },
    }
  }
  if (latest) {
    return {
      attribution: "unknown",
      fresh: "stale",
      proof: {
        rule: "ledger-fragment",
        current,
        expected: null,
        equal: false,
        session: latest.session,
        t: latest.t,
        tool: latest.tool,
        scope: "fragment",
      },
    }
  }

  const shell = shellWrites.get(path)
  if (shell && shell.t >= runStart) {
    if (!shell.known) {
      return {
        attribution: "unknown",
        fresh: "stale",
        proof: { rule: "shell", current, expected: null, equal: false, command: shell.command, t: shell.t },
      }
    }
    const expected = shell.after ?? null
    return {
      attribution: "agent_shell",
      fresh: expected === current ? "fresh" : "stale",
      proof: { rule: "shell", current, expected, equal: expected === current, command: shell.command, t: shell.t },
    }
  }

  const other = otherLedger.find((e) => e.path === path)
  if (other) {
    return {
      attribution: "other_session",
      fresh: other.after === current ? "fresh" : "stale",
      proof: {
        rule: "other-session",
        current,
        expected: other.after,
        equal: other.after === current,
        session: other.session,
        t: other.t,
      },
    }
  }

  if (baseline.has(path)) {
    const expected = baseline.get(path) ?? null
    if (expected === current) {
      return {
        attribution: "pre_existing",
        fresh: "fresh",
        proof: { rule: "baseline", current, expected, equal: true, baseline: expected },
      }
    }
    return {
      attribution: "owner_or_external",
      fresh: "stale",
      proof: { rule: "baseline", current, expected, equal: false, baseline: expected },
    }
  }

  if (mtime >= runStart) {
    return {
      attribution: "owner_or_external",
      fresh: "stale",
      proof: { rule: "mtime", current, expected: null, equal: false, t: mtime },
    }
  }

  return {
    attribution: "unknown",
    fresh: "stale",
    proof: { rule: "none", current, expected: null, equal: false, t: mtime },
  }
}

export function changeId(worktree: string, base: string, files: RawChange[]): string {
  // Noise must not participate in identity: persisting the archive itself, a
  // build output or a vendored dependency must never churn the change id.
  const identity = files.filter((f) => {
    const kind = classify(f.path)
    return kind !== "archive" && kind !== "generated" && kind !== "vendored" && kind !== "ignore"
  })
  const payload = [
    worktree,
    base,
    ...identity.map((f) => `${f.path}\u0000${f.after ?? "∅"}`).sort(),
  ].join("\n")
  return shortHash(fullHash(payload))
}

function countBy<T extends string>(items: T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {}
  for (const item of items) out[item] = (out[item] ?? 0) + 1
  return out
}

export function buildChange(input: BuildInput): Change {
  const focus = new Set(input.focus ?? [])
  const shellWrites = input.shellWrites ?? new Map<string, ShellWrite>()
  const mtimes = input.mtimes ?? new Map<string, number>()

  const files: FileChange[] = input.changes.map((raw) => {
    const kind = classify(raw.path)
    const result = attribute({
      path: raw.path,
      current: raw.after,
      baseline: input.baseline,
      runLedger: input.runLedger,
      otherLedger: input.otherLedger,
      shellWrites,
      runStart: input.runStart,
      mtime: mtimes.get(raw.path) ?? 0,
      commitFiles: input.commitFiles,
    })
    return {
      ...raw,
      worktree: input.worktree,
      kind,
      attribution: result.attribution,
      materiality: materiality(kind, result.attribution, focus.has(raw.path)),
      fresh: result.fresh,
      proof: result.proof,
    }
  })

  // The kill condition: every dirty path is in the change. The renderer may
  // bound the visible list, but the model never drops a path.
  const seen = new Set(files.map((f) => f.path))
  for (const path of input.changes.map((c) => c.path)) {
    if (!seen.has(path)) throw new Error(`change-set: path dropped from model: ${path}`)
  }

  const counts: Counts = {
    files: files.length,
    material: files.filter((f) => f.materiality === "material").length,
    context: files.filter((f) => f.materiality === "context").length,
    noise: files.filter((f) => f.materiality === "noise").length,
    blocked: files.filter((f) => f.materiality === "blocked").length,
    byKind: countBy(files.map((f) => f.kind)),
    byAttribution: countBy(files.map((f) => f.attribution)),
  }

  const id =
    input.state === "committed" && input.commit
      ? input.commit.slice(0, 12)
      : changeId(input.worktree, input.base, input.changes)

  const artifacts: Artifact[] = files
    .filter(
      (f) =>
        (f.kind === "spec" || f.kind === "plan" || f.kind === "ticket" || f.kind === "evidence") &&
        f.materiality !== "noise" &&
        f.materiality !== "blocked",
    )
    .map((f) => ({
      kind: f.kind,
      path: f.path,
      sha: f.after ?? "deleted",
      owner: input.session,
      fresh: f.fresh,
    }))

  const summary = `${files.length} files: ${counts.material} material, ${counts.context} context, ${counts.noise} noise, ${counts.blocked} blocked`

  return {
    id,
    state: input.state,
    worktree: input.worktree,
    branch: input.branch,
    base: input.base,
    commit: input.commit,
    sealedFrom: input.sealedFrom,
    session: input.session,
    root: input.root,
    t: input.t,
    summary,
    counts,
    files,
    preExisting: input.preExisting ?? [],
    worktrees: input.worktrees ?? [],
    actors: input.actors ?? [],
    tickets: input.tickets ?? [],
    artifacts,
    evidence: input.evidence ?? [],
    related: input.related ?? [],
    history: input.history ?? [],
  }
}

export function shouldPush(change: Change): boolean {
  return change.counts.material > 0 || (change.counts.byAttribution.agent_then_changed ?? 0) > 0
}

export function renderSignal(change: Change): string | null {
  if (!shouldPush(change)) return null
  const kinds: Kind[] = ["source", "test", "spec", "plan", "ticket", "evidence", "config", "docs"]
  const parts = kinds
    .filter((k) => (change.counts.byKind[k] ?? 0) > 0)
    .map((k) => `${change.counts.byKind[k]} ${k}`)

  const owner =
    (change.counts.byAttribution.owner_or_external ?? 0) +
    (change.counts.byAttribution.agent_then_changed ?? 0)
  const extras: string[] = []
  const agent =
    (change.counts.byAttribution.agent ?? 0) +
    (change.counts.byAttribution.agent_sealed ?? 0) +
    (change.counts.byAttribution.agent_shell ?? 0) +
    (change.counts.byAttribution.agent_fragment ?? 0)
  if (agent > 0) extras.push(`${agent} agent`)
  if (owner > 0) extras.push(`${owner} owner-touched`)
  const unknown = change.counts.byAttribution.unknown ?? 0
  if (unknown > 0) extras.push(`${unknown} unknown`)
  if (change.counts.noise > 0) extras.push(`${change.counts.noise} generated ignored`)
  if (change.counts.blocked > 0) extras.push(`${change.counts.blocked} secret blocked`)
  if (change.related.length > 0) extras.push(`${change.related.length} related`)

  const head = change.state === "committed" ? `commit ${change.id}` : `${change.state} ${change.id}`
  const call =
    change.state === "committed" && change.commit
      ? `trace({commit:"${change.commit.slice(0, 12)}"})`
      : `trace({change:"${change.id}"})`
  return `[substrate] ${head} (${change.worktree}): ${parts.join(", ")}${
    extras.length > 0 ? "; " + extras.join(", ") : ""
  }. ${call}`
}

const ATTRIBUTION_RANK: Record<Attribution, number> = {
  agent: 0,
  agent_sealed: 0,
  agent_shell: 1,
  agent_fragment: 2,
  agent_then_changed: 3,
  other_session: 4,
  owner_or_external: 5,
  unknown: 6,
  pre_existing: 7,
}

function topFiles(files: FileChange[]): unknown[] {
  return [...files]
    .sort((a, b) => ATTRIBUTION_RANK[a.attribution] - ATTRIBUTION_RANK[b.attribution] || a.path.localeCompare(b.path))
    .slice(0, 3)
    .map((f) => ({
      path: f.path,
      op: f.op,
      attribution: f.attribution,
      fresh: f.fresh,
      adds: f.adds,
      dels: f.dels,
    }))
}

export function renderPackage(change: Change): PackageView {
  const branches: BranchView[] = []

  for (const kind of ["source", "test", "spec", "plan", "ticket", "evidence", "config", "docs"] as Kind[]) {
    const files = change.files.filter(
      (f) => f.kind === kind && f.materiality !== "noise" && f.materiality !== "blocked",
    )
    if (files.length === 0) continue
    branches.push({
      name: kind,
      count: files.length,
      top: topFiles(files),
      handle: `${change.id}:${kind}`,
    })
  }

  // Safety net: a path the classifier does not recognize must still appear in
  // the tree. Missing a file from every branch is the kill condition.
  const unknownFiles = change.files.filter(
    (f) => f.kind === "unknown" && f.materiality !== "noise" && f.materiality !== "blocked",
  )
  if (unknownFiles.length > 0) {
    branches.push({
      name: "unknown",
      count: unknownFiles.length,
      top: topFiles(unknownFiles),
      handle: `${change.id}:unknown`,
    })
  }

  const ownerFiles = change.files.filter(
    (f) =>
      (f.attribution === "owner_or_external" || f.attribution === "agent_then_changed") &&
      f.materiality !== "noise" &&
      f.materiality !== "blocked",
  )
  if (ownerFiles.length > 0) {
    branches.push({
      name: "owner",
      count: ownerFiles.length,
      top: topFiles(ownerFiles),
      handle: `${change.id}:owner`,
    })
  }

  const noiseFiles = change.files.filter((f) => f.materiality === "noise")
  if (noiseFiles.length > 0) {
    const groups = Object.entries(countBy(noiseFiles.map((f) => f.kind))).map(([kind, count]) => ({
      kind,
      count,
      sample: noiseFiles.find((f) => f.kind === kind)?.path,
    }))
    branches.push({
      name: "noise",
      count: noiseFiles.length,
      top: groups.slice(0, 3),
      handle: `${change.id}:noise`,
    })
  }

  const blockedFiles = change.files.filter((f) => f.materiality === "blocked")
  if (blockedFiles.length > 0) {
    branches.push({
      name: "blocked",
      count: blockedFiles.length,
      top: blockedFiles.slice(0, 3).map((f) => ({ path: f.path, blocked: true })),
      handle: `${change.id}:blocked`,
    })
  }

  if (change.preExisting.length > 0) {
    branches.push({
      name: "pre-existing",
      count: change.preExisting.length,
      top: change.preExisting.slice(0, 5),
      handle: `${change.id}:pre-existing`,
    })
  }

  if (change.worktrees.length > 0) {
    branches.push({
      name: "worktrees",
      count: change.worktrees.length,
      top: change.worktrees.slice(0, 5),
      handle: `${change.id}:worktrees`,
    })
  }
  if (change.actors.length > 0) {
    branches.push({
      name: "actors",
      count: change.actors.length,
      top: change.actors.slice(0, 5),
      handle: `${change.id}:actors`,
    })
  }
  if (change.tickets.length > 0) {
    branches.push({
      name: "tickets",
      count: change.tickets.length,
      top: change.tickets.slice(0, 5),
      handle: `${change.id}:tickets`,
    })
  }
  if (change.related.length > 0) {
    branches.push({
      name: "related",
      count: change.related.length,
      top: change.related.slice(0, 5),
      handle: `${change.id}:related`,
    })
  }
  if (change.evidence.length > 0) {
    branches.push({
      name: "evidence",
      count: change.evidence.length,
      top: change.evidence.slice(0, 5),
      handle: `${change.id}:evidence`,
    })
  }
  if (change.history.length > 0) {
    branches.push({
      name: "history",
      count: change.history.length,
      top: change.history.slice(0, 5),
      handle: `${change.id}:history`,
    })
  }

  return {
    change: {
      id: change.id,
      state: change.state,
      worktree: change.worktree,
      branch: change.branch,
      base: change.base,
      commit: change.commit,
      sealedFrom: change.sealedFrom,
      session: change.session,
      root: change.root,
      t: change.t,
      summary: change.summary,
    },
    counts: change.counts,
    branches,
  }
}

const FILE_KINDS = new Set<Kind>(["source", "test", "spec", "plan", "ticket", "evidence", "config", "docs"])

function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function formatPackage(pkg: PackageView): string {
  const c = pkg.counts
  const extras = [
    `${c.material} material`,
    `${c.context} context`,
    c.noise > 0 ? `${c.noise} noise` : null,
    c.blocked > 0 ? `${c.blocked} blocked` : null,
  ].filter(Boolean)
  const lines = [
    `change ${pkg.change.id} ${pkg.change.state} ${baseName(pkg.change.worktree)} — ${c.files} files (${extras.join(", ")})`,
  ]
  for (const branch of pkg.branches) {
    const topN = FILE_KINDS.has(branch.name as Kind) || branch.name === "owner" ? 2 : 3
    const items = branch.top.slice(0, topN).map((v) => short(v))
    lines.push(
      `  ${branch.name.padEnd(11)} ${String(branch.count).padStart(2)}  ${items.join(" · ")}  [${branch.handle}]`,
    )
  }
  return lines.join("\n")
}

export function short(value: unknown): string {
  if (typeof value !== "object" || value === null) return clamp(String(value), 64)
  const o = value as Record<string, unknown>
  if ("path" in o) {
    const p = clamp(String(o.path), 62)
    if (o.blocked) return `${p} (blocked)`
    const op = o.op === "add" ? "A" : o.op === "delete" ? "D" : o.op === "rename" ? "R" : o.op ? "M" : ""
    const attr = String(o.attribution ?? "")
    const suffix =
      attr === "" || attr === "agent"
        ? ""
        : attr === "agent_sealed"
          ? " sealed"
          : attr === "owner_or_external"
            ? " owner"
            : attr === "other_session"
              ? " other"
              : attr === "unknown"
                ? " unknown"
                : attr === "agent_then_changed"
                  ? " stale"
                  : attr === "agent_shell"
                    ? " shell"
                    : attr === "agent_fragment"
                      ? " fragment"
                      : ` ${attr}`
    return `${op ? `${op} ` : ""}${p}${suffix}`.trim()
  }
  if ("id" in o && "status" in o) {
    const acceptance = o.acceptance as { passed?: number; total?: number } | undefined
    return clamp(`${o.id}:${o.status}${acceptance ? ` ${acceptance.passed}/${acceptance.total}` : ""}`, 52)
  }
  if ("session" in o) {
    const role = o.role ?? o.reason
    return clamp(`${o.session}${role ? `(${role})` : ""}`, 46)
  }
  if ("root" in o) return clamp(`${baseName(String(o.root))}@${o.branch ?? ""}`, 46)
  if ("commit" in o) return clamp(`${o.commit} ${o.subject ?? ""}`, 48)
  if ("kind" in o) return `${o.kind}×${o.count}`
  if ("command" in o) return clamp(`${o.command} exit ${o.exit ?? "?"}`, 48)
  return clamp(JSON.stringify(o), 48)
}

export function leaf(change: Change, branch: string, path?: string): unknown {
  if (branch === "blocked") {
    const files = change.files.filter((f) => f.materiality === "blocked")
    return files.filter((f) => !path || f.path === path).map((f) => ({ path: f.path, blocked: true }))
  }
  if (branch === "noise") {
    const files = change.files.filter((f) => f.materiality === "noise")
    return files
      .filter((f) => !path || f.path === path)
      .map((f) => ({ path: f.path, kind: f.kind, attribution: f.attribution }))
  }
  if (branch === "pre-existing") return change.preExisting
  if (branch === "worktrees") return change.worktrees
  if (branch === "actors") return change.actors
  if (branch === "tickets") return change.tickets
  if (branch === "related") return change.related
  if (branch === "evidence") return change.evidence
  if (branch === "history") return change.history

  const files = change.files.filter((f) => {
    if (branch === "owner") {
      return f.attribution === "owner_or_external" || f.attribution === "agent_then_changed"
    }
    return f.kind === branch
  })
  const found = path ? files.find((f) => f.path === path) : undefined
  if (path && !found) return { error: "not found", branch, path }
  if (found) return { branch, file: found }
  return { branch, files }
}

export function resolveHandle(change: Change, handle: string | undefined, branch?: string, path?: string): unknown {
  if (!handle) return leaf(change, branch ?? "source", path)
  const idx = handle.indexOf(":")
  if (idx === -1) return leaf(change, handle, path)
  const id = handle.slice(0, idx)
  const rest = handle.slice(idx + 1)
  if (id !== change.id) return { error: "stale-handle", expected: change.id, got: id }
  return leaf(change, rest, path)
}
