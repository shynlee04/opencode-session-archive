# Two-axis code review for post-UAT remediation (TWM-R1..R3, CSG-R1, VSC-R1..R3)

- **Reviewer:** Independent `code-review` subagent (`d4c5266e-f70c-4ca2-b116-b912be4a06cf`)
- **Date:** 2026-10-18
- **Pinned base:** `3cedf6c` (`HEAD` on `main`)
- **Candidate scope:** Post-UAT remediation across Phases `E1.1` (`TWM-R1..R3`), `E1.2` (`CSG-R1`), and `E1.3` (`VSC-R1..R3`) addressing `.audit/2026-10-18-uat-runtime-observation/` (`D1..D3`, `P-1..P-8`, `T-1..T-12`) and `.planning/decisions.tsv` (`ADR-0021..0036`).
- **Automated gates:** `bun run typecheck` passes with `0` errors; `bun test` passes `136 pass, 1 skip, 0 fail, 2088 expect() calls across 21 files [13.44s]` (`test/` suite passes `97 pass, 1 skip, 0 fail, 1122 expect() calls across 14 files [2.11s]`); `rg -n "S2 msg\\[124|/Users/MAC|hivemind-steward-oc-devin-dev|S1_SESSION_ID|S2_SESSION_ID" src/` returns `0` matches in `src/`.
- **Verdict:** **PASS** (`0 blocker`, `0 major`, `0 minor`, `0 nit`; all Round 1 findings `REV-01..REV-04` resolved and re-verified on physical disk)

---

## Candidate manifest

