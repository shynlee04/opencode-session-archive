/**
 * Real ledger adapter (Iteration 2 — Seeded Hash-Chain, Verification Evidence & Actor Conclusions).
 *
 * Reads the host SQLite database read-only. The authoritative source for a
 * change is the tool-call chain in `session_message`:
 *   write(content) -> full file
 *   edit(oldString,newString) -> apply to the chain (seeded from full-file read or HEAD:<path>)
 *   read(full) -> establishes content for a later edit, never proof of a write
 *   shell(test/typecheck/build) -> verification evidence with pass/fail outcome
 */

import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { parseReadToolOutput } from "../archive/primitives.ts"
import {
  type Actor,
  type EvidenceState,
  type LedgerEntry,
  type LedgerScope,
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
  evidence: EvidenceState[]
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

function safeRealpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    const dir = path.dirname(p)
    try {
      return path.join(realpathSync(dir), path.basename(p))
    } catch {
      return p
    }
  }
}

function normalizeToRoot(
  raw: string,
  sessionDir: string,
  root: string,
  externalWorktrees?: ReadonlyArray<string>,
): string | null {
  if (!raw) return null
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(sessionDir, raw)
  const rel = path.relative(root, abs)
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join("/")
  }
  const realRoot = safeRealpath(root)
  const realAbs = safeRealpath(abs)
  const realRel = path.relative(realRoot, realAbs)
  if (realRel && !realRel.startsWith("..") && !path.isAbsolute(realRel)) {
    return realRel.split(path.sep).join("/")
  }
  if (externalWorktrees) {
    for (const wt of externalWorktrees) {
      const realWt = safeRealpath(wt)
      if (realWt === realRoot) continue
      const wtRel = path.relative(realWt, realAbs)
      if (wtRel && !wtRel.startsWith("..") && !path.isAbsolute(wtRel)) {
        return `@${path.basename(realWt)}/${wtRel.split(path.sep).join("/")}`
      }
    }
  }
  return null
}

