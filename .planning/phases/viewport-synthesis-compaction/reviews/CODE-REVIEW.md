# Two-axis code review for E1.1, E1.2, and E1.3

## Reviewer independence and candidate pin

- **Reviewer instance** `d4c5266e-f70c-4ca2-b116-b912be4a06cf` (fresh `code-review` subagent instance).
- **Author overlap** None. This reviewer instance did not author or edit any production file under `src/` or any test file under `test/`.
- **Base commit** `9a4e474b1086f83525507a087b1b6f1c02178df7`
- **Review scope** Phases `E1.1 trajectory-working-memory` (`TWM-01..05`, `REQ-SUB-01..08`), `E1.2 codebase-structural-graph` (`CSG-01..03`, `REQ-SUB-09..12`), and `E1.3 viewport-synthesis-compaction` (`VSC-01..04`, `REQ-SUB-13..18`).
- **Automated verification**
  - `bun run typecheck` passed with `0` errors (`tsc --noEmit`).
  - `bun test` passed with `127` passing tests, `1` skipped opt-in real-DB test (`ARCHIVE_REAL_DB=1`), `0` failures, and `2,159` `expect()` assertions across `19` files in `10.96s`.
  - `bun run build` bundled `src/plugin.ts` into `dist/session-archive.ts` (`339,618` bytes) with `0` errors.

### Pinned candidate SHA-256 manifest

| File | SHA-256 |
|---|---|
| `src/plugin.ts` | `5da704cd9764fa845e900826c81470eaa10573bb1093f22e737b689212e05819` |
| `src/spine/index.ts` | `5ea1ac60a2394133321203347ef260d6deeb373468e6d14ce06b6c59e039b7fc` |
| `src/archive/source.ts` | `b74ab1f3972329641b0bc38ba07f66817b3bdf9693aa7958cb1671632d62b7c6` |
| `src/archive/types.ts` | `11d072bbef5d8675f222198ce72ab855676dd80b4c764c6f53ec5305d138c678` |
| `src/archive/normalize.ts` | `e3cb91da7a5f51c31c1ba69d131b3221a73c49e060bce75b375f288670c72e88` |
| `src/archive/snapshots.ts` | `7b5e2cfd73a4293ba367b7e6f12205cafc162060c77028218137c546b16784fc` |
| `src/archive/spills.ts` | `b541419807a093ec24af5a110020fbe4fb1c364e9decb213870edf3c7af6c960` |
| `src/archive/index-db.ts` | `1817ab87feb7decbca556fcdf2184b5f812778fbdc352310ae67d8f07d196c7c` |
| `src/archive/index.ts` | `1c592fa2cdea9e7894ae6d09cf33a5b0fbf6f449b35c4a03d5218abcca67f27d` |
| `src/archive/valve.ts` | `e8bcb6076eab9bd8374f2cd275388ace92f9481265aeb0d08706c2e4300d3e5b` |
| `src/honeycomb/index.ts` | `a28b297343139e258cfaf3bd8030c6588e413eb45bcd933b66cea52a4c85cc2d` |
| `src/honeycomb/ast-skeleton.ts` | `38d788581dfa9c8bc0e21d0a5955b1ca7c75ee82cccc7b3a5337b03f45e90024` |
| `src/honeycomb/pagerank.ts` | `b4346e5f7f993ef7f5b261d0e278e32328a9549174e92c850194932fd75db788` |
| `src/honeycomb/cochange.ts` | `db2b772ec305bd4e88be5372b9d48a6eddf7ff2b9c49a7d8357302b76afe713e` |
| `src/viewports/index.ts` | `116a0041dbba54571a2d6572baebb46c2fe7e782ef963c36c96b4a274d612831` |
| `src/viewports/semantic-digest.ts` | `e01bd18bb4649dba54c1b718536e06ddc42023c676d40a09a05f3036344459bc` |
| `src/viewports/continuity.ts` | `0ef04e952c5bab65379d6d346422f35a47f89bb0b64a32738cf319312754bc5a` |
| `src/viewports/brief.ts` | `cbe0d31331e1ca3715fe38472aad16bf658317c4660f153053f12ccaeb90eb51` |
| `test/source.test.ts` | `9d499c32b2cdbdd817e2fde1b081e2ec95baee15af3413c4108ba51823468eff` |
| `test/normalize.test.ts` | `e2f304803c4085819050ab82132ebe92572efad0683a5c03907004cdff4d8952` |
| `test/snapshots-spills.test.ts` | `3accee0d674324841380fbc26449876830e91eca223e6b463f34660e1025b8cf` |
| `test/persist.test.ts` | `c7bd0ec08be952fde98aba118f4785e3b0d12c93237e201f03b34311ed8f027a` |
| `test/valve.test.ts` | `1ab66e92933d7927ec75b23701e718e6960eb16be4756df5ec11ab1a51650724` |
| `test/ast-skeleton.test.ts` | `1b718bf83e1d4f20b339de9bf8c77427477299933a561988449f2d7cf0660cff` |
| `test/pagerank-cochange.test.ts` | `a50a53fbfe24ab32b9d15790b9b39e2da8c246b58b92b5054fc822a49f0ff987` |
| `test/semantic-digest.test.ts` | `16a41f61c229686b9d3f73c5af41ef41b80cdb9bb7cc659204ef07178cb79507` |
| `test/continuity.test.ts` | `d1f9d004731f2694246f1d327153e68ad6aa7e41d7aef3e3bde7e32474c93345` |
| `test/brief.test.ts` | `a63d565944c706b306e430153c3fc7f6991c9f8e92cd07fda6905a965fa0965f` |
| `test/plugin.test.ts` | `53a164a6b1b367eaeaf839fb6f14ed0171a92b45a415a2c55edbd8757e894fd7` |

