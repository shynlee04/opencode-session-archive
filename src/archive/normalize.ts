import { existsSync, readFileSync } from "node:fs"
import { isAbsolute } from "node:path"
import {
  computeDiskSliceSha,
  formatStalenessStatus,
  normalizeRepoPath,
  parseReadToolOutput,
  resolveDiskPath,
  sha256Hex,
} from "./primitives.ts"
import type {
  AssistantPart,
  AssistantRecord,
  BlobSink,
  BoundaryRecord,
  ChildStopSegment,
  CompactionRecord,
  ContextRecord,
  DelegationFact,
  DelegationTurnRow,
  FileReadLedgerRow,
  FileTouchRow,
  Harness,
  KvBindingRow,
  Lane,
  MessageRecord,
  MessageRow,
  ModelRef,
  NormalizedMessage,
  ProvenanceChainRow,
  ReportedOutcome,
  SessionHeader,
  SessionRow,
  ShellRecord,
  SkillLoadLedgerRow,
  SkillRecord,
  UnknownRecord,
  UserRecord,
  VerifiedOutcome,
} from "./types.ts"

const BLOB_LIMIT = 4096

const DELEGATION_TOOLS = new Set(["subagent", "delegate-devin", "hivemind-delegate"])
const READ_TOOLS = new Set(["read", "read_file", "view_file"])
const TOUCH_TOOLS = new Set(["write", "edit", "patch", "multi_edit", "write_to_file", "replace_file_content"])
const SKILL_TOOLS = new Set(["skill", "load_skill"])
const SHELL_VERIFY_TOOLS = new Set(["bash", "shell", "run_command", "exec"])

const BOUNDARY_TYPES = new Set(["idle", "agent-switched", "model-switched", "location-switched"])

export function sha256hex(text: string | Uint8Array): string {
  return sha256Hex(text)
}

const asObj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asStr = (value: unknown): string | null => (typeof value === "string" ? value : null)

const asNum = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const asArr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

const stripBlobPrefix = (ref: string): string => (ref.startsWith("blob:") ? ref.slice("blob:".length) : ref)

const normalizeLedgerPath = (rawPath: string, canonicalRoot?: string): string =>
  normalizeRepoPath(rawPath, canonicalRoot)

const summarizePayload = (text: string, fallback: string): string => {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (line.length > 0 && !line.startsWith("<skill_content")) {
      return line.length > 120 ? `${line.slice(0, 117)}...` : line
    }
  }
  return fallback
}

const SKILL_CONTENT_BLOCK_RE = /<skill_content\s+name="([^"]+)">([\s\S]*?)<\/skill_content>/g
const SKILL_MD_PATH_RE = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i

const modelRef = (value: unknown): ModelRef | null => {
  const m = asObj(value)
  const id = asStr(m.id)
  const providerID = asStr(m.providerID)
  if (id === null || providerID === null) return null
  const variant = asStr(m.variant)
  return variant === null ? { id, providerID } : { id, providerID, variant }
}

export function harnessOf(model: ModelRef | null): Harness {
  if (model?.providerID === "devin-native") return "devin"
  if (model?.providerID === "antigravity-native") return "antigravity"
  return "opencode"
}

const asHarness = (value: unknown): Harness | null => {
  const s = asStr(value)
  return s === "devin" || s === "antigravity" || s === "opencode" ? s : null
}

const inferHarness = (
  value: unknown,
  agent?: string | null,
  title?: string | null,
  providerId?: string | null,
): Harness => {
  if (value === "devin" || value === "antigravity" || value === "opencode") return value
  if (providerId === "devin-native") return "devin"
  if (providerId === "antigravity-native") return "antigravity"
  if (typeof agent === "string") {
    if (agent.includes("antigravity")) return "antigravity"
    if (agent.includes("devin")) return "devin"
  }
  if (typeof title === "string") {
    if (title.startsWith("Antigravity")) return "antigravity"
    if (title.startsWith("Devin")) return "devin"
  }
  return "opencode"
}

const normalizeReportedOutcome = (value: unknown): ReportedOutcome => {
  if (value === "succeeded" || value === "failed" || value === "interrupted" || value === "running") {
    return value
  }
  return null
}

export function sessionHeader(
  row: SessionRow,
  info: {
    readonly root_id: string
    readonly depth: number
    readonly lane: Lane
    readonly children: readonly string[]
    readonly message_count: number
  },
): SessionHeader {
  return {
    kind: "session",
    schema: 1,
    id: row.id,
    project_id: row.project_id,
    root_id: info.root_id,
    parent_id: row.parent_id,
    depth: info.depth,
    lane: info.lane,
    directory: row.directory,
    title: row.title,
    agent: row.agent,
    model: row.model,
    harness: harnessOf(row.model),
    outcome: row.idle_outcome,
    fork: row.fork_session_id === null ? null : { from: row.fork_session_id, boundary: row.fork_boundary },
    cost: row.cost,
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      reasoning: row.tokens_reasoning,
      cache_read: row.tokens_cache_read,
      cache_write: row.tokens_cache_write,
    },
    summary: {
      files: row.summary_files,
      additions: row.summary_additions,
      deletions: row.summary_deletions,
    },
    time: {
      created: row.time_created,
      updated: row.time_updated,
      idle: row.time_idle,
      compacting: row.time_compacting,
      archived: row.time_archived,
    },
    resume_attempts: row.resume_attempts,
    message_count: info.message_count,
    children: info.children,
  }
}

const base = (row: MessageRow) => ({
  id: row.id,
  raw_ref: { session_id: row.session_id, message_id: row.id, seq: row.seq },
  t: row.time_created,
})

