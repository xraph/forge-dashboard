import { describe, expect, it } from "vitest"
import { ForgeMark } from "@forge-go/dashboard-kit/components/brand-marks"
import { corePlugin } from "../src/index"

describe("corePlugin", () => {
  it("keeps the join key the server answers to", () => {
    expect(corePlugin.extension).toBe("core-contract")
  })

  it("claims the dashboard root", () => {
    expect(corePlugin.root).toBe(true)
  })

  it("keeps its switcher label", () => {
    expect(corePlugin.label).toBe("Forge")
    expect(corePlugin.icon).toMatchObject({ type: ForgeMark })
  })
})

const plugin = corePlugin

describe("icons", () => {
  // The sidebar's rows are icon-and-label. A plugin that declares no icons
  // renders as a bare list of words, which is the state the design brief
  // called out: the kit has supported PluginNavItem.icon since W8 and nothing
  // populated it, so the support was invisible.
  it("declares an icon for the scope and for every nav item", () => {
    expect(plugin.icon).toBeDefined()
    for (const item of plugin.nav) {
      expect(item.icon, `nav item "${item.label}" has no icon`).toBeDefined()
      for (const child of item.children ?? []) {
        expect(child.icon, `child "${child.label}" has no icon`).toBeDefined()
      }
    }
  })
})
