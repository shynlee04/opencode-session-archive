import { describe, expect, test, afterEach } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveShadowRepoDir, batchExtractGitBlobs, sinkShadowSnapshots } from "../src/archive/snapshots"
import { sinkExternalSpills } from "../src/archive/spills"
import type { HostMessageRow, HostSessionRow } from "../src/archive/types"

const temps: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length > 0) {
    const d = temps.pop()!
    rmSync(d, { recursive: true, force: true })
  }
})

function sha1hex(text: string): string {
  return createHash("sha1").update(text).digest("hex")
}

function sha256hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex")
}

function createFixtureShadowBareRepo(
  snapshotRoot: string,
  projectId: string,
  worktreeDir: string,
  treeSpecs: ReadonlyArray<Record<string, string>>,
): { readonly repoDir: string; readonly treeShas: string[] } {
  const repoDir = path.join(snapshotRoot, projectId, sha1hex(worktreeDir))
  mkdirSync(repoDir, { recursive: true })
  Bun.spawnSync(["git", "init", "--bare", repoDir])

  const treeShas: string[] = []
  for (let i = 0; i < treeSpecs.length; i++) {
    const files = treeSpecs[i]!
    const indexPath = path.join(repoDir, `index-${i}`)
    const env = { ...process.env, GIT_INDEX_FILE: indexPath }

    for (const [relPath, content] of Object.entries(files)) {
      const hashProc = Bun.spawnSync(["git", `--git-dir=${repoDir}`, "hash-object", "-w", "--stdin"], {
        stdin: Buffer.from(content, "utf8"),
        env,
      })
      const blobSha = Buffer.from(hashProc.stdout).toString("utf8").trim()
      Bun.spawnSync(
        ["git", `--git-dir=${repoDir}`, "update-index", "--add", "--cacheinfo", `100644,${blobSha},${relPath}`],
        { env },
      )
    }

    const treeProc = Bun.spawnSync(["git", `--git-dir=${repoDir}`, "write-tree"], { env })
    treeShas.push(Buffer.from(treeProc.stdout).toString("utf8").trim())
  }

  return { repoDir, treeShas }
}

