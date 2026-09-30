import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import { MilestoneIcon, ScrollTextIcon, SettingsIcon, ShieldCheckIcon } from "@forge-go/dashboard-kit/icons"
import { ChainPage } from "./pages/chain"
import { CheckpointDetailPage } from "./pages/checkpoint-detail"
import { CheckpointsPage } from "./pages/checkpoints"
import { EventsPage } from "./pages/events"
import { SettingsPage } from "./pages/settings"
import { UserEventsPage } from "./pages/user-events"

// CodeMirror is this page's weight, so it loads when an event is opened.
const EventDetailPage = lazy(() => import("./pages/event-detail"))

export type * from "./types"

/**
 * Chronicle's dashboard. Integrity is the landing page: this is the one
 * extension whose job is to prove a record was not altered, so verification
 * is the first thing an operator sees, not a detail page hung off a list.
 *
 * No `requires` range: the contract declares its own version per intent, and
 * a range here would only restate it.
 */
export const chroniclePlugin = definePlugin({
  extension: "chronicle",
  namespace: "chronicle",
  label: "Chronicle",
  nav: [
    { label: "Chain", to: "/chain", priority: 0, icon: <ShieldCheckIcon />, group: "Integrity" },
    { label: "Checkpoints", to: "/checkpoints", priority: 10, icon: <MilestoneIcon />, group: "Integrity" },
    { label: "Events", to: "/events", priority: 20, icon: <ScrollTextIcon />, group: "Log" },
    { label: "Settings", to: "/settings", priority: 90, icon: <SettingsIcon />, group: "Settings" },
  ],
  routes: [
    { path: "/", element: ChainPage },
    { path: "/chain", element: ChainPage },
    { path: "/chain/:streamId", element: ChainPage },
    { path: "/chain/:streamId/:fromSeq/:toSeq", element: ChainPage },
    { path: "/checkpoints", element: CheckpointsPage },
    { path: "/checkpoints/in/:streamId", element: CheckpointsPage },
    { path: "/checkpoint/:id", element: CheckpointDetailPage },
    { path: "/events", element: EventsPage },
    { path: "/events/:id", element: EventDetailPage },
    { path: "/users/:userId", element: UserEventsPage },
    { path: "/settings", element: SettingsPage },
  ],
})

export default chroniclePlugin
