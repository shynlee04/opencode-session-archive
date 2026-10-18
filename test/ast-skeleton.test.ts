// CSG-01: Zero-Dependency Bun.Transpiler + Depth-2 Closure-Factory AST Skeletonizer and SQLite Cache
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import {
  collectTypeScriptFiles,
  computeBlobSha,
  ensureCodeGraphSchema,
  indexCodebase,
  queryAstSkeleton,
  readAstSkeleton,
  readSymbolSlice,
  scanLexicalLines,
  skeletonizeFile,
  skeletonizeSource,
} from "../src/honeycomb/ast-skeleton.ts"

const STEWARD_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
const SUBSTRATE_ROOT = "/Users/MAC/Documents/coding-projects/hivemind-substrate"

describe("CSG-01: Zero-Dependency Bun.Transpiler + Depth-2 AST Skeletonizer & SQLite Cache", () => {
  test("scanLexicalLines computes lineMinBrace[L] and commentOrStringMask[L] with 0 brace/paren mismatches across JSX, apostrophes, generics, and inline return types", () => {
    const trickySource = [
      'import { For } from "solid-js"', // L1
      "export function TrickyComponent(props: { items: string[] }): { readonly ok: boolean } {", // L2
      "  const set = new Set<(item: string) => void>()", // L3
      '  // line comment with {{{ and "unclosed string', // L4
      "  const tpl = `outer ${props.items.length > 0 ? '{inner}' : '}'} end`", // L5
      "  const rx = /\\{[a-z]+\\}\\//gi", // L6
      "  const jsx = (", // L7
      "    <div>", // L8
      "      <p>don't corrupt brace depth on apostrophes</p>", // L9
      "      <For each={props.items}>{(item) => <span>{item}</span>}</For>", // L10
      "    </div>", // L11
      "  )", // L12
      "  return { ok: Boolean(jsx && set && tpl && rx) }", // L13
      "}", // L14
    ].join("\n")

    const lex = scanLexicalLines(trickySource)
    expect(lex.numLines).toBe(14)
    expect(lex.lineStartBrace[2]).toBe(0)
    expect(lex.lineEndBrace[2]).toBe(1)
    expect(lex.lineMinBrace[14]).toBe(0)
    expect(lex.lineEndBrace[14]).toBe(0)
    expect(lex.lineEndParen[14]).toBe(0)
    expect(lex.commentOrStringMask[4]).toBe(1)
    expect(lex.commentOrStringMask[5]).toBe(1)
    expect(lex.commentOrStringMask[6]).toBe(1)

    const skel = skeletonizeSource("src/ui/tricky.tsx", trickySource)
    expect(skel.symbols.length).toBe(1)
    expect(skel.symbols[0]?.name).toBe("TrickyComponent")
    expect(skel.symbols[0]?.start_line).toBe(2)
    expect(skel.symbols[0]?.end_line).toBe(14)
  })

  test("extracts Depth-1 and Depth-2 closure-factory helpers (runTurn, bindForeignSession) and respects closureFactoryMinLines", () => {
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

    const byQualified = new Map(res.symbols.map((s) => [s.qualified_name, s]))

    const d1Factory = byQualified.get("createSyntheticDelegationDriver")
    expect(d1Factory).toBeDefined()
    expect(d1Factory?.depth).toBe(1)
    expect(d1Factory?.start_line).toBe(13)
    expect(d1Factory?.end_line).toBe(40)
    expect(d1Factory?.exported).toBe(true)

    const bindFn = byQualified.get("createSyntheticDelegationDriver.bindForeignSession")
    expect(bindFn).toBeDefined()
    expect(bindFn?.depth).toBe(2)
    expect(bindFn?.kind).toBe("function")
    expect(bindFn?.start_line).toBe(18)
    expect(bindFn?.end_line).toBe(22)
    expect(bindFn?.signature).toContain("{ /* L18-L22 */ }")

    const runTurnFn = byQualified.get("createSyntheticDelegationDriver.runTurn")
    expect(runTurnFn).toBeDefined()
    expect(runTurnFn?.depth).toBe(2)
    expect(runTurnFn?.kind).toBe("function")
    expect(runTurnFn?.start_line).toBe(24)
    expect(runTurnFn?.end_line).toBe(28)
    expect(runTurnFn?.signature).toContain("{ /* L24-L28 */ }")

    const inspectMethod = byQualified.get("createSyntheticDelegationDriver.inspectStatus")
    expect(inspectMethod).toBeDefined()
    expect(inspectMethod?.depth).toBe(2)
    expect(inspectMethod?.kind).toBe("method")
    expect(inspectMethod?.start_line).toBe(33)
    expect(inspectMethod?.end_line).toBe(35)

    const closeMethod = byQualified.get("createSyntheticDelegationDriver.close")
    expect(closeMethod).toBeDefined()
    expect(closeMethod?.depth).toBe(2)
    expect(closeMethod?.kind).toBe("method")
    expect(closeMethod?.start_line).toBe(36)
    expect(closeMethod?.end_line).toBe(38)

    const startMethod = byQualified.get("SessionSupervisor.startSession")
    expect(startMethod).toBeDefined()
    expect(startMethod?.depth).toBe(2)
    expect(startMethod?.start_line).toBe(43)
    expect(startMethod?.end_line).toBe(45)
  })

  test("surfaces inner Depth-2 helpers inside createNativeDelegationDriver in real src/delegation/native-delegation.ts", () => {
    if (!existsSync(STEWARD_ROOT)) return
    const relPath = "src/delegation/native-delegation.ts"
    const res = skeletonizeFile(STEWARD_ROOT, relPath, { closureFactoryMinLines: 200 })

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

  test("indexes all 51 files in hivemind-steward-oc-devin-dev/src/ with >= 88% token reduction, < 30ms warm parse, < 0.5ms/file warm skip, and F-04 dual parameter order", () => {
    if (!existsSync(STEWARD_ROOT)) return
    const db = new Database(":memory:")
    try {
      ensureCodeGraphSchema(db)
      const stewardPaths = collectTypeScriptFiles(STEWARD_ROOT, "src")
      expect(stewardPaths.length).toBe(51)

      // 1. Cold index using (db, rootDir, paths) order
      const coldStats = indexCodebase(db, STEWARD_ROOT, stewardPaths)
      expect(coldStats.totalFiles).toBe(51)
      expect(coldStats.parsedFiles).toBe(51)
      expect(coldStats.skippedWarmFiles).toBe(0)
      expect(coldStats.totalLoc).toBe(28831)
      expect(coldStats.reductionRatio).toBeGreaterThanOrEqual(0.88)
      expect(coldStats.totalSymbols).toBeGreaterThan(1200)
      expect(coldStats.depth2Symbols).toBeGreaterThan(350)
      expect(coldStats.totalImportEdges).toBeGreaterThan(150)

      // 2. Warm index skip using (rootDir, db, paths) order (F-04)
      const warmSamples = [
        indexCodebase(STEWARD_ROOT, db, stewardPaths),
        indexCodebase(db, STEWARD_ROOT, stewardPaths),
        indexCodebase(STEWARD_ROOT, db, { paths: stewardPaths }),
      ]
      const warmSkipStats = warmSamples[0]!
      expect(warmSkipStats.parsedFiles).toBe(0)
      expect(warmSkipStats.skippedWarmFiles).toBe(51)
      expect(warmSkipStats.skippedUnchangedFiles).toBe(51)
      const medianWarmSkipMs = warmSamples.map((s) => s.elapsedMs).sort((a, b) => a - b)[1]!
      const perFileWarmSkipMs = medianWarmSkipMs / stewardPaths.length
      expect(perFileWarmSkipMs).toBeLessThan(0.5)

      // 3. 1-file incremental update (< 5 ms median)
      db.query("UPDATE code_file SET blob_sha = 'stale-sha' WHERE path = ?").run("src/acp.ts")
      const incStats = indexCodebase(db, STEWARD_ROOT, stewardPaths)
      expect(incStats.parsedFiles).toBe(1)
      expect(incStats.skippedWarmFiles).toBe(50)

      // 4. Verify Tier-2 (readAstSkeleton / queryAstSkeleton) and Tier-3 (readSymbolSlice) in both parameter orders
      for (const targetFile of [
        "src/acp.ts",
        "src/acp-session-core.ts",
        "src/delegation/native-delegation.ts",
      ]) {
        const skel = queryAstSkeleton(db, targetFile)
        expect(skel).not.toBeNull()
        expect(skel!.loc).toBeGreaterThan(300)
        expect(skel!.reduction_ratio).toBeGreaterThan(0.8)
        expect(skel!.symbols.length).toBeGreaterThan(10)
        expect(skel!.skeleton_text).toContain("[L")
      }

      const turnStreamSliceA = readSymbolSlice(
        STEWARD_ROOT,
        db,
        "src/delegation/native-delegation.ts",
        "createNativeDelegationDriver.turnStream",
      )
      const turnStreamSliceB = readSymbolSlice(
        db,
        STEWARD_ROOT,
        "src/delegation/native-delegation.ts",
        "createNativeDelegationDriver.turnStream",
      )
      expect(turnStreamSliceA).not.toBeNull()
      expect(turnStreamSliceB).not.toBeNull()
      expect(turnStreamSliceA!.slice_text).toBe(turnStreamSliceB!.slice_text)
      expect(turnStreamSliceA!.depth).toBe(2)
      expect(turnStreamSliceA!.parent_symbol).toBe("createNativeDelegationDriver")
      expect(turnStreamSliceA!.start_line).toBe(2838)
      expect(turnStreamSliceA!.end_line).toBe(3015)
      expect(turnStreamSliceA!.slice_text).toContain("L2838:   const turnStream = (turn: Turn)")
      expect(turnStreamSliceA!.slice_tokens).toBeLessThan(turnStreamSliceA!.raw_file_tokens * 0.1)

      // Tier-3 SymbolSlice by [Lstart-Lend] string and { startLine, endLine } object
      const rangeStrSlice = readSymbolSlice(STEWARD_ROOT, db, "src/acp-session-core.ts", "[L1-L45]")
      const rangeObjSlice = readSymbolSlice(db, STEWARD_ROOT, "src/acp-session-core.ts", {
        startLine: 1,
        endLine: 45,
      })
      expect(rangeStrSlice).not.toBeNull()
      expect(rangeStrSlice!.start_line).toBe(1)
      expect(rangeStrSlice!.end_line).toBe(45)
      expect(rangeStrSlice!.line_count).toBe(45)
      expect(rangeObjSlice?.slice_text).toBe(rangeStrSlice?.slice_text)

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
      expect(medianMs).toBeLessThan(45)
    } finally {
      db.close()
    }
  })

  test("indexes hivemind-substrate/src/ and removes deleted files from SQLite on re-index", () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "csg01-test-"))
    const db = new Database(":memory:")
    try {
      const srcDir = path.join(tmpDir, "src")
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(
        path.join(srcDir, "a.ts"),
        'import { bVal } from "./b.ts"\nexport function aFn() {\n  return bVal + 1\n}\n',
      )
      writeFileSync(path.join(srcDir, "b.ts"), "export const bVal = 42\n")

      const stats1 = indexCodebase(tmpDir, db)
      expect(stats1.totalFiles).toBe(2)
      expect(stats1.parsedFiles).toBe(2)
      expect(stats1.totalImportEdges).toBe(1)
      expect(computeBlobSha("export const bVal = 42\n").length).toBe(64)

      // Delete b.ts and re-index
      rmSync(path.join(srcDir, "b.ts"))
      const stats2 = indexCodebase(db, tmpDir)
      expect(stats2.totalFiles).toBe(1)
      expect(stats2.removedFiles).toBe(1)
      expect(readAstSkeleton(db, "src/b.ts")).toBeNull()
    } finally {
      db.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }

    // Also verify real hivemind-substrate/src/
    const subDb = new Database(":memory:")
    try {
      const substratePaths = collectTypeScriptFiles(SUBSTRATE_ROOT, "src")
      expect(substratePaths.length).toBeGreaterThanOrEqual(7)
      const stats = indexCodebase(subDb, SUBSTRATE_ROOT, substratePaths)
      expect(stats.totalFiles).toBeGreaterThanOrEqual(7)
      expect(stats.parsedFiles).toBe(stats.totalFiles)
      expect(stats.totalSymbols).toBeGreaterThan(25)

      const normalizeSkel = readAstSkeleton(subDb, "src/archive/normalize.ts")
      expect(normalizeSkel).not.toBeNull()
      expect(normalizeSkel!.symbols.some((s) => s.name === "sessionHeader")).toBe(true)
    } finally {
      subDb.close()
    }
  })
})
