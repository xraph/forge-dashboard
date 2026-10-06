import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { VariablesTab } from "../src/workspace/variables-tab"
import type { VariableWire } from "../src/wire"

afterEach(cleanup)

const VARS: VariableWire[] = [
  { name: "customer_name", type: "string", required: true },
  { name: "amount", type: "string", required: true, default: "0" },
  { name: "invoice_url", type: "url", required: false, description: "Where the invoice lives" },
]

function setup(variables: VariableWire[] = VARS) {
  const onChange = vi.fn()
  render(<VariablesTab variables={variables} onChange={onChange} />)
  return { onChange, last: () => onChange.mock.calls.at(-1)?.[0] as VariableWire[] }
}

describe("VariablesTab", () => {
  it("shows one row per variable under a counted caption, names in mono", () => {
    setup()
    const table = screen.getByRole("table", { name: "3 variables" })
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect((screen.getByLabelText("Name of variable 1") as HTMLInputElement).value).toBe("customer_name")
    expect(screen.getByLabelText("Name of variable 1").className).toContain("font-mono")
    expect((screen.getByLabelText("Default for amount") as HTMLInputElement).value).toBe("0")
    expect((screen.getByLabelText("Description of invoice_url") as HTMLInputElement).value).toBe("Where the invoice lives")
  })

  it("counts zero and says what having none means", () => {
    setup([])
    expect(screen.getByRole("table", { name: "0 variables" })).toBeTruthy()
    expect(screen.getByText("No variables. Every send of this template renders the same text.")).toBeTruthy()
  })

  it("edits a field of one row and leaves the others alone", () => {
    const { last } = setup()
    fireEvent.change(screen.getByLabelText("Name of variable 2"), { target: { value: "total" } })
    expect(last().map((v) => v.name)).toEqual(["customer_name", "total", "invoice_url"])
    fireEvent.click(screen.getByRole("checkbox", { name: "invoice_url is required" }))
    expect(last()[2].required).toBe(true)
  })

  it("adds an empty string variable at the end", () => {
    const { last } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }))
    expect(last()).toHaveLength(4)
    expect(last()[3]).toEqual({ name: "", type: "string", required: false })
  })

  it("moves and removes rows", () => {
    const { last } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Move amount up" }))
    expect(last().map((v) => v.name)).toEqual(["amount", "customer_name", "invoice_url"])
    fireEvent.click(screen.getByRole("button", { name: "Move amount down" }))
    expect(last().map((v) => v.name)).toEqual(["customer_name", "invoice_url", "amount"])
    fireEvent.click(screen.getByRole("button", { name: "Remove customer_name" }))
    expect(last().map((v) => v.name)).toEqual(["amount", "invoice_url"])
    expect((screen.getByRole("button", { name: "Move customer_name up" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Move invoice_url down" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("says what's wrong with a name on its own row", () => {
    setup([...VARS, { name: "1st", type: "string", required: false }, { name: "amount", type: "string", required: false }])
    expect(screen.getByText("Use letters, digits and underscores, starting with a letter or an underscore.")).toBeTruthy()
    expect(screen.getByText("amount is declared twice.")).toBeTruthy()
    expect(screen.getByLabelText("Name of variable 4").getAttribute("aria-invalid")).toBe("true")
  })
})
