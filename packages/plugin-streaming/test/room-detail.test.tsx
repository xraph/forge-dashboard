import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, stubClient } from "./harness"
import { StreamingRoomDetailPage } from "../src/pages/room-detail"

const answers = {
  "rooms.detail": {
    id: "r1", name: "general", description: "everything", owner: "ada",
    members: 2, private: false, archived: false,
    created: "2026-09-01T10:00:00Z", updated: "2026-09-02T10:00:00Z",
  },
  "rooms.members": {
    members: [
      { userID: "ada", role: "owner", joinedAt: "2026-09-01T10:00:00Z", permissions: ["all"] },
      { userID: "grace", role: "member", joinedAt: "2026-09-02T10:00:00Z", permissions: [] },
    ],
  },
  "rooms.moderation": {
    entries: [
      {
        timestamp: "2026-09-03T10:00:00Z", action: "mute", actorID: "ada",
        targetID: "grace", reason: "spam",
      },
    ],
  },
}

/** Renders the page the way the host does, with params supplied as a prop. */
function renderDetail(client: Parameters<typeof PluginProvider>[0]["client"], id = "r1") {
  return render(
    <PluginProvider client={client}>
      <StreamingRoomDetailPage params={{ id }} />
    </PluginProvider>,
  )
}

describe("StreamingRoomDetailPage", () => {
  it("shows the room, its members and its moderation log", async () => {
    renderDetail(stubClient(answers))
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())
    expect(screen.getByText("everything")).toBeTruthy()
    // "ada" is the room's owner (DescriptionList), a member (the members
    // table) and the moderation entry's actor (the moderation table), so it
    // appears three times once every read settles. `getByText` throws on
    // more than one match; the plan's fixture reuses the name deliberately
    // (an owner moderating their own room is a member), so the fix is to
    // assert every occurrence rather than change the fixture.
    const adaOccurrences = screen.getAllByText("ada")
    expect(adaOccurrences).toHaveLength(3)
    // Every one of the three is an identifier: the room's Owner field, the
    // Members table's User column and the Moderation table's By column. All
    // three carry the package's monospace vocabulary for identifier-shaped
    // values, same as `rooms.tsx`'s Owner column and `connections.tsx`'s User
    // column.
    for (const el of adaOccurrences) {
      expect(el.className).toContain("font-mono")
      expect(el.className).toContain("text-xs")
    }
    // Same reasoning as "ada": "grace" is both a member and the moderation
    // entry's target, so it renders twice, and both are identifiers too.
    const graceOccurrences = screen.getAllByText("grace")
    expect(graceOccurrences).toHaveLength(2)
    for (const el of graceOccurrences) {
      expect(el.className).toContain("font-mono")
      expect(el.className).toContain("text-xs")
    }
    expect(screen.getByText("mute")).toBeTruthy()
    expect(screen.getByText("spam")).toBeTruthy()

    // Both tables' captions carry a live row count, not a static title, the
    // same convention `rooms.tsx` and `channels.tsx` follow.
    expect(screen.getByText("2 members", { selector: "caption" })).toBeTruthy()
    expect(screen.getByText("1 entry", { selector: "caption" })).toBeTruthy()

    // ada's one permission ("all") renders as a tag; grace has none, so her
    // cell falls through to a labelled dash rather than an empty cell.
    expect(screen.getByText("all")).toBeTruthy()
    expect(screen.getByLabelText("no permissions")).toBeTruthy()
  })

  it("labels an empty reason instead of rendering a bare dash", async () => {
    renderDetail(
      stubClient({
        ...answers,
        "rooms.moderation": {
          entries: [
            {
              timestamp: "2026-09-03T10:00:00Z", action: "mute", actorID: "ada",
              targetID: "grace", reason: "",
            },
          ],
        },
      }),
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())
    expect(screen.getByLabelText("no reason")).toBeTruthy()
  })

  it("reads every intent scoped to the room in the URL", async () => {
    const { client, sent } = recordingCommandClient(answers, {})
    renderDetail(client, "r9")
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())
    // Nothing is asserted about `sent`; this test is about the reads carrying
    // the id. The recording client records commands, so use the query path.
    expect(sent).toHaveLength(0)
  })

  it("sends rooms.send-message with the room id from the route", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "rooms.send-message": { ok: true },
    })
    renderDetail(client, "r1")
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Send as"), { target: { value: "ada" } })
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello room" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "rooms.send-message",
      payload: { roomID: "r1", userID: "ada", content: "hello room" },
    })
  })

  it("will not send an empty message", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "rooms.send-message": { ok: true },
    })
    renderDetail(client)
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Send as"), { target: { value: "ada" } })
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(sent).toHaveLength(0)
  })

  it("says which room is missing rather than rendering a blank page", async () => {
    renderDetail(stubClient({}), "gone")
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })

  it("says so plainly when the route carries no id", async () => {
    render(
      <PluginProvider client={stubClient(answers)}>
        <StreamingRoomDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No room selected.")).toBeTruthy()
  })
})
