# AGENTS.md

Standalone OpenCode V2 Context & Working-Memory Substrate plugin (`hivemind-substrate`).
Unifies **The Spine** (deterministic JSONL transcript archive, content-addressed `blobs/<sha256>.txt`, OpenCode shadow worktree Git trees, external `tool-output`/`shell` spills, and `.git` commit history), **The Honeycomb** (`.session-archive/index.sqlite` indexing session/delegation lineage, `kv` bindings, trajectory milestones, user prompts, tool calls, file touches, snapshot artifacts, verification receipts, AST code skeletons, PageRank repo maps, and Git temporal co-change matrices), and **Artifacts & Viewports** (step-watermark working-set pruning, 4-tier progressive disclosure recall for Strategist and Implementor viewports, and deterministic compaction continuity).

Read `GLOSSARY.md` before naming anything. Read `.opencode/AGENTS.md` for standing operating posture.

## Agent skills

- **Issue tracker:** Local ticket files under `.planning/phases/<slug>/tickets/` + upstream `shynlee04/hivemind-steward-oc-devin-dev`. See `docs/agents/issue-tracker.md`.
- **Labels:** `ticket` + `phase:<slug>`; no separate triage label vocabulary. See `docs/agents/triage-labels.md`.
- **Domain docs:** Single context; `GLOSSARY.md`, `.planning/architecture/`, `.planning/decisions.tsv`, and `docs/teach-me/`. See `docs/agents/domain.md`.
- **Artifacts:** `.planning/` root (`PROJECT.md`, `ROADMAP.md`, `STATE.md`), phase prefixes `TWM`/`CSG`/`VSC`. See `docs/agents/artifacts.md`.

## Architecture

| File / Module | Owns |
|---|---|
| `src/plugin.ts` | Thin shell: plugin `setup`, tool registration (`substrate.viewport`, `substrate.valve`, `archive.persist`), lifecycle hooks (`context`, `compaction`, `event.subscribe`), option parsing. Imports of `@opencode/plugin` are type-only - the host supplies the runtime module. |
| `src/archive/index.ts` | Incremental `persist()` driver: walk up to the root, flatten the tree, write JSONL + `info.json` + blobs + `index.sqlite` gated by `(session_id, max_seq, source_updated_at)` watermarks. |
| `src/archive/source.ts` | `SessionSource` seam + `sqliteSource(dbPath)`: read-only `bun:sqlite` access to `~/.local/share/opencode/opencode.db` (`project`, `session_v2`, `session_message`, `kv`). Validates required columns up front; throws `session-archive: host schema drift: <table>.<column> missing`. |
| `src/archive/normalize.ts` | `session_message` rows -> archive records (`user | assistant | skill | shell | context | compaction | boundary | unknown`), blob sinking (including external `tool-output`/`shell` spills and shadow snapshot file blobs), delegation facts, and trajectory milestones. |
| `src/archive/layout.ts` | Archive file layout + lane classification (`root`/`nested`/`external` vs the canonical project root). |
| `src/archive/index-db.ts` | `index.sqlite` DDL, incremental watermark sync, lineage & structural tables (`session`, `delegation`, `milestone`, `file_touch`, `snapshot_artifact`, `verification_receipt`, `provenance_edge`, `working_valve_state`, `code_file`, `code_symbol`, `code_edge`, `git_cochange`). |
| `.opencode/plugins/context-prune.ts` | Prototype working-set valve being unified into `src/` (assistant step watermark, fact breadcrumbs, Do-Not-Reread Working-Memory Manifest). |
| `.opencode/plugins/compaction-continuity.ts` | Prototype compaction continuity prompt contract being unified into `src/` over `index.sqlite`. |
| `test/helpers.ts` | Host DDL copied verbatim from OpenCode (`sqlite3 opencode.db ".schema ..."`), fixture builders. |

## Host contract facts (verified against OpenCode v2.0.32)

- All delegation tools (`subagent`, `delegate-devin`, `hivemind-delegate`) record the child session in `state.metadata.sessionID`; `input.sessionID` means "continue an existing child" (`mode: continue`, else `spawn`). Harness comes from the child's `model.providerID` (`devin-native` -> devin, `antigravity-native` -> antigravity, else opencode); `hivemind-delegate` may also carry `input.harness`.
- Durable foreign session bindings (`foreignSessionID`, `turn`, `phase`, `foreignAck`, `consumedInputs`, `servingWitness`) live in `opencode.db` table `kv` under `plugin:<utf16be-hex>:bindings/<childSessionID>` and `delegate-mode/child/<childSessionID>`.
- Message types in `@opencode/schema`: `user`, `assistant`, `skill`, `shell`, `synthetic`, `system`, `compaction`, `idle`, `agent-switched`, `model-switched`, `location-switched`.
- `Assistant.snapshot` (`start`/`end`) are Git `tree` SHAs in OpenCode's shadow bare repo (`~/.local/share/opencode/snapshot/<project_id>/<sha1(directory)>/`), not project `.git` commits.
- `ctx.session.hook("context", ...)` runs synchronously on the critical path of every primary LLM step and must remain strictly in-memory (`< 2 ms`).
- Changes under `.opencode/` trigger a host hot-reload - the archive therefore lives in `<canonicalRoot>/.session-archive/`, never under `.opencode/`.
- Every record carries `raw_ref: {session_id, message_id, seq}` back to `opencode.db`.

## Commands

```sh
bun test              # all unit + e2e tests (fixture DBs, no host needed)
bun run typecheck     # tsc --noEmit
bun run build         # bundles src/plugin.ts -> dist/session-archive.ts
ARCHIVE_REAL_DB=1 bun test test/realdb.test.ts   # opt-in drive on the real host DB
```

## Rules

- Commit only when authorized by the owner using `atomic-git-commit`.
- Never write to `opencode.db` or `~/.local/share/opencode/snapshot/` - read-only sources only.
- Fixture DDL must be re-synced when the pinned host version moves; drift is a loud error, not a silent skip.
