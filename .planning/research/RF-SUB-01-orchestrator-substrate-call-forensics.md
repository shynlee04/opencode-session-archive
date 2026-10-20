# RF-SUB-01 — Orchestrator → `hivemind-substrate` call forensics

**Read-only forensic analysis. No repository state was modified.**

| Field | Value |
|---|---|
| Session A | `ses_ead1e4d2fffedglSPWcm1QJEz8` — 880 msgs, location `hivemind-steward-oc-devin-dev`, agent `ultra`, model `cline-pass/deepseek-v4.1-flash-1017` |
| Session B | `ses_eae28df6fffenA7M2uEWJrLUHX` — 171 msgs, location `hivemind-steward-oc-devin-dev`, agent `ultra` |
| Surface under study | `substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune` |
| Reference impl | `/Users/MAC/Documents/coding-projects/hivemind-substrate` (`src/plugin.ts` L1450–1600, `src/archive/valve.ts`, `src/archive/source.ts`) |

**Method.** The four surface tools are registered with `options: { codemode }` (`src/plugin.ts` L1466, L1487, L1518, L1554), so they are *only* reachable from inside a Code-Mode `execute` block — they never appear as top-level tool parts. Every `execute` block in both transcripts was parsed for `tools.<ns>.<tool>(...)`; arguments, outputs, `[substrate.telemetry …]` footers, and the assistant text immediately before/after were extracted. Session B was additionally scanned for any `tools.substrate.*` / `tools.archive.*` / `tools.ctx.*` reference and for CLI-style invocations.

---

## Q1 — Exact call counts per surface action

**VERDICT: 41 substrate calls, all in Session A. Session B made zero.**

| Surface action | Session A | Session B | Total |
|---|---|---|---|
| `archive.persist` | 29 | 0 | **29** |
| `substrate.valve` → `prune` | 7 | 0 | **7** |
| `substrate.valve` → `status` | 2 | 0 | **2** |
| `substrate.valve` → `reset` | 0 | 0 | **0** |
| `substrate.viewport` → `resolve` | 3 | 0 | **3** |
| `substrate.viewport` → any other action | 0 | 0 | **0** |
| `ctx.context-prune` (legacy alias) | 0 | 0 | **0** |
| **Total** | **41** | **0** | **41** |

Session B's four surface-ish string hits are all false positives — `viewport` inside a `git worktree list` grep (msg#1), two `search()` catalog lookups for `hivemind-delegate` (msg#7, msg#8), and `context-prune` as a literal in a grep of `opencode.log` for plugin load failures (msg#159). **Session B never touched the substrate surface at all**, despite running in the same directory with the same plugin wiring.

**Call ledger (Session A, by message index):**

