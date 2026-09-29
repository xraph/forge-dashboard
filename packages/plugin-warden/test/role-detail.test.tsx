import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
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
    // The contract refuses each of these on a system role, so none may be
    // offered. Edit and Replace all are asserted in the "system role" block
    // below, paired with their presence on an ordinary role.
    expect(screen.queryByRole("button", { name: /Attach permission/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /Revoke/i })).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Replace all" })).toBeNull()
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

  describe("edit form", () => {
    // A role with every editable field set to something, so that clearing
    // each one is a change the form has to notice and send.
    const FULL = {
      ...DETAIL,
      parentSlug: "base",
      maxMembers: 5,
      isDefault: true,
    }

    function recording(detail = FULL) {
      return recordingCommandClient(
        { "roles.detail": detail, "permissions.list": PERMS },
        { "roles.update": { id: "role_01hq" } }
      )
    }

    /** A client that reads the detail and refuses every command. */
    function refusing(error: ContractError, detail = FULL) {
      const { client: c, sent } = recordingCommandClient({
        "roles.detail": detail,
        "permissions.list": PERMS,
      })
      const client = {
        ...c,
        command: (intent: string, payload?: unknown) => {
          sent.push({ intent, payload })
          return Promise.reject(error)
        },
      } as ScopedClient
      return { client, sent }
    }

    async function openEdit() {
      await screen.findByText("Reader")
      // Exact name: a bare /edit/i would also match "Editor" if that child
      // role ever became a control.
      fireEvent.click(screen.getByRole("button", { name: "Edit" }))
      return screen.findByRole("button", { name: "Save changes" }) as Promise<HTMLButtonElement>
    }

    const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
    const type = (label: string, value: string) =>
      fireEvent.change(field(label), { target: { value } })

    async function saveAndRead(save: HTMLButtonElement, sent: { payload: unknown }[]) {
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      return sent[0]?.payload as Record<string, unknown>
    }

    it("sends only the fields the operator changed", async () => {
      // roles.update's optional fields are pointers: nil means leave alone,
      // a pointer to the zero value means clear. On the wire that is an
      // absent key against a present empty one, so sending every field would
      // overwrite what nobody touched.
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      const payload = await saveAndRead(save, sent)
      expect(sent[0]?.intent).toBe("roles.update")
      expect(payload).toEqual({ id: "role_01hq", name: "Renamed" })
      expect(Object.keys(payload).sort()).toEqual(["id", "name"])
    })

    it("starts from what the role has, and cannot be saved until something changes", async () => {
      renderPage(WardenRoleDetailPage, recording().client, { id: "role_01hq" })
      const save = await openEdit()
      expect(field("Name").value).toBe("Reader")
      expect(field("Description").value).toBe("can read")
      expect(field("Inherits from").value).toBe("base")
      expect(field("Member cap").value).toBe("5")
      expect(field("Default role").checked).toBe(true)
      expect(save.disabled).toBe(true)
    })

    it("does not count a change that ends where it started", async () => {
      renderPage(WardenRoleDetailPage, recording().client, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      expect(save.disabled).toBe(false)
      type("Name", "Reader")
      expect(save.disabled).toBe(true)
    })

    it("trims what it sends and does not count a padded name as a rename", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Reader  ")
      expect(save.disabled).toBe(true)
      type("Description", "  new words  ")
      const payload = await saveAndRead(save, sent)
      expect(payload).toEqual({ id: "role_01hq", description: "new words" })
    })

    it("can clear the parent deliberately", async () => {
      // A present empty string, distinct from omitting the field, which would
      // keep the old parent.
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Inherits from", "")
      const payload = await saveAndRead(save, sent)
      expect(payload).toEqual({ id: "role_01hq", parentSlug: "" })
      expect(Object.keys(payload).sort()).toEqual(["id", "parentSlug"])
    })

    it("can clear the description deliberately", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Description", "")
      const payload = await saveAndRead(save, sent)
      expect(payload).toEqual({ id: "role_01hq", description: "" })
      expect(Object.keys(payload).sort()).toEqual(["description", "id"])
    })

    it("sends a new parent as given", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Inherits from", "  other ")
      expect(await saveAndRead(save, sent)).toEqual({ id: "role_01hq", parentSlug: "other" })
    })

    describe("member cap", () => {
      it("is absent when the operator never touched it", async () => {
        // Changing the name must not carry the cap along: a present 5 would
        // be harmless here, but a present 0 would silently lift it.
        const { client: c, sent } = recording()
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        type("Name", "Renamed")
        const payload = await saveAndRead(save, sent)
        expect("maxMembers" in payload).toBe(false)
        expect(Object.keys(payload).sort()).toEqual(["id", "name"])
      })

      it("is sent as the number when the operator changes it", async () => {
        const { client: c, sent } = recording()
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        type("Member cap", " 12 ")
        const payload = await saveAndRead(save, sent)
        expect(payload).toEqual({ id: "role_01hq", maxMembers: 12 })
        expect(Object.keys(payload).sort()).toEqual(["id", "maxMembers"])
      })

      it("is sent as 0 when the operator clears it to mean no limit", async () => {
        // Omitting it would keep the old cap of 5 and report success. Zero is
        // how warden spells unlimited.
        const { client: c, sent } = recording()
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        type("Member cap", "")
        const payload = await saveAndRead(save, sent)
        expect(payload).toEqual({ id: "role_01hq", maxMembers: 0 })
        expect(Object.keys(payload).sort()).toEqual(["id", "maxMembers"])
      })

      it("starts blank for an unlimited role, and blank is not a change", async () => {
        const { client: c, sent } = recording({ ...FULL, maxMembers: 0 })
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        expect(field("Member cap").value).toBe("")
        expect(save.disabled).toBe(true)
        // Typing 0 into an unlimited role is the same value, not a change.
        type("Member cap", "0")
        expect(save.disabled).toBe(true)
        type("Member cap", "3")
        expect(await saveAndRead(save, sent)).toEqual({ id: "role_01hq", maxMembers: 3 })
      })

      it("refuses text that is not a whole number, and says so", async () => {
        const { client: c, sent } = recording()
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        type("Member cap", "lots")
        expect(save.disabled).toBe(true)
        expect(screen.getByText(/whole number, or empty for no limit/i)).toBeTruthy()
        type("Member cap", "-1")
        expect(save.disabled).toBe(true)
        type("Member cap", "2.5")
        expect(save.disabled).toBe(true)
        type("Member cap", "7")
        expect(save.disabled).toBe(false)
        expect(screen.queryByText(/whole number, or empty for no limit/i)).toBeNull()
        expect(sent).toHaveLength(0)
      })
    })

    describe("default flag", () => {
      it("sends false when the operator unsets it", async () => {
        // A present false, not an omitted key: absent would keep the role
        // default.
        const { client: c, sent } = recording()
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        fireEvent.click(field("Default role"))
        const payload = await saveAndRead(save, sent)
        expect(payload).toEqual({ id: "role_01hq", isDefault: false })
        expect(Object.keys(payload).sort()).toEqual(["id", "isDefault"])
      })

      it("sends true when the operator sets it", async () => {
        const { client: c, sent } = recording({ ...FULL, isDefault: false })
        renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
        const save = await openEdit()
        fireEvent.click(field("Default role"))
        expect(await saveAndRead(save, sent)).toEqual({ id: "role_01hq", isDefault: true })
      })
    })

    it("sends several changes together and nothing else", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      type("Inherits from", "")
      type("Member cap", "")
      fireEvent.click(field("Default role"))
      const payload = await saveAndRead(save, sent)
      expect(payload).toEqual({
        id: "role_01hq",
        name: "Renamed",
        parentSlug: "",
        maxMembers: 0,
        isDefault: false,
      })
      expect(Object.keys(payload).sort()).toEqual([
        "id",
        "isDefault",
        "maxMembers",
        "name",
        "parentSlug",
      ])
    })

    it("cannot save a blank name", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "   ")
      expect(save.disabled).toBe(true)
      expect(screen.getByText("A role needs a name.")).toBeTruthy()
      expect(sent).toHaveLength(0)
    })

    it("closes the form once the save succeeds", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      fireEvent.click(save)
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    })

    it("closes on cancel without sending anything, and forgets the abandoned edit", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openEdit()
      type("Name", "Renamed")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
      expect(field("Name").value).toBe("Reader")
      expect(sent).toHaveLength(0)
    })

    it("shows the save as pending while the command is in flight", async () => {
      const c = {
        ...recording().client,
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      fireEvent.click(save)
      const working = (await screen.findByRole("button", { name: "Saving…" })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true
      )
    })

    it("keeps the form open, with what was typed, when the save fails", async () => {
      // A refusal roles.update really emits: checkParent's BAD_REQUEST for a
      // parent slug with no role in this namespace. roles.update never checks
      // the member cap, so a cap refusal here would be invented.
      const { client: c, sent } = refusing(
        new ContractError("BAD_REQUEST", "no role with slug ghost in this namespace")
      )
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      type("Inherits from", "ghost")
      type("Member cap", "1")
      fireEvent.click(save)
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("no role with slug ghost in this namespace")
      expect(alert.textContent).toContain("BAD_REQUEST")
      expect(sent).toHaveLength(1)
      expect(field("Name").value).toBe("Renamed")
      expect(field("Inherits from").value).toBe("ghost")
      expect(field("Member cap").value).toBe("1")
      // Still the form, and still saveable once the operator fixes it.
      expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(
        false
      )
    })

    it("says the cap is checked on assignment and lowering it removes nobody", async () => {
      // roles.update stores MaxMembers without counting anyone, and the only
      // guard is assignments.create. An operator lowering the cap to trim a
      // role must not believe that doing so revoked anybody.
      renderPage(WardenRoleDetailPage, recording().client, { id: "role_01hq" })
      await openEdit()
      expect(
        screen.getByText(
          "Leave it empty for no limit. Clearing a cap you had removes it. The cap is checked when this dashboard assigns a subject. Lowering it removes nobody who already holds the role."
        )
      ).toBeTruthy()
    })

    it("does not show an earlier refusal when the form is opened again", async () => {
      const { client: c } = refusing(new ContractError("CONFLICT", "nope, not this time"))
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      const save = await openEdit()
      type("Name", "Renamed")
      fireEvent.click(save)
      await screen.findByRole("alert")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      fireEvent.click(await screen.findByRole("button", { name: "Edit" }))
      await screen.findByRole("button", { name: "Save changes" })
      expect(screen.queryByRole("alert")).toBeNull()
    })
  })

  describe("system role", () => {
    it("offers no edit or replace-all, and says why", async () => {
      renderPage(
        WardenRoleDetailPage,
        client({ ...DETAIL, isSystem: true, name: "System" }),
        { id: "role_01hs" }
      )
      await screen.findByText("System")
      expect(screen.queryByRole("button", { name: "Edit" })).toBeNull()
      expect(screen.queryByRole("button", { name: "Replace all" })).toBeNull()
      // The alert names the same three things the page really withholds.
      const alert = await screen.findByText(/This is a system role/i)
      expect(alert.textContent).toContain("cannot be edited")
      expect(alert.textContent).toContain("grants changed")
    })

    it("offers both on an ordinary role", async () => {
      renderPage(WardenRoleDetailPage, client(), { id: "role_01hq" })
      expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy()
      expect(await screen.findByRole("button", { name: "Replace all" })).toBeTruthy()
      expect(screen.queryByText(/This is a system role/i)).toBeNull()
    })
  })

  describe("replace all", () => {
    const REF_READ = { name: "document:read", namespacePath: "" }
    const REF_WRITE = { name: "document:write", namespacePath: "" }

    function recording(detail = DETAIL, perms: unknown = PERMS) {
      return recordingCommandClient(
        { "roles.detail": detail, "permissions.list": perms },
        { "roles.setPermissions": { id: "role_01hq" } }
      )
    }

    function refusing(error: ContractError) {
      const { client: c, sent } = recordingCommandClient({
        "roles.detail": DETAIL,
        "permissions.list": PERMS,
      })
      const client = {
        ...c,
        command: (intent: string, payload?: unknown) => {
          sent.push({ intent, payload })
          return Promise.reject(error)
        },
      } as ScopedClient
      return { client, sent }
    }

    const dialog = () => within(screen.getByRole("alertdialog"))
    const box = (label: string) => dialog().getByLabelText(label) as HTMLInputElement

    async function openReplace() {
      await screen.findByText("document:read")
      fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
      // The held grant is checked from the start; the other one arrives with
      // the picker's read.
      await dialog().findByLabelText("document:write (/)")
    }

    const confirm = () => dialog().getByRole("button", { name: "Replace grants" }) as HTMLButtonElement

    it("replaces the whole grant set in one call", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      expect(box("document:read (/)").checked).toBe(true)
      expect(box("document:write (/)").checked).toBe(false)
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("roles.setPermissions")
      // roleId, not id, and permissions named by name plus namespace.
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({ roleId: "role_01hq", permissions: [REF_READ, REF_WRITE] })
      expect(Object.keys(payload).sort()).toEqual(["permissions", "roleId"])
      expect(Object.keys((payload.permissions as object[])[0]).sort()).toEqual([
        "name",
        "namespacePath",
      ])
    })

    it("swaps one grant for another", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:read (/)"))
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ roleId: "role_01hq", permissions: [REF_WRITE] })
    })

    it("can revoke everything with an empty set", async () => {
      // An empty list is the instruction, not a missing one: a role that
      // grants nothing is a real target state.
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:read (/)"))
      expect(dialog().getByText(/This revokes all 1 permission from the role/)).toBeTruthy()
      expect(confirm().disabled).toBe(false)
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ roleId: "role_01hq", permissions: [] })
    })

    it("cannot be confirmed while the set is what the role already has", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      expect(confirm().disabled).toBe(true)
      fireEvent.click(box("document:write (/)"))
      expect(confirm().disabled).toBe(false)
      fireEvent.click(box("document:write (/)"))
      expect(confirm().disabled).toBe(true)
      expect(sent).toHaveLength(0)
    })

    it("does not warn about revoking everything for a role that holds nothing", async () => {
      const { client: c } = recording({ ...DETAIL, permissions: [] })
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await screen.findByText(/grants nothing/i)
      fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
      await dialog().findByLabelText("document:write (/)")
      expect(dialog().queryByText(/This revokes all/)).toBeNull()
      // Nothing held and nothing checked is no change.
      expect(confirm().disabled).toBe(true)
    })

    it("names a root permission with / like every other namespace", async () => {
      const { client: c } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      expect(box("document:read (/)")).toBeTruthy()
      expect(dialog().getByText("document:write (/)")).toBeTruthy()
      expect(dialog().queryByLabelText("document:read")).toBeNull()
    })

    it("names a namespaced permission by its namespace path", async () => {
      const scoped = {
        id: "perm_01c",
        namespacePath: "acme/eu",
        name: "invoice:read",
        resource: "invoice",
        action: "read",
        isSystem: false,
        createdAt: "2026-09-23T10:00:00Z",
        updatedAt: "2026-09-23T10:00:00Z",
      }
      const { client: c, sent } = recording(DETAIL, {
        items: [...PERMS.items, scoped],
        total: 3,
        limit: 200,
        offset: 0,
      })
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await screen.findByText("document:read")
      fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
      await dialog().findByLabelText("invoice:read (acme/eu)")
      fireEvent.click(box("invoice:read (acme/eu)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({
        roleId: "role_01hq",
        permissions: [REF_READ, { name: "invoice:read", namespacePath: "acme/eu" }],
      })
    })

    it("keeps a grant listed and checked when the picker's page did not include it", async () => {
      // 250 permissions exist and the read returned one that is not this
      // role's. Dropping the held grant from the list would drop it from the
      // set on confirm without anyone choosing that.
      const { client: c, sent } = recording(DETAIL, {
        items: [PERMS.items[1]],
        total: 250,
        limit: 200,
        offset: 0,
      })
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      expect(box("document:read (/)").checked).toBe(true)
      expect(await dialog().findByText(/Showing the first 1 of 250/i)).toBeTruthy()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({
        roleId: "role_01hq",
        permissions: [REF_READ, REF_WRITE],
      })
    })

    it("says so when the permissions could not be read, and still lets a grant be removed", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "roles.detail": DETAIL },
        { "roles.setPermissions": { id: "role_01hq" } }
      )
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await screen.findByText("document:read")
      fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
      expect(await dialog().findByText(/Could not load permissions/i)).toBeTruthy()
      fireEvent.click(box("document:read (/)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ roleId: "role_01hq", permissions: [] })
    })

    it("closes once the replace succeeds", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("closes on cancel without sending anything", async () => {
      const { client: c, sent } = recording()
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(dialog().getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(sent).toHaveLength(0)
    })

    it("shows the replace as pending while the command is in flight", async () => {
      // Removing `pending` from this ConfirmDialog leaves every other test
      // green, so it is asserted directly.
      const c = {
        ...recording().client,
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      const working = (await dialog().findByRole("button", {
        name: "Working…",
      })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
        true
      )
    })

    it("shows a refusal inside the dialog, stays open, and keeps the selection", async () => {
      const { client: c, sent } = refusing(
        new ContractError("NOT_FOUND", 'permission "document:write" does not exist')
      )
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      const alert = await dialog().findByRole("alert")
      expect(alert.textContent).toContain('permission "document:write" does not exist')
      expect(alert.textContent).toContain("NOT_FOUND")
      expect(sent).toHaveLength(1)
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect(box("document:write (/)").checked).toBe(true)
      expect(box("document:read (/)").checked).toBe(true)
    })

    it("does not show an earlier refusal when the dialog is opened again", async () => {
      const { client: c } = refusing(new ContractError("CONFLICT", "not this time"))
      renderPage(WardenRoleDetailPage, c, { id: "role_01hq" })
      await openReplace()
      fireEvent.click(box("document:write (/)"))
      fireEvent.click(confirm())
      await dialog().findByRole("alert")
      fireEvent.click(dialog().getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      fireEvent.click(screen.getByRole("button", { name: "Replace all" }))
      await dialog().findByLabelText("document:write (/)")
      expect(dialog().queryByRole("alert")).toBeNull()
      // The selection starts over from what the role holds.
      expect(box("document:write (/)").checked).toBe(false)
    })
  })
})
