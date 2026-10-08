import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { ErasureStatusBadge, KeyBadge } from "../src/badges"
import { ErasuresPage } from "../src/pages/erasures"
import { paramsRecordingClient, renderPage, scriptedClient } from "./harness"
import type { ErasureSummary } from "../src/types"

const erasure = (
  n: number,
  over: Partial<ErasureSummary> = {}
): ErasureSummary => ({
  id: `erasure_${n}`,
  subjectId: `subject_${n}`,
  reason: "GDPR Article 17",
  requestedBy: "user_admin",
  eventsAffected: 12431,
  keyDestroyed: true,
  legacyKeyRetained: false,
  status: "completed",
  createdAt: "2026-09-29T10:00:00Z",
  ...over,
})

describe("ErasuresPage", () => {
  it("lists erasures with a live caption, and ids and subjects in mono", async () => {
    const c = scriptedClient({
      "erasures.list": {
        erasures: [erasure(2), erasure(1)],
        total: 2,
        hasMore: false,
      },
    })
    renderPage(ErasuresPage, c.client)
    await waitFor(() => expect(screen.getByText("erasure_2")).toBeTruthy())
    expect(screen.getByText("erasure_2").className).toContain("font-mono")
    expect(screen.getByText("subject_2").className).toContain("font-mono")
    expect(screen.getAllByText("user_admin")[0].className).toContain(
      "font-mono"
    )
    expect(screen.getAllByText("12,431")).toHaveLength(2)
    expect(screen.getByText(/2 of 2 erasures/)).toBeTruthy()
    expect(
      screen.getByRole("link", { name: "erasure_2" }).getAttribute("href")
    ).toBe("/erasures/erasure_2")
  })

  it("shows an absent requester and time as none, not blank", async () => {
    const c = scriptedClient({
      "erasures.list": {
        erasures: [erasure(1, { requestedBy: "", createdAt: "" })],
        total: 1,
        hasMore: false,
      },
    })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(screen.getByLabelText("no requester")).toBeTruthy()
    expect(screen.getByLabelText("no request time")).toBeTruthy()
  })

  it("marks a pending erasure as the failure it is and keeps a completed one quiet", async () => {
    const c = scriptedClient({
      "erasures.list": {
        erasures: [
          erasure(2, { status: "pending", keyDestroyed: false }),
          erasure(1),
        ],
        total: 2,
        hasMore: false,
      },
    })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(screen.getByText("Pending").getAttribute("data-variant")).toBe(
      "destructive"
    )
    expect(screen.getByText("Completed").getAttribute("data-variant")).toBe(
      "outline"
    )
  })

  it("does not claim every erasure destroyed a key when some did not", async () => {
    const c = scriptedClient({
      "erasures.list": {
        erasures: [
          erasure(3, { status: "pending", keyDestroyed: false }),
          erasure(2, { keyDestroyed: false, legacyKeyRetained: true }),
          erasure(1),
        ],
        total: 3,
        hasMore: false,
      },
    })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(screen.queryByText(/Each erasure destroyed/)).toBeNull()
  })

  it("answers the key four ways, and only a destroyed key stays quiet", () => {
    render(
      <>
        <KeyBadge erasure={erasure(1)} />
        <KeyBadge
          erasure={erasure(2, { keyDestroyed: false, legacyKeyRetained: true })}
        />
        <KeyBadge erasure={erasure(3, { keyDestroyed: false })} />
        <KeyBadge
          erasure={erasure(4, { status: "pending", keyDestroyed: false })}
        />
      </>
    )
    expect(screen.getByText("Key destroyed").getAttribute("data-variant")).toBe(
      "outline"
    )
    expect(
      screen.getByText("Legacy key retained").getAttribute("data-variant")
    ).toBe("secondary")
    expect(screen.getByText("Key intact").getAttribute("data-variant")).toBe(
      "secondary"
    )
    expect(screen.getByText("Not confirmed").getAttribute("data-variant")).toBe(
      "secondary"
    )
  })

  it("reads a record with no status, or an unknown one, as completed", () => {
    const old = { ...erasure(1) } as Partial<ErasureSummary>
    delete old.status
    render(
      <>
        <ErasureStatusBadge erasure={old as ErasureSummary} />
        <ErasureStatusBadge
          erasure={erasure(2, { status: "archived" as "pending" })}
        />
      </>
    )
    expect(screen.getAllByText("Completed")).toHaveLength(2)
    expect(screen.queryByText("Pending")).toBeNull()
  })

  it("says so when nothing has been erased, with a zero count", async () => {
    const c = scriptedClient({
      "erasures.list": { erasures: [], total: 0, hasMore: false },
    })
    renderPage(ErasuresPage, c.client)
    expect(
      await screen.findByText("No erasures have been requested in this scope.")
    ).toBeTruthy()
    expect(screen.getByText(/0 of 0 erasures/)).toBeTruthy()
  })

  it("pages by offset", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => erasure(i + 1))
    const c = paramsRecordingClient({
      "erasures.list": { erasures: rows, total: 120, hasMore: true },
    })
    renderPage(ErasuresPage, c.client)
    await screen.findByText("erasure_1")
    expect(c.calls[0]).toEqual({
      intent: "erasures.list",
      params: { limit: 50, offset: 0 },
    })
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(c.calls.some((q) => q.params?.offset === 50)).toBe(true)
    )
  })

  it("opens the request dialog from the header action, without counting anything", async () => {
    const c = scriptedClient({
      "erasures.list": { erasures: [erasure(1)], total: 1, hasMore: false },
    })
    render(
      <PluginProvider client={c.client}>
        <ErasuresPage params={{}} />
      </PluginProvider>
    )
    await screen.findByText("erasure_1")
    fireEvent.click(screen.getByRole("button", { name: "Request an erasure" }))
    expect(await screen.findByRole("alertdialog")).toBeTruthy()
    expect(screen.getByLabelText("Subject ID")).toBeTruthy()
    expect(c.queried.map((q) => q.intent)).toEqual(["erasures.list"])
  })

  it("agrees the caption's noun with a total of one", async () => {
    renderPage(
      ErasuresPage,
      scriptedClient({
        "erasures.list": { erasures: [erasure(1)], total: 1, hasMore: false },
      }).client
    )
    expect(await screen.findByText("1 of 1 erasure")).toBeTruthy()
  })
})
