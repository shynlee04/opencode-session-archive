# Glossary

Canonical domain terms for `hivemind-substrate`. Read before naming types, tables, tools, or documents.

## Memory Boundaries & The Box of Context

- **Box of Context:** The finite linear token buffer sent to the model on a single request, partitioned into System Invariants, Ambient Topological Map, Active Task & Dialogue, and JIT Snippets.
- **Active Context:** The outgoing `event.messages` and `event.system` payload assembled by OpenCode for the current LLM step (`ctx.session.hook("context", ...)`).
- **Persisted Record:** Raw rows and files written by the host or harness (`~/.local/share/opencode/opencode.db`, `~/.local/share/opencode/tool-output/`, `~/.local/share/opencode/shell/`, `~/.local/share/opencode/snapshot/`).
- **Retrievable Memory:** Structured, content-addressed records in `.session-archive/` (`index.sqlite`, `blobs/<sha256>.txt`, and session JSONL transcripts) queryable by deterministic tools across sessions and compactions.
- **Continuation State:** Harness-owned session binding and checkpoint state required to resume execution on the original foreign trajectory (`devin`, `antigravity`, or `opencode`). Distinct from Retrievable Memory.

## The Three-Layer Substrate

- **The Spine:** Layer 1 append-only physical ground truth (`.session-archive/blobs/<sha256>.txt`, JSONL transcripts, OpenCode shadow worktree Git trees, repository `.git` commit history, and raw workspace files). Never dumped raw into Active Context.
- **The Honeycomb:** Layer 2 queryable relational and structural graph index in `.session-archive/index.sqlite` (sessions, delegations, trajectory milestones, user prompts, tool calls, file touches, snapshot artifacts, AST code skeletons, PageRank scores, and Git temporal co-change probabilities).
- **Artifacts & Viewports:** Layer 3 role-specific, token-budgeted projections synthesized from The Honeycomb and The Spine (Strategist Viewport, Implementor Viewport, Working-Memory Manifest, and Compaction Continuity Ledger).

## Trajectory, Delegation & Provenance

- **Semantic Session Digest:** The materialised natural-language identity card for a session tree (`session_semantic_digest`), indexing the initial goal, latest intent summary, active phase/ticket/gate, touched file paths, loaded skills, child harness summary, and verification status so agents can locate sessions by meaning via FTS5 BM25 rather than opaque `ses_...` IDs.
- **Intent Pivot:** A classified human message along a session trajectory (`intent_pivot`), categorized into `initial_goal | course_correction | approval | handoff_resume | prune_or_continuity | followup | verification_directive | scope_narrowing | continuation_after_compaction` and linked to its lossless `blob:<sha256>` prompt text.
- **Delegation Turn:** A single parent-to-child stop interval keyed by `(parent_session_id, call_id, turn_index)` (`delegation_turn`), preserving every `spawn` and subsequent `send`/`continue` turn on a continuing child trajectory without overwriting prior turns.
- **Trajectory Milestone:** A discrete stopped turn (`idle`), user redirect, delegation handoff, or compaction checkpoint along a continuing parent or child session, linking the prompt/instruction, assistant response, tool calls, `StepSnapshot` tree SHAs, `ReportedOutcome`, and `VerifiedOutcome`.
- **Snapshot Artifact:** A working-tree file draft extracted from OpenCode's shadow Git bare repository (`start_tree:path` or `end_tree:path`) and persisted to `.session-archive/blobs/<sha256>.txt` (`snapshot_artifact`), preserving uncommitted child and parent edits across `git gc`.
- **Spill Artifact:** An untruncated tool or shell output file captured from `~/.local/share/opencode/tool-output/` or `~/.local/share/opencode/shell/` and sunk into `.session-archive/blobs/<sha256>.txt` (`spill_artifact`) before the host's 7-day retention sweep.
- **Provenance Chain:** The verifiable causal graph connecting `AuditFinding -> DecisionOrRedirect -> ProposedRepair -> FileTouch/Commit -> VerificationReceipt`.
- **Step Snapshot:** The pair of shadow Git tree SHAs (`start_tree`, `end_tree`) captured by OpenCode in `~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/` before and after an assistant step, enabling point-in-time recovery of uncommitted file drafts.
- **Reported Outcome:** What a child session or assistant message claims in prose or host idle status (`idle_outcome = "succeeded"`), which may diverge from actual tool/test execution (`semantic_status` and `verified_status`).
- **Verified Outcome:** Deterministic `verification_receipt` proof anchored to an executed command, exit code, output `blob:<sha256>`, Git `head_sha`, and `worktree_tree_sha`, automatically downgraded to `verified_stale_by_later_touch` if a covered path is edited later without a newer passing receipt.

## Working-Set Valve & Viewports

- **Assistant Step Watermark:** The pruning boundary anchored to the `N`-th most recent `assistant` message ID (`anchorMessageID`, `keepRecentSteps`) rather than `role === "user"`, enabling mid-turn pruning during long single-prompt autonomous runs.
- **Fact Breadcrumb:** The compact replacement stub injected by the `context` hook for thinned tool calls and outputs, preserving tool name, target path/line range, character count, and content-addressed `blob:<sha256>` handle.
- **Working-Memory Manifest:** The compact "Do-Not-Reread" ledger summarizing files already read (with line ranges and disk SHA status `FRESH — DO NOT REREAD` vs `STALE (modified since read/review — re-verify slice)`), files modified, skills loaded (`ACTIVE — DO NOT RE-INVOKE`), and co-change alerts.
- **Compaction Continuation Packet:** The deterministic `< 1,200`-token post-compaction brief synthesized from `index.sqlite` (`compaction_continuation_ledger`) and injected via `ctx.session.hook("compaction", ...)`, uniting the session headline, chronological `IntentPivot` timeline, `WorkingMemoryManifest`, multi-turn `DelegationTurn` table, `ProvenanceChain` staleness status, and Tier-1 `RepoMap`.
- **Strategist Viewport:** The Orchestrator-focused projection emphasizing user intent sequence, child delegation milestones, provenance chains, and verification gate status (`< 600` ambient tokens).
- **Implementor Viewport:** The Specialist-focused projection emphasizing 4-tier progressive disclosure over codebase structure (`RepoMap`, `AstSkeleton`, `SymbolSlice`, `CoChangeCoupling`).
- **AST Code Skeleton:** A deterministic syntax outline of a source file (`Bun.Transpiler.scan` + Depth-2 closure-factory descent) retaining imports, exported type/interface/class/function signatures, inner closure helper signatures, and exact `[Lstart-Lend]` anchors while stripping implementation bodies (`84-96%` token compression).
- **Temporal Co-Change Coupling:** The conditional probability $P(F_A \mid F_B) = \frac{\text{Commits}(F_A \cap F_B)}{\text{Commits}(F_B)}$ that file $F_A$ is modified in the same commit as $F_B$, mined from repository `git log` history.
