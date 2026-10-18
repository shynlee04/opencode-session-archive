# WF-SUB-01: Semantic Session Digest, Intent Pivot Index & Vibe-Coder Navigation

- **ID:** `WF-SUB-01`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** none
- **Evidence Input:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md)

## Question

How can `hivemind-substrate` add a thin, deterministic semantic layer over opaque `ses_...` IDs in `.session-archive/index.sqlite` so that both vibe coders and orchestrator agents can locate prior prompts, intent pivots, child trajectories, and touched files by topic or natural language without shelling out with custom Python scripts over raw `.jsonl` files?

## Why This Matters (Observed Failure)

In [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) (`msg[120..125]`), after running `archive.persist` and `context-prune`, the agent had only the opaque string `ses_eb23bfbf0ffesn5kT0yJI06h35`. Because `session-archive` stores raw `ses_id` directories and exposes no semantic index or query tool, the agent ran `head -c 1600` (`msg[124]`) and an inline Python JSONL loop (`msg[125]`) that dumped `15,000`-character raw messages back into active context.

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-01-semantic-digest.ts`)

1. Extend a throwaway copy of `.session-archive/index.sqlite` (`56` sessions) with:
   - `session_semantic_digest(session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state)`
   - `intent_pivot(id, session_id, message_id, seq, t, prompt_excerpt, blob_ref, pivot_kind)`
   - `substrate_fts` (`USING fts5(session_id, kind, symbol_or_path, body)`)
2. Run the prototype against the manifested [`index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite) and [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json).
3. Measure whether querying *"look at my prompting throughout and continue from Wave 2 slice"* returns a `< 600`-token structured digest with exact `blob:<sha256>` handles in `< 5 ms`, eliminating the `msg[124..125]` shell/Python scraping loop.
