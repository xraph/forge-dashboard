import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// The create dialog's expiry bounds are local-time arithmetic, and its
// regression test only means something in a zone with a clock change. Pinned
// here, before any worker starts, so `pnpm test` and a bare `vitest` agree.
process.env.TZ = "America/Chicago"

export default defineConfig({
  plugins: [react()],
  test: {
    // 5s is one suite's budget. `pnpm test` runs every package's suite at
    // once, and tests that take under a second alone have gone past 5s
    // under that load.
    testTimeout: 20_000,
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["../test-support/jsdom-setup.ts", "./test/setup.ts"],
  },
})
