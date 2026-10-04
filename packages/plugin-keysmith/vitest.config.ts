import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// The create dialog's expiry bounds are local-time arithmetic, and its
// regression test only means something in a zone with a clock change. Pinned
// here, before any worker starts, so `pnpm test` and a bare `vitest` agree.
process.env.TZ = "America/Chicago"

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["../test-support/jsdom-setup.ts", "./test/setup.ts"],
  },
})
