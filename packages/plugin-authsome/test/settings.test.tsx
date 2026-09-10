import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { flattenCategories, toDescriptors } from "../src/settings-fields"
import { AuthSettingsPage } from "../src/pages/settings"
import { AuthSettingsNamespacePage } from "../src/pages/settings-namespace"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

const base = {
  key: "min_length", displayName: "Minimum length", type: "int",
  isOverridden: false, isEnforced: false, canOverride: true, order: 1,
}

describe("flattenCategories", () => {
  it("pulls the fields out of their categories", () => {
    const out = flattenCategories({
      namespace: "password", scope: "app",
      categories: [
        { name: "Strength", settings: [{ ...base, key: "min_length" }] },
        { name: "Hashing", settings: [{ ...base, key: "algorithm" }] },
      ],
    })
    expect(out.map((f) => f.key)).toEqual(["min_length", "algorithm"])
  })

  it("uses the category name as the section when a field has none", () => {
    const out = flattenCategories({
      namespace: "password", scope: "app",
      categories: [{ name: "Strength", settings: [{ ...base, key: "a" }, { ...base, key: "b", section: "Own" }] }],
    })
    expect(out[0].section).toBe("Strength")
    // A field that names its own section keeps it. The category is a
    // fallback, not an override.
    expect(out[1].section).toBe("Own")
  })

  it("answers an empty list for undefined, rather than throwing", () => {
    // The page calls this while the query is still loading.
    expect(flattenCategories(undefined)).toEqual([])
  })
})

describe("toDescriptors", () => {
  it("shows the effective value, falling back to the default when unset", () => {
    expect(toDescriptors([{ ...base, effectiveValue: 12, default: 8 }])[0].value).toBe(12)
    expect(toDescriptors([{ ...base, default: 8 }])[0].value).toBe(8)
  })

  it("treats enforced and cannot-override as the same thing to the operator", () => {
    expect(toDescriptors([{ ...base, isEnforced: true }])[0].enforced).toBe(true)
    expect(toDescriptors([{ ...base, canOverride: false }])[0].enforced).toBe(true)
    expect(toDescriptors([base])[0].enforced).toBe(false)
  })

  it("keeps read-only separate from enforced, because they mean different things", () => {
    const d = toDescriptors([{ ...base, readOnly: true }])[0]
    expect(d.readOnly).toBe(true)
    expect(d.enforced).toBe(false)
  })

  it("masks a sensitive field whatever its inputType says", () => {
    const d = toDescriptors([{ ...base, sensitive: true, inputType: "text" }])[0]
    // A sensitive value rendered as plain text is the kind of leak that shows
    // up in a screen-share.
    expect(d.type).toBe("secret")
  })

  it("maps the contract's types onto kit's", () => {
    expect(toDescriptors([{ ...base, type: "bool" }])[0].type).toBe("boolean")
    expect(toDescriptors([{ ...base, type: "int" }])[0].type).toBe("number")
    expect(toDescriptors([{ ...base, type: "float" }])[0].type).toBe("number")
    expect(toDescriptors([{ ...base, type: "string" }])[0].type).toBe("string")
    expect(
      toDescriptors([{ ...base, type: "string", options: [{ label: "A", value: "a" }] }])[0].type,
    ).toBe("select")
  })

  it("falls back to string for a type it has never heard of", () => {
    // A newer server may declare a type this UI predates. Rendering it as a
    // text box is wrong-ish; refusing to render the namespace at all is worse.
    expect(toDescriptors([{ ...base, type: "duration" }])[0].type).toBe("string")
  })

  it("sorts by order, then carries section, help and validation through", () => {
    const out = toDescriptors([
      { ...base, key: "b", order: 2, section: "S", helpText: "h" },
      { ...base, key: "a", order: 1, validation: { required: true, min: 1, max: 9 } },
    ])
    expect(out.map((d) => d.key)).toEqual(["a", "b"])
    expect(out[1].section).toBe("S")
    expect(out[1].helpText).toBe("h")
    expect(out[0].required).toBe(true)
    expect(out[0].min).toBe(1)
    expect(out[0].max).toBe(9)
  })
})

const namespacesAnswer = {
  namespaces: [
    { name: "password", displayName: "Password", description: "Password rules", settingCount: 2 },
  ],
}

describe("AuthSettingsPage", () => {
  it("lists namespaces and links each one to its own page", async () => {
    const { client } = stubClient({ "settings.namespaces": namespacesAnswer })
    renderPage(AuthSettingsPage, client)
    await waitFor(() => expect(screen.getByText("Password")).toBeTruthy())

    const link = screen.getByRole("link", { name: "Password" })
    expect(link.getAttribute("href")).toBe("/@auth/settings/password")
    expect(screen.getByText("Password rules")).toBeTruthy()
    expect(screen.getByText("2")).toBeTruthy()
  })

  it("shows a placeholder for a namespace with no description", async () => {
    const { client } = stubClient({
      "settings.namespaces": {
        namespaces: [{ name: "session", settingCount: 0 }],
      },
    })
    renderPage(AuthSettingsPage, client)
    await waitFor(() => expect(screen.getByText("session")).toBeTruthy())
    expect(screen.getByLabelText("no description")).toBeTruthy()
  })
})

