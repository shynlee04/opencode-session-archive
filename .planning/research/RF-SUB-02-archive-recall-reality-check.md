# RF-SUB-02 — Archive Recall Reality Check

- **Date:** 2026-10-20
- **Status:** COMPLETE
- **Author:** hm-researcher (read-only investigation)
- **Live archive measured:** `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/`
- **Index:** `index.sqlite` = 128,376,832 bytes (122 MiB), `blobs/` = 1.0 GB, `sessions/` = 219 MB

## 0. Safety and method

The CLI is **not read-only**: `runSubstrateCli` opens the DB with `new Database(effectiveDbPath)` (`src/cli.ts:1088`), and every action runs `ensureContinuitySchema`, `ensureSemanticDigestSchema`, `ensureCodeGraphSchema`, `ensureCochangeSchema` (`src/cli.ts:635-638`), then `ensureCodeGraphIndexed` + `reconcileProvenanceStaleness` inside `buildSubstrateSnapshot` (`src/cli.ts:285-298`). Pointing it at the live archive would rebuild schemas/code graph and contend with the host persist loop. Therefore **all CLI measurements ran against a copy** at:

```
TMP=/private/var/folders/wn/.../T/substrate-recall.tpSj26/index.sqlite
cp <live>/index.sqlite "$TMP/index.sqlite"
bun src/cli.ts <action> --project-root <live project> --db "$TMP/index.sqlite"
```

Raw `sqlite3 "file:...?mode=ro"` queries ran against the live file and performed no writes. The live archive is **actively being persisted** (shm present, blob file count moved 59,812 → 59,913 during this investigation), so every number below is a snapshot with ±small drift.

---

## 1. Task 1 — Index row counts (measured)

```sh
sqlite3 "file:$PWD/index.sqlite?mode=ro" "SELECT COUNT(*) FROM <table>;"
```

| Table | Rows |
|---|---:|
| `session` | 1,009 |
| `message` | 23,825 |
| `delegation` | 1,315 |
| `delegation_turn` | 1,116 |
| `tool_call` | 68,057 |
| `file_touch` | 4,525 |
| `milestone` | **0** |
| `session_semantic_digest` | 1,009 |
| `intent_pivot` | 1,836 |
| `substrate_fts` | 9,225 |
| `substrate_fts_content` | 9,225 |

**Verdict:** the honeycomb is populated, except `milestone` is a completely dead table (0 rows). FTS is not empty.

---

## 2. Task 2 — Is FTS populated and does MATCH rank meaningfully?

### Exact queries and results

```sql
SELECT COUNT(*) FROM substrate_fts;                         -- 9,225
SELECT kind, COUNT(*) FROM substrate_fts GROUP BY kind;
```

| kind | rows | avg body chars | max body chars |
|---|---:|---:|---:|
| `touched_file` | 4,969 | 171.0 | 391 |
| `intent_pivot` | 1,836 | 2,155.4 | 25,056 |
| `headline` | 1,009 | 166.1 | 303 |
| `delegation` | 1,287 | 149.6 | 209 |
| `decision` | 124 | 104.8 | 231 |

```sql
-- Agent-natural unquoted form:
SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH 'NBR-08';
-- ERROR: no such column: 08   (FTS5 parses '-' as NOT)

-- Correct quoted form:
SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH '"NBR-08"';   -- 79
SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH '"MH-36"';    -- 14
SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH 'antigravity';-- 2,914
SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH '"independent review"'; -- 211
```

Ranking quality:

- `"NBR-08"` → 79 hits. Top 6 by `bm25` are all `touched_file` rows (`.audit/NBR-08/receipt.md`, ticket files), tied around `-9.0`. The actual NBR-08 **delegate reports are not in FTS at all** — only their descriptions (~150 chars) and touched paths are.
- `antigravity` → 2,914 hits, and the top five child headlines all score **`-1.6086`** because their bodies share the same `[Child · antigravity/...]` prefix. The ranking is effectively a tie among hundreds of rows; it does not discriminate a specific antigravity decision.
- `"independent review"` → 211 hits; top rows are touched `.audit/...independent-review` files, which is useful for locating audit artifacts but says nothing about what was found.

