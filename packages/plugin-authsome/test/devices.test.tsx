import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthDevicesPage } from "../src/pages/devices"

const devicesAnswer = {
  devices: [
    { id: "d1", userId: "u1", name: "laptop", type: "desktop", browser: "Firefox",
      os: "linux", ipAddress: "10.0.0.1", trusted: false,
      lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  ],
}

describe("AuthDevicesPage", () => {
  it("lists devices with their trust state", async () => {
    renderPage(AuthDevicesPage, stubClient({ "devices.list": devicesAnswer }).client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())
    expect(screen.getByText("untrusted")).toBeTruthy()
  })

  it("trusts a device without a confirmation, because trusting is not destructive", async () => {
    const { client, sent } = recordingCommandClient(
      { "devices.list": devicesAnswer },
      { "devices.trust": { ok: true } },
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Trust laptop" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "devices.trust", payload: { id: "d1" } })
  })

  it("confirms before forgetting a device", async () => {
    const { client, sent } = recordingCommandClient(
      { "devices.list": devicesAnswer },
      { "devices.delete": { ok: true } },
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Forget laptop" }))
    expect(sent).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Forget" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "devices.delete", payload: { id: "d1" } })
  })

  it("says so when nobody has registered a device", async () => {
    renderPage(AuthDevicesPage, stubClient({ "devices.list": { devices: [] } }).client)
    await waitFor(() => expect(screen.getByText("No devices seen.")).toBeTruthy())
  })
})

describe("AuthDevicesPage stale command state across rows", () => {
  const twoDevices = {
    devices: [
      { id: "d1", userId: "u1", name: "laptop", type: "desktop", browser: "Firefox",
        os: "linux", ipAddress: "10.0.0.1", trusted: false,
        lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "d2", userId: "u2", name: "phone", type: "mobile", browser: "Safari",
        os: "ios", ipAddress: "10.0.0.2", trusted: false,
        lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ],
  }

  it("does not carry one device's forget error into another device's forget dialog", async () => {
    const { client } = recordingCommandClient(
      { "devices.list": twoDevices },
      {
        "devices.delete": (payload?: unknown) =>
          (payload as { id: string }).id === "d1"
            ? new ContractError("VALIDATION", "cannot forget the current device")
            : { ok: true },
      }
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Forget laptop" }))
    fireEvent.click(screen.getByRole("button", { name: "Forget" }))
    const failure = await screen.findByRole("alert", { hidden: true })
    expect(failure.textContent).toContain("cannot forget the current device")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Forget phone" }))

    // phone has not been touched. laptop's failure must not show up here.
    expect(screen.getByText(/Forget phone\?/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("cannot forget the current device")).toBeNull()
  })
})
