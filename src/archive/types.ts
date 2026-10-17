// Row types mirror the host SQLite schema (session_v2, session_message,
// project). Record types are the archive's own wire format — one JSON object
// per JSONL line.

export interface ModelRef {
  readonly id: string
  readonly providerID: string
  readonly variant?: string
}

export interface ProjectRow {
  readonly id: string
  readonly worktree: string
}

export interface SessionRow {
  readonly id: string
  readonly project_id: string
  readonly parent_id: string | null
  readonly fork_session_id: string | null
  readonly fork_boundary: string | null
  readonly directory: string
  readonly title: string | null
  readonly agent: string | null
  readonly model: ModelRef | null
  readonly idle_outcome: string | null
  readonly cost: number
  readonly tokens_input: number
  readonly tokens_output: number
  readonly tokens_reasoning: number
  readonly tokens_cache_read: number
  readonly tokens_cache_write: number
  readonly summary_additions: number | null
  readonly summary_deletions: number | null
  readonly summary_files: number | null
  readonly time_created: number
  readonly time_updated: number
  readonly time_idle: number | null
  readonly time_compacting: number | null
  readonly time_archived: number | null
  readonly resume_attempts: number
}

export interface MessageRow {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly seq: number
  readonly time_created: number
  readonly time_updated: number
  /** Parsed JSON of the `data` column. */
  readonly data: unknown
}

export type Harness = "devin" | "antigravity" | "opencode"

export interface Lane {
  readonly kind: "root" | "nested" | "external"
  /** "" for root, relative path for nested, absolute path for external. */
  readonly path: string
}

export interface SessionHeader {
  readonly kind: "session"
  readonly schema: 1
  readonly id: string
  readonly project_id: string
  readonly root_id: string
  readonly parent_id: string | null
  readonly depth: number
  readonly lane: Lane
  readonly directory: string
  readonly title: string | null
  readonly agent: string | null
  readonly model: ModelRef | null
  readonly harness: Harness
  readonly outcome: string | null
  readonly fork: { readonly from: string; readonly boundary: string | null } | null
  readonly cost: number
  readonly tokens: {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cache_read: number
    readonly cache_write: number
  }
  readonly summary: {
    readonly files: number | null
    readonly additions: number | null
    readonly deletions: number | null
  }
  readonly time: {
    readonly created: number
    readonly updated: number
    readonly idle: number | null
    readonly compacting: number | null
    readonly archived: number | null
  }
  readonly resume_attempts: number
  readonly message_count: number
  readonly children: readonly string[]
}

interface RecordBase {
  readonly id: string
  readonly raw_ref: {
    readonly session_id: string
    readonly message_id: string
    readonly seq: number
  }
  readonly t: number
}

export interface FileRef {
  readonly name: string | null
  readonly mime: string | null
  readonly source: string | null
  readonly data_ref: string | null
}

export interface SkillRef {
  readonly id: string | null
  readonly name: string | null
  readonly text_ref: string | null
}

export interface UserRecord extends RecordBase {
  readonly kind: "user"
  readonly text: string
  readonly agents: readonly string[]
  readonly files: readonly FileRef[]
  readonly skills: readonly SkillRef[]
}

export type AssistantPart =
  | { readonly type: "text"; readonly text: string }
  | {
    readonly type: "reasoning"
    readonly text_ref: string | null
    readonly chars: number
    readonly encrypted_bytes: number
  }
  | {
    readonly type: "tool"
    readonly call_id: string
    readonly name: string
    readonly status: string | null
    readonly time: {
      readonly created: number | null
      readonly ran: number | null
      readonly completed: number | null
    }
    readonly input: unknown
    readonly output: string
    readonly output_ref?: string
    readonly truncated: boolean
    readonly output_path: string | null
    readonly child_session_id: string | null
    readonly error?: unknown
  }
  | { readonly type: "unknown-part"; readonly raw_type: string; readonly raw: unknown }

export interface AssistantRecord extends RecordBase {
  readonly kind: "assistant"
  readonly agent: string | null
  readonly model: ModelRef | null
  readonly finish: string | null
  readonly cost: number | null
  readonly tokens: unknown
  readonly time: { readonly created: number | null; readonly completed: number | null }
  readonly incomplete: boolean
  readonly parts: readonly AssistantPart[]
  readonly error?: unknown
  readonly retry?: unknown
  readonly snapshot?: unknown
}

export interface ContextRecord extends RecordBase {
  readonly kind: "context"
  readonly source: string
  readonly description: string | null
  readonly paths: readonly string[]
  readonly text_ref: string | null
}

export interface CompactionRecord extends RecordBase {
  readonly kind: "compaction"
  readonly reason: string | null
  readonly status: string | null
  readonly summary: string | null
  readonly recent: string | null
  readonly tokens: unknown
  readonly covers_through_seq: number | null
}

export interface BoundaryRecord extends RecordBase {
  readonly kind: "boundary"
  readonly subtype: "idle" | "agent-switched" | "model-switched" | "location-switched"
  readonly outcome?: string | null
  readonly agent?: string
  readonly previous?: unknown
  readonly model?: ModelRef
  readonly location?: unknown
  readonly projectID?: string
  readonly subpath?: string
}

export interface UnknownRecord extends RecordBase {
  readonly kind: "unknown"
  readonly raw_type: string
  readonly data: unknown
}

export type MessageRecord =
  | UserRecord
  | AssistantRecord
  | ContextRecord
  | CompactionRecord
  | BoundaryRecord
  | UnknownRecord

export type ArchiveRecord = SessionHeader | MessageRecord

/** Register a blob body, get back its "blob:<sha256>" reference. */
export type BlobSink = (text: string) => string

/** Side-channel facts persist() needs for index.sqlite, not serialized. */
export interface DelegationFact {
  readonly call_id: string
  readonly message_id: string
  readonly seq: number
  readonly child_session_id: string
  readonly tool: string
  readonly agent: string | null
  readonly harness: Harness | null
  readonly mode: "spawn" | "continue"
  readonly background: boolean
  readonly description: string | null
  readonly prompt_ref: string | null
  readonly status: string | null
  readonly t_created: number | null
  readonly t_completed: number | null
}

export interface NormalizedMessage {
  readonly record: MessageRecord
  readonly delegations: readonly DelegationFact[]
}
