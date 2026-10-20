# RF-SUB-03 — Premise attack & design space

**Kind:** research / adversarial design review (read-only)
**Date:** 2026-10-20
**Subject:** `hivemind-substrate` @ `1bc36f6` (build `411,054` bytes)
**Mandate:** attack the stakeholder's premise ("called a lot, never useful") **and** the current design; rule on a replacement shape.
**Boundary:** no repository mutation. This file is the only artifact written.

---

## 1. The feature's own claim, from its own artifacts

`hivemind-substrate` claims to be a **local-first OpenCode V2 plugin that turns a live session into a queryable, content-addressed memory, and then gives that memory back to the model at the two moments the model would otherwise lose it.** Concretely, its own artifacts promise three things. (a) *Durability:* every turn, delegation, compaction, shadow-snapshot draft and external tool spill is appended to `.session-archive/` as a JSONL transcript plus `blobs/<sha256>.txt`, and indexed into `.session-archive/index.sqlite` — a relational store of sessions, delegations, milestones, prompts, file touches, provenance chains, verification receipts, AST skeletons, PageRank repo maps and Git co-change matrices (`.planning/PROJECT.md:7`, `GLOSSARY.md:15-17`, `.planning/architecture/ADR-001-three-layer-context-substrate.md:17`). (b) *Non-panicking context:* a step-watermark `WorkingSetValve` replaces old tool outputs with `FactBreadcrumb`s (`blob:<sha12>` handles + "DO NOT REREAD" verdicts) while a `WorkingMemoryManifest` states, per file, whether the bytes on disk still match what was read (`.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md:14-15`, `GLOSSARY.md:34-37`). (c) *Recoverable orchestrator state:* a Strategist can "reconcile 10 to 40+ delegated child trajectories across compactions by querying `TrajectoryMilestone` and `ProvenanceChain` records" (`.planning/PROJECT.md:16`), and after a compaction the agent is handed a deterministic `< 1,200`-token `CompactionContinuationPacket` instead of amnesia (`.planning/phases/viewport-synthesis-compaction/SPEC.md:191-197`). The stated success signal is explicit and measurable: *"zero-reread intra-turn pruning on 45+ step turns, deterministic post-compaction audit recovery across multi-harness children … and `< 200 ms` incremental indexing"* (`.planning/ROADMAP.md:8`). **The claim is therefore not "an archive" — it is "a memory that the model gets back without having to ask for it."**

---

## 2. Layer split: what needs a call, what runs without asking, and who pays

Three layers, sharply separated. The confusion between them is the root of the stakeholder's complaint.

### (a) STORE — `.session-archive/` (blobs + `index.sqlite`)

| Trigger | Site | Agent pays a call? |
|---|---|---|
| `persist()` during any `substrate.viewport` action | `src/plugin.ts:934` → `ensureSyncedDb` → `src/plugin.ts:407` | **Yes** (incidentally — every recall call re-persists) |
| `persist()` during any `substrate.valve` action | `src/plugin.ts:728` → `src/plugin.ts:407` | **Yes** (incidentally) |
| `persist()` on `compaction` hook | `src/plugin.ts:1216-1218` | No |
| `persist()` on `session.status:idle` / `session.compacted` | `src/plugin.ts:1400-1409` | No |
| `archive.persist` / `viewport({action:"sync"})` | `src/plugin.ts:892-894`, `1534-1552` | **Yes** (and then it is redundant) |

**Store is genuinely automatic.** The idle subscriber (`src/plugin.ts:1386-1446`) fires `ensureSyncedDb` on every idle turn; the compaction hook does the same. An agent that never calls anything still gets a complete, current archive. The store layer is *not* the failure.

**But every store read is a write.** `ensureSyncedDb` (`src/plugin.ts:385-440`) runs `persist()` **and** `materializeSemanticDigests()`, which does `DELETE FROM session_semantic_digest; DELETE FROM intent_pivot; DELETE FROM substrate_fts` and rebuilds them (`src/viewports/semantic-digest.ts:996-999`). So *a single `viewport` read call triggers a full digest + FTS5 re-materialisation of every indexed session.* Against the consuming repo's 924 sessions / 1,413 delegations (`.planning/decisions.tsv:8`) this is not free, and it makes "recall" a mutating operation wearing a read costume.

