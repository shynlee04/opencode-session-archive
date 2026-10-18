# The Box of Context & Viewport Architecture

To build a high-performance, local-first context substrate for OpenCode that tames "vibe coding" and prevents hallucinations across long-running multi-agent sessions, we must start from the physics of the model's working memory: **The Box of Context**.

I have initialized your dedicated teaching workspace and generated **Lesson 0001** and **Reference 0001**:

* **Workspace Mission:** Grounded in `MISSION.md`
* **Reference Cheat Sheet:** `reference/0001-context-viewports-cheat-sheet.html`
* **Self-Contained Lesson:** `lessons/0001-the-box-of-context-and-viewports.html`
* **Learning Record:** `learning-records/0001-context-viewports-mental-model.md`

Here is the high-level architectural walkthrough to ground your MVP design.

---

## 1. The Core Physics: The "Box of Context" & The Attention Tax

An LLM does not explore a codebase the way a human engineer navigates an IDE. It sees only a single, flat, linear token buffer.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        THE "BOX OF CONTEXT"                            │
├────────────────────────────────────────────────────────────────────────┤
│ [System Prompt & Invariants]                                           │
│ [Ambient Topological Map (< 1,000 tokens)]                             │
│ ────────────────────────────────────────────────────────────────────── │
│ [Recent Dialogue & Active Task Brief]                                  │
│ [JIT Leaf Code Snippet (Target Lines Only)]                            │
│ ────────────────────────────────────────────────────────────────────── │
│ ⚠️ ATTENTION HAZARD ZONE (Do NOT Dump Here!):                          │
│    ❌ Raw compiler stack traces & full bash logs                        │
│    ❌ 40-turn foreign subagent dialogue transcripts                    │
│    ❌ 50-file unparsed implementation bodies                           │
└────────────────────────────────────────────────────────────────────────┘

```

1. **Attention Dilution:** Transformer attention heads have finite resolution over long contexts. Dumping noisy compiler outputs, raw git diffs, or unparsed file bodies extracts an *Attention Tax*. The probability of the model respecting subtle architectural constraints drops precipitously as raw tokens pile up.
2. **The Compaction Wall:** When a long session crosses its context threshold, the host truncates or summarizes prior turns. After 5 compactions across 40 completed tasks, detailed historical nuance is obliterated. The agent is left with vague summaries and begins hallucinating previous decisions.
3. **The Vibe-Coder Dynamic:** Vibe coders prompt rapidly, pivot frequently, and maintain zero session documentation. If the agent operates without rigid structural boundaries, it fills the ambiguity with "fearless scope creep," touching unrelated files and turning the architecture into an untangled ball of mud.

---

## 2. Swarms vs. Specialist Delegation Loops

Many early multi-agent frameworks relied on "graphical fanout" or "conversational swarms" where agents chatter directly with one another. On real software projects, this collapses:

```
NAIVE SWARM (High Entropy, Quadratic Noise):
  [Agent A] <--- chatter ---> [Agent B]
      ^                            ^
      |--- chatter ---> [Agent C]--|
  (Result: Context saturation, echo-chamber hallucinations, zero clear ownership)

STRUCTURED DELEGATION LOOP (Zero Cross-Talk, Controlled Boundary):
  [USER (Vibe Coder)]
          │ (Natural-language intent)
          ▼
  [ORCHESTRATOR / STRATEGIST] ◄── [ARTIFACTS: AGENTS.md, Specs, Acceptance Gates]
          │
          ├──────────────────────────┬──────────────────────────┐
          ▼ (Scoped Brief)           ▼ (Scoped Brief)           ▼ (Scoped Brief)
    [HARNESS: Devin]         [HARNESS: Antigravity]     [LOCAL: Fast Specialist]
          │                          │                          │
          └──────────────────────────┴──────────────────────────┘
                                     │
                                     ▼ (Standardized Handoff Envelope)
                            [VERIFICATION GATE]
                     (Tests Pass? Spec Satisfied?)

```

* **Zero Peer-to-Peer Cross-Talk:** Subagents never message each other directly. All interactions route through the Orchestrator.
* **Trajectory Isolation:** When an ACP child (Devin or Antigravity) takes 20 turns to fix a bug, those 20 turns stay inside that child’s foreign trajectory. They must **never** enter the parent’s context window.
* **Standardized Completion Envelopes:** Subagents report back only a budgeted handoff payload:

```json
{
  "child_session_id": "oc_child_9412",
  "harness": "antigravity",
  "status": "COMPLETED",
  "summary_digest": "Implemented JWT validation with RS256 algorithm. Added token expiration checks in auth_middleware.ts.",
  "files_touched": [
    { "path": "src/auth/jwt.ts", "action": "CREATED", "lines_added": 45 },
    { "path": "src/middleware/auth.ts", "action": "MODIFIED", "lines_diff": 12 }
  ],
  "verification": {
    "command": "npm test test/auth.test.ts",
    "exit_code": 0,
    "summary": "14 tests passed, 0 failed"
  },
  "lineage": {
    "parent_id": "oc_parent_1001",
    "foreign_trajectory_id": "ag_traj_7812"
  }
}