// Replaces any string value longer than BLOB_LIMIT anywhere inside an input
// object with its blob reference. Shape is preserved.
const thinStrings = (value: unknown, sink: BlobSink): unknown => {
  if (typeof value === "string") return value.length > BLOB_LIMIT ? sink(value) : value
  if (Array.isArray(value)) return value.map((item) => thinStrings(item, sink))
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, thinStrings(item, sink)]))
  }
  return value
}

const makeSkillLedgerRow = (params: {
  readonly sessionId: string
  readonly messageId: string
  readonly seq: number
  readonly t: number
  readonly callId: string
  readonly skillName: string
  readonly body: string
  readonly summaryFallback?: string
  readonly sink: BlobSink
}): SkillLoadLedgerRow => {
  const blobRef = params.body.length > 0 ? params.sink(params.body) : `blob:${sha256hex("")}`
  const blobSha = stripBlobPrefix(blobRef)
  return {
    session_id: params.sessionId,
    skill_name: params.skillName,
    call_id: params.callId,
    message_id: params.messageId,
    seq: params.seq,
    loaded_seq: params.seq,
    load_seq: params.seq,
    chars: params.body.length,
    char_len: params.body.length,
    blob_sha: blobSha,
    blob_sha256: blobSha,
    skill_blob_sha: blobSha,
    blob_ref: blobRef,
    summary: summarizePayload(params.body, params.summaryFallback ?? `skill:${params.skillName}`),
    status: "ACTIVE — DO NOT RE-INVOKE",
    t: params.t,
  }
}

const extractInlineSkillBlocks = (
  text: string,
  row: MessageRow,
  callIdPrefix: string,
  sink: BlobSink,
  skillLoads: SkillLoadLedgerRow[],
): void => {
  if (!text.includes("<skill_content")) return
  for (const match of text.matchAll(SKILL_CONTENT_BLOCK_RE)) {
    const skillName = match[1]?.trim()
    const body = match[2] ?? ""
    if (!skillName) continue
    skillLoads.push(
      makeSkillLedgerRow({
        sessionId: row.session_id,
        messageId: row.id,
        seq: row.seq,
        t: row.time_created,
        callId: `${callIdPrefix}:${skillName}`,
        skillName,
        body,
        sink,
      }),
    )
  }
}

const toolPart = (
  part: Record<string, unknown>,
  row: MessageRow,
  sink: BlobSink,
  delegations: DelegationFact[],
  fileReads: FileReadLedgerRow[],
  skillLoads: SkillLoadLedgerRow[],
  fileTouches: FileTouchRow[],
  canonicalRoot?: string,
): AssistantPart => {
  const state = asObj(part.state)
  const meta = asObj(state.metadata)
  const rawInput = asObj(state.input)

  const outputText = asArr(state.content)
    .flatMap((item) => {
      const c = asObj(item)
      return c.type === "text" && typeof c.text === "string" ? [c.text] : []
    })
    .join("")

  const childSessionID = asStr(meta.sessionID)
  const callID = asStr(part.id) ?? ""
  const name = asStr(part.name) ?? ""
  const status = asStr(state.status)
  const time = asObj(part.time)
  const tCreated = asNum(time.created)
  const tCompleted = asNum(time.completed)

  if (childSessionID !== null && DELEGATION_TOOLS.has(name)) {
    const prompt = asStr(rawInput.prompt)
    delegations.push({
      call_id: callID,
      message_id: row.id,
      seq: row.seq,
      child_session_id: childSessionID,
      tool: name,
      agent: asStr(rawInput.agent),
      harness: asHarness(rawInput.harness),
      mode: typeof rawInput.sessionID === "string" ? "continue" : "spawn",
      background: rawInput.background === true,
      description: asStr(rawInput.description),
      prompt_ref: prompt === null ? null : sink(prompt),
      status,
      t_created: tCreated,
      t_completed: tCompleted,
    })
  }

  if (status !== "error" && READ_TOOLS.has(name)) {
    const rawPath =
      asStr(rawInput.filePath) ??
      asStr(rawInput.path) ??
      asStr(rawInput.AbsolutePath) ??
      asStr(rawInput.file)
    if (rawPath && rawPath.length > 0) {
      const capture = parseReadToolOutput(outputText, { ...rawInput, filePath: rawPath }, canonicalRoot)
      const blobRef = outputText.length > 0 ? sink(outputText) : `blob:${sha256hex("")}`
      const blobSha = stripBlobPrefix(blobRef)
      const normPath = normalizeLedgerPath(rawPath, canonicalRoot)

      let diskBlobSha = capture.sliceSha
      let stalenessStatus =
        capture.isTruncated || capture.startLine > 1
          ? formatStalenessStatus("SLICE", capture.startLine, capture.endLine, capture.totalLines)
          : "FRESH — DO NOT REREAD"

      const shouldCheckDisk =
        (typeof canonicalRoot === "string" && canonicalRoot.length > 0) ||
        (isAbsolute(rawPath) && existsSync(rawPath))
      if (shouldCheckDisk) {
        const diskPath = resolveDiskPath(rawPath, canonicalRoot)
        if (existsSync(diskPath)) {
          const recon = computeDiskSliceSha(diskPath, capture)
          diskBlobSha = recon.diskSliceSha ?? capture.sliceSha
          stalenessStatus = recon.stalenessStatus
        }
      }

      fileReads.push({
        session_id: row.session_id,
        path: rawPath,
        normalized_path: normPath,
        call_id: callID || `read:${row.id}:${row.seq}`,
        message_id: row.id,
        seq: row.seq,
        read_seq: row.seq,
        line_range: capture.lineRange,
        start_line: capture.startLine,
        end_line: capture.endLine,
        total_lines: capture.totalLines,
        is_truncated: capture.isTruncated ? 1 : 0,
        chars: outputText.length,
        char_len: outputText.length,
        blob_sha: blobSha,
        blob_sha256: blobSha,
        slice_sha: capture.sliceSha,
        read_blob_sha: capture.sliceSha,
        disk_blob_sha: diskBlobSha,
        summary: summarizePayload(outputText, normPath),
        staleness_status: stalenessStatus,
        t: row.time_created,
        updated_at: new Date(row.time_updated || row.time_created || Date.now()).toISOString(),
      })

      const skillPathMatch = normPath.match(SKILL_MD_PATH_RE)
      if (skillPathMatch?.[1]) {
        skillLoads.push(
          makeSkillLedgerRow({
            sessionId: row.session_id,
            messageId: row.id,
            seq: row.seq,
            t: row.time_created,
            callId: callID || `skill-read:${row.id}`,
            skillName: skillPathMatch[1],
            body: outputText,
            sink,
          }),
        )
      }
    }
  } else if (status !== "error" && SKILL_TOOLS.has(name)) {
    const explicitName = asStr(rawInput.name) ?? asStr(rawInput.skill) ?? asStr(rawInput.id)
    const beforeCount = skillLoads.length
    extractInlineSkillBlocks(outputText, row, callID || `skill:${row.id}`, sink, skillLoads)
    if (skillLoads.length === beforeCount && explicitName) {
      skillLoads.push(
        makeSkillLedgerRow({
          sessionId: row.session_id,
          messageId: row.id,
          seq: row.seq,
          t: row.time_created,
          callId: callID || `skill:${row.id}`,
          skillName: explicitName,
          body: outputText,
          sink,
        }),
      )
    }
  } else if (status !== "error" && TOUCH_TOOLS.has(name)) {
    const rawPath =
      asStr(rawInput.filePath) ??
      asStr(rawInput.path) ??
      asStr(rawInput.TargetFile) ??
      asStr(rawInput.file)
    if (rawPath && rawPath.length > 0) {
      const contentCandidate =
        asStr(rawInput.content) ??
        asStr(rawInput.newString) ??
        asStr(rawInput.CodeContent) ??
        asStr(rawInput.ReplacementContent) ??
        outputText
      const blobRef = contentCandidate.length > 0 ? sink(contentCandidate) : `blob:${sha256hex("")}`
      const blobSha = stripBlobPrefix(blobRef)
      const opKind = name.includes("write") ? "write" : "edit"
      fileTouches.push({
        session_id: row.session_id,
        message_id: row.id,
        call_id: callID || `${name}:${row.id}:${row.seq}`,
        seq: row.seq,
        tool: name,
        op: opKind,
        operation: opKind,
        path: rawPath,
        normalized_path: normalizeLedgerPath(rawPath, canonicalRoot),
        detail: null,
        blob_sha256: blobSha,
        t: row.time_created,
      })
    }
  }

  const record: AssistantPart = {
    type: "tool",
    call_id: callID,
    name,
    status,
    time: { created: tCreated, ran: asNum(time.ran), completed: tCompleted },
    input: thinStrings(state.input, sink),
    output: outputText.length > BLOB_LIMIT ? outputText.slice(0, BLOB_LIMIT) : outputText,
    truncated: meta.truncated === true,
    output_path: asStr(meta.outputPath),
    child_session_id: childSessionID,
  }
  const withRef =
    outputText.length > BLOB_LIMIT ? { ...record, output_ref: sink(outputText) } : record
  return state.error === undefined ? withRef : { ...withRef, error: state.error }
}

