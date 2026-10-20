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

describe("TWM-02, TWM-03 & TWM-04: spine tables, incremental watermark sync, and WAL concurrency", () => {
  test("populates delegation_turn, file_read_ledger, skill_load_ledger, file_touch, and sync_watermark in index.sqlite", () => {
    addMessage(db, {
      id: "msg_skill_load",
      session_id: "ses_root",
      type: "skill",
      seq: 6,
      data: {
        time: { created: 1006 },
        name: "tdd",
        text: "# Skill: TDD\nRed -> Green -> Refactor",
      },
    })
    addMessage(db, {
      id: "msg_edit_touch",
      session_id: "ses_root",
      type: "assistant",
      seq: 7,
      data: {
        time: { created: 1007, completed: 1008 },
        agent: "build",
        model: { id: "gpt-6.1-sol", providerID: "openai" },
        finish: "stop",
        content: [
          {
            type: "tool",
            id: "call_edit_1",
            name: "edit",
            time: { created: 1007, ran: 1007, completed: 1008 },
            state: {
              status: "completed",
              input: { filePath: "src/archive/index.ts" },
              content: [{ type: "text", text: "Edited src/archive/index.ts" }],
            },
          },
        ],
      },
    })

    const opencodeDataDir = path.join(dir, "opencode-data")
    const spillDir = path.join(opencodeDataDir, "tool-output")
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs")
    mkdirSync(spillDir, { recursive: true })
    writeFileSync(path.join(spillDir, "tool_call_edit_1"), "FULL_EXTERNAL_SPILL_PAYLOAD\n".repeat(200), "utf8")

    const source = sqliteSource(dbPath)
    let report: ReturnType<typeof persist>
    try {
      report = persist({ sessionID: "ses_root", projectID: PROJECT_ID, projectRoot, opencodeDataDir }, source)
    } finally {
      source.close()
    }
    expect(report.mode).toBe("cold_full")
    expect(report.spillsSunk).toBe(1)

    const index = new Database(path.join(archiveDir(), "index.sqlite"), { readonly: true })
    try {
      const reads = index
        .query("SELECT session_id, path, read_seq, blob_sha FROM file_read_ledger WHERE session_id = ?")
        .all("ses_grand") as Array<{ session_id: string; path: string; read_seq: number; blob_sha: string }>
      expect(reads).toHaveLength(1)
      expect(reads[0]!.path).toBe("/x")
      expect(reads[0]!.blob_sha).toHaveLength(64)

      const skills = index
        .query("SELECT session_id, skill_name, load_seq, blob_sha FROM skill_load_ledger WHERE session_id = ?")
        .all("ses_root") as Array<{ session_id: string; skill_name: string; load_seq: number; blob_sha: string }>
      expect(skills).toHaveLength(1)
      expect(skills[0]!.skill_name).toBe("tdd")

      const touches = index
        .query("SELECT session_id, path, op FROM file_touch WHERE session_id = ? AND op = 'edit'")
        .all("ses_root") as Array<{ session_id: string; path: string; op: string }>
      expect(touches).toHaveLength(1)
      expect(touches[0]!.path).toBe("src/archive/index.ts")

      const spills = index
        .query("SELECT session_id, call_id, spill_kind, full_byte_len, blob_sha FROM spill_artifact WHERE session_id = ?")
        .all("ses_root") as Array<{
        session_id: string
        call_id: string
        spill_kind: string
        full_byte_len: number
        blob_sha: string
      }>
      expect(spills).toHaveLength(1)
      expect(spills[0]!.call_id).toBe("call_edit_1")
      expect(spills[0]!.spill_kind).toBe("tool-output")
      expect(existsSync(path.join(archiveDir(), "blobs", `${spills[0]!.blob_sha}.txt`))).toBe(true)

      const turns = index
        .query(
          "SELECT parent_session_id, call_id, turn_index, child_session_id, verified_outcome FROM delegation_turn ORDER BY parent_session_id, call_id",
        )
        .all() as Array<{
        parent_session_id: string
        call_id: string
        turn_index: number
        child_session_id: string
        verified_outcome: string
      }>
      expect(turns.length).toBeGreaterThanOrEqual(3)
      const grandTurn = turns.find((t) => t.call_id === "call_dd")!
      expect(grandTurn).toBeDefined()
      expect(grandTurn.child_session_id).toBe("ses_grand")
      expect(grandTurn.verified_outcome).toBe("verified_pass")

      const watermarks = index
        .query("SELECT session_id, root_id, last_max_seq, last_message_id FROM sync_watermark WHERE root_id = ?")
        .all("ses_root") as Array<{
        session_id: string
        root_id: string
        last_max_seq: number
        last_message_id: string
      }>
      expect(watermarks).toHaveLength(5)
      const rootWm = watermarks.find((w) => w.session_id === "ses_root")!
      expect(rootWm.last_max_seq).toBe(7)
      expect(rootWm.last_message_id).toBe("msg_edit_touch")
    } finally {
      index.close()
    }
  })

  test("TWM-04: warm no-op sync completes in < 2 ms and fetches 0 message rows", () => {
    run() // cold full sync

    const source = sqliteSource(dbPath)
    try {
      // Warm up JIT once, then measure warm no-op
      const noop = persist({ sessionID: "ses_root", projectID: PROJECT_ID, projectRoot }, source)
      expect(noop.mode).toBe("noop_delta")
      expect(noop.messagesProcessed).toBe(0)
      expect(noop.dirtySessionsCount).toBe(0)
      expect(noop.written).toEqual([])

      const t0 = performance.now()
      const noop2 = persist({ sessionID: "ses_root", projectID: PROJECT_ID, projectRoot }, source)
      const elapsed = performance.now() - t0
      expect(noop2.mode).toBe("noop_delta")
      expect(noop2.messagesProcessed).toBe(0)
      expect(elapsed).toBeLessThan(2)
    } finally {
      source.close()
    }
  })

  test("TWM-04: incremental 1-turn delta sync processes only new seq > last_max_seq in < 150 ms and advances sync_watermark", () => {
    run() // cold full sync (10 messages across 5 sessions; ses_root has max_seq = 5)

    // Append 1 turn (user seq 6 + assistant seq 7) to ses_root
    db.query("UPDATE session_v2 SET time_updated = 9999 WHERE id = 'ses_root'").run()
    addMessage(db, {
      id: "msg_delta_u6",
      session_id: "ses_root",
      type: "user",
      seq: 6,
      time_created: 9990,
      time_updated: 9990,
      data: { time: { created: 9990 }, text: "follow-up incremental question" },
    })
    addMessage(db, {
      id: "msg_delta_a7",
      session_id: "ses_root",
      type: "assistant",
      seq: 7,
      time_created: 9995,
      time_updated: 9999,
      data: {
        time: { created: 9995, completed: 9999 },
        agent: "build",
        model: { id: "gpt-6.1-sol", providerID: "openai" },
        finish: "stop",
        tokens: { input: 25, output: 30 },
        content: [{ type: "text", text: "incremental answer" }],
      },
    })

    const source = sqliteSource(dbPath)
    try {
      const t0 = performance.now()
      const delta = persist({ sessionID: "ses_root", projectID: PROJECT_ID, projectRoot }, source)
      const elapsed = performance.now() - t0

      expect(delta.mode).toBe("incremental_delta")
      expect(delta.dirtySessionsCount).toBe(1)
      expect(delta.messagesProcessed).toBe(2)
      expect(delta.messages).toBe(12)
      expect(elapsed).toBeLessThan(150)

      // Only ses_root.jsonl, ses_root/info.json, new blobs, and index.sqlite were written; children were skipped
      expect(delta.written).toContain(path.join("sessions", "ses_root", "ses_root.jsonl"))
      expect(delta.written).not.toContain(
        path.join("sessions", "ses_root", "subagents", "ses_child", "ses_child.jsonl"),
      )

      const rootRecords = readJsonl(path.join(rootDir(), "ses_root.jsonl"))
      expect(rootRecords).toHaveLength(8) // 1 header + 7 messages

      const index = new Database(path.join(archiveDir(), "index.sqlite"), { readonly: true })
      try {
        const wm = index
          .query("SELECT last_max_seq, last_message_id, last_time_updated FROM sync_watermark WHERE session_id = ?")
          .get("ses_root") as { last_max_seq: number; last_message_id: string; last_time_updated: number }
        expect(wm.last_max_seq).toBe(7)
        expect(wm.last_message_id).toBe("msg_delta_a7")
        expect(wm.last_time_updated).toBe(9999)
      } finally {
        index.close()
      }
    } finally {
      source.close()
    }
  })

  test("TWM-04: concurrent WAL reader/writer stress (1 writer + 4 readers across 50 operations) completes with 0 SQLITE_BUSY errors", async () => {
    run()
    const sqlitePath = path.join(archiveDir(), "index.sqlite")
    const readers = Array.from({ length: 4 }, () => {
      const r = new Database(sqlitePath, { readonly: true })
      r.exec("PRAGMA busy_timeout = 5000;")
      return r
    })

    let busyErrors = 0
    let totalOps = 0

    try {
      const source = sqliteSource(dbPath)
      try {
        const tasks: Promise<void>[] = []
        for (let i = 0; i < 15; i++) {
          const seq = 6 + i
          tasks.push(
            (async () => {
              await Bun.sleep(i * 1)
              try {
                db.query("UPDATE session_v2 SET time_updated = ? WHERE id = 'ses_root'").run(2000 + seq)
                addMessage(db, {
                  id: `msg_conc_${seq}`,
                  session_id: "ses_root",
                  type: "user",
                  seq,
                  time_created: 2000 + seq,
                  time_updated: 2000 + seq,
                  data: { time: { created: 2000 + seq }, text: `concurrent message ${seq}` },
                })
                persist({ sessionID: "ses_root", projectID: PROJECT_ID, projectRoot }, source)
                totalOps += 1
              } catch (err) {
                if (String(err).includes("SQLITE_BUSY") || String(err).includes("database is locked")) {
                  busyErrors += 1
                } else {
                  throw err
                }
              }
            })(),
          )

          for (let rIdx = 0; rIdx < readers.length; rIdx++) {
            const reader = readers[rIdx]!
            tasks.push(
              (async () => {
                await Bun.sleep(i * 1)
                try {
                  const cnt = reader.query("SELECT COUNT(*) as c FROM message WHERE session_id = 'ses_root'").get() as {
                    c: number
                  }
                  expect(cnt.c).toBeGreaterThanOrEqual(5)
                  totalOps += 1
                } catch (err) {
                  if (String(err).includes("SQLITE_BUSY") || String(err).includes("database is locked")) {
                    busyErrors += 1
                  } else {
                    throw err
                  }
                }
              })(),
            )
          }
        }
        await Promise.all(tasks)
      } finally {
        source.close()
      }

      const jm = readers[0]!.query("PRAGMA journal_mode;").get() as { journal_mode: string }
      expect(jm.journal_mode.toLowerCase()).toBe("wal")
      expect(totalOps).toBeGreaterThanOrEqual(50)
      expect(busyErrors).toBe(0)
    } finally {
      for (const r of readers) r.close()
    }
  })

  test("TWM-R2 / CSG-R1 (T-5, T-9): ensureHoneycombSchema initializes all canonical tables, migrates file_read_ledger idempotently, populates live provenance_chain, and exposes warnings[]", () => {
    addMessage(db, {
      id: "msg_prov_u1",
      session_id: "ses_root",
      type: "user",
      seq: 6,
      time_created: 3000,
      time_updated: 3000,
      data: { time: { created: 3000 }, text: "Verify schema and provenance chain extraction" },
    })
    addMessage(db, {
      id: "msg_prov_a2",
      session_id: "ses_root",
      type: "assistant",
      seq: 7,
      time_created: 3010,
      time_updated: 3020,
      data: {
        time: { created: 3010, completed: 3020 },
        agent: "build",
        content: [
          { type: "text", text: "Updating src/index.ts and running tests." },
          {
            type: "tool",
            id: "call_prov_edit",
            name: "edit",
            state: {
              status: "completed",
              input: { filePath: "src/index.ts", oldString: "old", newString: "new" },
              content: [{ type: "text", text: "Edited src/index.ts" }],
            },
          },
          {
            type: "tool",
            id: "call_prov_bash",
            name: "bash",
            state: {
              status: "completed",
              metadata: { exitCode: 0 },
              input: { command: "bun test" },
              content: [{ type: "text", text: "All tests pass" }],
            },
          },
        ],
      },
    })
    db.query("UPDATE session_v2 SET time_updated = 3020 WHERE id = 'ses_root'").run()

    const report = run()
    expect(Array.isArray(report.warnings)).toBe(true)

    const sqlitePath = path.join(archiveDir(), "index.sqlite")
    const index = new Database(sqlitePath, { readonly: true })
    try {
      const tables = new Set(
        (
          index
            .query("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual table')")
            .all() as Array<{ name: string }>
        ).map((r) => r.name),
      )
      for (const expectedTable of [
        "session",
        "delegation",
        "message",
        "tool_call",
        "compaction",
        "instruction",
        "kv_binding",
        "kv_foreign_index",
        "kv_context_prune",
        "delegation_turn",
        "file_read_ledger",
        "skill_load_ledger",
        "file_touch",
        "snapshot_artifact",
        "spill_artifact",
        "sync_watermark",
        "sync_root_meta",
        "provenance_chain",
        "compaction_continuation_ledger",
        "session_semantic_digest",
        "intent_pivot",
        "milestone",
        "substrate_fts",
        "code_file",
        "code_symbol",
        "code_import_edge",
        "git_cochange",
        "git_cochange_file_stats",
        "git_cochange_commit",
      ]) {
        expect(tables.has(expectedTable)).toBe(true)
      }

      const chains = index
        .query("SELECT * FROM provenance_chain WHERE session_id = 'ses_root' ORDER BY intent_seq ASC")
        .all() as Array<Record<string, unknown>>
      expect(chains.length).toBeGreaterThanOrEqual(1)
      const latestChain = chains[chains.length - 1]!
      expect(latestChain.outcome).toBe("VERIFIED_PASS")
      expect(latestChain.verification_command).toBe("bun test")
      expect(latestChain.verification_exit_code).toBe(0)
      expect(latestChain.target_path).toBe("src/index.ts")
    } finally {
      index.close()
    }
  })

  test("TWM-R4 (A2): SessionSource lists project/all root sessions and persistProject syncs multi-session project and all-projects scopes with warm watermark skip", async () => {
    const archiveMod = (await import("../src/archive/index.ts")) as Record<string, unknown>
    const persistProject = archiveMod.persistProject as (
      input: {
        readonly projectID: string
        readonly projectRoot: string
        readonly dir?: string
        readonly dbPath?: string
        readonly sessionID?: string
        readonly scope?: "session" | "project" | "all-projects"
        readonly maxRootSessions?: number
      },
      source?: ReturnType<typeof sqliteSource>,
    ) => Promise<{
      readonly scope: "session" | "project" | "all-projects"
      readonly rootSessionsSynced: number
      readonly totalSessionsSynced: number
      readonly skippedWarmTrees: number
      readonly warnings: readonly string[]
    }>
    expect(typeof persistProject).toBe("function")

    // Seed a second root session in the same project and a third root session in another project
    addSession(db, {
      id: "ses_root_2",
      project_id: PROJECT_ID,
      directory: projectRoot,
      title: "second root in project",
      time_created: 6000,
      time_updated: 6100,
    })
    addSession(db, {
      id: "ses_root_2_child",
      project_id: PROJECT_ID,
      parent_id: "ses_root_2",
      directory: projectRoot,
      title: "child of second root",
      time_created: 6050,
      time_updated: 6080,
    })
    addMessage(db, {
      id: "msg_r2_u1",
      session_id: "ses_root_2",
      type: "user",
      seq: 1,
      data: { time: { created: 6001 }, text: "second root prompt" },
    })

    addProject(db, "proj_other", "/other-repo")
    addSession(db, {
      id: "ses_other_root",
      project_id: "proj_other",
      directory: "/other-repo",
      title: "cross-project root",
      time_created: 7000,
      time_updated: 7100,
    })
    addMessage(db, {
      id: "msg_other_u1",
      session_id: "ses_other_root",
      type: "user",
      seq: 1,
      data: { time: { created: 7001 }, text: "cross-project prompt" },
    })

    const source = sqliteSource(dbPath)
    try {
      expect(typeof source.listProjectRootSessions).toBe("function")
      expect(typeof source.listAllRootSessions).toBe("function")
      expect(typeof source.listProjects).toBe("function")

      const projects = source.listProjects!()
      expect(projects.map((p) => p.id).sort()).toEqual([PROJECT_ID, "proj_other"].sort())

      const projRoots = source.listProjectRootSessions!(PROJECT_ID)
      expect(projRoots.map((s) => s.id)).toEqual(["ses_root_2", "ses_root"])

      const allRoots = source.listAllRootSessions!()
      expect(allRoots.map((s) => s.id)).toEqual(["ses_other_root", "ses_root_2", "ses_root"])

      // 1. Project scope syncs both ses_root (5 sessions) and ses_root_2 (2 sessions)
      const projRes = await persistProject(
        {
          projectID: PROJECT_ID,
          projectRoot,
          scope: "project",
        },
        source,
      )
      expect(projRes.scope).toBe("project")
      expect(projRes.rootSessionsSynced).toBe(2)
      expect(projRes.totalSessionsSynced).toBe(7)
      expect(projRes.skippedWarmTrees).toBe(0)

      // 2. Second project sync hits warm watermarks on both root trees
      const warmRes = await persistProject(
        {
          projectID: PROJECT_ID,
          projectRoot,
          scope: "project",
        },
        source,
      )
      expect(warmRes.rootSessionsSynced).toBe(2)
      expect(warmRes.skippedWarmTrees).toBe(2)

      // 3. All-projects scope syncs ses_other_root as well while skipping warm project roots
      const allRes = await persistProject(
        {
          projectID: PROJECT_ID,
          projectRoot,
          scope: "all-projects",
        },
        source,
      )
      expect(allRes.scope).toBe("all-projects")
      expect(allRes.rootSessionsSynced).toBe(3)
      expect(allRes.totalSessionsSynced).toBe(8)
      expect(allRes.skippedWarmTrees).toBe(2)

      const index = new Database(path.join(archiveDir(), "index.sqlite"), { readonly: true })
      try {
        const rootRows = index
          .query("SELECT id, project_id FROM session WHERE depth = 0 ORDER BY id ASC")
          .all() as Array<{ id: string; project_id: string }>
        expect(rootRows).toEqual([
          { id: "ses_other_root", project_id: "proj_other" },
          { id: "ses_root", project_id: PROJECT_ID },
          { id: "ses_root_2", project_id: PROJECT_ID },
        ])
      } finally {
        index.close()
      }
    } finally {
      source.close()
    }
  })
})



