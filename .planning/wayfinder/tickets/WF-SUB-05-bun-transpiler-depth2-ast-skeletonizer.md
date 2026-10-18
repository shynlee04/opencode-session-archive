# WF-SUB-05: Zero-Dependency `Bun.Transpiler` + Depth-2 Closure-Factory AST Skeletonizer

- **ID:** `WF-SUB-05`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** none
- **Evidence Input:** [`WF-SUB-R03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md)

## Question

Does the `+4.2 KB` zero-dependency `Bun.Transpiler.scan()` + Depth-2 closure-factory state machine accurately extract all exported symbols, signatures, `[Lstart-Lend]` spans, and internal helper functions of oversized factory closures (such as `createNativeDelegationDriver` in [`src/delegation/native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts#L839-L3727)) with `>= 88%` token reduction and `< 30 ms` warm parse time?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-05-ast-skeletonizer.ts`)

1. Build and test the standalone Depth-2 skeletonizer module against all `51` TypeScript/TSX files in `hivemind-steward-oc-devin-dev/src/` and `hivemind-substrate/src/`.
2. Persist extracted symbols and import edges into `code_file`, `code_symbol`, and `code_import_edge` tables in SQLite, keyed by `(path, blob_sha)` so unchanged files are skipped in `< 0.5 ms`.
3. Verify Tier-2 (`AstSkeleton`) and Tier-3 (`SymbolSlice` `[Lstart-Lend]`) outputs on `src/acp.ts`, `src/acp-session-core.ts`, and `src/delegation/native-delegation.ts`.
