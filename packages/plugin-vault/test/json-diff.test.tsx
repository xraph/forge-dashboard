import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import JsonDiff from "../src/components/json-diff"

/** The real CodeMirror merge view, not a mock: this is the test that runs it. */
describe("JsonDiff", () => {
  const WAS = '{\n  "retries": 3\n}'
  const NOW = '{\n  "retries": 5\n}'

  it("shows the newer text, names itself, and draws the older line as removed", () => {
    const { container } = render(
      <JsonDiff
        was={WAS}
        now={NOW}
        label="Version 1 against the current value"
      />
    )
    expect(
      screen.getByLabelText("Version 1 against the current value")
    ).toBeTruthy()
    expect(container.querySelector(".cm-content")?.textContent).toContain("5")
    expect(container.querySelector(".cm-deletedChunk")?.textContent).toContain(
      "3"
    )
  })

  it("draws no removed lines when the two texts are the same", () => {
    const { container } = render(<JsonDiff was={NOW} now={NOW} label="Same" />)
    expect(container.querySelector(".cm-deletedChunk")).toBeNull()
  })

  it("cannot be edited", () => {
    const { container } = render(<JsonDiff was={WAS} now={NOW} label="Diff" />)
    expect(
      container.querySelector(".cm-content")?.getAttribute("contenteditable")
    ).toBe("false")
  })
})
