---
kind: ticket
id: TWM-01
phase: trajectory-working-memory
title: "Read-only host boundary, schema drift guard, and UTF-16BE kv binding ingestion"
status: done
type: feature
owner: implementer
spec_anchor: .planning/phases/trajectory-working-memory/SPEC.md
requirements: [REQ-SUB-01, REQ-SUB-02]
spec_requirements: [REQ-SUB-01, REQ-SUB-02]
adr_anchors: [ADR-001]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: []
write_lease: [src/archive/source.ts, src/archive/types.ts, src/archive/index-db.ts, src/spine/index.ts, test/helpers.ts, test/source.test.ts]
file_surface: [src/archive/source.ts, src/archive/types.ts, src/archive/index-db.ts, src/spine/index.ts, test/helpers.ts, test/source.test.ts]
proves: "bun test test/source.test.ts && bun run typecheck"
validation_grep: "TWM-01|host schema drift|kv_binding|kv_foreign_index @ test/source.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# TWM-01: Read-only host boundary, schema drift guard, and UTF-16BE kv binding ingestion

## Requirements / user outcome

- **Requirements:** `REQ-SUB-01`, `REQ-SUB-02` ([.planning/phases/trajectory-working-memory/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **ADRs:** `ADR-001`
- **Outcome:** sqliteSource(dbPath) opens opencode.db strictly with { readonly: true }, validates all required columns on project, session_v2, session_message, and kv upfront (throwing session-archive: host schema drift: <table>.<column> missing on drift), and exposes PK-bounded kv readers that decode both OpenCode v2.0.32 plugin:<utf16be-hex>:<logical_key> keys and v1 scoped (scope, name, value) rows into kv_binding, kv_foreign_index, and kv_context_prune in < 2 ms without scanning 140 KB overflow pages.

## Scope / non-goals

- **Included:** `src/archive/source.ts`, `src/archive/types.ts`, `src/archive/index-db.ts`, `src/spine/index.ts`, `test/helpers.ts`, `test/source.test.ts`
- **Excluded (non-goals):**
  - Mutating opencode.db or writing any files under .opencode/.
  - Full-table scans over kv without key/prefix or time_updated filters.

## Blocked by

- none (frontier root)

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/archive/source.ts`, `src/archive/types.ts`, `src/archive/index-db.ts`, `src/spine/index.ts`, `test/helpers.ts`, `test/source.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/source.test.ts && bun run typecheck`
- **Failing direction (RED):** sqliteSource omits readonly mode, fails to validate required project/session_v2/session_message/kv columns, or fails to decode UTF-16BE plugin:<hex>:bindings/<childSessionID> and delegate-mode/child/<childSessionID> rows into kv_binding, kv_foreign_index, and kv_context_prune.
- [x] REQ-SUB-01: sqliteSource opens the host DB with { readonly: true } and throws session-archive: host schema drift: <table>.<column> missing when any required column in project, session_v2, session_message, or kv is absent.
- [x] REQ-SUB-02: decodeKvKey decodes plugin:<utf16be-hex>:bindings/<childSessionID>, delegate-mode/child/<childSessionID>, and context-prune keys accurately into structured KvBindingRecord, KvForeignIndexRecord, and KvContextPruneRecord objects.
- [x] REQ-SUB-02: index-db.ts creates kv_binding, kv_foreign_index, and kv_context_prune tables and upserts decoded rows idempotently.
- [x] Verification: bun test test/source.test.ts && bun run typecheck pass with 0 errors.

## Runtime / UAT

- **Real journey:** Persisting a real or fixture OpenCode v2.0.32 session populates kv_binding and kv_foreign_index in .session-archive/index.sqlite with foreignSessionID, harness, turn, phase, and servingWitness.
- **Gate status:** `ENGINEERING_VERIFIED` · `UAT_PENDING` (automated gate verified; owner UAT pending).
