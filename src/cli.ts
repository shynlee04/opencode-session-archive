import { existsSync, mkdirSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Database } from "bun:sqlite"
import * as archiveIndex from "./archive/index.ts"
import { ensureHoneycombSchema } from "./archive/index-db.ts"
import * as primitives from "./archive/primitives.ts"
import { estimateTokens, normalizeRepoPath } from "./archive/primitives.ts"
import {
  ensureCodeGraphSchema,
  indexCodebase,
  indexSingleFileSkeleton,
  readAstSkeleton,
  readSymbolSlice,
} from "./honeycomb/ast-skeleton.ts"
import {
  ensureCochangeSchema,
  mineGitCochange,
  renderCochangeWarnings,
} from "./honeycomb/cochange.ts"
import {
  computeCodebasePageRank,
  queryMudballAdvisor,
  renderRepoMap,
} from "./honeycomb/pagerank.ts"
import type {
  SubstrateActionInput,
  SubstrateActionKind,
  SubstrateActionOutput,
  SubstrateCentralFileSummary,
  SubstrateMudballHotspotSummary,
  SubstrateSnapshotOutput,
  SubstrateTokenEconomicsSummary,
} from "./rpc.ts"
import { buildImplementorViewportBrief } from "./viewports/brief.ts"
import {
  buildCompactionContinuationPacket,
  ensureContinuitySchema,
  isFreshOrSliceStatus,
  isSliceStatus,
  reconcileProvenanceStaleness,
  renderProvenanceReport,
  resolveDefaultSessionId,
  shortBlobRef,
} from "./viewports/continuity.ts"
import {
  ensureSemanticDigestSchema,
  materializeSemanticDigests,
  queryVibeNavigation,
  renderIntentTimeline,
} from "./viewports/semantic-digest.ts"

export interface SubstrateRuntimeContextOptions {
  readonly projectRoot?: string
  readonly archiveDir?: string
  readonly indexDbPath?: string
  readonly sessionID?: string
  readonly db?: Database
}

export interface ResolvedTargetWorkspace {
  readonly isExternal: boolean
  readonly projectRoot: string
  readonly targetRoot: string
  readonly relPath: string
  readonly absPath: string
  readonly indexDbPath: string
}

function expandHomeDir(inputPath: string): string {
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2))
  }
  return inputPath
}

export function resolveTargetWorkspace(
  targetPath: string | undefined,
  defaultProjectRoot: string,
): ResolvedTargetWorkspace {
  const normDefault = path.resolve(defaultProjectRoot)
  if (!targetPath || targetPath.trim().length === 0) {
    return {
      isExternal: false,
      projectRoot: normDefault,
      targetRoot: normDefault,
      relPath: "",
      absPath: normDefault,
      indexDbPath: path.join(normDefault, ".session-archive", "index.sqlite"),
    }
  }

  const primitivesResolver = (primitives as Record<string, unknown>).resolveTargetWorkspace
  if (typeof primitivesResolver === "function") {
    try {
      const delegated = primitivesResolver(targetPath, normDefault) as Partial<ResolvedTargetWorkspace> & {
        projectRoot?: string
        targetRoot?: string
        relPath?: string
        absPath?: string
        isExternal?: boolean
        indexDbPath?: string
      }
      if (delegated && (delegated.targetRoot || delegated.projectRoot)) {
        const tRoot = path.resolve(delegated.targetRoot ?? delegated.projectRoot ?? normDefault)
        const aPath = path.resolve(delegated.absPath ?? path.resolve(tRoot, delegated.relPath ?? ""))
        const isExt = delegated.isExternal ?? (tRoot !== normDefault && !tRoot.startsWith(`${normDefault}${path.sep}`))
        const rel = delegated.relPath ?? (aPath === tRoot ? "" : normalizeRepoPath(aPath, tRoot))
        return {
          isExternal: isExt,
          projectRoot: tRoot,
          targetRoot: tRoot,
          relPath: rel,
          absPath: aPath,
          indexDbPath: delegated.indexDbPath ?? path.join(tRoot, ".session-archive", "index.sqlite"),
        }
      }
    } catch {
      // fall through to built-in workspace resolution
    }
  }

  const expanded = expandHomeDir(targetPath.trim())
  const absPath = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(normDefault, expanded)

  const insideDefault =
    absPath === normDefault || absPath.startsWith(`${normDefault}${path.sep}`)
  if (insideDefault) {
    const relPath = absPath === normDefault ? "" : normalizeRepoPath(absPath, normDefault)
    return {
      isExternal: false,
      projectRoot: normDefault,
      targetRoot: normDefault,
      relPath,
      absPath,
      indexDbPath: path.join(normDefault, ".session-archive", "index.sqlite"),
    }
  }

  let startDir = absPath
  try {
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      startDir = path.dirname(absPath)
    }
  } catch {
    startDir = path.dirname(absPath)
  }

  let cursor = startDir
  let detectedRoot: string | null = null
  const homeDir = path.resolve(os.homedir())
  while (true) {
    if (
      existsSync(path.join(cursor, ".session-archive")) ||
      existsSync(path.join(cursor, ".git")) ||
      existsSync(path.join(cursor, "package.json")) ||
      existsSync(path.join(cursor, "tsconfig.json"))
    ) {
      detectedRoot = cursor
      break
    }
    const parent = path.dirname(cursor)
    if (parent === cursor || cursor === homeDir) break
    cursor = parent
  }

  const targetRoot = detectedRoot ?? startDir
  const relPath = absPath === targetRoot ? "" : normalizeRepoPath(absPath, targetRoot)
  return {
    isExternal: true,
    projectRoot: targetRoot,
    targetRoot,
    relPath,
    absPath,
    indexDbPath: path.join(targetRoot, ".session-archive", "index.sqlite"),
  }
}

