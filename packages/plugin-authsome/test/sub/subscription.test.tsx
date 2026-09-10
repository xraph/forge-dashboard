import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { subscriptionSubPlugin, SubscriptionOrgTab } from "../../src/sub/subscription"
import { renderSubPage, subStubClient } from "./harness"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"

const plans = {
  plans: [
    { id: "p1", name: "Pro", slug: "pro", status: "active", currency: "usd", trialDays: 14 },
    { id: "p2", name: "Legacy", slug: "legacy", status: "archived" },
    { id: "p3", name: "Draft", slug: "draft", status: "draft" },
  ],
}
function pageAt(path: string) {
  return subscriptionSubPlugin.routes.find((r) => r.path === path)!.element
}

describe("plans", () => {
  it("colours the three statuses apart", async () => {
    renderSubPage(pageAt("/plans"), {
      client: subStubClient({ "plans.list": plans }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByText("active").getAttribute("data-variant")).toBe("default")
    // The "Draft" plan's slug is also "draft", so its slug cell and its
    // status badge are two separate elements with the identical text - the
    // badge is the one carrying `data-variant`.
    const draftBadge = screen.getAllByText("draft").find((el) => el.hasAttribute("data-variant"))
    expect(draftBadge?.getAttribute("data-variant")).toBe("secondary")
    expect(screen.getByText("archived").getAttribute("data-variant")).toBe("outline")
  })

  it("offers archive on active plans and activate on draft ones, and neither on archived", async () => {
    renderSubPage(pageAt("/plans"), {
      client: subStubClient({ "plans.list": plans }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByRole("button", { name: /archive pro/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /activate draft/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /archive legacy/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /activate legacy/i })).toBeNull()
  })

  it("offers no create, and no editing of any kind", async () => {
    renderSubPage(pageAt("/plans"), {
      client: subStubClient({ "plans.list": plans }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    // There is no plans.create intent, no pricing intent and no feature
    // intent. A form with nothing to submit to is worse than no form.
    expect(screen.queryByRole("button", { name: /create plan/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /add feature/i })).toBeNull()
  })

  it("says where the rest of billing lives", async () => {
    renderSubPage(pageAt("/plans"), {
      client: subStubClient({ "plans.list": plans }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    // An operator who finds Plans here and concludes billing has moved will
    // go looking for invoices and find nothing.
    expect(screen.getByText(/invoices, coupons and subscription changes/i)).toBeTruthy()
  })

  it("shows a plan's features read-only", async () => {
    const detail = {
      id: "p1", name: "Pro", slug: "pro", status: "active", currency: "usd",
      features: [{ key: "seats", name: "Seats", type: "seat", limit: 10, period: "monthly" }],
    }
    renderSubPage(pageAt("/plans/:id"), {
      client: subStubClient({ "plans.detail": detail }).client,
      hostClient: subStubClient({}).client, allowed: [], params: { id: "p1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy())
    expect(screen.getByText("seats")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
  })
})

describe("SubscriptionOrgTab", () => {
  // The plan's draft rendered SubscriptionOrgTab through a lambda annotated
  // `(props: { orgId?: string }) => <SubscriptionOrgTab {...props} />`, on
  // the assumption that renderSubPage spreads a slot contribution's params
  // straight onto the component the way `PluginSlot` itself does. It does
  // not: renderSubPage's `Page` is `ComponentType<PluginPageProps>` and it
  // always renders `<Page params={opts.params ?? {}} />`, exactly like every
  // routed page in this file. That lambda would receive `{ params: { orgId:
  // "o1" } }` and spread a `params` prop onto SubscriptionOrgTab, leaving its
  // own `orgId` prop undefined regardless of what the test asked for - a
  // fourth bug, undocumented in the plan. The fix is the same shape
  // OrgDetailPage already uses: read `params.orgId` and hand it to the
  // component as its own prop.
  function OrgTabAt({ params }: PluginPageProps) {
    return <SubscriptionOrgTab orgId={params.orgId} />
  }

  it("sends the org id it was handed as the tenant", async () => {
    // subscriptions.list is a QUERY, not a command, so `own.payloads` (which
    // only records COMMAND payloads - see harness.tsx) never holds its
    // params. Capturing them means a functional answer, the way
    // settings-panel.test.tsx and organization.test.tsx's "asks orgs.members
    // for the org id it was routed with" do it.
    let subscriptionsParams: unknown
    const own = subStubClient({
      "subscriptions.list": (params: unknown) => {
        subscriptionsParams = params
        return { subscriptions: [{ id: "s1", tenantId: "o1", planId: "p1", status: "active", currentPeriodEnd: "2026-04-01T00:00:00Z" }] }
      },
      "plans.list": plans,
    })
    renderSubPage(OrgTabAt, {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { orgId: "o1" },
    })
    await waitFor(() => expect(screen.getByText("active")).toBeTruthy())
    // subscriptions.list answers an EMPTY LIST for an empty tenantId, with no
    // error. A tab that forgets this parameter renders "no subscriptions" and
    // looks entirely correct doing it.
    await waitFor(() => expect(subscriptionsParams).toBeDefined())
    expect(subscriptionsParams).toEqual({ tenantId: "o1" })
  })

  it("renders nothing when it has no org id at all", async () => {
    const own = subStubClient({})
    const { container } = renderSubPage(OrgTabAt, {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    // Never send an empty tenantId. The answer would be indistinguishable
    // from a real one.
    expect(own.intents).toEqual([])
    expect(container.textContent).toBe("")
  })

  it("names the plan rather than showing its id", async () => {
    const own = subStubClient({
      "subscriptions.list": { subscriptions: [{ id: "s1", tenantId: "o1", planId: "p1", status: "active" }] },
      "plans.list": plans,
    })
    renderSubPage(OrgTabAt, {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { orgId: "o1" },
    })
    // SubscriptionSummary carries planId and no plan name. plans.list is the
    // only way to turn one into the other, and "p1" tells an operator nothing.
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
  })
})
