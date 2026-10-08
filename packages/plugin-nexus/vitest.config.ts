import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 20_000,
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["../test-support/jsdom-setup.ts"],
  },
})