function queryScalarCount(db: Database, sql: string, ...params: (string | number)[]): number {
  try {
    const row = db.query(sql).get(...params) as { c?: number } | null
    return typeof row?.c === "number" ? row.c : 0
  } catch {
    return 0
  }
}

export function ensureCodeGraphIndexed(db: Database, projectRoot: string): void {
  ensureCodeGraphSchema(db)
  ensureCochangeSchema(db)
  if (!projectRoot || !existsSync(projectRoot)) return
  try {
    const fileCountBefore = queryScalarCount(db, "SELECT COUNT(*) as c FROM code_file")
    const stats = indexCodebase(db, projectRoot)
    if (fileCountBefore <= 1 || stats.parsedFiles > 0 || stats.removedFiles > 0) {
      computeCodebasePageRank(db)
    }
    const cochangeCount = queryScalarCount(db, "SELECT COUNT(*) as c FROM git_cochange")
    if (cochangeCount === 0 && existsSync(path.join(projectRoot, ".git"))) {
      mineGitCochange(db, projectRoot)
    }
  } catch {
    // ignore if projectRoot has no parseable source files
  }
}

function withTargetWorkspaceDb<T>(
  ws: ResolvedTargetWorkspace,
  defaultDb: Database,
  fn: (targetDb: Database, targetRoot: string, relPath: string) => T,
): T {
  if (!ws.isExternal) {
    ensureCodeGraphIndexed(defaultDb, ws.targetRoot)
    return fn(defaultDb, ws.targetRoot, ws.relPath)
  }

  const useExistingDiskDb = existsSync(ws.indexDbPath)
  const extDb = new Database(useExistingDiskDb ? ws.indexDbPath : ":memory:")
  try {
    ensureContinuitySchema(extDb)
    ensureSemanticDigestSchema(extDb)
    ensureCodeGraphSchema(extDb)
    ensureCochangeSchema(extDb)
    ensureCodeGraphIndexed(extDb, ws.targetRoot)
    return fn(extDb, ws.targetRoot, ws.relPath)
  } finally {
    extDb.close()
  }
}

function resolveDbAndOptions(
  first?: Database | SubstrateRuntimeContextOptions,
  second?: SubstrateRuntimeContextOptions,
): { readonly db: Database; readonly ownDb: Database | null; readonly options: SubstrateRuntimeContextOptions } {
  if (first && typeof (first as Database).query === "function") {
    return {
      db: first as Database,
      ownDb: null,
      options: second ?? {},
    }
  }
  const opts = (first as SubstrateRuntimeContextOptions | undefined) ?? second ?? {}
  if (opts.db && typeof opts.db.query === "function") {
    return {
      db: opts.db,
      ownDb: null,
      options: opts,
    }
  }
  const projectRoot = opts.projectRoot ?? process.cwd()
  const archiveDir = opts.archiveDir ?? path.join(projectRoot, ".session-archive")
  const indexDbPath = opts.indexDbPath ?? path.join(archiveDir, "index.sqlite")
  mkdirSync(path.dirname(indexDbPath), { recursive: true })
  const opened = new Database(indexDbPath)
  return {
    db: opened,
    ownDb: opened,
    options: {
      ...opts,
      projectRoot,
      archiveDir,
      indexDbPath,
    },
  }
}

