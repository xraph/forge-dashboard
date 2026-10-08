import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import {
  NamespaceCell,
  namespaceParam,
  namespaceOptions,
  useNamespaceFilter,
} from "../src/components/namespace-filter"
import { failingClient, stubClient } from "./harness"
import { ContractError } from "@forge-go/dashboard-plugin"

describe("NamespaceCell", () => {
  it("renders the tenant root as a slash", () => {
    render(<NamespaceCell path="" />)
    expect(screen.getByText("/")).toBeTruthy()
  })

  /**
   * namespaceSegmentRegex permits "root" as an ordinary segment name, so a
   * namespace literally called root must stay distinguishable from the
   * tenant root. Rendering the tenant root as the word "root" would collapse
   * the two into one label.
   */
  it("keeps a namespace named root distinct from the tenant root", () => {
    const { rerender } = render(<NamespaceCell path="root" />)
    expect(screen.getByText("root")).toBeTruthy()
    rerender(<NamespaceCell path="" />)
    expect(screen.getByText("/")).toBeTruthy()
    expect(screen.queryByText("root")).toBeNull()
  })
})

describe("namespaceParam", () => {
  /**
   * The three states are not two. "All namespaces" and "the tenant root" are
   * different queries, and the contract distinguishes them by nil versus the
   * empty string, so the param builder must too. A builder that sent "" for
   * "all" would silently scope every list to the root.
   */
  it("sends undefined for all namespaces and an empty string for the root", () => {
    expect(namespaceParam("all")).toEqual({})
    expect(namespaceParam("")).toEqual({ namespacePath: "" })
    expect(namespaceParam("eng/platform")).toEqual({
      namespacePath: "eng/platform",
    })
  })
})

describe("namespaceOptions", () => {
  it("offers all and the tenant root even when only the root exists", () => {
    // Both must appear even though they return the same rows here, because
    // they are different queries and the next namespace someone creates
    // makes them differ.
    const opts = namespaceOptions([""])
    expect(opts.map((o) => o.value)).toEqual(["all", ""])
    expect(opts[0].label).toBe("All namespaces")
    expect(opts[1].label).toBe("Tenant root")
  })

  it("lists discovered namespaces after the root, in order", () => {
    const opts = namespaceOptions(["", "billing", "eng", "eng/platform"])
    expect(opts.map((o) => o.value)).toEqual([
      "all",
      "",
      "billing",
      "eng",
      "eng/platform",
    ])
  })

  it("never renders a blank option label", () => {
    // A select whose empty option means "all" cannot also express "root".
    // Every option carries a real label so neither can be mistaken for the
    // other or for a placeholder.
    for (const opt of namespaceOptions(["", "eng"])) {
      expect(opt.label.trim()).not.toBe("")
    }
  })
})

/**
 * Renders the hook's output so it can be asserted on, plus three buttons
 * that drive `filterConfig.onChange` the way the FilterBar's select would:
 * one per state the hook distinguishes.
 */
function Probe() {
  const { value, filterConfig, param } = useNamespaceFilter()
  return (
    <div>
      <span data-testid="value">{value}</span>
      <span data-testid="param">{JSON.stringify(param)}</span>
      <span data-testid="options">
        {filterConfig.options.map((o) => o.label).join("|")}
      </span>
      <button onClick={() => filterConfig.onChange("all")}>pick-all</button>
      <button onClick={() => filterConfig.onChange("")}>pick-root</button>
      <button onClick={() => filterConfig.onChange("eng")}>pick-eng</button>
    </div>
  )
}

describe("useNamespaceFilter", () => {
  it("starts on all namespaces and sends no namespace param", async () => {
    render(
      <PluginProvider
        client={stubClient({ "namespaces.list": { namespaces: ["", "eng"] } })}
      >
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("value")).textContent).toBe("all")
    expect(screen.getByTestId("param").textContent).toBe("{}")
  })

  it("offers every namespace the query returned", async () => {
    render(
      <PluginProvider
        client={stubClient({ "namespaces.list": { namespaces: ["", "eng"] } })}
      >
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("options")).textContent).toBe(
      "All namespaces|Tenant root|eng"
    )
  })

  /**
   * The hook has no caller yet (the list pages arrive in a later plan), so
   * this test is the only thing proving `onChange` actually drives `param`
   * through its three states. "all" must produce an ABSENT field and "" must
   * produce an empty-string field: a builder that sent "" for "all" would
   * silently scope every list to the tenant root, and the root usually has
   * rows, so nobody would notice from the screen.
   */
  it("moves param through all, root and a named namespace as onChange fires", async () => {
    render(
      <PluginProvider
        client={stubClient({ "namespaces.list": { namespaces: ["", "eng"] } })}
      >
        <Probe />
      </PluginProvider>
    )
    await screen.findByTestId("value")
    expect(screen.getByTestId("param").textContent).toBe("{}")

    fireEvent.click(screen.getByText("pick-root"))
    expect(screen.getByTestId("value").textContent).toBe("")
    expect(screen.getByTestId("param").textContent).toBe(
      JSON.stringify({ namespacePath: "" })
    )

    fireEvent.click(screen.getByText("pick-eng"))
    expect(screen.getByTestId("value").textContent).toBe("eng")
    expect(screen.getByTestId("param").textContent).toBe(
      JSON.stringify({ namespacePath: "eng" })
    )

    fireEvent.click(screen.getByText("pick-all"))
    expect(screen.getByTestId("value").textContent).toBe("all")
    expect(screen.getByTestId("param").textContent).toBe("{}")
  })

  it("still filters when the namespace list cannot be read", async () => {
    // A page whose namespace list is unavailable must still render its
    // rows. Falling back to the two options that always exist keeps the
    // filter usable instead of blanking the control or the page.
    render(
      <PluginProvider
        client={failingClient(new ContractError("INTERNAL", "boom"))}
      >
        <Probe />
      </PluginProvider>
    )
    expect((await screen.findByTestId("options")).textContent).toBe(
      "All namespaces|Tenant root"
    )
  })
})