| Path | SHA-256 | Status |
|---|---|---|
| `src/archive/primitives.ts` | `6c3b60d9ae1db33a8c06aaf2ebd86981bdb0093895f34c9b7cbdf125143f99f0` | Added (`T-1`, `T-2`, `T-3`, `T-5`, `TWM-R1`) |
| `src/archive/types.ts` | `e07a027487db007c1d78670c85f0cb0405c31e5eec2129357992962230a871a5` | Modified (`TWM-R2`) |
| `src/archive/normalize.ts` | `039b9db1aa6d4b3daedc4eb79f9891c2e632024f9d9315b898a56048880929fc` | Modified (`D3`, `P-1`, `P-2`, `TWM-R2`) |
| `src/archive/index-db.ts` | `31eb43dcaf506be65953fb4ca9ad148a1ab15984ac8a537bd72bc9267153fe2a` | Modified (`T-6`, `TWM-R1`, `TWM-R2`) |
| `src/archive/index.ts` | `67400bd70e8e07175cc62a4d00d11b13c86ff9ef2a35bd707ddef38e03a244c9` | Modified (`P-1`, `TWM-R2`) |
| `src/archive/valve.ts` | `eb878cb5438fa6b91b01861652656f78088ef11037b64efff57965ec5f91331a` | Modified (`D3`, `P-2`, `TWM-R2`) |
| `src/honeycomb/ast-skeleton.ts` | `c8b80ae00c4756473e22318843ec2719b4abfe4b5d1a50e105a0be5c239bbbe5` | Modified (`CSG-R1`) |
| `src/honeycomb/pagerank.ts` | `8a0cec637f6de99cad02171e793c27c6be7e1be3f7e6107a58e5d52e08bdb2a2` | Modified (`CSG-R1`) |
| `src/honeycomb/cochange.ts` | `734b1e19620b045d772ef630c73bb11e879a002092fe3c1272bd794f2e8c1691` | Modified (`CSG-R1`, `REV-02` verified) |
| `src/honeycomb/index.ts` | `a28b297343139e258cfaf3bd8030c6588e413eb45bcd933b66cea52a4c85cc2d` | Modified (`T-11`, `CSG-R1`) |
| `src/viewports/semantic-digest.ts` | `af054c20505fb8103ff6a947f76bdc1a4f8b32bbebcb123f3680e00db534fa11` | Modified (`D1`, `P-6`, `T-7`, `T-8`, `VSC-R1`) |
| `src/viewports/continuity.ts` | `92cc3fd1b6723af8c30641ee705fd6a461297ac3d0a83e14326a18779ca8e791` | Modified (`D3`, `P-1`, `P-2`, `T-4`, `VSC-R1`) |
| `src/viewports/brief.ts` | `47f0168196c427ec92d1fce3ef0dec099c3b81424a7a6bb78032e39d8d823528` | Modified (`T-1`, `VSC-R1`) |
| `src/viewports/index.ts` | `4b58a638fb7affd3df0ed28505e58a91fc3d6ad2c81af632a17681696ebac856` | Modified (`VSC-R1`) |
| `src/plugin.ts` | `3ea7e019fc74905db6a371146b31dec8b56040a1c462d56aea45eef68fe13020` | Modified (`TWM-R3`, `VSC-R2`, `REV-01` verified) |
| `src/rpc.ts` | `cf704d55f6d63e5ec156837b694b7bd123c3f235e14eba824a98637175f005f2` | Added (`P-7`, `T-12`, `VSC-R3`) |
| `tui.tsx` | `db66b52f6f417a66b5d4ce6f1e7bf98ae6eb52ab6623cf8a44a621e1dad3fe57` | Added (`P-7`, `T-12`, `VSC-R3`) |
| `src/tui/panel.tsx` | `abe7e52fc44066e34fa982c8735ea99d32558c7fa24cb0762df24e60ded012b7` | Added (`P-7`, `VSC-R3`) |
| `src/tui/sidebar.tsx` | `478d3b239bf9be6e10a2fb2d4db718829214da35b68ce14fe1550ca8764c65a6` | Added (`P-7`, `VSC-R3`) |
| `src/tui/status.tsx` | `e22923a8cd92cbd44fa081d5f43c38e64b191f78b9b76bb2e5826e0a7d3ce529` | Added (`P-7`, `VSC-R3`) |
| `src/tui/commands.tsx` | `7849e2b10a07cda5c53ef5d3cdd0cf73b77071c09b4b330c31cf22c226112a99` | Added (`P-7`, `VSC-R3`) |
| `src/cli.ts` | `18d00cc3149b08f408b2896df146886f59a8d89f81307793d46bddcab4ef1931` | Added (`P-8`, `VSC-R3`, `REV-03` verified) |
| `test/primitives.test.ts` | `ad151257983f964a79dd8a0d8d9ab15ca1d05e4f06551ad99cc8ce20de31e751` | Added (`TWM-R1`) |
| `test/tui-rpc.test.ts` | `932654ddf1275a5e24c1d72654b4f00343913999c9fd051a358ed9fdf8da5906` | Added (`VSC-R3`) |
| `test/plugin.test.ts` | `16f1922cf86494cca00168a6ae9d02c6372e7cf12bccad29a9bb842a7e1b0fe8` | Modified (`TWM-R3`, `VSC-R2`, `REV-01` verified) |

---

## Round 1 finding resolution log

1. **`REV-01` (`blocker`) - Resolved:** `src/plugin.ts` (`994` lines, SHA-256 `3ea7e019fc74905db6a371146b31dec8b56040a1c462d56aea45eef68fe13020`) and `test/plugin.test.ts` (`457` lines, SHA-256 `16f1922cf86494cca00168a6ae9d02c6372e7cf12bccad29a9bb842a7e1b0fe8`) are restored on physical disk and pass all `11` tests (`69` assertions) in `test/plugin.test.ts`.
2. **`REV-02` (`major`) - Resolved:** `src/honeycomb/cochange.ts:416` and `src/honeycomb/cochange.ts:715` now call `process.cwd()` instead of the string literal `"process.cwd()"`.
3. **`REV-03` (`minor`) - Resolved:** `src/cli.ts:600` now passes `projectRoot: effectiveProjectRoot` to `executeSubstrateAction`.
4. **`REV-04` (`nit`) - Closed:** `SUBSTRATE_RPC_ID` (`"hivemind-substrate"`) and `SUBSTRATE_PANEL_SLOT_ID` (`"hivemind-substrate.panel"`) in `src/rpc.ts:4-5` and `tui.tsx:138` are the canonical exported slot identifiers verified by `test/tui-rpc.test.ts`.

