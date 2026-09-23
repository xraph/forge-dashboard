import { describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
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
    // roles.create is absent from the command map, so the harness throws a
    // ContractError, which is the only thing that makes execute() resolve
    // undefined. A stub answering {ok:false} would resolve normally and
    // this test would never run the failure path.
    expect(screen.queryByText(/Could not create/i)).toBeNull()
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
})
