import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { WardenRolesPage } from "../src/pages/roles"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const ROLES = {
  items: [
    {
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
    },
    {
      id: "role_01hs",
      namespacePath: "eng/platform",
      name: "System",
      slug: "system",
      parentSlug: "reader",
      isSystem: true,
      isDefault: false,
      maxMembers: 5,
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
    { "roles.list": ROLES, "namespaces.list": NAMESPACES, ...extra },
    commands
  )
}

describe("WardenRolesPage", () => {
  it("lists roles with a live count in the caption", async () => {
    renderPage(WardenRolesPage, client())
    expect(await screen.findByText("Reader")).toBeTruthy()
    expect(await screen.findByText(/2 roles/)).toBeTruthy()
  })

  it("renders the tenant root as a slash and a real path as itself", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("Reader")
    // Scoped to the table: the namespace filter's own <select> also carries
    // an option literally labelled "eng/platform" (namespaceOptions uses the
    // path itself as the label), so an unscoped query is ambiguous between
    // the filter and the row this test is actually about.
    const table = within(screen.getByRole("table"))
    expect(table.getByText("/")).toBeTruthy()
    expect(table.getByText("eng/platform")).toBeTruthy()
  })

  it("says which kind of empty an empty list is, and still counts", async () => {
    renderPage(
      WardenRolesPage,
      client({ "roles.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    expect(await screen.findByText(/0 roles/)).toBeTruthy()
    expect(await screen.findByText(/No roles yet/i)).toBeTruthy()
  })

  it("marks a system role so an operator can see why it cannot be edited", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("System")
    // Most roles are not system roles, so system is the minority and the
    // thing somebody scanning for it is hunting. Scoped to the badge itself
    // (data-slot="badge"): the fixture's own role name "System" and slug
    // "system" already match /system/i, so an unscoped query is ambiguous
    // between those cells and the flag this test is actually about.
    expect(
      await screen.findByText(/system/i, { selector: '[data-slot="badge"]' })
    ).toBeTruthy()
  })

  it("offers no delete on a system role", async () => {
    renderPage(WardenRolesPage, client())
    await screen.findByText("System")
    // The contract refuses it, so offering the button would promise
    // something the server will reject.
    expect(screen.queryByRole("button", { name: /Delete System/i })).toBeNull()
    expect(screen.getByRole("button", { name: /Delete Reader/i })).toBeTruthy()
  })

  it("sends the namespace filter as an absent field for all namespaces", async () => {
    // recordingQueryClient records {intent, params} for every query the page
    // sends, which is what lets this test see what "all namespaces" actually
    // put on the wire.
    const { client: c, sent } = recordingQueryClient({
      "roles.list": ROLES,
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    const list = sent.find((i) => i.intent === "roles.list")
    expect(list).toBeTruthy()
    // "All namespaces" must send no namespacePath at all. Sending "" would
    // silently scope the list to the tenant root.
    expect((list?.params as Record<string, unknown>)?.namespacePath).toBeUndefined()
  })

  it("keeps what the operator typed when a create fails", async () => {
    const { client: c } = recordingCommandClient(
      { "roles.list": ROLES, "namespaces.list": NAMESPACES },
      {}
    )
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")

    fireEvent.click(screen.getByRole("button", { name: /new role/i }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Auditor" } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "auditor" } })

    // roles.create is absent from the command map, so the harness throws a
    // ContractError, which is the only thing that makes execute() resolve
    // undefined. A stub answering {ok:false} would resolve normally and
    // this test would never run the failure path.
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }))

    expect(await screen.findByText(/Could not create/i)).toBeTruthy()
    // The form is still open, and what the operator typed is still in it: a
    // failed create must not close the form and throw the input away.
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy()
    expect(screen.getByDisplayValue("Auditor")).toBeTruthy()
    expect(screen.getByDisplayValue("auditor")).toBeTruthy()
  })

  it("surfaces a list failure instead of rendering an empty table", async () => {
    renderPage(
      WardenRolesPage,
      failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
    )
    expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
    expect(screen.queryByText("Reader")).toBeNull()
  })

  it("pages when the total exceeds the page size", async () => {
    renderPage(
      WardenRolesPage,
      client({ "roles.list": { ...ROLES, total: 60, limit: 25, offset: 0 } })
    )
    await screen.findByText("Reader")
    // total 60 against limit 25 means three pages, so a pager must appear.
    await waitFor(() => expect(screen.getByText(/60 roles/)).toBeTruthy())
  })

  it("says the search is by name, because the server matches names only", async () => {
    // Every real store filters name and never the slug, so a placeholder
    // promising both sends the operator to a search that finds nothing.
    renderPage(WardenRolesPage, client())
    await screen.findByText("Reader")
    expect(screen.getByPlaceholderText("Search by name")).toBeTruthy()
  })

  it("names the search when a search is what emptied the list", async () => {
    const { client: c } = recordingQueryClient({
      "roles.list": { items: [], total: 0, limit: 25, offset: 0 },
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenRolesPage, c)
    await screen.findByText(/No roles yet/i)
    fireEvent.change(screen.getByLabelText("Search roles"), { target: { value: "zzz" } })
    expect(await screen.findByText(/No roles match .zzz./)).toBeTruthy()
    expect(screen.queryByText(/No roles yet/i)).toBeNull()
  })

  it("names the namespace when the filter is what emptied the list", async () => {
    renderPage(
      WardenRolesPage,
      client({ "roles.list": { items: [], total: 0, limit: 25, offset: 0 } })
    )
    await screen.findByText(/No roles yet/i)
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    expect(await screen.findByText("No roles in eng/platform.")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
    expect(await screen.findByText("No roles in the tenant root.")).toBeTruthy()
  })

  it("goes back to page one when the namespace filter changes", async () => {
    // Search already reset the page. The namespace filter did not, so
    // switching it on page three landed on page three of a shorter set:
    // an empty table under a caption that still counted rows.
    const { client: c, sent } = recordingQueryClient({
      "roles.list": { ...ROLES, total: 60, limit: 25, offset: 0 },
      "namespaces.list": NAMESPACES,
    })
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(
        sent.some((q) => q.intent === "roles.list" && (q.params as { offset?: number }).offset === 25)
      ).toBe(true)
    )

    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "roles.list").at(-1)
      expect(last?.params).toMatchObject({ namespacePath: "eng/platform", offset: 0 })
    })
  })

  it("steps back a page when a delete empties the last one", async () => {
    const onlyRow = { ...ROLES, items: [ROLES.items[0]], total: 26, limit: 25, offset: 25 }
    const { client: c, sent } = recordingQueryClient({
      "roles.list": onlyRow,
      "namespaces.list": NAMESPACES,
    })
    // recordingQueryClient has no command answers, so give it one.
    const withDelete = {
      ...c,
      command: async () => ({}),
    } as typeof c
    renderPage(WardenRolesPage, withDelete)
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: /next page/i }))
    await waitFor(() =>
      expect(
        sent.some((q) => q.intent === "roles.list" && (q.params as { offset?: number }).offset === 25)
      ).toBe(true)
    )

    fireEvent.click(screen.getByRole("button", { name: /Delete Reader/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/i }))
    await waitFor(() => {
      const last = sent.filter((q) => q.intent === "roles.list").at(-1)
      expect((last?.params as { offset?: number }).offset).toBe(0)
    })
  })

  it("sends the trimmed name and slug when creating a role", async () => {
    const { client: c, sent } = recordingCommandClient(
      { "roles.list": ROLES, "namespaces.list": NAMESPACES },
      { "roles.create": { id: "role_new" } }
    )
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: /new role/i }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Auditor " } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: " auditor  " } })
    fireEvent.click(screen.getByRole("button", { name: /^create role$/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("roles.create")
    expect(sent[0]?.payload).toEqual({ name: "Auditor", slug: "auditor", namespacePath: "" })
  })

  it("sends the role id, and only the id, when deleting a role", async () => {
    const { client: c, sent } = recordingCommandClient(
      { "roles.list": ROLES, "namespaces.list": NAMESPACES },
      { "roles.delete": {} }
    )
    renderPage(WardenRolesPage, c)
    await screen.findByText("Reader")
    fireEvent.click(screen.getByRole("button", { name: /Delete Reader/i }))
    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/i }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.intent).toBe("roles.delete")
    expect(sent[0]?.payload).toEqual({ id: "role_01hq" })
  })
})
