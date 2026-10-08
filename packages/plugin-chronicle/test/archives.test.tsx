import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ArchivesPage } from "../src/pages/archives"
import { renderPage, scriptedClient } from "./harness"
import type { ArchiveSummary } from "../src/types"

const archive = (
  n: number,
  over: Partial<ArchiveSummary> = {}
): ArchiveSummary => ({
  id: `archive_${n}`,
  policyId: "retpol_acme_debug",
  category: "debug",
  eventCount: 5000,
  fromTimestamp: "2026-06-01T00:00:00Z",
  toTimestamp: "2026-06-30T00:00:00Z",
  sinkName: "s3",
  sinkRef: `s3://audit-archive/acme/${n}.jsonl.gz`,
  tenantId: "acme",
  createdAt: "2026-09-29T10:00:00Z",
  ...over,
})

describe("ArchivesPage", () => {
  it("lists archives with ids, policies and sink references in mono and a live caption", async () => {
    const c = scriptedClient({
      "retention.archives": {
        archives: [archive(2), archive(1)],
        hasMore: false,
      },
    })
    renderPage(ArchivesPage, c.client)
    await waitFor(() => expect(screen.getByText("archive_2")).toBeTruthy())
    expect(screen.getByText("archive_2").className).toContain("font-mono")
    expect(screen.getAllByText("retpol_acme_debug")[0].className).toContain(
      "font-mono"
    )
    expect(
      screen.getByText("s3://audit-archive/acme/2.jsonl.gz").className
    ).toContain("font-mono")
    expect(screen.getAllByText("acme")[0].className).toContain("font-mono")
    expect(screen.getAllByText("5,000")).toHaveLength(2)
    expect(screen.getAllByText("s3")).toHaveLength(2)
    expect(screen.getByText("2 archives shown")).toBeTruthy()
    expect(c.queried).toEqual([
      { intent: "retention.archives", params: { limit: 50, offset: 0 } },
    ])
  })

  it("shows an absent sink reference as none, and an app-level archive as app level", async () => {
    const c = scriptedClient({
      "retention.archives": {
        archives: [archive(1, { sinkRef: undefined, tenantId: undefined })],
        hasMore: false,
      },
    })
    renderPage(ArchivesPage, c.client)
    await screen.findByText("archive_1")
    expect(screen.getByLabelText("no sink reference")).toBeTruthy()
    expect(screen.getByText("App level")).toBeTruthy()
  })

  it("names the wildcard category for what it is", async () => {
    const c = scriptedClient({
      "retention.archives": {
        archives: [archive(1, { category: "*" })],
        hasMore: false,
      },
    })
    renderPage(ArchivesPage, c.client)
    expect(await screen.findByText("Every category (*)")).toBeTruthy()
  })

  it("pages forward with hasMore and no invented total", async () => {
    const c = scriptedClient({
      "retention.archives": { archives: [archive(1)], hasMore: true },
    })
    renderPage(ArchivesPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(
        c.queried.filter((q) => q.intent === "retention.archives").pop()?.params
      ).toEqual({ limit: 50, offset: 50 })
    )
    expect(screen.queryByText(/of \d/)).toBeNull()
    expect(screen.queryByText(/total/)).toBeNull()
  })

  it("disables Next on the last page and Previous on the first", async () => {
    const c = scriptedClient({
      "retention.archives": { archives: [archive(1)], hasMore: false },
    })
    renderPage(ArchivesPage, c.client)
    await screen.findByText("archive_1")
    expect(
      screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen
        .getByRole("button", { name: "Previous page" })
        .hasAttribute("disabled")
    ).toBe(true)
  })

  it("goes back a page after going forward", async () => {
    const c = scriptedClient({
      "retention.archives": { archives: [archive(1)], hasMore: true },
    })
    renderPage(ArchivesPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(c.queried.at(-1)?.params).toEqual({ limit: 50, offset: 50 })
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Previous page" })
    )
    await waitFor(() =>
      expect(c.queried.at(-1)?.params).toEqual({ limit: 50, offset: 0 })
    )
  })

  it("says no run has archived anything, with the count at zero", async () => {
    const c = scriptedClient({
      "retention.archives": { archives: [], hasMore: false },
    })
    renderPage(ArchivesPage, c.client)
    await waitFor(() =>
      expect(
        screen.getByText("No retention run has archived anything yet.")
      ).toBeTruthy()
    )
    expect(screen.getByText("0 archives shown")).toBeTruthy()
  })

  it("counts one archive in the singular", async () => {
    renderPage(
      ArchivesPage,
      scriptedClient({
        "retention.archives": { archives: [archive(1)], hasMore: false },
      }).client
    )
    expect(await screen.findByText("1 archive shown")).toBeTruthy()
  })
})
