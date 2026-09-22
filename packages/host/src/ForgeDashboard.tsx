import type { ReactNode } from "react"
import { BrowserRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import type { DashboardConfigInput } from "@forge-go/dashboard-runtime"
import type { ForgePlugin, ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import { TooltipProvider } from "@forge-go/dashboard-kit/components/tooltip"
import { PluginHost } from "./host/PluginHost"
import type { AuthScreens } from "./auth/routes"

export interface ForgeDashboardProps {
  /** Passed straight to ForgeDashboardProvider, which memoizes on identity. */
  config: DashboardConfigInput
  /**
   * Every plugin this host mounts. Whichever carries `root: true` claims "/";
   * the rest mount under their own "/@namespace". Array order is the
   * cross-plugin nav order.
   */
  plugins: ForgePlugin[]
  /**
   * Sub-plugins, each naming the plugin it mounts inside. Passed straight
   * through to PluginHost, which resolves each against the same capabilities
   * document as plugins.
   */
  subPlugins?: ForgeSubPlugin[]
  /**
   * Router mount prefix. apps/shell passes the injected shellBase. A Next.js
   * app passes the route segment it is mounted at, e.g. "/admin". Omitted
   * means no basename, which is the dev and externally hosted case.
   */
  basename?: string
  fetchImpl?: typeof fetch
  /**
   * Replaces any of the built-in auth screens, independently. A host app
   * supplies these, never a plugin: an application choosing its own sign-in
   * page is ordinary, a plugin forcing one on every dashboard is not.
   */
  authScreens?: AuthScreens
}

export function ForgeDashboard({
  config,
  plugins,
  subPlugins,
  basename,
  fetchImpl,
  authScreens,
}: ForgeDashboardProps): ReactNode {
  return (
    <ForgeDashboardProvider config={config}>
      <TooltipProvider>
        <BrowserRouter basename={basename}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost
              authScreens={authScreens}
              basename={basename}
              fetchImpl={fetchImpl}
              plugins={plugins}
              subPlugins={subPlugins}
            />
          </SessionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ForgeDashboardProvider>
  )
}
