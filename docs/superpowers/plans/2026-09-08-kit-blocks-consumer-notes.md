# Obligations on anyone using the kit blocks

The nine shared blocks in `packages/kit` are done. Six things fell out of building
them that a consumer has to know and cannot discover from the types. They're written down here because the working notes they came from are scratch and get deleted. These outlive them.

Read this before writing a page against `ResourceTable`, `ConfirmDialog` or
`SettingsForm`.

## Pass `pending` to every ConfirmDialog

`ConfirmDialog` does not debounce. Without a `pending` prop its confirm button
stays enabled after you click it, so a fast double-click fires `onConfirm`
twice. The component can't fix this itself, because it has no idea whether the thing you triggered is asynchronous.

Every call site that opens one passes `pending`: ban, delete, revoke,
bulk-revoke, kick, room delete. The value comes straight off the command hook:

```tsx
<ConfirmDialog pending={ban.loading} onConfirm={() => void ban.execute({ id })} />
```

It's documented on the component too, but a doc comment is easy to skip and banning somebody twice isn't.

Unban was on that list and has come off it. Unban is not destructive and the
users page fires it straight from the row with no dialog at all, which is the
right design: a confirm step in front of an action that undoes a restriction
is friction with nothing behind it. The obligation attaches to opening a
`ConfirmDialog`, not to sending a command.

## Re-measure the bundle at the first page that imports ConfirmDialog or SettingsForm

`ConfirmDialog` pulls `@base-ui/react/alert-dialog` and `SettingsForm` pulls
`@base-ui/react/switch`. `BASELINE.md` records the Base UI `CompositeRoot` chunk
at 357 KB raw and 108.67 KB gzip, and records it as **lazy**: it loads only when
a lazy chunk that needs it loads.

The first plugin page that imports either block **statically** is the commit
where that can flip eager, and it is the single largest chunk in the build. So
run `pnpm build` at that commit, compare the eager entry set against
BASELINE.md's 433.15 KB raw / 137.86 KB gzip, and write the new number into
BASELINE.md whichever way it goes. Do not wait until the end of a wave to find
out.

Nothing has imported these blocks yet, which is why the kit plan could merge
without measuring.

## Remount SettingsForm with a `key` when you refetch

`SettingsForm` seeds its draft from `fields` once, on mount, and deliberately
does not re-seed when `fields` changes. A reset effect would trip this repo's
`react-hooks/set-state-in-effect` rule, which `packages/plugin/src/hooks.ts`
already documents fighting.

So a settings page that refetches has to remount the form:

```tsx
<SettingsForm key={namespace} fields={fields} onSave={save} />
```

Skip the key and an operator keeps looking at edits made against data the server has since replaced. That's a bad way to find out.

## SettingsForm refuses to save a blank numeric field, and the unset question is still open

`Number("")` is `0`. An operator who clears a numeric field to unset it would
otherwise submit a real zero override, and zero is a plausible value for a
min-length or a retry count, so it passes server-side validation unnoticed. The
block therefore blocks the save and says why.

That is deliberately not an answer to what "unset" should mean. Kit must not
learn a contract shape, so it refuses rather than guessing.

**That question has since been answered, and the answer is no.** `handlers_settings.go`
passes `in.Value` straight to `Manager.Set` with no null check, so sending null
stores a literal null as the override rather than clearing it. The `Delete` path
that would actually clear one exists in Go and no intent reaches it. So there is
no "Reset to default" control anywhere in the authsome settings UI, and adding
one would be building a button that quietly writes null. The gap is recorded in
`docs/superpowers/specs/2026-09-08-platform-decisions.md` as Go work.

Related: do not wrap `SettingsForm` in a `<form>`. Its blank-numeric guard lives
on the Save button's disabled state, and a form gives you a submit-on-Enter path
straight past it. Either leave the form element off, or add the check to the
component's own submit handler at that point.

## An undefined param keys the same as an absent one

The query store keys a cache entry on extension, intent and params together.
Its stable stringify now drops a key whose value is `undefined`, the same as
`JSON.stringify` does when it builds the request body. So `{ page: 1, search:
undefined }` and `{ page: 1 }` key identically, and you don't need to build
params by omitting the keys you don't have. Either form is fine now:

```tsx
const params = { page, search }
```

`null` still gets its own key, because it survives onto the wire. `{ page: 1,
search: null }` is a different request from `{ page: 1 }`, and the store keeps
it that way.

## Reset the query store between tests

The store is a module-level singleton, on purpose: two plugins reading the same
intent through different scoped clients should share one request, and a context
provider per plugin would give each its own cache and quietly double every shared
read.

The cost lands in tests. A cache entry written by one test is still there for the
next one, so a test that expects a request to go out gets served from cache
instead and fails in a way that points at the wrong thing. Every test harness
that renders a plugin page has to clear it:

```tsx
beforeEach(() => {
  queryStore.clear()
})
```

`packages/plugin-authsome/test/harness.tsx` and
`packages/plugin-streaming/test/harness.tsx` already do this. Copy whichever is
closer to what you are writing.

## `ResourceTable` sorts nothing and pages nothing

Both are controlled, and that isn't an oversight to fix later. The server owns
ordering and paging. A table that re-sorted the array handed to it would sort one
page of a ten-page result and look entirely correct doing it, which is the worst
way for this to be wrong. Pass `sort` and `onSortChange` and send the sort to the
server; same for `pagination` and `onPageChange`.

A column marked `sortable` with no `onSortChange` renders as a plain header
rather than a dead button, so a half-wired table degrades honestly.
