import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenResourceTypesPage } from "../src/pages/resource-types"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage as renderPageRaw,
  stubClient,
} from "./harness"

/**
 * The page opens on the graph (see resource-types-graph.test.tsx), and every
 * test in this file is about the table, so it starts by switching to it.
 */
function renderPage(...args: Parameters<typeof renderPageRaw>) {
  const view = renderPageRaw(...args)
  fireEvent.click(screen.getByRole("button", { name: "Table" }))
  return view
}

// Three types, one per shape that matters: a rooted type with both kinds of
// definition, a namespaced one, and a bare one with neither. The counts are
// distinct so a swapped column cannot pass.
const TYPES = {
  items: [
    {
      id: "rt_doc",
      namespacePath: "",
      name: "document",
      description: "a file",
      relationCount: 3,
      permissionCount: 5,
      createdAt: "2026-09-01T00:00:00Z",
      updatedAt: "2026-09-02T00:00:00Z",
    },
    {
      id: "rt_folder",
      namespacePath: "eng/platform",
      name: "folder",
      relationCount: 1,
      permissionCount: 2,
      createdAt: "2026-09-03T00:00:00Z",
      updatedAt: "2026-09-04T00:00:00Z",
    },
    {
      id: "rt_bare",
      namespacePath: "",
      name: "bare",
      relationCount: 0,
      permissionCount: 0,
      createdAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-06T00:00:00Z",
    },
  ],
  total: 3,
  limit: 25,
  offset: 0,
}

const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }
const NAMESPACES = { namespaces: ["", "eng/platform"] }

function answers(extra = {}) {
  return {
    "resourceTypes.list": TYPES,
    "namespaces.list": NAMESPACES,
    ...extra,
  }
}

function client(extra = {}, commands = {}) {
  return stubClient(answers(extra), commands)
}

/** A client that reads normally and refuses every command with `error`. */
function refusingCommands(error: ContractError): ScopedClient {
  return {
    ...client(),
    command: async () => {
      throw error
    },
  } as ScopedClient
}

