# Runtime UAT Walk Log — Orchestrator as Test-Walker (PM seat)

<!-- Staged UAT walk. Record + evidence only. No fixes, no diagnoses to dev/architect. -->

| Field | Value |
|---|---|
| Date | 2026-10-19 |
| Role | Orchestrator acting as UAT Test-Walker + PM |
| Co-walker | The vibecoder (stakeholder) |
| Method | Stage-by-stage; `question` tool at each checkpoint to compare agent-seat vs human-seat |
| Boundary held | No code/test surfaces read; evidence from the live tool surface only |
| Prior evidence | `.audit/2026-10-18-uat-runtime-observation/*` |

## Ground rules of this walk

- I do not read source or test files while in this role; I observe only what an orchestrator sees
  through the installed tool surface.
- I do not propose fixes or diagnoses. I record, log, show evidence, and frame findings by
  *how the feature is used* and *what quality bar the stakeholder needs*.
- Each stage ends in a checkpoint: **PROCEED** to the core feature, or **POINTLESS** if it fails early.
- The handed UAT bounds only to claimed completion; claimed-but-unbounded surfaces are walked anyway
  and marked as such.

## Stage 0 · First contact (install)

**Agent sees:** four tools — `substrate.viewport`, `substrate.valve`, `archive.persist`,
`ctx.context-prune`. Root-level `substrate`/`viewport` tools are gone. Every call carries a
`[substrate.telemetry action=… tokens=… latencyMs=…]` footer; `format:"json"` exists.

**Scope bound:** handed UAT pins candidate `de42f87` / `341,139` bytes and covers E1.1–E1.3 only.
Dev handoff claims a `411,054`-byte build with native TUI, CLI, telemetry, 3-state coverage, JIT read
interception. The handed UAT does **not** bound those — recorded as in-scope-for-walk, out-of-scope-for-UAT.

## Stage 1 · E1.1 Trajectory Working Memory — **PROCEED**

| Claim | Observed (agent seat) | Verdict |
|---|---|---|
| sync outside `.opencode/` | `9 files written, 3 unchanged` + telemetry | ✅ |
| 3-state freshness | `FRESH=6, SLICE=0, STALE=8`; explicit ranges `#L1-L61`, `#SLICE L1-L1436 (truncated)`; old `#all` gone | ✅ |
| manual prune | `27/35 steps thinned (46 tool parts, ~59,954 tokens freed)`, anchor `msg index 28` | ✅ (no-op fixed) |
| resolve exact lines | returned UAT.md lines 1-6 verbatim | ✅ |
| alias parity | `ctx.context-prune` ≡ `substrate.valve` (same 1093 len; only telemetry label differs) | ✅ near |

**Findings:** S1-1 gate disagrees across surfaces (`verified_stale_by_later_touch` vs `verified_passed`);
S1-2 ambient surface is heavy (`status` 1,100 tok, `valve prune` 1,401 tok, full manifest each time);
S1-3 correct-but-confusing stale signals right after a signed-off PASS; S1-4 search never says "no match";
S1-5 intent pivot mislabel (`[prune_or_continuity]` on a non-prune turn); S1-6 human surface invisible.

**Stakeholder answer (Stage 1):** *"None — only the agent's tool activity."* Human surface unreachable.
Gate term: *"I don't know what it means."*

## Stage 2 · E1.2 Codebase Structural Graph — **PROCEED**

| Action | Observed | Verdict |
|---|---|---|
| `repomap` | 961 tok (<1,000), PageRank + `[Lstart-Lend]` | ✅ |
| `skeleton valve.ts` | 858 tok (file 1,956 lines) | ✅ |
| `slice computeStepWatermark` | 1,313 tok for ONE symbol | ⚠️ > whole skeleton |
| `coupled` | `P=50.0%` + commit-message story; HIDDEN COUPLING surfaced | ✅ |
| JIT read footer | injected on truncated read: `(shown L1-L90 of 1956; 22 unread symbols)` + `slice` hint | ✅ claimed, unbounded |

**Findings:** S2-1 one symbol costs more than the whole outline; S2-2 the JIT nudge and its savings are
invisible to the human; S2-3 repomap sits at 961/1,000 (no headroom); S2-4 footer range overlap
(`[L82-L94]` listed unread while `L1-L90` shown); S2-5 4-commit co-change window presented at two-decimal confidence.

**Stakeholder answer (Stage 2):** structural facilities are *"just for agents"*, **but** the stakeholder wants
the zoom-out (repomap) + file outlines (skeleton) rendered **high-level into their TUI as an architecture/
mudball advisor** — *"so as advisor to not letting me as vibecoder stack complexity on a state of mudball."*
And: *"Yes — surface the savings to me."*

