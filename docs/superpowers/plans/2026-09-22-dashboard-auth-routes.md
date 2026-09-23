# Dashboard Auth Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the auth gate that swaps out the whole shell with real URLs the dashboard host owns, so a cold password-reset deep link routes correctly.

**Architecture:** `PluginAuth` stops carrying a React component and carries intent names instead, the way `signOutIntent` already does. The host gains an auth route table mounted only while signed out, outside `HostShell`, with four redirect rules and validated `next` handling. A split-panel layout in `packages/kit` backs all five screens plus the denied state. `defineForgeDashboard` takes an optional `authScreens` map so a host app can substitute its own components, which is how `twinos-app` will use `@authsome/ui-components`.

**Tech Stack:** TypeScript, React 19, react-router 8, Vitest with jsdom, Testing Library, Tailwind v4, pnpm workspaces, Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-22-dashboard-auth-routes-design.md`

## Global Constraints

- Packages ship TypeScript source. No build step. `exports` points at `./src/*`.
- Every package runs `pnpm test` (vitest), `pnpm lint` (eslint), `pnpm typecheck` (`tsc --noEmit`). All three must pass before a commit.
- Host and kit tests live in `test/`, config at `<package>/vitest.config.ts`, setup file `../test-support/jsdom-setup.ts`.
- No em dashes in any code comment, doc, or commit message. Use a comma, a full stop, a colon, or parentheses.
- No `Co-Authored-By` trailers and no Claude attribution in commit messages.
- At most one plugin may declare `auth`. `resolveAuthProvider` enforces this by throwing at resolve time.
- `AuthConfig.passwordEnabled` is required. Every other field is optional.
- Two-space indent, no semicolons, double quotes. Match surrounding files.

---

### Task 1: Move AuthConfig into the plugin package

`AuthConfig` and `SocialProvider` currently live in `packages/plugin-authsome/src/pages/login.tsx`. They become the contract every auth provider satisfies, so they move to `packages/plugin` where the host can import them without depending on authsome.

**Files:**
- Modify: `packages/plugin/src/auth.ts`
- Test: `packages/plugin/test/auth-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AuthConfig`, `SocialProvider`, `LoginResult`, `LogoutResult`, exported from `@forge-go/dashboard-plugin`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin/test/auth-config.test.ts
import { describe, expect, it } from "vitest"
import type { AuthConfig, SocialProvider } from "../src/auth"

describe("AuthConfig", () => {
  it("requires passwordEnabled and leaves everything else optional", () => {
    // A config answering only passwordEnabled is valid. That asymmetry is the
    // point: a deployment with password login off and one OAuth provider must
    // not be shown a box it will reject.
    const minimal: AuthConfig = { passwordEnabled: false }
    expect(minimal.passwordEnabled).toBe(false)

    const provider: SocialProvider = {
      id: "github",
      label: "Continue with GitHub",
      authStartURL: "https://auth.example/start/github",
    }
    const full: AuthConfig = {
      passwordEnabled: true,
      brand: "Platform",
      signupURL: "/signup",
      signupLabel: "Create an account",
      termsURL: "https://example/terms",
      privacyURL: "https://example/privacy",
      socialProviders: [provider],
    }
    expect(full.socialProviders).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin && npx vitest run test/auth-config.test.ts`
Expected: FAIL, `"../src/auth"` has no exported member `AuthConfig`.

- [ ] **Step 3: Add the types to auth.ts**

Append to `packages/plugin/src/auth.ts`:

```ts
/** One OAuth button the deployment has configured, from the `config` intent. */
export interface SocialProvider {
  id: string
  label: string
  authStartURL: string
}

/**
 * What the `config` intent answers: the shape of the sign-in form this
 * particular deployment supports.
 *
 * `passwordEnabled` is the one required field because a config that does not
 * answer it has told us nothing, and the safe reading of nothing is "render no
 * password form" and not "guess".
 */
export interface AuthConfig {
  passwordEnabled: boolean
  brand?: string
  signupURL?: string
  signupLabel?: string
  termsURL?: string
  privacyURL?: string
  socialProviders?: SocialProvider[]
}

/** What the `signIn` intent answers. `subject` identifies whoever signed in. */
export interface LoginResult {
  ok: boolean
  subject?: string
}

