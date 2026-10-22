import { afterEach, describe, expect, it } from "vitest"
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { DeviceDetailPage } from "../src/pages/device-detail"
import {
  ACK,
  GATE,
  PASSWORD,
  READER,
  SENSOR,
  TENANT_ID,
  THERMO,
  credentials,
  device,
  roles,
} from "./fixtures"
import { recordingClient, renderPage, stubClient } from "./harness"

const PARAMS = { tenantId: TENANT_ID, deviceId: "tdev_01thermo" }

const READS = {
  "devices.get": THERMO,
  "roles.list": roles(READER, SENSOR),
}

afterEach(() => cleanup())

describe("DeviceDetailPage", () => {
  it("reads the device by tenant and ID", async () => {
    const { client, queries } = recordingClient(READS)
    renderPage(DeviceDetailPage, client, PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    expect(queries).toContainEqual({
      intent: "devices.get",
      params: { tenantId: TENANT_ID, deviceId: "tdev_01thermo" },
    })
  })

  it("renders the IDs in font-mono text-xs", async () => {
    renderPage(DeviceDetailPage, stubClient(READS), PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    for (const id of ["tdev_01thermo", TENANT_ID]) {
      const cell = screen.getByText(id)
      expect(cell.className, id).toContain("font-mono")
      expect(cell.className, id).toContain("text-xs")
    }
  })

  it("links the key to keysmith's key page", async () => {
    renderPage(DeviceDetailPage, stubClient(READS), PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    const link = screen.getByRole("link", { name: "akey_01thermo" })
    expect(link.getAttribute("href")).toBe("/@keysmith/keys/akey_01thermo")
    expect(link.className).toContain("font-mono")
  })

  it("links the warden subject the device's roles are granted to", async () => {
    renderPage(DeviceDetailPage, stubClient(READS), PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    const link = screen.getByRole("link", { name: "api_key:akey_01thermo" })
    expect(link.getAttribute("href")).toBe(
      "/@warden/subjects/api_key/akey_01thermo"
    )
  })

  it("shows roles, and none for a device without roles or a locked client ID", async () => {
    renderPage(
      DeviceDetailPage,
      stubClient({ ...READS, "devices.get": device({ roles: [] }) }),
      PARAMS
    )
    await screen.findByRole("heading", { name: "Thermostat" })
    expect(screen.getByLabelText("no roles")).toBeTruthy()
    expect(screen.getByLabelText("no client ID")).toBeTruthy()
  })

  it("shows a locked client ID", async () => {
    renderPage(
      DeviceDetailPage,
      stubClient({ ...READS, "devices.get": GATE }),
      { tenantId: TENANT_ID, deviceId: "tdev_02gate" }
    )
    const id = await screen.findByText("gate-1")
    expect(id.className).toContain("font-mono")
  })

  it("links back to the tenant", async () => {
    renderPage(DeviceDetailPage, stubClient(READS), PARAMS)
    const back = await screen.findByRole("link", { name: /back to tenant/i })
    expect(back.getAttribute("href")).toBe("/tenants/ttnt_01acme")
  })

  it("shows NOT_FOUND for a device that is not this tenant's", async () => {
    renderPage(
      DeviceDetailPage,
      stubClient({
        "devices.get": () => {
          throw new ContractError("NOT_FOUND", "device not found")
        },
      }),
      PARAMS
    )
    expect((await screen.findByRole("alert")).textContent).toMatch(/NOT_FOUND/)
  })

  it("rotates and shows the password once, never on the page itself", async () => {
    renderPage(
      DeviceDetailPage,
      stubClient(READS, { "devices.rotate": credentials() }),
      PARAMS
    )
    await screen.findByRole("heading", { name: "Thermostat" })
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Rotate" }))
    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    expect(within(creds).getByText(PASSWORD)).toBeTruthy()
    fireEvent.click(
      within(creds).getByRole("checkbox", { name: /stored these/i })
    )
    fireEvent.click(within(creds).getByRole("button", { name: "Done" }))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Device credentials" })
      ).toBeNull()
    )
    expect(document.body.textContent).not.toContain(PASSWORD)
  })

  it("edits roles from the page", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.roles.set": THERMO,
    })
    renderPage(DeviceDetailPage, client, PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    fireEvent.click(screen.getByRole("button", { name: "Edit roles" }))
    const dialog = await screen.findByRole("dialog", {
      name: /roles of Thermostat/i,
    })
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "reader" })
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Save roles" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].payload).toEqual({
      tenantId: TENANT_ID,
      deviceId: "tdev_01thermo",
      roles: ["reader", "sensor"],
    })
  })

  it("revokes from the page", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.revoke": ACK,
    })
    renderPage(DeviceDetailPage, client, PARAMS)
    await screen.findByRole("heading", { name: "Thermostat" })
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].intent).toBe("devices.revoke")
  })

  it("deletes from the page and leaves for the tenant", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.delete": ACK,
    })
    const assigned: string[] = []
    const original = window.location
    // PluginLink's standalone fallback navigates with location.href.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        get href() {
          return original.href
        },
        set href(v: string) {
          assigned.push(v)
        },
        replace: (v: string) => assigned.push(v),
      },
    })
    try {
      renderPage(DeviceDetailPage, client, PARAMS)
      await screen.findByRole("heading", { name: "Thermostat" })
      fireEvent.click(screen.getByRole("button", { name: "Delete device" }))
      const dialog = await screen.findByRole("alertdialog")
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
      await waitFor(() => expect(commands).toHaveLength(1))
      expect(commands[0].payload).toEqual({
        tenantId: TENANT_ID,
        deviceId: "tdev_01thermo",
      })
      await waitFor(() => expect(assigned).toContain("/tenants/ttnt_01acme"))
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      })
    }
  })

  it("keeps the delete dialog open and shows a refusal inside it", async () => {
    renderPage(
      DeviceDetailPage,
      stubClient(READS, {
        "devices.delete": () => {
          throw new ContractError("INTERNAL", "internal error")
        },
      }),
      PARAMS
    )
    await screen.findByRole("heading", { name: "Thermostat" })
    fireEvent.click(screen.getByRole("button", { name: "Delete device" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /INTERNAL/
    )
  })
})
