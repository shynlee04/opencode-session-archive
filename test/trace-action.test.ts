import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { classify } from "../src/changes/model.ts"
import plugin from "../src/plugin.ts"
import { addMessage, addProject, addSession, makeDbFile, makeTmpDir, PROJECT_ID } from "./helpers.ts"

interface AddedTool {
  name: string
  options?: { namespace?: string; codemode?: boolean }
  description: string
  input?: Record<string, unknown>
  execute: (input: any, context: any) => Promise<{ content?: any; metadata?: any }>
}

const setup = async (options: Record<string, unknown>, projectRoot: string) => {
  const added: AddedTool[] = []
  const sessionHooks = new Map<string, (event: any) => Promise<void> | void>()
  const eventListeners: Array<(event: any) => Promise<void> | void> = []
  const ctx = {
    options,
    location: { project: { id: PROJECT_ID, canonical: projectRoot } },
    session: {
      hook: async (name: string, fn: (event: any) => Promise<void> | void) => {
        sessionHooks.set(name, fn)
        return { dispose: async () => {} }
      },
      context: async () => [],
      get: async (sessionID: string) => ({ id: sessionID, parentID: null }),
    },
    event: {
      subscribe: async (fn: (event: any) => Promise<void> | void) => {
        eventListeners.push(fn)
        return { dispose: async () => {} }
      },
    },
    rpc: { register: async () => ({ emit: () => {}, dispose: async () => {} }) },
    tool: {
      hook: async () => ({ dispose: async () => {} }),
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          list: () => added,
          get: (id: string) =>
            added.find((t) => (t.options?.namespace ? `${t.options.namespace}.${t.name}` : t.name) === id || t.name === id),
          namespace: () => {},
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
  return { added, findTool, sessionHooks, eventListeners }
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

function git(root: string, args: string[]): string {
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", root, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${Buffer.from(proc.stderr ?? []).toString("utf8")}`)
  }
  return Buffer.from(proc.stdout ?? []).toString("utf8").trim()
}

function initRepo(root: string): void {
  git(root, ["init", "-q"])
  git(root, ["config", "user.email", "trace@example.invalid"])
  git(root, ["config", "user.name", "Trace Test"])
  writeFileSync(path.join(root, "README.md"), "# trace test\n")
  git(root, ["add", "README.md"])
  git(root, ["commit", "-qm", "init"])
}

function toolPart(name: string, id: string, input: Record<string, unknown>): unknown {
  return {
    type: "tool",
    id,
    name,
    state: { status: "completed", input, content: [] },
  }
}

describe("change-set trace action (real git + real host ledger)", () => {
  test("write then edit reconstructs the full file and the trace action returns a bounded package plus leaf", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    const livePath = path.join(root, "src", "live.ts")
    const contentAfter = "export const live = 2\n"
    writeFileSync(livePath, contentAfter)
    writeFileSync(path.join(root, "src", "unattributed.ts"), "export const external = true\n")

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "trace test", time_created: 1000, time_updated: 2000 })
    addMessage(db, {
      id: "m1",
      session_id: "ses_root",
      type: "assistant",
      seq: 1,
      time_created: 2000,
      data: {
        content: [
          toolPart("write", "call_write", {
            path: livePath,
            content: "export const live = 1\n",
          }),
        ],
      },
    })
    addMessage(db, {
      id: "m2",
      session_id: "ses_root",
      type: "assistant",
      seq: 2,
      time_created: 2001,
      data: {
        content: [
          toolPart("edit", "call_edit", {
            path: livePath,
            oldString: "1",
            newString: "2",
          }),
        ],
      },
    })
    db.close()

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")
    const packageResult = await viewport.execute(
      { action: "trace", sessionID: "ses_root" },
      toolContext("ses_root"),
    )

    expect(packageResult.metadata.ok).toBe(true)
    expect(packageResult.metadata.state).toBe("dirty")
    expect(packageResult.metadata.source).toBe("git+host-ledger")
    expect(packageResult.metadata.coverage).toMatchObject({
      files: 2,
      actors: 1,
      missingFiles: [],
      missingActors: [],
    })
    expect(packageResult.metadata.counts.byAttribution.agent).toBe(1)
    expect(packageResult.metadata.packageTokens).toBeLessThanOrEqual(800)
    expect(String(packageResult.content)).toContain("src/live.ts")
    expect(String(packageResult.content)).toContain("change ")
    expect(existsSync(path.join(root, ".session-archive", "index.sqlite"))).toBe(false)

    const sourceHandle = (packageResult.metadata.handles as string[]).find((h) => h.endsWith(":source"))
    expect(sourceHandle).toBeString()
    const leafResult = await viewport.execute(
      { action: "trace", sessionID: "ses_root", handle: sourceHandle, path: "src/live.ts" },
      toolContext("ses_root"),
    )
    const leaf = JSON.parse(String(leafResult.content)) as {
      file: { path: string; attribution: string; proof: { rule: string; equal: boolean; expected: string; current: string } }
    }
    expect(leaf.file.path).toBe("src/live.ts")
    expect(leaf.file.attribution).toBe("agent")
    expect(leaf.file.proof.rule).toBe("ledger")
    expect(leaf.file.proof.equal).toBe(true)
    expect(leaf.file.proof.expected).toBe(leaf.file.proof.current)

    const branchLeaf = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "source", path: "src/live.ts" },
      toolContext("ses_root"),
    )
    const branchFile = JSON.parse(String(branchLeaf.content)) as { file: { path: string } }
    expect(branchFile.file.path).toBe("src/live.ts")

    const superseded = await viewport.execute(
      { action: "trace", sessionID: "ses_root", change: "000000000000" },
      toolContext("ses_root"),
    )
    expect(String(superseded.content)).toContain("requested 000000000000; live")

    const staleHandle = await viewport.execute(
      { action: "trace", sessionID: "ses_root", handle: "000000000000:source" },
      toolContext("ses_root"),
    )
    expect((JSON.parse(String(staleHandle.content)) as { error?: string }).error).toBe("stale-handle")
  })

  test("commit seal reports agent_sealed and the signal names the exact commit call", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    const livePath = path.join(root, "src", "sealed.ts")
    writeFileSync(livePath, "export const sealed = true\n")

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "trace commit", time_created: 1000, time_updated: 2000 })
    addMessage(db, {
      id: "m1",
      session_id: "ses_root",
      type: "assistant",
      seq: 1,
      time_created: 2000,
      data: {
        content: [
          toolPart("write", "call_write", {
            path: livePath,
            content: "export const sealed = true\n",
          }),
        ],
      },
    })
    db.close()

    git(root, ["add", "src/sealed.ts"])
    git(root, ["commit", "-qm", "seal sealed"])
    const head = git(root, ["rev-parse", "HEAD"])

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")
    const result = await viewport.execute(
      { action: "trace", sessionID: "ses_root", commit: head },
      toolContext("ses_root"),
    )

    expect(result.metadata.ok).toBe(true)
    expect(result.metadata.state).toBe("committed")
    expect(result.metadata.counts.byAttribution.agent_sealed).toBe(1)
    expect(result.metadata.coverage.missingFiles).toEqual([])
    expect(String(result.metadata.signal)).toContain(`trace({commit:"${head.slice(0, 12)}"})`)
    expect(String(result.content)).toContain("committed")
  })

  test("idle persists the change and the context hook injects the signal exactly once", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(path.join(root, "src", "idle.ts"), "export const idle = true\n")

    const hostDir = makeTmpDir()
    const { db, dbPath } = makeDbFile(hostDir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "trace idle", time_created: 1000, time_updated: 2000 })
    addMessage(db, {
      id: "m1",
      session_id: "ses_root",
      type: "assistant",
      seq: 1,
      time_created: 2000,
      data: {
        content: [
          toolPart("write", "call_write", {
            path: path.join(root, "src", "idle.ts"),
            content: "export const idle = true\n",
          }),
        ],
      },
    })
    db.close()

    const { findTool, sessionHooks, eventListeners } = await setup({ dbPath }, root)
    expect(eventListeners.length).toBeGreaterThan(0)
    await eventListeners[0]!({
      type: "session.status",
      properties: { sessionID: "ses_root", status: { type: "idle" } },
    })

    const hook = sessionHooks.get("context")
    expect(hook).toBeDefined()
    const first = { sessionID: "ses_root", messages: [], system: [] as any[] }
    await hook!(first)
    const injected = first.system.filter(
      (item) => typeof item === "object" && String(item.text ?? "").includes("[substrate]"),
    )
    expect(injected.length).toBe(1)
    expect(String(injected[0].text)).toContain('trace({change:"')

    const second = { sessionID: "ses_root", messages: [], system: [] as any[] }
    await hook!(second)
    const injectedAgain = second.system.filter(
      (item) => typeof item === "object" && String(item.text ?? "").includes("[substrate]"),
    )
    expect(injectedAgain.length).toBe(0)

    const archivePath = path.join(root, ".session-archive", "index.sqlite")
    expect(existsSync(archivePath)).toBe(true)
    const archive = new Database(archivePath, { readonly: true })
    const row = archive.query("SELECT id, session_id FROM change ORDER BY t DESC LIMIT 1").get() as
      | { id: string; session_id: string }
      | null
    const signal = archive.query("SELECT signal FROM pending_signal ORDER BY created_at DESC LIMIT 1").get() as
      | { signal: string }
      | null
    archive.close()
    expect(row?.session_id).toBe("ses_root")
    expect(String(signal?.signal)).toContain("[substrate]")

    // The archive's own files must not churn the change identity.
    const live = await findTool("substrate.viewport").execute(
      { action: "trace", sessionID: "ses_root" },
      toolContext("ses_root"),
    )
    expect(live.metadata.changeId).toBe(row?.id)
  })

  test("classifier maps real config and planning files instead of hiding them as unknown", () => {
    expect(classify(".gitignore")).toBe("config")
    expect(classify("opencode.json")).toBe("config")
    expect(classify(".planning/decisions.tsv")).toBe("plan")
    expect(classify("src/feature.ts")).toBe("source")
  })
})
