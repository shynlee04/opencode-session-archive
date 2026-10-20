# Phase E1.3 specification: Viewport synthesis and compaction continuity (`viewport-synthesis-compaction`)

- **Phase:** `E1.3` (`viewport-synthesis-compaction`, ticket prefix `VSC`)
- **Epic:** `E1` Unified Context & Working-Memory Substrate
- **Status:** `draft (ready for spec-review)`
- **Depends on:** Phase `E1.1` (`trajectory-working-memory`, [`SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md)), Phase `E1.2` (`codebase-structural-graph`, [`SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/codebase-structural-graph/SPEC.md))
- **Requirements:** `REQ-SUB-13`, `REQ-SUB-14`, `REQ-SUB-15`, `REQ-SUB-16`, `REQ-SUB-17`, `REQ-SUB-18`
- **Authoritative inputs:** [`GLOSSARY.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/GLOSSARY.md), [`PROJECT.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/PROJECT.md), [`ROADMAP.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/ROADMAP.md), [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md), [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md), [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md), [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md), [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md)

## Problem

Running `opencode-session-archive` ([`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts)), `opencode-context-prune` ([`.opencode/plugins/context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts)), and `compaction-continuity` ([`.opencode/plugins/compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts)) as three disconnected plugins produced four severe operational failures in live OpenCode V2 sessions (`S1` `ses_eb2eabb14ffeCXsCwb845rtffb` and `S2` `ses_eb23bfbf0ffesn5kT0yJI06h35`):

