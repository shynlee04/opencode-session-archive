---
kind: ticket
id: VSC-02
phase: viewport-synthesis-compaction
title: "ProvenanceChain causal graph, < 2 ms live staleness reconciler, default sessionID resolution, and CompactionContinuationPacket"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/viewport-synthesis-compaction/SPEC.md
requirements: [REQ-SUB-14, REQ-SUB-15, REQ-SUB-16]
spec_requirements: [REQ-SUB-14, REQ-SUB-15, REQ-SUB-16]
adr_anchors: [ADR-001, ADR-002]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-05, CSG-02, CSG-03, VSC-01]
write_lease: [src/viewports/continuity.ts, src/viewports/index.ts, test/continuity.test.ts]
file_surface: [src/viewports/continuity.ts, src/viewports/index.ts, test/continuity.test.ts]
proves: "bun test test/continuity.test.ts && bun run typecheck"
validation_grep: "VSC-02|resolveDefaultSessionId|reconcileProvenanceStaleness|buildCompactionContinuationPacket @ test/continuity.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# VSC-02: ProvenanceChain causal graph, < 2 ms live staleness reconciler, default sessionID resolution, and CompactionContinuationPacket

## Requirements / user outcome

- **Requirements:** `REQ-SUB-14`, `REQ-SUB-15`, `REQ-SUB-16` ([.planning/phases/viewport-synthesis-compaction/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md))
- **ADRs:** `ADR-001`, `ADR-002`
- **Outcome:** src/viewports/continuity.ts implements 3-tier resolveDefaultSessionId, < 2 ms reconcileProvenanceStaleness comparing recorded read_blob_sha and repair_blob_sha against live disk SHA-256 hashes, and buildCompactionContinuationPacket synthesizing a deterministic < 1,200-token post-compaction brief into compaction_continuation_ledger (retiring .opencode/compaction-history/*.jsonl).

## Scope / non-goals

- **Included:** `src/viewports/continuity.ts`, `src/viewports/index.ts`, `test/continuity.test.ts`
- **Excluded (non-goals):**
  - Writing .opencode/compaction-history/*.jsonl files.

## Blocked by

- `TWM-05`, `CSG-02`, `CSG-03`, `VSC-01`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/viewports/continuity.ts`, `src/viewports/index.ts`, `test/continuity.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/continuity.test.ts && bun run typecheck`
- **Failing direction (RED):** omitted sessionID fails to resolve via explicit_input -> hook_context -> sqlite_latest_root, modified workspace files stay FRESH in file_read_ledger or provenance_chain, or buildCompactionContinuationPacket exceeds 1,200 tokens.
- [ ] REQ-SUB-16: resolveDefaultSessionId resolves omitted sessionID via explicit_input -> hook_context -> sqlite_latest_root without throwing Specify action and sessionID.
- [ ] REQ-SUB-14: reconcileProvenanceStaleness transitions modified files from FRESH — DO NOT REREAD to STALE (modified since read/review — re-verify slice) and provenance chains from verified_pass to verified_stale_by_later_touch in < 2.0 ms.
- [ ] REQ-SUB-15: buildCompactionContinuationPacket synthesizes all 6 sections (Headline & Gate, Intent Pivot Timeline, Working-Memory Manifest, Delegation Trajectory, Provenance Chain, Tier-1 RepoMap & Co-Change Alerts) under 1,200 tokens and writes zero files under .opencode/.
- [ ] Verification: bun test test/continuity.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Compaction events inject the < 1,200-token CompactionContinuationPacket automatically and tool calls without sessionID succeed.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
