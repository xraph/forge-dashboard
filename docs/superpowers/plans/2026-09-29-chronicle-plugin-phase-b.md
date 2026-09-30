# Chronicle plugin (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/plugin-chronicle`, the React plugin that renders chronicle's 29-intent dashboard contract. Verification of the operator's chain is the landing surface. Add the `enabled` option to `useQuery` that four of its reads need, and a fixture that serves an intact chain, a plain chain, a broken chain and a truncated one.

**Architecture:** A Vault-shaped plugin package: hand-written wire types in `src/types.ts`, the badge mapping in `src/badges.tsx`, and one page per route. The page logic that decides what a verification result *says* lives in pure modules under `src/verification/` and is tested without React. That's where this dashboard's claims are made, so that's where the tests concentrate. The fixture is a new `packages/fixture-server/chronicle-fixtures.mjs` registered in `server.mjs` like Vault's.

**Tech Stack:** React 19, TypeScript ~6, vitest 5 + @testing-library/react + jsdom, `@forge-go/dashboard-plugin` (useQuery/useCommand/definePlugin), `@forge-go/dashboard-kit` (PageHeader, ResourceTable, QueryBoundary, ConfirmDialog, FilterBar, DetailLayout, DescriptionList, StatGrid, NoneCell, TagList, Timestamp, Badge, chart), recharts 3.8 via kit, CodeMirror 6 (lazy, copied from plugin-relay), plain node:http fixture server.

**Spec:** `docs/superpowers/specs/2026-09-23-chronicle-dashboard-migration-design.md`, "The React half", "Amendments from implementation" (including "Changed by the final review", "Running before authsome sends claims" and "What the React plugin has to get right") and "Testing". Also `packages/plugin/PLAYBOOK.md`, in full, before any task.

**Wire reference:** `/Users/rexraphael/Work/xraph/forgery/chronicle/.superpowers/sdd/2026-09-23-chronicle-contract-phase-a/wire-reference.md` is the field-by-field reference for all 29 intents, taken from chronicle `main` at b68d571. `src/types.ts` in Task 2 is transcribed from it. Where this plan and the wire reference disagree about a field, the Go code on chronicle `main` wins. Check it and say so in your report.

**Conventions reference:** `/Users/rexraphael/Work/xraph/forgery/chronicle/.superpowers/sdd/2026-09-23-chronicle-contract-phase-a/plugin-conventions.md` records how the sibling plugins are built. It's a map of this repo taken on 2026-09-29.

## Global Constraints

- Plugin identity: `extension: "chronicle"`, `namespace: "chronicle"`, `label: "Chronicle"`. A typo in `extension` hides the plugin with nothing logged.
- Package name `@forge-go/dashboard-plugin-chronicle`, directory `packages/plugin-chronicle`, scaffolded like `packages/plugin-vault`: the same `package.json` shape, `tsconfig.json`, `vitest.config.ts` and `eslint.config.js`.
- Shared tree, not a worktree. Several other sessions edit this checkout at the same time. Stage with explicit paths only: never `git add -A`, `git add .` or `git commit -a`. When a file you touch also holds another session's uncommitted hunks (`apps/shell/package.json`, `apps/shell/src/App.tsx`, `packages/fixture-server/server.mjs`, `packages/fixture-server/verify.mjs`, `pnpm-lock.yaml`), stage only your own hunks: `git diff <file> > /tmp/p.patch`, trim it to your hunks, then `git apply --cached /tmp/p.patch`. Check with `git diff --cached` before every commit. If you can't separate the hunks cleanly, stop and report it. Never commit another session's work.
- Never read or write `.superpowers/` in this repo, and never stage `docs/` files you didn't write for this plan.
- Commit messages: conventional subject, no `Co-Authored-By` or any other trailer, no em dashes. No em dashes anywhere in code, comments, UI copy or docs either. Use a comma, a colon, a full stop or parentheses.
- Colour: the kit is near-monochrome. Saturated colour (the `destructive` token) means failure and nothing else. There is no success-green token. Don't add one, and don't use any `green`, `emerald` or `lime` Tailwind class.
- A badge means an opinion was formed. "Not checked" is plain `text-muted-foreground` text with no badge chrome.
- Badge variants follow the spec's table ("Badges, and the column that isn't there"), not the older binary "`outline` for normal and `secondary` for false" line in the spec's "Kit and conventions" section. PLAYBOOK retired that rule.
- Identifiers carry `font-mono text-xs`: event ids, stream ids, hashes, sequence numbers, checkpoint ids, sign key ids, policy ids, erasure ids and report ids. The `action` column carries `font-medium`. Every table caption carries a live count, including at zero. `NoneCell` for an absent value, `Timestamp` for every time that can be absent.
- Sequence numbers are formatted with `formatSeq` from `src/format.ts` (en-US grouping, "12,431") everywhere they're read by a person, and never with grouping inside a copyable hash or id.
- Never describe a result as verified, secure, protected or tamper-proof, and never show a check mark, when its coverage is `unkeyed` or nothing was verified. Saying that nothing was verified, as in the spec's "No events verified", is fine: it's a statement of absence, not a claim.
- `verify.run`, `verify.event`, `retention.preview` and `erasures.preview` are read with `useQuery(intent, params, { enabled })`. They run only on an explicit operator action or on a dialog opening, never on mount.
- Route params are the only way a page receives input from the URL. Plugins can't read the query string. Deep links use path segments.
- The shell compiles plugin source with `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. Use `import type` for types, and no `enum` and no parameter properties.
- Tests: stub failure paths with a throwing `ContractError`, never a resolving `{ ok: false }`. Never read a source file with `node:fs` in a test; use `import.meta.glob(path, { query: "?raw", eager: true })`.
- Per package: `pnpm --filter @forge-go/dashboard-plugin-chronicle test`, `typecheck` and `lint` all clean at the end of every task. Plus `pnpm --filter @forge-go/dashboard-plugin test` for Task 1, and `pnpm -r test` at the end of Task 13.

## Review Focus

These are the inputs the spec implies but no happy-path test reaches, most likely first. Each line names the task whose tests pin it.

1. **A chain wiped to head zero on a deployment without checkpoints.** `verify.run` answers `valid: true, verified: 0` with every checked flag false. The page must say "No events verified" and show the coverage ceiling, never a pass (Task 4, `verdict.test.ts` "valid with nothing verified").
2. **An app-wide operator whose own app-level scope has no chain but whose tenants do.** `streams.mine` answers `{}` while `streams.list` holds tenant chains. The chain page must offer those chains, not say there is no chain (Task 5, "app-wide viewer with only tenant chains").
3. **A verify range over the 100,000-event cap.** It is BAD_REQUEST with the server's message. The default window must stay under the cap, and a whole-chain request on a longer chain must render the server's message and offer the bounded window, not a blank error card (Tasks 4 and 5).
4. **`checkpoints.list` with `supported: false`,** which older servers answer with `checkpoints: null`. The page renders "This deployment stores no checkpoints" and never crashes on null (Task 6, "unsupported with null checkpoints").
5. **A tenant viewer looking at a governing app-level policy (`editable: false`).** No edit or delete action is offered, and the row says an app-wide operator manages it (Task 11, "governing policy offers no actions").

## File Structure

```
packages/plugin/src/hooks.ts                       Task 1: useQuery gains options { enabled }
packages/plugin/test/use-query-enabled.test.tsx    Task 1
packages/plugin-chronicle/
  package.json tsconfig.json vitest.config.ts eslint.config.js   Task 2
  src/index.tsx          definePlugin: nav, sections, routes      Task 2, grows each task
  src/types.ts           every wire type, from the wire reference Task 2
  src/format.ts          formatSeq, shortHash, durationLabel      Task 2
  src/badges.tsx         the badge mapping and its reasons        Task 2
  src/components/dialog-error.tsx  copied from plugin-relay       Task 2
  src/components/chain-picker.tsx  own chain or a tenant chain    Task 5
  src/components/json-view.tsx, json-editor.tsx  copied from plugin-relay  Task 8
  src/verification/tri-state.ts    tri(checked, ok)               Task 4
  src/verification/verdict.ts      the verdict sentence           Task 4
  src/verification/breaks.ts       break rows from a report       Task 4
  src/verification/window.ts       default and whole-chain ranges Task 4
  src/verification/ribbon.tsx      the span ribbon                Task 5
  src/verification/certificate.tsx verdict, ribbon, breaks, checks, limits  Task 5
  src/pages/settings.tsx           Task 2
  src/pages/chain.tsx              Task 5
  src/pages/checkpoints.tsx, checkpoint-detail.tsx   Task 6
  src/pages/events.tsx, user-events.tsx              Task 7
  src/pages/event-detail.tsx       lazy                            Task 8
  src/pages/activity.tsx           Task 9
  src/pages/erasures.tsx, erasure-detail.tsx         Task 10
  src/pages/retention.tsx, policy-detail.tsx, policy-create.tsx, archives.tsx  Task 11
  src/pages/reports.tsx, report-detail.tsx, report-create.tsx, custom-report-create.tsx  Task 12
  test/harness.tsx       copied from plugin-relay, extension "chronicle"  Task 2
  test/setup.ts          CodeMirror mock, copied from plugin-relay        Task 8
  test/*.test.ts(x)      one per module or page
packages/fixture-server/chronicle-fixtures.mjs     Task 3
packages/fixture-server/server.mjs                 Task 3: import, CONTRIBUTORS entry, reset
packages/fixture-server/verify.mjs                 Task 3: INPUT entries, spot checks
apps/shell/package.json, apps/shell/src/App.tsx    Task 13: registration
BASELINE.md                                        Task 13: re-measured
```

Routes (scope-relative). Detail and create routes have no nav entry.

| path | page | nav |
|---|---|---|
| `/` and `/chain` | ChainPage (own chain) | Integrity: "Chain" |
| `/chain/:streamId` | ChainPage for a chosen chain | none |
| `/chain/:streamId/:fromSeq/:toSeq` | ChainPage, range filled in and ready to run | none |
| `/checkpoints` and `/checkpoints/in/:streamId` | CheckpointsPage | Integrity: "Checkpoints" |
| `/checkpoint/:id` | CheckpointDetailPage | none |
| `/events` | EventsPage | Log: "Events" |
| `/events/:id` | EventDetailPage (lazy) | none |
| `/users/:userId` | UserEventsPage | none |
| `/activity` | ActivityPage | Log: "Activity" |
| `/reports` | ReportsPage | Compliance: "Reports" |
| `/new-report`, `/new-custom-report` | ReportCreatePage, CustomReportCreatePage | none |
| `/reports/:id` | ReportDetailPage | none |
| `/erasures` | ErasuresPage | Compliance: "Erasures" |
| `/erasures/:id` | ErasureDetailPage | none |
| `/retention` | RetentionPage | Retention: "Policies" |
| `/new-policy` | PolicyCreatePage | none |
| `/retention/:id` | PolicyDetailPage | none |
| `/archives` | ArchivesPage | Retention: "Archives" |
| `/settings` | SettingsPage | Settings: "Settings" |

Two departures from the spec, decided here, and recorded in the spec by Task 13:

- **The events table does not virtualise.** Every list in this dashboard is server-paged, and kit's `ResourceTable` renders one page (50 rows by default, 200 at most). A virtualiser over 200 rows adds a dependency and a second scroll model for no measurable gain. The spec's reason for virtualising, never filtering or paging in the browser, holds without it.
- **The chain page has a chain picker for an app-wide operator.** The spec's "no stream picker" predates the final review. An app-wide operator has one chain per tenant, and `verify.run` takes a `streamId` for exactly this. A tenant operator has one chain and sees no picker.

---
### Task 1: `useQuery` gains `{ enabled }`

The spec's "The platform change": four chronicle intents are expensive, run by the operator and have no side effects. Making them commands would misdeclare reads as writes. This lands in its own commit, with its own tests, because every extension with a "preview before you destroy" dialog will use it.

**Files:**
- Modify: `packages/plugin/src/hooks.ts` (the `useQuery` function; `useHostQuery` gets the same option)
- Test: `packages/plugin/test/use-query-enabled.test.tsx`

**Interfaces:**
- Produces: `export interface QueryOptions { enabled?: boolean }` and `useQuery<T>(intent: string, params?: Record<string, unknown>, options?: QueryOptions): QueryState<T>`, exported from `@forge-go/dashboard-plugin`. `useHostQuery` takes the same third argument.
- Semantics:
  - `enabled` defaults to `true`, which keeps today's behaviour byte for byte.
  - While `enabled` is `false`:
    - no request is sent;
    - the hook does NOT subscribe to the store key, so an invalidation of that intent can't re-issue it through a stale fetcher;
    - the returned state is exactly `{ data: undefined, error: undefined, loading: false, refetch }`, whatever the store holds for that key;
    - `refetch` does nothing.
  - When `enabled` turns `true`, the hook behaves like a fresh mount: it subscribes, then reads.

- [ ] **Step 1: Read the current hook and store**

Read `packages/plugin/src/hooks.ts` and `packages/plugin/src/store.ts` in full, and find where the barrel `packages/plugin/src/index.ts` exports `QueryState` so `QueryOptions` can sit beside it. Read how `packages/plugin-vault/src/use-evaluate.ts` works around the missing option: it's the use case this replaces. Don't change Vault in this plan.

- [ ] **Step 2: Write the failing tests**

```tsx
// packages/plugin/test/use-query-enabled.test.tsx
import { act, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { PluginProvider, queryStore, useQuery } from "../src"
import type { ScopedClient } from "../src"

beforeEach(() => queryStore.clear())

function countingClient() {
  const calls: { intent: string; params?: Record<string, unknown> }[] = []
  const client = {
    extension: "chronicle",
    query: async (intent: string, params?: Record<string, unknown>) => {
      calls.push({ intent, params })
      return { answer: intent }
    },
    command: async () => undefined,
  } as unknown as ScopedClient
  return { client, calls }
}

function Probe({ enabled }: { enabled: boolean }) {
  const q = useQuery<{ answer: string }>("verify.run", { fromSeq: 1 }, { enabled })
  return (
    <div>
      <span data-testid="loading">{String(q.loading)}</span>
      <span data-testid="data">{q.data?.answer ?? "none"}</span>
      <button onClick={q.refetch}>refetch</button>
    </div>
  )
}

describe("useQuery with enabled", () => {
  it("sends nothing and reports idle, not loading, while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>,
    )
    // Give any stray effect a chance to fire.
    await act(async () => {})
    expect(calls).toHaveLength(0)
    expect(screen.getByTestId("loading").textContent).toBe("false")
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("does nothing on refetch while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>,
    )
    await act(async () => screen.getByText("refetch").click())
    expect(calls).toHaveLength(0)
  })

  it("reads once when it turns enabled", async () => {
    const { client, calls } = countingClient()
    function Toggle() {
      const [on, setOn] = useState(false)
      return (
        <>
          <button onClick={() => setOn(true)}>run</button>
          <Probe enabled={on} />
        </>
      )
    }
    render(
      <PluginProvider client={client}>
        <Toggle />
      </PluginProvider>,
    )
    await act(async () => screen.getByText("run").click())
    await waitFor(() => expect(screen.getByTestId("data").textContent).toBe("verify.run"))
    expect(calls).toEqual([{ intent: "verify.run", params: { fromSeq: 1 } }])
  })

  it("ignores a cached entry for the same key while disabled", async () => {
    const { client } = countingClient()
    // Another reader filled the key first.
    const key = queryStore.keyOf("chronicle", "verify.run", { fromSeq: 1 })
    queryStore.read(key, async () => ({ answer: "cached" }), 0)
    await act(async () => {})
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>,
    )
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("is not re-issued by an invalidation while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>,
    )
    await act(async () => queryStore.invalidate("chronicle", ["verify.run"]))
    expect(calls).toHaveLength(0)
  })

  it("keeps today's behaviour when the option is omitted", async () => {
    const { client, calls } = countingClient()
    function Plain() {
      const q = useQuery<{ answer: string }>("streams.mine")
      return <span data-testid="plain">{q.data?.answer ?? "none"}</span>
    }
    render(
      <PluginProvider client={client}>
        <Plain />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByTestId("plain").textContent).toBe("streams.mine"))
    expect(calls).toHaveLength(1)
  })
})
```

If `packages/plugin/test/` imports from a different path (for example `../src/index`), or the package's vitest config lives elsewhere, follow the existing tests in that directory.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin test -- use-query-enabled`
Expected: FAIL. TypeScript accepts the extra argument at runtime, but the disabled cases send a request, and the first test sees `calls` of length 1.

- [ ] **Step 4: Implement**

In `hooks.ts`, add the options type and gate the three places the hook touches the store:

```ts
export interface QueryOptions {
  /**
   * When false the hook sends nothing, watches nothing, and answers
   * `{ loading: false }` with no data. Use it for a read that has no side
   * effects but costs enough that it should only run when the operator asks:
   * a chain verification, or the preview a destructive dialog shows. Turning
   * it back on behaves like a fresh mount.
   */
  enabled?: boolean
}

