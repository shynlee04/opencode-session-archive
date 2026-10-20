#!/usr/bin/env node
// local-build.mjs — immutable content-addressed plugin snapshot producer and
// read-only freshness checker. Node ESM; stdlib modules only, plus the existing
// repo dependency jsonc-parser when present for tolerant config parsing
// (strict JSON.parse fallback). Runs under node or bun.
//
//   local-build.mjs build [--checkout DIR] [--root .local-builds]
//   local-build.mjs check [--checkout DIR] [--config opencode.json] [--root .local-builds]
//   local-build.mjs list  [--checkout DIR] [--root .local-builds]
//
// Exit codes: 0 clean | 1 drift/assertion failure | 2 blocked precondition.
// `build` never reads the host config; `check` and `list` never write.
// Completeness scans static literals only: import/export-from, import(),
// require(), and new URL(x, import.meta.url) in shipped code files.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const GENERATOR = "local-build.mjs/1"
const SCHEMA = 1
const CODE_EXTS = [".ts", ".tsx", ".js", ".mjs", ".mts", ".cts", ".cjs"]
const HEX64 = /^[0-9a-f]{64}$/
const MODE_RE = /^[0-7]{3}$/
const STAGING_MARKER = ".local-build-staging"
const COMMIT_WAIT_MS = 3000
const POLL_MS = 40

class Blocked extends Error {}

const sha256Bytes = (b) => createHash("sha256").update(b).digest("hex")
const sha256File = (p) => sha256Bytes(readFileSync(p))
const isInside = (root, abs) => abs === root || abs.startsWith(root + path.sep)
const fileMode = (st) => (st.mode & 0o777).toString(8)
const lstatSoft = (p) => {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}
const realpathSoft = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}
const sleepSync = (ms) => {
  const until = Date.now() + ms
  while (Date.now() < until) {}
}

// Safe manifest-relative path: normalized POSIX, no escapes, no backslash.
const isSafeRel = (rel) =>
  typeof rel === "string" &&
  rel.length > 0 &&
  !rel.includes("\\") &&
  !path.isAbsolute(rel) &&
  path.posix.normalize(rel) === rel &&
  rel !== "." &&
  rel !== ".." &&
  !rel.startsWith("../")

function parseArgs(argv) {
  const opts = { checkout: ".", root: ".local-builds", config: null }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (!key.startsWith("--")) throw new Blocked(`unexpected argument: ${key}`)
    const val = argv[++i]
    if (val === undefined) throw new Blocked(`missing value for ${key}`)
    const name = key.slice(2)
    if (!(name in opts)) throw new Blocked(`unknown option ${key}`)
    opts[name] = val
  }
  return opts
}

function normalizeDeclared(checkout, entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.includes("\\")) {
    throw new Blocked(`unsafe declared input: ${JSON.stringify(entry)}`)
  }
  if (path.isAbsolute(entry) || /^[a-zA-Z]:[\\/]/.test(entry)) {
    throw new Blocked(`unsafe absolute declared input: ${entry}`)
  }
  const rel = path.posix.normalize(entry).replace(/^\.\//, "")
  const abs = path.resolve(checkout, rel === "." ? "." : rel)
  if (!isInside(checkout, abs)) {
    throw new Blocked(`declared input escapes checkout: ${entry}`)
  }
  return { rel, abs }
}

function collectStrings(v, out) {
  if (typeof v === "string") out.push(v)
  else if (v && typeof v === "object") for (const x of Object.values(v)) collectStrings(x, out)
}