function pendingCommands(): ScopedClient {
  return {
    ...client(),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

const rowOf = async (name: string) =>
  (await screen.findByText(name)).closest("tr")!

function listQueries(sent: { intent: string; params?: unknown }[]) {
  return sent.filter((q) => q.intent === "resourceTypes.list")
}
function lastList(sent: { intent: string; params?: unknown }[]) {
  return listQueries(sent).at(-1)?.params as Record<string, unknown> | undefined
}

async function openCreate() {
  await screen.findByText("document")
  fireEvent.click(screen.getByRole("button", { name: /new resource type/i }))
  return within(await screen.findByRole("alertdialog"))
}
const CREATE = /^create resource type$/i

async function openDelete(name: string) {
  await screen.findByText(name)
  fireEvent.click(screen.getByRole("button", { name: `Delete ${name}` }))
  return within(await screen.findByRole("alertdialog"))
}

describe("WardenResourceTypesPage", () => {
  it("lists a type with its counts, and each count in its own column", async () => {
    renderPage(WardenResourceTypesPage, client())
    const doc = await rowOf("document")
    const cells = within(doc).getAllByRole("cell")
    // name, namespace, relations, permissions, updated, actions
    expect(cells[2]?.textContent).toBe("3")
    expect(cells[3]?.textContent).toBe("5")
    const folder = await rowOf("folder")
    const folderCells = within(folder).getAllByRole("cell")
    expect(folderCells[2]?.textContent).toBe("1")
    expect(folderCells[3]?.textContent).toBe("2")
  })

  it("shows a type with no definitions as zeros, not as blanks", async () => {
    renderPage(WardenResourceTypesPage, client())
    const cells = within(await rowOf("bare")).getAllByRole("cell")
    expect(cells[2]?.textContent).toBe("0")
    expect(cells[3]?.textContent).toBe("0")
  })

  it("names the columns the operator reads", async () => {
    renderPage(WardenResourceTypesPage, client())
    await screen.findByText("document")
    const headers = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent)
    expect(headers).toEqual([
      "Name",
      "Namespace",
      "Relations",
      "Permissions",
      "Updated",
      "Actions",
    ])
  })

  it("sets the name in the weight an operator scans for", async () => {
    renderPage(WardenResourceTypesPage, client())
    const cell = (await screen.findByText("document")).closest("td")!
    expect(cell.className).toContain("font-medium")
  })

  it("renders the tenant root as a slash and a real path as itself", async () => {
    renderPage(WardenResourceTypesPage, client())
    const table = within(await screen.findByRole("table"))
    await screen.findByText("document")
    expect(table.getAllByText("/").length).toBeGreaterThan(0)
    expect(table.getByText("eng/platform")).toBeTruthy()
    expect(table.queryByText("root")).toBeNull()
  })

  it("shows the update time, and a labelled dash when the server sent none", async () => {
    const missing = {
      ...TYPES,
      items: [{ ...TYPES.items[0], updatedAt: "" }],
      total: 1,
    }
    renderPage(
      WardenResourceTypesPage,
      client({ "resourceTypes.list": missing })
    )
    const row = await rowOf("document")
    expect(within(row).getByLabelText("no updated at")).toBeTruthy()
  })

  it("links each row to its own detail page", async () => {
    renderPage(WardenResourceTypesPage, client())
    const link = within(await rowOf("folder")).getByRole("link", {
      name: "Details",
    })
    // The link goes through PluginLink, which resolves against the plugin's
    // scope. Without a host it renders the plugin-relative path.
    expect(link.getAttribute("href")).toContain("/resource-types/rt_folder")
  })

  it("puts the server's total in the caption, not the page's row count", async () => {
    renderPage(
      WardenResourceTypesPage,
      client({ "resourceTypes.list": { ...TYPES, total: 60 } })
    )
    await screen.findByText("document")
    expect(await screen.findByText(/60 resource types/)).toBeTruthy()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(WardenResourceTypesPage, client({ "resourceTypes.list": EMPTY }))
    expect(await screen.findByText(/0 resource types/)).toBeTruthy()
    expect(await screen.findByText("No resource types yet.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "eng/platform" },
    })
    expect(
      await screen.findByText("No resource types in eng/platform.")
    ).toBeTruthy()
    expect(screen.queryByText("No resource types yet.")).toBeNull()
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "" },
    })
    expect(
      await screen.findByText("No resource types in the tenant root.")
    ).toBeTruthy()
  })

  it("names the search when a search is what emptied the list", async () => {
    renderPage(WardenResourceTypesPage, client({ "resourceTypes.list": EMPTY }))
    await screen.findByText("No resource types yet.")
    fireEvent.change(screen.getByLabelText("Search resource types"), {
      target: { value: "zzz" },
    })
    expect(
      await screen.findByText(/No resource types match .zzz./)
    ).toBeTruthy()
    expect(screen.queryByText("No resource types yet.")).toBeNull()
  })

  it("surfaces a list failure instead of rendering an empty table", async () => {
    renderPage(
      WardenResourceTypesPage,
      failingClient(
        new ContractError("PERMISSION_DENIED", "no tenant in scope")
      )
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("document")).toBeNull()
  })

  describe("filtering", () => {
    it("sends no filter field at all until one is set", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      const params = lastList(sent)
      expect(params).toEqual({ limit: 25, offset: 0 })
      // toEqual ignores undefined-valued keys, so assert the keys too.
      expect(Object.keys(params ?? {}).sort()).toEqual(["limit", "offset"])
    })

    it("sends the search to the server, trimmed, and goes back to the first page", async () => {
      const { client: c, sent } = recordingQueryClient(
        answers({ "resourceTypes.list": { ...TYPES, total: 60 } })
      )
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      fireEvent.click(screen.getByRole("button", { name: /next page/i }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(25))

      fireEvent.change(screen.getByLabelText("Search resource types"), {
        target: { value: "  doc  " },
      })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({ search: "doc", limit: 25, offset: 0 })
      )

      // Clearing it takes the field off the wire rather than sending "".
      fireEvent.change(screen.getByLabelText("Search resource types"), {
        target: { value: "   " },
      })
      await waitFor(() =>
        expect(Object.keys(lastList(sent) ?? {}).sort()).toEqual([
          "limit",
          "offset",
        ])
      )
    })

    it("sends the namespace to the server and goes back to the first page", async () => {
      const { client: c, sent } = recordingQueryClient(
        answers({ "resourceTypes.list": { ...TYPES, total: 60 } })
      )
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      fireEvent.click(screen.getByRole("button", { name: /next page/i }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(25))

      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "eng/platform" },
      })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          namespacePath: "eng/platform",
          limit: 25,
          offset: 0,
        })
      )
    })

    it("sends the tenant root as an empty namespace, which is not the same as all of them", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "" },
      })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          namespacePath: "",
          limit: 25,
          offset: 0,
        })
      )
    })

    it("combines the search with the namespace", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "eng/platform" },
      })
      fireEvent.change(screen.getByLabelText("Search resource types"), {
        target: { value: "fold" },
      })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          namespacePath: "eng/platform",
          search: "fold",
          limit: 25,
          offset: 0,
        })
      )
    })
  })

  describe("creating", () => {
    it("waits for a name before it can be confirmed", async () => {
      renderPage(WardenResourceTypesPage, client())
      const dialog = await openCreate()
      const confirm = dialog.getByRole("button", {
        name: CREATE,
      }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "   " },
      })
      expect(confirm.disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      expect(confirm.disabled).toBe(false)
    })

    it("sends the exact create payload, into the namespace on screen", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.create": { id: "rt_new" },
      })
      renderPage(WardenResourceTypesPage, c)
      await screen.findByText("document")
      fireEvent.change(screen.getByLabelText("Namespace"), {
        target: { value: "eng/platform" },
      })
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: " report " },
      })
      fireEvent.change(dialog.getByLabelText(/^Description/), {
        target: { value: " a report " },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("resourceTypes.create")
      expect(sent[0]?.payload).toEqual({
        name: "report",
        namespacePath: "eng/platform",
        description: "a report",
      })
    })

    it("leaves an empty description out of the payload rather than sending an empty string", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.create": { id: "rt_new" },
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.change(dialog.getByLabelText(/^Description/), {
        target: { value: "   " },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({ name: "report", namespacePath: "" })
      // toEqual ignores undefined-valued keys, so assert the keys themselves.
      expect(Object.keys(payload).sort()).toEqual(["name", "namespacePath"])
    })

    it("sends no relations or permissions, because they are written on the type's own page", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.create": { id: "rt_new" },
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      const keys = Object.keys(sent[0]?.payload as Record<string, unknown>)
      expect(keys).not.toContain("relations")
      expect(keys).not.toContain("permissions")
    })

    it("writes into the tenant root when no namespace is selected, and says so", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.create": { id: "rt_new" },
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openCreate()
      expect(dialog.getByText(/in the tenant root/i)).toBeTruthy()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(
        (sent[0]?.payload as { namespacePath: string }).namespacePath
      ).toBe("")
    })

    it("closes the dialog once the create succeeds", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.create": { id: "rt_new" },
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("shows a refused create inside the dialog and keeps what was typed", async () => {
      renderPage(
        WardenResourceTypesPage,
        refusingCommands(
          new ContractError(
            "CONFLICT",
            "a resource type named report already exists"
          )
        )
      )
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain(
        "a resource type named report already exists"
      )
      expect(alert.textContent).toContain("CONFLICT")
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect((dialog.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "report"
      )
    })

    it("clears an earlier refusal, and what was typed, when the dialog is opened again", async () => {
      renderPage(
        WardenResourceTypesPage,
        refusingCommands(new ContractError("CONFLICT", "already exists"))
      )
      const first = await openCreate()
      fireEvent.change(first.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(first.getByRole("button", { name: CREATE }))
      await first.findByRole("alert")

      fireEvent.click(first.getByRole("button", { name: /^cancel$/i }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      const second = await openCreate()
      expect(second.queryByRole("alert")).toBeNull()
      expect((second.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    })

    it("shows the create as pending while the command is in flight", async () => {
      renderPage(WardenResourceTypesPage, pendingCommands())
      const dialog = await openCreate()
      fireEvent.change(dialog.getByLabelText("Name"), {
        target: { value: "report" },
      })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      const working = (await dialog.findByRole("button", {
        name: /working/i,
      })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
    })
  })

  describe("deleting", () => {
    it("sends the resource type id, and only the id", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.delete": {},
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openDelete("folder")
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("resourceTypes.delete")
      expect(sent[0]?.payload).toEqual({ id: "rt_folder" })
    })

    it("names the type in the confirmation", async () => {
      renderPage(WardenResourceTypesPage, client())
      const dialog = await openDelete("document")
      expect(dialog.getByText("Delete document?")).toBeTruthy()
    })

    it("closes the dialog once the delete succeeds", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "resourceTypes.delete": {},
      })
      renderPage(WardenResourceTypesPage, c)
      const dialog = await openDelete("document")
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("shows the server's conflict, with its count, inside the dialog", async () => {
      // The server refuses to delete a type tuples still use, with a CONFLICT
      // naming how many. The code is set explicitly: the local fixture server
      // reports every warden refusal as BAD_REQUEST, so it cannot stand in.
      const message =
        "14 relation tuples still use document as their object type. Delete them first."
      renderPage(
        WardenResourceTypesPage,
        refusingCommands(new ContractError("CONFLICT", message))
      )
      const dialog = await openDelete("document")
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain(
        "14 relation tuples still use document"
      )
      expect(alert.textContent).toContain("CONFLICT")
      // The dialog stays open, because everything outside it is inert.
      expect(screen.getByRole("alertdialog")).toBeTruthy()
    })

    it("clears an earlier refusal when the dialog is opened for another type", async () => {
      renderPage(
        WardenResourceTypesPage,
        refusingCommands(
          new ContractError("CONFLICT", "14 relation tuples still use document")
        )
      )
      const first = await openDelete("document")
      fireEvent.click(first.getByRole("button", { name: /^Delete$/ }))
      await first.findByRole("alert")
      fireEvent.click(first.getByRole("button", { name: /^cancel$/i }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      const second = await openDelete("folder")
      expect(second.queryByRole("alert")).toBeNull()
    })

    it("shows the delete as pending while the command is in flight", async () => {
      // Without pending on the delete dialog a double click sends two
      // deletes, and the second reports a not-found for a type the first
      // already removed.
      renderPage(WardenResourceTypesPage, pendingCommands())
      const dialog = await openDelete("document")
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      const working = (await dialog.findByRole("button", {
        name: /working/i,
      })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect(
        (dialog.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement)
          .disabled
      ).toBe(true)
    })

    it("steps back a page when a delete empties the last one", async () => {
      const lastPage = {
        ...TYPES,
        items: [TYPES.items[0]],
        total: 26,
        limit: 25,
        offset: 25,
      }
      const { client: c, sent } = recordingQueryClient(
        answers({ "resourceTypes.list": lastPage })
      )
      const withDelete = { ...c, command: async () => ({}) } as typeof c
      renderPage(WardenResourceTypesPage, withDelete)
      await screen.findByText("document")
      fireEvent.click(screen.getByRole("button", { name: /next page/i }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(25))
      const dialog = await openDelete("document")
      fireEvent.click(dialog.getByRole("button", { name: /^Delete$/ }))
      await waitFor(() => expect(lastList(sent)?.offset).toBe(0))
    })
  })
})
