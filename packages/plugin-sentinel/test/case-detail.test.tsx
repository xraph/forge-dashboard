import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { CaseDetailPage } from "../src/pages/case-detail"
import { CASE_ID, config, leakageCase, suite, SUITE_ID, testCase } from "./fixtures"
import { recordingCommandClient, recordingQueryClient, renderNavPage, stubClient } from "./harness"

const HOSTILE = `<img src=x onerror="alert('pwned')"> **bold** [click](javascript:alert(1))`

function answers(c = testCase()) {
  return { "cases.detail": c, "suites.detail": suite(), "config.get": config() }
}

describe("CaseDetailPage", () => {
  it("shows the case, its suite and its scorer config", async () => {
    renderNavPage(CaseDetailPage, stubClient(answers()), { id: SUITE_ID, caseId: CASE_ID })
    expect(await screen.findByRole("heading", { level: 1, name: "Reset password" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Support assistant" }).getAttribute("href")).toBe(`/suites/${SUITE_ID}`)
    expect(screen.getByLabelText("Input", { selector: "pre" }).textContent).toBe("How do I reset my password?")
    const scorers = screen.getByRole("region", { name: "1 scorer" })
    expect(within(scorers).getByText("contains").className).toContain("font-mono")
    expect(within(scorers).getByText(/"substring": "Forgot password"/)).toBeTruthy()
    expect(within(scorers).getByLabelText("no withheld value")).toBeTruthy()
  })

  it("renders hostile input and expected text as text, never as markup or links", async () => {
    const c = testCase({ input: HOSTILE, expected: HOSTILE })
    const { container } = renderNavPage(CaseDetailPage, stubClient(answers(c)), { id: SUITE_ID, caseId: CASE_ID })
    expect((await screen.findByLabelText("Input", { selector: "pre" })).textContent).toBe(HOSTILE)
    expect(screen.getByLabelText("Expected output", { selector: "pre" }).textContent).toBe(HOSTILE)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("strong")).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it("says none when the case has no expected output", async () => {
    renderNavPage(CaseDetailPage, stubClient(answers(testCase({ expected: undefined }))), {
      id: SUITE_ID,
      caseId: CASE_ID,
    })
    expect(await screen.findByLabelText("no expected output")).toBeTruthy()
  })

  it("shows a red-team case's attack type and how long its withheld substring is, never the substring", async () => {
    const c = leakageCase()
    renderNavPage(CaseDetailPage, stubClient(answers(c)), { id: SUITE_ID, caseId: c.id })
    await screen.findByRole("heading", { level: 1, name: "leakage_direct_request" })
    expect(screen.getByText("· leakage")).toBeTruthy()
    const scorers = screen.getByRole("region", { name: "1 scorer" })
    expect(within(scorers).getByText("The substring, 93 characters")).toBeTruthy()
    expect(within(scorers).getByLabelText("no config")).toBeTruthy()
    expect(screen.getByLabelText("Context", { selector: "pre" }).textContent).toContain('"attack_type": "leakage"')
  })

  it("edits a red-team case without sending a substring, so the server keeps the stored one", async () => {
    const c = leakageCase()
    const { client, sent } = recordingCommandClient(answers(c), { "cases.update": c })
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: c.id })
    await screen.findByRole("heading", { level: 1, name: "leakage_direct_request" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/The substring \(93 characters\) is hidden/)).toBeTruthy()
    expect((within(dialog).getByLabelText("Scorer 1 config") as HTMLTextAreaElement).value).toBe("")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "leakage_renamed" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toEqual({
      intent: "cases.update",
      payload: {
        caseId: c.id,
        name: "leakage_renamed",
        input: c.input,
        expected: c.expected,
        scenarioType: "standard",
        tags: ["redteam", "leakage"],
        scorers: [{ name: "not_contains", config: {} }],
      },
    })
  })

  it("uses the update's own words for a blank name or input", async () => {
    const { client, sent } = recordingCommandClient(answers())
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Input"), { target: { value: "   " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("a case needs an input")
    expect(within(dialog).getByLabelText("Input").getAttribute("aria-invalid")).toBe("true")
    expect(sent).toEqual([])
  })

  it("deletes the case and returns to its suite", async () => {
    const { client, sent } = recordingCommandClient(answers(), { "cases.delete": { caseId: CASE_ID } })
    const { navigate } = renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Runs that already scored it keep their results. This cannot be undone.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete case" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/suites/${SUITE_ID}`))
    expect(sent).toEqual([{ intent: "cases.delete", payload: { caseId: CASE_ID } }])
  })

  it("shows a refused delete inside the dialog, stays on the page and sends it once", async () => {
    let calls = 0
    const client: ScopedClient = {
      ...stubClient(answers()),
      command: async () => {
        calls += 1
        throw new ContractError("INTERNAL", "an internal error occurred")
      },
    } as ScopedClient
    const { navigate } = renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = screen.getByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete case" }))
    expect((await within(dialog).findByRole("alert")).textContent).toBe("an internal error occurred")
    expect(screen.getByRole("alertdialog")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect(calls).toBe(1)
  })

  it("shows a refused edit inside the form and keeps it open", async () => {
    const client: ScopedClient = {
      ...stubClient(answers()),
      command: async () => {
        throw new ContractError("BAD_REQUEST", 'unknown scenario type "dance"')
      },
    } as ScopedClient
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }))
    expect((await within(dialog).findByRole("alert")).textContent).toBe('unknown scenario type "dance"')
    expect(within(dialog).getByLabelText("Scenario type").getAttribute("aria-invalid")).toBe("true")
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
  it("cannot rename or remove a hidden check in the edit form, because the server pairs withheld values by position", async () => {
    const c = leakageCase()
    renderNavPage(CaseDetailPage, stubClient(answers(c)), { id: SUITE_ID, caseId: c.id })
    await screen.findByRole("heading", { level: 1, name: "leakage_direct_request" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    expect((within(dialog).getByLabelText("Scorer 1") as HTMLSelectElement).disabled).toBe(true)
    expect((within(dialog).getByRole("button", { name: "Remove scorer 1" }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      within(dialog).getByText(
        'The substring (93 characters) is hidden, because it is the system prompt this case guards. It is kept unless you add a "substring" key here. A hidden check cannot be removed or changed to another scorer here.',
      ),
    ).toBeTruthy()
  })

  it("lets an ordinary scorer row be renamed or removed, with no hidden-check note", async () => {
    renderNavPage(CaseDetailPage, stubClient(answers()), { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    expect((within(dialog).getByLabelText("Scorer 1") as HTMLSelectElement).disabled).toBe(false)
    expect((within(dialog).getByRole("button", { name: "Remove scorer 1" }) as HTMLButtonElement).disabled).toBe(false)
    expect(within(dialog).queryByText(/is hidden, because/)).toBeNull()
  })

  it("sends tags back exactly when the tags field is untouched, even one with a comma in it", async () => {
    const c = testCase({ tags: ["billing, urgent"] })
    const { client, sent } = recordingCommandClient(answers(c), { "cases.update": c })
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Renamed" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect((sent[0].payload as { tags: string[] }).tags).toEqual(["billing, urgent"])
  })

  it("parses the tags field once it has been edited", async () => {
    const c = testCase({ tags: ["billing, urgent"] })
    const { client, sent } = recordingCommandClient(answers(c), { "cases.update": c })
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    await screen.findByRole("heading", { level: 1, name: "Reset password" })
    fireEvent.click(screen.getByRole("button", { name: "Edit" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Tags"), { target: { value: "billing, urgent, vip" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save case" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect((sent[0].payload as { tags: string[] }).tags).toEqual(["billing", "urgent", "vip"])
  })

  it("links to the suite the case belongs to, not the one in the URL", async () => {
    const own = "suite_01j9se00000000000000000099"
    const c = testCase({ suiteId: own })
    const { client, sent } = recordingQueryClient({
      "cases.detail": c,
      "suites.detail": suite({ id: own, name: "Billing FAQ" }),
      "config.get": config(),
    })
    renderNavPage(CaseDetailPage, client, { id: SUITE_ID, caseId: CASE_ID })
    const link = await screen.findByRole("link", { name: "Billing FAQ" })
    expect(link.getAttribute("href")).toBe(`/suites/${own}`)
    const reads = sent.filter((q) => q.intent === "suites.detail").map((q) => q.params)
    expect(reads).toEqual([{ suiteId: own }])
  })

  it("shows two identical scorers as two rows, with no duplicate-key warning", async () => {
    const twice = { name: "contains", config: { substring: "Forgot password" } }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      renderNavPage(CaseDetailPage, stubClient(answers(testCase({ scorers: [twice, { ...twice }] }))), {
        id: SUITE_ID,
        caseId: CASE_ID,
      })
      const scorers = await screen.findByRole("region", { name: "2 scorers" })
      expect(within(scorers).getAllByRole("row").length).toBe(3)
      expect(spy.mock.calls.map((args) => String(args[0])).filter((m) => m.includes("same key"))).toEqual([])
    } finally {
      spy.mockRestore()
    }
  })
})
