#!/usr/bin/env bun
/**
 * Live change-set trace harness.
 *
 * Read-only against the real git worktree and the real OpenCode host DB.
 * No archive sync, no writes, no synthetic fixtures.
 *
 *   bun scripts/trace-live.ts --root /path/to/worktree --session ses_...
 *   bun scripts/trace-live.ts --root /path/to/worktree --commit <sha>
 *   bun scripts/trace-live.ts --root /path/to/worktree --leaf <change>:source
 */

import os from "node:os"
import path from "node:path"
import { estimateTokens } from "../src/changes/model.ts"
import { buildTrace, renderTraceLeaf, renderTracePackage } from "../src/changes/trace.ts"

interface Args {
  root: string
  sessionID?: string
  dbPath: string
  commit?: string
  leaf?: string
  branch?: string
  filePath?: string
  json: boolean
}

function defaultDbPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  return process.env.OPENCODE_DB ?? path.join(dataHome, "opencode", "opencode.db")
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    root: process.cwd(),
    dbPath: defaultDbPath(),
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === "--root") args.root = path.resolve(next() ?? args.root)
    else if (arg === "--session") args.sessionID = next()
    else if (arg === "--db") args.dbPath = path.resolve(next() ?? args.dbPath)
    else if (arg === "--commit") args.commit = next()
    else if (arg === "--leaf") args.leaf = next()
    else if (arg === "--branch") args.branch = next()
    else if (arg === "--path") args.filePath = next()
    else if (arg === "--json") args.json = true
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: bun scripts/trace-live.ts [--root DIR] [--session ID] [--db PATH] [--commit SHA] [--leaf HANDLE] [--branch NAME] [--path FILE] [--json]")
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

const args = parseArgs(Bun.argv.slice(2))
const started = performance.now()

try {
  const trace = buildTrace({
    root: args.root,
    hostDbPath: args.dbPath,
    sessionID: args.sessionID,
    commit: args.commit,
  })
  const elapsed = Math.round(performance.now() - started)
  const leaf = args.leaf || args.branch
    ? renderTraceLeaf(trace, args.leaf, args.branch, args.filePath)
    : null

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          mode: trace.mode,
          root: trace.root,
          change: trace.change,
          signal: trace.signal,
          package: trace.packageMarkdown,
          leaf: leaf ? JSON.parse(leaf) : null,
          coverage: trace.coverage,
          notes: trace.notes,
          ledger: {
            sessionID: trace.ledger.sessionID,
            rootSession: trace.ledger.rootSession,
            sessions: trace.ledger.sessions.length,
            entries: trace.ledger.entries.length,
            fragments: trace.ledger.fragments,
            skippedOutsideRoot: trace.ledger.skippedOutsideRoot,
          },
          metrics: {
            elapsedMs: elapsed,
            packageTokens: estimateTokens(trace.packageMarkdown),
            signalTokens: estimateTokens(trace.signal ?? ""),
          },
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`trace ${trace.mode} ${trace.root}`)
    console.log(
      `session ${trace.ledger.sessionID || "(none)"} root ${trace.ledger.rootSession || "(none)"} actors ${trace.ledger.sessions.length} ledger-entries ${trace.ledger.entries.length}`,
    )
    console.log(`change ${trace.change.id} ${trace.change.state} ${trace.change.branch}`)
    console.log(
      `coverage files ${trace.coverage.files} actors ${trace.coverage.actors}/${trace.coverage.sessions} missingFiles=${trace.coverage.missingFiles.length} missingActors=${trace.coverage.missingActors.length}`,
    )
    console.log(
      `metrics elapsedMs=${elapsed} packageTokens=${estimateTokens(trace.packageMarkdown)} signalTokens=${estimateTokens(trace.signal ?? "")} fragments=${trace.ledger.fragments} outside=${trace.ledger.skippedOutsideRoot}`,
    )
    console.log("signal:")
    console.log(trace.signal ?? "(none)")
    console.log("package:")
    console.log(renderTracePackage(trace))
    if (leaf) {
      console.log("leaf:")
      console.log(leaf)
    }
  }

  const ok = trace.coverage.missingFiles.length === 0 && trace.coverage.missingActors.length === 0
  if (!ok) {
    console.error(
      `KILL: missing files=[${trace.coverage.missingFiles.join(", ")}] missing actors=[${trace.coverage.missingActors.join(", ")}]`,
    )
    process.exit(1)
  }
  console.log(
    `VERDICT: OK — ${trace.coverage.files} files and ${trace.coverage.actors} actors are all present in the change model`,
  )
} catch (err) {
  console.error(`KILL: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
