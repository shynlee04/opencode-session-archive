import { describe, expect, test } from "bun:test"
import plugin from "./context-prune.ts"

// Fake host context: captures the registered tool, the session hooks, and the
// durable-context response the tool previews against.
const makeCtx = (durable: any[]) => {
  const storage = new Map<string, unknown>()
  const hooks = new Map<string, (event: any) => Promise<void> | void>()
  const added: any[] = []
  const ctx = {
    storage: {
      get: async (k: string) => storage.get(k),
      set: async (k: string, v: unknown) => void storage.set(k, v),
      remove: async (k: string) => void storage.delete(k),
      scan: async () => ({ entries: [], cursor: undefined }),
    },
    session: {
      hook: async (name: string, cb: any) => {
        hooks.set(name, cb)
        return { dispose: async () => { } }
      },
      context: async () => durable,
    },
    tool: {
      transform: async (cb: (editor: any) => void) => {
        cb({ add: (t: any) => added.push(t), namespace: () => { }, update: () => { }, remove: () => { }, get: () => undefined, list: () => added })
        return { dispose: async () => { } }
      },
      list: async () => added,
      reload: async () => { },
      hook: async () => ({ dispose: async () => { } }),
    },
  }
  return { ctx: ctx as any, storage, hooks, added }
}

const durable = [
  { id: "msg_u1", type: "user", text: "initial ask: build the plugin" },
  {
    id: "msg_a1",
    type: "assistant",
    content: [
      {
        type: "tool",
        id: "call_1",
        name: "shell",
        state: {
          status: "completed",
          input: { command: "git log --oneline" },
          content: [{ type: "text", text: "x".repeat(4000) }],
        },
      },
    ],
  },
  {
    id: "msg_a2",
    type: "assistant",
    content: [
      {
        type: "tool",
        id: "call_2",
        name: "read",
        state: {
          status: "completed",
          input: { path: "/repo/a.ts", offset: 0, limit: 2000 },
          content: [{ type: "text", text: "FILE CONTENTS" }],
        },
      },
    ],
  },
  { id: "msg_u2", type: "user", text: "prune your context please" },
]

const llmMessages = () => [
  { id: "msg_u1", role: "user", content: [{ type: "text", text: "initial ask: build the plugin" }] },
  {
    id: "msg_a1",
    role: "assistant",
    content: [
      { type: "tool-call", id: "call_1", name: "shell", input: { command: `git log --oneline ${"x".repeat(500)}`, timeout: 30 } },
      { type: "tool-result", id: "call_1", name: "shell", result: { type: "text", value: "x".repeat(4000) } },
      { type: "tool-result", id: "call_d", name: "subagent", result: { type: "text", value: "DELEGATE REPORT" } },
    ],
  },
  {
    id: "msg_a2",
    role: "assistant",
    content: [
      { type: "tool-call", id: "call_2", name: "edit", input: { path: "/repo/a.ts", oldString: "const a = 1\n".repeat(600), newString: "const a = 2\n".repeat(600) } },
      { type: "tool-result", id: "call_2", name: "read", result: { type: "text", value: "FILE CONTENTS" } },
    ],
  },
  { id: "msg_u2", role: "user", content: [{ type: "text", text: "prune your context please" }] },
]

const toolCtx = { sessionID: "ses_1", agent: "build", messageID: "msg_a9", id: "call_9", signal: new AbortController().signal, progress: async () => { } }

