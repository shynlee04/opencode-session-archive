import { Database } from "bun:sqlite"
import { estimateTokens, normalizeRepoPath } from "../archive/primitives.ts"
import { ensureCodeGraphSchema, normalizeRelPath } from "./ast-skeleton.ts"

export interface PageRankOptions {
  readonly iterations?: number
  readonly damping?: number
  readonly persist?: boolean
}

export interface PageRankNode {
  readonly path: string
  readonly pagerank: number
  readonly in_degree: number
  readonly out_degree: number
  readonly loc: number
}

export interface PageRankResult {
  readonly nodeCount: number
  readonly edgeCount: number
  readonly iterations: number
  readonly damping: number
  readonly dampingFactor: number
  readonly totalMass: number
  readonly maxResidual: number
  readonly solveElapsedMs: number
  readonly persistElapsedMs: number
  readonly totalElapsedMs: number
  readonly nodes: readonly PageRankNode[]
}

export interface RenderRepoMapOptions {
  readonly budgetTokens?: number
  readonly tokenBudget?: number
  readonly maxTokens?: number
  readonly maxFiles?: number
  readonly maxSymbolsPerFile?: number
  readonly focusPaths?: readonly string[]
}

export interface RepoMapSymbolSummary {
  readonly name: string
  readonly kind: string
  readonly start_line: number
  readonly end_line: number
}

export interface RepoMapEntry {
  readonly rank: number
  readonly path: string
  readonly pagerank: number
  readonly in_degree: number
  readonly out_degree: number
  readonly loc: number
  readonly exported_symbol_count: number
  readonly top_symbols: readonly RepoMapSymbolSummary[]
}

export interface Tier1RepoMapView {
  readonly total_files: number
  readonly total_edges: number
  readonly included_files: number
  readonly estimated_tokens: number
  readonly token_budget: number
  readonly budget_tokens: number
  readonly elapsed_ms: number
  readonly entries: readonly RepoMapEntry[]
  readonly text: string
  readonly markdown: string
}

function symbolKindPriority(kind: string): number {
  switch (kind) {
    case "function":
    case "class":
      return 5
    case "interface":
      return 4
    case "type":
      return 3
    case "const":
    case "enum":
      return 2
    default:
      return 1
  }
}

/**
 * Pure-TS iterative Float64Array PageRank solver over code_file and code_import_edge.
 * Uses CSR adjacency arrays for zero heap allocations inside the power-iteration loop,
 * redistributing dangling-node (sink) mass uniformly across all N nodes at every step.
 */
