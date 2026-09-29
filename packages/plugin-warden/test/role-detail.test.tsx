import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
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

  it("links each grant to its permission's own page", async () => {
    // Scoped to the grant's own row, because the children table below carries
    // its own Details link to /roles/:id and an unscoped query would be
    // ambiguous between the two.
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    const row = (await screen.findByText("document:read")).closest("tr") as HTMLElement
    expect(row).toBeTruthy()
    expect(within(row).getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
      "/permissions/perm_01a"
    )
    expect(within(row).getByRole("button", { name: "Revoke document:read" })).toBeTruthy()
  })

  it("still links a grant on a system role, which has no Revoke", async () => {
    // The link sits beside Revoke, and a system role hides Revoke. Reading a
    // grant is not changing it, so the link must survive.
    renderPage(WardenRoleDetailPage, client({ ...DETAIL, isSystem: true }), {
      id: "role_01hq",
    })
    const row = (await screen.findByText("document:read")).closest("tr") as HTMLElement
    expect(within(row).getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
      "/permissions/perm_01a"
    )
    expect(within(row).queryByRole("button", { name: /Revoke/ })).toBeNull()
  })

  it("lists the roles that inherit from this one", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByText("Editor")).toBeTruthy()
  })

  it("still links a child role to its real detail route", async () => {
    // The grant link above and this one are different routes and both are
    // real; neither may be swept away by a change to the other.
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    const row = (await screen.findByText("Editor")).closest("tr")
    expect(row).toBeTruthy()
    expect(
      within(row as HTMLElement).getByRole("link", { name: /Details/i }).getAttribute("href")
    ).toBe("/roles/role_01hr")
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
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("roles.detachPermission")
    expect(sent[0]?.payload).toEqual({
      roleId: "role_01hq",
      permissionName: "document:read",
      permissionNamespacePath: "",
    })
  })

  it("offers no attach or revoke on a system role", async () => {
    renderPage(
      WardenRoleDetailPage,
      client({ ...DETAIL, isSystem: true, name: "System" }),
      { id: "role_01hs" }
    )
    await screen.findByText("System")
    // The page has no Edit control at all, for any role, so asserting its
    // absence would prove nothing about the system guard specifically.
    // Attach permission is the real conditional: the contract refuses it on
    // a system role, so it must not be offered. Paired with the next test,
    // which shows both controls present on an ordinary role.
    expect(screen.queryByRole("button", { name: /Attach permission/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Revoke/i })).toBeNull()
    // And it says why, rather than just hiding the controls.
    expect(await screen.findByText(/system role/i)).toBeTruthy()
  })

  it("offers attach and revoke on an ordinary role", async () => {
    renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
    expect(await screen.findByRole("button", { name: /Attach permission/i })).toBeTruthy()
    expect(await screen.findByRole("button", { name: /Revoke document:read/i })).toBeTruthy()
  })

  it("surfaces a read failure instead of a blank page", async () => {
    renderPage(
      WardenRoleDetailPage,
      failingClient(new ContractError("NOT_FOUND", "role not found")),
      { id: "role_nope" }
    )
    expect(await screen.findAllByText(/role not found/i)).toBeTruthy()
  })

  describe("attach picker", () => {
    async function openPicker(answers: Record<string, unknown>) {
      renderPage(
        WardenRoleDetailPage,
        stubClient({ "roles.detail": DETAIL, ...answers }),
        { id: "role_01hq" }
      )
      fireEvent.click(await screen.findByRole("button", { name: /Attach permission/i }))
      await screen.findByLabelText("Permission to attach")
    }

    it("shows the failure, not a claim that everything is granted, when the read fails", async () => {
      // permissions.list is absent, so the stub throws. An empty picker
      // after a failed read used to say "Every permission is already
      // granted", which is a lie about a read that never happened.
      await openPicker({})
      expect(await screen.findByText(/Could not load permissions/i)).toBeTruthy()
      expect(screen.queryByText(/already granted/i)).toBeNull()
    })

    it("says no permissions exist when the tenant has none", async () => {
      await openPicker({ "permissions.list": { items: [], total: 0, limit: 200, offset: 0 } })
      expect(await screen.findByText(/No permissions exist yet/i)).toBeTruthy()
      expect(screen.queryByText(/already granted/i)).toBeNull()
    })

    it("says everything is granted only when the whole list was read and all of it is held", async () => {
      await openPicker({
        "permissions.list": { items: [DETAIL.permissions[0]], total: 1, limit: 200, offset: 0 },
      })
      expect(await screen.findByText(/already granted/i)).toBeTruthy()
    })

    it("says the list is truncated rather than implying it is complete", async () => {
      // 250 permissions exist, the picker read 200, and the one page it
      // got is all held. Claiming "every permission is granted" here would
      // hide 50 that were never listed.
      await openPicker({
        "permissions.list": { items: [DETAIL.permissions[0]], total: 250, limit: 200, offset: 0 },
      })
      expect(await screen.findByText(/Showing the first 1 of 250/i)).toBeTruthy()
      expect(screen.queryByText(/Every permission is already granted/i)).toBeNull()
    })
  })
})
