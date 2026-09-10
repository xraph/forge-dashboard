import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { StreamingRoomsPage } from "../src/pages/rooms"
import type { RoomsList } from "../src/pages/rooms"
import {
  failingClient,
  pendingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

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

    // One row per room: the header row plus a row for each of the two rooms.
    // `ResourceTable` renders a real table now, unlike the old hand-rolled
    // markup, so counting rows through the table's own role is what stands in
    // for the old "2 rooms" caption text.
    expect(screen.getAllByRole("row")).toHaveLength(3)

    // The private flag is rendered as a word, not as raw true/false, and the
    // second room differs from the first so a swapped column shows up here.
    expect(screen.getByText("public")).toBeDefined()
    expect(screen.getByText("private")).toBeDefined()
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
