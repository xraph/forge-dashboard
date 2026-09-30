import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { EnforceDialog } from "../src/components/enforce-dialog"
import { commandPendingClient, scriptedClient } from "./harness"

const preview = {
  eventCount: 10000, capped: true, noPolicies: false, governingAppPolicies: 0,
  byPolicy: [{ policyId: "retpol_acme_debug", category: "debug", eventCount: 10000, capped: true }],
}

function renderDialog(client: ScopedClient, onOpenChange: (open: boolean) => void = () => {}) {
  return render(
    <PluginProvider client={client}>
      <EnforceDialog open onOpenChange={onOpenChange} />
    </PluginProvider>,
  )
}

describe("EnforceDialog", () => {
  it("runs the preview when it opens and calls the count eligible, at least", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    renderDialog(c.client)
    await waitFor(() => expect(screen.getByText(/At least 10,000 events are eligible/)).toBeTruthy())
    expect(screen.getByText(/One run removes at most 5,000 events per policy/)).toBeTruthy()
    expect(screen.getByText(/recorded in the chain as removed by retention/)).toBeTruthy()
  })

  it("asks nothing while it is closed, and asks once it opens", async () => {
    const c = scriptedClient({ "retention.preview": preview })
    const ui = (open: boolean) => (
      <PluginProvider client={c.client}>
        <EnforceDialog open={open} onOpenChange={() => {}} />
      </PluginProvider>
    )
    const { rerender } = render(ui(false))
    await new Promise((r) => setTimeout(r, 20))
    expect(c.queried).toEqual([])
    expect(screen.queryByRole("alertdialog")).toBeNull()
    rerender(ui(true))
    await screen.findByText(/At least 10,000/)
    expect(c.queried).toEqual([{ intent: "retention.preview", params: {} }])
  })

  it("lists each policy's count, saying at least only where the count was capped", async () => {
    const c = scriptedClient({
      "retention.preview": {
        eventCount: 10012, capped: true, noPolicies: false, governingAppPolicies: 0,
        byPolicy: [
          { policyId: "retpol_acme_debug", category: "debug", eventCount: 10000, capped: true },
          { policyId: "retpol_acme_all", category: "*", eventCount: 12, capped: false },
        ],
      },
    })
    renderDialog(c.client)
    await screen.findByText(/At least 10,012 events are eligible/)
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("debug").parentElement!.textContent).toBe("debug: at least 10,000 events")
    expect(within(dialog).getByText("Every category (*)").parentElement!.textContent).toBe("Every category (*): 12 events")
  })

  it("keeps the confirm button off until the preview has loaded", async () => {
    const c = scriptedClient({ "retention.preview": preview })
    renderDialog(c.client)
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
    await screen.findByText(/At least 10,000/)
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(false)
    expect(c.sent).toEqual([])
  })

  it("does not offer a count from an earlier opening as the current one", async () => {
    // The cache still holds the last opening's answer while the new read is in flight.
    queryStore.read("chronicle|retention.preview|{}", async () => preview, 0)
    await new Promise((r) => setTimeout(r, 10))
    const c = scriptedClient({ "retention.preview": () => new Promise(() => {}) })
    renderDialog(c.client)
    await waitFor(() => expect(c.queried.length).toBe(1))
    expect(screen.queryByText(/events are eligible/)).toBeNull()
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
  })

  it("sends the run with no payload and says more remain after a pass that did not finish them", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await waitFor(() => expect(screen.getByText(/5,000 events removed. More remain: run it again/)).toBeTruthy())
    expect(c.sent).toEqual([{ intent: "retention.enforce", payload: undefined }])
    expect(screen.queryByText(/stopped part-way/)).toBeNull()
  })

  it("names what was archived, and stops saying more remain when nothing does", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 40, purged: 40, retained: 0, moreRemain: false, failed: false } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    const line = await screen.findByText(/40 events removed/)
    expect(line.textContent).toBe("40 events removed, 40 archived.")
  })

  it("keeps the dialog open after a run, replaces the count with the result, and cannot run twice", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    let closed = false
    renderDialog(c.client, (o) => { if (!o) closed = true })
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await screen.findByText(/5,000 events removed/)
    expect(closed).toBe(false)
    expect(screen.queryByText(/events are eligible/)).toBeNull()
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy()
  })

  it("never shows a run that stopped part-way as a success", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 1200, retained: 0, moreRemain: true, failed: true } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByText(/stopped part-way/)).toBeTruthy())
    expect(within(dialog).getByText(/1,200 events were removed before it stopped, and that cannot be undone/)).toBeTruthy()
    expect(within(dialog).getByText(/Open the preview again to see what remains/)).toBeTruthy()
    // It is a failure: announced as one, in the failure colour, with no success line beside it.
    const failure = within(dialog).getByText(/stopped part-way/)
    expect(failure.getAttribute("role")).toBe("alert")
    expect(failure.className).toContain("text-destructive")
    expect(within(dialog).queryByText(/1,200 events removed/)).toBeNull()
    expect(within(dialog).queryByRole("status")).toBeNull()
    expect(within(dialog).queryByText(/More remain/)).toBeNull()
  })

  it("says a tenant with no policies of its own is still purged by the app's", async () => {
    const c = scriptedClient({ "retention.preview": { eventCount: 0, capped: false, noPolicies: true, governingAppPolicies: 1, byPolicy: [] } })
    renderDialog(c.client)
    await waitFor(() => expect(screen.getByText(/You have no retention policies of your own/)).toBeTruthy())
    expect(screen.getByText(/1 app-level policy also removes events from your chain on the scheduler's run/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
    expect(screen.queryByText(/events are eligible/)).toBeNull()
  })

  it("agrees the verb with several governing app-level policies", async () => {
    const c = scriptedClient({ "retention.preview": { eventCount: 0, capped: false, noPolicies: true, governingAppPolicies: 2, byPolicy: [] } })
    renderDialog(c.client)
    await waitFor(() => expect(screen.getByText(/2 app-level policies also remove events from your chain on the scheduler's run/)).toBeTruthy())
  })

  it("says nothing about the app's policies when none govern the chain", async () => {
    const c = scriptedClient({ "retention.preview": { eventCount: 0, capped: false, noPolicies: true, governingAppPolicies: 0, byPolicy: [] } })
    renderDialog(c.client)
    await screen.findByText(/You have no retention policies of your own, so running retention here removes nothing/)
    expect(screen.queryByText(/app-level polic/)).toBeNull()
  })

  it("still mentions the app's policies beside a tenant's own, since they purge the same chain", async () => {
    const c = scriptedClient({ "retention.preview": { ...preview, governingAppPolicies: 1 } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    expect(screen.getByText(/1 app-level policy also removes events from your chain on the scheduler's run/)).toBeTruthy()
  })

  it("shows a refusal inside the dialog", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": new ContractError("PERMISSION_DENIED", "") })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("PERMISSION_DENIED"))
    // A refusal ran nothing, so the count is still what the operator is looking at and they may retry.
    expect(within(dialog).getByText(/At least 10,000/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(false)
  })

  it("shows a failed preview inside the dialog and leaves the confirm button off", async () => {
    const c = scriptedClient({ "retention.preview": new ContractError("INTERNAL", "the audit store could not complete this request") })
    renderDialog(c.client)
    const dialog = screen.getByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("INTERNAL"))
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
  })

  it("does not show a failed recount beside a finished run", async () => {
    let calls = 0
    const c = scriptedClient(
      { "retention.preview": () => (++calls === 1 ? preview : new ContractError("INTERNAL", "count broke")) },
      {
        "retention.enforce": () => {
          // The server names retention.preview in the run's invalidates, so the mounted count refetches.
          queryStore.invalidate("chronicle", ["retention.preview"])
          return { archived: 0, purged: 5000, retained: 0, moreRemain: false, failed: false }
        },
      },
    )
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await screen.findByText(/5,000 events removed/)
    await waitFor(() => expect(calls).toBe(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("ignores Escape while the run is in flight, so its result is not lost", async () => {
    let closed = false
    renderDialog(commandPendingClient({ "retention.preview": preview }), (o) => { if (!o) closed = true })
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await screen.findByRole("button", { name: "Working…" })
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })
    await new Promise((r) => setTimeout(r, 20))
    expect(closed).toBe(false)
  })

  it("starts fresh every time it opens, with no result from the last run", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    const ui = (open: boolean) => (
      <PluginProvider client={c.client}>
        <EnforceDialog open={open} onOpenChange={() => {}} />
      </PluginProvider>
    )
    const { rerender } = render(ui(true))
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await screen.findByText(/5,000 events removed/)
    rerender(ui(false))
    rerender(ui(true))
    expect(screen.queryByText(/events removed/)).toBeNull()
    await screen.findByText(/At least 10,000/)
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(false)
  })
})
