# ADR-001: Unify Session Archive, Context Prune & Compaction Continuity into a Three-Layer Context Substrate

- **Status:** `proposed` (awaiting `WF-SUB-01..07` prototype evidence and `WF-SUB-08` owner grill gate)
- **Date:** 2026-10-18
- **Evidence:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Context

Running `opencode-session-archive`, `opencode-context-prune`, and `compaction-continuity` as three separate plugins caused direct operational failures in [`session-bcad339b`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) and [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json):
1. `session-archive` writes `.session-archive/index.sqlite` and `blobs/<sha256>.txt` keyed by opaque `ses_...` IDs, with zero read/query tools or semantic digests.
2. `context-prune` wipes tool outputs to generic `"rerun the tool"` stubs without linking to `.session-archive/blobs/<sha256>.txt` or recording a `WorkingMemoryManifest`.
3. `compaction-continuity` writes separate `.opencode/compaction-history/*.jsonl` files and fails when called without an explicit `sessionID`.

## Decision Proposal

Consolidate all three prototypes into a single self-contained OpenCode V2 plugin (`hivemind-substrate`) organized around three storage tiers (**The Spine**, **The Honeycomb**, **The Artifacts**) and two role viewports (**Strategist Viewport** and **Implementor Viewport**), exposed via passive lifecycle hooks (`context`, `compaction`, `session.status`) and two action-multiplexed tools (`substrate` and `viewport`).

## Consequences & Prototype Gate

- Must be proved via prototypes [`WF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-01-semantic-session-digest-and-vibe-navigation.md), [`WF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-03-spine-kv-snapshot-and-spill-ingestion.md), [`WF-SUB-04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-04-incremental-sync-and-hook-latency-budget.md), and [`WF-SUB-07`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-07-compaction-continuity-and-provenance-reconciler.md) before locking.
