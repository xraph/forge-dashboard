import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthRoleDetailPage, AuthRolesPage } from "../src/pages/roles"

const rolesAnswer = {
  roles: [
    { id: "r1", name: "Admin", slug: "admin", description: "Everything", createdAt: "2026-01-01T00:00:00Z" },
  ],
}

describe("AuthRolesPage", () => {
  it("lists roles with their slug", async () => {
    // `stubClient` answers `{ client, intents, payloads }`, not a
    // `ScopedClient` directly - `renderPage`'s second argument needs the
    // `.client` out of that.
    const { client } = stubClient({ "roles.list": rolesAnswer })
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())
    expect(screen.getByText("admin")).toBeTruthy()
  })

  it("creates a role with name, slug and description", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.create": { ok: true, id: "r2" } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Auditor" } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "auditor" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Read only" } })
    fireEvent.click(screen.getByRole("button", { name: "Create role" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "roles.create",
      payload: { name: "Auditor", slug: "auditor", description: "Read only" },
    })
  })

  it("will not create a role without a name and a slug", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.create": { ok: true } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    expect((screen.getByRole("button", { name: "Create role" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it("confirms before deleting, warning that assignments go with it", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.delete": { ok: true } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete Admin" }))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/Anyone assigned this role loses it/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "roles.delete", payload: { id: "r1" } })
  })

  it("shows the server's reason and leaves the delete dialog open when the delete fails", async () => {
    const { client } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.delete": new ContractError("VALIDATION", "role is still in use") },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete Admin" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    // `{ hidden: true }`: the open AlertDialog marks the rest of the page
    // aria-hidden, and testing-library's role queries respect that by default.
    const alert = await screen.findByRole("alert", { hidden: true })
    expect(alert.textContent).toContain("Could not delete")
    expect(alert.textContent).toContain("role is still in use")
    // The dialog stays open on failure: the operator's context is not thrown away.
    expect(screen.getByRole("alertdialog")).toBeTruthy()
  })
})

describe("AuthRoleDetailPage", () => {
  const detail = {
    "roles.detail": {
      id: "r1", name: "Admin", slug: "admin", description: "Everything",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      permissions: [
        { id: "p1", action: "read", resource: "users" },
        { id: "p2", action: "write", resource: "users" },
      ],
    },
  }

  it("shows the role's permissions as action on resource", async () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "Admin" })).toBeTruthy())
    expect(screen.getByText("read")).toBeTruthy()
    expect(screen.getAllByText("users").length).toBeGreaterThan(0)
  })

  it("shows a dash for a role with no parent, app or environment on file", async () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "Admin" })).toBeTruthy())
    // Three absent identifiers (parent, app, environment) each render as a
    // dash carrying an `aria-label`, not as nothing.
    expect(screen.getAllByLabelText("None").length).toBeGreaterThanOrEqual(3)
  })

  it("sends only what changed when renaming, never a blank description", async () => {
    const { client, sent } = recordingCommandClient(detail, { "roles.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Administrator" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // roles.update takes pointers. An untouched description must be absent.
    expect(sent[0]).toEqual({
      intent: "roles.update",
      payload: { id: "r1", name: "Administrator" },
    })
  })

  it("assigns a role to a user with the input shape the Go handler expects", async () => {
    const { client, sent } = recordingCommandClient(detail, { "roles.assign": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getAllByLabelText("User ID")).toHaveLength(2))

    fireEvent.change(screen.getAllByLabelText("User ID")[0], { target: { value: "usr_9" } })
    fireEvent.click(screen.getByRole("button", { name: "Assign" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // AssignRoleInput from handlers_roles.go: { userId, roleId }.
    expect(sent[0]).toEqual({
      intent: "roles.assign",
      payload: { userId: "usr_9", roleId: "r1" },
    })
  })

  it("unassigns a role from a user with the input shape the Go handler expects", async () => {
    const { client, sent } = recordingCommandClient(detail, { "roles.unassign": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getAllByLabelText("User ID")).toHaveLength(2))

    // Two "User ID" fields exist in the aside: assign, then unassign.
    fireEvent.change(screen.getAllByLabelText("User ID")[1], { target: { value: "usr_9" } })
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // UnassignRoleInput from handlers_roles.go: { userId, roleId }.
    expect(sent[0]).toEqual({
      intent: "roles.unassign",
      payload: { userId: "usr_9", roleId: "r1" },
    })
  })

  it("says so plainly when the route carries no id", () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No role selected.")).toBeTruthy()
  })
})