export function buildSubstrateSnapshot(
  first?: Database | SubstrateRuntimeContextOptions,
  second?: SubstrateRuntimeContextOptions,
): SubstrateSnapshotOutput {
  const { db, ownDb, options } = resolveDbAndOptions(first, second)
  try {
    ensureContinuitySchema(db)
    ensureSemanticDigestSchema(db)
    ensureCodeGraphSchema(db)
    ensureCochangeSchema(db)

    const projectRoot = options.projectRoot ?? process.cwd()
    const archiveDir = options.archiveDir ?? path.join(projectRoot, ".session-archive")
    const indexDbPath = options.indexDbPath ?? path.join(archiveDir, "index.sqlite")

    ensureCodeGraphIndexed(db, projectRoot)

    const resolved = resolveDefaultSessionId(db, options.sessionID)
    const resolvedSessionID = resolved.sessionId

    if (projectRoot) {
      try {
        reconcileProvenanceStaleness(db, {
          sessionID: resolvedSessionID,
          canonicalRoot: projectRoot,
        })
      } catch {
        // ignore reconciliation error on partial schemas
      }
    }

    const sessionRow = db
      .query("SELECT title FROM session WHERE id = ? LIMIT 1")
      .get(resolvedSessionID) as { title: string | null } | null
    const digestRow = db
      .query(
        "SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ? LIMIT 1",
      )
      .get(resolvedSessionID) as { headline: string | null; verification_state: string | null } | null

    const sessionTitle =
      sessionRow?.title || digestRow?.headline || `Session ${resolvedSessionID}`
    const verificationState = digestRow?.verification_state || "in_progress_or_unverified"

    const fileRows = db
      .query(
        "SELECT path, line_range, staleness_status FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC, path ASC",
      )
      .all(resolvedSessionID) as { path: string; line_range: string; staleness_status: string }[]

    const freshFiles = fileRows.filter(
      (f) => isFreshOrSliceStatus(f.staleness_status) && !isSliceStatus(f.staleness_status),
    ).length
    const sliceFiles = fileRows.filter((f) => isSliceStatus(f.staleness_status)).length
    const staleFiles = fileRows.filter((f) => !isFreshOrSliceStatus(f.staleness_status)).length

    const staleAlerts = fileRows
      .filter((f) => !isFreshOrSliceStatus(f.staleness_status) || isSliceStatus(f.staleness_status))
      .map((f) => ({
        path: f.path,
        lineRange: f.line_range,
        status: f.staleness_status,
      }))

    const recentPivots = (
      db
        .query(
          "SELECT seq, pivot_kind, prompt_excerpt, blob_ref FROM intent_pivot WHERE session_id = ? ORDER BY seq DESC LIMIT 5",
        )
        .all(resolvedSessionID) as {
        seq: number
        pivot_kind: string
        prompt_excerpt: string
        blob_ref: string
      }[]
    ).map((p) => ({
      seq: p.seq,
      pivotKind: p.pivot_kind,
      excerpt: p.prompt_excerpt,
      blobRef: shortBlobRef(p.blob_ref),
    }))

    const advisor = queryMudballAdvisor(db, {
      topKFiles: 12,
      maxOutlineSymbolsPerFile: 10,
    })

    const topCentralFiles: SubstrateCentralFileSummary[] = advisor.topFiles.map((f) => ({
      path: f.path,
      pagerank: f.pagerank,
      loc: f.loc,
      inDegree: f.inDegree,
      outDegree: f.outDegree,
      rawTokens: f.rawTokens,
      skeletonTokens: f.skeletonTokens,
      symbolsCount: f.symbolsCount,
      exportedSymbols: f.exportedSymbols.map((s) => ({
        name: s.name,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine,
        lineSpan: s.lineSpan,
        signature: s.signature,
      })),
    }))

    const mudballHotspots: SubstrateMudballHotspotSummary[] = advisor.hotspots.map((h) => ({
      kind: h.kind,
      severity: h.severity === "high" ? "high" : "warn",
      target: h.target,
      detail: h.detail,
      metric: h.metric,
    }))

    let latestValuation: SubstrateSnapshotOutput["latestValuation"] = null
    try {
      const valRow = db
        .query(
          "SELECT mode, step_count, watermark_step_index, saved_chars, saved_tokens FROM working_valve_state WHERE session_id = ? LIMIT 1",
        )
        .get(resolvedSessionID) as {
        mode: string
        step_count: number
        watermark_step_index: number
        saved_chars: number
        saved_tokens: number
      } | null
      if (valRow) {
        latestValuation = {
          mode: valRow.mode,
          stepCount: valRow.step_count,
          watermarkStepIndex: valRow.watermark_step_index,
          savedChars: valRow.saved_chars,
          savedTokens: valRow.saved_tokens,
        }
      }
    } catch {
      latestValuation = null
    }

    const valveSavedTokens = latestValuation?.savedTokens ?? 0
    const tokenEconomics: SubstrateTokenEconomicsSummary = {
      rawTokensTotal: advisor.rawTokensTotal,
      skeletonTokensTotal: advisor.skeletonTokensTotal,
      skeletonTokensSaved: advisor.tokensSavedTotal,
      compressionPct: advisor.compressionPct,
      valveSavedTokens,
    }

    const staleChains = queryScalarCount(
      db,
      "SELECT COUNT(*) as c FROM provenance_chain WHERE root_session_id = ? AND staleness_status IN ('verified_stale_by_later_touch', 'STALE (modified since read/review — re-verify slice)')",
      resolvedSessionID,
    )

    const passingReceipts = queryScalarCount(
      db,
      `SELECT COUNT(*) as c FROM provenance_chain
       WHERE root_session_id = ? AND verification_exit_code = 0
         AND COALESCE(verification_command, '') != ''
         AND staleness_status IN ('VERIFIED_FRESH', 'verified_fresh', 'SLICE_FRESH')`,
      resolvedSessionID,
    )
    const gateLabel =
      staleFiles > 0 || staleChains > 0
        ? `NEEDS RE-VERIFY (${staleFiles} stale files, ${staleChains} stale chains)`
        : verificationState === "verified_failed_or_blocked" || verificationState === "verified_fail"
          ? "FAILED / BLOCKED"
          : passingReceipts > 0
            ? "PASS (all verified files fresh)"
            : "UNVERIFIED (no passing verification receipt)"

    let compactionPreview = ""
    try {
      compactionPreview = buildCompactionContinuationPacket(db, {
        sessionID: resolvedSessionID,
        canonicalRoot: projectRoot,
        maxTokens: 1200,
      }).markdown
    } catch {
      compactionPreview = ""
    }

    return {
      projectRoot,
      archiveDir,
      indexDbPath,
      resolvedSessionID,
      sessionTitle,
      verificationState,
      gateLabel,
      counts: {
        sessions: queryScalarCount(db, "SELECT COUNT(*) as c FROM session"),
        rootSessions: queryScalarCount(db, "SELECT COUNT(*) as c FROM session WHERE depth = 0"),
        delegations: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM delegation_turn WHERE parent_session_id = ?",
          resolvedSessionID,
        ),
        flaggedDelegations: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM delegation_turn WHERE parent_session_id = ? AND (verified_outcome IN ('blocked_in_text', 'tool_error_inside') OR tool_error_count > 0)",
          resolvedSessionID,
        ),
        codeFiles: queryScalarCount(db, "SELECT COUNT(*) as c FROM code_file"),
        codeSymbols: queryScalarCount(db, "SELECT COUNT(*) as c FROM code_symbol"),
        cochangePairs: queryScalarCount(db, "SELECT COUNT(*) as c FROM git_cochange"),
        hiddenCochangePairs: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM git_cochange WHERE has_static_edge = 0",
        ),
        freshFiles,
        sliceFiles,
        staleFiles,
        activeSkills: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM skill_load_ledger WHERE session_id = ?",
          resolvedSessionID,
        ),
        provenanceChains: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM provenance_chain WHERE root_session_id = ?",
          resolvedSessionID,
        ),
        staleChains,
        compactions: queryScalarCount(
          db,
          "SELECT COUNT(*) as c FROM compaction WHERE session_id = ?",
          resolvedSessionID,
        ),
      },
      latestValuation,
      recentPivots,
      staleAlerts,
      topCentralFiles,
      mudballHotspots,
      tokenEconomics,
      compactionPreview,
      updatedAt: new Date().toISOString(),
    }
  } finally {
    ownDb?.close()
  }
}

function defaultHostDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return path.join(dataHome, "opencode", "opencode.db")
}

async function syncFromHostDbIfAvailable(params: {
  readonly projectRoot: string
  readonly archiveDir: string
  readonly sessionID?: string
  readonly scope?: "session" | "project" | "all-projects"
  readonly db: Database
}): Promise<void> {
  const hostDbPath = process.env.OPENCODE_DB_PATH || defaultHostDbPath()
  if (!hostDbPath || !existsSync(hostDbPath)) return

  const persistProjectFn = (archiveIndex as Record<string, unknown>).persistProject
  if (typeof persistProjectFn === "function") {
    try {
      const source = archiveIndex.sqliteSource(hostDbPath)
      try {
        await persistProjectFn(
          {
            projectRoot: params.projectRoot,
            dir: params.archiveDir,
            sessionID: params.sessionID,
            scope: params.scope ?? "project",
          },
          source,
        )
        return
      } finally {
        source.close()
      }
    } catch {
      // fall through to direct sqliteSource + persist sync
    }
  }

  try {
    ensureHoneycombSchema(params.db)
  } catch {
    // ignore schema prep errors
  }

  try {
    const hostRaw = new Database(hostDbPath, { readonly: true })
    let targetSessions: { id: string; project_id: string; directory: string }[] = []
    try {
      const normRoot = path.resolve(params.projectRoot)
      if (params.sessionID) {
        targetSessions = hostRaw
          .query("SELECT id, project_id, directory FROM session_v2 WHERE id = ? LIMIT 1")
          .all(params.sessionID) as { id: string; project_id: string; directory: string }[]
      }
      if (targetSessions.length === 0) {
        if (params.scope === "all-projects") {
          targetSessions = hostRaw
            .query("SELECT id, project_id, directory FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 25")
            .all() as { id: string; project_id: string; directory: string }[]
        } else {
          targetSessions = hostRaw
            .query("SELECT id, project_id, directory FROM session_v2 WHERE directory = ? AND parent_id IS NULL ORDER BY time_updated DESC LIMIT 20")
            .all(normRoot) as { id: string; project_id: string; directory: string }[]
        }
      }
    } finally {
      hostRaw.close()
    }

    if (targetSessions.length > 0) {
      const source = archiveIndex.sqliteSource(hostDbPath)
      try {
        for (const sess of targetSessions) {
          try {
            archiveIndex.persist(
              {
                sessionID: sess.id,
                projectID: sess.project_id,
                projectRoot: sess.directory || params.projectRoot,
                dir: params.archiveDir,
              },
              source,
            )
          } catch {
            // best-effort per-session persist
          }
        }
      } finally {
        source.close()
      }
    }
  } catch {
    // ignore host DB sync errors when host schema is absent
  }
}

