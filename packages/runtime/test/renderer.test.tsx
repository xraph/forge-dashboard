import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { IntentRegistry } from "../src/registry"
import { GraphRenderer, RegistryProvider, SlotRenderer } from "../src/renderer"
import type { IntentComponentProps } from "../src/types"

function Text({ props }: IntentComponentProps<unknown, { value?: string }>) {
  return <span>{props.value}</span>
}

function Page({ slots }: IntentComponentProps) {
  return (
    <main>
      <SlotRenderer slot="main" slots={slots} />
    </main>
  )
}

function withRegistry(reg: IntentRegistry, node: Parameters<typeof GraphRenderer>[0]["node"]) {
  return (
    <RegistryProvider registry={reg}>
      <GraphRenderer node={node} />
    </RegistryProvider>
  )
}

describe("GraphRenderer", () => {
  it("renders a leaf intent with its props", () => {
    const reg = new IntentRegistry().register("atom.text", Text)

    render(withRegistry(reg, { intent: "atom.text", props: { value: "hello" } }))

    expect(screen.getByText("hello")).toBeDefined()
  })

  it("renders children into the slot the parent asked for", () => {
    const reg = new IntentRegistry()
      .register("page.shell", Page)
      .register("atom.text", Text)

    render(
      withRegistry(reg, {
        intent: "page.shell",
        slots: {
          main: [
            { intent: "atom.text", props: { value: "first" } },
            { intent: "atom.text", props: { value: "second" } },
          ],
        },
      }),
    )

    expect(screen.getByText("first")).toBeDefined()
    expect(screen.getByText("second")).toBeDefined()
  })

  it("ignores slots the parent never renders", () => {
    const reg = new IntentRegistry()
      .register("page.shell", Page)
      .register("atom.text", Text)

    render(
      withRegistry(reg, {
        intent: "page.shell",
        slots: {
          main: [{ intent: "atom.text", props: { value: "shown" } }],
          sidebar: [{ intent: "atom.text", props: { value: "hidden" } }],
        },
      }),
    )

    expect(screen.getByText("shown")).toBeDefined()
    expect(screen.queryByText("hidden")).toBeNull()
  })

  // Spec section 2: an unresolved intent degrades, it does not blank the page.
  it("falls back visibly for an unregistered intent", () => {
    const reg = new IntentRegistry()

    render(withRegistry(reg, { intent: "billing.not-loaded" }))

    expect(screen.getByText(/billing.not-loaded/)).toBeDefined()
  })

  it("keeps rendering siblings when one intent is unresolved", () => {
    const reg = new IntentRegistry()
      .register("page.shell", Page)
      .register("atom.text", Text)

    render(
      withRegistry(reg, {
        intent: "page.shell",
        slots: {
          main: [
            { intent: "billing.not-loaded" },
            { intent: "atom.text", props: { value: "survivor" } },
          ],
        },
      }),
    )

    expect(screen.getByText("survivor")).toBeDefined()
  })

  it("throws a clear error when rendered outside a RegistryProvider", () => {
    expect(() => render(<GraphRenderer node={{ intent: "atom.text" }} />)).toThrow(
      /RegistryProvider/,
    )
  })

  it("gives an intent component empty objects, not undefined, when the node has neither", () => {
    const seen: { props?: unknown; slots?: unknown } = {}
    function Probe({ props, slots }: IntentComponentProps) {
      seen.props = props
      seen.slots = slots
      return null
    }
    const reg = new IntentRegistry().register("atom.bare", Probe)

    render(withRegistry(reg, { intent: "atom.bare" }))

    expect(seen.props).toEqual({})
    expect(seen.slots).toEqual({})
  })
})
