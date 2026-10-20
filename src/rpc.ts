import type { Rpc } from "@opencode/plugin/rpc"
import type { StandardSchemaV1 } from "@standard-schema/spec"

function schema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "hivemind-substrate",
      validate(value: unknown) {
        return { value: value as T }
      },
    },
  }
}

export const SUBSTRATE_RPC_ID = "hivemind-substrate" as const
export const SUBSTRATE_UPDATED_EVENT = "substrate:updated" as const

export type SubstrateActionKind =
  | "status"
  | "repomap"
  | "skeleton"
  | "slice"
  | "coupled"
  | "provenance"
  | "timeline"
  | "search"
  | "brief"
  | "compaction"
  | "prune"
  | "sync"
  | "trace"

export type SubstrateSnapshotInput = {
  readonly sessionID?: string
}

export type SubstrateSnapshotCounts = {
  readonly sessions: number
  readonly rootSessions: number
  readonly delegations: number
  readonly flaggedDelegations: number
  readonly codeFiles: number
  readonly codeSymbols: number
  readonly cochangePairs: number
  readonly hiddenCochangePairs: number
  readonly freshFiles: number
  readonly sliceFiles: number
  readonly staleFiles: number
  readonly activeSkills: number
  readonly provenanceChains: number
  readonly staleChains: number
  readonly compactions: number
}

export type SubstrateValuationSummary = {
  readonly mode: string
  readonly stepCount: number
  readonly watermarkStepIndex: number
  readonly savedChars: number
  readonly savedTokens: number
}

export type SubstratePivotSummary = {
  readonly seq: number
  readonly pivotKind: string
  readonly excerpt: string
  readonly blobRef: string
}

export type SubstrateStaleAlertSummary = {
  readonly path: string
  readonly lineRange: string
  readonly status: string
}

export type SubstrateSymbolOutlineItem = {
  readonly name: string
  readonly kind: string
  readonly startLine: number
  readonly endLine: number
  readonly lineSpan: number
  readonly signature: string
}

export type SubstrateCentralFileSummary = {
  readonly path: string
  readonly pagerank: number
  readonly loc: number
  readonly inDegree?: number
  readonly outDegree?: number
  readonly rawTokens?: number
  readonly skeletonTokens?: number
  readonly symbolsCount?: number
  readonly exportedSymbols?: readonly SubstrateSymbolOutlineItem[]
}

export type SubstrateMudballHotspotSummary = {
  readonly kind: "god_file" | "god_symbol" | "high_coupling_hub" | "hidden_coupling"
  readonly severity: "warn" | "high"
  readonly target: string
  readonly detail: string
  readonly metric: string
}

export type SubstrateTokenEconomicsSummary = {
  readonly rawTokensTotal: number
  readonly skeletonTokensTotal: number
  readonly skeletonTokensSaved: number
  readonly compressionPct: number
  readonly valveSavedTokens: number
}

export type SubstrateSnapshotOutput = {
  readonly projectRoot: string
  readonly archiveDir: string
  readonly indexDbPath: string
  readonly resolvedSessionID: string
  readonly sessionTitle: string
  readonly verificationState: string
  readonly gateLabel?: string
  readonly counts: SubstrateSnapshotCounts
  readonly latestValuation: SubstrateValuationSummary | null
  readonly recentPivots: readonly SubstratePivotSummary[]
  readonly staleAlerts: readonly SubstrateStaleAlertSummary[]
  readonly topCentralFiles: readonly SubstrateCentralFileSummary[]
  readonly mudballHotspots?: readonly SubstrateMudballHotspotSummary[]
  readonly tokenEconomics?: SubstrateTokenEconomicsSummary
  readonly compactionPreview?: string
  readonly updatedAt: string
}

export type SubstrateActionInput = {
  readonly action: SubstrateActionKind
  readonly sessionID?: string
  readonly path?: string
  readonly targetPaths?: readonly string[]
  readonly symbol?: string
  readonly symbolNames?: readonly string[]
  readonly query?: string
  readonly maxTokens?: number
  readonly mode?: "manual" | "auto" | "off"
  readonly keepRecentSteps?: number
  readonly scope?: "session" | "project" | "all-projects"
  readonly full?: boolean
  readonly includePrivate?: boolean
  readonly change?: string
  readonly handle?: string
  readonly branch?: string
  readonly commit?: string
  readonly detail?: "package" | "leaf"
}

export type SubstrateActionOutput = {
  readonly ok: boolean
  readonly action: SubstrateActionKind
  readonly resolvedSessionID: string
  readonly markdown: string
  readonly tokenEstimate: number
  readonly snapshot?: SubstrateSnapshotOutput
}

export type SubstrateUpdatedEvent = {
  readonly sessionID?: string
  readonly action: string
  readonly updatedAt: string
}

const rpcMethods = {
  snapshot: {
    input: schema<SubstrateSnapshotInput>(),
    output: schema<SubstrateSnapshotOutput>(),
  },
  action: {
    input: schema<SubstrateActionInput>(),
    output: schema<SubstrateActionOutput>(),
  },
} as const

export const substrateRpcContract = {
  id: SUBSTRATE_RPC_ID,
  methods: rpcMethods,
  method: rpcMethods,
  events: {
    [SUBSTRATE_UPDATED_EVENT]: {
      schema: schema<SubstrateUpdatedEvent>(),
    },
  },
  event: {
    [SUBSTRATE_UPDATED_EVENT]: schema<SubstrateUpdatedEvent>(),
  },
} as const satisfies Rpc.PortableDefinition & {
  readonly method: typeof rpcMethods
  readonly event: { readonly [SUBSTRATE_UPDATED_EVENT]: StandardSchemaV1<unknown, SubstrateUpdatedEvent> }
}
