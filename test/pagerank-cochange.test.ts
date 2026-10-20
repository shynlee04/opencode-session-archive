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
    if (process.env.SUBSTRATE_EXTERNAL !== "1") return
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
    if (process.env.SUBSTRATE_EXTERNAL !== "1") return
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
      expect(stats.commitsAccepted).toBeGreaterThanOrEqual(65)
      expect(stats.commitsSkippedBulk).toBeGreaterThanOrEqual(15)
      expect(stats.pairsPersisted).toBeGreaterThan(100)
      expect(stats.hiddenCouplingPairs).toBeGreaterThan(50)

      // Query queryCochangeCouplings for src/devin-executable.ts
      const rows = queryCochangeCouplings(db, "src/devin-executable.ts", {
        minProbability: 0.3,
        minCochangeCount: 2,
        limit: 10,
      })
      expect(rows.length).toBeGreaterThanOrEqual(2)

      const acp = rows.find((r) => r.coupled_path === "src/acp.ts")
      expect(acp).toBeDefined()
      expect(acp!.co_commits).toBe(2)
      expect(acp!.target_commits).toBe(3)
      expect(acp!.coupled_commits).toBe(9)
      expect(Number((acp!.probability * 100).toFixed(1))).toBe(66.7)

      const engineLaunch = rows.find((r) => r.coupled_path === "src/engine-launch.ts")
      expect(engineLaunch).toBeDefined()
      expect(engineLaunch!.co_commits).toBe(2)
      expect(engineLaunch!.target_commits).toBe(3)
      expect(Number((engineLaunch!.probability * 100).toFixed(1))).toBe(66.7)

      // Verify real hidden cross-boundary couplings (has_static_edge = 0)
      const contractCoupled = queryCoupledFiles(db, "src/hosted-request-contract.ts", { onlyHidden: true })
      const setupSteps = contractCoupled.coupled_files.find((f) => f.path === "src/delegation/setup-steps.ts")
      expect(setupSteps).toBeDefined()
      expect(Number((setupSteps!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(setupSteps!.has_static_edge).toBe(false)

      const cfgCoupled = queryCoupledFiles(db, "src/delegation/delegate-config.ts", { onlyHidden: true })
      const nativeDelegation = cfgCoupled.coupled_files.find((f) => f.path === "src/delegation/native-delegation.ts")
      expect(nativeDelegation).toBeDefined()
      expect(Number((nativeDelegation!.prob_coupled_given_target * 100).toFixed(1))).toBe(50.0)
      expect(nativeDelegation!.has_static_edge).toBe(false)

      // Verify renderCochangeWarnings output
      const warningsText = renderCochangeWarnings(
        db,
        ["src/delegation/delegate-config.ts", "src/hosted-request-contract.ts"],
        { minProbability: 0.3, minCochangeCount: 2 },
      )
      expect(warningsText).toContain("src/delegation/native-delegation.ts")
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
      const acpAfter = rowsAfter.find((r) => r.coupled_path === "src/acp.ts")
      expect(acpAfter?.co_commits).toBe(2)
      expect(acpAfter?.target_commits).toBe(3)
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

  test("CSG-R2 S2-5: 21-file commit (14 in src/, 7 outside src/) is skipped as bulk when maxFilesPerCommit=15 and pathPrefix='src/' and queryCoupledFiles normalizes absolute paths", async () => {
    const { parseGitLogOutput } = await import("../src/honeycomb/cochange.ts")
    const db = new Database(":memory:")
    try {
      ensureCodeGraphSchema(db)
      ensureCochangeSchema(db)

      const rawLog = [
        "COMMIT:init21hash|chore: initial 21-file scaffold",
        ...Array.from({ length: 14 }, (_, idx) => `src/mod-${idx + 1}.ts`),
        ...Array.from({ length: 7 }, (_, idx) => `test/mod-${idx + 1}.test.ts`),
        "COMMIT:focused1|feat: focused pair #1",
        "src/mod-1.ts",
        "src/mod-2.ts",
        "COMMIT:focused2|feat: focused pair #2",
        "src/mod-1.ts",
        "src/mod-2.ts",
      ].join("\n")

      const parsed = parseGitLogOutput(rawLog)
      expect(parsed.length).toBe(3)
      expect((parsed[0] as unknown as { totalRawFilesCount?: number }).totalRawFilesCount).toBe(21)

      const stats = mineGitCoChange(db, {
        commitsOverride: parsed,
        maxFilesPerCommit: 15,
        pathPrefix: "src/",
      })
      expect(stats.commitsScanned).toBe(3)
      expect(stats.commitsSkippedBulk).toBe(1)
      expect(stats.commitsAccepted).toBe(2)

      // mod-3..mod-14 from the 21-file bulk commit must NOT have false co-change links
      const mod3Coupled = queryCoupledFiles(db, "src/mod-3.ts", { minCochangeCount: 1, minProbability: 0.1 })
      expect(mod3Coupled.coupled_files.length).toBe(0)

      // Absolute path inside repoRoot resolves cleanly in queryCoupledFiles
      const absMod1 = `${SUBSTRATE_ROOT}/src/mod-1.ts`
      const mod1Coupled = queryCoupledFiles(db, absMod1, {
        repoRoot: SUBSTRATE_ROOT,
        minCochangeCount: 2,
        minProbability: 0.5,
      } as Parameters<typeof queryCoupledFiles>[2] & { repoRoot?: string })
      expect(mod1Coupled.path).toBe("src/mod-1.ts")
      expect(mod1Coupled.coupled_files.length).toBe(1)
      expect(mod1Coupled.coupled_files[0]!.path).toBe("src/mod-2.ts")
      expect(mod1Coupled.coupled_files[0]!.co_commits).toBe(2)
    } finally {
      db.close()
    }
  })

  test("CSG-R2 A1 & A4: queryMudballAdvisor surfaces god_file, god_symbol, high_coupling_hub, hidden_coupling hotspots and token compression metrics, and enriches renderTier1RepoMap", async () => {
    const pagerankMod = (await import("../src/honeycomb/pagerank.ts")) as Record<string, unknown>
    expect(typeof pagerankMod.queryMudballAdvisor).toBe("function")
    const queryMudballAdvisor = pagerankMod.queryMudballAdvisor as (
      db: Database,
      options?: { topKFiles?: number; maxOutlineSymbolsPerFile?: number },
    ) => {
      totalFiles: number
      totalSymbols: number
      rawTokensTotal: number
      skeletonTokensTotal: number
      tokensSavedTotal: number
      compressionPct: number
      topFiles: readonly {
        filePath: string
        score: number
        rank: number
        inDegree: number
        outDegree: number
        lineCount: number
        rawTokens: number
        skeletonTokens: number
        symbolsCount: number
        exportedSymbols: readonly {
          name: string
          kind: string
          startLine: number
          endLine: number
          lineSpan: number
          signature: string
        }[]
      }[]
      hotspots: readonly {
        kind: "god_file" | "god_symbol" | "high_coupling_hub" | "hidden_coupling"
        severity: "warn" | "high"
        target: string
        detail: string
        metric: string
      }[]
    }

    const db = new Database(":memory:")
    try {
      const paths = collectTypeScriptFiles(SUBSTRATE_ROOT, "src")
      indexCodebase(db, SUBSTRATE_ROOT, paths)
      computeCodebasePageRank(db)
      mineGitCochange(db, SUBSTRATE_ROOT, { maxCommits: 100, maxFilesPerCommit: 15 })

      const report = queryMudballAdvisor(db, { topKFiles: 5, maxOutlineSymbolsPerFile: 4 })
      expect(report.totalFiles).toBe(paths.length)
      expect(report.totalSymbols).toBeGreaterThan(50)
      expect(report.rawTokensTotal).toBeGreaterThan(report.skeletonTokensTotal)
      expect(report.tokensSavedTotal).toBe(report.rawTokensTotal - report.skeletonTokensTotal)
      expect(report.compressionPct).toBeGreaterThan(80)
      expect(report.topFiles.length).toBe(5)
      expect(report.topFiles[0]!.rank).toBe(1)
      expect(report.topFiles[0]!.exportedSymbols.length).toBeGreaterThan(0)

      const kinds = new Set(report.hotspots.map((h) => h.kind))
      expect(kinds.has("god_file")).toBe(true)
      expect(kinds.has("god_symbol")).toBe(true)
      expect(kinds.has("high_coupling_hub")).toBe(true)

      const map = renderTier1RepoMap(db, { budgetTokens: 1000 })
      expect(map.text).toContain("### Mudball & Architecture Advisor")
      expect(map.estimated_tokens).toBeLessThan(1000)
    } finally {
      db.close()
    }
  })
})


