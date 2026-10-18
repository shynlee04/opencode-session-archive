import { Plugin } from "@opencode/plugin"
import type { Message, SystemPart, ContentPart } from "@opencode/ai"
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs"
import { join, basename } from "node:path"
import { createHash } from "node:crypto"
import { z } from "zod"

// ─── Project-aware compaction summary prompt ───────────────────────────

const COMPACTION_SYSTEM_PROMPT = `You are summarizing a long coding session for an OpenCode V2 plugin project (hivemind-steward-oc-devin-dev).

This project builds an OpenCode V2 plugin that hosts Devin and Antigravity ACP sessions. The codebase follows phase-driven planning under .planning/phases/<slug>/ with tickets, specs, ADRs, and an immutable decision trail.

Produce a structured, dense summary that another agent (or a compacted continuation of this session) can use to resume work with zero re-reading. You MUST format your response using these exact level-2 markdown headings (##) so the OpenCode V2 compaction validator succeeds:

## Objective
One high-level sentence summarizing what the user wants accomplished, followed by:
### Continuity Anchor
- compaction-ordinal: <N>
- session-id: <ses_xxx>
- parent-session: <parent ses_xxx or "none">
- child-sessions: [list of child session IDs]
- agent: <agent id>
- model: <model id>
- phase: <active .planning/phases slug>
- ticket: <active ticket ID, e.g. MH-23, SET-07>

### User Intent Map (Chronological Pivot Log)
Record every user prompt/turn across the session in order as an anchor pivot, keeping it relevant as a zoom out and complete trajectory:
- [Turn 1] [pivot-type: new-objective|directive|corrective|continuation|permission] <summary of intent and instructions>
- [Turn 2] [pivot-type: ...] <summary of intent and instructions>
- ...
- Active Objective: <the active current user direction that guides immediate work>

## Requirements
Bullet list of hard product, spec, and user constraints:
- User directives, corrections, and explicit guidance from the conversation
- Permissions granted (e.g. file scope, auth, tool access)
- Spec requirements active for the ticket

## Decisions
Bullet list of decisions made this session:
- What was decided
- Why (evidence, reproduction, or user mandate)
- Where it landed (commit, file path, ADR, or ticket)

## Work State
### Completed
- Concrete units finished (test written, implementation landed, config wired)
- Verification evidence: exact commands run (e.g. bun test, typecheck) and outcomes

### Active
- In-flight work started but not yet verified
- Active delegations (delegate-devin, delegate-antigravity, subagent, explore) with status
- Active git worktree lanes or branches

### Blocked
- Any blocker: failing gates, missing authority envelopes, or provider issues

## Next Move
Primary evidence rule: base this section on the terminal Assistant-message's what-next tracking list.
- Immediate executable next step (ready to run without re-reading)
- Remaining tracking list items in sequence

## Relevant Files
- Modified: files edited or written
- Created: new files
- Read for context: reference files inspected
- Commits landed: hash and message

## Important Context
### Working Posture Snapshot (.opencode/AGENTS.md)
Reference the live operating posture defined in .opencode/AGENTS.md:
- # Working posture: orchestrator and team
- ## Delegates: fan-out rules, worktree isolation, delegation tools
- Note: Headings and sections may change and often reflect current session posture; value them and preserve consistency until updated.

### Realignment on Resume
- Explicitly note whether the resuming agent should run skill "agentmd-deep-init" to help with realignment of the codebase vs project knowledge base.

### Assistant-Message Protocol
- The terminal Assistant-message anchors continuity for service restarts and next user turns. The compaction runner must adhere to its insights and tracking list for maximum accuracy.

### Context Pollution Audit
- Skills already loaded (do not reload unless needed)
- Files already fully understood (do not re-grep)
- Abandoned hypotheses or dead ends with reasons why

Rules:
- Strictly include the required "## Objective", "## Requirements", "## Decisions", "## Work State", "## Next Move", "## Relevant Files", "## Important Context" headings.
- Preserve session IDs (ses_xxx), file paths, and ticket IDs verbatim.
- Do NOT summarize raw tool outputs — state what was proved or disproved.`