/** What the `signOut` intent answers. */
export interface LogoutResult {
  ok: boolean
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin && npx vitest run test/auth-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the package gates**

Run: `cd packages/plugin && npx vitest run && npx tsc --noEmit && npx eslint`
Expected: all pass. `packages/plugin/src/index.ts` already does `export * from "./auth"`, so no export change is needed.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/auth.ts packages/plugin/test/auth-config.test.ts
git commit -m "feat(plugin): make AuthConfig part of the auth contract"
```

---

### Task 2: Replace PluginAuth.gate with intent names

**Files:**
- Modify: `packages/plugin/src/auth.ts`
- Test: `packages/plugin/test/auth-intents.test.ts`

**Interfaces:**
- Consumes: `AuthConfig` from Task 1.
- Produces: `PluginAuth` with an `intents` object, and `AuthIntents`. `AuthGateProps` is deleted.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin/test/auth-intents.test.ts
import { describe, expect, it } from "vitest"
import { resolveAuthProvider } from "../src/auth"
import type { AuthIntents } from "../src/auth"
import type { ForgePlugin } from "../src/types"

function plugin(extension: string, intents?: AuthIntents): ForgePlugin {
  return {
    extension,
    nav: [],
    routes: [],
    context: [],
    ...(intents ? { auth: { intents } } : {}),
  } as ForgePlugin
}

const minimal: AuthIntents = { config: "auth.config", signIn: "auth.login" }

describe("PluginAuth", () => {
  it("carries intent names and no components", () => {
    const provider = plugin("auth", minimal)
    expect(provider.auth?.intents.signIn).toBe("auth.login")
    expect("gate" in (provider.auth ?? {})).toBe(false)
  })

  it("finds the one plugin declaring auth", () => {
    expect(resolveAuthProvider([plugin("core"), plugin("auth", minimal)])?.extension).toBe("auth")
  })

  it("returns undefined when nothing declares auth", () => {
    expect(resolveAuthProvider([plugin("core")])).toBeUndefined()
  })

  it("throws when two plugins declare auth, naming both", () => {
    expect(() => resolveAuthProvider([plugin("a", minimal), plugin("b", minimal)])).toThrow(/a, b/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin && npx vitest run test/auth-intents.test.ts`
Expected: FAIL, no exported member `AuthIntents`.

- [ ] **Step 3: Replace the interface**

In `packages/plugin/src/auth.ts`, delete `AuthGateProps` and the `gate` field. Remove the now-unused `ComponentType` import. Replace `PluginAuth` with:

```ts
/**
 * Intents that implement auth, named by the plugin and called by the host.
 *
 * Named and not called, the same way `signOut` always was. That is what lets
 * the host render a sign-in screen without learning which product is behind
 * it, and lets a plugin contribute auth without shipping a single component.
 *
 * Optional keys are load-bearing: a provider with no `signUp` gets no
 * `/signup` route and no link pointing at one.
 */
export interface AuthIntents {
  /** Branding and which methods are enabled. Answers `AuthConfig`. */
  config: string
  /** Answers `LoginResult`. */
  signIn: string
  /** Answers `LogoutResult`. Omit it and the sidebar renders no sign-out. */
  signOut?: string
  forgotPassword?: string
  resetPassword?: string
  signUp?: string
  setupStatus?: string
  completeSetup?: string
}

export interface PluginAuth {
  intents: AuthIntents
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/plugin && npx vitest run test/auth-intents.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the breakage is where you expect**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo typecheck`
Expected: FAIL in `packages/host` (`provider?.auth?.gate`) and `packages/plugin-authsome` (`auth: { gate, signOutIntent }`). Those are Tasks 6 and 9. No other package should fail. If one does, note it before continuing.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/src/auth.ts packages/plugin/test/auth-intents.test.ts
git commit -m "feat(plugin)!: auth plugins declare intents, not a gate component"
```

---

### Task 3: Validate the next parameter

The redirect target comes from a query string a visitor controls, so it is an open redirect until proven otherwise.

**Files:**
- Create: `packages/host/src/auth/next-param.ts`
- Test: `packages/host/test/next-param.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `safeNext(raw: string | null, basename: string): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/host/test/next-param.test.ts
import { describe, expect, it } from "vitest"
import { safeNext } from "../src/auth/next-param"

describe("safeNext", () => {
  it("keeps an ordinary internal path", () => {
    expect(safeNext("/forge/apps", "/forge")).toBe("/forge/apps")
  })

  it("falls back to the basename when absent", () => {
    expect(safeNext(null, "/forge")).toBe("/forge")
  })

  it("rejects a protocol-relative URL", () => {
    // "//evil.example.com" is a valid URL that leaves the site. This is the
    // case people miss, because it passes a naive startsWith("/") check.
    expect(safeNext("//evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a backslash authority", () => {
    expect(safeNext("/\\evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.example.com", "/forge")).toBe("/forge")
  })

  it("rejects a scheme-only target", () => {
    expect(safeNext("javascript:alert(1)", "/forge")).toBe("/forge")
  })

  it("rejects a relative path with no leading slash", () => {
    expect(safeNext("apps", "/forge")).toBe("/forge")
  })

  it("keeps a query string and a fragment", () => {
    expect(safeNext("/forge/apps?tab=live#top", "/forge")).toBe("/forge/apps?tab=live#top")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host && npx vitest run test/next-param.test.ts`
Expected: FAIL, cannot find module `../src/auth/next-param`.

- [ ] **Step 3: Implement**

```ts
// packages/host/src/auth/next-param.ts

/**
 * Turns an untrusted `next` query parameter into a path this app will navigate
 * to, or the basename when it cannot.
 *
 * The parameter is attacker-controlled, so the rule is an allowlist: one
 * leading slash, no second slash, no backslash, no scheme. "//evil.example.com"
 * is the case worth naming, because it is a valid protocol-relative URL that
 * leaves the site and it passes a naive startsWith("/") check.
 *
 * Implemented here rather than taken from an auth vendor's package so the rule
 * holds whichever provider a dashboard is running.
 */
export function safeNext(raw: string | null, basename: string): string {
  if (!raw) return basename
  if (!raw.startsWith("/")) return basename
  if (raw.startsWith("//") || raw.startsWith("/\\")) return basename
  return raw
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/host && npx vitest run test/next-param.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/host/src/auth/next-param.ts packages/host/test/next-param.test.ts
git commit -m "feat(host): validate the next redirect parameter"
```

---

### Task 4: Split-panel auth layout in the kit

**Files:**
- Create: `packages/kit/src/components/auth-layout.tsx`
- Test: `packages/kit/test/auth-layout.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `AuthLayout` with props `{ title: string; description?: string; brand?: string; serverHost?: string; children: ReactNode; footer?: ReactNode }`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/kit/test/auth-layout.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AuthLayout } from "../src/components/auth-layout"

describe("AuthLayout", () => {
  it("renders the title, description and children", () => {
    render(
      <AuthLayout description="Welcome back." title="Sign in">
        <button type="submit">Continue</button>
      </AuthLayout>,
    )
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeDefined()
    expect(screen.getByText("Welcome back.")).toBeDefined()
    expect(screen.getByRole("button", { name: "Continue" })).toBeDefined()
  })

  it("shows the server host, which is what tells two Forges apart", () => {
    render(
      <AuthLayout serverHost="localhost:7901" title="Sign in">
        <div />
      </AuthLayout>,
    )
    expect(screen.getByText("localhost:7901")).toBeDefined()
  })

  it("falls back to a default brand when none is given", () => {
    render(<AuthLayout title="Sign in"><div /></AuthLayout>)
    expect(screen.getByText("Forge dashboard")).toBeDefined()
  })

  it("uses the given brand", () => {
    render(<AuthLayout brand="Platform" title="Sign in"><div /></AuthLayout>)
    expect(screen.getByText("Platform")).toBeDefined()
  })

  it("renders a footer when given one", () => {
    render(
      <AuthLayout footer={<a href="/forge/login">Back to sign in</a>} title="Reset">
        <div />
      </AuthLayout>,
    )
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/kit && npx vitest run test/auth-layout.test.tsx`
Expected: FAIL, cannot find module `../src/components/auth-layout`.

- [ ] **Step 3: Implement**

```tsx
// packages/kit/src/components/auth-layout.tsx
import type { ReactNode } from "react"
import { cn } from "../lib/utils"

export interface AuthLayoutProps {
  /** The heading. Every auth screen has exactly one. */
  title: string
  description?: string
  /** From the provider's `config` intent. */
  brand?: string
  /**
   * The Forge server this screen signs in to.
   *
   * Not decoration. Run more than one Forge and these screens are otherwise
   * indistinguishable, so this is the only thing on the page telling you which
   * machine you are about to hand a password to.
   */
  serverHost?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/**
 * The shell every auth screen renders inside, and the denied state too.
 *
 * A split panel above 768px and a single column below it, where the left panel
 * collapses to a header strip. One component for all six surfaces so they
 * cannot drift apart.
 */
export function AuthLayout({
  title,
  description,
  brand = "Forge dashboard",
  serverHost,
  children,
  footer,
  className,
}: AuthLayoutProps) {
  return (
    <div className={cn("flex min-h-svh flex-col md:flex-row", className)}>
      <aside className="flex flex-col justify-between gap-6 border-b bg-muted/40 p-6 md:w-2/5 md:max-w-sm md:border-r md:border-b-0 md:p-10">
        <div>
          <div
            aria-hidden="true"
            className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60"
          />
          <p className="mt-4 font-semibold text-xl leading-tight tracking-tight">
            {brand}
          </p>
          <p className="mt-2 text-muted-foreground text-sm">
            Every extension, one console.
          </p>
        </div>
        {serverHost ? (
          <p className="font-mono text-muted-foreground text-xs">{serverHost}</p>
        ) : null}
      </aside>

      <main className="flex flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-muted-foreground text-sm">{description}</p>
          ) : null}
          <div className="mt-6">{children}</div>
          {footer ? (
            <div className="mt-6 text-center text-sm">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/kit && npx vitest run test/auth-layout.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the package gates**

Run: `cd packages/kit && npx vitest run && npx tsc --noEmit && npx eslint`
Expected: all pass. `packages/kit/package.json` already exports `./components/*`, so no manifest change is needed.

- [ ] **Step 6: Commit**

```bash
git add packages/kit/src/components/auth-layout.tsx packages/kit/test/auth-layout.test.tsx
git commit -m "feat(kit): add the split-panel auth layout"
```

---

### Task 5: The auth route table

Which routes exist is decided by which intents the provider declared. This task is the pure function that makes that decision, with no rendering in it.

**Files:**
- Create: `packages/host/src/auth/routes.ts`
- Test: `packages/host/test/auth-routes.test.ts`

**Interfaces:**
- Consumes: `AuthIntents` from Task 2.
- Produces: `AUTH_PATHS`, `authRoutesFor(intents, screens)`, `isAuthPath(pathname, basename)`, and the `AuthScreens` and `AuthScreenProps` types.

- [ ] **Step 1: Write the failing test**

```ts
// packages/host/test/auth-routes.test.ts
import { describe, expect, it } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { authRoutesFor, AUTH_PATHS, isAuthPath } from "../src/auth/routes"

const minimal: AuthIntents = { config: "auth.config", signIn: "auth.login" }

describe("authRoutesFor", () => {
  it("always mounts login, and nothing else for a minimal provider", () => {
    expect(authRoutesFor(minimal, {}).map((r) => r.path)).toEqual(["/login"])
  })

  it("mounts forgot-password only when the intent is declared", () => {
    const routes = authRoutesFor({ ...minimal, forgotPassword: "auth.forgot" }, {})
    expect(routes.map((r) => r.path)).toContain("/forgot-password")
  })

  it("mounts reset-password only when the intent is declared", () => {
    const routes = authRoutesFor({ ...minimal, resetPassword: "auth.reset" }, {})
    expect(routes.map((r) => r.path)).toContain("/reset-password")
  })

  it("mounts signup only when the intent is declared", () => {
    expect(authRoutesFor({ ...minimal, signUp: "auth.signup" }, {}).map((r) => r.path))
      .toContain("/signup")
  })

  it("mounts setup only when both setup intents are declared", () => {
    expect(authRoutesFor({ ...minimal, setupStatus: "auth.setupStatus" }, {}).map((r) => r.path))
      .not.toContain("/setup")
    const both = authRoutesFor(
      { ...minimal, setupStatus: "auth.setupStatus", completeSetup: "auth.setup" },
      {},
    )
    expect(both.map((r) => r.path)).toContain("/setup")
  })

  it("prefers an overriding screen over the default", () => {
    const Custom = () => null
    expect(authRoutesFor(minimal, { signIn: Custom })[0].element).toBe(Custom)
  })
})

describe("isAuthPath", () => {
  it("matches a mounted auth path under the basename", () => {
    expect(isAuthPath("/forge/login", "/forge")).toBe(true)
    expect(isAuthPath("/forge/reset-password", "/forge")).toBe(true)
  })

  it("does not match a dashboard path", () => {
    expect(isAuthPath("/forge/apps", "/forge")).toBe(false)
    expect(isAuthPath("/forge", "/forge")).toBe(false)
  })

  it("does not match a path that merely starts with an auth path", () => {
    expect(isAuthPath("/forge/loginsomething", "/forge")).toBe(false)
  })

  it("works with no basename", () => {
    expect(isAuthPath("/login", "")).toBe(true)
  })

  it("exposes every known path", () => {
    expect(AUTH_PATHS).toEqual([
      "/login",
      "/forgot-password",
      "/reset-password",
      "/signup",
      "/setup",
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host && npx vitest run test/auth-routes.test.ts`
Expected: FAIL, cannot find module `../src/auth/routes`.

- [ ] **Step 3: Implement**

```ts
// packages/host/src/auth/routes.ts
import type { ComponentType } from "react"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

/** What every auth screen receives, whether a default or an override. */
export interface AuthScreenProps {
  intents: AuthIntents
  /** Where the dashboard is mounted. Prefix every link with it. */
  basename: string
  /** Validated already. Navigate here after a successful sign-in. */
  next: string
  /** Call after signing in. The host re-reads /principal. */
  onAuthenticated: () => void
}

/** A host app may replace any of these, independently. */
export interface AuthScreens {
  signIn?: ComponentType<AuthScreenProps>
  forgotPassword?: ComponentType<AuthScreenProps>
  resetPassword?: ComponentType<AuthScreenProps>
  signUp?: ComponentType<AuthScreenProps>
  setup?: ComponentType<AuthScreenProps>
}

export interface AuthRoute {
  path: string
  element: ComponentType<AuthScreenProps>
}

/**
 * Every path this host will ever treat as an auth path.
 *
 * Fixed rather than derived so `isAuthPath` can answer before a provider has
 * resolved, which is what stops a signed-out visitor on /login being bounced
 * to /login again while capabilities are still loading.
 */
export const AUTH_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/signup",
  "/setup",
] as const

