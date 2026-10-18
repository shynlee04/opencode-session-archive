// PROTOTYPE: WF-SUB-06 Iterative PageRank RepoMap & Git Temporal Co-Change Coupling Warnings
// Disposable discovery artifact per the prototype skill. Operates on owned scratch SQLite copy (wf-sub-06-codegraph.sqlite).

import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { ensureCodeGraphSchema, estimateTokens, normalizeRelPath } from "./wf-sub-05-ast-skeletonizer"

export interface PageRankOptions {
  readonly iterations?: number
  readonly damping?: number
  readonly persist?: boolean
}

export interface PageRankNode {
  readonly path: string
  readonly pagerank: number
  readonly in_degree: number
  readonly out_degree: number
  readonly loc: number
}

export interface PageRankResult {
  readonly nodeCount: number
  readonly edgeCount: number
  readonly iterations: number
  readonly damping: number
  readonly totalMass: number
  readonly maxResidual: number
  readonly solveElapsedMs: number
  readonly persistElapsedMs: number
  readonly totalElapsedMs: number
  readonly nodes: readonly PageRankNode[]
}

export interface RenderRepoMapOptions {
  readonly tokenBudget?: number
  readonly maxFiles?: number
  readonly maxSymbolsPerFile?: number
}

export interface RepoMapSymbolSummary {
  readonly name: string
  readonly kind: string
  readonly start_line: number
  readonly end_line: number
}

export interface RepoMapEntry {
  readonly rank: number
  readonly path: string
  readonly pagerank: number
  readonly in_degree: number
  readonly out_degree: number
  readonly loc: number
  readonly exported_symbol_count: number
  readonly top_symbols: readonly RepoMapSymbolSummary[]
}

export interface Tier1RepoMapView {
  readonly total_files: number
  readonly total_edges: number
  readonly included_files: number
  readonly estimated_tokens: number
  readonly token_budget: number
  readonly elapsed_ms: number
  readonly entries: readonly RepoMapEntry[]
  readonly text: string
}

export interface GitCommitRecord {
  readonly hash: string
  readonly subject: string
  readonly files: readonly string[]
}

export interface MineGitCoChangeOptions {
  readonly repoRoot?: string
  readonly maxCommits?: number
  readonly maxFilesPerCommit?: number
  readonly pathPrefix?: string
  readonly minCoCommits?: number
  readonly maxRecentSubjects?: number
  readonly commitsOverride?: readonly GitCommitRecord[]
}

export interface GitCoChangeRow {
  readonly file_a: string
  readonly file_b: string
  readonly co_commits: number
  readonly commits_a: number
  readonly commits_b: number
  readonly prob_a_given_b: number
  readonly prob_b_given_a: number
  readonly jaccard: number
  readonly has_static_edge: 0 | 1
  readonly recent_subjects_json: string
}

export interface MineGitCoChangeStats {
  readonly commitsScanned: number
  readonly commitsAccepted: number
  readonly commitsSkippedBulk: number
  readonly distinctFilesTracked: number
  readonly pairsPersisted: number
  readonly hiddenCouplingPairs: number
  readonly gitSpawnMs: number
  readonly computeAndPersistMs: number
  readonly totalElapsedMs: number
}

export interface IncrementalCoChangeStats {
  readonly revRange: string
  readonly commitsScanned: number
  readonly commitsApplied: number
  readonly pairsUpdated: number
  readonly gitSpawnMs: number
  readonly updateElapsedMs: number
  readonly totalElapsedMs: number
}

export interface QueryCoupledOptions {
  readonly minCoCommits?: number
  readonly minProbability?: number
  readonly onlyHidden?: boolean
  readonly limit?: number
}

export interface CoupledFileEntry {
  readonly path: string
  readonly co_commits: number
  readonly target_commits: number
  readonly coupled_commits: number
  readonly prob_coupled_given_target: number
  readonly prob_target_given_coupled: number
  readonly jaccard: number
  readonly has_static_edge: boolean
  readonly hidden_coupling: boolean
  readonly recent_subjects: readonly string[]
}

export interface CoupledViewportResult {
  readonly action: "coupled"
  readonly path: string
  readonly total_commits: number
  readonly coupled_files: readonly CoupledFileEntry[]
  readonly warning_banner: string
}

export type ViewportRequest =
  | ({ readonly action: "coupled"; readonly path: string } & QueryCoupledOptions)
  | ({ readonly action: "repomap" } & RenderRepoMapOptions)