const normalizePart = (
  value: unknown,
  row: MessageRow,
  sink: BlobSink,
  delegations: DelegationFact[],
  fileReads: FileReadLedgerRow[],
  skillLoads: SkillLoadLedgerRow[],
  fileTouches: FileTouchRow[],
  canonicalRoot?: string,
): AssistantPart => {
  const part = asObj(value)
  if (part.type === "text") {
    const text = asStr(part.text) ?? ""
    extractInlineSkillBlocks(text, row, `text:${row.id}`, sink, skillLoads)
    return { type: "text", text }
  }
  if (part.type === "reasoning") {
    const text = asStr(part.text)
    const state = asObj(part.state)
    const encrypted = asStr(state.reasoningEncryptedContent)
    return {
      type: "reasoning",
      text_ref: text === null || text.length === 0 ? null : sink(text),
      chars: text?.length ?? 0,
      encrypted_bytes: encrypted?.length ?? 0,
    }
  }
  if (part.type === "tool")
    return toolPart(part, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot)
  return { type: "unknown-part", raw_type: asStr(part.type) ?? "", raw: value }
}

const normalizeUser = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
  skillLoads: SkillLoadLedgerRow[],
): UserRecord => {
  const directText = asStr(data.text)
  const contentPartsText = asArr(data.content ?? data.parts)
    .flatMap((part) => {
      const p = asObj(part)
      return p.type === "text" && typeof p.text === "string" ? [p.text] : []
    })
    .join("\n")
  const text = directText !== null && directText.length > 0 ? directText : contentPartsText
  const textRef = text.length > 0 ? sink(text) : undefined

  extractInlineSkillBlocks(text, row, `user:${row.id}`, sink, skillLoads)

  const skills = asArr(data.skills).map((s, idx) => {
    const skill = asObj(s)
    const skillText = asStr(skill.text)
    const id = asStr(skill.id)
    const name = asStr(skill.name)
    const skillName = name ?? id
    const sRef = skillText === null ? null : sink(skillText)
    if (skillName && skillText !== null) {
      skillLoads.push(
        makeSkillLedgerRow({
          sessionId: row.session_id,
          messageId: row.id,
          seq: row.seq,
          t: row.time_created,
          callId: id ?? `user-skill:${row.id}:${idx}`,
          skillName,
          body: skillText,
          sink,
        }),
      )
    }
    return { id, name, text_ref: sRef }
  })

  return {
    ...base(row),
    kind: "user",
    text,
    ...(textRef !== undefined ? { text_ref: textRef } : {}),
    agents: asArr(data.agents).flatMap((a) => {
      const name = asStr(asObj(a).name)
      return name === null ? [] : [name]
    }),
    files: asArr(data.files).map((f) => {
      const file = asObj(f)
      const blob = asStr(file.data)
      return {
        name: asStr(file.name),
        mime: asStr(file.mime),
        source: asStr(file.source),
        data_ref: blob === null ? null : sink(blob),
      }
    }),
    skills,
  }
}

