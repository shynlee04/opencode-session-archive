// hivemind-substrate (session-archive) — Unified OpenCode V2 Context & Working-Memory Substrate plugin.
//
// Install: build with `bun run build`, then copy dist/session-archive.ts into
// <project>/.opencode/plugins/ (project scope) or ~/.config/opencode/plugins/
// (global). The host supplies the "@opencode/plugin" runtime module — imports
// here stay type-only.

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, statSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"

type ToolExecute = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]["add"] extends (tool: infer T) => void ? (T extends { execute: infer E } ? E : never) : never
import * as archiveMod from "./archive/index.ts"
import { persist, sqliteSource, type PersistReport } from "./archive/index.ts"
import { initSyncDatabase } from "./archive/index-db.ts"
import * as primitivesMod from "./archive/primitives.ts"
import { JIT_SKELETON_MARKER, estimateTokens } from "./archive/primitives.ts"
import {
  WorkingSetValve,
  applyContextHookInMemory,
  computeStepWatermark,
  type PruningMode,
} from "./archive/valve.ts"
import { buildSubstrateSnapshot, executeSubstrateAction } from "./cli.ts"
import {
  buildJitReadSkeletonFooter,
  computeCodebasePageRank,
  ensureCochangeSchema,
  ensureCodeGraphSchema,
  indexCodebase,
  indexSingleFileSkeleton,
  mineGitCochange,
  queryCochangeCouplings,
  readAstSkeleton,
  readSymbolSlice,
  renderCochangeWarnings,
  renderRepoMap,
} from "./honeycomb/index.ts"
import {
  SUBSTRATE_RPC_ID,
  SUBSTRATE_UPDATED_EVENT,
  substrateRpcContract,
  type SubstrateActionInput,
  type SubstrateSnapshotInput,
} from "./rpc.ts"
import {
  formatVerificationGateLabel,
  renderProvenanceViewport,
} from "./viewports/continuity.ts"
import { buildTrace, renderTraceLeaf, renderTracePackage } from "./changes/trace.ts"
import { ensureTraceSchema, markSignalConsumed, persistTrace } from "./changes/store.ts"
import {
  buildCompactionContinuationPacket,
  buildImplementorViewportBrief,
  ensureContinuitySchema,
  ensureSemanticDigestSchema,
  materializeSemanticDigests,
  querySubstrateContinuity,
  queryVibeNavigation,
  reconcileProvenanceStaleness,
  recordCompactionSummaryHash,
  renderIntentTimeline,
  renderProvenanceReport,
  resolveDefaultSessionId,
  resolvePromptBlob,
} from "./viewports/index.ts"

export {
  SUBSTRATE_RPC_ID,
  WorkingSetValve,
  applyContextHookInMemory,
  buildCompactionContinuationPacket,
  buildImplementorViewportBrief,
  buildJitReadSkeletonFooter,
  buildSubstrateSnapshot,
  computeCodebasePageRank,
  computeStepWatermark,
  executeSubstrateAction,
  formatVerificationGateLabel,
  indexCodebase,
  materializeSemanticDigests,
  mineGitCochange,
  persist,
  queryCochangeCouplings,
  querySubstrateContinuity,
  queryVibeNavigation,
  readAstSkeleton,
  readSymbolSlice,
  reconcileProvenanceStaleness,
  renderCochangeWarnings,
  renderIntentTimeline,
  renderProvenanceReport,
  renderProvenanceViewport,
  renderRepoMap,
  resolveDefaultSessionId,
  resolvePromptBlob,
  sqliteSource,
  substrateRpcContract,
}

export type OutputFormat = "markdown" | "json" | "both"

const defaultDbPath = (): string => {
  const dataHome = Bun.env.XDG_DATA_HOME ?? `${Bun.env.HOME}/.local/share`
  return `${dataHome}/opencode/opencode.db`
}

const resolveArchiveDir = (projectRoot: string, dir?: string): string => {
  const resolved = !dir
    ? path.join(projectRoot, ".session-archive")
    : path.isAbsolute(dir)
      ? path.resolve(dir)
      : path.resolve(projectRoot, dir)
  const segments = resolved.split(path.sep)
  if (segments.includes(".opencode")) {
    throw new Error(`session-archive: archive directory must not reside inside .opencode/: ${resolved}`)
  }
  return resolved
}

function normalizeCanonicalAction(rawAction: string): string {
  const a = rawAction.trim().toLowerCase()
  if (a === "find") return "search"
  if (a === "persist") return "sync"
  if (a === "valve" || a === "valve.prune" || a === "prune") return "prune"
  if (a === "valve.status") return "status"
  if (a === "valve.reset") return "reset"
  if (a === "intents") return "timeline"
  return a
}

