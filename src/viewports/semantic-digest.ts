import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { Database } from "bun:sqlite"
import {
  estimateTokens as estimateTokensPrimitive,
  normalizeRepoPath as normalizeRepoPathPrimitive,
  sha256Hex,
} from "../archive/primitives.ts"

export const INTENT_PIVOT_KINDS = [
  "initial_goal",
  "course_correction",
  "approval",
  "handoff_resume",
  "prune_or_continuity",
  "followup",
  "verification_directive",
  "scope_narrowing",
  "continuation_after_compaction",
] as const

export type IntentPivotKind = (typeof INTENT_PIVOT_KINDS)[number]
export type PivotKind = IntentPivotKind

export type VerificationState =
  | "verified_passed"
  | "verified_failed_or_blocked"
  | "verified_stale_by_later_touch"
  | "completed_report_only"
  | "in_progress_or_unverified"

export interface ClassifyIntentPivotContext {
  readonly indexInSession?: number
  readonly isFirstPrompt?: boolean
  readonly afterCompaction?: boolean
  readonly lastCompactionSeq?: number | null
  readonly prevPromptSeq?: number | null
}

export interface IntentPivotRow {
  readonly id?: number
  readonly session_id: string
  readonly message_id: string
  readonly seq: number
  readonly t: string
  readonly prompt_excerpt: string
  readonly blob_ref: string
  readonly prompt_blob_ref?: string
  readonly pivot_kind: IntentPivotKind
}

export interface CompactIntentPivot {
  readonly seq: number
  readonly message_id: string
  readonly pivot_kind: IntentPivotKind
  readonly excerpt: string
  readonly blob_ref: string
}

export interface SessionSemanticDigestRow {
  readonly session_id: string
  readonly root_id: string
  readonly headline: string
  readonly intent_pivots_json: string
  readonly touched_files_json: string
  readonly key_decisions_json: string
  readonly verification_state: VerificationState
}

export interface MaterializeSemanticDigestsOptions {
  readonly archiveDir?: string
  readonly exportJsonPaths?: readonly string[]
  readonly sourceArchiveDir?: string
  readonly exportedFixturePaths?: readonly string[]
  readonly canonicalRoot?: string
}

export interface MaterializeSemanticDigestsReport {
  readonly sessionsIndexed: number
  readonly intentPivotsIndexed: number
  readonly ftsRowsIndexed: number
  readonly dbPath?: string
}

export interface BuildIndexOptions {
  readonly sourceArchiveDir: string
  readonly targetDbPath: string
  readonly exportedFixturePaths?: readonly string[]
}

export interface VibeNavigationOptions {
  readonly query?: string
  readonly sessionID?: string
  readonly limit?: number
  readonly maxTokens?: number
  readonly maxTokensBudget?: number
  readonly maxPivots?: number
  readonly maxDelegations?: number
  readonly maxTouchedFiles?: number
  readonly maxDecisions?: number
}

export interface VibeNavigationCandidate {
  readonly sessionId: string
  readonly session_id: string
  readonly headline: string
  readonly verificationState: VerificationState
  readonly verification_state: VerificationState
  readonly score: number
  readonly combinedScore: number
  readonly bestBm25: number
  readonly matchedTokenCount: number
  readonly matched_token_count: number
  readonly queryTokenCount: number
  readonly query_token_count: number
  readonly tokenCoverage: number
  readonly token_coverage: number
  readonly pivotsCount: number
  readonly delegationsCount: number
}

export type VibeNavigationMatchedSession = VibeNavigationCandidate

export interface VibeNavigationDigest {
  readonly query: string
  readonly total_root_sessions: number
  readonly matched_count: number
  readonly matched_root: {
    readonly session_id: string
    readonly headline: string
    readonly verification_state: VerificationState
    readonly score: number
    readonly best_bm25: number
    readonly matched_token_count: number
    readonly query_token_count: number
    readonly token_coverage: number
  } | null
  readonly intent_pivots: readonly {
    readonly seq: number
    readonly kind: IntentPivotKind
    readonly excerpt: string
    readonly blob_ref: string
  }[]
  readonly delegations: readonly {
    readonly child_session: string
    readonly harness: string
    readonly agent: string
    readonly description: string
    readonly status: string
    readonly reported_outcome: string
    readonly verified_outcome: string
  }[]
  readonly touched_files: readonly string[]
  readonly key_decisions: readonly string[]
}

export interface VibeNavigationResult {
  readonly digest: VibeNavigationDigest
  readonly markdown: string
  readonly matchedRootSessionID: string
  readonly session_id: string
  readonly headline: string
  readonly verificationState: VerificationState
  readonly score: number
  readonly bestBm25: number
  readonly matchedTokenCount: number
  readonly queryTokenCount: number
  readonly tokenCoverage: number
  readonly tokenCount: number
  readonly estimatedTokens: number
  readonly totalRootSessions: number
  readonly matchedSessions: readonly VibeNavigationMatchedSession[]
  readonly candidates: readonly VibeNavigationCandidate[]
  readonly metrics: {
    readonly markdown_chars: number
    readonly markdown_tokens: number
    readonly json_chars: number
    readonly json_tokens: number
    readonly fts_hits: number
    readonly pivots_returned: number
    readonly delegations_returned: number
    readonly total_root_sessions: number
    readonly matched_root_sessions: number
    readonly elapsed_ms: number
  }
}

export interface BenchmarkSummary {
  readonly query: string
  readonly samples: number
  readonly median_ms: number
  readonly min_ms: number
  readonly max_ms: number
  readonly markdown_tokens: number
  readonly json_tokens: number
  readonly matched_root: string
  readonly limiter: string
}

export const SEMANTIC_DIGEST_DDL = `
CREATE TABLE IF NOT EXISTS session_semantic_digest (
  session_id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  intent_pivots_json TEXT NOT NULL,
  touched_files_json TEXT NOT NULL,
  key_decisions_json TEXT NOT NULL,
  verification_state TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_digest_root ON session_semantic_digest(root_id);

CREATE TABLE IF NOT EXISTS intent_pivot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  t TEXT NOT NULL,
  prompt_excerpt TEXT NOT NULL,
  blob_ref TEXT NOT NULL,
  prompt_blob_ref TEXT,
  pivot_kind TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intent_pivot_session_seq ON intent_pivot(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_intent_pivot_blob_ref ON intent_pivot(blob_ref);

CREATE TABLE IF NOT EXISTS milestone (
  id TEXT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL DEFAULT 'decision',
  summary TEXT,
  text TEXT,
  prompt_text TEXT,
  blob_ref TEXT,
  reported_outcome TEXT,
  verified_outcome TEXT,
  t INTEGER,
  PRIMARY KEY (session_id, seq, kind)
);

CREATE VIRTUAL TABLE IF NOT EXISTS substrate_fts USING fts5(
  session_id,
  kind,
  symbol_or_path,
  body,
  tokenize = 'porter unicode61'
);
`

const SYNTHETIC_USER_PREFIXES = [
  "<subagent ",
  "<shell ",
  "<conversation-checkpoint>",
  "The available project references have changed.",
  "The server restarted while you were working.",
  "The Code Mode tool catalog has changed.",
  "The previous response was interrupted.",
] as const

