import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenPermissionsPage } from "../src/pages/permissions"
import { failingClient, recordingCommandClient, renderPage, stubClient } from "./harness"

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
})
