# AGENTS.md

Standalone OpenCode V2 plugin (prototype). Registers one tool,
`archive_persist` (namespace `archive`), which deterministically persists the
current session tree — root plus every descendant child session — from the
host database into a project-scoped JSONL transcript archive plus a SQLite
index. It exists so pstack-style skills (`reflect`, `recall`,
`show-me-your-work`, `interrogate`) can read structured transcripts without
the manual `session export` JSON workaround.

## Architecture

| File | Owns |
|---|---|
| `src/plugin.ts` | Thin shell: plugin `setup`, tool registration, option parsing. Imports of `@opencode/plugin` are type-only — the host supplies the runtime module. |
| `src/archive/index.ts` | `persist()` driver: walk up to the root, flatten the tree, write JSONL + `info.json` + blobs + `index.sqlite`, rebuild index rows in one transaction. |
| `src/archive/source.ts` | `SessionSource` seam + `sqliteSource(dbPath)`: read-only `bun:sqlite` access to `~/.local/share/opencode/opencode.db`. Validates required columns up front; throws `session-archive: host schema drift: <table>.<column> missing`. |
| `src/archive/normalize.ts` | `session_message` rows → archive records (`user | assistant | context | compaction | boundary | unknown`), blob sinking, delegation facts. |
| `src/archive/layout.ts` | Archive file layout + lane classification (`root`/`nested`/`external` vs the canonical project root). |
| `src/archive/index-db.ts` | `index.sqlite` DDL, change detection (`indexMatches`), single-transaction rebuild. |
| `test/helpers.ts` | Host DDL copied verbatim from opencode v2.0.31 (`sqlite3 opencode.db ".schema …"`), fixture builders. |

The plugin context API cannot list sessions or their messages, so the plugin
reads `opencode.db` read-only. Persistence is explicit-only and
deterministic: no wall-clock values, stable key order, files written via
temp+rename only when bytes change, so a second run reports `written=[]`.

## Host contract facts (verified against v2.0.31)

- All delegation tools (`subagent`, `delegate-devin`, `hivemind-delegate`)
  record the child session in `state.metadata.sessionID`; `input.sessionID`
  means "continue an existing child" (`mode: continue`, else `spawn`).
  Harness comes from the child's `model.providerID` (`devin-native` → devin,
  `antigravity-native` → antigravity, else opencode); `hivemind-delegate` may
  also carry `input.harness`.
- Message types: `user`, `assistant`, `synthetic`, `system`, `compaction`,
  `idle`, `agent-switched`, `model-switched`, `location-switched`.
- `location-switched` data carries `location`, `projectID`, `subpath`,
  `previous` at the top level (the `location` object nests the same fields).
- Changes under `.opencode/` trigger a host hot-reload — the archive
  therefore lives in `<canonicalRoot>/.session-archive/`, never under
  `.opencode/`.
- Reasoning text is kept in deduplicated `blobs/<sha256>.txt`; encrypted
  reasoning is dropped and only its byte count is kept.
- Every record carries `raw_ref: {session_id, message_id, seq}` back to
  `opencode.db`.

## Commands

```sh
bun test              # all unit + e2e tests (fixture DBs, no host needed)
bun run typecheck     # tsc --noEmit
bun run build         # bundles src/plugin.ts → dist/session-archive.ts
ARCHIVE_REAL_DB=1 bun test test/realdb.test.ts   # opt-in drive on the real host DB
```

Install: `bun run build`, then copy `dist/session-archive.ts` into
`<project>/.opencode/plugins/` or `~/.config/opencode/plugins/` and reload.
The artifact is bundled JavaScript saved with a `.ts` extension (disclosed;
`@ts-nocheck` header included). The build fails if any non-`bun:`/`node:`
import survives the bundle.

## Rules

- Nothing is committed until the owner authorizes it; leave the tree dirty.
- Never write to `opencode.db` — read-only source only.
- Never auto-archive: `archive_persist` runs only on explicit user request.
- Fixture DDL must be re-synced when the pinned host version moves; drift is
  a loud error, not a silent skip.
- `@opencode/plugin` is pinned to `2.0.31` (types only) to match the
  installed host — the pin predates the 7-day vetting window intentionally.