// manifestInputs -> sorted [{path, sha256, mode}] plus lookup Map.
// Union of package.json "files" entries (dirs walked recursively), package.json
// itself, every "exports" target, every "bin" entry, and the optional development
// baseline. No symlinks followed;
// missing/absolute/escaping/symlinked/build-root-capturing inputs are blocked.
function manifestInputs(checkout, { missing = null, buildRoot = null } = {}) {
  const pkgAbs = path.join(checkout, "package.json")
  if (!existsSync(pkgAbs)) throw new Blocked(`missing package.json: ${pkgAbs}`)
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgAbs, "utf8"))
  } catch (e) {
    throw new Blocked(`unparseable package.json: ${e.message}`)
  }
  const declared = ["package.json", ...(pkg.files ?? [])]
  collectStrings(pkg.exports ?? {}, declared)
  collectStrings(pkg.bin ?? {}, declared)

  const baselineRel = "scripts/development-baseline.json"
  try {
    const parent = lstatSync(path.join(checkout, "scripts"))
    if (parent.isSymbolicLink()) throw new Blocked(`unsafe symlink input: ${baselineRel}`)
    if (!parent.isDirectory()) throw new Blocked(`input parent is not a directory: ${baselineRel}`)
    const baseline = lstatSync(path.join(checkout, baselineRel))
    if (baseline.isSymbolicLink()) throw new Blocked(`unsafe symlink input: ${baselineRel}`)
    if (!baseline.isFile()) throw new Blocked(`declared input is not a file: ${baselineRel}`)
    declared.push(baselineRel)
  } catch (e) {
    if (e.code !== "ENOENT") throw e
  }

  const map = new Map()
  const addFile = (rel, abs) => {
    const st = statSync(abs)
    map.set(rel, { path: rel, sha256: sha256File(abs), mode: fileMode(st) })
  }
  const visit = (rel, abs) => {
    if (buildRoot && isInside(buildRoot, abs)) {
      throw new Blocked(`declared input inside build root: ${rel}`)
    }
    const lst = lstatSync(abs)
    if (lst.isSymbolicLink()) {
      const target = realpathSoft(abs)
      const why = target && isInside(checkout, target) ? "symlink input" : "symlink escapes checkout"
      throw new Blocked(`unsafe ${why}: ${rel}`)
    }
    if (lst.isDirectory()) {
      for (const name of readdirSync(abs).sort()) {
        visit(path.posix.join(rel, name), path.join(abs, name))
      }
      return
    }
    if (!lst.isFile()) throw new Blocked(`declared input is not a file or directory: ${rel}`)
    addFile(rel, abs)
  }

  for (const entry of declared) {
    const { rel, abs } = normalizeDeclared(checkout, entry)
    if (map.has(rel)) continue
    if (!existsSync(abs)) {
      if (missing) {
        missing.push(rel)
        continue
      }
      throw new Blocked(`missing declared input: ${rel}`)
    }
    // A declared directory that is an ancestor of the build root would
    // recursively capture published/staging snapshots (e.g. files: ["."]).
    if (buildRoot && lstatSync(abs).isDirectory() && isInside(abs, buildRoot)) {
      throw new Blocked(`declared input ${entry} would capture build root: ${rel}`)
    }
    visit(rel, abs)
  }
  const files = [...map.values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  return { files, map }
}

const LITERAL_RES = [
  /(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url/g,
]

// completeness: every relative literal in a shipped code file must resolve to
// a file inside the manifest. Static literals only (documented limit).
function completeness(checkout, files, map) {
  const unresolved = new Set()
  for (const f of files) {
    if (!CODE_EXTS.includes(path.posix.extname(f.path))) continue
    const src = readFileSync(path.join(checkout, f.path), "utf8")
    for (const re of LITERAL_RES) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(src))) {
        const lit = m[1]
        if (!lit.startsWith("./") && !lit.startsWith("../")) continue
        const cand = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), lit))
        const tries = [
          cand,
          ...CODE_EXTS.map((e) => cand + e),
          ...CODE_EXTS.map((e) => `${cand}/index${e}`),
        ]
        if (!tries.some((t) => map.has(t))) unresolved.add(`${f.path} -> ${lit}`)
      }
    }
  }
  if (unresolved.size) {
    throw new Blocked(`unresolved relative imports:\n  ${[...unresolved].sort().join("\n  ")}`)
  }
}

