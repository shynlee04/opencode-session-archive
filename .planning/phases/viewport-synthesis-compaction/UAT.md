---
kind: uat
phase: viewport-synthesis-compaction
engineering: ENGINEERING_VERIFIED
acceptance: UAT_PENDING
candidate: de42f87
snapshot: dist/session-archive.ts
updated: 2026-10-18T20:46:00+07:00
---

# UAT: Phase E1.3 Viewport Synthesis & Compaction Continuity

## Engineering evidence

| Check | Command | Result |
|---|---|---|
| Repository gate | `bun test && bun run typecheck && bun run build` | `128 pass, 1 skip, 0 fail (2,160 expect() calls)` · `tsc --noEmit` clean · `dist/session-archive.ts` (`341,139` bytes) |
| VSC-01 gate | `bun test test/semantic-digest.test.ts` | `8 pass, 0 fail` (9-category `IntentPivot`, compound token boundary expansion, `< 5 ms` FTS5 vibe navigation in `< 600` tokens) |
| VSC-02 gate | `bun test test/continuity.test.ts` | `5 pass, 0 fail` (live disk SHA-256 `ProvenanceChain` staleness reconciliation, default `sessionID` resolution, `< 1,200`-token `CompactionContinuationPacket`) |
| VSC-03 gate | `bun test test/brief.test.ts` | `3 pass, 0 fail` (`buildImplementorViewportBrief` 4-tier packing within `maxTokens`) |
| VSC-04 gate | `bun test test/plugin.test.ts` | `9 pass, 0 fail` (`substrate.valve`, `substrate.viewport`, `archive.persist`, `ctx.context-prune`, hooks, and `dist/session-archive.ts` bundle) |

## How to start

1. Copy `dist/session-archive.ts` into `<project>/.opencode/plugins/session-archive.ts`.
2. Start or reload your OpenCode V2 session.

## Tests

### 1. Natural-language FTS5 vibe navigation & 9-category `IntentPivot` timeline (REQ-SUB-13, REQ-SUB-16)

do: Call `substrate.viewport({ action: "search", query: "Wave 2 slice 1" })` and `substrate.viewport({ action: "timeline" })` without passing `sessionID`.
expect: Resolves the active/latest root session automatically without throwing `"Specify action and sessionID"`, returning a `< 600`-token `StrategistViewport` digest and categorized `IntentPivot` timeline with `blob:<sha256>` handles.
result: pending

### 2. Live `ProvenanceChain` staleness reconciliation & SQLite compaction continuity (REQ-SUB-14, REQ-SUB-15)

do: Call `substrate.viewport({ action: "provenance" })` before and after editing a previously reviewed/read file, then trigger session compaction.
expect: Unchanged files remain `FRESH — DO NOT REREAD` / `verified_fresh`, edited files flip to `STALE (modified since read/review — re-verify slice)` / `verified_stale_by_later_touch`, and compaction injects the 6-section `< 1,200`-token `CompactionContinuationPacket` from SQLite.
result: pending

### 3. Unified plugin surface, legacy aliases & cross-harness `buildImplementorViewportBrief` (REQ-SUB-17, REQ-SUB-18)

do: Call `substrate.viewport({ action: "brief", targetPaths: ["src/plugin.ts"], symbolNames: ["resolveArchiveDir"], maxTokens: 1200 })` and verify `ctx.context-prune` and `archive.persist` aliases respond identically to `substrate.valve` and `substrate.viewport({ action: "sync" })`.
expect: `brief` returns a bounded `<= 1,200`-token packet combining Tier-1 `RepoMap`, Tier-2 `AstSkeleton`, Tier-3 `SymbolSlice`, Tier-4 `CoChangeCoupling` warnings, and active `ProvenanceChain` rows; legacy aliases operate seamlessly.
result: pending

## Manual-only

- Post-compaction zero-reread behavior of the live host LLM across a real compaction boundary: requires observing the model after an OpenCode V2 compaction event.

## Dogfooding

- `compaction` hook, `substrate.viewport({ action: "search" | "provenance" | "brief" })`, and `buildImplementorViewportBrief` during multi-harness delegation in `hivemind-steward-oc-devin-dev`.

## Summary

total: 3 · pass: 0 · issue: 0 · pending: 3 · skipped: 0 · blocked: 0

## Gaps
