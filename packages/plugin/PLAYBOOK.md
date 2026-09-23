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
5. A badge's colour is an attention budget, not a label.

This rule has been wrong twice and the second version was wrong in a more
interesting way than the first, so both corrections are kept here.

It began as "outline for true or normal, secondary for false", which is a
binary and does not survive a domain with four states. Counting the badges
actually rendered in `plugin-authsome` and `plugin-streaming` gives outline
51, destructive 27, default 5, secondary 4, so the code was already using all
four while the rule described two.

The replacement was a table mapping variant to meaning, and Relay found that it
contradicted itself. It listed `delivered` as an example of `default` while
also saying `outline` is for "the state most rows are in". On a delivery log
those are the same state, usually by a very long way. Give a solid filled badge
to ninety five percent of a page and the colour has stopped signalling
anything, because ninety five percent of anything is background.

The mistake was conflating two axes: what a state MEANS, and how much of the
page it OCCUPIES. Only the second one decides a badge.

So the rule is proportion first:

**Whatever state holds most of the rows takes `outline`, whatever its
semantics.** The majority recedes. Then the rest ramp up by how much a row
should interrupt somebody who is scanning, with `destructive` reserved for
what they came to find.

Relay's delivery log, as the worked example: outline for delivered, secondary
for queued, default for retrying, destructive for failed. Note that the
healthy outcome takes the quietest variant there, which reads wrong until you
remember what the page is for.

When states are roughly balanced, as in a bounded resource list, semantics is
a reasonable tie-break and this table is a starting point rather than a lookup:

| variant | typically |
|---|---|
| `outline` | the ordinary state, and always the majority one |
| `secondary` | notable but not wrong: draft, paused, queued |
| `default` | affirmative, or the one worth a second look |
| `destructive` | the state somebody came to the page to find |

The corollary I wrote earlier, that if three of four states are destructive
then none of them is, turns out to be the same observation from the other end.
It reads like a rule about meaning and it is really a rule about proportion.

Write your mapping down with its reasons. A domain that needs something these
four cannot express needs a considered answer, not a fifth colour.

**When the majority state is not knowable at design time, colour cannot carry
the scan, so stop asking it to.** Volume is often a property of the deployment
rather than of the domain. Delivered dominates a webhook log in every healthy
installation, so that mapping is safe to fix. Allow-versus-deny in an
authorization log is not: on a permissive system the denies are the
interesting minority, on a restrictive one they are the wallpaper, and a
mapping that is right on your data is inverted on a customer's.

Three things follow. Pick a stable semantic mapping from the table above and
accept that the badge is weak on that page. Put the work into filtering, so
the rare case is findable by query rather than by eye. And do NOT compute
weight from the distribution of the page currently on screen: a state that is
outline on page one and destructive on page two is worse than any fixed
mapping, because the operator can no longer learn the page at all.

The underlying mistake generalises past badges. Any time a design maps a
visual property to a CATEGORY when it should map to a FREQUENCY, the same
thing happens: row striping, icon weight, anything whose job is to decide how
much of the screen a thing gets.

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

## Check the write path before you trust it

Three sessions have now found that something they were about to build a UI on
does not do what it appears to do. The pattern is the same each time: a layer
exists, looks complete, and is not wired to anything that would reveal it. Run
these three checks before designing any page that writes.

**Is the thing that stores this actually constructed?** Vault's extension
advertises a `vault.Vault` that a later phase never delivered, so the extension
wires a store and nothing else. Two live bugs fall out: secret create persists
a blank value because the form sets `Value` while the store writes only
`EncryptedValue`, and `audit.NewLogger` is never constructed anywhere, so every
audit surface reads a table nothing writes. An audit page that renders an empty
table beautifully is worse than no page, because it reads as "nothing
happened". Grep for the constructor, not the type.

**Does the same write behave the same on every backend?** Relay's DLQ replay
differs across all five stores. Three leave `MaxAttempts` at zero, so the
retrier evaluates `1 < 0` and sends a replayed delivery straight back to the
queue it came out of. Only the in-memory store is correct, which means every
developer sees behaviour no production deployment has. Check a write that
reconstructs an entity against each backend rather than against memory.