export function computeCodebasePageRank(
  db: Database,
  options: PageRankOptions = {},
): PageRankResult {
  const t0 = performance.now()
  ensureCodeGraphSchema(db)

  const iterations = options.iterations ?? 20
  const damping = options.damping ?? 0.85
  const shouldPersist = options.persist ?? true

  const fileRows = db
    .query("SELECT path, loc FROM code_file ORDER BY path ASC")
    .all() as { path: string; loc: number }[]
  const edgeRows = db
    .query("SELECT from_path, to_path FROM code_import_edge ORDER BY from_path ASC, to_path ASC")
    .all() as { from_path: string; to_path: string }[]

  const tSolveStart = performance.now()
  const n = fileRows.length
  if (n === 0) {
    const elapsed = performance.now() - t0
    return {
      nodeCount: 0,
      edgeCount: 0,
      iterations,
      damping,
      dampingFactor: damping,
      totalMass: 0,
      maxResidual: 0,
      solveElapsedMs: 0,
      persistElapsedMs: 0,
      totalElapsedMs: elapsed,
      nodes: [],
    }
  }

  const pathToIdx = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    pathToIdx.set(fileRows[i]!.path, i)
  }

  const outDegree = new Int32Array(n)
  const inDegree = new Int32Array(n)
  const validEdges: { readonly u: number; readonly v: number }[] = []

  for (const e of edgeRows) {
    const u = pathToIdx.get(e.from_path)
    const v = pathToIdx.get(e.to_path)
    if (u === undefined || v === undefined || u === v) continue
    validEdges.push({ u, v })
    outDegree[u] = outDegree[u]! + 1
    inDegree[v] = inDegree[v]! + 1
  }

  // CSR layout: edgeOffsets[u]..edgeOffsets[u+1] indexes edgeTargets
  const edgeOffsets = new Int32Array(n + 1)
  for (let u = 0; u < n; u++) {
    edgeOffsets[u + 1] = edgeOffsets[u]! + outDegree[u]!
  }
  const edgeTargets = new Int32Array(validEdges.length)
  const writeCursor = new Int32Array(edgeOffsets)
  for (let i = 0; i < validEdges.length; i++) {
    const { u, v } = validEdges[i]!
    const pos = writeCursor[u]!
    edgeTargets[pos] = v
    writeCursor[u] = pos + 1
  }

  let pr = new Float64Array(n).fill(1 / n)
  let next = new Float64Array(n)
  let maxResidual = 0

  const invN = 1 / n
  const teleportMass = (1 - damping) * invN

  for (let iter = 0; iter < iterations; iter++) {
    let sinkSum = 0
    for (let u = 0; u < n; u++) {
      if (outDegree[u] === 0) {
        sinkSum += pr[u]!
      }
    }

    const baseMass = teleportMass + damping * sinkSum * invN
    next.fill(baseMass)

    for (let u = 0; u < n; u++) {
      const deg = outDegree[u]!
      if (deg > 0) {
        const share = (damping * pr[u]!) / deg
        const start = edgeOffsets[u]!
        const end = edgeOffsets[u + 1]!
        for (let idx = start; idx < end; idx++) {
          const v = edgeTargets[idx]!
          next[v] = next[v]! + share
        }
      }
    }

    let stepSum = 0
    for (let i = 0; i < n; i++) {
      stepSum += next[i]!
    }
    if (stepSum > 0 && Math.abs(stepSum - 1.0) > 1e-12) {
      const invSum = 1 / stepSum
      for (let i = 0; i < n; i++) {
        next[i] = next[i]! * invSum
      }
    }

    maxResidual = 0
    for (let i = 0; i < n; i++) {
      const diff = Math.abs(next[i]! - pr[i]!)
      if (diff > maxResidual) maxResidual = diff
    }

    const swap = pr
    pr = next
    next = swap
  }

  let totalMass = 0
  for (let i = 0; i < n; i++) {
    totalMass += pr[i]!
  }

  const tSolveDone = performance.now()

  if (shouldPersist) {
    const now = Date.now()
    const updateStmt = db.query("UPDATE code_file SET pagerank = ?, updated_at = ? WHERE path = ?")
    const persistTx = db.transaction(() => {
      for (let i = 0; i < n; i++) {
        updateStmt.run(pr[i]!, now, fileRows[i]!.path)
      }
    })
    persistTx()
  }

  const tPersistDone = performance.now()

  const nodes: PageRankNode[] = []
  for (let i = 0; i < n; i++) {
    nodes.push({
      path: fileRows[i]!.path,
      pagerank: pr[i]!,
      in_degree: inDegree[i]!,
      out_degree: outDegree[i]!,
      loc: fileRows[i]!.loc,
    })
  }

  nodes.sort((a, b) => b.pagerank - a.pagerank || b.in_degree - a.in_degree || a.path.localeCompare(b.path))

  return {
    nodeCount: n,
    edgeCount: validEdges.length,
    iterations,
    damping,
    dampingFactor: damping,
    totalMass,
    maxResidual,
    solveElapsedMs: tSolveDone - tSolveStart,
    persistElapsedMs: tPersistDone - tSolveDone,
    totalElapsedMs: tPersistDone - t0,
    nodes,
  }
}

export const computePageRank = computeCodebasePageRank

