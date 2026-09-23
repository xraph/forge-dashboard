# Dashboard authentication gate implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unauthenticated visitor gets one sign-in screen and no shell, and the contract answers 401 instead of serving the data anyway.

**Architecture:** A session module in `packages/runtime` resolves who you are from `GET {contractBase}/principal`, seeded by a principal the Go shell handler injects into `window.__FORGE_DASHBOARD__`. `PluginHost` reads that session and returns a plugin-declared gate before it builds any routes or sidebar. On the server, the contract transport splits its existing predicate denial so a caller with no identity gets 401 rather than 403.

**Tech Stack:** TypeScript, React 19, react-router 8, vitest, Go 1.26, YAML contract manifests.

**Spec:** `docs/superpowers/specs/2026-09-08-dashboard-auth-gate-design.md` (read it first; this plan argues from it)

## Global Constraints

- Three repositories. `forge-dashboard` at `/Users/rexraphael/Work/xraph/forge-dashboard` (client, fixture), `forge` at `/Users/rexraphael/Work/xraph/forge` (Go contract and shell handler), `authsome` at `/Users/rexraphael/Work/xraph/authsome` (contract manifest). Never assume a task's repo; each task names it.
- `forge-dashboard` is a pnpm workspace. Run a single package's tests from inside that package with `npx vitest run`, and the whole workspace with `npx turbo test` from the root.
- Another session is working in `forge-dashboard` concurrently. Commit with an explicit pathspec, never `git add -A` or `git add .`, and check `git status --short` before every commit to confirm you are holding only your own changes.
- Zero em dashes in any prose you write, including code comments and commit messages.
- No `Co-Authored-By` trailers in commit messages, and no Claude or Anthropic attribution anywhere.
- `packages/kit` currently fails `lint` in `carousel.tsx` and `src/components/reui/data-grid/*`, which are vendored shadcn components nobody in this plan touches. Do not fix them and do not treat them as your regression. Lint only the packages you changed.
- The client never decides authorization. Every state the client renders is a report of what the server said, so no task adds a client-side permission check.

### Concurrent work in `packages/plugin`, as observed on 2026-09-08

The plugin platform plan (`docs/superpowers/plans/2026-09-08-plugin-platform.md`) is being implemented in this same checkout right now. `packages/plugin/src/store.ts` and `packages/plugin/test/store.test.ts` are already on disk and untracked. Before starting Task 3 or Task 4, run `git status --short packages/plugin` and read whatever is there.

Three files are contested, and the resolution differs for each:

- `packages/plugin/src/index.ts`: both plans append an `export * from` line. Append yours, keep theirs, no conflict worth thinking about.
- `packages/plugin/src/types.ts`: both plans add optional fields to `ForgePlugin`. This plan adds `auth?` immediately above `nav`. If `context?` or the sub-plugin fields are already there, add `auth?` next to them and leave them alone.
- `packages/plugin/src/client.ts`: this plan adds a parameter, the platform plan puts the query store on top of this client. If the store already calls `send` or wraps `createScopedClient`, the `onUnauthenticated` notification still belongs where Task 4 puts it, inside `send` after the retry is spent, because that is the only place that knows whether a retry was available. Make the store pass the callback through; do not reimplement the check in the store, where a cached answer can hide the rejection entirely.

## File structure

New files:

| Path | Repo | Responsibility |
|---|---|---|
| `packages/runtime/src/session.tsx` | forge-dashboard | Resolve and hold the session. Owns the six states, the injected seed, and `refresh()`. |
| `packages/runtime/test/session.test.tsx` | forge-dashboard | Tests for the above. |
| `packages/plugin/src/auth.ts` | forge-dashboard | `AuthGateProps`, `PluginAuth`, and the `resolveAuthProvider` singleton rule. |
| `packages/plugin/test/auth.test.ts` | forge-dashboard | Tests for the above. |

Modified files:

| Path | Repo | Change |
|---|---|---|
| `packages/fixture-server/server.mjs` | forge-dashboard | Serve `/principal`, switchable by env. |
| `packages/runtime/src/fallbacks.tsx` | forge-dashboard | Add `FallbackAuthGate`. |
| `packages/runtime/src/index.ts` | forge-dashboard | Export `./session`. |
| `packages/plugin/src/types.ts` | forge-dashboard | `ForgePlugin.auth?`. |
| `packages/plugin/src/index.ts` | forge-dashboard | Export `./auth`. |
| `packages/plugin/src/client.ts` | forge-dashboard | `onUnauthenticated` on `createScopedClient`. |
| `packages/host/src/host/PluginHost.tsx` | forge-dashboard | Render the gate, wire the session, real user in the footer. |
| `packages/host/src/ForgeDashboard.tsx` | forge-dashboard | Wrap in `SessionProvider`. |
| `packages/plugin-authsome/src/index.tsx` | forge-dashboard | Declare the gate, drop `Sign in` from nav and routes. |
| `packages/kit/src/components/nav-user.tsx` | forge-dashboard | Sign-out item in the footer dropdown. |
| `extensions/dashboard/contract/transport/http.go` | forge | 401 when identity is absent. |
| `extensions/dashboard/contract/transport/control.go` | forge | Same split for SSE. |
| `extensions/dashboard/shell_handlers.go` | forge | Inject the principal. |
| `extension/contract/manifest.yaml` | authsome | `requires:` on `users.*` and `sessions.*`. |

## Task order and dependencies

```
Task 1  fixture /principal        (no deps)
Task 2  session module            (no deps; Task 1 for manual checks)
Task 3  plugin auth contract      (no deps)
Task 4  client onUnauthenticated  (no deps)
Task 5  FallbackAuthGate          (Task 3 for AuthGateProps)
Task 6  gate in PluginHost        (Tasks 2, 3, 4, 5)
Task 7  authsome plugin + NavUser (Task 3)
Task 8  Go 401/403 split          (no deps)
Task 9  Go principal injection    (no deps)
Task 10 authsome manifest         (Task 8, to see 401 rather than 403)
```

Tasks 8, 9 and 10 are in other repositories and can run at any point. Do them last only because the client is the part with no server-side equivalent today.

---

### Task 1: `/principal` in the fixture server

**Repo:** forge-dashboard