**Verdict:** FTS is populated and matches, but it indexes **summaries and file touches, not content**. The hyphen form is a raw SQL trap; the CLI avoids it by tokenizing into quoted prefixes. Ranking is dominated by shared boilerplate, not relevance.

---

## 3. Task 3 — CLI recall actions: latency, size, usefulness

All wall-clock figures include the per-invocation code-graph reindex + snapshot build that every action triggers.

| Action | Wall | Bytes | Tokens (substrate `estimateTokens`) | Answers? |
|---|---:|---:|---:|---|
| `status` | 730 ms | 4,839 | **1,199** | No — current session/gate, not history |
| `search "what did the delegate report about NBR-08"` | 480 ms | 1,749 | **432** | **No** — right root, wrong delegations, no report |
| `search "antigravity harness cwd"` | 330 ms | 1,643 | **405** | **No** — zero `cwd` content |
| `search "what did the independent review find"` | 340 ms | 1,611 | **397** | Partial — locates `run.md`, no findings |
| `timeline` | 310 ms | 1,788 | **444** | No — 12 root pivots only |
| `provenance` | 390 ms | 50,590 | **12,559** | No — stale-file ledger noise |

### Q1 — “What did the delegate report about NBR-08 / MH-36?”

The correct root **is** found (`ses_ead1e4d2fffedglSPWcm1QJEz8`, coverage 5/6, score 260), but the output's three delegations are:

```
Split stale registration test
Close REL13 and REL11 gaps
Close MH41 and REL12 items
```

Those are exactly the **three most recent delegations by `t_created`**, not the NBR-08 delegations. Ground truth in the DB:

```
Review NBR08 coding standards      (devin/reviewer-1)    8,133 chars
Final spec review NBR08            (antigravity/reviewer-2) 7,554 chars
Integrate verified NBR08           (devin/delegate)     8,323 chars
```

Root cause in code: `delegationsStmt` orders by `t_created DESC LIMIT 20` (`semantic-digest.ts:1323-1329`), then `maxDelegations = 3` takes the first three. No query relevance enters the delegation branch. The search output never contains the string `NBR-08` except `.audit/NBR-09/checkpoint.md` (wrong ticket).

### Q2 — “What decision was made about the antigravity harness cwd?”

The output contains **zero occurrences of `cwd`** except the query echo. FTS phrase `"harness cwd"` returns 5 rows, all `intent_pivot` prompt bodies, none a decision. The root returned by search (`ses_ec4a50d6...`) has only one generic `cwd`-containing pivot. Whether the historical decision lives in a delegate report or in a transcript, **no action surfaces it**.

### Q3 — “What did the independent review find?”

Best of the three: search surfaces `.audit/2026-10-20-executable-consistency-review/run.md` and `.audit/2026-10-20-legacy-harness-policy-review/open-findings.md` in 397 tokens. It gives the **location**, not the findings.

**Verdict:** actions are fast (310–730 ms) and cheap (~400 tokens), but they are **navigation indexes, not recall**. None of the three questions is answered.

Minor contract bug: `search` is called with default `maxTokens = 350` (`cli.ts:826`), yet emits **432 tokens**; the shrink loop (`semantic-digest.ts:1730-1736`) does not actually enforce the cap.

---

## 4. Task 4 — Are delegate child sessions linked, and are their outputs indexed?

```sql
SELECT COUNT(*) FROM delegation;                                      -- 1,315
SELECT COUNT(*) FROM delegation WHERE child_session IS NOT NULL AND child_session!=''; -- 1,315
SELECT COUNT(DISTINCT child_session) FROM delegation;                 -- 878
SELECT COUNT(*) FROM delegation d JOIN session s ON s.id=d.child_session; -- 1,315
```

