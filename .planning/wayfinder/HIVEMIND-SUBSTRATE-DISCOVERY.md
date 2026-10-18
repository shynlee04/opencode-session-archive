# Hivemind Substrate Discovery and Architecture Packet

status: discovery-review
date: 2026-10-18
phase: hivemind-substrate (Slice 3)
target_repo: /Users/MAC/Documents/coding-projects/hivemind-substrate
host_repo: /Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev

## 1. Executive Summary and Repository Setup

The standalone repository [`hivemind-substrate`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/package.json#L1-L26) is initialized from [`opencode-session-archive`](file:///Users/MAC/Documents/coding-projects/opencode-session-archive/package.json#L1-L26) with its complete directory tree, tests, build pipeline, and local plugin prototypes ([`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L1-L303) and [`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L1-L720)).

This packet synthesizes forensic failure evidence from two live OpenCode sessions, evaluates the three prototypes across three consumer personas, verifies host runtime assumptions against OpenCode `v2.0.32`, and compares two architectural candidates before locking the `/grill-with-docs` decision frontier.

## 2. Three-Persona Scorecard Across the Three Prototypes

### 2.1 Persona Lenses

1. **Human Operator:** Runs multi-hour OpenCode sessions with delegated children (`subagent`, `delegate-devin`, `hivemind-delegate`). Needs deterministic trajectory recall, zero context-window thrashing, and transparent git/file lineage without manual archiving.
2. **Session and Child Agents:** Operate inside bounded context windows. Need a mid-turn working-set valve that frees tokens during 40+ step single-prompt runs, leaves verifiable breadcrumbs with content-addressed handles, prevents panic re-reading after pruning or compaction, and answers recall queries in one tool call without shell scripting.
3. **Maintainer:** Owns schema evolution, host hook safety, and cross-plugin boundaries. Needs one canonical storage engine, zero regex intent guessing, bounded hook latency against multi-gigabyte `opencode.db` files, and strict boundary validation.

### 2.2 Prototype Scorecard

| Prototype | Human Operator Score | Session and Child Agents Score | Maintainer Score | Evidence and Verdict |
|---|---|---|---|---|
| [`opencode-session-archive`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index.ts#L1-L95) | 6/10. Captures clean JSONL and SQLite trees, but requires manual `archive.persist` calls before compaction hits. | 3/10. Write-only surface ([`plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts#L28-L78)). Agents in Session 2 (`msg[124..125]`) had to shell out to `python3` and `head` to inspect archived turns. | 8/10. Strong read-only ingestion from `opencode.db` ([`source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts#L89-L137)), content-addressed blobs ([`normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L122-L129)), and relational tables ([`index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L105-L194)). | **Keep as Foundation.** Upgrade to incremental watermark sync and add a first-class read/query interface. |
| [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L1-L303) | 5/10. Works across multi-turn chats, but fails silently during long single-prompt autonomous runs (`0` parts thinned in Session 1 `msg[45]`). | 4/10. Anchors only on `role === "user"` ([`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115)). Replaces outputs with generic rerun stubs ([`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L60-L63)) that erase what files and skills were already read. | 6/10. Non-destructive in-memory `context` hook and key-preserving `thinInput` ([`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L65-L88)) are sound, but state lives only in process RAM. | **Redesign Valve Mechanics.** Anchor on assistant step watermarks, link stubs to archive blob SHAs, and emit a working-memory manifest. |
| [`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L1-L720) | 5/10. Structured compaction prompt sections ([`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L16-L98)) preserve intent well when populated, but cross-session system prompt injection adds noise. | 3/10. Calling `compaction_continuity({ action: "intents" })` without `sessionID` failed in Session 1 `msg[58]` ([`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L649-L689)). | 2/10. Writes a competing `.opencode/compaction-history/*.jsonl` silo, scrapes intent pivots with fragile `lower.includes("no ")` heuristics ([`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L250-L310)), and listens to an internal reducer event name. | **Retire Storage Silo.** Preserve the structured compaction prompt contract, backed directly by `.session-archive/index.sqlite`. |

## 3. Discriminating Host-Contract Findings (Mandatory Pushback)

Verification against pinned OpenCode `v2.0.32` declarations and runtime source surfaced four load-bearing corrections to initial assumptions.

### Finding 1: `Assistant.snapshot` (`start` and `end`) Are Shadow Worktree Tree SHAs, Not Project Git Commits

* **Claim Tested:** `normalize.ts` captures `snapshot.start` and `snapshot.end` SHAs on `AssistantRecord`, which can be indexed directly as project Git commits.
* **Discriminating Evidence:** In [`snapshot.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/snapshot.ts#L95-L140) and [`diff.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/session/diff.ts#L87-L137), OpenCode maintains a separate bare Git repository per worktree under `~/.local/share/opencode/snapshot/<project_id>/<hash>/` and calls `git.tree.capture` before and after each assistant step. Probing SHA `4ca0bc1f19f798840f22286c8689ebd6922cf236` from `.session-archive` against the project `.git` repository fails with `fatal: git cat-file: could not get object info`. Probing that same SHA against `~/.local/share/opencode/snapshot/968fc8714005c10a127661f760f5035e2a51cb0e/7f40ac98354168df291b3fc13110000258db1112` resolves as a Git `tree` object.
* **Architectural Counter-Proposal:** Separate turn-level file snapshots from repository Git commits in `index.sqlite`. Store OpenCode step trees and file diffs in `step_snapshot` and `file_touch`. Store real project `.git` commits in `git_commit_lineage` by indexing `git commit` tool executions and matching `git log` commit timestamps and trailers within the session tree window.

### Finding 2: Synchronous Full-Tree `persist()` Inside `ctx.session.hook("context", ...)` Blocks Every Model Step

* **Claim Tested:** The substrate can auto-persist `.session-archive` inside `ctx.session.hook("context", ...)` on every turn so the archive is always current before pruning or compaction.
* **Discriminating Evidence:** In [`model-request.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/session/model-request.ts#L420-L425), `ctx.session.hook("context", ...)` runs synchronously on the critical path of every primary LLM request, and any uncaught error aborts the model turn as a defect ([`model-request.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/session/model-request.ts#L323)). Furthermore, the live `~/.local/share/opencode/opencode.db` is `2.15 GB` (`2,149,879,808` bytes). Benchmarking [`persistArchive`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index.ts#L28-L88) on a 17-session tree (`ses_eb23bfbf0ffesn5kT0yJI06h35`, 560 messages) measured `294 ms` cold write (760 files) and `150 ms` warm no-op due to full-tree file statting, `indexMatches` full-table reads ([`index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L287-L329)), and `PRAGMA wal_checkpoint(TRUNCATE)` ([`index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L281)).
* **Architectural Counter-Proposal:**
  1. Keep `ctx.session.hook("context", ...)` strictly in-memory (`< 2 ms`) reading from an in-memory watermark cache hydrated from `index.sqlite`.
  2. Replace full-tree `indexMatches` rebuilds with incremental watermark sync keyed by `(session_id, max_seq, time_updated)` so unchanged sessions perform zero file or blob I/O.
  3. Trigger incremental SQLite persistence only on:
     * Explicit tool calls (`substrate.prune`, `substrate.recall`, `archive.persist`).
     * `ctx.session.hook("compaction", ...)` (runs only when the context window overflows, guaranteeing pre-compaction turns are persisted before summary generation).
     * Background `ctx.event.subscribe` on `session.status` (`status.type === "idle"`) and `session.compacted` off the request path.

### Finding 3: `toLLMMessages` Lowers Tool Results With `id: undefined` and Emits Synthetic `role: "user"` Messages

* **Claim Tested:** `context-prune` can anchor on `role === "user"` in `event.messages` or match `role: "tool"` messages by their message `id`.
* **Discriminating Evidence:** In [`to-llm-message.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/session/runner/to-llm-message.ts#L216-L326), each `SessionMessage.Assistant` lowers into one `role: "assistant"` message (`id: message.id`) followed immediately by `Message.tool` rows where `message.id` is `undefined` and each inner `tool-result` part carries `part.id === tool.id` (`call_...`). Meanwhile, `role: "user"` is emitted for `location-switched`, `synthetic`, `skill`, `shell`, and `compaction` checkpoints in addition to human prompts. In a 44-step auto-run turn under one human prompt (Session 1 `msg[45]`), anchoring on the last `user` message places 100% of assistant tool calls after the anchor, thinning `0` bytes.
* **Architectural Counter-Proposal:** Anchor pruning on an **Assistant Step Watermark** (`anchorMessageID`: the `id` of the `N`-th from last `assistant` message in `ctx.session.context`, where `keepRecentSteps` defaults to `6`). In `ctx.session.hook("context", ...)`, locate the `role: "assistant"` message matching `anchorMessageID` and thin all preceding `assistant` `tool-call` inputs and paired `role: "tool"` `tool-result` outputs (matched by `part.id === call_id`), plus preceding `<skill_content>` blocks. This works identically in multi-turn chats, 50-step single-prompt auto-runs, and delegated child sessions.

### Finding 4: Unhandled `skill` and `shell` Message Variants and Ephemeral Compaction Event Mismatch

* **Claim Tested:** `normalize.ts` archives all message types and `compaction-continuity.ts` receives `"session.compaction.ended"` events.
* **Discriminating Evidence:**
  1. [`session-message.js`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/node_modules/@opencode/schema/dist/session-message.js#L79-L98) defines `Session.Message.Skill` (`type: "skill"`, `{ skill, name, text }`) and `Session.Message.Shell` (`type: "shell"`, `{ shellID, command, status, exit, output }`). [`normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L327-L346) falls through to `unknown` for both types instead of indexing skill loads or sinking large shell outputs to `blobs/<sha256>.txt`.
  2. [`session-compaction-event.js`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/node_modules/@opencode/schema/dist/session-compaction-event.js#L4-L9) defines the public bus event as `type: "session.compacted"` (`{ sessionID }`). `"session.compaction.ended"` in [`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L556) is an internal reducer event in [`message-updater.ts`](file:///Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2/packages/core/src/session/message-updater.ts#L426) and never fires on the public plugin event bus.
* **Architectural Counter-Proposal:** Add first-class `skill` and `shell` normalization in [`normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L327-L346) (sinking `skill.text` and `shell.output` to blobs and recording skill loads in `file_touch` / `skill_load`), and subscribe to `"session.compacted"` in `ctx.event.subscribe`.

## 4. Canonical Domain Model and SQLite Schema (`.session-archive/index.sqlite`)

All three subsystems share a single SQLite database at `.session-archive/index.sqlite` and a single content-addressed blob directory at `.session-archive/blobs/<sha256>.txt`. `.opencode/compaction-history/*.jsonl` is retired.

### 4.1 Core Tables (Upgraded From `opencode-session-archive`)

* `session`: Adds `max_seq INTEGER NOT NULL DEFAULT 0` and `source_updated_at TEXT NOT NULL` watermark columns so incremental sync skips unchanged sessions in `O(1)`.
* `delegation`: Preserves parent-child lineage across `subagent`, `delegate-devin`, and `hivemind-delegate` (`harness`, `agent`, `model`, `title`, `status`, `Background` / `Foreground` mode when available).
* `message`: Adds `skill` and `shell` record normalization alongside `user`, `assistant`, `compaction`, `synthetic`, `system`, and boundary types.
* `tool_call`: Adds `target_path TEXT`, `input_summary TEXT`, `input_ref TEXT`, and `output_ref TEXT` (`blob:<sha256>` or inline preview) so prune stubs and recall queries resolve exact blob handles in `O(1)` by `call_id`.
* `compaction` and `instruction`: Retained intact.

### 4.2 New Lineage and Working-Memory Tables

1. `user_prompt(session_id TEXT, seq INTEGER, message_id TEXT, t TEXT, turn_index INTEGER, is_human INTEGER, is_post_compaction INTEGER, text_preview TEXT, text_ref TEXT, PRIMARY KEY (session_id, seq))`
   * Stores chronological human prompts and post-compaction directives without regex guessing.
2. `step_snapshot(session_id TEXT, seq INTEGER, message_id TEXT, start_tree TEXT, end_tree TEXT, files_json TEXT, PRIMARY KEY (session_id, seq))`
   * Stores OpenCode shadow worktree tree SHAs and touched file arrays per assistant step.
3. `file_touch(session_id TEXT, seq INTEGER, call_id TEXT, path TEXT, op TEXT, line_range TEXT, blob_sha TEXT, summary TEXT, PRIMARY KEY (session_id, seq, call_id, path))`
   * Indexes every `read`, `write`, `edit`, `patch`, `skill`, and `snapshot` touch across root and child sessions. Powers the "do-not-reread" working-memory manifest.
4. `git_commit_lineage(commit_sha TEXT PRIMARY KEY, root_id TEXT, session_id TEXT, seq INTEGER, call_id TEXT, committed_at TEXT, subject TEXT, trailers_json TEXT, files_json TEXT)`
   * Links real repository `.git` commits to the exact session and tool call that created them.
5. `prune_state(session_id TEXT PRIMARY KEY, mode TEXT, anchor_message_id TEXT, keep_recent_steps INTEGER, pruned_calls_count INTEGER, saved_chars INTEGER, updated_at TEXT, manifest_json TEXT)`
   * Persists the active prune watermark and working-memory manifest across process restarts.
6. `code_symbol(file_path TEXT, symbol_name TEXT, kind TEXT, exported INTEGER, start_line INTEGER, end_line INTEGER, signature_hash TEXT, last_session_id TEXT, last_seq INTEGER, PRIMARY KEY (file_path, symbol_name, start_line))` (Horizon 2 / Phase 3 Spec scope)
   * Lightweight TypeScript/JavaScript symbol table updated incrementally for touched files.

## 5. `DESIGN-IT-TWICE` Interface Comparison (`codebase-design`)

### Sketch A: Unified Two-Tool Deep Substrate (`substrate.prune` + `substrate.recall`) (Recommended)

One plugin (`hivemind-substrate`) owns ingestion, working-set pruning, progressive-disclosure recall, and compaction continuity behind two deep tools and three lifecycle hooks:

1. **`substrate.prune({ mode?: "step-window" | "turn" | "initial", keepRecentSteps?: number })`**
   * Runs an incremental sync of the current session tree into `.session-archive/index.sqlite`.
   * Computes `anchorMessageID` using the assistant step watermark (`keepRecentSteps`, default `6` for `"step-window"`).
   * Persists `prune_state` in SQLite and returns a compact Working-Memory Manifest listing `filesAlreadyRead` (with line ranges and `blob:<sha256>`), `filesModified`, and `skillsLoaded` so the agent knows what facts are already in its trajectory without re-reading.
   * On subsequent turns, `ctx.session.hook("context", ...)` replaces each pre-watermark tool output/input with a structured fact breadcrumb:
     `[substrate:thinned read src/acp.ts#L1-L120 (4,820 chars) -> blob:9a4f1c2e | recall({ view: "blob", blob: "9a4f1c2e" })]`
   * For `write`, `edit`, and `patch` calls, replaces large content bodies in `tool-call` inputs while preserving `filePath`, `op`, line range, and `blob:<sha256>`.

2. **`substrate.recall({ view?: "overview" | "prompts" | "delegations" | "files" | "commits" | "tools" | "blob" | "search", sessionID?: string, query?: string, blob?: string, startLine?: number, endLine?: number, limit?: number })`**
   * Defaults `sessionID` to `context.sessionID` and automatically resolves `root_id` from `index.sqlite` (eliminating the missing-`sessionID` failure from Session 1 `msg[58]`).
   * Runs an incremental sync if the current session has unarchived turns, then returns deterministic structured Markdown/JSON from `index.sqlite` or slices lines from `.session-archive/blobs/<sha256>.txt`.

3. **Lifecycle Hooks (`context`, `compaction`, `event.subscribe`):**
   * `ctx.session.hook("context", ...)`: Strictly in-memory (`< 2 ms`). Applies the active `prune_state` watermark and injects a single compact Working-Memory Manifest block if pruning is active. Never injects cross-session noise.
   * `ctx.session.hook("compaction", ...)`: Runs incremental sync first, queries deterministic session facts from `index.sqlite` (`user_prompt` history, `delegation` outcomes, `file_touch` read/modified ledger, `git_commit_lineage`), and appends them to the structured `COMPACTION_SYSTEM_PROMPT` (`## Objective`, `## User Intent Map`, `## Verified Working Memory & Do-Not-Reread Ledger`).
   * `ctx.event.subscribe`: Listens for `session.status` (`idle`) and `session.compacted` to run background incremental syncs.

### Sketch B: Federated Three-Tool Surface (`archive.persist` + `ctx.context-prune` + `compaction_continuity`)

Keeps the three existing tool names and plugin files separate, wired to read/write `.session-archive/index.sqlite`.

### Tradeoff Matrix

| Dimension | Sketch A: Unified Two-Tool Substrate (Recommended) | Sketch B: Federated Three-Tool Surface |
|---|---|---|
| **Agent Cognitive Load** | **Low.** Two tools (`substrate.prune`, `substrate.recall`). Pruning automatically syncs the archive; recalling automatically syncs unarchived turns. | **High.** Agents must remember to call `archive.persist` before `context-prune`, and choose between `compaction_continuity` and archive queries. |
| **Failure Modes** | **Eliminated.** Cannot prune unarchived turns into blind stubs; cannot fail on missing `sessionID`. | **Fragile.** Cross-plugin load order and separate SQLite connections risk `SQLITE_BUSY` or pruning before blobs are written. |
| **Module Depth (`codebase-design`)** | **Deep.** Hides incremental SQLite sync, blob addressing, step-watermark calculation, and compaction prompt assembly behind two narrow entry points. | **Shallow.** Exposes internal pipeline stages (persist vs prune vs recall) as manual agent choreography. |

## 6. Interactive `/grill-with-docs` Decision Frontier

1. **Q1 (Package Topology and Tool Namespace):** Should `hivemind-substrate` ship Sketch A with two primary tools (`substrate.prune` and `substrate.recall`, plus optional compatibility aliases for `archive.persist` and `ctx.context-prune` during transition), or keep Sketch B's three separate tools?
2. **Q2 (Intra-Turn Watermark and Input Thinning Policy):** When `substrate.prune` runs mid-turn (`mode: "step-window"`), should it default to keeping the last `6` assistant steps unpruned (`keepRecentSteps: 6`) and thin `write`/`edit`/`patch` input bodies before that watermark into `[substrate:thinned <tool> <path> -> blob:<sha256>]` breadcrumbs?
3. **Q3 (Compaction Hook vs System-Prompt Injection):** Should we restrict `context.system` injection to `ctx.session.hook("compaction", ...)` (plus a compact single-session working-memory manifest when `prune` is active), completely removing [`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L597-L605)'s per-turn cross-session system prompt injection?
4. **Q4 (Horizon 1 Prototype Wave vs Horizon 2 Codebase Symbol Scope):** Should the immediate Prototype Wave in `hivemind-substrate` lock and verify Layer 1 (`index.sqlite` incremental sync, `user_prompt`, `step_snapshot`, `file_touch`, `git_commit_lineage`, `substrate.prune`, `substrate.recall`, and the compaction hook), while scoping AST `code_symbol` indexing (`Layer 2`) into the Phase 3 formal SPEC and ticket wave?
