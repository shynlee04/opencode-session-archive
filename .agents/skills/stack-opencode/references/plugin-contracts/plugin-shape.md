# Promise plugin shape and hooks

### Server definition

**Where:** `node_modules/@opencode/plugin/dist/promise/plugin.d.ts`
**Verify:** `rg -n 'interface Context|interface Plugin' node_modules/@opencode/plugin/dist/promise/plugin.d.ts`
**Trap:** the bare export, Effect export and TUI export are different contexts. Establish the export first (`node_modules/@opencode/plugin/package.json`); this repository uses Promise, not Effect.

### Session, permission and tool hooks

**Where:** `node_modules/@opencode/plugin/dist/promise/{session,permission,tool}.d.ts`
**Verify:** `rg -n 'readonly hook|interface .*Hooks' node_modules/@opencode/plugin/dist/promise/{session,permission,tool}.d.ts`
**Trap:** a hook name from a sibling domain is not evidence that this domain supports it; read the selected declaration, not a remembered signature. Export identity is established by `node_modules/@opencode/plugin/package.json`.

### Provider inventory and model resolution

**Where:** `node_modules/@opencode/plugin/dist/promise/provider.d.ts`
**Verify:** `rg -n 'ProviderEditor|readonly models|reload' node_modules/@opencode/plugin/dist/promise/provider.d.ts`
**Trap:** declarations establish the client contract, not host resolution order. Follow `$OC/packages/core/src/model-resolver.ts` and `$OC/packages/core/src/tool/plugin/subagent.ts` for release-specific behavior; do not reuse the earlier 2.0.25 witness as 2.0.32 proof.

### VCS

**Where:** `node_modules/@opencode/plugin/dist/promise/vcs.d.ts`
**Verify:** `rg -n 'VcsScope|VcsDomain' node_modules/@opencode/plugin/dist/promise/vcs.d.ts`
**Trap:** this is not the repository's shell/git authority; reading a supported API grants no permission to call it (`AGENTS.md`, authorization gates).
