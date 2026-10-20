---
id: VSC-R6
phase: viewport-synthesis-compaction
title: Restore inspector commands and truthful session status
status: verified
dependencies: []
github_issue: null
owner: current-session
write_lease: [tui.tsx, src/tui, src/cli.ts, test/tui-cli.test.ts, scripts/build.ts, opencode.json]
requirements: [REQ-SUB-13, REQ-SUB-18]
---

# VSC-R6

Parent is the owning phase PLAN, VSC-R3/R5. Blocks owner UAT of the inspector.
No blocked-by prerequisite. Command investigation can run read-only in parallel
with status investigation. The coordinator is the sole writer and runtime driver.

## Report

The owner sees `Substrate 0F/0S`, `Gate: PASS`, fifty architecture alerts, and
`Saved: -95.3% (164525 tok)`. Commands and the full-screen inspector do not work.

## Model and scope

Keep `SubstrateSnapshotOutput` and `SubstrateActionInput` as the existing RPC seam.
The viewed session owns file counts and pruning actions. Empty or unverified
evidence cannot establish a passing verification gate. Skeleton compression is
an estimate over indexed source, not tokens actually removed from a session.
Fresh whole-file and fresh partial-file counts must be disjoint.

Repair the existing host adapter and presentations rather than introducing a
second router, command transport, status store, or compatibility layer. The
existing approved VSC-R3/R5 design and owner bug-fix request cover this repair.

## Hypotheses and discriminating checks

1. A stale selected package explains dead commands. Rejected by `node
   scripts/local-build.mjs check`, which reports one fresh selection.
2. Command registration or navigation violates the pinned host lifecycle or
   dispatch contract. Compare installed types and exact-tag implementation, then
   test command discovery/dispatch without manually mounting a synthetic app slot.
3. Missing current-session binding explains zero counts and wrong-session actions.
   Use two fixture sessions, vary the route, and assert RPC inputs and rendered
   session identity. Event updates from another session must not replace it.
4. Gate and savings presentation synthesize unsupported success. Confirmed in
   `buildSubstrateSnapshot` and `SubstrateStatusPill`. Test an empty unverified
   session, stale evidence, and separate AST estimates versus valve savings.

## Acceptance

- Slash/palette commands are registered for plugin lifetime and open the intended
  full-screen route or panel. Escape restores the viewed session.
- Actions and refreshes use the viewed session, including after route changes.
- Empty/unverified data never displays PASS. Fresh slices are not also counted
  as fresh whole files. Savings distinguish estimated skeleton compression and
  actual working-set reduction.
- Focused behavioral tests fail before the fix and pass after it. Full test,
  typecheck, build, selected-build freshness, and independent review results are
  recorded. Human UAT stays pending until the owner accepts the installed result.

## Verification Evidence (2026-10-19)

- **Root-Cause Repairs Landed:**
  1. **Plugin Route Navigation & Escape Return ([tui.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/tui.tsx#L191-L207)):** Omitted hardcoded `id: "substrate"` when calling `router.navigate({ type: "plugin", name: SUBSTRATE_ROUTE_NAME, data })` so OpenCode V2 resolves the owning plugin ID (`hivemind-substrate/substrate`). Shallow-cloned `router.current()` into `previousRoute` before navigating so `Escape` (`closeFullScreen`) restores the original viewed session rather than a mutated live Solid store proxy.
  2. **Slash Command Execution & Separate Panel Toggle ([src/tui/commands.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/tui/commands.tsx#L18-L45)):** Removed `arguments: true` from `/substrate` (`substrate.open`) so pressing Enter in the slash menu executes immediately instead of inserting `/substrate ` and waiting for arguments; added dedicated `/substrate-panel` (`substrate.panel`) for toggling the docked session panel.
  3. **Viewed-Session Scoping ([tui.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/tui.tsx#L130-L189)):** Scoped `refreshSnapshot` and `runAction` to `viewedSessionID()`, ignoring background `substrate:updated` events or out-of-order responses from unrelated sessions.
  4. **Truthful Gate, Disjoint File Counts & Token Economics ([src/rpc.ts](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/rpc.ts#L509-L558), [src/tui/status.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/tui/status.tsx), [src/tui/sidebar.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/tui/sidebar.tsx), [src/tui/panel.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/tui/panel.tsx), [src/tui/view.tsx](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/tui/view.tsx)):** Unverified sessions now report `UNVERIFIED (no verification receipt)` instead of `PASS`; `freshFiles` (whole-file reads) and `sliceFiles` (partial/truncated slices) are strictly disjoint (`1F 1P 0S`, `1 FRESH · 1 SLICE`); AST skeleton compression is labeled `AST est.: X% smaller` and separated from actual working-set pruning (`Pruned: Y tok`).
- **Automated Gate Results:**
  - `bun test`: `159 pass, 1 skip, 0 fail` across 23 test files (`3,023` `expect()` calls).
  - `bun run typecheck`: `0` errors (`tsc --noEmit`).
  - `bun run build`: `dist/session-archive.ts` + `dist/tui.tsx` + `dist/src/**` emitted cleanly.
  - `node scripts/local-build.mjs check --config opencode.json`: `status: "clean"`, `entries[0].status: "fresh"` (`.local-builds/2f7a8708d2f6a04b6ccb6fa318b850745947a65144c8006417a38f7ea9e75229`).
  - Phase `UAT.md` files remain `acceptance: UAT_PENDING` pending owner live UAT sign-off.
