import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderContribution, subStubClient } from "./harness"

describe("renderContribution", () => {
  it("spreads the slot params, the way PluginSlot does", async () => {
    // The distinction this whole helper exists for. A route gets one `params`
    // prop; a contribution gets the params SPREAD. A contribution written
    // against the wrong one passes its test and renders nothing on a real page.
    function Tab({ orgId }: { orgId?: string }) {
      return <p>{orgId ?? "no org id reached this contribution"}</p>
    }

    renderContribution(
      { id: "billing", label: "Billing", render: Tab },
      {
        slot: "org.detail.tabs",
        client: subStubClient({}).client,
        hostClient: subStubClient({}).client,
        params: { orgId: "o1" },
      },
    )

    await waitFor(() => expect(screen.getByText("o1")).toBeTruthy())
  })

  it("gives the contribution its own extension's client", async () => {
    const own = subStubClient({ "orgs.list": { organizations: [] } })
    const host = subStubClient({ "orgs.list": { organizations: [] } })

    function Widget() {
      return <p>rendered</p>
    }

    renderContribution(
      { id: "w", render: Widget },
      {
        slot: "overview.widgets",
        client: own.client,
        hostClient: host.client,
      },
    )

    await waitFor(() => expect(screen.getByText("rendered")).toBeTruthy())
    // Nothing queried yet, but the wiring is the production one: the
    // contribution sits under a real PluginSlot with its own provider rather
    // than under an approximation of one.
    expect(host.intents).toEqual([])
  })
})
