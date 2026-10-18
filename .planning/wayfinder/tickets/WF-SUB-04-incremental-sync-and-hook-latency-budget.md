# WF-SUB-04: Watermark-Gated Incremental SQLite Sync Against the 2.15 GB Host DB

- **ID:** `WF-SUB-04`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `resolved (prototype verified)`
- **Depends on:** `WF-SUB-03`
- **Evidence Input:** [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)
- **Prototype Artifacts:**
  - [`wf-sub-04-incremental-sync.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts)
  - [`wf-sub-04-incremental-sync.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.test.ts)
  - [`wf-sub-04-sync.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-sync.sqlite)

## Question

Can incremental watermark-gated synchronization (`WHERE session.time_updated > :last_sync_watermark`) keep `.session-archive/index.sqlite` and `blobs/` synchronized on `session.status` (`idle`) and `compaction` events in `< 150 ms` against the live `2.15 GB` `~/.local/share/opencode/opencode.db` without ever running in the per-call `context` hook?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-04-incremental-sync.ts`)

1. Benchmark full tree persistence vs watermark-gated delta persistence (`session.time_updated > watermark` and `session_message.seq > last_max_seq`) on `ses_eb23bfbf0ffesn5kT0yJI06h35` (`287` messages / `9` child sessions at archive checkpoint; `395` root messages / `21` child sessions / `745` total messages in live `opencode.db`) and `ses_ecbfc0f40ffenfykTrNGoMS6o1` (`509` root messages / `37` child sessions / `666` total messages).
2. Verify that `bun:sqlite` WAL mode with `busy_timeout = 5000` handles concurrent read/write access across worktree lanes without `SQLITE_BUSY` failures.

## Resolution & Measured Evidence

### 1. Watermark-Gated Incremental Sync Model (`principle-model-the-domain`)

