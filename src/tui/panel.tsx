/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { useKeyboard } from "@opentui/solid"
import { For, type JSX, Show, createMemo, createSignal } from "solid-js"
import type {
  SubstrateActionInput,
  SubstrateActionKind,
  SubstrateActionOutput,
  SubstrateSnapshotOutput,
} from "../rpc.ts"
import { resolveSubstrateColors } from "./status.tsx"

export type SubstratePanelTab = "status" | "provenance" | "repomap" | "timeline" | "brief"

const PANEL_TABS: readonly { readonly id: SubstratePanelTab; readonly key: string; readonly label: string }[] = [
  { id: "status", key: "1", label: "1:Status" },
  { id: "provenance", key: "2", label: "2:Provenance" },
  { id: "repomap", key: "3", label: "3:RepoMap" },
  { id: "timeline", key: "4", label: "4:Timeline" },
  { id: "brief", key: "5", label: "5:Brief" },
]

export interface SubstratePanelProps {
  readonly context?: Pick<Plugin.Context, "theme">
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly lastActionOutput: () => SubstrateActionOutput | null
  readonly loading: () => boolean
  readonly error: () => string | null
  readonly onRefresh: () => void | Promise<void>
  readonly onAction: (input: SubstrateActionInput) => void | Promise<void>
}

