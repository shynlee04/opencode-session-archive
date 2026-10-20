# WF-SUB-09: Orchestrator Recall Failure — Observation and Failure Factors

- **ID:** `WF-SUB-09`
- **Labels:** `wayfinder`, `wayfinder:observation`
- **Status:** `observed`
- **Depends on:** `WF-SUB-08`
- **Evidence Input:** transcripts `ses_ead1e4d2fffedglSPWcm1QJEz8` (880 msgs) · `ses_eae28df6fffenA7M2uEWJrLUHX` (171 msgs) · live archive `hivemind-steward-oc-devin-dev/.session-archive/index.sqlite` · [`RF-SUB-01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/research/RF-SUB-01-orchestrator-substrate-call-forensics.md) · [`RF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/research/RF-SUB-02-archive-recall-reality-check.md) · [`RF-SUB-03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/research/RF-SUB-03-premise-attack-and-design-space.md)

## Owner Issue

> "this as feature = called a lot times - never any useful - but don't trust me prove me and pick yours"

## PM Translation

`hivemind-substrate` promises an orchestrator that can recover exact historical findings after
compactions and delegations, in ≤2 calls, without re-reading files. The owner observes the opposite:
the feature is called constantly and delivers nothing usable.

## What Was Measured

41 substrate calls in session A; **0** in session B.

| Call | Count | Outcome |
|---|---|---|
| `archive.persist` | 29 | output ignored every time; 59.2 s measured over 24 telemetry-bearing calls |
| `substrate.valve` prune | 7 | manifest ignored every time, incl. a recurring `STATE.md` STALE warning |
| `substrate.valve` status | 2 | unused; one returned `null` at the `execute` boundary |
| `substrate.viewport` resolve | 3 | **all 3 returned skill documents**, not session content; 2 were byte-identical |
| `substrate.viewport` search / timeline / provenance / brief / repomap / skeleton / slice / coupled | **0** | never invoked |

Archive state at the end: 1,009 sessions · 23,825 messages · 1,315 delegations · 68,057 tool calls ·
9,225 FTS rows · 131 root sessions. **Complete, and never queried.**

## Failure Factors (owner's taxonomy)

| Factor | Verdict | Decisive evidence |
|---|---|---|
| Context executed to store → never recalled anywhere | **SUPPORTED** | 0 of 41 calls touched archived session content. The 3 `resolve` calls returned `<skill_content>` payloads. Root `ses_ead1e4d2fffedglSPWcm1QJEz8` was synced **89×**; the agent asked for only 24 — the rest were automatic, so the manual calls were redundant. `PROJECT.md` promises "without manual `archive.persist` choreography". |
| Recall takes >2 calls, or is worse than native tooling | **SUPPORTED at the leaf** | `search` alone is 1 call / 580 tok / 46 ms and beats `grep` (~72,001 tok) by ~27×. But `zoom` is unreachable: `resolveBlob()` accepts only `{startLine, endLine}` (`src/archive/valve.ts:881`) — **`maxTokens` is dropped**. Measured `maxTokens: 100` → 4,035 B; `maxTokens: 5000` → byte-identical 4,035 B. Delegate report bodies are absent from `substrate_fts`, so the real answer needed hand SQL + a manual blob read (~2,630 tok / 2 calls). |
| Confusing callers / actors | **SUPPORTED** | 3 catalog `search()` probes to recover a tool signature; a `maxTokens` 1900→2500 retry returning identical bytes; `{archived: r !== null}` tautologies; **an unrecognised `action` silently falls through to `status`** (`src/plugin.ts:1186-1191`) — a wrong call succeeds wrongly; unknown CLI flags silently ignored (`src/cli.ts:1073` `default: break`). |
| Regressions downstream — later turns, child sessions | **SUPPORTED** | **Child sessions are unaddressable**: `resolveCandidateToRoot` collapses any `depth > 0` session to its root (`src/viewports/continuity.ts:837-848`); `timeline` and `status <childID>` both return the root. Delegate reports exist in `delegation_turn.response_blob` (written `src/archive/normalize.ts:1456`) and are read by **no action**. |

## Structural Conclusion

| Layer | Status |
|---|---|
| STORE — archive write, blobs, relational index | **WORKS** (2 of 8 sub-capabilities dead — see [`WF-SUB-11`](../WF-SUB-11-tracked-cross-cutting-regressions.md)) |
| AUTOMATION — context hook, compaction hook, JIT skeleton footer, idle sync | **MIXED** — JIT footer, compaction packet, ledgers and idle sync work; the context-hook thinning claim is contradicted (below) |
| RECALL — search, resolve, timeline, provenance, brief, repomap, skeleton, slice, coupled | **PARTIAL / FAILS** — the layer the feature exists to serve |

**Value is inversely proportional to the decision the agent must make.** Capabilities that run
unasked work. Capabilities that need the agent to choose correctly are the ones that failed.

Context-hook thinning is measured, not assumed: the "net tokens freed" figure is window-local
(a later `status` read 283 parts / ~99k tok after an earlier 128 parts / ~118k tok), live context
grew 3.9× (peak `cache.read` 179,840 → 379,904), `cache.write` stayed 0, delegate outputs are
exempt (`KEEP_RESULT`, `src/archive/valve.ts:21`), and only parts before the anchor are thinned
(`src/archive/valve.ts:1540`). Tracked in [`WF-SUB-11`](../WF-SUB-11-tracked-cross-cutting-regressions.md).

## Actor Ledger

| Actor | Calls | Value received | Cost paid |
|---|---|---|---|
| Orchestrator agent | 41 | none | ~68 s latency + one implicit sync per substrate call |
| Delegate agent | 0 observed | none observed | — |
| Human operator | 0 observed | valve + compaction continuity, zero calls | — |
| Host runtime | every step | JIT skeleton footer only | — |
| Plugin | — | — | 1.4–4.5 s implicit sync per call, ×1.56 as the archive grew |

## Next

→ [`WF-SUB-10`](../WF-SUB-10-two-surgical-calls-recall-and-zoom.md) (proposed slice) ·
[`WF-SUB-11`](../WF-SUB-11-tracked-cross-cutting-regressions.md) (tracked, deferred)
