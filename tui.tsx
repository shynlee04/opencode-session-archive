/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
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
import { SubstrateCommands, buildSubstrateCommands, registerSubstrateCommands } from "./src/tui/commands.tsx"
import { SubstratePanel, renderSubstrateSlotHarness } from "./src/tui/panel.tsx"
import { SubstrateSidebarSection } from "./src/tui/sidebar.tsx"
import { SubstrateStatusPill } from "./src/tui/status.tsx"

export const SUBSTRATE_PANEL_SLOT_ID = "hivemind-substrate.panel"
export const SUBSTRATE_SIDEBAR_SLOT_ID = "hivemind-substrate.sidebar"
export const SUBSTRATE_STATUS_SLOT_ID = "hivemind-substrate.status"

interface NormalizedRpcHandle {
  snapshot(input: SubstrateSnapshotInput): Promise<SubstrateSnapshotOutput>
  action(input: SubstrateActionInput): Promise<SubstrateActionOutput>
  onUpdated(handler: (evt: SubstrateUpdatedEvent) => void): () => void
}

function connectSubstrateRpc(context: Plugin.Context): NormalizedRpcHandle | null {
  const clientAny = (context as any).client
  if (typeof clientAny?.rpc === "function") {
    const rpcClient = clientAny.rpc(substrateRpcContract)
    return {
      snapshot: (input) => rpcClient.snapshot(input),
      action: (input) => rpcClient.action(input),
      onUpdated: (handler) =>
        typeof rpcClient.on === "function"
          ? rpcClient.on(SUBSTRATE_UPDATED_EVENT, handler)
          : () => {},
    }
  }
  const legacyRpc = (context as any).rpc
  if (typeof legacyRpc?.client === "function") {
    const rpcClient = legacyRpc.client(substrateRpcContract)
    return {
      snapshot: (input) =>
        typeof rpcClient.snapshot === "function"
          ? rpcClient.snapshot(input)
          : rpcClient.call("snapshot", input),
      action: (input) =>
        typeof rpcClient.action === "function"
          ? rpcClient.action(input)
          : rpcClient.call("action", input),
      onUpdated: (handler) =>
        typeof rpcClient.on === "function"
          ? rpcClient.on(SUBSTRATE_UPDATED_EVENT, handler)
          : () => {},
    }
  }
  return null
}

export async function setup(context: Plugin.Context): Promise<() => void> {
  const [snapshot, setSnapshot] = createSignal<SubstrateSnapshotOutput | null>(null)
  const [lastActionOutput, setLastActionOutput] = createSignal<SubstrateActionOutput | null>(null)
  const [loading, setLoading] = createSignal<boolean>(false)
  const [error, setError] = createSignal<string | null>(null)

  const rpc = connectSubstrateRpc(context)
  const cleanups: Array<() => void> = []

  const refreshSnapshot = async (sessionID?: string) => {
    if (!rpc) return
    setLoading(true)
    try {
      const snap = await rpc.snapshot(sessionID ? { sessionID } : {})
      setSnapshot(snap)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const runAction = async (input: SubstrateActionInput) => {
    if (!rpc) return
    setLoading(true)
    try {
      const out = await rpc.action(input)
      setLastActionOutput(out)
      if (out.snapshot) {
        setSnapshot(out.snapshot)
      } else {
        await refreshSnapshot(input.sessionID)
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  if (rpc) {
    cleanups.push(
      rpc.onUpdated((evt) => {
        void refreshSnapshot(evt?.sessionID)
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
    onOpenPanel: () => {
      context.ui?.panel?.open?.(SUBSTRATE_RPC_ID)
    },
    onRefresh: () => refreshSnapshot(),
    onAction: (input: SubstrateActionInput) => runAction(input),
  }

  if (typeof context.keymap?.layer === "function") {
    registerSubstrateCommands(context, commandCallbacks)
  }

  if (typeof context.ui?.slot === "function") {
    cleanups.push(
      context.ui.slot({
        append: "session.panel",
        render: (input) => {
          if (input.name && input.name !== SUBSTRATE_RPC_ID && input.name !== SUBSTRATE_PANEL_SLOT_ID) {
            return null as any
          }
          return (
            <SubstratePanel
              context={context}
              snapshot={snapshot}
              lastActionOutput={lastActionOutput}
              loading={loading}
              error={error}
              onRefresh={() => refreshSnapshot(input.sessionID)}
              onAction={(act) => runAction({ ...act, sessionID: act.sessionID ?? input.sessionID })}
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
  SubstratePanel,
  SubstrateSidebarSection,
  SubstrateStatusPill,
  buildSubstrateCommands,
  registerSubstrateCommands,
  renderSubstrateSlotHarness,
}
