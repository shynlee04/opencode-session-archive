---
kind: ticket
id: VSC-03
phase: viewport-synthesis-compaction
title: "Exported cross-harness child delegation brief helper buildImplementorViewportBrief"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/viewport-synthesis-compaction/SPEC.md
requirements: [REQ-SUB-18]
spec_requirements: [REQ-SUB-18]
adr_anchors: [ADR-003]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [CSG-02, CSG-03, VSC-02]
write_lease: [src/viewports/brief.ts, src/viewports/index.ts, test/brief.test.ts]
file_surface: [src/viewports/brief.ts, src/viewports/index.ts, test/brief.test.ts]
proves: "bun test test/brief.test.ts && bun run typecheck"
validation_grep: "VSC-03|buildImplementorViewportBrief @ test/brief.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# VSC-03: Exported cross-harness child delegation brief helper buildImplementorViewportBrief

## Requirements / user outcome

- **Requirements:** `REQ-SUB-18` ([.planning/phases/viewport-synthesis-compaction/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md))
- **ADRs:** `ADR-003`
- **Outcome:** src/viewports/brief.ts exports pure deterministic buildImplementorViewportBrief(db, options) packing Tier-1 RepoMap context, Tier-2 AstSkeleton outlines for leased files, Tier-3 SymbolSlice spans for focus symbols, Tier-4 CoChangeCoupling alerts (has_static_edge = 0), and active ProvenanceChain constraints within a bounded token budget (default 1,500 tokens).

## Scope / non-goals

- **Included:** `src/viewports/brief.ts`, `src/viewports/index.ts`, `test/brief.test.ts`
- **Excluded (non-goals):**
  - Mutating child session state directly inside buildImplementorViewportBrief.

## Blocked by

- `CSG-02`, `CSG-03`, `VSC-02`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/viewports/brief.ts`, `src/viewports/index.ts`, `test/brief.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/brief.test.ts && bun run typecheck`
- **Failing direction (RED):** buildImplementorViewportBrief omits Tier-1..4 structural context or provenance constraints, fails to accept alias options (writeLeasePaths, focusSymbols, projectRoot, maxTokensBudget), or exceeds maxTokens.
- [ ] REQ-SUB-18: buildImplementorViewportBrief accepts both canonical (targetPaths, symbolNames, rootDir, maxTokens) and alias (writeLeasePaths, focusSymbols, projectRoot, maxTokensBudget, goal, verificationCommand) option shapes.
- [ ] REQ-SUB-18: Output includes Tier-1 RepoMap, Tier-2 AstSkeleton, Tier-3 SymbolSlice (when symbols specified), Tier-4 CoChangeCoupling warnings (has_static_edge = 0), and ProvenanceChain constraints within maxTokens (default 1,500) in < 5.0 ms.
- [ ] Verification: bun test test/brief.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Parent orchestrators and delegate-devin / hivemind-delegate callers generate bounded 4-tier Implementor briefs in < 5 ms.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
