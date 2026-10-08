# Dispatch Slice 3i: operational contract implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the React migration truthful worker, queue, overview, handler and engine inspection queries.

**Architecture:** Typed projections consume the serving engine's inspection API and store interfaces. Read failures remain errors. Only the serving process exposes local counters, resource leases and its heartbeat interval. Each query uses the existing bounded handler and operator-wide authorization model.

**Tech Stack:** Go, Forge dashboard contracts, memory, SQLite, PostgreSQL, Redis and MongoDB tests.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Execution result

Completed tasks 1-3 natively and committed through backend 982899e. All eight
intents are registered. Handler and engine tests preserve declared/effective
settings, nullable remote values, detached data and private configuration.
Workers, queues and overview pass on memory, SQLite, PostgreSQL 16, Redis 7 and
MongoDB 7 under race, with no skips. All eight HTTP queries pass.

The SQLite prerequisite first failed on scalar scanning, then on lease expiry.
Its model reads and parsed timestamps repaired those failures. The final fresh
review found P1 concurrent leadership: the existing partial index is not unique.
The regression observed five successful claims and five leader rows. A conditional
database claim plus the existing bounded busy retry now produces one winner and
one leader row for 24 simultaneous contenders, both with no leader and after an
expired lease. Ambiguous legacy leader rows return an error. This was the one
review fix pass; no second review was requested.

Final build and unit checks pass: 45 packages, 2058 tests/subtests, the known Trove
memory range skip and two packages without tests. Full engine/extension/SQLite
race checks pass. Ordinary full lint before the review fix, affected SQLite lint
after the fix, and integration contract lint pass. The earlier clean contract
race and real container results remain valid; the review fix changed only SQLite.

Artifacts, the React plugin, stateful fixtures, real browser verification, a
committed dependency baseline and templ retirement remain pending. This slice
does not establish fleet health, remote resource visibility or browser parity.

## Constraints and rulings

- Work on main in the primary checkouts. Preserve concurrent module and dashboard changes. Commit owned paths after relevant checks; do not push.
- Worker age is compared with the serving engine's existing stale threshold. A silent row is not proof that its process died. Future or missing timestamps remain unknown.
- Remote heartbeat intervals and resource leases are unavailable. Report null interval and disabled local resource inspection. Never borrow the local interval for remote workers.
- GetLeader is authoritative; the worker row's IsLeader flag can be stale. A recent row does not prove that Engine.Start has run.
- Queue discovery combines serving pool queues, configured local queues and registered worker queues. It cannot enumerate historical queues with no current registration.
- Queues are names used to filter jobs, not persisted resources. A nonblank queue detail can report zero jobs without inventing a not-found condition.
- Only configured queues have an instrumented local active count. A nil queue manager is normal when there are no limits; its fields stay null.
- Resource declarations and execution policies describe configuration. Never execute a ResourceFunc during inspection or claim that requested rlimits have been enforced.
- Subprocess inspection excludes binary paths, arguments and environment values.
- Aggregate reads are observations across several calls, not transactionally consistent snapshots. asOf records projection time.
- Artifact configuration uses the actual configured service and optional cache; artifact browsing remains a later slice.
- All eight intents are read-only and use existing read capabilities. No new commands or invalidation policy changes.
- Apply rex-voice and humanizer to shipped prose. No em dashes, attribution or co-author trailers.
- Retain execution evidence until the entire migration is complete. Browser parity and templ retirement remain pending.

## Review focus

1. Remote configuration must never be fabricated from serving process settings.
2. Outages must not become zero counts, empty lists or a healthy overview.
3. Disabled optional capabilities must remain distinguishable from enabled empty results.
4. Runtime configuration must not disclose environment or argument secrets.
5. Default engines without a queue manager must work.
6. All registered intents must have HTTP transport coverage; worker and queue store reads must run against all five backends.

## Task 1: Serve workers, queues and the overview from bounded store reads

**Files:** `extension/contract/operations_test.go`, `extension/contract/workers.go`, `extension/contract/queues.go`, `extension/contract/overview.go`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [ ] Add the tests:

`extension/contract/operations_test.go`

