import { describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { EditorView } from "@codemirror/view"
import JsonEditor from "../src/components/json-editor"
import type { JsonEdit } from "../src/components/json-editor"

/** The real CodeMirror, not a mock: this is the one test that runs it. */
function mount(initial: string) {
  const onChange = vi.fn<(edit: JsonEdit) => void>()
  const { container } = render(
    <JsonEditor label="Value" initial={initial} onChange={onChange} />
  )
  const dom = container.querySelector(".cm-editor") as HTMLElement
  const view = EditorView.findFromDOM(dom) as EditorView
  function type(text: string) {
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
    })
  }
  return { onChange, view, type }
}

describe("JsonEditor", () => {
  it("starts on the text it was given and names itself", () => {
    const { view } = mount('{\n  "a": 1\n}')
    expect(view.state.doc.toString()).toBe('{\n  "a": 1\n}')
    expect(screen.getByLabelText("Value")).toBeTruthy()
  })

  it("says nothing about a value that parses", () => {
    mount('{"a": 1}')
    expect(screen.queryByText(/line \d+/i)).toBeNull()
  })

  it("reports the parsed value on every change", () => {
    const { onChange, type } = mount("1")
    type('{"a": 2}')
    expect(onChange).toHaveBeenLastCalledWith({
      text: '{"a": 2}',
      result: { ok: true, value: { a: 2 } },
    })
  })

  it("reports a parse error with its line and column, and shows it under the editor", () => {
    const { onChange, type } = mount("1")
    type('{\n  "a": 1\n  "b": 2\n}')
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last?.result.ok).toBe(false)
    if (last?.result.ok === false) {
      expect(last.result.error.line).toBe(3)
      expect(last.result.error.column).toBe(3)
    }
    expect(screen.getByText(/line 3, column 3/i)).toBeTruthy()
  })

  it("clears the error once the text parses again", () => {
    const { type } = mount("1")
    type("{")
    expect(screen.getByText(/line 1, column 2/i)).toBeTruthy()
    type("{}")
    expect(screen.queryByText(/line 1/i)).toBeNull()
  })

  it("shows an error for text that is broken from the start", () => {
    mount('{"a": ')
    expect(screen.getByText(/line 1, column 7/i)).toBeTruthy()
  })
})
