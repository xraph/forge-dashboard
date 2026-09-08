// packages/host/test/nav-groups.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { navGroups } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Credentials", to: "/credentials", group: "Security" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const ungrouped = definePlugin({
  extension: "streaming-contract",
  nav: [
    { label: "Rooms", to: "/rooms", priority: 20 },
    { label: "Overview", to: "/", priority: 10 },
  ],
  routes: [{ path: "/", element: Noop }],
})

describe("navGroups", () => {
  it("puts a plugin with no groups in one unlabelled group, in priority order", () => {
    const groups = navGroups(ungrouped, [])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBeUndefined()
    expect(groups[0].items.map((i) => i.label)).toEqual(["Overview", "Rooms"])
  })

  it("splits grouped items under their headings, in first-appearance order", () => {
    const groups = navGroups(auth, [])
    expect(groups.map((g) => g.label)).toEqual(["Identity", "Security"])
    expect(groups[0].items.map((i) => i.label)).toEqual(["Users", "Sessions"])
  })

  it("puts ungrouped items first when a plugin mixes both", () => {
    const mixed = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [
        { label: "Overview", to: "/" },
        { label: "Users", to: "/users", group: "Identity" },
      ],
      routes: [{ path: "/", element: Noop }],
    })
    const groups = navGroups(mixed, [])
    expect(groups[0].label).toBeUndefined()
    expect(groups[0].items.map((i) => i.label)).toEqual(["Overview"])
    expect(groups[1].label).toBe("Identity")
  })

  it("merges a sub-plugin's nav into the host's own group and marks it contributed", () => {
    const orgs = defineSubPlugin({
      extension: "organization",
      host: "auth",
      nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 30 }],
      routes: [{ path: "/organizations", element: Noop }],
    })
    const groups = navGroups(auth, [orgs])
    const identity = groups.find((g) => g.label === "Identity")
    expect(identity?.items.map((i) => i.label)).toEqual([
      "Users",
      "Sessions",
      "Organizations",
    ])
    expect(identity?.contributed).toBe(true)
  })

  it("adds a group the host does not have when only a sub-plugin uses it", () => {
    const waitlist = defineSubPlugin({
      extension: "waitlist",
      host: "auth",
      nav: [{ label: "Waitlist", to: "/waitlist", group: "Compliance" }],
      routes: [{ path: "/waitlist", element: Noop }],
    })
    const groups = navGroups(auth, [waitlist])
    expect(groups.map((g) => g.label)).toEqual(["Identity", "Security", "Compliance"])
  })

  it("prefixes every href with the host plugin's namespace, sub-plugin items included", () => {
    const orgs = defineSubPlugin({
      extension: "organization",
      host: "auth",
      nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
      routes: [{ path: "/organizations", element: Noop }],
    })
    const groups = navGroups(auth, [orgs])
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href))
    expect(hrefs).toContain("/@auth/users")
    expect(hrefs).toContain("/@auth/organizations")
  })

  it("puts ungrouped items first even when a grouped item is declared before them", () => {
    // The declaration order is deliberately the opposite of the render order.
    // Every other fixture in this file happens to declare ungrouped items
    // first, so an implementation that just took Map insertion order would
    // pass all of them. This one fails against that and passes against the
    // explicit sort, which is the only reason it exists.
    const groupedFirst = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [
        { label: "Users", to: "/users", group: "Identity" },
        { label: "Overview", to: "/" },
      ],
      routes: [{ path: "/", element: Noop }],
    })

    const groups = navGroups(groupedFirst, [])
    expect(groups[0].label).toBeUndefined()
    expect(groups[0].items.map((i) => i.label)).toEqual(["Overview"])
    expect(groups[1].label).toBe("Identity")
  })
})
