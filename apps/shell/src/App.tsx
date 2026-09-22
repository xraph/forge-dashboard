import { ForgeDashboard } from "@forge-go/dashboard-host"
import { configFromWindow } from "@forge-go/dashboard-runtime"
import corePlugin from "@forge-go/dashboard-plugin-core"
import authsomePlugin, {
  authsomeSubPlugins,
} from "@forge-go/dashboard-plugin-authsome"
import streamingPlugin from "@forge-go/dashboard-plugin-streaming"

// The Go handler injects window.__FORGE_DASHBOARD__ before this bundle loads,
// so the shell works on any BasePath. `pnpm dev` has no such handler, hence
// the fallback: it matches the dev proxy in vite.config.ts.
//
// Hoisted rather than inline: ForgeDashboardProvider memoizes on config
// identity and PluginHost memoizes its scoped clients on the plugin array, so
// an inline literal would cascade a re-render on every render of App.
const injected = configFromWindow()
const config = { basePath: injected.basePath ?? "/dashboard", ...injected }

// core carries root: true and claims "/". streaming and authsome mount under
// their own namespaces. Array order is the cross-plugin nav order.
const plugins = [corePlugin, streamingPlugin, authsomePlugin]

// The twenty-four authsome sub-plugins: six carrying data of their own, and
// eighteen that are a nav entry and a settings panel. Each one appears only
// when the capabilities response names its own Go contributor, so a
// deployment without the waitlist plugin has no Waitlist page and that is
// correct rather than broken. Passing them here is the whole of the wiring;
// everything else about them is declared in the sub-plugins themselves.
const subPlugins = authsomeSubPlugins

export function App() {
  return (
    <ForgeDashboard
      config={config}
      basename={injected.shellBase}
      plugins={plugins}
      subPlugins={subPlugins}
    />
  )
}

export default App