```go
package contract

import (
 "context"
 "errors"
 "reflect"
 "strings"
 "testing"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/cluster"
 "github.com/xraph/dispatch/cron"
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/queue"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func runOperationalDomain(t *testing.T,s store.Store){
 t.Helper()
 manager:=resource.NewManager(resource.Set{resource.Memory:100})
 lease,ok:=manager.TryAcquire("local-job",resource.Set{resource.Memory:20});if !ok{t.Fatal("lease refused")};defer lease.Release()
 d:=contractDeps(t,s,engine.WithResourceManager(manager),engine.WithQueueConfig(queue.Config{Name:"bounded",MaxConcurrency:3,RateLimit:10}))
 ctx:=context.Background();p:=fc.Principal{Claims:map[string]any{"scope_org_id":"not-the-seeded-org"}}
 remote:=&cluster.Worker{ID:id.NewWorkerID(),Hostname:"remote-host",Queues:[]string{"remote","bounded"},Concurrency:4,State:cluster.WorkerActive,
  Capacity:resource.Set{resource.Memory:200},CreatedAt:time.Now().Add(-time.Hour),LastSeen:time.Now().Add(-10*time.Minute)}
 if err:=s.RegisterWorker(ctx,remote);err!=nil{t.Fatal(err)}
 if acquired,err:=s.AcquireLeadership(ctx,remote.ID,time.Minute);err!=nil||!acquired{t.Fatalf("leader: %v, %v",acquired,err)}
 workers,err:=workersListHandler(d)(ctx,EmptyInput{},p)
 if err!=nil||!workers.Enabled||len(workers.Items)!=2||workers.LeaderID==nil||*workers.LeaderID!=remote.ID.String()||workers.AsOf==""||!workers.Complete||workers.NextCursor!=nil{t.Fatalf("workers=%+v, %v",workers,err)}
 for _,row:=range workers.Items{
  if row.ID==remote.ID.String(){
   if row.Self||!row.IsLeader||row.HeartbeatInterval!=nil||row.HeartbeatStatus!="silent"||row.HeartbeatAge==nil||row.Capacity[resource.Memory]!=200{t.Fatalf("remote=%+v",row)}
  }else if !row.Self||row.IsLeader||row.HeartbeatInterval==nil||row.HeartbeatStatus!="recent"{t.Fatalf("self=%+v",row)}
 }
 detail,err:=workersGetHandler(d)(ctx,IDInput{ID:d.Engine.WorkerID().String()},p)
 if err!=nil||detail.Worker==nil||!detail.Resources.Enabled||detail.Resources.Capacity[resource.Memory]!=100||detail.Resources.Free[resource.Memory]!=80||
  len(detail.Resources.Leases)!=1||detail.Resources.Leases[0].Owner!="local-job"{t.Fatalf("local=%+v, %v",detail,err)}
 detail.Resources.Capacity[resource.Memory]=0
 if manager.Capacity()[resource.Memory]!=100{t.Fatal("resource projection aliases manager")}
 other,err:=workersGetHandler(d)(ctx,IDInput{ID:remote.ID.String()},p)
 if err!=nil||other.Resources.Enabled||other.Resources.Leases==nil||len(other.Resources.Capacity)!=0{t.Fatalf("remote resources=%+v, %v",other,err)}
 if _,readErr:=workersGetHandler(d)(ctx,IDInput{ID:id.NewWorkerID().String()},p);!errors.Is(readErr,fc.ErrNotFound){t.Fatalf("missing worker=%v",readErr)}
 if _,readErr:=workersGetHandler(d)(ctx,IDInput{ID:id.NewJobID().String()},p);!errors.Is(readErr,fc.ErrBadRequest){t.Fatalf("bad worker=%v",readErr)}
 states:=[]job.State{job.StatePending,job.StateRunning,job.StateCompleted,job.StateFailed,job.StateRetrying,job.StateCancelled}
 for _,state:=range states{seedJob(t,d,"operation",state,"app","org","bounded")}
 seedJob(t,d,"remote",job.StatePending,"app","org","remote")
 if !d.Engine.QueueManager().Acquire("bounded",""){t.Fatal("queue acquire")};defer d.Engine.QueueManager().Release("bounded","")
 queues,err:=queuesListHandler(d)(ctx,EmptyInput{},p)
 if err!=nil||len(queues.Items)!=3||!queues.WorkerDiscoveryEnabled||queues.AsOf==""{t.Fatalf("queues=%+v, %v",queues,err)}
 names:=[]string{};for _,row:=range queues.Items{names=append(names,row.Name)}
 if !reflect.DeepEqual(names,[]string{"bounded","default","remote"}){t.Fatalf("queues=%v",names)}
 bounded,err:=queuesGetHandler(d)(ctx,NameInput{Name:"bounded"},p)
 if err!=nil||bounded.Total!=6||bounded.LocalSettings==nil||bounded.LocalSettings.MaxConcurrency!=3||bounded.LocalSettings.EffectiveRateBurst==nil||
  *bounded.LocalSettings.EffectiveRateBurst!=1||bounded.LocalActiveCount==nil||*bounded.LocalActiveCount!=1||bounded.PolledByThisProcess{t.Fatalf("bounded=%+v, %v",bounded,err)}
 for _,state:=range states{if bounded.Counts[state]!=1{t.Fatalf("counts=%v",bounded.Counts)}}
 defaultQueue,err:=queuesGetHandler(d)(ctx,NameInput{Name:"default"},p)
 if err!=nil||!defaultQueue.PolledByThisProcess||defaultQueue.LocalActiveCount!=nil||defaultQueue.LocalSettings!=nil{t.Fatalf("default=%+v, %v",defaultQueue,err)}
 unknown,err:=queuesGetHandler(d)(ctx,NameInput{Name:"historical"},p)
 if err!=nil||unknown.Total!=0||unknown.LocalActiveCount!=nil||unknown.AsOf==""{t.Fatalf("historical queue=%+v, %v",unknown,err)}
 if _,readErr:=queuesGetHandler(d)(ctx,NameInput{Name:" "},p);!errors.Is(readErr,fc.ErrBadRequest){t.Fatalf("blank queue=%v",readErr)}
 for _,state:=range []workflow.RunState{workflow.RunStateRunning,workflow.RunStateCompleted,workflow.RunStateFailed}{seedWorkflow(t,d,"workflow",state,"app","org",nil)}
 seedDLQ(t,d,"failed","bounded","app","org",time.Now(),false)
 seedDLQ(t,d,"replayed","bounded","app","org",time.Now(),true)
 seedCron(t,d,"enabled","@every 1h",true);seedCron(t,d,"disabled","@every 1h",false)
 summary,err:=overviewSummaryHandler(d)(ctx,EmptyInput{},p)
 if err!=nil||summary.Jobs.Total!=7||summary.UnreplayedDeadLetters!=1||summary.Crons.Enabled!=1||summary.Crons.Disabled!=1||
  !summary.Workers.Enabled||summary.Workers.Recent!=1||summary.Workers.Silent!=1||summary.Workers.Unknown!=0||summary.AsOf==""{t.Fatalf("summary=%+v, %v",summary,err)}
 for _,count:=range summary.Runs{if count!=1{t.Fatalf("runs=%v",summary.Runs)}}
}
func TestOperationalDomainMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runOperationalDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runOperationalDomain(t,sqliteContractStore(t))})
}
func TestWorkerProjectionUnknownClockSkewAndDetachedValues(t *testing.T){
 now:=time.Now();worker:=&cluster.Worker{ID:id.NewWorkerID(),Queues:[]string{"q"},Capacity:resource.Set{resource.Memory:10}}
 row:=projectWorker(worker,worker.ID,nil,10*time.Second,5*time.Minute,now)
 if row.HeartbeatAge!=nil||row.LastSeen!=nil||row.HeartbeatStatus!="unknown"||row.ClockSkew{t.Fatalf("unknown=%+v",row)}
 row.Queues[0]="changed";row.Capacity[resource.Memory]=0
 if worker.Queues[0]!="q"||worker.Capacity[resource.Memory]!=10{t.Fatal("projection aliases worker")}
 worker.LastSeen=now.Add(time.Minute)
 row=projectWorker(worker,worker.ID,nil,10*time.Second,5*time.Minute,now)
 if row.HeartbeatStatus!="unknown"||row.HeartbeatAge!=nil||!row.ClockSkew{t.Fatalf("future=%+v",row)}
 worker.LastSeen=now.Add(-5*time.Minute)
 row=projectWorker(worker,worker.ID,nil,10*time.Second,5*time.Minute,now)
 if row.HeartbeatStatus!="recent"{t.Fatalf("threshold equality=%+v",row)}
}
func TestWorkersDisabledCapabilityAndDefaultQueueManager(t *testing.T){
 disabled:=Deps{Engine:&engine.Engine{},Store:memory.New()}
 page,err:=workersListHandler(disabled)(context.Background(),EmptyInput{},fc.Principal{})
 if err!=nil||page.Enabled||page.Items==nil||page.LeaderID!=nil||page.SilentAfter!=nil{t.Fatalf("disabled=%+v, %v",page,err)}
 detail,err:=workersGetHandler(disabled)(context.Background(),IDInput{ID:id.NewWorkerID().String()},fc.Principal{})
 if err!=nil||detail.Enabled||detail.Worker!=nil||detail.Resources.Enabled||detail.Resources.Leases==nil{t.Fatalf("disabled detail=%+v, %v",detail,err)}
 d:=contractDeps(t,memory.New())
 queues,err:=queuesListHandler(d)(context.Background(),EmptyInput{},fc.Principal{})
 if err!=nil||len(queues.Items)!=1||queues.Items[0].LocalSettings!=nil||queues.Items[0].LocalActiveCount!=nil{t.Fatalf("default queues=%+v, %v",queues,err)}
}

type operationalReadFailure struct{store.Store;method string;deadline bool}
func(s *operationalReadFailure)fail(ctx context.Context,method string)error{
 if s.method!=method{return nil};_,s.deadline=ctx.Deadline();return errors.New("storage credential must stay private")
}
func(s *operationalReadFailure)ListWorkers(ctx context.Context)([]*cluster.Worker,error){if err:=s.fail(ctx,"workers");err!=nil{return nil,err};return s.Store.ListWorkers(ctx)}
func(s *operationalReadFailure)GetLeader(ctx context.Context)(*cluster.Worker,error){if err:=s.fail(ctx,"leader");err!=nil{return nil,err};return s.Store.GetLeader(ctx)}
func(s *operationalReadFailure)CountJobs(ctx context.Context,opts job.CountOpts)(int64,error){if err:=s.fail(ctx,"jobs");err!=nil{return 0,err};return s.Store.CountJobs(ctx,opts)}
func(s *operationalReadFailure)CountRuns(ctx context.Context,opts workflow.CountRunsOpts)(int64,error){if err:=s.fail(ctx,"runs");err!=nil{return 0,err};return s.Store.CountRuns(ctx,opts)}
func(s *operationalReadFailure)CountDLQEntries(ctx context.Context,opts dlq.CountOpts)(int64,error){if err:=s.fail(ctx,"dlq");err!=nil{return 0,err};return s.Store.CountDLQEntries(ctx,opts)}
func(s *operationalReadFailure)ListCrons(ctx context.Context)([]*cron.Entry,error){if err:=s.fail(ctx,"crons");err!=nil{return nil,err};return s.Store.ListCrons(ctx)}
func TestOperationalReadFailuresRemainErrors(t *testing.T){
 for _,method:=range []string{"workers","leader","jobs","runs","dlq","crons"}{
  t.Run(method,func(t *testing.T){
   s:=&operationalReadFailure{Store:memory.New()};d:=contractDeps(t,s);s.method=method
   _,err:=overviewSummaryHandler(d)(context.Background(),EmptyInput{},fc.Principal{})
   if !errors.Is(err,fc.ErrInternal)||strings.Contains(err.Error(),"credential")||!s.deadline{t.Fatalf("error=%v deadline=%v",err,s.deadline)}
   if method=="workers"||method=="jobs"{
    if _,readErr:=queuesListHandler(d)(context.Background(),EmptyInput{},fc.Principal{});!errors.Is(readErr,fc.ErrInternal){t.Fatalf("queues=%v",readErr)}
   }
   if method=="workers"||method=="leader"{
    if _,readErr:=workersListHandler(d)(context.Background(),EmptyInput{},fc.Principal{});!errors.Is(readErr,fc.ErrInternal){t.Fatalf("workers=%v",readErr)}
   }
  })
 }
}
```

