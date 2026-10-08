# Dispatch Slice 4b: operational React pages

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render authoritative overview, queue, worker, handler and engine data using the completed shared read components.

**Architecture:** Typed DTOs mirror the committed Go contract. Pages use useDispatchQuery and Read for freshness; shared kit components provide compact tables, fields and status. The overview is eager and the other operational routes are lazy.

**Tech stack:** React, TypeScript, Forge dashboard kit/SDK, Vitest, Testing Library.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Constraints and interfaces

- Primary main checkout only. Preserve concurrent work. Format, lint, typecheck and test owned code before focused commits and normal pushes.
- Use the previously reviewed frontend design: compact header, freshness/action row, working table, concise sidebar. Inherit existing tokens and typography. Tables retain focusable horizontal scroll; detail columns stack on narrow screens.
- One fresh final review, no implementation delegation. The shared repo format sweep belongs to its coordinator; this package uses its documented format/lint scripts.
- Overview counts come from overview.summary. Do not infer system health. Links carry explicit state or queue filters.
- Queue counts come from the store. Polled status, rate/concurrency settings and active count are local to the serving process. Null active counts remain absent. Queue detail reads cursor-paged jobs with an explicit queue filter.
- Workers distinguish missing registry, empty registry, recent/silent/unknown heartbeat and clock skew. Remote intervals and resource leases are never inferred. Leader status comes from the authoritative contract projection.
- Handler details show every registered workflow version and job input/resource/lease/execution declarations. Matching-list links use namePrefix because that is the available contract filter.
- Engine settings are read-only and process-local. Requested operating-system limits do not establish enforcement. Use every returned configuration section without exposing unreturned environment or command-line secrets.
- All read failures, denied states and retained stale data use the foundation components. Missing capabilities use shared ZeroState with a working next action.
- Five-second polling: overview, queues, workers and queue jobs. Thirty-second polling: handlers. None: engine settings.
- This slice registers five navigation entries and nine operational routes. Remaining job/workflow/DLQ/cron/artifact routes are later slices. Delay host wiring until every required route exists so cross-resource links become reviewable together.
- Native tests prove projection and routing behavior, not browser parity. Desktop/narrow, fixtures and real SQLite browser checks remain required before templ retirement.
- Apply rex-voice and embedded humanizer to shipped prose.

## Review focus

- Missing worker/resource capabilities and unknown measurements must remain explicit.
- Worker leadership, heartbeat timing, local limits and requested execution settings must not acquire stronger claims than the backend supplies.
- Every queue job read must preserve its explicit queue and cursor; incomplete empty portions must retain continuation.
- Route names and encoded identity links must match the contract and planned host routes.
- All returned workflow versions and configuration sections must remain inspectable.


## Task 1: Implement the operational read pages

**Files:** `packages/plugin-dispatch/test/operational-fixtures.ts`, `packages/plugin-dispatch/test/operational-pages.test.tsx`, `packages/plugin-dispatch/src/contract.ts`, `packages/plugin-dispatch/src/components.tsx`, `packages/plugin-dispatch/src/pages/overview.tsx`, `packages/plugin-dispatch/src/pages/queues.tsx`, `packages/plugin-dispatch/src/pages/workers.tsx`, `packages/plugin-dispatch/src/pages/handlers.tsx`, `packages/plugin-dispatch/src/pages/config.tsx`.

- [ ] Add the tests below.

### `test/operational-fixtures.ts`

```tsx
import type { EngineConfig, HandlerDetail, JobCounts, JobRow, OverviewSummary, QueueRow, WorkerDetail, WorkerRow } from "../src/contract"
import type { Page } from "../src/types"
export const asOf="2026-10-08T18:00:00Z"
export const duration={text:"5s",ms:5000}
export const page=<T,>(items:T[]):Page<T>=>({items,nextCursor:null,complete:true,asOf})
export const counts:JobCounts={counts:{pending:4,running:2,completed:18,failed:1,retrying:0,cancelled:0},total:25,asOf}
export const overview:OverviewSummary={jobs:counts,runs:{running:2,completed:8,failed:1},unreplayedDeadLetters:3,crons:{enabled:2,disabled:1},workers:{enabled:true,recent:1,silent:1,unknown:0,leaderId:"worker-remote",silentAfter:duration},asOf}
export const queue:QueueRow={name:"email/bulk",counts:counts.counts,total:25,polledByThisProcess:false,localSettings:null,localActiveCount:null}
export const worker:WorkerRow={id:"worker-remote",hostname:"runner-2",queues:["email/bulk"],concurrency:4,state:"active",self:false,isLeader:true,leaderUntil:asOf,lastSeen:asOf,createdAt:asOf,heartbeatAge:duration,heartbeatInterval:null,heartbeatStatus:"recent",clockSkew:false,capacity:{cpu:4}}
export const workerDetail:WorkerDetail={enabled:true,worker,leaderId:worker.id,silentAfter:duration,resources:{enabled:false,capacity:{},free:{},reclaimable:{},leases:[]},asOf}
export const job:JobRow={id:"job-a",name:"send-email",queue:queue.name,state:"pending",priority:0,maxRetries:3,retryCount:0,workerId:null,scopeAppId:"app-a",scopeOrgId:null,createdAt:asOf,runAt:asOf,startedAt:null,completedAt:null}
export const handler:HandlerDetail={kind:"workflow",name:"image/normalize",versions:[1,4],inputCount:0,job:null,asOf}
export const config:EngineConfig={
 workerId:"worker-local",
 pool:{concurrency:4,queues:["emails"],pollInterval:duration,maxPollInterval:duration,jobHeartbeatInterval:duration,workerHeartbeatInterval:duration,workerStaleThreshold:duration,staleJobThreshold:duration,reapInterval:duration,defaultLeaseTtl:duration,storeCallTimeout:duration,shutdownTimeout:duration,storeCallsBounded:true,reapingEnabled:true,leasesEnabled:true},
 scheduler:{tickInterval:duration,leaderTtl:duration,refreshInterval:duration,lockTtl:duration,storeCallTimeout:duration,storeCallsBounded:true},
 queues:[],executors:[{name:"function",level:"function",default:true,subprocess:null}],
 resources:{enabled:false,defaults:{},queues:{},advertisedWorkerCapacity:{},customKeys:[],estimatorConfigured:false},
 artifacts:{enabled:false,backend:null,defaultBucket:null,cache:null},scratchRoot:"",wakeNotifierSupported:false,asOf
}
```