## Stage 3 · E1.3 Viewport Synthesis & Compaction Continuity — **PROCEED (flagged)**

| Action | Observed | Verdict |
|---|---|---|
| `timeline` (no sessionID) | 129 tok, 2 pivots, auto-resolved | ✅ |
| `provenance` | 3-state; `SLICE L1-L90 of 1955 — FRESH SLICE` appears | ✅ |
| `brief` | 812 tok (≤1,200) | ✅ |
| provenance flip (write→read→edit) | read chain `VERIFIED_FRESH → STALE` on edit | ✅ |
| compaction packet | not reachable from any tool action | ⚠️ unobservable |

**Findings:** S3-1 same file shows FRESH **and** STALE at once (chain-based); S3-2 multiple hash domains
survive (one file, four blob hashes across views); S3-3 two ledgers disagree on what's tracked
(`valve` vs `provenance`); S3-4 `#all` still emitted on legacy rows; S3-5 gate disagreement reconfirmed;
S3-6 identical `blob:missing` rows get opposite verdicts; S3-7 "Files tracked: 17" counts chains, not files;
S3-8 `format:"json"` not a uniform envelope; S3-9 compaction continuity invisible from the surface.

**Stakeholder answer (Stage 3):** *"everything like same file freshness do not mean anything because I did
not see it."* Compaction: *"No — not yet."*

## Stage 4 · Ecosystem & cross-cuttings

**Claimed-but-unbounded surfaces:** 4-tool surface ✅ · telemetry ✅ · 3-state + JIT ✅ ·
CLI (`bun run substrate status`) ✅ **works, tool-parity** · native TUI ⚠️ unverifiable headless / unreached ·
compaction packet ⚠️ unobservable.

**Persona × journey:**

| Persona | Reach | Gets |
|---|---|---|
| Human vibecoder | chat prose only | nothing structured |
| Session agent | full tool surface | everything |
| Subagents/delegates | unverified | unknown |
| Maintainer | CLI + repo | everything (if they know the CLI exists) |

**Findings:** E-1 value is agent-internal by default; E-2 discoverability (CLI exists, nothing advertises it);
E-3 truth layer unstable (two ledgers + verdicts flipping `STALE→FRESH` between consecutive calls);
E-4 gate semantics opaque + contradictory; E-5 the stakeholder's stated advisor doesn't exist;
E-6 headline promise untested (no compaction yet); E-7 token savings invisible; E-8 JSON envelope non-uniform.

**Ecosystem checkpoint:** agent-side product **viable**; stakeholder-side product **not yet real**.

**Stakeholder answers (Stage 4):**
- Surface wanted: **both** a TUI panel **and** a slash command that *"pop the whole full screen"*, modelled on
  their existing implementation under `hivemind-steward-oc-devin-dev/src/hosted/` (`panel.tsx`, `sidebar.tsx`,
  `render.tsx`, `commands.ts`, `registration.tsx`, `session-picker.tsx`, `view.tsx`) + `tui.tsx`.
  *(Recorded as the stakeholder's reference; not read — role boundary.)*
- Priority: **#2 survive-compaction memory** is *most important but easy*; **#1 mudball/architecture advisor**
  is *"the principle."*

## Stakeholder expectations (acceptance scale)

| # | Expectation | Bar to please |
|---|---|---|
| X1 | Full-screen TUI panel + slash command reaching the substrate | Human-legible without codemode; gate + freshness + drift at a glance |
| X2 | Mudball/architecture advisor (repomap + outlines, high-level) | Tells the vibecoder when they are stacking complexity |
| X3 | Survive-compaction continuity | Proven across a real compaction boundary (not yet observed) |
| X4 | Visible token savings | Human sees the agent is being efficient |
| X5 | One truth per file | Single stable freshness verdict; no two-ledger contradiction |

## Checkpoints summary

| Stage | Decision | Reason |
|---|---|---|
| 1 E1.1 | **PROCEED** | core loop works; human surface unmet |
| 2 E1.2 | **PROCEED** | structural recall cheap + correct |
| 3 E1.3 | **PROCEED (flagged)** | outputs good; truth layer unstable |
| 4 ecosystem | **agent-side viable / stakeholder-side not real** | value never reaches the consumer |

## Not verifiable in this walk (needs a live surface)

- Native TUI rendering and `/substrate*` commands.
- A real compaction boundary and the continuity packet it injects.
- Subagent/delegate inheritance of the tool surface.
- Live-LLM adherence to `FRESH — DO NOT REREAD` across 45+ steps.

## Boundaries

No fixes, tickets, or code changes were produced. This is a walk log for the owning lanes and the owner.
`acceptance` stays `UAT_PENDING`.
