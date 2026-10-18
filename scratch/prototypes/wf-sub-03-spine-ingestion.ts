// PROTOTYPE: WF-SUB-03 — Host KV Lineage, Shadow Snapshot Blob Sinking & Reported-vs-Verified Outcome Classifier
// Disposable discovery artifact per the prototype skill. Never mutates opencode.db or host snapshot/spill directories.

import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

export type Harness = "devin" | "antigravity" | "opencode"

export type ReportedOutcome = "succeeded" | "failed" | "interrupted" | "running" | null

export type VerifiedOutcome =
  | "verified_pass"
  | "reported_only"
  | "tool_error_inside"
  | "blocked_in_text"
  | "empty_output"

export interface KvBindingRow {
  readonly child_session_id: string
  readonly raw_key: string
  readonly scope: string | null
  readonly driver_kind: string | null
  readonly harness: Harness | null
  readonly foreign_session_id: string | null
  readonly parent_session_id: string | null
  readonly call_id: string | null
  readonly title: string | null
  readonly cwd: string | null
  readonly agent: string | null
  readonly model: string | null
  readonly effort: string | null
  readonly mode: "spawn" | "send" | "continue" | null
  readonly background: boolean | null
  readonly requested_model: string | null
  readonly confirmed_model: string | null
  readonly confirmed_effort: string | null
  readonly turn: number | null
  readonly phase: string | null
  readonly foreign_ack_turn: number | null
  readonly foreign_ack_stop_reason: string | null
  readonly serving_witness_model: string | null
  readonly serving_witness_at: string | null
  readonly consumed_inputs_json: string | null
  readonly created_at: number | null
  readonly updated_at: number | null
  readonly source_origin: "host_db" | "wf_sub_r02_fixture"
}

export interface KvContextPruneRow {
  readonly session_id: string
  readonly raw_key: string
  readonly scope: string | null
  readonly mode: string | null
  readonly anchor_message_id: string | null
  readonly recorded_at: string | null
  readonly updated_at: number | null
}

export interface KvForeignIndexRow {
  readonly harness: string
  readonly foreign_session_id: string
  readonly child_session_id: string
  readonly raw_key: string
}

export interface DelegationTurnRow {
  readonly parent_session_id: string
  readonly call_id: string
  readonly turn_index: number
  readonly child_session_id: string
  readonly mode: "spawn" | "send" | "continue"
  readonly harness: Harness
  readonly agent: string | null
  readonly model: string | null
  readonly foreign_session_id: string | null
  readonly start_seq: number
  readonly end_seq: number
  readonly start_message_id: string
  readonly end_message_id: string
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
  readonly prompt_blob: string | null
  readonly response_blob: string | null
  readonly source_origin: "host_db" | "wf_sub_r02_fixture"
}

export interface SnapshotArtifactRow {
  readonly session_id: string
  readonly message_id: string
  readonly seq: number
  readonly path: string
  readonly start_tree_sha: string
  readonly end_tree_sha: string
  readonly start_blob_sha: string | null
  readonly end_blob_sha: string | null
  readonly start_git_blob_sha: string | null
  readonly end_git_blob_sha: string | null
  readonly start_byte_len: number | null
  readonly end_byte_len: number | null
  readonly byte_len: number
  readonly source_origin: "host_db" | "wf_sub_r02_fixture"
}

export interface SpillArtifactRow {
  readonly session_id: string
  readonly call_id: string
  readonly message_id: string
  readonly seq: number
  readonly tool_name: string
  readonly spill_kind: "tool-output" | "shell"
  readonly spill_source: string
  readonly inline_byte_len: number
  readonly full_byte_len: number
  readonly blob_sha: string
  readonly source_origin: "host_db" | "wf_sub_r02_fixture"
}

export interface HostMessageRow {
  readonly id: string
  readonly session_id: string
  readonly type: string
  readonly seq: number
  readonly time_created: number
  readonly time_updated: number
  readonly data: Record<string, unknown>
}

export interface HostSessionRow {
  readonly id: string
  readonly project_id: string
  readonly parent_id: string | null
  readonly directory: string
  readonly title: string | null
  readonly agent: string | null
  readonly model_id: string | null
  readonly provider_id: string | null
  readonly variant: string | null
  readonly idle_outcome: string | null
  readonly time_created: number
  readonly time_updated: number
}

export interface ChildStopSegment {
  readonly turn_index: number
  readonly start_seq: number
  readonly end_seq: number
  readonly start_message_id: string
  readonly end_message_id: string
  readonly prompt_text: string
  readonly response_text: string
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
}

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null)

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

const asArr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])

export function sha256hex(input: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(input).digest("hex")
}

export function sha1hex(input: string): string {
  return createHash("sha1").update(input).digest("hex")
}

export function decodeUtf16BeHex(hex: string): string | null {
  if (hex.length === 0 || hex.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const chars: number[] = []
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4), 16)
    chars.push(code)
  }
  return String.fromCharCode(...chars)
}

export function decodeHostKvKey(rawKey: string, explicitScope?: string | null): {
  readonly scope: string | null
  readonly logicalKey: string
} {
  if (explicitScope && explicitScope.length > 0) {
    return { scope: explicitScope, logicalKey: rawKey }
  }
  if (rawKey.startsWith("plugin:")) {
    const secondColon = rawKey.indexOf(":", "plugin:".length)
    if (secondColon > "plugin:".length) {
      const hexPart = rawKey.slice("plugin:".length, secondColon)
      const decoded = decodeUtf16BeHex(hexPart)
      const logicalKey = rawKey.slice(secondColon + 1)
      return {
        scope: decoded !== null ? `plugin:${decoded}` : `plugin:${hexPart}`,
        logicalKey,
      }
    }
  }
  return { scope: null, logicalKey: rawKey }
}

const normalizeHarness = (value: unknown, agent?: string | null, title?: string | null, providerId?: string | null): Harness => {
  if (value === "devin" || value === "antigravity" || value === "opencode") return value
  if (providerId === "devin-native") return "devin"
  if (providerId === "antigravity-native") return "antigravity"
  if (typeof agent === "string") {
    if (agent.includes("antigravity")) return "antigravity"
    if (agent.includes("devin")) return "devin"
  }
  if (typeof title === "string") {
    if (title.startsWith("Antigravity")) return "antigravity"
    if (title.startsWith("Devin")) return "devin"
  }
  return "opencode"
}

const normalizeReportedOutcome = (value: unknown): ReportedOutcome => {
  if (value === "succeeded" || value === "failed" || value === "interrupted" || value === "running") {
    return value
  }
  return null
}

const parseJsonObject = (raw: unknown): Record<string, unknown> => {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== "string") return {}
  try {
    const parsed = JSON.parse(raw)
    return asObj(parsed)
  } catch {
    return {}
  }
}

export function readHostSessions(db: Database, sessionIds?: readonly string[]): Map<string, HostSessionRow> {
  const map = new Map<string, HostSessionRow>()
  const rows =
    sessionIds && sessionIds.length > 0
      ? (db
          .query(
            `SELECT id, project_id, parent_id, directory, title, agent, model, idle_outcome, time_created, time_updated FROM session_v2 WHERE id IN (${sessionIds.map(() => "?").join(",")})`,
          )
          .all(...sessionIds) as Array<Record<string, unknown>>)
      : (db
          .query(
            "SELECT id, project_id, parent_id, directory, title, agent, model, idle_outcome, time_created, time_updated FROM session_v2",
          )
          .all() as Array<Record<string, unknown>>)

  for (const r of rows) {
    const modelObj = parseJsonObject(r.model)
    map.set(r.id as string, {
      id: r.id as string,
      project_id: (r.project_id as string) ?? "",
      parent_id: asStr(r.parent_id),
      directory: (r.directory as string) ?? "",
      title: asStr(r.title),
      agent: asStr(r.agent),
      model_id: asStr(modelObj.id),
      provider_id: asStr(modelObj.providerID),
      variant: asStr(modelObj.variant),
      idle_outcome: asStr(r.idle_outcome),
      time_created: asNum(r.time_created) ?? 0,
      time_updated: asNum(r.time_updated) ?? 0,
    })
  }
  return map
}