**Files:**
- Modify: `packages/fixture-server/server.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `GET {BASE_PATH}/principal`, answering one of four shapes selected by `FIXTURE_PRINCIPAL`. Every later client task can be exercised by hand against it.

This package is a development fixture with no test suite, so this task verifies by curl instead of vitest. That is a deliberate exception, not an oversight: adding a vitest project to a 850-line dev server to test one route would be more machinery than the route.

- [ ] **Step 1: Add the principal handler**

Insert immediately above `const server = createServer(` in `packages/fixture-server/server.mjs`:

```js
/**
 * GET {BASE_PATH}/principal, mirroring extensions/dashboard/handlers/principal.go.
 *
 * FIXTURE_PRINCIPAL selects which of the Go handler's four answers to serve:
 *
 *   signedIn   (default)  200 {authenticated:true, subject, ...}
 *   anonymous             200 {authenticated:false}          auth switched off
 *   signedOut             401 {code:"UNAUTHENTICATED", loginPath}
 *   denied                403 {code:"PERMISSION_DENIED", requiredRoles}
 *
 * The client's other two states need no switch. `unknown` happens on any cold
 * load before this answers, and `unreachable` you get by stopping the fixture.
 */
function handlePrincipalGet(req, res) {
  if (req.method !== "GET") {
    return sendError(res, 405, CODE.BAD_REQUEST, "GET required")
  }
  const mode = process.env.FIXTURE_PRINCIPAL ?? "signedIn"
  switch (mode) {
    case "anonymous":
      return sendJSON(res, 200, { authenticated: false })
    case "signedOut":
      return sendJSON(res, 401, {
        code: "UNAUTHENTICATED",
        loginPath: "/dashboard/login",
      })
    case "denied":
      return sendJSON(res, 403, {
        code: "PERMISSION_DENIED",
        message: "Your account doesn't have a role required to access this dashboard.",
        requiredRoles: ["admin"],
      })
    case "signedIn":
      return sendJSON(res, 200, {
        authenticated: true,
        subject: "usr_fixture_ada",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
        roles: ["admin"],
        scopes: ["users:read", "users:write", "sessions:read"],
      })
    default:
      return sendError(
        res,
        500,
        CODE.INTERNAL,
        `FIXTURE_PRINCIPAL=${mode} is not one of signedIn, anonymous, signedOut, denied`,
      )
  }
}
```

- [ ] **Step 2: Route it**

In the `createServer` callback in the same file, immediately after the `${BASE_PATH}/csrf` branch, add:

```js
    if (url.pathname === `${BASE_PATH}/principal`) {
      return handlePrincipalGet(req, res)
    }
```

- [ ] **Step 3: Check `CODE.INTERNAL` exists**

Run: `grep -n "INTERNAL" packages/fixture-server/server.mjs`
Expected: a line inside the `CODE` object defining `INTERNAL`. If it is absent, add `INTERNAL: "INTERNAL",` to the `CODE` object rather than inventing a different code.

- [ ] **Step 4: Verify all four answers**

Run each from the repo root, one at a time:

```bash
FIXTURE_PORT=4310 FIXTURE_PRINCIPAL=signedIn node packages/fixture-server/server.mjs &
sleep 1 && curl -s -o /dev/stdout -w " [%{http_code}]\n" http://localhost:4310/dashboard/api/dashboard/v1/principal
```

Expected, in order for the four values of `FIXTURE_PRINCIPAL`:
- `signedIn`: body contains `"authenticated":true` and `"subject":"usr_fixture_ada"`, status `200`
- `anonymous`: body is `{"authenticated":false}`, status `200`
- `signedOut`: body contains `"code":"UNAUTHENTICATED"`, status `401`
- `denied`: body contains `"requiredRoles":["admin"]`, status `403`

Kill the server between runs with `pkill -f "fixture-server/server.mjs"`.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/fixture-server/server.mjs
git commit -m "feat(fixture): serve /principal with a switch for all four answers"
```

---

### Task 2: the session module

**Repo:** forge-dashboard

**Files:**
- Create: `packages/runtime/src/session.tsx`
- Create: `packages/runtime/test/session.test.tsx`
- Modify: `packages/runtime/src/index.ts`

**Interfaces:**
- Consumes: `useDashboardConfig()` from `./config`, which returns `DashboardConfig` with `contractBase: string` and `loginPath: string`.
- Produces, all from `./session`:
  - `injectedPrincipal(): Principal | null | undefined`. `undefined` means the key was absent, `null` means present and explicitly null.
  - `interface Principal { authenticated: boolean; subject?: string; displayName?: string; email?: string; roles?: string[]; scopes?: string[] }`
  - `type SessionState` with `status` in `"unknown" | "anonymous" | "signedOut" | "signedIn" | "denied" | "unreachable"`
  - `interface Session { state: SessionState; epoch: number; refresh: () => void }`
  - `SessionProvider({ children, fetchImpl }: { children: ReactNode; fetchImpl?: typeof fetch })`
  - `useSession(): Session`

`epoch` starts at 0 and increments once per resolved fetch. Task 6 puts it in the capabilities effect's dependency array, which is how a fresh login re-reads the contributor list. Nothing else needs it.

`DashboardConfig` deliberately does not gain a `principal` field. It is not configuration, `resolve()` would need a default for it, and a default is exactly the absent-versus-null distinction this task exists to preserve.

`injectedPrincipal` lives in `session.tsx`, not in `config.tsx`. Putting it in `config.tsx` would make that file import `Principal` from `./session` while `session.tsx` imports `useDashboardConfig` from `./config`, and a cycle between two modules to save one cast is a bad trade even when the cycle is types-only and erases at compile time.

- [ ] **Step 1: Write the failing tests**

Create `packages/runtime/test/session.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/runtime && npx vitest run test/session.test.tsx`
Expected: FAIL. The first error is a resolve failure on `../src/session`, because the module does not exist yet.

- [ ] **Step 3: Write the session module**

Create `packages/runtime/src/session.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import { useDashboardConfig } from "./config"

/** What `/principal` answers with when somebody is signed in. */
export interface Principal {
  authenticated: boolean
  subject?: string
  displayName?: string
  email?: string
  roles?: string[]
  scopes?: string[]
}

/**
 * The principal the Go shell handler inlines, if it inlined one.
 *
 * Three return values, not two, and the difference is load-bearing:
 *
 *   undefined  no `principal` key at all. Nobody told us. The session starts
 *              `unknown` and renders loading chrome.
 *   null       the key is present and explicitly null. The server rendered
 *              this page, looked, and found no session, so the session starts
 *              `signedOut` and the gate paints on the first frame.
 *   Principal  a session, used as the first frame's answer.
 *
 * The Go handler always writes the key. A Next.js host hand-writes its config
 * object and never does, which is why `undefined` is a real case rather than a
 * defensive branch.
 *
 * The cast is deliberate. `config.tsx` types that global as the config it
 * cares about and knows nothing about principals, and widening its declaration
 * would need the `Principal` type from this file, which is the import cycle
 * this arrangement avoids.
 */
export function injectedPrincipal(): Principal | null | undefined {
  if (typeof window === "undefined") return undefined
  const injected = (window as unknown as {
    __FORGE_DASHBOARD__?: { principal?: Principal | null }
  }).__FORGE_DASHBOARD__
  if (!injected || !("principal" in injected)) return undefined
  return injected.principal ?? null
}

/**
 * Six states, and only four of them come from an endpoint answer.
 *
 * `unknown` and `unreachable` exist because "we have not been told" and "we
 * asked and could not find out" are not the same as any answer the server
 * gives, and folding either into `anonymous` paints a sign-in screen at a
 * signed-in person while folding either into `signedIn` shows the dashboard
 * to a stranger.
 */
export type SessionState =
  | { status: "unknown" }
  | { status: "anonymous" }
  | { status: "signedOut"; loginPath: string }
  | { status: "signedIn"; principal: Principal }
  | { status: "denied"; requiredRoles: string[] }
  | { status: "unreachable"; message: string }

export interface Session {
  state: SessionState
  /**
   * Incremented once per resolved fetch, starting from 0.
   *
   * The host puts this in its capabilities effect's dependency array. A
   * freshly signed-in user may be shown contributors that were hidden from
   * them while anonymous, and without this the effect keys on
   * `[contractBase, doFetch]` alone and never re-runs.
   */
  epoch: number
  refresh: () => void
}

const SessionContext = createContext<Session | null>(null)

function seed(): SessionState {
  const injected = injectedPrincipal()
  if (injected === undefined) return { status: "unknown" }
  if (injected === null || !injected.authenticated) {
    // loginPath is filled in by the provider, which can read the config.
    return { status: "signedOut", loginPath: "" }
  }
  return { status: "signedIn", principal: injected }
}

export function SessionProvider({
  children,
  fetchImpl,
}: {
  children: ReactNode
  fetchImpl?: typeof fetch
}) {
  const { contractBase, loginPath } = useDashboardConfig()

  const [state, setState] = useState<SessionState>(() => {
    const s = seed()
    return s.status === "signedOut" ? { status: "signedOut", loginPath } : s
  })
  const [epoch, setEpoch] = useState(0)
  const [nonce, setNonce] = useState(0)

  // Bound on purpose. An unbound `fetch` called as a plain function throws
  // "Illegal invocation" in a browser, because it wants `window` as its
  // receiver. Same reasoning as PluginHost's doFetch.
  const doFetch = useMemo(() => fetchImpl ?? fetch.bind(globalThis), [fetchImpl])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      let next: SessionState
      try {
        const res = await doFetch(`${contractBase}/principal`, {
          credentials: "same-origin",
        })
        const body = (await res.json().catch(() => null)) as
          | (Principal & { code?: string; loginPath?: string; requiredRoles?: string[] })
          | null

        if (res.status === 401) {
          next = { status: "signedOut", loginPath: body?.loginPath ?? loginPath }
        } else if (res.status === 403) {
          next = { status: "denied", requiredRoles: body?.requiredRoles ?? [] }
        } else if (!res.ok || body === null) {
          next = {
            status: "unreachable",
            message: `principal request failed with HTTP ${res.status}`,
          }
        } else if (body.authenticated) {
          next = { status: "signedIn", principal: body }
        } else {
          next = { status: "anonymous" }
        }
      } catch (error) {
        next = {
          status: "unreachable",
          message: error instanceof Error ? error.message : String(error),
        }
      }

      if (cancelled) return
      // Unconditional, downgrades included. The injected principal only ever
      // seeded the first frame; it never outranks the endpoint.
      setState(next)
      setEpoch((e) => e + 1)
    })()

    return () => {
      cancelled = true
    }
  }, [contractBase, doFetch, loginPath, nonce])

  const value = useMemo<Session>(() => ({ state, epoch, refresh }), [state, epoch, refresh])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error(
      "useSession was called outside a SessionProvider. " +
        "Wrap the dashboard in <SessionProvider>, which ForgeDashboard does for you.",
    )
  }
  return session
}
```

- [ ] **Step 4: Export the module**

Replace the contents of `packages/runtime/src/index.ts` with:

```ts
export * from "./config"
export * from "./fallbacks"
export * from "./session"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/runtime && npx vitest run`
Expected: PASS, including the pre-existing `config.test.tsx` and `fallbacks.test.tsx`.

- [ ] **Step 6: Run the discriminator check**

The `unknown` state is the one most likely to be implemented wrong, so prove the test catches it. In `session.tsx`, temporarily change `if (injected === undefined) return { status: "unknown" }` to `if (injected === undefined) return { status: "anonymous" }`.

Run: `cd packages/runtime && npx vitest run test/session.test.tsx`
Expected: FAIL on "starts unknown when nothing was injected". Restore the line and re-run to confirm PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `cd packages/runtime && npx tsc --noEmit && npx eslint .`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/runtime/src/session.tsx packages/runtime/test/session.test.tsx packages/runtime/src/index.ts
git commit -m "feat(runtime): resolve the session from /principal with an injected fast path"
```

---

### Task 3: the plugin auth contract

**Repo:** forge-dashboard

**Files:**
- Create: `packages/plugin/src/auth.ts`
- Create: `packages/plugin/test/auth.test.ts`
- Modify: `packages/plugin/src/types.ts`
- Modify: `packages/plugin/src/index.ts`

**Interfaces:**
- Consumes: `ForgePlugin` from `./types`.
- Produces:
  - `interface AuthGateProps { loginPath: string; requiredRoles?: string[]; onAuthenticated: () => void }`
  - `interface PluginAuth { gate: ComponentType<AuthGateProps>; signOutIntent?: string }`
  - `ForgePlugin.auth?: PluginAuth`
  - `resolveAuthProvider(plugins: ForgePlugin[]): ForgePlugin | undefined`, which throws when two plugins declare a gate.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin/test/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { definePlugin } from "../src/define"
import { resolveAuthProvider } from "../src/auth"

const Gate = () => null

function plugin(extension: string, withGate: boolean) {
  return definePlugin({
    extension,
    namespace: extension,
    nav: [],
    routes: [],
    ...(withGate ? { auth: { gate: Gate } } : {}),
  })
}

describe("resolveAuthProvider", () => {
  it("returns undefined when no plugin declares a gate", () => {
    expect(resolveAuthProvider([plugin("core", false), plugin("streaming", false)])).toBeUndefined()
  })

  it("returns the one plugin that declares a gate", () => {
    const found = resolveAuthProvider([plugin("core", false), plugin("auth", true)])
    expect(found?.extension).toBe("auth")
  })

  it("throws when two plugins declare a gate", () => {
    // Silently picking the first would make which gate you get depend on the
    // order the host was handed its plugins, and the person seeing the wrong
    // sign-in screen would have nothing to go on. This is a wiring bug in the
    // host application, so it fails loudly at resolve time.
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /auth.*other|other.*auth/,
    )
  })

  it("names both offenders in the error", () => {
    expect(() => resolveAuthProvider([plugin("auth", true), plugin("other", true)])).toThrow(
      /declare an auth gate/,
    )
  })

  it("accepts an empty plugin list", () => {
    expect(resolveAuthProvider([])).toBeUndefined()
  })

  it("carries the provider's signOutIntent through", () => {
    const withSignOut = definePlugin({
      extension: "auth",
      namespace: "auth",
      nav: [],
      routes: [],
      auth: { gate: Gate, signOutIntent: "auth.logout" },
    })
    expect(resolveAuthProvider([withSignOut])?.auth?.signOutIntent).toBe("auth.logout")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/plugin && npx vitest run test/auth.test.ts`
Expected: FAIL. The first error is a resolve failure on `../src/auth`.

- [ ] **Step 3: Write the auth module**

Create `packages/plugin/src/auth.ts`:

```ts
import type { ComponentType } from "react"

import type { ForgePlugin } from "./types"

/**
 * What the host hands a gate.
 *
 * `requiredRoles` is how the gate tells the two blocked states apart. Absent
 * or empty means nobody is signed in, so render sign-in. Non-empty means
 * somebody is signed in as the wrong person and these are the roles this
 * dashboard wanted, so render an access-denied panel with a way to sign out.
 * One component covers both because a provider that owns sign-in also owns
 * "wrong account, try another", and they share all their styling.
 */
export interface AuthGateProps {
  loginPath: string
  requiredRoles?: string[]
  /** Call after a successful sign-in. The host re-reads /principal. */
  onAuthenticated: () => void
}

export interface PluginAuth {
  gate: ComponentType<AuthGateProps>
  /**
   * The command this provider signs out with, named rather than called.
   *
   * The host forwards this to the sidebar footer's sign-out item and sends it
   * through this plugin's own scoped client, then re-reads the session. Naming
   * it here is what keeps two layers ignorant: the kit renders a menu item and
   * never learns an intent exists, and the host sends a string it was handed
   * and never learns that "auth.logout" is the one that clears a cookie.
   *
   * Omit it and the footer renders no sign-out item at all. A dead one that
   * looks clickable and does nothing is worse than none.
   */
  signOutIntent?: string
}

/**
 * Finds the one plugin that provides the auth gate.
 *
 * At most one may, the same way at most one may set `root`. Enforced here
 * rather than in the host's render so there is a single tested place for the
 * rule, and so the failure is a thrown wiring error at resolve time instead
 * of a silent pick that depends on array order.
 */
export function resolveAuthProvider(plugins: ForgePlugin[]): ForgePlugin | undefined {
  const declaring = plugins.filter((plugin) => plugin.auth !== undefined)
  if (declaring.length > 1) {
    const names = declaring.map((plugin) => plugin.extension).join(", ")
    throw new Error(
      `more than one plugin declare an auth gate (${names}); at most one may`,
    )
  }
  return declaring[0]
}
```

- [ ] **Step 4: Add `auth?` to the plugin type**

In `packages/plugin/src/types.ts`, add this import at the top:

```ts
import type { PluginAuth } from "./auth"
```

Then inside `interface ForgePlugin`, immediately above the existing `nav: PluginNavItem[]` line, add:

```ts
  /**
   * Marks this plugin as the dashboard's authentication provider and supplies
   * the screen shown when nobody is signed in.
   *
   * At most one plugin may set this. When it is set and the session resolves
   * to signed out, the host renders this component instead of the shell: no
   * sidebar, no scope switcher, no plugin routes mounted at all.
   */
  auth?: PluginAuth
```

- [ ] **Step 5: Export the module**

In `packages/plugin/src/index.ts`, add a line after `export * from "./types"`:

```ts
export * from "./auth"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/plugin && npx vitest run`
Expected: PASS, including the pre-existing suites in that package.

- [ ] **Step 7: Typecheck and lint**

Run: `cd packages/plugin && npx tsc --noEmit && npx eslint .`
Expected: both exit 0. If `tsc` reports a circular import between `types.ts` and `auth.ts`, note that both directions are `import type` and erase at compile time, so this is not a runtime cycle; leave it.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/plugin/src/auth.ts packages/plugin/test/auth.test.ts packages/plugin/src/types.ts packages/plugin/src/index.ts
git commit -m "feat(plugin): let one plugin declare the auth gate"
```

---

### Task 4: `onUnauthenticated` on the scoped client

**Repo:** forge-dashboard

**Files:**
- Modify: `packages/plugin/src/client.ts`
- Test: `packages/plugin/test/client.test.ts` (append; the file exists)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a fourth parameter on `createScopedClient(contractBase, extension, fetchImpl?, onUnauthenticated?)`. Task 6 passes `session.refresh`.

Read the spec's "The stale token trap" section before writing anything here. The short version: `isStaleTokenRejection` already treats a 401, or a 403 carrying `UNAUTHENTICATED`, as "retry this command with a fresh CSRF token", and the Go transport rejects a stale CSRF token with exactly that pair. So the callback must fire only after the retry is spent, or an aging token signs people out mid-write.

- [ ] **Step 1: Write the failing tests**

Append to `packages/plugin/test/client.test.ts`:

```ts
describe("onUnauthenticated", () => {
  function rejecting(status: number, code: string): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "t", expiresAt: "2999-01-01T00:00:00Z" }),
        } as Response
      }
      return {
        ok: false,
        status,
        json: async () => ({ error: { code, message: "no" } }),
      } as Response
    }) as unknown as typeof fetch
  }

  it("fires immediately when a query is rejected for identity", async () => {
    const notified = vi.fn()
    const client = createScopedClient("/c", "auth", rejecting(401, "UNAUTHENTICATED"), notified)
    await expect(client.query("users.list")).rejects.toThrow()
    // A query carries no CSRF token, so there is nothing stale to blame and
    // no retry to wait for.
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it("fires on a command only after the retry is spent", async () => {
    const notified = vi.fn()
    const client = createScopedClient("/c", "auth", rejecting(403, "UNAUTHENTICATED"), notified)
    await expect(client.command("users.ban", { id: "u1" })).rejects.toThrow()
    // Both attempts were rejected, so this is a real identity failure and not
    // a token that needed replacing.
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it("does not fire when a stale token succeeds on retry", async () => {
    const notified = vi.fn()
    let commandAttempts = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/csrf")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "fresh", expiresAt: "2999-01-01T00:00:00Z" }),
        } as Response
      }
      commandAttempts += 1
      if (commandAttempts === 1) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { code: "UNAUTHENTICATED", message: "stale csrf" } }),
        } as Response
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, data: { ok: true } }) } as Response
    }) as unknown as typeof fetch

    const client = createScopedClient("/c", "auth", fetchImpl, notified)
    await expect(client.command("users.ban", { id: "u1" })).resolves.toEqual({ ok: true })
    // This is the whole point of the retry-exhaustion rule. Firing here would
    // sign the user out every time a cached CSRF token aged past its window,
    // in the middle of whatever they were saving.
    expect(notified).not.toHaveBeenCalled()
    expect(commandAttempts).toBe(2)
  })

  it("does not fire for a rejection that is not about identity", async () => {
    const notified = vi.fn()
    const client = createScopedClient("/c", "auth", rejecting(404, "NOT_FOUND"), notified)
    await expect(client.query("users.list")).rejects.toThrow()
    expect(notified).not.toHaveBeenCalled()
  })

  it("works with no callback supplied", async () => {
    const client = createScopedClient("/c", "auth", rejecting(401, "UNAUTHENTICATED"))
    await expect(client.query("users.list")).rejects.toThrow()
  })
})
```

Check the top of `packages/plugin/test/client.test.ts` and make sure `describe`, `it`, `expect`, `vi` and `createScopedClient` are already imported. If any are missing, add them to the existing import statements rather than writing new ones.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/plugin && npx vitest run test/client.test.ts`
Expected: FAIL on the first three new tests, because `createScopedClient` ignores a fourth argument and `notified` is never called.

