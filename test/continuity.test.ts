import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { DDL as ARCHIVE_INDEX_DDL } from "../src/archive/index-db.ts"
import { sha256Hex } from "../src/archive/primitives.ts"
import {
  applyCompactionContinuityHook,
  buildCompactionContinuationPacket,
  ensureContinuitySchema,
  querySubstrateContinuity,
  reconcileProvenanceStaleness,
  renderProvenanceReport,
  resolveDefaultSessionId,
  runSevenSampleCompactionBenchmark,
  shortBlobRef,
} from "../src/viewports/continuity.ts"

const ROOT_SESSION_1 = "ses_root_alpha"
const ROOT_SESSION_2 = "ses_root_beta"
const CHILD_SESSION_1 = "ses_child_alpha_1"

function seedSyntheticContinuityDb(db: Database): void {
  db.exec(ARCHIVE_INDEX_DDL)
  ensureContinuitySchema(db)

  const insertSession = db.prepare(`
    INSERT INTO session (
      id, root_id, project_id, parent_id, depth, lane_kind, lane_path, title,
      agent, provider, model_id, harness, outcome, t_created, t_updated, message_count
    ) VALUES (?, ?, 'proj_synthetic', ?, ?, 'root', '', ?, 'ultra', 'openai', 'gpt-5', ?, 'succeeded', ?, ?, 40)
  `)
  insertSession.run(
    ROOT_SESSION_1,
    ROOT_SESSION_1,
    null,
    0,
    "Alpha Root Session: Architecture & Delegation",
    "opencode",
    1000,
    3000,
  )
  insertSession.run(
    CHILD_SESSION_1,
    ROOT_SESSION_1,
    ROOT_SESSION_1,
    1,
    "Alpha Child Reviewer",
    "antigravity",
    1100,
    2500,
  )
  insertSession.run(
    ROOT_SESSION_2,
    ROOT_SESSION_2,
    null,
    0,
    "Beta Root Session: Compaction & Provenance",
    "opencode",
    2000,
    4000,
  )

  const insertDigest = db.prepare(`
    INSERT INTO session_semantic_digest (
      session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state
    ) VALUES (?, ?, ?, '[]', '[]', '[]', ?)
  `)
  insertDigest.run(
    ROOT_SESSION_1,
    ROOT_SESSION_1,
    "[Root · ultra] Alpha Root Session: Architecture & Delegation",
    "verified_passed",
  )
  insertDigest.run(
    ROOT_SESSION_2,
    ROOT_SESSION_2,
    "[Root · ultra] Beta Root Session: Compaction & Provenance",
    "verified_passed",
  )

  const insertCompaction = db.prepare(`
    INSERT INTO compaction (session_id, seq, reason, status, summary_ref, tok_input)
    VALUES (?, ?, 'auto', 'completed', null, ?)
  `)
  insertCompaction.run(ROOT_SESSION_1, 100, 180000)
  insertCompaction.run(ROOT_SESSION_2, 200, 195000)

  const insertPivot = db.prepare(`
    INSERT INTO intent_pivot (session_id, message_id, seq, t, prompt_excerpt, blob_ref, pivot_kind)
    VALUES (?, ?, ?, '2026-10-18T00:00:00Z', ?, ?, ?)
  `)
  insertPivot.run(
    ROOT_SESSION_1,
    "msg_a1",
    4,
    "Initial goal for Alpha architecture",
    shortBlobRef(sha256Hex("p1")),
    "initial_goal",
  )
  insertPivot.run(
    ROOT_SESSION_1,
    "msg_a2",
    12,
    "Course correction on delegation boundary",
    shortBlobRef(sha256Hex("p2")),
    "course_correction",
  )
  insertPivot.run(
    ROOT_SESSION_2,
    "msg_b1",
    2,
    "Verify compaction continuity packet",
    shortBlobRef(sha256Hex("p3")),
    "verification_directive",
  )

  const insertSkill = db.prepare(`
    INSERT INTO skill_load_ledger (session_id, skill_name, blob_sha, blob_ref, load_seq, status)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE — DO NOT RE-INVOKE')
  `)
  for (const [idx, skill] of ["ultra-mode", "tdd", "codebase-design"].entries()) {
    const sha = sha256Hex(`skill:${skill}`)
    insertSkill.run(ROOT_SESSION_1, skill, sha, shortBlobRef(sha), idx + 1)
    insertSkill.run(ROOT_SESSION_2, skill, sha, shortBlobRef(sha), idx + 1)
  }

  const insertFile = db.prepare(`
    INSERT INTO file_read_ledger (
      session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
      read_blob_sha, read_seq, disk_blob_sha, staleness_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FRESH — DO NOT REREAD')
  `)
  for (const [idx, fPath] of ["src/engine.ts", "src/service.ts", "STATE.md"].entries()) {
    const sha = sha256Hex(`file:${fPath}`)
    insertFile.run(ROOT_SESSION_1, fPath, fPath, "all", 1, 50, 50, 0, sha, idx + 1, sha)
    insertFile.run(ROOT_SESSION_2, fPath, fPath, "all", 1, 50, 50, 0, sha, idx + 1, sha)
  }

  db.prepare(`
    INSERT INTO delegation_turn (
      parent_session_id, call_id, turn_index, child_session_id, mode, harness,
      agent, reported_outcome, verified_outcome, blocker_summary, tool_error_count
    ) VALUES (?, 'call_del_1', 1, ?, 'spawn', 'antigravity', 'reviewer', 'succeeded', 'tool_error_inside', 'Test runner failed inside child', 2)
  `).run(ROOT_SESSION_1, CHILD_SESSION_1)

  const engineSha = sha256Hex("file:src/engine.ts")
  const insertChain = db.prepare(`
    INSERT INTO provenance_chain (
      chain_id, root_session_id, finding_id, finding_summary, child_session_id,
      decision_pivot_seq, target_path, read_or_review_blob_sha, repair_blob_sha,
      verification_command, verification_exit_code, verification_blob_ref,
      disk_blob_sha, staleness_status, updated_at
    ) VALUES (?, ?, ?, ?, ?, 4, 'src/engine.ts', ?, ?, 'bun test', 0, ?, ?, 'VERIFIED_FRESH', '2026-10-18T00:00:00Z')
  `)
  insertChain.run(
    "chain_alpha_engine",
    ROOT_SESSION_1,
    "F-ALPHA-01",
    "Isolate engine boundary",
    CHILD_SESSION_1,
    engineSha,
    engineSha,
    shortBlobRef(engineSha),
    engineSha,
  )
  insertChain.run(
    "chain_beta_engine",
    ROOT_SESSION_2,
    "F-BETA-01",
    "Verify beta continuity",
    null,
    engineSha,
    engineSha,
    shortBlobRef(engineSha),
    engineSha,
  )

  db.prepare(`
    INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at)
    VALUES ('src/engine.ts', ?, 50, 200, 40, '// src/engine.ts', 0.42, 1000)
  `).run(engineSha)
  db.prepare(`
    INSERT INTO code_symbol (path, name, qualified_name, kind, depth, exported, start_line, end_line, signature, blob_sha)
    VALUES ('src/engine.ts', 'runEngine', 'runEngine', 'function', 1, 1, 1, 25, 'export function runEngine(): void', ?)
  `).run(engineSha)
  db.prepare(`
    INSERT INTO git_cochange (file_a, file_b, co_commits, commits_a, commits_b, prob_a_given_b, prob_b_given_a, jaccard, has_static_edge, recent_subjects_json)
    VALUES ('src/engine.ts', 'src/service.ts', 5, 6, 5, 1.0, 0.83, 0.83, 0, '["sync engine and service"]')
  `).run()
}

