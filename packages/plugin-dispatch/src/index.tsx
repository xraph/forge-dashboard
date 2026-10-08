import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  HouseIcon,
  LayersIcon,
  ServerIcon,
  CodeIcon,
  SettingsIcon,
} from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"

const QueuesPage = lazy(() =>
  import("./pages/queues").then((module) => ({ default: module.QueuesPage }))
)
const QueueDetailPage = lazy(() =>
  import("./pages/queues").then((module) => ({
    default: module.QueueDetailPage,
  }))
)
const WorkersPage = lazy(() =>
  import("./pages/workers").then((module) => ({ default: module.WorkersPage }))
)
const WorkerDetailPage = lazy(() =>
  import("./pages/workers").then((module) => ({
    default: module.WorkerDetailPage,
  }))
)
const HandlersPage = lazy(() =>
  import("./pages/handlers").then((module) => ({
    default: module.HandlersPage,
  }))
)
const JobHandlerPage = lazy(() =>
  import("./pages/handlers").then((module) => ({
    default: module.JobHandlerPage,
  }))
)
const WorkflowHandlerPage = lazy(() =>
  import("./pages/handlers").then((module) => ({
    default: module.WorkflowHandlerPage,
  }))
)
const EnginePage = lazy(() =>
  import("./pages/config").then((module) => ({ default: module.EnginePage }))
)

export const dispatchPlugin = definePlugin({
  extension: "dispatch",
  namespace: "dispatch",
  label: "Dispatch",
  nav: [
    {
      label: "Overview",
      to: "/",
      priority: -10,
      group: "Dispatch",
      icon: <HouseIcon />,
    },
    {
      label: "Queues",
      to: "/queues",
      priority: 40,
      group: "Monitoring",
      icon: <LayersIcon />,
    },
    {
      label: "Workers",
      to: "/workers",
      priority: 50,
      group: "Monitoring",
      icon: <ServerIcon />,
    },
    {
      label: "Handlers",
      to: "/handlers",
      priority: 70,
      group: "Configuration",
      icon: <CodeIcon />,
    },
    {
      label: "Engine",
      to: "/config",
      priority: 80,
      group: "Configuration",
      icon: <SettingsIcon />,
    },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/queues", element: QueuesPage },
    { path: "/queues/:name", element: QueueDetailPage },
    { path: "/workers", element: WorkersPage },
    { path: "/workers/:id", element: WorkerDetailPage },
    { path: "/handlers", element: HandlersPage },
    { path: "/handlers/jobs/:name", element: JobHandlerPage },
    { path: "/handlers/workflows/:name", element: WorkflowHandlerPage },
    { path: "/config", element: EnginePage },
  ],
})
export default dispatchPlugin
export { Action } from "./action"
export {
  CronBadge,
  HeartbeatBadge,
  JobStateBadge,
  ReplayBadge,
  RunStateBadge,
} from "./badges"
export { CursorPager, EmptyResults, useCursor } from "./cursor"
export { LiveStamp, Read, useDispatchQuery, useLive } from "./read"
export type { Duration, JobState, Page, RunState, Snapshot } from "./types"
