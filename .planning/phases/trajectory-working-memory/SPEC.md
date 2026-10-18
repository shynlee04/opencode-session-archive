# Phase E1.1 specification for trajectory and working-memory substrate

- **Phase.** `E1.1` (`trajectory-working-memory`)
- **Epic.** `E1` (Unified Context & Working-Memory Substrate)
- **Status.** `draft` (ready for independent `spec-review`)
- **Date.** 2026-10-18
- **Owner.** Specification Author (`to-spec`)
- **Authoritative inputs.** [`GLOSSARY.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/GLOSSARY.md), [`PROJECT.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/PROJECT.md), [`ROADMAP.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/ROADMAP.md), [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md), [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md), [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md), [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md), [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md), [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md)

## Problem

OpenCode V2 sessions currently split trajectory archival and active working-memory pruning across disconnected prototypes in [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts) and [`.opencode/plugins/context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts). Forensic traces across exported production sessions in [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md) and [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md) proved five failure modes for human operators, orchestrator agents, and delegated specialists:

1. **Zero-byte pruning on single-prompt autonomous runs.** In [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115), both `"recent"` and `"initial"` modes slice `event.messages` at `findLastIndex(m => m.role === "user")`. During the 44-step single-prompt autonomous run in `ses_eb2eabb14ffeCXsCwb845rtffb` (`msg[45]`, `257,434` input tokens), `msg[0]` was the only user message. Calling `context-prune({ mode: "recent" })` thinned `0` tool parts and freed `0` bytes. Six steps later at `msg[51]` (`274,175` input tokens), the session hit hard auto-compaction and re-read `28` files and `15` skills in `msg[52..63]` (measured in [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md#L23-L32)).
2. **Post-prune panic re-read loops from blind stub erasure.** In `ses_eb23bfbf0ffesn5kT0yJI06h35` (`msg[123]`), `context-prune({ mode: "recent" })` replaced `53` completed tool outputs (`311,570` raw characters) with generic `"rerun the tool"` stubs and instructed the model to re-invoke reduced skills. Without content-addressed `blob:<sha256>` handles or a Do-Not-Reread ledger, the agent ran two shell scrapes (`30,331` characters in `msg[124..125]`), `14` redundant `read` calls (`113,199` characters), and `7` redundant skill loads (`21,641` characters) before exhausting provider quota at `msg[135]` (measured in [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md#L64-L104)).
3. **Uncaptured host `kv` bindings, shadow snapshots, and external spills.** [`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts#L11-L41) reads only `project`, `session_v2`, and `session_message`. It ignores the `1,614` rows in `opencode.db` table `kv` (`plugin:<utf16be-hex>:bindings/<childSessionID>` and `delegate-mode/child/<childSessionID>`). It drops uncommitted file drafts stored as Git trees in `~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/` before 7-day `git gc`. It also hashes only truncated inline previews instead of full external spills in `~/.local/share/opencode/tool-output/` and `~/.local/share/opencode/shell/` (`181,547` full bytes vs `51,365` inline bytes on `chatcmpl-tool-9b34556554cc90bd`, measured in [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md#L80-L83)).
4. **Overwritten multi-stop child turns and false-positive `succeeded` outcomes.** Resumed foreign children (`mode: "send"` or `"continue"`) execute multiple stops inside one `child_session_id` (`2` to `3` stops per child in `ses_ecbfc0f40ffenfykTrNGoMS6o1`). Collapsing child lineage by `(parent_session_id, child_session_id)` overwrites earlier stops. Across `ses_ecbfc0f40ffenfykTrNGoMS6o1` and `ses_eb23bfbf0ffesn5kT0yJI06h35`, `11` Antigravity child sessions recorded host `idle.outcome = "succeeded"` while containing `1` to `81` tool errors, MCP server initialization timeouts (`context7`, `tavily-search`), or explicit `BLOCKED` text markers (measured in [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md#L48-L68)).
5. **Full-tree SQLite rebuild latency and missing message normalization.** [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L362-L390) deletes and re-inserts the entire root session tree on every `persist()` call (`424.97 ms` cold median across `22` sessions and `745` messages in `ses_eb23bfbf0ffesn5kT0yJI06h35`, measured in [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md#L64-L78)). Meanwhile, [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L216-L239) leaves `user.text` unsunk (`16,626` characters in `msg_14c3f65d80010Tf41DlTd8mHOX`) and routes standalone `skill` and `shell` rows to `unknown`.

## Solution

Phase E1.1 builds the foundational Trajectory and Working-Memory Substrate across The Spine, The Honeycomb (`.session-archive/index.sqlite`), and the `WorkingSetValve`:

1. **Read-only host ingestion and complete Spine sinking (`REQ-SUB-01`, `REQ-SUB-02`, `REQ-SUB-04`, `REQ-SUB-05`).** Open `~/.local/share/opencode/opencode.db` strictly with `{ readonly: true }` and validate required columns on `project`, `session_v2`, `session_message`, and `kv`. Decode UTF-16BE hex plugin namespaces in `kv` using indexed primary-key lookups (`0.79 ms` for `22` sessions). Normalize all OpenCode V2 message types (`user`, `assistant`, `skill`, `shell`, `compaction`, `synthetic`, `system`, and boundaries). Sink every human prompt (`user.text`), skill payload, tool output, external spill (`tool-output/` and `shell/`), and shadow snapshot file draft (`git cat-file --batch` with `gitBlobSha -> sha256` memoization, `43.89 ms` for `62` snapshots) into `.session-archive/blobs/<sha256>.txt`.
2. **Multi-stop delegation lineage and outcome verification (`REQ-SUB-03`).** Index per-stop child segments in `delegation_turn` keyed by `PRIMARY KEY (parent_session_id, call_id, turn_index)` alongside the summary `delegation` table. Classify `reported_outcome` (`idle.outcome`) separately from `verified_outcome` (`clean`, `tool_error_inside`, `blocked_in_text`, `empty_output`, `reported_only`) with `100%` detection of false-positive `succeeded` child turns.
3. **Watermark-gated incremental sync and WAL concurrency (`REQ-SUB-06`).** Track monotonic per-session watermarks in `sync_watermark`. Skip unchanged sessions in `< 2 ms` (`1.90 ms` median) and sync 1-turn deltas on `session.status` (`idle`), `compaction`, and explicit tool calls in `< 150 ms` (`3.72 ms` median without snapshots, `14.35 ms` median with `5` snapshots). Configure `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;` and execute writes inside `BEGIN IMMEDIATE` transactions (`0` `SQLITE_BUSY` errors across `6` concurrent lanes).
4. **Hybrid step-watermark valve and `< 2 ms` in-memory `context` hook (`REQ-SUB-07`, `REQ-SUB-08`).** Support explicit `substrate.valve` calls (`mode: "step-window" | "recent" | "initial"`, default `keepRecentSteps = 8`, with single-prompt auto-run fallback when `lastUserIndex <= activeStartIndex`) and automatic watermark activation in `ctx.session.hook("context", ...)` when estimated active input tokens exceed `65%` of the model context window (`keepRecentSteps = 12`). Precompute `FactBreadcrumb` handles (`blob:<sha12>`) and the Do-Not-Reread `WorkingMemoryManifest` in `armValve` so `applyContextHookInMemory` runs purely in memory in `< 2 ms` (`0.0150..0.0337 ms` measured median) with zero SQLite or filesystem I/O.

## User stories

1. **Single-prompt autonomous run pruning (`REQ-SUB-07`, `REQ-SUB-08`).** As a Specialist or Orchestrator agent executing a 45-step single-prompt autonomous run, I can invoke `substrate.valve({ mode: "step-window", keepRecentSteps: 8 })` or `substrate.valve({ mode: "recent" })` (or cross the `65%` context-window watermark with `keepRecentSteps = 12`) so completed tool outputs prior to the `K`-th most recent assistant step collapse to `FactBreadcrumb`s, freeing `60%+` of active context tokens without waiting for a new human prompt.
2. **Zero-reread working-memory continuity (`REQ-SUB-04`, `REQ-SUB-08`).** As an agent continuing work after context thinning, I receive a `WorkingMemoryManifest` in `event.system` and structured `FactBreadcrumb`s in `event.messages` showing `blob:<sha12>` handles, line ranges, 1-line summaries, and `FRESH — DO NOT REREAD` or `ACTIVE — DO NOT RE-INVOKE` directives. I never re-read unchanged files or re-invoke loaded skills, while retaining the ability to resolve exact lines via `substrate.viewport({ action: "resolve", blob: "<sha12>" })` or detect `STALE` files when disk hashes change.
3. **Multi-stop foreign child audit and false-positive blocker detection (`REQ-SUB-02`, `REQ-SUB-03`).** As an Orchestrator reconciling delegated `devin`, `antigravity`, and `opencode` child sessions, I can inspect each child stop (`turn_index = 0, 1, ...`) linked to its decoded `kv_binding` (`foreign_session_id`, `turn`, `phase`, `serving_witness_model`). I can distinguish `reported_outcome = "succeeded"` from `verified_outcome` (`clean`, `tool_error_inside`, `blocked_in_text`) so MCP timeouts, read-lease denials, and explicit `BLOCKED` turns are never mistaken for clean completions.
4. **Point-in-time uncommitted draft and truncated spill recovery (`REQ-SUB-04`, `REQ-SUB-05`).** As a human operator or Orchestrator auditing a session after worktree resets or tool output truncation, I can recover exact uncommitted file drafts (`start_blob_sha` and `end_blob_sha` extracted from OpenCode shadow Git trees) and full untruncated `tool-output/` and `shell/` spill blobs from `.session-archive/blobs/<sha256>.txt` even after the host's 7-day GC window expires.
5. **Sub-150ms background sync and concurrent worktree safety (`REQ-SUB-01`, `REQ-SUB-06`).** As a human operator running parallel OpenCode worktree lanes against the `2.15 GB` `~/.local/share/opencode/opencode.db`, I get automatic incremental archival into `<canonicalRoot>/.session-archive/index.sqlite` on `idle` and `compaction` boundaries in `< 150 ms` without host hot-reload loops, host DB mutations, or `SQLITE_BUSY` crashes.
6. **Loud fail-fast on host schema drift (`REQ-SUB-01`).** As a maintainer upgrading OpenCode, if `project`, `session_v2`, `session_message`, or `kv` drops a required column, `sqliteSource` closes the read-only handle and throws `session-archive: host schema drift: <table>.<column> missing` immediately rather than writing corrupt archive records.

## Requirements

### Requirement summary table

| ID | Title | Owning Seam | Domain Invariants | Prototype Proof |
|---|---|---|---|---|
| `REQ-SUB-01` | Host Read-Only Boundary & Schema Drift Guard | `src/archive/source.ts`, `src/archive/layout.ts` | Read-only host isolation; archive locality outside `.opencode/` | [`test/source.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/source.test.ts), [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md) |
| `REQ-SUB-02` | Host `kv` Namespace Decoding & Durable Foreign Session Bindings | `src/archive/source.ts`, `src/archive/index-db.ts` | Indexed PK `kv` probes (`0.79 ms` vs `30.2 ms` scan); UTF-16BE namespace decoding | [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md), [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md) |
| `REQ-SUB-03` | Multi-Stop `DelegationTurn` Lineage & `ReportedOutcome` vs `VerifiedOutcome` Classifier | `src/archive/normalize.ts`, `src/archive/index-db.ts` | Invariant 3 (Reported vs Verified Outcome Separation); per-stop PK `(parent_session_id, call_id, turn_index)` | [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md) (`11/11` false-positives caught) |
| `REQ-SUB-04` | Full Message Normalization & Prompt/Skill/Shell Blob Sinking | `src/archive/normalize.ts`, `src/archive/types.ts`, `src/archive/index-db.ts` | Invariant 1 (No Blind Stub Erasure), Invariant 4, Invariant 5; canonical `blob:<sha256>` handles for prompts, skills, shells | [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md), [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md) |
| `REQ-SUB-05` | Shadow Snapshot Git Tree Blob Sinking & External Spill Capture | `src/archive/normalize.ts`, `src/archive/index.ts`, `src/archive/index-db.ts` | Invariant 1 & Invariant 4; 1-pass `git cat-file --batch` (`< 50 ms`) | [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md) (`43.89 ms` for `62` snapshots, `21` spills) |
| `REQ-SUB-06` | Watermark-Gated Incremental SQLite Sync & WAL Concurrency | `src/archive/index.ts`, `src/archive/index-db.ts` | Invariant 5 (`< 150 ms` sync, `< 2 ms` no-op); idempotent `BEGIN IMMEDIATE` WAL writes | [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md) (`1.90 ms` no-op, `3.72..14.35 ms` delta, `0` `SQLITE_BUSY`) |
| `REQ-SUB-07` | Hybrid Assistant Step-Watermark `WorkingSetValve` | `src/plugin.ts`, `src/archive/valve.ts` | Invariant 2 (Intra-Turn Step Watermark); `keepRecentSteps = 8` explicit / `12` at `65%` auto watermark | [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md), [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) |
| `REQ-SUB-08` | Two-Phase `< 2 ms` In-Memory `context` Hook, `FactBreadcrumb`s & `WorkingMemoryManifest` | `src/plugin.ts`, `src/archive/valve.ts` | Invariant 1 (No Blind Stub Erasure), Invariant 4 (Staleness), Invariant 5 (`< 2 ms` pure in-memory hook) | [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md) (`0.0150..0.0337 ms` median, `14/14` files & `7/7` skills covered) |

### Domain invariants enforced in Phase E1.1

1. **Invariant 1 (No Blind Stub Erasure).** No `ActiveContext` tool output or `<skill_content>` block may be thinned by `WorkingSetValve` until its full payload (including external `~/.local/share/opencode/tool-output/` or `~/.local/share/opencode/shell/` spills) is sunk into `.session-archive/blobs/<sha256>.txt` and replaced with a structured `FactBreadcrumb` carrying `blob:<sha12>`, tool name, target path or command, line range, character count, 1-line summary, and freshness status (`FRESH — DO NOT REREAD` or `STALE`).
2. **Invariant 2 (Intra-Turn Step Watermark).** `WorkingSetValve` must anchor pruning to the `K`-th most recent `assistant` message (`anchorMessageID`, `keepRecentSteps`) whenever `mode === "step-window"`, whenever `mode === "recent"` is called during a single-prompt run (`lastUserIndex <= activeStartIndex` and `assistantStepsAfterLastUser > K`), or when automatic context-window protection triggers at `> 65%` capacity (`K = 12`).
3. **Invariant 3 (Reported vs Verified Outcome Separation).** Host `idle.outcome = "succeeded"` (`reported_outcome`) never promotes a child delegation turn to a clean verified status on its own. `verified_outcome` must inspect child tool error counts (`state.status === "error"`), MCP and permission failure patterns, and explicit `BLOCKED` markers in the child's assistant text.
4. **Invariant 4 (Snapshot and File Staleness Detection).** Every `file_read_ledger` and `WorkingMemoryManifest` file entry is bound to its content `blob_sha256`. When the current working-tree file hash diverges from `blob_sha256` (or a later `write`, `edit`, or `patch` modifies the path), the entry and its `FactBreadcrumb` transition from `FRESH — DO NOT REREAD` to `STALE`.
5. **Invariant 5 (Hook Latency and Zero-Spend Determinism).** `ctx.session.hook("context", ...)` must execute strictly in memory in `< 2.0 ms` (`0` SQLite queries, `0` disk reads or writes, `0` `Bun.CryptoHasher` calls, `0` child process spawns). Incremental SQLite and blob persistence runs on `session.status` (`idle`), `compaction`, and explicit tool calls in `< 150 ms` with `0` LLM API calls.

### Detailed requirements

#### REQ-SUB-01 host read-only boundary and schema drift guard

- **Ownership and boundary.** [`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts) (`sqliteSource`) and [`src/archive/layout.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/layout.ts).
- **Behavior:**
  1. `sqliteSource(dbPath)` opens `~/.local/share/opencode/opencode.db` exclusively via `new Database(dbPath, { readonly: true })`.
  2. All access to `~/.local/share/opencode/snapshot/`, `~/.local/share/opencode/tool-output/`, and `~/.local/share/opencode/shell/` is strictly read-only (`readFileSync`, `existsSync`, `statSync`, and read-only `git --git-dir=<shadowRepo> cat-file --batch`). Never write, create, or delete files inside `~/.local/share/opencode/`.
  3. On initialization, `sqliteSource` inspects `pragma_table_info(table)` for `project`, `session_v2`, `session_message`, and `kv`:
     - `project`: `["id", "worktree"]`
     - `session_v2`: `["id", "project_id", "parent_id", "fork_session_id", "fork_boundary", "directory", "title", "agent", "model", "idle_outcome", "cost", "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write", "summary_additions", "summary_deletions", "summary_files", "time_created", "time_updated", "time_idle", "time_compacting", "time_archived", "resume_attempts"]`
     - `session_message`: `["id", "session_id", "type", "seq", "time_created", "time_updated", "data"]`
     - `kv`: when the `kv` table is present, validate that it exposes either the OpenCode v2.0.32 schema `["key", "value", "time_created", "time_updated"]` or the scoped fixture schema `["scope", "name", "value"]`. If `kv` exists with missing columns (or if `kv` is required by `requireKv: true` and missing), close the database handle and throw `new Error("session-archive: host schema drift: <table>.<column> missing")`.
  4. Archive directory resolution defaults to `path.join(projectRoot, ".session-archive")`. If a caller passes `options.dir`, reject any path that resolves inside `.opencode` or `.opencode/` with an explicit error so archive writes never trigger OpenCode plugin hot-reload loops.
- **Acceptance criteria:**
  - Opening `sqliteSource` against a fixture DB missing any required column in `project`, `session_v2`, `session_message`, or `kv` throws `session-archive: host schema drift: <table>.<column> missing`.
  - Passing `dir: ".opencode/archive"` or `dir: ".opencode"` throws a boundary validation error before touching disk.

#### REQ-SUB-02 host `kv` namespace decoding and durable foreign session bindings

- **Ownership and boundary.** [`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts), [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts), and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. Implement `decodeUtf16BeHex(hex)` and `decodeHostKvKey(rawKey, explicitScope)` to decode OpenCode v2.0.32 keys of the form `plugin:<utf16be-hex>:<logical_key>` alongside scoped `(scope, name, value)` rows:
     - `plugin:0068006900760065006d0069006e0064002d0073007400650077006100720064002d006f0063002d0064006500760069006e:<logical_key>` decodes to `scope = "plugin:hivemind-steward-oc-devin"`.
     - `plugin:0063006f006e0074006500780074002d007000720075006e0065:<logical_key>` decodes to `scope = "plugin:context-prune"`.
  2. Parse logical keys under `plugin:hivemind-steward-oc-devin` (`bindings/<childSessionID>`, `bindings/v1/<childSessionID>`, `bindings-by-foreign/v1/<harness>/<foreignSessionId>`, `delegate-mode/child/<childSessionID>`, `delegate-mode/pending/<callID>`) and `plugin:context-prune` (`context-prune:<sessionID>`, `session:<sessionID>:context-prune:<sessionID>`) into three Honeycomb tables:
     - `kv_binding` (`PRIMARY KEY (child_session_id)`). Stores `raw_key`, `scope`, `driver_kind`, `harness`, `foreign_session_id`, `parent_session_id`, `call_id`, `title`, `cwd`, `agent`, `model`, `effort`, `mode`, `background`, `requested_model`, `confirmed_model`, `confirmed_effort`, `turn`, `phase`, `foreign_ack_turn`, `foreign_ack_stop_reason`, `serving_witness_model`, `serving_witness_at`, `consumed_inputs_json`, `created_at`, `updated_at`, `source_origin`.
     - `kv_foreign_index` (`PRIMARY KEY (harness, foreign_session_id)`). Maps `(harness, foreign_session_id)` to `child_session_id`.
     - `kv_context_prune` (`PRIMARY KEY (session_id)`). Stores `raw_key`, `scope`, `mode`, `anchor_message_id`, `recorded_at`, `updated_at`.
  3. **Primary-key lookup rule (`principle-explain-the-number`).** OpenCode's `kv` table has no secondary index on `time_updated` and stores `time_updated` after the `~140 KB` `value` payload. Incremental sync must probe `kv` by exact primary key (`WHERE key = ? AND time_updated > ?` using `sqlite_autoindex_kv_1`, measured at `0.79 ms` for `22` sessions in [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md#L56-L60)) for the known session IDs in the active session tree. Never issue an unscoped `SELECT ... FROM kv WHERE time_updated > ?` table scan (`30.2 ms`).
- **Acceptance criteria:**
  - Both `plugin:<utf16be-hex>:bindings/<childSessionID>` + `delegate-mode/child/<childSessionID>` rows and scoped `(scope, name, value)` rows merge deterministically into `kv_binding`, `kv_foreign_index`, and `kv_context_prune`.
  - `EXPLAIN QUERY PLAN` on the incremental `kv` watermark probe shows `SEARCH kv USING INDEX sqlite_autoindex_kv_1 (key=?)` with zero `SCAN kv` steps.

#### REQ-SUB-03 multi-stop `DelegationTurn` lineage and `ReportedOutcome` vs `VerifiedOutcome` classifier

- **Ownership and boundary.** [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts) and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. Preserve the existing `delegation` summary table (`PRIMARY KEY (parent_session, call_id)`) for backward compatibility, and add `delegation_turn` with `PRIMARY KEY (parent_session_id, call_id, turn_index)` and secondary index `delegation_turn_child_idx ON delegation_turn(child_session_id)`.
  2. Implement `segmentChildStops(messages)` to partition a child session's `session_message` sequence into chronological `ChildStopSegment`s (`turn_index = 0, 1, ...`). A stop segment closes when:
     - an `idle` boundary message is encountered, OR
     - a new `user` message arrives after at least one `assistant` message has already occurred in the current segment (handling resumed Devin and Antigravity sessions whose first stop lacked an explicit `idle` row, such as `ses_ecb0cedf8ffen0PsHOY8iBYmnO` in [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md#L35-L46)).
  3. Map parent delegation tool calls (`subagent`, `delegate-devin`, `hivemind-delegate`) to child stop segments in chronological order (`turn_index = 0` maps to `mode: "spawn"`, `turn_index >= 1` maps to `mode: "send" | "continue"`). Enrich each row with `foreign_session_id`, `harness`, `agent`, and `model` from `kv_binding` when available, and sink `prompt_blob` and `response_blob` into `.session-archive/blobs/<sha256>.txt`.
  4. Implement `classifyMessagesOutcome(segmentMessages, sessionIdleOutcome)` returning `{ reported_outcome, verified_outcome, blocker_summary, tool_error_count, tool_completed_count, text_char_count }`:
     - `reported_outcome` is `"succeeded" | "failed" | "interrupted" | "running" | null` from the stop's `idle.outcome` or `session_v2.idle_outcome`.
     - `verified_outcome` evaluates in strict priority order:
       1. If `tool_error_count > 0` (any tool part in the stop has `state.status === "error"` or non-empty `state.error`), set `verified_outcome = "tool_error_inside"` and record the first tool error summary in `blocker_summary`.
       2. Else if assistant text or tool output matches deterministic blocker patterns (explicit `BLOCKED:` or `**BLOCKED**`, MCP initialization failure `MCP server .* failed to initialize|timed out`, MCP tool transport failure `The .* MCP tool failed with an error`, or permission/lease denial `Access denied: .* outside allowed directories|read lease violation`), set `verified_outcome = "blocked_in_text"` and record the matched line in `blocker_summary`.
       3. Else if `text_char_count === 0` and `tool_completed_count === 0`, set `verified_outcome = "empty_output"`.
       4. Else if `reported_outcome === "succeeded"`, set `verified_outcome = "clean"` (aliased to `"verified_pass"` in provenance projections when backed by a passing `verification_receipt`, or `"reported_only"` when unverified).
- **Acceptance criteria:**
  - Multi-stop children (`2` to `3` stops on the same `child_session_id`) produce distinct rows in `delegation_turn` with `turn_index = 0, 1, 2` and non-overlapping `start_seq..end_seq` ranges. No `send` or `continue` turn overwrites `turn_index = 0`.
  - Running the classifier against the `11` false-positive `idle.outcome = "succeeded"` Antigravity child sessions in `ses_ecbfc0f40ffenfykTrNGoMS6o1` and `ses_eb23bfbf0ffesn5kT0yJI06h35` (plus the `3` `WF-SUB-R02` fixtures) flags `100%` (`14/14`) as `tool_error_inside` or `blocked_in_text` with non-null `blocker_summary`.

#### REQ-SUB-04 full message normalization and prompt, skill, and shell blob sinking

- **Ownership and boundary.** [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts), [`src/archive/types.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/types.ts), and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. Extend `normalizeMessage(row, sink, prevSeq)` in `src/archive/normalize.ts` so every OpenCode V2 `@opencode/schema` message type is normalized into a typed `MessageRecord`:
     - `user` maps to `UserRecord` (`kind: "user"`). Keep `text: string`, and add `text_ref: string | null` (`text.length > 0 ? sink(text) : null`) so every non-empty human prompt is written to `.session-archive/blobs/<sha256>.txt` regardless of whether `text.length > 4096` (fixing the `normalizeUser` defect identified in [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md#L71)).
     - `assistant` maps to `AssistantRecord` (`kind: "assistant"`). Normalize `text`, `reasoning` (`text_ref`), and `tool` parts (`input` thinned above `4096` chars via `sink`, `output` preview capped at `4096` chars, and `output_ref: sink(outputText)` emitted for all non-empty tool outputs or outputs `> 4096` chars).
     - `skill` maps to `SkillRecord` (`kind: "skill"`). Extract `name` (`data.name ?? data.id`), `description`, and `text` (`data.text ?? data.content`), sink non-empty `text` via `text_ref: sink(text)`, and record `chars: text.length`.
     - `shell` maps to `ShellRecord` (`kind: "shell"`). Extract `command`, `cwd`, `exit_code`, `output` (preview up to `4096` chars), and `output_ref: outputText.length > 0 ? sink(outputText) : null`.
     - `synthetic` and `system` map to `ContextRecord` (`kind: "context"`). Preserve existing `source`, `description`, `paths`, and `text_ref`.
     - `compaction` maps to `CompactionRecord` (`kind: "compaction"`). Preserve `reason`, `status`, `summary`, `recent`, `tokens`, `covers_through_seq`, and add `summary_ref: summary ? sink(summary) : null`.
     - `idle`, `agent-switched`, `model-switched`, and `location-switched` map to `BoundaryRecord` (`kind: "boundary"`).
     - Any other `row.type` maps to `UnknownRecord` (`kind: "unknown"`).
  2. Index all file reads, file touches, and skill loads in `.session-archive/index.sqlite`:
     - `file_read_ledger` (`PRIMARY KEY (session_id, call_id)`). Records `session_id`, `message_id`, `seq`, `call_id`, `path`, `normalized_path`, `line_range`, `chars`, `blob_sha256`, `summary`, `t`.
     - `file_touch` (`PRIMARY KEY (session_id, message_id, call_id, path)`). Records `session_id`, `message_id`, `seq`, `call_id`, `tool` (`write`, `edit`, `patch`), `operation` (`add`, `update`, `write`, `edit`), `path`, `normalized_path`, `blob_sha256`, `t`.
     - `skill_load_ledger` (`PRIMARY KEY (session_id, message_id, skill_name)`). Records `session_id`, `message_id`, `seq`, `skill_name`, `chars`, `blob_sha256`, `summary`, `t` from `user.skills[]`, standalone `skill` messages, `tool` calls with `name === "skill"`, inline `<skill_content name="...">` blocks, and direct `read` calls on `.../skills/<name>/SKILL.md`.
- **Acceptance criteria:**
  - Every non-empty `user.text` in a normalized session produces a corresponding `.session-archive/blobs/<sha256>.txt` file and a `text_ref: "blob:<sha256>"` field on `UserRecord`.
  - Standalone `skill` and `shell` rows in `session_message` normalize to `kind: "skill"` and `kind: "shell"` with `text_ref` and `output_ref` pointing to valid blob files, and populate `skill_load_ledger`, `file_read_ledger`, and `file_touch`.

#### REQ-SUB-05 shadow snapshot Git tree blob sinking and external spill capture

- **Ownership and boundary.** [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts), [`src/archive/index.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index.ts), and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. **Shadow snapshot extraction (`sinkShadowSnapshots`).**
     - Locate the OpenCode shadow bare Git repository for a session at `~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/` (falling back to `~/.local/share/opencode/snapshot/<project_id>/`).
     - For every `assistant` message with `data.snapshot = { start: "<tree_sha>", end: "<tree_sha>", files: [...] }`, collect all `(start_tree_sha:relPath, end_tree_sha:relPath)` object specs across the dirty messages in that shadow repository.
     - Execute a single-pass `git --git-dir=<shadowRepo> cat-file --batch` subprocess per shadow repository. Maintain an in-memory `Map<gitBlobSha, { sha256: string; byteLen: number }>` memoization cache so repeated Git blob OIDs across consecutive steps are hashed and written to `.session-archive/blobs/<sha256>.txt` at most once.
     - Insert a row into `snapshot_artifact` (`PRIMARY KEY (session_id, message_id, path)`) recording `start_tree_sha`, `end_tree_sha`, `start_blob_sha`, `end_blob_sha`, `start_git_blob_sha`, `end_git_blob_sha`, `start_byte_len`, `end_byte_len`, `byte_len`, and `source_origin`. If a file did not exist in `start_tree_sha` (newly created in that step), `start_blob_sha` is `NULL` and `end_blob_sha` holds the new draft's SHA-256.
  2. **External spill sinking (`sinkExternalSpills`).**
     - For every `tool` part and `shell` message, inspect four candidate external spill locations in priority order:
       1. `state.metadata.outputPath` (when present and existing on disk).
       2. Inline shell spill marker matching `/full output saved to (\/[^\s\]]+)/` inside the tool output text.
       3. `~/.local/share/opencode/tool-output/tool_<callID>`.
       4. `~/.local/share/opencode/shell/<callID>.txt`.
     - When an external spill file exists on disk, read its full untruncated bytes, sink them to `.session-archive/blobs/<sha256>.txt`, set the tool part's `output_ref` to the full spill `blob:<sha256>`, and upsert a row into `spill_artifact` (`PRIMARY KEY (session_id, call_id)`) with `spill_kind` (`"tool-output" | "shell"`), `spill_source`, `inline_byte_len`, `full_byte_len`, and `blob_sha`.
- **Acceptance criteria:**
  - Extracting `62` non-empty snapshots (`175` `tree:path` specs, `5.68 MB`) from `ses_eb23bfbf0ffesn5kT0yJI06h35` completes in `< 50 ms` (`43.89 ms` prototype median) via 1-pass `git cat-file --batch` with `gitBlobSha -> sha256` memoization.
  - Both uncommitted `SPEC.md` drafts from `WF-SUB-R02` (`1590b08d` at `23,314` bytes -> `be57c4ad41152deb...` and `5bc43988` at `24,251` bytes -> `041b411d34fc8f8b...`) and truncated external spills (`full_byte_len > inline_byte_len`) are sunk intact into `.session-archive/blobs/<sha256>.txt` and indexed in `snapshot_artifact` and `spill_artifact`.

#### REQ-SUB-06 watermark-gated incremental SQLite sync and WAL concurrency

- **Ownership and boundary.** [`src/archive/index.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index.ts) and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. Configure every writable connection to `.session-archive/index.sqlite` with:
     ```sql
     PRAGMA busy_timeout = 5000;
     PRAGMA journal_mode = WAL;
     PRAGMA synchronous = NORMAL;
     ```
  2. Maintain `sync_watermark`:
     ```sql
     CREATE TABLE IF NOT EXISTS sync_watermark (
       session_id TEXT PRIMARY KEY,
       root_id TEXT NOT NULL,
       last_time_updated INTEGER NOT NULL,
       last_max_seq INTEGER NOT NULL,
       last_message_id TEXT NOT NULL,
       last_kv_updated INTEGER NOT NULL,
       synced_at TEXT NOT NULL
     );
     ```
  3. On `persist()` or `syncSessionTreeIncremental()`:
     - Resolve the root session and flatten the descendant tree using an indexed recursive CTE on `session_v2` (`sqlite_autoindex_session_v2_1` and `session_v2_parent_idx`).
     - Probe `sync_watermark` for all sessions in the tree and probe `kv` by exact primary keys (`plugin:<hivemind_hex>:bindings/<id>`, `plugin:<hivemind_hex>:delegate-mode/child/<id>`, `plugin:<context_prune_hex>:context-prune:<id>`) for `time_updated > watermark.last_kv_updated`.
     - If every session in the tree has `session.time_updated <= watermark.last_time_updated` and no newer `kv` row, return immediately in `< 2 ms` (`0` `session_message` queries, `0` `git` spawns, `0` SQLite writes).
     - For each dirty session (`session.time_updated > watermark.last_time_updated` or missing watermark), fetch only delta messages (`SELECT ... FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq ASC` using `session_message_session_seq_idx`), normalize only the delta messages, append delta JSONL records (or atomically update the session `.jsonl` and `info.json`), extract only delta shadow snapshots and external spills, and upsert all Honeycomb rows and `sync_watermark` inside a single `BEGIN IMMEDIATE` transaction (`db.transaction(fn).immediate()`).
  4. **Idempotence (`principle-make-operations-idempotent`).** All Honeycomb table writes use `INSERT INTO ... ON CONFLICT(...) DO UPDATE SET ...` keyed by natural primary keys (`(session_id, seq)`, `(session_id, call_id)`, `(parent_session_id, call_id, turn_index)`, `(session_id, message_id, path)`). Running `syncSessionTreeIncremental` twice consecutively or recovering after a mid-run crash converges to the exact same row counts and blob files without duplicate rows.
- **Acceptance criteria:**
  - Warm no-op watermark sync across a 22-session tree completes in `< 2.0 ms` (`1.90 ms` prototype median).
  - Incremental 1-turn delta sync (`5` new messages and `1` `kv` update, with `0..5` snapshot blobs) completes in `< 150 ms` (`3.72 ms` median without snapshots, `14.35 ms` median with `5` snapshots).
  - Running `6` concurrent writer and reader lanes (`4` child processes plus `2` in-process connections) executing `136` interleaved `BEGIN IMMEDIATE` writes and `SELECT` reads produces `0` `SQLITE_BUSY` or `SQLITE_BUSY_SNAPSHOT` errors.

#### REQ-SUB-07 hybrid assistant step-watermark `WorkingSetValve`

- **Ownership and boundary.** [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts) and `src/archive/valve.ts`.
- **Behavior:**
  1. **Watermark computation (`computeStepWatermark`).**
     - Accept `messages` and `{ mode: "step-window" | "recent" | "initial", keepRecentSteps?: number }` (default `keepRecentSteps = 8` for explicit tool calls).
     - Find `lastCompactionIndex` (the last message where `type === "compaction"` or `content` contains a `compaction` part) and set `activeStartIndex = lastCompactionIndex >= 0 ? lastCompactionIndex + 1 : 0`.
     - Collect all `assistant` message indices in `[activeStartIndex, messages.length)` (`assistantStepsTotal = assistantIndices.length`) and find `lastUserIndex` in `[activeStartIndex, messages.length)`.
     - Compute `assistantStepsAfterLastUser = assistantIndices.filter(idx => idx > lastUserIndex).length`.
     - Determine `(anchorIndex, anchorReason)`:
       - **`mode === "step-window"`.** If `assistantStepsTotal > keepRecentSteps`, set `anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]` (`anchorReason = "step-window"`), else `(activeStartIndex, "no-op")`.
       - **`mode === "recent"`.** If `lastUserIndex <= activeStartIndex` (only the initial user prompt exists in the active window) AND `assistantStepsAfterLastUser > keepRecentSteps`, automatically fall back to `anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]` (`anchorReason = "recent-step-fallback"`). Otherwise, if `lastUserIndex > activeStartIndex`, set `anchorIndex = lastUserIndex` (`anchorReason = "recent-user-prompt"`), else `(activeStartIndex, "no-op")`.
       - **`mode === "initial"`.** If `lastUserIndex > activeStartIndex`, set `anchorIndex = lastUserIndex` (`anchorReason = "initial-history"`). Else if `assistantStepsTotal > keepRecentSteps`, set `anchorIndex = assistantIndices[assistantStepsTotal - keepRecentSteps]` (`anchorReason = "initial-history"`), else `(activeStartIndex, "no-op")`.
  2. **Hybrid activation (explicit tool plus `65%` automatic watermark per `WF-SUB-08`).**
     - **Explicit.** Calling `substrate.valve({ mode, keepRecentSteps })` (and backward-compatible alias `ctx["context-prune"]` if configured) arms the valve immediately with `keepRecentSteps ?? 8`.
     - **Automatic `65%` watermark.** When estimated active input tokens (`ceil(activeChars / 4)`) exceed `65%` of the active model's context window (default window `200,000` tokens, giving a `130,000`-token threshold when model limit is unspecified) and `assistantStepsTotal > 12`, the valve automatically arms or advances the watermark with `mode: "step-window"` and `keepRecentSteps = 12` using pre-indexed blobs and breadcrumbs.
  3. **Preservation rules:**
     - `KEEP_RESULT = new Set(["subagent", "task", "delegate-devin", "hivemind-delegate"])` keeps delegation tool outputs verbatim.
     - `KEEP_INPUT = new Set(["read", "write", "edit"])` keeps file read, write, and edit call inputs verbatim so paths and edit hunks remain legible.
     - All other tool inputs prior to `anchorIndex` are thinned via `thinInputShapePreserving` (`FIELD_LIMIT = 280`), preserving every object key and scalar while truncating strings `> 280` chars in place without adding any `__thinned` key.
     - Provider-executed parts (`part.providerExecuted === true` or `part.executed === true`) are never modified.
- **Acceptance criteria:**
  - Replaying `ses_eb2eabb14ffeCXsCwb845rtffb` (`session-bcad339b`) at `msg[45]` with `mode: "recent"` or `mode: "step-window"` (`keepRecentSteps = 8`) anchors at `msg[38]` (`msg_14d1f8ddb001n1hz8EkB4rh5yB`), thins `33` assistant steps (`128` tool parts), and frees `619,597` net characters (`154,900` tokens, `-60.2%`), keeping `msg[51]` `154,900` tokens below the `274,175`-token auto-compaction cliff.
  - When estimated active tokens exceed `65%` of the model context window during an unpruned run, automatic watermark activation thins steps older than `keepRecentSteps = 12` while keeping the `12` most recent assistant steps intact.

#### REQ-SUB-08 two-phase `< 2 ms` in-memory `context` hook, `FactBreadcrumb`s, and `WorkingMemoryManifest`

- **Ownership and boundary.** [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts), `src/archive/valve.ts`, and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts).
- **Behavior:**
  1. **Phase 1 (`armValve` off the critical path):**
     - Runs during `substrate.valve` execution, background `session.status` (`idle`) sync, `compaction` sync, or incremental message ingestion.
     - Sinks every tool output and `<skill_content>` body into `.session-archive/blobs/<sha256>.txt` (`blob:<sha12>` 12-hex-char prefix mapped to full 64-hex-char SHA-256 in `prefixIndex` and persisted in `working_valve_state`).
     - Extracts a deterministic 1-line summary per tool output (`exports: ...` or first markdown heading for `read`, command/branch summary for `shell`, match count for `grep`/`glob`, skill description for `skill`).
     - Compares each read file's `blobSha256` against current disk SHA-256 (or subsequent `write`, `edit`, or `patch` touches in the session) to set `status` to `"FRESH — DO NOT REREAD"` or `"STALE"`.
     - Renders each `FactBreadcrumb` string in the canonical format:
       - For `read` and general tools:
         `[Pruned <tool> <target> (<originalChars> chars) -> blob:<sha12> | <1-line summary> | status: <FRESH — DO NOT REREAD | STALE>; call substrate.viewport({ action: "resolve", blob: "<sha12>" }) if exact lines needed]`
       - For `skill` tool results and inline `<skill_content name="<name>">` blocks:
         `[Pruned skill <name> (<originalChars> chars) -> blob:<sha12> | <1-line summary> | status: ACTIVE IN MANIFEST — DO NOT RE-INVOKE; call substrate.viewport({ action: "resolve", blob: "<sha12>" }) if exact lines needed]`
     - Builds and caches `WorkingMemoryManifest` markdown containing:
       - `### Files Already Read (<N>)` with ``path#Lstart-Lend (<chars> chars) -> `blob:<sha12>` | <summary> | **FRESH — DO NOT REREAD | STALE**``
       - `### Files Modified (<N>)` with operation, tool, message ID, and `blob:<sha12>`
       - `### Active Skills Loaded (<N> — DO NOT RE-INVOKE)` with ``@<name> (<chars> chars) -> `blob:<sha12>` | <summary> | **ACTIVE — DO NOT RE-INVOKE**``
       - `### Delegation Outcomes (<N>)` with child session ID, harness/agent, `reportedStatus`, `verifiedStatus`, and `blob:<sha12>`
  2. **Phase 2 (`applyContextHookInMemory` inside `ctx.session.hook("context", ...)`):**
     - Reads only the in-memory `ledgers.get(event.sessionID)` state (`0` SQLite queries, `0` disk reads or writes, `0` SHA-256 computations).
     - Prepends `ledger.manifest.renderedMarkdown` to `event.system` idempotently without duplicating if already present.
     - Iterates `event.messages` from `activeStartIndex` to `boundary` (`anchorIndex`) and replaces completed tool outputs (`part.type === "tool"` and `part.type === "tool-result"` not in `KEEP_RESULT`), non-`KEEP_INPUT` tool inputs (`part.type === "tool"` and `part.type === "tool-call"`), and inline `<skill_content>` blocks with the precomputed strings from `ledger.breadcrumbsByCallId`, `ledger.thinnedInputsByCallId`, and `ledger.skillBreadcrumbsByName`.
     - Completes in `< 2.0 ms` on every invocation.
- **Acceptance criteria:**
  - Replaying `ses_eb23bfbf0ffesn5kT0yJI06h35` (`session-a35adea6`) at `msg[123]` thins `53` tool parts (`311,570 -> 12,177` output chars, `-96.1%`), frees `312,602` net chars (`78,151` tokens), and lists `100%` of the `14` files (`12` unique paths) and `7` skills from the historical `msg[125..130]` panic re-read loop in `WorkingMemoryManifest` with resolvable `blob:<sha12>` handles.
  - Modifying a previously read file on disk (or via a subsequent `write`, `edit`, or `patch` tool call) transitions its `WorkingMemoryManifest` entry and `FactBreadcrumb` from `FRESH — DO NOT REREAD` to `STALE`.
  - Interleaved 7-sample benchmark of `applyContextHookInMemory` on `session-bcad339b` (`87` messages) and `session-a35adea6` (`138` messages) achieves median latency `< 0.1 ms` and maximum latency `< 2.0 ms` (`0.0150 ms` and `0.0337 ms` prototype medians) with `0` SQLite queries and `0` disk I/O calls.

### Data shapes and SQLite DDL (`index.sqlite`)

Phase E1.1 extends `.session-archive/index.sqlite` with the following canonical schema while preserving existing `session`, `delegation`, `message`, `tool_call`, `compaction`, and `instruction` tables so existing callers and tests remain unbroken:

```sql
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS sync_watermark (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  last_time_updated INTEGER NOT NULL,
  last_max_seq INTEGER NOT NULL,
  last_message_id TEXT NOT NULL,
  last_kv_updated INTEGER NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  parent_id TEXT,
  depth INTEGER NOT NULL,
  lane_kind TEXT NOT NULL,
  lane_path TEXT NOT NULL,
  title TEXT,
  agent TEXT,
  provider TEXT,
  model_id TEXT,
  variant TEXT,
  harness TEXT,
  outcome TEXT,
  cost REAL,
  tok_in INTEGER,
  tok_out INTEGER,
  tok_reason INTEGER,
  tok_cache_r INTEGER,
  tok_cache_w INTEGER,
  files_changed INTEGER,
  additions INTEGER,
  deletions INTEGER,
  t_created INTEGER,
  t_updated INTEGER,
  t_idle INTEGER,
  t_compacting INTEGER,
  t_archived INTEGER,
  resume_attempts INTEGER,
  message_count INTEGER,
  transcript_path TEXT
);

CREATE TABLE IF NOT EXISTS delegation (
  call_id TEXT NOT NULL,
  root_id TEXT NOT NULL,
  parent_session TEXT NOT NULL,
  parent_message_id TEXT,
  child_session TEXT,
  tool TEXT,
  agent TEXT,
  harness TEXT,
  mode TEXT,
  background INTEGER,
  description TEXT,
  prompt_ref TEXT,
  status TEXT,
  t_created INTEGER,
  t_completed INTEGER,
  PRIMARY KEY (parent_session, call_id)
);

CREATE TABLE IF NOT EXISTS delegation_turn (
  parent_session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  child_session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  harness TEXT NOT NULL,
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  start_message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL,
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL,
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);

CREATE TABLE IF NOT EXISTS message (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  t INTEGER,
  agent TEXT,
  model_id TEXT,
  tok_in INTEGER,
  tok_out INTEGER,
  text_ref TEXT,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS tool_call (
  call_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER,
  name TEXT,
  status TEXT,
  duration_ms INTEGER,
  truncated INTEGER,
  output_path TEXT,
  output_ref TEXT,
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS compaction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  reason TEXT,
  status TEXT,
  summary_ref TEXT,
  tok_input INTEGER,
  PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS instruction (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  blob_sha TEXT,
  PRIMARY KEY (session_id, seq, path)
);

CREATE TABLE IF NOT EXISTS kv_binding (
  child_session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  driver_kind TEXT,
  harness TEXT,
  foreign_session_id TEXT,
  parent_session_id TEXT,
  call_id TEXT,
  title TEXT,
  cwd TEXT,
  agent TEXT,
  model TEXT,
  effort TEXT,
  mode TEXT,
  background INTEGER,
  requested_model TEXT,
  confirmed_model TEXT,
  confirmed_effort TEXT,
  turn INTEGER,
  phase TEXT,
  foreign_ack_turn INTEGER,
  foreign_ack_stop_reason TEXT,
  serving_witness_model TEXT,
  serving_witness_at TEXT,
  consumed_inputs_json TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  source_origin TEXT NOT NULL DEFAULT 'host_db'
);

CREATE TABLE IF NOT EXISTS kv_foreign_index (
  harness TEXT NOT NULL,
  foreign_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  PRIMARY KEY (harness, foreign_session_id)
);

CREATE TABLE IF NOT EXISTS kv_context_prune (
  session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  mode TEXT,
  anchor_message_id TEXT,
  recorded_at TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS snapshot_artifact (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  start_tree_sha TEXT NOT NULL,
  end_tree_sha TEXT NOT NULL,
  start_blob_sha TEXT,
  end_blob_sha TEXT,
  start_git_blob_sha TEXT,
  end_git_blob_sha TEXT,
  start_byte_len INTEGER,
  end_byte_len INTEGER,
  byte_len INTEGER NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, message_id, path)
);

CREATE TABLE IF NOT EXISTS spill_artifact (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  spill_kind TEXT NOT NULL,
  spill_source TEXT NOT NULL,
  inline_byte_len INTEGER NOT NULL,
  full_byte_len INTEGER NOT NULL,
  blob_sha TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS file_read_ledger (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  line_range TEXT NOT NULL,
  chars INTEGER NOT NULL,
  blob_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL,
  t INTEGER,
  PRIMARY KEY (session_id, call_id)
);

CREATE TABLE IF NOT EXISTS file_touch (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool TEXT NOT NULL,
  operation TEXT NOT NULL,
  path TEXT NOT NULL,
  normalized_path TEXT NOT NULL,
  blob_sha256 TEXT NOT NULL,
  t INTEGER,
  PRIMARY KEY (session_id, message_id, call_id, path)
);

CREATE TABLE IF NOT EXISTS skill_load_ledger (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  seq INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  blob_sha256 TEXT NOT NULL,
  summary TEXT NOT NULL,
  t INTEGER,
  PRIMARY KEY (session_id, message_id, skill_name)
);

CREATE TABLE IF NOT EXISTS working_valve_state (
  session_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  keep_recent_steps INTEGER NOT NULL,
  anchor_message_id TEXT,
  anchor_index INTEGER NOT NULL,
  anchor_reason TEXT NOT NULL,
  manifest_markdown TEXT NOT NULL,
  breadcrumbs_json TEXT NOT NULL,
  thinned_inputs_json TEXT NOT NULL,
  skill_breadcrumbs_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sync_watermark_root_idx ON sync_watermark(root_id);
CREATE INDEX IF NOT EXISTS session_root_idx ON session(root_id);
CREATE INDEX IF NOT EXISTS delegation_turn_child_idx ON delegation_turn(child_session_id);
CREATE INDEX IF NOT EXISTS file_read_ledger_path_idx ON file_read_ledger(normalized_path);
CREATE INDEX IF NOT EXISTS file_touch_path_idx ON file_touch(normalized_path);
```

## Testing decisions

1. **Agreed public test seams (`codebase-design` and `principle-test-behavior-not-implementation`):**
   - `sqliteSource(dbPath)` in [`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts) is tested in [`test/source.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/source.test.ts) against real temporary SQLite files created with [`test/helpers.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/helpers.ts). This catches host schema drift (`project`, `session_v2`, `session_message`, `kv`), read-only enforcement, and UTF-16BE `kv` decoding.
   - `normalizeMessage(row, sink, prevSeq)`, `segmentChildStops(messages)`, and `classifyMessagesOutcome(messages, idleOutcome)` in [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts) are tested in [`test/normalize.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/normalize.test.ts). This catches `user.text` blob sinking, standalone `skill` and `shell` record normalization, multi-stop segmentation, and `reported_outcome` vs `verified_outcome` classification.
   - `persist(input, source)` and `syncSessionTreeIncremental(...)` in [`src/archive/index.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index.ts) and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts) are tested in [`test/persist.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/persist.test.ts) against fixture DBs, shadow Git repos (`git init --bare`, `git hash-object -w`, `git mktree`), external spill directories, and multi-process `Bun.spawn` WAL concurrency workers.
   - `WorkingSetValve` (`computeStepWatermark`, `armValve`, `applyContextHookInMemory`, `resolve`) and plugin lifecycle hooks in [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts) are tested in [`test/plugin.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/test/plugin.test.ts) and replay tests against `session-bcad339b` (`msg[45]`) and `session-a35adea6` (`msg[123]`).
2. **Falsifiable acceptance and benchmark gates (`principle-prove-it-works` and `benchmark-checklist`):**
   - `bun test` and `bun run typecheck` (`tsc --noEmit`) must pass with `0` errors.
   - `bun run build` must bundle `src/plugin.ts` into a self-contained single-file plugin with `external: ["bun:*", "node:*"]`.
   - `ARCHIVE_REAL_DB=1 bun test test/realdb.test.ts` must verify read-only ingestion, `< 2 ms` warm watermark no-op sync, `< 150 ms` 1-turn incremental delta sync, `< 50 ms` shadow snapshot batch extraction, and `< 2 ms` in-memory `context` hook latency against the live `~/.local/share/opencode/opencode.db`.
3. **Human UAT mapping (`verify-work`):**
   - Owner UAT in `.planning/phases/trajectory-working-memory/UAT.md` verifies mid-turn step-watermark pruning (`substrate.valve`), `blob:<sha12>` resolution, multi-stop child outcome inspection, and uncommitted shadow draft recovery in a live OpenCode V2 session.

## Out of scope

- **Codebase structural graph (`Phase E1.2` / `codebase-structural-graph`).** `Bun.Transpiler.scan` Depth-2 closure-factory AST skeletonization (`code_file`, `code_symbol`, `code_edge`), `Float64Array` PageRank `RepoMap` scoring, and `git log` temporal co-change matrix mining (`git_cochange`) belong to Phase E1.2 ([`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md)).
- **Viewport synthesis, FTS5 vibe navigation, and compaction continuity hook (`Phase E1.3` / `viewport-synthesis-compaction`).** The unified 4-tier progressive disclosure `substrate.viewport` query engine (`timeline`, `provenance`, `repomap`, `skeleton`, `slice`, `coupled`), FTS5 BM25 `substrate_fts` intent-pivot ranking, and the SQLite-backed `compaction` continuity hook retiring `.opencode/compaction-history/*.jsonl` belong to Phase E1.3 (except for basic `blob:<sha12>` resolution required by `REQ-SUB-08`).
- **Native foreign harness continuation state.** Resuming a live Devin or Antigravity ACP trajectory remains owned by `hivemind-steward-oc-devin-dev`. `hivemind-substrate` indexes `kv_binding` read-only for lineage and audit visibility.
- **Host database or shadow repo mutations.** Never write to, vacuum, or checkpoint `~/.local/share/opencode/opencode.db` or `~/.local/share/opencode/snapshot/`.

## Further notes

- **Approved owner decisions (`WF-SUB-08` and `.planning/decisions.tsv`):**
  1. Unified 2-tool surface (`substrate.viewport` and `substrate.valve`, with `archive.persist` retained as an explicit persistence alias during transition) plus passive lifecycle hooks (`context`, `compaction`, `session.status`).
  2. Hybrid pruning trigger combining explicit `substrate.valve` (`default keepRecentSteps = 8`) with automatic watermark activation inside `context` when estimated active input tokens exceed `65%` of the model context window (`keepRecentSteps = 12`).
  3. [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md) and [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md) are backed by verified prototypes [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md), [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md), and [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md) and are ready to lock to `accepted` upon independent `spec-review` completion.
- **Principles applied (`ultra-mode`):**
  - `principle-model-the-domain` replaced the regressed `(parent_session_id, child_session_id)` assumption with `delegation_turn` keyed by `(parent_session_id, call_id, turn_index)` and separated `reported_outcome` from `verified_outcome`.
  - `principle-boundary-discipline` enforced `{ readonly: true }` and upfront `pragma_table_info` schema validation at `sqliteSource`, keeping `applyContextHookInMemory` a pure in-memory transformation over pre-validated `ValveExecutionLedger` state.
  - `principle-make-operations-idempotent` designed `syncSessionTreeIncremental` around monotonic `sync_watermark` checkpoints, content-addressed `blobs/<sha256>.txt` atomic renames, and `BEGIN IMMEDIATE` WAL upserts so retries and concurrent worktree runs converge without duplicate rows or `SQLITE_BUSY_SNAPSHOT` errors.
