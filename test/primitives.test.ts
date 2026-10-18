import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  JIT_SKELETON_MARKER,
  computeDiskSliceSha,
  estimateTokens,
  normalizeRepoPath,
  parseReadToolOutput,
  sha256Hex,
} from "../src/archive/primitives.ts"

describe("src/archive/primitives", () => {
  test("normalizeRepoPath strips file:// and canonicalRoot without hardcoded repo names", () => {
    expect(
      normalizeRepoPath(
        "file:///Users/MAC/Documents/coding-projects/any-repo/src/plugin.ts",
        "/Users/MAC/Documents/coding-projects/any-repo",
      ),
    ).toBe("src/plugin.ts")
    expect(normalizeRepoPath("./src/archive/valve.ts")).toBe("src/archive/valve.ts")
    expect(normalizeRepoPath("/workspace/pkg/index.ts", "/workspace/pkg/")).toBe("index.ts")
  })

  test("estimateTokens computes ceil(chars / 4)", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(1)
    expect(estimateTokens("abcde")).toBe(2)
  })

  test("parseReadToolOutput + computeDiskSliceSha match 100% on full OpenCode read output", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "substrate-prim-"))
    try {
      const filePath = path.join(dir, "sample.ts")
      const fileLines = [
        "export interface Config {",
        "  readonly enabled: boolean",
        "}",
        "",
        "export function greet(name: string): string {",
        "  return `hello ${name}`",
        "}",
      ]
      writeFileSync(filePath, `${fileLines.join("\n")}\n`, "utf8")

      // Simulate exact OpenCode v2.0.32 read output with header + 1-indexed lines
      const formattedOutput = [
        `Read file ${filePath}, lines 1-${fileLines.length}`,
        ...fileLines.map((line, idx) => `${idx + 1}: ${line}`),
      ].join("\n")

      const capture = parseReadToolOutput(formattedOutput, { filePath }, dir)
      expect(capture.normalizedPath).toBe("sample.ts")
      expect(capture.startLine).toBe(1)
      expect(capture.endLine).toBe(7)
      expect(capture.isTruncated).toBe(false)
      expect(capture.coverageKind).toBe("full")
      expect(capture.lineRange).toBe("all")
      expect(capture.blobSha).toBe(sha256Hex(formattedOutput))
      expect(capture.sliceSha).toBe(sha256Hex(fileLines.join("\n")))

      const reconciled = computeDiskSliceSha(filePath, capture)
      expect(reconciled.state).toBe("FRESH")
      expect(reconciled.stalenessStatus).toBe("FRESH — DO NOT REREAD")
      expect(reconciled.isFullRead).toBe(true)

      // Modify disk by 1 character -> transitions to STALE
      writeFileSync(filePath, `${fileLines.join("\n")}\n// edited\n`, "utf8")
      const afterEdit = computeDiskSliceSha(filePath, {
        ...capture,
        // Even if slice 1-7 matches, total lines grew from 7 to 8, so it is now a SLICE,
        // whereas modifying line 2 makes it STALE:
      })
      expect(afterEdit.state).toBe("SLICE")

      const mutatedLines = [...fileLines]
      mutatedLines[1] = "  readonly enabled: string"
      writeFileSync(filePath, `${mutatedLines.join("\n")}\n`, "utf8")
      const staleReconciled = computeDiskSliceSha(filePath, capture)
      expect(staleReconciled.state).toBe("STALE")
      expect(staleReconciled.stalenessStatus).toBe("STALE (modified since read/review — re-verify slice)")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("parseReadToolOutput + computeDiskSliceSha record SLICE coverage on truncated OpenCode reads and ignore JIT skeleton footer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "substrate-prim-trunc-"))
    try {
      const filePath = path.join(dir, "large.ts")
      const allLines = Array.from({ length: 200 }, (_, i) => `export const v${i + 1} = ${i + 1}`)
      writeFileSync(filePath, `${allLines.join("\n")}\n`, "utf8")

      // Simulate OpenCode read truncated at line 50 without input.limit
      const formattedTruncated = [
        `Read file ${filePath}, lines 1-50`,
        ...allLines.slice(0, 50).map((line, idx) => `${idx + 1}: ${line}`),
        "[Output truncated. Continue reading with offset: 51]",
        JIT_SKELETON_MARKER,
        "export const v51 [L51-L51]",
      ].join("\n")

      const capture = parseReadToolOutput(formattedTruncated, { filePath }, dir)
      expect(capture.isTruncated).toBe(true)
      expect(capture.startLine).toBe(1)
      expect(capture.endLine).toBe(50)
      expect(capture.nextOffset).toBe(51)
      expect(capture.coverageKind).toBe("truncated")
      expect(capture.lineRange).toBe("SLICE L1-L50 (truncated)")

      const reconciled = computeDiskSliceSha(filePath, capture)
      expect(reconciled.state).toBe("SLICE")
      expect(reconciled.currentTotalLines).toBe(200)
      expect(reconciled.lineRange).toBe("SLICE L1-L50 of 200 (truncated)")
      expect(reconciled.stalenessStatus).toBe("SLICE L1-L50 of 200 — FRESH SLICE")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
