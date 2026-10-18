---
kind: ticket
id: TWM-05
phase: trajectory-working-memory
title: "Hybrid assistant step-watermark WorkingSetValve, < 2 ms in-memory context hook, FactBreadcrumbs, and WorkingMemoryManifest"
status: done
type: feature
owner: implementer
spec_anchor: .planning/phases/trajectory-working-memory/SPEC.md
requirements: [REQ-SUB-07, REQ-SUB-08]
spec_requirements: [REQ-SUB-07, REQ-SUB-08]
adr_anchors: [ADR-002]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-02]
write_lease: [src/archive/valve.ts, src/viewports/index.ts, test/valve.test.ts]
file_surface: [src/archive/valve.ts, src/viewports/index.ts, test/valve.test.ts]
proves: "bun test test/valve.test.ts && bun run typecheck"
validation_grep: "TWM-05|computeStepWatermark|FactBreadcrumb|WorkingMemoryManifest|applyContextHookInMemory @ test/valve.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# TWM-05: Hybrid assistant step-watermark WorkingSetValve, < 2 ms in-memory context hook, FactBreadcrumbs, and WorkingMemoryManifest

## Requirements / user outcome

- **Requirements:** `REQ-SUB-07`, `REQ-SUB-08` ([.planning/phases/trajectory-working-memory/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **ADRs:** `ADR-002`
- **Outcome:** src/archive/valve.ts (re-exported via src/viewports/index.ts) implements computeStepWatermark, armValve, and applyContextHookInMemory supporting explicit step-window pruning (keepRecentSteps = 8, plus recent-mode auto-run fallback when lastUserIndex <= activeStartIndex and assistantStepsAfterLastUser > K) and automatic context hook watermark activation at 65% of the model window (keepRecentSteps = 12), replacing thinned tool outputs in < 2 ms strictly in memory with content-addressed FactBreadcrumbs and a WorkingMemoryManifest.

## Scope / non-goals

- **Included:** `src/archive/valve.ts`, `src/viewports/index.ts`, `test/valve.test.ts`
- **Excluded (non-goals):**
  - Performing synchronous SQLite or filesystem writes inside applyContextHookInMemory.

## Blocked by

- `TWM-02`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/archive/valve.ts`, `src/viewports/index.ts`, `test/valve.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/valve.test.ts && bun run typecheck`
- **Failing direction (RED):** single-prompt 45-step trajectories prune 0 bytes in recent or step-window mode, thinned tool outputs lack blob:<sha12> FactBreadcrumbs, auto-watermark fails to activate at 65% context window (keepRecentSteps = 12), or applyContextHookInMemory exceeds 2.0 ms.
- [x] REQ-SUB-07: computeStepWatermark slices assistant steps prior to the last K = 8 steps on single-prompt trajectories and activates automatically with K = 12 when estimated input tokens exceed 65% of modelContextWindowTokens.
- [x] REQ-SUB-07: KEEP_RESULT (subagent, task, delegate-devin, hivemind-delegate) outputs and KEEP_INPUT (read, write, edit) inputs are preserved while other old tool inputs/outputs are shape-preservingly thinned.
- [x] REQ-SUB-08: Every thinned tool output is replaced with a FactBreadcrumb carrying blob:<sha12>, 1-line summary, and FRESH — DO NOT REREAD vs STALE status, plus a WorkingMemoryManifest.
- [x] REQ-SUB-08: applyContextHookInMemory executes in < 2.0 ms median with zero disk or SQLite I/O.
- [x] Verification: bun test test/valve.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Long 45+ step single-prompt turns prune >60% of historical tool output characters without triggering panic re-read storms.
- **Gate status:** `ENGINEERING_VERIFIED` · `UAT_PENDING` (automated gate verified; owner UAT pending).
