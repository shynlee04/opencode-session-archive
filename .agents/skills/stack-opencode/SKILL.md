---
name: stack-opencode
description: Walk tree for this plugin's OpenCode V2 Promise, TUI and host contracts. Use before trusting plugin, client, config or host-source evidence; distinguishes installed dist files from exact-tag source and the moving reference cache.
---

# OpenCode V2

## Pin

**Pin:** `stack:@opencode/plugin` `version:2.0.32` `source:node_modules/@opencode/plugin+anomalyco/opencode@v2.0.32` `checked:2026-10-18`
**Schema:** 2
**Generator:** stack-synthesis

REFRESH rungs 0-2 (2026-10-18) cover the 2.0.31 to 2.0.32 patch: every
`Where`/`Verify` re-verified against installed 2.0.32 `dist/` and v2.0.32 raw
source; all traps re-read and unchanged (earlier 2026-10-17 refresh fixed the
`repository-cache.ts` Verify dead `lastAttempt` branch to `attemptedAt`).
Earlier rung 2 refresh supersedes the 2.0.18/other-machine map. Installed
plugin/client/schema/theme manifests report 2.0.32. The observed host baseline is 2.0.32; source/manifest agreement is not runtime equivalence.

Run installed-file commands from the repository root. They address npm `dist/`,
not the upstream `src/` tree. Resolve without importing plugin side effects:

```sh
bun -e 'for (const s of ["@opencode/plugin", "@opencode/plugin/tui", "@opencode/client"]) console.log(s, import.meta.resolve(s))'
```

For host implementation, set the exact source base before the linked commands:

```sh
OC=https://raw.githubusercontent.com/anomalyco/opencode/843a6c514e606b436a7fe713422ace0a93ad3d61
```

Official `v2.0.32` raw files were fetched and checked. The shared cached checkout
at `/Users/MAC/.local/share/opencode/repos/github.com/anomalyco/opencode@v2`
is orientation only: its tag alignment is not established. Keep `branch: v2` in
references; the default `dev` branch is V1. Never edit/reset/fetch that shared cache
to satisfy this bundle. No source pack was regenerated; stale XML is not evidence.
The full stack-synthesis pack/runtime exit gates therefore remain unproved.

## Reading order

1. [Plugin contracts](references/plugin-contracts/REFERENCE.md): Promise server seam.
2. [TUI plugin](references/tui-plugin/REFERENCE.md): separate UI context.
3. [Host runtime](references/host-runtime/REFERENCE.md): exact-tag implementation.

### Documentation generations

**Where:** `$OC/services/www/src/docs/content/build/index.mdx`
**Verify:** `curl -fsSL "$OC/services/www/src/docs/content/build/index.mdx" | rg -n 'title|plugin'`
**Trap:** use only `services/www/src/docs/content/**` and https://opencode.ai/v2/docs; the co-resident `packages/web/src/content/docs/**` is V1. The V2 discriminator is `services/www/src/docs/content/migrate-v1.mdx:2`.

## Pointers

`opencode`, `stack-synthesis`, `stack-opentui`, `stack-bun`, `stack-zod`,
`principle-boundary-discipline`, `principle-prove-it-works`.
