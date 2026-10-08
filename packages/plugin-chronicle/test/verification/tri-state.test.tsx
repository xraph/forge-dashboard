import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TriStateMark, tri } from "../../src/verification/tri-state"

describe("tri", () => {
  it("never reads a check that did not run as a failure", () => {
    expect(tri(false, false)).toBe("not-checked")
    expect(tri(false, true)).toBe("not-checked")
    expect(tri(true, true)).toBe("held")
    expect(tri(true, false)).toBe("failed")
  })
})

describe("TriStateMark", () => {
  it("gives a check that held a quiet badge", () => {
    render(
      <TriStateMark
        state="held"
        held="Matches"
        failed="Does not match"
        notChecked="Not checked"
      />
    )
    const el = screen.getByText("Matches")
    expect(el.getAttribute("data-slot")).toBe("badge")
    expect(el.getAttribute("data-variant")).toBe("outline")
  })
  it("gives a failed check a destructive badge", () => {
    render(
      <TriStateMark
        state="failed"
        held="Matches"
        failed="Does not match"
        notChecked="Not checked"
      />
    )
    const el = screen.getByText("Does not match")
    expect(el.getAttribute("data-slot")).toBe("badge")
    expect(el.getAttribute("data-variant")).toBe("destructive")
  })
  it("renders a check that did not run as plain muted text with no badge chrome", () => {
    render(
      <TriStateMark
        state="not-checked"
        held="Matches"
        failed="Does not match"
        notChecked="Not checked, this deployment stores no checkpoints"
      />
    )
    const el = screen.getByText(
      "Not checked, this deployment stores no checkpoints"
    )
    expect(el.getAttribute("data-slot")).not.toBe("badge")
    expect(el.className).toContain("text-muted-foreground")
  })
})
