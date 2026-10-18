import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import {
  computeDiskSliceSha,
  estimateTokens as estimateStringTokens,
  formatSliceLineRange,
  formatStalenessStatus,
  normalizeRepoPath as normalizePrimitiveRepoPath,
  parseReadToolOutput,
  resolveDiskPath,
  sha256Hex,
  type FileReadCapture,
} from "./primitives.ts"

export const DEFAULT_KEEP_RECENT_STEPS = 8
export const DEFAULT_AUTO_KEEP_RECENT_STEPS = 12
export const DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO = 0.65
export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 200_000

const FIELD_LIMIT = 280
export const KEEP_RESULT = new Set(["subagent", "task", "delegate-devin", "hivemind-delegate"])
export const KEEP_INPUT = new Set(["read", "write", "edit"])

const SKILL_TAG_RE = /<skill_content\b[^>]*>[\s\S]*?<\/skill_content>/g
const SKILL_NAME_RE = /name="([^"]+)"/

export const FRESH_STATUS = "FRESH — DO NOT REREAD" as const
export const STALE_STATUS = "STALE (modified since read/review — re-verify slice)" as const
export const ACTIVE_SKILL_STATUS = "ACTIVE — DO NOT RE-INVOKE" as const
export const ACTIVE_SKILL_BREADCRUMB_STATUS = "ACTIVE IN MANIFEST — DO NOT RE-INVOKE" as const

export type PruningMode = "step-window" | "recent" | "initial" | "all"
export type ValveMode = PruningMode

export type FreshnessStatus =
  | typeof FRESH_STATUS
  | typeof STALE_STATUS
  | "STALE"
  | `SLICE L${number}-L${number} of ${number | "?"} — FRESH SLICE`
  | string

export type BreadcrumbStatus =
  | FreshnessStatus
  | typeof ACTIVE_SKILL_BREADCRUMB_STATUS
  | typeof ACTIVE_SKILL_STATUS

export type WatermarkAnchorReason =
  | "step-window"
  | "auto-threshold-step-window"
  | "recent-user-prompt"
  | "recent-step-fallback"
  | "initial-history"
  | "no-op"

export interface AssistantStepWatermark {
  readonly mode: PruningMode
  readonly keepRecentSteps: number
  readonly activeStartIndex: number
  readonly anchorMessageID: string | null
  readonly anchorIndex: number
  readonly anchorReason: WatermarkAnchorReason
  readonly lastUserIndex: number
  readonly lastCompactionIndex: number
  readonly assistantStepsTotal: number
  readonly assistantStepsAfterLastUser: number
  readonly assistantStepsKept: number
  readonly assistantStepsThinned: number
  readonly estimatedInputTokensBefore: number
  readonly totalActiveChars: number
  readonly autoActivated: boolean
}

export interface ComputeStepWatermarkOptions {
  readonly mode?: PruningMode | "auto"
  readonly keepRecentSteps?: number
  readonly modelContextWindowTokens?: number
  readonly autoPruneThresholdRatio?: number
  readonly autoKeepRecentSteps?: number
  readonly autoPruneKeepRecentSteps?: number
}

export interface FactBreadcrumb {
  readonly callId: string
  readonly messageId: string
  readonly tool: string
  readonly target: string
  readonly lineRange: string | null
  readonly originalChars: number
  readonly blobSha256: string
  readonly blobRef: string
  readonly summary: string
  readonly status: BreadcrumbStatus
  readonly rendered: string
}

export interface ManifestFileReadEntry {
  readonly path: string
  readonly normalizedPath: string
  readonly lineRange: string
  readonly startLine?: number
  readonly endLine?: number
  readonly totalLines?: number | null
  readonly isTruncated?: boolean
  readonly chars: number
  readonly blobSha256: string
  readonly sliceSha256?: string
  readonly blobRef: string
  readonly summary: string
  readonly status: FreshnessStatus
  readonly messageId: string
  readonly sourceSessionId: string
}

export interface ManifestFileModifiedEntry {
  readonly path: string
  readonly normalizedPath: string
  readonly operation: "add" | "update" | "write" | "edit"
  readonly tool: string
  readonly messageId: string
  readonly blobRef: string
  readonly status: "COMMITTED_OR_APPLIED"
}

export interface ManifestSkillEntry {
  readonly name: string
  readonly chars: number
  readonly blobSha256: string
  readonly blobRef: string
  readonly summary: string
  readonly status: typeof ACTIVE_SKILL_STATUS
  readonly messageId: string
  readonly sourceSessionId: string
}

export interface ManifestDelegationEntry {
  readonly callId: string
  readonly childSessionID: string | null
  readonly tool: string
  readonly harness: string
  readonly agent: string
  readonly description: string
  readonly reportedStatus: string
  readonly verifiedStatus: "unverified_in_flight" | "completed_report_only" | "verified_or_reconciled"
  readonly blobRef: string
}

export interface WorkingMemoryManifest {
  readonly sessionID: string
  readonly filesRead: readonly ManifestFileReadEntry[]
  readonly filesModified: readonly ManifestFileModifiedEntry[]
  readonly activeSkills: readonly ManifestSkillEntry[]
  readonly delegationOutcomes: readonly ManifestDelegationEntry[]
  readonly renderedMarkdown: string
  readonly markdown: string
}

export interface ValveMetrics {
  readonly toolPartsThinned: number
  readonly rawOutputCharsBefore: number
  readonly breadcrumbCharsAfter: number
  readonly rawInputCharsBefore: number
  readonly thinnedInputCharsAfter: number
  readonly manifestChars: number
  readonly netCharsFreed: number
  readonly rawOutputTokensFreed: number
  readonly netTokensFreed: number
  readonly blobsWritten: number
  readonly blobsReused: number
}

export interface ValveExecutionLedger {
  readonly sessionID: string
  readonly mode: PruningMode
  readonly keepRecentSteps: number
  readonly watermark: AssistantStepWatermark
  readonly breadcrumbsByCallId: ReadonlyMap<string, FactBreadcrumb>
  readonly thinnedInputsByCallId: ReadonlyMap<string, unknown>
  readonly skillBreadcrumbsByName: ReadonlyMap<string, FactBreadcrumb>
  readonly manifest: WorkingMemoryManifest
  readonly metrics: ValveMetrics
  readonly at: string
}

export type ArmedValveState = ValveExecutionLedger

export interface ValveOptions {
  readonly blobDir?: string
  readonly readOnlyArchiveDir?: string | null
  readonly canonicalRoot?: string
  readonly keepRecentSteps?: number
  readonly autoKeepRecentSteps?: number
  readonly autoPruneThresholdRatio?: number
  readonly modelContextWindowTokens?: number
  readonly persistBlobsToDisk?: boolean
  readonly diskHashesByPath?: ReadonlyMap<string, string>
  readonly priorWorktreeMessages?: readonly {
    readonly sessionID: string
    readonly messages: readonly Record<string, any>[]
  }[]
  readonly includeWorktreeArchive?: boolean
  readonly maxCutTimestamp?: number
}

export interface ContextHookApplyOptions {
  readonly autoPruneThresholdRatio?: number
  readonly autoKeepRecentSteps?: number
  readonly autoPruneKeepRecentSteps?: number
  readonly modelContextWindowTokens?: number
}

export interface ContextHookApplyResult {
  readonly applied: boolean
  readonly trigger: "explicit-armed" | "auto-watermark-65pct" | "noop"
  readonly thinnedParts: number
  readonly thinnedPartsCount: number
  readonly anchorIndex: number
  readonly watermark: AssistantStepWatermark | null
  readonly elapsedMs: number
}

export function estimateTokens(charsOrText: number | string): number {
  if (typeof charsOrText === "string") return estimateStringTokens(charsOrText)
  return Math.ceil(charsOrText / 4)
}

export function normalizeRepoPath(rawPath: string, canonicalRoot?: string): string {
  return normalizePrimitiveRepoPath(rawPath, canonicalRoot)
}

function isUserMessage(msg: Record<string, any>): boolean {
  return msg.type === "user" || msg.role === "user" || msg.kind === "user"
}

function isAssistantMessage(msg: Record<string, any>): boolean {
  return msg.type === "assistant" || msg.role === "assistant" || msg.kind === "assistant"
}

function isCompactionMessage(msg: Record<string, any>): boolean {
  if (msg.type === "compaction" || msg.kind === "compaction") return true
  if (Array.isArray(msg.content)) {
    return msg.content.some((p: any) => p && typeof p === "object" && p.type === "compaction")
  }
  return false
}

function measureValueChars(val: unknown): number {
  if (typeof val === "string") return val.length
  if (typeof val === "number" || typeof val === "boolean") return 8
  if (!val || typeof val !== "object") return 0
  if (Array.isArray(val)) {
    let sum = 0
    for (let i = 0; i < val.length; i++) sum += measureValueChars(val[i])
    return sum
  }
  let sum = 0
  for (const [k, v] of Object.entries(val)) {
    sum += k.length + measureValueChars(v)
  }
  return sum
}

