import { Database } from "bun:sqlite"
import type {
  Harness,
  KvBindingRow,
  KvContextPruneRow,
  KvForeignIndexRow,
  KvState,
  MessageRow,
  ProjectRow,
  SessionRow,
} from "./types.ts"

export interface SessionSource {
  project(id: string): ProjectRow | undefined
  session(id: string): SessionRow | undefined
  children(id: string): SessionRow[]
  messages(sessionID: string, afterSeq?: number): MessageRow[]
  kvState?(sessionIDs: readonly string[], sinceTimeUpdated?: number): KvState
  readonly listProjectRootSessions?: (projectId: string, limit?: number) => readonly SessionRow[]
  readonly listAllRootSessions?: (limit?: number) => readonly SessionRow[]
  readonly listProjects?: () => readonly ProjectRow[]
  readonly listAllProjects?: () => readonly ProjectRow[]
}

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  project: ["id", "worktree"],
  session_v2: [
    "id",
    "project_id",
    "parent_id",
    "fork_session_id",
    "fork_boundary",
    "directory",
    "title",
    "agent",
    "model",
    "idle_outcome",
    "cost",
    "tokens_input",
    "tokens_output",
    "tokens_reasoning",
    "tokens_cache_read",
    "tokens_cache_write",
    "summary_additions",
    "summary_deletions",
    "summary_files",
    "time_created",
    "time_updated",
    "time_idle",
    "time_compacting",
    "time_archived",
    "resume_attempts",
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "time_updated", "data"],
  kv: ["key", "value", "time_created", "time_updated"],
}

const parseJson = (text: unknown): unknown => {
  if (typeof text !== "string") return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const asObj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null)

const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