[`syncSessionTreeIncremental`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L597-L1150) replaces full-tree table rebuilds (`DELETE FROM ... WHERE root_id = ?` in [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L362-L390)) with per-session monotonic watermarks in [`wf-sub-04-sync.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-sync.sqlite):

```sql
CREATE TABLE IF NOT EXISTS sync_watermark (
  session_id TEXT PRIMARY KEY,
  root_id TEXT,
  last_time_updated INTEGER,
  last_max_seq INTEGER,
  last_message_id TEXT,
  last_kv_updated INTEGER,
  synced_at TEXT
);
```

On each `session.status` (`idle`) or `compaction` trigger:
1. [`querySessionTreeFromHost`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L285-L355) resolves the root session and flattens its descendant tree in a single indexed recursive CTE against `session_v2` (`~0.18..0.43 ms` for `22` sessions).
2. Sessions with `session.time_updated <= watermark.last_time_updated` are skipped (`0` `session_message` reads, `0` shadow `git` spawns, `0` external spill checks).
3. Dirty sessions fetch only newly appended messages (`WHERE session_id = ? AND seq > :last_max_seq ORDER BY seq ASC`), normalize only the delta records, sink only delta shadow snapshots and external spills, and upsert into `wf-sub-04-sync.sqlite` within a single `BEGIN IMMEDIATE` WAL transaction.
4. When a child session receives a `kv` binding update (`turn`, `phase`, `confirmedModel`, `servingWitness`) without new child messages, `syncSessionTreeIncremental` updates `kv_binding` and `delegation_turn` metadata directly rather than re-reading or re-parsing historical parent messages.

### 2. Host `opencode.db` B-Tree Index & Record-Layout Limiter Analysis (`principle-explain-the-number`)

[`inspectHostQueryPlans`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L1343-L1407) inspected `~/.local/share/opencode/opencode.db` (`2,177,425,408` bytes = `2.18 GB` decimal / `2.03 GiB` binary; `904` rows in `session_v2`, `22,200` rows in `session_message`, `1,638` rows in `kv`) via `EXPLAIN QUERY PLAN`:

| Query Target | SQL Predicate | `EXPLAIN QUERY PLAN` Detail | Index Used | Measured Latency |
|---|---|---|---|---:|
| Root lookup | `SELECT * FROM session_v2 WHERE id = ?` | `SEARCH session_v2 USING INDEX sqlite_autoindex_session_v2_1 (id=?)` | `sqlite_autoindex_session_v2_1` | `~0.03 ms` |
| Child tree walk (CTE) | `JOIN tree t ON s.parent_id = t.id` | `SEARCH s USING INDEX session_v2_parent_idx (parent_id=?)` | `session_v2_parent_idx` | `~0.18 ms` (`22` sessions) |
| Full session messages | `WHERE session_id = ? ORDER BY seq` | `SEARCH session_message USING INDEX session_message_session_seq_idx (session_id=?)` | `session_message_session_seq_idx` | `~124.9 ms` (`745` rows, JSON parse) |
| Delta session messages | `WHERE session_id = ? AND seq > ? ORDER BY seq ASC` | `SEARCH session_message USING INDEX session_message_session_seq_idx (session_id=? AND seq>?)` | `session_message_session_seq_idx` | `~0.15 ms` (`5` rows) |
| Scoped KV watermark check | `WHERE key = ? AND time_updated > ?` | `SEARCH kv USING INDEX sqlite_autoindex_kv_1 (key=?)` | `sqlite_autoindex_kv_1` | `~0.79 ms` (`22` sessions) |
| Unscoped KV timestamp filter | `WHERE time_updated > ?` | `SCAN kv` (no secondary index on `kv.time_updated`) | **None (`SCAN kv`)** | `~30.2 ms` (`1,641` rows) |

**Limiter discoveries (`principle-explain-the-number`):**
1. **`kv` overflow-page limiter:** OpenCode's `kv` table (`CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)`) has no index on `time_updated`, and places `time_updated` *after* the `~140 KB` `value` column in SQLite's record format. Consequently, an unscoped `SELECT ... FROM kv WHERE time_updated > ?` performs a full `SCAN kv` across `1,641` rows and their 4 KB overflow page chains (`~30.2 ms`). Restricting KV watermark probes to exact primary-key lookups (`WHERE key = ? AND time_updated > ?`) for the sessions in the active tree uses `sqlite_autoindex_kv_1` and completes in **`~0.79 ms`** (`38x` faster).
2. **Cold baseline limiter:** Cold full-tree persistence on `ses_eb23bfbf0ffesn5kT0yJI06h35` (`424.97 ms` median) is bounded by reading and `JSON.parse`-ing `745` large `session_message.data` payloads (`~125 ms`) plus extracting `246` shadow snapshot file blobs via `git cat-file --batch` and writing `1,179` content-addressed blob files to disk (`~283 ms`).
3. **Incremental delta limiter:** During a 1-turn (`5`-message + `1`-KV update) incremental sync (`3.72 ms` median without snapshot files; `14.35 ms` median when extracting `5` modified snapshot blobs via `git cat-file --batch`), SQLite B-tree range seeks on `session_message_session_seq_idx (session_id=? AND seq>?)` take only `~0.15 ms`. When the turn includes uncommitted file edits in `Assistant.snapshot.files[]`, the limiter is the single `git cat-file --batch` subprocess spawn (`~10.6 ms`).

### 3. 7-Sample Interleaved Benchmark Results (`benchmark-checklist`)

[`runInterleavedBenchmark`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L1562-L1735) executed `7` interleaved rounds alternating treatment order (`A -> B -> C1 -> C2` on odd rounds, `C2 -> C1 -> B -> A` on even rounds) against the live read-only `2.18 GB` `~/.local/share/opencode/opencode.db` on macOS arm64 (Bun `v1.4.3`), plus the pinned `WF-SUB-04` archive checkpoint (`287` root messages, `9` child sessions = `10` sessions, `427` total messages):

| Treatment | Scope (`ses_eb23bfbf0ffesn5kT0yJI06h35`) | Samples | Median (`ms`) | Min..Max Range (`ms`) | Spread (`ms`) | Messages Processed | KV Rows Processed | Snapshots Extracted | SQLite Writes | Errors | Speedup vs Cold |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **A. Cold Full-Tree Sync** | Live tree (`22` sessions, `745` msgs) | 7 | **`424.97 ms`** | `389.89..444.55 ms` | `54.66 ms` | `745` | `27` | `246` | `2,776` | `0` | `1.0x` |
| **B. Warm Watermark No-Op Sync** | Live tree (`22` sessions, `0` new msgs) | 7 | **`1.90 ms`** | `1.22..4.79 ms` | `3.58 ms` | `0` | `0` | `0` | `0` | `0` | **`223.4x`** |
| **C1. Incremental 1-Turn (`5` msgs + `1` KV)** | Tail turn (`seq 4351..4399`, `6` tools) | 7 | **`3.72 ms`** | `3.10..13.74 ms` | `10.65 ms` | `5` | `1` | `0` | `17` | `0` | **`114.3x`** |
| **C2. Incremental 1-Turn (`5` msgs + `1` KV + `5` snapshots)** | Snapshot turn (`seq 4249..4281`, `SPEC.md` + `decisions.tsv`) | 7 | **`14.35 ms`** | `13.49..27.64 ms` | `14.15 ms` | `5` | `1` | `5` | `20` | `0` | **`29.6x`** |
| **Pinned Checkpoint Cold Baseline** | `287` root msgs, `9` children (`427` msgs) | 1 | **`220.89 ms`** | `220.89 ms` | `0.00 ms` | `427` | `11` | `191` | `1,724` | `0` | `1.0x` |
| **Pinned Checkpoint Warm No-Op** | `287` root msgs, `9` children (`0` new msgs) | 1 | **`1.29 ms`** | `1.29 ms` | `0.00 ms` | `0` | `0` | `0` | `0` | `0` | **`170.7x`** |
| **Pinned Checkpoint 1-Turn Delta** | `5` msgs (`seq 3152..3193`) + `1` KV + `1` snapshot | 1 | **`13.50 ms`** | `13.50 ms` | `0.00 ms` | `5` | `1` | `1` | `17` | `0` | **`16.4x`** |

All incremental sync treatments (`1.90 ms` no-op, `3.72 ms` 1-turn delta, `14.35 ms` 1-turn delta with shadow Git snapshot extraction) complete **`10x–40x` below the `< 150 ms` budget**.

### 4. Hook Lifecycle Separation (`SubstrateSyncCoordinator`)

[`SubstrateSyncCoordinator`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L1217-L1341) enforces `WF-SUB-R04` Invariant 5:
- **`onContextHook(sessionId, activeMessages)`:** Reads only the in-memory `workingSetBySession` map (`WorkingMemorySnapshot`) and computes the intra-turn step watermark (`keepRecentSteps = 8`) with **`0` SQLite queries** across `20` consecutive calls (`maxContextHookMs = 0.1035 ms`, `~0.0056 ms` median — well under the `< 2 ms` budget).
- **`onSessionStatus({ status: "running" | "busy" })`:** Ignored immediately (`0` SQLite queries).
- **`onSessionStatus({ status: "idle" })` & `onCompaction`:** Trigger `syncSessionTreeIncremental` (`4.11 ms` and `4.90 ms` respectively, `< 150 ms`) and refresh the in-memory `WorkingMemorySnapshot` for subsequent `context` hooks.

### 5. `bun:sqlite` WAL Concurrency Verification Across Worktree Lanes (`principle-prove-it-works`)

[`verifyWalConcurrency`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-04-incremental-sync.ts#L1409-L1538) configured `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;` on `wf-sub-04-sync.sqlite` and spawned **`4` concurrent OS child processes (`Bun.spawn`) plus `2` concurrent in-process connections (`Promise.all`)** executing interleaved `BEGIN IMMEDIATE` write transactions (`tx.immediate()`) and `SELECT` queries simultaneously:
- **Total interleaved operations:** `136` (`68` write transactions + `68` read queries across `6` concurrent lanes in `25.75 ms`).
- **`SQLITE_BUSY` errors:** **`0`** (`totalOtherErrors = 0`).
- **Architectural lesson (`principle-model-the-domain`):** Write transactions in WAL mode must use `BEGIN IMMEDIATE` (`db.transaction(fn).immediate()`) rather than deferred `BEGIN` (`SELECT` then `INSERT`). Upgrading a deferred read snapshot to a write lock after a concurrent connection commits triggers immediate `SQLITE_BUSY_SNAPSHOT` without consulting `busy_timeout`, whereas `BEGIN IMMEDIATE` acquires the write lock up front and honors `PRAGMA busy_timeout = 5000` while concurrent WAL readers proceed without blocking.

## Verification Receipt

- `bun scratch/prototypes/wf-sub-04-incremental-sync.ts` -> exit `0` (`wf-sub-04-sync.sqlite` populated with `60` sessions across `ses_eb23bfbf0ffesn5kT0yJI06h35` and `ses_ecbfc0f40ffenfykTrNGoMS6o1`, `1,411` messages, `99` KV bindings, `246` snapshot artifacts, `6` spills, `60` `sync_watermark` rows, `68` WAL concurrency probe rows).
- `bun test scratch/prototypes/wf-sub-04-incremental-sync.test.ts` -> `6 pass, 0 fail, 165 expect() calls` (`6.08 s`).