// ─── Continuity Data Types ─────────────────────────────────────────────

export interface UserIntentPivot {
  readonly turnIndex: number
  readonly pivotType: "new-objective" | "directive" | "corrective" | "continuation" | "permission"
  readonly summary: string
}

export interface ContinuityAnchor {
  readonly timestamp: string
  readonly sessionId: string
  readonly parentSession: string | null
  readonly childSessions: readonly string[]
  readonly compactionOrdinal: number
  readonly agent: string
  readonly model: string
  readonly phase: string
  readonly ticket: string
  readonly objective: string
  readonly userIntents: readonly UserIntentPivot[]
  readonly lastUserPrompt: string
  readonly lastUserPromptIndex: number
  readonly lastAssistantSummary: string
  readonly writeActions: ReadonlyArray<{ readonly index: number; readonly tool: string; readonly target: string }>
  readonly delegations: ReadonlyArray<{ readonly sessionId: string; readonly description: string; readonly state: string }>
  readonly summaryHash: string
  readonly filesModified: readonly string[]
  readonly filesRead: readonly string[]
  readonly skillsLoaded: readonly string[]
  readonly nextMove: string
  readonly status: "compacting" | "completed"
}

// ─── Storage Helpers ───────────────────────────────────────────────────

function getHistoryDir(projectDir: string): string {
  return join(projectDir, ".opencode", "compaction-history")
}

function ensureHistoryDir(projectDir: string): string {
  const dir = getHistoryDir(projectDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

function getSessionHistoryPath(projectDir: string, sessionId: string): string {
  return join(getHistoryDir(projectDir), `${sessionId}.jsonl`)
}

function appendAnchor(projectDir: string, sessionId: string, anchor: ContinuityAnchor): void {
  ensureHistoryDir(projectDir)
  const path = getSessionHistoryPath(projectDir, sessionId)
  writeFileSync(path, JSON.stringify(anchor) + "\n", { flag: "a" })
}

function readAnchors(projectDir: string, sessionId: string): ContinuityAnchor[] {
  const path = getSessionHistoryPath(projectDir, sessionId)
  if (!existsSync(path)) return []
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContinuityAnchor)
}

function readAllAnchors(projectDir: string): Map<string, ContinuityAnchor[]> {
  const dir = getHistoryDir(projectDir)
  if (!existsSync(dir)) return new Map()
  const result = new Map<string, ContinuityAnchor[]>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue
    const sessionId = basename(file, ".jsonl")
    result.set(sessionId, readAnchors(projectDir, sessionId))
  }
  return result
}

