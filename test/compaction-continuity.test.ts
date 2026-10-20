import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { DDL as ARCHIVE_INDEX_DDL } from "../src/archive/index-db.ts"
import { sha256Hex } from "../src/archive/primitives.ts"
import * as continuityMod from "../src/viewports/continuity.ts"
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

describe("VSC-02 / VSC-R1 / VSC-R4: ProvenanceChain Reconciler, Verification Gate Sync & CompactionContinuationPacket", () => {
  let db: Database

  beforeAll(() => {
    db = new Database(":memory:")
    seedSyntheticContinuityDb(db)
  })

  afterAll(() => {
    db?.close()
  })

  test("1. ensureContinuitySchema and resolveDefaultSessionId work across explicit, hook, and sqlite fallback", () => {
    const explicitRes = resolveDefaultSessionId(db, ROOT_SESSION_1, { sessionID: ROOT_SESSION_2 })
    expect(explicitRes.sessionId).toBe(ROOT_SESSION_1)
    expect(explicitRes.source).toBe("explicit_input")

    const childResolved = resolveDefaultSessionId(db, null, { sessionID: CHILD_SESSION_1 })
    expect(childResolved.source).toBe("hook_context")
    expect(childResolved.rootSessionId).toBe(ROOT_SESSION_1)

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
  })

  test("2. buildCompactionContinuationPacket synthesizes deterministic < 1,200-token packets with verification gate label", () => {
    const pkt = buildCompactionContinuationPacket(db, ROOT_SESSION_1, { seq: 100 })
    expect(pkt.withinBudget).toBe(true)
    expect(pkt.tokenCount).toBeLessThan(1200)
    expect(pkt.markdown).toContain("Headline & Gate")
    expect(pkt.markdown).toContain("### 1. Intent Pivot Timeline")
    expect(pkt.markdown).toContain("### 2. Working-Memory Manifest")
    expect(pkt.markdown).toContain("### 3. Delegation Trajectory")
    expect(pkt.markdown).toContain("### 4. Provenance Chain")
    expect(pkt.markdown).toContain("### 5. Tier-1 RepoMap & Co-Change Alerts")

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

  test("3. VSC-R4 (E-3, S3-6): reconcileProvenanceStaleness deletes pseudo-targets ('session', '(unknown)', '') and deduplicates per (root_session_id, target_path) by MAX(finding_seq)", () => {
    const tmpRoot = join(tmpdir(), `hivemind-vsc-r4-dedup-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    const workDb = new Database(":memory:")
    try {
      workDb.exec(ARCHIVE_INDEX_DDL)
      ensureContinuitySchema(workDb)

      const sessionId = "ses_dedup_test"
      workDb
        .query(
          "INSERT INTO session (id, root_id, project_id, depth, lane_kind, lane_path, harness, t_created, t_updated) VALUES (?, ?, 'proj', 0, 'root', '', 'opencode', 1000, 2000)",
        )
        .run(sessionId, sessionId)

      const targetRel = "src/target.ts"
      const targetContent = ["const a = 1", "const b = 2", "const c = 3"].join("\n")
      const targetSha = sha256Hex(targetContent)
      writeFileSync(join(tmpRoot, targetRel), targetContent, "utf8")

      const insertChain = workDb.prepare(`
        INSERT INTO provenance_chain (
          chain_id, root_session_id, session_id, finding_id, finding_seq, finding_summary,
          target_path, read_or_review_blob_sha, repair_blob_sha, verification_exit_code,
          disk_blob_sha, staleness_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'VERIFIED_FRESH', ?)
      `)

      // Pseudo-target rows that must be deleted
      insertChain.run(
        "chain_pseudo_session",
        sessionId,
        sessionId,
        "F-PSEUDO-1",
        1,
        "Legacy session pseudo-chain",
        "session",
        targetSha,
        targetSha,
        targetSha,
        "2026-10-19T00:00:00Z",
      )
      insertChain.run(
        "chain_pseudo_unknown",
        sessionId,
        sessionId,
        "F-PSEUDO-2",
        2,
        "Legacy unknown pseudo-chain",
        "(unknown)",
        targetSha,
        targetSha,
        targetSha,
        "2026-10-19T00:00:01Z",
      )
      insertChain.run(
        "chain_pseudo_empty",
        sessionId,
        sessionId,
        "F-PSEUDO-3",
        3,
        "Legacy empty pseudo-chain",
        "",
        targetSha,
        targetSha,
        targetSha,
        "2026-10-19T00:00:02Z",
      )

      // Duplicate rows for the same (root_session_id, target_path) — keep MAX(finding_seq) = 15
      insertChain.run(
        "chain_dup_old",
        sessionId,
        sessionId,
        "F-TARGET-OLD",
        5,
        "Older finding for src/target.ts",
        targetRel,
        targetSha,
        targetSha,
        targetSha,
        "2026-10-19T00:01:00Z",
      )
      insertChain.run(
        "chain_dup_latest",
        sessionId,
        sessionId,
        "F-TARGET-NEW",
        15,
        "Latest finding for src/target.ts",
        targetRel,
        targetSha,
        targetSha,
        targetSha,
        "2026-10-19T00:02:00Z",
      )

      const rec = reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      expect(rec.chainRows.length).toBe(1)
      expect(rec.chainRows[0]?.chain_id).toBe("chain_dup_latest")
      expect(rec.chainRows[0]?.finding_id).toBe("F-TARGET-NEW")
      expect(rec.chainRows[0]?.target_path).toBe(targetRel)

      const report = renderProvenanceReport(workDb, sessionId, tmpRoot)
      expect(report).not.toContain("Legacy session pseudo-chain")
      expect(report).not.toContain("`(unknown)`")
      expect(report).not.toContain("F-TARGET-OLD")
      expect(report).toContain("F-TARGET-NEW")

      const pkt = buildCompactionContinuationPacket(workDb, {
        sessionId,
        canonicalRoot: tmpRoot,
      })
      expect(pkt.markdown).not.toContain("Legacy session pseudo-chain")
      expect(pkt.markdown).not.toContain("F-TARGET-OLD")
      expect(pkt.markdown).toContain("F-TARGET-NEW")
    } finally {
      workDb.close()
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test("4. VSC-R4 (S3-2, S3-4): slice-aware provenance reconciliation and concrete L1-L<N> line ranges without '#all'", () => {
    const tmpRoot = join(tmpdir(), `hivemind-vsc-r4-slice-prov-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    const workDb = new Database(":memory:")
    try {
      workDb.exec(ARCHIVE_INDEX_DDL)
      ensureContinuitySchema(workDb)

      const sessionId = "ses_slice_prov_test"
      workDb
        .query(
          "INSERT INTO session (id, root_id, project_id, depth, lane_kind, lane_path, harness, t_created, t_updated) VALUES (?, ?, 'proj', 0, 'root', '', 'opencode', 1000, 2000)",
        )
        .run(sessionId, sessionId)

      // Full-file read with 'all' / '#all' line_range
      const fullRel = "src/full.ts"
      const fullLines = ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"]
      const fullContent = fullLines.join("\n")
      const fullSha = sha256Hex(fullContent)
      writeFileSync(join(tmpRoot, fullRel), fullContent, "utf8")

      // Partial slice read (lines 1-2 of 5) with provenance_chain pointing to slice SHA
      const sliceRel = "src/sliced.ts"
      const sliceLines = ["alpha 1", "alpha 2", "alpha 3", "alpha 4", "alpha 5"]
      writeFileSync(join(tmpRoot, sliceRel), sliceLines.join("\n"), "utf8")
      const sliceSha = sha256Hex(sliceLines.slice(0, 2).join("\n"))

      const insertFile = workDb.prepare(`
        INSERT INTO file_read_ledger (
          session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
          read_blob_sha, read_seq, disk_blob_sha, staleness_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FRESH — DO NOT REREAD')
      `)
      insertFile.run(sessionId, fullRel, fullRel, "#all", 1, 6, 6, 0, fullSha, 1, fullSha)
      insertFile.run(
        sessionId,
        sliceRel,
        sliceRel,
        "SLICE L1-L2 of 5 (truncated)",
        1,
        2,
        5,
        1,
        sliceSha,
        2,
        sliceSha,
      )

      const insertChain = workDb.prepare(`
        INSERT INTO provenance_chain (
          chain_id, root_session_id, session_id, finding_id, finding_seq, finding_summary,
          target_path, read_or_review_blob_sha, repair_blob_sha, verification_exit_code,
          disk_blob_sha, staleness_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'VERIFIED_FRESH', '2026-10-19T00:00:00Z')
      `)
      insertChain.run(
        "chain_full",
        sessionId,
        sessionId,
        "F-FULL",
        1,
        "Full file check",
        fullRel,
        fullSha,
        fullSha,
        fullSha,
      )
      insertChain.run(
        "chain_slice",
        sessionId,
        sessionId,
        "F-SLICE",
        2,
        "Partial slice check",
        sliceRel,
        sliceSha,
        sliceSha,
        sliceSha,
      )

      const rec = reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      const fullLedger = rec.fileRows.find((f) => f.path === fullRel)!
      expect(fullLedger.line_range).toBe("L1-L6")
      expect(fullLedger.line_range).not.toContain("#all")
      expect(fullLedger.line_range).not.toBe("all")

      // Provenance chain on partial slice should be SLICE_FRESH (not falsely marked stale!)
      const sliceChain = rec.chainRows.find((c) => c.target_path === sliceRel)!
      expect(sliceChain.staleness_status).toBe("SLICE_FRESH")
      expect(rec.staleChainsCount).toBe(0)

      const report = renderProvenanceReport(workDb, sessionId, tmpRoot)
      expect(report).not.toContain("#all")
      expect(report).toContain("L1-L6")

      const pkt = buildCompactionContinuationPacket(workDb, {
        sessionId,
        canonicalRoot: tmpRoot,
      })
      expect(pkt.markdown).not.toContain("#all")
      expect(pkt.markdown).toContain("L1-L6")
    } finally {
      workDb.close()
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test("5. VSC-R4 (S1-1, S3-5): reconcileProvenanceStaleness syncs session_semantic_digest.verification_state and exports formatVerificationGateLabel", () => {
    expect(typeof (continuityMod as Record<string, unknown>).formatVerificationGateLabel).toBe(
      "function",
    )
    const formatGate = (continuityMod as unknown as {
      formatVerificationGateLabel: (state: string, stalePaths?: readonly string[]) => string
    }).formatVerificationGateLabel

    expect(formatGate("verified_passed")).toContain("verified_passed")
    expect(formatGate("verified_stale_by_later_touch", ["src/foo.ts"])).toContain(
      "verified_stale_by_later_touch",
    )
    expect(formatGate("verified_stale_by_later_touch", ["src/foo.ts"])).toContain("src/foo.ts")

    const tmpRoot = join(tmpdir(), `hivemind-vsc-r4-gate-${Date.now()}`)
    mkdirSync(join(tmpRoot, "src"), { recursive: true })
    const workDb = new Database(":memory:")
    try {
      workDb.exec(ARCHIVE_INDEX_DDL)
      ensureContinuitySchema(workDb)

      const sessionId = "ses_gate_sync_test"
      workDb
        .query(
          "INSERT INTO session (id, root_id, project_id, depth, lane_kind, lane_path, harness, t_created, t_updated) VALUES (?, ?, 'proj', 0, 'root', '', 'opencode', 1000, 2000)",
        )
        .run(sessionId, sessionId)
      workDb
        .query(
          `INSERT INTO session_semantic_digest (
            session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state
          ) VALUES (?, ?, 'Gate Sync Headline', '[]', '["src/mod.ts"]', '[]', 'verified_passed')`,
        )
        .run(sessionId, sessionId)

      const modRel = "src/mod.ts"
      const modAbs = join(tmpRoot, modRel)
      const initialContent = "export const v = 1;\n"
      const initialSha = sha256Hex(initialContent)
      writeFileSync(modAbs, initialContent, "utf8")

      workDb
        .query(
          `INSERT INTO file_read_ledger (
            session_id, path, normalized_path, line_range, start_line, end_line, total_lines, is_truncated,
            read_blob_sha, read_seq, disk_blob_sha, staleness_status
          ) VALUES (?, ?, ?, 'L1-L1', 1, 1, 1, 0, ?, 1, ?, 'FRESH — DO NOT REREAD')`,
        )
        .run(sessionId, modRel, modRel, initialSha, initialSha)

      workDb
        .query(
          `INSERT INTO provenance_chain (
            chain_id, root_session_id, session_id, finding_id, finding_seq, finding_summary,
            target_path, read_or_review_blob_sha, repair_blob_sha, verification_exit_code,
            disk_blob_sha, staleness_status, updated_at
          ) VALUES ('chain_mod', ?, ?, 'F-MOD-1', 1, 'Verify mod', ?, ?, ?, 0, ?, 'VERIFIED_FRESH', '2026-10-19T00:00:00Z')`,
        )
        .run(sessionId, sessionId, modRel, initialSha, initialSha, initialSha)

      // 1. Initially fresh on disk -> verification_state is verified_passed
      reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      const digestFresh = workDb
        .query("SELECT verification_state FROM session_semantic_digest WHERE session_id = ?")
        .get(sessionId) as { verification_state: string }
      expect(digestFresh.verification_state).toBe("verified_passed")

      // 2. Touch file on disk -> verification_state transitions to verified_stale_by_later_touch
      writeFileSync(modAbs, "export const v = 2; // modified after test pass\n", "utf8")
      reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      const digestStale = workDb
        .query("SELECT verification_state FROM session_semantic_digest WHERE session_id = ?")
        .get(sessionId) as { verification_state: string }
      expect(digestStale.verification_state).toBe("verified_stale_by_later_touch")

      const reportStale = renderProvenanceReport(workDb, sessionId, tmpRoot)
      expect(reportStale).toContain("verified_stale_by_later_touch")

      const pktStale = buildCompactionContinuationPacket(workDb, {
        sessionId,
        canonicalRoot: tmpRoot,
      })
      expect(pktStale.verificationGateStatus).toBe("verified_stale_by_later_touch")
      expect(pktStale.markdown).toContain("verified_stale_by_later_touch")

      // 3. Restore file on disk -> verification_state returns to verified_passed
      writeFileSync(modAbs, initialContent, "utf8")
      reconcileProvenanceStaleness(workDb, tmpRoot, sessionId)
      const digestRestored = workDb
        .query("SELECT verification_state FROM session_semantic_digest WHERE session_id = ?")
        .get(sessionId) as { verification_state: string }
      expect(digestRestored.verification_state).toBe("verified_passed")
    } finally {
      workDb.close()
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  test("6. passes 7-sample interleaved benchmark across synthetic compactions with < 1,200 tokens and < 2 ms latency", () => {
    const report = runSevenSampleCompactionBenchmark(db, 7)
    expect(report.samples).toBe(7)
    expect(report.compactionsEvaluated).toBe(2)
    expect(report.aggregateBuildPacketMedianMs).toBeLessThan(2.0)
    expect(report.aggregateReconcileMedianMs).toBeLessThan(2.0)
  })
})