- [ ] **Step 3: Add the parameter**

In `packages/plugin/src/client.ts`, change the `createScopedClient` signature. The existing third parameter and its comment stay exactly as they are; add a fourth:

```ts
export function createScopedClient(
  contractBase: string,
  extension: string,
  // Called as a method of globalThis, never passed bare. A browser's `fetch`
  // wants the global as its receiver, and `fetchImpl = fetch` hands it none:
  // that is the "Illegal invocation" shape. The host always passes a bound
  // fetch so nothing in this repo hits it, but this package is published and
  // callers who omit the argument will exist. Resolving through globalThis at
  // call time also means a fetch installed after the client was built (a
  // polyfill, a test stub) is the one that runs.
  fetchImpl: FetchLike = (...args) => globalThis.fetch(...args),
  /**
   * Called when a request is refused for want of identity and no retry is
   * left to try. The host wires this to the session's refresh, which re-reads
   * /principal and puts the gate up.
   *
   * The timing is the contract. A stale CSRF token and an expired session are
   * the same status and code on the wire (see isStaleTokenRejection), so this
   * fires only once the retry has been spent: a stale token succeeds on the
   * second attempt, an expired session fails again. A query has no retry and
   * no CSRF token, so it notifies on the first rejection.
   */
  onUnauthenticated?: () => void,
): ScopedClient {
```

- [ ] **Step 4: Notify at the one place the retry is already decided**

Still in `client.ts`, inside `send`, the `if (!res.ok)` block currently reads:

```ts
      if (input.kind === "command" && mayRetry && isStaleTokenRejection(res.status, body)) {
        await refreshCSRF()
        return send<T>(input, false)
      }
```

Replace it with:

```ts
      if (input.kind === "command" && mayRetry && isStaleTokenRejection(res.status, body)) {
        // A cached token outlives its TTL silently otherwise: nothing tells
        // the client the token went stale until a command is rejected for it.
        await refreshCSRF()
        // `mayRetry: false` is the cap, and it is a parameter rather than a
        // counter so there is exactly one place it can be got wrong. The
        // *same* input goes back in, which is what keeps the idempotency key
        // identical across both attempts: the server sees one command that
        // took two tries, not two commands.
        return send<T>(input, false)
      }

      // Everything that reaches here was refused and has no retry left. If it
      // was refused for identity, the session is the thing that is wrong, not
      // the token: a command arrives here only on its second attempt, and a
      // query has no first-attempt exception to make.
      if (isStaleTokenRejection(res.status, body)) {
        onUnauthenticated?.()
      }
```

Note the comment block in the first half is the existing one, kept verbatim. Do not delete it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/plugin && npx vitest run`
Expected: PASS, including every pre-existing test in the package. The retry tests in `client.test.ts` are the ones most likely to break; if they do, the notification was placed before the retry rather than after it.

- [ ] **Step 6: Run the discriminator check**

Move the `onUnauthenticated?.()` call to the line immediately above the `if (input.kind === "command" && mayRetry ...)` retry block.

Run: `cd packages/plugin && npx vitest run test/client.test.ts`
Expected: FAIL on "does not fire when a stale token succeeds on retry". Move it back and re-run to confirm PASS.

- [ ] **Step 7: Typecheck and lint**

Run: `cd packages/plugin && npx tsc --noEmit && npx eslint .`
Expected: both exit 0.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/plugin/src/client.ts packages/plugin/test/client.test.ts
git commit -m "feat(plugin): report identity rejections once the csrf retry is spent"
```

---

### Task 5: the fallback gate

**Repo:** forge-dashboard

**Files:**
- Modify: `packages/runtime/src/fallbacks.tsx`
- Test: `packages/runtime/test/fallbacks.test.tsx` (append; the file exists)

**Interfaces:**
- Consumes: nothing. Deliberately.
- Produces: `FallbackAuthGate`, whose props are `{ loginPath: string; requiredRoles?: string[]; onAuthenticated: () => void }`, and a `fallback?: ReactNode` prop on `PluginErrorBoundary`.

Do not import `AuthGateProps` here. `packages/runtime` has zero package dependencies today (its `peerDependencies` are React alone), and importing from `@forge-go/dashboard-plugin` would add one and point it the wrong way: plugin is the author-facing contract and runtime sits underneath it. The props are declared inline instead, and structural typing means the component still satisfies `AuthGateProps` at the place the host substitutes it, with nothing to keep in sync beyond three field names that the host's own typecheck pins.

This renders when no plugin declares a gate, and it is also the error-boundary fallback when a plugin's gate throws. It is styled with plain utility classes and imports nothing from the kit, matching the existing `PluginErrorBoundary` and `SetupPanel` in this file.

- [ ] **Step 1: Write the failing tests**

Append to `packages/runtime/test/fallbacks.test.tsx`:

```tsx
describe("FallbackAuthGate", () => {
  it("links to the login path when nobody is signed in", () => {
    render(<FallbackAuthGate loginPath="/dashboard/login" onAuthenticated={() => {}} />)
    const link = screen.getByRole("link", { name: /sign in/i })
    expect(link.getAttribute("href")).toBe("/dashboard/login")
  })

  it("renders the denied variant when requiredRoles is present", () => {
    render(
      <FallbackAuthGate
        loginPath="/dashboard/login"
        requiredRoles={["admin", "auditor"]}
        onAuthenticated={() => {}}
      />,
    )
    expect(screen.getByText(/admin/)).toBeTruthy()
    expect(screen.getByText(/auditor/)).toBeTruthy()
  })

  it("offers a way out of the denied state", () => {
    // Without this a user signed in as the wrong person has no shell, no
    // sign-in form, and no way to reach a different account.
    render(
      <FallbackAuthGate
        loginPath="/dashboard/login"
        requiredRoles={["admin"]}
        onAuthenticated={() => {}}
      />,
    )
    expect(screen.getByRole("link", { name: /sign in as someone else/i })).toBeTruthy()
  })

  it("treats an empty requiredRoles as signed out, not denied", () => {
    // The host passes requiredRoles straight through from a 403 body that may
    // carry an empty array. Reading empty as "denied" would show an
    // access-denied panel listing no roles, which explains nothing.
    render(<FallbackAuthGate loginPath="/dashboard/login" requiredRoles={[]} onAuthenticated={() => {}} />)
    expect(screen.getByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })
})
```

