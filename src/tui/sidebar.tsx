/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo, createSignal } from "solid-js"
import type { SubstrateSnapshotOutput } from "../rpc.ts"
import { SPLIT_BORDER_CHARS, resolveSubstrateColors } from "./status.tsx"

export interface SubstrateSidebarProps {
  readonly context?: Pick<Plugin.Context, "theme">
  readonly sessionID?: string
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly error?: () => string | null
}

export function SubstrateSidebarSection(props: SubstrateSidebarProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))
  const snap = createMemo(() => props.snapshot())
  const [open, setOpen] = createSignal(true)

  const gateColor = createMemo(() => {
    const c = colors()
    const current = snap()
    if (!current) return c.textMuted
    if (current.counts.staleFiles > 0 || current.counts.staleChains > 0) {
      return c.warning
    }
    const state = current.gateLabel ?? current.verificationState ?? ""
    if (state.startsWith("PASS") || state.includes("passed") || state.includes("fresh")) {
      return c.success
    }
    return c.textMuted
  })

  const gateShort = createMemo(() => {
    const current = snap()
    if (!current) return "IDLE"
    if (current.counts.staleFiles > 0 || current.counts.staleChains > 0) return "NEEDS RE-VERIFY"
    return (current.gateLabel ?? current.verificationState ?? "UNVERIFIED").split(" (")[0] ?? "UNVERIFIED"
  })

  const gateDetail = createMemo(() => {
    const current = snap()
    if (!current) return ""
    if (current.counts.staleFiles > 0 || current.counts.staleChains > 0) {
      return `${current.counts.staleFiles} stale`
    }
    if ((current.gateLabel ?? "").startsWith("PASS")) return "verified fresh"
    return "no receipt"
  })

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => setOpen((prev) => !prev)}
      >
        <text fg={colors().textBase} wrapMode="none">
          {open() ? "▼" : "▶"}
        </text>
        <text fg={colors().textBase} wrapMode="none">
          <b>Substrate</b>
          <Show when={!open() && snap()}>
            {(current) => (
              <span style={{ fg: colors().textMuted }}>
                {` (${gateShort()}, ${current().counts.freshFiles}F ${current().counts.sliceFiles}P ${current().counts.staleFiles}S)`}
              </span>
            )}
          </Show>
        </text>
      </box>

      <Show when={open()}>
        <Show
          when={snap()}
          fallback={
            <text fg={colors().textMuted} wrapMode="none">
              {props.error?.() ? `  • Error: ${props.error?.()}` : "  • Loading substrate index…"}
            </text>
          }
        >
          {(current) => {
            const prunedTokens = () =>
              current().tokenEconomics?.valveSavedTokens ?? current().latestValuation?.savedTokens ?? 0
            const mudballCount = () => current().mudballHotspots?.length ?? 0
            const compressionPct = () => current().tokenEconomics?.compressionPct ?? 0

            return (
              <box flexDirection="column">
                {/* Row 1: Verification Gate */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text fg={gateColor()} flexShrink={0} wrapMode="none">
                    •
                  </text>
                  <text fg={colors().textBase} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>Gate: {gateShort()}</b>
                  </text>
                  <text fg={gateColor()} wrapMode="none" flexShrink={0}>
                    {gateDetail()}
                  </text>
                </box>

                {/* Row 2: Working Memory Files & Skills */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text
                    fg={
                      current().counts.staleFiles > 0
                        ? colors().warning
                        : current().counts.freshFiles + current().counts.sliceFiles > 0
                          ? colors().success
                          : colors().textMuted
                    }
                    flexShrink={0}
                    wrapMode="none"
                  >
                    •
                  </text>
                  <text fg={colors().textBase} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>
                      Files: {current().counts.freshFiles}F {current().counts.sliceFiles}P{" "}
                      {current().counts.staleFiles}S
                    </b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                    {current().counts.activeSkills} Skills
                  </text>
                </box>

                {/* Row 3: Pruned Working-Set & AST Estimate */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text
                    fg={prunedTokens() > 0 ? colors().success : colors().textMuted}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    •
                  </text>
                  <text fg={colors().textBase} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>Pruned: {prunedTokens()} tok</b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                    AST est.: {compressionPct()}%
                  </text>
                </box>

                {/* Row 4: Architecture & Mudball Alerts */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text
                    fg={mudballCount() > 0 ? colors().warning : colors().success}
                    flexShrink={0}
                    wrapMode="none"
                  >
                    •
                  </text>
                  <text fg={colors().textBase} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>Mudball alerts: {mudballCount()}</b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                    {current().counts.hiddenCochangePairs} coupled
                  </text>
                </box>

                {/* Row 5: Codebase Structural Graph */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text fg={colors().primary} flexShrink={0} wrapMode="none">
                    •
                  </text>
                  <text fg={colors().textBase} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    <b>Graph: {current().counts.codeFiles} files</b>
                  </text>
                  <text fg={colors().textMuted} wrapMode="none" flexShrink={0}>
                    {current().counts.codeSymbols} syms
                  </text>
                </box>

                {/* Row 6: Session ID (muted compact reference) */}
                <box flexDirection="row" gap={1} minWidth={0}>
                  <text fg={colors().textMuted} flexShrink={0} wrapMode="none">
                    •
                  </text>
                  <text fg={colors().textMuted} wrapMode="none" flexGrow={1} flexShrink={1} minWidth={0}>
                    Session: {current().resolvedSessionID || props.sessionID || "none"}
                  </text>
                </box>

                <Show when={current().staleAlerts.length > 0}>
                  <box
                    flexDirection="column"
                    marginTop={1}
                    border={["left"]}
                    customBorderChars={SPLIT_BORDER_CHARS}
                    borderColor={colors().warning}
                    paddingLeft={1}
                  >
                    <text fg={colors().warning} wrapMode="none">
                      <b>Stale Slices ({current().staleAlerts.length})</b>
                    </text>
                    <For each={current().staleAlerts.slice(0, 3)}>
                      {(alert) => (
                        <text fg={colors().textMuted} wrapMode="none">
                          <span style={{ fg: colors().warning }}>! </span>
                          {alert.path}#{alert.lineRange}
                        </text>
                      )}
                    </For>
                  </box>
                </Show>
              </box>
            )
          }}
        </Show>
      </Show>
    </box>
  )
}

export const SubstrateSidebar = SubstrateSidebarSection
