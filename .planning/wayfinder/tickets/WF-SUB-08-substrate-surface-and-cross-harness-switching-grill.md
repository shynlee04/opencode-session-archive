# WF-SUB-08: Owner Grill Gate on Unified Plugin Surface, Cross-Harness Switching & ADR Lock

- **ID:** `WF-SUB-08`
- **Labels:** `wayfinder`, `wayfinder:grilling`
- **Status:** `resolved (owner approved)`
- **Depends on:** `WF-SUB-01`, `WF-SUB-02`, `WF-SUB-03`, `WF-SUB-04`, `WF-SUB-05`, `WF-SUB-06`, `WF-SUB-07`
- **Evidence Input:** Prototype outputs from `WF-SUB-01..07` + [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md), [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md)

## Question

Once prototypes `WF-SUB-01..07` have been demonstrated against the real session exports (`ses_eb2eabb14ffeCXsCwb845rtffb`, `ses_eb23bfbf0ffesn5kT0yJI06h35`) and `.session-archive/index.sqlite`:
1. Does the owner approve the **2-tool hybrid surface (`substrate` + `viewport`)** and the high-level natural-language workflow for cross-harness switching (`OpenCode <-> Devin <-> Antigravity`)?
2. Should `hivemind-substrate` auto-thin steps older than `K` (`keepRecentSteps = 12`) when estimated context exceeds `65%` of the model window, or remain strictly tool-triggered (`substrate({ action: "prune" })`)?
3. Are proposed [`ADR-001`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-001-three-layer-context-substrate.md), [`ADR-002`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-002-step-watermark-valve-and-breadcrumb-handles.md), and [`ADR-003`](file:///Users/MAC/Documents/coding-projects/hivemind-substrate/.planning/architecture/ADR-003-bun-native-codebase-structural-graph.md) approved to lock into `accepted` status and transition into Phase 1 `SPEC.md` (`to-spec`)?

## Owner Resolution (2026-10-18)

- **Q1 (`OK but ;` — Unified 2-Tool Surface + Backwards-Compatible Aliases):**
  - Approved the unified two-tool surface under the `substrate` namespace (`substrate.valve` and `substrate.viewport`), while **preserving backwards-compatible delegating aliases** for `archive.persist` and `ctx.context-prune` (plus direct `substrate` / `viewport` action multiplexing) so existing prompts, skills, and agent habits never fail when calling legacy tool names.
  - `sessionID` is optional across all actions and defaults deterministically via `resolveDefaultSessionId(db, input.sessionID, hookContext)` (`explicit_input -> hook_context -> sqlite_latest_root`).
- **Q2 (`yes` — Hybrid Step-Watermark Activation):**
  - Approved hybrid activation:
    1. Explicit tool call via `substrate.valve({ mode: "step-window", keepRecentSteps: 8 })` (with automatic step-window fallback in `"recent"` mode when `lastUserIndex <= activeStartIndex` and `assistantStepsAfterLastUser > 8`).
    2. Automatic watermark activation inside `ctx.session.hook("context", ...)` when estimated input tokens exceed `65%` of the model context window (`keepRecentSteps = 12`), replacing thinned tool outputs with content-addressed `FactBreadcrumb`s and a `WorkingMemoryManifest`.
- **Q3 (`Yes, Then 4` — Lock ADRs & Export Cross-Harness Brief Helper):**
  - Approved locking `ADR-001`, `ADR-002`, and `ADR-003` into `accepted` status following independent `spec-review`, and exporting `buildImplementorViewportBrief(db, options)` as a pure deterministic helper for `delegate-devin` / `hivemind-delegate` child spawns.