### `test/operational-pages.test.tsx`

```tsx
import { expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { OverviewPage } from "../src/pages/overview"
import { QueueDetailPage, QueuesPage } from "../src/pages/queues"
import { WorkerDetailPage, WorkersPage } from "../src/pages/workers"
import { HandlersPage, WorkflowHandlerPage } from "../src/pages/handlers"
import { EnginePage } from "../src/pages/config"
import { clientFor, renderWithClient } from "./harness"
import { asOf, config, duration, handler, job, overview, page, queue, worker, workerDetail } from "./operational-fixtures"

it("links authoritative overview counts without inferring health", async () => {
 renderWithClient(<OverviewPage />,clientFor({"overview.summary":()=>overview}))
 await screen.findByRole("heading",{name:"Operations"})
 expect(screen.getAllByRole("link",{name:"failed 1"}).map(link=>link.getAttribute("href"))).toContain("/jobs?states=failed")
 expect(screen.getByRole("link",{name:"3 unreplayed"}).getAttribute("href")).toBe("/dlq")
 expect(screen.queryByText(/healthy/i)).toBeNull()
 expect(screen.getByText(/Counts come from the store/)).toBeTruthy()
})
it("labels unknown queue measurements and encodes queue paths",async()=>{
 renderWithClient(<QueuesPage />,clientFor({"queues.list":()=>({...page([queue]),workerDiscoveryEnabled:false})}))
 const link=await screen.findByRole("link",{name:queue.name})
 expect(link.getAttribute("href")).toBe("/queues/email%2Fbulk")
 expect(screen.getByLabelText("no local active count")).toBeTruthy()
 expect(screen.getByText(/Historical queue names/)).toBeTruthy()
})
it("reads queue jobs with an explicit queue filter and follows incomplete cursor portions",async()=>{
 const read=vi.fn((params:unknown)=>(params as {cursor:string}).cursor? page([job]):{...page([]),complete:false,nextCursor:"resume"})
 renderWithClient(<QueueDetailPage params={{name:queue.name}} />,clientFor({"queues.get":()=>({...queue,asOf}),"jobs.list":read}))
 await screen.findByText("No results in this portion")
 fireEvent.click(screen.getByRole("button",{name:"Continue search"}))
 await screen.findByRole("link",{name:job.id})
 expect(read).toHaveBeenLastCalledWith({queue:queue.name,cursor:"resume",limit:25})
})
it("distinguishes an absent worker registry from an empty registry",async()=>{
 renderWithClient(<WorkersPage />,clientFor({"workers.list":()=>({...page([]),enabled:false,leaderId:null,heartbeatReference:null,silentAfter:null})}))
 await screen.findByText("Worker registry not configured")
 expect(screen.getByRole("link",{name:"Inspect engine settings"}).getAttribute("href")).toBe("/config")
 expect(screen.queryByRole("table")).toBeNull()
})
it("shows recorded worker heartbeat and leadership without local lease claims",async()=>{
 renderWithClient(<WorkerDetailPage params={{id:worker.id}} />,clientFor({"workers.get":()=>workerDetail}))
 await screen.findByText("Recent heartbeat")
 expect(screen.getByText("Leader")).toBeTruthy()
 expect(screen.getByText("Not recorded for remote workers")).toBeTruthy()
 expect(screen.getByText(/only for the process serving this page/)).toBeTruthy()
 expect(screen.queryByRole("heading",{name:"Local capacity"})).toBeNull()
})
it("shows local resource leases when measured by the serving worker",async()=>{
 renderWithClient(<WorkerDetailPage params={{id:worker.id}} />,clientFor({"workers.get":()=>({...workerDetail,worker:{...worker,self:true,heartbeatInterval:duration},resources:{enabled:true,capacity:{cpu:4},free:{cpu:2},reclaimable:{cpu:1},leases:[{owner:"job-owner",held:{cpu:2},acquiredAt:asOf}]}})}))
 await screen.findByText("job-owner")
 expect(screen.getByRole("heading",{name:"Free"})).toBeTruthy()
 expect(screen.getByRole("heading",{name:"Reclaimable"})).toBeTruthy()
})
it("lists all workflow versions with an encoded handler link",async()=>{
 renderWithClient(<HandlersPage />,clientFor({"handlers.list":()=>page([handler])}))
 const link=await screen.findByRole("link",{name:handler.name})
 expect(link.getAttribute("href")).toBe("/handlers/workflows/image%2Fnormalize")
 expect(screen.getByText("1, 4")).toBeTruthy()
})
it("queries a workflow definition with its exact kind and name",async()=>{
 const read=vi.fn(()=>handler)
 renderWithClient(<WorkflowHandlerPage params={{name:handler.name}} />,clientFor({"handlers.get":read}))
 await screen.findByText("1, 4")
 expect(read).toHaveBeenCalledWith({kind:"workflow",name:handler.name})
 expect(screen.getByRole("link",{name:"Browse matching runs"}).getAttribute("href")).toBe("/workflows?namePrefix=image%2Fnormalize")
})
it("shows process settings and qualifies requested execution limits",async()=>{
 renderWithClient(<EnginePage />,clientFor({"engine.config":()=>config}))
 await screen.findByRole("heading",{name:"Pool and polling"})
 expect(screen.getByText(/do not prove enforcement/)).toBeTruthy()
 expect(screen.getByRole("heading",{name:"Artifacts"})).toBeTruthy()
 expect(screen.getByText("Not supported")).toBeTruthy()
 await waitFor(()=>expect(screen.queryByRole("alert")).toBeNull())
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch exec vitest run test/operational-pages.test.tsx`. Expected FAIL: the operational page modules do not exist.
- [ ] Implement the following.

