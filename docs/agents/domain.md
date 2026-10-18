# Domain context

This repo (`hivemind-substrate`) is a **single context**: one bounded domain
covering the OpenCode Context & Working-Memory Substrate (The Spine, The
Honeycomb, and Artifacts/Viewports), one `GLOSSARY.md`, and ADRs under
`.planning/architecture/`.

## Canonical artifacts

- `GLOSSARY.md` - terms only, grouped by cluster (`Memory Boundaries & The Box of Context`,
  `The Three-Layer Substrate`, `Trajectory, Delegation & Provenance`,
  `Working-Set Valve & Viewports`). Read it before naming anything.
- `.planning/architecture/ADR-NNN-slug.md` - architecture decisions for
  `hivemind-substrate`.
- `.planning/decisions.tsv` - append-only owner/coordinator decision trail.
- `.planning/wayfinder/HIVEMIND-SUBSTRATE-DISCOVERY.md` - forensic synthesis,
  host-contract benchmarks, domain model, and architectural sketches.
- `docs/teach-me/` - foundational architecture dossiers (`OpenCode Context
  Substrate`, `learning-route-ver-openai-6-1-sol.md`, and
  `the-box-of-context-viewports-on-sessions-and-codebase.md`).
- Live specs: one `SPEC.md` per phase under `.planning/phases/<slug>/SPEC.md`.
- `.planning/phases/<slug>/TICKET-INDEX.md` - phase ticket DAG and requirement
  coverage.

## Working rules

- Amend, never fork: one live spec per phase, one ADR per seam, one glossary
  term per concept.
- Requirements live in spec REQ tables; tickets cite REQ ids rather than
  restating behavior.
- New domain terms land in `GLOSSARY.md` in the right cluster and existing
  style.
