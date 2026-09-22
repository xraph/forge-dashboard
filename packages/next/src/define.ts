import type { AuthScreens } from "@forge-go/dashboard-host"
import type { DashboardConfigInput } from "@forge-go/dashboard-runtime"
import type { ForgePlugin, ForgeSubPlugin } from "@forge-go/dashboard-plugin"

export interface ForgeDashboardOptions {
  /**
   * The route segment the dashboard page is mounted at, e.g. "/forge" for a
   * page at `app/forge/[[...slug]]/page.tsx`. This is the one value a host
   * app has to get right; everything else below is derived from it.
   */
  mountPath: string
  /**
   * The route segment the proxy route handler is mounted at, e.g. "/api/forge"
   * for a handler at `app/api/forge/[...path]/route.ts`.
   *
   * Defaults to `/api` plus the mount path, which is the layout a host gets by
   * following the two file paths above.
   */
  apiPath?: string
  /**
   * Every plugin this dashboard mounts. Whichever carries `root: true` claims
   * "/"; the rest mount under their own "/@namespace". Array order is the
   * cross-plugin nav order.
   */
  plugins: ForgePlugin[]
  /** Sub-plugins, each naming the plugin it mounts inside. */
  subPlugins?: ForgeSubPlugin[]
  /**
   * Replaces any of the built-in auth screens, independently. Name three and
   * the other two stay default.
   *
   * This belongs to the host app and never to a plugin. An application
   * choosing what its own sign-in page looks like is ordinary, a plugin
   * forcing one on every dashboard that installs it is the thing the rule
   * against plugin UI exists to stop.
   */
  authScreens?: AuthScreens
}

export interface ForgeDashboard {
  /** Where the page is mounted. Also the client router's basename. */
  mountPath: string
  /** Where the proxy route handler is mounted. */
  apiPath: string
  /** Ready to hand to ForgeDashboardProvider. */
  config: DashboardConfigInput
  plugins: ForgePlugin[]
  subPlugins?: ForgeSubPlugin[]
  authScreens?: AuthScreens
}

function assertRoutePath(name: string, value: string): void {
  if (!value.startsWith("/")) {
    throw new Error(
      `defineForgeDashboard: ${name} must start with "/", got "${value}".`
    )
  }
  if (value.length > 1 && value.endsWith("/")) {
    throw new Error(
      `defineForgeDashboard: ${name} must not end with "/", got "${value}". ` +
        "It is joined with other segments, and a trailing slash doubles up."
    )
  }
}

/**
 * Describes one Next.js-hosted Forge dashboard, deriving everything that has
 * to agree from the path it is mounted at.
 *
 * Three values have to line up for a dashboard to work at all: the client
 * router's basename, the page's own URL, and the prefix the contract is
 * reached on. Two of those are the same thing and the third is not, which is
 * the mistake worth designing out - a dashboard whose `basePath` points at its
 * own page answers every contract call with HTML and fails in a way that reads
 * like a server problem.
 *
 * Validation runs here, at module scope, rather than at render. A bad mount
 * path breaks the build that includes it instead of producing a blank panel in
 * somebody's dashboard three deploys later.
 *
 * ```ts
 * // forge.config.ts
 * export const forge = defineForgeDashboard({
 *   mountPath: "/forge",
 *   plugins: [corePlugin],
 * })
 * ```
 */
export function defineForgeDashboard(
  options: ForgeDashboardOptions
): ForgeDashboard {
  const { mountPath, plugins, subPlugins, authScreens } = options

  assertRoutePath("mountPath", mountPath)

  const apiPath =
    options.apiPath ?? (mountPath === "/" ? "/api" : `/api${mountPath}`)
  assertRoutePath("apiPath", apiPath)

  if (apiPath === mountPath) {
    throw new Error(
      `defineForgeDashboard: apiPath and mountPath are both "${mountPath}". ` +
        "The contract and the page cannot answer on the same URL."
    )
  }
  if (mountPath !== "/" && apiPath.startsWith(`${mountPath}/`)) {
    throw new Error(
      `defineForgeDashboard: apiPath "${apiPath}" sits under mountPath ` +
        `"${mountPath}". The page is an optional catch-all, so every contract ` +
        "URL would also be a page URL for the client router to match."
    )
  }

  return {
    mountPath,
    apiPath,
    config: {
      // The contract's prefix: the proxy route, not the page.
      basePath: apiPath,
      // The page's own URL, which is a different thing and a different value.
      shellBase: mountPath,
    },
    plugins,
    subPlugins,
    authScreens,
  }
}
