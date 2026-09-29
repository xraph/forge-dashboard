// packages/host/test/nav-sections.test.tsx
import { describe, expect, it } from "vitest"
import { definePlugin, defineSubPlugin } from "@forge-go/dashboard-plugin"
import { MORE_SECTION, activeSectionId, navSections } from "../src/host/PluginHost"

const Noop = () => null

const auth = definePlugin({
  extension: "auth",
  namespace: "auth",
  sections: [
    { group: "Identity", icon: "I" },
    { group: "Billing", icon: "B" },
    { group: "Security", label: "Safety", icon: "S" },
    { group: "Compliance", icon: "C" },
  ],
  nav: [
    { label: "Users", to: "/users", group: "Identity", priority: 10 },
    { label: "Sessions", to: "/sessions", group: "Identity", priority: 20 },
    { label: "Stray", to: "/stray", group: "Nowhere" },
    { label: "Loose", to: "/loose" },
  ],
  routes: [{ path: "/users", element: Noop }],
})

const orgs = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 15 }],
  routes: [{ path: "/organizations", element: Noop }],
})

const billing = defineSubPlugin({
  extension: "subscription",
  host: "auth",
  label: "Plans",
  nav: [
    { label: "Plans", to: "/plans", group: "Billing", priority: 1 },
    { label: "Invoices", to: "/invoices", group: "Billing", priority: 2 },
  ],
  routes: [{ path: "/plans", element: Noop }],
})

const risk = defineSubPlugin({
  extension: "riskengine",
  host: "auth",
  nav: [{ label: "Risk Engine", to: "/security/risk", group: "Security", priority: 0, cluster: { label: "Threat detection" } }],
  routes: [{ path: "/security/risk", element: Noop }],
})

const anomaly = defineSubPlugin({
  extension: "anomaly",
  host: "auth",
  nav: [{ label: "Anomaly Detection", to: "/security/anomaly", group: "Security", priority: 1, cluster: { label: "Threat detection" } }],
  routes: [{ path: "/security/anomaly", element: Noop }],
})

const all = [orgs, billing, risk, anomaly]

describe("navSections", () => {
  it("returns nothing for a plugin that declares no sections", () => {
    const plain = definePlugin({ extension: "vault", nav: [{ label: "Secrets", to: "/secrets" }], routes: [] })
    expect(navSections(plain, [])).toEqual([])
  })

  it("keeps declared order, uses a section's label, drops empty sections, and ends with More", () => {
    const sections = navSections(auth, all)
    expect(sections.map((s) => s.id)).toEqual(["Identity", "Billing", "Security", MORE_SECTION])
    expect(sections.map((s) => s.label)).toEqual(["Identity", "Billing", "Safety", "More"])
  })

  it("folds a single-item sub-plugin into the host's list, in priority order", () => {
    const identity = navSections(auth, all).find((s) => s.id === "Identity")!
    expect(identity.groups).toHaveLength(1)
    expect(identity.groups[0].label).toBeUndefined()
    expect(identity.groups[0].items.map((i) => i.label)).toEqual(["Users", "Organizations", "Sessions"])
    expect(identity.href).toBe("/@auth/users")
  })

  it("gives a multi-item sub-plugin its own headed group, labelled with the sub-plugin", () => {
    const section = navSections(auth, all).find((s) => s.id === "Billing")!
    expect(section.groups.map((g) => g.label)).toEqual(["Plans"])
    expect(section.groups[0].items.map((i) => i.label)).toEqual(["Plans", "Invoices"])
    expect(section.groups[0].contributed).toBe(true)
    expect(section.href).toBe("/@auth/plans")
  })

  it("falls back to the sub-plugin's extension when it has no label", () => {
    const unlabelled = defineSubPlugin({
      extension: "ledger",
      host: "auth",
      nav: [
        { label: "Accounts", to: "/accounts", group: "Billing" },
        { label: "Entries", to: "/entries", group: "Billing" },
      ],
      routes: [],
    })
    const section = navSections(auth, [unlabelled]).find((s) => s.id === "Billing")!
    expect(section.groups[0].label).toBe("ledger")
  })

  it("still folds clusters inside a section, and links the section to the cluster's first real page", () => {
    const security = navSections(auth, all).find((s) => s.id === "Security")!
    const cluster = security.groups[0].items[0]
    expect(cluster.label).toBe("Threat detection")
    expect(cluster.children?.map((c) => c.label)).toEqual(["Risk Engine", "Anomaly Detection"])
    expect(security.href).toBe("/@auth/security/risk")
  })

  it("collects items with an unknown group or no group into More", () => {
    const more = navSections(auth, all).find((s) => s.id === MORE_SECTION)!
    expect(more.groups[0].items.map((i) => i.label).sort()).toEqual(["Loose", "Stray"])
  })

  it("mounts hrefs under the app segment when one is given", () => {
    const identity = navSections(auth, all, "platform").find((s) => s.id === "Identity")!
    expect(identity.href).toBe(identity.groups[0].items[0].href)
  })
})

describe("activeSectionId", () => {
  const sections = navSections(auth, all)

  it("picks the section holding the current page", () => {
    expect(activeSectionId(sections, "/@auth/invoices")).toBe("Billing")
  })

  it("picks by longest prefix for a page no nav item names", () => {
    expect(activeSectionId(sections, "/@auth/users/usr_1")).toBe("Identity")
  })

  it("finds pages inside a folded cluster", () => {
    expect(activeSectionId(sections, "/@auth/security/anomaly")).toBe("Security")
  })

  it("falls back to the first section when nothing matches", () => {
    expect(activeSectionId(sections, "/@auth")).toBe("Identity")
  })

  it("returns undefined for no sections", () => {
    expect(activeSectionId([], "/@auth/users")).toBeUndefined()
  })
})
