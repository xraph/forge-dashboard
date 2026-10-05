import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { config, leakageCase, suite, SUITE_ID, testCase, VERSION_2 } from "./fixtures"
import { recordingCommandClient, renderNavPage, stubClient } from "./harness"

function answers(overrides: Record<string, unknown> = {}) {
  return {
    "suites.detail": suite(),
    "cases.list": { items: [testCase(), leakageCase()] },
    "config.get": config(),
    ...overrides,
  }
}

describe("SuiteDetailPage", () => {
  it("shows the suite's facts, with the current version linked and the baseline's pass rate", async () => {
    renderNavPage(SuiteDetailPage, stubClient(answers()), { id: SUITE_ID })
    expect(await screen.findByRole("heading", { level: 1, name: "Support assistant" })).toBeTruthy()
    const facts = screen.getByText("Temperature").closest("dl") as HTMLElement
    expect(within(facts).getByText("0.2")).toBeTruthy()
    expect(within(facts).getByText("nimbus").className).toContain("font-mono")
    expect(within(facts).getByRole("link", { name: "Version 2" }).getAttribute("href")).toBe(
      `/suites/${SUITE_ID}/prompts/${VERSION_2}`,
    )
    expect(within(facts).getByText("Release 1.4, pass rate 0.88")).toBeTruthy()
  })

  it("says the engine decides when the suite sets no model or temperature, and none for no persona or baseline", async () => {
    const plain = suite({
      model: "",
      temperature: 0,
      personaRef: undefined,
      currentBaseline: undefined,
      currentPromptVersion: undefined,
      promptSource: "suite",
    })
    renderNavPage(SuiteDetailPage, stubClient(answers({ "suites.detail": plain })), { id: SUITE_ID })
    const facts = (await screen.findByText("Temperature")).closest("dl") as HTMLElement
    expect(within(facts).getAllByText("Engine default").length).toBe(2)
    expect(within(facts).getByText("The suite's own prompt")).toBeTruthy()
    expect(within(facts).getByLabelText("no persona")).toBeTruthy()
    expect(within(facts).getByLabelText("no current baseline")).toBeTruthy()
  })

  it("lists the cases on the Cases tab with a live count and the red-team marker", async () => {
    renderNavPage(SuiteDetailPage, stubClient(answers()), { id: SUITE_ID })
    const table = await screen.findByRole("region", { name: "2 cases" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByRole("link", { name: "Reset password" }).getAttribute("href")).toBe(
      `/suites/${SUITE_ID}/cases/tcase_01j9se00000000000000000002`,
    )
    expect(within(rows[1]).getByLabelText("no attack type")).toBeTruthy()
    expect(within(rows[2]).getByText("Red team")).toBeTruthy()
    expect(within(rows[2]).getByText("· leakage")).toBeTruthy()
  })

  it("edits the suite, sending every field so nothing untouched changes", async () => {
    const { client, sent } = recordingCommandClient(answers(), { "suites.update": suite({ description: "New" }) })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID })
    await screen.findByRole("heading", { level: 1, name: "Support assistant" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Runs use version 2's prompt while it is current. This is the suite's own.")).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "New" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save suite" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toEqual({
      intent: "suites.update",
      payload: {
        suiteId: SUITE_ID,
        name: "Support assistant",
        description: "New",
        model: "smart",
        personaRef: "nimbus",
        systemPrompt: "You are Nimbus.",
        temperature: 0.2,
      },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("sends temperature 0 when an edit empties it, which is the engine's", async () => {
    const { client, sent } = recordingCommandClient(answers(), { "suites.update": suite() })
    renderNavPage(SuiteDetailPage, client, { id: SUITE_ID })
    await screen.findByRole("heading", { level: 1, name: "Support assistant" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Temperature"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save suite" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect((sent[0].payload as { temperature: number }).temperature).toBe(0)
  })

  it("deletes the suite after saying what goes with it, then leaves for the list", async () => {
    const { client, sent } = recordingCommandClient(answers(), { "suites.delete": { suiteId: SUITE_ID } })
    const { navigate } = renderNavPage(SuiteDetailPage, client, { id: SUITE_ID })
    await screen.findByRole("heading", { level: 1, name: "Support assistant" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/Its 2 cases, every run and its results/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete suite" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/suites"))
    expect(sent).toEqual([{ intent: "suites.delete", payload: { suiteId: SUITE_ID } }])
  })

  it("shows a refused delete inside the dialog and stays", async () => {
    const client: ScopedClient = {
      ...stubClient(answers()),
      command: async () => {
        throw new ContractError("INTERNAL", "an internal error occurred")
      },
    } as ScopedClient
    const { navigate } = renderNavPage(SuiteDetailPage, client, { id: SUITE_ID })
    await screen.findByRole("heading", { level: 1, name: "Support assistant" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = screen.getByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete suite" }))
    expect((await within(dialog).findByRole("alert")).textContent).toBe("an internal error occurred")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("shows a missing suite as an error with its code", async () => {
    const client: ScopedClient = {
      ...stubClient(answers()),
      query: async (intent: string) => {
        if (intent === "suites.detail") throw new ContractError("NOT_FOUND", "suite not found")
        return answers()[intent as keyof ReturnType<typeof answers>]
      },
    } as ScopedClient
    renderNavPage(SuiteDetailPage, client, { id: "suite_01j9se99999999999999999999" })
    expect((await screen.findByText("NOT_FOUND: suite not found")).getAttribute("role")).toBe("alert")
  })
})