---

## Audit and remediation verification matrix (`D1..D3`, `P-1..P-8`, `T-1..T-12`)

| Item | Plan / ADR | Verification status |
|---|---|---|
| `TWM-R1` / `T-1..T-3`, `T-5`, `T-6` | `ADR-0029`, `ADR-0030` | **Verified:** `src/archive/primitives.ts` owns `sha256Hex`, `shortSha`, `estimateTokens`, `asObj`, `asStr`, `asNum`, `asArr`, `normalizeRepoPath`, `resolveDiskPath`, `safeJsonParse`, and `cleanExcerpt`. `src/archive/index-db.ts` owns `SCHEMA_DDL` and `ensureHoneycombSchema(db)` with idempotent column migration and pre-A3 watermark self-healing. |
| `TWM-R2` / `D3`, `P-1`, `P-2` | `ADR-0021`, `ADR-0022`, `ADR-0023` | **Verified:** `src/archive/normalize.ts` computes `slice_sha` over returned content and `blob_sha256` over full disk file content when a read is sliced (`start_line > 1`, `is_truncated = 1`, or `end_line < total_lines`), records `PARTIAL SLICE Lstart..Lend of total` in `src/archive/valve.ts`, and dynamically extracts `ProvenanceChainRow` records during `persist()` in `src/archive/index.ts`. |
| `TWM-R3` / `D2`, `P-3` | `ADR-0024` | **Verified:** `src/plugin.ts` implements `loadSessionMessagesForValve` via `ctx.session.context` + `sqliteSource` fallback and `ctx.tool.hook("execute.after")` JIT read skeletonization (`buildJitReadSkeletonFooter`), verified by `test/plugin.test.ts`. |
| `CSG-R1` / `T-1`, `T-11` | `ADR-0029`, `ADR-0034` | **Verified:** `src/honeycomb/index.ts` is trimmed to live public exports, `DEFAULT_REPO_ROOT` is removed, and `src/honeycomb/cochange.ts:416, 715` defaults to `process.cwd()`. |
| `VSC-R1` / `D1`, `P-6`, `T-4`, `T-7`, `T-8` | `ADR-0027`, `ADR-0031`, `ADR-0032` | **Verified:** `src/viewports/semantic-digest.ts` removes all `vs_s2_msg124_125_failure` and `S1`/`S2` fixture constants from `src/`, cleans `extractHeadline` with XML tag stripping and sentence-boundary truncation, and adds empty-DB diagnostics (`No indexed sessions matched...`). `src/viewports/continuity.ts` deletes the `630`-line `buildUnifiedContinuityDatabase` seed block. |
| `VSC-R2` / `P-4`, `P-5`, `T-9` | `ADR-0025`, `ADR-0026`, `ADR-0033` | **Verified:** `src/plugin.ts` registers only the 4 approved tools (`substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune`), supports `format?: "markdown" | "json" | "both"` with `[substrate.telemetry ...]` footer, and pushes `CompactionContinuationPacket` onto `event.system` on compaction. |
| `VSC-R3` / `P-7`, `P-8`, `T-12` | `ADR-0028`, `ADR-0035` | **Verified:** `src/rpc.ts`, `tui.tsx`, `src/tui/{panel,sidebar,status,commands}.tsx`, and `src/cli.ts` implement the OpenTUI companion surfaces and standalone CLI, verified by `test/tui-rpc.test.ts` (`8 pass, 0 fail`). |
