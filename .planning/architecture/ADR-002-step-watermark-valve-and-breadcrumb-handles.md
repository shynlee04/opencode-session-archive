# ADR-002: Assistant Step-Watermark Pruning with Content-Addressed `FactBreadcrumb` Handles

- **Status:** `accepted` (approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md), verified by [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md) and [`SPEC-REVIEW`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md))
- **Date:** 2026-10-18
- **Spec Linkage:** [`E1.1/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md) (`REQ-SUB-07`, `REQ-SUB-08`), [`DEEP-MODULE-DESIGN.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/DEEP-MODULE-DESIGN.md)
- **Evidence:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Context

In [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115), both `"recent"` and `"initial"` modes slice `event.messages` at `findLastIndex(m => m.role === "user")`. During a 45-step single-prompt auto-run (`ses_eb2eabb14ffeCXsCwb845rtffb` `msg[45]`) or inside a delegated child session, 100% of tool calls sit after `msg[0]`, so `context-prune` frees `0` bytes. When it does prune (`ses_eb23bfbf0ffesn5kT0yJI06h35` `msg[123]`), replacing tool outputs with generic `"rerun the tool"` stubs triggers a 15-30 file panic re-read loop.

## Decision

1. Support hybrid assistant-step watermark slicing: explicit `substrate.valve` (`mode: "step-window"`, `keepRecentSteps = 8`, plus `"recent"` single-prompt auto-run fallback when `lastUserIndex <= activeStartIndex` and `assistantStepsAfterLastUser > 8`) and automatic `context` hook watermark activation when estimated input tokens exceed `65%` of the model window (`keepRecentSteps = 12`).
2. Enforce **Invariant 1 (No Blind Stub Erasure)** and **Invariant 5 (`< 2 ms` In-Memory `context` Hook)**: every thinned tool output is persisted in `.session-archive/blobs/<sha256>.txt` and replaced in memory with a structured `FactBreadcrumb` (`[Pruned <tool> <target> -> blob:<sha12> | <1-line summary> | status: FRESH — DO NOT REREAD; call substrate.viewport({ action: "resolve", blob: "<sha12>" }) if exact lines needed]`) accompanied by a `WorkingMemoryManifest`.

## Consequences & Verification Evidence

- Proved by replaying `session-bcad339b` (`msg[45]`, `309,544 -> 99,507` chars, `67.85%` reduction) and `session-a35adea6` (`msg[123]`, `374,929 -> 130,277` chars, `65.25%` reduction) in [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-valve.md) and [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md) (`0.015..0.034 ms` in-memory `context` hook latency).