export function ingestHostKv(
  db: Database,
  sessionsById: ReadonlyMap<string, HostSessionRow>,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): {
  readonly bindings: KvBindingRow[]
  readonly contextPrunes: KvContextPruneRow[]
  readonly foreignIndex: KvForeignIndexRow[]
} {
  const cols = new Set(
    (db.query("SELECT name FROM pragma_table_info('kv')").all() as Array<{ name: string }>).map((c) => c.name),
  )
  if (cols.size === 0) {
    return { bindings: [], contextPrunes: [], foreignIndex: [] }
  }

  const rawRows: Array<{ rawKey: string; scope: string | null; value: string; timeCreated: number | null; timeUpdated: number | null }> =
    cols.has("key")
      ? (
          db.query("SELECT key, value, time_created, time_updated FROM kv").all() as Array<{
            key: string
            value: string
            time_created: number | null
            time_updated: number | null
          }>
        ).map((r) => ({
          rawKey: r.key,
          scope: null,
          value: r.value,
          timeCreated: r.time_created,
          timeUpdated: r.time_updated,
        }))
      : (
          db.query("SELECT scope, name, value FROM kv").all() as Array<{
            scope: string
            name: string
            value: string
          }>
        ).map((r) => ({
          rawKey: r.name,
          scope: r.scope,
          value: r.value,
          timeCreated: null,
          timeUpdated: null,
        }))

  interface PartialBinding {
    child_session_id: string
    raw_key: string
    scope: string | null
    driver_kind: string | null
    harness: Harness | null
    foreign_session_id: string | null
    parent_session_id: string | null
    call_id: string | null
    title: string | null
    cwd: string | null
    agent: string | null
    model: string | null
    effort: string | null
    mode: "spawn" | "send" | "continue" | null
    background: boolean | null
    requested_model: string | null
    confirmed_model: string | null
    confirmed_effort: string | null
    turn: number | null
    phase: string | null
    foreign_ack_turn: number | null
    foreign_ack_stop_reason: string | null
    serving_witness_model: string | null
    serving_witness_at: string | null
    consumed_inputs_json: string | null
    created_at: number | null
    updated_at: number | null
  }

  const bindingMap = new Map<string, PartialBinding>()
  const contextPrunes: KvContextPruneRow[] = []
  const foreignIndex: KvForeignIndexRow[] = []

  const getOrInit = (childSessionId: string, rawKey: string, scope: string | null): PartialBinding => {
    let entry = bindingMap.get(childSessionId)
    if (!entry) {
      const sRow = sessionsById.get(childSessionId)
      entry = {
        child_session_id: childSessionId,
        raw_key: rawKey,
        scope,
        driver_kind: null,
        harness: sRow ? normalizeHarness(null, sRow.agent, sRow.title, sRow.provider_id) : null,
        foreign_session_id: null,
        parent_session_id: sRow?.parent_id ?? null,
        call_id: null,
        title: sRow?.title ?? null,
        cwd: sRow?.directory ?? null,
        agent: sRow?.agent ?? null,
        model: sRow?.model_id ?? null,
        effort: sRow?.variant ?? null,
        mode: null,
        background: null,
        requested_model: null,
        confirmed_model: null,
        confirmed_effort: null,
        turn: null,
        phase: null,
        foreign_ack_turn: null,
        foreign_ack_stop_reason: null,
        serving_witness_model: null,
        serving_witness_at: null,
        consumed_inputs_json: null,
        created_at: sRow?.time_created ?? null,
        updated_at: sRow?.time_updated ?? null,
      }
      bindingMap.set(childSessionId, entry)
    }
    return entry
  }

  for (const row of rawRows) {
    const { scope, logicalKey } = decodeHostKvKey(row.rawKey, row.scope)
    const val = parseJsonObject(row.value)

    // 1. bindings/v1/<childSessionID> or bindings/<childSessionID>
    if (logicalKey.startsWith("bindings/v1/") || logicalKey.startsWith("bindings/")) {
      const childId =
        asStr(val.childSessionID) ??
        (logicalKey.startsWith("bindings/v1/")
          ? logicalKey.slice("bindings/v1/".length)
          : logicalKey.slice("bindings/".length))
      if (!childId) continue
      const b = getOrInit(childId, row.rawKey, scope)
      b.raw_key = row.rawKey
      b.scope = scope ?? b.scope
      b.driver_kind = asStr(val.driverKind) ?? asStr(val.creationTransportRef) ?? "acp-W"
      const foreignId = asStr(val.foreignSessionID) ?? asStr(val.foreignSessionId)
      if (foreignId) b.foreign_session_id = foreignId
      const parentId = asStr(val.parentSessionID)
      if (parentId) b.parent_session_id = parentId
      const title = asStr(val.title)
      if (title) b.title = title
      const cwd = asStr(val.cwd)
      if (cwd) b.cwd = cwd
      const roleDelivery = asObj(val.roleDelivery)
      const agent = asStr(val.agent) ?? asStr(roleDelivery.agent)
      if (agent) b.agent = agent

      const creationApplied = asObj(val.creationApplied)
      const receipts = asObj(creationApplied.receipts)
      const modelReceipt = asObj(receipts.model)
      const thinkingReceipt = asObj(receipts.thinking)
      const witness = asObj(val.servingWitness)

      const model =
        asStr(val.model) ??
        asStr(creationApplied.model) ??
        asStr(modelReceipt.applied) ??
        asStr(witness.model)
      if (model) b.model = model

      const effort = asStr(val.effort) ?? asStr(thinkingReceipt.applied)
      if (effort) b.effort = effort

      const reqModel = asStr(modelReceipt.requested)
      if (reqModel) b.requested_model = reqModel
      const confModel = asStr(modelReceipt.applied) ?? asStr(witness.model)
      if (confModel) b.confirmed_model = confModel
      const confEffort = asStr(thinkingReceipt.applied)
      if (confEffort) b.confirmed_effort = confEffort

      const harnessVal = asStr(val.harness)
      b.harness = normalizeHarness(harnessVal, b.agent, b.title, sessionsById.get(childId)?.provider_id)

      const turn = asNum(val.turn)
      if (turn !== null) b.turn = turn
      const phase = asStr(val.phase)
      if (phase) b.phase = phase

      const foreignAck = asObj(val.foreignAck)
      const ackTurn = asNum(foreignAck.turn)
      if (ackTurn !== null) b.foreign_ack_turn = ackTurn
      const ackStop = asStr(foreignAck.stopReason)
      if (ackStop) b.foreign_ack_stop_reason = ackStop

      const witnessModel = asStr(witness.model)
      if (witnessModel) b.serving_witness_model = witnessModel
      const witnessAt = asStr(witness.observedAt)
      if (witnessAt) b.serving_witness_at = witnessAt

      if (Array.isArray(val.consumedInputs)) {
        b.consumed_inputs_json = JSON.stringify(val.consumedInputs)
      }
      b.created_at = asNum(val.createdAt) ?? row.timeCreated ?? b.created_at
      b.updated_at = asNum(val.updatedAt) ?? row.timeUpdated ?? b.updated_at

      if (b.foreign_session_id && b.harness) {
        foreignIndex.push({
          harness: b.harness,
          foreign_session_id: b.foreign_session_id,
          child_session_id: childId,
          raw_key: `derived:${row.rawKey}`,
        })
      }
      continue
    }

    // 2. bindings-by-foreign/v1/<harness>/<foreignSessionId>
    if (logicalKey.startsWith("bindings-by-foreign/v1/") || logicalKey.startsWith("bindings-by-foreign/")) {
      const rest = logicalKey.startsWith("bindings-by-foreign/v1/")
        ? logicalKey.slice("bindings-by-foreign/v1/".length)
        : logicalKey.slice("bindings-by-foreign/".length)
      const slash = rest.indexOf("/")
      if (slash > 0) {
        const harness = rest.slice(0, slash)
        const foreignId = rest.slice(slash + 1)
        const childId = asStr(val.childSessionID) ?? asStr(val.sessionID) ?? (typeof row.value === "string" && row.value.startsWith("ses_") ? row.value : null)
        if (childId) {
          foreignIndex.push({
            harness,
            foreign_session_id: foreignId,
            child_session_id: childId,
            raw_key: row.rawKey,
          })
          const b = getOrInit(childId, row.rawKey, scope)
          b.foreign_session_id = b.foreign_session_id ?? foreignId
          if (harness === "devin" || harness === "antigravity" || harness === "opencode") {
            b.harness = b.harness ?? harness
          }
        }
      }
      continue
    }

    // 3. delegate-mode/child/<childSessionID> or delegate-mode/pending/<callID>
    if (logicalKey.startsWith("delegate-mode/child/") || logicalKey.startsWith("delegate-mode/pending/")) {
      const isChildKey = logicalKey.startsWith("delegate-mode/child/")
      const childId =
        asStr(val.childSessionID) ??
        (isChildKey ? logicalKey.slice("delegate-mode/child/".length) : null)
      if (!childId) continue
      const b = getOrInit(childId, isChildKey ? row.rawKey : `delegate-mode/child/${childId}`, scope)
      const parentId = asStr(val.parentSessionID)
      if (parentId) b.parent_session_id = parentId
      const callId = asStr(val.callID)
      if (callId) b.call_id = callId

      const rawMode = asStr(val.mode)
      if (rawMode === "spawn" || rawMode === "send" || rawMode === "continue") {
        b.mode = rawMode
      }

      const launchMode = asStr(val.launchMode)
      const bg = asBool(val.background)
      if (bg !== null) {
        b.background = bg
      } else if (launchMode !== null) {
        b.background = launchMode === "background"
      }

      const reqModel = asStr(val.requestedModel)
      if (reqModel) b.requested_model = reqModel
      const confModel = asStr(val.confirmedModel)
      if (confModel) {
        b.confirmed_model = confModel
        b.model = b.model ?? confModel
      }
      const confEffort = asStr(val.confirmedEffort)
      if (confEffort) {
        b.confirmed_effort = confEffort
        b.effort = b.effort ?? confEffort
      }
      const harnessVal = asStr(val.harness)
      if (harnessVal === "devin" || harnessVal === "antigravity" || harnessVal === "opencode") {
        b.harness = harnessVal
      }
      b.created_at = asNum(val.createdAt) ?? row.timeCreated ?? b.created_at
      b.updated_at = asNum(val.updatedAt) ?? asNum(val.releasedAt) ?? row.timeUpdated ?? b.updated_at
      continue
    }

    // 4. session:<sessionID>:context-prune:<sessionID> or context-prune:<sessionID>
    if (logicalKey.startsWith("context-prune:") || /^session:[^:]+:context-prune:/.test(logicalKey)) {
      const parts = logicalKey.split(":")
      const sessionId = parts[parts.length - 1] ?? ""
      if (sessionId.length > 0) {
        contextPrunes.push({
          session_id: sessionId,
          raw_key: row.rawKey,
          scope,
          mode: asStr(val.mode),
          anchor_message_id: asStr(val.anchor),
          recorded_at: asStr(val.at),
          updated_at: row.timeUpdated,
        })
      }
    }
  }

  const bindings: KvBindingRow[] = [...bindingMap.values()].map((b) => ({
    ...b,
    harness: b.harness ?? "opencode",
    mode: b.mode ?? ((b.turn ?? 1) > 1 ? "send" : "spawn"),
    source_origin: sourceOrigin,
  }))

  return { bindings, contextPrunes, foreignIndex }
}

