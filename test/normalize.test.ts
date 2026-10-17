import { describe, expect, test } from "bun:test"
import { normalizeMessage, sha256hex } from "../src/archive/normalize.ts"
import type { MessageRow } from "../src/archive/types.ts"

const collect = () => {
  const blobs = new Map<string, string>()
  return {
    blobs,
    sink: (text: string) => {
      const sha = sha256hex(text)
      if (!blobs.has(sha)) blobs.set(sha, text)
      return `blob:${sha}`
    },
  }
}

const row = (type: string, data: unknown, over: Partial<MessageRow> = {}): MessageRow => ({
  id: over.id ?? "msg_1",
  session_id: over.session_id ?? "ses_1",
  type,
  seq: over.seq ?? 1,
  time_created: over.time_created ?? 1000,
  time_updated: over.time_updated ?? 1000,
  data,
})

describe("normalize: user", () => {
  test("keeps text, agent names only, files and skills blobbed", () => {
    const { sink, blobs } = collect()
    const fileData = Buffer.from("hello file").toString("base64")
    const { record, delegations } = normalizeMessage(
      row("user", {
        time: { created: 1000 },
        text: "hello @general",
        agents: [{ name: "general", mention: { start: 6, end: 14, text: "@general" } }],
        files: [{ data: fileData, mime: "text/plain", source: "paste", name: "a.txt", mention: { start: 0, end: 1, text: "@a" } }],
        skills: [{ id: "sk1", name: "tdd", text: "BIG SKILL BODY", mention: { start: 0, end: 9, text: "@tdd" } }],
      }),
      sink,
      null,
    )
    expect(delegations).toHaveLength(0)
    if (record.kind !== "user") throw new Error("expected user")
    expect(record.text).toBe("hello @general")
    expect(record.agents).toEqual(["general"])
    expect(record.files).toHaveLength(1)
    const f = record.files[0]
    expect(f).toMatchObject({ name: "a.txt", mime: "text/plain", source: "paste" })
    expect(f.data_ref).toBe(`blob:${sha256hex(fileData)}`)
    expect(blobs.get(sha256hex(fileData))).toBe(fileData)
    expect(record.skills[0]).toMatchObject({ id: "sk1", name: "tdd" })
    expect(record.skills[0].text_ref).toBe(`blob:${sha256hex("BIG SKILL BODY")}`)
    expect(JSON.stringify(record)).not.toContain("mention")
  })
})

