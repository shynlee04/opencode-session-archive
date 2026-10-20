/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Route } from "@opencode/plugin/tui/context"
import { createEffect, createSignal, on } from "solid-js"
import {
  SUBSTRATE_RPC_ID,
  SUBSTRATE_UPDATED_EVENT,
  type SubstrateActionInput,
  type SubstrateActionOutput,
  type SubstrateSnapshotInput,
  type SubstrateSnapshotOutput,
  type SubstrateUpdatedEvent,
  substrateRpcContract,
} from "./src/rpc.ts"
import {
  SubstrateCommands,
  buildSubstrateCommands,
  registerSubstrateCommands,
} from "./src/tui/commands.tsx"
import { SubstratePanel, renderSubstrateSlotHarness } from "./src/tui/panel.tsx"
import { SubstrateSidebar, SubstrateSidebarSection } from "./src/tui/sidebar.tsx"
import { SubstrateFooterStatus, SubstrateStatusPill } from "./src/tui/status.tsx"
import { SubstrateView } from "./src/tui/view.tsx"

export const SUBSTRATE_ROUTE_NAME = "substrate"
export const SUBSTRATE_PANEL_SLOT_ID = "hivemind-substrate.panel"
export const SUBSTRATE_INSPECTOR_PANEL_ID = "substrate.inspector"
export const SUBSTRATE_SIDEBAR_SLOT_ID = "hivemind-substrate.sidebar"
export const SUBSTRATE_STATUS_SLOT_ID = "hivemind-substrate.status"

interface NormalizedRpcHandle {
  snapshot(input: SubstrateSnapshotInput): Promise<SubstrateSnapshotOutput>
  action(input: SubstrateActionInput): Promise<SubstrateActionOutput>
  onUpdated(handler: (evt: SubstrateUpdatedEvent) => void): () => void
}

function readLocationDirectory(context: Plugin.Context): string | undefined {
  const loc = (context as any).location
  if (!loc) return undefined
  const rawDir = typeof loc.directory === "function" ? loc.directory() : loc.directory
  if (typeof rawDir === "string" && rawDir.trim().length > 0) return rawDir.trim()
  const rawWorktree = typeof loc.worktree === "function" ? loc.worktree() : loc.worktree
  if (typeof rawWorktree === "string" && rawWorktree.trim().length > 0) return rawWorktree.trim()
  return undefined
}

function connectSubstrateRpc(context: Plugin.Context): NormalizedRpcHandle | null {
  const buildCallOptions = () => {
    const dir = readLocationDirectory(context)
    return dir ? { location: { directory: dir } } : undefined
  }

  const subscribeUpdated = (
    rpcClient: any,
    handler: (evt: SubstrateUpdatedEvent) => void,
  ): (() => void) => {
    if (typeof rpcClient?.events?.on === "function") {
      return rpcClient.events.on(SUBSTRATE_UPDATED_EVENT, (evt: any) => {
        handler((evt && typeof evt === "object" && "data" in evt ? evt.data : evt) as SubstrateUpdatedEvent)
      })
    }
    if (typeof rpcClient?.on === "function") {
      return rpcClient.on(SUBSTRATE_UPDATED_EVENT, (evt: any) => {
        handler((evt && typeof evt === "object" && "data" in evt ? evt.data : evt) as SubstrateUpdatedEvent)
      })
    }
    return () => {}
  }

  const clientAny = (context as any).client
  if (typeof clientAny?.rpc === "function") {
    const rpcClient = clientAny.rpc(substrateRpcContract)
    return {
      snapshot: (input) => {
        const opts = buildCallOptions()
        return opts ? rpcClient.snapshot(input, opts) : rpcClient.snapshot(input)
      },
      action: (input) => {
        const opts = buildCallOptions()
        return opts ? rpcClient.action(input, opts) : rpcClient.action(input)
      },
      onUpdated: (handler) => subscribeUpdated(rpcClient, handler),
    }
  }
  const legacyRpc = (context as any).rpc
  if (typeof legacyRpc?.client === "function") {
    const rpcClient = legacyRpc.client(substrateRpcContract)
    return {
      snapshot: (input) => {
        const opts = buildCallOptions()
        if (typeof rpcClient.snapshot === "function") {
          return opts ? rpcClient.snapshot(input, opts) : rpcClient.snapshot(input)
        }
        return rpcClient.call("snapshot", input)
      },
      action: (input) => {
        const opts = buildCallOptions()
        if (typeof rpcClient.action === "function") {
          return opts ? rpcClient.action(input, opts) : rpcClient.action(input)
        }
        return rpcClient.call("action", input)
      },
      onUpdated: (handler) => subscribeUpdated(rpcClient, handler),
    }
  }
  return null
}

