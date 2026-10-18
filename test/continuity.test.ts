import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { DDL as ARCHIVE_INDEX_DDL } from "../src/archive/index-db.ts"
import { sha256hex } from "../src/archive/normalize.ts"
import {
  DEFAULT_ARCHIVE_DIR,
  DEFAULT_TARGET_DB_PATH,
  DEFAULT_WF01_DB_PATH,
  DEFAULT_WF03_DB_PATH,
  DEFAULT_WF06_DB_PATH,
  P1_RELEASE_SESSION_ID,
  S1_PANIC_REREAD_FILES,
  S1_PANIC_REREAD_SKILLS,
  S1_SESSION_ID,
  S2_PANIC_REREAD_FILES,
  S2_PANIC_REREAD_SKILLS,
  S2_SESSION_ID,
  applyCompactionContinuityHook,
  buildCompactionContinuationPacket,
  buildUnifiedContinuityDatabase,
  ensureContinuitySchema,
  querySubstrateContinuity,
  reconcileProvenanceStaleness,
  renderProvenanceReport,
  resolveDefaultSessionId,
  runSevenSampleCompactionBenchmark,
} from "../src/viewports/continuity.ts"

const PROTECTED_UPSTREAM_DBS = [
  DEFAULT_WF01_DB_PATH,
  DEFAULT_WF03_DB_PATH,
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-05-codegraph.sqlite",
  DEFAULT_WF06_DB_PATH,
  `${DEFAULT_ARCHIVE_DIR}/index.sqlite`,
] as const

function hashFile(path: string): string {
  return sha256hex(readFileSync(path))
}

