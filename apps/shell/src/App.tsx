import type { ReactNode } from "react"
import { BrowserRouter } from "react-router"
import {
  ForgeDashboardProvider,
  configFromWindow,
  useDashboardConfig,
} from "@forge-go/dashboard-runtime"
import { TooltipProvider } from "@forge-go/dashboard-kit/components/tooltip"
import authsomePlugin from "@forge-go/dashboard-plugin-authsome"
import streamingPlugin from "@forge-go/dashboard-plugin-streaming"
import { PluginHost } from "./host/PluginHost"
import { corePlugin } from "./plugins/core"

// The Go handler injects window.__FORGE_DASHBOARD__ before this bundle loads,
// so the shell works on any BasePath. `pnpm dev` has no such handler, hence
// the fallback -- it matches the dev proxy in vite.config.ts.
//
// Hoisted beside the plugin list: ForgeDashboardProvider memoizes on config
// identity, so an inline object literal here would re-derive the config and
// cascade a re-render to every consumer on each render of App. PluginHost
// memoizes its scoped clients on the plugin array the same way.
const injected = configFromWindow()
const config = { basePath: injected.basePath ?? "/dashboard", ...injected }

// Order here is the cross-plugin nav order: priority sorts a plugin's own
// entries and nothing more, so the array decides which plugin's group comes
// first. core is the shell's own overview and leads; streaming and authsome
// follow in the order they were built.
const plugins = [corePlugin, streamingPlugin, authsomePlugin]

/**
 * The router, mounted at the prefix the shell is actually served from.
 *
 * basePath is the contract's prefix and is the wrong value here: the contract
 * answers at {basePath}/api/dashboard/v1, but the shell's HTML answers at
 * {basePath}/ui. shellBase is that second prefix, computed by the Go handler
 * and injected alongside the rest of the bootstrap.
 *
 * Without a basename the router reads the whole path as a route. At
 * /dashboard/ui the core plugin's "/overview" matches nothing, so <Routes>
 * renders an empty content pane under a sidebar that looks fine, and the nav
 * link resolves to /overview at the site root -- outside the mount, which
 * appears to work right up until the first refresh or shared deep link.
 *
 * It reads the resolved config from context rather than the injected object
 * above so the default lands in one place, in resolve(). `pnpm dev` and an
 * externally hosted build get "/", which is the no-basename behaviour.
 */
function ShellRouter({ children }: { children: ReactNode }) {
  const { shellBase } = useDashboardConfig()
  return <BrowserRouter basename={shellBase}>{children}</BrowserRouter>
}

export function App() {
  return (
    <ForgeDashboardProvider config={config}>
      <TooltipProvider>
        <ShellRouter>
          <PluginHost plugins={plugins} />
        </ShellRouter>
      </TooltipProvider>
    </ForgeDashboardProvider>
  )
}

export default App
