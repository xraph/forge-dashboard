import { definePlugin } from "@forge-go/dashboard-plugin"
import {
  Building2Icon,
  HouseIcon,
  RadioTowerIcon,
} from "@forge-go/dashboard-kit/icons"
import { DeviceDetailPage } from "./pages/device-detail"
import { OverviewPage } from "./pages/overview"
import { TenantDetailPage } from "./pages/tenant-detail"
import { TenantsPage } from "./pages/tenants"

export { DeviceDetailPage, OverviewPage, TenantDetailPage, TenantsPage }
export {
  devicePath,
  formatCount,
  formatSeconds,
  limitsSummary,
  tenantPath,
} from "./format"
export type {
  Ack,
  Client,
  ClientsList,
  Credentials,
  CreateTenantInput,
  Device,
  DevicesList,
  Limits,
  Retained,
  RetainedList,
  Role,
  RolesList,
  SessionInfo,
  Stats,
  Tenant,
  TenantsList,
  TopicRules,
  UpdateTenantInput,
} from "./types"

/**
 * The first-party UI for the `tether` extension, Tether's multi-tenant MQTT
 * broker.
 *
 * `extension` is "tether", the Go contributor name in Tether's contract
 * manifest and the join key the host looks up in the capabilities response.
 * `test/plugin.test.tsx` checks it by resolving against a capabilities
 * document. A wrong name resolves to `hidden` and logs nothing.
 *
 * Every Tether intent refuses with UNAUTHENTICATED unless the dashboard user
 * is signed in, so a dashboard with auth off shows the pages' sign-in message
 * rather than data.
 *
 * The pages read `session.info` first. An operator gets the node overview and
 * the tenant list; a tenant user gets their own tenant's page at `/` and at
 * `/tenants`, because the nav is fixed here and cannot drop the Tenants entry
 * for one session.
 *
 * No `requires` range: a range the host skips for a contributor that reports
 * no version reads as a guarantee and enforces nothing.
 */
export const tetherPlugin = definePlugin({
  extension: "tether",
  namespace: "tether",
  label: "Tether",
  icon: <RadioTowerIcon />,
  nav: [
    { label: "Overview", to: "/", priority: 10, icon: <HouseIcon /> },
    { label: "Tenants", to: "/tenants", priority: 20, icon: <Building2Icon /> },
  ],
  routes: [
    { path: "/", element: OverviewPage },
    { path: "/tenants", element: TenantsPage },
    // No nav entry: a sidebar link to "a tenant" with none chosen points
    // nowhere. It is reached from the list's name links.
    { path: "/tenants/:tenantId", element: TenantDetailPage },
    // Reached from the Devices and Clients tabs, so no nav entry either.
    { path: "/tenants/:tenantId/devices/:deviceId", element: DeviceDetailPage },
  ],
})

export default tetherPlugin
