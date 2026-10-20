#!/usr/bin/env node
// Installer for hivemind-substrate.
//
//   npx hivemind-substrate                 # wire ./opencode.json (project scope)
//   npx hivemind-substrate --project <dir> # wire <dir>/opencode.json
//   npx hivemind-substrate --global        # wire ~/.config/opencode/opencode.json
//   npx hivemind-substrate --check         # report only, no writes
//
// Adds a { "package": "hivemind-substrate" } entry to the config's
// "plugins" array, preserving JSONC comments. Idempotent. After the next
// OpenCode reload, agents in that scope see the `substrate` tool.
//
// Exit codes: 0 ok · 1 usage/io error
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { applyEdits, modify, parse } from "jsonc-parser"

const PKG = "hivemind-substrate"

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (flag("--help") || flag("-h")) {
  console.log(`Usage: npx ${PKG} [--project <dir>] [--global] [--check]`)
  process.exit(0)
}
if (flag("--version")) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
  console.log(pkg.version)
  process.exit(0)
}

const namePart = (spec) => {
  const s = typeof spec === "string" && spec.startsWith("npm:") ? spec.slice(4) : spec
  if (typeof s !== "string") return undefined
  const i = s.indexOf("@")
  return i <= 0 ? s : s.slice(0, i)
}

const configPath = flag("--global")
  ? path.join(homedir(), ".config", "opencode", "opencode.json")
  : path.join(path.resolve(value("--project") ?? "."), "opencode.json")

const check = flag("--check")
const scope = flag("--global") ? "global" : `project ${path.dirname(configPath)}`

const before = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""

let config = {}
if (before.trim().length > 0) {
  const parsed = parse(before, undefined, { allowTrailingComma: true })
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.error(`${PKG}: ${configPath} does not hold a JSON object; edit it by hand`)
    process.exit(1)
  }
  config = parsed
}

const plugins = Array.isArray(config.plugins) ? config.plugins : []
const installed = plugins.some((entry) =>
  namePart(typeof entry === "string" ? entry : entry?.package) === PKG,
)

if (installed) {
  console.log(`${PKG}: already wired in ${configPath}`)
  process.exit(0)
}
if (check) {
  console.log(`${PKG}: not wired in ${configPath} (${scope}); run without --check to install`)
  process.exit(0)
}

const entry = { package: PKG }
const after =
  before.trim().length === 0
    ? JSON.stringify({ $schema: "https://opencode.ai/config.json", plugins: [entry] }, null, 2) + "\n"
    : applyEdits(
      before,
      modify(before, ["plugins", plugins.length], entry, {
        formattingOptions: { tabSize: 2, insertSpaces: true },
      }),
    )

mkdirSync(path.dirname(configPath), { recursive: true })
writeFileSync(configPath, after)
console.log(`${PKG}: added plugin entry to ${configPath}`)
console.log(`Reload OpenCode (or restart it), then ask the agent: "persist this session".`)
