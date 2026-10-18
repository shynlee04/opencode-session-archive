# Wayfinder Map — `hivemind-substrate`

- **Status:** `resolved` (all prototype spikes `WF-SUB-01..07` and owner grill gate `WF-SUB-08` completed; transitioned to `to-spec` for Phases `E1.1..E1.3`)
- **Updated:** 2026-10-18

## Destination

Build `hivemind-substrate` as the deterministic, programmatic context glue across **Agent Trajectory Memory** (sessions, multi-harness delegations across OpenCode/Devin/Antigravity, user intent pivots, decisions, verified vs reported outcomes) and **Codebase Structural Memory** (Depth-2 AST skeletons, PageRank RepoMap, Git commits, uncommitted shadow snapshots, and temporal co-change couplings). Enable vibe coders and orchestrators to switch harnesses or resume any session using high-level natural language without blind re-reading, opaque `ses_id` hunting, or ad-hoc shell scraping.

## Notes

- **Why we are in `/wayfinder` (and NOT yet in `to-spec`):** All three existing artifacts in this repo ([`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts), [`.opencode/plugins/context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts), and [`.opencode/plugins/compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts)) are living prototypes. We have completed the forensic postmortem and benchmark research (`WF-SUB-R01..R04`), and must now run focused prototype spikes (`WF-SUB-01..07`) against the real exported sessions (`session-bcad339b`, `session-a35adea6`) and manifested `.session-archive/index.sqlite` before locking ADRs (`WF-SUB-08`) or writing a formal phase `SPEC.md`.
- **Research Records Completed:**
  - [`WF-SUB-R01-forensic-dual-plugin-collision.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md)
  - [`WF-SUB-R02-host-storage-kv-snapshots-spills.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md)
  - [`WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md)
  - [`WF-SUB-R04-domain-model-and-viewport-matrix.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)
- **Accepted ADRs (Verified by `WF-SUB-01..07` & Approved in `WF-SUB-08`):**
  - [`ADR-001-three-layer-context-substrate.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md) (`accepted`)
  - [`ADR-002-step-watermark-valve-and-breadcrumb-handles.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md) (`accepted`)
  - [`ADR-003-bun-native-codebase-structural-graph.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) (`accepted`)

## Decisions so far

| # | Decision | Evidence / Reference |
|---|---|---|
| 1 | Stand up `/Users/MAC/Documents/coding-projects/hivemind-substrate` as a dedicated repository in the multi-root workspace holding all three prototypes (`session-archive`, `context-prune`, `compaction-continuity`) and architecture dossiers. | `.planning/decisions.tsv` (`1-3`) |
| 2 | Keep `hivemind-substrate` in `/wayfinder` prototype/experimental mode (`WF-SUB-01..08`) until each mechanism is tested against the exported session failures (`ses_eb2eabb14ffeCXsCwb845rtffb` and `ses_eb23bfbf0ffesn5kT0yJI06h35`) and `.session-archive/index.sqlite`. | [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md) |
| 3 | Reject `ts.createSourceFile` (broken in `typescript@7.0.2` `tsgo`) and external `.wasm` binaries in favor of zero-dependency `Bun.Transpiler.scan()` + Depth-2 closure-factory skeletonization (`+4.2 KB`), `Float64Array` PageRank (`+3.1 KB`), and `git log` co-change mining (`+2.4 KB`). | [`WF-SUB-R03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md), [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) |

## Frontier

| Ticket | Kind | Question / Prototype Spike | Depends on | Status |
|---|---|---|---|---|
| [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md) | `wayfinder:prototype` | Can a deterministic semantic session digest + `intent_pivot` + FTS5 layer over `.session-archive/index.sqlite` replace opaque `ses_id` navigation and eliminate ad-hoc Python JSONL scraping (`S2 msg[124..125]`)? | — | `resolved` |
| [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md) | `wayfinder:prototype` | Does assistant step-watermark slicing (`keepRecentSteps: K`) + `blob:<sha256>` `FactBreadcrumb`s + `WorkingMemoryManifest` solve both the 45-step auto-run `0`-byte prune (`S1 msg[45]`) and the post-prune re-read spiral (`S2 msg[125..130]`)? | `WF-SUB-01` | `resolved` |
| [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md) | `wayfinder:prototype` | Can we ingest `opencode.db` `kv` bindings, sink uncommitted shadow Git snapshot blobs (`~/.local/share/opencode/snapshot/`), capture `tool-output`/`shell` spills, and separate `ReportedOutcome` from `VerifiedOutcome` across the 11 false-positive Antigravity children? | — | `resolved` |
| [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md) | `wayfinder:prototype` | Does watermark-gated incremental SQLite sync run in `< 150 ms` on `compaction`/`idle` against the `2.15 GB` `opencode.db` while keeping the `context` hook `< 2 ms` in-memory? | `WF-SUB-03` | `resolved` |
| [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md) | `wayfinder:prototype` | Does the `+4.2 KB` `Bun.Transpiler` + Depth-2 closure-factory skeletonizer index all `51` `src/**/*.ts` files (`>= 88%` compression) and expose inner helpers of `createNativeDelegationDriver` (`[L839-L3727]`)? | — | `resolved` |
| [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md) | `wayfinder:prototype` | Does `Float64Array` PageRank + `git log` temporal co-change mining produce `< 1,000`-token Tier-1 RepoMaps and accurate coupling warnings (`devin-executable <-> harness-antigravity` `66.7%`)? | `WF-SUB-05` | `resolved` |
| [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md) | `wayfinder:prototype` | Can a SQLite-backed `compaction` hook + `ProvenanceChain` staleness reconciler retire `.opencode/compaction-history/*.jsonl` and inject a `< 1,200`-token continuation packet with `FRESH` vs `STALE` file status? | `WF-SUB-01`, `WF-SUB-02`, `WF-SUB-03`, `WF-SUB-05` | `resolved` |
| [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) | `wayfinder:grilling` | Owner HITL grill gate on the prototype results (`WF-SUB-01..07`), the 2-tool surface (`substrate` + `viewport`), auto-thinning thresholds, and locking `ADR-001..003` before `to-spec`. | `WF-SUB-01..07` | `resolved` |

## Resolved in `WF-SUB-08` & Transitioned to Phase `SPEC.md`

- **Tool Surface (`Q1`):** Unified `substrate.valve` + `substrate.viewport` primary tools with backwards-compatible delegating aliases (`archive.persist` and `ctx.context-prune`, plus direct `substrate` and `viewport` action entry points) and deterministic `sessionID` defaulting.
- **Auto-Watermark Threshold (`Q2`):** Hybrid activation combining explicit `substrate.valve` (`keepRecentSteps = 8`) and automatic `context` hook watermark activation at `65%` of the model window (`keepRecentSteps = 12`).
- **Cross-Harness Brief Packing (`Q3`):** Pure exported helper `buildImplementorViewportBrief(db, options)` packing Tier-1 `RepoMap`, Tier-2 `AstSkeleton`, Tier-3 `SymbolSlice`, and Tier-4 `CoChangeCoupling` warnings for `delegate-devin` and `hivemind-delegate`.

## Out of scope

- Mutating `~/.local/share/opencode/opencode.db` (always opened `{ readonly: true }`).
- External LLM API calls or vector embedding spend inside `hivemind-substrate` hooks.
- Native C++ Tree-sitter bindings or external `.wasm` files that break single-file Bun plugin distribution.
