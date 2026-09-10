import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { StreamingConfigPage } from "../src/pages/config"

const config = {
  backendType: "redis",
  distributed: true,
  nodeID: "node-1",
  features: { presence: true, moderation: false },
  limits: { maxRooms: 100 },
  timeouts: { idle: "30s" },
}

describe("StreamingConfigPage", () => {
  it("shows the deployment's own fields", async () => {
    renderPage(StreamingConfigPage, stubClient({ config }))
    await waitFor(() => expect(screen.getByText("redis")).toBeTruthy())
    expect(screen.getByText("node-1")).toBeTruthy()
  })

  it("renders every key of the open maps, including ones it has never heard of", async () => {
    renderPage(
      StreamingConfigPage,
      stubClient({
        config: {
          ...config,
          // A key added by a newer server than this UI was written against.
          limits: { maxRooms: 100, maxWidgetsPerFrobnicator: 7 },
        },
      }),
    )
    await waitFor(() => expect(screen.getByText("maxRooms")).toBeTruthy())
    // The whole point of iterating rather than hand-listing.
    expect(screen.getByText("maxWidgetsPerFrobnicator")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
  })

  it("says a map is empty rather than rendering a bare heading", async () => {
    renderPage(
      StreamingConfigPage,
      stubClient({ config: { ...config, timeouts: {} } }),
    )
    await waitFor(() => expect(screen.getByText("maxRooms")).toBeTruthy())
    expect(screen.getByText("No timeouts configured.")).toBeTruthy()
  })

  it("marks the node id as an identifier and says so when it is missing", async () => {
    renderPage(StreamingConfigPage, stubClient({ config }))
    await waitFor(() => expect(screen.getByText("node-1")).toBeTruthy())
    const nodeId = screen.getByText("node-1")
    expect(nodeId.className).toContain("font-mono")
    expect(nodeId.className).toContain("text-xs")

    renderPage(
      StreamingConfigPage,
      stubClient({ config: { ...config, backendType: undefined, nodeID: undefined } }),
    )
    await waitFor(() =>
      expect(screen.getAllByLabelText("No backend type reported").length).toBeGreaterThan(0),
    )
    expect(screen.getAllByLabelText("No node ID reported").length).toBeGreaterThan(0)
  })
})
