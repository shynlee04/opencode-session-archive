import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { Database } from "bun:sqlite"
import { ensureHoneycombSchema } from "../archive/index-db.ts"
import {
  estimateTokens as estimateTokensPrimitive,
  JIT_SKELETON_MARKER,
  normalizeRepoPath,
  resolveDiskPath,
  sha256Hex,
} from "../archive/primitives.ts"

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "method"
  | "property"

export interface LexicalLines {
  readonly numLines: number
  readonly rawLines: readonly string[]
  readonly lineStartBrace: Int32Array
  readonly lineEndBrace: Int32Array
  readonly lineMinBrace: Int32Array
  readonly lineStartParen: Int32Array
  readonly lineEndParen: Int32Array
  readonly lineStartBracket: Int32Array
  readonly lineEndBracket: Int32Array
  readonly lineStartInLiteral: Uint8Array
  readonly commentOrStringMask: Uint8Array
  getCodeLine(lineNum: number): string
  getDisplayLine(lineNum: number): string
}

export interface ExtractedSymbol {
  readonly path: string
  readonly name: string
  readonly qualified_name: string
  readonly kind: SymbolKind
  readonly depth: 1 | 2
  readonly parent_symbol: string | null
  readonly start_line: number
  readonly end_line: number
  readonly signature: string
  readonly exported: boolean
}

export interface ExtractedImport {
  readonly specifier: string
  readonly resolvedPath: string | null
  readonly names: readonly string[]
  readonly typeOnly: boolean
}

export interface SkeletonizeOptions {
  readonly rootDir?: string
  readonly knownPaths?: ReadonlySet<string>
  readonly closureFactoryMinLines?: number
  readonly factoryLineThreshold?: number
}

export interface SkeletonizeResult {
  readonly filePath: string
  readonly loc: number
  readonly rawChars: number
  readonly rawTokens: number
  readonly skeletonChars: number
  readonly skeletonTokens: number
  readonly reductionRatio: number
  readonly exports: readonly string[]
  readonly imports: readonly ExtractedImport[]
  readonly symbols: readonly ExtractedSymbol[]
  readonly skeletonText: string
}

export interface CodeFileRow {
  readonly path: string
  readonly blob_sha: string
  readonly loc: number
  readonly raw_tokens: number
  readonly skeleton_tokens: number
  readonly skeleton_text: string
  readonly pagerank: number
  readonly updated_at: number
}

export interface CodeSymbolRow {
  readonly path: string
  readonly name: string
  readonly qualified_name: string
  readonly kind: SymbolKind
  readonly depth: number
  readonly parent_symbol: string | null
  readonly start_line: number
  readonly end_line: number
  readonly signature: string
  readonly exported: number
  readonly blob_sha: string
}

export interface CodeImportEdgeRow {
  readonly from_path: string
  readonly to_path: string
  readonly specifier: string
  readonly symbols_json: string
  readonly specifiers_json: string
  readonly is_type_only: number
}

export interface IndexCodebaseOptions {
  readonly paths?: readonly string[]
  readonly relPaths?: readonly string[]
  readonly subDirs?: readonly string[]
  readonly subDir?: string
  readonly force?: boolean
  readonly forceRebuild?: boolean
  readonly closureFactoryMinLines?: number
  readonly factoryLineThreshold?: number
}

export interface IndexCodebaseStats {
  readonly totalFiles: number
  readonly parsedFiles: number
  readonly skippedWarmFiles: number
  readonly skippedUnchangedFiles: number
  readonly removedFiles: number
  readonly totalLoc: number
  readonly totalRawTokens: number
  readonly totalSkeletonTokens: number
  readonly reductionRatio: number
  readonly tokenReductionPct: number
  readonly totalSymbols: number
  readonly extractedSymbols: number
  readonly depth1Symbols: number
  readonly depth2Symbols: number
  readonly totalImportEdges: number
  readonly importEdges: number
  readonly elapsedMs: number
}

export interface AstSkeletonView {
  readonly path: string
  readonly blob_sha: string
  readonly loc: number
  readonly raw_tokens: number
  readonly skeleton_tokens: number
  readonly reduction_ratio: number
  readonly pagerank: number
  readonly updated_at: number
  readonly skeleton_text: string
  readonly symbols: readonly ExtractedSymbol[]
  readonly imports: readonly {
    readonly to_path: string
    readonly specifier: string
    readonly specifiers: readonly string[]
    readonly symbols: readonly string[]
    readonly is_type_only: boolean
  }[]
  readonly imported_by: readonly {
    readonly from_path: string
    readonly specifier: string
    readonly specifiers: readonly string[]
    readonly symbols: readonly string[]
    readonly is_type_only: boolean
  }[]
}

export interface SymbolSliceView {
  readonly path: string
  readonly symbol: string | null
  readonly qualified_name: string | null
  readonly kind: SymbolKind | null
  readonly depth: number | null
  readonly parent_symbol: string | null
  readonly start_line: number
  readonly end_line: number
  readonly line_count: number
  readonly slice_tokens: number
  readonly raw_file_tokens: number
  readonly header: string
  readonly slice_text: string
}

export const CODE_GRAPH_DDL = `
CREATE TABLE IF NOT EXISTS code_file (
  path TEXT PRIMARY KEY,
  blob_sha TEXT NOT NULL,
  loc INTEGER NOT NULL,
  raw_tokens INTEGER NOT NULL,
  skeleton_tokens INTEGER NOT NULL,
  skeleton_text TEXT NOT NULL,
  pagerank REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS code_symbol (
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  qualified_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  depth INTEGER NOT NULL,
  parent_symbol TEXT,
  exported INTEGER NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT NOT NULL,
  blob_sha TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, start_line, qualified_name)
);

CREATE INDEX IF NOT EXISTS idx_code_symbol_path_name ON code_symbol(path, name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name);
CREATE INDEX IF NOT EXISTS idx_code_symbol_parent ON code_symbol(path, parent_symbol);

CREATE TABLE IF NOT EXISTS code_import_edge (
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  specifier TEXT NOT NULL DEFAULT '',
  symbols_json TEXT NOT NULL DEFAULT '[]',
  specifiers_json TEXT NOT NULL DEFAULT '[]',
  is_type_only INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_path, to_path)
);

CREATE INDEX IF NOT EXISTS idx_code_import_edge_to ON code_import_edge(to_path);
`

const initializedCodeGraphDbs = new WeakSet<Database>()
const tsTranspiler = new Bun.Transpiler({ loader: "ts" })
const tsxTranspiler = new Bun.Transpiler({ loader: "tsx" })

