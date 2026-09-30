import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { KeyBadge } from "../src/badges"
import { ErasuresPage } from "../src/pages/erasures"
import { paramsRecordingClient, renderPage, scriptedClient } from "./harness"
import type { ErasureSummary } from "../src/types"

const erasure = (n: number, over: Partial<ErasureSummary> = {}): ErasureSummary => ({
  id: `erasure_${n}`, subjectId: `subject_${n}`, reason: "GDPR Article 17", requestedBy: "user_admin",
  eventsAffected: 12431, keyDestroyed: true, createdAt: "2026-09-29T10:00:00Z", ...over,
})

describe("ErasuresPage", () => {
  it("lists erasures with a live caption, and ids and subjects in mono", async () => {
    const c = scriptedClient({ "erasures.list": { erasures: [erasure(2), erasure(1)], total: 2, hasMore: false } })
    renderPage(ErasuresPage, c.client)
    await waitFor(() => expect(screen.getByText("erasure_2")).toBeTruthy())
    expect(screen.getByText("erasure_2").className).toContain("font-mono")
    expect(screen.getByText("subject_2").className).toContain("font-mono")
    expect(screen.getAllByText("user_admin")[0].className).toContain("font-mono")
    expect(screen.getAllByText("12,431")).toHaveLength(2)
    expect(screen.getByText(/2 of 2 erasures/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "erasure_2" }).getAttribute("href")).toBe("/erasures/erasure_2")
  })

  it("shows an absent requester and time as none, not blank", async () => {
    const c = scriptedClient({ "erasures.list": { erasures: [erasure(1, { requestedBy: "", createdAt: "" })], total: 1, hasMore: false } })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(screen.getByLabelText("no requester")).toBeTruthy()
    expect(screen.getByLabelText("no request time")).toBeTruthy()
  })

  it("keeps a destroyed key quiet and marks a kept one", async () => {
    render(<><KeyBadge destroyed /><KeyBadge destroyed={false} /></>)
    expect(screen.getByText("Key destroyed").getAttribute("data-variant")).toBe("outline")
    expect(screen.getByText("Key kept").getAttribute("data-variant")).toBe("secondary")
  })

  it("says so when nothing has been erased, with a zero count", async () => {
    const c = scriptedClient({ "erasures.list": { erasures: [], total: 0, hasMore: false } })
    renderPage(ErasuresPage, c.client)
    expect(await screen.findByText("No erasures have been requested in this scope.")).toBeTruthy()
    expect(screen.getByText(/0 of 0 erasures/)).toBeTruthy()
  })

  it("pages by offset", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => erasure(i + 1))
    const c = paramsRecordingClient({ "erasures.list": { erasures: rows, total: 120, hasMore: true } })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(c.calls[0]).toEqual({ intent: "erasures.list", params: { limit: 50, offset: 0 } })
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.calls.some((q) => q.params?.offset === 50)).toBe(true))
  })

  it("opens the request dialog from the header action, without counting anything", async () => {
    const c = scriptedClient({ "erasures.list": { erasures: [erasure(1)], total: 1, hasMore: false } })
    render(
      <PluginProvider client={c.client}>
        <ErasuresPage params={{}} />
      </PluginProvider>,
    )
    await screen.findByText("erasure_1")
    fireEvent.click(screen.getByRole("button", { name: "Request an erasure" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    expect(screen.getByLabelText("Subject ID")).toBeTruthy()
    expect(c.queried.map((q) => q.intent)).toEqual(["erasures.list"])
  })
})