function readFullContent(
  outputText: string,
  input: Record<string, unknown>,
  seedText?: string,
  diskText?: string,
): string | null {
  if (!outputText) return null
  try {
    const capture = parseReadToolOutput(outputText, input)
    if (capture.coverageKind !== "full") return null
    let text = capture.cleanText
    if (!text.endsWith("\n") && (seedText?.endsWith("\n") || diskText?.endsWith("\n"))) {
      text = `${text}\n`
    }
    return text
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

function isScratchTarget(raw: string, sessionDir: string): boolean {
  if (!raw) return true
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(sessionDir, raw)
  return (
    abs.startsWith("/tmp/") ||
    abs.startsWith("/private/tmp/") ||
    abs.startsWith("/var/folders/") ||
    abs.startsWith("/private/var/folders/")
  )
}

interface ParsedPatchBlock {
  rawPath: string
  op: "add" | "modify" | "delete"
  newSnippet?: string
}

function parsePatchBlocks(patchText: string): ParsedPatchBlock[] {
  const blocks: ParsedPatchBlock[] = []
  const lines = patchText.split("\n")
  let current: { rawPath: string; op: "add" | "modify" | "delete"; added: string[] } | null = null
  const flush = () => {
    if (!current) return
    const snippet = current.added.join("\n").trim().slice(0, 200) || undefined
    blocks.push({ rawPath: current.rawPath, op: current.op, newSnippet: snippet })
    current = null
  }
  for (const line of lines) {
    const addMatch = line.match(/^\*\*\*\s+Add File:\s+(.+)$/)
    if (addMatch?.[1]) {
      flush()
      current = { rawPath: addMatch[1].trim(), op: "add", added: [] }
      continue
    }
    const updateMatch = line.match(/^\*\*\*\s+Update File:\s+(.+)$/)
    if (updateMatch?.[1]) {
      flush()
      current = { rawPath: updateMatch[1].trim(), op: "modify", added: [] }
      continue
    }
    const deleteMatch = line.match(/^\*\*\*\s+Delete File:\s+(.+)$/)
    if (deleteMatch?.[1]) {
      flush()
      current = { rawPath: deleteMatch[1].trim(), op: "delete", added: [] }
      continue
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.added.push(line.slice(1))
    }
  }
  flush()
  return blocks
}

function effectiveShellDir(command: string, input: Record<string, unknown>, sessionDir: string): string {
  const rawWorkdir = typeof input.workdir === "string" ? input.workdir : typeof input.cwd === "string" ? input.cwd : ""
  const baseDir = rawWorkdir
    ? path.isAbsolute(rawWorkdir)
      ? path.resolve(rawWorkdir)
      : path.resolve(sessionDir, rawWorkdir)
    : sessionDir
  const cdMatch = command.match(/^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*(?:&&|;)/)
  const cdTarget = cdMatch?.[1] ?? cdMatch?.[2] ?? cdMatch?.[3]
  if (cdTarget && !cdTarget.includes("$")) {
    return path.isAbsolute(cdTarget) ? path.resolve(cdTarget) : path.resolve(baseDir, cdTarget)
  }
  return baseDir
}

const VERIFICATION_SEGMENT_RE =
  /\b((?:bun\s+(?:run\s+)?(?:test|typecheck|build|check)|npm\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|pnpm\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|yarn\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|npx\s+(?:tsc|vitest|jest|playwright)|tsc\b|vitest\b|jest\b|pytest\b|cargo\s+(?:test|check|clippy|build)|go\s+(?:test|vet|build)|make\s+(?:test|check|build))[^;&|\n]*)/i

function formatVerificationCommand(command: string, shellDir: string, root: string): string {
  const trimmed = command.replace(/\s+/g, " ").trim()
  const hasLeadingSetup = /^\s*(?:cd\s+|set\s+|[A-Za-z_][A-Za-z0-9_]*=)/.test(trimmed) || trimmed.includes("&&") || trimmed.includes(";")
  if (!hasLeadingSetup && trimmed.length <= 80) {
    return trimmed
  }
  const cleaned = trimmed.replace(/\s+\d*>&\d+/g, "")
  const segMatch = cleaned.match(VERIFICATION_SEGMENT_RE)
  const coreCmd = (segMatch?.[1] ?? cleaned)
    .replace(/\s*>\s*\S+.*$/, "")
    .trim()
  const relDir = path.relative(root, shellDir).split(path.sep).join("/")
  if (relDir && relDir !== "." && !relDir.startsWith("..") && !path.isAbsolute(relDir)) {
    const laneName = relDir.replace(/^\.worktree\//, "")
    return `[${laneName}] ${coreCmd}`.slice(0, 160)
  }
  return coreCmd.slice(0, 160)
}

function isMutatingShell(command: string): boolean {
  return /(^|\s)(?:>|>>|tee\s|sed\s+-i|mv\s|cp\s|rm\s|touch\s|mkdir\s|git\s+(?:checkout|restore|apply|merge|commit)|bun\s+(?:install|add|remove)|npm\s+(?:install|i|ci)|pnpm\s+(?:install|add)|yarn\s+(?:install|add))\b/.test(
    command,
  ) || /(?:^|\s)(?:>|>>)\s*\S/.test(command) || /\b(?:write_text|write_bytes|writeFileSync)\s*\(/.test(command)
}

function stripQuotedLiterals(command: string): string {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, '""')
}

const VERIFICATION_CMD_RE =
  /(?:^|[;&|\n]\s*|\b(?:&&|\|\|)\s*)(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:cd\s+\S+\s*&&\s*)?)(?:bun\s+(?:run\s+)?(?:test|typecheck|build|check)|npm\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|pnpm\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|yarn\s+(?:run\s+)?(?:test|typecheck|build|check|lint)|npx\s+(?:tsc|vitest|jest|playwright)|tsc\b|vitest\b|jest\b|pytest\b|cargo\s+(?:test|check|clippy|build)|go\s+(?:test|vet|build)|make\s+(?:test|check|build))\b/i

function isVerificationCommand(command: string): boolean {
  return VERIFICATION_CMD_RE.test(stripQuotedLiterals(command))
}

function parseCommandVerification(
  command: string,
  state: Record<string, unknown>,
  outputText: string,
): { exit: number; outcome: "pass" | "fail" | "unknown"; summary: string } {
  const metadata = asObj(state.metadata)
  const rawExit =
    typeof metadata.exitCode === "number"
      ? metadata.exitCode
      : typeof metadata.exit === "number"
        ? metadata.exit
        : typeof state.exitCode === "number"
          ? state.exitCode
          : null

  const exitMatch =
    outputText.match(/Command exited with code\s+(-?\d+)/i) ??
    outputText.match(/\bexit(?:\s+code)?[:=\s]+(-?\d+)/i)
  const parsedExit = exitMatch ? Number.parseInt(exitMatch[1] ?? "0", 10) : null
  const hasFailSignal = /\b(?:FAIL|FAILED|ERR!|error\s+TS\d+|[1-9]\d*\s+fail(?:ed|ures?)?)\b/.test(outputText)
  const hasPassSignal = /\b(?:\d+\s+pass(?:ed)?|0\s+fail|All\s+tests\s+passed|OK)\b/i.test(outputText)

  const knownExit = rawExit ?? parsedExit
  const outcome: "pass" | "fail" | "unknown" =
    knownExit !== null
      ? knownExit !== 0 || hasFailSignal
        ? "fail"
        : "pass"
      : hasFailSignal
        ? "fail"
        : hasPassSignal
          ? "pass"
          : "unknown"
  const exit =
    knownExit !== null
      ? knownExit
      : outcome === "fail"
        ? 1
        : outcome === "pass"
          ? 0
          : -1

  const lines = outputText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const summaryLine =
    lines.find((l) => /\b(?:\d+\s+pass|\d+\s+fail|error\s+TS|Ran\s+\d+\s+tests)/i.test(l)) ??
    lines[lines.length - 1] ??
    ""
  return {
    exit,
    outcome,
    summary: summaryLine.slice(0, 140),
  }
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
  if (/\bbun\s+(?:install|add|remove)\b/.test(command)) out.push("bun.lock", "bun.lockb", "package.json")
  if (/\bnpm\s+(?:install|i|ci)\b/.test(command)) out.push("package-lock.json", "package.json")
  if (/\bpnpm\s+(?:install|add)\b/.test(command)) out.push("pnpm-lock.yaml", "package.json")
  if (/\byarn\s+(?:install|add)\b/.test(command)) out.push("yarn.lock", "package.json")
  if (/\b(?:write_text|write_bytes|writeFileSync)\s*\(/.test(command)) {
    for (const m of command.matchAll(/Path\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (m[1]) out.push(m[1])
    }
    for (const m of command.matchAll(/writeFileSync\(\s*['"]([^'"]+)['"]/g)) {
      if (m[1]) out.push(m[1])
    }
  }
  return [
    ...new Set(
      out.filter(
        (s) =>
          !s.startsWith("-") &&
          !/^\d+$/.test(s) &&
          s !== "/dev/null" &&
          !s.includes("$") &&
          !s.includes('"') &&
          !s.includes("'") &&
          !s.includes("(") &&
          !s.includes(")") &&
          !s.includes("="),
      ),
    ),
  ]
}

function readGitHeadBlobAtPath(root: string, relPath: string): string | null {
  const absTarget = safeRealpath(path.join(root, relPath))
  const targetDir = path.dirname(absTarget)
  if (!existsSync(targetDir)) return null
  const topProc = Bun.spawnSync({
    cmd: ["git", "-c", "core.quotePath=false", "-C", targetDir, "rev-parse", "--show-toplevel"],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  })
  if (topProc.exitCode !== 0) return null
  const subTop = safeRealpath(Buffer.from(topProc.stdout ?? []).toString("utf8").trim())
  if (!subTop) return null
  const subRel = path.relative(subTop, absTarget).split(path.sep).join("/")
  if (!subRel || subRel.startsWith("..")) return null
  const showProc = Bun.spawnSync({
    cmd: ["git", "-c", "core.quotePath=false", "-C", subTop, "show", `HEAD:${subRel}`],
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  })
  if (showProc.exitCode !== 0) return null
  return Buffer.from(showProc.stdout ?? []).toString("utf8")
}

export function readHostLedger(
  dbPath: string,
  rootArg: string,
  sessionID?: string,
  seedContents?: Map<string, string>,
  diskContents?: Map<string, string>,
  externalWorktrees?: ReadonlyArray<string>,
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
    evidence: [],
    shellWrites: new Map(),
    skippedOutsideRoot: 0,
    fragments: 0,
  }
  if (!existsSync(dbPath)) return { ...empty, error: `host db not found: ${dbPath}` }
  let db: Database | null = null
  try {
    db = new Database(dbPath, { readonly: true })
    db.exec("PRAGMA busy_timeout = 5000;")
    let resolvedID = sessionID
    if (!resolvedID) {
      const row = db
        .query(
          "SELECT id FROM session_v2 WHERE directory = ? ORDER BY CASE WHEN parent_id IS NULL OR parent_id = '' THEN 0 ELSE 1 END, time_updated DESC LIMIT 1",
        )
        .get(root) as { id?: string } | null
      resolvedID = row?.id
    }
    if (!resolvedID) return { ...empty, error: `no host session for ${root}` }

    // Walk upward to the true root session so passing a child sessionID still captures the full tree
    const rootRow = db
      .query(
        `WITH RECURSIVE ancestors(id, parent_id, depth) AS (
           SELECT id, parent_id, 0 FROM session_v2 WHERE id = ?
           UNION ALL
           SELECT s.id, s.parent_id, a.depth + 1
           FROM session_v2 s JOIN ancestors a ON s.id = a.parent_id
           WHERE a.depth < 20
         )
         SELECT id FROM ancestors ORDER BY depth DESC LIMIT 1`,
      )
      .get(resolvedID) as { id?: string } | null
    const treeRootID = rootRow?.id ?? resolvedID

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
      .all(treeRootID) as Array<{
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

    const rootSession = sessions.find((s) => s.id === treeRootID) ?? sessions[0]
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

    const parts = db
      .query(
        `WITH RECURSIVE tree(id) AS (
           SELECT ?
           UNION ALL
           SELECT s.id FROM session_v2 s JOIN tree t ON s.parent_id = t.id
         )
         SELECT
           m.session_id,
           m.seq,
           m.time_created,
           p.key AS part_key,
           json_extract(p.value, '$.type') AS p_type,
           LOWER(COALESCE(json_extract(p.value, '$.name'), '')) AS p_name,
           json_extract(p.value, '$.id') AS p_id,
           json_extract(p.value, '$.state.status') AS p_status,
           json_extract(p.value, '$.state.input') AS p_input,
           CASE
             WHEN json_extract(p.value, '$.type') = 'text' THEN substr(json_extract(p.value, '$.text'), 1, 800)
             WHEN LOWER(COALESCE(json_extract(p.value, '$.name'), '')) IN ('read', 'read_file', 'view_file')
               THEN substr(COALESCE(json_extract(p.value, '$.state.content[0].text'), ''), 1, 262144)
             WHEN LOWER(COALESCE(json_extract(p.value, '$.name'), '')) IN ('shell', 'bash', 'run_command', 'exec')
               THEN substr(COALESCE(json_extract(p.value, '$.state.content[0].text'), json_extract(p.value, '$.state.output'), ''), -2000)
             ELSE ''
           END AS p_text,
           json_extract(p.value, '$.state.metadata.exitCode') AS p_exit
         FROM session_message m
         JOIN tree t ON m.session_id = t.id
         JOIN json_each(m.data, '$.content') p
         WHERE m.type = 'assistant'
           AND (
             json_extract(p.value, '$.type') = 'text'
             OR (
               json_extract(p.value, '$.type') = 'tool'
               AND json_extract(p.value, '$.state.status') = 'completed'
               AND LOWER(COALESCE(json_extract(p.value, '$.name'), '')) IN (
                 'write', 'write_to_file', 'create_file', 'replace_file_content', 'multi_replace_file_content',
                 'edit', 'multi_edit', 'edit_file', 'apply_patch', 'patch',
                 'read', 'read_file', 'view_file',
                 'shell', 'bash', 'run_command', 'exec'
               )
             )
           )
         ORDER BY m.time_created ASC, m.seq ASC, p.key ASC`,
      )
      .all(treeRootID) as Array<{
      session_id: string
      seq: number
      time_created: number
      part_key: number
      p_type: string | null
      p_name: string | null
      p_id: string | null
      p_status: string | null
      p_input: string | null
      p_text: string | null
      p_exit: number | null
    }>

    const stateByPath = new Map<string, ChainState>()
    const entries: LedgerEntry[] = []
    const evidence: EvidenceState[] = []
    const shellWrites = new Map<string, ShellWrite>()
    const actorPaths = new Map<string, Set<string>>()
    const actorChecks = new Map<string, { count: number; last: "pass" | "fail" | "none" }>()
    const actorConclusion = new Map<string, string>()

    const rootID = rootSession.id
    const runStart = Number(rootSession.time_created ?? 0)
    let skippedOutsideRoot = 0
    let fragments = 0

    const recordActorPath = (sid: string, rel: string) => {
      let set = actorPaths.get(sid)
      if (!set) {
        set = new Set()
        actorPaths.set(sid, set)
      }
      set.add(rel)
    }

    for (const row of parts) {
      if (row.p_type === "text") {
        const text = (row.p_text ?? "").trim()
        if (text.length > 0) {
          actorConclusion.set(row.session_id, text.slice(0, 600))
        }
        continue
      }

      const name = row.p_name ?? ""
      if (row.p_status !== "completed") continue
      let input: Record<string, unknown> = {}
      if (row.p_input) {
        try {
          input = asObj(JSON.parse(row.p_input))
        } catch {
          continue
        }
      }
      const outputText = row.p_text ?? ""
      const state: Record<string, unknown> =
        typeof row.p_exit === "number" ? { metadata: { exitCode: row.p_exit } } : {}
      const callId = asStr(row.p_id) ?? `${row.session_id}:${row.seq}:${row.part_key}`
      const session = byId.get(row.session_id)
      const sessionDir = session?.directory ?? root
      const t = Number(row.time_created ?? 0)
      const hasReplaceTarget =
        (name === "replace_file_content" || name === "multi_replace_file_content") &&
        (typeof input.TargetContent === "string" ||
          typeof input.oldString === "string" ||
          typeof input.old_string === "string" ||
          Array.isArray(input.ReplacementChunks))
      const isWrite =
        ["write", "write_to_file", "create_file"].includes(name) ||
        (name === "replace_file_content" && !hasReplaceTarget)
      const isEdit =
        ["edit", "multi_edit", "edit_file", "apply_patch", "patch", "multi_replace_file_content"].includes(name) ||
        hasReplaceTarget
      const isRead = ["read", "read_file", "view_file"].includes(name)
      const isShell = ["shell", "bash", "run_command", "exec"].includes(name)

      if (isRead) {
        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root, externalWorktrees)
        if (!rel) continue
        const existing = stateByPath.get(rel)
        if (existing?.content != null) continue
        const full = readFullContent(outputText, input, seedContents?.get(rel), diskContents?.get(rel))
        if (full == null) continue
        stateByPath.set(rel, { content: full, after: fullHash(full), scope: "file" })
        continue
      }

      if (isWrite) {
        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root, externalWorktrees)
        if (!rel) {
          if (!isScratchTarget(rawPath, sessionDir)) skippedOutsideRoot++
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
          op: prev?.content != null || seedContents?.has(rel) ? "modify" : "add",
          tool: "write",
          before: prev?.after ?? null,
          after,
          scope: "file",
          t,
          callId,
        })
        stateByPath.set(rel, { content: rawContent, after, scope: "file" })
        recordActorPath(row.session_id, rel)
        continue
      }

      if (isEdit) {
        const rawPatchText = typeof input.patchText === "string" ? input.patchText : typeof input.patch === "string" ? input.patch : ""
        if (rawPatchText && (name === "patch" || name === "apply_patch")) {
          const blocks = parsePatchBlocks(rawPatchText)
          for (const block of blocks) {
            const rel = normalizeToRoot(block.rawPath, sessionDir, root, externalWorktrees)
            if (!rel) {
              if (!isScratchTarget(block.rawPath, sessionDir)) skippedOutsideRoot++
              continue
            }
            const prev = stateByPath.get(rel)
            const diskText = diskContents?.get(rel)
            const after = diskText !== undefined ? fullHash(diskText) : fullHash(block.newSnippet ?? rawPatchText)
            const scope: LedgerScope = diskText !== undefined ? "file" : "fragment"
            entries.push({
              session: row.session_id,
              root: rootID,
              parent: session?.parent_id ?? undefined,
              path: rel,
              op: block.op,
              tool: "patch",
              before: prev?.after ?? null,
              after,
              scope,
              t,
              callId,
              newSnippet: block.newSnippet,
            })
            if (diskText !== undefined) {
              stateByPath.set(rel, { content: diskText, after, scope: "file" })
            }
            recordActorPath(row.session_id, rel)
          }
          continue
        }

        const rawPath = resolveTarget(input)
        const rel = normalizeToRoot(rawPath, sessionDir, root, externalWorktrees)
        if (!rel) {
          if (!isScratchTarget(rawPath, sessionDir)) skippedOutsideRoot++
          continue
        }
        let prev = stateByPath.get(rel)
        // Seed from git HEAD blob (including linked worktree HEAD) when the agent edited after a partial line-range read or rg
        if (!prev?.content) {
          const seeded = seedContents?.get(rel) ?? readGitHeadBlobAtPath(root, rel)
          if (seeded != null) {
            prev = { content: seeded, after: fullHash(seeded), scope: "file" }
            stateByPath.set(rel, prev)
          }
        }

        const edits: Array<{ oldString: string; newString: string; replaceAll: boolean }> = []
        const multi = Array.isArray(input.edits)
          ? (input.edits as unknown[])
          : Array.isArray(input.ReplacementChunks)
            ? (input.ReplacementChunks as unknown[])
            : null
        if (multi) {
          for (const item of multi) {
            const e = asObj(item)
            edits.push({
              oldString: String(e.oldString ?? e.old_string ?? e.oldText ?? e.TargetContent ?? ""),
              newString: String(e.newString ?? e.new_string ?? e.newText ?? e.ReplacementContent ?? ""),
              replaceAll: e.replaceAll === true || e.replace_all === true || e.AllowMultiple === true,
            })
          }
        } else {
          edits.push({
            oldString: String(input.oldString ?? input.old_string ?? input.oldText ?? input.TargetContent ?? ""),
            newString: String(input.newString ?? input.new_string ?? input.newText ?? input.ReplacementContent ?? ""),
            replaceAll: input.replaceAll === true || input.replace_all === true || input.AllowMultiple === true,
          })
        }
        let next = prev?.content ?? null
        let applied = next != null
        if (next != null) {
          for (const e of edits) {
            let v = applyEdit(next, e.oldString, e.newString, e.replaceAll)
            if (v == null && !next.endsWith("\n")) {
              v = applyEdit(`${next}\n`, e.oldString, e.newString, e.replaceAll)
            }
            if (v == null) {
              applied = false
              break
            }
            next = v
          }
        }
        if (applied && next != null && !next.endsWith("\n") && diskContents?.get(rel) === `${next}\n`) {
          next = `${next}\n`
        }
        const lastNewSnippet = edits
          .map((e) => e.newString.trim())
          .filter(Boolean)
          .pop()
          ?.slice(0, 200)

        recordActorPath(row.session_id, rel)
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
            newSnippet: lastNewSnippet,
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
            newSnippet: lastNewSnippet,
          })
        }
        continue
      }

      if (isShell) {
        const command = String(input.command ?? input.cmd ?? "").trim()
        if (!command) continue
        const shellDir = effectiveShellDir(command, input, sessionDir)

        if (isVerificationCommand(command)) {
          const ver = parseCommandVerification(command, state, outputText)
          evidence.push({
            command: formatVerificationCommand(command, shellDir, root),
            exit: ver.exit,
            revision: "worktree",
            outcome: ver.outcome,
            session: row.session_id,
            t,
            summary: ver.summary,
          })
          const prevChk = actorChecks.get(row.session_id) ?? { count: 0, last: "none" }
          actorChecks.set(row.session_id, {
            count: prevChk.count + 1,
            last: ver.outcome === "unknown" ? prevChk.last : ver.outcome,
          })
        }

        if (!isMutatingShell(command)) continue
        for (const target of shellTargets(command)) {
          const rel = normalizeToRoot(target, shellDir, root, externalWorktrees)
          if (!rel) continue
          const existing = shellWrites.get(rel)
          if (!existing || existing.t < t) {
            shellWrites.set(rel, { t, known: false, command })
          }
        }
      }
    }

    const actors: Actor[] = sessions.map((s) => {
      const info = modelInfo(s.model)
      const touched = [...(actorPaths.get(s.id) ?? [])].sort()
      const chk = actorChecks.get(s.id)
      return {
        session: s.id,
        parent: s.parent_id ?? undefined,
        depth: depth(s.id),
        role: s.id === rootID ? "root" : "delegation",
        harness: info.harness,
        model: info.model,
        worktree: s.directory,
        title: s.title ?? undefined,
        updatedAt: Number(s.time_updated ?? s.time_created ?? 0),
        filesTouched: touched.length,
        paths: touched,
        checksRun: chk?.count ?? 0,
        lastCheck: chk?.last ?? "none",
        conclusion: actorConclusion.get(s.id),
      }
    })

    // Keep the most recent 12 verification evidence items in chronological order
    const boundedEvidence = evidence.slice(-12)

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
      evidence: boundedEvidence,
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
