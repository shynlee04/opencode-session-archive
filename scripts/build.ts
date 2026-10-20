import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"

const root = path.dirname(import.meta.dir)

const result = await Bun.build({
  entrypoints: [path.join(root, "src/plugin.ts")],
  target: "bun",
  format: "esm",
  external: ["bun:*", "node:*"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const output = result.outputs[0]
const code = await output.text()

// The installed plugin is a single self-contained file: the host provides
// "@opencode/plugin" only as types, so every import it uses at runtime is
// type-only and erased. Any runtime import that survives the bundle must be a
// bun:/node: builtin — anything else is a packaging bug. Bun may emit builtins
// without the node: prefix ("fs", "path"), so bare builtin names count too.
const forbidden = [...code.matchAll(/(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g)]
  .map((m) => m[1] ?? m[2])
  .filter(
    (spec) =>
      !spec.startsWith("bun:") &&
      !spec.startsWith("node:") &&
      !builtinModules.includes(spec) &&
      !builtinModules.includes(`node:${spec}`),
  )
if (forbidden.length > 0) {
  console.error(`build: non-builtin imports survived the bundle: ${forbidden.join(", ")}`)
  process.exit(1)
}

const header = [
  "// @ts-nocheck",
  "// session-archive — OpenCode V2 plugin (generated bundle; do not edit).",
  "// Install: copy this file into <project>/.opencode/plugins/ (project scope)",
  "// or ~/.config/opencode/plugins/ (global).",
  "",
].join("\n")

const bundledServerCode = header + code

const distDir = path.join(root, "dist")
mkdirSync(path.join(distDir, "src/tui"), { recursive: true })
const target = path.join(distDir, "session-archive.ts")
writeFileSync(target, bundledServerCode)

const tuiFiles = ["view.tsx", "panel.tsx", "sidebar.tsx", "status.tsx", "commands.tsx"] as const
copyFileSync(path.join(root, "tui.tsx"), path.join(distDir, "tui.tsx"))
copyFileSync(path.join(root, "src/rpc.ts"), path.join(distDir, "src/rpc.ts"))
for (const f of tuiFiles) {
  copyFileSync(path.join(root, "src/tui", f), path.join(distDir, "src/tui", f))
}

const legacySingleFilePlugin = path.join(root, ".opencode/plugins/session-archive.ts")
if (existsSync(legacySingleFilePlugin)) {
  rmSync(legacySingleFilePlugin, { force: true })
}
const legacyDirPlugin = path.join(root, ".opencode/plugins/hivemind-substrate")
if (existsSync(legacyDirPlugin)) {
  rmSync(legacyDirPlugin, { recursive: true, force: true })
}

console.log(`wrote ${path.relative(root, target)} (${Buffer.byteLength(bundledServerCode)} bytes)`)

