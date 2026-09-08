import type { NextConfig } from "next"

// The workspace packages ship TypeScript source rather than built output, so
// Next has to compile them itself.
const config: NextConfig = {
  transpilePackages: [
    "@forge-go/dashboard-host",
    "@forge-go/dashboard-kit",
    "@forge-go/dashboard-plugin",
    "@forge-go/dashboard-plugin-authsome",
    "@forge-go/dashboard-plugin-core",
    "@forge-go/dashboard-plugin-streaming",
    "@forge-go/dashboard-runtime",
  ],
}

export default config
