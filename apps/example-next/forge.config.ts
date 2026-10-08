import { defineForgeDashboard } from "@forge-go/dashboard-next"
import authsomePlugin from "@forge-go/dashboard-plugin-authsome"
import corePlugin from "@forge-go/dashboard-plugin-core"
import sentinelPlugin from "@forge-go/dashboard-plugin-sentinel"
import streamingPlugin from "@forge-go/dashboard-plugin-streaming"
import trovePlugin from "@forge-go/dashboard-plugin-trove"
import nexusPlugin from "@forge-go/dashboard-plugin-nexus"

/*
 * One value. The page lives at app/admin/[[...slug]]/page.tsx and the contract
 * proxy at app/api/admin/[...path]/route.ts, which is what `mountPath` derives.
 * Held at module scope because ForgeDashboardProvider memoizes on identity.
 */
export const forge = defineForgeDashboard({
  mountPath: "/admin",
  plugins: [corePlugin, streamingPlugin, authsomePlugin, trovePlugin, sentinelPlugin, nexusPlugin],
})
