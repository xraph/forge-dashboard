import { Suspense } from "react"
import { screen } from "@testing-library/react"
import { expect, it } from "vitest"
import {
  resolvePluginState,
  type Capabilities,
} from "@forge-go/dashboard-plugin"
import nexusPlugin from "../src/index"
import { fixtureClient } from "./fixtures"
import { renderWithClient } from "./harness"

it("resolves installed, absent and unconfigured Nexus contributors", () => {
  const caps: Capabilities = {
    shellEnvelopes: ["v1"],
    contributors: [{ name: "nexus", envelopes: ["v1"], configured: true }],
  }
  expect(resolvePluginState(nexusPlugin, caps)).toEqual({ kind: "ready" })
  expect(
    resolvePluginState(nexusPlugin, { ...caps, contributors: [] })
  ).toEqual({ kind: "hidden" })
  caps.contributors[0].configured = false
  expect(resolvePluginState(nexusPlugin, caps).kind).toBe("setup")
})

it("every nav entry owns a route and the customer links have detail routes", () => {
  const paths = nexusPlugin.routes.map((r) => r.path)
  expect(paths).toContain("/tenants/:id")
  expect(paths).toContain("/keys/:id")
  for (const item of nexusPlugin.nav ?? []) {
    expect(paths).toContain(item.to)
    expect(item.icon).toBeTruthy()
  }
  expect([
    ...new Set(nexusPlugin.nav?.map((item) => item.group).filter(Boolean)),
  ]).toEqual(["Gateway", "Customers", "Spend"])
})

it("loads usage lazily through the plugin route", async () => {
  const route = nexusPlugin.routes.find((r) => r.path === "/usage")!
  expect((route.element as unknown as { $$typeof: symbol }).$$typeof).toBe(
    Symbol.for("react.lazy")
  )
  const Page = route.element
  renderWithClient(
    <Suspense fallback={<p>Loading page</p>}>
      <Page params={{}} />
    </Suspense>,
    fixtureClient().client
  )
  expect(
    await screen.findByRole("heading", { name: "Usage" }, { timeout: 10_000 })
  ).toBeTruthy()
  expect(await screen.findByText("Spend by provider")).toBeTruthy()
})
