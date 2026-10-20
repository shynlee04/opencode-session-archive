/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import type {
  SubstrateActionInput,
  SubstrateActionOutput,
  SubstrateCentralFileSummary,
  SubstrateMudballHotspotSummary,
  SubstrateSnapshotOutput,
  SubstrateSymbolOutlineItem,
} from "../rpc.ts"
import { SPLIT_BORDER_CHARS, resolveSubstrateColors } from "./status.tsx"

export type SubstrateViewTab = 1 | 2 | 3 | 4 | 5

const VIEW_TABS: readonly { readonly id: SubstrateViewTab; readonly label: string }[] = [
  { id: 1, label: "1:RepoMap & Mudball Advisor" },
  { id: 2, label: "2:Provenance & Staleness" },
  { id: 3, label: "3:Intent Pivots" },
  { id: 4, label: "4:Compaction Preview" },
  { id: 5, label: "5:Live Viewport" },
]

const FOOTER_HINTS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "1-5", label: "view" },
  { key: "↑/↓/j/k", label: "file" },
  { key: "⏎", label: "skeleton" },
  { key: "p", label: "prune" },
  { key: "r/s", label: "sync" },
  { key: "esc", label: "return" },
]

function formatHotspotBadge(kind: SubstrateMudballHotspotSummary["kind"]): string {
  switch (kind) {
    case "hidden_coupling":
      return "HIDDEN COUPLING"
    case "god_symbol":
      return "GOD SYMBOL"
    case "god_file":
      return "GOD FILE"
    case "high_coupling_hub":
      return "COUPLING HUB"
  }
}

export function cleanSymbolSignatureTail(sym: SubstrateSymbolOutlineItem): string {
  let sig = (sym.signature ?? "").trim()
  sig = sig.replace(/\s*\[L\d+-L\d+\]\s*$/, "").trim()
  const prefixRe = new RegExp(
    `^(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:${sym.kind}\\s+)?${sym.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`,
  )
  const tail = sig.replace(prefixRe, "").trim()
  if (!tail || tail === sym.name) return ""
  return tail.length > 56 ? `${tail.slice(0, 55)}…` : tail
}

export interface SubstrateViewProps {
  readonly context?: Pick<Plugin.Context, "theme" | "keymap">
  readonly sessionID?: string
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly lastActionOutput: () => SubstrateActionOutput | null
  readonly loading: () => boolean
  readonly error: () => string | null
  readonly onRefresh: () => void | Promise<void>
  readonly onAction: (input: SubstrateActionInput) => void | Promise<void>
  readonly onClose?: () => void
}

