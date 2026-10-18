# **OpenCode Context Substrate: Industry Landscape, Technical Trade-offs & Architecture Dossier**

# **1\. Executive Summary & The Problem Landscape**

## **Executive Summary**

As autonomous coding agents transition from simple single-file code completion engines to multi-file, repository-scale software engineering systems, context engineering has emerged as the primary bottleneck determining agent execution fidelity. Large Language Models (LLMs) operate under strict finite context windows, quadratic attention costs (\$O(N^2)\$), and non-uniform attention degradation (e.g., "lost in the middle" phenomena).

The **OpenCode Context Substrate** is a high-performance, deterministic context orchestration system engineered for the OpenCode ecosystem. By synthesizing Abstract Syntax Tree (AST) skeletons, graph-centric repo maps, fine-grained semantic vectors, git temporal co-change topology, and dual-level knowledge graphs, the Substrate supplies LLMs with high-density, low-noise context streams. This document establishes the architectural foundation, trade-off matrix, and implementation roadmap for the Substrate plugin.+-----------------------------------------------------------------------------------+

|                            THE CONTEXT DENSITY TRADEOFF                          |

|---|

|  Raw Files (High Noise)          AST / Graph (Optimal)       Truncated (Low Recall) |

|  \[---------------------------|=========================|-----------------------\]  |

|  0% Precision                High Precision / High Recall          100% Precision |

|  100% Context Fill           Optimal Token Footprint           0% Context Recall  |

\+-----------------------------------------------------------------------------------+

---

## **The Problem Landscape**

### **The Vibe Coder Dilemma**

The democratization of AI generation has birthed "Vibe Coding"—a paradigm where developers write natural language specifications while relying on agents to modify, refactor, and maintain complex codebases. However, without deterministic structural grounding, context engines fall into the **Vibe Coder Dilemma**:

* **Context Saturation:** Injecting whole raw files quickly exhausts token budgets (e.g., 128k–1M tokens), causing high latency, excessive API cost, and severe attention dilution.  
* **Context Starvation:** Overly aggressive file filtering or naive top-\$K\$ vector retrieval misses critical remote definitions, indirect interface implementations, and cross-module dependencies, leading to broken imports and structural hallucinations.

### **The Session Compaction Crisis**

Long-running agent conversations require context compaction. Standard naive summaries discard vital operational state:

* **Loss of Structural Anchors:** Generic text summarization strips out concrete symbol references, type signatures, and line-level delta paths.  
* **Semantic Drift:** As conversation turns accumulate, the agent loses track of edited file states versus initial disk states, triggering redundant overwrites or regressions.

Raw Conversation History

\[ Turn 1 \] \---\> \[ Turn 2 \] \---\> \[ Turn 3 \] \---\> \[ Turn 4 \] \---\> \[ Turn 5 \]

                                                                     |

                                                           Naive Text Summary

                                                                     v

                                                          Lost Symbol Signatures\!

                                                          Hallucinated Imports\!

### **Multi-Harness Coordination Failure**

Modern workflows run concurrent agents across multiple terminal instances, IDE extensions, and background verification loops. Without a centralized, thread-safe, process-isolated context substrate:

* Cache invalidation fails when external CLI processes (e.g., `git checkout`, `npm build`, `cargo check`) mutate state out-of-band.  
* Agents operate on stale AST maps and duplicate indexing efforts across local agent harnesses.

---

# **2\. Industry Landscape & Market Expectations**

## **State-of-the-Art Analysis**

| Tool / Paradigm | Core Context Strategy | Strengths | Weaknesses / Bottlenecks |
| :---- | :---- | :---- | :---- |
| **Aider** | Repository Map via Tree-sitter AST & PageRank graph analysis. | High context density; explicit graph ranking; deterministic symbol extraction. | Lacks semantic/vector search; weak on unstructured documentation and dynamic dispatch. |
| **Cursor** | Custom vector embeddings \+ Merkle-tree file syncing \+ structural code chunking \+ semantic reranking. | Sub-second multi-file retrieval; real-time disk sync; low-latency user UX. | Proprietary closed-source infrastructure; heavy cloud dependency for index builds. |
| **Claude Code** | Shell/CLI execution harness; on-demand tool search (`grep`, `glob`, `read`); dynamically built system context. | High autonomy; model-driven dynamic exploration; zero index pre-building overhead. | High token cost; dynamic exploration requires multiple expensive model turns. |
| **Augment Code** | Enterprise-scale code graph engine \+ real-time neural semantic context engine. | Scales to multi-gigabyte repos; instant cross-repository context assembly. | Closed commercial product; high memory footprint; complex deployment topology. |
| **Sourcegraph SCIP** | Protocol for Indexing Source Code (SCIP); precise cross-language LSIF symbol navigation graphs. | Exact precise cross-references (100% deterministic); compiler-level precision. | Requires build tool integration; high initial indexing latency per compilation target. |
| **LightRAG** | Dual-level Graph RAG combining low-level entity extraction with high-level conceptual topic graphs. | Captures both precise symbol paths and overarching domain concepts/architecture. | Graph extraction via LLMs is computationally expensive and slow to re-index. |

