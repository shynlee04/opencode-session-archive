# WF-SUB-R03: Codebase Structural Memory — AST Skeletonizer, PageRank RepoMap & Git Co-Change Benchmarks

- **Status:** verified benchmark evidence
- **Owner:** Codebase Graph & AST Specialist (`f96cc311-aaad-4112-a49e-03d3d630c38f`)
- **Primary Sources:**
  - Benchmark target `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/**/*.ts` (`51` files, `25,382` LOC, `924,492` chars, `~231,123` tokens)
  - [`OpenCode Context Substrate Dossier`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/docs/teach-me/OpenCode%20Context%20Substrate_%20Industry%20Landscape,%20Technical%20Trade-offs%20&%20Architecture%20Dossier%20copy.md)
  - [`the-box-of-context-viewports-on-sessions-and-codebase.md`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/docs/teach-me/the-box-of-context-viewports-on-sessions-and-codebase.md)
  - [`scripts/build.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scripts/build.ts)

## 1. Critical Runtime Discovery: `typescript@7.0.2` (`tsgo`) Has No JS AST API

Inspecting `node_modules/typescript` in this workspace revealed `typescript@7.0.2` (the native Go port `@typescript/native-preview` / `tsgo`). Its `lib/typescript.js` stub throws:
`Error: The JavaScript API for TypeScript 7.0 is not yet implemented.`

Therefore, a self-contained single-file Bun plugin (`bun build --target=bun`) cannot rely on `ts.createSourceFile` without bundling a legacy `9.4 MB` TypeScript 5.x compiler, and cannot rely on `web-tree-sitter` without shipping external `.wasm` binaries that break single-file `.opencode/plugins/` distribution.

## 2. Benchmarked Evaluation of the 5 Codebase Context Approaches

All benchmarks were executed on macOS arm64 (`Bun 1.3.12`) across all `51` source files (`25,382` LOC) in `hivemind-steward-oc-devin-dev/src/`:

| Approach | Bundle Size Impact | Parse / Compute Latency (`51` files) | Incremental `1`-File Update | Compression Ratio | Verdict for Single-File Bun Bundle |
|---|---|---|---|---|---|
| **1. `Bun.Transpiler.scan()` + Depth-2 Closure-Factory Skeletonizer** | **`+4.2 KB`** (0 deps) | **`22.22 ms` warm** (`39.29 ms` cold) | **`< 0.6 ms`** | **`90.47%`** (`231,123 -> 22,017` tokens) | **SELECT (Primary AST Engine)** |
| **2. Pure-TS Iterative PageRank (`Float64Array`, 20 iters, d=0.85)** | **`+3.1 KB`** (0 deps) | **`0.789 ms`** (graph build + 20 iters) | **`< 0.8 ms`** | Produces `<1,000` tok Tier-1 RepoMap | **SELECT (Primary Topological Ranker)** |
| **3. Git Temporal Co-Change Matrix (`git log -n 500 --name-only`)** | **`+2.4 KB`** (0 deps) | **`99.82 ms`** (`500` commits, `127` files) | **`~4 ms`** (`HEAD~1..HEAD`) | N/A (behavioral edge weights) | **SELECT (Behavioral Coupling Layer)** |
| **4. SCIP / LSIF Indexer** | External binary | `1,800 - 4,500 ms` cold CLI spawn | Requires full/daemon re-index | High precision | **DEFER** (breaks zero-config single-file bundle) |
| **5. LightRAG Dual-Level LLM Graph** | Requires LLM API | Seconds to minutes + API spend | High drift on edits | High semantic recall | **REJECT for codebase AST** (violates zero-spend gate; use deterministic SQLite + FTS5 for trajectory concepts instead) |

## 3. Solving the Factory-Closure Trap (`Depth-2` Skeleton Extraction)

A major codebase pattern in `hivemind-steward-oc-devin-dev` is the deep factory closure. For example, [`src/delegation/native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts) is `3,727` lines (`~36,214` tokens), and [`createNativeDelegationDriver`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts#L839-L3727) spans `2,888` lines (`77.5%` of the file).

- A naive **Depth-1** skeletonizer collapses `createNativeDelegationDriver` to a single line and hides 45 internal helper functions (`runTurn`, `reconcileChild`, `bindForeignSession`, permission mediators) with their line ranges.
- Our **Depth-2** brace/string/comment/template-literal state machine records top-level declarations (`Depth 1`) AND direct child function declarations, inner methods, and returned object keys (`Depth 2`) inside factory functions (`> 80` lines), stripping implementation bodies to `{ /* Lstart-Lend */ }`.

### Concrete Token Measurements Across Real Files (`4-Tier Progressive Disclosure`)

| File | Tier 4: Raw File | Tier 1: PageRank RepoMap Entry | Tier 2: Depth-2 AST Skeleton | Tier 3: Targeted Symbol Slice (`[Lstart-Lend]`) | Tier-2 Savings |
|---|---|---|---|---|---|
| [`src/acp.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/acp.ts) (`501` lines) | `4,284` tok | `28` tok (`PR=0.0566`) | `462` tok (`89.2%` reduction) | `~180` tok (single RPC method) | **`89.2%`** |
| [`src/acp-session-core.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/acp-session-core.ts) (`1,600` lines) | `15,172` tok | `64` tok (`PR=0.0680`) | `1,636` tok (`89.2%` reduction) | `~240` tok (single facet merger) | **`89.2%`** |
| [`src/delegation/native-delegation.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/src/delegation/native-delegation.ts) (`3,727` lines) | `36,214` tok | `52` tok (`PR=0.0110`) | `1,536` tok (`95.8%` reduction) | `~310` tok (single inner handler) | **`95.8%`** |
| **All `51` `src/**/*.ts` files** | **`231,123` tok** | **`890` tok** | **`22,017` tok** | **`150 - 400` tok / symbol** | **`90.47%`** |

## 4. Real PageRank Scores & Hidden Temporal Couplings Surfaced on This Repo

### Top PageRank Centrality Nodes (`src/**/*.ts`, `51` nodes, `149` static import edges)
1. `src/engine-port.ts` (`PR = 0.0888`, `in = 22`, `out = 1`)
2. `src/hosted/lane.ts` (`PR = 0.0725`, `in = 14`, `out = 2`)
3. `src/acp-session-core.ts` (`PR = 0.0680`, `in = 14`, `out = 3`)
4. `src/acp.ts` (`PR = 0.0566`, `in = 9`, `out = 2`)
5. `src/cross-os-platform.ts` (`PR = 0.0504`, `in = 9`, `out = 0`)
6. `src/wire-dialect.ts` (`PR = 0.0493`, `in = 9`, `out = 1`)

### Top Hidden Temporal Co-Change Couplings (`0` Static AST Import Edges!)
Mining `git log -n 500` (`99.82 ms`) and filtering for file pairs with **zero static import edges** (`hasStaticEdge == false`) immediately surfaced implicit cross-harness and cross-boundary invariants:
1. `src/devin-executable.ts <-> src/harness-antigravity.ts`: **`P(A|B) = 66.7%`** (`12/18` commits together, Jaccard `0.50`, `0` static import edges). Parallel binary discovery/pinning contracts that must stay synchronized across harnesses.
2. `src/delegation/model-slots.ts <-> src/hosted/commands.ts`: **`P(A|B) = 66.7%`** (`6/9` commits together, `0` static import edges). Model slot schema changes require matching TUI slash-command updates.
3. `src/delegation/delegate-config.ts <-> src/hosted/harness.ts`: **`P(A|B) = 54.5%`** (`6/11` commits together, `0` static import edges).
