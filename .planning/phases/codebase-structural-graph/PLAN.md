# Remediation Plan: Phase E1.2 Codebase Structural Graph (`codebase-structural-graph`)

**Date:** 2026-10-18
**Status:** approved (`decisions.tsv` #6 / `/grill-with-docs` `A1..A4`)
**Owning Phase:** `E1.2 codebase-structural-graph` (`REQ-SUB-09` .. `REQ-SUB-12`)
**Audit Inputs:** `.audit/2026-10-18-uat-runtime-observation/{EVIDENCE.md,REPORT-product-design-gaps.md,REPORT-technical-smells.md}`

## Scope & Root-Cause Mapping

| Defect / Gap / Smell | Classification | Root Cause | Owning Module(s) |
|---|---|---|---|
| `T-3` (Hardcoded `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev` in `src/honeycomb/cochange.ts:110`) | Bug / Smell | Prototype constant `DEFAULT_REPO_ROOT` survived into production `src/honeycomb/cochange.ts`. | `src/honeycomb/cochange.ts` |
| `T-5` / `T-6` / `T-7` (Duplicated DDL, `estimateTokens`, and `normalizeRepoPath` across `ast-skeleton.ts`, `pagerank.ts`, `cochange.ts`) | Refactor | Each prototype file carried its own copy of `estimateTokens`, `normalizeRepoPath`, and table DDL. | `src/honeycomb/ast-skeleton.ts`, `src/honeycomb/pagerank.ts`, `src/honeycomb/cochange.ts`, `src/archive/primitives.ts`, `src/archive/index-db.ts` |

## Remediation Units

### Unit CSG-R1: Purge Hardcoded Paths & Unify Primitives across `src/honeycomb/*`
1. Remove the hardcoded `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev` fallback in `src/honeycomb/cochange.ts`; require an explicit `repoRoot` (or `process.cwd()` fallback when omitted in CLI/test contexts) and validate via `normalizeRepoPath(filePath, repoRoot)` from `src/archive/primitives.ts`.
2. Replace duplicate `estimateTokens` and `normalizeRepoPath` definitions in `src/honeycomb/ast-skeleton.ts`, `src/honeycomb/pagerank.ts`, and `src/honeycomb/cochange.ts` with imports from `src/archive/primitives.ts`.
3. Delegate schema initialization in `ensureCodeGraphSchema` and `ensureCochangeSchema` to the canonical table definitions in `src/archive/index-db.ts` so there is a single source of truth for `code_file`, `code_symbol`, `code_import_edge`, `git_cochange`, `git_cochange_file_stats`, and `git_cochange_commit`.
4. Expose a fast single-file helper `indexSingleFileSkeleton(db: Database, rootDir: string, filePath: string)` in `src/honeycomb/ast-skeleton.ts` so `ctx.tool.hook("execute.after")` can attach a JIT Tier-2 `AstSkeleton` + Tier-4 `CoChangeCoupling` footer to truncated `read` tool results in `< 5 ms`.

## Verification & Acceptance Gate
- `rg "/Users/MAC|hivemind-steward-oc-devin-dev" src/` returns `0` matches.
- `bun test test/ast-skeleton.test.ts test/pagerank-cochange.test.ts` passes 100%.
