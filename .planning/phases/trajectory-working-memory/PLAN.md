# Remediation Plan: Phase E1.1 Trajectory & Working Memory (`trajectory-working-memory`)

**Date:** 2026-10-18
**Status:** approved (`decisions.tsv` #6 / `/grill-with-docs` `A1..A4`)
**Owning Phase:** `E1.1 trajectory-working-memory` (`REQ-SUB-01` .. `REQ-SUB-08`)
**Audit Inputs:** `.audit/2026-10-18-uat-runtime-observation/{EVIDENCE.md,REPORT-product-design-gaps.md,REPORT-technical-smells.md}`

## Scope & Root-Cause Mapping

| Defect / Gap / Smell | Classification | Root Cause | Owning Module(s) |
|---|---|---|---|
| `D1` / `P-1` / `T-1` (`FRESH` unreachable; 12/12 reads marked `STALE`) | Bug / Spec flaw | `normalize.ts` (`read_blob_sha = sha256(rawFormattedReadToolOutput)`) and `valve.ts` (`armValve`) hashed OpenCode's formatted `Read file <path>, lines 1-N\n1: ...` tool string, whereas `reconcileProvenanceStaleness` (`continuity.ts`) hashed `readFileSync(absPath)` raw disk bytes. | `src/archive/primitives.ts`, `src/archive/normalize.ts`, `src/archive/valve.ts`, `src/viewports/continuity.ts` |
| `P-8` / `T-11` (Truncated reads recorded as `line_range: "all"`) | Bug / Spec amendment | When `read` was called without explicit `offset`/`limit` and OpenCode truncated at line 1,436 of 1,769, `extractReadLineRange` fell back to `"all"`, hiding uninspected lines `1437..1769`. | `src/archive/primitives.ts`, `src/archive/normalize.ts`, `src/archive/valve.ts` |
| `D2` / `P-3` (`substrate.valve` manual `prune` returns `0 of 0 steps thinned`) | Bug | `src/plugin.ts` checked `(toolCtx as any)?.messages`, which `Tool.Context` (`{ sessionID, messageID, agent, abort, metadata }`) never populates, instead of calling `await ctx.session.context({ sessionID })` with fallback to `sqliteSource(dbPath)`. | `src/plugin.ts`, `src/archive/valve.ts` |
| `T-5` / `T-6` / `T-7` / `T-9` (Split DDL across 4 files, duplicated `estimateTokens`/`normalizeRepoPath`, silent `catch {}`) | Refactor | Schema DDL was duplicated across `index-db.ts`, `continuity.ts`, `semantic-digest.ts`, and `ast-skeleton.ts`/`cochange.ts`; helpers were copied 3-4x; `persist()` swallowed errors silently. | `src/archive/primitives.ts`, `src/archive/index-db.ts`, `src/archive/index.ts` |
| Hidden `provenance_chain` production gap | Bug | `provenance_chain` rows were only seeded in prototype helper `seedProvenanceAndLedgers` (`continuity.ts:1878`), never extracted during live `persist()` / `writeIndex()`. | `src/archive/normalize.ts`, `src/archive/index-db.ts` |

## Remediation Units

### Unit TWM-R1: Shared Domain Primitives & Slice-Normalized File-Read Identity (`src/archive/primitives.ts`)
1. Create `src/archive/primitives.ts` as the single canonical owner of:
   - `sha256Hex(content: string | Uint8Array): string`
   - `estimateTokens(text: string): number` (`Math.ceil(text.length / 4)`)
   - `normalizeRepoPath(filePath: string, canonicalRoot?: string): string` (zero hardcoded repo names; strips `file://`, normalizes slashes, strips `canonicalRoot` prefix or resolves `./` relative paths cleanly)
   - `parseReadToolOutput(rawOutput: string, input?: Record<string, unknown>): FileReadCapture`
   - `computeDiskSliceSha(absPath: string, capture: Pick<FileReadCapture, "startLine" | "endLine" | "totalLines" | "isTruncated">): { status: "FRESH" | "SLICE" | "STALE" | "MISSING"; diskSliceSha: string | null; currentTotalLines: number }`
2. `parseReadToolOutput` parses OpenCode's `Read file <path>, lines <start>-<end> (of <total>)` header (or `1: ...` numbered lines and `[Output truncated. Continue reading with offset: <next>]` footer), strips the `^\d+:\s?` prefix from each captured line, and computes:
   - `blobSha`: `sha256Hex(rawOutput)` (for `.session-archive/blobs/<blobSha>.txt` lossless archive recall)
   - `sliceSha`: `sha256Hex(cleanLines.join("\n"))` (in the exact same hash domain as `diskLines.slice(startLine - 1, endLine).join("\n")`)
   - `startLine`, `endLine`, `totalLines`, `isTruncated`, and truthful `lineRange`:
     - `"all"` (`L1-L<total>`) ONLY when `startLine === 1 && !isTruncated && (totalLines === null || endLine >= totalLines)`
     - `"SLICE L<start>-L<end> of <total>"` when truncated or partial (`isTruncated || startLine > 1 || (totalLines !== null && endLine < totalLines)`).

### Unit TWM-R2: Single-Owner Schema (`src/archive/index-db.ts`) & Live `provenance_chain` Extraction (`src/archive/normalize.ts`)
1. Consolidate all Honeycomb tables (`session`, `delegation`, `delegation_turn`, `milestone`, `file_touch`, `kv_binding`, `kv_foreign_index`, `kv_context_prune`, `snapshot_artifact`, `spill_artifact`, `sync_watermark`, `file_read_ledger`, `skill_load_ledger`, `provenance_chain`, `compaction_continuation_ledger`, `session_semantic_digest`, `intent_pivot`, `substrate_fts`, `code_file`, `code_symbol`, `code_import_edge`, `git_cochange`, `git_cochange_file_stats`, `git_cochange_commit`) into `src/archive/index-db.ts` (`SCHEMA_DDL`), with idempotent column migration for existing `.session-archive/index.sqlite` files (`start_line`, `end_line`, `total_lines`, `is_truncated`, `slice_sha` on `file_read_ledger`).
2. Update `normalize.ts` to use `parseReadToolOutput` so `FileReadLedgerRow` stores both `blob_sha` (raw output blob) and `read_blob_sha` / `slice_sha` (clean line-slice SHA), plus truthful `line_range`, `start_line`, `end_line`, `total_lines`, and `is_truncated`.
3. Extract live `ProvenanceChainRow` entries during `normalize.ts` / `writeIndex()` in `index-db.ts` whenever a session touches files (`write` / `edit` / `patch` / `apply_patch`) and/or runs verification commands (`bun test`, `tsc`, `bun run build`), linking the user intent/finding prompt (`finding_seq`, `finding_summary`), file touch (`target_path`, `repair_seq`, `repair_blob_sha`), and verification receipt (`receipt_command`, `receipt_exit_code`, `receipt_blob_sha`).
4. Replace silent `catch {}` blocks in `src/archive/index.ts` with structured `warnings: string[]` returned on `PersistResult`.

### Unit TWM-R3: Truthful `WorkingSetValve` & JIT Read Skeleton Interception (`src/archive/valve.ts`, `src/plugin.ts`)
1. Update `src/archive/valve.ts` (`armValve`, `applyContextHookInMemory`, `WorkingSetValve`) to use `parseReadToolOutput` and `computeDiskSliceSha`:
   - Full unchanged reads render `FRESH — DO NOT REREAD`.
   - Partial or truncated unchanged reads render `SLICE L<start>-L<end> of <total> — FRESH SLICE (call substrate.viewport({ action: "skeleton", path }) or action: "slice" for remaining symbols)`.
   - Modified files render `STALE (modified since read/review — re-verify slice)`.
2. Update `executeValve` in `src/plugin.ts` to fetch live session messages via `await ctx.session.context({ sessionID })` and fall back to reading normalized messages from `sqliteSource(dbPath)` / `.session-archive/index.sqlite` when `ctx.session.context` is unavailable or returns empty, then sync disk slice hashes from `canonicalRoot` before running `valve.prune(...)`.
3. Register `await ctx.tool.hook("execute.after", ...)` in `src/plugin.ts`: when `event.status === "completed"` and `event.tool === "read"`, parse the read output via `parseReadToolOutput`. If `capture.isTruncated` (or the file is `>= 120` lines and read without a narrow slice) on a `.ts`/`.tsx` file, automatically index and append a compact **JIT Read Skeleton Footer** (`Tier-2 AstSkeleton` symbol spans `[Lstart-Lend]` + `Tier-4 CoChangeCoupling` hints) to `event.result.content` and record the read slice in the in-memory valve.

## Verification & Acceptance Gate
- `bun test test/normalize.test.ts test/valve.test.ts test/persist.test.ts` (including an end-to-end test feeding real OpenCode `Read file ...\n1: ...` formatted output -> `normalize` -> `writeIndex` -> `reconcileProvenanceStaleness` -> `WorkingSetValve` asserting `12/12` `FRESH` / `SLICE` matches and `STALE` after a 1-byte disk edit).
