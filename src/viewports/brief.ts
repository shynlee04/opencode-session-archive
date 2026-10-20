import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { estimateTokens, normalizeRepoPath } from "../archive/primitives.ts"
import {
  type CodeSymbolRow,
  ensureCodeGraphSchema,
  readAstSkeleton,
  readSymbolSlice,
  skeletonizeSource,
} from "../honeycomb/ast-skeleton.ts"
import {
  type CoChangeCouplingRow,
  ensureCochangeSchema,
  queryCochangeCouplings,
} from "../honeycomb/cochange.ts"
import { renderRepoMap } from "../honeycomb/pagerank.ts"
import {
  type ProvenanceChainRow,
  ensureContinuitySchema,
  formatProvenanceStatusLabel,
  resolveDefaultSessionId,
  shortBlobRef,
} from "./continuity.ts"

export interface FocusSymbolRef {
  readonly path?: string
  readonly symbol: string
}

export interface ImplementorViewportBriefOptions {
  readonly targetPaths?: readonly string[]
  readonly writeLeasePaths?: readonly string[]
  readonly symbolNames?: readonly string[]
  readonly focusSymbols?: readonly (string | FocusSymbolRef)[]
  readonly sessionID?: string
  readonly sessionId?: string
  readonly rootDir?: string
  readonly projectRoot?: string
  readonly canonicalRoot?: string
  readonly maxTokens?: number
  readonly maxTokensBudget?: number
  readonly minCouplingProbability?: number
  readonly minProbability?: number
  readonly goal?: string
  readonly verificationCommand?: string
}

export type ImplementorBriefOptions = ImplementorViewportBriefOptions

export interface ImplementorBriefSkeletonEntry {
  readonly path: string
  readonly loc: number
  readonly skeletonTokens: number
  readonly skeletonMarkdown: string
}

export interface ImplementorBriefSliceEntry {
  readonly path: string
  readonly symbol: string
  readonly startLine: number
  readonly endLine: number
  readonly sliceTokens: number
  readonly code: string
}

export interface ImplementorBriefCochangeEntry {
  readonly leasePath: string
  readonly coupledPath: string
  readonly probability: number
  readonly hasStaticEdge: boolean
  readonly recentSubjects: readonly string[]
}

export interface ImplementorViewportBriefResult {
  readonly markdown: string
  readonly tokenEstimate: number
  readonly estimatedTokens: number
  readonly tokenCount: number
  readonly budgetTokens: number
  readonly maxTokens: number
  readonly withinBudget: boolean
  readonly targetPaths: string[]
  readonly includedTargetPaths: string[]
  readonly writeLeasePaths: string[]
  readonly includedSymbols: string[]
  readonly includedSlices: string[]
  readonly coupledWarnings: number
  readonly hiddenCouplingWarnings: string[]
  readonly cochangeWarnings: ImplementorBriefCochangeEntry[]
  readonly provenanceChains: number
  readonly provenanceConstraints: string[]
  readonly skeletons: ImplementorBriefSkeletonEntry[]
  readonly symbolSlices: ImplementorBriefSliceEntry[]
  readonly goal: string
  readonly verificationCommand: string
  readonly resolvedSessionID: string | null
  readonly elapsedMs: number
}

export type ImplementorViewportBrief = ImplementorViewportBriefResult

function resolveEffectiveRootDir(explicitRootDir: string | undefined): string {
  if (explicitRootDir) return explicitRootDir
  return process.cwd()
}

function truncateLinesToBudget(
  lines: readonly string[],
  maxChars: number,
  suffix = "// ... [truncated for token budget]",
): string {
  const full = lines.join("\n")
  if (full.length <= maxChars) return full
  if (maxChars <= suffix.length + 16) return full.slice(0, Math.max(0, maxChars))

  const out: string[] = []
  let used = 0
  const cap = maxChars - suffix.length - 1
  for (const line of lines) {
    const nextLen = used === 0 ? line.length : used + 1 + line.length
    if (nextLen > cap) break
    out.push(line)
    used = nextLen
  }
  if (out.length === 0 && lines.length > 0) {
    out.push(lines[0]!.slice(0, cap))
  }
  out.push(suffix)
  return out.join("\n")
}

interface CachedDiskFile {
  readonly mtimeMs: number
  readonly sourceText: string
  readonly lines: readonly string[]
  readonly skeleton: ReturnType<typeof skeletonizeSource>
}

