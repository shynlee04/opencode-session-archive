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

describe("TWM-02: REQ-SUB-03 & REQ-SUB-04", () => {
  test("REQ-SUB-04: normalizeUser sinks human prompt text (data.text and data.content parts) into blobs and emits text_ref", () => {
    const { sink, blobs } = collect()
    const res1 = normalizeMessage(
      row("user", {
        time: { created: 1000 },
        text: "Look at my prompting throughout and continue from Wave 2 slice",
      }),
      sink,
      null,
    )
    if (res1.record.kind !== "user") throw new Error("expected user")
    const expectedSha1 = sha256hex("Look at my prompting throughout and continue from Wave 2 slice")
    expect(res1.record.text).toBe("Look at my prompting throughout and continue from Wave 2 slice")
    expect((res1.record as unknown as { text_ref?: string }).text_ref).toBe(`blob:${expectedSha1}`)
    expect(blobs.get(expectedSha1)).toBe("Look at my prompting throughout and continue from Wave 2 slice")

    const res2 = normalizeMessage(
      row("user", {
        time: { created: 1001 },
        content: [
          { type: "text", text: "Part one of prompt" },
          { type: "text", text: "Part two of prompt" },
        ],
      }),
      sink,
      1,
    )
    if (res2.record.kind !== "user") throw new Error("expected user")
    const expectedText2 = "Part one of prompt\nPart two of prompt"
    const expectedSha2 = sha256hex(expectedText2)
    expect(res2.record.text).toBe(expectedText2)
    expect((res2.record as unknown as { text_ref?: string }).text_ref).toBe(`blob:${expectedSha2}`)
    expect(blobs.get(expectedSha2)).toBe(expectedText2)
  })

  test("REQ-SUB-04: normalizes standalone skill and shell messages and populates file_read_ledger & skill_load_ledger", async () => {
    const normMod = (await import("../src/archive/normalize.ts")) as Record<string, unknown>
    const extractSessionLedgers = normMod.extractSessionLedgers as (
      rows: readonly MessageRow[],
      sink: (text: string) => string,
    ) => {
      fileReads: Array<Record<string, unknown>>
      skillLoads: Array<Record<string, unknown>>
      fileTouches: Array<Record<string, unknown>>
    }
    expect(typeof extractSessionLedgers).toBe("function")

    const { sink, blobs } = collect()
    const skillMsg = row(
      "skill",
      {
        id: "sk_tdd",
        name: "tdd",
        description: "Test-driven development",
        text: "# TDD Skill Body\nRed -> Green -> Refactor",
      },
      { id: "msg_sk1", seq: 1 },
    )
    const shellMsg = row(
      "shell",
      {
        command: "bun test",
        cwd: "/repo",
        exitCode: 0,
        output: "12 pass, 0 fail",
      },
      { id: "msg_sh1", seq: 2 },
    )
    const readAndSkillAssistant = row(
      "assistant",
      {
        time: { created: 100, completed: 200 },
        agent: "build",
        content: [
          {
            type: "tool",
            id: "call_read_1",
            name: "read",
            state: {
              status: "completed",
              input: { filePath: "/repo/src/archive/normalize.ts", offset: 1, limit: 50 },
              content: [{ type: "text", text: "export function normalizeMessage() {}\n" }],
            },
          },
          {
            type: "tool",
            id: "call_skill_2",
            name: "skill",
            state: {
              status: "completed",
              input: { name: "ultra-mode" },
              content: [{ type: "text", text: "<skill_content name=\"ultra-mode\"># Ultra mode body</skill_content>" }],
            },
          },
        ],
      },
      { id: "msg_asst_3", seq: 3 },
    )
    const editAssistant = row(
      "assistant",
      {
        time: { created: 201, completed: 300 },
        agent: "build",
        content: [
          {
            type: "tool",
            id: "call_edit_1",
            name: "edit",
            state: {
              status: "completed",
              input: { filePath: "/repo/src/archive/normalize.ts", oldString: "a", newString: "b" },
              content: [{ type: "text", text: "Edited /repo/src/archive/normalize.ts" }],
            },
          },
        ],
      },
      { id: "msg_asst_4", seq: 4 },
    )

    const normSkill = normalizeMessage(skillMsg, sink, null)
    expect(normSkill.record.kind).toBe("skill")
    const normShell = normalizeMessage(shellMsg, sink, 1)
    expect(normShell.record.kind).toBe("shell")
    expect(blobs.has(sha256hex("12 pass, 0 fail"))).toBe(true)

    const ledgers = extractSessionLedgers([skillMsg, shellMsg, readAndSkillAssistant, editAssistant], sink)
    expect(ledgers.fileReads).toHaveLength(1)
    expect(ledgers.fileReads[0]).toMatchObject({
      session_id: "ses_1",
      path: "/repo/src/archive/normalize.ts",
      call_id: "call_read_1",
      read_seq: 3,
      line_range: "L1-L50",
      start_line: 1,
      end_line: 50,
      blob_sha: sha256hex("export function normalizeMessage() {}\n"),
      read_blob_sha: sha256hex("export function normalizeMessage() {}\n"),
      staleness_status: "STALE",
    })

    expect(ledgers.skillLoads).toHaveLength(2)
    const byName = new Map(ledgers.skillLoads.map((s) => [s.skill_name as string, s]))
    expect(byName.get("tdd")).toMatchObject({
      session_id: "ses_1",
      skill_name: "tdd",
      load_seq: 1,
      loaded_seq: 1,
      blob_sha: sha256hex("# TDD Skill Body\nRed -> Green -> Refactor"),
      skill_blob_sha: sha256hex("# TDD Skill Body\nRed -> Green -> Refactor"),
      status: "ACTIVE — DO NOT RE-INVOKE",
    })
    expect(byName.get("ultra-mode")).toMatchObject({
      session_id: "ses_1",
      skill_name: "ultra-mode",
      load_seq: 3,
      loaded_seq: 3,
      status: "ACTIVE — DO NOT RE-INVOKE",
    })
  })

  test("REQ-SUB-03: segmentChildStops and normalizeDelegationTurns preserve multi-stop turns without overwriting Turn 0", async () => {
    const normMod = (await import("../src/archive/normalize.ts")) as Record<string, unknown>
    const segmentChildStops = normMod.segmentChildStops as (
      messages: readonly MessageRow[],
      idleOutcome: string | null,
    ) => Array<Record<string, unknown>>
    const normalizeDelegationTurns = normMod.normalizeDelegationTurns as (
      parentSessionId: string,
      parentMessages: readonly MessageRow[],
      childSessions: readonly Record<string, unknown>[],
      childMessagesById: ReadonlyMap<string, readonly MessageRow[]>,
      kvByChildId: ReadonlyMap<string, Record<string, unknown>>,
      sinkText: (text: string) => string,
    ) => Array<Record<string, unknown>>

    expect(typeof segmentChildStops).toBe("function")
    expect(typeof normalizeDelegationTurns).toBe("function")

    const childMessages: MessageRow[] = [
      row("user", { text: "Turn 0 spawn prompt" }, { id: "msg_c1", session_id: "ses_child_multi", seq: 1 }),
      row(
        "assistant",
        {
          content: [
            { type: "text", text: "Turn 0 completed work" },
            { type: "tool", id: "t1", name: "read", state: { status: "completed", content: [{ type: "text", text: "ok" }] } },
          ],
        },
        { id: "msg_c2", session_id: "ses_child_multi", seq: 2 },
      ),
      row("idle", { outcome: "succeeded" }, { id: "msg_c3", session_id: "ses_child_multi", seq: 3 }),
      row("user", { text: "Turn 1 send follow-up" }, { id: "msg_c4", session_id: "ses_child_multi", seq: 4 }),
      row(
        "assistant",
        {
          content: [
            { type: "text", text: "Turn 1 follow-up response" },
            { type: "tool", id: "t2", name: "edit", state: { status: "completed", content: [{ type: "text", text: "ok" }] } },
          ],
        },
        { id: "msg_c5", session_id: "ses_child_multi", seq: 5 },
      ),
      row("idle", { outcome: "succeeded" }, { id: "msg_c6", session_id: "ses_child_multi", seq: 6 }),
    ]

    const stops = segmentChildStops(childMessages, "succeeded")
    expect(stops).toHaveLength(2)
    expect(stops[0]).toMatchObject({
      turn_index: 0,
      start_seq: 1,
      end_seq: 3,
      start_message_id: "msg_c1",
      end_message_id: "msg_c3",
    })
    expect(stops[1]).toMatchObject({
      turn_index: 1,
      start_seq: 4,
      end_seq: 6,
      start_message_id: "msg_c4",
      end_message_id: "msg_c6",
    })

    const { sink } = collect()
    const parentMessages: MessageRow[] = [
      row(
        "assistant",
        {
          content: [
            {
              type: "tool",
              id: "call_spawn_0",
              name: "hivemind-delegate",
              state: {
                status: "completed",
                input: { harness: "antigravity", agent: "implementer", prompt: "Turn 0 spawn prompt" },
                metadata: { sessionID: "ses_child_multi" },
              },
            },
          ],
        },
        { id: "msg_p1", session_id: "ses_parent", seq: 1 },
      ),
      row(
        "assistant",
        {
          content: [
            {
              type: "tool",
              id: "call_send_1",
              name: "hivemind-delegate",
              state: {
                status: "completed",
                input: { harness: "antigravity", sessionID: "ses_child_multi", prompt: "Turn 1 send follow-up" },
                metadata: { sessionID: "ses_child_multi" },
              },
            },
          ],
        },
        { id: "msg_p2", session_id: "ses_parent", seq: 2 },
      ),
    ]

    const turns = normalizeDelegationTurns(
      "ses_parent",
      parentMessages,
      [
        {
          id: "ses_child_multi",
          project_id: "proj_1",
          parent_id: "ses_parent",
          directory: "/repo",
          title: "Antigravity child",
          agent: "implementer",
          model: { id: "gemini-3.1-pro", providerID: "antigravity-native" },
          idle_outcome: "succeeded",
          time_created: 1000,
          time_updated: 2000,
        },
      ],
      new Map([["ses_child_multi", childMessages]]),
      new Map(),
      sink,
    )
    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      parent_session_id: "ses_parent",
      call_id: "call_spawn_0",
      turn_index: 0,
      child_session_id: "ses_child_multi",
      mode: "spawn",
      harness: "antigravity",
      start_seq: 1,
      end_seq: 3,
      reported_outcome: "succeeded",
    })
    expect(turns[1]).toMatchObject({
      parent_session_id: "ses_parent",
      call_id: "call_send_1",
      turn_index: 1,
      child_session_id: "ses_child_multi",
      mode: "send",
      harness: "antigravity",
      start_seq: 4,
      end_seq: 6,
      reported_outcome: "succeeded",
    })
  })

  test("REQ-SUB-03: classifyMessagesOutcome flags 100% of false-positive succeeded turns (tool_error_inside & blocked_in_text)", async () => {
    const normMod = (await import("../src/archive/normalize.ts")) as Record<string, unknown>
    const classifyMessagesOutcome = normMod.classifyMessagesOutcome as (
      messages: readonly MessageRow[],
      fallbackReportedOutcome: string | null,
    ) => {
      reported_outcome: string | null
      verified_outcome: string
      blocker_summary: string | null
      tool_error_count: number
    }
    expect(typeof classifyMessagesOutcome).toBe("function")

    const toolErrorCase = classifyMessagesOutcome(
      [
        row("assistant", {
          content: [
            { type: "text", text: "Finished the task." },
            {
              type: "tool",
              id: "call_err",
              name: "read",
              state: { status: "error", error: { message: "ENOENT: no such file" } },
            },
          ],
        }),
        row("idle", { outcome: "succeeded" }),
      ],
      "succeeded",
    )
    expect(toolErrorCase.reported_outcome).toBe("succeeded")
    expect(toolErrorCase.verified_outcome).toBe("tool_error_inside")
    expect(toolErrorCase.tool_error_count).toBe(1)
    expect(toolErrorCase.blocker_summary).toContain("ENOENT")

    const blockerCases: ReadonlyArray<readonly [string, string]> = [
      ["The MCP server context7 timed out after 30000ms", "context7 timed out"],
      ["The MCP server tavily failed to initialize", "failed to initialize"],
      ["The tavily-search MCP tool failed with an error", "MCP tool failed"],
      ["Error: read lease violation on /etc/hosts", "read lease violation"],
      ["Access denied: /outside/path is outside allowed directories", "Access denied"],
      ["**BLOCKED**: missing authorization for production deploy", "BLOCKED"],
    ]

    for (const [text, expectedSnippet] of blockerCases) {
      const res = classifyMessagesOutcome(
        [
          row("assistant", { content: [{ type: "text", text }] }),
          row("idle", { outcome: "succeeded" }),
        ],
        "succeeded",
      )
      expect(res.reported_outcome).toBe("succeeded")
      expect(res.verified_outcome).toBe("blocked_in_text")
      expect(res.blocker_summary).toContain(expectedSnippet)
    }
  })
})