function lockIdentity(checkout) {
  for (const name of ["bun.lock", "bun.lockb"]) {
    const p = path.join(checkout, name)
    if (existsSync(p) && lstatSync(p).isFile()) return sha256File(p)
  }
  return null
}

const digestOf = (files, bunLock) =>
  sha256Bytes(
    Buffer.from(
      JSON.stringify({ schema: SCHEMA, generator: GENERATOR, files, dependencies: { bunLock } }),
    ),
  )

function gitField(checkout, args) {
  try {
    return execFileSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return null
  }
}

function loadManifest(target) {
  const p = path.join(target, "MANIFEST.json")
  if (!existsSync(p)) return null
  try {
    const m = JSON.parse(readFileSync(p, "utf8"))
    return m && typeof m === "object" ? m : null
  } catch {
    return null
  }
}

// Full MANIFEST schema validation: safe sorted unique rel paths, hex64 digests,
// exact 3-digit octal modes, explicit stored lock identity, and the stored
// digest recomputed from files+lock — never trusting the field as signed.
function strictManifestProblems(manifest, dirName) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest: not an object"]
  }
  const problems = []
  if (manifest.schema !== SCHEMA) problems.push("manifest: schema != 1")
  if (manifest.generator !== GENERATOR) problems.push("manifest: generator mismatch")
  const digestOk = typeof manifest.digest === "string" && HEX64.test(manifest.digest)
  if (!digestOk) problems.push("manifest: digest not sha256")
  else if (manifest.digest !== dirName) problems.push("manifest: digest != dir name")
  const lock = manifest.dependencies?.bunLock
  const lockOk = lock === null || (typeof lock === "string" && HEX64.test(lock))
  if (!lockOk) problems.push("manifest: dependencies.bunLock invalid")

  let filesValid = Array.isArray(manifest.files)
  if (!filesValid) {
    problems.push("manifest: files not array")
  } else {
    const seen = new Set()
    let prev = null
    for (const f of manifest.files) {
      if (!f || typeof f !== "object") {
        problems.push("manifest: file entry not object")
        filesValid = false
        continue
      }
      if (!isSafeRel(f.path)) {
        problems.push(`manifest: unsafe path ${JSON.stringify(f.path)}`)
        filesValid = false
      } else {
        if (seen.has(f.path)) {
          problems.push(`manifest: duplicate path ${f.path}`)
          filesValid = false
        }
        seen.add(f.path)
        if (prev !== null && f.path < prev) {
          problems.push("manifest: files unsorted")
          filesValid = false
        }
        prev = f.path
      }
      if (typeof f.sha256 !== "string" || !HEX64.test(f.sha256)) {
        problems.push(`manifest: bad sha256 ${f.path}`)
        filesValid = false
      }
      if (typeof f.mode !== "string" || !MODE_RE.test(f.mode)) {
        problems.push(`manifest: bad mode ${f.path}`)
        filesValid = false
      }
    }
  }

  const nm = manifest.external?.node_modules
  if (!nm || typeof nm !== "object") {
    problems.push("manifest: external.node_modules missing")
  } else {
    if (nm.mutable !== true) problems.push("manifest: external.node_modules.mutable != true")
    if (nm.kind !== "symlink" && nm.kind !== "absent") {
      problems.push(`manifest: external.node_modules.kind ${JSON.stringify(nm.kind)}`)
    }
    if (nm.kind === "symlink" && (typeof nm.target !== "string" || !nm.target)) {
      problems.push("manifest: external.node_modules.target invalid")
    }
    if (lockOk && nm.identity !== lock) {
      problems.push("manifest: external.node_modules.identity != dependencies.bunLock")
    }
  }

  if (filesValid && lockOk && digestOk && digestOf(manifest.files, lock) !== manifest.digest) {
    problems.push("manifest: stored digest != recomputed digest")
  }
  return problems
}

