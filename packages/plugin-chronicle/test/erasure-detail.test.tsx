import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ErasureDetailPage } from "../src/pages/erasure-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"
import type { ErasureSummary } from "../src/types"

const erasure: ErasureSummary = {
  id: "erasure_3",
  subjectId: "subject_1",
  reason: "GDPR Article 17 request 5520",
  requestedBy: "user_admin",
  eventsAffected: 12431,
  keyDestroyed: true,
  legacyKeyRetained: false,
  status: "completed",
  createdAt: "2026-09-29T10:00:00Z",
}

describe("ErasureDetailPage", () => {
  it("shows the whole record", async () => {
    const c = scriptedClient({ "erasures.detail": erasure })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    await waitFor(() => expect(screen.getByText("subject_1")).toBeTruthy())
    expect(screen.getByText("subject_1").className).toContain("font-mono")
    expect(screen.getByText("GDPR Article 17 request 5520")).toBeTruthy()
    expect(screen.getByText("user_admin")).toBeTruthy()
    expect(screen.getByText("12,431")).toBeTruthy()
    expect(screen.getByText("Key destroyed")).toBeTruthy()
    expect(screen.getByText("Completed")).toBeTruthy()
    expect(screen.queryByText(/The key was kept/)).toBeNull()
    expect(screen.queryByText(/did not finish/)).toBeNull()
    expect(c.queried).toEqual([
      { intent: "erasures.detail", params: { id: "erasure_3" } },
    ])
  })

  it("explains a kept key", async () => {
    const c = scriptedClient({
      "erasures.detail": {
        ...erasure,
        keyDestroyed: false,
        legacyKeyRetained: true,
      },
    })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    expect(
      await screen.findByText(
        "The key was kept because events in another scope still use it. This erasure's events are marked erased and unreadable; the key is destroyed the first time an erasure finds no other scope using it."
      )
    ).toBeTruthy()
    expect(screen.getByText("Legacy key retained")).toBeTruthy()
  })

  it("says a pending erasure did not finish, and never claims the key was kept", async () => {
    const c = scriptedClient({
      "erasures.detail": {
        ...erasure,
        status: "pending",
        keyDestroyed: false,
        legacyKeyRetained: false,
      },
    })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    expect(
      await screen.findByText(
        "This erasure did not finish. Its events may be marked and some of its keys may already be gone, but not every key is confirmed destroyed. Run the erasure again for this subject; the retry gets its own record."
      )
    ).toBeTruthy()
    expect(screen.getByText("Pending")).toBeTruthy()
    expect(screen.getByText("Not confirmed")).toBeTruthy()
    expect(screen.queryByText(/The key was kept/)).toBeNull()
  })

  it("never says in its header that the key was destroyed when the record says otherwise", async () => {
    const c = scriptedClient({
      "erasures.detail": {
        ...erasure,
        status: "pending",
        keyDestroyed: false,
        legacyKeyRetained: false,
      },
    })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    await screen.findByText("Not confirmed")
    expect(screen.queryByText(/key was destroyed/)).toBeNull()
  })

  it("has nothing extra to say about a key left intact by a completed erasure", async () => {
    const c = scriptedClient({
      "erasures.detail": {
        ...erasure,
        keyDestroyed: false,
        legacyKeyRetained: false,
      },
    })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    expect(await screen.findByText("Key intact")).toBeTruthy()
    expect(screen.queryByText(/The key was kept/)).toBeNull()
    expect(screen.queryByText(/did not finish/)).toBeNull()
  })

  it("renders NOT_FOUND as not found", async () => {
    renderPage(
      ErasureDetailPage,
      failingClient(new ContractError("NOT_FOUND", "erasure not found")),
      { id: "erasure_x" }
    )
    expect(await screen.findByText(/NOT_FOUND: erasure not found/)).toBeTruthy()
  })

  it("names the erasure's tenant, and says an app-level one reaches every tenant", async () => {
    const view = renderPage(
      ErasureDetailPage,
      scriptedClient({ "erasures.detail": { ...erasure, tenantId: "globex" } })
        .client,
      { id: "erasure_3" }
    )
    await waitFor(() =>
      expect(screen.getByText("globex").className).toContain("font-mono")
    )
    view.unmount()
    renderPage(
      ErasureDetailPage,
      scriptedClient({ "erasures.detail": { ...erasure, tenantId: "" } })
        .client,
      { id: "erasure_3" }
    )
    await waitFor(() =>
      expect(screen.getByText("App level, every tenant")).toBeTruthy()
    )
  })
})
