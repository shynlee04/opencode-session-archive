import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { sha256Hex } from "../src/archive/primitives.ts"
import { ensureCodeGraphSchema, indexCodebase } from "../src/honeycomb/ast-skeleton.ts"
import { ensureCochangeSchema } from "../src/honeycomb/cochange.ts"
import { computeCodebasePageRank } from "../src/honeycomb/pagerank.ts"
import { buildImplementorViewportBrief } from "../src/viewports/brief.ts"
import { ensureContinuitySchema, shortBlobRef } from "../src/viewports/continuity.ts"

const TEST_SESSION_ID = "ses_brief_fixture_root"

describe("VSC-03 / VSC-R1: Cross-Harness Implementor Viewport Brief Helper (buildImplementorViewportBrief)", () => {
  let tmpRoot: string
  let db: Database

  beforeAll(() => {
    tmpRoot = join(tmpdir(), `hivemind-brief-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src", "delegation"), { recursive: true })

    const driverSource = [
      "export class NativeDelegationDriver {",
      "  async turnStream(sessionId: string, prompt: string): Promise<string> {",
      "    return `${sessionId}:${prompt}`",
      "  }",
      "}",
      "",
      "export function createNativeDelegationDriver(): NativeDelegationDriver {",
      "  return new NativeDelegationDriver()",
      "}",
      "",
    ].join("\n")

    const execSource = [
      "import { createNativeDelegationDriver } from './delegation/native-delegation.ts'",
      "",
      "export async function runDevinExecutable(input: string): Promise<string> {",
      "  const driver = createNativeDelegationDriver()",
      "  return driver.turnStream('ses_1', input)",
      "}",
      "",
    ].join("\n")

    const antigravitySource = [
      "export function bridgeAntigravitySeat(seatId: string): string {",
      "  return `seat:${seatId}`",
      "}",
      "",
    ].join("\n")

    writeFileSync(join(tmpRoot, "src/delegation/native-delegation.ts"), driverSource, "utf8")
    writeFileSync(join(tmpRoot, "src/devin-executable.ts"), execSource, "utf8")
    writeFileSync(join(tmpRoot, "src/harness-antigravity.ts"), antigravitySource, "utf8")

    db = new Database(":memory:")
    ensureContinuitySchema(db)
    ensureCodeGraphSchema(db)
    ensureCochangeSchema(db)

    indexCodebase(db, tmpRoot)
    computeCodebasePageRank(db)

    db.prepare(`
      INSERT INTO session (
        id, root_id, project_id, depth, lane_kind, lane_path, title, harness, t_created, t_updated
      ) VALUES (?, ?, 'proj_brief', 0, 'root', '', 'Brief Test Session', 'opencode', 1000, 2000)
    `).run(TEST_SESSION_ID, TEST_SESSION_ID)

    const driverSha = sha256Hex(driverSource)
    db.prepare(`
      INSERT INTO provenance_chain (
        chain_id, root_session_id, finding_id, finding_summary, child_session_id,
        decision_pivot_seq, target_path, read_or_review_blob_sha, repair_blob_sha,
        verification_command, verification_exit_code, verification_blob_ref,
        disk_blob_sha, staleness_status, updated_at
      ) VALUES (
        'chain_driver_seam', ?, 'F-MH28-DRIVER-SEAM',
        'NativeDelegationDriver couples catalog observation and stream admission',
        'ses_child_1', 4, 'src/delegation/native-delegation.ts',
        ?, ?, 'bun test', 0, ?, ?, 'VERIFIED_FRESH', '2026-10-18T00:00:00Z'
      )
    `).run(TEST_SESSION_ID, driverSha, driverSha, shortBlobRef(driverSha), driverSha)

    db.prepare(`
      INSERT INTO git_cochange (
        file_a, file_b, co_commits, commits_a, commits_b,
        prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
      ) VALUES (
        'src/delegation/native-delegation.ts', 'src/harness-antigravity.ts',
        6, 8, 6, 0.75, 1.0, 0.75, 0, '["align native delegation and antigravity harness"]'
      )
    `).run()
  })

  afterAll(() => {
    db?.close()
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  })

  test("1. REQ-SUB-18: packs Tier-1 RepoMap, Tier-2 AstSkeleton, Tier-3 SymbolSlice, Tier-4 CoChangeCoupling (has_static_edge=0), and ProvenanceChain constraints within default 1,500 tokens in < 5 ms", () => {
    const t0 = performance.now()
    const brief = buildImplementorViewportBrief(db, {
      targetPaths: ["src/delegation/native-delegation.ts", "src/devin-executable.ts"],
      symbolNames: ["NativeDelegationDriver.turnStream"],
      sessionID: TEST_SESSION_ID,
      rootDir: tmpRoot,
      maxTokens: 1500,
    })
    const elapsedMs = performance.now() - t0

    expect(elapsedMs).toBeLessThan(15.0)
    expect(brief.elapsedMs).toBeLessThan(5.0)
    expect(brief.tokenEstimate).toBeLessThanOrEqual(1500)
    expect(Math.ceil(brief.markdown.length / 4)).toBeLessThanOrEqual(1500)
    expect(brief.estimatedTokens).toBe(brief.tokenEstimate)
    expect(brief.withinBudget).toBe(true)

    expect(brief.targetPaths).toEqual([
      "src/delegation/native-delegation.ts",
      "src/devin-executable.ts",
    ])
    expect(brief.includedSymbols).toContain("NativeDelegationDriver.turnStream")
    expect(brief.coupledWarnings).toBeGreaterThanOrEqual(1)
    expect(brief.provenanceChains).toBeGreaterThanOrEqual(1)

    expect(brief.markdown).toContain("Tier-1 RepoMap")
    expect(brief.markdown).toContain("src/delegation/native-delegation.ts")
    expect(brief.markdown).toContain("src/devin-executable.ts")
    expect(brief.markdown).toContain("NativeDelegationDriver.turnStream")
    expect(brief.markdown).toContain("src/harness-antigravity.ts")
    expect(brief.markdown).toContain("HIDDEN")
    expect(brief.markdown).toContain("F-MH28-DRIVER-SEAM")
  })

  test("2. REQ-SUB-18: supports alias option shapes (writeLeasePaths, focusSymbols, projectRoot, maxTokensBudget, goal, verificationCommand)", () => {
    const brief = buildImplementorViewportBrief(db, {
      projectRoot: tmpRoot,
      sessionID: TEST_SESSION_ID,
      goal: "Isolate native delegation admission stream error handling",
      writeLeasePaths: ["src/delegation/native-delegation.ts", "src/devin-executable.ts"],
      focusSymbols: [
        {
          path: "src/delegation/native-delegation.ts",
          symbol: "NativeDelegationDriver.turnStream",
        },
      ],
      verificationCommand: "bun test && bun run typecheck",
      maxTokensBudget: 1800,
    })

    expect(brief.tokenEstimate).toBeLessThanOrEqual(1800)
    expect(Math.ceil(brief.markdown.length / 4)).toBeLessThanOrEqual(1800)
    expect(brief.goal).toBe("Isolate native delegation admission stream error handling")
    expect(brief.verificationCommand).toBe("bun test && bun run typecheck")
    expect(brief.markdown).toContain("Isolate native delegation admission stream error handling")
    expect(brief.markdown).toContain("bun test && bun run typecheck")
    expect(brief.includedSymbols).toContain("NativeDelegationDriver.turnStream")
    expect(brief.coupledWarnings).toBeGreaterThan(0)
    expect(brief.provenanceChains).toBeGreaterThan(0)
  })

  test("3. REQ-SUB-18: enforces strict token ceiling via deterministic truncation under tight token budgets", () => {
    for (const tightBudget of [400, 650, 900, 1200]) {
      const brief = buildImplementorViewportBrief(db, {
        targetPaths: [
          "src/delegation/native-delegation.ts",
          "src/devin-executable.ts",
          "src/harness-antigravity.ts",
        ],
        symbolNames: ["NativeDelegationDriver.turnStream"],
        sessionID: TEST_SESSION_ID,
        rootDir: tmpRoot,
        maxTokens: tightBudget,
      })

      expect(brief.tokenEstimate).toBeLessThanOrEqual(tightBudget)
      expect(Math.ceil(brief.markdown.length / 4)).toBeLessThanOrEqual(tightBudget)
      expect(brief.withinBudget).toBe(true)
      expect(brief.markdown.length).toBeGreaterThan(100)
    }
  })
})
