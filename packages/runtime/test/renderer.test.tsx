import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { IntentRegistry } from "../src/registry"
import { GraphRenderer, RegistryProvider, SlotRenderer } from "../src/renderer"
import type { IntentComponentProps } from "../src/types"

function Text({ props }: IntentComponentProps<{ value?: string }>) {
  return <span>{props.value}</span>
}

function Page({ slots }: IntentComponentProps) {
  return (
    <main>
      <SlotRenderer slot="main" slots={slots} />
    </main>
  )
}

function withRegistry(
  reg: IntentRegistry,
  node: Parameters<typeof GraphRenderer>[0]["node"]
) {
  return (
    <RegistryProvider registry={reg}>
      <GraphRenderer node={node} />
    </RegistryProvider>
  )
}

describe("GraphRenderer", () => {
  it("renders a leaf intent with its props", () => {
    const reg = new IntentRegistry().register("atom.text", Text)

    render(
      withRegistry(reg, { intent: "atom.text", props: { value: "hello" } })
    )

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
      })
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
      })
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
      })
    )

    expect(screen.getByText("survivor")).toBeDefined()
    // The survivor alone is not enough: a fallback that returned null would
    // leave that assertion green while silently swallowing the unknown node.
    expect(screen.getByText(/billing.not-loaded/)).toBeDefined()
  })

  it("throws a clear error when rendered outside a RegistryProvider", () => {
    expect(() =>
      render(<GraphRenderer node={{ intent: "atom.text" }} />)
    ).toThrow(/RegistryProvider/)
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

// fallbacks.tsx calls the unknown-intent state normal for a contributor module
// that has not loaded yet. That is only true if the state can end: the
// registry is mutable, so the renderer has to watch it.
describe("late registration", () => {
  it("renders an intent registered after the initial render", async () => {
    const reg = new IntentRegistry()
    render(
      withRegistry(reg, { intent: "billing.late", props: { value: "arrived" } })
    )
    expect(screen.getByText(/billing.late/)).toBeDefined()

    await act(async () => {
      reg.registerNamespaced("billing", { "billing.late": Text })
    })

    expect(screen.queryByText(/Unknown intent/)).toBeNull()
    expect(screen.getByText("arrived")).toBeDefined()
  })
})

function Exploding(): never {
  throw new Error("intent component blew up")
}

describe("intent error boundary", () => {
  it("contains a throwing intent and keeps its sibling on screen", () => {
    // React logs the caught error to stderr. That output is expected here.
    const reg = new IntentRegistry()
      .register("page.shell", Page)
      .register("atom.boom", Exploding)
      .register("atom.text", Text)

    render(
      withRegistry(reg, {
        intent: "page.shell",
        slots: {
          main: [
            { intent: "atom.boom" },
            { intent: "atom.text", props: { value: "still here" } },
          ],
        },
      })
    )

    expect(screen.getByText(/atom.boom/)).toBeDefined()
    expect(screen.getByText("still here")).toBeDefined()
  })
})
