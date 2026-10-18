---
kind: ticket
id: CSG-03
phase: codebase-structural-graph
title: "Git temporal co-change matrix and hidden cross-boundary coupling alerts"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/codebase-structural-graph/SPEC.md
requirements: [REQ-SUB-12]
spec_requirements: [REQ-SUB-12]
adr_anchors: [ADR-003]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [CSG-01]
write_lease: [src/honeycomb/cochange.ts, src/honeycomb/index.ts, test/pagerank-cochange.test.ts]
file_surface: [src/honeycomb/cochange.ts, src/honeycomb/index.ts, test/pagerank-cochange.test.ts]
proves: "bun test test/pagerank-cochange.test.ts && bun run typecheck"
validation_grep: "CSG-03|mineGitCochange|queryCochangeCouplings @ test/pagerank-cochange.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# CSG-03: Git temporal co-change matrix and hidden cross-boundary coupling alerts

## Requirements / user outcome

- **Requirements:** `REQ-SUB-12` ([.planning/phases/codebase-structural-graph/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/codebase-structural-graph/SPEC.md))
- **ADRs:** `ADR-003`
- **Outcome:** src/honeycomb/cochange.ts mines git log -n 500 (excluding bulk commits touching > 15 files) into git_cochange, git_cochange_file_stats, and git_cochange_commit (< 150 ms full, < 15 ms incremental with commit-SHA deduplication), computes asymmetric P(A|B) and Jaccard similarity, cross-references code_import_edge to set has_static_edge (0 vs 1), and surfaces hidden cross-boundary couplings via queryCochangeCouplings.

## Scope / non-goals

- **Included:** `src/honeycomb/cochange.ts`, `src/honeycomb/index.ts`, `test/pagerank-cochange.test.ts`
- **Excluded (non-goals):**
  - Full-history git blame scans on every request.

## Blocked by

- `CSG-01`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/honeycomb/cochange.ts`, `src/honeycomb/index.ts`, `test/pagerank-cochange.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/pagerank-cochange.test.ts && bun run typecheck`
- **Failing direction (RED):** commits touching > 15 files pollute co-change counts, incremental HEAD~1..HEAD mining double-counts already-indexed commit SHAs, or hidden couplings (has_static_edge = 0) are not flagged.
- [ ] REQ-SUB-12: mineGitCochange skips commits with > 15 touched files and skips already-indexed commit SHAs idempotently on incremental runs.
- [ ] REQ-SUB-12: queryCochangeCouplings returns asymmetric P(partner|target), Jaccard similarity, has_static_edge (0 vs 1), and recent shared commit subjects, highlighting hidden couplings where has_static_edge = 0.
- [ ] Verification: bun test test/pagerank-cochange.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Calling substrate.viewport({ action: "coupled", path: "..." }) surfaces hidden behavioral partners with 0 static import edges.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
