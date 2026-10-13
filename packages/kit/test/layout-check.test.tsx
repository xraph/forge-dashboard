import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { layoutViolations } from "../src/lib/layout-check"
import { Section } from "../src/components/section"

describe("layoutViolations", () => {
  it("passes a page with one h1 and every h2 and table inside a section", () => {
    const { container } = render(
      <>
        <h1>Keys</h1>
        <Section title="Active keys">
          <table>
            <tbody>
              <tr>
                <td>k1</td>
              </tr>
            </tbody>
          </table>
        </Section>
      </>
    )
    expect(layoutViolations(container)).toEqual([])
  })

  it("reports a missing or doubled h1", () => {
    const none = render(<p>no heading</p>)
    expect(layoutViolations(none.container)).toEqual([
      "expected one h1, found 0",
    ])
    const two = render(
      <>
        <h1>A</h1>
        <h1>B</h1>
      </>
    )
    expect(layoutViolations(two.container)).toEqual([
      "expected one h1, found 2",
    ])
  })

  it("reports a bare h2 by its text", () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <h2>Streams</h2>
      </>
    )
    expect(layoutViolations(container)).toEqual([
      'h2 outside a section: "Streams"',
    ])
  })

  it("reports a table outside a section, named by its region label", () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <div role="region" aria-label="Deliveries">
          <table>
            <tbody>
              <tr>
                <td>d1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    )
    expect(layoutViolations(container)).toEqual([
      'table outside a section: "Deliveries"',
    ])
  })

  it("lets an outlier keep a workspace table outside sections", () => {
    const { container } = render(
      <>
        <h1>Editor</h1>
        <table aria-label="Grid">
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </>
    )
    expect(
      layoutViolations(container, { allowTablesOutsideSections: true })
    ).toEqual([])
  })

  it("reports a section nested inside another section", () => {
    const { container } = render(
      <>
        <h1>Page</h1>
        <Section title="Outer">
          <Section title="Inner">
            <p>x</p>
          </Section>
        </Section>
      </>
    )
    expect(layoutViolations(container)).toEqual([
      'section inside a section: "Inner"',
    ])
  })
})
