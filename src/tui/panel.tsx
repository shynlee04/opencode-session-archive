/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { useKeyboard } from "@opentui/solid"
import { For, type JSX, Show, createMemo, createSignal } from "solid-js"
import type {
  SubstrateActionInput,
  SubstrateActionKind,
  SubstrateActionOutput,
  SubstrateCentralFileSummary,
  SubstrateSnapshotOutput,
} from "../rpc.ts"
import { SPLIT_BORDER_CHARS, resolveSubstrateColors } from "./status.tsx"
import { cleanSymbolSignatureTail } from "./view.tsx"

export type SubstratePanelTab = "status" | "provenance" | "repomap" | "compaction" | "brief"

const PANEL_TABS: readonly { readonly id: SubstratePanelTab; readonly key: string; readonly label: string }[] = [
  { id: "status", key: "1", label: "1:Status" },
  { id: "provenance", key: "2", label: "2:Provenance" },
  { id: "repomap", key: "3", label: "3:RepoMap" },
  { id: "compaction", key: "4", label: "4:Compaction" },
  { id: "brief", key: "5", label: "5:Brief" },
]

export interface SubstratePanelProps {
  readonly context?: Pick<Plugin.Context, "theme" | "keymap">
  readonly focused?: boolean | (() => boolean)
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly lastActionOutput: () => SubstrateActionOutput | null
  readonly loading: () => boolean
  readonly error: () => string | null
  readonly onRefresh: () => void | Promise<void>
  readonly onAction: (input: SubstrateActionInput) => void | Promise<void>
  readonly onOpenFullScreen?: () => void
}

