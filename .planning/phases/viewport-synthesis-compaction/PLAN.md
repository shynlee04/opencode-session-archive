# Remediation Plan: Phase E1.3 Viewport Synthesis, Compaction & OpenTUI Surface (`viewport-synthesis-compaction`)

**Date:** 2026-10-18
**Status:** approved (`decisions.tsv` #6 / `/grill-with-docs` `A1..A4`)
**Owning Phase:** `E1.3 viewport-synthesis-compaction` (`REQ-SUB-13` .. `REQ-SUB-18`)
**Audit Inputs:** `.audit/2026-10-18-uat-runtime-observation/{EVIDENCE.md,REPORT-product-design-gaps.md,REPORT-technical-smells.md}`

## Scope & Root-Cause Mapping

| Defect / Gap / Smell | Classification | Root Cause | Owning Module(s) |
|---|---|---|---|
| `D3` / `P-5` / `T-3` / `T-4` / `T-8` (Fabricated `replaced 2 shell/Python JSONL scrapes ... vs S2 msg[124..125]` footer, `S1_SESSION_ID`/`S2_SESSION_ID` branches, `/Users/MAC/...` paths, `buildUnifiedContinuityDatabase` in production) | Bug / Smell | `wf-sub-01` and `wf-sub-07` prototype benchmark fixtures were copied verbatim into `src/viewports/semantic-digest.ts`, `src/viewports/continuity.ts`, and `src/viewports/brief.ts`. | `src/viewports/semantic-digest.ts`, `src/viewports/continuity.ts`, `src/viewports/brief.ts`, `test/helpers.ts` |
| `P-2` (Zero human-facing UX surface; UAT steps required agent tool JSON calls) | Spec amendment (`A1`) | Only agent-callable tools were registered; no `@opencode/plugin/tui` Solid surface (`./tui`), `SubstrateRpc` contract (`./rpc`), or CLI (`bun run substrate <action>`) existed. | `src/rpc.ts`, `tui.tsx`, `src/tui/*`, `src/cli.ts`, `src/plugin.ts` |
| `P-4` (6 duplicate tools cluttering agent tool schema) | Spec amendment (`A2`) | `src/plugin.ts` registered `substrate`, `viewport`, `substrate.valve`, `substrate.viewport`, `archive.persist`, and `ctx.context-prune`. Owner approved keeping only the 4 canonical + legacy plugin tools (`substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune`) and deleting root `substrate` and `viewport`. | `src/plugin.ts`, `test/plugin.test.ts` |
| `P-6` (Opaque FTS5 ranking & single-session echo in `search`) | Gap | `queryVibeNavigation` hid matched token coverage, BM25 score, and total indexed session count (`matched M of N root sessions`). | `src/viewports/semantic-digest.ts` |
| `P-7` (Tool `metadata` invisible to LLM in `Tool.Result`) | Gap (`A3`) | OpenCode sends `Tool.Result.content` to the model and keeps `Tool.Result.metadata` for host UI/telemetry. Agents could not read `tokens`, `freshCount`, or `staleCount` unless included in `content`. | `src/plugin.ts` |
| `T-2` / `T-12` (`as any` host casts and wrong `compaction` hook mutation in `src/plugin.ts`) | Bug | `src/plugin.ts` typed `ctx` loosely with `as any` and mutated `(event as any).prompt` instead of `event.system.push(...)` on `SessionRequestHook` (`compaction`). | `src/plugin.ts` |

## Remediation Units

### Unit VSC-R1: Purge Prototype Scaffolding & Surface Transparent FTS5 Scores (`src/viewports/semantic-digest.ts`, `src/viewports/continuity.ts`, `src/viewports/brief.ts`)
1. Delete the hardcoded `replaced 2 shell/Python JSONL scrapes ... vs S2 msg[124..125]` footer, `DEFAULT_WF01_DB_PATH`, and `EXPORT_FILES` from `src/viewports/semantic-digest.ts`.
2. Replace with a truthful deterministic search header and per-hit score breakdown:
   - Header: `_Indexed root sessions: <totalRootSessions> | Matched: <matchedCount> | Query tokens: [<tokens>] (<elapsedMs> ms)_`
   - Per hit: `coverage=<matched>/<total> (<pct>%) | bm25=<score> | pivots=<count> | delegations=<count>`
   - Honest `0-match` output when no session matches the query tokens.
3. Delete `S1_SESSION_ID`, `S2_SESSION_ID`, `S3_SESSION_ID`, `DEFAULT_HOST_DB_PATH`, `DEFAULT_CANONICAL_ROOT`, `seedProvenanceAndLedgers`, and `buildUnifiedContinuityDatabase` from `src/viewports/continuity.ts` (moving any synthetic fixture builders needed by tests into `test/helpers.ts`).
4. Update `reconcileProvenanceStaleness` in `src/viewports/continuity.ts` to use `computeDiskSliceSha` from `src/archive/primitives.ts` so full unchanged reads reconcile to `FRESH — DO NOT REREAD`, partial/truncated unchanged reads reconcile to `SLICE L<start>-L<end> of <total> — FRESH SLICE`, and modified files reconcile to `STALE (modified since read/review — re-verify slice)`.
5. Clean `src/viewports/brief.ts` to import `estimateTokens` and `normalizeRepoPath` from `src/archive/primitives.ts`.

### Unit VSC-R2: Typed `src/plugin.ts` (4 Tools, `event.system.push` Compaction, `format` Option & Telemetry Footer, `SubstrateRpc`)
1. Type `setup(ctx: Plugin.Context)` directly against `@opencode/plugin` (`2.0.32`) with zero `(ctx as any)` casts.
2. Register **exactly 4 tools**:
   - Canonical: `substrate.valve` and `substrate.viewport`
   - Legacy aliases: `archive.persist` and `ctx.context-prune`
   - Remove root-level `substrate` and `viewport`.
3. Add optional `format?: "markdown" | "json" | "both"` to `substrate.valve` and `substrate.viewport` input schemas, and append a deterministic 1-line telemetry footer (`--- \n[substrate.telemetry action=<action> tokens=<n> latencyMs=<ms> ...]`) to `content` so agents see structured telemetry in `Tool.Result.content` as well as `Tool.Result.metadata`.
4. Fix `ctx.session.hook("compaction", async (event) => ...)` to push `{ type: "text", text: packet.markdown }` onto `event.system` (`SessionRequestHook.system`), matching the official OpenCode V2 `SessionHooks["compaction"]` contract.
5. Register `ctx.rpc.register(substrateRpcContract, ...)` (`src/rpc.ts`) exposing `status`, `timeline`, `provenance`, `repomap`, `search`, `prune`, and `sync` over OpenCode V2 RPC.

### Unit VSC-R3: Native OpenTUI Solid Surface (`tui.tsx`, `src/tui/*`, `src/rpc.ts`) & CLI (`src/cli.ts`)
1. Create `src/rpc.ts` defining `substrateRpcContract` (`id: "hivemind-substrate"`) using zero-external-runtime-dependency `StandardSchemaV1` validators so `src/plugin.ts` bundles into `dist/session-archive.ts` with zero external runtime imports while `tui.tsx` gets full static RPC client typing (`context.client.rpc(substrateRpcContract)`).
2. Create `tui.tsx` and `src/tui/{panel.tsx,sidebar.tsx,status.tsx,commands.tsx}` using `@opencode/plugin/tui` (`Plugin.define`), `@opentui/solid`, `solid-js`, and `@opencode/theme/tui`:
   - `session.panel` (`name === "substrate.inspector"`): interactive OpenTUI Solid panel with keyboard tabs (`1` Status/Manifest, `2` Provenance & Staleness, `3` Timeline & Delegations, `4` PageRank RepoMap, `p` Prune Working Set, `r` Refresh/Sync), styled with `context.theme`.
   - `sidebar.content`: compact live substrate readout showing session ID, `FRESH` / `SLICE` / `STALE` file counts, active provenance status, and valve watermark status.
   - `prompt.footer.status`: compact status pill (`substrate: <fresh>F/<slice>P/<stale>S`).
   - `app` slot (`SubstrateCommands`): global keymap layer registering palette & slash commands (`/substrate`, `/substrate-prune`, `/substrate-repomap`, `/substrate-provenance`) that open the `substrate.inspector` panel or trigger live RPC actions with toast feedback.
3. Create `src/cli.ts` (`bun run substrate <status|sync|repomap|skeleton|slice|coupled|provenance|timeline|search|brief|prune> [args...]`) for zero-config terminal inspection.

### Unit VSC-R4: Unified Plain-Language Gate, Honest Zero-Hit Search, `compaction` Preview Action & JSON Envelope (`decisions.tsv` #7: `A2`, `A3`)
1. Run `reconcileProvenanceStaleness(db, sessionId, activeWorktreeRoot)` during `ensureSyncedDb` / `materializeSemanticDigests` and inside `action === "provenance"` (`src/plugin.ts`) so `session_semantic_digest.verification_state` and `compaction_continuation_ledger.verification_gate_status` never disagree, and format the gate in plain language (`PASS (N verified files fresh)` vs `NEEDS RE-VERIFY (K files modified since last test pass: ...)`).
2. Update `queryVibeNavigation` (`src/viewports/semantic-digest.ts`) to filter out single-digit noise tokens and require at least `1` non-numeric query token match before applying active-session boost, returning `Matched: 0` on unrelated queries.
3. Tighten `PIVOT_RULES[0]` (`prune_or_continuity` in `src/viewports/semantic-digest.ts`) so long pasted reports or benchmark prompts mentioning `substrate.valve` are classified by their actual intent rather than `prune_or_continuity`.
4. Add `action: "compaction"` to `substrate.viewport` (`src/plugin.ts`, `src/cli.ts`, `src/rpc.ts`) to preview the `< 1,200`-token `CompactionContinuationPacket`, normalize `format: "json"` across all actions to `{ ok, action, sessionID, tokenCount, budgetTokens, content, data }`, remove duplicate token keys in `src/viewports/brief.ts`, and normalize telemetry `action` on aliases (`search`, `sync`, `prune`).

### Unit VSC-R5: OpenCode V2 Package Directory Install, Full-Screen `/substrate` Route & Mudball Advisor TUI (`decisions.tsv` #7: `A1`)
1. Unify plugin ID to `"hivemind-substrate"` in both `src/plugin.ts` and `tui.tsx`.
2. Fix RPC client/server wiring (`tui.tsx`, `src/plugin.ts`, `src/rpc.ts`): pass `{ location: { directory } }` on `rpcClient.snapshot` and `rpcClient.action`, subscribe via `rpcClient.events.on(SUBSTRATE_UPDATED_EVENT, ...)`, and emit via `rpcHandle?.events?.emit(SUBSTRATE_UPDATED_EVENT, ...)` in `src/plugin.ts`.
3. Enrich `SubstrateSnapshot` (`src/rpc.ts`, `src/cli.ts`) with full top PageRank `RepoMap` files + per-file `AstSkeleton` symbol outlines, `MudballHotspot` items (high-LOC files, fan-in/fan-out hubs, god symbols `>= 150` lines, and `has_static_edge = 0` hidden coupling pairs), `compactionPreview` markdown, and aggregate token-compression metrics (`valveTokensSaved`, `skeletonTokensSaved`, `compressionPct`).
4. Model `tui.tsx` and `src/tui/{view.tsx,panel.tsx,sidebar.tsx,status.tsx,commands.tsx}` on `hivemind-steward-oc-devin-dev/src/hosted/{registration.tsx,view.tsx,panel.tsx,sidebar.tsx,render.tsx,commands.ts}`:
   - Register full-screen route `context.ui.router.register({ name: "substrate", render: () => <SubstrateView ... /> })` so `/substrate` pops the 100% full-screen Mudball & Architecture Advisor view (`escape` returns to `{ type: "home" }`).
   - Mount `<SubstrateCommands>` inside `context.ui.slot({ append: "app", render: ... })`.
   - Gate `SubstratePanel` (`session.panel`) keybindings via `context.keymap.layer` with `enabled: () => props.input.focused` so typing in the main chat prompt is never intercepted when unfocused.
   - Render interactive `up`/`down`/`return` file selection over PageRank `RepoMap` -> live `AstSkeleton` symbol outline -> `Hidden Coupling` & complexity hotspots + One-Truth Provenance & Gate + Compaction Continuity preview + live token savings in header, sidebar, and footer pill.
5. Update `scripts/build.ts` to materialize the OpenCode V2 plugin package directory (`.opencode/plugins/hivemind-substrate/` with `package.json`, `index.ts`, `server.ts`, `tui.tsx`, `rpc.ts`, and `src/tui/*`, plus `opencode.json` registration) alongside `dist/session-archive.ts`.

## Verification & Acceptance Gate
- `rg "S2 msg\[124|/Users/MAC|hivemind-steward-oc-devin-dev" src/` returns `0` matches.
- `bun test && bun run typecheck && bun run build` passes 100%.
- Live verification against `~/.local/share/opencode/opencode.db` (`hivemind-steward-oc-devin-dev`'s 924 sessions, 1,413 delegations, 124 compactions) and cross-project queries confirms all 21 findings (`S1-1..S1-5`, `S2-1..S2-5`, `S3-1..S3-9`, `E-3`, `E-4`, `E-8`, and the 3-arm benchmark gaps) are resolved with measured runtime evidence.

## Owner-reported command and status regression, 2026-10-19

Tracked by `tickets/VSC-R6-command-status-regression.md`. Restore the existing
VSC-R3/R5 command and inspector contract, not a new capability or redesign.
Preserve the dirty working tree and immutable prior builds. No commit, external
agent run, host database access, service restart, or global configuration change.

Ordered checks are reproduction, discriminating diagnosis, behavioral red/green,
independent review, full tests/typecheck/build, and a fresh local build selection.
Terminal interaction against an isolated host is required if available. Otherwise
record the precise runtime gap and leave owner UAT pending.