function resolveTargetWorkspaceForCall(
  rawPath: string | undefined,
  activeWorktreeRoot: string,
): {
  readonly targetRoot: string
  readonly archiveDir: string
  readonly indexDbPath: string
  readonly relPath: string
  readonly isCrossProject: boolean
} {
  const helper = (primitivesMod as Record<string, unknown>).resolveTargetWorkspace
  if (typeof helper === "function" && rawPath && rawPath.trim().length > 0) {
    try {
      const resolved = helper(rawPath, activeWorktreeRoot) as {
        targetRoot?: string
        archiveDir?: string
        indexDbPath?: string
        relPath?: string
        isCrossProject?: boolean
      }
      if (resolved && typeof resolved.targetRoot === "string") {
        const tRoot = resolved.targetRoot
        const aDir = resolved.archiveDir ?? path.join(tRoot, ".session-archive")
        return {
          targetRoot: tRoot,
          archiveDir: aDir,
          indexDbPath: resolved.indexDbPath ?? path.join(aDir, "index.sqlite"),
          relPath: resolved.relPath ?? rawPath,
          isCrossProject: Boolean(resolved.isCrossProject ?? path.resolve(tRoot) !== path.resolve(activeWorktreeRoot)),
        }
      }
    } catch {
      // Fall through to local implementation
    }
  }

  const trimmed = (rawPath ?? "").trim()
  if (!trimmed || !path.isAbsolute(trimmed)) {
    const aDir = path.join(activeWorktreeRoot, ".session-archive")
    return {
      targetRoot: activeWorktreeRoot,
      archiveDir: aDir,
      indexDbPath: path.join(aDir, "index.sqlite"),
      relPath: trimmed.replace(/^\.\//, ""),
      isCrossProject: false,
    }
  }

  const absTarget = path.resolve(trimmed)
  const absActive = path.resolve(activeWorktreeRoot)
  if (absTarget === absActive || absTarget.startsWith(`${absActive}${path.sep}`)) {
    const rel = path.relative(absActive, absTarget).split(path.sep).join("/")
    const aDir = path.join(absActive, ".session-archive")
    return {
      targetRoot: absActive,
      archiveDir: aDir,
      indexDbPath: path.join(aDir, "index.sqlite"),
      relPath: rel,
      isCrossProject: false,
    }
  }

  let startDir = absTarget
  try {
    if (existsSync(absTarget) && !statSync(absTarget).isDirectory()) {
      startDir = path.dirname(absTarget)
    }
  } catch {
    startDir = path.dirname(absTarget)
  }

  let cur = startDir
  let detectedRoot: string | null = null
  while (true) {
    if (
      existsSync(path.join(cur, ".git")) ||
      existsSync(path.join(cur, "package.json")) ||
      existsSync(path.join(cur, "tsconfig.json"))
    ) {
      detectedRoot = cur
      break
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  const targetRoot = detectedRoot ?? startDir
  const relPath = path.relative(targetRoot, absTarget).split(path.sep).join("/")
  const archiveDir = path.join(targetRoot, ".session-archive")
  return {
    targetRoot,
    archiveDir,
    indexDbPath: path.join(archiveDir, "index.sqlite"),
    relPath,
    isCrossProject: true,
  }
}

function formatToolOutput(params: {
  readonly action: string
  readonly markdown: string
  readonly metadata: Record<string, unknown>
  readonly format?: unknown
  readonly elapsedMs?: number
  readonly skipFooter?: boolean
  readonly sessionID?: string | null
  readonly budgetTokens?: number | null
}): { readonly content: string; readonly metadata: Record<string, unknown> } {
  const fmt: OutputFormat =
    params.format === "json" || params.format === "both" ? params.format : "markdown"
  const canonicalAction = normalizeCanonicalAction(params.action)
  const tokens = estimateTokens(params.markdown)
  const rawMeta = params.metadata ?? {}
  const baseData: Record<string, unknown> =
    typeof (rawMeta as { toJSON?: unknown }).toJSON === "function"
      ? { ...((rawMeta as { toJSON: () => Record<string, unknown> }).toJSON()) }
      : { ...rawMeta }

  delete baseData.content
  delete baseData.markdown
  delete baseData.tokenEstimate
  delete baseData.estimatedTokens
  delete baseData.maxTokens

  const resolvedSessionID =
    (params.sessionID ??
      (typeof rawMeta.sessionID === "string" ? rawMeta.sessionID : undefined) ??
      (typeof rawMeta.resolvedSessionID === "string" ? rawMeta.resolvedSessionID : undefined) ??
      null) as string | null
  const resolvedBudgetTokens =
    (params.budgetTokens ??
      (typeof rawMeta.budgetTokens === "number" ? rawMeta.budgetTokens : undefined) ??
      (typeof rawMeta.maxTokens === "number" ? rawMeta.maxTokens : undefined) ??
      null) as number | null

  const enrichedMeta: Record<string, unknown> = {
    ok: true,
    action: canonicalAction,
    sessionID: resolvedSessionID,
    tokenCount: tokens,
    tokens,
    budgetTokens: resolvedBudgetTokens,
    ...(params.elapsedMs !== undefined ? { latencyMs: Number(params.elapsedMs.toFixed(2)) } : {}),
    ...rawMeta,
  }

  const jsonEnvelope: Record<string, unknown> = {
    ok: true,
    action: canonicalAction,
    sessionID: resolvedSessionID,
    tokenCount: tokens,
    tokens,
    budgetTokens: resolvedBudgetTokens,
    ...(params.elapsedMs !== undefined ? { latencyMs: Number(params.elapsedMs.toFixed(2)) } : {}),
    content: params.markdown,
    data: baseData,
  }

  if (fmt === "json") {
    return {
      content: JSON.stringify(jsonEnvelope, null, 2),
      metadata: enrichedMeta,
    }
  }

  const footer =
    params.skipFooter || params.markdown.includes("[substrate.telemetry")
      ? ""
      : `\n\n---\n[substrate.telemetry action=${canonicalAction} tokens=${tokens}${
          params.elapsedMs !== undefined ? ` latencyMs=${params.elapsedMs.toFixed(2)}` : ""
        }]`
  const markdownWithFooter = `${params.markdown}${footer}`

  if (fmt === "both") {
    return {
      content: `${markdownWithFooter}\n\n\`\`\`json\n${JSON.stringify(jsonEnvelope, null, 2)}\n\`\`\``,
      metadata: enrichedMeta,
    }
  }

  return {
    content: markdownWithFooter,
    metadata: enrichedMeta,
  }
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text
        }
        return ""
      })
      .join("")
  }
  return ""
}

function appendTextToToolResultContent(content: unknown, suffix: string): unknown {
  if (typeof content === "string") {
    return `${content}${suffix}`
  }
  if (Array.isArray(content)) {
    const cloned = content.map((item) => (item && typeof item === "object" ? { ...item } : item))
    for (let i = cloned.length - 1; i >= 0; i--) {
      const part = cloned[i]
      if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
        ;(part as { text: string }).text = `${(part as { text: string }).text}${suffix}`
        return cloned
      }
    }
    return [...cloned, { type: "text", text: suffix }]
  }
  return suffix
}

