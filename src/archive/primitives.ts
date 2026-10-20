import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export const JIT_SKELETON_MARKER = "--- [substrate.jit-skeleton] ---"

const READ_HEADER_RE = /^Read file (.+?),\s*lines\s+(\d+)-(\d+)(?:\s*\(of\s+(\d+)\))?\s*$/i
const TRUNCATION_FOOTER_RE = /^\[Output truncated\.\s*Continue reading with offset:\s*(\d+)\]/i
const NUMBERED_LINE_RE = /^(\d+): ?(.*)$/

export type ReadCoverageKind = "full" | "slice" | "truncated"

export interface FileReadCapture {
  readonly path: string
  readonly normalizedPath: string
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number | null
  readonly nextOffset: number | null
  readonly isTruncated: boolean
  readonly coverageKind: ReadCoverageKind
  readonly lineRange: string
  readonly cleanText: string
  readonly charLen: number
  /** SHA-256 of the raw tool output (stored at `.session-archive/blobs/<blobSha>.txt`). */
  readonly blobSha: string
  /** SHA-256 of the clean file slice (`lines[startLine..endLine].join("\n")`) in the disk hash domain. */
  readonly sliceSha: string
}

export type DiskReconcileState = "FRESH" | "SLICE" | "STALE" | "MISSING"

export interface DiskSliceReconciliation {
  readonly state: DiskReconcileState
  readonly stalenessStatus: string
  readonly lineRange: string
  readonly startLine: number
  readonly endLine: number
  readonly currentTotalLines: number | null
  readonly isFullRead: boolean
  readonly isTruncated: boolean
  readonly recordedSliceSha: string
  readonly diskSliceSha: string | null
  readonly diskFullSha: string | null
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function normalizeRepoPath(filePath: string, canonicalRoot?: string): string {
  if (!filePath || typeof filePath !== "string") return ""
  let cleaned = filePath.trim()
  if (cleaned.startsWith("file://")) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname)
    } catch {
      cleaned = cleaned.slice("file://".length)
    }
  }
  cleaned = cleaned.replace(/\\/g, "/")
  if (canonicalRoot && canonicalRoot.trim().length > 0) {
    const normRoot = canonicalRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "")
    if (cleaned === normRoot) return "."
    if (cleaned.startsWith(`${normRoot}/`)) {
      cleaned = cleaned.slice(normRoot.length + 1)
    }
  }
  cleaned = cleaned.replace(/^\.\//, "").replace(/^\/+/, "")
  return cleaned
}

export function splitDiskLines(rawContent: string): string[] {
  const normalized = rawContent.replace(/\r\n/g, "\n")
  if (normalized.length === 0) return []
  const lines = normalized.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines
}

