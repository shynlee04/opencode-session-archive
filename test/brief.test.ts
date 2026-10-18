import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import type { Database } from "bun:sqlite"
import { sha256hex } from "../src/archive/normalize.ts"
import { buildImplementorViewportBrief } from "../src/viewports/brief.ts"
import {
  DEFAULT_ARCHIVE_DIR,
  DEFAULT_TARGET_DB_PATH,
  DEFAULT_WF01_DB_PATH,
  DEFAULT_WF03_DB_PATH,
  DEFAULT_WF06_DB_PATH,
  S1_SESSION_ID,
  buildUnifiedContinuityDatabase,
} from "../src/viewports/continuity.ts"

const STEWARD_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
const BRIEF_TEST_DB_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/vsc-03-brief-test.sqlite"

const PROTECTED_UPSTREAM_DBS = [
  DEFAULT_WF01_DB_PATH,
  DEFAULT_WF03_DB_PATH,
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-05-codegraph.sqlite",
  DEFAULT_WF06_DB_PATH,
  `${DEFAULT_ARCHIVE_DIR}/index.sqlite`,
] as const

function hashFile(path: string): string {
  return sha256hex(readFileSync(path))
}

describe("VSC-03: Cross-Harness Implementor Viewport Brief Helper (buildImplementorViewportBrief)", () => {
  const upstreamHashesBefore = new Map<string, string>()
  let db: Database

  beforeAll(() => {
    for (const p of PROTECTED_UPSTREAM_DBS) {
      if (existsSync(p)) {
        upstreamHashesBefore.set(p, hashFile(p))
      }
    }
    db = buildUnifiedContinuityDatabase({
      targetDbPath: BRIEF_TEST_DB_PATH || DEFAULT_TARGET_DB_PATH,
    })
  })

  afterAll(() => {
    db?.close()
    for (const [p, expectedHash] of upstreamHashesBefore.entries()) {
      expect(hashFile(p)).toBe(expectedHash)
    }
  })

  test("1. REQ-SUB-18: packs Tier-1 RepoMap, Tier-2 AstSkeleton, Tier-3 SymbolSlice, Tier-4 CoChangeCoupling (has_static_edge=0), and ProvenanceChain constraints within default 1,500 tokens in < 5 ms", () => {
    const t0 = performance.now()
    const brief = buildImplementorViewportBrief(db, {
      targetPaths: ["src/delegation/native-delegation.ts", "src/devin-executable.ts"],
      symbolNames: ["createNativeDelegationDriver.turnStream"],
      sessionID: S1_SESSION_ID,
      rootDir: STEWARD_ROOT,
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
    expect(brief.includedSymbols).toContain("createNativeDelegationDriver.turnStream")
    expect(brief.coupledWarnings).toBeGreaterThanOrEqual(1)
    expect(brief.provenanceChains).toBeGreaterThanOrEqual(1)

    // Verify all 5 structural sections appear in the brief markdown
    expect(brief.markdown).toContain("Tier-1 RepoMap")
    expect(brief.markdown).toContain("src/delegation/native-delegation.ts")
    expect(brief.markdown).toContain("src/devin-executable.ts")
    expect(brief.markdown).toContain("createNativeDelegationDriver.turnStream")
    expect(brief.markdown).toContain("src/harness-antigravity.ts")
    expect(brief.markdown).toContain("HIDDEN")
    expect(brief.markdown).toContain("F-MH28-DRIVER-SEAM")
  })

  test("2. REQ-SUB-18: supports alias option shapes (writeLeasePaths, focusSymbols, projectRoot, maxTokensBudget, goal, verificationCommand)", () => {
    const brief = buildImplementorViewportBrief(db, {
      projectRoot: STEWARD_ROOT,
      sessionID: S1_SESSION_ID,
      goal: "Isolate native delegation admission stream error handling",
      writeLeasePaths: ["src/delegation/native-delegation.ts", "src/devin-executable.ts"],
      focusSymbols: [
        {
          path: "src/delegation/native-delegation.ts",
          symbol: "createNativeDelegationDriver.turnStream",
        },
      ],
      verificationCommand: "bun test test/native-init-settings.test.ts && bun run typecheck",
      maxTokensBudget: 1800,
    })

    expect(brief.tokenEstimate).toBeLessThanOrEqual(1800)
    expect(Math.ceil(brief.markdown.length / 4)).toBeLessThanOrEqual(1800)
    expect(brief.goal).toBe("Isolate native delegation admission stream error handling")
    expect(brief.verificationCommand).toBe(
      "bun test test/native-init-settings.test.ts && bun run typecheck",
    )
    expect(brief.markdown).toContain("Isolate native delegation admission stream error handling")
    expect(brief.markdown).toContain("bun test test/native-init-settings.test.ts")
    expect(brief.includedSymbols).toContain("createNativeDelegationDriver.turnStream")
    expect(brief.coupledWarnings).toBeGreaterThan(0)
    expect(brief.provenanceChains).toBeGreaterThan(0)
  })

  test("3. REQ-SUB-18: enforces strict token ceiling via deterministic truncation under tight token budgets", () => {
    for (const tightBudget of [400, 650, 900, 1200]) {
      const brief = buildImplementorViewportBrief(db, {
        targetPaths: [
          "src/delegation/native-delegation.ts",
          "src/devin-executable.ts",
          "src/acp-session-core.ts",
        ],
        symbolNames: ["createNativeDelegationDriver.turnStream"],
        sessionID: S1_SESSION_ID,
        rootDir: STEWARD_ROOT,
        maxTokens: tightBudget,
      })

      expect(brief.tokenEstimate).toBeLessThanOrEqual(tightBudget)
      expect(Math.ceil(brief.markdown.length / 4)).toBeLessThanOrEqual(tightBudget)
      expect(brief.withinBudget).toBe(true)
      expect(brief.markdown.length).toBeGreaterThan(100)
    }
  })
})
