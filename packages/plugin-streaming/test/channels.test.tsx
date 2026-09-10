import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { StreamingChannelsPage } from "../src/pages/channels"

describe("StreamingChannelsPage", () => {
  it("lists channels with their subscriber and message counts", async () => {
    renderPage(
      StreamingChannelsPage,
      stubClient({
        "channels.list": {
          channels: [
            { id: "c1", name: "alerts", subscriberCount: 12, messageCount: 400 },
          ],
        },
      }),
    )
    await waitFor(() => expect(screen.getByText("alerts")).toBeTruthy())
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("400")).toBeTruthy()

    // The Name column is the one an operator reads, so it carries the same
    // emphasis as `rooms.tsx`'s Name column.
    expect(screen.getByText("alerts").className).toContain("font-medium")

    // The raw channel id, so an operator can correlate a row with logs or a
    // support ticket without going through the name, same as rooms and users.
    const id = screen.getByText("c1")
    expect(id.className).toContain("font-mono")
    expect(id.className).toContain("text-xs")

    // The caption carries a live row count.
    expect(screen.getByText("1 channel", { selector: "caption" })).toBeTruthy()
  })

  it("pluralizes the caption's row count", async () => {
    renderPage(
      StreamingChannelsPage,
      stubClient({
        "channels.list": {
          channels: [
            { id: "c1", name: "alerts", subscriberCount: 12, messageCount: 400 },
            { id: "c2", name: "general", subscriberCount: 3, messageCount: 9 },
          ],
        },
      }),
    )
    await waitFor(() => expect(screen.getByText("alerts")).toBeTruthy())
    expect(screen.getByText("2 channels", { selector: "caption" })).toBeTruthy()
  })

  it("says so when there are no channels", async () => {
    renderPage(StreamingChannelsPage, stubClient({ "channels.list": { channels: [] } }))
    await waitFor(() => expect(screen.getByText("No channels yet.")).toBeTruthy())
  })
})
