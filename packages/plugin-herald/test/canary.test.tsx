import { useState } from "react"
import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { expectNotInReactState } from "./canary"

function Leaky() {
  const [v, setV] = useState("")
  return <input aria-label="leaky" value={v} onChange={(e) => setV(e.target.value)} />
}

function Clean() {
  return (
    <div>
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i}>row {i}</span>
      ))}
    </div>
  )
}

describe("expectNotInReactState", () => {
  it("passes a tree that holds no needle", () => {
    const { container } = render(<Clean />)
    expect(() => expectNotInReactState(container, "needle-123")).not.toThrow()
  })

  it("catches a needle held in hook state, which the DOM check would also miss for a password field", () => {
    const { container, getByLabelText } = render(
      <div>
        <Clean />
        <Leaky />
      </div>,
    )
    const input = getByLabelText("leaky") as HTMLInputElement
    input.focus()
    // Drive React's own change path.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    set.call(input, "needle-123")
    input.dispatchEvent(new Event("input", { bubbles: true }))
    expect(() => expectNotInReactState(container, "needle-123")).toThrow(/needle found/)
  })
})