const IDLE = { loading: false } as const
const NOOP_SUBSCRIBE = () => () => {}
```

```ts
export function useQuery<T = unknown>(
  intent: string,
  params?: Record<string, unknown>,
  options?: QueryOptions,
): QueryState<T> {
  const enabled = options?.enabled ?? true
  const client = usePluginClient()
  const key = queryStore.keyOf(client.extension, intent, params)

  const entry = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (enabled ? queryStore.subscribe(key, listener) : NOOP_SUBSCRIBE()),
      [key, enabled],
    ),
    useCallback(() => (enabled ? queryStore.snapshot<T>(key) : (IDLE as Entry<T>)), [key, enabled]),
    useCallback(() => (enabled ? queryStore.snapshot<T>(key) : (IDLE as Entry<T>)), [key, enabled]),
  )

  const staleMs = queryStore.staleTimeFor(client.extension, intent)

  useEffect(() => {
    if (!enabled) return
    queryStore.read<T>(key, () => client.query<T>(intent, params), staleMs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, staleMs, enabled])

  const refetch = useCallback(() => {
    if (!enabled) return
    queryStore.read<T>(key, () => client.query<T>(intent, params), 0, { force: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, intent, key, enabled])

  return { ...entry, refetch }
}
```

`Entry` is exported from `store.ts`, so import it as a type: `import type { Entry } from "./store"`. `IDLE` must be one module-level object, because `useSyncExternalStore` compares snapshots by identity and a fresh `{ loading: false }` per call loops forever. Make the same change to `useHostQuery`. Keep every existing comment in both functions, and add one sentence to each docblock saying what `enabled: false` does. Export `QueryOptions` from the barrel beside `QueryState`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin test && pnpm --filter @forge-go/dashboard-plugin typecheck && pnpm --filter @forge-go/dashboard-plugin lint`
Expected: PASS, including every existing hook and store test, untouched.

- [ ] **Step 6: Prove the tests bite**

Run these in a throwaway copy of the file, then restore it with `git checkout -- packages/plugin/src/hooks.ts` or by re-applying your change:
- (a) Remove the `if (!enabled) return` in the effect. The first test must fail.
- (b) Subscribe even when disabled. The invalidation test must fail.
- (c) Return `queryStore.snapshot` while disabled. The cached-entry test must fail.

Record which test failed for each.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/hooks.ts packages/plugin/src/index.ts packages/plugin/test/use-query-enabled.test.tsx
git diff --cached --stat
git commit -m "feat(plugin): let useQuery wait until it is enabled"
```

---

### Task 2: The package, its types, its badge mapping, and the settings page

The first task that produces a plugin the shell could load. Settings is the first page because it reads one intent and every other page's copy depends on it: backend, digest scheme, checkpointing.

**Files:**
- Create:
  - `packages/plugin-chronicle/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
  - `packages/plugin-chronicle/src/index.tsx`, `src/types.ts`, `src/format.ts`, `src/badges.tsx`
  - `packages/plugin-chronicle/src/components/dialog-error.tsx`
  - `packages/plugin-chronicle/src/pages/settings.tsx`
- Test:
  - `packages/plugin-chronicle/test/harness.tsx`
  - `test/plugin.test.tsx`, `test/format.test.ts`, `test/badges.test.tsx`, `test/settings.test.tsx`

**Interfaces:**
- Produces: every type in `src/types.ts` (exact names below; later tasks import them); `formatSeq(n: number): string`; `shortHash(h: string): string`; `durationLabel(goDuration: string): string`; the badge components in `src/badges.tsx`; `SettingsPage: ComponentType<PluginPageProps>`; `chroniclePlugin` (default and named export).

- [ ] **Step 1: Scaffold the package from plugin-vault**

Copy these four files from `packages/plugin-vault`: `package.json`, `tsconfig.json`, `vitest.config.ts` and `eslint.config.js`. Then change:
- `name` to `@forge-go/dashboard-plugin-chronicle`;
- `dependencies` to `{}` for now (Task 8 adds CodeMirror);
- `vitest.config.ts` `setupFiles` to `["../test-support/jsdom-setup.ts"]` (Task 8 adds `./test/setup.ts`).

Keep every other field identical to Vault's, including the scripts, peerDependencies, devDependencies and versions. Run `pnpm install --filter @forge-go/dashboard-plugin-chronicle...`. Stage only your own hunks of `pnpm-lock.yaml`, as the Global Constraints describe.

- [ ] **Step 2: Copy the test harness**

Copy `packages/plugin-relay/test/harness.tsx` to `packages/plugin-chronicle/test/harness.tsx` and replace every `extension: "relay"` with `extension: "chronicle"`. There are five occurrences: `stubClient`, `failingClient`, `pendingClient`, `scriptedClient`, and the one `recordingClient` inherits. Nothing else changes.

- [ ] **Step 3: Write `src/types.ts`**

Transcribe every type from the wire reference, sections 3 and 4, and name each one exactly as below so later tasks can import it. Fields the Go side marks omitempty or pointer are optional (`?`) here. Arrays marked omitempty in `VerifyReport` are optional. Times are `string`.

```ts
// Field names are the Go JSON tags in chronicle's extension/contract. Every
// type here is hand-written against chronicle main; the wire reference in the
// plan is the source. Optional (?) means the Go field is a pointer or
// omitempty, so the key can be absent.

export type VerifyLevel = "unkeyed" | "keyed" | "signed" | "anchored"

export interface CheckpointSummary {
  id: string
  fromSeq: number
  toSeq: number
  eventCount: number
  createdAt: string
  signKeyId: string
}

export interface StreamSummary {
  id: string
  appId: string
  tenantId?: string
  headHash: string
  headSeq: number
  scheme: string
  schemeSince: number
  coverageCeiling: VerifyLevel
  latestCheckpoint?: CheckpointSummary
  checkpointingConfigured: boolean
}

export interface MineResponse { stream?: StreamSummary }
export interface StreamListResponse { streams: StreamSummary[]; total: number; hasMore: boolean }

export interface CoverageSpan { fromSeq: number; toSeq: number; level: VerifyLevel; note?: string }

export interface CheckpointResult {
  id: string
  fromSeq: number
  toSeq: number
  signatureValid: boolean
  hashMatch: boolean
  hashChecked: boolean
  continuityOk: boolean
  continuityChecked: boolean
  note?: string
}

export interface RetainedRange {
  fromSeq: number
  toSeq: number
  recordSeq: number
  policyId?: string
  backfill?: string
}

export interface VerifyReport {
  valid: boolean
  verified: number
  gaps?: number[]
  tampered?: number[]
  downgrades?: number[]
  tolerant?: number[]
  retained?: RetainedRange[]
  firstEvent: number
  lastEvent: number
  headSeq: number
  partial: boolean
  headMatch: boolean
  headChecked: boolean
  checkpointsChecked: boolean
  checkpointHeadOk: boolean
  checkpointHeadChecked: boolean
  coverage?: CoverageSpan[]
  checkpoints?: CheckpointResult[]
  /** -1 means unknown. Zero is a real answer. */
  retentionPolicies: number
}

export interface VerifyResponse { report?: VerifyReport; noChain: boolean }
export interface VerifyEventResponse { valid: boolean; hashScheme: string; keyed: boolean }

export interface CheckpointListResponse {
  /** null from servers older than chronicle 8d3b2d7 when supported is false. */
  checkpoints: CheckpointSummary[] | null
  hasMore: boolean
  supported: boolean
}
export interface GetCheckpointResponse { checkpoint: CheckpointSummary }
export interface TakeCheckpointResponse { checkpoint?: CheckpointSummary; upToDate: boolean }

export interface EventSummary {
  id: string
  timestamp: string
  sequence: number
  action: string
  resource: string
  resourceId?: string
  category: string
  outcome: string
  severity: string
  userId?: string
  ip?: string
  erased: boolean
}

export interface EventDetail extends EventSummary {
  streamId: string
  hash: string
  prevHash: string
  hashScheme?: string
  hashKeyId?: string
  reason?: string
  subjectId?: string
  userAgent?: string
  requestId?: string
  sessionId?: string
  metadata?: Record<string, unknown>
  erasedAt?: string
  erasureId?: string
}

export interface EventListResponse { events: EventSummary[]; total: number; hasMore: boolean }

export interface AggregateGroup {
  bucket?: string
  category?: string
  action?: string
  outcome?: string
  severity?: string
  resource?: string
  count: number
}
export interface AggregateResponse { groups: AggregateGroup[]; total: number }

export interface OverviewStats {
  totalEvents: number
  criticalEvents: number
  /** outcome "failure" only. */
  failedEvents: number
  deniedEvents: number
  erasureCount: number
  categories: AggregateGroup[]
  severities: AggregateGroup[]
  outcomes: AggregateGroup[]
}

export interface ErasureSummary {
  id: string
  subjectId: string
  reason: string
  requestedBy: string
  eventsAffected: number
  keyDestroyed: boolean
  createdAt: string
}
export interface ErasureListResponse { erasures: ErasureSummary[]; total: number; hasMore: boolean }
export interface ErasurePreviewResponse { subjectId: string; eventsAffected: number }
export interface ErasureResult {
  id: string
  subjectId: string
  eventsAffected: number
  keyDestroyed: boolean
  legacyKeyRetained: boolean
}

export interface PolicySummary {
  id: string
  category: string
  /** A Go duration, such as "720h0m0s". */
  duration: string
  archive: boolean
  appId: string
  tenantId?: string
  createdAt: string
  updatedAt: string
  editable: boolean
}
export interface PolicyListResponse { policies: PolicySummary[]; total: number }
export interface PolicyPreview { policyId: string; category: string; eventCount: number; capped: boolean }
export interface RetentionPreviewResponse {
  eventCount: number
  capped: boolean
  noPolicies: boolean
  governingAppPolicies: number
  byPolicy: PolicyPreview[]
}
export interface EnforceResponse {
  archived: number
  purged: number
  /** Always 0 today: the library's enforcer never sets it. */
  retained: number
  moreRemain: boolean
  failed: boolean
}
export interface ArchiveSummary {
  id: string
  policyId: string
  category: string
  eventCount: number
  fromTimestamp: string
  toTimestamp: string
  sinkName: string
  sinkRef?: string
  tenantId?: string
  createdAt: string
}
export interface ArchiveListResponse { archives: ArchiveSummary[]; hasMore: boolean }

export interface ReportPeriod { from: string; to: string }
export interface ReportStats {
  totalEvents: number
  criticalEvents: number
  failedEvents: number
  deniedEvents: number
}
export interface ReportSummary {
  id: string
  title: string
  /** soc2, hipaa, eu_ai_act or custom. */
  type: string
  period: ReportPeriod
  generatedBy: string
  format: string
  createdAt: string
  stats?: ReportStats
}
export interface ReportSection {
  title: string
  notes?: string
  events: EventSummary[]
  matchedEvents: number
  eventsTruncated: boolean
  stats?: AggregateResponse
}
export type VerificationStatus = "verified" | "no_chain" | "not_configured"
export interface VerificationScope {
  status: VerificationStatus
  streamId?: string
  scheme?: string
  schemeSince?: number
  headSeq: number
  fromSeq: number
  toSeq: number
  window: number
  capped: boolean
  checkpointsConfigured: boolean
  notes: string[]
}
export interface ReportDetail extends ReportSummary {
  sections: ReportSection[]
  verification?: VerifyReport
  verificationScope?: VerificationScope
}
export interface ReportListResponse { reports: ReportSummary[]; hasMore: boolean }
export interface GenerateReportResponse { id: string; report: ReportSummary }
export interface CustomReportSection {
  title: string
  categories?: string[]
  actions?: string[]
  severity?: string[]
  notes?: string
}
export interface ExportReportResponse { filename: string; contentType: string; content: string }

export interface SettingsDetail {
  batchSize: number
  flushInterval: string
  retentionInterval: string
  enableCryptoErasure: boolean
  digestScheme: string
  keyed: boolean
  checkpointingConfigured: boolean
  backendName: string
  backendHoldsCheckpoints: boolean
}

/** The contract's own limits, from chronicle's extension/contract. */
export const LIMITS = {
  verifySpan: 100_000,
  pageDefault: 50,
  pageMaxStreamsCheckpoints: 200,
  pageMax: 1000,
  previewCap: 10_000,
  enforcePerPolicy: 5_000,
  reportWindow: 50_000,
  customReportTitle: 200,
  customReportSections: 20,
  customSectionTitle: 200,
  customSectionNotes: 4000,
  customFilterValues: 50,
  customFilterValue: 128,
  erasureSubjectId: 256,
  erasureReason: 2000,
  policyCategory: 64,
} as const
```

Check each type against the wire reference and chronicle `main`'s `extension/contract/*.go`. Any mismatch is a finding: fix the type, and name the field in your report.

- [ ] **Step 4: Write the failing tests for `format.ts`**

```ts
// packages/plugin-chronicle/test/format.test.ts
import { describe, expect, it } from "vitest"
import { durationLabel, formatSeq, shortHash } from "../src/format"

describe("formatSeq", () => {
  it("groups thousands the way the spec's copy does", () => {
    expect(formatSeq(12431)).toBe("12,431")
    expect(formatSeq(1)).toBe("1")
    expect(formatSeq(0)).toBe("0")
  })
})

describe("shortHash", () => {
  it("keeps the first 12 characters of a long hash", () => {
    expect(shortHash("a1b2c3d4e5f6a7b8c9d0")).toBe("a1b2c3d4e5f6")
  })
  it("leaves a short value alone", () => {
    expect(shortHash("abc")).toBe("abc")
  })
})

describe("durationLabel", () => {
  it("reads whole days", () => expect(durationLabel("720h0m0s")).toBe("30 days"))
  it("reads one day", () => expect(durationLabel("24h0m0s")).toBe("1 day"))
  it("reads hours that are not whole days", () => expect(durationLabel("36h0m0s")).toBe("36 hours"))
  it("reads minutes and seconds as written", () => expect(durationLabel("1m30s")).toBe("1m30s"))
  it("returns an unparseable value unchanged", () => expect(durationLabel("soon")).toBe("soon"))
})
```

- [ ] **Step 5: Implement `format.ts`**

```ts
// packages/plugin-chronicle/src/format.ts
const grouped = new Intl.NumberFormat("en-US")

/** A sequence number or count for a person to read: 12,431. */
export function formatSeq(n: number): string {
  return grouped.format(n)
}

/** The first 12 characters of a hash. The full value goes in a title attribute. */
export function shortHash(h: string): string {
  return h.length > 12 ? h.slice(0, 12) : h
}

/**
 * A Go duration as a person reads it. Only whole hours are rewritten, since
 * that is how retention policies are written ("720h"); anything else is shown
 * exactly as the server sent it.
 */
export function durationLabel(goDuration: string): string {
  const m = /^(\d+)h0m0s$/.exec(goDuration)
  if (!m) return goDuration
  const hours = Number(m[1])
  if (hours % 24 === 0) {
    const days = hours / 24
    return days === 1 ? "1 day" : `${days} days`
  }
  return hours === 1 ? "1 hour" : `${hours} hours`
}
```

- [ ] **Step 6: Write the badge mapping, its tests first**

```tsx
// packages/plugin-chronicle/test/badges.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { CoverageBadge, ErasedBadge, OutcomeBadge, SeverityBadge } from "../src/badges"

const variantOf = (el: HTMLElement) => el.getAttribute("data-variant")

describe("the badge mapping", () => {
  it("keeps the majority outcome quiet and marks failure and denial", () => {
    render(<><OutcomeBadge outcome="success" /><OutcomeBadge outcome="failure" /><OutcomeBadge outcome="denied" /></>)
    expect(variantOf(screen.getByText("success"))).toBe("outline")
    expect(variantOf(screen.getByText("failure"))).toBe("destructive")
    expect(variantOf(screen.getByText("denied"))).toBe("destructive")
  })
  it("ramps severity: info outline, warning secondary, critical destructive", () => {
    render(<><SeverityBadge severity="info" /><SeverityBadge severity="warning" /><SeverityBadge severity="critical" /></>)
    expect(variantOf(screen.getByText("info"))).toBe("outline")
    expect(variantOf(screen.getByText("warning"))).toBe("secondary")
    expect(variantOf(screen.getByText("critical"))).toBe("destructive")
  })
  it("shows an unknown outcome or severity as outline text, not as a fault", () => {
    render(<><OutcomeBadge outcome="partial" /><SeverityBadge severity="debug" /></>)
    expect(variantOf(screen.getByText("partial"))).toBe("outline")
    expect(variantOf(screen.getByText("debug"))).toBe("outline")
  })
  it("ranks coverage: unkeyed secondary, keyed outline, signed and anchored default", () => {
    render(<><CoverageBadge level="unkeyed" /><CoverageBadge level="keyed" /><CoverageBadge level="signed" /><CoverageBadge level="anchored" /></>)
    expect(variantOf(screen.getByText("unkeyed"))).toBe("secondary")
    expect(variantOf(screen.getByText("keyed"))).toBe("outline")
    expect(variantOf(screen.getByText("signed"))).toBe("default")
    expect(variantOf(screen.getByText("anchored"))).toBe("default")
  })
  it("never marks an erasure as a fault", () => {
    render(<ErasedBadge />)
    expect(variantOf(screen.getByText("Erased"))).toBe("secondary")
  })
})
```

Before relying on `data-variant`, read `packages/kit/src/components/badge.tsx`. If the kit's Badge doesn't render `data-variant`, assert on the variant's class instead, the way `packages/plugin-vault/test/badges.test.tsx` does. Read that test first and use whichever mechanism it uses.

```tsx
// packages/plugin-chronicle/src/badges.tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { VerifyLevel } from "./types"

/*
 * Badge mapping for the chronicle pages, and why. The spec's table
 * ("Badges, and the column that isn't there") is the source; this is it in
 * code, in one place.
 *
 * Outcome
 *   success is `outline`: it is nearly every row. failure and denied are
 *   `destructive`: an audit log is opened to find exactly those. Anything
 *   else a deployment records is shown as `outline` text, because an unknown
 *   value is not evidence of a fault.
 *
 * Severity
 *   info `outline`, warning `secondary` (notable, not wrong), critical
 *   `destructive`. Unknown values are `outline`.
 *
 * Coverage level
 *   keyed is `outline`, the ordinary state of a configured deployment.
 *   signed and anchored are `default`: the affirmative outcome, rare enough
 *   to stay a signal. unkeyed is `secondary`: notable but not wrong. It is
 *   the default deployment, and the page says what it cannot see in words,
 *   not in colour.
 *
 * Erased
 *   `secondary`. An erasure is a lawful GDPR action, not a fault.
 *
 * Checkpoint check
 *   A check that held is `outline`, one that failed is `destructive`. A
 *   check that did not run gets no badge at all: see TriStateMark in
 *   src/verification. A badge means an opinion was formed.
 *
 * A chain break is deliberately not a badge. It is the finding, and it gets
 * the verdict sentence and the ribbon.
 */

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const variant = outcome === "failure" || outcome === "denied" ? "destructive" : "outline"
  return <Badge variant={variant}>{outcome}</Badge>
}

export function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === "critical" ? "destructive" : severity === "warning" ? "secondary" : "outline"
  return <Badge variant={variant}>{severity}</Badge>
}

export function CoverageBadge({ level }: { level: VerifyLevel }) {
  const variant =
    level === "signed" || level === "anchored" ? "default" : level === "unkeyed" ? "secondary" : "outline"
  return <Badge variant={variant}>{level}</Badge>
}

export function ErasedBadge() {
  return <Badge variant="secondary">Erased</Badge>
}

export function CheckHeldBadge({ children }: { children: string }) {
  return <Badge variant="outline">{children}</Badge>
}

export function CheckFailedBadge({ children }: { children: string }) {
  return <Badge variant="destructive">{children}</Badge>
}
```

- [ ] **Step 7: Copy `DialogError`**

Copy `packages/plugin-relay/src/components/dialog-error.tsx` to `packages/plugin-chronicle/src/components/dialog-error.tsx` unchanged.

- [ ] **Step 8: Write the settings page test**

```tsx
// packages/plugin-chronicle/test/settings.test.tsx
import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { SettingsPage } from "../src/pages/settings"
import { failingClient, renderPage, stubClient } from "./harness"
import type { SettingsDetail } from "../src/types"

const defaults: SettingsDetail = {
  batchSize: 100,
  flushInterval: "1s",
  retentionInterval: "24h0m0s",
  enableCryptoErasure: false,
  digestScheme: "chronicle/v4",
  keyed: false,
  checkpointingConfigured: false,
  backendName: "sqlite",
  backendHoldsCheckpoints: true,
}

describe("SettingsPage", () => {
  it("says what the default deployment cannot see, in words", async () => {
    renderPage(SettingsPage, stubClient({ "settings.detail": defaults }))
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(screen.getByText(/unkeyed digests detect accidental corruption, not deliberate alteration/i)).toBeTruthy()
    expect(screen.getByText(/no checkpoints are taken/i)).toBeTruthy()
    expect(screen.queryByText(/secure|protected|tamper-proof/i)).toBeNull()
  })

  it("says what keyed digests and signed checkpoints add", async () => {
    renderPage(
      SettingsPage,
      stubClient({ "settings.detail": { ...defaults, digestScheme: "chronicle/v5", keyed: true, checkpointingConfigured: true } }),
    )
    await waitFor(() => expect(screen.getByText("chronicle/v5")).toBeTruthy())
    expect(screen.getByText(/keyed digests detect deliberate alteration/i)).toBeTruthy()
    expect(screen.getByText(/signed checkpoints/i)).toBeTruthy()
  })

  it("names the backend and says when it holds no checkpoints", async () => {
    renderPage(
      SettingsPage,
      stubClient({ "settings.detail": { ...defaults, backendName: "redis", backendHoldsCheckpoints: false } }),
    )
    await waitFor(() => expect(screen.getByText("redis")).toBeTruthy())
    expect(screen.getByText(/this backend cannot store checkpoints/i)).toBeTruthy()
  })

  it("shows a failed read as an error, not as an empty page", async () => {
    renderPage(SettingsPage, failingClient(new ContractError("PERMISSION_DENIED", "an app-wide view needs the chronicle.admin scope")))
    await waitFor(() => expect(screen.getByText(/chronicle.admin/)).toBeTruthy())
  })
})
```

- [ ] **Step 9: Implement the settings page**

```tsx
// packages/plugin-chronicle/src/pages/settings.tsx
import type { ComponentType } from "react"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { DescriptionList } from "@forge-go/dashboard-kit/components/description-list"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { SettingsDetail } from "../types"
import { durationLabel } from "../format"

export const SettingsPage: ComponentType<PluginPageProps> = () => {
  const q = useQuery<SettingsDetail>("settings.detail")
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Settings"
        description="How this deployment records and proves its audit trail. Read-only: these come from the extension's configuration."
      />
      <QueryBoundary title="settings" query={q} skeletonRows={6}>
        {(s) => (
          <>
            <p className="max-w-prose text-sm">{postureSentence(s)}</p>
            <DescriptionList
              items={[
                { term: "Digest scheme", value: <span className="font-mono text-xs">{s.digestScheme}</span> },
                { term: "Keyed", value: s.keyed ? "Yes" : "No" },
                { term: "Checkpoints", value: s.checkpointingConfigured ? "Taken and signed" : "Not taken" },
                { term: "Backend", value: <span className="font-mono text-xs">{s.backendName}</span> },
                {
                  term: "Backend can store checkpoints",
                  value: s.backendHoldsCheckpoints ? "Yes" : "No: this backend cannot store checkpoints",
                },
                { term: "Crypto-erasure", value: s.enableCryptoErasure ? "Enabled" : "Not enabled" },
                { term: "Batch size", value: String(s.batchSize) },
                { term: "Flush interval", value: <span className="font-mono text-xs">{s.flushInterval}</span> },
                { term: "Retention runs every", value: durationLabel(s.retentionInterval) },
              ]}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}

/** What this configuration can and cannot show, in one paragraph. */
function postureSentence(s: SettingsDetail): string {
  const digest = s.keyed
    ? "Keyed digests detect deliberate alteration by anyone who does not hold the key."
    : "Unkeyed digests detect accidental corruption, not deliberate alteration: anyone who can write the database can recompute them."
  const checkpoints = s.checkpointingConfigured
    ? "Signed checkpoints also prove a range has not been rewritten or truncated since it was signed."
    : "No checkpoints are taken, so a truncated tail cannot be detected."
  return `${digest} ${checkpoints}`
}
```

Import paths come from `packages/kit/package.json` exports (`./components/*`). If `DescriptionList` lives in a differently named file, use the real file name.

- [ ] **Step 10: Write `src/index.tsx` and the plugin test**

```tsx
// packages/plugin-chronicle/src/index.tsx
import { definePlugin } from "@forge-go/dashboard-plugin"
import { SettingsIcon } from "@forge-go/dashboard-kit/icons"
import { SettingsPage } from "./pages/settings"

export type * from "./types"

/**
 * Chronicle's dashboard. Integrity is the landing page: this is the one
 * extension whose job is to prove a record was not altered, so verification
 * is the first thing an operator sees, not a detail page hung off a list.
 *
 * No `requires` range: the contract declares its own version per intent, and
 * a range here would only restate it.
 */
export const chroniclePlugin = definePlugin({
  extension: "chronicle",
  namespace: "chronicle",
  label: "Chronicle",
  nav: [
    { label: "Settings", to: "/settings", priority: 90, icon: <SettingsIcon />, group: "Settings" },
  ],
  routes: [
    // "/" shows settings only until Task 5 gives it the chain page.
    { path: "/", element: SettingsPage },
    { path: "/settings", element: SettingsPage },
  ],
})

export default chroniclePlugin
```

```tsx
// packages/plugin-chronicle/test/plugin.test.tsx
```

Copy `packages/plugin-vault/test/plugin.test.tsx` and adapt it to `chroniclePlugin` and `extension: "chronicle"`. It asserts:
- the plugin resolves `ready` against a capabilities document that lists `chronicle`, and `hidden` when chronicle is absent;
- every nav `to` has a route;
- the default export equals the named export.

Add one assertion of your own: every nav item carries a `group`, and the set of groups is a subset of `["Integrity", "Log", "Compliance", "Retention", "Settings"]`.

- [ ] **Step 11: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test && pnpm --filter @forge-go/dashboard-plugin-chronicle typecheck && pnpm --filter @forge-go/dashboard-plugin-chronicle lint`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add packages/plugin-chronicle
# plus your own hunks of pnpm-lock.yaml only, staged with git apply --cached
git diff --cached --stat
git commit -m "feat(plugin-chronicle): scaffold the plugin with its types, badges and settings page"
```

---
### Task 3: The chronicle fixture, with four chains that verify differently

The spec's "The fixture needs a broken chain": a fixture whose chain always verifies can't show the one surface this dashboard exists for. This task builds the fixture before any page, so every later page is looked at against real failures, not reasoned about.

**Files:**
- Create: `packages/fixture-server/chronicle-fixtures.mjs`
- Modify: `packages/fixture-server/server.mjs`: one import, one `CONTRIBUTORS` entry, and one reset call in `handleReset`
- Modify: `packages/fixture-server/verify.mjs`: `INPUT` entries and a spot-check block
- Modify: `packages/fixture-server/README.md`: a "chronicle" section listing the env switches

**Interfaces:**
- Produces: `createChronicleHandlers(FixtureError)`, which returns the `{ "<intent>": { kind, invalidates?, handler(input) } }` map `server.mjs` expects. Also `resetChronicle()`.
- Consumes: nothing from other tasks. It mirrors chronicle `main`'s contract, as the wire reference records it.

**What it models.** The viewer is an app-wide operator of app `app_chronicle`, which holds four chains:

| key | stream id | tenant | scheme / since | head | checkpoints (fromSeq to toSeq) | condition |
|---|---|---|---|---|---|---|
| own | `stream_app` | none | `chronicle/v4` / 1 | 12431 | none | intact, plain: the default deployment, where a pass must not read as a pass |
| acme | `stream_acme` | `acme` | `chronicle/v5` / 48201 | 61004 | 1-10000 ... 50001-60000, six of them | intact, mixed level: unkeyed below 48,201, keyed above it, signed where checkpointed |
| globex | `stream_globex` | `globex` | `chronicle/v5` / 1 | 5000 | 1-2000, 2001-4000 | broken: gaps 2311 and 2312, tampered 2780, downgrade 2901; plus retained 101-400 vouched for by the record at 401 |
| initech | `stream_initech` | `initech` | `chronicle/v5` / 1 | 3000 | 1-1500, 1501-3400 | truncated: the last checkpoint reaches 3400, past the claimed head, so `headMatch` and `checkpointHeadOk` are false |

Env switches (read at start-up and again on reset, like Vault's):
- `FIXTURE_CHRONICLE_NO_CHECKPOINTS=1`: the deployment takes no checkpoints. `checkpoints.list` answers `supported: false` with `checkpoints: null` (the pre-8d3b2d7 shape, on purpose, so the page's null handling is exercised). `checkpointsChecked` and `checkpointHeadChecked` are false, `checkpoints.take` is UNAVAILABLE, coverage never reaches `signed`, and `settings.detail` says `checkpointingConfigured: false`.
- `FIXTURE_CHRONICLE_NO_OWN_CHAIN=1`: the app-level scope has no chain. `streams.mine` answers `{}`, and `verify.run` without a `streamId` answers `{ noChain: true }`. Review Focus 2.
- `FIXTURE_CHRONICLE_VIEWER=tenant`: the viewer is a tenant operator of `acme`. It sees only acme's chain, events, archives and reports. `retention.policies` lists acme's own policies (editable) and then the app-level ones (`editable: false`). Saving or deleting an app-level policy is NOT_FOUND. Review Focus 5.
- `FIXTURE_CHRONICLE_NO_ERASURE=1`: `erasures.request` answers UNAVAILABLE.

**Deliberate differences from production**, written into the module header:
- **Events are a sample.** The chains' heads are in the tens of thousands, but the fixture holds a sample of events (the last 40 of each chain, plus the events around each break and the retention record). `total` counts the sample, so captions are internally consistent without 81,000 objects in memory.
- **`retention.enforce` doesn't add retained ranges to the chain.** It removes eligible sample events and reports the counts, and that's all.

- [ ] **Step 1: Read the server's conventions**

Read the header of `packages/fixture-server/vault-fixtures.mjs` and its `createVaultHandlers`. Read `server.mjs` around `class FixtureError` (line ~78), `CONTRIBUTORS` (line ~2722), `handleContractRequest` (line ~2871) and `handleReset` (line ~2998). Read the Vault block in `verify.mjs` (line ~447). This task follows Vault's shape exactly: a self-contained module, handed `FixtureError` by `server.mjs`.

- [ ] **Step 2: Write the chain model and the verify handler**

This part carries the dashboard's claims, so it's written out in full. The rest of the handlers follow it.

```js
// chronicle-fixtures.mjs: in-memory state and intent handlers for the
// chronicle contributor (packages/plugin-chronicle).
//
// Mirrors chronicle's extension/contract on main (manifest.yaml and the
// handlers_*.go files). Field names are the Go JSON tags. Every refusal here
// uses the Go handler's code and message, so a page that handles the fixture's
// error handles the server's.
//
// Four chains in one app, each verifying differently: an intact plain chain
// (the default deployment), an intact mixed-level chain, a broken chain and a
// truncated one. A fixture whose chain always verifies cannot show the surface
// this dashboard exists for.
//
// Deliberate differences from production:
//   - Events are a sample: the last 40 of each chain, the events around each
//     break, and the retention record. Totals count the sample.
//   - retention.enforce removes eligible sample events and reports counts; it
//     does not write retained ranges into the chain.
//
// Imports nothing from server.mjs. server.mjs hands over FixtureError so
// `instanceof` in its dispatch sees the right class.

const APP_ID = "app_chronicle"
const MAX_VERIFY_SPAN = 100_000
const PREVIEW_CAP = 10_000
const ENFORCE_PER_POLICY = 5_000
// A fixed "now" so ages, buckets and previews are the same on every run.
const NOW = Date.parse("2026-09-29T12:00:00Z")

const env = () => ({
  noCheckpoints: process.env.FIXTURE_CHRONICLE_NO_CHECKPOINTS === "1",
  noOwnChain: process.env.FIXTURE_CHRONICLE_NO_OWN_CHAIN === "1",
  tenantViewer: process.env.FIXTURE_CHRONICLE_VIEWER === "tenant",
  noErasure: process.env.FIXTURE_CHRONICLE_NO_ERASURE === "1",
})

/** The viewer's scope. Only an app-wide viewer owns records of every tenant. */
function viewer() {
  return env().tenantViewer ? { appId: APP_ID, tenantId: "acme" } : { appId: APP_ID, tenantId: "" }
}
function owns(v, appId, tenantId) {
  if (appId !== v.appId) return false
  return v.tenantId === "" || (tenantId ?? "") === v.tenantId
}

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.000Z$/, "Z")
}

function checkpointsEvery(size, upTo, key) {
  const out = []
  for (let from = 1; from + size - 1 <= upTo; from += size) {
    out.push(cp(`ckpt_${key}_${out.length + 1}`, from, from + size - 1))
  }
  return out
}
function cp(id, fromSeq, toSeq) {
  return {
    id,
    fromSeq,
    toSeq,
    eventCount: toSeq - fromSeq + 1,
    createdAt: iso(NOW - (100_000 - toSeq) * 60_000),
    signKeyId: "sk_2026_09",
  }
}

function seedChains() {
  return {
    own: {
      id: "stream_app", tenantId: "", scheme: "chronicle/v4", schemeSince: 1, headSeq: 12431,
      headHash: "9f2c61a04be7d85c3a1e0f47b6d29c85e1a3f0b7c4d2e6a8f9b0c1d2e3f4a5b6",
      checkpoints: [], gaps: [], tampered: [], downgrades: [], retained: [], truncated: false,
    },
    acme: {
      id: "stream_acme", tenantId: "acme", scheme: "chronicle/v5", schemeSince: 48201, headSeq: 61004,
      headHash: "4b7e0c9d2a1f836e5d4c3b2a19087f6e5d4c3b2a1908f7e6d5c4b3a291807f6e",
      checkpoints: checkpointsEvery(10_000, 60_000, "acme"), gaps: [], tampered: [], downgrades: [], retained: [], truncated: false,
    },
    globex: {
      id: "stream_globex", tenantId: "globex", scheme: "chronicle/v5", schemeSince: 1, headSeq: 5000,
      headHash: "c0ffee5a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6",
      checkpoints: [cp("ckpt_globex_1", 1, 2000), cp("ckpt_globex_2", 2001, 4000)],
      gaps: [2311, 2312], tampered: [2780], downgrades: [2901],
      retained: [{ fromSeq: 101, toSeq: 400, recordSeq: 401, policyId: "retpol_globex_debug" }],
      truncated: false,
    },
    initech: {
      id: "stream_initech", tenantId: "initech", scheme: "chronicle/v5", schemeSince: 1, headSeq: 3000,
      headHash: "7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b",
      checkpoints: [cp("ckpt_initech_1", 1, 1500), cp("ckpt_initech_2", 1501, 3400)],
      gaps: [], tampered: [], downgrades: [], retained: [], truncated: true,
    },
  }
}

let chains = seedChains()

const keyed = (scheme) => scheme === "chronicle/v3" || scheme === "chronicle/v5"

/** Every chain the viewer owns, own scope first. */
function viewerChains() {
  const v = viewer()
  return Object.values(chains).filter((c) => {
    if (c.tenantId === "" && env().noOwnChain) return false
    return owns(v, APP_ID, c.tenantId)
  })
}

/** streams.mine and the empty-streamId case of every selector. */
function ownChain() {
  const v = viewer()
  return viewerChains().find((c) => c.tenantId === v.tenantId)
}

/** selectStream: a lookup key, never a grant. */
function selectChain(E, streamId) {
  if (!streamId) return ownChain()
  const c = viewerChains().find((x) => x.id === streamId)
  if (!c) throw new E(404, "NOT_FOUND", "not found")
  return c
}

function coverageCeiling(c) {
  if (c.headSeq === 0 || c.headSeq < c.schemeSince) return "unkeyed"
  if (!env().noCheckpoints) return "signed"
  return keyed(c.scheme) ? "keyed" : "unkeyed"
}

function projectStream(c) {
  const cps = env().noCheckpoints ? [] : c.checkpoints
  const latest = cps[cps.length - 1]
  const out = {
    id: c.id,
    appId: APP_ID,
    headHash: c.headHash,
    headSeq: c.headSeq,
    scheme: c.scheme,
    schemeSince: c.schemeSince,
    coverageCeiling: coverageCeiling(c),
    checkpointingConfigured: !env().noCheckpoints,
  }
  if (c.tenantId) out.tenantId = c.tenantId
  if (latest) out.latestCheckpoint = latest
  return out
}

/** Coverage spans for [from, to], split at the pin and at checkpoint cover. */
function coverageFor(c, from, to) {
  const spans = []
  if (from < c.schemeSince) {
    spans.push({ fromSeq: from, toSeq: Math.min(to, c.schemeSince - 1), level: "unkeyed" })
  }
  const keyedFrom = Math.max(from, c.schemeSince)
  if (keyedFrom > to) return spans
  const aboveLevel = keyed(c.scheme) ? "keyed" : "unkeyed"
  // A checkpoint above the pin lifts what it covers to signed. A plain chain
  // under a checkpoint is signed too: the verifier grades it that way,
  // because a signature still proves the range was not rewritten.
  const signedTo = env().noCheckpoints
    ? 0
    : Math.max(0, ...c.checkpoints.filter((k) => k.toSeq <= Math.min(to, c.headSeq)).map((k) => k.toSeq))
  if (signedTo >= keyedFrom) {
    spans.push({ fromSeq: keyedFrom, toSeq: signedTo, level: "signed" })
    if (signedTo < to) spans.push({ fromSeq: signedTo + 1, toSeq: to, level: aboveLevel })
  } else {
    spans.push({ fromSeq: keyedFrom, toSeq: to, level: aboveLevel })
  }
  return spans
}

const inRange = (from, to) => (n) => n >= from && n <= to

function verifyChain(c, from, to) {
  const within = inRange(from, to)
  const gaps = c.gaps.filter(within)
  const tampered = c.tampered.filter(within)
  const downgrades = c.downgrades.filter(within)
  const retained = c.retained
    .filter((r) => r.toSeq >= from && r.fromSeq <= to)
    .map((r) => ({ ...r, fromSeq: Math.max(r.fromSeq, from), toSeq: Math.min(r.toSeq, to) }))
  const retainedCount = retained.reduce((n, r) => n + (r.toSeq - r.fromSeq + 1), 0)
  const readTo = Math.min(to, c.headSeq)
  const verified = Math.max(0, readTo - from + 1 - gaps.length - retainedCount)

  const cpOn = !env().noCheckpoints
  const headChecked = to >= c.headSeq
  const headMatch = !c.truncated
  const overlapping = cpOn ? c.checkpoints.filter((k) => k.toSeq >= from && k.fromSeq <= to) : []
  const checkpoints = overlapping.map((k) => {
    const pastHead = k.toSeq > c.headSeq
    return {
      id: k.id, fromSeq: k.fromSeq, toSeq: k.toSeq,
      signatureValid: true,
      hashMatch: !pastHead, hashChecked: !pastHead,
      continuityOk: true, continuityChecked: true,
      ...(pastHead ? { note: "The checkpoint ends past the chain's head, so its hash could not be compared." } : {}),
    }
  })
  const latest = cpOn ? c.checkpoints[c.checkpoints.length - 1] : undefined
  const checkpointHeadChecked = latest !== undefined
  const checkpointHeadOk = latest === undefined || latest.toSeq <= c.headSeq

  const report = {
    valid:
      gaps.length === 0 && tampered.length === 0 && downgrades.length === 0 &&
      (!headChecked || headMatch) && (!checkpointHeadChecked || checkpointHeadOk) &&
      checkpoints.every((k) => k.signatureValid && (!k.hashChecked || k.hashMatch)),
    verified,
    firstEvent: verified > 0 ? from : 0,
    lastEvent: verified > 0 ? readTo : 0,
    headSeq: c.headSeq,
    partial: from > 1 || to < c.headSeq,
    headMatch, headChecked,
    checkpointsChecked: cpOn,
    checkpointHeadOk, checkpointHeadChecked,
    retentionPolicies: policies.filter((p) => p.appId === APP_ID && (!p.tenantId || p.tenantId === c.tenantId)).length,
  }
  // omitempty arrays are absent when empty, as on the wire.
  if (gaps.length) report.gaps = gaps
  if (tampered.length) report.tampered = tampered
  if (downgrades.length) report.downgrades = downgrades
  if (retained.length) report.retained = retained
  const coverage = coverageFor(c, from, to)
  if (coverage.length) report.coverage = coverage
  if (checkpoints.length) report.checkpoints = checkpoints
  return report
}

function verifyRun(E, input) {
  const c = selectChain(E, input.streamId)
  if (!c) return { noChain: true }
  const from = input.fromSeq || 1
  const to = input.toSeq || c.headSeq
  if (input.toSeq && to < from) throw new E(400, "BAD_REQUEST", "toSeq cannot be less than fromSeq")
  const span = to >= from ? to - from + 1 : 0
  if (span > MAX_VERIFY_SPAN) {
    throw new E(
      400,
      "BAD_REQUEST",
      `requested range covers ${span} events, which exceeds the ${MAX_VERIFY_SPAN}-event limit on a single verification; ` +
        `the chain's head is at sequence ${c.headSeq}, so ask for a bounded window within it`,
    )
  }
  return { noChain: false, report: verifyChain(c, from, to) }
}
```

`policies` is the module's retention state (Step 3). Declare it with `let` above `verifyChain`.

- [ ] **Step 3: Write the rest of the state and the handlers**

Write each handler in the Go handler's order, with the Go handler's messages from the wire reference, section 4. The data:

- **Events: `seedEvents()`.**
  - For each chain, the last 40 sequences (`headSeq-39` to `headSeq`, skipping gaps and retained sequences). For globex, add 2310, 2313, 2779, 2780, 2781, 2900, 2901 and the retention record at 401 (`action: "chronicle.retention.purge"`, `category: "chronicle"`, metadata `{ "policyId": "retpol_globex_debug", "fromSeq": 101, "toSeq": 400 }`).
  - Each event has:
    - `id: "audit_<key>_<seq>"`, `streamId` and `tenantId` from its chain;
    - `sequence`;
    - `timestamp`: `NOW` minus `(headSeq - seq) * 7` minutes. Then shift every event that falls between 03:00 and 04:00 UTC on 2026-09-28 back by one hour, so that hour holds no events. `events.aggregate` by hour must then return NO group for it; the volume chart exists to show that.
    - `action`, `category`, `resource`, `resourceId`: rotate through `user.login`/`auth`/`session`, `user.logout`/`auth`/`session`, `record.update`/`data`/`patient_record`, `record.read`/`data`/`patient_record`, `role.grant`/`admin`/`role`, `invoice.pay`/`billing`/`invoice`, by `seq % 6`.
    - `outcome`: `"denied"` when `seq % 17 === 0`, `"failure"` when `seq % 11 === 0`, otherwise `"success"`.
    - `severity`: `"critical"` when `seq % 23 === 0`, `"warning"` when `seq % 5 === 0`, otherwise `"info"`.
    - `userId`: `"user_<(seq % 7) + 1>"`, absent when `seq % 13 === 0`.
    - `ip`: `"10.0.0.<seq % 250>"`.
    - `hash` and `prevHash`: 64 hex characters derived from the key and sequence (use `node:crypto` `createHash("sha256")`).
    - `hashScheme`: the chain's scheme when `seq >= schemeSince`, otherwise `"chronicle/v4"`. `hashKeyId` is `"hk_1"` on keyed events.
    - `metadata`: `{ "requestPath": "/api/...", "fields": ["name", "dob"], "attempt": seq % 3 }`.
    - `subjectId`: `"subject_<(seq % 4) + 1>"`. `userAgent`, `requestId: "req_<seq>"` and `sessionId: "sess_<seq % 9>"`.
  - Mark `audit_own_12400` erased (`erased: true`, `erasedAt`, `erasureId: "erasure_1"`, `ip` and `reason` equal to `"[ERASED]"`).
  - Give `audit_own_12401` the literal `reason: "[ERASED]"` with `erased: false` and no `erasureId`. That's the victim case the spec says must never read as an erasure requested here.
- **`events.list`:**
  - Validate paging as `pageBounds` does: negative is BAD_REQUEST, 0 means 50, and anything over 1000 is capped at 1000.
  - Validate `order` and RFC3339 `after`/`before`.
  - Filter the viewer's own events on every field in `EventListInput`.
  - Sort by `timestamp` (desc unless `order: "asc"`).
  - `total` is the filtered count, and `hasMore` is `offset + page < total`.
  - Project `EventSummary` (no metadata).
- **`events.detail`:** find by id among the viewer's own events; NOT_FOUND otherwise. The full `EventDetail`.
- **`events.byUser`:** `userId` required (BAD_REQUEST `"userId is required"`), desc, paged.
- **`events.aggregate`:**
  - `groupBy` must be non-empty, known, without duplicates, and name at most one of `day`/`hour`. Use `ResolveGroupBy`'s messages from the wire reference.
  - Buckets are `YYYY-MM-DD` and `YYYY-MM-DDTHH:00:00Z` in UTC.
  - A key whose value is empty is absent from the group. Groups sort by count desc. `total` is the event count.
- **`overview.stats`:** computed from the viewer's events with the Go rules. `failedEvents` counts `"failure"` only. `categories`, `severities` and `outcomes` are aggregate groups. `erasureCount` is the viewer's erasures.
- **Streams:**
  - `streams.mine`: `{ stream: projectStream(ownChain()) }`, or `{}`.
  - `streams.list`: paging with max 200. Returns `viewerChains().map(projectStream)` with `total`.
- **Checkpoints:**
  - `checkpoints.list`: when `noCheckpoints`, `{ checkpoints: null, hasMore: false, supported: false }`. Otherwise the selected chain's checkpoints, newest first, paged with max 200, with `hasMore` from `limit + 1`.
  - `checkpoints.detail`: NOT_FOUND when checkpoints are off, the id is unknown, or the id isn't in a chain the viewer owns.
  - `checkpoints.take`:
    - UNAVAILABLE `"this deployment takes no checkpoints"` when off.
    - NOT_FOUND `"this scope has not recorded any events yet, so there is nothing to checkpoint"` when there's no chain.
    - Otherwise, when the head is past the latest checkpoint's `toSeq`, append a checkpoint from the latest `toSeq + 1` to the head and return it. Else return `{ upToDate: true }`.
- **Erasures:**
  - Seed two:
    - `erasure_1`: subject `subject_9`, reason `"GDPR Article 17 request 4471"`, requested by `user_admin`, 1 event, `keyDestroyed: true`.
    - `erasure_2`: subject `legacy-user`, reason `"Account closure"`, 3 events, `keyDestroyed: false`.
  - `erasures.list`, `erasures.detail`: NOT_FOUND when not owned.
  - `erasures.preview`: count the viewer's events whose `subjectId` matches. BAD_REQUEST `"subjectId is required"`.
  - `erasures.request`:
    - UNAVAILABLE first when `noErasure` (the Go order).
    - Then every BAD_REQUEST rule from the wire reference, section 4.16, with its exact message and limits.
    - Then mark the matching events erased and create the record.
    - Return `ErasureResult`. `legacyKeyRetained: true` and `keyDestroyed: false` when `subjectId === "legacy-user"`; otherwise `keyDestroyed: true`.
- **Retention:**
  - Seed:
    - `retpol_app_all`: app-level, category `"*"`, duration `"8760h0m0s"`, archive false.
    - `retpol_acme_debug`: acme, `"debug"`, `"720h0m0s"`.
    - `retpol_globex_debug`: globex, `"debug"`, `"168h0m0s"`, archive true.
  - `retention.policies`: the viewer's own policies, then, for a tenant viewer, the app-level ones with `editable: false`. `total` is the row count.
  - `retention.policyDetail`: own policies are editable, governing ones are not, and anything else is NOT_FOUND.
  - `retention.savePolicy`: the create and update rules and messages from section 4.19, including CONFLICT for a duplicate category in the same scope and the category rule. Durations are parsed as Go durations: accept `/^\d+(h|m|s)(\d+m)?(\d+s)?$/` and normalise whole hours to `"<n>h0m0s"`.
  - `retention.deletePolicy`: NOT_FOUND unless owned.
  - `retention.preview`:
    - For each of the viewer's own policies, count the viewer's events older than `NOW - duration` whose category matches (`"*"` matches all), capped at 10000.
    - `eventCount` counts distinct events.
    - `noPolicies` is true when there are no own policies.
    - `governingAppPolicies` counts the app-level policies for a tenant viewer, and is 0 for an app-wide one.
  - `retention.enforce`: remove up to 5000 eligible events per policy. Record an archive for archive policies. Return `{ archived, purged, retained: 0, moreRemain, failed: false }`.
  - `retention.archives`: seed one archive for `retpol_globex_debug`, dated 2026-09-20, 300 events, `sinkName: "s3"` and `sinkRef: "s3://audit-archive/globex/2026-09-20.jsonl.gz"`. Paged, with `hasMore` only.
- **Reports:** seed three.
  - `report_soc2`:
    - type `soc2`, title `"SOC 2 evidence, Q3"`, stats from the sample, two sections of sample events;
    - `verification`: `verifyChain(acme, 11005, 61004)` with `retentionPolicies: -1`;
    - `verificationScope`: `{ status: "verified", streamId: "stream_acme", scheme: "chronicle/v5", schemeSince: 48201, headSeq: 61004, fromSeq: 11005, toSeq: 61004, window: 50000, capped: true, checkpointsConfigured: true, notes: ["Sequences 1 to 11004 were not verified: the report verifies at most 50,000 sequences."] }`.
  - `report_hipaa`: type `hipaa`, no `verification` and no `verificationScope`. That's the legacy report.
  - `report_ai`: type `eu_ai_act`, `verificationScope: { status: "no_chain", headSeq: 0, fromSeq: 0, toSeq: 0, window: 50000, capped: false, checkpointsConfigured: true, notes: [] }`.
  - `reports.list`: newest first, `hasMore` only.
  - `reports.detail`: NOT_FOUND when not owned.
  - `reports.generate`: the type and period rules from section 4.26. Creates a report on the own chain, verified and not capped, with the note that an app-wide report verified only the untenanted chain.
  - `reports.generateCustom`: every limit and message in section 4.27.
  - `reports.export`:
    - BAD_REQUEST on an unknown format before the lookup.
    - Content: `json` is the report JSON; `csv` a header line plus one line per section; `markdown` a heading plus a table.
    - Include one event whose action contains `|`, so the page's plain-text rendering is exercised.
    - `html` is an `<html>` document with a `<script>` tag in it, so a page that injected it would show the problem.
- **`settings.detail`:** `{ batchSize: 100, flushInterval: "1s", retentionInterval: "24h0m0s", enableCryptoErasure: !noErasure, digestScheme: "chronicle/v5", keyed: true, checkpointingConfigured: !noCheckpoints, backendName: "sqlite", backendHoldsCheckpoints: true }`.

Declare the handler map with the manifest's `kind` and `invalidates` for every intent. Copy the `invalidates` lists from the wire reference exactly: the page's refresh behaviour in the shell comes from them.

```js
export function resetChronicle() {
  chains = seedChains()
  events = seedEvents()
  erasures = seedErasures()
  policies = seedPolicies()
  archives = seedArchives()
  reports = seedReports()
}

export function createChronicleHandlers(FixtureError) {
  const E = FixtureError
  return {
    "streams.mine": { kind: "query", handler: () => { const c = ownChain(); return c ? { stream: projectStream(c) } : {} } },
    "verify.run": { kind: "query", handler: (input) => verifyRun(E, input ?? {}) },
    // ... all 29, each with kind and invalidates from the manifest
  }
}
```

- [ ] **Step 4: Register it in `server.mjs`**

Add `import { createChronicleHandlers, resetChronicle } from "./chronicle-fixtures.mjs"` beside the Vault import, then `{ name: "chronicle", envPrefix: "CHRONICLE", handlers: createChronicleHandlers(FixtureError) }` in `CONTRIBUTORS` after Vault, then `resetChronicle()` in `handleReset`. Other sessions have uncommitted hunks in this file: stage only these three hunks.

- [ ] **Step 5: Add `verify.mjs` coverage**

- Add `"chronicle::<intent>"` entries to `INPUT` for every intent that needs input:
  - `verify.run` `{ streamId: "stream_globex" }`
  - `verify.event` `{ eventId: "audit_own_12431" }`
  - `events.detail` `{ id: "audit_own_12431" }`
  - `events.aggregate` `{ groupBy: ["hour"] }`
  - `events.byUser` `{ userId: "user_1" }`
  - `checkpoints.detail` `{ id: "ckpt_acme_1" }`
  - `erasures.detail` `{ id: "erasure_1" }`
  - `erasures.preview` `{ subjectId: "subject_1" }`
  - `erasures.request` `{ subjectId: "subject_2", reason: "fixture" }`
  - `retention.policyDetail` `{ id: "retpol_app_all" }`
  - `retention.savePolicy` `{ category: "fixture", duration: "48h" }`
  - `retention.deletePolicy` `{ id: "<the one savePolicy created>" }`. Follow how Vault threads a created id, and order the creates before the deletes.
  - `reports.detail` `{ id: "report_soc2" }`
  - `reports.generate` `{ type: "soc2" }`
  - `reports.generateCustom` `{ title: "fixture", sections: [{ title: "logins", actions: ["user.login"] }] }`
  - `reports.export` `{ id: "report_soc2", format: "csv" }`
- Add a spot-check block in the style of Vault's `vaultCheck`:
  - `verify.run` on `stream_app` answers `valid: true` with coverage all `unkeyed`;
  - on `stream_acme`, a span that splits at 48201;
  - on `stream_globex`, `valid: false` with gaps `[2311, 2312]`, tampered `[2780]`, downgrades `[2901]` and a retained range 101 to 400;
  - on `stream_initech` (whole chain), `headMatch: false` and `checkpointHeadOk: false`;
  - `events.aggregate` by hour has no group for `2026-09-28T03:00:00Z`;
  - `verify.run` with `fromSeq: 1, toSeq: 200000` on `stream_acme` is BAD_REQUEST.

- [ ] **Step 6: Run the fixture and verify it**

```bash
FIXTURE_PORT=8099 node packages/fixture-server/server.mjs &
node packages/fixture-server/verify.mjs http://localhost:8099
kill %1
FIXTURE_PORT=8099 FIXTURE_CHRONICLE_NO_CHECKPOINTS=1 FIXTURE_CHRONICLE_VIEWER=tenant node packages/fixture-server/server.mjs &
node packages/fixture-server/verify.mjs http://localhost:8099
kill %1
```

Expected: exit 0 both times. The second run exercises the null-checkpoints and tenant-viewer paths. If the spot checks assume the app-wide viewer, skip them when the env says tenant, and say so in the check's output.

- [ ] **Step 7: README and commit**

Add a "chronicle" section to `packages/fixture-server/README.md` listing the four chains and the four env switches.

```bash
git add packages/fixture-server/chronicle-fixtures.mjs packages/fixture-server/README.md
# server.mjs and verify.mjs: only your own hunks, via git apply --cached
git diff --cached --stat
git commit -m "feat(fixture-server): serve chronicle with an intact, a plain, a broken and a truncated chain"
```

---
### Task 4: The verification model: what a result is allowed to say

Every sentence the chain page speaks about a chain is decided here, in pure functions with no React. The spec's rules live in this module:
- the verdict is a sentence;
- a pass names its level and its range;
- a mixed chain names its boundary;
- a partial check says so;
- `valid: true` with nothing verified is not a pass;
- every `*Checked` field is three states;
- a retained range is not a break.

Tests are dense here on purpose: a wrong word on this page is the bug the whole design exists to prevent.

**Files:**
- Create:
  - `packages/plugin-chronicle/src/verification/window.ts`
  - `src/verification/tri-state.tsx`
  - `src/verification/breaks.ts`
  - `src/verification/checks.ts`
  - `src/verification/verdict.ts`
- Test:
  - `packages/plugin-chronicle/test/verification/window.test.ts`
  - `test/verification/tri-state.test.tsx`
  - `test/verification/breaks.test.ts`
  - `test/verification/checks.test.ts`
  - `test/verification/verdict.test.ts`
  - `test/verification/fixtures.ts`

**Interfaces:**
- Consumes: `VerifyReport`, `VerifyResponse`, `CoverageSpan`, `CheckpointResult` and `LIMITS` from `src/types.ts`, and `formatSeq` from `src/format.ts` (Task 2).
- Produces:
  - `window.ts`:
    - `interface SeqRange { fromSeq: number; toSeq: number }`
    - `DEFAULT_WINDOW = 10_000`
    - `defaultWindow(headSeq: number): SeqRange | null`
    - `wholeChain(headSeq: number): SeqRange | null`
    - `exceedsCap(r: SeqRange): boolean`
    - `aroundSeq(seq: number, headSeq: number, radius?: number): SeqRange`
    - `parseRangeParams(from?: string, to?: string): SeqRange | null`
  - `tri-state.tsx`:
    - `type TriState = "not-checked" | "held" | "failed"`
    - `tri(checked: boolean, ok: boolean): TriState`
    - `TriStateMark(props: { state: TriState; held: string; failed: string; notChecked: string })`
  - `breaks.ts`:
    - `type BreakKind = "altered" | "missing" | "relabelled" | "truncated" | "head-contradicted"`
    - `interface Break { kind: BreakKind; fromSeq: number; toSeq: number; title: string; explanation: string }`
    - `breaksOf(r: VerifyReport): Break[]`
    - `breakAnchor(b: Break): string`
  - `checks.ts`:
    - `interface CheckRow { label: string; state: TriState; held: string; failed: string; notChecked: string }`
    - `checksOf(r: VerifyReport): CheckRow[]`
    - `checkpointRows(c: CheckpointResult): CheckRow[]`
  - `verdict.ts`:
    - `interface VerdictPart { text: string; mono?: boolean }`
    - `type VerdictTone = "failed" | "pass" | "nothing-checked" | "no-chain"`
    - `interface Verdict { tone: VerdictTone; headline: VerdictPart[]; qualifiers: string[]; limits: string[]; limitsLoud: boolean }`
    - `verdictOf(response: VerifyResponse): Verdict`
    - `verdictText(v: Verdict): string` (headline and qualifiers joined, for tests and for the page's accessible name)

- [ ] **Step 1: Write the shared test reports**

```ts
// packages/plugin-chronicle/test/verification/fixtures.ts
import type { VerifyReport } from "../../src/types"

/** A report with every flag in its quiet state; each test overrides what it is about. */
export function report(over: Partial<VerifyReport> = {}): VerifyReport {
  return {
    valid: true,
    verified: 12431,
    firstEvent: 1,
    lastEvent: 12431,
    headSeq: 12431,
    partial: false,
    headMatch: true,
    headChecked: true,
    checkpointsChecked: true,
    checkpointHeadOk: true,
    checkpointHeadChecked: true,
    retentionPolicies: 0,
    coverage: [{ fromSeq: 1, toSeq: 12431, level: "keyed" }],
    ...over,
  }
}

/** The default deployment: plain digests, no checkpoint store. */
export const plainNoCheckpoints = report({
  coverage: [{ fromSeq: 1, toSeq: 12431, level: "unkeyed" }],
  checkpointsChecked: false,
  checkpointHeadChecked: false,
  checkpointHeadOk: false,
})

/** The spec's mixed chain: keyed from 48,201. */
export const mixed = report({
  verified: 61004,
  lastEvent: 61004,
  headSeq: 61004,
  coverage: [
    { fromSeq: 1, toSeq: 48200, level: "unkeyed" },
    { fromSeq: 48201, toSeq: 60000, level: "signed" },
    { fromSeq: 60001, toSeq: 61004, level: "keyed" },
  ],
})

/** The fixture's broken chain. */
export const broken = report({
  valid: false,
  verified: 4696,
  lastEvent: 5000,
  headSeq: 5000,
  gaps: [2311, 2312],
  tampered: [2780],
  downgrades: [2901],
  retained: [{ fromSeq: 101, toSeq: 400, recordSeq: 401, policyId: "retpol_globex_debug" }],
  retentionPolicies: 2,
  coverage: [{ fromSeq: 1, toSeq: 5000, level: "keyed" }],
})

/** The fixture's truncated chain. */
export const truncated = report({
  valid: false,
  verified: 3000,
  lastEvent: 3000,
  headSeq: 3000,
  headMatch: false,
  checkpointHeadOk: false,
  checkpoints: [
    { id: "ckpt_initech_1", fromSeq: 1, toSeq: 1500, signatureValid: true, hashMatch: true, hashChecked: true, continuityOk: true, continuityChecked: true },
    { id: "ckpt_initech_2", fromSeq: 1501, toSeq: 3400, signatureValid: true, hashMatch: false, hashChecked: false, continuityOk: true, continuityChecked: true, note: "The checkpoint ends past the chain's head, so its hash could not be compared." },
  ],
})
```

- [ ] **Step 2: Write the window tests, then the module**

```ts
// packages/plugin-chronicle/test/verification/window.test.ts
import { describe, expect, it } from "vitest"
import { aroundSeq, defaultWindow, exceedsCap, parseRangeParams, wholeChain } from "../../src/verification/window"

describe("window", () => {
  it("defaults to the most recent 10,000 sequences", () => {
    expect(defaultWindow(61004)).toEqual({ fromSeq: 51005, toSeq: 61004 })
  })
  it("covers a short chain from its start", () => {
    expect(defaultWindow(3000)).toEqual({ fromSeq: 1, toSeq: 3000 })
  })
  it("has no window for an empty chain", () => {
    expect(defaultWindow(0)).toBeNull()
    expect(wholeChain(0)).toBeNull()
  })
  it("knows when a whole-chain check is over the server's cap", () => {
    expect(exceedsCap({ fromSeq: 1, toSeq: 100_000 })).toBe(false)
    expect(exceedsCap({ fromSeq: 1, toSeq: 100_001 })).toBe(true)
  })
  it("builds a window around one event, clamped to the chain", () => {
    expect(aroundSeq(2780, 5000)).toEqual({ fromSeq: 2730, toSeq: 2830 })
    expect(aroundSeq(10, 5000)).toEqual({ fromSeq: 1, toSeq: 60 })
    expect(aroundSeq(4990, 5000)).toEqual({ fromSeq: 4940, toSeq: 5000 })
  })
  it("reads range route params and refuses nonsense", () => {
    expect(parseRangeParams("2730", "2830")).toEqual({ fromSeq: 2730, toSeq: 2830 })
    expect(parseRangeParams(undefined, undefined)).toBeNull()
    expect(parseRangeParams("x", "10")).toBeNull()
    expect(parseRangeParams("0", "10")).toBeNull()
    expect(parseRangeParams("20", "10")).toBeNull()
  })
})
```

```ts
// packages/plugin-chronicle/src/verification/window.ts
import { LIMITS } from "../types"

export interface SeqRange {
  fromSeq: number
  toSeq: number
}

/**
 * The window a verification runs over unless the operator asks for more.
 *
 * Verification holds every event in its range in memory, and the server
 * refuses a span over 100,000. A recent bounded window is the default, and it
 * sets `partial`, which the verdict says out loud. Bounded verification with
 * intact signed checkpoints is a stronger claim than an unbounded walk over an
 * unkeyed chain.
 */
export const DEFAULT_WINDOW = 10_000

export function defaultWindow(headSeq: number): SeqRange | null {
  if (headSeq <= 0) return null
  return { fromSeq: Math.max(1, headSeq - DEFAULT_WINDOW + 1), toSeq: headSeq }
}

export function wholeChain(headSeq: number): SeqRange | null {
  if (headSeq <= 0) return null
  return { fromSeq: 1, toSeq: headSeq }
}

export function exceedsCap(r: SeqRange): boolean {
  return r.toSeq - r.fromSeq + 1 > LIMITS.verifySpan
}

/** A window around one event, for the "check the chain around this event" link. */
export function aroundSeq(seq: number, headSeq: number, radius = 50): SeqRange {
  return { fromSeq: Math.max(1, seq - radius), toSeq: Math.min(headSeq, seq + radius) }
}

/** Route params are strings; a range the page cannot trust is no range. */
export function parseRangeParams(from?: string, to?: string): SeqRange | null {
  if (from === undefined || to === undefined) return null
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) return null
  const r = { fromSeq: Number(from), toSeq: Number(to) }
  if (r.fromSeq < 1 || r.toSeq < r.fromSeq) return null
  return r
}
```

- [ ] **Step 3: Write the tri-state tests, then the module**

```tsx
// packages/plugin-chronicle/test/verification/tri-state.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TriStateMark, tri } from "../../src/verification/tri-state"

