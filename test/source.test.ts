import { describe, expect, test } from "bun:test"
import { sqliteSource } from "../src/archive/index.ts"
import { addMessage, addProject, addSession, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"

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
})
