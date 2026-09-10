import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { StreamingRoomsPage } from "../src/pages/rooms"
import type { RoomsList } from "../src/pages/rooms"
import {
  failingClient,
  pendingClient,
  recordingClient,
  recordingCommandClient,
  renderPage,
  stubClient,
} from "./harness"

// jsdom 25 ships no PointerEvent constructor at all. The kit Switch's click
// handler re-dispatches the click it receives as a `new PointerEvent(...)` at
// its hidden input, purely to carry the modifier keys along, so a MouseEvent
// satisfies every property that call actually reads. Without this, clicking
// the "Private" switch below throws "PointerEvent is not a constructor"
// before this file's own assertions ever run. Scoped to this file rather than
// the shared jsdom setup, since this is the first test in the repo to click a
// kit Switch.
if (typeof window.PointerEvent === "undefined") {
  // @ts-expect-error - MouseEvent covers every field dispatchClickWithModifiers reads.
  window.PointerEvent = window.MouseEvent
}

const START = "2026-09-06T09:00:00.000Z"

const rooms: RoomsList = {
  rooms: [
    {
      id: "room_1",
      name: "General",
      description: "General discussion",
      owner: "usr_1",
      members: 2,
      private: false,
      archived: false,
      created: START,
      updated: START,
    },
    {
      id: "room_2",
      name: "Support",
      description: "Support escalations",
      owner: "usr_2",
      members: 1,
      private: true,
      archived: true,
      created: START,
      updated: START,
    },
  ],
}

describe("StreamingRoomsPage", () => {
  it("renders a row per room, with the fields it was given", async () => {
    renderPage(StreamingRoomsPage, stubClient({ "rooms.list": rooms }))

    expect(await screen.findByText("General")).toBeDefined()
    expect(screen.getByText("Support")).toBeDefined()
    expect(screen.getByText("usr_1")).toBeDefined()
    expect(screen.getByText("usr_2")).toBeDefined()
    expect(screen.getByText("Rooms", { selector: "caption" })).toBeDefined()

    // The raw room id, so an operator can correlate a row with logs or a
    // support ticket without going through the name.
    expect(screen.getByText("room_1")).toBeDefined()
    expect(screen.getByText("room_2")).toBeDefined()

    // One row per room: the header row plus a row for each of the two rooms.
    // `ResourceTable` renders a real table now, unlike the old hand-rolled
    // markup, so counting rows through the table's own role is what stands in
    // for the old "2 rooms" caption text.
    expect(screen.getAllByRole("row")).toHaveLength(3)

    // The private flag is rendered as a word, not as raw true/false, and the
    // second room differs from the first so a swapped column shows up here.
    expect(screen.getByText("public")).toBeDefined()
    expect(screen.getByText("private")).toBeDefined()

    // Archived is its own fact, separate from visibility: room_2 is both
    // private AND archived, so both words must appear for it independently
    // of the visibility badge.
    expect(screen.getByText("active")).toBeDefined()
    expect(screen.getByText("archived")).toBeDefined()
  })

  it("reads the rooms.list intent and nothing else", async () => {
    const { client, intents } = recordingClient({ "rooms.list": rooms })
    renderPage(StreamingRoomsPage, client)

    await screen.findByText("General")
    expect(intents).toEqual(["rooms.list"])
  })

  it("says it is loading rather than rendering a blank pane", () => {
    renderPage(StreamingRoomsPage, pendingClient())

    const busy = screen.getByRole("status")
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(busy.getAttribute("aria-label")).toBe("Loading Rooms")
  })

  it("shows the contract error code and message when the read fails", async () => {
    renderPage(
      StreamingRoomsPage,
      failingClient(
        new ContractError("PERMISSION_DENIED", "streaming.read required")
      )
    )

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("PERMISSION_DENIED")
    expect(alert.textContent).toContain("streaming.read required")
  })

  it("shows the empty message instead of a headerless table", async () => {
    renderPage(StreamingRoomsPage, stubClient({ "rooms.list": { rooms: [] } }))

    await waitFor(() => expect(screen.getByText("No rooms yet.")).toBeDefined())
    expect(screen.queryByRole("table")).toBeNull()
  })
})

describe("StreamingRoomsPage writes", () => {
  it("sends rooms.create with exactly the fields the contract declares", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.create": { ok: true, id: "r2" } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("General")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New room" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "random" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "off topic" } })
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "grace" } })
    fireEvent.click(screen.getByLabelText("Private"))
    fireEvent.click(screen.getByRole("button", { name: "Create room" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("rooms.create")
    expect(sent[0].payload).toEqual({
      name: "random", description: "off topic", owner: "grace", private: true,
    })
  })

  it("will not submit a room with no name", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.create": { ok: true } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("General")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New room" }))
    const create = screen.getByRole("button", { name: "Create room" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    expect(sent).toHaveLength(0)
  })

  it("confirms before deleting and names the room being deleted", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.delete": { ok: true } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("General")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete General" }))
    // Nothing is sent until the confirm is pressed.
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/Delete “General”\?/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "rooms.delete", payload: { id: "room_1" } })
  })

  it("surfaces the server's own sentence when a write fails", async () => {
    const client = stubClient({ "rooms.list": rooms })
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("General")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete General" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    // stubClient was given no commands, so rooms.delete rejects NOT_FOUND.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("rooms.delete"),
    )
  })
})
