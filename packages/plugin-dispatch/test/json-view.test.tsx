import { expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EditorView } from "@codemirror/view"
import JsonView from "../src/json-view"
it("keeps the editor read only while preserving source text", () => {
  const text = '{"id":9007199254740993,"amount":1.2300}'
  const { unmount } = render(<JsonView text={text} label="Job payload" />)
  const content = screen.getByLabelText("Job payload")
  const view = EditorView.findFromDOM(content)!
  expect(view.state.doc.toString()).toBe(text)
  expect(view.state.readOnly).toBe(true)
  expect(content.getAttribute("aria-readonly")).toBe("true")
  const destroy = vi.spyOn(view, "destroy")
  unmount()
  expect(destroy).toHaveBeenCalledOnce()
})
