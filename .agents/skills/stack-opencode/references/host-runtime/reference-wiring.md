# Reference wiring

Set `OC` using the exact commit in [../../SKILL.md](../../SKILL.md).

### Config boundary

**Where:** `node_modules/@opencode/schema/dist/config/reference.js`
**Verify:** `rg -n 'repository:|branch:|path:|description:|hidden:' node_modules/@opencode/schema/dist/config/reference.js`
**Trap:** there is no `tag` field. Keep the V2 branch and record exact release witnesses in descriptions, not invented config fields. Source witness: `packages/schema/src/config/reference.ts:6-17`.

### Cache lifecycle

**Where:** `$OC/packages/core/src/repository-cache.ts`
**Verify:** `curl -fsSL "$OC/packages/core/src/repository-cache.ts" | rg -n 'refreshInterval|attemptedAt|reset'`
**Trap:** a reference attachment is not release evidence: shared asynchronous refresh can leave attachment contents older than a subsequent read. The exact-tag `services/www/src/docs/content/references.mdx`, Refresh section, documents the 24-hour attempt cadence and shared resets. Never mutate this cache.

### Attachment limits

**Where:** `$OC/packages/core/src/session/prompt.ts`
**Verify:** `curl -fsSL "$OC/packages/core/src/session/prompt.ts" | rg -n 'MAX_ATTACHMENT_BYTES'`
**Trap:** the limit owner is the session prompt path, not reference configuration (`session/prompt.ts:107-110`); do not diagnose a large-file refusal by searching only reference code.