```

---

## 3. The Two Viewports: Strategist vs. Implementor

To prevent token exhaustion, the system must separate the viewports (focal lengths) of the two primary agent roles.

| Dimension | Orchestrator (Strategist) | Implementor (Coder / Specialist) |
| --- | --- | --- |
| **Core Question** | *"What is the project state, what is next, and did the subagent pass the gate?"* | *"How is this function wired, and what exact syntax needs to be edited?"* |
| **Ambient Viewport (Every Turn)** | • Active Milestone Spec & Invariants<br>

<br>• Compact Child Lineage Ledger (< 500 tokens)<br>

<br>• Current Workflow Phase | • Module AST Code Skeleton (< 800 tokens)<br>

<br>• Active file signature outline<br>

<br>• Specific task acceptance criteria |
| **JIT Viewport (On Demand)** | • Query child summary via session ID<br>

<br>• Test suite verification logs<br>

<br>• Spec conformance checks | • Exact line-range reads (`offset_read`)<br>

<br>• Structural call graph (`get_callers`)<br>

<br>• Git co-change coupling warnings |
| **Context Poison (Forbidden)** | ❌ Raw subagent turn-by-turn logs<br>

<br>❌ Full multi-file code implementations<br>

<br>❌ Verbose unparsed shell outputs | ❌ Full repository transcripts<br>

<br>❌ Global multi-child orchestration logs<br>

<br>❌ Unrelated package implementations |

---

## 4. The 3-Layer Substrate & Progressive Disclosure

To give agents instant zoom-out and zoom-in capabilities without bloating prompts, the context substrate operates on three distinct layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        THE CONTEXT SUBSTRATE                           │
├─────────────────────┬───────────────────────┬──────────────────────────┤
│    1. THE SPINE     │   2. THE HONEYCOMB    │      3. ARTIFACTS        │
│  (Physical Reality) │ (Queryable Hierarchy) │   (Semantic Invariants)  │
├─────────────────────┼───────────────────────┼──────────────────────────┤
│ • Raw File Bytes    │ • SQLite Lineage DB   │ • AGENTS.md rules        │
│ • Git Commit Tree   │ • In-Memory AST Trees │ • Architectural Specs    │
│ • Raw Tool Logs     │ • Co-Change Matrix    │ • Unit Test Assertions   │
│ • Append-only Store │ • Fast Symbol Pointers│ • Milestone Acceptance   │
│                     │                       │   Criteria               │
│ [Never in prompt]   │ [JIT Query Layer]     │ [Ambient Grounding]      │
└─────────────────────┴───────────────────────┴──────────────────────────┘

```

### Layer 1: The Spine (Ground Truth / Append-Only)

The Spine contains raw disk files, git commit history, and immutable execution logs. **It is never dumped into the prompt.** It exists purely as the authoritative source that deterministic tools read from via exact pointers (file path + line offset).

### Layer 2: The Honeycomb (Queryable Semantic Hierarchy)

The Honeycomb is an indexed SQLite / in-memory layer that stores structural relationships:

* **AST Code Skeletons:** Functions, classes, and types with stripped bodies.
* **Git Co-Change Associations:** Pairwise probabilities of files modified together in history.
* **Child Session Registry:** Lineage pointers linking parent sessions to child ACP trajectories.

### Layer 3: Artifacts (Invariants & Quality Gates)

Artifacts are the structural fences that tame the vibe coder:

1. **The Vibe-to-Spec Translator:** When a user issues a vague request (*"Make the billing flow look modern and add Stripe elements"*), the Orchestrator does not delegate immediately. It first drafts or updates an artifact (e.g., `specs/billing-stripe.md`) defining explicit scope and invariants.
2. **Deterministic Verification Gates:** A child subagent cannot close a task with conversational claims (*"I've finished the implementation"*). The Orchestrator evaluates completion against a concrete verification check: `exit_code === 0` from the test runner. If tests fail or scope boundaries are violated, the task is automatically rejected and returned to the child.

---

## 5. How This Starts Up Your MVP

For your OpenCode plugin (`hivemind-steward-oc-devin`), the pragmatic path forward starts with three minimal components:

1. **Lightweight AST Skeletons (`get_skeleton`):** Use Tree-sitter or `@ast-grep/napi` to generate ambient outlines (< 800 tokens) for open files, cutting token usage by 85–90% while preserving structural awareness.
2. **Git Co-Change Analysis (`get_co_change`):** A fast local utility that parses `git log -n 300` into an in-memory map. When an agent edits `user.ts`, it automatically receives a notification: *"Warning: 80% of past commits to user.ts also modified user_schema.sql."*
3. **Thin SQLite Lineage Ledger (`.opencode/hivemind.db`):** Track every delegated task as a single indexed row. When parent sessions compact, the Orchestrator queries `hivemind_list(parent_session_id)` to recover prior audit or child results on demand without loading raw transcripts.

---

### What to Explore Next

You can review the full lesson and reference cheat sheet in your workspace:

* `lessons/0001-the-box-of-context-and-viewports.html` (includes interactive self-check questions)
* `reference/0001-context-viewports-cheat-sheet.html`

Which area would you like to explore next?

1. **The Verification Gate:** How the Orchestrator programmatically evaluates subagent completions and handles retries without conversational loops.
2. **The JIT Tool Suite:** Designing the minimal tool schema for `get_skeleton`, `read_offset`, and `get_co_change`.
3. **Compaction Recovery:** How the Orchestrator searches and re-hydrates child context across 5+ compactions using the SQLite lineage index.