# TUI context surfaces

### UI claims, location and keymap

**Where:** `node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Verify:** `rg -n 'readonly (dialog|router|tabs|slot|location|keymap)' node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Trap:** installed type presence is not proof that a running host handed this setup a usable claim. Keep runtime evidence separate; location may be absent (`context.d.ts:481`).

### Storage tiers

**Where:** `node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Verify:** `rg -n 'store<Value|memory<Value' node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Trap:** durable storage and TUI-lifetime memory are not interchangeable fallback tiers (`context.d.ts:11,19`); verify persistence through the appropriate owner, not a successful read in one process.

### Data and attention

**Where:** `node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Verify:** `rg -n 'interface Data|notify' node_modules/@opencode/plugin/dist/tui/context.d.ts`
**Trap:** data subscriptions are not the bound RPC event stream. Follow [rpc-binding.md](rpc-binding.md) for the latter instead of assuming one subscription sees both.
