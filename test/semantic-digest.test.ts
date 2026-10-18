import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { initSyncDatabase } from "../src/archive/index-db.ts"
import { sha256Hex } from "../src/archive/primitives.ts"
import {
  INTENT_PIVOT_KINDS,
  classifyIntentPivot,
  ensureSemanticDigestSchema,
  expandCompoundBoundaryTokens,
  isHumanPromptText,
  materializeSemanticDigests,
  queryVibeNavigation,
  renderIntentTimeline,
  resolvePromptBlob,
  runSevenSampleBenchmark,
} from "../src/viewports/semantic-digest.ts"
import { makeTmpDir } from "./helpers.ts"

describe("VSC-01 / VSC-R1: semantic session digest, 9-category IntentPivot, and FTS5 vibe navigation", () => {
  test("expandCompoundBoundaryTokens splits letter-digit and hyphenated tokens for FTS5", () => {
    expect(expandCompoundBoundaryTokens("wave2-slice1")).toBe("wave 2 slice 1")
    expect(expandCompoundBoundaryTokens("44-step")).toBe("44 step")
    expect(expandCompoundBoundaryTokens("mh28")).toBe("mh 28")
    expect(expandCompoundBoundaryTokens("VSC-01")).toBe("VSC 01")
  })

  test("classifyIntentPivot deterministically categorizes prompts across all 9 IntentPivotKind values and filters synthetic prompts", () => {
    expect(INTENT_PIVOT_KINDS.length).toBe(9)

    expect(classifyIntentPivot("Opening goal for Wave 2", 0)).toBe("initial_goal")
    expect(classifyIntentPivot("Build the semantic digest module", 4, { isFirstPrompt: true })).toBe(
      "initial_goal",
    )
    expect(classifyIntentPivot("wrong position read fucking request again", 2)).toBe(
      "course_correction",
    )
    expect(classifyIntentPivot("ok", 5)).toBe("approval")
    expect(classifyIntentPivot("you can use devin for these spec and plan work", 6)).toBe("approval")
    expect(classifyIntentPivot("continue", 3)).toBe("handoff_resume")
    expect(classifyIntentPivot("move this session to .worktree/wave2-slice1 workspace", 4)).toBe(
      "handoff_resume",
    )
    expect(
      classifyIntentPivot(
        "you can try to prune the context to look at my prompting throughout and continue on from this with exact same posture",
        2,
      ),
    ).toBe("prune_or_continuity")
    expect(classifyIntentPivot("run bun test and verify the check gate to prove it works", 3)).toBe(
      "verification_directive",
    )
    expect(
      classifyIntentPivot("only do VSC-01 and skip the rest, narrow scope to src/viewports", 4),
    ).toBe("scope_narrowing")
    expect(classifyIntentPivot("continue after compaction from the continuation packet", 5)).toBe(
      "continuation_after_compaction",
    )
    expect(
      classifyIntentPivot("Proceed with the next unit of work", 8, { afterCompaction: true }),
    ).toBe("continuation_after_compaction")
    expect(classifyIntentPivot("@bro tell main point what needs improvements", 4)).toBe("followup")

    expect(isHumanPromptText("<subagent call_1>done</subagent>")).toBe(false)
    expect(isHumanPromptText("<shell call_2>exit 0</shell>")).toBe(false)
    expect(isHumanPromptText("<conversation-checkpoint>summary</conversation-checkpoint>")).toBe(false)
    expect(isHumanPromptText("The server restarted while you were working.")).toBe(false)
    expect(isHumanPromptText("Implement VSC-01 with TDD")).toBe(true)
  })

  test("materializeSemanticDigests and queryVibeNavigation surface transparent FTS5 relevance breakdown, 0-match honesty, and zero fabricated S2 footers", () => {
    const tmpDir = makeTmpDir()
    const archiveDir = join(tmpDir, ".session-archive")
    const sqlitePath = join(archiveDir, "index.sqlite")
    const db = initSyncDatabase(sqlitePath)

    try {
      ensureSemanticDigestSchema(db)

      const ftsSql = db
        .query("SELECT sql FROM sqlite_master WHERE name = 'substrate_fts'")
        .get() as { sql: string } | null
      expect(ftsSql?.sql.toLowerCase()).toContain("porter unicode61")

      const rootA = "ses_synthetic_root_a"
      const childA1 = "ses_synthetic_child_a1"
      const rootB = "ses_synthetic_root_b"

      const insertSession = db.query(`
        INSERT INTO session (
          id, root_id, project_id, parent_id, depth, lane_kind, lane_path,
          title, agent, harness, outcome, message_count, transcript_path, t_created, t_updated
        ) VALUES (?, ?, 'proj_test', ?, ?, 'root', '', ?, ?, ?, ?, ?, ?, 1000, 2000)
      `)

      insertSession.run(
        rootA,
        rootA,
        null,
        0,
        "Wave2-Slice1 Semantic Digest & Vibe Navigation",
        "ultra",
        "opencode",
        "succeeded",
        12,
        `sessions/${rootA}/${rootA}.jsonl`,
      )
      insertSession.run(
        childA1,
        rootA,
        rootA,
        1,
        "Antigravity Review Seat",
        "antigravity-review",
        "antigravity",
        "succeeded",
        4,
        `sessions/${rootA}/subagents/${childA1}/${childA1}.jsonl`,
      )
      insertSession.run(
        rootB,
        rootB,
        null,
        0,
        "Database Migration & CoChange Matrix",
        "ultra",
        "opencode",
        "succeeded",
        3,
        `sessions/${rootB}/${rootB}.jsonl`,
      )

      const rootADir = join(archiveDir, "sessions", rootA)
      mkdirSync(rootADir, { recursive: true })
      const rootAJsonl = [
        JSON.stringify({ kind: "session", id: rootA }),
        JSON.stringify({
          id: "msg_1",
          kind: "user",
          t: 1001,
          raw_ref: { session_id: rootA, message_id: "msg_1", seq: 1 },
          text: "Implement wave2-slice1 semantic session digest and FTS5 vibe navigation",
        }),
        JSON.stringify({
          id: "msg_syn",
          kind: "user",
          t: 1002,
          raw_ref: { session_id: rootA, message_id: "msg_syn", seq: 2 },
          text: "<subagent call_1>synthetic message should be ignored</subagent>",
        }),
        JSON.stringify({
          id: "msg_2",
          kind: "user",
          t: 1003,
          raw_ref: { session_id: rootA, message_id: "msg_2", seq: 3 },
          text: "wrong position do not keep reading everything",
        }),
        JSON.stringify({
          id: "msg_3",
          kind: "user",
          t: 1004,
          raw_ref: { session_id: rootA, message_id: "msg_3", seq: 4 },
          text: "only do src/viewports/semantic-digest.ts and skip other files, narrow scope to VSC-01",
        }),
        JSON.stringify({
          id: "msg_4",
          kind: "user",
          t: 1005,
          raw_ref: { session_id: rootA, message_id: "msg_4", seq: 5 },
          text: "continue from the point of handoff",
        }),
        JSON.stringify({
          id: "msg_5",
          kind: "user",
          t: 1006,
          raw_ref: { session_id: rootA, message_id: "msg_5", seq: 6 },
          text: "prune the context and persist this session",
        }),
        JSON.stringify({
          id: "msg_comp",
          kind: "compaction",
          t: 1007,
          raw_ref: { session_id: rootA, message_id: "msg_comp", seq: 7 },
          reason: "auto",
          tokens: { input: 210000 },
        }),
        JSON.stringify({
          id: "msg_6",
          kind: "user",
          t: 1008,
          raw_ref: { session_id: rootA, message_id: "msg_6", seq: 8 },
          text: "Resume after compaction checkpoint and finish the FTS5 ranking",
        }),
        JSON.stringify({
          id: "msg_7",
          kind: "user",
          t: 1009,
          raw_ref: { session_id: rootA, message_id: "msg_7", seq: 9 },
          text: "run bun test and verify the check gate to prove it works",
        }),
        JSON.stringify({
          id: "msg_8",
          kind: "user",
          t: 1010,
          raw_ref: { session_id: rootA, message_id: "msg_8", seq: 10 },
          text: "approved, ship it",
        }),
        JSON.stringify({
          id: "msg_9",
          kind: "user",
          t: 1011,
          raw_ref: { session_id: rootA, message_id: "msg_9", seq: 11 },
          text: "@bro summarize what changed in this slice",
        }),
      ].join("\n")
      writeFileSync(join(rootADir, `${rootA}.jsonl`), rootAJsonl, "utf8")

      const rootBDir = join(archiveDir, "sessions", rootB)
      mkdirSync(rootBDir, { recursive: true })
      writeFileSync(
        join(rootBDir, `${rootB}.jsonl`),
        [
          JSON.stringify({ kind: "session", id: rootB }),
          JSON.stringify({
            id: "msg_b1",
            kind: "user",
            t: 1100,
            raw_ref: { session_id: rootB, message_id: "msg_b1", seq: 1 },
            text: "Build git cochange matrix and pagerank centrality map",
          }),
        ].join("\n"),
        "utf8",
      )

      db.query(`
        INSERT INTO delegation (
          call_id, root_id, parent_session, parent_message_id, child_session,
          tool, agent, harness, mode, background, description, prompt_ref, status, t_created, t_completed
        ) VALUES ('call_a1', ?, ?, 'msg_2', ?, 'hivemind-delegate', 'antigravity-review', 'antigravity', 'spawn', 0, 'Audit wave2-slice1 boundary', null, 'completed', 1003, 1004)
      `).run(rootA, rootA, childA1)

      db.query(`
        INSERT INTO delegation_turn (
          parent_session_id, call_id, turn_index, child_session_id, mode, harness,
          agent, model, foreign_session_id, start_seq, end_seq, start_message_id, end_message_id,
          reported_outcome, verified_outcome, blocker_summary, tool_error_count, tool_completed_count, text_char_count
        ) VALUES (?, 'call_a1', 0, ?, 'spawn', 'antigravity', 'antigravity-review', 'gemini', 'for_1', 1, 4, 'm1', 'm4', 'succeeded', 'tool_error_inside', 'MCP tool failed', 1, 2, 300)
      `).run(rootA, childA1)

      db.query(`
        INSERT INTO file_touch (session_id, seq, call_id, tool, op, path, normalized_path, detail, t)
        VALUES (?, 4, 'call_t1', 'write', 'write', 'src/viewports/semantic-digest.ts', 'src/viewports/semantic-digest.ts', null, 1004)
      `).run(rootA)

      db.query(`
        INSERT INTO kv_context_prune (session_id, raw_key, scope, mode, anchor_message_id, recorded_at, updated_at)
        VALUES (?, 'context-prune:ses_synthetic_root_a', 'session', 'step-window', 'msg_5', '2026-10-18T00:00:00Z', 1006)
      `).run(rootA)

      const report = materializeSemanticDigests(db, { archiveDir })
      expect(report.sessionsIndexed).toBe(3)
      expect(report.intentPivotsIndexed).toBe(10)

      const pivots = db
        .query("SELECT seq, pivot_kind, blob_ref, prompt_blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC")
        .all(rootA) as { seq: number; pivot_kind: string; blob_ref: string; prompt_blob_ref: string }[]

      expect(pivots.length).toBe(9)
      expect(pivots.map((p) => p.pivot_kind)).toEqual([
        "initial_goal",
        "course_correction",
        "scope_narrowing",
        "handoff_resume",
        "prune_or_continuity",
        "continuation_after_compaction",
        "verification_directive",
        "approval",
        "followup",
      ])

      for (const p of pivots) {
        expect(p.blob_ref.startsWith("blob:")).toBe(true)
        expect(p.prompt_blob_ref).toBe(p.blob_ref)
        const hydrated = resolvePromptBlob(db, p.blob_ref, archiveDir)
        expect(hydrated).not.toBeNull()
        expect(`blob:${sha256Hex(hydrated!)}`).toBe(p.blob_ref)
      }

      const timeline = renderIntentTimeline(db, rootA, { archiveDir })
      expect(timeline.sessionID).toBe(rootA)
      expect(timeline.pivots.length).toBe(9)
      expect(timeline.markdown).toContain("[continuation_after_compaction]")
      expect(timeline.markdown).toContain("[verification_directive]")
      expect(timeline.markdown).toContain("[scope_narrowing]")

      // 1. Positive FTS5 search with transparent relevance breakdown
      const nav = queryVibeNavigation(db, {
        query: "wave 2 slice 1 semantic digest FTS5",
        limit: 3,
        maxTokens: 600,
      })
      expect(nav.matchedRootSessionID).toBe(rootA)
      expect(nav.digest.matched_root?.session_id).toBe(rootA)
      expect(nav.tokenCoverage).toBeGreaterThan(0.5)
      expect(nav.metrics.markdown_tokens).toBeLessThan(600)
      expect(nav.markdown).toContain("src/viewports/semantic-digest.ts")
      expect(nav.markdown).toContain("reported=`succeeded` -> verified=`tool_error_inside`")
      expect(nav.markdown).toMatch(/coverage=\d+\/\d+ \(\d+%\) \| bm25=-?\d+\.\d{2} \| score=-?\d+\.\d{2}/)
      expect(nav.markdown).toContain("Strategist Viewport search (")
      expect(nav.markdown).toContain("matched 1 of 2 indexed root session(s)")
      expect(nav.markdown).not.toContain("S2 msg[124..125]")
      expect(nav.markdown).not.toContain("replaced 2 shell/Python JSONL scrapes")

      // 2. Honest 0-match response when query tokens do not match any indexed session
      const zeroMatch = queryVibeNavigation(db, {
        query: "xyznonexistentquantumfluxcapacitor",
        limit: 3,
        maxTokens: 600,
      })
      expect(zeroMatch.matchedSessions).toEqual([])
      expect(zeroMatch.matchedRootSessionID).toBe("")
      expect(zeroMatch.markdown).toContain(
        'No matching sessions found for query "xyznonexistentquantumfluxcapacitor" across 2 indexed root session(s).',
      )
      expect(zeroMatch.markdown).not.toContain("S2 msg[124..125]")

      // 3. 7-sample benchmark check
      const summaries = runSevenSampleBenchmark(db, [
        "wave 2 slice 1 semantic digest",
        "cochange matrix pagerank",
      ])
      expect(summaries.length).toBe(2)
      for (const s of summaries) {
        expect(s.samples).toBe(7)
        expect(s.median_ms).toBeLessThan(5)
        expect(s.markdown_tokens).toBeLessThan(600)
      }
    } finally {
      db.close()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