const normalizeSkill = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
  skillLoads: SkillLoadLedgerRow[],
): SkillRecord => {
  const name = asStr(data.name) ?? asStr(data.skill) ?? asStr(data.id)
  const description = asStr(data.description)
  const rawText = asStr(data.text) ?? asStr(data.content) ?? ""
  const textRef = rawText.length > 0 ? sink(rawText) : null
  if (name) {
    skillLoads.push(
      makeSkillLedgerRow({
        sessionId: row.session_id,
        messageId: row.id,
        seq: row.seq,
        t: row.time_created,
        callId: asStr(data.call_id) ?? asStr(data.id) ?? row.id,
        skillName: name,
        body: rawText,
        summaryFallback: description ?? `skill:${name}`,
        sink,
      }),
    )
  }
  return {
    ...base(row),
    kind: "skill",
    name,
    description,
    text: rawText.length > BLOB_LIMIT ? rawText.slice(0, BLOB_LIMIT) : rawText,
    text_ref: textRef,
    chars: rawText.length,
  }
}

const normalizeShell = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
): ShellRecord => {
  const inputObj = asObj(data.input)
  const command = asStr(data.command) ?? asStr(inputObj.command)
  const cwd = asStr(data.cwd) ?? asStr(inputObj.cwd)
  const exitCode = asNum(data.exitCode) ?? asNum(data.exit_code)
  const rawOutput =
    asStr(data.output) ??
    asStr(data.text) ??
    asArr(data.content)
      .flatMap((c) => {
        const obj = asObj(c)
        return typeof obj.text === "string" ? [obj.text] : []
      })
      .join("")
  const outputRef = rawOutput.length > 0 ? sink(rawOutput) : null
  return {
    ...base(row),
    kind: "shell",
    command,
    cwd,
    exit_code: exitCode,
    output: rawOutput.length > BLOB_LIMIT ? rawOutput.slice(0, BLOB_LIMIT) : rawOutput,
    output_ref: outputRef,
  }
}

const normalizeAssistant = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
  delegations: DelegationFact[],
  fileReads: FileReadLedgerRow[],
  skillLoads: SkillLoadLedgerRow[],
  fileTouches: FileTouchRow[],
  canonicalRoot?: string,
): AssistantRecord => {
  const time = asObj(data.time)
  const completed = asNum(time.completed)
  const record: AssistantRecord = {
    ...base(row),
    kind: "assistant",
    agent: asStr(data.agent),
    model: modelRef(data.model),
    finish: asStr(data.finish),
    cost: asNum(data.cost),
    tokens: data.tokens ?? null,
    time: { created: asNum(time.created), completed },
    incomplete: completed === null,
    parts: asArr(data.content).map((part) =>
      normalizePart(part, row, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot),
    ),
  }
  const extras: Record<string, unknown> = {}
  for (const key of ["error", "retry", "snapshot"] as const) {
    if (data[key] !== undefined) extras[key] = data[key]
  }
  return { ...record, ...extras }
}

const normalizeContext = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
): ContextRecord => {
  const meta = asObj(data.metadata)
  const instruction = asObj(meta.instruction)
  const text = asStr(data.text)
  return {
    ...base(row),
    kind: "context",
    source: asStr(meta.source) ?? asStr(meta.notice) ?? row.type,
    description: asStr(data.description),
    paths: asArr(instruction.paths).flatMap((p) => {
      const s = asStr(p)
      return s === null ? [] : [s]
    }),
    text_ref: text === null || text.length === 0 ? null : sink(text),
  }
}

const normalizeCompaction = (
  row: MessageRow,
  data: Record<string, unknown>,
  prevSeq: number | null,
  sink: BlobSink,
): CompactionRecord => {
  const summary = asStr(data.summary)
  const summaryRef = summary !== null && summary.length > 0 ? sink(summary) : null
  return {
    ...base(row),
    kind: "compaction",
    reason: asStr(data.reason),
    status: asStr(data.status),
    summary,
    ...(summaryRef !== null ? { summary_ref: summaryRef } : {}),
    recent: asStr(data.recent),
    tokens: data.tokens ?? null,
    covers_through_seq: prevSeq,
  }
}

const normalizeBoundary = (
  row: MessageRow,
  data: Record<string, unknown>,
): BoundaryRecord => {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (key !== "time" && key !== "providerState") rest[key] = value
  }
  return {
    ...base(row),
    kind: "boundary",
    subtype: row.type as BoundaryRecord["subtype"],
    ...rest,
  }
}

const normalizeUnknown = (row: MessageRow): UnknownRecord => ({
  ...base(row),
  kind: "unknown",
  raw_type: row.type,
  data: row.data,
})

export function normalizeMessage(
  row: MessageRow,
  sink: BlobSink,
  prevSeq: number | null,
  canonicalRoot?: string,
): NormalizedMessage {
  const delegations: DelegationFact[] = []
  const fileReads: FileReadLedgerRow[] = []
  const skillLoads: SkillLoadLedgerRow[] = []
  const fileTouches: FileTouchRow[] = []
  const data = asObj(row.data)
  const record: MessageRecord =
    row.type === "user"
      ? normalizeUser(row, data, sink, skillLoads)
      : row.type === "assistant"
        ? normalizeAssistant(row, data, sink, delegations, fileReads, skillLoads, fileTouches, canonicalRoot)
        : row.type === "skill"
          ? normalizeSkill(row, data, sink, skillLoads)
          : row.type === "shell"
            ? normalizeShell(row, data, sink)
            : row.type === "synthetic" || row.type === "system"
              ? normalizeContext(row, data, sink)
              : row.type === "compaction"
                ? normalizeCompaction(row, data, prevSeq, sink)
                : BOUNDARY_TYPES.has(row.type)
                  ? normalizeBoundary(row, data)
                  : normalizeUnknown(row)
  return { record, delegations, fileReads, skillLoads, fileTouches }
}