/** True when `pathname` is one of AUTH_PATHS under `basename`. */
export function isAuthPath(pathname: string, basename: string): boolean {
  const rest = basename && pathname.startsWith(basename)
    ? pathname.slice(basename.length)
    : pathname
  return (AUTH_PATHS as readonly string[]).includes(rest)
}

/**
 * The routes to mount, given what the provider can actually do.
 *
 * A capability the provider never declared produces no route, so there is no
 * separate configuration to keep in step with the intent list, and no link
 * that renders a blank screen.
 */
export function authRoutesFor(
  intents: AuthIntents,
  screens: AuthScreens,
  defaults: AuthScreens = {},
): AuthRoute[] {
  const routes: AuthRoute[] = []
  const pick = (
    key: keyof AuthScreens,
  ): ComponentType<AuthScreenProps> | undefined => screens[key] ?? defaults[key]

  const add = (path: string, key: keyof AuthScreens) => {
    const element = pick(key)
    if (element) routes.push({ path, element })
  }

  add("/login", "signIn")
  if (intents.forgotPassword) add("/forgot-password", "forgotPassword")
  if (intents.resetPassword) add("/reset-password", "resetPassword")
  if (intents.signUp) add("/signup", "signUp")
  if (intents.setupStatus && intents.completeSetup) add("/setup", "setup")

  return routes
}
```

- [ ] **Step 4: Adjust the test for the defaults parameter**

The test calls `authRoutesFor(minimal, {})` and expects a `/login` route, but with no screen supplied nothing mounts. Give the test a stub default so it exercises the real precedence:

```ts
// add near the top of packages/host/test/auth-routes.test.ts
const Stub = () => null
const defaults = {
  signIn: Stub,
  forgotPassword: Stub,
  resetPassword: Stub,
  signUp: Stub,
  setup: Stub,
}
```

Then replace every `authRoutesFor(X, {})` with `authRoutesFor(X, {}, defaults)`, and the override test with:

```ts
it("prefers an overriding screen over the default", () => {
  const Custom = () => null
  expect(authRoutesFor(minimal, { signIn: Custom }, defaults)[0].element).toBe(Custom)
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/host && npx vitest run test/auth-routes.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/host/src/auth/routes.ts packages/host/test/auth-routes.test.ts
git commit -m "feat(host): derive the auth route table from declared intents"
```

---

### Task 6: The five default screens

**Files:**
- Create: `packages/host/src/auth/screens/sign-in.tsx`
- Create: `packages/host/src/auth/screens/forgot-password.tsx`
- Create: `packages/host/src/auth/screens/reset-password.tsx`
- Create: `packages/host/src/auth/screens/sign-up.tsx`
- Create: `packages/host/src/auth/screens/setup.tsx`
- Create: `packages/host/src/auth/screens/index.ts`
- Test: `packages/host/test/auth-screens.test.tsx`

**Interfaces:**
- Consumes: `AuthScreenProps` (Task 5), `AuthLayout` (Task 4), `AuthConfig`, `LoginResult` (Task 1), `useQuery`, `useCommand` from `@forge-go/dashboard-plugin`.
- Produces: `defaultAuthScreens: Required<AuthScreens>`.

Keep each screen in its own file. They share the layout and nothing else, and one file per screen is what keeps each small enough to change without reading the other four.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/host/test/auth-screens.test.tsx
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { defaultAuthScreens } from "../src/auth/screens"

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  forgotPassword: "auth.forgot",
}

const props = {
  intents,
  basename: "/forge",
  next: "/forge",
  onAuthenticated: vi.fn(),
}

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin",
  )
  return {
    ...actual,
    useQuery: () => ({
      data: { passwordEnabled: true, brand: "Platform" },
      loading: false,
      error: undefined,
      refetch: vi.fn(),
    }),
    useCommand: () => ({
      execute: vi.fn(async () => ({ ok: true })),
      loading: false,
      error: undefined,
    }),
  }
})

function mount(Screen: React.ComponentType<typeof props>) {
  return render(
    <MemoryRouter>
      <Screen {...props} />
    </MemoryRouter>,
  )
}

describe("default auth screens", () => {
  it("sign-in renders an email and password form under the brand", () => {
    mount(defaultAuthScreens.signIn)
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeDefined()
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    expect(screen.getByText("Platform")).toBeDefined()
  })

  it("sign-in links to forgot-password under the basename", () => {
    mount(defaultAuthScreens.signIn)
    expect(
      screen.getByRole("link", { name: /forgot/i }).getAttribute("href"),
    ).toBe("/forge/forgot-password")
  })

  it("forgot-password asks for an email and links back", () => {
    mount(defaultAuthScreens.forgotPassword)
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByRole("link", { name: /back to sign in/i }).getAttribute("href"))
      .toBe("/forge/login")
  })

  it("reset-password asks for a new password twice", () => {
    mount(defaultAuthScreens.resetPassword)
    expect(screen.getByLabelText(/new password/i)).toBeDefined()
    expect(screen.getByLabelText(/confirm/i)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host && npx vitest run test/auth-screens.test.tsx`
Expected: FAIL, cannot find module `../src/auth/screens`.

- [ ] **Step 3: Implement the sign-in screen**

```tsx
// packages/host/src/auth/screens/sign-in.tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig, LoginResult } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Navigate } from "react-router"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import type { AuthScreenProps } from "../routes"

/**
 * Sends a first-run server to /setup instead of a sign-in form nobody can use.
 *
 * Lives here rather than in the host so the host never learns what setup
 * means, and so a host app that replaces this screen opts out of the behaviour
 * cleanly instead of fighting it.
 */
function SetupRedirect({ intents }: { intents: AuthIntents }) {
  const status = useQuery<{ pending: boolean }>(intents.setupStatus ?? "")
  if (status.data?.pending !== true) return null
  return <Navigate replace to="/setup" />
}

export function SignInScreen({ intents, basename, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const login = useCommand<LoginResult>(intents.signIn)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser navigates on submit and the command never
    // finishes. jsdom does not navigate, so a missing preventDefault passes
    // every test here and fails on the first real click.
    event.preventDefault()
    const result = await login.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  // A config that has not answered yet is not an error state. Rendering the
  // form optimistically keeps the first paint useful, and the alert below
  // covers a config that genuinely failed.
  const passwordEnabled = config.data?.passwordEnabled ?? true

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="Welcome back."
      footer={
        <Link className="text-muted-foreground hover:underline" to={`${basename}/forgot-password`}>
          Forgot your password?
        </Link>
      }
      title="Sign in"
    >
      {/*
        A server with no administrator yet has nothing to sign in to, so setup
        outranks this screen. Rendered as a child and not called as a hook
        here, because `intents.setupStatus` is optional and a conditional hook
        is illegal. A provider that never declared it mounts nothing.
      */}
      {intents.setupStatus ? (
        <SetupRedirect intents={intents} />
      ) : null}
      <CommandAlert error={login.error} title="Sign in failed" />
      {passwordEnabled ? (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              autoComplete="username"
              id={emailId}
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              value={email}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId}>Password</Label>
            <Input
              autoComplete="current-password"
              id={passwordId}
              name="password"
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              value={password}
            />
          </div>
          <button className={buttonVariants({ className: "w-full" })} disabled={login.loading} type="submit">
            {login.loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : null}
      {(config.data?.socialProviders ?? []).map((provider) => (
        <a
          className={buttonVariants({ variant: "outline", className: "mt-2 w-full" })}
          href={provider.authStartURL}
          key={provider.id}
        >
          {provider.label}
        </a>
      ))}
    </AuthLayout>
  )
}
```

- [ ] **Step 4: Implement forgot-password**

```tsx
// packages/host/src/auth/screens/forgot-password.tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"

export function ForgotPasswordScreen({ intents, basename }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const request = useCommand<{ ok: boolean }>(intents.forgotPassword ?? "")
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const emailId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await request.execute({ email })
    if (result === undefined) return
    setSent(true)
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="We'll email you a link. It expires in one hour."
      footer={
        <Link className="text-muted-foreground hover:underline" to={`${basename}/login`}>
          Back to sign in
        </Link>
      }
      title="Reset your password"
    >
      <CommandAlert error={request.error} title="Could not send the link" />
      {sent ? (
        // Deliberately the same wording whether or not the address exists.
        // Telling somebody which emails are registered is an account oracle.
        <p className="rounded-md border px-3 py-2 text-sm" role="status">
          If that address has an account, a reset link is on its way.
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              autoComplete="username"
              id={emailId}
              name="email"
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              value={email}
            />
          </div>
          <button className={buttonVariants({ className: "w-full" })} disabled={request.loading} type="submit">
            {request.loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  )
}
```

- [ ] **Step 5: Implement reset-password**

```tsx
// packages/host/src/auth/screens/reset-password.tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useSearchParams } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"

export function ResetPasswordScreen({ intents, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const reset = useCommand<{ ok: boolean }>(intents.resetPassword ?? "")
  const [params] = useSearchParams()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const passwordId = useId()
  const confirmId = useId()

  // This page opens cold, from an email, on a machine that has never held a
  // session. The token is the only thing identifying the account.
  const token = params.get("token") ?? ""
  const mismatch = confirm.length > 0 && password !== confirm

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mismatch) return
    const result = await reset.execute({ token, password })
    if (result === undefined) return
    onAuthenticated()
  }

  if (!token) {
    return (
      <AuthLayout brand={config.data?.brand} title="That link is incomplete">
        <p className="text-muted-foreground text-sm" role="alert">
          This reset link carries no token. Request a new one from the sign-in
          page.
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="Choose a new password to finish signing in."
      title="Choose a new password"
    >
      <CommandAlert error={reset.error} title="Could not reset your password" />
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>New password</Label>
          <Input
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={confirmId}>Confirm password</Label>
          <Input
            autoComplete="new-password"
            id={confirmId}
            name="confirm"
            onChange={(e) => setConfirm(e.target.value)}
            type="password"
            value={confirm}
          />
        </div>
        {mismatch ? (
          <p className="text-destructive text-sm" role="alert">
            Those two passwords do not match.
          </p>
        ) : null}
        <button
          className={buttonVariants({ className: "w-full" })}
          disabled={reset.loading || mismatch}
          type="submit"
        >
          {reset.loading ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </AuthLayout>
  )
}
```

- [ ] **Step 6: Implement sign-up and setup**

```tsx
// packages/host/src/auth/screens/sign-up.tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { Link } from "react-router"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"

export function SignUpScreen({ intents, basename, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const signUp = useCommand<{ ok: boolean }>(intents.signUp ?? "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await signUp.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description={config.data?.signupLabel ?? "Create an account."}
      footer={
        <Link className="text-muted-foreground hover:underline" to={`${basename}/login`}>
          Already have one? Sign in
        </Link>
      }
      title="Create an account"
    >
      <CommandAlert error={signUp.error} title="Could not create the account" />
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            autoComplete="username"
            id={emailId}
            name="email"
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>Password</Label>
          <Input
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </div>
        <button className={buttonVariants({ className: "w-full" })} disabled={signUp.loading} type="submit">
          {signUp.loading ? "Creating…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  )
}
```

```tsx
// packages/host/src/auth/screens/setup.tsx
import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { AuthConfig } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AuthScreenProps } from "../routes"

export function SetupScreen({ intents, onAuthenticated }: AuthScreenProps) {
  const config = useQuery<AuthConfig>(intents.config)
  const complete = useCommand<{ ok: boolean }>(intents.completeSetup ?? "")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await complete.execute({ email, password })
    if (result === undefined) return
    onAuthenticated()
  }

  return (
    <AuthLayout
      brand={config.data?.brand}
      description="This account owns the server until it grants access to others."
      title="Create the first administrator"
    >
      <CommandAlert error={complete.error} title="Setup failed" />
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={emailId}>Email</Label>
          <Input
            autoComplete="username"
            id={emailId}
            name="email"
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            value={email}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={passwordId}>Password</Label>
          <Input
            autoComplete="new-password"
            id={passwordId}
            name="password"
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
        </div>
        <button className={buttonVariants({ className: "w-full" })} disabled={complete.loading} type="submit">
          {complete.loading ? "Creating…" : "Create and continue"}
        </button>
      </form>
    </AuthLayout>
  )
}
```

```ts
// packages/host/src/auth/screens/index.ts
import type { AuthScreens } from "../routes"
import { ForgotPasswordScreen } from "./forgot-password"
import { ResetPasswordScreen } from "./reset-password"
import { SetupScreen } from "./setup"
import { SignInScreen } from "./sign-in"
import { SignUpScreen } from "./sign-up"

/** The screens a dashboard gets when the host app overrides nothing. */
export const defaultAuthScreens: Required<AuthScreens> = {
  signIn: SignInScreen,
  forgotPassword: ForgotPasswordScreen,
  resetPassword: ResetPasswordScreen,
  signUp: SignUpScreen,
  setup: SetupScreen,
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/host && npx vitest run test/auth-screens.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 8: Cover setup precedence, in its own file**

It needs `useQuery` to answer `{ pending: true }`, which the other file's mock
does not, and a module mock cannot vary per test within one file. Its own file
is the cheapest way to get its own mock.

```tsx
// packages/host/test/auth-setup-precedence.test.tsx
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"

vi.mock("@forge-go/dashboard-plugin", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@forge-go/dashboard-plugin",
  )
  return {
    ...actual,
    useQuery: () => ({ data: { pending: true }, loading: false, error: undefined }),
    useCommand: () => ({ execute: vi.fn(), loading: false, error: undefined }),
  }
})