**Does the conformance suite populate the fields you are about to write?**
This is the subtlest of the three and Warden found it. It has a proper
cross-backend suite covering tenant isolation, uniqueness, junction integrity
and expiry, run by all four backends. It looks like exactly the thing that
would catch a parity bug. But every policy it constructs leaves five fields
empty, and those five are `db:"-"`, persisted as postgres jsonb, sqlite JSON
strings, mongo native arrays and a memory deep copy. Three serializations,
zero coverage of the populated round trip, which is precisely what a policy
editor writes.

So the question is never "is there a conformance suite". It is "does it
populate the fields my new write path populates". A suite that only ever
builds empty structs is the same class of problem as a fixture that accepts a
write and changes nothing: it passes, and it is testing the absence of your
feature.

## Your dashboard inherits the extension's correctness

Before you build anything, find out what the extension's own tests cover. Your
plugin will be well tested, because this playbook insists on it, and that
counts for nothing if the thing underneath it has never been checked.

Ledger is the case. The repo has three test files: ids, a money type, and a
docs test. There are no tests on the engine, none on any of the four store
backends, and none on invoice generation. Its own implementation plan targets
eighty to ninety percent coverage, and the phase that computes money is
entirely unchecked boxes. A billing dashboard sitting on that is displaying
numbers nobody has verified, confidently, in the place where being wrong costs
the most.

That does not mean stop. It means three things.

**Test what you add, properly, including the Go you write.** New pure functions
and at least one real store backend. You are adding to the foundation, so add
something sound.

**Say what you did not cover, in the extension's `MIGRATION.md`, in plain
words.** "The three SQL and document backends get compile-time conformance
only" is worth more than silence, and far more than a green test badge that
implies a coverage nobody has. Ledger's session wrote exactly that and it is
the right instinct.

**Do not let your own coverage imply the stack's.** A plugin package at a
hundred percent, sitting on an engine at zero, produces a dashboard that looks
trustworthy for reasons that have nothing to do with whether its numbers are
right.

There is also no harness to borrow when this is the situation, so budget for
building one rather than discovering it halfway through. And if the gap is
severe enough, which for money it is, say so to whoever owns the extension
rather than only recording it. That conversation outranks the migration.

## Never render an absence as a pass

The sharpest failure in this batch is not a bug in a write path. It is a
dashboard truthfully reporting a green state that means nothing is protecting
you.

Chronicle found it. `TamperEvidenceConfig.Digest` defaults to `"plain"` and
`CheckpointConfig.Enabled` defaults to `false`, with the checkpointer builder
returning nothing when it is. So an unconfigured Chronicle verifies at
`LevelUnkeyed` with zero checkpoints, and that level's own doc comment says it
detects corruption, not tampering. The weakest state the library supports is
the state every deployment starts in.

A verification page built the obvious way says "verified" there, and it is not
lying. It is answering a question nobody asked. The operator wants to know
whether the record can be trusted, and at that level the honest answer is that
nothing would catch somebody who edited it deliberately.

So, for any feature whose value is protection:

**Find the defaults before you design the page.** A security capability that is
off unless configured is the common case, not the exotic one, because nobody
configures what they have not been told about.

**Make the coverage ceiling the content, not a footnote.** When protection is
partial, the most useful thing the page can say is what is switched off and
what switching it on would buy. That is the page, for most deployments.

**Do not let a strong word describe a weak state.** "Verified", "secure",
"protected" and a green badge all claim more than an unkeyed digest earns.
Name the level.

This inverts the usual advice to design the good case as the common case. Here
the common case is the weak one, and designing for the configured deployment
first produces a dashboard that is most reassuring to exactly the people who
should be least reassured.

The same shape is worth checking anywhere protection is optional: webhook
signature verification, encryption at rest, audit logging, rate limiting,
policy enforcement modes that default to permissive.

