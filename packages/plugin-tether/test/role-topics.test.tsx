import { afterEach, describe, expect, it } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RolesPanel } from "../src/pages/role-topics"
import { ACK, READER, SENSOR, TENANT_ID, role, roles } from "./fixtures"
import {
  failingClient,
  recordingClient,
  renderPage,
  stubClient,
} from "./harness"

const Panel = () => <RolesPanel tenantId={TENANT_ID} />

const READS = {
  "roles.list": roles(READER, SENSOR),
  "roles.topics.get": (params: unknown) => {
    const slug = (params as { roleSlug: string }).roleSlug
    const found = [READER, SENSOR].find((r) => r.slug === slug)
    return found
      ? {
          roleSlug: found.slug,
          publish: found.publish,
          subscribe: found.subscribe,
        }
      : (() => {
          throw new ContractError("NOT_FOUND", "role not found")
        })()
  },
}

afterEach(() => cleanup())

/** The table row of a role, found by its slug cell. A parent cell can repeat a slug. */
function row(slug: string): HTMLElement {
  const found = Array.from(document.querySelectorAll("tbody tr")).find(
    (tr) => tr.querySelector("td")?.textContent === slug
  )
  if (!found) throw new Error(`no row for ${slug}`)
  return found as HTMLElement
}

function type(scope: HTMLElement, label: string | RegExp, value: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
}

async function openTopics(slug: string) {
  await screen.findByRole("button", { name: `Edit topics of ${slug}` })
  fireEvent.click(
    screen.getByRole("button", { name: `Edit topics of ${slug}` })
  )
  const dialog = await screen.findByRole("dialog", {
    name: new RegExp(`Topic permissions.*${slug}`),
  })
  // The form mounts once roles.topics.get has answered.
  await within(dialog).findByLabelText("Publish filters")
  return dialog
}

describe("RolesPanel list", () => {
  it("reads the tenant's roles", async () => {
    const { client, queries } = recordingClient(READS)
    renderPage(Panel, client)
    await screen.findByText("Sensor")
    expect(queries).toContainEqual({
      intent: "roles.list",
      params: { tenantId: TENANT_ID },
    })
  })

  it("shows slug in font-mono text-xs, name, parent and grants", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("Sensor")
    const sensor = within(row("sensor"))
    const slug = sensor.getByText("sensor")
    expect(slug.className).toContain("font-mono")
    expect(slug.className).toContain("text-xs")
    expect(sensor.getByText("Sensor")).toBeTruthy()
    expect(sensor.getByText("reader")).toBeTruthy()
    expect(sensor.getByText("devices/%c/up")).toBeTruthy()
    expect(sensor.getByText("devices/%c/down")).toBeTruthy()
    expect(screen.getByText("2 roles")).toBeTruthy()
  })

  it("shows none for no parent and no publish grants", async () => {
    renderPage(Panel, stubClient(READS))
    await screen.findByText("Reader")
    const reader = within(row("reader"))
    expect(reader.getByLabelText("no parent")).toBeTruthy()
    expect(reader.getByLabelText("no publish filters")).toBeTruthy()
  })

  it("names an empty list", async () => {
    renderPage(Panel, stubClient({ "roles.list": roles() }))
    expect(await screen.findByText("No roles yet.")).toBeTruthy()
  })

  it("shows a signed-out refusal with the way in", async () => {
    renderPage(
      Panel,
      failingClient(
        new ContractError("UNAUTHENTICATED", "authentication required")
      )
    )
    expect((await screen.findByRole("alert")).textContent).toMatch(/sign in/i)
  })
})

