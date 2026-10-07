# Bastion Remaining Pages (slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the six old bastion pages that have no React home yet (traffic, circuits, health, services, API explorer, config) their pages in `packages/plugin-bastion`, with the circuit reset and OpenAPI refresh commands wired to buttons.

**Architecture:** React only. Every intent these pages read or send already exists in `bastion/extension/contract` and in `packages/fixture-server/bastion-fixtures.mjs`, and every response type already exists in `packages/plugin-bastion/src/types.ts`. Each page is one file under `src/pages/` with its own test file, written in the style of the existing overview, routes and upstreams pages. The discovery refresh button moves out of `routes.tsx` into a shared component so the services page can use it. A final task adds nav and routes, runs the click-through, and moves the six pages from Pending to Migrated in `bastion/MIGRATION.md`.

**Tech Stack:** React 19, TypeScript 6, vitest 5, `@forge-go/dashboard-kit`, `@forge-go/dashboard-plugin`.

**Spec:** `docs/superpowers/specs/2026-09-30-bastion-dashboard-migration-design.md` ("The React half": information architecture, liveness, badges, empty states).

**Repos:** `/Users/rexraphael/Work/xraph/forge-dashboard` (Tasks 1 to 7) and `/Users/rexraphael/Work/xraph/forgery/bastion` (`MIGRATION.md` only, Task 7). Both on `main`, no worktree.

## Global Constraints

- Plugin `extension: "bastion"`, `namespace: "bastion"`, label `Bastion` (the naming rule in `packages/plugin/src/names.ts`).
- Pages are plain components taking `params`; links go through `PluginLink` with scope-relative paths; reads use `useQuery`, writes use `useCommand`; refresh happens only through `meta.invalidates` and `usePoll`.
- Live pages poll with `usePoll(query.refetch)` from `@forge-go/dashboard-plugin`: traffic, health and circuits (overview already does).
- Unmeasured values say so and are never shown as 0: a `null` rate or latency renders "Not measured" in a stat and a `NoneCell` in a table.
- UI conventions: identifiers `font-mono text-xs`; the column an operator reads `font-medium`; every table caption carries a live count including zero; "none" is `NoneCell` or `TagList`; badges proportion first (healthy and closed `outline`, half-open `default`, unhealthy and open `destructive`, disabled `secondary`).
- Three empty states where they differ: nothing at all, nothing matching, and a switched-off subsystem (discovery off, OpenAPI off, circuit breaking off). A switched-off subsystem never reads as "nothing wrong".
- `ConfirmDialog`: plain-text `description`, and the command's `CommandAlert` as `children` (it must render inside the dialog). `pending` bound; the command's `reset()` runs when the dialog opens.
- Tests use `test/harness.tsx` (`stubClient`, `recordingCommandClient`, `failingClient`, `renderPage`); test files that open dialogs or click kit checkboxes need the jsdom PointerEvent shim used in `test/route-detail.test.tsx`.
- Gates per task: `pnpm --filter @forge-go/dashboard-plugin-bastion test`, `typecheck`, `lint`.
- Shared checkout. Edit existing files only with the Edit tool (no sed, no redirection, no rewrite scripts; read before you write). Never `git add -A`, `git checkout --`, `git stash`, `git reset --hard`, `git clean`. Commit with `git add <new files>` then `git commit --only <paths>`; confirm `git show --stat HEAD`.
- Commit messages: no em dashes, no Claude attribution, no `Co-Authored-By` trailer of any kind. No em dashes in comments or UI copy.

## Review Focus

- Circuit breaking switched off must not render as "No open circuits": the page says breakers are off and every target is ungated. Pinned in Task 2.
- A circuit reset on a target with no breaker yet answers NOT_FOUND; the message must show inside the dialog, and the Reset button must not be offered for an untracked or closed breaker at all. Pinned in Task 2.
- Discovery switched off must read differently from discovery that found nothing. Pinned in Task 4.
- OpenAPI configured but not running must read differently from OpenAPI off. Pinned in Task 5.
- A service with `protocols: []` or a `null` `discoveredAt` renders "none" cells, never a blank or a crash. Pinned in Task 4.

---

### Task 1: Traffic page

**Files:**
- Create: `src/pages/traffic.tsx`, `test/traffic.test.tsx`

**Interfaces:**
- Consumes: `TrafficStats`, `RouteTraffic` (types.ts), `formatCount`, `formatMs`, `formatPercent` (format.ts), `routePath` (keys.ts), `usePoll`.
- Produces: `export const BastionTrafficPage: ComponentType<PluginPageProps>`.

Behaviour: `useQuery<TrafficStats>("traffic.stats")` polled, boundary title `Traffic`. Header: title `Traffic`, description `Requests the gateway proxied since it started, and how each route is doing.` A `StatGrid`, in order:
- `Requests` (count), hint `N errors`
- `Latency` (avg) with hint `p99 X over the last N responses`, or `Not measured` with hint `No upstream has answered yet`
- `Rate limited` (count)
- `Circuit breaks` (count), hint `requests an open breaker refused`
- `Cache` value `H hits, M misses`, or `No lookups` when both are 0
- `Retries` value `Not measured` with hint `Nothing in the proxy retries` when `retriesMeasured` is false

A routes table, busiest first as the server sends it: Path (mono, `font-medium`, link via `routePath`), Requests, Errors, Error rate (`formatPercent`, `NoneCell label="error rate"` when null), Avg latency and p99 (`formatMs`, `NoneCell label="latency"` when null). Caption `N routes`. Empty message `No route has served traffic yet.`

- [ ] **Step 1: Write the failing test**

