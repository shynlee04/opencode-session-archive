---
kind: ticket
id: VSC-04
phase: viewport-synthesis-compaction
title: "Unified two-tool plugin surface (substrate.valve + substrate.viewport), backwards-compatible aliases, lifecycle hooks, and single-file bundle gate"
status: todo
type: feature
owner: implementer
spec_anchor: .planning/phases/viewport-synthesis-compaction/SPEC.md
requirements: [REQ-SUB-17]
spec_requirements: [REQ-SUB-17]
adr_anchors: [ADR-001, ADR-002, ADR-003]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-04, TWM-05, VSC-01, VSC-02, VSC-03]
write_lease: [src/plugin.ts, test/plugin.test.ts]
file_surface: [src/plugin.ts, test/plugin.test.ts]
proves: "bun test test/plugin.test.ts && bun run typecheck && bun run build"
validation_grep: "VSC-04|substrate.valve|substrate.viewport|archive.persist|ctx.context-prune @ test/plugin.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# VSC-04: Unified two-tool plugin surface (substrate.valve + substrate.viewport), backwards-compatible aliases, lifecycle hooks, and single-file bundle gate

## Requirements / user outcome

- **Requirements:** `REQ-SUB-17` ([.planning/phases/viewport-synthesis-compaction/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/viewport-synthesis-compaction/SPEC.md))
- **ADRs:** `ADR-001`, `ADR-002`, `ADR-003`
- **Outcome:** src/plugin.ts registers substrate.valve (prune | status | reset) and substrate.viewport (status | resolve | timeline | provenance | sync | search | repomap | skeleton | slice | coupled | brief | intents | latest) plus compatibility aliases archive.persist, ctx.context-prune, substrate, and viewport; wires the < 2 ms in-memory context hook, SQLite-backed compaction hook, and session.status idle / session.compacted event subscribers; re-exports buildImplementorViewportBrief; and bundles cleanly into dist/session-archive.ts.

## Scope / non-goals

- **Included:** `src/plugin.ts`, `test/plugin.test.ts`
- **Excluded (non-goals):**
  - Adding external runtime npm dependencies to dist/session-archive.ts.

## Blocked by

- `TWM-04`, `TWM-05`, `VSC-01`, `VSC-02`, `VSC-03`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/plugin.ts`, `test/plugin.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/plugin.test.ts && bun run typecheck && bun run build`
- **Failing direction (RED):** src/plugin.ts fails to register substrate.valve, substrate.viewport, or compatibility aliases (archive.persist, ctx.context-prune, substrate, viewport), fails to wire context/compaction/event hooks, or fails bun run build.
- [ ] REQ-SUB-17: plugin.setup registers substrate.valve, substrate.viewport, archive.persist, ctx.context-prune, substrate, and viewport, all resolving omitted sessionID via resolveDefaultSessionId.
- [ ] REQ-SUB-17: context hook runs applyContextHookInMemory in < 2 ms; compaction hook appends CompactionContinuationPacket to event.prompt; event.subscribe triggers incremental sync on idle and session.compacted.
- [ ] REQ-SUB-17: bun run build produces self-contained dist/session-archive.ts leaving @opencode/plugin external.
- [ ] Verification: bun test && bun run typecheck && bun run build pass.

## Runtime / UAT

- **Real journey:** Loading dist/session-archive.ts in OpenCode V2 exposes substrate.valve, substrate.viewport, and legacy aliases with automatic context pruning and compaction continuity.
- **Gate status:** `todo` (engineering verification and owner UAT pending).