const BLOCKER_PATTERNS: ReadonlyArray<{ readonly label: string; readonly regex: RegExp }> = [
  { label: "mcp_init_failed", regex: /The MCP server [^\n]+ failed to initialize/i },
  { label: "mcp_timeout", regex: /MCP server [^\n]+ timed out/i },
  { label: "mcp_tool_failed", regex: /MCP tool (?:call )?failed|[^\n]*MCP tool failed with an error/i },
  { label: "read_lease_violation", regex: /read lease violation/i },
  { label: "explicit_blocked", regex: /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*BLOCKED\*\*|BLOCKED\s*[—:—-])/ },
]

export function classifyMessagesOutcome(
  messages: readonly HostMessageRow[],
  fallbackReportedOutcome: string | null,
): {
  readonly reported_outcome: ReportedOutcome
  readonly verified_outcome: VerifiedOutcome
  readonly blocker_summary: string | null
  readonly tool_error_count: number
  readonly tool_completed_count: number
  readonly text_char_count: number
} {
  let reported: ReportedOutcome = normalizeReportedOutcome(fallbackReportedOutcome)
  let toolErrorCount = 0
  let toolCompletedCount = 0
  let textCharCount = 0
  const blockerReasons: string[] = []

  for (const msg of messages) {
    if (msg.type === "idle") {
      const idleOut = normalizeReportedOutcome(msg.data.outcome)
      if (idleOut !== null) reported = idleOut
      continue
    }
    if (msg.type !== "assistant") continue
    const parts = asArr(msg.data.content)
    for (const rawPart of parts) {
      const part = asObj(rawPart)
      if (part.type === "text") {
        const text = asStr(part.text) ?? ""
        textCharCount += text.trim().length
        for (const pat of BLOCKER_PATTERNS) {
          const m = text.match(pat.regex)
          if (m) {
            blockerReasons.push(`${pat.label}: ${m[0].trim().slice(0, 120)}`)
          }
        }
      } else if (part.type === "tool") {
        const state = asObj(part.state)
        const status = asStr(state.status)
        const toolName = asStr(part.name) ?? "tool"
        if (status === "error" || state.error !== undefined) {
          toolErrorCount++
          const errObj = asObj(state.error)
          const errMsg = asStr(errObj.message) ?? asStr(state.error) ?? JSON.stringify(state.error)
          if (blockerReasons.length < 4) {
            blockerReasons.push(`tool_error(${toolName}): ${errMsg.slice(0, 120)}`)
          }
        } else if (status === "completed") {
          toolCompletedCount++
        }
      }
    }
  }

  const hasTextBlocker = blockerReasons.some((r) => !r.startsWith("tool_error("))
  const verified: VerifiedOutcome =
    textCharCount === 0 && toolCompletedCount === 0 && toolErrorCount === 0
      ? "empty_output"
      : toolErrorCount > 0
        ? "tool_error_inside"
        : hasTextBlocker
          ? "blocked_in_text"
          : toolCompletedCount > 0
            ? "verified_pass"
            : "reported_only"

  return {
    reported_outcome: reported,
    verified_outcome: verified,
    blocker_summary: blockerReasons.length > 0 ? blockerReasons.slice(0, 3).join("; ") : null,
    tool_error_count: toolErrorCount,
    tool_completed_count: toolCompletedCount,
    text_char_count: textCharCount,
  }
}

export function segmentChildStops(
  messages: readonly HostMessageRow[],
  sessionIdleOutcome: string | null,
): ChildStopSegment[] {
  if (messages.length === 0) return []

  const groups: HostMessageRow[][] = []
  let current: HostMessageRow[] = []
  let seenAssistantInCurrent = false

  for (const msg of messages) {
    if (msg.type === "user" && current.length > 0 && seenAssistantInCurrent) {
      groups.push(current)
      current = [msg]
      seenAssistantInCurrent = false
      continue
    }
    current.push(msg)
    if (msg.type === "assistant") {
      seenAssistantInCurrent = true
    }
    if (msg.type === "idle") {
      groups.push(current)
      current = []
      seenAssistantInCurrent = false
    }
  }
  if (current.length > 0) {
    groups.push(current)
  }

  return groups.map((group, idx) => {
    const first = group[0]!
    const last = group[group.length - 1]!
    const promptTexts: string[] = []
    const responseTexts: string[] = []

    for (const m of group) {
      if (m.type === "user") {
        const t = asStr(m.data.text)
        if (t) promptTexts.push(t)
      } else if (m.type === "assistant") {
        for (const rawPart of asArr(m.data.content)) {
          const p = asObj(rawPart)
          if (p.type === "text" && typeof p.text === "string") {
            responseTexts.push(p.text)
          }
        }
      }
    }

    const classification = classifyMessagesOutcome(group, sessionIdleOutcome)
    return {
      turn_index: idx,
      start_seq: first.seq,
      end_seq: last.seq,
      start_message_id: first.id,
      end_message_id: last.id,
      prompt_text: promptTexts.join("\n"),
      response_text: responseTexts.join("\n"),
      reported_outcome: classification.reported_outcome,
      verified_outcome: classification.verified_outcome,
      blocker_summary: classification.blocker_summary,
      tool_error_count: classification.tool_error_count,
      tool_completed_count: classification.tool_completed_count,
      text_char_count: classification.text_char_count,
    }
  })
}

const DELEGATION_TOOLS = new Set(["subagent", "delegate-devin", "hivemind-delegate"])

export function normalizeDelegationTurns(
  parentSessionId: string,
  parentMessages: readonly HostMessageRow[],
  childSessions: readonly HostSessionRow[],
  childMessagesById: ReadonlyMap<string, readonly HostMessageRow[]>,
  kvByChildId: ReadonlyMap<string, KvBindingRow>,
  sinkText: (text: string) => string,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): DelegationTurnRow[] {
  interface ParentCallFact {
    readonly call_id: string
    readonly seq: number
    readonly child_session_id: string
    readonly mode: "spawn" | "send" | "continue"
    readonly agent: string | null
    readonly harness: Harness | null
    readonly prompt: string | null
  }

  const callsByChild = new Map<string, ParentCallFact[]>()
  for (const msg of parentMessages) {
    if (msg.type !== "assistant") continue
    for (const rawPart of asArr(msg.data.content)) {
      const part = asObj(rawPart)
      if (part.type !== "tool") continue
      const toolName = asStr(part.name) ?? ""
      if (!DELEGATION_TOOLS.has(toolName)) continue
      const state = asObj(part.state)
      const meta = asObj(state.metadata)
      const input = asObj(state.input)
      const childId = asStr(meta.sessionID) ?? asStr(input.sessionID)
      if (!childId) continue
      const callId = asStr(part.id) ?? `call:${parentSessionId}:${msg.seq}`
      const hasInputSession = typeof input.sessionID === "string" && input.sessionID.length > 0
      const list = callsByChild.get(childId) ?? []
      const mode: "spawn" | "send" | "continue" =
        hasInputSession || list.length > 0 ? "send" : "spawn"
      const hStr = asStr(input.harness)
      const harness: Harness | null =
        hStr === "devin" || hStr === "antigravity" || hStr === "opencode"
          ? hStr
          : toolName === "delegate-devin"
            ? "devin"
            : null
      list.push({
        call_id: callId,
        seq: msg.seq,
        child_session_id: childId,
        mode,
        agent: asStr(input.agent),
        harness,
        prompt: asStr(input.prompt),
      })
      callsByChild.set(childId, list)
    }
  }

  const turns: DelegationTurnRow[] = []

  for (const child of childSessions) {
    const childMsgs = childMessagesById.get(child.id) ?? []
    const stops = segmentChildStops(childMsgs, child.idle_outcome)
    const parentCalls = callsByChild.get(child.id) ?? []
    const kv = kvByChildId.get(child.id)
    const resolvedHarness = normalizeHarness(
      kv?.harness ?? parentCalls[0]?.harness ?? null,
      child.agent ?? kv?.agent,
      child.title ?? kv?.title,
      child.provider_id,
    )
    const resolvedModel = kv?.confirmed_model ?? kv?.model ?? child.model_id ?? null
    const resolvedAgent = child.agent ?? kv?.agent ?? parentCalls[0]?.agent ?? null
    const foreignSessionId = kv?.foreign_session_id ?? null

    if (stops.length === 0) {
      const callFact = parentCalls[0]
      turns.push({
        parent_session_id: parentSessionId,
        call_id: callFact?.call_id ?? kv?.call_id ?? `parent:${child.id}`,
        turn_index: 0,
        child_session_id: child.id,
        mode: callFact?.mode ?? "spawn",
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: 0,
        end_seq: 0,
        start_message_id: "",
        end_message_id: "",
        reported_outcome: normalizeReportedOutcome(child.idle_outcome),
        verified_outcome: "empty_output",
        blocker_summary: null,
        tool_error_count: 0,
        tool_completed_count: 0,
        text_char_count: 0,
        prompt_blob: callFact?.prompt ? sinkText(callFact.prompt) : null,
        response_blob: null,
        source_origin: sourceOrigin,
      })
      continue
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i]!
      const callFact = parentCalls[i]
      const callId = callFact?.call_id ?? kv?.call_id ?? `turn:${child.id}:${i}`
      const mode: "spawn" | "send" | "continue" =
        i === 0 ? "spawn" : (callFact?.mode ?? "send")
      const promptText = stop.prompt_text || callFact?.prompt || ""
      const responseText = stop.response_text || ""

      turns.push({
        parent_session_id: parentSessionId,
        call_id: callId,
        turn_index: i,
        child_session_id: child.id,
        mode,
        harness: resolvedHarness,
        agent: resolvedAgent,
        model: resolvedModel,
        foreign_session_id: foreignSessionId,
        start_seq: stop.start_seq,
        end_seq: stop.end_seq,
        start_message_id: stop.start_message_id,
        end_message_id: stop.end_message_id,
        reported_outcome: stop.reported_outcome,
        verified_outcome: stop.verified_outcome,
        blocker_summary: stop.blocker_summary,
        tool_error_count: stop.tool_error_count,
        tool_completed_count: stop.tool_completed_count,
        text_char_count: stop.text_char_count,
        prompt_blob: promptText.length > 0 ? sinkText(promptText) : null,
        response_blob: responseText.length > 0 ? sinkText(responseText) : null,
        source_origin: sourceOrigin,
      })
    }
  }

  return turns
}