function buildRetrievalContext(projectDir: string, currentSessionId: string): string {
  const allAnchors = readAllAnchors(projectDir)
  if (allAnchors.size === 0) return ""

  const lines: string[] = ["## Cross-Session Continuity (Compaction Anchors)", ""]

  const current = allAnchors.get(currentSessionId)
  if (current && current.length > 0) {
    lines.push("### This session's previous compactions")
    for (const a of current) {
      lines.push(`- Compaction #${a.compactionOrdinal} at ${a.timestamp} [${a.status}]`)
      lines.push(`  Objective: ${a.objective}`)
      lines.push(`  Next move: ${a.nextMove || "(pending completion)"}`)
      if (a.filesModified.length > 0) {
        lines.push(`  Files modified: ${a.filesModified.join(", ")}`)
      }
      if (a.childSessions.length > 0) {
        lines.push(`  Children: ${a.childSessions.join(", ")}`)
      }
    }
    lines.push("")
  }

  for (const [sid, anchors] of allAnchors) {
    if (sid === currentSessionId) continue
    const latest = anchors[anchors.length - 1]
    if (latest && latest.childSessions.includes(currentSessionId)) {
      lines.push("### Parent session context")
      lines.push(`- Session: ${sid}`)
      lines.push(`  Objective: ${latest.objective}`)
      lines.push(`  Phase: ${latest.phase}, Ticket: ${latest.ticket}`)
      lines.push(`  Last user prompt: ${latest.lastUserPrompt.slice(0, 200)}`)
      lines.push("")
      break
    }
  }

  const otherSessions = [...allAnchors.entries()]
    .filter(([sid]) => sid !== currentSessionId)
    .map(([sid, anchors]) => ({
      sid,
      latest: anchors[anchors.length - 1],
      ts: anchors[anchors.length - 1]?.timestamp ?? "",
    }))
    .filter((entry): entry is { sid: string; latest: ContinuityAnchor; ts: string } => entry.latest !== undefined)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 4)

  if (otherSessions.length > 0) {
    lines.push("### Recent project sessions")
    for (const { sid, latest } of otherSessions) {
      lines.push(`- ${sid} (${latest.agent}, compaction #${latest.compactionOrdinal})`)
      lines.push(`  Objective: ${latest.objective}`)
      lines.push(`  Phase: ${latest.phase}, Ticket: ${latest.ticket}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

// ─── Transcript Analysis Helpers ───────────────────────────────────────

function extractTextFromParts(parts: ReadonlyArray<ContentPart>): string {
  const texts: string[] = []
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") {
      texts.push(part.text)
    }
  }
  return texts.join("\n")
}

function extractUserIntents(messages: ReadonlyArray<Message>): UserIntentPivot[] {
  const intents: UserIntentPivot[] = []
  let userTurn = 0
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || msg.role !== "user") continue
    userTurn++
    const text = extractTextFromParts(msg.content).trim()
    if (!text) continue

    let pivotType: UserIntentPivot["pivotType"] = "continuation"
    const lower = text.toLowerCase()
    if (userTurn === 1 || lower.includes("objective") || lower.includes("goal") || lower.includes("build") || lower.includes("implement")) {
      pivotType = "new-objective"
    } else if (lower.includes("no ") || lower.includes("don't") || lower.includes("stop") || lower.includes("fix") || lower.includes("wrong") || lower.includes("error")) {
      pivotType = "corrective"
    } else if (lower.includes("allow") || lower.includes("permit") || lower.includes("consent") || lower.includes("approve") || lower.includes("yes")) {
      pivotType = "permission"
    } else if (lower.includes("must") || lower.includes("always") || lower.includes("ensure") || lower.includes("make sure")) {
      pivotType = "directive"
    }

    const firstLine = text.split("\n")[0] ?? text
    const summary = firstLine.slice(0, 240)
    intents.push({ turnIndex: i, pivotType, summary })
  }
  return intents
}

function extractLastAssistantSummary(messages: ReadonlyArray<Message>): { summary: string; nextMove: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== "assistant") continue
    const text = extractTextFromParts(msg.content).trim()
    if (text.length > 50) {
      let nextMove = ""
      const nextMatch = text.match(/(?:next(?:\s+steps?|\s+moves?|\s*:)|what-next)[\s\S]*$/i)
      if (nextMatch) {
        nextMove = nextMatch[0].slice(0, 400).trim()
      }
      return { summary: text.slice(0, 500), nextMove }
    }
  }
  return { summary: "", nextMove: "" }
}

function extractSessionIds(messages: ReadonlyArray<Message>): string[] {
  const ids = new Set<string>()
  for (const m of messages) {
    const text = extractTextFromParts(m.content)
    const matches = text.match(/ses_[a-zA-Z0-9]+/g)
    if (matches) {
      for (const id of matches) ids.add(id)
    }
    for (const part of m.content) {
      if (part.type === "tool-call" && typeof part.input === "object" && part.input !== null) {
        const inputStr = JSON.stringify(part.input)
        const toolMatches = inputStr.match(/ses_[a-zA-Z0-9]+/g)
        if (toolMatches) {
          for (const id of toolMatches) ids.add(id)
        }
      }
    }
  }
  return [...ids]
}

function extractWriteActions(messages: ReadonlyArray<Message>): Array<{ index: number; tool: string; target: string }> {
  const actions: Array<{ index: number; tool: string; target: string }> = []
  const writeTools = ["patch", "write", "edit", "create", "execute", "shell"]
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m) continue
    for (const part of m.content) {
      if (part.type === "tool-call") {
        const name = part.name
        if (writeTools.some((w) => name.toLowerCase().includes(w))) {
          const input = (part.input ?? {}) as Record<string, unknown>
          const target = String(input.path ?? input.file ?? input.TargetFile ?? name).slice(0, 200)
          actions.push({ index: i, tool: name, target })
        }
      }
    }
  }
  return actions
}

function extractLastUserPrompt(messages: ReadonlyArray<Message>): { text: string; index: number } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg && msg.role === "user") {
      const text = extractTextFromParts(msg.content).trim()
      if (text) return { text: text.slice(0, 500), index: i }
    }
  }
  return { text: "", index: -1 }
}

function extractSkillsLoaded(messages: ReadonlyArray<Message>): string[] {
  const skills = new Set<string>()
  for (const m of messages) {
    for (const part of m.content) {
      if (part.type === "tool-call" && part.name === "skill") {
        const input = (part.input ?? {}) as Record<string, unknown>
        if (typeof input.id === "string") skills.add(input.id)
        if (typeof input.name === "string") skills.add(input.name)
      }
    }
  }
  return [...skills]
}

function extractDelegations(messages: ReadonlyArray<Message>): Array<{ sessionId: string; description: string; state: string }> {
  const delegations: Array<{ sessionId: string; description: string; state: string }> = []
  for (const m of messages) {
    const text = extractTextFromParts(m.content)
    if (text.includes("<subagent")) {
      const sidMatch = text.match(/sessionID="(ses_[^"]+)"/)
      const stateMatch = text.match(/state="([^"]+)"/)
      const descMatch = text.match(/description="([^"]+)"/)
      if (sidMatch?.[1]) {
        delegations.push({
          sessionId: sidMatch[1],
          description: descMatch?.[1] ?? "unknown",
          state: stateMatch?.[1] ?? "unknown",
        })
      }
    }
    for (const part of m.content) {
      if (part.type === "tool-call" && (part.name.includes("delegate") || part.name === "subagent")) {
        const input = (part.input ?? {}) as Record<string, unknown>
        const prompt = String(input.prompt ?? input.task ?? "").slice(0, 100)
        delegations.push({
          sessionId: String(input.sessionID ?? input.sessionId ?? "new-call"),
          description: prompt || part.name,
          state: "invoked",
        })
      }
    }
  }
  return delegations
}

function detectPhase(messages: ReadonlyArray<Message>): string {
  const sample = messages.slice(-30).map((m) => extractTextFromParts(m.content)).join(" ")
  const phaseMatch = sample.match(/\.planning\/phases\/([\w-]+)/)
  if (phaseMatch?.[1]) return phaseMatch[1]
  const phases = [
    "multi-harness-delegation",
    "delegation-setup-configuration",
    "dual-stream-harness-architecture",
    "hosted-cli-interaction",
    "production-release",
    "devin-native-delegation",
  ]
  for (const phase of phases) {
    if (sample.includes(phase)) return phase
  }
  return "unknown"
}

function detectTicket(messages: ReadonlyArray<Message>): string {
  const sample = messages.slice(-30).map((m) => extractTextFromParts(m.content)).join(" ")
  const ticketMatch = sample.match(/\b(MH|SET|DSH|HCI|REL|ND)-(\d+)\b/)
  return ticketMatch ? ticketMatch[0] : "unknown"
}

function detectObjective(messages: ReadonlyArray<Message>): string {
  for (const m of messages) {
    if (m.role === "user") {
      const text = extractTextFromParts(m.content).trim()
      if (text) {
        const firstLine = text.split("\n")[0] ?? text
        return firstLine.slice(0, 240)
      }
    }
  }
  return "unknown"
}

function extractModifiedFiles(writeActions: Array<{ target: string }>): string[] {
  const files = new Set<string>()
  for (const a of writeActions) {
    if (a.target.startsWith("/") || a.target.includes("src/") || a.target.includes("test/") || a.target.includes(".planning/")) {
      files.add(a.target)
    }
  }
  return [...files].slice(0, 25)
}

function readOperatingPosture(projectDir: string): string {
  const posturePath = join(projectDir, ".opencode", "AGENTS.md")
  if (!existsSync(posturePath)) return ""
  try {
    return readFileSync(posturePath, "utf-8").trim()
  } catch {
    return ""
  }
}

// ─── Plugin Definition ─────────────────────────────────────────────────

export default Plugin.define({
  id: "compaction-continuity",

  async setup(ctx) {
    const projectDir = ctx.location.directory
    const ordinals = new Map<string, number>()
    const abortController = new AbortController()

    // 1. Session Compaction Hook (Pre-Compaction Prompt & Anchor Staging)
    ctx.session.hook("compaction", async (compaction) => {
      const sessionId = compaction.sessionID
      const existingAnchors = readAnchors(projectDir, sessionId)
      const ordinal = existingAnchors.length + 1
      ordinals.set(sessionId, ordinal)

      // Fetch verified session metadata from the server
      const serverSession = await ctx.session.get({ sessionID: sessionId }).catch(() => undefined)
      const parentSession = serverSession?.parentID ? String(serverSession.parentID) : null

      const messages = compaction.messages
      const sessionIds = extractSessionIds(messages)
      const writeActions = extractWriteActions(messages)
      const lastUser = extractLastUserPrompt(messages)
      const userIntents = extractUserIntents(messages)
      const assistantAnchor = extractLastAssistantSummary(messages)
      const skills = extractSkillsLoaded(messages)
      const delegations = extractDelegations(messages)
      const crossSessionContext = buildRetrievalContext(projectDir, sessionId)
      const operatingPosture = readOperatingPosture(projectDir)

      const intentSummaryLines = userIntents.map(
        (pivot) => `- [Turn index ${pivot.turnIndex}] [${pivot.pivotType}]: ${pivot.summary}`,
      )

      const metadataBlock = [
        "METADATA & CONTINUITY CONTEXT FOR COMPACTION RUNNER:",
        `- compaction-ordinal: ${ordinal}`,
        `- session-id: ${sessionId}`,
        `- parent-session: ${parentSession ?? "none"}`,
        `- child-sessions-referenced: ${sessionIds.filter((s) => s !== sessionId).join(", ") || "none"}`,
        `- write-actions-count: ${writeActions.length}`,
        `- skills-loaded: ${skills.join(", ") || "none"}`,
        `- delegations-count: ${delegations.length}`,
        `- last-user-prompt-index: ${lastUser.index}`,
        `- last-user-prompt: ${lastUser.text.slice(0, 300)}`,
        "",
        "CHRONOLOGICAL USER INTENT MAP (Pivot History):",
        ...(intentSummaryLines.length > 0 ? intentSummaryLines : ["- (none recorded)"]),
        "",
        "TERMINAL ASSISTANT-MESSAGE ANCHOR:",
        `- Recent summary: ${assistantAnchor.summary || "(none)"}`,
        `- What-next tracking: ${assistantAnchor.nextMove || "(none)"}`,
      ].join("\n")

      const extraSystemParts: SystemPart[] = [
        { type: "text", text: COMPACTION_SYSTEM_PROMPT },
        { type: "text", text: `\n\n${metadataBlock}` },
      ]

      if (crossSessionContext) {
        extraSystemParts.push({ type: "text", text: `\n\n${crossSessionContext}` })
      }

      if (operatingPosture) {
        extraSystemParts.push({
          type: "text",
          text: `\n\nLIVE OPERATING POSTURE (.opencode/AGENTS.md):\n${operatingPosture.slice(0, 2000)}`,
        })
      }

      compaction.system = [...compaction.system, ...extraSystemParts]

      const anchor: ContinuityAnchor = {
        timestamp: new Date().toISOString(),
        sessionId,
        parentSession,
        childSessions: sessionIds.filter((s) => s !== sessionId),
        compactionOrdinal: ordinal,
        agent: String(compaction.agent ?? "unknown"),
        model: typeof compaction.model === "object" ? JSON.stringify(compaction.model) : String(compaction.model ?? "unknown"),
        phase: detectPhase(messages),
        ticket: detectTicket(messages),
        objective: detectObjective(messages),
        userIntents,
        lastUserPrompt: lastUser.text,
        lastUserPromptIndex: lastUser.index,
        lastAssistantSummary: assistantAnchor.summary,
        writeActions: writeActions.slice(-25),
        delegations,
        summaryHash: "",
        filesModified: extractModifiedFiles(writeActions),
        filesRead: [],
        skillsLoaded: skills,
        nextMove: assistantAnchor.nextMove,
        status: "compacting",
      }

      appendAnchor(projectDir, sessionId, anchor)
    })

    // 2. Event Subscription (Post-Compaction Verification & Hash Finalization)
    const eventPump = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: abortController.signal })) {
          if (event.type === "session.compaction.ended") {
            const data = event.data
            const sid = data.sessionID
            const ordinal = ordinals.get(sid) ?? 1
            const summaryText = data.text ?? ""
            const summaryHash = summaryText
              ? createHash("sha256").update(summaryText).digest("hex").slice(0, 16)
              : ""

            let nextMove = ""
            const nextMatch = summaryText.match(/## Next Move\n([\s\S]*?)(?=\n##|$)/)
            if (nextMatch?.[1]) {
              nextMove = nextMatch[1].trim().slice(0, 500)
            }

            const existing = readAnchors(projectDir, sid)
            const currentAnchor = existing[existing.length - 1]
            if (currentAnchor) {
              const updatedAnchor: ContinuityAnchor = {
                ...currentAnchor,
                summaryHash,
                nextMove: nextMove || currentAnchor.nextMove,
                status: "completed",
              }
              appendAnchor(projectDir, sid, updatedAnchor)

              // Also write a human/orchestrator readable latest summary snapshot
              const latestSummaryFile = join(getHistoryDir(projectDir), `${sid}.latest.md`)
              writeFileSync(
                latestSummaryFile,
                `# Latest Compaction Summary (Session ${sid}, Ordinal #${ordinal})\n\n${summaryText}`,
              )
            }
          }
        }
      } catch {
        // Aborted on plugin teardown
      }
    })()

    // 3. Session Context Hook (Low-Noise Cross-Session Continuation Ingestion)
    ctx.session.hook("context", async (context) => {
      const crossSessionContext = buildRetrievalContext(projectDir, context.sessionID)
      if (crossSessionContext) {
        context.system.push({
          type: "text",
          text: `\n\n${crossSessionContext}\nTip: Use tool "compaction_continuity" or CLI "bun .opencode/plugins/compaction-continuity.ts" for progressive disclosure.`,
        })
      }
    })

    // 4. CodeMode Tool Registration ("compaction_continuity")
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "compaction_continuity",
        description:
          "Progressive disclosure retrieval tool for cross-session compaction history, chronological user intent pivots, delegation hierarchies, and previous compaction anchors.",
        input: z.object({
          action: z.enum(["overview", "session", "latest", "intents", "search"]).default("overview"),
          sessionID: z.string().optional().describe("Session ID (e.g. ses_xxx) to inspect"),
          query: z.string().optional().describe("Search keyword across objectives and next moves"),
        }),
        execute: async (input) => {
          const action = input.action
          const targetSession = input.sessionID

          if (action === "overview") {
            const allAnchors = readAllAnchors(projectDir)
            if (allAnchors.size === 0) {
              return { content: "No compaction history recorded yet." }
            }
            const summaries: string[] = ["## Compaction History Overview\n"]
            for (const [sid, anchors] of allAnchors) {
              const latest = anchors[anchors.length - 1]
              if (!latest) continue
              summaries.push(`- Session: ${sid} (${anchors.length} compactions)`)
              summaries.push(`  Objective: ${latest.objective}`)
              summaries.push(`  Phase: ${latest.phase} | Ticket: ${latest.ticket}`)
              summaries.push(`  Next Move: ${latest.nextMove || "(none)"}`)
            }
            return { content: summaries.join("\n") }
          }

          if (action === "latest" && targetSession) {
            const latestFile = join(getHistoryDir(projectDir), `${targetSession}.latest.md`)
            if (existsSync(latestFile)) {
              return { content: readFileSync(latestFile, "utf-8") }
            }
            const anchors = readAnchors(projectDir, targetSession)
            if (anchors.length === 0) return { content: `No anchors found for session ${targetSession}` }
            return { content: JSON.stringify(anchors[anchors.length - 1], null, 2) }
          }

          if (action === "intents" && targetSession) {
            const anchors = readAnchors(projectDir, targetSession)
            if (anchors.length === 0) return { content: `No anchors found for session ${targetSession}` }
            const latest = anchors[anchors.length - 1]
            return {
              content: JSON.stringify(
                {
                  sessionId: targetSession,
                  objective: latest?.objective,
                  userIntents: latest?.userIntents,
                },
                null,
                2,
              ),
            }
          }

          if (action === "session" && targetSession) {
            const anchors = readAnchors(projectDir, targetSession)
            return { content: JSON.stringify(anchors, null, 2) }
          }

          if (action === "search" && input.query) {
            const q = input.query.toLowerCase()
            const allAnchors = readAllAnchors(projectDir)
            const matches: unknown[] = []
            for (const [sid, anchors] of allAnchors) {
              for (const a of anchors) {
                if (
                  a.objective.toLowerCase().includes(q) ||
                  a.nextMove.toLowerCase().includes(q) ||
                  a.ticket.toLowerCase().includes(q)
                ) {
                  matches.push({ sessionId: sid, ordinal: a.compactionOrdinal, objective: a.objective, nextMove: a.nextMove })
                }
              }
            }
            return { content: JSON.stringify(matches, null, 2) }
          }

          return { content: "Specify action and sessionID for compaction_continuity." }
        },
      })
    })

    return async () => {
      abortController.abort()
      await eventPump.catch(() => {})
    }
  },
})