export async function executeSubstrateAction(
  first: Database | SubstrateActionInput,
  second?: SubstrateActionInput | SubstrateRuntimeContextOptions,
  third?: SubstrateRuntimeContextOptions,
): Promise<SubstrateActionOutput> {
  let db: Database
  let ownDb: Database | null = null
  let input: SubstrateActionInput
  let options: SubstrateRuntimeContextOptions

  if (first && typeof (first as Database).query === "function") {
    db = first as Database
    input = (second as SubstrateActionInput) ?? { action: "status" }
    options = third ?? {}
  } else {
    input = (first as SubstrateActionInput) ?? { action: "status" }
    options = (second as SubstrateRuntimeContextOptions) ?? {}
    const resolvedDb = resolveDbAndOptions(options)
    db = resolvedDb.db
    ownDb = resolvedDb.ownDb
    options = resolvedDb.options
  }

  try {
    ensureContinuitySchema(db)
    ensureSemanticDigestSchema(db)
    ensureCodeGraphSchema(db)
    ensureCochangeSchema(db)

    const projectRoot = options.projectRoot ?? process.cwd()
    const archiveDir = options.archiveDir ?? path.join(projectRoot, ".session-archive")
    const resolved = resolveDefaultSessionId(db, input.sessionID ?? options.sessionID)
    const resolvedSessionID = resolved.sessionId

    let markdown = ""

    switch (input.action) {
      case "sync": {
        await syncFromHostDbIfAvailable({
          projectRoot,
          archiveDir,
          sessionID: input.sessionID ?? options.sessionID,
          scope: input.scope,
          db,
        })
        if (existsSync(projectRoot)) {
          try {
            indexCodebase(db, projectRoot)
            computeCodebasePageRank(db)
          } catch {
            // ignore if projectRoot has no TS files
          }
          try {
            await mineGitCochange(db, projectRoot)
          } catch {
            // ignore if projectRoot is not a git repo
          }
        }
        try {
          materializeSemanticDigests(db, { archiveDir })
        } catch {
          // ignore if no sessions exist yet
        }
        const snap = buildSubstrateSnapshot(db, {
          ...options,
          projectRoot,
          archiveDir,
          sessionID: input.sessionID ?? resolvedSessionID,
        })
        markdown = [
          `## Substrate Sync Complete · \`${snap.resolvedSessionID}\` (scope=${input.scope ?? "project"})`,
          `- **Project Root:** \`${snap.projectRoot}\``,
          `- **Gate:** ${snap.gateLabel ?? snap.verificationState}`,
          `- **Sessions:** ${snap.counts.rootSessions} root / ${snap.counts.sessions} total`,
          `- **CodeGraph:** ${snap.counts.codeFiles} files, ${snap.counts.codeSymbols} symbols`,
          `- **Git Co-Change:** ${snap.counts.cochangePairs} pairs (${snap.counts.hiddenCochangePairs} HIDDEN)`,
          `- **Working Memory:** ${snap.counts.freshFiles} FRESH (${snap.counts.sliceFiles} SLICE), ${snap.counts.staleFiles} STALE`,
        ].join("\n")
        return {
          ok: true,
          action: input.action,
          resolvedSessionID: snap.resolvedSessionID,
          markdown,
          tokenEstimate: estimateTokens(markdown),
          snapshot: snap,
        }
      }

      case "repomap": {
        const rawTarget = input.path ?? input.targetPaths?.[0]
        const ws = resolveTargetWorkspace(rawTarget, projectRoot)
        markdown = withTargetWorkspaceDb(ws, db, (targetDb, _targetRoot, relPath) => {
          const focusPaths =
            relPath && relPath.length > 0
              ? [relPath]
              : !ws.isExternal && input.targetPaths && input.targetPaths.length > 0
                ? input.targetPaths
                : undefined
          return renderRepoMap(targetDb, {
            focusPaths,
            budgetTokens: input.maxTokens ?? 1000,
          }).text
        })
        break
      }

      case "skeleton": {
        const targetPath = input.path ?? input.targetPaths?.[0]
        if (!targetPath) {
          markdown = "Error: `skeleton` requires `--path <rel>`."
          return {
            ok: false,
            action: input.action,
            resolvedSessionID,
            markdown,
            tokenEstimate: estimateTokens(markdown),
          }
        }
        const ws = resolveTargetWorkspace(targetPath, projectRoot)
        markdown = withTargetWorkspaceDb(ws, db, (targetDb, targetRoot, relPath) => {
          const effectivePath = relPath || normalizeRepoPath(targetPath, targetRoot)
          let skel = readAstSkeleton(targetDb, effectivePath, {
            rootDir: targetRoot,
            includePrivate: input.includePrivate,
          })
          if (!skel) {
            skel = indexSingleFileSkeleton(targetDb, targetRoot, effectivePath)
          }
          return skel
            ? skel.skeleton_text
            : `No indexed AST skeleton found for \`${effectivePath}\`.`
        })
        break
      }

      case "slice": {
        let targetPath = input.path ?? input.targetPaths?.[0]
        let symbolName = input.symbol ?? input.symbolNames?.[0]
        if (targetPath && !symbolName && targetPath.includes("#")) {
          const hashIdx = targetPath.indexOf("#")
          symbolName = targetPath.slice(hashIdx + 1).trim()
          targetPath = targetPath.slice(0, hashIdx).trim()
        }
        if (!targetPath || !symbolName) {
          markdown = "Error: `slice` requires `--path <rel>` and `--symbol <name>`."
          return {
            ok: false,
            action: input.action,
            resolvedSessionID,
            markdown,
            tokenEstimate: estimateTokens(markdown),
          }
        }
        const ws = resolveTargetWorkspace(targetPath, projectRoot)
        markdown = withTargetWorkspaceDb(ws, db, (targetDb, targetRoot, relPath) => {
          const effectivePath = relPath || normalizeRepoPath(targetPath!, targetRoot)
          const slice = readSymbolSlice(targetDb, targetRoot, effectivePath, symbolName!)
          return slice
            ? slice.slice_text
            : `No symbol slice found for \`${effectivePath}#${symbolName}\`.`
        })
        break
      }

      case "coupled": {
        const targetPath = input.path ?? input.targetPaths?.[0]
        if (!targetPath) {
          markdown = "Error: `coupled` requires `--path <rel>`."
          return {
            ok: false,
            action: input.action,
            resolvedSessionID,
            markdown,
            tokenEstimate: estimateTokens(markdown),
          }
        }
        const ws = resolveTargetWorkspace(targetPath, projectRoot)
        markdown = withTargetWorkspaceDb(ws, db, (targetDb, targetRoot, relPath) => {
          const effectivePath = relPath || normalizeRepoPath(targetPath, targetRoot)
          return (
            renderCochangeWarnings(targetDb, effectivePath) ||
            `No temporal co-change couplings found for \`${effectivePath}\`.`
          )
        })
        break
      }

      case "provenance": {
        markdown = renderProvenanceReport(db, resolvedSessionID, {
          canonicalRoot: projectRoot,
        })
        break
      }

      case "timeline": {
        const timeline = renderIntentTimeline(db, resolvedSessionID, {
          archiveDir,
        })
        markdown = timeline.markdown
        break
      }

      case "search": {
        const queryText = input.query?.trim() ?? ""
        if (!queryText) {
          markdown = "Error: `search` requires `--query <text>`."
          return {
            ok: false,
            action: input.action,
            resolvedSessionID,
            markdown,
            tokenEstimate: estimateTokens(markdown),
          }
        }
        const nav = queryVibeNavigation(db, queryText, {
          maxTokens: input.maxTokens ?? 350,
        })
        markdown = nav.markdown
        break
      }

      case "brief": {
        ensureCodeGraphIndexed(db, projectRoot)
        const rawTargetPaths =
          input.targetPaths && input.targetPaths.length > 0
            ? input.targetPaths
            : input.path
              ? [input.path]
              : (
                  db
                    .query("SELECT path FROM code_file ORDER BY pagerank DESC LIMIT 2")
                    .all() as { path: string }[]
                ).map((r) => r.path)
        const symbolNames =
          input.symbolNames && input.symbolNames.length > 0
            ? input.symbolNames
            : input.symbol
              ? [input.symbol]
              : undefined

        const firstWs = resolveTargetWorkspace(rawTargetPaths[0], projectRoot)
        markdown = withTargetWorkspaceDb(firstWs, db, (targetDb, targetRoot, firstRelPath) => {
          const effectivePaths = firstWs.isExternal
            ? rawTargetPaths.map((p) => resolveTargetWorkspace(p, projectRoot).relPath || p)
            : firstRelPath && rawTargetPaths.length === 1
              ? [firstRelPath]
              : rawTargetPaths
          const brief = buildImplementorViewportBrief(targetDb, {
            targetPaths: effectivePaths,
            symbolNames,
            sessionID: resolvedSessionID,
            rootDir: targetRoot,
            maxTokens: input.maxTokens ?? 1500,
            goal: input.query,
          })
          return brief.markdown
        })
        break
      }

      case "prune": {
        const mode = input.mode ?? "manual"
        const keepRecentSteps = input.keepRecentSteps ?? 1
        const rec = reconcileProvenanceStaleness(db, {
          sessionID: resolvedSessionID,
          canonicalRoot: projectRoot,
        })
        markdown = [
          `## Working-Set Valve Prune (\`mode=${mode}\`, \`keepRecentSteps=${keepRecentSteps}\`) · \`${resolvedSessionID}\``,
          `- **Files Checked:** ${rec.totalFilesChecked} (${rec.freshFilesCount} FRESH [${rec.sliceFilesCount} SLICE], ${rec.staleFilesCount} STALE)`,
          `- **Provenance Chains Checked:** ${rec.totalChainsChecked} (${rec.verifiedFreshChainsCount} fresh, ${rec.staleChainsCount} stale)`,
        ].join("\n")
        break
      }

      case "compaction":
      case "status":
      default: {
        const pkt = buildCompactionContinuationPacket(db, {
          sessionID: resolvedSessionID,
          canonicalRoot: projectRoot,
          maxTokens: input.maxTokens ?? 1200,
        })
        markdown = pkt.markdown
        break
      }
    }

    const snapshot = buildSubstrateSnapshot(db, {
      ...options,
      projectRoot,
      archiveDir,
      sessionID: resolvedSessionID,
    })

    return {
      ok: true,
      action: input.action,
      resolvedSessionID,
      markdown,
      tokenEstimate: estimateTokens(markdown),
      snapshot,
    }
  } finally {
    ownDb?.close()
  }
}

