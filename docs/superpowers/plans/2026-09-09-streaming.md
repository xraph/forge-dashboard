# Streaming plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the streaming plugin from three read-only pages against three intents to seven pages covering all fourteen intents the contract declares, including its first writes.

**Architecture:** Every page reads through `useQuery` and renders inside kit's `QueryBoundary`, so no page invents its own loading or error state. Lists use kit's `ResourceTable`, destructive actions go through kit's `ConfirmDialog` with `pending` wired, and writes go through `useCommand` so the CSRF token and idempotency key are minted once in the client. Invalidation comes off the server's `meta.invalidates`, so no page calls `refetch()` to stay correct.

**Tech Stack:** React 19, TypeScript, react-router 7, vitest + @testing-library/react, `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-08-streaming-design.md`

**Also read before starting:**
- `docs/superpowers/specs/2026-09-08-platform-decisions.md`, what changed while the platform was built
- `docs/superpowers/plans/2026-09-08-kit-blocks-consumer-notes.md`, obligations the kit blocks put on a consuming page

## Global Constraints

- `extension` is `"streaming-contract"`, not `"streaming"`. It is the Go contributor name from `extensions/streaming/contract/manifest.yaml`. Get it wrong and `resolvePluginState` reports `hidden`: no routes, no nav, nothing logged. Do not change it.
- No dependency may be added to `packages/plugin-streaming/package.json`.
- Every destructive `ConfirmDialog` MUST receive `pending`. Without it the confirm button stays enabled and a fast double-click fires `onConfirm` twice. That applies to room delete and connection kick.
- Never call `refetch()` to reflect a write. The contract declares `invalidates` on every command and the store acts on it. A `refetch()` after a command is a sign the invalidation is being worked around.
- `params` objects may include `undefined` values freely; the store keys them the same as absent keys. `null` is a different request and keys differently.
- The plugin has no `<form>` wrappers around kit's `SettingsForm` (it uses none), but the same rule applies to any form: do not rely on a disabled button alone if an Enter key path exists.
- Timestamps come from Go `time.Time` and marshal to RFC 3339. Format them with kit's `formatTimestamp` from `@forge-go/dashboard-kit/lib/format`, never `new Date(...).toString()`.
- Tests live in `packages/plugin-streaming/test/` and run with `pnpm --filter @forge-go/dashboard-plugin-streaming test`.
- The test harness at `packages/plugin-streaming/test/harness.tsx` already resets `queryStore` in a `beforeEach`. Do not remove it: the store is a module-level singleton and without the reset one test's cache entry is served to the next.

## The contract, in full

Nine queries and five commands. Wire shapes from `extensions/streaming/contract/types.go`.

```ts
// stats
interface StatsResponse {
  totalConnections: number; totalRooms: number; totalChannels: number
  totalMessages: number; onlineUsers: number; messagesPerSec: number
  uptimeSeconds: number; memoryBytes: number
}
// connections.list -> { connections: ConnectionInfo[] }
interface ConnectionInfo {
  connID: string; userID: string; transport: string
  joinedRooms: string[]; subscriptions: string[]
  lastActivity: string; status: string
}
// rooms.list -> { rooms: RoomInfo[] }, rooms.detail({ id }) -> RoomInfo
interface RoomInfo {
  id: string; name: string; description: string; owner: string
  members: number; private: boolean; archived: boolean
  created: string; updated: string
}
// rooms.members({ id }) -> { members: MemberInfo[] }
interface MemberInfo {
  userID: string; role: string; joinedAt: string; permissions: string[]
}
// rooms.moderation({ id }) -> { entries: ModerationEntry[] }
interface ModerationEntry {
  timestamp: string; action: string; actorID: string
  targetID: string; reason: string; metadata?: Record<string, unknown>
}
// channels.list -> { channels: ChannelInfo[] }
interface ChannelInfo {
  id: string; name: string; subscriberCount: number; messageCount: number
}
// presence.list -> { presence: PresenceInfo[] }
interface PresenceInfo {
  userID: string; status: string; customStatus?: string
  lastSeen: string; rooms: string[]
}
// config -> ConfigSummary
interface ConfigSummary {
  backendType?: string; distributed: boolean; nodeID?: string
  features: Record<string, unknown>
  limits: Record<string, unknown>
  timeouts: Record<string, unknown>
}
// Every command answers CommandResult
interface CommandResult { ok: boolean; message?: string; id?: string }
// Command inputs
// rooms.create        { name, description, owner, private }
// rooms.delete        { id }
// rooms.send-message  { roomID, userID, content }
// presence.set        { userID, status }
// connections.kick    { connID, reason }
```

Note the casing: `connID`, `userID`, `roomID` carry a capitalised ID, while `RoomInfo.id` does not. That is what the Go structs declare, and a mismatch here sends a field the server ignores.

---

### Task 0: Give a plugin page its route params, without giving plugins a router

**Files:**
- Modify: `packages/plugin/src/types.ts`
- Modify: `packages/host/src/host/PluginHost.tsx`
- Test: `packages/host/test/route-params.test.tsx` (create)

**Interfaces:**
- Produces:
  - `PluginPageProps { params: Record<string, string | undefined> }`
  - `PluginRoute.element` becomes `ComponentType<PluginPageProps>`
  - Every page in every plugin may now declare `({ params }: PluginPageProps)` and read `params.id`.

**Why this exists, and why it is not just `useParams`.** Nine detail routes across the two remaining plans need the id from the URL: `/rooms/:id` here, and `/users/:id`, `/sessions/:id`, `/devices/:id`, `/roles/:id`, `/apps/:id`, `/environments/:id`, `/organizations/:id`, `/plans/:id` in authsome. Deep-linking to one of them is the point: an operator pastes a link to a user into a ticket.

The obvious answer is `useParams()` inside the page. Do not do that. No plugin package depends on react-router today, and that is deliberate rather than accidental: `packages/kit/src/components/nav-tree.tsx` says so in its own doc comment, that it never imports a router and takes `renderLink` instead, "which is what keeps `@forge-go/dashboard-kit` installable by consumers who do not use react-router". Adding react-router to every plugin package to read one string would trade that away.

The host already has the router. It reads the params and hands them down as an ordinary prop, so a plugin page stays a plain component that can be rendered in a test with no router at all.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/host/test/route-params.test.tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { definePlugin } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"

window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

function RoomDetail({ params }: PluginPageProps) {
  return <p>room {params.id}</p>
}

const plugin = definePlugin({
  extension: "streaming-contract",
  namespace: "streaming",
  label: "Streaming",
  nav: [{ label: "Rooms", to: "/rooms" }],
  routes: [
    { path: "/rooms", element: () => <p>rooms list</p> },
    { path: "/rooms/:id", element: RoomDetail },
  ],
})

function renderAt(path: string) {
  const fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        shellEnvelopes: ["v1"],
        contributors: [
          { name: "streaming-contract", envelopes: ["v1"], configured: true },
        ],
      }),
  } as unknown as Response)

  return render(
    <ForgeDashboardProvider config={{ basePath: "/dashboard" }}>
      <SessionProvider fetchImpl={fetchImpl}>
        <MemoryRouter initialEntries={[path]}>
          <PluginHost plugins={[plugin]} fetchImpl={fetchImpl} />
        </MemoryRouter>
      </SessionProvider>
    </ForgeDashboardProvider>,
  )
}

describe("route params", () => {
  it("hands a page the params from its own path", async () => {
    renderAt("/@streaming/rooms/r1")
    await waitFor(() => expect(screen.getByText("room r1")).toBeTruthy())
  })

  it("gives a page with no params an empty object rather than undefined", async () => {
    // A page that never declares a param must still be able to destructure
    // `params` without guarding, or every parameterless page needs a default.
    renderAt("/@streaming/rooms")
    await waitFor(() => expect(screen.getByText("rooms list")).toBeTruthy())
  })
})
```

Check the existing host tests for how they wrap `SessionProvider` and adapt this to match them exactly. Another session added session handling to `PluginHost`, so the wrapper here must be whatever `packages/host/test/subplugin-mount.test.tsx` already uses.

- [ ] **Step 2: Run it and confirm the first test fails**

Run: `pnpm --filter @forge-go/dashboard-host test route-params`
Expected: FAIL. `RoomDetail` renders "room undefined", because nothing passes `params`.

- [ ] **Step 3: Widen the type**

In `packages/plugin/src/types.ts`, above `PluginRoute`:

```ts
/**
 * What every plugin page receives.
 *
 * `params` is the route's own path parameters, already resolved by the host.
 * A page reads `params.id` rather than calling `useParams()`, and that is the
 * whole point: no plugin package depends on react-router, so a page stays a
 * plain component that a test can render with no router at all. The kit makes
 * the same trade for links, taking a `renderLink` prop instead of importing a
 * router.
 *
 * Always an object, never undefined, so a page can destructure it without a
 * guard even when its route declares no parameters.
 */