function isSubstratePanelName(name: string | undefined): boolean {
  return (
    name === SUBSTRATE_INSPECTOR_PANEL_ID ||
    name === SUBSTRATE_RPC_ID ||
    name === SUBSTRATE_PANEL_SLOT_ID ||
    name === SUBSTRATE_ROUTE_NAME
  )
}

export async function setup(context: Plugin.Context): Promise<() => void> {
  const [snapshot, setSnapshot] = createSignal<SubstrateSnapshotOutput | null>(null)
  const [lastActionOutput, setLastActionOutput] = createSignal<SubstrateActionOutput | null>(null)
  const [loading, setLoading] = createSignal<boolean>(false)
  const [error, setError] = createSignal<string | null>(null)
  let previousRoute: Route | null = null

  const rpc = connectSubstrateRpc(context)
  const cleanups: Array<() => void> = []
  const router = context.ui?.router
  let snapshotRequest = 0

  const viewedSessionID = (): string | undefined => {
    const route = router?.current()
    if (route?.type === "session") return route.sessionID
    if (route?.type === "plugin" && route.name === SUBSTRATE_ROUTE_NAME && route.id === SUBSTRATE_RPC_ID) {
      return typeof route.data?.sessionID === "string" ? route.data.sessionID : undefined
    }
    return undefined
  }

  const refreshSnapshot = async (sessionID = viewedSessionID()) => {
    if (!rpc) {
      setError("Substrate RPC is unavailable")
      return
    }
    const request = ++snapshotRequest
    setLoading(true)
    try {
      const snap = await rpc.snapshot(sessionID ? { sessionID } : {})
      if (request !== snapshotRequest || (router && sessionID !== viewedSessionID())) return
      setSnapshot(snap)
      setError(null)
    } catch (err) {
      if (request === snapshotRequest) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (request === snapshotRequest) setLoading(false)
    }
  }

  const runAction = async (input: SubstrateActionInput) => {
    const scopedInput = { ...input, sessionID: input.sessionID ?? viewedSessionID() }
    setLoading(true)
    try {
      if (!rpc) throw new Error("Substrate RPC is unavailable")
      const out = await rpc.action(scopedInput)
      context.ui?.toast?.show({
        title: "Substrate",
        message: out.ok ? `${input.action} complete` : out.markdown,
        variant: out.ok ? "success" : "error",
      })
      if (router && scopedInput.sessionID !== viewedSessionID()) return
      setLastActionOutput(out)
      if (!out.ok) {
        setError(out.markdown)
        return
      }
      if (out.snapshot) {
        ++snapshotRequest
        setSnapshot(out.snapshot)
      } else {
        await refreshSnapshot(scopedInput.sessionID)
      }
      setError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      context.ui?.toast?.show({ title: "Substrate", message, variant: "error" })
    } finally {
      setLoading(false)
    }
  }

  const openFullScreen = (sessionID = viewedSessionID()) => {
    if (!router) return
    const current = router.current()
    if (!(current.type === "plugin" && current.name === SUBSTRATE_ROUTE_NAME && current.id === SUBSTRATE_RPC_ID)) {
      previousRoute = current.type === "plugin" ? { ...current, data: { ...current.data } } : { ...current }
    }
    context.ui?.dialog?.clear?.()
    router.navigate({
      type: "plugin",
      name: SUBSTRATE_ROUTE_NAME,
      data: sessionID ? { sessionID } : {},
    })
  }

  const closeFullScreen = () => {
    router?.navigate(previousRoute ?? { type: "home" })
  }

  const openPanel = () => {
    if (context.ui?.panel?.open?.(SUBSTRATE_INSPECTOR_PANEL_ID) === false) {
      context.ui?.toast?.show({ message: "Open a session before opening the Substrate panel", variant: "info" })
    }
  }

  const togglePanel = () => {
    const panelAny = context.ui?.panel as any
    const current = typeof panelAny?.current === "function" ? panelAny.current() : panelAny?.current
    if (current && isSubstratePanelName(current.name)) {
      panelAny?.close?.()
    } else {
      openPanel()
    }
  }

  if (rpc) {
    cleanups.push(
      rpc.onUpdated(() => {
        void refreshSnapshot()
      }),
    )
  }

  if (typeof context.data?.on === "function") {
    cleanups.push(
      context.data.on("session.updated" as any, () => {
        void refreshSnapshot()
      }),
    )
  }

  const commandCallbacks = {
    onOpenFullScreen: () => openFullScreen(),
    onOpenPanel: () => openPanel(),
    onTogglePanel: () => togglePanel(),
    onRefresh: () => refreshSnapshot(),
    onAction: (input: SubstrateActionInput) => runAction(input),
  }

  if (typeof router?.register === "function") {
    const unregisterRoute = router.register({
      name: SUBSTRATE_ROUTE_NAME,
      render: (input: any) => {
        const routeSessionID =
          typeof input?.data?.sessionID === "string" ? input.data.sessionID : undefined
        return (
          <SubstrateView
            context={context}
            sessionID={routeSessionID}
            snapshot={snapshot}
            lastActionOutput={lastActionOutput}
            loading={loading}
            error={error}
            onRefresh={() => refreshSnapshot(routeSessionID)}
            onAction={(act) => runAction({ ...act, sessionID: act.sessionID ?? routeSessionID })}
            onClose={() => closeFullScreen()}
          />
        )
      },
    })
    if (typeof unregisterRoute === "function") {
      cleanups.push(unregisterRoute)
    }
  } else if (typeof context.keymap?.layer === "function") {
    registerSubstrateCommands(context, { ...commandCallbacks, legacyMinimal: true })
  }

  if (typeof context.ui?.slot === "function") {
    if (typeof router?.register === "function") {
      cleanups.push(
        context.ui.slot({
          append: "app" as any,
          render: () => <SubstrateCommands context={context} callbacks={commandCallbacks} />,
        }),
      )
    }

    cleanups.push(
      context.ui.slot({
        append: "session.panel",
        render: (input) => {
          if (input.name !== undefined && !isSubstratePanelName(input.name)) {
            return null as any
          }
          return (
            <SubstratePanel
              context={context}
              focused={(input as any).focused}
              snapshot={snapshot}
              lastActionOutput={lastActionOutput}
              loading={loading}
              error={error}
              onRefresh={() => refreshSnapshot(input.sessionID)}
              onAction={(act) => runAction({ ...act, sessionID: act.sessionID ?? input.sessionID })}
              onOpenFullScreen={() => openFullScreen(input.sessionID)}
            />
          )
        },
      }),
    )
    cleanups.push(
      context.ui.slot({
        append: "sidebar.content",
        render: (input) => (
          <SubstrateSidebarSection
            context={context}
            sessionID={input.sessionID}
            snapshot={snapshot}
            error={error}
          />
        ),
      }),
    )
    cleanups.push(
      context.ui.slot({
        append: "prompt.footer.status",
        render: () => (
          <SubstrateStatusPill
            context={context}
            snapshot={snapshot}
            loading={loading}
            error={error}
          />
        ),
      }),
    )
  }

  createEffect(on(viewedSessionID, () => {
    setSnapshot(null)
    setLastActionOutput(null)
    void refreshSnapshot()
  }, { defer: true }))

  await refreshSnapshot()

  return () => {
    for (const stop of cleanups) {
      try {
        stop()
      } catch {
        // ignore cleanup error
      }
    }
  }
}

export default Plugin.define({
  id: SUBSTRATE_RPC_ID,
  setup,
})

export {
  SubstrateCommands,
  SubstrateFooterStatus,
  SubstratePanel,
  SubstrateSidebar,
  SubstrateSidebarSection,
  SubstrateStatusPill,
  SubstrateView,
  buildSubstrateCommands,
  registerSubstrateCommands,
  renderSubstrateSlotHarness,
}
