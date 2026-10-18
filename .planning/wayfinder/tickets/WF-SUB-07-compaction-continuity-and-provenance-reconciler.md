# WF-SUB-07: Unified Compaction Continuity & Provenance Chain Staleness Reconciler

- **ID:** `WF-SUB-07`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** `WF-SUB-01`, `WF-SUB-02`, `WF-SUB-03`, `WF-SUB-05`
- **Evidence Input:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Question

Can `hivemind-substrate` replace `.opencode/compaction-history/*.jsonl` with a SQLite-backed `compaction` hook that injects a deterministic `< 1,200`-token continuation packet (`WorkingMemoryManifest` + `intent_pivot` timeline + `delegation_turn` verified outcomes + `ProvenanceChain` staleness table + Tier-1 `RepoMap`) and defaults `sessionID` to the current session so post-compaction calls never fail with `"Specify action and sessionID"`?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-07-compaction-reconciler.ts`)

1. Prototype the unified `compaction` hook and `ProvenanceChain` table (`Finding -> Decision -> FileTouch/Commit -> VerificationReceipt`) over the 6 real compactions in [`.session-archive/index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite).
2. Verify that when a file's working-tree SHA diverges from the SHA recorded at a child review finding or earlier `read` call, the continuation packet flags that entry `STALE (modified since read/review)` while marking unchanged files `FRESH — DO NOT REREAD`.
