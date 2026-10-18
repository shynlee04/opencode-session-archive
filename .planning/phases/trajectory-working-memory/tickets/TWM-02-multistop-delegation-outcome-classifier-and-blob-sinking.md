---
kind: ticket
id: TWM-02
phase: trajectory-working-memory
title: "Multi-stop DelegationTurn lineage, ReportedOutcome vs VerifiedOutcome classifier, and full message blob sinking"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/trajectory-working-memory/SPEC.md
requirements: [REQ-SUB-03, REQ-SUB-04]
spec_requirements: [REQ-SUB-03, REQ-SUB-04]
adr_anchors: [ADR-001, ADR-002]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-01]
write_lease: [src/archive/normalize.ts, src/archive/index-db.ts, src/archive/types.ts, src/honeycomb/index.ts, test/normalize.test.ts]
file_surface: [src/archive/normalize.ts, src/archive/index-db.ts, src/archive/types.ts, src/honeycomb/index.ts, test/normalize.test.ts]
proves: "bun test test/normalize.test.ts && bun run typecheck"
validation_grep: "TWM-02|delegation_turn|classifyMessagesOutcome|file_read_ledger|skill_load_ledger @ test/normalize.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# TWM-02: Multi-stop DelegationTurn lineage, ReportedOutcome vs VerifiedOutcome classifier, and full message blob sinking

## Requirements / user outcome

- **Requirements:** `REQ-SUB-03`, `REQ-SUB-04` ([.planning/phases/trajectory-working-memory/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **ADRs:** `ADR-001`, `ADR-002`
- **Outcome:** normalize.ts sinks user prompt text, skill loads, and shell outputs into content-addressed .session-archive/blobs/<sha256>.txt files with blob:<sha256> handles; populates file_read_ledger (PRIMARY KEY (session_id, path)) and skill_load_ledger (PRIMARY KEY (session_id, skill_name)); segments child sessions across idle boundaries into delegation_turn keyed by (parent_session_id, call_id, turn_index) (while preserving the delegation summary table); and classifies reported_outcome vs verified_outcome (clean, tool_error_inside, blocked_in_text, verified_pass, verified_fail).

## Scope / non-goals

- **Included:** `src/archive/normalize.ts`, `src/archive/index-db.ts`, `src/archive/types.ts`, `src/honeycomb/index.ts`, `test/normalize.test.ts`
- **Excluded (non-goals):**
  - Modifying host session_message rows.

## Blocked by

- `TWM-01`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/archive/normalize.ts`, `src/archive/index-db.ts`, `src/archive/types.ts`, `src/honeycomb/index.ts`, `test/normalize.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/normalize.test.ts && bun run typecheck`
- **Failing direction (RED):** normalizeUser drops human prompt text instead of sinking to blobs/<sha256>.txt, multi-turn child continuations overwrite Turn 0 in delegation_turn, or false-positive idle.outcome = succeeded turns with inner tool errors are not flagged as tool_error_inside or blocked_in_text.
- [ ] REQ-SUB-03: delegation_turn stores every spawn and send/continue stop keyed by (parent_session_id, call_id, turn_index) without overwriting prior turns on the same child_session_id.
- [ ] REQ-SUB-03: classifyMessagesOutcome detects 100% of false-positive idle.outcome = succeeded child turns containing inner tool errors, permission/lease denials, MCP init timeouts, or explicit BLOCKED markers.
- [ ] REQ-SUB-04: normalizeUser sinks human prompt text (data.text or text parts) into blobs/<sha256>.txt and emits text_ref: blob:<sha256> alongside a preview.
- [ ] REQ-SUB-04: file_read_ledger and skill_load_ledger record deduplicated per-session file reads and skill loads with blob_sha / read_blob_sha and skill_blob_sha.
- [ ] Verification: bun test test/normalize.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Querying delegation_turn and session records in .session-archive/index.sqlite shows all turns of multi-stop child sessions and flags false-positive Antigravity/Devin completions.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
