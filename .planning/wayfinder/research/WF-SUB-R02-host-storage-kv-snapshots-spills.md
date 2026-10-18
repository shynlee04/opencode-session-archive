# WF-SUB-R02: Host Storage Forensics — KV Bindings, False-Positive Completions, Shadow Snapshots & Spills

- **Status:** verified evidence
- **Owner:** Forensic & Host-Storage Specialist (`821329d8-0604-4e7a-a314-4a6d3ce73c9f`)
- **Primary Sources:**
  - Read-only host SQLite database `~/.local/share/opencode/opencode.db` (`2.15 GB`)
  - Shadow Git bare repositories `~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/`
  - External spill directories `~/.local/share/opencode/tool-output/` and `~/.local/share/opencode/shell/`
  - [`native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts), [`native-checkpoint.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-checkpoint.ts), [`child-inventory.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/child-inventory.ts)
  - [`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts) and [`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts)

## 1. Uncaptured `kv` Table Lineage in `opencode.db`

[`src/archive/source.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/source.ts#L106-L148) queries only `session` and `session_message`. It ignores the host `kv` table (`PRIMARY KEY (scope, name)`), which stores the authoritative foreign-harness binding records written by [`native-checkpoint.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-checkpoint.ts#L28-L163) and [`child-inventory.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/child-inventory.ts#L22-L120):

- `bindings/v1/<childSessionID>` (`scope = "plugin:hivemind-steward-oc-devin"`): `driverKind` (`"acp-W"`), `harness` (`"devin"` | `"antigravity"`), `foreignSessionId`, `parentSessionID`, `title`, `createdAt`, `updatedAt`, `cwd`, `agent`, `model`, `effort`.
- `bindings-by-foreign/v1/<harness>/<foreignSessionId>`: reverse index from foreign ACP session ID to native `childSessionID`.
- `delegate-mode/child/<childSessionID>`: `mode` (`"spawn"` | `"send"`), `background` (`boolean`), `requestedModel`, `confirmedModel`, `confirmedEffort`, `updatedAt`.
- `active-child/v1`: transient recovery lock pointer.
- `session:<sessionID>:context-prune:<sessionID>`: pruning ledger state.

## 2. Multi-Stop Resumed Trajectories & False-Positive `succeeded` Completions

### A. Multi-Stop Resumed Child Trajectory
In `opencode.db`, child `ses_ecbb24ca8ffeFd8wX7v0a9iY0j` (`agent = "antigravity-delegate"`, parent `ses_ecbfc0f40ffenfykTrNGoMS6o1`) contains **2 `user` messages, 2 `assistant` messages, and 2 `idle` messages** in a single `session_message` sequence:
- Stop 1 (`msg_1340f258a001xL47zK6w3nK0E0` -> `msg_13410efbb001I29K7gX3C5U363`): Initial `spawn` turn reviewing `SPEC.md`, ending with `idle.outcome = "succeeded"`.
- Stop 2 (`msg_1342be5250016yR75p270S30F6` -> `msg_1342dc0310018q5M1K3r0H4W8G`): Follow-up `send` turn verifying amended `SPEC.md`, ending with a second `idle.outcome = "succeeded"`.

[`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L317-L322) currently overwrites `lastIdleOutcome` with the last `idle` event and collapses the child to one row in `delegation`, erasing per-stop boundaries.

### B. False-Positive Host `succeeded` Outcomes (11 Antigravity Children Verified)
When an external ACP turn finishes without throwing a JSON-RPC transport exception, [`native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts#L3086-L3103) emits `SessionTurnCompleted`, which the host records as `idle.outcome = "succeeded"` (`<subagent ... state="completed">`).

Across `ses_ecbfc0f40ffenfykTrNGoMS6o1` and `ses_eb23bfbf0ffesn5kT0yJI06h35`, **11 Antigravity child sessions** recorded `idle.outcome = "succeeded"` while their actual text or tool outputs reported fatal blockers:
- `ses_ecb8ab382ffe6D8z1uA2jQ7sT4`: `idle.outcome = "succeeded"`, text states `BLOCKED — MCP tool call failed: MCP server context7 timed out`.
- `ses_ecba9633effe9G0n4tP1kL5wR2`: `idle.outcome = "succeeded"`, text states `The tavily-search MCP tool failed with an error; no web results were retrieved`.
- `ses_eb1f7e38dffeqA9W0cM5xN8pL1`: `idle.outcome = "succeeded"`, text states `BLOCKED: read lease violation / missing file`.

`hivemind-substrate` must index `reported_outcome` (host `idle.outcome`) separately from `verified_outcome` (`verified_pass` | `reported_only` | `tool_error_inside` | `blocked_in_text` | `empty_output`).

## 3. Point-in-Time Uncommitted Draft Recovery via OpenCode Shadow Snapshot Git Repos

OpenCode maintains a bare Git repository per worktree at:
`~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/`
(with legacy path `~/.local/share/opencode/snapshot/<project_id>/`).

Every `assistant` message in `session_message` carries `snapshot: { start: "<tree_sha>", end: "<tree_sha>", files: [...] }`, where `start` and `end` are raw Git `tree` objects produced by `git write-tree` before and after the assistant turn.

We verified point-in-time recovery on uncommitted edits to `.planning/phases/production-release/SPEC.md` inside `ses_ecbfc0f40ffenfykTrNGoMS6o1` against `/Users/MAC/.local/share/opencode/snapshot/ef76d91bc2a2fa8daffdb1a93a677e457792e8bb`:
1. `msg_1340ebfb4001z58U5O2P8y2X0T` (`start = 8900ab62...` -> `end = 1590b08d...`):
   `git --git-dir=... show 1590b08d...:.planning/phases/production-release/SPEC.md` recovered the exact `23,314`-byte first uncommitted draft (`blob 27057c59...`).
2. `msg_1342b88cc001C1m4L9U2p5B8v0` (`start = 1590b08d...` -> `end = 5bc43988...`):
   `git --git-dir=... show 5bc43988...:.planning/phases/production-release/SPEC.md` recovered the exact `24,251`-byte second uncommitted draft (`blob 5ce7033c...`).

**GC Hazard:** OpenCode runs `git gc --prune=7.days.ago` on shadow snapshot repos, and these trees are never committed to refs. Therefore, `hivemind-substrate` must copy the blobs for every `snapshot.files[]` entry (`start` and `end` tree SHAs) into `.session-archive/blobs/<sha256>.txt` during incremental sync.

## 4. External Tool-Output and Shell Spill Files

OpenCode spills oversized outputs to two external unreferenced directories:
1. `~/.local/share/opencode/tool-output/tool_<callID>` (truncated at `2,000` lines / `50 KB`, retention `7 days`).
2. `~/.local/share/opencode/shell/<callID>.txt` (truncated at `250` lines / `10 KB` by `execute-shell`).

[`src/archive/normalize.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/src/archive/normalize.ts#L504-L530) currently hashes only the inline truncated preview string in `session_message.data`. During ingestion, `hivemind-substrate` must detect both spill paths and copy the full external file into `.session-archive/blobs/<sha256>.txt` before the 7-day host cleanup deletes it.
