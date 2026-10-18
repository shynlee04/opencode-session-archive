---
kind: ticket
id: CSG-01
phase: codebase-structural-graph
title: "Zero-dependency Bun.Transpiler + Depth-2 closure-factory AST skeletonizer and content-addressed SQLite cache"
status: done
type: feature
owner: implementer
spec_anchor: .planning/phases/codebase-structural-graph/SPEC.md
requirements: [REQ-SUB-09, REQ-SUB-10]
spec_requirements: [REQ-SUB-09, REQ-SUB-10]
adr_anchors: [ADR-003]
domain_context_anchors: [GLOSSARY.md, .planning/architecture/DEEP-MODULE-DESIGN.md]
dependencies: [TWM-01]
write_lease: [src/honeycomb/ast-skeleton.ts, src/honeycomb/index.ts, src/archive/index-db.ts, test/ast-skeleton.test.ts]
file_surface: [src/honeycomb/ast-skeleton.ts, src/honeycomb/index.ts, src/archive/index-db.ts, test/ast-skeleton.test.ts]
proves: "bun test test/ast-skeleton.test.ts && bun run typecheck"
validation_grep: "CSG-01|skeletonizeSource|indexCodebase|readSymbolSlice @ test/ast-skeleton.test.ts"
probe_anchors: [.planning/phases/trajectory-working-memory/reviews/SPEC-REVIEW.md]
tdd: true
github_issue: null
---

# CSG-01: Zero-dependency Bun.Transpiler + Depth-2 closure-factory AST skeletonizer and content-addressed SQLite cache

## Requirements / user outcome

- **Requirements:** `REQ-SUB-09`, `REQ-SUB-10` ([.planning/phases/codebase-structural-graph/SPEC.md](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/phases/codebase-structural-graph/SPEC.md))
- **ADRs:** `ADR-003`
- **Outcome:** src/honeycomb/ast-skeleton.ts combines Bun.Transpiler.scan() with the single-pass scanLexicalLines (lineMinBrace[L]) Depth-2 closure-factory state machine to extract Depth-1 and Depth-2 symbol signatures and [Lstart-Lend] spans (>= 88% token reduction, < 30 ms warm parse), caches results in code_file, code_symbol, and code_import_edge keyed by (path, blob_sha) (< 0.5 ms/file warm skip), and hydrates exact Tier-3 slices via readSymbolSlice.

## Scope / non-goals

- **Included:** `src/honeycomb/ast-skeleton.ts`, `src/honeycomb/index.ts`, `src/archive/index-db.ts`, `test/ast-skeleton.test.ts`
- **Excluded (non-goals):**
  - Bundling typescript compiler APIs or external WASM/C++ Tree-sitter binaries.

## Blocked by

- `TWM-01`

## Owner / write set

- **Owner role:** `implementer` (`tdd` red -> green -> refactor)
- **Write lease:** `src/honeycomb/ast-skeleton.ts`, `src/honeycomb/index.ts`, `src/archive/index-db.ts`, `test/ast-skeleton.test.ts`
- **Shared-write serialization:** `src/archive/index-db.ts` and `src/archive/types.ts` are serialized by coordinator lease across tickets that extend schema DDL.

## Acceptance (Nyquist-sampled)

- **Automated command:** `bun test test/ast-skeleton.test.ts && bun run typecheck`
- **Failing direction (RED):** skeletonizeSource fails to extract Depth-2 inner closure helpers in factory functions >= 200 lines, achieves < 88% token reduction, or indexCodebase re-parses unchanged (path, blob_sha) files.
- [x] REQ-SUB-09: skeletonizeSource extracts Depth-1 exports and Depth-2 inner closure helpers/returned methods inside factory functions >= 200 lines while ignoring braces inside comments, strings, template literals, and regexes.
- [x] REQ-SUB-10: indexCodebase (supporting both (rootDir, db, options) and (db, projectRoot, options) signatures) skips unchanged (path, blob_sha) files in < 0.5 ms/file and re-indexes a single modified file in < 5 ms.
- [x] REQ-SUB-10: readSymbolSlice hydrates exact [Lstart-Lend] source slices by Depth-1 name, Depth-2Parent.child qualified_name, or explicit [Lstart-Lend] range.
- [x] Verification: bun test test/ast-skeleton.test.ts && bun run typecheck pass.

## Runtime / UAT

- **Real journey:** Calling substrate.viewport({ action: "skeleton" }) and substrate.viewport({ action: "slice" }) returns Depth-2 outlines and exact line slices.
- **Gate status:** `ENGINEERING_VERIFIED` · `UAT_PENDING` (automated gate verified; owner UAT pending).