describe("normalize: assistant", () => {
  const assistantData = {
    time: { created: 500, streamed: 800, completed: 900 },
    agent: "build",
    model: { id: "gpt-6.1-sol", providerID: "openai", variant: "max" },
    finish: "tool-calls",
    rawFinish: "tool-calls",
    cost: 0.01,
    tokens: { input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 2 } },
    providerState: { responseId: "resp_x" },
    content: [
      { type: "text", text: "working on it" },
      {
        type: "reasoning",
        text: "let me think",
        state: { itemId: "rs_1", reasoningEncryptedContent: "ENCRYPTED-XYZ", reasoningField: "x" },
      },
      {
        type: "tool",
        id: "call_1",
        name: "shell",
        executed: false,
        providerState: { ref: "x" },
        time: { created: 501, ran: 600, completed: 800 },
        state: {
          status: "completed",
          input: { command: "ls", notes: "n".repeat(5000) },
          content: [{ type: "text", text: "out" }],
          metadata: { truncated: true, outputPath: "/tmp/out.txt" },
        },
      },
    ],
  }

  test("maps fields, drops provider state, keeps reasoning as blob ref", () => {
    const { sink } = collect()
    const { record } = normalizeMessage(row("assistant", assistantData), sink, 3)
    if (record.kind !== "assistant") throw new Error("expected assistant")
    expect(record.agent).toBe("build")
    expect(record.model).toEqual({ id: "gpt-6.1-sol", providerID: "openai", variant: "max" })
    expect(record.finish).toBe("tool-calls")
    expect(record.cost).toBe(0.01)
    expect(record.tokens).toEqual({ input: 10, output: 20, reasoning: 3, cache: { read: 4, write: 2 } })
    expect(record.time).toEqual({ created: 500, completed: 900 })
    expect(record.incomplete).toBe(false)
    expect(record.parts[0]).toEqual({ type: "text", text: "working on it" })
    const reasoning = record.parts[1]
    if (reasoning.type !== "reasoning") throw new Error("expected reasoning")
    expect(reasoning.chars).toBe("let me think".length)
    expect(reasoning.text_ref).toBe(`blob:${sha256hex("let me think")}`)
    expect(reasoning.encrypted_bytes).toBe("ENCRYPTED-XYZ".length)
    const json = JSON.stringify(record)
    expect(json).not.toContain("providerState")
    expect(json).not.toContain("rawFinish")
    expect(json).not.toContain("executed")
    expect(json).not.toContain("itemId")
    expect(json).not.toContain("ENCRYPTED-XYZ")
  })

  test("incomplete assistant has null completed time", () => {
    const { sink } = collect()
    const data = { ...assistantData, time: { created: 500, streamed: 800 }, content: [] }
    const { record } = normalizeMessage(row("assistant", data), sink, null)
    if (record.kind !== "assistant") throw new Error("expected assistant")
    expect(record.incomplete).toBe(true)
    expect(record.time.completed).toBeNull()
  })

  test("long tool input strings and outputs become blob refs", () => {
    const { sink } = collect()
    const { record } = normalizeMessage(row("assistant", assistantData), sink, null)
    if (record.kind !== "assistant") throw new Error("expected assistant")
    const tool = record.parts[2]
    if (tool.type !== "tool") throw new Error("expected tool")
    const input = tool.input as Record<string, unknown>
    expect(input.command).toBe("ls")
    expect(input.notes).toBe(`blob:${sha256hex("n".repeat(5000))}`)
    expect(tool.call_id).toBe("call_1")
    expect(tool.status).toBe("completed")
    expect(tool.time).toEqual({ created: 501, ran: 600, completed: 800 })
    expect(tool.truncated).toBe(true)
    expect(tool.output_path).toBe("/tmp/out.txt")
    expect(tool.child_session_id).toBeNull()
    expect(tool.output).toBe("out")
    expect("output_ref" in tool).toBe(false)
  })

  test("tool output over 4096 chars keeps preview plus output_ref", () => {
    const { sink } = collect()
    const big = "O".repeat(5000)
    const data = {
      ...assistantData,
      content: [
        {
          type: "tool",
          id: "call_big",
          name: "read",
          state: { status: "completed", input: { path: "/x" }, content: [{ type: "text", text: big }] },
        },
      ],
    }
    const { record } = normalizeMessage(row("assistant", data), sink, null)
    if (record.kind !== "assistant") throw new Error()
    const tool = record.parts[0]
    if (tool.type !== "tool") throw new Error()
    expect(tool.output).toBe(big.slice(0, 4096))
    expect(tool.output_ref).toBe(`blob:${sha256hex(big)}`)
  })

  test.each(["subagent", "delegate-devin", "hivemind-delegate"] as const)(
    "%s sets child_session_id and emits a delegation fact",
    (name) => {
      const { sink } = collect()
      const input: Record<string, unknown> = { agent: "general", description: "d", background: true, prompt: "do it" }
      if (name === "hivemind-delegate") input.harness = "devin"
      const data = {
        ...assistantData,
        content: [
          {
            type: "tool",
            id: "call_d",
            name,
            state: {
              status: "completed",
              input,
              content: [{ type: "text", text: "report" }],
              metadata: { sessionID: "ses_child" },
            },
          },
        ],
      }
      const { record, delegations } = normalizeMessage(row("assistant", data, { seq: 7 }), sink, null)
      if (record.kind !== "assistant") throw new Error()
      const tool = record.parts[0]
      if (tool.type !== "tool") throw new Error()
      expect(tool.child_session_id).toBe("ses_child")
      expect(delegations).toHaveLength(1)
      expect(delegations[0]).toMatchObject({
        call_id: "call_d",
        child_session_id: "ses_child",
        tool: name,
        agent: "general",
        mode: "spawn",
        background: true,
        description: "d",
        prompt_ref: `blob:${sha256hex("do it")}`,
        seq: 7,
      })
      expect(delegations[0].harness).toBe(name === "hivemind-delegate" ? "devin" : null)
    },
  )

  test("input.sessionID makes delegation mode 'continue'", () => {
    const { sink } = collect()
    const data = {
      ...assistantData,
      content: [
        {
          type: "tool",
          id: "call_c",
          name: "subagent",
          state: {
            status: "completed",
            input: { agent: "general", description: "d", prompt: "cont", sessionID: "ses_child" },
            content: [],
            metadata: { sessionID: "ses_child" },
          },
        },
      ],
    }
    const { delegations } = normalizeMessage(row("assistant", data), sink, null)
    expect(delegations[0].mode).toBe("continue")
  })
})

