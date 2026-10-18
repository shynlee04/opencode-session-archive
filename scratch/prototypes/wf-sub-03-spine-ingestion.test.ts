import { Database } from "bun:sqlite"
import { beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import {
  classifyMessagesOutcome,
  decodeHostKvKey,
  decodeUtf16BeHex,
  runSpineIngestionPrototype,
  segmentChildStops,
  sha256hex,
  type SpinePrototypeReport,
} from "./wf-sub-03-spine-ingestion"

const SQLITE_PATH =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-spine.sqlite"
const BLOB_DIR =
  "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-blobs"

let report: SpinePrototypeReport
let db: Database

beforeAll(() => {
  report = runSpineIngestionPrototype({
    targetSqlitePath: SQLITE_PATH,
    targetBlobDir: BLOB_DIR,
  })
  db = new Database(SQLITE_PATH, { readonly: true })
})

describe("WF-SUB-03 Spine Ingestion Prototype", () => {
  test("1. Host KV lineage & runtime state ingestion (both UTF-16BE host keys and v1 scoped keys)", () => {
    expect(decodeUtf16BeHex("0063006f006e0074006500780074002d007000720075006e0065")).toBe("context-prune")
    const decoded = decodeHostKvKey(
      "plugin:0068006900760065006d0069006e0064002d0073007400650077006100720064002d006f0063002d0064006500760069006e:bindings/ses_ecbea4dc7ffeRHomkI6oNWAtM6",
    )
    expect(decoded.scope).toBe("plugin:hivemind-steward-oc-devin")
    expect(decoded.logicalKey).toBe("bindings/ses_ecbea4dc7ffeRHomkI6oNWAtM6")

    expect(report.hostKvBindingsCount).toBeGreaterThanOrEqual(596)
    expect(report.hostKvForeignIndexCount).toBeGreaterThanOrEqual(596)
    expect(report.hostKvContextPrunesCount).toBeGreaterThanOrEqual(3)

    // Verify real host_db binding row for multi-stop Antigravity child ses_ecbea4dc7ffeRHomkI6oNWAtM6
    const realBinding = db
      .query("SELECT * FROM kv_binding WHERE child_session_id = ? AND source_origin = 'host_db'")
      .get("ses_ecbea4dc7ffeRHomkI6oNWAtM6") as Record<string, unknown> | null
    expect(realBinding).not.toBeNull()
    expect(realBinding?.harness).toBe("antigravity")
    expect(realBinding?.foreign_session_id).toBe("50afcb51-6449-4d27-823e-dc9d2a907f5a")
    expect(realBinding?.turn).toBe(2)
    expect(realBinding?.phase).toBe("acknowledged")
    expect(realBinding?.mode).toBe("send")
    expect(realBinding?.model).toBe("gemini-3.8-flash-high")
    expect(realBinding?.consumed_inputs_json).toBe(
      JSON.stringify(["msg_13415b2520014hSBr7rMTQrgLr", "msg_13423cca5001cwYJKIyVCfV4D8"]),
    )

    const witnessBinding = db
      .query("SELECT * FROM kv_binding WHERE child_session_id = ? AND source_origin = 'host_db'")
      .get("ses_eb2380061ffe43a9MAykqZYTQb") as Record<string, unknown> | null
    expect(witnessBinding?.serving_witness_model).toBe("SWE-2 Max")
    expect(witnessBinding?.confirmed_model).toBe("swe-2-high")

    // Verify WF-SUB-R02 illustrative v1 binding row for ses_ecbb24ca8ffeFd8wX7v0a9iY0j
    const r02Binding = db
      .query("SELECT * FROM kv_binding WHERE child_session_id = ? AND source_origin = 'wf_sub_r02_fixture'")
      .get("ses_ecbb24ca8ffeFd8wX7v0a9iY0j") as Record<string, unknown> | null
    expect(r02Binding).not.toBeNull()
    expect(r02Binding?.driver_kind).toBe("acp-W")
    expect(r02Binding?.harness).toBe("antigravity")
    expect(r02Binding?.foreign_session_id).toBe("agy-foreign-ecbb24ca8")
    expect(r02Binding?.parent_session_id).toBe("ses_ecbfc0f40ffenfykTrNGoMS6o1")
    expect(r02Binding?.mode).toBe("send")
    expect(r02Binding?.background).toBe(1)
    expect(r02Binding?.confirmed_model).toBe("gemini-4-argon-high")
    expect(r02Binding?.confirmed_effort).toBe("high")

    // Verify foreign index lookup
    const fIdx = db
      .query("SELECT * FROM kv_foreign_index WHERE harness = 'antigravity' AND foreign_session_id = 'agy-foreign-ecbb24ca8'")
      .get() as Record<string, unknown> | null
    expect(fIdx?.child_session_id).toBe("ses_ecbb24ca8ffeFd8wX7v0a9iY0j")

    // Verify context-prune watermarks (both real host_db and WF-SUB-R02 session:<id>:context-prune:<id>)
    const pruneP2 = db
      .query("SELECT * FROM kv_context_prune WHERE session_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'")
      .get() as Record<string, unknown> | null
    expect(pruneP2).not.toBeNull()
    expect(pruneP2?.mode).toBe("recent")
    expect(String(pruneP2?.anchor_message_id)).toMatch(/^msg_/)

    const pruneP1 = db
      .query("SELECT * FROM kv_context_prune WHERE session_id = 'ses_ecbfc0f40ffenfykTrNGoMS6o1'")
      .get() as Record<string, unknown> | null
    expect(pruneP1).not.toBeNull()
    expect(pruneP1?.mode).toBe("recent")
    expect(pruneP1?.anchor_message_id).toBe("msg_1340ebfb4001z58U5O2P8y2X0T")
  })

  test("2. Multi-stop delegation_turn normalization preserves all stops without overwrite", () => {
    // Verify WF-SUB-R02 exact message IDs for ses_ecbb24ca8ffeFd8wX7v0a9iY0j
    const r02Turns = db
      .query(
        "SELECT * FROM delegation_turn WHERE child_session_id = 'ses_ecbb24ca8ffeFd8wX7v0a9iY0j' ORDER BY turn_index ASC",
      )
      .all() as Array<Record<string, unknown>>
    expect(r02Turns.length).toBe(2)

    expect(r02Turns[0]?.turn_index).toBe(0)
    expect(r02Turns[0]?.mode).toBe("spawn")
    expect(r02Turns[0]?.start_message_id).toBe("msg_1340f258a001xL47zK6w3nK0E0")
    expect(r02Turns[0]?.end_message_id).toBe("msg_13410efbb001I29K7gX3C5U363")
    expect(r02Turns[0]?.reported_outcome).toBe("succeeded")
    expect(r02Turns[0]?.verified_outcome).toBe("verified_pass")

    expect(r02Turns[1]?.turn_index).toBe(1)
    expect(r02Turns[1]?.mode).toBe("send")
    expect(r02Turns[1]?.start_message_id).toBe("msg_1342be5250016yR75p270S30F6")
    expect(r02Turns[1]?.end_message_id).toBe("msg_1342dc0310018q5M1K3r0H4W8G")
    expect(r02Turns[1]?.reported_outcome).toBe("succeeded")
    expect(r02Turns[1]?.verified_outcome).toBe("verified_pass")

    // Verify all 7 real multi-stop children of ses_ecbfc0f40ffenfykTrNGoMS6o1 in host_db
    const realMultiStopChildren = db
      .query(`
        SELECT child_session_id, COUNT(*) as turn_count
        FROM delegation_turn
        WHERE parent_session_id = 'ses_ecbfc0f40ffenfykTrNGoMS6o1' AND source_origin = 'host_db'
        GROUP BY child_session_id
        HAVING COUNT(*) > 1
        ORDER BY child_session_id
      `)
      .all() as Array<{ child_session_id: string; turn_count: number }>
    expect(realMultiStopChildren.length).toBe(7)

    // Verify real Antigravity 2-stop child ses_ecbea4dc7ffeRHomkI6oNWAtM6
    const realAgTurns = db
      .query(
        "SELECT * FROM delegation_turn WHERE child_session_id = 'ses_ecbea4dc7ffeRHomkI6oNWAtM6' AND source_origin = 'host_db' ORDER BY turn_index ASC",
      )
      .all() as Array<Record<string, unknown>>
    expect(realAgTurns.length).toBe(2)
    expect(realAgTurns[0]?.mode).toBe("spawn")
    expect(realAgTurns[0]?.start_message_id).toBe("msg_13415b2520014hSBr7rMTQrgLr")
    expect(realAgTurns[0]?.end_message_id).toBe("msg_1341afb56002U6B05Rpao2ItW5")
    expect(realAgTurns[1]?.mode).toBe("send")
    expect(realAgTurns[1]?.start_message_id).toBe("msg_13423cca5001cwYJKIyVCfV4D8")
    expect(realAgTurns[1]?.end_message_id).toBe("msg_134260165001Z1pcmGxe776SCa")

    // Verify Devin child ses_ecb0cedf8ffen0PsHOY8iBYmnO (user -> assistant -> user -> assistant -> idle without intermediate idle)
    const devinNoMidIdle = db
      .query(
        "SELECT * FROM delegation_turn WHERE child_session_id = 'ses_ecb0cedf8ffen0PsHOY8iBYmnO' AND source_origin = 'host_db' ORDER BY turn_index ASC",
      )
      .all() as Array<Record<string, unknown>>
    expect(devinNoMidIdle.length).toBe(2)
    expect(devinNoMidIdle[0]?.mode).toBe("spawn")
    expect(devinNoMidIdle[1]?.mode).toBe("send")
  })

  test("3. ReportedOutcome vs VerifiedOutcome detects 100% of 11 false-positive Antigravity sessions + WF-SUB-R02 cases", () => {
    // 25 Antigravity children in P1 (19) + P2 (6), exactly 11 false-positive "succeeded" sessions
    expect(report.p1p2AntigravityChildrenCount).toBe(25)
    expect(report.p1p2AntigravityFalsePositivesCount).toBe(11)
    expect(report.p1p2AntigravityFalsePositiveIds).toEqual([
      "ses_ecbea4dc7ffeRHomkI6oNWAtM6",
      "ses_ecbcff4b6ffedCnGRuiLI2rZjP",
      "ses_ecbaee7ceffeac817i6a2bbnrS",
      "ses_ecb976e93ffeNHJhK36naggKfv",
      "ses_ecb73e10affe3IkqUVU37CtiYX",
      "ses_ecb5b9386ffe6KuUthhbCEpzmo",
      "ses_ecac8b9f3ffeocyPoQ213dVNGl",
      "ses_ecab2b14bffe03agFOieLyhVU4",
      "ses_eb218cdefffeQwYKeZ3iXjOt8I",
      "ses_eb1f7e37dffei8sNgQsv9R5Cui",
      "ses_eb1b750c2ffe4tqUHdVrcXMwbb",
    ])

    // Check real opencode.db context7 MCP failure session ses_ecbaee7ceffeac817i6a2bbnrS
    const realContext7 = db
      .query("SELECT * FROM delegation_turn WHERE child_session_id = 'ses_ecbaee7ceffeac817i6a2bbnrS'")
      .get() as Record<string, unknown> | null
    expect(realContext7?.reported_outcome).toBe("succeeded")
    expect(realContext7?.verified_outcome).toBe("blocked_in_text")
    expect(String(realContext7?.blocker_summary)).toContain("context7")

    // Check real opencode.db read-lease failure session ses_eb1f7e37dffei8sNgQsv9R5Cui
    const realLease = db
      .query("SELECT * FROM delegation_turn WHERE child_session_id = 'ses_eb1f7e37dffei8sNgQsv9R5Cui'")
      .get() as Record<string, unknown> | null
    expect(realLease?.reported_outcome).toBe("succeeded")
    expect(realLease?.verified_outcome).toBe("tool_error_inside")
    expect(Number(realLease?.tool_error_count)).toBe(28)

    // Check the 3 WF-SUB-R02 illustrative false-positive sessions
    for (const [id, expectedSubstring] of [
      ["ses_ecb8ab382ffe6D8z1uA2jQ7sT4", "MCP server context7 timed out"],
      ["ses_ecba9633effe9G0n4tP1kL5wR2", "tavily-search MCP tool failed"],
      ["ses_eb1f7e38dffeqA9W0cM5xN8pL1", "read lease violation"],
    ] as const) {
      const row = db
        .query("SELECT * FROM delegation_turn WHERE child_session_id = ? AND source_origin = 'wf_sub_r02_fixture'")
        .get(id) as Record<string, unknown> | null
      expect(row).not.toBeNull()
      expect(row?.reported_outcome).toBe("succeeded")
      expect(row?.verified_outcome).toBe("blocked_in_text")
      expect(String(row?.blocker_summary)).toContain(expectedSubstring)
    }

    // Verify all >=70 child sessions in the manifested steward archive were evaluated
    expect(report.archiveChildrenEvaluatedCount).toBeGreaterThanOrEqual(70)
  })

  test("4. Shadow snapshot Git blob sinking extracts uncommitted SPEC.md drafts via git cat-file --batch", () => {
    // Verify WF-SUB-R02 1590b08d (23,314 bytes) and 5bc43988 (24,251 bytes) drafts of .planning/phases/production-release/SPEC.md
    const r02Snaps = db
      .query(`
        SELECT * FROM snapshot_artifact
        WHERE session_id = 'ses_ecbfc0f40ffenfykTrNGoMS6o1'
          AND path = '.planning/phases/production-release/SPEC.md'
          AND source_origin = 'wf_sub_r02_fixture'
        ORDER BY seq ASC
      `)
      .all() as Array<Record<string, unknown>>
    expect(r02Snaps.length).toBe(2)

    expect(r02Snaps[0]?.start_tree_sha).toBe("8900ab62")
    expect(r02Snaps[0]?.end_tree_sha).toBe("1590b08d")
    expect(r02Snaps[0]?.byte_len).toBe(23314)
    const shaDraft1 = String(r02Snaps[0]?.end_blob_sha)
    const blobPath1 = path.join(BLOB_DIR, `${shaDraft1}.txt`)
    expect(existsSync(blobPath1)).toBe(true)
    expect(statSync(blobPath1).size).toBe(23314)
    expect(sha256hex(readFileSync(blobPath1))).toBe(shaDraft1)

    expect(r02Snaps[1]?.start_tree_sha).toBe("1590b08d")
    expect(r02Snaps[1]?.end_tree_sha).toBe("5bc43988")
    expect(r02Snaps[1]?.start_byte_len).toBe(23314)
    expect(r02Snaps[1]?.end_byte_len).toBe(24251)
    expect(r02Snaps[1]?.byte_len).toBe(24251)
    const shaDraft2 = String(r02Snaps[1]?.end_blob_sha)
    const blobPath2 = path.join(BLOB_DIR, `${shaDraft2}.txt`)
    expect(existsSync(blobPath2)).toBe(true)
    expect(statSync(blobPath2).size).toBe(24251)
    expect(sha256hex(readFileSync(blobPath2))).toBe(shaDraft2)

    // Verify real shadow snapshot SPEC.md drafts from ses_eb23bfbf0ffesn5kT0yJI06h35
    const realSpecSnaps = db
      .query(`
        SELECT * FROM snapshot_artifact
        WHERE session_id = 'ses_eb23bfbf0ffesn5kT0yJI06h35'
          AND path LIKE '%SPEC.md'
          AND source_origin = 'host_db'
        ORDER BY seq ASC
      `)
      .all() as Array<Record<string, unknown>>
    expect(realSpecSnaps.length).toBe(10)
    for (const snap of realSpecSnaps) {
      const endSha = String(snap.end_blob_sha)
      const p = path.join(BLOB_DIR, `${endSha}.txt`)
      expect(existsSync(p)).toBe(true)
      expect(statSync(p).size).toBe(Number(snap.end_byte_len))
    }
  })

  test("5. External spill capture sinks full untruncated tool-output and shell files into blobs", () => {
    const spills = db
      .query("SELECT * FROM spill_artifact ORDER BY source_origin ASC, seq ASC")
      .all() as Array<Record<string, unknown>>
    expect(spills.length).toBeGreaterThanOrEqual(15)

    // Verify real tool-output spill in ses_ecbfc0f40ffenfykTrNGoMS6o1
    const p1ToolSpill = db
      .query(
        "SELECT * FROM spill_artifact WHERE session_id = 'ses_ecbfc0f40ffenfykTrNGoMS6o1' AND call_id = 'call_e3bLiXQB56Lxyr9odaZNMXyu'",
      )
      .get() as Record<string, unknown> | null
    expect(p1ToolSpill).not.toBeNull()
    expect(p1ToolSpill?.spill_kind).toBe("tool-output")
    expect(Number(p1ToolSpill?.inline_byte_len)).toBe(51295)
    expect(Number(p1ToolSpill?.full_byte_len)).toBe(59015)
    const toolBlobPath = path.join(BLOB_DIR, `${String(p1ToolSpill?.blob_sha)}.txt`)
    expect(existsSync(toolBlobPath)).toBe(true)
    expect(statSync(toolBlobPath).size).toBe(59015)

    // Verify real shell spill in ses_eb1d59ed6ffe4mPNVnyQJfovU7
    const realShellSpill = db
      .query(
        "SELECT * FROM spill_artifact WHERE session_id = 'ses_eb1d59ed6ffe4mPNVnyQJfovU7' AND call_id = 'chatcmpl-tool-9b34556554cc90bd'",
      )
      .get() as Record<string, unknown> | null
    expect(realShellSpill).not.toBeNull()
    expect(realShellSpill?.spill_kind).toBe("shell")
    expect(Number(realShellSpill?.full_byte_len)).toBe(181547)
    expect(Number(realShellSpill?.full_byte_len)).toBeGreaterThan(Number(realShellSpill?.inline_byte_len))

    // Verify fixture tool-output and shell spills
    const fixtureSpills = db
      .query("SELECT * FROM spill_artifact WHERE source_origin = 'wf_sub_r02_fixture' ORDER BY spill_kind ASC")
      .all() as Array<Record<string, unknown>>
    expect(fixtureSpills.length).toBe(2)
    expect(fixtureSpills.map((s) => s.spill_kind)).toEqual(["shell", "tool-output"])
  })

  test("6. Unit edge cases for classifyMessagesOutcome and segmentChildStops", () => {
    const emptyRes = classifyMessagesOutcome([], "succeeded")
    expect(emptyRes.reported_outcome).toBe("succeeded")
    expect(emptyRes.verified_outcome).toBe("empty_output")

    const stops = segmentChildStops(
      [
        {
          id: "m1",
          session_id: "s1",
          type: "user",
          seq: 1,
          time_created: 1,
          time_updated: 1,
          data: { text: "First prompt" },
        },
        {
          id: "m2",
          session_id: "s1",
          type: "assistant",
          seq: 2,
          time_created: 2,
          time_updated: 2,
          data: { content: [{ type: "text", text: "First answer" }] },
        },
        {
          id: "m3",
          session_id: "s1",
          type: "idle",
          seq: 3,
          time_created: 3,
          time_updated: 3,
          data: { outcome: "succeeded" },
        },
      ],
      "succeeded",
    )
    expect(stops.length).toBe(1)
    expect(stops[0]?.verified_outcome).toBe("reported_only")
  })
})