export function foldSessionLedgers(
  rawReads: readonly FileReadLedgerRow[],
  rawSkills: readonly SkillLoadLedgerRow[],
  rawTouches: readonly FileTouchRow[],
): {
  readonly fileReads: FileReadLedgerRow[]
  readonly skillLoads: SkillLoadLedgerRow[]
  readonly fileTouches: FileTouchRow[]
} {
  const readsByKey = new Map<string, FileReadLedgerRow>()
  for (const r of rawReads) {
    const key = `${r.session_id}\0${r.path}`
    const prev = readsByKey.get(key)
    if (!prev || r.read_seq >= prev.read_seq) {
      readsByKey.set(key, r)
    }
  }

  for (const touch of rawTouches) {
    for (const [key, readRow] of readsByKey.entries()) {
      if (
        readRow.session_id === touch.session_id &&
        (readRow.path === touch.path || readRow.normalized_path === touch.normalized_path) &&
        touch.seq > readRow.read_seq
      ) {
        readsByKey.set(key, {
          ...readRow,
          disk_blob_sha: touch.blob_sha256,
          staleness_status: formatStalenessStatus(
            "STALE",
            readRow.start_line ?? 1,
            readRow.end_line ?? 1,
            readRow.total_lines ?? null,
          ),
        })
      }
    }
  }

  const skillsByKey = new Map<string, SkillLoadLedgerRow>()
  for (const s of rawSkills) {
    const key = `${s.session_id}\0${s.skill_name}`
    const prev = skillsByKey.get(key)
    if (!prev || s.load_seq >= prev.load_seq) {
      skillsByKey.set(key, s)
    }
  }

  const touchesByKey = new Map<string, FileTouchRow>()
  for (const t of rawTouches) {
    const key = `${t.session_id}\0${t.message_id}\0${t.call_id}\0${t.path}`
    touchesByKey.set(key, t)
  }

  return {
    fileReads: [...readsByKey.values()],
    skillLoads: [...skillsByKey.values()],
    fileTouches: [...touchesByKey.values()],
  }
}

export function extractSessionLedgers(
  rows: readonly MessageRow[],
  sink: BlobSink,
  canonicalRoot?: string,
): {
  readonly fileReads: FileReadLedgerRow[]
  readonly skillLoads: FileLoadOrSkillRow[]
  readonly fileTouches: FileTouchRow[]
} {
  const rawReads: FileReadLedgerRow[] = []
  const rawSkills: SkillLoadLedgerRow[] = []
  const rawTouches: FileTouchRow[] = []
  let prevSeq: number | null = null
  for (const row of rows) {
    const norm = normalizeMessage(row, sink, prevSeq, canonicalRoot)
    if (norm.fileReads) rawReads.push(...norm.fileReads)
    if (norm.skillLoads) rawSkills.push(...norm.skillLoads)
    if (norm.fileTouches) rawTouches.push(...norm.fileTouches)
    prevSeq = row.seq
  }
  return foldSessionLedgers(rawReads, rawSkills, rawTouches)
}