### Verdict summary

| Axis | Verdict | Blocker | Major | Minor | Nit | Worst finding |
|---|---|---|---|---|---|---|
| `Standards` | `approve` | 0 | 0 | 2 | 1 | `STD-01` (`minor`) workstation fallback constants in viewport and cochange modules |
| `Spec` | `approve` | 0 | 0 | 1 | 2 | `SPEC-01` (`minor`) missing explicit rejection when `options.dir` resolves inside `.opencode/` |

---

## Standards

**Axis verdict** `approve` (0 `blocker`, 0 `major`, 2 `minor`, 1 `nit`).

### Architecture and boundary audit

1. **Deep module boundaries (`codebase-design`)**
   - `src/plugin.ts` acts as a thin adapter shell (`430` LOC) that parses plugin options, registers tools, wires `context`, `compaction`, and `event.subscribe` hooks, and delegates all domain logic to the three deep modules `src/spine/index.ts`, `src/honeycomb/index.ts`, and `src/viewports/index.ts`.
   - `@opencode/plugin` is imported strictly with `import type`, preserving zero runtime coupling to the host package.
   - Public entry points support both `(db, rootDir)` and `(rootDir, db)` argument orders (`src/honeycomb/ast-skeleton.ts:1164-1215`, `src/honeycomb/ast-skeleton.ts:1443-1504`, `src/viewports/continuity.ts:1011-1091`) to prevent positional-argument mismatch errors across callers.

2. **Host read-only and boundary discipline (`principle-boundary-discipline`)**
   - `sqliteSource` (`src/archive/source.ts:294-310`) opens `opencode.db` strictly with `new Database(dbPath, { readonly: true })`, validates `REQUIRED_COLUMNS` across `project`, `session_v2`, `session_message`, and `kv` via `pragma_table_info`, and closes the handle in `catch` before throwing `session-archive: host schema drift: <table>.<column> missing`.
   - `sinkShadowSnapshots` (`src/archive/snapshots.ts:52-84`) reads OpenCode shadow bare Git repositories strictly via `git --git-dir=<repo> cat-file --batch` without mutating refs, index files, or object stores.

