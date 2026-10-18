import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { sha256hex } from "../../src/archive/normalize.ts"

export const DEFAULT_BLOB_DIR =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-02-blobs"
export const DEFAULT_READONLY_ARCHIVE_DIR =
  "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive"
export const SESSION_1_PATH =
  "/var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json"
export const SESSION_2_PATH =
  "/var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json"

export const DEFAULT_KEEP_RECENT_STEPS = 8
const FIELD_LIMIT = 280
const KEEP_RESULT = new Set(["subagent", "task", "delegate-devin", "hivemind-delegate"])
const KEEP_INPUT = new Set(["read", "write", "edit"])
const SKILL_TAG_RE = /<skill_content\b[^>]*>[\s\S]*?<\/skill_content>/g
const SKILL_NAME_RE = /name="([^"]+)"/

export type PruningMode = "step-window" | "recent" | "initial"

export type FreshnessStatus = "FRESH — DO NOT REREAD" | "STALE"

export type WatermarkAnchorReason =
  | "step-window"
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
  readonly status: FreshnessStatus | "ACTIVE IN MANIFEST — DO NOT RE-INVOKE"
  readonly rendered: string
}

export interface ManifestFileReadEntry {
  readonly path: string
  readonly normalizedPath: string
  readonly lineRange: string
  readonly chars: number
  readonly blobSha256: string
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
  readonly status: "ACTIVE — DO NOT RE-INVOKE"
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

export interface ValveOptions {
  readonly blobDir?: string
  readonly readOnlyArchiveDir?: string
  readonly keepRecentSteps?: number
  readonly persistBlobsToDisk?: boolean
  readonly diskHashesByPath?: ReadonlyMap<string, string>
  readonly priorWorktreeMessages?: readonly {
    readonly sessionID: string
    readonly messages: readonly Record<string, any>[]
  }[]
  readonly includeWorktreeArchive?: boolean
  readonly maxCutTimestamp?: number
}

export function estimateTokens(charsOrText: number | string): number {
  const n = typeof charsOrText === "number" ? charsOrText : charsOrText.length
  return Math.ceil(n / 4)
}

export function normalizeRepoPath(rawPath: string): string {
  if (!rawPath) return ""
  return rawPath
    .trim()
    .replace(/^\/Users\/MAC\/Documents\/coding-projects\/hivemind-steward-oc-devin-dev\/\.worktree\/[^/]+\//, "")
    .replace(/^\/Users\/MAC\/Documents\/coding-projects\/hivemind-steward-oc-devin-dev\//, "")
    .replace(/^\.\//, "")
}

function isUserMessage(msg: Record<string, any>): boolean {
  return msg.type === "user" || msg.role === "user"
}

function isAssistantMessage(msg: Record<string, any>): boolean {
  return msg.type === "assistant" || msg.role === "assistant"
}

function isCompactionMessage(msg: Record<string, any>): boolean {
  if (msg.type === "compaction") return true
  if (Array.isArray(msg.content)) {
    return msg.content.some((p: any) => p && typeof p === "object" && p.type === "compaction")
  }
  return false
}

export function computeStepWatermark(
  messages: readonly Record<string, any>[],
  options: { readonly mode: PruningMode; readonly keepRecentSteps?: number },
): AssistantStepWatermark {
  const keepRecentSteps = Math.max(1, options.keepRecentSteps ?? DEFAULT_KEEP_RECENT_STEPS)
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

  const assistantStepsTotal = assistantIndices.length
  const assistantStepsAfterLastUser = assistantIndices.filter((idx) => idx > lastUserIndex).length

  let anchorIndex = activeStartIndex
  let anchorReason: WatermarkAnchorReason = "no-op"

  if (options.mode === "step-window") {
    if (assistantStepsTotal > keepRecentSteps) {
      anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]!
      anchorReason = "step-window"
    } else {
      anchorIndex = activeStartIndex
      anchorReason = "no-op"
    }
  } else if (options.mode === "recent") {
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
      ? (messages[anchorIndex]?.id as string | undefined) ?? null
      : null

  const assistantStepsThinned = assistantIndices.filter((idx) => idx < anchorIndex).length
  const assistantStepsKept = assistantStepsTotal - assistantStepsThinned

  return {
    mode: options.mode,
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
  const lines = outputText
    .split("\n")
    .slice(1, 80)
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
    .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("name:") && !l.startsWith("description:"))
  const firstLine = lines[0] ?? `Loaded ${skillName} guidance`
  return firstLine.slice(0, 96)
}

export function summarizeToolOutput(tool: string, input: Record<string, any>, outputText: string): string {
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
    return cmd.length > 64 ? `${cmd.slice(0, 64)}…` : cmd || "shell"
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
  readonly status: FreshnessStatus | "ACTIVE IN MANIFEST — DO NOT RE-INVOKE"
}): FactBreadcrumb {
  const blobRef = `blob:${params.blobSha256.slice(0, 12)}`
  let rendered: string

  if (params.tool === "read") {
    const rangeSuffix = params.lineRange ? `#${params.lineRange}` : ""
    rendered = `[Pruned read ${params.target}${rangeSuffix} (${params.originalChars} chars) -> ${blobRef} | ${params.summary} | status: ${params.status} — call substrate.resolve("${blobRef}") if exact lines needed]`
  } else if (params.tool === "skill") {
    rendered = `[Pruned skill ${params.target} (${params.originalChars} chars) -> ${blobRef} | Rules active in WorkingMemoryManifest — DO NOT REREAD skill]`
  } else {
    rendered = `[Pruned ${params.tool} ${params.target} (${params.originalChars} chars) -> ${blobRef} | ${params.summary} | call substrate.resolve("${blobRef}") to inspect raw output]`
  }

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

export class BlobStore {
  readonly blobDir: string
  readonly readOnlyArchiveDir: string | null
  readonly persistToDisk: boolean
  private readonly memoryBlobs = new Map<string, string>()
  private readonly prefixIndex = new Map<string, string>()
  private writtenCount = 0
  private reusedCount = 0

  constructor(options: {
    readonly blobDir?: string
    readonly readOnlyArchiveDir?: string | null
    readonly persistToDisk?: boolean
  } = {}) {
    this.blobDir = options.blobDir ?? DEFAULT_BLOB_DIR
    this.readOnlyArchiveDir =
      options.readOnlyArchiveDir === undefined ? DEFAULT_READONLY_ARCHIVE_DIR : options.readOnlyArchiveDir
    this.persistToDisk = options.persistToDisk ?? true
    if (this.persistToDisk) {
      mkdirSync(this.blobDir, { recursive: true })
    }
  }

  sink(content: string): { readonly sha256: string; readonly blobRef: string } {
    const sha256 = sha256hex(content)
    const short = sha256.slice(0, 12)
    this.prefixIndex.set(short, sha256)

    if (this.memoryBlobs.has(sha256)) {
      this.reusedCount += 1
      return { sha256, blobRef: `blob:${short}` }
    }

    this.memoryBlobs.set(sha256, content)
    if (this.persistToDisk) {
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

  resolve(blobRefOrSha: string): string | null {
    const raw = blobRefOrSha.startsWith("blob:") ? blobRefOrSha.slice(5) : blobRefOrSha
    const fullSha = this.prefixIndex.get(raw) ?? (raw.length === 64 ? raw : this.findMatchingDiskSha(raw))
    if (!fullSha) return null

    const inMem = this.memoryBlobs.get(fullSha)
    if (inMem !== undefined) return inMem

    const localPath = join(this.blobDir, `${fullSha}.txt`)
    if (existsSync(localPath)) {
      const txt = readFileSync(localPath, "utf8")
      this.memoryBlobs.set(fullSha, txt)
      return txt
    }

    if (this.readOnlyArchiveDir) {
      const archiveBlobPath = join(this.readOnlyArchiveDir, "blobs", `${fullSha}.txt`)
      if (existsSync(archiveBlobPath)) {
        const txt = readFileSync(archiveBlobPath, "utf8")
        this.memoryBlobs.set(fullSha, txt)
        return txt
      }
    }

    return null
  }

  private findMatchingDiskSha(prefix: string): string | null {
    for (const dir of [
      this.blobDir,
      this.readOnlyArchiveDir ? join(this.readOnlyArchiveDir, "blobs") : null,
    ]) {
      if (!dir || !existsSync(dir)) continue
      const match = readdirSync(dir).find((f) => f.startsWith(prefix) && f.endsWith(".txt"))
      if (match) {
        const full = match.slice(0, -4)
        this.prefixIndex.set(prefix, full)
        return full
      }
    }
    return null
  }

  stats(): { readonly written: number; readonly reused: number } {
    return { written: this.writtenCount, reused: this.reusedCount }
  }
}

function extractShellCatSlices(command: string, outputText: string): readonly {
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
      sections.find((sec) => {
        if (rawPath.includes("investigation.md")) return sec.startsWith("--- INVESTIGATION ---")
        if (rawPath.includes("delegation.md")) return sec.startsWith("--- DELEGATION ---")
        if (rawPath.includes("lifecycle.md")) return sec.startsWith("--- LIFECYCLE ---")
        if (rawPath.includes("swarm/SKILL.md")) return sec.startsWith("--- SWARM DISCOVERY ---")
        if (rawPath.includes("AGENTS.md")) return sec.includes("--- OPERATING GUIDANCE ---") || sec.includes("--- LOCAL OPERATING POSTURE ---")
        if (rawPath.includes("STATE.md")) return sec.startsWith("--- STATE ---")
        if (rawPath.includes("CODING_STANDARDS.md")) return sec.startsWith("--- STANDARDS ---")
        if (rawPath.includes("GLOSSARY.md")) return sec.startsWith("--- DOMAIN ---")
        return sec.toLowerCase().includes(base.replace(/\.md$/, "").toLowerCase())
      }) ??
      outputText
    results.push({ path: rawPath, content: matchingSection })
  }
  return results
}

function extractPatchFiles(patchText: string): readonly {
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

function extractDeclaredSkillsFromText(text: string): readonly string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/\b(?:Load|Choose an entry route:?)\s+([^\n.]+)\./gi)) {
    for (const tok of m[1]!.matchAll(/`([a-z0-9][a-z0-9-]*)`/gi)) {
      const candidate = tok[1]!.toLowerCase()
      if (candidate !== "and" && candidate !== "or") {
        found.add(candidate)
      }
    }
  }
  return [...found]
}

function readSkillFromDiskOrArchive(skillName: string, archiveDir: string | null): string | null {
  if (archiveDir && existsSync(join(archiveDir, "sessions"))) {
    for (const rootId of readdirSync(join(archiveDir, "sessions"))) {
      const jsonlPath = join(archiveDir, "sessions", rootId, `${rootId}.jsonl`)
      if (!existsSync(jsonlPath)) continue
      const raw = readFileSync(jsonlPath, "utf8")
      if (!raw.includes(`"name":"skill"`) || !raw.includes(`"${skillName}"`)) continue
      for (const line of raw.trim().split("\n")) {
        const rec = JSON.parse(line)
        for (const p of rec.parts ?? []) {
          if (p.type === "tool" && p.name === "skill" && (p.input?.id === skillName || p.input?.name === skillName)) {
            if (typeof p.output === "string" && p.output.length > 0) return p.output
          }
        }
      }
    }
  }
  const diskCandidates = [
    `/Users/MAC/.config/opencode/skills/${skillName}/SKILL.md`,
    `/Users/MAC/.agents/skills/${skillName}/SKILL.md`,
  ]
  for (const candidate of diskCandidates) {
    if (existsSync(candidate)) {
      const body = readFileSync(candidate, "utf8")
      return `<skill_content name="${skillName}">\n# Skill: ${skillName}\n\n${body}\n</skill_content>`
    }
  }
  return null
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

function renderWorkingMemoryManifest(manifest: Omit<WorkingMemoryManifest, "renderedMarkdown">): string {
  const lines: string[] = [
    `## WorkingMemoryManifest · \`${manifest.sessionID}\` (Do-Not-Reread Ledger)`,
    `> **Directive:** Every file slice and skill below is indexed in Retrievable Memory with a SHA-256 blob handle. **DO NOT re-read \`FRESH — DO NOT REREAD\` files or re-invoke \`ACTIVE — DO NOT RE-INVOKE\` skills.** Call \`substrate.resolve("blob:<sha12>")\` only if exact lines are needed.`,
    "",
    `### Files Already Read (${manifest.filesRead.length})`,
  ]

  for (const f of manifest.filesRead) {
    const shortPath = f.normalizedPath || f.path
    lines.push(
      `- \`${shortPath}#${f.lineRange}\` (${f.chars} chars) -> \`${f.blobRef}\` | ${f.summary.slice(0, 72)} | **${f.status}**`,
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

  armValve(params: {
    readonly sessionID: string
    readonly mode: PruningMode
    readonly keepRecentSteps?: number
    readonly messages: readonly Record<string, any>[]
  }): ValveExecutionLedger {
    const keepRecentSteps = params.keepRecentSteps ?? this.options.keepRecentSteps ?? DEFAULT_KEEP_RECENT_STEPS
    const watermark = computeStepWatermark(params.messages, {
      mode: params.mode,
      keepRecentSteps,
    })

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

    if (this.options.includeWorktreeArchive && this.blobStore.readOnlyArchiveDir) {
      this.ingestWorktreeArchive(
        params.sessionID,
        this.blobStore.readOnlyArchiveDir,
        this.options.maxCutTimestamp ?? Number.MAX_SAFE_INTEGER,
        recordCrossSessionFileRead,
        filesModifiedMap,
        recordSkill,
      )
    }

    for (const prior of this.options.priorWorktreeMessages ?? []) {
      this.scanMessagesIntoManifest(
        prior.sessionID,
        prior.messages,
        prior.messages.length,
        false,
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
      breadcrumbsByCallId,
      thinnedInputsByCallId,
      skillBreadcrumbsByName,
      recordFileRead,
      filesModifiedMap,
      recordSkill,
      delegationMap,
    )

    if (this.options.diskHashesByPath) {
      for (const [key, entry] of filesReadMap.entries()) {
        const diskHash =
          this.options.diskHashesByPath.get(entry.path) ??
          this.options.diskHashesByPath.get(entry.normalizedPath)
        if (diskHash && diskHash !== entry.blobSha256) {
          filesReadMap.set(key, { ...entry, status: "STALE" })
          for (const [callId, bc] of breadcrumbsByCallId.entries()) {
            if (bc.tool === "read" && normalizeRepoPath(bc.target) === entry.normalizedPath) {
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
                  status: "STALE",
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
    }

    const blobStats = this.blobStore.stats()
    const rawOutputFreed = stats.rawOutputCharsBefore - stats.breadcrumbCharsAfter
    const rawInputFreed = stats.rawInputCharsBefore - stats.thinnedInputCharsAfter
    const netCharsFreed = rawOutputFreed + rawInputFreed - renderedMarkdown.length

    const ledger: ValveExecutionLedger = {
      sessionID: params.sessionID,
      mode: params.mode,
      keepRecentSteps,
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

  applyContextHookInMemory(event: {
    sessionID: string
    messages: Array<Record<string, any>>
    system?: string[]
  }): { readonly applied: boolean; readonly thinnedParts: number; readonly anchorIndex: number } {
    const ledger = this.ledgers.get(event.sessionID)
    if (!ledger) return { applied: false, thinnedParts: 0, anchorIndex: 0 }

    const messages = event.messages
    let boundary = -1
    if (ledger.watermark.anchorMessageID !== null) {
      boundary = messages.findIndex((m) => m.id === ledger.watermark.anchorMessageID)
    } else if (ledger.mode === "step-window" || ledger.watermark.anchorReason === "recent-step-fallback") {
      const w = computeStepWatermark(messages, {
        mode: ledger.mode,
        keepRecentSteps: ledger.keepRecentSteps,
      })
      boundary = w.anchorIndex
    } else if (ledger.mode === "initial") {
      boundary = messages.findLastIndex((m) => isUserMessage(m))
    }

    if (boundary <= 0) {
      return { applied: false, thinnedParts: 0, anchorIndex: 0 }
    }

    if (Array.isArray(event.system)) {
      if (!event.system.includes(ledger.manifest.renderedMarkdown)) {
        event.system.unshift(ledger.manifest.renderedMarkdown)
      }
    } else {
      ;(event as { system?: string[] }).system = [ledger.manifest.renderedMarkdown]
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
            const cached = ledger.skillBreadcrumbsByName.get(name)
            if (cached) return cached.rendered
            const { sha256 } = this.blobStore.sink(blob)
            return formatFactBreadcrumb({
              callId: `inline_skill_${name}`,
              messageId: String(message.id ?? ""),
              tool: "skill",
              target: name,
              lineRange: null,
              originalChars: blob.length,
              blobSha256: sha256,
              summary: "Rules active in WorkingMemoryManifest",
              status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
            }).rendered
          })
        }
      }
    }

    return { applied: true, thinnedParts, anchorIndex: boundary }
  }

  private scanMessagesIntoManifest(
    sessionID: string,
    messages: readonly Record<string, any>[],
    thinBeforeIndex: number,
    isPrimarySession: boolean,
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

    for (let idx = 0; idx < messages.length; idx++) {
      const m = messages[idx]!
      const msgId = String(m.id ?? `msg_${idx}`)
      const inThinRange = isPrimarySession && idx >= activeStart && idx < thinBeforeIndex

      if (Array.isArray(m.skills)) {
        for (const s of m.skills) {
          const name = String(s.name ?? s.id ?? "")
          const text = String(s.text ?? "")
          if (name && text) {
            const { sha256, blobRef } = this.blobStore.sink(text)
            const summary = summarizeSkillOutput(name, text)
            recordSkill({
              name,
              chars: text.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: "ACTIVE — DO NOT RE-INVOKE",
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
            const { sha256, blobRef } = this.blobStore.sink(blob)
            const summary = summarizeSkillOutput(name, blob)
            recordSkill({
              name,
              chars: blob.length,
              blobSha256: sha256,
              blobRef,
              summary,
              status: "ACTIVE — DO NOT RE-INVOKE",
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
              status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
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
            : ""
          : typeof part.result?.value === "string"
            ? part.result.value
            : ""

        const { sha256, blobRef } = this.blobStore.sink(outputText)
        const target = extractTargetLabel(name, input, outputText)

        if (name === "read") {
          const lineRange = extractReadLineRange(input, outputText)
          const summary = summarizeReadOutput(target, outputText)
          const normPath = normalizeRepoPath(target)
          recordFileRead({
            path: target,
            normalizedPath: normPath,
            lineRange,
            chars: outputText.length,
            blobSha256: sha256,
            blobRef,
            summary,
            status: "FRESH — DO NOT REREAD",
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
              status: "ACTIVE — DO NOT RE-INVOKE",
              messageId: msgId,
              sourceSessionId: sessionID,
            })
          }

          if (target.includes("the-3-prompting-designs-concepts-wayfinder.md") || target.includes("AGENTS.md")) {
            for (const declaredSkill of extractDeclaredSkillsFromText(outputText)) {
              const skillBody = readSkillFromDiskOrArchive(
                declaredSkill,
                this.options.readOnlyArchiveDir ?? DEFAULT_READONLY_ARCHIVE_DIR,
              )
              if (skillBody) {
                const { sha256: sSha, blobRef: sRef } = this.blobStore.sink(skillBody)
                const sSummary = summarizeSkillOutput(declaredSkill, skillBody)
                recordSkill({
                  name: declaredSkill,
                  chars: skillBody.length,
                  blobSha256: sSha,
                  blobRef: sRef,
                  summary: sSummary,
                  status: "ACTIVE — DO NOT RE-INVOKE",
                  messageId: msgId,
                  sourceSessionId: sessionID,
                })
                skillBreadcrumbsByName.set(
                  declaredSkill,
                  formatFactBreadcrumb({
                    callId: `declared_skill_${declaredSkill}`,
                    messageId: msgId,
                    tool: "skill",
                    target: declaredSkill,
                    lineRange: null,
                    originalChars: skillBody.length,
                    blobSha256: sSha,
                    summary: sSummary,
                    status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
                  }),
                )
              }
            }
          }
        } else if (name === "skill") {
          const summary = summarizeSkillOutput(target, outputText)
          recordSkill({
            name: target,
            chars: outputText.length,
            blobSha256: sha256,
            blobRef,
            summary,
            status: "ACTIVE — DO NOT RE-INVOKE",
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
              status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
            }),
          )
        } else if (name === "patch" && typeof input.patchText === "string") {
          for (const patched of extractPatchFiles(input.patchText)) {
            const { sha256: pSha, blobRef: pRef } = this.blobStore.sink(patched.hunkText)
            const normPath = normalizeRepoPath(patched.path)
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
            recordFileRead({
              path: patched.path,
              normalizedPath: normPath,
              lineRange: `L1-L${Math.max(1, patched.hunkText.split("\n").length)}`,
              chars: patched.hunkText.length,
              blobSha256: pSha,
              blobRef: pRef,
              summary: summarizeReadOutput(patched.path, patched.hunkText),
              status: "FRESH — DO NOT REREAD",
              messageId: msgId,
              sourceSessionId: sessionID,
            })
          }
        } else if ((name === "write" || name === "edit") && (input.path || input.filePath)) {
          const filePath = String(input.path ?? input.filePath)
          const normPath = normalizeRepoPath(filePath)
          const body = String(input.content ?? input.newString ?? outputText)
          const { sha256: wSha, blobRef: wRef } = this.blobStore.sink(body)
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
          recordFileRead({
            path: filePath,
            normalizedPath: normPath,
            lineRange: `L1-L${Math.max(1, body.split("\n").length)}`,
            chars: body.length,
            blobSha256: wSha,
            blobRef: wRef,
            summary: summarizeReadOutput(filePath, body),
            status: "FRESH — DO NOT REREAD",
            messageId: msgId,
            sourceSessionId: sessionID,
          })
        } else if (name === "shell" && typeof input.command === "string") {
          for (const catSlice of extractShellCatSlices(input.command, outputText)) {
            const { sha256: cSha, blobRef: cRef } = this.blobStore.sink(catSlice.content)
            const normPath = normalizeRepoPath(catSlice.path)
            const summary = summarizeReadOutput(catSlice.path, catSlice.content)
            recordFileRead({
              path: catSlice.path,
              normalizedPath: normPath,
              lineRange: `L1-L${Math.max(1, catSlice.content.split("\n").length)}`,
              chars: catSlice.content.length,
              blobSha256: cSha,
              blobRef: cRef,
              summary,
              status: "FRESH — DO NOT REREAD",
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
                status: "ACTIVE — DO NOT RE-INVOKE",
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
                  status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
                }),
              )
            }
          }
        } else if (isPrimarySession && KEEP_RESULT.has(name)) {
          const childSessionID =
            (part.state?.metadata?.sessionID as string | undefined) ??
            /sessionID[:=]\s*"?([a-zA-Z0-9_]+)"?/.exec(outputText)?.[1] ??
            null
          const harness =
            String(input.harness ?? (name === "delegate-devin" ? "devin" : "opencode"))
          const agent = String(input.agent ?? name)
          const description = String(input.description ?? target)
          const isCompleted = outputText.includes('state="completed"') || !outputText.includes("working in the background")
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
          const lineRange = name === "read" ? extractReadLineRange(input, outputText) : null
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
            status: name === "skill" ? "ACTIVE IN MANIFEST — DO NOT RE-INVOKE" : "FRESH — DO NOT REREAD",
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

  private ingestWorktreeArchive(
    currentSessionID: string,
    archiveDir: string,
    maxCutTimestamp: number,
    recordFileRead: (entry: ManifestFileReadEntry) => void,
    filesModifiedMap: Map<string, ManifestFileModifiedEntry>,
    recordSkill: (entry: ManifestSkillEntry) => void,
  ): void {
    const sessionsDir = join(archiveDir, "sessions")
    if (!existsSync(sessionsDir)) return

    for (const rootId of readdirSync(sessionsDir)) {
      if (rootId === currentSessionID) continue
      const rootPath = join(sessionsDir, rootId)
      const infoPath = join(rootPath, "info.json")
      const jsonlPath = join(rootPath, `${rootId}.jsonl`)
      if (!existsSync(infoPath) || !existsSync(jsonlPath)) continue

      const info = JSON.parse(readFileSync(infoPath, "utf8"))
      if (typeof info.time?.created === "number" && info.time.created > maxCutTimestamp) continue
      if (typeof info.directory === "string" && !info.directory.endsWith(".worktree/wave2-slice1")) continue

      const lines = readFileSync(jsonlPath, "utf8").trim().split("\n")
      for (const line of lines) {
        const rec = JSON.parse(line)
        if (typeof rec.t === "number" && rec.t > maxCutTimestamp) continue
        const msgId = String(rec.id ?? "")

        for (const p of rec.parts ?? []) {
          if (p.type !== "tool") continue
          const name = String(p.name ?? "")
          const inp = p.input ?? {}
          if (name === "read") {
            const rawPath = String(inp.path ?? inp.filePath ?? "")
            if (!rawPath) continue
            let fullOut = String(p.output ?? "")
            let sha = ""
            if (typeof p.output_ref === "string" && p.output_ref.startsWith("blob:")) {
              sha = p.output_ref.slice(5)
              const resolved = this.blobStore.resolve(p.output_ref)
              if (resolved) fullOut = resolved
            } else {
              sha = this.blobStore.sink(fullOut).sha256
            }
            const blobRef = this.blobStore.registerExistingSha(sha, fullOut)
            recordFileRead({
              path: rawPath,
              normalizedPath: normalizeRepoPath(rawPath),
              lineRange: extractReadLineRange(inp, fullOut),
              chars: fullOut.length,
              blobSha256: sha,
              blobRef,
              summary: summarizeReadOutput(rawPath, fullOut),
              status: "FRESH — DO NOT REREAD",
              messageId: msgId,
              sourceSessionId: rootId,
            })
          } else if (name === "skill") {
            const skillName = String(inp.id ?? inp.name ?? "")
            if (!skillName) continue
            let fullOut = String(p.output ?? "")
            let sha = ""
            if (typeof p.output_ref === "string" && p.output_ref.startsWith("blob:")) {
              sha = p.output_ref.slice(5)
              const resolved = this.blobStore.resolve(p.output_ref)
              if (resolved) fullOut = resolved
            } else {
              sha = this.blobStore.sink(fullOut).sha256
            }
            const blobRef = this.blobStore.registerExistingSha(sha, fullOut)
            recordSkill({
              name: skillName,
              chars: fullOut.length,
              blobSha256: sha,
              blobRef,
              summary: summarizeSkillOutput(skillName, fullOut),
              status: "ACTIVE — DO NOT RE-INVOKE",
              messageId: msgId,
              sourceSessionId: rootId,
            })
          } else if (name === "patch" && typeof inp.patchText === "string") {
            for (const patched of extractPatchFiles(inp.patchText)) {
              const normPath = normalizeRepoPath(patched.path)
              if (!isCrossSessionContinuityArtifact(normPath)) continue
              const { sha256: pSha, blobRef: pRef } = this.blobStore.sink(patched.hunkText)
              if (!filesModifiedMap.has(normPath)) {
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
            }
          }
        }
      }
    }
  }
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

export function replayLegacyContextPrune(
  messages: readonly Record<string, any>[],
  mode: "recent" | "initial",
): {
  readonly anchorMessageID: string | null
  readonly toolPartsThinned: number
  readonly rawCharsFreed: number
  readonly rawTokensFreed: number
} {
  let activeStart = 0
  for (let i = 0; i < messages.length; i++) {
    if (isCompactionMessage(messages[i]!)) activeStart = i + 1
  }
  const activeSlice = messages.slice(activeStart)
  const users = activeSlice.filter((m) => isUserMessage(m))
  const anchor = users.at(-1)?.id ?? null

  let parts = 0
  let chars = 0
  for (const message of activeSlice) {
    if (anchor !== null && message.id === anchor) break
    if (!isAssistantMessage(message)) continue
    for (const part of message.content ?? []) {
      if (part?.type !== "tool" || part.executed === true) continue
      parts += 1
      const state = part.state
      if (state?.status === "completed" && Array.isArray(state.content)) {
        chars += state.content.reduce(
          (n: number, item: any) => n + (item.type === "text" && typeof item.text === "string" ? item.text.length : 0),
          0,
        )
      }
    }
  }

  return {
    anchorMessageID: mode === "recent" ? anchor : null,
    toolPartsThinned: parts,
    rawCharsFreed: chars,
    rawTokensFreed: estimateTokens(chars),
  }
}

export function runReplay1SessionBcad339b(options: { readonly persistBlobsToDisk?: boolean } = {}) {
  const s1 = JSON.parse(readFileSync(SESSION_1_PATH, "utf8"))
  const sessionID = String(s1.info?.id ?? "ses_eb2eabb14ffeCXsCwb845rtffb")
  const sliceAtMsg45 = s1.messages.slice(0, 46) as Record<string, any>[]

  const msg45Tokens =
    (s1.messages[45]?.tokens?.input ?? 0) + (s1.messages[45]?.tokens?.cache?.read ?? 0)
  const msg51CompactionThresholdTokens = 274_175

  const legacy = replayLegacyContextPrune(sliceAtMsg45, "recent")

  const valveK8 = new WorkingSetValve({
    keepRecentSteps: 8,
    persistBlobsToDisk: options.persistBlobsToDisk ?? true,
  })
  const ledgerK8 = valveK8.armValve({
    sessionID,
    mode: "step-window",
    keepRecentSteps: 8,
    messages: sliceAtMsg45,
  })

  const valveRecentFallback = new WorkingSetValve({
    keepRecentSteps: 8,
    persistBlobsToDisk: false,
  })
  const ledgerRecentFallback = valveRecentFallback.armValve({
    sessionID,
    mode: "recent",
    keepRecentSteps: 8,
    messages: sliceAtMsg45,
  })

  const valveK6 = new WorkingSetValve({
    keepRecentSteps: 6,
    persistBlobsToDisk: false,
  })
  const ledgerK6 = valveK6.armValve({
    sessionID,
    mode: "step-window",
    keepRecentSteps: 6,
    messages: sliceAtMsg45,
  })

  const projectedMsg45TokensK8 = msg45Tokens - ledgerK8.metrics.netTokensFreed
  const projectedMsg51TokensK8 = msg51CompactionThresholdTokens - ledgerK8.metrics.netTokensFreed
  const tokensBelowCompactionK8 = msg51CompactionThresholdTokens - projectedMsg51TokensK8

  const projectedMsg45TokensK6 = msg45Tokens - ledgerK6.metrics.netTokensFreed
  const projectedMsg51TokensK6 = msg51CompactionThresholdTokens - ledgerK6.metrics.netTokensFreed
  const tokensBelowCompactionK6 = msg51CompactionThresholdTokens - projectedMsg51TokensK6

  return {
    sessionID,
    msg45InputTokensActual: msg45Tokens,
    msg51CompactionThresholdTokens,
    legacy,
    stepWindowK8: {
      watermark: ledgerK8.watermark,
      metrics: ledgerK8.metrics,
      projectedMsg45Tokens: projectedMsg45TokensK8,
      projectedMsg51Tokens: projectedMsg51TokensK8,
      tokensBelowCompactionThreshold: tokensBelowCompactionK8,
      sampleBreadcrumbs: [...ledgerK8.breadcrumbsByCallId.values()].slice(0, 4).map((b) => b.rendered),
    },
    recentWithStepFallbackK8: {
      watermark: ledgerRecentFallback.watermark,
      metrics: ledgerRecentFallback.metrics,
    },
    stepWindowK6: {
      watermark: ledgerK6.watermark,
      metrics: ledgerK6.metrics,
      projectedMsg45Tokens: projectedMsg45TokensK6,
      projectedMsg51Tokens: projectedMsg51TokensK6,
      tokensBelowCompactionThreshold: tokensBelowCompactionK6,
    },
    valveK8,
    ledgerK8,
  }
}

export function runReplay2SessionA35adea6(options: { readonly persistBlobsToDisk?: boolean } = {}) {
  const s1 = JSON.parse(readFileSync(SESSION_1_PATH, "utf8"))
  const s2 = JSON.parse(readFileSync(SESSION_2_PATH, "utf8"))
  const sessionID = String(s2.info?.id ?? "ses_eb23bfbf0ffesn5kT0yJI06h35")
  const sliceAtMsg123 = s2.messages.slice(0, 124) as Record<string, any>[]
  const t123 = Number(s2.messages[123]?.time?.created ?? Number.MAX_SAFE_INTEGER)

  const legacy = replayLegacyContextPrune(sliceAtMsg123, "recent")

  const valve = new WorkingSetValve({
    keepRecentSteps: 8,
    persistBlobsToDisk: options.persistBlobsToDisk ?? true,
    includeWorktreeArchive: true,
    maxCutTimestamp: t123,
    priorWorktreeMessages: [
      {
        sessionID: String(s1.info?.id ?? "ses_eb2eabb14ffeCXsCwb845rtffb"),
        messages: s1.messages as Record<string, any>[],
      },
    ],
  })

  const ledger = valve.armValve({
    sessionID,
    mode: "recent",
    keepRecentSteps: 8,
    messages: sliceAtMsg123,
  })

  const rereadFilesVerification: {
    readonly msgIdx: number
    readonly path: string
    readonly normalizedPath: string
    readonly rereadChars: number
    readonly inManifest: boolean
    readonly status: FreshnessStatus | null
    readonly blobRef: string | null
    readonly resolvedChars: number
  }[] = []

  const rereadSkillsVerification: {
    readonly msgIdx: number
    readonly skillName: string
    readonly rereadChars: number
    readonly inManifest: boolean
    readonly status: string | null
    readonly blobRef: string | null
    readonly resolvedChars: number
  }[] = []

  for (let i = 125; i <= 130; i++) {
    const m = s2.messages[i]
    for (const p of m.content ?? []) {
      if (p.type !== "tool") continue
      const inp = p.state?.input ?? {}
      const out = (p.state?.content ?? []).map((c: any) => c.text ?? "").join("")
      if (p.name === "read") {
        const rawPath = String(inp.path ?? inp.filePath ?? "")
        const norm = normalizeRepoPath(rawPath)
        const manifestHit = ledger.manifest.filesRead.find(
          (f) => f.normalizedPath === norm || f.path === rawPath || f.path.endsWith(norm) || norm.endsWith(f.normalizedPath),
        )
        const resolved = manifestHit ? valve.resolve(manifestHit.blobRef) : null
        rereadFilesVerification.push({
          msgIdx: i,
          path: rawPath,
          normalizedPath: norm,
          rereadChars: out.length,
          inManifest: Boolean(manifestHit),
          status: manifestHit?.status ?? null,
          blobRef: manifestHit?.blobRef ?? null,
          resolvedChars: resolved?.length ?? 0,
        })

        if (rawPath.endsWith("/swarm/SKILL.md")) {
          const skillHit = ledger.manifest.activeSkills.find((s) => s.name === "swarm")
          const skillResolved = skillHit ? valve.resolve(skillHit.blobRef) : null
          rereadSkillsVerification.push({
            msgIdx: i,
            skillName: "swarm",
            rereadChars: out.length,
            inManifest: Boolean(skillHit),
            status: skillHit?.status ?? null,
            blobRef: skillHit?.blobRef ?? null,
            resolvedChars: skillResolved?.length ?? 0,
          })
        }
      } else if (p.name === "skill") {
        const skillName = String(inp.id ?? inp.name ?? "")
        const skillHit = ledger.manifest.activeSkills.find((s) => s.name === skillName)
        const resolved = skillHit ? valve.resolve(skillHit.blobRef) : null
        rereadSkillsVerification.push({
          msgIdx: i,
          skillName,
          rereadChars: out.length,
          inManifest: Boolean(skillHit),
          status: skillHit?.status ?? null,
          blobRef: skillHit?.blobRef ?? null,
          resolvedChars: resolved?.length ?? 0,
        })
      }
    }
  }

  return {
    sessionID,
    legacy,
    watermark: ledger.watermark,
    metrics: ledger.metrics,
    manifest: ledger.manifest,
    rereadFilesVerification,
    rereadSkillsVerification,
    allFilesVerified: rereadFilesVerification.every(
      (r) => r.inManifest && r.status === "FRESH — DO NOT REREAD" && r.resolvedChars > 0,
    ),
    allSkillsVerified: rereadSkillsVerification.every(
      (s) => s.inManifest && s.status === "ACTIVE — DO NOT RE-INVOKE" && s.resolvedChars > 0,
    ),
    valve,
    ledger,
  }
}

export interface BenchmarkReport {
  readonly samples: number
  readonly s1Full87Messages: {
    readonly medianMs: number
    readonly minMs: number
    readonly maxMs: number
    readonly allSamplesMs: readonly number[]
    readonly thinnedPartsPerRun: number
  }
  readonly s2Full138Messages: {
    readonly medianMs: number
    readonly minMs: number
    readonly maxMs: number
    readonly allSamplesMs: readonly number[]
    readonly thinnedPartsPerRun: number
  }
  readonly limiter: string
}

export function runInterleavedContextHookBenchmark(samples = 7): BenchmarkReport {
  const s1Raw = JSON.parse(readFileSync(SESSION_1_PATH, "utf8"))
  const s2Raw = JSON.parse(readFileSync(SESSION_2_PATH, "utf8"))
  const s1Id = String(s1Raw.info?.id ?? "ses_eb2eabb14ffeCXsCwb845rtffb")
  const s2Id = String(s2Raw.info?.id ?? "ses_eb23bfbf0ffesn5kT0yJI06h35")

  const valve = new WorkingSetValve({
    keepRecentSteps: 8,
    persistBlobsToDisk: false,
  })

  valve.armValve({
    sessionID: s1Id,
    mode: "step-window",
    keepRecentSteps: 8,
    messages: s1Raw.messages,
  })
  valve.armValve({
    sessionID: s2Id,
    mode: "recent",
    keepRecentSteps: 8,
    messages: s2Raw.messages.slice(0, 124),
  })

  const warmup1 = { sessionID: s1Id, messages: cloneMessagesForHook(s1Raw.messages), system: [] as string[] }
  const warmup2 = { sessionID: s2Id, messages: cloneMessagesForHook(s2Raw.messages), system: [] as string[] }
  valve.applyContextHookInMemory(warmup1)
  valve.applyContextHookInMemory(warmup2)

  const s1Times: number[] = []
  const s2Times: number[] = []
  let s1Thinned = 0
  let s2Thinned = 0

  for (let i = 0; i < samples; i++) {
    const runS1 = () => {
      const payload = { sessionID: s1Id, messages: cloneMessagesForHook(s1Raw.messages), system: [] as string[] }
      const t0 = performance.now()
      const res = valve.applyContextHookInMemory(payload)
      const t1 = performance.now()
      if (!res.applied || res.thinnedParts === 0 || payload.system.length === 0) {
        throw new Error("S1 context hook failed completed-work assertion")
      }
      s1Thinned = res.thinnedParts
      s1Times.push(t1 - t0)
    }

    const runS2 = () => {
      const payload = { sessionID: s2Id, messages: cloneMessagesForHook(s2Raw.messages), system: [] as string[] }
      const t0 = performance.now()
      const res = valve.applyContextHookInMemory(payload)
      const t1 = performance.now()
      if (!res.applied || res.thinnedParts === 0 || payload.system.length === 0) {
        throw new Error("S2 context hook failed completed-work assertion")
      }
      s2Thinned = res.thinnedParts
      s2Times.push(t1 - t0)
    }

    if (i % 2 === 0) {
      runS1()
      runS2()
    } else {
      runS2()
      runS1()
    }
  }

  const stats = (arr: readonly number[]) => {
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return {
      medianMs: Number(sorted[mid]!.toFixed(4)),
      minMs: Number(sorted[0]!.toFixed(4)),
      maxMs: Number(sorted[sorted.length - 1]!.toFixed(4)),
      allSamplesMs: sorted.map((n) => Number(n.toFixed(4))),
    }
  }

  return {
    samples,
    s1Full87Messages: {
      ...stats(s1Times),
      thinnedPartsPerRun: s1Thinned,
    },
    s2Full138Messages: {
      ...stats(s2Times),
      thinnedPartsPerRun: s2Thinned,
    },
    limiter:
      "In-memory array walk over event.messages + Map.get(callId) breadcrumb lookup + single string.replace for inline <skill_content> tags; zero disk I/O and zero SHA-256 recomputation on the per-step context hook critical path.",
  }
}

if (import.meta.main) {
  const r1 = runReplay1SessionBcad339b({ persistBlobsToDisk: true })
  const r2 = runReplay2SessionA35adea6({ persistBlobsToDisk: true })
  const bench = runInterleavedContextHookBenchmark(7)

  console.log("=== REPLAY 1: session-bcad339b at msg[45] ===")
  console.log("Legacy context-prune(recent):", r1.legacy)
  console.log("WorkingSetValve(step-window, K=8):", {
    watermark: r1.stepWindowK8.watermark,
    metrics: r1.stepWindowK8.metrics,
    msg45InputTokensActual: r1.msg45InputTokensActual,
    projectedMsg45Tokens: r1.stepWindowK8.projectedMsg45Tokens,
    msg51CompactionThresholdTokens: r1.msg51CompactionThresholdTokens,
    projectedMsg51Tokens: r1.stepWindowK8.projectedMsg51Tokens,
    tokensBelowCompactionThreshold: r1.stepWindowK8.tokensBelowCompactionThreshold,
  })
  console.log("WorkingSetValve(recent fallback, K=8):", r1.recentWithStepFallbackK8)
  console.log("WorkingSetValve(step-window, K=6):", {
    watermark: r1.stepWindowK6.watermark,
    metrics: r1.stepWindowK6.metrics,
    projectedMsg45Tokens: r1.stepWindowK6.projectedMsg45Tokens,
    projectedMsg51Tokens: r1.stepWindowK6.projectedMsg51Tokens,
    tokensBelowCompactionThreshold: r1.stepWindowK6.tokensBelowCompactionThreshold,
  })
  console.log("Sample FactBreadcrumbs (S1):", r1.stepWindowK8.sampleBreadcrumbs)

  console.log("\n=== REPLAY 2: session-a35adea6 at msg[123] ===")
  console.log("Legacy context-prune(recent):", r2.legacy)
  console.log("WorkingSetValve(recent, K=8) metrics:", r2.metrics)
  console.log("All 14 file re-reads in msg[125..130] verified:", r2.allFilesVerified, `(${r2.rereadFilesVerification.length}/14)`)
  console.log("All 7 skill re-invokes in msg[125..130] verified:", r2.allSkillsVerified, `(${r2.rereadSkillsVerification.length}/7)`)

  console.log("\n=== 7-SAMPLE INTERLEAVED BENCHMARK ===")
  console.log(JSON.stringify(bench, null, 2))
}
