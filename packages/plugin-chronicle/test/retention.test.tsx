import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  RetentionPage,
  categoryLabel,
  policyScopeLabel,
} from "../src/pages/retention"
import { renderPage, scriptedClient } from "./harness"
import type { PolicySummary } from "../src/types"

const pol = (over: Partial<PolicySummary>): PolicySummary => ({
  id: "retpol_x",
  category: "debug",
  duration: "720h0m0s",
  archive: false,
  appId: "app_chronicle",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  editable: true,
  ...over,
})

describe("RetentionPage", () => {
  it("names the wildcard for what it is", () => {
    expect(categoryLabel("*")).toBe("Every category (*)")
    expect(categoryLabel("debug")).toBe("debug")
  })

  it("labels a policy's scope by whose events it removes", () => {
    expect(policyScopeLabel(pol({}))).toBe("App level, every tenant")
    expect(policyScopeLabel(pol({ tenantId: "acme" }))).toBe("Tenant acme")
  })

  it("says an app-level policy purges every tenant, and a tenant policy only its own", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({
        "retention.policies": {
          policies: [
            pol({ id: "retpol_app_all", category: "*", duration: "8760h0m0s" }),
            pol({ id: "retpol_acme_debug", tenantId: "acme" }),
          ],
          total: 2,
        },
      }).client
    )
    await waitFor(() =>
      expect(screen.getByText("App level, every tenant")).toBeTruthy()
    )
    expect(screen.getByText("Tenant acme")).toBeTruthy()
    expect(screen.getByText("365 days")).toBeTruthy()
    expect(
      screen.getByText(
        /a short wildcard overrides a longer specific policy for its category/
      )
    ).toBeTruthy()
    expect(screen.getByText(/2 policies/)).toBeTruthy()
  })

  it("offers no actions on a governing policy and says who manages it", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({
        "retention.policies": {
          policies: [
            pol({ id: "retpol_app_all", category: "*", editable: false }),
          ],
          total: 1,
        },
      }).client
    )
    const row = (await screen.findByText("Every category (*)")).closest("tr")!
    expect(
      within(row).getByText("Managed by an app-wide operator")
    ).toBeTruthy()
    expect(within(row).queryByRole("button")).toBeNull()
    expect(within(row).queryByRole("link", { name: /edit/i })).toBeNull()
    expect(within(row).queryByRole("link")).toBeNull()
  })

  it("links only an editable policy to its page, and says nothing more in its last column", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({
        "retention.policies": {
          policies: [
            pol({ id: "retpol_acme_debug", tenantId: "acme", archive: true }),
            pol({ id: "retpol_app_all", category: "*", editable: false }),
          ],
          total: 2,
        },
      }).client
    )
    const link = await screen.findByRole("link", { name: "debug" })
    expect(link.getAttribute("href")).toBe("/retention/retpol_acme_debug")
    const row = link.closest("tr")!
    expect(within(row).getByText("Archived first")).toBeTruthy()
    expect(
      within(row).queryByText("Managed by an app-wide operator")
    ).toBeNull()
    expect(screen.getAllByText("Managed by an app-wide operator")).toHaveLength(
      1
    )
    expect(screen.getByText("Not archived")).toBeTruthy()
  })

  it("captions with the count at zero and says no policy removes anything", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({ "retention.policies": { policies: [], total: 0 } })
        .client
    )
    await waitFor(() =>
      expect(
        screen.getByText(
          "No retention policies: nothing is removed from this audit trail automatically."
        )
      ).toBeTruthy()
    )
    expect(screen.getByText("0 policies")).toBeTruthy()
  })

  it("links to the create page and opens the enforce dialog only on request", async () => {
    const c = scriptedClient({
      "retention.policies": { policies: [], total: 0 },
      "retention.preview": {
        eventCount: 0,
        capped: false,
        noPolicies: true,
        governingAppPolicies: 0,
        byPolicy: [],
      },
    })
    renderPage(RetentionPage, c.client)
    await screen.findByText("0 policies")
    expect(
      screen.getByRole("link", { name: "New policy" }).getAttribute("href")
    ).toBe("/new-policy")
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(c.queried.map((q) => q.intent)).toEqual(["retention.policies"])
    fireEvent.click(screen.getByRole("button", { name: "Run retention now" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    await waitFor(() =>
      expect(c.queried.map((q) => q.intent)).toContain("retention.preview")
    )
  })

  it("counts one policy in the singular", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({
        "retention.policies": { policies: [pol({})], total: 1 },
      }).client
    )
    expect(await screen.findByText("1 policy")).toBeTruthy()
  })
})
