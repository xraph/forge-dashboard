import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { PoliciesPage } from "../src/pages/policies"
import { policyPath } from "../src/format"
import type { PoliciesList, PolicySummary } from "../src/types"
import {
  failingClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function policy(over: Partial<PolicySummary>): PolicySummary {
  return {
    id: "kpol_01",
    name: "Standard",
    maxKeyLifetimeSeconds: null,
    graceSeconds: null,
    allowedScopes: [],
    ...over,
  }
}

const STANDARD = policy({
  id: "kpol_standard",
  name: "Standard",
  maxKeyLifetimeSeconds: 90 * 86400,
  graceSeconds: 86400,
  allowedScopes: ["billing:read", "billing:write"],
})
// Nothing set: every column has to say what an absence means.
const OPEN = policy({ id: "kpol_open", name: "Open" })
const SHORT = policy({
  id: "kpol_short",
  name: "Short grace",
  maxKeyLifetimeSeconds: 25 * 3600,
  graceSeconds: 3600,
  allowedScopes: ["reports:read"],
})

function list(policies: PolicySummary[], hasMore = false): PoliciesList {
  return { policies, hasMore, rateLimiterConfigured: false }
}

function rowFor(name: string): HTMLElement {
  const row = screen
    .getAllByRole("row")
    .find((r) => within(r).queryByText(name))
  if (!row) throw new Error(`no row for ${name}`)
  return row
}

describe("PoliciesPage", () => {
  it("says what the page is for", async () => {
    renderPage(PoliciesPage, stubClient({ "policies.list": list([STANDARD]) }))
    expect(await screen.findByRole("heading", { name: "Policies" })).toBeTruthy()
    expect(
      screen.getByText(
        "Rules attached to keys. Each field says whether Keysmith enforces it.",
      ),
    ).toBeTruthy()
  })

  it("asks policies.list for up to 200", async () => {
    const { client, sent } = recordingQueryClient({
      "policies.list": list([STANDARD]),
    })
    renderPage(PoliciesPage, client)
    await screen.findByText("Standard")
    expect(sent.find((s) => s.intent === "policies.list")?.params).toEqual({
      limit: 200,
    })
  })

  it("links each name to its policy page", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN, SHORT]) }),
    )
    const link = await screen.findByRole("link", { name: "Standard" })
    expect(link.getAttribute("href")).toBe(policyPath("kpol_standard"))
    expect(link.closest("td")?.className).toMatch(/font-medium/)
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe(
      policyPath("kpol_open"),
    )
  })

  it("counts the rows in the caption", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN, SHORT]) }),
    )
    await screen.findByText("Standard")
    expect(screen.getByText("3 policies")).toBeTruthy()
  })

  it("uses the singular for one policy", async () => {
    renderPage(PoliciesPage, stubClient({ "policies.list": list([OPEN]) }))
    await screen.findByText("Open")
    expect(screen.getByText("1 policy")).toBeTruthy()
  })

  it("shows the maximum lifetime, and says so when there is none", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN, SHORT]) }),
    )
    await screen.findByText("Standard")
    expect(within(rowFor("Standard")).getByText("90 days")).toBeTruthy()
    expect(within(rowFor("Short grace")).getByText("25 hours")).toBeTruthy()
    expect(within(rowFor("Open")).getByLabelText("no maximum lifetime")).toBeTruthy()
    expect(within(rowFor("Standard")).queryByLabelText("no maximum lifetime")).toBeNull()
  })

  it("shows the grace, and the 24 hour default in muted text when none is set", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN, SHORT]) }),
    )
    await screen.findByText("Standard")
    expect(within(rowFor("Standard")).getByText("1 day")).toBeTruthy()
    expect(within(rowFor("Short grace")).getByText("1 hour")).toBeTruthy()
    const fallback = within(rowFor("Open")).getByText("24 hours (default)")
    expect(fallback.className).toMatch(/text-muted-foreground/)
    expect(within(rowFor("Standard")).queryByText("24 hours (default)")).toBeNull()
  })

  it("shows allowed scopes as mono tags, and Any scope when the list is empty", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN, SHORT]) }),
    )
    await screen.findByText("Standard")
    const tag = within(rowFor("Standard")).getByText("billing:write")
    expect(tag.className).toMatch(/font-mono/)
    expect(tag.className).toMatch(/text-xs/)
    expect(within(rowFor("Open")).getByText("Any scope")).toBeTruthy()
    expect(within(rowFor("Standard")).queryByText("Any scope")).toBeNull()
  })

  it("says when it is showing only the first 200", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN], true) }),
    )
    await screen.findByText("Standard")
    expect(screen.getByText("Showing the first 200 policies.")).toBeTruthy()
  })

  it("does not say so when the list is complete", async () => {
    renderPage(
      PoliciesPage,
      stubClient({ "policies.list": list([STANDARD, OPEN]) }),
    )
    await screen.findByText("Standard")
    expect(screen.queryByText("Showing the first 200 policies.")).toBeNull()
  })

  it("says so when there are no policies", async () => {
    renderPage(PoliciesPage, stubClient({ "policies.list": list([]) }))
    expect(await screen.findByText("No policies yet.")).toBeTruthy()
    expect(screen.getByText("0 policies")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("shows the error state with the message when the list fails", async () => {
    renderPage(
      PoliciesPage,
      failingClient(new ContractError("INTERNAL", "policy store is down")),
    )
    expect(await screen.findByText(/policy store is down/)).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
