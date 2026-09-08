import type { ReactNode } from "react"
import { BrowserRouter } from "react-router"
import { ForgeDashboardProvider } from "@forge-go/dashboard-runtime"
import type { DashboardConfigInput } from "@forge-go/dashboard-runtime"
import type { ForgePlugin } from "@forge-go/dashboard-plugin"
import { TooltipProvider } from "@forge-go/dashboard-kit/components/tooltip"
import { PluginHost } from "./host/PluginHost"

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
   * Router mount prefix. apps/shell passes the injected shellBase. A Next.js
   * app passes the route segment it is mounted at, e.g. "/admin". Omitted
   * means no basename, which is the dev and externally hosted case.
   */
  basename?: string
  fetchImpl?: typeof fetch
}

export function ForgeDashboard({
  config,
  plugins,
  basename,
  fetchImpl,
}: ForgeDashboardProps): ReactNode {
  return (
    <ForgeDashboardProvider config={config}>
      <TooltipProvider>
        <BrowserRouter basename={basename}>
          <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
        </BrowserRouter>
      </TooltipProvider>
    </ForgeDashboardProvider>
  )
}
