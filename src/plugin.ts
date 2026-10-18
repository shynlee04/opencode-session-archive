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
import { persist, sqliteSource, type PersistReport } from "./archive/index.ts"
import { initSyncDatabase } from "./archive/index-db.ts"
import {
  WorkingSetValve,
  applyContextHookInMemory,
  computeStepWatermark,
  type PruningMode,
} from "./archive/valve.ts"
import {
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
  WorkingSetValve,
  applyContextHookInMemory,
  buildCompactionContinuationPacket,
  buildImplementorViewportBrief,
  computeCodebasePageRank,
  computeStepWatermark,
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
  sqliteSource,
}

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

    const valve = new WorkingSetValve({
      blobDir,
      readOnlyArchiveDir: archiveDir,
      persistBlobsToDisk: true,
    })

    const ensureSyncedDb = (targetSessionID?: string): { db: Database; report?: PersistReport } => {
      mkdirSync(archiveDir, { recursive: true })
      const indexDbPath = path.join(archiveDir, "index.sqlite")
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

    const executePersist = async (input: any, context: any) => {
      const requestedSessionID =
        typeof input?.sessionID === "string" && input.sessionID.trim().length > 0
          ? input.sessionID.trim()
          : (context?.sessionID ?? "")
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
        return {
          content: [
            `Persisted session tree rooted at ${report.rootID} into ${report.archiveDir}.`,
            `${report.sessions} sessions, ${report.messages} messages, ${report.delegations} delegations.`,
            `${report.written.length} files written, ${report.unchanged} unchanged.`,
          ].join(" "),
          metadata: report,
        }
      } finally {
        source.close()
      }
    }

    const executeValve = async (input: any, context: any) => {
      const action = String(input?.action ?? "prune").toLowerCase()
      const sessionID =
        typeof input?.sessionID === "string" && input.sessionID.trim().length > 0
          ? input.sessionID.trim()
          : String(context?.sessionID ?? "default")

      if (action === "status") {
        const res = valve.status(sessionID)
        return { content: res.summaryMarkdown, metadata: res }
      }
      if (action === "reset") {
        const res = valve.reset(sessionID)
        return { content: res.summaryMarkdown, metadata: res }
      }

      const mode: PruningMode =
        input?.mode === "recent" || input?.mode === "initial" || input?.mode === "all"
          ? input.mode
          : "step-window"
      const keepRecentSteps =
        typeof input?.keepRecentSteps === "number" && Number.isFinite(input.keepRecentSteps)
          ? input.keepRecentSteps
          : undefined

      const messages: Record<string, any>[] =
        typeof (ctx as any).session?.messages === "function"
          ? await (ctx as any).session.messages({ sessionID })
          : []

      const res = valve.prune({
        sessionID,
        mode,
        keepRecentSteps,
        messages,
      })
      return { content: res.summaryMarkdown, metadata: res }
    }

    const executeViewport = async (input: any, context: any): Promise<{ content: string; metadata: Record<string, any> }> => {
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
          return {
            content: resolved.slice,
            metadata: resolved,
          }
        }
        const fromArchive = valve.resolve(blobId)
        if (fromArchive) {
          return {
            content: fromArchive,
            metadata: { blobRef: blobId, content: fromArchive },
          }
        }
        return {
          content: `Blob not found: ${blobId}`,
          metadata: { found: false, blob: blobId },
        }
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
          const focusPaths = Array.isArray(input?.focusPaths) ? input.focusPaths : undefined
          const rendered = renderRepoMap(db, { budgetTokens, focusPaths })
          return { content: rendered.markdown, metadata: rendered }
        }

        if (action === "skeleton") {
          indexCodebase(db, projectRoot)
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const skel = readAstSkeleton(db, targetPath)
          const text = typeof skel === "string" ? skel : ((skel as any)?.skeleton_text ?? (skel as any)?.skeletonText ?? `No skeleton found for ${targetPath}`)
          return { content: text, metadata: { path: targetPath, skeleton: skel } }
        }

        if (action === "slice") {
          indexCodebase(db, projectRoot)
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const symbol = input?.symbol ?? input?.qualifiedName ?? {
            startLine: Number(input?.startLine ?? 1),
            endLine: Number(input?.endLine ?? 50),
          }
          const slice = readSymbolSlice(db, projectRoot, targetPath, symbol)
          const text = typeof slice === "string" ? slice : ((slice as any)?.slice_text ?? (slice as any)?.sliceText ?? `Symbol slice not found for ${targetPath}`)
          return { content: text, metadata: (slice ?? { path: targetPath }) as Record<string, unknown> }
        }

        if (action === "coupled") {
          indexCodebase(db, projectRoot)
          try { mineGitCochange(db, projectRoot) } catch {}
          const targetPath = String(input?.path ?? input?.filePath ?? "")
          const couplings = queryCochangeCouplings(db, targetPath)
          const warnings = renderCochangeWarnings(db, [targetPath])
          return {
            content: warnings || `No co-change couplings above threshold for ${targetPath}.`,
            metadata: { path: targetPath, couplings },
          }
        }

        if (action === "brief") {
          indexCodebase(db, projectRoot)
          computeCodebasePageRank(db)
          try { mineGitCochange(db, projectRoot) } catch {}
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
          return { content: brief.markdown, metadata: brief }
        }

        if (action === "search") {
          const query = String(input?.query ?? input?.q ?? "")
          const nav = queryVibeNavigation(db, query, {
            limit: typeof input?.limit === "number" ? input.limit : 5,
            maxTokens: typeof input?.maxTokens === "number" ? input.maxTokens : 600,
          })
          return { content: nav.markdown, metadata: nav }
        }

        if (action === "timeline" || action === "intents") {
          const timeline = renderIntentTimeline(db, sessionID)
          const content = typeof timeline === "string" ? timeline : ((timeline as any).markdown ?? JSON.stringify(timeline))
          return { content, metadata: typeof timeline === "object" && timeline !== null ? (timeline as Record<string, any>) : { sessionID } }
        }

        if (action === "provenance") {
          reconcileProvenanceStaleness(db, projectRoot, sessionID)
          const report = renderProvenanceReport(db, sessionID)
          const content = typeof report === "string" ? report : ((report as any).markdown ?? JSON.stringify(report))
          return { content, metadata: typeof report === "object" && report !== null ? (report as Record<string, any>) : { sessionID } }
        }

        // Default: status / overview / latest / session
        reconcileProvenanceStaleness(db, projectRoot, sessionID)
        const result = querySubstrateContinuity(
          db,
          { action: action as any, sessionID, query: input?.query },
          { sessionID: hookSession },
        )
        return { content: (result as any).content ?? (result as any).markdown ?? JSON.stringify(result), metadata: result }
      } finally {
        db.close()
      }
    }

    // Lifecycle hooks:
    // 1. < 2 ms in-memory context hook (REQ-SUB-07, REQ-SUB-08, REQ-SUB-17)
    if (typeof (ctx as any).session?.hook === "function") {
      ;(ctx as any).session.hook("context", (event: any) => {
        valve.applyContextHookInMemory(event)
      })

      // 2. SQLite-backed compaction continuity hook (REQ-SUB-14, REQ-SUB-15, REQ-SUB-16, REQ-SUB-17)
      ;(ctx as any).session.hook("compaction", (event: any) => {
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
          if (typeof event.prompt === "string") {
            event.prompt = `${event.prompt}\n\n${packet.markdown}`
          } else if (event && typeof event === "object") {
            event.prompt = packet.markdown
          }
          if (Array.isArray(event?.context)) {
            event.context.push(packet.markdown)
          }
        } finally {
          db.close()
        }
      })
    }

    // 3. Background event subscriber on idle / compacted (REQ-SUB-06, REQ-SUB-17)
    if (typeof (ctx as any).event?.subscribe === "function") {
      ;(ctx as any).event.subscribe((event: any) => {
        const eventType = String(event?.type ?? "")
        const isIdle =
          eventType === "session.status" &&
          (event?.properties?.status?.type === "idle" || event?.status?.type === "idle")
        const isCompacted = eventType === "session.compacted"
        if (!isIdle && !isCompacted) return

        const sessionID =
          event?.properties?.sessionID ??
          event?.sessionID ??
          undefined
        const { db } = ensureSyncedDb(sessionID)
        try {
          if (isCompacted && sessionID) {
            const summaryText = String(event?.properties?.summary ?? event?.summary ?? "session.compacted")
            recordCompactionSummaryHash(db, sessionID, summaryText)
          }
        } catch {} finally {
          db.close()
        }
      })
    }

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
          "Control the hybrid assistant step-watermark WorkingSetValve (prune | status | reset). Replaces older tool outputs with content-addressed FactBreadcrumbs and injects the Working-Memory Manifest.",
        input: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["prune", "status", "reset"] },
            mode: { type: "string", enum: ["step-window", "recent", "initial", "all"] },
            keepRecentSteps: { type: "number" },
            sessionID: { type: "string" },
          },
          additionalProperties: true,
        },
        execute: executeValve,
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
          },
          additionalProperties: true,
        },
        execute: executeViewport,
      })

      // Backwards-compatible aliases (WF-SUB-08 Q1 / REQ-SUB-17)
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
          },
          additionalProperties: false,
        },
        execute: executePersist,
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
          },
          additionalProperties: true,
        },
        execute: executeValve,
      })

      editor.add({
        name: "substrate",
        options: { codemode },
        description: "Direct action-multiplexed entry point for substrate.viewport and substrate.valve.",
        input: {
          type: "object",
          properties: {
            action: { type: "string" },
            sessionID: { type: "string" },
            query: { type: "string" },
            path: { type: "string" },
            blob: { type: "string" },
          },
          additionalProperties: true,
        },
        execute: async (input: any, context: any) => {
          const act = String(input?.action ?? "status").toLowerCase()
          if (act === "prune" || act === "reset") {
            return executeValve(input, context)
          }
          return executeViewport(input, context)
        },
      })

      editor.add({
        name: "viewport",
        options: { codemode },
        description: "Direct alias for substrate.viewport.",
        input: {
          type: "object",
          properties: {
            action: { type: "string" },
            sessionID: { type: "string" },
            query: { type: "string" },
            path: { type: "string" },
            blob: { type: "string" },
          },
          additionalProperties: true,
        },
        execute: executeViewport,
      })
    })
  },
} satisfies Plugin.Plugin
