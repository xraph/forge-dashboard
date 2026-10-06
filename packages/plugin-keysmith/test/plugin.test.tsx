import { Suspense } from "react"
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { PluginProvider, resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import keysmithPlugin, {
  keysmithPlugin as named,
  PoliciesPage,
  PolicyDetailPage,
  RotationsPage,
  ScopesPage,
} from "../src/index"
import { UsagePage } from "../src/pages/usage"
import { stubClient } from "./harness"

function capabilities(
  ...contributors: { name: string; configured?: boolean }[]
): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: contributors.map((c) => ({
      name: c.name,
      envelopes: ["v1"],
      configured: c.configured ?? true,
    })),
  }
}

describe("keysmithPlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(keysmithPlugin).toBe(named)
  })

  /**
   * The join key, checked by what the host does with it rather than by
   * comparing the literal to itself. A wrong name resolves to `hidden`
   * silently, which is why this test exists.
   */
  it("resolves to ready against a host reporting keysmith's contributor", () => {
    expect(
      resolvePluginState(keysmithPlugin, capabilities({ name: "keysmith" })),
    ).toEqual({ kind: "ready" })
  })

  it("is hidden when the host reports only vault", () => {
    expect(
      resolvePluginState(keysmithPlugin, capabilities({ name: "vault" })).kind,
    ).toBe("hidden")
  })

  it("puts Keys in the nav at /keys, in the API keys group", () => {
    const keys = keysmithPlugin.nav?.find((n) => n.label === "Keys")
    expect(keys?.to).toBe("/keys")
    expect(keys?.group).toBe("API keys")
  })

  it("routes the list and the detail page", () => {
    const paths = keysmithPlugin.routes.map((r) => r.path)
    expect(paths).toContain("/keys")
    expect(paths).toContain("/keys/:id")
  })

  it("puts Policies after Keys at /policies, in the same group", () => {
    const nav = keysmithPlugin.nav ?? []
    const keys = nav.find((n) => n.label === "Keys")
    const policies = nav.find((n) => n.label === "Policies")
    expect(keys?.priority).toBe(0)
    expect(policies?.to).toBe("/policies")
    expect(policies?.group).toBe("API keys")
    expect(policies?.priority).toBe(1)
    expect(policies?.icon).toBeTruthy()
    expect(keysmithPlugin.routes.map((r) => r.path)).toContain("/policies")
  })

  it("mounts the Policies page at the route its nav entry points at", () => {
    const route = keysmithPlugin.routes.find((r) => r.path === "/policies")
    expect(route?.element).toBe(PoliciesPage)
  })

  it("mounts the policy page at /policies/:id, with no nav entry", () => {
    const route = keysmithPlugin.routes.find((r) => r.path === "/policies/:id")
    expect(PolicyDetailPage).toBeTypeOf("function")
    expect(route?.element).toBe(PolicyDetailPage)
    expect((keysmithPlugin.nav ?? []).map((n) => n.to)).not.toContain(
      "/policies/:id",
    )
  })

  it("puts Scopes after Policies at /scopes, in the same group", () => {
    const nav = keysmithPlugin.nav ?? []
    const scopes = nav.find((n) => n.label === "Scopes")
    expect(scopes?.to).toBe("/scopes")
    expect(scopes?.group).toBe("API keys")
    expect(scopes?.priority).toBe(2)
    expect(scopes?.icon).toBeTruthy()
  })

  it("mounts the Scopes page at the route its nav entry points at", () => {
    const route = keysmithPlugin.routes.find((r) => r.path === "/scopes")
    expect(ScopesPage).toBeTypeOf("function")
    expect(route?.element).toBe(ScopesPage)
  })

  it("puts Rotations after Scopes at /rotations, in the same group", () => {
    const nav = keysmithPlugin.nav ?? []
    const rotations = nav.find((n) => n.label === "Rotations")
    expect(rotations?.to).toBe("/rotations")
    expect(rotations?.group).toBe("API keys")
    expect(rotations?.priority).toBe(3)
    expect(rotations?.icon).toBeTruthy()
  })

  it("mounts the Rotations page at the route its nav entry points at", () => {
    const route = keysmithPlugin.routes.find((r) => r.path === "/rotations")
    expect(RotationsPage).toBeTypeOf("function")
    expect(route?.element).toBe(RotationsPage)
  })

  it("puts Usage after Rotations at /usage, in the same group", () => {
    const nav = keysmithPlugin.nav ?? []
    const usage = nav.find((n) => n.label === "Usage")
    expect(usage?.to).toBe("/usage")
    expect(usage?.group).toBe("API keys")
    expect(usage?.priority).toBe(4)
    expect(usage?.icon).toBeTruthy()
  })

  it("loads the Usage page lazily, so Recharts stays out of the entry chunk", () => {
    const route = keysmithPlugin.routes.find((r) => r.path === "/usage")
    const element = route?.element as unknown as { $$typeof?: symbol }
    expect(element?.$$typeof).toBe(Symbol.for("react.lazy"))
    // Every other route is eager.
    const lazyPaths = keysmithPlugin.routes
      .filter(
        (r) =>
          (r.element as unknown as { $$typeof?: symbol }).$$typeof ===
          Symbol.for("react.lazy"),
      )
      .map((r) => r.path)
    expect(lazyPaths).toEqual(["/usage"])
  })

  it("mounts the Usage page at the route its nav entry points at", async () => {
    expect(UsagePage).toBeTypeOf("function")
    const route = keysmithPlugin.routes.find((r) => r.path === "/usage")
    if (!route) throw new Error("no /usage route")
    const Page = route.element
    render(
      <PluginProvider
        client={stubClient({
          "keys.list": { keys: [], total: 0 },
          "usage.series": { period: "hourly", buckets: [], recorded: false },
          "usage.records": { items: [], total: 0 },
        })}
      >
        <Suspense fallback={null}>
          <Page params={{}} />
        </Suspense>
      </PluginProvider>,
    )
    expect(await screen.findByRole("heading", { name: "Usage" })).toBeTruthy()
    expect(await screen.findByText("No usage recorded yet.")).toBeTruthy()
  })

  it("gives every nav entry an icon", () => {
    for (const item of keysmithPlugin.nav ?? []) {
      expect(item.icon, `nav "${item.label}" has no icon`).toBeTruthy()
    }
  })

  it("names a route for every nav entry", () => {
    const paths = new Set(keysmithPlugin.routes.map((r) => r.path))
    for (const item of keysmithPlugin.nav ?? []) {
      expect(paths, `nav "${item.label}" points at ${item.to}`).toContain(item.to)
    }
  })
})
