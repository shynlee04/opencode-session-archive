# Report — Substrate vs native bashing (measured on this project)

<!-- Comparison report. Evidence = live measurements. No fixes. -->

| Field | Value |
|---|---|
| Date | 2026-10-19 |
| Subject project | `hivemind-substrate` — 26 src files, 16,974 src LOC, 570,395 src chars |
| Arms compared | (a) substrate viewport tools · (b) native bash via `shell` (rg/glob/git) · (c) ast-grep 0.51.0 via `bunx` |
| Token estimate | chars ÷ 4 (substrate's own estimator) |
| Native toolchain present | `rg` ✅ · `git` ✅ · `ast-grep` ⛔ not installed (installable: `@ast-grep/cli` 0.51.0, brew present) |

## Measured results

| Task | Substrate | Native bash | ast-grep |
|---|---|---|---|
| **Repo overview** (modules + symbols) | `repomap` **1,337 tok**, PageRank-ranked, 26 files | biggest-files + 60 exports **1,178 tok**; full export index **6,287 tok** | `outline src` **1,826 tok**, every symbol in every file |
| **Outline one file** (`continuity.ts`) | `skeleton` **1,583 tok** | `rg` symbol outline **3,297 tok** | `outline <file>` **1,079 tok** |
| **Locate + show a symbol** | `slice` **14 tok** (exact body) | `rg` locate **103 tok** (location only) | `outline` (location only) |
| **Co-change / hidden coupling** | `coupled` **60 tok** (incl. HIDDEN COUPLING) | `git log` scripting ~**5 tok** (found none in window) | n/a |
| **Cross-project** (sibling repo) | ⛔ **impossible** — silently returns *this* repo's map; sibling skeleton "not found" | ✅ any path | ✅ any path (verified on sibling `index.ts`) |
| **Cross-session recall** | ✅ `search`/`timeline`/`latest` (unique) | ⛔ impossible | ⛔ impossible |

## Verdict by use case

**1. Context-browsing / understanding the codebase — native wins.**
`ast-grep outline` beats the substrate `skeleton` on both cost (**1,079 vs 1,583 tok**) and portability. Substrate `repomap` is cheaper than `outline src` (1,337 vs 1,826 tok) and adds PageRank ranking, but it only sees *this* project. For a multi-project reality (you also run `hivemind-steward-oc-devin-dev`), the substrate is strictly worse: it cannot look outside its own root.

**2. Code/test intelligence — mixed, no moat.**
`slice` (14 tok) is a real convenience over `rg`+`sed` for pulling an exact symbol body. But `rg`+`sed` and `ast-grep` replicate it natively and everywhere. The one genuine differentiator is **`coupled`** — temporal co-change and HIDDEN COUPLING that native tools only reach with hand-rolled git scripting. Caveat: on this repo `coupled` claimed a `plugin.ts ↔ index.ts` link that native `git log` over a wider window did not reproduce — a reliability question, not a win.

**3. Token saving — modest and not unique.**
The substrate's big ratios (full file → skeleton) assume the baseline is a full read. A competent agent already reads bounded; measured against `rg`/`ast-grep`, the substrate's structural tier saves little or nothing. The real token lever is the **freshness ledger** (don't re-read across a long session) — which only pays off over many steps and is unproven here.

**4. Time-machine across sessions — unique, unproven.**
No native equivalent exists. But only **1 root session** is indexed, and `search` returned the current session regardless of query — indistinguishable from `latest`. The capability is real on paper, unverified in practice.

**5. 40+ delegations / 10+ compactions — unproven, and this is the whole point.**
Observed: **0 delegations**, **0 compactions**. The delegation-outcome classifier never ran; the compaction packet never surfaced. The scale you care about most is the least exercised.

## Bottom line

- **For code understanding today, native (`rg` + `ast-grep` + `git`) is easier, cheaper, and works on every project.** The substrate's structural tier is not a moat; a native toolchain matches or beats it, and the substrate cannot leave its own repo root.
- **The substrate's only defensible reasons to exist are the time/session dimensions**: cross-session recall, survive-compaction continuity, and not re-reading across long sessions. Those are exactly the dimensions that are **unproven** in this environment.
- **Therefore, on this project, the substrate is currently a net negative vs bashing**: added install, stale archive, two-ledger confusion, human-invisible output, and per-project lock-in — against savings that a native toolchain already provides.

## What would change the verdict

- A **multi-session, multi-delegation, post-compaction drive** proving the time/session dimension (the thing native tools cannot do).
- **Cross-project operation** (or an honest statement that it is single-root by design).
- **One human-legible surface** (CLI exists but is undiscoverable) so the value reaches the stakeholder, not just the agent.

## Boundaries

No code, config, or tooling was installed or changed; `ast-grep` was exercised via `bunx` only. Measurements are point-in-time on this repo.
