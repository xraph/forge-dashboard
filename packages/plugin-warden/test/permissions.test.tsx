import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
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

  it("does not link a row to a permission detail page, because none exists yet", async () => {
    // /permissions/:id has no route: the intent behind it (permissions.detail)
    // is real and waiting on a later plan, but the page itself is not built.
    // A Details link here would be dead, so the row's only action is Delete.
    renderPage(WardenPermissionsPage, client())
    await screen.findByText("document:read")
    expect(screen.queryByRole("link", { name: /Details/i })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete document:read/i })).toBeTruthy()
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
    const resource = await screen.findByLabelText(/Resource/i)
    const action = await screen.findByLabelText(/Action/i)
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
    fireEvent.change(await screen.findByLabelText(/Resource/i), { target: { value: " folder " } })
    fireEvent.change(await screen.findByLabelText(/Action/i), { target: { value: " write" } })
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
