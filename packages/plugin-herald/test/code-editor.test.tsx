import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { insertNewlineAndIndent, undo } from "@codemirror/commands"
import { CompletionContext } from "@codemirror/autocomplete"
import type { CompletionResult } from "@codemirror/autocomplete"
import { forEachDiagnostic } from "@codemirror/lint"
import CodeEditor, { actionCompletions, templateActions } from "../src/components/editor/code-editor"
import FieldDiff from "../src/components/editor/field-diff"
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

  it("underlines a server diagnostic at the character Herald named, after an emoji and an accent", () => {
    // 👋 is two UTF-16 units but one character: "nosuch" is the 8th character of line 2.
    const { view, rerender, props } = mount({ initial: "line one\n👋 é {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} diagnostics={[{ line: 2, column: 8, severity: "error", message: 'function "nosuch" not defined' }]} />)
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
    const { view, rerender, props } = mount({ initial: "line one\n👋 é {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} focus={{ line: 2, column: 8, seq: 1 }} />)
    // "line one\n" is 9 units; 👋 is 2, then space, é, space, {, {, space are 6 more.
    expect(view.state.selection.main.head).toBe(17)
  })

  it("keeps its marks when a new label rebuilds the editor", () => {
    const diagnostics = [{ line: 1, column: 6, severity: "error" as const, message: "bad" }]
    const { view, rerender, props } = mount({ initial: "a {{ x }}", language: "text", diagnostics })
    expect(lintRanges(view)).toHaveLength(1)
    rerender(<CodeEditor {...props} diagnostics={diagnostics} label="HTML (fr)" />)
    const rebuilt = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement) as EditorView
    expect(rebuilt).not.toBe(view)
    expect(screen.getByLabelText("HTML (fr)")).toBeTruthy()
    expect(lintRanges(rebuilt)).toEqual([{ text: "x", severity: "error", message: "bad" }])
  })

  describe("a single-line field", () => {
    const single = () => mount({ initial: "Your receipt", language: "text", singleLine: true, label: "Subject (en)" })

    it("ignores Enter", () => {
      const { view, onChange } = single()
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" }, userEvent: "input" }))
      expect(view.state.doc.toString()).toBe("Your receipt")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("ignores Enter through the keymap's command, which indents, with and without a selection", () => {
      const { view, onChange } = mount({ initial: "  Your receipt", language: "text", singleLine: true, label: "Subject (en)" })
      act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }))
      act(() => {
        insertNewlineAndIndent(view)
      })
      expect(view.state.doc.toString()).toBe("  Your receipt")
      act(() => view.dispatch({ selection: { anchor: 2, head: 6 } }))
      act(() => {
        insertNewlineAndIndent(view)
      })
      expect(view.state.doc.toString()).toBe("  Your receipt")
      expect(onChange).not.toHaveBeenCalled()
    })

    it("takes a plain insert and reports it", () => {
      const { view, onChange } = single()
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " 42" }, userEvent: "input.type" }))
      expect(view.state.doc.toString()).toBe("Your receipt 42")
      expect(onChange).toHaveBeenLastCalledWith("Your receipt 42")
    })

    it("flattens a pasted newline to a space and leaves the cursor after the paste", () => {
      const { view, onChange } = single()
      const end = view.state.doc.length
      act(() => view.dispatch({ changes: { from: end, insert: " a\nb\nc" }, selection: { anchor: end + 6 }, userEvent: "input.paste" }))
      expect(view.state.doc.toString()).toBe("Your receipt a b c")
      expect(onChange).toHaveBeenLastCalledWith("Your receipt a b c")
      expect(view.state.selection.main.head).toBe(view.state.doc.length)
    })

    it("undoes an insert", () => {
      const { view } = single()
      act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " 42" }, userEvent: "input.type" }))
      act(() => {
        undo(view)
      })
      expect(view.state.doc.toString()).toBe("Your receipt")
    })

    it("says it is not multiline and draws no line numbers", () => {
      const { container } = single()
      const content = container.querySelector(".cm-content") as HTMLElement
      expect(content.getAttribute("aria-multiline")).toBe("false")
      expect(container.querySelector(".cm-gutters")).toBeNull()
    })
  })
})

describe("FieldDiff", () => {
  it("shows the draft read-only under its label", () => {
    const { container } = render(<FieldDiff was={"one\ntwo"} now={"one\n2"} label="HTML changes (en)" language="html" />)
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView
    expect(screen.getByLabelText("HTML changes (en)")).toBeTruthy()
    expect(view.state.doc.toString()).toBe("one\n2")
    expect(view.contentDOM.getAttribute("contenteditable")).toBe("false")
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