Add `FallbackAuthGate` to the existing import from `../src/fallbacks` at the top of that test file. Confirm `render` and `screen` are already imported from `@testing-library/react`; add them to the existing import if not.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/runtime && npx vitest run test/fallbacks.test.tsx`
Expected: FAIL with `FallbackAuthGate is not defined` or an import error naming it.

- [ ] **Step 3: Write the component**

Append to `packages/runtime/src/fallbacks.tsx`:

```tsx
/**
 * The sign-in screen used when no plugin declares one.
 *
 * Also the error-boundary fallback for a plugin gate that throws, which is
 * why it cannot import from the kit or from any plugin: it has to be the
 * thing that still renders when the styled one did not.
 *
 * It links rather than posting a form. A gate with no provider behind it has
 * no login intent to call, so the only honest thing it can do is send you to
 * the path the server named.
 */
export function FallbackAuthGate({
  loginPath,
  requiredRoles,
}: {
  loginPath: string
  requiredRoles?: string[]
  onAuthenticated: () => void
}) {
  const denied = (requiredRoles?.length ?? 0) > 0

  return (
    <div
      role="status"
      className="mx-auto flex max-w-sm flex-col gap-3 rounded-md border p-6 text-sm"
    >
      {denied ? (
        <>
          <p className="font-medium">You do not have access to this dashboard.</p>
          <p className="text-muted-foreground">
            It needs one of these roles: {requiredRoles?.join(", ")}.
          </p>
          <a className="underline" href={loginPath}>
            Sign in as someone else
          </a>
        </>
      ) : (
        <>
          <p className="font-medium">Sign in to continue.</p>
          <a className="underline" href={loginPath}>
            Sign in
          </a>
        </>
      )}
    </div>
  )
}
```

`onAuthenticated` is accepted and unused here, so the component satisfies `AuthGateProps` and can be swapped for a real gate. A link navigates away and the page reloads, so there is no in-page success for it to report.

- [ ] **Step 4: Give `PluginErrorBoundary` a `fallback` prop**

Task 6 renders the gate inside this boundary and needs the fallback to be a working sign-in screen, not a notice that something failed: the gate is the only screen with a way back in. Change the props interface in the same file:

```tsx
interface PluginBoundaryProps {
  plugin: string
  children: ReactNode
  /**
   * Rendered instead of the default message when the child throws. The auth
   * gate supplies FallbackAuthGate here, because a plugin gate that throws
   * must not be able to lock somebody out of their own dashboard.
   */
  fallback?: ReactNode
}
```

In the class's `render`, the failed branch returns `this.props.fallback ?? <the existing default>`. Read the existing default out of the file and keep it byte-for-byte for the no-fallback case; every current caller passes no fallback and must be unaffected.

Add the test to `packages/runtime/test/fallbacks.test.tsx`:

```tsx
it("renders a supplied fallback instead of the default message", () => {
  const Boom = () => {
    throw new Error("nope")
  }
  render(
    <PluginErrorBoundary plugin="auth" fallback={<p>custom fallback</p>}>
      <Boom />
    </PluginErrorBoundary>,
  )
  expect(screen.getByText("custom fallback")).toBeTruthy()
})

it("still renders the default message when no fallback is supplied", () => {
  const Boom = () => {
    throw new Error("nope")
  }
  render(
    <PluginErrorBoundary plugin="auth">
      <Boom />
    </PluginErrorBoundary>,
  )
  expect(screen.queryByText("custom fallback")).toBeNull()
})
```

The second test is the regression guard on every existing caller. React logs the thrown error to the console in both; that is expected and the existing suite already tolerates it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/runtime && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `cd packages/runtime && npx tsc --noEmit && npx eslint .`
Expected: both exit 0. If `eslint` flags `onAuthenticated` as an unused variable, destructure it out of the props type only, leaving the type intact, or add it to the destructure and reference it in a `void onAuthenticated` statement. Do not remove it from the props type.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/runtime/src/fallbacks.tsx packages/runtime/test/fallbacks.test.tsx
git commit -m "feat(runtime): add the fallback sign-in screen and a boundary fallback slot"
```

---

### Task 6: the gate in the host

**Repo:** forge-dashboard

**Files:**
- Modify: `packages/host/src/host/PluginHost.tsx`
- Modify: `packages/host/src/ForgeDashboard.tsx`
- Test: `packages/host/test/host.test.tsx` (append)
- Test: `packages/host/test/host-playground.test.tsx` (mirror the gate tests)

**Interfaces:**
- Consumes: `useSession`, `SessionProvider`, `FallbackAuthGate` from `@forge-go/dashboard-runtime`; `resolveAuthProvider` and `AuthGateProps` from `@forge-go/dashboard-plugin`; `createScopedClient`'s `onUnauthenticated` parameter from Task 4, which is the FIFTH parameter, not the fourth: concurrent work added `onMeta` in fourth position and the host already uses it.
- Produces: nothing later tasks consume.

`packages/host/test/host.test.tsx` and `packages/host/test/host-playground.test.tsx` are near-duplicate suites over the same host. Every gate test added to the first must be added to the second, or the second silently stops covering the host it is named for.

Three further wiring points the file list above understates. Both suites contain standalone `render()` calls that bypass their own `renderHost` helper, and each of those needs wrapping in a `SessionProvider` too. Both contain at least one bespoke fetch stub separate from `capabilitiesFetch`, and each needs the `/principal` branch. And `packages/host/test/forge-dashboard.test.tsx`, which this plan does not otherwise touch, renders `ForgeDashboard` directly and therefore also needs a `/principal` answer once the provider is inside it. Expect to modify that third file.

- [ ] **Step 1: Write the failing tests**

Append to `packages/host/test/host.test.tsx`. Add `usePluginClient` to the existing `@forge-go/dashboard-plugin` import in that file first, since one of these tests reads the client the gate was given.

```tsx
describe("PluginHost auth gate", () => {
  function principalFetch(
    status: number,
    body: unknown,
    contributors: ContributorCapability[] = [
      { name: "core-contract", envelopes: ["v1"], configured: true },
    ],
  ): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
      }
      if (url.endsWith("/capabilities")) {
        return jsonOk({ shellEnvelopes: ["v1"], contributors })
      }
      throw new Error(`unexpected request to ${url}`)
    }) as unknown as typeof fetch
  }

  const GatePlugin = () =>
    definePlugin({
      extension: "auth",
      namespace: "auth",
      label: "Auth",
      auth: { gate: () => <p>gate body</p> },
      nav: [{ label: "Users", to: "/users" }],
      routes: [{ path: "/users", element: () => <p>auth users body</p> }],
    })

  it("renders the plugin's gate and no shell when signed out", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByText("gate body")).toBeTruthy()
    // "Blocks the UI entirely" means the shell is never constructed. A route
    // painting over a mounted sidebar is a curtain: the scope names are still
    // in the DOM.
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-content"]')).toBeNull()
    expect(screen.queryByText("root overview body")).toBeNull()
  })

  it("renders the shell when signed in", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(200, { authenticated: true, subject: "u1", email: "ada@example.com" }),
      "/overview",
    )

    expect(await screen.findByText("root overview body")).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeTruthy()
    expect(screen.queryByText("gate body")).toBeNull()
  })

  it("renders the shell when auth is switched off", async () => {
    const { container } = renderHost(
      [rootPlugin(), GatePlugin()],
      principalFetch(200, { authenticated: false }),
      "/overview",
    )

    // authenticated:false with a 200 means auth is off, not that you are
    // logged out. Gating on the boolean instead of the status locks every
    // anonymous dashboard out of itself.
    expect(await screen.findByText("root overview body")).toBeTruthy()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeTruthy()
  })

  it("renders the gate's denied variant with requiredRoles", async () => {
    const Denied = ({ requiredRoles }: { requiredRoles?: string[] }) => (
      <p>needs {requiredRoles?.join(",")}</p>
    )
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: Denied },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(403, { code: "PERMISSION_DENIED", requiredRoles: ["admin"] }),
      "/overview",
    )

    expect(await screen.findByText("needs admin")).toBeTruthy()
  })

  it("renders neither gate nor shell while the session is unknown", async () => {
    const pending = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const { container } = renderHost([rootPlugin(), GatePlugin()], pending, "/overview")

    expect(container.querySelector('[data-slot="spinner"]')).toBeTruthy()
    expect(screen.queryByText("gate body")).toBeNull()
    expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull()
  })

  it("falls back to the runtime gate when no plugin declares one", async () => {
    renderHost(
      [rootPlugin()],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })

  it("falls back when a plugin's gate throws", async () => {
    const Boom = () => {
      throw new Error("gate blew up")
    }
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: Boom },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    // A throwing gate must not be able to lock you out of your own dashboard.
    expect(await screen.findByRole("link", { name: /^sign in$/i })).toBeTruthy()
  })

  it("gives the gate its plugin's scoped client", async () => {
    // The gate renders outside the route table, so it does not inherit the
    // PluginProvider each route gets. A gate that calls useCommand without
    // one throws, and the only screen with a way in becomes the fallback.
    const ClientProbe = () => {
      const client = usePluginClient()
      return <p>client for {client.extension}</p>
    }
    const plugin = definePlugin({
      extension: "auth",
      namespace: "auth",
      auth: { gate: ClientProbe },
      nav: [],
      routes: [],
    })

    renderHost(
      [rootPlugin(), plugin],
      principalFetch(401, { code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
      "/overview",
    )

    expect(await screen.findByText("client for auth")).toBeTruthy()
  })

  it("shows the gate, not a capabilities error, when signed out", async () => {
    // The spec requires a capabilities failure to be discarded rather than
    // rendered while signed out. This holds because the gate returns before
    // the capabilities error branch, so it is a property of statement order
    // and would break silently if the gate block were moved below it.
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ code: "UNAUTHENTICATED", loginPath: "/dashboard/login" }),
        } as Response
      }
      throw new Error("capabilities is unreachable")
    }) as unknown as typeof fetch

    renderHost([rootPlugin(), GatePlugin()], fetchImpl, "/overview")

    expect(await screen.findByText("gate body")).toBeTruthy()
    expect(screen.queryByText(/Could not reach the dashboard server/)).toBeNull()
  })

  it("shows the signed-in user in the sidebar footer", async () => {
    renderHost(
      [rootPlugin()],
      principalFetch(200, {
        authenticated: true,
        subject: "u1",
        displayName: "Ada Lovelace",
        email: "ada@example.com",
      }),
      "/overview",
    )

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy()
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.queryByText("user@example.com")).toBeNull()
  })

  it("re-fetches capabilities when the session resolves again", async () => {
    let principalCalls = 0
    let capabilityCalls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/principal")) {
        principalCalls += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: true, subject: "u1", email: "a@b.c" }),
        } as Response
      }
      if (url.endsWith("/capabilities")) {
        capabilityCalls += 1
        return jsonOk({
          shellEnvelopes: ["v1"],
          contributors: [{ name: "core-contract", envelopes: ["v1"], configured: true }],
        })
      }
      throw new Error(`unexpected request to ${url}`)
    }) as unknown as typeof fetch

    renderHost([rootPlugin()], fetchImpl, "/overview")
    await screen.findByText("root overview body")

    // One of each on the first pass. A freshly signed-in user may be shown
    // contributors that were hidden while anonymous, so capabilities has to
    // key on the session epoch and not on [contractBase, doFetch] alone.
    expect(principalCalls).toBe(1)
    expect(capabilityCalls).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/host && npx vitest run test/host.test.tsx`
