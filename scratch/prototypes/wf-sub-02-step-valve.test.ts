import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { sha256hex } from "../../src/archive/normalize.ts"
import {
  BlobStore,
  SESSION_1_PATH,
  WorkingSetValve,
  cloneMessagesForHook,
  computeStepWatermark,
  formatFactBreadcrumb,
  runInterleavedContextHookBenchmark,
  runReplay1SessionBcad339b,
  runReplay2SessionA35adea6,
} from "./wf-sub-02-step-valve.ts"

describe("computeStepWatermark", () => {
  test("anchors K assistant steps back in step-window mode on single-user-prompt trajectories", () => {
    const messages = [
      { id: "u0", type: "user", content: [{ type: "text", text: "go" }] },
      { id: "a1", type: "assistant", content: [] },
      { id: "a2", type: "assistant", content: [] },
      { id: "a3", type: "assistant", content: [] },
      { id: "a4", type: "assistant", content: [] },
      { id: "a5", type: "assistant", content: [] },
    ]
    const w = computeStepWatermark(messages, { mode: "step-window", keepRecentSteps: 2 })
    expect(w.anchorIndex).toBe(4)
    expect(w.anchorMessageID).toBe("a4")
    expect(w.anchorReason).toBe("step-window")
    expect(w.assistantStepsTotal).toBe(5)
    expect(w.assistantStepsKept).toBe(2)
    expect(w.assistantStepsThinned).toBe(3)
  })

  test("falls back to step-window watermark in recent mode when only msg[0] is user and assistantSteps > K", () => {
    const messages = [
      { id: "u0", type: "user", content: [{ type: "text", text: "orchestrate" }] },
      { id: "a1", type: "assistant", content: [] },
      { id: "a2", type: "assistant", content: [] },
      { id: "a3", type: "assistant", content: [] },
      { id: "a4", type: "assistant", content: [] },
    ]
    const w = computeStepWatermark(messages, { mode: "recent", keepRecentSteps: 2 })
    expect(w.anchorIndex).toBe(3)
    expect(w.anchorMessageID).toBe("a3")
    expect(w.anchorReason).toBe("recent-step-fallback")
    expect(w.assistantStepsThinned).toBe(2)
    expect(w.assistantStepsKept).toBe(2)
  })

  test("anchors at last user prompt after compaction boundary in recent mode when multi-turn prompts exist", () => {
    const messages = [
      { id: "u0", type: "user", content: [] },
      { id: "a1", type: "assistant", content: [] },
      { id: "c1", type: "compaction", content: [{ type: "compaction" }] },
      { id: "u1", type: "user", content: [] },
      { id: "a2", type: "assistant", content: [] },
      { id: "a3", type: "assistant", content: [] },
      { id: "u2", type: "user", content: [] },
      { id: "a4", type: "assistant", content: [] },
    ]
    const w = computeStepWatermark(messages, { mode: "recent", keepRecentSteps: 6 })
    expect(w.lastCompactionIndex).toBe(2)
    expect(w.activeStartIndex).toBe(3)
    expect(w.lastUserIndex).toBe(6)
    expect(w.anchorIndex).toBe(6)
    expect(w.anchorMessageID).toBe("u2")
    expect(w.anchorReason).toBe("recent-user-prompt")
    expect(w.assistantStepsThinned).toBe(2)
    expect(w.assistantStepsKept).toBe(1)
  })
})