### The other half: an abandoned search is not an answer

Warden found the mirror image, and it is the more dangerous of the two because
it hides in the direction people check least.

Warden's defaults are good. It requires a tenant, enables all three models and
check logging, and denies by default and on store error. Fail closed, which
looks safe. But `evaluateReBAC` has two empty case bodies, one for
`ErrGraphDepthExceeded` and one for `ErrGraphBudgetExceeded`, and then falls
through to a definite `DecisionDenyRelation` carrying the reason "no relation
grants this access". So a check that stopped walking at its visit cap tells
every caller it looked and found nothing. Not "I gave up". Not "partial". A
definite negative with a reason string that is false, and `CheckResult` carries
no signal, so it is invisible from outside the engine.

Chronicle renders an absence of protection as a pass. Warden renders an
incomplete search as a definite answer. Same root: a system reporting
confidence it has not earned. The fail-closed direction gets checked less
because denying looks conservative, and it is not conservative when the denial
is wrong and the reason sends somebody hunting a missing relation that is
actually there.

So the question is not only "does an unconfigured system look configured". It
is also **can this surface distinguish a completed search from an abandoned
one**. Budgets, depth caps, timeouts, visit limits and truncated result sets
all produce this, and a UI that renders a capped walk as an empty result is
telling the same lie the engine told it.

Two consequences for the page. If the backend cannot distinguish the two,
that is a finding to raise rather than a nuance to render around, and it may
need a field adding before your page can be honest. And where you cannot get
the distinction, say less: "no relation matched within the graph budget" is
worse copy than "no relation matched" and it is true, which is the trade to
make every time.

## Fixtures

`packages/fixture-server` is what you develop against, and a bad fixture hides
exactly the bug it should expose.

**A write must visibly change the next read.** A fixture that accepts a command
and answers the same data forever cannot demonstrate that invalidation works,
and `meta.invalidates` is the only refresh mechanism this client has. Create a
room, see the list grow. Issue an invoice, see it leave draft.

**Model the contract you are shipping, not the behaviour deployed today.** If
your spec includes a server fix, the fixture implements the fixed contract.
Relay hit this first: its real backends fail a second replay with not-found,
because the first replay deleted the row, and the fix marks the row and refuses
on purpose. The fixture models the refusal. That is a fixture deliberately
disagreeing with production, which is right, and it has to be written down in
the spec or somebody later reads it as a bug and helpfully corrects it back to
the broken behaviour.

**Preserve the server's unhelpful behaviours.** If an intent answers an empty
list for a missing parameter rather than an error, the fixture does too. A
forgiving fixture turns "the page forgot to send a tenant id" into a page that
looks perfectly correct.

**Exercise it over HTTP, not by reading it.** Walk every intent you added and
check each answers a well-formed response. A handler that exists and throws on
its first call is worse than a missing one, because the missing one is obvious.

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

- A code editor for anything structured a person edits or reads: a JSON
  payload, a config file, an event body. Read-only counts: a response body in
  a viewer with folding beats a `<pre>`.

  **First check the thing has a text form at all.** Warden was told to put an
  editor on policies and found that a policy has no text representation: it is
  structured, with subjects, actions, resources and conditions over eighteen
  operators. An editor there means inventing a format the server never parses.
  The editor belonged on Warden's DSL instead, which is a real language with a
  real parser that reports `Pos{Line, Col}`, so gutter markers mean something.
  Structure gets a structured editor. Text gets a text editor.

  **CodeMirror unless you can justify Monaco.** They read as interchangeable
  and are not. Monaco is 3 to 5 MB raw against a 632 KB shell, so it is a lazy
  chunk five to eight times the size of the entire application. Two sessions
  reached for Monaco on my advice, read the domain, and independently landed
  on CodeMirror 6: Warden's DSL is 47 flat keywords with no context-sensitive
  lexing, about forty lines of `StreamLanguage`, and Vault's config values are
  small blobs rather than files. Monaco earns its weight for a large language
  with real tooling expectations. For a small custom one it does not.
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
