import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sha256hex } from "../src/archive/normalize.ts"
import {
  BlobStore,
  DEFAULT_AUTO_KEEP_RECENT_STEPS,
  DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO,
  DEFAULT_KEEP_RECENT_STEPS,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  KEEP_INPUT,
  KEEP_RESULT,
  WorkingSetValve,
  applyContextHookInMemory,
  cloneMessagesForHook,
  computeStepWatermark,
  formatFactBreadcrumb,
  thinInput,
} from "../src/archive/valve.ts"

describe("TWM-05: computeStepWatermark (REQ-SUB-07)", () => {
  test("anchors K assistant steps back in step-window mode on single-user-prompt trajectories (default K=8)", () => {
    const messages: Record<string, any>[] = [
      { id: "u0", type: "user", content: [{ type: "text", text: "run autonomous task" }] },
    ]
    for (let i = 1; i <= 12; i++) {
      messages.push({ id: `a${i}`, type: "assistant", content: [{ type: "text", text: `step ${i}` }] })
    }

    const wDefault = computeStepWatermark(messages, { mode: "step-window" })
    expect(wDefault.keepRecentSteps).toBe(DEFAULT_KEEP_RECENT_STEPS)
    expect(wDefault.keepRecentSteps).toBe(8)
    expect(wDefault.anchorIndex).toBe(5)
    expect(wDefault.anchorMessageID).toBe("a5")
    expect(wDefault.anchorReason).toBe("step-window")
    expect(wDefault.assistantStepsTotal).toBe(12)
    expect(wDefault.assistantStepsKept).toBe(8)
    expect(wDefault.assistantStepsThinned).toBe(4)

    const wCustom = computeStepWatermark(messages.slice(0, 6), { mode: "step-window", keepRecentSteps: 2 })
    expect(wCustom.anchorIndex).toBe(4)
    expect(wCustom.anchorMessageID).toBe("a4")
    expect(wCustom.anchorReason).toBe("step-window")
    expect(wCustom.assistantStepsTotal).toBe(5)
    expect(wCustom.assistantStepsKept).toBe(2)
    expect(wCustom.assistantStepsThinned).toBe(3)
  })

  test("falls back to step-window watermark in recent mode when lastUserIndex <= activeStartIndex and assistantStepsAfterLastUser > K", () => {
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

  test("supports both initial and all modes as synonyms", () => {
    const multiTurn = [
      { id: "u0", type: "user", content: [{ type: "text", text: "first" }] },
      { id: "a1", type: "assistant", content: [] },
      { id: "a2", type: "assistant", content: [] },
      { id: "u1", type: "user", content: [{ type: "text", text: "second" }] },
      { id: "a3", type: "assistant", content: [] },
    ]
    const wInitial = computeStepWatermark(multiTurn, { mode: "initial", keepRecentSteps: 2 })
    const wAll = computeStepWatermark(multiTurn, { mode: "all", keepRecentSteps: 2 })

    expect(wInitial.anchorIndex).toBe(3)
    expect(wInitial.anchorMessageID).toBe("u1")
    expect(wInitial.anchorReason).toBe("initial-history")

    expect(wAll.anchorIndex).toBe(3)
    expect(wAll.anchorMessageID).toBe("u1")
    expect(wAll.anchorReason).toBe("initial-history")

    const singlePrompt = [
      { id: "u0", type: "user", content: [{ type: "text", text: "only prompt" }] },
      { id: "a1", type: "assistant", content: [] },
      { id: "a2", type: "assistant", content: [] },
      { id: "a3", type: "assistant", content: [] },
      { id: "a4", type: "assistant", content: [] },
    ]
    const wSingleAll = computeStepWatermark(singlePrompt, { mode: "all", keepRecentSteps: 2 })
    expect(wSingleAll.anchorIndex).toBe(3)
    expect(wSingleAll.anchorMessageID).toBe("a3")
    expect(wSingleAll.anchorReason).toBe("initial-history")
  })

  test("activates automatic 65% context window watermark with keepRecentSteps = 12 when estimated tokens exceed threshold", () => {
    expect(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS).toBe(200_000)
    expect(DEFAULT_AUTO_PRUNE_THRESHOLD_RATIO).toBe(0.65)
    expect(DEFAULT_AUTO_KEEP_RECENT_STEPS).toBe(12)

    const messages: Record<string, any>[] = [
      { id: "u0", type: "user", content: [{ type: "text", text: "autonomous run" }] },
    ]
    for (let i = 1; i <= 16; i++) {
      messages.push({
        id: `a${i}`,
        type: "assistant",
        content: [{ type: "text", text: "x".repeat(4000) }],
      })
    }

    const wOver = computeStepWatermark(messages, {
      mode: "auto",
      modelContextWindowTokens: 20_000,
      autoPruneThresholdRatio: 0.65,
    })
    expect(wOver.autoActivated).toBe(true)
    expect(wOver.keepRecentSteps).toBe(12)
    expect(wOver.anchorReason).toBe("auto-threshold-step-window")
    expect(wOver.assistantStepsTotal).toBe(16)
    expect(wOver.assistantStepsKept).toBe(12)
    expect(wOver.assistantStepsThinned).toBe(4)
    expect(wOver.anchorIndex).toBe(5)
    expect(wOver.anchorMessageID).toBe("a5")

    const wUnder = computeStepWatermark(messages, {
      mode: "auto",
      modelContextWindowTokens: 200_000,
      autoPruneThresholdRatio: 0.65,
    })
    expect(wUnder.autoActivated).toBe(false)
    expect(wUnder.anchorReason).toBe("no-op")
    expect(wUnder.anchorIndex).toBe(0)
    expect(wUnder.assistantStepsThinned).toBe(0)
  })
})

describe("TWM-05: FactBreadcrumb, WorkingMemoryManifest & BlobStore (REQ-SUB-08)", () => {
  test("formats deterministic FactBreadcrumbs with blob:<sha12>, summary, status, and substrate.viewport resolve call", () => {
    const sha = sha256hex("export const x = 42\n")
    const shortSha = sha.slice(0, 12)

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
    expect(readBc.blobRef).toBe(`blob:${shortSha}`)
    expect(readBc.rendered).toBe(
      `[Pruned read src/plugin.ts#L1-L50 (1420 chars) -> blob:${shortSha} | exports: createPlugin, setup | status: FRESH — DO NOT REREAD; call substrate.viewport({ action: "resolve", blob: "${shortSha}" }) if exact lines needed]`,
    )

    const staleBc = formatFactBreadcrumb({
      callId: "call_2",
      messageId: "msg_2",
      tool: "read",
      target: "src/archive/valve.ts",
      lineRange: "L1-L80",
      originalChars: 2400,
      blobSha256: sha,
      summary: "exports: WorkingSetValve",
      status: "STALE (modified since read/review — re-verify slice)",
    })
    expect(staleBc.rendered).toBe(
      `[Pruned read src/archive/valve.ts#L1-L80 (2400 chars) -> blob:${shortSha} | exports: WorkingSetValve | status: STALE (modified since read/review — re-verify slice); call substrate.viewport({ action: "resolve", blob: "${shortSha}" }) if exact lines needed]`,
    )

    const skillBc = formatFactBreadcrumb({
      callId: "call_3",
      messageId: "msg_3",
      tool: "skill",
      target: "ultra-mode",
      lineRange: null,
      originalChars: 24526,
      blobSha256: sha,
      summary: "Loaded ultra-mode",
      status: "ACTIVE IN MANIFEST — DO NOT RE-INVOKE",
    })
    expect(skillBc.rendered).toBe(
      `[Pruned skill ultra-mode (24526 chars) -> blob:${shortSha} | Loaded ultra-mode | status: ACTIVE IN MANIFEST — DO NOT RE-INVOKE; call substrate.viewport({ action: "resolve", blob: "${shortSha}" }) if exact lines needed]`,
    )
  })

  test("sinks blobs to .session-archive/blobs/<sha256>.txt and resolves by 12-char prefix or line range", () => {
    const tmp = mkdtempSync(join(tmpdir(), "twm05-blobs-"))
    try {
      const blobDir = join(tmp, ".session-archive", "blobs")
      const store = new BlobStore({ blobDir, persistToDisk: true })
      const content = ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n")
      const first = store.sink(content)
      const second = store.sink(content)

      expect(first.sha256).toBe(second.sha256)
      expect(first.blobRef).toBe(`blob:${first.sha256.slice(0, 12)}`)
      expect(store.resolve(first.blobRef)).toBe(content)
      expect(store.resolve(first.sha256.slice(0, 12))).toBe(content)
      expect(store.stats()).toEqual({ written: 1, reused: 1 })

      const valve = new WorkingSetValve({ blobDir, persistBlobsToDisk: true })
      valve.blobStore.sink(content)
      const resolvedSlice = valve.resolveBlob(first.sha256.slice(0, 12), { startLine: 2, endLine: 4 })
      expect(resolvedSlice).not.toBeNull()
      expect(resolvedSlice?.slice).toBe("line 2\nline 3\nline 4")
      expect(resolvedSlice?.totalLines).toBe(5)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test("preserves KEEP_RESULT outputs and KEEP_INPUT inputs while thinning other old tool inputs/outputs", () => {
    expect(KEEP_RESULT.has("subagent")).toBe(true)
    expect(KEEP_RESULT.has("task")).toBe(true)
    expect(KEEP_RESULT.has("delegate-devin")).toBe(true)
    expect(KEEP_RESULT.has("hivemind-delegate")).toBe(true)
    expect(KEEP_INPUT.has("read")).toBe(true)
    expect(KEEP_INPUT.has("write")).toBe(true)
    expect(KEEP_INPUT.has("edit")).toBe(true)

    const longCommand = `git log --oneline ${"x".repeat(400)}`
    const thinned = thinInput({ command: longCommand, timeout: 30 }) as Record<string, any>
    expect(thinned.timeout).toBe(30)
    expect(thinned.command.length).toBeLessThan(longCommand.length)
    expect(thinned.command).toContain("[context-prune:")
    expect(JSON.stringify(thinned)).not.toContain("__thinned")

    const valve = new WorkingSetValve({ persistBlobsToDisk: false })
    const longEditString = "const a = 1;\n".repeat(100)
    const messages = [
      { id: "u0", type: "user", content: [{ type: "text", text: "build feature" }] },
      {
        id: "a1",
        type: "assistant",
        content: [
          {
            type: "tool",
            id: "call_bash",
            name: "bash",
            state: {
              status: "completed",
              input: { command: longCommand, timeout: 30 },
              content: [{ type: "text", text: "bash output line 1\nbash output line 2\n" + "y".repeat(2000) }],
            },
          },
          {
            type: "tool",
            id: "call_delegate",
            name: "hivemind-delegate",
            state: {
              status: "completed",
              input: { agent: "implementer", prompt: "z".repeat(500) },
              content: [{ type: "text", text: "DELEGATE_VERBATIM_REPORT" }],
            },
          },
          {
            type: "tool",
            id: "call_edit",
            name: "edit",
            state: {
              status: "completed",
              input: { path: "src/plugin.ts", oldString: longEditString, newString: longEditString },
              content: [{ type: "text", text: "File edited successfully" }],
            },
          },
        ],
      },
      { id: "a2", type: "assistant", content: [{ type: "text", text: "recent step" }] },
    ]

    valve.armValve({
      sessionID: "ses_keep_test",
      mode: "step-window",
      keepRecentSteps: 1,
      messages,
    })

    const hookEvent = {
      sessionID: "ses_keep_test",
      messages: cloneMessagesForHook(messages),
      system: ["base-system"],
    }
    const res = valve.applyContextHookInMemory(hookEvent)
    expect(res.applied).toBe(true)

    const a1Parts = hookEvent.messages[1]!.content
    expect(a1Parts[0].state.input.command).toContain("[context-prune:")
    expect(a1Parts[0].state.input.timeout).toBe(30)
    expect(a1Parts[0].state.content[0].text).toContain("[Pruned bash")
    expect(a1Parts[0].state.content[0].text).toContain('call substrate.viewport({ action: "resolve", blob: "')

    expect(a1Parts[1].state.content[0].text).toBe("DELEGATE_VERBATIM_REPORT")
    expect(a1Parts[1].state.input.prompt).toContain("[context-prune:")

    expect(a1Parts[2].state.input.oldString).toBe(longEditString)
    expect(a1Parts[2].state.content[0].text).toContain("[Pruned edit src/plugin.ts")
  })

  test("synthesizes WorkingMemoryManifest and invalidates to STALE when diskHashesByPath diverges or file is later edited", () => {
    const rawStateContent = "Read file STATE.md, lines 1-10:\n1: # State\n2: Phase 1"
    const rawSpecContent = "Read file SPEC.md, lines 1-20:\n1: # Spec\n2: Requirements"
    const specSha = sha256hex(rawSpecContent)

    const valve = new WorkingSetValve({
      persistBlobsToDisk: false,
      diskHashesByPath: new Map([
        ["STATE.md", "0".repeat(64)],
        ["SPEC.md", specSha],
      ]),
    })

    const messages = [
      {
        id: "u0",
        type: "user",
        skills: [{ name: "ultra-mode", text: "# Ultra mode\n Concise responses." }],
        content: [{ type: "text", text: 'start <skill_content name="tdd"># TDD\nRed green refactor</skill_content>' }],
      },
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
              content: [{ type: "text", text: rawStateContent }],
            },
          },
          {
            type: "tool",
            id: "call_read_spec",
            name: "read",
            state: {
              status: "completed",
              input: { path: "SPEC.md" },
              content: [{ type: "text", text: rawSpecContent }],
            },
          },
        ],
      },
      { id: "a2", type: "assistant", content: [{ type: "text", text: "step 2" }] },
    ]

    const pruned = valve.prune({
      sessionID: "ses_manifest_test",
      mode: "step-window",
      keepRecentSteps: 1,
      messages,
    })

    const ledger = pruned.ledger
    const stateEntry = ledger.manifest.filesRead.find((f) => f.normalizedPath === "STATE.md")
    const specEntry = ledger.manifest.filesRead.find((f) => f.normalizedPath === "SPEC.md")

    expect(stateEntry?.status).toBe("STALE (modified since read/review — re-verify slice)")
    expect(specEntry?.status).toBe("FRESH — DO NOT REREAD")

    const stateBc = ledger.breadcrumbsByCallId.get("call_read_state")
    const specBc = ledger.breadcrumbsByCallId.get("call_read_spec")
    expect(stateBc?.status).toBe("STALE (modified since read/review — re-verify slice)")
    expect(stateBc?.rendered).toContain("status: STALE (modified since read/review — re-verify slice)")
    expect(specBc?.status).toBe("FRESH — DO NOT REREAD")

    expect(ledger.manifest.activeSkills.map((s) => s.name)).toEqual(["ultra-mode", "tdd"])
    for (const skill of ledger.manifest.activeSkills) {
      expect(skill.status).toBe("ACTIVE — DO NOT RE-INVOKE")
    }
    expect(ledger.manifest.renderedMarkdown).toContain("### Files Already Read (2)")
    expect(ledger.manifest.renderedMarkdown).toContain("### Active Skills Loaded (2 — DO NOT RE-INVOKE)")
    expect(ledger.manifest.renderedMarkdown).toContain("STALE (modified since read/review — re-verify slice)")
    expect(ledger.manifest.renderedMarkdown).toContain("FRESH — DO NOT REREAD")

    const statusRes = valve.status("ses_manifest_test")
    expect(statusRes.armed).toBe(true)
    expect(statusRes.summaryMarkdown).toContain("ses_manifest_test")

    const resetRes = valve.reset("ses_manifest_test")
    expect(resetRes.reset).toBe(true)
    expect(valve.status("ses_manifest_test").armed).toBe(false)

    const inSessionValve = new WorkingSetValve({ persistBlobsToDisk: false })
    const editMessages = [
      { id: "u0", type: "user", content: [{ type: "text", text: "go" }] },
      {
        id: "a1",
        type: "assistant",
        content: [
          {
            type: "tool",
            id: "call_read_foo",
            name: "read",
            state: {
              status: "completed",
              input: { path: "src/foo.ts" },
              content: [{ type: "text", text: "export const foo = 1\n" }],
            },
          },
        ],
      },
      {
        id: "a2",
        type: "assistant",
        content: [
          {
            type: "tool",
            id: "call_edit_foo",
            name: "edit",
            state: {
              status: "completed",
              input: { path: "src/foo.ts", oldString: "export const foo = 1\n", newString: "export const foo = 2\n" },
              content: [{ type: "text", text: "Updated src/foo.ts" }],
            },
          },
        ],
      },
      { id: "a3", type: "assistant", content: [{ type: "text", text: "done" }] },
    ]
    const editLedger = inSessionValve.armValve({
      sessionID: "ses_in_session_stale",
      mode: "step-window",
      keepRecentSteps: 1,
      messages: editMessages,
    })
    const fooEntry = editLedger.manifest.filesRead.find((f) => f.normalizedPath === "src/foo.ts")
    expect(fooEntry?.status).toBe("STALE (modified since read/review — re-verify slice)")
    expect(editLedger.breadcrumbsByCallId.get("call_read_foo")?.status).toBe(
      "STALE (modified since read/review — re-verify slice)",
    )
    expect(editLedger.manifest.filesModified).toHaveLength(1)
    expect(editLedger.manifest.filesModified[0]?.normalizedPath).toBe("src/foo.ts")
  })
})

describe("TWM-05: applyContextHookInMemory automatic activation & < 2.0 ms latency (REQ-SUB-07, REQ-SUB-08)", () => {
  test("automatically activates step-window (K=12) inside applyContextHookInMemory when active tokens exceed 65% of window", () => {
    const valve = new WorkingSetValve({
      persistBlobsToDisk: false,
      modelContextWindowTokens: 10_000,
      autoPruneThresholdRatio: 0.65,
      autoKeepRecentSteps: 12,
    })

    const messages: Record<string, any>[] = [
      { id: "u0", type: "user", content: [{ type: "text", text: "single prompt run" }] },
    ]
    for (let i = 1; i <= 15; i++) {
      messages.push({
        id: `a${i}`,
        type: "assistant",
        content: [
          {
            type: "tool",
            id: `call_${i}`,
            name: "read",
            state: {
              status: "completed",
              input: { path: `src/file_${i}.ts` },
              content: [{ type: "text", text: `export const v${i} = "${"a".repeat(2500)}"\n` }],
            },
          },
        ],
      })
    }

    const event = {
      sessionID: "ses_auto_hook",
      messages: cloneMessagesForHook(messages),
      system: ["initial-system"],
    }

    const res = applyContextHookInMemory(event, valve)
    expect(res.applied).toBe(true)
    expect(res.trigger).toBe("auto-watermark-65pct")
    expect(res.watermark?.keepRecentSteps).toBe(12)
    expect(res.watermark?.assistantStepsThinned).toBe(3)
    expect(res.watermark?.assistantStepsKept).toBe(12)
    expect(res.thinnedParts).toBe(3)
    expect(event.system[0]).toContain("WorkingMemoryManifest")

    for (let i = 1; i <= 3; i++) {
      const text = event.messages[i]!.content[0].state.content[0].text
      expect(text).toContain(`[Pruned read src/file_${i}.ts`)
      expect(text).toContain('call substrate.viewport({ action: "resolve", blob: "')
    }
    for (let i = 4; i <= 15; i++) {
      const text = event.messages[i]!.content[0].state.content[0].text
      expect(text.startsWith("[Pruned ")).toBe(false)
    }
  })

  test("executes 7-sample median latency < 2.0 ms on 90-message trajectory with zero disk I/O", () => {
    const messages: Record<string, any>[] = [
      {
        id: "u0",
        type: "user",
        content: [{ type: "text", text: 'run <skill_content name="ultra-mode">SKILL_BODY</skill_content>' }],
      },
    ]
    for (let i = 1; i <= 89; i++) {
      messages.push({
        id: `a${i}`,
        type: "assistant",
        content: [
          {
            type: "tool",
            id: `call_read_${i}`,
            name: "read",
            state: {
              status: "completed",
              input: { path: `src/mod_${i % 15}.ts`, offset: 1, limit: 100 },
              content: [{ type: "text", text: `export function fn${i}() {\n  return "${"x".repeat(1200)}"\n}\n` }],
            },
          },
          {
            type: "tool",
            id: `call_bash_${i}`,
            name: "bash",
            state: {
              status: "completed",
              input: { command: `bun test test/mod_${i}.test.ts ${"flag ".repeat(70)}` },
              content: [{ type: "text", text: `1 pass, 0 fail\n${"log ".repeat(300)}` }],
            },
          },
        ],
      })
    }

    const valve = new WorkingSetValve({ persistBlobsToDisk: false, keepRecentSteps: 8 })
    valve.armValve({
      sessionID: "ses_bench_90",
      mode: "step-window",
      keepRecentSteps: 8,
      messages,
    })

    valve.applyContextHookInMemory({
      sessionID: "ses_bench_90",
      messages: cloneMessagesForHook(messages),
      system: [],
    })

    const samples: number[] = []
    for (let s = 0; s < 7; s++) {
      const cloned = cloneMessagesForHook(messages)
      const system: string[] = ["system-prompt"]
      const t0 = performance.now()
      const res = valve.applyContextHookInMemory({
        sessionID: "ses_bench_90",
        messages: cloned,
        system,
      })
      const t1 = performance.now()
      expect(res.applied).toBe(true)
      expect(res.thinnedParts).toBe(162)
      expect(system[0]).toContain("WorkingMemoryManifest")
      samples.push(t1 - t0)
    }

    samples.sort((a, b) => a - b)
    const medianMs = samples[Math.floor(samples.length / 2)]!
    expect(medianMs).toBeLessThan(2.0)
  })

  test("TWM-R2 D2 / P-3 / P-8: recordReadFromHook updates in-memory ledger on truncated & full reads and WorkingMemoryManifest renders 3-state FRESH / SLICE / STALE", () => {
    const valve = new WorkingSetValve({ persistBlobsToDisk: false })

    // 1. Truncated slice read (lines 1-2 of 10)
    const sliceEntry = valve.recordReadFromHook({
      sessionID: "ses_hook_test",
      callId: "call_read_slice",
      path: "src/engine.ts",
      outputText:
        "Read file src/engine.ts, lines 1-2\n1: export const X = 1\n2: export const Y = 2\n[Output truncated. Continue reading with offset: 3]",
      input: { filePath: "src/engine.ts", offset: 1, limit: 2 },
    })
    expect(sliceEntry).not.toBeNull()
    expect(sliceEntry.isTruncated).toBe(true)
    expect(sliceEntry.startLine).toBe(1)
    expect(sliceEntry.endLine).toBe(2)
    expect(sliceEntry.status).toBe("SLICE L1-L2 — FRESH SLICE")

    // 2. Full file read
    const fullEntry = valve.recordReadFromHook({
      sessionID: "ses_hook_test",
      callId: "call_read_full",
      path: "src/utils.ts",
      outputText: "Read file src/utils.ts, lines 1-1\n1: export const U = 42\n",
      input: { filePath: "src/utils.ts" },
    })
    expect(fullEntry).not.toBeNull()
    expect(fullEntry.isTruncated).toBe(false)
    expect(fullEntry.status).toBe("FRESH — DO NOT REREAD")

    const statusView = valve.status("ses_hook_test")
    expect(statusView.manifestMarkdown).toContain("src/engine.ts")
    expect(statusView.manifestMarkdown).toContain("SLICE L1-L2 — FRESH SLICE")
    expect(statusView.manifestMarkdown).toContain("Do NOT re-read L1-L2; read offset=3")
    expect(statusView.manifestMarkdown).toContain("src/utils.ts")
    expect(statusView.manifestMarkdown).toContain("FRESH — DO NOT REREAD")
    expect(statusView.manifestMarkdown).not.toContain("#all")
  })

  test("TWM-R4 (A1, S1-2, S3-3, S3-4, E-6): recordToolExecuteAfter updates armed ledger on write/edit, syncFromSqlite reconciles SQLite ledgers, eliminates #all, and renderCompactValveStatus stays < 250 tokens on 25-file session", async () => {
    const { writeFileSync } = await import("node:fs")
    const { Database } = await import("bun:sqlite")
    const { DDL } = await import("../src/archive/index-db.ts")
    const valveMod = (await import("../src/archive/valve.ts")) as Record<string, unknown>
    const renderCompactValveStatus = valveMod.renderCompactValveStatus as (
      statusResult: unknown,
      pruneResult?: unknown,
    ) => string
    const estimateTokens = valveMod.estimateTokens as (text: string) => number

    expect(typeof renderCompactValveStatus).toBe("function")

    const tmp = mkdtempSync(join(tmpdir(), "twm-r4-valve-"))
    try {
      const targetFile = join(tmp, "src_target.ts")
      writeFileSync(targetFile, "export const A = 1\nexport const B = 2\n", "utf8")

      const valve = new WorkingSetValve({ persistBlobsToDisk: false, canonicalRoot: tmp })

      // 1. Arm the valve with an initial read of src_target.ts (2 lines)
      const messages = [
        { id: "u0", type: "user", content: [{ type: "text", text: "edit src_target.ts" }] },
        {
          id: "a1",
          type: "assistant",
          content: [
            {
              type: "tool",
              id: "call_r1",
              name: "read",
              state: {
                status: "completed",
                input: { path: "src_target.ts" },
                content: [
                  {
                    type: "text",
                    text: "Read file src_target.ts, lines 1-2 (of 2)\n1: export const A = 1\n2: export const B = 2\n",
                  },
                ],
              },
            },
          ],
        },
        { id: "a2", type: "assistant", content: [{ type: "text", text: "planning edit" }] },
      ]

      valve.armValve({
        sessionID: "ses_armed_r4",
        mode: "step-window",
        keepRecentSteps: 1,
        messages,
      })

      // Verify initial armed state has 0 filesModified and L1-L2 (never #all)
      const beforeStatus = valve.status("ses_armed_r4")
      expect(beforeStatus.ledger?.manifest.filesModified).toHaveLength(0)
      expect(beforeStatus.manifestMarkdown).not.toContain("#all")

      // 2. Write a 4-line update to disk and trigger recordToolExecuteAfter on the ALREADY-ARMED session
      const newDiskContent = "export const A = 10\nexport const B = 20\nexport const C = 30\nexport const D = 40\n"
      writeFileSync(targetFile, newDiskContent, "utf8")

      const recordToolExecuteAfter = (valve as unknown as Record<string, unknown>).recordToolExecuteAfter as (params: {
        readonly sessionID: string
        readonly tool: string
        readonly callId?: string
        readonly input?: Record<string, unknown>
        readonly outputText?: string
        readonly canonicalRoot?: string
      }) => void
      expect(typeof recordToolExecuteAfter).toBe("function")

      recordToolExecuteAfter.call(valve, {
        sessionID: "ses_armed_r4",
        tool: "write",
        callId: "call_w1",
        input: { filePath: "src_target.ts", content: newDiskContent },
        outputText: "Wrote src_target.ts",
        canonicalRoot: tmp,
      })

      const afterStatus = valve.status("ses_armed_r4")
      expect(afterStatus.ledger?.manifest.filesModified).toHaveLength(1)
      expect(afterStatus.ledger?.manifest.filesModified[0]?.normalizedPath).toBe("src_target.ts")
      const updatedRead = afterStatus.ledger?.manifest.filesRead.find((f) => f.normalizedPath === "src_target.ts")
      expect(updatedRead?.lineRange).toBe("L1-L4")
      expect(updatedRead?.status).toBe("FRESH — DO NOT REREAD")
      expect(afterStatus.manifestMarkdown).toContain("src_target.ts#L1-L4")
      expect(afterStatus.manifestMarkdown).not.toContain("#all")

      // Compact status when all tracked files are FRESH
      const allFreshCompact = renderCompactValveStatus(afterStatus)
      expect(allFreshCompact).toContain("One-Truth File Ledger: Total tracked: 1 (1 FRESH, 0 SLICE, 0 STALE) | Modified: 1 | Skills: 0 | Delegations: 0")
      expect(allFreshCompact).toContain("All 1 tracked files are FRESH on disk (pass full: true to list all rows).")
      expect(estimateTokens(allFreshCompact)).toBeLessThan(250)

      // 3. Verify 25-file session with mix of FRESH, SLICE, and STALE stays strictly < 250 tokens (< 1,000 chars)
      const manyMessages: Record<string, any>[] = [
        { id: "u_many", type: "user", content: [{ type: "text", text: "inspect 25 files" }] },
      ]
      const diskHashes = new Map<string, string>()
      for (let i = 1; i <= 25; i++) {
        const p = `src/module_${i}.ts`
        const body = `export const M${i} = ${i}\nexport const N${i} = ${i * 2}\n`
        const isSlice = i > 20 && i <= 23
        const isStale = i > 23
        if (isStale) {
          diskHashes.set(p, "f".repeat(64))
        }
        manyMessages.push({
          id: `a_many_${i}`,
          type: "assistant",
          content: [
            {
              type: "tool",
              id: `call_many_${i}`,
              name: "read",
              state: {
                status: "completed",
                input: isSlice ? { path: p, offset: 1, limit: 1 } : { path: p },
                content: [
                  {
                    type: "text",
                    text: isSlice
                      ? `Read file ${p}, lines 1-1\n1: export const M${i} = ${i}\n[Output truncated. Continue reading with offset: 2]`
                      : body,
                  },
                ],
              },
            },
          ],
        })
      }

      const pruneMany = valve.prune({
        sessionID: "ses_25_files",
        mode: "step-window",
        keepRecentSteps: 2,
        messages: manyMessages,
        diskHashesByPath: diskHashes,
      })
      const statusMany = valve.status("ses_25_files")
      expect(statusMany.manifestMarkdown).not.toContain("#all")

      const compactMany = renderCompactValveStatus(statusMany, pruneMany)
      expect(compactMany).toContain(
        "One-Truth File Ledger: Total tracked: 25 (20 FRESH, 3 SLICE, 2 STALE) | Modified: 0 | Skills: 0 | Delegations: 0",
      )
      expect(compactMany.length).toBeLessThan(1000)
      expect(estimateTokens(compactMany)).toBeLessThan(250)

      // 4. Verify syncFromSqlite reconciles SQLite file_read_ledger and file_touch rows into valve
      const db = new Database(":memory:")
      try {
        db.exec(DDL)
        const targetSha = sha256hex(newDiskContent.replace(/\n$/, ""))
        db.prepare(`
          INSERT INTO file_read_ledger (
            session_id, path, normalized_path, call_id, message_id, seq, read_seq,
            line_range, start_line, end_line, total_lines, is_truncated,
            chars, char_len, blob_sha, blob_sha256, slice_sha, read_blob_sha, disk_blob_sha,
            summary, staleness_status, t, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "ses_sqlite_sync",
          "src_target.ts",
          "src_target.ts",
          "call_sql_r1",
          "msg_sql_1",
          1,
          1,
          "all",
          1,
          4,
          4,
          0,
          newDiskContent.length,
          newDiskContent.length,
          targetSha,
          targetSha,
          targetSha,
          targetSha,
          targetSha,
          "exports: A, B, C, D",
          "FRESH — DO NOT REREAD",
          1000,
          new Date(1000).toISOString(),
        )
        db.prepare(`
          INSERT INTO file_touch (
            session_id, seq, call_id, tool, op, path, normalized_path, detail, t
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "ses_sqlite_sync",
          2,
          "call_sql_w1",
          "write",
          "write",
          "src_target.ts",
          "src_target.ts",
          null,
          2000,
        )

        const syncFromSqlite = (valve as unknown as Record<string, unknown>).syncFromSqlite as (
          sessionID: string,
          db: InstanceType<typeof Database>,
          canonicalRoot?: string,
        ) => void
        expect(typeof syncFromSqlite).toBe("function")
        syncFromSqlite.call(valve, "ses_sqlite_sync", db, tmp)

        const syncedStatus = valve.status("ses_sqlite_sync")
        expect(syncedStatus.manifestMarkdown).toContain("src_target.ts#L1-L4")
        expect(syncedStatus.manifestMarkdown).not.toContain("#all")
        const syncedCompact = renderCompactValveStatus(syncedStatus)
        expect(syncedCompact).toContain("Total tracked: 1 (1 FRESH, 0 SLICE, 0 STALE) | Modified: 1")
      } finally {
        db.close()
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})


