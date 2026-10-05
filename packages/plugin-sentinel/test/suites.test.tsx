import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { SuitesPage } from "../src/pages/suites"
import { suite, SUITE_ID } from "./fixtures"
import { recordingCommandClient, renderNavPage, renderPage, stubClient } from "./harness"

const other = suite({
  id: "suite_01j9se00000000000000000086",
  name: "Billing FAQ",
  model: "",
  promptSource: "suite",
  currentPromptVersion: undefined,
  currentBaseline: undefined,
  caseCount: 4,
})

function openCreate() {
  fireEvent.click(screen.getAllByRole("button", { name: "Create suite" })[0])
  return screen.getByRole("dialog")
}

describe("SuitesPage", () => {
  it("lists suites with a live count, links and the conventions", async () => {
    renderNavPage(SuitesPage, stubClient({ "suites.list": { items: [suite(), other] } }))
    expect(await screen.findByText("2 suites")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Support assistant" })
    expect(link.getAttribute("href")).toBe(`/suites/${SUITE_ID}`)
    expect(link.closest("td")?.className).toContain("font-medium")
    const rows = screen.getAllByRole("row")
    expect(within(rows[1]).getByText("smart").closest("td")?.className).toContain("font-mono")
    expect(within(rows[1]).getByText("Version 2")).toBeTruthy()
    expect(within(rows[1]).getByText("Release 1.4")).toBeTruthy()
    expect(within(rows[2]).getByText("The suite's own prompt")).toBeTruthy()
    expect(within(rows[2]).getByLabelText("no current baseline")).toBeTruthy()
    expect(within(rows[2]).getByText("Engine default").className).toContain("text-muted-foreground")
  })

  it("says so when there are no suites, with the create button", async () => {
    renderPage(SuitesPage, stubClient({ "suites.list": { items: [] } }))
    expect(await screen.findByText("No suites yet.")).toBeTruthy()
    expect(screen.getByText("0 suites")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Create suite" }).length).toBe(2)
  })

  it("scrolls inside a short window", async () => {
    renderPage(SuitesPage, stubClient({ "suites.list": { items: [] } }))
    await screen.findByText("No suites yet.")
    expect(openCreate().className).toContain("overflow-y-auto")
  })

  it("closes on Escape when nothing is pending", async () => {
    renderPage(SuitesPage, stubClient({ "suites.list": { items: [] } }))
    await screen.findByText("No suites yet.")
    openCreate()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("refuses to close on Escape while its command is pending", async () => {
    const client: ScopedClient = {
      ...stubClient({ "suites.list": { items: [] } }),
      command: () => new Promise(() => {}),
    } as ScopedClient
    renderPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Slow" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Create suite" }) as HTMLButtonElement).disabled).toBe(true))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("refuses a blank name before sending anything", async () => {
    const { client, sent } = recordingCommandClient({ "suites.list": { items: [] } })
    renderPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("a suite needs a name")
    expect(within(dialog).getByLabelText("Name").getAttribute("aria-invalid")).toBe("true")
    expect(sent).toEqual([])
  })

  it("refuses a temperature outside 0 to 2 before sending anything", async () => {
    const { client, sent } = recordingCommandClient({ "suites.list": { items: [] } })
    renderPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Hot" } })
    fireEvent.change(within(dialog).getByLabelText("Temperature"), { target: { value: "2.5" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("temperature must be between 0 and 2")
    expect(within(dialog).getByLabelText("Temperature").getAttribute("aria-invalid")).toBe("true")
    expect(sent).toEqual([])
  })

  it("creates a suite, leaving out an empty temperature, and opens it", async () => {
    const created = suite({ id: "suite_new", name: "Onboarding" })
    const { client, sent } = recordingCommandClient(
      { "suites.list": { items: [] } },
      { "suites.create": created },
    )
    const { navigate } = renderNavPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Onboarding  " } })
    fireEvent.change(within(dialog).getByLabelText("System prompt"), { target: { value: "Guide them." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/suites/suite_new"))
    expect(sent).toEqual([
      {
        intent: "suites.create",
        payload: { name: "Onboarding", description: "", model: "", personaRef: "", systemPrompt: "Guide them." },
      },
    ])
  })

  it("sends a temperature when one is given", async () => {
    const { client, sent } = recordingCommandClient(
      { "suites.list": { items: [] } },
      { "suites.create": suite() },
    )
    renderNavPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Warm" } })
    fireEvent.change(within(dialog).getByLabelText("Temperature"), { target: { value: "0.4" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect((sent[0].payload as { temperature: number }).temperature).toBe(0.4)
  })

  it("shows the server's refusal inside the dialog and marks the name", async () => {
    const client: ScopedClient = {
      ...stubClient({ "suites.list": { items: [suite()] } }),
      command: async () => {
        throw new ContractError("CONFLICT", "a suite with this name already exists")
      },
    } as ScopedClient
    renderPage(SuitesPage, client)
    await screen.findByText("1 suite")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Support assistant" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toBe("a suite with this name already exists")
    expect(within(dialog).getByLabelText("Name").getAttribute("aria-invalid")).toBe("true")
  })

  it("clears the last refusal when the dialog opens again", async () => {
    const client: ScopedClient = {
      ...stubClient({ "suites.list": { items: [suite()] } }),
      command: async () => {
        throw new ContractError("CONFLICT", "a suite with this name already exists")
      },
    } as ScopedClient
    renderPage(SuitesPage, client)
    await screen.findByText("1 suite")
    let dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Support assistant" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create suite" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    dialog = openCreate()
    expect(within(dialog).queryByRole("alert")).toBeNull()
    expect((within(dialog).getByLabelText("Name") as HTMLInputElement).value).toBe("")
  })

  it("sends one create for a double click", async () => {
    let calls = 0
    const client: ScopedClient = {
      ...stubClient({ "suites.list": { items: [] } }),
      command: () => {
        calls += 1
        return new Promise(() => {})
      },
    } as ScopedClient
    renderPage(SuitesPage, client)
    await screen.findByText("No suites yet.")
    const dialog = openCreate()
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Once" } })
    const submit = within(dialog).getByRole("button", { name: "Create suite" })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true))
    expect(calls).toBe(1)
  })
})