export function measureMessagesChars(
  messages: readonly Record<string, any>[],
  startIndex = 0,
): number {
  let total = 0
  for (let i = startIndex; i < messages.length; i++) {
    const m = messages[i]
    if (!m || typeof m !== "object") continue
    if (typeof m.text === "string") total += m.text.length
    if (typeof m.content === "string") total += m.content.length
    if (Array.isArray(m.skills)) {
      for (const s of m.skills) {
        if (s && typeof s.text === "string") total += s.text.length
      }
    }
    const parts = Array.isArray(m.content) ? m.content : Array.isArray(m.parts) ? m.parts : null
    if (!parts) continue
    for (let j = 0; j < parts.length; j++) {
      const p = parts[j]
      if (!p || typeof p !== "object") continue
      if (typeof p.text === "string") total += p.text.length
      if (typeof p.output === "string") total += p.output.length
      if (p.type === "tool" && p.state && typeof p.state === "object") {
        if (p.state.input !== undefined) total += measureValueChars(p.state.input)
        if (typeof p.state.output === "string") total += p.state.output.length
        if (Array.isArray(p.state.content)) {
          for (const c of p.state.content) {
            if (c && typeof c.text === "string") total += c.text.length
          }
        }
      } else if (p.type === "tool-call" && p.input !== undefined) {
        total += measureValueChars(p.input)
      } else if (p.type === "tool-result" && p.result !== undefined) {
        if (typeof p.result === "string") {
          total += p.result.length
        } else if (p.result && typeof p.result === "object") {
          if (typeof p.result.value === "string") total += p.result.value.length
          if (Array.isArray(p.result.content)) {
            for (const c of p.result.content) {
              if (c && typeof c.text === "string") total += c.text.length
            }
          }
        }
      }
    }
  }
  return total
}

export function computeStepWatermark(
  messages: readonly Record<string, any>[],
  options: ComputeStepWatermarkOptions = {},
): AssistantStepWatermark {
  let lastCompactionIndex = -1
  for (let i = 0; i < messages.length; i++) {
    if (isCompactionMessage(messages[i]!)) {
      lastCompactionIndex = i
    }
  }

  const activeStartIndex = lastCompactionIndex >= 0 ? lastCompactionIndex + 1 : 0
  let lastUserIndex = -1
  const assistantIndices: number[] = []

  for (let i = activeStartIndex; i < messages.length; i++) {
    const m = messages[i]!
    if (isUserMessage(m)) {
      lastUserIndex = i
    } else if (isAssistantMessage(m)) {
      assistantIndices.push(i)
    }
  }

  const totalActiveChars = measureMessagesChars(messages, activeStartIndex)
  const estimatedInputTokensBefore = estimateTokens(totalActiveChars)
  const assistantStepsTotal = assistantIndices.length
  const assistantStepsAfterLastUser = assistantIndices.filter((idx) => idx > lastUserIndex).length

  const isAutoMode =
    options.mode === "auto" ||
    (options.mode === undefined &&
      (options.modelContextWindowTokens !== undefined || options.autoPruneThresholdRatio !== undefined)) ||
    (options.mode === "step-window" &&
      options.keepRecentSteps === undefined &&
      (options.modelContextWindowTokens !== undefined || options.autoPruneThresholdRatio !== undefined))

  let effectiveMode: PruningMode =
    options.mode === "auto" || options.mode === undefined ? "step-window" : options.mode
  let keepRecentSteps = Math.max(
    1,
    options.keepRecentSteps ??
      (isAutoMode
        ? (options.autoKeepRecentSteps ?? options.autoPruneKeepRecentSteps ?? DEFAULT_AUTO_KEEP_RECENT_STEPS)
        : DEFAULT_KEEP_RECENT_STEPS),
  )

  let anchorIndex = activeStartIndex
  let anchorReason: WatermarkAnchorReason = "no-op"
  let autoActivated = false

  if (isAutoMode) {
    const windowTokens = options.modelContextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    const thresholdRatio = options.autoPruneThresholdRatio ?? DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO
    const thresholdTokens = Math.floor(windowTokens * thresholdRatio)
    if (estimatedInputTokensBefore > thresholdTokens && assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]!
      anchorReason = "auto-threshold-step-window"
      autoActivated = true
    } else {
      anchorIndex = activeStartIndex
      anchorReason = "no-op"
      autoActivated = false
    }
  } else if (effectiveMode === "step-window") {
    if (assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]!
      anchorReason = "step-window"
    } else {
      anchorIndex = activeStartIndex
      anchorReason = "no-op"
    }
  } else if (effectiveMode === "recent") {
    const onlyInitialUserInWindow = lastUserIndex <= activeStartIndex
    if (onlyInitialUserInWindow && assistantStepsAfterLastUser > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]!
      anchorReason = "recent-step-fallback"
    } else if (lastUserIndex > activeStartIndex) {
      anchorIndex = lastUserIndex
      anchorReason = "recent-user-prompt"
    } else {
      anchorIndex = activeStartIndex
      anchorReason = "no-op"
    }
  } else {
    if (lastUserIndex > activeStartIndex) {
      anchorIndex = lastUserIndex
      anchorReason = "initial-history"
    } else if (assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]!
      anchorReason = "initial-history"
    } else {
      anchorIndex = activeStartIndex
      anchorReason = "no-op"
    }
  }

  const anchorMessageID =
    anchorIndex > activeStartIndex && anchorIndex < messages.length
      ? ((messages[anchorIndex]?.id as string | undefined) ?? null)
      : null

  const assistantStepsThinned = assistantIndices.filter((idx) => idx < anchorIndex).length
  const assistantStepsKept = assistantStepsTotal - assistantStepsThinned

  return {
    mode: effectiveMode,
    keepRecentSteps,
    activeStartIndex,
    anchorMessageID,
    anchorIndex,
    anchorReason,
    lastUserIndex,
    lastCompactionIndex,
    assistantStepsTotal,
    assistantStepsAfterLastUser,
    assistantStepsKept,
    assistantStepsThinned,
    estimatedInputTokensBefore,
    totalActiveChars,
    autoActivated,
  }
}

export function extractReadLineRange(input: Record<string, any>, outputText: string): string {
  const headerMatch = /^Read file [^\n]+, lines (\d+)-(\d+)/.exec(outputText)
  if (headerMatch) {
    return `L${headerMatch[1]}-L${headerMatch[2]}`
  }
  const start = typeof input.offset === "number" && input.offset > 0 ? input.offset : 1
  const lineMatches = [...outputText.matchAll(/^(\d+):/gm)]
  if (lineMatches.length > 0) {
    const first = lineMatches[0]![1]!
    const last = lineMatches[lineMatches.length - 1]![1]!
    return `L${first}-L${last}`
  }
  if (typeof input.limit === "number" && input.limit > 0) {
    return `L${start}-L${start + input.limit - 1}`
  }
  const lineCount = Math.max(1, outputText.split("\n").length)
  return `L${start}-L${start + lineCount - 1}`
}

