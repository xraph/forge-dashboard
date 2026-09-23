# Building an extension dashboard

How to move a Forge extension's dashboard from server-rendered templ onto the
React shell. Written from doing it once, for authsome, and from the things that
went wrong there.

Read this before you write anything. It will save you a week.

## What you are actually building

Two halves, in two repositories, and the first one does not exist yet for any
extension but authsome.

**The Go contract**, in the extension's own repo. Today these extensions
implement `contributor.LocalContributor` and render templ server-side. The
React shell cannot consume that. It speaks one thing: a POST envelope carrying
a contributor name and an intent name. So you add a contract contributor that
declares intents and answers them. `authsome/extension/contract/` is the worked
example, about twenty handler files. Copy its shape.

**The React plugin**, in `forge-dashboard`, as `packages/plugin-<name>`. It
declares routes and nav, and reads those intents. `packages/plugin-authsome` is
the worked example.

You cannot do the second without the first. A plugin whose contributor is not
in the capabilities response renders nothing at all, with no error anywhere,
because that is what an uninstalled extension is supposed to look like.

## Where the feature list comes from

**Not from the templ pages.** Use them as a checklist of what exists, never as
a design. The templ dashboard is being retired and its layout carries decisions
nobody wants to keep.

The real source is the extension's own Go services. The templ pages usually
expose a subset: they were written against whatever the store offered that
month. Read `<ext>/dashboard/contributor.go` to see what is on screen today,
then read the domain packages it imports to see what the extension can actually
do. Where those disagree, the domain wins, and say so in your notes.

Three questions per surface, answered from the Go source and not from guesswork:

- What does this page read? That is a query intent.
- What can somebody do here? Each is a command intent.
- What does the server do that the page never exposed? Those are the features
  worth adding while you are here.

## The contract, concretely

Each intent is a name, a request shape and a response shape. Copy field names
from the Go struct JSON tags. Never from a summary, including this one.

```go
// A query: no side effects, cacheable.
dispatcher.RegisterQuery(reg, "plans.list", v1, listPlansHandler(deps))
// A command: the envelope carries a CSRF token and an idempotency key.
dispatcher.RegisterCommand(reg, "plans.archive", v1, archivePlanHandler(deps))
```

Rules that are not obvious and cost real time when you get them wrong:

**Declare `meta.invalidates` on every command.** It names the query intents
that write affects. The React client refreshes through that and nothing else.
A create that does not invalidate its list looks like a write that silently
failed. There is no other refresh mechanism and pages must never call one.

**Say what paging you use and be consistent.** Cursor (`cursor` in, `nextCursor`
out) or page numbers, not both, and not "neither" on a list that will grow.
Authsome has intents of both kinds and it costs a translation layer in the UI.

**Optional update fields are pointers.** `*string` distinguishes "leave this
alone" from "set it to empty". A non-pointer field cannot express the
difference, and the UI will silently erase values the operator never touched.

**One-time secrets are a contract decision, not a UI one.** If a create returns
a value the server will never repeat, the response type says so and the stored
row keeps only a hash, tagged `json:"-"`.

## The React plugin

```tsx
export const ledgerPlugin = definePlugin({
  extension: "ledger",          // the Go contributor name. The join key.
  namespace: "ledger",          // the URL segment: /@ledger/plans
  label: "Billing",
  nav: [{ label: "Plans", to: "/plans", group: "Billing", priority: 0 }],
  routes: [{ path: "/plans", element: PlansPage }],
})
```

`extension` is the contributor name and getting it wrong means the plugin is
`hidden`: no routes, no nav, nothing logged. That silence is correct behaviour
for an extension that is not installed, which is exactly why a typo here is so
hard to find.

Read data with `useQuery("plans.list", params)` and write with
`useCommand("plans.archive")`. Both are in `@forge-go/dashboard-plugin`. Neither
takes a contributor name, because the client closes over it: a plugin cannot
address another extension's handlers even by accident.

Pages are plain components. No plugin package depends on react-router. Route
params arrive as a `params` prop, and links go through `PluginLink` with a
SCOPE-RELATIVE path (`/plans/p1`, never `/@ledger/plans/p1`), because the host
decides the mount point and it is not always what you think.

## Use the kit, and follow five conventions

