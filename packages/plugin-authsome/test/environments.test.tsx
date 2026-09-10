import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { AuthEnvironmentDetailPage } from "../src/pages/environment-detail"
import { AuthEnvironmentsPage } from "../src/pages/environments"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

const envsAnswer = {
  environments: [
    { id: "env_1", name: "Production", slug: "production", type: "production", isDefault: true, createdAt: "2026-01-01T00:00:00Z" },
    { id: "env_2", name: "Staging", slug: "staging", type: "staging", isDefault: false, createdAt: "2026-01-02T00:00:00Z" },
  ],
}

describe("AuthEnvironmentsPage", () => {
  it("lists environments with a default badge on the default one", async () => {
    const { client } = stubClient({ "environments.list": envsAnswer })
    renderPage(AuthEnvironmentsPage, client)

    await waitFor(() => expect(screen.getByText("Production")).toBeTruthy())
    expect(screen.getByText("Staging")).toBeTruthy()
    expect(screen.getByText("default")).toBeTruthy()
    expect(screen.getByText("not default")).toBeTruthy()
    expect(screen.getByText("2 environments")).toBeTruthy()
  })

  it("offers no 'Make default' and no Delete on the default environment, and offers both on a normal one", async () => {
    const { client } = stubClient({ "environments.list": envsAnswer })
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Production")).toBeTruthy())

    expect(screen.queryByRole("button", { name: "Make Production the default" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Delete Production" })).toBeNull()
    expect(screen.getByRole("button", { name: "Make Staging the default" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Delete Staging" })).toBeTruthy()
    // Clone is offered on every environment, default included.
    expect(screen.getByRole("button", { name: "Clone Production" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Clone Staging" })).toBeTruthy()
  })

  it("makes a non-default environment the default with no confirmation dialog", async () => {
    const { client, sent } = recordingCommandClient(
      { "environments.list": envsAnswer },
      { "environments.setDefault": { ok: true } },
    )
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Staging")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Make Staging the default" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "environments.setDefault", payload: { id: "env_2" } })
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("confirms before deleting, and sends only the id", async () => {
    const { client, sent } = recordingCommandClient(
      { "environments.list": envsAnswer },
      { "environments.delete": { ok: true } },
    )
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Staging")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete Staging" }))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/Everything scoped to this environment goes with it/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "environments.delete", payload: { id: "env_2" } })
  })

  it("clones with the shape the Go handler declares: sourceId, name, slug and an optional type", async () => {
    const { client, sent } = recordingCommandClient(
      { "environments.list": envsAnswer },
      { "environments.clone": { ok: true, id: "env_3" } },
    )
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Production")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Clone Production" }))
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "Production Copy" } })
    fireEvent.change(screen.getByLabelText("New slug"), { target: { value: "production-copy" } })
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "staging" } })
    fireEvent.click(screen.getByRole("button", { name: "Clone" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "environments.clone",
      payload: { sourceId: "env_1", name: "Production Copy", slug: "production-copy", type: "staging" },
    })
  })

  it("omits the clone's type when left blank, rather than sending an empty string", async () => {
    const { client, sent } = recordingCommandClient(
      { "environments.list": envsAnswer },
      { "environments.clone": { ok: true } },
    )
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Staging")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Clone Staging" }))
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "Staging Copy" } })
    fireEvent.change(screen.getByLabelText("New slug"), { target: { value: "staging-copy" } })
    fireEvent.click(screen.getByRole("button", { name: "Clone" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ sourceId: "env_2", name: "Staging Copy", slug: "staging-copy" })
    expect("type" in (sent[0].payload as object)).toBe(false)
  })

  it("creates an environment, omitting type, description and color when left empty", async () => {
    const { client, sent } = recordingCommandClient(
      { "environments.list": envsAnswer },
      { "environments.create": { ok: true, id: "env_4" } },
    )
    renderPage(AuthEnvironmentsPage, client)
    await waitFor(() => expect(screen.getByText("Production")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New environment" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sandbox" } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "sandbox" } })
    fireEvent.click(screen.getByRole("button", { name: "Create environment" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "environments.create", payload: { name: "Sandbox", slug: "sandbox" } })
  })
})

describe("AuthEnvironmentDetailPage", () => {
  const detail = {
    "environments.detail": {
      id: "env_2",
      name: "Staging",
      slug: "staging",
      type: "staging",
      isDefault: false,
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
      description: "Pre-production checks",
      metadata: {},
    },
  }

  it("shows the environment's fields", async () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthEnvironmentDetailPage params={{ id: "env_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "Staging" })).toBeTruthy())
    // "Pre-production checks" also shows up as the edit panel's seeded
    // textarea value, so this checks presence rather than a single match.
    expect(screen.getAllByText("Pre-production checks").length).toBeGreaterThan(0)
  })

  it("sends only the changed field when renaming, never an untouched description", async () => {
    const { client, sent } = recordingCommandClient(detail, { "environments.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthEnvironmentDetailPage params={{ id: "env_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Staging Renamed" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // environments.update takes pointers. An untouched field must be absent
    // from the payload, not sent as "". Asserting the value equals "" would
    // prove the bug rather than the fix, so this asserts presence instead.
    const payload = sent[0].payload as Record<string, unknown>
    expect(payload).toEqual({ id: "env_2", name: "Staging Renamed" })
    expect("description" in payload).toBe(false)
    expect("color" in payload).toBe(false)
  })

  it("sends a deliberately cleared description as an empty string, present in the payload", async () => {
    const { client, sent } = recordingCommandClient(detail, { "environments.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthEnvironmentDetailPage params={{ id: "env_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Description")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0].payload as Record<string, unknown>
    expect("description" in payload).toBe(true)
    expect(payload.description).toBe("")
    expect("name" in payload).toBe(false)
  })

  it("says so plainly when the route carries no id", () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthEnvironmentDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No environment selected.")).toBeTruthy()
  })
})