const { defaultAuthScreens } = await import("../src/auth/screens")

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  setupStatus: "auth.setupStatus",
  completeSetup: "auth.setup",
}

describe("setup precedence", () => {
  it("sends a first-run server from login to setup", () => {
    const SignIn = defaultAuthScreens.signIn
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route
            element={
              <SignIn
                basename="/forge"
                intents={intents}
                next="/forge"
                onAuthenticated={vi.fn()}
              />
            }
            path="/login"
          />
          <Route element={<div data-testid="setup" />} path="/setup" />
        </Routes>
      </MemoryRouter>,
    )
    // Navigate renders nothing itself, so the assertion is that the router
    // landed on the setup route.
    expect(screen.getByTestId("setup")).toBeDefined()
  })
})
```

Run: `cd packages/host && npx vitest run test/auth-setup-precedence.test.tsx`
Expected: PASS, 1 test.

A provider that never declares `setupStatus` must not mount `SetupRedirect` at
all. That path is already covered by the sign-in test in the other file, whose
intents omit it.

- [ ] **Step 9: Commit**

```bash
git add packages/host/src/auth/screens packages/host/test/auth-screens.test.tsx packages/host/test/auth-setup-precedence.test.tsx
git commit -m "feat(host): add the five default auth screens"
```

---

### Task 7: Wire the routes and redirects into PluginHost

**Files:**
- Create: `packages/host/src/auth/AuthRoutes.tsx`
- Modify: `packages/host/src/host/PluginHost.tsx` (the `signedOut`/`denied` branch, currently around lines 694 to 746)
- Test: `packages/host/test/auth-redirects.test.tsx`

**Interfaces:**
- Consumes: `authRoutesFor`, `isAuthPath`, `AuthScreens` (Task 5), `defaultAuthScreens` (Task 6), `safeNext` (Task 3).
- Produces: `AuthRoutes`, and `PluginHostProps.authScreens?: AuthScreens`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/host/test/auth-redirects.test.tsx
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { describe, expect, it, vi } from "vitest"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { AuthRoutes } from "../src/auth/AuthRoutes"

const intents: AuthIntents = {
  config: "auth.config",
  signIn: "auth.login",
  resetPassword: "auth.reset",
}

const screens = {
  signIn: () => <div data-testid="sign-in" />,
  resetPassword: () => <div data-testid="reset" />,
}

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthRoutes
        basename="/forge"
        intents={intents}
        onAuthenticated={vi.fn()}
        screens={screens}
      />
    </MemoryRouter>,
  )
}

describe("AuthRoutes", () => {
  it("rule 1: renders the screen for a mounted auth path", () => {
    at("/forge/login")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })

  it("rule 1: serves a cold reset deep link", () => {
    // The case the old gate could not serve, and the reason this exists.
    at("/forge/reset-password?token=abc")
    expect(screen.getByTestId("reset")).toBeDefined()
  })

  it("rule 2: sends any other path to login", () => {
    at("/forge/apps")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })

  it("rule 2: an unmounted auth path falls back to login", () => {
    at("/forge/signup")
    expect(screen.getByTestId("sign-in")).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/host && npx vitest run test/auth-redirects.test.tsx`
