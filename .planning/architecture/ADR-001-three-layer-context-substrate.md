# ADR-001: Unify Session Archive, Context Prune & Compaction Continuity into a Three-Layer Context Substrate

- **Status:** `accepted` (approved in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md), verified by [`WF-SUB-01..07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/MAP-HIVEMIND-SUBSTRATE.md) and [`SPEC-REVIEW`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md))
- **Date:** 2026-10-18
- **Spec Linkage:** [`E1.1/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md) (`REQ-SUB-01..06`), [`E1.3/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md) (`REQ-SUB-13..18`), [`DEEP-MODULE-DESIGN.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/DEEP-MODULE-DESIGN.md)
- **Evidence:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Context

Running `opencode-session-archive`, `opencode-context-prune`, and `compaction-continuity` as three separate plugins caused direct operational failures in [`session-bcad339b`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) and [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json):
1. `session-archive` writes `.session-archive/index.sqlite` and `blobs/<sha256>.txt` keyed by opaque `ses_...` IDs, with zero read/query tools or semantic digests.
2. `context-prune` wipes tool outputs to generic `"rerun the tool"` stubs without linking to `.session-archive/blobs/<sha256>.txt` or recording a `WorkingMemoryManifest`.
3. `compaction-continuity` writes separate `.opencode/compaction-history/*.jsonl` files and fails when called without an explicit `sessionID`.

## Decision

Consolidate all three prototypes into a single self-contained OpenCode V2 plugin (`hivemind-substrate`) organized around three storage tiers (**The Spine**, **The Honeycomb**, **The Artifacts**) and two role viewports (**Strategist Viewport** and **Implementor Viewport**), exposed via passive lifecycle hooks (`context`, `compaction`, `session.status`) and two primary tools under the `substrate` namespace (`substrate.valve` and `substrate.viewport`) with backwards-compatible delegating aliases (`archive.persist` and `ctx.context-prune`, plus direct `substrate` and `viewport` action entry points).

## Consequences & Verification Evidence

- Verified by prototypes [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md), [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md), [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md), and [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md).
- Approved by owner in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) (`Q1..Q3`) and independently reviewed in [`SPEC-REVIEW.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md).
