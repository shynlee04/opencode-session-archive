# WF-SUB-02: Intra-Turn Assistant Step-Watermark Pruning & FactBreadcrumb Valve

- **ID:** `WF-SUB-02`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `resolved (prototype verified)`
- **Depends on:** `WF-SUB-01`
- **Evidence Input:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md), [`WF-SUB-R04`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R04-domain-model-and-viewport-matrix.md)

## Question

What step-watermark slicing rule and `FactBreadcrumb` format allow `context-prune` to thin completed tool outputs during a 45-step single-prompt auto-run (`ses_eb2eabb14ffeCXsCwb845rtffb`) AND prevent the post-prune panic re-read loop (`ses_eb23bfbf0ffesn5kT0yJI06h35` `msg[125..130]`)?

## Why This Matters (Observed Failure)

1. In [`session-bcad339b`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) (`msg[45]`), `tools.ctx["context-prune"]({ mode: "recent" })` freed `0` bytes because [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115) anchors on `findLastIndex(m => m.role === "user")`, which is `0` during a single-prompt auto-run.
2. In [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) (`msg[123..130]`), replacing tool outputs with generic `"rerun the tool"` stubs caused the agent to immediately re-read `STATE.md`, `.opencode/AGENTS.md`, and 7 skills.

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-02-step-valve.ts`)

1. Implement `"step-window"` (`keepRecentSteps: K`, default `K = 8`) alongside user-prompt anchoring in a prototype valve.
2. Replace generic stubs with `FactBreadcrumb`s linked to `.session-archive/blobs/<sha256>.txt` (`[Pruned read src/acp.ts#L1-L120 -> blob:a1b2c3d4 | exports: AcpClient | hash matches disk — DO NOT REREAD; call substrate.resolve("blob:a1b2c3d4") if exact lines needed]`) plus a compact `WorkingMemoryManifest` header listing active skills and fresh file reads.
3. Replay [`session-bcad339b`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) at `msg[45]` and [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) at `msg[123]` and measure characters/tokens freed and `< 2 ms` `context` hook latency.

## Findings

### 1. Prototype Artifacts

- Implementation: [`wf-sub-02-step-valve.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-02-step-valve.ts)
- Verification & benchmark suite (`9 pass, 0 fail, 171 assertions`): [`wf-sub-02-step-valve.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-02-step-valve.test.ts)
- Content-addressed SHA-256 blob sink: [`scratch/prototypes/data/wf-sub-02-blobs/`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-02-blobs)

### 2. Watermark Slicing Rule (`computeStepWatermark`)

1. **Compaction Window Bound:** Locate `lastCompactionIndex` and set `activeStartIndex = lastCompactionIndex >= 0 ? lastCompactionIndex + 1 : 0`. Collect all `assistant` message indices in `[activeStartIndex, messages.length)`.
2. **`mode: "step-window"` (`keepRecentSteps = K`, default `K = 8`):**
   - If `assistantStepsTotal > K`, anchor at `assistantIndices[assistantStepsTotal - K]` (`anchorReason: "step-window"`), keeping the `K` most recent assistant steps intact in active context and thinning all earlier assistant steps in `[activeStartIndex, anchorIndex)`.
3. **`mode: "recent"` with Single-Prompt Auto-Run Fallback:**
   - When `lastUserIndex <= activeStartIndex` (only the initial user prompt exists in the active window) AND `assistantStepsAfterLastUser > K`, automatically fall back to `assistantIndices[assistantStepsTotal - K]` (`anchorReason: "recent-step-fallback"`).
   - Otherwise, when multi-turn user prompts exist (`lastUserIndex > activeStartIndex`), anchor at `lastUserIndex` (`anchorReason: "recent-user-prompt"`).
4. **Two-Phase Critical-Path Split:**
   - **Phase 1 (`armValve` at tool invocation / background persist):** Sinks raw tool outputs and inline `<skill_content>` blocks into content-addressed SHA-256 blobs (`<sha256>.txt`), extracts 1-line semantic summaries, builds the `Map<callId, FactBreadcrumb>` and `Map<callId, thinnedInput>`, and renders `WorkingMemoryManifest`.
   - **Phase 2 (`applyContextHookInMemory` inside `ctx.session.hook("context", ...)`):** Pure in-memory array walk (`0` disk I/O, `0` SHA-256 hashing) that prepends `WorkingMemoryManifest` to `event.system` and swaps completed tool outputs before `anchorIndex` with precomputed `FactBreadcrumb` strings while preserving `KEEP_RESULT` (`subagent`, `task`, `delegate-devin`, `hivemind-delegate`) outputs and `KEEP_INPUT` (`read`, `write`, `edit`) inputs.

### 3. Replay 1 — `session-bcad339b` (`ses_eb2eabb14ffeCXsCwb845rtffb`) at `msg[45]`

At `msg[45]` (`s1.messages.slice(0, 46)`), `msg[0]` (`msg_14d1544ee001vCXg3fPMactf6P`) is the sole `user` message, followed by `41` `assistant` steps (`136` total completed tool parts). Actual context size at `msg[45]` is `1,946 + 255,488 = 257,434` input tokens; 6 steps later at `msg[51]`, the session hits `274,175` input tokens (`279,423` total) and triggers hard auto-compaction.

| Strategy | Anchor `msg[idx]` (`id`) | Assistant Steps Thinned / Kept | Tool Parts Thinned | Raw Output Chars -> Breadcrumb Chars | Raw Input Chars -> Thinned Input Chars | Manifest Chars | Net Chars Freed | Net Tokens Freed (`ceil(chars/4)`) | Projected `msg[45]` Input Tokens | Projected `msg[51]` Tokens vs `274,175` Cliff |
|---|---|---|---|---|---|---|---|---|---|---|
| Legacy `context-prune({ mode: "recent" })` | `msg[0]` (`msg_14d1544ee001vCXg3fPMactf6P`) | `0` / `41` | `0` | `0 -> 0` | `0 -> 0` | `0` | `0` | `0` | `257,434` (`0%` reduction) | `274,175` (**compacts**) |
| `WorkingSetValve` (`step-window` / `recent` fallback, `K = 8`) | `msg[38]` (`msg_14d1f8ddb001n1hz8EkB4rh5yB`) | `33` / `8` | `128` (`127` output + `1` delegation input) | `625,510 -> 28,692` (`-95.4%`) | `51,770 -> 11,068` (`-78.6%`) | `17,923` | `619,597` | `154,900` | `102,534` (`-60.2%`) | `119,275` (`154,900` tokens below cliff) |
| `WorkingSetValve` (`step-window`, `K = 6`) | `msg[40]` (`msg_14d216ebc001ODNchhDK8mDyPa`) | `35` / `6` | `130` (`128` output + `2` delegation input) | `625,893 -> 29,282` (`-95.3%`) | `75,701 -> 11,736` (`-84.5%`) | `17,923` | `642,653` | `160,664` | `96,770` (`-62.4%`) | `113,511` (`160,664` tokens below cliff) |

#### Sample `FactBreadcrumb`s Emitted in Replay 1

```text
[Pruned skill ultra-mode (24526 chars) -> blob:91948f2a0e2f | Rules active in WorkingMemoryManifest — DO NOT REREAD skill]
[Pruned read /Users/MAC/.agents/skills/ultra-mode/playbooks/investigation.md#L1-L24 (1669 chars) -> blob:91475a1221ed | Investigation | status: FRESH — DO NOT REREAD — call substrate.resolve("blob:91475a1221ed") if exact lines needed]
[Pruned shell sh ~/.agents/skills/ultra-mode/scripts/pickup.sh /Users/MAC/Docu… (3183 chars) -> blob:cf1e7fd978e7 | branch: lane/wave2-slice1 · upstream: none | call substrate.resolve("blob:cf1e7fd978e7") to inspect raw output]
[Pruned read /Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md#L1-L190 (28442 chars) -> blob:93e82bd4d565 | 1. Live Disk Recon & PM / Architect Audit | status: FRESH — DO NOT REREAD — call substrate.resolve("blob:93e82bd4d565") if exact lines needed]
[Pruned read .opencode/AGENTS.md#L1-L110 (7649 chars) -> blob:024e03bf7780 | Working posture: orchestrator and team | status: FRESH — DO NOT REREAD — call substrate.resolve("blob:024e03bf7780") if exact lines needed]
```

### 4. Replay 2 — `session-a35adea6` (`ses_eb23bfbf0ffesn5kT0yJI06h35`) at `msg[123]`

In `session-a35adea6`, compaction occurred at `msg[82]` (`msg_14df47198001tdupZL8kBeiY0r`) and the user issued a prompt at `msg[120]` (`msg_14e0353fc001E7Xl9Swjjcoryv`). At `msg[123]`, `context-prune({ mode: "recent" })` thinned `53` completed tool parts (`311,570` raw output chars) in `msg[83..119]` to generic `"rerun the tool"` stubs and instructed `"Skill bodies were reduced — re-invoke any skill (@skill-name) you still need"`.

In `msg[124..130]`, the blind agent immediately executed a panic re-read storm totaling `151,528` chars (`37,882` est. tokens), including `14` `read` calls (`113,199` chars across 12 unique paths) and `7` skill loads (`21,641` chars).

With `WorkingSetValve`:
- The `53` tool outputs (`311,570` chars) are thinned to `12,177` chars of `FactBreadcrumb`s (`-96.1%`), non-keep tool inputs (`57,941` chars) are thinned to `7,444` chars (`-87.2%`), and after accounting for the `WorkingMemoryManifest` (`37,288` chars), net savings at `msg[123]` are `312,602` chars (`78,151` tokens freed).
- Avoiding the `msg[125..130]` re-read storm saves an additional `134,840` chars (`33,710` tokens) of redundant `read`/`skill` tool calls (`151,528` chars / `37,882` tokens including the 2 JSONL shell scrapes).

#### Verification of All 14 Re-Read File Calls in `msg[125..130]` (`14 / 14` Verified)

| `msg[idx]` | File Path | Re-Read Chars | Manifest Status | `blob:<sha12>` Handle | Resolved Blob Chars |
|---|---|---|---|---|---|
| `msg[125]` | `STATE.md` (`#L1-L20`) | `5,747` | `FRESH — DO NOT REREAD` | `blob:c0df4d0f0920` | `2,010` |
| `msg[125]` | `STATE.md` (`#L40-L71`) | `2,649` | `FRESH — DO NOT REREAD` | `blob:c0df4d0f0920` | `2,010` |
| `msg[125]` | `.opencode/AGENTS.md` | `7,649` | `FRESH — DO NOT REREAD` | `blob:024e03bf7780` | `7,649` |
| `msg[126]` | `.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md` | `15,585` | `FRESH — DO NOT REREAD` | `blob:93e82bd4d565` | `28,442` |
| `msg[126]` | `.audit/2026-10-18-prompt2-design-preparation/prompt2-input.md` | `8,253` | `FRESH — DO NOT REREAD` | `blob:14d231e348d6` | `8,253` |
| `msg[126]` | `.audit/2026-10-18-prompt2-design-preparation/coordinator-notes.md` | `9,522` | `FRESH — DO NOT REREAD` | `blob:faebb674806f` | `7,670` |
| `msg[126]` | `.audit/2026-10-18-prompt2-design-preparation/report.md` | `24,777` | `FRESH — DO NOT REREAD` | `blob:88ddd0a45245` | `24,777` |
| `msg[126]` | `.audit/2026-10-18-prompt2-design-preparation/run.md` | `14,338` | `FRESH — DO NOT REREAD` | `blob:e1978ff6470a` | `11,174` |
| `msg[128]` | `.audit/2026-10-17-wave2-independent-review/decision-packet.md` | `12,759` | `FRESH — DO NOT REREAD` | `blob:c0d257752643` | `12,759` |
| `msg[129]` | `/Users/MAC/.agents/skills/swarm/SKILL.md` | `2,563` | `FRESH — DO NOT REREAD` | `blob:4dcbc66bc595` | `2,557` |
| `msg[130]` | `/Users/MAC/.agents/skills/ultra-mode/playbooks/investigation.md` | `1,669` | `FRESH — DO NOT REREAD` | `blob:de84c94180c7` | `1,519` |
| `msg[130]` | `.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md` | `3,875` | `FRESH — DO NOT REREAD` | `blob:93e82bd4d565` | `28,442` |
| `msg[130]` | `/Users/MAC/.agents/skills/ultra-mode/references/lifecycle.md` | `2,567` | `FRESH — DO NOT REREAD` | `blob:104d4308e665` | `2,320` |
| `msg[130]` | `/Users/MAC/.agents/skills/ultra-mode/references/delegation.md` | `1,246` | `FRESH — DO NOT REREAD` | `blob:56f51a7f53d6` | `1,115` |

#### Verification of All 7 Re-Invoked Skills in `msg[128..129]` (`7 / 7` Verified)

| `msg[idx]` | Skill Name | Re-Invoke Chars | Manifest Status | `blob:<sha12>` Handle | Resolved Blob Chars |
|---|---|---|---|---|---|
| `msg[128]` | `grill-with-docs` | `1,837` | `ACTIVE — DO NOT RE-INVOKE` | `blob:8575a42a409b` | `1,837` |
| `msg[128]` | `wayfinder` | `4,186` | `ACTIVE — DO NOT RE-INVOKE` | `blob:15d386cab360` | `4,096` |
| `msg[128]` | `show-me-your-work` | `3,026` | `ACTIVE — DO NOT RE-INVOKE` | `blob:e005df871bd9` | `3,026` |
| `msg[128]` | `principle-build-the-lever` | `1,746` | `ACTIVE — DO NOT RE-INVOKE` | `blob:022926e78c9f` | `1,746` |
| `msg[129]` | `how` | `2,368` | `ACTIVE — DO NOT RE-INVOKE` | `blob:5c034a63372d` | `2,368` |
| `msg[129]` | `writing-for-agents` | `5,915` | `ACTIVE — DO NOT RE-INVOKE` | `blob:ae37a9b909b8` | `5,915` |
| `msg[129]` | `swarm` (direct `read` fallback) | `2,563` | `ACTIVE — DO NOT RE-INVOKE` | `blob:4dcbc66bc595` | `2,557` |

#### Sample `WorkingMemoryManifest` Excerpt (`session-a35adea6` at `msg[123]`)

```markdown
## WorkingMemoryManifest · `ses_eb23bfbf0ffesn5kT0yJI06h35` (Do-Not-Reread Ledger)
> **Directive:** Every file slice and skill below is indexed in Retrievable Memory with a SHA-256 blob handle. **DO NOT re-read `FRESH — DO NOT REREAD` files or re-invoke `ACTIVE — DO NOT RE-INVOKE` skills.** Call `substrate.resolve("blob:<sha12>")` only if exact lines are needed.

### Files Already Read
- `STATE.md#L1-L49` (2010 chars) -> `blob:c0df4d0f0920` | State | **FRESH — DO NOT REREAD**
- `.opencode/AGENTS.md#L1-L110` (7649 chars) -> `blob:024e03bf7780` | Working posture: orchestrator and team | **FRESH — DO NOT REREAD**
- `.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md#L1-L190` (28442 chars) -> `blob:93e82bd4d565` | 1. Live Disk Recon & PM / Architect Audit | **FRESH — DO NOT REREAD**
- `.audit/2026-10-18-prompt2-design-preparation/prompt2-input.md#L1-L82` (8253 chars) -> `blob:14d231e348d6` | Prompt 2 Input — Design & Wayfinder Preparation | **FRESH — DO NOT REREAD**
- `.audit/2026-10-18-prompt2-design-preparation/coordinator-notes.md#L1-L84` (7670 chars) -> `blob:faebb674806f` | Coordinator Notes — Prompt 2 Design Preparation | **FRESH — DO NOT REREAD**
- `.audit/2026-10-18-prompt2-design-preparation/report.md#L1-L216` (24777 chars) -> `blob:88ddd0a45245` | Prompt 2 — Design & Wayfinder Preparation Report | **FRESH — DO NOT REREAD**
- `.audit/2026-10-18-prompt2-design-preparation/run.md#L1-L103` (11174 chars) -> `blob:e1978ff6470a` | Run Audit Trail — 2026-10-18 Prompt 2 Design Preparation | **FRESH — DO NOT REREAD**
- `.audit/2026-10-17-wave2-independent-review/decision-packet.md#L1-L154` (12759 chars) -> `blob:c0d257752643` | Wave 2 Independent Review — Decision Packet | **FRESH — DO NOT REREAD**

### Active Skills Loaded (DO NOT RE-INVOKE)
- `@grill-with-docs` (1837 chars) -> `blob:8575a42a409b` | Run a stateless or doc-backed grill | **ACTIVE — DO NOT RE-INVOKE**
- `@wayfinder` (4096 chars) -> `blob:15d386cab360` | Map a large uncertain effort into bounded decision questions | **ACTIVE — DO NOT RE-INVOKE**
- `@show-me-your-work` (3026 chars) -> `blob:e005df871bd9` | Maintain an append-only decision trail | **ACTIVE — DO NOT RE-INVOKE**
- `@principle-build-the-lever` (1746 chars) -> `blob:022926e78c9f` | Prefer the smallest rerunnable codemod, generator, or check | **ACTIVE — DO NOT RE-INVOKE**
- `@how` (2368 chars) -> `blob:5c034a63372d` | Trace how a subsystem works, where behavior belongs | **ACTIVE — DO NOT RE-INVOKE**
- `@writing-for-agents` (5915 chars) -> `blob:ae37a9b909b8` | Write predictable documents for agents | **ACTIVE — DO NOT RE-INVOKE**
- `@swarm` (2557 chars) -> `blob:4dcbc66bc595` | Parallel multi-perspective discovery | **ACTIVE — DO NOT RE-INVOKE**
```

### 5. Critical-Path `context` Hook Benchmark (`< 2 ms` Budget)

Measured using 7 interleaved samples (`S1 -> S2`, `S2 -> S1`, ...) after warmup, asserting completed work (`applied === true`, `thinnedParts > 0`, `system.length > 0`) on every run:

| Payload | Total Messages | Output-Thinned Tool Parts / Run | Min (`ms`) | Median (`ms`) | Max (`ms`) | All 7 Samples (`ms`) | Budget (`< 2.0 ms`) |
|---|---|---|---|---|---|---|---|
| `session-bcad339b` (`S1` full export) | `87` | `76` | `0.0134` | **`0.0150`** | `0.0357` | `[0.0134, 0.0135, 0.0137, 0.0150, 0.0348, 0.0354, 0.0357]` | **PASS (`133x` under budget)** |
| `session-a35adea6` (`S2` full export) | `138` | `52` | `0.0140` | **`0.0337`** | `0.0448` | `[0.0140, 0.0164, 0.0198, 0.0337, 0.0374, 0.0404, 0.0448]` | **PASS (`59x` under budget)** |

- **Physical Limiter:** In-memory array walk over `event.messages` + `Map.get(callId)` lookup for precomputed `FactBreadcrumb`s + single regex pass on text parts containing `<skill_content`. Zero SQLite queries, zero filesystem reads/writes, and zero SHA-256 hashing occur inside `applyContextHookInMemory`.