`test/traffic.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { BastionTrafficPage } from "../src/pages/traffic"
import type { TrafficStats } from "../src/types"
import { failingClient, renderPage, stubClient } from "./harness"

function stats(over: Partial<TrafficStats> = {}): TrafficStats {
  return {
    totalRequests: 3131, totalErrors: 114, rateLimited: 14, circuitBreaks: 37,
    cacheHits: 0, cacheMisses: 0, retriesMeasured: false,
    avgLatencyMs: 48.3, p99LatencyMs: 212, latencySamples: 4096,
    routes: [
      { routeId: "manual-/users", path: "/gw/users", totalRequests: 923, totalErrors: 3, errorRate: 0.325, avgLatencyMs: 18.1, p99LatencyMs: 40, latencySamples: 923 },
      { routeId: "farp-billing-http", path: "/billing/*", totalRequests: 55, totalErrors: 55, errorRate: 100, avgLatencyMs: null, p99LatencyMs: null, latencySamples: 0 },
    ],
    total: 2,
    ...over,
  }
}

function card(label: string): HTMLElement {
  return screen.getByText(label).closest("[data-slot='card']") as HTMLElement
}

describe("BastionTrafficPage", () => {
  it("shows gateway counters and says what is not measured", async () => {
    renderPage(BastionTrafficPage, stubClient({ "traffic.stats": stats() }))
    await screen.findByText("3,131")
    expect(within(card("Retries")).getByText("Not measured")).toBeTruthy()
    expect(within(card("Retries")).getByText("Nothing in the proxy retries")).toBeTruthy()
    expect(within(card("Cache")).getByText("No lookups")).toBeTruthy()
    expect(within(card("Latency")).getByText("48.3 ms")).toBeTruthy()
  })

  it("lists routes busiest first with encoded links and none for unmeasured latency", async () => {
    renderPage(BastionTrafficPage, stubClient({ "traffic.stats": stats() }))
    const link = await screen.findByRole("link", { name: "/gw/users" })
    expect(link.getAttribute("href")).toBe("/routes/manual-%2Fusers")
    const billing = screen.getByText("/billing/*").closest("tr") as HTMLElement
    expect(within(billing).getByText("100.0%")).toBeTruthy()
    expect(within(billing).getAllByLabelText("no latency").length).toBe(2)
    expect(screen.getByText("2 routes")).toBeTruthy()
  })

  it("says not measured for latency on an idle gateway and counts zero routes", async () => {
    renderPage(BastionTrafficPage, stubClient({
      "traffic.stats": stats({ totalRequests: 0, totalErrors: 0, avgLatencyMs: null, p99LatencyMs: null, latencySamples: 0, routes: [], total: 0 }),
    }))
    await screen.findByText("No route has served traffic yet.")
    expect(within(card("Latency")).getByText("Not measured")).toBeTruthy()
    expect(screen.getByText("0 routes")).toBeTruthy()
  })

  it("shows cache hits and misses when there were lookups", async () => {
    renderPage(BastionTrafficPage, stubClient({ "traffic.stats": stats({ cacheHits: 3, cacheMisses: 7 }) }))
    expect(await within(await screen.findByText("Cache").then((el) => el.closest("[data-slot='card']") as HTMLElement)).findByText("3 hits, 7 misses")).toBeTruthy()
  })

  it("renders the error card when the query fails", async () => {
    renderPage(BastionTrafficPage, failingClient(new ContractError("INTERNAL", "down")))
    expect(await screen.findByText(/Traffic unavailable/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- traffic`
Expected: FAIL, `../src/pages/traffic` does not resolve.

- [ ] **Step 3: Implement**

`src/pages/traffic.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { formatCount, formatMs, formatPercent } from "../format"
import { routePath } from "../keys"
import type { RouteTraffic, TrafficStats } from "../types"

const NOT_MEASURED = "Not measured"

const ms = (v: number | null) => formatMs(v) ?? <NoneCell label="latency" />

const columns: Column<RouteTraffic>[] = [
  {
    id: "path",
    header: "Path",
    className: "font-mono text-xs font-medium",
    cell: (r) => <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>,
  },
  { id: "requests", header: "Requests", align: "end", cell: (r) => formatCount(r.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (r) => formatCount(r.totalErrors) },
  {
    id: "errorRate",
    header: "Error rate",
    align: "end",
    cell: (r) => formatPercent(r.errorRate) ?? <NoneCell label="error rate" />,
  },
  { id: "avg", header: "Avg latency", align: "end", cell: (r) => ms(r.avgLatencyMs) },
  { id: "p99", header: "p99", align: "end", cell: (r) => ms(r.p99LatencyMs) },
]

function items(s: TrafficStats) {
  const latency = formatMs(s.avgLatencyMs)
  const lookups = s.cacheHits + s.cacheMisses
  return [
    { label: "Requests", value: formatCount(s.totalRequests), hint: `${formatCount(s.totalErrors)} errors` },
    latency == null
      ? { label: "Latency", value: NOT_MEASURED, hint: "No upstream has answered yet" }
      : {
          label: "Latency",
          value: latency,
          hint: `p99 ${formatMs(s.p99LatencyMs) ?? NOT_MEASURED} over the last ${formatCount(s.latencySamples)} responses`,
        },
    { label: "Rate limited", value: formatCount(s.rateLimited) },
    { label: "Circuit breaks", value: formatCount(s.circuitBreaks), hint: "requests an open breaker refused" },
    {
      label: "Cache",
      value: lookups === 0 ? "No lookups" : `${formatCount(s.cacheHits)} hits, ${formatCount(s.cacheMisses)} misses`,
    },
    s.retriesMeasured
      ? { label: "Retries", value: NOT_MEASURED }
      : { label: "Retries", value: NOT_MEASURED, hint: "Nothing in the proxy retries" },
  ]
}

export const BastionTrafficPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<TrafficStats>("traffic.stats")
  usePoll(query.refetch)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Traffic" description="Requests the gateway proxied since it started, and how each route is doing." />
      <QueryBoundary title="Traffic" query={query} skeletonRows={4}>
        {(s) => (
          <>
            <StatGrid items={items(s)} />
            <ResourceTable<RouteTraffic>
              columns={columns}
              rows={s.routes}
              rowKey={(r) => r.routeId}
              caption={`${s.total} ${s.total === 1 ? "route" : "routes"}`}
              emptyMessage="No route has served traffic yet."
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

`retriesMeasured` is always false today (the Go side has nothing that retries). The true branch still reads Not measured because the contract carries no retry count yet; when one is added, show it there.

- [ ] **Step 4: Run to verify it passes**

Run: the three gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/pages/traffic.tsx packages/plugin-bastion/test/traffic.test.tsx
git commit --only packages/plugin-bastion/src/pages/traffic.tsx packages/plugin-bastion/test/traffic.test.tsx -m "feat(bastion): traffic page"
```

---

### Task 2: Circuits page with reset

**Files:**
- Create: `src/pages/circuits.tsx`, `test/circuits.test.tsx`

**Interfaces:**
- Consumes: `CircuitsList`, `CircuitView`, `CircuitBadge`, `routePath`, `usePoll`, `Timestamp`, kit `ConfirmDialog`, `Button`, `CommandAlert`.
- Produces: `export const BastionCircuitsPage: ComponentType<PluginPageProps>`.

Behaviour: `useQuery<CircuitsList>("circuits.list")` polled, boundary title `Circuits`. Header title `Circuits`. When `enabled` is false, a `role="status"` paragraph `Circuit breaking is switched off in the gateway config, so every target is ungated.` above the table, and the description reads `Breakers are off.`; when true, the description reads `A target opens after F consecutive transport failures and is probed again after R s, H probes at a time.` from `failureThreshold`, `resetTimeoutSeconds`, `halfOpenMax`.

Table: Target URL (mono, `font-medium`), Routes (comma list of links), State (`CircuitBadge`, or a `secondary` badge `Not tracked` when `tracked` is false), Failures, Last failure (`Timestamp label="failure"`), Last change (`Timestamp label="state change"`), and an actions cell with a `Reset` button only when `tracked && state !== "closed"`. Caption `N targets`. Empty message `No targets. Add a route to give the gateway somewhere to send traffic.`

