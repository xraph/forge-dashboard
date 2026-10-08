import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { SuiteDetailPage } from "../src/pages/suite-detail"
import { config, run, suite, SUITE_ID, trend } from "./fixtures"
import { renderNavPage, stubClient } from "./harness"

// The charts' chunks fail to load, as they do when a deploy has replaced the
// chunk the page was built against. Its own file, because React.lazy keeps
// the first answer it gets for the life of the module: a rejection here would
// leave trend.test.tsx's charts unable to draw.
vi.mock("../src/charts/trend-chart", () =>
  Promise.reject(new Error("Failed to fetch dynamically imported module"))
)
vi.mock("../src/charts/dimension-trends", () =>
  Promise.reject(new Error("Failed to fetch dynamically imported module"))
)

describe("A trend chart that will not load", () => {
  it("costs the chart, not the page, and the table still has the numbers", async () => {
    renderNavPage(
      SuiteDetailPage,
      stubClient({
        "suites.detail": suite(),
        "config.get": config(),
        "runs.list": { items: [run()], hasMore: false },
        "runs.trend": trend(),
      }),
      { id: SUITE_ID, tab: "runs" }
    )
    const notes = await screen.findAllByText(
      "The chart could not load. The table beside it has the same numbers."
    )
    expect(notes).toHaveLength(2)
    expect(
      screen.getByRole("heading", { level: 1, name: "Support assistant" })
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show pass rate over runs as a table",
      })
    )
    const table = screen.getByRole("region", {
      name: "3 completed runs, oldest first",
    })
    expect(within(table).getAllByRole("row")).toHaveLength(4)
  })
})