### `src/contract.ts`

```tsx
import type { Duration, JobState, Page, RunState } from "./types"

export interface WorkerRow {
  id: string
  hostname: string | null
  queues: (string)[]
  concurrency: number
  state: string
  self: boolean
  isLeader: boolean
  leaderUntil: string | null
  lastSeen: string | null
  createdAt: string | null
  heartbeatAge: Duration | null
  heartbeatInterval: Duration | null
  heartbeatStatus: "unknown" | "recent" | "silent"
  clockSkew: boolean
  capacity: Record<string, number>
}
export interface WorkersPage extends Page<WorkerRow> {
  enabled: boolean
  leaderId: string | null
  heartbeatReference: Duration | null
  silentAfter: Duration | null
}
export interface ResourceLeaseRow {
  owner: string
  held: Record<string, number>
  acquiredAt: string | null
}
export interface LocalResources {
  enabled: boolean
  capacity: Record<string, number>
  free: Record<string, number>
  reclaimable: Record<string, number>
  leases: (ResourceLeaseRow)[]
}
export interface WorkerDetail {
  enabled: boolean
  worker: WorkerRow | null
  leaderId: string | null
  silentAfter: Duration | null
  resources: LocalResources
  asOf: string
}
export interface QueueSettings {
  maxConcurrency: number
  rateLimit: number
  rateBurst: number
  effectiveRateBurst: number | null
}
export interface QueueRow {
  name: string
  counts: Record<JobState, number>
  total: number
  polledByThisProcess: boolean
  localSettings: QueueSettings | null
  localActiveCount: number | null
}
export interface QueueDetail extends QueueRow {
  asOf: string
}
export interface QueuesPage extends Page<QueueRow> {
  workerDiscoveryEnabled: boolean
}
export interface CronSummary {
  enabled: number
  disabled: number
}
export interface WorkerSummary {
  enabled: boolean
  recent: number
  silent: number
  unknown: number
  leaderId: string | null
  silentAfter: Duration | null
}
export interface OverviewSummary {
  jobs: JobCounts
  runs: Record<RunState, number>
  unreplayedDeadLetters: number
  crons: CronSummary
  workers: WorkerSummary
  asOf: string
}
export interface HandlerRow {
  kind: "job" | "workflow"
  name: string
  versions: (number)[]
  inputCount: number
}
export interface HandlerArtifactInput {
  name: string
  required: boolean
  maxSize: number
  mode: string
}
export interface ExecutionPolicy {
  level: string
  gracePeriod: Duration
  allowDowngrade: boolean
  image: string | null
}
export interface JobHandlerDetail {
  inputs: (HandlerArtifactInput)[]
  resources: Record<string, number>
  resourceLimits: Record<string, number>
  resourceClass: string | null
  resourceFunction: boolean
  leaseTtl: Duration | null
  effectiveLeaseTtl: Duration
  execution: ExecutionPolicy
}
export interface HandlerDetail extends HandlerRow {
  job: JobHandlerDetail | null
  asOf: string
}
export interface PoolConfig {
  concurrency: number
  queues: (string)[]
  pollInterval: Duration
  maxPollInterval: Duration
  jobHeartbeatInterval: Duration
  workerHeartbeatInterval: Duration
  workerStaleThreshold: Duration
  staleJobThreshold: Duration
  reapInterval: Duration
  defaultLeaseTtl: Duration
  storeCallTimeout: Duration
  shutdownTimeout: Duration
  storeCallsBounded: boolean
  reapingEnabled: boolean
  leasesEnabled: boolean
}
export interface SchedulerConfig {
  tickInterval: Duration
  leaderTtl: Duration
  refreshInterval: Duration
  lockTtl: Duration
  storeCallTimeout: Duration
  storeCallsBounded: boolean
}
export interface QueueConfigRow {
  name: string
  settings: QueueSettings
}
export interface RequestedRlimits {
  addressSpace: number
  noFile: number
  nProc: number
  core: number
  fSize: number
}
export interface SubprocessConfig {
  userConfigured: boolean
  uid: number | null
  gid: number | null
  allowSameUser: boolean
  hasRlimits: boolean
  strictRlimits: boolean
  requestedLimits: RequestedRlimits
  scratchDir: string | null
}
export interface ExecutorRow {
  name: string
  level: string
  default: boolean
  subprocess: SubprocessConfig | null
}
export interface ResourceConfig {
  enabled: boolean
  defaults: Record<string, number>
  queues: Record<string, Record<string, number>>
  advertisedWorkerCapacity: Record<string, number>
  customKeys: (string)[]
  estimatorConfigured: boolean
}
export interface ArtifactCacheConfig {
  directory: string
  budgetBytes: number
  usedBytes: number
}
export interface ArtifactConfig {
  enabled: boolean
  backend: string | null
  defaultBucket: string | null
  cache: ArtifactCacheConfig | null
}
export interface EngineConfig {
  workerId: string
  pool: PoolConfig
  scheduler: SchedulerConfig
  queues: (QueueConfigRow)[]
  executors: (ExecutorRow)[]
  resources: ResourceConfig
  artifacts: ArtifactConfig
  scratchRoot: string
  wakeNotifierSupported: boolean
  asOf: string
}
export interface JobCounts {
  counts: Record<JobState, number>
  total: number
  asOf: string
}

export interface JobRow {
  id: string; name: string; queue: string; state: JobState; priority: number
  maxRetries: number; retryCount: number; workerId: string | null
  scopeAppId: string | null; scopeOrgId: string | null
  createdAt: string | null; runAt: string | null; startedAt: string | null; completedAt: string | null
}
```

