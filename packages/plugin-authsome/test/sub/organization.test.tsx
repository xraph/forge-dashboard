import { describe, expect, it } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  HostAccessProvider,
  PluginProvider,
  SubPluginProvider,
} from "@forge-go/dashboard-plugin"
import {
  OrgDetailPage,
  organizationSubPlugin,
  slugify,
} from "../../src/sub/organization"
import { renderContribution, renderSubPage, subStubClient } from "./harness"
import { subscriptionSubPlugin } from "../../src/sub/subscription"

const orgs = {
  organizations: [
    { id: "o1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z" },
    {
      id: "o2",
      name: "Globex",
      slug: "globex",
      createdAt: "2026-02-01T00:00:00Z",
    },
  ],
}
const detail = {
  id: "o1",
  name: "Acme",
  slug: "acme",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-03-01T00:00:00Z",
  logo: "https://example.test/a.png",
  metadata: { tier: "gold" },
}
const members = {
  members: [
    {
      id: "m1",
      userId: "u1",
      role: "owner",
      createdAt: "2026-01-02T00:00:00Z",
    },
    {
      id: "m2",
      userId: "u2",
      role: "member",
      createdAt: "2026-01-03T00:00:00Z",
    },
  ],
}

function pageAt(path: string) {
  return organizationSubPlugin.routes.find((r) => r.path === path)!.element
}

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics into single hyphens", () => {
    expect(slugify("Wayne Enterprises")).toBe("wayne-enterprises")
  })

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  Acme!! ")).toBe("acme")
  })

  it("is empty for an empty name", () => {
    expect(slugify("")).toBe("")
  })
})

