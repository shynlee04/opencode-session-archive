/**
 * Real ledger adapter.
 *
 * Reads the host SQLite database read-only. The authoritative source for a
 * change is the tool-call chain in `session_message`:
 *   write(content) -> full file
 *   edit(oldString,newString) -> apply to the chain, full file when possible
 *   read(full) -> establishes content for a later edit, never proof of a write
 *
 * A fragment that cannot be applied to a full-file chain is retained as
 * evidence but never promoted to `agent`/`agent_sealed`.
 */

import { existsSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { parseReadToolOutput } from "../archive/primitives.ts"
import {
  type Actor,
  type LedgerEntry,
  type LedgerScope,
  type Op,
  type ShellWrite,
  fullHash,
} from "./model.ts"

export interface HostSession {
  id: string
  parent_id: string | null
  directory: string
  title: string
  agent: string
  model: string
  time_created: number
  time_updated: number
}

export interface HostLedger {
  ok: boolean
  error?: string
  sessionID: string
  rootSession: string
  runStart: number
  sessions: HostSession[]
  actors: Actor[]
  entries: LedgerEntry[]
  shellWrites: Map<string, ShellWrite>
  skippedOutsideRoot: number
  fragments: number
}

interface ChainState {
  content: string | null
  after: string | null
  scope: LedgerScope
}

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

function modelInfo(raw: string | null): { harness: string; model: string } {
  if (!raw) return { harness: "opencode", model: "unknown" }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const provider = String(parsed.providerID ?? parsed.provider ?? "")
    const model = String(parsed.id ?? parsed.modelID ?? parsed.model ?? "unknown")
    const harness = provider.includes("devin")
      ? "devin"
      : provider.includes("antigravity")
        ? "antigravity"
        : "opencode"
    return { harness, model }
  } catch {
    const harness = raw.includes("devin") ? "devin" : raw.includes("antigravity") ? "antigravity" : "opencode"
    return { harness, model: raw }
  }
}

function normalizeToRoot(raw: string, sessionDir: string, root: string): string | null {
  if (!raw) return null
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(sessionDir, raw)
  const rel = path.relative(root, abs)
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

function readFullContent(outputText: string, input: Record<string, unknown>): string | null {
  if (!outputText) return null
  try {
    const capture = parseReadToolOutput(outputText, input)
    if (capture.coverageKind !== "full") return null
    return capture.cleanText
  } catch {
    return null
  }
}

function applyEdit(content: string, oldString: string, newString: string, replaceAll: boolean): string | null {
  if (!oldString) return null
  if (!content.includes(oldString)) return null
  return replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString)
}

function resolveTarget(input: Record<string, unknown>): string {
  return String(input.filePath ?? input.path ?? input.TargetFile ?? input.file ?? input.target ?? "")
}

function isMutatingShell(command: string): boolean {
  return /(^|\s)(?:>|>>|tee\s|sed\s+-i|mv\s|cp\s|rm\s|touch\s|mkdir\s|git\s+(?:checkout|restore|apply|merge|commit)|bun\s+install|npm\s+install|pnpm\s+install|yarn\s+add)\b/.test(
    command,
  ) || /(?:^|\s)(?:>|>>)\s*\S/.test(command)
}

function shellTargets(command: string): string[] {
  const out: string[] = []
  const redirects = [...command.matchAll(/(?:^|\s)>{1,2}\s*([^\s;|&]+)/g)].map((m) => m[1])
  out.push(...redirects)
  const tee = command.match(/(?:^|\s)tee\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+)/)
  if (tee?.[1]) out.push(tee[1])
  const sed = command.match(/(?:^|\s)sed\s+-i(?:\s+\S+)?\s+(?:'[^']*'|"[^"]*"|\S+)\s+([^\s;|&]+)/)
  if (sed?.[1]) out.push(sed[1])
  const mv = command.match(/(?:^|\s)(?:mv|cp)\s+(?:-[a-zA-Z]+\s+)*\S+\s+([^\s;|&]+)/)
  if (mv?.[1]) out.push(mv[1])
  const rm = command.match(/(?:^|\s)rm\s+(?:-[a-zA-Z]+\s+)*([^\s;|&]+(?:\s+[^\s;|&-][^\s;|&]*)*)/)
  if (rm?.[1]) out.push(...rm[1].split(/\s+/).filter((s) => !s.startsWith("-")))
  return [...new Set(out.filter((s) => !s.startsWith("-")))]
}

