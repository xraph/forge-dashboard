"use client"

import { ForgeDashboardPage } from "@forge-go/dashboard-next"
import { forge } from "../../../forge.config"

/*
 * A client component, and it has to be. `forge` carries the plugins, and a
 * plugin is React components, which cannot cross a server-to-client prop
 * boundary.
 */
export default function Page() {
  return <ForgeDashboardPage forge={forge} />
}