### `src/components.tsx`

```tsx
import type { ReactNode } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"

export function Frame({title, children, description = "Operator-wide view. Scope filters do not change access.", actions}: {title: string; children: ReactNode; description?: string; actions?: ReactNode}) {
  return <div className="flex min-w-0 flex-col gap-3"><PageHeader title={title} description={description} actions={actions} />{children}</div>
}
export function Section({title, children}: {title: string; children: ReactNode}) {
  return <section className="flex min-w-0 flex-col gap-2"><h2 className="text-sm font-medium">{title}</h2>{children}</section>
}
export function ResourceLink({kind, id, children}: {kind: string; id: string; children?: ReactNode}) {
  return <PluginLink to={`/${kind}/${encodeURIComponent(id)}`} className="break-all text-primary underline-offset-4 hover:underline">{children ?? <span className="font-mono text-xs">{id}</span>}</PluginLink>
}
export function Stamp({value, label}: {value: string | null; label: string}) {
  return <Timestamp value={value ?? undefined} label={label} />
}
export function Text({value, label = "value"}: {value: string | number | null | undefined; label?: string}) {
  return value === null || value === undefined || value === "" ? <NoneCell label={label} /> : <>{value}</>
}
export function Facts({items}: {items: [string, ReactNode][]}) {
  return <DescriptionList className="grid-cols-[minmax(0,auto)_minmax(0,1fr)] [&_dd]:break-words" items={items.map(([term,value])=>({term,value}))} />
}
export function Resources({values}: {values: Record<string,number>}) {
  return Object.keys(values).length ? <Facts items={Object.entries(values).map(([key,value])=>[key,value.toLocaleString()])} /> : <NoneCell label="resource declarations" />
}
export function Off({title, body}: {title: string; body: string}) {
  return <ZeroState title={title} body={body} action={<PluginLink to="/config" className="text-sm text-primary hover:underline">Inspect engine settings</PluginLink>} />
}
export function Rows<T>({title, rows, columns, rowKey, refresh, emptyBody, emptyTitle, emptyAction}: {title:string; rows:T[]; columns:Column<T>[]; rowKey:(row:T)=>string; refresh:()=>void; emptyBody?:string; emptyTitle?:string; emptyAction?:ReactNode}) {
  if (!rows.length) return <ZeroState title={emptyTitle ?? "No "+title} body={emptyBody ?? "No records are available in this view."} action={emptyAction ?? <Button size="sm" variant="outline" onClick={refresh}>Refresh</Button>} />
  return <ResourceTable density="compact" caption={`${rows.length} ${title} shown`} rows={rows} columns={columns} rowKey={rowKey} emptyMessage={"No "+title} />
}
export function settingLabel(key: string) {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./,c=>c.toUpperCase()).replaceAll("Ttl","TTL").replaceAll("Uid","UID").replaceAll("Gid","GID")
}
export function SettingValue({value}: {value:unknown}): ReactNode {
  if (value == null) return <NoneCell label="configured value" />
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return value.toLocaleString()
  if (typeof value === "string") return <Text value={value} />
  if (Array.isArray(value)) return value.length ? <ul className="flex flex-col gap-1">{value.map((item,index)=><li key={index}><SettingValue value={item} /></li>)}</ul> : <NoneCell label="entries" />
  if (typeof value === "object") {
    if ("text" in value && "ms" in value && typeof value.text === "string") return value.text
    return Object.keys(value).length ? <Facts items={Object.entries(value).map(([key,item])=>[settingLabel(key),<SettingValue value={item} />])} /> : <NoneCell label="entries" />
  }
  return <NoneCell label="value" />
}
```

