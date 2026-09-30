import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ErasureDetailPage } from "../src/pages/erasure-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"
import type { ErasureSummary } from "../src/types"

const erasure: ErasureSummary = {
  id: "erasure_3", subjectId: "subject_1", reason: "GDPR Article 17 request 5520", requestedBy: "user_admin",
  eventsAffected: 12431, keyDestroyed: true, createdAt: "2026-09-29T10:00:00Z",
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
    expect(screen.queryByText(/The key was kept/)).toBeNull()
    expect(c.queried).toEqual([{ intent: "erasures.detail", params: { id: "erasure_3" } }])
  })

  it("explains a kept key", async () => {
    const c = scriptedClient({ "erasures.detail": { ...erasure, keyDestroyed: false } })
    renderPage(ErasureDetailPage, c.client, { id: "erasure_3" })
    expect(
      await screen.findByText(
        "The key was kept because events in another scope still use it. This erasure's events are marked erased and unreadable; the key is destroyed the first time an erasure finds no other scope using it.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("Key kept")).toBeTruthy()
  })

  it("renders NOT_FOUND as not found", async () => {
    renderPage(ErasureDetailPage, failingClient(new ContractError("NOT_FOUND", "erasure not found")), { id: "erasure_x" })
    expect(await screen.findByText(/NOT_FOUND: erasure not found/)).toBeTruthy()
  })
})
