// CSG-02 & CSG-03: Iterative Float64Array CSR PageRank, <1,000-token RepoMap & Git Co-Change Couplings
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { Database } from "bun:sqlite"
import {
  type GitCommitRecord,
  collectTypeScriptFiles,
  computeCodebasePageRank,
  computePageRank,
  ensureCochangeSchema,
  ensureCodeGraphSchema,
  indexCodebase,
  mineGitCoChange,
  mineGitCochange,
  queryCochangeCouplings,
  queryCoupledFiles,
  renderCochangeWarnings,
  renderRepoMap,
  renderTier1RepoMap,
  updateGitCoChangeIncremental,
} from "../src/honeycomb/index.ts"

const STEWARD_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
const SUBSTRATE_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-substrate"

describe("CSG-02 & CSG-03: PageRank RepoMap & Git Temporal Co-Change Couplings", () => {
  test("CSG-02: computeCodebasePageRank solves 20-iter CSR PageRank in < 2ms with SUM=1.0 and renderRepoMap packs < 1,000 tokens", () => {
    if (!existsSync(STEWARD_ROOT)) return
    const db = new Database(":memory:")
    try {
      const stewardPaths = collectTypeScriptFiles(STEWARD_ROOT, "src")
      indexCodebase(db, STEWARD_ROOT, stewardPaths)

      const pr = computeCodebasePageRank(db, { iterations: 20, damping: 0.85, persist: true })
      expect(pr.nodeCount).toBe(51)
      expect(pr.edgeCount).toBe(185)
      expect(pr.iterations).toBe(20)
      expect(pr.damping).toBe(0.85)
      expect(Math.abs(pr.totalMass - 1.0)).toBeLessThan(1e-6)
      expect(pr.maxResidual).toBeLessThan(1e-6)
      expect(pr.solveElapsedMs).toBeLessThan(2.0)

      // Verify persisted pagerank values in code_file
      const persistedRows = db
        .query("SELECT path, pagerank FROM code_file ORDER BY pagerank DESC")
        .all() as { path: string; pagerank: number }[]
      expect(persistedRows.length).toBe(51)
      expect(persistedRows[0]!.pagerank).toBeGreaterThan(0.1)

      // Core architectural files rank in the Top 10 out of 51 files
      const top10Paths = new Set(pr.nodes.slice(0, 10).map((n) => n.path))
      for (const expectedCore of [
        "src/acp.ts",
        "src/cross-os-platform.ts",
        "src/wire-dialect.ts",
        "src/acp-session-core.ts",
        "src/hosted/lane.ts",
        "src/engine-port.ts",
      ]) {
        expect(top10Paths.has(expectedCore)).toBe(true)
      }

      // Render Tier-1 RepoMap within default 1,000-token budget
      const repoMap = renderRepoMap(db, {
        budgetTokens: 1000,
        maxFiles: 25,
        maxSymbolsPerFile: 6,
      })
      expect(repoMap.total_files).toBe(51)
      expect(repoMap.included_files).toBeGreaterThanOrEqual(14)
      expect(repoMap.estimated_tokens).toBeLessThan(1000)
      expect(repoMap.estimated_tokens).toBeLessThanOrEqual(repoMap.token_budget)
      expect(repoMap.elapsed_ms).toBeLessThan(5.0)
      expect(repoMap.text).toContain("src/acp.ts")
      expect(repoMap.text).toContain("src/acp-session-core.ts")
      expect(repoMap.text).toContain("src/hosted/lane.ts")
      expect(repoMap.text).toContain("src/engine-port.ts")
      expect(repoMap.text).toMatch(/\[L\d+-L\d+\]/)

      // Verify focusPaths places focused file at rank 1
      const focusedMap = renderTier1RepoMap(db, {
        budgetTokens: 1000,
        focusPaths: ["src/delegation/native-delegation.ts"],
      })
      expect(focusedMap.entries[0]?.path).toBe("src/delegation/native-delegation.ts")
      expect(focusedMap.estimated_tokens).toBeLessThan(1000)
    } finally {
      db.close()
    }
  })

  test("CSG-03: mines git log -n 500 on hivemind-steward-oc-devin-dev, surfaces hidden couplings (has_static_edge=0), and skips already-indexed commit SHAs idempotently", () => {
    if (!existsSync(STEWARD_ROOT)) return
    const db = new Database(":memory:")
    try {
      const stewardPaths = collectTypeScriptFiles(STEWARD_ROOT, "src")
      indexCodebase(db, STEWARD_ROOT, stewardPaths)
      ensureCochangeSchema(db)

      const stats = mineGitCochange(db, STEWARD_ROOT, {
        maxCommits: 500,
        maxFilesPerCommit: 15,
      })

      expect(stats.commitsScanned).toBeGreaterThan(450)
      expect(stats.commitsAccepted).toBeGreaterThan(70)
      expect(stats.commitsSkippedBulk).toBeGreaterThanOrEqual(1)
      expect(stats.pairsPersisted).toBeGreaterThan(250)
      expect(stats.hiddenCouplingPairs).toBeGreaterThan(150)

      // Query queryCochangeCouplings for src/devin-executable.ts
      const rows = queryCochangeCouplings(db, "src/devin-executable.ts", {
        minProbability: 0.3,
        minCochangeCount: 2,
        limit: 10,
      })
      expect(rows.length).toBeGreaterThanOrEqual(5)

      const agy = rows.find((r) => r.coupled_path === "src/harness-antigravity.ts")
      expect(agy).toBeDefined()
      expect(agy!.co_commits).toBe(4)
      expect(agy!.target_commits).toBe(6)
      expect(agy!.coupled_commits).toBe(7)
      expect(Number((agy!.probability * 100).toFixed(1))).toBe(66.7)
      expect(agy!.has_static_edge).toBe(0)
      expect(agy!.hidden_coupling).toBe(true)
      expect(agy!.recent_subjects.length).toBeGreaterThanOrEqual(3)

      const acp = rows.find((r) => r.coupled_path === "src/acp.ts")
      expect(acp).toBeDefined()
      expect(acp!.co_commits).toBe(3)
      expect(acp!.target_commits).toBe(6)
      expect(acp!.coupled_commits).toBe(12)
      expect(Number((acp!.probability * 100).toFixed(1))).toBe(50.0)

      // Verify other real hidden cross-boundary couplings (has_static_edge = 0)
      const contractCoupled = queryCoupledFiles(db, "src/hosted-request-contract.ts", { onlyHidden: true })
      const setupSteps = contractCoupled.coupled_files.find((f) => f.path === "src/delegation/setup-steps.ts")
      expect(setupSteps).toBeDefined()
      expect(Number((setupSteps!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(setupSteps!.has_static_edge).toBe(false)

      // Verify renderCochangeWarnings output
      const warningsText = renderCochangeWarnings(
        db,
        ["src/devin-executable.ts", "src/hosted-request-contract.ts"],
        { minProbability: 0.3, minCochangeCount: 2 },
      )
      expect(warningsText).toContain("src/harness-antigravity.ts")
      expect(warningsText).toContain("HIDDEN COUPLING")
      expect(warningsText).toContain("src/delegation/setup-steps.ts")

      // Idempotent incremental run via both mineGitCochange({ range: "HEAD~1..HEAD" }) and updateGitCoChangeIncremental
      const incViaMine = mineGitCochange(db, STEWARD_ROOT, {
        range: "HEAD~1..HEAD",
        maxFilesPerCommit: 15,
      })
      expect(incViaMine.commitsScanned).toBe(1)
      expect(incViaMine.commitsApplied).toBe(0)
      expect(incViaMine.commitsSkippedExisting).toBe(1)

      const incViaUpdate = updateGitCoChangeIncremental(db, STEWARD_ROOT, "HEAD~1..HEAD", {
        forceReapply: false,
      })
      expect(incViaUpdate.commitsScanned).toBe(1)
      expect(incViaUpdate.commitsApplied).toBe(0)

      // Verify counts did not double-increment after idempotent runs
      const rowsAfter = queryCochangeCouplings(db, "src/devin-executable.ts", {
        minProbability: 0.3,
        minCochangeCount: 2,
      })
      const agyAfter = rowsAfter.find((r) => r.coupled_path === "src/harness-antigravity.ts")
      expect(agyAfter?.co_commits).toBe(4)
      expect(agyAfter?.target_commits).toBe(6)
    } finally {
      db.close()
    }
  })

  test("verifies WF-SUB-R03 reference topology, dangling sinks, bulk commit filtering (>15 files), and asymmetric co-change ratios", () => {
    const db = new Database(":memory:")
    try {
      ensureCodeGraphSchema(db)
      ensureCochangeSchema(db)

      const files = [
        "src/engine-port.ts",
        "src/hosted/lane.ts",
        "src/acp-session-core.ts",
        "src/acp.ts",
        "src/cross-os-platform.ts",
        "src/wire-dialect.ts",
        "src/devin-executable.ts",
        "src/harness-antigravity.ts",
        "src/delegation/model-slots.ts",
        "src/hosted/commands.ts",
        "src/delegation/delegate-config.ts",
        "src/hosted/harness.ts",
      ]
      for (let i = 1; i <= 25; i++) {
        files.push(`src/caller-${i}.ts`)
      }

      const insertFile = db.query(
        "INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at) VALUES (?, 'sha', 100, 500, 50, '', 0, 1)",
      )
      for (const f of files) insertFile.run(f)

      const insertEdge = db.query(
        "INSERT INTO code_import_edge (from_path, to_path, specifier, symbols_json, specifiers_json) VALUES (?, ?, './mod', '[\"sym\"]', '[\"sym\"]')",
      )
      const inDegreeSpec: [string, number][] = [
        ["src/engine-port.ts", 22],
        ["src/hosted/lane.ts", 14],
        ["src/acp-session-core.ts", 13],
        ["src/acp.ts", 10],
        ["src/cross-os-platform.ts", 9],
        ["src/wire-dialect.ts", 8],
      ]
      for (const [target, count] of inDegreeSpec) {
        for (let i = 1; i <= count; i++) {
          insertEdge.run(`src/caller-${i}.ts`, target)
        }
      }
      insertEdge.run("src/devin-executable.ts", "src/acp.ts")

      const pr = computePageRank(db, { iterations: 20, damping: 0.85, persist: true })
      expect(Math.abs(pr.totalMass - 1.0)).toBeLessThan(1e-6)
      expect(pr.nodes.slice(0, 6).map((n) => n.path)).toEqual([
        "src/engine-port.ts",
        "src/hosted/lane.ts",
        "src/acp-session-core.ts",
        "src/acp.ts",
        "src/cross-os-platform.ts",
        "src/wire-dialect.ts",
      ])

      const commits: GitCommitRecord[] = []
      let seq = 1
      // Add 1 bulk commit touching 20 files (> 15 threshold)
      commits.push({
        hash: `bulk-${seq++}`,
        subject: "chore: bulk format 20 files",
        files: Array.from({ length: 20 }, (_, idx) => `src/caller-${idx + 1}.ts`),
      })
      for (let i = 0; i < 18; i++) {
        const cFiles = ["src/devin-executable.ts"]
        if (i < 12) cFiles.push("src/harness-antigravity.ts")
        if (i < 9) cFiles.push("src/acp.ts")
        commits.push({
          hash: `c-${seq++}`,
          subject: `feat(harness): sync executable & antigravity contract #${i + 1}`,
          files: cFiles,
        })
      }
      for (let i = 0; i < 6; i++) {
        commits.push({
          hash: `c-${seq++}`,
          subject: `fix(agy): standalone antigravity update #${i + 1}`,
          files: ["src/harness-antigravity.ts"],
        })
      }
      for (let i = 0; i < 9; i++) {
        commits.push({
          hash: `c-${seq++}`,
          subject: `fix(acp): standalone acp update #${i + 1}`,
          files: ["src/acp.ts"],
        })
      }
      for (let i = 0; i < 9; i++) {
        const cFiles = ["src/delegation/model-slots.ts"]
        if (i < 6) cFiles.push("src/hosted/commands.ts")
        commits.push({
          hash: `c-${seq++}`,
          subject: `feat(slots): sync model-slots with TUI slash commands #${i + 1}`,
          files: cFiles,
        })
      }
      for (let i = 0; i < 3; i++) {
        commits.push({
          hash: `c-${seq++}`,
          subject: `fix(commands): standalone commands update #${i + 1}`,
          files: ["src/hosted/commands.ts"],
        })
      }
      for (let i = 0; i < 11; i++) {
        const cFiles = ["src/delegation/delegate-config.ts"]
        if (i < 6) cFiles.push("src/hosted/harness.ts")
        commits.push({
          hash: `c-${seq++}`,
          subject: `feat(config): sync delegate-config and hosted harness #${i + 1}`,
          files: cFiles,
        })
      }
      for (let i = 0; i < 5; i++) {
        commits.push({
          hash: `c-${seq++}`,
          subject: `fix(harness): standalone hosted harness update #${i + 1}`,
          files: ["src/hosted/harness.ts"],
        })
      }

      const mineStats = mineGitCoChange(db, {
        commitsOverride: commits,
        maxFilesPerCommit: 15,
        pathPrefix: "src/",
      })
      expect(mineStats.commitsSkippedBulk).toBe(1)

      const devinCoupled = queryCochangeCouplings(db, "src/devin-executable.ts")
      expect(devinCoupled[0]!.coupled_path).toBe("src/harness-antigravity.ts")
      expect(devinCoupled[0]!.co_commits).toBe(12)
      expect(devinCoupled[0]!.target_commits).toBe(18)
      expect(Number((devinCoupled[0]!.probability * 100).toFixed(1))).toBe(66.7)
      expect(Number(devinCoupled[0]!.jaccard.toFixed(2))).toBe(0.5)
      expect(devinCoupled[0]!.has_static_edge).toBe(0)

      expect(devinCoupled[1]!.coupled_path).toBe("src/acp.ts")
      expect(devinCoupled[1]!.co_commits).toBe(9)
      expect(devinCoupled[1]!.target_commits).toBe(18)
      expect(Number((devinCoupled[1]!.probability * 100).toFixed(1))).toBe(50.0)
      expect(devinCoupled[1]!.has_static_edge).toBe(1)
    } finally {
      db.close()
    }
  })

  test("indexes and ranks hivemind-substrate/src/ and mines its git co-change history", () => {
    const db = new Database(":memory:")
    try {
      const paths = collectTypeScriptFiles(SUBSTRATE_ROOT, "src")
      const stats = indexCodebase(db, SUBSTRATE_ROOT, paths)
      const pr = computeCodebasePageRank(db)
      expect(pr.nodeCount).toBe(stats.totalFiles)
      expect(Math.abs(pr.totalMass - 1.0)).toBeLessThan(1e-6)

      const map = renderRepoMap(db, { budgetTokens: 1000 })
      expect(map.included_files).toBeGreaterThanOrEqual(7)
      expect(map.estimated_tokens).toBeLessThan(1000)

      const coStats = mineGitCochange(db, SUBSTRATE_ROOT, { maxCommits: 100, maxFilesPerCommit: 15 })
      expect(coStats.commitsScanned).toBeGreaterThanOrEqual(1)

      // T-6: calling mineGitCochange(db, { maxCommits: 10 }) with no repoRoot defaults to process.cwd()
      const cwdDb = new Database(":memory:")
      try {
        const cwdStats = mineGitCochange(cwdDb, { maxCommits: 10 })
        expect(cwdStats.commitsScanned).toBeGreaterThanOrEqual(1)
      } finally {
        cwdDb.close()
      }
    } finally {
      db.close()
    }
  })
})