export function readHostLedger(
  dbPath: string,
  rootArg: string,
  sessionID?: string,
): HostLedger {
  const root = path.resolve(rootArg)
  const empty: HostLedger = {
    ok: false,
    sessionID: sessionID ?? "",
    rootSession: sessionID ?? "",
    runStart: 0,
    sessions: [],
    actors: [],
    entries: [],
    shellWrites: new Map(),
    skippedOutsideRoot: 0,
    fragments: 0,
  }
  if (!existsSync(dbPath)) return { ...empty, error: `host db not found: ${dbPath}` }
  let db: Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    let resolvedID = sessionID
    if (!resolvedID) {
      const row = db
        .query("SELECT id FROM session_v2 WHERE directory = ? ORDER BY time_updated DESC LIMIT 1")
        .get(root) as { id?: string } | null
      resolvedID = row?.id
    }
    if (!resolvedID) return { ...empty, error: `no host session for ${root}` }

    const sessions = db
      .query(
        `WITH RECURSIVE tree(id) AS (
           SELECT ?
           UNION ALL
           SELECT s.id FROM session_v2 s JOIN tree t ON s.parent_id = t.id
         )
         SELECT s.id, s.parent_id, s.directory, s.title, s.agent, s.model, s.time_created, s.time_updated
         FROM session_v2 s JOIN tree t ON s.id = t.id
         ORDER BY s.time_created ASC`,
      )
      .all(resolvedID) as Array<{
      id: string
      parent_id: string | null
      directory: string
      title: string | null
      agent: string | null
      model: string | null
      time_created: number
      time_updated: number
    }>
    if (sessions.length === 0) return { ...empty, error: `session not found: ${resolvedID}` }

    const rootSession = sessions[0]
    const byId = new Map(sessions.map((s) => [s.id, s]))
    const depth = (id: string): number => {
      let d = 0
      let cursor = byId.get(id)
      while (cursor?.parent_id && byId.has(cursor.parent_id) && d < 20) {
        d++
        cursor = byId.get(cursor.parent_id)
      }
      return d
    }
    const actors: Actor[] = sessions.map((s) => {
      const info = modelInfo(s.model)
      return {
        session: s.id,
        parent: s.parent_id ?? undefined,
        depth: depth(s.id),
        role: s.id === resolvedID ? "root" : "delegation",
        harness: info.harness,
        model: info.model,
        worktree: s.directory,
      }
    })

    const parts = db
      .query(
        `WITH RECURSIVE tree(id) AS (
           SELECT ?
           UNION ALL
           SELECT s.id FROM session_v2 s JOIN tree t ON s.parent_id = t.id
         )
         SELECT m.session_id, m.seq, m.time_created, p.key AS part_key, p.value AS part
         FROM session_message m
         JOIN tree t ON m.session_id = t.id
         JOIN json_each(m.data, '$.content') p
         WHERE m.type = 'assistant' AND json_extract(p.value, '$.type') = 'tool'
         ORDER BY m.time_created ASC, m.seq ASC, p.key ASC`,
      )
      .all(resolvedID) as Array<{
      session_id: string
      seq: number
      time_created: number
      part_key: number
      part: string
    }>

    const stateByPath = new Map<string, ChainState>()
    const entries: LedgerEntry[] = []
    const shellWrites = new Map<string, ShellWrite>()
    const rootID = rootSession.id
    const runStart = Number(rootSession.time_created ?? 0)
    let skippedOutsideRoot = 0
    let fragments = 0

    for (const row of parts) {
      let part: Record<string, unknown>
      try {
        part = JSON.parse(row.part) as Record<string, unknown>
      } catch {
        continue
      }
      const name = String(part.name ?? "").toLowerCase()
      const state = asObj(part.state)
      if (String(state.status ?? "") !== "completed") continue
      const input = asObj(state.input)
      const outputText = Array.isArray(state.content)
        ? (state.content as unknown[])
            .flatMap((item) => {
              const c = asObj(item)
              return c.type === "text" && typeof c.text === "string" ? [c.text] : []
            })
            .join("")
        : ""
      const callId = asStr(part.id) ?? `${row.session_id}:${row.seq}:${row.part_key}`
      const session = byId.get(row.session_id)
      const sessionDir = session?.directory ?? root
      const t = Number(row.time_created ?? 0)
      const isWrite = ["write", "write_to_file", "create_file", "replace_file_content"].includes(name)
      const isEdit = ["edit", "multi_edit", "edit_file", "apply_patch", "patch"].includes(name)
      const isRead = ["read", "read_file", "view_file"].includes(name)
      const isShell = ["shell", "bash", "run_command", "exec"].includes(name)

      if (isRead) {
        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root)
        if (!rel) continue
        const existing = stateByPath.get(rel)
        if (existing?.content != null) continue
        const full = readFullContent(outputText, input)
        if (full == null) continue
        stateByPath.set(rel, { content: full, after: fullHash(full), scope: "file" })
        continue
      }

      if (isWrite) {
        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root)
        if (!rel) {
          skippedOutsideRoot++
          continue
        }
        const rawContent = input.content ?? input.CodeContent ?? input.ReplacementContent
        if (typeof rawContent !== "string") continue
        const prev = stateByPath.get(rel)
        const after = fullHash(rawContent)
        entries.push({
          session: row.session_id,
          root: rootID,
          parent: session?.parent_id ?? undefined,
          path: rel,
          op: prev?.content != null ? "modify" : "add",
          tool: "write",
          before: prev?.after ?? null,
          after,
          scope: "file",
          t,
          callId,
        })
        stateByPath.set(rel, { content: rawContent, after, scope: "file" })
        continue
      }

      if (isEdit) {
        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root)
        if (!rel) {
          skippedOutsideRoot++
          continue
        }
        const prev = stateByPath.get(rel)
        const edits: Array<{ oldString: string; newString: string; replaceAll: boolean }> = []
        const multi = Array.isArray(input.edits) ? (input.edits as unknown[]) : null
        if (multi) {
          for (const item of multi) {
            const e = asObj(item)
            edits.push({
              oldString: String(e.oldString ?? e.old_string ?? e.oldText ?? ""),
              newString: String(e.newString ?? e.new_string ?? e.newText ?? ""),
              replaceAll: e.replaceAll === true || e.replace_all === true,
            })
          }
        } else {
          edits.push({
            oldString: String(input.oldString ?? input.old_string ?? input.oldText ?? input.TargetContent ?? ""),
            newString: String(input.newString ?? input.new_string ?? input.newText ?? input.ReplacementContent ?? ""),
            replaceAll: input.replaceAll === true || input.replace_all === true,
          })
        }
        let next = prev?.content ?? null
        let applied = next != null
        if (next != null) {
          for (const e of edits) {
            const v = applyEdit(next, e.oldString, e.newString, e.replaceAll)
            if (v == null) {
              applied = false
              break
            }
            next = v
          }
        }
        if (applied && next != null) {
          const after = fullHash(next)
          entries.push({
            session: row.session_id,
            root: rootID,
            parent: session?.parent_id ?? undefined,
            path: rel,
            op: "modify",
            tool: name === "patch" || name === "apply_patch" ? "patch" : "edit",
            before: prev?.after ?? null,
            after,
            scope: "file",
            t,
            callId,
          })
          stateByPath.set(rel, { content: next, after, scope: "file" })
        } else {
          fragments++
          const fragmentAfter = fullHash(edits.map((e) => e.newString).join(""))
          entries.push({
            session: row.session_id,
            root: rootID,
            parent: session?.parent_id ?? undefined,
            path: rel,
            op: "modify",
            tool: name === "patch" || name === "apply_patch" ? "patch" : "edit",
            before: prev?.after ?? null,
            after: fragmentAfter,
            scope: "fragment",
            t,
            callId,
          })
        }
        continue
      }

      if (isShell) {
        const command = String(input.command ?? input.cmd ?? "")
        if (!command || !isMutatingShell(command)) continue
        for (const target of shellTargets(command)) {
          const rel = normalizeToRoot(target, sessionDir, root)
          if (!rel) continue
          const existing = shellWrites.get(rel)
          if (!existing || existing.t < t) {
            shellWrites.set(rel, { t, known: false, command })
          }
        }
      }
    }

    return {
      ok: true,
      sessionID: resolvedID,
      rootSession: rootID,
      runStart,
      sessions: sessions.map((s) => ({
        id: s.id,
        parent_id: s.parent_id,
        directory: s.directory,
        title: s.title ?? "",
        agent: s.agent ?? "",
        model: s.model ?? "",
        time_created: Number(s.time_created ?? 0),
        time_updated: Number(s.time_updated ?? 0),
      })),
      actors,
      entries,
      shellWrites,
      skippedOutsideRoot,
      fragments,
    }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  } finally {
    db?.close()
  }
}
