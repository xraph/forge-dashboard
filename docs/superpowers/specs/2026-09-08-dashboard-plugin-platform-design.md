# Plugin platform: sub-plugins, a query store, context dimensions, kit blocks

Status: approved, not implemented
Depends on: nothing
Blocks: the authsome core spec, the authsome sub-plugin spec, the streaming spec

This is the first of four. It covers the machinery the other three assume, and
none of it is visible to somebody using the dashboard. Read it first. The other three specs name slots, hooks and kit blocks that only exist because this one lands.

## Why

The dashboard rewrite is meant to retire authsome's templ dashboard. That
dashboard is 4,427 lines across 21 pages, and about a third of what it does is
not pages at all. It's an extension point. `dashboard/plugin_iface.go` lets any
authsome plugin push a widget onto the overview, a section onto the user detail
page, a tab onto the org detail page, extra fields onto the org create form, a
settings panel, and whole pages of its own. Twenty-five authsome plugins use it.

The React shell has no equivalent. It resolves top-level plugins against the
server's capabilities response and mounts their routes, which is enough for
three plugins and not enough for thirty. So the platform work comes first.

Four pieces, in dependency order.

## 1. Sub-plugins

### The shape

```ts
defineSubPlugin({
  extension: "organization",   // this sub-plugin's own Go contributor
  host: "auth",                // the plugin it mounts inside
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity" }],
  routes: [{ path: "/organizations", element: OrgListPage }],
  contributions: {
    "overview.widgets": [{ id: "org-count", render: OrgCountWidget }],
    "user.detail.sections": [{ id: "org-memberships", render: OrgSection }],
  },
})
```

`extension` and `host` are both Go contributor names, and they're different
names on purpose. `extension` is what this sub-plugin queries and what decides
whether it renders at all; `host` is where its nav and routes land. The
organization plugin ships its own contract with its own seven intents, so it
gets its own scoped client and cannot read `auth`'s handlers. That property is
the whole reason a sub-plugin is not just a prop passed to `definePlugin`.

Validation runs at import time, same as `definePlugin`: `to` and `path` must
start with `/`, `host` and `extension` must both be non-empty, and a slot name
that isn't in the known set throws. Break the build.

### Resolution

The host runs `resolvePluginState` on every sub-plugin exactly as it does on a
top-level plugin, against the same capabilities document. You get the same four
answers and they mean the same things:

- **hidden**: the server never mentioned this contributor. Nothing renders. No
  nav entry, no route, no widget, no section. This is the common case and it is not an error. A deployment without the organization plugin has no
  Organizations page, and that's correct.
- **mismatch**: reported version outside `requires`. The sub-plugin's nav and
  routes are dropped and its slots render nothing.
- **setup**: the contributor is present but reports `configured: false`. Nav and
  routes mount; each renders the sub-plugin's own `setup` component, or
  `SetupPanel`. Slot contributions are dropped, because a widget that says
  "needs configuring" on somebody else's overview is noise.
- **ready**: everything mounts.

A sub-plugin whose host is itself not ready renders nothing, whatever its own
state says. There's nowhere to put it.

### Slots

Six named slots, one per shape in `plugin_iface.go`:

| slot | params | legacy equivalent |
|---|---|---|
| `overview.widgets` | none | `DashboardWidgets` |
| `user.detail.sections` | `{ userId }` | `DashboardUserDetailSection` |
| `org.detail.sections` | `{ orgId }` | `DashboardOrgDetailSection` |
| `org.detail.tabs` | `{ orgId }` | `DashboardOrgDetailTabs` |
| `org.create.fields` | none | `DashboardOrgCreateFormFields` |
| `settings.tabs` | none | `DashboardSettingsPanel` |

A host plugin renders one with `<PluginSlot name="user.detail.sections"
params={{ userId }} />`. The slot resolves every ready sub-plugin that
contributes to it, sorts by `priority` then `id`, and renders each inside its
own `PluginErrorBoundary` keyed by sub-plugin extension. A sub-plugin that
throws during render loses its own section and nothing else. That isolation is not decoration. These are separately versioned bundles, and one of them will throw eventually, probably during a demo.

Each contribution renders inside a `PluginProvider` carrying its own scoped
client, so a widget on the auth overview queries `organization`, not `auth`.

