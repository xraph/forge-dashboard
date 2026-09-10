import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { consentSubPlugin, ConsentUserSection } from "../../src/sub/consent"
import { renderSubPage, subStubClient } from "./harness"

const items = {
  items: [
    {
      id: "c1",
      userId: "u1",
      purpose: "marketing",
      granted: true,
      version: "v2",
      grantedAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "c2",
      userId: "u2",
      purpose: "analytics",
      granted: false,
      revokedAt: "2026-02-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
}
const page = consentSubPlugin.routes[0].element

describe("consent list", () => {
  it("shows granted and revoked apart", async () => {
    renderSubPage(page, {
      client: subStubClient({ "consent.list": items }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(screen.getByText("granted").getAttribute("data-variant")).toBe("default")
    expect(screen.getByText("revoked").getAttribute("data-variant")).toBe("destructive")
  })

  it("revokes by user and purpose, never by the record id", async () => {
    const own = subStubClient({ "consent.list": items }, { "consent.revoke": { ok: true } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }))
    // The plan's draft asserted on `own.commands`, which `stubClient` does not
    // return - it returns `{ client, intents, payloads }`, and `payloads`
    // holds `{ intent, payload }` pairs for every COMMAND sent.
    await waitFor(() => expect(own.payloads).toHaveLength(1))
    // The row carries an id and the intent does not take one. It matches on
    // the (userId, purpose) composite.
    expect(own.payloads[0].payload).toEqual({ userId: "u1", purpose: "marketing" })
  })

  it("offers revoke only on a granted record", async () => {
    renderSubPage(page, {
      client: subStubClient({ "consent.list": items }).client,
      hostClient: subStubClient({}).client,
      allowed: [],
    })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /revoke analytics for u2/i })).toBeNull()
  })

  it("forgets a failed revoke before the next row's dialog opens", async () => {
    // The plan's draft answered "consent.revoke" with a plain `new
    // Error("nope")`. stubClient's command only throws when the answer is a
    // ContractError instance (see ../harness.tsx); a plain Error is returned
    // as if it were a successful result, so `execute()` would resolve it as
    // data instead of setting `.error`, and the dialog's alert would never
    // appear. A command only fails, from this hook's point of view, when the
    // client actually throws.
    const own = subStubClient(
      { "consent.list": items },
      { "consent.revoke": new ContractError("INTERNAL", "nope") },
    )
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    // One command hook serves every row, so without reset() the previous
    // failure follows the operator to the next dialog and reads as this row's.
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("drops the cursor when the purpose filter changes", async () => {
    // stubClient's `payloads` array records COMMAND payloads only, never
    // query params (see ../harness.tsx and settings-panel.test.tsx), so
    // "consent.list" - a query - cannot be inspected through `own.payloads`
    // the way the plan's draft assumed. A functional answer that captures
    // its own params, the pattern settings-panel.test.tsx and
    // organization.test.tsx already use, is how a query's params get read
    // back in a test.
    let lastParams: Record<string, unknown> | undefined
    const own = subStubClient({
      "consent.list": (params: unknown) => {
        lastParams = params as Record<string, unknown>
        return { ...items, nextCursor: "c9" }
      },
    })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(lastParams).toMatchObject({ cursor: "c9" }))
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "analytics" } })
    await waitFor(() => expect(lastParams).toMatchObject({ purpose: "analytics" }))
    expect(lastParams?.cursor).toBeUndefined()
  })
})

describe("ConsentUserSection", () => {
  it("asks the userConsents intent for the user it was given", async () => {
    // Same query-params caveat as above: `own.payloads[0]` cannot see a
    // query, so the params are captured off a functional answer instead.
    //
    // The wrapper also has to bridge two different calling conventions.
    // `renderSubPage` was built for ROUTES, which read `params.id` off one
    // `params` prop (see harness.tsx: `<Page params={opts.params ?? {}} />`).
    // A slot contribution is called differently - `PluginSlot` spreads the
    // slot's params straight onto the contribution's own props
    // (`<Contribution {...(params ?? {})} />`, in slots.tsx), so
    // `ConsentUserSection` takes `userId` directly rather than nested under
    // `params`. The wrapper below reads the route-shaped `params` the
    // harness hands it and re-offers `userId` the way `PluginSlot` actually
    // would, which is what makes this test exercise the same prop shape the
    // real mount does.
    let queryParams: unknown
    const own = subStubClient({
      "consent.userConsents": (params: unknown) => {
        queryParams = params
        return items
      },
    })
    renderSubPage(
      ({ params }) => <ConsentUserSection userId={params.userId} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { userId: "u1" } },
    )
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(own.intents).toEqual(["consent.userConsents"])
    expect(queryParams).toEqual({ userId: "u1" })
  })

  it("renders nothing at all when the user has no consents", async () => {
    const own = subStubClient({ "consent.userConsents": { items: [] } })
    const { container } = renderSubPage(
      ({ params }) => <ConsentUserSection userId={params.userId} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { userId: "u1" } },
    )
    await waitFor(() => expect(own.intents).toHaveLength(1))
    // A section on somebody else's page is a guest. An empty card headed
    // "Consent" on every user with no consent records is clutter, not
    // information, and the host page has no way to suppress it.
    expect(container.textContent).toBe("")
  })
})