export default {
  id: "hivemind-substrate",
  async setup(ctx: Plugin.Context) {
    const dir = typeof ctx.options?.dir === "string" ? ctx.options.dir : undefined
    const dbPath = typeof ctx.options?.dbPath === "string" ? ctx.options.dbPath : defaultDbPath()
    const codemode = ctx.options?.direct === true ? false : true
    const locationAny = (ctx.location ?? {}) as unknown as {
      project?: { id?: string; canonical?: string }
      worktree?: string
      directory?: string
    }
    const canonicalRoot =
      locationAny.project?.canonical ||
      locationAny.worktree ||
      locationAny.directory ||
      process.cwd()
    const activeWorktreeRoot =
      locationAny.worktree ||
      locationAny.directory ||
      canonicalRoot
    const projectRoot = activeWorktreeRoot
    const projectID = locationAny.project?.id ?? "default"
    const archiveDir = resolveArchiveDir(canonicalRoot, dir)
    const blobDir = path.join(archiveDir, "blobs")
    const indexDbPath = path.join(archiveDir, "index.sqlite")

    // Event-driven trace signal. The context hook only reads this map; the idle
    // subscriber does the real git + host-ledger work and writes the durable row.
    type PendingSignal = { readonly id: string; readonly text: string; consumed: boolean }
    const pendingSignals = new Map<string, PendingSignal>()
    const lastHeadBySession = new Map<string, string>()

    const valve = new WorkingSetValve({
      blobDir,
      readOnlyArchiveDir: archiveDir,
      persistBlobsToDisk: true,
      canonicalRoot: activeWorktreeRoot,
    })

    const ensureSyncedDb = (targetSessionID?: string): { db: Database; report?: PersistReport } => {
      mkdirSync(archiveDir, { recursive: true })
      let report: PersistReport | undefined
      let syncedSessionID: string | undefined = targetSessionID
      if (existsSync(dbPath)) {
        try {
          const source = sqliteSource(dbPath)
          try {
            const candidateSession =
              targetSessionID ??
              (existsSync(indexDbPath)
                ? (() => {
                    const tmp = new Database(indexDbPath)
                    try {
                      return resolveDefaultSessionId(tmp).sessionId
                    } finally {
                      tmp.close()
                    }
                  })()
                : "")
            if (candidateSession && candidateSession !== "unknown") {
              syncedSessionID = candidateSession
              report = persist(
                {
                  sessionID: candidateSession,
                  projectID,
                  projectRoot: canonicalRoot,
                  dir,
                },
                source,
              )
            }
          } finally {
            source.close()
          }
        } catch {
          // Best-effort incremental sync when host DB or session is not yet populated
        }
      }
      const db = initSyncDatabase(indexDbPath)
      ensureSemanticDigestSchema(db)
      ensureContinuitySchema(db)
      ensureCodeGraphSchema(db)
      ensureCochangeSchema(db)
      try {
        materializeSemanticDigests(db, { archiveDir, canonicalRoot: activeWorktreeRoot })
      } catch {
        // Best-effort digest materialization
      }
      try {
        reconcileProvenanceStaleness(db, activeWorktreeRoot, syncedSessionID || undefined)
      } catch {
        // Best-effort provenance staleness reconciliation
      }
      return { db, report }
    }

    const resolveSessionIdForCall = (explicitSessionID?: unknown, contextSessionID?: unknown): string => {
      if (typeof explicitSessionID === "string" && explicitSessionID.trim().length > 0) {
        return explicitSessionID.trim()
      }
      if (typeof contextSessionID === "string" && contextSessionID.trim().length > 0) {
        return contextSessionID.trim()
      }
      if (existsSync(indexDbPath)) {
        const tmp = new Database(indexDbPath)
        try {
          return resolveDefaultSessionId(tmp).sessionId
        } catch {
          // ignore
        } finally {
          tmp.close()
        }
      }
      return "default"
    }

    const loadSessionMessagesForValve = async (sessionID: string): Promise<Record<string, unknown>[]> => {
      if (typeof ctx.session?.context === "function") {
        try {
          const hostMessages = await ctx.session.context({ sessionID })
          if (Array.isArray(hostMessages) && hostMessages.length > 0) {
            return hostMessages as unknown as Record<string, unknown>[]
          }
        } catch {
          // Fall through to legacy/SQLite fallback
        }
      }

      const legacySession = ctx.session as unknown as {
        messages?: (input: { sessionID: string }) => Promise<Record<string, unknown>[]>
      }
      if (typeof legacySession?.messages === "function") {
        try {
          const legacyMessages = await legacySession.messages({ sessionID })
          if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
            return legacyMessages
          }
        } catch {
          // Fall through to SQLite fallback
        }
      }

      if (existsSync(dbPath)) {
        try {
          const source = sqliteSource(dbPath)
          try {
            const rows = source.messages(sessionID)
            if (rows.length > 0) {
              return rows.map((row) => {
                const dataObj =
                  typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)
                    ? (row.data as Record<string, unknown>)
                    : {}
                return {
                  ...dataObj,
                  id: row.id,
                  role: row.type,
                  type: row.type,
                  seq: row.seq,
                }
              })
            }
          } finally {
            source.close()
          }
        } catch {
          // ignore read fallback error
        }
      }

      return []
    }

    const executePersist = async (input: Record<string, unknown> | undefined, context: { sessionID?: string; progress?: (p: { status: string }) => Promise<void> } | undefined) => {
      const t0 = performance.now()
      const requestedSessionID = resolveSessionIdForCall(input?.sessionID, context?.sessionID)
      const scopeRaw = String(input?.scope ?? "session").toLowerCase()
      const scope = scopeRaw === "project" || scopeRaw === "all-projects" ? scopeRaw : "session"
      if (typeof context?.progress === "function") {
        await context.progress({ status: `persisting session tree (${scope}) for ${requestedSessionID}` })
      }
      const source = sqliteSource(dbPath)
      try {
        const persistProjectFn = (archiveMod as Record<string, unknown>).persistProject
        if ((scope === "project" || scope === "all-projects") && typeof persistProjectFn === "function") {
          const projReport = (await persistProjectFn(
            {
              sessionID: requestedSessionID,
              projectID,
              projectRoot: canonicalRoot,
              dir,
              scope,
            },
            source,
          )) as {
            readonly scope?: string
            readonly rootSessionsSynced?: number
            readonly totalSessionsSynced?: number
            readonly skippedWarmTrees?: number
            readonly rootID?: string
            readonly archiveDir?: string
            readonly sessions?: number
            readonly messages?: number
            readonly delegations?: number
            readonly written?: readonly string[]
            readonly unchanged?: number
          }
          const { db } = ensureSyncedDb(requestedSessionID)
          db.close()
          const summary = [
            `Persisted ${scope} session trees (${projReport.rootSessionsSynced ?? 1} root trees, ${projReport.totalSessionsSynced ?? projReport.sessions ?? 1} total sessions, ${projReport.skippedWarmTrees ?? 0} warm skips) into ${projReport.archiveDir ?? archiveDir}.`,
          ].join(" ")
          return formatToolOutput({
            action: "sync",
            sessionID: projReport.rootID ?? requestedSessionID,
            markdown: summary,
            metadata: projReport as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        const report = persist(
          {
            sessionID: requestedSessionID,
            projectID,
            projectRoot: canonicalRoot,
            dir,
          },
          source,
        )

        if (scope === "project" || scope === "all-projects") {
          try {
            const hostDb = new Database(dbPath, { readonly: true })
            try {
              const rootRows =
                scope === "all-projects"
                  ? (hostDb
                      .query(`SELECT id FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 200`)
                      .all() as Array<{ id: string }>)
                  : (hostDb
                      .query(
                        `SELECT id FROM session_v2 WHERE parent_id IS NULL AND (project_id = ? OR directory = ?) ORDER BY time_updated DESC LIMIT 200`,
                      )
                      .all(projectID, canonicalRoot) as Array<{ id: string }>)
              for (const r of rootRows) {
                if (!r.id || r.id === report.rootID) continue
                try {
                  persist(
                    {
                      sessionID: r.id,
                      projectID,
                      projectRoot: canonicalRoot,
                      dir,
                    },
                    source,
                  )
                } catch {
                  // Ignore individual root session sync error during batch scope sync
                }
              }
            } finally {
              hostDb.close()
            }
          } catch {
            // Best-effort project-wide root enumeration
          }
        }

        const { db } = ensureSyncedDb(report.rootID)
        db.close()

        const summary = [
          `Persisted session tree rooted at ${report.rootID} into ${report.archiveDir}.`,
          `${report.sessions} sessions, ${report.messages} messages, ${report.delegations} delegations.`,
          `${report.written.length} files written, ${report.unchanged} unchanged.`,
          ...(report.warnings && report.warnings.length > 0 ? [`Warnings: ${report.warnings.join("; ")}`] : []),
        ].join(" ")
        return formatToolOutput({
          action: "sync",
          sessionID: report.rootID,
          markdown: summary,
          metadata: report as unknown as Record<string, unknown>,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      } finally {
        source.close()
      }
    }

    const buildCompactValveManifest = (
      sessionID: string,
      valveEntries: ReadonlyArray<{
        readonly path: string
        readonly normalizedPath?: string
        readonly lineRange: string
        readonly status: string
      }>,
      sqlReads: ReadonlyArray<{
        readonly path: string
        readonly normalized_path?: string
        readonly line_range: string
        readonly staleness_status: string
      }>,
    ): string => {
      const merged = new Map<string, { path: string; lineRange: string; status: string }>()
      for (const f of valveEntries) {
        const p = f.normalizedPath || f.path
        if (!p) continue
        merged.set(p, {
          path: p,
          lineRange: f.lineRange || "L1-L1",
          status: f.status,
        })
      }
      for (const r of sqlReads) {
        const p = r.normalized_path || r.path
        if (!p || merged.has(p)) continue
        merged.set(p, {
          path: p,
          lineRange: r.line_range || "L1-L1",
          status: r.staleness_status || "FRESH — DO NOT REREAD",
        })
      }

      const all = [...merged.values()]
      if (all.length === 0) {
        return `## WorkingMemoryManifest · \`${sessionID}\`\nNo files recorded in working-memory ledger.`
      }

      let freshCount = 0
      let sliceCount = 0
      let staleCount = 0
      for (const item of all) {
        if (item.status.startsWith("STALE")) staleCount++
        else if (item.status.startsWith("SLICE")) sliceCount++
        else freshCount++
      }

      const preview = all.slice(0, 6).map((item) => {
        const badge = item.status.startsWith("SLICE")
          ? item.status.split(" — ")[0]
          : item.status.startsWith("STALE")
            ? "STALE"
            : "FRESH"
        return `- \`${item.path}#${item.lineRange}\` (**${badge}**)`
      })
      if (all.length > 6) {
        preview.push(`- _(+${all.length - 6} more files in ledger; pass \`full: true\` for full manifest)_`)
      }

      const ledgerCounts = valve.status(sessionID).ledger?.manifest
      const modCount = ledgerCounts?.filesModified.length ?? 0
      const skillCount = ledgerCounts?.activeSkills.length ?? 0
      const delCount = ledgerCounts?.delegationOutcomes.length ?? 0

      return [
        `## WorkingMemoryManifest · \`${sessionID}\` (FRESH=${freshCount} SLICE=${sliceCount} STALE=${staleCount} | Modified=${modCount} | Skills=${skillCount} | Delegations=${delCount})`,
        ...preview,
      ].join("\n")
    }

    const executeValve = async (input: Record<string, unknown> | undefined, context: { sessionID?: string } | undefined) => {
      const t0 = performance.now()
      const action = String(input?.action ?? "prune").toLowerCase()
      const sessionID = resolveSessionIdForCall(input?.sessionID, context?.sessionID)
      const fullOutput = input?.full === true

      if (action === "reset") {
        const res = valve.reset(sessionID)
        return formatToolOutput({
          action: "reset",
          sessionID,
          markdown: res.summaryMarkdown,
          metadata: res as unknown as Record<string, unknown>,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      }

      const { db } = ensureSyncedDb(sessionID)
      try {
        try {
          reconcileProvenanceStaleness(db, activeWorktreeRoot, sessionID)
        } catch {
          // Best-effort provenance sync
        }
        try {
          const syncFn = (valve as unknown as { syncFromSqlite?: (sid: string, d: Database) => void }).syncFromSqlite
          if (typeof syncFn === "function") {
            syncFn.call(valve, sessionID, db)
          }
        } catch {
          // Ignore optional syncFromSqlite error
        }

        const querySqlReads = () => {
          try {
            return db
              .query(
                `SELECT path, normalized_path, line_range, staleness_status, total_lines, read_seq
                 FROM file_read_ledger
                 WHERE session_id = ?
                 ORDER BY read_seq ASC`,
              )
              .all(sessionID) as Array<{
              path: string
              normalized_path: string
              line_range: string
              staleness_status: string
              total_lines: number | null
              read_seq: number
            }>
          } catch {
            return []
          }
        }

        if (action === "status") {
          const res = valve.status(sessionID)
          const sqlReads = querySqlReads()
          const hookReadsMap = (valve as unknown as { hookReads?: Map<string, Map<string, { path: string; normalizedPath?: string; lineRange: string; status: string }>> }).hookReads?.get(sessionID)
          const valveEntries = res.ledger?.manifest.filesRead ?? (hookReadsMap ? [...hookReadsMap.values()] : [])
          const compactManifest = buildCompactValveManifest(sessionID, valveEntries, sqlReads)
          const md = fullOutput
            ? `${res.summaryMarkdown}\n\n${res.manifestMarkdown}`
            : `${res.summaryMarkdown}\n\n${compactManifest}`
          return formatToolOutput({
            action: "status",
            sessionID,
            markdown: md,
            metadata: res as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        const mode: PruningMode =
          input?.mode === "recent" || input?.mode === "initial" || input?.mode === "all"
            ? input.mode
            : "step-window"
        const keepRecentSteps =
          typeof input?.keepRecentSteps === "number" && Number.isFinite(input.keepRecentSteps)
            ? input.keepRecentSteps
            : undefined

        const messages = await loadSessionMessagesForValve(sessionID)
        const res = valve.prune({
          sessionID,
          mode,
          keepRecentSteps,
          messages,
        })

        // Sync in-memory valve file reads into file_read_ledger so valve and provenance share one source of truth (S3-1)
        try {
          const upsertRead = db.prepare(
            `INSERT INTO file_read_ledger
               (session_id, path, normalized_path, start_line, end_line, total_lines, is_truncated, line_range, slice_sha, read_blob_sha, disk_blob_sha, staleness_status, read_seq, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, path) DO UPDATE SET
               normalized_path = excluded.normalized_path,
               start_line = excluded.start_line,
               end_line = excluded.end_line,
               total_lines = COALESCE(excluded.total_lines, file_read_ledger.total_lines),
               is_truncated = excluded.is_truncated,
               line_range = excluded.line_range,
               slice_sha = excluded.slice_sha,
               read_blob_sha = excluded.read_blob_sha,
               staleness_status = excluded.staleness_status,
               updated_at = excluded.updated_at`,
          )
          const nowIso = new Date().toISOString()
          let seqCounter = 1
          for (const f of res.ledger.manifest.filesRead) {
            const normPath = f.normalizedPath || f.path
            if (!normPath) continue
            const isSlice = f.status.startsWith("SLICE")
            const sha = f.sliceSha256 ?? f.blobSha256
            upsertRead.run(
              sessionID,
              normPath,
              normPath,
              f.startLine ?? 1,
              f.endLine ?? 1,
              f.totalLines ?? null,
              isSlice ? 1 : 0,
              f.lineRange || "L1-L1",
              sha,
              sha,
              sha,
              f.status,
              seqCounter++,
              nowIso,
            )
          }
          reconcileProvenanceStaleness(db, activeWorktreeRoot, sessionID)
        } catch {
          // Best-effort ledger sync back to SQLite
        }

        const sqlReads = querySqlReads()
        const compactManifest = buildCompactValveManifest(sessionID, res.ledger.manifest.filesRead, sqlReads)
        const markdown = fullOutput
          ? `${res.summaryMarkdown}\n\n${res.ledger.manifest.renderedMarkdown}`
          : `${res.summaryMarkdown}\n\n${compactManifest}`

        return formatToolOutput({
          action: "prune",
          sessionID,
          markdown,
          metadata: res as unknown as Record<string, unknown>,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      } finally {
        db.close()
      }
    }

    const openTargetWorkspaceDb = (targetWs: {
      readonly targetRoot: string
      readonly archiveDir: string
      readonly indexDbPath: string
      readonly isCrossProject: boolean
    }): Database | null => {
      if (!targetWs.isCrossProject) return null
      mkdirSync(targetWs.archiveDir, { recursive: true })
      const targetDb = initSyncDatabase(targetWs.indexDbPath)
      ensureSemanticDigestSchema(targetDb)
      ensureContinuitySchema(targetDb)
      ensureCodeGraphSchema(targetDb)
      ensureCochangeSchema(targetDb)
      return targetDb
    }

    const executeViewport = async (
      input: Record<string, unknown> | undefined,
      context: { sessionID?: string; progress?: (p: { status: string }) => Promise<void> } | undefined,
    ): Promise<{ content: string; metadata: Record<string, unknown> }> => {
      const t0 = performance.now()
      const rawAction = String(input?.action ?? "status").toLowerCase()
      const action = rawAction === "find" ? "search" : rawAction

      if (action === "sync" || action === "persist") {
        return executePersist(input, context)
      }

      if (action === "resolve") {
        const blobId = String(input?.blob ?? input?.blobRef ?? input?.sha ?? "").trim()
        const startLine = typeof input?.startLine === "number" ? input.startLine : undefined
        const endLine = typeof input?.endLine === "number" ? input.endLine : undefined
        const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : undefined
        const resolved = valve.resolveBlob(blobId, { startLine, endLine })
        if (resolved) {
          const slice =
            typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
              ? resolved.slice.slice(0, Math.max(80, Math.floor(maxTokens * 4)))
              : resolved.slice
          return formatToolOutput({
            action: "resolve",
            markdown: slice,
            metadata: { ...resolved, slice } as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: input?.format === undefined,
          })
        }
        const fromArchive = valve.resolve(blobId)
        if (fromArchive) {
          const capped =
            typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0
              ? fromArchive.slice(0, Math.max(80, Math.floor(maxTokens * 4)))
              : fromArchive
          return formatToolOutput({
            action: "resolve",
            markdown: capped,
            metadata: { blobRef: blobId, content: capped },
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: input?.format === undefined,
          })
        }
        return formatToolOutput({
          action: "resolve",
          markdown: `Blob not found: ${blobId}`,
          metadata: { found: false, blob: blobId },
          format: input?.format,
          elapsedMs: performance.now() - t0,
          skipFooter: true,
        })
      }

      if (action === "trace") {
        // Read-only live path: real git + the host ledger, never a full archive sync.
        const traceSession = typeof input?.sessionID === "string" ? input.sessionID : context?.sessionID
        const commit = typeof input?.commit === "string" ? input.commit : undefined
        const requestedID = typeof input?.change === "string" ? input.change : undefined
        const handle = typeof input?.handle === "string" ? input.handle : undefined
        const branch = typeof input?.branch === "string" ? input.branch : undefined
        const filePath = typeof input?.path === "string" ? input.path : undefined
        const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : undefined
        const rawDetail = typeof input?.detail === "string" ? input.detail.toLowerCase() : undefined
        try {
          const result = buildTrace({
            root: activeWorktreeRoot,
            hostDbPath: dbPath,
            sessionID: traceSession,
            commit,
            archiveDbPath: indexDbPath,
          })
          const isLeaf =
            rawDetail === "leaf" ||
            (rawDetail !== "package" &&
              (handle !== undefined || branch !== undefined || filePath !== undefined))
          const markdown = isLeaf
            ? renderTraceLeaf(result, handle, branch, filePath, maxTokens)
            : renderTracePackage(result, requestedID)
          return formatToolOutput({
            action: "trace",
            markdown,
            metadata: {
              ok: true,
              changeId: result.change.id,
              state: result.change.state,
              counts: result.change.counts,
              coverage: result.coverage,
              source: "git+host-ledger",
              notes: result.notes,
              packageTokens: estimateTokens(result.packageMarkdown),
              signal: result.signal,
              detail: isLeaf ? "leaf" : "package",
              ...(isLeaf
                ? { handle: handle ?? `${result.change.id}:${branch ?? "source"}`, path: filePath ?? null }
                : { handles: result.packageView.branches.map((b) => b.handle) }),
            },
            format: input?.format,
            elapsedMs: performance.now() - t0,
            sessionID: result.ledger.sessionID || traceSession || null,
            skipFooter: input?.format === undefined,
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return formatToolOutput({
            action: "trace",
            markdown: `trace failed: ${message}`,
            metadata: { ok: false, error: message },
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: true,
          })
        }
      }

      const explicitSession = typeof input?.sessionID === "string" ? input.sessionID : undefined
      const hookSession = typeof context?.sessionID === "string" ? context.sessionID : undefined
      const { db } = ensureSyncedDb(explicitSession ?? hookSession)

      try {
        const resolvedSession = resolveDefaultSessionId(db, explicitSession, { sessionID: hookSession })
        const sessionID = resolvedSession.sessionId

        if (action === "compaction") {
          reconcileProvenanceStaleness(db, activeWorktreeRoot, sessionID)
          const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1200
          const packet = buildCompactionContinuationPacket(db, {
            sessionID,
            hookContext: { sessionID: hookSession },
            canonicalRoot: activeWorktreeRoot,
            maxTokens,
          })
          return formatToolOutput({
            action: "compaction",
            sessionID,
            budgetTokens: maxTokens,
            markdown: packet.markdown,
            metadata: packet as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "repomap") {
          const rawTargetPath = typeof input?.path === "string" ? input.path : typeof input?.filePath === "string" ? input.filePath : undefined
          const targetWs = resolveTargetWorkspaceForCall(rawTargetPath, activeWorktreeRoot)
          const crossDb = openTargetWorkspaceDb(targetWs)
          const activeDb = crossDb ?? db
          try {
            indexCodebase(activeDb, targetWs.targetRoot)
            computeCodebasePageRank(activeDb)
            const budgetTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1000
            const focusPaths = Array.isArray(input?.focusPaths) ? input.focusPaths.map(String) : undefined
            const rendered = renderRepoMap(activeDb, { budgetTokens, focusPaths })
            return formatToolOutput({
              action: "repomap",
              sessionID,
              budgetTokens,
              markdown: rendered.markdown,
              metadata: rendered as unknown as Record<string, unknown>,
              format: input?.format,
              elapsedMs: performance.now() - t0,
            })
          } finally {
            crossDb?.close()
          }
        }

        if (action === "skeleton") {
          const rawTargetPath = String(input?.path ?? input?.filePath ?? "")
          const targetWs = resolveTargetWorkspaceForCall(rawTargetPath, activeWorktreeRoot)
          const crossDb = openTargetWorkspaceDb(targetWs)
          const activeDb = crossDb ?? db
          try {
            indexCodebase(activeDb, targetWs.targetRoot)
            const targetPath = targetWs.relPath || rawTargetPath
            const includePrivate = Boolean(input?.includePrivate)
            let skel = readAstSkeleton(activeDb, targetPath, {
              rootDir: targetWs.targetRoot,
              includePrivate,
            })
            if (!skel) {
              try {
                indexSingleFileSkeleton(activeDb, targetWs.targetRoot, targetPath)
                skel = readAstSkeleton(activeDb, targetPath, {
                  rootDir: targetWs.targetRoot,
                  includePrivate,
                })
              } catch {
                // ignore if file does not exist on disk
              }
            }
            const skelObj = skel && typeof skel === "object" ? (skel as unknown as Record<string, unknown>) : null
            const text =
              typeof skel === "string"
                ? skel
                : String(skelObj?.skeleton_text ?? skelObj?.skeletonText ?? `No skeleton found for ${targetPath}`)
            return formatToolOutput({
              action: "skeleton",
              sessionID,
              markdown: text,
              metadata: { path: targetPath, targetRoot: targetWs.targetRoot, includePrivate, skeleton: skel },
              format: input?.format,
              elapsedMs: performance.now() - t0,
            })
          } finally {
            crossDb?.close()
          }
        }

        if (action === "slice") {
          const rawTargetPath = String(input?.path ?? input?.filePath ?? "")
          const targetWs = resolveTargetWorkspaceForCall(rawTargetPath, activeWorktreeRoot)
          const crossDb = openTargetWorkspaceDb(targetWs)
          const activeDb = crossDb ?? db
          try {
            indexCodebase(activeDb, targetWs.targetRoot)
            const targetPath = targetWs.relPath || rawTargetPath
            const symbol =
              typeof input?.symbol === "string"
                ? input.symbol
                : typeof input?.qualifiedName === "string"
                  ? input.qualifiedName
                  : {
                      startLine: Number(input?.startLine ?? 1),
                      endLine: Number(input?.endLine ?? 50),
                    }
            const slice = readSymbolSlice(activeDb, targetWs.targetRoot, targetPath, symbol)
            const sliceObj = slice && typeof slice === "object" ? (slice as unknown as Record<string, unknown>) : null
            const text =
              typeof slice === "string"
                ? slice
                : String(sliceObj?.slice_text ?? sliceObj?.sliceText ?? `Symbol slice not found for ${targetPath}`)
            return formatToolOutput({
              action: "slice",
              sessionID,
              markdown: text,
              metadata: sliceObj ?? { path: targetPath, targetRoot: targetWs.targetRoot },
              format: input?.format,
              elapsedMs: performance.now() - t0,
            })
          } finally {
            crossDb?.close()
          }
        }

        if (action === "coupled") {
          const rawTargetPath = String(input?.path ?? input?.filePath ?? "")
          const targetWs = resolveTargetWorkspaceForCall(rawTargetPath, activeWorktreeRoot)
          const crossDb = openTargetWorkspaceDb(targetWs)
          const activeDb = crossDb ?? db
          try {
            indexCodebase(activeDb, targetWs.targetRoot)
            try {
              mineGitCochange(activeDb, targetWs.targetRoot)
            } catch {
              // ignore if targetRoot is not a git repo
            }
            const targetPath = targetWs.relPath || rawTargetPath
            const couplings = queryCochangeCouplings(activeDb, targetPath)
            const warnings = renderCochangeWarnings(activeDb, [targetPath])
            return formatToolOutput({
              action: "coupled",
              sessionID,
              markdown: warnings || `No co-change couplings above threshold for ${targetPath}.`,
              metadata: { path: targetPath, targetRoot: targetWs.targetRoot, couplings },
              format: input?.format,
              elapsedMs: performance.now() - t0,
            })
          } finally {
            crossDb?.close()
          }
        }

        if (action === "brief") {
          const rawTargetPaths = Array.isArray(input?.targetPaths)
            ? input.targetPaths.map(String)
            : typeof input?.path === "string"
              ? [input.path]
              : []
          const firstTargetWs = resolveTargetWorkspaceForCall(rawTargetPaths[0], activeWorktreeRoot)
          const crossDb = openTargetWorkspaceDb(firstTargetWs)
          const activeDb = crossDb ?? db
          try {
            indexCodebase(activeDb, firstTargetWs.targetRoot)
            computeCodebasePageRank(activeDb)
            try {
              mineGitCochange(activeDb, firstTargetWs.targetRoot)
            } catch {
              // ignore if targetRoot is not a git repo
            }
            const normalizedTargets = rawTargetPaths.map((tp) => {
              const ws = resolveTargetWorkspaceForCall(tp, firstTargetWs.targetRoot)
              return ws.relPath || tp
            })
            const symbolNames = Array.isArray(input?.symbolNames) ? input.symbolNames.map(String) : undefined
            const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1500
            const brief = buildImplementorViewportBrief(activeDb, {
              targetPaths: normalizedTargets,
              symbolNames,
              sessionID,
              rootDir: firstTargetWs.targetRoot,
              maxTokens,
            })
            return formatToolOutput({
              action: "brief",
              sessionID,
              budgetTokens: maxTokens,
              markdown: brief.markdown,
              metadata: brief as unknown as Record<string, unknown>,
              format: input?.format,
              elapsedMs: performance.now() - t0,
            })
          } finally {
            crossDb?.close()
          }
        }

        if (action === "search") {
          const query = String(input?.query ?? input?.q ?? "")
          const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 600
          const nav = queryVibeNavigation(db, query, {
            limit: typeof input?.limit === "number" ? input.limit : 5,
            maxTokens,
          })
          return formatToolOutput({
            action: "search",
            sessionID,
            budgetTokens: maxTokens,
            markdown: nav.markdown,
            metadata: nav as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "timeline" || action === "intents") {
          const timeline = renderIntentTimeline(db, sessionID)
          const timelineObj =
            timeline && typeof timeline === "object" ? (timeline as unknown as Record<string, unknown>) : null
          const content =
            typeof timeline === "string" ? timeline : String(timelineObj?.markdown ?? JSON.stringify(timeline))
          return formatToolOutput({
            action: "timeline",
            sessionID,
            markdown: content,
            metadata: timelineObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "provenance") {
          reconcileProvenanceStaleness(db, activeWorktreeRoot, sessionID)
          const report = renderProvenanceReport(db, sessionID)
          const reportObj =
            report && typeof report === "object" ? (report as unknown as Record<string, unknown>) : null
          const content =
            typeof report === "string" ? report : String(reportObj?.markdown ?? JSON.stringify(report))
          return formatToolOutput({
            action: "provenance",
            sessionID,
            markdown: content,
            metadata: reportObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        // Default: status / overview / latest / session
        reconcileProvenanceStaleness(db, activeWorktreeRoot, sessionID)
        const result = querySubstrateContinuity(
          db,
          { action: action as "status", sessionID, query: typeof input?.query === "string" ? input.query : undefined },
          { sessionID: hookSession },
        )
        const resObj = result as unknown as Record<string, unknown>
        const markdown = String(resObj.content ?? resObj.markdown ?? JSON.stringify(result))
        return formatToolOutput({
          action,
          sessionID,
          markdown,
          metadata: resObj,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      } finally {
        db.close()
      }
    }

    // Lifecycle hooks:
    // 1. < 2 ms in-memory context hook (REQ-SUB-07, REQ-SUB-08, REQ-SUB-17)
    if (typeof ctx.session?.hook === "function") {
      await ctx.session.hook("context", (event) => {
        const hookEvent = event as unknown as {
          sessionID?: string
          system?: Array<string | { type: "text"; text: string }>
        }
        valve.applyContextHookInMemory(event as unknown as Parameters<typeof valve.applyContextHookInMemory>[0])
        const hookSession = typeof hookEvent.sessionID === "string" ? hookEvent.sessionID : undefined
        if (!hookSession) return
        const pending = pendingSignals.get(hookSession)
        if (!pending || pending.consumed) return
        const system = Array.isArray(hookEvent.system) ? hookEvent.system : []
        system.unshift({ type: "text", text: pending.text })
        hookEvent.system = system
        pending.consumed = true
      })

      // 2. SQLite-backed compaction continuity hook (REQ-SUB-14, REQ-SUB-15, REQ-SUB-16, REQ-SUB-17)
      await ctx.session.hook("compaction", (event) => {
        const hookSessionID = typeof event?.sessionID === "string" ? event.sessionID : undefined
        const { db } = ensureSyncedDb(hookSessionID)
        try {
          const resolved = resolveDefaultSessionId(db, hookSessionID, { sessionID: hookSessionID })
          reconcileProvenanceStaleness(db, activeWorktreeRoot, resolved.sessionId)
          const packet = buildCompactionContinuationPacket(db, {
            sessionID: resolved.sessionId,
            hookContext: { sessionID: hookSessionID },
            canonicalRoot: activeWorktreeRoot,
            maxTokens: 1200,
          })
          if (Array.isArray(event.system)) {
            event.system.push({ type: "text", text: packet.markdown })
          }
          const compatEvent = event as unknown as { prompt?: string; context?: string[] }
          if (typeof compatEvent.prompt === "string") {
            compatEvent.prompt = `${compatEvent.prompt}\n\n${packet.markdown}`
          } else if (!Array.isArray(event.system) && compatEvent && typeof compatEvent === "object") {
            compatEvent.prompt = packet.markdown
          }
          if (Array.isArray(compatEvent.context)) {
            compatEvent.context.push(packet.markdown)
          }
        } finally {
          db.close()
        }
      })
    }

    // 3. JIT Read Skeleton Interception & Write/Edit Ledger Sync via ctx.tool.hook("execute.after") (A3 / P-1 / P-8 / S3-3)
    if (typeof ctx.tool?.hook === "function") {
      await ctx.tool.hook("execute.after", (event) => {
        if (event.status !== "completed") return
        const rawText = extractToolResultText(event.result?.content)
        const inputObj =
          event.input && typeof event.input === "object" && !Array.isArray(event.input)
            ? (event.input as Record<string, unknown>)
            : {}

        if (
          event.tool === "write" ||
          event.tool === "edit" ||
          event.tool === "patch" ||
          event.tool === "apply_patch"
        ) {
          try {
            valve.recordToolExecuteAfter({
              sessionID: event.sessionID,
              tool: event.tool,
              callId: event.id,
              input: inputObj,
              outputText: rawText || "",
              canonicalRoot: activeWorktreeRoot,
            })
          } catch {
            // Non-fatal: never block host write/edit tool completion
          }
          return
        }

        if (event.tool !== "read" || !rawText) return

        const capture = valve.recordReadFromHook({
          sessionID: event.sessionID,
          callId: event.id,
          input: inputObj,
          rawOutput: rawText,
          canonicalRoot: activeWorktreeRoot,
        })

        const isPartialOrTruncated =
          capture.isTruncated ||
          (capture.totalLines !== null && capture.endLine < capture.totalLines)
        if (!isPartialOrTruncated || rawText.includes(JIT_SKELETON_MARKER)) return

        try {
          const { db } = ensureSyncedDb(event.sessionID)
          try {
            const footer = buildJitReadSkeletonFooter(db, activeWorktreeRoot, capture.path, capture)
            if (footer && event.result) {
              const updatedContent = appendTextToToolResultContent(event.result.content, `\n\n${footer}`)
              event.result = {
                ...event.result,
                content: updatedContent as typeof event.result.content,
              }
            }
          } finally {
            db.close()
          }
        } catch {
          // Non-fatal: never block host read tool completion if AST indexing fails
        }
      })
    }

    // 4. OpenCode V2 RPC Server Registration for TUI Inspector (`tui.tsx`) (A1 / P-2)
    let rpcHandle: {
      emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void
      events?: { emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void }
    } | null = null
    if (typeof ctx.rpc?.register === "function") {
      try {
        rpcHandle = (await ctx.rpc.register(substrateRpcContract, {
          snapshot: async (input: SubstrateSnapshotInput) => {
            const { db } = ensureSyncedDb(input?.sessionID)
            try {
              return buildSubstrateSnapshot(db, {
                projectRoot: activeWorktreeRoot,
                archiveDir,
                indexDbPath,
                sessionID: input?.sessionID,
              })
            } finally {
              db.close()
            }
          },
          action: async (input: SubstrateActionInput) => {
            if (input.action === "prune") {
              const valveRes = await executeValve(
                {
                  action: "prune",
                  mode: input.mode === "manual" ? "step-window" : "step-window",
                  keepRecentSteps: input.keepRecentSteps,
                  sessionID: input.sessionID,
                },
                { sessionID: input.sessionID },
              )
              const { db } = ensureSyncedDb(input.sessionID)
              try {
                const snap = buildSubstrateSnapshot(db, {
                  projectRoot: activeWorktreeRoot,
                  archiveDir,
                  indexDbPath,
                  sessionID: input.sessionID,
                })
                return {
                  ok: true,
                  action: "prune",
                  resolvedSessionID: snap.resolvedSessionID,
                  markdown: valveRes.content,
                  tokenEstimate: estimateTokens(valveRes.content),
                  snapshot: snap,
                }
              } finally {
                db.close()
              }
            }
            const { db } = ensureSyncedDb(input.sessionID)
            try {
              return await executeSubstrateAction(db, input, {
                projectRoot: activeWorktreeRoot,
                archiveDir,
                indexDbPath,
                sessionID: input.sessionID,
              })
            } finally {
              db.close()
            }
          },
        })) as unknown as {
          emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void
          events?: { emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void }
        }
      } catch {
        // Ignore if host RPC is already registered or unsupported in test harness
      }
    }

    // 5. Background event subscriber on idle / compacted (REQ-SUB-06, REQ-SUB-17)
    const handleSubscribedEvent = (event: unknown) => {
        const evtAny = event as unknown as {
          type?: string
          sessionID?: string
          status?: { type?: string }
          summary?: string
          properties?: { sessionID?: string; status?: { type?: string }; summary?: string }
          data?: { sessionID?: string; status?: { type?: string }; summary?: string }
        }
        const eventType = String(evtAny?.type ?? "")
        const statusType =
          evtAny?.properties?.status?.type ??
          evtAny?.data?.status?.type ??
          evtAny?.status?.type
        const isIdle = eventType === "session.status" && statusType === "idle"
        const isCompacted = eventType === "session.compacted"
        if (!isIdle && !isCompacted) return

        const sessionID =
          evtAny?.properties?.sessionID ??
          evtAny?.data?.sessionID ??
          evtAny?.sessionID ??
          undefined
        const { db } = ensureSyncedDb(sessionID)
        try {
          if (isCompacted && sessionID) {
            const summaryText = String(
              evtAny?.properties?.summary ?? evtAny?.data?.summary ?? evtAny?.summary ?? "session.compacted",
            )
            recordCompactionSummaryHash(db, sessionID, summaryText)
          }
          const payload = {
            sessionID,
            action: isCompacted ? "compacted" : "idle",
            updatedAt: new Date().toISOString(),
          }
          rpcHandle?.events?.emit?.(SUBSTRATE_UPDATED_EVENT, payload)
          rpcHandle?.emit?.(SUBSTRATE_UPDATED_EVENT, payload)

          if (sessionID) {
            try {
              const trace = buildTrace({
                root: activeWorktreeRoot,
                hostDbPath: dbPath,
                sessionID,
                archiveDbPath: indexDbPath,
              })
              const head = trace.change.base || ""
              const previousHead = lastHeadBySession.get(sessionID)
              lastHeadBySession.set(sessionID, head)
              const finalTrace =
                trace.change.counts.material === 0 && previousHead && head && previousHead !== head
                  ? buildTrace({
                      root: activeWorktreeRoot,
                      hostDbPath: dbPath,
                      sessionID,
                      commit: head,
                      archiveDbPath: indexDbPath,
                    })
                  : trace
              if (finalTrace.signal) {
                ensureTraceSchema(db)
                const prev = pendingSignals.get(sessionID)
                if (prev?.consumed) {
                  markSignalConsumed(db, sessionID, prev.id)
                }
                const stored = persistTrace(db, finalTrace.change, finalTrace.signal)
                const alreadyConsumed =
                  (prev?.id === finalTrace.change.id && prev.consumed) || stored.alreadyConsumed
                pendingSignals.set(sessionID, {
                  id: finalTrace.change.id,
                  text: finalTrace.signal,
                  consumed: alreadyConsumed,
                })
                const tracePayload = {
                  sessionID,
                  action: "trace",
                  changeId: finalTrace.change.id,
                  updatedAt: new Date().toISOString(),
                }
                rpcHandle?.events?.emit?.(SUBSTRATE_UPDATED_EVENT, tracePayload)
                rpcHandle?.emit?.(SUBSTRATE_UPDATED_EVENT, tracePayload)
              }
            } catch {
              // Trace is advisory; never block idle.
            }
          }
        } catch {
          // ignore non-fatal subscriber error
        } finally {
          db.close()
        }
      }
    if (typeof ctx.event?.subscribe === "function") {
      const subscribeFn = ctx.event.subscribe as unknown as (
        arg?: ((event: unknown) => void) | Record<string, unknown>,
      ) => unknown
      const subResult = await subscribeFn(handleSubscribedEvent)
      if (subResult && typeof (subResult as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function") {
        void (async () => {
          try {
            for await (const evt of subResult as AsyncIterable<unknown>) {
              handleSubscribedEvent(evt)
            }
          } catch {
            // Event stream closed
          }
        })()
      }
    }

    // 6. Consolidated 4-Tool Surface (A2 / P-4):
    //    2 canonical tools (substrate.valve, substrate.viewport) +
    //    2 legacy plugin aliases (archive.persist, ctx.context-prune).
    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "substrate",
        description: "Unified Hivemind Context & Working-Memory Substrate (valve + viewport)",
      })
      editor.namespace({
        name: "archive",
        description: "Deterministic session transcript archive",
      })
      editor.namespace({
        name: "ctx",
        description: "Working-set context pruning compatibility alias",
      })

      editor.add({
        name: "valve",
        options: { namespace: "substrate", codemode },
        description:
          "Control the hybrid assistant step-watermark WorkingSetValve (prune | status | reset). Replaces older tool outputs with content-addressed FactBreadcrumbs and injects the 3-state Working-Memory Manifest (FRESH | SLICE | STALE).",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["prune", "status", "reset"] },
            mode: { type: "string", enum: ["step-window", "recent", "initial", "all"] },
            keepRecentSteps: { type: "number" },
            sessionID: { type: "string" },
            full: { type: "boolean" },
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: true,
        },
        execute: executeValve as unknown as ToolExecute,
      })

      editor.add({
        name: "viewport",
        options: { namespace: "substrate", codemode },
        description:
          "Query the 4-tier Hivemind Substrate viewport (trace | status | resolve | timeline | provenance | compaction | sync | persist | search | find | repomap | skeleton | slice | coupled | brief | intents | latest). trace returns the live change-set package from real git plus the host tool ledger; pass change or handle for the leaf.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "trace",
                "status",
                "resolve",
                "timeline",
                "provenance",
                "compaction",
                "sync",
                "persist",
                "search",
                "find",
                "repomap",
                "skeleton",
                "slice",
                "coupled",
                "brief",
                "intents",
                "latest",
              ],
            },
            sessionID: { type: "string" },
            scope: { type: "string", enum: ["session", "project", "all-projects"] },
            query: { type: "string" },
            blob: { type: "string" },
            change: { type: "string", description: "Change id from the substrate signal (trace only)." },
            handle: { type: "string", description: "Leaf handle <change-id>:<branch> (trace only)." },
            branch: { type: "string", description: "Leaf branch when no handle is given (trace only)." },
            commit: { type: "string", description: "Trace a committed change instead of the working tree (trace only)." },
            detail: { type: "string", enum: ["package", "leaf"], description: "Package (default) or leaf (trace only)." },
            path: { type: "string" },
            symbol: { type: "string" },
            targetPaths: { type: "array", items: { type: "string" } },
            symbolNames: { type: "array", items: { type: "string" } },
            maxTokens: { type: "number" },
            startLine: { type: "number" },
            endLine: { type: "number" },
            includePrivate: { type: "boolean" },
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: true,
        },
        execute: executeViewport as unknown as ToolExecute,
      })

      // Backwards-compatible legacy plugin aliases (A2 / REQ-SUB-17)
      editor.add({
        name: "persist",
        options: { namespace: "archive", codemode },
        description:
          "Persist the current session tree into the project's .session-archive transcript archive and SQLite index.",
        input: {
          type: "object",
          properties: {
            sessionID: {
              type: "string",
              description: "Session to persist; defaults to the current session. The whole tree from the root is archived.",
            },
            scope: { type: "string", enum: ["session", "project", "all-projects"] },
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: true,
        },
        execute: executePersist as unknown as ToolExecute,
      })

      editor.add({
        name: "context-prune",
        options: { namespace: "ctx", codemode },
        description: "Backwards-compatible alias for substrate.valve (prune | status | reset).",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["prune", "status", "reset"] },
            mode: { type: "string", enum: ["step-window", "recent", "initial", "all"] },
            keepRecentSteps: { type: "number" },
            sessionID: { type: "string" },
            full: { type: "boolean" },
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: true,
        },
        execute: executeValve as unknown as ToolExecute,
      })
    })
  },
} satisfies Plugin.Plugin