describe("RolesPanel topic permissions", () => {
  it("loads the role's rules through roles.topics.get", async () => {
    const { client, queries } = recordingClient(READS)
    renderPage(Panel, client)
    const dialog = await openTopics("sensor")
    expect(queries).toContainEqual({
      intent: "roles.topics.get",
      params: { tenantId: TENANT_ID, roleSlug: "sensor" },
    })
    expect(
      (within(dialog).getByLabelText("Publish filters") as HTMLTextAreaElement)
        .value
    ).toBe("devices/%c/up")
    expect(
      (
        within(dialog).getByLabelText(
          "Subscribe filters"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("devices/%c/down")
  })

  it("blocks the save of a # that is not last, and says why", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.topics.set": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openTopics("sensor")
    type(dialog, "Publish filters", "a/#/b")
    const message = await within(dialog).findByText(/# must be the last level/)
    expect(message.textContent).toMatch(/Line 1/)
    const save = within(dialog).getByRole("button", { name: "Save topics" })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(save)
    expect(commands).toHaveLength(0)
  })

  it("does not send on Enter either while a filter is invalid", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.topics.set": ACK,
    })
    renderPage(Panel, client)
    const dialog = await openTopics("sensor")
    type(dialog, "Publish filters", "a/#/b")
    await within(dialog).findByText(/# must be the last level/)
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement)
    await act(async () => {})
    expect(commands).toHaveLength(0)
  })

  it("blocks a + inside a level and a $share grant, in the subscribe list too", async () => {
    renderPage(Panel, stubClient(READS, { "roles.topics.set": ACK }))
    const dialog = await openTopics("sensor")
    type(dialog, "Subscribe filters", "ok/+\nbad/a+\n$share/g/x")
    expect(
      await within(dialog).findByText(/Line 2: .*\+ must occupy a whole level/)
    ).toBeTruthy()
    expect(within(dialog).getByText(/Line 3: .*\$share/)).toBeTruthy()
  })

  it("saves both lists as arrays", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.topics.set": {
        roleSlug: "sensor",
        publish: ["devices/%c/up", "alerts/+"],
        subscribe: [],
      },
    })
    renderPage(Panel, client)
    const dialog = await openTopics("sensor")
    type(dialog, "Publish filters", "devices/%c/up\n\n  alerts/+  ")
    type(dialog, "Subscribe filters", "")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save topics" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "roles.topics.set",
      // [] and not absent: the contract treats an absent list as BAD_REQUEST.
      payload: {
        tenantId: TENANT_ID,
        roleSlug: "sensor",
        publish: ["devices/%c/up", "alerts/+"],
        subscribe: [],
      },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows the server's refusal inside the dialog and keeps what was typed", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "roles.topics.set": () => {
          throw new ContractError(
            "BAD_REQUEST",
            "filter rejected by the broker"
          )
        },
      })
    )
    const dialog = await openTopics("sensor")
    type(dialog, "Publish filters", "x/y")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save topics" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /rejected by the broker/
    )
    expect(
      (within(dialog).getByLabelText("Publish filters") as HTMLTextAreaElement)
        .value
    ).toBe("x/y")
  })

  it("says a role that vanished is gone", async () => {
    renderPage(
      Panel,
      stubClient({
        ...READS,
        "roles.topics.get": () => {
          throw new ContractError("NOT_FOUND", "role not found")
        },
      })
    )
    await screen.findByRole("button", { name: "Edit topics of sensor" })
    fireEvent.click(
      screen.getByRole("button", { name: "Edit topics of sensor" })
    )
    const dialog = await screen.findByRole("dialog")
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /NOT_FOUND/
    )
  })

  it("explains the placeholders", async () => {
    renderPage(Panel, stubClient(READS))
    const dialog = await openTopics("sensor")
    expect(within(dialog).getByText("%c")).toBeTruthy()
    expect(within(dialog).getByText("%u")).toBeTruthy()
  })
})