// Payload verification: exact file/dir/link set (manifest files + MANIFEST.json
// + node_modules entry per the external record), per-file bytes+exact mode, and
// strict node_modules kind/target/identity. Only call after strict validation —
// manifest paths are proven safe before any fs access.
function payloadProblems(target, manifest) {
  const problems = []
  const expected = new Map()
  for (const f of manifest.files) {
    expected.set(f.path, "file")
    let d = path.posix.dirname(f.path)
    while (d && d !== ".") {
      if (!expected.has(d)) expected.set(d, "dir")
      d = path.posix.dirname(d)
    }
  }
  expected.set("MANIFEST.json", "file")
  const nmKind = manifest.external.node_modules.kind
  if (nmKind === "symlink") expected.set("node_modules", "link")

  const actual = new Map()
  const walk = (rel, abs) => {
    for (const name of readdirSync(abs)) {
      const cAbs = path.join(abs, name)
      const cRel = rel ? `${rel}/${name}` : name
      const lst = lstatSync(cAbs)
      if (lst.isSymbolicLink()) actual.set(cRel, "link")
      else if (lst.isDirectory()) {
        actual.set(cRel, "dir")
        walk(cRel, cAbs)
      } else if (lst.isFile()) actual.set(cRel, "file")
      else actual.set(cRel, "other")
    }
  }
  walk("", target)
  for (const [rel, t] of actual) {
    if (!expected.has(rel)) problems.push(`unexpected payload entry: ${rel}`)
    else if (expected.get(rel) !== t) problems.push(`payload type mismatch: ${rel}`)
  }
  for (const rel of expected.keys()) {
    if (!actual.has(rel)) problems.push(`missing payload entry: ${rel}`)
  }

  for (const f of manifest.files) {
    const abs = path.join(target, f.path)
    const lst = lstatSoft(abs)
    if (!lst || !lst.isFile()) continue // already reported via set diff
    if (sha256File(abs) !== f.sha256) problems.push(`payload bytes differ: ${f.path}`)
    else if (fileMode(lst) !== f.mode) problems.push(`payload mode differs: ${f.path}`)
  }

  if (nmKind === "symlink") {
    const nmAbs = path.join(target, "node_modules")
    const lst = lstatSoft(nmAbs)
    if (lst?.isSymbolicLink()) {
      // Compare real-to-real: the recorded target is a realpath, and the dir
      // may be reached through a symlinked alias.
      const base = realpathSoft(target) ?? target
      const resolved = path.resolve(base, readlinkSync(nmAbs))
      if (resolved !== manifest.external.node_modules.target) {
        problems.push("node_modules: symlink target mismatch")
      }
    }
    // not-a-symlink already reported via set diff ("dir"/missing)
  }
  return problems
}

// Adopt-or-block on an existing digest dir: verified owned manifest+payload
// returns "exists"; owned-but-damaged or foreign is blocked, never cleaned.
function existingDigestStatus(target, files) {
  const manifest = loadManifest(target)
  if (!manifest) return null
  const strict = strictManifestProblems(manifest, path.basename(target))
  const sameFiles =
    !strict.length && JSON.stringify(manifest.files) === JSON.stringify(files)
  const payload = strict.length ? ["manifest failed strict validation"] : payloadProblems(target, manifest)
  if (!strict.length && sameFiles && !payload.length) return "exists"
  if (manifest.generator === GENERATOR) {
    throw new Blocked(
      `owned payload at ${target} failed verification: ${[...strict, ...(sameFiles ? [] : ["declared files differ"]), ...payload].join("; ")}`,
    )
  }
  throw new Blocked(
    `unowned-collision at ${target}: foreign manifest; refusing to adopt or overwrite`,
  )
}

