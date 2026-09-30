import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { PolicyCreatePage, categoryProblem } from "../src/pages/policy-create"
import { scriptedClient } from "./harness"

/**
 * jsdom has no PointerEvent, and Base UI's checkbox dispatches through it. A
 * MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const saved = {
  id: "retpol_acme_debug", category: "debug", duration: "720h0m0s", archive: false, appId: "app_chronicle", tenantId: "acme",
  createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-29T10:00:00Z", editable: true,
}

function renderCreate(client: ScopedClient) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <PolicyCreatePage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const category = (v: string) => fireEvent.change(screen.getByLabelText("Category"), { target: { value: v } })
const amount = (v: string) => fireEvent.change(screen.getByLabelText("Keep events for"), { target: { value: v } })
const unit = (v: "hours" | "days") => fireEvent.change(screen.getByLabelText("Duration unit"), { target: { value: v } })
const save = () => screen.getByRole("button", { name: "Save policy" }) as HTMLButtonElement

describe("categoryProblem", () => {
  it("allows the wildcard and an ordinary category", () => {
    expect(categoryProblem("*")).toBeNull()
    expect(categoryProblem("debug")).toBeNull()
    expect(categoryProblem("auth/session")).toBeNull()
    expect(categoryProblem("user login")).toBeNull()
    expect(categoryProblem("x".repeat(64))).toBeNull()
  })

  it("refuses what the server refuses", () => {
    expect(categoryProblem("")).toBe("A category is required.")
    expect(categoryProblem("a:b")).toBe("A category cannot contain ':'.")
    expect(categoryProblem("x".repeat(65))).toBe("A category is at most 64 characters.")
    expect(categoryProblem(" debug")).toBe("A category cannot start or end with a space.")
    expect(categoryProblem("debug ")).toBe("A category cannot start or end with a space.")
    expect(categoryProblem("a\u0000b")).toBe("A category cannot contain control characters.")
    expect(categoryProblem("a\u007fb")).toBe("A category cannot contain control characters.")
    // Go's unicode.Cc includes the C1 block, so the server refuses these too.
    expect(categoryProblem("a\u0085b")).toBe("A category cannot contain control characters.")
  })

  it("counts characters, not UTF-16 units", () => {
    expect(categoryProblem("\u{1F600}".repeat(64))).toBeNull()
    expect(categoryProblem("\u{1F600}".repeat(65))).toBe("A category is at most 64 characters.")
  })
})

describe("PolicyCreatePage", () => {
  it("states that * is not a default, and who an app-wide policy governs", () => {
    renderCreate(scriptedClient({}).client)
    expect(screen.getByText(/A category of \* means every category, not a default/)).toBeTruthy()
    expect(
      screen.getByText("A policy saved by an app-wide operator has no tenant, so it removes events from every tenant in the app."),
    ).toBeTruthy()
  })

  it("refuses a category the server would refuse before sending, and says why", () => {
    renderCreate(scriptedClient({}).client)
    amount("30")
    category("a:b")
    expect(screen.getByText("A category cannot contain ':'.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    category("x".repeat(65))
    expect(screen.getByText("A category is at most 64 characters.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    category(" debug")
    expect(screen.getByText("A category cannot start or end with a space.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    category("*")
    expect(save().disabled).toBe(false)
    category("debug")
    expect(save().disabled).toBe(false)
    expect(screen.queryByText(/A category cannot/)).toBeNull()
  })

  it("starts in days, so a bare number errs toward keeping events longer, not deleting them sooner", () => {
    renderCreate(scriptedClient({}).client)
    expect((screen.getByLabelText("Duration unit") as HTMLSelectElement).value).toBe("days")
  })

  it("refuses a zero, a fraction and a word as a duration", () => {
    renderCreate(scriptedClient({}).client)
    category("debug")
    expect(save().disabled).toBe(true)
    amount("0")
    expect(screen.getByText("A duration must be greater than zero.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    amount("1.5")
    expect(screen.getByText("Enter a whole number of hours or days.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    amount("soon")
    expect(save().disabled).toBe(true)
    amount("-3")
    expect(save().disabled).toBe(true)
    amount("48")
    expect(save().disabled).toBe(false)
  })

  it("refuses a duration longer than Go can hold", () => {
    renderCreate(scriptedClient({}).client)
    category("debug")
    unit("hours")
    amount("2562048")
    expect(screen.getByText("That is longer than a duration can be.")).toBeTruthy()
    expect(save().disabled).toBe(true)
    amount("2562047")
    expect(save().disabled).toBe(false)
    unit("days")
    expect(save().disabled).toBe(true)
  })

  it("sends hours as a Go duration string", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": saved })
    renderCreate(c.client)
    category("debug")
    unit("hours")
    amount("48")
    fireEvent.click(save())
    await waitFor(() => expect(c.sent).toEqual([{ intent: "retention.savePolicy", payload: { category: "debug", duration: "48h", archive: false } }]))
  })

  it("sends days as hours, times 24, and the archive choice", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": saved })
    renderCreate(c.client)
    category("*")
    amount("30")
    unit("days")
    fireEvent.click(screen.getByRole("checkbox", { name: "Archive events before removing them" }))
    fireEvent.click(save())
    await waitFor(() => expect(c.sent).toEqual([{ intent: "retention.savePolicy", payload: { category: "*", duration: "720h", archive: true } }]))
  })

  it("sends no id, so the server creates rather than updates", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": saved })
    renderCreate(c.client)
    category("debug")
    amount("1")
    fireEvent.click(save())
    await waitFor(() => expect(c.sent).toHaveLength(1))
    expect(Object.keys(c.sent[0].payload as object).sort()).toEqual(["archive", "category", "duration"])
  })

  it("goes to the new policy's page after a save", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": saved })
    const { navigate } = renderCreate(c.client)
    category("debug")
    amount("30")
    unit("days")
    fireEvent.click(save())
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/retention/retpol_acme_debug"))
  })

  it("says a second policy for the same category already exists, and stays put", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": new ContractError("CONFLICT", "a retention policy for this category already exists in this scope") })
    const { navigate } = renderCreate(c.client)
    category("debug")
    amount("30")
    fireEvent.click(save())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("A policy for this category already exists in your scope.")
    expect(alert.textContent).not.toContain("a retention policy for this category")
    expect(navigate).not.toHaveBeenCalled()
    // Nothing was lost, so the operator can change the category and try again.
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("debug")
  })

  it("shows any other refusal with its message and code", async () => {
    const c = scriptedClient({}, { "retention.savePolicy": new ContractError("PERMISSION_DENIED", "") })
    const { navigate } = renderCreate(c.client)
    category("debug")
    amount("30")
    fireEvent.click(save())
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("PERMISSION_DENIED")
    expect(alert.textContent).not.toContain("already exists")
    expect(navigate).not.toHaveBeenCalled()
  })
})