Expected: FAIL, cannot find module `../src/auth/AuthRoutes`.

- [ ] **Step 3: Implement AuthRoutes**

```tsx
// packages/host/src/auth/AuthRoutes.tsx
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { authRoutesFor } from "./routes"
import type { AuthScreens } from "./routes"
import { defaultAuthScreens } from "./screens"
import { safeNext } from "./next-param"

export interface AuthRoutesProps {
  intents: AuthIntents
  basename: string
  screens?: AuthScreens
  onAuthenticated: () => void
}

/**
 * Every screen a signed-out visitor can reach, and the rule that catches
 * everything else.
 *
 * Mounted outside HostShell, so there is no sidebar and no header here. The
 * catch-all carries the attempted path forward as `next`, which is what puts
 * somebody back where they were headed once they sign in.
 */
export function AuthRoutes({
  intents,
  basename,
  screens = {},
  onAuthenticated,
}: AuthRoutesProps) {
  const location = useLocation()
  const [params] = useSearchParams()
  const routes = authRoutesFor(intents, screens, defaultAuthScreens)

  // Two different values, and conflating them is the easy bug. `attempted` is
  // where this visitor was heading when they got bounced, and it only means
  // anything on the catch-all below. `next` is what a screen navigates to
  // after signing in, and it comes off the query string the catch-all wrote.
  // Compute `next` from the current location and standing on /login gives you
  // /login.
  const attempted = safeNext(`${location.pathname}${location.search}`, "/")
  const next = safeNext(params.get("next"), "/")

  return (
    <Routes>
      {routes.map(({ path, element: Screen }) => (
        <Route
          element={
            <Screen
              basename={basename}
              intents={intents}
              next={next}
              onAuthenticated={onAuthenticated}
            />
          }
          key={path}
          path={path}
        />
      ))}
      <Route
        element={
          <Navigate replace to={`/login?next=${encodeURIComponent(attempted)}`} />
        }
        path="*"
      />
    </Routes>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/host && npx vitest run test/auth-redirects.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Implement rule 3, the signed-in visitor still on an auth URL**

Sign-in flips the session to `signedIn` while the browser is still sitting on
`/login`. Without this the shell renders at a path no plugin route matches and
you get a blank panel instead of the dashboard. This is the only consumer of
`isAuthPath`, so if it is unused at the end of this task, rule 3 is missing.

Add to `packages/host/test/auth-redirects.test.tsx`:

```tsx
import { SignedInRedirect } from "../src/auth/AuthRoutes"

