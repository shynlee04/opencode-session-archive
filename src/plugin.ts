// session-archive — OpenCode V2 plugin.
//
// Install: build with `bun run build`, then copy dist/session-archive.ts into
// <project>/.opencode/plugins/ (project scope) or ~/.config/opencode/plugins/
// (global). The host supplies the "@opencode/plugin" runtime module — imports
// here stay type-only.
//
// Registers the `archive_persist` tool (namespace `archive`). It reads the
// host session DB read-only and writes a deterministic transcript archive +
// SQLite index into <projectRoot>/.session-archive (or options.dir). Invoke it
// only when the user explicitly asks to persist/archive the session.

import type { Plugin } from "@opencode/plugin"
import { persist, sqliteSource } from "./archive/index.ts"

const defaultDbPath = (): string => {
  const dataHome = Bun.env.XDG_DATA_HOME ?? `${Bun.env.HOME}/.local/share`
  return `${dataHome}/opencode/opencode.db`
}

export default {
  id: "session-archive",
  async setup(ctx: Plugin.Context) {
    const dir = typeof ctx.options.dir === "string" ? ctx.options.dir : undefined
    const dbPath = typeof ctx.options.dbPath === "string" ? ctx.options.dbPath : defaultDbPath()
    const codemode = ctx.options.direct === true ? false : true

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "archive",
        description: "Deterministic session transcript archive",
      })
      editor.add({
        name: "persist",
        options: { namespace: "archive", codemode },
        description:
          "Persist the current session tree (this session's root plus all descendant child sessions) into the " +
          "project's .session-archive transcript archive and SQLite index. Reads the host database read-only; " +
          "writes JSONL transcripts, content-addressed blobs and index.sqlite under the canonical project root. " +
          "Use only on explicit user request to archive/persist the session — never proactively.",
        input: {
          type: "object",
          properties: {
            sessionID: {
              type: "string",
              description: "Session to persist; defaults to the current session. The whole tree from the root is archived.",
            },
          },
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const sessionID =
            typeof (input as { sessionID?: unknown }).sessionID === "string"
              ? (input as { sessionID: string }).sessionID
              : context.sessionID
          await context.progress({ status: `persisting session tree for ${sessionID}` })
          const source = sqliteSource(dbPath)
          const report = persist(
            {
              sessionID,
              projectID: ctx.location.project.id,
              projectRoot: ctx.location.project.canonical,
              dir,
            },
            source,
          )
          source.close()
          return {
            content: [
              `Persisted session tree rooted at ${report.rootID} into ${report.archiveDir}.`,
              `${report.sessions} sessions, ${report.messages} messages, ${report.delegations} delegations.`,
              `${report.written.length} files written, ${report.unchanged} unchanged.`,
            ].join(" "),
            metadata: report,
          }
        },
      })
    })
  },
} satisfies Plugin.Plugin
