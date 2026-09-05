import { BrowserRouter } from "react-router"
import { ForgeDashboardProvider } from "@forge/dashboard-runtime"
import { TooltipProvider } from "@forge/dashboard-kit/components/tooltip"
import { PluginHost } from "./host/PluginHost"
import { coreDemoPlugin } from "./plugins/core-demo"

// Hoisted beside the plugin list: ForgeDashboardProvider memoizes on config
// identity, so an inline object literal here would re-derive the config and
// cascade a re-render to every consumer on each render of App. PluginHost
// memoizes its scoped clients on the plugin array the same way.
//
// basePath is the contract's prefix, not the router's. The SPA serves its own
// routes from "/", and Vite proxies everything under "/dashboard" to the Go
// server, so the two never collide.
const config = { basePath: "/dashboard" }
const plugins = [coreDemoPlugin]

export function App() {
  return (
    <ForgeDashboardProvider config={config}>
      <TooltipProvider>
        <BrowserRouter>
          <PluginHost plugins={plugins} />
        </BrowserRouter>
      </TooltipProvider>
    </ForgeDashboardProvider>
  )
}

export default App