- [ ] Run `go test -race ./extension/contract -run 'TestOperationalDomainMemoryAndSQLite|TestWorker|TestOperationalReadFailures' -count=1` before implementation. Expected: FAIL because the new typed handlers do not exist.

- [ ] Implement the projections and handlers:

`extension/contract/workers.go`

```go
package contract

import (
 "context"
 "slices"
 "strings"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/cluster"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/resource"
)

type WorkerRow struct {
 ID string `json:"id"`
 Hostname *string `json:"hostname"`
 Queues []string `json:"queues"`
 Concurrency int `json:"concurrency"`
 State cluster.WorkerState `json:"state"`
 Self bool `json:"self"`
 IsLeader bool `json:"isLeader"`
 LeaderUntil *string `json:"leaderUntil"`
 LastSeen *string `json:"lastSeen"`
 CreatedAt *string `json:"createdAt"`
 HeartbeatAge *Duration `json:"heartbeatAge"`
 HeartbeatInterval *Duration `json:"heartbeatInterval"`
 HeartbeatStatus string `json:"heartbeatStatus"`
 ClockSkew bool `json:"clockSkew"`
 Capacity resource.Set `json:"capacity"`
}
type WorkersPage struct {
 Page[WorkerRow]
 Enabled bool `json:"enabled"`
 LeaderID *string `json:"leaderId"`
 HeartbeatReference *Duration `json:"heartbeatReference"`
 SilentAfter *Duration `json:"silentAfter"`
}
type ResourceLeaseRow struct {
 Owner string `json:"owner"`
 Held resource.Set `json:"held"`
 AcquiredAt *string `json:"acquiredAt"`
}
type LocalResources struct {
 Enabled bool `json:"enabled"`
 Capacity resource.Set `json:"capacity"`
 Free resource.Set `json:"free"`
 Reclaimable resource.Set `json:"reclaimable"`
 Leases []ResourceLeaseRow `json:"leases"`
}
type WorkerDetail struct {
 Enabled bool `json:"enabled"`
 Worker *WorkerRow `json:"worker"`
 LeaderID *string `json:"leaderId"`
 SilentAfter *Duration `json:"silentAfter"`
 Resources LocalResources `json:"resources"`
 AsOf string `json:"asOf"`
}
func projectWorker(w *cluster.Worker,self id.WorkerID,leader *string,interval,threshold time.Duration,at time.Time)WorkerRow{
 row:=WorkerRow{ID:w.ID.String(),Hostname:nullable(w.Hostname),Queues:append([]string{},w.Queues...),Concurrency:w.Concurrency,State:w.State,
  Self:w.ID==self,IsLeader:leader!=nil&&*leader==w.ID.String(),LeaderUntil:timestampPtr(w.LeaderUntil),LastSeen:timestamp(w.LastSeen),
  CreatedAt:timestamp(w.CreatedAt),HeartbeatStatus:"unknown",Capacity:resourceValues(w.Capacity)}
 if row.Self{d:=duration(interval);row.HeartbeatInterval=&d}
 if !w.LastSeen.IsZero(){
  age:=at.Sub(w.LastSeen)
  if age<0{row.ClockSkew=true}else{
   d:=duration(age);row.HeartbeatAge=&d;row.HeartbeatStatus="recent"
   if age>threshold{row.HeartbeatStatus="silent"}
  }
 }
 return row
}
func workerLeader(ctx context.Context,store cluster.Store)(*string,error){
 leader,err:=store.GetLeader(ctx);if err!=nil{return nil,err}
 if leader==nil{return nil,nil};return nullable(leader.ID.String()),nil
}
func readWorkers(ctx context.Context,deps Deps)(WorkersPage,error){
 at:=time.Now();out:=WorkersPage{Page:newPage([]WorkerRow{},"",true,at)}
 store:=deps.Engine.ClusterStore();if store==nil{return out,nil}
 workers,err:=store.ListWorkers(ctx);if err!=nil{return WorkersPage{},err}
 leader,err:=workerLeader(ctx,store);if err!=nil{return WorkersPage{},err}
 at=time.Now();settings:=deps.Engine.Inspect()
 interval,threshold:=duration(settings.WorkerHeartbeatInterval),duration(settings.WorkerStaleThreshold)
 out.Enabled=true;out.LeaderID=leader;out.HeartbeatReference=&interval;out.SilentAfter=&threshold
 for _,worker:=range workers{out.Items=append(out.Items,projectWorker(worker,deps.Engine.WorkerID(),leader,settings.WorkerHeartbeatInterval,settings.WorkerStaleThreshold,at))}
 slices.SortFunc(out.Items,func(a,b WorkerRow)int{return strings.Compare(a.ID,b.ID)})
 out.AsOf=at.UTC().Format(time.RFC3339Nano);return out,nil
}
func workersListHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(WorkersPage,error){
 return handle(deps,"workers.list",false,func(ctx context.Context,_ EmptyInput,_ fc.Principal)(WorkersPage,error){return readWorkers(ctx,deps)})
}
func readLocalResources(deps Deps,self bool)LocalResources{
 out:=LocalResources{Capacity:resource.Set{},Free:resource.Set{},Reclaimable:resource.Set{},Leases:[]ResourceLeaseRow{}}
 if !self{return out}
 manager:=deps.Engine.Resources();if manager==nil{return out}
 out.Enabled=true;out.Capacity=resourceValues(manager.Capacity());out.Free=resourceValues(manager.Free());out.Reclaimable=resourceValues(manager.Reclaimable())
 for _,lease:=range manager.Leases(){out.Leases=append(out.Leases,ResourceLeaseRow{Owner:lease.Owner,Held:resourceValues(lease.Held),AcquiredAt:timestamp(lease.AcquiredAt)})}
 return out
}
func workersGetHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(WorkerDetail,error){
 return handle(deps,"workers.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(WorkerDetail,error){
  workerID,err:=id.ParseWorkerID(input.ID);if err!=nil||workerID.IsNil(){return WorkerDetail{},badRequest("id must be a worker ID")}
  out:=WorkerDetail{Resources:readLocalResources(deps,false),AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  store:=deps.Engine.ClusterStore();if store==nil{return out,nil}
  worker,err:=store.GetWorker(ctx,workerID);if err!=nil{return WorkerDetail{},err}
  leader,err:=workerLeader(ctx,store);if err!=nil{return WorkerDetail{},err}
  at:=time.Now();settings:=deps.Engine.Inspect();threshold:=duration(settings.WorkerStaleThreshold)
  row:=projectWorker(worker,deps.Engine.WorkerID(),leader,settings.WorkerHeartbeatInterval,settings.WorkerStaleThreshold,at)
  out.Enabled=true;out.Worker=&row;out.LeaderID=leader;out.SilentAfter=&threshold;out.Resources=readLocalResources(deps,row.Self);out.AsOf=at.UTC().Format(time.RFC3339Nano)
  return out,nil
 })
}
```

