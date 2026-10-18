// hivemind-substrate (session-archive) — Unified OpenCode V2 Context & Working-Memory Substrate plugin.
//
// Install: build with `bun run build`, then copy dist/session-archive.ts into
// <project>/.opencode/plugins/ (project scope) or ~/.config/opencode/plugins/
// (global). The host supplies the "@opencode/plugin" runtime module — imports
// here stay type-only.

import { Database } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"

type ToolExecute = Parameters<Parameters<Plugin.Context["tool"]["transform"]>[0]>[0]["add"] extends (tool: infer T) => void ? (T extends { execute: infer E } ? E : never) : never
import { persist, sqliteSource, type PersistReport } from "./archive/index.ts"
import { initSyncDatabase } from "./archive/index-db.ts"
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

function formatToolOutput(params: {
  readonly action: string
  readonly markdown: string
  readonly metadata: Record<string, unknown>
  readonly format?: unknown
  readonly elapsedMs?: number
  readonly skipFooter?: boolean
}): { readonly content: string; readonly metadata: Record<string, unknown> } {
  const fmt: OutputFormat =
    params.format === "json" || params.format === "both" ? params.format : "markdown"
  const tokens = estimateTokens(params.markdown)
  const enrichedMeta: Record<string, unknown> = {
    action: params.action,
    tokens,
    ...(params.elapsedMs !== undefined ? { latencyMs: Number(params.elapsedMs.toFixed(2)) } : {}),
    ...params.metadata,
  }

  if (fmt === "json") {
    return {
      content: JSON.stringify(enrichedMeta, null, 2),
      metadata: enrichedMeta,
    }
  }

  const footer =
    params.skipFooter || params.markdown.includes("[substrate.telemetry")
      ? ""
      : `\n\n---\n[substrate.telemetry action=${params.action} tokens=${tokens}${
          params.elapsedMs !== undefined ? ` latencyMs=${params.elapsedMs.toFixed(2)}` : ""
        }]`
  const markdownWithFooter = `${params.markdown}${footer}`

  if (fmt === "both") {
    return {
      content: `${markdownWithFooter}\n\n\`\`\`json\n${JSON.stringify(enrichedMeta, null, 2)}\n\`\`\``,
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
  id: "session-archive",
  async setup(ctx: Plugin.Context) {
    const dir = typeof ctx.options?.dir === "string" ? ctx.options.dir : undefined
    const dbPath = typeof ctx.options?.dbPath === "string" ? ctx.options.dbPath : defaultDbPath()
    const codemode = ctx.options?.direct === true ? false : true
    const projectRoot = ctx.location.project.canonical
    const projectID = ctx.location.project.id
    const archiveDir = resolveArchiveDir(projectRoot, dir)
    const blobDir = path.join(archiveDir, "blobs")
    const indexDbPath = path.join(archiveDir, "index.sqlite")

    const valve = new WorkingSetValve({
      blobDir,
      readOnlyArchiveDir: archiveDir,
      persistBlobsToDisk: true,
      canonicalRoot: projectRoot,
    })

    const ensureSyncedDb = (targetSessionID?: string): { db: Database; report?: PersistReport } => {
      mkdirSync(archiveDir, { recursive: true })
      let report: PersistReport | undefined
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
              report = persist(
                {
                  sessionID: candidateSession,
                  projectID,
                  projectRoot,
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
        materializeSemanticDigests(db, { archiveDir })
      } catch {
        // Best-effort digest materialization
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
      if (typeof context?.progress === "function") {
        await context.progress({ status: `persisting session tree for ${requestedSessionID}` })
      }
      const source = sqliteSource(dbPath)
      try {
        const report = persist(
          {
            sessionID: requestedSessionID,
            projectID,
            projectRoot,
            dir,
          },
          source,
        )
        const summary = [
          `Persisted session tree rooted at ${report.rootID} into ${report.archiveDir}.`,
          `${report.sessions} sessions, ${report.messages} messages, ${report.delegations} delegations.`,
          `${report.written.length} files written, ${report.unchanged} unchanged.`,
          ...(report.warnings && report.warnings.length > 0 ? [`Warnings: ${report.warnings.join("; ")}`] : []),
        ].join(" ")
        return formatToolOutput({
          action: "sync",
          markdown: summary,
          metadata: report as unknown as Record<string, unknown>,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      } finally {
        source.close()
      }
    }

    const executeValve = async (input: Record<string, unknown> | undefined, context: { sessionID?: string } | undefined) => {
      const t0 = performance.now()
      const action = String(input?.action ?? "prune").toLowerCase()
      const sessionID = resolveSessionIdForCall(input?.sessionID, context?.sessionID)

      if (action === "status") {
        const res = valve.status(sessionID)
        const md = res.armed || res.manifestMarkdown.includes("SLICE") || res.manifestMarkdown.includes("FRESH")
          ? `${res.summaryMarkdown}\n\n${res.manifestMarkdown}`
          : res.summaryMarkdown
        return formatToolOutput({
          action: "valve.status",
          markdown: md,
          metadata: res as unknown as Record<string, unknown>,
          format: input?.format,
          elapsedMs: performance.now() - t0,
        })
      }
      if (action === "reset") {
        const res = valve.reset(sessionID)
        return formatToolOutput({
          action: "valve.reset",
          markdown: res.summaryMarkdown,
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
      const markdown =
        res.ledger.manifest.filesRead.length > 0 ||
        res.ledger.manifest.filesModified.length > 0 ||
        res.ledger.manifest.activeSkills.length > 0
          ? `${res.summaryMarkdown}\n\n${res.ledger.manifest.renderedMarkdown}`
          : res.summaryMarkdown

      return formatToolOutput({
        action: "valve.prune",
        markdown,
        metadata: res as unknown as Record<string, unknown>,
        format: input?.format,
        elapsedMs: performance.now() - t0,
      })
    }

    const executeViewport = async (
      input: Record<string, unknown> | undefined,
      context: { sessionID?: string; progress?: (p: { status: string }) => Promise<void> } | undefined,
    ): Promise<{ content: string; metadata: Record<string, unknown> }> => {
      const t0 = performance.now()
      const action = String(input?.action ?? "status").toLowerCase()

      if (action === "sync" || action === "persist") {
        return executePersist(input, context)
      }

      if (action === "resolve") {
        const blobId = String(input?.blob ?? input?.blobRef ?? input?.sha ?? "").trim()
        const startLine = typeof input?.startLine === "number" ? input.startLine : undefined
        const endLine = typeof input?.endLine === "number" ? input.endLine : undefined
        const resolved = valve.resolveBlob(blobId, { startLine, endLine })
        if (resolved) {
          return formatToolOutput({
            action: "resolve",
            markdown: resolved.slice,
            metadata: resolved as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
            skipFooter: input?.format === undefined,
          })
        }
        const fromArchive = valve.resolve(blobId)
        if (fromArchive) {
          return formatToolOutput({
            action: "resolve",
            markdown: fromArchive,
            metadata: { blobRef: blobId, content: fromArchive },
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

      const explicitSession = typeof input?.sessionID === "string" ? input.sessionID : undefined
      const hookSession = typeof context?.sessionID === "string" ? context.sessionID : undefined
      const { db } = ensureSyncedDb(explicitSession ?? hookSession)

      try {
        const resolvedSession = resolveDefaultSessionId(db, explicitSession, { sessionID: hookSession })
        const sessionID = resolvedSession.sessionId

        if (action === "repomap") {
          indexCodebase(db, projectRoot)
          computeCodebasePageRank(db)
          const budgetTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1000
          const focusPaths = Array.isArray(input?.focusPaths) ? input.focusPaths.map(String) : undefined
          const rendered = renderRepoMap(db, { budgetTokens, focusPaths })
          return formatToolOutput({
            action: "repomap",
            markdown: rendered.markdown,
            metadata: rendered as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "skeleton") {
          indexCodebase(db, projectRoot)
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const skel = readAstSkeleton(db, targetPath)
          const skelObj = skel && typeof skel === "object" ? (skel as unknown as Record<string, unknown>) : null
          const text =
            typeof skel === "string"
              ? skel
              : String(skelObj?.skeleton_text ?? skelObj?.skeletonText ?? `No skeleton found for ${targetPath}`)
          return formatToolOutput({
            action: "skeleton",
            markdown: text,
            metadata: { path: targetPath, skeleton: skel },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "slice") {
          indexCodebase(db, projectRoot)
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const symbol =
            typeof input?.symbol === "string"
              ? input.symbol
              : typeof input?.qualifiedName === "string"
                ? input.qualifiedName
                : {
                    startLine: Number(input?.startLine ?? 1),
                    endLine: Number(input?.endLine ?? 50),
                  }
          const slice = readSymbolSlice(db, projectRoot, targetPath, symbol)
          const sliceObj = slice && typeof slice === "object" ? (slice as unknown as Record<string, unknown>) : null
          const text =
            typeof slice === "string"
              ? slice
              : String(sliceObj?.slice_text ?? sliceObj?.sliceText ?? `Symbol slice not found for ${targetPath}`)
          return formatToolOutput({
            action: "slice",
            markdown: text,
            metadata: sliceObj ?? { path: targetPath },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "coupled") {
          indexCodebase(db, projectRoot)
          try {
            mineGitCochange(db, projectRoot)
          } catch {
            // ignore if projectRoot is not a git repo
          }
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const couplings = queryCochangeCouplings(db, targetPath)
          const warnings = renderCochangeWarnings(db, [targetPath])
          return formatToolOutput({
            action: "coupled",
            markdown: warnings || `No co-change couplings above threshold for ${targetPath}.`,
            metadata: { path: targetPath, couplings },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "brief") {
          indexCodebase(db, projectRoot)
          computeCodebasePageRank(db)
          try {
            mineGitCochange(db, projectRoot)
          } catch {
            // ignore if projectRoot is not a git repo
          }
          const targetPaths = Array.isArray(input?.targetPaths)
            ? input.targetPaths.map(String)
            : typeof input?.path === "string"
              ? [input.path]
              : []
          const symbolNames = Array.isArray(input?.symbolNames) ? input.symbolNames.map(String) : undefined
          const maxTokens = typeof input?.maxTokens === "number" ? input.maxTokens : 1500
          const brief = buildImplementorViewportBrief(db, {
            targetPaths,
            symbolNames,
            sessionID,
            rootDir: projectRoot,
            maxTokens,
          })
          return formatToolOutput({
            action: "brief",
            markdown: brief.markdown,
            metadata: brief as unknown as Record<string, unknown>,
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "search") {
          const query = String(input?.query ?? input?.q ?? "")
          const nav = queryVibeNavigation(db, query, {
            limit: typeof input?.limit === "number" ? input.limit : 5,
            maxTokens: typeof input?.maxTokens === "number" ? input.maxTokens : 600,
          })
          return formatToolOutput({
            action: "search",
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
            markdown: content,
            metadata: timelineObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        if (action === "provenance") {
          reconcileProvenanceStaleness(db, projectRoot, sessionID)
          const report = renderProvenanceReport(db, sessionID)
          const reportObj =
            report && typeof report === "object" ? (report as unknown as Record<string, unknown>) : null
          const content =
            typeof report === "string" ? report : String(reportObj?.markdown ?? JSON.stringify(report))
          return formatToolOutput({
            action: "provenance",
            markdown: content,
            metadata: reportObj ?? { sessionID },
            format: input?.format,
            elapsedMs: performance.now() - t0,
          })
        }

        // Default: status / overview / latest / session
        reconcileProvenanceStaleness(db, projectRoot, sessionID)
        const result = querySubstrateContinuity(
          db,
          { action: action as "status", sessionID, query: typeof input?.query === "string" ? input.query : undefined },
          { sessionID: hookSession },
        )
        const resObj = result as unknown as Record<string, unknown>
        const markdown = String(resObj.content ?? resObj.markdown ?? JSON.stringify(result))
        return formatToolOutput({
          action,
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
        valve.applyContextHookInMemory(event as unknown as Parameters<typeof valve.applyContextHookInMemory>[0])
      })

      // 2. SQLite-backed compaction continuity hook (REQ-SUB-14, REQ-SUB-15, REQ-SUB-16, REQ-SUB-17)
      await ctx.session.hook("compaction", (event) => {
        const hookSessionID = typeof event?.sessionID === "string" ? event.sessionID : undefined
        const { db } = ensureSyncedDb(hookSessionID)
        try {
          const resolved = resolveDefaultSessionId(db, hookSessionID, { sessionID: hookSessionID })
          reconcileProvenanceStaleness(db, projectRoot, resolved.sessionId)
          const packet = buildCompactionContinuationPacket(db, {
            sessionID: resolved.sessionId,
            hookContext: { sessionID: hookSessionID },
            canonicalRoot: projectRoot,
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

    // 3. JIT Read Skeleton Interception via ctx.tool.hook("execute.after") (A3 / P-1 / P-8)
    if (typeof ctx.tool?.hook === "function") {
      await ctx.tool.hook("execute.after", (event) => {
        if (event.status !== "completed" || event.tool !== "read") return
        const rawText = extractToolResultText(event.result?.content)
        if (!rawText) return

        const inputObj =
          event.input && typeof event.input === "object" && !Array.isArray(event.input)
            ? (event.input as Record<string, unknown>)
            : {}

        const capture = valve.recordReadFromHook({
          sessionID: event.sessionID,
          callId: event.id,
          input: inputObj,
          rawOutput: rawText,
          canonicalRoot: projectRoot,
        })

        const isPartialOrTruncated =
          capture.isTruncated ||
          (capture.totalLines !== null && capture.endLine < capture.totalLines)
        if (!isPartialOrTruncated || rawText.includes(JIT_SKELETON_MARKER)) return

        try {
          const { db } = ensureSyncedDb(event.sessionID)
          try {
            const footer = buildJitReadSkeletonFooter(db, projectRoot, capture.path, capture)
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
    let rpcHandle: { emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void } | null = null
    if (typeof ctx.rpc?.register === "function") {
      try {
        rpcHandle = (await ctx.rpc.register(substrateRpcContract, {
          snapshot: async (input: SubstrateSnapshotInput) => {
            const { db } = ensureSyncedDb(input?.sessionID)
            try {
              return buildSubstrateSnapshot(db, {
                projectRoot,
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
                  projectRoot,
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
                projectRoot,
                archiveDir,
                indexDbPath,
                sessionID: input.sessionID,
              })
            } finally {
              db.close()
            }
          },
        })) as unknown as { emit?: (event: string, data: { sessionID?: string; action: string; updatedAt: string }) => void }
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
          rpcHandle?.emit?.(SUBSTRATE_UPDATED_EVENT, {
            sessionID,
            action: isCompacted ? "compacted" : "idle",
            updatedAt: new Date().toISOString(),
          })
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
          "Query the 4-tier Hivemind Substrate viewport (status | resolve | timeline | provenance | sync | search | repomap | skeleton | slice | coupled | brief | intents | latest).",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: [
                "status",
                "resolve",
                "timeline",
                "provenance",
                "sync",
                "search",
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
            query: { type: "string" },
            blob: { type: "string" },
            path: { type: "string" },
            symbol: { type: "string" },
            targetPaths: { type: "array", items: { type: "string" } },
            symbolNames: { type: "array", items: { type: "string" } },
            maxTokens: { type: "number" },
            startLine: { type: "number" },
            endLine: { type: "number" },
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
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: false,
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
            format: { type: "string", enum: ["markdown", "json", "both"] },
          },
          additionalProperties: true,
        },
        execute: executeValve as unknown as ToolExecute,
      })
    })
  },
} satisfies Plugin.Plugin