const diskFileCache = new Map<string, CachedDiskFile>()

function getCachedDiskFile(rootDir: string, relPath: string): CachedDiskFile | null {
  const normPath = normalizeRepoPath(relPath, rootDir)
  const absPath = path.join(rootDir, normPath)
  if (!existsSync(absPath)) return null
  try {
    const stat = statSync(absPath)
    const cached = diskFileCache.get(absPath)
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached
    }
    const sourceText = readFileSync(absPath, "utf8")
    const lines = sourceText.split("\n")
    const skeleton = skeletonizeSource(normPath, sourceText, { rootDir })
    const entry: CachedDiskFile = {
      mtimeMs: stat.mtimeMs,
      sourceText,
      lines,
      skeleton,
    }
    diskFileCache.set(absPath, entry)
    return entry
  } catch {
    return null
  }
}

/**
 * Pure deterministic helper assembling a token-bounded 4-tier Implementor Viewport Brief
 * for cross-harness child delegation (`delegate-devin`, `hivemind-delegate`, `subagent`).
 *
 * Packs within `maxTokens` (default `1,500`):
 * 1. Focused Tier-1 `RepoMap` (`renderRepoMap`)
 * 2. Tier-2 `AstSkeleton` outlines (`readAstSkeleton`) for each target path
 * 3. Tier-3 `SymbolSlice` spans (`readSymbolSlice`) when symbols are specified
 * 4. Tier-4 `CoChangeCoupling` warnings (`has_static_edge = 0` highlighted)
 * 5. Active `ProvenanceChain` constraints for target paths or session
 */
