import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthWebhooksPage } from "../src/pages/webhooks"

// jsdom 25 ships no PointerEvent constructor at all. The kit Switch's click
// handler re-dispatches the click it receives as a `new PointerEvent(...)` at
// its hidden input, purely to carry the modifier keys along, so a MouseEvent
// satisfies every property that call actually reads. Without this, clicking
// the active toggle below throws "PointerEvent is not a constructor" before
// this file's own assertions ever run. Scoped to this file, matching
// `test/user-detail.test.tsx`.
if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error - MouseEvent covers every field dispatchClickWithModifiers reads.
  window.PointerEvent = window.MouseEvent
}

const webhooksAnswer = {
  webhooks: [
    {
      id: "w1",
      url: "https://example.com/hook",
      events: ["user.created", "user.deleted"],
      active: true,
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
}

describe("AuthWebhooksPage", () => {
  it("lists webhooks with their events joined", async () => {
    const { client } = stubClient({ "webhooks.list": webhooksAnswer })
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())
    expect(screen.getByText("user.created, user.deleted")).toBeTruthy()
  })

  it("shows a dash for a webhook with no events", async () => {
    const { client } = stubClient({
      "webhooks.list": { webhooks: [{ ...webhooksAnswer.webhooks[0], events: [] }] },
    })
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())
    // kit's `NoneCell`, not a hand-rolled one: the label names the field
    // rather than announcing a bare "None" to assistive tech.
    expect(screen.getByLabelText("no events")).toBeTruthy()
  })

  it("toggling active sends only the id and the new active value", async () => {
    const { client, sent } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.update": { ok: true } },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByLabelText("Toggle active for https://example.com/hook"))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "webhooks.update",
      payload: { id: "w1", active: false },
    })
  })

  it("editing a URL sends only the id and the url, never the events", async () => {
    const { client, sent } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.update": { ok: true } },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Edit https://example.com/hook" }))
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/hook2" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "webhooks.update",
      payload: { id: "w1", url: "https://example.com/hook2" },
    })
    // Presence, not value: asserting `"events" in payload` is false is the
    // only thing that actually pins pointer semantics. Asserting the events
    // value equals the old array would pass even if the bug re-sent it.
    expect("events" in (sent[0].payload as Record<string, unknown>)).toBe(false)
  })

  it("splits and trims a comma-separated events list, dropping empties", async () => {
    const { client, sent } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.update": { ok: true } },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Edit https://example.com/hook" }))
    fireEvent.change(screen.getByLabelText("Events"), {
      target: { value: " user.created ,, user.updated ,user.deleted " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "webhooks.update",
      // Compared here as the joined string too, so a future refactor that
      // rebuilds an equivalent-but-not-identical array cannot silently break
      // this assertion the way `===` would on the arrays themselves.
      payload: { id: "w1", events: ["user.created", "user.updated", "user.deleted"] },
    })
    expect((sent[0].payload as { events: string[] }).events.join(",")).toBe(
      "user.created,user.updated,user.deleted",
    )
  })

  it("does not resend events unchanged, only reformatted", async () => {
    const { client, sent } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.update": { ok: true } },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Edit https://example.com/hook" }))
    // Same events, just re-typed with different spacing.
    fireEvent.change(screen.getByLabelText("Events"), {
      target: { value: "user.created,user.deleted" },
    })
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://example.com/hook3" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect("events" in (sent[0].payload as Record<string, unknown>)).toBe(false)
  })

  it("resets a stale error when a different row's edit panel opens", async () => {
    const { client, sent } = recordingCommandClient(
      {
        "webhooks.list": {
          webhooks: [
            webhooksAnswer.webhooks[0],
            {
              id: "w2",
              url: "https://example.com/second",
              events: [],
              active: false,
              createdAt: "2026-01-02T00:00:00Z",
            },
          ],
        },
      },
      { "webhooks.update": new ContractError("VALIDATION", "url is not reachable") },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Edit https://example.com/hook" }))
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://bad" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(screen.getByText("url is not reachable")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Edit https://example.com/second" }))

    expect(screen.queryByText("url is not reachable")).toBeNull()
  })

  it("confirms before deleting a webhook", async () => {
    const { client, sent } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.delete": { ok: true } },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete webhook https://example.com/hook" }))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/stops receiving events immediately/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "webhooks.delete", payload: { id: "w1" } })
  })

  it("shows the server's reason and leaves the delete dialog open when the delete fails", async () => {
    const { client } = recordingCommandClient(
      { "webhooks.list": webhooksAnswer },
      { "webhooks.delete": new ContractError("VALIDATION", "webhook is referenced elsewhere") },
    )
    renderPage(AuthWebhooksPage, client)
    await waitFor(() => expect(screen.getByText("https://example.com/hook")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete webhook https://example.com/hook" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    // The alert lives inside the open dialog's own description, so it is
    // reachable without reaching past Base UI's `aria-hidden` on the rest of
    // the page.
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Could not delete")
    expect(alert.textContent).toContain("webhook is referenced elsewhere")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })
})
