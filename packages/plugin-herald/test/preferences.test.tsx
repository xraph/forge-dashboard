import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { PreferencesPage } from "../src/pages/preferences"
import { engine } from "./data"
import { invalidatingClient, renderPage, scriptedClient } from "./harness"

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

const GET = {
  preference: {
    id: "hprf_01j00000000000000000003000",
    userId: "usr_ada",
    overrides: {
      "auth.welcome": { email: null, sms: null, push: null, inapp: false },
      "marketing.weekly": { email: false, sms: true, push: null, inapp: null },
    },
    updatedAt: "2026-09-23T10:00:00Z",
  },
  knownTypes: ["auth.password-reset", "auth.welcome"],
}

async function typeUser(value: string) {
  fireEvent.change(await screen.findByLabelText("User ID"), { target: { value } })
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}

function setup(get: object = GET) {
  return scriptedClient({ "engine.info": engine(), "preferences.get": get }, { "preferences.optOut": (p) => ({ preference: { ...GET.preference, userId: String(p.userId) } }) })
}

function cell(type: string, column: number): HTMLElement {
  const row = screen.getAllByRole("row").find((r) => within(r).queryByText(type))!
  return within(row).getAllByRole("cell")[column]
}

describe("PreferencesPage", () => {
  it("lists every known type and every type the user touched, once each", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    expect(await screen.findByText("3 notification types for usr_ada")).toBeTruthy()
    for (const type of ["auth.password-reset", "auth.welcome", "marketing.weekly"]) expect(screen.getByText(type).className).toMatch(/font-mono text-xs/)
  })

  it("reads null as Default, true as On and false as Opted out", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    await screen.findByText("marketing.weekly")
    expect(cell("marketing.weekly", 1).textContent).toContain("Opted out")
    expect(cell("marketing.weekly", 2).textContent).toContain("On")
    expect(cell("marketing.weekly", 3).textContent).toContain("Default")
    expect(within(cell("marketing.weekly", 1)).queryByRole("button")).toBeNull()
  })

  it("never shows a type with no stored preference as On", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    await screen.findByText("auth.password-reset")
    for (const column of [1, 2, 3, 4]) {
      const text = cell("auth.password-reset", column).textContent ?? ""
      expect(text).toContain("Default")
      expect(text).not.toMatch(/\bOn\b/)
    }
    // A type with a partial record: the unset channels are Default, only the stored one is Opted out.
    expect(cell("auth.welcome", 4).textContent).toContain("Opted out")
    expect(cell("auth.welcome", 1).textContent).toContain("Default")
  })

  it("opts out behind a confirm naming the user, the type and the channel", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.password-reset by sms" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toMatch(/usr_ada/)
    expect(dialog.textContent).toMatch(/auth\.password-reset/)
    expect(dialog.textContent).toMatch(/sms/)
    fireEvent.click(within(dialog).getByRole("button", { name: "Opt out" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "preferences.optOut", payload: { userId: "usr_ada", type: "auth.password-reset", channel: "sms" } }]))
  })

  it("sends nothing until the confirm is accepted, and nothing when it is cancelled", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.welcome by email" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(c.sent).toEqual([])
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(c.sent).toEqual([])
  })

  it("offers no way back in, and says why", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    await screen.findByText("marketing.weekly")
    expect(screen.getByText(/can't be undone here/)).toBeTruthy()
    for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(/opt in|opt back|turn on|enable|reset|clear|undo|restore|default/i)
    // Every control in the matrix is an opt-out, and none sits on a cell that is already opted out.
    const matrix = screen.getAllByRole("button").filter((b) => b.closest("table"))
    expect(matrix.length).toBe(10)
    for (const button of matrix) expect(button.getAttribute("aria-label")).toMatch(/^Opt usr_ada out of /)
    expect(screen.queryByRole("switch")).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("offers no way back in once an opt-out has been recorded either", async () => {
    const c = invalidatingClient(
      {
        "engine.info": engine(),
        "preferences.get": (_input, call) => (call === 0 ? GET : { ...GET, preference: { ...GET.preference, overrides: { ...GET.preference.overrides, "auth.welcome": { email: null, sms: true, push: null, inapp: false } } } }),
      },
      { "preferences.optOut": { answer: { preference: GET.preference }, invalidates: ["preferences.get"] } },
    )
    renderPage(PreferencesPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.password-reset by email" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Opt out" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "preferences.get")).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await screen.findByText("auth.welcome")
    for (const button of screen.getAllByRole("button")) expect(button.textContent ?? "").not.toMatch(/opt in|opt back|turn on|enable|reset|clear|undo|restore|default|^on$/i)
  })

  it("says a user with no record gets everything, and still offers opt-outs", async () => {
    renderPage(PreferencesPage, setup({ preference: null, knownTypes: ["auth.welcome"] }).client)
    await typeUser("usr_new")
    expect(await screen.findByText(/No preferences recorded for usr_new/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Opt usr_new out of auth.welcome by email" })).toBeTruthy()
  })

  it("asks for nothing until there is a user", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    expect(await screen.findByText("Enter a user ID to see their preferences.")).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "preferences.get")).toBe(false)
  })

  it("waits for typing to stop before reading a user", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    fireEvent.change(await screen.findByLabelText("User ID"), { target: { value: "usr_a" } })
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(c.queried.some((q) => q.intent === "preferences.get")).toBe(false)
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "usr_ada" } })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    await screen.findByText("marketing.weekly")
    expect(c.queried.filter((q) => q.intent === "preferences.get").map((q) => q.params)).toEqual([{ userId: "usr_ada" }])
  })

  it("names the app on every state", async () => {
    const c = setup()
    renderPage(PreferencesPage, c.client)
    expect(await screen.findByText(/^App:/)).toBeTruthy()
    await typeUser("usr_ada")
    await screen.findByText("marketing.weekly")
    expect(screen.getByText(/^App:/)).toBeTruthy()
  })

  it("names the app when the preferences read fails", async () => {
    renderPage(PreferencesPage, scriptedClient({ "engine.info": engine(), "preferences.get": new ContractError("INTERNAL", "boom") }).client)
    await typeUser("usr_ada")
    expect(await screen.findByText(/boom/)).toBeTruthy()
    expect(screen.getByText(/^App:/)).toBeTruthy()
  })

  it("says why an opt-out failed, inside the dialog, and keeps the dialog open", async () => {
    const c = scriptedClient({ "engine.info": engine(), "preferences.get": GET }, { "preferences.optOut": new ContractError("BAD_REQUEST", "channel must be email, sms, push or inapp") })
    renderPage(PreferencesPage, c.client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.welcome by email" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Opt out" }))
    expect(await within(await screen.findByRole("alertdialog")).findByText(/channel must be/)).toBeTruthy()
  })

  it("keeps the dialog's words and the success note while its own refetch runs, and ends on Opted out", async () => {
    const { client: base, queried } = invalidatingClient(
      {
        "engine.info": engine(),
        "preferences.get": (_input, call) =>
          call === 0
            ? GET
            : { ...GET, preference: { ...GET.preference, overrides: { ...GET.preference.overrides, "auth.password-reset": { email: null, sms: false, push: null, inapp: null } } } },
      },
      { "preferences.optOut": { answer: { preference: GET.preference }, invalidates: ["preferences.get"] } },
    )
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = {
      ...base,
      command: async (intent: string, payload?: unknown) => {
        const out = await base.command(intent, payload)
        await gate
        return out
      },
    } as typeof base
    renderPage(PreferencesPage, client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.password-reset by sms" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Opt out" }))
    await waitFor(() => expect(queried.filter((q) => q.intent === "preferences.get")).toHaveLength(2))
    // The table is mid-refetch (a skeleton), and the dialog still names what it was opened on.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Opt usr_ada out of auth.welcome by email" })).toBeNull())
    expect(screen.getByRole("alertdialog").textContent).toMatch(/usr_ada/)
    expect(screen.getByRole("alertdialog").textContent).toMatch(/auth\.password-reset/)
    expect(screen.getByRole("alertdialog").textContent).toMatch(/sms/)
    release()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    // The note about what just happened is outside the boundary, so the refetch did not take it.
    expect(await screen.findByText("usr_ada is now opted out of auth.password-reset by sms.")).toBeTruthy()
    await waitFor(() => expect(cell("auth.password-reset", 2).textContent).toContain("Opted out"))
    expect(screen.getByText("usr_ada is now opted out of auth.password-reset by sms.")).toBeTruthy()
  })

  it("keeps the success note mounted and empty until the opt-out lands, so a screen reader announces it", async () => {
    const { container } = renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.welcome by email" }))
    const note = container.querySelector('p[role="status"]')
    expect(note).not.toBeNull()
    expect(note!.textContent).toBe("")
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Opt out" }))
    await screen.findByText("usr_ada is now opted out of auth.welcome by email.")
    expect(container.querySelector('p[role="status"]')).toBe(note)
  })

  it("drops the success note when the user changes", async () => {
    renderPage(PreferencesPage, setup().client)
    await typeUser("usr_ada")
    fireEvent.click(await screen.findByRole("button", { name: "Opt usr_ada out of auth.welcome by email" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Opt out" }))
    expect(await screen.findByText("usr_ada is now opted out of auth.welcome by email.")).toBeTruthy()
    await typeUser("usr_bo")
    await waitFor(() => expect(screen.queryByText(/is now opted out/)).toBeNull())
  })
})