- Every delegation has a child session and every child exists in `session`.
- 877 of 878 distinct children have `message` rows; **8,282 child message rows** total.
- `delegation_turn`: 1,116 rows; **1,039 have `response_blob`** (1,028 distinct 64-hex shas); 1,115 have `prompt_blob` (1,109 distinct). Verified outcomes: 737 `verified_pass`, 274 `tool_error_inside`, 43 `empty_output`, 43 `reported_only`, 14 `blocked_in_text`, 5 `verified_fail`.

The output **text** does exist — as a content-addressed blob, not as a message body. For `Review NBR08 coding standards`:

```
response_blob = 835b1f1293f54eab14fde55441c5fc02b8170da9f9c46391260fb7e21ab1eadf
blobs/<sha>.txt = 8,441 bytes / 8,356 chars / ≈2,089 tokens
```

`message` has **no text column** (only `kind`, `agent`, token counts), so child message rows are metadata, not recallable text.

**Verdict:** linkage is complete (parent → child → turn → blob), but the report body is **not indexed for retrieval** and **no action surfaces `response_blob`**. `grep -rn "response_blob" src/cli.ts src/viewports/*.ts` returns schema declarations only.

---

## 5. Task 5 — Are relational branches exposed in one or two calls?

**No.** Measured structural blockers:

1. Actions accept a session ID, but `resolveDefaultSessionId` maps any `depth > 0` child to its root (`continuity.ts:842-845`). Passing the NBR-08 child `ses_eabcd26dbffe...` to `timeline` and `status` both returned the **root** `ses_ead1e4d2...` (390 ms/430 ms, 3,726/4,841 bytes). Child sessions are structurally unaddressable.
2. The FTS row for a delegation stores `session_id` = **parent** session and `symbol_or_path` = **child session id** (30 chars). So the key exists, but no action joins it.
3. A naive FTS→`delegation` join on `parent_session` is wrong: it returns all delegations of the parent, not the matched one. Measured for `"NBR-08"`: 6 returned rows, only **1** relevant (`Final spec review NBR08`); the rest were MH42 delegations of the same parent.
4. `search` prints child IDs but no call_id, report ref, turn outcome per child, or file-touch linkage. `status` prints root pivots + stale files. `provenance` prints child-session chain IDs, not delegation relations.

The full chain (`session → delegation → child session → turn → blob`) exists only in SQL and takes at least two joins plus a blob read. There is no one-call relational viewport.

---

## 6. Task 6 — Reachability audit: archived but unreachable

| Content | Volume | Reachable by an action? |
|---|---:|---|
| Blob files | **59,913** regular files (1.0 GB) | **No action returns blob text.** `status`/`timeline`/`search` print only 12–17-char `blob:` refs. |
| Indexed 64-hex blob refs (14 columns scanned) | 16,597 distinct | 11,344 resolve to a blob file |
| Blob files not referenced by scanned columns | **48,569** (upper bound; excludes `code_file`, `code_symbol`, `instruction` columns) | No |
| Refs with no blob file | **5,253** dangling | Broken |
| `sessions/*.jsonl` transcripts | 2,050 files / **219 MB**; 1,012 `session.transcript_path` rows | **No** — `transcript_path` is written by the archiver (`index.ts:856`) but read by no action |
| `tool_call` outputs | 68,057 rows, 124 with `output_path` | **No** action surfaces tool outputs |
| `message` bodies | 23,825 rows, no text column | Only summaries/pivots are text-searchable |
| FTS delegation/decision bodies | avg 150 / 105 chars | Summaries only, never reports |
| `milestone` | 0 rows | Dead table |
| `intent_pivot` | 1,836 rows, avg 2,155 chars up to 25,056 | Search returns 5 pivots per root, excerpted to 14–44 chars |

The useful implication: `grep -r .session-archive/sessions` is not an optional fallback — it is currently the **only** way to read transcript/report content, while `blobs/` is content-addressable but has no read action.

