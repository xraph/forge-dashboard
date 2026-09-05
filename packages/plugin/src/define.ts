import type { ForgePlugin, PluginInput } from "./types"

/**
 * Declares a dashboard plugin.
 *
 * Validation happens here, at import time, rather than during render. A plugin
 * with a bad shape should break the build that includes it, not produce a blank
 * panel in somebody's dashboard.
 */
export function definePlugin(input: PluginInput): ForgePlugin {
  if (!input.extension) {
    throw new Error(
      "definePlugin requires an `extension` name matching the Go contributor it belongs to",
    )
  }

  for (const route of input.routes) {
    if (!route.path.startsWith("/")) {
      throw new Error(
        `definePlugin: route path "${route.path}" must start with "/" (plugin "${input.extension}")`,
      )
    }
  }

  return { ...input, nav: input.nav ?? [] }
}