| # | msg id | Call | Args | Classification |
|---|---|---|---|---|
| 10 | `msg_152e32c8f001QcHArQnLM0BDJ2` | `archive.persist` | `{scope:'session',format:'markdown'}` | NO-OP |
| 19 | `msg_152e67bc6001ZiSObG3adOepMv` | `persist` + `valve prune` | `keepRecentSteps:8` | NO-OP / NO-OP |
| 23 | `msg_152e73022001QMHMLGxbrlqz03` | `viewport resolve` | `blob:'8649a98e7c97',maxTokens:1500` | **USEFUL** |
| 26 | `msg_152e906c3001Y4i57C4qggE2gl` | `viewport resolve` | `blob:'6d29853e6ba2',maxTokens:1900` | **USEFUL** |
| 38 | `msg_152fa4d9e001Qurc75vqwo17ei` | `archive.persist` | `{scope,format}` | NO-OP (`0 files written`) |
| 50 | `msg_1531185a7001NPZcM0vJuMb6NI` | `persist` + `valve prune` | `keepRecentSteps:6` | NO-OP / NO-OP |
| 60 | `msg_1534443f6001BXH3IbJEEi8DA3` | `archive.persist` | `{scope,format}` → `return {archived:true}` | NO-OP (result discarded) |
| 69 | `msg_1534abf11001H4NVX9BAcO2u4v` | `archive.persist` | `{scope,format}` | NO-OP |
| 82 | `msg_1535babf8001CEg4M4ltM6OkPA` | `archive.persist` | `{scope,format}` | NO-OP |
| 91 | `msg_153669bd0001ZoyRI6OXPO0ZRf` | `persist` + `valve prune` | `keepRecentSteps:10` | NO-OP / NO-OP |
| 96 | `msg_15370734a001m4X80mtdA9cekI` | `archive.persist` | `{scope,format}` | NO-OP (`0 files written`) |
| 108 | `msg_1538021c6001kHabxReYJeApSE` | `viewport resolve` | `blob:'6d29853e6ba2',maxTokens:2500` | **WASTEFUL** (byte-identical retry) |
| 119 | `msg_1538373c4001387i5KS3mttUL8` | `archive.persist` | `{scope,format}` | NO-OP |
| 125 | `msg_15387a42e001eL2RtVb6p5BfSj` | `archive.persist` | `{scope,format}` | NO-OP |
| 134 | `msg_1538a037b001b7DW2r7NhRHD9I` | `archive.persist` | `{scope,format}` | NO-OP |
| 140 | `msg_1538d1fa10012qKReXdCXXQ6BV` | `archive.persist` | `{scope,format}` | NO-OP |
| 147 | `msg_1538f250e001hY5852eD0hy3WE` | `archive.persist` | `{scope,format}` | NO-OP |
| 152 | `msg_1539219bb001CfdK3nojcPqYv2` | `persist` + `valve prune` | `keepRecentSteps:8,format:'markdown'` | NO-OP / NO-OP |
| 156 | `msg_15398a554001lqeorxvXblFStK` | `archive.persist` | `{scope,format}` | NO-OP |
| 173 | `msg_153edb997001cY9UP1QvCB5k3k` | `archive.persist` | `{scope,format}` | NO-OP |
| 178 | `msg_153f0a06a001rH9xy80QwKX9fE` | `persist` + `valve prune` | `keepRecentSteps:6` | NO-OP / NO-OP |
| 188 | `msg_153f793bb001OCBMzTlOALaQPS` | `archive.persist` | `{scope,format}` | NO-OP |
| 196 | `msg_153f9dd31001ahBYhXiE2gktlq` | `archive.persist` | `{scope,format}` | NO-OP |
| 204 | `msg_154019bc9001cZUjT4xDSM28Sx` | `archive.persist` | `{scope,format}` | NO-OP |
| 210 | `msg_154055cbc0010glmKMH1yUlQPb` | `archive.persist` | `{scope,format}` | NO-OP |
| 214 | `msg_154077b5d001DuWB0gXC7ckZBZ` | `persist` + `valve prune` | `keepRecentSteps:8,format:'markdown'` | NO-OP / NO-OP |
| 225 | `msg_1540dbca10016k4CpO6SI2WpDq` | `archive.persist` | `{scope,format}` | NO-OP |
| 293 | `msg_15470bb36001uztJlMRlMzVrDF` | `archive.persist` | `{sessionID:'ses_ead1e4d2fffedglSPWcm1QJEz8',scope:'session',format:'markdown'}` | NO-OP (tautology) |
| 302 | `msg_1547b494800191Qt5hwD5Bezke` | `archive.persist` | same | NO-OP (tautology) |
| 319 | `msg_1548dcd66001RtTxVcvuyCBcnx` | `archive.persist` | same | NO-OP (tautology) |
| 325 | `msg_1548f136a001ddKRTBF7od7yXi` | `archive.persist` | same | NO-OP (tautology) |
| 351 | `msg_154a761270018FjkPTyJt2eLCf` | `archive.persist` | `{scope,format}` → string | NO-OP (output surfaced, never read) |
| 710 | `msg_155a38d930018gzCThididvu4G` | `valve status` → `valve prune` → `valve status` | `keepRecentSteps:10` | USEFUL (diagnostic) / WASTEFUL (ledger reset) / USEFUL |

