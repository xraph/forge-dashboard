import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenPermissionsPage } from "../src/pages/permissions"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const PERMS = {
  items: [
    {
      id: "perm_01a",
      namespacePath: "",
      name: "document:read",
      resource: "document",
      action: "read",
      description: "read a document",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
    {
      id: "perm_01c",
      namespacePath: "eng/platform",
      name: "cluster:admin",
      resource: "cluster",
      action: "admin",
      isSystem: true,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  total: 2,
  limit: 25,
  offset: 0,
}

const NAMESPACES = { namespaces: ["", "eng/platform"] }

function client(extra = {}, commands = {}) {
  return stubClient(
    { "permissions.list": PERMS, "namespaces.list": NAMESPACES, ...extra },
    commands
  )
}

describe("WardenPermissionsPage", () => {
  it("lists permissions with a live count", async () => {
    renderPage(WardenPermissionsPage, client())
    expect(await screen.findByText("document:read")).toBeTruthy()
    expect(await screen.findByText(/2 permissions/)).toBeTruthy()
  })

  it("shows resource and action separately from the name", async () => {
    // The evaluator matches on resource and action, not on the name, so
    // seeing them is how an operator checks a permission will be found.
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("document:read")
    expect(screen.getByText("document")).toBeTruthy()
    expect(screen.getByText("read")).toBeTruthy()
  })

  it("links each row to its permission's own page", async () => {
    // Scoped to the row, because every row carries its own Details link and
    // an unscoped query would be ambiguous between them. The link sits beside
    // the Delete button, so a system row, which has no Delete, must still
    // have it.
    renderPage(WardenPermissionsPage, client())
    const row = (await screen.findByText("document:read")).closest("tr") as HTMLElement
    expect(within(row).getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
      "/permissions/perm_01a"
    )
    expect(within(row).getByRole("button", { name: "Delete document:read" })).toBeTruthy()
    const system = (await screen.findByText("cluster:admin")).closest("tr") as HTMLElement
    expect(within(system).getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
      "/permissions/perm_01c"
    )
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(
      WardenPermissionsPage,
      client({ "permissions.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    expect(await screen.findByText(/0 permissions/)).toBeTruthy()
    expect(await screen.findByText(/No permissions yet/i)).toBeTruthy()
  })

  it("derives the name from resource and action as the operator types", async () => {
    // Asking for the name separately is a chance to disagree with
    // resource:action, and the contract refuses a disagreement. Deriving
    // it removes the chance.
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /New permission/i }))
    const resource = await screen.findByLabelText("Resource")
    const action = await screen.findByLabelText("Action")
    fireEvent.change(resource, { target: { value: "folder" } })
    fireEvent.change(action, { target: { value: "write" } })
    expect(await screen.findByText(/folder:write/)).toBeTruthy()
  })

  it("offers no delete on a system permission", async () => {
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("cluster:admin")
    expect(screen.queryByRole("button", { name: /Delete cluster:admin/i })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete document:read/i })).toBeTruthy()
  })

  it("shows the conflict when a delete is refused because a role grants it", async () => {
    const { client: c } = recordingCommandClient(
      { "permissions.list": PERMS, "namespaces.list": NAMESPACES },
      {}
    )
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /Delete document:read/i }))
    const confirm = await screen.findByRole("button", { name: /^Delete$/i })
    fireEvent.click(confirm)
    // permissions.delete is absent from the command map, so the harness
    // throws a ContractError and the dialog must stay open showing it.
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Delete$/i })).toBeTruthy()
  })

  it("surfaces a list failure instead of an empty table", async () => {
    renderPage(
      WardenPermissionsPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("document:read")).toBeNull()
  })

  it("names the search when a search is what emptied the list", async () => {
    renderPage(
      WardenPermissionsPage,
      client({ "permissions.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    await screen.findByText(/No permissions yet/i)
    fireEvent.change(screen.getByLabelText("Search permissions"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No permissions match .zzz./)).toBeTruthy()
    expect(screen.queryByText(/No permissions yet/i)).toBeNull()
  })

  it("names the namespace when the filter is what emptied the list", async () => {
    renderPage(
      WardenPermissionsPage,
      client({ "permissions.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    await screen.findByText(/No permissions yet/i)
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    expect(await screen.findByText("No permissions in eng/platform.")).toBeTruthy()
  })

  it("goes back to page one when the namespace filter changes", async () => {
    const { client: c, sent } = recordingQueryClient({
      "permissions.list": { ...PERMS, total: 60, limit: 25, offset: 0 },
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(
        sent.some(
          (q) => q.intent === "permissions.list" && (q.params as { offset?: number }).offset === 25
        )
      ).toBe(true)
    )
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "permissions.list").at(-1)
      expect(last?.params).toMatchObject({ namespacePath: "eng/platform", offset: 0 })
    })
  })

  it("sends no resource or action filter until one is applied", async () => {
    const { client: c, sent } = recordingQueryClient({
      "permissions.list": PERMS,
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    const first = sent.find((q) => q.intent === "permissions.list")
    expect(first?.params).toEqual({ limit: 25, offset: 0 })
  })

  it("filters by exact resource and action, trimmed, from page one", async () => {
    // The store matches both exactly, so " document" would match nothing.
    // A filter that changes the set sends the operator back to the start,
    // the way the namespace filter does.
    const { client: c, sent } = recordingQueryClient({
      "permissions.list": { ...PERMS, total: 60, limit: 25, offset: 0 },
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(
        sent.some(
          (q) => q.intent === "permissions.list" && (q.params as { offset?: number }).offset === 25
        )
      ).toBe(true)
    )
    fireEvent.change(screen.getByLabelText("Filter by resource"), {
      target: { value: " document " },
    })
    fireEvent.change(screen.getByLabelText("Filter by action"), { target: { value: "read " } })
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }))
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "permissions.list").at(-1)
      expect(last?.params).toEqual({ resource: "document", action: "read", limit: 25, offset: 0 })
    })
  })

  it("sends only the filter that was filled in", async () => {
    const { client: c, sent } = recordingQueryClient({
      "permissions.list": PERMS,
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.change(screen.getByLabelText("Filter by action"), { target: { value: "admin" } })
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }))
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "permissions.list").at(-1)
      expect(last?.params).toEqual({ action: "admin", limit: 25, offset: 0 })
    })
  })

  it("drops the resource and action filters on Clear, back on page one", async () => {
    const { client: c, sent } = recordingQueryClient({
      "permissions.list": { ...PERMS, total: 60, limit: 25, offset: 0 },
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.change(screen.getByLabelText("Filter by resource"), { target: { value: "document" } })
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }))
    await waitFor(() =>
      expect(sent.filter((q) => q.intent === "permissions.list").at(-1)?.params).toMatchObject({
        resource: "document",
        offset: 0,
      })
    )
    // Page two of the filtered set, so Clear has a page to reset.
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(sent.filter((q) => q.intent === "permissions.list").at(-1)?.params).toMatchObject({
        resource: "document",
        offset: 25,
      })
    )
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }))
    await waitFor(() =>
      expect(sent.filter((q) => q.intent === "permissions.list").at(-1)?.params).toEqual({
        limit: 25,
        offset: 0,
      })
    )
    expect((screen.getByLabelText("Filter by resource") as HTMLInputElement).value).toBe("")
  })

  it("says the filters emptied the list rather than that none exist", async () => {
    renderPage(
      WardenPermissionsPage,
      client({ "permissions.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    await screen.findByText(/No permissions yet/i)
    fireEvent.change(screen.getByLabelText("Filter by resource"), { target: { value: "folder" } })
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }))
    expect(await screen.findByText("No permissions match these filters.")).toBeTruthy()
    expect(screen.queryByText(/No permissions yet/i)).toBeNull()
  })

  it("sends resource and action and no name when creating a permission", async () => {
    // The contract derives the name and refuses one that disagrees with
    // resource:action, so a name on the wire is a second source of truth.
    // Values are trimmed on the way out: " document" would derive a name
    // no check ever matches.
    const { client: c, sent } = recordingCommandClient(
      { "permissions.list": PERMS, "namespaces.list": NAMESPACES },
      { "permissions.create": { id: "perm_new" } }
    )
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /New permission/i }))
    fireEvent.change(await screen.findByLabelText("Resource"), { target: { value: " folder " } })
    fireEvent.change(await screen.findByLabelText("Action"), { target: { value: " write" } })
    fireEvent.click(screen.getByRole("button", { name: /^create permission$/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("permissions.create")
    expect(sent[0]?.payload).toEqual({ resource: "folder", action: "write", namespacePath: "" })
    expect(Object.keys(sent[0]?.payload as object)).not.toContain("name")
  })

  it("sends the permission id, and only the id, when deleting one", async () => {
    const { client: c, sent } = recordingCommandClient(
      { "permissions.list": PERMS, "namespaces.list": NAMESPACES },
      { "permissions.delete": {} }
    )
    renderPage(WardenPermissionsPage, c)
    await screen.findByText("document:read")
    fireEvent.click(screen.getByRole("button", { name: /Delete document:read/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("permissions.delete")
    expect(sent[0]?.payload).toEqual({ id: "perm_01a" })
  })
})
