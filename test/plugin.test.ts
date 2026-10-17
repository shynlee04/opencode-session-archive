import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/plugin.ts"
import type { PersistReport } from "../src/archive/index.ts"
import { addMessage, addProject, addSession, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"

interface AddedTool {
  name: string
  options?: { namespace?: string; codemode?: boolean }
  description: string
  execute: (input: unknown, context: unknown) => Promise<{ content?: unknown; metadata?: unknown }>
}

const setup = async (options: Record<string, unknown>, projectRoot: string) => {
  const namespaces: { name: string; description: string }[] = []
  const added: AddedTool[] = []
  const ctx = {
    options,
    location: { project: { id: PROJECT_ID, canonical: projectRoot } },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          list: () => added,
          get: (id: string) => added.find((t) => t.name === id),
          namespace: (ns: { name: string; description: string }) => namespaces.push(ns),
          add: (tool: AddedTool) => added.push(tool),
          update: () => {},
          remove: () => {},
        })
        return { dispose: async () => {} }
      },
    },
  }
  await plugin.setup(ctx as unknown as Plugin.Context)
  return { namespaces, added }
}

const toolContext = (sessionID: string) =>
  ({
    sessionID,
    agent: "build",
    messageID: "msg_ctx",
    id: "call_ctx",
    signal: new AbortController().signal,
    progress: async () => {},
  }) as unknown as Parameters<AddedTool["execute"]>[1]

const seedDb = () => {
  const dir = makeTmpDir()
  const { db, dbPath } = makeDbFile(dir)
  addProject(db)
  addSession(db, { id: "ses_root", directory: "/repo" })
  addMessage(db, {
    id: "m1",
    session_id: "ses_root",
    type: "user",
    seq: 1,
    data: { time: { created: 1 }, text: "hi" },
  })
  db.close()
  return dbPath
}

describe("plugin shell", () => {
  test("registers the archive namespace and persist tool (codemode by default)", async () => {
    const projectRoot = makeTmpDir()
    const { namespaces, added } = await setup({ dbPath: seedDb() }, projectRoot)
    expect(namespaces).toEqual([{ name: "archive", description: "Deterministic session transcript archive" }])
    expect(added).toHaveLength(1)
    expect(added[0].name).toBe("persist")
    expect(added[0].options).toMatchObject({ namespace: "archive", codemode: true })
  })

  test("options.direct registers the tool with codemode off", async () => {
    const { added } = await setup({ dbPath: seedDb(), direct: true }, makeTmpDir())
    expect(added[0].options).toMatchObject({ codemode: false })
  })

  test("execute persists the named session into <canonical>/.session-archive", async () => {
    const projectRoot = makeTmpDir()
    const { added } = await setup({ dbPath: seedDb() }, projectRoot)
    const result = await added[0].execute({ sessionID: "ses_root" }, toolContext("ses_ctx"))
    const metadata = result.metadata as PersistReport
    expect(metadata.rootID).toBe("ses_root")
    expect(metadata.sessions).toBe(1)
    expect(String(result.content)).toContain("Persisted session tree rooted at ses_root")
    expect(existsSync(path.join(projectRoot, ".session-archive", "sessions", "ses_root", "ses_root.jsonl"))).toBe(true)
    expect(existsSync(path.join(projectRoot, ".session-archive", "index.sqlite"))).toBe(true)
  })

  test("execute defaults to the calling context sessionID", async () => {
    const projectRoot = makeTmpDir()
    const { added } = await setup({ dbPath: seedDb() }, projectRoot)
    const result = await added[0].execute({}, toolContext("ses_root"))
    expect((result.metadata as PersistReport).rootID).toBe("ses_root")
  })

  test("options.dir relocates the archive under the project root", async () => {
    const projectRoot = makeTmpDir()
    const { added } = await setup({ dbPath: seedDb(), dir: "custom-archive" }, projectRoot)
    const result = await added[0].execute({}, toolContext("ses_root"))
    const metadata = result.metadata as PersistReport
    expect(metadata.archiveDir).toBe(path.join(projectRoot, "custom-archive"))
    expect(existsSync(path.join(projectRoot, "custom-archive", "index.sqlite"))).toBe(true)
  })
})
