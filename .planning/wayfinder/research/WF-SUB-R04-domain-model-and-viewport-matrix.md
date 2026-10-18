# WF-SUB-R04: Domain Model, Invariants & The 3x2 Substrate-by-Viewport Matrix

- **Status:** verified architecture & domain model
- **Owner:** Domain & Viewport Architect (`02f27713-54b1-4036-8842-f979c3f8cbd7`)
- **Primary Sources:**
  - [`GLOSSARY.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/GLOSSARY.md)
  - [`docs/agents/domain.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/docs/agents/domain.md)
  - [`the-box-of-context-viewports-on-sessions-and-codebase.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/docs/teach-me/the-box-of-context-viewports-on-sessions-and-codebase.md)
  - [`learning-route-ver-openai-6-1-sol.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/docs/teach-me/learning-route-ver-openai-6-1-sol.md)

## 1. The 3x2 Substrate-by-Viewport Matrix

`hivemind-substrate` unifies **Agent Trajectory Memory** and **Codebase Structural Memory** across three storage tiers (**The Spine**, **The Honeycomb**, **The Artifacts**) and projects them through two role-specific viewports (**Strategist Viewport** vs **Implementor Viewport**):

| Substrate Tier | Strategist Viewport (Orchestrator / Coordinator) | Implementor Viewport (Bounded Specialist / Child) |
|---|---|---|
| **1. The Spine** (Immutable Ground Truth: `.session-archive/blobs/<sha256>.txt`, per-session `.jsonl`, git commits, shadow snapshot trees) | **Audit & Provenance Verification:** Resolves `blob:<sha256>` handles on demand for disputed review claims, exact user wording, or uncommitted child draft diffs (`start_tree_sha -> end_tree_sha`). | **Targeted Slice Hydration:** Resolves exact line ranges (`[Lstart-Lend]`) of assigned write-lease files or specific failing test outputs via `blob:<sha256>` handles. |
| **2. The Honeycomb** (Relational + Structural Graph in `.session-archive/index.sqlite`) | **Landscape & Lineage Navigation:** Queries semantic session digests, user intent pivots, delegation trees (`ReportedOutcome` vs `VerifiedOutcome`), `ProvenanceChain` status, and Tier-1 PageRank `RepoMap` (`<1,000` tokens). | **Surgical Neighborhood Context:** Queries Tier-2 Depth-2 `AstSkeleton` (`90.5%` compression) for leased and imported modules, plus `CoChangeCoupling` warnings (`P(A|B) >= 0.40`). |
| **3. The Artifacts** (Curated State: `WorkingMemoryManifest`, compaction ledger, specs, tickets) | **Continuity & Valve Control:** Maintains the `WorkingMemoryManifest` (Do-Not-Reread ledger of loaded skills, read file slices, active leases, open blockers) and drives step-watermark pruning. | **Lease & Gate Compliance:** Receives a compact pre-packed brief containing only its write lease, target `AstSkeleton`s, and required verification command. |

## 2. Five Non-Negotiable Domain Invariants

1. **Invariant 1 (No Blind Stub Erasure):** No `ActiveContext` tool output may be thinned by `WorkingSetValve` until its full payload (including external `~/.local/share/opencode/tool-output/` or `shell/` spills) is persisted in **The Spine** (`blobs/<sha256>.txt`) and replaced by a structured `FactBreadcrumb` containing `blob:<sha256>`, tool name, target path/command, line range, and a deterministic 1-line summary.
2. **Invariant 2 (Intra-Turn Step Watermark):** `WorkingSetValve` must support assistant-step watermark slicing (`keepRecentSteps: K`, default `K = 8`) in addition to user-prompt anchoring, so long single-prompt auto-runs and delegated child turns can thin completed intermediate steps without waiting for a new human message.
3. **Invariant 3 (Reported vs Verified Outcome Separation):** Host `idle.outcome = "succeeded"` (`ReportedOutcome`) never promotes a delegation turn or finding to `verified_pass` (`VerifiedOutcome`). `VerifiedOutcome` requires cross-checking child tool-call error counts, terminal blocker markers, and snapshot/test evidence.
4. **Invariant 4 (Snapshot Staleness Detection):** Every `FileTouch`, `AstSkeleton`, and `ProvenanceChain` repair link is bound to a content `blob_sha` or Git tree SHA. If the working tree file's current hash diverges from the recorded hash, the substrate marks that memory entry `STALE` in the `WorkingMemoryManifest`.
5. **Invariant 5 (Hook Latency & Zero-Spend Determinism):** The per-call `context` hook must execute purely in-memory in `< 2 ms`. Incremental SQLite and AST sync runs on `compaction`, `session.status` (`idle`), or explicit tool calls in `< 200 ms` with `0` LLM API calls.

## 3. Design-It-Twice (`DESIGN-IT-TWICE`) on the Plugin Surface

We compared three distinct architectures for exposing `hivemind-substrate` inside OpenCode V2:

| Design Option | Surface Shape | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Design A: Tool-Per-Table Explosion** | 9+ tools (`archive_persist`, `archive_sql`, `archive_fts`, `context_prune`, `compaction_continuity`, `ast_skeleton`, `repo_map`, `co_change`, `blob_read`) | Direct 1:1 mapping to internal functions | Violates `principle-guard-the-context-window`; bloats system tool declarations on every turn; forces agent to manually orchestrate multi-tool joins | **Rejected** |
| **Design B: Zero-Tool Hook-Only Magic** | 0 tools; everything injected automatically via `context` and `compaction` hooks | Zero tool-schema overhead | Agent cannot intentionally prune mid-auto-run, cannot expand a `blob:<sha256>` breadcrumb on demand, and cannot query a specific symbol slice | **Rejected** |
| **Design C: Hybrid Hook + 2 Action-Multiplexed Tools (`substrate` + `viewport`)** | Passive `context` (`<2ms`) + `compaction` + `session.status` hooks, paired with **`substrate`** (`status`, `Thin`/`prune`, `resolve`, `timeline`, `provenance`) and **`viewport`** (`repomap`, `skeleton`, `slice`, `coupled`) | Minimal schema footprint (2 tools); deterministic lifecycle automation on compaction/idle; explicit agent control for mid-turn thinning and progressive disclosure | Needs clear action discriminated unions | **Selected for Prototyping (`WF-SUB-01..07`)** |
