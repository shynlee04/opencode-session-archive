import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { sha256Hex } from "../src/archive/primitives.ts"
import {
  buildSubstrateSnapshot,
  executeSubstrateAction,
  runSubstrateCli,
} from "../src/cli.ts"
import { ensureCodeGraphSchema } from "../src/honeycomb/ast-skeleton.ts"
import { ensureCochangeSchema } from "../src/honeycomb/cochange.ts"
import {
  SUBSTRATE_RPC_ID,
  SUBSTRATE_UPDATED_EVENT,
  type SubstrateActionInput,
  type SubstrateSnapshotInput,
  type SubstrateUpdatedEvent,
  substrateRpcContract,
} from "../src/rpc.ts"
import { ensureContinuitySchema, shortBlobRef } from "../src/viewports/continuity.ts"
import {
  ensureSemanticDigestSchema,
  materializeSemanticDigests,
} from "../src/viewports/semantic-digest.ts"
import { addMessage, addProject, addSession, makeDbFile } from "./helpers.ts"

await import("@opentui/solid/preload" as string)
const { testRender } = await import("@opentui/solid")
const tuiExports = await import("../tui.tsx")
const { setup: setupTuiPlugin } = tuiExports

const TEST_SESSION_ID = "ses_vsc_r5_root"

