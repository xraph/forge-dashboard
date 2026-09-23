# Routed context: the app in the URL

**Goal:** Make the app part of the URL, so `/@auth/acme/users` is a link to Acme's
users and a reload or a paste keeps it. No app in the URL means no plugin nav and
an apps landing page instead of a half-scoped dashboard.

**Decided with Rex, 2026-09-22:**
- App is a **path segment** after the namespace, by **slug**: `/@auth/acme/users`.
- Environment is a **query param**, by **slug**: `?env=prod`.
- **Every** route under `@auth` gets the prefix, core pages and all 24 sub-plugins.

## Why this is not just a bug fix

Two separate things are broken, and only one of them is in this repository.

The switchers render nothing because they read `apps.context`, the fixture
server has never served it, and `Dimension` returns `null` until that query
lands. That is Task 0.

Underneath, the switch barely does anything even against a real server. Only
four handler files in authsome read the switched app: `handlers.go`,
`handlers_context.go`, `handlers_features.go` and `handlers_settings.go`.
Users, roles, sessions, devices, webhooks, form configs, overview, credentials
and environments all call `defaultAppID(eng)` and ignore it. **That is Go work
in the authsome repository and it is not in this plan.** What this plan can do
is make the dashboard honest about which app it is asking about, so that when
those handlers are fixed the UI is already correct.

Say this in the migration notes rather than letting somebody discover that
switching apps changes two pages out of twenty-four.

## How the server models context, and what that forces

`apps.switch` writes an `authsome_app` cookie; `environments.switch` writes
`authsome_env`. `AppIDFromPrincipal` reads the resulting `app_id` claim. There
is no per-request app field on the envelope, and adding one is a contract
change.

So the URL cannot replace the cookie. It becomes the **source of truth that
drives** it: on load and on every change, if the URL's app differs from
`apps.context`'s `currentApp`, the host sends the switch command and drops the
query store. The cookie stays an implementation detail of the server; the URL
is what a person sees, links and bookmarks.

That ordering matters and is worth stating plainly: **the URL wins.** A cookie
left over from another tab must never quietly re-scope the page you are looking
at.

## Global constraints

- `docs/` is gitignored here. This file is a working note; nothing in it ships.
- No `Co-Authored-By` trailer and no "Generated with" line in any commit. No em dashes in commit bodies.
- Several agents may share this tree. Commit with `git commit -m "..." -- <exact paths>`, never `git add -A`.
- `pnpm -r test` must stay green. `packages/next` currently has failures from another session; they are not ours and not to be touched.
- Run both `test` and `typecheck` per package: they disagree, and only `tsc` sees the barrels.

---

### Task 0: Serve the context intents

**Files:** `packages/fixture-server/server.mjs`, `packages/fixture-server/verify.mjs`

Nothing below can be seen working until this exists.

Serve `apps.context`, `apps.switch` and `environments.switch`, matching
`handlers_context.go`:

```
apps.context -> { currentApp?, currentEnv?, availableApps: SwitcherApp[], availableEnvs: SwitcherEnv[] }
SwitcherApp  = { id, name, slug, logo?, isPlatform }
SwitcherEnv  = { id, name, slug, type?, isDefault }
apps.switch({ appId })   -> ack, and the empty string clears it
environments.switch({ envId }) -> ack, same
```

Hold the selection in module state, so a switch actually changes what
`apps.context` answers next. Seed at least three apps with real slugs and two
environments each, because a one-app fixture cannot show a switcher doing
anything.

`availableEnvs` must be the envs **of the current app**. That is what the Go
comment says, and a fixture that returns all of them hides the bug where the
env survives an app change it should not have.

Extend `verify.mjs` to cover the three.

---

### Task 1: Teach the platform that a dimension can live in the URL

**Files:** `packages/plugin/src/types.ts`, `packages/plugin/src/scope.ts`, `packages/plugin/test/scope.test.ts`

`ContextOption` gains a `slug`, because the URL carries slugs and the current
shape only has `id` and `label`:

```ts
export interface ContextOption {
  id: string
  label: string
  /** What goes in the URL. Falls back to `id` when a dimension has no slug. */
  slug?: string
}
```

`ContextDimension` gains one optional field. Everything without it behaves
exactly as it does today, which is what keeps streaming and core untouched:

```ts
  /**
   * Where this dimension appears in the URL, if it does.
   *
   * A dimension with no `routed` is cookie-only: the switcher sends the
   * command and nothing about the address changes. That was the only mode,
   * and it is why two people looking at "the dashboard" could be looking at
   * different apps and have no way to tell.
   */
  routed?: {
    /** `path` inserts a segment after the namespace. `query` sets a search param. */
    placement: "path" | "query"
    /** Route param name for `path` (`app` gives `/@auth/:app/...`), search key for `query`. */
    param: string
    /** Which field of the chosen option goes in the URL. */
    by: "slug" | "id"
    /**
     * Required only for `path`. Rendered in place of the plugin's pages when
     * the segment is missing, so the operator has something to choose from
     * rather than an empty shell.
     */
    picker?: ComponentType
  }
```