export function SubstratePanel(props: SubstratePanelProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))
  const [activeTab, setActiveTab] = createSignal<SubstratePanelTab>("status")
  const [scrollOffset, setScrollOffset] = createSignal(0)
  const [selectedFileIdx, setSelectedFileIdx] = createSignal(0)

  const isFocused = (): boolean => {
    const raw = typeof props.focused === "function" ? props.focused() : props.focused
    return raw !== false
  }

  const files = createMemo<readonly SubstrateCentralFileSummary[]>(
    () => props.snapshot()?.topCentralFiles ?? [],
  )

  const selectedFile = createMemo<SubstrateCentralFileSummary | null>(() => {
    const list = files()
    if (list.length === 0) return null
    const clamped = Math.min(Math.max(0, selectedFileIdx()), list.length - 1)
    return list[clamped] ?? null
  })

  const switchTab = (tab: SubstratePanelTab) => {
    setActiveTab(tab)
    setScrollOffset(0)
    const actionMap: Record<SubstratePanelTab, SubstrateActionKind> = {
      status: "status",
      provenance: "provenance",
      repomap: "repomap",
      compaction: "compaction",
      brief: "brief",
    }
    void props.onAction({ action: actionMap[tab] })
  }

  if (typeof props.context?.keymap?.layer === "function") {
    props.context.keymap.layer(() => ({
      enabled: () => Boolean(typeof props.focused === "function" ? props.focused() : props.focused),
      commands: [
        {
          id: "substrate.panel.provenance",
          title: "Substrate Panel: Provenance",
          bind: "2",
          run: () => switchTab("provenance"),
        },
        {
          id: "substrate.panel.repomap",
          title: "Substrate Panel: RepoMap",
          bind: "3",
          run: () => switchTab("repomap"),
        },
        {
          id: "substrate.panel.compaction",
          title: "Substrate Panel: Compaction Preview",
          bind: "4",
          run: () => switchTab("compaction"),
        },
        {
          id: "substrate.panel.prune",
          title: "Substrate Panel: Prune Working Set",
          bind: "p",
          run: () => void props.onAction({ action: "prune", mode: "manual" }),
        },
      ],
    }))
  }

  useKeyboard((evt) => {
    if (!isFocused()) return
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
    if (evt.name === "4" || evt.name === "c") {
      evt.preventDefault()
      switchTab("compaction")
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
    if (evt.name === "return" || evt.name === "enter") {
      evt.preventDefault()
      const sel = selectedFile()
      if (sel) {
        void props.onAction({ action: "skeleton", path: sel.path })
      }
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
      if (files().length > 0) {
        setSelectedFileIdx((v) => (v + 1) % files().length)
      }
      setScrollOffset((v) => v + 1)
      return
    }
    if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault()
      if (files().length > 0) {
        setSelectedFileIdx((v) => (v - 1 + files().length) % files().length)
      }
      setScrollOffset((v) => Math.max(0, v - 1))
    }
  })

  const markdownLines = createMemo(() => {
    const out = props.lastActionOutput()
    if (out?.markdown) {
      return out.markdown.split("\n").slice(scrollOffset(), scrollOffset() + 12)
    }
    if (activeTab() === "compaction" && props.snapshot()?.compactionPreview) {
      return props.snapshot()!.compactionPreview!.split("\n").slice(scrollOffset(), scrollOffset() + 12)
    }
    return []
  })

  return (
    <box
      flexDirection="column"
      border={["left"]}
      customBorderChars={SPLIT_BORDER_CHARS}
      borderColor={isFocused() ? colors().primary : colors().border}
      backgroundColor={colors().raisedBg}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text fg={colors().primary} wrapMode="none">
          <b>Hivemind Substrate Inspector</b>
        </text>
        <text fg={colors().textMuted} wrapMode="none">
          [1-5/Tab] View · [j/k] Nav · [Enter] Skel · [p] Prune · [s] Sync
        </text>
      </box>

      <box flexDirection="row" gap={1} paddingBottom={1}>
        <For each={PANEL_TABS}>
          {(tab) => {
            const isActive = () => activeTab() === tab.id
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={isActive() ? colors().focusBg : undefined}
                onMouseUp={() => switchTab(tab.id)}
              >
                <text fg={isActive() ? colors().textBase : colors().textMuted} wrapMode="none">
                  {isActive() ? `[${tab.label}]` : ` ${tab.label} `}
                </text>
              </box>
            )
          }}
        </For>
      </box>

      <Show when={props.error()}>
        {(err) => (
          <text fg={colors().error} wrapMode="none">
            Error: {err()}
          </text>
        )}
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
          <box flexDirection="column">
            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={colors().textBase} wrapMode="none" flexGrow={1} minWidth={0}>
                <b>Session:</b> {snap().resolvedSessionID} · {snap().sessionTitle}
              </text>
              <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                <b>Gate:</b> {snap().gateLabel ?? snap().verificationState}
              </text>
            </box>

            <box flexDirection="row" justifyContent="space-between" gap={2}>
              <text fg={colors().textBase} wrapMode="none" flexGrow={1} minWidth={0}>
                Working Memory: {snap().counts.freshFiles} FRESH · {snap().counts.sliceFiles} SLICE ·{" "}
                {snap().counts.staleFiles} STALE · {snap().counts.activeSkills} ACTIVE skills
              </text>
              <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                {snap().counts.codeFiles} files · {snap().counts.codeSymbols} syms ({snap().counts.hiddenCochangePairs} HIDDEN)
              </text>
            </box>

            <Show when={snap().tokenEconomics}>
              {(econ) => (
                <text fg={colors().success} wrapMode="none">
                  Token Economics: AST estimate {econ().rawTokensTotal}-&gt;{econ().skeletonTokensTotal}t ({
                    econ().compressionPct
                  }% smaller) · Pruned: {econ().valveSavedTokens}t
                </text>
              )}
            </Show>

            <Show when={snap().staleAlerts.length > 0}>
              <box flexDirection="column" paddingTop={1}>
                <text fg={colors().warning} wrapMode="none">
                  <b>Stale Ledger Alerts ({snap().staleAlerts.length})</b>
                </text>
                <For each={snap().staleAlerts.slice(0, 2)}>
                  {(alert) => (
                    <text fg={colors().warning} wrapMode="none">
                      - {alert.path}#{alert.lineRange} → {alert.status}
                    </text>
                  )}
                </For>
              </box>
            </Show>

            <Show when={markdownLines().length === 0}>
              <Show when={snap().topCentralFiles.length > 0}>
                <box flexDirection="column" paddingTop={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>Top PageRank RepoMap Files</b>
                  </text>
                  <For each={snap().topCentralFiles.slice(0, 3)}>
                    {(file, idx) => (
                      <box
                        flexDirection="row"
                        justifyContent="space-between"
                        gap={1}
                        backgroundColor={idx() === selectedFileIdx() ? colors().focusBg : undefined}
                      >
                        <text
                          fg={idx() === selectedFileIdx() ? colors().textBase : colors().textMuted}
                          wrapMode="none"
                          flexGrow={1}
                          minWidth={0}
                        >
                          {idx() === selectedFileIdx() ? "▸ " : "  "}
                          {file.path}
                        </text>
                        <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                          {`PR=${file.pagerank.toFixed(3)} · ${file.loc}L`}
                        </text>
                      </box>
                    )}
                  </For>
                </box>
              </Show>

              <Show when={(selectedFile()?.exportedSymbols?.length ?? 0) > 0}>
                <box flexDirection="column" paddingTop={1}>
                  <text fg={colors().primary} wrapMode="none">
                    <b>Selected File Symbol Outline ({selectedFile()?.path})</b>
                  </text>
                  <For each={(selectedFile()?.exportedSymbols ?? []).slice(0, 3)}>
                    {(sym) => {
                      const tail = cleanSymbolSignatureTail(sym)
                      return (
                        <box flexDirection="row" justifyContent="space-between" gap={1}>
                          <text fg={colors().textBase} wrapMode="none" flexGrow={1} minWidth={0}>
                            <span style={{ fg: colors().primary }}>{`${sym.kind} `}</span>
                            <b>{sym.name}</b>
                            <span style={{ fg: colors().textMuted }}>{tail ? ` ${tail}` : ""}</span>
                          </text>
                          <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                            {`[L${sym.startLine}-L${sym.endLine}] (${sym.lineSpan}L)`}
                          </text>
                        </box>
                      )
                    }}
                  </For>
                </box>
              </Show>
            </Show>
          </box>
        )}
      </Show>

      <Show when={markdownLines().length > 0}>
        <box flexDirection="column" paddingTop={1}>
          <text fg={colors().primary} wrapMode="none">
            <b>
              Active Viewport Output ({props.lastActionOutput()?.action ?? activeTab()} ·{" "}
              {props.lastActionOutput()?.tokenEstimate ?? 0} tok):
            </b>
          </text>
          <For each={markdownLines()}>
            {(line) => (
              <text fg={colors().textBase} wrapMode="none">
                {line || " "}
              </text>
            )}
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
