import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CommandAlert, QueryBoundary } from "../src/components/query-boundary"

const settled = { loading: false, refetch: () => {} }

describe("QueryBoundary", () => {
  it("announces a busy status while loading and renders no children", () => {
    render(
      <QueryBoundary title="Users" query={{ loading: true, refetch: () => {} }}>
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status", { name: "Loading Users" })).toBeTruthy()
    expect(screen.queryByText("never")).toBeNull()
  })

  it("shows the error code alongside the message, and retries on demand", () => {
    const refetch = vi.fn()
    render(
      <QueryBoundary
        title="Users"
        query={{ loading: false, refetch, error: { code: "PERMISSION_DENIED", message: "nope" } }}
      >
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("alert").textContent).toContain("PERMISSION_DENIED")
    expect(screen.getByRole("alert").textContent).toContain("nope")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(refetch).toHaveBeenCalledOnce()
  })

  it("says so visibly when a read settles with no error and no data", () => {
    render(
      <QueryBoundary title="Users" query={settled}>
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status").textContent).toContain("Users returned no data.")
  })

  it("renders children with the data once it arrives", () => {
    render(
      <QueryBoundary title="Users" query={{ ...settled, data: { total: 2 } }}>
        {(data) => <p>{data.total} users</p>}
      </QueryBoundary>,
    )
    expect(screen.getByText("2 users")).toBeTruthy()
  })
})

describe("CommandAlert", () => {
  it("renders nothing when there is no error", () => {
    const { container } = render(<CommandAlert title="Ban failed" />)
    expect(container.firstChild).toBeNull()
  })

  it("leads with the server's sentence and follows with the code", () => {
    render(
      <CommandAlert
        title="Ban failed"
        error={{ code: "BAD_REQUEST", message: "user is already banned" }}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("user is already banned")
    expect(alert.textContent).toContain("BAD_REQUEST")
  })
})
