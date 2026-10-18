# Phase E1.2 specification: Codebase structural graph (`codebase-structural-graph`)

- **Phase:** `E1.2` (`codebase-structural-graph`, ticket prefix `CSG`)
- **Epic:** `E1` Unified Context & Working-Memory Substrate
- **Status:** `draft (ready for spec-review)`
- **Depends on:** Phase `E1.1` (`trajectory-working-memory`, [`SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/trajectory-working-memory/SPEC.md))
- **Requirements:** `REQ-SUB-09`, `REQ-SUB-10`, `REQ-SUB-11`, `REQ-SUB-12`
- **Authoritative inputs:** [`GLOSSARY.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/GLOSSARY.md), [`PROJECT.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/PROJECT.md), [`ROADMAP.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/ROADMAP.md), [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md), [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md), [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md), [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md)

## Problem

Strategist (Orchestrator) and Implementor (Specialist) agents operating in OpenCode V2 lack a compact, deterministic structural map of the repository inside `.session-archive/index.sqlite`. When agents inspect unfamiliar or oversized modules, they read entire source files into Active Context or run repeated `grep` and `read` loops across thousands of lines.

Forensic analysis in [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md) and [`WF-SUB-R03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md) identified four concrete structural bottlenecks across real OpenCode V2 sessions (`ses_eb2eabb14ffeCXsCwb845rtffb` and `ses_eb23bfbf0ffesn5kT0yJI06h35`):

1. **Oversized closure factories defeat Depth-1 AST outlines.** In `hivemind-steward-oc-devin-dev/src/` (`51` `.ts` and `.tsx` files, `28,831` LOC, `323,113` raw tokens), major subsystems encapsulate internal functions inside top-level factory closures. For example, [`src/delegation/native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts) (`3,890` LOC, `49,638` raw tokens) places `77.5%` of its implementation (`2,888` lines, `[L1002-L3889]`) inside `createNativeDelegationDriver`. A Depth-1 skeletonizer collapses that entire `2,888`-line factory into one signature line and hides all `61` internal helper functions and returned driver methods (`turnStream`, `admitStream`, `admitInitSettings`, `reconcileAmbiguous`, `doGenerate`).
2. **Compiler API incompatibility and single-file bundle constraints.** `hivemind-substrate` compiles via `bun build --target=bun` into a single self-contained file (`dist/session-archive.ts`) with `external: ["bun:*", "node:*"]`. Under `typescript@7.0.2` (`tsgo`), calling the TypeScript JavaScript API throws `Error: The JavaScript API for TypeScript 7.0 is not yet implemented`. Native C++ tree-sitter bindings and external `.wasm` sidecars violate the zero-dependency single-file plugin gate.
3. **No architectural centrality ranking for ambient orientation.** Without a graph centrality ranking over static module imports, agents after compaction or at session start have no `< 1,000`-token Tier-1 `RepoMap` identifying which modules (`src/acp.ts`, `src/cross-os-platform.ts`, `src/wire-dialect.ts`, `src/devin-executable.ts`, `src/acp-session-core.ts`) anchor the architecture and which exported symbols carry the highest caller weight.
4. **Hidden temporal co-change couplings cause cross-boundary regressions.** Behavioral contracts frequently span files that share zero static import edges (`has_static_edge = 0`). In `hivemind-steward-oc-devin-dev`, modifying `src/devin-executable.ts` co-changes with `src/harness-antigravity.ts` in `66.7%` of commits (`4/6` non-bulk `src/` commits) with zero static import edges between them, and `src/delegation/setup-steps.ts` co-changes with `src/hosted-request-contract.ts` in `66.7%` of commits (`4/6` commits, `has_static_edge = 0`). Static import graphs alone miss these couplings.

## Solution

Extend **The Honeycomb** (`.session-archive/index.sqlite`) with a zero-dependency, Bun-native Codebase Structural Graph (`src/honeycomb/code-graph.ts`, `src/honeycomb/pagerank.ts`, `src/honeycomb/cochange.ts`) that powers 4-tier progressive disclosure for both Strategist and Implementor viewports:

1. **Tier-1 `RepoMap` (`< 1,000` tokens).** Compute 20-iteration damped PageRank (`d = 0.85`) over `code_file` and non-self `code_import_edge` rows using a zero-allocation `Float64Array` Compressed Sparse Row (CSR) solver (`0.216 ms` median solve). Render the top-ranked modules and their caller-weighted exported symbols with `[Lstart-Lend]` spans into `< 1,000` tokens (`910` tokens in `1.306 ms` measured).
2. **Tier-2 `AstSkeleton` (`>= 88%` token reduction).** Combine native `Bun.Transpiler.scan()` import/export extraction with a single-pass lexical brace/parenthesis/string/template/JSX state machine (`scanLexicalLines` precomputing `lineMinBrace[L]`). Extract all Depth-1 declarations and descend to Depth-2 inside factory functions or closures spanning `>= 200` lines, replacing implementation bodies with `{ /* Lstart-Lend */ }` (`89.09%` token compression across `51` files in `24.70 ms` warm parse).
3. **Tier-3 `SymbolSlice` (`[Lstart-Lend]` exact hydration).** Persist `code_file`, `code_symbol`, and `code_import_edge` in `.session-archive/index.sqlite` keyed by `(path, blob_sha)`. Skip unchanged files in `< 0.5 ms/file` (`0.045 ms/file` measured), incrementally re-index modified files in `< 5 ms` (`3.48 ms` measured), and hydrate exact `[Lstart-Lend]` source slices by Depth-1 `name` or Depth-2 `qualified_name` (`createNativeDelegationDriver.turnStream` -> `178` lines, `96.01%` token savings vs full file).
4. **Tier-4 `CoChangeCoupling` (`git log` temporal matrix).** Mine `git log -n 500` (`max_files_per_commit <= 15`) into `git_cochange`, `git_cochange_file_stats`, and `git_cochange_commit` (`103.89 ms` full index, `8.29 ms` incremental `HEAD~1..HEAD` hash-skip). Compute asymmetric conditional probabilities $P(A \mid B)$ and $P(B \mid A)$, Jaccard similarity, and `has_static_edge` (`0` vs `1`) to surface hidden cross-boundary couplings alongside recent shared commit subjects.

## User stories

1. **As an Implementor agent inspecting a multi-thousand-line factory module**, I can request the Tier-2 `AstSkeleton` for `src/delegation/native-delegation.ts` so that I receive all `48` Depth-1 declarations and all `61` Depth-2 internal closure helpers (`createNativeDelegationDriver.turnStream [L2838-L3015]`, `createNativeDelegationDriver.admitStream [L3069-L3588]`) in `3,244` tokens instead of reading `49,638` raw tokens (`93.46%` reduction).
2. **As an Implementor agent preparing a surgical edit inside a closure factory**, I can request a Tier-3 `SymbolSlice` by `qualified_name` (`readSymbolSlice(rootDir, db, "src/delegation/native-delegation.ts", "createNativeDelegationDriver.turnStream")`) or explicit `[startLine, endLine]` bounds so that only lines `2838..3015` (`1,978` tokens) enter my Box of Context.
3. **As a Strategist agent orienting after compaction or delegating a slice**, I can request the Tier-1 `RepoMap` so that I see the highest-PageRank architectural hubs (`src/acp.ts`, `src/cross-os-platform.ts`, `src/wire-dialect.ts`, `src/devin-executable.ts`, `src/acp-session-core.ts`) and their caller-weighted exported symbol spans within `< 1,000` tokens (`910` tokens measured) in `< 5 ms`.
4. **As an Implementor or Reviewer agent modifying a boundary file**, I can query Tier-4 `CoChangeCoupling` for `src/devin-executable.ts` (`minProbability = 0.30`) so that I am warned that `src/harness-antigravity.ts` co-changes in `66.7%` of commits with `has_static_edge = 0` (`HIDDEN`), complete with the recent commit subjects explaining the shared invariant.
5. **As the substrate incremental sync driver running on `idle` or `compaction`**, I can re-index the repository's `.ts` and `.tsx` files by comparing each file's SHA-256 `blob_sha` against `code_file.blob_sha` and checking `git_cochange_commit` for `HEAD~1..HEAD` so that warm no-op syncs finish in `< 12 ms` combined and single-file edits update both the AST skeleton and PageRank scores in `< 5 ms`.
6. **As the single-file plugin bundler (`bun run build`)**, I can bundle `src/plugin.ts` into `dist/session-archive.ts` using only `Bun.Transpiler`, `Bun.CryptoHasher`, `bun:sqlite`, `node:fs`, `node:path`, and `node:child_process` (`Bun.spawnSync`) with zero external npm packages, native addons, or `.wasm` files.

## Requirements

### `REQ-SUB-09` · Zero-Dependency `Bun.Transpiler` + Depth-2 Closure-Factory AST Skeletonizer

- **Behavior and invariants:**
  1. The skeletonizer (`skeletonizeSource(filePath, content, options)` and `skeletonizeFile(rootDir, relPath, options)`) MUST parse `.ts` and `.tsx` source files using `new Bun.Transpiler({ loader: "ts" | "tsx" }).scan(content)` for top-level import/export discovery combined with a deterministic single-pass lexical scanner (`scanLexicalLines(content)`).
  2. `scanLexicalLines(content)` MUST track brace depth (`{}`), parenthesis depth (`()`), line comments (`//`), block comments (`/* */`), single/double-quoted strings, template literals with nested `${...}` expressions, regex literals, and JSX tags (`<Tag>`, `</Tag>`) without corrupting brace depth on apostrophes in JSX text (`don't`), generic arrow types (`new Set<(...) => void>()`), or inline object return types (`: { readonly id: string } => {`).
  3. `scanLexicalLines(content)` MUST precompute `lineStartBrace[L]`, `lineEndBrace[L]`, `lineMinBrace[L]`, and `lineStartParen[L]` in a single $O(N)$ character pass so multi-line declaration closing-brace resolution never rescans closure bodies quadratically.
  4. At Depth-1 (`braceDepth === 0` at declaration start), the skeletonizer MUST extract `function`, `class`, `interface`, `type`, `const`, and `enum` declarations with their exact 1-indexed `[start_line, end_line]` span, normalized single-line signature, `exported` boolean flag (`true` if marked `export` or matched in `Bun.Transpiler.scan().exports`), and `parent_symbol = null`.
  5. For Depth-1 `class` declarations, the skeletonizer MUST descend into the class body (`braceDepth === 1`) and extract Depth-2 `method` and `property` declarations with `parent_symbol = <ClassName>` and `qualified_name = "<ClassName>.<memberName>"`.
  6. For Depth-1 `function` or `const` arrow/function declarations whose span is `>= factoryLineThreshold` (default `200` lines, such as `createNativeDelegationDriver` at `2,888` lines), the skeletonizer MUST descend into the factory body (`braceDepth === 1`) and extract:
     - Inner helper `function` and arrow/function `const` declarations (`depth = 2`, `parent_symbol = <FactoryName>`, `qualified_name = "<FactoryName>.<helperName>"`).
     - Object-literal methods and properties inside top-level `return { ... }` statements of the factory (`braceDepth === 2` inside the returned object literal, recorded with `depth = 2`, `parent_symbol = <FactoryName>`, `qualified_name = "<FactoryName>.<methodName>"`).
  7. Rendered `skeleton_text` MUST retain compact import headers, Depth-1 signatures with bodies replaced by `{ /* Lstart-Lend */ }`, and indented Depth-2 signatures inside classes and qualifying closure factories.
- **Performance and compression gates (verified in [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md)):**
  - Codebase token reduction across `hivemind-steward-oc-devin-dev/src/` (`51` files, `28,831` LOC) MUST be `>= 88%` (`89.09%` measured, `323,113` -> `35,257` tokens; `93.46%` on `src/delegation/native-delegation.ts` with `48` Depth-1 and `61` Depth-2 symbols extracted).
  - Warm in-memory parse across all `51` files MUST complete in `< 30 ms` (`24.70 ms` 7-sample median measured; cold parse `132.93 ms` `< 200 ms` gate).
  - Zero (`0`) brace or parenthesis depth mismatches across all `.ts` and `.tsx` files in both `hivemind-steward-oc-devin-dev/src/` and `hivemind-substrate/src/`.
- **Ownership and interfaces:** Owned by `src/honeycomb/code-graph.ts`. Pure transformation over file path and UTF-8 source string; zero database or network side effects inside `skeletonizeSource`.
- **Approved decisions and dependencies:** Implements [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) Engine 1 and [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) Q3.

### `REQ-SUB-10` · Content-Addressed CodeGraph SQLite Cache & Tier-3 `SymbolSlice` Hydration

- **Behavior and invariants:**
  1. `.session-archive/index.sqlite` MUST define and maintain the following CodeGraph tables:
     ```sql
     CREATE TABLE IF NOT EXISTS code_file (
       path TEXT PRIMARY KEY,
       blob_sha TEXT NOT NULL,
       loc INTEGER NOT NULL,
       raw_tokens INTEGER NOT NULL,
       skeleton_tokens INTEGER NOT NULL,
       skeleton_text TEXT NOT NULL,
       pagerank REAL NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     );

     CREATE TABLE IF NOT EXISTS code_symbol (
       path TEXT NOT NULL,
       name TEXT NOT NULL,
       qualified_name TEXT NOT NULL,
       kind TEXT NOT NULL,
       depth INTEGER NOT NULL,
       parent_symbol TEXT,
       exported INTEGER NOT NULL,
       start_line INTEGER NOT NULL,
       end_line INTEGER NOT NULL,
       signature TEXT NOT NULL,
       blob_sha TEXT NOT NULL,
       PRIMARY KEY (path, start_line, qualified_name)
     );

     CREATE INDEX IF NOT EXISTS idx_code_symbol_path_name ON code_symbol(path, name);
     CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name);
     CREATE INDEX IF NOT EXISTS idx_code_symbol_parent ON code_symbol(path, parent_symbol);

     CREATE TABLE IF NOT EXISTS code_import_edge (
       from_path TEXT NOT NULL,
       to_path TEXT NOT NULL,
       specifier TEXT NOT NULL,
       symbols_json TEXT NOT NULL,
       is_type_only INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (from_path, to_path)
     );

     CREATE INDEX IF NOT EXISTS idx_code_import_edge_to ON code_import_edge(to_path);
     ```
  2. For Depth-1 symbols (`parent_symbol IS NULL`), `qualified_name` MUST equal `name`. For Depth-2 symbols (`parent_symbol IS NOT NULL`), `qualified_name` MUST equal `"${parent_symbol}.${name}"`.
  3. During `indexCodebase(rootDir, db, options)`, each discovered `.ts`/`.tsx` file's UTF-8 content MUST be hashed via `new Bun.CryptoHasher("sha256").update(content).digest("hex")`. When `code_file.blob_sha` matches the current file SHA-256 and `options.force` is not set, `indexCodebase` MUST skip re-parsing and SQLite row replacement for that file.
  4. When a file is added or its `blob_sha` changes, `indexCodebase` MUST atomically replace its `code_file`, `code_symbol`, and outgoing `code_import_edge` rows inside a single SQLite transaction, and delete rows for files removed from disk.
  5. Relative module specifiers (`./foo`, `../bar/baz.ts`, `./dir/index.tsx`) MUST be resolved against the known repository file set into normalized repo-relative POSIX paths (`to_path`). External package imports (`@opencode/plugin`, `bun:sqlite`, `node:fs`) remain in the file's `skeleton_text` import header and are excluded from internal `code_import_edge` rows.
  6. `queryAstSkeleton(db, relPath)` MUST return the cached `AstSkeletonView` (`skeleton_text`, `symbols`, outgoing `imports`, and incoming `imported_by` edges) directly from SQLite.
  7. `readSymbolSlice(rootDir, db, relPath, symbolOrQualifiedNameOrRange)` MUST resolve either:
     - A `qualified_name` (`"createNativeDelegationDriver.turnStream"`),
     - An unambiguous Depth-1 or Depth-2 `name` (`"turnStream"`), or
     - An explicit `{ startLine, endLine }` range,
     and return the exact 1-indexed lines `[start_line..end_line]` from the workspace file with a header citing `path`, `qualified_name`, `kind`, `depth`, `[Lstart-Lend]`, and token count.
- **Performance gates (verified in [`WF-SUB-05`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-05-bun-transpiler-depth2-ast-skeletonizer.md)):**
  - Full cold SQLite index (`51` files + WAL commit) MUST complete in `< 200 ms` (`35.59 ms` 7-sample median measured).
  - Warm index skip over `51` unchanged files MUST complete in `< 0.5 ms/file` (`2.30 ms` total / `0.045 ms/file` 7-sample median measured).
  - Incremental 1-file re-index (`1` modified file + `50` warm files) MUST complete in `< 5 ms` (`3.48 ms` 7-sample median measured).
- **Ownership and interfaces:** Owned by `src/honeycomb/code-graph.ts` and registered in `.session-archive/index.sqlite` schema migrations (`src/archive/index-db.ts`).
- **Approved decisions and dependencies:** Depends on `REQ-SUB-09`. Implements [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md).

### `REQ-SUB-11` · Iterative `Float64Array` CSR PageRank & `< 1,000`-Token Tier-1 `RepoMap`

- **Behavior and invariants:**
  1. `computePageRank(db, options)` MUST load all `N` rows from `code_file` (sorted deterministically by `path`) and all non-self edges (`from_path != to_path`) from `code_import_edge` where both endpoints exist in `code_file`.
  2. The solver MUST construct a Compressed Sparse Row (CSR) adjacency representation using typed arrays (`Int32Array` for `outDegree` and flat edge index arrays, `Float64Array` for `ranks` and `nextRanks`) with zero heap object allocations inside the iteration loop.
  3. Over `iterations = 20` with damping factor `d = 0.85`:
     - Initialize `ranks[i] = 1 / N`.
     - Accumulate dangling sink mass `sinkMass = SUM(ranks[u] for u where outDegree[u] == 0)`.
     - Set base rank for every node `v`: `baseRank = (1 - d) / N + (d * sinkMass) / N`.
     - For each directed import edge `u -> v` (`u` imports `v`), add `(d * ranks[u]) / outDegree[u]` to `nextRanks[v]`.
     - Normalize `nextRanks` at each step so `SUM(pagerank) == 1.0` within floating-point tolerance (`|SUM(pagerank) - 1.0| < 1e-6`).
  4. When `options.persist !== false`, `computePageRank` MUST batch-update `code_file.pagerank` inside a single SQLite transaction.
  5. `renderTier1RepoMap(db, options)` MUST order `code_file` rows by `pagerank DESC, path ASC` and select exported `code_symbol` rows (`depth = 1 AND exported = 1`) weighted by how many distinct importer files reference each symbol in `code_import_edge.symbols_json` (`callerWeight * 10 + kindPriority`), breaking ties by `start_line ASC`.
  6. `renderTier1RepoMap` MUST pack ranked file lines (`<rank>. <path> (PR=<score>, in=<in>, out=<out>, <loc>L): <Symbol>[Lstart-Lend], ... (+K more)`) until adding the next file would exceed `tokenBudget` (default `1,000` tokens, estimated as `Math.ceil(chars / 4)`).
- **Performance and budget gates (verified in [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md)):**
  - PageRank 20-iteration solve over `51` nodes and `185` non-self edges MUST complete in `< 2 ms` (`0.216 ms` 7-sample median measured; `0.487 ms` including SQLite transaction update; `maxResidual = 7.17e-9`).
  - `renderTier1RepoMap` output MUST strictly respect `estimated_tokens < 1,000` (`910` tokens across top `17` modules measured) and render in `< 5 ms` (`1.306 ms` 7-sample median measured).
  - Top architectural modules (`src/acp.ts`, `src/cross-os-platform.ts`, `src/wire-dialect.ts`, `src/devin-executable.ts`, `src/acp-session-core.ts`) MUST rank in the top 10 on `hivemind-steward-oc-devin-dev`.
- **Ownership and interfaces:** Owned by `src/honeycomb/pagerank.ts`.
- **Approved decisions and dependencies:** Depends on `REQ-SUB-10`. Implements [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) Engine 2.

### `REQ-SUB-12` · Git Temporal Co-Change Matrix & Hidden Cross-Boundary Coupling Alerts

- **Behavior and invariants:**
  1. `.session-archive/index.sqlite` MUST define and maintain the temporal co-change schema:
     ```sql
     CREATE TABLE IF NOT EXISTS git_cochange (
       file_a TEXT NOT NULL,
       file_b TEXT NOT NULL,
       co_commits INTEGER NOT NULL,
       commits_a INTEGER NOT NULL,
       commits_b INTEGER NOT NULL,
       prob_a_given_b REAL NOT NULL,
       prob_b_given_a REAL NOT NULL,
       jaccard REAL NOT NULL,
       has_static_edge INTEGER NOT NULL,
       recent_subjects_json TEXT NOT NULL,
       PRIMARY KEY (file_a, file_b)
     );

     CREATE INDEX IF NOT EXISTS idx_git_cochange_file_a ON git_cochange(file_a);
     CREATE INDEX IF NOT EXISTS idx_git_cochange_file_b ON git_cochange(file_b);
     CREATE INDEX IF NOT EXISTS idx_git_cochange_hidden ON git_cochange(has_static_edge, co_commits DESC);

     CREATE TABLE IF NOT EXISTS git_cochange_file_stats (
       path TEXT PRIMARY KEY,
       commit_count INTEGER NOT NULL
     );

     CREATE TABLE IF NOT EXISTS git_cochange_commit (
       hash TEXT PRIMARY KEY,
       subject TEXT NOT NULL,
       files_json TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );
     ```
  2. `mineGitCoChange(db, options)` MUST inspect up to `maxCommits` (default `500`) non-merge commits via `git log -n 500 --no-merges --name-only --pretty=format:__COMMIT__%H%x09%s` (or accept an injected `commitsOverride` array for deterministic unit tests).
  3. Commits touching `> maxFilesPerCommit` (default `15`) tracked files under `pathPrefix` (default `"src/"`) or `< 2` files MUST be excluded from pair co-change counts so bulk formatting sweeps and directory-wide renames do not pollute coupling probabilities.
  4. For every unordered canonical file pair `(file_a, file_b)` with `file_a < file_b` and `co_commits >= minCoCommits` (default `2`), `mineGitCoChange` MUST compute:
     - `prob_a_given_b = co_commits / commits_b` ($P(A \mid B)$),
     - `prob_b_given_a = co_commits / commits_a` ($P(B \mid A)$),
     - `jaccard = co_commits / (commits_a + commits_b - co_commits)`,
     - `has_static_edge = 1` if `(file_a, file_b)` or `(file_b, file_a)` exists in `code_import_edge`, else `0`,
     - `recent_subjects_json` storing up to `maxRecentSubjects` (default `5`) most recent shared commit subjects.
  5. `updateGitCoChangeIncremental(db, repoRoot, revRange, options)` (default `revRange = "HEAD~1..HEAD"`) MUST check `git_cochange_commit(hash)` first and skip commits already applied unless `forceReapply = true`, guaranteeing idempotency across repeated `idle` or `compaction` syncs.
  6. `queryCoupledFiles(db, targetPath, options)` MUST query both `file_a = targetPath` (where $P(\text{coupled} \mid \text{target}) = \text{prob\_b\_given\_a}$) and `file_b = targetPath` (where $P(\text{coupled} \mid \text{target}) = \text{prob\_a\_given\_b}$), filter by `minCoCommits` (default `2`), `minProbability` (default `0.30`), and optional `onlyHidden` (`has_static_edge === 0`), sort by `prob_coupled_given_target DESC, co_commits DESC, coupled_path ASC`, and format a human/agent-readable `warning_banner` flagging `[HIDDEN COUPLING: 0 static imports]` vs `[static+temporal]`.
- **Performance and accuracy gates (verified in [`WF-SUB-06`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-06-pagerank-repomap-and-git-cochange-couplings.md)):**
  - Full `mineGitCoChange` (`git log -n 500` + SQLite persist) MUST complete in `< 150 ms` (`103.89 ms` 7-sample median measured; `2.68 ms` matrix compute + SQLite persist).
  - Incremental `HEAD~1..HEAD` update MUST complete in `< 15 ms` including subprocess spawn (`8.53 ms` forced reapply, `8.29 ms` idempotent hash-skip, `0.244 ms` SQLite matrix update measured).
  - On `hivemind-steward-oc-devin-dev`, querying `src/devin-executable.ts` MUST surface `src/harness-antigravity.ts` at $P = 66.7\%$ (`4/6` commits, `has_static_edge = 0`) and `src/acp.ts` at $P = 50.0\%$ (`3/6` commits, `has_static_edge = 1`), and querying `src/delegation/setup-steps.ts` or `src/hosted-request-contract.ts` MUST surface their $P = 66.7\%$ (`4/6` commits, `has_static_edge = 0`) hidden coupling.
- **Ownership and interfaces:** Owned by `src/honeycomb/cochange.ts`.
- **Approved decisions and dependencies:** Depends on `REQ-SUB-10` (for `code_import_edge` join determining `has_static_edge`). Implements [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) Engine 3.

### Requirement summary matrix

| Requirement | Primary Module Seam | SQLite Tables Owned | Measured Prototype Baseline | Target Gate |
|---|---|---|---|---|
| `REQ-SUB-09` | `src/honeycomb/code-graph.ts` | none (pure parser/skeletonizer) | `89.09%` reduction (`51` files), `24.70 ms` warm parse, `61` D2 symbols in `createNativeDelegationDriver` | `>= 88%` reduction, `< 30 ms` warm parse, `0` external deps |
| `REQ-SUB-10` | `src/honeycomb/code-graph.ts` | `code_file`, `code_symbol`, `code_import_edge` | `0.045 ms/file` warm skip (`2.30 ms` total), `3.48 ms` 1-file re-index, `96.01%` slice token savings | `< 0.5 ms/file` warm skip, `< 5 ms` 1-file re-index |
| `REQ-SUB-11` | `src/honeycomb/pagerank.ts` | `code_file.pagerank` | `0.216 ms` solve (`0.487 ms` w/ SQLite), `910` tokens in `1.306 ms` | `< 2 ms` solve, `< 1,000` tokens in `< 5 ms` |
| `REQ-SUB-12` | `src/honeycomb/cochange.ts` | `git_cochange`, `git_cochange_file_stats`, `git_cochange_commit` | `103.89 ms` full (`500` commits), `8.29 ms` incremental (`0.244 ms` SQLite) | `< 150 ms` full, `< 15 ms` incremental `HEAD~1..HEAD` |

## Testing decisions

1. **External behavioral seams (`principle-test-behavior-not-implementation`):**
   - Test through the public Honeycomb module interfaces (`indexCodebase`, `skeletonizeSource`, `queryAstSkeleton`, `readSymbolSlice`, `computePageRank`, `renderTier1RepoMap`, `mineGitCoChange`, `updateGitCoChangeIncremental`, `queryCoupledFiles`) backed by real temporary `bun:sqlite` databases and real `.ts`/`.tsx` fixtures.
   - Do not mock `Bun.Transpiler`, `Bun.CryptoHasher`, or `bun:sqlite`.
2. **Prior art and prototype test suites to promote into `test/`:**
   - [`scratch/prototypes/wf-sub-05-ast-skeletonizer.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-05-ast-skeletonizer.test.ts) (`4` tests, `106` assertions) -> promote to `test/code-graph.test.ts`.
   - [`scratch/prototypes/wf-sub-06-repomap-cochange.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-06-repomap-cochange.test.ts) (`4` tests, `84` assertions) -> promote to `test/pagerank-cochange.test.ts`.
3. **Falsifiable assertions per requirement:**
   - **`REQ-SUB-09`:** Assert zero brace/paren depth mismatches on JSX closing tags (`</For>`), apostrophes in JSX text (`don't`), inline object return types, and generic constructors; assert `>= 88%` token compression across multi-file fixtures; assert extraction of Depth-2 closure helpers and returned object methods (`doGenerate`, `turnStream`, `admitStream`) inside `>= 200`-line factory functions with exact `[Lstart-Lend]` spans.
   - **`REQ-SUB-10`:** Assert that running `indexCodebase` twice with unchanged files yields `parsedFiles === 0` and `skippedWarmFiles === N` on the second run; assert that mutating one file re-parses only `parsedFiles === 1` and updates `code_file.blob_sha` and `code_symbol` rows; assert that `readSymbolSlice` hydrates exact `[start_line, end_line]` slices by Depth-2 `qualified_name` (`"createNativeDelegationDriver.turnStream"`).
   - **`REQ-SUB-11`:** Assert `Math.abs(result.totalMass - 1.0) < 1e-6` even in graphs with dangling sink nodes (`out_degree = 0`) and cyclic imports; assert hub modules rank above leaf importers; assert `renderTier1RepoMap` output satisfies `estimated_tokens < 1000` and includes `[Lstart-Lend]` spans on exported symbols.
   - **`REQ-SUB-12`:** Assert bulk commits (`> 15` files) are skipped (`commitsSkippedBulk > 0`); assert asymmetric probabilities $P(A \mid B) \ne P(B \mid A)$ when $\text{Commits}(A) \ne \text{Commits}(B)$; assert `has_static_edge = 0` when no `code_import_edge` links `file_a` and `file_b`; assert calling `updateGitCoChangeIncremental` twice on the same commit range applies `commitsApplied = 0` on the second call.
4. **Build and runtime verification gates:**
   - `bun test` and `bun run typecheck` (`tsc --noEmit`).
   - `bun run build` verifying that `dist/session-archive.ts` bundles cleanly with zero external npm/WASM/C++ dependencies.

## Out of scope

- **Non-TypeScript/JavaScript language grammars in Phase E1.2:** Python, Rust, Go, and C++ AST skeletonization are out of scope for this OpenCode TypeScript plugin substrate.
- **Dense vector embeddings or LLM summarization during code indexing:** Deferred per [`ROADMAP.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/ROADMAP.md) (`semantic-vector-lightrag`). All CodeGraph, PageRank, and Co-Change indexing is 100% deterministic and local-first.
- **Mutating target source files or Git history:** All workspace source reads and `git log` queries are strictly read-only.
- **Executing `git log` inside `ctx.session.hook("context", ...)`:** The synchronous `context` hook remains strictly in-memory (`< 2 ms`); CodeGraph and `git log` incremental indexing run only on explicit tool calls, `compaction` hooks, or background `session.status` (`idle`) events.

## Further notes

- **Prototype disposition:** [`scratch/prototypes/wf-sub-05-ast-skeletonizer.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-05-ast-skeletonizer.ts) and [`scratch/prototypes/wf-sub-06-repomap-cochange.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-06-repomap-cochange.ts) have proved all algorithms, SQLite schemas, and latency bounds against `hivemind-steward-oc-devin-dev` (`51` files, `28,831` LOC, `492` commits) and `hivemind-substrate` (`7` files, `1,615` LOC). Production implementation in Phase E1.2 will extract these into clean deep modules under `src/honeycomb/` and wire their DDL into `.session-archive/index.sqlite`.
- **Approval and ADR linkage:** Owner approved Q1..Q3 in [`WF-SUB-08`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/tickets/WF-SUB-08-substrate-surface-and-cross-harness-switching-grill.md) (`2026-10-18`). Following independent `spec-review` of this specification, [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) transitions from `proposed` to `accepted`.
