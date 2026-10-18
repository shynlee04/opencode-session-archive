# Hivemind Substrate (`hivemind-substrate`)

<!-- Stable facts only. Volatile status belongs in STATE.md. -->

## What it is

`hivemind-substrate` is the local-first Context and Working-Memory Substrate plugin for OpenCode V2. It unifies **The Spine** (append-only session transcripts, content-addressed `blobs/<sha256>.txt`, external `tool-output`/`shell` spills, OpenCode shadow worktree snapshot trees, and Git commits), **The Honeycomb** (`.session-archive/index.sqlite` indexing session/delegation lineage, `kv` native bindings, trajectory milestones, file touches, snapshot artifacts, verification receipts, AST code skeletons, PageRank repo maps, and Git temporal co-change matrices), and **Artifacts & Viewports** (step-watermark working-set pruning, 4-tier progressive disclosure recall for Strategist and Implementor viewports, and deterministic compaction continuity).

## Core value

After any number of tool turns, child delegations (`subagent`, `delegate-devin`, `hivemind-delegate`), or context compactions, both the Strategist (Orchestrator) and Implementor (Specialist) can prune active context noise without losing working-memory provenance and recover exact historical findings, prompts, uncommitted file drafts, diffs, and structural code skeletons with zero panic re-reading.

## Users and journeys

- **Human operator (Vibe Coder / Engineer):** Runs multi-hour, multi-harness OpenCode sessions without manual `archive.persist` choreography, context-window thrashing, or post-compaction amnesia.
- **Orchestrator agent (Strategist Viewport):** Reconciles 10 to 40+ delegated child trajectories across compactions by querying `TrajectoryMilestone` and `ProvenanceChain` records (`Finding -> Decision -> ProposedRepair -> FileTouch/Commit -> VerificationReceipt`) via `substrate.viewport`, distinguishing host `succeeded` claims from `semantic_status` (`mcp_init_failure`, `pre_prompt_refusal`) and `verified_status` (`verified_current`, `verified_stale_by_later_touch`).
- **Specialist agent (Implementor Viewport):** Prunes intra-turn tool noise during 45+ step autonomous runs via `substrate.valve` assistant step watermarks (`anchorMessageID` + `blob:<sha256>` `FactBreadcrumb`s + Do-Not-Reread `WorkingMemoryManifest`) and inspects codebase structure via 4-tier progressive disclosure (`RepoMap`, Depth-2 `AstSkeleton`, `SymbolSlice`, `CoChangeCoupling`).

## Constraints

- Host runtime: OpenCode V2 (`@opencode/plugin` `2.0.32` Promise API, Bun v1.4.3 runtime, `bun:sqlite`).
- Single-file bundle gate (`scripts/build.ts`): Compiles to a single self-contained `.ts` bundle (`external: ["bun:*", "node:*"]`). Uses `Bun.Transpiler` + pure-TS Depth-2 skeletonizer/PageRank (`+9.7 KB` total) with zero native C++ addons or sidecar `.wasm` files.
- Read-only host DB: `~/.local/share/opencode/opencode.db` (`2.15 GB` WAL DB), `~/.local/share/opencode/snapshot/`, `~/.local/share/opencode/tool-output/`, and `~/.local/share/opencode/shell/` are strictly read-only sources.
- Hook latency budget: `ctx.session.hook("context", ...)` runs on the synchronous critical path of every primary model turn and stays strictly in-memory (`< 2 ms`). Incremental SQLite persistence runs on explicit tool calls, `compaction` hooks, and background `session.status` (`idle`) / `session.compacted` events.
- Archive locality: `.session-archive/` at the canonical project root (never inside `.opencode/` to avoid triggering host plugin hot-reload loops).

## Non-goals

- Replacing native Harness continuation state (continuing a foreign Devin or Antigravity session remains owned by `hivemind-steward-oc-devin-dev`'s ACP delegation driver).
- Cloud-hosted vector indexing or external LLM calls during ingestion (100% local-first deterministic execution).

## Decisions and terms

Glossary: `GLOSSARY.md` · Decision log / ADRs: `.planning/decisions.tsv` and `.planning/architecture/` · Live specs: see `.planning/ROADMAP.md`.

## Gates

- Agent gate: `bun test` + `bun run typecheck`
- Build for install: `bun run build`
- Runtime proof: dogfooding in live OpenCode V2 sessions + owner UAT