describe("normalize: context (synthetic/system)", () => {
  test("synthetic keeps source, description, instruction paths, blobbed text", () => {
    const { sink } = collect()
    const { record } = normalizeMessage(
      row("synthetic", {
        time: { created: 1 },
        text: "shell finished",
        description: "the command",
        metadata: {
          source: "shell",
          shellID: "sh_1",
          instruction: { paths: ["/repo/AGENTS.md"] },
        },
      }),
      sink,
      null,
    )
    if (record.kind !== "context") throw new Error()
    expect(record.source).toBe("shell")
    expect(record.description).toBe("the command")
    expect(record.paths).toEqual(["/repo/AGENTS.md"])
    expect(record.text_ref).toBe(`blob:${sha256hex("shell finished")}`)
  })

  test("system falls back to notice then type for source", () => {
    const { sink } = collect()
    const a = normalizeMessage(row("system", { time: {}, text: "x", metadata: { notice: "instructions" } }), sink, null)
    if (a.record.kind !== "context") throw new Error()
    expect(a.record.source).toBe("instructions")
    expect(a.record.paths).toEqual([])
    const b = normalizeMessage(row("synthetic", { time: {}, text: "y" }), sink, null)
    if (b.record.kind !== "context") throw new Error()
    expect(b.record.source).toBe("synthetic")
  })
})

describe("normalize: compaction", () => {
  test("keeps inline summary, covers previous seq", () => {
    const { sink } = collect()
    const data = {
      time: { created: 1 },
      status: "completed",
      reason: "auto",
      model: { id: "m", providerID: "p" },
      providerState: { responseId: "r" },
      summary: "## Objective\nstuff",
      recent: "recent context",
      tokens: { input: 100, output: 5, reasoning: 0, cache: { read: 1, write: 0 } },
    }
    const { record } = normalizeMessage(row("compaction", data, { seq: 40 }), sink, 39)
    if (record.kind !== "compaction") throw new Error()
    expect(record).toMatchObject({
      reason: "auto",
      status: "completed",
      summary: "## Objective\nstuff",
      recent: "recent context",
      covers_through_seq: 39,
    })
    expect(record.tokens).toEqual({ input: 100, output: 5, reasoning: 0, cache: { read: 1, write: 0 } })
    expect(JSON.stringify(record)).not.toContain("responseId")
  })
})

describe("normalize: boundary", () => {
  test.each([
    ["idle", { time: { created: 1 }, outcome: "succeeded" }, { outcome: "succeeded" }],
    ["agent-switched", { time: { created: 1 }, agent: "ultra", previous: "build" }, { agent: "ultra", previous: "build" }],
    [
      "model-switched",
      { time: { created: 1 }, model: { id: "m2", providerID: "p2", variant: "high" }, previous: { id: "m1", providerID: "p1" } },
      { model: { id: "m2", providerID: "p2", variant: "high" } },
    ],
    [
      "location-switched",
      {
        time: { created: 1 },
        location: { directory: "/w", projectID: "p", subpath: "" },
        projectID: "p",
        subpath: "",
        previous: { location: { directory: "/old", projectID: "p", subpath: "" }, projectID: "p", subpath: "" },
      },
      { projectID: "p", subpath: "", location: { directory: "/w", projectID: "p", subpath: "" } },
    ],
  ] as const)("%s → boundary record with subtype and fields", (type, data, match) => {
    const { sink } = collect()
    const { record } = normalizeMessage(row(type, data), sink, null)
    if (record.kind !== "boundary") throw new Error()
    expect(record.subtype).toBe(type)
    expect(record).toMatchObject(match)
  })
})

describe("normalize: unknown", () => {
  test("unrecognized type is preserved with raw_type and data", () => {
    const { sink } = collect()
    const { record } = normalizeMessage(row("weird-new-type", { time: {}, something: 1 }), sink, null)
    if (record.kind !== "unknown") throw new Error()
    expect(record.raw_type).toBe("weird-new-type")
    expect(record.data).toEqual({ time: {}, something: 1 })
  })
})
