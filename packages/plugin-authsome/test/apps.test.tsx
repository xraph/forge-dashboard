import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { AuthAppCreatePage } from "../src/pages/app-create"
import { AuthAppDetailPage } from "../src/pages/app-detail"
import { AuthAppsPage } from "../src/pages/apps"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

const appsAnswer = {
  apps: [
    { id: "app_1", name: "Core", slug: "core", isPlatform: true, createdAt: "2026-01-01T00:00:00Z" },
    { id: "app_2", name: "Storefront", slug: "storefront", isPlatform: false, createdAt: "2026-01-02T00:00:00Z" },
  ],
}

describe("AuthAppsPage", () => {
  it("lists apps with a platform badge on the platform app and an app badge on the rest", async () => {
    const { client } = stubClient({ "apps.list": appsAnswer })
    renderPage(AuthAppsPage, client)

    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())
    expect(screen.getByText("Storefront")).toBeTruthy()
    expect(screen.getByText("platform")).toBeTruthy()
    expect(screen.getByText("app")).toBeTruthy()
    expect(screen.getByText("2 apps")).toBeTruthy()
  })

  it("offers no Delete button at all on the platform app, and a working one on a normal app", async () => {
    const { client } = stubClient({ "apps.list": appsAnswer })
    renderPage(AuthAppsPage, client)
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())

    expect(screen.queryByRole("button", { name: "Delete Core" })).toBeNull()
    expect(screen.getByRole("button", { name: "Delete Storefront" })).toBeTruthy()
  })

  it("confirms before deleting a normal app, warning what goes with it", async () => {
    const { client, sent } = recordingCommandClient(
      { "apps.list": appsAnswer },
      { "apps.delete": { ok: true } },
    )
    renderPage(AuthAppsPage, client)
    await waitFor(() => expect(screen.getByText("Storefront")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete Storefront" }))
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/Everything scoped to this app goes with it/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "apps.delete", payload: { id: "app_2" } })
  })
})

describe("AuthAppsPage stale command state across rows", () => {
  // Both non-platform, so both show a Delete button - the platform app in
  // `appsAnswer` has none.
  const twoDeletable = {
    apps: [
      { id: "app_1", name: "Core", slug: "core", isPlatform: false, createdAt: "2026-01-01T00:00:00Z" },
      { id: "app_2", name: "Storefront", slug: "storefront", isPlatform: false, createdAt: "2026-01-02T00:00:00Z" },
    ],
  }

  it("does not carry one app's delete error into another app's delete dialog", async () => {
    const { client } = recordingCommandClient(
      { "apps.list": twoDeletable },
      {
        "apps.delete": (payload?: unknown) =>
          (payload as { id: string }).id === "app_1"
            ? new ContractError("VALIDATION", "cannot delete an app with active users")
            : { ok: true },
      },
    )
    renderPage(AuthAppsPage, client)
    await waitFor(() => expect(screen.getByText("Core")).toBeTruthy())

    // Delete Core, let it fail, see the reason.
    fireEvent.click(screen.getByRole("button", { name: "Delete Core" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const failure = await screen.findByRole("alert", { hidden: true })
    expect(failure.textContent).toContain("cannot delete an app with active users")

    // Back out, then open the same dialog pointed at Storefront instead.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "Delete Storefront" }))

    // Storefront has not been touched. Core's failure must not show up here.
    expect(screen.getByText(/Delete Storefront\?/)).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText("cannot delete an app with active users")).toBeNull()
  })
})

describe("AuthAppCreatePage", () => {
  it("sends name and slug with no logo key when the field is left empty", async () => {
    const { client, sent } = recordingCommandClient({}, { "apps.create": { ok: true, id: "app_3" } })
    renderPage(AuthAppCreatePage, client)

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "New App" } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "new-app" } })
    fireEvent.click(screen.getByRole("button", { name: "Create app" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("apps.create")
    expect(sent[0].payload).toEqual({ name: "New App", slug: "new-app" })
    expect("logo" in (sent[0].payload as object)).toBe(false)
  })

  it("will not create an app without a name and a slug", async () => {
    const { client, sent } = recordingCommandClient({}, { "apps.create": { ok: true } })
    renderPage(AuthAppCreatePage, client)
    expect((screen.getByRole("button", { name: "Create app" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toHaveLength(0)
  })
})

describe("AuthAppDetailPage", () => {
  const detail = {
    "apps.detail": {
      id: "app_2",
      name: "Storefront",
      slug: "storefront",
      isPlatform: false,
      createdAt: "2026-01-02T00:00:00Z",
      updatedAt: "2026-02-01T00:00:00Z",
      publishableKey: "pk_live_abc123",
      metadata: {},
    },
  }

  it("shows the app's fields, including a copy control next to the publishable key", async () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthAppDetailPage params={{ id: "app_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "Storefront" })).toBeTruthy())
    expect(screen.getByText("pk_live_abc123")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy publishable key" })).toBeTruthy()
  })

  it("sends only the changed field when renaming, never an untouched slug", async () => {
    const { client, sent } = recordingCommandClient(detail, { "apps.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthAppDetailPage params={{ id: "app_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Storefront Renamed" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // apps.update takes pointers. An untouched field must be absent from the
    // payload, not sent as "". Asserting the value equals "" would prove the
    // bug rather than the fix, so this asserts presence instead.
    expect(sent[0].intent).toBe("apps.update")
    const payload = sent[0].payload as Record<string, unknown>
    expect(payload).toEqual({ id: "app_2", name: "Storefront Renamed" })
    expect("slug" in payload).toBe(false)
    expect("logo" in payload).toBe(false)
  })

  it("sends a deliberately cleared field as an empty string, present in the payload", async () => {
    const { client, sent } = recordingCommandClient(detail, { "apps.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthAppDetailPage params={{ id: "app_2" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Slug")).toBeTruthy())

    // The operator deliberately clears the slug field rather than leaving it
    // untouched. That must arrive as a present, empty-string key so the
    // server can tell "cleared" apart from "not sent".
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    const payload = sent[0].payload as Record<string, unknown>
    expect("slug" in payload).toBe(true)
    expect(payload.slug).toBe("")
    expect("name" in payload).toBe(false)
  })

  it("says so plainly when the route carries no id", () => {
    const { client } = stubClient(detail)
    render(
      <PluginProvider client={client}>
        <AuthAppDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No app selected.")).toBeTruthy()
  })
})
