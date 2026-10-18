---
kind: uat
phase: trajectory-working-memory
engineering: ENGINEERING_VERIFIED
acceptance: UAT_PENDING
candidate: de42f87
snapshot: dist/session-archive.ts
updated: 2026-10-18T20:46:00+07:00
---

# UAT: Phase E1.1 Trajectory Working Memory

## Engineering evidence

| Check | Command | Result |
|---|---|---|
| Repository gate | `bun test && bun run typecheck && bun run build` | `128 pass, 1 skip, 0 fail (2,160 expect() calls)` · `tsc --noEmit` clean · `dist/session-archive.ts` (`341,139` bytes) |
| TWM-01 gate | `bun test test/source.test.ts` | `18 pass, 0 fail` (read-only host DB + `kv` drift guard + UTF-16BE decoding) |
| TWM-02 gate | `bun test test/normalize.test.ts` | `21 pass, 0 fail` (user/skill/shell blob sinking + multi-stop `delegation_turn` outcome classifier) |
| TWM-03 gate | `bun test test/snapshots-spills.test.ts` | `2 pass, 0 fail` (1-pass `git cat-file --batch` shadow snapshot extraction + external spill capture) |
| TWM-04 gate | `bun test test/persist.test.ts` | `16 pass, 0 fail` (`< 2 ms` warm skip, `< 150 ms` incremental delta sync, `0 SQLITE_BUSY` across 50 concurrent WAL ops) |
| TWM-05 gate | `bun test test/valve.test.ts` | `11 pass, 0 fail` (hybrid step-watermark `WorkingSetValve`, `FactBreadcrumb`, `WorkingMemoryManifest`, `0.35 ms` in-memory `context` hook) |

## How to start

1. Copy `dist/session-archive.ts` into `<project>/.opencode/plugins/session-archive.ts` (or `~/.config/opencode/plugins/`).
2. Start or reload your OpenCode V2 session in the target repository.

## Tests

### 1. Read-only session tree sync & foreign `kv` binding capture (REQ-SUB-01, REQ-SUB-02, REQ-SUB-06)

do: Call `substrate.viewport({ action: "sync" })` (or `archive.persist({})`) in an active OpenCode V2 session with child delegations.
expect: Returns a persistence report writing `.session-archive/index.sqlite` and `.session-archive/blobs/<sha256>.txt` outside `.opencode/` without modifying `opencode.db`; repeating the call with no new turns completes in `< 2 ms` with `0` files rewritten.
result: pending

### 2. Multi-stop delegation outcome classification & snapshot/spill blob recovery (REQ-SUB-03, REQ-SUB-04, REQ-SUB-05)

do: Call `substrate.viewport({ action: "status" })` after a child `subagent`, `delegate-devin`, or `hivemind-delegate` turn completes.
expect: Displays each child delegation turn with both `reported_outcome` and `verified_outcome` (flagging any inner tool error or `BLOCKED` text despite `idle.outcome = "succeeded"`) plus content-addressed `blob:<sha12>` handles for prompts, shadow snapshots, and external spills.
result: pending

### 3. Intra-turn step-watermark pruning & `WorkingMemoryManifest` injection (REQ-SUB-07, REQ-SUB-08)

do: Run a multi-step turn (`> 12` assistant steps or `> 65%` context window) or invoke `substrate.valve({ action: "prune", mode: "step-window", keepRecentSteps: 8 })`, then inspect `substrate.valve({ action: "status" })` and resolve a pruned `blob:<sha12>` via `substrate.viewport({ action: "resolve", blob: "<sha12>" })`.
expect: Older `read`, `skill`, and `shell` outputs before the step watermark are replaced in memory with `FactBreadcrumb` strings and a `WorkingMemoryManifest` header (`FRESH — DO NOT REREAD` / `ACTIVE — DO NOT RE-INVOKE`), and `substrate.viewport({ action: "resolve" })` returns the exact original lines.
result: pending

## Manual-only

- Live OpenCode V2 host LLM adherence to `FRESH — DO NOT REREAD` and `ACTIVE — DO NOT RE-INVOKE` directives across a 45+ step autonomous turn: requires live host LLM turn execution.

## Dogfooding

- `dist/session-archive.ts` `context` hook and `substrate.valve` tool during the next multi-step OpenCode V2 coding session.

## Summary

total: 3 · pass: 0 · issue: 0 · pending: 3 · skipped: 0 · blocked: 0

## Gaps