export function summarizeReadOutput(path: string, outputText: string): string {
  const rawLines = outputText.split("\n")
  const startSlice = /^Read file [^\n]+/.test(rawLines[0] ?? "") ? rawLines.slice(1, 80) : rawLines.slice(0, 80)
  const lines = startSlice
    .map((line) => line.replace(/^\d+:\s?/, "").trim())
    .filter((line) => line.length > 0 && line !== "---")

  if (/\.(ts|tsx|js|mjs|cjs)$/.test(path)) {
    const exportsFound: string[] = []
    for (const line of lines) {
      const m = /^export\s+(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/.exec(line)
      if (m && !exportsFound.includes(m[1]!)) {
        exportsFound.push(m[1]!)
      }
      if (exportsFound.length >= 4) break
    }
    if (exportsFound.length > 0) {
      return `exports: ${exportsFound.join(", ")}`
    }
    const testMatch = lines.find((l) => /^(?:describe|test|it)\(["'`]/.test(l))
    if (testMatch) {
      return testMatch.slice(0, 96)
    }
  }

  const heading = lines.find((l) => /^#{1,3}\s+/.test(l))
  if (heading) {
    return heading.replace(/^#{1,3}\s+/, "").slice(0, 96)
  }

  const firstContent = lines.find((l) => !l.startsWith("import ") && !l.startsWith("//")) ?? lines[0] ?? "file slice"
  return firstContent.slice(0, 96)
}

export function summarizeSkillOutput(skillName: string, outputText: string): string {
  const lines = outputText
    .replace(/<\/?skill_content[^>]*>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.startsWith("#") &&
        !l.startsWith("---") &&
        !l.startsWith("name:") &&
        !l.startsWith("description:"),
    )
  const firstLine = lines[0] ?? `Loaded ${skillName} guidance`
  return firstLine.slice(0, 96)
}

export function summarizeToolOutput(tool: string, _input: Record<string, any>, outputText: string): string {
  const trimmed = outputText.trim()
  if (trimmed.length === 0) return "empty output"
  if (tool === "grep") {
    const firstLine = trimmed.split("\n")[0] ?? "grep results"
    return firstLine.slice(0, 96)
  }
  if (tool === "glob") {
    const lines = trimmed.split("\n").filter((l) => l.trim().length > 0)
    return `${lines.length} paths matched (${lines[0]?.split("/").pop() ?? "files"})`.slice(0, 96)
  }
  if (tool === "patch" || tool === "write" || tool === "edit") {
    return trimmed.replace(/\s+/g, " ").slice(0, 96)
  }
  const nonEmpty = trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const summary = nonEmpty.slice(0, 2).join(" · ")
  return summary.slice(0, 96)
}

export function extractTargetLabel(tool: string, input: Record<string, any>, outputText: string): string {
  if (tool === "read" || tool === "write" || tool === "edit") {
    return String(input.path ?? input.filePath ?? "unknown")
  }
  if (tool === "skill") {
    const fromInput = input.id ?? input.name ?? input.skill
    if (typeof fromInput === "string" && fromInput.length > 0) return fromInput
    return SKILL_NAME_RE.exec(outputText)?.[1] ?? "unknown"
  }
  if (tool === "grep" || tool === "glob") {
    const pattern = String(input.pattern ?? "")
    const p = input.path ? ` in ${String(input.path)}` : ""
    return `${pattern}${p}`.trim().slice(0, 80) || tool
  }
  if (tool === "shell" || tool === "bash") {
    const cmd = String(input.command ?? "").replace(/\s+/g, " ").trim()
    return cmd.length > 64 ? `${cmd.slice(0, 64)}…` : cmd || tool
  }
  if (tool === "patch") {
    const patchText = String(input.patchText ?? "")
    const files = [...patchText.matchAll(/\*\*\* (?:Add|Update|Delete) File: ([^\n]+)/g)].map((m) => m[1]!.trim())
    return files.join(", ").slice(0, 80) || "patch"
  }
  if (tool === "execute") {
    const code = String(input.code ?? "").replace(/\s+/g, " ").trim()
    return code.length > 64 ? `${code.slice(0, 64)}…` : code || "execute"
  }
  return String(input.description ?? input.agent ?? input.path ?? tool).slice(0, 64)
}

export function formatFactBreadcrumb(params: {
  readonly callId: string
  readonly messageId: string
  readonly tool: string
  readonly target: string
  readonly lineRange: string | null
  readonly originalChars: number
  readonly blobSha256: string
  readonly summary: string
  readonly status: BreadcrumbStatus
}): FactBreadcrumb {
  const shortSha = params.blobSha256.slice(0, 12)
  const blobRef = `blob:${shortSha}`
  const targetWithRange =
    params.tool === "read" && params.lineRange && !params.target.includes("#L")
      ? `${params.target}#${params.lineRange}`
      : params.target

  const rendered = `[Pruned ${params.tool} ${targetWithRange} (${params.originalChars} chars) -> ${blobRef} | ${params.summary} | status: ${params.status}; call substrate.viewport({ action: "resolve", blob: "${shortSha}" }) if exact lines needed]`

  return {
    callId: params.callId,
    messageId: params.messageId,
    tool: params.tool,
    target: params.target,
    lineRange: params.lineRange,
    originalChars: params.originalChars,
    blobSha256: params.blobSha256,
    blobRef,
    summary: params.summary,
    status: params.status,
    rendered,
  }
}

export function thinInputShapePreserving(input: unknown): unknown {
  if (typeof input !== "object" || input === null) {
    return `[context-prune: input thinned (~${JSON.stringify(input)?.length ?? 0} chars)]`
  }
  if (Array.isArray(input)) {
    return `[context-prune: array input thinned (${input.length} items)]`
  }
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if (typeof value === "string") {
        return [
          key,
          value.length <= FIELD_LIMIT
            ? value
            : `${value.slice(0, FIELD_LIMIT)}…[context-prune: ${value.length - FIELD_LIMIT} more chars]`,
        ]
      }
      if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
        return [key, value]
      }
      return [key, `[context-prune: ~${JSON.stringify(value)?.length ?? 0} chars]`]
    }),
  )
}

export const thinInput = thinInputShapePreserving

export class BlobStore {
  readonly blobDir: string
  readonly readOnlyArchiveDir: string | null
  readonly persistToDisk: boolean
  private readonly memoryBlobs = new Map<string, string>()
  private readonly prefixIndex = new Map<string, string>()
  private writtenCount = 0
  private reusedCount = 0
  private dirCreated = false

  constructor(
    options: {
      readonly blobDir?: string
      readonly readOnlyArchiveDir?: string | null
      readonly persistToDisk?: boolean
    } = {},
  ) {
    this.blobDir = options.blobDir ?? join(process.cwd(), ".session-archive", "blobs")
    this.readOnlyArchiveDir = options.readOnlyArchiveDir ?? null
    this.persistToDisk = options.persistToDisk ?? true
  }

  sink(content: string, options?: { readonly persistToDisk?: boolean }): { readonly sha256: string; readonly blobRef: string } {
    const sha256 = sha256Hex(content)
    const short = sha256.slice(0, 12)
    this.prefixIndex.set(short, sha256)

    if (this.memoryBlobs.has(sha256)) {
      this.reusedCount += 1
      return { sha256, blobRef: `blob:${short}` }
    }

    this.memoryBlobs.set(sha256, content)
    const shouldWriteDisk = options?.persistToDisk ?? this.persistToDisk
    if (shouldWriteDisk) {
      if (!this.dirCreated) {
        mkdirSync(this.blobDir, { recursive: true })
        this.dirCreated = true
      }
      const targetPath = join(this.blobDir, `${sha256}.txt`)
      if (existsSync(targetPath)) {
        this.reusedCount += 1
      } else {
        writeFileSync(targetPath, content, "utf8")
        this.writtenCount += 1
      }
    } else {
      this.writtenCount += 1
    }

    return { sha256, blobRef: `blob:${short}` }
  }

  registerExistingSha(sha256: string, content?: string): string {
    const short = sha256.slice(0, 12)
    this.prefixIndex.set(short, sha256)
    if (content !== undefined && !this.memoryBlobs.has(sha256)) {
      this.memoryBlobs.set(sha256, content)
    }
    return `blob:${short}`
  }

  resolveWithSha(blobRefOrSha: string): { readonly sha256: string; readonly content: string } | null {
    const raw = blobRefOrSha.startsWith("blob:") ? blobRefOrSha.slice(5) : blobRefOrSha
    const fullSha = this.prefixIndex.get(raw) ?? (raw.length === 64 ? raw : this.findMatchingDiskSha(raw))
    if (!fullSha) return null

    const inMem = this.memoryBlobs.get(fullSha)
    if (inMem !== undefined) return { sha256: fullSha, content: inMem }

    const localPath = join(this.blobDir, `${fullSha}.txt`)
    if (existsSync(localPath)) {
      const txt = readFileSync(localPath, "utf8")
      this.memoryBlobs.set(fullSha, txt)
      return { sha256: fullSha, content: txt }
    }

    if (this.readOnlyArchiveDir) {
      const archiveBlobPath = join(this.readOnlyArchiveDir, "blobs", `${fullSha}.txt`)
      if (existsSync(archiveBlobPath)) {
        const txt = readFileSync(archiveBlobPath, "utf8")
        this.memoryBlobs.set(fullSha, txt)
        return { sha256: fullSha, content: txt }
      }
    }

    return null
  }

  resolve(blobRefOrSha: string): string | null {
    return this.resolveWithSha(blobRefOrSha)?.content ?? null
  }

  private findMatchingDiskSha(prefix: string): string | null {
    for (const [short, full] of this.prefixIndex.entries()) {
      if (short.startsWith(prefix) || full.startsWith(prefix)) {
        return full
      }
    }
    for (const dir of [
      this.blobDir,
      this.readOnlyArchiveDir ? join(this.readOnlyArchiveDir, "blobs") : null,
    ]) {
      if (!dir || !existsSync(dir)) continue
      const match = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".txt"))
      if (match) {
        const full = match.slice(0, -4)
        this.prefixIndex.set(full.slice(0, 12), full)
        return full
      }
    }
    return null
  }

  stats(): { readonly written: number; readonly reused: number } {
    return { written: this.writtenCount, reused: this.reusedCount }
  }
}