export interface MudballHotspot {
  readonly kind: "god_file" | "god_symbol" | "high_coupling_hub" | "hidden_coupling"
  readonly path: string
  readonly target: string
  readonly metric: string
  readonly symbol_name?: string
  readonly start_line?: number
  readonly end_line?: number
  readonly line_span?: number
  readonly loc?: number
  readonly pagerank?: number
  readonly in_degree?: number
  readonly out_degree?: number
  readonly coupled_path?: string
  readonly co_commits?: number
  readonly probability?: number
  readonly severity: "high" | "medium" | "warn"
  readonly detail: string
}

export interface MudballSymbolSummary {
  readonly name: string
  readonly kind: string
  readonly start_line: number
  readonly end_line: number
  readonly line_span: number
  readonly startLine: number
  readonly endLine: number
  readonly lineSpan: number
  readonly signature: string
}

export interface MudballFileOutline {
  readonly rank: number
  readonly path: string
  readonly filePath: string
  readonly loc: number
  readonly lineCount: number
  readonly pagerank: number
  readonly score: number
  readonly in_degree: number
  readonly out_degree: number
  readonly inDegree: number
  readonly outDegree: number
  readonly symbol_count: number
  readonly symbolsCount: number
  readonly raw_tokens: number
  readonly skeleton_tokens: number
  readonly rawTokens: number
  readonly skeletonTokens: number
  readonly tokens_saved: number
  readonly largest_symbols: readonly MudballSymbolSummary[]
  readonly exportedSymbols: readonly MudballSymbolSummary[]
}

export interface MudballAdvisorReport {
  readonly totalFiles: number
  readonly totalSymbols: number
  readonly rawTokensTotal: number
  readonly skeletonTokensTotal: number
  readonly tokensSavedTotal: number
  readonly compressionPct: number
  readonly topFiles: readonly MudballFileOutline[]
  readonly hotspots: readonly MudballHotspot[]
  readonly formatted: string
}

export interface QueryMudballAdvisorOptions {
  readonly godFileLocThreshold?: number
  readonly godSymbolSpanThreshold?: number
  readonly hubDegreeThreshold?: number
  readonly minHiddenCoCommits?: number
  readonly minHiddenProbability?: number
  readonly maxTopFiles?: number
  readonly topKFiles?: number
  readonly maxOutlineSymbolsPerFile?: number
  readonly maxHotspots?: number
}

/**
 * Queries the codebase structural graph + git co-change tables in index.sqlite to detect
 * mudball hotspots (god_file, god_symbol, high_coupling_hub, hidden_coupling) and quantify
 * AST skeleton token savings across the repository.
 */