---

## 7. Task 7 — Substrate recall vs native `grep` + `read` (one concrete question)

Question: **“What did the delegate report about NBR-08?”**

### (a) Substrate path (measured)

| Step | Tokens | Wall | Result |
|---|---:|---:|---|
| `search "what did the delegate report about NBR-08"` | 432 | 480 ms | wrong 3 delegations, no report |
| hand SQL `delegation ⋈ delegation_turn` (one call, 8 rows incl. blob shas) | 541 | ~30 ms | correct child/report refs |
| read `blobs/835b….txt` (reviewer-1 report) | 2,089 | ~5 ms | actual answer |
| **Total (3 calls)** | **≈3,062** | **≈515 ms** | answers after hand SQL + blob read |
| **Minimum actual path (2 calls, skip search)** | **≈2,630** | **≈35 ms** | SQL + blob read |

### (b) Native `grep -r` + `read`

```sh
grep -rl 'NBR-08' sessions        # 2,410 ms, 104 hits, 11,534-byte hit list
```

| Step | Tokens | Notes |
|---|---:|---|
| hit list (11,534 bytes) | ≈2,884 | 104 files, mostly unrelated |
| `read` first hit (`276,906` bytes, 49 JSONL lines) | **69,117** | whole-file read |
| **Total (2 calls)** | **≈72,001** | finds transcript, not the report |

Precise literal `grep -rl 'Review NBR08 coding standards' sessions`: 2,009 ms, 4 hits, 101-token hit list, then reading the child transcript (216,330 bytes) = **54,083 tokens**; an assistant-only JSON extraction measured **50,625 tokens**. Even the smartest native path is ~20× the hand-SQL+blob path.

**Verdict:** substrate tokens are dramatically cheaper (≈2.6k vs ≈72k, ~27×) and can answer in 2 calls — but **only if the agent hand-writes SQL against undocumented `delegation_turn.response_blob` and reads the blob itself**. The shipped `search` action alone is 432 tokens and **does not answer**. So: cheap and accurate is achievable; cheap and accurate *through the recall surface as shipped* is not.

---

## 8. Headline findings

1. **FTS is populated but shallow.** 9,225 rows, five kinds, delegation bodies capped at ~209 chars. No report/transcript/tool-output content is indexed.
2. **`search` finds the right root, then throws away relevance.** Delegations are the three most recent for that root, not the ones matching the query (proven against `t_created` order and ground truth).
3. **Child sessions are first-class in the DB and second-class in the CLI.** Every action collapses a child ID to its root; the surfaced child IDs cannot be followed.
4. **Reports exist and are linked, but unreachable.** 1,028 distinct `response_blob` reports; no action prints or reads `response_blob`; every blob is text-invisible to the CLI.
5. **The CLI mutates the archive it inspects.** No read-only mode; each action ensures schemas and rebuilds the code graph.
6. **`search` exceeds its own token budget** (432 tokens at default 350).
7. **Native grep remains necessary** for transcript/report content; 48k+ blobs and 2,050 transcript files have no action path.

## 9. Recommendation (for architect/specifier)

- Add a `recall`/`ask` action scoped to the **delegation turn**: FTS delegation hit (`symbol_or_path` = child session) → `delegation_turn` → return `response_blob` plus a bounded head/tail excerpt (e.g. 600 tokens), with a `--full` escape hatch. Two calls, and the second is optional.
- Rank the delegation branch by query match (`bm25`/token overlap), never by `t_created`.
- Make child sessions addressable (`status --child`, `timeline --child`), or return a child-scoped viewport from search.
- Add `--readonly` (SQLite `readonly: true`, skip schema/index/reconcile writes) before any external agent points this CLI at a live archive.
- Enforce `maxTokens` by measuring the final markdown, not the pre-footer body.
- Either populate `milestone`/`tool_call`/transcript surfaces or document them explicitly as grep-only dead ends; index `response_blob` content (or at least a 2–4k-char report excerpt) in FTS.
- Document that raw FTS5 needs quoted ticket IDs (`'"NBR-08"'`); the CLI tokenizer already handles it.

