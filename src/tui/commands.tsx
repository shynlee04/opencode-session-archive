/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import type { SubstrateActionInput } from "../rpc.ts"

export interface SubstrateCommandCallbacks {
  readonly onOpenFullScreen?: () => void
  readonly onOpenPanel?: () => void
  readonly onTogglePanel?: () => void
  readonly onRefresh: () => void | Promise<void>
  readonly onAction: (input: SubstrateActionInput) => void | Promise<void>
  readonly legacyMinimal?: boolean
}

export function buildSubstrateCommands(callbacks: SubstrateCommandCallbacks): KeymapCommand[] {
  const openCmd: KeymapCommand = {
    id: "substrate.open",
    title: "Substrate: Open Mudball & Architecture Advisor",
    description: "Open the full-screen Hivemind Substrate Mudball & Architecture Advisor view",
    group: "Substrate",
    bind: "ctrl+shift+s",
    palette: true,
    suggested: true,
    slash: { name: "substrate" },
    run() {
      callbacks.onOpenFullScreen?.()
      void callbacks.onRefresh()
    },
  }

  const syncCmd: KeymapCommand = {
    id: "substrate.sync",
    title: "Substrate: Sync Archive & Honeycomb",
    description: "Synchronize session archive, AST CodeGraph, PageRank, and Git co-change matrix",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-sync" },
    run() {
      void callbacks.onAction({ action: "sync" })
    },
  }

  const provenanceCmd: KeymapCommand = {
    id: "substrate.provenance",
    title: "Substrate: Reconcile Provenance & Staleness",
    description: "Reconcile working-tree file slices and provenance chains against disk SHA-256",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-provenance" },
    run() {
      callbacks.onOpenFullScreen?.()
      void callbacks.onAction({ action: "provenance" })
    },
  }

  const pruneCmd: KeymapCommand = {
    id: "substrate.prune",
    title: "Substrate: Prune Working Set",
    description: "Trigger manual working-set valve pruning and refresh staleness state",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-prune" },
    run() {
      void callbacks.onAction({ action: "prune", mode: "manual" })
    },
  }

  const briefCmd: KeymapCommand = {
    id: "substrate.brief",
    title: "Substrate: Generate Implementor Brief",
    description: "Assemble a 4-tier Implementor Viewport Brief for child delegation",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-brief" },
    run() {
      callbacks.onOpenFullScreen?.()
      void callbacks.onAction({ action: "brief" })
    },
  }

  if (callbacks.legacyMinimal) {
    return [openCmd, syncCmd, provenanceCmd, pruneCmd, briefCmd]
  }

  const panelCmd: KeymapCommand = {
    id: "substrate.panel",
    title: "Substrate: Toggle Session Inspector Panel",
    description: "Toggle the compact Hivemind Substrate right-hand session inspector panel",
    group: "Substrate",
    bind: "ctrl+alt+s",
    palette: true,
    slash: { name: "substrate-panel" },
    run() {
      if (callbacks.onTogglePanel) {
        callbacks.onTogglePanel()
      } else {
        callbacks.onOpenPanel?.()
      }
      void callbacks.onRefresh()
    },
  }

  const repomapCmd: KeymapCommand = {
    id: "substrate.repomap",
    title: "Substrate: Open RepoMap & Mudball Advisor",
    description: "Open PageRank RepoMap and Mudball architectural hotspot advisor",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-repomap" },
    run() {
      callbacks.onOpenFullScreen?.()
      void callbacks.onAction({ action: "repomap" })
    },
  }

  const compactionCmd: KeymapCommand = {
    id: "substrate.compaction",
    title: "Substrate: Preview Compaction Continuity",
    description: "Synthesize and preview deterministic compaction continuity packet",
    group: "Substrate",
    palette: true,
    slash: { name: "substrate-compaction" },
    run() {
      callbacks.onOpenFullScreen?.()
      void callbacks.onAction({ action: "compaction" })
    },
  }

  return [
    openCmd,
    panelCmd,
    pruneCmd,
    repomapCmd,
    provenanceCmd,
    compactionCmd,
    syncCmd,
    briefCmd,
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