// Existing target at publish time: wait briefly for an in-flight same-generator
// stage to commit (concurrent same-digest builds converge), then verify.
function publishExisting(target, files) {
  const deadline = Date.now() + COMMIT_WAIT_MS
  while (Date.now() < deadline) {
    const manifest = loadManifest(target)
    if (manifest) {
      return { status: existingDigestStatus(target, files) }
    }
    const lst = lstatSoft(path.join(target, STAGING_MARKER))
    const entries = lstatSoft(target)?.isDirectory() ? readdirSync(target) : []
    if (lst || entries.length === 0) {
      // In-flight staging or a just-reserved empty dir: keep waiting.
      sleepSync(POLL_MS)
      continue
    }
    break // non-empty, no marker, no manifest: foreign — no point waiting
  }
  const manifest = loadManifest(target)
  if (manifest) return { status: existingDigestStatus(target, files) }
  if (lstatSoft(path.join(target, STAGING_MARKER))) {
    throw new Blocked(
      `incomplete staged build at ${target} (owned generator, uncommitted); refusing to adopt — remove or rebuild`,
    )
  }
  throw new Blocked(
    `unowned-collision at ${target}: no local-build manifest; refusing to adopt or overwrite`,
  )
}

function cmdBuild(checkout, root) {
  const { files, map } = manifestInputs(checkout, { buildRoot: root })
  completeness(checkout, files, map)
  const bunLock = lockIdentity(checkout)
  const digest = digestOf(files, bunLock)
  mkdirSync(root, { recursive: true })
  const target = path.join(root, digest)

  // Exclusive publication: atomic mkdir reserves the digest dir. rename() is
  // unsafe here — POSIX rename silently replaces an existing EMPTY dir.
  try {
    mkdirSync(target)
  } catch (e) {
    if (e.code !== "EEXIST") throw e
    return { code: 0, out: { digest, path: target, ...publishExisting(target, files) } }
  }

  // We reserved it: this process owns the dir until commit or cleanup.
  try {
    writeFileSync(
      path.join(target, STAGING_MARKER),
      JSON.stringify({ generator: GENERATOR, pid: process.pid, createdUtc: new Date().toISOString() }),
    )
    for (const f of files) {
      const dst = path.join(target, f.path)
      mkdirSync(path.dirname(dst), { recursive: true })
      copyFileSync(path.join(checkout, f.path), dst)
      chmodSync(dst, parseInt(f.mode, 8))
    }
    const nmSrc = path.join(checkout, "node_modules")
    const external = existsSync(nmSrc)
      ? (() => {
          symlinkSync(path.relative(target, nmSrc), path.join(target, "node_modules"))
          return { kind: "symlink", mutable: true, target: realpathSoft(nmSrc) ?? nmSrc, identity: bunLock }
        })()
      : { kind: "absent", mutable: true, identity: bunLock }
    // Staged payload hash: copies must equal the captured manifest before
    // commit — corruption or wrong-mode copies publish nothing.
    for (const f of files) {
      const staged = path.join(target, f.path)
      const lst = lstatSync(staged)
      if (sha256File(staged) !== f.sha256 || fileMode(lst) !== f.mode) {
        throw new Blocked(`staged copy mismatch: ${f.path}`)
      }
    }
    // Source re-verify: every declared input plus the lock identity must be
    // unchanged since capture; mutation (incl. ABA) aborts publication.
    for (const f of files) {
      const abs = path.join(checkout, f.path)
      let st
      try {
        st = statSync(abs)
      } catch {
        throw new Blocked(`source mutated during capture: ${f.path}`)
      }
      if (sha256File(abs) !== f.sha256 || fileMode(st) !== f.mode) {
        throw new Blocked(`source mutated during capture: ${f.path}`)
      }
    }
    if (lockIdentity(checkout) !== bunLock) {
      throw new Blocked("source mutated during capture: bun.lock")
    }
    const manifest = {
      schema: SCHEMA,
      generator: GENERATOR,
      sourceHead: gitField(checkout, ["rev-parse", "HEAD"]) ?? "unknown",
      sourceDirty: gitField(checkout, ["status", "--porcelain"]) !== "",
      digest,
      dependencies: { bunLock },
      files,
      external: { node_modules: external },
      createdUtc: new Date().toISOString(),
    }
    // MANIFEST.json is the commit marker: written last, staging marker removed
    // only after. A dir with marker-but-no-manifest is an uncommitted stage.
    writeFileSync(path.join(target, "MANIFEST.json"), JSON.stringify(manifest, null, 2) + "\n")
    unlinkSync(path.join(target, STAGING_MARKER))
    return { code: 0, out: { digest, path: target, status: "created" } }
  } catch (e) {
    rmSync(target, { recursive: true, force: true }) // our own reservation only
    throw e
  }
}