export function SubstratePanel(props: SubstratePanelProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))
  const [activeTab, setActiveTab] = createSignal<SubstratePanelTab>("status")
  const [scrollOffset, setScrollOffset] = createSignal(0)

  const switchTab = (tab: SubstratePanelTab) => {
    setActiveTab(tab)
    setScrollOffset(0)
    const actionMap: Record<SubstratePanelTab, SubstrateActionKind> = {
      status: "status",
      provenance: "provenance",
      repomap: "repomap",
      timeline: "timeline",
      brief: "brief",
    }
    void props.onAction({ action: actionMap[tab] })
  }

  useKeyboard((evt) => {
    if (evt.ctrl || evt.meta) return
    if (evt.name === "1") {
      evt.preventDefault()
      switchTab("status")
      return
    }
    if (evt.name === "2") {
      evt.preventDefault()
      switchTab("provenance")
      return
    }
    if (evt.name === "3") {
      evt.preventDefault()
      switchTab("repomap")
      return
    }
    if (evt.name === "4") {
      evt.preventDefault()
      switchTab("timeline")
      return
    }
    if (evt.name === "5") {
      evt.preventDefault()
      switchTab("brief")
      return
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      const idx = PANEL_TABS.findIndex((t) => t.id === activeTab())
      const next = PANEL_TABS[(idx + 1) % PANEL_TABS.length]!
      switchTab(next.id)
      return
    }
    if (evt.name === "r") {
      evt.preventDefault()
      void props.onRefresh()
      return
    }
    if (evt.name === "p") {
      evt.preventDefault()
      void props.onAction({ action: "prune", mode: "manual" })
      return
    }
    if (evt.name === "s") {
      evt.preventDefault()
      void props.onAction({ action: "sync" })
      return
    }
    if (evt.name === "b") {
      evt.preventDefault()
      switchTab("brief")
      return
    }
    if (evt.name === "j" || evt.name === "down") {
      evt.preventDefault()
      setScrollOffset((v) => v + 1)
      return
    }
    if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault()
      setScrollOffset((v) => Math.max(0, v - 1))
    }
  })

  const markdownLines = createMemo(() => {
    const out = props.lastActionOutput()
    if (!out?.markdown) return []
    const lines = out.markdown.split("\n")
    return lines.slice(scrollOffset(), scrollOffset() + 18)
  })

  return (
    <box flexDirection="column" padding={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={colors().primary}>
          <b>Hivemind Substrate Inspector</b>
        </text>
        <text fg={colors().textMuted}>
          [1-5/Tab] View  [j/k] Scroll  [r] Refresh  [p] Prune  [b] Brief  [s] Sync
        </text>
      </box>

      <box flexDirection="row" gap={2}>
        <For each={PANEL_TABS}>
          {(tab) => (
            <text fg={activeTab() === tab.id ? colors().primary : colors().textMuted}>
              {activeTab() === tab.id ? `[${tab.label}]` : ` ${tab.label} `}
            </text>
          )}
        </For>
      </box>

      <Show when={props.error()}>
        {(err) => <text fg={colors().error}>Error: {err()}</text>}
      </Show>

      <Show
        when={props.snapshot()}
        fallback={
          <text fg={colors().textMuted}>
            {props.loading() ? "Loading substrate snapshot…" : "No substrate snapshot available."}
          </text>
        }
      >
        {(snap) => (
          <box flexDirection="column" gap={1}>
            <box flexDirection="column">
              <text fg={colors().textBase}>
                <b>Session:</b> {snap().resolvedSessionID} · <b>Title:</b> {snap().sessionTitle}
              </text>
              <text fg={colors().textMuted}>
                <b>Root:</b> {snap().projectRoot} · <b>Gate:</b> {snap().verificationState}
              </text>
              <text fg={colors().textBase}>
                <b>Spine:</b> {snap().counts.rootSessions} roots / {snap().counts.sessions} sessions ·{" "}
                {snap().counts.delegations} delegations ({snap().counts.flaggedDelegations} flagged) ·{" "}
                {snap().counts.compactions} compactions
              </text>
              <text fg={colors().textBase}>
                <b>Honeycomb:</b> {snap().counts.codeFiles} files · {snap().counts.codeSymbols} symbols ·{" "}
                {snap().counts.cochangePairs} co-change ({snap().counts.hiddenCochangePairs} HIDDEN)
              </text>
              <text fg={colors().textBase}>
                <b>Working Memory:</b> {snap().counts.freshFiles} FRESH ({snap().counts.sliceFiles} SLICE) ·{" "}
                {snap().counts.staleFiles} STALE · {snap().counts.activeSkills} ACTIVE skills ·{" "}
                {snap().counts.provenanceChains} chains ({snap().counts.staleChains} stale)
              </text>
            </box>

            <Show when={snap().staleAlerts.length > 0}>
              <box flexDirection="column">
                <text fg={colors().warning}>
                  <b>Stale Ledger Alerts ({snap().staleAlerts.length}):</b>
                </text>
                <For each={snap().staleAlerts.slice(0, 4)}>
                  {(alert) => (
                    <text fg={colors().warning}>
                      - {alert.path}#{alert.lineRange} → {alert.status}
                    </text>
                  )}
                </For>
              </box>
            </Show>

            <Show when={snap().recentPivots.length > 0}>
              <box flexDirection="column">
                <text fg={colors().textBase}>
                  <b>Recent Intent Pivots ({snap().recentPivots.length}):</b>
                </text>
                <For each={snap().recentPivots.slice(0, 4)}>
                  {(pivot) => (
                    <text fg={colors().textMuted}>
                      - seq={pivot.seq} [{pivot.pivotKind}] {pivot.excerpt} ({pivot.blobRef})
                    </text>
                  )}
                </For>
              </box>
            </Show>

            <Show when={snap().topCentralFiles.length > 0}>
              <box flexDirection="column">
                <text fg={colors().textBase}>
                  <b>Top PageRank RepoMap Files:</b>
                </text>
                <For each={snap().topCentralFiles.slice(0, 4)}>
                  {(file) => (
                    <text fg={colors().textMuted}>
                      - {file.path} (PR={file.pagerank.toFixed(4)}, {file.loc} LOC)
                    </text>
                  )}
                </For>
              </box>
            </Show>
          </box>
        )}
      </Show>

      <Show when={markdownLines().length > 0}>
        <box flexDirection="column" paddingTop={1}>
          <text fg={colors().primary}>
            <b>
              Active Viewport Output ({props.lastActionOutput()?.action} ·{" "}
              {props.lastActionOutput()?.tokenEstimate} tok):
            </b>
          </text>
          <For each={markdownLines()}>
            {(line) => <text fg={colors().textBase}>{line}</text>}
          </For>
        </box>
      </Show>
    </box>
  )
}

export function renderSubstrateSlotHarness(slots: {
  readonly statusRender: () => JSX.Element
  readonly sidebarRender: () => JSX.Element
  readonly panelRender: () => JSX.Element
}): JSX.Element {
  return (
    <box flexDirection="column">
      {slots.statusRender()}
      {slots.sidebarRender()}
      {slots.panelRender()}
    </box>
  )
}