export const GIT_COCHANGE_DDL = `
CREATE TABLE IF NOT EXISTS git_cochange (
  file_a TEXT NOT NULL,
  file_b TEXT NOT NULL,
  co_commits INTEGER NOT NULL,
  commits_a INTEGER NOT NULL,
  commits_b INTEGER NOT NULL,
  prob_a_given_b REAL NOT NULL,
  prob_b_given_a REAL NOT NULL,
  jaccard REAL NOT NULL,
  has_static_edge INTEGER NOT NULL,
  recent_subjects_json TEXT NOT NULL,
  PRIMARY KEY (file_a, file_b)
);

CREATE INDEX IF NOT EXISTS idx_git_cochange_file_a ON git_cochange(file_a);
CREATE INDEX IF NOT EXISTS idx_git_cochange_file_b ON git_cochange(file_b);
CREATE INDEX IF NOT EXISTS idx_git_cochange_hidden ON git_cochange(has_static_edge, co_commits DESC);

CREATE TABLE IF NOT EXISTS git_cochange_file_stats (
  path TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS git_cochange_commit (
  hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  files_json TEXT NOT NULL
);
`

export function ensureWfSub06Schema(db: Database): void {
  ensureCodeGraphSchema(db)
  db.exec(GIT_COCHANGE_DDL)
}

export function copyCodeGraphDatabase(sourceDbPath: string, targetDbPath: string): void {
  mkdirSync(path.dirname(targetDbPath), { recursive: true })
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(targetDbPath + suffix)) {
      unlinkSync(targetDbPath + suffix)
    }
  }
  copyFileSync(sourceDbPath, targetDbPath)
}

/**
 * Pure-TS iterative Float64Array PageRank solver over code_file and code_import_edge.
 * Uses CSR adjacency arrays for zero heap allocations inside the power-iteration loop,
 * redistributing dangling-node (sink) mass uniformly across all N nodes at every step.
 */
export function computePageRank(db: Database, options: PageRankOptions = {}): PageRankResult {
  const t0 = performance.now()
  ensureWfSub06Schema(db)

  const iterations = options.iterations ?? 20
  const damping = options.damping ?? 0.85
  const shouldPersist = options.persist ?? true

  const fileRows = db
    .query("SELECT path, loc FROM code_file ORDER BY path ASC")
    .all() as { path: string; loc: number }[]
  const edgeRows = db
    .query("SELECT from_path, to_path FROM code_import_edge ORDER BY from_path ASC, to_path ASC")
    .all() as { from_path: string; to_path: string }[]

  const n = fileRows.length
  if (n === 0) {
    return {
      nodeCount: 0,
      edgeCount: 0,
      iterations,
      damping,
      totalMass: 0,
      maxResidual: 0,
      solveElapsedMs: 0,
      persistElapsedMs: 0,
      totalElapsedMs: performance.now() - t0,
      nodes: [],
    }
  }

  const pathToIdx = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    pathToIdx.set(fileRows[i]!.path, i)
  }

  const outDegree = new Int32Array(n)
  const inDegree = new Int32Array(n)
  const validEdges: { readonly u: number; readonly v: number }[] = []

  for (const e of edgeRows) {
    const u = pathToIdx.get(e.from_path)
    const v = pathToIdx.get(e.to_path)
    if (u === undefined || v === undefined || u === v) continue
    validEdges.push({ u, v })
    outDegree[u] = outDegree[u]! + 1
    inDegree[v] = inDegree[v]! + 1
  }

  // CSR layout: edgeOffsets[u]..edgeOffsets[u+1] indexes edgeTargets
  const edgeOffsets = new Int32Array(n + 1)
  for (let u = 0; u < n; u++) {
    edgeOffsets[u + 1] = edgeOffsets[u]! + outDegree[u]!
  }
  const edgeTargets = new Int32Array(validEdges.length)
  const writeCursor = new Int32Array(edgeOffsets)
  for (let i = 0; i < validEdges.length; i++) {
    const { u, v } = validEdges[i]!
    const pos = writeCursor[u]!
    edgeTargets[pos] = v
    writeCursor[u] = pos + 1
  }

  let pr = new Float64Array(n).fill(1 / n)
  let next = new Float64Array(n)
  let maxResidual = 0

  const invN = 1 / n
  const teleportMass = (1 - damping) * invN

  for (let iter = 0; iter < iterations; iter++) {
    let sinkSum = 0
    for (let u = 0; u < n; u++) {
      if (outDegree[u] === 0) {
        sinkSum += pr[u]!
      }
    }

    const baseMass = teleportMass + damping * sinkSum * invN
    next.fill(baseMass)

    for (let u = 0; u < n; u++) {
      const deg = outDegree[u]!
      if (deg > 0) {
        const share = (damping * pr[u]!) / deg
        const start = edgeOffsets[u]!
        const end = edgeOffsets[u + 1]!
        for (let idx = start; idx < end; idx++) {
          const v = edgeTargets[idx]!
          next[v] = next[v]! + share
        }
      }
    }

    maxResidual = 0
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(next[i]! - pr[i]!)
      if (diff > maxResidual) maxResidual = diff
    }

    const swap = pr
    pr = next
    next = swap
  }

  let totalMass = 0
  for (let i = 0; i < n; i++) {
    totalMass += pr[i]!
  }

  const tSolveDone = performance.now()

  if (shouldPersist) {
    const now = Date.now()
    const updateStmt = db.query("UPDATE code_file SET pagerank = ?, updated_at = ? WHERE path = ?")
    const persistTx = db.transaction(() => {
      for (let i = 0; i < n; i++) {
        updateStmt.run(pr[i]!, now, fileRows[i]!.path)
      }
    })
    persistTx()
  }

  const tPersistDone = performance.now()

  const nodes: PageRankNode[] = []
  for (let i = 0; i < n; i++) {
    nodes.push({
      path: fileRows[i]!.path,
      pagerank: pr[i]!,
      in_degree: inDegree[i]!,
      out_degree: outDegree[i]!,
      loc: fileRows[i]!.loc,
    })
  }

  nodes.sort((a, b) => b.pagerank - a.pagerank || b.in_degree - a.in_degree || a.path.localeCompare(b.path))

  return {
    nodeCount: n,
    edgeCount: validEdges.length,
    iterations,
    damping,
    totalMass,
    maxResidual,
    solveElapsedMs: tSolveDone - t0,
    persistElapsedMs: tPersistDone - tSolveDone,
    totalElapsedMs: tPersistDone - t0,
    nodes,
  }
}

