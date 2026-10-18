// PROTOTYPE TEST: WF-SUB-06 Iterative PageRank RepoMap & Git Temporal Co-Change Coupling Warnings
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  type CoupledViewportResult,
  type GitCommitRecord,
  type Tier1RepoMapView,
  computePageRank,
  copyCodeGraphDatabase,
  ensureWfSub06Schema,
  mineGitCoChange,
  queryCoupledFiles,
  renderTier1RepoMap,
  updateGitCoChangeIncremental,
  viewport,
} from "./wf-sub-06-repomap-cochange"

const STEWARD_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
const SUBSTRATE_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-substrate"
const SRC_DB_PATH = path.join(SUBSTRATE_ROOT, "scratch/prototypes/data/wf-sub-05-codegraph.sqlite")
const DST_DB_PATH = path.join(SUBSTRATE_ROOT, "scratch/prototypes/data/wf-sub-06-codegraph.sqlite")

function fileSha256(filePath: string): string {
  const bytes = readFileSync(filePath)
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
}

describe("WF-SUB-06: Iterative PageRank RepoMap & Git Temporal Co-Change Coupling Warnings", () => {
  test("copies wf-sub-05-codegraph.sqlite to wf-sub-06-codegraph.sqlite without mutating wf-sub-05-codegraph.sqlite, solves 20-iter PageRank, and renders < 1,000-token Tier-1 RepoMap", () => {
    const wf05ShaBefore = fileSha256(SRC_DB_PATH)
    copyCodeGraphDatabase(SRC_DB_PATH, DST_DB_PATH)

    const db = new Database(DST_DB_PATH)
    try {
      const pr = computePageRank(db, { iterations: 20, damping: 0.85, persist: true })
      expect(pr.nodeCount).toBe(51)
      expect(pr.edgeCount).toBe(185)
      expect(pr.iterations).toBe(20)
      expect(pr.damping).toBe(0.85)
      expect(Math.abs(pr.totalMass - 1.0)).toBeLessThan(1e-9)
      expect(pr.maxResidual).toBeLessThan(1e-6)

      // Verify persisted pagerank values in code_file
      const persistedRows = db
        .query("SELECT path, pagerank FROM code_file ORDER BY pagerank DESC")
        .all() as { path: string; pagerank: number }[]
      expect(persistedRows.length).toBe(51)
      expect(persistedRows[0]!.pagerank).toBeGreaterThan(0.1)

      // All 6 core architectural files rank in the Top 9 out of 51 files
      const top9Paths = new Set(pr.nodes.slice(0, 9).map((n) => n.path))
      for (const expectedCore of [
        "src/acp.ts",
        "src/cross-os-platform.ts",
        "src/wire-dialect.ts",
        "src/acp-session-core.ts",
        "src/hosted/lane.ts",
        "src/engine-port.ts",
      ]) {
        expect(top9Paths.has(expectedCore)).toBe(true)
      }

      // Render Tier-1 RepoMap and verify < 1,000 token budget + [Lstart-Lend] spans
      const repoMap = renderTier1RepoMap(db, { tokenBudget: 950, maxFiles: 22, maxSymbolsPerFile: 5 })
      expect(repoMap.total_files).toBe(51)
      expect(repoMap.included_files).toBeGreaterThanOrEqual(15)
      expect(repoMap.estimated_tokens).toBeLessThan(1000)
      expect(repoMap.estimated_tokens).toBeLessThanOrEqual(repoMap.token_budget)
      expect(repoMap.text).toContain("src/acp.ts")
      expect(repoMap.text).toContain("src/acp-session-core.ts")
      expect(repoMap.text).toContain("src/hosted/lane.ts")
      expect(repoMap.text).toContain("src/engine-port.ts")
      expect(repoMap.text).toMatch(/\[L\d+-L\d+\]/)

      // Verify viewport({ action: "repomap" }) dispatcher
      const viaViewport = viewport(db, { action: "repomap", tokenBudget: 950 }) as Tier1RepoMapView
      expect(viaViewport.estimated_tokens).toBe(repoMap.estimated_tokens)
      expect(viaViewport.entries.length).toBe(repoMap.entries.length)

      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } finally {
      db.close()
    }

    const wf05ShaAfter = fileSha256(SRC_DB_PATH)
    expect(wf05ShaAfter).toBe(wf05ShaBefore)
  })

  test("mines git log -n 500 on hivemind-steward-oc-devin-dev and surfaces src/harness-antigravity.ts (66.7%, 0 static edges) and src/acp.ts (50.0%) for src/devin-executable.ts", () => {
    const db = new Database(DST_DB_PATH)
    try {
      const stats = mineGitCoChange(db, {
        repoRoot: STEWARD_ROOT,
        maxCommits: 500,
        maxFilesPerCommit: 15,
        pathPrefix: "src/",
      })

      expect(stats.commitsScanned).toBeGreaterThan(450)
      expect(stats.commitsAccepted).toBeGreaterThan(70)
      expect(stats.commitsSkippedBulk).toBeGreaterThanOrEqual(1)
      expect(stats.pairsPersisted).toBeGreaterThan(250)
      expect(stats.hiddenCouplingPairs).toBeGreaterThan(150)

      // Query viewport({ action: "coupled", path: "src/devin-executable.ts" })
      const coupled = viewport(db, {
        action: "coupled",
        path: "src/devin-executable.ts",
      }) as CoupledViewportResult

      expect(coupled.action).toBe("coupled")
      expect(coupled.path).toBe("src/devin-executable.ts")
      expect(coupled.total_commits).toBe(6)
      expect(coupled.coupled_files.length).toBeGreaterThanOrEqual(5)

      // #1 coupled file is src/harness-antigravity.ts with P = 66.7% (4/6) and 0 static import edges
      const agy = coupled.coupled_files.find((f) => f.path === "src/harness-antigravity.ts")
      expect(agy).toBeDefined()
      expect(agy!.co_commits).toBe(4)
      expect(agy!.target_commits).toBe(6)
      expect(agy!.coupled_commits).toBe(7)
      expect(Number((agy!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(agy!.has_static_edge).toBe(false)
      expect(agy!.hidden_coupling).toBe(true)
      expect(agy!.recent_subjects.length).toBeGreaterThanOrEqual(3)
      expect(agy!.recent_subjects.some((s) => s.includes("MH-28") || s.includes("SET-05"))).toBe(true)

      // #2 coupled file is src/acp.ts with P = 50.0% (3/6)
      const acp = coupled.coupled_files.find((f) => f.path === "src/acp.ts")
      expect(acp).toBeDefined()
      expect(acp!.co_commits).toBe(3)
      expect(acp!.target_commits).toBe(6)
      expect(acp!.coupled_commits).toBe(12)
      expect(Number((acp!.prob_coupled_given_target * 100).toFixed(1))).toBe(50.0)
      expect(acp!.recent_subjects.length).toBe(3)

      // Verify other real hidden cross-boundary couplings (has_static_edge = 0) in steward
      const contractCoupled = queryCoupledFiles(db, "src/hosted-request-contract.ts", { onlyHidden: true })
      const setupSteps = contractCoupled.coupled_files.find((f) => f.path === "src/delegation/setup-steps.ts")
      expect(setupSteps).toBeDefined()
      expect(Number((setupSteps!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(setupSteps!.has_static_edge).toBe(false)

      const harnessCoupled = queryCoupledFiles(db, "src/hosted/harness.ts", { onlyHidden: true })
      const delegateConfig = harnessCoupled.coupled_files.find(
        (f) => f.path === "src/delegation/delegate-config.ts",
      )
      expect(delegateConfig).toBeDefined()
      expect(delegateConfig!.co_commits).toBe(2)
      expect(Number((delegateConfig!.prob_coupled_given_target * 100).toFixed(1))).toBe(40.0)
      expect(delegateConfig!.has_static_edge).toBe(false)

      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } finally {
      db.close()
    }
  })

  test("verifies WF-SUB-R03 reference topology & hidden co-change ratios (12/18 = 66.7%, 9/18 = 50.0%, 6/9 = 66.7%, 6/11 = 54.5%)", () => {
    const db = new Database(":memory:")
    try {
      ensureWfSub06Schema(db)

      // Insert synthetic code_file nodes and static import edges matching WF-SUB-R03 section 4
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
        "INSERT INTO code_import_edge (from_path, to_path, specifiers_json) VALUES (?, ?, '[\"sym\"]')",
      )
      // Give in-degrees: engine-port (22), hosted/lane (14), acp-session-core (13), acp (10), cross-os-platform (9), wire-dialect (8)
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
      // Static edge between devin-executable and acp, but NO static edge for the 3 hidden pairs
      insertEdge.run("src/devin-executable.ts", "src/acp.ts")

      const pr = computePageRank(db, { iterations: 20, damping: 0.85, persist: true })
      expect(pr.nodes.slice(0, 6).map((n) => n.path)).toEqual([
        "src/engine-port.ts",
        "src/hosted/lane.ts",
        "src/acp-session-core.ts",
        "src/acp.ts",
        "src/cross-os-platform.ts",
        "src/wire-dialect.ts",
      ])

      // Construct commit history matching WF-SUB-R03 exact counts:
      // 1. src/devin-executable.ts (18 commits): shares 12 with src/harness-antigravity.ts (18 commits, P=66.7%, Jaccard=0.50, has_static_edge=0)
      //    and shares 9 with src/acp.ts (18 commits, P=50.0%, has_static_edge=1)
      // 2. src/delegation/model-slots.ts (9 commits) <-> src/hosted/commands.ts (9 commits): shares 6 (P=66.7%, has_static_edge=0)
      // 3. src/delegation/delegate-config.ts (11 commits) <-> src/hosted/harness.ts (11 commits): shares 6 (P=54.5%, has_static_edge=0)
      const commits: GitCommitRecord[] = []
      let seq = 1
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

      mineGitCoChange(db, { commitsOverride: commits, maxFilesPerCommit: 15, pathPrefix: "src/" })

      const devinCoupled = queryCoupledFiles(db, "src/devin-executable.ts")
      expect(devinCoupled.coupled_files[0]!.path).toBe("src/harness-antigravity.ts")
      expect(devinCoupled.coupled_files[0]!.co_commits).toBe(12)
      expect(devinCoupled.coupled_files[0]!.target_commits).toBe(18)
      expect(Number((devinCoupled.coupled_files[0]!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(Number(devinCoupled.coupled_files[0]!.jaccard.toFixed(2))).toBe(0.5)
      expect(devinCoupled.coupled_files[0]!.has_static_edge).toBe(false)

      expect(devinCoupled.coupled_files[1]!.path).toBe("src/acp.ts")
      expect(devinCoupled.coupled_files[1]!.co_commits).toBe(9)
      expect(devinCoupled.coupled_files[1]!.target_commits).toBe(18)
      expect(Number((devinCoupled.coupled_files[1]!.prob_coupled_given_target * 100).toFixed(1))).toBe(50.0)
      expect(devinCoupled.coupled_files[1]!.has_static_edge).toBe(true)

      const slotsCoupled = queryCoupledFiles(db, "src/delegation/model-slots.ts")
      expect(slotsCoupled.coupled_files[0]!.path).toBe("src/hosted/commands.ts")
      expect(slotsCoupled.coupled_files[0]!.co_commits).toBe(6)
      expect(slotsCoupled.coupled_files[0]!.target_commits).toBe(9)
      expect(Number((slotsCoupled.coupled_files[0]!.prob_coupled_given_target * 100).toFixed(1))).toBe(66.7)
      expect(slotsCoupled.coupled_files[0]!.has_static_edge).toBe(false)

      const configCoupled = queryCoupledFiles(db, "src/delegation/delegate-config.ts")
      expect(configCoupled.coupled_files[0]!.path).toBe("src/hosted/harness.ts")
      expect(configCoupled.coupled_files[0]!.co_commits).toBe(6)
      expect(configCoupled.coupled_files[0]!.target_commits).toBe(11)
      expect(Number((configCoupled.coupled_files[0]!.prob_coupled_given_target * 100).toFixed(1))).toBe(54.5)
      expect(configCoupled.coupled_files[0]!.has_static_edge).toBe(false)
    } finally {
      db.close()
    }
  })

  test("supports idempotent HEAD~1..HEAD incremental co-change updates and meets latency budgets across 7 samples", () => {
    const db = new Database(DST_DB_PATH)
    try {
      // Idempotent skip when HEAD is already indexed
      const skipInc = updateGitCoChangeIncremental(db, STEWARD_ROOT, "HEAD~1..HEAD", {
        forceReapply: false,
      })
      expect(skipInc.commitsScanned).toBe(1)
      expect(skipInc.commitsApplied).toBe(0)

      // 7-sample benchmark for PageRank, renderTier1RepoMap, and incremental HEAD~1..HEAD update
      const prSamples: number[] = []
      const mapSamples: number[] = []
      const incSamples: number[] = []

      for (let i = 0; i < 7; i++) {
        const prRes = computePageRank(db, { iterations: 20, damping: 0.85, persist: true })
        prSamples.push(prRes.totalElapsedMs)

        const mapRes = renderTier1RepoMap(db, { tokenBudget: 950, maxFiles: 22, maxSymbolsPerFile: 5 })
        mapSamples.push(mapRes.elapsed_ms)

        const incRes = updateGitCoChangeIncremental(db, STEWARD_ROOT, "HEAD~1..HEAD", {
          forceReapply: true,
        })
        incSamples.push(incRes.totalElapsedMs)
      }

      const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[3]!
      expect(median(prSamples)).toBeLessThan(10)
      expect(median(mapSamples)).toBeLessThan(10)
      expect(median(incSamples)).toBeLessThan(50)

      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } finally {
      db.close()
    }
  })
})
