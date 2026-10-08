import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { subscriptionSubPlugin } from "../../src/sub/subscription"
import { renderContribution, renderSubPage, subStubClient } from "./harness"

const plans = {
  plans: [
    {
      id: "p1",
      name: "Pro",
      slug: "pro",
      status: "active",
      currency: "usd",
      trialDays: 14,
    },
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
    expect(screen.getByText("active").getAttribute("data-variant")).toBe(
      "default"
    )
    // The "Draft" plan's slug is also "draft", so its slug cell and its
    // status badge are two separate elements with the identical text - the
    // badge is the one carrying `data-variant`.
    const draftBadge = screen
      .getAllByText("draft")
      .find((el) => el.hasAttribute("data-variant"))
    expect(draftBadge?.getAttribute("data-variant")).toBe("secondary")
    expect(screen.getByText("archived").getAttribute("data-variant")).toBe(
      "outline"
    )
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
    expect(
      screen.queryByRole("button", { name: /activate legacy/i })
    ).toBeNull()
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
    expect(
      screen.getByText(/invoices, coupons and subscription changes/i)
    ).toBeTruthy()
  })

  it("shows a plan's features read-only", async () => {
    const detail = {
      id: "p1",
      name: "Pro",
      slug: "pro",
      status: "active",
      currency: "usd",
      features: [
        {
          key: "seats",
          name: "Seats",
          type: "seat",
          limit: 10,
          period: "monthly",
        },
      ],
    }
    renderSubPage(pageAt("/plans/:id"), {
      client: subStubClient({ "plans.detail": detail }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "p1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy()
    )
    expect(screen.getByText("seats")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
  })
})

describe("SubscriptionOrgTab", () => {
  // Rendered through `renderContribution`, not `renderSubPage`: this is an
  // `org.detail.tabs` contribution, and `PluginSlot` spreads a slot's params
  // straight onto the contribution's own props
  // (`<Contribution {...(params ?? {})} />`, in slots.tsx) rather than
  // nesting them under one `params` prop the way a routed page's are. An
  // earlier draft of this suite rendered SubscriptionOrgTab through
  // `renderSubPage` with a hand-rolled wrapper that re-derived `params.orgId`
  // itself; that happened to reproduce the right prop shape, but it skipped
  // the real `SubPluginProvider`/`PluginSlot`/error-boundary wiring every
  // other contribution in this package is tested through.
  const contribution =
    subscriptionSubPlugin.contributions["org.detail.tabs"]![0]

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
        return {
          subscriptions: [
            {
              id: "s1",
              tenantId: "o1",
              planId: "p1",
              status: "active",
              currentPeriodEnd: "2026-04-01T00:00:00Z",
            },
          ],
        }
      },
      "plans.list": plans,
    })
    renderContribution(contribution, {
      slot: "org.detail.tabs",
      client: own.client,
      hostClient: subStubClient({}).client,
      params: { orgId: "o1" },
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
    const { container } = renderContribution(contribution, {
      slot: "org.detail.tabs",
      client: own.client,
      hostClient: subStubClient({}).client,
    })
    // Never send an empty tenantId. The answer would be indistinguishable
    // from a real one.
    expect(own.intents).toEqual([])
    expect(container.textContent).toBe("")
  })

  it("names the plan rather than showing its id", async () => {
    const own = subStubClient({
      "subscriptions.list": {
        subscriptions: [
          { id: "s1", tenantId: "o1", planId: "p1", status: "active" },
        ],
      },
      "plans.list": plans,
    })
    renderContribution(contribution, {
      slot: "org.detail.tabs",
      client: own.client,
      hostClient: subStubClient({}).client,
      params: { orgId: "o1" },
    })
    // SubscriptionSummary carries planId and no plan name. plans.list is the
    // only way to turn one into the other, and "p1" tells an operator nothing.
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
  })
})

describe("SubscriptionUserSection", () => {
  // Same shape as SubscriptionOrgTab above, keyed to a `user.detail.sections`
  // contribution instead of `org.detail.tabs`. This component had no test
  // coverage at all before this pass.
  const contribution =
    subscriptionSubPlugin.contributions["user.detail.sections"]![0]

  it("sends the user id it was handed as the tenant", async () => {
    let subscriptionsParams: unknown
    const own = subStubClient({
      "subscriptions.list": (params: unknown) => {
        subscriptionsParams = params
        return {
          subscriptions: [
            { id: "s1", tenantId: "u1", planId: "p1", status: "trialing" },
          ],
        }
      },
      "plans.list": plans,
    })
    renderContribution(contribution, {
      slot: "user.detail.sections",
      client: own.client,
      hostClient: subStubClient({}).client,
      params: { userId: "u1" },
    })
    await waitFor(() => expect(screen.getByText("trialing")).toBeTruthy())
    expect(subscriptionsParams).toEqual({ tenantId: "u1" })
  })

  it("renders nothing when it has no user id at all", async () => {
    const own = subStubClient({})
    const { container } = renderContribution(contribution, {
      slot: "user.detail.sections",
      client: own.client,
      hostClient: subStubClient({}).client,
    })
    // Same refusal as SubscriptionOrgTab: subscriptions.list answers an empty
    // list for an empty tenantId, with no error, so a missing id has to stop
    // this from querying at all.
    expect(own.intents).toEqual([])
    expect(container.textContent).toBe("")
  })
})