### (b) RECALL surface — `substrate.viewport` (16 actions), `substrate.valve`, `archive.persist`, `ctx.context-prune`

Tools registered: `src/plugin.ts:1451-1572`. One tool, `substrate.viewport`, exposes a 16-value `action` enum (`src/plugin.ts:1493-1513`: `status, resolve, timeline, provenance, compaction, sync, persist, search, find, repomap, skeleton, slice, coupled, brief, intents, latest`) over one flat parameter object (`src/plugin.ts:1490-1529`). `substrate.valve` is a 3-action tool (`src/plugin.ts:1465-1483`). Two legacy aliases (`archive.persist`, `ctx.context-prune`) duplicate two of them (`src/plugin.ts:1534-1571`).

**Every recall in this layer requires the agent to spend a tool call.** There is no push path. The spec forbids one: *"The plugin MUST NOT inject cross-session compaction history … into `context.system` on normal turns. Cross-session discovery happens on demand via `substrate.viewport`"* (`.planning/phases/viewport-synthesis-compaction/SPEC.md:199`). **The agent pays every one of these calls, in tokens, and gets nothing for free.**

Worse: **the recall corpus does not contain the answers.** The FTS5 index `substrate_fts(session_id, kind, symbol_or_path, body)` is populated with exactly five kinds (`src/viewports/semantic-digest.ts:1081-1159`):

- `intent_pivot` — the **human's** prompt text (`:1081-1086`).
- `decision` — the output of a regex heuristic over *shell output* (`:1090-1092`), whose two branches are literal fingerprints of two historical bugs: `/0 tool parts in range, ~0 chars of output/i` and `/Context pruned from the next model call onward.*53 tool parts in range/` (`:689-702`).
- `delegation` — the **description you gave the child** plus an outcome tag (`:1114-1120`).
- `headline` (`:1143-1148`), `touched_file` (`:1152-1157`).

**No assistant prose. No delegate report body.** The child's final report *is* archived — `delegation_turn.response_blob` exists in the DDL (`.planning/phases/trajectory-working-memory/SPEC.md:336`) and assistant text is sunk to blobs — but it is **not in the searchable corpus**. So "what did the delegate conclude?" is not a retrieval problem you can fix with a better ranking function; it is unanswerable from `search` by construction.

### (c) AUTOMATION — hooks and subscribers

| Mechanism | Site | Costs the agent a call? | Gives the agent *new* information? |
|---|---|---|---|
| `context` hook → valve prunes, injects `WorkingMemoryManifest` | `src/plugin.ts:1211-1213` → `src/archive/valve.ts:1413-1500` | No | No — it *removes* information and substitutes freshness claims |
| `compaction` hook → injects `< 1,200`-tok continuation packet | `src/plugin.ts:1216-1243` | No | **Yes** — but only at a compaction boundary |
| `execute.after` hook → JIT read skeleton footer on truncated reads; write/edit ledger | `src/plugin.ts:1247-1309` | No | **Yes** — but it is *code* structure, not *session* memory |
| `event.subscribe` idle/compacted → persist + RPC emit | `src/plugin.ts:1386-1446` | No | No — the event goes to the TUI, not the model |

**This is the crux.** Of four automatic surfaces, exactly one carries memory back to the model (`compaction` hook), and it fires only when the host compacts. The `context` hook is *always on* but its output is a pruning manifest — a claim about bytes, not a recall of decisions. The `execute.after` footer is always on and genuinely useful, but it answers "what is in this file", not "what did we decide".

**So the layer that the stakeholder is complaining about — recall of past decisions and delegate reports — has zero automatic surface and a corpus that cannot answer the question.**

Two further automation facts that matter:

- The `context` hook is inert until the valve is armed. Arming requires either an explicit `substrate.valve` call (agent pays) or the 65 %-window auto-trigger (`src/archive/valve.ts:1439-1468`).
- **The auto-trigger path does not write blobs to disk.** `armValve(..., persistBlobsToDisk: false)` at `src/archive/valve.ts:1464` and `:1482`; `sink()` honours it at `:652-667` (hash + in-memory `prefixIndex` only, no `writeFileSync`). The `blob:<sha12>` handle the model is told to call `resolve` on is therefore **process-local** until an unrelated `persist()` happens to write the same content; `resolve` on a handle whose content was never archived returns `Blob not found: <id>` (`src/plugin.ts:922-929`). This is a machine-generated wrong answer pointed straight at the model by a "DO NOT REREAD" instruction.

---

## 3. Adjudication of the stakeholder's failure taxonomy

### (a) "executed to store, never recall anywhere" — **SUPPORTED** (with one carve-out)

- The store is written on every idle event with no agent involvement (`src/plugin.ts:1400-1409`).
- The recall surface is pull-only by explicit specification (`.planning/phases/viewport-synthesis-compaction/SPEC.md:199`).
- The only automatic recall — the compaction packet — was **never observed to fire**: *"compaction packet — not reachable from any tool action"* (`.audit/2026-10-19-uat-walk-orchestrator/WALK-LOG.md:79`), and *"Observed: **0 delegations**, **0 compactions**. The delegation-outcome classifier never ran; the compaction packet never surfaced"* (`.audit/2026-10-19-uat-walk-orchestrator/REPORT-native-vs-substrate.md:39`). The same 10-19 walk: *"### 3 · Delegation Trajectory (0 turns, 0 flagged)"* (`.audit/2026-10-18-uat-runtime-observation/EVIDENCE.md:52`).
- Every phase UAT is `total: 3 · pass: 0 · issue: 0 · pending: 3` — the owner has never confirmed a single recall worked (`.planning/phases/*/UAT.md`); `.planning/STATE.md:5` still reads `UAT_PENDING`, and `:27` names owner UAT re-verification as the next step.
- Carve-out: the store *is* read by the automation (valve `resolve`, compaction packet, provenance). So it is not "never recall anywhere" — it is **never recall *proactively***. The distinction matters for the ruling: the missing thing is not a query, it is a **push**.

### (b) "recall takes more than 2 calls, or is worse than native tooling" — **SUPPORTED**

**More than 2 calls.** To learn what a child delegation reported, the agent must: (1) find the delegation (`search` returns only the *description*, `src/viewports/semantic-digest.ts:1114-1120`), (2) obtain the report's `blob:` handle (`status`/`timeline`/compaction packet — and the compaction packet only exists at compaction), (3) `resolve` the body (`src/plugin.ts:896-921`). Three calls minimum, and step 2's output is *not* available in the `search` result. Worse, the corpus lacks the report body, so step 1 cannot be answered by content search at all.

**Worse than native.** Measured, in-repo, against native `rg`/`ast-grep`/`git` (`.audit/2026-10-19-uat-walk-orchestrator/REPORT-native-vs-substrate.md:15-22`):

| Task | Substrate | Native |
|---|---|---|
| Repo overview | `repomap` 1,337 tok | `rg` 1,178 tok; `ast-grep outline src` 1,826 tok |
| Outline one file | `skeleton` 1,583 tok | `ast-grep outline` 1,079 tok |
| Locate + show a symbol | `slice` 14 tok | `rg` 103 tok (location only) |
| Cross-session recall | unique | impossible |

The report's own verdict: *"**For code understanding today, native (`rg` + `ast-grep` + `git`) is easier, cheaper, and works on every project.** The substrate's structural tier is not a moat"* (`:43`). And on the recall axis that *is* the moat: *"`search` returned the current session regardless of query — indistinguishable from `latest`"*, with *only **1 root session** indexed* (`:36`).

**Why `search` degenerates — code-level.** The FTS query is an OR of prefix tokens (`src/viewports/semantic-digest.ts:1399`) and the ranking adds an **active-session boost of `2.5`** to the score (`:1484-1491`). With one root session in the corpus, the current session wins by construction. The 2026-10-19 remediation tightened the zero-match case to require one non-numeric token match (`.planning/decisions.tsv:8` A3; `src/viewports/semantic-digest.ts:1477-1482`), so the honest statement today is: **"search returns the current session for any query sharing one non-numeric token with it."** That is still indistinguishable from `latest` on a one-session corpus, and the corpus is one session because the store is scoped to the project root by default.