describe("VSC-02 / VSC-R1: ProvenanceChain Reconciler, Slice-Aware Staleness & CompactionContinuationPacket", () => {
  let db: Database

  beforeAll(() => {
    db = new Database(":memory:")
    seedSyntheticContinuityDb(db)
  })

  afterAll(() => {
    db?.close()
  })

  test("1. ensureContinuitySchema is compatible with src/archive/index-db.ts DDL", () => {
    const memDb = new Database(":memory:")
    try {
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
  })

  test("2. REQ-SUB-16: resolveDefaultSessionId resolves explicit -> hookContext (including child-to-root lookup) -> sqlite_latest_root", () => {
    const explicitRes = resolveDefaultSessionId(db, ROOT_SESSION_1, { sessionID: ROOT_SESSION_2 })
    expect(explicitRes.sessionId).toBe(ROOT_SESSION_1)
    expect(explicitRes.source).toBe("explicit_input")

    const hookRes = resolveDefaultSessionId(db, undefined, { sessionID: ROOT_SESSION_1 })
    expect(hookRes.sessionId).toBe(ROOT_SESSION_1)
    expect(hookRes.source).toBe("hook_context")

    const childResolved = resolveDefaultSessionId(db, null, { sessionID: CHILD_SESSION_1 })
    expect(childResolved.source).toBe("hook_context")
    expect(childResolved.rootSessionId).toBe(ROOT_SESSION_1)
    expect(childResolved.resolvedChildSessionID).toBe(CHILD_SESSION_1)

    const fallbackRes = resolveDefaultSessionId(db)
    expect(fallbackRes.source).toBe("sqlite_latest_root")
    expect(fallbackRes.sessionId).toBe(ROOT_SESSION_2)

    const intentsCall = querySubstrateContinuity(
      db,
      { action: "intents" },
      { sessionID: ROOT_SESSION_1 },
    )
    expect(intentsCall.ok).toBe(true)
    expect(intentsCall.resolvedSessionID).toBe(ROOT_SESSION_1)
    expect(intentsCall.resolutionSource).toBe("hook_context")
    expect(intentsCall.content).not.toContain("Specify action and sessionID")
  })

  test("3. REQ-SUB-15: buildCompactionContinuationPacket synthesizes deterministic < 1,200-token packets across all 6 required sections", () => {
    const pkt = buildCompactionContinuationPacket(db, ROOT_SESSION_1, { seq: 100 })
    expect(pkt.withinBudget).toBe(true)
    expect(pkt.tokenCount).toBeLessThan(1200)
    expect(pkt.markdown).toContain("Headline & Gate")
    expect(pkt.markdown).toContain("### 1. Intent Pivot Timeline")
    expect(pkt.markdown).toContain("### 2. Working-Memory Manifest")
    expect(pkt.markdown).toContain("### 3. Delegation Trajectory")
    expect(pkt.markdown).toContain("### 4. Provenance Chain")
    expect(pkt.markdown).toContain("### 5. Tier-1 RepoMap & Co-Change Alerts")
    expect(pkt.markdown).toContain("reported=`succeeded` -> verified=`tool_error_inside`")

    const hookEvent = {
      sessionID: ROOT_SESSION_1,
      seq: 100,
      system: [{ type: "text" as const, text: "Base compaction system prompt" }],
    }
    const hookedPacket = applyCompactionContinuityHook(db, hookEvent)
    expect(hookEvent.system.length).toBe(2)
    expect(hookEvent.system[1]?.text).toBe(hookedPacket.markdown)
    expect(existsSync(".opencode/compaction-history")).toBe(false)
  })

  test("4. REQ-SUB-14 / VSC-R1: reconcileProvenanceStaleness distinguishes (1) full-file FRESH, (2) partial slice FRESH SLICE, and (3) modified/missing STALE on disk", () => {
    const tmpRoot = join(tmpdir(), `hivemind-vsc-r1-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    const workDb = new Database(":memory:")
    try {
      ensureContinuitySchema(workDb)
      const sessionId = "ses_slice_reconcile_test"
      workDb
        .query(
          "INSERT INTO session (id, root_id, project_id, depth, lane_kind, lane_path, harness, t_created, t_updated) VALUES (?, ?, 'proj', 0, 'root', '', 'opencode', 1000, 2000)",
        )
        .run(sessionId, sessionId)

      // File 1: Full-file read (5 lines)
      const fullRel = "src/full.ts"
      const fullAbs = join(tmpRoot, fullRel)
      const fullLines = ["line 1", "line 2", "line 3", "line 4", "line 5"]
      const fullContent = fullLines.join("\n")
      const fullSha = sha256Hex(fullContent)
      writeFileSync(fullAbs, fullContent, "utf8")

      // File 2: Partial slice read (lines 1-2 of 5)
      const sliceRel = "src/sliced.ts"
      const sliceAbs = join(tmpRoot, sliceRel)
      const sliceFileLines = ["alpha 1", "alpha 2", "alpha 3", "alpha 4", "alpha 5"]
      writeFileSync(sliceAbs, sliceFileLines.join("\n"), "utf8")
      const sliceReadSha = sha256Hex(sliceFileLines.slice(0, 2).join("\n"))

      // File 3: Missing file on disk
      const missingRel = "src/missing.ts"
      const missingSha = sha256Hex("missing content")

      const insertFile = workDb.prepare(`
        INSERT INTO file_read_ledger (
          session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
          read_blob_sha, read_seq, disk_blob_sha, staleness_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FRESH — DO NOT REREAD')
      `)
      insertFile.run(sessionId, fullRel, fullRel, "all", 1, 5, 5, 0, fullSha, 1, fullSha)
      insertFile.run(
        sessionId,
        sliceRel,
        sliceRel,
        "SLICE L1-L2 of 5 (truncated)",
        1,
        2,
        5,
        1,
        sliceReadSha,
        2,
        sliceReadSha,
      )
      insertFile.run(sessionId, missingRel, missingRel, "all", 1, 3, 3, 0, missingSha, 3, missingSha)

      workDb
        .query(
          `INSERT INTO provenance_chain (
            chain_id, root_session_id, finding_id, finding_summary, target_path,
            read_or_review_blob_sha, repair_blob_sha, verification_exit_code,
            disk_blob_sha, staleness_status, updated_at
          ) VALUES ('chain_full_1', ?, 'F-FULL-01', 'Verify full file', ?, ?, ?, 0, ?, 'verified_fresh', '2026-10-18T00:00:00Z')`,
        )
        .run(sessionId, fullRel, fullSha, fullSha, fullSha)

      // Initial reconciliation:
      // - src/full.ts -> "FRESH — DO NOT REREAD"
      // - src/sliced.ts -> "SLICE L1-L2 of 5 — FRESH SLICE"
      // - src/missing.ts -> "STALE (modified since read/review — re-verify slice)"
      const rec1 = reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      expect(rec1.freshFilesCount).toBe(2)
      expect(rec1.sliceFilesCount).toBe(1)
      expect(rec1.staleFilesCount).toBe(1)
      expect(rec1.freshFiles.map((f) => f.path)).toEqual([fullRel, sliceRel])
      expect(rec1.sliceFiles.map((f) => f.path)).toEqual([sliceRel])
      expect(rec1.staleFiles.map((f) => f.path)).toEqual([missingRel])

      const fullRow = rec1.fileRows.find((f) => f.path === fullRel)!
      const sliceRow = rec1.fileRows.find((f) => f.path === sliceRel)!
      const missingRow = rec1.fileRows.find((f) => f.path === missingRel)!

      expect(fullRow.staleness_status).toBe("FRESH — DO NOT REREAD")
      expect(sliceRow.staleness_status).toBe("SLICE L1-L2 of 5 — FRESH SLICE")
      expect(missingRow.staleness_status).toBe(
        "STALE (modified since read/review — re-verify slice)",
      )

      // Modify line 2 of src/sliced.ts -> slice becomes STALE
      writeFileSync(
        sliceAbs,
        ["alpha 1", "alpha 2 MODIFIED", "alpha 3", "alpha 4", "alpha 5"].join("\n"),
        "utf8",
      )
      const rec2 = reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      expect(rec2.sliceFilesCount).toBe(0)
      expect(rec2.staleFilesCount).toBe(2)
      expect(rec2.fileRows.find((f) => f.path === sliceRel)?.staleness_status).toBe(
        "STALE (modified since read/review — re-verify slice)",
      )

      // Restore line 2 of src/sliced.ts -> slice returns to SLICE L1-L2 of 5 — FRESH SLICE
      writeFileSync(sliceAbs, sliceFileLines.join("\n"), "utf8")
      const rec3 = reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      expect(rec3.sliceFilesCount).toBe(1)
      expect(rec3.fileRows.find((f) => f.path === sliceRel)?.staleness_status).toBe(
        "SLICE L1-L2 of 5 — FRESH SLICE",
      )

      const report = renderProvenanceReport(workDb, sessionId)
      expect(report).toContain("SLICE L1-L2 of 5 — FRESH SLICE")
      expect(report).toContain("STALE (modified since read/review — re-verify slice)")

      const pkt = buildCompactionContinuationPacket(workDb, sessionId)
      expect(pkt.markdown).toContain("SLICE L1-L2 of 5 — FRESH SLICE")
      expect(pkt.markdown).toContain("STALE (modified since read/review — re-verify slice)")
    } finally {
      workDb.close()
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test("5. passes 7-sample interleaved benchmark across synthetic compactions with < 1,200 tokens and < 2 ms latency", () => {
    const report = runSevenSampleCompactionBenchmark(db, 7)
    expect(report.samples).toBe(7)
    expect(report.compactionsEvaluated).toBe(2)
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
