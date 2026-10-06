import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { ContentTab } from "../src/workspace/content-tab"
import type { ContentTabProps } from "../src/workspace/content-tab"
import type { PreviewResult } from "../src/wire"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

vi.mock("../src/components/editor/code-editor", async () => ({ default: (await import("./editor-stand-in")).EditorStandIn }))

afterEach(cleanup)

const detail = templateDetail()
const EN = detail.versions[1]
const CONTENT = { subject: EN.subject, html: EN.html, text: EN.text, title: EN.title }

const RESULT: PreviewResult = {
  fields: [
    { field: "subject", output: "Your 42 receipt", rendered: true },
    { field: "html", output: "<p>Thanks Ada</p>", rendered: true },
    { field: "text", output: "Thanks Ada", rendered: true },
    { field: "title", output: "", rendered: true },
  ],
  diagnostics: [],
}

type Answer = PreviewResult | ContractError | ((params: Record<string, unknown>) => PreviewResult | ContractError)

function setup(over: Partial<ContentTabProps> = {}, answer: Answer = RESULT) {
  const onFieldChange = vi.fn()
  const onSampleRefill = vi.fn()
  const { client, queried } = scriptedClient({ "templates.render": answer })
  const props: ContentTabProps = {
    templateId: detail.id,
    channel: "email",
    version: EN,
    content: CONTENT,
    onFieldChange,
    variables: detail.variables,
    variablesEdited: false,
    funcs: ["upper"],
    sampleText: '{"customer_name": "Ada"}',
    sampleData: { customer_name: "Ada" },
    sampleKey: 0,
    onSampleChange: vi.fn(),
    onSampleRefill,
    ...over,
  }
  render(
    <PluginProvider client={client}>
      <div>
        <ContentTab {...props} />
      </div>
    </PluginProvider>
  )
  const renders = () => queried.filter((q) => q.intent === "templates.render").map((q) => q.params)
  return { onFieldChange, onSampleRefill, renders }
}

// The preview has its own tabs (Rendered, Text, Source), so count only the editor's.
const tabNames = () => within(screen.getByRole("region", { name: "Editor" })).getAllByRole("tab").map((t) => t.textContent)