describe("RolesPanel create", () => {
  async function openCreate() {
    await screen.findByText("Sensor")
    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    return screen.findByRole("dialog", { name: "Create role" })
  }

  it("sends the slug, name, parent and both lists", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.create": role({ slug: "gateway" }),
    })
    renderPage(Panel, client)
    const dialog = await openCreate()
    type(dialog, "Slug", "gateway")
    type(dialog, "Name", "Gateway")
    type(dialog, "Parent", "reader")
    type(dialog, "Publish filters", "gw/%c/up")
    type(dialog, "Subscribe filters", "gw/%c/down\nbroadcast/#")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "roles.create",
      payload: {
        tenantId: TENANT_ID,
        slug: "gateway",
        name: "Gateway",
        parentSlug: "reader",
        publish: ["gw/%c/up"],
        subscribe: ["gw/%c/down", "broadcast/#"],
      },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("leaves name and parent off when blank", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.create": role({ slug: "gateway" }),
    })
    renderPage(Panel, client)
    const dialog = await openCreate()
    type(dialog, "Slug", "gateway")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0].payload).toEqual({
      tenantId: TENANT_ID,
      slug: "gateway",
      publish: [],
      subscribe: [],
    })
  })

  it("lists the existing roles as parents", async () => {
    renderPage(Panel, stubClient(READS))
    const dialog = await openCreate()
    const parent = within(dialog).getByLabelText("Parent") as HTMLSelectElement
    expect([...parent.options].map((o) => o.value)).toEqual([
      "",
      "reader",
      "sensor",
    ])
  })

  it.each([
    ["", /slug is required/i],
    ["Bad Slug", /lower case/i],
    ["-lead", /lower case/i],
    ["a".repeat(64), /63/],
  ])("refuses the slug %j without sending", async (slug, message) => {
    const { client, commands } = recordingClient(READS, {
      "roles.create": role(),
    })
    renderPage(Panel, client)
    const dialog = await openCreate()
    type(dialog, "Slug", slug)
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      message
    )
    expect(commands).toHaveLength(0)
  })

  it("blocks invalid filters before sending", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.create": role(),
    })
    renderPage(Panel, client)
    const dialog = await openCreate()
    type(dialog, "Slug", "gateway")
    type(dialog, "Publish filters", "a/#/b")
    expect(
      await within(dialog).findByText(/# must be the last level/)
    ).toBeTruthy()
    const create = within(dialog).getByRole("button", { name: "Create role" })
    expect((create as HTMLButtonElement).disabled).toBe(true)
    expect(commands).toHaveLength(0)
  })

  it("does not send on Enter while a filter is invalid", async () => {
    const { client, commands } = recordingClient(READS, {
      "roles.create": role(),
    })
    renderPage(Panel, client)
    const dialog = await openCreate()
    type(dialog, "Slug", "gateway")
    type(dialog, "Subscribe filters", "a/b+")
    await within(dialog).findByText(/\+ must occupy a whole level/)
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement)
    await act(async () => {})
    expect(commands).toHaveLength(0)
  })

  it("shows a CONFLICT for a reused slug inside the dialog", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "roles.create": () => {
          throw new ContractError("CONFLICT", "role already exists")
        },
      })
    )
    const dialog = await openCreate()
    type(dialog, "Slug", "reader")
    fireEvent.click(within(dialog).getByRole("button", { name: "Create role" }))
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(
      /CONFLICT/
    )
    expect(
      (within(dialog).getByLabelText("Slug") as HTMLInputElement).value
    ).toBe("reader")
  })

  it("starts blank each time it opens", async () => {
    renderPage(Panel, stubClient(READS))
    const first = await openCreate()
    type(first, "Slug", "half-typed")
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    const second = await openCreate()
    expect(
      (within(second).getByLabelText("Slug") as HTMLInputElement).value
    ).toBe("")
  })
})

describe("RolesPanel delete", () => {
  async function openDelete(slug: string) {
    await screen.findByRole("button", { name: `Delete role ${slug}` })
    fireEvent.click(screen.getByRole("button", { name: `Delete role ${slug}` }))
    return screen.findByRole("alertdialog")
  }

  it("deletes the role by slug", async () => {
    const { client, commands } = recordingClient(READS, { "roles.delete": ACK })
    renderPage(Panel, client)
    const dialog = await openDelete("sensor")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(commands).toHaveLength(1))
    expect(commands[0]).toEqual({
      intent: "roles.delete",
      payload: { tenantId: TENANT_ID, roleSlug: "sensor" },
    })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("shows a CONFLICT for a role in use inside the dialog, which stays open", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "roles.delete": () => {
          throw new ContractError("CONFLICT", "role is held by a device")
        },
      })
    )
    const dialog = await openDelete("reader")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toMatch(/CONFLICT/)
    expect(alert.textContent).toMatch(/held by a device/)
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })

  it("disables confirm while in flight", async () => {
    renderPage(
      Panel,
      stubClient(READS, { "roles.delete": () => new Promise(() => {}) })
    )
    const dialog = await openDelete("sensor")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const working = await within(dialog).findByRole("button", {
      name: "Working…",
    })
    expect((working as HTMLButtonElement).disabled).toBe(true)
  })

  it("clears the last refusal when the dialog opens for another role", async () => {
    renderPage(
      Panel,
      stubClient(READS, {
        "roles.delete": () => {
          throw new ContractError("CONFLICT", "role is held by a device")
        },
      })
    )
    const first = await openDelete("reader")
    fireEvent.click(within(first).getByRole("button", { name: "Delete" }))
    await within(first).findByRole("alert")
    fireEvent.click(within(first).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    const second = await openDelete("sensor")
    expect(within(second).queryByRole("alert")).toBeNull()
  })
})
