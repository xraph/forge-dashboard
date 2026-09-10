import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { SETTINGS_INTENTS, settingsPanelFor } from "@forge-go/dashboard-plugin-authsome/sub/settings-panel"
import { renderSubPage, subStubClient } from "./harness"

const namespaceAnswer = {
  namespace: "mfa",
  displayName: "Multi-Factor Auth",
  scope: "app",
  categories: [
    {
      name: "Enforcement",
      settings: [
        {
          key: "require_mfa", displayName: "Require MFA", type: "bool",
          effectiveValue: false, isOverridden: false, isEnforced: false,
          canOverride: true, order: 1,
        },
      ],
    },
    {
      name: "Codes",
      settings: [
        {
          key: "code_length", displayName: "Code length", type: "int",
          effectiveValue: 6, default: 6, isOverridden: false,
          isEnforced: false, canOverride: true, order: 2,
        },
      ],
    },
  ],
}

describe("settingsPanelFor", () => {
  it("reads its namespace through the HOST client, not its own", async () => {
    // stubClient's `payloads` array records only commands, not queries, so a
    // query's params are read back by having the answer capture what it was
    // called with, rather than off `host.payloads` as the plan first assumed.
    let queryParams: unknown
    const host = subStubClient({
      "settings.namespace": (params: unknown) => {
        queryParams = params
        return namespaceAnswer
      },
    })
    const own = subStubClient({})
    const Panel = settingsPanelFor("mfa")

    renderSubPage(Panel, { client: own.client, hostClient: host.client, allowed: [...SETTINGS_INTENTS] })

    await waitFor(() => expect(screen.getByText("Require MFA")).toBeTruthy())
    // The whole point of hostIntents: the read went to auth, not to mfa.
    expect(host.intents).toEqual(["settings.namespace"])
    expect(own.intents).toEqual([])
    expect(queryParams).toEqual({ namespace: "mfa", scope: "app" })
  })

  it("shows fields from every category, grouped by category name", async () => {
    const host = subStubClient({ "settings.namespace": namespaceAnswer })
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: [...SETTINGS_INTENTS] })

    await waitFor(() => expect(screen.getByText("Require MFA")).toBeTruthy())
    // A namespace whose second category is dropped renders a panel that looks
    // complete and is missing half its settings, which is why this asserts on
    // both.
    expect(screen.getByText("Code length")).toBeTruthy()
    expect(screen.getByText("Enforcement")).toBeTruthy()
    expect(screen.getByText("Codes")).toBeTruthy()
  })

  it("sends one settings.update per changed key, through the host", async () => {
    const host = subStubClient(
      { "settings.namespace": namespaceAnswer },
      { "settings.update": { ok: true } },
    )
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: [...SETTINGS_INTENTS] })

    await waitFor(() => expect(screen.getByText("Code length")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Code length"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(host.payloads).toHaveLength(1))
    expect(host.payloads[0]).toEqual({
      intent: "settings.update",
      payload: { key: "code_length", value: 8, scope: "app" },
    })
  })

  it("throws when it reaches an intent outside its allowlist", () => {
    const Panel = settingsPanelFor("mfa")
    // An allowlist that does not carry settings.namespace is a mistake in the
    // sub-plugin's own declaration, and it should be as loud as definePlugin's
    // import-time validation rather than a quiet empty panel.
    expect(() =>
      renderSubPage(Panel, {
        client: subStubClient({}).client,
        hostClient: subStubClient({}).client,
        allowed: ["settings.update"],
        catchErrors: true,
      }),
    ).toThrow(/settings\.namespace/)
  })

  it("offers no reset-to-default control", async () => {
    const host = subStubClient({ "settings.namespace": namespaceAnswer })
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: [...SETTINGS_INTENTS] })

    await waitFor(() => expect(screen.getByText("Code length")).toBeTruthy())
    // settings.update passes its value straight to Manager.Set, so a reset
    // button would write a literal null rather than clearing the override.
    // The intent that clears one is not exposed. See the platform decisions
    // doc. Kit's SettingsForm does render its own "Reset" button, but that one
    // only discards unsaved local edits back to the last-read value -- it
    // never reaches the server. There is still no control anywhere in this
    // panel that clears an override, which is the property this test is
    // actually guarding, so it targets that server-facing verb by name rather
    // than the word "reset".
    expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /clear override/i })).toBeNull()
  })
})
