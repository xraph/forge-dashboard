import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Ladder, LadderRow, LadderRows, Rung } from "../src/components/ladder"

const rung = (id: string) =>
  document.querySelector(`[data-rung="${id}"]`) as HTMLElement
const body = (id: string) =>
  rung(id).querySelector('[data-slot="rung-body"]') as HTMLElement

describe("Ladder", () => {
  it("numbers the rungs it is given, in the order it is given them", () => {
    render(
      <Ladder>
        <Rung id="a" number={1} title="First" />
        <Rung id="b" number={2} title="Second" />
      </Ladder>,
    )
    const items = screen.getAllByRole("listitem")
    expect(items.map((i) => i.getAttribute("data-rung"))).toEqual(["a", "b"])
    expect(items[0]?.textContent).toMatch(/^1First/)
    expect(items[1]?.textContent).toMatch(/^2Second/)
  })

  it("names each rung with a heading and says what it does in a sentence", () => {
    render(
      <Ladder>
        <Rung id="a" number={1} title="First" note="Beats every rung below." />
      </Ladder>,
    )
    expect(screen.getByRole("heading", { name: "First" })).toBeTruthy()
    expect(screen.getByText("Beats every rung below.")).toBeTruthy()
  })

  it("dims the body of a muted rung but not its notice", () => {
    render(
      <Ladder>
        <Rung id="a" number={1} title="First" muted notice="Stood down." />
        <Rung id="b" number={2} title="Second" />
      </Ladder>,
    )
    expect(body("a").className).toContain("opacity-60")
    expect(body("b").className).not.toContain("opacity-60")
    expect(body("a").textContent).not.toContain("Stood down.")
    expect(rung("a").textContent).toContain("Stood down.")
  })

  it("has slots per rung for an evaluation mark, an annotation and actions", () => {
    render(
      <Ladder>
        <Rung
          id="a"
          number={1}
          title="First"
          mark={<span>MARK</span>}
          annotation={<span>ANNOTATION</span>}
          actions={<button>ACTION</button>}
        />
      </Ladder>,
    )
    const header = rung("a")
    expect(header.textContent).toContain("MARK")
    expect(header.textContent).toContain("ANNOTATION")
    expect(screen.getByRole("button", { name: "ACTION" })).toBeTruthy()
  })

  it("marks a decided rung with the primary rail and says so in an attribute", () => {
    render(
      <Ladder>
        <Rung id="a" number={1} title="First" decided />
        <Rung id="b" number={2} title="Second" />
      </Ladder>,
    )
    expect(rung("a").getAttribute("data-decided")).toBe("true")
    expect(rung("a").className).toContain("border-primary")
    expect(rung("b").getAttribute("data-decided")).toBeNull()
    expect(rung("b").className).not.toContain("border-primary")
  })
})

describe("LadderRow", () => {
  it("shows the lead, the summary and the value, with slots for a mark and an annotation", () => {
    render(
      <LadderRows label="Rules">
        <LadderRow
          lead={2}
          value={<span>VALUE</span>}
          mark={<span>MARK</span>}
          annotation={<span>NOTE</span>}
          actions={<button>ACT</button>}
        >
          Summary words
        </LadderRow>
      </LadderRows>,
    )
    const row = screen.getByRole("listitem")
    expect(row.textContent).toContain("2")
    expect(row.textContent).toContain("Summary words")
    expect(row.textContent).toContain("VALUE")
    expect(row.textContent).toContain("MARK")
    expect(row.textContent).toContain("NOTE")
    expect(screen.getByRole("list", { name: "Rules" })).toBeTruthy()
  })

  it("carries no lead when it has none", () => {
    render(
      <LadderRows label="Overrides">
        <LadderRow value="v">t-acme</LadderRow>
      </LadderRows>,
    )
    expect(screen.getByRole("listitem").querySelector('[data-slot="row-lead"]')).toBeNull()
  })

  it("flags a decided row", () => {
    render(
      <LadderRows label="Rules">
        <LadderRow lead={1} decided value="v">
          x
        </LadderRow>
      </LadderRows>,
    )
    expect(screen.getByRole("listitem").getAttribute("data-decided")).toBe("true")
  })
})
