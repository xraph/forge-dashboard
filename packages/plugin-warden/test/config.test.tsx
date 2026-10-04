import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenConfigPage } from "../src/pages/config"
import { failingClient, recordingCommandClient, renderPage, stubClient } from "./harness"

const CONFIG = {
  maxGraphDepth: 10,
  maxGraphVisited: 5000,
  maxGraphFanout: 1000,
  maxBatchChecks: 100,
  cacheTtlSeconds: 60,
  cacheMaxSize: 10000,
  rbacEnabled: true,
  abacEnabled: true,
  rebacEnabled: true,
  checkLogEnabled: true,
  requireTenant: true,
  evaluateAllModels: false,
  checkLogQueueSize: 4096,
  checkLogRetentionHours: 2160,
  maintenanceIntervalMinutes: 60,
}

describe("WardenConfigPage", () => {
  it("shows which authorization models are enabled", async () => {
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    expect(await screen.findByText("RBAC")).toBeTruthy()
    expect(await screen.findByText("ABAC")).toBeTruthy()
    expect(await screen.findByText("ReBAC")).toBeTruthy()
  })

  it("says the configuration is read-only and where it comes from", async () => {
    // Warden's Config comes from Forge config, not a store. A page with no
    // save button and no explanation looks broken rather than read-only.
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    expect(await screen.findByText(/read-only/i)).toBeTruthy()
  })

  /**
   * The banner that stops an empty check log from lying.
   *
   * With check logging off, no writer is constructed at all and the check
   * log table is empty. That is indistinguishable from a system where
   * nothing has been checked, and the difference is "you have no audit
   * trail" versus "you are idle".
   */
  it("warns when check logging is disabled", async () => {
    renderPage(
      WardenConfigPage,
      stubClient({ "config.detail": { ...CONFIG, checkLogEnabled: false } })
    )
    expect(await screen.findByText(/check logging is disabled/i)).toBeTruthy()
    expect(await screen.findByText(/nothing is being recorded/i)).toBeTruthy()
  })

  it("lists every registered plugin by name", async () => {
    renderPage(
      WardenConfigPage,
      stubClient({
        "config.detail": { ...CONFIG, plugins: ["auditlog", "warden-cache-invalidator"] },
      })
    )
    const section = await screen.findByRole("region", { name: "Plugins" })
    expect(within(section).getByText("auditlog")).toBeTruthy()
    expect(within(section).getByText("warden-cache-invalidator")).toBeTruthy()
    expect(within(section).queryByText(/no authorization plugins/i)).toBeNull()
  })

  it("says no plugins are registered when the list is empty", async () => {
    // Templ hid the card when there were none. A missing section reads the
    // same as one that failed to load, so the page says it outright.
    renderPage(WardenConfigPage, stubClient({ "config.detail": { ...CONFIG, plugins: [] } }))
    expect(await screen.findByText("No authorization plugins are registered.")).toBeTruthy()
  })

  it("says nothing about plugins when the server does not report them", async () => {
    // A server older than the plugins field sends none. Saying "none are
    // registered" then would be a claim the page cannot back.
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByText("RBAC")
    expect(screen.queryByRole("region", { name: "Plugins" })).toBeNull()
    expect(screen.queryByText(/no authorization plugins/i)).toBeNull()
  })

  it("does not warn when check logging is on", async () => {
    renderPage(WardenConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByText("RBAC")
    expect(screen.queryByText(/check logging is disabled/i)).toBeNull()
  })

  /**
   * A run that purged nothing succeeded. It must not read as a failure and
   * must not read as having removed something.
   */
  it("reports a maintenance run that purged nothing as a success", async () => {
    const { client } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.run": { assignmentsPurged: 0, checkLogsPurged: 0 } }
    )
    renderPage(WardenConfigPage, client)

    fireEvent.click(await screen.findByRole("button", { name: /run maintenance/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }))

    expect(await screen.findByText(/nothing needed purging/i)).toBeTruthy()
  })

  it("reports what a maintenance run actually purged", async () => {
    const { client } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.run": { assignmentsPurged: 3, checkLogsPurged: 120 } }
    )
    renderPage(WardenConfigPage, client)

    fireEvent.click(await screen.findByRole("button", { name: /run maintenance/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }))

    expect(await screen.findByText(/3 expired assignments/i)).toBeTruthy()
    expect(await screen.findByText(/120 check log entries/i)).toBeTruthy()
  })

  it("sends no subject fields when flushing the whole tenant", async () => {
    const { client, sent } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.cacheInvalidate": { scope: "tenant" } }
    )
    renderPage(WardenConfigPage, client)

    fireEvent.click(await screen.findByRole("button", { name: /clear cache/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^clear$/i }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("maintenance.cacheInvalidate")
    // The contract rejects a half-specified subject, so an empty string in
    // either field would be a BAD_REQUEST rather than a tenant flush.
    expect(sent[0].payload).toEqual({})
  })

  /**
   * The contract returns the scope it cleared specifically so the operator
   * reads what happened rather than a bare "done". This button only ever
   * sends the tenant-wide flush, so the message it shows on success names
   * the tenant.
   */
  it("reports the tenant scope after clearing the cache", async () => {
    const { client } = recordingCommandClient(
      { "config.detail": CONFIG },
      { "maintenance.cacheInvalidate": { scope: "tenant" } }
    )
    renderPage(WardenConfigPage, client)

    fireEvent.click(await screen.findByRole("button", { name: /clear cache/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^clear$/i }))

    expect(await screen.findByText(/cleared the decision cache for this tenant/i)).toBeTruthy()
  })

  /**
   * doRun returns early when execute() resolves undefined, which only
   * happens when the client throws a ContractError - a stub that answers
   * `{ok: false}` resolves normally and never exercises this path. Base UI
   * marks everything outside an open dialog inert and aria-hidden, so the
   * error has to be reachable from inside the still-open dialog, not
   * findable only with `hidden: true`.
   */
  it("leaves the run-maintenance dialog open and shows the error when the command fails", async () => {
    renderPage(
      WardenConfigPage,
      failingClient(new ContractError("INTERNAL", "store unavailable"))
    )

    fireEvent.click(await screen.findByRole("button", { name: /run maintenance/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^run$/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("store unavailable")
    // Reachable specifically means inside the open dialog: an aria-hidden
    // ancestor is exactly what the alert would sit under if it had been
    // rendered on the page body instead of inside this ConfirmDialog.
    expect(alert.closest('[aria-hidden="true"]')).toBeNull()

    // Still open, not dismissed out from under the alert the operator is
    // meant to read.
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy()
  })

  /** Same failure shape as the run-maintenance dialog above, for the other write on this page. */
  it("leaves the clear-cache dialog open and shows the error when the command fails", async () => {
    renderPage(
      WardenConfigPage,
      failingClient(new ContractError("INTERNAL", "cache backend unreachable"))
    )

    fireEvent.click(await screen.findByRole("button", { name: /clear cache/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^clear$/i }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("cache backend unreachable")
    expect(alert.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.getByRole("button", { name: /^clear$/i })).toBeTruthy()
  })
})