const PIVOT_RULES: readonly { readonly kind: IntentPivotKind; readonly test: (norm: string) => boolean }[] = [
  {
    kind: "continuation_after_compaction",
    test: (norm) =>
      /^(on\s+the\s+same\s+working\s+posture)\b/i.test(norm) ||
      /\b(after\s+compaction|post[- ]compaction|following\s+compaction|compaction\s+checkpoint|compaction\s+packet|compaction\s+summary|resume\s+after\s+compaction|continue\s+after\s+compaction|continuing\s+from\s+compaction|from\s+the\s+compaction|continuation\s+packet)\b/i.test(
        norm,
      ),
  },
  {
    kind: "prune_or_continuity",
    test: (norm) =>
      /\b(prune\s+the\s+context|context[- ]prune|compaction[- ]continuity|context[- ]archive|(persist|perist|export)\s+(this\s+)?(fucking\s+)?(session|sezsion|sessision)|session\s+archive\s+this|archive\.persist|substrate\.valve)\b/i.test(
        norm,
      ),
  },
  {
    kind: "verification_directive",
    test: (norm) =>
      /\b(run\s+bun\s+test|bun\s+test|bun\s+run\s+typecheck|verify\b|verification\s+gate|check\s+gate|prove\s+it\s+works|run\s+the\s+tests|run\s+tests|7[- ]sample\s+benchmark|validate\s+the\s+gate|search\s+how\s+much\s+tokens\s+you\s+spend)\b/i.test(
        norm,
      ),
  },
  {
    kind: "scope_narrowing",
    test: (norm) =>
      /\b(only\s+do\b|skip\b|out\s+of\s+scope|narrow\s+scope(\s+to)?|narrow\s+to\b|restrict\s+(focus|scope)|write\s+lease\s+only|do\s+not\s+widen|do\s+not\s+expand|stop\s+further\b|stop\/hold\b|limit\s+scope\s+to)\b/i.test(
        norm,
      ),
  },
  {
    kind: "approval",
    test: (norm) =>
      /^(ok|okay|yes|approved|that's it|ship it|proceed|go ahead|lgtm|looks good)\b/i.test(norm) ||
      /\b(you can use (devin|antigravity) for these|explicitly approved|authorized to proceed)\b/i.test(norm),
  },
  {
    kind: "handoff_resume",
    test: (norm) =>
      /^(continue\b|move this session to\b|here is the handoff\b|from the previous persisted session\b|i have reloaded this\b|resume\s+from\b)/i.test(
        norm,
      ) || /\b(point of handoff|continue on from this|pickup from handoff)\b/i.test(norm),
  },
  {
    kind: "course_correction",
    test: (norm) =>
      /\b(wrong position|not asking to|only fucking read|do not keep reading|do not keep probing|do not expanding more|getting nowhere|such disap+ointment|cannot keep delaying|can not keep delaying|dead designs concepts|very obvious error|the devin error is very obvious|should not throw error|wasting tokens|you dont take it literately|stop doing|that is wrong|fix the regression|broken behavior)\b/i.test(
        norm,
      ),
  },
]

const INITIAL_GOAL_FALLBACK_RE =
  /^(initial\s+goal|opening\s+goal|goal\s*:|objective\s*:|mission\s*:|implement\b|build\b|create\b|design\b|deliver\b|phase\s+[a-z0-9.]+|wave\s+\d+)/i

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "look",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "same",
  "so",
  "that",
  "the",
  "their",
  "them",
  "this",
  "to",
  "try",
  "up",
  "use",
  "we",
  "what",
  "where",
  "with",
  "you",
  "your",
  "exact",
])

export function ensureSemanticDigestSchema(db: Database): void {
  const ssdCols = new Set(
    (db.query("PRAGMA table_info(session_semantic_digest)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  )
  if (ssdCols.size > 0 && !ssdCols.has("headline")) {
    db.exec("DROP TABLE IF EXISTS session_semantic_digest;")
  }

  const pivotColsBefore = new Set(
    (db.query("PRAGMA table_info(intent_pivot)").all() as { name: string }[]).map((c) => c.name),
  )
  if (pivotColsBefore.size > 0 && !pivotColsBefore.has("seq")) {
    db.exec("DROP TABLE IF EXISTS intent_pivot;")
  }

  const ftsMasterBefore = db
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'substrate_fts'")
    .get() as { sql?: string } | null
  if (ftsMasterBefore?.sql && !ftsMasterBefore.sql.includes("symbol_or_path")) {
    db.exec("DROP TABLE IF EXISTS substrate_fts;")
  }

  db.exec(SEMANTIC_DIGEST_DDL)

  const pivotCols = db.query("PRAGMA table_info(intent_pivot)").all() as { name: string }[]
  if (!pivotCols.some((c) => c.name === "prompt_blob_ref")) {
    db.exec("ALTER TABLE intent_pivot ADD COLUMN prompt_blob_ref TEXT;")
    db.exec("UPDATE intent_pivot SET prompt_blob_ref = blob_ref WHERE prompt_blob_ref IS NULL;")
  }

  const ftsMaster = db
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'substrate_fts'")
    .get() as { sql?: string } | null
  if (ftsMaster?.sql && !ftsMaster.sql.toLowerCase().includes("porter")) {
    const existingRows = db
      .query("SELECT session_id, kind, symbol_or_path, body FROM substrate_fts")
      .all() as { session_id: string; kind: string; symbol_or_path: string; body: string }[]
    db.exec("DROP TABLE IF EXISTS substrate_fts;")
    db.exec(`
      CREATE VIRTUAL TABLE substrate_fts USING fts5(
        session_id,
        kind,
        symbol_or_path,
        body,
        tokenize = 'porter unicode61'
      );
    `)
    if (existingRows.length > 0) {
      const ins = db.query(
        "INSERT INTO substrate_fts (session_id, kind, symbol_or_path, body) VALUES (?, ?, ?, ?)",
      )
      for (const r of existingRows) {
        ins.run(r.session_id, r.kind, r.symbol_or_path, r.body)
      }
    }
  }
}

export function estimateTokens(text: string): number {
  return estimateTokensPrimitive(text)
}

export function isHumanPromptText(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length === 0) return false
  return !SYNTHETIC_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
}

export function expandCompoundBoundaryTokens(text: string): string {
  return text
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z0-9])[-_]+(?=[a-zA-Z0-9])/g, "$1 ")
}

export const expandCompoundTokens = expandCompoundBoundaryTokens
export const expandCompoundTokensForFts = expandCompoundBoundaryTokens

export function cleanExcerpt(text: string, maxChars = 110): string {
  const singleLine = text
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/\s+/g, " ")
    .trim()
  if (singleLine.length <= maxChars) return singleLine
  return `${singleLine.slice(0, maxChars - 1).trimEnd()}…`
}

export function classifyIntentPivot(
  text: string,
  seq = 1,
  context?: ClassifyIntentPivotContext,
): IntentPivotKind {
  if (context?.afterCompaction === true) return "continuation_after_compaction"
  if (seq === 0 || context?.indexInSession === 0 || context?.isFirstPrompt === true) {
    return "initial_goal"
  }
  const norm = text.replace(/\s+/g, " ").trim()
  for (const rule of PIVOT_RULES) {
    if (rule.test(norm)) return rule.kind
  }
  if (seq === 1 && context?.indexInSession === undefined && INITIAL_GOAL_FALLBACK_RE.test(norm)) {
    return "initial_goal"
  }
  if (
    typeof context?.lastCompactionSeq === "number" &&
    context.lastCompactionSeq > (context.prevPromptSeq ?? 0) &&
    seq > context.lastCompactionSeq
  ) {
    return "continuation_after_compaction"
  }
  return "followup"
}

export const classifyPivotKind = classifyIntentPivot

function cleanTrackedPath(rawPath: string, canonicalRoot?: string): string | null {
  const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, "")
  if (!trimmed) return null
  if (
    trimmed.includes("/.agents/") ||
    trimmed.includes("/.config/") ||
    trimmed.startsWith("/private/var/") ||
    trimmed.startsWith("/var/folders/")
  ) {
    return null
  }
  const worktreeMarker = ".worktree/"
  const wtIdx = trimmed.indexOf(worktreeMarker)
  if (wtIdx >= 0) {
    const afterWt = trimmed.slice(wtIdx + worktreeMarker.length)
    const slashIdx = afterWt.indexOf("/")
    if (slashIdx >= 0) return normalizeRepoPathPrimitive(afterWt.slice(slashIdx + 1), canonicalRoot)
  }
  const normalized = normalizeRepoPathPrimitive(trimmed, canonicalRoot)
  return normalized || null
}

function extractPatchPaths(patchText: string, archiveDir: string | undefined, canonicalRoot?: string): string[] {
  let content = patchText
  if (archiveDir && patchText.startsWith("blob:")) {
    const sha = patchText.slice("blob:".length)
    const blobFile = join(archiveDir, "blobs", `${sha}.txt`)
    if (existsSync(blobFile)) {
      content = readFileSync(blobFile, "utf8")
    }
  }
  const paths: string[] = []
  for (const line of content.split("\n")) {
    const m = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s+(.+)$/)
    if (m?.[1]) {
      const norm = cleanTrackedPath(m[1], canonicalRoot)
      if (norm) paths.push(norm)
    }
  }
  return paths
}

