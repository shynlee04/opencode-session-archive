# WF-SUB-01: Semantic Session Digest, Intent Pivot Index & Vibe-Coder Navigation

- **ID:** `WF-SUB-01`
- **Labels:** `wayfinder`, `wayfinder:prototype`
- **Status:** `resolved (prototype verified)`
- **Depends on:** none
- **Evidence Input:** [`WF-SUB-R01`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/wayfinder/research/WF-SUB-R01-forensic-dual-plugin-collision.md)
- **Retained Prototype Artifacts:**
  - [`wf-sub-01-semantic-digest.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-01-semantic-digest.ts)
  - [`wf-sub-01-semantic-digest.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/wf-sub-01-semantic-digest.test.ts)
  - [`wf-sub-01-index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-01-index.sqlite)

## Question

How can `hivemind-substrate` add a thin, deterministic semantic layer over opaque `ses_...` IDs in `.session-archive/index.sqlite` so that both vibe coders and orchestrator agents can locate prior prompts, intent pivots, child trajectories, and touched files by topic or natural language without shelling out with custom Python scripts over raw `.jsonl` files?

## Why This Matters (Observed Failure)

In [`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) (`msg[120..125]`), after running `archive.persist` and `context-prune`, the agent had only the opaque string `ses_eb23bfbf0ffesn5kT0yJI06h35`. Because `session-archive` stores raw `ses_id` directories and exposes no semantic index or query tool, the agent ran `head -c 1600` (`msg[124]`, `5,142` chars output) and an inline Python JSONL loop (`msg[125]`, `15,000`-char slice cap, `5,915` chars output) that dumped `11,057` characters of raw shell scrapes (`30,331` total tool-output chars across `msg[124..125]`) back into active context.

## Prototype Experiment Scope & Execution (`scratch/prototypes/wf-sub-01-semantic-digest.ts`)

