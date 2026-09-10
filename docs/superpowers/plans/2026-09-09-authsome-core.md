# Authsome core plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the authsome plugin from three pages against nine intents to twenty-three routes covering the sixty intents that remain once the auth gate takes sign-in, so `authsome/dashboard` can be deleted rather than maintained alongside it.

**Architecture:** Every page reads through `useQuery` inside kit's `QueryBoundary`, lists render through kit's `ResourceTable`, and every write goes through `useCommand` with invalidation coming off the server's `meta.invalidates`. The app and environment switchers are declared as context dimensions, so no page threads an app id through a query: the server resolves it from a cookie. Detail pages read their id from `params`, supplied by the host.

**Tech Stack:** React 19, TypeScript, vitest + @testing-library/react, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-08-authsome-core-design.md`

**Also read before starting:**
- `docs/superpowers/specs/2026-09-08-platform-decisions.md`, what changed while the platform was built and what it means for a consuming page
- `docs/superpowers/plans/2026-09-08-kit-blocks-consumer-notes.md`, the obligations the kit blocks put on a page

**Depends on:** Task 0 of `docs/superpowers/plans/2026-09-09-streaming.md`, which gives a page its route params. Eight routes here need it. Do not start Task 3 until it has landed.

## Global Constraints

- `extension` is `"auth"`. Not "authsome", which is the app slug and the repository name, and not the npm package name. It is the Go contributor name from `extension/contract/manifest.yaml` and it is the join key the host looks up. Get it wrong and every page here resolves to `hidden`, silently.
- No dependency may be added to `packages/plugin-authsome/package.json`.
- Sign-in does NOT live here. The auth-gate workstream owns `/login`, `/signup`, `/forgot-password`, `/reset-password` and `/setup`, and the eight intents behind them: `auth.login`, `auth.logout`, `auth.config`, `auth.signup`, `auth.forgotPassword`, `auth.resetPassword`, `auth.setupStatus`, `auth.setup`. If you find `AuthLoginPage` still in this package, leave it alone and say so; removing it is that workstream's call, not this plan's.
- Every destructive `ConfirmDialog` MUST receive `pending`. Ban, unban, delete, revoke, bulk revoke, role delete, app delete, environment delete, webhook delete, device delete. Without it a double-click sends the command twice.
- Never call `refetch()` to reflect a write. Every command in this contract declares `invalidates` and the store acts on it.
- **Optional-field updates use pointer semantics.** `users.update`, `roles.update`, `apps.update`, `environments.update` and `webhooks.update` all declare their optional fields as Go pointers precisely so "leave unchanged" is distinguishable from "set to empty". A field the operator did not touch must be ABSENT from the payload, not sent as `""`. Send an empty string for a name you did not edit and you rename the app to nothing.
- Timestamps are RFC 3339 strings, and authsome sends `""` for "never happened" (for example `banExpiresAt` on a user who is not banned). Format them with kit's `formatTimestamp`, which prints an en dash for empty and prints an unparseable value as it arrived rather than as "Invalid Date".
- Do NOT wrap kit's `SettingsForm` in a `<form>`. Its blank-numeric guard lives on the Save button's disabled state and a form gives you a submit-on-Enter path straight past it.
- Tests live in `packages/plugin-authsome/test/` and run with `pnpm --filter @forge-go/dashboard-plugin-authsome test`. The harness already resets `queryStore` in a `beforeEach`; leave it.

## What the server actually offers

Sixty intents after the gate takes its eight. Wire shapes are from `authsome/extension/contract/handlers_*.go`.

**Paging is not uniform, and only one list has it.** `users.list` is cursor-paged: it takes `{ email, cursor, limit }` and answers `{ users, nextCursor, total }`. `sessions.list` and `devices.list` take a `limit` and no cursor, so they are top-N lists. Everything else returns its whole collection. Kit's `ResourceTable` has page-number pagination, which cannot express a cursor, so do not try to force one into the other: only `/users` gets a pager, and it is a cursor pager built in Task 1.

```ts
// users
interface UserSummary {
  id: string; email: string; emailVerified: boolean
  firstName?: string; lastName?: string; username?: string
  banned: boolean; createdAt: string
}
// UserDetail embeds UserSummary in Go, so its JSON is flat
interface UserDetail extends UserSummary {
  displayName?: string; phone?: string; phoneVerified?: boolean; image?: string
  banReason?: string; banExpiresAt?: string; passwordChangedAt?: string
  updatedAt: string; appId?: string; envId?: string
}
// users.list({ email?, cursor?, limit? }) -> { users, nextCursor?, total? }
// users.detail({ id }) -> UserDetail
// users.create({ email, password, firstName?, lastName?, username? })
// users.update({ id, firstName?, lastName?, username?, emailVerified? })  POINTERS
// users.ban({ id, reason?, expiresAt? })   users.unban({ id })   users.delete({ id })

// sessions
interface SessionSummary {
  id: string; userId: string; ipAddress?: string; userAgent?: string
  lastActivityAt?: string; expiresAt: string; createdAt: string
}
interface SessionDetail extends SessionSummary {
  appId?: string; envId?: string; orgId?: string; deviceId?: string
  impersonatedBy?: string; refreshTokenExpiresAt?: string
  principalKind?: string; updatedAt?: string
}
// sessions.list({ userId?, limit? }) -> { sessions }
// sessions.detail({ id })  sessions.revoke({ id })  sessions.bulkRevoke({ userId })

// devices
interface DeviceSummary {
  id: string; userId: string; name?: string; type?: string; browser?: string
  os?: string; ipAddress?: string; trusted: boolean
  lastSeenAt: string; createdAt: string
}
// devices.list({ userId?, limit? }) -> { devices }
// devices.detail({ id })  devices.trust({ id })  devices.delete({ id })

// roles
interface RoleSummary { id: string; name: string; slug: string; description?: string; createdAt: string }
interface PermissionRecord { id: string; action: string; resource: string }
interface RoleDetail extends RoleSummary {
  appId?: string; envId?: string; parentId?: string
  permissions?: PermissionRecord[]; updatedAt: string
}
// roles.list -> { roles }   roles.detail({ id })
// roles.create({ name, slug, description? })   roles.update({ id, name?, description? })  POINTERS
// roles.delete({ id })   roles.assign({ ... })   roles.unassign({ ... })

// apps
interface AppSummary { id: string; name: string; slug: string; isPlatform: boolean; createdAt: string }
interface AppDetail extends AppSummary {
  logo?: string; publishableKey?: string; metadata?: Record<string, string>; updatedAt: string
}
// apps.list -> { apps }   apps.detail({ id })   apps.create({ name, slug, logo? })
// apps.update({ id, name?, slug?, logo? })  POINTERS   apps.delete({ id })

// environments
interface EnvSummary { id: string; name: string; slug: string; type: string; isDefault: boolean; createdAt: string }
interface EnvDetail extends EnvSummary {
  appId?: string; color?: string; description?: string; clonedFrom?: string
  metadata?: Record<string, string>; updatedAt: string
}
// environments.list -> { environments }   environments.detail({ id })
// environments.create({ name, slug, type?, description?, color? })
// environments.update({ id, name?, description?, color? })  POINTERS
// environments.delete({ id })   environments.clone({ ... })   environments.setDefault({ ... })

// webhooks
interface WebhookSummary { id: string; url: string; events: string[]; active: boolean; createdAt: string }
interface WebhookDetail extends WebhookSummary { appId?: string; envId?: string; updatedAt: string }
// webhooks.list -> { webhooks }   webhooks.detail({ id })
// webhooks.create({ url, events })   webhooks.update({ id, url?, events?, active? })  POINTERS
// webhooks.delete({ id })

// signup forms
interface SelectOption { label: string; value: string }
interface FormField {
  key: string; label: string; type: string; placeholder?: string
  description?: string; options?: SelectOption[]; default?: string
  validation?: Record<string, unknown>; order: number
}
interface FormConfigSummary { id: string; formType: string; version: number; active: boolean; createdAt: string }
// formConfigs.list -> { formConfigs }
// formConfigs.signup -> { appId?, fields, updatedAt }
// formConfigs.saveSignup({ fields, active })   formConfigs.deleteSignup({ ... })

// settings
interface NamespaceSummary { name: string; displayName?: string; description?: string; settingCount: number }
// settings.namespaces -> { namespaces, context: { appId?, orgId?, userId? } }
// settings.namespace({ namespace, scope, appId?, orgId?, userId? })
//   -> { namespace, displayName?, scope, categories: SettingCategory[] }
// NOT a flat `fields` array. The server groups. See Task 8.
interface SettingCategory { name: string; settings: SettingField[] }
interface SettingOption { label: string; value: string }
interface SettingValidation { required?: boolean; min?: number; max?: number; minLen?: number; maxLen?: number; pattern?: string }
interface SettingField {
  key: string; displayName: string; description?: string; type: string; inputType?: string
  default?: unknown; effectiveValue?: unknown
  isOverridden: boolean; isEnforced: boolean; canOverride: boolean
  readOnly?: boolean; sensitive?: boolean; placeholder?: string; helpText?: string
  options?: SettingOption[]; validation?: SettingValidation; order: number
  section?: string; scopes?: string[]
}
// settings.update({ key, value, scope?, appId?, orgId?, userId? })
// settings.enforce({ key, value, scope, ... })   settings.unenforce({ key, scope, ... })

// overview, credentials, features, context
interface OverviewStats { users: number; sessions: number; devices: number; plugins: number }
// overview.stats -> OverviewStats   overview.recentSignups({ limit? }) -> { users: UserSummary[] }
interface CredentialsDetail {
  appId: string; appName: string; appSlug: string; publishableKey?: string
  envId?: string; envName?: string; envSlug?: string; isPlatform: boolean
}
// credentials.detail -> CredentialsDetail
interface FeatureToggle { key: string; label: string; description?: string; enabled: boolean; available: boolean }
// auth.featureToggles -> { toggles }   auth.toggleFeature({ key, enabled })
interface SwitcherApp { id: string; name: string; slug: string; logo?: string; isPlatform: boolean }
interface SwitcherEnv { id: string; name: string; slug: string; type?: string; isDefault: boolean }
// apps.context -> { currentApp?, currentEnv?, availableApps, availableEnvs }
// apps.switch({ appId })   environments.switch({ envId })

// every mutating command answers
interface AckResponse { ok: boolean; id?: string }
```

**One field-name trap.** `sessions.list` and `devices.list` take `userId` (lower-case d) while streaming's contract uses `userID`. These are different services. Copy from the shapes above, not from the streaming plugin.

---

### Task 1: Foundation, a command-capable harness, and a cursor pager

**Files:**
- Delete: `packages/plugin-authsome/src/components/query-view.tsx`
- Create: `packages/plugin-authsome/src/components/cursor-pager.tsx`
- Modify: `packages/plugin-authsome/src/pages/users.tsx`
- Modify: `packages/plugin-authsome/src/pages/sessions.tsx`
- Modify: `packages/plugin-authsome/test/harness.tsx`
- Test: `packages/plugin-authsome/test/cursor-pager.test.tsx` (create)

**Interfaces:**
- Produces:
  - `CursorPager({ nextCursor, total, shown, onNext, onPrevious, canGoBack })`
  - `useCursorStack()` returning `{ cursor, canGoBack, next, previous, reset }`
  - A `stubClient(answers, commands?)` harness that can answer commands
  - `recordingCommandClient(answers, commands?)` returning `{ client, sent }`

Do this first. Every later task builds on these, and the cursor pager is the one piece of UI this contract needs that the kit does not provide.

**Why a cursor pager rather than kit's pagination.** `users.list` answers `{ users, nextCursor, total }` and takes `{ cursor, limit }`. There is no page number anywhere in that, and there cannot be: a cursor names a position in a result set, so "jump to page 7" is not a question it can answer. Kit's `ResourceTable` takes `{ page, pageSize, total }`, which would force a lie. So `ResourceTable`'s `pagination` prop stays unused on this page and the pager renders below the table.

Going backwards needs a stack. The server tells you the cursor for the NEXT page and nothing about the previous one, so the only way back is to remember the cursors you have already used.

- [ ] **Step 1: Write the failing test for the pager**

```tsx
// packages/plugin-authsome/test/cursor-pager.test.tsx
import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react"
import { CursorPager, useCursorStack } from "../src/components/cursor-pager"