Reset opens a `ConfirmDialog` titled `Reset the breaker for ${url}?`, description `The breaker closes and the next request goes straight to this upstream. If it is still failing, the breaker opens again.`, confirm label `Reset`, `destructive={false}`, `pending`, `reset()` on open, and `<CommandAlert error={resetCmd.error} title="Could not reset the breaker" />` as children. Success closes the dialog and shows `role="status"` `Breaker reset for ${url}.`

- [ ] **Step 1: Write the failing test**

`test/circuits.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BastionCircuitsPage } from "../src/pages/circuits"
import type { CircuitsList, CircuitView } from "../src/types"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

// Base UI dialogs read PointerEvent, which jsdom lacks.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

function circuit(over: Partial<CircuitView> = {}): CircuitView {
  return {
    targetId: "9b2f/1", url: "http://orders-b:8080",
    routes: [{ routeId: "manual-/users", path: "/gw/users", targetId: "9b2f/1" }],
    tracked: true, state: "open", failureCount: 5,
    lastFailure: "2026-09-30T09:41:00Z", lastStateChange: "2026-09-30T09:41:00Z",
    ...over,
  }
}

function list(over: Partial<CircuitsList> = {}): CircuitsList {
  const circuits = over.circuits ?? [
    circuit(),
    circuit({ targetId: "t2", url: "http://users:8080", state: "closed", failureCount: 0 }),
    circuit({ targetId: "t3", url: "http://search:50051", tracked: false, state: "closed", failureCount: 0, lastFailure: null, lastStateChange: null }),
  ]
  return { enabled: true, failureThreshold: 5, resetTimeoutSeconds: 30, halfOpenMax: 3, circuits, total: circuits.length, ...over }
}

function row(text: string) {
  return screen.getByText(text).closest("tr") as HTMLElement
}

describe("BastionCircuitsPage", () => {
  it("states the breaker settings and badges each target", async () => {
    renderPage(BastionCircuitsPage, stubClient({ "circuits.list": list() }))
    await screen.findByText(/after 5 consecutive transport failures/)
    expect(within(row("http://orders-b:8080")).getByText("Open")).toBeTruthy()
    expect(within(row("http://search:50051")).getByText("Not tracked")).toBeTruthy()
    expect(within(row("http://search:50051")).getByLabelText("no failure")).toBeTruthy()
    expect(screen.getByText("3 targets")).toBeTruthy()
  })

  it("offers Reset only on a tracked breaker that is not closed", async () => {
    renderPage(BastionCircuitsPage, stubClient({ "circuits.list": list() }))
    await screen.findByText("http://orders-b:8080")
    expect(within(row("http://orders-b:8080")).getByRole("button", { name: "Reset" })).toBeTruthy()
    expect(within(row("http://users:8080")).queryByRole("button", { name: "Reset" })).toBeNull()
    expect(within(row("http://search:50051")).queryByRole("button", { name: "Reset" })).toBeNull()
  })

  it("does not read switched-off breakers as good news", async () => {
    renderPage(BastionCircuitsPage, stubClient({ "circuits.list": list({ enabled: false }) }))
    expect(await screen.findByText("Circuit breaking is switched off in the gateway config, so every target is ungated.")).toBeTruthy()
  })

  it("resets after a confirm and says so", async () => {
    const { client, sent } = recordingCommandClient({ "circuits.list": list() }, { "circuits.reset": { targetId: "9b2f/1", state: "closed" } })
    renderPage(BastionCircuitsPage, client)
    fireEvent.click(within(await screen.findByText("http://orders-b:8080").then((el) => el.closest("tr") as HTMLElement)).getByRole("button", { name: "Reset" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    expect(await screen.findByText("Breaker reset for http://orders-b:8080.")).toBeTruthy()
    expect(sent).toEqual([{ intent: "circuits.reset", payload: { targetId: "9b2f/1" } }])
  })

  it("shows a reset failure inside the dialog", async () => {
    const client = {
      extension: "bastion",
      query: async () => list(),
      command: async () => { throw new ContractError("NOT_FOUND", "this target has no circuit breaker yet; it gets one on its first proxied request") },
    } as unknown as ScopedClient
    renderPage(BastionCircuitsPage, client)
    fireEvent.click(within(await screen.findByText("http://orders-b:8080").then((el) => el.closest("tr") as HTMLElement)).getByRole("button", { name: "Reset" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }))
    expect(await within(dialog).findByText(/no circuit breaker yet/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- circuits`
Expected: FAIL, module does not resolve.

- [ ] **Step 3: Implement**

`src/pages/circuits.tsx`:

```tsx
import { Fragment, useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CircuitBadge } from "../badges"
import { routePath } from "../keys"
import type { CircuitView, CircuitsList } from "../types"

function describe(c: CircuitsList): string {
  if (!c.enabled) return "Breakers are off."
  return `A target opens after ${c.failureThreshold} consecutive transport failures and is probed again after ${c.resetTimeoutSeconds} s, ${c.halfOpenMax} probes at a time.`
}

export const BastionCircuitsPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<CircuitsList>("circuits.list")
  usePoll(query.refetch)
  const resetCmd = useCommand<{ targetId: string; state: string }>("circuits.reset")
  const [target, setTarget] = useState<CircuitView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function open(c: CircuitView) {
    // Reset at open: an error from an earlier attempt must not greet the operator.
    resetCmd.reset()
    setNotice(null)
    setTarget(c)
  }

  async function confirm() {
    if (!target) return
    const r = await resetCmd.execute({ targetId: target.targetId })
    if (r === undefined) return
    setNotice(`Breaker reset for ${target.url}.`)
    setTarget(null)
  }

  const columns: Column<CircuitView>[] = [
    { id: "url", header: "Target", className: "font-mono text-xs font-medium", cell: (c) => c.url },
    {
      id: "routes",
      header: "Routes",
      className: "font-mono text-xs",
      cell: (c) =>
        c.routes.map((r, i) => (
          <Fragment key={`${r.routeId}:${r.targetId}`}>
            {i > 0 && ", "}
            <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>
          </Fragment>
        )),
    },
    {
      id: "state",
      header: "State",
      cell: (c) => (c.tracked ? <CircuitBadge state={c.state} /> : <Badge variant="secondary">Not tracked</Badge>),
    },
    { id: "failures", header: "Failures", align: "end", cell: (c) => c.failureCount },
    { id: "lastFailure", header: "Last failure", cell: (c) => <Timestamp value={c.lastFailure ?? undefined} label="failure" /> },
    { id: "lastChange", header: "Last change", cell: (c) => <Timestamp value={c.lastStateChange ?? undefined} label="state change" /> },
    {
      id: "actions",
      header: "",
      align: "end",
      cell: (c) =>
        c.tracked && c.state !== "closed" ? (
          <Button variant="outline" onClick={() => open(c)}>
            Reset
          </Button>
        ) : null,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Circuits" query={query} skeletonRows={5}>
        {(c) => (
          <>
            <PageHeader title="Circuits" description={describe(c)} />
            {!c.enabled ? (
              <p role="status" className="text-sm text-muted-foreground">
                Circuit breaking is switched off in the gateway config, so every target is ungated.
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            ) : null}
            <ResourceTable<CircuitView>
              columns={columns}
              rows={c.circuits}
              rowKey={(x) => x.targetId}
              caption={`${c.total} ${c.total === 1 ? "target" : "targets"}`}
              emptyMessage="No targets. Add a route to give the gateway somewhere to send traffic."
            />
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && !resetCmd.loading && setTarget(null)}
        title={target ? `Reset the breaker for ${target.url}?` : "Reset the breaker?"}
        description="The breaker closes and the next request goes straight to this upstream. If it is still failing, the breaker opens again."
        confirmLabel="Reset"
        destructive={false}
        pending={resetCmd.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={resetCmd.error} title="Could not reset the breaker" />
      </ConfirmDialog>
    </section>
  )
}
```

