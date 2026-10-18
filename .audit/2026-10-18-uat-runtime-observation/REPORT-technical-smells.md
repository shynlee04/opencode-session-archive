# Report — Technical Smells

<!-- Findings only. No code changes. Severity: P1 = correctness/trust, P2 = maintainability/design, P3 = cosmetic. -->

| Field | Value |
|---|---|
| Date | 2026-10-18 |
| Subject | `hivemind-substrate` source, Phases E1.1 / E1.2 / E1.3 |
| Input evidence | `.audit/2026-10-18-uat-runtime-observation/EVIDENCE.md` |
| Baseline | `128 pass, 1 skip, 0 fail` · `tsc --noEmit` clean (smells below are green-gate-passing) |

## Inventory

| ID | Sev | Smell | Location | Evidence |
|---|---|---|---|---|
| T-1 | P1 | Hash-domain mismatch: two "file identity" domains compared as one | `src/archive/normalize.ts:318-337` vs `src/viewports/continuity.ts:989` | `read_blob_sha` = sha of rendered read output (header + `N:` prefixes); disk hash = raw bytes; never equal → permanent `STALE` (D1) |
| T-2 | P1 | Broken host contract hidden by `as any` | `src/plugin.ts:216-219` | Reads `(ctx as any).session?.messages`; host `Tool.Context` has no `session` (`node_modules/@opencode/schema/dist/tool.d.ts:10`) → prune no-op (D2) |
| T-3 | P2 | Prototype/fixture strings in production render path | `src/viewports/semantic-digest.ts:1568` (and `:667`) | Hardcoded `vs S2 msg[124..125]` footer appended to every digest (D3) |
| T-4 | P2 | Prototype constants + session-id special-casing shipped in a library module | `src/viewports/continuity.ts:7-101`, `selectFilesForPacket` (`:1218`), `selectSkillsForPacket` (`:1245`) | Absolute `scratch/prototypes/data/*` paths; 39 references to `S1_SESSION_ID`/`S2_SESSION_ID`/`P1_RELEASE_SESSION_ID`; `if (sessionId === S1_SESSION_ID) …` branches |
| T-5 | P2 | Schema ownership split: `file_read_ledger` / `skill_load_ledger` DDL duplicated with in-place migration | `src/archive/index-db.ts:313+` vs `src/viewports/continuity.ts:428-657` | Two CREATE TABLE definitions + `ALTER TABLE` migration + `WeakSet` re-init guard for the same tables |
| T-6 | P2 | Duplicated path normalizer with divergent signatures and hardcoded roots | `src/archive/valve.ts:208`, `src/viewports/continuity.ts:724`, `src/viewports/semantic-digest.ts:452` | Three `normalizeRepoPath` definitions; continuity hardcodes `hivemind-substrate` / `hivemind-steward-oc-devin-dev` roots |
| T-7 | P3 | Duplicated `estimateTokens` | `src/archive/valve.ts:203`, `src/honeycomb/ast-skeleton.ts:286`, `src/viewports/continuity.ts:719`, `src/viewports/semantic-digest.ts` | Four identical `ceil(len/4)` definitions |
| T-8 | P2 | Machine-specific absolute paths in library code | `src/viewports/continuity.ts`, `semantic-digest.ts`, `src/viewports/brief.ts`, `src/honeycomb/cochange.ts` | 12 occurrences of `/Users/MAC/Documents/coding-projects/…` |
| T-9 | P2 | Error-swallowing `catch {}` | `src/plugin.ts:300`, `:313`, `:420`; `src/viewports/continuity.ts:993`, `:1058` | `try { mineGitCochange(db, projectRoot) } catch {}` silently ignores indexing failure |
| T-10 | P3 | Brittle fixed-cap token budget loop | `src/viewports/semantic-digest.ts:1572-1578` | Escalates only via `46 → 28 → 24` pivot caps; `pivots.length` slices but per-pivot excerpt cap is fixed |
| T-11 | P2 | Coverage overstatement in the ledger | `src/archive/normalize.ts:312-317` | Records `line_range: "all"` when no offset/limit given, even though the archived read output was truncated (`valve.ts`: 1,769 lines, read returned `1-1436`) |
| T-12 | P3 | Pervasive `as any` at the plugin/host boundary | `src/plugin.ts:216-219, 368-424` | `(ctx as any).session?.hook`, `(ctx as any).event?.subscribe` — bypasses the typed host API |

## Duplication census

| Helper / artifact | Definitions | Files |
|---|---|---|
| `estimateTokens` | 4 | valve, ast-skeleton, continuity, semantic-digest |
| `normalizeRepoPath` | 3 | valve, continuity, semantic-digest |
| `file_read_ledger` / `skill_load_ledger` DDL | 2 each | index-db, continuity |
| Hardcoded absolute project roots | 12 | continuity, semantic-digest, brief, cochange |

## Patterns behind the smells

1. **Prototype not fully retired.** `continuity.ts` and `semantic-digest.ts` still carry the WF-SUB
   prototype's absolute paths, sample session IDs, and benchmark strings. Production modules branch on
   fixture identities (`S1_SESSION_ID`), so real sessions and fixture sessions share one code path with
   special cases. This is the root pattern behind T-3, T-4, T-8.
2. **Two owners for one concept.** File identity (T-1), ledger schema (T-5), path normalization (T-6),
   and token estimation (T-7) each have ≥2 definitions. Where they disagree, behavior is wrong rather
   than merely duplicated — T-1 is the worked example.
3. **Contract assumptions unchecked by types.** The host boundary is reached through `as any`
   (T-2, T-12); the freshness comparison assumes one hash domain (T-1); both fail silently and green.
4. **Best-effort error handling without telemetry.** Swallowed catches (T-9) mean an indexing or
   co-change failure is indistinguishable from "no data" at the consumer surface.

## Note on severity

T-1 and T-2 are correctness/trust defects surfaced by runtime UAT but invisible to the green gate; they
are also recorded as D1/D2 in the evidence file and P-1/P-3 in the product report. T-3 is recorded as D3
/ P-5. The remaining items are maintainability debt, not current user-visible breakage.

## Boundaries

No code changes, tickets, or refactors were produced. This is a smell inventory for the owning lanes;
each item names a location and evidence, not a prescribed fix.