describe("organization list", () => {
  it("lists organizations with their slug", async () => {
    const own = subStubClient({ "orgs.list": orgs })
    renderSubPage(pageAt("/organizations"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
    expect(screen.getByText("globex")).toBeTruthy()
    // Its OWN contributor answered, not its host's. This is the property the
    // whole extension/host split exists for.
    expect(own.intents).toContain("orgs.list")
  })

  it("counts its rows in the caption, with no paging controls at all", async () => {
    renderSubPage(pageAt("/organizations"), {
      client: subStubClient({ "orgs.list": orgs }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
    expect(screen.getByText(/2 organizations/i)).toBeTruthy()
    // orgs.list takes no cursor and no limit. A Next button here would be a
    // control for a server behaviour that does not exist.
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull()
  })

  it("says so when there are none", async () => {
    renderSubPage(pageAt("/organizations"), {
      client: subStubClient({ "orgs.list": { organizations: [] } }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() =>
      expect(screen.getByText(/no organizations/i)).toBeTruthy()
    )
  })
})

describe("organization detail", () => {
  it("shows billing on the overview and opens the contributed tab", async () => {
    const orgClient = subStubClient({
      "orgs.detail": detail,
      "orgs.members": members,
    }).client
    const subscriptionClient = subStubClient({
      "subscriptions.list": {
        subscriptions: [
          { id: "s1", tenantId: "o1", planId: "p1", status: "active" },
        ],
      },
      "plans.list": {
        plans: [{ id: "p1", name: "Growth", slug: "growth", status: "active" }],
      },
    }).client
    render(
      <SubPluginProvider
        entries={[
          {
            subPlugin: subscriptionSubPlugin,
            client: subscriptionClient,
            hostClient: orgClient,
          },
        ]}
      >
        <HostAccessProvider
          value={{
            client: orgClient,
            allowed: [],
            subExtension: "organization",
          }}
        >
          <PluginProvider client={orgClient}>
            <OrgDetailPage params={{ id: "o1" }} />
          </PluginProvider>
        </HostAccessProvider>
      </SubPluginProvider>
    )
    await waitFor(() => expect(screen.getByText("Growth")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "View billing" }))
    await waitFor(() =>
      expect(
        screen
          .getByRole("tab", { name: "Billing" })
          .getAttribute("aria-selected")
      ).toBe("true")
    )
    expect(screen.getByRole("heading", { name: "Subscriptions" })).toBeTruthy()
  })

  it("shows the org, its members, and the two built-in tabs", async () => {
    renderSubPage(pageAt("/organizations/:id"), {
      client: subStubClient({ "orgs.detail": detail, "orgs.members": members })
        .client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Members" })).toBeTruthy()
    expect(screen.getByText("gold")).toBeTruthy()
  })

  it("asks orgs.members for the org id it was routed with", async () => {
    // stubClient's `payloads` array records only commands, not queries (see
    // ../harness.tsx), so a query's params are read back by having the
    // answer capture what it was called with, the same way
    // settings-panel.test.tsx does it, rather than off `own.payloads` as the
    // plan first assumed.
    let membersParams: unknown
    const own = subStubClient({
      "orgs.detail": detail,
      "orgs.members": (params: unknown) => {
        membersParams = params
        return members
      },
    })
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    // The members panel mounts when its tab is selected, which is what an
    // operator does. It used to mount with the page, through `keepMounted`,
    // and that had to go: Base UI un-hides a panel on activation and does not
    // hide it again without an exit transition to wait on, so every panel
    // ended up visible at once.
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    await waitFor(() => expect(membersParams).toBeDefined())
    // The param is orgId, not id. A detail page that sends `id` here gets
    // somebody else's members or none at all.
    expect(membersParams).toEqual({ orgId: "o1" })
  })

  it("removes a member by the MEMBER id, not the user id", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.removeMember": { ok: true } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: /remove u2/i }).length
      ).toBeGreaterThan(0)
    )
    fireEvent.click(screen.getAllByRole("button", { name: /remove u2/i })[0])
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    // m2, not u2. MemberSummary carries both and they are different values.
    expect(own.payloads[0].payload).toEqual({ id: "m2" })
  })

  it("shows the invitation empty state and action", async () => {
    renderSubPage(pageAt("/organizations/:id"), {
      client: subStubClient({
        "orgs.detail": detail,
        "orgs.members": members,
        "orgs.invitations": { invitations: [] },
      }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    expect(await screen.findByText("No invitations yet")).toBeTruthy()
    expect(
      screen.getAllByRole("button", { name: "Create invitation" }).length
    ).toBeGreaterThan(0)
  })

  it("adds an existing user to the selected organization", async () => {
    const own = subStubClient(
      {
        "orgs.detail": detail,
        "orgs.members": members,
        "orgs.invitations": { invitations: [] },
      },
      { "orgs.addMember": { ok: true, id: "m3" } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await screen.findByRole("heading", { name: "Acme" })
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    fireEvent.click(screen.getByRole("button", { name: "Add member" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Email or user ID"), {
      target: { value: "u3" },
    })
    fireEvent.change(within(dialog).getByLabelText("Role"), {
      target: { value: "admin" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add member" }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0]).toEqual({
      intent: "orgs.addMember",
      payload: { orgId: "o1", userId: "u3", role: "admin" },
    })
  })

  it("looks up an existing user by email when adding a member", async () => {
    const own = subStubClient(
      {
        "orgs.detail": detail,
        "orgs.members": members,
        "orgs.invitations": { invitations: [] },
      },
      { "orgs.addMember": { ok: true, id: "m3" } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await screen.findByRole("heading", { name: "Acme" })
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    fireEvent.click(screen.getByRole("button", { name: "Add member" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Email or user ID"), {
      target: { value: "grace@example.com" },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add member" }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0].payload).toEqual({
      orgId: "o1",
      email: "grace@example.com",
      role: "member",
    })
  })

  it("creates an invitation and shows its token once", async () => {
    const own = subStubClient(
      {
        "orgs.detail": detail,
        "orgs.members": members,
        "orgs.invitations": { invitations: [] },
      },
      {
        "orgs.createInvitation": {
          id: "i1",
          email: "person@example.com",
          role: "member",
          status: "pending",
          createdAt: detail.createdAt,
          expiresAt: detail.updatedAt,
          token: "one-time-token",
        },
      }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await screen.findByRole("heading", { name: "Acme" })
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    fireEvent.click(
      screen.getAllByRole("button", { name: "Create invitation" })[0]
    )
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create invitation" })
    )
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0]).toEqual({
      intent: "orgs.createInvitation",
      payload: { orgId: "o1", email: "person@example.com", role: "member" },
    })
    expect(await screen.findByText("one-time-token")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }))
    expect(screen.queryByText("one-time-token")).toBeNull()
  })

  it("sends only the fields the operator changed", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.update": { ok: true } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /edit/i }))
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Acme Inc" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    const payload = own.payloads[0].payload as Record<string, unknown>
    expect(payload.name).toBe("Acme Inc")
    // Absent, not "". orgs.update takes *string: an empty string is a real
    // value that clears the logo, and the operator did not ask for that.
    expect("logo" in payload).toBe(false)
  })

  it("sends an empty string for a field the operator deliberately cleared", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.update": { ok: true } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /edit/i }))
    fireEvent.change(screen.getByLabelText("Logo URL"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    const payload = own.payloads[0].payload as Record<string, unknown>
    // Present and empty. This is the other half of pointer semantics and the
    // half that is usually missing: "clear it" has to be expressible.
    expect("logo" in payload).toBe(true)
    expect(payload.logo).toBe("")
  })

  it("renders correctly when nothing contributes to its slots", async () => {
    // No SubPluginProvider anywhere in this test tree, so useSlotCount reads
    // 0 for every slot this page hosts. The page must still render its own
    // fields and tabs rather than an empty heading or a blank strip.
    renderSubPage(pageAt("/organizations/:id"), {
      client: subStubClient({ "orgs.detail": detail, "orgs.members": members })
        .client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    expect(screen.getByRole("tablist")).toBeTruthy()
    expect(screen.getAllByRole("tab")).toHaveLength(2)
  })

  it("says so when no organization id was routed", () => {
    renderSubPage(OrgDetailPage, {
      client: subStubClient({}).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    expect(screen.getByText(/no organization selected/i)).toBeTruthy()
  })
})

describe("organization delete", () => {
  // orgs.delete is a real, registered contract intent (see the file's own
  // header comment and .superpowers/sdd/authsome-subplugins-contract.md),
  // and the legacy templ page offers a Delete Organization control. This
  // page shipped without one at all, silently, which is exactly the kind of
  // gap the plan calls out elsewhere with an on-page note (see the
  // invitations line in the Members tab) rather than leaving unexplained.

  it("deletes by the org id and leaves for the list", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.delete": { ok: true } }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /delete acme/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    expect(own.payloads[0]).toEqual({
      intent: "orgs.delete",
      payload: { id: "o1" },
    })
    await waitFor(() =>
      expect(
        screen.getByText(/this organization has been deleted/i)
      ).toBeTruthy()
    )
    // Nowhere left to stay once its own subject is gone: the header, the
    // tabs and the edit/delete actions must not still be on screen.
    expect(screen.queryByRole("heading", { name: "Acme" })).toBeNull()
    expect(screen.queryByRole("tablist")).toBeNull()
  })

  it("shows a failed delete inside the dialog, not on the page body", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      {
        "orgs.delete": new ContractError(
          "INTERNAL",
          "still has active subscriptions"
        ),
      }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /delete acme/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/still has active subscriptions/)
    // The dialog itself is still open and usable: a failed delete must not
    // have navigated away (the "deleted" gate replaces this entire tree with
    // a status message and no dialog at all) or left the operator unable to
    // back out.
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy()
  })

  it("forgets a failed delete the next time the dialog opens", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.delete": new ContractError("INTERNAL", "nope") }
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
      params: { id: "o1" },
    })
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: /delete acme/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    fireEvent.click(screen.getByRole("button", { name: /delete acme/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }))
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("organization create", () => {
  it("fills the slug from the name until the operator edits the slug", async () => {
    const own = subStubClient({}, { "orgs.create": { ok: true, id: "o9" } })
    renderSubPage(pageAt("/organizations/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Wayne Enterprises" },
    })
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "wayne-enterprises"
    )
    fireEvent.change(screen.getByLabelText("Slug"), {
      target: { value: "wayne" },
    })
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Wayne Corp" },
    })
    // Once touched, the slug is the operator's. Overwriting it here loses the
    // value they just typed and they may not notice before submitting.
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "wayne"
    )
  })

  it("omits the logo when it is blank", async () => {
    const own = subStubClient({}, { "orgs.create": { ok: true, id: "o9" } })
    renderSubPage(pageAt("/organizations/create"), {
      client: own.client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Wayne" },
    })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    const payload = own.payloads[0].payload as Record<string, unknown>
    expect(payload).toEqual({ name: "Wayne", slug: "wayne" })
    expect("logo" in payload).toBe(false)
  })
})

describe("OrgCountWidget", () => {
  const widgetContribution =
    organizationSubPlugin.contributions["overview.widgets"]![0]

  it("counts the organizations the list intent answered", async () => {
    const own = subStubClient({ "orgs.list": orgs })
    renderContribution(widgetContribution, {
      slot: "overview.widgets",
      client: own.client,
      hostClient: subStubClient({}).client,
    })
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy())
    expect(screen.getByText(/organizations/i)).toBeTruthy()
    // Same intent the list page reads, same params (none), so the store
    // serves both from one request. That is the query store working, not a
    // coincidence worth avoiding.
    expect(own.intents).toEqual(["orgs.list"])
  })

  it("shows nothing rather than a zero while the count is loading", () => {
    const own = subStubClient({ "orgs.list": orgs })
    renderContribution(widgetContribution, {
      slot: "overview.widgets",
      client: own.client,
      hostClient: subStubClient({}).client,
    })
    // A widget that renders 0 before its data arrives tells an operator
    // something false for as long as the request takes. Asserted
    // synchronously, before the stub's async query resolves: this is the
    // loading state, not the settled-with-zero state.
    expect(screen.queryByText("0")).toBeNull()
  })
})
