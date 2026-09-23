import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { WardenConfigPage } from "../src/pages/config"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

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
})
