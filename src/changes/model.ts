/**
 * Change-set trace model (Iteration 2 — Project-Agnostic Code/Test/Git/Actor Truth).
 *
 * The unit is a change set, not a commit. A commit seals a change; it does not
 * define it. In the wild, project artifacts and markdown planning docs are
 * uncontrolled context; only git state, executable code, tests, test/command
 * executions, and the host tool/actor ledger are verifiable ground truth.
 */

import { createHash } from "node:crypto"

export type Kind =
  | "source"
  | "test"
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
  diffExcerpt?: string
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
  newSnippet?: string
}

export interface ShellWrite {
  t: number
  known: boolean
  after?: string | null
  command: string
}

export interface EvidenceState {
  command: string
  exit: number
  revision: string
  outcome: "pass" | "fail" | "unknown"
  session?: string
  t?: number
  fresh?: Fresh
  summary?: string
  blob?: string
}

export interface RelatedSession {
  session: string
  root: string
  reason: "path" | "commit"
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
  title?: string
  updatedAt?: number
  filesTouched?: number
  paths?: string[]
  checksRun?: number
  lastCheck?: "pass" | "fail" | "none"
  conclusion?: string
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
  diffExcerpt?: string
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
  headCommitMs?: number
  mtimes?: Map<string, number>
  commitFiles?: Map<string, string | null>
  diskContents?: Map<string, string>
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

/**
 * Project-agnostic classification rules.
 * Only code (`source`), tests (`test`), and build/runtime `config` are primary
 * engineering surfaces. Markdown, `.planning/**`, `.audit/**`, and prose notes
 * are uncontrolled `docs` context in the wild — never assumed to be structured
 * tickets, specs, or verification evidence.
 */
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
    globs: [
      "dist/**",
      "**/dist/**",
      "build/**",
      "**/build/**",
      ".next/**",
      "**/.next/**",
      ".local-builds/**",
      "**/.local-builds/**",
      "coverage/**",
      "**/coverage/**",
      "**/*.snap",
      "**/*.min.js",
      "**/*.bundle.js",
    ],
  },
  {
    kind: "vendored",
    globs: ["node_modules/**", "**/node_modules/**", "vendor/**", "**/vendor/**", "third_party/**", "**/third_party/**"],
  },
  {
    kind: "config",
    globs: [
      "**/requirements*.txt",
      "**/CMakeLists.txt",
    ],
  },
  {
    kind: "docs",
    globs: [
      ".planning/**",
      "**/.planning/**",
      ".audit/**",
      "**/.audit/**",
      "docs/**",
      "**/docs/**",
      "**/*.md",
      "**/*.mdx",
      "**/*.txt",
      "**/*.rst",
      "**/*.adoc",
    ],
  },
  {
    kind: "test",
    globs: [
      "test/**",
      "tests/**",
      "**/__tests__/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/test_*.py",
      "**/*_test.go",
      "**/*_test.rs",
    ],
  },
  {
    kind: "config",
    globs: [
      "package.json",
      "**/package.json",
      "tsconfig*.json",
      "**/tsconfig*.json",
      "bunfig.toml",
      "**/*.config.*",
      ".github/**",
      "**/Dockerfile",
      "**/docker-compose*.yml",
      "**/*.lock",
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      ".gitignore",
      "**/.gitignore",
      ".gitattributes",
      "**/.gitattributes",
      ".editorconfig",
      "**/.editorconfig",
      ".npmrc",
      "**/.npmrc",
      ".nvmrc",
      ".prettierrc*",
      "**/.prettierrc*",
      ".prettierignore",
      ".eslintrc*",
      "biome.json*",
      "**/biome.json*",
      "opencode.json*",
      "**/opencode.json*",
      "**/Cargo.toml",
      "**/go.mod",
      "**/go.sum",
      "**/pyproject.toml",
      "Makefile",
      "justfile",
      "**/*.toml",
      "**/*.yaml",
      "**/*.yml",
    ],
  },
  {
    kind: "source",
    globs: [
      "src/**",
      "lib/**",
      "app/**",
      "pkg/**",
      "cmd/**",
      "bin/**",
      "scripts/**",
      "packages/*/src/**",
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.py",
      "**/*.go",
      "**/*.rs",
      "**/*.java",
      "**/*.kt",
      "**/*.c",
      "**/*.cpp",
      "**/*.h",
      "**/*.hpp",
      "**/*.cs",
      "**/*.rb",
      "**/*.php",
      "**/*.swift",
      "**/*.scala",
      "**/*.sh",
      "**/*.bash",
      "**/*.zsh",
      "**/*.sql",
      "**/*.graphql",
      "**/*.proto",
      "**/*.vue",
      "**/*.svelte",
      "**/*.astro",
      "**/*.css",
      "**/*.scss",
      "**/*.html",
    ],
  },
]