describe("TWM-03: REQ-SUB-05 shadow snapshots & external spills", () => {
  test("sinkShadowSnapshots extracts both start and end file blobs via git cat-file --batch and memoizes gitBlobSha -> sha256", () => {
    const snapshotRoot = tempDir("twm03-snap-")
    const projectId = "proj_snap_test"
    const directory = "/workspace/hivemind-substrate"

    const v1Content = "export const VERSION = 1\n"
    const v2Content = "export const VERSION = 2\n"
    const unchangedContent = "export const UNCHANGED = true\n"

    const { repoDir, treeShas } = createFixtureShadowBareRepo(snapshotRoot, projectId, directory, [
      {
        "src/version.ts": v1Content,
        "src/constants.ts": unchangedContent,
      },
      {
        "src/version.ts": v2Content,
        "src/constants.ts": unchangedContent,
      },
    ])

    expect(resolveShadowRepoDir(snapshotRoot, projectId, directory)).toBe(repoDir)

    const session: HostSessionRow = {
      id: "ses_snap_1",
      project_id: projectId,
      parent_id: null,
      slug: "snap-1",
      directory,
      title: "Snapshot Session",
      version: "2.0.32",
      time_created: 1000,
      time_updated: 2000,
    }

    const messages: HostMessageRow[] = [
      {
        id: "msg_asst_1",
        session_id: "ses_snap_1",
        seq: 1,
        type: "assistant",
        time_created: 1100,
        time_updated: 1200,
        data: {
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          content: [{ type: "text", text: "Updated version.ts" }],
          snapshot: {
            start: treeShas[0]!,
            end: treeShas[1]!,
            files: ["src/version.ts", "src/constants.ts"],
          },
        },
      },
    ]

    const sunkBuffers = new Map<string, string>()
    let sinkCalls = 0
    const sinkBuffer = (buf: Buffer): string => {
      sinkCalls += 1
      const sha = sha256hex(buf)
      sunkBuffers.set(sha, buf.toString("utf8"))
      return sha
    }

    const artifacts = sinkShadowSnapshots(
      [session],
      new Map([[session.id, messages]]),
      snapshotRoot,
      sinkBuffer,
    )

    expect(artifacts).toHaveLength(2)

    const versionArt = artifacts.find((a) => a.path === "src/version.ts")!
    expect(versionArt).toBeDefined()
    expect(versionArt.start_tree_sha).toBe(treeShas[0]!)
    expect(versionArt.end_tree_sha).toBe(treeShas[1]!)
    expect(versionArt.start_blob_sha).toBe(sha256hex(v1Content))
    expect(versionArt.end_blob_sha).toBe(sha256hex(v2Content))
    expect(sunkBuffers.get(versionArt.start_blob_sha!)).toBe(v1Content)
    expect(sunkBuffers.get(versionArt.end_blob_sha!)).toBe(v2Content)
    expect(versionArt.start_git_blob_sha).not.toBe(versionArt.end_git_blob_sha)

    const constArt = artifacts.find((a) => a.path === "src/constants.ts")!
    expect(constArt).toBeDefined()
    expect(constArt.start_blob_sha).toBe(sha256hex(unchangedContent))
    expect(constArt.end_blob_sha).toBe(sha256hex(unchangedContent))
    expect(constArt.start_git_blob_sha).toBe(constArt.end_git_blob_sha)

    // Memoization check: 3 distinct git blobs (v1, v2, unchanged) -> sinkBuffer called exactly 3 times across 4 tree:path specs
    expect(sinkCalls).toBe(3)
  })

  test("sinkExternalSpills recovers full tool-output and shell spill files across metadata, regex, and callId conventions", () => {
    const dataDir = tempDir("twm03-spills-")
    const toolOutDir = path.join(dataDir, "tool-output")
    const shellDir = path.join(dataDir, "shell")
    mkdirSync(toolOutDir, { recursive: true })
    mkdirSync(shellDir, { recursive: true })

    const fullToolOutput1 = "LINE_1\n".repeat(3000) + "FINAL_MARKER_TOOL_1\n"
    const spillFile1 = path.join(toolOutDir, "tool_call_by_id")
    writeFileSync(spillFile1, fullToolOutput1, "utf8")

    const fullShellOutput2 = "BUILD_LOG_LINE\n".repeat(2500) + "EXIT_CODE_0\n"
    const spillFile2 = path.join(shellDir, "call_shell_regex.txt")
    writeFileSync(spillFile2, fullShellOutput2, "utf8")

    const fullMetaOutput3 = "METADATA_SPILL_CONTENT\n".repeat(1500)
    const spillFile3 = path.join(toolOutDir, "custom_meta_spill.log")
    writeFileSync(spillFile3, fullMetaOutput3, "utf8")

    const session: HostSessionRow = {
      id: "ses_spill_1",
      project_id: "proj_spill_test",
      parent_id: null,
      slug: "spill-1",
      directory: "/workspace/hivemind-substrate",
      title: "Spill Session",
      version: "2.0.32",
      time_created: 1000,
      time_updated: 2000,
    }

    const messages: HostMessageRow[] = [
      {
        id: "msg_spill_1",
        session_id: "ses_spill_1",
        seq: 1,
        type: "assistant",
        time_created: 1100,
        time_updated: 1200,
        data: {
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
          content: [
            {
              type: "tool",
              id: "call_by_id",
              name: "grep",
              state: {
                status: "completed",
                input: { pattern: "LINE" },
                content: [{ type: "text", text: "Truncated inline preview..." }],
              },
            },
            {
              type: "tool",
              id: "call_regex_only",
              name: "bash",
              state: {
                status: "completed",
                input: { command: "bun run build" },
                content: [
                  {
                    type: "text",
                    text: `Output truncated.\nFull output saved to: ${spillFile2}\n`,
                  },
                ],
              },
            },
            {
              type: "tool",
              id: "call_meta_path",
              name: "read",
              state: {
                status: "completed",
                input: { filePath: "big.log" },
                metadata: { outputPath: spillFile3 },
                content: [{ type: "text", text: "Preview only" }],
              },
            },
          ],
        },
      },
    ]

    const sunkBuffers = new Map<string, string>()
    const sinkBuffer = (buf: Buffer): string => {
      const sha = sha256hex(buf)
      sunkBuffers.set(sha, buf.toString("utf8"))
      return sha
    }

    const spills = sinkExternalSpills(
      [session],
      new Map([[session.id, messages]]),
      dataDir,
      sinkBuffer,
    )

    expect(spills).toHaveLength(3)

    const byId = spills.find((s) => s.call_id === "call_by_id")!
    expect(byId.spill_kind).toBe("tool-output")
    expect(byId.spill_source).toBe(spillFile1)
    expect(byId.full_byte_len).toBe(Buffer.byteLength(fullToolOutput1, "utf8"))
    expect(byId.blob_sha).toBe(sha256hex(fullToolOutput1))
    expect(sunkBuffers.get(byId.blob_sha)).toBe(fullToolOutput1)

    const byRegex = spills.find((s) => s.call_id === "call_regex_only")!
    expect(byRegex.spill_kind).toBe("shell")
    expect(byRegex.spill_source).toBe(spillFile2)
    expect(byRegex.full_byte_len).toBe(Buffer.byteLength(fullShellOutput2, "utf8"))
    expect(byRegex.blob_sha).toBe(sha256hex(fullShellOutput2))
    expect(sunkBuffers.get(byRegex.blob_sha)).toBe(fullShellOutput2)

    const byMeta = spills.find((s) => s.call_id === "call_meta_path")!
    expect(byMeta.spill_kind).toBe("tool-output")
    expect(byMeta.spill_source).toBe(spillFile3)
    expect(byMeta.full_byte_len).toBe(Buffer.byteLength(fullMetaOutput3, "utf8"))
    expect(byMeta.blob_sha).toBe(sha256hex(fullMetaOutput3))
  })
})