/**
 * `min_length` and `max_length` are both overridable, ordinary number fields,
 * so the save tests can change two keys with a plain `fireEvent.change`
 * (jsdom cannot dispatch the native `PointerEvent` Base UI's `Switch` needs,
 * so page tests here stick to text/number inputs and leave boolean-toggle
 * coverage to kit's own `settings-form.test.tsx`). `algorithm` is enforced,
 * so the disabled-field test has something to point at.
 */
const namespaceAnswer = {
  namespace: "password",
  displayName: "Password",
  scope: "app",
  categories: [
    {
      name: "Strength",
      settings: [
        {
          key: "min_length", displayName: "Minimum length", type: "int",
          effectiveValue: 12, default: 8,
          isOverridden: true, isEnforced: false, canOverride: true, order: 1,
        },
        {
          key: "max_length", displayName: "Maximum length", type: "int",
          effectiveValue: 64,
          isOverridden: false, isEnforced: false, canOverride: true, order: 2,
        },
      ],
    },
    {
      name: "Hashing",
      settings: [
        {
          key: "algorithm", displayName: "Algorithm", type: "string",
          effectiveValue: "argon2",
          isOverridden: false, isEnforced: true, canOverride: false, order: 3,
        },
      ],
    },
  ],
}

describe("AuthSettingsNamespacePage", () => {
  it("says so plainly when the route carries no namespace", () => {
    const { client } = stubClient({ "settings.namespace": namespaceAnswer })
    renderPage(AuthSettingsNamespacePage, client, {})
    expect(screen.getByText("No namespace selected.")).toBeTruthy()
  })

  it("renders a field from inside a category with its effective value", async () => {
    const { client } = stubClient({ "settings.namespace": namespaceAnswer })
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Minimum length")).toBeTruthy())
    expect((screen.getByLabelText("Minimum length") as HTMLInputElement).value).toBe("12")
  })

  it("disables a field the operator cannot override", async () => {
    const { client } = stubClient({ "settings.namespace": namespaceAnswer })
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Algorithm")).toBeTruthy())
    expect((screen.getByLabelText("Algorithm") as HTMLInputElement).disabled).toBe(true)
  })

  it("sends one settings.update per changed key, in order", async () => {
    const { client, sent } = recordingCommandClient(
      { "settings.namespace": namespaceAnswer },
      { "settings.update": { ok: true } },
    )
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Minimum length")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "16" } })
    fireEvent.change(screen.getByLabelText("Maximum length"), { target: { value: "32" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[0]).toEqual({
      intent: "settings.update",
      payload: { key: "min_length", value: 16, scope: "app" },
    })
    expect(sent[1]).toEqual({
      intent: "settings.update",
      payload: { key: "max_length", value: 32, scope: "app" },
    })
  })

  it("stops at the first failed key rather than sending the rest", async () => {
    const { client, sent } = recordingCommandClient(
      { "settings.namespace": namespaceAnswer },
      { "settings.update": new ContractError("VALIDATION", "value too short") },
    )
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Minimum length")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "16" } })
    fireEvent.change(screen.getByLabelText("Maximum length"), { target: { value: "32" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    // The first key fails, so the second must never go out.
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "settings.update",
      payload: { key: "min_length", value: 16, scope: "app" },
    })
  })

  it("never sends an untouched secret back as the redacted placeholder", async () => {
    // A sensitive field with a value set comes back with `effectiveValue`
    // redacted to the literal string "***"; the real value never crosses the
    // wire. Leaving it untouched must never write that placeholder back.
    const withSecret = {
      namespace: "password", displayName: "Password", scope: "app",
      categories: [
        {
          name: "Hashing",
          settings: [
            {
              key: "pepper", displayName: "Pepper", type: "string", sensitive: true,
              effectiveValue: "***",
              isOverridden: true, isEnforced: false, canOverride: true, order: 1,
            },
            {
              key: "min_length", displayName: "Minimum length", type: "int",
              effectiveValue: 12,
              isOverridden: true, isEnforced: false, canOverride: true, order: 2,
            },
          ],
        },
      ],
    }
    const { client, sent } = recordingCommandClient(
      { "settings.namespace": withSecret },
      { "settings.update": { ok: true } },
    )
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Pepper")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Minimum length"), { target: { value: "16" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "settings.update",
      payload: { key: "min_length", value: 16, scope: "app" },
    })
  })

  it("offers no way to reset a setting to its default", async () => {
    // settings.update passes its value straight to Manager.Set with no null
    // check, so sending null would store a literal null rather than clearing
    // the override. The Delete path that would actually clear one is Go work
    // that has not landed, so this page must not offer the control.
    const { client } = stubClient({ "settings.namespace": namespaceAnswer })
    renderPage(AuthSettingsNamespacePage, client, { namespace: "password" })
    await waitFor(() => expect(screen.getByLabelText("Minimum length")).toBeTruthy())

    expect(screen.queryByRole("button", { name: /reset to default/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /default/i })).toBeNull()
  })
})
