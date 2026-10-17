import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs"
import path from "node:path"
import { persist, sqliteSource } from "../src/archive/index.ts"
import { laneOf, sessionRelDir } from "../src/archive/layout.ts"
import type { ArchiveRecord, SessionHeader } from "../src/archive/types.ts"
import { addMessage, addProject, addSession, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"

let dir: string
let dbPath: string
let projectRoot: string

const readJsonl = (file: string): ArchiveRecord[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ArchiveRecord)

const assistantToolMsg = (
  sessionID: string,
  seq: number,
  tool: { id: string; name: string; input: Record<string, unknown>; child?: string },
) =>
  addMessage(db, {
    id: `msg_${tool.id}`,
    session_id: sessionID,
    type: "assistant",
    seq,
    data: {
      time: { created: 500, completed: 900 },
      agent: "build",
      model: { id: "gpt-6.1-sol", providerID: "openai" },
      finish: "tool-calls",
      tokens: { input: 10, output: 20 },
      content: [
        {
          type: "tool",
          id: tool.id,
          name: tool.name,
          time: { created: 501, ran: 600, completed: 800 },
          state: {
            status: "completed",
            input: tool.input,
            content: [{ type: "text", text: "report" }],
            metadata: tool.child === undefined ? {} : { sessionID: tool.child },
          },
        },
      ],
    },
  })

let db: Database

beforeEach(() => {
  dir = makeTmpDir()
  projectRoot = dir
  const made = makeDbFile(dir)
  db = made.db
  dbPath = made.dbPath
  addProject(db)

  addSession(db, { id: "ses_root", directory: projectRoot, title: "root" })
  addSession(db, {
    id: "ses_child",
    parent_id: "ses_root",
    directory: path.join(projectRoot, ".worktree", "lane-a"),
    agent: "general",
    time_created: 1100,
  })
  addSession(db, {
    id: "ses_ext",
    parent_id: "ses_root",
    directory: "/elsewhere-ext",
    agent: "general",
    model: { id: "agy-1", providerID: "antigravity-native" },
    time_created: 1200,
  })
  addSession(db, { id: "ses_grand", parent_id: "ses_child", directory: projectRoot, model: { id: "dev-1", providerID: "devin-native" } })
  addSession(db, { id: "ses_orphan", parent_id: "ses_root", directory: projectRoot, agent: "explore", time_created: 1300 })

  addMessage(db, {
    id: "msg_u1",
    session_id: "ses_root",
    type: "user",
    seq: 1,
    data: { time: { created: 1001 }, text: "do the work" },
  })
  assistantToolMsg("ses_root", 2, {
    id: "call_sub",
    name: "subagent",
    input: { agent: "general", description: "child work", prompt: "child prompt" },
    child: "ses_child",
  })
  assistantToolMsg("ses_root", 3, {
    id: "call_hmd",
    name: "hivemind-delegate",
    input: { agent: "general", description: "ext work", prompt: "ext prompt", harness: "antigravity" },
    child: "ses_ext",
  })
  addMessage(db, {
    id: "msg_compact",
    session_id: "ses_root",
    type: "compaction",
    seq: 4,
    data: { time: { created: 1004 }, status: "completed", reason: "auto", summary: "sum", tokens: { input: 50 } },
  })
  addMessage(db, {
    id: "msg_idle",
    session_id: "ses_root",
    type: "idle",
    seq: 5,
    data: { time: { created: 1005 }, outcome: "succeeded" },
  })
  addMessage(db, {
    id: "msg_cu",
    session_id: "ses_child",
    type: "user",
    seq: 1,
    data: { time: { created: 2001 }, text: "child task" },
  })
  assistantToolMsg("ses_child", 2, {
    id: "call_dd",
    name: "delegate-devin",
    input: { agent: "general", description: "grand work", prompt: "grand prompt" },
    child: "ses_grand",
  })
  addMessage(db, {
    id: "msg_eu",
    session_id: "ses_ext",
    type: "user",
    seq: 1,
    data: {
      time: { created: 3001 },
      text: "ext task",
      files: [{ data: "ZmlsZSBib2R5", mime: "text/plain", source: "paste", name: "note.txt" }],
    },
  })
  addMessage(db, {
    id: "msg_ga",
    session_id: "ses_grand",
    type: "assistant",
    seq: 1,
    data: {
      time: { created: 4001, completed: 4002 },
      agent: "general",
      model: { id: "dev-1", providerID: "devin-native" },
      content: [
        { type: "reasoning", text: "grand thinks", state: { reasoningEncryptedContent: "ENC" } },
        { type: "text", text: "done" },
        {
          type: "tool",
          id: "call_big",
          name: "read",
          time: { created: 10, ran: 11, completed: 12 },
          state: {
            status: "completed",
            input: { path: "/x" },
            content: [{ type: "text", text: "O".repeat(5000) }],
            metadata: { truncated: true },
          },
        },
      ],
    },
  })
  addMessage(db, {
    id: "msg_ou",
    session_id: "ses_orphan",
    type: "user",
    seq: 1,
    data: { time: { created: 5001 }, text: "orphan task" },
  })
})

afterEach(() => {
  db.close()
})

const run = (sessionID = "ses_root") => {
  const source = sqliteSource(dbPath)
  try {
    return persist({ sessionID, projectID: PROJECT_ID, projectRoot }, source)
  } finally {
    source.close()
  }
}

const archiveDir = () => path.join(projectRoot, ".session-archive")
const rootDir = () => path.join(archiveDir(), "sessions", "ses_root")

describe("persist: end to end", () => {
  test("writes the full tree, headers, blobs and index", () => {
    const report = run()
    expect(report).toMatchObject({ rootID: "ses_root", sessions: 5, messages: 10, delegations: 4 })
    expect(report.written.length).toBeGreaterThan(0)
    expect(report.unchanged).toBe(0)

    const rootJsonl = path.join(rootDir(), "ses_root.jsonl")
    expect(report.written).toContain("index.sqlite")
    for (const rel of [
      path.join("sessions", "ses_root", "ses_root.jsonl"),
      path.join("sessions", "ses_root", "info.json"),
      path.join("sessions", "ses_root", "subagents", "ses_child", "ses_child.jsonl"),
      path.join("sessions", "ses_root", "subagents", "ses_child", "subagents", "ses_grand", "ses_grand.jsonl"),
      path.join("sessions", "ses_root", "subagents", "ses_ext", "ses_ext.jsonl"),
      path.join("sessions", "ses_root", "subagents", "ses_orphan", "ses_orphan.jsonl"),
    ]) {
      expect(existsSync(path.join(archiveDir(), rel))).toBe(true)
    }

    const [header, ...records] = readJsonl(rootJsonl)
    if (header.kind !== "session") throw new Error("expected session header")
    const h = header as SessionHeader
    expect(h).toMatchObject({
      id: "ses_root",
      root_id: "ses_root",
      depth: 0,
      lane: { kind: "root", path: "" },
      message_count: 5,
    })
    expect(h.children).toEqual(["ses_child", "ses_ext", "ses_orphan"])

    const childHeader = readJsonl(path.join(rootDir(), "subagents", "ses_child", "ses_child.jsonl"))[0]
    if (childHeader.kind !== "session") throw new Error()
    expect(childHeader).toMatchObject({
      parent_id: "ses_root",
      depth: 1,
      lane: { kind: "nested", path: path.join(".worktree", "lane-a") },
      children: ["ses_grand"],
    })
    const extHeader = readJsonl(path.join(rootDir(), "subagents", "ses_ext", "ses_ext.jsonl"))[0]
    if (extHeader.kind !== "session") throw new Error()
    expect(extHeader.lane).toEqual({ kind: "external", path: "/elsewhere-ext" })
    expect(extHeader.harness).toBe("antigravity")
    const grandHeader = readJsonl(
      path.join(rootDir(), "subagents", "ses_child", "subagents", "ses_grand", "ses_grand.jsonl"),
    )[0]
    if (grandHeader.kind !== "session") throw new Error()
    expect(grandHeader.depth).toBe(2)
    expect(grandHeader.harness).toBe("devin")

    const kinds = records.map((r) => r.kind)
    expect(kinds).toEqual(["user", "assistant", "assistant", "compaction", "boundary"])
    const subagentPart = records[1].kind === "assistant" ? records[1].parts[0] : null
    if (subagentPart?.type !== "tool") throw new Error()
    expect(subagentPart.child_session_id).toBe("ses_child")
    for (const record of [header, ...records]) {
      if (record.kind === "session") continue
      expect(record.raw_ref.session_id).toBe("ses_root")
    }

    for (const written of report.written) {
      expect(written.endsWith(".tmp")).toBe(false)
    }
    const blobFiles = report.written.filter((rel) => rel.startsWith(`blobs${path.sep}`))
    expect(blobFiles.length).toBeGreaterThanOrEqual(4)

    const index = new Database(path.join(archiveDir(), "index.sqlite"), { readonly: true })
    const sessions = index.query("SELECT id, depth, lane_kind, harness FROM session WHERE root_id = ? ORDER BY depth, id").all("ses_root")
    expect(sessions).toHaveLength(5)
    const delegations = index
      .query("SELECT call_id, parent_session, child_session, tool, mode, harness FROM delegation WHERE root_id = ? ORDER BY call_id")
      .all("ses_root") as {
        call_id: string
        parent_session: string
        child_session: string
        tool: string | null
        mode: string
        harness: string | null
      }[]
    expect(delegations).toHaveLength(4)
    const byCall = new Map(delegations.map((d) => [d.call_id, d]))
    expect(byCall.get("call_sub")).toMatchObject({
      parent_session: "ses_root",
      child_session: "ses_child",
      tool: "subagent",
      mode: "spawn",
      harness: "opencode",
    })
    expect(byCall.get("call_hmd")).toMatchObject({ child_session: "ses_ext", tool: "hivemind-delegate", harness: "antigravity" })
    expect(byCall.get("call_dd")).toMatchObject({
      parent_session: "ses_child",
      child_session: "ses_grand",
      tool: "delegate-devin",
      harness: "devin",
    })
    expect(byCall.get("parent:ses_orphan")).toMatchObject({
      parent_session: "ses_root",
      child_session: "ses_orphan",
      tool: null,
      mode: "spawn",
      harness: "opencode",
    })
    const messages = index.query("SELECT count(*) AS n FROM message").all() as { n: number }[]
    expect(messages[0].n).toBe(10)
    const toolCalls = index.query("SELECT call_id, name, duration_ms FROM tool_call ORDER BY call_id").all() as {
      call_id: string
      name: string
      duration_ms: number
    }[]
    expect(toolCalls).toHaveLength(4)
    expect(toolCalls[0]).toMatchObject({ call_id: "call_big", name: "read", duration_ms: 1 })
    const compactions = index.query("SELECT session_id, seq, reason, summary_ref FROM compaction").all() as {
      session_id: string
      seq: number
      reason: string
      summary_ref: string
    }[]
    expect(compactions).toHaveLength(1)
    expect(compactions[0].session_id).toBe("ses_root")
    expect(compactions[0].summary_ref.startsWith("blob:")).toBe(true)
    index.close()
  })

  test("second run writes nothing and reports all files unchanged", () => {
    const first = run()
    const second = run()
    expect(second.written).toEqual([])
    expect(second.unchanged).toBe(first.written.length)
  })

  test("every blob reference in transcripts resolves to a written blob file", () => {
    run()
    const refs = new Set<string>()
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith(".jsonl")) {
          for (const record of readJsonl(p)) {
            for (const m of JSON.stringify(record).matchAll(/blob:([0-9a-f]{64})/g)) refs.add(m[1])
          }
        }
      }
    }
    walk(rootDir())
    expect(refs.size).toBeGreaterThan(0)
    for (const sha of refs) {
      expect(existsSync(path.join(archiveDir(), "blobs", `${sha}.txt`))).toBe(true)
    }
  })
})

