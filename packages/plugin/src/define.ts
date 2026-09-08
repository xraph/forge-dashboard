import type { ForgePlugin, PluginInput, PluginNavItem } from "./types"

/**
 * Walks a nav tree (and every level of `children`) checking that each `to`
 * is scope-relative. Recursive because a bad leading slash three levels deep
 * is exactly as fatal as one at the top: `scopePath` concatenates blindly at
 * every depth.
 *
 * The same walk rejects two entries in one sibling list pointing at the same
 * `to`. `labels` is rebuilt per call, so the check is scoped to one list
 * rather than the whole tree, which matches what the sidebar keys against: a
 * child repeating its parent's `to`, or two children under different parents,
 * are never rendered as siblings and stay legal.
 */
function validateNav(items: PluginNavItem[], extension: string): void {
  const labels = new Map<string, string>()

  for (const item of items) {
    if (!item.to.startsWith("/")) {
      throw new Error(
        `definePlugin: nav item "to" value "${item.to}" must start with "/" (plugin "${extension}")`,
      )
    }

    const claimed = labels.get(item.to)
    if (claimed !== undefined) {
      throw new Error(
        `definePlugin: nav items "${claimed}" and "${item.label}" both point at "${item.to}", so the sidebar cannot tell them apart. Give one of them a different "to" (plugin "${extension}")`,
      )
    }
    labels.set(item.to, item.label)

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

  if (input.root && input.namespace !== undefined) {
    throw new Error(
      `definePlugin: plugin "${input.extension}" sets both \`root\` and \`namespace\`, so it cannot say where it mounts. A root plugin serves at "/" and takes no namespace.`,
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
