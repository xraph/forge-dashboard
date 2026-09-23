import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenRoleDetailPage } from "../src/pages/role-detail"
import { failingClient, recordingCommandClient, renderPage, stubClient } from "./harness"

const DETAIL = {
  id: "role_01hq",
  namespacePath: "",
  name: "Reader",
  slug: "reader",
  description: "can read",
  parentSlug: "",
  isSystem: false,
  isDefault: true,
  maxMembers: 0,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
  createdBy: "usr_1",
  updatedBy: "usr_2",
  permissions: [
    {
      id: "perm_01a",
      namespacePath: "",
      name: "document:read",
      resource: "document",
      action: "read",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  children: [
    {
      id: "role_01hr",
      namespacePath: "",
      name: "Editor",
      slug: "editor",
      parentSlug: "reader",
      isSystem: false,
      isDefault: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
}

const PERMS = {
  items: [
    DETAIL.permissions[0],
    {
      id: "perm_01b",
      namespacePath: "",
      name: "document:write",
      resource: "document",
      action: "write",
      isSystem: false,
      createdAt: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
  ],
  total: 2,
  limit: 200,
  offset: 0,
}

function client(detail = DETAIL, commands = {}) {
  return stubClient(
    { "roles.detail": detail, "permissions.list": PERMS },
    commands
  )
}

describe("WardenRoleDetailPage", () => {
  it("shows the role's fields", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("Reader")).toBeTruthy()
    expect(await screen.findByText("reader")).toBeTruthy()
  })

  it("lists the role's grants with a live count", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("document:read")).toBeTruthy()
    expect(await screen.findByText(/1 permission/)).toBeTruthy()
  })

  it("says which kind of empty a role with no grants is", async () => {
    renderPage(
      WardenRoleDetailPage,
      client({ ...DETAIL, permissions: [] }),
      { id: "role_01hq" }
    )
    expect(await screen.findByText(/0 permissions/)).toBeTruthy()
    expect(await screen.findByText(/grants nothing/i)).toBeTruthy()
  })

  it("lists the roles that inherit from this one", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("Editor")).toBeTruthy()
  })

  it("says which kind of empty a role with no children is", async () => {
    renderPage(WardenRoleDetailPage, client({ ...DETAIL, children: [] }), {
      id: "role_01hq",
    })
    expect(await screen.findByText(/nothing inherits/i)).toBeTruthy()
  })

  it("sends the natural key when detaching a grant, not the permission id", async () => {
    // The junction is keyed by (namespacePath, name). Sending an id would
    // detach nothing and report success.
    const { client: c, sent } = recordingCommandClient(
      { "roles.detail": DETAIL, "permissions.list": PERMS },
      { "roles.detachPermission": { id: "role_01hq" } }
    )
    renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
    const detach = await screen.findByRole("button", { name: /Revoke document:read/i })
    fireEvent.click(detach)
    const confirm = await screen.findByRole("button", { name: /^Revoke$/i })
    fireEvent.click(confirm)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent[0]?.intent).toBe("roles.detachPermission")
    expect(sent[0]?.payload).toEqual({
      roleId: "role_01hq",
      permissionName: "document:read",
      permissionNamespacePath: "",
    })
  })

  it("offers no edit or revoke on a system role", async () => {
    renderPage(
      WardenRoleDetailPage,
      client({ ...DETAIL, isSystem: true, name: "System" }),
      { id: "role_01hs" }
    )
    await screen.findByText("System")
    expect(screen.queryByRole("button", { name: /Edit/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Revoke/i })).toBeNull()
    // And it says why, rather than just hiding the controls.
    expect(await screen.findByText(/system role/i)).toBeTruthy()
  })

  it("surfaces a read failure instead of a blank page", async () => {
    renderPage(
      WardenRoleDetailPage,
      failingClient(new ContractError("NOT_FOUND", "role not found")),
      { id: "role_nope" }
    )
    expect(await screen.findAllByText(/role not found/i)).toBeTruthy()
  })
})