export function resolveShadowRepoDir(
  snapshotRootDir: string,
  projectId: string,
  directory: string,
): string | null {
  const worktreeHash = sha1hex(directory)
  const primary = path.join(snapshotRootDir, projectId, worktreeHash)
  if (existsSync(path.join(primary, "objects"))) return primary

  const legacy = path.join(snapshotRootDir, projectId)
  if (existsSync(path.join(legacy, "objects"))) return legacy

  const projectSnapDir = path.join(snapshotRootDir, projectId)
  if (existsSync(projectSnapDir) && statSync(projectSnapDir).isDirectory()) {
    for (const sub of readdirSync(projectSnapDir)) {
      const candidate = path.join(projectSnapDir, sub)
      if (existsSync(path.join(candidate, "objects"))) return candidate
    }
  }
  return null
}

export function batchExtractGitBlobs(
  shadowRepoDir: string,
  specs: readonly string[],
  sinkBuffer: (content: Buffer) => string,
): Map<string, { readonly gitBlobSha: string; readonly blobSha256: string; readonly byteLen: number }> {
  const result = new Map<string, { readonly gitBlobSha: string; readonly blobSha256: string; readonly byteLen: number }>()
  if (specs.length === 0) return result

  const uniqueSpecs = [...new Set(specs)]
  const proc = Bun.spawnSync(["git", `--git-dir=${shadowRepoDir}`, "cat-file", "--batch"], {
    stdin: Buffer.from(uniqueSpecs.join("\n") + "\n"),
  })
  if (proc.exitCode !== 0) {
    return result
  }

  const out = Buffer.from(proc.stdout)
  let offset = 0
  const sha256ByGitSha = new Map<string, string>()

  for (const spec of uniqueSpecs) {
    const nl = out.indexOf(0x0a, offset)
    if (nl === -1) break
    const header = out.subarray(offset, nl).toString("utf8")
    offset = nl + 1
    if (header.endsWith(" missing")) {
      continue
    }
    const parts = header.split(" ")
    const gitBlobSha = parts[0] ?? ""
    const size = parseInt(parts[2] ?? "0", 10)
    const content = out.subarray(offset, offset + size)
    offset += size + 1

    let blobSha256 = sha256ByGitSha.get(gitBlobSha)
    if (!blobSha256) {
      blobSha256 = sinkBuffer(content)
      sha256ByGitSha.set(gitBlobSha, blobSha256)
    }
    result.set(spec, {
      gitBlobSha,
      blobSha256,
      byteLen: content.length,
    })
  }

  return result
}

export function sinkShadowSnapshots(
  sessions: readonly HostSessionRow[],
  messagesBySession: ReadonlyMap<string, readonly HostMessageRow[]>,
  snapshotRootDir: string,
  sinkBuffer: (content: Buffer) => string,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): SnapshotArtifactRow[] {
  interface PendingSnapshotItem {
    readonly session_id: string
    readonly message_id: string
    readonly seq: number
    readonly path: string
    readonly start_tree_sha: string
    readonly end_tree_sha: string
    readonly start_spec: string
    readonly end_spec: string
  }

  const itemsByRepo = new Map<string, PendingSnapshotItem[]>()

  for (const session of sessions) {
    const shadowRepo = resolveShadowRepoDir(snapshotRootDir, session.project_id, session.directory)
    if (!shadowRepo) continue
    const msgs = messagesBySession.get(session.id) ?? []
    for (const msg of msgs) {
      if (msg.type !== "assistant") continue
      const snap = asObj(msg.data.snapshot)
      const startTree = asStr(snap.start)
      const endTree = asStr(snap.end)
      const files = asArr(snap.files)
      if (!startTree || !endTree || files.length === 0) continue

      let list = itemsByRepo.get(shadowRepo)
      if (!list) {
        list = []
        itemsByRepo.set(shadowRepo, list)
      }
      for (const rawFile of files) {
        const filePath = asStr(rawFile)
        if (!filePath) continue
        list.push({
          session_id: session.id,
          message_id: msg.id,
          seq: msg.seq,
          path: filePath,
          start_tree_sha: startTree,
          end_tree_sha: endTree,
          start_spec: `${startTree}:${filePath}`,
          end_spec: `${endTree}:${filePath}`,
        })
      }
    }
  }

  const artifacts: SnapshotArtifactRow[] = []
  for (const [shadowRepo, items] of itemsByRepo) {
    const allSpecs: string[] = []
    for (const item of items) {
      allSpecs.push(item.start_spec, item.end_spec)
    }
    const resolved = batchExtractGitBlobs(shadowRepo, allSpecs, sinkBuffer)
    for (const item of items) {
      const startBlob = resolved.get(item.start_spec)
      const endBlob = resolved.get(item.end_spec)
      if (!startBlob && !endBlob) continue
      artifacts.push({
        session_id: item.session_id,
        message_id: item.message_id,
        seq: item.seq,
        path: item.path,
        start_tree_sha: item.start_tree_sha,
        end_tree_sha: item.end_tree_sha,
        start_blob_sha: startBlob?.blobSha256 ?? null,
        end_blob_sha: endBlob?.blobSha256 ?? null,
        start_git_blob_sha: startBlob?.gitBlobSha ?? null,
        end_git_blob_sha: endBlob?.gitBlobSha ?? null,
        start_byte_len: startBlob?.byteLen ?? null,
        end_byte_len: endBlob?.byteLen ?? null,
        byte_len: endBlob?.byteLen ?? startBlob?.byteLen ?? 0,
        source_origin: sourceOrigin,
      })
    }
  }

  return artifacts
}

