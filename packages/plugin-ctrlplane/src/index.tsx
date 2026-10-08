import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  ConfigPage,
  HealthPage,
  LogPage,
  OverviewPage,
  ResourceDetail,
  ResourceEditor,
  ResourceList,
  SelectionPage,
} from "./pages"
import { resources } from "./resources"
import type { PageProps } from "./types"
export { resources } from "./resources"
export { OverviewPage, HealthPage } from "./pages"
export const ctrlplanePlugin = definePlugin({
  extension: "ctrlplane",
  namespace: "ctrlplane",
  label: "Ctrlplane",
  nav: [
    { label: "Overview", to: "/", group: "Overview", priority: 0 },
    ...Object.entries(resources)
      .filter(([key]) => !["releases", "deployments"].includes(key))
      .map(([key, resource], index) => ({
        label: resource.title,
        to: `/${key}`,
        group: ["tenants"].includes(key)
          ? "Administration"
          : ["providers", "workers"].includes(key)
            ? "Operations"
            : "Infrastructure",
        priority: index * 10,
      })),
    {
      label: "Deployments",
      to: "/deployments",
      group: "Infrastructure",
      priority: 25,
    },
    { label: "Health", to: "/health", group: "Infrastructure", priority: 30 },
    { label: "Network", to: "/network", group: "Networking", priority: 0 },
    { label: "Secrets", to: "/secrets", group: "Networking", priority: 10 },
    { label: "Events", to: "/events", group: "Operations", priority: 40 },
    { label: "Audit log", to: "/audit", group: "Administration", priority: 20 },
    { label: "Settings", to: "/settings", group: "Operations", priority: 50 },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    ...Object.keys(resources)
      .filter((key) => !["deployments", "releases"].includes(key))
      .map((kind) => ({
        path: `/${kind}`,
        element: () => <ResourceList kind={kind} />,
      })),
    {
      path: "/instances/:id/:section",
      element: (props: PageProps) => (
        <ResourceDetail {...props} kind="instances" />
      ),
    },
    ...Object.keys(resources).map((kind) => ({
      path: `/${kind}/:id`,
      element: (props: PageProps) => <ResourceDetail {...props} kind={kind} />,
    })),
    ...Object.entries(resources)
      .filter(([, resource]) => resource.create)
      .map(([kind]) => ({
        path: `/${kind}/create`,
        element: (props: PageProps) => (
          <ResourceEditor {...props} kind={kind} />
        ),
      })),
    ...Object.entries(resources)
      .filter(([, resource]) => resource.edit)
      .map(([kind]) => ({
        path: `/${kind}/:id/edit`,
        element: (props: PageProps) => (
          <ResourceEditor {...props} kind={kind} />
        ),
      })),
    ...(["deployments", "network", "secrets"] as const).map((surface) => ({
      path: `/${surface}`,
      element: () => <SelectionPage surface={surface} />,
    })),
    { path: "/health", element: HealthPage },
    { path: "/events", element: () => <LogPage kind="events" /> },
    { path: "/audit", element: () => <LogPage kind="audit" /> },
    { path: "/settings", element: ConfigPage },
  ],
})
export default ctrlplanePlugin