The `Timestamp` `label` gives the "no <label>" accessible name the test reads. If `ResourceTable` rejects an empty `header`, use `"Actions"` and keep the cell as written.

- [ ] **Step 4: Run to verify it passes**

Run: the three gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/pages/circuits.tsx packages/plugin-bastion/test/circuits.test.tsx
git commit --only packages/plugin-bastion/src/pages/circuits.tsx packages/plugin-bastion/test/circuits.test.tsx -m "feat(bastion): circuits page with breaker reset"
```

---

### Task 3: Health page

**Files:**
- Create: `src/pages/health.tsx`, `test/health.test.tsx`

**Interfaces:**
- Consumes: `UpstreamsList`, `Upstream`, `ConfigDetail` (types.ts), `HealthBadge`, `CircuitBadge`, `routePath`, `formatCount`, `usePoll`, kit `DescriptionList`.
- Produces: `export const BastionHealthPage: ComponentType<PluginPageProps>`.

There is no health intent: the health monitor keeps no history and offers no manual probe (recorded in MIGRATION.md). The page reads `upstreams.list` (polled) for each upstream's health, sorted unhealthy first, and `config.detail` once for the health-check settings.

Behaviour: header title `Health`, description `Each upstream's last known health. Bastion probes on its own schedule; there is no manual check and no history.` A `Health checks` section: the `healthCheck` config section's settings as a `DescriptionList`, preceded by `EnabledBadge` for its `enabled` value; when the section is missing or `enabled` is false, a `role="status"` line `Active health checks are switched off, so health comes only from passive failures on proxied requests.`. A table of upstreams, unhealthy first then by URL: URL (mono, `font-medium`), Health, Circuit, Active connections, Requests, Errors, Routes (links). Caption `N upstreams`, with ` (U unhealthy)` appended when U > 0. Empty message `No upstreams. Add a route to give the gateway somewhere to send traffic.`

- [ ] **Step 1: Write the failing test**

`test/health.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionHealthPage } from "../src/pages/health"
import type { ConfigDetail, Upstream } from "../src/types"
import { renderPage, stubClient } from "./harness"

function up(over: Partial<Upstream> = {}): Upstream {
  return {
    url: "http://users:8080", healthy: true, circuitState: "closed", activeConns: 2,
    totalRequests: 923, totalErrors: 3, avgLatencyMs: 18.1,
    routes: [{ routeId: "manual-/users", path: "/gw/users", targetId: "t1" }],
    ...over,
  }
}

const CONFIG: ConfigDetail = {
  sections: [
    { id: "healthCheck", title: "Health checks", enabled: true, settings: [{ key: "Interval", value: "10s" }, { key: "Path", value: "/health" }] },
  ],
}

describe("BastionHealthPage", () => {
  it("puts unhealthy upstreams first and counts them in the caption", async () => {
    renderPage(BastionHealthPage, stubClient({
      "upstreams.list": { upstreams: [up(), up({ url: "http://billing:9000", healthy: false })], total: 2 },
      "config.detail": CONFIG,
    }))
    await screen.findByText("2 upstreams (1 unhealthy)")
    const rows = screen.getAllByRole("row").slice(1)
    expect(within(rows[0] as HTMLElement).getByText("http://billing:9000")).toBeTruthy()
    expect(within(rows[0] as HTMLElement).getByText("Unhealthy")).toBeTruthy()
  })

  it("shows the health check settings", async () => {
    renderPage(BastionHealthPage, stubClient({ "upstreams.list": { upstreams: [up()], total: 1 }, "config.detail": CONFIG }))
    expect(await screen.findByText("10s")).toBeTruthy()
    expect(screen.getByText("/health")).toBeTruthy()
  })

  it("says when active checks are off", async () => {
    renderPage(BastionHealthPage, stubClient({
      "upstreams.list": { upstreams: [up()], total: 1 },
      "config.detail": { sections: [{ ...CONFIG.sections[0]!, enabled: false }] },
    }))
    expect(await screen.findByText(/Active health checks are switched off/)).toBeTruthy()
  })

  it("counts zero upstreams", async () => {
    renderPage(BastionHealthPage, stubClient({ "upstreams.list": { upstreams: [], total: 0 }, "config.detail": CONFIG }))
    expect(await screen.findByText("0 upstreams")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- health`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/health.tsx`:

```tsx
import { Fragment } from "react"
import type { ComponentType } from "react"
import { PluginLink, usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { CircuitBadge, EnabledBadge, HealthBadge } from "../badges"
import { formatCount } from "../format"
import { routePath } from "../keys"
import type { ConfigDetail, Upstream, UpstreamsList } from "../types"

const columns: Column<Upstream>[] = [
  { id: "url", header: "URL", className: "font-mono text-xs font-medium", cell: (u) => u.url },
  { id: "health", header: "Health", cell: (u) => <HealthBadge healthy={u.healthy} /> },
  { id: "circuit", header: "Circuit", cell: (u) => <CircuitBadge state={u.circuitState} /> },
  { id: "active", header: "Active connections", align: "end", cell: (u) => formatCount(u.activeConns) },
  { id: "requests", header: "Requests", align: "end", cell: (u) => formatCount(u.totalRequests) },
  { id: "errors", header: "Errors", align: "end", cell: (u) => formatCount(u.totalErrors) },
  {
    id: "routes",
    header: "Routes",
    className: "font-mono text-xs",
    cell: (u) =>
      u.routes.map((r, i) => (
        <Fragment key={`${r.routeId}:${r.targetId}`}>
          {i > 0 && ", "}
          <PluginLink to={routePath(r.routeId)}>{r.path}</PluginLink>
        </Fragment>
      )),
  },
]

function HealthChecks({ config }: { config: ConfigDetail }) {
  const section = config.sections.find((s) => s.id === "healthCheck")
  if (!section || section.enabled === false) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Active health checks are switched off, so health comes only from passive failures on proxied requests.
      </p>
    )
  }
  return (
    <section aria-labelledby="checks-heading" className="flex flex-col gap-2">
      <h2 id="checks-heading" className="flex items-center gap-2 text-sm font-medium">
        Health checks <EnabledBadge enabled />
      </h2>
      <DescriptionList items={section.settings.map((s) => ({ term: s.key, value: <span className="font-mono text-xs">{s.value}</span> }))} />
    </section>
  )
}

