# Artifacts: paths and naming

Read this before creating or locating any planning artifact in this repository.
`project-skeleton` decides **which** artifact a piece of work needs; this file
says **where** it lives and **what** it is called.

| Artifact | Path | Name / ID |
|---|---|---|
| Project facts | `.planning/PROJECT.md` | - |
| Epics and phase order | `.planning/ROADMAP.md` | epics `E<n>`, phases `E<n>.<m>` |
| Current position | `.planning/STATE.md` | - |
| Wayfinder discovery | `.planning/wayfinder/HIVEMIND-SUBSTRATE-DISCOVERY.md` | - |
| Phase spec | `.planning/phases/<slug>/SPEC.md` | requirements `REQ-SUB-<NN>` |
| Ticket graph | `.planning/phases/<slug>/TICKET-INDEX.md` | - |
| Ticket | `.planning/phases/<slug>/tickets/<ID>.md` | `<PREFIX>-<NN>`, prefix per phase |
| Gap / bug / refactor plan | `.planning/phases/<slug>/plans/<NN>-<slug>.md` | `<PREFIX>-P<NN>` |
| UAT record | `.planning/phases/<slug>/UAT.md` | - |
| Reviews / evidence | `.planning/phases/<slug>/reviews/` and `.audit/` | - |
| Glossary / ADRs / decision log | see `domain.md` | - |

## Phase prefixes

| Phase slug | Prefix |
|---|---|
| `trajectory-working-memory` | `TWM` |
| `codebase-structural-graph` | `CSG` |
| `viewport-synthesis-compaction` | `VSC` |

## Ticket frontmatter fields the skills read

`id`, `phase`, `status` (`todo`, `in_progress`, `done`, `blocked`, `superseded`), `dependencies` (ticket ids),
`github_issue` (number or `null`; `null` means not yet published).
Additional local fields (`title`, `owner`, `write_lease`, `proves`, `requirements`) are preserved untouched.
