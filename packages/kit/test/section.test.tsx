import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { Section } from "../src/components/section"
import { StatGrid } from "../src/components/stat-grid"
import { ResourceTable } from "../src/components/resource-table"
import { QueryBoundary } from "../src/components/query-boundary"

const classes = (el: Element) => el.className.split(/\s+/)
const content = (text: string) =>
  screen.getByText(text).closest('[data-slot="section-content"]') as HTMLElement

describe("Section", () => {
  it("is a region named by its level-two heading", () => {
    render(
      <Section title="Providers">
        <p>body</p>
      </Section>
    )
    const region = screen.getByRole("region", { name: "Providers" })
    expect(
      within(region).getByRole("heading", { level: 2, name: "Providers" })
    ).toBeTruthy()
  })

  it("puts the description and actions in the header strip", () => {
    render(
      <Section
        title="Providers"
        description="Brokers in use"
        actions={<button type="button">View all</button>}
      >
        <p>body</p>
      </Section>
    )
    const header = screen
      .getByRole("region", { name: "Providers" })
      .querySelector('[data-slot="section-header"]') as HTMLElement
    expect(within(header).getByText("Brokers in use")).toBeTruthy()
    expect(
      within(header).getByRole("button", { name: "View all" })
    ).toBeTruthy()
  })

  it("is flush by default and pads its content when inset", () => {
    const { rerender } = render(
      <Section title="A">
        <p>body</p>
      </Section>
    )
    expect(content("body").getAttribute("data-inset")).toBeNull()
    expect(classes(content("body"))).not.toContain("p-4")
    rerender(
      <Section title="A" inset>
        <p>body</p>
      </Section>
    )
    expect(content("body").getAttribute("data-inset")).toBe("true")
    expect(classes(content("body"))).toContain("p-4")
  })

  it("names an untitled section from aria-label and draws no heading", () => {
    render(
      <Section aria-label="Message log">
        <p>body</p>
      </Section>
    )
    const region = screen.getByRole("region", { name: "Message log" })
    expect(within(region).queryByRole("heading")).toBeNull()
    expect(region.querySelector('[data-slot="section-header"]')).toBeNull()
  })

  it("keeps a header strip for actions even without a title", () => {
    render(
      <Section
        aria-label="Message log"
        actions={<button type="button">Filter</button>}
      >
        <p>body</p>
      </Section>
    )
    const region = screen.getByRole("region", { name: "Message log" })
    const header = region.querySelector('[data-slot="section-header"]')
    expect(header).toBeTruthy()
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Filter" })
    ).toBeTruthy()
  })

  // An empty table's own frame must not double the panel's.
  it("strips the frame from an empty table state in flush content", () => {
    render(
      <Section title="Streams">
        <ResourceTable<{ id: string }>
          columns={[{ id: "id", header: "ID", cell: (r) => r.id }]}
          rows={[]}
          rowKey={(r) => r.id}
          emptyMessage="No streams configured."
        />
      </Section>
    )
    const c = content("No streams configured.")
    expect(classes(c)).toContain("[&_[data-slot=zero-state]]:border-0")
    expect(classes(c)).toContain("[&_[data-slot=zero-state]]:bg-transparent")
    expect(classes(c)).toContain("[&_[data-slot=zero-state]]:rounded-none")
  })

  // Loading and error states sit inside the panel without a second frame.
  it("pads a loading skeleton and unframes an error card in flush content", () => {
    render(
      <Section title="Streams">
        <QueryBoundary
          title="Streams"
          query={
            {
              data: undefined,
              loading: false,
              error: { code: "TRANSPORT", message: "down" },
              refetch: () => {},
            } as never
          }
        >
          {() => null}
        </QueryBoundary>
      </Section>
    )
    const c = content("Streams unavailable")
    expect(classes(c)).toContain("[&_[aria-busy=true][role=status]]:p-4")
    expect(classes(c)).toContain("[&_[data-slot=card]]:ring-0")
    expect(classes(c)).toContain("[&_[data-slot=card]]:rounded-none")
  })

  // The title column needs a real basis: flex-1 starts at 0 and never lets the
  // actions wrap below it, so a wide filter bar squeezes the description away.
  it("gives the title column a basis so wide actions wrap below it", () => {
    render(
      <Section
        title="Messages"
        description="Everything sent this week"
        actions={<button type="button">Filter</button>}
      >
        <p>body</p>
      </Section>
    )
    const column = screen.getByRole("heading", { level: 2 })
      .parentElement as HTMLElement
    expect(classes(column)).toContain("flex-[1_1_12rem]")
    expect(classes(column)).not.toContain("flex-1")
  })

  // An inset panel is still a panel: the error card drops its own ring.
  it("unframes an error card in inset content too", () => {
    render(
      <Section title="Usage" inset>
        <QueryBoundary
          title="Usage"
          query={
            {
              data: undefined,
              loading: false,
              error: { code: "TRANSPORT", message: "down" },
              refetch: () => {},
            } as never
          }
        >
          {() => null}
        </QueryBoundary>
      </Section>
    )
    const c = content("Usage unavailable")
    expect(classes(c)).toContain("[&_[data-slot=card]]:ring-0")
    expect(classes(c)).toContain("[&_[data-slot=card]]:rounded-none")
    expect(classes(c)).toContain("[&_[data-slot=card]]:shadow-none")
    expect(classes(c)).toContain("[&_[data-slot=card]]:px-0")
    expect(classes(c)).not.toContain("[&_[aria-busy=true][role=status]]:p-4")
  })

  // The flush table padding lives in section.css and keys on data-inset.
  it("marks inset content so the flush table rules skip it", () => {
    render(
      <Section title="Details" inset>
        <p>body</p>
      </Section>
    )
    expect(content("body").getAttribute("data-inset")).toBe("true")
  })

  it("loads the stylesheet that aligns flush table cells", () => {
    const src = readFileSync(
      join(__dirname, "../src/components/section.tsx"),
      "utf8"
    )
    expect(src).toContain('import "../styles/section.css"')
  })

  it("draws the foot strip for a plugin pager but not for ResourceTable's", () => {
    const css = readFileSync(
      join(__dirname, "../src/styles/section.css"),
      "utf8"
    )
    expect(css).toContain('nav[aria-label="Pagination"]')
    expect(css).toContain(':not([data-slot="resource-table-pagination"])')
  })

  it("unframes a StatGrid in flush content so a titled group is one panel", () => {
    render(
      <Section title="Jobs">
        <StatGrid items={[{ label: "Queued", value: 5 }]} />
      </Section>
    )
    const c = content("Queued")
    expect(classes(c)).toContain("[&_[data-slot=stat-grid]]:border-0")
    expect(classes(c)).toContain("[&_[data-slot=stat-grid]]:rounded-none")
  })
})
