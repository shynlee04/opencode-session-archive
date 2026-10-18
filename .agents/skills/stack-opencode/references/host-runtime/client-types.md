# Client types

### Installed generated types

**Where:** `node_modules/@opencode/client/dist/promise/generated/types.d.ts`
**Verify:** `rg -n 'SessionInfo|ModelRef' node_modules/@opencode/client/dist/promise/generated/types.d.ts`
**Trap:** generated client types describe the published client, not the running server. For domain ownership use installed `@opencode/schema/dist/` or exact-tag `packages/schema/src/`; do not edit generated output.

### Runtime client composition

**Where:** `node_modules/@opencode/client/dist/promise/client.js`
**Verify:** `rg -n 'chunks/|as make' node_modules/@opencode/client/dist/promise/client.js`
**Trap:** the published entry delegates to hashed chunks (`client.js:4`); searching only the entry for source implementation symbols gives false absence. Follow its current chunk import, not a hardcoded hash. Exact-tag source counterpart: `packages/client/src/promise/client.ts:15`.
