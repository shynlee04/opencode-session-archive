# CLI settings and logs

Set `OC` using [../../SKILL.md](../../SKILL.md). These are read-only source commands.

### CLI config identity

**Where:** `$OC/packages/cli/src/config/schema.ts`
**Verify:** `curl -fsSL "$OC/packages/cli/src/config/schema.ts" | rg -n 'SchemaURL'`
**Trap:** CLI settings and project config are separate stores; the CLI schema URL is declared at `schema.ts:4`, not the project's `$schema` URL.

### Inline CLI overrides

**Where:** `$OC/packages/cli/src/config/config.ts`
**Verify:** `curl -fsSL "$OC/packages/cli/src/config/config.ts" | rg -n 'OPENCODE_CLI_CONFIG_CONTENT'`
**Trap:** inherited inline settings can explain file edits appearing ineffective. Inspect only the relevant variable's presence; do not dump process environments or credentials.

### Log owner

**Where:** `$OC/packages/util/src/observability/logging.ts`
**Verify:** `curl -fsSL "$OC/packages/util/src/observability/logging.ts" | rg -n 'opencode.log|function file'`
**Trap:** shared host logs interleave sessions; a matching line is not automatically this run's evidence. Never attach an entire large log or infer authority to restart the shared service.