export function decodeUtf16BeHex(hex: string): string | null {
  if (hex.length === 0 || hex.length % 4 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const chars: number[] = []
  for (let i = 0; i < hex.length; i += 4) {
    chars.push(parseInt(hex.slice(i, i + 4), 16))
  }
  return String.fromCharCode(...chars)
}

export function decodeHostKvKey(
  rawKey: string,
  explicitScope?: string | null,
): { readonly scope: string | null; readonly logicalKey: string } {
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

const normalizeHarness = (
  value: unknown,
  agent?: string | null,
  title?: string | null,
  providerId?: string | null,
): Harness => {
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

export function ingestHostKv(
  db: Database,
  sessionIDs?: readonly string[],
  sinceTimeUpdated = 0,
): KvState {
  const sessionFilter = sessionIDs && sessionIDs.length > 0 ? new Set(sessionIDs) : null
  const sessionMap = new Map<string, SessionRow>()
  if (sessionFilter) {
    for (const id of sessionFilter) {
      const row = db.query("SELECT * FROM session_v2 WHERE id = ?").get(id)
      if (row !== null) sessionMap.set(id, toSessionRow(row as Record<string, unknown>))
    }
  }

  const rows = db
    .query("SELECT key, value, time_created, time_updated FROM kv WHERE time_updated > ? ORDER BY time_updated ASC, key ASC")
    .all(sinceTimeUpdated) as Array<{
    key: string
    value: string
    time_created: number | null
    time_updated: number | null
  }>

  const bindingsByChild = new Map<string, KvBindingRow>()
  const foreignIndex: KvForeignIndexRow[] = []
  const contextPrunes: KvContextPruneRow[] = []

  for (const row of rows) {
    const { scope, logicalKey } = decodeHostKvKey(row.key)
    const val = asObj(parseJson(row.value))

    if (logicalKey.startsWith("bindings/") || logicalKey.startsWith("delegate-mode/child/")) {
      const childSessionId = logicalKey.startsWith("bindings/")
        ? logicalKey.slice("bindings/".length)
        : logicalKey.slice("delegate-mode/child/".length)
      if (!childSessionId || (sessionFilter !== null && !sessionFilter.has(childSessionId))) continue

      const childSession = sessionMap.get(childSessionId)
      const foreignAck = asObj(val.foreignAck)
      const servingWitness = asObj(val.servingWitness)
      const receipts = asObj(val.receipts)
      const modelReceipt = asObj(receipts.model)
      const effortReceipt = asObj(receipts.effort)
      const consumedInputs = Array.isArray(val.consumedInputs) ? JSON.stringify(val.consumedInputs) : null
      const modeRaw = asStr(val.mode)
      const mode: "spawn" | "send" | "continue" | null =
        modeRaw === "spawn" || modeRaw === "send" || modeRaw === "continue" ? modeRaw : null

      const prev = bindingsByChild.get(childSessionId)
      bindingsByChild.set(childSessionId, {
        child_session_id: childSessionId,
        raw_key: row.key,
        scope: scope ?? prev?.scope ?? null,
        driver_kind: logicalKey.startsWith("bindings/") ? "native-binding" : "delegate-mode",
        harness: normalizeHarness(
          val.harness ?? prev?.harness,
          asStr(val.agent) ?? childSession?.agent,
          asStr(val.title) ?? childSession?.title,
          childSession?.model?.providerID,
        ),
        foreign_session_id:
          asStr(val.foreignSessionID) ?? asStr(val.foreignSessionId) ?? prev?.foreign_session_id ?? null,
        parent_session_id:
          asStr(val.parentSessionID) ??
          asStr(val.parentSessionId) ??
          childSession?.parent_id ??
          prev?.parent_session_id ??
          null,
        call_id: asStr(val.callID) ?? asStr(val.callId) ?? prev?.call_id ?? null,
        title: asStr(val.title) ?? childSession?.title ?? prev?.title ?? null,
        cwd: asStr(val.cwd) ?? childSession?.directory ?? prev?.cwd ?? null,
        agent: asStr(val.agent) ?? childSession?.agent ?? prev?.agent ?? null,
        model: asStr(val.model) ?? childSession?.model?.id ?? prev?.model ?? null,
        effort: asStr(val.effort) ?? childSession?.model?.variant ?? prev?.effort ?? null,
        mode: mode ?? prev?.mode ?? null,
        background: asBool(val.background) ?? prev?.background ?? null,
        requested_model: asStr(modelReceipt.requested) ?? asStr(val.requestedModel) ?? prev?.requested_model ?? null,
        confirmed_model: asStr(modelReceipt.applied) ?? asStr(val.confirmedModel) ?? prev?.confirmed_model ?? null,
        confirmed_effort: asStr(effortReceipt.applied) ?? asStr(val.confirmedEffort) ?? prev?.confirmed_effort ?? null,
        turn: asNum(val.turn) ?? prev?.turn ?? null,
        phase: asStr(val.phase) ?? prev?.phase ?? null,
        foreign_ack_turn: asNum(foreignAck.turn) ?? prev?.foreign_ack_turn ?? null,
        foreign_ack_stop_reason: asStr(foreignAck.stopReason) ?? prev?.foreign_ack_stop_reason ?? null,
        serving_witness_model:
          asStr(servingWitness.model) ?? asStr(servingWitness.servingModel) ?? prev?.serving_witness_model ?? null,
        serving_witness_at:
          asStr(servingWitness.observedAt) ?? asStr(servingWitness.at) ?? prev?.serving_witness_at ?? null,
        consumed_inputs_json: consumedInputs ?? prev?.consumed_inputs_json ?? null,
        created_at: row.time_created ?? prev?.created_at ?? null,
        updated_at: row.time_updated ?? prev?.updated_at ?? null,
      })
      continue
    }

    if (logicalKey === "foreign-session-index") {
      for (const [k, v] of Object.entries(val)) {
        const childId = asStr(v)
        if (!childId || (sessionFilter !== null && !sessionFilter.has(childId))) continue
        const colonIdx = k.indexOf(":")
        const harness = colonIdx > 0 ? k.slice(0, colonIdx) : "unknown"
        const foreignId = colonIdx > 0 ? k.slice(colonIdx + 1) : k
        foreignIndex.push({
          harness,
          foreign_session_id: foreignId,
          child_session_id: childId,
          raw_key: row.key,
        })
      }
      continue
    }

    if (logicalKey.startsWith("context-prune:") || row.key.includes(":context-prune:")) {
      const parts = logicalKey.split("context-prune:")
      const sessionId = parts[1] ?? ""
      if (!sessionId || (sessionFilter !== null && !sessionFilter.has(sessionId))) continue
      contextPrunes.push({
        session_id: sessionId,
        raw_key: row.key,
        scope,
        mode: asStr(val.mode),
        anchor_message_id: asStr(val.anchorMessageID) ?? asStr(val.anchorMessageId),
        recorded_at: asStr(val.recordedAt),
        updated_at: row.time_updated,
      })
    }
  }

  return {
    bindings: [...bindingsByChild.values()],
    foreignIndex,
    contextPrunes,
  }
}

const toSessionRow = (raw: Record<string, unknown>): SessionRow => ({
  id: raw.id as string,
  project_id: raw.project_id as string,
  parent_id: (raw.parent_id as string | null) ?? null,
  fork_session_id: (raw.fork_session_id as string | null) ?? null,
  fork_boundary: (raw.fork_boundary as string | null) ?? null,
  directory: raw.directory as string,
  title: (raw.title as string | null) ?? null,
  agent: (raw.agent as string | null) ?? null,
  model: (() => {
    const parsed = parseJson(raw.model)
    if (typeof parsed !== "object" || parsed === null) return null
    const m = parsed as Record<string, unknown>
    return typeof m.id === "string" && typeof m.providerID === "string"
      ? typeof m.variant === "string"
        ? { id: m.id, providerID: m.providerID, variant: m.variant }
        : { id: m.id, providerID: m.providerID }
      : null
  })(),
  idle_outcome: (raw.idle_outcome as string | null) ?? null,
  cost: (raw.cost as number) ?? 0,
  tokens_input: (raw.tokens_input as number) ?? 0,
  tokens_output: (raw.tokens_output as number) ?? 0,
  tokens_reasoning: (raw.tokens_reasoning as number) ?? 0,
  tokens_cache_read: (raw.tokens_cache_read as number) ?? 0,
  tokens_cache_write: (raw.tokens_cache_write as number) ?? 0,
  summary_additions: (raw.summary_additions as number | null) ?? null,
  summary_deletions: (raw.summary_deletions as number | null) ?? null,
  summary_files: (raw.summary_files as number | null) ?? null,
  time_created: raw.time_created as number,
  time_updated: raw.time_updated as number,
  time_idle: (raw.time_idle as number | null) ?? null,
  time_compacting: (raw.time_compacting as number | null) ?? null,
  time_archived: (raw.time_archived as number | null) ?? null,
  resume_attempts: (raw.resume_attempts as number) ?? 0,
})

export function sqliteSource(dbPath: string): SessionSource & { close(): void } {
  const db = new Database(dbPath, { readonly: true })

  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = new Set(
      db
        .query("SELECT name FROM pragma_table_info(?)")
        .all(table)
        .map((row) => (row as { name: string }).name),
    )
    for (const column of columns) {
      if (!present.has(column)) {
        db.close()
        throw new Error(`session-archive: host schema drift: ${table}.${column} missing`)
      }
    }
  }

  return {
    project(id) {
      const row = db.query("SELECT id, worktree FROM project WHERE id = ?").get(id)
      return row === null ? undefined : (row as ProjectRow)
    },
    session(id) {
      const row = db.query("SELECT * FROM session_v2 WHERE id = ?").get(id)
      return row === null ? undefined : toSessionRow(row as Record<string, unknown>)
    },
    children(id) {
      return db
        .query("SELECT * FROM session_v2 WHERE parent_id = ? ORDER BY time_created, id")
        .all(id)
        .map((row) => toSessionRow(row as Record<string, unknown>))
    },
    messages(sessionID, afterSeq) {
      const rows =
        typeof afterSeq === "number"
          ? db
              .query(
                "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq",
              )
              .all(sessionID, afterSeq)
          : db
              .query(
                "SELECT id, session_id, type, seq, time_created, time_updated, data FROM session_message WHERE session_id = ? ORDER BY seq",
              )
              .all(sessionID)
      return rows.map((row) => {
        const r = row as Omit<MessageRow, "data"> & { data: string }
        return { ...r, data: parseJson(r.data) }
      })
    },
    kvState(sessionIDs, sinceTimeUpdated = 0) {
      return ingestHostKv(db, sessionIDs, sinceTimeUpdated)
    },
    listProjectRootSessions(projectId, limit = 2000) {
      return db
        .query("SELECT * FROM session_v2 WHERE project_id = ? AND parent_id IS NULL ORDER BY time_updated DESC, id ASC LIMIT ?")
        .all(projectId, limit)
        .map((row) => toSessionRow(row as Record<string, unknown>))
    },
    listAllRootSessions(limit = 2000) {
      return db
        .query("SELECT * FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC, id ASC LIMIT ?")
        .all(limit)
        .map((row) => toSessionRow(row as Record<string, unknown>))
    },
    listProjects() {
      return db.query("SELECT id, worktree FROM project ORDER BY id ASC").all() as ProjectRow[]
    },
    listAllProjects() {
      return db.query("SELECT id, worktree FROM project ORDER BY id ASC").all() as ProjectRow[]
    },
    close() {
      db.close()
    },
  }
}
