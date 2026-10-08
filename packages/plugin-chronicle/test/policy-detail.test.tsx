import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { PolicyDetailPage } from "../src/pages/policy-detail"
import { commandPendingClient, scriptedClient } from "./harness"
import type { PolicySummary } from "../src/types"

/**
 * jsdom has no PointerEvent, and Base UI's checkbox dispatches through it. A
 * MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const policy = (over: Partial<PolicySummary> = {}): PolicySummary => ({
  id: "retpol_acme_debug",
  category: "debug",
  duration: "720h0m0s",
  archive: false,
  appId: "app_chronicle",
  tenantId: "acme",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-02T00:00:00Z",
  editable: true,
  ...over,
})

function renderDetail(client: ScopedClient, id = "retpol_acme_debug") {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <PolicyDetailPage params={{ id }} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { navigate }
}

const save = () =>
  screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement

describe("PolicyDetailPage", () => {
  it("asks for the policy in the address and lists every field", async () => {
    const c = scriptedClient({
      "retention.policyDetail": policy({ archive: true }),
    })
    renderDetail(c.client)
    await screen.findByText("Tenant acme")
    expect(c.queried).toEqual([
      { intent: "retention.policyDetail", params: { id: "retpol_acme_debug" } },
    ])
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "retpol_acme_debug"
    )
    expect(
      screen
        .getAllByText("retpol_acme_debug")
        .some((e) => e.className.includes("font-mono"))
    ).toBe(true)
    expect(screen.getByText("app_chronicle").className).toContain("font-mono")
    expect(screen.getByText("30 days")).toBeTruthy()
    expect(screen.getByText("Archived first")).toBeTruthy()
    expect(screen.getByText("debug")).toBeTruthy()
  })

  it("says an app-level policy removes events from every tenant", async () => {
    const c = scriptedClient({
      "retention.policyDetail": policy({
        id: "retpol_app_all",
        category: "*",
        tenantId: undefined,
      }),
    })
    renderDetail(c.client, "retpol_app_all")
    await screen.findByText("App level, every tenant")
    expect(screen.getByText("Every category (*)")).toBeTruthy()
    expect(
      screen.getByText(
        /has no tenant, so it removes events from every tenant in the app/
      )
    ).toBeTruthy()
  })

  it("starts the form from the policy's own duration, in days when it is a whole number of them", async () => {
    renderDetail(scriptedClient({ "retention.policyDetail": policy() }).client)
    await screen.findByLabelText("Keep events for")
    expect(
      (screen.getByLabelText("Keep events for") as HTMLInputElement).value
    ).toBe("30")
    expect(
      (screen.getByLabelText("Duration unit") as HTMLSelectElement).value
    ).toBe("days")
    expect(
      screen
        .getByRole("checkbox", { name: "Archive events before removing them" })
        .getAttribute("aria-checked")
    ).toBe("false")
  })

  it("starts in hours when the duration is not a whole number of days", async () => {
    renderDetail(
      scriptedClient({
        "retention.policyDetail": policy({ duration: "36h0m0s" }),
      }).client
    )
    await screen.findByLabelText("Keep events for")
    expect(
      (screen.getByLabelText("Keep events for") as HTMLInputElement).value
    ).toBe("36")
    expect(
      (screen.getByLabelText("Duration unit") as HTMLSelectElement).value
    ).toBe("hours")
  })

  it("saves the id, the duration and the archive choice, and never the category", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.savePolicy": policy({ duration: "48h0m0s", archive: true }) }
    )
    renderDetail(c.client)
    await screen.findByLabelText("Keep events for")
    fireEvent.change(screen.getByLabelText("Keep events for"), {
      target: { value: "48" },
    })
    fireEvent.change(screen.getByLabelText("Duration unit"), {
      target: { value: "hours" },
    })
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Archive events before removing them",
      })
    )
    fireEvent.click(save())
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(c.sent[0]).toEqual({
      intent: "retention.savePolicy",
      payload: { id: "retpol_acme_debug", duration: "48h", archive: true },
    })
    expect("category" in (c.sent[0].payload as object)).toBe(false)
    await screen.findByText("Saved.")
  })

  it("says the category cannot change, and how to get another", async () => {
    renderDetail(scriptedClient({ "retention.policyDetail": policy() }).client)
    await screen.findByLabelText("Keep events for")
    expect(screen.getByText(/The category cannot be changed/)).toBeTruthy()
    expect(screen.queryByLabelText("Category")).toBeNull()
  })

  it("warns that a shorter duration removes older events at the next run", async () => {
    renderDetail(scriptedClient({ "retention.policyDetail": policy() }).client)
    await screen.findByLabelText("Keep events for")
    expect(
      screen.getByText(
        /Shortening the duration removes older events the next time retention runs/
      )
    ).toBeTruthy()
  })

  it("refuses a zero duration before sending", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.savePolicy": policy() }
    )
    renderDetail(c.client)
    await screen.findByLabelText("Keep events for")
    fireEvent.change(screen.getByLabelText("Keep events for"), {
      target: { value: "0" },
    })
    expect(
      screen.getByText("A duration must be greater than zero.")
    ).toBeTruthy()
    expect(save().disabled).toBe(true)
    expect(c.sent).toEqual([])
  })

  it("sends a duration the form cannot show back unchanged when only the archive choice moves", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy({ duration: "1h30m0s" }) },
      { "retention.savePolicy": policy() }
    )
    renderDetail(c.client)
    await screen.findByLabelText("Keep events for")
    expect(
      (screen.getByLabelText("Keep events for") as HTMLInputElement).value
    ).toBe("")
    expect(screen.getByText(/Currently 1h30m0s/)).toBeTruthy()
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Archive events before removing them",
      })
    )
    fireEvent.click(save())
    await waitFor(() =>
      expect(c.sent).toEqual([
        {
          intent: "retention.savePolicy",
          payload: {
            id: "retpol_acme_debug",
            duration: "1h30m0s",
            archive: true,
          },
        },
      ])
    )
  })

  it("shows a refused save with its code and stays on the page", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.savePolicy": new ContractError("NOT_FOUND", "not found") }
    )
    const { navigate } = renderDetail(c.client)
    await screen.findByLabelText("Keep events for")
    fireEvent.click(save())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("NOT_FOUND")
    expect(navigate).not.toHaveBeenCalled()
    expect(screen.queryByText("Saved.")).toBeNull()
  })

  it("deletes through a confirmation, names the policy in it, and goes back to the list", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.deletePolicy": { id: "retpol_acme_debug" } }
    )
    const { navigate } = renderDetail(c.client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete policy" })
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Delete retpol_acme_debug?")).toBeTruthy()
    expect(
      within(dialog).getByText(/Events already removed by it stay removed/)
    ).toBeTruthy()
    expect(c.sent).toEqual([])
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete policy" })
    )
    await waitFor(() =>
      expect(c.sent).toEqual([
        {
          intent: "retention.deletePolicy",
          payload: { id: "retpol_acme_debug" },
        },
      ])
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/retention"))
  })

  it("shows no not-found card for the policy it just deleted while the list is on its way", async () => {
    let deleted = false
    const c = scriptedClient(
      {
        "retention.policyDetail": () =>
          deleted ? new ContractError("NOT_FOUND", "not found") : policy(),
      },
      {
        "retention.deletePolicy": () => {
          deleted = true
          // The server names retention.policyDetail in the delete's invalidates, so this page's own read goes again.
          queryStore.invalidate("chronicle", ["retention.policyDetail"])
          return { id: "retpol_acme_debug" }
        },
      }
    )
    // The host navigates in a transition, so this page stays mounted for a moment after the delete; the stub navigate models that by leaving it mounted.
    const { navigate } = renderDetail(c.client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete policy" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete policy" })
    )
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/retention"))
    await waitFor(() =>
      expect(
        c.queried.filter((q) => q.intent === "retention.policyDetail").length
      ).toBeGreaterThan(1)
    )
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(/NOT_FOUND/)).toBeNull()
    expect(screen.getByRole("status").textContent).toContain("Policy deleted")
  })

  it("marks the delete as pending while it runs and ignores Escape until it settles", async () => {
    renderDetail(commandPendingClient({ "retention.policyDetail": policy() }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete policy" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete policy" })
    )
    await within(dialog).findByRole("button", { name: "Working…" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("shows a refused delete inside the dialog and does not leave the page", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.deletePolicy": new ContractError("PERMISSION_DENIED", "") }
    )
    const { navigate } = renderDetail(c.client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete policy" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete policy" })
    )
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toContain(
        "PERMISSION_DENIED"
      )
    )
    expect(navigate).not.toHaveBeenCalled()
  })

  it("does not carry a refused delete into the next opening of the dialog", async () => {
    const c = scriptedClient(
      { "retention.policyDetail": policy() },
      { "retention.deletePolicy": new ContractError("PERMISSION_DENIED", "") }
    )
    renderDetail(c.client)
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete policy" })
    )
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete policy" })
    )
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy())
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Delete policy" }))
    const again = await screen.findByRole("alertdialog")
    expect(within(again).queryByRole("alert")).toBeNull()
  })

  it("renders a governing policy read-only, with no save and no delete", async () => {
    renderDetail(
      scriptedClient({
        "retention.policyDetail": policy({
          id: "retpol_app_all",
          category: "*",
          tenantId: undefined,
          editable: false,
        }),
      }).client,
      "retpol_app_all"
    )
    await screen.findByText("App level, every tenant")
    expect(
      screen.getByText(
        "This policy is set at the app level and applies to your tenant. An app-wide operator manages it."
      )
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete policy" })).toBeNull()
    expect(screen.queryByLabelText("Keep events for")).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.getByText("Every category (*)")).toBeTruthy()
    expect(screen.getByText("30 days")).toBeTruthy()
  })

  it("shows the server's refusal when the policy cannot be read", async () => {
    renderDetail(
      scriptedClient({
        "retention.policyDetail": new ContractError("NOT_FOUND", "not found"),
      }).client
    )
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("NOT_FOUND")
    )
  })
})