## 10. Exact command appendix

```sh
# counts
sqlite3 "file:$ARCH/index.sqlite?mode=ro" "SELECT COUNT(*) FROM session;"
# FTS (quoted; unquoted NBR-08 is a syntax error)
sqlite3 "$DB" "SELECT COUNT(*) FROM substrate_fts WHERE substrate_fts MATCH '\"NBR-08\"';"
sqlite3 "$DB" "SELECT session_id,kind,symbol_or_path,substr(body,1,150),bm25(substrate_fts) FROM substrate_fts WHERE substrate_fts MATCH '\"NBR-08\"' ORDER BY bm25(substrate_fts) LIMIT 6;"
# linkage
sqlite3 "$DB" "SELECT COUNT(*) FROM delegation d JOIN session s ON s.id=d.child_session;"
sqlite3 "$DB" "SELECT response_blob FROM delegation_turn WHERE response_blob!='' LIMIT 5;"
# CLI (on a copy; live archive protected)
cp "$ARCH/index.sqlite" "$TMP/index.sqlite"
cd /Users/MAC/Documents/coding-projects/hivemind-substrate
/usr/bin/time -p bun src/cli.ts search "what did the delegate report about NBR-08" \
  --project-root /Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev \
  --db "$TMP/index.sqlite"
bun src/cli.ts timeline ses_eabcd26dbffeZ0T7suGCQt1UKv --project-root <project> --db "$TMP/index.sqlite"
# token measurement
bun -e 'const t=await Bun.file(process.argv[1]).text(); const m=await import("./src/archive/primitives.ts"); console.log(m.estimateTokens(t))' <file>
# native comparison
cd "$ARCH" && grep -rl 'NBR-08' sessions
```

## 11. Caveats

- The live archive was being written during measurement; counts differ by <1% between reads (e.g. blobs 59,812 → 59,913, FTS delegation 1,287 → 1,290).
- Token figures use the repository's own `estimateTokens`, so they are comparable across paths, not exact model tokenizer counts.
- The unreferenced-blob count is an upper bound for the 14 columns scanned; `code_file`, `code_symbol`, and `instruction` blob columns were excluded. The stronger claim stands regardless: no action returns blob text.
- “Dangling refs” may include refs to blobs pruned or belonging to another project archive.

---

[NEXT-IN-LOOP HANDOFF]
Role Completed: hm-researcher
Workflow: Investigation Stream
Research Artifact: .planning/research/RF-SUB-02-archive-recall-reality-check.md
Primary Conclusion: The archive is a complete ledger but a weak recall surface: FTS/local digests are populated (9,225 rows), yet search returns recency-ranked delegations and no report bodies, child sessions are collapsed to roots, and no action reads the 1,028 linked `response_blob` reports. A hand-written `delegation_turn` SQL join + blob read answers in 2 calls for ≈2.6k tokens versus ≈72k for grep+read, but that path is undocumented and not exposed by the CLI.
Hypothesis Verdicts:
- Hypothesis 1: Archive is cheaply recallable via shipped actions — DISPROVED (search answers none of the three real questions; 432 tokens but wrong branch).
- Hypothesis 2: Delegation outputs are indexed and reachable — DISPROVED for reachability (linked via 1,028 `response_blob` shas; no action surfaces them; child IDs resolve to root).
- Hypothesis 3: Relational branches are one/two-call addressable — DISPROVED (FTS key is parent session; delegation hit cannot be joined to its own turn without hand SQL; child IDs are unaddressable).
Recommended Next Agent: hm-architect
Next Action: Author an ADR/design for a delegation-turn-scoped `recall` action (rank by FTS match, return bounded report excerpt), child-session addressability, and a `--readonly` CLI mode.
