import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import { ArchiveIcon, ChartColumnIcon, EraserIcon, FileTextIcon, MilestoneIcon, ScrollTextIcon, SettingsIcon, ShieldIcon, TimerResetIcon } from "@forge-go/dashboard-kit/icons"
import { ArchivesPage } from "./pages/archives"
import { ChainPage } from "./pages/chain"
import { CheckpointDetailPage } from "./pages/checkpoint-detail"
import { CheckpointsPage } from "./pages/checkpoints"
import { ErasureDetailPage } from "./pages/erasure-detail"
import { ErasuresPage } from "./pages/erasures"
import { CustomReportCreatePage } from "./pages/custom-report-create"
import { EventsPage } from "./pages/events"
import { PolicyCreatePage } from "./pages/policy-create"
import { PolicyDetailPage } from "./pages/policy-detail"
import { ReportCreatePage } from "./pages/report-create"
import { ReportDetailPage } from "./pages/report-detail"
import { ReportsPage } from "./pages/reports"
import { RetentionPage } from "./pages/retention"
import { SettingsPage } from "./pages/settings"
import { UserEventsPage } from "./pages/user-events"

// CodeMirror is this page's weight, so it loads when an event is opened.
const EventDetailPage = lazy(() => import("./pages/event-detail"))
// The charts are recharts, heavier than every other chronicle page together,
// so they load when Activity is opened and not with the shell.
const ActivityPage = lazy(() => import("./pages/activity"))

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
  // No nav icon carries a check mark: it would be a pass shown permanently, on
  // a deployment whose chain may be unkeyed and has not been verified.
  nav: [
    { label: "Chain", to: "/chain", priority: 0, icon: <ShieldIcon />, group: "Integrity" },
    { label: "Checkpoints", to: "/checkpoints", priority: 10, icon: <MilestoneIcon />, group: "Integrity" },
    { label: "Events", to: "/events", priority: 20, icon: <ScrollTextIcon />, group: "Log" },
    { label: "Activity", to: "/activity", priority: 30, icon: <ChartColumnIcon />, group: "Log" },
    { label: "Reports", to: "/reports", priority: 40, icon: <FileTextIcon />, group: "Compliance" },
    { label: "Erasures", to: "/erasures", priority: 50, icon: <EraserIcon />, group: "Compliance" },
    { label: "Policies", to: "/retention", priority: 60, icon: <TimerResetIcon />, group: "Retention" },
    { label: "Archives", to: "/archives", priority: 70, icon: <ArchiveIcon />, group: "Retention" },
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
    { path: "/activity", element: ActivityPage },
    { path: "/users/:userId", element: UserEventsPage },
    { path: "/erasures", element: ErasuresPage },
    { path: "/erasures/:id", element: ErasureDetailPage },
    { path: "/reports", element: ReportsPage },
    { path: "/reports/:id", element: ReportDetailPage },
    { path: "/new-report", element: ReportCreatePage },
    { path: "/new-custom-report", element: CustomReportCreatePage },
    { path: "/retention", element: RetentionPage },
    { path: "/new-policy", element: PolicyCreatePage },
    { path: "/retention/:id", element: PolicyDetailPage },
    { path: "/archives", element: ArchivesPage },
    { path: "/settings", element: SettingsPage },
  ],
})

export default chroniclePlugin
