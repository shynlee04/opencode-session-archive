// PROTOTYPE TEST: WF-SUB-05 Zero-Dependency Bun.Transpiler + Depth-2 Closure-Factory AST Skeletonizer
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  collectTypeScriptFiles,
  computeBlobSha,
  indexCodebase,
  readAstSkeleton,
  readSymbolSlice,
  skeletonizeSource,
} from "./wf-sub-05-ast-skeletonizer"

const STEWARD_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
const SUBSTRATE_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-substrate"
const DATA_DB_PATH = path.join(SUBSTRATE_ROOT, "scratch/prototypes/data/wf-sub-05-codegraph.sqlite")

describe("WF-SUB-05: Zero-Dependency Bun.Transpiler + Depth-2 AST Skeletonizer", () => {
  test("extracts Depth-1 and Depth-2 closure-factory helpers (runTurn, bindForeignSession) and handles strings/comments/templates/regex/JSX", () => {
    const syntheticSource = [
      'import { type SessionState } from "./types.js"', // L1
      'import { helperA, helperB as aliasedB } from "./utils"', // L2
      "", // L3
      "export interface DriverConfig {", // L4
      "  readonly timeoutMs: number", // L5
      "  readonly retries: number", // L6
      "}", // L7
      "", // L8
      "export type DriverOutcome =", // L9
      '  | { readonly ok: true; readonly sessionId: string }', // L10
      '  | { readonly ok: false; readonly reason: string }', // L11
      "", // L12
      "export function createSyntheticDelegationDriver(config: DriverConfig) {", // L13
      '  // Comment with unbalanced braces {{{ and quotes "unclosed', // L14
      '  const banner = `template with ${config.timeoutMs > 0 ? "{active}" : "{idle}"} braces`', // L15
      "  const pattern = /\\{[a-z]+\\}\\/test/gi", // L16
      "", // L17
      "  async function bindForeignSession(childId: string, foreignId: string): Promise<boolean> {", // L18
      "    const key = `${childId}:${foreignId}`", // L19
      "    if (!key) return false", // L20
      "    return true", // L21
      "  }", // L22
      "", // L23
      "  const runTurn = async (prompt: string, turnIdx: number): Promise<DriverOutcome> => {", // L24
      "    const ok = await bindForeignSession(prompt, String(turnIdx))", // L25
      '    if (!ok) return { ok: false, reason: "bind_failed" }', // L26
      '    return { ok: true, sessionId: "sess-1" }', // L27
      "  }", // L28
      "", // L29
      "  return {", // L30
      "    bindForeignSession,", // L31
      "    runTurn,", // L32
      "    async inspectStatus(id: string) {", // L33
      "      return { id, banner, pattern: pattern.source }", // L34
      "    },", // L35
      "    close: () => {", // L36
      "      return true", // L37
      "    },", // L38
      "  }", // L39
      "}", // L40
      "", // L41
      "export class SessionSupervisor {", // L42
      "  async startSession(id: string): Promise<void> {", // L43
      "    console.log(id)", // L44
      "  }", // L45
      "  stopSession(): boolean {", // L46
      "    return true", // L47
      "  }", // L48
      "}", // L49
    ].join("\n")

    const res = skeletonizeSource("src/delegation/synthetic-driver.ts", syntheticSource)

    expect(res.loc).toBe(49)
    expect(res.exports).toEqual([
      "DriverConfig",
      "DriverOutcome",
      "SessionSupervisor",
      "createSyntheticDelegationDriver",
    ])
    expect(res.imports.length).toBe(2)

    const byName = new Map(res.symbols.map((s) => [`${s.parent_symbol ?? "root"}.${s.name}`, s]))

    const d1Factory = byName.get("root.createSyntheticDelegationDriver")
    expect(d1Factory).toBeDefined()
    expect(d1Factory?.depth).toBe(1)
    expect(d1Factory?.start_line).toBe(13)
    expect(d1Factory?.end_line).toBe(40)
    expect(d1Factory?.exported).toBe(true)

    const bindFn = byName.get("createSyntheticDelegationDriver.bindForeignSession")
    expect(bindFn).toBeDefined()
    expect(bindFn?.depth).toBe(2)
    expect(bindFn?.kind).toBe("function")
    expect(bindFn?.start_line).toBe(18)
    expect(bindFn?.end_line).toBe(22)
    expect(bindFn?.signature).toContain("{ /* L18-L22 */ }")

    const runTurnFn = byName.get("createSyntheticDelegationDriver.runTurn")
    expect(runTurnFn).toBeDefined()
    expect(runTurnFn?.depth).toBe(2)
    expect(runTurnFn?.kind).toBe("function")
    expect(runTurnFn?.start_line).toBe(24)
    expect(runTurnFn?.end_line).toBe(28)
    expect(runTurnFn?.signature).toContain("{ /* L24-L28 */ }")

    const inspectMethod = byName.get("createSyntheticDelegationDriver.inspectStatus")
    expect(inspectMethod).toBeDefined()
    expect(inspectMethod?.depth).toBe(2)
    expect(inspectMethod?.kind).toBe("method")
    expect(inspectMethod?.start_line).toBe(33)
    expect(inspectMethod?.end_line).toBe(35)

    const closeMethod = byName.get("createSyntheticDelegationDriver.close")
    expect(closeMethod).toBeDefined()
    expect(closeMethod?.depth).toBe(2)
    expect(closeMethod?.kind).toBe("method")
    expect(closeMethod?.start_line).toBe(36)
    expect(closeMethod?.end_line).toBe(38)

    const startMethod = byName.get("SessionSupervisor.startSession")
    expect(startMethod).toBeDefined()
    expect(startMethod?.depth).toBe(2)
    expect(startMethod?.start_line).toBe(43)
    expect(startMethod?.end_line).toBe(45)
  })

  test("surfaces inner Depth-2 helpers inside createNativeDelegationDriver in real src/delegation/native-delegation.ts", () => {
    const relPath = "src/delegation/native-delegation.ts"
    const absPath = path.join(STEWARD_ROOT, relPath)
    const src = readFileSync(absPath, "utf8")
    const res = skeletonizeSource(relPath, src, { rootDir: STEWARD_ROOT })

    expect(res.loc).toBeGreaterThan(3500)
    expect(res.reductionRatio).toBeGreaterThanOrEqual(0.9)

    const factory = res.symbols.find((s) => s.depth === 1 && s.name === "createNativeDelegationDriver")
    expect(factory).toBeDefined()
    expect(factory?.start_line).toBe(1002)
    expect(factory?.end_line).toBe(3889)

    const depth2Children = res.symbols.filter(
      (s) => s.depth === 2 && s.parent_symbol === "createNativeDelegationDriver",
    )
    expect(depth2Children.length).toBeGreaterThanOrEqual(55)

    const childNames = new Set(depth2Children.map((s) => s.name))
    for (const expectedHelper of [
      "noteForeignCurrent",
      "learnSession",
      "recordCatalogObservation",
      "persistBinding",
      "reconcileAmbiguous",
      "admitInitSettings",
      "mediateBoundModel",
      "turnStream",
      "admitStream",
      "doStream",
      "inspectChild",
      "closeDriver",
      "doGenerate",
      "childCheckpoint",
      "hostPermissionReply",
    ]) {
      expect(childNames.has(expectedHelper)).toBe(true)
    }
  })

  test("indexes all 51 files in hivemind-steward-oc-devin-dev/src/ with >= 88% token reduction, < 30ms warm parse, and < 0.5ms per-file warm skip", () => {
    mkdirSync(path.dirname(DATA_DB_PATH), { recursive: true })
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(DATA_DB_PATH + suffix)) unlinkSync(DATA_DB_PATH + suffix)
    }

    const db = new Database(DATA_DB_PATH)
    try {
      const stewardPaths = collectTypeScriptFiles(STEWARD_ROOT, "src")
      expect(stewardPaths.length).toBe(51)

      // 1. Cold index (parses all 51 files + persists to SQLite)
      const coldStats = indexCodebase(db, STEWARD_ROOT, stewardPaths)
      expect(coldStats.totalFiles).toBe(51)
      expect(coldStats.parsedFiles).toBe(51)
      expect(coldStats.skippedWarmFiles).toBe(0)
      expect(coldStats.totalLoc).toBe(28831)
      expect(coldStats.reductionRatio).toBeGreaterThanOrEqual(0.88)
      expect(coldStats.totalSymbols).toBeGreaterThan(1200)
      expect(coldStats.depth2Symbols).toBeGreaterThan(350)
      expect(coldStats.totalImportEdges).toBeGreaterThan(150)

      // 2. Warm index skip (all 51 files match (path, blob_sha), 3-sample median)
      const warmSamples = [
        indexCodebase(db, STEWARD_ROOT, stewardPaths),
        indexCodebase(db, STEWARD_ROOT, stewardPaths),
        indexCodebase(db, STEWARD_ROOT, stewardPaths),
      ]
      const warmSkipStats = warmSamples[0]!
      expect(warmSkipStats.parsedFiles).toBe(0)
      expect(warmSkipStats.skippedWarmFiles).toBe(51)
      const medianWarmSkipMs = warmSamples.map((s) => s.elapsedMs).sort((a, b) => a - b)[1]!
      const perFileWarmSkipMs = medianWarmSkipMs / stewardPaths.length
      expect(perFileWarmSkipMs).toBeLessThan(0.5)

      // 3. 1-file incremental update (invalidate 1 file's blob_sha and re-index)
      db.query("UPDATE code_file SET blob_sha = 'stale-sha' WHERE path = ?").run("src/acp.ts")
      const incStats = indexCodebase(db, STEWARD_ROOT, stewardPaths)
      expect(incStats.parsedFiles).toBe(1)
      expect(incStats.skippedWarmFiles).toBe(50)

      // 4. Verify Tier-2 (AstSkeleton) and Tier-3 (SymbolSlice) on the 3 required target files
      for (const targetFile of [
        "src/acp.ts",
        "src/acp-session-core.ts",
        "src/delegation/native-delegation.ts",
      ]) {
        const skel = readAstSkeleton(db, targetFile)
        expect(skel).not.toBeNull()
        expect(skel!.loc).toBeGreaterThan(300)
        expect(skel!.reduction_ratio).toBeGreaterThan(0.8)
        expect(skel!.symbols.length).toBeGreaterThan(10)
        expect(skel!.skeleton_text).toContain(`[L`)
      }

      // Tier-3 SymbolSlice by qualified Depth-2 symbol name on native-delegation.ts
      const turnStreamSlice = readSymbolSlice(
        STEWARD_ROOT,
        db,
        "src/delegation/native-delegation.ts",
        "createNativeDelegationDriver.turnStream",
      )
      expect(turnStreamSlice).not.toBeNull()
      expect(turnStreamSlice!.depth).toBe(2)
      expect(turnStreamSlice!.parent_symbol).toBe("createNativeDelegationDriver")
      expect(turnStreamSlice!.start_line).toBe(2838)
      expect(turnStreamSlice!.end_line).toBe(3015)
      expect(turnStreamSlice!.slice_text).toContain("L2838:   const turnStream = (turn: Turn)")
      expect(turnStreamSlice!.slice_tokens).toBeLessThan(turnStreamSlice!.raw_file_tokens * 0.1)

      // Tier-3 SymbolSlice by Depth-1 symbol name on acp.ts
      const acpSkeleton = readAstSkeleton(db, "src/acp.ts")!
      const firstAcpSym = acpSkeleton.symbols[0]!
      const acpSlice = readSymbolSlice(STEWARD_ROOT, db, "src/acp.ts", firstAcpSym.name)
      expect(acpSlice).not.toBeNull()
      expect(acpSlice!.start_line).toBe(firstAcpSym.start_line)
      expect(acpSlice!.end_line).toBe(firstAcpSym.end_line)

      // Tier-3 SymbolSlice by [Lstart-Lend] range on acp-session-core.ts
      const sessionCoreSlice = readSymbolSlice(
        STEWARD_ROOT,
        db,
        "src/acp-session-core.ts",
        "[L1-L45]",
      )
      expect(sessionCoreSlice).not.toBeNull()
      expect(sessionCoreSlice!.start_line).toBe(1)
      expect(sessionCoreSlice!.end_line).toBe(45)
      expect(sessionCoreSlice!.line_count).toBe(45)

      // 5. Warm in-memory parse benchmark across all 51 files (< 30 ms median across 7 samples)
      const knownSet = new Set(stewardPaths)
      const memFiles = stewardPaths.map((rel) => ({
        rel,
        text: readFileSync(path.join(STEWARD_ROOT, rel), "utf8"),
      }))
      const samples: number[] = []
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now()
        for (const f of memFiles) {
          skeletonizeSource(f.rel, f.text, { knownPaths: knownSet })
        }
        samples.push(performance.now() - t0)
      }
      const sorted = [...samples].sort((a, b) => a - b)
      const medianMs = sorted[3]!
      expect(medianMs).toBeLessThan(30)

      db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
    } finally {
      db.close()
    }
  })

  test("indexes all 7 TypeScript files in hivemind-substrate/src/", () => {
    const db = new Database(":memory:")
    try {
      const substratePaths = collectTypeScriptFiles(SUBSTRATE_ROOT, "src")
      expect(substratePaths.length).toBe(7)
      const stats = indexCodebase(db, SUBSTRATE_ROOT, substratePaths)
      expect(stats.totalFiles).toBe(7)
      expect(stats.parsedFiles).toBe(7)
      expect(stats.totalSymbols).toBeGreaterThan(25)
      expect(stats.totalImportEdges).toBeGreaterThanOrEqual(8)

      const normalizeSkel = readAstSkeleton(db, "src/archive/normalize.ts")
      expect(normalizeSkel).not.toBeNull()
      expect(normalizeSkel!.symbols.some((s) => s.name === "sessionHeader")).toBe(true)
    } finally {
      db.close()
    }
  })
})