export function buildImplementorViewportBrief(
  db: Database,
  options: ImplementorViewportBriefOptions,
): ImplementorViewportBriefResult {
  ensureContinuitySchema(db)
  ensureCodeGraphSchema(db)
  ensureCochangeSchema(db)
  const t0 = performance.now()

  const maxTokens = Math.max(100, options.maxTokens ?? options.maxTokensBudget ?? 1500)
  const maxChars = maxTokens * 4
  const minProbability = options.minCouplingProbability ?? options.minProbability ?? 0.3

  const effectiveRootDir = resolveEffectiveRootDir(
    options.rootDir ?? options.projectRoot ?? options.canonicalRoot,
  )
  const rawPaths = options.targetPaths ?? options.writeLeasePaths ?? []
  const targetPaths = [
    ...new Set(rawPaths.map((p) => normalizeRepoPath(p, effectiveRootDir)).filter(Boolean)),
  ]

  const rawSessionId = options.sessionID ?? options.sessionId
  const resolvedSession = rawSessionId
    ? resolveDefaultSessionId(db, rawSessionId)
    : resolveDefaultSessionId(db)
  const resolvedSessionID = resolvedSession.sessionId || null

  // Normalize requested symbols from symbolNames and focusSymbols
  const requestedSymbolRefs: { readonly path?: string; readonly symbol: string }[] = []
  for (const s of options.symbolNames ?? []) {
    const trimmed = s.trim()
    if (!trimmed) continue
    const hashIdx = trimmed.indexOf("#")
    const colonIdx = trimmed.indexOf(":")
    if (hashIdx > 0) {
      requestedSymbolRefs.push({
        path: normalizeRepoPath(trimmed.slice(0, hashIdx), effectiveRootDir),
        symbol: trimmed.slice(hashIdx + 1).trim(),
      })
    } else if (colonIdx > 0 && trimmed.slice(0, colonIdx).includes("/")) {
      requestedSymbolRefs.push({
        path: normalizeRepoPath(trimmed.slice(0, colonIdx), effectiveRootDir),
        symbol: trimmed.slice(colonIdx + 1).trim(),
      })
    } else {
      requestedSymbolRefs.push({ symbol: trimmed })
    }
  }
  for (const fs of options.focusSymbols ?? []) {
    if (typeof fs === "string") {
      if (fs.trim()) requestedSymbolRefs.push({ symbol: fs.trim() })
    } else if (fs && typeof fs === "object" && fs.symbol) {
      requestedSymbolRefs.push({
        path: fs.path ? normalizeRepoPath(fs.path, effectiveRootDir) : undefined,
        symbol: fs.symbol.trim(),
      })
    }
  }

  // 1. Active ProvenanceChain constraints for targetPaths or sessionID
  const targetSet = new Set(targetPaths)
  const allChains = (
    resolvedSessionID
      ? db
          .query(
            "SELECT * FROM provenance_chain WHERE root_session_id = ? OR target_path IN (SELECT value FROM json_each(?)) ORDER BY chain_id ASC",
          )
          .all(resolvedSessionID, JSON.stringify(targetPaths))
      : db
          .query(
            "SELECT * FROM provenance_chain WHERE target_path IN (SELECT value FROM json_each(?)) ORDER BY chain_id ASC",
          )
          .all(JSON.stringify(targetPaths))
  ) as ProvenanceChainRow[]

  const sortedChains = [...allChains].sort((a, b) => {
    const aMatch = targetSet.has(normalizeRepoPath(a.target_path, effectiveRootDir)) ? 1 : 0
    const bMatch = targetSet.has(normalizeRepoPath(b.target_path, effectiveRootDir)) ? 1 : 0
    return bMatch - aMatch || a.chain_id.localeCompare(b.chain_id)
  })

  const provenanceConstraints: string[] = sortedChains.map((c) => {
    const expectedSha = c.repair_blob_sha || c.read_or_review_blob_sha || c.disk_blob_sha
    return `- \`${c.finding_id}\` -> \`${c.target_path}\` (\`${shortBlobRef(expectedSha)}\` vs \`${shortBlobRef(c.disk_blob_sha)}\`): **${formatProvenanceStatusLabel(c.staleness_status)}** — ${c.finding_summary}`
  })

  // 2. Tier-4 CoChangeCoupling warnings (prioritizing has_static_edge = 0)
  const cochangeWarnings: ImplementorBriefCochangeEntry[] = []
  const hiddenCouplingWarnings: string[] = []
  const warningLines: string[] = []
  const seenPairs = new Set<string>()

  for (const p of targetPaths) {
    const rows: CoChangeCouplingRow[] = queryCochangeCouplings(db, p, {
      minProbability,
      minCochangeCount: 2,
      limit: 8,
    })
    rows.sort(
      (a, b) =>
        Number(b.has_static_edge === 0) - Number(a.has_static_edge === 0) ||
        b.probability - a.probability ||
        b.co_commits - a.co_commits,
    )
    for (const r of rows) {
      const pairKey = `${p}:::${r.coupled_path}`
      if (seenPairs.has(pairKey)) continue
      seenPairs.add(pairKey)

      const isHidden = r.has_static_edge === 0
      cochangeWarnings.push({
        leasePath: p,
        coupledPath: r.coupled_path,
        probability: r.probability,
        hasStaticEdge: !isHidden,
        recentSubjects: r.recent_subjects,
      })

      const pct = (r.probability * 100).toFixed(1)
      const tag = isHidden
        ? "HIDDEN COUPLING (has_static_edge=0, 0 static import edges)"
        : "static+temporal (has_static_edge=1)"
      const subj = r.recent_subjects[0] ? ` — "${r.recent_subjects[0]}"` : ""
      const line = `- \`${p}\` <-> \`${r.coupled_path}\`: P=${pct}% (${r.co_commits}/${r.target_commits} commits, ${tag})${subj}`
      warningLines.push(line)
      if (isHidden) {
        hiddenCouplingWarnings.push(line)
      }
    }
  }

  // 3. Tier-2 AstSkeleton outlines for each path in targetPaths
  const skeletons: ImplementorBriefSkeletonEntry[] = []
  for (const p of targetPaths) {
    const view = readAstSkeleton(db, p)
    if (view) {
      skeletons.push({
        path: view.path,
        loc: view.loc,
        skeletonTokens: view.skeleton_tokens,
        skeletonMarkdown: view.skeleton_text,
      })
    } else {
      const diskFile = getCachedDiskFile(effectiveRootDir, p)
      if (diskFile) {
        skeletons.push({
          path: diskFile.skeleton.filePath,
          loc: diskFile.skeleton.loc,
          skeletonTokens: diskFile.skeleton.skeletonTokens,
          skeletonMarkdown: diskFile.skeleton.skeletonText,
        })
      }
    }
  }

  // 4. Tier-3 SymbolSlice spans when symbolNames / focusSymbols is provided
  const includedSymbols: string[] = []
  const symbolSlices: ImplementorBriefSliceEntry[] = []

  const symLookupQuery = db.query(
    "SELECT * FROM code_symbol WHERE path = ? AND (qualified_name = ? OR name = ?) ORDER BY depth ASC, start_line ASC LIMIT 1",
  )

  for (const ref of requestedSymbolRefs) {
    const candidatePaths = ref.path ? [ref.path, ...targetPaths] : targetPaths
    let resolvedSlice: ImplementorBriefSliceEntry | null = null

    for (const p of candidatePaths) {
      const symRow = symLookupQuery.get(p, ref.symbol, ref.symbol) as CodeSymbolRow | null
      if (symRow) {
        const symLabel =
          symRow.qualified_name && symRow.qualified_name.length > 0
            ? symRow.qualified_name
            : symRow.parent_symbol
              ? `${symRow.parent_symbol}.${symRow.name}`
              : symRow.name

        const view = readSymbolSlice(db, effectiveRootDir, p, symLabel)
        if (view) {
          resolvedSlice = {
            path: view.path,
            symbol: symLabel,
            startLine: view.start_line,
            endLine: view.end_line,
            sliceTokens: view.slice_tokens,
            code: view.slice_text,
          }
        } else {
          const code = `// ${p} [L${symRow.start_line}-L${symRow.end_line}] (${symLabel}, kind=${symRow.kind}, depth=${symRow.depth})\nL${symRow.start_line}: ${symRow.signature}`
          resolvedSlice = {
            path: p,
            symbol: symLabel,
            startLine: symRow.start_line,
            endLine: symRow.end_line,
            sliceTokens: estimateTokens(code),
            code,
          }
        }
        break
      }

      const diskFile = getCachedDiskFile(effectiveRootDir, p)
      if (diskFile) {
        const matched =
          diskFile.skeleton.symbols.find((s) => s.qualified_name === ref.symbol) ??
          diskFile.skeleton.symbols.find((s) => s.name === ref.symbol)
        if (matched) {
          const clampedEnd = Math.min(diskFile.lines.length, matched.end_line)
          const numberedLines: string[] = []
          for (let L = matched.start_line; L <= clampedEnd; L++) {
            numberedLines.push(`L${L}: ${diskFile.lines[L - 1] ?? ""}`)
          }
          const header = `// ${p} [L${matched.start_line}-L${clampedEnd}] (${matched.qualified_name}, kind=${matched.kind}, depth=${matched.depth})`
          const code = `${header}\n${numberedLines.join("\n")}`
          resolvedSlice = {
            path: p,
            symbol: matched.qualified_name,
            startLine: matched.start_line,
            endLine: clampedEnd,
            sliceTokens: estimateTokens(code),
            code,
          }
          break
        }
      }
    }

    if (resolvedSlice) {
      symbolSlices.push(resolvedSlice)
      if (!includedSymbols.includes(resolvedSlice.symbol)) {
        includedSymbols.push(resolvedSlice.symbol)
      }
      if (!includedSymbols.includes(ref.symbol)) {
        includedSymbols.push(ref.symbol)
      }
    }
  }

  // 5. Focused Tier-1 RepoMap
  const repoMapBudgetTokens = Math.min(400, Math.max(50, Math.floor(maxTokens * 0.2)))
  const repoMapView = renderRepoMap(db, {
    focusPaths: targetPaths,
    budgetTokens: repoMapBudgetTokens,
  })

  const headerLines: string[] = [
    `# Implementor Viewport Brief (${targetPaths.length} target paths, budget=${maxTokens} tok)`,
  ]
  if (options.goal) {
    headerLines.push(`- **Goal:** ${options.goal}`)
  }
  if (targetPaths.length > 0) {
    headerLines.push(`- **Write Lease:** ${targetPaths.map((p) => `\`${p}\``).join(", ")}`)
  }
  if (options.verificationCommand) {
    headerLines.push(`- **Verification Gate:** \`${options.verificationCommand}\``)
  }

  const headerBlock = truncateLinesToBudget(headerLines, Math.floor(maxChars * 0.12))
  const remainingAfterHeader = Math.max(120, maxChars - headerBlock.length - 24)

  const hasSlices = symbolSlices.length > 0
  const provBudgetChars = Math.floor(remainingAfterHeader * 0.14)
  const cochangeBudgetChars = Math.floor(remainingAfterHeader * 0.18)
  const sliceBudgetChars = hasSlices ? Math.floor(remainingAfterHeader * 0.30) : 0
  const skelBudgetChars = Math.floor(remainingAfterHeader * (hasSlices ? 0.22 : 0.42))
  const repoMapBudgetChars = Math.floor(remainingAfterHeader * (hasSlices ? 0.16 : 0.26))

  const sectionBlocks: string[] = [headerBlock]

  const provSectionLines = [
    `## 1. Active Provenance Constraints (${provenanceConstraints.length})`,
    ...(provenanceConstraints.length > 0
      ? provenanceConstraints
      : ["- No active provenance chains blocking leased paths."]),
  ]
  sectionBlocks.push(truncateLinesToBudget(provSectionLines, provBudgetChars))

  const cochangeSectionLines = [
    `## 2. Tier-4 Co-Change Couplings (${cochangeWarnings.length} coupled, ${hiddenCouplingWarnings.length} HIDDEN)`,
    ...(warningLines.length > 0
      ? warningLines
      : ["- No high-probability co-change couplings above threshold."]),
  ]
  sectionBlocks.push(truncateLinesToBudget(cochangeSectionLines, cochangeBudgetChars))

  if (symbolSlices.length > 0) {
    const perSliceChars = Math.max(
      80,
      Math.floor((sliceBudgetChars - 45) / Math.max(1, symbolSlices.length)),
    )
    const sliceSectionLines: string[] = [`## 3. Tier-3 Symbol Slices (${symbolSlices.length})`]
    for (const sl of symbolSlices) {
      const slLines = sl.code.split("\n")
      sliceSectionLines.push(truncateLinesToBudget(slLines, perSliceChars))
    }
    sectionBlocks.push(truncateLinesToBudget(sliceSectionLines, sliceBudgetChars))
  }

  const skelSectionLines: string[] = [`## 4. Tier-2 AST Skeletons (${skeletons.length})`]
  if (skeletons.length > 0) {
    const perSkelChars = Math.max(
      80,
      Math.floor((skelBudgetChars - 45) / Math.max(1, skeletons.length)),
    )
    for (const sk of skeletons) {
      const skLines = sk.skeletonMarkdown.split("\n")
      skelSectionLines.push(truncateLinesToBudget(skLines, perSkelChars))
    }
  } else {
    skelSectionLines.push("- No indexed AST skeletons for target paths.")
  }
  sectionBlocks.push(truncateLinesToBudget(skelSectionLines, skelBudgetChars))

  const repoMapLines = repoMapView.text.split("\n")
  sectionBlocks.push(truncateLinesToBudget(repoMapLines, repoMapBudgetChars))

  let markdown = sectionBlocks.join("\n\n")
  if (markdown.length > maxChars) {
    const hardCap = Math.max(0, maxChars - 18)
    markdown = `${markdown.slice(0, hardCap)}\n...(truncated)`
  }

  const tokenEstimate = estimateTokens(markdown)
  const elapsedMs = performance.now() - t0
  const includedSlices = symbolSlices.map(
    (s) => `${s.path}#${s.symbol}[L${s.startLine}-L${s.endLine}]`,
  )

  const result: ImplementorViewportBriefResult & { toJSON?: () => Record<string, unknown> } = {
    markdown,
    tokenEstimate,
    estimatedTokens: tokenEstimate,
    tokenCount: tokenEstimate,
    budgetTokens: maxTokens,
    maxTokens,
    withinBudget: tokenEstimate <= maxTokens,
    targetPaths,
    includedTargetPaths: targetPaths,
    writeLeasePaths: targetPaths,
    includedSymbols,
    includedSlices,
    coupledWarnings: cochangeWarnings.length,
    hiddenCouplingWarnings,
    cochangeWarnings,
    provenanceChains: sortedChains.length,
    provenanceConstraints,
    skeletons,
    symbolSlices,
    goal: options.goal ?? "",
    verificationCommand: options.verificationCommand ?? "",
    resolvedSessionID,
    elapsedMs,
  }

  Object.defineProperty(result, "toJSON", {
    enumerable: false,
    value: () => ({
      tokenCount: tokenEstimate,
      budgetTokens: maxTokens,
      withinBudget: tokenEstimate <= maxTokens,
      targetPaths,
      includedSymbols,
      includedSlices,
      coupledWarnings: cochangeWarnings.length,
      hiddenCouplingWarnings,
      cochangeWarnings,
      provenanceChains: sortedChains.length,
      provenanceConstraints,
      skeletons,
      symbolSlices,
      goal: options.goal ?? "",
      verificationCommand: options.verificationCommand ?? "",
      resolvedSessionID,
      elapsedMs,
    }),
  })

  return result
}
