import { defineForgeDashboard } from "@forge-go/dashboard-next"
import authsomePlugin from "@forge-go/dashboard-plugin-authsome"
import corePlugin from "@forge-go/dashboard-plugin-core"
import streamingPlugin from "@forge-go/dashboard-plugin-streaming"

/*
 * One value. The page lives at app/admin/[[...slug]]/page.tsx and the contract
 * proxy at app/api/admin/[...path]/route.ts, which is what `mountPath` derives.
 * Held at module scope because ForgeDashboardProvider memoizes on identity.
 */
export const forge = defineForgeDashboard({
  mountPath: "/admin",
  plugins: [corePlugin, streamingPlugin, authsomePlugin],
})
