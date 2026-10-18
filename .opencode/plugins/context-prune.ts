// context-prune — portable OpenCode V2 plugin (single file, no dependencies).
//
// Install: copy this file into <project>/.opencode/plugins/ (project scope) or
// ~/.config/opencode/plugins/ (global). The host auto-discovers *.ts under
// {plugin,plugins}/ inside discovered config roots and supplies the
// "@opencode/plugin"/"effect" runtime modules — keep imports type-only.
//
// Usage inside a session (via the `execute` codemode catalog):
//   tools.ctx["context-prune"]({ mode: "recent" })   — thin tool I/O above your
//     last prompt; everything since stays full-fidelity.
//   tools.ctx["context-prune"]({ mode: "initial" }) — thin tool I/O across all
//     completed history before the current prompt.
//
// Mechanics: the tool writes a per-session ledger to plugin storage; a session
// "context"/"compaction"/"generate"/"title" hook re-applies the thinning to the
// assembled request on every later model call. Durable history is never edited
// (the message API is read-only); the prune is reversible by deleting the
// ledger key "context-prune:<sessionID>".

import type { Plugin } from "@opencode/plugin"

// Tool results kept verbatim: delegate output cannot be re-derived by replaying
// the call. read/write/edit results ARE re-fetchable (re-read the file), so they
// thin like everything else — keeping them verbatim is what made "initial"
// barely shrink a tool-heavy session. Their call inputs stay intact below, so
// re-running is one ordinary call.
const KEEP_RESULT = new Set(["subagent", "task", "delegate-devin", "hivemind-delegate"])

// These tools' call INPUTS are the payload — file bodies and edit hunks live in
// content/oldString/newString. Thinning them leaves `{path}` stubs in context;
// an agent quoting that stub re-issues invalid calls ("Missing key:
// oldString/newString"). Keep their inputs verbatim so the written text stays
// legible to later turns.
const KEEP_INPUT = new Set(["read", "write", "edit"])

const LEDGER_PREFIX = "context-prune:"

type Mode = "recent" | "initial"

type Ledger = {
  readonly mode: Mode
  /** Message id anchoring "recent" thinning; null means thin everything. */
  readonly anchor: string | null
  readonly at: string
}

const skillBlob = /<skill_content\b[^>]*>[\s\S]*?<\/skill_content>/g

const skillName = (blob: string) => /name="([^"]+)"/.exec(blob)?.[1] ?? "unknown"

const partTextLength = (result: unknown): number => {
  if (typeof result !== "object" || result === null) return 0
  const part = result as { value?: unknown; content?: unknown }
  const texts = [part.value, part.content].flatMap((v) => {
    if (typeof v === "string") return [v.length]
    if (!Array.isArray(v)) return []
    return v.map((item) =>
      typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
        ? (item as { text: string }).text.length
        : 0,
    )
  })
  return texts.reduce((n, x) => n + x, 0)
}

// Input thinning must preserve the argument SHAPE: every key survives so the
// model still sees how to call the tool. Scalars and short strings pass
// verbatim; long strings truncate in place. Never add marker keys inside the
// args object — the model copies observed arg shapes, and a `__thinned` key
// ends up emitted as a real argument.
const FIELD_LIMIT = 280

const thinValue = (value: unknown): unknown => {
  if (typeof value === "string")
    return value.length <= FIELD_LIMIT
      ? value
      : `${value.slice(0, FIELD_LIMIT)}…[context-prune: ${value.length - FIELD_LIMIT} more chars]`
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined)
    return value
  return `[context-prune: ~${JSON.stringify(value)?.length ?? 0} chars]`
}

const thinInput = (input: unknown): unknown => {
  if (typeof input !== "object" || input === null)
    return `[context-prune: input thinned (~${JSON.stringify(input)?.length ?? 0} chars)]`
  if (Array.isArray(input)) return `[context-prune: array input thinned (${input.length} items)]`
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, thinValue(value)]))
}

const thinnedSkill = (text: string) =>
  text.replace(
    skillBlob,
    (blob) => `[context-prune: skill "${skillName(blob)}" body thinned — re-invoke @${skillName(blob)} if needed]`,
  )