describe("tri", () => {
  it("never reads a check that did not run as a failure", () => {
    expect(tri(false, false)).toBe("not-checked")
    expect(tri(false, true)).toBe("not-checked")
    expect(tri(true, true)).toBe("held")
    expect(tri(true, false)).toBe("failed")
  })
})

describe("TriStateMark", () => {
  it("gives a check that held a quiet badge", () => {
    render(<TriStateMark state="held" held="Matches" failed="Does not match" notChecked="Not checked" />)
    expect(screen.getByText("Matches").getAttribute("data-slot")).toBe("badge")
  })
  it("gives a failed check a destructive badge", () => {
    render(<TriStateMark state="failed" held="Matches" failed="Does not match" notChecked="Not checked" />)
    const el = screen.getByText("Does not match")
    expect(el.getAttribute("data-slot")).toBe("badge")
    expect(el.getAttribute("data-variant")).toBe("destructive")
  })
  it("renders a check that did not run as plain muted text with no badge chrome", () => {
    render(<TriStateMark state="not-checked" held="Matches" failed="Does not match" notChecked="Not checked, this deployment stores no checkpoints" />)
    const el = screen.getByText("Not checked, this deployment stores no checkpoints")
    expect(el.getAttribute("data-slot")).not.toBe("badge")
    expect(el.className).toContain("text-muted-foreground")
  })
})
```

The badge detection above assumes the kit's `Badge` renders `data-slot="badge"` and `data-variant`. Read `packages/kit/src/components/badge.tsx`. If it doesn't, assert on whatever attribute or class it does render, the same way the Task 2 badge test does.

```tsx
// packages/plugin-chronicle/src/verification/tri-state.tsx
import { CheckFailedBadge, CheckHeldBadge } from "../badges"

/**
 * A check has three states, not two. chronicle's verify.Report pairs every
 * uncertain result with a *Checked flag because a Go bool's false zero value
 * cannot say whether the check ran. Rendering one as a boolean turns "we did
 * not look" into "we looked and it failed", or the other way round.
 */
export type TriState = "not-checked" | "held" | "failed"

export function tri(checked: boolean, ok: boolean): TriState {
  if (!checked) return "not-checked"
  return ok ? "held" : "failed"
}

/**
 * A badge means an opinion was formed. A check that did not run is plain
 * muted text, so an absence looks like an absence.
 */
export function TriStateMark({
  state,
  held,
  failed,
  notChecked,
}: {
  state: TriState
  held: string
  failed: string
  notChecked: string
}) {
  if (state === "held") return <CheckHeldBadge>{held}</CheckHeldBadge>
  if (state === "failed") return <CheckFailedBadge>{failed}</CheckFailedBadge>
  return <span className="text-sm text-muted-foreground">{notChecked}</span>
}
```

- [ ] **Step 4: Write the breaks tests, then the module**

```ts
// packages/plugin-chronicle/test/verification/breaks.test.ts
import { describe, expect, it } from "vitest"
import { breakAnchor, breaksOf } from "../../src/verification/breaks"
import { broken, report, truncated } from "./fixtures"

describe("breaksOf", () => {
  it("names each break with its kind and exact position, in sequence order", () => {
    const b = breaksOf(broken)
    expect(b.map((x) => [x.kind, x.fromSeq, x.toSeq])).toEqual([
      ["missing", 2311, 2312],
      ["altered", 2780, 2780],
      ["relabelled", 2901, 2901],
    ])
  })
  it("collapses consecutive missing sequences into one range", () => {
    expect(breaksOf(report({ valid: false, gaps: [5, 6, 7, 9] })).map((x) => [x.fromSeq, x.toSeq])).toEqual([
      [5, 7],
      [9, 9],
    ])
  })
  it("never lists a retained range as a break", () => {
    expect(breaksOf(broken).some((x) => x.fromSeq === 101)).toBe(false)
  })
  it("reports truncation and a contradicting checkpoint at the head", () => {
    const b = breaksOf(truncated)
    expect(b.map((x) => x.kind)).toEqual(["truncated", "head-contradicted"])
    expect(b[0].fromSeq).toBe(3000)
  })
  it("does not report truncation when the head was not checked", () => {
    expect(breaksOf(report({ headChecked: false, headMatch: false }))).toEqual([])
  })
  it("does not report a contradiction when no checkpoint was checked", () => {
    expect(breaksOf(report({ checkpointHeadChecked: false, checkpointHeadOk: false }))).toEqual([])
  })
  it("gives every break a stable anchor", () => {
    expect(breakAnchor(breaksOf(broken)[0])).toBe("break-missing-2311")
  })
})
```

```ts
// packages/plugin-chronicle/src/verification/breaks.ts
import type { VerifyReport } from "../types"
import { formatSeq } from "../format"

/**
 * The five ways a chain can be broken, in plain language. A break has a
 * location and a kind; that is what an operator working through a failure
 * needs, and what a boolean cannot give them.
 */
export type BreakKind = "altered" | "missing" | "relabelled" | "truncated" | "head-contradicted"

export interface Break {
  kind: BreakKind
  fromSeq: number
  toSeq: number
  title: string
  explanation: string
}

/** Consecutive sequences as [from, to] runs. */
function runs(seqs: number[]): [number, number][] {
  const sorted = [...seqs].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s === last[1] + 1) last[1] = s
    else out.push([s, s])
  }
  return out
}

function span(from: number, to: number): string {
  return from === to ? `Sequence ${formatSeq(from)}` : `Sequences ${formatSeq(from)} to ${formatSeq(to)}`
}

/**
 * Break rows for a report, in sequence order, head-level breaks last. A
 * retained range is not a break: a retention record in the chain vouches for
 * it, and it is listed separately.
 */
export function breaksOf(r: VerifyReport): Break[] {
  const out: Break[] = []
  for (const [from, to] of runs(r.gaps ?? [])) {
    out.push({
      kind: "missing",
      fromSeq: from,
      toSeq: to,
      title: `${span(from, to)} missing`,
      explanation:
        "These sequences are absent from the store and no retention record accounts for them, so events were removed from the middle of the chain.",
    })
  }
  for (const s of r.tampered ?? []) {
    out.push({
      kind: "altered",
      fromSeq: s,
      toSeq: s,
      title: `Sequence ${formatSeq(s)} altered`,
      explanation:
        "Its recomputed digest differs from the one stored, or it does not link to the event before it: its content or its position was changed after it was written.",
    })
  }
  for (const s of r.downgrades ?? []) {
    out.push({
      kind: "relabelled",
      fromSeq: s,
      toSeq: s,
      title: `Sequence ${formatSeq(s)} relabelled`,
      explanation:
        "It claims a weaker digest scheme than the chain required at that point, which is how an attacker would dodge a keyed digest.",
    })
  }
  out.sort((a, b) => a.fromSeq - b.fromSeq)
  if (r.headChecked && !r.headMatch) {
    out.push({
      kind: "truncated",
      fromSeq: r.headSeq,
      toSeq: r.headSeq,
      title: `Head at sequence ${formatSeq(r.headSeq)} does not match`,
      explanation:
        "The chain's recorded head does not match its last event, so events after it may have been removed. No link inside the chain can show this.",
    })
  }
  if (r.checkpointHeadChecked && !r.checkpointHeadOk) {
    out.push({
      kind: "head-contradicted",
      fromSeq: r.headSeq,
      toSeq: r.headSeq,
      title: "A signed checkpoint contradicts the head",
      explanation: `A signed checkpoint says the chain once reached past sequence ${formatSeq(r.headSeq)}. Events the chain no longer claims were there when it was signed.`,
    })
  }
  return out
}

