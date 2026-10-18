/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import { Show, createMemo } from "solid-js"
import type { SubstrateSnapshotOutput } from "../rpc.ts"

export interface SubstrateThemeColors {
  readonly textBase?: any
  readonly textMuted?: any
  readonly primary?: any
  readonly warning?: any
  readonly success?: any
  readonly error?: any
  readonly border?: any
}

export function resolveSubstrateColors(context?: Pick<Plugin.Context, "theme">): SubstrateThemeColors {
  const t = context?.theme as any
  return {
    textBase: t?.text?.base ?? "#e2e8f0",
    textMuted: t?.text?.muted ?? "#94a3b8",
    primary: t?.text?.action?.primary?.base ?? "#38bdf8",
    warning: t?.text?.feedback?.warning?.base ?? "#f59e0b",
    success: t?.text?.feedback?.success?.base ?? "#22c55e",
    error: t?.text?.feedback?.error?.base ?? "#ef4444",
    border: t?.border?.base ?? "#475569",
  }
}

export interface SubstrateStatusProps {
  readonly context?: Pick<Plugin.Context, "theme">
  readonly snapshot: () => SubstrateSnapshotOutput | null
  readonly loading?: () => boolean
  readonly error?: () => string | null
}

export function SubstrateStatusPill(props: SubstrateStatusProps) {
  const colors = createMemo(() => resolveSubstrateColors(props.context))

  const summaryText = createMemo(() => {
    if (props.error?.()) return "Substrate: offline"
    const snap = props.snapshot()
    if (!snap) return props.loading?.() ? "Substrate: syncing…" : "Substrate: idle"
    const c = snap.counts
    const saved = snap.latestValuation?.savedTokens ?? 0
    const staleTag =
      c.staleFiles > 0 || c.staleChains > 0 ? ` · ${c.staleFiles + c.staleChains} STALE` : ""
    const savedTag = saved > 0 ? ` · -${saved}t` : ""
    return `Substrate ${c.freshFiles}F/${c.sliceFiles}S${staleTag}${savedTag}`
  })

  const statusColor = createMemo(() => {
    const c = colors()
    if (props.error?.()) return c.error
    const snap = props.snapshot()
    if (!snap) return c.textMuted
    if (snap.counts.staleFiles > 0 || snap.counts.staleChains > 0) return c.warning
    return c.success
  })

  return (
    <box flexDirection="row" gap={1}>
      <text fg={statusColor()}>●</text>
      <Show
        when={props.snapshot()}
        fallback={<text fg={colors().textMuted}>{summaryText()}</text>}
      >
        <text fg={colors().textBase}>{summaryText()}</text>
      </Show>
    </box>
  )
}