**Honesty about staleness:** that native comparison was measured against the **pre-remediation** build (`de42f87`, 341,139 bytes) and has **not been re-measured** since. Its cross-project row (`:21`, *"impossible"*) is stale — fixed by `.planning/decisions.tsv:8` A2. Its skeleton token count is stale — the walk measured `skeleton valve.ts` at 858 tok (`WALK-LOG.md:57`). But its central claims — *native is cheaper on the structural tier*, *"search returns the current session regardless of query"*, *"only 1 root session indexed"*, *"0 delegations, 0 compactions"* — are claims about **the scale of the drive and the shape of the corpus**, not about the build. They stand.

**One more native-comparison finding the substrate itself got wrong:** `slice computeStepWatermark` cost **1,313 tok for ONE symbol — more than the whole-file skeleton** (`.audit/2026-10-19-uat-walk-orchestrator/WALK-LOG.md:58`, finding S2-1). The progressive-disclosure ladder is not monotone in cost.

### (c) "confusing callers making wrong calls, retrying with errors" — **SUPPORTED** (mechanism) / **PARTLY** (the "retrying with errors" half)

- **Wrong calls are structurally rewarded.** `executeViewport` defaults `action` to `"status"` (`src/plugin.ts:889`) and *any* unrecognised action falls through to the default branch, which then casts it to `"status"` and calls `querySubstrateContinuity` (`src/plugin.ts:1186-1191`). A confused caller asking for something that does not exist gets a **status packet instead of an error** — a wrong answer, not a loud failure. That is the opposite of a surface designed to be safe under confusion.
- **Two competing `search` implementations.** `src/viewports/continuity.ts:2100-2117` implements a `search` action as a naive `LIKE '%q%'` over `headline`/`key_decisions_json`/`touched_files_json` — but the tool's `search` branch (`src/plugin.ts:1135-1151`) calls `queryVibeNavigation` instead. The `continuity.ts` branch is unreachable from the tool. Two search semantics in one codebase, one live.
- **Error-shaped dead ends.** `Blob not found: <id>` (`src/plugin.ts:924`) is what a model gets when it follows the breadcrumb instruction from the auto-prune path whose blobs were never written (§2c). The model is *told* to call `resolve`; `resolve` fails; the model's next move is a retry.
- **Interface sprawl.** 4 tools / 3 namespaces for 2 capabilities (`.audit/2026-10-18-uat-runtime-observation/REPORT-product-design-gaps.md:55-59`, P-4); one tool with a 16-value action enum over a single flat schema (`src/plugin.ts:1493-1529`); 4 tools carry a telemetry footer but `metadata` — which holds counts, blob refs and statuses — is invisible to the model (`REPORT-product-design-gaps.md:73-76`, P-7).
- **The "retrying with errors" half is only PARTLY supported.** No audit artifact records a model retrying a failed substrate call. What is recorded is *silent misbehaviour*: *"search never says 'no match'"* (`WALK-LOG.md:46`, S1-4); *"same file shows FRESH **and** STALE at once"* (`:81`, S3-1); *"verdicts flipping `STALE→FRESH` between consecutive calls"* (`:106`, E-3). Silent wrong answers are worse than loud errors, but they are not retries.

### (d) "regressions to downstream — later turns and child sessions" — **PARTLY SUPPORTED** (real mechanism, no attributed incident)

