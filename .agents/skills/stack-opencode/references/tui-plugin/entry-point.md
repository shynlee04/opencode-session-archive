# TUI entry point

### Export selection

**Where:** `node_modules/@opencode/plugin/package.json`
**Verify:** `rg -n 'promise/index|effect/index|tui/index' node_modules/@opencode/plugin/package.json`
**Trap:** a shared package name does not imply a shared context. Server `index.ts` and UI `tui.tsx` use distinct entrypoints; resolve the specifier before following a context type.

### Definition and context

**Where:** `node_modules/@opencode/plugin/dist/tui/plugin.d.ts`
**Verify:** `rg -n 'Definition|Context|define' node_modules/@opencode/plugin/dist/tui/plugin.d.ts`
**Trap:** source tag exports point at `src/`, while the installed npm map points at `dist/`; a source-only grep is not evidence about module resolution. Compare the two package manifests.

### Solid context

**Where:** `node_modules/@opencode/plugin/dist/tui/solid.js`
**Verify:** `rg -n 'createContext|usePlugin' node_modules/@opencode/plugin/dist/tui/solid.js`
**Trap:** a plugin-bundled Solid copy is not proof of shared host reactivity. Resolve the candidate imports and test rendered behavior; source witness is `packages/plugin/src/tui/solid.ts:4` at the exact tag.
