import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthDevicesPage } from "../src/pages/devices"
import { AuthDeviceDetailPage } from "../src/pages/device-detail"

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
    // The Device column is what an operator reads to identify the row, the
    // same emphasis `users.tsx`'s email column and `roles.tsx`'s name
    // column already carry.
    expect(screen.getByText("laptop").className).toContain("font-medium")
    // Untrusted is the ordinary starting state for a device (like an
    // unverified email), not an alarm condition like a banned user, so it
    // takes `secondary` rather than `destructive` - matching the same
    // `trusted` field rendered in user-detail.tsx's embedded devices table.
    expect(screen.getByText("untrusted").className).toContain("bg-secondary")
  })

  it("announces a missing browser, os or ip instead of a bare dash", async () => {
    const { client } = stubClient({
      "devices.list": {
        devices: [
          { id: "d1", userId: "u1", name: "laptop", trusted: false,
            lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
        ],
      },
    })
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())
    expect(screen.getByLabelText("no browser")).toBeTruthy()
    expect(screen.getByLabelText("no os")).toBeTruthy()
    expect(screen.getByLabelText("no ip address")).toBeTruthy()
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
    // The count is information ("0 devices"), not something to drop just
    // because the table itself has nothing to show.
    expect(screen.getByText("0 devices")).toBeTruthy()
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
    const failure = await screen.findByRole("alert")
    expect(failure.textContent).toContain("cannot forget the current device")

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Forget phone" }))

    // phone has not been touched. laptop's failure must not show up here.
    expect(screen.getByText(/Forget phone\?/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("cannot forget the current device")).toBeNull()
  })

  it("names the row a failed trust belongs to, and drops it once a different row is trusted", async () => {
    const { client } = recordingCommandClient(
      { "devices.list": twoDevices },
      {
        "devices.trust": (payload?: unknown) =>
          (payload as { id: string }).id === "d1"
            ? new ContractError("VALIDATION", "cannot trust this device")
            : { ok: true },
      }
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Trust laptop" }))
    const failure = await screen.findByRole("alert")
    expect(failure.textContent).toContain("Could not trust laptop")
    expect(failure.textContent).toContain("cannot trust this device")

    // phone has not been touched yet. Trusting it must not still be showing
    // laptop's failure once it settles.
    fireEvent.click(screen.getByRole("button", { name: "Trust phone" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(screen.queryByText("cannot trust this device")).toBeNull()
  })
})

describe("AuthDeviceDetailPage", () => {
  const device = {
    id: "d1", userId: "u1", name: "laptop", type: "desktop", browser: "Firefox",
    os: "linux", ipAddress: "10.0.0.1", trusted: false,
    lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z",
  }

  // `devices.delete` invalidates `devices.list` only (never `devices.detail`),
  // so this page cannot learn from the store that the device it is showing
  // is gone. It has to leave on its own, the same way any other in-app link
  // in this package does: a plain navigation, here done imperatively via
  // `window.location.href` rather than a clicked `<a>`. jsdom does not
  // implement real navigation, and `window.location`'s setter only accepts a
  // `string`, so `Object.defineProperty` (typed `any`) swaps the whole
  // property for a plain stub object for the length of this test, restored
  // after the same way.
  const originalLocation = Object.getOwnPropertyDescriptor(window, "location")

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "" },
    })
  })

  afterEach(() => {
    if (originalLocation) Object.defineProperty(window, "location", originalLocation)
  })

  it("gives an untrusted device the same secondary treatment as the devices list, not the destructive one used for a banned user", async () => {
    const { client } = stubClient({ "devices.detail": device })
    renderPage(AuthDeviceDetailPage, client, { id: "d1" })
    await waitFor(() => expect(screen.getByText("untrusted")).toBeTruthy())
    expect(screen.getByText("untrusted").className).toContain("bg-secondary")
  })

  it("leaves the detail view once forgetting the device it is showing succeeds", async () => {
    const { client, sent } = recordingCommandClient(
      { "devices.detail": device },
      { "devices.delete": { ok: true } },
    )
    renderPage(AuthDeviceDetailPage, client, { id: "d1" })
    await waitFor(() => expect(screen.getByRole("button", { name: "Forget laptop" })).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Forget laptop" }))
    fireEvent.click(screen.getByRole("button", { name: "Forget" }))
    await waitFor(() => expect(sent).toHaveLength(1))

    // The operator must not be left looking at a deleted device with its
    // Trust and Forget buttons still live.
    await waitFor(() => expect(window.location.href).toBe("/@auth/devices"))
    expect(screen.queryByRole("button", { name: "Forget laptop" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Trust laptop" })).toBeNull()
  })
})
