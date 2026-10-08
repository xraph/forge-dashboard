# Dispatch Slice 4a: React foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Dispatch page shared read freshness, cursor semantics and reliable confirmations before implementing the resource pages.

**Architecture:** A new @forge-go/dashboard-plugin-dispatch package follows Trove's setup. It consumes the existing SDK and compact kit components. A reference-aware query wrapper retains only the last successful response for the same intent, parameters and client. Polling remains in one hook and an optional mounted poll component.

**Tech stack:** React 19, TypeScript, Forge plugin SDK, shared dashboard kit, Vitest, Testing Library.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Constraints and interfaces

- Primary main checkout only. Preserve concurrent files and use exact staging. Push verified work under the updated user instructions.
- Native implementation, test-first for behavior. One fresh final reviewer for this plan; no implementation delegation.
- Tasks consume the shared Page, Snapshot and state types. Later pages use useDispatchQuery with Read; they never implement their own retention or polling. No endpoint changes in this slice.
- Retain data for INTERNAL, UNAVAILABLE, TRANSPORT and TIMEOUT refresh errors. Clear it for denied, unauthenticated, missing and invalid requests, for changed query parameters, and for a changed client.
- Five-second polling for operational lists and nonterminal details; 30 seconds for DLQ, cron and handlers; none for artifacts, config and terminal details. Read mounts Poll only when enabled, so a null interval never reaches SDK usePoll.
- Preserve data and child component state during refetch. Show server asOf and visible stale status on retained failures.
- nextCursor controls continuation. complete controls search-coverage wording. Empty incomplete results can still continue.
- Use ZeroState for empty/missing resources, QueryBoundary for initial loading and denied/failed reads, and CommandAlert for stale refresh and command failures.
- Confirmations capture the described payload when opened. Pending commands cannot double-submit or close. Errors stay in the dialog; reopening resets them. Backend commands keep their existing idempotency and conflict protection.
- The shared dashboard lint/format sweep has another coordinator. Run this package's documented equivalents, pnpm --filter @forge-go/dashboard-plugin-dispatch format and lint, followed by typecheck and tests. Inspect lockfile changes and stage only this package's importer if installation touches concurrent dependencies.
- No routes or host wiring are claimed in this foundation slice. Full React pages, fixtures, browser parity and templ retirement remain active follow-on work.

## Design direction

Use the existing dashboard font, foreground/muted/border/card tokens and compact PageHeader, ResourceTable and Button variants. IDs use the existing mono utility. Warning foreground marks stale data; destructive color marks failed jobs, failed runs and silent workers. Routine completed rows and unreplayed DLQ entries use outline badges.

```text
Desktop
Title + short operator scope note                       page actions
as of / stale + retry                                    refresh
filters on one wrapping row
working table or checkpoint timeline
cursor coverage + page                            previous / next

Job/run detail
Title + state + version/queue                            actions
lifecycle / checkpoints (main)       ownership / resources (aside)
payload and error inline            related jobs / artifacts
```

On narrow widths controls wrap, the detail aside follows the main content, and wide tables scroll in their existing focusable table region. No tall hero or repeated explanatory cards. Shared ZeroState keeps explanation and its next action together.

Self-check against the brief: the compact header and status row leave the working content near the top. These foundation components express freshness and confirmation behavior without inventing another design system. Desktop/narrow rendering remains a later browser gate.

## Review focus

- Query identity changes and denied/missing responses must not expose retained data.
- Polling must stop for terminal details and hidden tabs, and resume on visibility.
- A complete page with a next cursor still permits navigation; empty incomplete pages remain actionable.
- Confirmation targets must not silently change during a refetch, failures must remain visible, and rapid clicks must send one command.
- Shared kit/SDK use must preserve focus and open dialogs through ordinary background reads.

## Bootstrap

Create the following package configuration and harness before the first behavioral test. Run pnpm install only after inspecting the current lockfile; preserve concurrent importers.

### `package.json`

