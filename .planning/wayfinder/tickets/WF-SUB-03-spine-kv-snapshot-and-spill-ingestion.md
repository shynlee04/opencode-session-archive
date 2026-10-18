# WF-SUB-03: Host KV Lineage, Shadow Snapshot Blob Sinking & Reported-vs-Verified Outcome Classifier

- **ID:** `WF-SUB-03`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** none
- **Evidence Input:** [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md)

## Question

How should `hivemind-substrate` ingest `opencode.db`'s `kv` table (`bindings/v1/*`, `delegate-mode/child/*`), sink uncommitted file drafts from `~/.local/share/opencode/snapshot/<project_id>/<worktree_hash>/` before 7-day `git gc`, capture external `~/.local/share/opencode/tool-output/` and `shell/` spills, and classify `ReportedOutcome` vs `VerifiedOutcome` across multi-stop child trajectories?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-03-spine-ingestion.ts`)

1. Prototype `kv` ingestion in `source.ts` and multi-stop `delegation_turn(parent_session_id, call_id, turn_index, child_session_id, ...)` normalization in `normalize.ts` (fixing the regressed `PRIMARY KEY (parent_session_id, child_session_id)` in [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L59-L76)).
2. Prototype `ReportedOutcome` vs `VerifiedOutcome` classification against the 11 false-positive Antigravity child sessions in `ses_ecbfc0f40ffenfykTrNGoMS6o1` and `ses_eb23bfbf0ffesn5kT0yJI06h35` (`100%` detection of `BLOCKED` / MCP timeout / tool error inside `idle.outcome = "succeeded"` turns).
3. Prototype `git --git-dir=<shadow_repo> cat-file --batch` blob extraction for `Assistant.snapshot.files[]` (`start` and `end` trees) and external spill file sinking (`tool-output/tool_<callID>` and `shell/<callID>.txt`).
