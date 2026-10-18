import { Database } from "bun:sqlite"
import { ensureCodeGraphSchema, normalizeRelPath } from "./ast-skeleton.ts"

export interface GitCommitRecord {
  readonly hash: string
  readonly subject: string
  readonly files: readonly string[]
}

export interface MineGitCoChangeOptions {
  readonly repoRoot?: string
  readonly projectRoot?: string
  readonly maxCommits?: number
  readonly maxFilesPerCommit?: number
  readonly pathPrefix?: string
  readonly minCoCommits?: number
  readonly maxRecentSubjects?: number
  readonly range?: string
  readonly revRange?: string
  readonly commitsOverride?: readonly GitCommitRecord[]
  readonly force?: boolean
  readonly forceReapply?: boolean
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
  readonly commitsApplied: number
  readonly commitsSkippedExisting: number
  readonly commitsSkippedBulk: number
  readonly commitsFilteredBulk: number
  readonly distinctFilesTracked: number
  readonly pairsPersisted: number
  readonly cochangePairsStored: number
  readonly hiddenCouplingPairs: number
  readonly headCommitSha: string | null
  readonly gitSpawnMs: number
  readonly computeAndPersistMs: number
  readonly totalElapsedMs: number
  readonly elapsedMs: number
}

export interface IncrementalCoChangeStats {
  readonly revRange: string
  readonly commitsScanned: number
  readonly commitsApplied: number
  readonly pairsUpdated: number
  readonly updatedPairs: number
  readonly skippedSameHead: boolean
  readonly gitSpawnMs: number
  readonly updateElapsedMs: number
  readonly totalElapsedMs: number
  readonly elapsedMs: number
}

export interface QueryCochangeCouplingsOptions {
  readonly minProbability?: number
  readonly minCochangeCount?: number
  readonly minCoCommits?: number
  readonly onlyHidden?: boolean
  readonly limit?: number
}

export type QueryCoupledOptions = QueryCochangeCouplingsOptions

