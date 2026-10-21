import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { classify } from "../src/changes/model.ts"
import { runSubstrateCli } from "../src/cli.ts"
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

function toolPart(name: string, id: string, input: Record<string, unknown>, outputText = ""): unknown {
  return {
    type: "tool",
    id,
    name,
    state: {
      status: "completed",
      input,
      content: outputText ? [{ type: "text", text: outputText }] : [],
    },
  }
}

describe("change-set trace action (Iteration 2 — project-agnostic git + host ledger + test evidence + actor leaf)", () => {
  test("write then edit reconstructs the full file and the trace action returns a bounded package plus diff-bearing leaf", async () => {
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

  test("HEAD-seeded edit without full-file read proves agent attribution, pre-existing mtime files stay pre_existing, and child actor + test evidence resolve in 2 calls", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    const trackedPath = path.join(root, "src", "tracked.ts")
    writeFileSync(trackedPath, "export function calc() {\n  return 10\n}\n")
    const preExistingPath = path.join(root, "src", "old-dirty.ts")
    writeFileSync(preExistingPath, "export const old = 1\n")
    git(root, ["add", "src/tracked.ts", "src/old-dirty.ts"])
    git(root, ["commit", "-qm", "add tracked files"])

    // Dirty old-dirty.ts with an mtime strictly before session runStart (t=5000)
    writeFileSync(preExistingPath, "export const old = 2\n")
    utimesSync(preExistingPath, new Date(1000), new Date(1000))

    // Modify tracked.ts as if edited by a child subagent without a full-file read
    writeFileSync(trackedPath, "export function calc() {\n  return 42\n}\n")

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "orchestrator root", time_created: 5000, time_updated: 7000 })
    addSession(db, {
      id: "ses_child_worker",
      parent_id: "ses_root",
      directory: root,
      title: "Fix calc return value",
      time_created: 5500,
      time_updated: 6500,
    })
    addMessage(db, {
      id: "m_child_1",
      session_id: "ses_child_worker",
      type: "assistant",
      seq: 1,
      time_created: 6000,
      data: {
        content: [
          // Edit WITHOUT any prior full-file read -> seeded from git HEAD blob!
          toolPart("edit", "call_edit_seeded", {
            path: trackedPath,
            oldString: "return 10",
            newString: "return 42",
          }),
          toolPart(
            "bash",
            "call_test_1",
            { command: "bun test test/calc.test.ts" },
            "1 pass\n0 fail\nRan 1 tests across 1 file.\nCommand exited with code 0.",
          ),
          {
            type: "text",
            text: "Updated calc() to return 42 and verified bun test passes.",
          },
        ],
      },
    })
    db.close()

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")

    // Call 1: package view
    const pkg = await viewport.execute({ action: "trace", sessionID: "ses_root" }, toolContext("ses_root"))
    expect(pkg.metadata.ok).toBe(true)
    expect(pkg.metadata.counts.byAttribution.agent).toBe(1)
    expect(pkg.metadata.counts.byAttribution.pre_existing).toBe(1)
    expect(pkg.metadata.counts.byAttribution.owner_or_external ?? 0).toBe(0)
    expect(String(pkg.content)).toContain("evidence")
    expect(String(pkg.content)).toContain("pass:bun test test/calc.test.ts")
    expect(String(pkg.content)).toContain("ses_child_worker(delegation 1f 1chk)")

    // Call 2a: zoom into the file leaf -> proves HEAD-seeded edit chain + includes unified git diff
    const fileLeafRes = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "source", path: "src/tracked.ts" },
      toolContext("ses_root"),
    )
    const fileLeaf = JSON.parse(String(fileLeafRes.content)) as {
      file: {
        path: string
        attribution: string
        proof: { rule: string; equal: boolean; session: string }
        diffExcerpt?: string
      }
    }
    expect(fileLeaf.file.attribution).toBe("agent")
    expect(fileLeaf.file.proof.rule).toBe("ledger")
    expect(fileLeaf.file.proof.equal).toBe(true)
    expect(fileLeaf.file.proof.session).toBe("ses_child_worker")
    expect(fileLeaf.file.diffExcerpt).toContain("-  return 10")
    expect(fileLeaf.file.diffExcerpt).toContain("+  return 42")

    // Call 2b: zoom into the child actor leaf -> returns touched files, test checks, and final conclusion
    const actorLeafRes = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "actors", path: "ses_child_worker" },
      toolContext("ses_root"),
    )
    const actorLeaf = JSON.parse(String(actorLeafRes.content)) as {
      actor: { session: string; title: string; filesTouched: number; checksRun: number; lastCheck: string; conclusion: string }
      files: Array<{ path: string; op: string; attribution: string; fresh: string }>
      evidence: Array<{ command: string; outcome: string }>
    }
    expect(actorLeaf.actor.session).toBe("ses_child_worker")
    expect(actorLeaf.actor.title).toBe("Fix calc return value")
    expect(actorLeaf.actor.filesTouched).toBe(1)
    expect(actorLeaf.actor.checksRun).toBe(1)
    expect(actorLeaf.actor.lastCheck).toBe("pass")
    expect(actorLeaf.actor.conclusion).toContain("Updated calc() to return 42")
    expect(actorLeaf.files).toEqual([{ path: "src/tracked.ts", op: "modify", attribution: "agent", fresh: "fresh" }])
    expect(actorLeaf.evidence[0]?.outcome).toBe("pass")
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

    // A subsequent idle on the same unchanged change.id must NOT re-arm the already-consumed signal.
    await eventListeners[0]!({
      type: "session.status",
      properties: { sessionID: "ses_root", status: { type: "idle" } },
    })
    const third = { sessionID: "ses_root", messages: [], system: [] as any[] }
    await hook!(third)
    const injectedThird = third.system.filter(
      (item) => typeof item === "object" && String(item.text ?? "").includes("[substrate]"),
    )
    expect(injectedThird.length).toBe(0)

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

  test("project-agnostic classifier maps code, tests, scripts, and configs while treating .planning and .audit artifacts as docs context", () => {
    expect(classify(".gitignore")).toBe("config")
    expect(classify("opencode.json")).toBe("config")
    expect(classify("requirements-dev.txt")).toBe("config")
    expect(classify(".planning/decisions.tsv")).toBe("docs")
    expect(classify(".audit/2026-10-19/run.md")).toBe("docs")
    expect(classify(".audit/2026-10-12-architecture-reconciliation/prototype/variant.test.ts")).toBe("docs")
    expect(classify(".agents/skills/agentmd-deep-init/scripts/scan-chunk.sh")).toBe("source")
    expect(classify("src/feature.ts")).toBe("source")
    expect(classify("test/feature.test.ts")).toBe("test")
  })

  test("redacts blocked secret files on any branch and synthesizes diff excerpt for untracked added files", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(path.join(root, ".env"), "NPM_HMOC_STEWARD_KEY=super_secret_token_value\n")
    writeFileSync(path.join(root, "src", "added.ts"), "export const added = 123\n")

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "secret & add test", time_created: 1000, time_updated: 2000 })
    addMessage(db, {
      id: "m1",
      session_id: "ses_root",
      type: "assistant",
      seq: 1,
      time_created: 1500,
      data: {
        content: [
          toolPart("write", "call_add", {
            path: path.join(root, "src", "added.ts"),
            content: "export const added = 123\n",
          }),
        ],
      },
    })
    db.close()

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")

    // Querying .env via branch:"source" must still redact and never leak secret content or diffExcerpt
    const secretViaSource = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "source", path: ".env" },
      toolContext("ses_root"),
    )
    const secretRaw = String(secretViaSource.content)
    expect(secretRaw).not.toContain("super_secret_token_value")
    expect(secretRaw).not.toContain("diffExcerpt")
    const secretParsed = JSON.parse(secretRaw) as {
      branch: string
      file: { path: string; kind: string; materiality: string; blocked: boolean; diffExcerpt?: string }
    }
    expect(secretParsed.branch).toBe("blocked")
    expect(secretParsed.file.blocked).toBe(true)
    expect(secretParsed.file.diffExcerpt).toBeUndefined()

    // Querying untracked added file includes synthetic unified diff
    const addedLeaf = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "source", path: "src/added.ts" },
      toolContext("ses_root"),
    )
    const addedParsed = JSON.parse(String(addedLeaf.content)) as {
      file: { path: string; op: string; diffExcerpt?: string }
    }
    expect(addedParsed.file.op).toBe("add")
    expect(addedParsed.file.diffExcerpt).toContain("+export const added = 123")
  })

  test("marks evidence stale after later code mutation, ignores git commit trailers, detects multi-suite failures, walks upward from child sessionID, and rejects unsafe commit flags", async () => {
    const root = makeTmpDir()
    initRepo(root)
    mkdirSync(path.join(root, "src"), { recursive: true })
    const codePath = path.join(root, "src", "service.ts")
    writeFileSync(codePath, "export const v = 2\n")
    utimesSync(codePath, new Date(8000), new Date(8000))

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    addSession(db, { id: "ses_root", directory: root, title: "root session", time_created: 5000, time_updated: 9000 })
    addSession(db, {
      id: "ses_child",
      parent_id: "ses_root",
      directory: root,
      title: "child worker",
      time_created: 5500,
      time_updated: 8500,
    })
    addMessage(db, {
      id: "m_child",
      session_id: "ses_child",
      type: "assistant",
      seq: 1,
      time_created: 6000,
      data: {
        content: [
          toolPart("bash", "call_test_pass", { command: "bun run test" }, "5 pass\n0 fail\nCommand exited with code 0."),
          toolPart(
            "bash",
            "call_git_commit",
            { command: 'git commit -m "feat" --trailer "Verified-by: bun run test"' },
            "[main abc1234] feat",
          ),
          toolPart(
            "bash",
            "call_multi_fail",
            { command: "bun test" },
            "suite A: 10 pass, 0 fail\nsuite B: 2 pass, 1 fail",
          ),
        ],
      },
    })
    addMessage(db, {
      id: "m_root_later_write",
      session_id: "ses_root",
      type: "assistant",
      seq: 2,
      time_created: 7500,
      data: {
        content: [
          toolPart("write", "call_write_later", {
            path: codePath,
            content: "export const v = 2\n",
          }),
        ],
      },
    })
    db.close()

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")

    // Passing child sessionID walks upward to ses_root and includes both actors + root's write
    const pkg = await viewport.execute({ action: "trace", sessionID: "ses_child" }, toolContext("ses_child"))
    expect(pkg.metadata.ok).toBe(true)
    expect(pkg.metadata.coverage.actors).toBe(2)
    expect(pkg.metadata.counts.byAttribution.agent).toBe(1)
    expect(String(pkg.content)).toContain("(stale)")

    const evLeafRes = await viewport.execute(
      { action: "trace", sessionID: "ses_child", branch: "evidence" },
      toolContext("ses_child"),
    )
    const evLeaf = JSON.parse(String(evLeafRes.content)) as {
      evidence: Array<{ command: string; outcome: string; fresh: string }>
    }
    // git commit --trailer must not be recorded as verification evidence
    expect(evLeaf.evidence.length).toBe(2)
    expect(evLeaf.evidence[0]?.outcome).toBe("pass")
    expect(evLeaf.evidence[0]?.fresh).toBe("stale")
    expect(evLeaf.evidence[1]?.outcome).toBe("fail")
    expect(evLeaf.evidence[1]?.fresh).toBe("stale")

    // Unsafe git flag injection in commit parameter must be rejected
    const badCommit = await viewport.execute(
      { action: "trace", sessionID: "ses_root", commit: "--output=/tmp/injected" },
      toolContext("ses_root"),
    )
    expect(badCommit.metadata.ok).toBe(false)

    // CLI parity for trace action
    const prevEnv = process.env.OPENCODE_DB_PATH
    process.env.OPENCODE_DB_PATH = dbPath
    try {
      const cliRes = await runSubstrateCli(["trace", "--project-root", root, "--session", "ses_child"])
      expect(cliRes.exitCode).toBe(0)
      expect(cliRes.stdout).toContain("change ")
    } finally {
      if (prevEnv === undefined) delete process.env.OPENCODE_DB_PATH
      else process.env.OPENCODE_DB_PATH = prevEnv
    }
  })

  test("discovers linked git worktree edits, preserves committed session slices as agent_sealed, parses patchText, ignores pre-existing deletions, and supports resolve query search", async () => {
    const root = makeTmpDir()
    initRepo(root)
    writeFileSync(path.join(root, ".gitignore"), ".worktree/\n")
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(path.join(root, "src", "core.ts"), "export const version = 1\n")
    writeFileSync(path.join(root, "src", "legacy.ts"), "export const legacy = true\n")
    git(root, ["add", ".gitignore", "src/core.ts", "src/legacy.ts"])
    git(root, ["commit", "-qm", "base with core and legacy"])

    // Delete legacy.ts on disk without any ledger touch -> must be pre_existing, never owner_or_external
    rmSync(path.join(root, "src", "legacy.ts"))

    // Create a linked git worktree under .worktree/lane-a (ignored by root's .gitignore)
    const laneDir = path.join(root, ".worktree", "lane-a")
    mkdirSync(path.join(root, ".worktree"), { recursive: true })
    git(root, ["worktree", "add", laneDir, "-b", "lane/a"])

    // Edit src/core.ts inside the linked worktree
    const laneCorePath = path.join(laneDir, "src", "core.ts")
    writeFileSync(laneCorePath, "export const version = 2\n")

    // Also write and commit a sealed file in root during the session
    const sealedPath = path.join(root, "src", "committed-in-session.ts")
    writeFileSync(sealedPath, "export const sealedSlice = true\n")
    git(root, ["add", "src/committed-in-session.ts"])
    git(root, ["commit", "-qm", "commit slice during session"])

    // Also add a patched doc via OpenCode patchText
    mkdirSync(path.join(root, "docs"), { recursive: true })
    const notePath = path.join(root, "docs", "note.md")
    writeFileSync(notePath, "# Runtime Note\nVerified alignment.\n")

    const dir = makeTmpDir()
    const { db, dbPath } = makeDbFile(dir)
    addProject(db)
    const nowMs = Date.now()
    addSession(db, {
      id: "ses_root",
      directory: root,
      title: "multi-worktree root",
      time_created: nowMs - 10_000,
      time_updated: nowMs,
    })
    addSession(db, {
      id: "ses_lane_worker",
      parent_id: "ses_root",
      directory: root,
      title: "Lane A Worker",
      time_created: nowMs - 8_000,
      time_updated: nowMs - 1_000,
    })
    addMessage(db, {
      id: "m_root_seal",
      session_id: "ses_root",
      type: "assistant",
      seq: 1,
      time_created: nowMs - 9_000,
      data: {
        content: [
          toolPart("write", "call_write_sealed", {
            path: sealedPath,
            content: "export const sealedSlice = true\n",
          }),
          toolPart("patch", "call_patch_doc", {
            patchText: `*** Begin Patch\n*** Add File: ${notePath}\n+# Runtime Note\n+Verified alignment.\n`,
          }),
        ],
      },
    })
    addMessage(db, {
      id: "m_lane_edit",
      session_id: "ses_lane_worker",
      type: "assistant",
      seq: 1,
      time_created: nowMs - 2_000,
      data: {
        content: [
          // Unseeded edit in linked worktree -> seeded on demand from lane worktree HEAD!
          toolPart("edit", "call_lane_edit", {
            path: laneCorePath,
            oldString: "version = 1",
            newString: "version = 2",
          }),
          toolPart("write", "call_tmp_probe", {
            path: "/tmp/ephemeral-probe-outside-repo.ts",
            content: "export const probe = 1\n",
          }),
          toolPart(
            "shell",
            "call_lane_test",
            { command: `cd ${laneDir} && bun test src/core.test.ts 2>&1 | tail -5` },
            "3 pass\n0 fail\nCommand exited with code 0.",
          ),
        ],
      },
    })
    db.close()

    const { findTool } = await setup({ dbPath }, root)
    const viewport = findTool("substrate.viewport")

    const pkg = await viewport.execute({ action: "trace", sessionID: "ses_root" }, toolContext("ses_root"))
    expect(pkg.metadata.ok).toBe(true)
    // Both the dirty linked-worktree file (agent) AND the committed session file (agent_sealed) are material!
    expect(pkg.metadata.counts.material).toBe(2)
    expect(pkg.metadata.counts.byAttribution.agent).toBe(2) // laneCorePath + notePath (via patch)
    expect(pkg.metadata.counts.byAttribution.agent_sealed).toBe(1) // sealedPath
    expect(pkg.metadata.counts.byAttribution.pre_existing).toBe(1) // deleted legacy.ts
    expect(pkg.metadata.counts.byAttribution.owner_or_external ?? 0).toBe(0)
    expect(pkg.metadata.notes).toEqual([]) // 0 fragments and 0 non-scratch outside writes!
    expect(String(pkg.content)).toContain(".worktree/lane-a/src/core.ts")
    expect(String(pkg.content)).toContain("src/committed-in-session.ts sealed")
    expect(String(pkg.content)).toContain("pass:[lane-a] bun test src/core.test.ts")

    // Zoom into linked-worktree file leaf -> returns unified diff from linked worktree
    const laneLeafRes = await viewport.execute(
      { action: "trace", sessionID: "ses_root", branch: "source", path: ".worktree/lane-a/src/core.ts" },
      toolContext("ses_root"),
    )
    const laneLeaf = JSON.parse(String(laneLeafRes.content)) as {
      file: { path: string; attribution: string; diffExcerpt?: string }
    }
    expect(laneLeaf.file.attribution).toBe("agent")
    expect(laneLeaf.file.diffExcerpt).toContain("-export const version = 1")
    expect(laneLeaf.file.diffExcerpt).toContain("+export const version = 2")

    // Verify resolve with query filters matching lines with context in 1 call
    mkdirSync(path.join(root, ".session-archive", "blobs"), { recursive: true })
    const sampleBlob = Array.from({ length: 30 }, (_, i) => `line ${i + 1}: ${i === 14 ? "N1 target finding here" : "filler"}`).join("\n")
    writeFileSync(path.join(root, ".session-archive", "blobs", "deadbeef1234.txt"), sampleBlob)
    const resolvedQuery = await viewport.execute(
      { action: "resolve", blob: "deadbeef1234", query: "N1 target" },
      toolContext("ses_root"),
    )
    expect(String(resolvedQuery.content)).toContain("L15: line 15: N1 target finding here")
    expect(String(resolvedQuery.content)).toContain("L12: line 12: filler")
    expect(String(resolvedQuery.content)).not.toContain("L1: line 1: filler")
  })
})
