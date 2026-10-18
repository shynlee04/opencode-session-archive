## Learning route

We’ll follow your audit-recovery request through five decisions:

1. **Preservation:** what must survive when active context forgets.
2. **Agent roles:** what the parent and implementors need—and how to reconcile their claims.
3. **Evidence recovery:** locate audits, inspect findings, connect decisions and fixes.
4. **Zooming:** when files, code navigation, Git, keyword search, semantic retrieval, and relationships help.
5. **MVP selection:** compare reuse-first recovery, a lightweight index, and richer semantic memory.

Today is only step 1. No architecture is approved, and no teaching files or product artifacts are being created.

# Lesson 1: Preserve the evidence, not just the story

**Your product does not need the parent to remember forty agents. It needs the parent to find and examine the right surviving records.**

After five compactions, “I no longer see the first audits” should mean **retrieval is needed**, not **the evidence is gone**.

That distinction is the foundation of this slice.

## 1. Four boundaries that look like “memory”

| Boundary | In your scenario | Product consequence |
|---|---|---|
| **Active context** — what the model receives for its current response | Recent conversation, a compaction summary, selected tool results | If an audit is absent, the model cannot directly reason from it. |
| **Persisted records** — what OpenCode or a Harness stores | Session metadata, recorded messages/events, child bindings | Something may survive without being visible to the current model. Retention and completeness must be established. |
| **Retrievable memory** — what a supported tool can locate and return | “Find early audit children; read these findings” | Stored-but-inaccessible evidence does not deliver your recovery experience. |
| **Continuation state** — what lets the original trajectory run another turn | Harness-owned session state, its identity, binding and delivery state | Recovering its findings is not the same as reopening that agent. |

A useful picture:

```text
Surviving records
      │
      ├── Locate → inspect selected evidence → current model context
      │                                         │
      │                                  grounded report
      │
      └── Harness-owned state + supported continuation
                                                │
                                      original trajectory continues
```

**Those are two different routes.**

An Antigravity agent could read evidence produced by Devin and write your report. That would not mean Antigravity had inherited Devin’s native trajectory.

