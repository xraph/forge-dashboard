import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { DeniedScreen } from "../src/auth/screens/denied"

// No vi.mock("@forge-go/dashboard-plugin") in this file, deliberately. The
// point of the regression test below is that DeniedScreen must not throw
// when useCommand's real implementation runs with no client in context, and
// mocking useCommand file-wide would make that assertion meaningless: a
// mocked hook never throws regardless of context, whether or not the bug it
// is meant to catch is still there.
function client(command = vi.fn().mockResolvedValue({ ok: true })): ScopedClient {
  return {
    extension: "auth",
    query: vi.fn(),
    command,
  }
}

describe("DeniedScreen", () => {
  it("renders the required-roles list when roles are given", () => {
    render(<DeniedScreen onSignedOut={vi.fn()} requiredRoles={["admin", "auditor"]} />)
    expect(screen.getByText(/admin/)).toBeDefined()
    expect(screen.getByText(/auditor/)).toBeDefined()
  })

  it("renders no sign-out button when signOutIntent is undefined", () => {
    render(<DeniedScreen onSignedOut={vi.fn()} requiredRoles={["admin"]} />)
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull()
  })

  it("renders a sign-out button when signOutIntent is given", () => {
    // SignOutButton's useCommand needs a real scoped client from context, so
    // this one is wrapped in a real PluginProvider rather than mocked, the
    // same pattern test/context-dimensions.test.tsx uses for a hook with the
    // same requirement.
    render(
      <PluginProvider client={client()}>
        <DeniedScreen
          onSignedOut={vi.fn()}
          requiredRoles={["admin"]}
          signOutIntent="auth.logout"
        />
      </PluginProvider>,
    )
    expect(screen.getByRole("button", { name: /sign out/i })).toBeDefined()
  })

  it("the regression test: renders without throwing with no PluginProvider and no signOutIntent", () => {
    // This is the case that was broken: DeniedScreen used to call useCommand
    // unconditionally, and useCommand's first line reads the scoped client
    // from context, which throws "usePluginClient was called outside a
    // PluginProvider" when there is none. A 403 from /principal with no auth
    // provider configured produced an uncaught exception instead of this
    // screen. No PluginProvider anywhere in this tree, and no mock standing
    // in for one either.
    render(<DeniedScreen onSignedOut={vi.fn()} />)
    expect(screen.getByRole("heading", { name: /you do not have access/i })).toBeDefined()
  })
})
