import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Node by default: the proxy is a server module. A component test opts into
    // jsdom with a `@vitest-environment` pragma at the top of its own file.
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
})
