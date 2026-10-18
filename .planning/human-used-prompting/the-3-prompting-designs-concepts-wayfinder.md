
Here is the **PM + Architect audit** of your raw directives against the live state of `.worktree/wave2-slice1` (`lane/wave2-slice1`), followed by the **sequenced, gated prompt chain** (`Prompt 0 -> Gate 0 -> Prompt 1 -> Gate 1 -> Prompt 2 -> Gate 2 -> Prompt 3`).

---

## 1. Live Disk Recon & PM / Architect Audit

- **Live state on disk ([`STATE.md`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/STATE.md), [`.audit/2026-10-17-wave2-slice1-mh27-repair/run.md`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.audit/2026-10-17-wave2-slice1-mh27-repair/run.md)):**
  - **Step 1 (`MH-27` / `#92`) is already DONE and merged** at `d37bf7d` (`e54d7a9` HEAD), with 2-axis review `PASS` and 1531 passing tests.
  - **Step 2 (`MH-24` / `#95`) is actively in flight** in the working tree ([`src/delegation/catalog-publish.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/src/delegation/catalog-publish.ts), [`src/delegation/delegate-tool.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/src/delegation/delegate-tool.ts), [`test/hivemind-delegate.test.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/test/hivemind-delegate.test.ts)).
  - **Steps 3 & 4 (`MH-26` `#91`, `SET-08` `#96`, build/wire checkpoint)** are next in the active team's queue.
- **Scope & Seam Classification (`product-manager` + `architect`):**
  1. **OpenCode as Control Plane, Harness as Execution Engine:** Already matches the settled `ACP + explicit bridges` direction in [`E2.5` (`native-session-host-bridges/SPEC.md`)](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.planning/phases/native-session-host-bridges/SPEC.md). Parentless main sessions (**Native root sessions**) and delegated children (**Native children**) belong to `E2.5` + `E3.2`, not a competing spec.
  2. **Permission & Policy Mediation (`allow`, `deny`, `ask`, `auto`):** *Spec Amendment + Architectural Deepening* on [`ADR-006`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.planning/architecture/ADR-006-native-delegation-driver-seam.md), [`ADR-009`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.planning/architecture/ADR-009-native-child-session-policy.md), `REQ-HARN-27`, and `REQ-NBR-03`. Bridging foreign `session/request_permission` to OpenCode's `Permission.Service` (`Native ask` with session-persisted `always` grants) turns OpenCode's permission layer into an evidenced **Foreign coverage channel** (`NativeForeignCoverageChannel`) so scoped roles and interactive `ask -> allow` policies work without pre-prompt refusals.
  3. **Zero-Hardcode Provider/Model & Downstream Schema Mapping:** *Refactor + Spec Amendment* on `REQ-HARN-26` / `REQ-NBR-08`. Today [`src/delegation/catalog-publish.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/src/delegation/catalog-publish.ts#L73-L85) hardcodes `limit: { context: 200_000, output: 32_000 }` and capabilities. However, the team must **verify what `devin acp` and `agy_acp_server.par` actually report on the wire or in binary metadata** vs. what must come from OpenCode config overrides, and must **never fabricate model ID rewrites** (e.g., Devin's wire uses `model` + `thought_level` `#variant`, whereas Antigravity encodes effort in the model ID).
  4. **Foreign Tool & Foreign Delegation (`subagent`) Rendering:** *Spec Amendment* on `REQ-HARN-15` ([`multi-harness-delegation/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.planning/phases/multi-harness-delegation/SPEC.md)) and `E2.5` ([`native-session-host-bridges/SPEC.md`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/.planning/phases/native-session-host-bridges/SPEC.md)) around [`src/delegation/native-observations.ts`](file:///Users/MAC/Documents/coding-projects/hivemind-steward-oc-devin-dev/.worktree/wave2-slice1/src/delegation/native-observations.ts) so foreign subagent/spawn tool calls render as OpenCode `subagent` tool cards and shared primitives (`edit`, `read`, `write`, `bash`, `mcp`, skills, slash commands) normalize cleanly across Harnesses.

---

## 2. Sequenced Prompt Chain

### Stage 0: Let the In-Flight Wave 2 Slice 1 Team Finish Cleanly
If your current team is still running Steps 2–4, let them finish, or send **Prompt 0** below to close out the current lease cleanly before starting the architectural realignment.

```markdown
### Context Anchor & Mode
- **Worktree / Branch:** `.worktree/wave2-slice1` (`lane/wave2-slice1`)
- **Mode:** In-flight Wave 2 Vertical Slice 1 completion (`STATE.md`, `.audit/2026-10-17-wave2-slice1-mh27-repair/run.md`).
- **Verified State on Disk:** Step 1 (`MH-27` / `#92` permission-provenance repair) is merged at `d37bf7d` (`e54d7a9`) with 2-axis review `PASS` and 1531 passing tests. Step 2 (`MH-24` / `#95` repair in `src/delegation/catalog-publish.ts`, `src/delegation/delegate-tool.ts`, `test/hivemind-delegate.test.ts`) is currently uncommitted in the working tree. Untracked `.opencode/plugins/context-prune.ts` is an owner file and must remain unstaged.

### Objective
Finish the remaining Wave 2 Vertical Slice 1 sequence (Steps 2, 3, and 4) cleanly and release all source writer leases so the repository is at a verified green checkpoint for the next architectural alignment round.

### Ordered Execution Steps
1. **Complete Step 2 (`MH-24` / `#95`):** Finish the consolidated repair in `src/delegation/catalog-publish.ts`, `src/delegation/delegate-tool.ts`, and `test/hivemind-delegate.test.ts` (following the 2-axis Standards and Spec reviews across `git diff 385b38e...f722d7c`), run `bun test ./test/model-slots.test.ts ./test/hivemind-delegate.test.ts ./test/nd17-registration.test.ts ./test/antigravity-delegate.test.ts ./test/acp-session-core.test.ts`, and land as an atomic commit.
2. **Complete Step 3 (`MH-26` / `#91`, then `SET-08` / `#96`):**
   - Implement, test (RED -> GREEN), 2-axis review (`delegate-devin` for Standards, `hivemind-delegate` with `harness: "antigravity"` for Spec), and atomically commit `MH-26` (continuation catalog-drift pause + four-state settings receipts) after the shared native-driver writer releases.
   - Implement, test (RED -> GREEN), 2-axis review, and atomically commit `SET-08` (named-stale retirement of raw `thinking`/`hosted.*` config) after `MH-24`.
3. **Complete Step 4 (Checkpoint Build & Wire):**
   - Run `bun run check-baseline`, root `bun test`, and `bun run typecheck`.
   - Run `bun run local-build` once and wire the resulting snapshot into project-local `opencode.json`.
   - Update `STATE.md`, `.planning/phases/multi-harness-delegation/TICKET-INDEX.md`, and the active `.audit/` handoff. Keep `.opencode/plugins/context-prune.ts` unstaged and untouched. Report runtime dogfooding and owner TUI UAT as pending until observed after owner reload.

### Mandatory Pushback Rule
Verify every file state and test result against disk before committing. If `MH-26` or `SET-08` exposes a contradiction with the landed `MH-27` or `MH-24` seams, **STOP execution of that slice and return an evidence-backed counter-proposal** naming the exact `file:line` conflict rather than forcing a workaround.

### Verifiable Exit Gate (Gate 0 -> 1)
- `MH-27`, `MH-25`, `MH-24`, `MH-26`, and `SET-08` are all committed on `lane/wave2-slice1` with their single RED log, GREEN log, and review artifact.
- `bun run check-baseline`, root `bun test`, and `bun run typecheck` exit `0`.
- `bun run local-build` is wired in `opencode.json`, all writer leases are released, and `git status -s` is clean (except untracked owner file `.opencode/plugins/context-prune.ts`).
```

---

### Stage 1: Architectural Recon & `/grill-with-docs` (ADRs, `GLOSSARY.md`, `PROJECT.md`, `ROADMAP.md`)
**Send Prompt 1 only after Gate 0 passes.** This covers your Item `2.1` (shaping the codebase design through `grill-with-docs`, updating ADRs, `GLOSSARY.md`, `PROJECT.md`, and `ROADMAP.md`).

```markdown
### Context Anchor & Mode
- **Worktree / Branch:** `.worktree/wave2-slice1` (`lane/wave2-slice1`) after Wave 2 Vertical Slice 1 (`MH-27`, `MH-25`, `MH-24`, `MH-26`, `SET-08`) is green and wired.
- **Role:** Chief Architect & Product Strategist. Load `ultra-mode`, `grill-with-docs`, `architect`, `codebase-design`, `domain-modeling`, `wayfinder`, and `project-skeleton`.
- **Delegation posture:** Use `delegate-devin` and `hivemind-delegate` (`harness: "antigravity"`) for parallel read-only codebase and wire-contract probes; keep root context lean.

### Objective & Epistemic Frame
We are shifting the architecture to establish **OpenCode as the unified control and UX/UI plane** (for human operators, main-session agents, and delegated subagents) while **each foreign ACP Harness owns project execution** (files, code, tests, and foreign tool loops), structured so adding future ACP Harnesses is scale-agnostic.

#### Verified Facts on Disk
1. `E2.5` (`.planning/phases/native-session-host-bridges/SPEC.md` and `TICKET-INDEX.md`) already specifies `ACP + explicit bridges`, `NBR-01` (shared confirmed config/catalog leaf), and gated Layers 1–4 (`Native root session` binding, role/skill/attachment delivery, command bridge, and blocked `Host-mediated MCP access`).
2. `src/delegation/catalog-publish.ts:73-85` currently projects observed models into `<id>-native` providers with hardcoded `limit: { context: 200_000, output: 32_000 }` and static capability literals.
3. `src/delegation/scope-admission.ts` and `src/delegation/native-delegation.ts:2799-2845` currently assume delegated children run in unconditional `bypass` (Devin) or `yolo` (Antigravity) with `channels: []` (`fs: false, terminal: false` in `src/acp.ts`), refusing any role/operator/session `deny` rule before `session/prompt`.
4. `src/delegation/native-observations.ts` emits `providerExecuted: true` `ToolPart` rows for `edit`/`read`/generic `<harness>-observation`, but does not normalize foreign subagent/delegation tool calls into OpenCode `subagent` tool cards or unify all core tool categories across Harnesses.

#### Unverified Hypotheses & Design Proposals to Probe Before Locking
1. **Provider/Model & Downstream Schema Normalization:** Whether `<harness>/<model>[#variant]` (e.g., `devin/swe-2#max`) should be supported alongside or aliased to `<harness>-native/<model>[#variant]`, and how much model metadata (reasoning effort facets, context/output token limits, input modalities) can be dynamically read from each Harness's ACP server (`session/new` `configOptions` / `_meta`) and local binary/manifest versus OpenCode `opencode.json` model overrides—without ever fabricating model IDs or hardcoding static lists.
2. **Permission & Policy Mediation (`allow`, `deny`, `ask`, `auto`):** Whether OpenCode project (`opencode.json`), global-user (`~/.config/opencode/opencode.json`), per-agent (`agents.<id>.permissions`), and per-session (`session.permissions`) rules (`allow`, `deny`, `ask`, `auto`) can govern foreign execution by selecting the matching foreign session mode (asking mode vs. `bypass`/`yolo` for `auto`) and mediating foreign `session/request_permission` wire requests through OpenCode's `Permission.Service` (`Native ask`)—so when a user selects `allow` (`always`) in the OpenCode dialog once, it persists for the session (`session.permissions` + foreign `allow_always`) and acts as an evidenced `Foreign coverage channel` (`NativeForeignCoverageChannel`) without false pre-prompt refusals or runtime deadlocks.
3. **Main-Session (`Native root session`) & Foreign Tool / `subagent` Rendering:** How a Harness running as a main-session agent (`Native root session`) or `Native child` maps its foreign tool executions onto OpenCode's agreed core tool cards (`edit`, `read`, `write`, `bash`/shell, `mcp`, skills, slash commands), maps foreign internal delegation/subagent calls onto OpenCode `subagent` tool cards, and renders unclassified foreign tools cleanly.
4. **Scale-Agnostic Deepening for N Harnesses:** Where `devin` or `antigravity` specifics still leak outside `src/harness-profile.ts`, `src/harness-antigravity.ts`, and `src/wire-dialect.ts`.

### Curated Context Pointers (Reading Budget)
- **Anchor (Read first):** `STATE.md`, `GLOSSARY.md`, `.planning/ROADMAP.md`, `.planning/PROJECT.md`, `.planning/phases/native-session-host-bridges/SPEC.md`, `.planning/phases/ native-session-host-bridges/TICKET-INDEX.md`.
- **Zoom-in targets (Delegate to read-only probes):**
  - Probe A (Provider/Model & Schema): `src/acp-session-core.ts`, `src/delegation/catalog-publish.ts:1-193`, `src/delegation/model-slots.ts`, `src/harness-profile.ts`, `src/harness-antigravity.ts`.
  - Probe B (Permissions & Modes): `src/delegation/scope-admission.ts`, `src/delegation/delegate-tool.ts:1130-1180`, `src/delegation/native-delegation.ts:2400-2850`, `.planning/architecture/ADR-006-native-delegation-driver-seam.md:1068-1185`, `.planning/architecture/ADR-009-native-child-session-policy.md:482-566`.
  - Probe C (Tool & `subagent` Observation Rendering + Root Sessions): `src/delegation/native-observations.ts`, `src/delegation/native-inputs.ts`, `src/acp.ts`.
- **Do not bulk-read in root:** Full test files or historical `.audit/` folders.

### Execution Protocol & Evidence-First Pushback Mandate
1. **Dispatch bounded read-only probes** (`delegate-devin` and `hivemind-delegate` with `harness: "antigravity"`) to gather `file:line` facts and pinned OpenCode `v2.0.31` host-contract facts across Probes A, B, and C.
2. **Mandatory Pushback Rule:** *Verify the hypotheses and seam assumptions above against `file:line` and pinned OpenCode V2 / ACP wire schemas before proposing ADR or Glossary changes. If a premise contradicts wire reality (for example, if an ACP binary does not expose context window limits on the wire, or if rewriting `swe-2#max` would violate truthful wire model IDs), or if a proposed change would create a mudball or weaken fail-closed security, **STOP and present the discriminating evidence and a counter-proposal** during the grill.*
3. **Run `/grill-with-docs` with the owner:** Walk through the resolved decision tree for (a) Provider/Model + Schema/Limit resolution, (b) Permission mediation (`allow`/`deny`/`ask`/`auto` + session persistence), (c) Main-session (`Native root session`) + foreign tool & `subagent` card normalization, and (d) Scale-agnostic `HarnessProfile` boundaries and the Wave 2 ship-ready scope vs. Wave 3/4.
4. **Write authorized design artifacts only after owner ratification in the grill:**
   - Record the decision packet in `.audit/<date>-opencode-control-architecture/decision-packet.md`.
   - Update `GLOSSARY.md`, inline dispositions on `ADR-006` / `ADR-009` (or a new ADR if approved), `.planning/decisions.tsv`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `STATE.md`.
   - Commit the documentation/planning updates atomically using `atomic-git-commit`.

### Scope Boundaries & Non-Goals
- **In scope:** Read-only code/wire probes, interactive `/grill-with-docs` interview, and ratified updates to `ADR-*`, `GLOSSARY.md`, `.planning/decisions.tsv`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `STATE.md`.
- **Out of scope for Prompt 1:** Editing `src/**` or `test/**`, amending phase `SPEC.md` files, or creating/modifying ticket files (those belong to Prompt 2 after ADR/Glossary lock).

### Verifiable Exit Gate (Gate 1 -> 2)
- Owner has ratified the `/grill-with-docs` decision packet in `.audit/<date>-opencode-control-architecture/decision-packet.md`.
- `GLOSSARY.md`, `ADR-*`, `.planning/decisions.tsv`, `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `STATE.md` are updated and committed cleanly with zero uncommitted changes in `.planning/**`.
```

---

### Stage 2: Upstream Impact Audit, Spec Amendments (`/to-spec` + `spec-review`), and Wave 2 Ship-Ready Ticket Slicing (`/to-tickets`)
**Send Prompt 2 after Gate 1 passes.** This covers your Items `2.2`, `2.3` (planning/ticket realignment), and `2.4` (thinning the skeleton into new spec phases only if anything falls outside the 4 waves).

```markdown
### Context Anchor & Mode
- **Worktree / Branch:** `.worktree/wave2-slice1` (`lane/wave2-slice1`)
- **Mode:** Post-grill specification and ticket realignment.
- **Anchor Artifacts:** Read `STATE.md`, `.audit/<date>-opencode-control-architecture/decision-packet.md`, `GLOSSARY.md`, `.planning/ROADMAP.md`, `.planning/PROJECT.md`, and the latest inline dispositions in `ADR-006` / `ADR-009`.
- **Role:** Spec Author & Ticket Planner. Load `ultra-mode`, `to-spec`, `spec-review`, `to-tickets`, and `project-skeleton`.

### Objective & Epistemic Frame
Translate the ratified `/grill-with-docs` decision packet into:
1. An **Upstream Impact Audit** of already-landed code and tests (Wave 1 `MH-28` and Wave 2 Slice 1 `MH-25`, `MH-27`, `MH-24`, `MH-26`, `SET-08`), classifying every affected seam as a **Bug**, **Spec Gap**, **Refactor**, or **Spec Amendment**.
2. **In-place Spec Amendments** across the authoritative specs (`.planning/SPEC.md`, `.planning/phases/multi-harness-delegation/SPEC.md`, `.planning/phases/native-session-host-bridges/SPEC.md`, `.planning/phases/delegation-setup-configuration/SPEC.md`), verified by an independent `spec-review` seat (`PASS` required before ticketing).
3. **Downstream Wave 2 Ship-Ready Ticket Slicing & Sync:** Realign and slice the upstream gap/bug repairs plus the Wave 2 native vertical (`E3.2` `multi-harness-delegation` and `E2.5` `native-session-host-bridges` `NBR-01` + unlocked layers) into thin, self-contained, scale-agnostic vertical-slice tickets so **Wave 2 finishes ship-ready** (complete native main-session + child-delegation control, mediated `allow`/`deny`/`ask`/`auto` permissions, dynamic server/binary model/schema projection, and normalized tool + `subagent` observation rendering). Reconcile Wave 3 (`E2.3` `DSH` / `E4.1` `HCI`) and Wave 4 (`MH-29` / `WF-20`) as gradual adjustments, and allocate thin skeleton phases only for capabilities that genuinely sit outside the 4 waves.

### Curated Context Pointers (Reading Budget)
- **Anchor (Read first):** `.audit/<date>-opencode-control-architecture/decision-packet.md`, `GLOSSARY.md`, `.planning/ROADMAP.md`, `.planning/phases/multi-harness-delegation/TICKET-INDEX.md`, `.planning/phases/native-session-host-bridges/TICKET-INDEX.md`.
- **Specs to amend (Read targeted sections):**
  - `.planning/SPEC.md` (`REQ-NDEL-06`, `REQ-NDEL-08`)
  - `.planning/phases/multi-harness-delegation/SPEC.md` (`REQ-HARN-03`, `REQ-HARN-09`, `REQ-HARN-15`, `REQ-HARN-26`, `REQ-HARN-27`, `REQ-HARN-28`)
  - `.planning/phases/native-session-host-bridges/SPEC.md` (`REQ-NBR-01..20`)
  - `.planning/phases/delegation-setup-configuration/SPEC.md`
- **Delegate to subagents (`delegate-devin` / `hivemind-delegate`):** Send the upstream code/test impact scan (`src/acp-session-core.ts`, `src/delegation/catalog-publish.ts`, `src/delegation/scope-admission.ts`, `src/delegation/native-delegation.ts`, `src/delegation/native-observations.ts`, `src/delegation/delegate-tool.ts`) and the independent `spec-review` pass to subagents.

### Execution Protocol & Evidence-First Pushback Mandate
1. **Upstream Impact Census:** Audit landed Wave 1 and Wave 2 Slice 1 modules against the ratified decision packet. Record each finding with exact `file:line`, classification (*Bug* / *Spec Gap* / *Refactor* / *Spec Amendment*), and owning phase.
2. **Mandatory Pushback Rule:** *Verify every claimed upstream gap or downstream dependency against `file:line` and existing ticket contracts before amending specs or slicing tickets. If a proposed ticket would break scale-agnostic boundaries, duplicate an existing ticket (`MH-24..28`, `SET-08`, `NBR-01`), or violate a hard safety gate (such as unproved `V10`/`V11` MCP public-API safety), **STOP on that item and report the evidence-backed conflict** rather than fabricating a spec waiver or competing phase.*
3. **In-Place Spec Amendments (`/to-spec`) & Independent Review (`spec-review`):**
   - Amend only the affected requirement rows in their owning `SPEC.md` files (never create a competing feature spec for a gap or refactor).
   - Run `python3 -B .planning/phases/devin-native-delegation/reviews/check-spec.py` (where applicable) and dispatch an independent `spec-review` subagent. Apply at most one bounded repair until `spec-review` returns `PASS`.
4. **Tracer-Bullet Ticket Slicing (`/to-tickets`) & Tracker Sync:**
   - Create or update the bounded `plans/` and vertical-slice ticket files under `.planning/phases/multi-harness-delegation/tickets/` and `.planning/phases/native-session-host-bridges/tickets/` so each slice is independently testable, scale-agnostic across Harnesses, and ordered by real blocking dependencies + shared-file writer leases.
   - Ensure Wave 2 (`E3.2` + `E2.5`) covers the ship-ready native main + child journey, while Wave 3 (`DSH` / `HCI`) and Wave 4 (`MH-29` / `WF-20`) reflect gradual follow-on adjustments.
   - If any scope remains outside the 4 waves (e.g., onboarding a 3rd ACP Harness after Devin and Antigravity), use `/project-skeleton` to record a thin phase row in `.planning/ROADMAP.md` with canonical naming.
   - Synchronize every new or updated ticket to GitHub Issues (`shynlee04/hivemind-steward-oc-devin-dev`) via `gh` CLI with `ticket` + `phase:<slug>` labels (`docs/agents/issue-tracker.md`) and verify read-back equality.
   - Commit all spec, plan, ticket, and skeleton artifacts atomically via `atomic-git-commit`.

### Scope Boundaries & Non-Goals
- **In scope:** Upstream code/test impact audit, `SPEC.md` amendments, independent `spec-review`, `plans/` and `tickets/` creation/updates, GitHub issue sync, and `.planning/ROADMAP.md` / `STATE.md` updates.
- **Out of scope for Prompt 2:** Production `src/**` or `test/**` implementation changes (those run in Prompt 3's TDD loop).

### Verifiable Exit Gate (Gate 2 -> 3)
- Independent `spec-review` receipt on all amended `SPEC.md` files is `PASS` and recorded in `.audit/<date>-opencode-control-architecture/spec-amendment-review.md`.
- Every Wave 2 upstream-repair and downstream vertical-slice ticket exists on disk, is indexed in its phase `TICKET-INDEX.md`, and is synchronized with GitHub Issues via `gh` CLI.
- `.planning/ROADMAP.md`, `.planning/PROJECT.md`, and `STATE.md` reflect the exact Wave 2 ship-ready ticket DAG and any post-Wave-4 thin skeleton phases; `git status -s` has zero uncommitted `.planning/**` changes.
```

---

### Stage 3: Wave 2 Ship-Ready Execution Loop (`/implement-spec` + `/tdd` + `/code-review` + Checkpoint Build/Wire)
**Send Prompt 3 after Gate 2 passes** to execute the realigned Wave 2 vertical slices to ship-ready completion.

```markdown
### Context Anchor & Mode
- **Worktree / Branch:** `.worktree/wave2-slice1` (`lane/wave2-slice1`, or child lanes under `.worktree/<lane>` created from the approved base per `AGENTS.md`).
- **Mode:** Multi-slice TDD execution of the realigned Wave 2 frontier (`implement-spec`, `tdd`, `code-review`, `atomic-git-commit`, `verify-work`).
- **Anchor Artifacts:** `STATE.md`, `.planning/ROADMAP.md`, `.planning/phases/multi-harness-delegation/TICKET-INDEX.md`, `.planning/phases/native-session-host-bridges/TICKET-INDEX.md`, and `.audit/<date>-opencode-control-architecture/decision-packet.md`.

### Objective
Execute the approved Wave 2 vertical-slice tickets (upstream repairs + OpenCode permission mediation + dynamic provider/model/schema projection + native root-session & foreign tool/`subagent` observation rendering) to a **ship-ready Wave 2 checkpoint**, using isolated worktrees for parallel non-overlapping slices, strict RED -> GREEN -> REFACTOR TDD, one independent 2-axis `code-review` (`delegate-devin` + `hivemind-delegate` with `harness: "antigravity"`) and at most one consolidated repair per slice, followed by a single integrated build and `opencode.json` wire checkpoint for dogfooding and owner TUI UAT.

### Execution Protocol & Evidence-First Pushback Mandate
1. **Baseline & Lease Check:** Run `bun run check-baseline` first. Map the Wave 2 ticket DAG and shared-file writer leases (`src/acp-session-core.ts`, `src/delegation/catalog-publish.ts`, `src/delegation/scope-admission.ts`, `src/delegation/native-delegation.ts`, `src/delegation/native-observations.ts`, `src/delegation/delegate-tool.ts`) in `.audit/<date>-wave2-ship-ready/run.md`. Parallelize only across disjoint write sets in `.worktree/<lane>` worktrees.
2. **Per-Slice Loop (`implement` + `tdd` + `code-review`):**
   - Write a meaningful RED test at the public seam proving the slice's invariant across both `devin` and `antigravity` dialects/profiles (save one `<ticket>-red.log`).
   - Implement the minimal scale-agnostic GREEN change with zero hardcoded vendor model lists and zero per-Harness copies outside `HarnessProfile` / `WireDialect` (save one `<ticket>-green.log`).
   - Run one independent 2-axis `code-review` (`delegate-devin` for Standards, `hivemind-delegate` with `harness: "antigravity"` for Spec), apply at most one consolidated repair, re-verify `bun test` + `bun run typecheck`, and land an atomic git commit (`src/**` + `test/**` together, `.planning/**` + `.audit/**` with proper labels) before releasing the writer lease.
3. **Mandatory Pushback Rule:** *If any slice encounters an unresolvable host-contract block in pinned OpenCode `v2.0.31` or an ACP wire limitation on `devin` or `antigravity`, **STOP that slice immediately and report the exact `file:line` and wire evidence** rather than weakening permission safety, hardcoding fake catalog data, or bypassing tests.*
4. **Wave 2 Ship-Ready Checkpoint & Handoff:**
   - Merge verified sub-lanes back into the Wave 2 integration branch and clean up merged sub-worktrees.
   - Run `bun run check-baseline`, full root `bun test`, and `bun run typecheck`.
   - Run `bun run local-build` and wire the new snapshot into project-local `opencode.json`.
   - Update `UAT.md`, `STATE.md`, `TICKET-INDEX.md`, and write `.audit/<date>-wave2-ship-ready/handoff.md` with point-to evidence for owner reload, live dogfooding (`delegate-devin`, `hivemind-delegate`, and main-session `<harness>-native/<model>`), and conversational UAT.

### Scope Boundaries & Non-Goals
- **In scope:** Approved Wave 2 vertical-slice tickets (`E3.2` + unlocked `E2.5` slices), unit/wire/render tests, 2-axis reviews, atomic commits, and project-local snapshot build/wiring.
- **Out of scope:** Wave 3 hosted-only adjustments (`DSH`/`HCI`), Wave 4 (`MH-29`/`WF-20`), unapproved `V10`/`V11` MCP production commitments without an isolated proof, live spend/auth without a per-run envelope, or closing GitHub issues before owner UAT.

### Verifiable Exit Gate
- All scoped Wave 2 tickets have RED log, GREEN log, and 2-axis review receipts under `.audit/<date>-wave2-ship-ready/`.
- Root `bun test`, `bun run typecheck`, and `bun run check-baseline` exit `0`.
- `bun run local-build` snapshot is wired in `opencode.json`, `git status -s` is clean (preserving untracked owner files), and `.audit/<date>-wave2-ship-ready/handoff.md` is ready for owner reload and UAT.
```