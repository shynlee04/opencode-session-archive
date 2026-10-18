# UAT Runtime Observation — Phases E1.1 / E1.2 / E1.3

<!-- Evidence record, not an acceptance record. acceptance stays UAT_PENDING for owner sign-off. -->

| Field | Value |
|---|---|
| Date | 2026-10-18 |
| Driver | Orchestrator agent (live session, code-mode tool path) |
| Plugin under test | `.opencode/plugins/session-archive.ts` |
| Plugin sha256 | `4703da521bda599937e427fdcbc9721f2e1dce7e88add8a0a5df7494d2c3f9dd` |
| Build parity | byte-identical to `dist/session-archive.ts` (341,139 bytes) |
| Candidate commit | `de42f87` |
| Observed session | `ses_eb0b16e7affenKuEzNH2l2hJiL` (the same session the plugin archives) |
| Baseline gate | `128 pass, 1 skip, 0 fail` · `tsc --noEmit` clean |
| UAT files | `trajectory-working-memory/UAT.md`, `codebase-structural-graph/UAT.md`, `viewport-synthesis-compaction/UAT.md` |

## Method

The three UAT files' numbered "Tests" were driven against the installed plugin inside the live
session it archives. Each step's `do:` command was executed and the observed result compared to the
`expect:` text. Manual-only items (live-LLM adherence to `FRESH — DO NOT REREAD`, post-compaction
reread behavior, Implementor navigation preference) are not reachable from a tool call and remain
owner-observed.

## Consumer surface map — how the tools surface to whom

This is the frame the owner asked for: what an **agent** (tool caller) sees versus what a **human
prompting** the agent ever sees.

| Capability | Agent surface (tool call) | Human surface (prompting) |
|---|---|---|
| Archive sync | `substrate.viewport({action:"sync"})` / `archive.persist` | none — no CLI/TUI command |
| Working-set status | `substrate.viewport({action:"status"})` | none — only the agent's prose |
| Working-set prune | `substrate.valve` / `ctx.context-prune` | none — no user-triggerable lever |
| Structural recall | `viewport` actions `repomap`/`skeleton`/`slice`/`coupled` | none |
| Navigation / continuity | `search`/`timeline`/`provenance`/`brief` | none |
| Archive inspection | (indirect) | none — requires raw `sqlite3 .session-archive/index.sqlite` |

Every value path is agent-tool-only. A human operator has no native surface to inspect the archive,
the working set, or provenance; the "conversational owner UAT" therefore asks a *human* to hand-type
tool calls — a category mismatch between the UAT's persona and the product's actual surface.

## Step evidence

### E1.1 · 1 — sync + warm skip — **PASS**
- `substrate.viewport({action:"sync"})` → `Persisted session tree rooted at ses_eb0b16e7affenKuEzNH2l2hJiL into …/.session-archive. 1 sessions, 8 messages, 0 delegations. 20 files written, 0 unchanged.`
- Repeat → `… 0 files written, 20 unchanged.` (warm skip holds)
- Layout: `.session-archive/{index.sqlite, index.sqlite-wal, index.sqlite-shm, blobs/*.txt, sessions/…}` — outside `.opencode/` as required.
- Host DB read-only: `src/archive/source.ts:295` → `new Database(dbPath, { readonly: true })`.

### E1.1 · 2 — multi-stop delegation outcome classifier — **NOT EXERCISED**
- `substrate.viewport({action:"status"})` → `### 3. Delegation Trajectory (0 turns, 0 flagged)`.
- This session spawned no children, so `reported_outcome` / `verified_outcome` divergence and
  inner-tool-error / `BLOCKED` flagging could not be observed. Requires a session with a child
  `subagent` / `delegate-devin` / `hivemind-delegate` turn.

### E1.1 · 3 — step-watermark prune + manifest + resolve — **PARTIAL**
- `substrate.viewport({action:"resolve", blob:"4c958a127f55"})` → returned the **exact** original
  `src/archive/valve.ts` lines (`1: import { existsSync, … }`). Resolve path **PASS**.
- `substrate.valve({action:"status"})` before → `currently unarmed`.
- `substrate.valve({action:"prune", mode:"step-window", keepRecentSteps:8})` → `WorkingSetValve armed … (reason: no-op). Anchor: none (index 0); 0/0 assistant steps thinned (0 tool parts, ~-104 net tokens freed). Manifest: 0 files read, 0 files modified, 0 active skills.`
- `status` after → `armed … anchor: none; Thinned: 0 tool parts`.
- The manual prune thinned **nothing**. Cause (see D2): the tool executor's context carries no
  session messages, so `executeValve` iterates an empty array.

### E1.2 · 1 — Tier-1 `RepoMap` — **PASS**
- `substrate.viewport({action:"repomap", maxTokens:1000})` → 3,970 chars ≈ **993 tokens** (<1,000),
  `# Tier-1 RepoMap (19 files, 43 import edges, sorted by PageRank)`, e.g.
  `1. src/archive/types.ts (PR=0.2715, in=8, out=0, 505 LOC): KvBindingRow[L452-L481], SessionRow[L16-L42], …`.