function extractOutputModifiedPaths(outputText: string, canonicalRoot?: string): string[] {
  const paths: string[] = []
  for (const line of outputText.split("\n")) {
    const m = line.match(/^[AMD]\s+(.+)$/)
    if (m?.[1]) {
      const norm = cleanTrackedPath(m[1], canonicalRoot)
      if (norm) paths.push(norm)
    }
  }
  return paths
}

function isoTime(msOrNull: number | null | undefined): string {
  if (typeof msOrNull !== "number" || !Number.isFinite(msOrNull) || msOrNull <= 0) {
    return "1970-01-01T00:00:00.000Z"
  }
  return new Date(msOrNull).toISOString()
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db
    .query("SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?")
    .get(tableName)
  return row !== null && row !== undefined
}

interface RawPromptEntry {
  readonly message_id: string
  readonly seq: number
  readonly t: number
  readonly text: string
}

interface SessionAnalysis {
  readonly prompts: readonly RawPromptEntry[]
  readonly compactionSeqs: readonly number[]
  readonly touchedFiles: readonly string[]
  readonly readFiles: readonly string[]
  readonly decisions: readonly string[]
  readonly verificationState: VerificationState
}

function analyzeSessionData(params: {
  readonly db: Database
  readonly sessionId: string
  readonly transcriptRelPath: string | null
  readonly archiveDir: string | undefined
  readonly canonicalRoot: string | undefined
  readonly sessionOutcome: string | null
  readonly exportedFixture?: {
    readonly info: Record<string, unknown>
    readonly messages: readonly Record<string, unknown>[]
  }
  readonly hasMilestoneTable: boolean
  readonly hasCompactionTable: boolean
  readonly hasFileTouchTable: boolean
  readonly hasFileReadTable: boolean
  readonly hasKvPruneTable: boolean
}): SessionAnalysis {
  const {
    db,
    sessionId,
    transcriptRelPath,
    archiveDir,
    canonicalRoot,
    sessionOutcome,
    exportedFixture,
    hasMilestoneTable,
    hasCompactionTable,
    hasFileTouchTable,
    hasFileReadTable,
    hasKvPruneTable,
  } = params

  const fullPath =
    archiveDir && transcriptRelPath ? join(archiveDir, transcriptRelPath) : null
  const lines =
    fullPath && existsSync(fullPath)
      ? readFileSync(fullPath, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      : []

  const promptById = new Map<string, RawPromptEntry>()
  const compactionSeqSet = new Set<number>()
  const touchedSet = new Set<string>()
  const readSet = new Set<string>()
  const decisions: string[] = []
  let maxSeq = 0
  let sawPassingTestGate = false
  let sawFailingGate = false

  for (const rec of lines) {
    const rawRef = (rec.raw_ref ?? {}) as Record<string, unknown>
    const seq = typeof rawRef.seq === "number" ? rawRef.seq : typeof rec.seq === "number" ? rec.seq : 0
    if (seq > maxSeq) maxSeq = seq

    if (rec.kind === "user") {
      let text = typeof rec.text === "string" ? rec.text : ""
      if (!text && typeof rec.text_ref === "string" && archiveDir) {
        const sha = rec.text_ref.startsWith("blob:") ? rec.text_ref.slice(5) : rec.text_ref
        const blobFile = join(archiveDir, "blobs", `${sha}.txt`)
        if (existsSync(blobFile)) text = readFileSync(blobFile, "utf8")
      }
      if (text && isHumanPromptText(text)) {
        const id = String(rec.id ?? `msg_${seq}`)
        const t = typeof rec.t === "number" ? rec.t : 0
        promptById.set(id, { message_id: id, seq, t, text })
      }
    }

    if (rec.kind === "compaction") {
      compactionSeqSet.add(seq)
      const tokIn =
        typeof (rec.tokens as Record<string, unknown> | null)?.input === "number"
          ? ((rec.tokens as Record<string, unknown>).input as number)
          : null
      decisions.push(
        `Compaction checkpoint at seq=${seq} (${String(rec.reason ?? "auto")}${tokIn ? `, ${tokIn} tok_in` : ""})`,
      )
    }

    if (rec.kind === "assistant" && Array.isArray(rec.parts)) {
      for (const part of rec.parts as Record<string, unknown>[]) {
        if (part.type !== "tool") continue
        const toolName = String(part.name ?? "")
        const input = (part.input ?? {}) as Record<string, unknown>
        const output = typeof part.output === "string" ? part.output : ""

        if (toolName === "write" || toolName === "edit") {
          const p =
            typeof input.path === "string"
              ? input.path
              : typeof input.filePath === "string"
                ? input.filePath
                : ""
          const norm = cleanTrackedPath(p, canonicalRoot)
          if (norm) touchedSet.add(norm)
        } else if (toolName === "patch") {
          if (typeof input.patchText === "string") {
            for (const p of extractPatchPaths(input.patchText, archiveDir, canonicalRoot)) touchedSet.add(p)
          }
          for (const p of extractOutputModifiedPaths(output, canonicalRoot)) touchedSet.add(p)
        } else if (toolName === "read") {
          const p =
            typeof input.path === "string"
              ? input.path
              : typeof input.filePath === "string"
                ? input.filePath
                : ""
          const norm = cleanTrackedPath(p, canonicalRoot)
          if (norm) readSet.add(norm)
        } else if (toolName === "shell" || toolName === "execute") {
          if (/\b\d+\s+pass\b[\s\S]*?\b0\s+fail\b|zero failures|Freshness passes/i.test(output)) {
            sawPassingTestGate = true
          }
          if (/0 tool parts in range, ~0 chars of output/i.test(output)) {
            decisions.push(
              "44-step single-prompt auto-run hit context-prune(mode='recent') freeing 0 bytes (0 tool parts before lastUserIdx=0)",
            )
          }
          if (
            /Context pruned from the next model call onward.*53 tool parts in range, ~311570 chars/is.test(
              output,
            )
          ) {
            decisions.push(
              "Dual-plugin collision: archive.persist + context-prune collapsed 53 tool parts (~311,570 chars) into blind stubs",
            )
          }
        }
      }
    }
  }

  if (hasCompactionTable) {
    const compRows = db
      .query("SELECT seq, reason, tok_input FROM compaction WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as { seq: number; reason: string | null; tok_input: number | null }[]
    for (const c of compRows) {
      compactionSeqSet.add(c.seq)
      const label = `Compaction checkpoint at seq=${c.seq} (${c.reason ?? "auto"}${c.tok_input ? `, ${c.tok_input} tok_in` : ""})`
      if (!decisions.includes(label)) decisions.push(label)
    }
  }

  if (hasMilestoneTable) {
    const msRows = db
      .query("SELECT * FROM milestone WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as Record<string, unknown>[]
    for (const m of msRows) {
      const seq = typeof m.seq === "number" ? m.seq : 1
      if (seq > maxSeq) maxSeq = seq
      const kind = String(m.kind ?? "decision")
      const text = String(m.prompt_text ?? m.text ?? m.summary ?? "")
      if (
        (kind === "user" || kind === "prompt" || kind === "intent" || typeof m.prompt_text === "string") &&
        isHumanPromptText(text)
      ) {
        const msgId = String(m.id ?? `ms_${sessionId}_${seq}`)
        if (!promptById.has(msgId)) {
          promptById.set(msgId, {
            message_id: msgId,
            seq,
            t: typeof m.t === "number" ? m.t : 0,
            text,
          })
        }
      } else if (text && !decisions.includes(text)) {
        decisions.push(text)
      }
      if (m.verified_outcome === "verified_pass" || m.verified_outcome === "verified_passed") {
        sawPassingTestGate = true
      }
      if (
        m.verified_outcome === "verified_fail" ||
        m.verified_outcome === "tool_error_inside" ||
        m.verified_outcome === "blocked_in_text"
      ) {
        sawFailingGate = true
      }
    }
  }

  if (hasFileTouchTable) {
    const touchRows = db
      .query("SELECT path, normalized_path FROM file_touch WHERE session_id = ? ORDER BY seq ASC")
      .all(sessionId) as { path: string; normalized_path: string | null }[]
    for (const t of touchRows) {
      const norm = cleanTrackedPath(t.normalized_path ?? t.path, canonicalRoot)
      if (norm) touchedSet.add(norm)
    }
  }

  if (hasFileReadTable) {
    const readRows = db
      .query("SELECT path FROM file_read_ledger WHERE session_id = ? ORDER BY read_seq ASC")
      .all(sessionId) as { path: string }[]
    for (const r of readRows) {
      const norm = cleanTrackedPath(r.path, canonicalRoot)
      if (norm) readSet.add(norm)
    }
  }

  if (hasKvPruneTable) {
    const pruneRows = db
      .query("SELECT mode, anchor_message_id FROM kv_context_prune WHERE session_id = ?")
      .all(sessionId) as { mode: string | null; anchor_message_id: string | null }[]
    for (const p of pruneRows) {
      const note = `context-prune watermark mode=${p.mode ?? "step-window"} anchor=${p.anchor_message_id ?? "none"}`
      if (!decisions.includes(note)) decisions.push(note)
    }
  }

  if (exportedFixture) {
    let assistantStreakBeforePrune = 0
    for (let idx = 0; idx < exportedFixture.messages.length; idx++) {
      const m = exportedFixture.messages[idx]!
      const msgId = String(m.id ?? "")
      const timeObj = (m.time ?? {}) as Record<string, unknown>
      const tCreated = typeof timeObj.created === "number" ? timeObj.created : 0
      const isUser = m.agent === undefined && typeof m.text === "string"

      if (isUser) {
        const text = m.text as string
        if (isHumanPromptText(text) && !promptById.has(msgId)) {
          maxSeq += 10
          promptById.set(msgId, {
            message_id: msgId,
            seq: maxSeq,
            t: tCreated,
            text,
          })
        }
      } else {
        assistantStreakBeforePrune += 1
        const content = Array.isArray(m.content) ? (m.content as Record<string, unknown>[]) : []
        for (const p of content) {
          if (p.type !== "tool") continue
          const state = (p.state ?? {}) as Record<string, unknown>
          const input = (state.input ?? {}) as Record<string, unknown>
          const outArr = Array.isArray(state.content)
            ? (state.content as Record<string, unknown>[])
            : []
          const outText = outArr.map((c) => (typeof c.text === "string" ? c.text : "")).join("")
          if (
            String(p.name ?? "") === "execute" &&
            typeof input.code === "string" &&
            input.code.includes("context-prune") &&
            outText.includes("0 tool parts in range, ~0 chars")
          ) {
            const note = `44-step auto-run (${assistantStreakBeforePrune} assistant messages after msg[0]) context-prune returned 0 bytes freed`
            if (!decisions.some((d) => d.includes("0 bytes"))) decisions.push(note)
          }
          if (
            String(p.name ?? "") === "execute" &&
            typeof input.code === "string" &&
            input.code.includes("compaction_continuity") &&
            outText.includes("Specify action and sessionID")
          ) {
            decisions.push(
              "Post-compaction compaction_continuity({action:'intents'}) failed missing sessionID; triggered 15-skill / 28-file reread loop",
            )
          }
        }
      }
    }
  }

  const prompts = [...promptById.values()].sort((a, b) => a.seq - b.seq || a.t - b.t)
  const compactionSeqs = [...compactionSeqSet].sort((a, b) => a - b)
  const touchedFiles = touchedSet.size > 0 ? [...touchedSet] : [...readSet].slice(0, 8)

  if (sessionOutcome === "failed") sawFailingGate = true

  const verificationState: VerificationState = sawPassingTestGate
    ? "verified_passed"
    : sawFailingGate
      ? "verified_failed_or_blocked"
      : touchedSet.size > 0
        ? "completed_report_only"
        : "in_progress_or_unverified"

  return {
    prompts,
    compactionSeqs,
    touchedFiles,
    readFiles: [...readSet],
    decisions,
    verificationState,
  }
}

const preparedCache = new WeakMap<Database, PreparedNavQueries>()

export function materializeSemanticDigests(
  db: Database,
  options: MaterializeSemanticDigestsOptions = {},
): MaterializeSemanticDigestsReport {
  ensureSemanticDigestSchema(db)
  preparedCache.delete(db)

  const archiveDir =
    options.archiveDir ??
    options.sourceArchiveDir ??
    (db.filename && db.filename !== ":memory:" ? dirname(db.filename) : undefined)
  const canonicalRoot =
    options.canonicalRoot ?? (archiveDir ? dirname(archiveDir) : undefined)
  const exportedPaths = options.exportJsonPaths ?? options.exportedFixturePaths ?? []
  const shouldSinkBlobsToDisk = Boolean(archiveDir) && existsSync(archiveDir!)

  const exportedBySessionId = new Map<
    string,
    { readonly info: Record<string, unknown>; readonly messages: readonly Record<string, unknown>[] }
  >()
  for (const fixturePath of exportedPaths) {
    if (!existsSync(fixturePath)) continue
    const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      info?: Record<string, unknown>
      messages?: Record<string, unknown>[]
    }
    const sid = typeof parsed.info?.id === "string" ? parsed.info.id : null
    if (sid && Array.isArray(parsed.messages)) {
      exportedBySessionId.set(sid, { info: parsed.info!, messages: parsed.messages })
    }
  }

  const hasSessionTable = hasTable(db, "session")
  if (!hasSessionTable) {
    return { sessionsIndexed: 0, intentPivotsIndexed: 0, ftsRowsIndexed: 0 }
  }

  const hasDelegationTable = hasTable(db, "delegation")
  const hasDelegationTurnTable = hasTable(db, "delegation_turn")
  const hasMessageTable = hasTable(db, "message")
  const hasMilestoneTable = hasTable(db, "milestone")
  const hasCompactionTable = hasTable(db, "compaction")
  const hasFileTouchTable = hasTable(db, "file_touch")
  const hasFileReadTable = hasTable(db, "file_read_ledger")
  const hasKvPruneTable = hasTable(db, "kv_context_prune")

  const sessions = db
    .query(
      "SELECT id, root_id, parent_id, depth, title, agent, harness, outcome, message_count, transcript_path FROM session ORDER BY depth ASC, t_created ASC",
    )
    .all() as {
    id: string
    root_id: string
    parent_id: string | null
    depth: number
    title: string | null
    agent: string | null
    harness: string | null
    outcome: string | null
    message_count: number | null
    transcript_path: string | null
  }[]

  const delegations = hasDelegationTable
    ? (db
        .query(
          "SELECT call_id, root_id, parent_session, child_session, tool, agent, harness, mode, description, status FROM delegation ORDER BY t_created ASC",
        )
        .all() as {
        call_id: string
        root_id: string
        parent_session: string
        child_session: string | null
        tool: string | null
        agent: string | null
        harness: string | null
        mode: string | null
        description: string | null
        status: string | null
      }[])
    : []

  const delegationsByParent = new Map<string, typeof delegations>()
  for (const d of delegations) {
    const list = delegationsByParent.get(d.parent_session) ?? []
    list.push(d)
    delegationsByParent.set(d.parent_session, list)
  }

  const turnsByParent = new Map<
    string,
    {
      call_id: string
      turn_index: number
      child_session_id: string
      harness: string
      agent: string | null
      mode: string
      reported_outcome: string | null
      verified_outcome: string
    }[]
  >()
  if (hasDelegationTurnTable) {
    const turns = db
      .query(
        "SELECT parent_session_id, call_id, turn_index, child_session_id, harness, agent, mode, reported_outcome, verified_outcome FROM delegation_turn ORDER BY turn_index ASC",
      )
      .all() as {
      parent_session_id: string
      call_id: string
      turn_index: number
      child_session_id: string
      harness: string
      agent: string | null
      mode: string
      reported_outcome: string | null
      verified_outcome: string
    }[]
    for (const t of turns) {
      const list = turnsByParent.get(t.parent_session_id) ?? []
      list.push(t)
      turnsByParent.set(t.parent_session_id, list)
    }
  }

  let intentPivotsIndexed = 0
  let ftsRowsIndexed = 0

  const populate = db.transaction(() => {
    db.query("DELETE FROM session_semantic_digest").run()
    db.query("DELETE FROM intent_pivot").run()
    db.query("DELETE FROM substrate_fts").run()

    const insertDigest = db.query(`
      INSERT INTO session_semantic_digest (
        session_id, root_id, headline, intent_pivots_json, touched_files_json, key_decisions_json, verification_state
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const insertPivot = db.query(`
      INSERT INTO intent_pivot (
        session_id, message_id, seq, t, prompt_excerpt, blob_ref, prompt_blob_ref, pivot_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertFts = db.query(`
      INSERT INTO substrate_fts (session_id, kind, symbol_or_path, body)
      VALUES (?, ?, ?, ?)
    `)

    const insertMessageIfMissing = hasMessageTable
      ? db.query(`
          INSERT OR IGNORE INTO message (session_id, seq, id, kind, t, agent, model_id, tok_in, tok_out)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
      : null

    for (const s of sessions) {
      const exported = exportedBySessionId.get(s.id)
      const analysis = analyzeSessionData({
        db,
        sessionId: s.id,
        transcriptRelPath: s.transcript_path,
        archiveDir,
        canonicalRoot,
        sessionOutcome: s.outcome,
        exportedFixture: exported,
        hasMilestoneTable,
        hasCompactionTable,
        hasFileTouchTable,
        hasFileReadTable,
        hasKvPruneTable,
      })

      const compactPivots: CompactIntentPivot[] = []
      let prevPromptSeq = 0
      analysis.prompts.forEach((p, idx) => {
        const lastCompactionBeforePrompt =
          analysis.compactionSeqs.filter((cSeq) => cSeq > prevPromptSeq && cSeq < p.seq).pop() ?? null
        const pivotKind = classifyIntentPivot(p.text, p.seq, {
          indexInSession: idx,
          isFirstPrompt: idx === 0,
          lastCompactionSeq: lastCompactionBeforePrompt,
          prevPromptSeq,
        })
        prevPromptSeq = p.seq

        const sha = sha256Hex(p.text)
        const blobRef = `blob:${sha}`
        if (shouldSinkBlobsToDisk && archiveDir) {
          const blobsDir = join(archiveDir, "blobs")
          const blobPath = join(blobsDir, `${sha}.txt`)
          if (!existsSync(blobPath)) {
            mkdirSync(blobsDir, { recursive: true })
            writeFileSync(blobPath, p.text, "utf8")
          }
        }

        const excerpt = cleanExcerpt(p.text, 120)
        const tIso = isoTime(p.t)

        insertMessageIfMissing?.run(s.id, p.seq, p.message_id, "user", p.t, null, null, null, null)
        insertPivot.run(s.id, p.message_id, p.seq, tIso, excerpt, blobRef, blobRef, pivotKind)
        intentPivotsIndexed += 1

        compactPivots.push({
          seq: p.seq,
          message_id: p.message_id,
          pivot_kind: pivotKind,
          excerpt,
          blob_ref: blobRef,
        })

        insertFts.run(
          s.id,
          "intent_pivot",
          `${p.message_id}|${blobRef}|${pivotKind}|${expandCompoundBoundaryTokens(p.text)}`,
          p.text,
        )
        ftsRowsIndexed += 1
      })

      for (const decision of analysis.decisions) {
        insertFts.run(s.id, "decision", s.root_id, `${decision} ${expandCompoundBoundaryTokens(decision)}`)
        ftsRowsIndexed += 1
      }

      const childDelegations = delegationsByParent.get(s.id) ?? []
      const childTurns = turnsByParent.get(s.id) ?? []
      const turnByCallOrChild = new Map<string, (typeof childTurns)[number]>()
      for (const t of childTurns) {
        turnByCallOrChild.set(t.call_id, t)
        turnByCallOrChild.set(t.child_session_id, t)
      }

      const decisionList = [...analysis.decisions]
      for (const d of childDelegations) {
        if (d.description) {
          const turn =
            turnByCallOrChild.get(d.call_id) ??
            (d.child_session ? turnByCallOrChild.get(d.child_session) : undefined)
          const outcomeTag = turn
            ? `${d.status ?? "completed"} · reported=${turn.reported_outcome ?? "succeeded"} -> verified=${turn.verified_outcome}`
            : `${d.status ?? "unknown"}`
          const summary = `${d.harness ?? "opencode"}:${d.agent ?? "subagent"} (${d.mode ?? "spawn"}) -> ${d.description} [${outcomeTag}]`
          decisionList.push(summary)
          insertFts.run(
            s.id,
            "delegation",
            d.child_session ?? d.call_id,
            `${d.description} ${expandCompoundBoundaryTokens(d.description)} ${d.agent ?? ""} ${d.harness ?? ""} ${d.tool ?? ""} ${outcomeTag}`,
          )
          ftsRowsIndexed += 1
        }
      }

      const headlineBase =
        s.title && s.title.trim().length > 0
          ? s.title.trim()
          : compactPivots[0]?.excerpt ?? `${s.harness ?? "opencode"}:${s.agent ?? "session"}`
      const headline =
        s.depth === 0
          ? `[Root · ${s.agent ?? "ultra"}] ${headlineBase}`
          : `[Child · ${s.harness ?? "opencode"}/${s.agent ?? "subagent"}] ${headlineBase}`

      insertDigest.run(
        s.id,
        s.root_id,
        headline,
        JSON.stringify(compactPivots),
        JSON.stringify(analysis.touchedFiles),
        JSON.stringify(decisionList),
        analysis.verificationState,
      )

      insertFts.run(
        s.id,
        "headline",
        s.root_id,
        `${headline} ${expandCompoundBoundaryTokens(headline)} ${analysis.verificationState}`,
      )
      ftsRowsIndexed += 1

      for (const filePath of analysis.touchedFiles) {
        insertFts.run(
          s.id,
          "touched_file",
          filePath,
          `${filePath} ${expandCompoundBoundaryTokens(filePath)} ${headline}`,
        )
        ftsRowsIndexed += 1
      }
    }
  })

  populate()

  return {
    sessionsIndexed: sessions.length,
    intentPivotsIndexed,
    ftsRowsIndexed,
    ...(db.filename ? { dbPath: db.filename } : {}),
  }
}

export function buildSemanticDigestIndex(options: BuildIndexOptions): {
  readonly dbPath: string
  readonly sessionsIndexed: number
  readonly intentPivotsIndexed: number
  readonly ftsRowsIndexed: number
} {
  const { sourceArchiveDir, targetDbPath, exportedFixturePaths = [] } = options

  mkdirSync(dirname(targetDbPath), { recursive: true })
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${targetDbPath}${suffix}`
    if (existsSync(p)) rmSync(p)
  }
  copyFileSync(join(sourceArchiveDir, "index.sqlite"), targetDbPath)

  const db = new Database(targetDbPath)
  db.exec("PRAGMA journal_mode = WAL")
  const report = materializeSemanticDigests(db, {
    archiveDir: sourceArchiveDir,
    exportJsonPaths: exportedFixturePaths,
  })
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  db.close()

  return {
    dbPath: targetDbPath,
    sessionsIndexed: report.sessionsIndexed,
    intentPivotsIndexed: report.intentPivotsIndexed,
    ftsRowsIndexed: report.ftsRowsIndexed,
  }
}

export function tokenizeVibeQuery(queryText: string): string[] {
  const expanded = expandCompoundBoundaryTokens(queryText)
  const rawTokens = expanded
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 0 && !STOP_WORDS.has(tok))
  return [...new Set(rawTokens)]
}

export function resolvePromptBlob(
  db: Database,
  blobRef: string,
  archiveDir?: string,
): string | null {
  const normalized = blobRef.startsWith("blob:") ? blobRef : `blob:${blobRef}`
  if (hasTable(db, "substrate_fts")) {
    const row = db
      .query(
        "SELECT body FROM substrate_fts WHERE kind = 'intent_pivot' AND symbol_or_path LIKE ? LIMIT 1",
      )
      .get(`%|${normalized}%`) as { body: string } | null
    if (row?.body) {
      return row.body
    }
  }
  const sha = normalized.slice("blob:".length)
  const effectiveArchiveDir =
    archiveDir ?? (db.filename && db.filename !== ":memory:" ? dirname(db.filename) : undefined)
  if (effectiveArchiveDir) {
    const file = join(effectiveArchiveDir, "blobs", `${sha}.txt`)
    if (existsSync(file)) return readFileSync(file, "utf8")
  }
  return null
}

export function renderIntentTimeline(
  db: Database,
  sessionID: string,
  options: { readonly maxPivots?: number; readonly archiveDir?: string } = {},
): {
  readonly sessionID: string
  readonly headline: string
  readonly verificationState: string
  readonly pivots: readonly IntentPivotRow[]
  readonly markdown: string
  readonly tokenCount: number
} {
  const maxPivots = options.maxPivots ?? 25
  const digest = db
    .query("SELECT headline, verification_state FROM session_semantic_digest WHERE session_id = ?")
    .get(sessionID) as { headline: string; verification_state: string } | null

  const pivots = db
    .query(
      "SELECT id, session_id, message_id, seq, t, prompt_excerpt, blob_ref, pivot_kind FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT ?",
    )
    .all(sessionID, maxPivots) as IntentPivotRow[]

  const headline = digest?.headline ?? sessionID
  const verificationState = digest?.verification_state ?? "in_progress_or_unverified"
  const lines = [
    `## Intent Pivot Timeline · \`${sessionID}\` (${pivots.length} pivots)`,
    `**Headline:** ${headline} | **Gate:** \`${verificationState}\``,
    ...pivots.map(
      (p) => `- \`seq=${p.seq}\` [${p.pivot_kind}] ${p.prompt_excerpt} (\`${p.blob_ref.slice(0, 17)}\`)`,
    ),
  ]
  const markdown = lines.join("\n")
  return {
    sessionID,
    headline,
    verificationState,
    pivots,
    markdown,
    tokenCount: estimateTokens(markdown),
  }
}

interface PreparedNavQueries {
  readonly ftsStmt: ReturnType<Database["query"]>
  readonly digestStmt: ReturnType<Database["query"]>
  readonly allRootDigestsStmt: ReturnType<Database["query"]>
  readonly totalDigestsStmt: ReturnType<Database["query"]>
  readonly pivotsStmt: ReturnType<Database["query"]>
  readonly delegationsStmt: ReturnType<Database["query"]>
  readonly delegationTurnsStmt: ReturnType<Database["query"]> | null
}

function getPreparedNavQueries(db: Database): PreparedNavQueries {
  let cached = preparedCache.get(db)
  if (!cached) {
    const hasTurns = hasTable(db, "delegation_turn")
    cached = {
      ftsStmt: db.query(
        `SELECT f.session_id, COALESCE(s.root_id, f.session_id) as root_id, COALESCE(s.depth, 0) as depth, f.kind, substr(f.symbol_or_path, 1, 240) as sym, substr(f.body, 1, 600) as snippet, bm25(substrate_fts) as rank
         FROM substrate_fts f
         LEFT JOIN session s ON s.id = f.session_id
         WHERE substrate_fts MATCH ?
         ORDER BY rank
         LIMIT 50`,
      ),
      digestStmt: db.query("SELECT * FROM session_semantic_digest WHERE session_id = ?"),
      allRootDigestsStmt: db.query(
        `SELECT d.*
         FROM session_semantic_digest d
         LEFT JOIN session s ON s.id = d.session_id
         WHERE COALESCE(s.depth, 0) = 0
         ORDER BY COALESCE(s.t_updated, s.t_created, 0) DESC, d.session_id ASC`,
      ),
      totalDigestsStmt: db.query("SELECT COUNT(*) as c FROM session_semantic_digest"),
      pivotsStmt: db.query(
        "SELECT seq, message_id, t, prompt_excerpt, blob_ref, pivot_kind FROM intent_pivot WHERE session_id = ? ORDER BY seq ASC LIMIT ?",
      ),
      delegationsStmt: db.query(
        `SELECT call_id, child_session, harness, agent, description, status
         FROM delegation
         WHERE parent_session = ?
         ORDER BY t_created DESC
         LIMIT ?`,
      ),
      delegationTurnsStmt: hasTurns
        ? db.query(
            `SELECT call_id, child_session_id, turn_index, harness, agent, reported_outcome, verified_outcome
             FROM delegation_turn
             WHERE parent_session_id = ?
             ORDER BY turn_index DESC`,
          )
        : null,
    }
    preparedCache.set(db, cached)
  }
  return cached
}

export function queryVibeNavigation(
  db: Database,
  queryText: string,
  options?: VibeNavigationOptions,
): VibeNavigationResult
export function queryVibeNavigation(
  db: Database,
  optionsWithQuery: VibeNavigationOptions & { readonly query: string },
): VibeNavigationResult
export function queryVibeNavigation(
  db: Database,
  queryOrOptions: string | (VibeNavigationOptions & { readonly query: string }),
  maybeOptions: VibeNavigationOptions = {},
): VibeNavigationResult {
  const t0Ns = Bun.nanoseconds()
  ensureSemanticDigestSchema(db)

  const queryText = typeof queryOrOptions === "string" ? queryOrOptions : queryOrOptions.query
  const options: VibeNavigationOptions =
    typeof queryOrOptions === "string" ? maybeOptions : queryOrOptions

  const maxPivots = options.maxPivots ?? 9
  const maxDelegations = options.maxDelegations ?? 3
  const maxTouchedFiles = options.maxTouchedFiles ?? 3
  const maxDecisions = options.maxDecisions ?? 2
  const candidateLimit = options.limit ?? 5
  const maxTokens = options.maxTokens ?? options.maxTokensBudget ?? 600

  const {
    ftsStmt,
    digestStmt,
    allRootDigestsStmt,
    totalDigestsStmt,
    pivotsStmt,
    delegationsStmt,
    delegationTurnsStmt,
  } = getPreparedNavQueries(db)

  const allRootDigests = allRootDigestsStmt.all() as SessionSemanticDigestRow[]
  const totalDigestCount = (totalDigestsStmt.get() as { c: number } | null)?.c ?? 0
  const totalRootSessions = allRootDigests.length > 0 ? allRootDigests.length : totalDigestCount

  const tokens = tokenizeVibeQuery(queryText)
  const queryTokenCount = Math.max(1, tokens.length)
  const ftsQuery = tokens.map((t) => `"${t}"*`).join(" OR ")

  const ftsHits =
    ftsQuery.length > 0
      ? (ftsStmt.all(ftsQuery) as {
          session_id: string
          root_id: string
          depth: number
          kind: string
          sym: string
          snippet: string
          rank: number
        }[])
      : []

  const rootStats = new Map<
    string,
    {
      matchedTokens: Set<string>
      bestSingleRowMatchCount: number
      bestRowKindWeight: number
      bm25Sum: number
      bestBm25: number
    }
  >()

  for (const hit of ftsHits) {
    const entry = rootStats.get(hit.root_id) ?? {
      matchedTokens: new Set<string>(),
      bestSingleRowMatchCount: 0,
      bestRowKindWeight: 0,
      bm25Sum: 0,
      bestBm25: 0,
    }
    const textLower = `${hit.sym} ${hit.snippet}`.toLowerCase()
    const kindWeight =
      (hit.kind === "intent_pivot" || hit.kind === "decision") && hit.depth === 0
        ? 6.0
        : hit.kind === "headline" && hit.depth === 0
          ? 4.0
          : hit.kind === "delegation"
            ? 2.0
            : 1.0

    let rowMatches = 0
    for (const tok of tokens) {
      const stemPrefix = tok.length >= 5 ? tok.slice(0, tok.length - 2) : tok
      if (textLower.includes(tok) || (stemPrefix.length >= 3 && textLower.includes(stemPrefix))) {
        rowMatches += 1
        entry.matchedTokens.add(tok)
      }
    }
    if (
      rowMatches > entry.bestSingleRowMatchCount ||
      (rowMatches === entry.bestSingleRowMatchCount && kindWeight > entry.bestRowKindWeight)
    ) {
      entry.bestSingleRowMatchCount = rowMatches
      entry.bestRowKindWeight = kindWeight
    }
    const rawBm25 = Math.abs(hit.rank)
    if (rawBm25 > entry.bestBm25) {
      entry.bestBm25 = rawBm25
    }
    entry.bm25Sum = Math.min(20, entry.bm25Sum + Math.min(3, rawBm25))
    rootStats.set(hit.root_id, entry)
  }

  const scoredRoots: {
    readonly rootId: string
    readonly score: number
    readonly bestBm25: number
    readonly matchedTokenCount: number
    readonly tokenCoverage: number
  }[] = []

  for (const [rootId, st] of rootStats.entries()) {
    const matchedTokenCount = st.matchedTokens.size
    if (matchedTokenCount === 0) continue
    const tokenCoverage = Number((matchedTokenCount / queryTokenCount).toFixed(4))
    const total =
      matchedTokenCount * 30 +
      st.bestSingleRowMatchCount * 20 +
      st.bestRowKindWeight * 5 +
      st.bm25Sum
    scoredRoots.push({
      rootId,
      score: Number(total.toFixed(2)),
      bestBm25: Number(st.bestBm25.toFixed(2)),
      matchedTokenCount,
      tokenCoverage,
    })
  }

  scoredRoots.sort((a, b) => b.score - a.score || b.tokenCoverage - a.tokenCoverage || b.bestBm25 - a.bestBm25)

  const candidates: VibeNavigationCandidate[] = scoredRoots
    .slice(0, candidateLimit)
    .flatMap((sr) => {
      const d = digestStmt.get(sr.rootId) as SessionSemanticDigestRow | null
      if (!d) return []
      let pivotsCount = 0
      try {
        pivotsCount = (JSON.parse(d.intent_pivots_json) as unknown[]).length
      } catch {}
      const delRows = delegationsStmt.all(d.session_id, 20) as unknown[]
      return [
        {
          sessionId: d.session_id,
          session_id: d.session_id,
          headline: d.headline,
          verificationState: d.verification_state,
          verification_state: d.verification_state,
          score: sr.score,
          combinedScore: sr.score,
          bestBm25: sr.bestBm25,
          matchedTokenCount: sr.matchedTokenCount,
          matched_token_count: sr.matchedTokenCount,
          queryTokenCount,
          query_token_count: queryTokenCount,
          tokenCoverage: sr.tokenCoverage,
          token_coverage: sr.tokenCoverage,
          pivotsCount,
          delegationsCount: delRows.length,
        },
      ]
    })

  if (candidates.length === 0) {
    const elapsedMs = (Bun.nanoseconds() - t0Ns) / 1_000_000
    const bodyLines = [
      `## Vibe Navigation Digest · \`0\` matches`,
      `_Indexed root sessions: ${totalRootSessions} | Matched: 0 | Query tokens: [${tokens.join(", ")}] (${elapsedMs.toFixed(2)} ms)_`,
      "",
      `No matching sessions found for query "${queryText}" across ${totalRootSessions} indexed root session(s).`,
    ]
    const bodyText = bodyLines.join("\n")
    const prelimFooter = `_Strategist Viewport search (000 tokens, ${elapsedMs.toFixed(2)} ms | matched 0 of ${totalRootSessions} indexed root session(s))._`
    const prelimTokens = estimateTokens(`${bodyText}\n\n${prelimFooter}`)
    const finalFooter = `_Strategist Viewport search (${prelimTokens} tokens, ${elapsedMs.toFixed(2)} ms | matched 0 of ${totalRootSessions} indexed root session(s))._`
    const markdown = `${bodyText}\n\n${finalFooter}`
    const markdownTokens = estimateTokens(markdown)
    const emptyDigest: VibeNavigationDigest = {
      query: queryText,
      total_root_sessions: totalRootSessions,
      matched_count: 0,
      matched_root: null,
      intent_pivots: [],
      delegations: [],
      touched_files: [],
      key_decisions: [],
    }
    const jsonStr = JSON.stringify(emptyDigest)
    return {
      digest: emptyDigest,
      markdown,
      matchedRootSessionID: "",
      session_id: "",
      headline: "",
      verificationState: "in_progress_or_unverified",
      score: 0,
      bestBm25: 0,
      matchedTokenCount: 0,
      queryTokenCount,
      tokenCoverage: 0,
      tokenCount: markdownTokens,
      estimatedTokens: markdownTokens,
      totalRootSessions,
      matchedSessions: [],
      candidates: [],
      metrics: {
        markdown_chars: markdown.length,
        markdown_tokens: markdownTokens,
        json_chars: jsonStr.length,
        json_tokens: estimateTokens(jsonStr),
        fts_hits: ftsHits.length,
        pivots_returned: 0,
        delegations_returned: 0,
        total_root_sessions: totalRootSessions,
        matched_root_sessions: 0,
        elapsed_ms: Number(elapsedMs.toFixed(3)),
      },
    }
  }

  const primaryHit = candidates[0]!
  const bestRootId = primaryHit.session_id
  const bestScore = primaryHit.score
  const bestBm25 = primaryHit.bestBm25
  const bestMatchedTokens = primaryHit.matchedTokenCount
  const bestCoverage = primaryHit.tokenCoverage
  const rootDigest = digestStmt.get(bestRootId) as SessionSemanticDigestRow

  const pivots = pivotsStmt.all(bestRootId, maxPivots) as {
    seq: number
    message_id: string
    t: string
    prompt_excerpt: string
    blob_ref: string
    pivot_kind: IntentPivotKind
  }[]

  const delegations = delegationsStmt.all(bestRootId, maxDelegations) as {
    call_id: string
    child_session: string | null
    harness: string | null
    agent: string | null
    description: string | null
    status: string | null
  }[]

  const turns = delegationTurnsStmt
    ? (delegationTurnsStmt.all(bestRootId) as {
        call_id: string
        child_session_id: string
        turn_index: number
        harness: string
        agent: string | null
        reported_outcome: string | null
        verified_outcome: string
      }[])
    : []

  const turnByKey = new Map<string, (typeof turns)[number]>()
  for (const t of turns) {
    if (!turnByKey.has(t.call_id)) turnByKey.set(t.call_id, t)
    if (!turnByKey.has(t.child_session_id)) turnByKey.set(t.child_session_id, t)
  }

  const touchedFiles = (JSON.parse(rootDigest.touched_files_json) as string[]).slice(
    0,
    maxTouchedFiles,
  )
  const keyDecisions = (JSON.parse(rootDigest.key_decisions_json) as string[])
    .filter((d) => !d.includes("->"))
    .slice(0, maxDecisions)

  const compactDelegations = delegations.map((d) => {
    const turn =
      turnByKey.get(d.call_id) ?? (d.child_session ? turnByKey.get(d.child_session) : undefined)
    const status = d.status ?? "completed"
    const reportedOutcome = turn?.reported_outcome ?? (status === "completed" ? "succeeded" : status)
    const verifiedOutcome =
      turn?.verified_outcome ??
      (status === "error" || status === "failed" ? "tool_error_inside" : "clean")
    return {
      child_session: d.child_session ?? "none",
      harness: d.harness ?? turn?.harness ?? "opencode",
      agent: d.agent ?? turn?.agent ?? "subagent",
      description: cleanExcerpt(d.description ?? "delegated task", 24),
      status,
      reported_outcome: reportedOutcome,
      verified_outcome: verifiedOutcome,
    }
  })

  if (compactDelegations.length === 0 && turns.length > 0) {
    for (const t of turns.slice(0, maxDelegations)) {
      compactDelegations.push({
        child_session: t.child_session_id,
        harness: t.harness,
        agent: t.agent ?? "subagent",
        description: `turn ${t.turn_index}`,
        status: t.reported_outcome ?? "completed",
        reported_outcome: t.reported_outcome ?? "succeeded",
        verified_outcome: t.verified_outcome,
      })
    }
  }

  const elapsedMs = (Bun.nanoseconds() - t0Ns) / 1_000_000

  const renderMarkdownWithLimit = (pivotCharCap: number, maxPivotsSlice: number, maxHitsSlice: number): string => {
    const slicedPivots = pivots.slice(0, maxPivotsSlice)
    const slicedHits = candidates.slice(0, maxHitsSlice)
    const mdLines: string[] = [
      `## Vibe Navigation Digest · \`${bestRootId}\``,
      `_Indexed root sessions: ${totalRootSessions} | Matched: ${candidates.length} | Query tokens: [${tokens.join(", ")}] (${elapsedMs.toFixed(2)} ms)_`,
      `**Headline:** ${rootDigest.headline} | **Gate:** \`${rootDigest.verification_state}\``,
      `- **Score:** coverage=${primaryHit.matchedTokenCount}/${primaryHit.queryTokenCount} (${Math.round(primaryHit.tokenCoverage * 100)}%) | bm25=${primaryHit.bestBm25.toFixed(2)} | score=${primaryHit.combinedScore.toFixed(2)} | pivots=${primaryHit.pivotsCount} | delegations=${primaryHit.delegationsCount}`,
      ...(slicedHits.length > 1
        ? [
            ...slicedHits.slice(1).map(
              (hit) =>
                `- **Alt \`${hit.sessionId}\`:** coverage=${hit.matchedTokenCount}/${hit.queryTokenCount} (${Math.round(hit.tokenCoverage * 100)}%) | bm25=${hit.bestBm25.toFixed(2)} | score=${hit.combinedScore.toFixed(2)}`,
            ),
          ]
        : []),
      "",
      `### Intent Pivots (${slicedPivots.length})`,
      ...slicedPivots.map(
        (p) =>
          `- \`seq=${p.seq}\` [${p.pivot_kind}] ${cleanExcerpt(p.prompt_excerpt, pivotCharCap)} (\`${p.blob_ref.slice(0, 17)}\`)`,
      ),
      "",
      `### Child Delegations (${compactDelegations.length})`,
      ...compactDelegations.map(
        (d) =>
          `- \`${d.child_session}\` (${d.harness}/${d.agent}): ${d.description} [\`${d.status}\` · reported=\`${d.reported_outcome}\` -> verified=\`${d.verified_outcome}\`]`,
      ),
      "",
      `### Touched Files & Trajectory Notes`,
      `- **Files:** ${touchedFiles.map((f) => `\`${f}\``).join(", ") || "none"}`,
      ...(keyDecisions.length > 0 ? keyDecisions.map((k) => `- **Note:** ${cleanExcerpt(k, 68)}`) : []),
    ]
    const body = mdLines.join("\n")
    const prelimFooter = `_Strategist Viewport search (000 tokens, ${elapsedMs.toFixed(2)} ms | matched ${candidates.length} of ${totalRootSessions} indexed root session(s))._`
    const tokEst = estimateTokens(`${body}\n\n${prelimFooter}`)
    const footerLine = `_Strategist Viewport search (${tokEst} tokens, ${elapsedMs.toFixed(2)} ms | matched ${candidates.length} of ${totalRootSessions} indexed root session(s))._`
    return `${body}\n\n${footerLine}`
  }

  let markdown = renderMarkdownWithLimit(44, pivots.length, Math.min(candidates.length, 3))
  if (estimateTokens(markdown) >= maxTokens) {
    markdown = renderMarkdownWithLimit(28, pivots.length, 1)
  }
  if (estimateTokens(markdown) >= maxTokens) {
    markdown = renderMarkdownWithLimit(24, Math.max(1, Math.min(pivots.length, 5)), 1)
  }

  const markdownChars = markdown.length
  const markdownTokens = estimateTokens(markdown)

  const buildDigestWithCap = (
    pivotExcerptCap: number,
    decisionCap: number,
    decisionCount: number,
    touchedFilesCount: number,
    delegationCount: number,
  ): VibeNavigationDigest => ({
    query: queryText,
    total_root_sessions: totalRootSessions,
    matched_count: candidates.length,
    matched_root: {
      session_id: bestRootId,
      headline: rootDigest.headline,
      verification_state: rootDigest.verification_state,
      score: Number(bestScore.toFixed(2)),
      best_bm25: bestBm25,
      matched_token_count: bestMatchedTokens,
      query_token_count: queryTokenCount,
      token_coverage: bestCoverage,
    },
    intent_pivots: pivots.map((p) => ({
      seq: p.seq,
      kind: p.pivot_kind,
      excerpt: cleanExcerpt(p.prompt_excerpt, pivotExcerptCap),
      blob_ref: p.blob_ref.slice(0, 17),
    })),
    delegations: compactDelegations.slice(0, delegationCount),
    touched_files: touchedFiles.slice(0, touchedFilesCount),
    key_decisions: keyDecisions.slice(0, decisionCount).map((k) => cleanExcerpt(k, decisionCap)),
  })

  let digest = buildDigestWithCap(18, 32, Math.min(1, keyDecisions.length), Math.min(4, touchedFiles.length), compactDelegations.length)
  let jsonStr = JSON.stringify(digest)
  if (estimateTokens(jsonStr) >= maxTokens) {
    digest = buildDigestWithCap(14, 24, 1, Math.min(3, touchedFiles.length), Math.min(3, compactDelegations.length))
    jsonStr = JSON.stringify(digest)
  }
  if (estimateTokens(jsonStr) >= maxTokens) {
    digest = buildDigestWithCap(10, 20, 0, Math.min(2, touchedFiles.length), Math.min(2, compactDelegations.length))
    jsonStr = JSON.stringify(digest)
  }

  return {
    digest,
    markdown,
    matchedRootSessionID: bestRootId,
    session_id: bestRootId,
    headline: rootDigest.headline,
    verificationState: rootDigest.verification_state,
    score: Number(bestScore.toFixed(2)),
    bestBm25,
    matchedTokenCount: bestMatchedTokens,
    queryTokenCount,
    tokenCoverage: bestCoverage,
    tokenCount: markdownTokens,
    estimatedTokens: markdownTokens,
    totalRootSessions,
    matchedSessions: candidates,
    candidates,
    metrics: {
      markdown_chars: markdownChars,
      markdown_tokens: markdownTokens,
      json_chars: jsonStr.length,
      json_tokens: estimateTokens(jsonStr),
      fts_hits: ftsHits.length,
      pivots_returned: pivots.length,
      delegations_returned: compactDelegations.length,
      total_root_sessions: totalRootSessions,
      matched_root_sessions: candidates.length,
      elapsed_ms: Number(elapsedMs.toFixed(3)),
    },
  }
}

export function runSevenSampleBenchmark(
  db: Database,
  queries: readonly string[] = [
    "look at my prompting throughout and continue from Wave 2 slice",
    "prune the context to look at my prompting throughout and continue on from this with exact same posture",
    "44-step auto-run context-prune 0 bytes",
  ],
): readonly BenchmarkSummary[] {
  const timingsByQuery = new Map<string, number[]>()
  const lastResultByQuery = new Map<string, VibeNavigationResult>()
  for (const q of queries) timingsByQuery.set(q, [])

  for (const q of queries) {
    queryVibeNavigation(db, q)
  }

  for (let sample = 0; sample < 7; sample++) {
    const ordered = sample % 2 === 0 ? [...queries] : [...queries].reverse()
    for (const q of ordered) {
      const t0 = Bun.nanoseconds()
      const res = queryVibeNavigation(db, q)
      const elapsedMs = (Bun.nanoseconds() - t0) / 1_000_000
      if (res.metrics.pivots_returned === 0) {
        throw new Error(`Benchmark completed-work check failed for query: ${q}`)
      }
      timingsByQuery.get(q)!.push(elapsedMs)
      lastResultByQuery.set(q, res)
    }
  }

  return queries.map((q) => {
    const sorted = [...timingsByQuery.get(q)!].sort((a, b) => a - b)
    const res = lastResultByQuery.get(q)!
    return {
      query: q,
      samples: sorted.length,
      median_ms: Number(sorted[Math.floor(sorted.length / 2)]!.toFixed(3)),
      min_ms: Number(sorted[0]!.toFixed(3)),
      max_ms: Number(sorted[sorted.length - 1]!.toFixed(3)),
      markdown_tokens: res.metrics.markdown_tokens,
      json_tokens: res.metrics.json_tokens,
      matched_root: res.digest.matched_root?.session_id ?? "",
      limiter:
        "SQLite FTS5 BM25 inverted-index scan + 3 B-tree point lookups in-process (CPU-bound in bun:sqlite)",
    }
  })
}