Expected: FAIL. The first failure is on "renders the plugin's gate and no shell when signed out", because nothing renders a gate and `useSession` is not called. You may also see a thrown error naming `SessionProvider`, since `renderHost` does not wrap in one yet; Step 3 fixes that.

- [ ] **Step 3: Wrap `renderHost` in a `SessionProvider`**

In `packages/host/test/host.test.tsx`, change `renderHost` to pass the same fetch to the session provider:

```tsx
function renderHost(
  plugins: ForgePlugin[],
  fetchImpl: typeof fetch,
  route = "/@core/overview"
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ForgeDashboardProvider config={config}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
        </SessionProvider>
      </ForgeDashboardProvider>
    </MemoryRouter>
  )
}
```

Add `SessionProvider` to the existing `@forge-go/dashboard-runtime` import in that file. Every pre-existing test in the suite uses `capabilitiesFetch`, which throws on any URL it does not recognise, so add a `/principal` branch to it that answers signed-in:

```tsx
function capabilitiesFetch(
  contributors: ContributorCapability[]
): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith("/capabilities")) {
      const caps: Capabilities = { shellEnvelopes: ["v1"], contributors }
      return jsonOk(caps)
    }
    // Every pre-existing test in this suite is about resolution and routing,
    // not about auth, so they run as a signed-in user. Without this branch
    // the session resolves `unreachable` and the host renders an alert
    // instead of the thing each of those tests is asserting on.
    if (url.endsWith("/principal")) {
      return jsonOk({ authenticated: true, subject: "usr_test", email: "test@example.com" })
    }
    throw new Error(`unexpected request to ${url}`)
  }) as unknown as typeof fetch
}
```

- [ ] **Step 4: Render the gate in the host**

In `packages/host/src/host/PluginHost.tsx`, add to the imports:

```tsx
import {
  FallbackAuthGate,
  PluginErrorBoundary,
  useDashboardConfig,
  useSession,
} from "@forge-go/dashboard-runtime"
import { resolveAuthProvider } from "@forge-go/dashboard-plugin"
```

Keep the existing `@forge-go/dashboard-plugin` import list and add `resolveAuthProvider` to it rather than writing a second import statement. Same for the runtime import, which already brings in `PluginErrorBoundary` and `useDashboardConfig`. `PluginProvider` and `createScopedClient` are already imported in this file; the gate block below reuses both.

Immediately after the existing `const { contractBase } = useDashboardConfig()` line, add:

```tsx
  const { loginPath } = useDashboardConfig()
  const session = useSession()
```

Change the capabilities effect two ways, not one. Add `session.state.status === "unknown"` as an early return inside the effect so it does not fire before the session resolves, and change its dependency array from `[contractBase, doFetch]` to `[contractBase, doFetch, session.epoch, session.state.status]`.

The epoch alone is not enough. Without the guard the effect fires once against the `unknown` state and again when the session resolves, so the first-pass capabilities call count is 2 rather than 1, and the "re-fetches capabilities when the session resolves again" test cannot tell a fresh-login refetch from that duplicate.

Wire the session into the `clients` memo. **Do not rewrite the memo, and do not copy a call signature out of this plan.** `createScopedClient` gained a fourth parameter, `onMeta`, from concurrent work on the query store, and the host already passes a substantial meta listener there. Its real signature is now:

```
createScopedClient(contractBase, extension, fetchImpl?, onMeta?, onUnauthenticated?)
```

So make exactly two surgical edits to the existing memo:

1. Add `session.refresh` as the **fifth** argument to the existing `createScopedClient(...)` call, after the `onMeta` callback that is already there. Leave that callback's body untouched: it joins the client to the query store, reading `meta.invalidates` and `meta.cacheControl`, and losing it would silently break cache invalidation across the dashboard.
2. Add `session.refresh` to the memo's dependency array, keeping every entry already in it.

Read the memo immediately before editing and count the arguments in the live call. If the signature has moved again, put `onUnauthenticated` in the position the current signature gives it and say so in your report. Passing it positionally into the wrong slot is the failure mode here: handing `session.refresh` to `onMeta` would replace the store's listener with a function that ignores its argument, and nothing would fail loudly.

Then insert this block immediately before the existing `if (state.status === "loading")` early return:

```tsx
  // The gate goes here, before anything builds a route table or a sidebar.
  // Rendering it as a route would leave the shell mounted underneath it,
  // naming every scope the visitor is not allowed to see.
  if (session.state.status === "signedOut" || session.state.status === "denied") {
    const provider = resolveAuthProvider(plugins)
    const Gate = provider?.auth?.gate ?? FallbackAuthGate
    const gateLoginPath =
      session.state.status === "signedOut" ? session.state.loginPath : loginPath
    const requiredRoles =
      session.state.status === "denied" ? session.state.requiredRoles : undefined

    return (
      // A gate is third-party code like any other plugin component, and a
      // throw here would blank the only screen with a way in. The fallback
      // gate is the one thing that cannot be taken down by a plugin.
      <PluginErrorBoundary
        key={provider?.extension ?? "fallback-gate"}
        plugin={provider?.extension ?? "auth"}
        fallback={
          <FallbackAuthGate
            loginPath={gateLoginPath}
            requiredRoles={requiredRoles}
            onAuthenticated={session.refresh}
          />
        }
      >
        {/*
          The gate needs its plugin's scoped client, and it cannot inherit one:
          it renders outside the route table, and PluginProvider is normally
          applied per route. Without this the authsome gate throws the moment
          it calls useCommand("auth.login"), because usePlugin finds no
          client. The fallback gate needs none, since it only ever links.
        */}
        {provider ? (
          <PluginProvider client={clients.get(provider.extension)!}>
            <Gate
              loginPath={gateLoginPath}
              requiredRoles={requiredRoles}
              onAuthenticated={session.refresh}
            />
          </PluginProvider>
        ) : (
          <Gate
            loginPath={gateLoginPath}
            requiredRoles={requiredRoles}
            onAuthenticated={session.refresh}
          />
        )}
      </PluginErrorBoundary>
    )
  }

  // Bare, not inside HostShell. While the session is unknown we do not know
  // whether this person may see the dashboard at all, and HostShell mounts
  // AppSidebar, which names every scope the server reported. Rendering it here
  // would leak the scope list to somebody who is about to be handed a sign-in
  // screen, which is the same leak the gate exists to prevent. "Neutral
  // chrome" means neither the shell nor the gate.
  if (session.state.status === "unknown") {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner />
        Resolving your session…
      </div>
    )
  }

  if (session.state.status === "unreachable") {
    return (
      <HostShell sidebar={sidebar} title={pageTitle}>
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not determine whether you are signed in</AlertTitle>
          <AlertDescription>{session.state.message}</AlertDescription>
        </Alert>
      </HostShell>
    )
  }
```

Note the `unknown` branch renders `HostShell` with a spinner, not the gate. That is the neutral chrome the spec requires and it is why `unknown` is its own state.

Finally, replace the hardcoded footer user in the `sidebar` object:

```tsx
    user:
      session.state.status === "signedIn"
        ? {
            name: session.state.principal.displayName ?? session.state.principal.subject ?? "Signed in",
            email: session.state.principal.email ?? "",
          }
        : { name: "Dashboard user", email: "" },
```

- [ ] **Step 5: Wrap the dashboard in a `SessionProvider`**

In `packages/host/src/ForgeDashboard.tsx`, add `SessionProvider` to the existing runtime import and wrap `PluginHost`. The provider must sit inside `ForgeDashboardProvider`, because it calls `useDashboardConfig`:

```tsx
    <ForgeDashboardProvider config={config}>
      <TooltipProvider>
        <BrowserRouter basename={basename}>
          <SessionProvider fetchImpl={fetchImpl}>
            <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
          </SessionProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ForgeDashboardProvider>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/host && npx vitest run`
Expected: PASS, all suites. If a pre-existing test now fails with an alert about determining sign-in state, its fetch stub is missing the `/principal` branch from Step 3.

- [ ] **Step 7: Mirror the gate tests into the playground suite**

Copy the whole `describe("PluginHost auth gate", ...)` block into `packages/host/test/host-playground.test.tsx`, and apply Step 3's two changes to that file's own `renderHost` and `capabilitiesFetch`. That suite has its own copies of both helpers.

Run: `cd packages/host && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Run the discriminator checks**

Two mutations, one at a time, restoring after each.

First, change the gate condition to `if (session.state.status !== "signedIn" && session.state.status !== "anonymous")`, which folds `unknown` in with signed out.
Run: `cd packages/host && npx vitest run test/host.test.tsx`
Expected: FAIL on "renders neither gate nor shell while the session is unknown".

Second, change the capabilities dependency array back to `[contractBase, doFetch]`.
Run: `cd packages/host && npx vitest run test/host.test.tsx`
Expected: the epoch test still passes, because it only counts the first pass. This is a known weakness in that test and it is recorded in the spec's testing table; leave the dependency array correct and move on rather than writing a test that drives a full sign-in transition through the dropdown.

- [ ] **Step 9: Typecheck and lint**

Run from the repo root: `npx turbo typecheck` and then in each changed package `npx eslint .`
Expected: typecheck passes for all packages. Lint passes for `host`, `runtime` and `plugin`. `kit` still fails on its vendored components, which is not yours.

- [ ] **Step 10: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/host/src/host/PluginHost.tsx packages/host/src/ForgeDashboard.tsx packages/host/test/host.test.tsx packages/host/test/host-playground.test.tsx
git commit -m "feat(host): put the auth gate in front of the shell"
```

---

### Task 7: the authsome gate and the footer sign-out

**Repo:** forge-dashboard

**Files:**
- Create: `packages/plugin-authsome/src/gate.tsx`
- Create: `packages/plugin-authsome/test/gate.test.tsx`
- Modify: `packages/plugin-authsome/src/index.tsx`
- Modify: `packages/plugin-authsome/test/plugin.test.tsx`
- Modify: `packages/kit/src/components/nav-user.tsx`
- Modify: `packages/kit/src/components/app-sidebar.tsx`
- Modify: `packages/kit/test/nav-user.test.tsx`
- Modify: `packages/host/src/host/PluginHost.tsx`

**Interfaces:**
- Consumes: `AuthGateProps` and `PluginAuth` from Task 3; `useCommand` and `useQuery` from `@forge-go/dashboard-plugin`; `AuthConfig` and `LoginResult` already exported from `./pages/login`.
- Produces: `AuthGate: ComponentType<AuthGateProps>` from `packages/plugin-authsome/src/gate.tsx`, and `NavUser`'s new `onSignOut?: () => void` prop.

The gate is not `AuthLoginPage`. That page keeps a local `subject` and renders a `SignedIn` panel after a successful login, which is right for a page you navigate to and wrong for a gate: a gate that succeeds should stop existing, because the session re-resolves and the shell replaces it. So the gate calls `onAuthenticated()` and renders nothing else.

`AuthLoginPage`, `LoginForm` and `SignedIn` all stay in `pages/login.tsx`, but the plugin no longer routes to any of them. Only `AuthLoginPage` is exported, from that file and from `index.tsx`; `LoginForm` and `SignedIn` are module-private and always were. Removing any of the three is a separate decision from removing the nav item, and their tests still pass either way.

