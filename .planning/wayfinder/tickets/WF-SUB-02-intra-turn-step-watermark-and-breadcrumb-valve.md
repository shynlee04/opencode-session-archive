# WF-SUB-02: Intra-Turn Assistant Step-Watermark Pruning & FactBreadcrumb Valve

- **ID:** `WF-SUB-02`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
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
