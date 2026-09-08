import { createForgeProxy } from "@forge-go/dashboard-next"

export const { GET, POST } = createForgeProxy({
  target: process.env.FORGE_URL ?? "http://localhost:8080/dashboard",
})
