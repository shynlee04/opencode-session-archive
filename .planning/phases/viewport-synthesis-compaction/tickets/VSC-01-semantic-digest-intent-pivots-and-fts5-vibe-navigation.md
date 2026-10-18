---
kind: ticket
id: VSC-01
phase: viewport-synthesis-compaction
title: "Semantic session digest, 9-category IntentPivot categorization, and FTS5 vibe navigation"
status: done
type: feature
owner: implementer
spec_anchor: .planning/phases/viewport-synthesis-compaction/SPEC.md
requirements: [REQ-SUB-13]
spec_requirements: [REQ-SUB-13]
adr_anchors: [ADR-001]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-02, TWM-04]
write_lease: [src/viewports/semantic-digest.ts, src/viewports/index.ts, test/semantic-digest.test.ts]
file_surface: [src/viewports/semantic-digest.ts, src/viewports/index.ts, test/semantic-digest.test.ts]
proves: "bun test test/semantic-digest.test.ts && bun run typecheck"
validation_grep: "VSC-01|queryVibeNavigation|classifyIntentPivot|session_semantic_digest @ test/semantic-digest.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# VSC-01: Semantic session digest, 9-category IntentPivot categorization, and FTS5 vibe navigation

## Requirements / user outcome

- **Requirements:** `REQ-SUB-13` ([.planning/phases/viewport-synthesis-compaction/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md))
- **ADRs:** `ADR-001`
- **Outcome:** src/viewports/semantic-digest.ts materializes session_semantic_digest, 9-category intent_pivot, and compound-token-expanded substrate_fts in index.sqlite, exposing queryVibeNavigation(db, { query, limit, maxTokens }) (< 600 tokens in < 5 ms) and renderIntentTimeline(db, sessionID) with lossless blob:<sha256> prompt hydration.

## Scope / non-goals

- **Included:** `src/viewports/semantic-digest.ts`, `src/viewports/index.ts`, `test/semantic-digest.test.ts`
- **Excluded (non-goals):**
  - Dense vector embeddings or external LLM calls during indexing.

## Blocked by

- `TWM-02`, `TWM-04`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/viewports/semantic-digest.ts`, `src/viewports/index.ts`, `test/semantic-digest.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/semantic-digest.test.ts && bun run typecheck`
- **Failing direction (RED):** user prompts are not classified into the 9 IntentPivot categories, compound tokens (wave2-slice1) fail FTS5 matching, or queryVibeNavigation exceeds 600 tokens or 5 ms.
- [x] REQ-SUB-13: classifyIntentPivot deterministically categorizes user prompts across all 9 categories (initial_goal, course_correction, approval, handoff_resume, prune_or_continuity, followup, verification_directive, scope_narrowing, continuation_after_compaction).
- [x] REQ-SUB-13: queryVibeNavigation resolves natural-language queries (including compound tokens like wave2-slice1) to the ranked root session and renders a < 600-token StrategistViewport digest in < 5.0 ms.
- [x] Verification: bun test test/semantic-digest.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Calling substrate.viewport({ action: "search", query: "..." }) and substrate.viewport({ action: "timeline" }) locates sessions by meaning without opaque ses_... IDs.
- **Gate status:** `ENGINEERING_VERIFIED` · `UAT_PENDING` (automated gate verified; owner UAT pending).