export function ensureCodeGraphSchema(db: Database): void {
  ensureHoneycombSchema(db)
  if (initializedCodeGraphDbs.has(db)) {
    const hasTable = db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'code_file'")
      .get()
    if (hasTable) return
  }

  db.exec("PRAGMA journal_mode = WAL")
  db.exec(CODE_GRAPH_DDL)

  const symbolCols = new Set(
    (db.query("PRAGMA table_info(code_symbol)").all() as { name: string }[]).map((c) => c.name),
  )
  if (!symbolCols.has("qualified_name")) {
    db.exec("ALTER TABLE code_symbol ADD COLUMN qualified_name TEXT NOT NULL DEFAULT ''")
    db.exec(
      "UPDATE code_symbol SET qualified_name = CASE WHEN parent_symbol IS NOT NULL AND parent_symbol != '' THEN parent_symbol || '.' || name ELSE name END WHERE qualified_name = ''",
    )
    db.exec("CREATE INDEX IF NOT EXISTS idx_code_symbol_path_qualified ON code_symbol(path, qualified_name)")
  }
  if (!symbolCols.has("blob_sha")) {
    db.exec("ALTER TABLE code_symbol ADD COLUMN blob_sha TEXT NOT NULL DEFAULT ''")
  }

  const edgeCols = new Set(
    (db.query("PRAGMA table_info(code_import_edge)").all() as { name: string }[]).map((c) => c.name),
  )
  if (!edgeCols.has("specifier")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN specifier TEXT NOT NULL DEFAULT ''")
  }
  if (!edgeCols.has("symbols_json")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN symbols_json TEXT NOT NULL DEFAULT '[]'")
    if (edgeCols.has("specifiers_json")) {
      db.exec("UPDATE code_import_edge SET symbols_json = specifiers_json WHERE symbols_json = '[]'")
    }
  }
  if (!edgeCols.has("specifiers_json")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN specifiers_json TEXT NOT NULL DEFAULT '[]'")
    if (edgeCols.has("symbols_json")) {
      db.exec("UPDATE code_import_edge SET specifiers_json = symbols_json WHERE specifiers_json = '[]'")
    }
  }
  if (!edgeCols.has("is_type_only")) {
    db.exec("ALTER TABLE code_import_edge ADD COLUMN is_type_only INTEGER NOT NULL DEFAULT 0")
  }

  initializedCodeGraphDbs.add(db)
}

export function normalizeRelPath(filePath: string, canonicalRoot?: unknown): string {
  return normalizeRepoPath(
    filePath,
    typeof canonicalRoot === "string" ? canonicalRoot : undefined,
  )
}

export function computeBlobSha(content: string): string {
  return sha256Hex(content)
}