```json
{
  "name": "@forge-go/dashboard-plugin-dispatch",
  "version": "0.0.0",
  "type": "module",
  "files": [
    "src"
  ],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "vitest run",
    "lint": "eslint",
    "format": "prettier --write \"**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@forge-go/dashboard-kit": "^0.1.0",
    "@forge-go/dashboard-plugin": "^0.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@eslint/js": "^10",
    "@forge-go/dashboard-kit": "workspace:*",
    "@forge-go/dashboard-plugin": "workspace:*",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6",
    "eslint": "^10",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17",
    "jsdom": "^25.0.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "typescript": "~6",
    "typescript-eslint": "^8",
    "vitest": "^5.0.0"
  },
  "exports": {
    ".": "./src/index.ts"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

### `vitest.config.ts`

```tsx
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  test: {
    // 5s is one suite's budget. `pnpm test` runs every package's suite at
    // once, and tests that take under a second alone have gone past 5s
    // under that load.
    testTimeout: 20_000,
    globals: true,
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    setupFiles: ["../test-support/jsdom-setup.ts", "./test/setup.ts"],
  },
})
```

### `eslint.config.js`

```tsx
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Same reasoning as packages/plugin: this is a library, not a Vite app,
    // so nothing in it is a fast refresh boundary. src/index.tsx exports the
    // plugin object beside no components at all, and the page modules export
    // their row types beside the page that renders them.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