---

## **Developer & Market Expectations**

Modern software development teams demand that autonomous context substrates satisfy four core non-negotiable operational standards:                      \+---------------------------------------+

                      |       DEVELOPER EXPECTATIONS          |

                      \+---------------------------------------+

                                          |

        \+------------------+--------------+--------------+------------------+

        |                  |                             |                  |

        v                  v                             v                  v

\+---------------+  \+---------------+             \+---------------+  \+---------------+

| Real-time Sync|  | Deterministic |             | Minimal Token |  | Local-First   |

| Sub-second    |  | Precision     |             | Overhead      |  | Privacy       |

| incremental   |  | Compiler-level|             | Skeletal      |  | Zero leakage  |

| updates       |  | exactness     |             | compression   |  | offline cap.  |

\+---------------+  \+---------------+             \+---------------+  \+---------------+

1. **Sub-Second Incremental Synchronization:** Changing a file on disk or switching a `git` branch must incrementally update structural context within \< 200ms without blocking the execution harness.  
2. **Deterministic Precision:** Zero tolerance for type-signature hallucinations or invalid import path assumptions during structural code generation.  
3. **Token Footprint Efficiency:** Ability to pack complex multi-file architectural relationships into \< 4,000 tokens per prompt payload.  
4. **Local-First & Offline Privacy:** Full structural context generation must run on consumer hardware (e.g., Apple Silicon M-series, standard Linux workstations) without leaking private codebases to remote third-party parsers.

---

# **3\. In-Depth Technical Trade-offs: Weighing the 5 Solutions**

## **1\. Abstract Syntax Tree (AST) Code Skeletons**

Utilizes Tree-sitter to parse source files into ASTs, stripping function bodies, comments, and private variables while retaining exported type definitions, signatures, and interfaces.

* **Pros:** Purely deterministic, high token compression (\~80-90% footprint reduction), zero semantic hallucination.  
* **Cons:** Drops runtime logic and implementation details; fails to capture dynamic routing or runtime reflection.

## **2\. Repo Maps via PageRank Graphs**

Constructs a graph where nodes are source files/symbols and directed edges represent references or imports. Runs the PageRank algorithm to rank the relative structural importance of symbols across the workspace.

* **Pros:** Provides an exceptional high-level architectural map; fits within strict token windows; prioritizes core utility modules over leaf modules.  
* **Cons:** Computationally expensive (\$O(V \+ E)\$ iteratively) for large repos; fails if import syntaxes are dynamic or unparseable.

## **3\. Structural Code Graph (SCIP / LSIF)**

Uses exact compiler/LSP semantics to resolve concrete symbol definitions, references, implementations, and call hierarchies.

* **Pros:** 100% mathematically precise cross-file navigation; zero false-positive reference links.  
* **Cons:** Heavy build tool dependency; high initial indexing latency; rigid setup requirements per target language ecosystem.

## **4\. Git Temporal & Co-Change Analysis**

Mines `git log` history to construct a co-change frequency matrix. Files that are historically committed together (\$File\_A \\iff File\_B\$) are inferred to share architectural coupling regardless of direct code imports.

* **Pros:** Captures implicit dependencies (e.g., API schemas and frontend components) that static AST parsers miss entirely.  
* **Cons:** Fails on new/uncommitted repos; noisy on bulk refactoring commits; stale on low-activity codebases.

## **5\. Dual-Level Knowledge Graph (LightRAG Pattern)**