### `src/pages/overview.tsx`

```tsx
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Stat } from "@forge-go/dashboard-kit/components/stat-grid"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink, Section } from "../components"
import type { OverviewSummary } from "../contract"

export function OverviewPage() {
  const query = useDispatchQuery<OverviewSummary>("overview.summary")
  return <Frame title="Dispatch" description="Operator-wide job execution and workflow state. Counts come from the store."><Read title="Overview" query={query} intervalMs={5_000}>{data=><>
    <Section title="Jobs"><div className="grid grid-cols-2 gap-2 @xl/main:grid-cols-3 @5xl/main:grid-cols-6">{Object.entries(data.jobs.counts).map(([state,count])=><PluginLink key={state} to={"/jobs?states="+state} className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring"><Stat label={state} value={count} tone={state==="failed"&&count>0?"danger":"default"} /></PluginLink>)}</div></Section>
    <Section title="Workflows"><div className="grid grid-cols-1 gap-2 @xl/main:grid-cols-3">{Object.entries(data.runs).map(([state,count])=><PluginLink key={state} to={"/workflows?state="+state} className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring"><Stat label={state} value={count} tone={state==="failed"&&count>0?"danger":"default"} /></PluginLink>)}</div></Section>
    <Section title="Operations"><Facts items={[
      ["Dead letters", <PluginLink to="/dlq" className="text-primary">{data.unreplayedDeadLetters.toLocaleString()} unreplayed</PluginLink>],
      ["Cron", <PluginLink to="/crons" className="text-primary">{data.crons.enabled} enabled · {data.crons.disabled} disabled</PluginLink>],
      ["Workers", data.workers.enabled ? <PluginLink to="/workers" className="text-primary">{data.workers.recent} recent · {data.workers.silent} silent · {data.workers.unknown} unknown</PluginLink> : "Worker registry not configured"],
      ["Leader",data.workers.leaderId ? <ResourceLink kind="workers" id={data.workers.leaderId} /> : "No current leader"],
      ["Silent after",data.workers.silentAfter?.text ?? "Unknown"],
    ]} /></Section>
  </>}</Read></Frame>
}
```

### `src/pages/queues.tsx`

```tsx
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { CursorPager, useCursor } from "../cursor"
import { JobStateBadge } from "../badges"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink, Rows, Section, SettingValue, Stamp, Text } from "../components"
import type { JobRow, QueueDetail, QueueRow, QueuesPage } from "../contract"
import type { Page } from "../types"

export function QueuesPage() {
  const query=useDispatchQuery<QueuesPage>("queues.list")
  return <Frame title="Queues" description="Store counts across scopes. Limits and active counts describe the serving process."><Read title="Queues" query={query} intervalMs={5_000}>{data=><>
    <p className="text-xs text-muted-foreground">Discovery covers local registrations{data.workerDiscoveryEnabled ? " and current worker queues" : ""}. Historical queue names remain valid job filters.</p>
    <Rows title="queues" rows={data.items} rowKey={row=>row.name} refresh={query.refetch} columns={[
      {id:"name",header:"Queue",cell:row=><ResourceLink kind="queues" id={row.name}><span className="font-medium">{row.name}</span></ResourceLink>},
      ...(["pending","running","completed","failed","retrying","cancelled"] as const).map(state=>({id:state,header:state,cell:(row:QueueRow)=>row.counts[state].toLocaleString()})),
      {id:"active",header:"Active here",cell:row=><Text value={row.localActiveCount} label="local active count" />},
      {id:"local",header:"Polled here",cell:row=><Badge variant="outline">{row.polledByThisProcess?"Yes":"No"}</Badge>},
    ]} />
  </>}</Read></Frame>
}
function QueueJobs({name}: {name:string}) {
  const paging=useCursor(name)
  const query=useDispatchQuery<Page<JobRow>>("jobs.list",{queue:name,cursor:paging.cursor??"",limit:25})
  return <Section title="Jobs in this queue"><Read title="Queue jobs" query={query} intervalMs={5_000}>{data=><>
    <Rows title="jobs" rows={data.items} rowKey={row=>row.id} refresh={query.refetch} columns={[
      {id:"id",header:"ID",cell:row=><ResourceLink kind="jobs" id={row.id} />},
      {id:"name",header:"Name",cell:row=><span className="font-medium">{row.name}</span>},
      {id:"state",header:"State",cell:row=><JobStateBadge state={row.state} />},
      {id:"created",header:"Created",cell:row=><Stamp value={row.createdAt} label="creation time" />},
    ]} emptyTitle={data.complete?"No jobs in this queue":"No results in this portion"} emptyAction={data.nextCursor?<Button size="sm" variant="outline" disabled={query.loading} onClick={()=>paging.next(data.nextCursor!)}>Continue search</Button>:<PluginLink to="/jobs" className="text-sm text-primary">Browse all jobs</PluginLink>} emptyBody={data.complete?"No jobs were found in this queue.":"No jobs were found in this portion. Continue through the remaining records."} />
    <CursorPager result={data} paging={paging} loading={query.loading} />
  </>}</Read></Section>
}
export function QueueDetailPage({params}:PluginPageProps) {
  const name=params.name??""
  const query=useDispatchQuery<QueueDetail>("queues.get",{name})
  return <Frame title={name || "Queue"}><Read title="Queue" query={query} intervalMs={5_000}>{data=><DetailLayout
    main={<QueueJobs name={data.name} />}
    aside={<Section title="This process"><Facts items={[
      ["Polled here",data.polledByThisProcess?"Yes":"No"],
      ["Active count",<Text value={data.localActiveCount} label="local active count" />],
      ["Total stored jobs",data.total.toLocaleString()],
    ]} />{data.localSettings?<SettingValue value={data.localSettings} />:<p className="text-sm text-muted-foreground">No local queue limits are registered.</p>}
      <PluginLink to={"/jobs?queue="+encodeURIComponent(data.name)} className="text-sm text-primary">Open jobs with queue filter</PluginLink>
    </Section>}
  />}</Read></Frame>
}
```

