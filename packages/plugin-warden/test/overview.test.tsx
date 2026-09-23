import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenOverviewPage } from "../src/pages/overview"
import { failingClient, renderPage, stubClient } from "./harness"

const STATS = {
  roles: 3,
  permissions: 3,
  assignments: 2,
  relations: 2,
  policies: 1,
  resourceTypes: 1,
}

const CHECKS = {
  checks: [
    {
      id: "chk_01a",
      namespacePath: "",
      subjectKind: "user",
      subjectId: "alice",
      action: "read",
      resourceType: "document",
      resourceId: "readme",
      decision: "allow",
      evalTimeNs: 412_000,
      cached: false,
      createdAt: "2026-09-23T10:00:00Z",
    },
    {
      id: "chk_01b",
      namespacePath: "eng/platform",
      subjectKind: "service",
      subjectId: "deployer",
      action: "admin",
      resourceType: "cluster",
      resourceId: "prod",
      decision: "error",
      evalTimeNs: 0,
      cached: false,
      error: "store unavailable",
      createdAt: "2026-09-23T10:01:00Z",
    },
  ],
}

function client() {
  return stubClient({
    "overview.stats": STATS,
    "overview.recentChecks": CHECKS,
  })
}

describe("WardenOverviewPage", () => {
  it("shows a tile for each of the six entity counts", async () => {
    renderPage(WardenOverviewPage, client())
    for (const label of [
      "Roles",
      "Permissions",
      "Assignments",
      "Relations",
      "Policies",
      "Resource types",
    ]) {
      expect(await screen.findByText(label)).toBeTruthy()
    }
    // Not findByText("3"): roles and permissions are both 3 in this
    // fixture, and findByText throws when more than one node matches.
    expect(screen.getAllByText("3").length).toBe(2)
  })

  it("carries a live row count on the recent checks caption", async () => {
    renderPage(WardenOverviewPage, client())
    expect(await screen.findByText(/2 checks/)).toBeTruthy()
  })

  it("says which kind of empty an empty check list is", async () => {
    renderPage(
      WardenOverviewPage,
      stubClient({ "overview.stats": STATS, "overview.recentChecks": { checks: [] } })
    )
    // Zero rows still gets a count, per the table conventions.
    expect(await screen.findByText(/0 checks/)).toBeTruthy()
    expect(await screen.findByText(/No checks have been recorded/i)).toBeTruthy()
  })

  it("renders the tenant root namespace as a slash, never as the word root", async () => {
    renderPage(WardenOverviewPage, client())
    const rootCells = await screen.findAllByText("/")
    expect(rootCells.length).toBeGreaterThan(0)
    expect(screen.queryByText("root")).toBeNull()
  })

  /**
   * The no-tenant case, which the templ dashboard rendered as a dedicated
   * page. Reporting six zeroes instead would tell an operator their tenant
   * is empty when the truth is that no tenant is selected, and those call
   * for completely different actions.
   */
  it("distinguishes no tenant selected from an empty tenant", async () => {
    renderPage(
      WardenOverviewPage,
      failingClient(
        new ContractError(
          "PERMISSION_DENIED",
          "no tenant in scope: warden cannot tell which tenant this request is for."
        )
      )
    )
    // Not findByText: both the stats and the recent-checks query fail
    // against this client with the same message, so QueryBoundary renders
    // two separate error cards carrying identical text, and findByText
    // throws when more than one node matches.
    const errors = await screen.findAllByText(/cannot tell which tenant/i)
    expect(errors.length).toBeGreaterThan(0)
    expect(screen.queryByText("Roles")).toBeNull()
  })
})