Extracts key architectural relationships (e.g., "AuthMiddleware *wraps* UserRouter") into a dual-level entity-relationship graph (Low-Level: Specific AST symbols; High-Level: Architectural domains).

* **Pros:** Superior for high-level architectural questions, intent mapping, and broad feature refactoring plan generation.  
* **Cons:** High LLM token cost during graph construction; slow ingestion speeds; potential entity extraction drift.

---

## **Comprehensive Evaluation Matrix**

| Metric / Feature | AST Skeletons | Repo Maps (PageRank) | Structural Graph (SCIP) | Git Co-Change | Dual Knowledge Graph |
| :---- | :---- | :---- | :---- | :---- | :---- |
| **Ingestion Latency** | **Sub-millisecond** per file | 100ms \- 2s | 1s \- 30s (Needs Build) | 50ms \- 500ms (Git Log) | 2s \- 60s (LLM Extraction) |
| **Memory Footprint** | Extremely Low (\~10MB) | Low (\~25MB) | Moderate (\~100MB \- 500MB) | Very Low (\~5MB) | High (\~200MB \- 1GB) |
| **Token Cost / Footprint** | **Minimal** (10-15% of raw) | Very Low (Fixed Budget) | Low (Explicit Snippets) | Minimal (Metadata List) | Moderate to High |
| **Precision (Symbol)** | High (Syntax-level) | Medium (Graph-ranked) | **100% Exact (Compiler)** | N/A (File-level) | Medium-High |
| **Drift Resistance** | Perfect (Real-time AST) | High (Incremental update) | Medium (Requires re-index) | Low (Static past history) | Low (Stale LLM extraction) |
| **Local Feasibility** | **100% Local (Tree-sitter)** | **100% Local** | 100% Local (Requires CLI) | **100% Local (Native Git)** | Low (Requires Local LLM) |

---

# **4\. The OpenCode Context Substrate Architecture**

The OpenCode Context Substrate uses a modular, decoupled architectural topology: **The Spine** (Ingestion & Storage), **The Honeycomb** (Indexing Engine), and **Artifacts** (Context Synthesis & Token Packing).+-----------------------------------------------------------------------------------+

|                         OPENCODE CONTEXT SUBSTRATE ARCHITECTURE                   |

\+-----------------------------------------------------------------------------------+

                          \+-------------------------------+

                          |    File System & Git Event    |

                          |        FileWatcher Daemon     |

                          \+---------------+---------------+

                                          |

                                          v

\+-----------------------------------------------------------------------------------+

| THE SPINE (Core Ingestion Pipeline)                                               |

|                                                                                   |

|  \+---------------------------+  \+----------------------------------------------+  |

|  | Incremental AST Engine    |  | Git Co-Change Miner                          |  |

|  | (Tree-sitter WASM)        |  | (Libgit2 / Subprocess)                       |  |

|  \+-------------+-------------+  \+----------------------+-----------------------+  |

\+----------------|---------------------------------------|--------------------------+

                 |                                       |

                 v                                       v

\+-----------------------------------------------------------------------------------+

| THE HONEYCOMB (Storage & Graph Index Layer)                                       |

|                                                                                   |

|  \+---------------------------+  \+----------------------+  \+---------------------+ |

|  | SQLite Vector Store       |  | Symbol Dependency    |  | Temporal Co-Change  | |

|  | (sqlite-vec / HNSW)       |  | Graph (Petgraph)     |  | Matrix              | |

|  \+-------------+-------------+  \+----------+-----------+  \+----------+----------+ |

\+----------------|---------------------------|-------------------------|------------+

                 |                           |                         |

                 \+-------------------+-------+-------------------------+

                                     |

                                     v

\+-----------------------------------------------------------------------------------+

| ARTIFACTS (Context Synthesis & Packing Layer)                                     |

|                                                                                   |

|  \+-----------------------------------------------------------------------------+  |

|  | Dynamic Skeletonizer & PageRank Truncator                                   |  |

|  \+-------------------------------------+---------------------------------------+  |

|                                        |                                          |

|                                        v                                          |

|  \+-----------------------------------------------------------------------------+  |

|  | Token-Budgeted System Prompt Context Payload                                |  |

|  \+-----------------------------------------------------------------------------+  |

\+-----------------------------------------------------------------------------------+

---

## **Component Breakdown**

### **1\. The Spine (Ingestion & Normalization)**