The gate reuses that page's form markup rather than inventing its own, and "reuses" means the attributes too, not just the shape. `LoginForm`'s inputs carry `name="email" autoComplete="username"` and `name="password" autoComplete="current-password"`. Those are load-bearing on this screen above all others: the gate is what stands in front of the whole dashboard, so a password manager that cannot recognise its fields makes signing in worse for every user, every time. Carry the `name` and `autoComplete` attributes, the `login.loading` submit state, and the button's full-width styling across, and read the page's current markup rather than trusting this plan's transcription of it.

- [ ] **Step 1: Write the failing tests**

Create `packages/plugin-authsome/test/gate.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { AuthGate } from "../src/gate"
import { renderPage, stubClient } from "./harness"

const config = { passwordEnabled: true, brand: "Platform" }

describe("AuthGate", () => {
  it("renders the provider's sign-in form", async () => {
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={() => {}} />,
      stubClient({ "auth.config": config }),
    )
    expect(await screen.findByLabelText("Email")).toBeTruthy()
    expect(screen.getByLabelText("Password")).toBeTruthy()
  })

  it("reports a successful sign-in to the host instead of rendering a signed-in panel", async () => {
    const onAuthenticated = vi.fn()
    const client = stubClient({
      "auth.config": config,
      "auth.login": { ok: true, subject: "usr_1" },
    })
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={onAuthenticated} />,
      client,
    )

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } })
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))

    // A gate that succeeds stops existing. Rendering "signed in as ada" here
    // would leave the visitor staring at a confirmation with no way onward,
    // because the shell only appears once the host re-reads the session.
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/signed in as/i)).toBeNull()
  })

  it("does not report anything when the login command fails", async () => {
    const onAuthenticated = vi.fn()
    const client = stubClient({ "auth.config": config })
    client.command = vi.fn(async () => {
      throw new Error("bad credentials")
    })
    renderPage(
      () => <AuthGate loginPath="/dashboard/login" onAuthenticated={onAuthenticated} />,
      client,
    )

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "ada@example.com" },
    })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } })
    fireEvent.submit(screen.getByRole("button", { name: "Sign in" }))

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it("renders the denied variant and no form when requiredRoles is present", async () => {
    renderPage(
      () => (
        <AuthGate
          loginPath="/dashboard/login"
          requiredRoles={["admin"]}
          onAuthenticated={() => {}}
        />
      ),
      stubClient({ "auth.config": config }),
    )
    expect(await screen.findByText(/admin/)).toBeTruthy()
    expect(screen.queryByLabelText("Password")).toBeNull()
  })
})
```

Open `packages/plugin-authsome/test/harness.tsx` and read the real signatures of `renderPage` and `stubClient` before running this. Adjust the two call shapes above to match what the harness actually takes; the harness is the authority, not this plan. If `stubClient` keys on something other than an intent-to-response map, use its own shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/plugin-authsome && npx vitest run test/gate.test.tsx`
Expected: FAIL with a resolve error on `../src/gate`.

- [ ] **Step 3: Write the gate**

Create `packages/plugin-authsome/src/gate.tsx`:

```tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthGateProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert, QueryView } from "./components/query-view"
import type { AuthConfig, LoginResult } from "./pages/login"

/**
 * The screen the host renders instead of the dashboard when nobody is signed
 * in, or when somebody is signed in as the wrong person.
 *
 * This is not AuthLoginPage. That page holds a local `subject` and shows a
 * signed-in panel afterwards, which suits a page you navigated to. A gate that
 * succeeds should stop existing: it calls `onAuthenticated`, the host re-reads
 * /principal, and the shell takes the screen. Holding local state here would
 * leave a confirmation panel with no way onward.
 */
function Denied({ requiredRoles, loginPath }: { requiredRoles: string[]; loginPath: string }) {
  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>You do not have access to this dashboard</CardTitle>
        <CardDescription>
          It needs one of these roles: {requiredRoles.join(", ")}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <a className={buttonVariants({ variant: "outline" })} href={loginPath}>
          Sign in as someone else
        </a>
      </CardContent>
    </Card>
  )
}

function GateForm({
  config,
  onAuthenticated,
}: {
  config: AuthConfig
  onAuthenticated: () => void
}) {
  const login = useCommand<LoginResult>("auth.login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser navigates away on submit and the command never
    // finishes. jsdom does not navigate, so a missing preventDefault passes
    // every test here and fails on the first real click.
    event.preventDefault()
    const result = await login.execute({ email, password })
    if (result === undefined) return
    // Nothing is cleared and nothing is remembered. This component is about to
    // be unmounted by the host, so clearing the password box would be work
    // nobody sees.
    onAuthenticated()
  }

  return (
    <Card className="mx-auto max-w-sm">
      <CardHeader>
        <CardTitle>{config.brand ?? "Sign in"}</CardTitle>
        <CardDescription>
          {config.passwordEnabled
            ? "Sign in with your email and password."
            : "Choose a sign-in method."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CommandAlert command={login} />
        {config.passwordEnabled ? (
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId}>Email</Label>
              <Input
                id={emailId}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button type="submit" className={buttonVariants()} disabled={login.loading}>
              Sign in
            </button>
          </form>
        ) : null}
        {(config.socialProviders ?? []).map((provider) => (
          <a
            key={provider.id}
            className={buttonVariants({ variant: "outline" })}
            href={provider.authStartURL}
          >
            {provider.label}
          </a>
        ))}
      </CardContent>
    </Card>
  )
}

export function AuthGate({ loginPath, requiredRoles, onAuthenticated }: AuthGateProps) {
  const config = useQuery<AuthConfig>("auth.config")

  if ((requiredRoles?.length ?? 0) > 0) {
    return <Denied requiredRoles={requiredRoles ?? []} loginPath={loginPath} />
  }

  return (
    <QueryView title="Sign-in options" query={config} skeletonRows={3}>
      {(data) => <GateForm config={data} onAuthenticated={onAuthenticated} />}
    </QueryView>
  )
}
```

Read `packages/plugin-authsome/src/components/query-view.tsx` and confirm `CommandAlert` and `QueryView` take the props used above. Match the real signatures; the file is the authority. Read `pages/login.tsx` lines 154 onward and copy its actual form markup if it differs from this, so the gate and the page look identical.

- [ ] **Step 4: Declare the gate and drop the Sign in route**

In `packages/plugin-authsome/src/index.tsx`, add to the imports:

```tsx
import { AuthGate } from "./gate"
```

Export it alongside the pages so consumers can reach it:

```tsx
export { AuthGate }
```

Then change the `definePlugin` call. Remove the `Sign in` nav entry and the `/login` route, and declare the gate:

```tsx
export const authsomePlugin = definePlugin({
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  icon: <ShieldIcon />,
  // Sign-in is no longer a page. The host renders `gate` in place of the whole
  // shell when nobody is signed in, so a "Sign in" row sitting between Users
  // and Sessions for somebody already signed in has nothing to mean.
  auth: { gate: AuthGate, signOutIntent: "auth.logout" },
  nav: [
    { label: "Users", to: "/users", priority: 20, icon: <UsersIcon /> },
    { label: "Sessions", to: "/sessions", priority: 30, icon: <ClockIcon /> },
  ],
  routes: [
    { path: "/users", element: AuthUsersPage },
    { path: "/sessions", element: AuthSessionsPage },
  ],
})
```

Leave `DoorOpenIcon` imported only if something still uses it. If nothing does, remove it from the icons import or lint will fail on an unused binding.

- [ ] **Step 5: Update the plugin's own tests**

In `packages/plugin-authsome/test/plugin.test.tsx`, any assertion that the plugin declares a `/login` route or a `Sign in` nav item now asserts the opposite. Find them with:

Run: `grep -n "login\|Sign in" packages/plugin-authsome/test/plugin.test.tsx`

Rewrite each to assert the new shape, and add:

```tsx
it("declares the gate rather than a sign-in page", () => {
  expect(authsomePlugin.auth?.gate).toBeDefined()
  expect(authsomePlugin.nav.map((item) => item.to)).not.toContain("/login")
  expect(authsomePlugin.routes.map((route) => route.path)).not.toContain("/login")
})
```

The icon test added earlier iterates `plugin.nav`, so it keeps passing with two entries instead of three.

- [ ] **Step 6: Add sign-out to the footer**

In `packages/kit/src/components/nav-user.tsx`, add the prop:

```tsx
export function NavUser({
  user,
  onSignOut,
}: {
  user: {
    name: string
    email: string
    avatar?: string
  }
  /**
   * Runs when the sign-out item is chosen. Omit it and no sign-out item
   * renders: the dashboard may have no auth provider, and a menu item that
   * looks clickable and does nothing is worse than one that is not there.
   */
  onSignOut?: () => void
}) {
```

Then wrap the existing `Log out` item and the separator above it so both only render with a handler:

```tsx
            {onSignOut ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </>
            ) : null}
```

Keep whatever className and icon props the existing `LogOutIcon` and `DropdownMenuItem` carry; read them out of the file rather than retyping from this plan.

In `packages/kit/src/components/app-sidebar.tsx`, add `onSignOut?: () => void` to `AppSidebarProps`, destructure it, and pass it to `<NavUser user={user} onSignOut={onSignOut} />`.

- [ ] **Step 7: Test the footer**

Append to `packages/kit/test/nav-user.test.tsx`:

```tsx
it("renders no sign-out item without a handler", () => {
  renderNavUser()
  fireEvent.click(screen.getByRole("button"))
  expect(screen.queryByText("Log out")).toBeNull()
})

it("calls the handler when sign-out is chosen", () => {
  const onSignOut = vi.fn()
  renderNavUser({ onSignOut })
  fireEvent.click(screen.getByRole("button"))
  fireEvent.click(screen.getByText("Log out"))
  expect(onSignOut).toHaveBeenCalledTimes(1)
})
```

Read the top of that test file for its existing render helper's name and shape, and adapt these two to it. If there is no helper taking overrides, add one in the same style as `packages/kit/test/app-sidebar.test.tsx`'s `renderSidebar`.

- [ ] **Step 8: Wire it in the host**

In `packages/host/src/host/PluginHost.tsx`, above the `sidebar` object, add:

```tsx
  // Sign-out is the provider's command, sent through the provider's own
  // client, and this host never learns what it does. `signOutIntent` is a
  // string the plugin handed over; refreshing afterwards is what puts the gate
  // back up, because /principal is the only thing that decides that.
  const authProvider = resolveAuthProvider(plugins)
  const signOutIntent = authProvider?.auth?.signOutIntent
  const onSignOut =
    authProvider && signOutIntent
      ? () => {
          void clients
            .get(authProvider.extension)
            ?.command(signOutIntent)
            .catch(() => {
              // A failed sign-out still has to re-read the session: the cookie
              // may well be gone even though the response never arrived, and
              // leaving the old footer up would claim you are still signed in.
            })
            .finally(() => session.refresh())
        }
      : undefined