`extension/contract/queues.go`

```go
package contract

import (
 "context"
 "slices"
 "strings"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/job"
)

type NameInput struct{Name string `json:"name"`}
type QueueSettings struct {
 MaxConcurrency int `json:"maxConcurrency"`
 RateLimit float64 `json:"rateLimit"`
 RateBurst int `json:"rateBurst"`
 EffectiveRateBurst *int `json:"effectiveRateBurst"`
}
type QueueRow struct {
 Name string `json:"name"`
 Counts map[job.State]int64 `json:"counts"`
 Total int64 `json:"total"`
 PolledByThisProcess bool `json:"polledByThisProcess"`
 LocalSettings *QueueSettings `json:"localSettings"`
 LocalActiveCount *int `json:"localActiveCount"`
}
type QueueDetail struct{QueueRow;AsOf string `json:"asOf"`}
type QueuesPage struct{Page[QueueRow];WorkerDiscoveryEnabled bool `json:"workerDiscoveryEnabled"`}
func projectQueueLocal(deps Deps,name string)QueueRow{
 row:=QueueRow{Name:name,PolledByThisProcess:slices.Contains(deps.Engine.Inspect().Pool.Queues,name)}
 manager:=deps.Engine.QueueManager()
 if manager==nil{return row}
 if cfg,ok:=manager.QueueConfig(name);ok{
  row.LocalSettings=&QueueSettings{MaxConcurrency:cfg.MaxConcurrency,RateLimit:cfg.RateLimit,RateBurst:cfg.RateBurst}
  if cfg.RateLimit>0{burst:=max(cfg.RateBurst,1);row.LocalSettings.EffectiveRateBurst=&burst}
  active:=manager.ActiveCount(name);row.LocalActiveCount=&active
 }
 return row
}
func readQueue(ctx context.Context,deps Deps,name string)(QueueRow,error){
 counts,err:=countJobs(ctx,deps,name);if err!=nil{return QueueRow{},err}
 row:=projectQueueLocal(deps,name);row.Counts=counts.Counts;row.Total=counts.Total;return row,nil
}
func queuesListHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(QueuesPage,error){
 return handle(deps,"queues.list",false,func(ctx context.Context,_ EmptyInput,_ fc.Principal)(QueuesPage,error){
  names:=map[string]bool{}
  for _,name:=range deps.Engine.Inspect().Pool.Queues{if name!=""{names[name]=true}}
  if manager:=deps.Engine.QueueManager();manager!=nil{for _,name:=range manager.QueueNames(){if name!=""{names[name]=true}}}
  cluster:=deps.Engine.ClusterStore()
  if cluster!=nil{
   workers,err:=cluster.ListWorkers(ctx);if err!=nil{return QueuesPage{},err}
   for _,worker:=range workers{for _,name:=range worker.Queues{if name!=""{names[name]=true}}}
  }
  ordered:=make([]string,0,len(names));for name:=range names{ordered=append(ordered,name)};slices.Sort(ordered)
  rows:=make([]QueueRow,0,len(ordered))
  for _,name:=range ordered{row,err:=readQueue(ctx,deps,name);if err!=nil{return QueuesPage{},err};rows=append(rows,row)}
  return QueuesPage{Page:newPage(rows,"",true,time.Now()),WorkerDiscoveryEnabled:cluster!=nil},nil
 })
}
func queuesGetHandler(deps Deps)func(context.Context,NameInput,fc.Principal)(QueueDetail,error){
 return handle(deps,"queues.get",false,func(ctx context.Context,input NameInput,_ fc.Principal)(QueueDetail,error){
  if strings.TrimSpace(input.Name)==""{return QueueDetail{},badRequest("name must identify a queue")}
  row,err:=readQueue(ctx,deps,input.Name);if err!=nil{return QueueDetail{},err}
  return QueueDetail{QueueRow:row,AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
```

`extension/contract/overview.go`

```go
package contract

import (
 "context"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/workflow"
)

type CronSummary struct{Enabled int `json:"enabled"`;Disabled int `json:"disabled"`}
type WorkerSummary struct {
 Enabled bool `json:"enabled"`
 Recent int `json:"recent"`
 Silent int `json:"silent"`
 Unknown int `json:"unknown"`
 LeaderID *string `json:"leaderId"`
 SilentAfter *Duration `json:"silentAfter"`
}
type OverviewSummary struct {
 Jobs JobCounts `json:"jobs"`
 Runs map[workflow.RunState]int64 `json:"runs"`
 UnreplayedDeadLetters int64 `json:"unreplayedDeadLetters"`
 Crons CronSummary `json:"crons"`
 Workers WorkerSummary `json:"workers"`
 AsOf string `json:"asOf"`
}
func overviewSummaryHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(OverviewSummary,error){
 return handle(deps,"overview.summary",false,func(ctx context.Context,_ EmptyInput,_ fc.Principal)(OverviewSummary,error){
  jobs,err:=countJobs(ctx,deps,"");if err!=nil{return OverviewSummary{},err}
  out:=OverviewSummary{Jobs:jobs,Runs:map[workflow.RunState]int64{}}
  for _,state:=range []workflow.RunState{workflow.RunStateRunning,workflow.RunStateCompleted,workflow.RunStateFailed}{
   n,countErr:=deps.Store.CountRuns(ctx,workflow.CountRunsOpts{State:state});if countErr!=nil{return OverviewSummary{},countErr};out.Runs[state]=n
  }
  replayed:=false
  out.UnreplayedDeadLetters,err=deps.Store.CountDLQEntries(ctx,dlq.CountOpts{Replayed:&replayed});if err!=nil{return OverviewSummary{},err}
  crons,err:=deps.Store.ListCrons(ctx);if err!=nil{return OverviewSummary{},err}
  for _,entry:=range crons{if entry.Enabled{out.Crons.Enabled++}else{out.Crons.Disabled++}}
  workers,err:=readWorkers(ctx,deps);if err!=nil{return OverviewSummary{},err}
  out.Workers=WorkerSummary{Enabled:workers.Enabled,LeaderID:workers.LeaderID,SilentAfter:workers.SilentAfter}
  for _,worker:=range workers.Items{switch worker.HeartbeatStatus{case "recent":out.Workers.Recent++;case "silent":out.Workers.Silent++;default:out.Workers.Unknown++}}
  out.AsOf=time.Now().UTC().Format(time.RFC3339Nano);return out,nil
 })
}
```

