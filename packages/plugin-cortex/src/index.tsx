import { lazy } from "react"
import {
  definePlugin,
  type PluginPageProps,
  type PluginRoute,
} from "@forge-go/dashboard-plugin"
import { BotIcon } from "@forge-go/dashboard-kit/icons"
import { ConfigDetail, ConfigEdit, ConfigList } from "./pages/configuration"
import {
  CheckpointPage,
  CheckpointsPage,
  OverviewPage,
  RunPage,
  RunsPage,
  SessionPage,
  SessionsPage,
} from "./pages/operations"
import type { Resource } from "./types"
const Chat = lazy(() =>
  import("./pages/chat").then((m) => ({ default: m.ChatPage }))
)
const Catalog = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.CatalogPage }))
)
const CatalogDetail = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.CatalogDetail }))
)
const Tools = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.ToolsPage }))
)
const Tool = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.ToolPage }))
)
const Settings = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.SettingsPage }))
)
const Overlays = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.OverlaysPage }))
)
const Conversations = lazy(() =>
  import("./pages/integrations").then((m) => ({ default: m.ConversationsPage }))
)
const OrchestrationRuns = lazy(() =>
  import("./pages/integrations").then((m) => ({
    default: m.OrchestrationRunsPage,
  }))
)
const OrchestrationExecute = lazy(() =>
  import("./pages/integrations").then((m) => ({
    default: m.OrchestrationExecute,
  }))
)
const resources: Resource[] = [
  "agents",
  "personas",
  "skills",
  "traits",
  "behaviors",
  "orchestrations",
]
const routes: PluginRoute[] = resources.flatMap((resource) => [
  { path: `/${resource}`, element: () => <ConfigList resource={resource} /> },
  {
    path: `/${resource}/new`,
    element: () => <ConfigEdit resource={resource} />,
  },
  {
    path: `/${resource}/:id`,
    element: ({ params }: PluginPageProps) => (
      <ConfigDetail resource={resource} id={params.id!} />
    ),
  },
  {
    path: `/${resource}/:id/edit`,
    element: ({ params }: PluginPageProps) => (
      <ConfigEdit resource={resource} id={params.id!} />
    ),
  },
])
export const cortexPlugin = definePlugin({
  extension: "cortex",
  namespace: "cortex",
  label: "Cortex",
  icon: <BotIcon />,
  nav: [
    { label: "Overview", to: "/", group: "Overview", priority: 0 },
    ...resources.slice(0, 5).map((r, i) => ({
      label: r[0].toUpperCase() + r.slice(1),
      to: `/${r}`,
      group: "Configuration",
      priority: 10 + i,
    })),
    { label: "Chat", to: "/chat", group: "Execution", priority: 30 },
    {
      label: "Playground",
      to: "/playground",
      group: "Execution",
      priority: 31,
    },
    { label: "Runs", to: "/runs", group: "Execution", priority: 32 },
    {
      label: "Pending approvals",
      to: "/checkpoints",
      group: "Execution",
      priority: 33,
    },
    {
      label: "Sessions and memory",
      to: "/sessions",
      group: "Execution",
      priority: 34,
    },
    {
      label: "Orchestrations",
      to: "/orchestrations",
      group: "Execution",
      priority: 35,
    },
    {
      label: "Orchestration runs",
      to: "/orchestration-runs",
      group: "Execution",
      priority: 36,
    },
    {
      label: "Agent messaging",
      to: "/conversations",
      group: "Execution",
      priority: 37,
    },
    { label: "Tools", to: "/tools", group: "Integrations", priority: 50 },
    { label: "Models", to: "/models", group: "Integrations", priority: 51 },
    {
      label: "Knowledge",
      to: "/knowledge",
      group: "Integrations",
      priority: 52,
    },
    {
      label: "Safety profiles",
      to: "/safety/profiles",
      group: "Integrations",
      priority: 53,
    },
    {
      label: "Safety scans",
      to: "/safety/scans",
      group: "Integrations",
      priority: 54,
    },
    {
      label: "Runtime settings",
      to: "/settings",
      group: "Configuration",
      priority: 60,
    },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    ...routes,
    { path: "/runs", element: () => <RunsPage /> },
    {
      path: "/runs/agent/:agentId",
      element: ({ params }) => <RunsPage agentId={params.agentId} />,
    },
    { path: "/runs/:id", element: ({ params }) => <RunPage id={params.id!} /> },
    { path: "/checkpoints", element: CheckpointsPage },
    {
      path: "/checkpoints/:id",
      element: ({ params }) => <CheckpointPage id={params.id!} />,
    },
    { path: "/sessions", element: () => <SessionsPage /> },
    {
      path: "/sessions/agent/:agentId",
      element: ({ params }) => <SessionsPage agentId={params.agentId} />,
    },
    {
      path: "/sessions/:id",
      element: ({ params }) => <SessionPage id={params.id!} />,
    },
    { path: "/memory", element: () => <SessionsPage /> },
    ...["chat", "playground"].flatMap((kind) => [
      {
        path: `/${kind}`,
        element: () => <Chat playground={kind === "playground"} />,
      },
      {
        path: `/${kind}/:agentId`,
        element: ({ params }: PluginPageProps) => (
          <Chat agentId={params.agentId} playground={kind === "playground"} />
        ),
      },
      {
        path: `/${kind}/:agentId/session/:sessionId`,
        element: ({ params }: PluginPageProps) => (
          <Chat
            agentId={params.agentId}
            sessionId={params.sessionId}
            playground={kind === "playground"}
          />
        ),
      },
    ]),
    { path: "/tools", element: () => <Tools /> },
    {
      path: "/tools/:agentId",
      element: ({ params }) => <Tools agentId={params.agentId} />,
    },
    {
      path: "/tools/:agentId/:name",
      element: ({ params }) => (
        <Tool agentId={params.agentId!} name={params.name!} />
      ),
    },
    { path: "/models", element: () => <Catalog kind="models" /> },
    {
      path: "/models/:id",
      element: ({ params }) => <CatalogDetail kind="models" id={params.id!} />,
    },
    { path: "/knowledge", element: () => <Catalog kind="knowledge" /> },
    {
      path: "/knowledge/:id",
      element: ({ params }) => (
        <CatalogDetail kind="knowledge" id={params.id!} />
      ),
    },
    { path: "/safety/profiles", element: () => <Catalog kind="profiles" /> },
    { path: "/safety/scans", element: () => <Catalog kind="scans" /> },
    {
      path: "/safety/scans/run/:runId",
      element: ({ params }) => <Catalog kind="scans" runId={params.runId} />,
    },
    {
      path: "/overlays/:agentId",
      element: ({ params }) => <Overlays agentId={params.agentId!} />,
    },
    { path: "/conversations", element: () => <Conversations /> },
    {
      path: "/conversations/:id",
      element: ({ params }) => <Conversations id={params.id} />,
    },
    { path: "/orchestration-runs", element: () => <OrchestrationRuns /> },
    {
      path: "/orchestration-runs/:id",
      element: ({ params }) => <OrchestrationRuns id={params.id} />,
    },
    {
      path: "/orchestrations/:id/execute",
      element: ({ params }) => <OrchestrationExecute id={params.id!} />,
    },
    { path: "/settings", element: () => <Settings /> },
  ],
})
export type * from "./types"
export default cortexPlugin