// check: read-only freshness gate over the config's plugin selection.
function cmdCheck(checkout, root, configPath) {
  if (!existsSync(configPath)) throw new Blocked(`config not found: ${configPath}`)
  let cfg
  try {
    cfg = parseJsonc(readFileSync(configPath, "utf8"), configPath)
  } catch (e) {
    throw new Blocked(`unparseable config ${configPath}: ${e.message}`)
  }
  if (cfg.plugins !== undefined && !Array.isArray(cfg.plugins)) {
    throw new Blocked(`config plugins is not an array`)
  }
  const plugins = cfg.plugins ?? []

  // Realpath identity: classify selections by what they resolve to, while the
  // digest dir name itself is still verified logically via basename.
  const checkoutReal = realpathSoft(checkout) ?? checkout
  const cfgDirReal = realpathSoft(path.dirname(configPath)) ?? path.dirname(configPath)
  const rootReal = realpathSoft(root) ?? root

  let current = null
  let sourceError = null
  try {
    const { files, map } = manifestInputs(checkout, { buildRoot: root })
    completeness(checkout, files, map)
    current = { digest: digestOf(files, lockIdentity(checkout)), files, map, lock: lockIdentity(checkout) }
  } catch (e) {
    sourceError = e.message
  }

  let candidates = 0
  const entries = plugins.map((raw) => {
    let spec
    if (typeof raw === "string") spec = raw
    else if (raw && typeof raw === "object" && typeof raw.package === "string") spec = raw.package
    else return { plugin: raw, status: "error", detail: "invalid plugin entry type" }

    if (/^file:/i.test(spec)) {
      let abs
      try {
        abs = fileURLToPath(spec)
      } catch {
        return { plugin: raw, status: "unsupported", detail: "invalid file: URL" }
      }
      return classify(raw, abs)
    }
    if (spec.includes("://")) {
      return { plugin: raw, status: "unsupported", detail: "URL scheme not supported" }
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(spec)) {
      // npm:, git: and other package specs: real plugins, just not ours.
      return { plugin: raw, status: "unrelated" }
    }
    if (!path.isAbsolute(spec) && !spec.startsWith(".") && !spec.startsWith("~")) {
      return { plugin: raw, status: "unrelated" }
    }
    return classify(raw, path.resolve(cfgDirReal, spec))
  })

  function classify(raw, abs) {
    const real = realpathSoft(abs) ?? abs
    if (real === checkoutReal) {
      candidates++
      return { plugin: raw, status: "source" }
    }
    if (!isInside(rootReal, real)) return { plugin: raw, status: "unrelated" }
    candidates++
    if (!HEX64.test(path.basename(real)) || !lstatSoft(real)?.isDirectory()) {
      return { plugin: raw, status: "unmanaged", detail: "not a digest snapshot dir" }
    }
    const manifest = loadManifest(real)
    if (!manifest || manifest.generator !== GENERATOR) {
      return { plugin: raw, status: "unmanaged" }
    }
    const strict = strictManifestProblems(manifest, path.basename(real))
    if (strict.length) return { plugin: raw, status: "error", detail: strict.join("; ") }
    const payload = payloadProblems(real, manifest)
    const drift = current ? diffFiles(manifest.files, current.map) : []
    if (current && manifest.dependencies.bunLock !== current.lock) {
      drift.push("bun.lock (lock identity drift)")
    }
    if (payload.length || drift.length || !current) {
      return {
        plugin: raw,
        status: current ? "stale" : "error",
        ...(payload.length ? { payload } : {}),
        ...(drift.length ? { drift } : {}),
        ...(sourceError ? { sourceError } : {}),
      }
    }
    return { plugin: raw, status: "fresh" }
  }

  const countProblem =
    candidates === 0
      ? "no candidate for this checkout selected (0)"
      : candidates > 1
        ? `multiple candidates for this checkout selected (${candidates})`
        : null
  const failing =
    countProblem !== null ||
    entries.some((e) => ["stale", "unmanaged", "error"].includes(e.status))
  return {
    code: failing ? 1 : 0,
    out: {
      checkout,
      config: configPath,
      status: failing ? "drift" : "clean",
      candidates,
      ...(countProblem ? { detail: countProblem } : {}),
      entries,
      references: cfg.references ?? {},
    },
  }
}