Then the path helpers. `scopePath` grows an optional segment, and everything
that builds a URL goes through it:

```ts
export function scopePath(namespace: string, to: string, segment?: string): string {
  const suffix = to === "/" ? "" : to
  const middle = segment ? `/${segment}` : ""
  return `/${SCOPE_SIGIL}${namespace}${middle}${suffix}`
}
```

Tests: no segment behaves as before; a segment lands between namespace and
path; the plugin root with a segment is `/@auth/acme` and not `/@auth/acme/`,
which react-router treats as a different location.

---

### Task 2: Mount the routes under the segment, and put a picker where they were

**Files:** `packages/host/src/host/PluginHost.tsx`, `packages/host/test/*`

For a plugin with a `path`-routed dimension:

- plugin routes mount at `scopePath(ns, route.path, ":app")`
- sub-plugin routes too, with the same segment
- `/@auth` and `/@auth/` (no segment) mount the dimension's `picker`
- nav hrefs use the **current** segment, read from the URL

The picker route must not collide with the app segment. `/@auth` exactly, and
`/@auth/:app/...` for everything else: react-router ranks the static parent
above the dynamic child, so an index route at the namespace root is the one
place a picker can live without shadowing a real app slug.

**A plugin page must not need to know any of this.** It declares `/users` and
is mounted wherever the host decides. That already holds and must keep holding.

---

### Task 3: Make the URL drive the server

**Files:** `packages/host/src/host/ContextSwitchers.tsx` (or a new `useRoutedContext.ts`), tests

The sync, in one place:

1. read `apps.context`
2. resolve the URL's app slug to an option; the same for `?env=`
3. if the URL names something and it differs from `current`, send the switch command, then `queryStore.clear()`
4. if the URL names nothing and the server has a current app, **redirect** to that app's slug rather than leaving the page unscoped
5. if the URL names an app that is not in `availableApps`, say so and offer the picker. Do not silently fall back to the default app: that shows somebody another app's data under the URL they asked for

The switchers themselves stop calling the command directly. They navigate, and
the sync above does the rest. That is the whole point: one path in, so the URL
and the cookie cannot disagree.

Clearing the store on switch stays. Every cached answer is about the old app.

---

### Task 4: No app, no pages

**Files:** `packages/host/src/host/PluginHost.tsx`

When a `path`-routed dimension has no value in the URL, the scope contributes
**no nav items**. The sidebar keeps its scope switcher and its context
switchers; the content area is the picker.

An operator landing on `/@auth` should see a list of apps to choose, not
thirty-seven links that would each answer about an app nobody picked.

---

### Task 5: Links stop hardcoding the namespace

**Files:** `packages/plugin/src/link.tsx`, every `PluginLink` call site (16), tests

Pages currently write `to="/@auth/users/u1"`. With an app segment that is wrong
in a way nothing catches: the link resolves, the page renders, and it is about
a different app than the one you were reading.

`PluginLink` takes a **scope-relative** path and the host resolves it:

```tsx
<PluginLink to="/users/u1">   →   /@auth/acme/users/u1?env=prod
```

The resolver carries the current app segment and preserves `?env`. Outside a
host it falls back to the path as written, so a standalone render still
produces a working link.

Migrate every call site. A remaining `to="/@auth/..."` is a bug, so add a test
that greps the built plugin sources for the literal and fails on a hit. Use the
package's own tsconfig: no Node types, so read the files through vitest's
import.meta.glob rather than `fs`.

---

### Task 6: Authsome declares it, and supplies the landing page

**Files:** `packages/plugin-authsome/src/index.tsx`, `packages/plugin-authsome/src/pages/app-picker.tsx`, tests

`APP_DIMENSION` gains `routed: { placement: "path", param: "app", by: "slug", picker: AppPicker }`
and its `select` starts returning `slug`. `ENV_DIMENSION` gains
`routed: { placement: "query", param: "env", by: "slug" }`.

`AppPicker` lists `availableApps` as cards: name, slug in mono, a platform
badge, and a link to that app's users page. It is the landing page, so it also
carries a line saying what picking an app does. An account with one app should
land straight in it, which Task 3's redirect already handles.

---

### Task 7: Run it

Fixture server plus shell, in a browser, and walk it:

- `/@auth` shows the picker and no plugin nav
- picking an app lands on `/@auth/<slug>/users` and the nav appears
- the app switcher changes the URL, and the page re-reads
- `?env=` survives navigation between pages
- a bad slug says so rather than showing another app's data
- reloading a deep link keeps the app

Screenshot the picker and one scoped page.
