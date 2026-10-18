# WF-SUB-03: Host KV Lineage, Shadow Snapshot Blob Sinking & Reported-vs-Verified Outcome Classifier

- **ID:** `WF-SUB-03`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `resolved (prototype verified)`
- **Depends on:** none
- **Evidence Input:** [`WF-SUB-R02`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R02-host-storage-kv-snapshots-spills.md)
- **Prototype Artifacts:**
  - [`wf-sub-03-spine-ingestion.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts)
  - [`wf-sub-03-spine-ingestion.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.test.ts)
  - [`wf-sub-03-spine.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-spine.sqlite)

## Question

How should `hivemind-substrate` ingest `opencode.db`'s `kv` table (`bindings/v1/*`, `delegate-mode/child/*`), sink uncommitted file drafts from `~/.local/share/opencode/snapshot/<project_id>/<worktree_hash>/` before 7-day `git gc`, capture external `~/.local/share/opencode/tool-output/` and `shell/` spills, and classify `ReportedOutcome` vs `VerifiedOutcome` across multi-stop child trajectories?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-03-spine-ingestion.ts`)

1. Prototype `kv` ingestion in [`source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts) and multi-stop `delegation_turn(parent_session_id, call_id, turn_index, child_session_id, ...)` normalization in [`normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts) (fixing the regressed `PRIMARY KEY (parent_session_id, child_session_id)` in [`src/archive/index-db.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/index-db.ts#L59-L76)).
2. Prototype `ReportedOutcome` vs `VerifiedOutcome` classification against the 11 false-positive Antigravity child sessions in `ses_ecbfc0f40ffenfykTrNGoMS6o1` and `ses_eb23bfbf0ffesn5kT0yJI06h35` (`100%` detection of `BLOCKED` / MCP timeout / tool error inside `idle.outcome = "succeeded"` turns).
3. Prototype `git --git-dir=<shadow_repo> cat-file --batch` blob extraction for `Assistant.snapshot.files[]` (`start` and `end` trees) and external spill file sinking (`tool-output/tool_<callID>` and `shell/<callID>.txt`).

## Resolution & Measured Evidence

### 1. Host `kv` Table Schema & Key Normalization (`principle-model-the-domain`)

Direct inspection of `~/.local/share/opencode/opencode.db` (`1,614` rows in `kv`) established that OpenCode v2.0.32 defines `CREATE TABLE kv (key text PRIMARY KEY, value text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)` and encodes plugin namespaces as `plugin:<utf16be-hex>:<logical_key>`.
- `0068006900760065006d0069006e0064002d0073007400650077006100720064002d006f0063002d0064006500760069006e` decodes to `"hivemind-steward-oc-devin"` (`596` `bindings/<childSessionID>` rows, `452` `delegate-mode/child/<childSessionID>` rows, and `530` `delegate-mode/pending/<callID>` rows).
- `0063006f006e0074006500780074002d007000720075006e0065` decodes to `"context-prune"` (`3` `context-prune:<sessionID>` watermark rows for `ses_ebae46b0bffea6W0buyxGHhd5i`, `ses_eb2eabb14ffeCXsCwb845rtffb`, and `ses_eb23bfbf0ffesn5kT0yJI06h35`).

[`ingestHostKv`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts#L287-L594) supports both the real OpenCode v2.0.32 `plugin:<utf16be-hex>:<logical_key>` format and the scoped `(scope, name, value)` format (`bindings/v1/<childSessionID>`, `bindings-by-foreign/v1/<harness>/<foreignSessionId>`, `delegate-mode/child/<childSessionID>`, `session:<sessionID>:context-prune:<sessionID>`), populating `619` `kv_binding` rows (`618` from `opencode.db` + `1` `WF-SUB-R02` fixture), `604` `kv_foreign_index` rows, and `4` `kv_context_prune` rows in [`wf-sub-03-spine.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-spine.sqlite).

### 2. Multi-Stop `delegation_turn` Normalization (`principle-model-the-domain`)

Replacing `PRIMARY KEY (parent_session_id, child_session_id)` with `PRIMARY KEY (parent_session_id, call_id, turn_index)` in `delegation_turn` prevents later `mode = "send"` or `mode = "continue"` stops from overwriting earlier `mode = "spawn"` stops. [`segmentChildStops`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts#L680-L748) partitions each child session's messages into chronological stop segments bounded by `idle` records or subsequent `user` prompts after an `assistant` response (handling Devin children such as `ses_ecb0cedf8ffen0PsHOY8iBYmnO` whose first stop ended before an `idle` row was written).

| Child Session ID | Harness | Stops | Stop 0 (`spawn`) Range (`start_message_id -> end_message_id`) | Stop 1+ (`send`) Range (`start_message_id -> end_message_id`) | Origin |
|---|---|---:|---|---|---|
| `ses_ecbb24ca8ffeFd8wX7v0a9iY0j` | `antigravity` | 2 | `msg_1340f258a001xL47zK6w3nK0E0 -> msg_13410efbb001I29K7gX3C5U363` | `msg_1342be5250016yR75p270S30F6 -> msg_1342dc0310018q5M1K3r0H4W8G` | `wf_sub_r02_fixture` |
| `ses_ecbea4dc7ffeRHomkI6oNWAtM6` | `antigravity` | 2 | `msg_13415b2520014hSBr7rMTQrgLr -> msg_1341afb56002U6B05Rpao2ItW5` | `msg_13423cca5001cwYJKIyVCfV4D8 -> msg_134260165001Z1pcmGxe776SCa` | `host_db` (`P1`) |
| `ses_ecbd18c21ffe5mPmDzXKi6KiVI` | `devin` | 2 | `msg_1342ea2e600171fR3S0o4a5f7t -> msg_1343a68fa002G2L8H6D3g6u8j2` | `msg_1343dc03a001X7X7H6W6r4X6q3 -> msg_134410f32002r7T1e5x2e0v0j1` | `host_db` (`P1`) |
| `ses_ecbcff4b6ffedCnGRuiLI2rZjP` | `antigravity` | 2 | `msg_134306cb30016l4U7j5q2x3D6v -> msg_1343cf338002u7k6f0a5l7O8C4` | `msg_1343dc06b0014c8T4I3f7K8p4y -> msg_13448ebfa001a4Y8S4z4w5N2u8` | `host_db` (`P1`) |
| `ses_ecbafa12bffeTgeDG59c9cd822` | `devin` | 3 | `msg_134507120001u1o4U0P2X2s0q9 -> msg_134678ea4002L3l2C0D0P1K3T8` | `2` follow-up `send` stops (`seq 52..106`, `seq 107..129`) | `host_db` (`P1`) |
| `ses_ecb73e10affe3IkqUVU37CtiYX` | `antigravity` | 2 | `msg_1348cefb70016x0Y5z7b3J7F1G -> msg_13493545500265q7Y8F0B4S5X9` | `msg_13496b5950015W6o7h4K2r2A0a -> msg_134997d190025U5S7g8Z4K5m9b` | `host_db` (`P1`) |
| `ses_ecb5b9386ffe6KuUthhbCEpzmo` | `antigravity` | 3 | `msg_134a66be40014S5J5I2B3w3f2d -> msg_134bd2b190023P5U5b1u6p5O3q` | `2` follow-up `send` stops (`seq 170..235`, `seq 236..270`) | `host_db` (`P1`) |
| `ses_ecb0cedf8ffen0PsHOY8iBYmnO` | `devin` | 2 | `msg_134f310720010I3Y2X5M4z8r1W -> msg_134f310900014K6v3A8o1k3g9M` | `msg_134f3ab0d0019b1F7G4B6l7p2Z -> msg_134fb88180024J7q2D1A8N5b7W` | `host_db` (`P1`) |

### 3. `ReportedOutcome` vs `VerifiedOutcome` Classifier (`principle-prove-it-works`)

Across `ses_ecbfc0f40ffenfykTrNGoMS6o1` (`19` Antigravity children) and `ses_eb23bfbf0ffesn5kT0yJI06h35` (`6` Antigravity children, `25` total in `opencode.db`), [`classifyMessagesOutcome`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts#L604-L678) achieved `100%` detection of all `11` false-positive `idle.outcome = "succeeded"` Antigravity child sessions, plus `100%` of the `3` `WF-SUB-R02` illustrative sessions:

| Child Session ID | Parent Session | `reported_outcome` | `verified_outcome` | Tool Errors | Blocker / Failure Evidence |
|---|---|---|---|---:|---|
| `ses_ecbea4dc7ffeRHomkI6oNWAtM6` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 26 | `26` tool parts with `state.status = "error"` across 2 stops |
| `ses_ecbcff4b6ffedCnGRuiLI2rZjP` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 20 | `20` tool parts with `state.status = "error"` across 2 stops |
| `ses_ecbaee7ceffeac817i6a2bbnrS` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `blocked_in_text` | 0 | `mcp_init_failed: The MCP server 'context7' failed to initialize: ... no such host` |
| `ses_ecb976e93ffeNHJhK36naggKfv` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 10 | `10` tool parts with `state.status = "error"` |
| `ses_ecb73e10affe3IkqUVU37CtiYX` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 23 | `23` tool parts with `state.status = "error"` across 2 stops |
| `ses_ecb5b9386ffe6KuUthhbCEpzmo` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 81 | `81` tool parts with `state.status = "error"` across 3 stops |
| `ses_ecac8b9f3ffeocyPoQ213dVNGl` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `tool_error_inside` | 1 | `tool_error(read): Access denied: skill path is outside allowed directories` |
| `ses_ecab2b14bffe03agFOieLyhVU4` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `blocked_in_text` | 0 | `explicit_blocked: - **BLOCKED** on upstream export landing dependencies and the secret scanner F1 failure` |
| `ses_eb218cdefffeQwYKeZ3iXjOt8I` | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `succeeded` | `tool_error_inside` | 1 | `tool_error(read): Access denied: skill path is outside allowed directories` |
| `ses_eb1f7e37dffei8sNgQsv9R5Cui` | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `succeeded` | `tool_error_inside` | 28 | `28` tool errors from pre-tool hook read lease denial on `the-3-prompting-designs-concepts-wayfinder.md` |
| `ses_eb1b750c2ffe4tqUHdVrcXMwbb` | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `succeeded` | `tool_error_inside` | 14 | `14` tool parts with `state.status = "error"` |
| `ses_ecb8ab382ffe6D8z1uA2jQ7sT4` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `blocked_in_text` | 0 | `WF-SUB-R02` fixture (`MCP server context7 timed out`) |
| `ses_ecba9633effe9G0n4tP1kL5wR2` | `ses_ecbfc0f40ffenfykTrNGoMS6o1` | `succeeded` | `blocked_in_text` | 0 | `WF-SUB-R02` fixture (`The tavily-search MCP tool failed with an error`) |
| `ses_eb1f7e38dffeqA9W0cM5xN8pL1` | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `succeeded` | `blocked_in_text` | 0 | `WF-SUB-R02` fixture (`BLOCKED: read lease violation / missing file`) |

### 4. Shadow Snapshot Git Blob Sinking & `cat-file --batch` Benchmark (`principle-explain-the-number`)

[`sinkShadowSnapshots`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts#L965-L1050) resolves `~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/` (`7f40ac98354168df291b3fc13110000258db1112` with `11,922` Git objects and `a437a837c83293074c68b24c8dacabb2f4b4e7f1` with `40,001` Git objects) and extracts `start_tree:path` and `end_tree:path` blobs in a single `git --git-dir=<shadowRepo> cat-file --batch` pass per shadow repository.

A 5-trial interleaved A/B benchmark (`benchmark-checklist`) on the `62` non-empty snapshots (`175` unique `tree:path` specs, `169` found, `6` missing before creation, `128` unique Git blobs, `5.68 MB` raw bytes) in `ses_eb23bfbf0ffesn5kT0yJI06h35` compared two strategies:
- **Strategy A (1-pass `git cat-file --batch` with in-memory `gitBlobSha -> sha256` memoization):** median `43.89 ms` (range `43.41..44.85 ms`).
- **Strategy B (2-pass `git cat-file --batch-check` + deduplicated `git cat-file --batch`):** median `51.59 ms` (range `51.38..52.31 ms`).
- **Limiter analysis (`principle-explain-the-number`):** Spawning a second `git` subprocess and re-mapping the packfile index in `~/.local/share/opencode/snapshot/` adds `~15 ms` of process/mmap overhead on macOS arm64, which exceeds the `~7 ms` saved by avoiding `1.43 MB` of duplicate pipe reads across `41` repeated `gitBlobSha` transitions. Single-pass `git cat-file --batch` with `gitBlobSha -> sha256` memoization is therefore faster and simpler.

Both uncommitted `SPEC.md` drafts from `WF-SUB-R02` (`1590b08d` -> `23,314` bytes -> `blobs/be57c4ad41152deb0c2158da8ec029163eaa3e34e663ff0bcadc6db154b1531e.txt` and `5bc43988` -> `24,251` bytes -> `blobs/041b411d34fc8f8bdc9aaabf07104f382e8a535faa9b73c0fd7a76a5ea507b1e.txt`) and `10` real uncommitted `SPEC.md` snapshot transitions from `ses_eb23bfbf0ffesn5kT0yJI06h35` (`.planning/SPEC.md` `216,962 -> 218,285` bytes, `.planning/phases/multi-harness-delegation/SPEC.md` `104,037 -> 107,159 -> 110,951` bytes, `.planning/phases/native-session-host-bridges/SPEC.md` `43,403 -> 43,669` bytes) were extracted and verified on disk (`464` `snapshot_artifact` rows total).

### 5. External Spill File Sinking (`tool-output/` and `shell/`)

[`sinkExternalSpills`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-03-spine-ingestion.ts#L1054-L1146) captures untruncated spill payloads from `state.metadata.outputPath`, inline `[showing lines ...; full output saved to /Users/MAC/.local/share/opencode/shell/<project_id>/sh_<id>.out]` markers, `~/.local/share/opencode/tool-output/tool_<callID>`, and `~/.local/share/opencode/shell/<callID>.txt`. Across the evaluated sessions, `21` external spills (`20` unique `(session_id, call_id)` rows in `spill_artifact`) were sunk into content-addressed blobs, including `call_e3bLiXQB56Lxyr9odaZNMXyu` (`webfetch` in `ses_ecbfc0f40ffenfykTrNGoMS6o1`, `59,015` full bytes vs `51,295` inline bytes) and `chatcmpl-tool-9b34556554cc90bd` (`shell` in `ses_eb1d59ed6ffe4mPNVnyQJfovU7`, `181,547` full bytes vs `51,365` inline bytes).

## Verification Receipt

- `bun scratch/prototypes/wf-sub-03-spine-ingestion.ts` -> exit `0` (`1,167.7 ms`, `618` host `kv_binding` rows, `124` `delegation_turn` rows, `464` `snapshot_artifact` rows, `21` external spills, `562` unique content-addressed blobs written).
- `bun test scratch/prototypes/wf-sub-03-spine-ingestion.test.ts` -> `6 pass, 0 fail, 131 expect() calls` (`882.00 ms`).