export function extractSessionProvenanceChains(
  rootSessionId: string,
  sessionId: string,
  messages: readonly NormalizedMessage[],
  rawRows?: readonly MessageRow[],
  canonicalRoot?: string,
): ProvenanceChainRow[] {
  if (messages.length === 0) return []
  const rawById = new Map<string, MessageRow>()
  if (rawRows) {
    for (const r of rawRows) rawById.set(r.id, r)
  }

  const readBlobByPath = new Map<string, string>()
  const touchBlobByPath = new Map<string, string>()

  interface ChainBuilder {
    intentSeq: number
    intentMessageId: string
    intentSummary: string
    decisionSeq: number | null
    decisionSummary: string | null
    touchedFiles: Set<string>
    lastReadPath: string | null
    repairSeq: number | null
    verificationCommand: string | null
    verificationExitCode: number | null
    verificationSeq: number | null
    verificationBlobRef: string | null
    lastTimestamp: number
    hasActivity: boolean
  }

  const chains: ProvenanceChainRow[] = []
  let current: ChainBuilder | null = null

  const flushCurrent = (): void => {
    if (!current || !current.hasActivity) return
    const touchedFiles = [...current.touchedFiles]
    const outcome: ProvenanceChainRow["outcome"] =
      current.verificationCommand !== null && current.verificationExitCode !== null
        ? current.verificationExitCode === 0
          ? "VERIFIED_PASS"
          : "VERIFIED_FAIL"
        : touchedFiles.length > 0
          ? "UNVERIFIED"
          : "IN_PROGRESS"

    const targetPath = touchedFiles[0] ?? current.lastReadPath ?? "session"
    const readOrReviewSha = readBlobByPath.get(targetPath) ?? touchBlobByPath.get(targetPath) ?? ""
    const repairSha =
      touchedFiles.length > 0
        ? touchBlobByPath.get(targetPath) ||
          readOrReviewSha ||
          sha256hex(`${sessionId}:${targetPath}:${current.repairSeq ?? current.intentSeq}`)
        : null

    let diskSha = repairSha ?? readOrReviewSha
    if (canonicalRoot && targetPath !== "session") {
      const absPath = resolveDiskPath(targetPath, canonicalRoot)
      if (existsSync(absPath)) {
        try {
          diskSha = sha256Hex(readFileSync(absPath))
        } catch {
          // keep fallback sha
        }
      }
    }

    const stalenessStatus =
      outcome === "VERIFIED_PASS"
        ? "VERIFIED_FRESH"
        : outcome === "VERIFIED_FAIL"
          ? "STALE (modified since read/review — re-verify slice)"
          : "FRESH — DO NOT REREAD"

    const updatedIso = new Date(current.lastTimestamp).toISOString()

    chains.push({
      chain_id: `${sessionId}:chain:${current.intentSeq}`,
      root_session_id: rootSessionId,
      session_id: sessionId,
      finding_id: `F-${sessionId.slice(-6).toUpperCase()}-${current.intentSeq}`,
      finding_seq: current.intentSeq,
      finding_session_id: sessionId,
      finding_summary: current.decisionSummary ?? current.intentSummary,
      child_session_id: sessionId !== rootSessionId ? sessionId : null,
      intent_seq: current.intentSeq,
      intent_message_id: current.intentMessageId,
      intent_summary: current.intentSummary,
      decision_seq: current.decisionSeq,
      decision_pivot_seq: current.decisionSeq ?? current.intentSeq,
      decision_summary: current.decisionSummary,
      target_path: targetPath,
      touched_files_json: JSON.stringify(touchedFiles),
      read_or_review_blob_sha: readOrReviewSha,
      repair_seq: current.repairSeq,
      repair_session_id: current.repairSeq !== null ? sessionId : null,
      repair_blob_sha: repairSha,
      receipt_command: current.verificationCommand,
      verification_command: current.verificationCommand,
      receipt_exit_code: current.verificationExitCode,
      verification_exit_code: current.verificationExitCode,
      verification_seq: current.verificationSeq,
      receipt_blob_sha: current.verificationBlobRef,
      verification_blob_ref: current.verificationBlobRef,
      head_sha: null,
      worktree_tree_sha: null,
      disk_blob_sha: diskSha,
      staleness_status: stalenessStatus,
      outcome,
      created_at: current.lastTimestamp,
      updated_at: updatedIso,
    })
  }

  for (const norm of messages) {
    const rec = norm.record
    const seq = rec.raw_ref.seq
    const t = rec.t || Date.now()

    for (const r of norm.fileReads) {
      const p = normalizeLedgerPath(r.path, canonicalRoot)
      readBlobByPath.set(p, r.read_blob_sha || r.blob_sha256)
      if (current) current.lastReadPath = p
    }

    if (rec.kind === "user") {
      flushCurrent()
      current = {
        intentSeq: seq,
        intentMessageId: rec.id,
        intentSummary: summarizePayload(rec.text, "User intent"),
        decisionSeq: null,
        decisionSummary: null,
        touchedFiles: new Set<string>(),
        lastReadPath: null,
        repairSeq: null,
        verificationCommand: null,
        verificationExitCode: null,
        verificationSeq: null,
        verificationBlobRef: null,
        lastTimestamp: t,
        hasActivity: false,
      }
      continue
    }

    if (!current) {
      current = {
        intentSeq: seq,
        intentMessageId: rec.id,
        intentSummary: "Session start",
        decisionSeq: null,
        decisionSummary: null,
        touchedFiles: new Set<string>(),
        lastReadPath: null,
        repairSeq: null,
        verificationCommand: null,
        verificationExitCode: null,
        verificationSeq: null,
        verificationBlobRef: null,
        lastTimestamp: t,
        hasActivity: false,
      }
    }

    current.lastTimestamp = Math.max(current.lastTimestamp, t)

    for (const touch of norm.fileTouches) {
      const tp = normalizeLedgerPath(touch.path, canonicalRoot)
      current.touchedFiles.add(tp)
      if (touch.blob_sha256) touchBlobByPath.set(tp, touch.blob_sha256)
      current.repairSeq = seq
      current.hasActivity = true
    }

    if (rec.kind === "shell") {
      if (rec.command) {
        current.verificationCommand = rec.command
        current.verificationExitCode = rec.exit_code ?? 0
        current.verificationSeq = seq
        current.verificationBlobRef = rec.output_ref ?? null
        current.hasActivity = true
      }
    } else if (rec.kind === "assistant") {
      for (const part of rec.parts) {
        if (part.type === "text" && part.text.trim().length > 0 && current.decisionSummary === null) {
          current.decisionSeq = seq
          current.decisionSummary = summarizePayload(part.text, "Assistant decision")
          current.hasActivity = true
        } else if (part.type === "tool") {
          const toolName = part.name.toLowerCase()
          if (SHELL_VERIFY_TOOLS.has(toolName)) {
            const inputObj = asObj(part.input)
            const cmd =
              asStr(inputObj.command) ??
              asStr(inputObj.CommandLine) ??
              asStr(inputObj.cmd) ??
              part.name
            if (cmd) {
              current.verificationCommand = cmd
              current.verificationSeq = seq
              current.verificationBlobRef = part.output_ref ?? null
              current.hasActivity = true
              const rawMsg = rawById.get(rec.id)
              let exitCode: number | null = null
              if (rawMsg) {
                const rawParts = asArr(asObj(rawMsg.data).content)
                for (const rp of rawParts) {
                  const rpObj = asObj(rp)
                  if (rpObj.id === part.call_id) {
                    const meta = asObj(asObj(rpObj.state).metadata)
                    exitCode = asNum(meta.exitCode) ?? asNum(meta.exit_code)
                  }
                }
              }
              if (exitCode === null) {
                const m = part.output.match(/exit(?:\s+code)?[:\s]+(-?\d+)/i)
                if (m?.[1]) exitCode = Number.parseInt(m[1], 10)
              }
              if (exitCode === null) {
                exitCode = part.status === "error" || part.error !== undefined ? 1 : 0
              }
              current.verificationExitCode = exitCode
            }
          }
        }
      }
    }
  }

  flushCurrent()
  return chains
}

type FileLoadOrSkillRow = SkillLoadLedgerRow