3. **SQLite WAL and transaction safety**
   - `initSyncDatabase` and `writeIncrementalIndex` (`src/archive/index-db.ts:414-429, 960`) configure `PRAGMA busy_timeout = 5000`, `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, and `PRAGMA foreign_keys = ON`, and execute all incremental mutations inside `tx.immediate()` (`BEGIN IMMEDIATE`).
   - All multi-row writes in `src/honeycomb/ast-skeleton.ts:1278`, `src/honeycomb/pagerank.ts:218`, `src/honeycomb/cochange.ts:547`, `src/viewports/semantic-digest.ts:969`, and `src/viewports/continuity.ts:1123` run inside explicit `db.transaction(...)` blocks.

4. **Critical-path latency and completed-work benchmarks**
   - `WorkingSetValve.applyContextHookInMemory` (`src/archive/valve.ts:1118-1327`) performs zero SQLite queries and zero disk I/O on the synchronous `context` hook path, achieving `< 2.0 ms` 7-sample median latency across a 90-message trajectory (`test/valve.test.ts:523-594`).
   - `persist` warm no-op delta sync completes in `< 2.0 ms` with zero message rows fetched (`test/persist.test.ts:522-543`), and 1-turn incremental delta sync completes in `< 150 ms` (`test/persist.test.ts:545-611`).
   - `computeCodebasePageRank` solves 20 power iterations over `Float64Array` CSR arrays in `< 2.0 ms` with `|SUM(pagerank) - 1.0| < 1e-6` (`test/pagerank-cochange.test.ts:27-41`).
   - `queryVibeNavigation` and `runSevenSampleCompactionBenchmark` both enforce completed-work checks before recording timings and hold `< 5.0 ms` and `< 2.0 ms` 7-sample medians respectively.

5. **Behavioral test quality (`principle-test-behavior-not-implementation`)**
   - The 11 candidate test suites exercise public module interfaces and verify independently computed SHA-256 digests, SQLite table rows, FTS5 rankings, token budgets, and staleness state transitions rather than mocking internal helpers.

### Standards findings

#### `STD-01` `[minor]` `standards` - Hardcoded workstation fallback paths and prototype fixture builders in production modules
- **Location** `src/honeycomb/cochange.ts:413`, `src/viewports/semantic-digest.ts:6-13, 211-225`, `src/viewports/continuity.ts:7-23, 734-736, 2080-2721`, and `src/viewports/brief.ts:103-106`.
- **Rule** `principle-boundary-discipline` and `codebase-design` (production modules should not embed developer-machine paths or test fixture builders).
- **Scenario** When invoked through `src/plugin.ts`, `projectRoot` and `archiveDir` are passed explicitly from `ctx.location.project.canonical`. However, calling exported library functions such as `mineGitCochange(db)`, `resolvePromptBlob(db, blobRef)`, or `buildSemanticDigestIndex()` without optional path overrides falls back to `/Users/MAC/Documents/coding-projects/...` paths from the `WF-SUB-01..07` prototypes. In addition, `buildUnifiedContinuityDatabase` and the `S1_PANIC_REREAD_*` / `S2_PANIC_REREAD_*` constants in `src/viewports/continuity.ts` are test-fixture builders bundled into `dist/session-archive.ts`.
- **Suggested direction** Derive fallback root and archive paths from `dirname(db.filename)` or `process.cwd()`, normalize repo paths relative to the supplied `canonicalRoot`, and relocate `buildUnifiedContinuityDatabase` and prototype fixture constants into `test/` helpers.

#### `STD-02` `[minor]` `standards` - Unbounded `kv` scan in `ingestHostKv` when `sessionIDs` is small
- **Location** `src/archive/source.ts:135-145`.
- **Rule** `codebase-design` and host SQLite query selectivity.
- **Scenario** `ingestHostKv` runs `SELECT key, value, time_created, time_updated FROM kv WHERE time_updated > ? ORDER BY key` and filters matching session IDs in JavaScript via `sessionFilter`. On a cold sync (`sinceTimeUpdated = 0`) against a host `opencode.db` containing many unrelated `kv` rows, every row is read and decoded before filtering, even when `sessionIDs` contains only a single session tree.
- **Suggested direction** When `sessionIDs` is non-empty and small, query exact key matches (`session:<id>:context-prune:<id>`, `delegate-mode/child/<id>`) and suffix matches (`key LIKE plugin:%:bindings/ || ?`) with `AND time_updated > ?`, plus the single `foreign-session-index` key.

#### `STD-03` `[nit]` `standards` - Unconditional file copy from `scratch/prototypes/data/` in `test/continuity.test.ts` and `test/brief.test.ts`
- **Location** `test/continuity.test.ts:54-56` and `test/brief.test.ts:42-44`.
- **Rule** `principle-test-behavior-not-implementation` (hermetic test setup on clean checkouts).
- **Scenario** `test/ast-skeleton.test.ts` and `test/pagerank-cochange.test.ts` guard sibling repo reads with `if (!existsSync(STEWARD_ROOT)) return`, and `test/semantic-digest.test.ts` guards real-archive tests with `if (!hasRealArchive) return`. By contrast, `test/continuity.test.ts` and `test/brief.test.ts` call `buildUnifiedContinuityDatabase()` in `beforeAll` without checking `existsSync(DEFAULT_WF01_DB_PATH)`, which will fail with `ENOENT` if `scratch/prototypes/data/` is removed.
- **Suggested direction** Guard the prototype-data describe block with `existsSync(DEFAULT_WF01_DB_PATH)` or synthesize a minimal in-memory seed database when `scratch/prototypes/data/` is absent.

---

## Spec

**Axis verdict** `approve` (0 `blocker`, 0 `major`, 1 `minor`, 2 `nit`).

### Requirement traceability matrix (`REQ-SUB-01..18`)

| Requirement | Phase / Ticket | Implementation locus | Verification locus | Status |
|---|---|---|---|---|
| `REQ-SUB-01` | `E1.1` / `TWM-01`, `TWM-04` | `src/plugin.ts:77-80`, `src/archive/layout.ts:8-37`, `src/archive/index.ts:177-409` | `test/persist.test.ts:191-396`, `test/plugin.test.ts:139-160` | Satisfied (see `SPEC-01` for explicit `.opencode/` option guard) |
| `REQ-SUB-02` | `E1.1` / `TWM-01` | `src/archive/source.ts:10-358` (`REQUIRED_COLUMNS`, `decodeHostKvKey`, `ingestHostKv`, `sqliteSource`) | `test/source.test.ts:6-146` | Satisfied |
| `REQ-SUB-03` | `E1.1` / `TWM-02` | `src/archive/normalize.ts:819-1085` (`segmentChildStops`, `classifyMessagesOutcome`, `normalizeDelegationTurns`) | `test/normalize.test.ts:495-700`, `test/persist.test.ts:488-504` | Satisfied |
| `REQ-SUB-04` | `E1.1` / `TWM-02` | `src/archive/normalize.ts:248-680` (`normalizeUser`, `normalizeSkill`, `normalizeShell`, `extractSessionLedgers`) | `test/normalize.test.ts:27-55, 334-493` | Satisfied |
| `REQ-SUB-05` | `E1.1` / `TWM-03` | `src/archive/snapshots.ts:1-145`, `src/archive/spills.ts:1-141` | `test/snapshots-spills.test.ts:67-281`, `test/persist.test.ts:437-487` | Satisfied |
| `REQ-SUB-06` | `E1.1` / `TWM-04` | `src/archive/index-db.ts:414-455, 761-965`, `src/archive/index.ts:174-410` | `test/persist.test.ts:505-691` | Satisfied |
| `REQ-SUB-07` | `E1.1` / `TWM-05` | `src/archive/valve.ts:452-641, 1118-1327` (`computeStepWatermark`, `applyContextHookInMemory`) | `test/valve.test.ts:22-160, 466-595` | Satisfied |
| `REQ-SUB-08` | `E1.1` / `TWM-05` | `src/archive/valve.ts:223-450, 643-1116` (`BlobStore`, `formatFactBreadcrumb`, `WorkingSetValve`, `KEEP_RESULT`, `KEEP_INPUT`) | `test/valve.test.ts:162-464`, `test/plugin.test.ts:162-223` | Satisfied |
| `REQ-SUB-09` | `E1.2` / `CSG-01` | `src/honeycomb/ast-skeleton.ts:183-1155` (`scanLexicalLines`, `skeletonizeSource`, Depth-2 closure factory scanner) | `test/ast-skeleton.test.ts:23-208` | Satisfied |
| `REQ-SUB-10` | `E1.2` / `CSG-01` | `src/honeycomb/ast-skeleton.ts:127-181, 1157-1551` (`indexCodebase`, `readAstSkeleton`, `readSymbolSlice`) | `test/ast-skeleton.test.ts:210-365` | Satisfied |
| `REQ-SUB-11` | `E1.2` / `CSG-02` | `src/honeycomb/pagerank.ts:110-498` (`computeCodebasePageRank`, `renderRepoMap`) | `test/pagerank-cochange.test.ts:27-90, 181-238` | Satisfied |
| `REQ-SUB-12` | `E1.2` / `CSG-03` | `src/honeycomb/cochange.ts:207-790` (`mineGitCochange`, `updateGitCoChangeIncremental`, `queryCochangeCouplings`) | `test/pagerank-cochange.test.ts:92-179, 239-348` | Satisfied |
| `REQ-SUB-13` | `E1.3` / `VSC-01` | `src/viewports/semantic-digest.ts:242-1664` (`classifyIntentPivot`, `materializeSemanticDigests`, `queryVibeNavigation`) | `test/semantic-digest.test.ts:23-461` | Satisfied |
| `REQ-SUB-14` | `E1.3` / `VSC-02` | `src/viewports/continuity.ts:744-805, 1011-1216` (`reconcileProvenanceStaleness`, `renderProvenanceReport`) | `test/continuity.test.ts:257-365` | Satisfied |
| `REQ-SUB-15` | `E1.3` / `VSC-02` | `src/viewports/continuity.ts:1267-1704` (`buildCompactionContinuationPacket`, `applyCompactionContinuityHook`) | `test/continuity.test.ts:176-255, 367-380`, `test/plugin.test.ts:277-299` | Satisfied (see `SPEC-02`) |
| `REQ-SUB-16` | `E1.3` / `VSC-02` | `src/viewports/continuity.ts:827-948` (`resolveDefaultSessionId`) | `test/continuity.test.ts:123-174`, `test/plugin.test.ts:225-275` | Satisfied |
| `REQ-SUB-17` | `E1.3` / `VSC-04` | `src/plugin.ts:82-429` (`substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune`, `substrate`, `viewport`, hooks) | `test/plugin.test.ts:114-315` | Satisfied (see `SPEC-03`) |
| `REQ-SUB-18` | `E1.3` / `VSC-03` | `src/viewports/brief.ts:234-614` (`buildImplementorViewportBrief`) | `test/brief.test.ts:54-138`, `test/plugin.test.ts:269-275, 301-314` | Satisfied |

### Spec findings

#### `SPEC-01` `[minor]` `spec` - `resolveArchiveDir` and `persist` do not explicitly reject custom `options.dir` paths resolving inside `.opencode/`
- **Location** `src/plugin.ts:77-80` and `src/archive/index.ts:177`.
- **Requirement** `REQ-SUB-01` (Phase `E1.1 SPEC.md` Requirement `REQ-SUB-01` item 4 states that any caller-supplied `options.dir` resolving inside `.opencode/` is rejected with an explicit error).
- **Scenario** Omitting `options.dir` defaults safely to `<canonicalRoot>/.session-archive`. However, passing `options: { dir: ".opencode/archive" }` resolves to `<canonicalRoot>/.opencode/archive` without throwing, which would trigger OpenCode hot-reloads when archive files are written.
- **Suggested direction** Validate the resolved archive directory against `path.join(projectRoot, ".opencode")` in `resolveArchiveDir` and `persist`, and throw an explicit error if the target directory equals or is nested within `.opencode/`.

#### `SPEC-02` `[nit]` `spec` - `session.compacted` event listener in `src/plugin.ts` does not call `recordCompactionSummaryHash`
- **Location** `src/plugin.ts:398-407` and `src/viewports/continuity.ts:1658-1681`.
- **Requirement** `REQ-SUB-15` (Phase `E1.3 SPEC.md` Requirement `REQ-SUB-15` item 5 states that on `session.compacted`, `summary_hash` is updated on the corresponding `compaction_continuation_ledger` row).
- **Scenario** `recordCompactionSummaryHash` is implemented and exported in `src/viewports/continuity.ts:1658`, and `ctx.event.subscribe` in `src/plugin.ts:398` handles `session.compacted` by calling `ensureSyncedDb(sessionID)`. However, `src/plugin.ts` does not invoke `recordCompactionSummaryHash` after syncing, leaving `summary_hash` unset unless called directly.
- **Suggested direction** In the `session.compacted` branch of `src/plugin.ts`, look up the latest `compaction.summary_ref` (or event summary text) after `ensureSyncedDb(sessionID)` and pass it to `recordCompactionSummaryHash`.

#### `SPEC-03` `[nit]` `spec` - Plugin export `id` is `"session-archive"` whereas `E1.3 SPEC.md` illustrates `id: "hivemind-substrate"`
- **Location** `src/plugin.ts:83`.
- **Requirement** `REQ-SUB-17` (Phase `E1.3 SPEC.md` section "Public API & Narrow Surface (`src/plugin.ts`)").
- **Scenario** `src/plugin.ts:83` sets `id: "session-archive"` to preserve backward-compatible plugin identification with the existing `dist/session-archive.ts` bundle and host configuration, while `E1.3 SPEC.md` writes `id: "hivemind-substrate"`.
- **Suggested direction** Note in `E1.3 SPEC.md` that `id: "session-archive"` is retained for drop-in host compatibility.
