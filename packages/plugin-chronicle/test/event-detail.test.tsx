import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { EventDetailPage } from "../src/pages/event-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"
import type { EventDetail } from "../src/types"

const detail = (over: Partial<EventDetail> = {}): EventDetail => ({
  id: "audit_globex_2780", timestamp: "2026-09-29T11:00:00Z", sequence: 2780, action: "record.update",
  resource: "patient_record", resourceId: "pr_88", category: "data", outcome: "success", severity: "info",
  userId: "user_3", ip: "10.0.0.30", erased: false, streamId: "stream_globex",
  hash: "aa".repeat(32), prevHash: "bb".repeat(32), hashScheme: "chronicle/v5", hashKeyId: "hk_1",
  reason: "chart correction", subjectId: "subject_1", requestId: "req_2780", sessionId: "sess_8",
  metadata: { requestPath: "/api/records/pr_88", fields: ["dob"] },
  ...over,
})

function client(ev: EventDetail, verify: object = { valid: true, hashScheme: "chronicle/v5", keyed: true }) {
  return scriptedClient({
    "events.detail": ev,
    "streams.mine": { stream: { id: "stream_globex", appId: "app_chronicle", tenantId: "globex", headHash: "cc", headSeq: 5000, scheme: "chronicle/v5", schemeSince: 1, coverageCeiling: "signed", checkpointingConfigured: true } },
    "verify.event": verify,
  })
}