export interface PluginPageProps {
  params: Record<string, string | undefined>
}
```

and change `PluginRoute`:

```ts
export interface PluginRoute {
  path: string
  element: ComponentType<PluginPageProps>
}
```

A component declared as `() => <p>x</p>` still satisfies `ComponentType<PluginPageProps>`, because a component may ignore props it is given. So no existing page needs changing.

- [ ] **Step 4: Pass them from the host**

`PluginHost.tsx` renders route elements in two places: the host plugin's own routes and, from the sub-plugin task, each sub-plugin's routes. Both need this. React-router only exposes params through a hook, so add a small wrapper above the component:

```tsx
/**
 * Reads the route's params and hands them to a plugin page as a prop.
 *
 * A hook is the only way react-router exposes params, and a plugin page must
 * not call one, because no plugin package depends on react-router. So the host
 * calls it here, one level above the page, and the page stays a plain
 * component.
 */
function RouteParams({ page: Page }: { page: ComponentType<PluginPageProps> }) {
  const params = useParams()
  return <Page params={params} />
}
```

Add `useParams` to the existing `react-router` import and `PluginPageProps` to the type import from `@forge-go/dashboard-plugin`.

Then in BOTH route-rendering blocks, replace `<Page />` with `<RouteParams page={Page} />`. Leave every surrounding wrapper exactly as it is: the `PluginErrorBoundary`, the `PluginProvider`, and for sub-plugin routes the `HostAccessProvider` all stay in the same order and with the same keys.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-host test`
Expected: PASS, including both new tests and every pre-existing host test. Measure the count before you start and report before and after, since another session has been adding host tests.

- [ ] **Step 6: Typecheck both packages**

Run: `pnpm --filter @forge-go/dashboard-plugin typecheck && pnpm --filter @forge-go/dashboard-host typecheck`
Expected: clean. If a plugin package fails because a page's signature no longer matches, that is a real incompatibility and worth reporting rather than casting past.

- [ ] **Step 7: Commit**

```bash
git add packages/host/test/route-params.test.tsx
git commit -m "feat(plugin): hand a page its route params without giving plugins a router" -- packages/plugin/src/types.ts packages/host/src/host/PluginHost.tsx packages/host/test/route-params.test.tsx
```

Then `git show --stat HEAD` and confirm exactly those three files.

---

### Task 1: Move the existing pages onto the kit blocks

**Files:**
- Delete: `packages/plugin-streaming/src/components/query-view.tsx`
- Modify: `packages/plugin-streaming/src/pages/overview.tsx`
- Modify: `packages/plugin-streaming/src/pages/rooms.tsx`
- Modify: `packages/plugin-streaming/src/pages/connections.tsx`
- Modify: `packages/plugin-streaming/test/harness.tsx`
- Test: the three existing page test files must keep passing

**Interfaces:**
- Consumes: `QueryBoundary`, `CommandAlert` from `@forge-go/dashboard-kit/components/query-boundary`; `PageHeader` from `.../components/page-header`; `StatGrid` from `.../components/stat-grid`; `ResourceTable` and `type Column` from `.../components/resource-table`; `EmptyState` from `.../components/empty-state`; `formatTimestamp` from `@forge-go/dashboard-kit/lib/format`.
- Produces: nothing new. This task is a refactor that removes a duplicated file and puts every later task on one set of primitives.

Do this first. Every later task builds pages against these blocks, and doing the migration once here means the new pages are not written against a component that is about to be deleted.

`packages/plugin-streaming/src/components/query-view.tsx` is a hand-copied twin of the one in `plugin-authsome`. Kit now owns it. `QueryBoundary` has the same four states and the same props except that it has NO `empty` prop: emptiness belongs to `ResourceTable`, which takes `emptyMessage`.

- [ ] **Step 1: Let the harness send commands**

`harness.tsx`'s `stubClient` currently throws "the streaming plugin is read-only and sends no commands" from `command`. That stops being true in Task 3. Replace `stubClient` with a version taking both maps, keeping every existing behaviour:

```tsx
export function stubClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): ScopedClient {
  return {
    extension: "streaming-contract",
    query: async (intent: string) => {
      if (!(intent in answers)) {
        throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
      }
      return answers[intent]
    },
    // Same refusal as `query`, for the same reason: a command this map does not
    // hold is a typo in an intent name, and it should turn red rather than
    // resolve to undefined and look like a success.
    command: async (intent: string) => {
      if (!(intent in commands)) {
        throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      }
      return commands[intent]
    },
  } as ScopedClient
}
```

Add a helper the command tests will need, which records what was sent:

```tsx
/** Records every command a page sends, with its payload, in order. */
export function recordingCommandClient(
  answers: Record<string, unknown>,
  commands: Record<string, unknown> = {},
): { client: ScopedClient; sent: { intent: string; payload: unknown }[] } {
  const sent: { intent: string; payload: unknown }[] = []
  const inner = stubClient(answers, commands)
  return {
    sent,
    client: {
      extension: inner.extension,
      query: inner.query,
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}
```

Leave `failingClient`, `pendingClient`, `recordingClient` and `renderPage` exactly as they are, and leave the `beforeEach(() => queryStore.clear())` alone.

- [ ] **Step 2: Run the existing tests, which should still pass**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS. `stubClient`'s second parameter is optional, so every existing call site is unaffected.

- [ ] **Step 3: Rewrite overview.tsx against the kit blocks**

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"

/**
 * The `stats` query's wire shape, from `StatsResponse` in
 * `extensions/streaming/contract/types.go`. Every field is always present -
 * none of them carry `omitempty` - so none of them are optional here.
 */
