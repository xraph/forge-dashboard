import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { render } from "@testing-library/react"
import { CasesTab } from "../src/components/cases-tab"
import { config, SUITE_ID, testCase } from "./fixtures"
import { recordingCommandClient, stubClient } from "./harness"

function renderTab(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <CasesTab suiteId={SUITE_ID} />
    </PluginProvider>,
  )
}

const ANSWERS = { "cases.list": { items: [testCase()] }, "config.get": config() }

function refusing(code: string, message: string): ScopedClient {
  return {
    ...stubClient(ANSWERS),
    command: async () => {
      throw new ContractError(code, message)
    },
  } as ScopedClient
}

describe("CasesTab, adding a case", () => {
  it("says so when the suite has no cases", async () => {
    renderTab(stubClient({ "cases.list": { items: [] }, "config.get": config() }))
    expect(await screen.findByText("No cases yet.")).toBeTruthy()
  })

  it("refuses a missing name or input with the server's words, before sending", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS)
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Add case" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Only a name" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add case" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("a case needs a name and an input")
    expect(sent).toEqual([])
  })

  it("adds a case with its tags and a scorer's config, keeping the input as written", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS, { "cases.create": testCase({ id: "tcase_new" }) })
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Add case" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "  Refunds  " } })
    fireEvent.change(within(dialog).getByLabelText("Input"), { target: { value: "  Can I get a refund?  " } })
    fireEvent.change(within(dialog).getByLabelText("Expected output"), { target: { value: "Within 30 days." } })
    fireEvent.change(within(dialog).getByLabelText("Scenario type"), { target: { value: "trait_probe" } })
    fireEvent.change(within(dialog).getByLabelText("Tags"), { target: { value: "billing, , churn" } })
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Add scorer" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole("button", { name: "Add scorer" }))
    fireEvent.change(within(dialog).getByLabelText("Scorer 1"), { target: { value: "regex" } })
    fireEvent.change(within(dialog).getByLabelText("Scorer 1 config"), { target: { value: '{"pattern": "30 days"}' } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add case" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toEqual({
      intent: "cases.create",
      payload: {
        suiteId: SUITE_ID,
        name: "Refunds",
        input: "  Can I get a refund?  ",
        expected: "Within 30 days.",
        scenarioType: "trait_probe",
        tags: ["billing", "churn"],
        scorers: [{ name: "regex", config: { pattern: "30 days" } }],
      },
    })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("refuses a scorer config that is not a JSON object, before sending", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS)
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Add case" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "A" } })
    fireEvent.change(within(dialog).getByLabelText("Input"), { target: { value: "B" } })
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Add scorer" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole("button", { name: "Add scorer" }))
    fireEvent.change(within(dialog).getByLabelText("Scorer 1 config"), { target: { value: "{pattern" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add case" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("Scorer 1's config is not valid JSON.")
    fireEvent.change(within(dialog).getByLabelText("Scorer 1 config"), { target: { value: "[1]" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add case" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("Scorer 1's config must be a JSON object.")
    expect(sent).toEqual([])
  })

  it("shows the server's refusal of a scorer inside the dialog", async () => {
    renderTab(refusing("BAD_REQUEST", 'scorer "regex": scorer regex: missing required config: pattern'))
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Add case" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "A" } })
    fireEvent.change(within(dialog).getByLabelText("Input"), { target: { value: "B" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Add case" }))
    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      'scorer "regex": scorer regex: missing required config: pattern',
    )
  })

  it("removes a scorer row", async () => {
    renderTab(stubClient(ANSWERS))
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Add case" }))
    const dialog = screen.getByRole("dialog")
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Add scorer" }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(within(dialog).getByRole("button", { name: "Add scorer" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove scorer 1" }))
    expect(within(dialog).getByText("No scorers of its own.")).toBeTruthy()
  })
})

describe("CasesTab, importing", () => {
  it("imports pasted cases and says how many", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS, { "cases.import": { imported: 2 } })
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Import cases" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Format"), { target: { value: "csv" } })
    expect(within(dialog).getByText(/Separate tags with a semicolon/)).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText("Cases"), { target: { value: "name,input\na,b\nc,d\n" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect((await screen.findByRole("status")).textContent).toBe("Imported 2 cases.")
    expect(sent).toEqual([
      { intent: "cases.import", payload: { suiteId: SUITE_ID, format: "csv", data: "name,input\na,b\nc,d\n" } },
    ])
  })

  it("asks for the cases before sending an empty import", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS)
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Import cases" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("Paste the cases, or choose a file.")
    expect(sent).toEqual([])
  })

  it("refuses more than 1 MiB before sending, with the server's words", async () => {
    const { client, sent } = recordingCommandClient(ANSWERS)
    renderTab(client)
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Import cases" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Cases"), { target: { value: "é".repeat(600_000) } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("import data is larger than 1048576 bytes")
    expect(sent).toEqual([])
  })

  it("shows a refused row inside the dialog", async () => {
    renderTab(refusing("BAD_REQUEST", "sentinel: invalid input: row 2 has no input"))
    await screen.findByText("1 case")
    fireEvent.click(screen.getByRole("button", { name: "Import cases" }))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Cases"), { target: { value: "[]" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))
    expect((await within(dialog).findByRole("alert")).textContent).toBe("sentinel: invalid input: row 2 has no input")
  })
})