* **FileWatcher Daemon:** Non-blocking multi-threaded disk watcher (using `notify` or `chokidar`) listening for file write, delete, and move events.  
* **Tree-sitter AST Normalizer:** Language-agnostic worker pool executing compiled WASM Tree-sitter parsers. Emits structural AST nodes (Classes, Functions, Interfaces, Imports, Type Declarations).  
* **Git Co-Change Engine:** Background worker extracting commit history chunks to compute pairwise co-modification probabilities:

\$\$P(F\_A \\mid F\_B) \= \\frac{\\text{Commits}(F\_A \\cap F\_B)}{\\text{Commits}(F\_B)}\$\$

### **2\. The Honeycomb (Unified Graph & Vector Persistence)**

* **SQLite Vector Storage (`sqlite-vec`):** High-efficiency local vector store storing dense embeddings of docstrings, comments, and semantic code blocks.  
* **Symbol Dependency Graph (In-Memory Petgraph):** Directed multi-graph representing static imports, function calls, and type heritage.  
* **Temporal Matrix Cache:** Fast lookup key-value store mapping file paths to co-changed file candidates.

### **3\. Artifacts (Context Synthesis & Token Packing)**

* **Context Payload Builder:** Assembles structured prompt components based on explicit budget parameters.  
* **Dynamic Truncator:** Applies PageRank weight cutoffs to discard leaf node symbols when token limits are reached.

---

## **Progressive Disclosure and Anti-Hallucination Guardrails**

To prevent LLM hallucination while preserving token economy, the Substrate implements a strict **4-Tier Progressive Disclosure Model**:+-----------------------------------------------------------------------------------+

|                      PROGRESSIVE DISCLOSURE TIER PIPELINE                         |

|                                                                                   |

|  \[ Tier 1: Skeleton \] \---\> \[ Tier 2: Interface \] \---\> \[ Tier 3: Core Snippets \]   |

|     (Repo Map / AST)           (Full Signatures)        (Target Function Body)    |

|                                                                  |                |

|                                                                  v                |

|                                                         \[ Tier 4: Exact File \]    |

|                                                            (Full Raw File)        |

\+-----------------------------------------------------------------------------------+

1. **Tier 1: High-Level Repo Map (0.5k \- 1.5k Tokens):** Top PageRank nodes represented as minimal class/file paths.  
2. **Tier 2: Interface & AST Signatures (1.5k \- 4k Tokens):** Complete type definitions, interfaces, and exported function signatures without bodies.  
3. **Tier 3: Targeted Implementation Snippets (4k \- 12k Tokens):** Complete code implementation of explicitly referenced or target symbols.  
4. **Tier 4: Full File Isolation (12k+ Tokens):** Active target edit file loaded in raw text.

### **Anti-Hallucination Guardrails**

* **Import Verifier:** Pre-execution check verifying that generated import statements resolve to existing exported symbols within the Tree-sitter graph.  
* **Type Anchor Enforcement:** System-prompt instruction injecting strict constraint blocks containing exact AST types, preventing the LLM from fabricating method signatures.

---

# **5\. Phased Implementation Roadmap for OpenCode V2 Plugin**

\+-----------------------------------------------------------------------------------+

|                        PHASED IMPLEMENTATION ROADMAP                              |

\+-----------------------------------------------------------------------------------+

\[ Phase 1: MVP Local Core \] \-----------------------------------------------------\>|

  \- Tree-sitter AST Parser Engine                                                 |

  \- Basic Skeleton Generator                                                      |

  \- Local SQLite Store Integration                                                |

                                                                                  v

\[ Phase 2: Topological Graph \] \--------------------------------------------------\>|

  \- In-Memory PageRank Repo Map Graph                                             |

  \- Git Co-Change Mining Engine                                                   |

  \- Hybrid Token-Budget Packing Engine                                            |

                                                                                  v

\[ Phase 3: Semantic Memory Fabric \] \---------------------------------------------\>|

  \- Incremental Vector Indexing Engine                                            |

  \- Local Dual-Level Entity Graph (LightRAG)                                      |

  \- Cross-Harness Process Synchronization Protocol                                |

\+-----------------------------------------------------------------------------------+

---

## **Detailed Task Breakdowns**

### **Phase 1: MVP Local Core (Weeks 1–4)**

