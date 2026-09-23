import { definePlugin } from "@forge-go/dashboard-plugin"
import { WebhookIcon } from "@forge-go/dashboard-kit/icons"
import { RelayEndpointsPage } from "./pages/endpoints"

export type { EndpointSummary, EndpointsList } from "./pages/endpoints"

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
  nav: [
    {
      label: "Endpoints",
      to: "/endpoints",
      priority: 10,
      icon: <WebhookIcon />,
      group: "Webhooks",
    },
  ],
  routes: [{ path: "/endpoints", element: RelayEndpointsPage }],
})

export default relayPlugin
