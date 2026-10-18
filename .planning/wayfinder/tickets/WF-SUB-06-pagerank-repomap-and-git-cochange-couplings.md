# WF-SUB-06: Iterative PageRank RepoMap & Git Temporal Co-Change Coupling Warnings

- **ID:** `WF-SUB-06`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `open`
- **Depends on:** `WF-SUB-05`
- **Evidence Input:** [`WF-SUB-R03`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R03-codebase-memory-ast-pagerank-cochange.md)

## Question

How should `hivemind-substrate` combine static AST import PageRank with `git log` temporal co-change probabilities (`P(A|B) = Commits(A ∩ B) / Commits(B)`) so that Strategists get a `< 1,000`-token architectural RepoMap and Implementors automatically receive hidden cross-file coupling warnings (such as `src/devin-executable.ts <-> src/harness-antigravity.ts`, `P = 66.7%`, `0` static edges) when reading or editing a file?

## Prototype Experiment Scope (`scratch/prototypes/wf-sub-06-repomap-cochange.ts`)

1. Implement the pure-TS `Float64Array` PageRank solver (`20` iterations, `d = 0.85`) and `git log -n 500` co-change miner (`max_files_per_commit <= 15` to filter bulk formatting commits).
2. Store results in `code_file(pagerank)` and `git_cochange(file_a, file_b, co_commits, prob_a_given_b, prob_b_given_a, jaccard, has_static_edge)`.
3. Verify that querying `viewport({ action: "coupled", path: "src/devin-executable.ts" })` surfaces `src/harness-antigravity.ts` (`66.7%`) and `src/acp.ts` (`50.0%`) with their recent shared commit subjects.