export function estimateTokens(text: string | number): number {
  return typeof text === "number" ? Math.ceil(Math.max(0, text) / 4) : estimateTokensPrimitive(text)
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function isRegexTriggerCharCode(code: number): boolean {
  // =(,:[!&|?{};~+-*%^
  return (
    code === 61 ||
    code === 40 ||
    code === 44 ||
    code === 58 ||
    code === 91 ||
    code === 33 ||
    code === 38 ||
    code === 124 ||
    code === 63 ||
    code === 123 ||
    code === 125 ||
    code === 59 ||
    code === 126 ||
    code === 43 ||
    code === 45 ||
    code === 42 ||
    code === 37 ||
    code === 94
  )
}

function findClosingRegexSlash(line: string, startSlashIdx: number): number {
  const len = line.length
  let inCC = false
  for (let j = startSlashIdx + 1; j < len; j++) {
    const c = line.charCodeAt(j)
    if (c === 92) {
      j++
      continue
    }
    if (c === 91) {
      inCC = true
      continue
    }
    if (c === 93) {
      inCC = false
      continue
    }
    if (c === 47 && !inCC) return j
  }
  return -1
}

function findClosingQuote(line: string, startQuoteIdx: number, quoteCode: number): number {
  const len = line.length
  for (let j = startQuoteIdx + 1; j < len; j++) {
    const c = line.charCodeAt(j)
    if (c === 92) {
      j++
      continue
    }
    if (c === quoteCode) return j
  }
  return -1
}

function cleanSingleLine(line: string, maskStrings: boolean): string {
  const len = line.length
  let hasSpecial = false
  for (let i = 0; i < len; i++) {
    const c = line.charCodeAt(i)
    if (c === 47 || c === 39 || c === 34 || c === 96) {
      hasSpecial = true
      break
    }
  }
  if (!hasSpecial) return line

  let out = ""
  let segStart = 0
  let prevSig = 0
  for (let i = 0; i < len; i++) {
    const ch = line.charCodeAt(i)
    const next = i + 1 < len ? line.charCodeAt(i + 1) : 0
    if (ch === 47) {
      if (next === 47) {
        out += line.slice(segStart, i)
        return out
      }
      if (next === 42) {
        out += line.slice(segStart, i)
        i += 2
        while (i < len && !(line.charCodeAt(i) === 42 && line.charCodeAt(i + 1) === 47)) i++
        i++
        segStart = i + 1
        continue
      }
      if (isRegexTriggerCharCode(prevSig) && next > 32 && next !== 47 && next !== 42 && next !== 61 && next !== 62) {
        const found = findClosingRegexSlash(line, i)
        if (found !== -1) {
          if (maskStrings) {
            out += line.slice(segStart, i) + "/r/"
            segStart = found + 1
          }
          i = found
          prevSig = 47
          continue
        }
      }
    }
    if (ch === 39 || ch === 34 || ch === 96) {
      const found = findClosingQuote(line, i, ch)
      if (found !== -1) {
        if (maskStrings) {
          out += line.slice(segStart, i) + '""'
          segStart = found + 1
        }
        i = found
        prevSig = ch
        continue
      }
    }
    if (ch > 32) prevSig = ch
  }
  if (segStart === 0) return line
  if (segStart < len) out += line.slice(segStart)
  return out
}

export function scanLexicalLines(src: string): LexicalLines {
  const rawLines = src.split("\n")
  const numLines = rawLines.length

  const lineStartBrace = new Int32Array(numLines + 2)
  const lineEndBrace = new Int32Array(numLines + 2)
  const lineMinBrace = new Int32Array(numLines + 2)
  const lineStartParen = new Int32Array(numLines + 2)
  const lineEndParen = new Int32Array(numLines + 2)
  const lineStartBracket = new Int32Array(numLines + 2)
  const lineEndBracket = new Int32Array(numLines + 2)
  const lineStartInLiteral = new Uint8Array(numLines + 2)
  const commentOrStringMask = new Uint8Array(numLines + 2)

  let brace = 0
  let paren = 0
  let bracket = 0
  let mode = 0 // 0 = code, 1 = block_comment, 2 = template
  const templateBraceStack: number[] = []
  let prevSig = 0

  for (let L = 1; L <= numLines; L++) {
    lineStartBrace[L] = brace
    lineMinBrace[L] = brace
    lineStartParen[L] = paren
    lineStartBracket[L] = bracket
    const startsInLiteral = mode !== 0 ? 1 : 0
    lineStartInLiteral[L] = startsInLiteral
    let hasCommentOrString = startsInLiteral

    const line = rawLines[L - 1]!
    const len = line.length
    for (let i = 0; i < len; i++) {
      const ch = line.charCodeAt(i)
      const next = i + 1 < len ? line.charCodeAt(i + 1) : 0
      if (mode === 1) {
        hasCommentOrString = 1
        if (ch === 42 && next === 47) {
          mode = 0
          i++
        }
        continue
      }
      if (mode === 2) {
        hasCommentOrString = 1
        if (ch === 92) {
          i++
          continue
        }
        if (ch === 96) {
          mode = 0
          continue
        }
        if (ch === 36 && next === 123) {
          templateBraceStack.push(brace)
          brace++
          mode = 0
          i++
        }
        continue
      }
      if (ch === 47) {
        if (next === 47) {
          hasCommentOrString = 1
          break
        }
        if (next === 42) {
          hasCommentOrString = 1
          mode = 1
          i++
          continue
        }
        if (isRegexTriggerCharCode(prevSig) && next > 32 && next !== 47 && next !== 42 && next !== 61 && next !== 62) {
          const found = findClosingRegexSlash(line, i)
          if (found !== -1) {
            hasCommentOrString = 1
            i = found
            prevSig = 47
            continue
          }
        }
      }
      if (ch === 39 || ch === 34) {
        const found = findClosingQuote(line, i, ch)
        if (found !== -1) {
          hasCommentOrString = 1
          i = found
          prevSig = ch
          continue
        }
      }
      if (ch === 96) {
        hasCommentOrString = 1
        mode = 2
        prevSig = ch
        continue
      }
      if (ch === 123) {
        brace++
        prevSig = ch
        continue
      }
      if (ch === 125) {
        if (brace > 0) brace--
        if (brace < lineMinBrace[L]!) lineMinBrace[L] = brace
        if (templateBraceStack.length > 0 && brace === templateBraceStack[templateBraceStack.length - 1]) {
          templateBraceStack.pop()
          mode = 2
        }
        prevSig = ch
        continue
      }
      if (ch === 40) {
        paren++
        prevSig = ch
        continue
      }
      if (ch === 41) {
        if (paren > 0) paren--
        prevSig = ch
        continue
      }
      if (ch === 91) {
        bracket++
        prevSig = ch
        continue
      }
      if (ch === 93) {
        if (bracket > 0) bracket--
        prevSig = ch
        continue
      }
      if (ch > 32) prevSig = ch
    }

    commentOrStringMask[L] = hasCommentOrString
    lineEndBrace[L] = brace
    lineEndParen[L] = paren
    lineEndBracket[L] = bracket
  }

  const codeCache = new Array<string | undefined>(numLines + 2)
  const displayCache = new Array<string | undefined>(numLines + 2)

  return {
    numLines,
    rawLines,
    lineStartBrace,
    lineEndBrace,
    lineMinBrace,
    lineStartParen,
    lineEndParen,
    lineStartBracket,
    lineEndBracket,
    lineStartInLiteral,
    commentOrStringMask,
    getCodeLine(lineNum: number): string {
      if (lineNum < 1 || lineNum > numLines) return ""
      let cached = codeCache[lineNum]
      if (cached === undefined) {
        cached = cleanSingleLine(rawLines[lineNum - 1]!, true)
        codeCache[lineNum] = cached
      }
      return cached
    },
    getDisplayLine(lineNum: number): string {
      if (lineNum < 1 || lineNum > numLines) return ""
      let cached = displayCache[lineNum]
      if (cached === undefined) {
        cached = cleanSingleLine(rawLines[lineNum - 1]!, false)
        displayCache[lineNum] = cached
      }
      return cached
    },
  }
}

export function resolveImportSpecifier(
  fromRelPath: string,
  specifier: string,
  knownPaths?: ReadonlySet<string>,
  rootDir?: string,
): string | null {
  if (!specifier.startsWith(".")) return null
  const fromDir = path.posix.dirname(normalizeRelPath(fromRelPath))
  const base = path.posix.normalize(path.posix.join(fromDir, specifier))
  const strippedExt = base.replace(/\.(?:js|jsx|mjs|cjs)$/, "")
  const candidates = [
    base,
    `${strippedExt}.ts`,
    `${strippedExt}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]
  if (knownPaths !== undefined) {
    for (const candidate of candidates) {
      if (knownPaths.has(candidate)) return candidate
    }
  }
  if (rootDir !== undefined) {
    for (const candidate of candidates) {
      const full = path.join(rootDir, candidate)
      if (existsSync(full) && statSync(full).isFile()) return candidate
    }
  }
  return null
}

function firstNonSpaceCode(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 32) return c
  }
  return 0
}

function extractImportsAndReexports(
  fromRelPath: string,
  lex: LexicalLines,
  scannedImports: readonly { readonly kind: string; readonly path: string }[],
  knownPaths?: ReadonlySet<string>,
  rootDir?: string,
): { readonly imports: readonly ExtractedImport[]; readonly reexportedNames: ReadonlySet<string> } {
  const bySpec = new Map<string, { names: Set<string>; typeOnly: boolean }>()
  for (const im of scannedImports) {
    if (!bySpec.has(im.path)) {
      bySpec.set(im.path, { names: new Set(), typeOnly: false })
    }
  }
  const reexportedNames = new Set<string>()
  const { numLines, rawLines, lineStartBrace, lineStartParen, lineStartInLiteral } = lex

  for (let L = 1; L <= numLines; L++) {
    if (lineStartBrace[L] !== 0 || lineStartParen[L] !== 0 || lineStartInLiteral[L]) continue
    const raw = rawLines[L - 1]!
    const fc = firstNonSpaceCode(raw)
    if (fc !== 105 && fc !== 101) continue

    const t = lex.getDisplayLine(L).trim()
    if (!t) continue
    const isImport = t.startsWith("import ") || t.startsWith("import\t")
    const isExportBraceOrStar = /^export\s+(?:type\s+)?(?:\*|\{)/.test(t)
    if (!isImport && !isExportBraceOrStar) continue

    let stmt = t
    let endL = L
    while (endL < numLines) {
      if (/from\s+["'][^"']+["']/.test(stmt)) break
      if (isImport && /^import\s+["'][^"']+["']/.test(stmt)) break
      if (
        isExportBraceOrStar &&
        stmt.includes("}") &&
        !/}\s*from\b/.test(stmt) &&
        !lex.getDisplayLine(endL + 1).trim().startsWith("from")
      ) {
        break
      }
      endL++
      stmt += " " + lex.getDisplayLine(endL).trim()
    }
    L = endL

    const fromMatch = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/.exec(stmt)
    if (fromMatch) {
      const kw = fromMatch[1]!
      const isType = Boolean(fromMatch[2])
      const clause = fromMatch[3]!.trim()
      const spec = fromMatch[4]!.trim()
      let entry = bySpec.get(spec)
      if (!entry) {
        entry = { names: new Set(), typeOnly: isType }
        bySpec.set(spec, entry)
      } else if (!isType) {
        entry.typeOnly = false
      }
      const braceMatch = /\{([\s\S]*?)\}/.exec(clause)
      if (braceMatch) {
        for (const part of braceMatch[1]!.split(",")) {
          const clean = part.replace(/^\s*type\s+/, "").trim()
          if (!clean) continue
          const pieces = clean.split(/\s+as\s+/)
          const orig = pieces[0]!.trim()
          const alias = (pieces[1] ?? pieces[0])!.trim()
          if (orig) entry.names.add(orig)
          if (kw === "export" && alias) reexportedNames.add(alias)
        }
      } else if (clause.includes("*")) {
        entry.names.add("*")
      } else if (clause) {
        entry.names.add(clause.replace(/^\s*type\s+/, "").trim())
      }
    } else if (isExportBraceOrStar) {
      const braceMatch = /\{([\s\S]*?)\}/.exec(stmt)
      if (braceMatch) {
        for (const part of braceMatch[1]!.split(",")) {
          const clean = part.replace(/^\s*type\s+/, "").trim()
          if (!clean) continue
          const pieces = clean.split(/\s+as\s+/)
          const alias = (pieces[1] ?? pieces[0])!.trim()
          if (alias) reexportedNames.add(alias)
        }
      }
    }
  }

  const imports: ExtractedImport[] = []
  for (const [specifier, info] of bySpec.entries()) {
    const resolvedPath = resolveImportSpecifier(fromRelPath, specifier, knownPaths, rootDir)
    imports.push({
      specifier,
      resolvedPath,
      names: [...info.names].sort(),
      typeOnly: info.typeOnly,
    })
  }
  return { imports, reexportedNames }
}

interface SpanResult {
  readonly sigEndLine: number
  readonly endLine: number
  readonly isFunctionLike: boolean
}

function findDeclarationSpan(lex: LexicalLines, startLine: number, kind: SymbolKind): SpanResult {
  const {
    numLines,
    lineStartBrace,
    lineEndBrace,
    lineMinBrace,
    lineStartParen,
    lineEndParen,
    lineStartBracket,
    lineEndBracket,
    lineStartInLiteral,
  } = lex
  const baseB = lineStartBrace[startLine]!
  const baseP = lineStartParen[startLine]!
  const baseK = lineStartBracket[startLine]!
  const firstLineCode = lex.getCodeLine(startLine).trim()
  const isNewExpr = /=\s*new\s+[A-Za-z_$]/.test(firstLineCode)

  if (kind === "interface" || kind === "class" || kind === "enum") {
    let opened = false
    let sigEndLine = startLine
    let b = baseB
    for (let L = startLine; L <= numLines; L++) {
      const s = lex.getCodeLine(L)
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "{") {
          if (!opened && b === baseB) {
            opened = true
            sigEndLine = L
          }
          b++
        } else if (s[i] === "}") {
          b--
          if (opened && b === baseB) {
            return { sigEndLine, endLine: L, isFunctionLike: false }
          }
        }
      }
      if (opened && b > baseB) {
        let closeL = L + 1
        while (closeL <= numLines && lineMinBrace[closeL]! > baseB) closeL++
        return { sigEndLine, endLine: Math.min(numLines, closeL), isFunctionLike: false }
      }
    }
    return { sigEndLine, endLine: numLines, isFunctionLike: false }
  }

  if (kind === "type") {
    for (let L = startLine; L <= numLines; L++) {
      if (
        lineEndBrace[L]! <= baseB &&
        lineEndParen[L]! <= baseP &&
        lineEndBracket[L]! <= baseK &&
        !lineStartInLiteral[L + 1]
      ) {
        const curTrim = lex.getCodeLine(L).trim()
        const nextTrim = lex.getCodeLine(L + 1).trim()
        if (/[=|&?:<,]$/.test(curTrim)) continue
        if (/^[|&?:]/.test(nextTrim)) continue
        return { sigEndLine: startLine, endLine: L, isFunctionLike: false }
      }
    }
    return { sigEndLine: startLine, endLine: numLines, isFunctionLike: false }
  }

  let b = baseB
  let p = baseP
  let k = baseK
  let seenParens = false
  let paramsClosed = false
  let seenArrow = false
  let bodyOpened = false
  let sigEndLine = startLine

  for (let L = startLine; L <= numLines; L++) {
    const s = lex.getCodeLine(L)
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      const nxt = i + 1 < s.length ? s[i + 1]! : ""
      if (!isNewExpr && !bodyOpened && c === "=" && nxt === ">" && b === baseB && p === baseP) {
        seenArrow = true
        sigEndLine = L
        i++
        continue
      }
      if (c === "(") {
        if (b === baseB && p === baseP && !seenParens) seenParens = true
        p++
      } else if (c === ")") {
        p--
        if (seenParens && p === baseP && b === baseB) paramsClosed = true
      } else if (c === "[") {
        k++
      } else if (c === "]") {
        k--
      } else if (c === "{") {
        if (!bodyOpened && b === baseB && p === baseP) {
          if (kind === "function" || kind === "method" || seenArrow) {
            let tb = 1
            let tl = L
            let ti = i + 1
            for (; tl <= numLines; tl++) {
              const ts = lex.getCodeLine(tl)
              for (; ti < ts.length; ti++) {
                if (ts[ti] === "{") tb++
                else if (ts[ti] === "}") {
                  tb--
                  if (tb === 0) break
                }
              }
              if (tb === 0) break
              ti = 0
              if (tl + 1 <= numLines && lineMinBrace[tl + 1]! > b + 1) {
                while (tl + 1 <= numLines && lineMinBrace[tl + 1]! > b + 1) tl++
              }
            }
            if (tb === 0) {
              const restSame = lex.getCodeLine(tl).slice(ti + 1).trim()
              const restNext = lex.getCodeLine(tl + 1).trim()
              const after = restSame || restNext
              if (after.startsWith("{") || after.startsWith("=>")) {
                b++
                continue
              }
            }
            bodyOpened = true
            sigEndLine = L
          }
        }
        b++
      } else if (c === "}") {
        b--
        if (bodyOpened && b === baseB && p === baseP) {
          return { sigEndLine, endLine: L, isFunctionLike: true }
        }
      }
    }

    if (bodyOpened && b > baseB) {
      let closeL = L + 1
      while (closeL <= numLines && lineMinBrace[closeL]! > baseB) closeL++
      return { sigEndLine, endLine: Math.min(numLines, closeL), isFunctionLike: true }
    }

    if (
      !bodyOpened &&
      !seenArrow &&
      (kind === "const" || kind === "property") &&
      (isNewExpr || !seenParens)
    ) {
      while (
        L < numLines &&
        (lineEndBrace[L]! > baseB ||
          lineEndParen[L]! > baseP ||
          lineEndBracket[L]! > baseK ||
          lineStartInLiteral[L + 1] === 1)
      ) {
        L++
      }
      b = lineEndBrace[L]!
      p = lineEndParen[L]!
      k = lineEndBracket[L]!
    }

    if (!bodyOpened && b <= baseB && p <= baseP && k <= baseK && !lineStartInLiteral[L + 1]) {
      const curTrim = lex.getCodeLine(L).trim()
      const nextTrim = lex.getCodeLine(L + 1).trim()
      if (seenArrow) {
        if (/(=>|&&|\|\||\?\?|\?|:|\+|-|\*|=|\()$/.test(curTrim)) continue
        if (/^(\.|\?|:|&&|\|\||\?\?)/.test(nextTrim)) continue
        return { sigEndLine, endLine: L, isFunctionLike: true }
      }
      if (kind === "const" || kind === "property") {
        if (/(=|\+|\||&&|\|\||\?\?|\()$/.test(curTrim)) continue
        if (!seenParens || isNewExpr) {
          return { sigEndLine: startLine, endLine: L, isFunctionLike: false }
        }
        if (seenParens && paramsClosed && !curTrim.endsWith(":") && !nextTrim.startsWith("=>")) {
          return { sigEndLine: startLine, endLine: L, isFunctionLike: false }
        }
      }
    }
  }

  return { sigEndLine, endLine: numLines, isFunctionLike: seenArrow }
}

function buildSignature(
  lex: LexicalLines,
  startLine: number,
  sigEndLine: number,
  endLine: number,
  kind: SymbolKind,
): string {
  const raw: string[] = []
  for (let L = startLine; L <= sigEndLine; L++) {
    const t = lex.getDisplayLine(L).trim()
    if (t) raw.push(t)
  }
  let joined = normalizeWhitespace(raw.join(" "))
  if (kind === "interface" || kind === "class" || kind === "enum") {
    joined = joined.replace(/\s*\{.*$/, "")
    return `${joined} { /* L${startLine}-L${endLine} */ }`
  }
  if (kind === "type") {
    if (startLine === endLine && joined.length <= 100) return joined
    const eqIdx = joined.indexOf("=")
    const lhs = eqIdx !== -1 ? joined.slice(0, eqIdx + 1).trim() : joined
    return `${lhs} /* L${startLine}-L${endLine} */`
  }
  const arrowIdx = joined.lastIndexOf("=>")
  if (arrowIdx !== -1) {
    const header = joined.slice(0, arrowIdx + 2).trim()
    return `${header} { /* L${startLine}-L${endLine} */ }`
  }
  if (kind === "function" || kind === "method") {
    const braceIdx = joined.lastIndexOf("{")
    const header = braceIdx !== -1 ? joined.slice(0, braceIdx).trim() : joined
    return `${header} { /* L${startLine}-L${endLine} */ }`
  }
  if (startLine === endLine && joined.length <= 100) return joined
  const eqIdx = joined.indexOf("=")
  const lhs = eqIdx !== -1 ? joined.slice(0, eqIdx + 1).trim() : joined
  return `${lhs} /* L${startLine}-L${endLine} */`
}

export function skeletonizeSource(
  filePath: string,
  sourceText: string,
  options: SkeletonizeOptions = {},
): SkeletonizeResult {
  const normPath = normalizeRelPath(filePath)
  const isTsx = normPath.endsWith(".tsx")
  const scanned = (isTsx ? tsxTranspiler : tsTranspiler).scan(sourceText)
  const lex = scanLexicalLines(sourceText)
  const { imports, reexportedNames } = extractImportsAndReexports(
    normPath,
    lex,
    scanned.imports ?? [],
    options.knownPaths,
    options.rootDir,
  )

  const exportSet = new Set<string>([...(scanned.exports ?? []), ...reexportedNames])
  const explicitThreshold = options.closureFactoryMinLines ?? options.factoryLineThreshold
  const factoryThreshold = explicitThreshold ?? 200
  const symbols: ExtractedSymbol[] = []
  const skeletonLines: string[] = [`// ${normPath} (${lex.numLines} LOC)`]

  if (imports.length > 0) {
    const specs = imports.map((im) => im.resolvedPath ?? im.specifier)
    skeletonLines.push(`// imports: ${specs.join(", ")}`)
  }

  const { numLines, rawLines, lineStartBrace, lineStartParen, lineStartInLiteral } = lex

  for (let L = 1; L <= numLines; L++) {
    if (lineStartBrace[L] !== 0 || lineStartParen[L] !== 0 || lineStartInLiteral[L]) continue
    const fc = firstNonSpaceCode(rawLines[L - 1]!)
    if (
      fc !== 101 &&
      fc !== 102 &&
      fc !== 99 &&
      fc !== 105 &&
      fc !== 116 &&
      fc !== 97 &&
      fc !== 100 &&
      fc !== 108
    ) {
      continue
    }

    const s = lex.getCodeLine(L).trim()
    if (!s) continue

    const m =
      /^(export\s+)?(declare\s+)?(default\s+)?(async\s+)?(function|class|interface|type|const|let|enum|const\s+enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
        s,
      )
    if (!m) continue

    const name = m[6]!
    const exported = Boolean(m[1]) || exportSet.has(name)
    if (exported) exportSet.add(name)

    const rawKind = m[5]!.replace(/^const\s+/, "").trim()
    const baseKind = (rawKind === "let" ? "const" : rawKind) as SymbolKind
    const span = findDeclarationSpan(lex, L, baseKind)
    const effectiveKind: SymbolKind = baseKind === "const" && span.isFunctionLike ? "function" : baseKind
    const sig = buildSignature(lex, L, span.sigEndLine, span.endLine, effectiveKind)

    symbols.push({
      path: normPath,
      name,
      qualified_name: name,
      kind: effectiveKind,
      depth: 1,
      parent_symbol: null,
      start_line: L,
      end_line: span.endLine,
      signature: sig,
      exported,
    })
    skeletonLines.push(`[L${L}-L${span.endLine}] ${sig}`)

    const spanLen = span.endLine - L + 1
    const shouldDescendDepth2 =
      baseKind === "class" ||
      ((baseKind === "function" || baseKind === "const") &&
        (spanLen >= factoryThreshold ||
          (explicitThreshold === undefined && (spanLen > 50 || /^create[A-Z]/.test(name)))))

    if (shouldDescendDepth2) {
      for (let cL = span.sigEndLine + 1; cL < span.endLine; cL++) {
        if (lineStartInLiteral[cL] || lineStartParen[cL] !== 0) continue
        const bDepth = lineStartBrace[cL]
        if (bDepth !== 1) continue
        const cfc = firstNonSpaceCode(rawLines[cL - 1]!)
        if (cfc === 0 || cfc === 47 || cfc === 42 || cfc === 125) continue
        if (baseKind !== "class" && cfc !== 99 && cfc !== 102 && cfc !== 97 && cfc !== 114) continue

        const cs = lex.getCodeLine(cL).trim()
        if (!cs) continue

        if (baseKind === "class") {
          const cm =
            /^(?:(public|private|protected|static|readonly|async|get|set|override)\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/.exec(
              cs,
            )
          if (cm && !["if", "for", "while", "switch", "catch"].includes(cm[2]!)) {
            const mName = cm[2]!
            const mSpan = findDeclarationSpan(lex, cL, "method")
            const mSig = buildSignature(lex, cL, mSpan.sigEndLine, mSpan.endLine, "method")
            symbols.push({
              path: normPath,
              name: mName,
              qualified_name: `${name}.${mName}`,
              kind: "method",
              depth: 2,
              parent_symbol: name,
              start_line: cL,
              end_line: mSpan.endLine,
              signature: mSig,
              exported,
            })
            skeletonLines.push(`  [L${cL}-L${mSpan.endLine}] ${mSig}`)
            cL = mSpan.endLine
          }
        } else {
          const fm = /^(async\s+)?(function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(cs)
          if (fm) {
            const fKind = fm[2] as SymbolKind
            const fName = fm[3]!
            const fSpan = findDeclarationSpan(lex, cL, fKind)
            if (fKind === "function" || fSpan.isFunctionLike) {
              const fSig = buildSignature(lex, cL, fSpan.sigEndLine, fSpan.endLine, "function")
              symbols.push({
                path: normPath,
                name: fName,
                qualified_name: `${name}.${fName}`,
                kind: "function",
                depth: 2,
                parent_symbol: name,
                start_line: cL,
                end_line: fSpan.endLine,
                signature: fSig,
                exported: false,
              })
              skeletonLines.push(`  [L${cL}-L${fSpan.endLine}] ${fSig}`)
            }
            cL = fSpan.endLine
            continue
          }

          if (cs.startsWith("return") && /^return\s*\{/.test(cs)) {
            const retSpan = findDeclarationSpan(lex, cL, "interface")
            for (let rL = cL + 1; rL < retSpan.endLine; rL++) {
              if (lineStartBrace[rL] !== 2 || lineStartParen[rL] !== 0 || lineStartInLiteral[rL]) continue
              const rfc = firstNonSpaceCode(rawLines[rL - 1]!)
              if (rfc === 0 || rfc === 47 || rfc === 42 || rfc === 125) continue
              const rs = lex.getCodeLine(rL).trim()
              const rm =
                /^(?:(async)\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*(?:async\s*)?\(|:\s*[A-Za-z_$][A-Za-z0-9_$]*\s*=>|\()/.exec(
                  rs,
                )
              if (rm) {
                const rName = rm[2]!
                const isMethodShorthand =
                  rs.startsWith("async ") || /^([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.test(rs)
                const rSpan = findDeclarationSpan(lex, rL, isMethodShorthand ? "method" : "property")
                const rSig = buildSignature(lex, rL, rSpan.sigEndLine, rSpan.endLine, "method")
                symbols.push({
                  path: normPath,
                  name: rName,
                  qualified_name: `${name}.${rName}`,
                  kind: "method",
                  depth: 2,
                  parent_symbol: name,
                  start_line: rL,
                  end_line: rSpan.endLine,
                  signature: rSig,
                  exported: true,
                })
                skeletonLines.push(`  [L${rL}-L${rSpan.endLine}] ${rSig}`)
                rL = rSpan.endLine
              }
            }
            cL = retSpan.endLine
          }
        }
      }
    }

    L = span.endLine
  }

  const skeletonText = skeletonLines.join("\n")
  const rawChars = sourceText.length
  const skeletonChars = skeletonText.length
  const rawTokens = estimateTokens(sourceText)
  const skeletonTokens = estimateTokens(skeletonText)
  const reductionRatio = rawTokens > 0 ? 1 - skeletonTokens / rawTokens : 0

  return {
    filePath: normPath,
    loc: numLines,
    rawChars,
    rawTokens,
    skeletonChars,
    skeletonTokens,
    reductionRatio,
    exports: [...exportSet].sort(),
    imports,
    symbols,
    skeletonText,
  }
}

export function skeletonizeFile(
  rootDir: string,
  relPath: string,
  options: SkeletonizeOptions = {},
): SkeletonizeResult {
  const normPath = normalizeRelPath(relPath)
  const absPath = path.join(rootDir, normPath)
  const sourceText = readFileSync(absPath, "utf8")
  return skeletonizeSource(normPath, sourceText, { ...options, rootDir: options.rootDir ?? rootDir })
}

export function collectTypeScriptFiles(rootDir: string, subDir = "src"): string[] {
  const startDir = path.join(rootDir, subDir)
  const results: string[] = []
  function walk(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        walk(full)
      } else if (/\.(?:ts|tsx)$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        results.push(normalizeRelPath(path.relative(rootDir, full)))
      }
    }
  }
  if (existsSync(startDir)) walk(startDir)
  return results.sort()
}

function resolveDbAndRootDir(
  first: Database | string,
  second: string | Database,
): { readonly db: Database; readonly rootDir: string } {
  if (typeof first === "string") {
    return { rootDir: first, db: second as Database }
  }
  return { db: first, rootDir: second as string }
}

export function indexCodebase(
  first: Database | string,
  second: string | Database,
  pathsOrOptions?: readonly string[] | IndexCodebaseOptions,
): IndexCodebaseStats {
  const t0 = performance.now()
  const { db, rootDir } = resolveDbAndRootDir(first, second)
  ensureCodeGraphSchema(db)

  let explicitPaths: readonly string[] | undefined
  let options: IndexCodebaseOptions = {}
  if (Array.isArray(pathsOrOptions)) {
    explicitPaths = pathsOrOptions
  } else if (pathsOrOptions && typeof pathsOrOptions === "object") {
    options = pathsOrOptions as IndexCodebaseOptions
    explicitPaths = options.paths ?? options.relPaths
  }

  const force = Boolean(options.force ?? options.forceRebuild)
  const subDirs = options.subDirs ?? [options.subDir ?? "src"]

  const discoveredPaths =
    explicitPaths ??
    subDirs.flatMap((sd) => collectTypeScriptFiles(rootDir, sd))
  const targetPaths = [...new Set(discoveredPaths.map(normalizeRelPath))].sort()
  const targetPathSet = new Set<string>(targetPaths)
  const knownPaths = new Set<string>(targetPaths)

  const existingRows = db
    .query("SELECT path, blob_sha, loc, raw_tokens, skeleton_tokens FROM code_file")
    .all() as {
    path: string
    blob_sha: string
    loc: number
    raw_tokens: number
    skeleton_tokens: number
  }[]
  const existingByPath = new Map(existingRows.map((r) => [r.path, r]))
  for (const r of existingRows) {
    if (targetPathSet.has(r.path) || existsSync(path.join(rootDir, r.path))) {
      knownPaths.add(r.path)
    }
  }

  const removedPaths: string[] = []
  for (const r of existingRows) {
    if (explicitPaths === undefined) {
      if (!targetPathSet.has(r.path)) {
        removedPaths.push(r.path)
      }
    } else if (!existsSync(path.join(rootDir, r.path))) {
      removedPaths.push(r.path)
    }
  }

  const toUpdate: {
    readonly relPath: string
    readonly blobSha: string
    readonly skeleton: SkeletonizeResult
  }[] = []

  let skippedWarmFiles = 0
  let totalLoc = 0
  let totalRawTokens = 0
  let totalSkeletonTokens = 0

  for (const relPath of targetPaths) {
    const absPath = path.join(rootDir, relPath)
    if (!existsSync(absPath)) {
      if (existingByPath.has(relPath) && !removedPaths.includes(relPath)) {
        removedPaths.push(relPath)
      }
      continue
    }
    const sourceText = readFileSync(absPath, "utf8")
    const blobSha = computeBlobSha(sourceText)
    const prev = existingByPath.get(relPath)
    if (!force && prev !== undefined && prev.blob_sha === blobSha) {
      skippedWarmFiles++
      totalLoc += prev.loc
      totalRawTokens += prev.raw_tokens
      totalSkeletonTokens += prev.skeleton_tokens
      continue
    }

    const skeleton = skeletonizeSource(relPath, sourceText, {
      rootDir,
      knownPaths,
      closureFactoryMinLines: options.closureFactoryMinLines,
      factoryLineThreshold: options.factoryLineThreshold,
    })
    totalLoc += skeleton.loc
    totalRawTokens += skeleton.rawTokens
    totalSkeletonTokens += skeleton.skeletonTokens
    toUpdate.push({ relPath, blobSha, skeleton })
  }

  if (toUpdate.length > 0 || removedPaths.length > 0) {
    const now = Date.now()
    const deleteFile = db.query("DELETE FROM code_file WHERE path = ?")
    const upsertFile = db.query(`
      INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT pagerank FROM code_file WHERE path = ?), 0), ?)
      ON CONFLICT(path) DO UPDATE SET
        blob_sha = excluded.blob_sha,
        loc = excluded.loc,
        raw_tokens = excluded.raw_tokens,
        skeleton_tokens = excluded.skeleton_tokens,
        skeleton_text = excluded.skeleton_text,
        updated_at = excluded.updated_at
    `)
    const deleteSymbols = db.query("DELETE FROM code_symbol WHERE path = ?")
    const insertSymbol = db.query(`
      INSERT OR REPLACE INTO code_symbol
        (path, name, qualified_name, kind, depth, parent_symbol, start_line, end_line, signature, exported, blob_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const deleteEdgesFrom = db.query("DELETE FROM code_import_edge WHERE from_path = ?")
    const deleteEdgesTo = db.query("DELETE FROM code_import_edge WHERE to_path = ?")
    const insertEdge = db.query(`
      INSERT OR REPLACE INTO code_import_edge
        (from_path, to_path, specifier, symbols_json, specifiers_json, is_type_only)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const applyUpdates = db.transaction(() => {
      for (const remPath of removedPaths) {
        deleteFile.run(remPath)
        deleteSymbols.run(remPath)
        deleteEdgesFrom.run(remPath)
        deleteEdgesTo.run(remPath)
      }
      for (const item of toUpdate) {
        const { relPath, blobSha, skeleton } = item
        upsertFile.run(
          relPath,
          blobSha,
          skeleton.loc,
          skeleton.rawTokens,
          skeleton.skeletonTokens,
          skeleton.skeletonText,
          relPath,
          now,
        )
        deleteSymbols.run(relPath)
        for (const sym of skeleton.symbols) {
          insertSymbol.run(
            sym.path,
            sym.name,
            sym.qualified_name,
            sym.kind,
            sym.depth,
            sym.parent_symbol,
            sym.start_line,
            sym.end_line,
            sym.signature,
            sym.exported ? 1 : 0,
            blobSha,
          )
        }
        deleteEdgesFrom.run(relPath)
        const edgesByTarget = new Map<
          string,
          { specifier: string; names: Set<string>; typeOnly: boolean }
        >()
        for (const imp of skeleton.imports) {
          if (!imp.resolvedPath) continue
          let entry = edgesByTarget.get(imp.resolvedPath)
          if (!entry) {
            entry = { specifier: imp.specifier, names: new Set(), typeOnly: imp.typeOnly }
            edgesByTarget.set(imp.resolvedPath, entry)
          } else if (!imp.typeOnly) {
            entry.typeOnly = false
          }
          for (const n of imp.names) entry.names.add(n)
        }
        for (const [toPath, info] of edgesByTarget.entries()) {
          const json = JSON.stringify([...info.names].sort())
          insertEdge.run(relPath, toPath, info.specifier, json, json, info.typeOnly ? 1 : 0)
        }
      }
    })
    applyUpdates()
  }

  const symCounts = db
    .query("SELECT COUNT(*) AS total, SUM(CASE WHEN depth = 2 THEN 1 ELSE 0 END) AS d2 FROM code_symbol")
    .get() as { total: number; d2: number | null }
  const edgeCounts = db.query("SELECT COUNT(*) AS total FROM code_import_edge").get() as { total: number }
  const elapsedMs = performance.now() - t0
  const reductionRatio = totalRawTokens > 0 ? 1 - totalSkeletonTokens / totalRawTokens : 0
  const totalSymbols = symCounts.total
  const depth2Symbols = symCounts.d2 ?? 0
  const depth1Symbols = Math.max(0, totalSymbols - depth2Symbols)
  const totalImportEdges = edgeCounts.total

  return {
    totalFiles: skippedWarmFiles + toUpdate.length,
    parsedFiles: toUpdate.length,
    skippedWarmFiles,
    skippedUnchangedFiles: skippedWarmFiles,
    removedFiles: removedPaths.length,
    totalLoc,
    totalRawTokens,
    totalSkeletonTokens,
    reductionRatio,
    tokenReductionPct: reductionRatio * 100,
    totalSymbols,
    extractedSymbols: totalSymbols,
    depth1Symbols,
    depth2Symbols,
    totalImportEdges,
    importEdges: totalImportEdges,
    elapsedMs,
  }
}

export function readAstSkeleton(db: Database, filePath: string): AstSkeletonView | null {
  ensureCodeGraphSchema(db)
  const normPath = normalizeRelPath(filePath)
  const fileRow = db.query("SELECT * FROM code_file WHERE path = ?").get(normPath) as CodeFileRow | null
  if (!fileRow) return null

  const symbolRows = db
    .query("SELECT * FROM code_symbol WHERE path = ? ORDER BY start_line ASC, depth ASC")
    .all(normPath) as CodeSymbolRow[]

  const outEdgeRows = db
    .query("SELECT * FROM code_import_edge WHERE from_path = ? ORDER BY to_path ASC")
    .all(normPath) as CodeImportEdgeRow[]

  const inEdgeRows = db
    .query("SELECT * FROM code_import_edge WHERE to_path = ? ORDER BY from_path ASC")
    .all(normPath) as CodeImportEdgeRow[]

  return {
    path: fileRow.path,
    blob_sha: fileRow.blob_sha,
    loc: fileRow.loc,
    raw_tokens: fileRow.raw_tokens,
    skeleton_tokens: fileRow.skeleton_tokens,
    reduction_ratio: fileRow.raw_tokens > 0 ? 1 - fileRow.skeleton_tokens / fileRow.raw_tokens : 0,
    pagerank: fileRow.pagerank,
    updated_at: fileRow.updated_at,
    skeleton_text: fileRow.skeleton_text,
    symbols: symbolRows.map((s) => {
      const qName =
        s.qualified_name && s.qualified_name.length > 0
          ? s.qualified_name
          : s.parent_symbol
            ? `${s.parent_symbol}.${s.name}`
            : s.name
      return {
        path: s.path,
        name: s.name,
        qualified_name: qName,
        kind: s.kind,
        depth: (s.depth === 2 ? 2 : 1) as 1 | 2,
        parent_symbol: s.parent_symbol,
        start_line: s.start_line,
        end_line: s.end_line,
        signature: s.signature,
        exported: Boolean(s.exported),
      }
    }),
    imports: outEdgeRows.map((e) => {
      const parsed = JSON.parse(e.symbols_json || e.specifiers_json || "[]") as string[]
      return {
        to_path: e.to_path,
        specifier: e.specifier ?? "",
        specifiers: parsed,
        symbols: parsed,
        is_type_only: Boolean(e.is_type_only),
      }
    }),
    imported_by: inEdgeRows.map((e) => {
      const parsed = JSON.parse(e.symbols_json || e.specifiers_json || "[]") as string[]
      return {
        from_path: e.from_path,
        specifier: e.specifier ?? "",
        specifiers: parsed,
        symbols: parsed,
        is_type_only: Boolean(e.is_type_only),
      }
    }),
  }
}

export const queryAstSkeleton = readAstSkeleton

export function readSymbolSlice(
  first: string | Database,
  second: Database | string,
  filePath: string,
  symbolOrLineRange:
    | string
    | { readonly startLine: number; readonly endLine: number }
    | { readonly start_line: number; readonly end_line: number },
): SymbolSliceView | null {
  const { db, rootDir } = resolveDbAndRootDir(first, second)
  ensureCodeGraphSchema(db)

  const normPath = normalizeRelPath(filePath)
  const absPath = path.join(rootDir, normPath)
  if (!existsSync(absPath)) return null

  const sourceText = readFileSync(absPath, "utf8")
  const lines = sourceText.split("\n")
  const rawFileTokens = estimateTokens(sourceText)

  let startLine: number
  let endLine: number
  let symbolName: string | null = null
  let kind: SymbolKind | null = null
  let depth: number | null = null
  let parentSymbol: string | null = null

  if (typeof symbolOrLineRange === "object") {
    const rawStart =
      "startLine" in symbolOrLineRange ? symbolOrLineRange.startLine : symbolOrLineRange.start_line
    const rawEnd = "endLine" in symbolOrLineRange ? symbolOrLineRange.endLine : symbolOrLineRange.end_line
    startLine = Math.max(1, rawStart)
    endLine = Math.min(lines.length, rawEnd)
  } else {
    const rangeMatch = /^\[?L?(\d+)\s*(?:-|\.\.)\s*L?(\d+)\]?$/i.exec(symbolOrLineRange.trim())
    if (rangeMatch) {
      startLine = Math.max(1, Number(rangeMatch[1]))
      endLine = Math.min(lines.length, Number(rangeMatch[2]))
    } else {
      const query = symbolOrLineRange.trim()
      let row = db
        .query("SELECT * FROM code_symbol WHERE path = ? AND qualified_name = ? ORDER BY start_line ASC LIMIT 1")
        .get(normPath, query) as CodeSymbolRow | null

      if (!row && query.includes(".")) {
        const [parent, child] = query.split(".", 2)
        row = db
          .query(
            "SELECT * FROM code_symbol WHERE path = ? AND parent_symbol = ? AND name = ? ORDER BY start_line ASC LIMIT 1",
          )
          .get(normPath, parent!, child!) as CodeSymbolRow | null
      }
      if (!row) {
        row = db
          .query(
            "SELECT * FROM code_symbol WHERE path = ? AND name = ? ORDER BY depth ASC, start_line ASC LIMIT 1",
          )
          .get(normPath, query) as CodeSymbolRow | null
      }
      if (!row) {
        const fallbackSkel = skeletonizeSource(normPath, sourceText, { rootDir })
        const matched =
          fallbackSkel.symbols.find((s) => s.qualified_name === query) ??
          fallbackSkel.symbols.find((s) => s.name === query)
        if (!matched) return null
        startLine = matched.start_line
        endLine = matched.end_line
        symbolName = matched.qualified_name
        kind = matched.kind
        depth = matched.depth
        parentSymbol = matched.parent_symbol
      } else {
        startLine = row.start_line
        endLine = row.end_line
        symbolName =
          row.qualified_name && row.qualified_name.length > 0
            ? row.qualified_name
            : row.parent_symbol
              ? `${row.parent_symbol}.${row.name}`
              : row.name
        kind = row.kind
        depth = row.depth
        parentSymbol = row.parent_symbol
      }
    }
  }

  if (startLine > endLine || startLine > lines.length) return null
  const clampedEnd = Math.min(lines.length, endLine)
  const numberedLines: string[] = []
  for (let L = startLine; L <= clampedEnd; L++) {
    numberedLines.push(`L${L}: ${lines[L - 1] ?? ""}`)
  }
  const metaParts: string[] = []
  if (symbolName) metaParts.push(symbolName)
  if (kind) metaParts.push(`kind=${kind}`)
  if (depth !== null) metaParts.push(`depth=${depth}`)
  const label = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : ""
  const header = `// ${normPath} [L${startLine}-L${clampedEnd}]${label}`
  const sliceText = `${header}\n${numberedLines.join("\n")}`

  return {
    path: normPath,
    symbol: symbolName,
    qualified_name: symbolName,
    kind,
    depth,
    parent_symbol: parentSymbol,
    start_line: startLine,
    end_line: clampedEnd,
    line_count: clampedEnd - startLine + 1,
    slice_tokens: estimateTokens(sliceText),
    raw_file_tokens: rawFileTokens,
    header,
    slice_text: sliceText,
  }
}

export interface JitReadSkeletonMeta {
  readonly startLine: number
  readonly endLine: number
  readonly totalLines: number | null
  readonly isTruncated: boolean
}

export function indexSingleFileSkeleton(
  first: string | Database,
  second: Database | string,
  filePath: string,
): AstSkeletonView | null {
  const { db, rootDir } = resolveDbAndRootDir(first, second)
  ensureCodeGraphSchema(db)

  const normPath = normalizeRepoPath(filePath, rootDir)
  const absPath = resolveDiskPath(filePath, rootDir)
  if (!existsSync(absPath)) {
    return readAstSkeleton(db, normPath)
  }

  let content: string
  try {
    const st = statSync(absPath)
    if (!st.isFile()) return readAstSkeleton(db, normPath)
    content = readFileSync(absPath, "utf8")
  } catch {
    return readAstSkeleton(db, normPath)
  }

  const blobSha = computeBlobSha(content)
  const existing = db
    .query("SELECT blob_sha FROM code_file WHERE path = ?")
    .get(normPath) as { blob_sha: string } | null
  if (existing && existing.blob_sha === blobSha) {
    return readAstSkeleton(db, normPath)
  }

  const skeleton = skeletonizeSource(normPath, content, { rootDir })
  const now = Date.now()

  const upsertTx = db.transaction(() => {
    db.query(`
      INSERT INTO code_file (path, blob_sha, loc, raw_tokens, skeleton_tokens, skeleton_text, pagerank, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT pagerank FROM code_file WHERE path = ?), 0), ?)
      ON CONFLICT(path) DO UPDATE SET
        blob_sha = excluded.blob_sha,
        loc = excluded.loc,
        raw_tokens = excluded.raw_tokens,
        skeleton_tokens = excluded.skeleton_tokens,
        skeleton_text = excluded.skeleton_text,
        updated_at = excluded.updated_at
    `).run(
      normPath,
      blobSha,
      skeleton.loc,
      skeleton.rawTokens,
      skeleton.skeletonTokens,
      skeleton.skeletonText,
      normPath,
      now,
    )

    db.query("DELETE FROM code_symbol WHERE path = ?").run(normPath)
    const insertSym = db.query(`
      INSERT OR REPLACE INTO code_symbol (
        path, name, qualified_name, kind, depth, parent_symbol,
        start_line, end_line, signature, exported, blob_sha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const sym of skeleton.symbols) {
      insertSym.run(
        sym.path,
        sym.name,
        sym.qualified_name,
        sym.kind,
        sym.depth,
        sym.parent_symbol,
        sym.start_line,
        sym.end_line,
        sym.signature,
        sym.exported ? 1 : 0,
        blobSha,
      )
    }

    db.query("DELETE FROM code_import_edge WHERE from_path = ?").run(normPath)
    const insertEdge = db.query(`
      INSERT OR REPLACE INTO code_import_edge (
        from_path, to_path, specifier, symbols_json, specifiers_json, is_type_only
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const edgesByTarget = new Map<
      string,
      { specifier: string; names: Set<string>; typeOnly: boolean }
    >()
    for (const imp of skeleton.imports) {
      if (!imp.resolvedPath) continue
      let entry = edgesByTarget.get(imp.resolvedPath)
      if (!entry) {
        entry = { specifier: imp.specifier, names: new Set(), typeOnly: imp.typeOnly }
        edgesByTarget.set(imp.resolvedPath, entry)
      } else if (!imp.typeOnly) {
        entry.typeOnly = false
      }
      for (const n of imp.names) entry.names.add(n)
    }
    for (const [toPath, info] of edgesByTarget.entries()) {
      const json = JSON.stringify([...info.names].sort())
      insertEdge.run(normPath, toPath, info.specifier, json, json, info.typeOnly ? 1 : 0)
    }
  })
  upsertTx()

  return readAstSkeleton(db, normPath)
}

export function buildJitReadSkeletonFooter(
  first: string | Database,
  second: Database | string,
  filePath: string,
  readMeta: JitReadSkeletonMeta,
): string | null {
  const isPartial =
    readMeta.isTruncated ||
    readMeta.startLine > 1 ||
    (readMeta.totalLines !== null && readMeta.endLine < readMeta.totalLines)
  if (!isPartial) return null

  const { db, rootDir } = resolveDbAndRootDir(first, second)
  const skel = indexSingleFileSkeleton(db, rootDir, filePath)
  if (!skel || skel.symbols.length === 0) return null

  const unread = skel.symbols.filter(
    (s) =>
      (s.depth === 1 || s.exported) &&
      (s.start_line < readMeta.startLine || s.end_line > readMeta.endLine),
  )
  if (unread.length === 0) return null

  const totalLoc = readMeta.totalLines ?? skel.loc
  const headerLine = `\n\n${JIT_SKELETON_MARKER} ${skel.path} (shown L${readMeta.startLine}-L${readMeta.endLine} of ${totalLoc}; ${unread.length} unread symbols):`
  const hintLine = `Hint: Use substrate.viewport({ action: "slice", path: "${skel.path}", symbol: "<symbol>" }) or read with offset/limit.`

  const maxChars = 148 * 4 // strictly < 150 tokens
  const fixedChars = headerLine.length + 1 + hintLine.length
  const bulletLines: string[] = []
  let usedChars = fixedChars

  for (let i = 0; i < unread.length; i++) {
    const s = unread[i]!
    const item = `- [L${s.start_line}-L${s.end_line}] ${s.qualified_name} (${s.kind})`
    const remaining = unread.length - (i + 1)
    const moreLine = remaining > 0 ? `- ... (+${remaining} more unread symbols)` : ""
    const projected = usedChars + 1 + item.length + (moreLine ? 1 + moreLine.length : 0)
    if (projected > maxChars) {
      const restCount = unread.length - i
      const restLine = `- ... (+${restCount} more unread symbols)`
      if (usedChars + 1 + restLine.length <= maxChars) {
        bulletLines.push(restLine)
      }
      break
    }
    bulletLines.push(item)
    usedChars += 1 + item.length
  }

  return [headerLine, ...bulletLines, hintLine].join("\n")
}