describe("rule 3: signed in, still on an auth path", () => {
  it("returns to the path that was attempted", () => {
    render(
      <MemoryRouter initialEntries={["/login?next=%2Fapps"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="apps" />} path="/apps" />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId("apps")).toBeDefined()
  })

  it("falls back to the dashboard root when next is missing", () => {
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="root" />} path="/" />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId("root")).toBeDefined()
  })

  it("refuses an off-site next", () => {
    render(
      <MemoryRouter initialEntries={["/login?next=%2F%2Fevil.example.com"]}>
        <Routes>
          <Route element={<SignedInRedirect basename="" />} path="/login" />
          <Route element={<div data-testid="root" />} path="/" />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId("root")).toBeDefined()
  })
})
```

Add to `packages/host/src/auth/AuthRoutes.tsx`:

```tsx
/**
 * Sends a signed-in visitor off an auth URL and back where they were headed.
 *
 * Rendered by PluginHost before the shell, because signing in does not change
 * the address bar: the session flips to signedIn while the browser is still on
 * /login, and the shell has no route for that.
 */
export function SignedInRedirect({ basename }: { basename: string }) {
  const [params] = useSearchParams()
  return <Navigate replace to={safeNext(params.get("next"), "/")} />
}
```

Run: `cd packages/host && npx vitest run test/auth-redirects.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Replace the gate branch in PluginHost**

First add two fields to `PluginHostProps`, because neither is there today:

```ts
  /**
   * The router's mount prefix, for building links inside the auth screens.
   * ForgeDashboard already takes this and hands it to BrowserRouter; the auth
   * screens need it too, so it has to come down here as well.
   */
  basename?: string
  /** Replaces any of the built-in auth screens. Supplied by the host app. */
  authScreens?: AuthScreens
```

Destructure both in the component signature, and pass `basename` from
`ForgeDashboard` alongside the one it already gives `BrowserRouter`.

PluginHost already does `const { pathname, search } = useLocation()` near the
top. Reuse `pathname`; do not add a second `useLocation()` call and do not
introduce a `location` binding, because there isn't one.

Import `isAuthPath` and `SignedInRedirect` from `../auth`, then replace the
whole `if (session.state.status === "signedOut" || session.state.status === "denied")`
block with the following.

```tsx
  // Rule 3, and it has to come before the shell. `pathname` is the one
  // PluginHost already destructures from useLocation at the top of the
  // component, and inside a BrowserRouter it is already basename-relative,
  // which is why isAuthPath gets "" and not basename.
  if (session.state.status === "signedIn" && isAuthPath(pathname, "")) {
    return <SignedInRedirect basename={basename ?? ""} />
  }

  if (session.state.status === "signedOut") {
    const provider = resolveAuthProvider(plugins)

    // No provider at all is a wiring mistake, not a sign-in screen. Say so
    // plainly instead of rendering a form with nothing behind it.
    if (!provider?.auth) {
      return <FallbackAuthGate reason="no-provider" />
    }

    return (
      <PluginErrorBoundary
        fallback={<FallbackAuthGate reason="screen-failed" />}
        key={provider.extension}
        plugin={provider.extension}
      >
        <PluginProvider client={clients.get(provider.extension)!}>
          <AuthRoutes
            basename={basename ?? ""}
            intents={provider.auth.intents}
            onAuthenticated={session.refresh}
            screens={authScreens}
          />
        </PluginProvider>
      </PluginErrorBoundary>
    )
  }

  // Signed in as the wrong person. Not a sign-in flow and not a route: what
  // this visitor needs is a way out of the account they are already in.
  if (session.state.status === "denied") {
    const provider = resolveAuthProvider(plugins)
    return (
      <DeniedScreen
        onSignedOut={session.refresh}
        requiredRoles={session.state.requiredRoles}
        signOutIntent={provider?.auth?.intents.signOut}
      />
    )
  }
```

- [ ] **Step 7: Narrow FallbackAuthGate first, so this task typechecks**

Step 6 calls `FallbackAuthGate` with a `reason`, and today it takes
`loginPath`, `requiredRoles` and `onAuthenticated`. Change it here, not later,
or this task ends red.

Write `packages/runtime/test/fallbacks.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { FallbackAuthGate } from "../src/fallbacks"

describe("FallbackAuthGate", () => {
  it("names the wiring mistake when no plugin declares auth", () => {
    render(<FallbackAuthGate reason="no-provider" />)
    expect(screen.getByRole("alert").textContent).toMatch(/no plugin declares auth/i)
  })

  it("says the screen failed when an auth screen threw", () => {
    render(<FallbackAuthGate reason="screen-failed" />)
    expect(screen.getByRole("alert").textContent).toMatch(/failed to render/i)
  })
})
```

Run it and watch it fail on the unknown `reason` prop, then replace
`FallbackAuthGate` in `packages/runtime/src/fallbacks.tsx` with:

