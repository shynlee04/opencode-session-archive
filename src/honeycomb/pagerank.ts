import { Database } from "bun:sqlite"
import { ensureCodeGraphSchema, estimateTokens, normalizeRelPath } from "./ast-skeleton.ts"

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

/**
 * Renders the Tier-1 Architectural RepoMap (< 1,000 tokens) ranked by PageRank centrality,
 * showing each top file's PageRank score, in/out degree, LOC, and top exported symbols with [Lstart-Lend] spans.
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
    .query("SELECT path, loc, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC")
    .all() as { path: string; loc: number; pagerank: number }[]

  if (fileRows.length > 0 && fileRows.every((r) => r.pagerank === 0)) {
    computeCodebasePageRank(db, { persist: true })
    fileRows = db
      .query("SELECT path, loc, pagerank FROM code_file ORDER BY pagerank DESC, loc DESC, path ASC")
      .all() as { path: string; loc: number; pagerank: number }[]
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

    const topSyms = allSyms.slice(0, maxSymbolsPerFile)
    const remainingCount = Math.max(0, allSyms.length - topSyms.length)

    const symText =
      topSyms.length > 0
        ? topSyms.map((s) => `${s.name}[L${s.start_line}-L${s.end_line}]`).join(", ") +
          (remainingCount > 0 ? `, +${remainingCount} more` : "")
        : `(module[L1-L${f.loc}])`

    const inCount = inDeg.get(f.path) ?? 0
    const outCount = outDeg.get(f.path) ?? 0
    const line = `${entries.length + 1}. ${f.path} (PR=${f.pagerank.toFixed(4)}, in=${inCount}, out=${outCount}, ${f.loc} LOC): ${symText}`

    const candidateText = [...lines, line].join("\n")
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
