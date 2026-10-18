import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { Database } from "bun:sqlite"
import { sha256hex } from "../../src/archive/normalize.ts"
import {
  DEFAULT_SOURCE_ARCHIVE_DIR,
  DEFAULT_TARGET_DB_PATH,
  buildSemanticDigestIndex,
  classifyPivotKind,
  queryVibeNavigation,
  resolvePromptBlob,
  runSevenSampleBenchmark,
} from "./wf-sub-01-semantic-digest.ts"

describe("WF-SUB-01 semantic session digest, intent pivot index & vibe navigation", () => {
  let db: Database
  let sourceMtimeBefore: number
  let buildStats: ReturnType<typeof buildSemanticDigestIndex>

  beforeAll(() => {
    sourceMtimeBefore = statSync(`${DEFAULT_SOURCE_ARCHIVE_DIR}/index.sqlite`).mtimeMs
    buildStats = buildSemanticDigestIndex()
    db = new Database(DEFAULT_TARGET_DB_PATH, { readonly: true })
  })

  afterAll(() => {
    db?.close()
  })

  test("preserves source archive index.sqlite read-only and populates all 3 semantic tables", () => {
    const sourceMtimeAfter = statSync(`${DEFAULT_SOURCE_ARCHIVE_DIR}/index.sqlite`).mtimeMs
    expect(sourceMtimeAfter).toBe(sourceMtimeBefore)

    expect(buildStats.sessionsIndexed).toBeGreaterThanOrEqual(56)
    expect(buildStats.intentPivotsIndexed).toBeGreaterThanOrEqual(87)
    expect(buildStats.ftsRowsIndexed).toBeGreaterThan(400)

    const digestCount = (
      db.query("SELECT count(*) as c FROM session_semantic_digest").get() as { c: number }
    ).c
    const pivotCount = (db.query("SELECT count(*) as c FROM intent_pivot").get() as { c: number }).c
    const ftsCount = (db.query("SELECT count(*) as c FROM substrate_fts").get() as { c: number }).c

    expect(digestCount).toBe(buildStats.sessionsIndexed)
    expect(pivotCount).toBe(buildStats.intentPivotsIndexed)
    expect(ftsCount).toBe(buildStats.ftsRowsIndexed)
  })

  test("classifies user prompts into all 6 deterministic pivot_kind variants with lossless blob:<sha256> hydration", () => {
    const distinctKinds = db
      .query("SELECT DISTINCT pivot_kind FROM intent_pivot ORDER BY pivot_kind")
      .all()
      .map((r) => (r as { pivot_kind: string }).pivot_kind)

    expect(distinctKinds).toEqual([
      "approval",
      "course_correction",
      "followup",
      "handoff_resume",
      "initial_goal",
      "prune_or_continuity",
    ])

    expect(classifyPivotKind("Opening goal for Wave 2", 0)).toBe("initial_goal")
    expect(classifyPivotKind("wrong position read fucking request again", 2)).toBe("course_correction")
    expect(classifyPivotKind("ok", 5)).toBe("approval")
    expect(classifyPivotKind("continue", 3)).toBe("handoff_resume")
    expect(
      classifyPivotKind(
        "I have reloaded this /Users/MAC/.../.worktree/wave2-slice1 - you can try to prune the context to look at my prompting throughout and continue on from this with exact same posture",
        2,
      ),
    ).toBe("prune_or_continuity")
    expect(classifyPivotKind("@bro tell main point what needs improvements", 4)).toBe("followup")

    const s2Pivots = db
      .query("SELECT seq, message_id, pivot_kind, blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC")
      .all("ses_eb23bfbf0ffesn5kT0yJI06h35") as {
      seq: number
      message_id: string
      pivot_kind: string
      blob_ref: string
    }[]

    expect(s2Pivots.map((p) => p.seq)).toEqual([4, 511, 1243, 1474, 1946, 2002, 2059, 2650, 2859])
    for (const p of s2Pivots) {
      expect(p.blob_ref.startsWith("blob:")).toBe(true)
      const hydrated = resolvePromptBlob(db, p.blob_ref)
      expect(hydrated).not.toBeNull()
      expect(`blob:${sha256hex(hydrated!)}`).toBe(p.blob_ref)
    }
  })

  test("overlays exported fixture timeline for ses_eb2eabb14ffeCXsCwb845rtffb including @bro followup and 44-step 0-byte prune fact", () => {
    const s1Pivots = db
      .query("SELECT seq, message_id, prompt_excerpt, pivot_kind FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC")
      .all("ses_eb2eabb14ffeCXsCwb845rtffb") as {
      seq: number
      message_id: string
      prompt_excerpt: string
      pivot_kind: string
    }[]

    expect(s1Pivots.length).toBe(5)
    expect(s1Pivots[4]?.message_id).toBe("msg_14d3d545e001uj0aCRYealg0wS")
    expect(s1Pivots[4]?.prompt_excerpt).toContain("@bro tell main point")

    const s1Digest = db
      .query("SELECT key_decisions_json, touched_files_json FROM session_semantic_digest WHERE session_id = ?")
      .get("ses_eb2eabb14ffeCXsCwb845rtffb") as { key_decisions_json: string; touched_files_json: string }

    const decisions = JSON.parse(s1Digest.key_decisions_json) as string[]
    expect(decisions.some((d) => d.includes("44-step") && d.includes("0 bytes"))).toBe(true)
    expect(decisions.some((d) => d.includes("compaction_continuity") && d.includes("missing sessionID"))).toBe(true)
  })

  test("queryVibeNavigation resolves all 3 natural-language queries in < 600 tokens and contrasts against S2 msg[124..125]", () => {
    const q1 = queryVibeNavigation(db, "look at my prompting throughout and continue from Wave 2 slice")
    expect(q1.digest.matched_root.session_id).toBe("ses_eb23bfbf0ffesn5kT0yJI06h35")
    expect(q1.digest.matched_root.headline).toContain("Narrow Early-Failure Review of Delegation Repairs")
    expect(q1.metrics.pivots_returned).toBe(9)
    expect(q1.metrics.markdown_tokens).toBeLessThan(600)
    expect(q1.digest.vs_s2_msg124_125_failure.legacy_raw_jsonl_cap_chars).toBe(15000)
    expect(q1.digest.vs_s2_msg124_125_failure.token_reduction_pct).toBeGreaterThan(85)

    const q2 = queryVibeNavigation(
      db,
      "prune the context to look at my prompting throughout and continue on from this with exact same posture",
    )
    expect(q2.digest.matched_root.session_id).toBe("ses_eb23bfbf0ffesn5kT0yJI06h35")
    expect(q2.metrics.markdown_tokens).toBeLessThan(600)
    expect(q2.markdown).toContain("seq=1243")
    expect(q2.markdown).toContain("blob:fd75fe69bcf5")

    const q3 = queryVibeNavigation(db, "44-step auto-run context-prune 0 bytes")
    expect(q3.digest.matched_root.session_id).toBe("ses_eb2eabb14ffeCXsCwb845rtffb")
    expect(q3.digest.matched_root.headline).toContain("Prompt 2 preparation")
    expect(q3.metrics.markdown_tokens).toBeLessThan(600)
    expect(q3.metrics.json_tokens).toBeLessThan(600)
    expect(q3.markdown).toContain("44-step single-prompt auto-run")
  })

  test("7-sample interleaved benchmark achieves < 5 ms median latency across all queries", () => {
    const queries = [
      "look at my prompting throughout and continue from Wave 2 slice",
      "prune the context to look at my prompting throughout and continue on from this with exact same posture",
      "44-step auto-run context-prune 0 bytes",
    ]
    const summaries = runSevenSampleBenchmark(db, queries)
    expect(summaries.length).toBe(3)
    for (const s of summaries) {
      expect(s.samples).toBe(7)
      expect(s.median_ms).toBeLessThan(5)
      expect(s.max_ms).toBeLessThan(5)
      expect(s.markdown_tokens).toBeLessThan(600)
    }
  })
})
