import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { FilterBar } from "../src/components/filter-bar"

describe("FilterBar", () => {
  it("reports every keystroke in the search box", () => {
    const onChange = vi.fn()
    render(
      <FilterBar search={{ value: "", onChange, label: "Search users" }} />,
    )
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), {
      target: { value: "ada" },
    })
    expect(onChange).toHaveBeenCalledWith("ada")
  })

  it("renders a labelled select per filter and reports the chosen value", () => {
    const onChange = vi.fn()
    render(
      <FilterBar
        filters={[
          {
            id: "status",
            label: "Status",
            value: "all",
            onChange,
            options: [
              { label: "All", value: "all" },
              { label: "Banned", value: "banned" },
            ],
          },
        ]}
      />,
    )
    const select = screen.getByRole("combobox", { name: "Status" })
    fireEvent.change(select, { target: { value: "banned" } })
    expect(onChange).toHaveBeenCalledWith("banned")
  })

  it("renders nothing at all when it has no search, no filters and no actions", () => {
    const { container } = render(<FilterBar />)
    expect(container.firstChild).toBeNull()
  })

  it("renders actions", () => {
    render(<FilterBar actions={<button>Export</button>} />)
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy()
  })
})
