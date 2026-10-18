import { Database } from "bun:sqlite"
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  type WfSub04PrototypeReport,
  SubstrateSyncCoordinator,
  configureWalPragmas,
  initSyncDatabase,
  inspectHostQueryPlans,
  rewindWatermarkForDeltaTurn,
  runWfSub04Prototype,
  syncSessionTreeFullBaseline,
  syncSessionTreeIncremental,
  verifyWalConcurrency,
} from "./wf-sub-04-incremental-sync"

const SQLITE_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-sync.sqlite"
const BLOB_DIR =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-04-blobs"

let report: WfSub04PrototypeReport
let db: Database

beforeAll(async () => {
  report = await runWfSub04Prototype({
    targetSqlitePath: SQLITE_PATH,
    targetBlobDir: BLOB_DIR,
    benchmarkRounds: 7,
  })
  db = new Database(SQLITE_PATH, { readonly: true })
}, 30_000)

afterAll(() => {
  db?.close()
})

describe("WF-SUB-04 Watermark-Gated Incremental SQLite Sync & Hook Latency Prototype", () => {
  test("1. Host opencode.db (2.15+ GB) EXPLAIN QUERY PLAN verifies B-tree index coverage and kv limiter", () => {
    const q = report.queryPlanInspection
    expect(q.hostDbSizeBytes).toBeGreaterThan(2_000_000_000)
    expect(q.hostDbSizeGB).toBeGreaterThanOrEqual(2.15)
    expect(q.sessionV2TotalRows).toBeGreaterThanOrEqual(900)
    expect(q.sessionMessageTotalRows).toBeGreaterThanOrEqual(22000)
    expect(q.kvTotalRows).toBeGreaterThanOrEqual(1600)

    expect(q.hasSessionParentIndex).toBe(true)
    expect(q.hasMessageSessionSeqIndex).toBe(true)
    expect(q.hasKvPrimaryKeyIndex).toBe(true)
    // kv has no secondary index on time_updated — full time_updated filter causes SCAN kv
    expect(q.hasKvTimeUpdatedIndex).toBe(false)
    expect(q.kvByTimeUpdatedScanPlan.join(" ")).toContain("SCAN kv")
    expect(q.messageBySessionAndSeqDeltaPlan.join(" ")).toContain(
      "SEARCH session_message USING INDEX session_message_session_seq_idx (session_id=? AND seq>?)",
    )
  })

  test("2. Cold baseline sync populates sync_watermark and spine tables for ses_eb23bfbf0ffesn5kT0yJI06h35 & ses_ecbfc0f40ffenfykTrNGoMS6o1", () => {
    expect(existsSync(SQLITE_PATH)).toBe(true)
    expect(statSync(SQLITE_PATH).size).toBeGreaterThan(100_000)

    // Verify sync_watermark schema columns
    const wmCols = (db.query("SELECT name FROM pragma_table_info('sync_watermark')").all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(wmCols).toEqual([
      "session_id",
      "root_id",
      "last_time_updated",
      "last_max_seq",
      "last_message_id",
      "last_kv_updated",
      "synced_at",
    ])

    // Verify watermarks for P2 (ses_eb23bfbf0ffesn5kT0yJI06h35) and P1 (ses_ecbfc0f40ffenfykTrNGoMS6o1)
    const p2RootWm = db
      .query("SELECT * FROM sync_watermark WHERE session_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'")
      .get() as Record<string, unknown> | null
    expect(p2RootWm).not.toBeNull()
    expect(p2RootWm?.root_id).toBe("ses_eb23bfbf0ffesn5kT0yJI06h35")
    expect(Number(p2RootWm?.last_max_seq)).toBeGreaterThanOrEqual(4399)
    expect(String(p2RootWm?.last_message_id)).toMatch(/^msg_/)
    expect(String(p2RootWm?.synced_at)).toContain("T")

    const p2TreeWmCount = (
      db
        .query("SELECT COUNT(*) as c FROM sync_watermark WHERE root_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'")
        .get() as { c: number }
    ).c
    expect(p2TreeWmCount).toBe(report.p2SyncReport.sessionsInTree)
    expect(p2TreeWmCount).toBeGreaterThanOrEqual(10)

    const p1TreeWmCount = (
      db
        .query("SELECT COUNT(*) as c FROM sync_watermark WHERE root_id = 'ses_ecbfc0f40ffenfykTrNGoMS6o1'")
        .get() as { c: number }
    ).c
    expect(p1TreeWmCount).toBe(report.p1SyncReport.sessionsInTree)
    expect(p1TreeWmCount).toBeGreaterThanOrEqual(38)

    // Verify both live tree and pinned WF-SUB-04 checkpoint (287 root messages, 9 child sessions)
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "wf-sub-04-pinned-test-"))
    try {
      const pinnedSqlite = path.join(tmpDir, "pinned.sqlite")
      const pinnedBlobs = path.join(tmpDir, "blobs")
      const pinnedCold = syncSessionTreeFullBaseline({
        sessionID: "ses_eb23bfbf0ffesn5kT0yJI06h35",
        targetSqlitePath: pinnedSqlite,
        targetBlobDir: pinnedBlobs,
        scope: { maxRootMessages: 287, maxChildSessions: 9 },
      })
      expect(pinnedCold.sessionsInTree).toBe(10) // 1 root + 9 children
      const pinnedDb = new Database(pinnedSqlite, { readonly: true })
      const rootMsgCount = (
        pinnedDb
          .query("SELECT COUNT(*) as c FROM message WHERE session_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'")
          .get() as { c: number }
      ).c
      expect(rootMsgCount).toBe(287)
      pinnedDb.close()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("3. Watermark-gated No-Op Delta vs 1-Turn (5-message + 1-KV) Incremental Delta Sync", () => {
    // Warm no-op delta sync processes 0 messages, 0 KV rows, 0 SQLite writes
    expect(report.p2NoopReport.mode).toBe("noop_delta")
    expect(report.p2NoopReport.dirtySessionsCount).toBe(0)
    expect(report.p2NoopReport.messagesProcessed).toBe(0)
    expect(report.p2NoopReport.kvRowsProcessed).toBe(0)
    expect(report.p2NoopReport.sqliteWrites).toBe(0)
    expect(report.p2NoopReport.elapsedMs).toBeLessThan(20)

    // 1-Turn (5 messages + 1 KV binding update) incremental delta sync
    expect(report.p2Delta1TurnReport.mode).toBe("incremental_delta")
    expect(report.p2Delta1TurnReport.dirtySessionsCount).toBe(1)
    expect(report.p2Delta1TurnReport.messagesProcessed).toBe(5)
    expect(report.p2Delta1TurnReport.kvRowsProcessed).toBe(1)
    expect(report.p2Delta1TurnReport.toolCallsProcessed).toBe(6)
    expect(report.p2Delta1TurnReport.elapsedMs).toBeLessThan(150)

    // Verify all 395 root messages and watermark are intact after the incremental delta sync
    const rootMsgCount = (
      db
        .query("SELECT COUNT(*) as c FROM message WHERE session_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'")
        .get() as { c: number }
    ).c
    expect(rootMsgCount).toBe(395)
  })

  test("4. Lifecycle hooks: context hook runs in-memory (< 2 ms, 0 SQLite queries); idle & compaction sync in < 150 ms", () => {
    const lh = report.lifecycleHookReport
    expect(lh.contextHookResults.length).toBe(20)
    expect(lh.totalContextHookSqliteQueries).toBe(0)
    expect(lh.maxContextHookMs).toBeLessThan(2.0)
    for (const c of lh.contextHookResults) {
      expect(c.sqliteQueriesExecuted).toBe(0)
      expect(c.elapsedMs).toBeLessThan(2.0)
      expect(c.injectedManifestHeader).toContain("WorkingMemoryManifest")
      expect(c.injectedManifestHeader).toContain("ses_eb23bfbf0ffesn5kT0yJI06h35")
    }

    expect(lh.nonIdleIgnoredCount).toBe(2)
    expect(lh.idleHookReport.mode).toBe("incremental_delta")
    expect(lh.idleHookReport.messagesProcessed).toBe(5)
    expect(lh.idleHookReport.kvRowsProcessed).toBe(1)
    expect(lh.idleHookReport.elapsedMs).toBeLessThan(150)

    expect(lh.compactionHookReport.mode).toBe("incremental_delta")
    expect(lh.compactionHookReport.messagesProcessed).toBe(5)
    expect(lh.compactionHookReport.kvRowsProcessed).toBe(1)
    expect(lh.compactionHookReport.elapsedMs).toBeLessThan(150)
  })

  test("5. bun:sqlite WAL concurrency handles >= 50 simultaneous multi-process & in-process read/write ops with 0 SQLITE_BUSY", async () => {
    const wal = report.walConcurrencyReport
    expect(wal.journalMode).toBe("wal")
    expect(wal.synchronousMode).toBe(1) // NORMAL = 1
    expect(wal.busyTimeoutMs).toBe(5000)
    expect(wal.totalOperations).toBeGreaterThanOrEqual(50)
    expect(wal.totalOperations).toBe(136)
    expect(wal.totalWrites).toBe(68)
    expect(wal.totalReads).toBe(68)
    expect(wal.totalBusyErrors).toBe(0)
    expect(wal.totalOtherErrors).toBe(0)

    const probeCount = (
      db.query("SELECT COUNT(*) as c FROM wal_concurrency_probe").get() as { c: number }
    ).c
    expect(probeCount).toBe(68)
  })

  test("6. 7-sample interleaved benchmark verifies speedup and < 150 ms incremental sync budget", () => {
    const b = report.benchmarkReport
    expect(b.rounds).toBe(7)
    expect(b.coldFullTree.samples).toBe(7)
    expect(b.warmNoopWatermark.samples).toBe(7)
    expect(b.incremental1Turn5Msg1Kv.samples).toBe(7)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.samples).toBe(7)

    expect(b.coldFullTree.errorCount).toBe(0)
    expect(b.warmNoopWatermark.errorCount).toBe(0)
    expect(b.incremental1Turn5Msg1Kv.errorCount).toBe(0)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.errorCount).toBe(0)

    // Verify work counts per treatment
    expect(b.coldFullTree.rowsProcessedPerRun).toBe(745)
    expect(b.warmNoopWatermark.rowsProcessedPerRun).toBe(0)
    expect(b.incremental1Turn5Msg1Kv.rowsProcessedPerRun).toBe(5)
    expect(b.incremental1Turn5Msg1Kv.kvRowsProcessedPerRun).toBe(1)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.rowsProcessedPerRun).toBe(5)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.kvRowsProcessedPerRun).toBe(1)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.snapshotsExtractedPerRun).toBe(5)

    // Verify latency budgets (< 150 ms for incremental sync, < 10 ms for warm no-op)
    expect(b.warmNoopWatermark.medianMs).toBeLessThan(10)
    expect(b.incremental1Turn5Msg1Kv.medianMs).toBeLessThan(150)
    expect(b.incremental1Turn5Msg1Kv.maxMs).toBeLessThan(150)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.medianMs).toBeLessThan(150)
    expect(b.incremental1Turn5Msg1KvWithSnapshot.maxMs).toBeLessThan(150)
    expect(b.pinned287CheckpointDeltaMs).toBeLessThan(150)

    expect(b.speedupNoopVsCold).toBeGreaterThan(50)
    expect(b.speedupIncrementalVsCold).toBeGreaterThan(20)
    expect(b.speedupIncrementalWithSnapVsCold).toBeGreaterThan(10)
  })
})
