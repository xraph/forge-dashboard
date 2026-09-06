import { render, screen } from "@testing-library/react"
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