```

Add `onSignOut` to the `sidebar` object literal.

Note that `resolveAuthProvider` is now called twice in this component, once here and once in the gate block. That is a pure function over the same array and both calls are cheap; hoisting it above both is fine too, as long as it stays above the gate block's early return.

- [ ] **Step 9: Test the host wiring**

Append to `packages/host/test/host.test.tsx`, inside the `PluginHost auth gate` describe:

```tsx
it("sends the provider's sign-out command and re-reads the session", async () => {
  const sent: string[] = []
  let principalCalls = 0
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/principal")) {
      principalCalls += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, subject: "u1", email: "a@b.c" }),
      } as Response
    }
    if (url.endsWith("/capabilities")) {
      return jsonOk({
        shellEnvelopes: ["v1"],
        contributors: [
          { name: "core-contract", envelopes: ["v1"], configured: true },
          { name: "auth", envelopes: ["v1"], configured: true },
        ],
      })
    }
    if (url.endsWith("/csrf")) {
      return jsonOk({ token: "t", expiresAt: "2999-01-01T00:00:00Z" })
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as { intent?: string }
    if (body.intent) sent.push(body.intent)
    return jsonOk({ ok: true, data: { ok: true } })
  }) as unknown as typeof fetch

  const plugin = definePlugin({
    extension: "auth",
    namespace: "auth",
    auth: { gate: () => <p>gate body</p>, signOutIntent: "auth.logout" },
    nav: [],
    routes: [],
  })

  renderHost([rootPlugin(), plugin], fetchImpl, "/overview")
  await screen.findByText("root overview body")
  const before = principalCalls

  fireEvent.click(screen.getByText("Log out"))

  await waitFor(() => expect(sent).toContain("auth.logout"))
  await waitFor(() => expect(principalCalls).toBeGreaterThan(before))
})
```

The footer menu may need opening before the item exists. If `getByText("Log out")` fails, click the footer trigger first, the way `packages/kit/test/scope-switcher.test.tsx` opens its dropdown with `fireEvent.click` on the trigger button.

- [ ] **Step 10: Run everything**

Run from the repo root: `npx turbo test`
Expected: all test tasks pass.

Run: `npx turbo typecheck`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git status --short
git add packages/plugin-authsome/src/gate.tsx packages/plugin-authsome/test/gate.test.tsx packages/plugin-authsome/src/index.tsx packages/plugin-authsome/test/plugin.test.tsx packages/kit/src/components/nav-user.tsx packages/kit/src/components/app-sidebar.tsx packages/kit/test/nav-user.test.tsx packages/host/src/host/PluginHost.tsx packages/host/test/host.test.tsx
git commit -m "feat(authsome): serve sign-in as the gate and move sign-out to the footer"
```

---

### Task 8: 401 when there is no identity

**Repo:** forge (`/Users/rexraphael/Work/xraph/forge`)

**Files:**
- Modify: `extensions/dashboard/contract/transport/http.go`
- Modify: `extensions/dashboard/contract/transport/control.go`
- Test: `extensions/dashboard/contract/transport/http_test.go` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `401` with `contract.CodeUnauthenticated` for a caller with no identity, where the transport previously answered `403` with `CodePermissionDenied`. Task 10 is what makes this reachable from a real request.

The transport does not learn whether auth is enabled and must not. `handler` is built from `{reg, wreg, disp, audit, csrfMgr}` and adding config to it would thread a global through a request path for no gain. The only way to reach the branch being changed is a non-empty `Requires` predicate, and "there is no identity here" is the honest reason for that failure whether or not auth is switched on.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/dashboard/contract/transport/http_test.go`:

```go
// setupGatedRegistry mirrors setupRegistry but declares a predicate on
// users.list, so requests reach the authorization branch at all. Every
// intent in the repo's manifests today declares nothing, which is why this
// fixture has to exist rather than reusing the one above.
func setupGatedRegistry(t *testing.T) (contract.Registry, contract.WardenRegistry) {
	t.Helper()
	r := contract.NewRegistry()
	src := `
schemaVersion: 1
contributor: { name: users, envelope: { supports: [v1], preferred: v1 } }
intents:
  - { name: users.list, kind: query, version: 1, capability: read, requires: { any: ["role:admin"] } }
  - { name: users.open, kind: query, version: 1, capability: read }
`
	var m contract.ContractManifest
	if err := contract.UnmarshalManifestForTest([]byte(src), &m); err != nil {
		t.Fatal(err)
	}
	if err := r.Register(&m); err != nil {
		t.Fatal(err)
	}
	return r, contract.NewWardenRegistry()
}

func gatedRequest(t *testing.T, intent string, user *dashauth.UserInfo) *httptest.ResponseRecorder {
	t.Helper()
	reg, wreg := setupGatedRegistry(t)
	disp := &stubDispatcher{response: json.RawMessage(`{"users":[]}`)}
	h := NewHandler(reg, wreg, disp, contract.NoopAuditEmitter{})

	body, _ := json.Marshal(contract.Request{
		Envelope: "v1", Kind: contract.KindQuery, Contributor: "users", Intent: intent, IntentVersion: 1,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/v1", bytes.NewReader(body))
	if user != nil {
		req = req.WithContext(dashauth.WithUser(req.Context(), user))
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// TestHandler_UnauthenticatedIsNot403 pins the difference a client cannot
// work without. A caller with no identity has to be told to sign in; a
// caller with an identity that falls short of the predicate has to be told
// it fell short. Both answered 403 PERMISSION_DENIED before, so the shell
// had no way to tell "sign in" from "you are not allowed" and could only
// guess which screen to render.
func TestHandler_UnauthenticatedIsNot403(t *testing.T) {
	w := gatedRequest(t, "users.list", nil)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), string(contract.CodeUnauthenticated)) {
		t.Errorf("body = %s, want code %s", w.Body, contract.CodeUnauthenticated)
	}
}

func TestHandler_AuthenticatedButUnauthorizedIs403(t *testing.T) {
	w := gatedRequest(t, "users.list", &dashauth.UserInfo{Subject: "u1", Roles: []string{"viewer"}})

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", w.Code, w.Body)
	}
	if !strings.Contains(w.Body.String(), string(contract.CodePermissionDenied)) {
		t.Errorf("body = %s, want code %s", w.Body, contract.CodePermissionDenied)
	}
}

func TestHandler_AuthenticatedAndAuthorizedPasses(t *testing.T) {
	w := gatedRequest(t, "users.list", &dashauth.UserInfo{Subject: "u1", Roles: []string{"admin"}})

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body)
	}
}

// TestHandler_NoPredicateStillAllowsAnonymous is the regression guard that
// matters most here. Every intent in every manifest in the repo declares no
// predicate today, so a change that answered 401 whenever the user is nil
// would lock every existing dashboard out of itself, including the login
// intent that has to work while signed out.
func TestHandler_NoPredicateStillAllowsAnonymous(t *testing.T) {
	w := gatedRequest(t, "users.open", nil)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body)
	}
}
```

Add `dashauth "github.com/xraph/forge/extensions/dashboard/auth"` to the import block of that test file.

- [ ] **Step 2: Confirm `dashauth.WithUser` is exported**

Run: `grep -n "func WithUser" extensions/dashboard/auth/context.go`
Expected: an exported `func WithUser(ctx context.Context, user *UserInfo) context.Context`. If the setter has a different name, use the real one in the test.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd extensions/dashboard/contract/transport && go test -run 'TestHandler_Unauthenticated|TestHandler_AuthenticatedBut|TestHandler_AuthenticatedAnd|TestHandler_NoPredicate' ./...`
Expected: FAIL on `TestHandler_UnauthenticatedIsNot403` with `status = 403, want 401`. The other three should already pass, which is the point: they are the guards on behaviour that must not change.

- [ ] **Step 4: Split the denial in http.go**

In `extensions/dashboard/contract/transport/http.go`, the current block reads:

```go
	user := dashauth.UserFromContext(r.Context())
	p := contract.PrincipalFor(user)

	if !in.Requires.Allow(user, nil) {
		writeError(w, http.StatusForbidden, &contract.Error{Code: contract.CodePermissionDenied})
		return
	}
```

Replace it with:

```go
	user := dashauth.UserFromContext(r.Context())
	p := contract.PrincipalFor(user)

	if !in.Requires.Allow(user, nil) {
		// Two different answers, because a client has two different things to
		// do about them. No identity at all means sign in, and the shell puts
		// its gate up. An identity that falls short of the predicate means
		// this account cannot have it, and no amount of signing in again
		// changes that.
		//
		// The transport is not told whether auth is enabled and does not need
		// to be: the only way to reach this branch is a non-empty predicate,
		// and "there is no identity here" is the honest reason for the failure
		// either way.
		if user == nil {
			writeError(w, http.StatusUnauthorized, &contract.Error{Code: contract.CodeUnauthenticated})
			return
		}
		writeError(w, http.StatusForbidden, &contract.Error{Code: contract.CodePermissionDenied})
		return
	}
```

- [ ] **Step 5: Split it for SSE too**

In `extensions/dashboard/contract/transport/control.go`, the subscribe branch reads:

```go
		p := contract.PrincipalFor(conn.user)
		if !in.Requires.Allow(conn.user, nil) {
			http.Error(w, "permission denied", http.StatusForbidden)
			return
		}
```

Replace it with:

```go
		p := contract.PrincipalFor(conn.user)
		if !in.Requires.Allow(conn.user, nil) {
			// Same split as the HTTP transport. A subscription refused for
			// want of identity is a sign-in prompt, not a dead end.
			if conn.user == nil {
				http.Error(w, "unauthenticated", http.StatusUnauthorized)
				return
			}
			http.Error(w, "permission denied", http.StatusForbidden)
			return
		}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd extensions/dashboard/contract/transport && go test ./...`
Expected: PASS, all four new tests and every pre-existing one.

- [ ] **Step 7: Run the wider suite**

Run: `cd extensions/dashboard && go test ./...`
Expected: PASS. If a contract security end-to-end test asserted 403 for an anonymous caller against a gated intent, it now asserts 401. Update those assertions; do not revert the split.

- [ ] **Step 8: Vet and lint**

Run: `cd /Users/rexraphael/Work/xraph/forge && go vet ./extensions/dashboard/... && golangci-lint run ./extensions/dashboard/contract/transport/...`
Expected: both clean. If golangci-lint reports findings, re-run with `--max-issues-per-linter=0 --max-same-issues=0` before believing the count, and clear its cache if the findings name code you did not touch.

- [ ] **Step 9: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge
git status --short
git add extensions/dashboard/contract/transport/http.go extensions/dashboard/contract/transport/control.go extensions/dashboard/contract/transport/http_test.go
git commit -m "fix(dashboard): answer 401 when an intent is refused for want of identity"
```

---

### Task 9: inject the principal

**Repo:** forge (`/Users/rexraphael/Work/xraph/forge`)

**Files:**
- Modify: `extensions/dashboard/shell_handlers.go`
- Test: `extensions/dashboard/shell_handlers_test.go` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a `principal` key in `window.__FORGE_DASHBOARD__`, always written, `null` when nobody is signed in. Task 2's `injectedPrincipal()` reads it, and the absent-versus-null distinction there depends on this always writing the key.

- [ ] **Step 1: Write the failing tests**

Append to `extensions/dashboard/shell_handlers_test.go`:

```go
// TestShellBootstrap_PrincipalIsAlwaysPresent pins the half of the contract
// the client cannot see. The shell distinguishes "no principal key" (nobody
// told me, show a spinner) from "principal: null" (the server looked and
// found nobody, show the gate). Omitting the key when there is no user would
// collapse those two, and the collapse shows up as a sign-in screen flashed
// at signed-in people rather than as a failing test over here.
func TestShellBootstrap_PrincipalIsAlwaysPresent(t *testing.T) {
	cfg := DefaultConfig()
	cfg.EnableAuth = true

	body := shellBootstrapJSONForTest(t, cfg, nil)

	if !strings.Contains(body, `"principal":null`) {
		t.Fatalf("bootstrap = %s, want an explicit principal:null", body)
	}
}

