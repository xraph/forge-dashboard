import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ConfigValue } from "../src/components/config-value"

describe("ConfigValue", () => {
  it("shows a duration as the bare string in mono, unquoted", () => {
    const { container } = render(
      <ConfigValue value="1h30m" valueType="duration" />
    )
    const el = screen.getByText("1h30m")
    expect(el.className).toMatch(/font-mono/)
    expect(container.textContent).toBe("1h30m")
  })

  it('quotes a string, so "90s" in a string entry is not a duration', () => {
    const { container } = render(<ConfigValue value="90s" valueType="string" />)
    expect(container.textContent).toBe('"90s"')
  })

  it('draws what the value is: the boolean true and the string "true" differ', () => {
    const { container: a } = render(
      <ConfigValue value={true} valueType="bool" />
    )
    const { container: b } = render(
      <ConfigValue value="true" valueType="string" />
    )
    expect(a.textContent).toBe("true")
    expect(b.textContent).toBe('"true"')
  })

  it("shows a number in mono with tabular figures", () => {
    render(<ConfigValue value={8080} valueType="int" />)
    const el = screen.getByText("8080")
    expect(el.className).toMatch(/font-mono/)
    expect(el.className).toMatch(/tabular-nums/)
  })

  it("shows json compact and cuts a long one with the whole of it in a title", () => {
    const value = { items: Array.from({ length: 30 }, (_, i) => i) }
    const { container } = render(<ConfigValue value={value} valueType="json" />)
    const el = container.firstElementChild as HTMLElement
    expect(el.getAttribute("title")).toBe(JSON.stringify(value))
    expect(el.textContent?.endsWith("…")).toBe(true)
  })

  it("shows none for null", () => {
    render(<ConfigValue value={null} valueType="json" />)
    expect(screen.getByLabelText("no value")).toBeTruthy()
  })

  it("draws a duration-typed value that is not a string as what it is", () => {
    const { container } = render(<ConfigValue value={5} valueType="duration" />)
    expect(container.textContent).toBe("5")
  })

  it("draws an empty duration quoted, never as a blank cell", () => {
    const { container } = render(<ConfigValue value="" valueType="duration" />)
    expect(container.textContent).toBe('""')
    expect(container.textContent).not.toBe("")
  })

  it("never coerces by the type: a string in an int entry is drawn as a string", () => {
    const { container } = render(<ConfigValue value="x" valueType="int" />)
    expect(container.textContent).toBe('"x"')
  })
})