- [ ] Format owned Go files with goimports and run `go test -race ./extension/contract -run 'TestOperationalDomainMemoryAndSQLite|TestWorker|TestOperationalReadFailures' -count=1`. Expected: PASS. Inspect all skips and retain durable backend output.
- [ ] Inspect branch, staged scope and concurrent changes. Stage exactly owned paths and create a focused commit: `feat(contract): expose worker queue and overview queries`.

## Task 2: Inspect registered handlers and effective engine settings

**Files:** `extension/contract/inspection_contract_test.go`, `extension/contract/handlers.go`, `extension/contract/config.go`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [ ] Add the tests:

`extension/contract/inspection_contract_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "errors"
 "reflect"
 "strings"
 "testing"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/artifact/artifacttest"
 "github.com/xraph/dispatch/artifact/cache"
 "github.com/xraph/dispatch/engine"
 execution "github.com/xraph/dispatch/exec"
 "github.com/xraph/dispatch/exec/subprocess"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func inspectionContractDeps(t *testing.T)Deps{
 t.Helper()
 s:=memory.New();backend:=artifacttest.NewBackend()
 service:=artifact.NewService(s,backend,artifact.WithDefaultBucket("dispatch-output"))
 c,err:=cache.New(t.TempDir(),backend,cache.WithBudget(4096));if err!=nil{t.Fatal(err)};t.Cleanup(func(){_ = c.Close()})
 process:=subprocess.New(subprocess.WithBinary("secret-binary"),subprocess.WithArgs("secret-argument"),subprocess.WithEnv(map[string]string{"SECRET":"secret-value"}),
  subprocess.WithUser(1001,1002),subprocess.WithAllowSameUser(),subprocess.WithRlimits(subprocess.Rlimits{NoFile:128,Core:1024}),subprocess.WithStrictRlimits(),subprocess.WithScratchDir("/scratch/process"))
 return contractDeps(t,s,engine.WithArtifacts(service,c),engine.WithExecutor(process),
  engine.WithResourceDefaults(resource.Set{resource.Memory:10},map[string]resource.Set{"batch":{resource.Memory:20}}))
}
func TestHandlerContractDescribesDeclarationsWithoutExecutingThem(t *testing.T){
 d:=inspectionContractDeps(t);ctx:=context.Background();p:=fc.Principal{}
 def:=job.NewDefinition("convert",func(context.Context,struct{})error{return nil},
  job.WithArtifactInputs(artifact.Input("source",artifact.Required,artifact.MaxSize(1024),artifact.StageAsPath)),
  job.WithResources(resource.Set{resource.Memory:128}),job.WithResourceLimits(resource.Set{resource.Memory:256}),job.WithResourceClass("batch"),
  job.WithResourceFunc(func(context.Context,resource.Request)(resource.Set,error){t.Fatal("inspection executed resource function");return nil,nil}),
  job.WithLeaseTTL(2*time.Minute),job.WithExecution(execution.Isolate(execution.LevelProcess),execution.GracePeriod(7*time.Second),execution.Image("worker:v1")))
 if err:=engine.RegisterChecked(d.Engine,def);err!=nil{t.Fatal(err)}
 if err:=engine.RegisterChecked(d.Engine,job.NewDefinition("plain",func(context.Context,struct{})error{return nil}));err!=nil{t.Fatal(err)}
 for _,version:=range []int{3,1,2}{engine.RegisterWorkflow(d.Engine,workflow.NewWorkflowV("convert",version,func(*workflow.Workflow,struct{})error{return nil}))}
 page,err:=handlersListHandler(d)(ctx,EmptyInput{},p)
 if err!=nil||len(page.Items)!=3||page.Items[0].Kind!="job"||page.Items[0].Name!="convert"||page.Items[2].Kind!="workflow"||page.AsOf==""{t.Fatalf("handlers=%+v, %v",page,err)}
 detail,err:=handlersGetHandler(d)(ctx,HandlerInput{Kind:"job",Name:"convert"},p)
 if err!=nil||detail.Job==nil{t.Fatalf("job=%+v, %v",detail,err)}
 got:=detail.Job
 if len(got.Inputs)!=1||!got.Inputs[0].Required||got.Inputs[0].MaxSize!=1024||got.Inputs[0].Mode!="path"||got.Resources[resource.Memory]!=128||
  got.ResourceLimits[resource.Memory]!=256||got.ResourceClass==nil||*got.ResourceClass!="batch"||!got.ResourceFunction||got.LeaseTTL==nil||got.LeaseTTL.MS!=120000||
  got.EffectiveLeaseTTL.MS!=120000||got.Execution.Level!="process"||got.Execution.GracePeriod.MS!=7000||got.Execution.Image==nil{t.Fatalf("declaration=%+v",got)}
 got.Resources[resource.Memory]=0;got.Inputs[0].Name="changed"
 again,err:=handlersGetHandler(d)(ctx,HandlerInput{Kind:"job",Name:"convert"},p)
 if err!=nil||again.Job.Resources[resource.Memory]!=128||again.Job.Inputs[0].Name!="source"{t.Fatalf("detached=%+v, %v",again,err)}
 plain,err:=handlersGetHandler(d)(ctx,HandlerInput{Kind:"job",Name:"plain"},p)
 if err!=nil||plain.Job.LeaseTTL!=nil||plain.Job.EffectiveLeaseTTL.MS!=d.Engine.Inspect().Pool.DefaultLeaseTTL.Milliseconds()||plain.Job.Inputs==nil||
  plain.Job.ResourceFunction||plain.Job.Execution.Image!=nil{t.Fatalf("plain=%+v, %v",plain,err)}
 versions,err:=handlersGetHandler(d)(ctx,HandlerInput{Kind:"workflow",Name:"convert"},p)
 if err!=nil||versions.Job!=nil||!reflect.DeepEqual(versions.Versions,[]int{1,2,3}){t.Fatalf("workflow=%+v, %v",versions,err)}
 for _,input:=range []HandlerInput{{Kind:"other",Name:"x"},{Kind:"job",Name:" "}}{
  if _,readErr:=handlersGetHandler(d)(ctx,input,p);!errors.Is(readErr,fc.ErrBadRequest){t.Fatalf("invalid=%v",readErr)}
 }
 for _,kind:=range []string{"job","workflow"}{
  if _,readErr:=handlersGetHandler(d)(ctx,HandlerInput{Kind:kind,Name:"missing"},p);!errors.Is(readErr,fc.ErrNotFound){t.Fatalf("missing=%v",readErr)}
 }
}
func TestEngineContractEffectiveSettingsAndPrivateConfiguration(t *testing.T){
 d:=inspectionContractDeps(t)
 got,err:=engineConfigHandler(d)(context.Background(),EmptyInput{},fc.Principal{});if err!=nil{t.Fatal(err)}
 if got.WorkerID!=d.Engine.WorkerID().String()||got.AsOf==""||got.Queues==nil||got.Pool.WorkerHeartbeatInterval.MS!=10000||got.Pool.WorkerStaleThreshold.MS!=300000||
  !got.Artifacts.Enabled||got.Artifacts.Backend==nil||*got.Artifacts.Backend!="memory"||got.Artifacts.DefaultBucket==nil||*got.Artifacts.DefaultBucket!="dispatch-output"||
  got.Artifacts.Cache==nil||got.Artifacts.Cache.BudgetBytes!=4096||got.Artifacts.Cache.UsedBytes!=0{t.Fatalf("settings=%+v",got)}
 found:=false
 for _,executor:=range got.Executors{if executor.Subprocess!=nil{
  found=true;process:=executor.Subprocess
  if !process.UserConfigured||process.UID==nil||*process.UID!=1001||process.GID==nil||*process.GID!=1002||!process.StrictRlimits||
   !process.AllowSameUser||!process.HasRlimits||process.RequestedLimits.Core!=0||process.RequestedLimits.NoFile!=128||process.ScratchDir==nil{t.Fatalf("process=%+v",process)}
 }}
 if !found{t.Fatal("subprocess missing")}
 raw,err:=json.Marshal(got);if err!=nil{t.Fatal(err)}
 for _,secret:=range []string{"secret-binary","secret-argument","secret-value","SECRET"}{if strings.Contains(string(raw),secret){t.Fatalf("private config leaked: %s",secret)}}
 got.Resources.Defaults[resource.Memory]=0;got.Resources.Queues["batch"][resource.Memory]=0
 again,err:=engineConfigHandler(d)(context.Background(),EmptyInput{},fc.Principal{})
 if err!=nil||again.Resources.Defaults[resource.Memory]!=10||again.Resources.Queues["batch"][resource.Memory]!=20{t.Fatalf("detached settings=%+v, %v",again,err)}
}
func TestEngineContractDisabledSubsystemsAndHeartbeatFallback(t *testing.T){
 s:=memory.New();base,err:=dispatch.New(dispatch.WithStore(s),dispatch.WithHeartbeatInterval(0));if err!=nil{t.Fatal(err)}
 eng,err:=engine.Build(base,engine.WithExecutor(subprocess.New()));if err!=nil{t.Fatal(err)};t.Cleanup(func(){_ = eng.Stop(context.Background())})
 got,err:=engineConfigHandler(Deps{Engine:eng,Store:s})(context.Background(),EmptyInput{},fc.Principal{})
 if err!=nil||got.Artifacts.Enabled||got.Artifacts.Backend!=nil||got.Artifacts.Cache!=nil||got.Resources.Enabled||got.Resources.CustomKeys==nil||
  got.Pool.JobHeartbeatInterval.MS!=0||got.Pool.WorkerHeartbeatInterval.MS!=10000||got.Queues==nil{t.Fatalf("defaults=%+v, %v",got,err)}
 for _,executor:=range got.Executors{if executor.Subprocess!=nil&&(executor.Subprocess.UID!=nil||executor.Subprocess.GID!=nil){t.Fatal("unset subprocess user invented")}}
}
```

