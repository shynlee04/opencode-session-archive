# ADR-003: Zero-Dependency `Bun.Transpiler` + Depth-2 Closure Skeletonizer, PageRank RepoMap & Git Co-Change Graph

- **Status:** `accepted` (approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md), verified by [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md), [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md), and [`SPEC-REVIEW`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md))
- **Date:** 2026-10-18
- **Spec Linkage:** [`E1.2/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/codebase-structural-graph/SPEC.md) (`REQ-SUB-09..12`), [`E1.3/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md) (`REQ-SUB-18`), [`DEEP-MODULE-DESIGN.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/DEEP-MODULE-DESIGN.md)
- **Evidence:** [`WF-SUB-R03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md)

## Context

`hivemind-substrate` compiles via `bun build --target=bun` into a single-file OpenCode V2 plugin (`dist/session-archive.ts`). In this environment, `typescript@7.0.2` (`tsgo`) throws `Error: The JavaScript API for TypeScript 7.0 is not yet implemented`, and `web-tree-sitter` requires external `.wasm` assets. Furthermore, large modules in `hivemind-steward-oc-devin-dev` (such as [`src/delegation/native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts), `3,727` lines) place `77.5%` of their logic inside factory closures (`createNativeDelegationDriver`), which naive Depth-1 AST skeletonizers collapse into a single line.

## Decision

Build the Codebase Structural Memory layer using three zero-dependency, Bun-native engines (`+9.7 KB` total bundle footprint) and expose `buildImplementorViewportBrief(db, options)` for cross-harness child delegation:
1. **`Bun.Transpiler.scan()` + Depth-2 Closure-Factory Skeletonizer (`+4.2 KB`, `24.70 ms` warm parse for 51 files, `89.09%` token compression)** for Tier-2 (`AstSkeleton`) and Tier-3 (`SymbolSlice` `[Lstart-Lend]`) progressive disclosure.
2. **Pure-TS Iterative `Float64Array` PageRank (`+3.1 KB`, `0.216 ms`)** over the static import graph for Tier-1 (`RepoMap`, `910` tokens `< 1,000` budget).
3. **`git log` Temporal Co-Change Matrix (`+2.4 KB`, `99.82 ms` for 500 commits, `4.95 ms` incremental)** to surface hidden cross-file behavioral couplings (`has_static_edge = 0`, $P(A \mid B) \ge 0.30$, such as `src/devin-executable.ts <-> src/harness-antigravity.ts` at `66.7%`).

## Consequences & Verification Evidence

- Verified by prototypes [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md) and [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md).
- Approved by owner in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) (`Q3`) and independently reviewed in [`SPEC-REVIEW.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md).
