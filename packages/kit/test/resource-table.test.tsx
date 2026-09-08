import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  ResourceTable,
  type Column,
  type ResourceTableProps,
} from "../src/components/resource-table"

interface User {
  id: string
  email: string
  createdAt: string
}

const columns: Column<User>[] = [
  { id: "email", header: "Email", cell: (u) => u.email, sortable: true },
  { id: "createdAt", header: "Created", cell: (u) => u.createdAt },
]

const rows: User[] = [
  { id: "u1", email: "ada@example.com", createdAt: "2026-01-01" },
  { id: "u2", email: "grace@example.com", createdAt: "2026-02-01" },
]

function renderTable(props: Partial<ResourceTableProps<User>> = {}) {
  return render(
    <ResourceTable<User>
      columns={columns}
      rows={rows}
      rowKey={(u) => u.id}
      emptyMessage="No users yet."
      {...props}
    />,
  )
}

describe("ResourceTable", () => {
  it("renders one row per record with every column's cell", () => {
    renderTable()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.getByText("grace@example.com")).toBeTruthy()
    expect(screen.getByText("2026-02-01")).toBeTruthy()
  })

  it("shows the empty state instead of a table body when there are no rows", () => {
    renderTable({ rows: [] })
    expect(screen.getByRole("status").textContent).toContain("No users yet.")
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("makes only sortable headers pressable", () => {
    // onSortChange is required here: a sortable column with no handler must NOT
    // render a button, because clicking it would do nothing.
    renderTable({ onSortChange: () => {} })
    expect(screen.getByRole("button", { name: /Email/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Created/ })).toBeNull()
  })

  it("renders a sortable column as a plain header when no handler is supplied", () => {
    renderTable()
    expect(screen.queryByRole("button", { name: /Email/ })).toBeNull()
  })

  it("asks for ascending on a fresh column and flips direction on the sorted one", () => {
    const onSortChange = vi.fn()
    const { rerender } = renderTable({ onSortChange })
    fireEvent.click(screen.getByRole("button", { name: /Email/ }))
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "email", direction: "asc" })

    rerender(
      <ResourceTable<User>
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        emptyMessage="No users yet."
        sort={{ columnId: "email", direction: "asc" }}
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: /Email/ }))
    expect(onSortChange).toHaveBeenLastCalledWith({ columnId: "email", direction: "desc" })
  })

  it("tells assistive tech which column is sorted and which way", () => {
    renderTable({ sort: { columnId: "email", direction: "desc" }, onSortChange: () => {} })
    const header = screen.getByRole("columnheader", { name: /Email/ })
    expect(header.getAttribute("aria-sort")).toBe("descending")
  })

  it("renders row actions when given them", () => {
    renderTable({ rowActions: (u) => <button>Ban {u.email}</button> })
    expect(screen.getByRole("button", { name: "Ban ada@example.com" })).toBeTruthy()
  })

  it("does not sort the rows it was handed", () => {
    renderTable({ sort: { columnId: "email", direction: "desc" }, onSortChange: () => {} })
    const cells = screen.getAllByRole("cell").map((c) => c.textContent)
    expect(cells.indexOf("ada@example.com")).toBeLessThan(cells.indexOf("grace@example.com"))
  })

  it("disables previous on the first page and next on the last", () => {
    const onPageChange = vi.fn()
    renderTable({ pagination: { page: 1, pageSize: 2, total: 4 }, onPageChange })
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it("renders no pagination controls when there is only one page", () => {
    renderTable({ pagination: { page: 1, pageSize: 10, total: 2 }, onPageChange: () => {} })
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull()
  })
})