export interface StreamingStats {
  totalConnections: number
  totalRooms: number
  totalChannels: number
  totalMessages: number
  onlineUsers: number
  messagesPerSec: number
  uptimeSeconds: number
  memoryBytes: number
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export function StreamingOverviewPage() {
  const query = useQuery<StreamingStats>("stats")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Streaming" description="Live connection and room counts for this node." />
      <QueryBoundary title="Streaming stats" query={query} skeletonRows={2}>
        {(stats) => (
          <StatGrid
            items={[
              { label: "Connections", value: stats.totalConnections },
              { label: "Rooms", value: stats.totalRooms },
              { label: "Channels", value: stats.totalChannels },
              { label: "Online users", value: stats.onlineUsers },
              { label: "Messages", value: stats.totalMessages },
              { label: "Messages / sec", value: stats.messagesPerSec },
              { label: "Uptime", value: formatUptime(stats.uptimeSeconds) },
              { label: "Memory", value: formatBytes(stats.memoryBytes) },
            ]}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Rewrite rooms.tsx against ResourceTable**

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `rooms.list`, from `RoomInfo` in the contract's types.go. */
export interface RoomInfo {
  id: string
  name: string
  description: string
  owner: string
  members: number
  private: boolean
  archived: boolean
  created: string
  updated: string
}

export interface RoomsList {
  rooms: RoomInfo[]
}

const columns: Column<RoomInfo>[] = [
  { id: "name", header: "Name", cell: (r) => r.name },
  { id: "owner", header: "Owner", cell: (r) => r.owner },
  { id: "members", header: "Members", cell: (r) => r.members, align: "end" },
  {
    id: "visibility",
    header: "Visibility",
    cell: (r) => (
      <Badge variant={r.private ? "secondary" : "outline"}>
        {r.private ? "private" : "public"}
      </Badge>
    ),
  },
  { id: "created", header: "Created", cell: (r) => formatTimestamp(r.created) },
]

export function StreamingRoomsPage() {
  const query = useQuery<RoomsList>("rooms.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Rooms" />
      <QueryBoundary title="Rooms" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<RoomInfo>
            columns={columns}
            // The Go handler builds this slice itself so it is never null on
            // the wire, but this page is rendered by a host that will hand it
            // whatever the server said. A missing array must not throw inside
            // a plugin's own render.
            rows={data.rooms ?? []}
            rowKey={(r) => r.id}
            caption="Rooms"
            emptyMessage="No rooms yet."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 5: Rewrite connections.tsx against ResourceTable**

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"

/** One row of `connections.list`, from `ConnectionInfo` in types.go. */
export interface ConnectionInfo {
  connID: string
  userID: string
  transport: string
  joinedRooms: string[]
  subscriptions: string[]
  lastActivity: string
  status: string
}

export interface ConnectionsList {
  connections: ConnectionInfo[]
}

const columns: Column<ConnectionInfo>[] = [
  { id: "userID", header: "User", cell: (c) => c.userID },
  {
    id: "connID",
    header: "Connection",
    cell: (c) => <span className="font-mono text-xs">{c.connID}</span>,
  },
  { id: "transport", header: "Transport", cell: (c) => c.transport },
  {
    id: "status",
    header: "Status",
    cell: (c) => <Badge variant="outline">{c.status}</Badge>,
  },
  {
    id: "rooms",
    header: "Rooms",
    cell: (c) => (c.joinedRooms ?? []).length,
    align: "end",
  },
  {
    id: "lastActivity",
    header: "Last activity",
    cell: (c) => formatTimestamp(c.lastActivity),
  },
]

export function StreamingConnectionsPage() {
  const query = useQuery<ConnectionsList>("connections.list")

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Connections" />
      <QueryBoundary title="Connections" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ConnectionInfo>
            columns={columns}
            rows={data.connections ?? []}
            rowKey={(c) => c.connID}
            caption="Connections"
            emptyMessage="No connections right now."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 6: Delete the duplicated component**

```bash
rm packages/plugin-streaming/src/components/query-view.tsx
```

If `src/components/` is now empty, remove the directory too. Check nothing else imports it:

Run: `grep -rn "query-view" packages/plugin-streaming/`
Expected: no matches.

- [ ] **Step 7: Update the three existing test files for the new markup**

The tests assert on rendered output, and `ResourceTable` renders a real table with a caption while the old hand-rolled markup did not. Adjust assertions to match what the blocks render. Do NOT weaken any assertion: if a test asserted "three rooms appear", it must still assert that. If a test asserted on a class name, replace it with a role or text query, which is what the rest of this repo does.

The empty-state text changes from whatever the old `EmptyState` said to the `emptyMessage` values above. Update the expected strings.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS, with the same number of tests as before this task. Report the count before and after; they should match.

- [ ] **Step 9: Commit**

```bash
git commit -m "refactor(streaming): move the pages onto the shared kit blocks" -- packages/plugin-streaming/src packages/plugin-streaming/test
```

Then `git show --stat HEAD` and confirm the deleted `query-view.tsx` and the four modified files, nothing else.

---

### Task 2: Online users on the overview

**Files:**
- Modify: `packages/plugin-streaming/src/pages/overview.tsx`
- Test: `packages/plugin-streaming/test/overview.test.tsx`

**Interfaces:**
- Consumes: `StreamingStats` from Task 1.
- Produces: `PresenceInfo`, `PresenceList` exported from `overview.tsx`, reused by Task 7's presence page. Define them here once.

The overview reads two intents. `stats` gives the counters; `presence.list` gives who is actually online, which is the thing an operator looks at the overview to find out.

- [ ] **Step 1: Write the failing test**

```tsx
// append to packages/plugin-streaming/test/overview.test.tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { StreamingOverviewPage } from "../src/pages/overview"

const stats = {
  totalConnections: 12, totalRooms: 3, totalChannels: 2, totalMessages: 900,
  onlineUsers: 2, messagesPerSec: 1.5, uptimeSeconds: 3700, memoryBytes: 2048,
}

describe("StreamingOverviewPage presence", () => {
  it("lists who is online alongside the counters", async () => {
    renderPage(
      StreamingOverviewPage,
      stubClient({
        stats,
        "presence.list": {
          presence: [
            { userID: "ada", status: "online", lastSeen: "2026-09-08T10:00:00Z", rooms: ["r1"] },
            { userID: "grace", status: "away", customStatus: "lunch", lastSeen: "2026-09-08T09:00:00Z", rooms: [] },
          ],
        },
      }),
    )

    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())
    expect(screen.getByText("grace")).toBeTruthy()
    // A custom status is the operator-supplied part and must survive.
    expect(screen.getByText("lunch")).toBeTruthy()
  })

  it("says so when nobody is online rather than rendering an empty table", async () => {
    renderPage(StreamingOverviewPage, stubClient({ stats, "presence.list": { presence: [] } }))
    await waitFor(() => expect(screen.getByText("Nobody is online.")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test overview`
Expected: FAIL. The page asks only for `stats`, so the harness throws NOT_FOUND for `presence.list` and the page renders its error card.

- [ ] **Step 3: Add the presence panel**

Add to `overview.tsx`, exporting the two types because Task 7 reuses them:

```tsx
/** One row of `presence.list`, from `PresenceInfo` in types.go. */
export interface PresenceInfo {
  userID: string
  status: string
  customStatus?: string
  lastSeen: string
  rooms: string[]
}

export interface PresenceList {
  presence: PresenceInfo[]
}

const presenceColumns: Column<PresenceInfo>[] = [
  { id: "userID", header: "User", cell: (p) => p.userID },
  {
    id: "status",
    header: "Status",
    cell: (p) => (
      <span className="flex items-center gap-2">
        <Badge variant="outline">{p.status}</Badge>
        {p.customStatus && (
          <span className="text-xs text-muted-foreground">{p.customStatus}</span>
        )}
      </span>
    ),
  },
  { id: "rooms", header: "Rooms", cell: (p) => (p.rooms ?? []).length, align: "end" },
  { id: "lastSeen", header: "Last seen", cell: (p) => formatTimestamp(p.lastSeen) },
]

function OnlineUsers() {
  const query = useQuery<PresenceList>("presence.list")
  return (
    <QueryBoundary title="Online users" query={query} skeletonRows={3}>
      {(data) => (
        <ResourceTable<PresenceInfo>
          columns={presenceColumns}
          rows={data.presence ?? []}
          rowKey={(p) => p.userID}
          caption="Online users"
          emptyMessage="Nobody is online."
        />
      )}
    </QueryBoundary>
  )
}
```

Render `<OnlineUsers />` after the `QueryBoundary` wrapping the stat grid, still inside the page's `<section>`. Add the imports it needs: `Badge`, `ResourceTable`, `type Column`, `formatTimestamp`.

`OnlineUsers` is a child component rather than a second `useQuery` in the page body for a reason worth keeping: two reads in one component means one `QueryBoundary` has to cover both, so a slow presence read would hide the counters that already arrived. Separate components means each renders as soon as its own answer lands.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test overview`
Expected: PASS, including the pre-existing overview tests.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(streaming): show who is online on the overview" -- packages/plugin-streaming/src/pages/overview.tsx packages/plugin-streaming/test/overview.test.tsx
```

---

### Task 3: Create and delete rooms

**Files:**
- Modify: `packages/plugin-streaming/src/pages/rooms.tsx`
- Test: `packages/plugin-streaming/test/rooms.test.tsx`

**Interfaces:**
- Consumes: `RoomInfo`, `RoomsList` from Task 1.
- Produces: `CommandResult` exported from `rooms.tsx`, reused by Tasks 4, 5 and 7. Define it here once:
  ```ts
  /** The uniform payload every streaming mutation answers. */
  export interface CommandResult { ok: boolean; message?: string; id?: string }
  ```

This is the plugin's first write. `rooms.create` declares `invalidates: [rooms.list, stats]` and `rooms.delete` the same, so a created room appears and the overview's counter moves without either page knowing the other exists. Do not call `refetch()`.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/plugin-streaming/test/rooms.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { renderPage, recordingCommandClient, stubClient } from "./harness"
import { StreamingRoomsPage } from "../src/pages/rooms"

const rooms = {
  rooms: [
    {
      id: "r1", name: "general", description: "", owner: "ada", members: 4,
      private: false, archived: false,
      created: "2026-09-01T10:00:00Z", updated: "2026-09-01T10:00:00Z",
    },
  ],
}

describe("StreamingRoomsPage writes", () => {
  it("sends rooms.create with exactly the fields the contract declares", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.create": { ok: true, id: "r2" } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("general")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New room" }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "random" } })
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "off topic" } })
    fireEvent.change(screen.getByLabelText("Owner"), { target: { value: "grace" } })
    fireEvent.click(screen.getByLabelText("Private"))
    fireEvent.click(screen.getByRole("button", { name: "Create room" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].intent).toBe("rooms.create")
    expect(sent[0].payload).toEqual({
      name: "random", description: "off topic", owner: "grace", private: true,
    })
  })

  it("will not submit a room with no name", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.create": { ok: true } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("general")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "New room" }))
    const create = screen.getByRole("button", { name: "Create room" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    expect(sent).toHaveLength(0)
  })

  it("confirms before deleting and names the room being deleted", async () => {
    const { client, sent } = recordingCommandClient(
      { "rooms.list": rooms },
      { "rooms.delete": { ok: true } },
    )
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("general")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete general" }))
    // Nothing is sent until the confirm is pressed.
    expect(sent).toHaveLength(0)
    expect(screen.getByText(/Delete “general”\?/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "rooms.delete", payload: { id: "r1" } })
  })

  it("surfaces the server's own sentence when a write fails", async () => {
    const client = stubClient({ "rooms.list": rooms })
    renderPage(StreamingRoomsPage, client)
    await waitFor(() => expect(screen.getByText("general")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Delete general" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))

    // stubClient was given no commands, so rooms.delete rejects NOT_FOUND.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("rooms.delete"),
    )
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test rooms`
Expected: FAIL. There is no "New room" button and no row actions.

- [ ] **Step 3: Add the create form and the delete action**

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

/** The uniform payload every streaming mutation answers. */
export interface CommandResult { ok: boolean; message?: string; id?: string }

function CreateRoomForm({ onDone }: { onDone: () => void }) {
  const create = useCommand<CommandResult>("rooms.create")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [owner, setOwner] = useState("")
  const [isPrivate, setPrivate] = useState(false)

  async function submit() {
    const result = await create.execute({ name, description, owner, private: isPrivate })
    // `execute` resolves with undefined on failure and never rejects, so this
    // is the success check. A failed create must not close the form and throw
    // away what the operator typed.
    if (result === undefined) return
    onDone()
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <CommandAlert error={create.error} title="Could not create the room" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-name">Name</Label>
        <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-description">Description</Label>
        <Input
          id="room-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="room-owner">Owner</Label>
        <Input id="room-owner" value={owner} onChange={(e) => setOwner(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="room-private">Private</Label>
        <Switch id="room-private" checked={isPrivate} onCheckedChange={setPrivate} />
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={create.loading || name.trim() === ""}>
          {create.loading ? "Creating…" : "Create room"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={create.loading}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
```

In `StreamingRoomsPage`, hold two pieces of state and wire the row action:

```tsx
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<RoomInfo | null>(null)
  const remove = useCommand<CommandResult>("rooms.delete")

  async function confirmDelete() {
    if (!pendingDelete) return
    const result = await remove.execute({ id: pendingDelete.id })
    // Close on success only. Leaving it open on failure keeps the error in
    // front of the person who caused it.
    if (result !== undefined) setPendingDelete(null)
  }
```

Give `PageHeader` an action, render the form when open, pass `rowActions` to the table, and render the dialog:

```tsx
      <PageHeader
        title="Rooms"
        actions={
          !creating && <Button onClick={() => setCreating(true)}>New room</Button>
        }
      />
      {creating && <CreateRoomForm onDone={() => setCreating(false)} />}
      <CommandAlert error={remove.error} title="Could not delete the room" />
      ...
          rowActions={(room) => (
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Delete ${room.name}`}
              onClick={() => setPendingDelete(room)}
            >
              Delete
            </Button>
          )}
      ...
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="Everyone in the room is disconnected from it. This cannot be undone."
        confirmLabel="Delete"
        // Required. Without it a double-click deletes twice.
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test rooms`
Expected: PASS, including the pre-existing rooms tests.

- [ ] **Step 5: Prove the invalidation is real, not worked around**

Run: `grep -n "refetch" packages/plugin-streaming/src/pages/rooms.tsx`
Expected: no matches. If there is one, the page is compensating for an invalidation that should be doing the work.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(streaming): create and delete rooms" -- packages/plugin-streaming/src/pages/rooms.tsx packages/plugin-streaming/test/rooms.test.tsx
```

---

### Task 4: Room detail

**Files:**
- Create: `packages/plugin-streaming/src/pages/room-detail.tsx`
- Modify: `packages/plugin-streaming/src/index.tsx`
- Test: `packages/plugin-streaming/test/room-detail.test.tsx` (create)

**Interfaces:**
- Consumes: `PluginPageProps` from Task 0; `RoomInfo`, `CommandResult` from Tasks 1 and 3.
- Produces: `StreamingRoomDetailPage`, plus `MemberInfo`, `MembersList`, `ModerationEntry`, `ModerationLog` exported from this file.

Three reads and one write on one page: `rooms.detail`, `rooms.members`, `rooms.moderation`, `rooms.send-message`. Each read gets its own `QueryBoundary` in its own child component, so a slow moderation log does not hide the room's own fields.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin-streaming/test/room-detail.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { recordingCommandClient, stubClient } from "./harness"
import { StreamingRoomDetailPage } from "../src/pages/room-detail"

const answers = {
  "rooms.detail": {
    id: "r1", name: "general", description: "everything", owner: "ada",
    members: 2, private: false, archived: false,
    created: "2026-09-01T10:00:00Z", updated: "2026-09-02T10:00:00Z",
  },
  "rooms.members": {
    members: [
      { userID: "ada", role: "owner", joinedAt: "2026-09-01T10:00:00Z", permissions: ["all"] },
      { userID: "grace", role: "member", joinedAt: "2026-09-02T10:00:00Z", permissions: [] },
    ],
  },
  "rooms.moderation": {
    entries: [
      {
        timestamp: "2026-09-03T10:00:00Z", action: "mute", actorID: "ada",
        targetID: "grace", reason: "spam",
      },
    ],
  },
}

/** Renders the page the way the host does, with params supplied as a prop. */
function renderDetail(client: Parameters<typeof PluginProvider>[0]["client"], id = "r1") {
  return render(
    <PluginProvider client={client}>
      <StreamingRoomDetailPage params={{ id }} />
    </PluginProvider>,
  )
}

describe("StreamingRoomDetailPage", () => {
  it("shows the room, its members and its moderation log", async () => {
    renderDetail(stubClient(answers))
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())
    expect(screen.getByText("everything")).toBeTruthy()
    expect(screen.getByText("ada")).toBeTruthy()
    expect(screen.getByText("grace")).toBeTruthy()
    expect(screen.getByText("mute")).toBeTruthy()
    expect(screen.getByText("spam")).toBeTruthy()
  })

  it("reads every intent scoped to the room in the URL", async () => {
    const { client, sent } = recordingCommandClient(answers, {})
    renderDetail(client, "r9")
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())
    // Nothing is asserted about `sent`; this test is about the reads carrying
    // the id. The recording client records commands, so use the query path.
    expect(sent).toHaveLength(0)
  })

  it("sends rooms.send-message with the room id from the route", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "rooms.send-message": { ok: true },
    })
    renderDetail(client, "r1")
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Send as"), { target: { value: "ada" } })
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello room" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "rooms.send-message",
      payload: { roomID: "r1", userID: "ada", content: "hello room" },
    })
  })

  it("will not send an empty message", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "rooms.send-message": { ok: true },
    })
    renderDetail(client)
    await waitFor(() => expect(screen.getByRole("heading", { name: "general" })).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Send as"), { target: { value: "ada" } })
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    expect(sent).toHaveLength(0)
  })

  it("says which room is missing rather than rendering a blank page", async () => {
    renderDetail(stubClient({}), "gone")
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })

  it("says so plainly when the route carries no id", async () => {
    render(
      <PluginProvider client={stubClient(answers)}>
        <StreamingRoomDetailPage params={{}} />
      </PluginProvider>,
    )
    expect(screen.getByText("No room selected.")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test room-detail`
Expected: FAIL, cannot resolve `../src/pages/room-detail`.

- [ ] **Step 3: Write the page**

```tsx
import { useState } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { RoomInfo } from "./rooms"
import type { CommandResult } from "./rooms"

/** One row of `rooms.members`, from `MemberInfo` in types.go. */
export interface MemberInfo {
  userID: string
  role: string
  joinedAt: string
  permissions: string[]
}
export interface MembersList {
  members: MemberInfo[]
}

/** One row of `rooms.moderation`, from `ModerationEntry` in types.go. */
export interface ModerationEntry {
  timestamp: string
  action: string
  actorID: string
  targetID: string
  reason: string
  metadata?: Record<string, unknown>
}
export interface ModerationLog {
  entries: ModerationEntry[]
}

const memberColumns: Column<MemberInfo>[] = [
  { id: "userID", header: "User", cell: (m) => m.userID },
  { id: "role", header: "Role", cell: (m) => <Badge variant="outline">{m.role}</Badge> },
  { id: "joinedAt", header: "Joined", cell: (m) => formatTimestamp(m.joinedAt) },
  {
    id: "permissions",
    header: "Permissions",
    cell: (m) => (m.permissions ?? []).join(", ") || "–",
  },
]

const moderationColumns: Column<ModerationEntry>[] = [
  { id: "timestamp", header: "When", cell: (e) => formatTimestamp(e.timestamp) },
  { id: "action", header: "Action", cell: (e) => e.action },
  { id: "actorID", header: "By", cell: (e) => e.actorID },
  { id: "targetID", header: "Target", cell: (e) => e.targetID },
  { id: "reason", header: "Reason", cell: (e) => e.reason || "–" },
]

function Members({ roomId }: { roomId: string }) {
  const query = useQuery<MembersList>("rooms.members", { id: roomId })
  return (
    <QueryBoundary title="Members" query={query} skeletonRows={3}>
      {(data) => (
        <ResourceTable<MemberInfo>
          columns={memberColumns}
          rows={data.members ?? []}
          rowKey={(m) => m.userID}
          caption="Members"
          emptyMessage="Nobody has joined this room."
        />
      )}
    </QueryBoundary>
  )
}

function Moderation({ roomId }: { roomId: string }) {
  const query = useQuery<ModerationLog>("rooms.moderation", { id: roomId })
  return (
    <QueryBoundary title="Moderation log" query={query} skeletonRows={3}>
      {(data) => (
        <ResourceTable<ModerationEntry>
          columns={moderationColumns}
          rows={data.entries ?? []}
          rowKey={(e) => `${e.timestamp}:${e.actorID}:${e.targetID}`}
          caption="Moderation log"
          emptyMessage="Nothing has been moderated in this room."
        />
      )}
    </QueryBoundary>
  )
}

function Composer({ roomId }: { roomId: string }) {
  const send = useCommand<CommandResult>("rooms.send-message")
  const [userID, setUserID] = useState("")
  const [content, setContent] = useState("")

  async function submit() {
    const result = await send.execute({ roomID: roomId, userID, content })
    // Clear on success only. Wiping the box after a failed send loses what the
    // operator typed and tells them nothing about why.
    if (result !== undefined) setContent("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <h2 className="text-sm font-medium">Send a message</h2>
      <CommandAlert error={send.error} title="Could not send the message" />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="send-as">Send as</Label>
        <Input id="send-as" value={userID} onChange={(e) => setUserID(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="send-content">Message</Label>
        <Input
          id="send-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <Button
        onClick={() => void submit()}
        disabled={send.loading || content.trim() === "" || userID.trim() === ""}
      >
        {send.loading ? "Sending…" : "Send"}
      </Button>
    </div>
  )
}

export function StreamingRoomDetailPage({ params }: PluginPageProps) {
  const roomId = params.id

  // A detail route reached without an id is a link somebody built wrong, not a
  // server state. Say so rather than issuing `rooms.detail` with an undefined
  // id and rendering whatever the server makes of that.
  if (!roomId) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No room selected.
      </p>
    )
  }

  return <RoomDetail roomId={roomId} />
}

function RoomDetail({ roomId }: { roomId: string }) {
  const query = useQuery<RoomInfo>("rooms.detail", { id: roomId })

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Room" query={query} skeletonRows={2}>
        {(room) => (
          <>
            <PageHeader title={room.name} description={room.description} />
            <DetailLayout
              main={
                <>
                  <DescriptionList
                    items={[
                      { term: "Owner", value: room.owner },
                      { term: "Members", value: room.members },
                      {
                        term: "Visibility",
                        value: (
                          <Badge variant={room.private ? "secondary" : "outline"}>
                            {room.private ? "private" : "public"}
                          </Badge>
                        ),
                      },
                      {
                        term: "Archived",
                        value: room.archived ? "yes" : "no",
                      },
                      { term: "Created", value: formatTimestamp(room.created) },
                      { term: "Updated", value: formatTimestamp(room.updated) },
                    ]}
                  />
                  <Members roomId={roomId} />
                  <Moderation roomId={roomId} />
                </>
              }
              aside={<Composer roomId={roomId} />}
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

`RoomDetail` is a child of `StreamingRoomDetailPage` rather than one component with an early return before the hook, because hooks cannot be called conditionally. Splitting the guard from the reads is what keeps `useQuery` off a `roomId` that does not exist.

- [ ] **Step 4: Register the route**

In `packages/plugin-streaming/src/index.tsx`, add the import and the route. No nav entry: a detail page is reached from the rooms list, and a sidebar link to "a room" with no room chosen would point nowhere.

```tsx
  routes: [
    { path: "/", element: StreamingOverviewPage },
    { path: "/rooms", element: StreamingRoomsPage },
    { path: "/rooms/:id", element: StreamingRoomDetailPage },
    { path: "/connections", element: StreamingConnectionsPage },
  ],
```

Also export the page and its types from the package, matching how the existing pages are exported at the top of that file.

- [ ] **Step 5: Link the list to the detail page**

In `rooms.tsx`, make the name column a link. The plugin has no router, so use the host-provided path shape directly: rows link to `/@streaming/rooms/${room.id}`.

```tsx
  {
    id: "name",
    header: "Name",
    cell: (r) => (
      <a href={`/@streaming/rooms/${r.id}`} className="underline underline-offset-4">
        {r.name}
      </a>
    ),
  },
```

A plain `<a>` costs a full page load rather than a client-side navigation. That is a known, accepted trade for now: giving plugins a router is the thing Task 0 exists to avoid, and a link that works with a reload beats no link. If client-side navigation matters later, the host can supply a `renderLink` the way kit's nav does.

Update the rooms test that asserts on the room name so it still passes: `screen.getByText("general")` still matches the link's text.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-streaming/src/pages/room-detail.tsx packages/plugin-streaming/test/room-detail.test.tsx
git commit -m "feat(streaming): room detail with members, moderation and a composer" -- packages/plugin-streaming/src packages/plugin-streaming/test
```

---

### Task 5: Kick a connection

**Files:**
- Modify: `packages/plugin-streaming/src/pages/connections.tsx`
- Test: `packages/plugin-streaming/test/connections.test.tsx`

**Interfaces:**
- Consumes: `ConnectionInfo`, `ConnectionsList` from Task 1; `CommandResult` from Task 3.

`connections.kick` takes `{ connID, reason }`. The reason is not optional in spirit: it is what the disconnected user is told, so the dialog asks for it.

- [ ] **Step 1: Write the failing tests**

```tsx
// append to packages/plugin-streaming/test/connections.test.tsx
describe("kicking a connection", () => {
  const answers = {
    "connections.list": {
      connections: [
        {
          connID: "c1", userID: "ada", transport: "websocket",
          joinedRooms: ["r1"], subscriptions: [],
          lastActivity: "2026-09-08T10:00:00Z", status: "active",
        },
      ],
    },
  }

  it("names the user, not just the connection id, before disconnecting them", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "connections.kick": { ok: true },
    })
    renderPage(StreamingConnectionsPage, client)
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Kick ada" }))
    // Connection ids are opaque. An operator must not have to trust that they
    // clicked the right row.
    const dialog = screen.getByText(/Disconnect ada\?/)
    expect(dialog).toBeTruthy()
    expect(screen.getByText(/websocket/)).toBeTruthy()
    expect(sent).toHaveLength(0)
  })

  it("sends connections.kick with the reason the operator gave", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "connections.kick": { ok: true },
    })
    renderPage(StreamingConnectionsPage, client)
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Kick ada" }))
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "abuse" } })
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "connections.kick",
      payload: { connID: "c1", reason: "abuse" },
    })
  })

  it("keeps the dialog open and shows why when the kick fails", async () => {
    renderPage(StreamingConnectionsPage, stubClient(answers))
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: "Kick ada" }))
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }))

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("connections.kick"),
    )
    expect(screen.getByText(/Disconnect ada\?/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test connections`
Expected: FAIL. There is no kick button.

- [ ] **Step 3: Add the kick action**

Add to `connections.tsx`:

```tsx
  const [pendingKick, setPendingKick] = useState<ConnectionInfo | null>(null)
  const [reason, setReason] = useState("")
  const kick = useCommand<CommandResult>("connections.kick")

  async function confirmKick() {
    if (!pendingKick) return
    const result = await kick.execute({ connID: pendingKick.connID, reason })
    if (result === undefined) return
    setPendingKick(null)
    setReason("")
  }
```

Row action and dialog:

```tsx
          rowActions={(c) => (
            <Button
              variant="destructive"
              size="sm"
              aria-label={`Kick ${c.userID}`}
              onClick={() => setPendingKick(c)}
            >
              Kick
            </Button>
          )}
```

```tsx
      <CommandAlert error={kick.error} title="Could not disconnect" />
      <ConfirmDialog
        open={pendingKick !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingKick(null)
            setReason("")
          }
        }}
        title={`Disconnect ${pendingKick?.userID ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Closes the {pendingKick?.transport} connection{" "}
              <span className="font-mono text-xs">{pendingKick?.connID}</span>.
              They can reconnect immediately.
            </span>
            <span className="flex flex-col gap-1.5">
              <Label htmlFor="kick-reason">Reason</Label>
              <Input
                id="kick-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </span>
          </span>
        }
        confirmLabel="Disconnect"
        pending={kick.loading}
        onConfirm={() => void confirmKick()}
      />
```

The transport and the connection id are in the description because a connection id alone identifies nothing a human recognises, and disconnecting the wrong person is not recoverable by undo.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test connections`
Expected: PASS, including the pre-existing connections tests.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(streaming): disconnect a connection, with a named reason" -- packages/plugin-streaming/src/pages/connections.tsx packages/plugin-streaming/test/connections.test.tsx
```

---

### Task 6: Channels and config

**Files:**
- Create: `packages/plugin-streaming/src/pages/channels.tsx`
- Create: `packages/plugin-streaming/src/pages/config.tsx`
- Modify: `packages/plugin-streaming/src/index.tsx`
- Test: `packages/plugin-streaming/test/channels.test.tsx`, `packages/plugin-streaming/test/config.test.tsx`

**Interfaces:**
- Produces: `StreamingChannelsPage`, `ChannelInfo`, `ChannelsList`; `StreamingConfigPage`, `ConfigSummary`.

Two read-only pages, batched because each is one table and neither needs its own review surface.

The config page is the interesting one. `ConfigSummary` carries three OPEN maps (`features`, `limits`, `timeouts`) and the server is free to add a key tomorrow. Render them by iterating the object, sorted by key, never as a hand-written field list. A hand-written list silently drops whatever it does not know about, which is the opposite of what a configuration page is for.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-streaming/test/channels.test.tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { StreamingChannelsPage } from "../src/pages/channels"

describe("StreamingChannelsPage", () => {
  it("lists channels with their subscriber and message counts", async () => {
    renderPage(
      StreamingChannelsPage,
      stubClient({
        "channels.list": {
          channels: [
            { id: "c1", name: "alerts", subscriberCount: 12, messageCount: 400 },
          ],
        },
      }),
    )
    await waitFor(() => expect(screen.getByText("alerts")).toBeTruthy())
    expect(screen.getByText("12")).toBeTruthy()
    expect(screen.getByText("400")).toBeTruthy()
  })

  it("says so when there are no channels", async () => {
    renderPage(StreamingChannelsPage, stubClient({ "channels.list": { channels: [] } }))
    await waitFor(() => expect(screen.getByText("No channels yet.")).toBeTruthy())
  })
})
```

```tsx
// packages/plugin-streaming/test/config.test.tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { StreamingConfigPage } from "../src/pages/config"

const config = {
  backendType: "redis",
  distributed: true,
  nodeID: "node-1",
  features: { presence: true, moderation: false },
  limits: { maxRooms: 100 },
  timeouts: { idle: "30s" },
}

describe("StreamingConfigPage", () => {
  it("shows the deployment's own fields", async () => {
    renderPage(StreamingConfigPage, stubClient({ config }))
    await waitFor(() => expect(screen.getByText("redis")).toBeTruthy())
    expect(screen.getByText("node-1")).toBeTruthy()
  })

  it("renders every key of the open maps, including ones it has never heard of", async () => {
    renderPage(
      StreamingConfigPage,
      stubClient({
        config: {
          ...config,
          // A key added by a newer server than this UI was written against.
          limits: { maxRooms: 100, maxWidgetsPerFrobnicator: 7 },
        },
      }),
    )
    await waitFor(() => expect(screen.getByText("maxRooms")).toBeTruthy())
    // The whole point of iterating rather than hand-listing.
    expect(screen.getByText("maxWidgetsPerFrobnicator")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()
  })

  it("says a map is empty rather than rendering a bare heading", async () => {
    renderPage(
      StreamingConfigPage,
      stubClient({ config: { ...config, timeouts: {} } }),
    )
    await waitFor(() => expect(screen.getByText("maxRooms")).toBeTruthy())
    expect(screen.getByText("No timeouts configured.")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and confirm both fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test channels config`
Expected: FAIL, neither module resolves.

- [ ] **Step 3: Write the channels page**

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"

/** One row of `channels.list`, from `ChannelInfo` in types.go. */
export interface ChannelInfo {
  id: string
  name: string
  subscriberCount: number
  messageCount: number
}
export interface ChannelsList {
  channels: ChannelInfo[]
}

const columns: Column<ChannelInfo>[] = [
  { id: "name", header: "Name", cell: (c) => c.name },
  {
    id: "subscriberCount",
    header: "Subscribers",
    cell: (c) => c.subscriberCount,
    align: "end",
  },
  { id: "messageCount", header: "Messages", cell: (c) => c.messageCount, align: "end" },
]

export function StreamingChannelsPage() {
  const query = useQuery<ChannelsList>("channels.list")
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Channels" />
      <QueryBoundary title="Channels" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<ChannelInfo>
            columns={columns}
            rows={data.channels ?? []}
            rowKey={(c) => c.id}
            caption="Channels"
            emptyMessage="No channels yet."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Write the config page**

```tsx
import { useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  DescriptionList,
  type DescriptionItem,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

/** From `ConfigSummary` in types.go. The three maps are deliberately open. */
export interface ConfigSummary {
  backendType?: string
  distributed: boolean
  nodeID?: string
  features: Record<string, unknown>
  limits: Record<string, unknown>
  timeouts: Record<string, unknown>
}

/**
 * Renders whatever keys a map happens to hold, sorted so the order does not
 * shift between reads.
 *
 * Iterating rather than hand-listing is the whole point. The server adds a
 * limit or a feature flag whenever it likes, and a page that named its fields
 * would drop the new one silently, which is precisely the failure a
 * configuration page exists to prevent.
 */
function OpenMap({ title, values }: { title: string; values: Record<string, unknown> }) {
  const entries = Object.entries(values ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {entries.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} configured.`} />
      ) : (
        <DescriptionList
          items={entries.map(
            ([key, value]): DescriptionItem => ({
              term: key,
              // Objects and arrays print as JSON rather than "[object Object]",
              // which tells an operator nothing about what the server sent.
              value:
                typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value),
            }),
          )}
        />
      )}
    </section>
  )
}

export function StreamingConfigPage() {
  const query = useQuery<ConfigSummary>("config")

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Configuration" description="How this streaming node is set up." />
      <QueryBoundary title="Configuration" query={query} skeletonRows={3}>
        {(config) => (
          <>
            <DescriptionList
              items={[
                { term: "Backend", value: config.backendType || "–" },
                { term: "Distributed", value: config.distributed ? "yes" : "no" },
                { term: "Node", value: config.nodeID || "–" },
              ]}
            />
            <OpenMap title="Features" values={config.features} />
            <OpenMap title="Limits" values={config.limits} />
            <OpenMap title="Timeouts" values={config.timeouts} />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

If `DescriptionItem` is not exported from `detail-layout.tsx`, export it there rather than inlining the type here, and say so in your report.

- [ ] **Step 5: Register both routes and their nav entries**

```tsx
  nav: [
    { label: "Overview", to: "/", priority: 10, icon: <LayoutGridIcon /> },
    { label: "Rooms", to: "/rooms", priority: 20, icon: <HouseIcon /> },
    { label: "Connections", to: "/connections", priority: 30, icon: <LinkIcon /> },
    { label: "Channels", to: "/channels", priority: 40, icon: <RadioIcon /> },
    { label: "Configuration", to: "/config", priority: 60, icon: <SettingsIcon /> },
  ],
```

Use icons that exist in `@forge-go/dashboard-kit/icons`. Check the export list first and pick the nearest match rather than inventing a name; a missing icon is a build error, not a runtime one. Priority 50 is left free for Task 7's presence page.

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS, all files.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-streaming/src/pages/channels.tsx packages/plugin-streaming/src/pages/config.tsx packages/plugin-streaming/test/channels.test.tsx packages/plugin-streaming/test/config.test.tsx
git commit -m "feat(streaming): channels and configuration pages" -- packages/plugin-streaming/src packages/plugin-streaming/test
```

---

### Task 7: Presence page and status override

**Files:**
- Create: `packages/plugin-streaming/src/pages/presence.tsx`
- Modify: `packages/plugin-streaming/src/index.tsx`
- Test: `packages/plugin-streaming/test/presence.test.tsx`

**Interfaces:**
- Consumes: `PresenceInfo`, `PresenceList` from Task 2; `CommandResult` from Task 3.
- Produces: `StreamingPresencePage`.

`presence.set` takes `{ userID, status }` and declares `invalidates: [presence.list, stats]`, so overriding a status refreshes both this page and the overview with no `refetch()`.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-streaming/test/presence.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { recordingCommandClient, renderPage, stubClient } from "./harness"
import { StreamingPresencePage } from "../src/pages/presence"

const answers = {
  "presence.list": {
    presence: [
      { userID: "ada", status: "online", lastSeen: "2026-09-08T10:00:00Z", rooms: ["r1"] },
    ],
  },
}

describe("StreamingPresencePage", () => {
  it("lists everyone with a presence record", async () => {
    renderPage(StreamingPresencePage, stubClient(answers))
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())
    expect(screen.getByText("online")).toBeTruthy()
  })

  it("sends presence.set with the user and the chosen status", async () => {
    const { client, sent } = recordingCommandClient(answers, {
      "presence.set": { ok: true },
    })
    renderPage(StreamingPresencePage, client)
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "Status for ada" }), {
      target: { value: "away" },
    })

    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toEqual({
      intent: "presence.set",
      payload: { userID: "ada", status: "away" },
    })
  })

  it("shows why an override failed and leaves the row alone", async () => {
    renderPage(StreamingPresencePage, stubClient(answers))
    await waitFor(() => expect(screen.getByText("ada")).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "Status for ada" }), {
      target: { value: "away" },
    })

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("presence.set"),
    )
  })

  it("says so when nobody has a presence record", async () => {
    renderPage(StreamingPresencePage, stubClient({ "presence.list": { presence: [] } }))
    await waitFor(() => expect(screen.getByText("No presence records.")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test presence`
Expected: FAIL, cannot resolve `../src/pages/presence`.

- [ ] **Step 3: Write the page**

```tsx
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import type { PresenceInfo, PresenceList } from "./overview"
import type { CommandResult } from "./rooms"

/**
 * The statuses an operator may set.
 *
 * The contract takes any string, so this list is a UI decision rather than a
 * constraint the server enforces. Keeping it short is the point: a free-text
 * status field on an admin page produces a hundred spellings of "away".
 */
const STATUSES = ["online", "away", "busy", "offline"]

export function StreamingPresencePage() {
  const query = useQuery<PresenceList>("presence.list")
  const setPresence = useCommand<CommandResult>("presence.set")

  const columns: Column<PresenceInfo>[] = [
    { id: "userID", header: "User", cell: (p) => p.userID },
    {
      id: "status",
      header: "Status",
      cell: (p) => (
        <NativeSelect
          aria-label={`Status for ${p.userID}`}
          value={p.status}
          disabled={setPresence.loading}
          onChange={(event) =>
            void setPresence.execute({ userID: p.userID, status: event.target.value })
          }
        >
          {/*
            The server's current value may be something this list does not
            hold. Render it anyway, or the select would silently show a
            different status from the one the user actually has.
          */}
          {(STATUSES.includes(p.status) ? STATUSES : [p.status, ...STATUSES]).map(
            (status) => (
              <NativeSelectOption key={status} value={status}>
                {status}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      ),
    },
    {
      id: "customStatus",
      header: "Custom",
      cell: (p) => p.customStatus || "–",
    },
    { id: "rooms", header: "Rooms", cell: (p) => (p.rooms ?? []).length, align: "end" },
    { id: "lastSeen", header: "Last seen", cell: (p) => formatTimestamp(p.lastSeen) },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Presence"
        description="Who is online, and an override for when the client gets it wrong."
      />
      <CommandAlert error={setPresence.error} title="Could not set the status" />
      <QueryBoundary title="Presence" query={query} skeletonRows={4}>
        {(data) => (
          <ResourceTable<PresenceInfo>
            columns={columns}
            rows={data.presence ?? []}
            rowKey={(p) => p.userID}
            caption="Presence"
            emptyMessage="No presence records."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

The columns are built inside the component rather than at module scope, because they close over `setPresence`. That is the one case where hoisting them would be wrong.

- [ ] **Step 4: Register the route and nav entry**

Add `{ path: "/presence", element: StreamingPresencePage }` to `routes`, and `{ label: "Presence", to: "/presence", priority: 50, icon: <UsersIcon /> }` to `nav`, using an icon that exists in the kit's icon exports.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-streaming/src/pages/presence.tsx packages/plugin-streaming/test/presence.test.tsx
git commit -m "feat(streaming): presence page with a status override" -- packages/plugin-streaming/src packages/plugin-streaming/test
```

---

### Task 8: Poll the live pages, and stop when nobody is looking

**Files:**
- Create: `packages/plugin-streaming/src/use-poll.ts`
- Modify: `packages/plugin-streaming/src/pages/overview.tsx`
- Modify: `packages/plugin-streaming/src/pages/connections.tsx`
- Modify: `packages/plugin-streaming/src/pages/presence.tsx`
- Test: `packages/plugin-streaming/test/use-poll.test.tsx` (create)

**Interfaces:**
- Produces: `usePoll(refetch: () => void, intervalMs?: number): void`

Streaming numbers move continuously, and a dashboard showing a five minute old connection count is worse than useless. But a dashboard left open on a second monitor overnight must not hold a query open eight thousand times, so polling stops while the tab is hidden.

This hook lives in `plugin-streaming` rather than in the plugin package. One consumer is not evidence of a shared abstraction, and the repo already made that call once with `query-view.tsx` and had to unmake it. The trigger for hoisting it is a second plugin needing it, which is the same rule.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin-streaming/test/use-poll.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { usePoll } from "../src/use-poll"

function Poller({ refetch, interval }: { refetch: () => void; interval?: number }) {
  usePoll(refetch, interval)
  return null
}

/** Drives document.visibilityState, which is a getter and not writable. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  })
  document.dispatchEvent(new Event("visibilitychange"))
}

describe("usePoll", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setHidden(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    setHidden(false)
  })

  it("refetches on the interval", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)
    expect(refetch).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it("defaults to ten seconds when no interval is given", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} />)
    vi.advanceTimersByTime(9999)
    expect(refetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("stops while the tab is hidden and resumes when it comes back", () => {
    const refetch = vi.fn()
    render(<Poller refetch={refetch} interval={1000} />)

    vi.advanceTimersByTime(2000)
    expect(refetch).toHaveBeenCalledTimes(2)

    setHidden(true)
    vi.advanceTimersByTime(5000)
    // Five intervals passed with nobody looking. None of them should have run.
    expect(refetch).toHaveBeenCalledTimes(2)

    setHidden(false)
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(3)
  })

  it("stops entirely once unmounted", () => {
    const refetch = vi.fn()
    const { unmount } = render(<Poller refetch={refetch} interval={1000} />)
    vi.advanceTimersByTime(1000)
    expect(refetch).toHaveBeenCalledTimes(1)

    unmount()
    vi.advanceTimersByTime(5000)
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("uses the latest refetch without restarting the interval", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<Poller refetch={first} interval={1000} />)

    vi.advanceTimersByTime(900)
    rerender(<Poller refetch={second} interval={1000} />)
    // The interval must not have been torn down and restarted by the new
    // function identity, or a page whose refetch changes every render never
    // reaches its own interval and never polls at all.
    vi.advanceTimersByTime(100)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test use-poll`
Expected: FAIL, cannot resolve `../src/use-poll`.

- [ ] **Step 3: Write the hook**

```tsx
import { useEffect, useRef } from "react"

/** Ten seconds. Slow enough to be cheap, fast enough that a count feels live. */
const DEFAULT_INTERVAL_MS = 10_000

/**
 * Calls `refetch` on an interval, and only while somebody is looking.
 *
 * Streaming counts move continuously, so a stale connection count is worse
 * than no connection count. The visibility half matters just as much: a
 * dashboard left open on a second monitor overnight would otherwise issue
 * eight thousand requests nobody reads.
 *
 * `refetch` is held in a ref rather than named in the effect's dependencies.
 * `useQuery` returns a new `refetch` identity whenever its inputs change, and
 * an effect that restarted on every new identity would clear the timer before
 * it ever fired, so a page that re-renders faster than its interval would
 * never poll at all. The ref keeps one timer and always calls the latest
 * function.
 */
export function usePoll(refetch: () => void, intervalMs: number = DEFAULT_INTERVAL_MS): void {
  const latest = useRef(refetch)
  latest.current = refetch

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer === undefined) {
        timer = setInterval(() => latest.current(), intervalMs)
      }
    }
    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
    const sync = () => {
      if (document.visibilityState === "hidden") stop()
      else start()
    }

    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      stop()
    }
  }, [intervalMs])
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test use-poll`
Expected: PASS, five tests.

- [ ] **Step 5: Poll the three live reads**

Add `usePoll(query.refetch)` to the overview's `stats` read, its `OnlineUsers` presence read, the connections page's read, and the presence page's read. Do NOT poll `rooms.list`, `channels.list`, `config` or any of the room-detail reads: rooms and channels change when somebody acts, not continuously, and configuration does not change at all while the page is open.

`refetch` forces past both the freshness check and any in-flight request, which is what a poll wants: the point is to reach the server.

- [ ] **Step 6: Run every streaming test**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test`
Expected: PASS. If a page test now sees extra requests because the poll fires during a `waitFor`, that is the poll working. Do not weaken the assertion: those tests use real timers and a ten second interval, so nothing should fire inside a test that finishes in milliseconds. If something does, say so rather than adjusting the number.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-streaming/src/use-poll.ts packages/plugin-streaming/test/use-poll.test.tsx
git commit -m "feat(streaming): poll the live pages, and stop while the tab is hidden" -- packages/plugin-streaming/src packages/plugin-streaming/test
```

---

### Task 9: Verify the plugin as a whole

**Files:**
- Modify: `packages/plugin-streaming/src/index.tsx` if anything is unexported
- Modify: whatever the checks turn up

- [ ] **Step 1: Confirm every intent the contract declares is used**

Run each and confirm a hit:

```bash
for i in stats connections.list rooms.list rooms.detail rooms.members rooms.moderation \
         channels.list presence.list config rooms.create rooms.delete \
         rooms.send-message presence.set connections.kick; do
  printf '%-22s %s\n' "$i" "$(grep -rl "\"$i\"" packages/plugin-streaming/src | tr '\n' ' ')"
done
```

Expected: every one of the fourteen names appears in at least one source file. An empty line is a missing page or a typo, and a typo here is invisible at runtime. The page just shows an error card.

- [ ] **Step 2: Run the whole streaming suite and typecheck**

Run: `pnpm --filter @forge-go/dashboard-plugin-streaming test && pnpm --filter @forge-go/dashboard-plugin-streaming typecheck && pnpm --filter @forge-go/dashboard-plugin-streaming lint`
Expected: all clean. Report the test count.

- [ ] **Step 3: Confirm no page compensates for invalidation**

Run: `grep -rn "refetch" packages/plugin-streaming/src`
Expected: matches ONLY inside `use-poll.ts` and the four `usePoll(query.refetch)` call sites. A `refetch()` after a command means a page is working around an invalidation the server already declares, and it should be removed rather than kept.

- [ ] **Step 4: Confirm every destructive dialog passes `pending`**

Run: `grep -rn "ConfirmDialog" -A 12 packages/plugin-streaming/src | grep -c "pending="`
Expected: one per `ConfirmDialog` in the source. There are two (room delete, connection kick). A dialog without `pending` lets a double-click fire the command twice.

- [ ] **Step 5: Confirm no dependency was added**

Run: `git diff --stat 22cf81b -- packages/plugin-streaming/package.json`
Expected: no output.

- [ ] **Step 6: Re-measure the bundle, because this plan is the first to import the kit blocks**

`ConfirmDialog` pulls `@base-ui/react/alert-dialog` and this plugin now imports it statically. `BASELINE.md` records the Base UI `CompositeRoot` chunk as lazy, and this is the commit where that can flip.

Run: `pnpm build && ls -la apps/playground/dist/assets`
Compare against the numbers `BASELINE.md` currently records and append a short section with the new figure and one sentence on what moved. If the workspace will not build for reasons outside `packages/plugin-streaming`, say so plainly and skip rather than reporting a number you cannot attribute.

- [ ] **Step 7: Commit anything the checks required**

```bash
git commit -m "chore(streaming): fixes from the whole-plugin verification" -- packages/plugin-streaming BASELINE.md
```

---

## Self-review

**Spec coverage.** The streaming spec lists seven routes. `/` is Tasks 1 and 2, `/rooms` Tasks 1 and 3, `/rooms/:id` Task 4, `/connections` Tasks 1 and 5, `/channels` Task 6, `/presence` Task 7, `/config` Task 6. All fourteen intents are covered and Task 9 Step 1 checks that mechanically rather than by eye. The spec's commands section (all five through `useCommand`, destructive ones behind `confirm-dialog`, invalidation from `meta.invalidates`) is Tasks 3, 4, 5 and 7, with Task 9 Steps 3 and 4 as the mechanical check. The spec's polling section is Task 8. The spec's timestamps section is satisfied by using kit's `formatTimestamp` everywhere, which Task 1 introduces.

**One addition the spec did not ask for.** Task 0 adds route params to the platform. The spec assumed `/rooms/:id` would just work; it would not, because no plugin package depends on react-router and the host passes route elements no props. It is here rather than in a separate plan because authsome needs it too and this plan runs first.

**Placeholder scan.** No TBD, no "handle errors appropriately", no "similar to Task N". Every code step carries its code. Task 6 Step 5 and Task 7 Step 4 tell the implementer to check the kit's icon exports rather than naming an icon I have not verified exists, which is a deliberate instruction rather than a placeholder.

**Type consistency.** `CommandResult` is defined once in Task 3's `rooms.tsx` and imported by Tasks 4, 5 and 7. `PresenceInfo`/`PresenceList` are defined once in Task 2's `overview.tsx` and imported by Task 7. `RoomInfo`/`RoomsList` come from Task 1 and are used by Tasks 3 and 4. `PluginPageProps` comes from Task 0 and is used by Task 4. `Column<T>`, `ResourceTable`, `QueryBoundary`, `CommandAlert`, `PageHeader`, `StatGrid`, `DescriptionList`, `DetailLayout`, `EmptyState`, `ConfirmDialog` and `formatTimestamp` all come from the kit blocks and are spelled the way that package exports them.
