# WF-SUB-07: Unified Compaction Continuity & Provenance Chain Staleness Reconciler

- **ID:** `WF-SUB-07`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `resolved (prototype verified)`
- **Depends on:** `WF-SUB-01`, `WF-SUB-02`, `WF-SUB-03`, `WF-SUB-05`
- **Evidence Input:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)
- **Prototype Artifacts:**
  - [`scratch/prototypes/wf-sub-07-compaction-reconciler.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.ts)
  - [`scratch/prototypes/wf-sub-07-compaction-reconciler.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.test.ts)
  - [`scratch/prototypes/data/wf-sub-07-continuity.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-07-continuity.sqlite)

## Question

Can `hivemind-substrate` replace `.opencode/compaction-history/*.jsonl` with a SQLite-backed `compaction` hook that injects a deterministic `< 1,200`-token continuation packet (`WorkingMemoryManifest` + `intent_pivot` timeline + `delegation_turn` verified outcomes + `ProvenanceChain` staleness table + Tier-1 `RepoMap`) and defaults `sessionID` to the current session so post-compaction calls never fail with `"Specify action and sessionID"`?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-07-compaction-reconciler.ts`)

1. Prototype the unified `compaction` hook and `ProvenanceChain` table (`Finding -> Decision -> FileTouch/Commit -> VerificationReceipt`) over all real compactions in [`.session-archive/index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite) (`7` compaction rows across `6` distinct root sessions, plus `P1` release root session `ses_ecbfc0f40ffenfykTrNGoMS6o1`).
2. Verify that when a file's working-tree SHA diverges from the SHA recorded at a child review finding or earlier `read` call, the continuation packet flags that entry `STALE (modified since read/review)` while marking unchanged files `FRESH — DO NOT REREAD`.

---

## Resolution & Measured Evidence

**Yes.** [`wf-sub-07-compaction-reconciler.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.ts) unifies the outputs of `WF-SUB-01` (`session_semantic_digest`, `intent_pivot`, `substrate_fts`), `WF-SUB-03` (`kv_binding`, `kv_foreign_index`, `kv_context_prune`, `delegation_turn`, `snapshot_artifact`, `spill_artifact`), and `WF-SUB-05`/`WF-SUB-06` (`code_file`, `code_symbol`, `code_import_edge`, `git_cochange`) with four continuity tables in [`wf-sub-07-continuity.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-07-continuity.sqlite) (`provenance_chain`, `file_read_ledger`, `skill_load_ledger`, and `compaction_continuation_ledger`), replacing `.opencode/compaction-history/*.jsonl` completely.

### 1. Root Cause & Fix of `S1 msg[58]` (`compaction_continuity` Failure)

- **Observed failure in `S1` (`ses_eb2eabb14ffeCXsCwb845rtffb`, `msg[58]`):** Immediately after compaction at `msg[51]` (`seq=865`, `274,175` input tokens), the parent agent invoked `compaction_continuity({ action: "intents" })` without passing `sessionID`. In [`.opencode/plugins/compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L649-L690), `action === "intents"` required `typeof input?.sessionID === "string"` and fell through to line 690 (`return "Specify action and sessionID for compaction_continuity."`), triggering the 46-call panic reread loop across `msg[52..63]` (`15+` skills re-loaded, `28` files re-read, `163,972` chars).
- **Fix (`resolveDefaultSessionId` + `querySubstrateContinuity`):** `resolveDefaultSessionId(db, input.sessionID, hookContext)` deterministically resolves:
  1. `input.sessionID` (`source: "explicit_input"`)
  2. `hookContext.sessionID` (`source: "hook_context"`)
  3. `SELECT id FROM session WHERE depth = 0 ORDER BY COALESCE(t_updated, t_created, 0) DESC LIMIT 1` (`source: "sqlite_latest_root"`)
- Furthermore, `action` defaults to `"latest"`, so calling `querySubstrateContinuity(db, { action: "intents" }, { sessionID: "ses_eb2eabb14ffeCXsCwb845rtffb" })` or `querySubstrateContinuity(db, {})` with zero arguments always succeeds and never returns `"Specify action and sessionID"`.

### 2. Unified SQLite Schema in `wf-sub-07-continuity.sqlite`

| Table | Rows | Source / Role |
|---|---:|---|
| `session` / `delegation` / `message` / `tool_call` / `compaction` / `instruction` | `204` / `195` / `6,593` / `5,717` / `7` / `28` | Base archive spine from `.session-archive/index.sqlite` |
| `session_semantic_digest` / `intent_pivot` / `substrate_fts` | `15` / `72` / `329` | `WF-SUB-01` semantic digests, user intent pivots, and unified FTS5 |
| `kv_binding` / `kv_foreign_index` / `kv_context_prune` | `97` / `97` / `202` | `WF-SUB-03` OpenCode `opencode.db` `kv` durable bindings and prune state |
| `delegation_turn` | `202` | `WF-SUB-03` verified vs. reported child outcomes (`tool_error_inside`, `blocked_in_text`, `clean`) |
| `snapshot_artifact` / `spill_artifact` | `155` / `221` | `WF-SUB-03` shadow Git snapshot blobs and external tool-output spills |
| `code_file` / `code_symbol` / `code_import_edge` | `46` / `458` / `101` | `WF-SUB-05`/`06` Tree-sitter AST skeletons & PageRank centrality (`SUM(pagerank) = 1.0`) |
| `git_cochange` / `git_cochange_file_stats` / `git_cochange_commit` | `102` / `39` / `26` | `WF-SUB-06` Git temporal co-change matrix (`76` hidden couplings where `has_static_edge = 0`) |
| `provenance_chain` | `11` | `WF-SUB-07` end-to-end `Finding -> Decision -> FileTouch/Commit -> VerificationReceipt` chain with live `staleness_status` |
| `file_read_ledger` | `135` | `WF-SUB-07` per-session read ledger (`path`, `line_range`, `read_blob_sha`, `disk_blob_sha`, `staleness_status`) |
| `skill_load_ledger` | `78` | `WF-SUB-07` per-session active skills (`@skill_name`, `blob_sha`, `ACTIVE — DO NOT RE-INVOKE`) |
| `compaction_continuation_ledger` | `8` | `WF-SUB-07` materialized `< 1,200`-token continuation packets replacing `.opencode/compaction-history/*.jsonl` |

### 3. All 7 Compaction Events + `P1` Release Session (`< 1,200` Tokens & `< 2 ms` Latency)

Measured via 7 interleaved iterations after warmup across all 7 rows in `compaction`:

| # | Session ID | `seq` | Reason | `tok_input` | Packet Chars | Packet Tokens (`ceil(chars/4)`) | Budget (`< 1,200`) | Skills / Files in Manifest | Build Packet Median (`ms`) | Reconcile Staleness Median (`ms`) |
|---:|---|---:|---|---:|---:|---:|---|---|---:|---:|
| 1 | `ses_eb514ea32ffevrKDhWYxGBcpA9` | `638` | `manual` | `218,557` | `3,122` | **`781`** | PASS | `10` skills / `14` files | **`0.3472 ms`** (`min 0.2970, max 1.6180`) | **`0.1704 ms`** (`min 0.1496, max 0.3249`) |
| 2 | `ses_eb9f10d19ffehMNvwHyXOqUG5A` | `741` | `auto` | `270,425` | `2,985` | **`747`** | PASS | `8` skills / `14` files | **`0.3090 ms`** (`min 0.2849, max 0.4597`) | **`0.1596 ms`** (`min 0.1306, max 0.2387`) |
| 3 | `ses_eb3c0dd0cffedoOl9iOVMScosi` | `906` | `auto` | `41,653` | `3,339` | **`835`** | PASS | `10` skills / `14` files | **`0.2910 ms`** (`min 0.2596, max 0.3637`) | **`0.1216 ms`** (`min 0.1026, max 0.1414`) |
| 4 | `ses_eb2eabb14ffeCXsCwb845rtffb` (`S1` `msg[51]`) | `865` | `auto` | `274,175` | `4,151` | **`1,038`** | PASS | **`16` skills / `28` files** (100% of `S1 msg[52..63]` panic reread targets) | **`0.3523 ms`** (`min 0.3273, max 0.4198`) | **`0.1717 ms`** (`min 0.1570, max 0.3167`) |
| 5 | `ses_eb23bfbf0ffesn5kT0yJI06h35` (`S2` #1 `msg[82]`) | `847` | `auto` | `214,159` | `3,271` | **`818`** | PASS | **`10` skills / `14` files** (100% of `S2 msg[125..130]` reread targets) | **`0.3939 ms`** (`min 0.3650, max 0.6565`) | **`0.1950 ms`** (`min 0.1637, max 0.2805`) |
| 6 | `ses_eb23bfbf0ffesn5kT0yJI06h35` (`S2` #2) | `2020` | `auto` | `123,099` | `3,272` | **`818`** | PASS | **`10` skills / `14` files** (100% of `S2 msg[125..130]` reread targets) | **`0.3718 ms`** (`min 0.3652, max 0.5708`) | **`0.1725 ms`** (`min 0.1631, max 0.2629`) |
| 7 | `ses_eb18d653fffeUYQsp6vur5qKld` | `691` | `auto` | `246,009` | `3,174` | **`794`** | PASS | `10` skills / `14` files | **`0.3197 ms`** (`min 0.2898, max 0.4158`) | **`0.1287 ms`** (`min 0.1141, max 0.1598`) |
| — | **Aggregate Median Across All 7** | — | — | — | `3,271` | **`818`** | **ALL < 1,200** | — | **`0.3472 ms`** | **`0.1704 ms`** |

- **Benchmark Limiter Analysis (`benchmark-checklist` / `principle-explain-the-number`):** Latency is bounded by in-process `bun:sqlite` B-tree index lookups across `intent_pivot`, `file_read_ledger`, `skill_load_ledger`, `delegation_turn`, `provenance_chain`, `code_file`, and `git_cochange`, plus a single WAL `INSERT OR REPLACE` into `compaction_continuation_ledger`. Zero child subprocesses (`git`, `sqlite3`) and zero JSONL transcript scans run during the `compaction` hook.

### 4. Sample Synthesized Continuation Packet (`S1`: `ses_eb2eabb14ffeCXsCwb845rtffb`, `seq=865`, `1,038 tokens`)

```markdown
## Substrate Continuity · `ses_eb2eabb14ffeCXsCwb845rtffb` (seq=865, auto, 274175 tok_in)
**Headline:** [Root · ultra] Audit Prompt 2 design shortlist and land MH-28 driver seam with verified tests | **Gate:** `verified_passed` | **Session:** `ses_eb2eabb14ffeCXsCwb845rtffb`

### 1. Intent Pivot Timeline (5)
- `seq=1` [initial_goal] Audit the Prompt 2 design shortlist (`blob:1b42a684e577`)
- `seq=197` [verification_directive] Verify the shortlist against the real (`blob:dc67ef62db4b`)
- `seq=363` [scope_narrowing] Focus only on the MH-28 driver seam an (`blob:f59abce76ca1`)
- `seq=690` [course_correction] Fix the native delegation error-unwrap (`blob:4be4b8b517f0`)
- `seq=872` [continuation_after_compaction] Continue after compaction and finish M (`blob:bf12553a1e2e`)

### 2. Working-Memory Manifest (FRESH=28, STALE=0, Skills=16)
- **Skills (ACTIVE — DO NOT RE-INVOKE):** @ultra-mode(4b4642), @project-skeleton(2e0109), @code-review(89c2e1), @interrogate(769a2a), @to-tickets(1940e6), @implement-spec(57de4d), @implement(467b87), @tdd(9b7f58), @codebase-design(86ec75), @typescript-best-practices(f3a0b2), @verify-work(08c1e9), @atomic-git-commit(65bf13), @architect(30e719), @domain-modeling(119d47), @research(50e23a), @how(72d8b4)
- **FRESH — DO NOT REREAD:** .planning/STATE.md(e67e21), .planning/ROADMAP.md(673871), .planning/PROJECT.md(9c1e55), AGENTS.md(5e8249), docs/agents/issue-tracker.md(41f0bc), docs/agents/triage-labels.md(27a9d4), docs/agents/domain.md(8a31b0), docs/agents/artifacts.md(10f4c2), .planning/phases/multi-harness-delegation/SPEC.md(39f8a1), .planning/phases/multi-harness-delegation/PLAN.md(74e91c), .planning/phases/multi-harness-delegation/tickets/MH-28.md(62d0f4), .planning/phases/multi-harness-delegation/tickets/MH-29.md(91b3e8), .planning/phases/multi-harness-delegation/tickets/MH-30.md(c4a712), .planning/decisions.tsv(55d190), src/plugin.ts(f84bc2), src/delegate-tool.ts(a19d3e), src/delegation/harness-registry.ts(589ece), src/delegation/native-delegation.ts(6bb4a8), src/delegation/foreign-turn.ts(c83e11), src/delegation/setup-steps.ts(22f0a9), src/acp.ts(e9104b), src/wire-dialect.ts(44b8d1), src/devin-executable.ts(77c205), src/cross-os-platform.ts(88a1f3), test/multi-harness-routing.test.ts(90e4b2), test/native-permission-gates.test.ts(12f8c4), .audit/2026-10-18-prompt2-design-preparation/report.md(7b94aa), .audit/2026-10-18-prompt2-design-preparation/shortlist.md(33d9e1)

### 3. Delegation Trajectory (4 turns, 2 flagged)
- `ses_eb2e7d201ffevqFyDY7Grl9qgp` (t0 antigravity): reported=`succeeded` -> verified=`tool_error_inside` (err=5) — tool_error(read): Access to path "/Use
- `ses_eb2de30adffekzHz1bdAeltK83` (t0 opencode): reported=`succeeded` -> verified=`tool_error_inside` (err=1) — tool_error(read): File not found: .pla

### 4. Provenance Chain (2 chains, 0 stale)
- `F-MH28-DRIVER-SEAM` (seq=4, `ses_eb2de30bdffeNX47CukTbGn1td`) -> `src/delegation/native-delegation.ts` (`blob:6bb4a8c5c754` vs `blob:6bb4a8c5c754`, exit=0) => **VERIFIED_FRESH (FRESH — DO NOT REREAD)**
- `F-PROMPT2-SHORTLIST` (seq=4, `ses_eb2ddfc46ffeq8hNui9vhQZksX`) -> `.audit/2026-10-18-prompt2-design-preparation/report.md` (`blob:7b94aaccdd23` vs `blob:7b94aaccdd23`, exit=0) => **VERIFIED_FRESH (FRESH — DO NOT REREAD)**

### 5. Tier-1 RepoMap & Co-Change Alerts
- **RepoMap:** `src/acp.ts`(PR=0.126:scrubSpawnEnv[L170-L180]); `src/cross-os-platform.ts`(PR=0.118); `src/wire-dialect.ts`(PR=0.070:FailureClass[L17-L17]); `src/devin-executable.ts`(PR=0.055:ExecutableTarget[L52-L57])
- **Co-Change:** `src/delegate-config.ts<->src/harness-registry.ts`(80.0%,HIDDEN); `src/delegation/setup-steps.ts<->src/hosted-request-contract.ts`(66.7%,HIDDEN); `src/devin-executable.ts<->src/harness-antigravity.ts`(66.7%,HIDDEN)
```

### 5. Provenance Chain Staleness Transition Verification (Invariant 4)

Verified in [`wf-sub-07-compaction-reconciler.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-07-compaction-reconciler.test.ts):
1. **Unchanged working tree (`disk_blob_sha == repair_blob_sha == 6bb4a8c5c754`):**
   - `provenance_chain.staleness_status = "VERIFIED_FRESH"`
   - `file_read_ledger.staleness_status = "FRESH — DO NOT REREAD"`
   - `session_semantic_digest.verification_state = "verified_passed"`
2. **After working-tree edit (`src/delegation/native-delegation.ts` mutated to `deadbeef99990000cafebabe111122223333444455556666777788889999aaaa`):**
   - `reconcileProvenanceStaleness` transitions `chain_s1_mh28_driver_seam` to `verified_stale_by_later_touch` (`0.17 ms`).
   - `file_read_ledger` transitions `src/delegation/native-delegation.ts` from `FRESH — DO NOT REREAD` to `STALE (modified since read/review — re-verify slice)`.
   - `session_semantic_digest.verification_state` transitions from `verified_passed` to `verified_stale_by_later_touch`.
   - Regenerated continuation packet surfaces:
     - `**Gate:** verified_stale_by_later_touch`
     - `- **STALE (modified since read/review — re-verify slice):** src/delegation/native-delegation.ts#L1-L240 (read=blob:6bb4a8c5c754 != disk=blob:deadbeef9999)`
     - `- F-MH28-DRIVER-SEAM (seq=4, ses_eb2de30bdffeNX47CukTbGn1td) -> src/delegation/native-delegation.ts (blob:6bb4a8c5c754 vs blob:deadbeef9999, exit=0) => **STALE (modified since read/review — re-verify slice) [verified_stale_by_later_touch]**`
3. **After restoring original SHA (`6bb4a8c5c754`):**
   - Reconciler deterministically restores `VERIFIED_FRESH`, `FRESH — DO NOT REREAD`, and `Gate: verified_passed`.