**Real mechanism.** The `context` hook is registered **unscoped** (`src/plugin.ts:1211-1213`) and **mutates `event.messages`** in place (`src/archive/valve.ts:1490-1520`). The consuming repo documents the collision: *"both plugins register an **unscoped `session.hook("context")`** on the same events. The host invokes every scope-matched callback in registration order and last writer wins … Substrate can therefore change the in-memory messages our hook sees"* (`hivemind-steward-oc-devin-dev/.planning/research/delegation-faults-2026-10-19.md:196`). The same report flags that *"Whether the substrate plugin is also loaded twice (global + project) … duplicate loading was not inventoried"* (`:253`) — dual load means double persist, double prune, double RPC registration on the same DB.
**Truth instability is itself a downstream regression surface:** two ledgers disagree on what is tracked (`WALK-LOG.md:82`, S3-3), one file carries four distinct blob hashes across views (`:82`, S3-2), and the gate term disagrees between surfaces (`:44`, S1-1; `:83`, S3-5). A child agent that trusts `FRESH — DO NOT REREAD` and is wrong about it re-reads or, worse, edits stale bytes.

**No attributed incident.** The same forensic report concludes the substrate *"cannot produce F1/F2/F3 directly"* and *"cannot touch `owners`, `generation`, the binding store, or the claim maps"* (`delegation-faults-2026-10-19.md:194,196,198`). The three downstream delegation failures are attributed to the steward's own ownership/provenance logic, not to substrate. So: mechanism real, blast radius unproven, incident count zero.

---

## 4. Attacking the premise

### 4.1 Strongest case that the feature is fine and the problem is elsewhere

1. **The benchmark was run on the wrong axis.** The substrate's defensible reasons to exist are the *time/session* dimensions — cross-session recall, survive-compaction continuity, not-re-reading — because *"No native equivalent exists"* there (`.audit/2026-10-19-uat-walk-orchestrator/REPORT-native-vs-substrate.md:22`). The comparison instead measured `repomap`/`skeleton`/`coupled` against `rg`/`ast-grep`, an axis where native wins by construction and where the substrate itself concedes *"The substrate's structural tier is not a moat"* (`:43`). **You cannot conclude "never useful" from a drive that never triggered the feature**: *"`search` returned the current session regardless of query"*, *"only **1 root session** is indexed"*, *"Observed: **0 delegations**, **0 compactions**"* (`:36`, `:39`).
2. **The stakeholder is not the consumer of the agent-facing surface, and was never shown it.** Every value path is agent-tool-only: *"A human operator has no native surface to inspect the archive, the working set, or provenance"* (`.audit/2026-10-18-uat-runtime-observation/EVIDENCE.md:39-41`, consumer surface map at `:25-37`). The stakeholder's Stage-1 answer was *"None — only the agent's tool activity"* and their verdict on the freshness ledger was *"everything like same file freshness do not mean anything because I did not see it"* (`WALK-LOG.md:49`, `:87-88`). **A stakeholder cannot call a feature useless when they never had a way to invoke it.**
3. **The stakeholder's own stated priorities were not built.** *"#1 mudball/architecture advisor is the principle"* and *"#2 survive-compaction memory is most important but easy"* (`WALK-LOG.md:117-118`), with acceptance criteria X1-X5 at `:122-128`. The v3 remediation *did* build the mudball advisor and the TUI (`WALK-LOG.md:113-116`; `.planning/decisions.tsv:8` A1). So the product portfolio moved after the complaint.
4. **The consuming repo's agent contract never names the substrate surface.** The steward repo's `AGENTS.md` refers to *"the `substrate` ecosystem of `session-archive`, `compaction-history`, the `codebase intelligence`"* (`hivemind-steward-oc-devin-dev/AGENTS.md:56,60`) — a *vague noun*, no action names, no call policy. Meanwhile the discovery proposal that fed this build had a unified `substrate.recall({ view: "overview" | "prompts" | "delegations" | "files" | "commits" | "tools" | "blob" | "search" })` entry point (`.planning/wayfinder/HIVEMIND-SUBSTRATE-DISCOVERY.md:108`; byte-identical copy in the consuming repo at `hivemind-steward-oc-devin-dev/.planning/wayfinder/hivemind-substrate/HIVEMIND-SUBSTRATE-DISCOVERY.md:108`) and an explicit cognitive-load comparison (`:125`). **The shipped surface regressed away from its own design.**
5. **The store and the automation are sound and cheap.** The store is incremental, read-only w.r.t. the host, watermark-gated, and idempotent; the `context` hook is `< 2 ms` and in-memory; the `execute.after` JIT footer demonstrably works (`WALK-LOG.md:60`). A layer that saves 60-96 % of tool-output tokens with zero agent calls and zero risk is a *working feature*, and the stakeholder's taxonomy does not even mention it.

