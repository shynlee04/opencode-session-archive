import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { HostMessageRow, HostSessionRow, SpillArtifactRow } from "./types"

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

const SPILL_PATH_REGEX = /full output saved to[:\s]+([^\s\]\n"']+)/i

export function sinkExternalSpills(
  sessions: readonly HostSessionRow[],
  messagesBySession: ReadonlyMap<string, readonly HostMessageRow[]>,
  opencodeDataDir: string,
  sinkBuffer: (content: Buffer) => string,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): SpillArtifactRow[] {
  const spills: SpillArtifactRow[] = []

  for (const session of sessions) {
    const msgs = messagesBySession.get(session.id) ?? []
    for (const msg of msgs) {
      if (msg.type !== "assistant") continue
      for (const rawPart of asArr(msg.data.content)) {
        const part = asObj(rawPart)
        if (part.type !== "tool") continue
        const callId = asStr(part.id) ?? ""
        const toolName = asStr(part.name) ?? "tool"
        const state = asObj(part.state)
        const meta = asObj(state.metadata)
        const inlineText = asArr(state.content)
          .flatMap((c) => {
            const obj = asObj(c)
            return typeof obj.text === "string" ? [obj.text] : []
          })
          .join("")

        const candidates: Array<{ path: string; kind: "tool-output" | "shell" }> = []
        const metaPath = asStr(meta.outputPath)
        if (metaPath) {
          candidates.push({
            path: metaPath,
            kind: metaPath.includes("/shell/") ? "shell" : "tool-output",
          })
        }

        const regexMatch = inlineText.match(SPILL_PATH_REGEX)
        if (regexMatch?.[1]) {
          const matchedPath = regexMatch[1]
          candidates.push({
            path: matchedPath,
            kind: matchedPath.includes("/shell/") ? "shell" : "tool-output",
          })
        }

        if (callId.length > 0) {
          const cleanId = callId.replace(/^tool_/, "")
          candidates.push(
            {
              path: path.join(opencodeDataDir, "tool-output", `tool_${cleanId}`),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, "tool-output", callId),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, `tool_${cleanId}`),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, callId),
              kind: "tool-output",
            },
            {
              path: path.join(opencodeDataDir, "shell", `${callId}.txt`),
              kind: "shell",
            },
            {
              path: path.join(opencodeDataDir, "shell", session.project_id, `${callId}.out`),
              kind: "shell",
            },
          )
        }

        for (const cand of candidates) {
          if (existsSync(cand.path) && statSync(cand.path).isFile()) {
            const bytes = readFileSync(cand.path)
            const blobSha = sinkBuffer(bytes)
            spills.push({
              session_id: session.id,
              call_id: callId || path.basename(cand.path),
              message_id: msg.id,
              seq: msg.seq,
              tool_name: toolName,
              spill_kind: cand.kind,
              spill_source: cand.path,
              inline_byte_len: Buffer.byteLength(inlineText, "utf8"),
              full_byte_len: bytes.length,
              blob_sha: blobSha,
              source_origin: sourceOrigin,
            })
            break
          }
        }
      }
    }
  }

  return spills
}
