import { mergeConfig } from "vite"
import shared from "./vite.config.ts"

// Keep Ctrlplane review usable while other plugin migrations are in progress.
// The shared shell entry, host, styles and backend proxy remain in use.
export default mergeConfig(shared, {
  plugins: [
    {
      name: "ctrlplane-review",
      enforce: "pre",
      transform(_source: string, id: string) {
        if (!id.endsWith("/src/App.tsx")) return
        return {
          code: `
            import { ForgeDashboard } from "@forge-go/dashboard-host"
            import { configFromWindow } from "@forge-go/dashboard-runtime"
            import ctrlplanePlugin from "@forge-go/dashboard-plugin-ctrlplane"
            const injected = configFromWindow()
            const config = { basePath: injected.basePath ?? "/dashboard", ...injected }
            export function App() {
              return <ForgeDashboard config={config} plugins={[ctrlplanePlugin]} />
            }
          `,
          map: null,
        }
      },
    },
  ],
})