- [ ] Run `go test -race ./extension/contract -run 'TestHandlerContract|TestEngineContract' -count=1` before implementation. Expected: FAIL because the new typed handlers do not exist.

- [ ] Implement the projections and handlers:

`extension/contract/handlers.go`

```go
package contract

import (
 "context"
 "slices"
 "strings"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/resource"
)

type HandlerInput struct{Kind string `json:"kind"`;Name string `json:"name"`}
type HandlerRow struct{
 Kind string `json:"kind"`
 Name string `json:"name"`
 Versions []int `json:"versions"`
 InputCount int `json:"inputCount"`
}
type HandlerArtifactInput struct{
 Name string `json:"name"`
 Required bool `json:"required"`
 MaxSize int64 `json:"maxSize"`
 Mode string `json:"mode"`
}
type ExecutionPolicy struct{
 Level string `json:"level"`
 GracePeriod Duration `json:"gracePeriod"`
 AllowDowngrade bool `json:"allowDowngrade"`
 Image *string `json:"image"`
}
type JobHandlerDetail struct{
 Inputs []HandlerArtifactInput `json:"inputs"`
 Resources resource.Set `json:"resources"`
 ResourceLimits resource.Set `json:"resourceLimits"`
 ResourceClass *string `json:"resourceClass"`
 ResourceFunction bool `json:"resourceFunction"`
 LeaseTTL *Duration `json:"leaseTtl"`
 EffectiveLeaseTTL Duration `json:"effectiveLeaseTtl"`
 Execution ExecutionPolicy `json:"execution"`
}
type HandlerDetail struct{HandlerRow;Job *JobHandlerDetail `json:"job"`;AsOf string `json:"asOf"`}
func handlersListHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(Page[HandlerRow],error){
 return handle(deps,"handlers.list",false,func(_ context.Context,_ EmptyInput,_ fc.Principal)(Page[HandlerRow],error){
  rows:=[]HandlerRow{}
  registry:=deps.Engine.Registry()
  for _,name:=range registry.Names(){rows=append(rows,HandlerRow{Kind:"job",Name:name,Versions:[]int{},InputCount:len(registry.Inputs(name))})}
  workflows:=deps.Engine.WorkflowRunner().Registry()
  for _,name:=range workflows.Names(){rows=append(rows,HandlerRow{Kind:"workflow",Name:name,Versions:workflows.Versions(name)})}
  slices.SortFunc(rows,func(a,b HandlerRow)int{if c:=strings.Compare(a.Kind,b.Kind);c!=0{return c};return strings.Compare(a.Name,b.Name)})
  return newPage(rows,"",true,time.Now()),nil
 })
}
func handlersGetHandler(deps Deps)func(context.Context,HandlerInput,fc.Principal)(HandlerDetail,error){
 return handle(deps,"handlers.get",false,func(_ context.Context,input HandlerInput,_ fc.Principal)(HandlerDetail,error){
  if strings.TrimSpace(input.Name)==""{return HandlerDetail{},badRequest("name must identify a handler")}
  out:=HandlerDetail{HandlerRow:HandlerRow{Kind:input.Kind,Name:input.Name,Versions:[]int{}},AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  switch input.Kind{
  case "workflow":
   registry:=deps.Engine.WorkflowRunner().Registry()
   if _,ok:=registry.Get(input.Name);!ok{return HandlerDetail{},notFound("workflow definition not found")}
   out.Versions=registry.Versions(input.Name)
  case "job":
   registry:=deps.Engine.Registry()
   if _,ok:=registry.Get(input.Name);!ok{return HandlerDetail{},notFound("job handler not found")}
   decl,policy:=registry.Resources(input.Name),registry.Policy(input.Name)
   detail:=&JobHandlerDetail{Inputs:[]HandlerArtifactInput{},Resources:resourceValues(decl.Requests),ResourceLimits:resourceValues(decl.Limits),
    ResourceClass:nullable(decl.Class),ResourceFunction:decl.Func!=nil,EffectiveLeaseTTL:duration(deps.Engine.Inspect().Pool.DefaultLeaseTTL),
    Execution:ExecutionPolicy{Level:policy.Level.String(),GracePeriod:duration(policy.GracePeriod),AllowDowngrade:policy.AllowDowngrade,Image:nullable(policy.Image)}}
   if ttl:=registry.LeaseTTL(input.Name);ttl>0{value:=duration(ttl);detail.LeaseTTL=&value;detail.EffectiveLeaseTTL=value}
   for _,spec:=range registry.Inputs(input.Name){detail.Inputs=append(detail.Inputs,HandlerArtifactInput{Name:spec.Name,Required:spec.Required,MaxSize:spec.MaxSize,Mode:spec.Mode.String()})}
   out.InputCount=len(detail.Inputs);out.Job=detail
  default:return HandlerDetail{},badRequest("kind must be job or workflow")
  }
  return out,nil
 })
}
```