function readInputString(input: Record<string, unknown> | undefined, keys: readonly string[]): string {
  if (!input) return ""
  for (const k of keys) {
    const v = input[k]
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return ""
}

function readInputNumber(input: Record<string, unknown> | undefined, keys: readonly string[]): number | null {
  if (!input) return null
  for (const k of keys) {
    const v = input[k]
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(1, Math.trunc(v))
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Math.max(1, Number.parseInt(v.trim(), 10))
  }
  return null
}

export function formatSliceLineRange(
  startLine: number,
  endLine: number,
  totalLines: number | null,
  isTruncated: boolean,
): string {
  const isFull =
    startLine === 1 && !isTruncated && (totalLines === null || endLine >= totalLines)
  if (isFull) {
    const finalEnd = totalLines !== null && totalLines > 0 ? Math.max(endLine, totalLines) : Math.max(1, endLine)
    return `L1-L${finalEnd}`
  }
  if (totalLines !== null && totalLines > 0) {
    return `SLICE L${startLine}-L${endLine} of ${totalLines}${isTruncated ? " (truncated)" : ""}`
  }
  return `SLICE L${startLine}-L${endLine}${isTruncated ? " (truncated)" : ""}`
}

export function formatStalenessStatus(
  state: DiskReconcileState,
  startLine: number,
  endLine: number,
  totalLines: number | null,
): string {
  if (state === "FRESH") return "FRESH — DO NOT REREAD"
  if (state === "SLICE") {
    const totalSuffix = totalLines !== null && totalLines > 0 ? ` of ${totalLines}` : ""
    return `SLICE L${startLine}-L${endLine}${totalSuffix} — FRESH SLICE`
  }
  return "STALE (modified since read/review — re-verify slice)"
}

export function parseReadToolOutput(
  rawOutput: string,
  input?: Record<string, unknown>,
  canonicalRoot?: string,
): FileReadCapture {
  const text = typeof rawOutput === "string" ? rawOutput : String(rawOutput ?? "")
  const blobSha = sha256Hex(text)
  const rawLines = text.replace(/\r\n/g, "\n").split("\n")

  const inputPath = readInputString(input, ["filePath", "path", "file", "target"])
  const inputOffset = readInputNumber(input, ["offset", "startLine", "start_line"])
  const inputLimit = readInputNumber(input, ["limit"])

  let headerPath = ""
  let headerStart: number | null = null
  let headerEnd: number | null = null
  let headerTotal: number | null = null
  let bodyStartIdx = 0

  if (rawLines.length > 0) {
    const headerMatch = rawLines[0].match(READ_HEADER_RE)
    if (headerMatch) {
      headerPath = headerMatch[1].trim()
      headerStart = Number.parseInt(headerMatch[2], 10)
      headerEnd = Number.parseInt(headerMatch[3], 10)
      if (headerMatch[4]) {
        headerTotal = Number.parseInt(headerMatch[4], 10)
      }
      bodyStartIdx = 1
    }
  }

  let isTruncated = false
  let nextOffset: number | null = null
  const bodyLines: string[] = []
  let firstNumberedLine: number | null = null
  let lastNumberedLine: number | null = null
  let allNumbered = true

  for (let i = bodyStartIdx; i < rawLines.length; i++) {
    const line = rawLines[i]
    if (line.startsWith(JIT_SKELETON_MARKER)) {
      break
    }
    const truncMatch = line.match(TRUNCATION_FOOTER_RE)
    if (truncMatch) {
      isTruncated = true
      nextOffset = Number.parseInt(truncMatch[1], 10)
      break
    }
    const numMatch = line.match(NUMBERED_LINE_RE)
    if (numMatch) {
      const n = Number.parseInt(numMatch[1], 10)
      if (firstNumberedLine === null) firstNumberedLine = n
      lastNumberedLine = n
      bodyLines.push(numMatch[2])
    } else {
      if (i === rawLines.length - 1 && line === "" && headerStart !== null) {
        continue
      }
      allNumbered = false
      bodyLines.push(line)
    }
  }

  let cleanLines = bodyLines
  if (headerStart === null && !allNumbered) {
    cleanLines = splitDiskLines(text)
  }

  const startLine =
    headerStart ??
    firstNumberedLine ??
    inputOffset ??
    1
  const endLine =
    headerEnd ??
    lastNumberedLine ??
    (cleanLines.length > 0 ? startLine + cleanLines.length - 1 : startLine)

  let totalLines = headerTotal
  if (totalLines === null && !isTruncated && startLine === 1 && inputLimit === null) {
    totalLines = endLine
  }

  const resolvedPath = headerPath || inputPath || "(unknown)"
  const normalizedPath = normalizeRepoPath(resolvedPath, canonicalRoot) || resolvedPath

  const cleanText = cleanLines.join("\n")
  const sliceSha = sha256Hex(cleanText)

  const isPartialSlice =
    isTruncated ||
    startLine > 1 ||
    (totalLines !== null && endLine < totalLines) ||
    (inputLimit !== null && cleanLines.length >= inputLimit && totalLines === null)

  const coverageKind: ReadCoverageKind = isTruncated
    ? "truncated"
    : isPartialSlice
      ? "slice"
      : "full"

  const lineRange = formatSliceLineRange(startLine, endLine, totalLines, isTruncated)

  return {
    path: resolvedPath,
    normalizedPath,
    startLine,
    endLine,
    totalLines,
    nextOffset,
    isTruncated,
    coverageKind,
    lineRange,
    cleanText,
    charLen: text.length,
    blobSha,
    sliceSha,
  }
}

export function resolveDiskPath(filePath: string, canonicalRoot?: string): string {
  if (!filePath) return ""
  if (path.isAbsolute(filePath)) return filePath
  const norm = normalizeRepoPath(filePath, canonicalRoot)
  return canonicalRoot ? path.resolve(canonicalRoot, norm) : path.resolve(norm)
}

export interface TargetWorkspaceResolution {
  readonly targetRoot: string
  readonly archiveDir: string
  readonly indexDbPath: string
  readonly relPath: string
  readonly isCrossProject: boolean
}

function findNearestRepoRoot(startPath: string): string | null {
  let current = path.resolve(startPath)
  try {
    if (existsSync(current) && !statSync(current).isDirectory()) {
      current = path.dirname(current)
    }
  } catch {
    current = path.dirname(current)
  }

  for (let depth = 0; depth < 24; depth++) {
    try {
      if (existsSync(path.join(current, ".git")) || existsSync(path.join(current, "package.json"))) {
        return current
      }
    } catch {
      // ignore permission errors while walking up
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

export function resolveTargetWorkspace(
  inputPath: string | undefined,
  defaultRoot: string,
): TargetWorkspaceResolution {
  const baseRoot = path.resolve(defaultRoot || process.cwd())
  if (!inputPath || typeof inputPath !== "string" || inputPath.trim().length === 0) {
    const archiveDir = path.join(baseRoot, ".session-archive")
    return {
      targetRoot: baseRoot,
      archiveDir,
      indexDbPath: path.join(archiveDir, "index.sqlite"),
      relPath: "",
      isCrossProject: false,
    }
  }

  let cleaned = inputPath.trim()
  if (cleaned.startsWith("file://")) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname)
    } catch {
      cleaned = cleaned.slice("file://".length)
    }
  }

  const candidateAbs = path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(baseRoot, cleaned)

  const insideBase =
    candidateAbs === baseRoot || candidateAbs.startsWith(`${baseRoot}${path.sep}`)

  const discoveredRoot = findNearestRepoRoot(candidateAbs)
  const targetRoot =
    discoveredRoot && (!insideBase || discoveredRoot !== baseRoot)
      ? discoveredRoot
      : insideBase
        ? baseRoot
        : discoveredRoot ?? baseRoot

  let relPath = ""
  if (candidateAbs === targetRoot) {
    relPath = ""
  } else if (candidateAbs.startsWith(`${targetRoot}${path.sep}`)) {
    relPath = normalizeRepoPath(candidateAbs, targetRoot)
  } else {
    relPath = normalizeRepoPath(cleaned, targetRoot)
  }

  const archiveDir = path.join(targetRoot, ".session-archive")
  return {
    targetRoot,
    archiveDir,
    indexDbPath: path.join(archiveDir, "index.sqlite"),
    relPath,
    isCrossProject: targetRoot !== baseRoot,
  }
}

export function computeDiskSliceSha(
  absPath: string,
  capture: {
    readonly startLine?: number | null
    readonly endLine?: number | null
    readonly totalLines?: number | null
    readonly isTruncated?: boolean
    readonly sliceSha: string
    readonly rawBlobSha?: string | null
  },
): DiskSliceReconciliation {
  const startLine = capture.startLine && capture.startLine > 0 ? capture.startLine : 1
  const endLine = capture.endLine && capture.endLine >= startLine ? capture.endLine : startLine
  const recordedSliceSha = capture.sliceSha

  let isRegularFile = false;
  if (absPath && existsSync(absPath)) {
    try { isRegularFile = statSync(absPath).isFile() } catch { isRegularFile = false }
  }
  if (!isRegularFile) {
    const isTruncated = Boolean(capture.isTruncated)
    return {
      state: "MISSING",
      stalenessStatus: formatStalenessStatus("MISSING", startLine, endLine, capture.totalLines ?? null),
      lineRange: formatSliceLineRange(startLine, endLine, capture.totalLines ?? null, isTruncated),
      startLine,
      endLine,
      currentTotalLines: null,
      isFullRead: false,
      isTruncated,
      recordedSliceSha,
      diskSliceSha: null,
      diskFullSha: null,
    }
  }

  const rawBytes = readFileSync(absPath)
  const rawDiskText = rawBytes.toString("utf8")
  const diskFullSha = sha256Hex(rawBytes)
  const diskLines = splitDiskLines(rawDiskText)
  const currentTotalLines = diskLines.length

  const clampedEnd = Math.min(endLine, Math.max(startLine, currentTotalLines))
  const sliceText = diskLines.slice(startLine - 1, clampedEnd).join("\n")
  const diskSliceSha = sha256Hex(sliceText)
  const diskNormalizedFullSha = sha256Hex(diskLines.join("\n"))

  const isTruncated = Boolean(capture.isTruncated) || endLine < currentTotalLines
  const isFullRead = startLine === 1 && !capture.isTruncated && endLine >= currentTotalLines

  const sliceMatches =
    recordedSliceSha === diskSliceSha ||
    recordedSliceSha === diskFullSha ||
    recordedSliceSha === diskNormalizedFullSha ||
    (capture.rawBlobSha != null &&
      (capture.rawBlobSha === diskFullSha || capture.rawBlobSha === diskNormalizedFullSha))

  const state: DiskReconcileState = sliceMatches
    ? isFullRead
      ? "FRESH"
      : "SLICE"
    : "STALE"

  const lineRange = formatSliceLineRange(startLine, endLine, currentTotalLines, isTruncated)
  const stalenessStatus = formatStalenessStatus(state, startLine, endLine, currentTotalLines)

  return {
    state,
    stalenessStatus,
    lineRange,
    startLine,
    endLine,
    currentTotalLines,
    isFullRead,
    isTruncated,
    recordedSliceSha,
    diskSliceSha,
    diskFullSha,
  }
}