describe("persist: walk-up", () => {
  test("persisting a descendant archives the whole tree from the root", () => {
    rmSync(archiveDir(), { recursive: true, force: true })
    const report = run("ses_grand")
    expect(report.rootID).toBe("ses_root")
    expect(report.sessions).toBe(5)
    expect(existsSync(path.join(rootDir(), "ses_root.jsonl"))).toBe(true)
    expect(
      existsSync(path.join(rootDir(), "subagents", "ses_child", "subagents", "ses_grand", "ses_grand.jsonl")),
    ).toBe(true)
  })
})

describe("persist: project guard", () => {
  test("throws when the root session belongs to another project", () => {
    const source = sqliteSource(dbPath)
    try {
      expect(() => persist({ sessionID: "ses_root", projectID: "proj_other", projectRoot }, source)).toThrow(
        `session-archive: session ses_root belongs to project ${PROJECT_ID}, not proj_other`,
      )
    } finally {
      source.close()
    }
  })

  test("throws for an unknown session", () => {
    const source = sqliteSource(dbPath)
    try {
      expect(() => persist({ sessionID: "ses_nope", projectID: PROJECT_ID, projectRoot }, source)).toThrow(
        "session-archive: session ses_nope not found",
      )
    } finally {
      source.close()
    }
  })
})

describe("layout: laneOf", () => {
  test.each([
    ["/repo", { kind: "root", path: "" }],
    ["/repo/.worktree/lane", { kind: "nested", path: path.join(".worktree", "lane") }],
    ["/repo/sub", { kind: "nested", path: "sub" }],
    ["/other", { kind: "external", path: "/other" }],
    ["/repo-adjacent", { kind: "external", path: "/repo-adjacent" }],
  ] as const)("directory %s → %j", (directory, lane) => {
    expect(laneOf(directory, "/repo")).toEqual(lane)
  })

  test("sessionRelDir nests children under subagents/", () => {
    expect(sessionRelDir(null, "a")).toBe(path.join("sessions", "a"))
    expect(sessionRelDir(path.join("sessions", "a"), "b")).toBe(path.join("sessions", "a", "subagents", "b"))
  })
})
