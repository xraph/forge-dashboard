import { definePlugin } from "@forge-go/dashboard-plugin"
import { SettingsIcon } from "@forge-go/dashboard-kit/icons"
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
    { label: "Settings", to: "/settings", priority: 90, icon: <SettingsIcon />, group: "Settings" },
  ],
  routes: [
    // "/" shows settings for now: the integrity page will take it over.
    { path: "/", element: SettingsPage },
    { path: "/settings", element: SettingsPage },
  ],
})

export default chroniclePlugin
