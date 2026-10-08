import { describe, expect, it } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
  queryStore,
} from "@forge-go/dashboard-plugin"
import type { PluginLinkProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenPermissionDetailPage } from "../src/pages/permission-detail"
import type { PermissionDetail } from "../src/pages/permission-detail"
import {
  failingClient,
  pendingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const READER = {
  id: "role_01r",
  namespacePath: "",
  name: "Reader",
  slug: "reader",
  isSystem: false,
  isDefault: true,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const AUDITOR = {
  id: "role_01a",
  namespacePath: "eng/platform",
  name: "Auditor",
  slug: "auditor",
  isSystem: true,
  isDefault: false,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const DETAIL: PermissionDetail = {
  id: "perm_01a",
  namespacePath: "",
  name: "document:read",
  resource: "document",
  action: "read",
  description: "read a document",
  isSystem: false,
  createdAt: "2026-09-23T10:00:00Z",
  updatedAt: "2026-09-24T10:00:00Z",
  grantedBy: [READER, AUDITOR],
}

const SYSTEM: PermissionDetail = {
  ...DETAIL,
  id: "perm_01c",
  namespacePath: "eng/platform",
  name: "cluster:admin",
  resource: "cluster",
  action: "admin",
  isSystem: true,
}

function detailOf(over: Partial<PermissionDetail>): PermissionDetail {
  return { ...DETAIL, ...over }
}

function client(detail: PermissionDetail = DETAIL, commands = {}) {
  return stubClient({ "permissions.detail": detail }, commands)
}

function show(detail: PermissionDetail = DETAIL, commands = {}) {
  return renderPage(WardenPermissionDetailPage, client(detail, commands), {
    id: "perm_01a",
  })
}

/** A link the way the shell renders one, so a test can tell it from a bare anchor. */
function RouterLink({ to, children, className }: PluginLinkProps) {
  return (
    <a href={to} className={className} data-router="yes">
      {children}
    </a>
  )
}

/** Renders inside a host: a router link, a scope prefix, and a recorded navigate. */
function showInHost(c: ScopedClient, detail = "perm_01a") {
  const navigated: string[] = []
  const utils = render(
    <PluginProvider client={c}>
      <NavigationProvider
        value={{
          Link: RouterLink,
          navigate: (to) => navigated.push(to),
          resolve: (to) => `/@warden/acme${to}`,
        }}
      >
        <WardenPermissionDetailPage params={{ id: detail }} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { ...utils, navigated }
}

/** A client that reads the detail and refuses every command with `error`. */
function refusing(error: ContractError, detail: PermissionDetail = DETAIL) {
  const { client: c, sent } = recordingCommandClient({
    "permissions.detail": detail,
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

/** A client whose reads succeed and whose commands never settle. */
function commandsNeverSettle(detail: PermissionDetail = DETAIL): ScopedClient {
  return {
    ...client(detail),
    command: () => new Promise<never>(() => {}),
  } as ScopedClient
}

const rowOf = async (text: string) =>
  (await screen.findByText(text)).closest("tr")!
const dialog = () => within(screen.getByRole("alertdialog"))

async function openDelete() {
  await screen.findByRole("heading", { name: "document:read" })
  fireEvent.click(screen.getByRole("button", { name: "Delete" }))
  await screen.findByRole("alertdialog")
}

describe("WardenPermissionDetailPage", () => {
  describe("reading", () => {
    it("answers which roles attach this permission directly", async () => {
      // The question an operator opens this page for. permissions.detail's
      // grantedBy answers it for direct attachment, and only for that.
      show()
      expect(await screen.findByText("reader")).toBeTruthy()
      expect(await screen.findByText("auditor")).toBeTruthy()
    })

    it("counts the roles that attach it directly, and only claims that", async () => {
      // grantedBy is exact-name attachment. Inherited and wildcard grants are
      // not in it, so a caption saying "granting roles" overclaimed.
      show()
      expect(await screen.findByText("2 roles attach it directly")).toBeTruthy()
      expect(screen.queryByText(/granting roles?/)).toBeNull()
    })

    it("counts one attaching role in the singular", async () => {
      show(detailOf({ grantedBy: [READER] }))
      expect(
        await screen.findByText("1 role attaches it directly")
      ).toBeTruthy()
    })

    it("says what else grants its check and is not listed: a parent, a wildcard, or the same resource and action", async () => {
      // The engine compares a role's permissions by resource:action alone
      // (engine.go evaluateRBAC, matcher.go matchPermission). It never reads
      // a permission's name or namespace, so another permission with the
      // same pair grants the same check through any role that attaches it.
      show()
      expect(
        await screen.findByText(
          "A role can also grant this permission's check without attaching it: through a parent role, a wildcard permission such as document:*, or another permission with the same resource and action under another name or in another namespace. This list does not show those roles."
        )
      ).toBeTruthy()
    })

    it("asks permissions.detail for exactly the id in the route", async () => {
      const { client: c, sent } = recordingQueryClient({
        "permissions.detail": DETAIL,
      })
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      await screen.findByText("reader")
      expect(sent).toEqual([
        { intent: "permissions.detail", params: { id: "perm_01a" } },
      ])
    })

    it("asks for a different permission when the route names a different id", async () => {
      // Guards the request payload from being a constant: the id sent is
      // the one in the route, not whatever the fixture happens to carry.
      const { client: c, sent } = recordingQueryClient({
        "permissions.detail": DETAIL,
      })
      renderPage(WardenPermissionDetailPage, c, { id: "perm_09z" })
      await screen.findByText("reader")
      expect(sent[0]).toEqual({
        intent: "permissions.detail",
        params: { id: "perm_09z" },
      })
    })

    it("sets the role name in the weight an operator scans for, and the slug as an identifier", async () => {
      show()
      const name = (await screen.findByText("Reader")).closest("td")!
      expect(name.className).toContain("font-medium")
      const slug = (await screen.findByText("reader")).closest("td")!
      expect(slug.className).toContain("font-mono")
      expect(slug.className).toContain("text-xs")
    })

    it("names the permission in the heading", async () => {
      show()
      expect(
        await screen.findByRole("heading", { name: "document:read" })
      ).toBeTruthy()
    })
  })

  describe("a permission nothing grants", () => {
    it("says which kind of empty it is, and still counts", async () => {
      show(detailOf({ grantedBy: [] }))
      // Not "No role grants this permission": a role inheriting it from a
      // parent, or holding a matching wildcard, grants it and is not listed.
      expect(
        await screen.findByText("No role attaches this permission directly.")
      ).toBeTruthy()
      expect(await screen.findByText("0 roles attach it directly")).toBeTruthy()
      expect(screen.queryByText("No role grants this permission.")).toBeNull()
      expect(
        screen.getByText(/through a parent role, a wildcard permission/)
      ).toBeTruthy()
    })

    it("does not fall back to a generic empty message", async () => {
      show(detailOf({ grantedBy: [] }))
      await screen.findByText("No role attaches this permission directly.")
      expect(screen.queryByText(/no rows/i)).toBeNull()
      expect(screen.queryByText(/no data/i)).toBeNull()
      expect(screen.queryByText(/nothing to show/i)).toBeNull()
    })

    it("is not an error: the permission's own fields still render", async () => {
      show(detailOf({ grantedBy: [] }))
      await screen.findByText("No role attaches this permission directly.")
      expect(screen.queryByRole("alert")).toBeNull()
      expect(screen.getByText("read a document")).toBeTruthy()
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    })

    it("survives a null grantedBy rather than throwing", async () => {
      show(detailOf({ grantedBy: null as unknown as [] }))
      expect(
        await screen.findByText("No role attaches this permission directly.")
      ).toBeTruthy()
    })
  })

  describe("the permission's own fields", () => {
    it("shows resource and action separately from the name", async () => {
      // A check matches on resource and action, never on the name, so these
      // are the fields that decide whether it will be found.
      show()
      const resource = await screen.findByText("document")
      const action = await screen.findByText("read")
      expect(resource.textContent).toBe("document")
      expect(action.textContent).toBe("read")
      // Each under its own term in the field list, not folded into the name.
      expect(resource.closest("dd")!.previousElementSibling!.textContent).toBe(
        "Resource"
      )
      expect(action.closest("dd")!.previousElementSibling!.textContent).toBe(
        "Action"
      )
    })

    it("sets resource and action as identifiers, in monospace", async () => {
      show()
      const resource = await screen.findByText("document")
      const action = await screen.findByText("read")
      for (const el of [resource, action]) {
        expect(el.className).toContain("font-mono")
        expect(el.className).toContain("text-xs")
      }
    })

    it("says that a check matches on resource and action, not on the permission's name or namespace", async () => {
      show()
      expect(
        await screen.findByText(
          "A check matches on resource and action, never on the permission's name or namespace."
        )
      ).toBeTruthy()
    })

    it("renders the tenant root namespace as a slash, never as the word root", async () => {
      show(detailOf({ grantedBy: [READER] }))
      await screen.findByText("reader")
      // Once for the permission's own namespace and once for the role's.
      expect(screen.getAllByText("/").length).toBe(2)
      expect(screen.queryByText("root")).toBeNull()
    })

    it("shows a real namespace path as written", async () => {
      show(SYSTEM)
      expect(await screen.findAllByText("eng/platform")).toBeTruthy()
    })

    it("labels an absent description as none instead of leaving a blank cell", async () => {
      show(detailOf({ description: undefined }))
      await screen.findByText("reader")
      expect(screen.getByLabelText("no description")).toBeTruthy()
    })

    it("labels an absent timestamp as none", async () => {
      show(detailOf({ updatedAt: "" }))
      await screen.findByText("reader")
      expect(screen.getByLabelText("no updated at")).toBeTruthy()
    })
  })

  describe("a system permission", () => {
    it("is marked", async () => {
      show(SYSTEM)
      expect(await screen.findByText(/system permission/i)).toBeTruthy()
      // The same badge the list page uses, in the field list. Scoped to the
      // aside: a granting role can be a system role and carry its own.
      expect(
        within(screen.getByRole("complementary")).getByText("system")
      ).toBeTruthy()
    })

    it("offers no delete", async () => {
      show(SYSTEM)
      await screen.findByText(/system permission/i)
      expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
    })

    it("offers no edit, and says it cannot be changed", async () => {
      // permissions.update refuses a system permission (guardSystemPermission,
      // PERMISSION_DENIED), so an edit control would promise a refusal.
      show(SYSTEM)
      expect(
        await screen.findByText(
          "This is a system permission. It cannot be changed or deleted."
        )
      ).toBeTruthy()
      expect(screen.queryByRole("button", { name: /edit/i })).toBeNull()
    })

    it("does not mark an ordinary permission, and offers its delete", async () => {
      // The other side of the two tests above, so neither can pass by the
      // page rendering nothing at all.
      show()
      await screen.findByText("reader")
      expect(screen.queryByText(/system permission/i)).toBeNull()
      expect(
        within(screen.getByRole("complementary")).queryByText("system")
      ).toBeNull()
      expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy()
    })
  })

  describe("linking to the granting roles", () => {
    it("links each granting role to its own page, scope-relative", async () => {
      showInHost(client())
      const reader = await rowOf("reader")
      const link = within(reader).getByRole("link", { name: "Details" })
      // Resolved by the host's scope, not hardcoded: a page cannot know its
      // own mount point.
      expect(link.getAttribute("href")).toBe("/@warden/acme/roles/role_01r")
      expect(link.getAttribute("data-router")).toBe("yes")
      const auditor = await rowOf("auditor")
      expect(
        within(auditor)
          .getByRole("link", { name: "Details" })
          .getAttribute("href")
      ).toBe("/@warden/acme/roles/role_01a")
    })

    it("still renders a real link with no host around it", async () => {
      show()
      const row = await rowOf("reader")
      expect(
        within(row).getByRole("link", { name: "Details" }).getAttribute("href")
      ).toBe("/roles/role_01r")
    })
  })

  describe("failing and loading", () => {
    it("surfaces a read failure rather than a blank page", async () => {
      renderPage(
        WardenPermissionDetailPage,
        failingClient(new ContractError("NOT_FOUND", "no such permission")),
        { id: "perm_01a" }
      )
      expect(await screen.findAllByText(/no such permission/i)).toBeTruthy()
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("NOT_FOUND")
      expect(screen.queryByText("reader")).toBeNull()
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
    })

    it("shows a loading state while the read is in flight", async () => {
      renderPage(WardenPermissionDetailPage, pendingClient(), {
        id: "perm_01a",
      })
      expect(
        await screen.findByRole("status", { name: /loading permission/i })
      ).toBeTruthy()
    })
  })

  describe("deleting", () => {
    it("confirms before sending anything", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.delete": {} }
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      await openDelete()
      expect(sent).toEqual([])
    })

    it("says the delete is refused while a role attaches it directly, not while any role grants it", async () => {
      // The guard shares grantedBy's exact-name scan, so a role holding it
      // only through a wildcard or a parent does not block the delete.
      show()
      await openDelete()
      expect(
        dialog().getByText(
          "This is refused while any role attaches it directly. Detach it from those roles first, and the error below will name them."
        )
      ).toBeTruthy()
    })

    it("sends exactly the id of this permission", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.delete": {} }
      )
      showInHost(c)
      await openDelete()
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "permissions.delete",
        payload: { id: "perm_01a" },
      })
    })

    it("leaves for the permissions list once the delete succeeds", async () => {
      const { client: c } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.delete": {} }
      )
      const { navigated } = showInHost(c)
      await openDelete()
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      expect(
        await screen.findByText("This permission has been deleted.")
      ).toBeTruthy()
      expect(navigated).toEqual(["/@warden/acme/permissions"])
      // The page no longer presents a permission that is gone.
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
      expect(screen.queryByText("reader")).toBeNull()
      expect(
        screen
          .getByRole("link", { name: "Back to permissions" })
          .getAttribute("href")
      ).toBe("/@warden/acme/permissions")
    })

    it("shows the dialog as pending while the command is in flight", async () => {
      // Removing `pending` from the ConfirmDialog left every other test
      // green on two earlier pages, so this one asserts it directly.
      renderPage(WardenPermissionDetailPage, commandsNeverSettle(), {
        id: "perm_01a",
      })
      await openDelete()
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      const working = (await dialog().findByRole("button", {
        name: "Working…",
      })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect(
        (dialog().getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
          .disabled
      ).toBe(true)
    })

    it("shows a refusal inside the dialog, names the roles, and stays open", async () => {
      const { client: c } = refusing(
        new ContractError(
          "CONFLICT",
          "document:read is still granted by reader, auditor. Detach it from those roles first."
        )
      )
      const { navigated } = showInHost(c)
      await openDelete()
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      const alert = await dialog().findByRole("alert")
      expect(alert.textContent).toContain("still granted by reader, auditor")
      expect(alert.textContent).toContain("CONFLICT")
      // Not a success: the dialog is still open and the page did not leave.
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect(navigated).toEqual([])
      expect(screen.queryByText("This permission has been deleted.")).toBeNull()
    })

    it("clears an earlier refusal when the dialog opens again", async () => {
      const { client: c } = refusing(
        new ContractError("CONFLICT", "still granted by reader")
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      await openDelete()
      fireEvent.click(dialog().getByRole("button", { name: "Delete" }))
      await dialog().findByRole("alert")
      fireEvent.click(dialog().getByRole("button", { name: "Cancel" }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      fireEvent.click(screen.getByRole("button", { name: "Delete" }))
      await screen.findByRole("alertdialog")
      expect(dialog().queryByRole("alert")).toBeNull()
    })
  })

  describe("editing the description", () => {
    async function openEdit() {
      await screen.findByRole("heading", { name: "document:read" })
      fireEvent.click(screen.getByRole("button", { name: "Edit description" }))
      return screen.findByLabelText("Description")
    }

    it("offers the edit on an ordinary permission, filled with what it says now", async () => {
      show()
      const input = (await openEdit()) as HTMLInputElement
      expect(input.value).toBe("read a document")
    })

    it("says only the description can change, and that no check reads it", async () => {
      show()
      await openEdit()
      expect(
        screen.getByText(
          "Only the description can change. Resource and action decide what this permission means, so to change either, delete it and create another. Checks never read the description, so saving it changes no one's access."
        )
      ).toBeTruthy()
    })

    it("cannot be saved until something changed", async () => {
      show()
      await openEdit()
      expect(
        (
          screen.getByRole("button", {
            name: "Save description",
          }) as HTMLButtonElement
        ).disabled
      ).toBe(true)
    })

    it("sends exactly the id and the new description, trimmed", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.update": { id: "perm_01a" } }
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = await openEdit()
      fireEvent.change(input, { target: { value: "  read any document  " } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "permissions.update",
        payload: { id: "perm_01a", description: "read any document" },
      })
    })

    it("sends an empty description to clear it, and says that it will", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.update": { id: "perm_01a" } }
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = await openEdit()
      expect(
        screen.getByText("Leave it empty to remove the description.")
      ).toBeTruthy()
      fireEvent.change(input, { target: { value: "   " } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      await waitFor(() => expect(sent.length).toBe(1))
      expect(sent[0]).toEqual({
        intent: "permissions.update",
        payload: { id: "perm_01a", description: "" },
      })
    })

    it("moves focus into the form when it opens", async () => {
      // The button that opened it is gone, so focus must not fall to the
      // page body.
      show()
      const input = await openEdit()
      await waitFor(() => expect(document.activeElement).toBe(input))
    })

    it("returns focus to Edit description when the form closes", async () => {
      show()
      await openEdit()
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      await waitFor(() =>
        expect(document.activeElement).toBe(
          screen.getByRole("button", { name: "Edit description" })
        )
      )
    })

    it("links the hint to the field as its description", async () => {
      show()
      const input = await openEdit()
      const hint = input.getAttribute("aria-describedby")
      expect(hint).toBeTruthy()
      expect(document.getElementById(hint as string)?.textContent).toBe(
        "Leave it empty to remove the description."
      )
    })

    it("hides the other actions while the form is open", async () => {
      show()
      await openEdit()
      expect(screen.queryByRole("button", { name: "Delete" })).toBeNull()
      expect(
        screen.queryByRole("button", { name: "Edit description" })
      ).toBeNull()
    })

    it("cancels without sending anything", async () => {
      const { client: c, sent } = recordingCommandClient(
        { "permissions.detail": DETAIL },
        { "permissions.update": { id: "perm_01a" } }
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = await openEdit()
      fireEvent.change(input, { target: { value: "something else" } })
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      await waitFor(() =>
        expect(screen.queryByLabelText("Description")).toBeNull()
      )
      expect(sent).toEqual([])
      expect(screen.getByText("read a document")).toBeTruthy()
    })

    it("shows the server's refusal and keeps what was typed", async () => {
      // What an ordinary permission's update gets when another operator
      // deleted it while this form was open: the Go handler's read is
      // NOT_FOUND, with the store's own text.
      const { client: c } = refusing(
        new ContractError(
          "NOT_FOUND",
          "permission perm_01a: warden: permission not found: warden: not found"
        )
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = (await openEdit()) as HTMLInputElement
      fireEvent.change(input, { target: { value: "read any document" } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toContain("Could not save the description")
      expect(alert.textContent).toContain("permission not found")
      expect(alert.textContent).toContain("NOT_FOUND")
      expect(
        (screen.getByLabelText("Description") as HTMLInputElement).value
      ).toBe("read any document")
    })

    it("shows the save as pending while the command is in flight", async () => {
      renderPage(WardenPermissionDetailPage, commandsNeverSettle(), {
        id: "perm_01a",
      })
      const input = await openEdit()
      fireEvent.change(input, { target: { value: "read any document" } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      const saving = (await screen.findByRole("button", {
        name: "Saving…",
      })) as HTMLButtonElement
      expect(saving.disabled).toBe(true)
    })

    it("closes the form and shows the saved description once the page reads again", async () => {
      // The server names permissions.detail in permissions.update's
      // invalidates, so the client drops this page's read and it goes again.
      let description = "read a document"
      const queried: string[] = []
      const c = {
        extension: "warden",
        query: async (intent: string) => {
          queried.push(intent)
          if (intent !== "permissions.detail") {
            throw new ContractError(
              "NOT_FOUND",
              `no handler for intent "${intent}"`
            )
          }
          return { ...DETAIL, description }
        },
        command: async (intent: string, payload?: unknown) => {
          if (intent !== "permissions.update") {
            throw new ContractError(
              "NOT_FOUND",
              `no handler for command "${intent}"`
            )
          }
          description = (payload as { description: string }).description
          queryStore.invalidate("warden", [
            "permissions.list",
            "permissions.detail",
            "subjects.detail",
          ])
          return { id: "perm_01a" }
        },
      } as ScopedClient
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = await openEdit()
      fireEvent.change(input, { target: { value: "read any document" } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      expect(await screen.findByText("read any document")).toBeTruthy()
      await waitFor(() =>
        expect(screen.queryByLabelText("Description")).toBeNull()
      )
      expect(queried.filter((q) => q === "permissions.detail").length).toBe(2)
      const trigger = screen.getByRole("button", { name: "Edit description" })
      await waitFor(() => expect(document.activeElement).toBe(trigger))
    })

    it("clears an earlier refusal when the form opens again", async () => {
      const { client: c } = refusing(
        new ContractError("INTERNAL", "store down")
      )
      renderPage(WardenPermissionDetailPage, c, { id: "perm_01a" })
      const input = await openEdit()
      fireEvent.change(input, { target: { value: "read any document" } })
      fireEvent.click(screen.getByRole("button", { name: "Save description" }))
      await screen.findByRole("alert")
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
      await waitFor(() =>
        expect(screen.queryByLabelText("Description")).toBeNull()
      )
      fireEvent.click(screen.getByRole("button", { name: "Edit description" }))
      await screen.findByLabelText("Description")
      expect(screen.queryByRole("alert")).toBeNull()
    })
  })
})