### `src/pages/workers.tsx`

```tsx
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { HeartbeatBadge } from "../badges"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, Off, ResourceLink, Resources, Rows, Section, Stamp, Text } from "../components"
import type { WorkerDetail, WorkersPage } from "../contract"

export function WorkersPage() {
  const query=useDispatchQuery<WorkersPage>("workers.list")
  return <Frame title="Workers" description="Operator-wide recorded heartbeats are evidence of contact, not a health verdict."><Read title="Workers" query={query} intervalMs={5_000}>{data=>data.enabled ? <>
    <p className="text-xs text-muted-foreground">Silent after {data.silentAfter?.text??"an unknown threshold"}. Remote heartbeat intervals are not recorded.</p>
    <Rows title="workers" rows={data.items} rowKey={row=>row.id} refresh={query.refetch} columns={[
      {id:"id",header:"Worker",cell:row=><ResourceLink kind="workers" id={row.id} />},
      {id:"host",header:"Hostname",cell:row=><Text value={row.hostname} label="hostname" />},
      {id:"queues",header:"Queues",cell:row=>row.queues.length?row.queues.map(name=><span key={name} className="mr-2"><ResourceLink kind="queues" id={name}>{name}</ResourceLink></span>):<Text value={null} label="queues" />},
      {id:"concurrency",header:"Concurrency",cell:row=>row.concurrency},
      {id:"heartbeat",header:"Heartbeat",cell:row=><><HeartbeatBadge status={row.heartbeatStatus} /><span className="ml-2 text-xs text-muted-foreground">{row.clockSkew?"Clock is ahead":row.heartbeatAge?.text??"Unknown age"}</span></>},
      {id:"leader",header:"Role",cell:row=><div className="flex flex-wrap gap-1">{row.isLeader&&<Badge>Leader</Badge>}{row.self&&<Badge variant="outline">This process</Badge>}{!row.isLeader&&!row.self&&<Badge variant="outline">{row.state}</Badge>}</div>},
    ]} />
  </> : <Off title="Worker registry not configured" body="This engine cannot report a worker fleet. An absent registry is not an empty or healthy fleet." />}</Read></Frame>
}
export function WorkerDetailPage({params}:PluginPageProps) {
  const query=useDispatchQuery<WorkerDetail>("workers.get",{id:params.id??""})
  return <Frame title="Worker"><Read title="Worker" query={query} intervalMs={5_000}>{data=>!data.enabled||!data.worker ? <Off title="Worker registry not configured" body="This engine cannot inspect worker records." /> : <DetailLayout
    main={<>
      <Section title={data.worker.hostname??data.worker.id}><div className="flex flex-wrap gap-2"><HeartbeatBadge status={data.worker.heartbeatStatus} />{data.worker.isLeader&&<Badge>Leader</Badge>}{data.worker.self&&<Badge variant="outline">This process</Badge>}</div>
        <Facts items={[
          ["ID",<span className="break-all font-mono text-xs">{data.worker.id}</span>],
          ["State",data.worker.state],["Concurrency",data.worker.concurrency],
          ["Queues",data.worker.queues.map(name=><span key={name} className="mr-2"><ResourceLink kind="queues" id={name}>{name}</ResourceLink></span>)],
          ["Last seen",<Stamp value={data.worker.lastSeen} label="heartbeat" />],
          ["Heartbeat age",data.worker.clockSkew?"Worker clock is ahead":data.worker.heartbeatAge?.text??"Unknown"],
          ["Heartbeat interval",data.worker.heartbeatInterval?.text??"Not recorded for remote workers"],
          ["Silent after",data.silentAfter?.text??"Unknown"],
          ["Leader lease until",<Stamp value={data.worker.leaderUntil} label="leader lease" />],
          ["Created",<Stamp value={data.worker.createdAt} label="creation time" />],
        ]} />
      </Section>
      <Section title="Resource leases">{data.resources.enabled ? <Rows title="resource leases" rows={data.resources.leases} rowKey={row=>row.owner} refresh={query.refetch} columns={[
        {id:"owner",header:"Owner",cell:row=><span className="font-mono text-xs">{row.owner}</span>},
        {id:"held",header:"Held",cell:row=><Resources values={row.held} />},
        {id:"acquired",header:"Acquired",cell:row=><Stamp value={row.acquiredAt} label="acquisition time" />},
      ]} /> : <Off title="Resource leases unavailable" body={data.worker.self?"Resource management is not configured for this process.":"Resource leases are available only for the process serving this page."} />}</Section>
    </>}
    aside={<>
      <Section title="Advertised capacity"><Resources values={data.worker.capacity} /></Section>
      {data.resources.enabled&&<><Section title="Local capacity"><Resources values={data.resources.capacity} /></Section><Section title="Free"><Resources values={data.resources.free} /></Section><Section title="Reclaimable"><Resources values={data.resources.reclaimable} /></Section></>}
    </>}
  />}</Read></Frame>
}
```