export const BastionHealthPage: ComponentType<PluginPageProps> = () => {
  const ups = useQuery<UpstreamsList>("upstreams.list")
  usePoll(ups.refetch)
  const config = useQuery<ConfigDetail>("config.detail")

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Health"
        description="Each upstream's last known health. Bastion probes on its own schedule; there is no manual check and no history."
      />
      <QueryBoundary title="Health check settings" query={config} skeletonRows={2}>
        {(c) => <HealthChecks config={c} />}
      </QueryBoundary>
      <QueryBoundary title="Upstream health" query={ups} skeletonRows={5}>
        {(data) => {
          const rows = [...data.upstreams].sort(
            (a, b) => Number(a.healthy) - Number(b.healthy) || a.url.localeCompare(b.url),
          )
          const unhealthy = rows.filter((u) => !u.healthy).length
          const caption = `${data.total} ${data.total === 1 ? "upstream" : "upstreams"}${unhealthy > 0 ? ` (${unhealthy} unhealthy)` : ""}`
          return (
            <ResourceTable<Upstream>
              columns={columns}
              rows={rows}
              rowKey={(u) => u.url}
              caption={caption}
              emptyMessage="No upstreams. Add a route to give the gateway somewhere to send traffic."
            />
          )
        }}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: the three gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/pages/health.tsx packages/plugin-bastion/test/health.test.tsx
git commit --only packages/plugin-bastion/src/pages/health.tsx packages/plugin-bastion/test/health.test.tsx -m "feat(bastion): health page"
```

---

### Task 4: Services page, with a shared discovery refresh

**Files:**
- Create: `src/components/refresh-discovery.tsx`, `src/pages/services.tsx`, `test/services.test.tsx`
- Modify: `src/pages/routes.tsx` (use the shared component; behaviour unchanged)

**Interfaces:**
- Produces: `export function RefreshDiscovery(): JSX.Element` (button, alert and status line, exactly the routes page's current behaviour: `discovery.refresh`, `Refreshing…`, `Discovery refreshed.`, the `discoveryOff` message), and `export const BastionServicesPage: ComponentType<PluginPageProps>`.

Services behaviour: `useQuery<ServicesList>("services.list")`, boundary title `Services`. Header title `Services`, description `Services discovery found, and how many routes it built for each.`, actions `<RefreshDiscovery />`. Table: Name (mono, `font-medium`), Version (mono or `NoneCell label="version"`), Address (`address:port` mono), Protocols (`TagList label="protocols"` over `protocols ?? []`), Health, Routes (count), Discovered (`Timestamp label="discovery time"`, `value={discoveredAt ?? undefined}`), Metadata (`TagList label="metadata"`). Caption `N services`. Empty message: `discoveryEnabled` false gives `Discovery is switched off in the gateway config, so no services are found.`; true gives `Discovery found no services. Services appear here once they register over FARP or are found by a scan.`

- [ ] **Step 1: Write the failing test**

`test/services.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionServicesPage } from "../src/pages/services"
import type { ServiceView } from "../src/types"
import { renderPage, stubClient } from "./harness"

function svc(over: Partial<ServiceView> = {}): ServiceView {
  return {
    name: "billing", version: "2.4.1", address: "10.0.4.12", port: 9000, protocols: ["http"],
    healthy: false, routeCount: 1, discoveredAt: "2026-09-30T08:01:00Z", metadataKeys: ["team"], ...over,
  }
}

describe("BastionServicesPage", () => {
  it("lists services with address, health and a refresh button", async () => {
    renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: true, services: [svc()], total: 1 } }))
    const row = (await screen.findByText("billing")).closest("tr") as HTMLElement
    expect(within(row).getByText("10.0.4.12:9000")).toBeTruthy()
    expect(within(row).getByText("Unhealthy")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Refresh discovery" })).toBeTruthy()
    expect(screen.getByText("1 service")).toBeTruthy()
  })

  it("renders none for empty protocols, a missing version and an unknown discovery time", async () => {
    renderPage(BastionServicesPage, stubClient({
      "services.list": { discoveryEnabled: true, services: [svc({ protocols: [], version: "", discoveredAt: null, metadataKeys: [] })], total: 1 },
    }))
    const row = (await screen.findByText("billing")).closest("tr") as HTMLElement
    expect(within(row).getByLabelText("no protocols")).toBeTruthy()
    expect(within(row).getByLabelText("no version")).toBeTruthy()
    expect(within(row).getByLabelText("no discovery time")).toBeTruthy()
  })

  it("tells discovery off apart from discovery that found nothing", async () => {
    const { unmount } = renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: false, services: [], total: 0 } }))
    expect(await screen.findByText("Discovery is switched off in the gateway config, so no services are found.")).toBeTruthy()
    unmount()
    renderPage(BastionServicesPage, stubClient({ "services.list": { discoveryEnabled: true, services: [], total: 0 } }))
    expect(await screen.findByText(/Discovery found no services/)).toBeTruthy()
    expect(screen.getByText("0 services")).toBeTruthy()
  })
})
```

The existing `test/routes.test.tsx` discovery-refresh tests stay as they are and must keep passing after the refactor.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- services`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/components/refresh-discovery.tsx`: move, without changing behaviour or copy, the `useCommand("discovery.refresh")`, `refreshed` state, `refreshDiscovery()`, the `discoveryOff` error remap, the button, the `CommandAlert` and the status line out of `routes.tsx`:

```tsx
import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/** Rescans discovery. Used by the routes and services pages. */
export function RefreshDiscovery() {
  const refresh = useCommand<{ ok: boolean }>("discovery.refresh")
  const [refreshed, setRefreshed] = useState(false)

  async function run() {
    setRefreshed(false)
    const r = await refresh.execute()
    if (r !== undefined) setRefreshed(true)
  }

  const error =
    refresh.error?.code === "CONFLICT" && refresh.error.details?.reason === "discoveryOff"
      ? { code: refresh.error.code, message: "Discovery is switched off in the gateway config, so there is nothing to refresh." }
      : refresh.error

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" disabled={refresh.loading} onClick={() => void run()}>
        {refresh.loading ? "Refreshing…" : "Refresh discovery"}
      </Button>
      <CommandAlert title="Could not refresh discovery" error={error} />
      {refreshed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Discovery refreshed.
        </p>
      ) : null}
    </div>
  )
}
```

In `routes.tsx`, replace the moved code with `<RefreshDiscovery />` inside the header actions next to `<NewRouteLink />`, and drop imports that become unused. Read `routes.tsx` first: if the alert and status line currently render below the header rather than inside the actions, keep the routes page's layout by rendering `RefreshDiscovery` where the button was and check the routes tests still find `Discovery refreshed.` and the `discoveryOff` text.

`src/pages/services.tsx`:

```tsx
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { HealthBadge } from "../badges"
import { RefreshDiscovery } from "../components/refresh-discovery"
import type { ServiceView, ServicesList } from "../types"