export function SubstrateView(props: SubstrateViewProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))
  const [activeTab, setActiveTab] = createSignal<SubstrateViewTab>(1)
  const [selectedFileIdx, setSelectedFileIdx] = createSignal(0)

  createEffect(() => {
    const action = props.lastActionOutput()?.action
    if (action === "provenance") setActiveTab(2)
    else if (action === "compaction") setActiveTab(4)
    else if (action === "brief") setActiveTab(5)
    else if (action === "repomap" || action === "skeleton") setActiveTab(1)
  })

  const files = createMemo<readonly SubstrateCentralFileSummary[]>(
    () => props.snapshot()?.topCentralFiles ?? [],
  )

  const selectedFile = createMemo<SubstrateCentralFileSummary | null>(() => {
    const list = files()
    if (list.length === 0) return null
    const clamped = Math.min(Math.max(0, selectedFileIdx()), list.length - 1)
    return list[clamped] ?? null
  })

  const moveCursor = (delta: number) => {
    const len = files().length
    if (len === 0) return
    setSelectedFileIdx((prev) => (prev + delta + len) % len)
  }

  const loadSelectedSkeleton = () => {
    const sel = selectedFile()
    if (!sel) return
    void props.onAction({
      action: "skeleton",
      path: sel.path,
      sessionID: props.sessionID,
    })
  }

  const selectTab = (tab: SubstrateViewTab) => {
    setActiveTab(tab)
    if (tab === 2) {
      void props.onAction({ action: "provenance", sessionID: props.sessionID })
    } else if (tab === 3) {
      void props.onAction({ action: "timeline", sessionID: props.sessionID })
    } else if (tab === 4 && !props.snapshot()?.compactionPreview) {
      void props.onAction({ action: "compaction", sessionID: props.sessionID })
    } else if (tab === 5) {
      const sel = selectedFile()
      void props.onAction({
        action: "brief",
        path: sel?.path,
        targetPaths: sel ? [sel.path] : undefined,
        sessionID: props.sessionID,
      })
    }
  }

  if (typeof props.context?.keymap?.layer === "function") {
    props.context.keymap.layer(() => ({
      commands: [
        {
          id: "substrate.view.close",
          title: "Close Substrate View",
          bind: "escape",
          run: () => props.onClose?.(),
        },
        {
          id: "substrate.view.skeleton",
          title: "Load Selected File AST Skeleton",
          bind: "return",
          run: () => loadSelectedSkeleton(),
        },
      ],
    }))
  }

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta) return
    if (evt.name === "escape" || evt.name === "q") {
      evt.preventDefault()
      props.onClose?.()
      return
    }
    if (evt.name === "1") {
      evt.preventDefault()
      selectTab(1)
      return
    }
    if (evt.name === "2") {
      evt.preventDefault()
      selectTab(2)
      return
    }
    if (evt.name === "3") {
      evt.preventDefault()
      selectTab(3)
      return
    }
    if (evt.name === "4" || evt.name === "c") {
      evt.preventDefault()
      selectTab(4)
      return
    }
    if (evt.name === "5" || evt.name === "b") {
      evt.preventDefault()
      selectTab(5)
      return
    }
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      moveCursor(-1)
      return
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      moveCursor(1)
      return
    }
    if (
      evt.name === "return" ||
      evt.name === "enter" ||
      (evt as any).sequence === "\r" ||
      (evt as any).sequence === "\n"
    ) {
      evt.preventDefault()
      loadSelectedSkeleton()
      return
    }
    if (evt.name === "p") {
      evt.preventDefault()
      void props.onAction({ action: "prune", mode: "manual", sessionID: props.sessionID })
      return
    }
    if (evt.name === "r" || evt.name === "s") {
      evt.preventDefault()
      void props.onAction({ action: "sync", scope: "project", sessionID: props.sessionID })
    }
  })

  const gateColor = createMemo(() => {
    const c = colors()
    const snap = props.snapshot()
    if (!snap) return c.textMuted
    if (snap.counts.staleFiles > 0 || snap.counts.staleChains > 0) return c.warning
    return (snap.gateLabel ?? "").startsWith("PASS") ? c.success : c.textMuted
  })

  const tokenEconText = createMemo(() => {
    const snap = props.snapshot()
    const econ = snap?.tokenEconomics
    if (!econ) return "AST estimate unavailable | Valve: 0 tok saved"
    return `AST estimate: ${econ.rawTokensTotal} -> ${econ.skeletonTokensTotal} tok (${econ.compressionPct}% smaller) | Valve: ${econ.valveSavedTokens} tok saved`
  })

  return (
    <box width="100%" height="100%" flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      {/* Top Railed Header Card */}
      <box
        flexShrink={0}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SPLIT_BORDER_CHARS}
        borderColor={colors().primary}
        backgroundColor={colors().raisedBg}
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="row" justifyContent="space-between" gap={2}>
          <text fg={colors().primary} wrapMode="none">
            <b>HIVEMIND SUBSTRATE — MUDBALL &amp; ARCHITECTURE ADVISOR</b>
          </text>
          <text fg={gateColor()} wrapMode="none" flexShrink={0}>
              ● <b>Gate:</b> {props.snapshot()?.gateLabel ?? props.snapshot()?.verificationState ?? "IDLE"}
          </text>
        </box>

        <Show when={props.snapshot()}>
          {(snap) => (
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={colors().textBase} wrapMode="none" flexGrow={1} minWidth={0}>
                <b>Session:</b> {snap().sessionTitle || snap().resolvedSessionID}
                <span style={{ fg: colors().textMuted }}>{` (${snap().resolvedSessionID})`}</span>
              </text>
              <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                  <span style={{ fg: colors().success }}>{`${snap().counts.freshFiles} FRESH`}</span>
                {" · "}
                <span style={{ fg: colors().primary }}>{`${snap().counts.sliceFiles} SLICE`}</span>
                {" · "}
                <span style={{ fg: snap().counts.staleFiles > 0 ? colors().warning : colors().textMuted }}>
                  {`${snap().counts.staleFiles} STALE`}
                </span>
                {` · ${snap().counts.activeSkills} Skills`}
              </text>
            </box>
          )}
        </Show>

        <box flexDirection="row" justifyContent="space-between" gap={2}>
          <text fg={colors().textMuted} wrapMode="none" flexGrow={1} minWidth={0}>
            {tokenEconText()}
          </text>
          <Show when={props.snapshot()}>
            {(snap) => (
              <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                  Graph: {snap().counts.codeFiles} files · {snap().counts.codeSymbols} syms ·{" "}
                {snap().counts.hiddenCochangePairs} hidden coupled
              </text>
            )}
          </Show>
        </box>
      </box>

      {/* Distinct Pill Tab Bar */}
      <box flexDirection="row" gap={1} flexShrink={0}>
        <For each={VIEW_TABS}>
          {(tab) => {
            const isActive = () => activeTab() === tab.id
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? colors().focusBg : colors().raisedBg}
                onMouseUp={() => selectTab(tab.id)}
              >
                <text fg={isActive() ? colors().textBase : colors().textMuted} wrapMode="none">
                  <Show when={isActive()} fallback={tab.label}>
                    <b>{`[${tab.label}]`}</b>
                  </Show>
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <Show when={props.error()}>
        {(err) => (
          <box
            flexShrink={0}
            border={["left"]}
            customBorderChars={SPLIT_BORDER_CHARS}
            borderColor={colors().error}
            paddingLeft={1}
          >
            <text fg={colors().error} wrapMode="none">
              Error: {err()}
            </text>
          </box>
        )}
      </Show>

      {/* Main Two-Column Workspace */}
      <Show
        when={props.snapshot()}
        fallback={
          <box flexGrow={1} paddingLeft={1}>
            <text fg={colors().textMuted}>
              {props.loading() ? "Loading substrate snapshot…" : "No substrate snapshot available."}
            </text>
          </box>
        }
      >
        {(snap) => (
          <box flexDirection="row" flexGrow={1} minHeight={0} gap={2}>
            {/* Left Column: PageRank Central Files + Mudball Hotspots */}
            <box width="48%" flexDirection="column" gap={1} minWidth={38}>
              {/* Card 1: PageRank Central Files */}
              <box
                flexDirection="column"
                border={["left"]}
                customBorderChars={SPLIT_BORDER_CHARS}
                borderColor={colors().primary}
                backgroundColor={colors().raisedBg}
                paddingLeft={2}
                paddingRight={2}
              >
                <box flexDirection="row" justifyContent="space-between" gap={2}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>PageRank Central Files ({files().length})</b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none">
                      PR · LOC
                  </text>
                </box>

                <For each={files().slice(0, 10)}>
                  {(file, idx) => {
                    const isSelected = () => idx() === selectedFileIdx()
                    return (
                      <box
                        flexDirection="row"
                        justifyContent="space-between"
                        gap={1}
                        backgroundColor={isSelected() ? colors().focusBg : undefined}
                        onMouseUp={() => setSelectedFileIdx(idx())}
                      >
                        <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
                          <text fg={isSelected() ? colors().primary : colors().textMuted} wrapMode="none" flexShrink={0}>
                            {`${isSelected() ? "▸" : " "} #${idx() + 1}`}
                          </text>
                          <text
                            fg={isSelected() ? colors().textBase : colors().textMuted}
                            wrapMode="none"
                            flexGrow={1}
                            flexShrink={1}
                            minWidth={0}
                          >
                            <Show when={isSelected()} fallback={file.path}>
                              <b>{file.path}</b>
                            </Show>
                          </text>
                        </box>
                        <text
                          fg={isSelected() ? colors().textBase : colors().textMuted}
                          wrapMode="none"
                          flexShrink={0}
                        >
                          {`  ${file.pagerank.toFixed(3)} · ${file.loc}L`}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>

              {/* Card 2: Mudball & Hidden Coupling Warnings */}
              <box
                flexDirection="column"
                flexGrow={1}
                border={["left"]}
                customBorderChars={SPLIT_BORDER_CHARS}
                borderColor={colors().warning}
                backgroundColor={colors().raisedBg}
                paddingLeft={2}
                paddingRight={2}
              >
                <box flexDirection="row" justifyContent="space-between" gap={2}>
                  <text fg={colors().warning} wrapMode="none">
                    <b>Architecture &amp; Mudball Alerts ({snap().mudballHotspots?.length ?? 0})</b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none">
                      METRIC
                  </text>
                </box>

                <Show
                  when={(snap().mudballHotspots?.length ?? 0) > 0}
                  fallback={<text fg={colors().textMuted}>No mudball hotspots detected.</text>}
                >
                  <For each={(snap().mudballHotspots ?? []).slice(0, 8)}>
                    {(hotspot) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          fg={hotspot.severity === "high" ? colors().error : colors().warning}
                          wrapMode="none"
                          flexShrink={0}
                        >
                          {`[${formatHotspotBadge(hotspot.kind)}]`}
                        </text>
                        <text
                          fg={colors().textBase}
                          wrapMode="none"
                          flexGrow={1}
                          flexShrink={1}
                          minWidth={0}
                        >
                          {hotspot.target}
                        </text>
                        <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                          {`  ${hotspot.metric}`}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </box>

            {/* Right Column: Active Tab Detail Pane */}
            <box
              flexGrow={1}
              flexDirection="column"
              minWidth={0}
              border={["left"]}
              customBorderChars={SPLIT_BORDER_CHARS}
              borderColor={colors().border}
              backgroundColor={colors().raisedBg}
              paddingLeft={2}
              paddingRight={2}
            >
              <Show when={activeTab() === 1}>
                <box flexDirection="column" gap={1}>
                  <Show
                    when={selectedFile()}
                    fallback={<text fg={colors().textMuted}>Select a file on the left to inspect its AST symbol outline.</text>}
                  >
                    {(sel) => (
                      <box flexDirection="column">
                        <box flexDirection="row" justifyContent="space-between" gap={2}>
                          <text fg={colors().primary} wrapMode="none">
                            <b>Selected File Symbol Outline — {sel().path}</b>
                          </text>
                          <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                            {`  ${sel().loc} LOC · ${sel().symbolsCount ?? sel().exportedSymbols?.length ?? 0} symbols`}
                          </text>
                        </box>

                        <For each={(sel().exportedSymbols ?? []).slice(0, 12)}>
                          {(sym) => {
                            const tail = cleanSymbolSignatureTail(sym)
                            return (
                              <box flexDirection="row" justifyContent="space-between" gap={2}>
                                <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
                                  <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                                    {`L${sym.startLine}-L${sym.endLine} (${sym.lineSpan}L)`}
                                  </text>
                                  <text fg={colors().primary} wrapMode="none" flexShrink={0}>
                                    {sym.kind}
                                  </text>
                                  <text fg={colors().textBase} wrapMode="none" flexShrink={0}>
                                    <b>{sym.name}</b>
                                  </text>
                                  <text
                                    fg={colors().textMuted}
                                    wrapMode="none"
                                    flexGrow={1}
                                    flexShrink={1}
                                    minWidth={0}
                                  >
                                    {tail || " "}
                                  </text>
                                </box>
                              </box>
                            )
                          }}
                        </For>
                      </box>
                    )}
                  </Show>

                  <Show when={Boolean(props.lastActionOutput()?.action === "skeleton" && props.lastActionOutput()?.markdown)}>
                    <box flexDirection="column" paddingTop={1}>
                      <text fg={colors().primary} wrapMode="none">
                        <b>Live AST Skeleton ({props.lastActionOutput()?.tokenEstimate} tok)</b>
                      </text>
                      <For each={(props.lastActionOutput()?.markdown ?? "").split("\n").slice(0, 14)}>
                        {(line) => (
                          <text fg={colors().textMuted} wrapMode="none">
                            {line || " "}
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              </Show>

              <Show when={activeTab() === 2}>
                <box flexDirection="column" gap={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>Provenance &amp; Staleness Reconciliation</b>
                  </text>
                  <For each={snap().staleAlerts}>
                    {(alert) => (
                      <box flexDirection="row" justifyContent="space-between" gap={2}>
                        <text fg={colors().warning} wrapMode="none" flexGrow={1} minWidth={0}>
                          {`! ${alert.path} [${alert.lineRange}]`}
                        </text>
                        <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                          {alert.status}
                        </text>
                      </box>
                    )}
                  </For>
                  <For each={(props.lastActionOutput()?.markdown ?? "").split("\n").slice(0, 18)}>
                    {(line) => (
                      <text fg={colors().textBase} wrapMode="none">
                        {line || " "}
                      </text>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={activeTab() === 3}>
                <box flexDirection="column" gap={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>Recent Intent Pivots ({snap().recentPivots.length})</b>
                  </text>
                  <For each={snap().recentPivots}>
                    {(pivot) => (
                      <box flexDirection="row" justifyContent="space-between" gap={2}>
                        <text fg={colors().textBase} wrapMode="none" flexGrow={1} minWidth={0}>
                          <span style={{ fg: colors().primary }}>{`[${pivot.pivotKind}] `}</span>
                          {pivot.excerpt}
                        </text>
                        <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                          {`seq ${pivot.seq}`}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={activeTab() === 4}>
                <box flexDirection="column" gap={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>Compaction Continuity Preview</b>
                  </text>
                  <For
                    each={(
                      snap().compactionPreview ||
                      props.lastActionOutput()?.markdown ||
                      "No compaction preview available."
                    )
                      .split("\n")
                      .slice(0, 22)}
                  >
                    {(line) => (
                      <text fg={colors().textBase} wrapMode="none">
                        {line || " "}
                      </text>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={activeTab() === 5}>
                <box flexDirection="column" gap={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>
                      Active Viewport Output ({props.lastActionOutput()?.action ?? "none"} ·{" "}
                      {props.lastActionOutput()?.tokenEstimate ?? 0} tok)
                    </b>
                  </text>
                  <For each={(props.lastActionOutput()?.markdown ?? "").split("\n").slice(0, 22)}>
                    {(line) => (
                      <text fg={colors().textBase} wrapMode="none">
                        {line || " "}
                      </text>
                    )}
                  </For>
                </box>
              </Show>
            </box>
          </box>
        )}
      </Show>

      {/* Bottom Shortcut Footer Bar (OpenCode V2 chip grammar) */}
      <box flexDirection="row" gap={3} flexShrink={0} paddingLeft={1}>
        <For each={FOOTER_HINTS}>
          {(hint) => (
            <text wrapMode="none">
              <span style={{ fg: colors().textBase }}>
                <b>{hint.key}</b>
              </span>
              <span style={{ fg: colors().textMuted }}>{` ${hint.label}`}</span>
            </text>
          )}
        </For>
      </box>
    </box>
  )
}