describe("VSC-02: ProvenanceChain Reconciler, Default sessionID Resolution & CompactionContinuationPacket", () => {
  const upstreamHashesBefore = new Map<string, string>()
  let db: Database

  beforeAll(() => {
    for (const p of PROTECTED_UPSTREAM_DBS) {
      if (existsSync(p)) {
        upstreamHashesBefore.set(p, hashFile(p))
      }
    }
    db = buildUnifiedContinuityDatabase({
      targetDbPath: DEFAULT_TARGET_DB_PATH,
    })
  })

  afterAll(() => {
    db?.close()
    for (const [p, expectedHash] of upstreamHashesBefore.entries()) {
      expect(hashFile(p)).toBe(expectedHash)
    }
  })

  test("1. ensureContinuitySchema is compatible with src/archive/index-db.ts DDL and unifies WF-SUB-01..06 tables without mutating upstream DBs", () => {
    const memDb = new Database(":memory:")
    try {
      // First apply src/archive/index-db.ts DDL, then ensureContinuitySchema
      memDb.exec(ARCHIVE_INDEX_DDL)
      ensureContinuitySchema(memDb)

      const tables = new Set(
        (
          memDb
            .query("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as { name: string }[]
        ).map((r) => r.name),
      )
      expect(tables.has("provenance_chain")).toBe(true)
      expect(tables.has("file_read_ledger")).toBe(true)
      expect(tables.has("skill_load_ledger")).toBe(true)
      expect(tables.has("compaction_continuation_ledger")).toBe(true)
    } finally {
      memDb.close()
    }

    const counts = {
      session: (db.query("SELECT COUNT(*) as c FROM session").get() as { c: number }).c,
      compaction: (db.query("SELECT COUNT(*) as c FROM compaction").get() as { c: number }).c,
      digest: (db.query("SELECT COUNT(*) as c FROM session_semantic_digest").get() as { c: number }).c,
      intentPivot: (db.query("SELECT COUNT(*) as c FROM intent_pivot").get() as { c: number }).c,
      fts: (db.query("SELECT COUNT(*) as c FROM substrate_fts").get() as { c: number }).c,
      kvBinding: (db.query("SELECT COUNT(*) as c FROM kv_binding").get() as { c: number }).c,
      delegationTurn: (db.query("SELECT COUNT(*) as c FROM delegation_turn").get() as { c: number }).c,
      snapshotArtifact: (db.query("SELECT COUNT(*) as c FROM snapshot_artifact").get() as { c: number }).c,
      spillArtifact: (db.query("SELECT COUNT(*) as c FROM spill_artifact").get() as { c: number }).c,
      codeFile: (db.query("SELECT COUNT(*) as c FROM code_file").get() as { c: number }).c,
      codeSymbol: (db.query("SELECT COUNT(*) as c FROM code_symbol").get() as { c: number }).c,
      gitCochange: (db.query("SELECT COUNT(*) as c FROM git_cochange").get() as { c: number }).c,
      provenanceChain: (db.query("SELECT COUNT(*) as c FROM provenance_chain").get() as { c: number }).c,
      fileReadLedger: (db.query("SELECT COUNT(*) as c FROM file_read_ledger").get() as { c: number }).c,
      skillLoadLedger: (db.query("SELECT COUNT(*) as c FROM skill_load_ledger").get() as { c: number }).c,
    }

    expect(counts.session).toBeGreaterThanOrEqual(63)
    expect(counts.compaction).toBeGreaterThanOrEqual(6)
    expect(counts.digest).toBeGreaterThanOrEqual(63)
    expect(counts.intentPivot).toBeGreaterThanOrEqual(101)
    expect(counts.fts).toBeGreaterThanOrEqual(495)
    expect(counts.kvBinding).toBeGreaterThanOrEqual(618)
    expect(counts.delegationTurn).toBeGreaterThanOrEqual(124)
    expect(counts.snapshotArtifact).toBeGreaterThanOrEqual(464)
    expect(counts.spillArtifact).toBeGreaterThanOrEqual(15)
    expect(counts.codeFile).toBe(51)
    expect(counts.codeSymbol).toBe(1314)
    expect(counts.gitCochange).toBe(311)
    expect(counts.provenanceChain).toBeGreaterThanOrEqual(8)
    expect(counts.fileReadLedger).toBeGreaterThan(80)
    expect(counts.skillLoadLedger).toBeGreaterThan(25)
  })

  test("2. REQ-SUB-16: resolveDefaultSessionId resolves explicit -> hookContext (including child-to-root lookup) -> sqlite_latest_root without throwing Specify action and sessionID", () => {
    // Priority 1: Explicit sessionID
    const explicitRes = resolveDefaultSessionId(db, S2_SESSION_ID, { sessionID: S1_SESSION_ID })
    expect(explicitRes.sessionId).toBe(S2_SESSION_ID)
    expect(explicitRes.sessionID).toBe(S2_SESSION_ID)
    expect(explicitRes.source).toBe("explicit_input")

    // Priority 2: hookContext.sessionID
    const hookRes = resolveDefaultSessionId(db, undefined, { sessionID: S1_SESSION_ID })
    expect(hookRes.sessionId).toBe(S1_SESSION_ID)
    expect(hookRes.sessionID).toBe(S1_SESSION_ID)
    expect(hookRes.source).toBe("hook_context")

    // Child session resolution to root session via hookContext
    const childRow = db
      .query("SELECT id, root_id FROM session WHERE depth > 0 LIMIT 1")
      .get() as { id: string; root_id: string } | null
    if (childRow) {
      const childResolved = resolveDefaultSessionId(db, null, { sessionID: childRow.id })
      expect(childResolved.source).toBe("hook_context")
      expect(childResolved.rootSessionId).toBe(childRow.root_id)
      expect(childResolved.resolvedChildSessionID).toBe(childRow.id)
    }

    // Priority 3: SQLite latest depth=0 root session
    const fallbackRes = resolveDefaultSessionId(db)
    expect(fallbackRes.source).toBe("sqlite_latest_root")
    expect(fallbackRes.sessionId).toMatch(/^ses_/)

    // Exact S1 msg[58] regression call: compaction_continuity({ action: "intents" }) without input.sessionID
    const s1Msg58 = querySubstrateContinuity(
      db,
      { action: "intents" },
      { sessionID: S1_SESSION_ID },
    )
    expect(s1Msg58.ok).toBe(true)
    expect(s1Msg58.resolvedSessionID).toBe(S1_SESSION_ID)
    expect(s1Msg58.resolutionSource).toBe("hook_context")
    expect(s1Msg58.content).not.toContain("Specify action and sessionID")
    expect(s1Msg58.content).toContain(S1_SESSION_ID)
    const intents = s1Msg58.data.userIntents as Array<{ seq: number; pivot_kind: string }>
    expect(intents.length).toBe(5)
    expect(intents[0]?.seq).toBe(4)

    // Calling with empty {} and no hookContext falls back to SQLite most recent root session
    const emptyCall = querySubstrateContinuity(db, {})
    expect(emptyCall.ok).toBe(true)
    expect(emptyCall.resolutionSource).toBe("sqlite_latest_root")
    expect(emptyCall.resolvedSessionID).toMatch(/^ses_/)
    expect(emptyCall.content).not.toContain("Specify action and sessionID")
    expect(emptyCall.data.tokenCount as number).toBeLessThan(1200)
  })

  test("3. REQ-SUB-15: buildCompactionContinuationPacket synthesizes deterministic < 1,200-token packets across all 6 required sections and persists into compaction_continuation_ledger", () => {
    const compactionRows = db
      .query("SELECT session_id, seq FROM compaction ORDER BY session_id, seq")
      .all() as { session_id: string; seq: number }[]
    expect(compactionRows.length).toBeGreaterThanOrEqual(6)

    for (const c of compactionRows) {
      const pkt = buildCompactionContinuationPacket(db, {
        sessionID: c.session_id,
        compactionSeq: c.seq,
      })
      expect(pkt.withinBudget).toBe(true)
      expect(pkt.tokenCount).toBeLessThan(1200)
      expect(pkt.tokenCount).toBeGreaterThan(400)
      expect(pkt.markdown).toContain("Headline & Gate")
      expect(pkt.markdown).toContain("### 1. Intent Pivot Timeline")
      expect(pkt.markdown).toContain("### 2. Working-Memory Manifest")
      expect(pkt.markdown).toContain("### 3. Delegation Trajectory")
      expect(pkt.markdown).toContain("### 4. Provenance Chain")
      expect(pkt.markdown).toContain("### 5. Tier-1 RepoMap & Co-Change Alerts")
    }

    // Verify S1 (ses_eb2eabb14ffeCXsCwb845rtffb at msg[51] / seq=865) via both calling conventions
    const s1Packet = buildCompactionContinuationPacket(db, S1_SESSION_ID, { seq: 865 })
    expect(s1Packet.tokenCount).toBeLessThan(1200)
    expect(s1Packet.sections.activeSkillsCount).toBe(16)
    expect(s1Packet.sections.filesReadCount).toBe(28)

    for (const skillName of S1_PANIC_REREAD_SKILLS) {
      expect(s1Packet.markdown).toContain(`@${skillName}(`)
    }
    for (const filePath of S1_PANIC_REREAD_FILES) {
      expect(s1Packet.markdown).toContain(`${filePath}(`)
    }

    // Verify S2 (ses_eb23bfbf0ffesn5kT0yJI06h35 at msg[82] / seq=847)
    const s2Packet = buildCompactionContinuationPacket(db, {
      sessionID: S2_SESSION_ID,
      compactionSeq: 847,
    })
    expect(s2Packet.tokenCount).toBeLessThan(1200)
    for (const skillName of S2_PANIC_REREAD_SKILLS) {
      expect(s2Packet.markdown).toContain(`@${skillName}(`)
    }
    for (const filePath of S2_PANIC_REREAD_FILES) {
      expect(s2Packet.markdown).toContain(`${filePath}(`)
    }

    // Verify P1 (ses_ecbfc0f40ffenfykTrNGoMS6o1) surfaces false-positive Antigravity delegations
    const p1Packet = buildCompactionContinuationPacket(db, P1_RELEASE_SESSION_ID)
    expect(p1Packet.tokenCount).toBeLessThan(1200)
    expect(p1Packet.sections.flaggedDelegationCount).toBeGreaterThanOrEqual(11)
    expect(p1Packet.markdown).toContain("reported=`succeeded` -> verified=`tool_error_inside`")

    // Verify row persisted in compaction_continuation_ledger
    const ledgerRow = db
      .query(
        "SELECT session_id, compaction_seq, packet_tokens, packet_markdown FROM compaction_continuation_ledger WHERE session_id = ? AND compaction_seq = ?",
      )
      .get(S1_SESSION_ID, 865) as {
      session_id: string
      compaction_seq: number
      packet_tokens: number
      packet_markdown: string
    } | null
    expect(ledgerRow).not.toBeNull()
    expect(ledgerRow!.packet_tokens).toBe(s1Packet.tokenCount)
    expect(ledgerRow!.packet_markdown).toBe(s1Packet.markdown)

    // Verify compaction hook mutates compactionEvent.system in place and never writes .opencode/compaction-history
    const hookEvent = {
      sessionID: S1_SESSION_ID,
      seq: 865,
      system: [{ type: "text" as const, text: "Base compaction system prompt" }],
    }
    const hookedPacket = applyCompactionContinuityHook(db, hookEvent)
    expect(hookEvent.system.length).toBe(2)
    expect(hookEvent.system[1]?.text).toBe(hookedPacket.markdown)
    expect(existsSync(".opencode/compaction-history")).toBe(false)
  })

  test("4. REQ-SUB-14: reconcileProvenanceStaleness reconciles live disk SHA-256 on canonicalRoot and in-memory hash overrides in < 2 ms", () => {
    // Part A: Live working-tree file SHA-256 reconciliation via reconcileProvenanceStaleness(db, canonicalRoot, sessionId)
    const tmpRoot = join(tmpdir(), `hivemind-vsc02-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    const workDb = new Database(":memory:")
    try {
      ensureContinuitySchema(workDb)
      const relFile = "src/service.ts"
      const absFile = join(tmpRoot, relFile)
      const v1Content = "export function runService(): number { return 42 }\n"
      const v1Sha = sha256hex(v1Content)
      writeFileSync(absFile, v1Content, "utf8")

      const testSessionId = "ses_live_reconcile_root"
      workDb
        .query(
          "INSERT INTO session (id, root_id, project_id, depth, lane_kind, lane_path, harness, t_created, t_updated) VALUES (?, ?, 'proj', 0, 'root', '', 'opencode', 1000, 2000)",
        )
        .run(testSessionId, testSessionId)

      workDb
        .query(
          `INSERT INTO file_read_ledger (
            session_id, path, line_range, read_blob_sha, read_seq, disk_blob_sha, staleness_status
          ) VALUES (?, ?, 'L1-L20', ?, 10, ?, 'FRESH — DO NOT REREAD')`,
        )
        .run(testSessionId, relFile, v1Sha, v1Sha)

      workDb
        .query(
          `INSERT INTO provenance_chain (
            chain_id, root_session_id, finding_id, finding_summary, target_path,
            read_or_review_blob_sha, repair_blob_sha, verification_exit_code,
            disk_blob_sha, staleness_status, updated_at
          ) VALUES ('chain_live_1', ?, 'F-LIVE-01', 'Verify service output', ?, ?, ?, 0, ?, 'verified_fresh', '2026-10-18T00:00:00Z')`,
        )
        .run(testSessionId, relFile, v1Sha, v1Sha, v1Sha)

      // 1. Reconcile while disk matches v1Sha
      const freshRes = reconcileProvenanceStaleness(workDb, tmpRoot, testSessionId)
      expect(freshRes.elapsedMs).toBeLessThan(2.0)
      expect(freshRes.staleFilesCount).toBe(0)
      expect(freshRes.staleChainsCount).toBe(0)
      expect(freshRes.fileRows[0]?.staleness_status).toBe("FRESH — DO NOT REREAD")
      expect(freshRes.chainRows[0]?.staleness_status).toBe("verified_fresh")

      // 2. Modify file on disk -> transitions to STALE and verified_stale_by_later_touch
      const v2Content = "export function runService(): number { return 99 }\n"
      writeFileSync(absFile, v2Content, "utf8")

      const staleRes = reconcileProvenanceStaleness(workDb, tmpRoot, testSessionId)
      expect(staleRes.elapsedMs).toBeLessThan(2.0)
      expect(staleRes.staleFilesCount).toBe(1)
      expect(staleRes.staleChainsCount).toBe(1)
      expect(staleRes.fileRows[0]?.staleness_status).toBe(
        "STALE (modified since read/review — re-verify slice)",
      )
      expect(staleRes.chainRows[0]?.staleness_status).toBe("verified_stale_by_later_touch")

      const reportMarkdown = renderProvenanceReport(workDb, testSessionId)
      expect(reportMarkdown).toContain("F-LIVE-01")
      expect(reportMarkdown).toContain("verified_stale_by_later_touch")
      expect(reportMarkdown).toContain("STALE (modified since read/review — re-verify slice)")

      // 3. Restore v1Content on disk -> deterministically restores FRESH and verified_fresh
      writeFileSync(absFile, v1Content, "utf8")
      const restoredRes = reconcileProvenanceStaleness(workDb, tmpRoot, testSessionId)
      expect(restoredRes.staleFilesCount).toBe(0)
      expect(restoredRes.staleChainsCount).toBe(0)
      expect(restoredRes.fileRows[0]?.staleness_status).toBe("FRESH — DO NOT REREAD")
      expect(restoredRes.chainRows[0]?.staleness_status).toBe("verified_fresh")
    } finally {
      workDb.close()
      rmSync(tmpRoot, { recursive: true, force: true })
    }

    // Part B: Verify S1 & S2 staleness transitions on the 63-session continuity DB
    const s1Initial = reconcileProvenanceStaleness(db, S1_SESSION_ID)
    expect(s1Initial.staleFilesCount).toBe(0)
    expect(s1Initial.staleChainsCount).toBe(0)

    const nativeFileBefore = s1Initial.fileRows.find(
      (f) => f.path === "src/delegation/native-delegation.ts",
    )!
    expect(nativeFileBefore.staleness_status).toBe("FRESH — DO NOT REREAD")

    const modifiedNativeSha = sha256hex("modified:src/delegation/native-delegation.ts:post-review-edit")
    const s1AfterEdit = reconcileProvenanceStaleness(db, S1_SESSION_ID, {
      "src/delegation/native-delegation.ts": modifiedNativeSha,
    })
    expect(s1AfterEdit.staleFilesCount).toBe(1)
    expect(s1AfterEdit.staleChainsCount).toBe(1)
    expect(
      s1AfterEdit.fileRows.find((f) => f.path === "src/delegation/native-delegation.ts")
        ?.staleness_status,
    ).toBe("STALE (modified since read/review — re-verify slice)")
    expect(
      s1AfterEdit.chainRows.find((c) => c.chain_id === "chain_s1_native_delegation")
        ?.staleness_status,
    ).toBe("verified_stale_by_later_touch")

    // Restore S1
    const s1Restored = reconcileProvenanceStaleness(db, S1_SESSION_ID, {
      "src/delegation/native-delegation.ts": nativeFileBefore.read_blob_sha,
    })
    expect(s1Restored.staleFilesCount).toBe(0)
    expect(s1Restored.staleChainsCount).toBe(0)
    buildCompactionContinuationPacket(db, S1_SESSION_ID, { seq: 865 })
  })

  test("5. passes 7-sample interleaved benchmark across all compactions with < 1,200 tokens and < 2 ms latency", () => {
    const report = runSevenSampleCompactionBenchmark(db, 7)
    expect(report.samples).toBe(7)
    expect(report.compactionsEvaluated).toBeGreaterThanOrEqual(6)
    expect(report.aggregateBuildPacketMedianMs).toBeLessThan(2.0)
    expect(report.aggregateReconcileMedianMs).toBeLessThan(2.0)

    for (const entry of report.entries) {
      expect(entry.within1200Budget).toBe(true)
      expect(entry.packetTokens).toBeLessThan(1200)
      expect(entry.buildPacketMedianMs).toBeLessThan(2.0)
      expect(entry.reconcileMedianMs).toBeLessThan(2.0)
    }
  })
})
