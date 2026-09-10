# Decisions taken while building the plugin platform

The specs say what to build. This says what changed while building it, and why.
Every entry here overrides or corrects something in
`2026-09-08-dashboard-plugin-platform-design.md`, so read this alongside it. The
three plans still to come (authsome core, authsome sub-plugins, streaming) all
depend on at least one of these.

## The store's rules, in their final form

Five separate decisions reshaped the query store, each reviewed alone. Together
they are:

**Join versus supersede is the caller's intent, never the fetcher's identity.**
An unforced `read` joins whatever is already in flight for that key. Only
`{ force: true }` issues a superseding request. `useQuery`'s mount effect does
not force; its `refetch` does. An early attempt used closure identity to decide
this. It never matched, because `useQuery` builds a new arrow on every render,
so two components mounting the same key each issued their own request.
Closure identity is not the question and there is a comment in the code saying
so.

**The store owns re-issue.** `invalidate` drops a key nobody is watching, and
re-issues a key somebody is. Without that a mounted page stalls at loading
forever: the hook's effect is gated on `[client, intent, key, staleMs]` and none
of those change when a cache entry is dropped.

**Generations are store-global and monotonic.** They were once derived from the
record, so deleting a record reset the counter, and a pre-invalidation request
could then settle with a matching generation and write stale data over fresh. A global counter makes that collision unrepresentable rather than
unlikely.

**`invalidate` keeps the data on screen; `clear` blanks it.** An invalidation is
the same app with changed data, so stale-while-revalidate is right. `clear` is
only ever called on an app or environment switch, where showing the previous
tenant's rows under the new tenant's chrome is wrong rather than merely old.

**A param whose value is `undefined` keys the same as an absent one.**
`JSON.stringify` drops it from the request body, so `{ a: undefined }` and `{}`
are the same request and must share a key. `null` survives onto the wire and
stays distinct.

## `hostIntents` is a declaration guard, not a sandbox

A sub-plugin declares which of its host's intents it may read, and
`useHostQuery` refuses anything else. That makes the widening visible in the
sub-plugin's own declaration and reviewable in one place, which is what it is
for.

It isn't an enforced boundary, and the spec's phrase "can reach nothing else of
its host's" overstates it. `useHostAccess` returns the raw host `ScopedClient`,
and `createScopedClient` is exported from the package index, so any bundle can
build a client for any extension regardless. The boundary that actually enforces
anything is the Go dispatcher's permissions. Narrowing `useHostAccess` to a
per-intent shim would tighten the guard and is worth doing; it would still be a
guard.

Every slot contribution gets its own `HostAccessProvider` carrying its own
allowlist. That matters for a reason that's easy to miss: `SubPluginProvider`
sits above the route table, so without a per-contribution provider a sub-plugin
route rendering a slot would place other sub-plugins' contributions inside its
own ambient provider, where they would inherit its allowlist and its host
client.

## Route collisions are a deployment state, not an authoring error

Import-time validation catches one sub-plugin declaring two nav items at the
same path. It cannot catch two sub-plugins of one host both claiming
`/settings`, because those authors never met and the collision exists only in a
particular deployment's combination of installed plugins.

So the host picks a winner at mount and warns instead of throwing. The host's
own routes always win; between sub-plugins the tie breaks on extension name, so
the winner never depends on the order somebody wrote the imports. A dashboard
that blanks because two installed extensions disagree is worse than one that
drops a page and says so.

The same decision drives nav. A losing sub-plugin's nav entry is filtered out
too, because a nav item that opens somebody else's page is worse than a missing
one.

## Nav groups

`PluginNavItem` takes a `group`. Ungrouped items render first, in one unlabelled
group, which is what every plugin shipping today produces. A sub-plugin's `to`
is relative to its **host's** namespace: it has no namespace of its own, so
`mountPath` is always called with the host plugin.

## Context dimensions carry their own payload builder

`ContextDimension` has `payload: (optionId) => Record<string, unknown>` rather
than the host building `{ id: optionId }`. The contract has no shared field
name: `apps.switch` takes `{appId}` and `environments.switch` takes `{envId}`. A
hardcoded `id` sends a field the server ignores, so the switch appears to work
while changing nothing. Keeping the shape in the dimension is also what lets the
host stay ignorant of what a dimension means.

Switching clears the entire store, not just what the response named, and only
after the command succeeds.

## What the next three plans need to know

Beyond `2026-09-08-kit-blocks-consumer-notes.md`, which covers the kit blocks:

**The settings "unset" question is answered, and the answer is no.** Kit's
`SettingsForm` refuses to save a blank numeric field rather than guessing what
clearing one means, because `Number("")` is `0` and a silent zero override is
worse than a validation error. That guess would have been wrong either way.

`settings.update` passes its `Value` straight to `Manager.Set` as raw JSON
(`handlers_settings.go:266`), so sending `null` stores the literal value null. It
does not clear an override. The capability exists on the Go side, as
`Manager.Delete(ctx, key, scope, scopeID)` at `settings/manager.go:323`, but no
contract intent reaches it: the manifest has `settings.update`,
`settings.enforce` and `settings.unenforce`, and nothing that clears.

So an explicit "Reset to default" per field is blocked on a new Go intent, and it
belongs on the gap list below rather than in the authsome plan. Until it exists,
refusing the blank save is the honest behaviour: a field can be set, and it
cannot be unset, and the UI should not pretend otherwise.

**Ten legacy surfaces cannot be rebuilt at all**, because they have no contract
intents behind them. Nine of them are pages: SCIM's directory list, detail and logs; subscription's
invoices, coupons and plan features; and the per-user MFA, passkey and social
sections. The tenth is the "Reset to default" affordance described above. Each
needs Go work in the authsome repository first. Put them in the retirement
checklist so nobody discovers them the hard way.

**Re-measure the bundle at the first page that statically imports
`ConfirmDialog` or `SettingsForm`.** Both pull Base UI, and `BASELINE.md`
records the Base UI `CompositeRoot` chunk as lazy. That commit is where it can
flip eager.

**A test that passes when the behaviour it names is deleted is worse than no
test.** That isn't a slogan here; it happened five times. Reviews caught all five. The cheapest
reliable check is to break the production code on a scratch copy, watch the test
fail, and throw the copy away. Do it for anything that pins a security property
or a race.