`extension/contract/config.go`

```go
package contract

import (
 "context"
 "slices"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch/exec/subprocess"
 "github.com/xraph/dispatch/resource"
)

type PoolConfig struct{
 Concurrency int `json:"concurrency"`
 Queues []string `json:"queues"`
 PollInterval Duration `json:"pollInterval"`
 MaxPollInterval Duration `json:"maxPollInterval"`
 JobHeartbeatInterval Duration `json:"jobHeartbeatInterval"`
 WorkerHeartbeatInterval Duration `json:"workerHeartbeatInterval"`
 WorkerStaleThreshold Duration `json:"workerStaleThreshold"`
 StaleJobThreshold Duration `json:"staleJobThreshold"`
 ReapInterval Duration `json:"reapInterval"`
 DefaultLeaseTTL Duration `json:"defaultLeaseTtl"`
 StoreCallTimeout Duration `json:"storeCallTimeout"`
 ShutdownTimeout Duration `json:"shutdownTimeout"`
 StoreCallsBounded bool `json:"storeCallsBounded"`
 ReapingEnabled bool `json:"reapingEnabled"`
 LeasesEnabled bool `json:"leasesEnabled"`
}
type SchedulerConfig struct{
 TickInterval Duration `json:"tickInterval"`
 LeaderTTL Duration `json:"leaderTtl"`
 RefreshInterval Duration `json:"refreshInterval"`
 LockTTL Duration `json:"lockTtl"`
 StoreCallTimeout Duration `json:"storeCallTimeout"`
 StoreCallsBounded bool `json:"storeCallsBounded"`
}
type QueueConfigRow struct{Name string `json:"name"`;Settings QueueSettings `json:"settings"`}
type RequestedRlimits struct{
 AddressSpace int64 `json:"addressSpace"`
 NoFile int64 `json:"noFile"`
 NProc int64 `json:"nProc"`
 Core int64 `json:"core"`
 FSize int64 `json:"fSize"`
}
type SubprocessConfig struct{
 UserConfigured bool `json:"userConfigured"`
 UID *int `json:"uid"`
 GID *int `json:"gid"`
 AllowSameUser bool `json:"allowSameUser"`
 HasRlimits bool `json:"hasRlimits"`
 StrictRlimits bool `json:"strictRlimits"`
 RequestedLimits RequestedRlimits `json:"requestedLimits"`
 ScratchDir *string `json:"scratchDir"`
}
type ExecutorRow struct{Name string `json:"name"`;Level string `json:"level"`;Default bool `json:"default"`;Subprocess *SubprocessConfig `json:"subprocess"`}
type ResourceConfig struct{
 Enabled bool `json:"enabled"`
 Defaults resource.Set `json:"defaults"`
 Queues map[string]resource.Set `json:"queues"`
 AdvertisedWorkerCapacity resource.Set `json:"advertisedWorkerCapacity"`
 CustomKeys []string `json:"customKeys"`
 EstimatorConfigured bool `json:"estimatorConfigured"`
}
type ArtifactCacheConfig struct{Directory string `json:"directory"`;BudgetBytes int64 `json:"budgetBytes"`;UsedBytes int64 `json:"usedBytes"`}
type ArtifactConfig struct{Enabled bool `json:"enabled"`;Backend *string `json:"backend"`;DefaultBucket *string `json:"defaultBucket"`;Cache *ArtifactCacheConfig `json:"cache"`}
type EngineConfig struct{
 WorkerID string `json:"workerId"`
 Pool PoolConfig `json:"pool"`
 Scheduler SchedulerConfig `json:"scheduler"`
 Queues []QueueConfigRow `json:"queues"`
 Executors []ExecutorRow `json:"executors"`
 Resources ResourceConfig `json:"resources"`
 Artifacts ArtifactConfig `json:"artifacts"`
 ScratchRoot string `json:"scratchRoot"`
 WakeNotifierSupported bool `json:"wakeNotifierSupported"`
 AsOf string `json:"asOf"`
}
func engineConfigHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(EngineConfig,error){
 return handle(deps,"engine.config",false,func(_ context.Context,_ EmptyInput,_ fc.Principal)(EngineConfig,error){
  inspected:=deps.Engine.Inspect();pool,cron:=inspected.Pool,inspected.Cron
  out:=EngineConfig{WorkerID:deps.Engine.WorkerID().String(),Queues:[]QueueConfigRow{},Executors:[]ExecutorRow{},
   ScratchRoot:inspected.ScratchRoot,WakeNotifierSupported:inspected.WakeNotifierSupported,AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  out.Pool=PoolConfig{Concurrency:pool.Concurrency,Queues:append([]string{},pool.Queues...),PollInterval:duration(pool.PollInterval),
   MaxPollInterval:duration(pool.MaxPollInterval),JobHeartbeatInterval:duration(pool.HeartbeatInterval),
   WorkerHeartbeatInterval:duration(inspected.WorkerHeartbeatInterval),WorkerStaleThreshold:duration(inspected.WorkerStaleThreshold),
   StaleJobThreshold:duration(pool.StaleJobThreshold),ReapInterval:duration(pool.ReapInterval),DefaultLeaseTTL:duration(pool.DefaultLeaseTTL),
   StoreCallTimeout:duration(pool.StoreCallTimeout),ShutdownTimeout:duration(inspected.Config.ShutdownTimeout),
   StoreCallsBounded:pool.StoreCallsBounded,ReapingEnabled:pool.ReapingEnabled,LeasesEnabled:pool.LeasesEnabled}
  out.Scheduler=SchedulerConfig{TickInterval:duration(cron.TickInterval),LeaderTTL:duration(cron.LeaderTTL),RefreshInterval:duration(cron.RefreshInterval),
   LockTTL:duration(cron.LockTTL),StoreCallTimeout:duration(cron.StoreCallTimeout),StoreCallsBounded:cron.StoreCallsBounded}
  names:=[]string{};if manager:=deps.Engine.QueueManager();manager!=nil{names=manager.QueueNames()};slices.Sort(names)
  for _,name:=range names{row:=projectQueueLocal(deps,name);if row.LocalSettings!=nil{out.Queues=append(out.Queues,QueueConfigRow{Name:name,Settings:*row.LocalSettings})}}
  registry:=deps.Engine.Executors();defaultExecutor:=registry.Default()
  for _,executor:=range registry.Executors(){
   row:=ExecutorRow{Name:executor.Name(),Level:executor.Level().String(),Default:defaultExecutor!=nil&&executor.Name()==defaultExecutor.Name()}
   if process,ok:=executor.(interface{Settings()subprocess.Settings});ok{
    settings:=process.Settings();limits:=settings.Rlimits
    row.Subprocess=&SubprocessConfig{UserConfigured:settings.UserConfigured,AllowSameUser:settings.AllowSameUser,HasRlimits:settings.HasRlimits,
     StrictRlimits:settings.StrictRlimits,RequestedLimits:RequestedRlimits{AddressSpace:limits.AddressSpace,NoFile:limits.NoFile,NProc:limits.NProc,Core:limits.Core,FSize:limits.FSize},
     ScratchDir:nullable(settings.ScratchDir)}
    if settings.UserConfigured{uid,gid:=settings.UID,settings.GID;row.Subprocess.UID=&uid;row.Subprocess.GID=&gid}
   }
   out.Executors=append(out.Executors,row)
  }
  queues:=make(map[string]resource.Set,len(inspected.QueueResources));for name,values:=range inspected.QueueResources{queues[name]=resourceValues(values)}
  out.Resources=ResourceConfig{Enabled:inspected.ResourceManagerEnabled,Defaults:resourceValues(inspected.ResourceDefaults),Queues:queues,
   AdvertisedWorkerCapacity:resourceValues(inspected.WorkerCapacity),CustomKeys:append([]string{},inspected.WorkerCustomKeys...),EstimatorConfigured:inspected.EstimatorConfigured}
  service:=deps.Engine.Artifacts()
  if service.Enabled(){
   out.Artifacts.Enabled=true;out.Artifacts.Backend=nullable(service.Backend().Name());out.Artifacts.DefaultBucket=nullable(service.DefaultBucket())
   if cache:=deps.Engine.ArtifactCache();cache!=nil{out.Artifacts.Cache=&ArtifactCacheConfig{Directory:cache.Dir(),BudgetBytes:cache.Budget(),UsedBytes:cache.Used()}}
  }
  return out,nil
 })
}
```