1. Copied `/Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.session-archive/index.sqlite` (`63` sessions on disk: the `56` baseline sessions across 7 roots plus 7 sessions from `ses_eb18d653fffeUYQsp6vur5qKld`) into [`wf-sub-01-index.sqlite`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/scratch/prototypes/data/wf-sub-01-index.sqlite) without mutating the source archive.
2. Ingested all session JSONL transcripts and overlaid the two exported JSON fixtures ([`session-a35adea6`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-a35adea6-83a7-439f-90b1-f15793b79239.json) for `ses_eb23bfbf0ffesn5kT0yJI06h35` and [`session-bcad339b`](file:///var/folders/wn/mt1t2bp52rl0pttbgq6bmswh0000gn/T/session-bcad339b-471f-456c-8815-eb205e6c929b.json) for `ses_eb2eabb14ffeCXsCwb845rtffb`), indexing `63` sessions, `101` human intent pivots across all 6 `pivot_kind` categories (`initial_goal`, `course_correction`, `approval`, `handoff_resume`, `prune_or_continuity`, `followup`), and `495` `substrate_fts` rows.
3. Implemented `queryVibeNavigation(db, queryText, options)` and `resolvePromptBlob(db, blobRef)` and verified them with `bun test scratch/prototypes/wf-sub-01-semantic-digest.test.ts` (`5 pass, 0 fail, 75 expect() calls`).

## 7-Sample Interleaved Benchmark Results (`benchmark-checklist`)

- **Runtime & Hardware:** Bun `v1.4.3 (c6da4a4d3)` on macOS (`bun:sqlite` in-process WAL read-only connection, warm prepared statements).
- **Method:** 1 warmup pass followed by 7 interleaved samples (`A -> B -> C` on even passes, `C -> B -> A` on odd passes). Every timed run asserted `pivots_returned > 0` inside the timed interval.
- **Limiter:** In-process SQLite FTS5 inverted-index `bm25(substrate_fts)` scan over `495` documents plus 3 B-tree point lookups (`session_semantic_digest`, `intent_pivot`, `delegation`). Zero child processes, zero file-system JSONL scans during query execution.

| Query | Samples | Median Latency | Min / Max Range | Markdown Output | Matched Root Session | vs `S2 msg[124..125]` (`~3,750` tok cap) |
|---|---:|---:|---:|---:|---|---|
| `"look at my prompting throughout and continue from Wave 2 slice"` | 7 | `1.118 ms` | `1.049 - 1.364 ms` | `1,932 chars` (`483 tok`) | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `-87.1%` tokens (`483` vs `3,750` tok) |
| `"prune the context to look at my prompting throughout and continue on from this with exact same posture"` | 7 | `0.493 ms` | `0.473 - 0.584 ms` | `1,932 chars` (`483 tok`) | `ses_eb23bfbf0ffesn5kT0yJI06h35` | `-87.1%` tokens (`483` vs `3,750` tok) |
| `"44-step auto-run context-prune 0 bytes"` | 7 | `0.809 ms` | `0.727 - 0.991 ms` | `1,574 chars` (`394 tok`) | `ses_eb2eabb14ffeCXsCwb845rtffb` | `-89.5%` tokens (`394` vs `3,750` tok) |

## Sample Viewport Output (`483 tokens`, `< 600`-token budget)

```markdown
## Vibe Navigation Digest · `ses_eb23bfbf0ffesn5kT0yJI06h35`
**Headline:** [Root · ultra] Narrow Early-Failure Review of Delegation Repairs | **Gate:** `verified_passed`

### Intent Pivots (9)
- `seq=4` [initial_goal] THe agent claim fix from this**Do not treat `6aaf1a… (`blob:b01c7583b519`)
- `seq=511` [prune_or_continuity] persist sezsion archive - delegate Devin to fix it… (`blob:abc094bd96fd`)
- `seq=1243` [prune_or_continuity] I have reloaded this /Users/MAC/Documents/coding-pr… (`blob:fd75fe69bcf5`)
- `seq=1474` [handoff_resume] continue (`blob:e256ee8e7aff`)
- `seq=1946` [followup] so reflect on the high-level on the high-level @ket… (`blob:9e08cd93ae57`)
- `seq=2002` [course_correction] I want something high-level - first this can not ke… (`blob:249fd5d63e69`)
- `seq=2059` [prune_or_continuity] there are storage for compaction-continuity and per… (`blob:cacea986b6eb`)
- `seq=2650` [approval] ok (`blob:2689367b205c`)
- `seq=2859` [approval] you can use devin for these spec and plan work (`blob:4e8df4552e39`)

### Child Delegations (3)
- `ses_eb1bedfbdffeO63D7iqs8gcsZ3` (devin/devin-delegate): Amend native control specifications [`completed`]
- `ses_eb1c855c3ffeW6vgA7mQ2wosiI` (opencode/researcher): Map upstream specification impacts [`completed`]
- `ses_eb1c85663ffeYsGMb54ib5rsMV` (opencode/executor): Adopt approved constitutional wording [`completed`]

### Touched Files & Trajectory Notes
- **Files:** `.audit/2026-10-18-wave2-bounded-repair-followup/run.md`, `.audit/2026-10-18-wave2-bounded-repair-followup/handoff.md`, `.planning/phases/multi-harness-delegation/plans/10-bounded-admission-and-permission-recovery.md`
- **Note:** Compaction checkpoint at seq=847 (auto, 214159 tok_in)
- **Note:** Dual-plugin collision: archive.persist + context-prune collapsed 53 tool…

> **vs S2 `msg[124..125]`:** Replaced 2 shell/Python JSONL scrapes (`15,000`-char cap / `~3,750` tok) with 1 SQLite FTS5 query.
```

## Key Findings for Specification Synthesis

1. **Bug in `src/archive/normalize.ts` (`normalizeUser`):** `normalizeUser` (`L216-239`) currently leaves `user.text` inline in the session JSONL without sinking `user.text` into `.session-archive/blobs/<sha256>.txt` even when `user.text.length > 4096` (such as `msg_14c3f65d80010Tf41DlTd8mHOX` at `16,626` chars and `msg_14dc40416001DQBCX32ROgxPXO` at `5,488` chars). The production `normalizeUser` must sink every human prompt (or store the canonical body in SQLite + `blobs/<sha256>.txt`) so `blob:<sha256>` handles on `intent_pivot` resolve on disk as well as in SQLite.
2. **Compound-token boundary expansion in FTS5:** Vibe-coder prompts mix spaced terms (`"Wave 2 slice"`) with hyphenated or concatenated worktree names (`wave2-slice1`, `mh27`, `44-step`). Expanding letter-digit boundaries (`wave2` -> `wave 2`) during FTS5 indexing and query tokenization is essential so natural-language queries match worktree paths and ticket slugs deterministically.
3. **Root-level token-coverage scoring beats raw FTS row sums:** Summing raw `bm25()` scores across all child FTS rows biases toward root sessions with many children matching common words (`run`, `step`, `context`). Scoring roots by distinct matched query tokens (`matchedTokens.size`) plus best single-row match count (`intent_pivot` / `decision` weighted above `child` rows) resolves both conversational continuity queries and forensic failure queries with 100% accuracy in `< 1.2 ms`.
