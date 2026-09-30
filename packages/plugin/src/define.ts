import type { ForgePlugin, PluginInput, PluginNavItem } from "./types"
import { SCOPE_SIGIL } from "./scope"

/** The prefix that opens a namespaced scope's mount, e.g. "/@streaming/rooms". */
const SIGIL_PREFIX = `/${SCOPE_SIGIL}`

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
 *
 * `isRoot` extends the walk with one more rule, for root plugins only:
 * `mountPath` passes a root plugin's own paths straight through, so nothing
 * else stops one from declaring a nav item under the "/@" sigil and
 * colliding with whatever scoped plugin already owns it. A namespaced
 * plugin's `to` is scope-relative and gets its own namespace prepended by
 * `scopePath`, so the rule has nothing to say about it there, however
 * unusual the literal string looks.
 */
function validateNav(
  items: PluginNavItem[],
  extension: string,
  isRoot: boolean,
): void {
  const labels = new Map<string, string>()

  for (const item of items) {
    if (!item.to.startsWith("/")) {
      throw new Error(
        `definePlugin: nav item "to" value "${item.to}" must start with "/" (plugin "${extension}")`,
      )
    }

    if (isRoot && item.to.startsWith(SIGIL_PREFIX)) {
      throw new Error(
        `definePlugin: root plugin "${extension}" cannot claim a nav item under the sigil ("${item.to}"). A root plugin's paths mount as written, with no namespace of its own, so a path starting with "${SIGIL_PREFIX}" would collide with whichever scoped plugin already owns it (plugin "${extension}")`,
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
      validateNav(item.children, extension, isRoot)
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

    // Same rule as validateNav's sigil guard, for routes: a root plugin's
    // route paths mount as written, so one starting with "/@" would collide
    // with whichever scoped plugin already owns it.
    if (input.root && route.path.startsWith(SIGIL_PREFIX)) {
      throw new Error(
        `definePlugin: root plugin "${input.extension}" cannot claim a route under the sigil ("${route.path}"). A root plugin's paths mount as written, with no namespace of its own, so a path starting with "${SIGIL_PREFIX}" would collide with whichever scoped plugin already owns it (plugin "${input.extension}")`,
      )
    }
  }

  if (input.nav) {
    validateNav(input.nav, input.extension, input.root ?? false)
  }

  const seenDimensions = new Map<string, string>()
  for (const dimension of input.context ?? []) {
    if (!dimension.query || !dimension.switchCommand) {
      throw new Error(
        `definePlugin: context dimension "${dimension.id}" needs both a \`query\` to read it and a \`switchCommand\` to change it (plugin "${input.extension}")`,
      )
    }
    if (typeof dimension.payload !== "function") {
      throw new Error(
        `definePlugin: context dimension "${dimension.id}" needs a \`payload\` building the switch command's input, because intents do not agree on a field name (apps.switch takes appId, environments.switch takes envId) (plugin "${input.extension}")`,
      )
    }
    const claimed = seenDimensions.get(dimension.id)
    if (claimed !== undefined) {
      throw new Error(
        `definePlugin: context dimensions "${claimed}" and "${dimension.label}" both use the id "${dimension.id}" (plugin "${input.extension}")`,
      )
    }
    seenDimensions.set(dimension.id, dimension.label)
  }

  return { ...input, nav: input.nav ?? [], context: input.context ?? [] }
}
