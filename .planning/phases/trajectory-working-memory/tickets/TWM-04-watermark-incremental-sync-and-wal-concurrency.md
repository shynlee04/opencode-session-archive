---
kind: ticket
id: TWM-04
phase: trajectory-working-memory
title: "Watermark-gated incremental SQLite sync and BEGIN IMMEDIATE WAL concurrency"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/trajectory-working-memory/SPEC.md
requirements: [REQ-SUB-06]
spec_requirements: [REQ-SUB-06]
adr_anchors: [ADR-001]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-01, TWM-02, TWM-03]
write_lease: [src/archive/index.ts, src/archive/index-db.ts, src/spine/index.ts, test/persist.test.ts]
file_surface: [src/archive/index.ts, src/archive/index-db.ts, src/spine/index.ts, test/persist.test.ts]
proves: "bun test test/persist.test.ts && bun run typecheck"
validation_grep: "TWM-04|sync_watermark|incremental|WAL @ test/persist.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# TWM-04: Watermark-gated incremental SQLite sync and BEGIN IMMEDIATE WAL concurrency

## Requirements / user outcome

- **Requirements:** `REQ-SUB-06` ([.planning/phases/trajectory-working-memory/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **ADRs:** `ADR-001`
- **Outcome:** persist() and syncSessionTreeIncremental maintain per-session monotonic watermarks in sync_watermark(session_id, root_id, last_time_updated, last_max_seq, last_message_id, last_kv_updated, synced_at), skip unchanged sessions in < 2 ms, fetch and normalize only delta messages (seq > last_max_seq) in < 150 ms, and execute all SQLite writes inside BEGIN IMMEDIATE transactions with PRAGMA journal_mode = WAL, PRAGMA synchronous = NORMAL, and PRAGMA busy_timeout = 5000.

## Scope / non-goals

- **Included:** `src/archive/index.ts`, `src/archive/index-db.ts`, `src/spine/index.ts`, `test/persist.test.ts`
- **Excluded (non-goals):**
  - Running SQLite sync inside the synchronous context hook.

## Blocked by

- `TWM-01`, `TWM-02`, `TWM-03`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/archive/index.ts`, `src/archive/index-db.ts`, `src/spine/index.ts`, `test/persist.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/persist.test.ts && bun run typecheck`
- **Failing direction (RED):** persist() re-reads or re-normalizes already-synced messages when seq <= last_max_seq, exceeds 150 ms on a 1-turn delta, or fails under concurrent WAL readers/writers.
- [ ] REQ-SUB-06: No-op incremental sync on an unchanged session tree completes in < 2 ms with 0 message rows fetched.
- [ ] REQ-SUB-06: 1-turn incremental delta sync fetches only seq > last_max_seq messages, appends to the session JSONL, updates index.sqlite, and advances sync_watermark in < 150 ms.
- [ ] REQ-SUB-06: 50 concurrent read/write operations against index.sqlite in WAL mode complete with 0 SQLITE_BUSY errors.
- [ ] Verification: bun test test/persist.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Idle and compaction background syncs update .session-archive/index.sqlite incrementally in a few milliseconds without blocking the host.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