```tsx
/**
 * What renders when the dashboard cannot show a sign-in screen at all.
 *
 * Both cases are wiring mistakes and not states a visitor can act on, so this
 * says what is wrong and offers nothing to click. It imports from neither the
 * kit nor any plugin on purpose: it has to be the thing that still renders
 * when the styled one did not.
 */
export function FallbackAuthGate({
  reason,
}: {
  reason: "no-provider" | "screen-failed"
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3 rounded-md border p-6 text-sm">
      <p className="font-medium" role="alert">
        {reason === "no-provider"
          ? "This dashboard cannot sign anybody in: no plugin declares auth."
          : "The sign-in screen failed to render."}
      </p>
      <p className="text-muted-foreground">
        {reason === "no-provider"
          ? "Add an auth provider to the plugins array, or turn authEnabled off."
          : "Check the browser console for the error the screen threw."}
      </p>
    </div>
  )
}
```

Run: `cd packages/runtime && npx vitest run && npx tsc --noEmit && npx eslint`
Expected: all pass, 2 new tests.

- [ ] **Step 8: Implement DeniedScreen**

```tsx
// packages/host/src/auth/screens/denied.tsx
import { useCommand } from "@forge-go/dashboard-plugin"
import type { LogoutResult } from "@forge-go/dashboard-plugin"
import { AuthLayout } from "@forge-go/dashboard-kit/components/auth-layout"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

export interface DeniedScreenProps {
  requiredRoles?: string[]
  signOutIntent?: string
  onSignedOut: () => void
}

export function DeniedScreen({
  requiredRoles,
  signOutIntent,
  onSignedOut,
}: DeniedScreenProps) {
  const logout = useCommand<LogoutResult>(signOutIntent ?? "")

  async function handleSignOut() {
    const result = await logout.execute()
    if (result === undefined) return
    onSignedOut()
  }

  return (
    <AuthLayout
      description="You are signed in, but not with an account this dashboard accepts."
      title="You do not have access"
    >
      <CommandAlert error={logout.error} title="Sign out failed" />
      {requiredRoles?.length ? (
        <p className="rounded-md border px-3 py-2 text-sm">
          It needs one of these roles: {requiredRoles.join(", ")}.
        </p>
      ) : null}
      {signOutIntent ? (
        <button
          className={buttonVariants({ variant: "outline", className: "mt-4 w-full" })}
          disabled={logout.loading}
          onClick={handleSignOut}
          type="button"
        >
          {logout.loading ? "Signing out…" : "Sign out"}
        </button>
      ) : null}
      <p className="mt-4 text-center text-muted-foreground text-sm">
        Or ask whoever manages this dashboard to grant you access.
      </p>
    </AuthLayout>
  )
}
```

Export it from `packages/host/src/auth/screens/index.ts`:

```ts
export { DeniedScreen } from "./denied"
```

- [ ] **Step 9: Run the host suite**

Run: `cd packages/host && npx vitest run`
Expected: the new files pass. Existing tests referencing the old gate fail and are updated in Task 9.

- [ ] **Step 10: Commit**

```bash
git add packages/host/src/auth packages/host/src/host/PluginHost.tsx packages/host/test/auth-redirects.test.tsx packages/runtime
git commit -m "feat(host): route signed-out visitors instead of swapping the shell"
```

---

### Task 8: Expose authScreens on ForgeDashboard

`FallbackAuthGate` was already narrowed in Task 7, because Task 7 could not
typecheck without it. This task is only the public surface.

**Files:**
- Modify: `packages/host/src/ForgeDashboard.tsx`
- Modify: `packages/host/src/index.tsx`
- Modify: `packages/host/src/auth/index.ts`
- Test: `packages/host/test/forge-dashboard.test.tsx`

**Interfaces:**
- Consumes: `AuthScreens` from Task 5.
- Produces: `ForgeDashboardProps.authScreens?: AuthScreens`, re-exported from the package root.

- [ ] **Step 1: Thread authScreens through ForgeDashboard**

In `packages/host/src/ForgeDashboard.tsx`, add to `ForgeDashboardProps`:

```ts
  /**
   * Replaces any of the built-in auth screens, independently. A host app
   * supplies these, never a plugin: an application choosing its own sign-in
   * page is ordinary, a plugin forcing one on every dashboard is not.
   */
  authScreens?: AuthScreens
```

Destructure `authScreens` and pass it to `<PluginHost authScreens={authScreens} ... />`. Import the type from `./auth/routes`.

In `packages/host/src/index.tsx`, add:

```ts
export type { AuthScreens, AuthScreenProps } from "./auth/routes"
export { defaultAuthScreens } from "./auth/screens"
```

- [ ] **Step 2: Add a barrel for the auth module**

```ts
// packages/host/src/auth/index.ts
export { AuthRoutes, SignedInRedirect } from "./AuthRoutes"
export { authRoutesFor, AUTH_PATHS, isAuthPath } from "./routes"
export type { AuthRoute, AuthScreenProps, AuthScreens } from "./routes"
export { safeNext } from "./next-param"
export { defaultAuthScreens, DeniedScreen } from "./screens"
```

- [ ] **Step 3: Run the gates**

Run: `cd packages/host && npx vitest run && npx tsc --noEmit && npx eslint`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/host/src
git commit -m "feat(host): expose authScreens on ForgeDashboard"
```

---

### Task 9: Strip the UI out of plugin-authsome

**Files:**
- Delete: `packages/plugin-authsome/src/gate.tsx`
- Delete: `packages/plugin-authsome/src/pages/login.tsx`
- Modify: `packages/plugin-authsome/src/index.tsx`
- Modify: any authsome file importing `AuthConfig`, `LoginResult` or `LogoutResult` from `./pages/login`
- Modify: `packages/host/test/host.test.tsx` and any other host test constructing `auth: { gate }`
- Test: `packages/plugin-authsome/test/auth-intents.test.ts`

**Interfaces:**
- Consumes: `AuthIntents` (Task 2).
- Produces: `authsomePlugin.auth.intents`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/plugin-authsome/test/auth-intents.test.ts
import { describe, expect, it } from "vitest"
import authsomePlugin from "../src/index"

describe("the authsome plugin's auth declaration", () => {
  it("declares intents and ships no component", () => {
    expect(authsomePlugin.auth?.intents).toEqual({
      config: "auth.config",
      signIn: "auth.login",
      signOut: "auth.logout",
      forgotPassword: "auth.forgotPassword",
      resetPassword: "auth.resetPassword",
      signUp: "auth.signup",
      setupStatus: "auth.setupStatus",
      completeSetup: "auth.setup",
    })
    expect("gate" in (authsomePlugin.auth ?? {})).toBe(false)
  })

  it("still declares no /login route, because the host owns that now", () => {
    expect(authsomePlugin.routes.map((r) => r.path)).not.toContain("/login")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/plugin-authsome && npx vitest run test/auth-intents.test.ts`
Expected: FAIL, `auth.intents` is undefined.

- [ ] **Step 3: Replace the declaration**

In `packages/plugin-authsome/src/index.tsx`, remove the `AuthGate` and `AuthLoginPage` imports and replace `auth: { gate: AuthGate, signOutIntent: "auth.logout" }` with:

```tsx
  auth: {
    intents: {
      config: "auth.config",
      signIn: "auth.login",
      signOut: "auth.logout",
      forgotPassword: "auth.forgotPassword",
      resetPassword: "auth.resetPassword",
      signUp: "auth.signup",
      setupStatus: "auth.setupStatus",
      completeSetup: "auth.setup",
    },
  },
```

