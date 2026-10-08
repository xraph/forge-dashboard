import { expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CursorPager, EmptyResults, useCursor } from "../src/cursor"

function Probe({
  filter,
  complete = true,
}: {
  filter: string
  complete?: boolean
}) {
  const paging = useCursor(filter)
  return (
    <>
      <p>Cursor: {paging.cursor ?? "start"}</p>
      <CursorPager
        result={{
          complete,
          nextCursor: paging.cursor === null ? "next-page" : null,
        }}
        paging={paging}
        loading={false}
      />
    </>
  )
}
it("follows a cursor even when coverage is complete, supports back and resets after filters change", () => {
  const view = render(<Probe filter="all" />)
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  expect(screen.getByText("Cursor: next-page")).toBeTruthy()
  expect(
    screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")
  ).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Previous" }))
  expect(screen.getByText("Cursor: start")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "Next" }))
  view.rerender(<Probe filter="failed" />)
  expect(screen.getByText("Cursor: start")).toBeTruthy()
})
it("allows continuation through an empty incomplete portion", () => {
  let continued = false
  render(
    <EmptyResults
      subject="jobs"
      filtered
      complete={false}
      onReset={() => {}}
      onRefresh={() => {}}
      onContinue={() => {
        continued = true
      }}
    />
  )
  expect(screen.getByRole("status").textContent).toContain(
    "No results in this portion"
  )
  fireEvent.click(screen.getByRole("button", { name: "Continue search" }))
  expect(continued).toBe(true)
})
it.each([
  [false, "No jobs yet", "Refresh"],
  [true, "No matching jobs", "Clear filters"],
] as const)(
  "distinguishes filtered=%s empty results",
  (filtered, title, action) => {
    render(
      <EmptyResults
        subject="jobs"
        filtered={filtered}
        complete
        onReset={() => {}}
        onRefresh={() => {}}
      />
    )
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByRole("button", { name: action })).toBeTruthy()
  }
)
