import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { sha256Hex } from "../src/archive/primitives.ts"
import {
  buildSubstrateSnapshot,
  executeSubstrateAction,
  runSubstrateCli,
} from "../src/cli.ts"
import { ensureCodeGraphSchema, indexCodebase } from "../src/honeycomb/ast-skeleton.ts"
import { ensureCochangeSchema } from "../src/honeycomb/cochange.ts"
import { computeCodebasePageRank } from "../src/honeycomb/pagerank.ts"
import {
  SUBSTRATE_RPC_ID,
  SUBSTRATE_UPDATED_EVENT,
  type SubstrateActionInput,
  type SubstrateActionOutput,
  type SubstrateSnapshotOutput,
  substrateRpcContract,
} from "../src/rpc.ts"
import { ensureContinuitySchema, shortBlobRef } from "../src/viewports/continuity.ts"
import {
  ensureSemanticDigestSchema,
  materializeSemanticDigests,
} from "../src/viewports/semantic-digest.ts"

await import("@opentui/solid/preload" as string)
const { testRender } = await import("@opentui/solid")
const {
  default: tuiPlugin,
  SUBSTRATE_PANEL_SLOT_ID,
  SUBSTRATE_SIDEBAR_SLOT_ID,
  setup: setupTuiPlugin,
} = await import("../tui.tsx")
const { renderSubstrateSlotHarness } = await import("../src/tui/panel.tsx")

const TEST_SESSION_ID = "ses_tui_rpc_root"