function diffFiles(manifestFiles, currentMap) {
  const drift = []
  const seen = new Set()
  for (const f of manifestFiles ?? []) {
    seen.add(f.path)
    const cur = currentMap.get(f.path)
    if (!cur) drift.push(`removed in source: ${f.path}`)
    else if (cur.sha256 !== f.sha256 || cur.mode !== f.mode) drift.push(f.path)
  }
  for (const p of currentMap.keys()) if (!seen.has(p)) drift.push(`added in source: ${p}`)
  return drift
}

function cmdList(checkout, root) {
  const missing = []
  const { files } = manifestInputs(checkout, { missing, buildRoot: root })
  const builds = []
  if (existsSync(root)) {
    for (const name of readdirSync(root).sort()) {
      if (!HEX64.test(name)) continue
      const dir = path.join(root, name)
      if (!lstatSoft(dir)?.isDirectory()) continue
      const m = loadManifest(dir)
      const status = !m
        ? "unowned"
        : m.generator !== GENERATOR
          ? "unowned"
          : strictManifestProblems(m, name).length
            ? "invalid"
            : "owned"
      builds.push({ name, status })
    }
  }
  return {
    code: missing.length ? 2 : 0,
    out: {
      checkout,
      sources: files.map((f) => f.path),
      ...(missing.length ? { missing } : {}),
      builds,
    },
  }
}

function parseJsonc(text, configPath) {
  try {
    const req = createRequire(configPath)
    return req("jsonc-parser").parse(text, undefined, { allowTrailingComma: true })
  } catch {
    return JSON.parse(text)
  }
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (!["build", "check", "list"].includes(cmd)) {
    process.stderr.write(
      "usage: local-build.mjs <build|check|list> [--checkout DIR] [--root DIR] [--config FILE]\n",
    )
    process.exit(2)
  }
  const opts = parseArgs(rest)
  const checkout = path.resolve(opts.checkout)
  const root = path.resolve(checkout, opts.root)
  const config = path.resolve(checkout, opts.config ?? "opencode.json")
  let result
  try {
    if (cmd === "build") result = cmdBuild(checkout, root)
    else if (cmd === "check") result = cmdCheck(checkout, root, config)
    else result = cmdList(checkout, root)
  } catch (e) {
    const tag = e instanceof Blocked ? "blocked" : "error"
    process.stderr.write(`local-build ${cmd}: ${tag}: ${e.message}\n`)
    process.exit(2)
  }
  process.stdout.write(JSON.stringify(result.out, null, 2) + "\n")
  process.exit(result.code)
}

main()
