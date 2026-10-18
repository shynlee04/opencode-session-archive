import { describe, expect, test } from "bun:test"
import { sqliteSource } from "../src/archive/index.ts"
import { addKv, addMessage, addProject, addSession, encodeUtf16BeHex, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"
import * as spine from "../src/archive/source.ts"

describe("sqliteSource", () => {
  test("reads project, sessions, children ordered by time_created and messages ordered by seq", () => {
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db, PROJECT_ID, "/repo")
    addSession(db, { id: "ses_root", directory: "/repo" })
    addSession(db, { id: "ses_b", parent_id: "ses_root", time_created: 2000 })
    addSession(db, { id: "ses_a", parent_id: "ses_root", time_created: 1000 })
    addMessage(db, { id: "m2", session_id: "ses_root", type: "user", seq: 2, data: { text: "b" } })
    addMessage(db, { id: "m1", session_id: "ses_root", type: "user", seq: 1, data: { text: "a" } })
    db.close()

    const source = sqliteSource(dbPath)
    expect(source.project(PROJECT_ID)?.worktree).toBe("/repo")
    expect(source.project("nope")).toBeUndefined()
    expect(source.session("nope")).toBeUndefined()
    expect(source.session("ses_root")?.model?.providerID).toBe("openai")
    expect(source.children("ses_root").map((s) => s.id)).toEqual(["ses_a", "ses_b"])
    const messages = source.messages("ses_root")
    expect(messages.map((m) => m.id)).toEqual(["m1", "m2"])
    expect(messages[0].data).toEqual({ text: "a" })
    source.close()
  })

  test("throws a schema-drift error naming the first missing required column", () => {
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    db.exec("ALTER TABLE session_v2 DROP COLUMN resume_attempts")
    db.close()
    expect(() => sqliteSource(dbPath)).toThrow("session-archive: host schema drift: session_v2.resume_attempts missing")
  })

  test("throws a schema-drift error when session_message loses a column", () => {
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    db.exec("ALTER TABLE session_message DROP COLUMN data")
    db.close()
    expect(() => sqliteSource(dbPath)).toThrow("session-archive: host schema drift: session_message.data missing")
  })

  test("TWM-01: throws a schema-drift error when kv loses a required column", () => {
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    db.exec("ALTER TABLE kv DROP COLUMN value")
    db.close()
    expect(() => sqliteSource(dbPath)).toThrow("session-archive: host schema drift: kv.value missing")
  })

  test("TWM-01: decodes UTF-16BE plugin:<hex>:bindings/<childSessionID>, delegate-mode/child/<id>, foreign-session-index, and context-prune keys via PK-bounded probes", () => {
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db, PROJECT_ID, "/repo")
    addSession(db, { id: "ses_parent", directory: "/repo" })
    addSession(db, {
      id: "ses_child_agy",
      parent_id: "ses_parent",
      directory: "/repo",
      agent: "antigravity-native",
      model: { id: "gemini-3.1-pro", providerID: "antigravity-native" },
    })

    const pluginHex = encodeUtf16BeHex("hivemind-steward")
    addKv(db, {
      key: `plugin:${pluginHex}:bindings/ses_child_agy`,
      value: {
        foreignSessionID: "agy-foreign-001",
        harness: "antigravity",
        parentSessionID: "ses_parent",
        callID: "call_01",
        turn: 2,
        phase: "idle",
        foreignAck: { turn: 2, stopReason: "end_turn" },
        servingWitness: { model: "gemini-3.1-pro", observedAt: "2026-10-18T12:00:00Z" },
        consumedInputs: ["msg_1", "msg_2"],
      },
      time_created: 1100,
      time_updated: 2200,
    })
    addKv(db, {
      key: `plugin:${pluginHex}:foreign-session-index`,
      value: {
        "antigravity:agy-foreign-001": "ses_child_agy",
      },
      time_created: 1100,
      time_updated: 2200,
    })
    addKv(db, {
      key: "session:ses_parent:context-prune:ses_parent",
      value: {
        mode: "step-window",
        anchorMessageID: "msg_anchor_08",
        recordedAt: "2026-10-18T12:05:00Z",
      },
      time_created: 1200,
      time_updated: 2500,
    })
    db.close()

    const decodeHostKvKey = (spine as Record<string, unknown>).decodeHostKvKey as (
      rawKey: string,
    ) => { scope: string | null; logicalKey: string }
    expect(typeof decodeHostKvKey).toBe("function")
    expect(decodeHostKvKey(`plugin:${pluginHex}:bindings/ses_child_agy`)).toEqual({
      scope: "plugin:hivemind-steward",
      logicalKey: "bindings/ses_child_agy",
    })

    const source = sqliteSource(dbPath) as ReturnType<typeof sqliteSource> & {
      kvState?: (sessionIDs: readonly string[], sinceTimeUpdated?: number) => {
        bindings: Array<Record<string, unknown>>
        foreignIndex: Array<Record<string, unknown>>
        contextPrunes: Array<Record<string, unknown>>
      }
    }
    expect(typeof source.kvState).toBe("function")
    const kv = source.kvState!(["ses_parent", "ses_child_agy"])
    expect(kv.bindings.length).toBe(1)
    expect(kv.bindings[0]?.child_session_id).toBe("ses_child_agy")
    expect(kv.bindings[0]?.foreign_session_id).toBe("agy-foreign-001")
    expect(kv.bindings[0]?.harness).toBe("antigravity")
    expect(kv.bindings[0]?.turn).toBe(2)
    expect(kv.bindings[0]?.serving_witness_model).toBe("gemini-3.1-pro")
    expect(kv.foreignIndex).toEqual([
      {
        harness: "antigravity",
        foreign_session_id: "agy-foreign-001",
        child_session_id: "ses_child_agy",
        raw_key: `plugin:${pluginHex}:foreign-session-index`,
      },
    ])
    expect(kv.contextPrunes.length).toBe(1)
    expect(kv.contextPrunes[0]?.session_id).toBe("ses_parent")
    expect(kv.contextPrunes[0]?.anchor_message_id).toBe("msg_anchor_08")

    // Watermark-filtered probe returns 0 rows when sinceTimeUpdated >= 2500
    const watermarked = source.kvState!(["ses_parent", "ses_child_agy"], 2500)
    expect(watermarked.bindings.length).toBe(0)
    expect(watermarked.contextPrunes.length).toBe(0)
    source.close()
  })
})