`@forge-go/dashboard-kit` has the blocks: `ResourceTable`, `PageHeader`,
`QueryBoundary`, `CommandAlert`, `ConfirmDialog`, `SettingsForm`, `FilterBar`,
`DetailLayout`, `DescriptionList`, `StatGrid`, `EmptyState`, `NoneCell`,
`TagList`, `Timestamp`. Read `docs` in each before building your own. Anything
genuinely shared that is missing belongs in kit, not in your plugin.

Five conventions, each of which has been lost and restored at least once:

1. Identifier values carry `font-mono text-xs`. Monospace means "raw value you
   might copy".
2. The column an operator reads carries `font-medium`.
3. Every table caption carries a live row count, including at zero rows.
4. A cell meaning "none" uses `NoneCell` or `TagList`, never a blank and never a
   bare dash. A blank cell reads as "still loading" or "broken", and is silent
   to a screen reader. A possibly-absent timestamp uses `Timestamp`, because
   `formatTimestamp` returns an unlabelled dash you cannot attach a label to.
5. A badge's colour is the scan signal, not its text.

An earlier version of this rule said "outline for true or normal, secondary
for false". That was a bad summary of a binary, and it does not survive a
domain with more than two states. Relay hit the wall first with four:
delivered, queued, retrying and failed. Counting the badges actually in
`plugin-authsome` and `plugin-streaming` gives outline 51, destructive 27,
default 5, secondary 4, so the code was already using all four while the rule
described two.

The vocabulary, as used:

| variant | means | examples |
|---|---|---|
| `outline` | ordinary, the state most rows are in | active, enabled, verified |
| `default` | affirmative, the healthy outcome | delivered, granted, succeeded |
| `secondary` | notable but not wrong | draft, paused, queued, pending |
| `destructive` | the one an operator is hunting | failed, banned, revoked, rejected |

**Reserve `destructive` for the state somebody came to the page to find.** If
three of your four states are destructive, none of them is, and the scan is
gone. A domain with more states than this needs a considered mapping and not a
fifth colour, so write down which state maps to which and why.

## Things that went wrong last time

Every one of these shipped, and most passed their tests.

**Errors inside a dialog.** Base UI marks everything outside an open dialog
inert and `aria-hidden`. An error rendered on the page body while a dialog is
open is invisible to a real person. Put it inside the dialog. If a test needs
`hidden: true` to find something, the markup is wrong, not the test.

**One command hook, many rows.** A page holds one `useCommand` and points it at
whichever row was clicked, so a failure sticks to the hook rather than the row.
Call `reset()` when the dialog OPENS, and clear any inputs it carries. A command
firing straight from a row needs nothing.

**`pending` on every ConfirmDialog.** It does not debounce. Without it a
double-click sends the command twice. `confirmDisabled` is the separate state
for a dialog still missing a value it needs.

**A test that passes for the wrong reason.** `execute()` resolves `undefined`
only when the client THROWS a `ContractError`. A stub answering `{ ok: false }`
resolves normally, so a failure test built on one never runs the failure path.

**Losing detail in a rewrite.** Moving a hand-rolled table onto `ResourceTable`
dropped badge colours, empty-state labels, monospace on identifiers and live
counts, five times, across two packages. Before you replace any markup, list
what it renders, and account for every item afterwards.

**tsc and vitest disagree.** A plugin package's tsconfig carries no Node types,
so a test importing `node:fs` passes vitest and fails typecheck. Never write a
test that reads a source file with `fs`; use `import.meta.glob` with
`{ query: "?raw", eager: true }`. And run both: only `tsc` sees the barrel, so a
renamed export breaks the build while every test stays green.

## The bar

Per surface: it renders, it reads the right intent, every write goes out with
the right field names, every failure is visible to a person, and every empty
state says which kind of empty it is.

Per package: `test`, `typecheck` and `lint` all clean, and `pnpm -r test` too.
Scoping agents to one package has twice let a stale assertion in another sit
unnoticed for days.

Then run it. Start the fixture server and the shell, open the pages, and click
through. Every serious bug in the authsome migration was found by running it
and not by a test: a page whose errors were invisible, a tab strip where the
contributed tab never appeared, every panel visible at once, twenty-one links
that reloaded the whole app. The tests were green through all of it.

## Reach for a library, but load it lazily