export function queryMudballAdvisor(
  db: Database,
  options: QueryMudballAdvisorOptions = {},
): MudballAdvisorReport {
  ensureCodeGraphSchema(db)

  const godFileLocThreshold = options.godFileLocThreshold ?? 600
  const godSymbolSpanThreshold = options.godSymbolSpanThreshold ?? 120
  const hubDegreeThreshold = options.hubDegreeThreshold ?? 8
  const minHiddenCoCommits = options.minHiddenCoCommits ?? 2
  const minHiddenProbability = options.minHiddenProbability ?? 0.5
  const maxTopFiles = options.topKFiles ?? options.maxTopFiles ?? 15
  const maxOutlineSymbols = options.maxOutlineSymbolsPerFile ?? 5

  let fileRows = db
    .query(
      "SELECT path, loc, raw_tokens, skeleton_tokens, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC",
    )
    .all() as {
    path: string
    loc: number
    raw_tokens: number
    skeleton_tokens: number
    pagerank: number
  }[]

  if (fileRows.length > 0 && fileRows.every((r) => r.pagerank === 0)) {
    computeCodebasePageRank(db, { persist: true })
    fileRows = db
      .query(
        "SELECT path, loc, raw_tokens, skeleton_tokens, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC",
      )
      .all() as {
      path: string
      loc: number
      raw_tokens: number
      skeleton_tokens: number
      pagerank: number
    }[]
  }

  const edgeRows = db
    .query("SELECT from_path, to_path FROM code_import_edge")
    .all() as { from_path: string; to_path: string }[]

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  for (const e of edgeRows) {
    if (e.from_path === e.to_path) continue
    outDeg.set(e.from_path, (outDeg.get(e.from_path) ?? 0) + 1)
    inDeg.set(e.to_path, (inDeg.get(e.to_path) ?? 0) + 1)
  }

  const symRows = db
    .query(
      "SELECT path, name, kind, depth, parent_symbol, start_line, end_line, signature, exported FROM code_symbol ORDER BY path ASC, start_line ASC, depth ASC",
    )
    .all() as {
    path: string
    name: string
    kind: string
    depth: number
    parent_symbol: string | null
    start_line: number
    end_line: number
    signature: string
    exported: number
  }[]

  const symsByPath = new Map<string, typeof symRows>()
  const parentsWithChildrenByPath = new Map<string, Set<string>>()

  for (const s of symRows) {
    let list = symsByPath.get(s.path)
    if (!list) {
      list = []
      symsByPath.set(s.path, list)
    }
    list.push(s)
    if (s.depth === 2 && s.parent_symbol) {
      let pSet = parentsWithChildrenByPath.get(s.path)
      if (!pSet) {
        pSet = new Set()
        parentsWithChildrenByPath.set(s.path, pSet)
      }
      pSet.add(s.parent_symbol)
    }
  }

  let rawTokensTotal = 0
  let skeletonTokensTotal = 0
  const outlines: MudballFileOutline[] = []

  const godFileHotspots: MudballHotspot[] = []
  const godSymbolHotspots: MudballHotspot[] = []
  const hubHotspots: MudballHotspot[] = []
  const hiddenCouplingHotspots: MudballHotspot[] = []

  for (let idx = 0; idx < fileRows.length; idx++) {
    const f = fileRows[idx]!
    const skelTokens = Math.max(1, f.skeleton_tokens || Math.ceil(f.loc * 1.2))
    const rawTokens = Math.max(skelTokens, f.raw_tokens || f.loc * 10)
    const saved = Math.max(0, rawTokens - skelTokens)
    rawTokensTotal += rawTokens
    skeletonTokensTotal += skelTokens

    const fileSyms = symsByPath.get(f.path) ?? []
    const parentWrappers = parentsWithChildrenByPath.get(f.path)
    const leafSyms = fileSyms.filter((s) => !(s.depth === 1 && parentWrappers?.has(s.name)))
    const exportedOrLeafSyms =
      fileSyms.filter((s) => s.exported === 1 || s.depth === 2).length > 0
        ? fileSyms.filter((s) => s.exported === 1 || s.depth === 2)
        : fileSyms

    const largestSyms: MudballSymbolSummary[] = [...exportedOrLeafSyms]
      .map((s) => {
        const lineSpan = Math.max(1, s.end_line - s.start_line + 1)
        return {
          name: s.parent_symbol ? `${s.parent_symbol}.${s.name}` : s.name,
          kind: s.kind,
          start_line: s.start_line,
          end_line: s.end_line,
          line_span: lineSpan,
          startLine: s.start_line,
          endLine: s.end_line,
          lineSpan,
          signature: s.signature,
        }
      })
      .sort((a, b) => b.line_span - a.line_span || a.start_line - b.start_line)
      .slice(0, maxOutlineSymbols)

    const inCount = inDeg.get(f.path) ?? 0
    const outCount = outDeg.get(f.path) ?? 0

    outlines.push({
      rank: idx + 1,
      path: f.path,
      filePath: f.path,
      loc: f.loc,
      lineCount: f.loc,
      pagerank: f.pagerank,
      score: f.pagerank,
      in_degree: inCount,
      out_degree: outCount,
      inDegree: inCount,
      outDegree: outCount,
      symbol_count: fileSyms.length,
      symbolsCount: fileSyms.length,
      raw_tokens: rawTokens,
      skeleton_tokens: skelTokens,
      rawTokens,
      skeletonTokens: skelTokens,
      tokens_saved: saved,
      largest_symbols: largestSyms,
      exportedSymbols: largestSyms,
    })

    if (f.loc >= godFileLocThreshold) {
      const severity: "high" | "warn" = f.loc >= 1000 ? "high" : "warn"
      godFileHotspots.push({
        kind: "god_file",
        path: f.path,
        target: f.path,
        metric: `${f.loc} LOC`,
        loc: f.loc,
        pagerank: f.pagerank,
        in_degree: inCount,
        out_degree: outCount,
        severity,
        detail: `${f.path} (${f.loc} LOC, ${fileSyms.length} symbols, PR=${f.pagerank.toFixed(4)})`,
      })
    }

    const totalDegree = inCount + outCount
    if (totalDegree >= hubDegreeThreshold) {
      const severity: "high" | "warn" = totalDegree >= 14 ? "high" : "warn"
      hubHotspots.push({
        kind: "high_coupling_hub",
        path: f.path,
        target: f.path,
        metric: `in=${inCount}, out=${outCount}`,
        loc: f.loc,
        pagerank: f.pagerank,
        in_degree: inCount,
        out_degree: outCount,
        severity,
        detail: `${f.path} (in=${inCount}, out=${outCount}, PR=${f.pagerank.toFixed(4)})`,
      })
    }

    for (const s of leafSyms) {
      if (s.kind === "interface" || s.kind === "type") continue
      const span = Math.max(1, s.end_line - s.start_line + 1)
      if (span >= godSymbolSpanThreshold) {
        const severity: "high" | "warn" = span >= 200 ? "high" : "warn"
        const symLabel = s.parent_symbol ? `${s.parent_symbol}.${s.name}` : s.name
        godSymbolHotspots.push({
          kind: "god_symbol",
          path: f.path,
          target: `${f.path}#${symLabel}`,
          metric: `${span} lines [L${s.start_line}-L${s.end_line}]`,
          symbol_name: symLabel,
          start_line: s.start_line,
          end_line: s.end_line,
          line_span: span,
          severity,
          detail: `${f.path}#${symLabel} [L${s.start_line}-L${s.end_line}] (${span} lines)`,
        })
      }
    }
  }

  godFileHotspots.sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0) || a.path.localeCompare(b.path))
  godSymbolHotspots.sort(
    (a, b) => (b.line_span ?? 0) - (a.line_span ?? 0) || a.path.localeCompare(b.path),
  )
  hubHotspots.sort(
    (a, b) =>
      (b.in_degree ?? 0) +
        (b.out_degree ?? 0) -
        ((a.in_degree ?? 0) + (a.out_degree ?? 0)) ||
      (b.pagerank ?? 0) - (a.pagerank ?? 0) ||
      a.path.localeCompare(b.path),
  )

  const hasCochangeTable =
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'git_cochange'")
      .get() !== null

  if (hasCochangeTable) {
    const hiddenRows = db
      .query(
        `SELECT file_a, file_b, co_commits, prob_a_given_b, prob_b_given_a
         FROM git_cochange
         WHERE has_static_edge = 0 AND co_commits >= ?
         ORDER BY co_commits DESC, MAX(prob_a_given_b, prob_b_given_a) DESC, file_a ASC, file_b ASC
         LIMIT 25`,
      )
      .all(minHiddenCoCommits) as {
      file_a: string
      file_b: string
      co_commits: number
      prob_a_given_b: number
      prob_b_given_a: number
    }[]

    for (const r of hiddenRows) {
      const maxProb = Math.max(r.prob_a_given_b, r.prob_b_given_a)
      if (maxProb < minHiddenProbability) continue
      const primaryIsA = r.prob_b_given_a >= r.prob_a_given_b
      const primaryPath = primaryIsA ? r.file_a : r.file_b
      const partnerPath = primaryIsA ? r.file_b : r.file_a
      const severity: "high" | "warn" =
        r.co_commits >= 3 && maxProb >= 0.6 ? "high" : "warn"
      hiddenCouplingHotspots.push({
        kind: "hidden_coupling",
        path: primaryPath,
        target: `${primaryPath} <-> ${partnerPath}`,
        metric: `${r.co_commits} co-commits (${(maxProb * 100).toFixed(1)}%)`,
        coupled_path: partnerPath,
        co_commits: r.co_commits,
        probability: maxProb,
        severity,
        detail: `${primaryPath} <-> ${partnerPath} (${r.co_commits} co-commits, P=${(maxProb * 100).toFixed(1)}%, 0 static edges)`,
      })
    }
  }

  const allHotspots: MudballHotspot[] = [
    ...godFileHotspots,
    ...godSymbolHotspots,
    ...hubHotspots,
    ...hiddenCouplingHotspots,
  ]
  allHotspots.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "high" ? -1 : 1
    return 0
  })

  const hotspots =
    options.maxHotspots !== undefined ? allHotspots.slice(0, options.maxHotspots) : allHotspots

  const topFiles = outlines.slice(0, maxTopFiles)

  const tokensSavedTotal = Math.max(0, rawTokensTotal - skeletonTokensTotal)
  const compressionPct =
    rawTokensTotal > 0 ? Number(((tokensSavedTotal / rawTokensTotal) * 100).toFixed(1)) : 0

  const formattedLines: string[] = [
    `### Mudball & Architecture Advisor (saved ${tokensSavedTotal} tokens, ${compressionPct}% AST compression)`,
  ]
  for (const h of hotspots.slice(0, 12)) {
    formattedLines.push(`- [${h.severity}/${h.kind}] ${h.detail}`)
  }

  return {
    totalFiles: fileRows.length,
    totalSymbols: symRows.length,
    rawTokensTotal,
    skeletonTokensTotal,
    tokensSavedTotal,
    compressionPct,
    topFiles,
    hotspots,
    formatted: formattedLines.join("\n"),
  }
}

