import {
  ForgeDashboardProvider,
  GraphRenderer,
  RegistryProvider,
} from "@forge/dashboard-runtime"
import type { GraphNode } from "@forge/dashboard-runtime"
import { TooltipProvider } from "@forge/dashboard-kit/components/tooltip"
import data from "@forge/dashboard-kit/app/dashboard/data.json"
import { buildIntentRegistry } from "./intents"

// W1 renders a graph literal. W2 replaces this with a real contract response.
const graph: GraphNode = {
  intent: "page.shell",
  title: "Overview",
  slots: {
    main: [
      { intent: "dashboard.stat" },
      { intent: "organism.chart" },
      { intent: "organism.data-grid", props: { rows: data } },
    ],
  },
}

// Hoisted beside the registry: ForgeDashboardProvider memoizes on config
// identity, so an inline object literal here would re-derive the config and
// cascade a re-render to every consumer on each render of App.
const config = { basePath: "/dashboard" }
const registry = buildIntentRegistry()

export function App() {
  return (
    <ForgeDashboardProvider config={config}>
      <RegistryProvider registry={registry}>
        <TooltipProvider>
          <GraphRenderer node={graph} />
        </TooltipProvider>
      </RegistryProvider>
    </ForgeDashboardProvider>
  )
}

export default App