const VALID_ACTIONS = new Set<SubstrateActionKind>([
  "status",
  "sync",
  "repomap",
  "skeleton",
  "slice",
  "coupled",
  "provenance",
  "timeline",
  "search",
  "brief",
  "compaction",
  "prune",
])

export interface SubstrateCliOptions {
  readonly projectRoot?: string
  readonly archiveDir?: string
  readonly dbPath?: string
  readonly db?: Database
}

export interface SubstrateCliResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly snapshot?: SubstrateSnapshotOutput
  readonly actionOutput?: SubstrateActionOutput
}

export async function runSubstrateCli(
  argv: readonly string[],
  options: SubstrateCliOptions = {},
): Promise<SubstrateCliResult> {
  let action: SubstrateActionKind = "status"
  let sessionID: string | undefined
  const paths: string[] = []
  const symbols: string[] = []
  let query: string | undefined
  let maxTokens: number | undefined
  let keepRecentSteps: number | undefined
  let mode: "manual" | "auto" | "off" | undefined
  let scope: "session" | "project" | "all-projects" | undefined
  let full = false
  let includePrivate = false
  let jsonOutput = false
  let projectRoot = options.projectRoot
  let dbPath = options.dbPath

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("-")) {
      if (VALID_ACTIONS.has(arg as SubstrateActionKind)) {
        action = arg as SubstrateActionKind
      } else if (!query && action === "search") {
        query = arg
      } else if (
        !sessionID &&
        (action === "status" ||
          action === "provenance" ||
          action === "compaction" ||
          action === "prune" ||
          action === "sync" ||
          action === "timeline")
      ) {
        sessionID = arg
      } else if (
        paths.length === 0 &&
        (action === "repomap" ||
          action === "skeleton" ||
          action === "slice" ||
          action === "coupled" ||
          action === "brief")
      ) {
        paths.push(arg)
      } else if (action === "slice" && paths.length > 0 && symbols.length === 0) {
        symbols.push(arg)
      }
      continue
    }

    const eqIdx = arg.indexOf("=")
    const flag = eqIdx > 0 ? arg.slice(0, eqIdx) : arg
    const nextVal = eqIdx > 0 ? arg.slice(eqIdx + 1) : argv[i + 1]
    const consumeNext = () => {
      if (eqIdx < 0 && i + 1 < argv.length) i++
      return nextVal ?? ""
    }

    switch (flag) {
      case "--json":
        jsonOutput = true
        break
      case "--full":
        full = true
        break
      case "--private":
      case "--include-private":
        includePrivate = true
        break
      case "--session":
      case "-s":
        sessionID = consumeNext()
        break
      case "--path":
      case "-p": {
        const val = consumeNext()
        for (const item of val.split(",").map((s) => s.trim()).filter(Boolean)) {
          paths.push(item)
        }
        break
      }
      case "--symbol": {
        const val = consumeNext()
        for (const item of val.split(",").map((s) => s.trim()).filter(Boolean)) {
          symbols.push(item)
        }
        break
      }
      case "--query":
      case "--objective":
      case "-q":
        query = consumeNext()
        break
      case "--max-tokens":
      case "--limit": {
        const parsed = Number.parseInt(consumeNext(), 10)
        if (Number.isFinite(parsed) && parsed > 0) maxTokens = parsed
        break
      }
      case "--keep": {
        const parsed = Number.parseInt(consumeNext(), 10)
        if (Number.isFinite(parsed) && parsed >= 0) keepRecentSteps = parsed
        break
      }
      case "--mode": {
        const val = consumeNext()
        if (val === "manual" || val === "auto" || val === "off") mode = val
        break
      }
      case "--scope": {
        const val = consumeNext()
        if (val === "session" || val === "project" || val === "all-projects") {
          scope = val
        }
        break
      }
      case "--project-root":
      case "--project":
        projectRoot = consumeNext()
        break
      case "--db":
        dbPath = consumeNext()
        break
      default:
        break
    }
  }

  const effectiveProjectRoot = projectRoot ?? process.cwd()
  const effectiveArchiveDir =
    options.archiveDir ?? path.join(effectiveProjectRoot, ".session-archive")
  const effectiveDbPath = dbPath ?? path.join(effectiveArchiveDir, "index.sqlite")

  let ownDb: Database | null = null
  const db =
    options.db ??
    (() => {
      mkdirSync(path.dirname(effectiveDbPath), { recursive: true })
      ownDb = new Database(effectiveDbPath)
      return ownDb
    })()

  try {
    const actionInput: SubstrateActionInput = {
      action,
      sessionID,
      path: paths[0],
      targetPaths: paths.length > 0 ? paths : undefined,
      symbol: symbols[0],
      symbolNames: symbols.length > 0 ? symbols : undefined,
      query,
      maxTokens,
      keepRecentSteps,
      mode,
      scope,
      full: full || undefined,
      includePrivate: includePrivate || undefined,
    }

    const actionOutput = await executeSubstrateAction(db, actionInput, {
      projectRoot: effectiveProjectRoot,
      archiveDir: effectiveArchiveDir,
      indexDbPath: effectiveDbPath,
      sessionID,
    })

    if (!actionOutput.ok) {
      return {
        exitCode: 1,
        stdout: jsonOutput ? JSON.stringify(actionOutput, null, 2) : "",
        stderr: actionOutput.markdown,
        snapshot: actionOutput.snapshot,
        actionOutput,
      }
    }

    const stdout = jsonOutput
      ? JSON.stringify(
          action === "status" && actionOutput.snapshot
            ? { ...actionOutput, snapshot: actionOutput.snapshot }
            : actionOutput,
          null,
          2,
        )
      : actionOutput.markdown

    return {
      exitCode: 0,
      stdout,
      stderr: "",
      snapshot: actionOutput.snapshot,
      actionOutput,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      exitCode: 1,
      stdout: "",
      stderr: `hivemind-substrate: ${msg}`,
    }
  } finally {
    ownDb?.close()
  }
}

export const runCli = runSubstrateCli

if (import.meta.main) {
  const res = await runSubstrateCli(process.argv.slice(2))
  if (res.stdout) process.stdout.write(`${res.stdout}\n`)
  if (res.stderr) process.stderr.write(`${res.stderr}\n`)
  process.exit(res.exitCode)
}
