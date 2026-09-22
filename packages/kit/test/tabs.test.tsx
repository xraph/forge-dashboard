import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/components/tabs"

function ThreeTabs() {
  return (
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
        <TabsTrigger value="c">C</TabsTrigger>
      </TabsList>
      <TabsContent value="a">panel a</TabsContent>
      <TabsContent value="b">panel b</TabsContent>
      <TabsContent value="c">panel c</TabsContent>
    </Tabs>
  )
}

/** Panels Base UI has marked inert, which is every one but the selected tab. */
function inertPanels() {
  return screen.getAllByRole("tabpanel", { hidden: true }).filter((p) => p.hasAttribute("inert"))
}

describe("TabsContent", () => {
  it("leaves exactly one panel non-inert, whichever tab was picked last", () => {
    render(<ThreeTabs />)
    const panels = () => screen.getAllByRole("tabpanel", { hidden: true })

    // The defect this pins: Base UI holds a closing panel in the document
    // until its exit animation finishes, this panel defines none, so the wait
    // never ends and every visited tab stayed on screen stacked under the
    // current one. It took running the dashboard to see it, because two tabs
    // only made the page look long.
    expect(panels().length - inertPanels().length).toBe(1)

    fireEvent.click(screen.getByRole("tab", { name: "B" }))
    expect(panels().length - inertPanels().length).toBe(1)
    expect(inertPanels().some((p) => p.textContent === "panel b")).toBe(false)

    fireEvent.click(screen.getByRole("tab", { name: "C" }))
    expect(panels().length - inertPanels().length).toBe(1)

    // Back to the first one. Keying the hide off `data-ending-style` passed
    // every forward step above and then hid the active panel here, because
    // all three carry it permanently.
    fireEvent.click(screen.getByRole("tab", { name: "A" }))
    expect(panels().length - inertPanels().length).toBe(1)
    expect(inertPanels().some((p) => p.textContent === "panel a")).toBe(false)
  })

  it("carries the class that hides an inert panel", () => {
    render(<ThreeTabs />)
    // The visual half. `inert` already blocks interaction; without this the
    // panel is unreachable and still on screen.
    for (const panel of screen.getAllByRole("tabpanel", { hidden: true })) {
      expect(panel.className).toContain("[&[inert]]:hidden")
    }
  })
})
