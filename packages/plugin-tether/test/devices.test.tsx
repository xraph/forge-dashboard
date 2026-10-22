import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { DevicesPanel } from "../src/pages/devices"
import {
  ACK,
  GATE,
  PASSWORD,
  READER,
  SENSOR,
  TENANT_ID,
  THERMO,
  credentials,
  devices,
  roles,
} from "./fixtures"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const Panel = () => <DevicesPanel tenantId={TENANT_ID} />

const READS = {
  "devices.list": devices(THERMO, GATE),
  "roles.list": roles(READER, SENSOR),
}

let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
})

function row(text: string): HTMLElement {
  return screen.getByText(text).closest("tr") as HTMLElement
}

function type(scope: HTMLElement, label: string | RegExp, value: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
}

/** Opens the provision dialog and fills in a name. */
async function openProvision() {
  await screen.findByText("Thermostat")
  fireEvent.click(screen.getByRole("button", { name: "Provision device" }))
  return screen.findByRole("dialog", { name: "Provision device" })
}

describe("DevicesPanel list", () => {
  it("reads the tenant's devices", async () => {
    const { client, queries } = recordingClient(READS)
    renderPage(Panel, client)
    await screen.findByText("Thermostat")
    expect(queries).toContainEqual({
      intent: "devices.list",
      params: { tenantId: TENANT_ID },
    })
    // The role list is only needed once a dialog asks for it.
    expect(queries.map((q) => q.intent)).not.toContain("roles.list")
  })

  it("renders IDs in font-mono text-xs and the caption count", async () => {
    renderPage(Panel, stubClient(READS))
    for (const id of [
      "tdev_01thermo",
      "akey_01thermo",
      "tdev_02gate",
      "akey_02gate",
      "gate-1",
    ]) {
      const cell = await screen.findByText(id)
      expect(cell.className, id).toContain("font-mono")
      expect(cell.className, id).toContain("text-xs")
    }
    expect(screen.getByText("2 devices")).toBeTruthy()
  })

  it("links each name to the device page", async () => {
    renderPage(Panel, stubClient(READS))
    const link = await screen.findByRole("link", { name: "Thermostat" })
    expect(link.getAttribute("href")).toBe(
      "/tenants/ttnt_01acme/devices/tdev_01thermo"
    )
  })

  it("shows roles as tags, and none when a device has none", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("Thermostat")
    expect(within(row("tdev_01thermo")).getByText("sensor")).toBeTruthy()
    expect(within(row("tdev_02gate")).getByLabelText("no roles")).toBeTruthy()
  })

  it("shows none for a device that is not locked to a client ID", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("Thermostat")
    expect(
      within(row("tdev_01thermo")).getByLabelText("no client ID")
    ).toBeTruthy()
  })

  it("names an empty list", async () => {
    renderPage(Panel, stubClient({ "devices.list": devices() }))
    expect(await screen.findByText("No devices yet.")).toBeTruthy()
  })

  it("warns when the page is full", async () => {
    renderPage(
      Panel,
      stubClient({
        "devices.list": { items: [THERMO, GATE], limit: 2, offset: 0 },
      })
    )
    expect(await screen.findByText(/first 2 devices/i)).toBeTruthy()
  })

  it("explains a refusal because the tenant is disabled", async () => {
    renderPage(
      Panel,
      failingClient(
        new ContractError("PERMISSION_DENIED", "tenant is disabled")
      )
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/PERMISSION_DENIED/)
    expect(alert.textContent).toMatch(/disabled/i)
  })
})

