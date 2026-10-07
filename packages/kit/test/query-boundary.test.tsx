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

  it("swaps in the skeleton on a refetch by default, even with data in hand", () => {
    render(
      <QueryBoundary title="Users" query={{ loading: true, refetch: () => {}, data: { total: 2 } }}>
        {(data) => <p>{data.total} users</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status", { name: "Loading Users" })).toBeTruthy()
    expect(screen.queryByText("2 users")).toBeNull()
  })

  it("keeps rendering the data through a refetch when asked, marked busy", () => {
    render(
      <QueryBoundary
        keepPreviousData
        title="Users"
        query={{ loading: true, refetch: () => {}, data: { total: 2 } }}
      >
        {(data) => <p>{data.total} users</p>}
      </QueryBoundary>,
    )
    expect(screen.getByText("2 users")).toBeTruthy()
    expect(screen.queryByRole("status", { name: "Loading Users" })).toBeNull()
    expect(screen.getByText("2 users").parentElement?.getAttribute("aria-busy")).toBe("true")
  })

  it("still shows the skeleton on a first load with keepPreviousData", () => {
    render(
      <QueryBoundary keepPreviousData title="Users" query={{ loading: true, refetch: () => {} }}>
        {() => <p>never</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("status", { name: "Loading Users" })).toBeTruthy()
    expect(screen.queryByText("never")).toBeNull()
  })

  it("does not remount the children, or drop their focus, when a refetch starts and ends", () => {
    const view = (loading: boolean) => (
      <QueryBoundary
        keepPreviousData
        title="Users"
        query={{ loading, refetch: () => {}, data: { total: 2 } }}
      >
        {() => <input aria-label="search" />}
      </QueryBoundary>
    )
    const { rerender } = render(view(false))
    const input = screen.getByLabelText("search")
    input.focus()
    rerender(view(true))
    expect(screen.getByLabelText("search")).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.parentElement?.getAttribute("aria-busy")).toBe("true")
    rerender(view(false))
    expect(screen.getByLabelText("search")).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.parentElement?.getAttribute("aria-busy")).toBe("false")
  })

  it("shows the error card for a settled failure even with data and keepPreviousData", () => {
    render(
      <QueryBoundary
        keepPreviousData
        title="Users"
        query={{
          loading: false,
          refetch: () => {},
          data: { total: 2 },
          error: { code: "TRANSPORT", message: "down" },
        }}
      >
        {(data) => <p>{data.total} users</p>}
      </QueryBoundary>,
    )
    expect(screen.getByRole("alert").textContent).toContain("TRANSPORT")
    expect(screen.queryByText("2 users")).toBeNull()
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

  it("still shows the code with showCode left unset, the dashboard default", () => {
    render(
      <CommandAlert
        title="Ban failed"
        error={{ code: "BAD_REQUEST", message: "user is already banned" }}
        showCode={true}
      />,
    )
    expect(screen.getByRole("alert").textContent).toContain("BAD_REQUEST")
  })

  it("hides the code when showCode is false, for a reader who is not signed in", () => {
    render(
      <CommandAlert
        title="Sign in failed"
        error={{ code: "UNAUTHENTICATED", message: "Incorrect email or password" }}
        showCode={false}
      />,
    )
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Incorrect email or password")
    expect(alert.textContent).not.toContain("UNAUTHENTICATED")
  })
})
