import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ReactNode } from "react"
import { SettingsTab } from "../src/workspace/settings-tab"
import type { Settings } from "../src/workspace/draft"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

afterEach(cleanup)

const detail = templateDetail()
const SETTINGS: Settings = { name: "Receipt", category: "transactional", enabled: true }

function setup(over: { settings?: Settings; isSystem?: boolean; deleteAnswer?: unknown } = {}) {
  const onChange = vi.fn()
  const navigate = vi.fn()
  const { client, sent } = scriptedClient({}, { "templates.delete": over.deleteAnswer ?? { ok: true, id: detail.id } })
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>, navigate }}>
        <SettingsTab template={{ ...detail, isSystem: over.isSystem ?? false }} settings={over.settings ?? SETTINGS} onChange={onChange} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { onChange, navigate, sent }
}

describe("SettingsTab", () => {
  it("edits name, category and enabled into the draft", () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Receipts" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, name: "Receipts" })
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "marketing" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, category: "marketing" })
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, enabled: false })
  })

  it("says a template needs a name", () => {
    setup({ settings: { ...SETTINGS, name: "  " } })
    expect(screen.getByText("A template needs a name.")).toBeTruthy()
  })

  it("ties the missing name message to the name input", () => {
    setup({ settings: { ...SETTINGS, name: "" } })
    const input = screen.getByLabelText("Name")
    const message = document.getElementById(input.getAttribute("aria-describedby") ?? "")
    expect(message?.textContent).toBe("A template needs a name.")
  })

  it("shows slug and channel read only and says why", () => {
    setup()
    const slug = screen.getByText("billing.receipt")
    expect(slug.className).toContain("font-mono")
    expect(screen.getByText(/Slug and channel can't change: callers send by slug, and the pair is the template's identity\./)).toBeTruthy()
  })

  it("names what a delete stops and sends only the ID, then goes to the list", async () => {
    const { sent, navigate } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Delete Receipt?")).toBeTruthy()
    expect(within(dialog).getByText("Sends that name billing.receipt on email will fail. Its 2 versions go with it, and this can't be undone.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "templates.delete", payload: { id: detail.id } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/templates"))
  })

  it("says a reset brings a system template back", () => {
    setup({ isSystem: true })
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    expect(within(screen.getByRole("alertdialog")).getByText(/Resetting system templates brings it back\./)).toBeTruthy()
  })

  it("keeps the dialog open with the refusal when a delete fails", async () => {
    const { navigate } = setup({ deleteAnswer: new ContractError("NOT_FOUND", "template not found") })
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    const dialog = screen.getByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }))
    expect(await within(dialog).findByText("template not found")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
