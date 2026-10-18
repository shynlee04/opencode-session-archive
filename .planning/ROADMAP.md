# Roadmap: hivemind-substrate

Updated: 2026-10-18. One row per phase; requirements live in each phase's SPEC.md.
Status values: `planned`, `active`, `done`, `empty`, `superseded`, `deferred`.

## E1 Unified Context & Working-Memory Substrate (`active`)

- **Outcome (PM):** Unify session/delegation archival (`opencode-session-archive`), intra-turn working-set pruning (`opencode-context-prune`), compaction continuity (`compaction-continuity.ts`), and structural codebase viewports (`Bun.Transpiler` Depth-2 AST Skeletons, PageRank Repo Map, Git Co-Change) into one local-first OpenCode V2 substrate; success signal: zero-reread intra-turn pruning on 45+ step turns, deterministic post-compaction audit recovery across multi-harness children (including uncommitted draft recovery and false-positive completion detection), and `< 200 ms` incremental indexing.
- **Non-goals:** Cross-harness native trajectory migration; cloud-dependent or native-C++-addon indexing.
- **Seams (architect):** `src/spine/` (incremental `opencode.db` + `kv` bindings + shadow snapshot blobs + `tool-output`/`shell` spills + `blobs/`), `src/honeycomb/` (`index.sqlite` relational & provenance store + `Bun.Transpiler` Depth-2 AST skeletonizer + PageRank + `git log` co-change matrix), `src/viewports/` (`substrate.viewport` + `substrate.valve` tools, step-watermark `context` hook, and `compaction` continuity hook).
- **Depends on:** none

| Phase | Slug | Status | Depends on | Spec |
|---|---|---|---|---|
| E1.1 | `trajectory-working-memory` | `active` | none | `.planning/phases/trajectory-working-memory/SPEC.md` |
| E1.2 | `codebase-structural-graph` | `planned` | E1.1 | `.planning/phases/codebase-structural-graph/SPEC.md` |
| E1.3 | `viewport-synthesis-compaction` | `planned` | E1.1, E1.2 | `.planning/phases/viewport-synthesis-compaction/SPEC.md` |

## Deferred

- `semantic-vector-lightrag`: Dense vector embeddings (`sqlite-vec`) and LLM-driven entity extraction; deferred in favor of deterministic `bun:sqlite` FTS5 BM25 + AST/PageRank/Co-Change graph to preserve single-file bundle portability and `< 200 ms` latency; would join E1.