const BLOCKER_PATTERNS: ReadonlyArray<{ readonly label: string; readonly regex: RegExp }> = [
  { label: "mcp_init_failed", regex: /MCP server [^\n]+ failed to initialize/i },
  { label: "mcp_timeout", regex: /MCP server [^\n]+ timed out/i },
  { label: "mcp_tool_failed", regex: /MCP tool (?:call )?failed|[^\n]*MCP tool failed with an error/i },
  {
    label: "read_lease_violation",
    regex: /read lease violation|Access denied:[^\n]*outside allowed directories/i,
  },
  {
    label: "explicit_blocked",
    regex: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*BLOCKED\*\*|BLOCKED\s*[—:—-]|Status:\s*`?BLOCKED`?)/,
  },
]

export interface MessageOutcomeInput {
  readonly id?: string
  readonly session_id?: string
  readonly type: string
  readonly seq?: number
  readonly time_created?: number
  readonly time_updated?: number
  readonly data: unknown
}

export function classifyMessagesOutcome(
  messages: readonly MessageOutcomeInput[],
  fallbackReportedOutcome: string | null = null,
): {
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
} {
  let reported: ReportedOutcome = normalizeReportedOutcome(fallbackReportedOutcome)
  let toolErrorCount = 0
  let toolCompletedCount = 0
  let textCharCount = 0
  const blockerReasons: string[] = []

  for (const msg of messages) {
    const data = asObj(msg.data)
    if (msg.type === "idle") {
      const idleOut = normalizeReportedOutcome(data.outcome)
      if (idleOut !== null) reported = idleOut
      continue
    }
    if (msg.type !== "assistant") continue
    const parts = asArr(data.content)
    for (const rawPart of parts) {
      const part = asObj(rawPart)
      if (part.type === "text") {
        const text = asStr(part.text) ?? ""
        textCharCount += text.trim().length
        for (const pat of BLOCKER_PATTERNS) {
          const m = text.match(pat.regex)
          if (m) {
            blockerReasons.push(`${pat.label}: ${m[0].trim().slice(0, 120)}`)
          }
        }
      } else if (part.type === "tool") {
        const state = asObj(part.state)
        const status = asStr(state.status)
        const toolName = asStr(part.name) ?? "tool"
        if (status === "error" || state.error !== undefined) {
          toolErrorCount++
          const errObj = asObj(state.error)
          const errMsg = asStr(errObj.message) ?? asStr(state.error) ?? JSON.stringify(state.error)
          if (blockerReasons.length < 4) {
            blockerReasons.push(`tool_error(${toolName}): ${errMsg.slice(0, 120)}`)
          }
        } else if (status === "completed") {
          toolCompletedCount++
        }
      }
    }
  }

  const hasTextBlocker = blockerReasons.some((r) => !r.startsWith("tool_error("))
  const verified: VerifiedOutcome =
    textCharCount === 0 && toolCompletedCount === 0 && toolErrorCount === 0
      ? "empty_output"
      : toolErrorCount > 0
        ? "tool_error_inside"
        : hasTextBlocker
          ? "blocked_in_text"
          : reported === "failed"
            ? "verified_fail"
            : toolCompletedCount > 0
              ? "verified_pass"
              : "reported_only"

  return {
    reported_outcome: reported,
    verified_outcome: verified,
    blocker_summary: blockerReasons.length > 0 ? blockerReasons.slice(0, 3).join("; ") : null,
    tool_error_count: toolErrorCount,
    tool_completed_count: toolCompletedCount,
    text_char_count: textCharCount,
  }
}

export function segmentChildStops(
  messagesOrSession: readonly MessageOutcomeInput[] | { readonly idle_outcome?: string | null },
  outcomeOrMessages?: string | null | readonly MessageOutcomeInput[],
): ChildStopSegment[] {
  const messages: readonly MessageOutcomeInput[] = Array.isArray(messagesOrSession)
    ? messagesOrSession
    : Array.isArray(outcomeOrMessages)
      ? outcomeOrMessages
      : []
  const sessionIdleOutcome: string | null = Array.isArray(messagesOrSession)
    ? typeof outcomeOrMessages === "string"
      ? outcomeOrMessages
      : null
    : ((messagesOrSession as { readonly idle_outcome?: string | null }).idle_outcome ?? null)

  if (messages.length === 0) return []

  const groups: MessageOutcomeInput[][] = []
  let current: MessageOutcomeInput[] = []
  let seenAssistantInCurrent = false

  for (const msg of messages) {
    if (msg.type === "user" && current.length > 0 && seenAssistantInCurrent) {
      groups.push(current)
      current = [msg]
      seenAssistantInCurrent = false
      continue
    }
    current.push(msg)
    if (msg.type === "assistant") {
      seenAssistantInCurrent = true
    }
    if (msg.type === "idle") {
      groups.push(current)
      current = []
      seenAssistantInCurrent = false
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }

  return groups.map((group, idx) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    const promptTexts: string[] = []
    const responseTexts: string[] = []

    for (const m of group) {
      const mData = asObj(m.data)
      if (m.type === "user") {
        const t = asStr(mData.text)
        if (t) promptTexts.push(t)
      } else if (m.type === "assistant") {
        for (const rawPart of asArr(mData.content)) {
          const p = asObj(rawPart)
          if (p.type === "text" && typeof p.text === "string") {
            responseTexts.push(p.text)
          }
        }
      }
    }

    const classification = classifyMessagesOutcome(group, sessionIdleOutcome)
    return {
      turn_index: idx,
      start_seq: first.seq ?? idx + 1,
      end_seq: last.seq ?? idx + 1,
      start_message_id: first.id ?? "",
      end_message_id: last.id ?? "",
      prompt_text: promptTexts.join("\n"),
      response_text: responseTexts.join("\n"),
      reported_outcome: classification.reported_outcome,
      verified_outcome: classification.verified_outcome,
      blocker_summary: classification.blocker_summary,
      tool_error_count: classification.tool_error_count,
      tool_completed_count: classification.tool_completed_count,
      text_char_count: classification.text_char_count,
    }
  })
}

