import type { ComponentType } from "react"

/** One sidebar entry contributed by a plugin. */
export interface PluginNavItem {
  label: string
  to: string
  /** Icon name resolved by the host against lucide. */
  icon?: string
  /** Lower sorts earlier within this plugin's own group. */
  priority?: number
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
