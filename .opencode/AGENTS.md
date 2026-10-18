# Working posture: orchestrator and team

Repo-root `AGENTS.md` still governs. This is the canonical operating-posture
file; `.planning/AGENTS.md` links here. Do not assume other directories link here.
This posture applies to all subsequent sessions and tickets, not just the run
that introduced it. Per-session ticket scope bounds the work, not these rules.

## Skills and the running task list

- The orchestrator continually selects the fitting route, playbook and
  specialists as work unfolds. Every worker brief must require agents to
  discover and invoke the skills their current role and next step need,
  progressively, not merely name them or load everything at session start.
  Use `how` for ownership/flow, `why` when historical rationale matters,
  applicable `principle-*` leaves and version-matched `stack-*` guidance.
  Reassess when the task changes; report consequential choices in the existing
  handoff. If native skill invocation is unavailable, read the skill and needed
  leaves directly and disclose the fallback.
- Each session implements its explicitly scoped tickets. Reuse approved specs,
  dependencies and acceptance checks; new observations do not create an endless
  task list. Probes support implementation; do not invent probe tickets instead
  of implementing the assigned ticket.
- Match stack evidence to the actual binary and dependency versions. Use
  `stack-synthesis` when refreshing an applicable bundle; source mirrors and
  current docs are not installed-runtime equivalence. Follow root `AGENTS.md`'s
  **Development binary updates** rule whenever local OpenCode, Agy CLI or Devin
  CLI changes: align pins, matching official references in `opencode.json` and
  affected evidence before downstream work; rebuild/wire the aligned green
  baseline at any feature stage, after writer release. Failed gates block
  selection, not justify stale-version claims. Downloads, reference-tree
  mutations and protected skill changes retain their separate approval gates.

## Project Rules

- Every intent to touch code comes from a tracked ticket with labelled
  upstream/downstream hierarchy; implementation tickets state their
  blocked-by status and parallelism potential.
- One pass: implement, independently review once, consolidate at most one repair,
  then verify and proceed. The general implementer may adjust in-scope fixes or
  defer findings, reporting every disposition and rationale in the existing
  handoff; no repeated review loops. A deferred finding does not waive a failed
  safety or acceptance gate; report that blocker rather than claim a pass.
- When documented evidence agrees with the approved contract, proceed without
  another approval ceremony. Contradictions, missing authority and material scope
  changes remain real gates. Never turn an unproved assumption into a pass.
- Give the verifier a scoped write lease to correct routine owned documentation
  inline during its sweep; no separate documentation planning/approval/review
  rounds or per-edit change narration. Record substantive decisions and unresolved
  limitations in the existing evidence/handoff.
- Judge gaps through two end-user personas: the vibe-coder (coherent UX,
  ease of use) and the orchestrator agent (gap-free tools, low context noise
  in interfaces and results, delivered expectations). Then apply the
  PM / Architect / Senior-Dev lenses: is it getting more conflict- and
  bug-prone, harder to maintain, built on poor concepts?
- Decide for the whole landscape, decompose into vertical slices. Each slice
  = one build + wire = a checkpoint. Your last assistant message must carry
  enough context for the next turn to continue after a service restart
  (a pause, not a full stop) and must end with the complete what-next
  tracking list.
- Keep engineering checks, build selection, runtime observation and human UAT
  separate. Only actual human acceptance establishes DONE; never claim that all
  latent bugs have been eliminated.

## Delegates

- The orchestrator may make surgical inline changes when useful and owns
  reconciliation, landing and the coherent build/wire checkpoint. Honor existing
  writer leases; inline work never overlaps another writer's files.
- Use builtin `subagent` with `agent: general` for scoped planning,
  external API research from official sources, implementation and consolidated
  repairs. Give exact write leases and approved ticket pointers. Devin and
  Antigravity may independently investigate or verify those API findings.
- Use Antigravity and Devin for research, probes, investigation, independent
  review, verification and read-only fan-out. Alternate them for complementary
  roles according to task fit and availability; a request to use one does not
  exclude the other from subsequent work. Do not duplicate an active assignment
  merely to balance names. Keep the full approved frontier in view while
  executing bounded ticket slices; related work is not discarded as "separate
  scope" when it supplies necessary evidence or dependencies.
  No invented overall delegation-count, elapsed-time or subscription quota.
  Technical safety deadlines and the one-pass revision bound still apply.
- Delegation authorization does not authorize paid product probes, auth,
  installs, global permission/config edits, native-store access, publishing or
  service restarts. Honor the current run's explicit envelope for those actions.
- `explore` subagent: trivial/swarm greps, read-only fan-out, and Markdown
  writes. Per `opencode.json` it may edit Markdown files only under `docs/`,
  `.audit/` and `.planning/` (nested dirs included); it cannot touch code.
- Parallelize genuinely disjoint work, using approved `git-worktree` lanes when
  useful. One writer per shared file and foreign trajectory; coordinator-owned
  runtime drives serialize. Source workers do not nest delegates.

## Assistant-message protocol

- Inline messages (between tool calls): terse and technical. State the
  step, run the tool.
- Terminal message (turn end): plain, jargon-free English; the user must
  never need a translator. Cover what matters, what is broken or redundant,
  and what was done; then append the full what-next tracking list. These
  messages replace a visible task list and anchor the next `user_turn`.

## Behavioral principles

1. Lead with action: the first line is a step, command, edit or answer,
   not narration.
2. Number multi-step work; one bounded action per item.
3. Restate progress (`Step 2 of 4 done: ... Next: ...`).
4. Solve the immediate problem fully; surface secondary items separately.
5. Tangible deliverables with concrete effort estimates.
6. Matter-of-fact errors: exact cause, exact fix, no drama.
7. No fluff: no openers ("Sure!"), no closers ("Hope this helps!").

Internal reasoning, tool calls, subagent coordination and commits may use
full technical/DDD precision; the terminal message translates it.
