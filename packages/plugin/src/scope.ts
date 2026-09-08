import type { ReactNode } from "react"
import type { ForgePlugin } from "./types"
import type { PluginState } from "./resolve"

/**
 * The character that opens a namespace segment.
 *
 * `@` and not `_`: forge already spends `_` on internal endpoints such as
 * `/_/metrics`, where it means "not for humans". A scope is the opposite of
 * that. `@` is valid unencoded in a path segment under RFC 3986.
 */
export const SCOPE_SIGIL = "@"

/** One plugin, as the sidebar and the router see it. */
export interface Scope {
  /** Stable identity. The plugin's `extension`, which is unique per plugin. */
  id: string
  /** URL segment, without the sigil. */
  namespace: string
  label: string
  icon?: ReactNode
  plugin: ForgePlugin
  state: PluginState
}

/**
 * The URL segment a plugin mounts under.
 *
 * The default strips a trailing "-contract" because that suffix names the Go
 * contract, not the product. Without it every streaming link would read
 * `/@streaming-contract/rooms` and leak an internal join key into anything
 * anyone pastes into a channel.
 */
export function namespaceOf(plugin: ForgePlugin): string {
  return plugin.namespace ?? plugin.extension.replace(/-contract$/, "")
}

/** The switcher's display name. Falls back to the join key, which looks rough and is honest. */
export function labelOf(plugin: ForgePlugin): string {
  return plugin.label ?? plugin.extension
}

/**
 * Mounts a scope-relative path under its namespace.
 *
 * A plugin's own root is "/" and would otherwise produce "/@streaming/", whose
 * trailing slash makes react-router treat it as a different location from
 * "/@streaming".
 */
export function scopePath(namespace: string, to: string): string {
  const suffix = to === "/" ? "" : to
  return `/${SCOPE_SIGIL}${namespace}${suffix}`
}

/**
 * Where a plugin's scope-relative path actually serves.
 *
 * A root plugin's paths are already absolute from the dashboard's point of
 * view, so they pass through untouched. Everything else gets its namespace.
 */
export function mountPath(plugin: ForgePlugin, to: string): string {
  return plugin.root ? to : scopePath(namespaceOf(plugin), to)
}

/**
 * Splits resolved plugins into the one that owns the root and the rest.
 *
 * Two plugins claiming the root is a programming error in whoever assembled
 * the plugin list, not a runtime state to render around, so it throws here
 * rather than picking a winner and leaving the loser silently unreachable.
 */
export function partitionScopes(all: Scope[]): {
  root?: Scope
  scopes: Scope[]
} {
  const roots = all.filter((s) => s.plugin.root)
  if (roots.length > 1) {
    throw new Error(
      `two plugins claim the dashboard root: ${roots.map((s) => s.id).join(", ")}. Only one plugin may set \`root: true\`.`,
    )
  }
  return { root: roots[0], scopes: all.filter((s) => !s.plugin.root) }
}

/**
 * The scope a pathname belongs to, or `undefined` when it belongs to none.
 *
 * `undefined` is a real answer and means "at the root", which is where the
 * root plugin serves. It is not an error and not an empty state. Read the
 * first segment, strip the sigil, look it up; anything without a sigil, and
 * any namespace that matches nothing, is the root.
 *
 * Nothing here inspects the search string: context selectors live in the
 * query under a `ctx.` prefix and must never influence which scope resolves.
 */
export function resolveActiveScope(
  pathname: string,
  scopes: Scope[],
): Scope | undefined {
  const first = pathname.split("/").filter(Boolean)[0]
  if (!first?.startsWith(SCOPE_SIGIL)) return undefined
  return scopes.find((s) => s.namespace === first.slice(SCOPE_SIGIL.length))
}