describe("context-prune", () => {
  test("registers one codemode tool under the ctx namespace", async () => {
    const { ctx, added } = makeCtx(durable)
    await plugin.setup(ctx)
    expect(added).toHaveLength(1)
    expect(added[0].name).toBe("context-prune")
    expect(added[0].options).toMatchObject({ namespace: "ctx", codemode: true })
  })

  test("mode recent anchors at the last user prompt and thins only above it", async () => {
    const { ctx, storage, hooks, added } = makeCtx(durable)
    await plugin.setup(ctx)
    const result = await added[0].execute({ mode: "recent" }, toolCtx)
    const out = result.content[0].text
    expect(storage.get("context-prune:ses_1")).toMatchObject({ mode: "recent", anchor: "msg_u2" })
    expect(out).toContain('mode: "recent"')
    expect(out).toContain("re-invoke any skill")

    const event = { sessionID: "ses_1", messages: llmMessages() }
    await hooks.get("context")!(event)

    const [u1, a1, a2, u2] = event.messages as any[]
    expect(u1.content[0].text).toBe("initial ask: build the plugin")
    expect(a1.content[1].result.value).toContain("context-prune")
    expect(a1.content[1].result.value).toContain("thinned")
    // Thinned inputs keep their argument shape: every key survives, long
    // strings truncate in place, and no marker key appears for the model to copy.
    expect(a1.content[0].input.command).toMatch(/^git log --oneline /)
    expect(a1.content[0].input.command).toContain("context-prune")
    expect(a1.content[0].input.timeout).toBe(30)
    expect(JSON.stringify(a1.content[0].input)).not.toContain("__thinned")
    // Delegate results are not re-derivable — kept verbatim.
    expect(a1.content[2].result.value).toBe("DELEGATE REPORT")
    // read results ARE re-fetchable, so they thin like everything else.
    expect(a2.content[1].result.value).toContain("context-prune")
    // read/write/edit call inputs are the payload — verbatim, never stubbed.
    expect(a2.content[0].input).toEqual({
      path: "/repo/a.ts",
      oldString: "const a = 1\n".repeat(600),
      newString: "const a = 2\n".repeat(600),
    })
    expect(u2.content[0].text).toBe("prune your context please")
  })

  test("mode recent thins nothing when the anchor is absent from the request", async () => {
    const { ctx, storage, hooks } = makeCtx(durable)
    await plugin.setup(ctx)
    // A stored anchor that never appears in the request means the visible
    // window starts after it — thinning must not touch the live context.
    storage.set("context-prune:ses_1", { mode: "recent", anchor: "msg_gone", at: "now" })
    const event = { sessionID: "ses_1", messages: llmMessages() }
    await hooks.get("context")!(event)
    const a1 = event.messages[1] as any
    expect(a1.content[0].input.command).toContain("x".repeat(400))
    expect(a1.content[1].result.value).toBe("x".repeat(4000))
    expect(a1.content[2].result.value).toBe("DELEGATE REPORT")
  })

  test("mode initial thins the whole visible history", async () => {
    const { ctx, storage, hooks, added } = makeCtx(durable)
    await plugin.setup(ctx)
    const result = await added[0].execute({ mode: "initial" }, toolCtx)
    expect(storage.get("context-prune:ses_1")).toMatchObject({ mode: "initial", anchor: null })
    expect(result.content[0].text).toContain('Initial prompt: "initial ask: build the plugin"')

    const event = { sessionID: "ses_1", messages: llmMessages() }
    await hooks.get("context")!(event)
    // Boundary is the last user prompt: history before it thins, the current
    // turn stays intact.
    expect((event.messages[1].content[1] as any).result.value).toContain("thinned")
    expect((event.messages[2].content[1] as any).result.value).toContain("thinned")
    expect((event.messages[3].content[0] as any).text).toBe("prune your context please")
  })

  test("compacted session reports the transcript-recovery path", async () => {
    const compacted = [{ id: "msg_c0", type: "compaction" }, ...durable.slice(1)]
    const { ctx, added } = makeCtx(compacted)
    await plugin.setup(ctx)
    const result = await added[0].execute({ mode: "initial" }, toolCtx)
    const out = result.content[0].text
    expect(out).toContain("predates the latest compaction")
    expect(out).toContain("ses_1")
    expect(out).toContain("execute")
  })

  test("skill blobs thin while provider-executed parts survive", async () => {
    const { ctx, storage, hooks } = makeCtx(durable)
    await plugin.setup(ctx)
    storage.set("context-prune:ses_1", { mode: "initial", anchor: null, at: "now" })
    const event = {
      sessionID: "ses_1",
      messages: [
        {
          id: "msg_u0",
          role: "user",
          content: [{ type: "text", text: 'do it <skill_content name="ultra-mode">HUGE</skill_content> tail' }],
        },
        {
          id: "msg_a0",
          role: "assistant",
          content: [
            { type: "tool-result", id: "call_g", name: "google_search", providerExecuted: true, result: { type: "text", value: "PROVIDER" } },
            { type: "tool-result", id: "call_b", name: "bash", result: { type: "text", value: "BIG" } },
          ],
        },
        { id: "msg_k", role: "assistant", content: [{ type: "compaction", provider: "p", text: "summary" }] },
        { id: "msg_now", role: "user", content: [{ type: "text", text: "current prompt" }] },
      ],
    }
    await hooks.get("context")!(event)
    const [u, a, k, now] = event.messages as any[]
    expect(u.content[0].text).toContain('skill "ultra-mode" body thinned')
    expect(u.content[0].text).toContain("do it ")
    expect(u.content[0].text).toContain(" tail")
    expect(a.content[0].result.value).toBe("PROVIDER")
    expect(a.content[1].result.value).toContain("thinned")
    expect(k.content[0].type).toBe("compaction")
    expect(now.content[0].text).toBe("current prompt")
  })
})