- [ ] Format owned Go files with goimports and run `go test -race ./extension/contract -run 'TestHandlerContract|TestEngineContract' -count=1`. Expected: PASS. Inspect all skips and retain durable backend output.
- [ ] Inspect branch, staged scope and concurrent changes. Stage exactly owned paths and create a focused commit: `feat(contract): expose handler and engine inspection`.

## Task 3: Register all eight queries and verify durable stores and HTTP

**Files:** `extension/contract/operations_transport_test.go`, `extension/contract/operations_integration_test.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`. Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.

- [ ] Add the tests:

`extension/contract/operations_transport_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "testing"

 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store/memory"
)

func TestOperationalTransportAllEightQueries(t *testing.T){
 d:=contractDeps(t,memory.New())
 if err:=engine.RegisterChecked(d.Engine,job.NewDefinition("transport",func(context.Context,struct{})error{return nil}));err!=nil{t.Fatal(err)}
 inputs:=map[string]any{
  "workers.list":EmptyInput{},"workers.get":IDInput{ID:d.Engine.WorkerID().String()},
  "queues.list":EmptyInput{},"queues.get":NameInput{Name:"default"},
  "handlers.list":EmptyInput{},"handlers.get":HandlerInput{Kind:"job",Name:"transport"},
  "engine.config":EmptyInput{},"overview.summary":EmptyInput{},
 }
 for intent,input:=range inputs{t.Run(intent,func(t *testing.T){
  response:=callContract(t,d,"query",intent,input)
  var data map[string]json.RawMessage
  if err:=json.Unmarshal(response.Data,&data);err!=nil{t.Fatal(err)}
  if string(data["asOf"])==""||string(data["asOf"])=="null"{t.Fatalf("missing asOf: %s",response.Data)}
  if intent=="queues.get"&&(string(data["localActiveCount"])!="null"||string(data["localSettings"])!="null"){t.Fatalf("invented local settings: %s",response.Data)}
 })}
}
```

`extension/contract/operations_integration_test.go`

```go
//go:build integration

package contract

import "testing"

func TestOperationalDomainOtherBackends(t *testing.T){
 t.Run("postgres",func(t *testing.T){runOperationalDomain(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runOperationalDomain(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runOperationalDomain(t,mongoContractStore(t))})
}
```

- [ ] Run `go test ./extension/contract -run TestOperationalTransportAllEightQueries -count=1` before implementation. Expected: FAIL because the eight intents are not registered.

- [ ] Implement the projections and handlers:

Add the following bindings to bindings and matching query entries under intents in manifest.yaml:

```go
query("workers.list", workersListHandler(deps)),
query("workers.get", workersGetHandler(deps)),
query("queues.list", queuesListHandler(deps)),
query("queues.get", queuesGetHandler(deps)),
query("handlers.list", handlersListHandler(deps)),
query("handlers.get", handlersGetHandler(deps)),
query("engine.config", engineConfigHandler(deps)),
query("overview.summary", overviewSummaryHandler(deps)),
```

```yaml
  - { name: workers.list, kind: query, version: 1, capability: read }
  - { name: workers.get, kind: query, version: 1, capability: read }
  - { name: queues.list, kind: query, version: 1, capability: read }
  - { name: queues.get, kind: query, version: 1, capability: read }
  - { name: handlers.list, kind: query, version: 1, capability: read }
  - { name: handlers.get, kind: query, version: 1, capability: read }
  - { name: engine.config, kind: query, version: 1, capability: read }
  - { name: overview.summary, kind: query, version: 1, capability: read }
```

- [ ] Format owned Go files with goimports and run `go test -race ./extension/contract -count=1 && go test -race -tags=integration ./extension/contract -run TestOperationalDomainOtherBackends -count=1 -v`. Expected: PASS. Inspect all skips and retain durable backend output.
- [ ] Inspect branch, staged scope and concurrent changes. Stage exactly owned paths and create a focused commit: `feat(contract): register operational inspection intents`.

## Final verification and review

### Execution addition: SQLite leadership scan

The first operational test failed while acquiring a SQLite leader: Grove rejects
a scalar string destination. Add store/sqlite/leadership_test.go to cover first
claim, repeat claim, active competition and replacement after expiry. Replace the
scalar ID projection in AcquireLeadership with the same full workerModel scan
already used by PostgreSQL. Preserve the existing claim and expiry behavior.
Run the new regression under race, then the operational contract test. Commit
this prerequisite separately; include it in the final slice review.

The same test then exposed expiry comparisons between RFC 3339 worker lease
text and Grove's different bound-time format. Read the unique leader row as a
model and compare parsed instants in Go. Clear an expired lease only if its
observed expiry is unchanged, so a concurrent renewal is preserved. GetLeader
must return nil for an expired lease and report malformed expiry as an error.
No timestamp schema or existing writer format changes are needed.


- [ ] Run go build ./..., go test ./..., go test -race ./engine ./extension/... and ordinary golangci-lint with --allow-serial-runners.
- [ ] Run integration-tag lint for extension/contract; this slice must introduce no findings.
- [ ] Generate one final review package and ask one fresh read-only gpt-6-astra reviewer to inspect this plan and the complete slice diff. No implementation delegation or nested agents.
- [ ] Fix consequential findings in one tested pass, without a second review loop.
- [ ] Record results and remaining browser, artifact, dependency-baseline and templ retirement gates in this plan, its ledger and backend MIGRATION.md.