describe("ContentTab", () => {
  it("shows an email's fields in reading order and folds the one it doesn't send", async () => {
    setup()
    expect(await screen.findByLabelText("Subject (en)")).toBeTruthy()
    expect(tabNames()).toEqual(["Subject", "HTML", "Text"])
    expect(screen.queryByLabelText("Title (en)")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show fields email doesn't send (Title)" }))
    expect(await screen.findByLabelText("Title (en)")).toBeTruthy()
  })

  it("shows an SMS's one field and folds the rest", async () => {
    setup({ channel: "sms" })
    expect(await screen.findByLabelText("Text (en)")).toBeTruthy()
    expect(tabNames()).toEqual(["Text"])
    expect(screen.getByRole("button", { name: "Show fields sms doesn't send (Subject, HTML, Title)" })).toBeTruthy()
  })

  it("names the fallback version's fields as fallback", async () => {
    setup({ version: detail.versions[0], content: { subject: "Your receipt", html: "", text: "", title: "" } })
    expect(await screen.findByLabelText("Subject (fallback)")).toBeTruthy()
  })

  it("keeps the subject on one line and the HTML as HTML", async () => {
    setup()
    expect((await screen.findByLabelText("Subject (en)")).getAttribute("data-single-line")).toBe("true")
    fireEvent.click(screen.getByRole("tab", { name: "HTML" }))
    const htmlEditor = await screen.findByLabelText("HTML (en)")
    expect(htmlEditor.getAttribute("data-language")).toBe("html")
    expect(htmlEditor.getAttribute("data-single-line")).toBe("false")
  })

  it("hands each edit to the draft", async () => {
    const { onFieldChange } = setup()
    fireEvent.change(await screen.findByLabelText("Subject (en)"), { target: { value: "New subject" } })
    expect(onFieldChange).toHaveBeenLastCalledWith("subject", "New subject")
  })

  it("renders the draft against the sample data, leaving the stored variables to the server", async () => {
    const { renders } = setup()
    await waitFor(() => expect(renders()).toHaveLength(1))
    expect(renders()[0]).toEqual({ templateId: detail.id, content: CONTENT, data: { customer_name: "Ada" } })
  })

  it("sends unsaved variables so the preview uses them straight away", async () => {
    const variables = [{ name: "customer_name", type: "string", required: true }]
    const { renders } = setup({ variables, variablesEdited: true })
    await waitFor(() => expect(renders()).toHaveLength(1))
    expect(renders()[0]).toEqual({ templateId: detail.id, content: CONTENT, data: { customer_name: "Ada" }, variables })
  })

  it("puts a field's problems on its own editor and lists every problem", async () => {
    setup({}, {
      ...RESULT,
      diagnostics: [
        { field: "html", line: 1, column: 4, severity: "error", kind: "exec", message: "boom" },
        { field: "", line: 0, column: 0, severity: "warning", kind: "unprovided", message: '"amount" has no sample value' },
      ],
    })
    const problems = await screen.findByRole("region", { name: "Problems" })
    expect(await within(problems).findByText("Problems (2)")).toBeTruthy()
    expect(within(problems).getByRole("button", { name: /HTML 1:4.*boom/ })).toBeTruthy()
    expect(within(problems).queryByRole("button", { name: /no sample value/ })).toBeNull()
    expect(within(problems).getByText(/"amount" has no sample value/)).toBeTruthy()
    expect(JSON.parse((await screen.findByLabelText("Subject (en)")).getAttribute("data-diagnostics")!)).toEqual([])
    fireEvent.click(screen.getByRole("tab", { name: /HTML/ }))
    expect(JSON.parse((await screen.findByLabelText("HTML (en)")).getAttribute("data-diagnostics")!)).toEqual([{ line: 1, column: 4, severity: "error", message: "boom" }])
  })

  it("opens a folded field and moves the cursor there when its problem is clicked", async () => {
    setup({}, { ...RESULT, diagnostics: [{ field: "title", line: 1, column: 2, severity: "error", kind: "parse", message: "bad title" }] })
    fireEvent.click(await screen.findByRole("button", { name: /bad title/ }))
    expect((await screen.findByLabelText("Title (en)")).getAttribute("data-focus")).toBe("1:2:1")
  })

  it("asks again for the same place when the same problem is clicked twice", async () => {
    setup({}, { ...RESULT, diagnostics: [{ field: "subject", line: 1, column: 3, severity: "warning", kind: "undeclared", message: ".x is used but not declared" }] })
    const problem = await screen.findByRole("button", { name: /not declared/ })
    fireEvent.click(problem)
    fireEvent.click(problem)
    expect((await screen.findByLabelText("Subject (en)")).getAttribute("data-focus")).toBe("1:3:2")
  })

  it("doesn't re-fire a focus request when a field's editor is built again", async () => {
    setup({}, { ...RESULT, diagnostics: [{ field: "html", line: 1, column: 4, severity: "error", kind: "exec", message: "boom" }] })
    fireEvent.click(await screen.findByRole("button", { name: /boom/ }))
    expect((await screen.findByLabelText("HTML (en)")).getAttribute("data-focus")).toBe("1:4:1")
    fireEvent.click(screen.getByRole("tab", { name: /Subject/ }))
    expect(await screen.findByLabelText("Subject (en)")).toBeTruthy()
    fireEvent.click(screen.getByRole("tab", { name: /HTML/ }))
    expect((await screen.findByLabelText("HTML (en)")).getAttribute("data-focus")).toBe("")
  })

  it("says nothing is wrong only after a render has answered", async () => {
    setup()
    const problems = await screen.findByRole("region", { name: "Problems" })
    expect(await within(problems).findByText("None in the last render.")).toBeTruthy()
  })

  it("says when the sample data doesn't parse, and offers to refill it", async () => {
    const { onSampleRefill } = setup({ sampleError: "Not valid JSON: Unexpected token" })
    expect(await screen.findByText("Not valid JSON: Unexpected token The preview uses the last sample data that parsed.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refill from variables" }))
    expect(onSampleRefill).toHaveBeenCalled()
  })

  it("says when the preview didn't render", async () => {
    setup({}, new ContractError("BAD_REQUEST", "the template and its sample data are too large to preview"))
    expect(await screen.findByText("The preview didn't render")).toBeTruthy()
    expect(screen.getByText(/too large to preview/)).toBeTruthy()
  })
})
