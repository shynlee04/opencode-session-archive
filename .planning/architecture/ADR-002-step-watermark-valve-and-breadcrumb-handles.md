# ADR-002: Assistant Step-Watermark Pruning with Content-Addressed `FactBreadcrumb` Handles

- **Status:** `proposed` (awaiting `WF-SUB-02` prototype evidence and `WF-SUB-08` owner grill gate)
- **Date:** 2026-10-18
- **Evidence:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Context

In [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115), both `"recent"` and `"initial"` modes slice `event.messages` at `findLastIndex(m => m.role === "user")`. During a 45-step single-prompt auto-run (`ses_eb2eabb14ffeCXsCwb845rtffb` `msg[45]`) or inside a delegated child session, 100% of tool calls sit after `msg[0]`, so `context-prune` frees `0` bytes. When it does prune (`ses_eb23bfbf0ffesn5kT0yJI06h35` `msg[123]`), replacing tool outputs with generic `"rerun the tool"` stubs triggers a 15-30 file panic re-read loop.

## Decision Proposal

1. Support assistant-step watermark slicing (`mode: "step-window"`, `keepRecentSteps: K`, default `K = 8`) so intra-turn auto-runs and child sessions can thin completed tool outputs prior to the last `K` assistant steps without requiring a new user message.
2. Enforce **Invariant 1 (No Blind Stub Erasure)**: every thinned tool output is persisted in `.session-archive/blobs/<sha256>.txt` and replaced with a structured `FactBreadcrumb` (`[Pruned <tool> <target> -> blob:<sha256> | <1-line summary> | status: FRESH — DO NOT REREAD; call substrate.resolve("blob:<sha256>") if exact lines needed]`) accompanied by a `WorkingMemoryManifest`.

## Consequences & Prototype Gate

- Must be proved by replaying `session-bcad339b` (`msg[45]`) and `session-a35adea6` (`msg[123]`) in prototype [`WF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-02-intra-turn-step-watermark-and-breadcrumb-handles.md).
