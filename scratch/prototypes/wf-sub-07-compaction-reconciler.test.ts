import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import type { Database } from "bun:sqlite"
import { sha256hex } from "../../src/archive/normalize.ts"
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
  querySubstrateContinuity,
  reconcileProvenanceStaleness,
  runSevenSampleCompactionBenchmark,
} from "./wf-sub-07-compaction-reconciler.ts"

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

describe("WF-SUB-07: Unified Compaction Continuity & Provenance Chain Staleness Reconciler", () => {
  const upstreamHashesBefore = new Map<string, string>()
  let db: Database

  beforeAll(() => {
    for (const p of PROTECTED_UPSTREAM_DBS) {
      upstreamHashesBefore.set(p, hashFile(p))
    }
    db = buildUnifiedContinuityDatabase({
      targetDbPath: DEFAULT_TARGET_DB_PATH,
    })
  })

  afterAll(() => {
    db.close()
    for (const p of PROTECTED_UPSTREAM_DBS) {
      expect(hashFile(p)).toBe(upstreamHashesBefore.get(p)!)
    }
  })

  test("1. unifies WF-SUB-01, WF-SUB-02, WF-SUB-03, and WF-SUB-05/06 tables into wf-sub-07-continuity.sqlite without mutating upstream DBs", () => {
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

  test("2. fixes S1 msg[58] failure by defaulting sessionID from hookContext or SQLite latest root session", () => {
    // Exact S1 msg[58] call: compaction_continuity({ action: "intents" }) without input.sessionID
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
    expect((emptyCall.data.tokenCount as number)).toBeLessThan(1200)

    // Calling timeline and provenance without input.sessionID
    const timelineCall = querySubstrateContinuity(
      db,
      { action: "timeline" },
      { sessionID: S2_SESSION_ID },
    )
    expect(timelineCall.ok).toBe(true)
    expect(timelineCall.resolvedSessionID).toBe(S2_SESSION_ID)
    expect((timelineCall.data.userIntents as unknown[]).length).toBe(9)

    const provCall = querySubstrateContinuity(
      db,
      { action: "provenance" },
      { sessionID: S1_SESSION_ID },
    )
    expect(provCall.ok).toBe(true)
    expect(provCall.resolvedSessionID).toBe(S1_SESSION_ID)
    expect((provCall.data.provenanceChains as unknown[]).length).toBeGreaterThanOrEqual(2)
  })

  test("3. synthesizes deterministic < 1,200-token continuation packets across all compactions and covers all 15+ skills and 28 files from S1 msg[52..63]", () => {
    const compactionRows = db
      .query("SELECT session_id, seq FROM compaction ORDER BY session_id, seq")
      .all() as { session_id: string; seq: number }[]
    expect(compactionRows.length).toBeGreaterThanOrEqual(6)

    for (const c of compactionRows) {
      const pkt = buildCompactionContinuationPacket(db, c.session_id, { seq: c.seq })
      expect(pkt.withinBudget).toBe(true)
      expect(pkt.tokenCount).toBeLessThan(1200)
      expect(pkt.tokenCount).toBeGreaterThan(400)
      expect(pkt.markdown).toContain("### 1. Intent Pivot Timeline")
      expect(pkt.markdown).toContain("### 2. Working-Memory Manifest")
      expect(pkt.markdown).toContain("### 3. Delegation Trajectory")
      expect(pkt.markdown).toContain("### 4. Provenance Chain")
      expect(pkt.markdown).toContain("### 5. Tier-1 RepoMap & Co-Change Alerts")
    }

    // Verify S1 (ses_eb2eabb14ffeCXsCwb845rtffb at msg[51] / seq=865)
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
    const s2Packet = buildCompactionContinuationPacket(db, S2_SESSION_ID, { seq: 847 })
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

    // Verify compaction hook mutates compactionEvent.system in place
    const hookEvent = {
      sessionID: S1_SESSION_ID,
      seq: 865,
      system: [{ type: "text" as const, text: "Base compaction system prompt" }],
    }
    const hookedPacket = applyCompactionContinuityHook(db, hookEvent)
    expect(hookEvent.system.length).toBe(2)
    expect(hookEvent.system[1]?.text).toBe(hookedPacket.markdown)
  })

  test("4. reconciles provenance chain and file read staleness deterministically when a covered file is modified on disk (Invariant 4)", () => {
    // 1. Baseline S1 state: all 28 files FRESH — DO NOT REREAD, both provenance chains VERIFIED_FRESH
    const s1Initial = reconcileProvenanceStaleness(db, S1_SESSION_ID)
    expect(s1Initial.staleFilesCount).toBe(0)
    expect(s1Initial.staleChainsCount).toBe(0)

    const nativeFileBefore = s1Initial.fileRows.find(
      (f) => f.path === "src/delegation/native-delegation.ts",
    )!
    expect(nativeFileBefore.staleness_status).toBe("FRESH — DO NOT REREAD")

    const nativeChainBefore = s1Initial.chainRows.find(
      (c) => c.chain_id === "chain_s1_native_delegation",
    )!
    expect(nativeChainBefore.staleness_status).toBe("VERIFIED_FRESH")

    // 2. Simulate modifying src/delegation/native-delegation.ts on disk
    const modifiedNativeSha = sha256hex("modified:src/delegation/native-delegation.ts:post-review-edit")
    const s1AfterEdit = reconcileProvenanceStaleness(db, S1_SESSION_ID, {
      "src/delegation/native-delegation.ts": modifiedNativeSha,
    })

    expect(s1AfterEdit.staleFilesCount).toBe(1)
    expect(s1AfterEdit.staleChainsCount).toBe(1)
    expect(s1AfterEdit.transitionedFilePaths).toContain("src/delegation/native-delegation.ts")
    expect(s1AfterEdit.transitionedChainIds).toContain("chain_s1_native_delegation")

    const nativeFileAfter = s1AfterEdit.fileRows.find(
      (f) => f.path === "src/delegation/native-delegation.ts",
    )!
    expect(nativeFileAfter.staleness_status).toBe(
      "STALE (modified since read/review — re-verify slice)",
    )

    const nativeChainAfter = s1AfterEdit.chainRows.find(
      (c) => c.chain_id === "chain_s1_native_delegation",
    )!
    expect(nativeChainAfter.staleness_status).toBe("verified_stale_by_later_touch")

    const s1StalePacket = buildCompactionContinuationPacket(db, S1_SESSION_ID, { seq: 865 })
    expect(s1StalePacket.withinBudget).toBe(true)
    expect(s1StalePacket.tokenCount).toBeLessThan(1200)
    expect(s1StalePacket.sections.staleFilesCount).toBe(1)
    expect(s1StalePacket.sections.freshFilesCount).toBe(27)
    expect(s1StalePacket.markdown).toContain(
      "- **STALE (modified since read/review — re-verify slice):** `src/delegation/native-delegation.ts#",
    )
    expect(s1StalePacket.markdown).toContain(
      "STALE (modified since read/review — re-verify slice) [verified_stale_by_later_touch]",
    )

    // 3. Restore original SHA on disk for S1 and verify deterministic recovery to FRESH / VERIFIED_FRESH
    const s1Restored = reconcileProvenanceStaleness(db, S1_SESSION_ID, {
      "src/delegation/native-delegation.ts": nativeFileBefore.read_blob_sha,
    })
    expect(s1Restored.staleFilesCount).toBe(0)
    expect(s1Restored.staleChainsCount).toBe(0)
    expect(
      s1Restored.chainRows.find((c) => c.chain_id === "chain_s1_native_delegation")?.staleness_status,
    ).toBe("VERIFIED_FRESH")

    // 4. Also verify S2 (.planning/SPEC.md) staleness transition
    const s2Initial = reconcileProvenanceStaleness(db, S2_SESSION_ID)
    const specFileBefore = s2Initial.fileRows.find((f) => f.path === ".planning/SPEC.md")!
    expect(specFileBefore.staleness_status).toBe("FRESH — DO NOT REREAD")

    const modifiedSpecSha = sha256hex("modified:.planning/SPEC.md:later-edit")
    const s2AfterEdit = reconcileProvenanceStaleness(db, S2_SESSION_ID, {
      ".planning/SPEC.md": modifiedSpecSha,
    })
    expect(s2AfterEdit.transitionedFilePaths).toContain(".planning/SPEC.md")
    expect(s2AfterEdit.transitionedChainIds).toContain("chain_s2_spec_realignment")
    expect(
      s2AfterEdit.fileRows.find((f) => f.path === ".planning/SPEC.md")?.staleness_status,
    ).toBe("STALE (modified since read/review — re-verify slice)")
    expect(
      s2AfterEdit.chainRows.find((c) => c.chain_id === "chain_s2_spec_realignment")?.staleness_status,
    ).toBe("verified_stale_by_later_touch")

    const s2StalePacket = buildCompactionContinuationPacket(db, S2_SESSION_ID, { seq: 847 })
    expect(s2StalePacket.tokenCount).toBeLessThan(1200)
    expect(s2StalePacket.markdown).toContain(
      "- **STALE (modified since read/review — re-verify slice):** `.planning/SPEC.md#",
    )

    // Restore S2 .planning/SPEC.md
    reconcileProvenanceStaleness(db, S2_SESSION_ID, {
      ".planning/SPEC.md": specFileBefore.read_blob_sha,
    })
    buildCompactionContinuationPacket(db, S1_SESSION_ID, { seq: 865 })
    buildCompactionContinuationPacket(db, S2_SESSION_ID, { seq: 847 })
  })

  test("5. passes 7-sample interleaved benchmark across all compactions with < 1,200 tokens and < 2 ms latency", () => {
    const report = runSevenSampleCompactionBenchmark(db, 7)
    expect(report.samples).toBe(7)
    expect(report.compactionsEvaluated).toBeGreaterThanOrEqual(6)
    expect(report.aggregateBuildPacketMedianMs).toBeLessThan(2.0)
    expect(report.aggregateReconcileMedianMs).toBeLessThan(1.0)

    for (const entry of report.entries) {
      expect(entry.within1200Budget).toBe(true)
      expect(entry.packetTokens).toBeLessThan(1200)
      expect(entry.buildPacketSamplesMs.length).toBe(7)
      expect(entry.reconcileSamplesMs.length).toBe(7)
      expect(entry.buildPacketMedianMs).toBeLessThan(2.0)
      expect(entry.reconcileMedianMs).toBeLessThan(1.0)
    }
  })
})
