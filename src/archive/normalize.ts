import type {
  AssistantPart,
  AssistantRecord,
  BlobSink,
  BoundaryRecord,
  CompactionRecord,
  ContextRecord,
  DelegationFact,
  Harness,
  MessageRecord,
  MessageRow,
  ModelRef,
  NormalizedMessage,
  SessionHeader,
  SessionRow,
  UnknownRecord,
  UserRecord,
  Lane,
} from "./types.ts"

const BLOB_LIMIT = 4096

const DELEGATION_TOOLS = new Set(["subagent", "delegate-devin", "hivemind-delegate"])

const BOUNDARY_TYPES = new Set(["idle", "agent-switched", "model-switched", "location-switched"])

export function sha256hex(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex")
}

const asObj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const asStr = (value: unknown): string | null => (typeof value === "string" ? value : null)

const asNum = (value: unknown): number | null => (typeof value === "number" ? value : null)

const asArr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

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

const toolPart = (
  part: Record<string, unknown>,
  row: MessageRow,
  sink: BlobSink,
  delegations: DelegationFact[],
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
): AssistantPart => {
  const part = asObj(value)
  if (part.type === "text") return { type: "text", text: asStr(part.text) ?? "" }
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
  if (part.type === "tool") return toolPart(part, row, sink, delegations)
  return { type: "unknown-part", raw_type: asStr(part.type) ?? "", raw: value }
}

const normalizeUser = (row: MessageRow, data: Record<string, unknown>, sink: BlobSink): UserRecord => ({
  ...base(row),
  kind: "user",
  text: asStr(data.text) ?? "",
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
  skills: asArr(data.skills).map((s) => {
    const skill = asObj(s)
    const text = asStr(skill.text)
    return { id: asStr(skill.id), name: asStr(skill.name), text_ref: text === null ? null : sink(text) }
  }),
})

const normalizeAssistant = (
  row: MessageRow,
  data: Record<string, unknown>,
  sink: BlobSink,
  delegations: DelegationFact[],
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
    parts: asArr(data.content).map((part) => normalizePart(part, row, sink, delegations)),
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
): CompactionRecord => ({
  ...base(row),
  kind: "compaction",
  reason: asStr(data.reason),
  status: asStr(data.status),
  summary: asStr(data.summary),
  recent: asStr(data.recent),
  tokens: data.tokens ?? null,
  covers_through_seq: prevSeq,
})

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
): NormalizedMessage {
  const delegations: DelegationFact[] = []
  const data = asObj(row.data)
  const record: MessageRecord =
    row.type === "user"
      ? normalizeUser(row, data, sink)
      : row.type === "assistant"
        ? normalizeAssistant(row, data, sink, delegations)
        : row.type === "synthetic" || row.type === "system"
          ? normalizeContext(row, data, sink)
          : row.type === "compaction"
            ? normalizeCompaction(row, data, prevSeq)
            : BOUNDARY_TYPES.has(row.type)
              ? normalizeBoundary(row, data)
              : normalizeUnknown(row)
  return { record, delegations }
}
