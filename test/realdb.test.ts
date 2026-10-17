import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { persist, sqliteSource } from "../src/archive/index.ts"
import { makeTmpDir } from "./helpers.ts"

// Opt-in drive against the real host DB: ARCHIVE_REAL_DB=1 bun test test/realdb.test.ts
const REAL = Bun.env.ARCHIVE_REAL_DB === "1"
const DB_PATH = `${Bun.env.HOME}/.local/share/opencode/opencode.db`
const REAL_ROOT = "ses_eb514ea32ffevrKDhWYxGBcpA9"
const REAL_PROJECT = "968fc8714005c10a127661f760f5035e2a51cb0e"

const realTest = REAL ? test : test.skip

describe("real host database (ARCHIVE_REAL_DB=1)", () => {
  realTest("persists the real session tree with resolvable blob refs and a queryable index", () => {
    const projectRoot = makeTmpDir()
    const source = sqliteSource(DB_PATH)
    const report = persist(
      { sessionID: REAL_ROOT, projectID: REAL_PROJECT, projectRoot },
      source,
    )
    source.close()

    expect(report.rootID).toBe(REAL_ROOT)
    expect(report.sessions).toBeGreaterThan(0)
    expect(report.messages).toBeGreaterThan(0)
    expect(report.written.length).toBeGreaterThan(0)

    const archiveDir = path.join(projectRoot, ".session-archive")
    const jsonlFiles: string[] = []
    const walk = (d: string) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name)
        if (entry.isDirectory()) walk(p)
        else if (entry.name.endsWith(".jsonl")) jsonlFiles.push(p)
      }
    }
    walk(path.join(archiveDir, "sessions"))
    expect(jsonlFiles).toHaveLength(report.sessions)

    const blobRefs = new Set<string>()
    let recordCount = 0
    for (const file of jsonlFiles) {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean)
      const header = JSON.parse(lines[0])
      expect(header.kind).toBe("session")
      for (const line of lines.slice(1)) {
        const record = JSON.parse(line)
        recordCount += 1
        expect(record.raw_ref.session_id).toBe(header.id)
        for (const m of line.matchAll(/blob:([0-9a-f]{64})/g)) blobRefs.add(m[1])
      }
    }
    expect(recordCount).toBe(report.messages)
    for (const sha of blobRefs) {
      expect(existsSync(path.join(archiveDir, "blobs", `${sha}.txt`))).toBe(true)
    }

    const index = new Database(path.join(archiveDir, "index.sqlite"), { readonly: true })
    const n = index.query("SELECT count(*) AS n FROM session WHERE root_id = ?").get(REAL_ROOT) as { n: number }
    expect(n.n).toBe(report.sessions)
    const m = index.query("SELECT count(*) AS n FROM message").get() as { n: number }
    expect(m.n).toBe(report.messages)
    index.close()

    const again = sqliteSource(DB_PATH)
    const second = persist({ sessionID: REAL_ROOT, projectID: REAL_PROJECT, projectRoot }, again)
    again.close()
    expect(second.written).toEqual([])
  })
})
