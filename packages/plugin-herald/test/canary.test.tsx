import { useState } from "react"
import type { ReactNode } from "react"
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

  it("catches a needle in the last of 24 hooks, past where a depth cap would stop", () => {
    const { container } = render(<ManyHooks make={() => "needle-123"} />)
    expect(() => expectNotInReactState(container, "needle-123")).toThrow(/needle found/)
  })

  it("catches a needle a few levels deep inside an object held by the last of 24 hooks", () => {
    const { container } = render(<ManyHooks make={() => ({ a: { b: [{ c: new Map([["k", new Set(["x needle-123 y"])]]) }] } })} />)
    expect(() => expectNotInReactState(container, "needle-123")).toThrow(/needle found/)
  })

  it("passes the same 24-hook component when the needle is absent", () => {
    const { container } = render(<ManyHooks make={() => ({ a: { b: ["other"] } })} />)
    expect(() => expectNotInReactState(container, "needle-123")).not.toThrow()
  })

  it("still checks a shallow hook after an object is shared by a deep one", () => {
    const { container } = render(<SharedTwice make={() => ({ v: "needle-123" })} />)
    expect(() => expectNotInReactState(container, "needle-123")).toThrow(/needle found/)
  })
})

/** 23 filler hooks, then one that holds what `make` returns, so the value is state and not a prop: the shape of CreateForm and EditForm. */
function ManyHooks({ make }: { make: () => unknown }): ReactNode {
  const h: unknown[] = []
  for (let i = 0; i < 23; i++) h.push(useState(i)[0]) // eslint-disable-line react-hooks/rules-of-hooks -- fixed count, every render
  const [held] = useState<unknown>(make)
  return <span>{h.length + (held ? 1 : 0)}</span>
}

/** The same object reachable first through a deep path, then from a shallow hook. */
function SharedTwice({ make }: { make: () => { v: string } }): ReactNode {
  const [shared] = useState(make)
  const [deep] = useState({ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: { shared } } } } } } } } } } } } } })
  const [shallow] = useState(shared)
  return <span>{String(!!deep) + String(!!shallow)}</span>
}
