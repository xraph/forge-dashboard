import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { EmptyState } from "../src/components/empty-state"

describe("EmptyState", () => {
  it("announces itself as a status so a screen reader hears the empty result", () => {
    render(<EmptyState title="No users yet." />)
    expect(screen.getByRole("status")).toBeTruthy()
    expect(screen.getByText("No users yet.")).toBeTruthy()
  })

  it("renders a description when given one and omits it otherwise", () => {
    const { rerender } = render(<EmptyState title="No users yet." />)
    expect(screen.queryByText("Invite somebody to get started.")).toBeNull()

    rerender(
      <EmptyState title="No users yet." description="Invite somebody to get started." />,
    )
    expect(screen.getByText("Invite somebody to get started.")).toBeTruthy()
  })

  it("renders the action it is handed", () => {
    render(<EmptyState title="No users yet." action={<button>Invite</button>} />)
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy()
  })
})