// ─── CLI Entrypoint (bun .opencode/plugins/compaction-continuity.ts) ───

if (import.meta.main) {
  const args = process.argv.slice(2)
  const projectDir = process.cwd()
  const sessionFlagIndex = args.indexOf("--session")
  const sessionArg = sessionFlagIndex !== -1 ? args[sessionFlagIndex + 1] : undefined
  const showAll = args.includes("--all")
  const showIntents = args.includes("--intents")
  const showLatest = args.includes("--latest")

  if (sessionArg) {
    const anchors = readAnchors(projectDir, sessionArg)
    if (anchors.length === 0) {
      console.log(`No compaction anchors found for session: ${sessionArg}`)
      process.exit(0)
    }
    if (showIntents) {
      const latest = anchors[anchors.length - 1]
      console.log(`\nUser Intents for Session ${sessionArg}:`)
      for (const p of latest?.userIntents ?? []) {
        console.log(`  [Turn ${p.turnIndex}] [${p.pivotType}]: ${p.summary}`)
      }
      process.exit(0)
    }
    if (showLatest) {
      const latestFile = join(getHistoryDir(projectDir), `${sessionArg}.latest.md`)
      if (existsSync(latestFile)) {
        console.log(readFileSync(latestFile, "utf-8"))
        process.exit(0)
      }
    }
    const toShow = showAll ? anchors : [anchors[anchors.length - 1]]
    for (const a of toShow) {
      if (!a) continue
      console.log(`\n## Compaction #${a.compactionOrdinal} — ${a.timestamp} [${a.status}]`)
      console.log(`Objective: ${a.objective}`)
      console.log(`Phase: ${a.phase} | Ticket: ${a.ticket}`)
      console.log(`Agent: ${a.agent} | Model: ${a.model}`)
      console.log(`Files modified: ${a.filesModified.join(", ") || "none"}`)
      console.log(`Next move: ${a.nextMove || "(none)"}`)
      console.log(`Summary hash: ${a.summaryHash || "(pending)"}`)
    }
  } else {
    const all = readAllAnchors(projectDir)
    if (all.size === 0) {
      console.log("No compaction history recorded.")
      process.exit(0)
    }
    console.log("## Cross-Session Compaction History\n")
    for (const [sid, anchors] of all) {
      const latest = anchors[anchors.length - 1]
      if (!latest) continue
      console.log(`### ${sid} (${anchors.length} compactions)`)
      console.log(`  Objective: ${latest.objective}`)
      console.log(`  Phase: ${latest.phase} | Ticket: ${latest.ticket}`)
      console.log(`  Next move: ${latest.nextMove || "(none)"}\n`)
    }
  }
}