ACP’s [session-loading contract](https://agentclientprotocol.com/protocol/session-setup#loading-sessions) describes restoring a session through the agent that owns it, with capability checks and history replay. Sharing between *clients* is not a promise of transferring execution state between different Harness products.

Also, loading a session is a lifecycle operation—not automatically a read-only archive query.

## 2. What the audit-recovery request actually depends on

Consider this **illustrative finding**, not a claim about your actual audits:

> Audit A found that cancellation could leave a delegated process running. A child later reported that it fixed the problem.

To reconstruct this reliably, preserve the following chain:

```text
Original finding
      ↓
Decision about the finding
      ↓
Proposed repair → actual change → committed change
                                      ↓
                           verification at a known revision
```

Each arrow needs supporting evidence. “These happened around the same time” is a lead, not proof of a relationship.

### The preservation responsibilities

| Preserve | Why your report needs it |
|---|---|
| **Identity and location:** project, Harness, parent/child lineage, OpenCode session ID, foreign session ID where available | Distinguish the intended audit from another similarly named task. A directory path alone is not a durable project identity. |
| **Discovery clues:** title, original brief, creation time, later activity times | Find “the audits near the beginning.” An early audit might have a recent update time because it was continued later. |
| **Original findings and supporting evidence:** relevant messages, review artifacts, tool results | Recover what the audit actually established, including qualifications and exceptions. |
| **Decisions and redirects:** what was accepted, rejected, deferred, or superseded | Explain why a finding was—or was not—acted on. |
| **Change evidence:** relevant diffs, commits, explicit finding-to-change links | Distinguish “a child proposed a fix” from “the fix landed.” |
| **Verification context:** what was checked, against which code state, with what outcome | Distinguish historical test success from currently verified behavior. |
| **Capture limitations:** missing output, unavailable records, incomplete coverage | Say “unknown” rather than quietly inventing a complete history. |

This spans your three information domains: **conversations**, **artifacts and decisions**, and **code/change history**. They are kinds of information—not three processing layers.

## 3. Summaries help navigation; originals support conclusions

Suppose the surviving summary says:

> “Both audits completed. All important fixes landed.”

It is convenient, but it cannot answer:

- Which findings counted as important?
- Were any fixes deferred?
- Which commits addressed them?
- Has later code undone a repair?

Here are three preservation choices:

| Choice | Benefit | Product risk and burden |
|---|---|---|
| **Keep summaries only** | Small and convenient to retrieve | Omitted qualifications may be unrecoverable. A confident report can rest on an unverifiable story. |
| **Keep links to authoritative records** | Avoids maintaining duplicate narratives; allows targeted inspection | Depends on those records remaining retained and accessible through supported surfaces. |
| **Retain selected source evidence independently** | Recovery can survive loss of an upstream record | Adds privacy, retention, deletion, storage, and capture-completeness responsibilities. |

**My provisional recommendation:** reuse authoritative records where their retention and access are adequate; preserve necessary evidence where they are not. Treat summaries as navigation aids, not replacements for their sources.

That is a preservation principle, **not yet an MVP architecture choice**.

A search index can usually be rebuilt from surviving sources. A deleted original finding cannot be reconstructed merely by rebuilding its index. Embeddings and graphs do not change that fact.

## 4. What steering, child results, and compaction change

### Repeated user redirects

You first say “fix everything,” then “only investigate cancellation,” then “leave permissions unchanged.”

A final summary might retain only the last instruction. Historical reconstruction may need the sequence to explain abandoned work.

There is another distinction: **a recorded instruction is not proof the child consumed it**. The product should retain delivery/consumption evidence where available and admit uncertainty otherwise.

### Tool outputs

A stored tool invocation is not necessarily a retained complete result. Truncation, external output files, deletion, and incomplete capture can break the evidence chain.

Preserving a pointer helps only while its target remains available.

### Child completion messages

“Done; tests pass” is a **reported outcome**. It helps the parent decide what to inspect; it does not automatically become verified project state.

Likewise, exit code zero establishes the outcome of a particular command—not satisfaction of the entire product requirement.

### Compaction

Compaction changes what the model carries forward. It must not be treated as either proof that originals were deleted or proof that they remain recoverable.

OpenCode’s current [plugin documentation](https://opencode.ai/v2/docs/build/plugins#model-requests) explicitly separates outgoing model context from persisted history. The precise retention and retrieval coverage still needs checking for each relevant record type.

## 5. What your project already establishes—and what remains open

- **Owner-established boundary:** a Native child belongs to one Harness throughout its life; remembered evidence does not imply cross-Harness trajectory transfer.
- **Verified in current source:** [`src/delegation/native-delegation.ts`](src/delegation/native-delegation.ts) records the child’s Harness and foreign-session binding. [`src/delegation/native-checkpoint.ts`](src/delegation/native-checkpoint.ts) deliberately preserves continuation identity/state, **not the audit’s substantive findings**.
- **Verified inventory limitation:** [`src/delegation/child-inventory.ts`](src/delegation/child-inventory.ts) serves the calling parent’s direct children. It is not already a project-wide historical search service for a new parent.
- **Recorded runtime evidence:** project records report narrow same-child continuation for Devin and Antigravity. That does not establish complete archival recovery or broader native-client interoperability.
- **Unproven for this journey:** completeness and durability of original findings, tool evidence, and conversation-to-change links after repeated compaction and from a new session.

The dossier’s ASTs, vectors, and graphs are therefore possible later aids—not evidence that this preservation problem is already solved.

---

### Carry-forward checkpoint

- **Mission:** recover past work with provenance, without manual summary management or loading forty trajectories.
- **Distinction introduced, not yet demonstrated:** active context, persistence, retrieval, and continuation are separate.
- **Provisional recommendation:** source-backed recovery; summaries for navigation.
- **Open decision:** which existing records provide sufficient retention and supported access.
- **Next topic:** what the orchestrator needs to reconcile child outcomes.

### Apply the distinction

A new Antigravity agent can retrieve the original Devin audit findings, their linked repair commits, and revision-bound verification evidence—but cannot reopen the original Devin trajectory.

**Would you classify that as historical recovery failing, or continuation being unavailable—and why?**

---

**Yes—these observations strengthen the starting point. Your third slice can build on existing resident trajectories and OpenCode records, rather than assuming it must create persistence from scratch.**

I checked the named export and narrowly queried OpenCode’s database **read-only**. No sessions, configuration, or files were changed.

## 1. Native residency: accepted as confirmed by you

Both Devin and Antigravity delegated conversations are visible and resumable in their respective native interfaces on your machine.

That corrects my earlier uncertainty **for your demonstrated setup**. We do not need to reopen that question before teaching the memory architecture.

The distinction still holds:

- Another Harness can **retrieve and interpret remembered evidence**.
- Continuing the **original trajectory** remains with its owning Harness.

## 2. OpenCode residency: now independently verified

For parent `ses_ecbfc0f40ffenfykTrNGoMS6o1`, I found:

- **12 direct child sessions** in OpenCode’s `session_v2` table.
- **11 Harness-bound children:** five Devin and six Antigravity.
- One ordinary OpenCode fallback child.
- Each child has its own persisted `session_message` records.
- The 11 bindings connect OpenCode child IDs to their respective Harness and foreign-session IDs.
- The export contains parent completion notifications with explicit `childID` references.

The export’s actual delegation tool names are `delegate-devin` and `hivemind-delegate`. Their completion notifications identify their source as `subagent`: that demonstrates the native child mechanism, not necessarily invocation of the builtin `subagent` tool.

**So #2 is no longer unknown:** these are genuine persisted OpenCode child sessions, not merely IDs written into conversational summaries.

One location clarification: `opencode.json` references the shared storage; it does not place it inside this repository:

- Database: `~/.local/share/opencode/opencode.db`
- Large tool results: `~/.local/share/opencode/tool-output/`
- Work artifacts: often repository paths such as `.audit/...`

Two large-output files explicitly linked from the export still exist. That proves those particular targets survive now—not a general retention guarantee.

## 3. Your repeated-stop anchors are real—and useful

Three Harness-bound children each have **two user messages, two assistant turns, and two idle records**, with their binding reporting turn 2.

Examples:

| Harness | OpenCode child | Owning foreign session |
|---|---|---|
| Devin | `ses_ecbd18c21ffe5mPmDzXKi6KiVI` | `placid-porter` |
| Antigravity | `ses_ecbea4dc7ffeRHomkI6oNWAtM6` | `50afcb51-6449-4d27-823e-dc9d2a907f5a` |

That supports your model:

```text
One continuing trajectory
    ├─ first stopped turn → findings / artifact references
    ├─ follow-up instruction
    ├─ second stopped turn → corrections / revised artifacts
    └─ further turns…
```

**We should preserve discoverable milestones along the trajectory, not just its latest summary.** Otherwise, a later “fixed” summary can hide the earlier finding and the reasoning behind the correction.

However, this particular export does not demonstrate the five-compaction scenario; I found no compaction-type message records in the inspected parent or children.

## 4. What hashes add—and what they cannot add

Your proposed combination is strong, with one refinement:

> **A milestone should point to the original message, the relevant evidence, and the code/artifact versions—not merely repeat their names.**

| Anchor | What it establishes | What it does not establish |
|---|---|---|
| Session + message ID | Where the original statement was recorded | That the statement was correct |
| Commit hash + relevant diff | Which committed change to inspect | That it addressed the finding or still works today |
| Artifact path | Where to look | Which historical version was reviewed |
| Content hash | Whether retrieved bytes match the recorded version | That those bytes remain available, complete, or correct |
| Verification evidence tied to code state | What was checked against that state | Whole-product acceptance |

A concrete issue already appears here: the Antigravity spec-author child produced two stopped responses referring to the **same** `.planning/phases/production-release/SPEC.md` path. Reading that path today gives today’s contents—not necessarily the draft discussed at the first stop.

A hash can detect that mismatch. **Recovering the earlier version still requires retained bytes**, whether in Git, recorded tool evidence, or another supported retained source.

Also, a commit hash alone misses uncommitted changes present during a check.

One especially useful counterexample: an Antigravity child has a `succeeded` idle outcome, but its final text reports an MCP initialization failure. **The turn ended successfully at the host level; the requested work did not thereby succeed.**

## Updated checkpoint

- **Confirmed by you:** native residency and native resumption for both Harnesses.
- **Verified here:** OpenCode child records, lineage, Harness bindings, repeated stopped turns, and some surviving external outputs.
- **Your promising preservation idea:** automatically capture/index milestones with original-message links, versioned evidence, and change references.
- **Still unresolved:** evidence completeness and retention, historical artifact versions, supported cross-session retrieval, and recovery across compactions.
