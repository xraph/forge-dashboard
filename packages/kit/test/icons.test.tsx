// packages/kit/test/icons.test.tsx
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { createElement } from "react"
import type { ComponentType } from "react"

/**
 * The plugin packages carry zero dependencies of their own and peer-depend on
 * this kit. Icons therefore have to arrive through the dependency they
 * already have, or every plugin author (first-party and third-party alike)
 * has to add lucide-react themselves and pin a version that agrees with this
 * one. This subpath is that route, so its resolvability is the contract.
 *
 * These render rather than inspecting `typeof`: a lucide icon is a
 * `forwardRef` object, not a function, so a typeof assertion here passes for
 * any non-null export and fails for every real icon. Rendering is also the
 * thing plugins actually do with them.
 */
describe("@forge-go/dashboard-kit/icons", () => {
  it("re-exports lucide icons for plugins to use", async () => {
    const { ShieldIcon } = await import("@forge-go/dashboard-kit/icons")
    const { container } = render(createElement(ShieldIcon))
    expect(container.querySelector("svg")).toBeTruthy()
  })

  it("exposes every icon the first-party plugins name", async () => {
    const icons = await import("@forge-go/dashboard-kit/icons")
    for (const name of [
      "GaugeIcon",
      "AudioWaveformIcon",
      "LayoutGridIcon",
      "DoorOpenIcon",
      "UsersIcon",
      "ClockIcon",
      "LinkIcon",
      "HouseIcon",
    ]) {
      const Icon = icons[name as keyof typeof icons] as ComponentType
      const { container } = render(createElement(Icon))
      expect(container.querySelector("svg"), `${name} did not render`).toBeTruthy()
    }
  })
})
