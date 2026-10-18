/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { For, Show, createMemo } from "solid-js"
import type { SubstrateSnapshotOutput } from "../rpc.ts"
import { resolveSubstrateColors } from "./status.tsx"

export interface SubstrateSidebarProps {
  readonly context?: Pick<Plugin.Context, "theme">
  readonly sessionID?: string
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly error?: () => string | null
}

export function SubstrateSidebarSection(props: SubstrateSidebarProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))
  const snap = createMemo(() => props.snapshot())

  const gateColor = createMemo(() => {
    const c = colors()
    const state = snap()?.verificationState ?? ""
    if (state.includes("stale") || state.includes("failed") || state.includes("blocked")) {
      return c.warning
    }
    if (state.includes("passed") || state.includes("fresh")) {
      return c.success
    }
    return c.textMuted
  })

  return (
    <box flexDirection="column" gap={1}>
      <Show
        when={snap()}
        fallback={
          <text fg={colors().textMuted}>
            {props.error?.() ? `Substrate error: ${props.error?.()}` : "Substrate: loading index…"}
          </text>
        }
      >
        {(current) => (
          <box flexDirection="column">
            <text fg={colors().textBase}>
              <b>Session:</b> {current().resolvedSessionID || props.sessionID || "none"}
            </text>
            <text fg={gateColor()}>
              <b>Gate:</b> {current().verificationState}
            </text>
            <text fg={colors().textMuted}>
              Memory: {current().counts.freshFiles} FRESH ({current().counts.sliceFiles} SLICE) ·{" "}
              {current().counts.staleFiles} STALE · {current().counts.activeSkills} Skills
            </text>
            <text fg={colors().textMuted}>
              Graph: {current().counts.codeFiles} files · {current().counts.codeSymbols} syms ·{" "}
              {current().counts.hiddenCochangePairs} hidden coupled
            </text>
            <Show when={current().latestValuation}>
              {(val) => (
                <text fg={colors().success}>
                  Valve ({val().mode}): -{val().savedTokens} tok ({val().savedChars} chars)
                </text>
              )}
            </Show>
            <Show when={current().staleAlerts.length > 0}>
              <box flexDirection="column" paddingTop={1}>
                <text fg={colors().warning}>
                  <b>Stale Slices ({current().staleAlerts.length}):</b>
                </text>
                <For each={current().staleAlerts.slice(0, 3)}>
                  {(alert) => (
                    <text fg={colors().warning}>
                      ! {alert.path}#{alert.lineRange}
                    </text>
                  )}
                </For>
              </box>
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}