describe("EventDetailPage", () => {
  it("shows the event's place in the chain with hashes in mono", async () => {
    renderPage(EventDetailPage, client(detail()).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByText("2,780")).toBeTruthy())
    expect(screen.getByText("aa".repeat(32)).className).toContain("font-mono")
    expect(screen.getByText("bb".repeat(32)).className).toContain("font-mono")
    expect(screen.getByText("chronicle/v5")).toBeTruthy()
  })

  it("shows the metadata payload, searchable", async () => {
    renderPage(EventDetailPage, client(detail()).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByLabelText("metadata").textContent).toContain("/api/records/pr_88"))
  })

  it("does not check the event's digest until asked", async () => {
    const c = client(detail())
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    await screen.findByText("2,780")
    expect(c.queried.some((q) => q.intent === "verify.event")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/recomputes under a keyed scheme/)).toBeTruthy())
    expect(screen.getByText(/checks the event's own digest, not its place in the chain/)).toBeTruthy()
  })

  it("says an unkeyed valid digest does not rule out a rewrite", async () => {
    const c = client(detail({ hashScheme: "chronicle/v4" }), { valid: true, hashScheme: "chronicle/v4", keyed: false })
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/does not rule out a rewrite/)).toBeTruthy())
    expect(screen.queryByText(/secure|protected|tamper-proof/i)).toBeNull()
  })

  it("says a failed digest could be edited content or a downgrade, and points to the chain check", async () => {
    const c = client(detail(), { valid: false, hashScheme: "chronicle/v5", keyed: true })
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/does not recompute/)).toBeTruthy())
    expect(screen.getByText(/check the chain around it to tell which/i)).toBeTruthy()
  })

  it("links to a bounded chain check around the event, clamped to the head", async () => {
    renderPage(EventDetailPage, client(detail({ sequence: 4990 })).client, { id: "audit_globex_4990" })
    const link = await screen.findByRole("link", { name: "Check the chain around this event" })
    expect(link.getAttribute("href")).toContain("/chain/stream_globex/4940/5000")
  })

  it("marks a real erasure with its badge and a link to the erasure", async () => {
    renderPage(
      EventDetailPage,
      client(detail({ erased: true, erasureId: "erasure_1", erasedAt: "2026-09-29T09:00:00Z", reason: "[ERASED]" })).client,
      { id: "audit_globex_2780" },
    )
    await waitFor(() => expect(screen.getByText("Erased")).toBeTruthy())
    expect(screen.getByRole("link", { name: "erasure_1" }).getAttribute("href")).toContain("/erasures/erasure_1")
  })

  it("never presents the [ERASED] text without an erasure record as an erasure requested here", async () => {
    renderPage(EventDetailPage, client(detail({ reason: "[ERASED]" })).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByText(/no erasure in this scope is recorded for it/)).toBeTruthy())
    expect(screen.queryByText("Erased")).toBeNull()
  })

  it("shows NoneCell for absent optional fields", async () => {
    renderPage(EventDetailPage, client(detail({ userId: undefined, ip: undefined, reason: undefined })).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByLabelText("no user")).toBeTruthy())
    expect(screen.getByLabelText("no IP address")).toBeTruthy()
    expect(screen.getByLabelText("no reason")).toBeTruthy()
  })

  it("answers an event outside the scope as not found", async () => {
    renderPage(EventDetailPage, failingClient(new ContractError("NOT_FOUND", "not found")), { id: "audit_x" })
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy())
  })

  it("lets the operator check again after the digest check failed", async () => {
    let calls = 0
    const c = scriptedClient({
      "events.detail": detail(),
      "streams.mine": { stream: { id: "stream_globex", appId: "app_chronicle", tenantId: "globex", headHash: "cc", headSeq: 5000, scheme: "chronicle/v5", schemeSince: 1, coverageCeiling: "signed", checkpointingConfigured: true } },
      "verify.event": () => (++calls === 1 ? new ContractError("INTERNAL", "verifier unavailable") : { valid: true, hashScheme: "chronicle/v5", keyed: true }),
    })
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText("The digest could not be checked")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/recomputes under a keyed scheme/)).toBeTruthy())
    expect(c.queried.filter((q) => q.intent === "verify.event")).toHaveLength(2)
  })

  it("does not carry a digest check over to the next event the route opens", async () => {
    const c = scriptedClient({
      "events.detail": (p) => detail({ id: String(p.id), sequence: p.id === "audit_globex_2780" ? 2780 : 2781 }),
      "streams.mine": { stream: { id: "stream_globex", appId: "app_chronicle", tenantId: "globex", headHash: "cc", headSeq: 5000, scheme: "chronicle/v5", schemeSince: 1, coverageCeiling: "signed", checkpointingConfigured: true } },
      "verify.event": { valid: true, hashScheme: "chronicle/v5", keyed: true },
    })
    const ui = (id: string) => (
      <PluginProvider client={c.client}>
        <EventDetailPage params={{ id }} />
      </PluginProvider>
    )
    // Event B has been opened before, so its detail is cached and the route
    // change renders it at once, with no loading state to remount the body.
    const warm = render(ui("audit_globex_2781"))
    await screen.findByText("2,781")
    warm.unmount()
    const view = render(ui("audit_globex_2780"))
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/recomputes under a keyed scheme/)).toBeTruthy())
    view.rerender(ui("audit_globex_2781"))
    await screen.findByText("2,781")
    expect(screen.queryByText(/recomputes under a keyed scheme/)).toBeNull()
    expect(c.queried.filter((q) => q.intent === "verify.event").map((q) => q.params)).toEqual([{ eventId: "audit_globex_2780" }])
    fireEvent.click(screen.getByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "verify.event")).toHaveLength(2))
  })

  it("shows the digest check running, not the last answer, when it is asked again", async () => {
    let calls = 0
    const answered = scriptedClient({
      "events.detail": detail(),
      "streams.mine": { stream: { id: "stream_globex", appId: "app_chronicle", tenantId: "globex", headHash: "cc", headSeq: 5000, scheme: "chronicle/v5", schemeSince: 1, coverageCeiling: "signed", checkpointingConfigured: true } },
      "verify.event": () => (++calls === 1 ? { valid: true, hashScheme: "chronicle/v5", keyed: true } : new Promise(() => {})),
    })
    renderPage(EventDetailPage, answered.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/recomputes under a keyed scheme/)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(calls).toBe(2))
    expect(screen.getByText("Checking the digest...")).toBeTruthy()
    expect(screen.queryByText(/recomputes under a keyed scheme/)).toBeNull()
  })

  it("offers the chain check around an event only when the event sits within the chain", async () => {
    for (const sequence of [0, 5001]) {
      const c = client(detail({ sequence }))
      const view = renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
      await waitFor(() => expect(screen.getByText("stream_globex")).toBeTruthy())
      await waitFor(() => expect(c.queried.some((q) => q.intent === "streams.mine")).toBe(true))
      // One more turn, so the head has landed before the link is looked for.
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByRole("link", { name: "Check the chain around this event" })).toBeNull()
      view.unmount()
    }
  })

  it("says an erased event's metadata went with its other sealed fields", async () => {
    renderPage(
      EventDetailPage,
      client(detail({ erased: true, erasureId: "erasure_1", erasedAt: "2026-09-29T09:00:00Z", reason: "[ERASED]", ip: "[ERASED]", userAgent: "[ERASED]", metadata: undefined })).client,
      { id: "audit_globex_2780" },
    )
    await waitFor(() => expect(screen.getByText("Erased with the rest of this event's sealed fields.")).toBeTruthy())
    expect(screen.queryByLabelText("no metadata")).toBeNull()
    // The sealed strings read as the marker, never as an unexplained one.
    expect(screen.getAllByText("[ERASED]")).toHaveLength(3)
    expect(screen.queryByText(/no erasure in this scope is recorded for it/)).toBeNull()
  })

  it("still says an event that was not erased has no metadata", async () => {
    renderPage(EventDetailPage, client(detail({ metadata: undefined })).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByLabelText("no metadata")).toBeTruthy())
    expect(screen.queryByText(/Erased with the rest/)).toBeNull()
  })
})