describe("DevicesPanel provision", () => {
  it("sends the form, then shows the credentials once", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.provision": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "sensor" })
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))

    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    expect(commands).toEqual([
      {
        intent: "devices.provision",
        payload: { tenantId: TENANT_ID, name: "Thermostat", roles: ["sensor"] },
      },
    ])
    expect(within(creds).getByText("akey_01thermo")).toBeTruthy()
    const secret = within(creds).getByText(PASSWORD)
    expect(secret.className).toContain("font-mono")
    expect(within(creds).getByText(/only time/i)).toBeTruthy()
  })

  it("sends the optional client ID and expiry when set", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.provision": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openProvision()
    type(dialog, "Name", "Gate")
    type(dialog, "Client ID", " gate-9 ")
    type(dialog, "Expires", "2027-01-02T03:04")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    await screen.findByRole("dialog", { name: "Device credentials" })
    const payload = commands[0].payload as Record<string, unknown>
    expect(payload.clientId).toBe("gate-9")
    expect(payload.expiresAt).toBe(new Date("2027-01-02T03:04").toISOString())
    expect(payload).not.toHaveProperty("roles")
  })

  it("refuses a blank name without sending anything", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.provision": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openProvision()
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /name is required/i
    )
    expect(commands).toHaveLength(0)
  })

  it("keeps the form and shows the refusal inside it", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.provision": () => {
          throw new ContractError("BAD_REQUEST", "unknown role")
        },
      })
    )
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/unknown role/)
    expect(
      (within(dialog).getByLabelText("Name") as HTMLInputElement).value
    ).toBe("Thermostat")
  })

  it("starts blank each time it opens, without the last refusal", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.provision": () => {
          throw new ContractError("BAD_REQUEST", "unknown role")
        },
      })
    )
    const first = await openProvision()
    type(first, "Name", "Thermostat")
    fireEvent.click(within(first).getByRole("button", { name: "Provision" }))
    await within(first).findByRole("alert")
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: "Provision device" }))
    const second = await screen.findByRole("dialog", {
      name: "Provision device",
    })
    expect(within(second).queryByRole("alert")).toBeNull()
    expect(
      (within(second).getByLabelText("Name") as HTMLInputElement).value
    ).toBe("")
  })

  it("reuses one idempotency key when the same form is sent again", async () => {
    const keys: (string | undefined)[] = []
    const client = recordingClient(READS, {
      "devices.provision": () => {
        throw new ContractError("UNAVAILABLE", "broker is not running")
      },
    })
    const original = client.client.command.bind(client.client)
    client.client.command = ((
      intent: string,
      payload?: unknown,
      opts?: { idempotencyKey?: string }
    ) => {
      keys.push(opts?.idempotencyKey)
      return original(intent, payload)
    }) as typeof client.client.command
    renderPage(Panel, client.client)
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    const send = () =>
      fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    send()
    await within(dialog).findByRole("alert")
    send()
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it("says what to do when the server already ran the request", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.provision": () => {
          throw new ContractError("CONFLICT", "command already ran", {
            reason: "idempotency.already_ran",
          })
        },
      })
    )
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/already ran/i)
    expect(alert.textContent).toMatch(/rotate/i)
  })

  it("never shows the password again once the credentials are closed", async () => {
    renderPage(Panel, stubClient(READS, { "devices.provision": credentials() }))
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    expect(within(creds).getByText(PASSWORD)).toBeTruthy()

    // Done stays locked until the operator says they have stored it.
    const done = within(creds).getByRole("button", { name: "Done" })
    expect((done as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(
      within(creds).getByRole("checkbox", { name: /stored these/i })
    )
    fireEvent.click(done)
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Device credentials" })
      ).toBeNull()
    )
    expect(document.body.textContent).not.toContain(PASSWORD)

    // Reopen the device's own dialogs: nothing brings it back.
    fireEvent.click(
      screen.getByRole("button", { name: "Edit roles of Thermostat" })
    )
    await screen.findByRole("dialog", { name: /roles of Thermostat/i })
    expect(document.body.textContent).not.toContain(PASSWORD)
  })

  it("does not let the credentials be dismissed before they are stored", async () => {
    renderPage(Panel, stubClient(READS, { "devices.provision": credentials() }))
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    await screen.findByRole("dialog", { name: "Device credentials" })
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" })
    await act(async () => {})
    expect(
      screen.getByRole("dialog", { name: "Device credentials" })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("copies the username and the password", async () => {
    renderPage(Panel, stubClient(READS, { "devices.provision": credentials() }))
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    await act(async () => {
      fireEvent.click(
        within(creds).getByRole("button", { name: "Copy password" })
      )
    })
    expect(writeText).toHaveBeenLastCalledWith(PASSWORD)
    await act(async () => {
      fireEvent.click(
        within(creds).getByRole("button", { name: "Copy username" })
      )
    })
    expect(writeText).toHaveBeenLastCalledWith("akey_01thermo")
  })

  it("says so when the clipboard is refused, without printing the secret in the message", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    renderPage(Panel, stubClient(READS, { "devices.provision": credentials() }))
    const dialog = await openProvision()
    type(dialog, "Name", "Thermostat")
    fireEvent.click(within(dialog).getByRole("button", { name: "Provision" }))
    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    await act(async () => {
      fireEvent.click(
        within(creds).getByRole("button", { name: "Copy password" })
      )
    })
    const status = within(creds).getByRole("status")
    expect(status.textContent).toMatch(/couldn.t copy/i)
    expect(status.textContent).not.toContain(PASSWORD)
  })
})

