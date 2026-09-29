import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ActivityIcon,
  HouseIcon,
  InboxIcon,
  SendIcon,
  SettingsIcon,
  TagsIcon,
  WebhookIcon,
} from "@forge-go/dashboard-kit/icons"
import { RelayEndpointsPage } from "./pages/endpoints"
import { RelayEndpointCreatePage } from "./pages/endpoint-create"
import { RelayEndpointDetailPage } from "./pages/endpoint-detail"
import { RelayOverviewPage } from "./pages/overview"
import { RelayDeliveriesPage } from "./pages/deliveries"
import { RelayDeliveryDetailPage } from "./pages/delivery-detail"
import { RelayEventsPage } from "./pages/events"
import { RelayEventDetailPage } from "./pages/event-detail"
import { RelayEventSendPage } from "./pages/event-send"
import { RelayEventTypesPage } from "./pages/event-types"
import { RelayEventTypeDetailPage } from "./pages/event-type-detail"
import { RelayEventTypeRegisterPage } from "./pages/event-type-register"
import { RelayDLQPage } from "./pages/dlq"
import { RelayDLQDetailPage } from "./pages/dlq-detail"
import { RelaySettingsPage } from "./pages/settings"

export type { EndpointSummary, EndpointsList } from "./pages/endpoints"
export type { EndpointDetail } from "./pages/endpoint-detail"
export type * from "./types"

/**
 * Relay is the webhook delivery engine: endpoints subscribe to event types
 * with glob patterns, events fan out to whatever matches, and deliveries
 * retry on a backoff schedule.
 *
 * `extension` is the Go contributor name, relay's extension.ExtensionName and
 * relaycontract.ContributorName. It is the join key: a typo hides the plugin
 * with no error anywhere, because that is what an uninstalled extension looks
 * like. test/plugin.test.tsx checks it by resolving against a host, not by
 * comparing it to a literal.
 */
export const relayPlugin = definePlugin({
  extension: "relay",
  namespace: "relay",
  label: "Relay",
  icon: <WebhookIcon />,
  // Traffic is what happened; configuration is what decides it.
  nav: [
    {
      label: "Overview",
      to: "/",
      priority: 0,
      icon: <HouseIcon />,
      group: "Overview",
    },
    {
      label: "Deliveries",
      to: "/deliveries",
      priority: 10,
      icon: <ActivityIcon />,
      group: "Traffic",
    },
    {
      label: "Events",
      to: "/events",
      priority: 20,
      icon: <SendIcon />,
      group: "Traffic",
    },
    {
      label: "Dead letters",
      to: "/dlq",
      priority: 30,
      icon: <InboxIcon />,
      group: "Traffic",
    },
    {
      label: "Endpoints",
      to: "/endpoints",
      priority: 40,
      icon: <WebhookIcon />,
      group: "Configuration",
    },
    {
      label: "Event types",
      to: "/event-types",
      priority: 50,
      icon: <TagsIcon />,
      group: "Configuration",
    },
    {
      label: "Settings",
      to: "/settings",
      priority: 60,
      icon: <SettingsIcon />,
      group: "Configuration",
    },
  ],
  // Routes with no nav entry are reached from a list: a detail page, or a
  // form opened by a list's action.
  routes: [
    { path: "/", element: RelayOverviewPage },
    { path: "/deliveries", element: RelayDeliveriesPage },
    { path: "/deliveries/:id", element: RelayDeliveryDetailPage },
    { path: "/events", element: RelayEventsPage },
    { path: "/events/send", element: RelayEventSendPage },
    { path: "/events/:id", element: RelayEventDetailPage },
    { path: "/dlq", element: RelayDLQPage },
    { path: "/dlq/:id", element: RelayDLQDetailPage },
    { path: "/endpoints", element: RelayEndpointsPage },
    { path: "/endpoints/new", element: RelayEndpointCreatePage },
    { path: "/endpoints/:id", element: RelayEndpointDetailPage },
    { path: "/event-types", element: RelayEventTypesPage },
    { path: "/event-types/new", element: RelayEventTypeRegisterPage },
    { path: "/event-types/:name", element: RelayEventTypeDetailPage },
    { path: "/settings", element: RelaySettingsPage },
  ],
})

export default relayPlugin
