import { createHash } from "node:crypto"
import { existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import type { HostMessageRow, HostSessionRow, SnapshotArtifactRow } from "./types"

function sha1hex(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

function asObj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function asStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined
}

export function resolveShadowRepoDir(
  snapshotRootDir: string,
  projectId: string,
  directory: string,
): string | null {
  const worktreeHash = sha1hex(directory)
  const primary = path.join(snapshotRootDir, projectId, worktreeHash)
  if (existsSync(path.join(primary, "objects"))) return primary

  const legacy = path.join(snapshotRootDir, projectId)
  if (existsSync(path.join(legacy, "objects"))) return legacy

  const projectSnapDir = path.join(snapshotRootDir, projectId)
  if (existsSync(projectSnapDir) && statSync(projectSnapDir).isDirectory()) {
    for (const sub of readdirSync(projectSnapDir)) {
      const candidate = path.join(projectSnapDir, sub)
      if (existsSync(path.join(candidate, "objects"))) return candidate
    }
  }
  return null
}

export function batchExtractGitBlobs(
  shadowRepoDir: string,
  specs: readonly string[],
  sinkBuffer: (content: Buffer) => string,
): Map<string, { readonly gitBlobSha: string; readonly blobSha256: string; readonly byteLen: number }> {
  const result = new Map<
    string,
    { readonly gitBlobSha: string; readonly blobSha256: string; readonly byteLen: number }
  >()
  if (specs.length === 0) return result

  const uniqueSpecs = [...new Set(specs)]
  const proc = Bun.spawnSync(["git", `--git-dir=${shadowRepoDir}`, "cat-file", "--batch"], {
    stdin: Buffer.from(uniqueSpecs.join("\n") + "\n"),
  })
  if (proc.exitCode !== 0) {
    return result
  }

  const out = Buffer.from(proc.stdout)
  let offset = 0
  const sha256ByGitSha = new Map<string, string>()

  for (const spec of uniqueSpecs) {
    const nl = out.indexOf(0x0a, offset)
    if (nl === -1) break
    const header = out.subarray(offset, nl).toString("utf8")
    offset = nl + 1
    if (header.endsWith(" missing")) {
      continue
    }
    const parts = header.split(" ")
    const gitBlobSha = parts[0] ?? ""
    const size = parseInt(parts[2] ?? "0", 10)
    const content = out.subarray(offset, offset + size)
    offset += size + 1

    let blobSha256 = sha256ByGitSha.get(gitBlobSha)
    if (!blobSha256) {
      blobSha256 = sinkBuffer(content)
      sha256ByGitSha.set(gitBlobSha, blobSha256)
    }
    result.set(spec, {
      gitBlobSha,
      blobSha256,
      byteLen: content.length,
    })
  }

  return result
}

export function sinkShadowSnapshots(
  sessions: readonly HostSessionRow[],
  messagesBySession: ReadonlyMap<string, readonly HostMessageRow[]>,
  snapshotRootDir: string,
  sinkBuffer: (content: Buffer) => string,
  sourceOrigin: "host_db" | "wf_sub_r02_fixture" = "host_db",
): SnapshotArtifactRow[] {
  interface PendingSnapshotItem {
    readonly session_id: string
    readonly message_id: string
    readonly seq: number
    readonly path: string
    readonly start_tree_sha: string
    readonly end_tree_sha: string
    readonly start_spec: string
    readonly end_spec: string
  }

  const itemsByRepo = new Map<string, PendingSnapshotItem[]>()

  for (const session of sessions) {
    const shadowRepo = resolveShadowRepoDir(snapshotRootDir, session.project_id, session.directory)
    if (!shadowRepo) continue
    const msgs = messagesBySession.get(session.id) ?? []
    for (const msg of msgs) {
      if (msg.type !== "assistant") continue
      const snap = asObj(msg.data.snapshot)
      const startTree = asStr(snap.start)
      const endTree = asStr(snap.end)
      const files = asArr(snap.files)
      if (!startTree || !endTree || files.length === 0) continue

      let list = itemsByRepo.get(shadowRepo)
      if (!list) {
        list = []
        itemsByRepo.set(shadowRepo, list)
      }
      for (const rawFile of files) {
        const filePath = asStr(rawFile)
        if (!filePath) continue
        list.push({
          session_id: session.id,
          message_id: msg.id,
          seq: msg.seq,
          path: filePath,
          start_tree_sha: startTree,
          end_tree_sha: endTree,
          start_spec: `${startTree}:${filePath}`,
          end_spec: `${endTree}:${filePath}`,
        })
      }
    }
  }

  const artifacts: SnapshotArtifactRow[] = []
  for (const [shadowRepo, items] of itemsByRepo) {
    const allSpecs: string[] = []
    for (const item of items) {
      allSpecs.push(item.start_spec, item.end_spec)
    }
    const resolved = batchExtractGitBlobs(shadowRepo, allSpecs, sinkBuffer)
    for (const item of items) {
      const startBlob = resolved.get(item.start_spec)
      const endBlob = resolved.get(item.end_spec)
      if (!startBlob && !endBlob) continue
      artifacts.push({
        session_id: item.session_id,
        message_id: item.message_id,
        seq: item.seq,
        path: item.path,
        start_tree_sha: item.start_tree_sha,
        end_tree_sha: item.end_tree_sha,
        start_blob_sha: startBlob?.blobSha256 ?? null,
        end_blob_sha: endBlob?.blobSha256 ?? null,
        start_git_blob_sha: startBlob?.gitBlobSha ?? null,
        end_git_blob_sha: endBlob?.gitBlobSha ?? null,
        start_byte_len: startBlob?.byteLen ?? null,
        end_byte_len: endBlob?.byteLen ?? null,
        byte_len: endBlob?.byteLen ?? startBlob?.byteLen ?? 0,
        source_origin: sourceOrigin,
      })
    }
  }

  return artifacts
}