describe("DevicesPanel rotate", () => {
  async function openRotate(name = "Thermostat") {
    await screen.findByText(name)
    fireEvent.click(
      screen.getByRole("button", { name: `Rotate key of ${name}` })
    )
    return screen.findByRole("alertdialog", { name: /Rotate the key of/i })
  }

  it("rotates and shows the new password once", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.rotate": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openRotate()
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    const creds = await screen.findByRole("dialog", {
      name: "Device credentials",
    })
    expect(within(creds).getByText(PASSWORD)).toBeTruthy()
    // No grace typed: leave it off so keysmith's default applies.
    expect(commands).toEqual([
      {
        intent: "devices.rotate",
        payload: { tenantId: TENANT_ID, deviceId: "tdev_01thermo" },
      },
    ])
  })

  it("sends the grace period when one is typed", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.rotate": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openRotate()
    type(dialog, /Grace period/, "120")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    await screen.findByRole("dialog", { name: "Device credentials" })
    expect(commands[0].payload).toEqual({
      tenantId: TENANT_ID,
      deviceId: "tdev_01thermo",
      graceSeconds: 120,
    })
  })

  it("refuses a negative or fractional grace period", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.rotate": credentials(),
    })
    renderPage(Panel, client)
    const dialog = await openRotate()
    type(dialog, /Grace period/, "1.5")
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /whole number/i
    )
    expect(commands).toHaveLength(0)
  })

  it("shows the refusal for a revoked device inside the dialog", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.rotate": () => {
          throw new ContractError("CONFLICT", "device is revoked")
        },
      })
    )
    const dialog = await openRotate()
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/revoked/)
    expect(
      screen.queryByRole("dialog", { name: "Device credentials" })
    ).toBeNull()
  })

  it("disables the confirm button while the rotate is in flight", async () => {
    renderPage(
      Panel,
      stubClient(READS, { "devices.rotate": () => new Promise(() => {}) })
    )
    const dialog = await openRotate()
    fireEvent.click(within(dialog).getByRole("button", { name: "Rotate" }))
    const working = await within(dialog).findByRole("button", {
      name: "Working…",
    })
    expect((working as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("DevicesPanel revoke", () => {
  async function openRevoke(name = "Thermostat") {
    await screen.findByText(name)
    fireEvent.click(screen.getByRole("button", { name: `Revoke ${name}` }))
    return screen.findByRole("alertdialog", { name: /Revoke/ })
  }

  it("sends the reason when there is one", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.revoke": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openRevoke()
    type(dialog, "Reason", "stolen")
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "devices.revoke",
      payload: {
        tenantId: TENANT_ID,
        deviceId: "tdev_01thermo",
        reason: "stolen",
      },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("leaves the reason off when blank", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.revoke": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openRevoke()
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].payload).toEqual({
      tenantId: TENANT_ID,
      deviceId: "tdev_01thermo",
    })
  })

  it("keeps the dialog open and shows a failure inside it", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.revoke": () => {
          throw new ContractError("NOT_FOUND", "device not found")
        },
      })
    )
    const dialog = await openRevoke()
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /NOT_FOUND/
    )
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })
})