### `src/pages/handlers.tsx`

```tsx
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, Resources, Rows, Section, SettingValue, Text } from "../components"
import type { HandlerDetail, HandlerRow } from "../contract"
import type { Page } from "../types"

export function HandlersPage() {
  const query=useDispatchQuery<Page<HandlerRow>>("handlers.list")
  return <Frame title="Handlers" description="Job handlers and workflow definitions registered in this process."><Read title="Handlers" query={query} intervalMs={30_000}>{data=><Rows title="handlers" rows={data.items} rowKey={row=>row.kind+":"+row.name} refresh={query.refetch} columns={[
    {id:"name",header:"Name",cell:row=><PluginLink to={`/handlers/${row.kind==="job"?"jobs":"workflows"}/${encodeURIComponent(row.name)}`} className="font-medium text-primary hover:underline">{row.name}</PluginLink>},
    {id:"kind",header:"Kind",cell:row=>row.kind},
    {id:"versions",header:"Versions",cell:row=><Text value={row.versions.join(", ")} label="workflow versions" />},
    {id:"inputs",header:"Inputs",cell:row=>row.kind==="job"?row.inputCount:<Text value={null} label="declared artifact inputs" />},
  ]} />}</Read></Frame>
}
function HandlerDetailPage({params,kind}:PluginPageProps & {kind:"job"|"workflow"}) {
  const query=useDispatchQuery<HandlerDetail>("handlers.get",{kind,name:params.name??""})
  return <Frame title={params.name??"Handler"} description="Declarations from the serving process."><Read title="Handler" query={query} intervalMs={30_000}>{data=><DetailLayout
    main={<>
      <Section title="Registration"><Facts items={[["Name",data.name],["Kind",data.kind],["Versions",<Text value={data.versions.join(", ")} label="workflow versions" />]]} />
        <PluginLink to={`/${kind==="job"?"jobs":"workflows"}?namePrefix=${encodeURIComponent(data.name)}`} className="text-sm text-primary hover:underline">Browse matching {kind==="job"?"jobs":"runs"}</PluginLink>
      </Section>
      {data.job&&<><Section title="Artifact inputs"><Rows title="declared inputs" rows={data.job.inputs} rowKey={row=>row.name} refresh={query.refetch} columns={[
        {id:"name",header:"Name",cell:row=>row.name},{id:"required",header:"Required",cell:row=>row.required?"Yes":"No"},
        {id:"mode",header:"Mode",cell:row=>row.mode},{id:"size",header:"Max bytes",cell:row=>row.maxSize.toLocaleString()},
      ]} /></Section><Section title="Execution policy"><SettingValue value={data.job.execution} /></Section></>}
    </>}
    aside={data.job?<><Section title="Resources requested"><Resources values={data.job.resources} /></Section><Section title="Resource limits"><Resources values={data.job.resourceLimits} /></Section><Section title="Lease and class"><Facts items={[
      ["Class",<Text value={data.job.resourceClass} label="resource class" />],["Computed resources",data.job.resourceFunction?"Yes":"No"],
      ["Declared lease TTL",data.job.leaseTtl?.text??"Uses default"],["Effective lease TTL",data.job.effectiveLeaseTtl.text],
    ]} /></Section></>:undefined}
  />}</Read></Frame>
}
export function JobHandlerPage(props:PluginPageProps) {return <HandlerDetailPage {...props} kind="job" />}
export function WorkflowHandlerPage(props:PluginPageProps) {return <HandlerDetailPage {...props} kind="workflow" />}
```

### `src/pages/config.tsx`

```tsx
import { Read, useDispatchQuery } from "../read"
import { Facts, Frame, ResourceLink, Section, SettingValue } from "../components"
import type { EngineConfig } from "../contract"
export function EnginePage() {
  const query=useDispatchQuery<EngineConfig>("engine.config")
  return <Frame title="Engine" description="Read-only configuration and measurements for the process serving this page."><Read title="Engine configuration" query={query}>{data=><>
    <Facts items={[["Worker",<ResourceLink kind="workers" id={data.workerId} />],["Scratch root",data.scratchRoot||"Not configured"],["Wake notifier",data.wakeNotifierSupported?"Supported":"Not supported"]]} />
    <div className="grid min-w-0 gap-4 @3xl/main:grid-cols-2">
      <Section title="Pool and polling"><SettingValue value={data.pool} /></Section>
      <Section title="Cron scheduler"><SettingValue value={data.scheduler} /></Section>
      <Section title="Queues"><SettingValue value={data.queues} /></Section>
      <Section title="Execution"><p className="text-xs text-muted-foreground">Requested operating-system limits describe configuration. They do not prove enforcement.</p><SettingValue value={data.executors} /></Section>
      <Section title="Resources"><SettingValue value={data.resources} /></Section>
      <Section title="Artifacts"><SettingValue value={data.artifacts} /></Section>
    </div>
  </>}</Read></Frame>
}
```