describe("FactBreadcrumb formatting and staleness invalidation", () => {
  test("formats read, skill, and shell FactBreadcrumbs with SHA-256 blob handles", () => {
    const sha = sha256hex("hello world")
    const readBc = formatFactBreadcrumb({
      callId: "call_1",
      messageId: "msg_1",
      tool: "read",
      target: "src/plugin.ts",
      lineRange: "L1-L50",
      originalChars: 1420,
      blobSha256: sha,
      summary: "exports: createPlugin, setup",
      status: "FRESH — DO NOT REREAD",
    })
    expect(readBc.blobRef).toBe(`blob:${sha.slice(0, 12)}`)
    expect(readBc.rendered).toBe(
      `[Pruned read src/plugin.ts#L1-L50 (1420 chars) -> blob:${sha.slice(0, 12)} | exports: createPlugin, setup | status: FRESH — DO NOT REREAD — call substrate.resolve("blob:${sha.slice(0, 12)}") if exact lines needed]`,
    )

    const skillBc = formatFactBreadcrumb({
      callId: "call_2",
      messageId: "msg_1",
      tool: "skill",
      target: "ultra-mode",
      lineRange: null,
      originalChars: 24526,
      blobSha256: sha,
      summary: "Loaded ultra-mode",
      status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
    })
    expect(skillBc.rendered).toBe(
      `[Pruned skill ultra-mode (24526 chars) -> blob:${sha.slice(0, 12)} | Rules active in WorkingMemoryManifest — DO NOT REREAD skill]`,
    )
  })

  test("flips manifest and breadcrumb status to STALE when diskHashesByPath diverges from blobSha256", () => {
    const rawContent = "Read file STATE.md, lines 1-10:\n1: # State\n2: Phase 1"
    const valve = new WorkingSetValve({
      persistBlobsToDisk: false,
      diskHashesByPath: new Map([["STATE.md", "0".repeat(64)]]),
    })
    const messages = [
      { id: "u0", type: "user", content: [{ type: "text", text: "start" }] },
      {
        id: "a1",
        type: "assistant",
        content: [
          {
            type: "tool",
            id: "call_read_state",
            name: "read",
            state: {
              status: "completed",
              input: { path: "STATE.md" },
              content: [{ type: "text", text: rawContent }],
            },
          },
        ],
      },
      { id: "a2", type: "assistant", content: [{ type: "text", text: "step 2" }] },
      { id: "a3", type: "assistant", content: [{ type: "text", text: "step 3" }] },
    ]
    const ledger = valve.armValve({
      sessionID: "ses_stale_test",
      mode: "step-window",
      keepRecentSteps: 1,
      messages,
    })

    const fileEntry = ledger.manifest.filesRead.find((f) => f.normalizedPath === "STATE.md")
    expect(fileEntry?.status).toBe("STALE")
    const bc = ledger.breadcrumbsByCallId.get("call_read_state")
    expect(bc?.status).toBe("STALE")
    expect(bc?.rendered).toContain("status: STALE")
    expect(valve.resolve(bc!.blobRef)).toBe(rawContent)
  })
})

describe("BlobStore content-addressed storage and resolution", () => {
  test("sinks, deduplicates, and resolves blobs by 12-char prefix", () => {
    const store = new BlobStore({ persistToDisk: true })
    const sample = "Sample tool output for WF-SUB-02 blob resolution verification"
    const first = store.sink(sample)
    const second = store.sink(sample)
    expect(first.sha256).toBe(second.sha256)
    expect(first.blobRef).toBe(`blob:${first.sha256.slice(0, 12)}`)
    expect(store.resolve(first.blobRef)).toBe(sample)
    expect(store.resolve(first.sha256)).toBe(sample)
  })
})

describe("Replay 1: session-bcad339b at msg[45] (intra-turn step-watermark pruning)", () => {
  test("legacy recent mode is a total no-op while WorkingSetValve thins 33/35 assistant steps and prevents msg[51] compaction", () => {
    const r1 = runReplay1SessionBcad339b({ persistBlobsToDisk: true })

    expect(r1.legacy.anchorMessageID).toBe("msg_14d1544ee001vCXg3fPMactf6P")
    expect(r1.legacy.toolPartsThinned).toBe(0)
    expect(r1.legacy.rawCharsFreed).toBe(0)
    expect(r1.legacy.rawTokensFreed).toBe(0)

    expect(r1.msg45InputTokensActual).toBe(257_434)
    expect(r1.msg51CompactionThresholdTokens).toBe(274_175)

    expect(r1.stepWindowK8.watermark.anchorIndex).toBe(38)
    expect(r1.stepWindowK8.watermark.anchorMessageID).toBe("msg_14d1f8ddb001n1hz8EkB4rh5yB")
    expect(r1.stepWindowK8.watermark.assistantStepsTotal).toBe(41)
    expect(r1.stepWindowK8.watermark.assistantStepsKept).toBe(8)
    expect(r1.stepWindowK8.watermark.assistantStepsThinned).toBe(33)

    expect(r1.stepWindowK8.metrics.toolPartsThinned).toBe(128)
    expect(r1.stepWindowK8.metrics.rawOutputCharsBefore).toBe(625_510)
    expect(r1.stepWindowK8.metrics.breadcrumbCharsAfter).toBe(28_692)
    expect(r1.stepWindowK8.metrics.netTokensFreed).toBe(154_900)
    expect(r1.stepWindowK8.projectedMsg45Tokens).toBe(102_534)
    expect(r1.stepWindowK8.projectedMsg51Tokens).toBe(119_275)

    expect(r1.recentWithStepFallbackK8.watermark.anchorReason).toBe("recent-step-fallback")
    expect(r1.recentWithStepFallbackK8.watermark.anchorMessageID).toBe("msg_14d1f8ddb001n1hz8EkB4rh5yB")
    expect(r1.recentWithStepFallbackK8.metrics.toolPartsThinned).toBe(128)

    expect(r1.stepWindowK6.watermark.anchorIndex).toBe(40)
    expect(r1.stepWindowK6.watermark.anchorMessageID).toBe("msg_14d216ebc001ODNchhDK8mDyPa")
    expect(r1.stepWindowK6.watermark.assistantStepsKept).toBe(6)
    expect(r1.stepWindowK6.watermark.assistantStepsThinned).toBe(35)
    expect(r1.stepWindowK6.metrics.toolPartsThinned).toBe(130)
    expect(r1.stepWindowK6.metrics.netTokensFreed).toBe(160_664)
    expect(r1.stepWindowK6.projectedMsg51Tokens).toBe(113_511)

    const s1Raw = JSON.parse(readFileSync(SESSION_1_PATH, "utf8"))
    const hookPayload = {
      sessionID: r1.sessionID,
      messages: cloneMessagesForHook(s1Raw.messages.slice(0, 46)),
      system: ["existing-system-prompt"],
    }
    const applied = r1.valveK8.applyContextHookInMemory(hookPayload)
    expect(applied.applied).toBe(true)
    expect(applied.anchorIndex).toBe(38)
    expect(applied.thinnedParts).toBe(127)
    expect(hookPayload.system[0]).toContain("WorkingMemoryManifest")
    expect(hookPayload.system[1]).toBe("existing-system-prompt")

    for (let i = 38; i < 46; i++) {
      for (const p of hookPayload.messages[i]?.content ?? []) {
        if (p?.type === "tool" && p.state?.status === "completed") {
          const text = p.state.content?.[0]?.text ?? ""
          expect(text.startsWith("[Pruned ")).toBe(false)
        }
      }
    }
  })
})