`PluginSlot` renders nothing at all when no sub-plugin contributes, including no
wrapper element. A host page that wants a heading above its slot has to decide
whether the slot is empty, so `useSlotCount(name)` returns how many
contributions would render.

### Reading the host's intents

A sub-plugin queries its own extension. That rule holds for the six with data of
their own, and it doesn't hold for the eighteen settings-only ones, which
declare `intents: []` and whose panel reads `settings.namespace` and
`settings.update`. Those belong to the **auth** contributor.

So `defineSubPlugin` also takes `hostIntents?: string[]`, an explicit allowlist
of the host's intents this sub-plugin may read, and `useHostQuery` /
`useHostCommand` refuse anything not on it. The list is validated at import time
like every other field. A settings-only sub-plugin declares four intents and can
reach nothing else of its host's, so the scoping property survives: the widening
is declared, narrow, and readable where it's used.

`extension` still does the presence gating, independently of `hostIntents`. No
`mfa` contributor in the capabilities response means no nav entry and no settings
tab, whatever the allowlist says.

### Nav groups

`PluginNavItem` gains `group?: string`. The host currently builds a single
unlabelled `NavGroup`, with a comment saying that changes the day sub-plugin
groups arrive. This is that day.

Items with no `group` sort first, in one unlabelled group, which keeps every
existing plugin rendering exactly as it does now. Named groups follow in first
appearance order across the host's own nav and then its sub-plugins' nav, with
items sorted by `priority` inside each. The Go manifests already declare the
group names: Identity, Security, Auth, Compliance, Enterprise, Configuration.

## 2. The query store

### What's wrong now

