import { definePlugin } from "@forge-go/dashboard-plugin"
import { SettingsIcon, ShieldCheckIcon } from "@forge-go/dashboard-kit/icons"
import { ChainPage } from "./pages/chain"
import { SettingsPage } from "./pages/settings"

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
    { label: "Settings", to: "/settings", priority: 90, icon: <SettingsIcon />, group: "Settings" },
  ],
  routes: [
    { path: "/", element: ChainPage },
    { path: "/chain", element: ChainPage },
    { path: "/chain/:streamId", element: ChainPage },
    { path: "/chain/:streamId/:fromSeq/:toSeq", element: ChainPage },
    { path: "/settings", element: SettingsPage },
  ],
})

export default chroniclePlugin
