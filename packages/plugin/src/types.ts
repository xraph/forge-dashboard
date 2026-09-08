import type { ComponentType, ReactNode } from "react"

import type { PluginAuth } from "./auth"

/** One sidebar entry contributed by a plugin. `to` is relative to the plugin's scope. */
export interface PluginNavItem {
  label: string
  to: string
  /** Lower sorts earlier within this plugin's own group. */
  priority?: number
  icon?: ReactNode
  /** Nested entries. Rendered expanded; the kit has no collapsible primitive. */
  children?: PluginNavItem[]
  /**
   * The sidebar heading this item sorts under. Items with no group render
   * first, in one unlabelled group, which is what every plugin does today.
   * The Go manifests already declare these: Identity, Security, Auth,
   * Compliance, Enterprise, Configuration.
   */
  group?: string
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
   * is the thing being extended and has nothing to collide with. At most one
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
  /**
   * Marks this plugin as the dashboard's authentication provider and supplies
   * the screen shown when nobody is signed in.
   *
   * At most one plugin may set this. When it is set and the session resolves
   * to signed out, the host renders this component instead of the shell: no
   * sidebar, no scope switcher, no plugin routes mounted at all.
   */
  auth?: PluginAuth
  nav: PluginNavItem[]
  routes: PluginRoute[]
  /** Rendered when the extension is present but reports Configured: false. */
  setup?: ComponentType<{ message?: string }>
  /** Scope-wide selectors rendered in the sidebar. Most plugins declare none. */
  context: ContextDimension[]
}

/** What an author passes to definePlugin. nav is optional; the rest mirrors ForgePlugin. */
export interface PluginInput extends Omit<ForgePlugin, "nav" | "context"> {
  nav?: PluginNavItem[]
  context?: ContextDimension[]
}

export interface ContextOption {
  id: string
  label: string
}

/**
 * One dimension the whole scope is read through: an app, an environment, a
 * tenant.
 *
 * The host renders a switcher per dimension and knows nothing about what any
 * of them mean. Authsome scopes every handler to an app resolved from a
 * cookie, so switching is a command plus a full cache drop, and no query in
 * any plugin ever carries an app id.
 *
 * `query` and `switchCommand` are intents on the declaring plugin's own
 * extension. `select` pulls the current value and the choices out of whatever
 * that query returns, which is what lets two dimensions share one query: both
 * of authsome's read `apps.context`, and the store collapses that to a single
 * request.
 */
export interface ContextDimension {
  id: string
  label: string
  query: string
  switchCommand: string
  select: (data: unknown) => { current?: ContextOption; options: ContextOption[] }
  /**
   * Builds the switch command's payload from the chosen option's id.
   *
   * Not a fixed `{ id }`, because the contract does not use one:
   * `apps.switch` takes `{appId}` and `environments.switch` takes `{envId}`.
   * A hardcoded field name would send something the server ignores, and the
   * switch would appear to work while changing nothing. Keeping the shape
   * here is also what lets the host stay ignorant of what a dimension means.
   */
  payload: (optionId: string) => Record<string, unknown>
}

/** The six places a sub-plugin can push UI into a host plugin's pages. */
export const SLOT_NAMES = [
  "overview.widgets",
  "user.detail.sections",
  "org.detail.sections",
  "org.detail.tabs",
  "org.create.fields",
  "settings.tabs",
] as const

export type SlotName = (typeof SLOT_NAMES)[number]

export interface SlotContribution {
  /** Unique within one slot, per sub-plugin. Used as the React key. */
  id: string
  /** Lower sorts earlier. Ties break on id, so ordering is total and stable. */
  priority?: number
  /** Required by `org.detail.tabs`, which needs something to put on the tab. */
  label?: string
  /**
   * Receives the slot's params: `{ userId }` for user.detail.sections,
   * `{ orgId }` for the org slots, nothing for the rest.
   */
  render: ComponentType<Record<string, unknown>>
}

export interface ForgeSubPlugin {
  /**
   * This sub-plugin's own Go contributor. Decides whether it renders at all,
   * and scopes every query it makes. Never the same as `host`.
   */
  extension: string
  /** The `extension` of the plugin whose namespace this mounts inside. */
  host: string
  label?: string
  icon?: ReactNode
  requires?: string
  nav: PluginNavItem[]
  routes: PluginRoute[]
  contributions: Partial<Record<SlotName, SlotContribution[]>>
  /**
   * Host intents this sub-plugin may read through `useHostQuery` and
   * `useHostCommand`. Empty by default. The eighteen settings-only authsome
   * sub-plugins declare four; most sub-plugins declare none.
   */
  hostIntents: string[]
  setup?: ComponentType<{ message?: string }>
}

export interface SubPluginInput
  extends Omit<ForgeSubPlugin, "nav" | "routes" | "contributions" | "hostIntents"> {
  nav?: PluginNavItem[]
  routes?: PluginRoute[]
  contributions?: Partial<Record<SlotName, SlotContribution[]>>
  hostIntents?: string[]
}
