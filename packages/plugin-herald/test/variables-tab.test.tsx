import { afterEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { VariablesTab } from "../src/workspace/variables-tab"
import type { VariableWire } from "../src/wire"

afterEach(cleanup)

const VARS: VariableWire[] = [
  { name: "customer_name", type: "string", required: true },
  { name: "amount", type: "string", required: true, default: "0" },
  {
    name: "invoice_url",
    type: "url",
    required: false,
    description: "Where the invoice lives",
  },
]

function setup(variables: VariableWire[] = VARS) {
  const onChange = vi.fn()
  render(<VariablesTab variables={variables} onChange={onChange} />)
  return {
    onChange,
    last: () => onChange.mock.calls.at(-1)?.[0] as VariableWire[],
  }
}

function Stateful({ initial }: { initial: VariableWire[] }) {
  const [vars, setVars] = useState(initial)
  return <VariablesTab variables={vars} onChange={setVars} />
}

describe("VariablesTab", () => {
  it("shows one row per variable under a counted caption, names in mono", () => {
    setup()
    const table = screen.getByRole("table", { name: "3 variables" })
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect(
      (screen.getByLabelText("Name of variable 1") as HTMLInputElement).value
    ).toBe("customer_name")
    expect(screen.getByLabelText("Name of variable 1").className).toContain(
      "font-mono"
    )
    expect(
      (screen.getByLabelText("Default for amount") as HTMLInputElement).value
    ).toBe("0")
    expect(
      (screen.getByLabelText("Description of invoice_url") as HTMLInputElement)
        .value
    ).toBe("Where the invoice lives")
  })

  it("lays the table out fixed, with widths on the header cells, so typing never moves a column", () => {
    setup()
    const table = screen.getByRole("table", { name: "3 variables" })
    expect(table.className).toContain("table-fixed")
    const heads = within(table).getAllByRole("columnheader")
    expect(heads.map((h) => h.textContent)).toEqual([
      "Name",
      "Type",
      "Required",
      "Default",
      "Description",
      "Order and removal",
    ])
    expect(heads[0]!.className).toContain("w-[28%]")
    expect(heads[1]!.className).toContain("w-[16%]")
    expect(heads[2]!.className).toContain("w-[9%]")
    expect(heads[3]!.className).toContain("w-[18%]")
    expect(heads[4]!.className).not.toMatch(/\bw-/)
    expect(heads[5]!.className).toContain("w-44")
  })

  it("counts zero and says what having none means", () => {
    setup([])
    expect(screen.getByRole("table", { name: "0 variables" })).toBeTruthy()
    expect(
      screen.getByText(
        "No variables. Every send of this template renders the same text."
      )
    ).toBeTruthy()
  })

  it("edits a field of one row and leaves the others alone", () => {
    const { last } = setup()
    fireEvent.change(screen.getByLabelText("Name of variable 2"), {
      target: { value: "total" },
    })
    expect(last().map((v) => v.name)).toEqual([
      "customer_name",
      "total",
      "invoice_url",
    ])
    fireEvent.click(
      screen.getByRole("checkbox", { name: "invoice_url is required" })
    )
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
    expect(last().map((v) => v.name)).toEqual([
      "amount",
      "customer_name",
      "invoice_url",
    ])
    fireEvent.click(screen.getByRole("button", { name: "Move amount down" }))
    expect(last().map((v) => v.name)).toEqual([
      "customer_name",
      "invoice_url",
      "amount",
    ])
    fireEvent.click(
      screen.getByRole("button", { name: "Remove customer_name" })
    )
    expect(last().map((v) => v.name)).toEqual(["amount", "invoice_url"])
    expect(
      (
        screen.getByRole("button", {
          name: "Move customer_name up",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      (
        screen.getByRole("button", {
          name: "Move invoice_url down",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
  })

  it("says what's wrong with a name on its own row", () => {
    setup([
      ...VARS,
      { name: "1st", type: "string", required: false },
      { name: "amount", type: "string", required: false },
    ])
    expect(
      screen.getByText(
        "Use up to 64 letters, digits and underscores, starting with a letter or an underscore."
      )
    ).toBeTruthy()
    expect(screen.getByText("amount is declared twice.")).toBeTruthy()
    expect(
      screen.getByLabelText("Name of variable 4").getAttribute("aria-invalid")
    ).toBe("true")
  })

  it("keeps focus on a row's button when the row moves", () => {
    render(<Stateful initial={VARS} />)
    const up = screen.getByRole("button", { name: "Move amount up" })
    up.focus()
    fireEvent.click(up)
    expect(
      (screen.getByLabelText("Name of variable 1") as HTMLInputElement).value
    ).toBe("amount")
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Move amount up" })
    )
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(true)
  })

  it("moves focus to a neighbouring row, or to Add variable, when a row is removed", () => {
    render(<Stateful initial={VARS.slice(0, 2)} />)
    fireEvent.click(screen.getByRole("button", { name: "Remove amount" }))
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove customer_name" })
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Remove customer_name" })
    )
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add variable" })
    )
  })

  it("ties a row's message to its name input", () => {
    setup([{ name: "1st", type: "string", required: false }])
    const input = screen.getByLabelText("Name of variable 1")
    const message = document.getElementById(
      input.getAttribute("aria-describedby") ?? ""
    )
    expect(message?.textContent).toBe(
      "Use up to 64 letters, digits and underscores, starting with a letter or an underscore."
    )
  })
})
