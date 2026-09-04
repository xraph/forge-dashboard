import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  ForgeDashboardProvider,
  configFromWindow,
  useDashboardConfig,
} from "../src/config"

function ShowBase() {
  const cfg = useDashboardConfig()
  return <span data-testid="base">{cfg.contractBase}</span>
}

describe("config provider", () => {
  it("supplies config from props", () => {
    render(
      <ForgeDashboardProvider
        config={{ basePath: "/admin", contractBase: "/admin/api/v1" }}
      >
        <ShowBase />
      </ForgeDashboardProvider>,
    )

    expect(screen.getByTestId("base").textContent).toBe("/admin/api/v1")
  })

  it("derives contractBase and streamBase from basePath when omitted", () => {
    render(
      <ForgeDashboardProvider config={{ basePath: "/ops" }}>
        <ShowBase />
      </ForgeDashboardProvider>,
    )

    expect(screen.getByTestId("base").textContent).toBe("/ops/api/dashboard/v1")
  })

  it("throws when used outside a provider, rather than falling back silently", () => {
    // The old module-level-const design degraded to /dashboard with no error,
    // which is how the Next.js mount failed invisibly. Fail loudly instead.
    expect(() => render(<ShowBase />)).toThrow(/ForgeDashboardProvider/)
  })

  it("configFromWindow returns an empty object when there is no window", () => {
    // Saved/restored via try/finally so a failing expect above still leaves
    // globalThis.window restored for every test that runs after this one in
    // this jsdom environment.
    const saved = globalThis.window
    try {
      // @ts-expect-error deliberately simulating a server render
      delete globalThis.window

      expect(configFromWindow()).toEqual({})
    } finally {
      globalThis.window = saved
    }
  })

  it("derives every field from basePath when only basePath is given", () => {
    function ShowAll() {
      const cfg = useDashboardConfig()
      return <span data-testid="all">{JSON.stringify(cfg)}</span>
    }

    render(
      <ForgeDashboardProvider config={{ basePath: "/ops" }}>
        <ShowAll />
      </ForgeDashboardProvider>,
    )

    expect(JSON.parse(screen.getByTestId("all").textContent!)).toEqual({
      basePath: "/ops",
      contractBase: "/ops/api/dashboard/v1",
      streamBase: "/ops/api/dashboard/v1/stream",
      authEnabled: false,
      loginPath: "/ops/login",
      loginOp: "auth.login",
      loginContributor: "auth",
    })
  })

  it("configFromWindow reads the injected global when present", () => {
    // No @ts-expect-error needed here: src/config.tsx augments the global
    // Window interface with an optional __FORGE_DASHBOARD__, so this access
    // is valid TypeScript, not a test-only escape hatch.
    try {
      globalThis.window.__FORGE_DASHBOARD__ = { basePath: "/embedded" }

      expect(configFromWindow().basePath).toBe("/embedded")
    } finally {
      delete globalThis.window.__FORGE_DASHBOARD__
    }
  })
})
