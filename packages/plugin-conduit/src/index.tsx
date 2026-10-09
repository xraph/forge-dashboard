import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  RadioIcon,
  LayoutGridIcon,
  UsersIcon,
  ActivityIcon,
  ArchiveIcon,
} from "@forge-go/dashboard-kit/icons"
import {
  ConduitOverviewPage,
  ConduitServicesPage,
  ConduitDeadLettersPage,
  ConduitHooksPage,
} from "./pages"
export {
  ConduitOverviewPage,
  ConduitServicesPage,
  ConduitDeadLettersPage,
  ConduitHooksPage,
}
export { ConduitConsumersPage } from "./consumers"
import { ConduitConsumersPage } from "./consumers"
export type * from "./types"
export const conduitPlugin = definePlugin({
  extension: "conduit",
  namespace: "conduit",
  label: "Conduit",
  icon: <RadioIcon />,
  nav: [
    { label: "Overview", to: "/", priority: 10, icon: <LayoutGridIcon /> },
    {
      label: "Consumers",
      to: "/consumers",
      priority: 15,
      icon: <ActivityIcon />,
    },
    { label: "Services", to: "/services", priority: 20, icon: <UsersIcon /> },
    {
      label: "Dead letters",
      to: "/deadletters",
      priority: 30,
      icon: <ArchiveIcon />,
    },
    {
      label: "Delivery hooks",
      to: "/hooks",
      priority: 40,
      icon: <ActivityIcon />,
    },
  ],
  routes: [
    { path: "/", element: ConduitOverviewPage },
    { path: "/consumers", element: ConduitConsumersPage },
    { path: "/services", element: ConduitServicesPage },
    { path: "/deadletters", element: ConduitDeadLettersPage },
    { path: "/hooks", element: ConduitHooksPage },
  ],
})
export default conduitPlugin
