import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { NoneCell } from "../src/components/none-cell"
import { TagList } from "../src/components/tag-list"

describe("NoneCell", () => {
  it("says none to a screen reader and shows a dash on screen", () => {
    render(<NoneCell label="rooms" />)
    const cell = screen.getByLabelText("no rooms")
    // Both halves. A dash alone is silent; a label alone leaves the cell
    // looking blank, which reads as broken rather than as empty.
    expect(cell.textContent).toBe("–")
  })
})

describe("TagList", () => {
  it("renders one badge per value", () => {
    render(<TagList values={["r1", "r2"]} label="rooms" />)
    expect(screen.getByText("r1")).toBeTruthy()
    expect(screen.getByText("r2")).toBeTruthy()
    expect(screen.queryByLabelText("no rooms")).toBeNull()
  })

  it("falls through to a labelled dash when there is nothing to list", () => {
    render(<TagList values={[]} label="subscriptions" />)
    // This is the case every hand-rolled version of this cell got wrong: an
    // array map over an empty array renders nothing at all.
    expect(screen.getByLabelText("no subscriptions").textContent).toBe("–")
  })

  it("renders identifiers monospaced, and lets a caller turn that off", () => {
    const { rerender } = render(<TagList values={["r1"]} label="rooms" />)
    expect(screen.getByText("r1").className).toContain("font-mono")
    rerender(<TagList values={["read"]} label="scopes" mono={false} />)
    expect(screen.getByText("read").className).not.toContain("font-mono")
  })
})
