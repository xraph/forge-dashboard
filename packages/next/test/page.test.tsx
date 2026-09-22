// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// next/dynamic's ssr:false branch needs a Next runtime. The page's job is the
// prop mapping underneath it, so the loader is resolved eagerly here.
vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<unknown>) => {
    let Resolved: React.ComponentType<Record<string, unknown>> | null = null
    void loader().then((mod) => {
      Resolved = mod as React.ComponentType<Record<string, unknown>>
    })
    return (props: Record<string, unknown>) =>
      Resolved ? <Resolved {...props} /> : null
  },
}))

const seen: Record<string, unknown>[] = []

vi.mock("@forge-go/dashboard-host", () => ({
  ForgeDashboard: (props: Record<string, unknown>) => {
    seen.push(props)
    return <div data-testid="host" />
  },
}))

const { defineForgeDashboard } = await import("../src/define")
const { ForgeDashboardPage } = await import("../src/page")

describe("ForgeDashboardPage", () => {
  it("routes on the mount path and reaches the contract on the api path", async () => {
    const forge = defineForgeDashboard({ mountPath: "/forge", plugins: [] })

    render(<ForgeDashboardPage forge={forge} />)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    const props = seen.at(-1) as { basename: string; config: { basePath: string } }
    // The basename is the page's own mount. Handing it the contract prefix
    // instead is the mistake that puts every route one directory off.
    expect(props.basename).toBe("/forge")
    expect(props.config.basePath).toBe("/api/forge")
  })
})