export interface CoChangeCouplingRow {
  readonly target_path: string
  readonly path: string
  readonly coupled_path: string
  readonly partner_path: string
  readonly co_commits: number
  readonly cochange_count: number
  readonly target_commits: number
  readonly coupled_commits: number
  readonly partner_commits: number
  readonly probability: number
  readonly prob_coupled_given_target: number
  readonly prob_partner_given_target: number
  readonly prob_target_given_coupled: number
  readonly prob_target_given_partner: number
  readonly jaccard: number
  readonly has_static_edge: 0 | 1
  readonly hasStaticEdge: boolean
  readonly hidden_coupling: boolean
  readonly is_hidden: boolean
  readonly recent_subjects: readonly string[]
  readonly recent_subjects_json: string
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
  files_json TEXT NOT NULL,
  applied_at INTEGER NOT NULL DEFAULT 0
);
`

const initializedCochangeDbs = new WeakSet<Database>()

export function ensureCochangeSchema(db: Database): void {
  ensureCodeGraphSchema(db)
  if (initializedCochangeDbs.has(db)) {
    const hasTable = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'git_cochange'")
      .get()
    if (hasTable) return
  }

  db.exec(GIT_COCHANGE_DDL)
  const commitCols = new Set(
    (db.query("PRAGMA table_info(git_cochange_commit)").all() as { name: string }[]).map((c) => c.name),
  )
  if (!commitCols.has("applied_at")) {
    db.exec("ALTER TABLE git_cochange_commit ADD COLUMN applied_at INTEGER NOT NULL DEFAULT 0")
  }
  initializedCochangeDbs.add(db)
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

function applyIncrementalCommits(
  db: Database,
  commits: readonly GitCommitRecord[],
  options: {
    readonly maxFilesPerCommit: number
    readonly pathPrefix: string
    readonly maxRecentSubjects: number
    readonly forceReapply: boolean
  },
): {
  readonly commitsAccepted: number
  readonly commitsApplied: number
  readonly commitsSkippedExisting: number
  readonly commitsSkippedBulk: number
  readonly pairsUpdated: number
} {
  const { maxFilesPerCommit, pathPrefix, maxRecentSubjects, forceReapply } = options
  const staticPairSet = loadStaticEdgePairSet(db)
  const now = Date.now()

  const checkCommit = db.query("SELECT hash FROM git_cochange_commit WHERE hash = ?")
  const insertCommit = db.query(
    "INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json, applied_at) VALUES (?, ?, ?, ?)",
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
  const refreshFileA = db.query(`
    UPDATE git_cochange
    SET commits_a = ?,
        prob_b_given_a = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (? + commits_b - co_commits)
    WHERE file_a = ?
  `)
  const refreshFileB = db.query(`
    UPDATE git_cochange
    SET commits_b = ?,
        prob_a_given_b = CAST(co_commits AS REAL) / ?,
        jaccard = CAST(co_commits AS REAL) / (commits_a + ? - co_commits)
    WHERE file_b = ?
  `)

  let commitsAccepted = 0
  let commitsApplied = 0
  let commitsSkippedExisting = 0
  let commitsSkippedBulk = 0
  let pairsUpdated = 0

  const seenInBatch = new Set<string>()

  const applyTx = db.transaction(() => {
    for (const c of commits) {
      if (!forceReapply && (seenInBatch.has(c.hash) || checkCommit.get(c.hash))) {
        commitsSkippedExisting++
        continue
      }
      seenInBatch.add(c.hash)

      const filteredFiles = [
        ...new Set(
          c.files
            .map(normalizeRelPath)
            .filter((f) => (pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true)),
        ),
      ].sort()
      if (filteredFiles.length === 0) {
        insertCommit.run(c.hash, c.subject, "[]", now)
        continue
      }
      if (filteredFiles.length > maxFilesPerCommit) {
        commitsSkippedBulk++
        insertCommit.run(c.hash, c.subject, "[]", now)
        continue
      }

      commitsAccepted++
      commitsApplied++
      insertCommit.run(c.hash, c.subject, JSON.stringify(filteredFiles), now)

      const updatedCounts = new Map<string, number>()
      for (const f of filteredFiles) {
        if (!forceReapply) {
          upsertFileCount.run(f)
        }
        const row = getFileCount.get(f) as { commit_count: number } | null
        const newCount = row ? row.commit_count : 1
        updatedCounts.set(f, newCount)
        if (!forceReapply) {
          refreshFileA.run(newCount, newCount, newCount, f)
          refreshFileB.run(newCount, newCount, newCount, f)
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

  return {
    commitsAccepted,
    commitsApplied,
    commitsSkippedExisting,
    commitsSkippedBulk,
    pairsUpdated,
  }
}

/**
 * Mines git log (-n 500 or incremental range) temporal co-change frequencies, directional
 * conditional probabilities P(A|B) and P(B|A), Jaccard similarity, recent shared commit subjects,
 * and static edge flags. Filters out bulk commits exceeding maxFilesPerCommit (default <= 15)
 * and skips already-indexed commit SHAs idempotently on incremental runs.
 */
export function mineGitCochange(
  db: Database,
  repoRootOrOptions?: string | MineGitCoChangeOptions,
  maybeOptions?: MineGitCoChangeOptions,
): MineGitCoChangeStats {
  const t0 = performance.now()
  ensureCochangeSchema(db)

  let options: MineGitCoChangeOptions = {}
  let explicitRoot: string | undefined
  if (typeof repoRootOrOptions === "string") {
    explicitRoot = repoRootOrOptions
    options = maybeOptions ?? {}
  } else if (repoRootOrOptions && typeof repoRootOrOptions === "object") {
    options = repoRootOrOptions
  }

  const repoRoot =
    explicitRoot ??
    options.repoRoot ??
    options.projectRoot ??
    "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
  const maxCommits = options.maxCommits ?? 500
  const maxFilesPerCommit = options.maxFilesPerCommit ?? 15
  const pathPrefix = options.pathPrefix ?? "src/"
  const minCoCommits = options.minCoCommits ?? 1
  const maxRecentSubjects = options.maxRecentSubjects ?? 5
  const range = options.range ?? options.revRange
  const forceReapply = Boolean(options.force ?? options.forceReapply)

  let commits: readonly GitCommitRecord[]
  let gitSpawnMs = 0

  if (options.commitsOverride !== undefined) {
    commits = options.commitsOverride
  } else {
    const tSpawn0 = performance.now()
    const gitArgs = range
      ? ["git", "log", range, "--pretty=format:COMMIT:%H|%s", "--name-only"]
      : ["git", "log", "-n", String(maxCommits), "--pretty=format:COMMIT:%H|%s", "--name-only"]
    const proc = Bun.spawnSync(gitArgs, { cwd: repoRoot, stdout: "pipe", stderr: "pipe" })
    if (proc.exitCode !== 0) {
      throw new Error(`git log failed (exit ${proc.exitCode}): ${proc.stderr.toString("utf8")}`)
    }
    const raw = proc.stdout.toString("utf8")
    gitSpawnMs = performance.now() - tSpawn0
    commits = parseGitLogOutput(raw)
  }

  const tCompute0 = performance.now()
  const existingCommitCount = (
    db.query("SELECT COUNT(*) AS cnt FROM git_cochange_commit").get() as { cnt: number }
  ).cnt

  // If range is provided, or if DB already has commits and we are not overriding with synthetic commits,
  // apply incrementally with commit-SHA deduplication.
  if (
    range !== undefined ||
    (existingCommitCount > 0 && options.commitsOverride === undefined && !forceReapply)
  ) {
    const inc = applyIncrementalCommits(db, commits, {
      maxFilesPerCommit,
      pathPrefix,
      maxRecentSubjects,
      forceReapply,
    })
    const fileCountRow = db
      .query("SELECT COUNT(*) AS cnt FROM git_cochange_file_stats")
      .get() as { cnt: number }
    const pairStatsRow = db
      .query(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN has_static_edge = 0 THEN 1 ELSE 0 END) AS hidden FROM git_cochange",
      )
      .get() as { total: number; hidden: number | null }
    const computeAndPersistMs = performance.now() - tCompute0
    const totalElapsedMs = performance.now() - t0

    return {
      commitsScanned: commits.length,
      commitsAccepted: inc.commitsAccepted,
      commitsApplied: inc.commitsApplied,
      commitsSkippedExisting: inc.commitsSkippedExisting,
      commitsSkippedBulk: inc.commitsSkippedBulk,
      commitsFilteredBulk: inc.commitsSkippedBulk,
      distinctFilesTracked: fileCountRow.cnt,
      pairsPersisted: pairStatsRow.total,
      cochangePairsStored: pairStatsRow.total,
      hiddenCouplingPairs: pairStatsRow.hidden ?? 0,
      headCommitSha: commits[0]?.hash ?? null,
      gitSpawnMs,
      computeAndPersistMs,
      totalElapsedMs,
      elapsedMs: totalElapsedMs,
    }
  }

  const staticPairSet = loadStaticEdgePairSet(db)
  const fileCommitCounts = new Map<string, number>()
  const pairStats = new Map<string, { count: number; subjects: string[] }>()
  const scannedCommitRows: {
    readonly hash: string
    readonly subject: string
    readonly files: readonly string[]
  }[] = []
  const seenHashes = new Set<string>()

  let commitsAccepted = 0
  let commitsSkippedExisting = 0
  let commitsSkippedBulk = 0

  for (const commit of commits) {
    if (seenHashes.has(commit.hash)) {
      commitsSkippedExisting++
      continue
    }
    seenHashes.add(commit.hash)

    const filteredFiles = [
      ...new Set(
        commit.files
          .map(normalizeRelPath)
          .filter((f) => (pathPrefix.length > 0 ? f.startsWith(pathPrefix) : true)),
      ),
    ].sort()

    if (filteredFiles.length === 0) {
      scannedCommitRows.push({
        hash: commit.hash,
        subject: commit.subject,
        files: [],
      })
      continue
    }
    if (filteredFiles.length > maxFilesPerCommit) {
      commitsSkippedBulk++
      scannedCommitRows.push({
        hash: commit.hash,
        subject: commit.subject,
        files: [],
      })
      continue
    }

    commitsAccepted++
    scannedCommitRows.push({
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

  const now = Date.now()
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
    INSERT OR REPLACE INTO git_cochange_commit (hash, subject, files_json, applied_at) VALUES (?, ?, ?, ?)
  `)

  const persistTx = db.transaction(() => {
    clearCochange.run()
    clearFileStats.run()
    clearCommits.run()

    for (const [f, cnt] of fileCommitCounts.entries()) {
      insertFileStat.run(f, cnt)
    }
    for (const c of scannedCommitRows) {
      insertCommit.run(c.hash, c.subject, JSON.stringify(c.files), now)
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
    commitsApplied: commitsAccepted,
    commitsSkippedExisting,
    commitsSkippedBulk,
    commitsFilteredBulk: commitsSkippedBulk,
    distinctFilesTracked: fileCommitCounts.size,
    pairsPersisted: rowsToInsert.length,
    cochangePairsStored: rowsToInsert.length,
    hiddenCouplingPairs,
    headCommitSha: commits[0]?.hash ?? null,
    gitSpawnMs,
    computeAndPersistMs,
    totalElapsedMs,
    elapsedMs: totalElapsedMs,
  }
}

export const mineGitCoChange = mineGitCochange

/**
 * Incrementally applies a commit range (e.g. HEAD~1..HEAD) into git_cochange without rescanning
 * the full 500-commit history. Idempotent with respect to commit hash unless forceReapply is true.
 */
export function updateGitCoChangeIncremental(
  db: Database,
  repoRootOrOptions:
    | string
    | {
        readonly projectRoot?: string
        readonly repoRoot?: string
        readonly revisionRange?: string
        readonly revRange?: string
        readonly maxFilesPerCommit?: number
        readonly pathPrefix?: string
        readonly maxRecentSubjects?: number
        readonly forceReapply?: boolean
      },
  revRangeArg = "HEAD~1..HEAD",
  optionsArg: {
    readonly maxFilesPerCommit?: number
    readonly pathPrefix?: string
    readonly maxRecentSubjects?: number
    readonly forceReapply?: boolean
  } = {},
): IncrementalCoChangeStats {
  const t0 = performance.now()
  ensureCochangeSchema(db)

  let repoRoot: string
  let revRange = revRangeArg
  let maxFilesPerCommit = optionsArg.maxFilesPerCommit ?? 15
  let pathPrefix = optionsArg.pathPrefix ?? "src/"
  let maxRecentSubjects = optionsArg.maxRecentSubjects ?? 5
  let forceReapply = optionsArg.forceReapply ?? false

  if (typeof repoRootOrOptions === "string") {
    repoRoot = repoRootOrOptions
  } else {
    repoRoot =
      repoRootOrOptions.repoRoot ??
      repoRootOrOptions.projectRoot ??
      "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
    revRange = repoRootOrOptions.revisionRange ?? repoRootOrOptions.revRange ?? "HEAD~1..HEAD"
    maxFilesPerCommit = repoRootOrOptions.maxFilesPerCommit ?? 15
    pathPrefix = repoRootOrOptions.pathPrefix ?? "src/"
    maxRecentSubjects = repoRootOrOptions.maxRecentSubjects ?? 5
    forceReapply = repoRootOrOptions.forceReapply ?? false
  }

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
  const inc = applyIncrementalCommits(db, commits, {
    maxFilesPerCommit,
    pathPrefix,
    maxRecentSubjects,
    forceReapply,
  })

  const updateElapsedMs = performance.now() - tUpdate0
  const totalElapsedMs = performance.now() - t0

  return {
    revRange,
    commitsScanned: commits.length,
    commitsApplied: inc.commitsApplied,
    pairsUpdated: inc.pairsUpdated,
    updatedPairs: inc.pairsUpdated,
    skippedSameHead: inc.commitsApplied === 0,
    gitSpawnMs,
    updateElapsedMs,
    totalElapsedMs,
    elapsedMs: totalElapsedMs,
  }
}

/**
 * Queries temporal co-change couplings for a target file path and returns CoChangeCouplingRow[].
 */
export function queryCochangeCouplings(
  db: Database,
  targetPath: string,
  options: QueryCochangeCouplingsOptions = {},
): CoChangeCouplingRow[] {
  ensureCochangeSchema(db)
  const normTarget = normalizeRelPath(targetPath)
  const minCoCommits = options.minCochangeCount ?? options.minCoCommits ?? 2
  const minProbability = options.minProbability ?? 0.3
  const onlyHidden = options.onlyHidden ?? false
  const limit = options.limit ?? 10

  const rows = db
    .query(
      `SELECT * FROM git_cochange
       WHERE (file_a = ? OR file_b = ?)
         AND co_commits >= ?`,
    )
    .all(normTarget, normTarget, minCoCommits) as GitCoChangeRow[]

  const entries: CoChangeCouplingRow[] = []

  for (const r of rows) {
    if (onlyHidden && r.has_static_edge !== 0) continue
    const isA = r.file_a === normTarget
    const otherPath = isA ? r.file_b : r.file_a
    const tCommits = isA ? r.commits_a : r.commits_b
    const cCommits = isA ? r.commits_b : r.commits_a
    const probCoupledGivenTarget = isA ? r.prob_b_given_a : r.prob_a_given_b
    const probTargetGivenCoupled = isA ? r.prob_a_given_b : r.prob_b_given_a

    if (probCoupledGivenTarget < minProbability) continue

    const hasStatic: 0 | 1 = r.has_static_edge === 1 ? 1 : 0
    const recentSubjects = JSON.parse(r.recent_subjects_json || "[]") as string[]

    entries.push({
      target_path: normTarget,
      path: otherPath,
      coupled_path: otherPath,
      partner_path: otherPath,
      co_commits: r.co_commits,
      cochange_count: r.co_commits,
      target_commits: tCommits,
      coupled_commits: cCommits,
      partner_commits: cCommits,
      probability: probCoupledGivenTarget,
      prob_coupled_given_target: probCoupledGivenTarget,
      prob_partner_given_target: probCoupledGivenTarget,
      prob_target_given_coupled: probTargetGivenCoupled,
      prob_target_given_partner: probTargetGivenCoupled,
      jaccard: r.jaccard,
      has_static_edge: hasStatic,
      hasStaticEdge: hasStatic === 1,
      hidden_coupling: hasStatic === 0,
      is_hidden: hasStatic === 0,
      recent_subjects: recentSubjects,
      recent_subjects_json: r.recent_subjects_json,
    })
  }

  entries.sort(
    (a, b) =>
      b.co_commits - a.co_commits ||
      b.prob_coupled_given_target - a.prob_coupled_given_target ||
      Number(b.hidden_coupling) - Number(a.hidden_coupling) ||
      a.path.localeCompare(b.path),
  )

  return entries.slice(0, limit)
}

/**
 * Queries temporal co-change couplings for a target file path and returns a structured CoupledViewportResult
 * with boolean has_static_edge and a formatted warning_banner.
 */
export function queryCoupledFiles(
  db: Database,
  targetPath: string,
  options: QueryCoupledOptions = {},
): CoupledViewportResult {
  ensureCochangeSchema(db)
  const normTarget = normalizeRelPath(targetPath)
  const minCoCommits = options.minCochangeCount ?? options.minCoCommits ?? 2
  const minProbability = options.minProbability ?? 0.2
  const onlyHidden = options.onlyHidden ?? false
  const limit = options.limit ?? 15

  const rows = queryCochangeCouplings(db, normTarget, {
    minCochangeCount: minCoCommits,
    minProbability,
    onlyHidden,
    limit,
  })

  const statRow = db
    .query("SELECT commit_count FROM git_cochange_file_stats WHERE path = ?")
    .get(normTarget) as { commit_count: number } | null

  let targetCommits = statRow?.commit_count ?? 0
  for (const r of rows) {
    if (r.target_commits > targetCommits) targetCommits = r.target_commits
  }

  const coupledFiles: CoupledFileEntry[] = rows.map((r) => ({
    path: r.coupled_path,
    co_commits: r.co_commits,
    target_commits: r.target_commits,
    coupled_commits: r.coupled_commits,
    prob_coupled_given_target: r.prob_coupled_given_target,
    prob_target_given_coupled: r.prob_target_given_coupled,
    jaccard: r.jaccard,
    has_static_edge: r.has_static_edge === 1,
    hidden_coupling: r.has_static_edge === 0,
    recent_subjects: r.recent_subjects,
  }))

  const bannerLines: string[] = [
    `// Coupled files for ${normTarget} (${targetCommits} commits in window):`,
  ]
  for (const item of coupledFiles) {
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
    coupled_files: coupledFiles,
    warning_banner: bannerLines.join("\n"),
  }
}

/**
 * Formats temporal co-change warnings across one or more target file paths.
 */
export function renderCochangeWarnings(
  db: Database,
  targetPaths: string | readonly string[],
  options: QueryCochangeCouplingsOptions = {},
): string {
  const paths = typeof targetPaths === "string" ? [targetPaths] : targetPaths
  const sections: string[] = []
  for (const p of paths) {
    const res = queryCoupledFiles(db, p, {
      minProbability: options.minProbability ?? 0.3,
      minCochangeCount: options.minCochangeCount ?? options.minCoCommits ?? 2,
      onlyHidden: options.onlyHidden,
      limit: options.limit ?? 10,
    })
    if (res.coupled_files.length > 0) {
      sections.push(res.warning_banner)
    }
  }
  return sections.join("\n\n")
}
