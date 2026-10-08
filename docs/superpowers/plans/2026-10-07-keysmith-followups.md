# Keysmith follow-ups: idempotency claim, cross-tab context, load-proof tests, forge release

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three items left open by `2026-10-07-keysmith-open-findings.md` and prepare a forge release so keysmith can register `keys.create` and `keys.rotate` with `dispatcher.SecretResponse()`.

**Architecture:** Task 1 is forge, Tasks 2 and 3 are forge-dashboard with disjoint files, Task 4 is the controller's release preparation, and Task 5 waits on a published forge tag. Nothing is pushed or tagged without Rex's explicit yes for that exact action.

**Spec:** Rex's "fix all these too" (2026-10-07) and "start on a forge release so keysmith can switch on SecretResponse()". The open-findings plan's Global Constraints still bind.

## Global Constraints

- Same as `docs/superpowers/plans/2026-10-07-keysmith-open-findings.md` Global Constraints: main in each repo, exact-path `--only` commits, temporary index for files with foreign changes, the forbidden git commands, Rex's voice through `rex-voice` then `humanizer`, no em or en dashes, no attribution, fresh-cache lint, never dispatch subagents.
- No push, no tag, no release PR merge without Rex's yes for that action.

---

### Task 1: forge holds a claim while a command runs (forge)

**Files:** `extensions/dashboard/contract/dispatcher/` (`dispatcher.go`, tests), `extensions/dashboard/extension.go` (the adapter), `extensions/dashboard/contract/idempotency/` if the adapter needs a claim surface.

Today `dispatchInner` looks the key up, runs the handler with no claim held, then stores the answer. Two dispatches with the same idempotency key and identity that overlap both miss the store and both run, so a secret command can mint two keys.

- [ ] Add an optional claim surface the dispatcher discovers by type assertion (for example `IdempotencyClaimer` with a claim that returns a release function), so every existing `IdempotencyStore` implementation compiles unchanged. Back it in the production adapter with the shared middleware store's own claim mechanism (`idempotency.InMemoryStore` already claims keys; read how before designing).
- [ ] With a claimer present, a command with an idempotency key claims `(key, identity)` before the handler runs and keeps the claim until its answer or tombstone is stored, or the handler fails (then releases, storing nothing).
- [ ] A second dispatch that finds the claim held waits a bounded time for it to end, then looks the key up again and answers from the cache (the cached response, or CONFLICT for a tombstone). If the claim is still held when the wait ends, or its context ends, it answers CONFLICT with a message saying the same command is still running. It never runs the handler while another holds the claim.
- [ ] Without a claimer, behaviour is exactly as today.
- [ ] Tests: two concurrent dispatches of a secret command with one key run the handler once (one gets the response, the other CONFLICT); concurrent non-secret duplicates run once and both get the response; a failed first handler releases the claim and a retry runs; the wait bound answers CONFLICT; the production adapter path through `idempotency.NewInMemoryStore()` is covered; `-race`.
- [ ] Commit: `fix(dashboard): run a command once while its idempotency key is held`.

### Task 2: every tab drops another org's answers (forge-dashboard)

**Files:** `packages/host/src/host/` (where `queryStore.clear()` is called for a context or identity switch: `ContextSwitchers.tsx`, `PluginHost.tsx`, `RoutedScope.tsx`), `packages/plugin/src/store.ts` only if a small additive hook is needed, host and plugin tests. Check `git diff` on each file first; `packages/host/src/ForgeDashboard.tsx` carries another session's changes.

- [ ] When a tab clears the query store because the context or identity changed, it tells the other tabs of the same origin (BroadcastChannel, with a `storage`-event fallback where BroadcastChannel is missing), and each receiving tab clears its own store the same way, so their pages refetch under the new context. A tab never reacts to its own message.
- [ ] When a hidden tab becomes visible again, the host revalidates every watched query (invalidate, not clear), so a context change made outside the dashboard shows up on return. Throttle it so rapid tab flips do not stampede (one revalidation per return, and not more often than a sensible minimum interval you choose and document).
- [ ] Tests: a clear in one host broadcasts and a second store clears; the sender ignores its own message; becoming visible invalidates watched queries once; a quick hide/show inside the interval does not.
- [ ] Commit(s) by concern.

