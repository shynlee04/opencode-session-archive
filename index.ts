import { Plugin } from "@opencode/plugin"
import substratePlugin from "./src/plugin.ts"

export const createSubstratePlugin = () =>
  Plugin.define({
    id: substratePlugin.id,
    setup: substratePlugin.setup,
  })

export default createSubstratePlugin()
export * from "./src/plugin.ts"