### 4.2 Strongest case that the feature's own design is at fault

1. **The corpus cannot answer the question the feature is sold on.** `substrate_fts` holds human prompts, delegation *descriptions*, headlines, file paths and regex-extracted "decisions" (`src/viewports/semantic-digest.ts:1081-1159`). It does **not** hold assistant prose or delegate report bodies. "Recall of past decisions / delegate reports" is therefore **not retrievable** — not poorly ranked, not expensive, *absent*. The whole 16-action surface is built on a corpus that excludes the sentences people want back.
2. **The "decision" extractor is a fingerprint of two old bugs.** The only non-prompt rows in the corpus come from `/0 tool parts in range, ~0 chars of output/i` and `/Context pruned from the next model call onward.*53 tool parts in range/` (`src/viewports/semantic-digest.ts:689-702`). These are *not* decisions. They are the two historical symptoms that motivated the project. A "decision recall" feature whose decision extractor matches two bug signatures will return two bug signatures, forever.
3. **Recall is specified as pull, and pull does not happen.** *"Cross-session discovery happens on demand via `substrate.viewport`"* (`.planning/phases/viewport-synthesis-compaction/SPEC.md:199`). Agents do not make on-demand calls to a tool they were never told to prefer, especially one whose output is a 1,100-1,401-token packet (`WALK-LOG.md:45`).
4. **Wrong calls succeed with wrong answers.** Unrecognised `action` values silently become `status` (`src/plugin.ts:1186-1191`); `search` never reports "no match" (`WALK-LOG.md:46`); verdicts flip between consecutive identical calls (`:106`, E-3); the same file reads FRESH and STALE simultaneously (`:81`, S3-1). A recall surface whose answer changes between two identical calls is **worse than `grep`**, which is deterministic.
5. **Reads are writes.** Every `viewport` call runs `persist()` *and* a full digest + FTS5 rebuild (`src/plugin.ts:934` → `:407` → `:430` → `src/viewports/semantic-digest.ts:996-999`). Recall is O(corpus) per call, by construction.
6. **The single-tool/16-action/flat-schema shape forces the model to learn an enum.** Natural questions ("what did the delegate conclude?") do not map onto `{status, resolve, timeline, provenance, compaction, sync, persist, search, find, repomap, skeleton, slice, coupled, brief, intents, latest}` (`src/plugin.ts:1493-1513`) without a decision procedure the tool does not provide.

### 4.3 Which survives

**Both — but they survive on different layers, and that is the actual finding.**

- The **store** (a) survives intact: automatic, incremental, read-only, honest.
- The **automation** (c) survives intact: the `context` hook, the `execute.after` footer and the idle subscriber deliver real value with zero agent calls and zero token cost. The *compaction* hook is the only one that carries memory back, and it fires too rarely to be the product.
- The **recall surface** (b) does **not** survive. It is at fault, and the fault is structural, not cosmetic: wrong corpus (no assistant prose, no delegate bodies), pull-only by spec, non-deterministic verdicts, mutating reads, and an enum-shaped interface that a confused caller can fail silently.

**And the premise is half-right.** The stakeholder's *"never useful"* is wrong about the store and the automation, wrong about the native comparison (measured on the wrong axis, against a pre-remediation build, on a corpus with 1 session and 0 delegations), and wrong about their own ability to see the agent-facing surface. But *"called a lot, never useful"* is **exactly right about the recall surface**, which is the only part of this feature that could have justified it. **The feature is not called a lot and not useful; it is called a lot and useful only where nobody looks.**

---

## 5. Design space — three structurally distinct shapes

### Option A — ONE ranked recall entry point exposing relational branches

