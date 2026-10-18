# Plugin configuration

### Config key versus runtime state

**Where:** `node_modules/@opencode/schema/dist/config/plugin.js`
**Verify:** `rg -n 'Plugins|Entry' node_modules/@opencode/schema/dist/config/plugin.js`
**Trap:** `node_modules/@opencode/schema/dist/plugin.js:1` is runtime plugin state, not the config-entry schema. The `config/` path segment disambiguates them; do not copy state fields into `opencode.json`.

### Owning root config

**Where:** `node_modules/@opencode/schema/dist/config.js`
**Verify:** `rg -n 'plugins:' node_modules/@opencode/schema/dist/config.js`
**Trap:** the published `https://opencode.ai/config.json` may describe V1; use the installed V2 schema or exact release source, not that URL to infer fields. See the V2-only policy in the `opencode` skill.