export default {
  id: "context-prune",
  async setup(ctx: Plugin.Context) {
    const ledger = async (sessionID: string): Promise<Ledger | null> =>
      ((await ctx.storage.get(LEDGER_PREFIX + sessionID)) as Ledger | undefined) ?? null

    // Mutates the assembled request in place. Must stay total: a throw inside a
    // session hook surfaces as a request defect, not a tool error.
    const thin = (event: { sessionID: string; messages: Array<Record<string, any>> }) => {
      return ledger(event.sessionID).then((entry) => {
        if (!entry) return
        // "initial" thins the completed history but keeps the in-flight turn
        // (last user prompt onward) functional. "recent" thins everything before
        // the stored prompt anchor. Anchor absent from this request means the
        // visible window starts after it — thin nothing, not everything.
        const boundary =
          entry.mode === "initial"
            ? event.messages.findLastIndex((message) => message.role === "user")
            : event.messages.findIndex((message) => message.id === entry.anchor)
        const limit = boundary === -1 ? (entry.mode === "initial" ? event.messages.length : 0) : boundary
        for (const message of event.messages.slice(0, limit)) {
          if (!Array.isArray(message.content)) continue
          for (const part of message.content) {
            if (typeof part !== "object" || part === null) continue
            if (part.providerExecuted === true) continue
            if (part.type === "tool-call") {
              if (!KEEP_INPUT.has(part.name)) {
                part.input = thinInput(part.input)
              }
              continue
            }
            if (part.type === "tool-result") {
              if (KEEP_RESULT.has(part.name)) continue
              const original = partTextLength(part.result)
              part.result = {
                type: "text",
                value: `[context-prune: ${String(part.name)} result thinned (~${original} chars) — rerun the tool if the full output is needed]`,
              }
              continue
            }
            if (part.type === "text" && typeof part.text === "string" && part.text.includes("<skill_content")) {
              part.text = thinnedSkill(part.text)
            }
          }
        }
      })
    }

    for (const name of ["context", "compaction", "generate", "title"] as const) {
      await ctx.session.hook(name, (event) => thin(event))
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "ctx",
        description: "Session context-window controls for long agentic runs",
      })
      editor.add({
        name: "context-prune",
        options: { namespace: "ctx", codemode: true, pinned: true },
        description: [
          "Thin prior tool call inputs and outputs in this session's model context,",
          "persistent from the next model call onward. User prompts and assistant",
          "text are kept; read/write/edit calls stay verbatim (their inputs carry",
          "the file bodies) and delegate results are kept — everything else",
          "collapses: results to stubs, inputs to shape-preserving truncations.",
          "mode 'recent' thins only history above your last user prompt; mode",
          "'initial' thins all completed history before the current prompt.",
          "Durable transcript is untouched.",
        ].join(" "),
        input: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["recent", "initial"],
              description:
                "'recent': anchor at your last user prompt — thin everything above it. " +
                "'initial': thin the whole visible history, re-anchoring on the initial prompt.",
            },
          },
          required: ["mode"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const { mode } = input as { mode: Mode }
          const data = await ctx.session.context({ sessionID: context.sessionID })
          const users = data.filter((message) => message.type === "user")
          const compacted = data.some((message) => message.type === "compaction")
          const anchor = users.at(-1)?.id ?? null
          // "recent" stores the anchor for future calls; "initial" re-derives the
          // last user prompt per request. The estimate stops at the same
          // boundary either mode will thin up to.
          const boundaryId = anchor

          let parts = 0
          let chars = 0
          for (const message of data) {
            if (boundaryId !== null && message.id === boundaryId) break
            if (message.type !== "assistant") continue
            for (const part of message.content ?? []) {
              if (part?.type !== "tool" || part.executed === true) continue
              parts += 1
              const state = part.state
              if (state.status === "completed" && Array.isArray(state.content)) {
                chars += state.content.reduce(
                  (n: number, item) => n + (item.type === "text" ? item.text.length : 0),
                  0,
                )
              }
            }
          }

          const entry: Ledger = { mode, anchor: mode === "recent" ? anchor : null, at: new Date().toISOString() }
          await ctx.storage.set(LEDGER_PREFIX + context.sessionID, entry as never)

          const initial = users.at(0)
          const lines = [
            `Context pruned from the next model call onward (mode: "${mode}").`,
            `Ledger: ${parts} tool parts in range, ~${chars} chars of output will collapse to stubs.`,
            `Anchor: ${mode === "recent" ? `your last user prompt (${anchor ?? "none found — nothing thins"})` : "all completed history before the current prompt"}.`,
            `Kept intact: user prompts, assistant text, read/write/edit call inputs, and delegate results.`,
            `Skill bodies were reduced — re-invoke any skill (@skill-name) you still need.`,
            `Re-anchor on the zoomed-out hierarchy: your prompts and your assistant messages are now the map; stubbed tool outputs can be re-fetched on demand.`,
          ]
          if (mode === "initial") {
            if (initial !== undefined && !compacted) {
              lines.push(`Initial prompt: "${initial.text.slice(0, 240)}"`)
            } else {
              if (initial !== undefined) {
                lines.push(
                  `Earliest visible user prompt (post-compaction): "${initial.text.slice(0, 240)}"`,
                )
              }
              lines.push(
                `The true initial prompt predates the latest compaction and is outside live context.`,
                `To recover earlier user prompts, export the durable transcript for session ${context.sessionID} —`,
                `e.g. inside \`execute\`: run a shell call equivalent to \`opencode export ${context.sessionID}\`,`,
                `or GET /api/session/${context.sessionID}/message?type=user on the host server, then work from`,
                `the recovered prompts.`,
              )
            }
          }
          lines.push(`To undo later, delete storage key "context-prune:${context.sessionID}".`)
          return { content: [{ type: "text" as const, text: lines.join("\n") }] }
        },
      })
    })
  },
} satisfies Plugin.Plugin