const columns: Column<ServiceView>[] = [
  { id: "name", header: "Name", className: "font-mono text-xs font-medium", cell: (s) => s.name },
  {
    id: "version",
    header: "Version",
    className: "font-mono text-xs",
    cell: (s) => s.version || <NoneCell label="version" />,
  },
  { id: "address", header: "Address", className: "font-mono text-xs", cell: (s) => `${s.address}:${s.port}` },
  { id: "protocols", header: "Protocols", cell: (s) => <TagList values={s.protocols ?? []} label="protocols" /> },
  { id: "health", header: "Health", cell: (s) => <HealthBadge healthy={s.healthy} /> },
  { id: "routes", header: "Routes", align: "end", cell: (s) => s.routeCount },
  { id: "discovered", header: "Discovered", cell: (s) => <Timestamp value={s.discoveredAt ?? undefined} label="discovery time" /> },
  { id: "metadata", header: "Metadata", cell: (s) => <TagList values={s.metadataKeys ?? []} label="metadata" /> },
]

export const BastionServicesPage: ComponentType<PluginPageProps> = () => {
  const list = useQuery<ServicesList>("services.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Services"
        description="Services discovery found, and how many routes it built for each."
        actions={<RefreshDiscovery />}
      />
      <QueryBoundary title="Services" query={list} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ServiceView>
            columns={columns}
            rows={data.services}
            rowKey={(s) => s.name}
            caption={`${data.total} ${data.total === 1 ? "service" : "services"}`}
            emptyMessage={
              data.discoveryEnabled
                ? "Discovery found no services. Services appear here once they register over FARP or are found by a scan."
                : "Discovery is switched off in the gateway config, so no services are found."
            }
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: the three gates (the routes tests included).
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/components/refresh-discovery.tsx packages/plugin-bastion/src/pages/services.tsx packages/plugin-bastion/test/services.test.tsx
git commit --only packages/plugin-bastion/src/components/refresh-discovery.tsx packages/plugin-bastion/src/pages/services.tsx packages/plugin-bastion/test/services.test.tsx packages/plugin-bastion/src/pages/routes.tsx -m "feat(bastion): services page, sharing the discovery refresh with routes"
```

---

### Task 5: API explorer

**Files:**
- Create: `src/pages/api-explorer.tsx`, `test/api-explorer.test.tsx`

**Interfaces:**
- Consumes: `OpenAPISummary`, `SpecView`, `HealthBadge`, `formatCount`, `Timestamp`, `Button`, `CommandAlert`.
- Produces: `export const BastionApiExplorerPage: ComponentType<PluginPageProps>`.

Behaviour: `useQuery<OpenAPISummary>("openapi.summary")`, boundary title `API explorer`. Header title `API explorer`, description `The OpenAPI document bastion merges from the services it routes to.` Three states:
- `enabled` false: `role="status"` `OpenAPI aggregation is switched off in the gateway config.`, no table, no refresh button.
- `enabled` true and `running` false: `role="status"` `OpenAPI aggregation is configured but has not started on this gateway.`, no refresh button.
- running: a `StatGrid` with `Paths` (`formatCount(totalPaths)`), `Services` (`total`), `Last refresh` (the date via `new Date(lastRefresh).toLocaleString()`, or `Never`); a link `Open the merged spec` with `href={specPath}` (a plain `<a>`, since it is a gateway URL and not a dashboard page) and `target="_blank" rel="noreferrer"`; a `Refresh specs` button sending `openapi.refresh`; on success a `role="status"` `Refresh started. Specs update in the background, so check back in a moment.`; failures in a `CommandAlert` titled `Could not refresh specs`.

Services table: Service (mono, `font-medium`), Version (mono or `NoneCell`), Spec URL (mono), Health, Paths, Error (the `error` text in `text-destructive text-xs`, or `NoneCell label="error"`), Fetched (`Timestamp label="fetch time"`). Caption `N services`. Empty message `No service publishes an OpenAPI document yet.`

- [ ] **Step 1: Write the failing test**

`test/api-explorer.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, within } from "@testing-library/react"
import { BastionApiExplorerPage } from "../src/pages/api-explorer"
import type { OpenAPISummary } from "../src/types"
import { recordingCommandClient, renderPage, stubClient } from "./harness"

function summary(over: Partial<OpenAPISummary> = {}): OpenAPISummary {
  const services = over.services ?? [
    { serviceName: "billing", version: "2.4.1", specUrl: "http://billing:9000/openapi.json", healthy: false, pathCount: 0, error: "connection refused", fetchedAt: "2026-09-30T09:00:00Z" },
    { serviceName: "orders", version: "3.1.0", specUrl: "http://orders-a:8080/openapi.json", healthy: true, pathCount: 14, fetchedAt: "2026-09-30T09:00:00Z" },
  ]
  return { enabled: true, running: true, specPath: "/gateway/openapi.json", lastRefresh: "2026-09-30T09:00:00Z", totalPaths: 14, services, total: services.length, ...over }
}

describe("BastionApiExplorerPage", () => {
  it("summarises the merged spec, links it, and lists services", async () => {
    renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary() }))
    const link = await screen.findByRole("link", { name: "Open the merged spec" })
    expect(link.getAttribute("href")).toBe("/gateway/openapi.json")
    const billing = screen.getByText("billing").closest("tr") as HTMLElement
    expect(within(billing).getByText("connection refused")).toBeTruthy()
    expect(within(screen.getByText("orders").closest("tr") as HTMLElement).getByLabelText("no error")).toBeTruthy()
    expect(screen.getByText("2 services")).toBeTruthy()
  })

  it("starts a refresh and says it runs in the background", async () => {
    const { client, sent } = recordingCommandClient({ "openapi.summary": summary() }, { "openapi.refresh": { started: true } })
    renderPage(BastionApiExplorerPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Refresh specs" }))
    expect(await screen.findByText(/Refresh started/)).toBeTruthy()
    expect(sent[0]?.intent).toBe("openapi.refresh")
  })

  it("tells off apart from configured but not running, with no refresh button in either", async () => {
    const { unmount } = renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary({ enabled: false, running: false, services: [], total: 0 }) }))
    expect(await screen.findByText("OpenAPI aggregation is switched off in the gateway config.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh specs" })).toBeNull()
    unmount()
    renderPage(BastionApiExplorerPage, stubClient({ "openapi.summary": summary({ enabled: true, running: false, services: [], total: 0 }) }))
    expect(await screen.findByText("OpenAPI aggregation is configured but has not started on this gateway.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh specs" })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- api-explorer`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/api-explorer.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { HealthBadge } from "../badges"
import { formatCount } from "../format"
import type { OpenAPISummary, SpecView } from "../types"

const columns: Column<SpecView>[] = [
  { id: "service", header: "Service", className: "font-mono text-xs font-medium", cell: (s) => s.serviceName },
  { id: "version", header: "Version", className: "font-mono text-xs", cell: (s) => s.version || <NoneCell label="version" /> },
  { id: "spec", header: "Spec URL", className: "font-mono text-xs", cell: (s) => s.specUrl },
  { id: "health", header: "Health", cell: (s) => <HealthBadge healthy={s.healthy} /> },
  { id: "paths", header: "Paths", align: "end", cell: (s) => formatCount(s.pathCount) },
  {
    id: "error",
    header: "Error",
    cell: (s) => (s.error ? <span className="text-xs text-destructive">{s.error}</span> : <NoneCell label="error" />),
  },
  { id: "fetched", header: "Fetched", cell: (s) => <Timestamp value={s.fetchedAt ?? undefined} label="fetch time" /> },
]

export const BastionApiExplorerPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<OpenAPISummary>("openapi.summary")
  const refresh = useCommand<{ started: boolean }>("openapi.refresh")
  const [started, setStarted] = useState(false)

  async function run() {
    setStarted(false)
    const r = await refresh.execute()
    if (r !== undefined) setStarted(true)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="API explorer" description="The OpenAPI document bastion merges from the services it routes to." />
      <QueryBoundary title="API explorer" query={query} skeletonRows={4}>
        {(s) => {
          if (!s.enabled) {
            return (
              <p role="status" className="text-sm text-muted-foreground">
                OpenAPI aggregation is switched off in the gateway config.
              </p>
            )
          }
          if (!s.running) {
            return (
              <p role="status" className="text-sm text-muted-foreground">
                OpenAPI aggregation is configured but has not started on this gateway.
              </p>
            )
          }
          return (
            <>
              <StatGrid
                items={[
                  { label: "Paths", value: formatCount(s.totalPaths) },
                  { label: "Services", value: s.total },
                  { label: "Last refresh", value: s.lastRefresh ? new Date(s.lastRefresh).toLocaleString() : "Never" },
                ]}
              />
              <div className="flex flex-wrap items-center gap-3">
                <a href={s.specPath} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open the merged spec
                </a>
                <Button variant="outline" disabled={refresh.loading} onClick={() => void run()}>
                  {refresh.loading ? "Refreshing…" : "Refresh specs"}
                </Button>
              </div>
              <CommandAlert title="Could not refresh specs" error={refresh.error} />
              {started ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Refresh started. Specs update in the background, so check back in a moment.
                </p>
              ) : null}
              <ResourceTable<SpecView>
                columns={columns}
                rows={s.services}
                rowKey={(x) => x.serviceName}
                caption={`${s.total} ${s.total === 1 ? "service" : "services"}`}
                emptyMessage="No service publishes an OpenAPI document yet."
              />
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: the three gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/pages/api-explorer.tsx packages/plugin-bastion/test/api-explorer.test.tsx
git commit --only packages/plugin-bastion/src/pages/api-explorer.tsx packages/plugin-bastion/test/api-explorer.test.tsx -m "feat(bastion): API explorer with spec refresh"
```