```

### `test/setup.ts`

```tsx
import { configure } from "@testing-library/react"
configure({asyncUtilTimeout: 5_000})
```

### `test/harness.tsx`

```tsx
import { beforeEach } from "vitest"
import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
beforeEach(() => queryStore.clear())
type Handler = (value?: unknown) => unknown | Promise<unknown>
export function clientFor(queries: Record<string, Handler>, commands: Record<string, Handler> = {}): ScopedClient {
  async function call<T>(handlers: Record<string, Handler>, intent: string, payload?: unknown): Promise<T> {
    if (!handlers[intent]) throw new ContractError("NOT_FOUND", "Unknown intent " + intent)
    return await handlers[intent](payload) as T
  }
  return {extension: "dispatch", query: (intent, params) => call(queries, intent, params), command: (intent, payload) => call(commands, intent, payload)}
}
export function renderWithClient(children: ReactNode, client: ScopedClient) {
  return render(<PluginProvider client={client}>{children}</PluginProvider>)
}
```

## Task 1: Scaffold the package and fixed state badges

**Files:** `packages/plugin-dispatch/test/badges.test.tsx`, `packages/plugin-dispatch/src/types.ts`, `packages/plugin-dispatch/src/badges.tsx`.

- [ ] Add the tests below.

### `test/badges.test.tsx`

```tsx
import { expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { CronBadge, HeartbeatBadge, JobStateBadge, ReplayBadge, RunStateBadge } from "../src/badges"
it("keeps routine states quiet and distinguishes failure from heartbeat evidence", () => {
  render(<><JobStateBadge state="completed" /><JobStateBadge state="failed" /><JobStateBadge state="pending" /><RunStateBadge state="running" /><CronBadge enabled /><ReplayBadge replayed={false} /><HeartbeatBadge status="unknown" /><HeartbeatBadge status="silent" /></>)
  expect(screen.getByText("completed").getAttribute("data-variant")).toBe("outline")
  expect(screen.getByText("failed").getAttribute("data-variant")).toBe("destructive")
  expect(screen.getByText("pending").getAttribute("data-variant")).toBe("secondary")
  expect(screen.getByText("running").getAttribute("data-variant")).toBe("default")
  expect(screen.getByText("Enabled").getAttribute("data-variant")).toBe("outline")
  expect(screen.getByText("Not replayed").getAttribute("data-variant")).toBe("outline")
  expect(screen.getByText("Heartbeat unknown").getAttribute("data-variant")).toBe("outline")
  expect(screen.getByText("Silent").getAttribute("data-variant")).toBe("destructive")
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch test -- test/badges.test.tsx`. Expected FAIL: the new behavior's module does not exist.
- [ ] Implement the following.

### `src/types.ts`

```tsx
export type JobState = "pending" | "running" | "completed" | "failed" | "retrying" | "cancelled"
export type RunState = "running" | "completed" | "failed"
export interface Duration { text: string; ms: number }
export interface Page<T> { items: T[]; nextCursor: string | null; complete: boolean; asOf: string }
export interface Snapshot { asOf: string }
```

### `src/badges.tsx`

```tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { JobState, RunState } from "./types"

const jobVariants = {
  completed: "outline", cancelled: "outline", pending: "secondary",
  running: "default", retrying: "default", failed: "destructive",
} as const
export function JobStateBadge({ state }: { state: JobState }) {
  return <Badge variant={jobVariants[state] ?? "outline"}>{state}</Badge>
}
export function RunStateBadge({ state }: { state: RunState }) {
  return <Badge variant={state === "failed" ? "destructive" : state === "running" ? "default" : "outline"}>{state}</Badge>
}
export function ReplayBadge({ replayed }: { replayed: boolean }) {
  return <Badge variant={replayed ? "secondary" : "outline"}>{replayed ? "Replayed" : "Not replayed"}</Badge>
}
export function CronBadge({ enabled }: { enabled: boolean }) {
  return <Badge variant={enabled ? "outline" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge>
}
export function HeartbeatBadge({ status }: { status: "unknown" | "recent" | "silent" }) {
  return <Badge variant={status === "silent" ? "destructive" : "outline"}>{status === "recent" ? "Recent heartbeat" : status === "silent" ? "Silent" : "Heartbeat unknown"}</Badge>
}
```

- [ ] Run package format, lint, typecheck and the relevant tests. Expected PASS. Inspect the formatting diff.
- [ ] Inspect branch and staged/concurrent scope. Commit owned paths: `feat(dispatch): add plugin foundation and state badges`.

## Task 2: Retain read snapshots with explicit freshness

**Files:** `packages/plugin-dispatch/test/read.test.tsx`, `packages/plugin-dispatch/src/read.tsx`.

- [ ] Add the tests below.

### `test/read.test.tsx`

```tsx
import { afterEach, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { Read, useDispatchQuery } from "../src/read"
import { clientFor, renderWithClient } from "./harness"

const snapshot = {asOf: "2026-10-08T18:00:00Z", name: "first job"}
function Probe({ id }: {id: string}) {
  const query = useDispatchQuery<typeof snapshot>("jobs.get", {id})
  return <Read title="Job" query={query}>{data => <p>{data.name}</p>}</Read>
}
afterEach(() => vi.useRealTimers())
it("retains the last successful snapshot on transient failure and recovers", async () => {
  let failure = false
  const client = clientFor({"jobs.get": () => {if (failure) throw new ContractError("UNAVAILABLE", "Store unavailable"); return snapshot}})
  renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  failure = true
  fireEvent.click(screen.getByRole("button", {name: "Refresh"}))
  await screen.findByText("Refresh failed")
  expect(screen.getByText("first job")).toBeTruthy()
  expect(screen.getByText(/Stale since/)).toBeTruthy()
  failure = false
  fireEvent.click(screen.getByRole("button", {name: "Refresh"}))
  await waitFor(() => expect(screen.queryByText("Refresh failed")).toBeNull())
  expect(screen.getByText(/As of/)).toBeTruthy()
})
it.each(["PERMISSION_DENIED", "UNAUTHENTICATED", "NOT_FOUND"])("clears retained data after %s", async code => {
  let failure = false
  const client = clientFor({"jobs.get": () => {if (failure) throw new ContractError(code, "Read refused"); return snapshot}})
  renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  failure = true
  fireEvent.click(screen.getByRole("button", {name: "Refresh"}))
  await waitFor(() => expect(screen.queryByText("first job")).toBeNull())
  if (code === "NOT_FOUND") expect(screen.getByText("Job not found")).toBeTruthy()
  else expect(screen.getByRole("alert").textContent).toContain(code)
})
it("never retains data from another ID while that read is pending", async () => {
  const client = clientFor({"jobs.get": params => (params as {id: string}).id === "a" ? snapshot : new Promise(() => {})})
  const view = renderWithClient(<Probe id="a" />, client)
  await screen.findByText("first job")
  view.rerender(<PluginProvider client={client}><Probe id="b" /></PluginProvider>)
  expect(screen.queryByText("first job")).toBeNull()
  expect(screen.getByRole("status", {name: "Loading Job"})).toBeTruthy()
})
it("polls only nonterminal snapshots and stops on hidden tabs", () => {
  vi.useFakeTimers()
  const refetch = vi.fn()
  type Data = {asOf: string; terminal: boolean}
  const query: QueryState<Data> = {data: {asOf: snapshot.asOf, terminal: false}, loading: false, refetch}
  const interval = (data: Data | undefined) => data?.terminal ? null : 5_000
  const view = render(<Read title="Job" query={query} intervalMs={interval}>{() => <p>loaded</p>}</Read>)
  act(() => vi.advanceTimersByTime(5_000))
  expect(refetch).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, "visibilityState", {configurable: true, value: "hidden"})
  fireEvent(document, new Event("visibilitychange"))
  act(() => vi.advanceTimersByTime(15_000))
  expect(refetch).toHaveBeenCalledTimes(1)
  Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"})
  fireEvent(document, new Event("visibilitychange"))
  expect(refetch).toHaveBeenCalledTimes(2)
  view.rerender(<Read title="Job" query={{...query, data: {...query.data!, terminal: true}}} intervalMs={interval}>{() => <p>loaded</p>}</Read>)
  act(() => vi.advanceTimersByTime(30_000))
  expect(refetch).toHaveBeenCalledTimes(2)
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch test -- test/read.test.tsx`. Expected FAIL: the new behavior's module does not exist.
- [ ] Implement the following.

### `src/read.tsx`

```tsx
import { useState } from "react"
import type { ReactNode } from "react"
import { queryStore, usePluginClient, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { QueryState } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type { Snapshot } from "./types"

const transientCodes = new Set(["INTERNAL", "UNAVAILABLE", "TRANSPORT", "TIMEOUT"])
export function useDispatchQuery<T>(intent: string, params?: Record<string, unknown>): QueryState<T> {
  const client = usePluginClient()
  const query = useQuery<T>(intent, params)
  const key = queryStore.keyOf(client.extension, intent, params)
  const [previous, setPrevious] = useState<{client: typeof client; key: string; data?: T}>({client, key})
  const same = previous.client === client && previous.key === key
  const retain = !query.error || transientCodes.has(query.error.code)
  const data = retain ? query.data ?? (same ? previous.data : undefined) : undefined
  if (!same || previous.data !== data) setPrevious({client, key, data})
  return {...query, data}
}

export function useLive(query: Pick<QueryState<unknown>, "refetch">, intervalMs: number) {
  usePoll(query.refetch, intervalMs)
}
function Poll({ query, intervalMs }: {query: Pick<QueryState<unknown>, "refetch">; intervalMs: number}) {
  useLive(query, intervalMs)
  return null
}
export function LiveStamp({ asOf, stale, retrying }: {asOf: string; stale: boolean; retrying: boolean}) {
  const parsed = new Date(asOf)
  const label = Number.isNaN(parsed.getTime()) ? asOf : parsed.toLocaleTimeString()
  return <span role="status" className={stale ? "text-xs text-warning-foreground" : "text-xs text-muted-foreground"}>
    {stale ? "Stale since " : "As of "}<time dateTime={asOf}>{label}</time>{stale && retrying ? ", retrying" : ""}
  </span>
}
export function Read<T extends Snapshot>({title, query, intervalMs = null, children}: {
  title: string
  query: QueryState<T>
  intervalMs?: number | null | ((data: T | undefined) => number | null)
  children: (data: T) => ReactNode
}) {
  const interval = typeof intervalMs === "function" ? intervalMs(query.data) : intervalMs
  const polling = interval !== null ? <Poll query={query} intervalMs={interval} /> : null
  if (query.data !== undefined) {
    return <div className="flex min-w-0 flex-col gap-3" aria-busy={query.loading}>
      {polling}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <LiveStamp asOf={query.data.asOf} stale={!!query.error} retrying={interval !== null} />
        <Button size="xs" variant="ghost" onClick={query.refetch} disabled={query.loading}>Refresh</Button>
      </div>
      <CommandAlert title="Refresh failed" error={query.error} />
      {children(query.data)}
    </div>
  }
  if (query.error?.code === "NOT_FOUND") {
    return <>{polling}<ZeroState title={title + " not found"} body="This resource may have been removed. Refresh to check again." action={<Button variant="outline" size="sm" onClick={query.refetch}>Refresh</Button>} /></>
  }
  return <>{polling}<QueryBoundary title={title} query={query} keepPreviousData>{children}</QueryBoundary></>
}
```

- [ ] Run package format, lint, typecheck and the relevant tests. Expected PASS. Inspect the formatting diff.
- [ ] Inspect branch and staged/concurrent scope. Commit owned paths: `feat(dispatch): retain stale reads with visible freshness`.

## Task 3: Add cursor navigation and confirmed actions

**Files:** `packages/plugin-dispatch/test/cursor.test.tsx`, `packages/plugin-dispatch/test/action.test.tsx`, `packages/plugin-dispatch/src/cursor.tsx`, `packages/plugin-dispatch/src/action.tsx`, `packages/plugin-dispatch/src/index.ts`.

- [ ] Add the tests below.

### `test/cursor.test.tsx`

```tsx
import { expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CursorPager, EmptyResults, useCursor } from "../src/cursor"

function Probe({filter, complete = true}: {filter: string; complete?: boolean}) {
  const paging = useCursor(filter)
  return <><p>Cursor: {paging.cursor ?? "start"}</p><CursorPager result={{complete, nextCursor: paging.cursor === null ? "next-page" : null}} paging={paging} loading={false} /></>
}
it("follows a cursor even when coverage is complete, supports back and resets after filters change", () => {
  const view = render(<Probe filter="all" />)
  fireEvent.click(screen.getByRole("button", {name: "Next"}))
  expect(screen.getByText("Cursor: next-page")).toBeTruthy()
  expect(screen.getByRole("button", {name: "Next"}).hasAttribute("disabled")).toBe(true)
  fireEvent.click(screen.getByRole("button", {name: "Previous"}))
  expect(screen.getByText("Cursor: start")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", {name: "Next"}))
  view.rerender(<Probe filter="failed" />)
  expect(screen.getByText("Cursor: start")).toBeTruthy()
})
it("allows continuation through an empty incomplete portion", () => {
  let continued = false
  render(<EmptyResults subject="jobs" filtered complete={false} onReset={() => {}} onRefresh={() => {}} onContinue={() => {continued = true}} />)
  expect(screen.getByRole("status").textContent).toContain("No results in this portion")
  fireEvent.click(screen.getByRole("button", {name: "Continue search"}))
  expect(continued).toBe(true)
})
it.each([[false, "No jobs yet", "Refresh"], [true, "No matching jobs", "Clear filters"]] as const)("distinguishes filtered=%s empty results", (filtered, title, action) => {
  render(<EmptyResults subject="jobs" filtered={filtered} complete onReset={() => {}} onRefresh={() => {}} />)
  expect(screen.getByText(title)).toBeTruthy()
  expect(screen.getByRole("button", {name: action})).toBeTruthy()
})
```

### `test/action.test.tsx`

```tsx
import { expect, it, vi } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { Action } from "../src/action"
import { clientFor, renderWithClient } from "./harness"

const props = {intent: "jobs.retry", payload: {id: "job-a"}, label: "Retry", title: "Retry job-a?", description: "Runs job-a again from the start on queue emails."}
it("requires confirmation, pins the described payload, and prevents duplicate pending commands", async () => {
  let finish!: (value: unknown) => void
  const send = vi.fn(() => new Promise(resolve => {finish = resolve}))
  const client = clientFor({}, {"jobs.retry": send})
  const done = vi.fn()
  const view = renderWithClient(<Action {...props} onSuccess={done} />, client)
  fireEvent.click(screen.getByRole("button", {name: "Retry"}))
  const dialog = screen.getByRole("alertdialog")
  expect(send).not.toHaveBeenCalled()
  view.rerender(<PluginProvider client={client}><Action {...props} payload={{id: "job-b"}} title="Retry job-b?" onSuccess={done} /></PluginProvider>)
  expect(within(dialog).getByText("Retry job-a?")).toBeTruthy()
  fireEvent.click(within(dialog).getByRole("button", {name: "Retry"}))
  fireEvent.click(within(dialog).getByRole("button", {name: "Working…"}))
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith({id: "job-a"})
  expect(within(dialog).getByRole("button", {name: "Cancel"}).hasAttribute("disabled")).toBe(true)
  await act(async () => finish({ok: true}))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  expect(done).toHaveBeenCalledWith({ok: true})
})
it("keeps failures inside the dialog and clears them when it is reopened", async () => {
  const client = clientFor({}, {"jobs.retry": () => {throw new ContractError("CONFLICT", "Job is already running")}})
  renderWithClient(<Action {...props} />, client)
  fireEvent.click(screen.getByRole("button", {name: "Retry"}))
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {name: "Retry"}))
  await screen.findByText("Job is already running")
  expect(within(screen.getByRole("alertdialog")).getByRole("alert").textContent).toContain("CONFLICT")
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", {name: "Cancel"}))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  fireEvent.click(screen.getByRole("button", {name: "Retry"}))
  expect(within(screen.getByRole("alertdialog")).queryByRole("alert")).toBeNull()
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch test -- test/cursor.test.tsx test/action.test.tsx`. Expected FAIL: the new behavior's module does not exist.
- [ ] Implement the following.

### `src/cursor.tsx`

```tsx
import { useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type { Page } from "./types"

export function useCursor(filterKey: string) {
  const [state, setState] = useState<{key: string; history: (string | null)[]}>({key: filterKey, history: [null]})
  const history = state.key === filterKey ? state.history : [null]
  if (state.key !== filterKey) setState({key: filterKey, history})
  return {
    cursor: history[history.length - 1], page: history.length,
    next: (cursor: string) => setState({key: filterKey, history: [...history, cursor]}),
    back: () => setState({key: filterKey, history: history.slice(0, -1).length ? history.slice(0, -1) : [null]}),
    reset: () => setState({key: filterKey, history: [null]}),
  }
}
export function CursorPager({ result, paging, loading }: {
  result: Pick<Page<unknown>, "nextCursor" | "complete">
  paging: ReturnType<typeof useCursor>
  loading: boolean
}) {
  return <nav aria-label="Cursor pages" className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
    <span>Page {paging.page}{!result.complete ? " · Search incomplete" : ""}</span>
    <div className="flex gap-2">
      <Button size="sm" variant="outline" disabled={loading || paging.page === 1} onClick={paging.back}>Previous</Button>
      <Button size="sm" variant="outline" disabled={loading || result.nextCursor === null} onClick={() => {if (result.nextCursor !== null) paging.next(result.nextCursor)}}>Next</Button>
    </div>
  </nav>
}
export function EmptyResults({ subject, filtered, complete, onReset, onRefresh, onContinue }: {
  subject: string; filtered: boolean; complete: boolean
  onReset: () => void; onRefresh: () => void; onContinue?: () => void
}) {
  return <ZeroState
    title={!complete ? "No results in this portion" : filtered ? "No matching " + subject : "No " + subject + " yet"}
    body={!complete ? "The search is incomplete. Continue through the remaining records." : filtered ? "Try changing or clearing the filters." : "New records will appear here when they are created."}
    action={<Button size="sm" variant="outline" onClick={!complete && onContinue ? onContinue : filtered ? onReset : onRefresh}>{!complete && onContinue ? "Continue search" : filtered ? "Clear filters" : "Refresh"}</Button>}
  />
}
```

### `src/action.tsx`

```tsx
import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

interface ActionProps<T> {
  intent: string; payload: unknown; label: string; title: string; description: ReactNode
  destructive?: boolean; disabled?: boolean; onSuccess?: (result: T) => void
}
export function Action<T>(props: ActionProps<T>) {
  return <ActionState key={props.intent} {...props} />
}
function ActionState<T>({ intent, payload, label, title, description, destructive = true, disabled = false, onSuccess }: ActionProps<T>) {
  const command = useCommand<T>(intent)
  const [confirmation, setConfirmation] = useState<{payload: unknown; label: string; title: string; description: ReactNode} | null>(null)
  const inFlight = useRef(false)
  async function confirm() {
    if (inFlight.current || !confirmation) return
    inFlight.current = true
    try {
      const result = await command.execute(confirmation.payload)
      if (result !== undefined) {setConfirmation(null); onSuccess?.(result)}
    } finally {inFlight.current = false}
  }
  return <>
    <Button size="sm" variant="outline" disabled={disabled || command.loading} onClick={() => {command.reset(); setConfirmation({payload, label, title, description})}}>{label}</Button>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(next) => {if (!next && !inFlight.current) setConfirmation(null)}} title={confirmation?.title ?? title} description={confirmation?.description} pending={command.loading} destructive={destructive} confirmLabel={confirmation?.label ?? label} onConfirm={() => {void confirm()}}>
      <CommandAlert title={(confirmation?.label ?? label) + " failed"} error={command.error} />
    </ConfirmDialog>
  </>
}
```

### `src/index.ts`

```tsx
export { Action } from "./action"
export { CronBadge, HeartbeatBadge, JobStateBadge, ReplayBadge, RunStateBadge } from "./badges"
export { CursorPager, EmptyResults, useCursor } from "./cursor"
export { LiveStamp, Read, useDispatchQuery, useLive } from "./read"
export type { Duration, JobState, Page, RunState, Snapshot } from "./types"
```

- [ ] Run package format, lint, typecheck and the relevant tests. Expected PASS. Inspect the formatting diff.
- [ ] Inspect branch and staged/concurrent scope. Commit owned paths: `feat(dispatch): add cursor navigation and confirmed actions`.

## Final verification

- [ ] Run package format, lint, typecheck and all tests. Expected PASS.
- [ ] Generate one complete review package, request one fresh read-only final review, and resolve consequential findings in one tested pass. No re-review.
- [ ] Record exact commands, results, rulings and browser limitations. Commit and push verified work.