function extractShellCatSlices(
  command: string,
  outputText: string,
): readonly {
  readonly path: string
  readonly content: string
}[] {
  const results: { path: string; content: string }[] = []
  const catPaths: string[] = []
  for (const m of command.matchAll(/\bcat\s+([^\s;|&"']+)/g)) {
    const p = m[1]!.trim()
    if (!p.startsWith("-") && !p.startsWith("$") && (p.includes("/") || p.includes("."))) {
      catPaths.push(p)
    }
  }
  for (const m of command.matchAll(/for\s+\w+\s+in\s+([^\n;]+);\s*do\s+if\s+test\s+-f[\s\S]*?cat\s+"?\$\w+"?/g)) {
    const candidates = m[1]!.trim().split(/\s+/)
    if (candidates[0]) catPaths.push(candidates[0])
  }

  if (catPaths.length === 0) return results

  const sections = outputText.split(/\n(?=--- [A-Z0-9 _-]+ ---\n)/)
  for (const rawPath of catPaths) {
    const base = rawPath.split("/").pop() ?? rawPath
    const matchingSection =
      sections.find((sec) => sec.includes(rawPath)) ??
      sections.find((sec) => sec.toLowerCase().includes(base.replace(/\.md$/, "").toLowerCase())) ??
      outputText
    results.push({ path: rawPath, content: matchingSection })
  }
  return results
}

function extractPatchFiles(
  patchText: string,
): readonly {
  readonly operation: "add" | "update"
  readonly path: string
  readonly hunkText: string
}[] {
  const results: { operation: "add" | "update"; path: string; hunkText: string }[] = []
  const parts = patchText.split(/(?=\*\*\* (?:Add|Update) File: )/)
  for (const chunk of parts) {
    const m = /^\*\*\* (Add|Update) File: ([^\n]+)\n([\s\S]*)/.exec(chunk)
    if (!m) continue
    results.push({
      operation: m[1] === "Add" ? "add" : "update",
      path: m[2]!.trim(),
      hunkText: chunk.trim(),
    })
  }
  return results
}

function isCrossSessionContinuityArtifact(normPath: string): boolean {
  return (
    normPath.startsWith(".audit/") ||
    normPath.startsWith(".planning/human-used-prompting/") ||
    normPath.includes("/skills/") ||
    normPath === "STATE.md" ||
    normPath === "AGENTS.md" ||
    normPath === ".opencode/AGENTS.md" ||
    normPath === "GLOSSARY.md"
  )
}

export function renderWorkingMemoryManifest(
  manifest: Omit<WorkingMemoryManifest, "renderedMarkdown" | "markdown">,
): string {
  const lines: string[] = [
    `## WorkingMemoryManifest · \`${manifest.sessionID}\` (Do-Not-Reread Ledger)`,
    `> **Directive:** Every file slice and skill below is indexed in Retrievable Memory with a SHA-256 blob handle. **DO NOT re-read \`FRESH — DO NOT REREAD\` files or re-invoke \`ACTIVE — DO NOT RE-INVOKE\` skills.** Call \`substrate.viewport({ action: "resolve", blob: "<sha12>" })\` only if exact lines are needed.`,
    "",
    `### Files Already Read (${manifest.filesRead.length})`,
  ]

  for (const f of manifest.filesRead) {
    const shortPath = f.normalizedPath || f.path
    const sliceHint =
      f.status.startsWith("SLICE ") && f.startLine != null && f.endLine != null
        ? ` (Do NOT re-read L${f.startLine}-L${f.endLine}; read offset=${f.endLine + 1})`
        : ""
    lines.push(
      `- \`${shortPath}#${f.lineRange}\` (${f.chars} chars) -> \`${f.blobRef}\` | ${f.summary.slice(0, 72)} | **${f.status}**${sliceHint}`,
    )
  }

  if (manifest.filesModified.length > 0) {
    lines.push("", `### Files Modified (${manifest.filesModified.length})`)
    for (const m of manifest.filesModified) {
      const shortPath = m.normalizedPath || m.path
      lines.push(
        `- \`${shortPath}\` [${m.operation} via \`${m.tool}\` at \`${m.messageId}\`] -> \`${m.blobRef}\` (${m.status})`,
      )
    }
  }

  if (manifest.activeSkills.length > 0) {
    lines.push("", `### Active Skills Loaded (${manifest.activeSkills.length} — DO NOT RE-INVOKE)`)
    for (const s of manifest.activeSkills) {
      lines.push(`- \`@${s.name}\` (${s.chars} chars) -> \`${s.blobRef}\` | ${s.summary.slice(0, 64)} | **${s.status}**`)
    }
  }

  if (manifest.delegationOutcomes.length > 0) {
    lines.push("", `### Delegation Outcomes (${manifest.delegationOutcomes.length})`)
    for (const d of manifest.delegationOutcomes) {
      const childLabel = d.childSessionID ?? d.callId
      lines.push(
        `- \`${childLabel}\` (${d.harness}/${d.agent}): ${d.description} | reported=\`${d.reportedStatus}\` verified=\`${d.verifiedStatus}\` (\`${d.blobRef}\`)`,
      )
    }
  }

  return lines.join("\n")
}

export class WorkingSetValve {
  readonly blobStore: BlobStore
  private readonly ledgers = new Map<string, ValveExecutionLedger>()
  private readonly hookReads = new Map<string, Map<string, ManifestFileReadEntry>>()
  private readonly options: ValveOptions

  constructor(options: ValveOptions = {}) {
    this.options = options
    this.blobStore = new BlobStore({
      blobDir: options.blobDir,
      readOnlyArchiveDir: options.readOnlyArchiveDir,
      persistToDisk: options.persistBlobsToDisk ?? true,
    })
  }

  getLedger(sessionID: string): ValveExecutionLedger | null {
    return this.ledgers.get(sessionID) ?? null
  }

  resolve(blobRef: string): string | null {
    return this.blobStore.resolve(blobRef)
  }

  resolveBlob(
    blobRefOrSha: string,
    options?: { readonly startLine?: number; readonly endLine?: number },
  ): {
    readonly blobRef: string
    readonly sha256: string
    readonly content: string
    readonly slice: string
    readonly startLine: number
    readonly endLine: number
    readonly totalLines: number
  } | null {
    const resolved = this.blobStore.resolveWithSha(blobRefOrSha)
    if (!resolved) return null
    const lines = resolved.content.split("\n")
    const totalLines = lines.length
    const startLine = Math.max(1, Math.min(totalLines, options?.startLine ?? 1))
    const endLine = Math.max(startLine, Math.min(totalLines, options?.endLine ?? totalLines))
    const slice = lines.slice(startLine - 1, endLine).join("\n")
    return {
      blobRef: `blob:${resolved.sha256.slice(0, 12)}`,
      sha256: resolved.sha256,
      content: resolved.content,
      slice,
      startLine,
      endLine,
      totalLines,
    }
  }

  recordReadFromHook(
    sessionIDOrParams:
      | string
      | {
          readonly sessionID: string
          readonly callId?: string
          readonly path?: string
          readonly outputText?: string
          readonly rawOutput?: string
          readonly input?: Record<string, unknown>
          readonly canonicalRoot?: string
        },
    inputArg?: Record<string, unknown>,
    rawOutputArg?: string,
    canonicalRootArg?: string,
  ): FileReadCapture & { readonly status: FreshnessStatus } {
    let sessionID: string
    let input: Record<string, unknown>
    let rawOutput: string
    let canonicalRoot: string | undefined
    let callId = "hook_read"

    if (typeof sessionIDOrParams === "string") {
      sessionID = sessionIDOrParams
      input = inputArg ?? {}
      rawOutput = rawOutputArg ?? ""
      canonicalRoot = canonicalRootArg
    } else {
      sessionID = sessionIDOrParams.sessionID
      callId = sessionIDOrParams.callId ?? "hook_read"
      rawOutput = sessionIDOrParams.outputText ?? sessionIDOrParams.rawOutput ?? ""
      input = {
        ...(sessionIDOrParams.input ?? {}),
        ...(sessionIDOrParams.path ? { filePath: sessionIDOrParams.path } : {}),
      }
      canonicalRoot = sessionIDOrParams.canonicalRoot
    }

    const effectiveRoot = canonicalRoot ?? this.options.canonicalRoot
    const capture = parseReadToolOutput(rawOutput, input, effectiveRoot)
    const { blobRef, sha256 } = this.blobStore.sink(rawOutput)
    const status: FreshnessStatus =
      capture.isTruncated ||
      capture.startLine > 1 ||
      (capture.totalLines !== null && capture.endLine < capture.totalLines)
        ? (formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines) as FreshnessStatus)
        : "FRESH — DO NOT REREAD"

    let sessionMap = this.hookReads.get(sessionID)
    if (!sessionMap) {
      sessionMap = new Map()
      this.hookReads.set(sessionID, sessionMap)
    }
    sessionMap.set(capture.normalizedPath, {
      path: capture.path,
      normalizedPath: capture.normalizedPath,
      lineRange: capture.lineRange,
      startLine: capture.startLine,
      endLine: capture.endLine,
      totalLines: capture.totalLines,
      isTruncated: capture.isTruncated,
      chars: rawOutput.length,
      blobRef,
      blobSha256: sha256,
      sliceSha256: capture.sliceSha,
      summary: summarizeReadOutput(capture.normalizedPath, capture.cleanText),
      status,
      messageId: callId,
      sourceSessionId: sessionID,
    })

    return {
      ...capture,
      status,
    }
  }

  prune(params: {
    readonly sessionID: string
    readonly mode?: PruningMode
    readonly keepRecentSteps?: number
    readonly messages: readonly Record<string, any>[]
    readonly diskHashesByPath?: ReadonlyMap<string, string>
  }): {
    readonly ledger: ValveExecutionLedger
    readonly summaryMarkdown: string
  } {
    const ledger = this.armValve({
      sessionID: params.sessionID,
      mode: params.mode ?? "step-window",
      keepRecentSteps: params.keepRecentSteps,
      messages: params.messages,
      diskHashesByPath: params.diskHashesByPath,
    })
    const summaryMarkdown = [
      `WorkingSetValve armed for session \`${ledger.sessionID}\` (mode: \`${ledger.mode}\`, keepRecentSteps: \`${ledger.keepRecentSteps}\`, reason: \`${ledger.watermark.anchorReason}\`).`,
      `Anchor: \`${ledger.watermark.anchorMessageID ?? "none"}\` (index ${ledger.watermark.anchorIndex}); ${ledger.watermark.assistantStepsThinned}/${ledger.watermark.assistantStepsTotal} assistant steps thinned (${ledger.metrics.toolPartsThinned} tool parts, ~${ledger.metrics.netTokensFreed} net tokens freed).`,
      `Manifest: ${ledger.manifest.filesRead.length} files read, ${ledger.manifest.filesModified.length} files modified, ${ledger.manifest.activeSkills.length} active skills.`,
    ].join("\n")
    return { ledger, summaryMarkdown }
  }

  status(sessionID: string): {
    readonly armed: boolean
    readonly ledger: ValveExecutionLedger | null
    readonly summaryMarkdown: string
    readonly manifestMarkdown: string
  } {
    const ledger = this.ledgers.get(sessionID) ?? null
    const hookMap = this.hookReads.get(sessionID)
    const fallbackManifest = renderWorkingMemoryManifest({
      sessionID,
      filesRead: hookMap ? [...hookMap.values()] : [],
      filesModified: [],
      activeSkills: [],
      delegationOutcomes: [],
    })
    if (!ledger) {
      return {
        armed: false,
        ledger: null,
        summaryMarkdown: `WorkingSetValve is currently unarmed for session \`${sessionID}\`.`,
        manifestMarkdown: fallbackManifest,
      }
    }
    return {
      armed: true,
      ledger,
      summaryMarkdown: [
        `WorkingSetValve is armed for session \`${sessionID}\` (mode: \`${ledger.mode}\`, keepRecentSteps: \`${ledger.keepRecentSteps}\`, anchor: \`${ledger.watermark.anchorMessageID ?? "none"}\`).`,
        `Thinned: ${ledger.metrics.toolPartsThinned} tool parts (~${ledger.metrics.netTokensFreed} net tokens freed).`,
      ].join("\n"),
      manifestMarkdown: ledger.manifest.renderedMarkdown,
    }
  }

  reset(sessionID: string): {
    readonly reset: boolean
    readonly sessionID: string
    readonly summaryMarkdown: string
  } {
    const existed = this.ledgers.delete(sessionID)
    this.hookReads.delete(sessionID)
    return {
      reset: existed,
      sessionID,
      summaryMarkdown: existed
        ? `WorkingSetValve reset for session \`${sessionID}\`; full unpruned context restored for subsequent model calls.`
        : `WorkingSetValve was not armed for session \`${sessionID}\`.`,
    }
  }

  armValve(params: {
    readonly sessionID: string
    readonly mode: PruningMode | "auto"
    readonly keepRecentSteps?: number
    readonly messages: readonly Record<string, any>[]
    readonly diskHashesByPath?: ReadonlyMap<string, string>
    readonly persistBlobsToDisk?: boolean
    readonly modelContextWindowTokens?: number
    readonly autoPruneThresholdRatio?: number
  }): ValveExecutionLedger {
    const keepRecentSteps =
      params.keepRecentSteps ??
      (params.mode === "auto"
        ? (this.options.autoKeepRecentSteps ?? DEFAULT_AUTO_KEEP_RECENT_STEPS)
        : (this.options.keepRecentSteps ?? DEFAULT_KEEP_RECENT_STEPS))

    const watermark = computeStepWatermark(params.messages, {
      mode: params.mode,
      keepRecentSteps,
      modelContextWindowTokens: params.modelContextWindowTokens ?? this.options.modelContextWindowTokens,
      autoPruneThresholdRatio: params.autoPruneThresholdRatio ?? this.options.autoPruneThresholdRatio,
      autoKeepRecentSteps: params.keepRecentSteps ?? this.options.autoKeepRecentSteps,
    })

    const persistToDisk = params.persistBlobsToDisk ?? this.options.persistBlobsToDisk ?? true

    const breadcrumbsByCallId = new Map<string, FactBreadcrumb>()
    const thinnedInputsByCallId = new Map<string, unknown>()
    const skillBreadcrumbsByName = new Map<string, FactBreadcrumb>()

    const filesReadMap = new Map<string, ManifestFileReadEntry>()
    const filesModifiedMap = new Map<string, ManifestFileModifiedEntry>()
    const activeSkillsMap = new Map<string, ManifestSkillEntry>()
    const delegationMap = new Map<string, ManifestDelegationEntry>()

    const recordFileRead = (entry: ManifestFileReadEntry) => {
      const key = entry.normalizedPath || entry.path
      const prev = filesReadMap.get(key)
      if (!prev || entry.chars >= prev.chars || entry.sourceSessionId === params.sessionID) {
        filesReadMap.set(key, entry)
      }
    }

    const recordSkill = (entry: ManifestSkillEntry) => {
      const prev = activeSkillsMap.get(entry.name)
      if (!prev || entry.chars >= prev.chars || entry.sourceSessionId === params.sessionID) {
        activeSkillsMap.set(entry.name, entry)
      }
    }

    const recordCrossSessionFileRead = (entry: ManifestFileReadEntry) => {
      if (isCrossSessionContinuityArtifact(entry.normalizedPath || entry.path)) {
        recordFileRead(entry)
      }
    }

    for (const prior of this.options.priorWorktreeMessages ?? []) {
      this.scanMessagesIntoManifest(
        prior.sessionID,
        prior.messages,
        prior.messages.length,
        false,
        persistToDisk,
        breadcrumbsByCallId,
        thinnedInputsByCallId,
        skillBreadcrumbsByName,
        recordCrossSessionFileRead,
        filesModifiedMap,
        recordSkill,
        delegationMap,
      )
    }

    const stats = this.scanMessagesIntoManifest(
      params.sessionID,
      params.messages,
      watermark.anchorIndex,
      true,
      persistToDisk,
      breadcrumbsByCallId,
      thinnedInputsByCallId,
      skillBreadcrumbsByName,
      recordFileRead,
      filesModifiedMap,
      recordSkill,
      delegationMap,
    )

    const diskHashes = params.diskHashesByPath ?? this.options.diskHashesByPath
    const canonicalRoot = this.options.canonicalRoot

    for (const [key, entry] of filesReadMap.entries()) {
      const diskHash = diskHashes?.get(entry.path) ?? diskHashes?.get(entry.normalizedPath)
      if (diskHash !== undefined) {
        const matches = diskHash === entry.blobSha256 || (entry.sliceSha256 !== undefined && diskHash === entry.sliceSha256)
        if (!matches) {
          filesReadMap.set(key, { ...entry, status: STALE_STATUS })
          for (const [callId, bc] of breadcrumbsByCallId.entries()) {
            if (bc.tool === "read" && normalizeRepoPath(bc.target, canonicalRoot) === entry.normalizedPath) {
              breadcrumbsByCallId.set(
                callId,
                formatFactBreadcrumb({
                  callId: bc.callId,
                  messageId: bc.messageId,
                  tool: bc.tool,
                  target: bc.target,
                  lineRange: bc.lineRange,
                  originalChars: bc.originalChars,
                  blobSha256: bc.blobSha256,
                  summary: bc.summary,
                  status: STALE_STATUS,
                }),
              )
            }
          }
        }
        continue
      }

      if (entry.status === STALE_STATUS) continue

      const shouldCheckDisk =
        (typeof canonicalRoot === "string" && canonicalRoot.length > 0) ||
        (isAbsolute(entry.path) && existsSync(entry.path))
      if (shouldCheckDisk) {
        const diskPath = resolveDiskPath(entry.path, canonicalRoot)
        if (existsSync(diskPath)) {
          const recon = computeDiskSliceSha(diskPath, {
            startLine: entry.startLine ?? 1,
            endLine: entry.endLine ?? 1,
            totalLines: entry.totalLines ?? null,
            isTruncated: Boolean(entry.isTruncated),
            sliceSha: entry.sliceSha256 ?? entry.blobSha256,
          })
          const nextLineRange = recon.state === "SLICE" ? recon.lineRange : entry.lineRange
          filesReadMap.set(key, {
            ...entry,
            lineRange: nextLineRange,
            totalLines: recon.currentTotalLines,
            isTruncated: recon.state === "SLICE",
            status: recon.stalenessStatus,
          })
          for (const [callId, bc] of breadcrumbsByCallId.entries()) {
            if (bc.tool === "read" && normalizeRepoPath(bc.target, canonicalRoot) === entry.normalizedPath) {
              breadcrumbsByCallId.set(
                callId,
                formatFactBreadcrumb({
                  callId: bc.callId,
                  messageId: bc.messageId,
                  tool: bc.tool,
                  target: bc.target,
                  lineRange: nextLineRange,
                  originalChars: bc.originalChars,
                  blobSha256: bc.blobSha256,
                  summary: bc.summary,
                  status: recon.stalenessStatus,
                }),
              )
            }
          }
        }
      }
    }

    const manifestCore = {
      sessionID: params.sessionID,
      filesRead: [...filesReadMap.values()],
      filesModified: [...filesModifiedMap.values()],
      activeSkills: [...activeSkillsMap.values()],
      delegationOutcomes: [...delegationMap.values()],
    }
    const renderedMarkdown = renderWorkingMemoryManifest(manifestCore)
    const manifest: WorkingMemoryManifest = {
      ...manifestCore,
      renderedMarkdown,
      markdown: renderedMarkdown,
    }

    const blobStats = this.blobStore.stats()
    const rawOutputFreed = stats.rawOutputCharsBefore - stats.breadcrumbCharsAfter
    const rawInputFreed = stats.rawInputCharsBefore - stats.thinnedInputCharsAfter
    const netCharsFreed = rawOutputFreed + rawInputFreed - renderedMarkdown.length

    const ledger: ValveExecutionLedger = {
      sessionID: params.sessionID,
      mode: watermark.mode,
      keepRecentSteps: watermark.keepRecentSteps,
      watermark,
      breadcrumbsByCallId,
      thinnedInputsByCallId,
      skillBreadcrumbsByName,
      manifest,
      metrics: {
        toolPartsThinned: stats.toolPartsThinned,
        rawOutputCharsBefore: stats.rawOutputCharsBefore,
        breadcrumbCharsAfter: stats.breadcrumbCharsAfter,
        rawInputCharsBefore: stats.rawInputCharsBefore,
        thinnedInputCharsAfter: stats.thinnedInputCharsAfter,
        manifestChars: renderedMarkdown.length,
        netCharsFreed,
        rawOutputTokensFreed: estimateTokens(rawOutputFreed),
        netTokensFreed: estimateTokens(netCharsFreed),
        blobsWritten: blobStats.written,
        blobsReused: blobStats.reused,
      },
      at: new Date().toISOString(),
    }

    this.ledgers.set(params.sessionID, ledger)
    return ledger
  }

  applyContextHookInMemory(
    event: {
      sessionID: string
      messages: Array<Record<string, any>>
      system?: Array<string | { type: "text"; text: string }>
    },
    options?: ContextHookApplyOptions,
  ): ContextHookApplyResult {
    const t0 = performance.now()
    let ledger = this.ledgers.get(event.sessionID)
    let trigger: "explicit-armed" | "auto-watermark-65pct" | "noop" = ledger ? "explicit-armed" : "noop"

    const windowTokens =
      options?.modelContextWindowTokens ??
      this.options.modelContextWindowTokens ??
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    const thresholdRatio =
      options?.autoPruneThresholdRatio ??
      this.options.autoPruneThresholdRatio ??
      DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO
    const autoK =
      options?.autoKeepRecentSteps ??
      options?.autoPruneKeepRecentSteps ??
      this.options.autoKeepRecentSteps ??
      DEFAULT_AUTO_KEEP_RECENT_STEPS

    if (!ledger) {
      const autoWatermark = computeStepWatermark(event.messages, {
        mode: "auto",
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio,
        autoKeepRecentSteps: autoK,
      })

      if (!autoWatermark.autoActivated || autoWatermark.anchorIndex <= autoWatermark.activeStartIndex) {
        return {
          applied: false,
          trigger: "noop",
          thinnedParts: 0,
          thinnedPartsCount: 0,
          anchorIndex: 0,
          watermark: autoWatermark,
          elapsedMs: performance.now() - t0,
        }
      }

      ledger = this.armValve({
        sessionID: event.sessionID,
        mode: "auto",
        keepRecentSteps: autoK,
        messages: event.messages,
        persistBlobsToDisk: false,
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio,
      })
      trigger = "auto-watermark-65pct"
    } else if (event.messages.length > ledger.watermark.anchorIndex + ledger.keepRecentSteps + 4) {
      const candidateWatermark = computeStepWatermark(event.messages, {
        mode: "auto",
        modelContextWindowTokens: windowTokens,
        autoPruneThresholdRatio: thresholdRatio,
        autoKeepRecentSteps: autoK,
      })
      if (candidateWatermark.autoActivated && candidateWatermark.anchorIndex > ledger.watermark.anchorIndex) {
        ledger = this.armValve({
          sessionID: event.sessionID,
          mode: "auto",
          keepRecentSteps: autoK,
          messages: event.messages,
          persistBlobsToDisk: false,
          modelContextWindowTokens: windowTokens,
          autoPruneThresholdRatio: thresholdRatio,
        })
        trigger = "auto-watermark-65pct"
      }
    }

    const messages = event.messages
    let boundary = -1
    if (ledger.watermark.anchorMessageID !== null) {
      boundary = messages.findIndex((m) => m.id === ledger!.watermark.anchorMessageID)
    } else if (
      ledger.mode === "step-window" ||
      ledger.watermark.anchorReason === "recent-step-fallback" ||
      ledger.watermark.anchorReason === "auto-threshold-step-window"
    ) {
      const w = computeStepWatermark(messages, {
        mode: ledger.mode,
        keepRecentSteps: ledger.keepRecentSteps,
      })
      boundary = w.anchorIndex
    } else if (ledger.mode === "initial" || ledger.mode === "all") {
      boundary = messages.findLastIndex((m) => isUserMessage(m))
    }

    if (boundary <= 0) {
      return {
        applied: false,
        trigger: "noop",
        thinnedParts: 0,
        thinnedPartsCount: 0,
        anchorIndex: 0,
        watermark: ledger.watermark,
        elapsedMs: performance.now() - t0,
      }
    }

    const manifestMarkdown = ledger.manifest.renderedMarkdown
    if (Array.isArray(event.system)) {
      const first = event.system[0]
      if (first && typeof first === "object" && "text" in first) {
        const exists = event.system.some(
          (item) => typeof item === "object" && item !== null && "text" in item && item.text === manifestMarkdown,
        )
        if (!exists) {
          event.system.unshift({ type: "text", text: manifestMarkdown })
        }
      } else if (!event.system.includes(manifestMarkdown)) {
        event.system.unshift(manifestMarkdown)
      }
    } else {
      ;(event as { system?: string[] }).system = [manifestMarkdown]
    }

    let thinnedParts = 0
    const startIdx = ledger.watermark.activeStartIndex < boundary ? ledger.watermark.activeStartIndex : 0

    for (let i = startIdx; i < boundary; i++) {
      const message = messages[i]
      if (!message || !Array.isArray(message.content)) continue

      for (const part of message.content) {
        if (typeof part !== "object" || part === null) continue
        if (part.providerExecuted === true || part.executed === true) continue

        if (part.type === "tool") {
          const callId = String(part.id ?? "")
          const name = String(part.name ?? "")
          const state = part.state
          if (!state || typeof state !== "object") continue

          if (!KEEP_INPUT.has(name) && state.input !== undefined) {
            state.input =
              ledger.thinnedInputsByCallId.get(callId) ?? thinInputShapePreserving(state.input)
          }

          if (!KEEP_RESULT.has(name) && state.status === "completed" && Array.isArray(state.content)) {
            const bc = ledger.breadcrumbsByCallId.get(callId)
            if (bc) {
              state.content = [{ type: "text", text: bc.rendered }]
              thinnedParts += 1
            }
          }
          continue
        }

        if (part.type === "tool-call") {
          const callId = String(part.id ?? "")
          const name = String(part.name ?? "")
          if (!KEEP_INPUT.has(name)) {
            part.input =
              ledger.thinnedInputsByCallId.get(callId) ?? thinInputShapePreserving(part.input)
          }
          continue
        }

        if (part.type === "tool-result") {
          const callId = String(part.id ?? "")
          const name = String(part.name ?? "")
          if (KEEP_RESULT.has(name)) continue
          const bc = ledger.breadcrumbsByCallId.get(callId)
          if (bc) {
            part.result = { type: "text", value: bc.rendered }
            thinnedParts += 1
          }
          continue
        }

        if (part.type === "text" && typeof part.text === "string" && part.text.includes("<skill_content")) {
          part.text = part.text.replace(SKILL_TAG_RE, (blob: string) => {
            const name = SKILL_NAME_RE.exec(blob)?.[1] ?? "unknown"
            const cached = ledger!.skillBreadcrumbsByName.get(name)
            if (cached) return cached.rendered
            const { sha256 } = this.blobStore.sink(blob, { persistToDisk: false })
            return formatFactBreadcrumb({
              callId: `inline_skill_${name}`,
              messageId: String(message.id ?? ""),
              tool: "skill",
              target: name,
              lineRange: null,
              originalChars: blob.length,
              blobSha256: sha256,
              summary: "Rules active in WorkingMemoryManifest",
              status: ACTIVE_SKILL_BREADCRUMB_STATUS,
            }).rendered
          })
        }
      }
    }

    return {
      applied: true,
      trigger,
      thinnedParts,
      thinnedPartsCount: thinnedParts,
      anchorIndex: boundary,
      watermark: ledger.watermark,
      elapsedMs: performance.now() - t0,
    }
  }

  private scanMessagesIntoManifest(
    sessionID: string,
    messages: readonly Record<string, any>[],
    thinBeforeIndex: number,
    isPrimarySession: boolean,
    persistToDisk: boolean,
    breadcrumbsByCallId: Map<string, FactBreadcrumb>,
    thinnedInputsByCallId: Map<string, unknown>,
    skillBreadcrumbsByName: Map<string, FactBreadcrumb>,
    recordFileRead: (entry: ManifestFileReadEntry) => void,
    filesModifiedMap: Map<string, ManifestFileModifiedEntry>,
    recordSkill: (entry: ManifestSkillEntry) => void,
    delegationMap: Map<string, ManifestDelegationEntry>,
  ): {
    readonly toolPartsThinned: number
    readonly rawOutputCharsBefore: number
    readonly breadcrumbCharsAfter: number
    readonly rawInputCharsBefore: number
    readonly thinnedInputCharsAfter: number
  } {
    let toolPartsThinned = 0
    let rawOutputCharsBefore = 0
    let breadcrumbCharsAfter = 0
    let rawInputCharsBefore = 0
    let thinnedInputCharsAfter = 0

    let activeStart = 0
    if (isPrimarySession) {
      for (let i = 0; i < messages.length; i++) {
        if (isCompactionMessage(messages[i]!)) activeStart = i + 1
      }
    }

    const markExistingReadsStale = (normPath: string, newSha256: string) => {
      const existingRead = filesReadMapGet(normPath)
      if (existingRead && existingRead.blobSha256 !== newSha256) {
        recordFileRead({ ...existingRead, status: STALE_STATUS })
      }
      for (const [cId, prevBc] of breadcrumbsByCallId.entries()) {
        if (
          prevBc.tool === "read" &&
          normalizeRepoPath(prevBc.target, this.options.canonicalRoot) === normPath &&
          prevBc.blobSha256 !== newSha256
        ) {
          breadcrumbsByCallId.set(
            cId,
            formatFactBreadcrumb({
              callId: prevBc.callId,
              messageId: prevBc.messageId,
              tool: prevBc.tool,
              target: prevBc.target,
              lineRange: prevBc.lineRange,
              originalChars: prevBc.originalChars,
              blobSha256: prevBc.blobSha256,
              summary: prevBc.summary,
              status: STALE_STATUS,
            }),
          )
        }
      }
    }

    const localReadsByPath = new Map<string, ManifestFileReadEntry>()
    const filesReadMapGet = (normPath: string) => localReadsByPath.get(normPath)
    const recordAndTrackRead = (entry: ManifestFileReadEntry) => {
      localReadsByPath.set(entry.normalizedPath || entry.path, entry)
      recordFileRead(entry)
    }

    for (let idx = 0; idx < messages.length; idx++) {
      const m = messages[idx]!
      const msgId = String(m.id ?? `msg_${idx}`)
      const inThinRange = isPrimarySession && idx >= activeStart && idx < thinBeforeIndex

      if (Array.isArray(m.skills)) {
        for (const s of m.skills) {
          const name = String(s.name ?? s.id ?? "")
          const text = String(s.text ?? "")
          if (name && text) {
            const { sha256, blobRef } = this.blobStore.sink(text, { persistToDisk })
            const summary = summarizeSkillOutput(name, text)
            recordSkill({
              name,
              chars: text.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID,
            })
          }
        }
      }

      if (!Array.isArray(m.content)) continue

      for (const part of m.content) {
        if (!part || typeof part !== "object") continue

        if (part.type === "text" && typeof part.text === "string" && part.text.includes("<skill_content")) {
          for (const match of part.text.matchAll(SKILL_TAG_RE)) {
            const blob = match[0]!
            const name = SKILL_NAME_RE.exec(blob)?.[1] ?? "unknown"
            const { sha256, blobRef } = this.blobStore.sink(blob, { persistToDisk })
            const summary = summarizeSkillOutput(name, blob)
            recordSkill({
              name,
              chars: blob.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID,
            })
            const bc = formatFactBreadcrumb({
              callId: `inline_skill_${name}`,
              messageId: msgId,
              tool: "skill",
              target: name,
              lineRange: null,
              originalChars: blob.length,
              blobSha256: sha256,
              summary,
              status: ACTIVE_SKILL_BREADCRUMB_STATUS,
            })
            skillBreadcrumbsByName.set(name, bc)
          }
        }

        const isDurableTool = part.type === "tool" && part.executed !== true
        const isHookResult = part.type === "tool-result" && part.providerExecuted !== true
        if (!isDurableTool && !isHookResult) continue

        const callId = String(part.id ?? "")
        const name = String(part.name ?? "")
        const input: Record<string, any> = isDurableTool
          ? (part.state?.input ?? {})
          : (m.content.find((p: any) => p.type === "tool-call" && p.id === callId)?.input ?? {})

        const outputText: string = isDurableTool
          ? Array.isArray(part.state?.content)
            ? part.state.content
                .map((c: any) => (c && c.type === "text" && typeof c.text === "string" ? c.text : ""))
                .join("")
            : typeof part.state?.output === "string"
              ? part.state.output
              : ""
          : typeof part.result?.value === "string"
            ? part.result.value
            : ""

        const { sha256, blobRef } = this.blobStore.sink(outputText, { persistToDisk })
        const target = extractTargetLabel(name, input, outputText)
        let readCaptureStatus: FreshnessStatus = FRESH_STATUS
        let readCaptureLineRange: string | null = null

        if (name === "read") {
          const capture = parseReadToolOutput(
            outputText,
            { ...input, path: target },
            this.options.canonicalRoot,
          )
          readCaptureStatus =
            capture.isTruncated || capture.startLine > 1
              ? formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines)
              : FRESH_STATUS
          readCaptureLineRange =
            capture.isTruncated || capture.startLine > 1
              ? capture.lineRange
              : extractReadLineRange(input, outputText)
          const summary = summarizeReadOutput(target, outputText)
          const normPath = normalizeRepoPath(target, this.options.canonicalRoot)
          recordAndTrackRead({
            path: target,
            normalizedPath: normPath,
            lineRange: readCaptureLineRange,
            startLine: capture.startLine,
            endLine: capture.endLine,
            totalLines: capture.totalLines,
            isTruncated: capture.isTruncated,
            chars: outputText.length,
            blobSha256: sha256,
            sliceSha256: capture.sliceSha,
            blobRef,
            summary,
            status: readCaptureStatus,
            messageId: msgId,
            sourceSessionId: sessionID,
          })

          const skillFileMatch = /\/skills\/([^/]+)\/SKILL\.md$/.exec(target)
          if (skillFileMatch) {
            const skillName = skillFileMatch[1]!
            recordSkill({
              name: skillName,
              chars: outputText.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: ACTIVE_SKILL_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID,
            })
          }
        } else if (name === "skill") {
          const summary = summarizeSkillOutput(target, outputText)
          recordSkill({
            name: target,
            chars: outputText.length,
            blobSha256: sha256,
            blobRef,
            summary,
            status: ACTIVE_SKILL_STATUS,
            messageId: msgId,
            sourceSessionId: sessionID,
          })
          skillBreadcrumbsByName.set(
            target,
            formatFactBreadcrumb({
              callId,
              messageId: msgId,
              tool: "skill",
              target,
              lineRange: null,
              originalChars: outputText.length,
              blobSha256: sha256,
              summary,
              status: ACTIVE_SKILL_BREADCRUMB_STATUS,
            }),
          )
        } else if (name === "patch" && typeof input.patchText === "string") {
          for (const patched of extractPatchFiles(input.patchText)) {
            const { sha256: pSha, blobRef: pRef } = this.blobStore.sink(patched.hunkText, { persistToDisk })
            const normPath = normalizeRepoPath(patched.path, this.options.canonicalRoot)
            if (isPrimarySession || isCrossSessionContinuityArtifact(normPath)) {
              filesModifiedMap.set(normPath, {
                path: patched.path,
                normalizedPath: normPath,
                operation: patched.operation,
                tool: "patch",
                messageId: msgId,
                blobRef: pRef,
                status: "COMMITTED_OR_APPLIED",
              })
            }
            if (localReadsByPath.has(normPath)) {
              markExistingReadsStale(normPath, pSha)
            } else {
              const pLines = Math.max(1, patched.hunkText.split("\n").length)
              recordAndTrackRead({
                path: patched.path,
                normalizedPath: normPath,
                lineRange: `L1-L${pLines}`,
                startLine: 1,
                endLine: pLines,
                isTruncated: false,
                chars: patched.hunkText.length,
                blobSha256: pSha,
                blobRef: pRef,
                summary: summarizeReadOutput(patched.path, patched.hunkText),
                status: FRESH_STATUS,
                messageId: msgId,
                sourceSessionId: sessionID,
              })
            }
          }
        } else if ((name === "write" || name === "edit") && (input.path || input.filePath)) {
          const filePath = String(input.path ?? input.filePath)
          const normPath = normalizeRepoPath(filePath, this.options.canonicalRoot)
          const body = String(input.content ?? input.newString ?? outputText)
          const { sha256: wSha, blobRef: wRef } = this.blobStore.sink(body, { persistToDisk })
          if (isPrimarySession || isCrossSessionContinuityArtifact(normPath)) {
            filesModifiedMap.set(normPath, {
              path: filePath,
              normalizedPath: normPath,
              operation: name,
              tool: name,
              messageId: msgId,
              blobRef: wRef,
              status: "COMMITTED_OR_APPLIED",
            })
          }
          if (localReadsByPath.has(normPath)) {
            markExistingReadsStale(normPath, wSha)
          } else {
            const wLines = Math.max(1, body.replace(/\n$/, "").split("\n").length)
            recordAndTrackRead({
              path: filePath,
              normalizedPath: normPath,
              lineRange: `L1-L${wLines}`,
              startLine: 1,
              endLine: wLines,
              isTruncated: false,
              chars: body.length,
              blobSha256: wSha,
              blobRef: wRef,
              summary: summarizeReadOutput(filePath, body),
              status: FRESH_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID,
            })
          }
        } else if ((name === "shell" || name === "bash") && typeof input.command === "string") {
          for (const catSlice of extractShellCatSlices(input.command, outputText)) {
            const { sha256: cSha, blobRef: cRef } = this.blobStore.sink(catSlice.content, { persistToDisk })
            const normPath = normalizeRepoPath(catSlice.path, this.options.canonicalRoot)
            const summary = summarizeReadOutput(catSlice.path, catSlice.content)
            const cLines = Math.max(1, catSlice.content.replace(/\n$/, "").split("\n").length)
            recordAndTrackRead({
              path: catSlice.path,
              normalizedPath: normPath,
              lineRange: `L1-L${cLines}`,
              startLine: 1,
              endLine: cLines,
              isTruncated: false,
              chars: catSlice.content.length,
              blobSha256: cSha,
              blobRef: cRef,
              summary,
              status: FRESH_STATUS,
              messageId: msgId,
              sourceSessionId: sessionID,
            })
            const skillMatch = /\/skills\/([^/]+)\/SKILL\.md$/.exec(catSlice.path)
            if (skillMatch) {
              const sName = skillMatch[1]!
              recordSkill({
                name: sName,
                chars: catSlice.content.length,
                blobSha256: cSha,
                blobRef: cRef,
                summary,
                status: ACTIVE_SKILL_STATUS,
                messageId: msgId,
                sourceSessionId: sessionID,
              })
              skillBreadcrumbsByName.set(
                sName,
                formatFactBreadcrumb({
                  callId: `${callId}_skill_${sName}`,
                  messageId: msgId,
                  tool: "skill",
                  target: sName,
                  lineRange: null,
                  originalChars: catSlice.content.length,
                  blobSha256: cSha,
                  summary,
                  status: ACTIVE_SKILL_BREADCRUMB_STATUS,
                }),
              )
            }
          }
        } else if (isPrimarySession && KEEP_RESULT.has(name)) {
          const childSessionID =
            (part.state?.metadata?.sessionID as string | undefined) ??
            /sessionID[:=]\s*"?([a-zA-Z0-9_]+)"?/.exec(outputText)?.[1] ??
            null
          const harness = String(input.harness ?? (name === "delegate-devin" ? "devin" : "opencode"))
          const agent = String(input.agent ?? name)
          const description = String(input.description ?? target)
          const isCompleted =
            outputText.includes('state="completed"') || !outputText.includes("working in the background")
          delegationMap.set(callId, {
            callId,
            childSessionID,
            tool: name,
            harness,
            agent,
            description,
            reportedStatus: isCompleted ? "completed" : "dispatched_background",
            verifiedStatus: isCompleted ? "completed_report_only" : "unverified_in_flight",
            blobRef,
          })
        }

        if (inThinRange) {
          toolPartsThinned += 1
          const lineRange = name === "read" ? (readCaptureLineRange ?? extractReadLineRange(input, outputText)) : null
          const summary =
            name === "read"
              ? summarizeReadOutput(target, outputText)
              : name === "skill"
                ? summarizeSkillOutput(target, outputText)
                : summarizeToolOutput(name, input, outputText)

          const bc = formatFactBreadcrumb({
            callId,
            messageId: msgId,
            tool: name,
            target,
            lineRange,
            originalChars: outputText.length,
            blobSha256: sha256,
            summary,
            status: name === "skill" ? ACTIVE_SKILL_BREADCRUMB_STATUS : name === "read" ? readCaptureStatus : FRESH_STATUS,
          })
          breadcrumbsByCallId.set(callId, bc)

          if (!KEEP_RESULT.has(name)) {
            rawOutputCharsBefore += outputText.length
            breadcrumbCharsAfter += bc.rendered.length
          }

          if (!KEEP_INPUT.has(name)) {
            const rawInStr = JSON.stringify(input) ?? "{}"
            const thinnedIn = thinInputShapePreserving(input)
            const thinnedInStr = JSON.stringify(thinnedIn) ?? "{}"
            thinnedInputsByCallId.set(callId, thinnedIn)
            rawInputCharsBefore += rawInStr.length
            thinnedInputCharsAfter += thinnedInStr.length
          }
        }
      }
    }

    return {
      toolPartsThinned,
      rawOutputCharsBefore,
      breadcrumbCharsAfter,
      rawInputCharsBefore,
      thinnedInputCharsAfter,
    }
  }
}

export function applyContextHookInMemory(
  event: {
    sessionID: string
    messages: Array<Record<string, any>>
    system?: Array<string | { type: "text"; text: string }>
  },
  valveOrLedger?: WorkingSetValve | ValveExecutionLedger | null,
  options?: ContextHookApplyOptions,
): ContextHookApplyResult {
  if (valveOrLedger instanceof WorkingSetValve) {
    return valveOrLedger.applyContextHookInMemory(event, options)
  }
  const tempValve = new WorkingSetValve({
    persistBlobsToDisk: false,
    autoPruneThresholdRatio: options?.autoPruneThresholdRatio,
    autoKeepRecentSteps: options?.autoKeepRecentSteps ?? options?.autoPruneKeepRecentSteps,
    modelContextWindowTokens: options?.modelContextWindowTokens,
  })
  if (valveOrLedger) {
    ;(tempValve as any).ledgers.set(event.sessionID, valveOrLedger)
  }
  return tempValve.applyContextHookInMemory(event, options)
}

export function cloneMessagesForHook(messages: readonly Record<string, any>[]): Array<Record<string, any>> {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return { ...m }
    return {
      ...m,
      content: m.content.map((p: any) => {
        if (!p || typeof p !== "object") return p
        if (p.type === "tool" && p.state) {
          return {
            ...p,
            state: {
              ...p.state,
              content: Array.isArray(p.state.content) ? [...p.state.content] : p.state.content,
            },
          }
        }
        return { ...p }
      }),
    }
  })
}