const REGEX_CACHE = new Map<string, RegExp>()

function matches(glob: string, p: string): boolean {
  let re = REGEX_CACHE.get(glob)
  if (!re) {
    re = globToRegExp(glob)
    REGEX_CACHE.set(glob, re)
  }
  return re.test(p)
}

export function classify(p: string): Kind {
  const normalized = p
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^(?:\.worktrees?|worktrees?)\/[^/]+\//, "")
    .replace(/^@[^/]+\//, "")
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
  currentContent?: string
  baseline: Map<string, string | null>
  runLedger: LedgerEntry[]
  otherLedger: LedgerEntry[]
  shellWrites: Map<string, ShellWrite>
  runStart: number
  headCommitMs?: number
  mtime: number
  commitFiles?: Map<string, string | null>
}

export interface AttributeResult {
  attribution: Attribution
  fresh: Fresh
  proof: Proof
}

export function attribute(input: AttributeInput): AttributeResult {
  const {
    path,
    current,
    currentContent,
    baseline,
    runLedger,
    otherLedger,
    shellWrites,
    runStart,
    headCommitMs = 0,
    mtime,
    commitFiles,
  } = input

  // Ledger order is chronological and is the tie-break for tool calls that
  // share the same message timestamp.
  const rows = runLedger.filter((e) => e.path === path && e.scope !== "none")
  const latest = rows[rows.length - 1]

  if (commitFiles?.has(path)) {
    const expected = commitFiles.get(path) ?? null
    return {
      attribution: "agent_sealed",
      fresh: expected === current ? "fresh" : "stale",
      proof: {
        rule: "commit",
        current,
        expected,
        equal: expected === current,
        session: latest?.session,
        t: latest?.t,
      },
    }
  }

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
      const snippetPresent =
        typeof latest.newSnippet === "string" &&
        latest.newSnippet.length > 0 &&
        typeof currentContent === "string" &&
        currentContent.includes(latest.newSnippet)
      return {
        attribution: snippetPresent ? "agent_fragment" : "agent_then_changed",
        fresh: snippetPresent ? "fresh" : "stale",
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
    const laterShell = shellWrites.get(path)
    if (exact.after !== current && laterShell && laterShell.t >= exact.t) {
      return {
        attribution: "agent_shell",
        fresh: "fresh",
        proof: {
          rule: "shell",
          current,
          expected: current,
          equal: true,
          session: exact.session,
          t: laterShell.t,
          command: laterShell.command,
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
    const snippetPresent =
      typeof latest.newSnippet === "string" &&
      latest.newSnippet.length > 0 &&
      typeof currentContent === "string" &&
      currentContent.includes(latest.newSnippet)
    return {
      attribution: snippetPresent ? "agent_fragment" : "agent_then_changed",
      fresh: snippetPresent ? "fresh" : "stale",
      proof: {
        rule: "ledger-fragment",
        current,
        expected: null,
        equal: snippetPresent,
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
        attribution: "agent_shell",
        fresh: "fresh",
        proof: { rule: "shell", current, expected: current, equal: true, command: shell.command, t: shell.t },
      }
    }
    const expected = shell.after ?? null
    return {
      attribution: "agent_shell",
      fresh: expected === current ? "fresh" : "stale",
      proof: { rule: "shell", current, expected, equal: expected === current, command: shell.command, t: shell.t },
    }
  }

  // Only attribute to `other_session` if the other session touched the file
  // after the base HEAD commit AND during/after `runStart` (or if it is newer than disk mtime).
  const effectiveBaselineMs = Math.max(runStart, headCommitMs)
  const other = otherLedger.find((e) => e.path === path && (effectiveBaselineMs === 0 || e.t >= effectiveBaselineMs))
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
    if (effectiveBaselineMs > 0 && current === null && mtime === 0) {
      return {
        attribution: "pre_existing",
        fresh: "fresh",
        proof: { rule: "baseline", current, expected, equal: false, baseline: expected },
      }
    }
    if (effectiveBaselineMs > 0 && mtime > 0 && mtime < effectiveBaselineMs) {
      return {
        attribution: "pre_existing",
        fresh: "fresh",
        proof: { rule: "mtime", current, expected, equal: false, baseline: expected, t: mtime },
      }
    }
    return {
      attribution: "owner_or_external",
      fresh: "stale",
      proof: { rule: "baseline", current, expected, equal: false, baseline: expected },
    }
  }

  if (effectiveBaselineMs > 0 && current === null && mtime === 0) {
    return {
      attribution: "pre_existing",
      fresh: "fresh",
      proof: { rule: "mtime", current, expected: null, equal: false, t: 0 },
    }
  }

  if (effectiveBaselineMs > 0 && mtime > 0 && mtime < effectiveBaselineMs) {
    return {
      attribution: "pre_existing",
      fresh: "fresh",
      proof: { rule: "mtime", current, expected: null, equal: false, t: mtime },
    }
  }

  if (mtime >= effectiveBaselineMs && mtime > 0) {
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
  const diskContents = input.diskContents ?? new Map<string, string>()

  const files: FileChange[] = input.changes.map((raw) => {
    const kind = classify(raw.path)
    const result = attribute({
      path: raw.path,
      current: raw.after,
      currentContent: diskContents.get(raw.path),
      baseline: input.baseline,
      runLedger: input.runLedger,
      otherLedger: input.otherLedger,
      shellWrites,
      runStart: input.runStart,
      headCommitMs: input.headCommitMs,
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
  for (const p of input.changes.map((c) => c.path)) {
    if (!seen.has(p)) throw new Error(`change-set: path dropped from model: ${p}`)
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

  // Compute latest source/test mutation timestamp (combining ledger proof.t AND disk mtimeMs)
  // so any test/check run prior to the latest code mutation is marked `stale`.
  let latestCodeMutationT = 0
  for (const f of files) {
    if (f.kind !== "source" && f.kind !== "test") continue
    if (f.attribution === "pre_existing") continue
    const t = f.proof.equal ? (f.proof.t ?? 0) : Math.max(f.proof.t ?? 0, mtimes.get(f.path) ?? 0)
    if (t > latestCodeMutationT) latestCodeMutationT = t
  }

  const evidence: EvidenceState[] = (input.evidence ?? []).map((ev) => ({
    ...ev,
    fresh:
      ev.fresh ??
      (ev.t && latestCodeMutationT > 0 && ev.t < latestCodeMutationT ? "stale" : "fresh"),
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
    evidence,
    related: input.related ?? [],
    history: input.history ?? [],
  }
}

export function shouldPush(change: Change): boolean {
  return (
    change.counts.material > 0 ||
    (change.counts.byAttribution.agent_then_changed ?? 0) > 0 ||
    change.evidence.some((e) => e.outcome === "fail")
  )
}

export function renderSignal(change: Change): string | null {
  if (!shouldPush(change)) return null
  const kinds: Kind[] = ["source", "test", "config", "docs", "unknown"]
  const activeByKind = countBy(
    change.files
      .filter((f) => f.attribution !== "pre_existing" && f.materiality !== "noise" && f.materiality !== "blocked")
      .map((f) => f.kind),
  )
  const parts = kinds
    .filter((k) => (activeByKind[k] ?? 0) > 0)
    .map((k) => `${activeByKind[k]} ${k}`)

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
  const preExistingCount = change.counts.byAttribution.pre_existing ?? 0
  if (preExistingCount > 0) extras.push(`${preExistingCount} pre-existing`)
  if (change.evidence.length > 0) {
    const passed = change.evidence.filter((e) => e.outcome === "pass").length
    const failed = change.evidence.filter((e) => e.outcome === "fail").length
    const stale = change.evidence.filter((e) => e.fresh === "stale").length
    extras.push(`checks ${passed} pass/${failed} fail${stale > 0 ? ` (${stale} stale)` : ""}`)
  }
  if (change.counts.noise > 0) extras.push(`${change.counts.noise} generated ignored`)
  if (change.counts.blocked > 0) extras.push(`${change.counts.blocked} secret blocked`)

  const head = change.state === "committed" ? `commit ${change.id}` : `${change.state} ${change.id}`
  const call =
    change.state === "committed" && change.commit
      ? `trace({commit:"${change.commit.slice(0, 12)}"})`
      : `trace({change:"${change.id}"})`
  const body =
    parts.length > 0 && extras.length > 0
      ? `${parts.join(", ")}; ${extras.join(", ")}`
      : parts.length > 0
        ? parts.join(", ")
        : extras.join(", ")
  return `[substrate] ${head} (${change.worktree}): ${body}. ${call}`
}

const ATTRIBUTION_RANK: Record<Attribution, number> = {
  agent: 0,
  agent_fragment: 1,
  agent_shell: 2,
  agent_sealed: 3,
  agent_then_changed: 4,
  other_session: 5,
  owner_or_external: 6,
  unknown: 7,
  pre_existing: 8,
}

function topFiles(files: FileChange[]): unknown[] {
  return [...files]
    .sort(
      (a, b) =>
        ATTRIBUTION_RANK[a.attribution] - ATTRIBUTION_RANK[b.attribution] ||
        (b.proof.t ?? 0) - (a.proof.t ?? 0) ||
        a.path.localeCompare(b.path),
    )
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

  // Primary project-agnostic engineering branches: source, test, config, docs (excluding pre-existing untouched files)
  for (const kind of ["source", "test", "config", "docs"] as Kind[]) {
    const files = change.files.filter(
      (f) =>
        f.kind === kind &&
        f.attribution !== "pre_existing" &&
        f.materiality !== "noise" &&
        f.materiality !== "blocked",
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
    (f) =>
      f.kind === "unknown" &&
      f.attribution !== "pre_existing" &&
      f.materiality !== "noise" &&
      f.materiality !== "blocked",
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

  if (change.evidence.length > 0) {
    branches.push({
      name: "evidence",
      count: change.evidence.length,
      top: change.evidence.slice(-4).reverse(),
      handle: `${change.id}:evidence`,
    })
  }

  if (change.actors.length > 0) {
    // Rank root first, then active delegates sorted by recency (updatedAt DESC) so active lanes surface immediately
    const sortedActors = [...change.actors].sort((a, b) => {
      if (a.role === "root" && b.role !== "root") return -1
      if (b.role === "root" && a.role !== "root") return 1
      const aActive = (a.filesTouched ?? 0) > 0 || (a.checksRun ?? 0) > 0 ? 0 : 1
      const bActive = (b.filesTouched ?? 0) > 0 || (b.checksRun ?? 0) > 0 ? 0 : 1
      if (aActive !== bActive) return aActive - bActive
      return (
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0) ||
        (b.filesTouched ?? 0) - (a.filesTouched ?? 0) ||
        (b.checksRun ?? 0) - (a.checksRun ?? 0)
      )
    })
    branches.push({
      name: "actors",
      count: change.actors.length,
      top: sortedActors.slice(0, 4),
      handle: `${change.id}:actors`,
    })
  }

  if (change.preExisting.length > 0) {
    branches.push({
      name: "pre-existing",
      count: change.preExisting.length,
      top: change.preExisting.slice(0, 4),
      handle: `${change.id}:pre-existing`,
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

  if (change.worktrees.length > 0) {
    branches.push({
      name: "worktrees",
      count: change.worktrees.length,
      top: change.worktrees.slice(0, 4),
      handle: `${change.id}:worktrees`,
    })
  }
  if (change.related.length > 0) {
    branches.push({
      name: "related",
      count: change.related.length,
      top: change.related.slice(0, 4),
      handle: `${change.id}:related`,
    })
  }
  if (change.history.length > 0) {
    branches.push({
      name: "history",
      count: change.history.length,
      top: change.history.slice(0, 4),
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

const FILE_KINDS = new Set<Kind>(["source", "test", "config", "docs"])

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
      `  ${branch.name.padEnd(12)} ${String(branch.count).padStart(3)}  ${items.join(" · ")}  [${branch.handle}]`,
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
  if ("command" in o && "outcome" in o) {
    const freshTag = o.fresh === "stale" ? "(stale)" : ""
    return clamp(`${o.outcome}${freshTag}:${o.command}`, 54)
  }
  if ("session" in o) {
    const role = o.role ?? o.reason
    const touches = typeof o.filesTouched === "number" && o.filesTouched > 0 ? ` ${o.filesTouched}f` : ""
    const checks = typeof o.checksRun === "number" && o.checksRun > 0 ? ` ${o.checksRun}chk` : ""
    return clamp(`${o.session}${role ? `(${role}${touches}${checks})` : ""}`, 54)
  }
  if ("root" in o) return clamp(`${baseName(String(o.root))}@${o.branch ?? ""}`, 46)
  if ("commit" in o) return clamp(`${o.commit} ${o.subject ?? ""}`, 48)
  if ("kind" in o) return `${o.kind}×${o.count}`
  if ("command" in o) return clamp(`${o.command} exit ${o.exit ?? "?"}`, 48)
  return clamp(JSON.stringify(o), 48)
}

export function leaf(change: Change, branch: string, path?: string): unknown {
  // Top-level secret redaction guard: any blocked/secret file queried on ANY branch
  // must never expose proof hashes or diff excerpts.
  if (path) {
    const direct = change.files.find((f) => f.path === path)
    if (direct && (direct.materiality === "blocked" || direct.kind === "secret")) {
      return { branch: "blocked", file: { path: direct.path, kind: direct.kind, materiality: "blocked", blocked: true } }
    }
  }

  if (branch === "blocked" || branch === "secret") {
    const files = change.files.filter((f) => f.materiality === "blocked" || f.kind === "secret")
    if (path) {
      const found = files.find((f) => f.path === path)
      return found
        ? { branch: "blocked", file: { path: found.path, kind: found.kind, materiality: "blocked", blocked: true } }
        : { error: "not found", branch: "blocked", path }
    }
    return files.map((f) => ({ path: f.path, blocked: true }))
  }
  if (branch === "noise") {
    const files = change.files.filter((f) => f.materiality === "noise")
    return files
      .filter((f) => !path || f.path === path)
      .map((f) => ({ path: f.path, kind: f.kind, attribution: f.attribution }))
  }
  if (branch === "pre-existing") {
    if (path) {
      const found = change.files.find((f) => f.path === path && f.materiality !== "blocked")
      return found ? { branch, file: found } : { error: "not found", branch, path }
    }
    return change.preExisting
  }
  if (branch === "worktrees") return change.worktrees
  if (branch === "actors") {
    if (path) {
      const actor = change.actors.find((a) => a.session === path || a.session.startsWith(path))
      if (!actor) return { error: "not found", branch: "actors", session: path }
      const actorFiles = change.files
        .filter(
          (f) =>
            f.materiality !== "blocked" &&
            (f.proof.session === actor.session || (actor.paths ?? []).includes(f.path)),
        )
        .map((f) => ({ path: f.path, op: f.op, attribution: f.attribution, fresh: f.fresh }))
      const actorEvidence = change.evidence.filter((e) => e.session === actor.session)
      return { branch: "actors", actor, files: actorFiles, evidence: actorEvidence }
    }
    return change.actors
  }
  if (branch === "related") return change.related
  if (branch === "evidence") {
    if (path) {
      const items = change.evidence.filter((e) => e.command.includes(path) || e.session === path)
      return { branch: "evidence", evidence: items, items }
    }
    return { branch: "evidence", evidence: change.evidence, items: change.evidence }
  }
  if (branch === "history") return change.history

  const files = change.files.filter((f) => {
    if (f.materiality === "blocked") return false
    if (branch === "owner") {
      return f.attribution === "owner_or_external" || f.attribution === "agent_then_changed"
    }
    return f.kind === branch
  })
  const found = path
    ? files.find((f) => f.path === path) ?? change.files.find((f) => f.path === path && f.materiality !== "blocked")
    : undefined
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
