import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
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
    {
      id: "chk_01c",
      namespacePath: "",
      subjectKind: "user",
      subjectId: "dave",
      action: "delete",
      resourceType: "document",
      resourceId: "readme",
      decision: "deny_explicit",
      reason: 'denied by policy "contractor-lockout"',
      evalTimeNs: 902_000,
      cached: false,
      createdAt: "2026-09-23T10:02:00Z",
    },
    {
      id: "chk_01d",
      namespacePath: "",
      subjectKind: "user",
      subjectId: "alice",
      action: "read",
      resourceType: "document",
      resourceId: "readme",
      decision: "allow",
      evalTimeNs: 1_800,
      cached: true,
      createdAt: "2026-09-23T10:03:00Z",
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
    expect(await screen.findByText(/4 checks/)).toBeTruthy()
  })

  it("shows what went wrong on an errored check, not just that one did", async () => {
    renderPage(WardenOverviewPage, client())
    // The badge alone ("error") only says something failed; the sentence
    // is what makes the failure visible to a person, per the spec's bar.
    expect(await screen.findByText("store unavailable")).toBeTruthy()
  })

  it("shows the deny reason on an explicit-deny check", async () => {
    renderPage(WardenOverviewPage, client())
    expect(
      await screen.findByText('denied by policy "contractor-lockout"')
    ).toBeTruthy()
  })

  it("says none rather than leaving the detail cell blank on a plain allow", async () => {
    renderPage(WardenOverviewPage, client())
    const noneCells = await screen.findAllByLabelText("no detail")
    expect(noneCells.length).toBeGreaterThan(0)
  })

  it("badges both cached and not-cached rows, never a blank cell", async () => {
    renderPage(WardenOverviewPage, client())
    expect(await screen.findByText("cached")).toBeTruthy()
    // Uncached is the majority state, so more than one row carries it here.
    expect(screen.getAllByText("not cached").length).toBeGreaterThan(0)
  })

  it("links the recent checks panel to the check log", async () => {
    renderPage(WardenOverviewPage, client())
    const link = await screen.findByRole("link", { name: "View the check log" })
    expect(link.getAttribute("href")).toBe("/check-log")
  })

  it("links the panel even when the recent checks cannot be read", async () => {
    renderPage(WardenOverviewPage, stubClient({ "overview.stats": STATS }))
    expect(await screen.findByRole("link", { name: "View the check log" })).toBeTruthy()
  })

  it("links each recent check's timestamp to that check's own page", async () => {
    const { container } = renderPage(WardenOverviewPage, client())
    await screen.findByText("store unavailable")
    const link = container.querySelector('a[href="/check-log/chk_01b"]')!
    expect(link).toBeTruthy()
    expect(link.textContent).toBe(formatTimestamp("2026-09-23T10:01:00Z"))
    expect(container.querySelectorAll('a[href^="/check-log/"]')).toHaveLength(4)
  })

  it("says which kind of empty an empty check list is", async () => {
    renderPage(
      WardenOverviewPage,
      stubClient({ "overview.stats": STATS, "overview.recentChecks": { checks: [] } })
    )
    // Zero rows still gets a count, per the table conventions.
    expect(await screen.findByText(/0 checks/)).toBeTruthy()
    expect(await screen.findByText("No checks are in the log.")).toBeTruthy()
    expect(screen.queryByText(/recorded yet/)).toBeNull()
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
