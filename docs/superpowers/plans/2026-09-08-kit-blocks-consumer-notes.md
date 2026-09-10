# Obligations on anyone using the kit blocks

The eleven shared blocks in `packages/kit` are done. Eight things fell out of
building them, and of building the first pages against them, that a consumer has
to know and cannot discover from the types. They're written down here because the working notes they came from are scratch and get deleted. These outlive them.

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

## Use `NoneCell` and `TagList` for a cell that means "none"

An empty table cell is ambiguous in a way that costs real time. A sighted
operator reads a blank cell as "still loading" or "something is broken", and a
screen reader reads it as nothing. Neither is what the data says.

```tsx
{ id: "scopes", header: "Scopes", cell: (k) => <TagList values={k.scopes ?? []} label="scopes" /> }
{ id: "lastUsedAt", header: "Last used", cell: (k) => k.lastUsedAt ? formatTimestamp(k.lastUsedAt) : <NoneCell label="last use" /> }
```

`NoneCell` renders an en dash with `aria-label={`no ${label}`}`. Both halves
matter: a dash alone is silent, and a visually-hidden label alone leaves the
cell looking blank. `TagList` maps values onto badges and falls through to
`NoneCell` when the array is empty, which is the case every hand-rolled version
of that cell got wrong, because a map over an empty array renders nothing.

Write the label to read after the word "no": `label="rooms"` becomes "no rooms".

These are blocks rather than a convention because the convention was hand-rolled
four times across two plugins and dropped in three separate rewrites, each time
because there was nothing to import and nothing to name.

## Reset the command hook when a dialog opens, and use `confirmDisabled` for "not yet"

Two things learned from pages built against `ConfirmDialog`, both about state
that outlives the row it belongs to.

A page holds ONE command hook and points it at whichever row the operator
clicked. That is the right shape: a hook per row would mean a hook count that
varies with the data. But a failure then sticks to the hook rather than to the
row, so opening the dialog for a different row shows the previous row's error
attributed to this one. The operator reads "this already failed" about
something they have not touched.

`useCommand` and `useHostCommand` return `reset()` for this. Call it when the
dialog OPENS, not when it closes:

```tsx
onClick={() => { remove.reset(); setDeleting(row) }}
```

Closing is not the only way a dialog goes away, and the state that matters is
the state the operator is looking at now. The same applies to inputs the dialog
carries: a ban reason left over from the previous row is the same defect in
different clothes.

Separately, `ConfirmDialog` takes `confirmDisabled` as well as `pending`. They
are different states and read differently. `pending` means "working on it" and
swaps the label to "Working…". `confirmDisabled` means "this dialog is still
missing something it needs" and leaves the label alone. A dialog that collects a
required value, a kick reason say, uses `confirmDisabled`; without it the choice
is between blocking on nothing and sending an empty one. Cancel stays enabled
under `confirmDisabled`, because somebody who cannot confirm must still be able
to back out.

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
