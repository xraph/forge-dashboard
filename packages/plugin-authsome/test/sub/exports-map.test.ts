import { describe, expect, it } from "vitest"
// Vite does not honour an exports fallback array, so the map carries one
// wildcard at one extension and every sub-plugin file is .tsx even when it
// holds no JSX. That is a real constraint rather than a style choice, and this
// suite is what stops somebody adding a .ts sub-plugin that silently cannot be
// imported by the subpath the plan promises.
describe("exports map", () => {
  it("resolves a .ts sub-plugin through the subpath", async () => {
    const mod = await import("@forge-go/dashboard-plugin-authsome/sub/settings-only")
    expect(Array.isArray(mod.settingsOnlySubPlugins)).toBe(true)
  })
  it("resolves a .tsx sub-plugin through the subpath", async () => {
    const mod = await import("@forge-go/dashboard-plugin-authsome/sub/settings-panel")
    expect(typeof mod.settingsPanelFor).toBe("function")
  })
})
