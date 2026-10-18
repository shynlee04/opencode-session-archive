# WF-SUB-04: Watermark-Gated Incremental SQLite Sync Against the 2.15 GB Host DB

- **ID:** `WF-SUB-04`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** `WF-SUB-03`
- **Evidence Input:** [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Question

Can incremental watermark-gated synchronization (`WHERE session.time_updated > :last_sync_watermark`) keep `.session-archive/index.sqlite` and `blobs/` synchronized on `session.status` (`idle`) and `compaction` events in `< 150 ms` against the live `2.15 GB` `~/.local/share/opencode/opencode.db` without ever running in the per-call `context` hook?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-04-incremental-sync.ts`)

1. Benchmark full tree persistence vs watermark-gated delta persistence (`session.time_updated > watermark` and `session_message.rowid > last_rowid`) on `ses_eb23bfbf0ffesn5kT0yJI06h35` (`287` messages, `9` child sessions).
2. Verify that `bun:sqlite` WAL mode with `busy_timeout = 5000` handles concurrent read/write access across worktree lanes without `SQLITE_BUSY` failures.
