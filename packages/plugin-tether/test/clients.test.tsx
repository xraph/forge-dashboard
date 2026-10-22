import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ClientsPanel } from "../src/pages/clients"
import { ACK, OFFLINE, ONLINE, TENANT_ID, clients } from "./fixtures"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const Panel = () => <ClientsPanel tenantId={TENANT_ID} />

const READS = { "clients.list": clients(ONLINE, OFFLINE) }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function row(id: string): HTMLElement {
  return screen.getByText(id).closest("tr") as HTMLElement
}

describe("ClientsPanel list", () => {
  it("reads the tenant's clients", async () => {
    const { client, queries } = recordingClient(READS)
    renderPage(Panel, client)
    await screen.findByText("thermo-1")
    expect(queries).toContainEqual({
      intent: "clients.list",
      params: { tenantId: TENANT_ID },
    })
  })

  it("renders IDs in font-mono text-xs and the caption count", async () => {
    renderPage(Panel, stubClient(READS))
    for (const id of [
      "thermo-1",
      "gate-1",
      "akey_01thermo",
      "10.0.0.7:51234",
    ]) {
      const cell = await screen.findByText(id)
      expect(cell.className, id).toContain("font-mono")
      expect(cell.className, id).toContain("text-xs")
    }
    expect(screen.getByText("2 clients")).toBeTruthy()
  })

  it("marks connected and offline sessions", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("thermo-1")
    expect(within(row("thermo-1")).getByText("connected")).toBeTruthy()
    expect(within(row("gate-1")).getByText("offline")).toBeTruthy()
  })

  it("shows none for the remote and connected time of an offline session", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("gate-1")
    const offline = row("gate-1")
    expect(within(offline).getByLabelText("no remote address")).toBeTruthy()
    expect(within(offline).getByLabelText("no connection time")).toBeTruthy()
    const online = row("thermo-1")
    expect(within(online).queryByLabelText("no remote address")).toBeNull()
  })

  it("names the protocol and links the device", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("thermo-1")
    expect(within(row("thermo-1")).getByText("MQTT 5")).toBeTruthy()
    expect(within(row("gate-1")).getByText("MQTT 3.1.1")).toBeTruthy()
    const link = within(row("thermo-1")).getByRole("link", {
      name: "tdev_01thermo",
    })
    expect(link.getAttribute("href")).toBe(
      "/tenants/ttnt_01acme/devices/tdev_01thermo"
    )
    expect(link.className).toContain("font-mono")
  })

  it("counts subscriptions and says when a session ends with the connection", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("thermo-1")
    expect(within(row("thermo-1")).getByText("1")).toBeTruthy()
    expect(within(row("thermo-1")).getByText("1 hour")).toBeTruthy()
    expect(within(row("gate-1")).getByText("Ends on disconnect")).toBeTruthy()
  })

  it("shows none for a client with no device or username", async () => {
    renderPage(
      Panel,
      stubClient({
        "clients.list": clients({
          ...ONLINE,
          deviceId: undefined,
          username: undefined,
        }),
      })
    )
    const online = (await screen.findByText("thermo-1")).closest(
      "tr"
    ) as HTMLElement
    expect(within(online).getByLabelText("no device")).toBeTruthy()
    expect(within(online).getByLabelText("no username")).toBeTruthy()
  })

  it("names an empty list", async () => {
    renderPage(Panel, stubClient({ "clients.list": clients() }))
    expect(await screen.findByText("No clients on this node.")).toBeTruthy()
  })

  it("says the broker is down when it is", async () => {
    renderPage(
      Panel,
      failingClient(
        new ContractError(
          "UNAVAILABLE",
          "broker is not running",
          undefined,
          true
        )
      )
    )
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/UNAVAILABLE/)
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy()
  })
})

describe("ClientsPanel polling", () => {
  it("polls clients.list every 10 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    const { client, queries } = recordingClient(READS)
    renderPage(Panel, client)
    await screen.findByText("thermo-1")
    expect(queries).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(9_999)
    })
    expect(queries).toHaveLength(1)
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(queries).toHaveLength(2)
  })

  it("keeps the rows on screen while a poll is in flight", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
    let calls = 0
    renderPage(
      Panel,
      stubClient({
        "clients.list": () => {
          calls += 1
          return calls === 1 ? clients(ONLINE) : new Promise(() => {})
        },
      })
    )
    await screen.findByText("thermo-1")
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByText("thermo-1")).toBeTruthy()
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull()
  })
})

describe("ClientsPanel kick", () => {
  it("kicks a connected client", async () => {
    const { client, commands } = recordingClient(READS, { "clients.kick": ACK })
    renderPage(Panel, client)
    await screen.findByText("thermo-1")
    fireEvent.click(screen.getByRole("button", { name: "Kick thermo-1" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "clients.kick",
      payload: { tenantId: TENANT_ID, clientId: "thermo-1" },
    })
  })

  it("offers no kick for an offline session", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("gate-1")
    expect(screen.queryByRole("button", { name: "Kick gate-1" })).toBeNull()
    expect(
      screen.getByRole("button", { name: "Delete session gate-1" })
    ).toBeTruthy()
  })

  it("shows a failed kick on the page", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "clients.kick": () => {
          throw new ContractError("NOT_FOUND", "client not found")
        },
      })
    )
    await screen.findByText("thermo-1")
    fireEvent.click(screen.getByRole("button", { name: "Kick thermo-1" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toMatch(/Could not kick thermo-1/)
    expect(alert.textContent).toMatch(/NOT_FOUND/)
  })
})

describe("ClientsPanel delete session", () => {
  async function openDelete(id: string) {
    await screen.findByText(id)
    fireEvent.click(
      screen.getByRole("button", { name: `Delete session ${id}` })
    )
    return screen.findByRole("alertdialog")
  }

  it("confirms, then deletes the session", async () => {
    const { client, commands } = recordingClient(READS, {
      "sessions.delete": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openDelete("gate-1")
    expect(commands).toHaveLength(0)
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete session" })
    )
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "sessions.delete",
      payload: { tenantId: TENANT_ID, clientId: "gate-1" },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("disables confirm while in flight", async () => {
    renderPage(
      Panel,
      stubClient(READS, { "sessions.delete": () => new Promise(() => {}) })
    )
    const dialog = await openDelete("gate-1")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete session" })
    )
    const working = await within(dialog).findByRole("button", {
      name: "Working…",
    })
    expect((working as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows a CONFLICT inside the dialog, which stays open", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "sessions.delete": () => {
          throw new ContractError("CONFLICT", "session is busy")
        },
      })
    )
    const dialog = await openDelete("gate-1")
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete session" })
    )
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/CONFLICT/)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("clears the last refusal when the dialog opens for another client", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "sessions.delete": () => {
          throw new ContractError("CONFLICT", "session is busy")
        },
      })
    )
    const first = await openDelete("gate-1")
    fireEvent.click(
      within(first).getByRole("button", { name: "Delete session" })
    )
    await within(first).findByRole("alert")
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    const second = await openDelete("thermo-1")
    expect(within(second).queryByRole("alert")).toBeNull()
  })
})
