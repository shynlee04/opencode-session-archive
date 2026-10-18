---
kind: ticket
id: TWM-03
phase: trajectory-working-memory
title: "Shadow snapshot Git tree blob sinking and external tool-output/shell spill capture"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/trajectory-working-memory/SPEC.md
requirements: [REQ-SUB-05]
spec_requirements: [REQ-SUB-05]
adr_anchors: [ADR-001]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-02]
write_lease: [src/archive/snapshots.ts, src/archive/spills.ts, src/archive/index-db.ts, src/archive/types.ts, src/spine/index.ts, test/snapshots-spills.test.ts]
file_surface: [src/archive/snapshots.ts, src/archive/spills.ts, src/archive/index-db.ts, src/archive/types.ts, src/spine/index.ts, test/snapshots-spills.test.ts]
proves: "bun test test/snapshots-spills.test.ts && bun run typecheck"
validation_grep: "TWM-03|snapshot_artifact|spill_artifact @ test/snapshots-spills.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# TWM-03: Shadow snapshot Git tree blob sinking and external tool-output/shell spill capture

## Requirements / user outcome

- **Requirements:** `REQ-SUB-05` ([.planning/phases/trajectory-working-memory/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **ADRs:** `ADR-001`
- **Outcome:** sinkShadowSnapshots extracts uncommitted file drafts from OpenCode shadow Git bare repositories via a 1-pass git --git-dir=<shadowRepo> cat-file --batch pipeline with gitBlobSha -> sha256 memoization into blobs/<sha256>.txt and snapshot_artifact; sinkExternalSpills captures untruncated tool and shell outputs from state.metadata.outputPath, inline shell spill markers, tool-output/tool_<callID>, and shell/<callID>.txt into blobs/<sha256>.txt and spill_artifact.

## Scope / non-goals

- **Included:** `src/archive/snapshots.ts`, `src/archive/spills.ts`, `src/archive/index-db.ts`, `src/archive/types.ts`, `src/spine/index.ts`, `test/snapshots-spills.test.ts`
- **Excluded (non-goals):**
  - Running git gc or mutating the host shadow snapshot bare repository.

## Blocked by

- `TWM-02`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/archive/snapshots.ts`, `src/archive/spills.ts`, `src/archive/index-db.ts`, `src/archive/types.ts`, `src/spine/index.ts`, `test/snapshots-spills.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/snapshots-spills.test.ts && bun run typecheck`
- **Failing direction (RED):** uncommitted file drafts in shadow Git bare repos (start_tree/end_tree) or external tool-output/shell spill files are not sunk into .session-archive/blobs/<sha256>.txt and indexed in snapshot_artifact and spill_artifact.
- [ ] REQ-SUB-05: sinkShadowSnapshots recovers start_tree:path and end_tree:path blobs from a bare Git repo in 1 batch pass, deduplicating identical Git blob SHAs and writing snapshot_artifact rows.
- [ ] REQ-SUB-05: sinkExternalSpills captures full external tool-output and shell spill files into blobs/<sha256>.txt and records inline_byte_len vs full_byte_len in spill_artifact.
- [ ] Verification: bun test test/snapshots-spills.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Uncommitted SPEC.md or source drafts from interrupted child sessions and >50 KB spilled tool outputs are recoverable from .session-archive/blobs/<sha256>.txt via snapshot_artifact and spill_artifact.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