---

### Task 6: Config page

**Files:**
- Create: `src/pages/config.tsx`, `test/config.test.tsx`

**Interfaces:**
- Consumes: `ConfigDetail`, `ConfigSection`, `EnabledBadge`, kit `DescriptionList`.
- Produces: `export const BastionConfigPage: ComponentType<PluginPageProps>`.

Behaviour: `useQuery<ConfigDetail>("config.detail")`, boundary title `Config`. Header title `Config`, description `The gateway's running configuration. Paths to keys and certificates show only as set or not set, and IP lists only as counts.` One `<section aria-labelledby>` per section in server order: an `h2` with the title and, when `enabled` is not null, an `EnabledBadge`; the `note` (when present) in a `role="note"` paragraph styled `text-sm text-muted-foreground`; a `DescriptionList` of settings, values in `font-mono text-xs`; a section with no settings shows `<NoneCell label="settings" />`.

- [ ] **Step 1: Write the failing test**

`test/config.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { BastionConfigPage } from "../src/pages/config"
import type { ConfigDetail } from "../src/types"
import { renderPage, stubClient } from "./harness"

const CONFIG: ConfigDetail = {
  sections: [
    { id: "retry", title: "Retry", enabled: true, note: "Nothing in the proxy calls the retry policy, so no request is retried whatever this says.", settings: [{ key: "Max attempts", value: "3" }] },
    { id: "tls", title: "Upstream TLS", enabled: false, settings: [{ key: "Client key", value: "set" }] },
    { id: "timeouts", title: "Timeouts", enabled: null, settings: [{ key: "Connect", value: "5s" }] },
    { id: "empty", title: "Empty", enabled: null, settings: [] },
  ],
}

function section(title: string) {
  return screen.getByRole("heading", { name: new RegExp(`^${title}`) }).closest("section") as HTMLElement
}

describe("BastionConfigPage", () => {
  it("shows each section with its switch, note and settings", async () => {
    renderPage(BastionConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByRole("heading", { name: /^Retry/ })
    expect(within(section("Retry")).getByText("Enabled")).toBeTruthy()
    expect(within(section("Retry")).getByRole("note").textContent).toMatch(/no request is retried/)
    expect(within(section("Upstream TLS")).getByText("Disabled")).toBeTruthy()
    expect(within(section("Upstream TLS")).getByText("set")).toBeTruthy()
  })

  it("shows no switch for a section without one, and none for a section without settings", async () => {
    renderPage(BastionConfigPage, stubClient({ "config.detail": CONFIG }))
    await screen.findByRole("heading", { name: /^Timeouts/ })
    expect(within(section("Timeouts")).queryByText(/Enabled|Disabled/)).toBeNull()
    expect(within(section("Empty")).getByLabelText("no settings")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- config`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/pages/config.tsx`:

```tsx
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { EnabledBadge } from "../badges"
import type { ConfigDetail, ConfigSection } from "../types"

function Section({ s }: { s: ConfigSection }) {
  const headingId = `config-${s.id}`
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2 rounded-lg border p-4">
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-medium">
        {s.title}
        {s.enabled === null ? null : <EnabledBadge enabled={s.enabled} />}
      </h2>
      {s.note ? (
        <p role="note" className="text-sm text-muted-foreground">
          {s.note}
        </p>
      ) : null}
      {s.settings.length === 0 ? (
        <NoneCell label="settings" />
      ) : (
        <DescriptionList
          items={s.settings.map((x) => ({ term: x.key, value: <span className="font-mono text-xs">{x.value}</span> }))}
        />
      )}
    </section>
  )
}