---

## Q2 — Stated intent before, and use after, per call

**VERDICT: the orchestrator's stated intent for 38 of 41 calls never mentions the substrate. The valve output was IGNORED as a working-set report (7/7); the viewport `resolve` output was USED (2 of 3).**

### 2a. `substrate.valve` — output IGNORED in all 7 prune calls

The valve's return value is a two-part report: a thinning claim plus a `WorkingMemoryManifest` with per-file `FRESH` / `SLICE` / `STALE` states. **No assistant message after any prune refers to the manifest, the thinned counts, or the STALE warnings.** The orchestrator continued its own tracking list verbatim.

> **msg#214** — `valve prune` output:
> ```
> WorkingSetValve armed for session `ses_ead1e4d2fffedglSPWcm1QJEz8` (mode: `step-window`, keepRecentSteps: `8`, reason: `step-window`).
> Anchor: `msg_154010816001Rr3b2YEif9SUl6` (index 203); 128/136 assistant steps thinned (150 tool parts, ~117801 net tokens freed).
> Manifest: 23 files read, 0 files modified, 25 active skills.
> ## WorkingMemoryManifest · `ses_ead1e4d2fffedglSPWcm1QJEz8` (FRESH=17 SLICE=1 STALE=5 | Modified=0 | Skills=25 | Delegations=54)
> - `Users/MAC/.agents/skills/ultra-mode/references/policy-and-approval.md#L1-L19` (**FRESH**)
> - `STATE.md#L1-L57` (**STALE**)
> ```
> **Assistant text after (msg#215+):** `MH-30's repair passes 80 focused tests and typecheck…` → next: `Tracking: 1. Finish MH-30's final reviews, then integrate and run the full gate/build.`
> → No mention of `STALE`, of `STATE.md`, of the 117,801 figure, or of the manifest. **IGNORED.**

The `STALE` marker on `STATE.md` recurs in every prune output (msg#91, #152, #178, #214) and was never acted on.

### 2b. The one place the valve output *was* used — and it was not the working set

The valve's injected manifest directive is the **only** mechanism by which the orchestrator learned the `sha12` blob handles it later passed to `viewport resolve`. Proof: `8649a98e7c97` and `6d29853e6ba2` appear **nowhere** in either transcript except inside the orchestrator's own `viewport resolve` calls (verified by full-file regex scan: 2 and 4 raw occurrences, all in `state.input.code` / `state.metadata.toolCalls` of msgs #23, #26, #108). The source of those ids is `src/archive/valve.ts` L810:

> `> **Directive:** Every file slice and skill below is indexed in Retrievable Memory with a SHA-256 blob handle. **DO NOT re-read \`FRESH — DO NOT REREAD\` files or re-invoke \`ACTIVE — DO NOT RE-INVOKE\` skills.** Call \`substrate.viewport({ action: "resolve", blob: "<sha12>" })\` only if exact lines are needed.`

→ The valve **was** live in the host context (its directive reached the model). The orchestrator used it as a *skill directory*, not as a context report.

### 2c. `substrate.viewport resolve` — USED (2 of 3)

