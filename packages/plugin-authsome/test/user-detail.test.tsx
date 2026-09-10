import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, stubClient } from "./harness"
import { AuthUserDetailPage } from "../src/pages/user-detail"

// jsdom 25 ships no PointerEvent constructor at all. The kit Switch's click
// handler re-dispatches the click it receives as a `new PointerEvent(...)` at
// its hidden input, purely to carry the modifier keys along, so a MouseEvent
// satisfies every property that call actually reads. Without this, clicking
// the "Email verified" switch below throws "PointerEvent is not a
// constructor" before this file's own assertions ever run. Scoped to this
// file rather than the shared jsdom setup, matching
// packages/plugin-streaming/test/rooms.test.tsx, the first test in the repo
// to click a kit Switch.
if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error - MouseEvent covers every field dispatchClickWithModifiers reads.
  window.PointerEvent = window.MouseEvent
}

const answers = {
  "users.detail": {
    id: "u1", email: "ada@example.com", emailVerified: true,
    firstName: "Ada", lastName: "Lovelace", username: "ada",
    banned: false, createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z", phone: "+1", phoneVerified: false,
    banReason: "", banExpiresAt: "",
  },
  "sessions.list": {
    sessions: [
      { id: "s1", userId: "u1", ipAddress: "10.0.0.1", expiresAt: "2026-03-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z" },
    ],
  },
  "devices.list": {
    devices: [
      { id: "d1", userId: "u1", name: "laptop", browser: "Firefox", trusted: true, lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ],
  },
}

function renderDetail(client: Parameters<typeof PluginProvider>[0]["client"], id = "u1") {
  return render(
    <PluginProvider client={client}>
      <AuthUserDetailPage params={{ id }} />
    </PluginProvider>,
  )
}

describe("AuthUserDetailPage", () => {
  it("shows the user with their sessions and devices", async () => {
    renderDetail(stubClient(answers).client)
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ada Lovelace/ })).toBeTruthy())
    // The email renders twice by design: once as the page subtitle, once in
    // the description list, so this asserts presence rather than uniqueness.
    expect(screen.getAllByText("ada@example.com").length).toBeGreaterThan(0)
    expect(screen.getByText("10.0.0.1")).toBeTruthy()
    expect(screen.getByText("laptop")).toBeTruthy()
  })

  it("prints an en dash for the empty strings authsome sends for never-happened", async () => {
    renderDetail(stubClient(answers).client)
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ada Lovelace/ })).toBeTruthy())
    // banExpiresAt is "" on a user who is not banned. The epoch would be a lie.
    expect(screen.getAllByText("–").length).toBeGreaterThan(0)
  })

  it("sends only the fields that changed, and never an empty string for an untouched one", async () => {
    const { client, sent } = recordingCommandClient(answers, { "users.update": { ok: true } })
    renderDetail(client)
    await waitFor(() => expect(screen.getByLabelText("First name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Augusta" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // Pointer semantics: lastName and username were not touched, so they must
    // not appear at all. Sending "" would blank them.
    expect(sent[0]).toEqual({
      intent: "users.update",
      payload: { id: "u1", firstName: "Augusta" },
    })
  })

  it("keeps save disabled until something actually changes", async () => {
    renderDetail(stubClient(answers).client)
    await waitFor(() => expect(screen.getByLabelText("First name")).toBeTruthy())
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Augusta" } })
    expect(save.disabled).toBe(false)
  })

  it("sends a changed checkbox as a boolean, not a string", async () => {
    const { client, sent } = recordingCommandClient(answers, { "users.update": { ok: true } })
    renderDetail(client)
    await waitFor(() => expect(screen.getByLabelText("Email verified")).toBeTruthy())

    fireEvent.click(screen.getByLabelText("Email verified"))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ id: "u1", emailVerified: false })
  })

  it("says so plainly when the route carries no id", () => {
    render(
      <PluginProvider client={stubClient(answers).client}>
        <AuthUserDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No user selected.")).toBeTruthy()
  })
})