export function breakAnchor(b: Break): string {
  return `break-${b.kind}-${b.fromSeq}`
}
```

- [ ] **Step 5: Write the checks tests, then the module**

```ts
// packages/plugin-chronicle/test/verification/checks.test.ts
import { describe, expect, it } from "vitest"
import { checkpointRows, checksOf } from "../../src/verification/checks"
import { plainNoCheckpoints, report, truncated } from "./fixtures"

const byLabel = (rows: ReturnType<typeof checksOf>) => Object.fromEntries(rows.map((r) => [r.label, r]))

describe("checksOf", () => {
  it("covers all three states for every tri-state field", () => {
    // checked and held
    const held = byLabel(checksOf(report()))
    expect(held["Head"].state).toBe("held")
    expect(held["Checkpoints"].state).toBe("held")
    expect(held["Checkpoint against head"].state).toBe("held")
    // checked and failed
    const failed = byLabel(checksOf(truncated))
    expect(failed["Head"].state).toBe("failed")
    expect(failed["Checkpoint against head"].state).toBe("failed")
    // not checked
    const none = byLabel(checksOf(plainNoCheckpoints))
    expect(none["Checkpoints"].state).toBe("not-checked")
    expect(none["Checkpoints"].notChecked).toBe("Not checked, this deployment stores no checkpoints")
    expect(none["Checkpoint against head"].state).toBe("not-checked")
  })
  it("says why the head was not checked on a bounded range", () => {
    const rows = byLabel(checksOf(report({ partial: true, headChecked: false, lastEvent: 5000 })))
    expect(rows["Head"].state).toBe("not-checked")
    expect(rows["Head"].notChecked).toMatch(/stops before the head/)
  })
  it("says a chain with no checkpoint yet was not checked against one", () => {
    const rows = byLabel(checksOf(report({ checkpointHeadChecked: false, checkpointHeadOk: false })))
    expect(rows["Checkpoint against head"].notChecked).toMatch(/no checkpoint yet/)
  })
  it("fails the checkpoint row when any checkpoint failed a check that ran", () => {
    expect(byLabel(checksOf(truncated))["Checkpoints"].state).toBe("held")
    const bad = report({
      checkpoints: [{ id: "c", fromSeq: 1, toSeq: 10, signatureValid: false, hashMatch: true, hashChecked: true, continuityOk: true, continuityChecked: true }],
    })
    expect(byLabel(checksOf(bad))["Checkpoints"].state).toBe("failed")
  })
})

describe("checkpointRows", () => {
  it("keeps hash and continuity three-state per checkpoint", () => {
    const rows = checkpointRows(truncated.checkpoints![1])
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["Signature", "held"],
      ["Hash", "not-checked"],
      ["Continuity", "held"],
    ])
  })
})
```

The truncated fixture's second checkpoint has `hashChecked: false`. A hash that wasn't checked is `not-checked`, not a failure, so the "Checkpoints" row stays `held`. That's the point of the test above.

```ts
// packages/plugin-chronicle/src/verification/checks.ts
import type { CheckpointResult, VerifyReport } from "../types"
import { tri, type TriState } from "./tri-state"

export interface CheckRow {
  label: string
  state: TriState
  held: string
  failed: string
  notChecked: string
}

const NO_STORE = "Not checked, this deployment stores no checkpoints"

function checkpointOk(c: CheckpointResult): boolean {
  return c.signatureValid && (!c.hashChecked || c.hashMatch) && (!c.continuityChecked || c.continuityOk)
}

/** What the verification examined, one row per question, each in three states. */
export function checksOf(r: VerifyReport): CheckRow[] {
  const linksChecked = r.verified > 0
  const linksOk = (r.tampered ?? []).length === 0 && (r.downgrades ?? []).length === 0
  return [
    {
      label: "Digests and links",
      state: tri(linksChecked, linksOk),
      held: "Every event recomputes and links",
      failed: "Some events do not recompute or link",
      notChecked: "Not checked, the range holds no events",
    },
    {
      label: "Gaps",
      state: tri(linksChecked, (r.gaps ?? []).length === 0),
      held: "No unexplained gaps",
      failed: "Sequences missing",
      notChecked: "Not checked, the range holds no events",
    },
    {
      label: "Head",
      state: tri(r.headChecked, r.headMatch),
      held: "Matches the last event",
      failed: "Does not match the last event",
      notChecked: r.partial
        ? "Not checked, the range stops before the head"
        : "Not checked",
    },
    {
      label: "Checkpoints",
      state: tri(r.checkpointsChecked, (r.checkpoints ?? []).every(checkpointOk)),
      held: (r.checkpoints ?? []).length === 0 ? "None in this range" : "All hold",
      failed: "At least one fails",
      notChecked: NO_STORE,
    },
    {
      label: "Checkpoint against head",
      state: tri(r.checkpointHeadChecked, r.checkpointHeadOk),
      held: "Consistent with the head",
      failed: "Reaches past the head",
      notChecked: r.checkpointsChecked ? "Not checked, the chain has no checkpoint yet" : NO_STORE,
    },
  ]
}

export function checkpointRows(c: CheckpointResult): CheckRow[] {
  return [
    {
      label: "Signature",
      state: tri(true, c.signatureValid),
      held: "Valid",
      failed: "Invalid",
      notChecked: "Not checked",
    },
    {
      label: "Hash",
      state: tri(c.hashChecked, c.hashMatch),
      held: "Matches",
      failed: "Does not match",
      notChecked: c.note ?? "Not checked",
    },
    {
      label: "Continuity",
      state: tri(c.continuityChecked, c.continuityOk),
      held: "Continuous",
      failed: "Broken",
      notChecked: "Not checked",
    },
  ]
}
```

- [ ] **Step 6: Write the verdict tests**

```ts
// packages/plugin-chronicle/test/verification/verdict.test.ts
import { describe, expect, it } from "vitest"
import { verdictOf, verdictText } from "../../src/verification/verdict"
import { broken, mixed, plainNoCheckpoints, report, truncated } from "./fixtures"

const text = (r: Parameters<typeof verdictOf>[0]) => verdictText(verdictOf(r))
const STRONG = /\b(secure|protected|tamper-proof)\b/i

describe("verdictOf", () => {
  it("qualifies a pass on an unkeyed chain and makes its limits the loudest thing", () => {
    const v = verdictOf({ noChain: false, report: plainNoCheckpoints })
    expect(v.tone).toBe("pass")
    expect(verdictText(v)).toContain("No corruption detected in sequences 1 to 12,431.")
    expect(verdictText(v)).toContain(
      "This chain uses unkeyed digests: they detect accidental corruption, not deliberate alteration.",
    )
    expect(verdictText(v)).not.toMatch(/alteration detected|No alteration/)
    expect(verdictText(v)).not.toMatch(STRONG)
    expect(v.limitsLoud).toBe(true)
    expect(v.limits.join(" ")).toMatch(/events removed from the end of the chain cannot be detected/)
  })

  it("names the boundary on a mixed-level chain", () => {
    expect(text({ noChain: false, report: mixed })).toContain(
      "No alteration detected in sequences 1 to 61,004. Keyed from 48,201 onward, and everything below that predates the key and rests on an unkeyed digest.",
    )
  })

  it("says a bounded check does not speak for the rest of the chain", () => {
    const v = verdictOf({ noChain: false, report: report({ partial: true, firstEvent: 2431, lastEvent: 12431 }) })
    expect(v.qualifiers[0]).toBe("This check does not speak for the rest of the chain.")
    expect(verdictText(v)).toContain("sequences 2,431 to 12,431")
  })

  it("never calls a result with nothing verified a pass", () => {
    const v = verdictOf({
      noChain: false,
      report: report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false, checkpointHeadChecked: false, headChecked: false }),
    })
    expect(v.tone).toBe("nothing-checked")
    expect(verdictText(v)).toContain("No events verified.")
    expect(verdictText(v)).toMatch(/not a pass/)
    expect(verdictText(v)).toMatch(/Without signed checkpoints a chain wiped to its start looks exactly like this/)
  })

  it("says there is no chain rather than that the chain passed", () => {
    const v = verdictOf({ noChain: true })
    expect(v.tone).toBe("no-chain")
    expect(verdictText(v)).toMatch(/has not recorded any events/)
  })

  it("states breaks with their count and kinds, and the range examined", () => {
    const v = verdictOf({ noChain: false, report: broken })
    expect(v.tone).toBe("failed")
    expect(verdictText(v)).toContain("Breaks found in sequences 1 to 5,000: 2 missing, 1 altered, 1 relabelled.")
  })

  it("says a gap may be an unrecorded purge when policies can purge the chain", () => {
    expect(text({ noChain: false, report: broken })).toContain(
      "2 retention policies can purge this chain. A missing sequence may be a purge that was never recorded in the chain, which Chronicle cannot tell from a deletion.",
    )
  })

  it("says so when the policy count is unknown", () => {
    expect(text({ noChain: false, report: { ...broken, retentionPolicies: -1 } })).toContain(
      "Whether a retention policy removed any of these sequences is unknown: the policy count could not be read.",
    )
  })

  it("says nothing about retention policies when there are no gaps to explain", () => {
    expect(text({ noChain: false, report: { ...truncated, retentionPolicies: 3 } })).not.toMatch(/retention polic/)
  })

  it("describes a retained range as removed by retention, backed by a record, never as a break", () => {
    const t = text({ noChain: false, report: { ...broken } })
    expect(t).toContain(
      "Sequences 101 to 400 were removed by a retention policy, recorded in the chain at sequence 401. The chain links across them; what they said is gone.",
    )
  })

  it("names a truncated head and a contradicting checkpoint", () => {
    expect(text({ noChain: false, report: truncated })).toContain(
      "Breaks found in sequences 1 to 3,000: the head does not match the last event, and a signed checkpoint says the chain once reached further.",
    )
  })

  it("puts the sequence numbers in mono parts", () => {
    const v = verdictOf({ noChain: false, report: plainNoCheckpoints })
    expect(v.headline.filter((p) => p.mono).map((p) => p.text)).toEqual(["1", "12,431"])
  })

  it("notes tolerant sequences as a caveat, not a failure", () => {
    const v = verdictOf({ noChain: false, report: report({ tolerant: [5, 6] }) })
    expect(v.tone).toBe("pass")
    expect(verdictText(v)).toContain(
      "2 events recorded no digest scheme, so their scheme was inferred when they were checked.",
    )
  })
})
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test -- verification`
Expected: the window, tri-state, breaks and checks suites PASS (implemented in Steps 2 to 5), and `verdict.test.ts` FAILS with "Cannot find module '../../src/verification/verdict'".

- [ ] **Step 8: Implement `verdict.ts`**

```ts
// packages/plugin-chronicle/src/verification/verdict.ts
import type { CoverageSpan, VerifyReport, VerifyResponse } from "../types"
import { formatSeq } from "../format"
import { breaksOf } from "./breaks"

export interface VerdictPart {
  text: string
  mono?: boolean
}

export type VerdictTone = "failed" | "pass" | "nothing-checked" | "no-chain"

/**
 * What the chain page says about one verification.
 *
 * The verdict is a sentence, not a badge: a qualified truth does not compress
 * into a tick. `headline` is the page's one bold element, with the sequence
 * numbers in mono parts so they read as a finding. `qualifiers` follow it in
 * order and are part of the verdict, not footnotes. `limits` is what the
 * method could not see; `limitsLoud` says the limits must be the loudest
 * thing on screen, which is the case for any pass that rests on an unkeyed
 * digest.
 */
export interface Verdict {
  tone: VerdictTone
  headline: VerdictPart[]
  qualifiers: string[]
  limits: string[]
  limitsLoud: boolean
}

const t = (text: string): VerdictPart => ({ text })
const seq = (n: number): VerdictPart => ({ text: formatSeq(n), mono: true })

function rangeParts(prefix: string, from: number, to: number, suffix: string): VerdictPart[] {
  return [t(`${prefix} sequences `), seq(from), t(" to "), seq(to), t(suffix)]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The first sequence at or above which the chain is keyed, if it is mixed. */
function keyedBoundary(spans: CoverageSpan[]): number | null {
  const hasUnkeyed = spans.some((s) => s.level === "unkeyed")
  const firstAbove = spans.find((s) => s.level !== "unkeyed")
  return hasUnkeyed && firstAbove ? firstAbove.fromSeq : null
}

function limitsOf(r: VerifyReport, spans: CoverageSpan[]): string[] {
  const out: string[] = []
  const unkeyed = spans.filter((s) => s.level === "unkeyed")
  if (unkeyed.length > 0) {
    const from = unkeyed[0].fromSeq
    const to = unkeyed[unkeyed.length - 1].toSeq
    out.push(
      `Sequences ${formatSeq(from)} to ${formatSeq(to)} rest on unkeyed digests. Anyone who can write the database can recompute them, so a deliberate rewrite of those events would not be detected.`,
    )
  }
  if (!r.checkpointsChecked) {
    out.push("This deployment stores no checkpoints, so events removed from the end of the chain cannot be detected.")
  }
  if (r.partial) {
    out.push(
      `Only sequences ${formatSeq(r.firstEvent)} to ${formatSeq(r.lastEvent)} were examined. The chain's head is at sequence ${formatSeq(r.headSeq)}.`,
    )
  }
  if (!spans.some((s) => s.level === "anchored")) {
    out.push("Nothing anchors this chain outside the deployment, so someone who controls both the database and the signing key could rewrite it consistently.")
  }
  return out
}

function retainedQualifiers(r: VerifyReport): string[] {
  return (r.retained ?? []).map((rg) => {
    const what =
      rg.fromSeq === rg.toSeq
        ? `Sequence ${formatSeq(rg.fromSeq)} was`
        : `Sequences ${formatSeq(rg.fromSeq)} to ${formatSeq(rg.toSeq)} were`
    const backfill = rg.backfill ? ` The record was recovered afterwards from the archive ${rg.backfill}.` : ""
    return `${what} removed by a retention policy, recorded in the chain at sequence ${formatSeq(rg.recordSeq)}. The chain links across them; what they said is gone.${backfill}`
  })
}

function retentionQualifier(r: VerifyReport): string | null {
  if ((r.gaps ?? []).length === 0) return null
  if (r.retentionPolicies < 0) {
    return "Whether a retention policy removed any of these sequences is unknown: the policy count could not be read."
  }
  if (r.retentionPolicies === 0) return null
  return `${plural(r.retentionPolicies, "retention policy", "retention policies")} can purge this chain. A missing sequence may be a purge that was never recorded in the chain, which Chronicle cannot tell from a deletion.`
}

function tolerantQualifier(r: VerifyReport): string | null {
  const n = (r.tolerant ?? []).length
  if (n === 0) return null
  return `${plural(n, "event", "events")} recorded no digest scheme, so their scheme was inferred when they were checked.`
}

export function verdictOf(response: VerifyResponse): Verdict {
  const r = response.report
  if (response.noChain || !r) {
    return {
      tone: "no-chain",
      headline: [t("This scope has not recorded any events, so there is no chain to verify.")],
      qualifiers: [],
      limits: [],
      limitsLoud: false,
    }
  }

  const spans = r.coverage ?? []
  const limits = limitsOf(r, spans)
  const partial = r.partial ? ["This check does not speak for the rest of the chain."] : []

  if (!r.valid) {
    const breaks = breaksOf(r)
    const count = (k: string) => breaks.filter((b) => b.kind === k).reduce((n, b) => n + (b.toSeq - b.fromSeq + 1), 0)
    const kinds: string[] = []
    if (count("missing")) kinds.push(`${count("missing")} missing`)
    if (count("altered")) kinds.push(`${count("altered")} altered`)
    if (count("relabelled")) kinds.push(`${count("relabelled")} relabelled`)
    const head: string[] = []
    if (breaks.some((b) => b.kind === "truncated")) head.push("the head does not match the last event")
    if (breaks.some((b) => b.kind === "head-contradicted")) head.push("a signed checkpoint says the chain once reached further")
    const summary = [kinds.join(", "), head.join(", and ")].filter(Boolean).join("; ")
    const from = r.firstEvent || 1
    const to = r.lastEvent || r.headSeq
    return {
      tone: "failed",
      headline: rangeParts("Breaks found in", from, to, `: ${summary || "a checkpoint check failed"}.`),
      qualifiers: [...partial, ...[retentionQualifier(r)].filter((q): q is string => q !== null), ...retainedQualifiers(r)],
      limits,
      limitsLoud: false,
    }
  }

  if (r.verified === 0) {
    const wiped = r.checkpointsChecked
      ? "The chain has no events in this range."
      : "Without signed checkpoints a chain wiped to its start looks exactly like this."
    return {
      tone: "nothing-checked",
      headline: [t("No events verified.")],
      qualifiers: [`An empty range verifies trivially, and that is not a pass. ${wiped}`],
      limits,
      limitsLoud: false,
    }
  }

  const allUnkeyed = spans.length === 0 || spans.every((s) => s.level === "unkeyed")
  const boundary = keyedBoundary(spans)
  const qualifiers: string[] = [...partial]
  let headline: VerdictPart[]
  if (allUnkeyed) {
    headline = rangeParts("No corruption detected in", r.firstEvent, r.lastEvent, ".")
    qualifiers.unshift("This chain uses unkeyed digests: they detect accidental corruption, not deliberate alteration.")
  } else if (boundary !== null) {
    headline = [
      ...rangeParts("No alteration detected in", r.firstEvent, r.lastEvent, ". "),
      t("Keyed from "),
      seq(boundary),
      t(" onward, and everything below that predates the key and rests on an unkeyed digest."),
    ]
  } else {
    headline = rangeParts("No alteration detected in", r.firstEvent, r.lastEvent, ".")
  }
  const tolerant = tolerantQualifier(r)
  if (tolerant) qualifiers.push(tolerant)
  qualifiers.push(...retainedQualifiers(r))

  return { tone: "pass", headline, qualifiers, limits, limitsLoud: allUnkeyed || boundary !== null }
}

/** The verdict as one string: the page's accessible description, and what tests read. */
export function verdictText(v: Verdict): string {
  return [v.headline.map((p) => p.text).join(""), ...v.qualifiers, ...v.limits].join(" ")
}
```

In the unkeyed case the partial qualifier must come after the unkeyed sentence. The code builds `qualifiers` from `partial` first, then `unshift`s the unkeyed sentence ahead of it, so the order is right. The "bounded check" test uses a keyed report and expects the partial sentence at index 0.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test -- verification`
Expected: PASS, every suite.

- [ ] **Step 10: Prove the tests bite**

Run each of these in a throwaway edit, then restore:
- (a) In `tri`, return `ok ? "held" : "failed"` without checking `checked`. The tri-state and checks tests must fail.
- (b) In `verdictOf`, drop the `verified === 0` branch. "never calls a result with nothing verified a pass" must fail.
- (c) Include retained ranges in `breaksOf` as `missing`. "never lists a retained range as a break" must fail.
- (d) Drop the `unshift` of the unkeyed sentence. The unkeyed test must fail.
- (e) Make `keyedBoundary` return null. The mixed-level test must fail.

Record each in the task report.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm --filter @forge-go/dashboard-plugin-chronicle typecheck && pnpm --filter @forge-go/dashboard-plugin-chronicle lint
git add packages/plugin-chronicle/src/verification packages/plugin-chronicle/test/verification
git commit -m "feat(plugin-chronicle): decide what a verification result is allowed to say"
```

---
### Task 5: The chain page: posture, the run form, and the certificate

The landing page. It reads your chain from scope (never typed) and shows the posture that needs no chain walk. It runs a verification only when you ask, and renders the result as a certificate of analysis, a document read top to bottom:
- what was examined;
- by what method;
- over what range;
- what was found;
- what the method can't see.

Read the spec's "The verification surface", "A chain is not one level", "The span ribbon" and "Verification is bounded by default" before starting. Invoke the `frontend-design` skill before writing the certificate's markup. The design was agreed in the spec, and the skill keeps the execution to it: no card grid, one bold element, saturated colour only for failure.

**Files:**
- Create:
  - `packages/plugin-chronicle/src/components/chain-picker.tsx`
  - `src/verification/ribbon.tsx`
  - `src/verification/certificate.tsx`
  - `src/pages/chain.tsx`
- Modify: `packages/plugin-chronicle/src/index.tsx` (routes `/`, `/chain`, `/chain/:streamId`, `/chain/:streamId/:fromSeq/:toSeq`; nav "Chain" in group "Integrity", priority 0, `<ShieldCheckIcon />` or the nearest lucide icon that exists)
- Test:
  - `packages/plugin-chronicle/test/ribbon.test.tsx`
  - `test/certificate.test.tsx`
  - `test/chain.test.tsx`
  - `test/no-success-colour.test.ts`

**Interfaces:**
- Consumes: everything Task 4 produces; `StreamSummary`, `MineResponse`, `StreamListResponse`, `VerifyResponse` from `types.ts`; `CoverageBadge` from `badges.tsx`; `useQuery(intent, params, { enabled })` from Task 1.
- Produces:
  - `ChainPage: ComponentType<PluginPageProps>`
  - `ChainPicker(props: { streams: StreamSummary[]; selectedId?: string; basePath: "/chain" | "/checkpoints/in" })` (Task 6 reuses it)
  - `Certificate(props: { response: VerifyResponse })`
  - `Ribbon(props: { report: VerifyReport; fromSeq: number; toSeq: number })`
  - `chainLabel(s: StreamSummary): string`

- [ ] **Step 1: Write the ribbon tests**

```tsx
// packages/plugin-chronicle/test/ribbon.test.tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Ribbon } from "../src/verification/ribbon"
import { broken, mixed } from "./verification/fixtures"

describe("Ribbon", () => {
  it("draws one band per coverage span, labelled with its level", () => {
    render(<Ribbon report={mixed} fromSeq={1} toSeq={61004} />)
    expect(screen.getAllByTestId("ribbon-band").map((b) => b.getAttribute("data-level"))).toEqual([
      "unkeyed",
      "signed",
      "keyed",
    ])
  })

  it("puts each break at its sequence as a focusable control named for it", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    const markers = screen.getAllByRole("button")
    expect(markers.map((m) => m.getAttribute("aria-label"))).toEqual([
      "Sequences 2,311 to 2,312 missing",
      "Sequence 2,780 altered",
      "Sequence 2,901 relabelled",
    ])
    // 2780 of 1..5000 sits a little past halfway.
    expect(markers[1].style.left).toBe("55.58%")
  })

  it("moves focus to the break's row when a marker is activated", () => {
    render(
      <>
        <Ribbon report={broken} fromSeq={1} toSeq={5000} />
        <table>
          <tbody>
            <tr id="break-altered-2780" tabIndex={-1}>
              <td>row</td>
            </tr>
          </tbody>
        </table>
      </>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Sequence 2,780 altered" }))
    expect(document.activeElement?.id).toBe("break-altered-2780")
  })

  it("shades retained ranges without calling them breaks", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    expect(screen.getAllByTestId("ribbon-retained")).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /101/ })).toBeNull()
  })

  it("does not animate when the operator prefers reduced motion", () => {
    render(<Ribbon report={broken} fromSeq={1} toSeq={5000} />)
    expect(screen.getByTestId("ribbon-track").className).toContain("motion-reduce:transition-none")
  })
})
```

`jsdom` has no `scrollIntoView`. The ribbon must call it through optional chaining (`el.scrollIntoView?.({ block: "center" })`), so the focus assertion runs.

- [ ] **Step 2: Implement the ribbon**

```tsx
// packages/plugin-chronicle/src/verification/ribbon.tsx
import { useEffect, useState } from "react"
import type { VerifyReport } from "../types"
import { formatSeq } from "../format"
import { breakAnchor, breaksOf } from "./breaks"

/**
 * The span ribbon: a hash chain drawn as what it is, a line.
 *
 * Coverage bands are the base layer, checkpoints are notches, retained ranges
 * are hatched, and breaks are markers at their exact positions. Each marker is
 * a real button that moves focus to its row in the break table, which is how
 * somebody working through a failure gets from "where" to "what" without
 * losing their place. A chain is linear, one edge per node, so this is a
 * positional ribbon and not a graph canvas.
 *
 * The only motion on the page: the track draws once when a result arrives,
 * and not at all under reduced motion.
 */
const BAND: Record<string, string> = {
  unkeyed: "bg-muted",
  keyed: "bg-foreground/30",
  signed: "bg-foreground/60",
  anchored: "bg-foreground",
}

export function Ribbon({ report, fromSeq, toSeq }: { report: VerifyReport; fromSeq: number; toSeq: number }) {
  const [drawn, setDrawn] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const width = Math.max(1, toSeq - fromSeq + 1)
  const pct = (seq: number) => `${(((seq - fromSeq) / width) * 100).toFixed(2)}%`
  const pctWidth = (from: number, to: number) => `${(((to - from + 1) / width) * 100).toFixed(2)}%`
  const breaks = breaksOf(report).filter((b) => b.kind !== "truncated" && b.kind !== "head-contradicted")

  const focusRow = (anchor: string) => {
    const el = document.getElementById(anchor)
    el?.scrollIntoView?.({ block: "center" })
    el?.focus()
  }

  return (
    <div className="relative h-10 w-full" aria-label={`Chain from sequence ${formatSeq(fromSeq)} to ${formatSeq(toSeq)}`} role="group">
      <div
        data-testid="ribbon-track"
        className="absolute inset-x-0 top-3 h-4 origin-left overflow-hidden rounded-sm border motion-safe:transition-transform motion-safe:duration-700 motion-reduce:transition-none"
        style={{ transform: drawn ? "scaleX(1)" : "scaleX(0)" }}
      >
        {(report.coverage ?? []).map((s) => (
          <div
            key={`${s.fromSeq}-${s.level}`}
            data-testid="ribbon-band"
            data-level={s.level}
            title={`${s.level}: sequences ${formatSeq(s.fromSeq)} to ${formatSeq(s.toSeq)}`}
            className={`absolute inset-y-0 ${BAND[s.level] ?? "bg-muted"}`}
            style={{ left: pct(s.fromSeq), width: pctWidth(s.fromSeq, s.toSeq) }}
          />
        ))}
        {(report.retained ?? []).map((r) => (
          <div
            key={`retained-${r.fromSeq}`}
            data-testid="ribbon-retained"
            title={`Removed by retention: sequences ${formatSeq(r.fromSeq)} to ${formatSeq(r.toSeq)}`}
            className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--border)_3px,var(--border)_5px)] bg-background"
            style={{ left: pct(r.fromSeq), width: pctWidth(r.fromSeq, r.toSeq) }}
          />
        ))}
        {(report.checkpoints ?? []).map((c) => (
          <div
            key={c.id}
            aria-hidden
            className="absolute inset-y-0 w-px bg-foreground"
            style={{ left: pct(Math.min(c.toSeq, toSeq)) }}
          />
        ))}
      </div>
      {breaks.map((b) => (
        <button
          key={breakAnchor(b)}
          type="button"
          aria-label={b.title}
          onClick={() => focusRow(breakAnchor(b))}
          className="absolute top-1 h-8 w-2 -translate-x-1/2 rounded-sm bg-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          style={{ left: pct(b.fromSeq) }}
        />
      ))}
    </div>
  )
}
```

`requestAnimationFrame` exists in jsdom. If the kit's Tailwind config lacks an arbitrary-value utility used here, fall back to an inline `style` with the same gradient, and say so in your report.

- [ ] **Step 3: Write the certificate tests**

```tsx
// packages/plugin-chronicle/test/certificate.test.tsx
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Certificate } from "../src/verification/certificate"
import { broken, mixed, plainNoCheckpoints, report, truncated } from "./verification/fixtures"

