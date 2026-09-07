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

  if (
    input.namespace !== undefined &&
    !/^[a-z0-9][a-z0-9-]*$/i.test(input.namespace)
  ) {
    throw new Error(
      `definePlugin: namespace "${input.namespace}" must be a single URL segment of letters, digits and dashes (plugin "${input.extension}")`,
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
