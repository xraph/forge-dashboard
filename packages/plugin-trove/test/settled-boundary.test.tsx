import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SettledBoundary } from "../src/components/settled-boundary"

function query(partial: Partial<QueryState<string>>): QueryState<string> {
  return { loading: false, refetch: () => {}, ...partial }
}

function renderBoundary(q: QueryState<string>) {
  return render(
    <SettledBoundary title="Things" query={q} skeletonRows={2}>
      {(data) => <p>{`data: ${data}`}</p>}
    </SettledBoundary>
  )
}

describe("SettledBoundary", () => {
  it("shows the busy skeleton on first load, when there is no data yet", () => {
    renderBoundary(query({ loading: true }))
    const busy = screen.getByRole("status", { name: "Loading Things" })
    expect(busy.getAttribute("aria-busy")).toBe("true")
    expect(screen.queryByText(/^data:/)).toBeNull()
  })

  it("shows the error card when the read failed and there is no data", () => {
    renderBoundary(
      query({ error: new ContractError("TRANSPORT", "network down") })
    )
    expect(screen.getByText("Things unavailable")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toContain(
      "TRANSPORT: network down"
    )
    expect(screen.queryByText(/^data:/)).toBeNull()
  })

  it("renders from the data while a refetch is loading", () => {
    renderBoundary(query({ data: "kept", loading: true }))
    expect(screen.getByText("data: kept")).toBeTruthy()
    expect(screen.queryByRole("status", { name: "Loading Things" })).toBeNull()
  })

  it("renders from the data when settled", () => {
    renderBoundary(query({ data: "settled" }))
    expect(screen.getByText("data: settled")).toBeTruthy()
  })
})