describe("Certificate", () => {
  it("reads in order: verdict, limits, ribbon, breaks, checks, coverage", () => {
    render(<Certificate response={{ noChain: false, report: broken }} />)
    const headings = screen.getAllByRole("heading").map((h) => h.textContent)
    expect(headings).toEqual([
      expect.stringContaining("Breaks found"),
      "What this check cannot see",
      "Where",
      "What was found",
      "Removed by retention",
      "What was examined",
      "Coverage",
    ])
  })

  it("makes an unkeyed pass's limits the loudest thing, directly under the verdict", () => {
    render(<Certificate response={{ noChain: false, report: plainNoCheckpoints }} />)
    const limits = screen.getByRole("region", { name: "What this check cannot see" })
    expect(limits.getAttribute("data-loud")).toBe("true")
    expect(limits.compareDocumentPosition(screen.getByRole("region", { name: "Where" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("renders all three states of a checked field on one page", () => {
    // held: head; failed: checkpoint against head; not checked: a checkpoint hash
    render(<Certificate response={{ noChain: false, report: truncated }} />)
    const examined = screen.getByRole("region", { name: "What was examined" })
    expect(within(examined).getByText("Does not match the last event")).toBeTruthy()
    expect(within(examined).getByText("Reaches past the head")).toBeTruthy()
    const notChecked = within(examined).getByText("The checkpoint ends past the chain's head, so its hash could not be compared.")
    expect(notChecked.className).toContain("text-muted-foreground")
  })

  it("never renders a missing checkpoint store as No", () => {
    render(<Certificate response={{ noChain: false, report: plainNoCheckpoints }} />)
    expect(screen.getAllByText("Not checked, this deployment stores no checkpoints").length).toBeGreaterThan(0)
    expect(screen.queryByText(/^No$/)).toBeNull()
  })

  it("gives every break a focusable row with its anchor", () => {
    render(<Certificate response={{ noChain: false, report: broken }} />)
    const row = document.getElementById("break-altered-2780")
    expect(row?.getAttribute("tabindex")).toBe("-1")
    expect(row?.textContent).toContain("2,780")
  })

  it("lists coverage spans with their level badges and mono ranges", () => {
    render(<Certificate response={{ noChain: false, report: mixed }} />)
    const cov = screen.getByRole("region", { name: "Coverage" })
    expect(within(cov).getByText("unkeyed")).toBeTruthy()
    expect(within(cov).getByText("48,201").className).toContain("font-mono")
  })

  it("puts nothing in destructive colour for a pass", () => {
    const { container } = render(<Certificate response={{ noChain: false, report: report() }} />)
    expect(container.querySelector(".text-destructive, .bg-destructive")).toBeNull()
  })

  it("says there is no chain, and nothing else, when the scope never recorded", () => {
    render(<Certificate response={{ noChain: true }} />)
    expect(screen.getByText(/has not recorded any events/)).toBeTruthy()
    expect(screen.queryByRole("region", { name: "What was examined" })).toBeNull()
  })
})
```

- [ ] **Step 4: Implement the certificate**

```tsx
// packages/plugin-chronicle/src/verification/certificate.tsx
import type { ReactNode } from "react"
import type { VerifyResponse } from "../types"
import { CoverageBadge } from "../badges"
import { formatSeq } from "../format"
import { breakAnchor, breaksOf } from "./breaks"
import { checkpointRows, checksOf, type CheckRow } from "./checks"
import { Ribbon } from "./ribbon"
import { TriStateMark } from "./tri-state"
import { verdictOf } from "./verdict"

/**
 * A verification result as a certificate of analysis: what was examined, by
 * what method, over what range, what was found, and what the method cannot
 * see, in that order, as one document. No card grid: cards chop one argument
 * into unrelated tiles.
 */
export function Certificate({ response }: { response: VerifyResponse }) {
  const v = verdictOf(response)
  const r = response.report
  const failed = v.tone === "failed"

  const verdict = (
    <div>
      <h2 className={`text-2xl font-normal leading-snug ${failed ? "text-destructive" : ""}`}>
        {v.headline.map((p, i) =>
          p.mono ? (
            <span key={i} className="font-mono">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </h2>
      {v.qualifiers.map((q) => (
        <p key={q} className="mt-2 max-w-prose text-base">
          {q}
        </p>
      ))}
    </div>
  )

  if (!r) return <article className="flex flex-col gap-6">{verdict}</article>

  const limits =
    v.limits.length > 0 ? (
      <Section title="What this check cannot see" loud={v.limitsLoud}>
        <ul className={v.limitsLoud ? "flex flex-col gap-2 text-base font-medium" : "flex flex-col gap-1 text-sm"}>
          {v.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
    ) : null

  const breaks = breaksOf(r)
  const from = r.firstEvent || 1
  const to = Math.max(r.lastEvent, r.headSeq, from)

  return (
    <article className="flex flex-col gap-8">
      {verdict}
      {limits}
      <Section title="Where">
        <Ribbon report={r} fromSeq={from} toSeq={to} />
        <p className="mt-1 flex justify-between font-mono text-xs text-muted-foreground">
          <span>{formatSeq(from)}</span>
          <span>{formatSeq(to)}</span>
        </p>
      </Section>
      {breaks.length > 0 && (
        <Section title="What was found">
          <table className="w-full text-sm">
            <caption className="sr-only">{`${breaks.length} breaks`}</caption>
            <tbody>
              {breaks.map((b) => (
                <tr key={breakAnchor(b)} id={breakAnchor(b)} tabIndex={-1} className="border-b align-top focus:bg-muted focus:outline-none">
                  <td className="py-2 pr-4 font-mono text-xs whitespace-nowrap">
                    {b.fromSeq === b.toSeq ? formatSeq(b.fromSeq) : `${formatSeq(b.fromSeq)} to ${formatSeq(b.toSeq)}`}
                  </td>
                  <td className="py-2">
                    <div className="font-medium text-destructive">{b.title}</div>
                    <div className="text-muted-foreground">{b.explanation}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {(r.retained ?? []).length > 0 && (
        <Section title="Removed by retention">
          <ul className="flex flex-col gap-1 text-sm">
            {(r.retained ?? []).map((rg) => (
              <li key={rg.fromSeq}>
                <span className="font-mono text-xs">
                  {formatSeq(rg.fromSeq)} to {formatSeq(rg.toSeq)}
                </span>
                {", recorded at sequence "}
                <span className="font-mono text-xs">{formatSeq(rg.recordSeq)}</span>
                {rg.policyId ? (
                  <>
                    {" under "}
                    <span className="font-mono text-xs">{rg.policyId}</span>
                  </>
                ) : null}
                {rg.backfill ? `, recovered from ${rg.backfill}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="What was examined">
        <p className="mb-3 text-sm">
          {`${formatSeq(r.verified)} events read, sequences ${formatSeq(from)} to ${formatSeq(r.lastEvent)}.`}
        </p>
        <CheckTable rows={checksOf(r)} />
        {(r.checkpoints ?? []).map((c) => (
          <div key={c.id} className="mt-4">
            <p className="text-sm">
              Checkpoint <span className="font-mono text-xs">{c.id}</span>, sequences{" "}
              <span className="font-mono text-xs">
                {formatSeq(c.fromSeq)} to {formatSeq(c.toSeq)}
              </span>
            </p>
            <CheckTable rows={checkpointRows(c)} />
          </div>
        ))}
      </Section>
      <Section title="Coverage">
        <ul className="flex flex-col gap-1 text-sm">
          {(r.coverage ?? []).map((s) => (
            <li key={`${s.fromSeq}-${s.level}`} className="flex items-center gap-2">
              <CoverageBadge level={s.level} />
              <span className="font-mono text-xs">{formatSeq(s.fromSeq)}</span>
              <span>to</span>
              <span className="font-mono text-xs">{formatSeq(s.toSeq)}</span>
              {s.note ? <span className="text-muted-foreground">{s.note}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </article>
  )
}

function Section({ title, loud, children }: { title: string; loud?: boolean; children: ReactNode }) {
  const id = `cert-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`
  return (
    <section aria-labelledby={id} role="region" data-loud={loud ? "true" : undefined} className={loud ? "border-l-2 border-foreground pl-4" : ""}>
      <h3 id={id} className="mb-2 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function CheckTable({ rows }: { rows: CheckRow[] }) {
  return (
    <dl className="grid grid-cols-[12rem_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt>{row.label}</dt>
          <dd>
            <TriStateMark state={row.state} held={row.held} failed={row.failed} notChecked={row.notChecked} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
```

The certificate's heading order is part of the design. The first test pins it. If the frontend-design pass changes the order, change the test in the same commit, and say why in your report.

- [ ] **Step 5: Write the chain picker**

```tsx
// packages/plugin-chronicle/src/components/chain-picker.tsx
import { useNavigateTo } from "@forge-go/dashboard-plugin"
import type { StreamSummary } from "../types"
import { formatSeq } from "../format"

/** How a chain is named to a person: its tenant, or the app itself. */
export function chainLabel(s: StreamSummary): string {
  return s.tenantId ? `Tenant ${s.tenantId}` : "App level"
}

/**
 * For an app-wide operator, who has one chain per tenant. A tenant operator
 * has exactly one chain and never sees this: the page does not render it
 * when there is nothing to choose.
 */
export function ChainPicker({
  streams,
  selectedId,
  basePath,
}: {
  streams: StreamSummary[]
  selectedId?: string
  basePath: "/chain" | "/checkpoints/in"
}) {
  const navigate = useNavigateTo()
  return (
    <label className="flex items-center gap-2 text-sm">
      <span>Chain</span>
      <select
        aria-label="Chain"
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={selectedId ?? ""}
        onChange={(e) => navigate(`${basePath}/${encodeURIComponent(e.target.value)}`)}
      >
        {selectedId === undefined && <option value="">Choose a chain</option>}
        {streams.map((s) => (
          <option key={s.id} value={s.id}>
            {`${chainLabel(s)}, head ${formatSeq(s.headSeq)}`}
          </option>
        ))}
      </select>
    </label>
  )
}
```

If kit's `native-select.tsx` wraps a `<select>` with the same props, use it in place of the raw element. Read it first.

- [ ] **Step 6: Write the chain page tests**

```tsx
// packages/plugin-chronicle/test/chain.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ChainPage } from "../src/pages/chain"
import { renderPage, scriptedClient } from "./harness"
import type { StreamSummary } from "../src/types"
import { broken, plainNoCheckpoints, report } from "./verification/fixtures"

const own: StreamSummary = {
  id: "stream_app",
  appId: "app_chronicle",
  headHash: "9f2c61a04be7d85c3a1e0f47b6d29c85e1a3f0b7c4d2e6a8f9b0c1d2e3f4a5b6",
  headSeq: 12431,
  scheme: "chronicle/v4",
  schemeSince: 1,
  coverageCeiling: "unkeyed",
  checkpointingConfigured: false,
}
const acme: StreamSummary = { ...own, id: "stream_acme", tenantId: "acme", headSeq: 61004, scheme: "chronicle/v5", schemeSince: 48201, coverageCeiling: "signed", checkpointingConfigured: true }

function client(over: Record<string, unknown> = {}) {
  return scriptedClient({
    "streams.mine": (p) => (p.streamId === "stream_acme" ? { stream: acme } : { stream: own }),
    "streams.list": { streams: [own], total: 1, hasMore: false },
    "verify.run": { noChain: false, report: plainNoCheckpoints },
    ...over,
  })
}

describe("ChainPage", () => {
  it("shows the posture and runs nothing until asked", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(screen.getByText("12,431")).toBeTruthy()
    expect(c.queried.some((q) => q.intent === "verify.run")).toBe(false)
  })

  it("verifies the most recent 10,000 sequences by default", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/No corruption detected/)).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_app", fromSeq: 2432, toSeq: 12431 })
  })

  it("sends the range the operator typed", async () => {
    const c = client()
    renderPage(ChainPage, c.client)
    fireEvent.change(await screen.findByLabelText("From sequence"), { target: { value: "100" } })
    fireEvent.change(screen.getByLabelText("To sequence"), { target: { value: "200" } })
    fireEvent.click(screen.getByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_app", fromSeq: 100, toSeq: 200 }))
  })

  it("offers the whole chain when it fits under the cap, and says why not when it does not", async () => {
    renderPage(ChainPage, client().client)
    expect((await screen.findByRole("button", { name: "Check the whole chain" })).hasAttribute("disabled")).toBe(false)
    renderPage(ChainPage, client({ "streams.mine": { stream: { ...own, headSeq: 250_000 } } }).client)
    const buttons = await screen.findAllByRole("button", { name: "Check the whole chain" })
    expect(buttons[buttons.length - 1].hasAttribute("disabled")).toBe(true)
    expect(screen.getByText(/checks at most 100,000 sequences at a time/)).toBeTruthy()
  })

  it("shows the server's refusal of an oversized range and offers a bounded window", async () => {
    const c = client({
      "verify.run": new ContractError("BAD_REQUEST", "requested range covers 200000 events, which exceeds the 100000-event limit on a single verification"),
    })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText(/exceeds the 100000-event limit/)).toBeTruthy())
    expect(screen.getByRole("button", { name: "Check the most recent 10,000 instead" })).toBeTruthy()
  })

  it("runs at once with the range a deep link names", async () => {
    const c = client({ "verify.run": { noChain: false, report: broken } })
    renderPage(ChainPage, c.client, { streamId: "stream_acme", fromSeq: "2730", toSeq: "2830" })
    await waitFor(() => expect(screen.getByText(/Breaks found/)).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "verify.run")?.params).toEqual({ streamId: "stream_acme", fromSeq: 2730, toSeq: 2830 })
  })

  it("offers a tenant's chain to an app-wide operator whose app-level scope has none", async () => {
    renderPage(
      ChainPage,
      client({ "streams.mine": {}, "streams.list": { streams: [acme], total: 1, hasMore: false } }).client,
    )
    await waitFor(() => expect(screen.getByText(/This app has no app-level chain/)).toBeTruthy())
    expect(screen.getByLabelText("Chain")).toBeTruthy()
    expect(screen.queryByText(/has not recorded any events/)).toBeNull()
  })

  it("says the scope has recorded nothing when there are no chains at all", async () => {
    renderPage(ChainPage, client({ "streams.mine": {}, "streams.list": { streams: [], total: 0, hasMore: false } }).client)
    await waitFor(() => expect(screen.getByText(/has not recorded any events yet/)).toBeTruthy())
  })

  it("shows no picker to an operator with exactly one chain", async () => {
    renderPage(ChainPage, client().client)
    await waitFor(() => expect(screen.getByText("chronicle/v4")).toBeTruthy())
    expect(screen.queryByLabelText("Chain")).toBeNull()
  })

  it("shows the picker when there is more than one chain", async () => {
    renderPage(ChainPage, client({ "streams.list": { streams: [own, acme], total: 2, hasMore: false } }).client)
    expect(await screen.findByLabelText("Chain")).toBeTruthy()
  })

  it("never reads nothing verified as a pass", async () => {
    const c = client({ "verify.run": { noChain: false, report: report({ verified: 0, firstEvent: 0, lastEvent: 0, headSeq: 0, coverage: undefined, checkpointsChecked: false, checkpointHeadChecked: false, headChecked: false }) } })
    renderPage(ChainPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Check this range" }))
    await waitFor(() => expect(screen.getByText("No events verified.")).toBeTruthy())
  })

  it("shows how far the latest checkpoint sits behind the head", async () => {
    renderPage(
      ChainPage,
      client({ "streams.mine": { stream: { ...acme, latestCheckpoint: { id: "ckpt_acme_6", fromSeq: 50001, toSeq: 60000, eventCount: 10000, createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09" } } } }).client,
    )
    await waitFor(() => expect(screen.getByText(/1,004 events behind the head/)).toBeTruthy())
  })

  it("says checkpointing is off rather than that the chain has no checkpoints", async () => {
    renderPage(ChainPage, client().client)
    await waitFor(() => expect(screen.getByText(/This deployment takes no checkpoints/)).toBeTruthy())
  })
})
```

Rendering `ChainPage` twice in one test (the cap test) leaves both trees mounted, which is why that test takes the last matching button. If the harness's `renderPage` returns `unmount`, unmount the first render instead: it's cleaner.

- [ ] **Step 7: Implement the chain page**

```tsx
// packages/plugin-chronicle/src/pages/chain.tsx
import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { DescriptionList } from "@forge-go/dashboard-kit/components/description-list"
import { CommandAlert } from "@forge-go/dashboard-kit/components/command-alert"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { MineResponse, StreamListResponse, StreamSummary, VerifyResponse } from "../types"
import { CoverageBadge } from "../badges"
import { formatSeq, shortHash } from "../format"
import { ChainPicker, chainLabel } from "../components/chain-picker"
import { Certificate } from "../verification/certificate"
import { defaultWindow, exceedsCap, parseRangeParams, wholeChain, DEFAULT_WINDOW, type SeqRange } from "../verification/window"

export const ChainPage: ComponentType<PluginPageProps> = ({ params }) => {
  const streamId = params.streamId
  const mine = useQuery<MineResponse>("streams.mine", streamId ? { streamId } : {})
  const list = useQuery<StreamListResponse>("streams.list", { limit: 200 })
  const streams = list.data?.streams ?? []

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Chain"
        description="The hash chain your audit events are recorded in, and whether it has been altered."
        actions={streams.length > 1 ? <ChainPicker streams={streams} selectedId={mine.data?.stream?.id} basePath="/chain" /> : undefined}
      />
      <QueryBoundary title="chain" query={mine} skeletonRows={4}>
        {(m) =>
          m.stream ? (
            <ChainBody
              key={`${m.stream.id}-${params.fromSeq ?? ""}-${params.toSeq ?? ""}`}
              stream={m.stream}
              deepLink={parseRangeParams(params.fromSeq, params.toSeq)}
            />
          ) : (
            <NoOwnChain streams={streams} />
          )
        }
      </QueryBoundary>
    </section>
  )
}

function NoOwnChain({ streams }: { streams: StreamSummary[] }) {
  if (streams.length === 0) {
    return <p className="text-sm">This scope has not recorded any events yet, so there is no chain to show.</p>
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>This app has no app-level chain: its events are recorded under its tenants. Choose a tenant's chain to verify.</p>
      <ChainPicker streams={streams} basePath="/chain" />
    </div>
  )
}

function ChainBody({ stream, deepLink }: { stream: StreamSummary; deepLink: SeqRange | null }) {
  const initial = deepLink ?? defaultWindow(stream.headSeq)
  const [from, setFrom] = useState(String(initial?.fromSeq ?? ""))
  const [to, setTo] = useState(String(initial?.toSeq ?? ""))
  // A deep link is the operator asking: it runs at once. Otherwise nothing runs until a button is pressed.
  const [requested, setRequested] = useState<SeqRange | null>(deepLink)

  const verify = useQuery<VerifyResponse>(
    "verify.run",
    requested ? { streamId: stream.id, fromSeq: requested.fromSeq, toSeq: requested.toSeq } : {},
    { enabled: requested !== null },
  )

  const whole = wholeChain(stream.headSeq)
  const wholeTooBig = whole !== null && exceedsCap(whole)
  const recent = defaultWindow(stream.headSeq)

  const runTyped = () => {
    const r = parseRangeParams(from, to)
    if (r) setRequested(r)
  }

  return (
    <div className="flex flex-col gap-8">
      <Posture stream={stream} />
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          runTyped()
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span>From sequence</span>
          <Input aria-label="From sequence" className="w-36 font-mono text-xs" inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span>To sequence</span>
          <Input aria-label="To sequence" className="w-36 font-mono text-xs" inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button type="submit" disabled={parseRangeParams(from, to) === null}>
          Check this range
        </Button>
        <Button type="button" variant="outline" disabled={whole === null || wholeTooBig} onClick={() => whole && setRequested(whole)}>
          Check the whole chain
        </Button>
        {wholeTooBig && (
          <p className="basis-full text-sm text-muted-foreground">
            {`The whole chain is ${formatSeq(stream.headSeq)} sequences. Verification checks at most 100,000 sequences at a time, because it holds every event in the range in memory.`}
          </p>
        )}
      </form>
      {requested && verify.loading && !verify.data && <p className="text-sm text-muted-foreground">Checking the chain...</p>}
      {requested && verify.error && (
        <div className="flex flex-col gap-2">
          <CommandAlert title="The chain could not be checked" error={verify.error} />
          {verify.error.code === "BAD_REQUEST" && recent && (
            <Button type="button" variant="outline" className="self-start" onClick={() => setRequested(recent)}>
              {`Check the most recent ${formatSeq(DEFAULT_WINDOW)} instead`}
            </Button>
          )}
        </div>
      )}
      {requested && verify.data && <Certificate response={verify.data} />}
    </div>
  )
}

function Posture({ stream }: { stream: StreamSummary }) {
  const cp = stream.latestCheckpoint
  const behind = cp ? stream.headSeq - cp.toSeq : 0
  return (
    <DescriptionList
      items={[
        { term: "Chain", value: <span>{chainLabel(stream)} <span className="font-mono text-xs text-muted-foreground">{stream.id}</span></span> },
        { term: "Head", value: <span className="font-mono text-xs">{formatSeq(stream.headSeq)}</span> },
        { term: "Head hash", value: <span className="font-mono text-xs" title={stream.headHash}>{shortHash(stream.headHash)}</span> },
        {
          term: "Digest scheme",
          value: (
            <span>
              <span className="font-mono text-xs">{stream.scheme}</span>
              {stream.schemeSince > 1 ? (
                <>
                  {" from sequence "}
                  <span className="font-mono text-xs">{formatSeq(stream.schemeSince)}</span>
                </>
              ) : null}
            </span>
          ),
        },
        {
          term: "Latest checkpoint",
          value: !stream.checkpointingConfigured ? (
            <span className="text-muted-foreground">This deployment takes no checkpoints</span>
          ) : cp ? (
            <span>
              <span className="font-mono text-xs">{formatSeq(cp.toSeq)}</span>
              {behind > 0 ? `, ${formatSeq(behind)} events behind the head` : ", at the head"}
            </span>
          ) : (
            <span className="text-muted-foreground">None yet</span>
          ),
        },
        {
          term: "Best this chain can reach",
          value: <CoverageBadge level={stream.coverageCeiling} />,
        },
      ]}
    />
  )
}
```

Check that `Button`, `Input`, `CommandAlert` and `DescriptionList` exist under these module names in `packages/kit/src/components`, and correct any path that differs. `CommandAlert` takes `{ error?, title, showCode? }`. If the verify query's param object is `{}` while disabled, the Task 1 hook still sends nothing: that's the point of `enabled`.

- [ ] **Step 8: The colour guard**

```ts
// packages/plugin-chronicle/test/no-success-colour.test.ts
import { describe, expect, it } from "vitest"

const sources = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>

describe("colour", () => {
  it("uses no success colour anywhere: saturated colour means failure", () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => /\b(?:text|bg|border|fill|stroke|ring)-(?:green|emerald|lime|teal)-/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 9: Register the routes and run everything**

Add to `src/index.tsx`:
- nav `{ label: "Chain", to: "/chain", priority: 0, icon: <ShieldCheckIcon />, group: "Integrity" }`;
- routes `/` (now `ChainPage`, replacing Settings), `/chain`, `/chain/:streamId` and `/chain/:streamId/:fromSeq/:toSeq`.

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test && pnpm --filter @forge-go/dashboard-plugin-chronicle typecheck && pnpm --filter @forge-go/dashboard-plugin-chronicle lint`
Expected: PASS.

- [ ] **Step 10: Prove the tests bite**

Run each in a throwaway edit, then restore:
- (a) Drop `enabled` from the verify query. "runs nothing until asked" must fail.
- (b) Render the picker whenever `streams.length > 0`. "shows no picker to an operator with exactly one chain" must fail.
- (c) Have `NoOwnChain` always say "has not recorded any events". The app-wide test must fail.
- (d) Make `TriStateMark` render a badge for not-checked. The certificate's three-state test must fail.

- [ ] **Step 11: Commit**

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git diff --cached --stat
git commit -m "feat(plugin-chronicle): verify the chain from its own landing page"
```

---
### Task 6: Checkpoints: the list, the detail, and taking one

Checkpoints are what lift assurance above `keyed`, and templ never showed them. The list is per chain, the same chain the Chain page is about. It pages with `hasMore` because the store has no count. "This deployment stores no checkpoints" and "This chain has no checkpoints yet" are different answers.

**Files:**
- Create: `packages/plugin-chronicle/src/pages/checkpoints.tsx`, `src/pages/checkpoint-detail.tsx`
- Modify: `packages/plugin-chronicle/src/index.tsx` (nav "Checkpoints" in "Integrity", priority 10, `<MilestoneIcon />`; routes `/checkpoints`, `/checkpoints/in/:streamId`, `/checkpoint/:id`)
- Test: `packages/plugin-chronicle/test/checkpoints.test.tsx`, `test/checkpoint-detail.test.tsx`

**Interfaces:**
- Consumes: `ChainPicker`, `chainLabel` (Task 5); `CheckpointListResponse`, `CheckpointSummary`, `GetCheckpointResponse`, `TakeCheckpointResponse`, `StreamListResponse`, `MineResponse` (Task 2); `DialogError` (Task 2).
- Produces: `CheckpointsPage`, `CheckpointDetailPage`.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-chronicle/test/checkpoints.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CheckpointsPage } from "../src/pages/checkpoints"
import { renderPage, scriptedClient } from "./harness"
import type { CheckpointSummary, StreamSummary } from "../src/types"

const stream: StreamSummary = {
  id: "stream_acme", appId: "app_chronicle", tenantId: "acme", headHash: "ab", headSeq: 61004,
  scheme: "chronicle/v5", schemeSince: 48201, coverageCeiling: "signed", checkpointingConfigured: true,
}
const cp = (n: number): CheckpointSummary => ({
  id: `ckpt_acme_${n}`, fromSeq: (n - 1) * 10000 + 1, toSeq: n * 10000, eventCount: 10000,
  createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09",
})

function client(over: Record<string, unknown> = {}) {
  return scriptedClient(
    {
      "streams.mine": { stream },
      "streams.list": { streams: [stream], total: 1, hasMore: false },
      "checkpoints.list": { checkpoints: [cp(6), cp(5)], hasMore: false, supported: true },
      ...over,
    },
    { "checkpoints.take": { checkpoint: cp(7), upToDate: false } },
  )
}

describe("CheckpointsPage", () => {
  it("lists the chain's checkpoints with ids and ranges in mono and a live caption", async () => {
    renderPage(CheckpointsPage, client().client)
    await waitFor(() => expect(screen.getByText("ckpt_acme_6")).toBeTruthy())
    expect(screen.getByText("ckpt_acme_6").className).toContain("font-mono")
    expect(screen.getByText(/2 checkpoints shown/)).toBeTruthy()
  })

  it("says a deployment with no checkpoint store stores none, even when the list is null", async () => {
    renderPage(CheckpointsPage, client({ "checkpoints.list": { checkpoints: null, hasMore: false, supported: false } }).client)
    await waitFor(() => expect(screen.getByText(/This deployment stores no checkpoints/)).toBeTruthy())
    expect(screen.queryByRole("button", { name: "Take a checkpoint" })).toBeNull()
  })

  it("says a chain with none yet has none yet", async () => {
    renderPage(CheckpointsPage, client({ "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } }).client)
    await waitFor(() => expect(screen.getByText(/This chain has no checkpoints yet/)).toBeTruthy())
    expect(screen.getByText(/0 checkpoints shown/)).toBeTruthy()
  })

  it("asks for the selected chain's checkpoints", async () => {
    const c = client()
    renderPage(CheckpointsPage, c.client, { streamId: "stream_acme" })
    await waitFor(() => expect(screen.getByText("ckpt_acme_6")).toBeTruthy())
    expect(c.queried.find((q) => q.intent === "checkpoints.list")?.params).toEqual({ streamId: "stream_acme", limit: 50, offset: 0 })
  })

  it("pages forward with hasMore and no invented total", async () => {
    const c = client({ "checkpoints.list": { checkpoints: [cp(6)], hasMore: true, supported: true } })
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Next page" }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "checkpoints.list").pop()?.params).toMatchObject({ offset: 50 }))
    expect(screen.queryByText(/of \d/)).toBeNull()
  })

  it("takes a checkpoint of the chain being shown and reports it", async () => {
    const c = client()
    renderPage(CheckpointsPage, c.client, { streamId: "stream_acme" })
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    await waitFor(() => expect(screen.getByText(/Checkpoint ckpt_acme_7 signed/)).toBeTruthy())
    expect(c.sent).toEqual([{ intent: "checkpoints.take", payload: { streamId: "stream_acme" } }])
  })

  it("says the chain is already checkpointed to its head when there is nothing new", async () => {
    const c = scriptedClient(
      { "streams.mine": { stream }, "streams.list": { streams: [stream], total: 1, hasMore: false }, "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } },
      { "checkpoints.take": { upToDate: true } },
    )
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    await waitFor(() => expect(screen.getByText(/Nothing new since the last checkpoint/)).toBeTruthy())
  })

  it("shows a refused take where the operator is looking", async () => {
    const c = scriptedClient(
      { "streams.mine": { stream }, "streams.list": { streams: [stream], total: 1, hasMore: false }, "checkpoints.list": { checkpoints: [], hasMore: false, supported: true } },
      { "checkpoints.take": new ContractError("PERMISSION_DENIED", "") },
    )
    renderPage(CheckpointsPage, c.client)
    fireEvent.click(await screen.findByRole("button", { name: "Take a checkpoint" }))
    await waitFor(() => expect(within(screen.getByRole("alert")).getByText(/PERMISSION_DENIED/)).toBeTruthy())
  })
})
```

```tsx
// packages/plugin-chronicle/test/checkpoint-detail.test.tsx
import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CheckpointDetailPage } from "../src/pages/checkpoint-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"

describe("CheckpointDetailPage", () => {
  it("shows the range, the count, the key and a link to verify the range it covers", async () => {
    const c = scriptedClient({
      "checkpoints.detail": { checkpoint: { id: "ckpt_acme_6", fromSeq: 50001, toSeq: 60000, eventCount: 10000, createdAt: "2026-09-29T10:00:00Z", signKeyId: "sk_2026_09" } },
      "streams.list": { streams: [{ id: "stream_acme", appId: "app_chronicle", tenantId: "acme", headHash: "ab", headSeq: 61004, scheme: "chronicle/v5", schemeSince: 48201, coverageCeiling: "signed", checkpointingConfigured: true }], total: 1, hasMore: false },
    })
    renderPage(CheckpointDetailPage, c.client, { id: "ckpt_acme_6" })
    await waitFor(() => expect(screen.getByText("sk_2026_09")).toBeTruthy())
    expect(screen.getByText("10,000")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Verify sequences 50,001 to 60,000/ }).getAttribute("href")).toContain("/chain/")
  })

  it("answers a checkpoint that is not yours the same as one that does not exist", async () => {
    renderPage(CheckpointDetailPage, failingClient(new ContractError("NOT_FOUND", "not found")), { id: "ckpt_x" })
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy())
  })
})
```

The detail's verify link needs a stream id. `checkpoints.detail` doesn't return one, so the page reads `streams.list` and finds the chain whose range covers the checkpoint. Only one chain can own a checkpoint id, but the contract doesn't say which. So take the owned chain whose `latestCheckpoint` or head is at or past `toSeq`. If more than one qualifies, link to the Checkpoints list instead of guessing. Pin the "exactly one" case with the test above, and add a test for the ambiguous case that asserts the fallback link. Say in the task report that `checkpoints.detail` would be better returning its `streamId`, and raise it as a finding.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test -- checkpoint`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the list page**

```tsx
// packages/plugin-chronicle/src/pages/checkpoints.tsx
import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { CheckpointListResponse, CheckpointSummary, MineResponse, StreamListResponse, TakeCheckpointResponse } from "../types"
import { formatSeq } from "../format"
import { ChainPicker } from "../components/chain-picker"
import { DialogError } from "../components/dialog-error"

const PAGE = 50

const columns: Column<CheckpointSummary>[] = [
  {
    id: "id",
    header: "Checkpoint",
    cell: (c) => (
      <PluginLink to={`/checkpoint/${encodeURIComponent(c.id)}`} className="font-mono text-xs">
        {c.id}
      </PluginLink>
    ),
  },
  {
    id: "range",
    header: "Sequences",
    cell: (c) => <span className="font-mono text-xs">{`${formatSeq(c.fromSeq)} to ${formatSeq(c.toSeq)}`}</span>,
  },
  { id: "count", header: "Events", align: "end", cell: (c) => formatSeq(c.eventCount) },
  { id: "key", header: "Signing key", cell: (c) => <span className="font-mono text-xs">{c.signKeyId}</span> },
  { id: "created", header: "Signed", cell: (c) => <Timestamp value={c.createdAt} label="signing time" /> },
]

export const CheckpointsPage: ComponentType<PluginPageProps> = ({ params }) => {
  const streamId = params.streamId
  const [offset, setOffset] = useState(0)
  const mine = useQuery<MineResponse>("streams.mine", streamId ? { streamId } : {})
  const list = useQuery<StreamListResponse>("streams.list", { limit: 200 })
  const q = useQuery<CheckpointListResponse>("checkpoints.list", { ...(streamId ? { streamId } : {}), limit: PAGE, offset })
  const take = useCommand<TakeCheckpointResponse>("checkpoints.take")
  const streams = list.data?.streams ?? []
  const selected = streamId ?? mine.data?.stream?.id

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Checkpoints"
        description="Signed statements of how far the chain reached. A checkpoint proves the range it covers has not been rewritten or truncated since it was signed."
        actions={
          <div className="flex items-center gap-2">
            {streams.length > 1 && <ChainPicker streams={streams} selectedId={selected} basePath="/checkpoints/in" />}
            {q.data?.supported && (
              <Button
                disabled={take.loading}
                onClick={() => {
                  take.reset()
                  void take.execute(streamId ? { streamId } : {})
                }}
              >
                Take a checkpoint
              </Button>
            )}
          </div>
        }
      />
      {take.data?.checkpoint && (
        <p role="status" className="text-sm">
          Checkpoint <span className="font-mono text-xs">{take.data.checkpoint.id}</span>
          {` signed over sequences ${formatSeq(take.data.checkpoint.fromSeq)} to ${formatSeq(take.data.checkpoint.toSeq)}.`}
        </p>
      )}
      {take.data?.upToDate && (
        <p role="status" className="text-sm">
          Nothing new since the last checkpoint: the chain is already checkpointed to its head.
        </p>
      )}
      <DialogError what="take a checkpoint" error={take.error} />
      <QueryBoundary title="checkpoints" query={q} skeletonRows={5}>
        {(data) =>
          !data.supported ? (
            <p className="text-sm">
              This deployment stores no checkpoints. Without them, verification cannot detect events removed from the end of the chain.
            </p>
          ) : (
            <>
              <ResourceTable
                columns={columns}
                rows={data.checkpoints ?? []}
                rowKey={(c) => c.id}
                caption={`${(data.checkpoints ?? []).length} checkpoints shown`}
                emptyMessage="This chain has no checkpoints yet."
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  Previous page
                </Button>
                <Button variant="outline" disabled={!data.hasMore} onClick={() => setOffset(offset + PAGE)}>
                  Next page
                </Button>
              </div>
            </>
          )
        }
      </QueryBoundary>
    </section>
  )
}
```

The command's `invalidates` refreshes `checkpoints.list` itself. The page must not call `refetch`. `DialogError` renders `role="alert"` text of the form "Could not take a checkpoint: <message> (<code>)". An empty message still shows the code, which is what the refusal test reads.

- [ ] **Step 4: Implement the detail page**

Build it with `PageHeader` (title: the checkpoint id in mono), `QueryBoundary` over `checkpoints.detail` with `{ id: params.id }`, and a `DescriptionList`:
- sequences (mono, formatted);
- events (formatted);
- signing key (mono);
- signed (`Timestamp`).

Below the list, a `PluginLink` to `/chain/<streamId>/<fromSeq>/<toSeq>` labelled `Verify sequences <from> to <to>`, using the owning-chain rule from Step 1. Or `/checkpoints` labelled "Back to checkpoints" when the owner is ambiguous.

- [ ] **Step 5: Register, run, prove, commit**

Register the nav entry and the three routes. Run the package's test, typecheck and lint, all expected to pass.

Mutation proofs:
- (a) Read `data.checkpoints.length` without the `?? []`. The null test must fail.
- (b) Call `take.execute({})` ignoring `streamId`. The take test must fail.
- (c) Render one shared empty message for both empty states. One of the two empty-state tests must fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): list, open and take checkpoints"
```

---
### Task 7: The event log, built for finding one event

An audit log is a search problem before it's a table problem. Every filter goes to the server. The caption counts the server's `total`, not the rows on screen. The page has two empty states, never one, because "no events at all" and "no events match these filters" are different answers to someone looking for a specific record.

**Files:**
- Create: `packages/plugin-chronicle/src/pages/events.tsx`, `src/pages/user-events.tsx`, `src/components/event-columns.tsx`
- Modify: `packages/plugin-chronicle/src/index.tsx` (nav "Events" in "Log", priority 20, `<ScrollTextIcon />`; routes `/events`, `/users/:userId`)
- Test: `packages/plugin-chronicle/test/events.test.tsx`, `test/user-events.test.tsx`

**Interfaces:**
- Consumes: `EventListResponse`, `EventSummary` (Task 2); `OutcomeBadge`, `SeverityBadge`, `ErasedBadge` (Task 2); `formatSeq` (Task 2).
- Produces: `EventsPage`, `UserEventsPage`, `eventColumns(opts: { showUser: boolean }): Column<EventSummary>[]`, and `interface EventFilters { after: string; before: string; userId: string; sessionId: string; requestId: string; categories: string; actions: string; resources: string; severity: string; outcome: string }` with `activeFilters(f: EventFilters): { label: string; value: string }[]` and `toQueryParams(f: EventFilters): Record<string, unknown>`.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-chronicle/test/events.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EventsPage, toQueryParams } from "../src/pages/events"
import { renderPage, scriptedClient } from "./harness"
import type { EventSummary } from "../src/types"

const ev = (seq: number, over: Partial<EventSummary> = {}): EventSummary => ({
  id: `audit_own_${seq}`, timestamp: "2026-09-29T11:00:00Z", sequence: seq, action: "user.login", resource: "session",
  category: "auth", outcome: "success", severity: "info", userId: "user_1", ip: "10.0.0.1", erased: false, ...over,
})

function client(answer: (p: Record<string, unknown>) => unknown) {
  return scriptedClient({ "events.list": answer })
}

describe("EventsPage", () => {
  it("captions with the server's total, not the rows on screen", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(12431), ev(12430)], total: 12431, hasMore: true })).client)
    await waitFor(() => expect(screen.getByText("2 of 12,431 events")).toBeTruthy())
  })

  it("renders the action as the column an operator reads and identifiers in mono", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(12431)], total: 1, hasMore: false })).client)
    const action = await screen.findByRole("link", { name: "user.login" })
    expect(action.className).toContain("font-medium")
    expect(screen.getByText("12,431").className).toContain("font-mono")
  })

  it("marks an absent user with NoneCell, never a blank", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(1, { userId: undefined })], total: 1, hasMore: false })).client)
    await waitFor(() => expect(screen.getByLabelText("no user")).toBeTruthy())
  })

  it("says the chain holds nothing when nothing is filtered and nothing comes back", async () => {
    renderPage(EventsPage, client(() => ({ events: [], total: 0, hasMore: false })).client)
    await waitFor(() => expect(screen.getByText("This chain holds no events yet.")).toBeTruthy())
    expect(screen.getByText("0 of 0 events")).toBeTruthy()
  })

  it("says nothing matches, lists the filters, and offers to clear them", async () => {
    const c = client((p) => (p.outcome ? { events: [], total: 0, hasMore: false } : { events: [ev(1)], total: 1, hasMore: false }))
    renderPage(EventsPage, c.client)
    await screen.findByRole("link", { name: "user.login" })
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "denied" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => expect(screen.getByText("No events match these filters")).toBeTruthy())
    expect(screen.getByText(/Outcome: denied/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(screen.getByRole("link", { name: "user.login" })).toBeTruthy())
  })

  it("sends every filter to the server, split into lists where the contract takes lists", async () => {
    const c = client(() => ({ events: [], total: 0, hasMore: false }))
    renderPage(EventsPage, c.client)
    await screen.findByText("This chain holds no events yet.")
    fireEvent.change(screen.getByLabelText("Actions"), { target: { value: "user.login, role.grant" } })
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } })
    fireEvent.change(screen.getByLabelText("User"), { target: { value: "user_7" } })
    fireEvent.change(screen.getByLabelText("Session"), { target: { value: "sess_3" } })
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await waitFor(() =>
      expect(c.queried.filter((q) => q.intent === "events.list").pop()?.params).toEqual({
        actions: ["user.login", "role.grant"],
        severity: ["critical"],
        userId: "user_7",
        sessionId: "sess_3",
        limit: 50,
        offset: 0,
      }),
    )
  })

  it("turns local datetime inputs into RFC3339 and leaves empty bounds out", () => {
    expect(
      toQueryParams({ after: "2026-09-28T00:00", before: "", userId: "", sessionId: "", requestId: "", categories: "", actions: "", resources: "", severity: "", outcome: "" }),
    ).toEqual({ after: new Date("2026-09-28T00:00").toISOString() })
  })

  it("pages with the server's total", async () => {
    const c = client(() => ({ events: [ev(2)], total: 120, hasMore: true }))
    renderPage(EventsPage, c.client)
    await screen.findByText("1 of 120 events")
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(c.queried.filter((q) => q.intent === "events.list").pop()?.params).toMatchObject({ offset: 50 }))
  })

  it("shows an erased event with the Erased badge", async () => {
    renderPage(EventsPage, client(() => ({ events: [ev(1, { erased: true })], total: 1, hasMore: false })).client)
    await waitFor(() => expect(screen.getByText("Erased")).toBeTruthy())
  })
})
```

The `aria-label` assertion (`"no user"`) relies on `NoneCell label="user"` rendering `aria-label="no user"`. The conventions reference says it does. The pagination test depends on how `ResourceTable` names its next-page control: read `resource-table.tsx` and use the real accessible name.

```tsx
// packages/plugin-chronicle/test/user-events.test.tsx
import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { UserEventsPage } from "../src/pages/user-events"
import { renderPage, scriptedClient } from "./harness"

describe("UserEventsPage", () => {
  it("reads events.byUser for the user in the route and captions with its total", async () => {
    const c = scriptedClient({
      "events.byUser": {
        events: [{ id: "audit_own_7", timestamp: "2026-09-29T11:00:00Z", sequence: 7, action: "role.grant", resource: "role", category: "admin", outcome: "success", severity: "warning", userId: "user_1", erased: false }],
        total: 31,
        hasMore: true,
      },
    })
    renderPage(UserEventsPage, c.client, { userId: "user_1" })
    await waitFor(() => expect(screen.getByText("1 of 31 events")).toBeTruthy())
    expect(c.queried[0]).toEqual({ intent: "events.byUser", params: { userId: "user_1", limit: 50, offset: 0 } })
    expect(screen.getByRole("heading", { name: /user_1/ })).toBeTruthy()
  })

  it("says this user recorded nothing, rather than showing an empty table", async () => {
    renderPage(UserEventsPage, scriptedClient({ "events.byUser": { events: [], total: 0, hasMore: false } }).client, { userId: "user_9" })
    await waitFor(() => expect(screen.getByText("No events are recorded for this user.")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test -- events`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the shared columns**

```tsx
// packages/plugin-chronicle/src/components/event-columns.tsx
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { EventSummary } from "../types"
import { ErasedBadge, OutcomeBadge, SeverityBadge } from "../badges"
import { formatSeq } from "../format"

/**
 * The events table's columns. There is deliberately no integrity column: a
 * column whose every cell says the same word is redundant, and integrity is a
 * property of the chain, not of a row. The Chain page states it once.
 */
export function eventColumns({ showUser }: { showUser: boolean }): Column<EventSummary>[] {
  const cols: Column<EventSummary>[] = [
    { id: "time", header: "Time", cell: (e) => <Timestamp value={e.timestamp} label="time" /> },
    {
      id: "action",
      header: "Action",
      cell: (e) => (
        <PluginLink to={`/events/${encodeURIComponent(e.id)}`} className="font-medium">
          {e.action}
        </PluginLink>
      ),
    },
    {
      id: "resource",
      header: "Resource",
      cell: (e) => (
        <span>
          {e.resource}
          {e.resourceId ? <span className="ml-1 font-mono text-xs text-muted-foreground">{e.resourceId}</span> : null}
        </span>
      ),
    },
    { id: "category", header: "Category", cell: (e) => e.category },
    { id: "outcome", header: "Outcome", cell: (e) => <OutcomeBadge outcome={e.outcome} /> },
    { id: "severity", header: "Severity", cell: (e) => <SeverityBadge severity={e.severity} /> },
  ]
  if (showUser) {
    cols.push({
      id: "user",
      header: "User",
      cell: (e) =>
        e.userId ? (
          <PluginLink to={`/users/${encodeURIComponent(e.userId)}`} className="font-mono text-xs">
            {e.userId}
          </PluginLink>
        ) : (
          <NoneCell label="user" />
        ),
    })
  }
  cols.push(
    { id: "seq", header: "Sequence", align: "end", cell: (e) => <span className="font-mono text-xs">{formatSeq(e.sequence)}</span> },
    { id: "erased", header: "", cell: (e) => (e.erased ? <ErasedBadge /> : null) },
  )
  return cols
}
```

- [ ] **Step 4: Implement the events page**

```tsx
// packages/plugin-chronicle/src/pages/events.tsx
import { useState, type ComponentType } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventListResponse } from "../types"
import { eventColumns } from "../components/event-columns"
import { formatSeq } from "../format"

const PAGE = 50

export interface EventFilters {
  after: string
  before: string
  userId: string
  sessionId: string
  requestId: string
  categories: string
  actions: string
  resources: string
  severity: string
  outcome: string
}

const EMPTY: EventFilters = {
  after: "", before: "", userId: "", sessionId: "", requestId: "",
  categories: "", actions: "", resources: "", severity: "", outcome: "",
}

const LABELS: Record<keyof EventFilters, string> = {
  after: "After", before: "Before", userId: "User", sessionId: "Session", requestId: "Request",
  categories: "Categories", actions: "Actions", resources: "Resources", severity: "Severity", outcome: "Outcome",
}

const LIST_FIELDS = ["categories", "actions", "resources", "severity", "outcome"] as const
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)

/** The filters as the contract takes them: lists for the multi-value fields, RFC3339 times. */
export function toQueryParams(f: EventFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.after) out.after = new Date(f.after).toISOString()
  if (f.before) out.before = new Date(f.before).toISOString()
  for (const k of ["userId", "sessionId", "requestId"] as const) if (f[k].trim()) out[k] = f[k].trim()
  for (const k of LIST_FIELDS) if (list(f[k]).length) out[k] = list(f[k])
  return out
}

export function activeFilters(f: EventFilters): { label: string; value: string }[] {
  return (Object.keys(LABELS) as (keyof EventFilters)[]).filter((k) => f[k].trim()).map((k) => ({ label: LABELS[k], value: f[k].trim() }))
}

export const EventsPage: ComponentType<PluginPageProps> = () => {
  const [draft, setDraft] = useState<EventFilters>(EMPTY)
  const [applied, setApplied] = useState<EventFilters>(EMPTY)
  const [offset, setOffset] = useState(0)
  const q = useQuery<EventListResponse>("events.list", { ...toQueryParams(applied), limit: PAGE, offset })
  const active = activeFilters(applied)

  const field = (k: keyof EventFilters, type = "text", placeholder = "") => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{LABELS[k]}</span>
      <Input aria-label={LABELS[k]} type={type} placeholder={placeholder} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </label>
  )
  const select = (k: "outcome" | "severity", options: string[]) => (
    <label className="flex flex-col gap-1 text-sm">
      <span>{LABELS[k]}</span>
      <select aria-label={LABELS[k]} className="h-9 rounded-md border bg-background px-2 text-sm" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Events" description="Every event in your scope's audit trail. Filters run on the server, so a search covers the whole log, not the page on screen." />
      <form
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault()
          setApplied(draft)
          setOffset(0)
        }}
      >
        {field("actions", "text", "user.login, role.grant")}
        {field("resources", "text", "patient_record")}
        {field("categories", "text", "auth, data")}
        {select("outcome", ["success", "failure", "denied"])}
        {select("severity", ["info", "warning", "critical"])}
        {field("userId")}
        {field("sessionId")}
        {field("requestId")}
        {field("after", "datetime-local")}
        {field("before", "datetime-local")}
        <div className="col-span-2 flex items-end gap-2 md:col-span-2">
          <Button type="submit">Apply filters</Button>
          {active.length > 0 && (
            <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setOffset(0) }}>
              Clear filters
            </Button>
          )}
        </div>
      </form>
      <QueryBoundary title="events" query={q} skeletonRows={10}>
        {(data) => (
          <ResourceTable
            columns={eventColumns({ showUser: true })}
            rows={data.events}
            rowKey={(e) => e.id}
            caption={`${formatSeq(data.events.length)} of ${formatSeq(data.total)} events`}
            emptyMessage={active.length ? "No events match these filters" : "This chain holds no events yet."}
            emptyAction={
              active.length ? (
                <div className="flex flex-col items-center gap-2 text-sm">
                  <p>{active.map((f) => `${f.label}: ${f.value}`).join("; ")}</p>
                  <Button type="button" variant="outline" onClick={() => { setDraft(EMPTY); setApplied(EMPTY); setOffset(0) }}>
                    Clear filters
                  </Button>
                </div>
              ) : undefined
            }
            pagination={{ page: offset / PAGE + 1, pageSize: PAGE, total: data.total }}
            onPageChange={(page) => setOffset((page - 1) * PAGE)}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

With filters active and no rows, two "Clear filters" buttons render: one in the form, one in the empty state. The test clicks with `getByRole`, which throws on two matches. So render the form's button only while rows exist, or name them differently: the empty state's "Clear filters" and the form's "Reset filters". Pick one and keep the test in step.

When `ResourceTable` has zero rows it renders `EmptyState(title=emptyMessage, description=caption, action=emptyAction)`, so the "0 of 0 events" caption still shows. That's the "live count including at zero" convention.

- [ ] **Step 5: Implement the user page**

`UserEventsPage` reads `events.byUser` with `{ userId: params.userId, limit: 50, offset }`, titled `Events by <userId in mono>` in a `PageHeader` whose title is a heading containing the id. It uses `eventColumns({ showUser: false })`, captions `"<n> of <total> events"`, and has the empty message "No events are recorded for this user." It pages like the events page. It has no filters: the contract's `events.byUser` takes only a time range, and a user page is reached by clicking a user id, not by searching.

- [ ] **Step 6: Register, run, prove, commit**

Register the nav entry and the routes, then run the package's test, typecheck and lint. Mutation proofs:
- (a) Caption with `data.events.length` for both numbers. The total test must fail.
- (b) Filter in the browser: send no `actions` param, and filter `data.events` locally. The "every filter to the server" test must fail.
- (c) Use one empty message. One of the two empty-state tests must fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): search the event log on the server, with both empty states"
```

---
### Task 8: Event detail, the "prove this record" page

Where an auditor arrives: one event, its place in the chain, its own digest check, and a link to check the chain around it. It loads lazily, because CodeMirror is its weight.

**Files:**
- Create:
  - `packages/plugin-chronicle/src/pages/event-detail.tsx` (default export plus named `EventDetailPage`)
  - `src/components/json-view.tsx`, `src/components/json-editor.tsx` (copied from plugin-relay)
  - `packages/plugin-chronicle/test/setup.ts` (copied from plugin-relay)
- Modify:
  - `packages/plugin-chronicle/package.json`: add Relay's six `@codemirror/*` dependencies at Relay's versions: `commands ^6.11.1`, `lang-json ^6.0.2`, `language ^6.12.4`, `search ^6.7.2`, `state ^6.7.6`, `view ^6.43.13`
  - `vitest.config.ts`: `setupFiles: ["../test-support/jsdom-setup.ts", "./test/setup.ts"]`
  - `src/index.tsx`: route `/events/:id` via `lazy()`
- Test: `packages/plugin-chronicle/test/event-detail.test.tsx`, `test/lazy-route.test.ts`

**Interfaces:**
- Consumes:
  - `EventDetail`, `VerifyEventResponse`, `MineResponse` (Task 2);
  - `aroundSeq` (Task 4);
  - `ErasedBadge`, `OutcomeBadge`, `SeverityBadge` (Task 2);
  - `useQuery(..., { enabled })` (Task 1).
- Produces: `EventDetailPage`, and `default` from `src/pages/event-detail.tsx`.

- [ ] **Step 1: Copy the viewer and its test mock**

Copy these files from `packages/plugin-relay` to the same paths under `packages/plugin-chronicle`:
- `src/components/json-view.tsx`
- `src/components/json-editor.tsx`
- `test/setup.ts`

The mock path in `setup.ts` (`../src/components/json-editor`) stays valid. Add the dependencies, run `pnpm install --filter @forge-go/dashboard-plugin-chronicle...`, and stage only your own `pnpm-lock.yaml` hunks.

- [ ] **Step 2: Write the failing tests**

```tsx
// packages/plugin-chronicle/test/event-detail.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { EventDetailPage } from "../src/pages/event-detail"
import { failingClient, renderPage, scriptedClient } from "./harness"
import type { EventDetail } from "../src/types"

const detail = (over: Partial<EventDetail> = {}): EventDetail => ({
  id: "audit_globex_2780", timestamp: "2026-09-29T11:00:00Z", sequence: 2780, action: "record.update",
  resource: "patient_record", resourceId: "pr_88", category: "data", outcome: "success", severity: "info",
  userId: "user_3", ip: "10.0.0.30", erased: false, streamId: "stream_globex",
  hash: "aa".repeat(32), prevHash: "bb".repeat(32), hashScheme: "chronicle/v5", hashKeyId: "hk_1",
  reason: "chart correction", subjectId: "subject_1", requestId: "req_2780", sessionId: "sess_8",
  metadata: { requestPath: "/api/records/pr_88", fields: ["dob"] },
  ...over,
})

function client(ev: EventDetail, verify: unknown = { valid: true, hashScheme: "chronicle/v5", keyed: true }) {
  return scriptedClient({
    "events.detail": ev,
    "streams.mine": { stream: { id: "stream_globex", appId: "app_chronicle", tenantId: "globex", headHash: "cc", headSeq: 5000, scheme: "chronicle/v5", schemeSince: 1, coverageCeiling: "signed", checkpointingConfigured: true } },
    "verify.event": verify,
  })
}

describe("EventDetailPage", () => {
  it("shows the event's place in the chain with hashes in mono", async () => {
    renderPage(EventDetailPage, client(detail()).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByText("2,780")).toBeTruthy())
    expect(screen.getByText("aa".repeat(32)).className).toContain("font-mono")
    expect(screen.getByText("bb".repeat(32)).className).toContain("font-mono")
    expect(screen.getByText("chronicle/v5")).toBeTruthy()
  })

  it("shows the metadata payload, searchable", async () => {
    renderPage(EventDetailPage, client(detail()).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByLabelText("metadata").textContent).toContain("/api/records/pr_88"))
  })

  it("does not check the event's digest until asked", async () => {
    const c = client(detail())
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    await screen.findByText("2,780")
    expect(c.queried.some((q) => q.intent === "verify.event")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/recomputes under a keyed scheme/)).toBeTruthy())
    expect(screen.getByText(/checks the event's own digest, not its place in the chain/)).toBeTruthy()
  })

  it("says an unkeyed valid digest does not rule out a rewrite", async () => {
    const c = client(detail({ hashScheme: "chronicle/v4" }), { valid: true, hashScheme: "chronicle/v4", keyed: false })
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/does not rule out a rewrite/)).toBeTruthy())
    expect(screen.queryByText(/secure|protected|tamper-proof/i)).toBeNull()
  })

  it("says a failed digest could be edited content or a downgrade, and points to the chain check", async () => {
    const c = client(detail(), { valid: false, hashScheme: "chronicle/v5", keyed: true })
    renderPage(EventDetailPage, c.client, { id: "audit_globex_2780" })
    fireEvent.click(await screen.findByRole("button", { name: "Check this event's digest" }))
    await waitFor(() => expect(screen.getByText(/does not recompute/)).toBeTruthy())
    expect(screen.getByText(/check the chain around it to tell which/i)).toBeTruthy()
  })

  it("links to a bounded chain check around the event, clamped to the head", async () => {
    renderPage(EventDetailPage, client(detail({ sequence: 4990 })).client, { id: "audit_globex_4990" })
    const link = await screen.findByRole("link", { name: "Check the chain around this event" })
    expect(link.getAttribute("href")).toContain("/chain/stream_globex/4940/5000")
  })

  it("marks a real erasure with its badge and a link to the erasure", async () => {
    renderPage(
      EventDetailPage,
      client(detail({ erased: true, erasureId: "erasure_1", erasedAt: "2026-09-29T09:00:00Z", reason: "[ERASED]" })).client,
      { id: "audit_globex_2780" },
    )
    await waitFor(() => expect(screen.getByText("Erased")).toBeTruthy())
    expect(screen.getByRole("link", { name: "erasure_1" }).getAttribute("href")).toContain("/erasures/erasure_1")
  })

  it("never presents the [ERASED] text without an erasure record as an erasure requested here", async () => {
    renderPage(EventDetailPage, client(detail({ reason: "[ERASED]" })).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByText(/no erasure in this scope is recorded for it/)).toBeTruthy())
    expect(screen.queryByText("Erased")).toBeNull()
  })

  it("shows NoneCell for absent optional fields", async () => {
    renderPage(EventDetailPage, client(detail({ userId: undefined, ip: undefined, reason: undefined })).client, { id: "audit_globex_2780" })
    await waitFor(() => expect(screen.getByLabelText("no user")).toBeTruthy())
    expect(screen.getByLabelText("no IP address")).toBeTruthy()
    expect(screen.getByLabelText("no reason")).toBeTruthy()
  })

  it("answers an event outside the scope as not found", async () => {
    renderPage(EventDetailPage, failingClient(new ContractError("NOT_FOUND", "not found")), { id: "audit_x" })
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy())
  })
})
```

```ts
// packages/plugin-chronicle/test/lazy-route.test.ts
import { describe, expect, it } from "vitest"

const index = import.meta.glob("../src/index.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>
const sources = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>

describe("the event detail chunk", () => {
  it("is imported lazily by the plugin", () => {
    const text = Object.values(index)[0]
    expect(text).toMatch(/lazy\(\(\) => import\("\.\/pages\/event-detail"\)\)/)
    expect(text).not.toMatch(/from "\.\/pages\/event-detail"/)
  })
  it("is the only way CodeMirror enters the plugin", () => {
    const eager = Object.entries(sources).filter(
      ([path, text]) => /@codemirror\//.test(text) && !path.endsWith("components/json-editor.tsx"),
    )
    expect(eager.map(([p]) => p)).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-chronicle test -- event-detail lazy-route`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement the page**

```tsx
// packages/plugin-chronicle/src/pages/event-detail.tsx
import { useState, type ComponentType, type ReactNode } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/description-list"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CommandAlert } from "@forge-go/dashboard-kit/components/command-alert"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { EventDetail, MineResponse, VerifyEventResponse } from "../types"
import { ErasedBadge, OutcomeBadge, SeverityBadge } from "../badges"
import { formatSeq } from "../format"
import { JsonView } from "../components/json-view"
import { aroundSeq } from "../verification/window"

const ERASED = "[ERASED]"

/**
 * A value that reads "[ERASED]" proves an erasure only when the event says it
 * was erased and names the erasure. The literal text is not reserved: an app
 * can record it, and a key shared across scopes before chronicle scoped its
 * keys could leave it on an event with no erasure recorded here.
 */
function field(value: string | undefined, label: string, ev: EventDetail, mono = false): ReactNode {
  if (value === undefined || value === "") return <NoneCell label={label} />
  if (value === ERASED && !(ev.erased && ev.erasureId)) {
    return (
      <span>
        <span className="font-mono text-xs">{ERASED}</span>
        <span className="ml-2 text-muted-foreground">This value reads as erased, but no erasure in this scope is recorded for it.</span>
      </span>
    )
  }
  return mono ? <span className="font-mono text-xs">{value}</span> : value
}

export const EventDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const q = useQuery<EventDetail>("events.detail", { id })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Event" description={<span className="font-mono text-xs">{id}</span>} />
      <QueryBoundary title="event" query={q} skeletonRows={8}>
        {(ev) => <Body ev={ev} />}
      </QueryBoundary>
    </section>
  )
}

function Body({ ev }: { ev: EventDetail }) {
  const [checking, setChecking] = useState(false)
  const verify = useQuery<VerifyEventResponse>("verify.event", { eventId: ev.id }, { enabled: checking })
  const chain = useQuery<MineResponse>("streams.mine", { streamId: ev.streamId })
  const head = chain.data?.stream?.headSeq
  const around = head !== undefined ? aroundSeq(ev.sequence, head) : null

  return (
    <DetailLayout
      main={
        <div className="flex flex-col gap-6">
          <DescriptionList
            items={[
              { term: "Action", value: <span className="font-medium">{ev.action}</span> },
              { term: "Resource", value: <span>{ev.resource} {field(ev.resourceId, "resource id", ev, true)}</span> },
              { term: "Category", value: ev.category },
              { term: "Outcome", value: <OutcomeBadge outcome={ev.outcome} /> },
              { term: "Severity", value: <SeverityBadge severity={ev.severity} /> },
              { term: "Time", value: <Timestamp value={ev.timestamp} label="time" /> },
              { term: "User", value: ev.userId ? <PluginLink to={`/users/${encodeURIComponent(ev.userId)}`} className="font-mono text-xs">{ev.userId}</PluginLink> : <NoneCell label="user" /> },
              { term: "Subject", value: field(ev.subjectId, "subject", ev, true) },
              { term: "IP address", value: field(ev.ip, "IP address", ev, true) },
              { term: "User agent", value: field(ev.userAgent, "user agent", ev) },
              { term: "Reason", value: field(ev.reason, "reason", ev) },
              { term: "Request", value: field(ev.requestId, "request id", ev, true) },
              { term: "Session", value: field(ev.sessionId, "session id", ev, true) },
            ]}
          />
          <div>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Metadata</h2>
            <JsonView value={ev.metadata} label="metadata" />
          </div>
        </div>
      }
      aside={
        <div className="flex flex-col gap-4 text-sm">
          {ev.erased && ev.erasureId ? (
            <div className="flex flex-col gap-1">
              <ErasedBadge />
              <span>
                {"Erased by "}
                <PluginLink to={`/erasures/${encodeURIComponent(ev.erasureId)}`} className="font-mono text-xs">{ev.erasureId}</PluginLink>
              </span>
              <Timestamp value={ev.erasedAt} label="erasure time" />
            </div>
          ) : null}
          <DescriptionList
            items={[
              { term: "Sequence", value: <span className="font-mono text-xs">{formatSeq(ev.sequence)}</span> },
              { term: "Hash", value: <span className="font-mono text-xs break-all">{ev.hash}</span> },
              { term: "Previous hash", value: <span className="font-mono text-xs break-all">{ev.prevHash}</span> },
              { term: "Digest scheme", value: field(ev.hashScheme, "digest scheme", ev, true) },
              { term: "Key id", value: field(ev.hashKeyId, "key id", ev, true) },
              { term: "Chain", value: <span className="font-mono text-xs">{ev.streamId}</span> },
            ]}
          />
          <Button variant="outline" onClick={() => setChecking(true)} disabled={checking && verify.loading}>
            Check this event's digest
          </Button>
          {verify.error && <CommandAlert title="The digest could not be checked" error={verify.error} />}
          {verify.data && <DigestResult r={verify.data} />}
          {around && (
            <PluginLink to={`/chain/${encodeURIComponent(ev.streamId)}/${around.fromSeq}/${around.toSeq}`}>
              Check the chain around this event
            </PluginLink>
          )}
        </div>
      }
    />
  )
}

/**
 * verify.event checks one event's digest against its own claimed predecessor,
 * never its link to the event before it. What `valid` can and cannot say is
 * stated with the answer, every time.
 */
function DigestResult({ r }: { r: VerifyEventResponse }) {
  const scope = "This checks the event's own digest, not its place in the chain."
  if (!r.valid) {
    return (
      <p className="text-destructive">
        This event's digest does not recompute: its content was changed, or it claims a weaker scheme than the chain required.
        Check the chain around it to tell which. <span className="text-foreground">{scope}</span>
      </p>
    )
  }
  if (!r.keyed) {
    return (
      <p>
        This event's digest recomputes. It is unkeyed, so it does not rule out a rewrite by someone who can write the database. {scope}
      </p>
    )
  }
  return <p>This event's digest recomputes under a keyed scheme. {scope}</p>
}

export default EventDetailPage
```

`PageHeader`'s `description` may be typed `string`. If so, pass the id as a plain string and render the mono id in the body instead. The lazy chunk must not pull the kit's chart module or anything else heavy.

- [ ] **Step 5: Register lazily**

```tsx
// in src/index.tsx
import { lazy } from "react"
const EventDetailPage = lazy(() => import("./pages/event-detail"))
// routes:
{ path: "/events/:id", element: EventDetailPage },
```

`PluginHost` wraps pages in Suspense, per PLAYBOOK "Reach for a library, but load it lazily".

- [ ] **Step 6: Run, prove, commit**

Run the package's test, typecheck and lint. Mutation proofs:
- (a) Drop `enabled` on `verify.event`. "does not check the event's digest until asked" must fail.
- (b) Treat any `"[ERASED]"` as an erasure. The literal test must fail.
- (c) Import the page statically in `index.tsx`. The lazy-route test must fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test packages/plugin-chronicle/package.json packages/plugin-chronicle/vitest.config.ts
# plus your own pnpm-lock.yaml hunks only
git commit -m "feat(plugin-chronicle): open one event, check its digest, and check the chain around it"
```

---

### Task 9: Activity: the overview counts and the charts

Form first, colour last. The four counts are stat tiles, since a magnitude with no comparison is a stat, not a chart. Breakdowns are single-series horizontal bars in one ink, sorted by count and labelled directly. Volume over time is bars, never a line. A line interpolates across an empty bucket and erases the finding the chart exists for, and an empty bucket is named in words as well.

**Invoke the `dataviz` skill before writing any chart code.** Then read `packages/kit/src/components/chart.tsx` (`ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig`). This plugin is the first to use it. Use recharts only through the kit's module, never a second charting library, and use only the kit's colour tokens (`var(--foreground)`, `var(--muted-foreground)`, `var(--border)`), with no categorical palette.

**Files:**
- Create: `packages/plugin-chronicle/src/pages/activity.tsx`, `src/charts/series.ts`, `src/charts/bars.tsx`
- Modify: `packages/plugin-chronicle/src/index.tsx` (nav "Activity" in "Log", priority 30, `<ChartColumnIcon />`; route `/activity`)
- Test: `packages/plugin-chronicle/test/series.test.ts`, `test/activity.test.tsx`

**Interfaces:**
- Consumes: `OverviewStats`, `AggregateResponse`, `AggregateGroup` (Task 2).
- Produces:
  - `type BucketUnit = "day" | "hour"`
  - `bucketSeries(groups: AggregateGroup[], from: Date, to: Date, unit: BucketUnit): { bucket: string; count: number | null }[]`: every bucket in the range, with `count: null` where the server returned no group
  - `emptyBuckets(series): string[]`
  - `breakdown(groups: AggregateGroup[], key: "category" | "severity" | "outcome"): { label: string; count: number }[]`: sorted by count, descending
  - `ActivityPage`

- [ ] **Step 1: Write the failing series tests**

```ts
// packages/plugin-chronicle/test/series.test.ts
import { describe, expect, it } from "vitest"
import { breakdown, bucketSeries, emptyBuckets } from "../src/charts/series"

describe("bucketSeries", () => {
  it("lists every hour in the range and keeps an empty hour empty, not zero", () => {
    const s = bucketSeries(
      [
        { bucket: "2026-09-28T02:00:00Z", count: 4 },
        { bucket: "2026-09-28T04:00:00Z", count: 2 },
      ],
      new Date("2026-09-28T02:00:00Z"),
      new Date("2026-09-28T04:59:59Z"),
      "hour",
    )
    expect(s).toEqual([
      { bucket: "2026-09-28T02:00:00Z", count: 4 },
      { bucket: "2026-09-28T03:00:00Z", count: null },
      { bucket: "2026-09-28T04:00:00Z", count: 2 },
    ])
    expect(emptyBuckets(s)).toEqual(["2026-09-28T03:00:00Z"])
  })

  it("buckets days in UTC with the server's format", () => {
    const s = bucketSeries([{ bucket: "2026-09-27", count: 9 }], new Date("2026-09-27T00:00:00Z"), new Date("2026-09-28T23:00:00Z"), "day")
    expect(s.map((x) => x.bucket)).toEqual(["2026-09-27", "2026-09-28"])
    expect(s[1].count).toBeNull()
  })

  it("orders by time whatever order the server returned", () => {
    const s = bucketSeries(
      [
        { bucket: "2026-09-28T01:00:00Z", count: 1 },
        { bucket: "2026-09-28T00:00:00Z", count: 5 },
      ],
      new Date("2026-09-28T00:00:00Z"),
      new Date("2026-09-28T01:00:00Z"),
      "hour",
    )
    expect(s.map((x) => x.count)).toEqual([5, 1])
  })
})

describe("breakdown", () => {
  it("sorts by count descending and names an absent key", () => {
    expect(
      breakdown(
        [
          { category: "auth", count: 3 },
          { category: "data", count: 9 },
          { count: 1 },
        ],
        "category",
      ),
    ).toEqual([
      { label: "data", count: 9 },
      { label: "auth", count: 3 },
      { label: "(none)", count: 1 },
    ])
  })
})
```

- [ ] **Step 2: Implement `series.ts`**

```ts
// packages/plugin-chronicle/src/charts/series.ts
import type { AggregateGroup } from "../types"

export type BucketUnit = "day" | "hour"

function bucketKey(d: Date, unit: BucketUnit): string {
  const iso = d.toISOString()
  return unit === "day" ? iso.slice(0, 10) : `${iso.slice(0, 13)}:00:00Z`
}

function floor(d: Date, unit: BucketUnit): Date {
  const x = new Date(d)
  x.setUTCMinutes(0, 0, 0)
  if (unit === "day") x.setUTCHours(0)
  return x
}

/**
 * Every bucket between `from` and `to`, with the server's count where it
 * returned a group and null where it did not. The server returns no group for
 * a period nothing was recorded in; a gap is itself an audit finding, so it
 * stays null here, never zero.
 */
export function bucketSeries(groups: AggregateGroup[], from: Date, to: Date, unit: BucketUnit): { bucket: string; count: number | null }[] {
  const counts = new Map(groups.filter((g) => g.bucket).map((g) => [g.bucket as string, g.count]))
  const out: { bucket: string; count: number | null }[] = []
  const step = unit === "day" ? 86_400_000 : 3_600_000
  for (let t = floor(from, unit).getTime(); t <= to.getTime(); t += step) {
    const key = bucketKey(new Date(t), unit)
    out.push({ bucket: key, count: counts.get(key) ?? null })
  }
  return out
}

export function emptyBuckets(series: { bucket: string; count: number | null }[]): string[] {
  return series.filter((s) => s.count === null).map((s) => s.bucket)
}

export function breakdown(groups: AggregateGroup[], key: "category" | "severity" | "outcome"): { label: string; count: number }[] {
  return groups.map((g) => ({ label: g[key] ?? "(none)", count: g.count })).sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 3: Write the failing page tests**

```tsx
// packages/plugin-chronicle/test/activity.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ActivityPage } from "../src/pages/activity"
import { renderPage, scriptedClient } from "./harness"

const stats = {
  totalEvents: 12431, criticalEvents: 21, failedEvents: 40, deniedEvents: 12, erasureCount: 2,
  categories: [{ category: "auth", count: 5000 }, { category: "data", count: 7431 }],
  severities: [{ severity: "info", count: 12000 }], outcomes: [{ outcome: "success", count: 12379 }],
}

function client() {
  return scriptedClient({
    "overview.stats": stats,
    "events.aggregate": (p) =>
      (p.groupBy as string[])[0] === "hour"
        ? { groups: [{ bucket: "2026-09-28T02:00:00Z", count: 4 }, { bucket: "2026-09-28T04:00:00Z", count: 2 }], total: 6 }
        : { groups: [{ bucket: "2026-09-28", count: 6 }], total: 6 },
  })
}

describe("ActivityPage", () => {
  it("shows the four counts as stat tiles, with failed and denied summed and labelled", async () => {
    renderPage(ActivityPage, client().client)
    await waitFor(() => expect(screen.getByText("12,431")).toBeTruthy())
    expect(screen.getByText("Failed or denied")).toBeTruthy()
    expect(screen.getByText("52")).toBeTruthy()
    expect(screen.getByText("40 failed, 12 denied")).toBeTruthy()
  })

  it("asks for volume by day over the last 30 days by default", async () => {
    const c = client()
    renderPage(ActivityPage, c.client)
    await waitFor(() => expect(c.queried.some((q) => q.intent === "events.aggregate")).toBe(true))
    const p = c.queried.find((q) => q.intent === "events.aggregate")!.params
    expect(p.groupBy).toEqual(["day"])
    expect(typeof p.after).toBe("string")
  })

  it("names the hours in which nothing was recorded", async () => {
    const c = client()
    renderPage(ActivityPage, c.client, {})
    fireEvent.click(await screen.findByRole("button", { name: "By hour" }))
    await waitFor(() => expect(screen.getByText(/Nothing was recorded in/)).toBeTruthy())
    expect(screen.getByText(/03:00/)).toBeTruthy()
  })
})
```

The hour view's range must include 2026-09-28T03:00Z for the last test to see the empty hour. Have the page take its "now" from a `now` prop that defaults to `new Date()`, and have the test render `<ActivityPage params={{}} now={new Date("2026-09-28T05:00:00Z")} />` directly inside a `PluginProvider`, or add a `renderPage` variant that passes extra props. The hour view covers the last 48 hours of `now`.

- [ ] **Step 4: Implement the page and the bar components**

`src/charts/bars.tsx` exports two components, both built with the kit's `ChartContainer` and recharts `BarChart`, `Bar`, `XAxis`, `YAxis`, `LabelList` and `CartesianGrid` (horizontal lines only, `var(--border)`):

- **`HorizontalBars({ data, label })`**
  - `layout="vertical"`, one `Bar` filled `var(--foreground)`;
  - the category axis shows the labels, and `LabelList` prints the counts at the bar ends;
  - no legend and no tooltip needed;
  - the `aria-label` is `"<label>: <label1> <count1>, ..."` so the numbers are readable without the picture.
- **`VolumeBars({ series })`**
  - one `Bar` filled `var(--foreground)`;
  - `null` counts are drawn as nothing, not as zero;
  - x-axis ticks are the bucket, formatted `d MMM` for days and `HH:mm` for hours, in UTC;
  - a tooltip gives the exact count, or "Nothing recorded".

`ActivityPage`:
- A `PageHeader` titled "Activity".
- A `StatGrid` with:
  - Total events;
  - Critical;
  - "Failed or denied", with value `failedEvents + deniedEvents` and hint `"<failed> failed, <denied> denied"`;
  - Erasures.
- Three `HorizontalBars` from `breakdown(stats.categories | severities | outcomes, ...)`, headed "By category", "By severity" and "By outcome".
- A volume section:
  - two toggle buttons, "By day" (default: the last 30 days) and "By hour" (the last 48 hours);
  - `useQuery("events.aggregate", { groupBy: [unit], after: from.toISOString() })`;
  - `VolumeBars` over `bucketSeries(...)`;
  - beneath it, when `emptyBuckets` isn't empty, the sentence `Nothing was recorded in <n> of these <hours|days>: <list>`, with the list formatted like the ticks. That sentence is the finding, so it must not be hidden behind hover.

Each chart sits in its own `QueryBoundary`. An aggregate with `total: 0` renders "No events in this period.", not an empty plot.

- [ ] **Step 5: Run, prove, commit**

Run the package's test, typecheck and lint. Mutation proofs:
- (a) Make `bucketSeries` return `0` for missing buckets. The series test and the "Nothing was recorded" test must fail.
- (b) Sum only `failedEvents` in the tile. The stat test must fail.

Charts are checked visually in Task 13, in the shell against the fixture, whose hour at 03:00 on 2026-09-28 is empty on purpose.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): show activity as counts and bars, and name the empty hours"
```

---
### Task 10: Erasures: the record, and the request with its preview

An erasure destroys a subject's encryption key, and with it every sealed field of their events in your scope. The request dialog runs its preview when it opens, before the confirm button does anything. A result that kept a legacy key says so plainly: it isn't a failure, and it isn't yet cryptographic.

**Files:**
- Create: `packages/plugin-chronicle/src/pages/erasures.tsx`, `src/pages/erasure-detail.tsx`, `src/components/erasure-request-dialog.tsx`
- Modify:
  - `packages/plugin-chronicle/src/badges.tsx`: add `KeyBadge`, with its reason in the mapping comment
  - `src/index.tsx`: nav "Erasures" in "Compliance", priority 50, `<EraserIcon />`; routes `/erasures`, `/erasures/:id`
- Test:
  - `packages/plugin-chronicle/test/erasures.test.tsx`
  - `test/erasure-request.test.tsx`
  - `test/erasure-detail.test.tsx`

**Interfaces:**
- Consumes: `ErasureListResponse`, `ErasureSummary`, `ErasurePreviewResponse`, `ErasureResult`, `LIMITS` (Task 2); `DialogError` (Task 2); `useQuery(..., { enabled })` (Task 1).
- Produces:
  - `ErasuresPage` and `ErasureDetailPage`
  - `ErasureRequestDialog(props: { open: boolean; onOpenChange(open: boolean): void })`
  - `KeyBadge({ destroyed }: { destroyed: boolean })`: destroyed is `outline` "Key destroyed", kept is `secondary` "Key kept". Most erasures destroy the key, so that state recedes. A kept key is notable but not wrong.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-chronicle/test/erasure-request.test.tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ErasureRequestDialog } from "../src/components/erasure-request-dialog"
import { scriptedClient } from "./harness"

function renderDialog(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <ErasureRequestDialog open onOpenChange={() => {}} />
    </PluginProvider>,
  )
}

function fill(subject: string, reason: string) {
  fireEvent.change(screen.getByLabelText("Subject ID"), { target: { value: subject } })
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } })
}

describe("ErasureRequestDialog", () => {
  it("counts the subject's events before the confirm button does anything", async () => {
    const c = scriptedClient(
      { "erasures.preview": (p) => ({ subjectId: p.subjectId, eventsAffected: 14 }) },
      { "erasures.request": { id: "erasure_3", subjectId: "subject_1", eventsAffected: 14, keyDestroyed: true, legacyKeyRetained: false } },
    )
    renderDialog(c.client)
    fill("subject_1", "GDPR Article 17 request 5520")
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await waitFor(() => expect(screen.getByText(/14 events in your scope/)).toBeTruthy())
    expect(c.sent).toEqual([])
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(c.sent).toEqual([{ intent: "erasures.request", payload: { subjectId: "subject_1", reason: "GDPR Article 17 request 5520" } }]))
  })

  it("asks for a fresh count when the subject changes after counting", async () => {
    const c = scriptedClient({ "erasures.preview": (p) => ({ subjectId: p.subjectId, eventsAffected: 3 }) })
    renderDialog(c.client)
    fill("subject_1", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/3 events in your scope/)
    fireEvent.change(screen.getByLabelText("Subject ID"), { target: { value: "subject_2" } })
    expect(screen.getByRole("button", { name: "Erase" }).hasAttribute("disabled")).toBe(true)
  })

  it("says plainly when the key was kept because another scope still uses it", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "legacy-user", eventsAffected: 3 } },
      { "erasures.request": { id: "erasure_4", subjectId: "legacy-user", eventsAffected: 3, keyDestroyed: false, legacyKeyRetained: true } },
    )
    renderDialog(c.client)
    fill("legacy-user", "Account closure")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/3 events in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(screen.getByText(/not yet cryptographic/)).toBeTruthy())
    expect(screen.getByText(/no read path shows their content/)).toBeTruthy()
    expect(screen.queryByText(/failed/i)).toBeNull()
  })

  it("shows a refusal inside the dialog, where the operator is looking", async () => {
    const c = scriptedClient(
      { "erasures.preview": { subjectId: "s", eventsAffected: 1 } },
      { "erasures.request": new ContractError("PERMISSION_DENIED", "") },
    )
    renderDialog(c.client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("PERMISSION_DENIED"))
  })

  it("refuses inputs the server would refuse, before sending", () => {
    renderDialog(scriptedClient({}).client)
    fill(" subject_1", "r")
    expect(screen.getByText(/leading or trailing space/)).toBeTruthy()
    fill("x".repeat(257), "r")
    expect(screen.getByText(/at most 256 characters/)).toBeTruthy()
  })

  it("never passes its own idempotency key, so every confirm is a new request", async () => {
    const opts: unknown[] = []
    const inner = scriptedClient(
      { "erasures.preview": { subjectId: "s", eventsAffected: 1 } },
      { "erasures.request": new ContractError("INTERNAL", "boom") },
    )
    const client = {
      ...inner.client,
      command: (intent: string, payload?: unknown, o?: unknown) => {
        opts.push(o)
        return inner.client.command(intent, payload)
      },
    } as ScopedClient
    renderDialog(client)
    fill("s", "r")
    fireEvent.click(screen.getByRole("button", { name: "Count affected events" }))
    await screen.findByText(/1 event in your scope/)
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(opts).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Erase" }))
    await waitFor(() => expect(opts).toHaveLength(2))
    expect(opts).toEqual([undefined, undefined])
  })
})
```

`erasures.test.tsx` covers:
- the list with the `total` caption;
- subject ids and erasure ids in mono;
- `requestedBy` and `createdAt` shown with `NoneCell` and `Timestamp`;
- `KeyBadge` variants;
- the empty state "No erasures have been requested in this scope.";
- opening the dialog from "Request an erasure".

`erasure-detail.test.tsx` covers:
- the full record;
- a kept key explained as "The key was kept because events in another scope still use it. This erasure's events are marked erased and unreadable; the key is destroyed the first time an erasure finds no other scope using it.";
- NOT_FOUND rendered as not found.

- [ ] **Step 2: Implement the dialog**

```tsx
// packages/plugin-chronicle/src/components/erasure-request-dialog.tsx
import { useEffect, useState } from "react"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { ErasurePreviewResponse, ErasureResult } from "../types"
import { LIMITS } from "../types"
import { formatSeq } from "../format"
import { DialogError } from "./dialog-error"

/** The server's rules for a subject id, checked before sending so the operator sees them at once. */
export function subjectProblem(s: string): string | null {
  if (s === "") return null
  if (s !== s.trim()) return "A subject ID cannot have a leading or trailing space."
  if ([...s].length > LIMITS.erasureSubjectId) return `A subject ID is at most ${LIMITS.erasureSubjectId} characters.`
  if (/[\u0000-\u001f\u007f]/.test(s)) return "A subject ID cannot contain control characters."
  return null
}

export function reasonProblem(r: string): string | null {
  if ([...r].length > LIMITS.erasureReason) return `A reason is at most ${LIMITS.erasureReason} characters.`
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(r)) return "A reason cannot contain control characters other than a line break."
  return null
}

export function ErasureRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [subject, setSubject] = useState("")
  const [reason, setReason] = useState("")
  const [counted, setCounted] = useState<string | null>(null)
  const request = useCommand<ErasureResult>("erasures.request")
  const preview = useQuery<ErasurePreviewResponse>("erasures.preview", { subjectId: counted ?? "" }, { enabled: open && counted !== null })

  // Reset when the dialog opens, not when it closes: the state that matters is what the operator is looking at now.
  useEffect(() => {
    if (open) {
      request.reset()
      setSubject("")
      setReason("")
      setCounted(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sProblem = subjectProblem(subject)
  const rProblem = reasonProblem(reason)
  const ready = counted !== null && counted === subject && preview.data !== undefined && !sProblem && !rProblem && reason.trim() !== ""

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request an erasure"
      confirmLabel="Erase"
      pending={request.loading}
      confirmDisabled={!ready || request.data !== undefined}
      onConfirm={() => void request.execute({ subjectId: subject, reason })}
      description={
        <span className="flex flex-col gap-3">
          <span>
            Erasure destroys this subject's encryption key in your scope. Their sealed fields become unreadable and cannot be recovered. The events stay in the chain, so verification is unchanged.
          </span>
          <label className="flex flex-col gap-1">
            <span>Subject ID</span>
            <Input aria-label="Subject ID" className="font-mono text-xs" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          {sProblem && <span className="text-destructive">{sProblem}</span>}
          <label className="flex flex-col gap-1">
            <span>Reason</span>
            <Textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {rProblem && <span className="text-destructive">{rProblem}</span>}
          <Button type="button" variant="outline" disabled={subject === "" || sProblem !== null} onClick={() => setCounted(subject)}>
            Count affected events
          </Button>
          {counted === subject && preview.data && (
            <span>
              {`${formatSeq(preview.data.eventsAffected)} ${preview.data.eventsAffected === 1 ? "event" : "events"} in your scope will have their sealed fields erased.`}
            </span>
          )}
          {preview.error && <DialogError what="count the events" error={preview.error} />}
          {request.data && <ErasureOutcome r={request.data} />}
          <DialogError what="request the erasure" error={request.error} />
        </span>
      }
    />
  )
}

function ErasureOutcome({ r }: { r: ErasureResult }) {
  if (r.legacyKeyRetained) {
    return (
      <span role="status">
        {`${formatSeq(r.eventsAffected)} events are marked erased, and no read path shows their content. The erasure is not yet cryptographic: their key predates per-scope keys and events in another scope still use it, so it was kept. It is destroyed the first time an erasure finds no other scope using it.`}
      </span>
    )
  }
  return <span role="status">{`${formatSeq(r.eventsAffected)} events erased. The key is destroyed.`}</span>
}
```

`ConfirmDialog`'s `description` is a `ReactNode` rendered inside a `<p>`, so every element inside it must be phrasing content: `span` and `label`, never `div` or `p`. That's why `DialogError` is a span. If kit's `Textarea` renders a block element that the `<p>` rejects, render the form above the description and check the kit's `ConfirmDialog` for a `children` slot. Read `confirm-dialog.tsx` first and use what it offers.

The confirm button must not close the dialog before the result shows. If `ConfirmDialog` closes on confirm by default, check its API for a way to keep it open (the `pending` prop, or `onConfirm` returning a promise), and use it.

- [ ] **Step 3: Implement the list and detail pages**

`ErasuresPage` is built from:
- a `PageHeader` with the action "Request an erasure", which opens the dialog;
- a `ResourceTable` whose columns are:
  - Erasure (a mono link to `/erasures/:id`);
  - Subject (mono);
  - Reason;
  - Requested by (mono, or `NoneCell`);
  - Events (right-aligned, formatted);
  - Key (`KeyBadge`);
  - Requested (`Timestamp`);
- the caption `"<n> of <total> erasures"`;
- offset paging with `pagination` and `onPageChange`;
- the empty message "No erasures have been requested in this scope."

The command's `invalidates` refreshes the list.

`ErasureDetailPage` is a `DescriptionList` of every field. For `keyDestroyed: false` it shows the kept-key sentence from Step 1.

- [ ] **Step 4: Register, run, prove, commit**

Mutation proofs:
- (a) Enable the preview on mount. "counts the subject's events before the confirm" fails, because `queried` sees the preview before the click. Add that assertion to the test if the first version doesn't catch it.
- (b) Pass `{ idempotencyKey: "fixed" }` to `execute`. The idempotency test must fail.
- (c) Render the refusal outside the dialog. The refusal test must fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): request an erasure with its count shown first"
```

---

### Task 11: Retention: policies, the enforce dialog, and archives

Retention is the other destructive surface. The page states the rules that aren't obvious:
- `*` means every category, and it's not a default;
- an app-level policy purges every tenant;
- a governing policy belongs to someone else.

Enforce runs its preview first, and a run that stopped part-way is never shown as a success.

**Files:**
- Create:
  - `packages/plugin-chronicle/src/pages/retention.tsx`
  - `src/pages/policy-detail.tsx`
  - `src/pages/policy-create.tsx`
  - `src/pages/archives.tsx`
  - `src/components/enforce-dialog.tsx`
- Modify: `packages/plugin-chronicle/src/index.tsx`: nav "Policies" (priority 60, `<TimerResetIcon />`) and "Archives" (priority 70, `<ArchiveIcon />`), both in "Retention"; routes `/retention`, `/new-policy`, `/retention/:id`, `/archives`
- Test:
  - `packages/plugin-chronicle/test/retention.test.tsx`
  - `test/enforce-dialog.test.tsx`
  - `test/policy-detail.test.tsx`
  - `test/policy-create.test.tsx`
  - `test/archives.test.tsx`

**Interfaces:**
- Consumes: `PolicyListResponse`, `PolicySummary`, `RetentionPreviewResponse`, `EnforceResponse`, `ArchiveListResponse`, `LIMITS` (Task 2); `durationLabel` (Task 2); `DialogError` (Task 2).
- Produces:
  - `RetentionPage`, `PolicyDetailPage`, `PolicyCreatePage`, `ArchivesPage`
  - `EnforceDialog(props: { open: boolean; onOpenChange(open: boolean): void })`
  - `categoryLabel(c: string): string`: `"*"` becomes "Every category (*)"
  - `policyScopeLabel(p: PolicySummary): string`: no tenant becomes "App level, every tenant"; otherwise "Tenant <id>"
  - `categoryProblem(c: string): string | null`: the server's rule

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-chronicle/test/retention.test.tsx
import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RetentionPage, categoryLabel } from "../src/pages/retention"
import { renderPage, scriptedClient } from "./harness"
import type { PolicySummary } from "../src/types"

const pol = (over: Partial<PolicySummary>): PolicySummary => ({
  id: "retpol_x", category: "debug", duration: "720h0m0s", archive: false, appId: "app_chronicle",
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", editable: true, ...over,
})

describe("RetentionPage", () => {
  it("names the wildcard for what it is", () => {
    expect(categoryLabel("*")).toBe("Every category (*)")
    expect(categoryLabel("debug")).toBe("debug")
  })

  it("says an app-level policy purges every tenant, and a tenant policy only its own", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({
        "retention.policies": { policies: [pol({ id: "retpol_app_all", category: "*", duration: "8760h0m0s" }), pol({ id: "retpol_acme_debug", tenantId: "acme" })], total: 2 },
      }).client,
    )
    await waitFor(() => expect(screen.getByText("App level, every tenant")).toBeTruthy())
    expect(screen.getByText("Tenant acme")).toBeTruthy()
    expect(screen.getByText("365 days")).toBeTruthy()
    expect(screen.getByText(/A short wildcard overrides a longer specific policy/)).toBeTruthy()
  })

  it("offers no actions on a governing policy and says who manages it", async () => {
    renderPage(
      RetentionPage,
      scriptedClient({ "retention.policies": { policies: [pol({ id: "retpol_app_all", category: "*", editable: false })], total: 1 } }).client,
    )
    const row = (await screen.findByText("Every category (*)")).closest("tr")!
    expect(within(row).getByText("Managed by an app-wide operator")).toBeTruthy()
    expect(within(row).queryByRole("button")).toBeNull()
    expect(within(row).queryByRole("link", { name: /edit/i })).toBeNull()
  })

  it("captions with the count at zero and says no policy removes anything", async () => {
    renderPage(RetentionPage, scriptedClient({ "retention.policies": { policies: [], total: 0 } }).client)
    await waitFor(() => expect(screen.getByText("No retention policies: nothing is removed from this audit trail automatically.")).toBeTruthy())
  })
})
```

```tsx
// packages/plugin-chronicle/test/enforce-dialog.test.tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { EnforceDialog } from "../src/components/enforce-dialog"
import { scriptedClient } from "./harness"

const preview = {
  eventCount: 10000, capped: true, noPolicies: false, governingAppPolicies: 0,
  byPolicy: [{ policyId: "retpol_acme_debug", category: "debug", eventCount: 10000, capped: true }],
}

function renderDialog(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <EnforceDialog open onOpenChange={() => {}} />
    </PluginProvider>,
  )
}

describe("EnforceDialog", () => {
  it("runs the preview when it opens and calls the count eligible, at least", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    renderDialog(c.client)
    await waitFor(() => expect(screen.getByText(/At least 10,000 events are eligible/)).toBeTruthy())
    expect(screen.getByText(/One run removes at most 5,000 events per policy/)).toBeTruthy()
    expect(screen.getByText(/recorded in the chain as removed by retention/)).toBeTruthy()
  })

  it("says more remain after a pass that did not finish them", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 5000, retained: 0, moreRemain: true, failed: false } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    await waitFor(() => expect(screen.getByText(/5,000 events removed. More remain: run it again/)).toBeTruthy())
  })

  it("never shows a run that stopped part-way as a success", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": { archived: 0, purged: 1200, retained: 0, moreRemain: true, failed: true } })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByText(/stopped part-way/)).toBeTruthy())
    expect(within(dialog).getByText(/1,200 events were removed before it stopped, and that cannot be undone/)).toBeTruthy()
  })

  it("says a tenant with no policies of its own is still purged by the app's", async () => {
    const c = scriptedClient({ "retention.preview": { eventCount: 0, capped: false, noPolicies: true, governingAppPolicies: 1, byPolicy: [] } })
    renderDialog(c.client)
    await waitFor(() => expect(screen.getByText(/You have no retention policies of your own/)).toBeTruthy())
    expect(screen.getByText(/1 app-level policy also removes events from your chain on the scheduler's run/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Run retention" }).hasAttribute("disabled")).toBe(true)
  })

  it("shows a refusal inside the dialog", async () => {
    const c = scriptedClient({ "retention.preview": preview }, { "retention.enforce": new ContractError("PERMISSION_DENIED", "") })
    renderDialog(c.client)
    await screen.findByText(/At least 10,000/)
    fireEvent.click(screen.getByRole("button", { name: "Run retention" }))
    const dialog = await screen.findByRole("alertdialog")
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("PERMISSION_DENIED"))
  })
})
```

The remaining three test files cover the following.

`policy-create.test.tsx`:
- the category rule: `":"` refused, 65 characters refused, `"*"` allowed, edge space refused;
- duration as a number plus a unit (hours or days) sent as a Go duration string (`"48h"`, or `"720h"` for 30 days), with 0 refused;
- the note "A policy saved by an app-wide operator has no tenant, so it removes events from every tenant in the app.";
- CONFLICT rendered as "A policy for this category already exists in your scope.";
- a successful save navigates to `/retention/<id>`, via `useNavigateTo`.

`policy-detail.test.tsx`:
- an editable policy saves `{ id, duration, archive }` with no `category` (the category can't change, and the page says so);
- delete goes through a `ConfirmDialog`, with `pending`, and navigates back to `/retention`;
- a governing policy renders read-only with no save or delete.

`archives.test.tsx`:
- the list with a `hasMore` "Next page" and no total;
- `sinkRef` in mono or `NoneCell`;
- the empty message "No retention run has archived anything yet."

- [ ] **Step 2: Implement**

The helpers are exact:

```ts
export function categoryLabel(c: string): string {
  return c === "*" ? "Every category (*)" : c
}

export function policyScopeLabel(p: PolicySummary): string {
  return p.tenantId ? `Tenant ${p.tenantId}` : "App level, every tenant"
}

/** chronicle's rule: "*" or 1 to 64 characters with no ':', no control characters, no edge spaces. */
export function categoryProblem(c: string): string | null {
  if (c === "*") return null
  if (c === "") return "A category is required."
  if (c !== c.trim()) return "A category cannot start or end with a space."
  if ([...c].length > LIMITS.policyCategory) return `A category is at most ${LIMITS.policyCategory} characters.`
  if (c.includes(":")) return "A category cannot contain ':'."
  if (/[\u0000-\u001f\u007f]/.test(c)) return "A category cannot contain control characters."
  return null
}
```

`RetentionPage`:
- `PageHeader` actions:
  - "New policy", a `PluginLink` to `/new-policy`;
  - "Run retention now", which opens `EnforceDialog`.
- A paragraph above the table: "A policy removes events in its category once they are older than its duration. A category of * means every category, not a default: a short wildcard overrides a longer specific policy for its category."
- `ResourceTable` columns:
  - Category (`categoryLabel`; a link to `/retention/:id` only when `editable`);
  - Keeps for (`durationLabel`);
  - Archive ("Archived first" or "Not archived");
  - Scope (`policyScopeLabel`);
  - Updated (`Timestamp`);
  - a last column that shows "Managed by an app-wide operator" in muted text when `!editable`, and nothing otherwise.
- Caption `"<total> policies"`. Empty message "No retention policies: nothing is removed from this audit trail automatically."

`EnforceDialog`:
- `useQuery("retention.preview", {}, { enabled: open })` and `useCommand("retention.enforce")`, with `reset()` on open.
- The description, built from phrasing content only:
  - `noPolicies`: "You have no retention policies of your own, so running retention here removes nothing." When `governingAppPolicies > 0`, also "<n> app-level policy (or policies) also removes events from your chain on the scheduler's run."
  - Otherwise:
    - "<At least if capped><count> events are eligible under your policies.";
    - the per-policy list (category, count, "at least" when capped);
    - "One run removes at most 5,000 events per policy, so eligible is not the same as removed.";
    - "Removed events are recorded in the chain as removed by retention, so verification still links across them; what they said is gone."
- Confirm label "Run retention", `pending`, and `confirmDisabled` when there are no policies or the preview isn't loaded.
- The result:
  - `failed`: "Retention stopped part-way. <purged> events were removed before it stopped, and that cannot be undone. Open the preview again to see what remains." Use the destructive colour, since this is a failure.
  - Otherwise: "<purged> events removed<, archived count>." plus "More remain: run it again." when `moreRemain`.

Errors go in `DialogError`, inside the dialog.

`PolicyCreatePage`:
- a category input, validated live with `categoryProblem`;
- a duration amount (a positive integer) and unit select (hours or days), sent as `"<n>h"` with days times 24;
- an archive checkbox;
- `useCommand("retention.savePolicy")`, `execute({ category, duration, archive })`;
- on success, `navigate(\`/retention/${result.id}\`)`;
- CONFLICT mapped to its sentence, and any other error shown with `CommandAlert`.

`PolicyDetailPage`:
- a `DescriptionList` of every field;
- when `editable`: a form for duration and archive only, where save sends `{ id, duration, archive }`, plus a delete `ConfirmDialog` (`pending`, error inside, and on success `navigate("/retention")`);
- when not `editable`: the read-only sentence "This policy is set at the app level and applies to your tenant. An app-wide operator manages it."

`ArchivesPage`:
- `ResourceTable` columns:
  - Archive id (mono);
  - Policy (mono);
  - Category;
  - Events;
  - From and To (`Timestamp`);
  - Sink;
  - Sink ref (mono or `NoneCell`);
  - Tenant (mono or "App level");
  - Created;
- "Previous page" and "Next page" driven by `hasMore`;
- the caption `"<n> archives shown"`.

- [ ] **Step 3: Register, run, prove, commit**

Mutation proofs:
- (a) Show the enforce result as success when `failed` is true. The part-way test must fail.
- (b) Render row actions on non-editable policies. The governing test must fail.
- (c) Send `category` on update. The policy-detail test must fail.
- (d) Enable the preview before open. Add an assertion that nothing is queried while `open` is false, and watch it fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): manage retention policies and run retention with its preview first"
```

---
### Task 12: Compliance reports: generate, read, export

A compliance report goes in front of an auditor. Four rules shape it:
- Its integrity section never goes silent. It's either a verification with the scope it covered, a stated reason none ran, or "this report contains no integrity verification".
- A capped verification proves only its window.
- An app-wide report verified only the untenanted chain.
- The exports are downloads. HTML is never injected into the page, and markdown is never rendered.

**Files:**
- Create:
  - `packages/plugin-chronicle/src/pages/reports.tsx`
  - `src/pages/report-detail.tsx`
  - `src/pages/report-create.tsx`
  - `src/pages/custom-report-create.tsx`
  - `src/components/report-verification.tsx`
  - `src/download.ts`
- Modify: `packages/plugin-chronicle/src/index.tsx`: nav "Reports" in "Compliance", priority 40, `<FileCheckIcon />`; routes `/reports`, `/reports/:id`, `/new-report`, `/new-custom-report`
- Test:
  - `packages/plugin-chronicle/test/reports.test.tsx`
  - `test/report-detail.test.tsx`
  - `test/report-verification.test.tsx`
  - `test/report-create.test.tsx`
  - `test/custom-report-create.test.tsx`
  - `test/download.test.ts`

**Interfaces:**
- Consumes:
  - `ReportListResponse`, `ReportSummary`, `ReportDetail`, `ReportSection`, `VerificationScope`, `GenerateReportResponse`, `CustomReportSection`, `ExportReportResponse`, `LIMITS` (Task 2);
  - `Certificate` (Task 5);
  - `eventColumns` (Task 7);
  - `useQuery(..., { enabled })` (Task 1).
- Produces:
  - `ReportsPage`, `ReportDetailPage`, `ReportCreatePage`, `CustomReportCreatePage`
  - `ReportVerification(props: { report: ReportDetail })`
  - `saveFile(filename: string, contentType: string, content: string): void`
  - `reportTypeLabel(t: string): string`: `soc2` is "SOC 2", `hipaa` is "HIPAA", `eu_ai_act` is "EU AI Act", `custom` is "Custom"

- [ ] **Step 1: Write the failing tests for the verification section**

```tsx
// packages/plugin-chronicle/test/report-verification.test.tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ReportVerification } from "../src/components/report-verification"
import type { ReportDetail } from "../src/types"
import { mixed } from "./verification/fixtures"

const base: ReportDetail = {
  id: "report_soc2", title: "SOC 2 evidence, Q3", type: "soc2", period: { from: "2026-07-01T00:00:00Z", to: "2026-09-30T00:00:00Z" },
  generatedBy: "user_admin", format: "json", createdAt: "2026-09-29T10:00:00Z", sections: [],
}

describe("ReportVerification", () => {
  it("says a report with neither field contains no integrity verification", () => {
    render(<ReportVerification report={base} />)
    expect(screen.getByText("This report contains no integrity verification.")).toBeTruthy()
  })

  it("says why none ran when the scope had no chain", () => {
    render(<ReportVerification report={{ ...base, verificationScope: { status: "no_chain", headSeq: 0, fromSeq: 0, toSeq: 0, window: 50000, capped: false, checkpointsConfigured: true, notes: [] } }} />)
    expect(screen.getByText(/No verification ran: this scope had not recorded any events when the report was generated/)).toBeTruthy()
    expect(screen.queryByText(/No alteration detected|No corruption detected/)).toBeNull()
  })

  it("says why none ran when the deployment gave the engine no chain", () => {
    render(<ReportVerification report={{ ...base, verificationScope: { status: "not_configured", headSeq: 0, fromSeq: 0, toSeq: 0, window: 50000, capped: false, checkpointsConfigured: false, notes: [] } }} />)
    expect(screen.getByText(/No verification ran: this deployment gives the report engine no hash chain/)).toBeTruthy()
  })

  it("puts a capped window's limit next to its verdict and renders the engine's notes", () => {
    render(
      <ReportVerification
        report={{
          ...base,
          verification: { ...mixed, firstEvent: 11005, partial: true, retentionPolicies: -1 },
          verificationScope: { status: "verified", streamId: "stream_acme", scheme: "chronicle/v5", schemeSince: 48201, headSeq: 61004, fromSeq: 11005, toSeq: 61004, window: 50000, capped: true, checkpointsConfigured: true, notes: ["Sequences 1 to 11004 were not verified: the report verifies at most 50,000 sequences."] },
        }}
      />,
    )
    expect(screen.getByText(/Sequences 1 to 11,004 were not checked/)).toBeTruthy()
    expect(screen.getByText("Sequences 1 to 11004 were not verified: the report verifies at most 50,000 sequences.")).toBeTruthy()
    expect(screen.getByText(/This check does not speak for the rest of the chain/)).toBeTruthy()
  })

  it("says an app-wide report verified only the app's own chain", () => {
    render(
      <ReportVerification
        report={{
          ...base,
          verification: { ...mixed, retentionPolicies: -1 },
          verificationScope: { status: "verified", streamId: "stream_app", headSeq: 61004, fromSeq: 1, toSeq: 61004, window: 50000, capped: false, checkpointsConfigured: true, notes: ["This report has no tenant, so only the app's untenanted chain was verified."] },
        }}
      />,
    )
    expect(screen.getByText(/only the app's untenanted chain was verified/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Implement the verification section**

```tsx
// packages/plugin-chronicle/src/components/report-verification.tsx
import type { ReportDetail } from "../types"
import { formatSeq } from "../format"
import { Certificate } from "../verification/certificate"

/**
 * A report's integrity section. It is never omitted: an auditor reading a
 * report with no section cannot tell "verified and fine" from "nobody
 * looked". The verification and its scope are read together: a valid verdict
 * on a capped scope proves only the window, and the page says which
 * sequences went unchecked.
 */
export function ReportVerification({ report }: { report: ReportDetail }) {
  const scope = report.verificationScope
  const v = report.verification
  let body
  if (!v && !scope) {
    body = <p>This report contains no integrity verification.</p>
  } else if (scope?.status === "no_chain") {
    body = <p>No verification ran: this scope had not recorded any events when the report was generated.</p>
  } else if (scope?.status === "not_configured") {
    body = <p>No verification ran: this deployment gives the report engine no hash chain, so it could not check anything.</p>
  } else if (v) {
    body = (
      <div className="flex flex-col gap-4">
        {scope?.capped && scope.fromSeq > 1 && (
          <p className="font-medium">
            {`Sequences 1 to ${formatSeq(scope.fromSeq - 1)} were not checked: a report verifies at most the newest ${formatSeq(scope.window)} sequences, ending at the head.`}
          </p>
        )}
        <Certificate response={{ noChain: false, report: v }} />
      </div>
    )
  } else {
    body = <p>This report contains no integrity verification.</p>
  }
  return (
    <section aria-labelledby="report-integrity" className="flex flex-col gap-3">
      <h2 id="report-integrity" className="text-lg font-medium">Integrity</h2>
      {body}
      {scope && scope.notes.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {scope.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

The embedded verification carries `retentionPolicies: -1`, so the certificate's retention qualifier says "unknown" when there are gaps. That's correct: nobody counted policies for a stored report.

- [ ] **Step 3: Write the failing tests for download and export**

```ts
// packages/plugin-chronicle/test/download.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { saveFile } from "../src/download"

afterEach(() => vi.restoreAllMocks())

describe("saveFile", () => {
  it("saves the content as a file of its type, and never puts it in the page", () => {
    const blobs: Blob[] = []
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"), revokeObjectURL: () => {} })
    const click = vi.fn()
    const create = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = create(tag)
      if (tag === "a") el.click = click
      return el
    })
    saveFile("report-1.html", "text/html; charset=utf-8", "<html><script>alert(1)</script></html>")
    expect(click).toHaveBeenCalledOnce()
    expect(blobs[0].type).toBe("text/html; charset=utf-8")
    expect(document.body.innerHTML).not.toContain("<script>alert(1)</script>")
  })
})
```

`report-detail.test.tsx` covers:
- the header, type label, period and generated by (mono);
- the stats tiles;
- each section with `matchedEvents`, and "Showing 1,000 of <n> matching events" when `eventsTruncated`;
- the `ReportVerification` section;
- the export buttons. Clicking "Download HTML" runs `reports.export` with `{ id, format: "html" }` only on click, via `enabled` (assert nothing is queried before the click), and calls `saveFile` (mock it with `vi.mock("../src/download")`).
- The HTML content never appears in the DOM. The markdown content with a `|` in an action is never rendered as a table: assert no `<table>` holds it.

`reports.test.tsx` covers:
- the list, newest first, with "Next page" driven by `hasMore` and no total;
- type labels, including `eu_ai_act` shown as "EU AI Act";
- the empty message "No reports have been generated in this scope.";
- links to `/new-report` and `/new-custom-report`.

`report-create.test.tsx` covers:
- type options soc2, hipaa and euaiact (sent exactly so);
- an optional period, sent as RFC3339 `from` and `to` (both or neither; one alone refused with "Give both dates, or neither for the last 90 days");
- `to` before `from` refused;
- on success, navigating to `/reports/<id>`;
- PERMISSION_DENIED and UNAVAILABLE shown with `CommandAlert`.

`custom-report-create.test.tsx` covers:
- a title (200 max);
- 1 to 20 sections, with "Add section" disabled at 20;
- each section's title (required, 200 max), notes (4000 max), and categories, actions and severity as comma lists (50 values max, each 128 max);
- the payload shape `{ title, period?, sections: [{ title, categories?, actions?, severity?, notes? }] }`, with empty lists omitted;
- a server BAD_REQUEST shown with `CommandAlert`.

- [ ] **Step 4: Implement**

```ts
// packages/plugin-chronicle/src/download.ts
/**
 * Saves text as a file. Report exports go out this way and no other: the
 * HTML export is never injected into the page, and the markdown export, whose
 * event fields chronicle does not escape, is never rendered as markdown.
 */
export function saveFile(filename: string, contentType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  a.click()
  URL.revokeObjectURL(url)
}
```

`ReportDetailPage`:
- `useQuery("reports.detail", { id })`.
- The export uses `const [format, setFormat] = useState<string | null>(null)` and `useQuery<ExportReportResponse>("reports.export", { id, format }, { enabled: format !== null })`. When `data` arrives for the current format, call `saveFile(data.filename, data.contentType, data.content)` once, in an effect keyed on `data`, then `setFormat(null)`.
- Four buttons: "Download JSON", "Download CSV", "Download Markdown" and "Download HTML".
- The body:
  - a `StatGrid` from `stats` when present;
  - each section as a heading, its notes, and a `ResourceTable` with `eventColumns({ showUser: true })`, captioned `"<events.length> of <matchedEvents> matching events"`, plus the truncation sentence when `eventsTruncated`;
  - `ReportVerification` last.

The create pages follow Vault's create pages: form state, `useCommand`, client-side limit checks mirroring `LIMITS`, `CommandAlert` for server errors, and `useNavigateTo` on success.

- [ ] **Step 5: Register, run, prove, commit**

Mutation proofs:
- (a) Render nothing when `verification` is absent. The "contains no integrity verification" test must fail.
- (b) Render the HTML export with `dangerouslySetInnerHTML`. The detail test's DOM assertion must fail.
- (c) Enable the export query on mount. The "only on click" assertion must fail.

```bash
git add packages/plugin-chronicle/src packages/plugin-chronicle/test
git commit -m "feat(plugin-chronicle): generate, read and export compliance reports"
```

---

### Task 13: Into the shell, measured, and run

Phase 5 of the spec: "Every serious bug in the authsome migration was found by running it and not by a test, and the tests were green through all of them." This task registers the plugin and re-measures the bundle. Then it runs the shell against the fixture and clicks every page, in every fixture mode.

**Files:**
- Modify:
  - `apps/shell/package.json`: `"@forge-go/dashboard-plugin-chronicle": "workspace:*"`
  - `apps/shell/src/App.tsx`: the import, and `chroniclePlugin` added to the `plugins` array after `vaultPlugin`
  - `apps/shell/test/app.test.tsx`: a `describe("chronicle in the shell")` block like Relay's
  - `BASELINE.md`: re-measured
  - `docs/superpowers/specs/2026-09-23-chronicle-dashboard-migration-design.md`: the two departures from the File Structure section, under "Amendments from implementation"
- Test: `apps/shell/test/app.test.tsx`

**Interfaces:**
- Consumes: `chroniclePlugin` (Task 2 onward).

- [ ] **Step 1: Register in the shell**

Add the dependency and the import beside Vault's (`apps/shell/src/App.tsx` around line 13), and append `chroniclePlugin` to the `plugins` array. Both files carry other sessions' uncommitted work: stage only your own hunks. Add the shell test block. Read how `describe("relay in the shell")` (around line 308) asserts that the plugin's nav appears when capabilities list the extension, and do the same for chronicle: the "Integrity", "Log", "Compliance", "Retention" and "Settings" groups, and the "Chain" landing route.

Run: `pnpm --filter @forge-go/dashboard-shell test && pnpm --filter @forge-go/dashboard-shell build`
Expected: PASS. The build runs `tsc -b` with the shell's stricter flags over the plugin's source, so fix anything it finds in the plugin, not in the shell.

- [ ] **Step 2: Check the chunk split, then re-measure**

Read the `pnpm --filter @forge-go/dashboard-shell build` output.
- Confirm that a separate chunk holds `event-detail` and `@codemirror/*`, and that the entry chunk doesn't contain `@codemirror`. `grep -l codemirror apps/shell/dist/assets/*.js` should list only the lazy chunk (plus Relay's own lazy editor chunk).
- Update `BASELINE.md` with the new sizes the way the file's existing entries record them.
- The spec is explicit that one stray static import pulls CodeMirror into the entry chunk unnoticed, so read the output; don't assume.

- [ ] **Step 3: Run it against the fixture**

Start the fixture and the shell. Other sessions may already run a fixture or dev server; check the ports first, and don't kill what isn't yours.

```bash
FIXTURE_PORT=8099 node packages/fixture-server/server.mjs
pnpm --filter @forge-go/dashboard-shell dev
```

Open the shell in the in-app browser and click every page. For each, confirm what the spec requires. Take a screenshot of each numbered item.

1. **Chain, own chain (plain, no checkpoints).** Posture shows `chronicle/v4`, "This deployment takes no checkpoints" appears only in `NO_CHECKPOINTS` mode, and nothing runs until a button is pressed. Run the default window: the verdict reads "No corruption detected ..." with the unkeyed sentence, the limits section is the loudest thing under it, the whole-chain button is enabled (head 12,431), and nothing is green.
2. **Chain, acme.** Choose it in the picker. "Check the whole chain" is enabled, because the head, 61,004, is under the 100,000 cap. Run it: the verdict names the 48,201 boundary, and the ribbon shows unkeyed, signed and keyed bands with checkpoint notches. Then type a range of 1 to 150,000 and check it: the server's refusal shows with the "most recent 10,000" offer.
3. **Chain, globex.** Breaks show 2,311 to 2,312 missing, 2,780 altered and 2,901 relabelled. Each ribbon marker, activated by keyboard, focuses its row. Sequences 101 to 400 appear under "Removed by retention" and not as breaks. The retention qualifier reads "2 retention policies can purge this chain ..." (the app-level `*` policy plus globex's `debug`).
4. **Chain, initech, whole chain.** The head mismatch and the checkpoint contradiction appear as breaks, and checkpoint 2's hash row reads "not checked" with its note, in muted text.
5. **Checkpoints** for acme: take one (the fixture appends 60,001 to 61,004), then take again ("Nothing new ...").
6. **Events.** Captions show "50 of N". Filter to outcome denied, then a filter that matches nothing, and see both empty states. Open `audit_own_12401` and see the `[ERASED]` literal sentence. Open `audit_own_12400` and see the Erased badge with its erasure link. Check the digest, then follow "Check the chain around this event".
7. **Activity.** Four tiles, three breakdowns, and by hour the empty 03:00 on 28 Sep named in words. Look at the bars; they should be bars, in one ink.
8. **Erasures.** Request one for `subject_2`: count first, then erase. Request one for `legacy-user` and see the kept-key sentence.
9. **Retention.** See the `*` wording and the scopes. Run retention: the preview opens with the "eligible" and "at most 5,000" sentences. Create a policy and hit CONFLICT by creating it twice. Open archives.
10. **Reports.** Open `report_soc2`: capped, with the unchecked-sequences sentence and the notes. Open `report_hipaa`: "contains no integrity verification". Open `report_ai`: no chain. Download each export format and confirm the HTML one downloads and doesn't render. Generate a SOC 2 report and a custom one.
11. **Settings.**

Then restart the fixture in each mode and repeat the parts that change:
- `FIXTURE_CHRONICLE_NO_CHECKPOINTS=1`: Checkpoints says the deployment stores none, with no crash on null; certificates say "Not checked, this deployment stores no checkpoints".
- `FIXTURE_CHRONICLE_NO_OWN_CHAIN=1`: Chain offers the tenant chains (Review Focus 2).
- `FIXTURE_CHRONICLE_VIEWER=tenant`: no picker, one chain; the Retention page shows the app-level policy read-only with "Managed by an app-wide operator" (Review Focus 5).
- `FIXTURE_CHRONICLE_NO_ERASURE=1`: the erasure dialog shows UNAVAILABLE inside itself.

Every bug found here gets a failing test first, then its fix, in its own commit. Record each one in the task report.

- [ ] **Step 4: Record the two departures in the spec**

Under the spec's "Amendments from implementation", add one paragraph each, in Rex's voice:
- **The events table doesn't virtualise.** Every list is server-paged, at 50 rows by default and 200 at most, so a virtualiser adds a dependency and a second scroll model for no gain. The spec's real rule, never filter or page in the browser, holds without it.
- **The chain page has a picker for an app-wide operator,** since the final review gave `verify.run` a `streamId` for exactly this. A tenant operator never sees it.

Invoke the `rex-voice` skill before writing them, and keep them free of em dashes.

- [ ] **Step 5: The whole workspace**

Run: `pnpm -r test`, `pnpm --filter @forge-go/dashboard-plugin-chronicle typecheck`, `pnpm --filter @forge-go/dashboard-plugin-chronicle lint` and `pnpm --filter @forge-go/dashboard-plugin typecheck`.
Expected: PASS. A failure in another session's package isn't yours to fix. Report it with its output and don't touch that package.

- [ ] **Step 6: Commit**

```bash
git add BASELINE.md apps/shell/test/app.test.tsx
git add -f docs/superpowers/specs/2026-09-23-chronicle-dashboard-migration-design.md
# apps/shell/package.json, apps/shell/src/App.tsx, pnpm-lock.yaml: only your own hunks, via git apply --cached
git diff --cached --stat
git commit -m "feat(shell): mount the chronicle plugin"
```

## Done when

- `pnpm -r test` passes, and the chronicle, plugin and shell packages typecheck and lint clean.
- The shell builds, the entry chunk has no `@codemirror`, and `BASELINE.md` has the new sizes.
- Every page was clicked in the shell against the fixture in all five modes (default plus four switches), with a screenshot per numbered item in Task 13, Step 3.
- Every Review Focus line has a test that failed when its behaviour was broken.
- The spec records the two departures.