export const BastionConfigPage: ComponentType<PluginPageProps> = () => {
  const query = useQuery<ConfigDetail>("config.detail")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Config"
        description="The gateway's running configuration. Paths to keys and certificates show only as set or not set, and IP lists only as counts."
      />
      <QueryBoundary title="Config" query={query} skeletonRows={6}>
        {(c) => (
          <div className="grid gap-4 md:grid-cols-2">
            {c.sections.map((s) => (
              <Section key={s.id} s={s} />
            ))}
          </div>
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: the three gates.
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-bastion/src/pages/config.tsx packages/plugin-bastion/test/config.test.tsx
git commit --only packages/plugin-bastion/src/pages/config.tsx packages/plugin-bastion/test/config.test.tsx -m "feat(bastion): config page"
```

---

### Task 7: Nav and routes, click-through, MIGRATION.md

**Files:**
- Modify: `packages/plugin-bastion/src/index.tsx`, `packages/plugin-bastion/test/plugin.test.tsx`
- Modify: `/Users/rexraphael/Work/xraph/forgery/bastion/MIGRATION.md`

**Interfaces:**
- Consumes: the six page exports from Tasks 1 to 6.

- [ ] **Step 1: Update the plugin test (failing)**

In `test/plugin.test.tsx`, the routes assertion becomes:

```tsx
    expect(paths).toEqual([
      "/", "/routes", "/new-route", "/routes/:id", "/routes/:id/edit", "/upstreams",
      "/services", "/traffic", "/health", "/circuits", "/api-explorer", "/config",
    ])
```

and add:

```tsx
  it("groups the nav as the spec lays it out", () => {
    const groups = Object.fromEntries((bastionPlugin.nav ?? []).map((n) => [n.label, n.group]))
    expect(groups).toEqual({
      Overview: "Gateway",
      Routes: "Routing", Upstreams: "Routing", Services: "Routing",
      Traffic: "Traffic",
      Health: "Resilience", Circuits: "Resilience",
      "API explorer": "API",
      Config: "Settings",
    })
  })
```

Run: `pnpm --filter @forge-go/dashboard-plugin-bastion test -- plugin`
Expected: FAIL on both.

- [ ] **Step 2: Wire nav and routes**

In `src/index.tsx`, import and re-export the six pages, import `ActivityIcon`, `CodeIcon`, `HeartPulseIcon`, `NetworkIcon`, `SettingsIcon` and `ToggleLeftIcon` from `@forge-go/dashboard-kit/icons` (it re-exports lucide; if a name is missing, use the nearest lucide icon and say which), and set:

```tsx
  nav: [
    { label: "Overview", to: "/", priority: 0, icon: <HouseIcon />, group: "Gateway" },
    { label: "Routes", to: "/routes", priority: 10, icon: <RouteIcon />, group: "Routing" },
    { label: "Upstreams", to: "/upstreams", priority: 11, icon: <ServerIcon />, group: "Routing" },
    { label: "Services", to: "/services", priority: 12, icon: <NetworkIcon />, group: "Routing" },
    { label: "Traffic", to: "/traffic", priority: 20, icon: <ActivityIcon />, group: "Traffic" },
    { label: "Health", to: "/health", priority: 30, icon: <HeartPulseIcon />, group: "Resilience" },
    { label: "Circuits", to: "/circuits", priority: 31, icon: <ToggleLeftIcon />, group: "Resilience" },
    { label: "API explorer", to: "/api-explorer", priority: 40, icon: <CodeIcon />, group: "API" },
    { label: "Config", to: "/config", priority: 50, icon: <SettingsIcon />, group: "Settings" },
  ],
  routes: [
    { path: "/", element: BastionOverviewPage },
    { path: "/routes", element: BastionRoutesPage },
    { path: "/new-route", element: BastionRouteCreatePage },
    { path: "/routes/:id", element: BastionRouteDetailPage },
    { path: "/routes/:id/edit", element: BastionRouteEditPage },
    { path: "/upstreams", element: BastionUpstreamsPage },
    { path: "/services", element: BastionServicesPage },
    { path: "/traffic", element: BastionTrafficPage },
    { path: "/health", element: BastionHealthPage },
    { path: "/circuits", element: BastionCircuitsPage },
    { path: "/api-explorer", element: BastionApiExplorerPage },
    { path: "/config", element: BastionConfigPage },
  ],
```

Keep the existing comments on `/new-route` and `/routes/:id`.

- [ ] **Step 3: Gates and commit**

Run: the three gates and `pnpm -r --no-bail typecheck` (report failures outside plugin-bastion by name, do not fix them).

```bash
git commit --only packages/plugin-bastion/src/index.tsx packages/plugin-bastion/test/plugin.test.tsx -m "feat(bastion): put the six remaining pages in the nav"
```

- [ ] **Step 4: Click through**

`preview_start` `{name: "fixture-server"}` and `{name: "dashboard-shell"}`; bastion lives at `http://localhost:5173/@bastion/`. Check with `get_page_text` / `read_page`:
- The sidebar shows the nine entries in their groups.
- `/traffic`: Retries `Not measured`, the routes table busiest first.
- `/circuits`: breaker settings line, `orders-b` Open with a Reset button; Reset, confirm, the status line, and the row turns Closed after the invalidation.
- `/health`: `http://billing:9000` first and Unhealthy, the health-check settings or the switched-off line.
- `/services`: two services; `Refresh discovery` shows `Discovery refreshed.`
- `/api-explorer`: the merged-spec link, `Refresh specs` shows `Refresh started…`, billing's error text.
- `/config`: Retry and Response cache carry their notes; TLS shows `set`, never a path.
- `read_console_messages` with `onlyErrors: true` is empty.

Screenshot circuits and config. Stop both servers.

- [ ] **Step 5: MIGRATION.md (bastion repo)**

In `/Users/rexraphael/Work/xraph/forgery/bastion/MIGRATION.md`, change every row marked `Pending slice 4` to `Migrated` with the page and intent (`/traffic` `traffic.stats`; `/circuits` `circuits.list` and `circuits.reset`; `/health` `upstreams.list` and `config.detail`; `/services` `services.list` and `discovery.refresh`; `/api-explorer` `openapi.summary` and `openapi.refresh`; `/config` `config.detail`). Resolve the "Not classified" item about the circuits page's Active Conns: the health page shows active connections per upstream. Update the intro paragraph that says six pages have no React home, and the status legend if it still names slice 4. Grep the file for `slice 4` and `Pending` afterwards and expect no stale mentions. No em dashes.

Before writing that prose, invoke the `rex-voice` skill and follow it.

```bash
cd /Users/rexraphael/Work/xraph/forgery/bastion
git commit --only MIGRATION.md -m "docs: the last six pages are migrated"
```
