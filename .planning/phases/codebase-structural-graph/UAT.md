---
kind: uat
phase: codebase-structural-graph
engineering: ENGINEERING_VERIFIED
acceptance: UAT_PENDING
candidate: de42f87
snapshot: dist/session-archive.ts
updated: 2026-10-18T20:46:00+07:00
---

# UAT: Phase E1.2 Codebase Structural Graph

## Engineering evidence

| Check | Command | Result |
|---|---|---|
| Repository gate | `bun test && bun run typecheck && bun run build` | `128 pass, 1 skip, 0 fail (2,160 expect() calls)` · `tsc --noEmit` clean · `dist/session-archive.ts` (`341,139` bytes) |
| CSG-01 gate | `bun test test/ast-skeleton.test.ts` | `5 pass, 0 fail` (`Bun.Transpiler` + Depth-2 closure-factory AST skeletonizer, `89.09%` token compression, `< 30 ms` warm parse) |
| CSG-02 & CSG-03 gate | `bun test test/pagerank-cochange.test.ts` | `4 pass, 0 fail` (20-iter `Float64Array` CSR PageRank `< 1,000`-token `RepoMap` + `git log` hidden co-change coupling warnings) |

## How to start

1. Copy `dist/session-archive.ts` into `<project>/.opencode/plugins/session-archive.ts`.
2. Start or reload your OpenCode V2 session.

## Tests

### 1. Tier-1 PageRank `RepoMap` recall (REQ-SUB-11)

do: Call `substrate.viewport({ action: "repomap", maxTokens: 1000 })`.
expect: Returns a `< 1,000`-token ranked repository map ordering modules by import-graph PageRank and listing top exported symbols with `[Lstart-Lend]` line spans.
result: pending

### 2. Tier-2 Depth-2 `AstSkeleton` & Tier-3 `SymbolSlice` hydration (REQ-SUB-09, REQ-SUB-10)

do: Call `substrate.viewport({ action: "skeleton", path: "src/archive/valve.ts" })` followed by `substrate.viewport({ action: "slice", path: "src/archive/valve.ts", symbol: "computeStepWatermark" })`.
expect: `skeleton` returns the compressed signature outline (`>= 88%` token savings, including Depth-2 inner helpers inside large factory functions), and `slice` hydrates the exact `[Lstart-Lend]` source lines for the requested symbol.
result: pending

### 3. Tier-4 Git temporal co-change & hidden coupling alerts (REQ-SUB-12)

do: Call `substrate.viewport({ action: "coupled", path: "src/plugin.ts" })` (or on `src/devin-executable.ts` in `hivemind-steward-oc-devin-dev`).
expect: Lists historically co-changed files with asymmetric conditional probability `P(coupled | target)` and highlights `HIDDEN COUPLING` pairs where `has_static_edge = 0`.
result: pending

## Manual-only

- Interactive Implementor navigation preference for `skeleton` + `slice` over full-file `read` during live coding tasks: observed during real OpenCode V2 sessions.

## Dogfooding

- `substrate.viewport` structural actions (`repomap`, `skeleton`, `slice`, `coupled`) in the next feature implementation session.

## Summary

total: 3 · pass: 0 · issue: 0 · pending: 3 · skipped: 0 · blocked: 0

## Gaps