`substrate.recall({ query, scope: "session"|"project"|"all", branches: ["decisions","delegations","prompts","files","blobs"], maxTokens })` → one call returns a ranked, branch-partitioned packet, each leaf carrying a `blob:` handle; a second `resolve` fetches any body. This is the shape the discovery proposal already drew (`.planning/wayfinder/HIVEMIND-SUBSTRATE-DISCOVERY.md:108`) and the build did not ship.

- **Cost:** rewrite the 16-action dispatcher (`src/plugin.ts:884-1206`, `:1493-1513`) into one action + branch enum; a branch-level renderer for each of 5 branches; FTS over assistant prose and delegate report bodies (**new ingestion** — this is the expensive half, not the surface); CLI + RPC + TUI contract changes (`src/cli.ts`, `src/rpc.ts:19-31`).
- **Breaks:** every existing UAT step (`viewport({action:"search"})`, `{action:"timeline"}`, `{action:"provenance"}`, `{action:"brief"}`), the RPC `SubstrateActionKind` union (`src/rpc.ts:19-31`), the CLI action table (`src/cli.ts:648-890`), and the steward's `@opencode/plugin/tui` consumers if any call the RPC directly.
- **Fails:** ranking a heterogeneous corpus by one BM25 score; over-OR'd prefix matching (`src/viewports/semantic-digest.ts:1399`) makes recall fuzzy, and the active-session boost of `2.5` (`:1484-1491`) still makes the current session win whenever it shares one token. On a one-session corpus the output is `latest` with extra steps. **Fixing the corpus fixes the ranking; fixing the ranking does not fix the corpus.**

### Option B — Always-on INJECTED index of handles (push, not pull)

Every turn, `ctx.session.hook("context")` prepends a ≤250-token block to `event.system`: the last N delegate reports as `blob:` handles with their `verified_status`, the last M typed decisions, and the active file ledger. The agent sees *that* the material exists and *where*; a body costs one `resolve`. Zero calls to know what exists; ≤1 call to read it.

- **Cost:** a write-time extractor producing a typed `Decision` / `DelegateReport` row set (the `delegation_turn.response_blob` column already exists — `.planning/phases/trajectory-working-memory/SPEC.md:336` — so the *handle* is already stored; only the *typing and summarising* is new); one injection point in the context hook; 250 tokens/turn of fixed overhead.
- **Breaks:** `REQ-SUB-15` §5, which *forbids* injecting cross-session content on normal turns (`.planning/phases/viewport-synthesis-compaction/SPEC.md:199`) — needs an owner decision, or restrict the block to the current session's own delegations/decisions, which still delivers "delegate reports"; and the `context` hook's `< 2 ms` budget (fine — a SQLite read, not a write).
- **Fails:** (i) **precision** — a wrong injected decision is worse than no injected decision, because the model is told to trust it; (ii) **fixed overhead** — 250 tok × 45 steps ≈ 11 k tokens per long turn, which the valve then has to claw back; (iii) **staleness** — the block is injected at turn N and may describe turn N-1 state; (iv) the *same* corpus gap as Option A — **if the extractor does not produce decisions and delegate reports, the injected index is an index of nothing.**

### Option C — Write-time compaction: make recall unnecessary

Distil every session **at persist time** into a typed ledger (`Decision`, `Finding`, `Repair`, `DelegateReport`, each with a `blob:` handle), and inject that ledger as the session's ambient memory. The tool surface shrinks; recall becomes a *read of a ledger that is already in context*.

- **Cost:** a deterministic, LLM-free extractor (must stay local-first, `.planning/PROJECT.md:30`) over assistant prose; a new table family; a rewrite of `analyzeSessionData`'s decision heuristics (`src/viewports/semantic-digest.ts:620-702`), which today are the two bug-fingerprints.
- **Breaks:** nothing structural — it is *additive* to the store and orthogonal to the 4-tool topology. The biggest break is the extractor itself: it must beat the existing regex heuristic, which is currently *worse than nothing* because it is over-fitted.
- **Fails:** **precision**, and only precision. If the extractor misses decisions, the ledger is empty and the agent falls back to `grep` — **the status quo**. This is the decisive property: Option C's failure mode is bounded by the current behaviour, whereas Option A's failure mode (bad ranking over a good corpus) and Option B's failure mode (wrong pushes) are both *worse* than the status quo.