* **Task 1.1:** Integrate Tree-sitter WASM bindings for TypeScript, Python, Rust, Go, and C++.  
* **Task 1.2:** Implement standard skeletonizer stripping function/method bodies while maintaining exact line offset markers.  
* **Task 1.3:** Set up local `sqlite3` database for AST symbol cache storage.  
* **Deliverable:** Functional CLI/Plugin producing deterministic AST code skeletons within \< 10ms per file.

### **Phase 2: Topological Graph & Co-Change Analysis (Weeks 5–8)**

* **Task 2.1:** Construct in-memory directed graph of workspace dependencies using `petgraph`.  
* **Task 2.2:** Implement iterative PageRank scoring over workspace symbol graph.  
* **Task 2.3:** Add `git log` analyzer computing temporal co-change scores across commit histories.  
* **Task 2.4:** Build hybrid context packer combining PageRank scores and Git co-change frequency within configurable token limits.  
* **Deliverable:** Context Substrate capable of generating dense, high-relevance Repo Maps under 3,000 tokens.

### **Phase 3: Semantic Memory Fabric & Cross-Agent Sync (Weeks 9–12)**

* **Task 3.1:** Embed local dense vector store (`sqlite-vec`) for docstring and code chunk retrieval using lightweight local embeddings.  
* **Task 3.2:** Implement background LightRAG dual-level entity extraction pipeline for architectural concept mapping.  
* **Task 3.3:** Design IPC file lock & event broker allowing multiple OpenCode sub-agent processes to read/write shared context safely.  
* **Deliverable:** Complete enterprise-grade Context Substrate system operating entirely offline with sub-second incremental indexing.

---

# **6\. Technical Uncertainties, Failure Modes & Edge Cases**

## **Technical Uncertainties**

1. **Dynamic Language Precision:** Static AST analysis struggles with dynamic dynamic programming patterns (e.g., Python `getattr`, JavaScript dynamic `import()`, Ruby `method_missing`).  
2. **Monorepo Scale Boundaries:** Repositories exceeding 1,000,000 lines of code may cause in-memory graph construction to hit memory limits on standard 16GB RAM machines.

## **Failure Modes & Mitigation Strategies**

\+-----------------------------------------------------------------------------------+

|                        FAILURE MODES & MITIGATION MATRIX                          |

\+-----------------------------------------------------------------------------------+

Failure Mode                 Root Cause                     Mitigation Strategy

\---------------------------  \-----------------------------  \----------------------------------

Graph Index Invalidation     Rapid Git Branch Switch        Incremental Delta-Reindex Trigger

Memory Spike on Monorepos    Unbounded Graph Expansion      LRU Node Eviction & Disk Paging

Stale Vector Embeddings      Silent Background File Write   FSWatcher File Mutation Locks

Tree-sitter Parsing Error    Generated / Invalid Syntax     Fallback to Line-Heuristic Chunking

\+-----------------------------------------------------------------------------------+

### **Edge Cases**

* **Generated Code / Minified Files:** Auto-generated source files (e.g., `bundle.js`, `proto.pb.go`) destroy graph quality. *Mitigation:* Automatic path exclusion via `.gitignore` and default heuristics for file size/line length thresholds.  
* **Macro-Heavy Metaprogramming:** Rust macros (`macro_rules!`) or C++ templates expanding into unparsed code blocks. *Mitigation:* Fallback to simple regex symbol declarations when AST parsing returns error nodes.

---

# **7\. References & Verified Sources**

* [Aider Repository Map Architecture](https://aider.chat/docs/repomap.html) \- Structural analysis via Tree-sitter & PageRank graph constructs.  
* [Tree-sitter Syntax Tree Parsing Framework](https://tree-sitter.github.io/tree-sitter/) \- Fast, incremental, language-agnostic parsing infrastructure.  
* [Sourcegraph SCIP Protocol Specification](https://github.com/sourcegraph/scip) \- SCIP Code Intelligence Protocol for exact symbol reference mapping.  
* [LightRAG: Simple and Fast Retrieval-Augmented Generation](https://arxiv.org/abs/2410.05779) \- Dual-level graph-based entity retrieval framework.  
* [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172) \- Analysis of model attention performance across varying context depths.  
* [sqlite-vec: Vector Search Extension for SQLite](https://github.com/asgregorio/sqlite-vec) \- Lightweight embedded vector search for local-first architectures.