const SPILL_PATH_REGEX = /full output saved to[:\s]+([^\s\]\n"']+)/i

export function sinkExternalSpills(
  sessions: readonly HostSessionRow[],
  messagesBySession: ReadonlyMap<string, readonly HostMessageRow[]>,
  opencodeDataDir: string,
  sinkBuffer: (content: Buffer) => string,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): SpillArtifactRow[] {
  const spills: SpillArtifactRow[] = []

  for (const session of sessions) {
    const msgs = messagesBySession.get(session.id) ?? []
    for (const msg of msgs) {
      if (msg.type !== "assistant") continue
      for (const rawPart of asArr(msg.data.content)) {
        const part = asObj(rawPart)
        if (part.type !== "tool") continue
        const callId = asStr(part.id) ?? ""
        const toolName = asStr(part.name) ?? "tool"
        const state = asObj(part.state)
        const meta = asObj(state.metadata)
        const inlineText = asArr(state.content)
          .flatMap((c) => {
            const obj = asObj(c)
            return typeof obj.text === "string" ? [obj.text] : []
          })
          .join("")

        const candidates: Array<{ path: string; kind: "tool-output" | "shell" }> = []
        const metaPath = asStr(meta.outputPath)
        if (metaPath) {
          candidates.push({
            path: metaPath,
            kind: metaPath.includes("/shell/") ? "shell" : "tool-output",
          })
        }

        const regexMatch = inlineText.match(SPILL_PATH_REGEX)
        if (regexMatch?.[1]) {
          const matchedPath = regexMatch[1]
          candidates.push({
            path: matchedPath,
            kind: matchedPath.includes("/shell/") ? "shell" : "tool-output",
          })
        }

        if (callId.length > 0) {
          const cleanId = callId.replace(/^tool_/, "")
          candidates.push(
            {
              path: path.join(opencodeDataDir, "tool-output", `tool_${cleanId}`),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, "tool-output", callId),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, "shell", `${callId}.txt`),
              kind: "shell",
            },
            {
              path: path.join(opencodeDataDir, "shell", session.project_id, `${callId}.out`),
              kind: "shell",
            },
          )
        }

        for (const cand of candidates) {
          if (existsSync(cand.path) && statSync(cand.path).isFile()) {
            const bytes = readFileSync(cand.path)
            const blobSha = sinkBuffer(bytes)
            spills.push({
              session_id: session.id,
              call_id: callId || path.basename(cand.path),
              message_id: msg.id,
              seq: msg.seq,
              tool_name: toolName,
              spill_kind: cand.kind,
              spill_source: cand.path,
              inline_byte_len: Buffer.byteLength(inlineText, "utf8"),
              full_byte_len: bytes.length,
              blob_sha: blobSha,
              source_origin: sourceOrigin,
            })
            break
          }
        }
      }
    }
  }

  return spills
}

const SPINE_DDL = `
CREATE TABLE IF NOT EXISTS kv_binding (
  child_session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  driver_kind TEXT,
  harness TEXT,
  foreign_session_id TEXT,
  parent_session_id TEXT,
  call_id TEXT,
  title TEXT,
  cwd TEXT,
  agent TEXT,
  model TEXT,
  effort TEXT,
  mode TEXT,
  background INTEGER,
  requested_model TEXT,
  confirmed_model TEXT,
  confirmed_effort TEXT,
  turn INTEGER,
  phase TEXT,
  foreign_ack_turn INTEGER,
  foreign_ack_stop_reason TEXT,
  serving_witness_model TEXT,
  serving_witness_at TEXT,
  consumed_inputs_json TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  source_origin TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_foreign_index (
  harness TEXT NOT NULL,
  foreign_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  PRIMARY KEY (harness, foreign_session_id)
);

CREATE TABLE IF NOT EXISTS kv_context_prune (
  session_id TEXT PRIMARY KEY,
  raw_key TEXT NOT NULL,
  scope TEXT,
  mode TEXT,
  anchor_message_id TEXT,
  recorded_at TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS delegation_turn (
  parent_session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  child_session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  harness TEXT NOT NULL,
  agent TEXT,
  model TEXT,
  foreign_session_id TEXT,
  start_seq INTEGER NOT NULL,
  end_seq INTEGER NOT NULL,
  start_message_id TEXT NOT NULL,
  end_message_id TEXT NOT NULL,
  reported_outcome TEXT,
  verified_outcome TEXT NOT NULL,
  blocker_summary TEXT,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  tool_completed_count INTEGER NOT NULL DEFAULT 0,
  text_char_count INTEGER NOT NULL DEFAULT 0,
  prompt_blob TEXT,
  response_blob TEXT,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (parent_session_id, call_id, turn_index)
);

CREATE TABLE IF NOT EXISTS snapshot_artifact (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  path TEXT NOT NULL,
  start_tree_sha TEXT NOT NULL,
  end_tree_sha TEXT NOT NULL,
  start_blob_sha TEXT,
  end_blob_sha TEXT,
  start_git_blob_sha TEXT,
  end_git_blob_sha TEXT,
  start_byte_len INTEGER,
  end_byte_len INTEGER,
  byte_len INTEGER NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, message_id, path)
);

CREATE TABLE IF NOT EXISTS spill_artifact (
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  spill_kind TEXT NOT NULL,
  spill_source TEXT NOT NULL,
  inline_byte_len INTEGER NOT NULL,
  full_byte_len INTEGER NOT NULL,
  blob_sha TEXT NOT NULL,
  source_origin TEXT NOT NULL DEFAULT 'host_db',
  PRIMARY KEY (session_id, call_id)
);
`