### Task 3: the two load-sensitive tests stop timing out (forge-dashboard)

**Files:** `packages/plugin-keysmith/test/create-key-dialog.test.tsx` (the "never allows a date..." test), `packages/plugin-relay/test/` (the deliveries "fixes the created window..." test). Test files only, unless a test exposes a real product bug (then stop and report).

- [ ] Reproduce under the machine's current load by running each package's suite a few times; record the timings.
- [ ] Find why each is slow (real timers, `userEvent` delays, waiting on default `findBy` timeouts, large renders) and fix the cause: fake timers, `userEvent.setup({ delay: null })` or an advanced-timers setup, narrower waits. Raising a timeout is acceptable only beside a fix of the cause, with a comment saying why.
- [ ] Each test passes 10 times in a row inside its full package suite under the current load; report load average and timings before and after.
- [ ] Commit: `test(plugin-keysmith): ...` and `test(plugin-relay): ...` separately.

### Task 4: prepare a forge release (controller)

- [ ] Establish how forge releases (release-please, `release.yml`, `scripts/release-modules.sh`, CHANGELOG) and what a release from local main would carry (224 unpushed commits on 2026-10-07, many from other sessions).
- [ ] In a scratch clone (never the shared checkout), build the patch option: `v1.12.0` plus the dispatcher commits from Task 1 and b2dc5c71, and check it builds and tests.
- [ ] In a scratch copy of keysmith, point at that candidate (replace directive) and check keysmith builds and tests against it, adopting `SecretResponse()` on `keys.create` and `keys.rotate`.
- [ ] Put the options and exact commands in front of Rex. Push or tag only on his yes.

### Task 5: keysmith adopts SecretResponse (keysmith), after a published tag

forge v1.12.1 is published (2026-10-07): public v1.12.0 plus b2dc5c71. It does not carry the claim fix (eb92b9bd, 903d90a2).

- [ ] Bump `github.com/xraph/forge` from v1.10.0 to v1.12.1 (`go get`, `go mod tidy`; read the `go.mod`/`go.sum` diff and say what else moved). Register `keys.create` and `keys.rotate` with `dispatcher.SecretResponse()` in `extension/contract/contract.go`.
- [ ] Test through a real dispatcher with an idempotency store: a second `keys.create` and a second `keys.rotate` with the same idempotency key and user answer CONFLICT, run the handler once (one key created, one rotation), and no stored entry or response body holds the raw key. A non-secret command still replays normally.
- [ ] MIGRATION.md: the idempotency open finding becomes fixed for replays (v1.12.1, b2dc5c71): a replay answers CONFLICT and the raw key is never kept. A new open line: two overlapping dispatches with one key can still both run and mint two keys until a forge release from main carries eb92b9bd and 903d90a2. Breaking changes: keysmith now needs forge v1.12.1.
- [ ] `go build ./... && go test ./...`, `make test-backends`, fresh-cache lint.

### Task 6: the create and rotate dialogs keep one idempotency key per filled form (forge-dashboard)

Ruling (controller, 2026-10-08): yes. Every press of Create or Rotate sends a fresh key today, so neither the forge claim nor the tombstone protects a dashboard user whose response was lost; a per-form key is the only way they do.

- [ ] `create-key-dialog.tsx` and the rotate dialog mint one idempotency key when the form opens and pass it through `execute(payload, { idempotencyKey })`. Any edit to a field that changes the payload mints a new key. A successful reveal, closing the dialog, or a context clear ends the key.
- [ ] A CONFLICT answer on create or rotate whose message says the command already ran shows one plain explanation instead of the raw error: a key was created (or rotated) but its secret is not shown again; revoke it from the list (or rotate again) and try again. It links to the key list.
- [ ] A TRANSPORT error on create or rotate says a key may have been created (or rotated) and to check the list before trying again, and keeps the same idempotency key so a retry is safe.
- [ ] The fixture models the v1.12.1 server: a repeated `keys.create`/`keys.rotate` with the same idempotency key and user answers CONFLICT with the dispatcher's message, and creates nothing.
- [ ] Tests: same key across a retry after a TRANSPORT failure; a new key after an edit; CONFLICT copy; no raw key in the store or the DOM after a CONFLICT. `pnpm --filter` keysmith tests, typecheck, lint.
