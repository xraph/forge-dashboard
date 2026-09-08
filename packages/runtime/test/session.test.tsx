import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { ForgeDashboardProvider } from "../src/config"
import { SessionProvider, useSession } from "../src/session"

const config = { basePath: "/dashboard" }

function Probe() {
  const { state, epoch } = useSession()
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="epoch">{epoch}</span>
      <span data-testid="detail">
        {state.status === "signedIn"
          ? state.principal.email
          : state.status === "denied"
            ? state.requiredRoles.join(",")
            : state.status === "signedOut"
              ? state.loginPath
              : ""}
      </span>
    </div>
  )
}

function renderSession(fetchImpl: typeof fetch) {
  return render(
    <ForgeDashboardProvider config={config}>
      <SessionProvider fetchImpl={fetchImpl}>
        <Probe />
      </SessionProvider>
    </ForgeDashboardProvider>,
  )
}

function answer(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

beforeEach(() => {
  delete (window as { __FORGE_DASHBOARD__?: unknown }).__FORGE_DASHBOARD__
})

describe("useSession", () => {
  it("starts unknown when nothing was injected", () => {
    // A never-resolving fetch keeps the initial state on screen. Without the
    // `unknown` state this would have to render either the gate or the shell,
    // and both would be a guess.
    const pending = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    renderSession(pending)
    expect(screen.getByTestId("status").textContent).toBe("unknown")
  })

  it("seeds signedOut from a present-but-null injected principal", () => {
    ;(window as { __FORGE_DASHBOARD__?: unknown }).__FORGE_DASHBOARD__ = {
      basePath: "/dashboard",
      loginPath: "/dashboard/login",
      principal: null,
    }
    const pending = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    renderSession(pending)
    // The server rendered the page, looked, and found nobody. That is not the
    // same as not having been told, so the gate paints with no spinner first.
    expect(screen.getByTestId("status").textContent).toBe("signedOut")
  })

  it("seeds signedIn from an injected principal", () => {
    ;(window as { __FORGE_DASHBOARD__?: unknown }).__FORGE_DASHBOARD__ = {
      basePath: "/dashboard",
      principal: { authenticated: true, subject: "u1", email: "seed@example.com" },
    }
    const pending = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    renderSession(pending)
    expect(screen.getByTestId("status").textContent).toBe("signedIn")
    expect(screen.getByTestId("detail").textContent).toBe("seed@example.com")
  })

  it("lets the endpoint downgrade an injected principal", async () => {
    ;(window as { __FORGE_DASHBOARD__?: unknown }).__FORGE_DASHBOARD__ = {
      basePath: "/dashboard",
      principal: { authenticated: true, subject: "u1", email: "seed@example.com" },
    }
    renderSession(answer(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }))
    // Truth wins, including downwards. Treating the injected value as
    // authoritative once present is the mutation this catches.
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedOut"))
  })

  it("resolves anonymous when auth is switched off", async () => {
    renderSession(answer(200, { authenticated: false }))
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anonymous"))
  })

  it("resolves signedIn and carries the principal", async () => {
    renderSession(
      answer(200, {
        authenticated: true,
        subject: "usr_1",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        roles: ["admin"],
      }),
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedIn"))
    expect(screen.getByTestId("detail").textContent).toBe("ada@example.com")
  })

  it("resolves signedOut and carries the endpoint's loginPath", async () => {
    renderSession(answer(401, { code: "UNAUTHENTICATED", loginPath: "/ops/login" }))
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedOut"))
    expect(screen.getByTestId("detail").textContent).toBe("/ops/login")
  })

  it("falls back to the configured loginPath when the 401 omits one", async () => {
    renderSession(answer(401, { code: "UNAUTHENTICATED" }))
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("signedOut"))
    expect(screen.getByTestId("detail").textContent).toBe("/dashboard/login")
  })

  it("resolves denied and carries requiredRoles", async () => {
    renderSession(
      answer(403, { code: "PERMISSION_DENIED", requiredRoles: ["admin", "auditor"] }),
    )
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("denied"))
    expect(screen.getByTestId("detail").textContent).toBe("admin,auditor")
  })

  it("resolves unreachable on a transport failure", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network is down")
    }) as unknown as typeof fetch
    renderSession(failing)
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("unreachable"))
  })

  it("increments epoch once per resolved fetch", async () => {
    renderSession(answer(200, { authenticated: false }))
    await waitFor(() => expect(screen.getByTestId("epoch").textContent).toBe("1"))
  })

  it("throws a named error outside a provider", () => {
    // Same contract as useDashboardConfig: a missing provider is a wiring bug
    // and has to say so, not return a plausible default.
    expect(() => render(<Probe />)).toThrow(/SessionProvider/)
  })
})