Update the doc comment above `authsomePlugin` that explains `/login` staying out of `routes`. The reason changes: it is not that sign-in is not a page, it is that the host owns that page now.

- [ ] **Step 4: Delete the UI and repoint the types**

```bash
git rm packages/plugin-authsome/src/gate.tsx packages/plugin-authsome/src/pages/login.tsx
```

Then run `cd packages/plugin-authsome && npx tsc --noEmit` and repoint every import of `AuthConfig`, `SocialProvider`, `LoginResult` or `LogoutResult` from `./pages/login` to `@forge-go/dashboard-plugin`. Delete any authsome test covering the deleted files.

- [ ] **Step 5: Fix the host tests that built a gate**

Run `cd packages/host && npx vitest run` and update every fixture using `auth: { gate: X, signOutIntent: "y" }` to `auth: { intents: { config: "auth.config", signIn: "auth.login", signOut: "y" } }`. A test asserting the gate replaced the shell now asserts the sign-in screen renders at `/login`.

- [ ] **Step 6: Run everything**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo test typecheck lint`
Expected: all packages pass.

- [ ] **Step 7: Commit**

```bash
git add -A packages/plugin-authsome packages/host/test
git commit -m "refactor(authsome)!: declare auth intents and drop the gate UI"
```

---

### Task 10: authScreens in defineForgeDashboard

**Files:**
- Modify: `packages/next/src/define.ts`
- Modify: `packages/next/src/page.tsx`
- Test: `packages/next/test/define.test.ts`

**Interfaces:**
- Consumes: `AuthScreens` from `@forge-go/dashboard-host`.
- Produces: `ForgeDashboardOptions.authScreens`, carried onto `ForgeDashboard.authScreens`.

- [ ] **Step 1: Write the failing test**

Append to `packages/next/test/define.test.ts`:

```ts
describe("authScreens", () => {
  it("carries an override through to the result", () => {
    const Custom = () => null
    const forge = defineForgeDashboard({
      mountPath: "/forge",
      plugins: [],
      authScreens: { signIn: Custom },
    })
    expect(forge.authScreens?.signIn).toBe(Custom)
  })

  it("is undefined when nothing is passed, so the defaults apply", () => {
    expect(defineForgeDashboard({ mountPath: "/forge", plugins: [] }).authScreens)
      .toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/next && npx vitest run test/define.test.ts`
Expected: FAIL, `authScreens` is not a known property.

- [ ] **Step 3: Implement**

Add `@forge-go/dashboard-host` to `peerDependencies` and `devDependencies` (`workspace:*`) in `packages/next/package.json` if it is not already there, then in `define.ts`:

```ts
import type { AuthScreens } from "@forge-go/dashboard-host"
```

Add to `ForgeDashboardOptions`:

```ts
  /**
   * Replaces any of the built-in auth screens, independently. Name three and
   * the other two stay default.
   *
   * This belongs to the host app and never to a plugin. An application
   * choosing what its own sign-in page looks like is ordinary; a plugin
   * forcing one on every dashboard that installs it is the thing the rule
   * against plugin UI exists to stop.
   */
  authScreens?: AuthScreens
```

Add `authScreens?: AuthScreens` to `ForgeDashboard`, and return `authScreens: options.authScreens` from `defineForgeDashboard`. In `page.tsx`, pass `authScreens={forge.authScreens}` to the host.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/next && npx vitest run`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/next
git commit -m "feat(next): let a host app override the auth screens"
```

---

### Task 11: Prove the deep link end to end

The case that justified the whole change gets its own test against the real host, not a unit.

**Files:**
- Test: `packages/host/test/auth-deep-link.test.tsx`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the test**

```tsx
// packages/host/test/auth-deep-link.test.tsx
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ForgeDashboard } from "../src/ForgeDashboard"
import type { ForgePlugin } from "@forge-go/dashboard-plugin"

const authPlugin = {
  extension: "auth",
  namespace: "auth",
  label: "Auth",
  nav: [],
  routes: [],
  context: [],
  auth: {
    intents: {
      config: "auth.config",
      signIn: "auth.login",
      resetPassword: "auth.resetPassword",
    },
  },
} as unknown as ForgePlugin

function contractStub() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as Request).url
    if (url.endsWith("/principal")) {
      return Promise.resolve(Response.json({ authenticated: false }))
    }
    if (url.endsWith("/capabilities")) {
      return Promise.resolve(Response.json({ contributors: [] }))
    }
    return Promise.resolve(Response.json({ ok: true, data: { passwordEnabled: true } }))
  }) as unknown as typeof fetch
}

describe("a cold password-reset deep link", () => {
  it("renders the reset screen for a visitor with no session", async () => {
    window.history.replaceState({}, "", "/forge/reset-password?token=abc")

    render(
      <ForgeDashboard
        basename="/forge"
        config={{ basePath: "/api/forge", shellBase: "/forge", authEnabled: true }}
        fetchImpl={contractStub()}
        plugins={[authPlugin]}
      />,
    )

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /choose a new password/i })).toBeDefined(),
    )
    // Not bounced to sign-in, which is what the old gate did with this URL.
    expect(screen.queryByRole("heading", { name: /^sign in$/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `cd packages/host && npx vitest run test/auth-deep-link.test.tsx`
Expected: PASS. If the reset screen does not appear, check that `session.state.status` reaches `signedOut` and that `authEnabled: true` is set, because `seed()` returns `anonymous` without it.

- [ ] **Step 3: Run every gate in the repo**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo test typecheck lint build`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/host/test/auth-deep-link.test.tsx
git commit -m "test(host): cover the cold reset deep link"
```

---

### Task 12: Update the example app and the README

**Files:**
- Modify: `apps/example-next/forge.config.ts`
- Modify: `README.md`
- Modify: `apps/example-next/app/globals.css`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Confirm the example still builds**

Run: `cd apps/example-next && rm -rf .next tsconfig.tsbuildinfo && npx tsc --noEmit`
Expected: PASS. `forge.config.ts` needs no change, because `authScreens` is optional.

- [ ] **Step 2: Document the override in the README**

In the "How a plugin works" section of `README.md`, add a subsection covering: auth plugins declare intents and never components, the host owns `/login` and the other four paths, and a host app overrides screens through `authScreens`. Show the `defineForgeDashboard` call from the spec. No em dashes.

- [ ] **Step 3: Check the Tailwind sources**

`apps/example-next/app/globals.css` lists a `@source` per package that renders Tailwind markup. `packages/host/src` is already listed, so the new screens are covered. Confirm with `grep -n '@source' apps/example-next/app/globals.css` and add the line only if host is missing.

- [ ] **Step 4: Run every gate**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && npx turbo test typecheck lint build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/example-next
git commit -m "docs: cover host-owned auth routes and screen overrides"
```

---

## Follow-up, not in this plan

Wiring `twinos-app` to pass `@authsome/ui-components` into `authScreens` is a separate change in a separate repository, and it depends on Task 10 landing first. Those components submit through `useAuth()` to Authsome's REST API rather than through a Forge intent, so that work also has to decide which origin `AuthProvider` points at.

The shared session stays out of scope for the reason the spec gives: the host already skips every screen here when `/principal` answers `authenticated: true`, and making that happen is a Go-side decision about which audience the dashboard trusts.