describe("useCursorStack", () => {
  it("starts at the beginning with no way back", () => {
    const { result } = renderHook(() => useCursorStack())
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })

  it("walks forward and back through the cursors it was given", () => {
    const { result } = renderHook(() => useCursorStack())

    act(() => result.current.next("c1"))
    expect(result.current.cursor).toBe("c1")
    expect(result.current.canGoBack).toBe(true)

    act(() => result.current.next("c2"))
    expect(result.current.cursor).toBe("c2")

    act(() => result.current.previous())
    expect(result.current.cursor).toBe("c1")

    act(() => result.current.previous())
    // Back at the start, which is `undefined` rather than a cursor: the first
    // page is the one you get by sending no cursor at all.
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })

  it("resets to the first page, which is what a new search has to do", () => {
    const { result } = renderHook(() => useCursorStack())
    act(() => result.current.next("c1"))
    act(() => result.current.next("c2"))
    act(() => result.current.reset())
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.canGoBack).toBe(false)
  })
})

describe("CursorPager", () => {
  it("renders nothing when there is one page and no way back", () => {
    const { container } = render(
      <CursorPager shown={3} total={3} onNext={() => {}} onPrevious={() => {}} canGoBack={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("offers Next only while the server says there is more", () => {
    const onNext = vi.fn()
    render(
      <CursorPager
        shown={25}
        total={100}
        nextCursor="c1"
        onNext={onNext}
        onPrevious={() => {}}
        canGoBack={false}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    expect(onNext).toHaveBeenCalledWith("c1")
    expect(
      (screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("says how many of how many are shown, because a cursor gives no page number", () => {
    render(
      <CursorPager
        shown={25}
        total={100}
        nextCursor="c1"
        onNext={() => {}}
        onPrevious={() => {}}
        canGoBack={false}
      />,
    )
    expect(screen.getByText(/25 of 100/)).toBeTruthy()
  })

  it("omits the total when the server did not send one", () => {
    render(
      <CursorPager shown={25} nextCursor="c1" onNext={() => {}} onPrevious={() => {}} canGoBack={false} />,
    )
    expect(screen.getByText(/25 shown/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test cursor-pager`
Expected: FAIL, cannot resolve `../src/components/cursor-pager`.

- [ ] **Step 3: Write the pager**

```tsx
import { useCallback, useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"

/**
 * Remembers the cursors already visited so a cursor-paged list can go back.
 *
 * The server answers `nextCursor` and says nothing about the previous page,
 * which is inherent to cursor paging rather than a gap in this contract: a
 * cursor names a position, so the only way back is to remember where you have
 * been. The first page is the absence of a cursor, which is why the stack's
 * bottom is `undefined` rather than a value.
 */
export function useCursorStack(): {
  cursor: string | undefined
  canGoBack: boolean
  next: (cursor: string) => void
  previous: () => void
  reset: () => void
} {
  const [stack, setStack] = useState<string[]>([])

  const next = useCallback((cursor: string) => {
    setStack((prev) => [...prev, cursor])
  }, [])
  const previous = useCallback(() => {
    setStack((prev) => prev.slice(0, -1))
  }, [])
  const reset = useCallback(() => setStack([]), [])

  return {
    cursor: stack[stack.length - 1],
    canGoBack: stack.length > 0,
    next,
    previous,
    reset,
  }
}

export interface CursorPagerProps {
  /** How many rows are on screen right now. */
  shown: number
  /** The whole result set, when the server bothered to count it. */
  total?: number
  /** The cursor for the next page, or absent when this is the last one. */
  nextCursor?: string
  onNext: (cursor: string) => void
  onPrevious: () => void
  canGoBack: boolean
}

/**
 * Previous and Next for a cursor-paged list.
 *
 * No page numbers, because a cursor cannot produce one. The count reads "25 of
 * 100" rather than "page 2 of 4" for the same reason, and drops to "25 shown"
 * when the server sent no total.
 *
 * Renders nothing at all when there is one page and nowhere to go, so a list
 * that fits on a screen does not carry two dead buttons.
 */
export function CursorPager({
  shown,
  total,
  nextCursor,
  onNext,
  onPrevious,
  canGoBack,
}: CursorPagerProps) {
  if (!canGoBack && !nextCursor) return null

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
    >
      <span>{total === undefined ? `${shown} shown` : `${shown} of ${total}`}</span>
      <span className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="Previous page"
          disabled={!canGoBack}
          onClick={onPrevious}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="Next page"
          disabled={!nextCursor}
          onClick={() => nextCursor && onNext(nextCursor)}
        >
          Next
        </Button>
      </span>
    </nav>
  )
}
```

- [ ] **Step 4: Run the pager tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test cursor-pager`
Expected: PASS, seven tests.

- [ ] **Step 5: Let the harness answer commands**

`packages/plugin-authsome/test/harness.tsx` mirrors the streaming one. Give `stubClient` an optional second map and add a recording variant, keeping every existing export and the `beforeEach(() => queryStore.clear())` exactly as they are:

```tsx
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): ScopedClient {
  return {
    extension: "auth",
    query: async (intent: string) => {
      if (!(intent in answers)) {
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      }
      return answers[intent]
    },
    // Same refusal as `query`. A command this map does not hold is a typo in an
    // intent name, and it should turn red rather than resolve to undefined and
    // look like a success.
    command: async (intent: string) => {
      if (!(intent in commands)) {
        throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      }
      return commands[intent]
    },
  } as ScopedClient
}

/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): { client: ScopedClient; sent: { intent: string; payload: unknown }[] } {
  const sent: { intent: string; payload: unknown }[] = []
  const inner = stubClient(answers, commands)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: inner.query,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}
```

If the authsome harness records the params a query was called with, keep that too. Check what is there before replacing anything.

- [ ] **Step 6: Move the two existing pages onto the kit blocks**

`packages/plugin-authsome/src/components/query-view.tsx` is a hand-copied twin of the one kit now owns. Replace its uses in `users.tsx` and `sessions.tsx` with `QueryBoundary`, `CommandAlert`, `PageHeader` and `ResourceTable`, then delete it.

`QueryBoundary` has NO `empty` prop; emptiness belongs to `ResourceTable`'s `emptyMessage`. `formatTimestamp` moves to the kit import.

Keep every behaviour the existing tests assert. This step is a refactor: the pages get their new features in Tasks 2 and 4, not here.

Run: `grep -rn "query-view" packages/plugin-authsome/`
Expected: no matches once the file is gone.

- [ ] **Step 7: Update the existing tests for the new markup**

`ResourceTable` renders a real table with a caption. Adjust assertions to match, and replace any class-based query with a role or text query. Do NOT weaken an assertion: if a test asserted three users appear, it must still assert that. Report the test count before and after; it must not drop.

- [ ] **Step 8: Run the whole suite**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/plugin-authsome/src/components/cursor-pager.tsx packages/plugin-authsome/test/cursor-pager.test.tsx
git commit -m "refactor(authsome): move onto the kit blocks and add a cursor pager" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 2: The users list

**Files:**
- Modify: `packages/plugin-authsome/src/pages/users.tsx`
- Test: `packages/plugin-authsome/test/users.test.tsx`

**Interfaces:**
- Consumes: `CursorPager`, `useCursorStack` from Task 1.
- Produces: `UserSummary`, `UsersList`, `AckResponse` exported from `users.tsx` and reused by Tasks 3, 4 and 5. Define them here once:
  ```ts
  export interface AckResponse { ok: boolean; id?: string }
  export interface UsersList { users: UserSummary[]; nextCursor?: string; total?: number }
  ```

Search, cursor paging, and three row actions. `users.ban` takes a reason and an optional expiry, so the confirm dialog collects both rather than sending a bare id.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/plugin-authsome/test/users.test.tsx
const page1 = {
  users: [
    { id: "u1", email: "ada@example.com", emailVerified: true, firstName: "Ada", lastName: "L", banned: false, createdAt: "2026-01-01T00:00:00Z" },
    { id: "u2", email: "grace@example.com", emailVerified: false, banned: true, createdAt: "2026-01-02T00:00:00Z" },
  ],
  nextCursor: "c1",
  total: 5,
}

describe("AuthUsersPage search and paging", () => {
  it("sends the search term as `email`, and resets to the first page", async () => {
    const { client, queries } = recordingClient({ "users.list": page1 })
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), {
      target: { value: "grace" },
    })

    await waitFor(() =>
      expect(queries.some((q) => q.params?.email === "grace")).toBe(true),
    )
    // A search with a stale cursor would return page two of the old result set.
    const search = queries.find((q) => q.params?.email === "grace")
    expect(search?.params?.cursor).toBeUndefined()
  })

  it("walks forward with the server's cursor and back again", async () => {
    const { client, queries } = recordingClient({ "users.list": page1 })
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    expect(screen.getByText(/2 of 5/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(queries.some((q) => q.params?.cursor === "c1")).toBe(true))

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }))
    await waitFor(() =>
      expect(queries.filter((q) => q.params?.cursor === undefined).length).toBeGreaterThan(1),
    )
  })
})

describe("AuthUsersPage row actions", () => {
  it("collects a reason and an expiry before banning", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.ban": { ok: true, id: "u1" } },
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } })
    fireEvent.change(screen.getByLabelText("Expires at"), {
      target: { value: "2026-12-01T00:00" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("users.ban")
    expect(sent[0].payload).toMatchObject({ id: "u1", reason: "spam" })
    expect((sent[0].payload as { expiresAt?: string }).expiresAt).toBeTruthy()
  })

  it("bans indefinitely when no expiry is given, rather than sending an empty string", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.ban": { ok: true } },
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Ban ada@example.com" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "spam" } })
    fireEvent.click(screen.getByRole("button", { name: "Ban" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // The contract says empty means indefinite, and the store keys an absent
    // key the same as an undefined one, so omitting it is the honest form.
    expect(sent[0].payload).toEqual({ id: "u1", reason: "spam" })
  })

  it("offers unban on a banned user and ban on an active one, never both", async () => {
    renderPage(AuthUsersPage, stubClient({ "users.list": page1 }))
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    expect(screen.getByRole("button", { name: "Ban ada@example.com" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Unban ada@example.com" })).toBeNull()
    expect(screen.getByRole("button", { name: "Unban grace@example.com" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Ban grace@example.com" })).toBeNull()
  })

  it("names the user in the delete confirmation, because a delete is not undoable", async () => {
    const { client, sent } = recordingCommandClient(
      { "users.list": page1 },
      { "users.delete": { ok: true } },
    )
    renderPage(AuthUsersPage, client)
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete ada@example.com" }))
    expect(screen.getByText(/Delete ada@example.com\?/)).toBeTruthy()
    expect(sent).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "users.delete", payload: { id: "u1" } })
  })

  it("does not call refetch after a write", async () => {
    // Invalidation is the server's job via meta.invalidates. This test exists
    // because a refetch() here would make the page look correct while hiding a
    // broken invalidation.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/pages/users.tsx", "utf8"),
    )
    expect(source).not.toContain("refetch(")
  })
})
```

The last test reads the source rather than the behaviour. That is deliberate and it is the only one of its kind: a `refetch()` after a write produces a page that passes every behavioural test while silently masking a broken invalidation, so the only way to pin its absence is to look.

If reading the file from a test proves awkward under this vitest config, drop that test and put the check in Task 11's verification instead, and say so in your report.

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test users`
Expected: FAIL. There is no search box, no pager and no ban dialog.

- [ ] **Step 3: Rewrite the users page**

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { CursorPager, useCursorStack } from "../components/cursor-pager"

export interface UserSummary {
  id: string
  email: string
  emailVerified: boolean
  firstName?: string
  lastName?: string
  username?: string
  banned: boolean
  createdAt: string
}

export interface UsersList {
  users: UserSummary[]
  nextCursor?: string
  total?: number
}

/** The canonical reply for every mutating command in this contract. */
export interface AckResponse {
  ok: boolean
  id?: string
}

export function displayName(user: UserSummary): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    user.email
  )
}

export function AuthUsersPage() {
  const [search, setSearch] = useState("")
  const page = useCursorStack()
  const [banning, setBanning] = useState<UserSummary | null>(null)
  const [banReason, setBanReason] = useState("")
  const [banExpiry, setBanExpiry] = useState("")
  const [deleting, setDeleting] = useState<UserSummary | null>(null)

  // `email` and `cursor` are left undefined rather than sent empty. The store
  // keys an undefined value the same as an absent one, and the server reads an
  // empty cursor as "start again", so this is both correct and free.
  const list = useQuery<UsersList>("users.list", {
    email: search || undefined,
    cursor: page.cursor,
  })

  const ban = useCommand<AckResponse>("users.ban")
  const unban = useCommand<AckResponse>("users.unban")
  const remove = useCommand<AckResponse>("users.delete")

  function searchFor(value: string) {
    setSearch(value)
    // A cursor points into the previous result set. Carrying it across a new
    // search returns page two of the old answer.
    page.reset()
  }

  async function confirmBan() {
    if (!banning) return
    const result = await ban.execute({
      id: banning.id,
      reason: banReason,
      // Empty means indefinite in this contract, and an omitted key says that
      // more clearly than an empty string does.
      expiresAt: banExpiry ? new Date(banExpiry).toISOString() : undefined,
    })
    if (result === undefined) return
    setBanning(null)
    setBanReason("")
    setBanExpiry("")
  }

  async function confirmDelete() {
    if (!deleting) return
    const result = await remove.execute({ id: deleting.id })
    if (result !== undefined) setDeleting(null)
  }

  const columns: Column<UserSummary>[] = [
    { id: "email", header: "Email", cell: (u) => u.email },
    { id: "name", header: "Name", cell: (u) => displayName(u) },
    {
      id: "emailVerified",
      header: "Verified",
      cell: (u) => (
        <Badge variant={u.emailVerified ? "outline" : "secondary"}>
          {u.emailVerified ? "verified" : "unverified"}
        </Badge>
      ),
    },
    {
      id: "banned",
      header: "Status",
      cell: (u) => (
        <Badge variant={u.banned ? "destructive" : "outline"}>
          {u.banned ? "banned" : "active"}
        </Badge>
      ),
    },
    { id: "createdAt", header: "Created", cell: (u) => formatTimestamp(u.createdAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Users"
        actions={<a href="/@auth/users/create" className="underline underline-offset-4">New user</a>}
      />

      <FilterBar
        search={{ value: search, onChange: searchFor, label: "Search users", placeholder: "Search by email" }}
      />

      <CommandAlert error={ban.error} title="Could not ban" />
      <CommandAlert error={unban.error} title="Could not unban" />
      <CommandAlert error={remove.error} title="Could not delete" />

      <QueryBoundary title="Users" query={list} skeletonRows={5}>
        {(data) => (
          <>
            <ResourceTable<UserSummary>
              columns={columns}
              rows={data.users ?? []}
              rowKey={(u) => u.id}
              caption="Users"
              emptyMessage={search ? `No users match “${search}”.` : "No users yet."}
              rowActions={(user) => (
                <>
                  <a
                    href={`/@auth/users/${user.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Details
                  </a>
                  {user.banned ? (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Unban ${user.email}`}
                      disabled={unban.loading}
                      onClick={() => void unban.execute({ id: user.id })}
                    >
                      Unban
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Ban ${user.email}`}
                      onClick={() => setBanning(user)}
                    >
                      Ban
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label={`Delete ${user.email}`}
                    onClick={() => setDeleting(user)}
                  >
                    Delete
                  </Button>
                </>
              )}
            />
            <CursorPager
              shown={(data.users ?? []).length}
              total={data.total}
              nextCursor={data.nextCursor}
              canGoBack={page.canGoBack}
              onNext={page.next}
              onPrevious={page.previous}
            />
          </>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={banning !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBanning(null)
            setBanReason("")
            setBanExpiry("")
          }
        }}
        title={`Ban ${banning?.email ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>They are signed out of every session and cannot sign in again.</span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="ban-reason">Reason</Label>
              <Input id="ban-reason" value={banReason} onChange={(e) => setBanReason(e.target.value)} />
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="ban-expiry">Expires at</Label>
              <Input
                id="ban-expiry"
                type="datetime-local"
                value={banExpiry}
                onChange={(e) => setBanExpiry(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Leave empty to ban indefinitely.
              </span>
            </span>
          </span>
        }
        confirmLabel="Ban"
        pending={ban.loading}
        onConfirm={() => void confirmBan()}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.email ?? ""}?`}
        description="Their sessions, devices and role assignments go with them. This cannot be undone."
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}
```

Unban has no confirmation because it is not destructive: it restores access, and the worst outcome of a mis-click is that somebody can sign in again.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test users`
Expected: PASS, including the pre-existing users tests.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(authsome): search, cursor paging and row actions on the users list" -- packages/plugin-authsome/src/pages/users.tsx packages/plugin-authsome/test/users.test.tsx
```

---

### Task 3: User detail and user create

**Files:**
- Create: `packages/plugin-authsome/src/pages/user-detail.tsx`
- Create: `packages/plugin-authsome/src/pages/user-create.tsx`
- Test: `packages/plugin-authsome/test/user-detail.test.tsx`, `packages/plugin-authsome/test/user-create.test.tsx`

**Interfaces:**
- Consumes: `PluginPageProps` from streaming Task 0; `UserSummary`, `AckResponse`, `displayName` from Task 2.
- Produces: `AuthUserDetailPage`, `AuthUserCreatePage`, `UserDetail`.

**Do not start until streaming Task 0 has landed.** This page reads `params.id`.

The detail page is the one that hosts `user.detail.sections`, so the MFA, consent and social sub-plugins can each push a panel here. It also shows the user's sessions and devices inline, filtered by user id.

**The pointer-semantics rule bites here.** `users.update` declares its optional fields as Go pointers so "leave unchanged" and "set to empty" stay distinguishable. A field the operator did not touch must be ABSENT from the payload.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/user-detail.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, stubClient } from "./harness"
import { AuthUserDetailPage } from "../src/pages/user-detail"

const answers = {
  "users.detail": {
    id: "u1", email: "ada@example.com", emailVerified: true,
    firstName: "Ada", lastName: "Lovelace", username: "ada",
    banned: false, createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z", phone: "+1", phoneVerified: false,
    banReason: "", banExpiresAt: "",
  },
  "sessions.list": {
    sessions: [
      { id: "s1", userId: "u1", ipAddress: "10.0.0.1", expiresAt: "2026-03-01T00:00:00Z", createdAt: "2026-02-01T00:00:00Z" },
    ],
  },
  "devices.list": {
    devices: [
      { id: "d1", userId: "u1", name: "laptop", browser: "Firefox", trusted: true, lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ],
  },
}

function renderDetail(client: Parameters<typeof PluginProvider>[0]["client"], id = "u1") {
  return render(
    <PluginProvider client={client}>
      <AuthUserDetailPage params={{ id }} />
    </PluginProvider>,
  )
}

describe("AuthUserDetailPage", () => {
  it("shows the user with their sessions and devices", async () => {
    renderDetail(stubClient(answers))
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ada Lovelace/ })).toBeTruthy())
    expect(screen.getByText("ada@example.com")).toBeTruthy()
    expect(screen.getByText("10.0.0.1")).toBeTruthy()
    expect(screen.getByText("laptop")).toBeTruthy()
  })

  it("prints an en dash for the empty strings authsome sends for never-happened", async () => {
    renderDetail(stubClient(answers))
    await waitFor(() => expect(screen.getByRole("heading", { name: /Ada Lovelace/ })).toBeTruthy())
    // banExpiresAt is "" on a user who is not banned. The epoch would be a lie.
    expect(screen.getAllByText("–").length).toBeGreaterThan(0)
  })

  it("sends only the fields that changed, and never an empty string for an untouched one", async () => {
    const { client, sent } = recordingCommandClient(answers, { "users.update": { ok: true } })
    renderDetail(client)
    await waitFor(() => expect(screen.getByLabelText("First name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Augusta" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // Pointer semantics: lastName and username were not touched, so they must
    // not appear at all. Sending "" would blank them.
    expect(sent[0]).toEqual({
      intent: "users.update",
      payload: { id: "u1", firstName: "Augusta" },
    })
  })

  it("keeps save disabled until something actually changes", async () => {
    renderDetail(stubClient(answers))
    await waitFor(() => expect(screen.getByLabelText("First name")).toBeTruthy())
    const save = screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Augusta" } })
    expect(save.disabled).toBe(false)
  })

  it("sends a changed checkbox as a boolean, not a string", async () => {
    const { client, sent } = recordingCommandClient(answers, { "users.update": { ok: true } })
    renderDetail(client)
    await waitFor(() => expect(screen.getByLabelText("Email verified")).toBeTruthy())

    fireEvent.click(screen.getByLabelText("Email verified"))
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ id: "u1", emailVerified: false })
  })

  it("says so plainly when the route carries no id", () => {
    render(
      <PluginProvider client={stubClient(answers)}>
        <AuthUserDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No user selected.")).toBeTruthy()
  })
})
```

```tsx
// packages/plugin-authsome/test/user-create.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen } from "@testing-library/react"
import { recordingCommandClient, renderPage } from "./harness"
import { AuthUserCreatePage } from "../src/pages/user-create"

describe("AuthUserCreatePage", () => {
  it("sends every field the contract declares", async () => {
    const { client, sent } = recordingCommandClient({}, { "users.create": { ok: true, id: "u9" } })
    renderPage(AuthUserCreatePage, client)

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } })
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "New" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toHaveLength(1)
    expect(sent[0].intent).toBe("users.create")
    expect(sent[0].payload).toMatchObject({
      email: "new@example.com", password: "hunter2hunter2", firstName: "New",
    })
  })

  it("will not submit without an email and a password", () => {
    const { client, sent } = recordingCommandClient({}, { "users.create": { ok: true } })
    renderPage(AuthUserCreatePage, client)

    const create = screen.getByRole("button", { name: "Create user" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2hunter2" } })
    expect(create.disabled).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it("never renders the password as readable text", () => {
    const { client } = recordingCommandClient({}, { "users.create": { ok: true } })
    renderPage(AuthUserCreatePage, client)
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("password")
  })

  it("surfaces the server's own sentence when the policy rejects the password", async () => {
    const { client } = recordingCommandClient({}, {})
    renderPage(AuthUserCreatePage, client)
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.com" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } })
    fireEvent.click(screen.getByRole("button", { name: "Create user" }))

    // The stub has no users.create, so it rejects. The page must show what the
    // server said rather than a generic failure: a rejected password is the
    // server telling the operator something true.
    await screen.findByRole("alert")
  })
})
```

- [ ] **Step 2: Run and confirm both fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test user-detail user-create`
Expected: FAIL, neither module resolves.

- [ ] **Step 3: Write the detail page**

```tsx
import { useState } from "react"
import { PluginSlot, useCommand, useQuery, useSlotCount } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { displayName, type AckResponse, type UserSummary } from "./users"

/** `users.detail`. UserDetail embeds UserSummary in Go, so the JSON is flat. */
export interface UserDetail extends UserSummary {
  displayName?: string
  phone?: string
  phoneVerified?: boolean
  image?: string
  banReason?: string
  banExpiresAt?: string
  passwordChangedAt?: string
  updatedAt: string
  appId?: string
  envId?: string
}

interface SessionRow {
  id: string
  userId: string
  ipAddress?: string
  userAgent?: string
  lastActivityAt?: string
  expiresAt: string
  createdAt: string
}
interface DeviceRow {
  id: string
  userId: string
  name?: string
  type?: string
  browser?: string
  os?: string
  ipAddress?: string
  trusted: boolean
  lastSeenAt: string
  createdAt: string
}

const sessionColumns: Column<SessionRow>[] = [
  { id: "ipAddress", header: "IP", cell: (s) => s.ipAddress || "–" },
  { id: "createdAt", header: "Started", cell: (s) => formatTimestamp(s.createdAt) },
  { id: "expiresAt", header: "Expires", cell: (s) => formatTimestamp(s.expiresAt) },
]

const deviceColumns: Column<DeviceRow>[] = [
  { id: "name", header: "Device", cell: (d) => d.name || d.type || "–" },
  { id: "browser", header: "Browser", cell: (d) => d.browser || "–" },
  {
    id: "trusted",
    header: "Trusted",
    cell: (d) => (
      <Badge variant={d.trusted ? "outline" : "secondary"}>
        {d.trusted ? "trusted" : "untrusted"}
      </Badge>
    ),
  },
  { id: "lastSeenAt", header: "Last seen", cell: (d) => formatTimestamp(d.lastSeenAt) },
]

function UserSessions({ userId }: { userId: string }) {
  const query = useQuery<{ sessions: SessionRow[] }>("sessions.list", { userId })
  return (
    <QueryBoundary title="Sessions" query={query} skeletonRows={2}>
      {(data) => (
        <ResourceTable<SessionRow>
          columns={sessionColumns}
          rows={data.sessions ?? []}
          rowKey={(s) => s.id}
          caption="Sessions"
          emptyMessage="No active sessions."
        />
      )}
    </QueryBoundary>
  )
}

function UserDevices({ userId }: { userId: string }) {
  const query = useQuery<{ devices: DeviceRow[] }>("devices.list", { userId })
  return (
    <QueryBoundary title="Devices" query={query} skeletonRows={2}>
      {(data) => (
        <ResourceTable<DeviceRow>
          columns={deviceColumns}
          rows={data.devices ?? []}
          rowKey={(d) => d.id}
          caption="Devices"
          emptyMessage="No devices seen."
        />
      )}
    </QueryBoundary>
  )
}

function EditUser({ user }: { user: UserDetail }) {
  const update = useCommand<AckResponse>("users.update")
  const [firstName, setFirstName] = useState(user.firstName ?? "")
  const [lastName, setLastName] = useState(user.lastName ?? "")
  const [username, setUsername] = useState(user.username ?? "")
  const [emailVerified, setEmailVerified] = useState(user.emailVerified)

  // Only what actually changed. `users.update` declares these as Go pointers
  // precisely so "leave unchanged" and "set to empty" stay different things,
  // and an untouched field sent as "" blanks it on the server.
  const changed: Record<string, unknown> = { id: user.id }
  if (firstName !== (user.firstName ?? "")) changed.firstName = firstName
  if (lastName !== (user.lastName ?? "")) changed.lastName = lastName
  if (username !== (user.username ?? "")) changed.username = username
  if (emailVerified !== user.emailVerified) changed.emailVerified = emailVerified
  const dirty = Object.keys(changed).length > 1

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Edit</h2>
      <CommandAlert error={update.error} title="Could not save" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-first">First name</Label>
        <Input id="user-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-last">Last name</Label>
        <Input id="user-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="user-username">Username</Label>
        <Input id="user-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="user-verified">Email verified</Label>
        <Switch
          id="user-verified"
          checked={emailVerified}
          onCheckedChange={setEmailVerified}
        />
      </div>
      <Button
        onClick={() => void update.execute(changed)}
        disabled={update.loading || !dirty}
      >
        {update.loading ? "Saving…" : "Save changes"}
      </Button>
    </div>
  )
}

export function AuthUserDetailPage({ params }: PluginPageProps) {
  const userId = params.id
  if (!userId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No user selected.
      </p>
    )
  }
  return <UserDetailBody userId={userId} />
}

function UserDetailBody({ userId }: { userId: string }) {
  const query = useQuery<UserDetail>("users.detail", { id: userId })
  const contributed = useSlotCount("user.detail.sections")

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="User" query={query} skeletonRows={3}>
        {(user) => (
          <>
            <PageHeader title={displayName(user)} description={user.email} />
            <DetailLayout
              main={
                <>
                  <DescriptionList
                    items={[
                      { term: "Email", value: user.email },
                      {
                        term: "Verified",
                        value: (
                          <Badge variant={user.emailVerified ? "outline" : "secondary"}>
                            {user.emailVerified ? "verified" : "unverified"}
                          </Badge>
                        ),
                      },
                      { term: "Phone", value: user.phone || "–" },
                      {
                        term: "Status",
                        value: (
                          <Badge variant={user.banned ? "destructive" : "outline"}>
                            {user.banned ? "banned" : "active"}
                          </Badge>
                        ),
                      },
                      { term: "Ban reason", value: user.banReason || "–" },
                      { term: "Ban expires", value: formatTimestamp(user.banExpiresAt) },
                      { term: "Password changed", value: formatTimestamp(user.passwordChangedAt) },
                      { term: "Created", value: formatTimestamp(user.createdAt) },
                      { term: "Updated", value: formatTimestamp(user.updatedAt) },
                    ]}
                  />
                  <UserSessions userId={userId} />
                  <UserDevices userId={userId} />
                  {/*
                    Where the MFA, consent and social sub-plugins put their
                    per-user panels. The heading is conditional because
                    PluginSlot renders nothing at all when nobody contributes,
                    and a bare heading over nothing is worse than no heading.
                  */}
                  {contributed > 0 && (
                    <h2 className="text-sm font-medium">From installed plugins</h2>
                  )}
                  <PluginSlot name="user.detail.sections" params={{ userId }} />
                </>
              }
              aside={<EditUser user={user} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Write the create page**

```tsx
import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { AckResponse } from "./users"

export function AuthUserCreatePage() {
  const create = useCommand<AckResponse>("users.create")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [username, setUsername] = useState("")
  const [created, setCreated] = useState<string | null>(null)

  async function submit() {
    const result = await create.execute({
      email,
      password,
      // Optional in the contract. Omitted rather than sent empty, so the
      // server stores nothing rather than an empty string.
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      username: username || undefined,
    })
    if (result === undefined) return
    setCreated(result.id ?? "")
    setEmail("")
    setPassword("")
    setFirstName("")
    setLastName("")
    setUsername("")
  }

  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="New user" description="Creates an account directly, with no invitation email." />
      <CommandAlert error={create.error} title="Could not create the user" />
      {created !== null && (
        <p role="status" className="rounded-md border px-3 py-2 text-sm">
          User created.{" "}
          {created && (
            <a href={`/@auth/users/${created}`} className="underline underline-offset-4">
              Open it
            </a>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-email">Email</Label>
        <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Password</Label>
        <Input
          id="new-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          Checked against the engine's password policy, which answers with its own message.
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-first">First name</Label>
        <Input id="new-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-last">Last name</Label>
        <Input id="new-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-username">Username</Label>
        <Input id="new-username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <Button
        onClick={() => void submit()}
        disabled={create.loading || email.trim() === "" || password === ""}
      >
        {create.loading ? "Creating…" : "Create user"}
      </Button>
    </section>
  )
}
```

There is no client-side password length check. The engine owns the policy, it answers with its own sentence, and a second copy of the rule here would drift from it and reject passwords the server would have accepted.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-authsome/src/pages/user-detail.tsx packages/plugin-authsome/src/pages/user-create.tsx packages/plugin-authsome/test/user-detail.test.tsx packages/plugin-authsome/test/user-create.test.tsx
git commit -m "feat(authsome): user detail with plugin sections, and user create" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 4: Sessions and devices

**Files:**
- Modify: `packages/plugin-authsome/src/pages/sessions.tsx`
- Create: `packages/plugin-authsome/src/pages/session-detail.tsx`
- Create: `packages/plugin-authsome/src/pages/devices.tsx`
- Create: `packages/plugin-authsome/src/pages/device-detail.tsx`
- Test: `packages/plugin-authsome/test/sessions.test.tsx`, `packages/plugin-authsome/test/devices.test.tsx`

**Interfaces:**
- Consumes: `PluginPageProps`, `AckResponse` from Task 2.
- Produces: `SessionSummary`, `SessionDetail`, `SessionsList`, `DeviceSummary`, `DevicesList`, and the four page components.

Batched because sessions and devices are the same shape: a top-N list filtered by an optional user id, a detail page, and per-row commands. Neither is cursor-paged; both take a `limit`, so each shows the most recent hundred and says so.

**A field-name trap:** these take `userId` with a lower-case d. Streaming's contract uses `userID`. Copy from this plan's contract block.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/plugin-authsome/test/sessions.test.tsx
const sessionsAnswer = {
  sessions: [
    { id: "s1", userId: "u1", ipAddress: "10.0.0.1", userAgent: "Firefox",
      lastActivityAt: "2026-02-02T00:00:00Z", expiresAt: "2026-03-01T00:00:00Z",
      createdAt: "2026-02-01T00:00:00Z" },
  ],
}

describe("AuthSessionsPage actions", () => {
  it("revokes one session after confirming, naming the user", async () => {
    const { client, sent } = recordingCommandClient(
      { "sessions.list": sessionsAnswer },
      { "sessions.revoke": { ok: true } },
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke session s1" }))
    expect(sent).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "sessions.revoke", payload: { id: "s1" } })
  })

  it("revokes every session for one user, and says how many that is", async () => {
    const { client, sent } = recordingCommandClient(
      { "sessions.list": sessionsAnswer },
      { "sessions.bulkRevoke": { ok: true, revoked: 3 } },
    )
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Revoke all for u1" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke all" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "sessions.bulkRevoke", payload: { userId: "u1" } })
  })

  it("filters by user id and drops the filter when cleared", async () => {
    const { client, queries } = recordingClient({ "sessions.list": sessionsAnswer })
    renderPage(AuthSessionsPage, client)
    await waitFor(() => expect(screen.getByText("10.0.0.1")).toBeTruthy())

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by user" }), {
      target: { value: "u9" },
    })
    await waitFor(() => expect(queries.some((q) => q.params?.userId === "u9")).toBe(true))

    fireEvent.change(screen.getByRole("searchbox", { name: "Filter by user" }), {
      target: { value: "" },
    })
    // Cleared means absent, not empty string: an empty userId would be a
    // different cache key for the same question.
    await waitFor(() =>
      expect(queries.filter((q) => q.params?.userId === undefined).length).toBeGreaterThan(1),
    )
  })
})
```

```tsx
// packages/plugin-authsome/test/devices.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthDevicesPage } from "../src/pages/devices"

const devicesAnswer = {
  devices: [
    { id: "d1", userId: "u1", name: "laptop", type: "desktop", browser: "Firefox",
      os: "linux", ipAddress: "10.0.0.1", trusted: false,
      lastSeenAt: "2026-02-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  ],
}

describe("AuthDevicesPage", () => {
  it("lists devices with their trust state", async () => {
    renderPage(AuthDevicesPage, stubClient({ "devices.list": devicesAnswer }))
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())
    expect(screen.getByText("untrusted")).toBeTruthy()
  })

  it("trusts a device without a confirmation, because trusting is not destructive", async () => {
    const { client, sent } = recordingCommandClient(
      { "devices.list": devicesAnswer },
      { "devices.trust": { ok: true } },
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Trust laptop" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "devices.trust", payload: { id: "d1" } })
  })

  it("confirms before forgetting a device", async () => {
    const { client, sent } = recordingCommandClient(
      { "devices.list": devicesAnswer },
      { "devices.delete": { ok: true } },
    )
    renderPage(AuthDevicesPage, client)
    await waitFor(() => expect(screen.getByText("laptop")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Forget laptop" }))
    expect(sent).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Forget" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "devices.delete", payload: { id: "d1" } })
  })

  it("says so when nobody has registered a device", async () => {
    renderPage(AuthDevicesPage, stubClient({ "devices.list": { devices: [] } }))
    await waitFor(() => expect(screen.getByText("No devices seen.")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sessions devices`
Expected: FAIL.

- [ ] **Step 3: Write the sessions page**

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"

export interface SessionSummary {
  id: string
  userId: string
  ipAddress?: string
  userAgent?: string
  lastActivityAt?: string
  expiresAt: string
  createdAt: string
}
export interface SessionsList {
  sessions: SessionSummary[]
}

/** The server caps what it returns; this is what we ask for. */
const LIMIT = 100

export function AuthSessionsPage() {
  const [userFilter, setUserFilter] = useState("")
  const [revoking, setRevoking] = useState<SessionSummary | null>(null)
  const [bulkFor, setBulkFor] = useState<string | null>(null)

  const list = useQuery<SessionsList>("sessions.list", {
    userId: userFilter || undefined,
    limit: LIMIT,
  })
  const revoke = useCommand<AckResponse>("sessions.revoke")
  const bulkRevoke = useCommand<AckResponse>("sessions.bulkRevoke")

  async function confirmRevoke() {
    if (!revoking) return
    const result = await revoke.execute({ id: revoking.id })
    if (result !== undefined) setRevoking(null)
  }
  async function confirmBulk() {
    if (!bulkFor) return
    const result = await bulkRevoke.execute({ userId: bulkFor })
    if (result !== undefined) setBulkFor(null)
  }

  const columns: Column<SessionSummary>[] = [
    { id: "userId", header: "User", cell: (s) => s.userId },
    { id: "ipAddress", header: "IP", cell: (s) => s.ipAddress || "–" },
    { id: "userAgent", header: "Agent", cell: (s) => s.userAgent || "–" },
    {
      id: "lastActivityAt",
      header: "Last activity",
      cell: (s) => formatTimestamp(s.lastActivityAt),
    },
    { id: "expiresAt", header: "Expires", cell: (s) => formatTimestamp(s.expiresAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Sessions" description={`Showing the most recent ${LIMIT}.`} />
      <FilterBar
        search={{
          value: userFilter,
          onChange: setUserFilter,
          label: "Filter by user",
          placeholder: "User id",
        }}
      />
      <CommandAlert error={revoke.error} title="Could not revoke" />
      <CommandAlert error={bulkRevoke.error} title="Could not revoke" />

      <QueryBoundary title="Sessions" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<SessionSummary>
            columns={columns}
            rows={data.sessions ?? []}
            rowKey={(s) => s.id}
            caption="Sessions"
            emptyMessage="No active sessions."
            rowActions={(session) => (
              <>
                <a
                  href={`/@auth/sessions/${session.id}`}
                  className="text-sm underline underline-offset-4"
                >
                  Details
                </a>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Revoke session ${session.id}`}
                  onClick={() => setRevoking(session)}
                >
                  Revoke
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Revoke all for ${session.userId}`}
                  onClick={() => setBulkFor(session.userId)}
                >
                  Revoke all
                </Button>
              </>
            )}
          />
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={`Revoke this session?`}
        description={`Signs ${revoking?.userId ?? "the user"} out on that device immediately.`}
        confirmLabel="Revoke"
        pending={revoke.loading}
        onConfirm={() => void confirmRevoke()}
      />
      <ConfirmDialog
        open={bulkFor !== null}
        onOpenChange={(open) => !open && setBulkFor(null)}
        title={`Revoke every session for ${bulkFor ?? ""}?`}
        description="Signs them out everywhere, on every device, at once."
        confirmLabel="Revoke all"
        pending={bulkRevoke.loading}
        onConfirm={() => void confirmBulk()}
      />
    </section>
  )
}
```

- [ ] **Step 4: Write the devices page**

Same shape. `devices.trust` gets no confirmation: trusting a device grants nothing that revoking cannot undo, and a confirmation on a non-destructive action trains people to click through them.

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { AckResponse } from "./users"

export interface DeviceSummary {
  id: string
  userId: string
  name?: string
  type?: string
  browser?: string
  os?: string
  ipAddress?: string
  trusted: boolean
  lastSeenAt: string
  createdAt: string
}
export interface DevicesList {
  devices: DeviceSummary[]
}

const LIMIT = 100

export function deviceLabel(device: DeviceSummary): string {
  return device.name || device.type || device.id
}

export function AuthDevicesPage() {
  const [userFilter, setUserFilter] = useState("")
  const [forgetting, setForgetting] = useState<DeviceSummary | null>(null)

  const list = useQuery<DevicesList>("devices.list", {
    userId: userFilter || undefined,
    limit: LIMIT,
  })
  const trust = useCommand<AckResponse>("devices.trust")
  const remove = useCommand<AckResponse>("devices.delete")

  async function confirmForget() {
    if (!forgetting) return
    const result = await remove.execute({ id: forgetting.id })
    if (result !== undefined) setForgetting(null)
  }

  const columns: Column<DeviceSummary>[] = [
    { id: "name", header: "Device", cell: (d) => deviceLabel(d) },
    { id: "userId", header: "User", cell: (d) => d.userId },
    { id: "browser", header: "Browser", cell: (d) => d.browser || "–" },
    { id: "os", header: "OS", cell: (d) => d.os || "–" },
    { id: "ipAddress", header: "IP", cell: (d) => d.ipAddress || "–" },
    {
      id: "trusted",
      header: "Trusted",
      cell: (d) => (
        <Badge variant={d.trusted ? "outline" : "secondary"}>
          {d.trusted ? "trusted" : "untrusted"}
        </Badge>
      ),
    },
    { id: "lastSeenAt", header: "Last seen", cell: (d) => formatTimestamp(d.lastSeenAt) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Devices" description={`Showing the most recent ${LIMIT}.`} />
      <FilterBar
        search={{
          value: userFilter,
          onChange: setUserFilter,
          label: "Filter by user",
          placeholder: "User id",
        }}
      />
      <CommandAlert error={trust.error} title="Could not trust the device" />
      <CommandAlert error={remove.error} title="Could not forget the device" />

      <QueryBoundary title="Devices" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<DeviceSummary>
            columns={columns}
            rows={data.devices ?? []}
            rowKey={(d) => d.id}
            caption="Devices"
            emptyMessage="No devices seen."
            rowActions={(device) => (
              <>
                <a
                  href={`/@auth/devices/${device.id}`}
                  className="text-sm underline underline-offset-4"
                >
                  Details
                </a>
                {!device.trusted && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Trust ${deviceLabel(device)}`}
                    disabled={trust.loading}
                    onClick={() => void trust.execute({ id: device.id })}
                  >
                    Trust
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={`Forget ${deviceLabel(device)}`}
                  onClick={() => setForgetting(device)}
                >
                  Forget
                </Button>
              </>
            )}
          />
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={forgetting !== null}
        onOpenChange={(open) => !open && setForgetting(null)}
        title={`Forget ${forgetting ? deviceLabel(forgetting) : ""}?`}
        description="The next sign-in from it counts as a new device, which may trigger verification."
        confirmLabel="Forget"
        pending={remove.loading}
        onConfirm={() => void confirmForget()}
      />
    </section>
  )
}
```

- [ ] **Step 5: Write the two detail pages**

Both follow the same shape as the room detail page from the streaming plan: guard on a missing id, then a body component that reads its own intent.

`session-detail.tsx` renders `sessions.detail({ id })` through a `DescriptionList` with every field of `SessionDetail`: user, IP, agent, app, environment, organisation, device, impersonated-by, principal kind, last activity, expires, refresh-token expiry, created, updated. `impersonatedBy` matters most of the four optional ones and should not be buried: a session somebody else is driving is the thing an operator is looking for.

`device-detail.tsx` renders `devices.detail({ id })` the same way, with a Trust button when the device is untrusted and a Forget button behind a `ConfirmDialog` carrying `pending`.

Both export a page taking `PluginPageProps` and both render `No session selected.` / `No device selected.` when `params.id` is absent.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-authsome/src/pages/session-detail.tsx packages/plugin-authsome/src/pages/devices.tsx packages/plugin-authsome/src/pages/device-detail.tsx packages/plugin-authsome/test/devices.test.tsx
git commit -m "feat(authsome): sessions and devices, with revoke, trust and forget" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 5: Roles

**Files:**
- Create: `packages/plugin-authsome/src/pages/roles.tsx`, `packages/plugin-authsome/src/pages/role-detail.tsx`
- Test: `packages/plugin-authsome/test/roles.test.tsx`

**Interfaces:**
- Consumes: `PluginPageProps`, `AckResponse`.
- Produces: `RoleSummary`, `RoleDetail`, `PermissionRecord`, `RolesList`, `AuthRolesPage`, `AuthRoleDetailPage`.

Six intents: list, detail, create, update, delete, assign, unassign. The list is not paged.

`roles.assign` and `roles.unassign` attach a role to a principal. Their inputs are not in this plan's contract block because the handler's shape was not read during planning: **open `authsome/extension/contract/handlers_roles.go` and read `AssignRoleInput` and `UnassignRoleInput` before writing that part, and put the real field names in your report.** Do not guess them. Sending a field the server ignores produces a command that returns ok and changes nothing, which is the worst failure this contract can give you.

- [ ] **Step 1: Read the two input shapes and record them**

Run: `grep -n "AssignRoleInput" -A 8 /Users/rexraphael/Work/xraph/authsome/extension/contract/handlers_roles.go`
Run: `grep -n "UnassignRoleInput" -A 8 /Users/rexraphael/Work/xraph/authsome/extension/contract/handlers_roles.go`

Write both shapes into your report before continuing. Every payload you build below uses those exact JSON tags.

- [ ] **Step 2: Write the failing tests**

```tsx
// packages/plugin-authsome/test/roles.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { AuthRoleDetailPage, AuthRolesPage } from "../src/pages/roles"

const rolesAnswer = {
  roles: [
    { id: "r1", name: "Admin", slug: "admin", description: "Everything", createdAt: "2026-01-01T00:00:00Z" },
  ],
}

describe("AuthRolesPage", () => {
  it("lists roles with their slug", async () => {
    renderPage(AuthRolesPage, stubClient({ "roles.list": rolesAnswer }))
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())
    expect(screen.getByText("admin")).toBeTruthy()
  })

  it("creates a role with name, slug and description", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.create": { ok: true, id: "r2" } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Auditor" } })
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "auditor" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Read only" } })
    fireEvent.click(screen.getByRole("button", { name: "Create role" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "roles.create",
      payload: { name: "Auditor", slug: "auditor", description: "Read only" },
    })
  })

  it("will not create a role without a name and a slug", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.create": { ok: true } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "New role" }))
    expect((screen.getByRole("button", { name: "Create role" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toHaveLength(0)
  })

  it("confirms before deleting, warning that assignments go with it", async () => {
    const { client, sent } = recordingCommandClient(
      { "roles.list": rolesAnswer },
      { "roles.delete": { ok: true } },
    )
    renderPage(AuthRolesPage, client)
    await waitFor(() => expect(screen.getByText("Admin")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete Admin" }))
    expect(sent).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "roles.delete", payload: { id: "r1" } })
  })
})

describe("AuthRoleDetailPage", () => {
  const detail = {
    "roles.detail": {
      id: "r1", name: "Admin", slug: "admin", description: "Everything",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-02-01T00:00:00Z",
      permissions: [
        { id: "p1", action: "read", resource: "users" },
        { id: "p2", action: "write", resource: "users" },
      ],
    },
  }

  it("shows the role's permissions as action on resource", async () => {
    render(
      <PluginProvider client={stubClient(detail)}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("heading", { name: "Admin" })).toBeTruthy())
    expect(screen.getByText("read")).toBeTruthy()
    expect(screen.getAllByText("users").length).toBeGreaterThan(0)
  })

  it("sends only what changed when renaming, never a blank description", async () => {
    const { client, sent } = recordingCommandClient(detail, { "roles.update": { ok: true } })
    render(
      <PluginProvider client={client}>
        <AuthRoleDetailPage params={{ id: "r1" }} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Administrator" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    // roles.update takes pointers. An untouched description must be absent.
    expect(sent[0]).toEqual({
      intent: "roles.update",
      payload: { id: "r1", name: "Administrator" },
    })
  })

  it("says so plainly when the route carries no id", () => {
    render(
      <PluginProvider client={stubClient(detail)}>
        <AuthRoleDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No role selected.")).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test roles`
Expected: FAIL, cannot resolve `../src/pages/roles`.

- [ ] **Step 4: Write the list page**

Build it exactly like the users list from Task 2, with these differences: the query is `useQuery<RolesList>("roles.list")` with no params, there is no search box and no pager (this list is not paged), the columns are Name, Slug, Description, Created, and the row actions are a Details link to `/@auth/roles/${role.id}` plus a Delete button behind a `ConfirmDialog` carrying `pending={remove.loading}`.

The create form is an inline panel toggled by a "New role" button in the `PageHeader` actions, exactly like `CreateRoomForm` in the streaming plan: three `Input`s with `Label`s for Name, Slug and Description, a `CommandAlert` for `create.error`, and a submit disabled while `create.loading` or while name or slug is empty. On success it closes; on failure it stays open with the error visible, because a failed create must not throw away what was typed.

The delete confirmation's description reads: "Anyone assigned this role loses it. This cannot be undone."

Types to export from this file:

```ts
export interface RoleSummary {
  id: string; name: string; slug: string; description?: string; createdAt: string
}
export interface PermissionRecord { id: string; action: string; resource: string }
export interface RoleDetail extends RoleSummary {
  appId?: string; envId?: string; parentId?: string
  permissions?: PermissionRecord[]; updatedAt: string
}
export interface RolesList { roles: RoleSummary[] }
```

- [ ] **Step 5: Write the detail page**

Same shape as `AuthUserDetailPage` from Task 3: a `PluginPageProps` wrapper that renders `No role selected.` when `params.id` is absent, then a body component reading `roles.detail({ id })` through a `QueryBoundary`.

The main column holds a `DescriptionList` of Slug, Description, Parent, App, Environment, Created and Updated, then a `ResourceTable<PermissionRecord>` of the role's permissions with columns Action and Resource, `rowKey={(p) => p.id}` and `emptyMessage="This role grants no permissions."`.

The aside holds an edit panel built exactly like `EditUser` in Task 3: it accumulates a `changed` object starting `{ id }`, adds `name` only when it differs from what the server sent, adds `description` only when it differs, and disables Save until `Object.keys(changed).length > 1`. That is the pointer-semantics rule, and it is why the test above asserts the payload has no `description` key.

Assign and unassign go in the aside too, using the input shapes you read in Step 1. Each is a small form plus a `CommandAlert`.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test roles`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-authsome/src/pages/roles.tsx packages/plugin-authsome/src/pages/role-detail.tsx packages/plugin-authsome/test/roles.test.tsx
git commit -m "feat(authsome): roles, with permissions and assignment" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 6: Apps and environments

**Files:**
- Create: `packages/plugin-authsome/src/pages/apps.tsx`, `app-create.tsx`, `app-detail.tsx`
- Create: `packages/plugin-authsome/src/pages/environments.tsx`, `environment-detail.tsx`
- Test: `packages/plugin-authsome/test/apps.test.tsx`, `packages/plugin-authsome/test/environments.test.tsx`

**Interfaces:**
- Produces: `AppSummary`, `AppDetail`, `AppsList`, `EnvSummary`, `EnvDetail`, `EnvironmentsList`, and five page components.

Ten intents. Both are unpaged CRUD lists with a detail page, built exactly like roles in Task 5, with these specifics.

**Apps.** `apps.list` needs no params. Columns: Name, Slug, Platform (a `Badge` reading "platform" when `isPlatform`, otherwise "app"), Created. Row actions are a Details link to `/@auth/apps/${id}` and a Delete behind a confirm reading "Everything scoped to this app goes with it: users, sessions, environments and settings. This cannot be undone." The platform app must NOT offer Delete at all: render the button only when `!app.isPlatform`, because deleting the platform app is not a thing an operator should be one mis-click away from. Create is a separate route, `/@auth/apps/create`, rather than an inline panel, because it takes a slug that has to be unique and deserves its own page. It sends `{ name, slug, logo? }` with `logo` omitted when empty. The detail page reads `apps.detail({ id })`, shows Name, Slug, Platform, Publishable key, Metadata and timestamps, and its edit panel accumulates `{ id }` plus only the changed fields among `name`, `slug`, `logo`.

The publishable key gets a copy button next to it. It is the one field on the page somebody actually needs to move somewhere else.

**Environments.** `environments.list` needs no params. Columns: Name, Slug, Type, Default (a `Badge` reading "default" when `isDefault`), Created. Row actions: Details link to `/@auth/environments/${id}`, a "Make default" button when `!isDefault`, a Clone button, and Delete behind a confirm. Create is an inline panel like roles, sending `{ name, slug, type?, description?, color? }` with the optional three omitted when empty.

`environments.clone` and `environments.setDefault` have input shapes this plan did not read. **Open `authsome/extension/contract/handlers_environments.go`, read `CloneEnvInput` and `SetDefaultEnvInput`, and record both in your report before writing them.** Guessing here produces a command that succeeds and does nothing.

Delete's confirmation reads: "Everything scoped to this environment goes with it. This cannot be undone." A default environment must not offer Delete, for the same reason the platform app does not.

- [ ] **Step 1: Read the two environment input shapes and record them**

Run: `grep -n "CloneEnvInput\|SetDefaultEnvInput" -A 8 /Users/rexraphael/Work/xraph/authsome/extension/contract/handlers_environments.go`

Put both in your report before continuing.

- [ ] **Step 2: Write the failing tests**

Write `apps.test.tsx` covering: the list renders with a platform badge; Delete is absent on the platform app and present on a normal one; create sends `{ name, slug }` with no `logo` key when the field is empty; the detail edit sends only changed fields; the publishable key has a copy control.

Write `environments.test.tsx` covering: the list renders with a default badge; "Make default" is absent on the default environment; clone sends the shape you read in Step 1; delete confirms and sends `{ id }`; the detail edit sends only changed fields.

Each test file follows the structure of `roles.test.tsx` from Task 5: a `recordingCommandClient` for the write assertions, a `stubClient` for the render assertions, and `renderPage` for list pages, with detail pages rendered inside a `PluginProvider` and given `params` directly.

- [ ] **Step 3: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test apps environments`
Expected: FAIL.

- [ ] **Step 4: Write the five pages**

Follow the specifics above. Every one of the five uses `PageHeader`, `QueryBoundary`, `ResourceTable`, `ConfirmDialog` with `pending`, `CommandAlert`, and `formatTimestamp`, matching Tasks 2, 3 and 5.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-authsome/src/pages/apps.tsx packages/plugin-authsome/src/pages/app-create.tsx packages/plugin-authsome/src/pages/app-detail.tsx packages/plugin-authsome/src/pages/environments.tsx packages/plugin-authsome/src/pages/environment-detail.tsx packages/plugin-authsome/test/apps.test.tsx packages/plugin-authsome/test/environments.test.tsx
git commit -m "feat(authsome): apps and environments" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 7: Webhooks and signup forms

**Files:**
- Create: `packages/plugin-authsome/src/pages/webhooks.tsx`
- Create: `packages/plugin-authsome/src/pages/signup-forms.tsx`, `signup-form-editor.tsx`
- Test: `packages/plugin-authsome/test/webhooks.test.tsx`, `packages/plugin-authsome/test/signup-forms.test.tsx`

**Interfaces:**
- Produces: `WebhookSummary`, `WebhookDetail`, `WebhooksList`, `FormField`, `FormConfigSummary`, and three page components.

**Webhooks** is one page holding list and detail together, because a webhook is four fields and a separate route for it would be ceremony. Columns: URL, Events (joined with commas), Active (a `Badge`), Created. Row actions: a toggle switching `active` through `webhooks.update({ id, active })`, an Edit button opening an inline panel, and Delete behind a confirm.

The events field is a multi-select. The contract takes `string[]` and does not enumerate the valid events, so render a text input taking a comma-separated list and split it on save, trimming each entry and dropping empties. Do not invent an event vocabulary the server never gave you.

`webhooks.update` takes pointers, so the edit panel accumulates `{ id }` plus only changed fields among `url`, `events`, `active`. For `events`, compare the joined strings rather than the arrays, since two arrays with the same contents are never `===`.

**Signup forms** is two routes. `/signup-forms` lists `formConfigs.list` with columns Form type, Version, Active, Created. `/signup-forms/edit` is the field editor: it reads `formConfigs.signup`, renders each `FormField` as a row with its key, label, type and order, and offers Add, Remove and Move up / Move down. Saving sends `formConfigs.saveSignup({ fields, active })` with the whole array, because that is what the intent takes.

Reordering rewrites the `order` field on every affected row rather than relying on array position, since `order` is what the server persists and what it sorts by on the next read.

- [ ] **Step 1: Write the failing tests**

`webhooks.test.tsx` covers: the list renders with events joined; toggling active sends `{ id, active }` and nothing else; editing a URL sends `{ id, url }` with no `events` key; the events input splits and trims a comma-separated list; delete confirms.

`signup-forms.test.tsx` covers: the list renders; the editor shows each field's key and label; adding a field appends it with the next order value; removing one leaves the rest contiguous; moving a field up swaps the two `order` values rather than only the array positions; saving sends the whole `fields` array.

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test webhooks signup-forms`
Expected: FAIL.

- [ ] **Step 3: Write the three pages**

Following the specifics above and the component set used throughout this plan.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/pages/webhooks.tsx packages/plugin-authsome/src/pages/signup-forms.tsx packages/plugin-authsome/src/pages/signup-form-editor.tsx packages/plugin-authsome/test/webhooks.test.tsx packages/plugin-authsome/test/signup-forms.test.tsx
git commit -m "feat(authsome): webhooks and the signup form editor" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 8: Settings

**Files:**
- Create: `packages/plugin-authsome/src/pages/settings.tsx`, `settings-namespace.tsx`
- Create: `packages/plugin-authsome/src/settings-fields.ts`
- Test: `packages/plugin-authsome/test/settings.test.tsx`

**Interfaces:**
- Consumes: `PluginPageProps`, `AckResponse`; `SettingsForm` and `type SettingFieldDescriptor` from `@forge-go/dashboard-kit/components/settings-form`.
- Produces: `toDescriptors(fields: SettingField[]): SettingFieldDescriptor[]`, `flattenCategories(res: SettingsNamespaceResponse | undefined): SettingField[]`, `AuthSettingsPage`, `AuthSettingsNamespacePage`, and the types `SettingField`, `SettingCategory`, `SettingsNamespaceResponse`.

**Corrected against the Go source after this plan was first written.** `settings.namespace` does NOT answer a flat `{ fields }` array. It answers `{ namespace, displayName?, scope, categories: [{ name, settings: SettingField[] }] }`, and the fields live two levels down. An earlier draft of this task read `data.fields`, which would have been `undefined` on every namespace and rendered an empty form with no error. `flattenCategories` exists for that reason and the sub-plugin package imports it too, so it belongs in `settings-fields.ts` next to `toDescriptors` rather than inside a page.

**One more thing the server does that the UI has to respect.** A sensitive field with a value set comes back with `effectiveValue` redacted to the literal string `"***"`; the real value never crosses the wire. `SettingsForm` only sends keys the operator actually changed, so an untouched secret is never echoed back as `"***"`. Do not add anything that sends the whole form.

This is the highest-leverage task in the plan. Eighteen authsome sub-plugins render their entire settings surface through kit's `SettingsForm`, and the mapping written here is what they all go through. Get it right once.

**The mapping is the whole task.** Kit owns `SettingFieldDescriptor` and deliberately knows nothing about any contract. `settings.namespace` answers `SettingField`, which is a different shape. `settings-fields.ts` is the one place the two meet.

**Three rules the mapping has to honour:**

1. `effectiveValue` is the value to show, falling back to `default` when the setting has never been set. Not the other way round.
2. `isEnforced` OR `!canOverride` both mean the operator cannot change it here, and both map onto `enforced`. A field that is merely `readOnly` maps onto `readOnly`. The two render differently in kit and mean different things: enforced is "somebody above you set this", read-only is "nobody sets this".
3. `sensitive` maps onto type `"secret"`, which renders masked. That takes priority over whatever `inputType` says, because a sensitive field rendered as plain text is a leak, and it is the kind that shows up in a screen-share.

**Two obligations from the consumer notes:**
- Remount `SettingsForm` with a `key` tied to the namespace when the data refetches, or an operator keeps looking at edits made against data the server has replaced.
- Do NOT wrap it in a `<form>`. Its blank-numeric guard lives on the Save button's disabled state and a form gives you a submit-on-Enter path straight past it.

**And one thing the UI must not offer.** `settings.update` cannot clear an override: it passes its value straight through, so sending null stores null. `Manager.Delete` exists in Go but no intent reaches it. So there is NO "Reset to default" control on this page. If you feel one is missing, it is, and it is blocked on Go work recorded in `docs/superpowers/specs/2026-09-08-platform-decisions.md`.

- [ ] **Step 1: Write the failing test for the mapping**

```ts
// packages/plugin-authsome/test/settings.test.tsx  (mapping half)
import { describe, expect, it } from "vitest"
import { flattenCategories, toDescriptors } from "../src/settings-fields"

const base = {
  key: "min_length", displayName: "Minimum length", type: "int",
  isOverridden: false, isEnforced: false, canOverride: true, order: 1,
}

describe("flattenCategories", () => {
  it("pulls the fields out of their categories", () => {
    const out = flattenCategories({
      namespace: "password", scope: "app",
      categories: [
        { name: "Strength", settings: [{ ...base, key: "min_length" }] },
        { name: "Hashing", settings: [{ ...base, key: "algorithm" }] },
      ],
    })
    expect(out.map((f) => f.key)).toEqual(["min_length", "algorithm"])
  })

  it("uses the category name as the section when a field has none", () => {
    const out = flattenCategories({
      namespace: "password", scope: "app",
      categories: [{ name: "Strength", settings: [{ ...base, key: "a" }, { ...base, key: "b", section: "Own" }] }],
    })
    expect(out[0].section).toBe("Strength")
    // A field that names its own section keeps it. The category is a
    // fallback, not an override.
    expect(out[1].section).toBe("Own")
  })

  it("answers an empty list for undefined, rather than throwing", () => {
    // The page calls this while the query is still loading.
    expect(flattenCategories(undefined)).toEqual([])
  })
})

describe("toDescriptors", () => {
  it("shows the effective value, falling back to the default when unset", () => {
    expect(toDescriptors([{ ...base, effectiveValue: 12, default: 8 }])[0].value).toBe(12)
    expect(toDescriptors([{ ...base, default: 8 }])[0].value).toBe(8)
  })

  it("treats enforced and cannot-override as the same thing to the operator", () => {
    expect(toDescriptors([{ ...base, isEnforced: true }])[0].enforced).toBe(true)
    expect(toDescriptors([{ ...base, canOverride: false }])[0].enforced).toBe(true)
    expect(toDescriptors([base])[0].enforced).toBe(false)
  })

  it("keeps read-only separate from enforced, because they mean different things", () => {
    const d = toDescriptors([{ ...base, readOnly: true }])[0]
    expect(d.readOnly).toBe(true)
    expect(d.enforced).toBe(false)
  })

  it("masks a sensitive field whatever its inputType says", () => {
    const d = toDescriptors([{ ...base, sensitive: true, inputType: "text" }])[0]
    // A sensitive value rendered as plain text is the kind of leak that shows
    // up in a screen-share.
    expect(d.type).toBe("secret")
  })

  it("maps the contract's types onto kit's", () => {
    expect(toDescriptors([{ ...base, type: "bool" }])[0].type).toBe("boolean")
    expect(toDescriptors([{ ...base, type: "int" }])[0].type).toBe("number")
    expect(toDescriptors([{ ...base, type: "float" }])[0].type).toBe("number")
    expect(toDescriptors([{ ...base, type: "string" }])[0].type).toBe("string")
    expect(
      toDescriptors([{ ...base, type: "string", options: [{ label: "A", value: "a" }] }])[0].type,
    ).toBe("select")
  })

  it("falls back to string for a type it has never heard of", () => {
    // A newer server may declare a type this UI predates. Rendering it as a
    // text box is wrong-ish; refusing to render the namespace at all is worse.
    expect(toDescriptors([{ ...base, type: "duration" }])[0].type).toBe("string")
  })

  it("sorts by order, then carries section, help and validation through", () => {
    const out = toDescriptors([
      { ...base, key: "b", order: 2, section: "S", helpText: "h" },
      { ...base, key: "a", order: 1, validation: { required: true, min: 1, max: 9 } },
    ])
    expect(out.map((d) => d.key)).toEqual(["a", "b"])
    expect(out[1].section).toBe("S")
    expect(out[1].helpText).toBe("h")
    expect(out[0].required).toBe(true)
    expect(out[0].min).toBe(1)
    expect(out[0].max).toBe(9)
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test settings`
Expected: FAIL, cannot resolve `../src/settings-fields`.

- [ ] **Step 3: Write the mapping**

```ts
import type { SettingFieldDescriptor } from "@forge-go/dashboard-kit/components/settings-form"

/** `settings.namespace`'s field shape, from handlers_settings.go. */
export interface SettingOption {
  label: string
  value: string
}
export interface SettingValidation {
  required?: boolean
  min?: number
  max?: number
  minLen?: number
  maxLen?: number
  pattern?: string
}
export interface SettingCategory {
  name: string
  settings: SettingField[]
}
export interface SettingsNamespaceResponse {
  namespace: string
  displayName?: string
  scope: string
  categories: SettingCategory[]
}
export interface SettingField {
  key: string
  displayName: string
  description?: string
  type: string
  inputType?: string
  default?: unknown
  effectiveValue?: unknown
  isOverridden: boolean
  isEnforced: boolean
  canOverride: boolean
  readOnly?: boolean
  sensitive?: boolean
  placeholder?: string
  helpText?: string
  options?: SettingOption[]
  validation?: SettingValidation
  order: number
  section?: string
  scopes?: string[]
}

/**
 * Turns the contract's `SettingField` into kit's `SettingFieldDescriptor`.
 *
 * This is the one place the two shapes meet, deliberately. Kit owns its
 * descriptor and knows nothing about any contract, which is what lets all
 * eighteen settings-only sub-plugins share one renderer. Widening kit to
 * understand `SettingField` would trade that away for nothing.
 */
/**
 * Flattens the server's categories into one ordered list of fields.
 *
 * The response groups settings into named categories, and kit's `SettingsForm`
 * groups by a `section` on each field. Those are the same idea arriving in two
 * shapes, so the category name becomes the section for any field that does not
 * carry one of its own. Dropping the category name instead would collapse a
 * grouped namespace into one undifferentiated wall of inputs.
 */
export function flattenCategories(res: SettingsNamespaceResponse | undefined): SettingField[] {
  return (res?.categories ?? []).flatMap((category) =>
    (category.settings ?? []).map((field) => ({
      ...field,
      section: field.section || category.name,
    })),
  )
}

export function toDescriptors(fields: SettingField[]): SettingFieldDescriptor[] {
  return [...(fields ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((field) => ({
      key: field.key,
      label: field.displayName,
      description: field.description,
      // Sensitive wins over everything. A masked field that should have been
      // plain is a small annoyance; the reverse is a leak.
      type: field.sensitive ? "secret" : kitType(field),
      // The effective value is what is in force. `default` is only what would
      // apply if nothing were set, so it is the fallback and never the first
      // choice.
      value: field.effectiveValue ?? field.default,
      options: field.options,
      placeholder: field.placeholder,
      helpText: field.helpText,
      section: field.section,
      // Two different server-side facts, one operator-facing consequence: you
      // cannot change this here. `readOnly` stays separate because it means
      // nobody changes it anywhere, which reads differently in the UI.
      enforced: field.isEnforced || !field.canOverride,
      readOnly: field.readOnly,
      required: field.validation?.required,
      min: field.validation?.min,
      max: field.validation?.max,
    }))
}

function kitType(field: SettingField): SettingFieldDescriptor["type"] {
  if (field.options && field.options.length > 0) return "select"
  switch (field.type) {
    case "bool":
    case "boolean":
      return "boolean"
    case "int":
    case "integer":
    case "float":
    case "number":
      return "number"
    case "string":
      return "string"
    default:
      // A newer server may declare a type this UI predates. A text box is a
      // poor rendering of a duration; refusing to render the namespace at all
      // is a worse one.
      return "string"
  }
}
```

- [ ] **Step 4: Write the two pages**

`/settings` reads `settings.namespaces` and renders a `ResourceTable<NamespaceSummary>` with columns Namespace (linking to `/@auth/settings/${name}`), Description and Settings (the count). Below it, render `<PluginSlot name="settings.tabs" />` with a heading shown only when `useSlotCount("settings.tabs") > 0`, so installed sub-plugins can add their own entries.

`/settings/:namespace` takes `PluginPageProps`, guards on a missing `params.namespace` with "No namespace selected.", then reads `settings.namespace({ namespace, scope: "app" })`, flattens it with
`const fields = flattenCategories(data)`, and renders:

```tsx
<SettingsForm
  // Remount when the data changes, per the kit consumer notes: the form
  // seeds its draft once on mount and does not re-seed.
  key={`${namespace}:${fields.length}`}
  fields={toDescriptors(fields)}
  saving={update.loading}
  onSave={(changed) => void save(changed)}
/>
```

`save` sends ONE `settings.update` per changed key, because the intent writes one key at a time:

```tsx
  async function save(changed: Record<string, unknown>) {
    for (const [key, value] of Object.entries(changed)) {
      const result = await update.execute({ key, value, scope: "app" })
      // Stop at the first failure rather than firing the rest blind. The
      // operator sees which key failed, and the ones after it are untouched
      // rather than half-applied.
      if (result === undefined) return
    }
  }
```

Note the route param is named `namespace`, so the route path is `/settings/:namespace` and the page reads `params.namespace`.

- [ ] **Step 5: Write the page tests**

Cover: the namespace index links to each namespace; the panel renders a field from inside a category with its effective value; an enforced field renders disabled; saving two changed keys sends two `settings.update` commands with the right keys; a failed first save stops rather than sending the second.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test settings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-authsome/src/settings-fields.ts packages/plugin-authsome/src/pages/settings.tsx packages/plugin-authsome/src/pages/settings-namespace.tsx packages/plugin-authsome/test/settings.test.tsx
git commit -m "feat(authsome): settings namespaces and the schema-driven panel" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 9: Overview, credentials, features and plugins

**Files:**
- Create: `packages/plugin-authsome/src/pages/overview.tsx`, `credentials.tsx`, `features.tsx`, `plugins.tsx`
- Test: `packages/plugin-authsome/test/overview.test.tsx`, `credentials.test.tsx`, `features.test.tsx`

**Interfaces:**
- Produces: `AuthOverviewPage`, `AuthCredentialsPage`, `AuthFeaturesPage`, `AuthPluginsPage`.

Four small pages, batched. Two are read-only, one has a toggle, and one is the honest gap.

**Overview** reads `overview.stats` into a `StatGrid` of Users, Sessions, Devices and Plugins, then `overview.recentSignups({ limit: 10 })` into a `ResourceTable<UserSummary>` with Email, Name and Created, each row linking to its user. Below both, `<PluginSlot name="overview.widgets" />` with a heading gated on `useSlotCount`, so any installed sub-plugin can add a card.

**Credentials** reads `credentials.detail` into a `DescriptionList` of App, Slug, Environment, and the publishable key. The key gets a copy button; it is the only thing on the page somebody needs to move elsewhere. Render `isPlatform` as a badge so it is obvious which app these belong to.

**Features** reads `auth.featureToggles` into a list of rows, each a `Switch` bound to `auth.toggleFeature({ key, enabled })`. One command per changed toggle, not a bag: the intent flips a single key.

The `available` flag matters and is the reason this page is not just a settings panel. A row with `available: false` renders DISABLED with its reason shown, because that is how an operator learns MFA is off since the plugin is not installed rather than because somebody turned it off. Never hide an unavailable row: hiding it answers the question "why can I not turn on MFA" with silence.

**Plugins** is the page this plan cannot finish, and it must say so rather than pretend. The legacy dashboard listed all twenty-five installed authsome plugins with their status. There is no intent for that: the closest is `auth.featureToggles`, which covers nine sign-in features, and `geoip`, `scim`, `riskengine` and the rest have no toggle at all.

So `/plugins` renders the nine feature rows read-only and carries a visible note, not a comment:

```tsx
<p role="status" className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
  These are the sign-in features this app can turn on, not the full list of
  installed plugins. The contract has no intent that enumerates installed
  plugins, so the rest are not shown here. See the retirement notes.
</p>
```

That paragraph is a requirement of this task, not a nicety. An operator comparing this against the templ dashboard will notice sixteen missing rows, and the page should answer that before they file a bug.

- [ ] **Step 1: Write the failing tests**

Cover, per page: the overview renders four counters and the recent signups; the credentials page shows the publishable key and offers a copy control; the features page renders a disabled row with its reason when `available` is false and an enabled one otherwise; toggling sends `auth.toggleFeature({ key, enabled })` for that key alone; the plugins page renders the limitation note.

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test overview credentials features`
Expected: FAIL.

- [ ] **Step 3: Write the four pages**

Using the component set this plan uses throughout.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/pages/overview.tsx packages/plugin-authsome/src/pages/credentials.tsx packages/plugin-authsome/src/pages/features.tsx packages/plugin-authsome/src/pages/plugins.tsx packages/plugin-authsome/test/overview.test.tsx packages/plugin-authsome/test/credentials.test.tsx packages/plugin-authsome/test/features.test.tsx
git commit -m "feat(authsome): overview, credentials, feature toggles and the plugins gap" -- packages/plugin-authsome/src packages/plugin-authsome/test
```

---

### Task 10: Wire it all up

**Files:**
- Modify: `packages/plugin-authsome/src/index.tsx`
- Test: `packages/plugin-authsome/test/plugin.test.tsx`

**Interfaces:**
- Consumes: every page from Tasks 2 to 9.
- Produces: the finished `authsomePlugin` with twenty-three routes, four nav groups and two context dimensions.

The four groups are Identity, Configuration, Security and System, and the task's own test enumerates them. An earlier draft of this line said six, which conflated the core plugin's nav with the six groups the SUB-PLUGIN manifests use (Identity, Security, Auth, Compliance, Enterprise, Configuration). Those are a different set belonging to a different plan.

- [ ] **Step 1: Write the failing test**

```tsx
// append to packages/plugin-authsome/test/plugin.test.tsx
describe("the finished plugin", () => {
  it("declares a route for every page", () => {
    const paths = authsomePlugin.routes.map((r) => r.path).sort()
    expect(paths).toEqual(
      [
        "/", "/apps", "/apps/create", "/apps/:id",
        "/credentials", "/devices", "/devices/:id",
        "/environments", "/environments/:id", "/features",
        "/plugins", "/roles", "/roles/:id",
        "/sessions", "/sessions/:id",
        "/settings", "/settings/:namespace",
        "/signup-forms", "/signup-forms/edit",
        "/users", "/users/create", "/users/:id", "/webhooks",
      ].sort(),
    )
  })

  it("groups its nav the way the Go manifests do", () => {
    const groups = [...new Set(authsomePlugin.nav.map((n) => n.group))]
    expect(groups).toEqual(["Identity", "Configuration", "Security", "System"])
  })

  it("declares the app and environment dimensions with their own payload builders", () => {
    const ids = authsomePlugin.context.map((d) => d.id)
    expect(ids).toEqual(["app", "environment"])

    const app = authsomePlugin.context.find((d) => d.id === "app")!
    const env = authsomePlugin.context.find((d) => d.id === "environment")!
    // The contract has no shared field name. A hardcoded `id` would send
    // something the server ignores and the switch would silently do nothing.
    expect(app.payload("a1")).toEqual({ appId: "a1" })
    expect(env.payload("e1")).toEqual({ envId: "e1" })
    expect(app.query).toBe("apps.context")
    expect(env.query).toBe("apps.context")
  })

  it("does not contribute a nav entry for a detail route", () => {
    const navPaths = authsomePlugin.nav.map((n) => n.to)
    expect(navPaths.some((p) => p.includes(":"))).toBe(false)
  })

  it("still resolves against a capabilities document naming the auth contributor", () => {
    const state = resolvePluginState(authsomePlugin, {
      shellEnvelopes: ["v1"],
      contributors: [{ name: "auth", envelopes: ["v1"], configured: true }],
    })
    expect(state.kind).toBe("ready")
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test plugin`
Expected: FAIL, most routes are missing.

- [ ] **Step 3: Declare the context dimensions**

```tsx
const APP_DIMENSION: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: (data) => {
    const d = data as {
      currentApp?: { id: string; name: string }
      availableApps?: { id: string; name: string }[]
    }
    return {
      current: d.currentApp ? { id: d.currentApp.id, label: d.currentApp.name } : undefined,
      options: (d.availableApps ?? []).map((a) => ({ id: a.id, label: a.name })),
    }
  },
  // Not `{ id }`. apps.switch takes appId and environments.switch takes envId,
  // so a shared field name would send something the server ignores and the
  // switch would look like it worked.
  payload: (appId) => ({ appId }),
}

const ENV_DIMENSION: ContextDimension = {
  id: "environment",
  label: "Environment",
  query: "apps.context",
  switchCommand: "environments.switch",
  select: (data) => {
    const d = data as {
      currentEnv?: { id: string; name: string }
      availableEnvs?: { id: string; name: string }[]
    }
    return {
      current: d.currentEnv ? { id: d.currentEnv.id, label: d.currentEnv.name } : undefined,
      options: (d.availableEnvs ?? []).map((e) => ({ id: e.id, label: e.name })),
    }
  },
  payload: (envId) => ({ envId }),
}
```

Both read the same query on purpose. The store dedups on the key, so two switchers cost one request.

- [ ] **Step 4: Declare the nav, grouped**

Identity: Users `/users` (10), Sessions `/sessions` (20), Devices `/devices` (30), Roles `/roles` (40).
Configuration: Apps `/apps` (10), Environments `/environments` (20), Webhooks `/webhooks` (30), Signup forms `/signup-forms` (40), Settings `/settings` (50).
Security: Credentials `/credentials` (10), Features `/features` (20).
System: Overview `/` (10), Plugins `/plugins` (20).

No nav entry for any `:id` route: a sidebar link to "a user" with no user chosen points nowhere.

- [ ] **Step 5: Declare all twenty-three routes and export every page**

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(authsome): wire every route, nav group and context dimension" -- packages/plugin-authsome/src/index.tsx packages/plugin-authsome/test/plugin.test.tsx
```

---

### Task 11: Verify the plugin as a whole

- [ ] **Step 1: Confirm every intent is used**

```bash
for i in users.list users.detail users.create users.update users.ban users.unban users.delete \
         sessions.list sessions.detail sessions.revoke sessions.bulkRevoke \
         devices.list devices.detail devices.trust devices.delete \
         roles.list roles.detail roles.create roles.update roles.delete roles.assign roles.unassign \
         apps.list apps.detail apps.create apps.update apps.delete apps.context apps.switch \
         environments.list environments.detail environments.create environments.update \
         environments.delete environments.clone environments.setDefault environments.switch \
         webhooks.list webhooks.detail webhooks.create webhooks.update webhooks.delete \
         formConfigs.list formConfigs.signup formConfigs.saveSignup formConfigs.deleteSignup \
         settings.namespaces settings.namespace settings.update settings.enforce settings.unenforce \
         overview.stats overview.recentSignups credentials.detail \
         auth.featureToggles auth.toggleFeature auth.dynamicConfig auth.dynamicRegister; do
  printf '%-28s %s\n' "$i" "$(grep -rl "\"$i\"" packages/plugin-authsome/src | tr '\n' ' ')"
done
```

Every line must name at least one file. An empty line is a missing page or a typo, and a typo here is invisible at runtime: the page just shows an error card. Report every empty line rather than fixing it silently, because some may be genuine scope decisions.

- [ ] **Step 2: Tests, typecheck, lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test && pnpm --filter @forge-go/dashboard-plugin-authsome typecheck && pnpm --filter @forge-go/dashboard-plugin-authsome lint`
Expected: all clean. Report the test count.

- [ ] **Step 3: Confirm no page compensates for invalidation**

Run: `grep -rn "refetch" packages/plugin-authsome/src`
Expected: no matches. A `refetch()` after a command works around an invalidation the server already declares.

- [ ] **Step 4: Confirm every destructive dialog carries `pending`**

Run: `grep -rn "ConfirmDialog" -A 14 packages/plugin-authsome/src | grep -c "pending="`
Compare against the number of `ConfirmDialog` uses. They must match.

- [ ] **Step 5: Confirm pointer semantics are honoured**

Run: `grep -rn "|| \"\"" packages/plugin-authsome/src/pages | grep -i "update"`
Expected: no matches inside an update payload. Sending `""` for an untouched optional field blanks it on the server, which is exactly what the pointer types exist to prevent.

- [ ] **Step 6: Confirm no dependency was added**

Run: `git diff --stat 22cf81b -- packages/plugin-authsome/package.json`
Expected: no output.

- [ ] **Step 7: Commit anything the checks required**

---

## Self-review

**Spec coverage.** The spec lists twenty-three routes in four nav groups. Identity is Tasks 2, 3, 4 and 5; Configuration is Tasks 6, 7 and 8; Security is Task 9; System is Task 9. Task 10 wires them and asserts the full route list mechanically. The spec's context dimensions section is Task 10. Its pointer-semantics constraint appears in the Global Constraints, is implemented in Tasks 3, 5, 6 and 7, and is checked mechanically in Task 11 Step 5. Its `/plugins` gap is Task 9, which requires a visible note rather than a code comment. The spec says sign-in leaves this plugin, and the Global Constraints say so and name the eight intents that go with it.

`auth.dynamicConfig` and `auth.dynamicRegister` are in Task 11's check list but have no task. That is a real gap: the spec puts them "under /settings with no nav entry" and no task builds them. **Whoever executes this plan should add them as a small route under Task 8**, reading `auth.dynamicConfig` and offering `auth.dynamicRegister`, or record explicitly why they were dropped.

**A deliberate deviation from the plan format, disclosed.** Tasks 5, 6, 7 and 9 give some pages a precise specification rather than literal code: the exact intents, the exact columns, the exact confirm copy, the exact component set and the exact rules. Tasks 1, 2, 3, 8 and 10 carry complete code, and Task 3's `EditUser` is the worked example of the pointer-semantics pattern every edit panel repeats. This trades some of the format's guarantee for a plan of readable length across twenty-three routes, and it is a real trade rather than an oversight: an implementer working Task 6 has a fully coded equivalent in Task 3 in the same document. If a step turns out to be ambiguous in practice, that is a plan defect and worth reporting rather than guessing.

**Two shapes this plan deliberately did not guess.** `roles.assign`/`roles.unassign` and `environments.clone`/`environments.setDefault` have their inputs read from the Go source as the first step of their own tasks, and both tasks say to record what was found before writing any payload. Guessing a field name there produces a command that returns ok and changes nothing, which is the hardest failure in this contract to notice.

**Type consistency.** `AckResponse` is defined once in Task 2's `users.tsx` and imported by Tasks 3 to 9. `UserSummary` and `displayName` come from Task 2 and are used by Tasks 3 and 9. `PluginPageProps` comes from streaming Task 0 and is used by every detail page. `SettingFieldDescriptor` is kit's and is produced by Task 8's `toDescriptors`. `ContextDimension` is the plugin package's and is used in Task 10. The kit block names used throughout (`QueryBoundary`, `CommandAlert`, `PageHeader`, `StatGrid`, `ResourceTable`, `Column`, `DescriptionList`, `DetailLayout`, `EmptyState`, `ConfirmDialog`, `FilterBar`, `SettingsForm`, `formatTimestamp`) are spelled as that package exports them.