/**
 * Renders the Tier-1 Architectural RepoMap (< 1,000 tokens) ranked by PageRank centrality,
 * showing each top file's PageRank score, in/out degree, LOC, and top exported symbols with [Lstart-Lend] spans,
 * plus a compact Mudball & Architecture Advisor hotspot summary when hotspots are present.
 */
export function renderRepoMap(db: Database, options: RenderRepoMapOptions = {}): Tier1RepoMapView {
  const t0 = performance.now()
  ensureCodeGraphSchema(db)

  const requestedBudget = options.budgetTokens ?? options.tokenBudget ?? options.maxTokens ?? 1000
  const effectiveCap = requestedBudget === 1000 ? 999 : requestedBudget
  const maxFiles = options.maxFiles ?? 25
  const maxSymbolsPerFile = options.maxSymbolsPerFile ?? 6
  const focusSet =
    options.focusPaths && options.focusPaths.length > 0
      ? new Set(options.focusPaths.map(normalizeRelPath))
      : null

  let fileRows = db
    .query(
      "SELECT path, loc, raw_tokens, skeleton_tokens, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC",
    )
    .all() as {
    path: string
    loc: number
    raw_tokens: number
    skeleton_tokens: number
    pagerank: number
  }[]

  if (fileRows.length > 0 && fileRows.every((r) => r.pagerank === 0)) {
    computeCodebasePageRank(db, { persist: true })
    fileRows = db
      .query(
        "SELECT path, loc, raw_tokens, skeleton_tokens, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC",
      )
      .all() as {
      path: string
      loc: number
      raw_tokens: number
      skeleton_tokens: number
      pagerank: number
    }[]
  }

  if (focusSet && focusSet.size > 0) {
    const focused = fileRows.filter((r) => focusSet.has(r.path))
    const rest = fileRows.filter((r) => !focusSet.has(r.path))
    fileRows = [...focused, ...rest]
  }

  const edgeRows = db
    .query("SELECT from_path, to_path, symbols_json, specifiers_json FROM code_import_edge")
    .all() as {
    from_path: string
    to_path: string
    symbols_json?: string
    specifiers_json?: string
  }[]

  const inDeg = new Map<string, number>()
  const outDeg = new Map<string, number>()
  const importedSymCountsByPath = new Map<string, Map<string, number>>()

  for (const e of edgeRows) {
    if (e.from_path === e.to_path) continue
    outDeg.set(e.from_path, (outDeg.get(e.from_path) ?? 0) + 1)
    inDeg.set(e.to_path, (inDeg.get(e.to_path) ?? 0) + 1)

    let symMap = importedSymCountsByPath.get(e.to_path)
    if (!symMap) {
      symMap = new Map()
      importedSymCountsByPath.set(e.to_path, symMap)
    }
    const rawJson = e.symbols_json || e.specifiers_json || "[]"
    const specs = JSON.parse(rawJson) as string[]
    for (const s of specs) {
      if (s === "*" || s.startsWith("* as ")) continue
      symMap.set(s, (symMap.get(s) ?? 0) + 1)
    }
  }

  const exportedSymbolsRows = db
    .query(
      "SELECT path, name, kind, start_line, end_line FROM code_symbol WHERE depth = 1 AND exported = 1 ORDER BY path ASC, start_line ASC",
    )
    .all() as { path: string; name: string; kind: string; start_line: number; end_line: number }[]

  const symbolsByPath = new Map<string, RepoMapSymbolSummary[]>()
  let topGodSymbol: { path: string; name: string; start_line: number; end_line: number; span: number } | null = null
  for (const s of exportedSymbolsRows) {
    let list = symbolsByPath.get(s.path)
    if (!list) {
      list = []
      symbolsByPath.set(s.path, list)
    }
    list.push({
      name: s.name,
      kind: s.kind,
      start_line: s.start_line,
      end_line: s.end_line,
    })
    if (s.kind !== "interface" && s.kind !== "type") {
      const span = s.end_line - s.start_line + 1
      if (span >= 120 && (!topGodSymbol || span > topGodSymbol.span)) {
        topGodSymbol = { path: s.path, name: s.name, start_line: s.start_line, end_line: s.end_line, span }
      }
    }
  }

  const advisorSummaryLines: string[] = []
  if (effectiveCap >= 400 && fileRows.length > 0) {
    let rawTotal = 0
    let skelTotal = 0
    let topGodFile: { path: string; loc: number; pagerank: number } | null = null
    let topHub: { path: string; inCount: number; outCount: number; deg: number; pagerank: number } | null = null

    for (const f of fileRows) {
      const skel = Math.max(1, f.skeleton_tokens || Math.ceil(f.loc * 1.2))
      const raw = Math.max(skel, f.raw_tokens || f.loc * 10)
      rawTotal += raw
      skelTotal += skel
      if (f.loc >= 600 && (!topGodFile || f.loc > topGodFile.loc)) {
        topGodFile = { path: f.path, loc: f.loc, pagerank: f.pagerank }
      }
      const ic = inDeg.get(f.path) ?? 0
      const oc = outDeg.get(f.path) ?? 0
      const deg = ic + oc
      if (deg >= 8 && (!topHub || deg > topHub.deg)) {
        topHub = { path: f.path, inCount: ic, outCount: oc, deg, pagerank: f.pagerank }
      }
    }

    const bullets: string[] = []
    if (topGodFile) {
      const sev = topGodFile.loc >= 1000 ? "high" : "warn"
      bullets.push(`- [${sev}/god_file] ${topGodFile.path} (${topGodFile.loc} LOC, PR=${topGodFile.pagerank.toFixed(4)})`)
    }
    if (topGodSymbol) {
      const sev = topGodSymbol.span >= 200 ? "high" : "warn"
      bullets.push(
        `- [${sev}/god_symbol] ${topGodSymbol.path}#${topGodSymbol.name} [L${topGodSymbol.start_line}-L${topGodSymbol.end_line}] (${topGodSymbol.span} lines)`,
      )
    }
    if (topHub) {
      const sev = topHub.deg >= 14 ? "high" : "warn"
      bullets.push(
        `- [${sev}/high_coupling_hub] ${topHub.path} (in=${topHub.inCount}, out=${topHub.outCount}, PR=${topHub.pagerank.toFixed(4)})`,
      )
    }

    if (bullets.length > 0) {
      const saved = Math.max(0, rawTotal - skelTotal)
      const pct = rawTotal > 0 ? ((saved / rawTotal) * 100).toFixed(1) : "0.0"
      advisorSummaryLines.push(
        `### Mudball & Architecture Advisor (saved ${saved} tokens, ${pct}% AST compression)`,
        ...bullets,
      )
    }
  }

  const headerLine = `# Tier-1 RepoMap (${fileRows.length} files, ${edgeRows.length} import edges, sorted by PageRank)`
  const lines: string[] = [headerLine]
  const entries: RepoMapEntry[] = []

  const candidateCount = Math.min(fileRows.length, maxFiles)
  for (let i = 0; i < candidateCount; i++) {
    const f = fileRows[i]!
    const symCounts = importedSymCountsByPath.get(f.path)
    let allSyms = [...(symbolsByPath.get(f.path) ?? [])]

    if (allSyms.length > 0) {
      allSyms.sort((a, b) => {
        const callerA = symCounts?.get(a.name) ?? 0
        const callerB = symCounts?.get(b.name) ?? 0
        const weightA = callerA * 10 + symbolKindPriority(a.kind)
        const weightB = callerB * 10 + symbolKindPriority(b.kind)
        return weightB - weightA || a.start_line - b.start_line
      })
    } else if (symCounts && symCounts.size > 0) {
      allSyms = [...symCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => ({
          name,
          kind: "reexport",
          start_line: 1,
          end_line: f.loc,
        }))
    }

    const perFileSymbolCap =
      advisorSummaryLines.length > 0 && i >= 6
        ? Math.min(maxSymbolsPerFile, 3)
        : maxSymbolsPerFile
    const topSyms = allSyms.slice(0, perFileSymbolCap)
    const remainingCount = Math.max(0, allSyms.length - topSyms.length)

    const symText =
      topSyms.length > 0
        ? topSyms.map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`).join(", ") +
          (remainingCount > 0 ? `, +${remainingCount} more` : "")
        : `(module[L1-L${f.loc}])`

    const inCount = inDeg.get(f.path) ?? 0
    const outCount = outDeg.get(f.path) ?? 0
    const line = `${entries.length + 1}. ${f.path} (PR=${f.pagerank.toFixed(4)}, in=${inCount}, out=${outCount}, ${f.loc} LOC): ${symText}`

    const candidateText = [...lines, line, ...advisorSummaryLines].join("\n")
    if (estimateTokens(candidateText) > effectiveCap) {
      break
    }

    lines.push(line)
    entries.push({
      rank: entries.length + 1,
      path: f.path,
      pagerank: f.pagerank,
      in_degree: inCount,
      out_degree: outCount,
      loc: f.loc,
      exported_symbol_count: allSyms.length,
      top_symbols: topSyms,
    })
  }

  if (entries.length > 0 && advisorSummaryLines.length > 0) {
    for (const advLine of advisorSummaryLines) {
      if (estimateTokens([...lines, advLine].join("\n")) <= effectiveCap) {
        lines.push(advLine)
      }
    }
  }

  const text = lines.join("\n")
  const elapsedMs = performance.now() - t0
  const estTokens = estimateTokens(text)

  return {
    total_files: fileRows.length,
    total_edges: edgeRows.length,
    included_files: entries.length,
    estimated_tokens: estTokens,
    token_budget: requestedBudget,
    budget_tokens: requestedBudget,
    elapsed_ms: elapsedMs,
    entries,
    text,
    markdown: text,
  }
}

export const renderTier1RepoMap = renderRepoMap