- [ ] Run package format, lint, typecheck and tests. Expected PASS. Inspect the formatting diff and preserve concurrent changes.
- [ ] Commit owned paths: `feat(dispatch): add operational dashboard pages`.

## Task 2: Register the operational routes

**Files:** `packages/plugin-dispatch/test/plugin.test.tsx`, `packages/plugin-dispatch/src/index.tsx`, plus package.json and removal of src/index.ts.

- [ ] Add the tests below.

### `test/plugin.test.tsx`

```tsx
import { expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import dispatchPlugin, {dispatchPlugin as named} from "../src/index"
it("resolves the Dispatch contributor in its own namespace",()=>{
 expect(dispatchPlugin).toBe(named)
 expect(dispatchPlugin.namespace).toBe("dispatch")
 expect(dispatchPlugin.label).toBe("Dispatch")
 expect(resolvePluginState(dispatchPlugin,{shellEnvelopes:["v1"],contributors:[{name:"dispatch",configured:true,envelopes:["v1"]}]})).toEqual({kind:"ready"})
 expect(resolvePluginState(dispatchPlugin,{shellEnvelopes:["v1"],contributors:[]}).kind).toBe("hidden")
})
it("registers the implemented operational routes with the approved groups",()=>{
 expect(dispatchPlugin.nav.map(item=>[item.to,item.group])).toEqual([
 ["/","Dispatch"],["/queues","Monitoring"],["/workers","Monitoring"],["/handlers","Configuration"],["/config","Configuration"],
 ])
 expect(dispatchPlugin.routes.map(route=>route.path)).toEqual(["/","/queues","/queues/:name","/workers","/workers/:id","/handlers","/handlers/jobs/:name","/handlers/workflows/:name","/config"])
})
```

- [ ] Run `pnpm --filter @forge-go/dashboard-plugin-dispatch exec vitest run test/plugin.test.tsx`. Expected FAIL: the package has no plugin export yet.
- [ ] Implement the following.

### `src/index.tsx`

```tsx
import { lazy } from "react"
import { definePlugin } from "@forge-go/dashboard-plugin"
import { HouseIcon, LayersIcon, ServerIcon, CodeIcon, SettingsIcon } from "@forge-go/dashboard-kit/icons"
import { OverviewPage } from "./pages/overview"

const QueuesPage=lazy(()=>import("./pages/queues").then(module=>({default:module.QueuesPage})))
const QueueDetailPage=lazy(()=>import("./pages/queues").then(module=>({default:module.QueueDetailPage})))
const WorkersPage=lazy(()=>import("./pages/workers").then(module=>({default:module.WorkersPage})))
const WorkerDetailPage=lazy(()=>import("./pages/workers").then(module=>({default:module.WorkerDetailPage})))
const HandlersPage=lazy(()=>import("./pages/handlers").then(module=>({default:module.HandlersPage})))
const JobHandlerPage=lazy(()=>import("./pages/handlers").then(module=>({default:module.JobHandlerPage})))
const WorkflowHandlerPage=lazy(()=>import("./pages/handlers").then(module=>({default:module.WorkflowHandlerPage})))
const EnginePage=lazy(()=>import("./pages/config").then(module=>({default:module.EnginePage})))

export const dispatchPlugin=definePlugin({
 extension:"dispatch",namespace:"dispatch",label:"Dispatch",
 nav:[
  {label:"Overview",to:"/",priority:-10,group:"Dispatch",icon:<HouseIcon />},
  {label:"Queues",to:"/queues",priority:40,group:"Monitoring",icon:<LayersIcon />},
  {label:"Workers",to:"/workers",priority:50,group:"Monitoring",icon:<ServerIcon />},
  {label:"Handlers",to:"/handlers",priority:70,group:"Configuration",icon:<CodeIcon />},
  {label:"Engine",to:"/config",priority:80,group:"Configuration",icon:<SettingsIcon />},
 ],
 routes:[
  {path:"/",element:OverviewPage},
  {path:"/queues",element:QueuesPage},{path:"/queues/:name",element:QueueDetailPage},
  {path:"/workers",element:WorkersPage},{path:"/workers/:id",element:WorkerDetailPage},
  {path:"/handlers",element:HandlersPage},{path:"/handlers/jobs/:name",element:JobHandlerPage},{path:"/handlers/workflows/:name",element:WorkflowHandlerPage},
  {path:"/config",element:EnginePage},
 ],
})
export default dispatchPlugin
export { Action } from "./action"
export { CronBadge, HeartbeatBadge, JobStateBadge, ReplayBadge, RunStateBadge } from "./badges"
export { CursorPager, EmptyResults, useCursor } from "./cursor"
export { LiveStamp, Read, useDispatchQuery, useLive } from "./read"
export type { Duration, JobState, Page, RunState, Snapshot } from "./types"
```

- [ ] Remove the old src/index.ts and update package.json exports from ./src/index.ts to ./src/index.tsx.

- [ ] Run package format, lint, typecheck and tests. Expected PASS. Inspect the formatting diff and preserve concurrent changes.
- [ ] Commit owned paths: `feat(dispatch): register operational dashboard routes`.

## Final verification

- [ ] Package format, lint, typecheck and all tests pass after the final code edit.
- [ ] One fresh read-only final review, then one regression-tested fix pass for consequential findings. No re-review.
- [ ] Record exact results and remaining browser/host/fixture gates, commit and push verified work.
