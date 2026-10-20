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
  readonly raisedBg?: any
  readonly raisedHighBg?: any
  readonly focusBg?: any
}

export const EMPTY_BORDER_CHARS = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
}

export const SPLIT_BORDER_CHARS = {
  ...EMPTY_BORDER_CHARS,
  vertical: "┃",
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
    raisedBg: t?.background?.raised?.base ?? "#111827",
    raisedHighBg: t?.background?.raised?.high ?? "#1e293b",
    focusBg: t?.background?.action?.primary?.focused ?? "#1e3a5f",
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

  const gateShort = createMemo(() => {
    const snap = props.snapshot()
    if (!snap) return "IDLE"
    const c = snap.counts
    if (c.staleFiles > 0 || c.staleChains > 0) return "NEEDS RE-VERIFY"
    return snap.gateLabel?.split(" (")[0] ?? "UNVERIFIED"
  })

  const statusColor = createMemo(() => {
    const c = colors()
    if (props.error?.()) return c.error
    const snap = props.snapshot()
    if (!snap) return c.textMuted
    if (snap.counts.staleFiles > 0 || snap.counts.staleChains > 0) return c.warning
    return snap.gateLabel?.startsWith("PASS") ? c.success : c.textMuted
  })

  const fallbackText = createMemo(() => {
    if (props.error?.()) return "Substrate: offline"
    return props.loading?.() ? "Substrate: syncing…" : "Substrate: idle"
  })

  return (
    <box flexDirection="row" gap={1} flexShrink={1} minWidth={0}>
      <text fg={statusColor()} flexShrink={0} wrapMode="none">
        ●
      </text>
      <Show
        when={props.snapshot()}
        fallback={
          <text fg={colors().textMuted} wrapMode="none">
            {fallbackText()}
          </text>
        }
      >
        {(snap) => {
          const c = () => snap().counts
          const mudballCount = () => snap().mudballHotspots?.length ?? 0
          const compressionPct = () => snap().tokenEconomics?.compressionPct ?? 0
          const prunedTokens = () =>
            snap().tokenEconomics?.valveSavedTokens ?? snap().latestValuation?.savedTokens ?? 0
          return (
            <text fg={colors().textMuted} wrapMode="none" flexShrink={1} minWidth={0}>
              <span style={{ fg: colors().textBase }}>
                <b>Substrate</b>
              </span>
              {" · "}
              <span style={{ fg: statusColor() }}>{`Gate: ${gateShort()}`}</span>
              {` · Files: ${c().freshFiles}F ${c().sliceFiles}P ${c().staleFiles}S · Mudball alerts: ${mudballCount()} · AST est.: ${compressionPct()}% smaller · Pruned: ${prunedTokens()} tok`}
            </text>
          )
        }}
      </Show>
    </box>
  )
}

export const SubstrateFooterStatus = SubstrateStatusPill
