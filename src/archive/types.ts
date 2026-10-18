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
  readonly text_ref?: string | null
  readonly agents: readonly string[]
  readonly files: readonly FileRef[]
  readonly skills: readonly SkillRef[]
}

export interface SkillRecord extends RecordBase {
  readonly kind: "skill"
  readonly name: string | null
  readonly description: string | null
  readonly text: string
  readonly text_ref: string | null
  readonly chars: number
}

export interface ShellRecord extends RecordBase {
  readonly kind: "shell"
  readonly command: string | null
  readonly cwd: string | null
  readonly exit_code: number | null
  readonly output: string
  readonly output_ref: string | null
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
  readonly summary_ref?: string | null
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
  | SkillRecord
  | ShellRecord
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

export type ReportedOutcome = "succeeded" | "failed" | "interrupted" | "running" | null

export type VerifiedOutcome =
  | "clean"
  | "verified_pass"
  | "verified_fail"
  | "tool_error_inside"
  | "blocked_in_text"
  | "reported_only"
  | "empty_output"

export interface ChildStopSegment {
  readonly turn_index: number
  readonly start_seq: number
  readonly end_seq: number
  readonly start_message_id: string
  readonly end_message_id: string
  readonly prompt_text: string
  readonly response_text: string
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
}

export interface DelegationTurnRow {
  readonly parent_session_id: string
  readonly call_id: string
  readonly turn_index: number
  readonly child_session_id: string
  readonly mode: "spawn" | "send" | "continue"
  readonly harness: Harness
  readonly agent: string | null
  readonly model: string | null
  readonly foreign_session_id: string | null
  readonly start_seq: number
  readonly end_seq: number
  readonly start_message_id: string
  readonly end_message_id: string
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
  readonly prompt_blob: string | null
  readonly response_blob: string | null
  readonly source_origin: string
}

export interface FileReadLedgerRow {
  readonly session_id: string
  readonly path: string
  readonly normalized_path: string
  readonly call_id: string
  readonly message_id: string
  readonly seq: number
  readonly read_seq: number
  readonly line_range: string
  readonly start_line: number | null
  readonly end_line: number | null
  readonly total_lines?: number | null
  readonly is_truncated?: boolean | number
  readonly chars: number
  readonly char_len: number
  readonly blob_sha: string
  readonly blob_sha256: string
  readonly slice_sha?: string
  readonly read_blob_sha: string
  readonly disk_blob_sha: string
  readonly summary: string
  readonly staleness_status: string
  readonly t: number
  readonly updated_at: string
}

export interface ProvenanceChainRow {
  readonly chain_id: string
  readonly root_session_id: string
  readonly session_id: string
  readonly finding_id: string
  readonly finding_seq: number
  readonly finding_session_id: string
  readonly finding_summary: string
  readonly child_session_id: string | null
  readonly intent_seq: number
  readonly intent_message_id: string
  readonly intent_summary: string
  readonly decision_seq: number | null
  readonly decision_pivot_seq: number | null
  readonly decision_summary: string | null
  readonly target_path: string
  readonly touched_files_json: string
  readonly read_or_review_blob_sha: string
  readonly repair_seq: number | null
  readonly repair_session_id: string | null
  readonly repair_blob_sha: string | null
  readonly receipt_command: string | null
  readonly verification_command: string | null
  readonly receipt_exit_code: number | null
  readonly verification_exit_code: number | null
  readonly verification_seq: number | null
  readonly receipt_blob_sha: string | null
  readonly verification_blob_ref: string | null
  readonly head_sha: string | null
  readonly worktree_tree_sha: string | null
  readonly disk_blob_sha: string
  readonly staleness_status: string
  readonly outcome: "VERIFIED_PASS" | "VERIFIED_FAIL" | "UNVERIFIED" | "IN_PROGRESS"
  readonly created_at: number
  readonly updated_at: string
}

export interface SkillLoadLedgerRow {
  readonly session_id: string
  readonly skill_name: string
  readonly call_id: string
  readonly message_id: string
  readonly seq: number
  readonly loaded_seq: number
  readonly load_seq: number
  readonly chars: number
  readonly char_len: number
  readonly blob_sha: string
  readonly blob_sha256: string
  readonly skill_blob_sha: string
  readonly blob_ref: string
  readonly summary: string
  readonly status: string
  readonly t: number
}

export interface FileTouchRow {
  readonly session_id: string
  readonly message_id: string
  readonly call_id: string
  readonly seq: number
  readonly tool: string
  readonly op: string
  readonly operation: string
  readonly path: string
  readonly normalized_path: string
  readonly detail?: string | null
  readonly blob_sha256: string
  readonly t: number
}

export interface SnapshotArtifactRow {
  readonly session_id: string
  readonly message_id: string
  readonly seq: number
  readonly path: string
  readonly start_tree_sha: string
  readonly end_tree_sha: string
  readonly start_blob_sha: string | null
  readonly end_blob_sha: string | null
  readonly start_git_blob_sha: string | null
  readonly end_git_blob_sha: string | null
  readonly start_byte_len: number | null
  readonly end_byte_len: number | null
  readonly byte_len: number
  readonly source_origin: string
}

export interface SpillArtifactRow {
  readonly session_id: string
  readonly call_id: string
  readonly message_id: string
  readonly seq: number
  readonly tool_name: string
  readonly spill_kind: "tool-output" | "shell"
  readonly spill_source: string
  readonly inline_byte_len: number
  readonly full_byte_len: number
  readonly blob_sha: string
  readonly source_origin: string
}

export interface SyncWatermarkRow {
  readonly session_id: string
  readonly root_id: string
  readonly last_time_updated: number
  readonly last_max_seq: number
  readonly last_message_id: string
  readonly last_kv_updated: number
  readonly synced_at: string
}

export interface HostSessionRow {
  readonly id: string
  readonly project_id: string
  readonly parent_id: string | null
  readonly slug?: string | null
  readonly directory: string
  readonly title: string | null
  readonly version?: string | null
  readonly agent?: string | null
  readonly model_id?: string | null
  readonly provider_id?: string | null
  readonly variant?: string | null
  readonly idle_outcome?: string | null
  readonly time_created: number
  readonly time_updated: number
}

export interface HostMessageRow {
  readonly id: string
  readonly session_id: string
  readonly seq: number
  readonly type: string
  readonly time_created: number
  readonly time_updated: number
  readonly data: Record<string, unknown>
}

export interface NormalizedMessage {
  readonly record: MessageRecord
  readonly delegations: readonly DelegationFact[]
  readonly fileReads: readonly FileReadLedgerRow[]
  readonly skillLoads: readonly SkillLoadLedgerRow[]
  readonly fileTouches: readonly FileTouchRow[]
  readonly provenanceChains?: readonly ProvenanceChainRow[]
}

export interface KvBindingRow {
  readonly child_session_id: string
  readonly raw_key: string
  readonly scope: string | null
  readonly driver_kind: string | null
  readonly harness: Harness | null
  readonly foreign_session_id: string | null
  readonly parent_session_id: string | null
  readonly call_id: string | null
  readonly title: string | null
  readonly cwd: string | null
  readonly agent: string | null
  readonly model: string | null
  readonly effort: string | null
  readonly mode: "spawn" | "send" | "continue" | null
  readonly background: boolean | null
  readonly requested_model: string | null
  readonly confirmed_model: string | null
  readonly confirmed_effort: string | null
  readonly turn: number | null
  readonly phase: string | null
  readonly foreign_ack_turn: number | null
  readonly foreign_ack_stop_reason: string | null
  readonly serving_witness_model: string | null
  readonly serving_witness_at: string | null
  readonly consumed_inputs_json: string | null
  readonly created_at: number | null
  readonly updated_at: number | null
  readonly source_origin?: string
}

export interface KvForeignIndexRow {
  readonly harness: string
  readonly foreign_session_id: string
  readonly child_session_id: string
  readonly raw_key: string
}

export interface KvContextPruneRow {
  readonly session_id: string
  readonly raw_key: string
  readonly scope: string | null
  readonly mode: string | null
  readonly anchor_message_id: string | null
  readonly recorded_at: string | null
  readonly updated_at: number | null
}

export interface KvState {
  readonly bindings: readonly KvBindingRow[]
  readonly foreignIndex: readonly KvForeignIndexRow[]
  readonly contextPrunes: readonly KvContextPruneRow[]
}