You are not restricted to hand-rolled UI. Several of these domains need a real
editor, a real graph canvas, a real chart. Use one.

**Already in the kit**, so import rather than add: `recharts` for charts,
`@tanstack/react-table` and `@tanstack/react-virtual` for large or virtualised
tables, `@dnd-kit/*` for drag and drop, `cmdk` for a command palette, `sonner`
for toasts, `date-fns`, `zod`, `react-day-picker`, `react-resizable-panels`.
Check kit before adding anything; a second charting library in the same
dashboard is worse than no charts.

**Worth adding, per domain**, and none of these is present yet:

- A code editor for anything structured a person edits or reads: a policy
  document, a JSON payload, a config file, an event body. Monaco or CodeMirror.
  Read-only counts: a delivery response body in a viewer with folding beats a
  `<pre>`.
- A graph canvas where the domain is genuinely a graph. Resource types and
  relations are a graph. A hash chain is a chain. React Flow is the usual
  answer. Do not reach for one because a list feels boring.
- A diff view where two versions of a thing exist, which is most places with
  versioning or rotation.

**The constraint that matters: the shell is one eager chunk.** `BASELINE.md`
records it at 632 KB raw and 187 KB gzip with nothing lazy. Monaco alone is
several times that. Five extensions each adding an editor statically would
make first paint unusable for every operator, including the ones who never
open that page.

So load them at the route:

```tsx
const PolicyEditor = lazy(() => import("./pages/policy-editor"))

routes: [{ path: "/policies/:id", element: PolicyEditor }]
```

`PluginHost` wraps every page in `Suspense`, so a lazy route is legal and shows
a spinner where the page goes while its chunk arrives. That is recent: before
it, a lazy element threw, which is why nothing in the dashboard is split today.
Suspense stays transparent for a page that does not suspend, so ordinary pages
cost nothing.

Two obligations if you add one. Re-measure and write the new numbers into
`BASELINE.md`, because "one chunk" stops being true the moment you split and
the file should say what the eager entry now is. And check the chunk actually
splits in `pnpm build` output rather than assuming: a stray static import of
the same module anywhere else pulls it straight back into the entry.

For charts specifically, invoke the `dataviz` skill before writing the first
line of chart code. For anything you are designing rather than porting,
`frontend-design`.

## Retiring the templ dashboard

The migration is not finished when the React pages work. It is finished when
the templ dashboard is gone from the extension.

Leaving both is the worst outcome available. Two dashboards drift, operators
find whichever one their bookmark points at, and every future change has to be
made twice or gets made once and silently disagrees. The templ pages exist to
tell you what to build. Once you have built it, they are a liability.

So: **delete the extension's `dashboard/` directory, and every templ page,
component and widget in it, along with the `LocalContributor` that registers
them.** Do it in the extension's own repo.

Five things to do first, in this order, because after deletion there is no
reference to go back to.

**1. Write the feature inventory down while the pages still exist.** Every
page, every column, every action, every filter, every badge, every empty state.
This is the only record of what the old dashboard did, and you are about to
remove the source. Put it in the extension's `MIGRATION.md`, not in a scratch
file.

**2. Account for every item.** Migrated, deliberately dropped, or blocked on
work nobody has done. Name which, per item. "Deliberately dropped" needs a
reason in the file: a page that always said the same thing, a stat computed
in-process that no intent can answer. A feature nobody can account for is a
feature you are deleting by accident.

**3. Find what else imports it.** `grep -rn "<ext>/dashboard" --include='*.go'`
across the extension. The dashboard package usually exports more than pages:
widgets other plugins mount, nav items, sometimes helpers that leaked. Removing
it can break compilation somewhere unrelated, and that is better found now than
in a build.

**4. Check the extension still builds and its tests pass** with the directory
gone. `go build ./... && go test ./...`, not a partial run.

**5. Delete it as its own commit**, separate from the migration. A commit that
adds a contract, adds a React plugin and removes several thousand lines of
templ is a commit nobody can review or revert cleanly.

If something in the templ dashboard turns out to have no contract equivalent
and no way to build one, do not delete that page and do not quietly drop it.
Stop, record it in `MIGRATION.md`, and say so in your report. Authsome shipped
with fourteen such surfaces and the honest list is what makes its dashboard
trustworthy.