describe("Replay 2: session-a35adea6 at msg[123] (eliminating msg[125..130] re-read storm)", () => {
  test("indexes all 14 re-read file slices and all 7 re-invoked skills in WorkingMemoryManifest with resolvable SHA-256 blobs", () => {
    const r2 = runReplay2SessionA35adea6({ persistBlobsToDisk: true })

    expect(r2.watermark.lastCompactionIndex).toBe(82)
    expect(r2.watermark.activeStartIndex).toBe(83)
    expect(r2.watermark.anchorIndex).toBe(120)
    expect(r2.watermark.anchorMessageID).toBe("msg_14e0353fc001E7Xl9Swjjcoryv")
    expect(r2.metrics.toolPartsThinned).toBe(53)
    expect(r2.metrics.rawOutputCharsBefore).toBe(311_570)
    expect(r2.metrics.breadcrumbCharsAfter).toBe(12_177)

    expect(r2.rereadFilesVerification.length).toBe(14)
    expect(r2.allFilesVerified).toBe(true)
    for (const fileCheck of r2.rereadFilesVerification) {
      expect(fileCheck.inManifest).toBe(true)
      expect(fileCheck.status).toBe("FRESH — DO NOT REREAD")
      expect(fileCheck.blobRef).toMatch(/^blob:[0-9a-f]{12}$/)
      expect(fileCheck.resolvedChars).toBeGreaterThan(0)
    }

    expect(r2.rereadSkillsVerification.length).toBe(7)
    expect(r2.allSkillsVerified).toBe(true)
    for (const skillCheck of r2.rereadSkillsVerification) {
      expect(skillCheck.inManifest).toBe(true)
      expect(skillCheck.status).toBe("ACTIVE — DO NOT RE-INVOKE")
      expect(skillCheck.blobRef).toMatch(/^blob:[0-9a-f]{12}$/)
      expect(skillCheck.resolvedChars).toBeGreaterThan(0)
    }
  })
})

describe("Critical-path context hook benchmark (< 2 ms budget)", () => {
  test("executes 7-sample interleaved benchmark over 87-msg S1 and 138-msg S2 well under 2.0 ms", () => {
    const report = runInterleavedContextHookBenchmark(7)
    expect(report.samples).toBe(7)
    expect(report.s1Full87Messages.thinnedPartsPerRun).toBeGreaterThan(0)
    expect(report.s2Full138Messages.thinnedPartsPerRun).toBeGreaterThan(0)
    expect(report.s1Full87Messages.medianMs).toBeLessThan(2.0)
    expect(report.s2Full138Messages.medianMs).toBeLessThan(2.0)
  })
})