/**
 * Renders the Tier-1 Architectural RepoMap (< 1,000 tokens) ranked by PageRank centrality,
 * showing each top file's PageRank score, in/out degree, LOC, and top exported symbols with [Lstart-Lend] spans.
 */
export function renderTier1RepoMap(db: Database, options: RenderRepoMapOptions = {}): Tier1RepoMapView {
  const t0 = performance.now()
  ensureWfSub06Schema(db)

  const tokenBudget = options.tokenBudget ?? 950
  const maxFiles = options.maxFiles ?? 25
  const maxSymbolsPerFile = options.maxSymbolsPerFile ?? 5

  const fileRows = db
    .query("SELECT path, loc, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC")
    .all() as { path: string; loc: number; pagerank: number }[]

  const edgeRows = db
    .query("SELECT from_path, to_path, specifiers_json FROM code_import_edge")
    .all() as { from_path: string; to_path: string; specifiers_json: string }[]

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  const importedSymCountsByPath = new Map<string, Map<string, number>>()

  for (const e of edgeRows) {
    if (e.from_path === e.to_path) continue
    outDeg.set(e.from_path, (outDeg.get(e.from_path) ?? 0) + 1)
    inDeg.set(e.to_path, (inDeg.get(e.to_path) ?? 0) + 1)

    let symMap = importedSymCountsByPath.get(e.to_path)
    if (!symMap) {
      symMap = new Map()
      importedSymCountsByPath.set(e.to_path, symMap)
    }
    const specs = JSON.parse(e.specifiers_json) as string[]
    for (const s of specs) {
      if (s === "*" || s.startsWith("* as ")) continue
      symMap.set(s, (symMap.get(s) ?? 0) + 1)
    }
  }

  const exportedSymbolsRows = db
    .query(
      "SELECT path, name, kind, start_line, end_line FROM code_symbol WHERE depth = 1 AND exported = 1 ORDER BY path ASC, start_line ASC",
    )
    .all() as { path: string; name: string; kind: string; start_line: number; end_line: number }[]

  const symbolsByPath = new Map<string, RepoMapSymbolSummary[]>()
  for (const s of exportedSymbolsRows) {
    let list = symbolsByPath.get(s.path)
    if (!list) {
      list = []
      symbolsByPath.set(s.path, list)
    }
    list.push({
      name: s.name,
      kind: s.kind,
      start_line: s.start_line,
      end_line: s.end_line,
    })
  }

  const headerLine = `# Tier-1 RepoMap (${fileRows.length} files, ${edgeRows.length} import edges, sorted by PageRank)`
  const lines: string[] = [headerLine]
  const entries: RepoMapEntry[] = []

  const candidateCount = Math.min(fileRows.length, maxFiles)
  for (let i = 0; i < candidateCount; i++) {
    const f = fileRows[i]!
    const symCounts = importedSymCountsByPath.get(f.path)
    let allSyms = [...(symbolsByPath.get(f.path) ?? [])]

    if (allSyms.length > 0 && symCounts) {
      allSyms.sort(
        (a, b) =>
          (symCounts.get(b.name) ?? 0) - (symCounts.get(a.name) ?? 0) ||
          a.start_line - b.start_line,
      )
    } else if (allSyms.length === 0 && symCounts && symCounts.size > 0) {
      allSyms = [...symCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => ({
          name,
          kind: "reexport",
          start_line: 1,
          end_line: f.loc,
        }))
    }

    const topSyms = allSyms.slice(0, maxSymbolsPerFile)
    const remainingCount = Math.max(0, allSyms.length - topSyms.length)

    const symText =
      topSyms.length > 0
        ? topSyms
            .map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`)
            .join(", ") + (remainingCount > 0 ? `, +${remainingCount} more` : "")
        : `(module[L1-L${f.loc}])`

    const inCount = inDeg.get(f.path) ?? 0
    const outCount = outDeg.get(f.path) ?? 0
    const line = `${i + 1}. ${f.path} (PR=${f.pagerank.toFixed(4)}, in=${inCount}, out=${outCount}, ${f.loc} LOC): ${symText}`

    const candidateText = [...lines, line].join("\n")
    if (estimateTokens(candidateText) > tokenBudget) {
      break
    }

    lines.push(line)
    entries.push({
      rank: i + 1,
      path: f.path,
      pagerank: f.pagerank,
      in_degree: inCount,
      out_degree: outCount,
      loc: f.loc,
      exported_symbol_count: allSyms.length,
      top_symbols: topSyms,
    })
  }

  const text = lines.join("\n")
  const elapsedMs = performance.now() - t0

  return {
    total_files: fileRows.length,
    total_edges: edgeRows.length,
    included_files: entries.length,
    estimated_tokens: estimateTokens(text),
    token_budget: tokenBudget,
    elapsed_ms: elapsedMs,
    entries,
    text,
  }
}

export function parseGitLogOutput(rawOutput: string): GitCommitRecord[] {
  const lines = rawOutput.split("\n")
  const commits: GitCommitRecord[] = []
  let currentHash = ""
  let currentSubject = ""
  let currentFiles: string[] = []
  let inCommit = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith("COMMIT:")) {
      if (inCommit && currentFiles.length > 0) {
        commits.push({
          hash: currentHash,
          subject: currentSubject,
          files: currentFiles,
        })
      }
      const rest = line.slice(7)
      const sepIdx = rest.indexOf("|")
      if (sepIdx !== -1) {
        currentHash = rest.slice(0, sepIdx).trim()
        currentSubject = rest.slice(sepIdx + 1).trim()
      } else {
        currentHash = rest.trim()
        currentSubject = ""
      }
      currentFiles = []
      inCommit = true
    } else if (inCommit) {
      const trimmed = line.trim()
      if (trimmed.length > 0) {
        currentFiles.push(normalizeRelPath(trimmed))
      }
    }
  }

  if (inCommit && currentFiles.length > 0) {
    commits.push({
      hash: currentHash,
      subject: currentSubject,
      files: currentFiles,
    })
  }

  return commits
}

function loadStaticEdgePairSet(db: Database): Set<string> {
  const edgeRows = db
    .query("SELECT from_path, to_path FROM code_import_edge")
    .all() as { from_path: string; to_path: string }[]
  const pairSet = new Set<string>()
  for (const e of edgeRows) {
    const [a, b] = e.from_path < e.to_path ? [e.from_path, e.to_path] : [e.to_path, e.from_path]
    pairSet.add(`${a}|||${b}`)
  }
  return pairSet
}

/**
 * Mines git log (-n 500) temporal co-change frequencies, directional conditional probabilities
 * P(A|B) and P(B|A), Jaccard similarity, recent shared commit subjects, and static edge flags.
 * Filters out bulk formatting/init commits exceeding maxFilesPerCommit (default <= 15).
 */
export function mineGitCoChange(db: Database, options: MineGitCoChangeOptions = {}): MineGitCoChangeStats {
  const t0 = performance.now()
  ensureWfSub06Schema(db)

  const repoRoot = options.repoRoot ?? "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
  const maxCommits = options.maxCommits ?? 500
  const maxFilesPerCommit = options.maxFilesPerCommit ?? 15
  const pathPrefix = options.pathPrefix ?? "src/"
  const minCoCommits = options.minCoCommits ?? 1
  const maxRecentSubjects = options.maxRecentSubjects ?? 5

  let commits: readonly GitCommitRecord[]
  let gitSpawnMs = 0

  if (options.commitsOverride !== undefined) {
    commits = options.commitsOverride
  } else {
    const tSpawn0 = performance.now()
    const proc = Bun.spawnSync(
      ["git", "log", "-n", String(maxCommits), "--pretty=format:COMMIT:%H|%s", "--name-only"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    )
    if (proc.exitCode !== 0) {
      throw new Error(`git log failed (exit ${proc.exitCode}): ${proc.stderr.toString("utf8")}`)
    }
    const raw = proc.stdout.toString("utf8")
    gitSpawnMs = performance.now() - tSpawn0
    commits = parseGitLogOutput(raw)
  }

  const tCompute0 = performance.now()
  const staticPairSet = loadStaticEdgePairSet(db)

  const fileCommitCounts = new Map<string, number>()
  const pairStats = new Map<string, { count: number; subjects: string[] }>()
  const acceptedCommitRows: { readonly hash: string; readonly subject: string; readonly files: readonly string[] }[] = []

  let commitsAccepted = 0
  let commitsSkippedBulk = 0

  for (const commit of commits) {
    const filteredFiles = [
      ...new Set(
        commit.files
          .map(normalizeRelPath)
          .filter((f) => (pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true)),
      ),
    ].sort()

    if (filteredFiles.length === 0) continue
    if (filteredFiles.length > maxFilesPerCommit) {
      commitsSkippedBulk++
      continue
    }

    commitsAccepted++
    acceptedCommitRows.push({
      hash: commit.hash,
      subject: commit.subject,
      files: filteredFiles,
    })

    for (let i = 0; i < filteredFiles.length; i++) {
      const f = filteredFiles[i]!
      fileCommitCounts.set(f, (fileCommitCounts.get(f) ?? 0) + 1)
    }

    for (let i = 0; i < filteredFiles.length; i++) {
      const fileA = filteredFiles[i]!
      for (let j = i + 1; j < filteredFiles.length; j++) {
        const fileB = filteredFiles[j]!
        const key = `${fileA}|||${fileB}`
        let entry = pairStats.get(key)
        if (!entry) {
          entry = { count: 0, subjects: [] }
          pairStats.set(key, entry)
        }
        entry.count++
        if (
          commit.subject.length > 0 &&
          entry.subjects.length < maxRecentSubjects &&
          !entry.subjects.includes(commit.subject)
        ) {
          entry.subjects.push(commit.subject)
        }
      }
    }
  }

  const rowsToInsert: GitCoChangeRow[] = []
  let hiddenCouplingPairs = 0

  for (const [key, entry] of pairStats.entries()) {
    if (entry.count < minCoCommits) continue
    const sep = key.indexOf("|||")
    const fileA = key.slice(0, sep)
    const fileB = key.slice(sep + 3)
    const commitsA = fileCommitCounts.get(fileA) ?? entry.count
    const commitsB = fileCommitCounts.get(fileB) ?? entry.count
    const unionCount = commitsA + commitsB - entry.count
    const probAGivenB = commitsB > 0 ? entry.count / commitsB : 0
    const probBGivenA = commitsA > 0 ? entry.count / commitsA : 0
    const jaccard = unionCount > 0 ? entry.count / unionCount : 0
    const hasStaticEdge: 0 | 1 = staticPairSet.has(key) ? 1 : 0
    if (hasStaticEdge === 0) hiddenCouplingPairs++

    rowsToInsert.push({
      file_a: fileA,
      file_b: fileB,
      co_commits: entry.count,
      commits_a: commitsA,
      commits_b: commitsB,
      prob_a_given_b: probAGivenB,
      prob_b_given_a: probBGivenA,
      jaccard,
      has_static_edge: hasStaticEdge,
      recent_subjects_json: JSON.stringify(entry.subjects),
    })
  }

  const clearCochange = db.query("DELETE FROM git_cochange")
  const clearFileStats = db.query("DELETE FROM git_cochange_file_stats")
  const clearCommits = db.query("DELETE FROM git_cochange_commit")

  const insertCochange = db.query(`
    INSERT INTO git_cochange (
      file_a, file_b, co_commits, commits_a, commits_b,
      prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertFileStat = db.query(`
    INSERT INTO git_cochange_file_stats (path, commit_count) VALUES (?, ?)
  `)
  const insertCommit = db.query(`
    INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json) VALUES (?, ?, ?)
  `)

  const persistTx = db.transaction(() => {
    clearCochange.run()
    clearFileStats.run()
    clearCommits.run()

    for (const [f, cnt] of fileCommitCounts.entries()) {
      insertFileStat.run(f, cnt)
    }
    for (const c of acceptedCommitRows) {
      insertCommit.run(c.hash, c.subject, JSON.stringify(c.files))
    }
    for (const r of rowsToInsert) {
      insertCochange.run(
        r.file_a,
        r.file_b,
        r.co_commits,
        r.commits_a,
        r.commits_b,
        r.prob_a_given_b,
        r.prob_b_given_a,
        r.jaccard,
        r.has_static_edge,
        r.recent_subjects_json,
      )
    }
  })
  persistTx()

  const computeAndPersistMs = performance.now() - tCompute0
  const totalElapsedMs = performance.now() - t0

  return {
    commitsScanned: commits.length,
    commitsAccepted,
    commitsSkippedBulk,
    distinctFilesTracked: fileCommitCounts.size,
    pairsPersisted: rowsToInsert.length,
    hiddenCouplingPairs,
    gitSpawnMs,
    computeAndPersistMs,
    totalElapsedMs,
  }
}

/**
 * Incrementally applies a commit range (e.g. HEAD~1..HEAD) into git_cochange without rescanning
 * the full 500-commit history. Idempotent with respect to commit hash unless forceReapply is true.
 */
export function updateGitCoChangeIncremental(
  db: Database,
  repoRoot: string,
  revRange = "HEAD~1..HEAD",
  options: {
    readonly maxFilesPerCommit?: number
    readonly pathPrefix?: string
    readonly maxRecentSubjects?: number
    readonly forceReapply?: boolean
  } = {},
): IncrementalCoChangeStats {
  const t0 = performance.now()
  ensureWfSub06Schema(db)

  const maxFilesPerCommit = options.maxFilesPerCommit ?? 15
  const pathPrefix = options.pathPrefix ?? "src/"
  const maxRecentSubjects = options.maxRecentSubjects ?? 5
  const forceReapply = options.forceReapply ?? false

  const tSpawn0 = performance.now()
  const proc = Bun.spawnSync(
    ["git", "log", revRange, "--pretty=format:COMMIT:%H|%s", "--name-only"],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  )
  if (proc.exitCode !== 0) {
    throw new Error(`git log ${revRange} failed: ${proc.stderr.toString("utf8")}`)
  }
  const raw = proc.stdout.toString("utf8")
  const gitSpawnMs = performance.now() - tSpawn0

  const tUpdate0 = performance.now()
  const commits = parseGitLogOutput(raw)
  const staticPairSet = loadStaticEdgePairSet(db)

  const checkCommit = db.query("SELECT hash FROM git_cochange_commit WHERE hash = ?")
  const insertCommit = db.query(
    "INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json) VALUES (?, ?, ?)",
  )
  const getFileCount = db.query("SELECT commit_count FROM git_cochange_file_stats WHERE path = ?")
  const upsertFileCount = db.query(`
    INSERT INTO git_cochange_file_stats (path, commit_count) VALUES (?, 1)
    ON CONFLICT(path) DO UPDATE SET commit_count = commit_count + 1
  `)
  const getPair = db.query("SELECT * FROM git_cochange WHERE file_a = ? AND file_b = ?")
  const upsertPair = db.query(`
    INSERT OR REPLACE INTO git_cochange (
      file_a, file_b, co_commits, commits_a, commits_b,
      prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const refreshDrinksA = db.query(`
    UPDATE git_cochange
    SET commits_a = ?,
        prob_b_given_a = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (? + commits_b - co_commits)
    WHERE file_a = ?
  `)
  const refreshDrinksB = db.query(`
    UPDATE git_cochange
    SET commits_b = ?,
        prob_a_given_b = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (commits_a + ? - co_commits)
    WHERE file_b = ?
  `)

  let commitsApplied = 0
  let pairsUpdated = 0

  const applyTx = db.transaction(() => {
    for (const c of commits) {
      if (!forceReapply && checkCommit.get(c.hash)) continue
      const filteredFiles = [
        ...new Set(
          c.files
            .map(normalizeRelPath)
            .filter((f) => (pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true)),
        ),
      ].sort()
      if (filteredFiles.length === 0 || filteredFiles.length > maxFilesPerCommit) continue

      commitsApplied++
      insertCommit.run(c.hash, c.subject, JSON.stringify(filteredFiles))

      const updatedCounts = new Map<string, number>()
      for (const f of filteredFiles) {
        if (!forceReapply) {
          upsertFileCount.run(f)
        }
        const row = getFileCount.get(f) as { commit_count: number } | null
        const newCount = row ? row.commit_count : 1
        updatedCounts.set(f, newCount)
        if (!forceReapply) {
          refreshDrinksA.run(newCount, newCount, newCount, f)
          refreshDrinksB.run(newCount, newCount, newCount, f)
        }
      }

      for (let i = 0; i < filteredFiles.length; i++) {
        const fileA = filteredFiles[i]!
        for (let j = i + 1; j < filteredFiles.length; j++) {
          const fileB = filteredFiles[j]!
          const existing = getPair.get(fileA, fileB) as GitCoChangeRow | null
          const coCommits = existing ? (forceReapply ? existing.co_commits : existing.co_commits + 1) : 1
          const commitsA = updatedCounts.get(fileA) ?? existing?.commits_a ?? 1
          const commitsB = updatedCounts.get(fileB) ?? existing?.commits_b ?? 1
          const union = Math.max(1, commitsA + commitsB - coCommits)
          const probAGivenB = coCommits / commitsB
          const probBGivenA = coCommits / commitsA
          const jaccard = coCommits / union
          const hasStatic: 0 | 1 = staticPairSet.has(`${fileA}|||${fileB}`) ? 1 : 0
          const prevSubjects = existing ? (JSON.parse(existing.recent_subjects_json) as string[]) : []
          const nextSubjects =
            c.subject && !prevSubjects.includes(c.subject)
              ? [c.subject, ...prevSubjects].slice(0, maxRecentSubjects)
              : prevSubjects

          upsertPair.run(
            fileA,
            fileB,
            coCommits,
            commitsA,
            commitsB,
            probAGivenB,
            probBGivenA,
            jaccard,
            hasStatic,
            JSON.stringify(nextSubjects),
          )
          pairsUpdated++
        }
      }
    }
  })
  applyTx()

  const updateElapsedMs = performance.now() - tUpdate0
  const totalElapsedMs = performance.now() - t0

  return {
    revRange,
    commitsScanned: commits.length,
    commitsApplied,
    pairsUpdated,
    gitSpawnMs,
    updateElapsedMs,
    totalElapsedMs,
  }
}

/**
 * Queries temporal co-change couplings for a target file path.
 * Surfaces both hidden couplings (has_static_edge = 0) and static+temporal couplings,
 * ranked by co-commit count, directional probability P(other | target), and hidden-coupling priority.
 */
export function queryCoupledFiles(
  db: Database,
  targetPath: string,
  options: QueryCoupledOptions = {},
): CoupledViewportResult {
  ensureWfSub06Schema(db)
  const normTarget = normalizeRelPath(targetPath)
  const minCoCommits = options.minCoCommits ?? 2
  const minProbability = options.minProbability ?? 0.2
  const onlyHidden = options.onlyHidden ?? false
  const limit = options.limit ?? 15

  const rows = db
    .query(
      `SELECT * FROM git_cochange
       WHERE (file_a = ? OR file_b = ?)
         AND co_commits >= ?`,
    )
    .all(normTarget, normTarget, minCoCommits) as GitCoChangeRow[]

  const statRow = db
    .query("SELECT commit_count FROM git_cochange_file_stats WHERE path = ?")
    .get(normTarget) as { commit_count: number } | null

  let targetCommits = statRow?.commit_count ?? 0
  const entries: CoupledFileEntry[] = []

  for (const r of rows) {
    if (onlyHidden && r.has_static_edge !== 0) continue
    const isA = r.file_a === normTarget
    const otherPath = isA ? r.file_b : r.file_a
    const tCommits = isA ? r.commits_a : r.commits_b
    const cCommits = isA ? r.commits_b : r.commits_a
    const probCoupledGivenTarget = isA ? r.prob_b_given_a : r.prob_a_given_b
    const probTargetGivenCoupled = isA ? r.prob_a_given_b : r.prob_b_given_a

    if (tCommits > targetCommits) targetCommits = tCommits
    if (probCoupledGivenTarget < minProbability) continue

    entries.push({
      path: otherPath,
      co_commits: r.co_commits,
      target_commits: tCommits,
      coupled_commits: cCommits,
      prob_coupled_given_target: probCoupledGivenTarget,
      prob_target_given_coupled: probTargetGivenCoupled,
      jaccard: r.jaccard,
      has_static_edge: r.has_static_edge === 1,
      hidden_coupling: r.has_static_edge === 0,
      recent_subjects: JSON.parse(r.recent_subjects_json) as string[],
    })
  }

  entries.sort(
    (a, b) =>
      b.co_commits - a.co_commits ||
      b.prob_coupled_given_target - a.prob_coupled_given_target ||
      Number(b.hidden_coupling) - Number(a.hidden_coupling) ||
      a.path.localeCompare(b.path),
  )

  const limited = entries.slice(0, limit)
  const bannerLines: string[] = [
    `// Coupled files for ${normTarget} (${targetCommits} commits in window):`,
  ]
  for (const item of limited) {
    const pct = (item.prob_coupled_given_target * 100).toFixed(1)
    const edgeLabel = item.hidden_coupling ? "HIDDEN COUPLING (0 static import edges)" : "static+temporal"
    const latestSubject = item.recent_subjects[0] ? ` — e.g. "${item.recent_subjects[0]}"` : ""
    bannerLines.push(
      `// - ${item.path}: P=${pct}% (${item.co_commits}/${item.target_commits} commits, Jaccard=${(item.jaccard * 100).toFixed(1)}%, ${edgeLabel})${latestSubject}`,
    )
  }

  return {
    action: "coupled",
    path: normTarget,
    total_commits: targetCommits,
    coupled_files: limited,
    warning_banner: bannerLines.join("\n"),
  }
}

export function viewport(
  db: Database,
  request: ViewportRequest,
): CoupledViewportResult | Tier1RepoMapView {
  if (request.action === "coupled") {
    return queryCoupledFiles(db, request.path, request)
  }
  return renderTier1RepoMap(db, request)
}

if (import.meta.main) {
  const substrateRoot = "/Users/MAC/Documents/coding-projects/hivemind-substrate"
  const stewardRoot = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
  const srcDbPath = path.join(substrateRoot, "scratch/prototypes/data/wf-sub-05-codegraph.sqlite")
  const dstDbPath = path.join(substrateRoot, "scratch/prototypes/data/wf-sub-06-codegraph.sqlite")

  copyCodeGraphDatabase(srcDbPath, dstDbPath)
  const db = new Database(dstDbPath)

  const prResult = computePageRank(db, { iterations: 20, damping: 0.85, persist: true })
  const repoMap = renderTier1RepoMap(db, { tokenBudget: 950, maxFiles: 22, maxSymbolsPerFile: 5 })
  const cochangeStats = mineGitCoChange(db, {
    repoRoot: stewardRoot,
    maxCommits: 500,
    maxFilesPerCommit: 15,
    pathPrefix: "src/",
  })
  const coupledDevin = queryCoupledFiles(db, "src/devin-executable.ts")

  console.log("=== WF-SUB-06 PageRank & Git Co-Change Prototype ===")
  console.log("PageRank stats:", {
    nodeCount: prResult.nodeCount,
    edgeCount: prResult.edgeCount,
    iterations: prResult.iterations,
    totalMass: Number(prResult.totalMass.toFixed(6)),
    maxResidual: prResult.maxResidual,
    solveElapsedMs: Number(prResult.solveElapsedMs.toFixed(3)),
    persistElapsedMs: Number(prResult.persistElapsedMs.toFixed(3)),
    totalElapsedMs: Number(prResult.totalElapsedMs.toFixed(3)),
  })
  console.log("Top 10 PageRank nodes:", prResult.nodes.slice(0, 10))
  console.log(`\nTier-1 RepoMap (${repoMap.included_files} files, ${repoMap.estimated_tokens} tokens, ${repoMap.elapsed_ms.toFixed(3)} ms):\n${repoMap.text}`)
  console.log("\nGit Co-Change stats:", cochangeStats)
  console.log("\nViewport action='coupled' for src/devin-executable.ts:\n" + coupledDevin.warning_banner)

  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
}
