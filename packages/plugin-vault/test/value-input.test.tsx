import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { ValueInput, type FlagType } from "../src/components/value-input"

/**
 * jsdom 25 has no PointerEvent, and Base UI's toggle dispatches through it. A
 * MouseEvent subclass is what a click is.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function setup(type: FlagType, initial?: unknown) {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState<unknown>(initial)
    return (
      <ValueInput
        id="v"
        type={type}
        value={value}
        onChange={(next) => {
          onChange(next)
          setValue(next)
        }}
      />
    )
  }
  render(<Host />)
  return { onChange, last: () => onChange.mock.calls.at(-1)?.[0] }
}

const box = () => screen.getByRole("textbox") as HTMLInputElement

describe("ValueInput bool", () => {
  it("reports a real boolean, not a string", () => {
    const { onChange } = setup("bool")
    fireEvent.click(screen.getByRole("button", { name: "true" }))
    expect(onChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "false" }))
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it("shows the current value as pressed", () => {
    setup("bool", true)
    expect(
      screen.getByRole("button", { name: "true" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "false" }).getAttribute("aria-pressed"),
    ).toBe("false")
  })

  it("keeps the choice when the pressed item is clicked again", () => {
    const { onChange } = setup("bool", true)
    fireEvent.click(screen.getByRole("button", { name: "true" }))
    expect(onChange).not.toHaveBeenCalledWith(undefined)
    expect(
      screen.getByRole("button", { name: "true" }).getAttribute("aria-pressed"),
    ).toBe("true")
  })
})

describe("ValueInput string", () => {
  it("reports the text as typed", () => {
    const { onChange } = setup("string")
    fireEvent.change(box(), { target: { value: "hello" } })
    expect(onChange).toHaveBeenLastCalledWith("hello")
  })

  it("keeps the string \"true\" a string", () => {
    const { onChange } = setup("string")
    fireEvent.change(box(), { target: { value: "true" } })
    expect(onChange).toHaveBeenLastCalledWith("true")
  })

  it("reports the empty string, not undefined, once the text is cleared", () => {
    const { onChange } = setup("string")
    fireEvent.change(box(), { target: { value: "x" } })
    fireEvent.change(box(), { target: { value: "" } })
    expect(onChange).toHaveBeenLastCalledWith("")
  })

  it("reports the empty string on mount when it starts with no value", () => {
    const { onChange } = setup("string")
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("")
  })

  it("does not overwrite a string it was given on mount", () => {
    const { onChange } = setup("string", "kept")
    expect(onChange).not.toHaveBeenCalled()
    expect(box().value).toBe("kept")
  })

  it("does not report anything on mount for the other types", () => {
    for (const type of ["int", "float", "json"] as const) {
      const { onChange } = setup(type)
      expect(onChange).not.toHaveBeenCalled()
      cleanup()
    }
    const { onChange } = setup("bool")
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("ValueInput int", () => {
  it("uses a numeric keyboard and reports an integer", () => {
    const { onChange } = setup("int")
    expect(box().getAttribute("inputmode")).toBe("numeric")
    fireEvent.change(box(), { target: { value: "42" } })
    expect(onChange).toHaveBeenLastCalledWith(42)
  })

  it("accepts a leading minus", () => {
    const { onChange } = setup("int")
    fireEvent.change(box(), { target: { value: "-7" } })
    expect(onChange).toHaveBeenLastCalledWith(-7)
  })

  it("reports undefined for a lone minus", () => {
    const { onChange } = setup("int")
    fireEvent.change(box(), { target: { value: "-" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(box().value).toBe("-")
  })

  it("rejects 1.5: the field never holds it and no 1.5 is reported", () => {
    const { onChange } = setup("int")
    fireEvent.change(box(), { target: { value: "1" } })
    fireEvent.change(box(), { target: { value: "1.5" } })
    expect(box().value).toBe("1")
    for (const call of onChange.mock.calls) expect(call[0]).not.toBe(1.5)
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it("rejects letters", () => {
    setup("int")
    fireEvent.change(box(), { target: { value: "12a" } })
    expect(box().value).toBe("")
  })

  it("reports undefined and says why for an integer too large to hold exactly", () => {
    const { onChange } = setup("int")
    fireEvent.change(box(), { target: { value: "9007199254740993" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText(/too large/i)).toBeTruthy()
  })
})

describe("ValueInput float", () => {
  it("uses a decimal keyboard and reports a number", () => {
    const { onChange } = setup("float")
    expect(box().getAttribute("inputmode")).toBe("decimal")
    fireEvent.change(box(), { target: { value: "0.25" } })
    expect(onChange).toHaveBeenLastCalledWith(0.25)
    fireEvent.change(box(), { target: { value: "-3" } })
    expect(onChange).toHaveBeenLastCalledWith(-3)
  })

  it("holds a half-typed number without reporting it", () => {
    const { onChange } = setup("float")
    fireEvent.change(box(), { target: { value: "-" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(box().value).toBe("-")
    fireEvent.change(box(), { target: { value: "-." } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })

  it("rejects letters", () => {
    setup("float")
    fireEvent.change(box(), { target: { value: "1e5" } })
    expect(box().value).toBe("")
  })
})

describe("ValueInput json", () => {
  const area = () => screen.getByRole("textbox") as HTMLTextAreaElement

  it("renders a mono textarea", () => {
    setup("json")
    expect(area().tagName).toBe("TEXTAREA")
    expect(area().className).toMatch(/font-mono/)
  })

  it("reports the parsed value", () => {
    const { onChange } = setup("json")
    fireEvent.change(area(), { target: { value: '{"a": [1, 2]}' } })
    expect(onChange).toHaveBeenLastCalledWith({ a: [1, 2] })
    expect(screen.queryByText(/not valid json/i)).toBeNull()
  })

  it("reports undefined and shows the parse error under it", () => {
    const { onChange } = setup("json")
    fireEvent.change(area(), { target: { value: "{oops" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByText(/not valid json/i)).toBeTruthy()
    expect(area().getAttribute("aria-invalid")).toBe("true")
  })

  it("accepts the literal null as a value", () => {
    const { onChange } = setup("json")
    fireEvent.change(area(), { target: { value: "null" } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it("accepts a JSON string, which is not the same as the text", () => {
    const { onChange } = setup("json")
    fireEvent.change(area(), { target: { value: '"true"' } })
    expect(onChange).toHaveBeenLastCalledWith("true")
  })

  it("reports undefined without an error while empty", () => {
    const { onChange } = setup("json")
    fireEvent.change(area(), { target: { value: "{" } })
    fireEvent.change(area(), { target: { value: "" } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
    expect(screen.queryByText(/not valid json/i)).toBeNull()
  })
})

describe("ValueInput chrome", () => {
  it("puts the id on the control and marks it invalid when told to", () => {
    const onChange = vi.fn()
    render(
      <ValueInput id="the-id" type="string" value={undefined} onChange={onChange} invalid />,
    )
    expect(box().id).toBe("the-id")
    expect(box().getAttribute("aria-invalid")).toBe("true")
  })

  it("starts from the value it is given", () => {
    render(<ValueInput id="v" type="int" value={12} onChange={() => {}} />)
    expect(box().value).toBe("12")
  })

  it("starts over when the type changes", () => {
    const { rerender } = render(
      <ValueInput id="v" type="string" value={undefined} onChange={() => {}} />,
    )
    fireEvent.change(box(), { target: { value: "abc" } })
    rerender(<ValueInput id="v" type="int" value={undefined} onChange={() => {}} />)
    expect(box().value).toBe("")
  })
})
