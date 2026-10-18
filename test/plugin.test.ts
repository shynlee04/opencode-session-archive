import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin, * as pluginExports from "../src/plugin.ts"
import type { PersistReport } from "../src/archive/index.ts"
import { addMessage, addProject, addSession, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"

interface AddedTool {
  name: string
  options?: { namespace?: string; codemode?: boolean }
  description: string
  input?: Record<string, unknown>
  execute: (input: any, context: any) => Promise<{ content?: any; metadata?: any }>
}

const setup = async (options: Record<string, unknown>, projectRoot: string, seedMessages: any[] = []) => {
  const namespaces: { name: string; description: string }[] = []
  const added: AddedTool[] = []
  const sessionHooks = new Map<string, (event: any) => Promise<void> | void>()
  const eventListeners: Array<(event: any) => Promise<void> | void> = []

  const ctx = {
    options,
    location: { project: { id: PROJECT_ID, canonical: projectRoot } },
    session: {
      hook: (name: string, fn: (event: any) => Promise<void> | void) => {
        sessionHooks.set(name, fn)
      },
      messages: async (_input: { sessionID: string }) => seedMessages,
      get: async (sessionID: string) => ({ id: sessionID, parentID: null }),
    },
    event: {
      subscribe: (fn: (event: any) => Promise<void> | void) => {
        eventListeners.push(fn)
        return () => {}
      },
    },
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          list: () => added,
          get: (id: string) =>
            added.find((t) => (t.options?.namespace ? `${t.options.namespace}.${t.name}` : t.name) === id || t.name === id),
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
  const findTool = (qualifiedOrName: string): AddedTool => {
    const found = added.find(
      (t) =>
        (t.options?.namespace ? `${t.options.namespace}.${t.name}` : t.name) === qualifiedOrName ||
        t.name === qualifiedOrName,
    )
    if (!found) throw new Error(`Tool not found: ${qualifiedOrName}`)
    return found
  }
  return { namespaces, added, findTool, sessionHooks, eventListeners }
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

const seedDb = (projectRoot = "/repo") => {
  const dir = makeTmpDir()
  const { db, dbPath } = makeDbFile(dir)
  addProject(db)
  addSession(db, { id: "ses_root", directory: projectRoot, title: "Wave 2 slice 1 architecture review" })
  addMessage(db, {
    id: "m1",
    session_id: "ses_root",
    type: "user",
    seq: 1,
    data: { time: { created: 1 }, text: "Please implement Wave 2 slice 1 and verify bun test passes." },
  })
  addMessage(db, {
    id: "m2",
    session_id: "ses_root",
    type: "assistant",
    seq: 2,
    data: {
      time: { created: 2, completed: 3 },
      content: [
        {
          type: "tool",
          id: "call_read_1",
          name: "read",
          state: {
            status: "completed",
            input: { filePath: "src/sample.ts" },
            content: [{ type: "text", text: "export function computeAlpha(): number { return 42 }\n" }],
          },
        },
      ],
    },
  })
  db.close()
  return dbPath
}

describe("plugin shell & VSC-04 unified surface (REQ-SUB-17)", () => {
  test("registers substrate.valve, substrate.viewport, archive.persist, ctx.context-prune, substrate, and viewport", async () => {
    const projectRoot = makeTmpDir()
    const { namespaces, findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const nsNames = namespaces.map((n) => n.name)
    expect(nsNames).toContain("substrate")
    expect(nsNames).toContain("archive")
    expect(nsNames).toContain("ctx")

    expect(findTool("substrate.valve").options).toMatchObject({ namespace: "substrate", codemode: true })
    expect(findTool("substrate.viewport").options).toMatchObject({ namespace: "substrate", codemode: true })
    expect(findTool("archive.persist").options).toMatchObject({ namespace: "archive", codemode: true })
    expect(findTool("ctx.context-prune").options).toMatchObject({ namespace: "ctx", codemode: true })
    expect(findTool("substrate").name).toBe("substrate")
    expect(findTool("viewport").name).toBe("viewport")
  })

  test("options.direct registers tools with codemode off", async () => {
    const projectRoot = makeTmpDir()
    const { added } = await setup({ dbPath: seedDb(projectRoot), direct: true }, projectRoot)
    for (const tool of added) {
      expect(tool.options).toMatchObject({ codemode: false })
    }
  })

  test("archive.persist and substrate.viewport({ action: sync }) persist the session into <canonical>/.session-archive", async () => {
    const projectRoot = makeTmpDir()
    const { findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const persistTool = findTool("archive.persist")
    const result = await persistTool.execute({ sessionID: "ses_root" }, toolContext("ses_ctx"))
    const metadata = result.metadata as PersistReport
    expect(metadata.rootID).toBe("ses_root")
    expect(metadata.sessions).toBe(1)
    expect(String(result.content)).toContain("Persisted session tree rooted at ses_root")
    expect(existsSync(path.join(projectRoot, ".session-archive", "sessions", "ses_root", "ses_root.jsonl"))).toBe(true)
    expect(existsSync(path.join(projectRoot, ".session-archive", "index.sqlite"))).toBe(true)
  })

  test("archive.persist defaults to the calling context sessionID and options.dir relocates archive", async () => {
    const projectRoot = makeTmpDir()
    const { findTool } = await setup({ dbPath: seedDb(projectRoot), dir: "custom-archive" }, projectRoot)
    const result = await findTool("archive.persist").execute({}, toolContext("ses_root"))
    const metadata = result.metadata as PersistReport
    expect(metadata.rootID).toBe("ses_root")
    expect(metadata.archiveDir).toBe(path.join(projectRoot, "custom-archive"))
    expect(existsSync(path.join(projectRoot, "custom-archive", "index.sqlite"))).toBe(true)
  })

  test("substrate.valve and ctx.context-prune arm/status/reset WorkingSetValve and context hook runs in < 2 ms", async () => {
    const projectRoot = makeTmpDir()
    const messages: any[] = [
      { id: "u1", type: "user", content: [{ type: "text", text: "Run autonomous multi-step build" }] },
    ]
    for (let i = 1; i <= 15; i++) {
      messages.push({
        id: `a_${i}`,
        type: "assistant",
        content: [
          {
            type: "tool",
            id: `call_${i}`,
            name: "read",
            state: {
              status: "completed",
              input: { filePath: `src/mod${i}.ts` },
              content: [{ type: "text", text: `// file ${i}\n` + "export const x = 1;\n".repeat(40) }],
            },
          },
        ],
      })
    }

    const { findTool, sessionHooks } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot, messages)
    const valveTool = findTool("substrate.valve")
    const pruneRes = await valveTool.execute(
      { action: "prune", mode: "step-window", keepRecentSteps: 5 },
      toolContext("ses_root"),
    )
    expect(String(pruneRes.content)).toContain("WorkingSetValve armed for session")

    const statusRes = await findTool("ctx.context-prune").execute({ action: "status" }, toolContext("ses_root"))
    expect(String(statusRes.content)).toContain("WorkingSetValve is armed")

    const contextHook = sessionHooks.get("context")
    expect(typeof contextHook).toBe("function")

    const hookEvent = {
      sessionID: "ses_root",
      messages: JSON.parse(JSON.stringify(messages)),
      system: ["Base system prompt"],
    }
    const t0 = performance.now()
    await contextHook!(hookEvent)
    const elapsedMs = performance.now() - t0
    expect(elapsedMs).toBeLessThan(10)
    expect(hookEvent.system[0]).toContain("WorkingMemoryManifest")
    expect(hookEvent.messages[1].content[0].state.content[0].text).toContain("[Pruned read")

    // Resolve pruned blob via substrate.viewport({ action: "resolve" })
    const match = /blob:([0-9a-f]{12})/.exec(hookEvent.messages[1].content[0].state.content[0].text)
    expect(match).not.toBeNull()
    const resolveRes = await findTool("substrate.viewport").execute(
      { action: "resolve", blob: match![1] },
      toolContext("ses_root"),
    )
    expect(String(resolveRes.content)).toContain("export const x = 1;")

    const resetRes = await valveTool.execute({ action: "reset" }, toolContext("ses_root"))
    expect(String(resetRes.content)).toContain("WorkingSetValve reset")
  })

  test("substrate.viewport supports status, timeline, provenance, search, repomap, skeleton, slice, coupled, and brief with omitted sessionID", async () => {
    const projectRoot = makeTmpDir()
    mkdirSync(path.join(projectRoot, "src"), { recursive: true })
    writeFileSync(
      path.join(projectRoot, "src", "sample.ts"),
      "export function computeAlpha(x: number): number {\n  return x + 42\n}\n",
      "utf8",
    )

    const { findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const viewport = findTool("substrate.viewport")

    // 1. status (with omitted sessionID -> resolved via resolveDefaultSessionId)
    const statusRes = await viewport.execute({ action: "status" }, toolContext("ses_root"))
    expect(String(statusRes.content)).toContain("ses_root")

    // 2. timeline / intents
    const timelineRes = await viewport.execute({ action: "timeline" }, toolContext("ses_root"))
    expect(String(timelineRes.content)).toContain("ses_root")

    // 3. search (FTS5 vibe navigation)
    const searchRes = await viewport.execute({ action: "search", query: "Wave 2 slice 1" }, toolContext("ses_root"))
    expect(String(searchRes.content)).toContain("ses_root")

    // 4. provenance
    const provRes = await viewport.execute({ action: "provenance" }, toolContext("ses_root"))
    expect(String(provRes.content)).toContain("Provenance")

    // 5. repomap, skeleton, slice, coupled, brief
    const repomapRes = await viewport.execute({ action: "repomap" }, toolContext("ses_root"))
    expect(String(repomapRes.content)).toContain("src/sample.ts")

    const skelRes = await viewport.execute({ action: "skeleton", path: "src/sample.ts" }, toolContext("ses_root"))
    expect(String(skelRes.content)).toContain("computeAlpha")

    const sliceRes = await viewport.execute(
      { action: "slice", path: "src/sample.ts", symbol: "computeAlpha" },
      toolContext("ses_root"),
    )
    expect(String(sliceRes.content)).toContain("return x + 42")

    const coupledRes = await viewport.execute({ action: "coupled", path: "src/sample.ts" }, toolContext("ses_root"))
    expect(typeof coupledRes.content).toBe("string")

    const briefRes = await viewport.execute(
      { action: "brief", targetPaths: ["src/sample.ts"], symbolNames: ["computeAlpha"], maxTokens: 800 },
      toolContext("ses_root"),
    )
    expect(String(briefRes.content)).toContain("Implementor Viewport Brief")
    expect(String(briefRes.content)).toContain("computeAlpha")
  })

  test("compaction hook and event.subscribe wire SQLite continuity packet and background incremental sync", async () => {
    const projectRoot = makeTmpDir()
    const { sessionHooks, eventListeners } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)

    const compactionHook = sessionHooks.get("compaction")
    expect(typeof compactionHook).toBe("function")

    const compactionEvent: { sessionID: string; prompt?: string; context?: string[] } = {
      sessionID: "ses_root",
      prompt: "Summarize session:",
      context: [],
    }
    await compactionHook!(compactionEvent)
    expect(compactionEvent.prompt).toContain("Headline & Gate")
    expect(compactionEvent.prompt).toContain("Working-Memory Manifest")

    expect(eventListeners.length).toBeGreaterThan(0)
    await eventListeners[0]!({
      type: "session.status",
      properties: { sessionID: "ses_root", status: { type: "idle" } },
    })
    expect(existsSync(path.join(projectRoot, ".session-archive", "index.sqlite"))).toBe(true)
  })

  test("rejects options.dir inside .opencode/ to prevent host hot-reload loops (REQ-SUB-01 / SPEC-01)", async () => {
    const projectRoot = makeTmpDir()
    await expect(setup({ dbPath: seedDb(projectRoot), dir: ".opencode/archive" }, projectRoot)).rejects.toThrow(
      "archive directory must not reside inside .opencode/",
    )
  })

  test("re-exports buildImplementorViewportBrief and bundles cleanly into dist/session-archive.ts", () => {
    expect(typeof (pluginExports as any).buildImplementorViewportBrief).toBe("function")
    const proc = Bun.spawnSync(["bun", "run", "build"], {
      cwd: path.resolve(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(proc.exitCode).toBe(0)
    const distPath = path.resolve(import.meta.dir, "../dist/session-archive.ts")
    expect(existsSync(distPath)).toBe(true)
    const distText = readFileSync(distPath, "utf8")
    expect(distText).toContain("buildImplementorViewportBrief")
    expect(distText).toContain("WorkingSetValve")
  })
})
