import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { LedgerTable } from "../src/components/ledger-table"

interface Row {
  id: string
  name: string
  amount: string
}

const columns = [
  { id: "name", header: "Name", className: "font-medium", cell: (r: Row) => r.name },
  { id: "amount", header: "Amount", align: "end" as const, className: "tabular-nums", cell: (r: Row) => r.amount },
]

describe("LedgerTable", () => {
  it("renders headers, cells, alignment and the caption", () => {
    render(<LedgerTable columns={columns} rows={[{ id: "a", name: "Seats", amount: "$90.00" }]} rowKey={(r) => r.id} caption="1 line" emptyMessage="None." />)
    expect(screen.getByRole("columnheader", { name: "Amount" }).className).toMatch(/text-right/)
    const cell = screen.getByText("$90.00").closest("td")!
    expect(cell.className).toMatch(/text-right/)
    expect(cell.className).toMatch(/tabular-nums/)
    expect(screen.getByText("1 line")).toBeTruthy()
  })

  it("keeps the count when there are no rows", () => {
    render(<LedgerTable columns={columns} rows={[]} rowKey={(r) => r.id} caption="0 lines" emptyMessage="No lines." />)
    expect(screen.getByText("No lines.")).toBeTruthy()
    expect(screen.getByText("0 lines")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("renders a footer row", () => {
    render(
      <LedgerTable
        columns={columns}
        rows={[{ id: "a", name: "Seats", amount: "$90.00" }]}
        rowKey={(r) => r.id}
        caption="1 line"
        emptyMessage="None."
        footer={
          <tr>
            <td>Total</td>
            <td>$90.00</td>
          </tr>
        }
      />,
    )
    const foot = screen.getByText("Total").closest("tfoot")!
    expect(within(foot).getByText("$90.00")).toBeTruthy()
  })
})