### E1.2 · 2 — Tier-2 `AstSkeleton` + Tier-3 `SymbolSlice` — **PASS**
- `skeleton path=src/archive/valve.ts` → 3,392 chars vs 63,645 raw chars = **94.7%** saved, includes
  Depth-2 helpers; header `// src/archive/valve.ts (1770 LOC)`.
- `slice path=src/archive/valve.ts symbol=computeStepWatermark` → exact `L298-L420` source lines
  (matches the file's real line numbers).

### E1.2 · 3 — Tier-4 co-change + HIDDEN COUPLING — **PASS**
- `coupled path=src/plugin.ts` → `// - src/archive/index.ts: P=66.7% (2/3 commits, Jaccard=50.0%, static+temporal)`.
- `coupled path=src/archive/index-db.ts` → surfaced a true
  `// - src/archive/source.ts: P=66.7% (2/3 commits, Jaccard=66.7%, HIDDEN COUPLING (0 static import edges))`.
  HIDDEN COUPLING branch confirmed.

### E1.3 · 1 — FTS5 search + `IntentPivot` timeline (no `sessionID`) — **PASS (with D3)**
- `search query="Wave 2 slice 1"` → auto-resolved `ses_eb0b16e7…` (no `"Specify action and sessionID"`
  throw); 656 chars ≈ **164 tok** (<600). Output carries a hardcoded footer (D3).
- `timeline` → 348 chars, `## Intent Pivot Timeline … (1 pivots)`, auto-resolved.

### E1.3 · 2 — provenance staleness + compaction packet — **FAIL (FRESH half)**
- `provenance` → `- Files tracked: 11 (0 FRESH, 11 STALE)`.
- Packet (driven via `buildCompactionContinuationPacket` over `.session-archive/index.sqlite`):
  `tokenCount=830, charCount=3320, withinBudget=true`; all 6 sections present
  (Headline & Gate, Intent Pivot Timeline, Working-Memory Manifest, Delegation Trajectory,
  Provenance Chain, Tier-1 RepoMap & Co-Change Alerts) — but `sections.freshFilesCount=0,
  staleFilesCount=11`.
- The "unchanged files remain `FRESH — DO NOT REREAD`" half fails; see D1. The real `compaction`
  hook event itself needs a live host compaction to observe end-to-end.

### E1.3 · 3 — `brief` + legacy aliases — **PASS**
- `brief targetPaths=["src/plugin.ts"] symbolNames=["resolveArchiveDir"] maxTokens=1200` → 2,080 chars
  ≈ **520 tok** (≤1,200), combining Provenance Constraints, Tier-4 Co-Change, Tier-3 Symbol Slices,
  Tier-2 AST Skeletons, Tier-1 RepoMap.
- `ctx.context-prune({action:"status"})` output is byte-identical to `substrate.valve({action:"status"})`.
- `archive.persist({})` output matches `substrate.viewport({action:"sync"})` (`0 files written, 32 unchanged`).

## Defects observed

### D1 — P1 · every read file is permanently `STALE`; `FRESH — DO NOT REREAD` unreachable
- `src/archive/normalize.ts:318-337` stores `read_blob_sha = sha256(outputText)`, where `outputText` is
  the **rendered** read output (`Read file …, lines N-M` header + `N:` line prefixes).
- Reconciliation hashes the **raw file** (`src/viewports/continuity.ts:989`, `computeDiskShaForPath`).
- The two can never be equal → `classifyFileStaleness` (`continuity.ts:769-773`) always returns `STALE`.
- Proof: read blob `blob:39059fdad8ad` body begins `Read file …/UAT.md, lines 1-61\n1: ---`; its sha256
  equals the recorded `read_blob_sha`; the file's `shasum -a 256` = `21c0322937f2…` ≠ recorded.
- Unit tests miss it because they inject matching `currentDiskHashes` (synthetic), never the real disk path.

### D2 — P1 · `substrate.valve` manual prune is a no-op
- `src/plugin.ts:216-219` reads messages via `(ctx as any).session?.messages`.
- Host contract: `Tool.Context` exposes only `{ sessionID, agent, messageID, id, progress }`
  (`node_modules/@opencode/schema/dist/tool.d.ts:10`); `@opencode/plugin`'s `ToolContext` adds only
  `signal` + `progress`. There is no `session` accessor → the guard falls through to `[]`.
- Observed consequence: prune reports `0/0 assistant steps`, `reason: no-op`, `Manifest: 0 files read`.
- Only the in-memory `context` hook (`applyContextHookInMemory`) actually prunes.

### D3 — P2 · fabricated footer in every `search` digest
- `src/viewports/semantic-digest.ts:1568` hardcodes
  `> **vs S2 \`msg[124..125]\`:** Replaced 2 shell/Python JSONL scrapes (\`15,000\`-char cap / \`~3,750\` tok) with 1 SQLite FTS5 query.`
  and appends it unconditionally (`:1569`) to the digest for any session/query.
- A related hardcoded prototype string sits at `src/viewports/semantic-digest.ts:667`.

## Not reachable from a tool call (owner-only)
- Live host LLM adherence to `FRESH — DO NOT REREAD` / `ACTIVE — DO NOT RE-INVOKE` across 45+ steps.
- Post-compaction zero-reread behavior across a real OpenCode V2 compaction boundary.
- Implementor's interactive `skeleton`+`slice`-over-`read` preference.
