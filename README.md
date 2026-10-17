# hivemind-session-archive

An OpenCode V2 plugin that persists the current session tree — the root
session plus every descendant child session (subagents, `delegate-devin`,
`hivemind-delegate`) — into a deterministic, project-scoped transcript
archive.

It exists so reflective/agent tooling (`reflect`, `recall`,
`show-me-your-work`, `interrogate`, review and audit workflows) has stable,
queryable transcripts instead of manual `session export` JSON snapshots.

- **Source of truth:** reads `opencode.db` read-only through `bun:sqlite`.
  It never writes to the host database.
- **Deterministic:** no wall-clock output, stable key order, temp-file +
  rename writes. A second persist of unchanged sessions writes nothing.
- **Explicit-only:** it runs only when the user or agent invokes
  `archive_persist`. Nothing is archived automatically.

## Install (agent instructions)

You are an agent inside OpenCode. To make `archive_persist` available in the
end-user's current project, pick one:

### Option A — config entry (recommended)

Add a plugin entry to the project's `opencode.json`, preserving any existing
keys:

```jsonc
{
  "plugins": [
    { "package": "hivemind-session-archive" }
  ]
}
```

Or run the installer, which makes exactly this edit and is idempotent:

```sh
npx hivemind-session-archive            # project scope: ./opencode.json
npx hivemind-session-archive --global   # global: ~/.config/opencode/opencode.json
npx hivemind-session-archive --check    # report status, no writes
```

Tell the user to reload OpenCode (or restart the TUI). Changes under
`.opencode/` hot-reload; `opencode.json` edits may need a restart.

### Option B — drop-in file

Copy the bundled single-file build from the package into the project's
plugin directory:

```sh
mkdir -p .opencode/plugins
cp node_modules/hivemind-session-archive/dist/session-archive.ts .opencode/plugins/
```

The file is bundled JavaScript saved with a `.ts` extension and carries a
`// @ts-nocheck` header; this is intentional — it must stay dependency-free.

Then reload OpenCode.

## Use

After reload the agent has the `archive_persist` tool (namespace `archive`,
Code Mode by default). Call it — or answer a user request like "persist /
archive this session" — with no arguments to archive the current session
tree:

```
archive_persist({})            // current session's whole tree
archive_persist({ sessionID }) // tree containing a specific session
```

The tool returns a report: `rootID`, `archiveDir`, counts of sessions /
messages / delegations, `written[]` files and `unchanged` count.

### Plugin options

Set under the plugin entry's `options` in `opencode.json`:

```jsonc
{ "package": "hivemind-session-archive",
  "options": { "dir": ".session-archive", "dbPath": "…", "direct": false } }
```

| Option | Default | Meaning |
|---|---|---|
| `dir` | `.session-archive` | Archive directory, relative to the canonical project root. |
| `dbPath` | `~/.local/share/opencode/opencode.db` (XDG-aware) | Host DB to read. |
| `direct` | `false` | `true` registers the tool outside Code Mode. |

## What it writes

Under `<canonicalRoot>/.session-archive/`:

```
sessions/<root>/<root>.jsonl            # header + normalized records
sessions/<root>/info.json               # session header, pretty-printed
sessions/<root>/subagents/<child>/…     # child trees, nested recursively
blobs/<sha256>.txt                      # reasoning text, oversized tool I/O,
                                        # file/skill bodies — deduplicated
index.sqlite                            # queryable index: session, delegation,
                                        # message, tool_call, compaction,
                                        # instruction
```

Record notes:

- Every record carries `raw_ref: {session_id, message_id, seq}` pointing back
  to `opencode.db`.
- Reasoning text lives in blobs; encrypted reasoning keeps only a byte count.
- Strings over 4096 chars in tool inputs/outputs become `blob:<sha256>`
  references with a preview.
- One `delegation` edge covers `subagent`, `delegate-devin` and
  `hivemind-delegate`, distinguished by a `harness` column
  (`devin | antigravity | opencode`) and `mode` (`spawn | continue`).
- Sessions run in worktrees or sibling checkouts are classified into `lane`
  (`root | nested | external`) and archived under the canonical project root.

## Requirements

- OpenCode V2 host (plugins run on Bun; `bun:sqlite` must be available).
- A readable `opencode.db` — normally `~/.local/share/opencode/opencode.db`.
  If the host schema has drifted, persist fails loudly with
  `session-archive: host schema drift: <table>.<column> missing`.

## Notes for maintainers

```sh
bun test                    # fixture-DB unit + e2e tests
bun run typecheck           # tsc --noEmit
bun run build               # emits dist/session-archive.ts
ARCHIVE_REAL_DB=1 bun test test/realdb.test.ts   # opt-in drive on the live host DB
```

The archive directory (`<project>/.session-archive/`) is a local artifact —
projects decide themselves whether to gitignore or commit it. Treat it as
sensitive: transcripts can contain secrets pasted into a session.