describe("VSC-R3: Portable RPC Contract, Native OpenTUI Solid Surface & CLI", () => {
  let tmpRoot: string
  let archiveDir: string
  let dbPath: string
  let db: Database

  beforeAll(() => {
    tmpRoot = join(tmpdir(), `hivemind-tui-rpc-${Date.now()}`)
    archiveDir = join(tmpRoot, ".session-archive")
    dbPath = join(archiveDir, "index.sqlite")
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    mkdirSync(join(archiveDir, "sessions", TEST_SESSION_ID), { recursive: true })

    const engineCode = [
      "export function executeEngineStep(step: number): string {",
      "  return `step:${step}`",
      "}",
      "",
      "export function verifyEngineReceipt(code: number): boolean {",
      "  return code === 0",
      "}",
      "",
    ].join("\n")

    const workerCode = [
      "import { executeEngineStep } from './engine.ts'",
      "",
      "export function runWorker(step: number): string {",
      "  return executeEngineStep(step)",
      "}",
      "",
    ].join("\n")

    writeFileSync(join(tmpRoot, "src/engine.ts"), engineCode, "utf8")
    writeFileSync(join(tmpRoot, "src/worker.ts"), workerCode, "utf8")

    db = new Database(dbPath)
    ensureContinuitySchema(db)
    ensureSemanticDigestSchema(db)
    ensureCodeGraphSchema(db)
    ensureCochangeSchema(db)

    indexCodebase(db, tmpRoot)
    computeCodebasePageRank(db)

    db.prepare(`
      INSERT INTO session (
        id, root_id, project_id, depth, lane_kind, lane_path, title,
        agent, harness, outcome, message_count, transcript_path, t_created, t_updated
      ) VALUES (?, ?, 'proj_tui', 0, 'root', '', 'TUI & RPC Verification Session', 'ultra', 'opencode', 'succeeded', 6, ?, 1000, 5000)
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
          text: "Build OpenTUI Solid panel and portable RPC contract for hivemind-substrate",
        }),
        JSON.stringify({
          id: "msg_2",
          kind: "user",
          t: 1002,
          raw_ref: { session_id: TEST_SESSION_ID, message_id: "msg_2", seq: 2 },
          text: "run bun test and verify the check gate to prove it works",
        }),
      ].join("\n"),
      "utf8",
    )

    materializeSemanticDigests(db, { archiveDir })

    const engineLines = engineCode.split("\n")
    const sliceSha = sha256Hex(engineLines.slice(0, 3).join("\n"))
    const workerSha = sha256Hex(workerCode)

    const insertFile = db.prepare(`
      INSERT OR REPLACE INTO file_read_ledger (
        session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
        read_blob_sha, read_seq, disk_blob_sha, staleness_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertFile.run(
      TEST_SESSION_ID,
      "src/engine.ts",
      "src/engine.ts",
      "SLICE L1-L3 of 8 (truncated)",
      1,
      3,
      engineLines.length,
      1,
      sliceSha,
      1,
      sliceSha,
      "SLICE L1-L3 of 8 — FRESH SLICE",
    )
    insertFile.run(
      TEST_SESSION_ID,
      "src/worker.ts",
      "src/worker.ts",
      "all",
      1,
      workerCode.split("\n").length,
      workerCode.split("\n").length,
      0,
      workerSha,
      2,
      workerSha,
      "FRESH — DO NOT REREAD",
    )

    const skillSha = sha256Hex("skill:opentui")
    db.prepare(`
      INSERT OR REPLACE INTO skill_load_ledger (
        session_id, skill_name, blob_sha, blob_ref, load_seq, status
      ) VALUES (?, 'opentui', ?, ?, 1, 'ACTIVE — DO NOT RE-INVOKE')
    `).run(TEST_SESSION_ID, skillSha, shortBlobRef(skillSha))

    db.prepare(`
      INSERT OR REPLACE INTO provenance_chain (
        chain_id, root_session_id, finding_id, finding_summary, child_session_id,
        decision_pivot_seq, target_path, read_or_review_blob_sha, repair_blob_sha,
        verification_command, verification_exit_code, verification_blob_ref,
        disk_blob_sha, staleness_status, updated_at
      ) VALUES (
        'chain_tui_1', ?, 'F-TUI-RPC-01', 'Verify RPC snapshot and OpenTUI panel rendering',
        null, 1, 'src/worker.ts', ?, ?, 'bun test test/tui-rpc.test.ts', 0, ?, ?, 'VERIFIED_FRESH', '2026-10-18T00:00:00Z'
      )
    `).run(TEST_SESSION_ID, workerSha, workerSha, shortBlobRef(workerSha), workerSha)

    db.prepare(`
      INSERT OR REPLACE INTO git_cochange (
        file_a, file_b, co_commits, commits_a, commits_b,
        prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json
      ) VALUES (
        'src/engine.ts', 'src/worker.ts', 4, 5, 4, 0.8, 1.0, 0.8, 0, '["couple engine and worker"]'
      )
    `).run()
  })

  afterAll(() => {
    db?.close()
    if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  })

  test("1. src/rpc.ts defines a zero-dependency StandardSchemaV1 portable RPC contract", () => {
    const rpcSource = readFileSync(
      join(import.meta.dir, "../src/rpc.ts"),
      "utf8",
    )
    const runtimeImports = rpcSource
      .split("\n")
      .filter((line) => line.startsWith("import ") && !line.startsWith("import type "))
    expect(runtimeImports).toEqual([])

    expect(SUBSTRATE_RPC_ID).toBe("hivemind-substrate")
    expect(substrateRpcContract.id).toBe("hivemind-substrate")

    const snapIn = substrateRpcContract.method.snapshot.input["~standard"].validate({
      sessionID: TEST_SESSION_ID,
    })
    expect("value" in snapIn && snapIn.value.sessionID).toBe(TEST_SESSION_ID)

    const actIn = substrateRpcContract.method.action.input["~standard"].validate({
      action: "repomap",
      maxTokens: 800,
    })
    expect("value" in actIn && actIn.value.action).toBe("repomap")

    const evtVal = substrateRpcContract.event[SUBSTRATE_UPDATED_EVENT]["~standard"].validate({
      sessionID: TEST_SESSION_ID,
      action: "sync",
      updatedAt: "2026-10-18T00:00:00Z",
    })
    expect("value" in evtVal && evtVal.value.action).toBe("sync")
  })

  test("2. tui.tsx registers session.panel, sidebar.content, prompt.footer.status, and keymap.layer commands and renders via @opentui/solid testRender", async () => {
    expect(tuiPlugin.id).toBe(SUBSTRATE_RPC_ID)
    expect(tuiPlugin.setup).toBe(setupTuiPlugin)

    const registeredSlots = new Map<string, (input: any) => any>()
    let registeredLayerFactory: (() => { mode?: string; commands?: any[] }) | null = null
    const rpcEventHandlers = new Map<string, (evt: any) => void>()
    const actionCalls: SubstrateActionInput[] = []

    const fakeContext = {
      ui: {
        panel: {
          current: undefined,
          open(_name?: string) {},
          close() {},
        },
        slot(def: { append?: string; replace?: string; render: (input: any) => any }) {
          const target = def.append ?? def.replace ?? "unknown"
          registeredSlots.set(target, def.render)
          return () => {
            registeredSlots.delete(target)
          }
        },
      },
      keymap: {
        layer(cb: () => { mode?: string; commands?: any[] }) {
          registeredLayerFactory = cb
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
            async snapshot(input: any): Promise<any> {
              return buildSubstrateSnapshot(db, {
                projectRoot: tmpRoot,
                archiveDir,
                indexDbPath: dbPath,
                sessionID: input?.sessionID ?? TEST_SESSION_ID,
              })
            },
            async action(input: any): Promise<any> {
              actionCalls.push(input)
              return executeSubstrateAction(db, input, {
                projectRoot: tmpRoot,
                archiveDir,
                indexDbPath: dbPath,
                sessionID: TEST_SESSION_ID,
              })
            },
            on(event: string, handler: (evt: any) => void) {
              rpcEventHandlers.set(event, handler)
              return () => {
                rpcEventHandlers.delete(event)
              }
            },
          }
        },
      },
    }

    await setupTuiPlugin(fakeContext as any)

    expect(typeof registeredSlots.get("session.panel")).toBe("function")
    expect(typeof registeredSlots.get("sidebar.content")).toBe("function")
    expect(typeof registeredSlots.get("prompt.footer.status")).toBe("function")
    expect(registeredLayerFactory).not.toBeNull()

    const layer = registeredLayerFactory!()
    expect(layer.mode).toBe("global")
    expect((layer.commands ?? []).map((c: any) => c.id)).toEqual([
      "substrate.open",
      "substrate.sync",
      "substrate.provenance",
      "substrate.prune",
      "substrate.brief",
    ])

    const screen = await testRender(
      () =>
        renderSubstrateSlotHarness({
          statusRender: () => registeredSlots.get("prompt.footer.status")!({}),
          sidebarRender: () =>
            registeredSlots.get("sidebar.content")!({ sessionID: TEST_SESSION_ID }),
          panelRender: () =>
            registeredSlots.get("session.panel")!({
              name: SUBSTRATE_PANEL_SLOT_ID,
              sessionID: TEST_SESSION_ID,
            }),
        }),
      { width: 110, height: 42 },
    )

    try {
      await screen.renderOnce()
      const frame1 = screen.captureCharFrame()
      expect(frame1).toContain("Hivemind Substrate Inspector")
      expect(frame1).toContain(TEST_SESSION_ID)
      expect(frame1).toContain("1 FRESH · 1 SLICE")
      expect(frame1).toContain("Files: 1F 1P 0S")

      await screen.mockInput.pressKey("2")
      await new Promise((resolve) => setTimeout(resolve, 20))
      await screen.renderOnce()

      expect(actionCalls.some((c) => c.action === "provenance")).toBe(true)
      const frame2 = screen.captureCharFrame()
      expect(frame2).toContain("[2:Provenance]")
      expect(frame2).toContain("Active Viewport Output (provenance")
      expect(frame2).toContain("SLICE L1-L3 of 7 — FRESH SLICE")
    } finally {
      screen.renderer.destroy()
    }
  })

  test("3. src/cli.ts supports status, repomap, skeleton, slice, coupled, provenance, timeline, search, brief, prune, and --json", async () => {
    const statusRes = await runSubstrateCli(["status", "--session", TEST_SESSION_ID], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(statusRes.exitCode).toBe(0)
    expect(statusRes.stdout).toContain("Headline & Gate")
    expect(statusRes.stdout).toContain("SLICE L1-L3 of 7 — FRESH SLICE")

    const jsonStatusRes = await runSubstrateCli(["status", "--json", "--session", TEST_SESSION_ID], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(jsonStatusRes.exitCode).toBe(0)
    const parsedStatus = JSON.parse(jsonStatusRes.stdout) as SubstrateActionOutput & {
      snapshot: SubstrateSnapshotOutput
    }
    expect(parsedStatus.ok).toBe(true)
    expect(parsedStatus.snapshot.resolvedSessionID).toBe(TEST_SESSION_ID)
    expect(parsedStatus.snapshot.counts.freshFiles).toBe(1)
    expect(parsedStatus.snapshot.counts.sliceFiles).toBe(1)

    const repomapRes = await runSubstrateCli(["repomap"], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(repomapRes.exitCode).toBe(0)
    expect(repomapRes.stdout).toContain("src/engine.ts")

    const skelRes = await runSubstrateCli(["skeleton", "--path", "src/engine.ts"], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(skelRes.exitCode).toBe(0)
    expect(skelRes.stdout).toContain("executeEngineStep")

    const sliceRes = await runSubstrateCli(
      ["slice", "--path", "src/engine.ts", "--symbol", "executeEngineStep"],
      {
        projectRoot: tmpRoot,
        archiveDir,
        db,
      },
    )
    expect(sliceRes.exitCode).toBe(0)
    expect(sliceRes.stdout).toContain("executeEngineStep")
    expect(sliceRes.stdout).toContain("L1:")

    const coupledRes = await runSubstrateCli(["coupled", "--path", "src/engine.ts"], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(coupledRes.exitCode).toBe(0)
    expect(coupledRes.stdout).toContain("src/worker.ts")

    const provRes = await runSubstrateCli(["provenance", "--session", TEST_SESSION_ID], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(provRes.exitCode).toBe(0)
    expect(provRes.stdout).toContain("F-TUI-RPC-01")
    expect(provRes.stdout).toContain("SLICE L1-L3 of 7 — FRESH SLICE")

    const timelineRes = await runSubstrateCli(["timeline", "--session", TEST_SESSION_ID], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(timelineRes.exitCode).toBe(0)
    expect(timelineRes.stdout).toContain("[initial_goal]")
    expect(timelineRes.stdout).toContain("[verification_directive]")

    const searchRes = await runSubstrateCli(["search", "--query", "OpenTUI Solid panel RPC"], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(searchRes.exitCode).toBe(0)
    expect(searchRes.stdout).toContain(TEST_SESSION_ID)
    expect(searchRes.stdout).toMatch(/coverage=\d+\/\d+/)

    const briefRes = await runSubstrateCli(
      ["brief", "--path", "src/engine.ts,src/worker.ts", "--symbol", "executeEngineStep"],
      {
        projectRoot: tmpRoot,
        archiveDir,
        db,
      },
    )
    expect(briefRes.exitCode).toBe(0)
    expect(briefRes.stdout).toContain("# Implementor Viewport Brief")
    expect(briefRes.stdout).toContain("executeEngineStep")

    const pruneRes = await runSubstrateCli(["prune", "--mode", "manual"], {
      projectRoot: tmpRoot,
      archiveDir,
      db,
    })
    expect(pruneRes.exitCode).toBe(0)
    expect(pruneRes.stdout).toContain("Working-Set Valve Prune")
  })
})
