import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin, * as pluginExports from "../src/plugin.ts"
import type { PersistReport } from "../src/archive/index.ts"
import { JIT_SKELETON_MARKER } from "../src/archive/primitives.ts"
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
  const toolHooks = new Map<string, (event: any) => Promise<void> | void>()
  const eventListeners: Array<(event: any) => Promise<void> | void> = []
  let registeredRpc: { def: any; handlers: any } | null = null

  const ctx = {
    options,
    location: { project: { id: PROJECT_ID, canonical: projectRoot } },
    session: {
      hook: async (name: string, fn: (event: any) => Promise<void> | void) => {
        sessionHooks.set(name, fn)
        return { dispose: async () => {} }
      },
      context: async (_input: { sessionID: string }) => seedMessages,
      get: async (sessionID: string) => ({ id: sessionID, parentID: null }),
    },
    event: {
      subscribe: async (fn: (event: any) => Promise<void> | void) => {
        eventListeners.push(fn)
        return { dispose: async () => {} }
      },
    },
    rpc: {
      register: async (def: any, handlers: any) => {
        registeredRpc = { def, handlers }
        return { emit: () => {}, dispose: async () => {} }
      },
    },
    tool: {
      hook: async (name: string, fn: (event: any) => Promise<void> | void) => {
        toolHooks.set(name, fn)
        return { dispose: async () => {} }
      },
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
  return { namespaces, added, findTool, sessionHooks, toolHooks, eventListeners, registeredRpc }
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

describe("plugin shell & VSC-04 / VSC-R2 unified surface (REQ-SUB-17, A1..A4)", () => {
  test("A2 (P-4): registers exactly the 4 approved tools (substrate.valve, substrate.viewport, archive.persist, ctx.context-prune) and omits redundant root substrate/viewport tools", async () => {
    const projectRoot = makeTmpDir()
    const { namespaces, added, findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const nsNames = namespaces.map((n) => n.name)
    expect(nsNames).toContain("substrate")
    expect(nsNames).toContain("archive")
    expect(nsNames).toContain("ctx")

    const qualifiedNames = added.map((t) => (t.options?.namespace ? `${t.options.namespace}.${t.name}` : t.name))
    expect(qualifiedNames).toEqual([
      "substrate.valve",
      "substrate.viewport",
      "archive.persist",
      "ctx.context-prune",
    ])
    expect(findTool("substrate.valve").options).toMatchObject({ namespace: "substrate", codemode: true })
    expect(findTool("substrate.viewport").options).toMatchObject({ namespace: "substrate", codemode: true })
    expect(findTool("archive.persist").options).toMatchObject({ namespace: "archive", codemode: true })
    expect(findTool("ctx.context-prune").options).toMatchObject({ namespace: "ctx", codemode: true })
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
    expect(String(result.content)).toContain("[substrate.telemetry action=sync")
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

  test("D2 / P-3: substrate.valve manual prune loads trajectory from ctx.session.context or sqliteSource fallback and renders truthful WorkingMemoryManifest", async () => {
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
    expect(String(pruneRes.content)).toContain("10/15 assistant steps thinned")
    expect(String(pruneRes.content)).toContain("WorkingMemoryManifest")

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

  test("D2 sqliteSource fallback: substrate.valve manual prune works even when ctx.session.context returns empty", async () => {
    const projectRoot = makeTmpDir()
    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_sql_fallback", directory: projectRoot, title: "SQLite Fallback Session" })
    addMessage(db, {
      id: "m_u1",
      session_id: "ses_sql_fallback",
      type: "user",
      seq: 1,
      data: { time: { created: 1 }, text: "Read and analyze all modules" },
    })
    for (let i = 1; i <= 10; i++) {
      addMessage(db, {
        id: `m_a_${i}`,
        session_id: "ses_sql_fallback",
        type: "assistant",
        seq: i + 1,
        data: {
          time: { created: i + 1, completed: i + 2 },
          content: [
            {
              type: "tool",
              id: `call_sql_${i}`,
              name: "read",
              state: {
                status: "completed",
                input: { filePath: `src/f${i}.ts` },
                content: [{ type: "text", text: `Read file src/f${i}.ts, lines 1-2\n1: export const a = ${i}\n2: export const b = ${i}` }],
              },
            },
          ],
        },
      })
    }
    db.close()

    // Pass empty seedMessages so ctx.session.context returns [] and forces sqliteSource fallback
    const { findTool } = await setup({ dbPath }, projectRoot, [])
    const pruneRes = await findTool("substrate.valve").execute(
      { action: "prune", mode: "step-window", keepRecentSteps: 4 },
      toolContext("ses_sql_fallback"),
    )
    expect(String(pruneRes.content)).toContain("6/10 assistant steps thinned")
    expect(String(pruneRes.content)).toContain("src/f1.ts")
  })

  test("A3 (P-1, P-8): ctx.tool.hook('execute.after') appends JIT Read Skeleton Footer on truncated reads and records SLICE coverage in valve", async () => {
    const projectRoot = makeTmpDir()
    mkdirSync(path.join(projectRoot, "src"), { recursive: true })
    const fileLines: string[] = []
    for (let i = 1; i <= 40; i++) {
      fileLines.push(`export function helperFunc${i}(x: number): number {`)
      fileLines.push(`  return x + ${i}`)
      fileLines.push(`}`)
    }
    const targetFile = path.join(projectRoot, "src", "big-module.ts")
    writeFileSync(targetFile, `${fileLines.join("\n")}\n`, "utf8")

    const { toolHooks, findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const afterHook = toolHooks.get("execute.after")
    expect(typeof afterHook).toBe("function")

    const truncatedReadText = [
      `Read file ${targetFile}, lines 1-15`,
      ...fileLines.slice(0, 15).map((l, idx) => `${idx + 1}: ${l}`),
      "[Output truncated. Continue reading with offset: 16]",
    ].join("\n")

    const afterEvent = {
      tool: "read",
      sessionID: "ses_root",
      agent: "build",
      messageID: "m_read_1",
      id: "call_read_trunc",
      input: { filePath: targetFile },
      status: "completed" as const,
      result: {
        content: truncatedReadText,
      },
    }

    await afterHook!(afterEvent)
    expect(String(afterEvent.result.content)).toContain(JIT_SKELETON_MARKER)
    expect(String(afterEvent.result.content)).toContain("helperFunc6")
    expect(String(afterEvent.result.content)).toContain("(+26 more unread symbols)")
    expect(String(afterEvent.result.content)).toContain("substrate.viewport")

    const statusRes = await findTool("substrate.valve").execute({ action: "status" }, toolContext("ses_root"))
    expect(String(statusRes.content)).toContain("SLICE L1-L15")
  })

  test("substrate.viewport supports status, timeline, provenance, search, repomap, skeleton, slice, coupled, brief, and format=json/both", async () => {
    const projectRoot = makeTmpDir()
    mkdirSync(path.join(projectRoot, "src"), { recursive: true })
    writeFileSync(
      path.join(projectRoot, "src", "sample.ts"),
      "export function computeAlpha(x: number): number {\n  return x + 42\n}\n",
      "utf8",
    )

    const { findTool, registeredRpc } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const viewport = findTool("substrate.viewport")

    // Verify RPC registration (A1)
    expect(registeredRpc).not.toBeNull()
    expect((registeredRpc as unknown as { def: { id: string } } | null)?.def.id).toBe("hivemind-substrate")

    // 1. status (with omitted sessionID -> resolved via resolveDefaultSessionId)
    const statusRes = await viewport.execute({ action: "status" }, toolContext("ses_root"))
    expect(String(statusRes.content)).toContain("ses_root")
    expect(String(statusRes.content)).toContain("[substrate.telemetry action=status")

    // 1b. format: "json" returns structured JSON string
    const jsonRes = await viewport.execute({ action: "status", format: "json" }, toolContext("ses_root"))
    const parsedJson = JSON.parse(String(jsonRes.content))
    expect(parsedJson.action).toBe("status")
    expect(typeof parsedJson.tokens).toBe("number")

    // 2. timeline / intents
    const timelineRes = await viewport.execute({ action: "timeline" }, toolContext("ses_root"))
    expect(String(timelineRes.content)).toContain("ses_root")

    // 3. search (FTS5 vibe navigation — D3 verified free of fake S2 msg[124..125] text)
    const searchRes = await viewport.execute({ action: "search", query: "Wave 2 slice 1" }, toolContext("ses_root"))
    expect(String(searchRes.content)).toContain("ses_root")
    expect(String(searchRes.content)).not.toContain("S2 msg[124..125]")

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

  test("compaction hook pushes CompactionContinuationPacket onto event.system and event.subscribe wires idle/compacted sync", async () => {
    const projectRoot = makeTmpDir()
    const { sessionHooks, eventListeners } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)

    const compactionHook = sessionHooks.get("compaction")
    expect(typeof compactionHook).toBe("function")

    const compactionEvent: {
      sessionID: string
      system: Array<{ type: "text"; text: string }>
      prompt?: string
      context?: string[]
    } = {
      sessionID: "ses_root",
      system: [],
      prompt: "Summarize session:",
      context: [],
    }
    await compactionHook!(compactionEvent)
    expect(compactionEvent.system.length).toBe(1)
    expect(compactionEvent.system[0]!.text).toContain("Headline & Gate")
    expect(compactionEvent.system[0]!.text).toContain("Working-Memory Manifest")

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
    expect(distText).toContain("buildJitReadSkeletonFooter")
  })

  test("VSC-R4: plugin.id is hivemind-substrate, compaction action preview, normalized JSON envelope, canonical telemetry, compact valve < 250 tokens, and cross-project structural resolution", async () => {
    expect((plugin as { id?: string }).id).toBe("hivemind-substrate")

    const projectRoot = makeTmpDir()
    mkdirSync(path.join(projectRoot, "src"), { recursive: true })
    writeFileSync(
      path.join(projectRoot, "src", "sample.ts"),
      "export function computeAlpha(x: number): number {\n  return x + 42\n}\n",
      "utf8",
    )

    // Create a second independent cross-project workspace on disk
    const externalRoot = makeTmpDir()
    mkdirSync(path.join(externalRoot, "src"), { recursive: true })
    writeFileSync(
      path.join(externalRoot, "package.json"),
      JSON.stringify({ name: "external-pkg" }),
      "utf8",
    )
    const externalFile = path.join(externalRoot, "src", "foreign.ts")
    writeFileSync(
      externalFile,
      "export function foreignHelper(label: string): string {\n  return `foreign:${label}`\n}\n",
      "utf8",
    )

    const { findTool } = await setup({ dbPath: seedDb(projectRoot) }, projectRoot)
    const viewport = findTool("substrate.viewport")
    const valveTool = findTool("substrate.valve")

    // 1. E-2: Dedicated action: "compaction" preview
    const compactionRes = await viewport.execute(
      { action: "compaction", format: "json" },
      toolContext("ses_root"),
    )
    const compactionJson = JSON.parse(String(compactionRes.content))
    expect(compactionJson.ok).toBe(true)
    expect(compactionJson.action).toBe("compaction")
    expect(compactionJson.sessionID).toBe("ses_root")
    expect(typeof compactionJson.tokenCount).toBe("number")
    expect(compactionJson.budgetTokens).toBe(1200)
    expect(String(compactionJson.content)).toContain("Headline & Gate")
    expect(String(compactionJson.content)).toContain("Working-Memory Manifest")
    // E-7: data must not duplicate content
    expect(compactionJson.data?.content).toBeUndefined()
    expect(compactionJson.data?.markdown).toBeUndefined()

    // 2. E-4: Canonical telemetry action names for aliases (find -> search, persist -> sync, valve -> prune)
    const findRes = await viewport.execute(
      { action: "find", query: "Wave 2 slice 1" },
      toolContext("ses_root"),
    )
    expect(String(findRes.content)).toContain("[substrate.telemetry action=search")

    const persistRes = await viewport.execute(
      { action: "persist", scope: "project" },
      toolContext("ses_root"),
    )
    expect(String(persistRes.content)).toContain("[substrate.telemetry action=sync")

    // 3. E-7 & E-8: brief with format: "json" has normalized envelope without duplicate token keys in data
    const briefJsonRes = await viewport.execute(
      {
        action: "brief",
        targetPaths: ["src/sample.ts"],
        symbolNames: ["computeAlpha"],
        maxTokens: 800,
        format: "json",
      },
      toolContext("ses_root"),
    )
    const briefJson = JSON.parse(String(briefJsonRes.content))
    expect(briefJson.ok).toBe(true)
    expect(briefJson.action).toBe("brief")
    expect(typeof briefJson.tokenCount).toBe("number")
    expect(briefJson.budgetTokens).toBe(800)
    expect(briefJson.data?.tokenEstimate).toBeUndefined()
    expect(briefJson.data?.estimatedTokens).toBeUndefined()
    expect(briefJson.data?.markdown).toBeUndefined()
    expect(briefJson.data?.content).toBeUndefined()

    // 4. S3-1 & S3-3: substrate.valve syncs with index.sqlite and emits < 250 tokens by default
    const valveStatusRes = await valveTool.execute(
      { action: "status" },
      toolContext("ses_root"),
    )
    const valveStatusText = String(valveStatusRes.content)
    const estimatedValveTokens = Math.ceil(valveStatusText.length / 4)
    expect(estimatedValveTokens).toBeLessThan(250)
    expect(valveStatusText).toContain("src/sample.ts")

    const valvePruneRes = await valveTool.execute(
      { action: "prune" },
      toolContext("ses_root"),
    )
    expect(String(valvePruneRes.content)).toContain("[substrate.telemetry action=prune")
    expect(Math.ceil(String(valvePruneRes.content).length / 4)).toBeLessThan(250)

    // 5. S2-1, S2-2, S2-3: Cross-project structural resolution for skeleton, slice, repomap, brief
    const crossSkelRes = await viewport.execute(
      { action: "skeleton", path: externalFile },
      toolContext("ses_root"),
    )
    expect(String(crossSkelRes.content)).toContain("foreignHelper")

    const crossSliceRes = await viewport.execute(
      { action: "slice", path: externalFile, symbol: "foreignHelper" },
      toolContext("ses_root"),
    )
    expect(String(crossSliceRes.content)).toContain("return `foreign:${label}`")

    const crossRepomapRes = await viewport.execute(
      { action: "repomap", path: externalRoot },
      toolContext("ses_root"),
    )
    expect(String(crossRepomapRes.content)).toContain("src/foreign.ts")

    const crossBriefRes = await viewport.execute(
      {
        action: "brief",
        targetPaths: [externalFile],
        symbolNames: ["foreignHelper"],
        maxTokens: 600,
      },
      toolContext("ses_root"),
    )
    expect(String(crossBriefRes.content)).toContain("foreignHelper")
  })
})