func TestShellBootstrap_CarriesTheSignedInUser(t *testing.T) {
	cfg := DefaultConfig()
	cfg.EnableAuth = true

	body := shellBootstrapJSONForTest(t, cfg, &dashauth.UserInfo{
		Subject:     "usr_1",
		DisplayName: "Ada Lovelace",
		Email:       "ada@example.com",
		Roles:       []string{"admin"},
	})

	for _, want := range []string{
		`"authenticated":true`,
		`"subject":"usr_1"`,
		`"displayName":"Ada Lovelace"`,
		`"email":"ada@example.com"`,
		`"admin"`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("bootstrap = %s, want it to contain %s", body, want)
		}
	}
}
```

Add a helper in the same test file that marshals the bootstrap for a config and a user. Read the existing tests in that file first and reuse whatever they already do to reach `shellBootstrapFor`; if they call it directly, the helper is:

```go
func shellBootstrapJSONForTest(t *testing.T, cfg Config, user *dashauth.UserInfo) string {
	t.Helper()
	b, err := json.Marshal(shellBootstrapWithPrincipal(shellBootstrapFor(cfg), user))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
```

Add `encoding/json`, `strings`, and `dashauth "github.com/xraph/forge/extensions/dashboard/auth"` to that file's imports if they are absent.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd extensions/dashboard && go test -run TestShellBootstrap_ ./...`
Expected: FAIL to compile, naming `shellBootstrapWithPrincipal` as undefined.

- [ ] **Step 3: Add the field and the builder**

In `extensions/dashboard/shell_handlers.go`, add the field to the struct. It is a pointer so `null` is what an absent user marshals to, and it carries no `omitempty` because always writing the key is the contract:

```go
type shellBootstrap struct {
	BasePath     string `json:"basePath"`
	ContractBase string `json:"contractBase"`
	ShellBase    string `json:"shellBase"`
	AuthEnabled  bool   `json:"authEnabled"`
	LoginPath    string `json:"loginPath"`
	// Always written, null when nobody is signed in. No omitempty: the shell
	// reads an absent key as "nobody told me" and renders loading chrome,
	// and a present null as "the server looked and found nobody" and renders
	// the gate on the first frame. Dropping the key would turn every
	// signed-out visit into a spinner followed by a gate.
	Principal *shellPrincipal `json:"principal"`
}

// shellPrincipal mirrors handlers.principalResponse on the wire so the client
// has exactly one type for the injected value and the fetched one. It is a
// separate struct rather than a reuse because that one is unexported in
// another package, and exporting it to save fifteen lines would widen that
// package's API for no caller outside this file.
type shellPrincipal struct {
	Authenticated bool     `json:"authenticated"`
	Subject       string   `json:"subject,omitempty"`
	DisplayName   string   `json:"displayName,omitempty"`
	Email         string   `json:"email,omitempty"`
	Roles         []string `json:"roles,omitempty"`
	Scopes        []string `json:"scopes,omitempty"`
}

// shellBootstrapWithPrincipal fills in the principal for one request.
//
// Split from shellBootstrapFor because that one is per-config and cached-ish
// in spirit, while this is per-request: two visitors hitting the same
// dashboard get the same config and different principals.
func shellBootstrapWithPrincipal(base shellBootstrap, user *dashauth.UserInfo) shellBootstrap {
	if user == nil || !user.Authenticated() {
		base.Principal = nil
		return base
	}
	display := user.DisplayName
	if display == "" {
		display = user.Subject
	}
	base.Principal = &shellPrincipal{
		Authenticated: true,
		Subject:       user.Subject,
		DisplayName:   display,
		Email:         user.Email,
		Roles:         append([]string{}, user.Roles...),
		Scopes:        append([]string{}, user.Scopes...),
	}
	return base
}
```

Add `dashauth "github.com/xraph/forge/extensions/dashboard/auth"` to the file's imports if it is not already there.

- [ ] **Step 4: Use it where the bootstrap is serialised**

Find the place that marshals the bootstrap into the injected script tag:

Run: `grep -n "shellBootstrapFor\|cfgJSON\|__FORGE_DASHBOARD__" extensions/dashboard/shell_handlers.go`

At that site the handler has the `*http.Request`. Change the value being marshalled from `shellBootstrapFor(cfg)` to:

```go
shellBootstrapWithPrincipal(shellBootstrapFor(cfg), dashauth.UserFromContext(r.Context()))
```

If the marshalling happens outside a request scope, move it inside the handler closure. The whole point is that this value is per-request, and computing it once at mount time would inject the first visitor's identity into every later visitor's page.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd extensions/dashboard && go test ./...`
Expected: PASS. A pre-existing test asserting the exact JSON of the bootstrap will now see the extra key; update its expectation rather than adding `omitempty`.

- [ ] **Step 6: Verify the middleware reaches the shell route**

The injected principal is only ever non-null if `ForgeMiddleware` ran on the shell route. Read `extensions/dashboard/extension.go` around line 1680 and confirm `routeOpts` is applied to the shell handler's route registration and not only to the contract API routes.

Run: `grep -n "routeOpts" extensions/dashboard/extension.go`
Expected: `routeOpts` passed to the shell route as well. If it is not, add it there, and note in your task report that the fast path was dead until that change.

- [ ] **Step 7: Vet and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge
go vet ./extensions/dashboard/...
git status --short
git add extensions/dashboard/shell_handlers.go extensions/dashboard/shell_handlers_test.go
git commit -m "feat(dashboard): inject the request's principal into the shell bootstrap"
```

If Step 6 required a change to `extension.go`, add that file to the same commit.

---

### Task 10: declare permissions on the authsome intents

**Repo:** authsome (`/Users/rexraphael/Work/xraph/authsome`)

**Files:**
- Modify: `extension/contract/manifest.yaml`

**Interfaces:**
- Consumes: Task 8's 401/403 split, without which every one of these answers 403.
- Produces: the end-to-end proof that the split works on a real request.

This is deliberately narrow. The permission vocabulary, and the question of who declares what across the whole contract, belong to the authorization spec. These eleven intents get predicates because listing and revoking other people's sessions and banning other people's accounts are the least defensible things in the codebase to leave callable by anybody.

Check which branch you are on before editing. The repo was on `chore/adopt-new-logger` when this plan was written, which is unrelated to this change, so branch from wherever the dashboard contract work belongs.

- [ ] **Step 1: Add the predicates**

In `extension/contract/manifest.yaml`, the users and sessions intents are single-line flow maps. Add a `requires` key to each of the eleven below, keeping the flow style. Quote every predicate token: unquoted `role:admin` inside a flow sequence is ambiguous YAML, because a colon in a plain scalar can read as a mapping indicator.

```yaml
  - { name: users.list,   kind: query,   version: 1, capability: read,  requires: { any: ["role:admin", "scope:users:read"] } }
  - { name: users.detail, kind: query,   version: 1, capability: read,  requires: { any: ["role:admin", "scope:users:read"] } }
  - { name: users.create, kind: command, version: 1, capability: write, requires: { any: ["role:admin", "scope:users:write"] } }
  - { name: users.update, kind: command, version: 1, capability: write, requires: { any: ["role:admin", "scope:users:write"] } }
  - { name: users.ban,    kind: command, version: 1, capability: write, requires: { all: ["role:admin"] }, invalidates: [users.list, users.detail] }
  - { name: users.unban,  kind: command, version: 1, capability: write, requires: { all: ["role:admin"] }, invalidates: [users.list, users.detail] }
  - { name: users.delete, kind: command, version: 1, capability: write, requires: { all: ["role:admin"] }, invalidates: [users.list] }
```

And in the sessions block:

```yaml
  - { name: sessions.list,        kind: query,   version: 1, capability: read,  requires: { any: ["role:admin", "scope:sessions:read"] } }
  - { name: sessions.detail,      kind: query,   version: 1, capability: read,  requires: { any: ["role:admin", "scope:sessions:read"] } }
  - { name: sessions.revoke,      kind: command, version: 1, capability: write, requires: { all: ["role:admin"] }, invalidates: [sessions.list, sessions.detail] }
  - { name: sessions.bulkRevoke,  kind: command, version: 1, capability: write, requires: { all: ["role:admin"] }, invalidates: [sessions.list] }
```

Note the asymmetry: reads accept a scope as an alternative to the role, writes require the role. A deployment can hand a service account `scope:users:read` for a reporting job without handing it the ability to ban people.

Leave `auth.login`, `auth.logout` and `auth.config` with no `requires`. They have to be callable while signed out, and an intent is reachable while signed out exactly when it declares no predicate. Do not add an allowlist mechanism; the omission is the mechanism.

- [ ] **Step 2: Confirm the manifest still parses**

Run: `cd /Users/rexraphael/Work/xraph/authsome && go build ./... && go test ./extension/...`
Expected: PASS. A YAML error here surfaces as a manifest registration failure, not a parse error at build time, so the test run is the real check. If the manifest is validated by a test that asserts an exact intent count or shape, update it.

- [ ] **Step 3: Verify end to end against the demo**

This is the proof the spec asks for. From `forge-dashboard`:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard/demo && go run .
```

Then, in another shell:

```bash
curl -s -o /dev/stdout -w " [%{http_code}]\n" \
  -X POST http://localhost:8099/dashboard/api/dashboard/v1 \
  -H 'Content-Type: application/json' \
  -d '{"envelope":"v1","kind":"query","contributor":"auth","intent":"users.list","intentVersion":1}'
```

Expected, signed out: status `401` and a body containing `UNAUTHENTICATED`. Before Task 8 this was `403 PERMISSION_DENIED`, and before this task it was `200` with the user list.

If port 8099 is already taken, another process owns it. Do not kill it; run the demo on another port with `PORT=8098 go run .` and adjust the URL.

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/authsome
git status --short
git add extension/contract/manifest.yaml
git commit -m "feat(contract): require a role or scope for the users and sessions intents"
```

---

## Verification of the whole plan

Run these in order once every task is done.

- [ ] `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo test` passes
- [ ] `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo typecheck` passes
- [ ] `cd /Users/rexraphael/Work/xraph/forge && go test ./extensions/dashboard/...` passes
- [ ] `cd /Users/rexraphael/Work/xraph/authsome && go test ./extension/...` passes
- [ ] The sidebar footer shows the signed-in user's real name and email, not `user@example.com`
- [ ] `FIXTURE_PRINCIPAL=signedOut` against the shell renders the gate with no sidebar in the DOM
- [ ] `FIXTURE_PRINCIPAL=denied` renders the access-denied panel with a way to sign out
- [ ] `curl` on `users.list` answers 401 signed out, 403 as a viewer, 200 as an admin

## What this plan does not do

No permission vocabulary beyond the two manifests in Task 10. No nav or scope filtering by role. No per-intent permissions anywhere else in the contract. Those are the authorization spec.

The CSRF rejection at `http.go` still answers 403 with code `UNAUTHENTICATED`, which is wrong in the same way the change in Task 8 fixes elsewhere. It stays wrong on purpose: `isStaleTokenRejection` keys on that exact pair for its command retry, and Task 4's retry-exhaustion rule makes the client correct without touching it. Changing it is a wire-visible change to retry behaviour and belongs in its own change with its own reasoning.
