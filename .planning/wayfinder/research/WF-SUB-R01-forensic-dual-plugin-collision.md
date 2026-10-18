# WF-SUB-R01: Forensic PM & Architect Postmortem of the Dual-Plugin Collision

- **Status:** verified evidence
- **Owner:** coordinator + forensic specialist (`821329d8-0604-4e7a-a314-4a6d3ce73c9f`)
- **Primary Sources:**
  - Exported Session 1 [`session-bcad339b-471f-456c-8815-eb205e6c929b.json`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) (`ses_eb2eabb14ffeCXsCwb845rtffb`, 87 messages)
  - Exported Session 2 [`session-a35adea6-83a7-439f-90b1-f15793b79239.json`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) (`ses_eb23bfbf0ffesn5kT0yJI06h35`, 138 messages)
  - Manifested archive [`index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite) (56 sessions, 7 roots, 49 children, 6 compactions, 3,609 tool calls)
  - Prototype 1 [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts) and [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts)
  - Prototype 2 [`.opencode/plugins/context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts)
  - Prototype 3 [`.opencode/plugins/compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts)
  - Owner Vision [`the-3-prompting-designs-concepts-wayfinder.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md)

## 1. The Vibe Coder's Real Problem

The owner workflow in [`the-3-prompting-designs-concepts-wayfinder.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/human-used-prompting/the-3-prompting-designs-concepts-wayfinder.md) relies on two connected memory layers:

1. **Agent Trajectory Memory** covering delegated tasks, conversations, child results, user redirects, decisions, and resumable session lineage across OpenCode, Devin, and Antigravity.
2. **Codebase Structural Memory** covering AST-indexed symbols, Git commits, uncommitted shadow snapshots, co-change history, and the causal link between code changes and the conversations that produced them.

A human orchestrator wants to switch harnesses or reload at any point using high-level natural language (for example, *"prune the noise, look at my prompting throughout, and continue from the Wave 2 slice with the exact same posture"*). Today, sessions are stored as opaque `ses_...` IDs (`ses_eb23bfbf0ffesn5kT0yJI06h35`), raw JSONL files, and unindexed SHA-256 blobs. Neither the human nor the agent has a semantic layer that connects user intents, child trajectories, and codebase diffs.

## 2. Failure Trace A: Intra-Turn Auto-Run Prune Failure (`ses_eb2eabb14ffeCXsCwb845rtffb`)

In [`session-bcad339b-471f-456c-8815-eb205e6c929b.json`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json):

1. **Single-prompt 44-step auto-run (`msg[0..44]`):** The user issues one opening prompt at `msg[0]` (`msg_14d1544ee001vCXg3fPMactf6P`). The agent executes 44 assistant tool steps (`read`, `grep`, `skill`, `patch`, `subagent`, `hivemind-delegate`).
2. **Zero-byte prune (`msg[45]`):** At `msg[45]`, the agent attempts to thin its context before fan-in by calling `tools.ctx["context-prune"]({ mode: "recent" })`. The tool returns:
   `Ledger: 0 tool parts in range, ~0 chars of output will collapse to stubs. Anchor: your last user prompt (msg_14d1544ee001vCXg3fPMactf6P).`
3. **Root cause in [`context-prune.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/context-prune.ts#L112-L115):** Both `"recent"` and `"initial"` modes compute the thinning boundary via `findLastIndex(m => m.role === "user")`. Because `msg[0]` is the only user prompt, `lastUserIdx` is `0`, `event.messages.slice(0, 0)` is empty, and 100% of the 44 assistant tool steps sit after `msg[0]`. The prune operation frees `0` bytes.
4. **Forced auto-compaction and panic re-read loop (`msg[51..63]`):** Six steps later (`msg[51]`, `seq = 865`, `274,175` input tokens), the session hits hard auto-compaction. At `msg[58]`, the agent calls `tools.compaction_continuity({ action: "intents" })` without a `sessionID`, which fails with `"Specify action and sessionID for compaction_continuity."` ([`compaction-continuity.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.opencode/plugins/compaction-continuity.ts#L649-L689)). Blinded by compaction, the agent spends `msg[52..63]` re-invoking **15 skills** and re-reading **28 files** it had already inspected prior to `msg[51]`.

## 3. Failure Trace B: Dual-Plugin Collision (`ses_eb23bfbf0ffesn5kT0yJI06h35`)

In [`session-a35adea6-83a7-439f-90b1-f15793b79239.json`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json), `opencode-session-archive` and `opencode-context-prune` were used together at `msg[120..135]`:

1. **User directive (`msg[120]`):** *"I have reloaded this `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1` - you can try to prune the context to look at my prompting throughout and continue on from this with exact same posture."*
2. **Write-only archive call (`msg[122]`):** The agent executes `return await tools.archive.persist({})`. It writes to [`.session-archive/index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite) and returns:
   `Persisted session tree rooted at ses_eb23bfbf0ffesn5kT0yJI06h35 into .../.session-archive. 9 sessions, 260 messages, 8 delegations. 3 files written, 421 unchanged.`
3. **Blind stub prune (`msg[123]`):** The agent executes `return await tools.ctx["context-prune"]({ mode: "recent" })`. This collapses 53 tool parts (`~311,570` chars) and reduces all loaded skill bodies to generic `"rerun the tool"` stubs.
4. **Ad-hoc shell scraping (`msg[124..125]`):** Because [`src/plugin.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/plugin.ts#L28-L78) exposes only `archive.persist` and zero read/search tools, the agent cannot query the SQLite index or blobs through a tool. At `msg[124]`, it shells out with `head -c 1600 .../.session-archive/sessions/ses_eb23bfbf0ffesn5kT0yJI06h35/ses_eb23bfbf0ffesn5kT0yJI06h35.jsonl` to guess the JSONL format. At `msg[125]`, it runs an inline Python script over the JSONL file and dumps `15,000`-character raw user prompts straight back into the context window.
5. **Re-read spiral and quota death (`msg[125..135]`):** Because `context-prune` wiped tool outputs and skill bodies without recording semantic breadcrumbs (`blob:<sha256>`, summary, line ranges) or a `WorkingMemoryManifest`, the agent re-reads `STATE.md` twice, `.opencode/AGENTS.md`, `the-3-prompting-designs-concepts-wayfinder.md`, 5 `.audit/` files, and re-loads 7 skills (`msg[128..129]`), hitting the provider usage limit at `msg[135]`.

## 4. Audit of the Manifested `.session-archive/` vs Current Prototype Code

Inspecting [`/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite) revealed 56 archived sessions (`7` roots at `depth = 0`, `49` child sessions at `depth = 1` across `opencode`, `devin`, and `antigravity`), `6` compactions, and `3,609` tool calls (`1,687` `read` calls, `781` `shell` calls, `407` `skill` calls, `269` `grep` calls).

Comparing the manifested SQLite database against [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts) exposed three critical gaps:

| Dimension | Manifested `.session-archive/index.sqlite` | Current `src/archive/index-db.ts` | Gap to Solve in Wayfinder Prototypes |
|---|---|---|---|
| **Delegation PK** | `PRIMARY KEY (parent_session, call_id)` | Regressed to `PRIMARY KEY (parent_session_id, child_session_id)` | `child_session_id` is nullable and a resumed child has multiple turns (`spawn` + `send`). Must key by `call_id` or `turn_index`. |
| **Files Changed** | `files_changed` is `NULL` on all 7 root sessions | Tracks only session-level diff integers | No `file_touch` table linking `session_id + message_id + snapshot_sha` to modified paths and git commits. |
| **Semantic Layer** | Keyed only by `ses_...` IDs and raw `blob:<sha256>` | Keyed only by `ses_...` IDs and raw `blob:<sha256>` | Zero semantic session digest, zero user-intent pivot index, zero FTS5 search, and zero AST/codebase link. |
| **Read Surface** | None (`archive.persist` only) | None (`archive.persist` only) | Forces agents to shell out with Python/Bash to scrape `.session-archive/sessions/ses_.../*.jsonl`. |