export function writeSpineSqlite(
  sqlitePath: string,
  data: {
    readonly bindings: readonly KvBindingRow[]
    readonly foreignIndex: readonly KvForeignIndexRow[]
    readonly contextPrunes: readonly KvContextPruneRow[]
    readonly delegationTurns: readonly DelegationTurnRow[]
    readonly snapshotArtifacts: readonly SnapshotArtifactRow[]
    readonly spillArtifacts: readonly SpillArtifactRow[]
  },
): void {
  mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec(SPINE_DDL)

  const tx = db.transaction(() => {
    db.exec("DELETE FROM kv_binding")
    db.exec("DELETE FROM kv_foreign_index")
    db.exec("DELETE FROM kv_context_prune")
    db.exec("DELETE FROM delegation_turn")
    db.exec("DELETE FROM snapshot_artifact")
    db.exec("DELETE FROM spill_artifact")

    const insBinding = db.query(`
      INSERT OR REPLACE INTO kv_binding (
        child_session_id, raw_key, scope, driver_kind, harness, foreign_session_id,
        parent_session_id, call_id, title, cwd, agent, model, effort, mode, background,
        requested_model, confirmed_model, confirmed_effort, turn, phase,
        foreign_ack_turn, foreign_ack_stop_reason, serving_witness_model, serving_witness_at,
        consumed_inputs_json, created_at, updated_at, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const b of data.bindings) {
      insBinding.run(
        b.child_session_id,
        b.raw_key,
        b.scope,
        b.driver_kind,
        b.harness,
        b.foreign_session_id,
        b.parent_session_id,
        b.call_id,
        b.title,
        b.cwd,
        b.agent,
        b.model,
        b.effort,
        b.mode,
        b.background === null ? null : b.background ? 1 : 0,
        b.requested_model,
        b.confirmed_model,
        b.confirmed_effort,
        b.turn,
        b.phase,
        b.foreign_ack_turn,
        b.foreign_ack_stop_reason,
        b.serving_witness_model,
        b.serving_witness_at,
        b.consumed_inputs_json,
        b.created_at,
        b.updated_at,
        b.source_origin,
      )
    }

    const insForeign = db.query(`
      INSERT OR REPLACE INTO kv_foreign_index (harness, foreign_session_id, child_session_id, raw_key)
      VALUES (?, ?, ?, ?)
    `)
    for (const f of data.foreignIndex) {
      insForeign.run(f.harness, f.foreign_session_id, f.child_session_id, f.raw_key)
    }

    const insPrune = db.query(`
      INSERT OR REPLACE INTO kv_context_prune (session_id, raw_key, scope, mode, anchor_message_id, recorded_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of data.contextPrunes) {
      insPrune.run(p.session_id, p.raw_key, p.scope, p.mode, p.anchor_message_id, p.recorded_at, p.updated_at)
    }

    const insTurn = db.query(`
      INSERT OR REPLACE INTO delegation_turn (
        parent_session_id, call_id, turn_index, child_session_id, mode, harness,
        agent, model, foreign_session_id, start_seq, end_seq, start_message_id, end_message_id,
        reported_outcome, verified_outcome, blocker_summary,
        tool_error_count, tool_completed_count, text_char_count,
        prompt_blob, response_blob, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const t of data.delegationTurns) {
      insTurn.run(
        t.parent_session_id,
        t.call_id,
        t.turn_index,
        t.child_session_id,
        t.mode,
        t.harness,
        t.agent,
        t.model,
        t.foreign_session_id,
        t.start_seq,
        t.end_seq,
        t.start_message_id,
        t.end_message_id,
        t.reported_outcome,
        t.verified_outcome,
        t.blocker_summary,
        t.tool_error_count,
        t.tool_completed_count,
        t.text_char_count,
        t.prompt_blob,
        t.response_blob,
        t.source_origin,
      )
    }

    const insSnap = db.query(`
      INSERT OR REPLACE INTO snapshot_artifact (
        session_id, message_id, seq, path, start_tree_sha, end_tree_sha,
        start_blob_sha, end_blob_sha, start_git_blob_sha, end_git_blob_sha,
        start_byte_len, end_byte_len, byte_len, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const s of data.snapshotArtifacts) {
      insSnap.run(
        s.session_id,
        s.message_id,
        s.seq,
        s.path,
        s.start_tree_sha,
        s.end_tree_sha,
        s.start_blob_sha,
        s.end_blob_sha,
        s.start_git_blob_sha,
        s.end_git_blob_sha,
        s.start_byte_len,
        s.end_byte_len,
        s.byte_len,
        s.source_origin,
      )
    }

    const insSpill = db.query(`
      INSERT OR REPLACE INTO spill_artifact (
        session_id, call_id, message_id, seq, tool_name, spill_kind,
        spill_source, inline_byte_len, full_byte_len, blob_sha, source_origin
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const sp of data.spillArtifacts) {
      insSpill.run(
        sp.session_id,
        sp.call_id,
        sp.message_id,
        sp.seq,
        sp.tool_name,
        sp.spill_kind,
        sp.spill_source,
        sp.inline_byte_len,
        sp.full_byte_len,
        sp.blob_sha,
        sp.source_origin,
      )
    }
  })

  tx()
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()
}

export function createDiskBlobSinker(blobDir: string): {
  readonly sinkText: (text: string) => string
  readonly sinkBuffer: (buf: Buffer) => string
  readonly blobsWritten: () => number
} {
  mkdirSync(blobDir, { recursive: true })
  const seen = new Set<string>()
  let writtenCount = 0

  const sinkBuffer = (buf: Buffer): string => {
    const sha = sha256hex(buf)
    if (!seen.has(sha)) {
      seen.add(sha)
      const target = path.join(blobDir, `${sha}.txt`)
      if (!existsSync(target)) {
        writeFileSync(target, buf)
        writtenCount++
      }
    }
    return sha
  }

  const sinkText = (text: string): string => {
    const sha = sinkBuffer(Buffer.from(text, "utf8"))
    return `blob:${sha}`
  }

  return {
    sinkText,
    sinkBuffer,
    blobsWritten: () => writtenCount,
  }
}

export function buildWfSubR02IllustrativeArtifacts(
  _blobDir: string,
  sinkText: (text: string) => string,
  sinkBuffer: (buf: Buffer) => string,
): {
  readonly bindings: KvBindingRow[]
  readonly foreignIndex: KvForeignIndexRow[]
  readonly contextPrunes: KvContextPruneRow[]
  readonly delegationTurns: DelegationTurnRow[]
  readonly snapshotArtifacts: SnapshotArtifactRow[]
  readonly spillArtifacts: SpillArtifactRow[]
} {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "wf-sub-03-fixture-"))
  try {
    const fixtureSnapParent = path.join(fixtureRoot, "snapshot", "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb")
    const worktreeDir = "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev"
    const fixtureShadowRepo = path.join(fixtureSnapParent, sha1hex(worktreeDir))
    mkdirSync(fixtureShadowRepo, { recursive: true })

    Bun.spawnSync(["git", "init", "--bare", fixtureShadowRepo])

    // Write the 23,314-byte first draft and 24,251-byte second draft of .planning/phases/production-release/SPEC.md
    const draft1Header = "# Production Release Specification (Draft 1 — Uncommitted)\n\n"
    const draft1Body = draft1Header + "A".repeat(23314 - Buffer.byteLength(draft1Header, "utf8"))
    const draft2Header = "# Production Release Specification (Draft 2 — Amended Uncommitted)\n\n"
    const draft2Body = draft2Header + "B".repeat(24251 - Buffer.byteLength(draft2Header, "utf8"))

    const writeTreeWithSpec = (content: string): string => {
      const hashProc = Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "hash-object", "-w", "--stdin"], {
        stdin: Buffer.from(content, "utf8"),
      })
      const blobSha = Buffer.from(hashProc.stdout).toString("utf8").trim()
      const env = { ...process.env, GIT_INDEX_FILE: path.join(fixtureShadowRepo, "temp.index") }
      Bun.spawnSync(
        [
          "git",
          `--git-dir=${fixtureShadowRepo}`,
          "update-index",
          "--add",
          "--cacheinfo",
          `100644,${blobSha},.planning/phases/production-release/SPEC.md`,
        ],
        { env },
      )
      const treeProc = Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "write-tree"], { env })
      return Buffer.from(treeProc.stdout).toString("utf8").trim()
    }

    const emptyEnv = { ...process.env, GIT_INDEX_FILE: path.join(fixtureShadowRepo, "empty.index") }
    const startTree0Proc = Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "write-tree"], { env: emptyEnv })
    const tree0 = Buffer.from(startTree0Proc.stdout).toString("utf8").trim()
    const tree1 = writeTreeWithSpec(draft1Body)
    const tree2 = writeTreeWithSpec(draft2Body)

    // Bind ref aliases 8900ab62, 1590b08d, and 5bc43988 so git cat-file --batch resolves them directly
    Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "update-ref", "refs/tags/8900ab62", tree0])
    Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "update-ref", "refs/tags/1590b08d", tree1])
    Bun.spawnSync(["git", `--git-dir=${fixtureShadowRepo}`, "update-ref", "refs/tags/5bc43988", tree2])

    // Write external spill fixture files in temporary fixtureRoot
    const toolOutDir = path.join(fixtureRoot, "tool-output")
    const shellDir = path.join(fixtureRoot, "shell")
    mkdirSync(toolOutDir, { recursive: true })
    mkdirSync(shellDir, { recursive: true })
    const sampleToolCallId = "call_wf_sub_03_spill_1"
    const sampleShellCallId = "call_wf_sub_03_shell_1"
    const fullToolSpill = "FULL_UNTRUNCATED_TOOL_OUTPUT\n" + "line-content\n".repeat(2100)
    const fullShellSpill = "FULL_UNTRUNCATED_SHELL_OUTPUT\n" + "shell-line\n".repeat(300)
    writeFileSync(path.join(toolOutDir, `tool_${sampleToolCallId}`), fullToolSpill)
    writeFileSync(path.join(shellDir, `${sampleShellCallId}.txt`), fullShellSpill)

    // Build in-memory SQLite fixture with the WF-SUB-R02 illustrative IDs
    const memDb = new Database(":memory:")
    memDb.exec(`
      CREATE TABLE kv (
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (scope, name)
      );
    `)
    const insKv = memDb.query("INSERT INTO kv (scope, name, value) VALUES (?, ?, ?)")
    insKv.run(
      "plugin:hivemind-steward-oc-devin",
      "bindings/v1/ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
      JSON.stringify({
        driverKind: "acp-W",
        harness: "antigravity",
        foreignSessionId: "agy-foreign-ecbb24ca8",
        parentSessionID: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        title: "Antigravity · Multi-stop SPEC review",
        createdAt: 1791874100000,
        updatedAt: 1791874900000,
        cwd: worktreeDir,
        agent: "antigravity-delegate",
        model: "gemini-4-argon-high",
        effort: "high",
        turn: 2,
        phase: "acknowledged",
      }),
    )
    insKv.run(
      "plugin:hivemind-steward-oc-devin",
      "bindings-by-foreign/v1/antigravity/agy-foreign-ecbb24ca8",
      JSON.stringify({
        childSessionID: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
      }),
    )
    insKv.run(
      "plugin:hivemind-steward-oc-devin",
      "delegate-mode/child/ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
      JSON.stringify({
        mode: "send",
        background: true,
        requestedModel: "gemini-4-argon-high",
        confirmedModel: "gemini-4-argon-high",
        confirmedEffort: "high",
        updatedAt: 1791874900000,
      }),
    )
    insKv.run(
      "plugin:context-prune",
      "session:ses_ecbfc0f40ffenfykTrNGoMS6o1:context-prune:ses_ecbfc0f40ffenfykTrNGoMS6o1",
      JSON.stringify({
        mode: "recent",
        anchor: "msg_1340ebfb4001z58U5O2P8y2X0T",
        at: "2026-10-18T08:00:00.000Z",
      }),
    )

    const fixtureSessions: HostSessionRow[] = [
      {
        id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        project_id: "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb",
        parent_id: null,
        directory: worktreeDir,
        title: "Production-ready bilingual GitHub release handoff",
        agent: "build",
        model_id: "gpt-6.1-sol",
        provider_id: "openai",
        variant: "xhigh",
        idle_outcome: "succeeded",
        time_created: 1791874000000,
        time_updated: 1791875000000,
      },
      {
        id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
        project_id: "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb",
        parent_id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        directory: worktreeDir,
        title: "Antigravity · Multi-stop SPEC review",
        agent: "antigravity-delegate",
        model_id: "gemini-4-argon-high",
        provider_id: "antigravity-native",
        variant: "high",
        idle_outcome: "succeeded",
        time_created: 1791874100000,
        time_updated: 1791874900000,
      },
      {
        id: "ses_ecb8ab382ffe6D8z1uA2jQ7sT4",
        project_id: "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb",
        parent_id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        directory: worktreeDir,
        title: "Antigravity · Context7 MCP timeout child",
        agent: "antigravity-delegate",
        model_id: "gemini-4-argon-high",
        provider_id: "antigravity-native",
        variant: "high",
        idle_outcome: "succeeded",
        time_created: 1791874200000,
        time_updated: 1791874300000,
      },
      {
        id: "ses_ecba9633effe9G0n4tP1kL5wR2",
        project_id: "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb",
        parent_id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        directory: worktreeDir,
        title: "Antigravity · Tavily MCP failure child",
        agent: "antigravity-delegate",
        model_id: "gemini-4-argon-high",
        provider_id: "antigravity-native",
        variant: "high",
        idle_outcome: "succeeded",
        time_created: 1791874300000,
        time_updated: 1791874400000,
      },
      {
        id: "ses_eb1f7e38dffeqA9W0cM5xN8pL1",
        project_id: "ef76d91bc2a2fa8daffdb1a93a677e457792e8bb",
        parent_id: "ses_eb23bfbf0ffesn5kT0yJI06h35",
        directory: worktreeDir,
        title: "Antigravity · Read lease violation child",
        agent: "antigravity-delegate",
        model_id: "gemini-4-argon-high",
        provider_id: "antigravity-native",
        variant: "high",
        idle_outcome: "succeeded",
        time_created: 1791874400000,
        time_updated: 1791874500000,
      },
    ]

    const fixtureSessionMap = new Map(fixtureSessions.map((s) => [s.id, s]))
    const kvRes = ingestHostKv(memDb, fixtureSessionMap, "wf_sub_r02_fixture")
    memDb.close()

    const parentMsgs: HostMessageRow[] = [
      {
        id: "msg_1340ebfb4001z58U5O2P8y2X0T",
        session_id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        type: "assistant",
        seq: 100,
        time_created: 1791874050000,
        time_updated: 1791874050000,
        data: {
          agent: "build",
          snapshot: {
            start: "8900ab62",
            end: "1590b08d",
            files: [".planning/phases/production-release/SPEC.md"],
          },
          content: [
            {
              type: "tool",
              id: "call_spawn_ecbb24ca8",
              name: "hivemind-delegate",
              state: {
                status: "completed",
                input: {
                  agent: "antigravity-delegate",
                  harness: "antigravity",
                  prompt: "Review initial SPEC.md draft",
                },
                metadata: {
                  sessionID: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
                },
              },
            },
            {
              type: "tool",
              id: sampleToolCallId,
              name: "webfetch",
              state: {
                status: "completed",
                content: [{ type: "text", text: "Truncated preview..." }],
                metadata: {
                  truncated: true,
                  outputPath: path.join(toolOutDir, `tool_${sampleToolCallId}`),
                },
              },
            },
            {
              type: "tool",
              id: sampleShellCallId,
              name: "shell",
              state: {
                status: "completed",
                content: [{ type: "text", text: "Truncated shell preview..." }],
                metadata: {
                  truncated: true,
                },
              },
            },
          ],
        },
      },
      {
        id: "msg_1342b88cc001C1m4L9U2p5B8v0",
        session_id: "ses_ecbfc0f40ffenfykTrNGoMS6o1",
        type: "assistant",
        seq: 200,
        time_created: 1791874500000,
        time_updated: 1791874500000,
        data: {
          agent: "build",
          snapshot: {
            start: "1590b08d",
            end: "5bc43988",
            files: [".planning/phases/production-release/SPEC.md"],
          },
          content: [
            {
              type: "tool",
              id: "call_send_ecbb24ca8",
              name: "hivemind-delegate",
              state: {
                status: "completed",
                input: {
                  sessionID: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
                  agent: "antigravity-delegate",
                  harness: "antigravity",
                  prompt: "Verify amended SPEC.md draft",
                },
                metadata: {
                  sessionID: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
                },
              },
            },
          ],
        },
      },
    ]

    const childMessagesById = new Map<string, HostMessageRow[]>([
      ["ses_ecbfc0f40ffenfykTrNGoMS6o1", parentMsgs],
      [
        "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
        [
          {
            id: "msg_1340f258a001xL47zK6w3nK0E0",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "user",
            seq: 1,
            time_created: 1791874101000,
            time_updated: 1791874101000,
            data: { text: "Stop 1 spawn prompt: Review initial SPEC.md draft" },
          },
          {
            id: "msg_1340f9999001assistantStop1",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "assistant",
            seq: 2,
            time_created: 1791874150000,
            time_updated: 1791874150000,
            data: {
              content: [
                { type: "tool", id: "call_read_spec_1", name: "read", state: { status: "completed" } },
                { type: "text", text: "Initial SPEC.md review complete: 2 findings noted." },
              ],
            },
          },
          {
            id: "msg_13410efbb001I29K7gX3C5U363",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "idle",
            seq: 3,
            time_created: 1791874200000,
            time_updated: 1791874200000,
            data: { outcome: "succeeded" },
          },
          {
            id: "msg_1342be5250016yR75p270S30F6",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "user",
            seq: 4,
            time_created: 1791874600000,
            time_updated: 1791874600000,
            data: { text: "Stop 2 send prompt: Verify amended SPEC.md draft" },
          },
          {
            id: "msg_1342c9999001assistantStop2",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "assistant",
            seq: 5,
            time_created: 1791874700000,
            time_updated: 1791874700000,
            data: {
              content: [
                { type: "tool", id: "call_read_spec_2", name: "read", state: { status: "completed" } },
                { type: "text", text: "Amended SPEC.md verified: all findings resolved." },
              ],
            },
          },
          {
            id: "msg_1342dc0310018q5M1K3r0H4W8G",
            session_id: "ses_ecbb24ca8ffeFd8wX7v0a9iY0j",
            type: "idle",
            seq: 6,
            time_created: 1791874800000,
            time_updated: 1791874800000,
            data: { outcome: "succeeded" },
          },
        ],
      ],
      [
        "ses_ecb8ab382ffe6D8z1uA2jQ7sT4",
        [
          {
            id: "msg_ecb8ab382_u1",
            session_id: "ses_ecb8ab382ffe6D8z1uA2jQ7sT4",
            type: "user",
            seq: 1,
            time_created: 1791874201000,
            time_updated: 1791874201000,
            data: { text: "Query context7 docs" },
          },
          {
            id: "msg_ecb8ab382_a1",
            session_id: "ses_ecb8ab382ffe6D8z1uA2jQ7sT4",
            type: "assistant",
            seq: 2,
            time_created: 1791874250000,
            time_updated: 1791874250000,
            data: {
              content: [{ type: "text", text: "BLOCKED — MCP tool call failed: MCP server context7 timed out" }],
            },
          },
          {
            id: "msg_ecb8ab382_i1",
            session_id: "ses_ecb8ab382ffe6D8z1uA2jQ7sT4",
            type: "idle",
            seq: 3,
            time_created: 1791874260000,
            time_updated: 1791874260000,
            data: { outcome: "succeeded" },
          },
        ],
      ],
      [
        "ses_ecba9633effe9G0n4tP1kL5wR2",
        [
          {
            id: "msg_ecba9633e_u1",
            session_id: "ses_ecba9633effe9G0n4tP1kL5wR2",
            type: "user",
            seq: 1,
            time_created: 1791874301000,
            time_updated: 1791874301000,
            data: { text: "Search web via tavily" },
          },
          {
            id: "msg_ecba9633e_a1",
            session_id: "ses_ecba9633effe9G0n4tP1kL5wR2",
            type: "assistant",
            seq: 2,
            time_created: 1791874350000,
            time_updated: 1791874350000,
            data: {
              content: [
                {
                  type: "text",
                  text: "The tavily-search MCP tool failed with an error; no web results were retrieved",
                },
              ],
            },
          },
          {
            id: "msg_ecba9633e_i1",
            session_id: "ses_ecba9633effe9G0n4tP1kL5wR2",
            type: "idle",
            seq: 3,
            time_created: 1791874360000,
            time_updated: 1791874360000,
            data: { outcome: "succeeded" },
          },
        ],
      ],
      [
        "ses_eb1f7e38dffeqA9W0cM5xN8pL1",
        [
          {
            id: "msg_eb1f7e38d_u1",
            session_id: "ses_eb1f7e38dffeqA9W0cM5xN8pL1",
            type: "user",
            seq: 1,
            time_created: 1791874401000,
            time_updated: 1791874401000,
            data: { text: "Read outside-worktree prompt doc" },
          },
          {
            id: "msg_eb1f7e38d_a1",
            session_id: "ses_eb1f7e38dffeqA9W0cM5xN8pL1",
            type: "assistant",
            seq: 2,
            time_created: 1791874450000,
            time_updated: 1791874450000,
            data: {
              content: [{ type: "text", text: "BLOCKED: read lease violation / missing file" }],
            },
          },
          {
            id: "msg_eb1f7e38d_i1",
            session_id: "ses_eb1f7e38dffeqA9W0cM5xN8pL1",
            type: "idle",
            seq: 3,
            time_created: 1791874460000,
            time_updated: 1791874460000,
            data: { outcome: "succeeded" },
          },
        ],
      ],
    ])

    const kvByChildId = new Map(kvRes.bindings.map((b) => [b.child_session_id, b]))
    const p1Turns = normalizeDelegationTurns(
      "ses_ecbfc0f40ffenfykTrNGoMS6o1",
      parentMsgs,
      fixtureSessions.filter((s) => s.parent_id === "ses_ecbfc0f40ffenfykTrNGoMS6o1"),
      childMessagesById,
      kvByChildId,
      sinkText,
      "wf_sub_r02_fixture",
    )
    const p2Turns = normalizeDelegationTurns(
      "ses_eb23bfbf0ffesn5kT0yJI06h35",
      [],
      fixtureSessions.filter((s) => s.parent_id === "ses_eb23bfbf0ffesn5kT0yJI06h35"),
      childMessagesById,
      kvByChildId,
      sinkText,
      "wf_sub_r02_fixture",
    )

    const snapshotArtifacts = sinkShadowSnapshots(
      [fixtureSessions[0]!],
      childMessagesById,
      path.join(fixtureRoot, "snapshot"),
      sinkBuffer,
      "wf_sub_r02_fixture",
    )

    const spillArtifacts = sinkExternalSpills(
      [fixtureSessions[0]!],
      childMessagesById,
      fixtureRoot,
      sinkBuffer,
      "wf_sub_r02_fixture",
    )

    return {
      bindings: kvRes.bindings,
      foreignIndex: kvRes.foreignIndex,
      contextPrunes: kvRes.contextPrunes,
      delegationTurns: [...p1Turns, ...p2Turns],
      snapshotArtifacts,
      spillArtifacts,
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

export interface SpinePrototypeReport {
  readonly sqlitePath: string
  readonly blobDir: string
  readonly elapsedMs: number
  readonly hostKvBindingsCount: number
  readonly hostKvForeignIndexCount: number
  readonly hostKvContextPrunesCount: number
  readonly totalDelegationTurnsCount: number
  readonly multiStopChildrenCount: number
  readonly p1p2AntigravityChildrenCount: number
  readonly p1p2AntigravityFalsePositivesCount: number
  readonly p1p2AntigravityFalsePositiveIds: readonly string[]
  readonly archiveChildrenEvaluatedCount: number
  readonly snapshotArtifactsCount: number
  readonly spillArtifactsCount: number
  readonly blobsWrittenCount: number
}

export function runSpineIngestionPrototype(options?: {
  readonly hostDbPath?: string
  readonly stewardArchiveDbPath?: string
  readonly opencodeDataDir?: string
  readonly targetSqlitePath?: string
  readonly targetBlobDir?: string
}): SpinePrototypeReport {
  const t0 = performance.now()
  const opencodeDataDir = options?.opencodeDataDir ?? "/Users/MAC/.local/share/opencode"
  const hostDbPath = options?.hostDbPath ?? path.join(opencodeDataDir, "opencode.db")
  const stewardArchiveDbPath =
    options?.stewardArchiveDbPath ??
    "/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite"
  const targetSqlitePath =
    options?.targetSqlitePath ??
    "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-spine.sqlite"
  const targetBlobDir =
    options?.targetBlobDir ??
    "/Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-03-blobs"

  const sinker = createDiskBlobSinker(targetBlobDir)
  const hostDb = new Database(hostDbPath, { readonly: true })

  // 1. Load sessions from opencode.db
  const allSessionsMap = readHostSessions(hostDb)

  // 2. Ingest host kv table
  const hostKv = ingestHostKv(hostDb, allSessionsMap, "host_db")
  const kvByChildId = new Map(hostKv.bindings.map((b) => [b.child_session_id, b]))

  // 3. Determine root sessions to process:
  //    - ses_ecbfc0f40ffenfykTrNGoMS6o1
  //    - ses_eb23bfbf0ffesn5kT0yJI06h35
  //    - All root sessions in the manifested steward archive
  const rootIds = new Set<string>(["ses_ecbfc0f40ffenfykTrNGoMS6o1", "ses_eb23bfbf0ffesn5kT0yJI06h35"])
  if (existsSync(stewardArchiveDbPath)) {
    const archiveDb = new Database(stewardArchiveDbPath, { readonly: true })
    const archiveRoots = archiveDb
      .query("SELECT DISTINCT root_id FROM session")
      .all() as Array<{ root_id: string }>
    for (const r of archiveRoots) rootIds.add(r.root_id)
    archiveDb.close()
  }

  const targetSessions = new Map<string, HostSessionRow>()
  const childrenByParent = new Map<string, HostSessionRow[]>()

  for (const rootId of rootIds) {
    const rootRow = allSessionsMap.get(rootId)
    if (rootRow) targetSessions.set(rootId, rootRow)
  }
  for (const s of allSessionsMap.values()) {
    if (s.parent_id && rootIds.has(s.parent_id)) {
      targetSessions.set(s.id, s)
      const list = childrenByParent.get(s.parent_id) ?? []
      list.push(s)
      childrenByParent.set(s.parent_id, list)
    }
  }

  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.time_created - b.time_created || a.id.localeCompare(b.id))
  }

  // Load messages for all target roots and their children
  const messagesBySession = new Map<string, HostMessageRow[]>()
  const msgQuery = hostDb.query(
    "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq",
  )
  for (const sid of targetSessions.keys()) {
    const rows = msgQuery.all(sid) as Array<{
      id: string
      session_id: string
      type: string
      seq: number
      time_created: number
      time_updated: number
      data: string
    }>
    messagesBySession.set(
      sid,
      rows.map((r) => ({
        ...r,
        data: parseJsonObject(r.data),
      })),
    )
  }

  // 4. Normalize multi-stop delegation turns across all target roots
  const hostDelegationTurns: DelegationTurnRow[] = []
  for (const rootId of rootIds) {
    const parentMsgs = messagesBySession.get(rootId) ?? []
    const children = childrenByParent.get(rootId) ?? []
    const turns = normalizeDelegationTurns(
      rootId,
      parentMsgs,
      children,
      messagesBySession,
      kvByChildId,
      sinker.sinkText,
      "host_db",
    )
    hostDelegationTurns.push(...turns)
  }

  // 5. Sink shadow snapshot file blobs and external spills for all target sessions
  const targetSessionList = [...targetSessions.values()]
  const hostSnapshotArtifacts = sinkShadowSnapshots(
    targetSessionList,
    messagesBySession,
    path.join(opencodeDataDir, "snapshot"),
    sinker.sinkBuffer,
    "host_db",
  )
  const hostSpillArtifacts = sinkExternalSpills(
    targetSessionList,
    messagesBySession,
    opencodeDataDir,
    sinker.sinkBuffer,
    "host_db",
  )

  hostDb.close()

  // 6. Also run the exact same pipeline on the WF-SUB-R02 illustrative fixture set
  const fixtureRes = buildWfSubR02IllustrativeArtifacts(targetBlobDir, sinker.sinkText, sinker.sinkBuffer)

  const allBindings = [...hostKv.bindings, ...fixtureRes.bindings]
  const allForeignIndex = [...hostKv.foreignIndex, ...fixtureRes.foreignIndex]
  const allContextPrunes = [...hostKv.contextPrunes, ...fixtureRes.contextPrunes]
  const allDelegationTurns = [...hostDelegationTurns, ...fixtureRes.delegationTurns]
  const allSnapshotArtifacts = [...hostSnapshotArtifacts, ...fixtureRes.snapshotArtifacts]
  const allSpillArtifacts = [...hostSpillArtifacts, ...fixtureRes.spillArtifacts]

  writeSpineSqlite(targetSqlitePath, {
    bindings: allBindings,
    foreignIndex: allForeignIndex,
    contextPrunes: allContextPrunes,
    delegationTurns: allDelegationTurns,
    snapshotArtifacts: allSnapshotArtifacts,
    spillArtifacts: allSpillArtifacts,
  })

  // Compute P1 + P2 Antigravity false-positive metrics from host_db
  const p1p2ParentIds = new Set(["ses_ecbfc0f40ffenfykTrNGoMS6o1", "ses_eb23bfbf0ffesn5kT0yJI06h35"])
  const p1p2AgByChild = new Map<string, DelegationTurnRow[]>()
  for (const t of hostDelegationTurns) {
    if (!p1p2ParentIds.has(t.parent_session_id) || t.harness !== "antigravity") continue
    const list = p1p2AgByChild.get(t.child_session_id) ?? []
    list.push(t)
    p1p2AgByChild.set(t.child_session_id, list)
  }

  const falsePositiveIds: string[] = []
  for (const [childId, turns] of p1p2AgByChild) {
    const isFp = turns.some(
      (t) =>
        t.reported_outcome === "succeeded" &&
        (t.verified_outcome === "tool_error_inside" ||
          t.verified_outcome === "blocked_in_text" ||
          t.verified_outcome === "empty_output"),
    )
    if (isFp) falsePositiveIds.push(childId)
  }

  const turnsByChild = new Map<string, number>()
  for (const t of allDelegationTurns) {
    turnsByChild.set(t.child_session_id, (turnsByChild.get(t.child_session_id) ?? 0) + 1)
  }
  const multiStopChildrenCount = [...turnsByChild.values()].filter((c) => c > 1).length

  const archiveChildrenCount = [...targetSessions.values()].filter(
    (s) => s.parent_id !== null && s.parent_id !== "ses_ecbfc0f40ffenfykTrNGoMS6o1",
  ).length

  return {
    sqlitePath: targetSqlitePath,
    blobDir: targetBlobDir,
    elapsedMs: performance.now() - t0,
    hostKvBindingsCount: hostKv.bindings.length,
    hostKvForeignIndexCount: hostKv.foreignIndex.length,
    hostKvContextPrunesCount: hostKv.contextPrunes.length,
    totalDelegationTurnsCount: allDelegationTurns.length,
    multiStopChildrenCount,
    p1p2AntigravityChildrenCount: p1p2AgByChild.size,
    p1p2AntigravityFalsePositivesCount: falsePositiveIds.length,
    p1p2AntigravityFalsePositiveIds: falsePositiveIds,
    archiveChildrenEvaluatedCount: archiveChildrenCount,
    snapshotArtifactsCount: allSnapshotArtifacts.length,
    spillArtifactsCount: allSpillArtifacts.length,
    blobsWrittenCount: sinker.blobsWritten(),
  }
}

if (import.meta.main) {
  const report = runSpineIngestionPrototype()
  console.log(JSON.stringify(report, null, 2))
}
