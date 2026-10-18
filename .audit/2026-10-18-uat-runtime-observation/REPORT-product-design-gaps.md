# Report — Product & Design-Concept Gaps (end-consumer lens)

<!-- product-manager lens. Findings only; no code, tests, tickets, or roadmap mutations. -->

| Field | Value |
|---|---|
| Date | 2026-10-18 |
| Subject | `hivemind-substrate` runtime behavior, Phases E1.1 / E1.2 / E1.3 |
| Input evidence | `.audit/2026-10-18-uat-runtime-observation/EVIDENCE.md` |
| Lenses | PM (does the direction matter) + Systems Architect (does the ground hold) |
| Personas | Human end-user · Session agent/subagents · Maintainer |
| Verdict | **BLOCK** (forced by Test-seam coverage) |

## Why this report exists

The three phases are `ENGINEERING_VERIFIED` and green. Driving the UAT steps live shows the plumbing
works, but the product's *flagship promise* does not hold at runtime, and the entire value path is
invisible to the human persona. This report scores that gap against the consumer lenses rather than
against the test suite.

## Practical use cases — what the consumer actually does

| # | Consumer | Practical use case | Tool path | Observed outcome |
|---|---|---|---|---|
| U1 | Session agent | "Which files have I read, and are they still fresh?" | `viewport status` → WorkingMemoryManifest | Always `STALE` (D1) → the agent is told to re-read everything |
| U2 | Session agent | "Thin older tool noise mid-run." | `substrate.valve prune` | No-op, `0/0 steps` (D2) |
| U3 | Session agent | "What was I doing after compaction?" | compaction packet | Works: 830 tok, 6 sections |
| U4 | Session agent | "Show me the shape of `valve.ts`." | `skeleton` + `slice` | Works well: 94.7% saved, exact lines |
| U5 | Session agent | "Find the session where I built Wave 2 slice 1." | `search` | Returns the current session for any query; ranking unproven (P-6) |
| U6 | Human operator | "Check the archive / working set myself." | none | No native surface (P-2) |

U1 and U2 are the two journeys PROJECT.md names as *core value*; both fail at runtime.

## Design-concept flaws and gaps

**P-1 · The Do-Not-Reread contract is inverted (highest impact).**
Core value is "recover … with zero panic re-reading." The WorkingMemoryManifest's only job is
freshness, and it reports `FRESH=0, STALE=11` for files that were never modified (D1). The ledger
therefore *instructs the agent to re-read everything* — the exact behavior the product exists to
prevent. Consumer: session agent. Evidence: EVIDENCE §E1.3·2, D1.

**P-2 · No human-visible surface at all.**
Every capability is agent-tool-only (EVIDENCE "Consumer surface map"). The human persona cannot
inspect the archive, the working set, or provenance without an agent or raw `sqlite3`. This violates
the Human end-user lens ("native-surface quality; practical functionality") and makes the
"conversational owner UAT" a persona mismatch: it asks a human to hand-type tool calls that only an
agent should ever make. Consumer: human end-user.

**P-3 · The manual prune lever is inoperable (agency + observability gap).**
The Specialist journey ("prune intra-turn tool noise via `substrate.valve`") cannot be satisfied by
the agent: the tool has no access to session messages (D2), so only an automatic hook prunes — and
the agent can neither steer nor observe it. The product ships a lever the intended actor cannot pull.
Consumer: session agent.

**P-4 · Interface sprawl — five tool names for two capabilities.**
`substrate.viewport`, `viewport`, `substrate`, `substrate.valve`, `ctx.context-prune`, `archive.persist`
expose two capabilities (prune, viewport) across three namespaces. Back-compat aliases are sound, but
there is no single documented entry point, so a caller must learn the alias topology by trial. This
contradicts the agent lens ("one simple interface per capability"). Consumer: session agent, maintainer.

**P-5 · Fabricated content in a "deterministic" output (trust erosion).**
`search` appends a hardcoded footer referencing a *different* session (`vs S2 msg[124..125]`) and a
specific token/char claim, for every query (D3). A product whose pitch is deterministic, materialised,
local-first output cannot ship canned cross-session claims in the render path. Consumer: session agent,
human reader.

**P-6 · Cross-session "vibe navigation" is unproven as a differentiator.**
`search` returned the current session regardless of the query, and no BM25 relevance score is surfaced.
With one session present, the output is indistinguishable from `latest`; the claimed "locate sessions by
meaning" value is not demonstrable from the surface. Consumer: session agent. (Research question, not a
bug: needs a multi-session drive to confirm ranking.)

**P-7 · Structured metadata is dropped at the tool boundary.**
Tools return a markdown string; the rich `metadata` (counts, blob refs, statuses) is not surfaced to the
agent, which must re-parse prose to recover machine fields. This is avoidable noise and fragility for the
agent persona. Consumer: session agent.

**P-8 · Provenance overstates read coverage.**
A whole-file read is recorded with line-range `all` even when the read output was truncated
(`valve.ts` is 1,769 lines; the archived read is `lines 1-1436`; the ledger says `#all`). An agent that
trusts `#all` may act on lines it never saw — a correctness gap in the provenance record itself.
Consumer: session agent, maintainer.

## Health verdict — hivemind-substrate runtime surface — 2026-10-18

| Dimension | Mark | Evidence |
|---|---|---|
| Intent-clarity (score: 8/10) | PASS | `PROJECT.md`, `ADR-001..003`, `ROADMAP.md` coherent; journeys named |
| Terminology alignment | WATCH | 3 namespaces for one capability; `#all` recorded over truncated content (P-8) |
| Seam depth | WATCH | Two prune entry points (tool vs hook), no owning decision; tool path dead (D2) |
| Dead-code load | WATCH | Non-functional `substrate.valve` path; alias multiplicity (P-4) |
| Journey time-to-value | WATCH | Gates green and U3/U4 work, but flagship U1/U2 journeys fail at runtime |
| Test-seam coverage | **BLOCK** | Freshness seam crossed untested — fixtures inject matching hashes; D1 shipped green |

**Aggregate: BLOCK** (forced by Test-seam coverage; ≥3 WATCH would also escalate).
**Prefactoring note:** the blocking dimension flips when `read_blob_sha` is computed over raw file
content (or the read output is normalized before hashing) *and* one regression exercises the real-disk
staleness path. Smallest remediation, one seam.
**Gate:** PRD may proceed only carrying an explicit non-goal or a prefactoring dependency note.

## Handoff / routing (owning lanes mutate — this report does not)

- **D1** (freshness): gap/bug → PLAN.md under its owning phase (ledger write in `normalize.ts` = E1.1
  `trajectory-working-memory`; reconciliation in `continuity.ts` = E1.3 `viewport-synthesis-compaction`).
- **D2** (prune no-op): bug → PLAN.md under E1.1 `trajectory-working-memory`.
- **D3** (fabricated footer): gap → PLAN.md under E1.3 `viewport-synthesis-compaction`.
- **P-2 / P-4 / P-7** (no human surface, interface sprawl, metadata drop): product/design decisions →
  `grill-with-docs` before any spec change.
- **P-6** (vibe navigation): open research question → needs a multi-session drive.

## Boundaries

No code, tests, tickets, seams, schemas, or governance mutations were produced. Findings are packet
content for the owning lanes. This report does not assert owner acceptance; `acceptance` stays
`UAT_PENDING`.
