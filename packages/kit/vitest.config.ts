import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

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
    setupFiles: ["../test-support/jsdom-setup.ts"],
  },
})