1. **Opaque session IDs force raw shell and Python JSONL scraping.** After archiving and pruning in `S2` (`msg[120..125]`), the agent had only the opaque session identifier `ses_eb23bfbf0ffesn5kT0yJI06h35` and zero read or search tools over `.session-archive/index.sqlite`. To recover its user prompt trajectory, the agent executed `head -c 1600` (`msg[124]`, `5,142` chars) and an inline Python JSONL parser (`msg[125]`, `5,915` chars), dumping `30,331` total tool-output characters (`~3,750` tokens) back into Active Context. Furthermore, `normalizeUser` in `src/archive/normalize.ts` left human prompts inline in JSONL without sinking them into `.session-archive/blobs/<sha256>.txt`.
2. **Brittle `sessionID` validation triggers post-compaction panic rereads.** In `S1` (`msg[51]`, `seq=865`, `274,175` input tokens), the session compacted and the resuming agent called `compaction_continuity({ action: "intents" })` (`msg[58]`) without passing `sessionID`. Because [`.opencode/plugins/compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L649-L690) required an explicit `sessionID` string for `action === "intents"`, it returned `"Specify action and sessionID for compaction_continuity."` and triggered a 46-call panic reread loop across `msg[52..63]` (`16` skills reloaded, `28` files reread, `163,972` chars).
3. **No live disk-SHA staleness reconciliation across reviews, edits, and compactions.** `.opencode/compaction-history/*.jsonl` stored static file lists inside `.opencode/` (where file writes risk triggering OpenCode plugin hot-reload loops) and never compared the SHA-256 of a file at read or child-review time against the current working-tree file SHA-256. Agents could not tell whether a previously read file or a child's `VERIFIED_FRESH` audit finding remained valid (`"FRESH — DO NOT REREAD"`) or had been invalidated by a later edit (`"STALE (modified since read/review — re-verify slice)"` / `"verified_stale_by_later_touch"`).
4. **Cross-harness child delegations start cold without pre-packed structural briefs.** When the Orchestrator spawns `delegate-devin`, `hivemind-delegate`, or `subagent` children for a leased file set, each child spends its first 10 to 20 tool calls rediscovering repository topology, reading full 3,800-line files, and missing hidden co-change couplings (`has_static_edge = 0`).

## Solution

Deliver **Layer 3 (Artifacts & Viewports)** of `hivemind-substrate` (`src/viewports/` and unified `src/plugin.ts`) over `.session-archive/index.sqlite`:

1. **Semantic Session Digest, `IntentPivot` 9-Category Index & FTS5 Vibe Navigation (`REQ-SUB-13`).** Materialize `session_semantic_digest`, `intent_pivot` (sinking human prompts to `.session-archive/blobs/<sha256>.txt`), and `substrate_fts` with compound letter-digit boundary expansion (`wave2-slice1` -> `wave 2 slice 1`). Score roots by distinct matched query token coverage plus weighted single-row BM25 match to return a `< 600`-token `StrategistViewport` digest in `< 5 ms` (`0.49..1.12 ms` measured).
2. **`ProvenanceChain` Causal Graph & Live Staleness Reconciler (`REQ-SUB-14`).** Track `Finding -> Decision -> ProposedRepair -> FileTouch/Commit -> VerificationReceipt` in `provenance_chain` alongside `file_read_ledger` and `skill_load_ledger`. On `reconcileProvenanceStaleness`, compare recorded `repair_blob_sha` and `read_blob_sha` against current working-tree SHA-256 in `< 2 ms` (`0.17 ms` median measured), transitioning mutated files to `"STALE (modified since read/review — re-verify slice)"` and `"verified_stale_by_later_touch"`.
3. **SQLite-Backed `compaction` Continuity Hook (`REQ-SUB-15`).** Replace `.opencode/compaction-history/*.jsonl` with `compaction_continuation_ledger` in `.session-archive/index.sqlite`. During `ctx.session.hook("compaction", ...)`, synthesize a deterministic `< 1,200`-token `CompactionContinuationPacket` (`747..1,038` tokens in `0.35 ms` measured) combining `Headline & Gate`, `Intent Pivot Timeline`, `Working-Memory Manifest`, `Delegation Trajectory`, `Provenance Chain`, and `Tier-1 RepoMap & Co-Change Alerts`, while keeping normal `context` turns free of cross-session prompt injection.
4. **Deterministic Default `sessionID` Resolution (`REQ-SUB-16`).** Resolve omitted `sessionID` across all tool and hook calls via `resolveDefaultSessionId(db, input.sessionID, hookContext)` (`explicit_input` -> `hook_context` -> `sqlite_latest_root`), eliminating `"Specify action and sessionID"` errors.
5. **Unified Two-Tool Plugin Surface & Compatibility Aliases (`REQ-SUB-17`).** Register `substrate.valve` and `substrate.viewport` plus backwards-compatible aliases `archive.persist`, `ctx.context-prune`, `substrate`, and `viewport`, backed by passive `context`, `compaction`, `session.status` (`idle`), and `session.compacted` hooks in a single-file bundle (`dist/session-archive.ts`).
6. **Exported Cross-Harness Child Delegation Brief Helper (`REQ-SUB-18`).** Export `buildImplementorViewportBrief(db, options)` to pack Tier-1 `RepoMap`, Tier-2 `AstSkeleton`, Tier-3 `SymbolSlice`, Tier-4 `CoChangeCoupling` (`has_static_edge = 0`), and active `ProvenanceChain` constraints within a bounded token budget (default `1,500` tokens).

## User stories

1. **As a Vibe Coder or Strategist agent resuming work by natural-language topic**, I can call `substrate.viewport({ action: "search", query: "look at my prompting throughout and continue from Wave 2 slice" })` without knowing any `ses_...` ID so that I receive a `< 600`-token `StrategistViewport` digest (`483` tokens in `1.12 ms` measured) containing the matched root session, chronological `IntentPivot` list with `blob:<sha256>` handles, child delegations, and verification gate status.
2. **As a Strategist agent auditing delegated repair chains before shipping**, I can call `substrate.viewport({ action: "provenance" })` so that `reconcileProvenanceStaleness` compares each chain's `repair_blob_sha` and each read file's `read_blob_sha` against current workspace files in `< 2 ms`, immediately flagging any file modified after verification as `"STALE (modified since read/review — re-verify slice)"` and `"verified_stale_by_later_touch"`.
3. **As an OpenCode V2 session undergoing context compaction**, I receive a `< 1,200`-token `CompactionContinuationPacket` (`1,038` tokens on `S1`, `818` tokens on `S2`) injected into `compaction.system` and persisted in `compaction_continuation_ledger` that lists all `16` active skills (`"ACTIVE — DO NOT RE-INVOKE"`) and all `28` read files (`"FRESH — DO NOT REREAD"` vs `"STALE"`), preventing post-compaction panic rereads.
4. **As an agent invoking any continuity or viewport action immediately after compaction**, I can call `substrate.viewport({ action: "timeline" })` or `substrate({ action: "status" })` with no `sessionID` argument and have `resolveDefaultSessionId` deterministically bind to the active session or latest root session in `.session-archive/index.sqlite`.
5. **As an existing prompt, skill, or agent habit calling legacy tool names**, I can invoke `archive.persist({})` or `ctx.context-prune({ mode: "recent" })` and have the unified `hivemind-substrate` plugin route those calls seamlessly to the underlying Spine sync and `WorkingSetValve` engines.
6. **As an Orchestrator agent spawning a `delegate-devin`, `hivemind-delegate`, or `subagent` worker**, I can call `buildImplementorViewportBrief(db, { targetPaths: ["src/delegation/native-delegation.ts"], symbolNames: ["createNativeDelegationDriver.turnStream"], maxTokens: 1500 })` (or `substrate.viewport({ action: "brief", ... })`) to generate a deterministic, token-bounded Markdown brief containing the Tier-1 `RepoMap`, Tier-2 `AstSkeleton`, Tier-3 `SymbolSlice`, Tier-4 hidden `CoChangeCoupling` warnings, and active `ProvenanceChain` constraints.

## Requirements

### `REQ-SUB-13` · Semantic Session Digest, `IntentPivot` Categorization & FTS5 Vibe Navigation

- **Behavior and invariants:**
  1. `normalizeUser` in `src/archive/normalize.ts` MUST sink every non-empty human user prompt body into `.session-archive/blobs/<sha256>.txt` via `BlobSink` and record `blob:<sha256>` so every `intent_pivot.blob_ref` resolves both in SQLite and on disk.
  2. `.session-archive/index.sqlite` MUST define and maintain the semantic digest, intent pivot, and FTS5 tables:
     ```sql
     CREATE TABLE IF NOT EXISTS session_semantic_digest (
       session_id TEXT PRIMARY KEY,
       root_id TEXT NOT NULL,
       headline TEXT NOT NULL,
       intent_pivots_json TEXT NOT NULL,
       touched_files_json TEXT NOT NULL,
       key_decisions_json TEXT NOT NULL,
       verification_state TEXT NOT NULL
     );

     CREATE INDEX IF NOT EXISTS idx_semantic_digest_root ON session_semantic_digest(root_id);

     CREATE TABLE IF NOT EXISTS intent_pivot (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       session_id TEXT NOT NULL,
       message_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       t TEXT NOT NULL,
       prompt_excerpt TEXT NOT NULL,
       blob_ref TEXT NOT NULL,
       pivot_kind TEXT NOT NULL
     );

     CREATE INDEX IF NOT EXISTS idx_intent_pivot_session_seq ON intent_pivot(session_id, seq);
     CREATE INDEX IF NOT EXISTS idx_intent_pivot_blob_ref ON intent_pivot(blob_ref);

     CREATE VIRTUAL TABLE IF NOT EXISTS substrate_fts USING fts5(
       session_id,
       kind,
       symbol_or_path,
       body
     );
     ```
  3. Synthetic host-injected user messages (matching prefixes `<subagent `, `<shell `, `<conversation-checkpoint>`, `"The available project references have changed."`, `"The server restarted while you were working."`, `"The Code Mode tool catalog has changed."`, `"The previous response was interrupted."`) MUST be excluded from `intent_pivot`.
  4. Human user prompts MUST be deterministically classified into one of the 9 `IntentPivot` categories (`PivotKind`):
     - `initial_goal` (first human prompt in a root session or explicit initial objective),
     - `course_correction` (negations, bug/failure reports, or redirect directives),
     - `approval` (affirmative gate approvals or harness delegation authorizations),
     - `handoff_resume` (resuming from a prior session, reload, or handoff document),
     - `prune_or_continuity` (explicit requests to persist archive, prune context, or inspect continuity),
     - `verification_directive` (directives to verify, audit, benchmark, or prove an outcome),
     - `scope_narrowing` (directives restricting focus or write scope to specific seams/slices),
     - `continuation_after_compaction` (first human continuation turn following a compaction checkpoint),
     - `followup` (all other substantive human follow-up turns).
  5. Both FTS5 document indexing (`substrate_fts`) and query tokenization (`expandCompoundTokens`) MUST expand letter-digit and hyphenated compound tokens (`wave2-slice1` -> `wave2 slice1 wave 2 slice 1`, `44-step` -> `44 step`, `mh28` -> `mh 28`) so natural-language queries match worktree names, phase slugs, and ticket IDs.
  6. `queryVibeNavigation(db, queryText, options)` MUST aggregate FTS5 hits to their root session (`session.root_id`) and score candidate root sessions by:
     - Distinct matched query token coverage (`matchedTokens.size * 100`), plus
     - Weighted single-row match score (`intent_pivot` and `decision` rows weighted `>= 3x` above `child` rows), plus
     - Direct phrase match bonus on `headline` and `intent_pivots_json`,
     preventing roots with many child sessions from drowning out specific user intent pivots.
  7. `queryVibeNavigation` MUST return a `VibeNavigationResult` whose rendered Markdown `StrategistViewport` digest is strictly `< 600` tokens (`Math.ceil(chars / 4)`) and includes the root headline, verification gate status, up to `maxPivots` (default `9`) chronological `IntentPivot` entries with `blob:<sha256>` handles, child delegations, and touched files.
- **Performance and budget gates (verified in [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md)):**
  - Query latency MUST be `< 5 ms` (`0.493 ms`, `0.809 ms`, and `1.118 ms` 7-sample medians measured across the 3 benchmark queries).
  - Rendered digest size MUST be `< 600` tokens (`394..483` tokens measured, achieving `87.1%..89.5%` token reduction vs the `3,750`-token legacy shell scrape).
- **Ownership and interfaces:** Owned by `src/viewports/semantic-digest.ts` and `src/archive/normalize.ts`.
- **Approved decisions and dependencies:** Depends on Phase E1.1 Spine tables. Implements [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md) and [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q1.

### `REQ-SUB-14` · `ProvenanceChain` Causal Graph & Live Staleness Reconciler

- **Behavior and invariants:**
  1. `.session-archive/index.sqlite` MUST define and maintain the causal provenance and working-memory ledger tables:
     ```sql
     CREATE TABLE IF NOT EXISTS provenance_chain (
       chain_id TEXT PRIMARY KEY,
       root_session_id TEXT NOT NULL,
       finding_id TEXT NOT NULL,
       finding_seq INTEGER NOT NULL,
       finding_session_id TEXT NOT NULL,
       finding_summary TEXT NOT NULL,
       decision_seq INTEGER,
       target_path TEXT NOT NULL,
       repair_seq INTEGER,
       repair_session_id TEXT,
       repair_blob_sha TEXT,
       receipt_command TEXT,
       receipt_exit_code INTEGER,
       receipt_blob_sha TEXT,
       head_sha TEXT,
       worktree_tree_sha TEXT,
       staleness_status TEXT NOT NULL,
       updated_at TEXT NOT NULL
     );

     CREATE INDEX IF NOT EXISTS idx_provenance_root ON provenance_chain(root_session_id);
     CREATE INDEX IF NOT EXISTS idx_provenance_target ON provenance_chain(target_path);

     CREATE TABLE IF NOT EXISTS file_read_ledger (
       session_id TEXT NOT NULL,
       path TEXT NOT NULL,
       line_range TEXT NOT NULL,
       read_blob_sha TEXT NOT NULL,
       read_seq INTEGER NOT NULL,
       disk_blob_sha TEXT NOT NULL,
       staleness_status TEXT NOT NULL,
       PRIMARY KEY (session_id, path)
     );

     CREATE TABLE IF NOT EXISTS skill_load_ledger (
       session_id TEXT NOT NULL,
       skill_name TEXT NOT NULL,
       blob_sha TEXT NOT NULL,
       blob_ref TEXT NOT NULL,
       load_seq INTEGER NOT NULL,
       status TEXT NOT NULL,
       PRIMARY KEY (session_id, skill_name)
     );
     ```
  2. `reconcileProvenanceStaleness(db, sessionId, options)` MUST compute or accept the current working-tree SHA-256 (`disk_blob_sha`) for every file referenced in `file_read_ledger` and `provenance_chain` for `root_session_id = sessionId`.
  3. In `file_read_ledger`:
     - When `disk_blob_sha === read_blob_sha`, `staleness_status` MUST be `"FRESH — DO NOT REREAD"`.
     - When `disk_blob_sha !== read_blob_sha` (or the file was modified after `read_seq` without a subsequent read of the new SHA), `staleness_status` MUST transition to `"STALE (modified since read/review — re-verify slice)"`.
  4. In `provenance_chain`:
     - When `repair_blob_sha` (or baseline reviewed SHA) matches `disk_blob_sha` and `receipt_exit_code === 0`, `staleness_status` MUST be `"VERIFIED_FRESH"`.
     - When `disk_blob_sha` diverges from `repair_blob_sha`, `staleness_status` MUST transition to `"verified_stale_by_later_touch"`, and `session_semantic_digest.verification_state` for `root_session_id` MUST update to `"verified_stale_by_later_touch"`.
     - If the file's content returns to `repair_blob_sha` (or a new verification receipt records the updated `repair_blob_sha` with `receipt_exit_code === 0`), re-running `reconcileProvenanceStaleness` MUST deterministically restore `"VERIFIED_FRESH"` and `"FRESH — DO NOT REREAD"`.
  5. In `skill_load_ledger`, every skill loaded during the session MUST be recorded with `status = "ACTIVE — DO NOT RE-INVOKE"` and its 6-character `blob_sha` prefix so the agent does not reload the same `SKILL.md` across compactions.
- **Performance gate (verified in [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md)):**
  - `reconcileProvenanceStaleness` MUST complete in `< 2 ms` per session (`0.1704 ms` 7-sample aggregate median, `0.1026..0.3249 ms` min-max range across all 7 compactions).
- **Ownership and interfaces:** Owned by `src/viewports/provenance-reconciler.ts`.
- **Approved decisions and dependencies:** Depends on Phase E1.1 Spine tables and `REQ-SUB-13`. Implements [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md).

### `REQ-SUB-15` · SQLite-Backed `compaction` Continuity Hook & Retirement of `.opencode/compaction-history/*.jsonl`

- **Behavior and invariants:**
  1. `.session-archive/index.sqlite` MUST define `compaction_continuation_ledger`:
     ```sql
     CREATE TABLE IF NOT EXISTS compaction_continuation_ledger (
       session_id TEXT NOT NULL,
       compaction_seq INTEGER NOT NULL,
       compaction_reason TEXT NOT NULL,
       tok_input INTEGER NOT NULL,
       headline TEXT NOT NULL,
       verification_gate_status TEXT NOT NULL,
       packet_markdown TEXT NOT NULL,
       packet_tokens INTEGER NOT NULL,
       summary_hash TEXT,
       created_at TEXT NOT NULL,
       PRIMARY KEY (session_id, compaction_seq)
     );
     ```
  2. When `ctx.session.hook("compaction", ...)` fires for `compaction.sessionID`:
     - The hook MUST run incremental Spine/Honeycomb sync and `reconcileProvenanceStaleness(db, rootSessionId)`.
     - The hook MUST synthesize a `CompactionContinuationPacket` via `buildCompactionContinuationPacket(db, rootSessionId, options)` and persist it into `compaction_continuation_ledger`.
     - The hook MUST append the compaction system prompt and the synthesized `packet.markdown` to `compaction.system`.
  3. Every synthesized `CompactionContinuationPacket` MUST be strictly `< 1,200` tokens (`Math.ceil(chars / 4)`) and contain the following 5 deterministic sections:
     - Header with `session_id`, `seq`, `reason`, `tok_in`, `Headline`, and `Gate` (`verification_state`),
     - `### 1. Intent Pivot Timeline` (chronological human pivots with `[pivot_kind]` and `blob:<sha256>` handles),
     - `### 2. Working-Memory Manifest` (`Skills (ACTIVE — DO NOT RE-INVOKE)`, `FRESH — DO NOT REREAD` files with 6-char SHA prefixes, and `STALE (modified since read/review — re-verify slice)` files with read vs disk SHA comparison),
     - `### 3. Delegation Trajectory` (flagged `delegation_turn` rows where `verified_status !== "clean"`, such as `reported=succeeded -> verified=tool_error_inside` or `blocked_in_text`),
     - `### 4. Provenance Chain` (`finding_id -> target_path` with `repair_blob_sha` vs `disk_blob_sha` and `VERIFIED_FRESH` vs `verified_stale_by_later_touch` status),
     - `### 5. Tier-1 RepoMap & Co-Change Alerts` (top PageRank modules with primary symbol spans plus top hidden co-change pairs where `has_static_edge = 0`).
  4. When `session.compaction.ended` (or `session.compacted`) fires on `ctx.event.subscribe`, the plugin MUST compute the SHA-256 `summary_hash` of the generated summary text and update `compaction_continuation_ledger.summary_hash` in `.session-archive/index.sqlite`.
  5. `ctx.session.hook("context", ...)` MUST NOT inject cross-session compaction history (`buildRetrievalContext` over other sessions) into `context.system` on normal turns. Cross-session discovery happens on demand via `substrate.viewport`.
  6. The plugin MUST NEVER create or write `.opencode/compaction-history/*.jsonl` or `.opencode/compaction-history/*.latest.md`. Legacy `.opencode/plugins/compaction-continuity.ts` is retired by this unified hook.
- **Performance and budget gates (verified in [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md)):**
  - All 7 historical compaction events in `.session-archive/index.sqlite` MUST produce packets strictly `< 1,200` tokens (`747..1,038` tokens range, `818` tokens median measured; `100%` of `S1`'s `16` skills and `28` panic-reread files and `100%` of `S2`'s `10` skills and `14` reread files retained in the manifest).
  - `buildCompactionContinuationPacket` MUST complete in `< 2 ms` (`0.3472 ms` 7-sample aggregate median, `0.2596..1.6180 ms` range measured).
- **Ownership and interfaces:** Owned by `src/viewports/compaction-continuity.ts` and wired in `src/plugin.ts`.
- **Approved decisions and dependencies:** Depends on `REQ-SUB-11`, `REQ-SUB-12`, `REQ-SUB-13`, `REQ-SUB-14`, and `REQ-SUB-16`. Implements [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md) and [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q1.

### `REQ-SUB-16` · Deterministic Default `sessionID` Resolution Across All Tool & Hook Calls

- **Behavior and invariants:**
  1. `resolveDefaultSessionId(db, explicitSessionId, hookContext)` MUST resolve the target session ID using the following strict priority order:
     - **Priority 1 (`source: "explicit_input"`):** Non-empty trimmed `explicitSessionId` passed in the tool input. If the ID belongs to a child session (`depth > 0`), root-scoped queries (`timeline`, `provenance`, `status`, `latest`) resolve its `root_id` from `session` while preserving `resolvedChildSessionID` when inspecting a specific child.
     - **Priority 2 (`source: "hook_context"`):** Non-empty trimmed `hookContext?.sessionID` supplied by the OpenCode tool execution context (`context.sessionID`) or lifecycle hook event (`event.sessionID`).
     - **Priority 3 (`source: "sqlite_latest_root"`):** Latest root session in `.session-archive/index.sqlite` via `SELECT id FROM session WHERE depth = 0 ORDER BY COALESCE(t_updated, t_created, 0) DESC, id DESC LIMIT 1` (falling back to `SELECT session_id FROM session_semantic_digest LIMIT 1` if `session` is empty).
  2. Omitting `action` on continuity/viewport queries MUST default deterministically to `"status"` (or `"latest"` on compatibility continuity calls).
  3. Calling any tool action (`status`, `intents`, `timeline`, `provenance`, `latest`, `overview`, `resolve`, `sync`) with `{}` or `{ action: "intents" }` (without `sessionID`) MUST succeed and NEVER return `"Specify action and sessionID"`.
- **Ownership and interfaces:** Owned by `src/viewports/session-resolver.ts` and shared by `substrate.valve`, `substrate.viewport`, and compatibility aliases.
- **Approved decisions and dependencies:** Validated in [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md) (`S1 msg[58]` regression test) and approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q1.

### `REQ-SUB-17` · Unified Two-Tool Plugin Surface (`substrate.valve` + `substrate.viewport`) with Backwards-Compatible Aliases

- **Behavior and invariants:**
  1. `src/plugin.ts` MUST register the unified OpenCode V2 plugin (`id: "hivemind-substrate"`, bundled to `dist/session-archive.ts` for drop-in replacement) exposing two primary tools under namespace `substrate`:
     - **`substrate.valve`:** Working-set valve control with `action` (`"prune" | "status" | "reset"`, default `"prune"`), `mode` (`"step-window" | "recent" | "all"`, default `"step-window"`), `keepRecentSteps` (default `8`), and optional `sessionID`.
     - **`substrate.viewport`:** Progressive disclosure query and sync surface with `action`:
       - Strategist & Continuity actions: `"status" | "resolve" | "timeline" | "intents" | "provenance" | "sync" | "search"`
       - Implementor CodeGraph actions: `"repomap" | "skeleton" | "slice" | "coupled" | "brief"`
       - Parameters: optional `sessionID`, `query`, `blobRef`, `path`, `symbol`, `startLine`, `endLine`, `maxTokens`, `minProbability`, `onlyHidden`, `targetPaths`, `symbolNames`.
  2. For backwards compatibility with existing prompts, skills, and agent muscle memory ([`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q1), `src/plugin.ts` MUST also register thin delegating aliases:
     - `archive.persist` -> routes to incremental Spine + Honeycomb `persist()` / `sync` for `resolveDefaultSessionId`.
     - `ctx.context-prune` -> routes to `substrate.valve` (translating `mode: "recent"` on single-prompt autonomous runs where `lastUserIndex <= activeStartIndex` and `assistantStepsAfterLastUser > 8` into `mode: "step-window", keepRecentSteps: 8`).
  3. `src/plugin.ts` MUST register three lifecycle hooks/subscriptions:
     - `ctx.session.hook("context", ...)`: Strictly in-memory (`< 2 ms`) `WorkingSetValve` execution (`REQ-SUB-05..08`), applying explicit watermarks or automatic `65%` token-window watermarks (`keepRecentSteps = 12`) with `FactBreadcrumb` handles (`blob:<sha256>`) and the `WorkingMemoryManifest`.
     - `ctx.session.hook("compaction", ...)`: Incremental sync, provenance staleness reconciliation, and `< 1,200`-token `CompactionContinuationPacket` injection (`REQ-SUB-15`).
     - `ctx.event.subscribe(...)`: Off-critical-path background handler for `session.status` (when `status === "idle"`, running incremental Spine + CodeGraph + `HEAD~1..HEAD` co-change sync) and `session.compaction.ended` / `session.compacted` (recording `summary_hash`).
  4. `bun run build` (`scripts/build.ts`) MUST compile `src/plugin.ts` into a single self-contained file `dist/session-archive.ts` (`external: ["bun:*", "node:*"]`) with zero external runtime dependencies.
- **Ownership and interfaces:** Owned by `src/plugin.ts` and `src/viewports/router.ts`.
- **Approved decisions and dependencies:** Depends on Phase E1.1 (`REQ-SUB-01..08`), Phase E1.2 (`REQ-SUB-09..12`), and `REQ-SUB-13..16`. Approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q1, Q2, and Q3.

### `REQ-SUB-18` · Exported Cross-Harness Child Delegation Brief Helper (`buildImplementorViewportBrief`)

- **Behavior and invariants:**
  1. `src/viewports/implementor-brief.ts` (and re-exported from `src/plugin.ts` / `src/index.ts`) MUST export the pure deterministic function:
     ```ts
     export interface ImplementorViewportBriefOptions {
       readonly targetPaths: readonly string[]
       readonly symbolNames?: readonly string[]
       readonly sessionID?: string
       readonly rootDir?: string
       readonly maxTokens?: number
       readonly minCouplingProbability?: number
     }

     export interface ImplementorViewportBriefResult {
       readonly markdown: string
       readonly estimatedTokens: number
       readonly maxTokens: number
       readonly includedTargetPaths: readonly string[]
       readonly includedSlices: readonly string[]
       readonly hiddenCouplingWarnings: readonly string[]
       readonly provenanceConstraints: readonly string[]
     }

     export function buildImplementorViewportBrief(
       db: Database,
       options: ImplementorViewportBriefOptions,
     ): ImplementorViewportBriefResult
     ```
  2. `buildImplementorViewportBrief` MUST assemble a structured Markdown brief for child delegation spawns (`delegate-devin`, `hivemind-delegate`, `subagent`) in priority order within `maxTokens` (default `1,500` tokens, estimated as `Math.ceil(chars / 4)`):
     - **Section 1 · Active Provenance & Session Constraints (`<= 200` tokens):** Any `provenance_chain` rows or `intent_pivot` scope constraints touching `targetPaths` (including `VERIFIED_FRESH` vs `verified_stale_by_later_touch` status and `blob:<sha256>` handles).
     - **Section 2 · Hidden Temporal Co-Change Warnings (`<= 200` tokens):** All coupled files for `targetPaths` where `has_static_edge = 0` and $P(\text{coupled} \mid \text{target}) \ge \text{minCouplingProbability}$ (default `0.30`), alerting the child delegate to cross-boundary invariants before it edits.
     - **Section 3 · Targeted `SymbolSlice` Spans (`<= 600` tokens):** Exact `[Lstart-Lend]` source slices for requested `symbolNames` (`readSymbolSlice`).
     - **Section 4 · Leased File `AstSkeleton` Outlines (`<= 350` tokens):** Compact Depth-2 AST skeletons (`code_file.skeleton_text` / exported + Depth-2 symbol signatures with `[Lstart-Lend]` spans) for `targetPaths`.
     - **Section 5 · Tier-1 `RepoMap` Topological Context (`remaining budget, <= 250` tokens):** Top PageRank hub modules connected to `targetPaths` via `code_import_edge`.
  3. If the combined sections exceed `maxTokens`, `buildImplementorViewportBrief` MUST deterministically truncate lower-priority tail entries (Tier-1 `RepoMap` tail first, then `AstSkeleton` non-exported symbols) so `estimatedTokens <= maxTokens` always holds.
  4. `substrate.viewport({ action: "brief", targetPaths, symbolNames, sessionID, maxTokens })` MUST invoke `buildImplementorViewportBrief` and return its Markdown output and metadata.
- **Performance gate:**
  - `buildImplementorViewportBrief` over a warm SQLite database MUST execute in `< 5 ms` with zero subprocess spawns.
- **Ownership and interfaces:** Owned by `src/viewports/implementor-brief.ts` and re-exported from `src/plugin.ts`.
- **Approved decisions and dependencies:** Depends on `REQ-SUB-09..12` and `REQ-SUB-14`. Approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q3.

### Requirement summary matrix

| Requirement | Primary Module Seam | SQLite Tables Owned / Queried | Measured Prototype Baseline | Target Gate |
|---|---|---|---|---|
| `REQ-SUB-13` | `src/viewports/semantic-digest.ts`, `src/archive/normalize.ts` | `session_semantic_digest`, `intent_pivot`, `substrate_fts` | `0.49..1.12 ms` query, `394..483` tokens (`-87.1%` vs `S2` shell scrape) | `< 5 ms` query, `< 600`-token `StrategistViewport` digest |
| `REQ-SUB-14` | `src/viewports/provenance-reconciler.ts` | `provenance_chain`, `file_read_ledger`, `skill_load_ledger` | `0.170 ms` staleness reconciliation across 7 compactions | `< 2 ms` disk-SHA staleness reconciliation |
| `REQ-SUB-15` | `src/viewports/compaction-continuity.ts` | `compaction_continuation_ledger` | `747..1,038` tokens (`818` median) in `0.347 ms` across 7 compactions | `< 1,200` tokens, `< 2 ms` synthesis, `.opencode/compaction-history/` retired |
| `REQ-SUB-16` | `src/viewports/session-resolver.ts` | `session`, `session_semantic_digest` | `100%` resolution across explicit, hook, and SQLite fallback (`S1 msg[58]` fixed) | Deterministic 3-tier resolution, zero `"Specify action and sessionID"` errors |
| `REQ-SUB-17` | `src/plugin.ts`, `src/viewports/router.ts` | All Honeycomb tables | Single-file `dist/session-archive.ts` bundle (`+9.7 KB` net logic) | `substrate.valve` + `substrate.viewport` + legacy aliases, `< 2 ms` `context` hook |
| `REQ-SUB-18` | `src/viewports/implementor-brief.ts` | `code_file`, `code_symbol`, `code_import_edge`, `git_cochange`, `provenance_chain` | Deterministic 5-section brief assembly over warm SQLite | `<= maxTokens` (default `1,500`), `< 5 ms` execution |

## Testing decisions

1. **External behavioral seams (`principle-test-behavior-not-implementation`):**
   - Test through the public viewport functions (`queryVibeNavigation`, `resolvePromptBlob`, `reconcileProvenanceStaleness`, `buildCompactionContinuationPacket`, `resolveDefaultSessionId`, `buildImplementorViewportBrief`) and the OpenCode V2 plugin harness (`plugin.setup(ctx)` exercising `substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune`, `ctx.session.hook("context")`, and `ctx.session.hook("compaction")`).
2. **Prior art and prototype test suites to promote into `test/`:**
   - [`scratch/prototypes/wf-sub-01-semantic-digest.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-01-semantic-digest.test.ts) (`5` tests, `75` assertions) -> promote to `test/semantic-digest.test.ts`.
   - [`scratch/prototypes/wf-sub-07-compaction-reconciler.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.test.ts) (`6` tests, `130+` assertions) -> promote to `test/compaction-continuity.test.ts`.
   - Add `test/plugin-surface-and-brief.test.ts` covering `REQ-SUB-17` tool registration/aliases and `REQ-SUB-18` `buildImplementorViewportBrief` token-budget bounding.
3. **Falsifiable assertions per requirement:**
   - **`REQ-SUB-13`:** Assert that `normalizeUser` writes `.session-archive/blobs/<sha256>.txt` for user prompts and `resolvePromptBlob(db, blobRef)` returns the exact full prompt text; assert synthetic `<subagent ` and `<shell ` user messages never appear in `intent_pivot`; assert compound queries (`"Wave 2 slice"`, `"44-step auto-run context-prune 0 bytes"`) resolve `ses_eb23bfbf0ffesn5kT0yJI06h35` and `ses_eb2eabb14ffeCXsCwb845rtffb` in `< 5 ms` with `< 600` tokens.
   - **`REQ-SUB-14`:** Assert that mutating a file's SHA-256 transitions `file_read_ledger.staleness_status` from `"FRESH — DO NOT REREAD"` to `"STALE (modified since read/review — re-verify slice)"` and `provenance_chain.staleness_status` from `"VERIFIED_FRESH"` to `"verified_stale_by_later_touch"`, and restoring the original SHA deterministically restores `"VERIFIED_FRESH"`.
   - **`REQ-SUB-15`:** Assert that all 7 compaction events generate `CompactionContinuationPacket` outputs with `tokenCount < 1200` containing all 5 sections (`Intent Pivot Timeline`, `Working-Memory Manifest`, `Delegation Trajectory`, `Provenance Chain`, `Tier-1 RepoMap & Co-Change Alerts`); assert zero files are written under `.opencode/compaction-history/`; assert `ctx.session.hook("context")` does not append cross-session compaction summaries on normal turns.
   - **`REQ-SUB-16`:** Reproduce the exact `S1 msg[58]` call (`{ action: "intents" }` with no `sessionID`) with and without `hookContext.sessionID` and assert it resolves deterministically and returns the session's `IntentPivot` list.
   - **`REQ-SUB-17`:** Assert that `plugin.setup(ctx)` registers `substrate.valve`, `substrate.viewport`, `archive.persist`, and `ctx.context-prune`; assert `bun run build` outputs a single `dist/session-archive.ts` file.
   - **`REQ-SUB-18`:** Assert that `buildImplementorViewportBrief` includes Tier-1 `RepoMap`, Tier-2 `AstSkeleton`, Tier-3 `SymbolSlice` (`createNativeDelegationDriver.turnStream`), Tier-4 hidden `CoChangeCoupling` (`src/devin-executable.ts <-> src/harness-antigravity.ts`), and `ProvenanceChain` status while strictly satisfying `estimatedTokens <= maxTokens`.
4. **Phase closure and UAT gates (`verify-work`):**
   - `bun test` + `bun run typecheck` + `bun run build`.
   - Dogfooding in live OpenCode V2 sessions + owner `UAT.md` verification.

## Out of scope

- **Replacing foreign harness continuation bindings (`devin-native`, `antigravity-native`):** `hivemind-substrate` indexes `kv` foreign session bindings read-only into `.session-archive/index.sqlite` so the Strategist can audit child trajectories and pack `buildImplementorViewportBrief` context when switching harnesses, but resuming a live foreign ACP session remains owned by `hivemind-steward-oc-devin-dev`.
- **LLM calls or dense vector embeddings during `compaction` or `viewport` queries:** All digest synthesis, FTS5 ranking, staleness reconciliation, and brief assembly are 100% deterministic SQLite and in-memory operations.
- **Writing any runtime state under `.opencode/`:** All SQLite tables, JSONL transcripts, and content-addressed blobs live exclusively under `<canonicalRoot>/.session-archive/`.

## Further notes

- **Prototype disposition:** [`scratch/prototypes/wf-sub-01-semantic-digest.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-01-semantic-digest.ts) and [`scratch/prototypes/wf-sub-07-compaction-reconciler.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.ts) have verified all schemas, queries, token budgets, and latency bounds against the 63-session `.session-archive/index.sqlite` and the exported `S1`/`S2` failure transcripts. Phase E1.3 promotes these modules into `src/viewports/` and unifies `src/plugin.ts`, retiring `.opencode/plugins/compaction-continuity.ts` and `.opencode/plugins/context-prune.ts`.
- **Approval and ADR linkage:** Owner approved Q1..Q3 in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) (`2026-10-18`). Following independent `spec-review` of Phase E1.1, E1.2, and E1.3 specifications, [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md), and [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) transition from `proposed` to `accepted`.
- **2026-10-19 UAT Walk 2 & Benchmark Amendments (`decisions.tsv` #7: `A1..A4`):**
  1. **Unified Verification Gate & Search/Pivot Precision (`A3`, amending `REQ-SUB-13`, `REQ-SUB-14`):** `materializeSemanticDigests` runs `reconcileProvenanceStaleness` so `session_semantic_digest.verification_state` and `compaction_continuation_ledger.verification_gate_status` always agree across `status`, `provenance`, `search`, `timeline`, and `compaction`, rendered in plain language (`PASS (N verified files fresh)` vs `NEEDS RE-VERIFY (K files modified since last test pass: ...)`). `queryVibeNavigation` requires at least `1` non-numeric domain token match before applying active-session boost so unmatched queries return `Matched: 0`. `PIVOT_RULES[0]` (`prune_or_continuity`) matches only short imperative prune/compaction directives (`<= 240` chars) so pasted diagnostic reports are not mislabeled.
  2. **Dedicated `compaction` Viewport Action & Normalized JSON Envelope (`A2`, `A3`, amending `REQ-SUB-15`, `REQ-SUB-17`):** `substrate.viewport` supports `action: "compaction"` to preview the `< 1,200`-token `CompactionContinuationPacket` on demand, normalizes `format: "json"` across all actions to `{ ok, action, sessionID, tokenCount, budgetTokens, content, data }`, removes duplicate token keys in `brief.ts`, and normalizes telemetry `action` on aliases (`search`, `sync`, `prune`).
  3. **OpenCode V2 Package Directory Plugin, Full-Screen Route & Mudball Advisor (`A1`, amending `REQ-SUB-17`):** `scripts/build.ts` outputs an OpenCode V2 plugin package directory (`.opencode/plugins/hivemind-substrate/` with `package.json` exporting `"."`, `"./server"`, `"./tui"`, and `"./rpc"`, wired in `opencode.json`) alongside `dist/session-archive.ts`. Both `src/plugin.ts` and `tui.tsx` use `id: "hivemind-substrate"`. `tui.tsx` passes `{ location: { directory } }` on RPC calls, subscribes via `rpcClient.events.on`, registers `context.ui.router.register({ name: "substrate", render: ... })` for `/substrate` full-screen mode alongside `session.panel`, `sidebar.content`, and `prompt.footer.status`, scopes panel keybindings to `enabled: () => props.input.focused`, and renders the interactive **Mudball & Architecture Advisor** (`RepoMap` cursor -> `AstSkeleton` symbol outline -> `Hidden Coupling` & complexity hotspots + live token savings).