export interface ChildSessionTurnInput {
  readonly id: string
  readonly project_id?: string
  readonly parent_id?: string | null
  readonly directory?: string
  readonly title?: string | null
  readonly agent?: string | null
  readonly model?: ModelRef | null
  readonly model_id?: string | null
  readonly provider_id?: string | null
  readonly idle_outcome?: string | null
}

export function normalizeDelegationTurns(
  parentSessionId: string,
  parentMessages: readonly MessageOutcomeInput[],
  childSessions: readonly ChildSessionTurnInput[],
  childMessagesById: ReadonlyMap<string, readonly MessageOutcomeInput[]>,
  kvByChildId: ReadonlyMap<string, KvBindingRow> = new Map(),
  sinkText: BlobSink = (t) => `blob:${sha256hex(t)}`,
  sourceOrigin = "host_db",
): DelegationTurnRow[] {
  interface ParentCallFact {
    readonly call_id: string
    readonly seq: number
    readonly child_session_id: string
    readonly mode: "spawn" | "send" | "continue"
    readonly agent: string | null
    readonly harness: Harness | null
    readonly prompt: string | null
  }

  const callsByChild = new Map<string, ParentCallFact[]>()
  for (const msg of parentMessages) {
    if (msg.type !== "assistant") continue
    const data = asObj(msg.data)
    for (const rawPart of asArr(data.content)) {
      const part = asObj(rawPart)
      if (part.type !== "tool") continue
      const toolName = asStr(part.name) ?? ""
      if (!DELEGATION_TOOLS.has(toolName)) continue
      const state = asObj(part.state)
      const meta = asObj(state.metadata)
      const input = asObj(state.input)
      const childId = asStr(meta.sessionID) ?? asStr(input.sessionID)
      if (!childId) continue
      const callId = asStr(part.id) ?? `call:${parentSessionId}:${msg.seq ?? 0}`
      const hasInputSession = typeof input.sessionID === "string" && input.sessionID.length > 0
      const list = callsByChild.get(childId) ?? []
      const mode: "spawn" | "send" | "continue" =
        hasInputSession || list.length > 0 ? "send" : "spawn"
      const hStr = asStr(input.harness)
      const harness: Harness | null =
        hStr === "devin" || hStr === "antigravity" || hStr === "opencode"
          ? hStr
          : toolName === "delegate-devin"
            ? "devin"
            : null
      list.push({
        call_id: callId,
        seq: msg.seq ?? 0,
        child_session_id: childId,
        mode,
        agent: asStr(input.agent),
        harness,
        prompt: asStr(input.prompt),
      })
      callsByChild.set(childId, list)
    }
  }

  const turns: DelegationTurnRow[] = []

  for (const child of childSessions) {
    const childMsgs = childMessagesById.get(child.id) ?? []
    const stops = segmentChildStops(childMsgs, child.idle_outcome ?? null)
    const parentCalls = callsByChild.get(child.id) ?? []
    const kv = kvByChildId.get(child.id)
    const providerId = child.provider_id ?? child.model?.providerID ?? null
    const modelId = child.model_id ?? child.model?.id ?? null
    const resolvedHarness = inferHarness(
      kv?.harness ?? parentCalls[0]?.harness ?? null,
      child.agent ?? kv?.agent,
      child.title ?? kv?.title,
      providerId,
    )
    const resolvedModel = kv?.confirmed_model ?? kv?.model ?? modelId ?? null
    const resolvedAgent = child.agent ?? kv?.agent ?? parentCalls[0]?.agent ?? null
    const foreignSessionId = kv?.foreign_session_id ?? null

    if (stops.length === 0) {
      const callFact = parentCalls[0]
      turns.push({
        parent_session_id: parentSessionId,
        call_id: callFact?.call_id ?? kv?.call_id ?? `parent:${child.id}`,
        turn_index: 0,
        child_session_id: child.id,
        mode: callFact?.mode ?? "spawn",
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: 0,
        end_seq: 0,
        start_message_id: "",
        end_message_id: "",
        reported_outcome: normalizeReportedOutcome(child.idle_outcome),
        verified_outcome: "empty_output",
        blocker_summary: null,
        tool_error_count: 0,
        tool_completed_count: 0,
        text_char_count: 0,
        prompt_blob: callFact?.prompt ? sinkText(callFact.prompt) : null,
        response_blob: null,
        source_origin: sourceOrigin,
      })
      continue
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!
      const callFact = parentCalls[i]
      const callId = callFact?.call_id ?? kv?.call_id ?? `turn:${child.id}:${i}`
      const mode: "spawn" | "send" | "continue" =
        i === 0 ? "spawn" : (callFact?.mode ?? "send")
      const promptText = stop.prompt_text || callFact?.prompt || ""
      const responseText = stop.response_text || ""

      turns.push({
        parent_session_id: parentSessionId,
        call_id: callId,
        turn_index: i,
        child_session_id: child.id,
        mode,
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: stop.start_seq,
        end_seq: stop.end_seq,
        start_message_id: stop.start_message_id,
        end_message_id: stop.end_message_id,
        reported_outcome: stop.reported_outcome,
        verified_outcome: stop.verified_outcome,
        blocker_summary: stop.blocker_summary,
        tool_error_count: stop.tool_error_count,
        tool_completed_count: stop.tool_completed_count,
        text_char_count: stop.text_char_count,
        prompt_blob: promptText.length > 0 ? sinkText(promptText) : null,
        response_blob: responseText.length > 0 ? sinkText(responseText) : null,
        source_origin: sourceOrigin,
      })
    }
  }

  return turns
}

