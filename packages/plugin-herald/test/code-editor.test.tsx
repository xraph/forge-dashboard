import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { CompletionContext } from "@codemirror/autocomplete"
import type { CompletionResult } from "@codemirror/autocomplete"
import { forEachDiagnostic } from "@codemirror/lint"
import CodeEditor, { actionCompletions, templateActions } from "../src/components/editor/code-editor"
import type { CodeEditorProps } from "../src/components/editor/types"

afterEach(cleanup)

function mount(props: Partial<CodeEditorProps> = {}) {
  const onChange = vi.fn()
  const all: CodeEditorProps = { label: "HTML (en)", initial: "<p>Hi</p>", language: "html", onChange, ...props }
  const utils = render(<CodeEditor {...all} />)
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement) as EditorView
  return { ...utils, view, onChange, props: all }
}

const marked = (view: EditorView) => {
  const out: string[] = []
  view.plugin(templateActions)!.decorations.between(0, view.state.doc.length, (from, to) => {
    out.push(view.state.doc.sliceString(from, to))
  })
  return out
}

const lintRanges = (view: EditorView) => {
  const out: { text: string; severity: string; message: string }[] = []
  forEachDiagnostic(view.state, (d, from, to) => out.push({ text: view.state.doc.sliceString(from, to), severity: d.severity, message: d.message }))
  return out
}

describe("CodeEditor", () => {
  it("names its editing area and reports every change", () => {
    const { view, onChange } = mount()
    expect(screen.getByLabelText("HTML (en)")).toBeTruthy()
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<p>Bye</p>" } }))
    expect(onChange).toHaveBeenLastCalledWith("<p>Bye</p>")
  })

  it("tints every action and follows edits", () => {
    const { view } = mount({ initial: "Hi {{.name}} and {{ upper .x }}", language: "text" })
    expect(marked(view)).toEqual(["{{.name}}", "{{ upper .x }}"])
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " {{.y}}" } }))
    expect(marked(view)).toEqual(["{{.name}}", "{{ upper .x }}", "{{.y}}"])
  })

  it("underlines a server diagnostic at the character Herald named, after a non-ASCII one", () => {
    const { view, rerender, props } = mount({ initial: "line one\né {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} diagnostics={[{ line: 2, column: 6, severity: "error", message: 'function "nosuch" not defined' }]} />)
    expect(lintRanges(view)).toEqual([{ text: "nosuch", severity: "error", message: 'function "nosuch" not defined' }])
  })

  it("marks a parse error's whole line, since it has no column", () => {
    const { view, rerender, props } = mount({ initial: "fine\nbad {{ here\nfine", language: "text" })
    rerender(<CodeEditor {...props} diagnostics={[{ line: 2, column: 0, severity: "error", message: "unclosed action" }]} />)
    expect(lintRanges(view).map((d) => d.text)).toEqual(["bad {{ here"])
  })

  it("clears its marks when the diagnostics go away", () => {
    const { view, rerender, props } = mount({ initial: "a {{ x }}", language: "text", diagnostics: [{ line: 1, column: 6, severity: "warning", message: "x" }] })
    expect(lintRanges(view)).toHaveLength(1)
    rerender(<CodeEditor {...props} diagnostics={[]} />)
    expect(lintRanges(view)).toHaveLength(0)
  })

  it("moves the cursor to a requested position, counted in characters", () => {
    const { view, rerender, props } = mount({ initial: "line one\né {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} focus={{ line: 2, column: 6, seq: 1 }} />)
    // "line one\n" is 9 units; é, space, {, {, space are 5 more.
    expect(view.state.selection.main.head).toBe(14)
  })

  it("keeps a single-line field on one line", () => {
    const { view, onChange } = mount({ initial: "Your receipt", language: "text", singleLine: true, label: "Subject (en)" })
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nsecond line" } }))
    expect(view.state.doc.toString()).toBe("Your receipt")
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("actionCompletions", () => {
  const source = actionCompletions(
    () => ["customer_name", "amount"],
    () => ["upper", "lower"],
  )
  const complete = (doc: string, pos = doc.length, explicit = false) => source(new CompletionContext(EditorState.create({ doc }), pos, explicit)) as CompletionResult | null

  it("offers variables with their dot and function names inside an action", () => {
    const result = complete("Hi {{ .cu")
    expect(result?.from).toBe(6)
    expect(result?.options.map((o) => o.label)).toEqual([".customer_name", ".amount", "upper", "lower"])
  })

  it("offers nothing outside an action", () => {
    expect(complete("Hi .cu")).toBeNull()
  })

  it("offers everything on an explicit request inside an empty action", () => {
    const result = complete("{{  }}", 3, true)
    expect(result?.from).toBe(3)
    expect(result?.options).toHaveLength(4)
  })
})
