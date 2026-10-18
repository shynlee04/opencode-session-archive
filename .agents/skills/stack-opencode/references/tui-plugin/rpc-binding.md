# RPC binding

### Contract owner

**Where:** `node_modules/@opencode/schema/dist/rpc.d.ts`
**Verify:** `rg -n 'define|Definition' node_modules/@opencode/schema/dist/rpc.d.ts`
**Trap:** the RPC contract lives in schema, not the plugin's similarly named context member. Confirm the package export before importing it.

### Client binding and events

**Where:** `node_modules/@opencode/client/dist/promise/rpc.js`
**Verify:** `rg -n 'chunks/|makeRpc' node_modules/@opencode/client/dist/promise/rpc.js`
**Trap:** this published entry is a chunk facade (`rpc.js:3`), not the implementation body. Follow its import or exact-tag `packages/client/src/promise/rpc.ts` before claiming event teardown behavior.