describe("DevicesPanel delete", () => {
  async function openDelete(name: string) {
    await screen.findByText(name)
    fireEvent.click(screen.getByRole("button", { name: `Delete ${name}` }))
    return screen.findByRole("alertdialog")
  }

  it("deletes the device it was opened for", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.delete": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openDelete("Gate controller")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "devices.delete",
      payload: { tenantId: TENANT_ID, deviceId: "tdev_02gate" },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("disables the confirm button while the delete is in flight", async () => {
    renderPage(
      Panel,
      stubClient(READS, { "devices.delete": () => new Promise(() => {}) })
    )
    const dialog = await openDelete("Gate controller")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const working = await within(dialog).findByRole("button", {
      name: "Working…",
    })
    expect((working as HTMLButtonElement).disabled).toBe(true)
  })

  it("does not show one device's failure on the next one's dialog", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.delete": () => {
          throw new ContractError("INTERNAL", "internal error")
        },
      })
    )
    const first = await openDelete("Gate controller")
    fireEvent.click(within(first).getByRole("button", { name: "Delete" }))
    await within(first).findByRole("alert")
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    const second = await openDelete("Thermostat")
    expect(within(second).queryByRole("alert")).toBeNull()
  })
})

describe("DevicesPanel roles", () => {
  async function openRoles(name = "Thermostat") {
    await screen.findByText(name)
    fireEvent.click(
      screen.getByRole("button", { name: `Edit roles of ${name}` })
    )
    return screen.findByRole("dialog", {
      name: new RegExp(`roles of ${name}`, "i"),
    })
  }

  it("offers the tenant's roles, checked for the ones the device holds", async () => {
    renderPage(Panel, stubClient(READS))
    const dialog = await openRoles()
    const sensor = await within(dialog).findByRole("checkbox", {
      name: "sensor",
    })
    const reader = within(dialog).getByRole("checkbox", { name: "reader" })
    expect(sensor.getAttribute("aria-checked")).toBe("true")
    expect(reader.getAttribute("aria-checked")).toBe("false")
  })

  it("replaces the whole set", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.roles.set": THERMO,
    })
    renderPage(Panel, client)
    const dialog = await openRoles()
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "reader" })
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Save roles" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "devices.roles.set",
      payload: {
        tenantId: TENANT_ID,
        deviceId: "tdev_01thermo",
        roles: ["reader", "sensor"],
      },
    })
  })

  it("sends an empty list to clear every role, never an absent one", async () => {
    const { client, commands } = recordingClient(READS, {
      "devices.roles.set": THERMO,
    })
    renderPage(Panel, client)
    const dialog = await openRoles()
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "sensor" })
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Save roles" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect((commands[0].payload as { roles: string[] }).roles).toEqual([])
  })

  it("shows a refusal inside the dialog", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "devices.roles.set": () => {
          throw new ContractError("BAD_REQUEST", "unknown role")
        },
      })
    )
    const dialog = await openRoles()
    fireEvent.click(
      await within(dialog).findByRole("checkbox", { name: "reader" })
    )
    fireEvent.click(within(dialog).getByRole("button", { name: "Save roles" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /unknown role/
    )
  })

  it("keeps a role the tenant no longer lists so it can be removed", async () => {
    renderPage(
      Panel,
      stubClient({
        "devices.list": devices({ ...THERMO, roles: ["retired"] }),
        "roles.list": roles(READER),
      })
    )
    const dialog = await openRoles()
    const retired = await within(dialog).findByRole("checkbox", {
      name: "retired",
    })
    expect(retired.getAttribute("aria-checked")).toBe("true")
  })
})
