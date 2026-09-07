import type { ForgePlugin, PluginInput, PluginNavItem } from "./types"

/**
 * Walks a nav tree (and every level of `children`) checking that each `to`
 * is scope-relative. Recursive because a bad leading slash three levels deep
 * is exactly as fatal as one at the top: `scopePath` concatenates blindly at
 * every depth.
 */
function validateNav(items: PluginNavItem[], extension: string): void {
  for (const item of items) {
    if (!item.to.startsWith("/")) {
      throw new Error(
        `definePlugin: nav item "to" value "${item.to}" must start with "/" (plugin "${extension}")`,
      )
    }
    if (item.children) {
      validateNav(item.children, extension)
    }
  }
}

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

  if (input.nav) {
    validateNav(input.nav, input.extension)
  }

  return { ...input, nav: input.nav ?? [] }
}
