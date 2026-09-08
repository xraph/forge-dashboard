import type { ComponentType, ReactNode } from "react"

/** One sidebar entry contributed by a plugin. `to` is relative to the plugin's scope. */
export interface PluginNavItem {
  label: string
  to: string
  /** Lower sorts earlier within this plugin's own group. */
  priority?: number
  icon?: ReactNode
  /** Nested entries. Rendered expanded; the kit has no collapsible primitive. */
  children?: PluginNavItem[]
}

/** One route contributed by a plugin. */
export interface PluginRoute {
  path: string
  element: ComponentType
}

export interface ForgePlugin {
  /**
   * The Go contributor name this plugin belongs to. This is the join key: the
   * host looks this name up in the server's capabilities response to decide
   * whether the plugin is hidden, mismatched, unconfigured or live.
   */
  extension: string
  /**
   * Mounts this plugin's routes at the dashboard root rather than under a
   * namespace, so `to: "/overview"` serves at "/overview".
   *
   * The server's own pages belong here. Extensions arrive from elsewhere and
   * can collide with each other, which is what namespaces are for; the server
   * is the thing being extended and has nothing to collide with. Exactly one
   * plugin may set this, and a plugin that sets it must not also set
   * `namespace`, because then it cannot say where it mounts.
   */
  root?: boolean
  /**
   * The URL segment this plugin mounts under, without the `@` sigil. Defaults
   * to `extension` with a trailing "-contract" stripped. Kept separate from
   * `extension` so the Go join key never reaches a URL.
   */
  namespace?: string
  /** Display name in the scope switcher. Falls back to `extension`. */
  label?: string
  icon?: ReactNode
  /**
   * Semver range of the Go extension this UI supports. Omit to skip the check.
   */
  requires?: string
  nav: PluginNavItem[]
  routes: PluginRoute[]
  /** Rendered when the extension is present but reports Configured: false. */
  setup?: ComponentType<{ message?: string }>
}

/** What an author passes to definePlugin. nav is optional; the rest mirrors ForgePlugin. */
export interface PluginInput extends Omit<ForgePlugin, "nav"> {
  nav?: PluginNavItem[]
}
