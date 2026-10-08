import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  BellOffIcon,
  FileTextIcon,
  HouseIcon,
  InboxIcon,
  MailIcon,
  RouteIcon,
  SendIcon,
  ServerIcon,
} from "@forge-go/dashboard-kit/icons"
import {
  inboxPath,
  messagesPath,
  newProviderPath,
  newTemplatePath,
  preferencesPath,
  providersPath,
  routingPath,
  sendTestPath,
  templatesPath,
  templatesWithoutFallbackPath,
} from "./keys"
import { InboxPage } from "./pages/inbox"
import { MessageDetailPage } from "./pages/message-detail"
import { MessagesPage } from "./pages/messages"
import { OverviewPage } from "./pages/overview"
import { PreferencesPage } from "./pages/preferences"
import { ProviderDetailPage } from "./pages/provider-detail"
import { ProvidersPage } from "./pages/providers"
import { RoutingPage } from "./pages/routing"
import { SendTestPage } from "./pages/send-test"
import { TemplateCreatePage } from "./pages/template-create"
import { TemplatesPage, TemplatesWithoutFallbackPage } from "./pages/templates"

/**
 * The provider forms are their own chunks: only an operator adding or
 * changing a provider pays for them. PluginHost wraps every page in Suspense.
 */
const ProviderCreatePage = lazy(() => import("./pages/provider-create"))
const ProviderEditPage = lazy(() => import("./pages/provider-edit"))
/** The template workspace is its own chunk, and CodeMirror is further chunks below it. */
const TemplateWorkspacePage = lazy(() => import("./pages/template-workspace"))

export {
  InboxPage,
  MessageDetailPage,
  MessagesPage,
  OverviewPage,
  PreferencesPage,
  ProviderDetailPage,
  ProvidersPage,
  RoutingPage,
  SendTestPage,
  TemplateCreatePage,
  TemplatesPage,
  TemplatesWithoutFallbackPage,
}
export {
  DanglingBadge,
  DisabledProviderBadge,
  EnabledBadge,
  MessageStatusBadge,
  ProtectionBadge,
  VersionBadge,
} from "./badges"
export { HeraldHeader, useEngineInfo } from "./components/herald-header"
export type * from "./wire"

/**
 * The first-party UI for the `herald` extension.
 *
 * `extension` is "herald", the Go contributor name from
 * herald/extension/contract/manifest.yaml, and the join key the host looks
 * up in the capabilities response. The label must spell the extension, so it
 * is "Herald"; "Notifications" names the nav group and the overview page.
 *
 * No `requires` range: a range the host skips for a contributor that reports
 * no version reads as a guarantee and enforces nothing.
 */
export const heraldPlugin = definePlugin({
  extension: "herald",
  namespace: "herald",
  label: "Herald",
  nav: [
    {
      label: "Overview",
      to: "/",
      priority: -10,
      icon: <HouseIcon />,
      group: "Notifications",
    },
    {
      label: "Providers",
      to: providersPath,
      priority: 30,
      icon: <ServerIcon />,
      group: "Notifications",
    },
    {
      label: "Templates",
      to: templatesPath,
      priority: 10,
      icon: <FileTextIcon />,
      group: "Notifications",
    },
    {
      label: "Messages",
      to: messagesPath,
      priority: 20,
      icon: <MailIcon />,
      group: "Notifications",
    },
    {
      label: "Inbox",
      to: inboxPath,
      priority: 50,
      icon: <InboxIcon />,
      group: "Notifications",
    },
    {
      label: "Preferences",
      to: preferencesPath,
      priority: 60,
      icon: <BellOffIcon />,
      group: "Notifications",
    },
    {
      label: "Routing",
      to: routingPath,
      priority: 40,
      icon: <RouteIcon />,
      group: "Notifications",
    },
    {
      label: "Send test",
      to: sendTestPath,
      priority: 70,
      icon: <SendIcon />,
      group: "Notifications",
    },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: providersPath, element: ProvidersPage },
    { path: "/providers/:id", element: ProviderDetailPage },
    // No nav entries: reached from buttons. Create lives at /new-provider so no ID can collide with it.
    { path: newProviderPath, element: ProviderCreatePage },
    { path: "/providers/:id/edit", element: ProviderEditPage },
    { path: templatesPath, element: TemplatesPage },
    {
      path: templatesWithoutFallbackPath,
      element: TemplatesWithoutFallbackPage,
    },
    { path: newTemplatePath, element: TemplateCreatePage },
    { path: "/templates/:id", element: TemplateWorkspacePage },
    { path: messagesPath, element: MessagesPage },
    { path: "/messages/:id", element: MessageDetailPage },
    { path: inboxPath, element: InboxPage },
    { path: preferencesPath, element: PreferencesPage },
    { path: routingPath, element: RoutingPage },
    { path: sendTestPath, element: SendTestPage },
    // No nav entries: reached from a provider's and a message's own page.
    { path: "/providers/:providerId/send-test", element: SendTestPage },
    { path: "/messages/:messageId/send-test", element: SendTestPage },
  ],
})

export default heraldPlugin
