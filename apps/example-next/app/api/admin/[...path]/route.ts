import { createForgeProxy } from "@forge-go/dashboard-next"

// Target comes from FORGE_DASHBOARD_URL.
export const { GET, POST } = createForgeProxy()
