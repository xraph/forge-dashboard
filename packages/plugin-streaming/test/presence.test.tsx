import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { StreamingPresencePage } from "../src/pages/presence"

const answers = {
  "presence.list": {
    presence: [
      { userID: "ada", status: "online", lastSeen: "2026-09-08T10:00:00Z", rooms: ["r1"] },
    ],
  },
}

describe("StreamingPresencePage", () => {
  it("lists everyone with a presence record", async () => {
    renderPage(StreamingPresencePage, stubClient(answers))
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())
    expect(screen.getByText("online")).toBeTruthy()
  })

  it("sends presence.set with the user and the chosen status", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "presence.set": { ok: true },
    })
    renderPage(StreamingPresencePage, client)
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "Status for ada" }), {
      target: { value: "away" },
    })

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "presence.set",
      payload: { userID: "ada", status: "away" },
    })
  })

  it("shows why an override failed and leaves the row alone", async () => {
    renderPage(StreamingPresencePage, stubClient(answers))
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "Status for ada" }), {
      target: { value: "away" },
    })

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("presence.set"),
    )

    // The select is driven off the server's own record, not off what the
    // operator picked. A failed override must leave the row showing what the
    // status actually is, not what the operator hoped it would become.
    expect(
      (screen.getByRole("combobox", { name: "Status for ada" }) as HTMLSelectElement).value,
    ).toBe("online")
  })

  it("says so when nobody has a presence record", async () => {
    renderPage(StreamingPresencePage, stubClient({ "presence.list": { presence: [] } }))
    await waitFor(() => expect(screen.getByText("No presence records.")).toBeTruthy())
  })
})