`useQuery` fires on mount, caches nothing, dedupes nothing, and returns a
`refetch` you're expected to call by hand. `packages/plugin-authsome/src/pages/
users.tsx` shows what that costs at one page of scale: it holds an
`invalidations` counter in state purely to use as a child `key`, because
remounting the child is the only way it can reissue a query the child owns.
Multiply by forty pages and the pattern doesn't hold.

Meanwhile the Go side has been sending the answer the whole time. Every response
envelope carries `meta.invalidates` (the intents this command just made stale)
and `meta.cacheControl.staleTime`. The client parses neither. `users.ban`
already declares `invalidates: [users.list, users.detail]` in the manifest, and
the page hand-codes the same knowledge a second time.

### The shape

A module-level store, keyed `extension|intent|JSON(params)`.

`useQuery` subscribes through `useSyncExternalStore`. Two components mounting
the same key share one in-flight request and one cache entry. An entry is served
without a fetch while it's inside its `staleTime`, and `staleTime` comes from
the server's own `meta.cacheControl`, defaulting to zero when the server did not
say. Zero means every mount refetches, which is today's behaviour, so a
contributor that sends no cache hints gets no change.

`command()` reads `meta.invalidates` off the response and drops those keys.
Every mounted subscriber on a dropped key refetches immediately; unmounted
entries are dropped and refetch on their next mount. Invalidation is scoped to
the extension that sent the command, so `organization`'s `orgs.update` cannot
invalidate `auth`'s `users.list` even if it names it.

The public signatures don't change. `useQuery(intent, params)` returns the same
`{ data, error, loading, refetch }`, and `refetch` stays, because a "reload this
now" button is a real thing a page wants. What goes away is pages having to call
it to stay correct.

The generation counter in today's `useQuery` moves into the store, doing the
same job: a settlement only writes if its key is still on the generation it was
issued for, so a refetch always beats an older in-flight request regardless of
which promise settles last.

### What it deliberately isn't

No react-query. `BASELINE.md` governs the eager entry chunk and says to read it
before adding a dependency, and this store is about 300 lines with no runtime
dependency at all. It has no retries, no suspense integration, no devtools, no
infinite queries, and no optimistic updates. If a real need for those turns up,
swapping react-query in behind these signatures is still possible, which is the
point of not changing them.

## 3. Context dimensions

Authsome scopes everything to an active app and environment. The switch is a
cookie the server sets: `apps.switch` and `environments.switch` write it,
`apps.context` reads back the current pair plus the available choices, and every
other handler resolves the app from the principal. So the client never threads
an app id through a query. It flips a cookie and rereads.

`definePlugin` gains `context?: ContextDimension[]`:

```ts
context: [
  { id: "app", label: "App", query: "apps.context",
    select: (d) => ({ current: d.currentApp, options: d.availableApps }),
    switchCommand: "apps.switch" },
  { id: "environment", label: "Environment", query: "apps.context",
    select: (d) => ({ current: d.currentEnv, options: d.availableEnvs }),
    switchCommand: "environments.switch" },
]
```

Both dimensions read one query, which the store dedupes to a single request.

The host renders a switcher per dimension in the sidebar, below the scope
switcher and above the nav, and only for the active scope. Selecting an option
sends the switch command and then clears the entire query store, not just the
intents the command named. The cookie changed, so every read in the dashboard is
now about a different app, and the server has no way to enumerate that. This is
the one place the store throws away more than it was told to.

A plugin that declares no dimensions renders no switchers, so core and streaming
are unaffected. The host doesn't know what an "app" is, and shouldn't.

## 4. Kit blocks

Everything below is new and presentational. No kit block imports from
`@forge-go/dashboard-plugin`, ever: kit takes props and renders. `components.json`
says not to hand-edit `src/components`, and these are new files alongside the
vendored ones, not edits to them.

- `empty-state`: icon, heading, body, optional action. Every list in every
  plugin uses it, which is the point.
- `page-header`: title, description, actions. Replaces the bare `<h1>` each page
  currently rolls.
- `resource-table`: columns, rows, sort, row actions, pagination, and its own
  loading, empty and error states. This is the block that pays for itself, since
  roughly twenty pages are a table over a list intent.
- `detail-layout` and `description-list`: the two-column detail shape the user,
  session, device, role, org and room detail pages all want.
- `confirm-dialog`: destructive actions get a confirm step. Ban, revoke, delete,
  kick.
- `stat-grid`: the container-query card grid `plugin-core` and
  `plugin-streaming` have each written separately.
- `filter-bar`: search box plus select filters, controlled.
- `settings-form`: renders an array of field descriptors, with enforced and
  read-only states, sections, and per-field validation. Kit owns the descriptor
  type. The mapping from authsome's `SettingField` onto it lives in the plugin,
  because kit must not learn a contract shape.
- `query-boundary`: loading, error, empty and settled, replacing the two copied
  `query-view.tsx` files in the authsome and streaming plugins.

That last one is worth a note, because the copy was deliberate. The comment on
`packages/plugin-authsome/src/components/query-view.tsx` says two plugins is not
yet evidence of a shared component, and that the trigger for hoisting is a third
consumer or the first time both need the same change. Both conditions are now
met, so it moves.

## Testing

TDD throughout, vitest per package as today.

The sub-plugin work needs tests that an absent contributor renders nothing at
all, that a sub-plugin in setup contributes routes but no widgets, that a
throwing contribution loses only its own slot entry, and that a contribution
queries its own extension rather than its host's. That last one is a security
property, not a nicety, and it gets an explicit test asserting the contributor
field on the wire.

The store needs tests for dedup across two mounts, staleness both sides of the
boundary, `meta.invalidates` fanning out to mounted subscribers only, invalidation
staying inside its own extension, and a refetch superseding an in-flight request
whichever way the promises settle.

Context dimensions need a test that switching clears the whole store, and one
that a plugin declaring no dimensions renders no switcher.

Kit blocks get render tests. `resource-table` gets the most, because it carries
four states and pagination.

## What this spec does not cover

Pages, authsome intents, streaming intents and sub-plugin implementations all
belong to the other three specs, and none of those can start before this one
lands.

Authentication is not here either. The auth-gate spec covers the sign-in screen,
the session, and what the client does with a 401.

## Sequencing against the auth-gate spec

Two files are touched by both. `packages/plugin/src/types.ts` gains `context?`
and the sub-plugin fields here, and `auth?` there. `packages/plugin/src/client.ts`
gains the query store here, and `onUnauthenticated` there.

This spec lands first. The gate then hooks a finished client, so an
`UNAUTHENTICATED` response flows through the store rather than around it, and
one 401 can drop every cached entry in a single place. Landing them the other
way round works too, at the cost of a merge and a second pass to route the 401
through the store afterwards.
