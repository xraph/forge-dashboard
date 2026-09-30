// packages/host/test/nav-areas.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { activeAreaId, navAreas } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "authsome",
  namespace: "authsome",
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
  host: "authsome",
  label: "Subscription",
  icon: "B",
  nav: [
    { label: "Invoices", to: "/invoices", group: "Revenue", priority: 2 },
    { label: "Plans", to: "/plans", group: "Catalog", priority: 1 },
  ],
  routes: [{ path: "/plans", element: Noop }],
})

const apikey = defineSubPlugin({
  extension: "apikey",
  host: "authsome",
  label: "API key",
  nav: [{ label: "API Keys", to: "/apikeys", icon: "K" }],
  routes: [{ path: "/apikeys", element: Noop }],
})

const risk = defineSubPlugin({
  extension: "riskengine",
  host: "authsome",
  label: "Risk engine",
  nav: [
    { label: "Risk Engine", to: "/security/risk", priority: 0, cluster: { label: "Threat detection" } },
    { label: "Risk Rules", to: "/security/rules", priority: 1, cluster: { label: "Threat detection" } },
  ],
  routes: [],
})

const silent = defineSubPlugin({ extension: "waitlist", host: "authsome", nav: [], routes: [] })

describe("navAreas", () => {
  it("puts the scope first with its own grouped nav, and no sub-plugin pages in it", () => {
    const [scope] = navAreas(auth, [billing, apikey])
    expect(scope).toMatchObject({ id: "authsome", label: "Authsome", kind: "scope", href: "/@authsome/users" })
    expect(scope.icon).toBe("A")
    expect(scope.groups.map((g) => g.label)).toEqual(["Identity", "System"])
    expect(scope.groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(["Users", "Sessions", "Overview"])
  })

  it("adds one plugin area per sub-plugin with nav, sorted by label, and skips those with none", () => {
    const areas = navAreas(auth, [risk, billing, silent, apikey])
    expect(areas.map((a) => a.label)).toEqual(["Authsome", "API key", "Risk engine", "Subscription"])
    expect(areas.slice(1).every((a) => a.kind === "plugin")).toBe(true)
  })

  // The rail entry names the extension, never a page: an unlabelled
  // sub-plugin is called after its extension, not after its first nav item.
  // The icon still falls back to the first nav item's.
  it("labels an unlabelled sub-plugin after its extension, taking the first nav item's icon", () => {
    const bare = defineSubPlugin({
      extension: "geo-ip",
      host: "authsome",
      nav: [{ label: "Lookups", to: "/geo", icon: "G" }],
      routes: [],
    })
    expect(navAreas(auth, [bare])[1]).toMatchObject({ id: "geo-ip", label: "Geo ip", icon: "G" })
  })

  it("splits a plugin's pages into sections by group, in first-appearance order after a priority sort", () => {
    const area = navAreas(auth, [billing]).find((a) => a.id === "subscription")!
    expect(area.groups.map((g) => g.label)).toEqual(["Catalog", "Revenue"])
    expect(area.href).toBe("/@authsome/plans")
  })

  it("does not fold clusters inside a plugin's own area", () => {
    const area = navAreas(auth, [risk]).find((a) => a.id === "riskengine")!
    const items = area.groups[0].items
    expect(items.map((node) => node.label)).toEqual(["Risk Engine", "Risk Rules"])
    expect(items.every((node) => node.children === undefined)).toBe(true)
    expect(area.href).toBe("/@authsome/security/risk")
  })

  it("does not fold a cluster in the scope's own nav", () => {
    const clustered = definePlugin({
      extension: "authsome",
      namespace: "authsome",
      nav: [
        { label: "Risk Engine", to: "/security/risk", cluster: { label: "Threat detection" } },
        { label: "Risk Rules", to: "/security/rules", cluster: { label: "Threat detection" } },
      ],
      routes: [],
    })
    const area = navAreas(clustered, []).find((a) => a.id === "authsome")!
    expect(area.groups[0].items.map((n) => n.label)).toEqual(["Risk Engine", "Risk Rules"])
    expect(area.groups[0].items.every((n) => !n.children)).toBe(true)
  })

  it("returns only plugin areas when the scope itself has no nav", () => {
    const empty = definePlugin({ extension: "authsome", namespace: "authsome", routes: [] })
    expect(navAreas(empty, [apikey]).map((a) => a.id)).toEqual(["apikey"])
  })
})

describe("activeAreaId", () => {
  const areas = navAreas(auth, [billing, apikey])

  it("picks the area holding the current page", () => {
    expect(activeAreaId(areas, "/@authsome/invoices")).toBe("subscription")
    expect(activeAreaId(areas, "/@authsome/apikeys")).toBe("apikey")
  })

  it("picks by longest prefix, so a scope Overview at the root does not swallow plugin pages", () => {
    expect(activeAreaId(areas, "/@authsome/plans/plan_1")).toBe("subscription")
    expect(activeAreaId(areas, "/@authsome/users/usr_1")).toBe("authsome")
  })

  it("falls back to the first area, and to undefined for none", () => {
    expect(activeAreaId(areas, "/@warden")).toBe("authsome")
    expect(activeAreaId([], "/@authsome")).toBeUndefined()
  })

  it("does not light a plugin for an unlisted route when the scope has no nav of its own", () => {
    const empty = definePlugin({ extension: "authsome", namespace: "authsome", routes: [] })
    const pluginOnly = navAreas(empty, [apikey])
    expect(activeAreaId(pluginOnly, "/@authsome/unknown")).toBeUndefined()
    expect(activeAreaId(pluginOnly, "/@authsome/apikeys")).toBe("apikey")
  })
})
