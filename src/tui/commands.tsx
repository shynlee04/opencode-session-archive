/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import type { SubstrateActionInput } from "../rpc.ts"

export interface SubstrateCommandCallbacks {
  readonly onOpenPanel?: () => void
  readonly onRefresh: () => void | Promise<void>
  readonly onAction: (input: SubstrateActionInput) => void | Promise<void>
}

export function buildSubstrateCommands(callbacks: SubstrateCommandCallbacks): KeymapCommand[] {
  return [
    {
      id: "substrate.open",
      title: "Substrate: Open Inspector",
      description: "Open the Hivemind Substrate working-memory and Honeycomb inspector panel",
      group: "Substrate",
      bind: "ctrl+shift+s",
      palette: true,
      suggested: true,
      slash: { name: "substrate", arguments: true },
      run() {
        callbacks.onOpenPanel?.()
        void callbacks.onRefresh()
      },
    },
    {
      id: "substrate.sync",
      title: "Substrate: Sync Archive & Honeycomb",
      description: "Synchronize session archive, AST CodeGraph, PageRank, and Git co-change matrix",
      group: "Substrate",
      palette: true,
      run() {
        void callbacks.onAction({ action: "sync" })
      },
    },
    {
      id: "substrate.provenance",
      title: "Substrate: Reconcile Provenance & Staleness",
      description: "Reconcile working-tree file slices and provenance chains against disk SHA-256",
      group: "Substrate",
      palette: true,
      run() {
        void callbacks.onAction({ action: "provenance" })
      },
    },
    {
      id: "substrate.prune",
      title: "Substrate: Prune Working Set",
      description: "Trigger manual working-set valve pruning and refresh staleness state",
      group: "Substrate",
      palette: true,
      run() {
        void callbacks.onAction({ action: "prune", mode: "manual" })
      },
    },
    {
      id: "substrate.brief",
      title: "Substrate: Generate Implementor Brief",
      description: "Assemble a 4-tier Implementor Viewport Brief for child delegation",
      group: "Substrate",
      palette: true,
      run() {
        void callbacks.onAction({ action: "brief" })
      },
    },
  ]
}

export function SubstrateCommands(props: {
  readonly context: Pick<Plugin.Context, "keymap">
  readonly callbacks: SubstrateCommandCallbacks
}) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: buildSubstrateCommands(props.callbacks),
  }))
  return null
}

export function registerSubstrateCommands(
  context: Pick<Plugin.Context, "keymap">,
  callbacks: SubstrateCommandCallbacks,
): void {
  context.keymap.layer(() => ({
    mode: "global",
    commands: buildSubstrateCommands(callbacks),
  }))
}
