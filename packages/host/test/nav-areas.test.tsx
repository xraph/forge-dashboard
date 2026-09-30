// packages/host/test/nav-areas.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { activeAreaId, navAreas } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Authsome",
  icon: "A",
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Overview", to: "/", group: "System" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const billing = defineSubPlugin({
  extension: "subscription",
  host: "auth",
  label: "Billing",
  icon: "B",
  nav: [
    { label: "Invoices", to: "/invoices", group: "Revenue", priority: 2 },
    { label: "Plans", to: "/plans", group: "Catalog", priority: 1 },
  ],
  routes: [{ path: "/plans", element: Noop }],
})

const apikey = defineSubPlugin({
  extension: "apikey",
  host: "auth",
  nav: [{ label: "API Keys", to: "/apikeys", icon: "K" }],
  routes: [{ path: "/apikeys", element: Noop }],
})

const risk = defineSubPlugin({
  extension: "riskengine",
  host: "auth",
  nav: [
    { label: "Risk Engine", to: "/security/risk", priority: 0, cluster: { label: "Threat detection" } },
    { label: "Risk Rules", to: "/security/rules", priority: 1, cluster: { label: "Threat detection" } },
  ],
  routes: [],
})

const silent = defineSubPlugin({ extension: "waitlist", host: "auth", nav: [], routes: [] })

describe("navAreas", () => {
  it("puts the scope first with its own grouped nav, and no sub-plugin pages in it", () => {
    const [scope] = navAreas(auth, [billing, apikey])
    expect(scope).toMatchObject({ id: "auth", label: "Authsome", kind: "scope", href: "/@auth/users" })
    expect(scope.icon).toBe("A")
    expect(scope.groups.map((g) => g.label)).toEqual(["Identity", "System"])
    expect(scope.groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(["Users", "Sessions", "Overview"])
  })

  it("adds one plugin area per sub-plugin with nav, sorted by label, and skips those with none", () => {
    const areas = navAreas(auth, [risk, billing, silent, apikey])
    expect(areas.map((a) => a.label)).toEqual(["Authsome", "API Keys", "Billing", "Risk Engine"])
    expect(areas.slice(1).every((a) => a.kind === "plugin")).toBe(true)
  })

  it("falls back to the first nav item's label and icon, then the extension", () => {
    const areas = navAreas(auth, [apikey])
    expect(areas[1]).toMatchObject({ id: "apikey", label: "API Keys", icon: "K" })
    const bare = defineSubPlugin({ extension: "geoip", host: "auth", nav: [{ label: "", to: "/geo" }], routes: [] })
    expect(navAreas(auth, [bare])[1].label).toBe("geoip")
  })

  it("splits a plugin's pages into sections by group, in first-appearance order after a priority sort", () => {
    const area = navAreas(auth, [billing]).find((a) => a.id === "subscription")!
    expect(area.groups.map((g) => g.label)).toEqual(["Catalog", "Revenue"])
    expect(area.href).toBe("/@auth/plans")
  })

  it("does not fold clusters inside a plugin's own area", () => {
    const area = navAreas(auth, [risk]).find((a) => a.id === "riskengine")!
    const items = area.groups[0].items
    expect(items.map((node) => node.label)).toEqual(["Risk Engine", "Risk Rules"])
    expect(items.every((node) => node.children === undefined)).toBe(true)
    expect(area.href).toBe("/@auth/security/risk")
  })

  it("does not fold a cluster in the scope's own nav", () => {
    const clustered = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [
        { label: "Risk Engine", to: "/security/risk", cluster: { label: "Threat detection" } },
        { label: "Risk Rules", to: "/security/rules", cluster: { label: "Threat detection" } },
      ],
      routes: [],
    })
    const area = navAreas(clustered, []).find((a) => a.id === "auth")!
    expect(area.groups[0].items.map((n) => n.label)).toEqual(["Risk Engine", "Risk Rules"])
    expect(area.groups[0].items.every((n) => !n.children)).toBe(true)
  })

  it("returns only plugin areas when the scope itself has no nav", () => {
    const empty = definePlugin({ extension: "auth", namespace: "auth", routes: [] })
    expect(navAreas(empty, [apikey]).map((a) => a.id)).toEqual(["apikey"])
  })
})

describe("activeAreaId", () => {
  const areas = navAreas(auth, [billing, apikey])

  it("picks the area holding the current page", () => {
    expect(activeAreaId(areas, "/@auth/invoices")).toBe("subscription")
    expect(activeAreaId(areas, "/@auth/apikeys")).toBe("apikey")
  })

  it("picks by longest prefix, so a scope Overview at the root does not swallow plugin pages", () => {
    expect(activeAreaId(areas, "/@auth/plans/plan_1")).toBe("subscription")
    expect(activeAreaId(areas, "/@auth/users/usr_1")).toBe("auth")
  })

  it("falls back to the first area, and to undefined for none", () => {
    expect(activeAreaId(areas, "/@warden")).toBe("auth")
    expect(activeAreaId([], "/@auth")).toBeUndefined()
  })

  it("does not light a plugin for an unlisted route when the scope has no nav of its own", () => {
    const empty = definePlugin({ extension: "auth", namespace: "auth", routes: [] })
    const pluginOnly = navAreas(empty, [apikey])
    expect(activeAreaId(pluginOnly, "/@auth/unknown")).toBeUndefined()
    expect(activeAreaId(pluginOnly, "/@auth/apikeys")).toBe("apikey")
  })
})