> **msg#23** `resolve blob:'8649a98e7c97'` → output head:
> `<skill_content name="git-worktree"> # Skill: git-worktree # Git worktree lanes A **lane** is one worktree on one branch, owned by one writer (an agent team), delivering one vertical…`
> **Assistant text before:** `The starting checkout fails both tests and typecheck. Nothing has been changed or merged. Next: 1. Finish ticket selection and failure diagnosis. 2. Create the ticket worktree…`
> **Assistant text after:** `The old lane has diverged: main has 40 unique commits, the lane has 46, and they overlap in 15 code/test files. I will not merge it wholesale. I will create NBR-02 from current main…`
> → **USED.** The skill was obtained and immediately applied (worktree-lane lane admission; `.worktree/afk-nbr06` created later at msg#125).

> **msg#26** `resolve blob:'6d29853e6ba2'` → output head:
> `<skill_content name="code-review"> # Skill: code-review Two-axis review of the diff between \`HEAD\` and a fixed point the user supplies: - **Standards**… - **Spec**…`
> **Assistant text after:** `NBR-02 is being implemented in a new lane from current main… Next: finish the implementation, run both review axes, apply at most one repair, verify, then merge and rebuild…`
> → **USED.** "both review axes" is the `code-review` skill's own vocabulary; the review at msg#50 reports `- **Standards:** pass… - **Spec:** fail.`

> **msg#108** `resolve blob:'6d29853e6ba2', maxTokens:2500` → output is **byte-identical** to msg#26 (both 6,532 chars, `sha256 = 6d29853e6ba23c56…`). The `maxTokens` bump changed nothing, and no assistant text follows within 7 messages. → **WASTEFUL.**

### 2d. `archive.persist` — output IGNORED in all 29

Persisted tree sizes grew monotonically across the session (`2 sessions, 13 messages` → `31 sessions, 414 messages` → `51 sessions, 800 messages, 73 delegations` at msg#351) and were **never read back**: zero assistant text in Session A mentions `.session-archive`, `blobs/`, or `index.sqlite`, and zero `shell`/`read`/`grep` calls touch the archive tree. Writes without a single read.

---

## Q3 — Latency burned

**VERDICT: measured floor 59.22 s of substrate wall-clock inside `execute` blocks; estimated total ≈ 93 s. `archive.persist` dominates: 85.6% of the measured time.**

Telemetry is emitted as a footer on the tool's returned string (`[substrate.telemetry action=… tokens=… latencyMs=…]`), so it is lost whenever the caller discards the result — which the orchestrator did in 17 of 41 calls.

| Action | Measured stamps | Σ latencyMs | Σ seconds | Median | Range |
|---|---|---|---|---|---|
| `sync` (= `archive.persist`) | 18 | 50,672.88 | **50.67 s** | 2,664 ms | 1,451 – 4,462 ms |
| `prune` (= `substrate.valve`) | 6 | 8,550.30 | **8.55 s** | 1,476 ms | 1,253 – 1,540 ms |
| **Measured floor** | **24** | **59,223.18** | **59.22 s** | | |
| `status` ×2 (msg#710) | truncated by caller-side `.slice(0,900)` | — | ≈ 3.0 s (est.) | | |
| `persist` ×11 (result discarded → no footer) | 0 | — | ≈ 29.3 s (est. @ median) | | |
| `viewport resolve` ×3 (`skipFooter` when `format` undefined) | 0 | — | ≈ 0 s | | |
| **Estimated total** | 41 | **≈ 92,959** | **≈ 93.0 s** | | |

> `src/plugin.ts` L905 — `skipFooter: input?.format === undefined` — so **`viewport` emits no telemetry at all** unless the caller passes `format`. Two of the three `resolve` calls omitted it.

---

## Q4 — Was archived session content ever recalled back?

**VERDICT: NO. Zero session-transcript content was recalled in either session. All 3 `resolve` calls returned SKILL DOCUMENTS — the suspicion is CONFIRMED.**

`viewport` actions used: `resolve` ×3. Unused (15 of the 16 enum actions): `status`, `timeline`, `provenance`, `compaction`, `sync`, `persist`, `search`, `find`, `repomap`, `skeleton`, `slice`, `coupled`, `brief`, `intents`, `latest`.

| Call | Blob | Resolved content | Verdict |
|---|---|---|---|
| msg#23 | `8649a98e7c97` | `<skill_content name="git-worktree">` — 3,333 chars, ends `Base directory for this skill: /Users/MAC/.config/opencode/skills/git-worktree … <skill_files> </skill_files> </skill_content>` | **Skill doc** |
| msg#26 | `6d29853e6ba2` | `<skill_content name="code-review">` — 6,532 chars, ends `Base directory for this skill: /Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.opencode/skills/code-review … </skill_content>` | **Skill doc** |
| msg#108 | `6d29853e6ba2` | `<skill_content name="code-review">` — byte-identical to msg#26 | **Skill doc** |

The resolved payloads carry the `skill_content` wrapper and the `Base directory for this skill:` footer of the *native* `skill` tool. No `<session_content>`, no transcript fragment, no user prompt, no tool-part record was ever resolved. The archive the orchestrator had been writing for 29 calls was never read.

---

## Q5 — Confusing-caller evidence

**VERDICT: 7 distinct confusion modes, 9 concrete instances. No malformed parameter *names* — the confusion is in the discovery of the surface, the semantics of the return value, and the redundancy of the calls.**

### 5.1 The orchestrator did not know the surface existed — 3 catalog searches
> **msg#14** `msg_152e3d0ce001kyYwxcGIjwsOih` — code: `return search({query:'hivemind substrate memory search sessions context viewport',limit:4});`
> **msg#107** `msg_1537e837b0012zZSeg9V4jSQhC` — code: `return search({namespace:'substrate',query:'viewport',limit:1});`
> **msg#171** `msg_153ed1f400019eFLY6JcuPQsKC` — code: `return {viewport:search({namespace:'substrate',query:'viewport',limit:2}),delegate:search({query:'hivemind-delegate',limit:3})};`
>
> All three return the `tools.substrate.viewport` signature — i.e. the orchestrator was **re-reading the tool's own signature** to learn how to call it. msg#107's lookup was immediately followed by the msg#108 `resolve` — the search was in service of a call the catalog signature already described. msg#171's lookup produced no follow-up `viewport` call at all; the next substrate call (msg#178) was a `persist`+`prune`.

### 5.2 A retry that changed nothing
> **msg#26** `blob:'6d29853e6ba2', maxTokens:1900` → 6,532 chars.
> **msg#108** `blob:'6d29853e6ba2', maxTokens:2500` → 6,532 chars, `sha256` identical.
> Same blob, +600 tokens requested, byte-for-byte same output. The orchestrator's own framing at msg#107 was `search({namespace:'substrate',query:'viewport',limit:1})` — it was hunting for the right shape, then repeated the call anyway.

### 5.3 A vacuous success assertion (`r !== null` is always true)
> **msg#293** `msg_15470bb36001uztJlMRlMzVrDF`, also #302, #319, #325:
> ```js
> const r = await tools.archive.persist({ sessionID: "ses_ead1e4d2fffedglSPWcm1QJEz8", scope: "session", format: "markdown" });
> return { archived: r !== null };
> ```
> Output: `{ "archived": true }`. `archive.persist` returns a **string**, so `r !== null` is a tautology — the check reports success unconditionally and cannot fail. The orchestrator had to *guess* the return type; it guessed wrong (four times).

### 5.4 A result thrown away, and one cast defensively
> **msg#60** `msg_1534443f6001BXH3IbJEEi8DA3`:
> ```js
> await tools.archive.persist({scope:'session',format:'markdown'});return {archived:true};
> ```
> The literal `true` is hardcoded — the return value is never inspected.
> **msg#351** `msg_154a761270018FjkPTyJt2eLCf`:
> ```js
> return typeof r === "string" ? r : JSON.stringify(r);
> ```
> The orchestrator did not know whether `persist` returns a string or an object, and wrote a runtime type probe.

### 5.5 Two persists that were pure no-ops
> **msg#38** → `Persisted session tree rooted at ses_ead1e4d2fffedglSPWcm1QJEz8 … 0 files written, 86 unchanged.` `[substrate.telemetry action=sync tokens=56 latencyMs=1715.08]`
> **msg#96** → `… 0 files written, 413 unchanged.` `[substrate.telemetry action=sync tokens=57 latencyMs=1451.36]`
> 1.45 s and 1.72 s spent re-walking a tree that changed nothing.

### 5.6 Hand-tuned pruning parameters, with the defaults never consulted
`keepRecentSteps` was passed as `8, 6, 10, 8, 6, 8, 10` across the seven prunes — while `src/archive/valve.ts` L15–17 defines `DEFAULT_KEEP_RECENT_STEPS = 8` and `DEFAULT_AUTO_KEEP_RECENT_STEPS = 12`. The host was *already* auto-pruning at 12 (`DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO = 0.65`); the orchestrator's manual 6/8/10 values were mostly stricter re-specifications of a policy it never saw.

### 5.7 The manual prune destroyed the auto-prune's own measurement
> **msg#710** — three valve calls in one `execute` block. `== status ==` before:
> ```
> WorkingSetValve is armed for session `ses_ead1e4d2fffedglSPWcm1QJEz8` (mode: `step-window`, keepRecentSteps: `12`, anchor: `msg_154e42b0d001wc7xLzc75dTw1E`).
> Thinned: 283 tool parts (~99243 net tokens freed).
> ```
> `== prune ==` (manual, `keepRecentSteps: 10`):
> ```
> Anchor: `msg_1559a12e3001KjWM3IPfsxwaZ1` (index 84); 51/61 assistant steps thinned (42 tool parts, ~40617 net tokens freed).
> ```
> `== status after ==`:
> ```
> Thinned: 42 tool parts (~40617 net tokens freed).
> ```
> **The ledger went from 283 thinned parts / 99,243 tokens to 42 parts / 40,617 tokens.** The manual prune re-anchored the window and reset the counter, erasing the auto-prune's accounting. The orchestrator was also working against a *different* configuration than it believed: it had been passing 6/8/10 while the live valve was running at 12.

---

## Q6 — Did the LIVE host context actually shrink?

**VERDICT: CONTRADICTED as a net context reduction; the specific figure is a window-local estimate, not a cumulative saving. The valve demonstrably ran, but host-reported live context grew ~3.9× at peak over the same window.**

### 6a. The valve's own numbers are not cumulative

| Point | Claim | Cumulative? |
|---|---|---|
| msg#19 | `9/17 assistant steps thinned (29 tool parts, ~35452 net tokens freed)` | — |
| msg#50 | `32/38 assistant steps thinned (52 tool parts, ~46754 net tokens freed)` | grows |
| msg#91 | `54/64 assistant steps thinned (85 tool parts, ~79359 net tokens freed)` | grows |
| msg#152 | `92/100 assistant steps thinned (123 tool parts, ~100894 net tokens freed)` | grows |
| msg#178 | `111/117 assistant steps thinned (136 tool parts, ~108431 net tokens freed)` | grows |
| msg#214 | `128/136 assistant steps thinned (150 tool parts, ~117801 net tokens freed)` | grows |
| **msg#710 `status`** | `Thinned: 283 tool parts (~99243 net tokens freed)` | **falls** — more parts, fewer tokens |

More tool parts thinned (150 → 283) yet *fewer* net tokens freed (117,801 → 99,243). The figure is scoped to the current window, so `~117801 net tokens freed` is **not** a session-cumulative saving and cannot be read as one.

### 6b. Host-reported context grew

Session A `info.tokens`: `input: 30,602,969`, `output: 289,587`, `reasoning: 373,201`, `cache: { read: 66,103,944, write: 0 }`.

Per-decile, over the 524 assistant messages that carry a `tokens` block (`input` + `cache.read` = the live context re-sent each step):

| Decile | n | Avg live context | Peak `cache.read` | `cache.write` |
|---|---|---|---|---|
| 0 | 52 | 85,581 | 179,840 | 0 |
| 1 | 52 | 140,076 | 189,056 | 0 |
| 2 | 53 | 156,655 | 185,200 | 0 |
| 3 | 52 | 231,156 | 277,026 | 0 |
| 4 | 53 | **332,587** | 360,408 | 0 |
| 5 | 52 | 172,339 | **379,904** | 0 |
| 6 | 52 | 150,261 | 182,528 | 0 |
| 7 | 53 | 130,752 | 186,368 | 0 |
| 8 | 52 | 178,321 | 205,184 | 0 |
| 9 | 53 | 230,973 | 255,616 | 0 |

Peak per-step context went **179,840 → 379,904** (2.1×) and average live context **85,581 → 332,587** (3.9×) across exactly the window in which the valve reported freeing 117,801 net tokens. A genuine ~118k reduction would have to show up as a step-down in `cache.read` at the prune points; it does not. Post-prune `cache.read` values interleave with the same pre-prune oscillation (e.g. msg#178: pre `[5376, 31744, 146560, 5376, 151936]` → post `[31872, 31872, 5376]`), so no drop is attributable to the prune.

Two supporting facts: `cache.write = 0` for every message in the session — no prompt-cache writes were ever recorded, so the full context was re-read every step (`cache.read` total 66.1 M tokens); and the session contains 2 `compaction` messages plus 143 `synthetic` messages, so the context-shape changes in deciles 6–7 are host-side compaction, not valve thinning.

**Verdict:** the valve *ran* (proved independently by the `sha12` blob directive reaching the model's context, §2b), but the transcript's host-reported token accounting does **not** corroborate a live-context reduction; the growth pattern contradicts it. The number the tool prints is a window-local estimate whose own trajectory is non-monotonic. **Unverifiable as a session-level claim; contradicted as a net shrink.**

---

## Q7 — Native-tool comparison

**VERDICT: on both goals where the substrate surface could have served, the orchestrator used native tools — and did so *while* paying for the substrate equivalents.**

### 7a. Reading a child's session transcript — native `sqlite3`, not `viewport`

> **msg#346** `msg_154a5d6ce0017HxDTwvyoNviXB` — native:
> ```sh
> DB=/Users/MAC/.local/share/opencode/opencode.db; echo "== session_message columns =="; sqlite3 -readonly "$DB" "PRAGMA table_info(session_message);" …
> sqlite3 -readonly "$DB" "SELECT id, data FROM session_message WHERE session_id='ses_eab5b35e7ffel9MaLA6rH4IeLU' ORDER BY rowid;" | head -20 | cut -c1-1500
> ```
> Output: `id(TEXT) session_id(TEXT) type(TEXT) seq(INTEGER) time_created(INTEGER) time_updated(INTEGER) data(TEXT)` then the raw `session_message` rows.
> **msg#347** `msg_154a5e742001b6c2uAkbPeaptq` — same DB, `SELECT data FROM session_message WHERE session_id='ses_eab5b35e7ffel9MaLA6rH4IeLU' AND type='assistant';` piped into a Python JSON walk that printed every tool part.

> **Substrate equivalent:** `src/archive/source.ts` reads exactly this table (`sqliteSource(dbPath)`: read-only `bun:sqlite` access to `~/.local/share/opencode/opencode.db` … `session_v2`, `session_message`, `kv`), and `index.sqlite` already contained the transcript (msg#351: `51 sessions, 800 messages, 73 delegations`). A `viewport`/`archive` query would have served the same rows.

> **Assistant text before msg#346** (stated intent): *"The bridge journal was off for that run, so I'm reading the host's own record of the child's tool parts — read-only — to see whether the refusal text and the call identity actually reach the plugin's observation seam."*
> **Assistant text after msg#347:** *"The probe paid for itself. Three findings, one of which changes the approved design. Recording the evidence."*
>
> The orchestrator read **host-DB session transcripts** three times in a row and never once used the substrate to do it, despite having persisted that same data 6 calls earlier (msg#351) and 29 times overall.

### 7b. Skill content — `viewport resolve` vs the native `skill` tool

> **Native (`skill` tool), 23 calls in Session A:** `msg_152e1ceb5001pGjlWR4fvZ40KX {"id":"ultra-mode"}`, `msg_152e2ce25001j1OFo9HkQD5ZL5 {"id":"codebase-design"}`, `{"id":"domain-modeling"}`, `{"id":"principle-model-the-domain"}`, … `msg_154a3b7d8001YJHw055iUde4CM {"id":"bro"}`, `{"id":"wait-what"}`.
> **Native (`read` tool), msg#166** `msg_153acf986001kTy4YUgF5jnwzg`: `{"path":"/Users/MAC/.agents/skills/ultra-subagent/SKILL.md","limit":220}` → `Read file /Users/MAC/.agents/skills/ultra-subagent/SKILL.md, lines 1-38`.

> **Substrate (`viewport resolve`), msg#23**: returned the *entire* `git-worktree` skill body (3,333 chars) including the `Base directory for this skill: /Users/MAC/.config/opencode/skills/git-worktree` footer — the same payload the native `skill` tool returns.
> **Substrate (`viewport resolve`), msg#26 / msg#108**: returned the entire `code-review` skill body (6,532 chars), `Base directory … /.opencode/skills/code-review`.

The orchestrator used the native `skill` tool for **23** skills and the substrate `resolve` route for **2** — despite the substrate route requiring a blob handle that only the manifest could supply, and returning strictly more content than the native call. The two routes are indistinguishable in output but cost different numbers of round trips.

### 7c. The tool-catalog lookup as a third native route
`search({namespace:'substrate',query:'viewport'})` (msg#107, msg#171) and `search({query:'hivemind substrate memory search sessions context viewport'})` (msg#14) are pure signature-lookup round trips — 3 extra turns spent to learn the call shape that was already in the catalog.

---

## Failure modes observed

1. **Write-only archive.** 29 `archive.persist` calls (~50 s of measured wall-clock, the single largest cost in the session) with **zero** reads. The archive grew to 51 sessions / 800 messages and was never consulted. `persist` is being used as a ritual, not as a recall mechanism.
2. **`resolve` is a skill reader, not a transcript reader.** 3 of 3 `viewport` calls returned `<skill_content>` payloads. The session-transcript recall path — the archive's raison d'être — was never exercised once in 41 calls. 15 of 16 `viewport` actions were never called.
3. **Window-local metrics presented as cumulative.** `~117801 net tokens freed` is not a session total; the same ledger later reads `283 tool parts (~99243 net tokens freed)` — more parts, fewer tokens. Any dashboard reading these as cumulative is wrong.
4. **Manual pruning fights the host's automatic pruning.** The host already auto-prunes (`DEFAULT_AUTO_KEEP_RECENT_STEPS = 12`, `DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO = 0.65`). The orchestrator hand-passed 6/8/10 six times without ever reading the defaults, and its final manual prune at msg#710 re-anchored the window and **reset the ledger from 283 parts to 42**.
5. **The Do-Not-Reread directive is inverted in practice.** The manifest says *"DO NOT re-read … or re-invoke … skills. Call `viewport resolve` only if exact lines are needed."* The orchestrator used `resolve` to re-obtain **whole** skill bodies (3,333 and 6,532 chars), and then repeated one of them verbatim. The directive's cost-saving intent was inverted: it became a re-read instruction.
6. **Return-type guessing.** `return {archived: r !== null}` (×4) is a tautology over a string return; `return {archived: true}` (×1) ignores the result entirely; `typeof r === "string" ? r : JSON.stringify(r)` (×1) is a runtime probe. The surface's return contract is not discoverable from the transcript.
7. **Telemetry is invisible exactly where it is needed.** `viewport` emits no footer unless `format` is passed (`skipFooter: input?.format === undefined`), and `persist`/`prune` lose their footer whenever the caller discards the result — which happened in 17 of 41 calls. A caller cannot see the cost of its own calls.
8. **The surface is undiscoverable without the catalog.** 3 separate `search()` lookups to recover the `viewport` signature; 2 of the 3 were not followed by a call.
9. **The whole surface was ignored in one of two comparable sessions.** Session B (171 msgs, same directory, same plugin wiring) made **0** substrate calls while working the same delegation problem Session A worked. Presence of the plugin does not produce usage.
10. **Host token accounting cannot corroborate the thinning claim.** `cache.write = 0` for the entire session and peak live context grew 179,840 → 379,904 tokens while the valve reported freeing 117,801 net tokens. No measurable host-side shrink is attributable to any of the 7 prune calls.