describe("Unit VSC-R5: Full-Screen Mudball Advisor View, Focus-Gated Panel, Cross-Project CLI & Package Build", () => {
  let tmpRoot: string
  let siblingRoot: string
  let archiveDir: string
  let dbPath: string
  let db: Database

  beforeAll(() => {
    tmpRoot = join(tmpdir(), `hivemind-tui-cli-${Date.now()}`)
    siblingRoot = join(tmpdir(), `hivemind-sibling-${Date.now()}`)
    archiveDir = join(tmpRoot, ".session-archive")
    dbPath = join(archiveDir, "index.sqlite")
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    mkdirSync(join(siblingRoot, "src"), { recursive: true })
    mkdirSync(join(archiveDir, "sessions", TEST_SESSION_ID), { recursive: true })

    writeFileSync(
      join(siblingRoot, "package.json"),
      JSON.stringify({ name: "sibling-pkg", type: "module" }),
      "utf8",
    )
    writeFileSync(
      join(siblingRoot, "src/remote.ts"),
      [
        "export function computeSiblingMetric(multiplier: number): number {",
        "  return multiplier * 100",
        "}",
        "",
      ].join("\n"),
      "utf8",
    )

    // Create a large god symbol (>= 120 lines) + normal module to trigger mudball hotspots
    const godLines: string[] = [
      "export function orchestrateMegaWorkflow(input: string): string {",
    ]
    for (let i = 1; i <= 125; i++) {
      godLines.push(`  const step${i} = \`\${input}:${i}\``)
    }
    godLines.push("  return step125")
    godLines.push("}")
    godLines.push("")
    godLines.push("export function verifyGateContract(ok: boolean): string {")
    godLines.push("  return ok ? 'PASS' : 'FAIL'")
    godLines.push("}")
    godLines.push("")
    const coreCode = godLines.join("\n")

    const adapterCode = [
      "import { orchestrateMegaWorkflow, verifyGateContract } from './core.ts'",
      "",
      "export function runAdapter(label: string): string {",
      "  return `${orchestrateMegaWorkflow(label)}:${verifyGateContract(true)}`",
      "}",
      "",
    ].join("\n")

    writeFileSync(join(tmpRoot, "src/core.ts"), coreCode, "utf8")
    writeFileSync(join(tmpRoot, "src/adapter.ts"), adapterCode, "utf8")

    db = new Database(dbPath)
    ensureContinuitySchema(db)
    ensureSemanticDigestSchema(db)
    ensureCodeGraphSchema(db)
    ensureCochangeSchema(db)

    // Leave code_file empty initially so buildSubstrateSnapshot must auto-index via ensureCodeGraphIndexed!
    db.prepare(`
      INSERT INTO session (
        id, root_id, project_id, depth, lane_kind, lane_path, title,
        agent, harness, outcome, message_count, transcript_path, t_created, t_updated
      ) VALUES (?, ?, 'proj_r5', 0, 'root', '', 'Mudball Advisor & Fullscreen Route Session', 'ultra', 'opencode', 'succeeded', 4, ?, 1000, 5000)
    `).run(
      TEST_SESSION_ID,
      TEST_SESSION_ID,
      `sessions/${TEST_SESSION_ID}/${TEST_SESSION_ID}.jsonl`,
    )

    writeFileSync(
      join(archiveDir, "sessions", TEST_SESSION_ID, `${TEST_SESSION_ID}.jsonl`),
      [
        JSON.stringify({ kind: "session", id: TEST_SESSION_ID }),
        JSON.stringify({
          id: "msg_1",
          kind: "user",
          t: 1001,
          raw_ref: { session_id: TEST_SESSION_ID, message_id: "msg_1", seq: 1 },
          text: "Surface Mudball & Architecture Advisor in full-screen OpenTUI view and focus-gated panel",
        }),
      ].join("\n"),
      "utf8",
    )

    materializeSemanticDigests(db, { archiveDir })

    const coreLines = coreCode.split("\n")
    const sliceSha = sha256Hex(coreLines.slice(0, 10).join("\n"))
    const adapterSha = sha256Hex(adapterCode)

    const insertFile = db.prepare(`
      INSERT OR REPLACE INTO file_read_ledger (
        session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
        read_blob_sha, read_seq, disk_blob_sha, staleness_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertFile.run(
      TEST_SESSION_ID,
      "src/core.ts",
      "src/core.ts",
      "SLICE L1-L10 of 133 (truncated)",
      1,
      10,
      coreLines.length,
      1,
      sliceSha,
      1,
      sliceSha,
      "SLICE L1-L10 of 133 — FRESH SLICE",
    )
    insertFile.run(
      TEST_SESSION_ID,
      "src/adapter.ts",
      "src/adapter.ts",
      "all",
      1,
      adapterCode.split("\n").length,
      adapterCode.split("\n").length,
      0,
      adapterSha,
      2,
      adapterSha,
      "FRESH — DO NOT REREAD",
    )

    db.prepare(`
      INSERT OR REPLACE INTO provenance_chain (
        chain_id, root_session_id, finding_id, finding_summary, child_session_id,
        decision_pivot_seq, target_path, read_or_review_blob_sha, repair_blob_sha,
        verification_command, verification_exit_code, verification_blob_ref,
        disk_blob_sha, staleness_status, updated_at
      ) VALUES (
        'chain_r5_1', ?, 'F-VSC-R5', 'Verify Mudball Advisor and Fullscreen TUI Route',
        null, 1, 'src/adapter.ts', ?, ?, 'bun test test/tui-cli.test.ts', 0, ?, ?, 'VERIFIED_FRESH', '2026-10-18T00:00:00Z'
      )
    `).run(TEST_SESSION_ID, adapterSha, adapterSha, shortBlobRef(adapterSha), adapterSha)

    db.prepare(`
      CREATE TABLE IF NOT EXISTS working_valve_state (
        session_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL DEFAULT 'step-window',
        step_count INTEGER NOT NULL DEFAULT 0,
        watermark_step_index INTEGER NOT NULL DEFAULT 0,
        saved_chars INTEGER NOT NULL DEFAULT 0,
        saved_tokens INTEGER NOT NULL DEFAULT 0
      )
    `).run()
    db.prepare(`
      INSERT OR REPLACE INTO working_valve_state (
        session_id, mode, step_count, watermark_step_index, saved_chars, saved_tokens
      ) VALUES (?, 'step-window', 18, 12, 16800, 4200)
    `).run(TEST_SESSION_ID)

    // Add a hidden coupling row (has_static_edge = 0)
    db.prepare(`
      INSERT OR REPLACE INTO git_cochange (
        file_a, file_b, co_commits, commits_a, commits_b,
        prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
      ) VALUES (
        'src/core.ts', 'src/ shadow-config.ts', 4, 4, 4, 1.0, 1.0, 1.0, 0, '["coupled without static import"]'
      )
    `).run()
  })

  afterAll(() => {
    db?.close()
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
    if (siblingRoot) rmSync(siblingRoot, { recursive: true, force: true })
  })

  test("1. buildSubstrateSnapshot auto-indexes code_file, reconciles staleness, and populates topCentralFiles (with exportedSymbols), mudballHotspots, tokenEconomics, gateLabel, and compactionPreview", () => {
    const snap = buildSubstrateSnapshot(db, {
      projectRoot: tmpRoot,
      archiveDir,
      indexDbPath: dbPath,
      sessionID: TEST_SESSION_ID,
    })

    expect(snap.resolvedSessionID).toBe(TEST_SESSION_ID)
    expect(snap.gateLabel).toBe("PASS (all verified files fresh)")
    expect(snap.counts.freshFiles).toBe(1)
    expect(snap.counts.sliceFiles).toBe(1)
    expect(snap.topCentralFiles.length).toBeGreaterThanOrEqual(2)

    const coreEntry = snap.topCentralFiles.find((f) => f.path === "src/core.ts")
    expect(coreEntry).toBeDefined()
    expect(typeof coreEntry!.inDegree).toBe("number")
    expect(typeof coreEntry!.outDegree).toBe("number")
    expect(typeof coreEntry!.rawTokens).toBe("number")
    expect(typeof coreEntry!.skeletonTokens).toBe("number")
    expect(typeof coreEntry!.symbolsCount).toBe("number")
    expect(coreEntry!.exportedSymbols).toBeDefined()
    expect(coreEntry!.exportedSymbols!.some((s) => s.name === "orchestrateMegaWorkflow")).toBe(true)

    expect(snap.mudballHotspots).toBeDefined()
    expect(snap.mudballHotspots!.some((h) => h.kind === "god_symbol" && h.target.includes("orchestrateMegaWorkflow"))).toBe(true)
    expect(snap.mudballHotspots!.some((h) => h.kind === "hidden_coupling")).toBe(true)

    expect(snap.tokenEconomics).toBeDefined()
    expect(snap.tokenEconomics!.rawTokensTotal).toBeGreaterThan(0)
    expect(snap.tokenEconomics!.skeletonTokensTotal).toBeGreaterThan(0)
    expect(snap.tokenEconomics!.skeletonTokensSaved).toBeGreaterThan(0)
    expect(snap.tokenEconomics!.compressionPct).toBeGreaterThan(0)
    expect(snap.tokenEconomics!.valveSavedTokens).toBe(4200)

    expect(snap.compactionPreview).toBeDefined()
    expect(snap.compactionPreview).toContain("Headline & Gate")
    expect(snap.compactionPreview).toContain(TEST_SESSION_ID)
  })

  test("an empty session has no passing gate or inherited file counts", () => {
    const snap = buildSubstrateSnapshot(db, {
      projectRoot: tmpRoot,
      archiveDir,
      sessionID: "ses_unverified",
    })
    expect(snap.resolvedSessionID).toBe("ses_unverified")
    expect(snap.counts.freshFiles).toBe(0)
    expect(snap.counts.sliceFiles).toBe(0)
    expect(snap.gateLabel).toBe("UNVERIFIED (no passing verification receipt)")
  })

  test("the footer preserves unverified state and separates estimated AST reduction from pruning", async () => {
    const snapshot = {
      ...buildSubstrateSnapshot(db, { projectRoot: tmpRoot, archiveDir, sessionID: TEST_SESSION_ID }),
      gateLabel: "UNVERIFIED (no passing verification receipt)",
    }
    const screen = await testRender(
      () => tuiExports.SubstrateStatusPill({ snapshot: () => snapshot }),
      { width: 170, height: 4 },
    )
    try {
      await screen.renderOnce()
      const frame = screen.captureCharFrame()
      expect(frame).toContain("Gate: UNVERIFIED")
      expect(frame).not.toContain("Gate: PASS")
      expect(frame).toContain("AST est.")
      expect(frame).toContain("Pruned: 4200 tok")
      expect(frame).not.toContain("Saved: -")
    } finally {
      screen.renderer.destroy()
    }
  })

  test("2. executeSubstrateAction & runSubstrateCli support compaction preview, cross-project workspace resolution, and sync with OPENCODE_DB_PATH", async () => {
    // 2a. compaction CLI and action
    const compCli = await runSubstrateCli(["compaction", TEST_SESSION_ID], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(compCli.exitCode).toBe(0)
    expect(compCli.stdout).toContain("Substrate Continuity · Headline & Gate")
    expect(compCli.stdout).toContain(TEST_SESSION_ID)

    // 2b. Cross-project skeleton, slice, and repomap on siblingRoot
    const siblingFile = join(siblingRoot, "src/remote.ts")
    const skelCross = await executeSubstrateAction(
      db,
      { action: "skeleton", path: siblingFile },
      { projectRoot: tmpRoot, archiveDir, sessionID: TEST_SESSION_ID },
    )
    expect(skelCross.ok).toBe(true)
    expect(skelCross.markdown).toContain("computeSiblingMetric")

    const sliceCross = await executeSubstrateAction(
      db,
      { action: "slice", path: siblingFile, symbol: "computeSiblingMetric" },
      { projectRoot: tmpRoot, archiveDir, sessionID: TEST_SESSION_ID },
    )
    expect(sliceCross.ok).toBe(true)
    expect(sliceCross.markdown).toContain("return multiplier * 100")

    const repomapCross = await executeSubstrateAction(
      db,
      { action: "repomap", path: siblingFile },
      { projectRoot: tmpRoot, archiveDir, sessionID: TEST_SESSION_ID },
    )
    expect(repomapCross.ok).toBe(true)
    expect(repomapCross.markdown).toContain("src/remote.ts")

    // 2c. sync with OPENCODE_DB_PATH and --scope / --project flags
    const hostTmp = join(tmpdir(), `hivemind-host-db-${Date.now()}`)
    mkdirSync(hostTmp, { recursive: true })
    const { db: hostDb, dbPath: hostDbPath } = makeDbFile(hostTmp)
    addProject(hostDb, "proj_r5", tmpRoot)
    addSession(hostDb, {
      id: "ses_host_synced",
      project_id: "proj_r5",
      directory: tmpRoot,
      title: "Synced From Host DB",
    })
    addMessage(hostDb, {
      id: "m_host_1",
      session_id: "ses_host_synced",
      type: "user",
      seq: 1,
      data: { time: { created: 10 }, text: "Verify CLI sync ingests host DB sessions" },
    })
    hostDb.close()

    const prevEnv = process.env.OPENCODE_DB_PATH
    process.env.OPENCODE_DB_PATH = hostDbPath
    try {
      const syncRes = await runSubstrateCli(
        ["sync", "--scope=project", `--project=${tmpRoot}`, "--session", "ses_host_synced"],
        { projectRoot: tmpRoot, archiveDir, db },
      )
      expect(syncRes.exitCode).toBe(0)
      expect(syncRes.stdout).toContain("Substrate Sync Complete")
    } finally {
      if (prevEnv === undefined) delete process.env.OPENCODE_DB_PATH
      else process.env.OPENCODE_DB_PATH = prevEnv
      rmSync(hostTmp, { recursive: true, force: true })
    }
  })

  test("3. tui.tsx registers full-screen route (substrate), app slot commands, location-scoped RPC calls, events.on subscription, SubstrateView, and focus-gated SubstratePanel", async () => {
    const registeredSlots = new Map<string, (input: any) => any>()
    const registeredRoutes = new Map<string, (input: any) => any>()
    const navigatedDestinations: any[] = []
    const openedPanels: string[] = []
    let panelClosedCount = 0
    const keymapLayers: Array<() => any> = []
    const eventBusHandlers = new Map<string, (evt: any) => void>()
    const snapshotCalls: Array<{ input: SubstrateSnapshotInput; options?: any }> = []
    const actionCalls: Array<{ input: SubstrateActionInput; options?: any }> = []
    let failNextAction = false
    const currentRoute: any = { type: "session", sessionID: TEST_SESSION_ID }
    const toasts: Array<{ message: string; variant?: string }> = []

    const fakeContext = {
      location: {
        directory: tmpRoot,
        worktree: tmpRoot,
      },
      ui: {
        router: {
          register(page: { name: string; render: (input: any) => any }) {
            registeredRoutes.set(`${SUBSTRATE_RPC_ID}/${page.name}`, page.render)
            return () => registeredRoutes.delete(`${SUBSTRATE_RPC_ID}/${page.name}`)
          },
          navigate(dest: any) {
            const resolved = dest.type === "plugin" ? { ...dest, id: dest.id ?? SUBSTRATE_RPC_ID } : dest
            navigatedDestinations.push(resolved)
            for (const key of Object.keys(currentRoute)) delete currentRoute[key]
            Object.assign(currentRoute, resolved)
          },
          current() {
            return currentRoute
          },
        },
        panel: {
          current: () =>
            openedPanels.length > 0
              ? { name: openedPanels[openedPanels.length - 1]!, sessionID: TEST_SESSION_ID }
              : undefined,
          open(name: string) {
            if (currentRoute.type !== "session") return false
            openedPanels.push(name)
            return true
          },
          close() {
            openedPanels.pop()
            panelClosedCount++
          },
        },
        dialog: {
          clear() {},
        },
        toast: {
          show(opts: any) { toasts.push(opts) },
        },
        slot(def: { append?: string; replace?: string; render: (input: any) => any }) {
          const target = def.append ?? def.replace ?? "unknown"
          registeredSlots.set(target, def.render)
          return () => registeredSlots.delete(target)
        },
      },
      keymap: {
        layer(cb: () => any) {
          keymapLayers.push(cb)
        },
      },
      data: {
        on(_type: string, _handler: (evt: any) => void) {
          return () => {}
        },
      },
      client: {
        rpc(_def: typeof substrateRpcContract) {
          return {
            async snapshot(input: SubstrateSnapshotInput, options?: any) {
              snapshotCalls.push({ input, options })
              return buildSubstrateSnapshot(db, {
                projectRoot: tmpRoot,
                archiveDir,
                indexDbPath: dbPath,
                sessionID: input?.sessionID ?? TEST_SESSION_ID,
              })
            },
            async action(input: SubstrateActionInput, options?: any) {
              actionCalls.push({ input, options })
              if (failNextAction) {
                failNextAction = false
                return {
                  ok: false,
                  action: input.action,
                  summary: "action failed: test",
                  markdown: "action failed: test",
                  tokenEstimate: 0,
                  latencyMs: 1,
                }
              }
              return executeSubstrateAction(db, input, {
                projectRoot: tmpRoot,
                archiveDir,
                indexDbPath: dbPath,
                sessionID: input?.sessionID ?? TEST_SESSION_ID,
              })
            },
            events: {
              on(event: string, handler: (evt: { data: SubstrateUpdatedEvent }) => void) {
                eventBusHandlers.set(event, handler)
                return () => eventBusHandlers.delete(event)
              },
            },
          }
        },
      },
    }

    await setupTuiPlugin(fakeContext as any)

    // Verify RPC location option passing and events.on registration
    expect(snapshotCalls.length).toBeGreaterThanOrEqual(1)
    expect(snapshotCalls[0]!.options).toEqual({ location: { directory: tmpRoot } })
    expect(eventBusHandlers.has(SUBSTRATE_UPDATED_EVENT)).toBe(true)

    // Verify route registration & app slot mounting
    expect(registeredRoutes.has(`${SUBSTRATE_RPC_ID}/substrate`)).toBe(true)
    expect(registeredSlots.has("app")).toBe(true)

    // Mount the app slot to register SubstrateCommands
    registeredSlots.get("app")!({})
    const globalLayer = keymapLayers.map((fn) => fn()).find((l) => l.mode === "global")
    expect(globalLayer).toBeDefined()
    const cmdIds = (globalLayer.commands ?? []).map((c: any) => c.id)
    expect(cmdIds).toContain("substrate.open")
    expect(cmdIds).toContain("substrate.panel")
    expect(cmdIds).toContain("substrate.prune")
    expect(cmdIds).toContain("substrate.repomap")
    expect(cmdIds).toContain("substrate.provenance")
    expect(cmdIds).toContain("substrate.compaction")

    const openCmd = globalLayer.commands.find((c: any) => c.id === "substrate.open")
    openCmd.run()
    expect(openCmd.slash.arguments).toBeUndefined()
    const destination = navigatedDestinations.at(-1)
    expect(destination).toEqual({
      type: "plugin", id: SUBSTRATE_RPC_ID, name: "substrate", data: { sessionID: TEST_SESSION_ID },
    })
    expect(openedPanels).toHaveLength(0)
    expect(snapshotCalls[0]!.input.sessionID).toBe(TEST_SESSION_ID)

    eventBusHandlers.get(SUBSTRATE_UPDATED_EVENT)!({ data: { sessionID: "ses_unrelated_child" } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(snapshotCalls.at(-1)!.input.sessionID).toBe(TEST_SESSION_ID)

    const renderRoute = registeredRoutes.get(`${destination.id}/${destination.name}`)!
    expect(renderRoute).toBeDefined()
    const viewScreen = await testRender(
      () => renderRoute({ data: destination.data }),
      { width: 130, height: 44 },
    )
    try {
      await viewScreen.renderOnce()
      const viewFrame1 = viewScreen.captureCharFrame()
      expect(viewFrame1).toContain("HIVEMIND SUBSTRATE — MUDBALL & ARCHITECTURE ADVISOR")
      expect(viewFrame1).toContain("PASS (all verified files fresh)")
      expect(viewFrame1).toContain("Valve: 4200 tok saved")
      expect(viewFrame1).toContain("src/core.ts")
      expect(viewFrame1).toContain("orchestrateMegaWorkflow")
      expect(viewFrame1).toContain("HIDDEN COUPLING")

      // Press Enter in Tab 1 to load full live AST skeleton for selected file
      if (typeof (viewScreen.mockInput as any).pressEnter === "function") {
        await (viewScreen.mockInput as any).pressEnter()
      } else {
        await viewScreen.mockInput.pressKey("\r")
      }
      await new Promise((r) => setTimeout(r, 25))
      await viewScreen.renderOnce()
      expect(actionCalls.some((c) => c.input.action === "skeleton" && c.options?.location?.directory === tmpRoot)).toBe(true)

      // Press 4 to view Compaction Continuity Preview tab
      await viewScreen.mockInput.pressKey("4")
      await new Promise((r) => setTimeout(r, 25))
      await viewScreen.renderOnce()
      const viewFrame4 = viewScreen.captureCharFrame()
      expect(viewFrame4).toContain("Headline & Gate")
      await viewScreen.mockInput.pressEscape()
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(navigatedDestinations.at(-1)).toEqual({ type: "session", sessionID: TEST_SESSION_ID })
    } finally {
      viewScreen.renderer.destroy()
    }

    const panelCmd = globalLayer.commands.find((c: any) => c.id === "substrate.panel")
    panelCmd.run()
    expect(openedPanels).toEqual(["substrate.inspector"])
    panelCmd.run()
    expect(panelClosedCount).toBe(1)

    await globalLayer.commands.find((c: any) => c.id === "substrate.brief").run()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(actionCalls.at(-1)!.input.sessionID).toBe(TEST_SESSION_ID)
    expect(toasts.some((toast) => toast.variant === "success" && toast.message.includes("brief"))).toBe(true)

    failNextAction = true
    await globalLayer.commands.find((c: any) => c.id === "substrate.prune").run()
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(toasts.some((toast) => toast.variant === "error" && toast.message.includes("action failed: test"))).toBe(true)

    // Verify Focus-Gated Panel: when focused=false, keys do NOT trigger panel actions!
    const countBeforeUnfocused = actionCalls.length
    const unfocusedScreen = await testRender(
      () =>
        registeredSlots.get("session.panel")!({
          name: "substrate.inspector",
          sessionID: TEST_SESSION_ID,
          focused: false,
        }),
      { width: 110, height: 38 },
    )
    try {
      await unfocusedScreen.renderOnce()
      await unfocusedScreen.mockInput.pressKey("2")
      await unfocusedScreen.mockInput.pressKey("p")
      await new Promise((r) => setTimeout(r, 20))
      expect(actionCalls.length).toBe(countBeforeUnfocused)
    } finally {
      unfocusedScreen.renderer.destroy()
    }

    // Verify sidebar and footer status show Gate, Files: <fresh>F <slice>P <stale>S, Mudball alerts, and Saved tokens
    const statusAndSidebarScreen = await testRender(
      () =>
        tuiExports.renderSubstrateSlotHarness({
          statusRender: () => registeredSlots.get("prompt.footer.status")!({}),
          sidebarRender: () =>
            registeredSlots.get("sidebar.content")!({ sessionID: TEST_SESSION_ID }),
          panelRender: () => null as any,
        }),
      { width: 110, height: 24 },
    )
    try {
      await statusAndSidebarScreen.renderOnce()
      const statusFrame = statusAndSidebarScreen.captureCharFrame()
      expect(statusFrame).toContain("Gate: PASS")
      expect(statusFrame).toContain("Files: 1F 1P 0S")
      expect(statusFrame).toContain("Mudball alerts:")
      expect(statusFrame).toContain("AST est.")
    } finally {
      statusAndSidebarScreen.renderer.destroy()
    }
  })

  test("4. scripts/build.ts builds dist artifacts and local-build check validates opencode.json snapshot", () => {
    const repoRoot = resolve(import.meta.dir, "..")
    const proc = Bun.spawnSync(["bun", "run", "build"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(proc.exitCode).toBe(0)

    const pkgJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
    expect(pkgJson.name).toBe("hivemind-substrate")
    expect(pkgJson.exports["."]).toBe("./index.ts")
    expect(pkgJson.exports["./server"]).toBe("./index.ts")
    expect(pkgJson.exports["./tui"]).toBe("./tui.tsx")
    expect(pkgJson.exports["./rpc"]).toBe("./src/rpc.ts")

    expect(existsSync(join(repoRoot, "dist/session-archive.ts"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/tui.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/rpc.ts"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/tui/view.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/tui/panel.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/tui/sidebar.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/tui/status.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, "dist/src/tui/commands.tsx"))).toBe(true)
    expect(existsSync(join(repoRoot, ".opencode/plugins/session-archive.ts"))).toBe(false)
    expect(existsSync(join(repoRoot, ".opencode/plugins/hivemind-substrate"))).toBe(false)

    const opencodeConfigPath = join(repoRoot, "opencode.json")
    expect(existsSync(opencodeConfigPath)).toBe(true)
    const opencodeConfig = JSON.parse(readFileSync(opencodeConfigPath, "utf8"))
    const selectedPkg = opencodeConfig.plugins?.[0]?.package ?? ""
    expect(selectedPkg.includes("/.local-builds/")).toBe(true)
  })
})