**Common precondition for A and B (and the mechanism of C):** the corpus must contain assistant prose and delegate report bodies. Today it does not (`src/viewports/semantic-digest.ts:1081-1159`). No surface redesign can route around a missing corpus.

---

## 6. RULE

### Ruled: **Option B — the always-on injected index of handles (push)** — with Option C's write-time extraction as its hard precondition.

**Why B and not A or C.** A is a *pull* surface with a better shape; it does not attack the actual defect, which is that a pull surface is never pulled (`SPEC.md:199`; the whole corpus of audits shows zero spontaneous recall). C is a mechanism, not a shape — but the *shape* it implies is still pull: a well-populated ledger that the agent must remember to query. B is the only option that changes **who pays the call**: the agent pays 0 calls to know what exists and ≤1 to read it, and the *system* pays 250 tokens/turn instead. That is the only way to satisfy "≤2 calls, less token cost than native grep" **as a standing property** rather than as a happy-path property. B's precondition is C's extraction work; C's extraction work is required by A too. So B is chosen, C is built first, and A (a unified pull entry point) is deferred until B has proven there is a residual pull demand.

**What must be true for B to be right** (all four, or it fails):

1. **The extractor must produce typed decisions and delegate reports with a `blob:` handle that resolves.** `delegation_turn.response_blob` already exists (`.planning/phases/trajectory-working-memory/SPEC.md:336`) and assistant text is already sunk to blobs; the missing piece is *typing and summarising*, not storage.
2. **Precision must beat the current heuristic.** The incumbent "decision" extractor matches two historical bug strings (`src/viewports/semantic-digest.ts:689-702`) and must be replaced by something whose precision is defensible — a wrong decision injected into every turn is worse than no injection.
3. **The injected block must be bounded and per-session.** ≤250 tokens, one turn's worth, no cross-session content unless the owner amends `REQ-SUB-15` §5 (`.planning/phases/viewport-synthesis-compaction/SPEC.md:199`).
4. **The block must be the *only* push.** Adding a second injected surface re-creates the ambient-noise failure the valve exists to prevent.

**Smallest observable slice that proves it** (a behaviour change, not a component list):

> On a session with ≥3 child delegations and ≥1 compaction, from the **first** turn after a fresh plugin start, `ctx.session.hook("context")` injects into `event.system` exactly one block of ≤250 tokens containing: the 3 most recent delegate reports as `blob:<sha12>` handles each annotated with its `verified_status` (`reported=… -> verified=…`), and ≥2 typed decisions extracted from the parent's own prose. Every handle in the block resolves via `substrate.viewport({action:"resolve", blob:"…"})` to the exact archived text. Given a fixed probe set — *"what did child 2 report?"*, *"what did we decide about X?"* — the agent answers **from the injected block with zero substrate tool calls**, and every claim in the answer traces to a handle in that block.

**The falsifiable condition (the kill switch).** Run that probe on one real multi-delegation session. If, for ≥1 of 3 delegate reports, the injected handle is missing, wrong, or unresolvable — **or** if the block's decision rows are wrong or empty in a way that makes the agent answer incorrectly — **then push is the wrong shape and Option A (unified pull entry point) must be built instead.** Conversely, if the probe passes with 0 tool calls, the feature has its first honest proof of "useful", and the native-vs-substrate verdict (`.audit/2026-10-19-uat-walk-orchestrator/REPORT-native-vs-substrate.md:43-45`, *"net negative vs bashing"*) becomes falsifiable in the substrate's favour for the first time.

**What this ruling does not fix.** It does not make the human surface exist (the stakeholder's X1/X2: `WALK-LOG.md:122-128`), it does not make the truth layer singular (X5, two ledgers: `WALK-LOG.md:82`), and it does not unbreak the `context`-hook collision with the consuming repo (`.planning/research/delegation-faults-2026-10-19.md:196`) or the un-inventoried dual load (`:253`). Those are separate lines of work and must not be bundled into this slice.
