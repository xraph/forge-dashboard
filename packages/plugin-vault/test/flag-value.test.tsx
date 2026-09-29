import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { FlagValue } from "../src/components/flag-value"

describe("FlagValue", () => {
  it("shows a boolean as bare true or false in mono", () => {
    const { container } = render(<FlagValue value={true} type="bool" />)
    const el = screen.getByText("true")
    expect(el.className).toMatch(/font-mono/)
    expect(container.textContent).toBe("true")
  })

  it("shows false as false", () => {
    render(<FlagValue value={false} type="bool" />)
    expect(screen.getByText("false")).toBeTruthy()
  })

  it("distinguishes the string \"true\" from the boolean true", () => {
    const { container: a } = render(<FlagValue value="true" type="string" />)
    const { container: b } = render(<FlagValue value={true} type="bool" />)
    expect(a.textContent).toBe('"true"')
    expect(b.textContent).toBe("true")
    expect(a.textContent).not.toBe(b.textContent)
  })

  it("quotes a string in mono", () => {
    render(<FlagValue value="blue" type="string" />)
    expect(screen.getByText('"blue"').className).toMatch(/font-mono/)
  })

  it("shows a number in mono with tabular figures", () => {
    render(<FlagValue value={42} type="int" />)
    const el = screen.getByText("42")
    expect(el.className).toMatch(/font-mono/)
    expect(el.className).toMatch(/tabular-nums/)
  })

  it("shows a float as written", () => {
    render(<FlagValue value={0.25} type="float" />)
    expect(screen.getByText("0.25")).toBeTruthy()
  })

  it("shows compact JSON in mono", () => {
    render(<FlagValue value={{ a: 1, b: [2, 3] }} type="json" />)
    const el = screen.getByText('{"a":1,"b":[2,3]}')
    expect(el.className).toMatch(/font-mono/)
    expect(el.getAttribute("title")).toBe('{"a":1,"b":[2,3]}')
  })

  it("truncates JSON at 60 characters and keeps the full value in a title", () => {
    const value = { list: Array.from({ length: 40 }, (_, i) => i) }
    const full = JSON.stringify(value)
    expect(full.length).toBeGreaterThan(60)
    render(<FlagValue value={value} type="json" />)
    const el = document.querySelector("[title]") as HTMLElement
    expect(el.getAttribute("title")).toBe(full)
    expect(el.textContent!.length).toBeLessThanOrEqual(60)
    expect(el.textContent!.endsWith("…")).toBe(true)
    expect(full.startsWith(el.textContent!.slice(0, -1))).toBe(true)
  })

  it("does not truncate JSON of exactly 60 characters", () => {
    const value = { k: "x".repeat(60 - '{"k":""}'.length) }
    const full = JSON.stringify(value)
    expect(full).toHaveLength(60)
    render(<FlagValue value={value} type="json" />)
    expect(screen.getByText(full)).toBeTruthy()
  })

  it("renders null as a labelled none cell", () => {
    render(<FlagValue value={null} type="json" />)
    expect(screen.getByLabelText("no value")).toBeTruthy()
  })

  it("renders by what the value is, so a wrong-typed value is not disguised", () => {
    // A string flag whose stored default is the boolean true.
    const { container } = render(<FlagValue value={true} type="string" />)
    expect(container.textContent).toBe("true")
  })
})
