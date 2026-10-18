# Issue tracker convention

Primary local tracker: `.planning/phases/<slug>/TICKET-INDEX.md` and
`.planning/phases/<slug>/tickets/<ID>.md`.
Upstream coordinator tracker: `shynlee04/hivemind-steward-oc-devin-dev` (GitHub)
until a dedicated `shynlee04/hivemind-substrate` remote is authorized by the
owner.

**The ticket file is canonical.** The tracked issue is the pushed handle for the
same ticket. Every ticket carries `github_issue` in frontmatter (`null` until
published under explicit owner authorization).

## Labels

Apply `ticket` and `phase:<slug>` when synced to GitHub. No separate triage
label vocabulary; see `triage-labels.md`.

## Graph

`dependencies` frontmatter plus the phase's `TICKET-INDEX.md`. A ticket is on
the frontier when it is open, unclaimed, and every dependency's acceptance gate
has passed.
