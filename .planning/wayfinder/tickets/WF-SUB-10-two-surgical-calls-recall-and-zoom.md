# WF-SUB-10: Two Surgical Calls — `substrate.recall` + `substrate.zoom`

- **ID:** `WF-SUB-10`
- **Labels:** `wayfinder`, `wayfinder:slice`, `wayfinder:owner-approval-pending`
- **Status:** `proposed — awaiting owner approval`
- **Depends on:** `WF-SUB-09`
- **Owning Phase:** `E1.3 viewport-synthesis-compaction` (`REQ-SUB-13`, `REQ-SUB-17`)
- **Evidence Input:** [`WF-SUB-09`](../WF-SUB-09-orchestrator-recall-failure-observation.md) · [`RF-SUB-02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/research/RF-SUB-02-archive-recall-reality-check.md)
- **Owner grill:** beneficiary = **orchestrator agent** · win = **all four failure factors**, each matched to the purpose it is expected to deliver · not framed as a tooling-count question · signal must be **thin and automatically injected**

## Purpose

Make the orchestrator's recovery of a past answer a **2-call, budget-bounded, self-advertising** path,
and remove every agent-facing surface that invites a call that cannot pay off.

## Scope — In

1. **`substrate.recall(query, {scope?, limit?, maxTokens?})`** → ranked **relational branches**.
   - Corpus must include **delegate report bodies** (`delegation_turn.response_blob`), which are written but absent from `substrate_fts`.
   - Must **address a child session** directly — no root collapse.
   - Every branch carries a **stable handle**: `session:<id>` · `blob:<sha256>` · `turn:<callId>#<n>` · `msg:<sessionId>#<seq>` · `file:<path>#<Lstart-Lend>`.
   - Default budget ≤600 tokens; the budget is a hard ceiling, not an estimate.
2. **`substrate.zoom(handle, {maxTokens?})`** → the leaf.
   - **Hard token budget**, always honoured; returns `truncated: true` plus the continuation handle when clipped.
   - Resolves `session:` · `blob:` · `turn:` · `msg:` · `file:`.
3. **Automatic thin signal, no new channel.** The `WorkingMemoryManifest` already injected every turn
   by the context hook gains a `Recall` section: corpus size + ≤3 handles (~40 tokens). No new hook, no
   new latency budget, no change to `REQ-SUB-15`'s "normal `context` turns free of cross-session injection".
4. **Surface reduction (≥ added).** Agent-facing schema collapses from **4 tools / 22 verbs** to
   **3 tools / 5 verbs**: `substrate.recall` · `substrate.zoom` · `substrate.valve` (prune|status|reset).
   `archive.persist` and `ctx.context-prune` leave the agent schema; the 17 `viewport` verbs remain
   internal implementations reachable from CLI / TUI / RPC.

## Scope — Out (tracked, not fixed here)

→ [`WF-SUB-11`](../WF-SUB-11-tracked-cross-cutting-regressions.md).

## Acceptance (falsifiable, one row per owner factor)

| Factor | Acceptance |
|---|---|
| Store → never recalled | A query whose answer lives only in a delegate report body returns that body in **1** `recall` call. |
| ≤2 calls, cheaper than native | `recall` + `zoom` = **2 calls**, ≤600 + ≤`maxTokens` tokens. Must beat `grep -r` + `read` on the same question by ≥10× tokens. `zoom` with `maxTokens: 100` returns **≤100 tokens** (regression test for the dropped knob). |
| Confusing callers | Agent schema exposes **≤3 tools / ≤5 verbs**. No verb accepts a silently-ignored parameter. An unknown `action` must **fail loudly**, not fall through to `status`. Unknown CLI flags must **warn**, not be dropped. |
| Downstream / child sessions | `recall`/`zoom` addressed at a **child session id** return that child's branches and report — not the root. |

## Write Lease (single writer)

`src/viewports/recall.ts` (new) · `src/viewports/semantic-digest.ts` · `src/viewports/index.ts` ·
`src/plugin.ts` · `test/recall.test.ts` (new) · `test/plugin.test.ts` · `.planning/phases/viewport-synthesis-compaction/{PLAN.md,TICKET-INDEX.md}` · `.planning/STATE.md`

## Automated Check

```sh
bun test test/recall.test.ts test/plugin.test.ts && bun run typecheck && bun run build
```

## Publish

`npm publish` as `hivemind-substrate` (unscoped, currently unclaimed on the registry — `404`).
Credential: `NPM_HMOC_STEWARD_KEY` in `.env`, consumed by `.npmrc` (`${NPM_HMOC_STEWARD_KEY}`).
Auth verified as user `hivemind-steward`. Publish is a separate gate from implementation.

## Next

Owner approval → implementation ticket `VSC-R7` under `E1.3`.
