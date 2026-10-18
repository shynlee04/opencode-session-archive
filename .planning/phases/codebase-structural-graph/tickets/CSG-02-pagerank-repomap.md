---
kind: ticket
id: CSG-02
phase: codebase-structural-graph
title: "Iterative Float64Array CSR PageRank and < 1,000-token Tier-1 RepoMap"
status: done
type: feature
owner: implementer
spec_anchor: .planning/phases/codebase-structural-graph/SPEC.md
requirements: [REQ-SUB-11]
spec_requirements: [REQ-SUB-11]
adr_anchors: [ADR-003]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [CSG-01]
write_lease: [src/honeycomb/pagerank.ts, src/honeycomb/index.ts, test/pagerank-cochange.test.ts]
file_surface: [src/honeycomb/pagerank.ts, src/honeycomb/index.ts, test/pagerank-cochange.test.ts]
proves: "bun test test/pagerank-cochange.test.ts && bun run typecheck"
validation_grep: "CSG-02|computeCodebasePageRank|renderRepoMap @ test/pagerank-cochange.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# CSG-02: Iterative Float64Array CSR PageRank and < 1,000-token Tier-1 RepoMap

## Requirements / user outcome

- **Requirements:** `REQ-SUB-11` ([.planning/phases/codebase-structural-graph/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/codebase-structural-graph/SPEC.md))
- **ADRs:** `ADR-003`
- **Outcome:** src/honeycomb/pagerank.ts computes 20-iteration damped PageRank (d = 0.85, sink redistribution, SUM(pagerank) = 1.0, < 2 ms solve) over code_file and non-self code_import_edge using Float64Array CSR arrays, persists code_file.pagerank, and renders a < 1,000-token Tier-1 RepoMap ordered by descending PageRank and caller-weighted symbol importance.

## Scope / non-goals

- **Included:** `src/honeycomb/pagerank.ts`, `src/honeycomb/index.ts`, `test/pagerank-cochange.test.ts`
- **Excluded (non-goals):**
  - External graph database dependencies.

## Blocked by

- `CSG-01`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/honeycomb/pagerank.ts`, `src/honeycomb/index.ts`, `test/pagerank-cochange.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/pagerank-cochange.test.ts && bun run typecheck`
- **Failing direction (RED):** 20-iteration PageRank scores do not sum to 1.0, solve latency exceeds 2 ms, or renderRepoMap exceeds the 1,000-token budget.
- [x] REQ-SUB-11: computeCodebasePageRank converges in 20 iterations in < 2.0 ms with Math.abs(sum - 1.0) < 1e-6.
- [x] REQ-SUB-11: renderRepoMap formats top PageRank modules and exported symbols with [Lstart-Lend] spans within budgetTokens (default 1,000 tokens) in < 5.0 ms.
- [x] Verification: bun test test/pagerank-cochange.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Calling substrate.viewport({ action: "repomap" }) returns a < 1,000-token topological map of the repository.
- **Gate status:** `ENGINEERING_VERIFIED` · `UAT_PENDING` (automated gate verified; owner UAT pending).
