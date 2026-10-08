# Dispatch Slice 3c: job contract and registration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve job reads and actions through the live dashboard contract and make the initialized extension discoverable.

**Architecture:** Domain factories wrap requests with the foundation's deadlines and error mapper. A typed projection separates compact list rows from details. The manifest declares only implemented job intents; subsequent domain slices extend it without adding stub handlers.

**Tech Stack:** Go, Forge contract dispatcher/loader/transport, memory and SQLite unit fixtures, PostgreSQL/Redis/MongoDB testcontainers.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Main primary checkout only. Preserve concurrent changes. Exact-path local commits, no push/worktree/branch/clone.
- Operator-wide with explicit app/org filters. No principal claims provide scope.
- Cursor pages default 50 and cap 200. Negative limits and invalid states/IDs/cursors are BAD_REQUEST.
- Counts come from CountJobs, never the current page. Complete reports coverage, not pagination exhaustion.
- All reads and actions pass through bounded handlers. Internal errors remain redacted.
- Only test code imports the root Forge dashboard package.
- Wire fields camelCase; absent values null; timestamps UTC; durations text/ms; opaque payloads report size.
- Cancel and retry use engine methods and actor context. Refusals include current state.
- Use rex-voice and humanizer; no em dashes or attribution.
- Native execution is authorized by the migration handoff.

## Review focus

1. Claims containing a tenant must not silently narrow an operator-wide list (Task 1, all backend identity tests).
2. Pagination across mixed states must include every matching ID exactly once in newest-first order (Tasks 1 and 3).
3. Retry must claim the dead letter and reject a second attempt (Task 1 actions test).
4. The actual HTTP envelope must carry invalidations and persist the requested action (Task 2 transport test).
5. An uninitialized extension must skip registration safely; runtime discovery must find an initialized one (Task 2).

## File structure and interfaces

Paths below are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
Task 1 consumes `Deps`, `handle` and wire helpers from Slice 3b. It produces job
list/count/detail/action factories, `JobRow`, `JobDetail`, `IDInput`, `QueueInput`
and artifact link projections. Task 2 consumes those factories and produces
`Register`, `bindings`, generic query/command binders, the embedded manifest and
`Extension.RegisterContractContributor`. Task 3 reuses Task 1's identity suite
against three real storage services. The existing five-backend store suite remains
the lower-level prerequisite.

### Task 1: Job reads and engine-backed actions

**Files (create):** `extension/contract/jobs_test.go`, `extension/contract/project_job.go`, `extension/contract/jobs.go`.

- [ ] Write the tests:

`extension/contract/jobs_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "errors"
 "path/filepath"
 "reflect"
 "slices"
 "strings"
 "testing"

 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/grove"
 "github.com/xraph/grove/drivers/sqlitedriver"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/ext"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
 sqlitestore "github.com/xraph/dispatch/store/sqlite"
)

func sqliteContractStore(t *testing.T) store.Store {
 t.Helper()
 drv := sqlitedriver.New()
 if err := drv.Open(context.Background(),filepath.Join(t.TempDir(),"contract.db")); err != nil { t.Fatal(err) }
 db,err := grove.Open(drv); if err != nil { t.Fatal(err) }
 t.Cleanup(func(){ _ = db.Close() })
 return sqlitestore.New(db)
}

func contractDeps(t *testing.T,s store.Store,options ...engine.Option) Deps {
 t.Helper()
 if err := s.Migrate(context.Background()); err != nil { t.Fatal(err) }
 d,err := dispatch.New(dispatch.WithStore(s)); if err != nil { t.Fatal(err) }
 eng,err := engine.Build(d,options...); if err != nil { t.Fatal(err) }
 t.Cleanup(func(){ _ = eng.Stop(context.Background()) })
 return Deps{Engine:eng,Store:s}
}

func seedJob(t *testing.T,d Deps,name string,state job.State,app,org,queue string) *job.Job {
 t.Helper()
 j,err := d.Engine.EnqueueRaw(context.Background(),name,[]byte(`{"n":1}`),job.WithQueue(queue))
 if err != nil { t.Fatal(err) }
 j.State = state; j.ScopeAppID = app; j.ScopeOrgID = org
 if err := d.Store.UpdateJob(context.Background(),j); err != nil { t.Fatal(err) }
 return j
}

func runJobDomain(t *testing.T,s store.Store) {
 t.Helper()
 d := contractDeps(t,s)
 rows := []*job.Job{
  seedJob(t,d,"mail.a",job.StatePending,"app-a","org-a","mail"),
  seedJob(t,d,"mail.b",job.StateFailed,"app-b","org-b","mail"),
  seedJob(t,d,"report.a",job.StateCompleted,"app-a","org-a","reports"),
  seedJob(t,d,"mail.c",job.StateRetrying,"","","mail"),
 }
 principal := fc.Principal{Claims:map[string]any{"scope_app_id":"app-a","scope_org_id":"org-a"}}
 list := jobsListHandler(d)
 var got []string
 cursor := ""
 for {
  page,err := list(context.Background(),JobsListInput{Limit:2,Cursor:cursor},principal)
  if err != nil { t.Fatal(err) }
  for _, row := range page.Items { got = append(got,row.ID) }
  if page.NextCursor == nil { break }
  cursor = *page.NextCursor
  if len(got)>len(rows) { t.Fatal("cursor repeated rows") }
 }
 want := make([]string,0,len(rows))
 for _, j := range rows { want = append(want,j.ID.String()) }
 slices.Sort(want); slices.Reverse(want)
 if !reflect.DeepEqual(got,want) { t.Fatalf("operator-wide identity/order = %v, want %v",got,want) }
 filtered,err := list(context.Background(),JobsListInput{States:[]job.State{job.StateFailed},Queue:"mail",NamePrefix:"mail.",ScopeAppID:"app-b",ScopeOrgID:"org-b"},principal)
 if err != nil || len(filtered.Items)!=1 || filtered.Items[0].ID!=rows[1].ID.String() { t.Fatalf("filtered = %+v, %v",filtered,err) }
 scoped,err := list(context.Background(),JobsListInput{ScopeAppID:"app-a"},principal)
 if err != nil || len(scoped.Items)!=2 { t.Fatalf("app filter = %+v, %v",scoped,err) }
 for _, row := range scoped.Items { if *row.ScopeAppID!="app-a" { t.Fatal("scope leaked") } }
 counts,err := jobsCountsHandler(d)(context.Background(),QueueInput{Queue:"mail"},principal)
 if err != nil || counts.Total!=3 || counts.Counts[job.StateFailed]!=1 || counts.Counts[job.StateCompleted]!=0 { t.Fatalf("counts = %+v, %v",counts,err) }
 for _, input := range []JobsListInput{{Limit:-1},{States:[]job.State{"unknown"}},{Cursor:"invalid"}} {
  if _, err := list(context.Background(),input,principal); !errors.Is(err,fc.ErrBadRequest) { t.Fatalf("bad input %+v: %v",input,err) }
 }
 detail,err := jobsGetHandler(d)(context.Background(),IDInput{ID:rows[3].ID.String()},principal)
 if err != nil { t.Fatal(err) }
 data,err := json.Marshal(detail); if err != nil { t.Fatal(err) }
 if detail.ScopeAppID!=nil || detail.ScopeOrgID!=nil || detail.WorkerID!=nil || detail.Artifacts.Enabled ||
  detail.Artifacts.Links==nil || !strings.Contains(string(data),`"scopeAppId":null`) || strings.Contains(string(data),"scope_app_id") { t.Fatalf("detail = %s",data) }
 if _, err := jobsGetHandler(d)(context.Background(),IDInput{ID:id.NewJobID().String()},principal); !errors.Is(err,fc.ErrNotFound) { t.Fatalf("missing = %v",err) }
 if _, err := jobsGetHandler(d)(context.Background(),IDInput{ID:id.NewRunID().String()},principal); !errors.Is(err,fc.ErrBadRequest) { t.Fatalf("wrong ID kind = %v",err) }
}

func TestJobDomainMemoryAndSQLite(t *testing.T) {
 t.Run("memory",func(t *testing.T){runJobDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runJobDomain(t,sqliteContractStore(t))})
}

type actionRecorder struct { actions []ext.Action }
func (*actionRecorder) Name() string { return "contract-actions" }
func (r *actionRecorder) OnOperatorAction(_ context.Context,a ext.Action) error { r.actions = append(r.actions,a); return nil }

func TestJobActionsUseEngineAndReturnCurrentState(t *testing.T) {
 for name,factory := range map[string]func(*testing.T)store.Store{"memory":func(*testing.T)store.Store{return memory.New()},"sqlite":sqliteContractStore} {
  t.Run(name,func(t *testing.T) {
   recorder := &actionRecorder{}
   d := contractDeps(t,factory(t),engine.WithExtension(recorder))
   principal := fc.Principal{User:&dashauth.UserInfo{Subject:"operator"}}
   pending := seedJob(t,d,"cancel",job.StatePending,"","","mail")
   cancel := jobActionHandler(d,"jobs.cancel",d.Engine.CancelJob)
   result,err := cancel(context.Background(),IDInput{ID:pending.ID.String()},principal)
   if err != nil || result.Job.State!=job.StateCancelled { t.Fatalf("cancel = %+v, %v",result,err) }
   _,err = cancel(context.Background(),IDInput{ID:pending.ID.String()},principal)
   var ce *fc.Error
   if !errors.As(err,&ce) || ce.Code!=fc.CodeConflict { t.Fatalf("second cancel = %v",err) }
   data,_ := json.Marshal(ce.Details)
   if !strings.Contains(string(data),`"state":"cancelled"`) { t.Fatalf("conflict details = %s",data) }
   failed := seedJob(t,d,"retry",job.StateFailed,"app-a","org-a","mail")
   if err := d.Engine.DLQService().Push(context.Background(),failed,errors.New("job failed")); err != nil { t.Fatal(err) }
   detail,err := jobsGetHandler(d)(context.Background(),IDInput{ID:failed.ID.String()},principal)
   if err != nil || detail.DLQEntryID==nil { t.Fatalf("missing DLQ link: %+v, %v",detail,err) }
   retry := jobActionHandler(d,"jobs.retry",d.Engine.RetryJob)
   if _, err := retry(context.Background(),IDInput{ID:failed.ID.String()},principal); err != nil { t.Fatal(err) }
   entry,err := d.Store.GetDLQByJobID(context.Background(),failed.ID)
   if err != nil || entry.ReplayedAt==nil { t.Fatalf("retry did not claim DLQ: %+v, %v",entry,err) }
   if _, err := retry(context.Background(),IDInput{ID:failed.ID.String()},principal); !errors.Is(err,fc.ErrConflict) { t.Fatalf("duplicate retry = %v",err) }
   if len(recorder.actions)!=2 { t.Fatalf("actions = %v",recorder.actions) }
   for _, action := range recorder.actions { if action.Actor!="operator" { t.Fatalf("actor = %q",action.Actor) } }
  })
 }
}

type incompleteJobsStore struct { store.Store }
func (s incompleteJobsStore) ListJobs(ctx context.Context,_ job.ListJobsOpts)(job.Page,error) {
 if _,ok := ctx.Deadline(); !ok { return job.Page{},errors.New("unbounded list") }
 return job.Page{Jobs:[]*job.Job{},NextCursor:id.NewJobID().String(),Complete:false},nil
}
func TestJobListPreservesIncompleteSearch(t *testing.T) {
 d := contractDeps(t,memory.New()); d.Store = incompleteJobsStore{d.Store}
 page,err := jobsListHandler(d)(context.Background(),JobsListInput{},fc.Principal{})
 if err != nil || page.Complete || page.NextCursor==nil || page.Items==nil { t.Fatalf("incomplete page = %+v, %v",page,err) }
}
```

- [ ] Run `go test -race ./extension/contract -run 'TestJob' -count=1`. Expect missing handler or registration symbols.
- [ ] Add the implementations:

`extension/contract/project_job.go`

```go
package contract

import (
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/resource"
)

type JobRow struct {
 ID string `json:"id"`
 Name string `json:"name"`
 Queue string `json:"queue"`
 State job.State `json:"state"`
 Priority int `json:"priority"`
 MaxRetries int `json:"maxRetries"`
 RetryCount int `json:"retryCount"`
 WorkerID *string `json:"workerId"`
 ScopeAppID *string `json:"scopeAppId"`
 ScopeOrgID *string `json:"scopeOrgId"`
 CreatedAt *string `json:"createdAt"`
 RunAt *string `json:"runAt"`
 StartedAt *string `json:"startedAt"`
 CompletedAt *string `json:"completedAt"`
}

func projectJob(j *job.Job) JobRow {
 var workerID *string
 if !j.WorkerID.IsNil() { value := j.WorkerID.String(); workerID = &value }
 return JobRow{
  ID: j.ID.String(),
  Name: j.Name,
  Queue: j.Queue,
  State: j.State,
  Priority: j.Priority,
  MaxRetries: j.MaxRetries,
  RetryCount: j.RetryCount,
  WorkerID: workerID,
  ScopeAppID: nullable(j.ScopeAppID),
  ScopeOrgID: nullable(j.ScopeOrgID),
  CreatedAt: timestamp(j.CreatedAt),
  RunAt: timestamp(j.RunAt),
  StartedAt: timestampPtr(j.StartedAt),
  CompletedAt: timestampPtr(j.CompletedAt),
 }
}

type ArtifactLinkRow struct {
 ArtifactID string `json:"artifactId"`
 Role string `json:"role"`
 Name string `json:"name"`
 Attempt int `json:"attempt"`
 CreatedAt *string `json:"createdAt"`
}

type JobArtifactLinks struct {
 Enabled bool `json:"enabled"`
 Links []ArtifactLinkRow `json:"links"`
}

type JobDetail struct {
 JobRow
 Payload Payload `json:"payload"`
 LastError *string `json:"lastError"`
 HeartbeatAt *string `json:"heartbeatAt"`
 Timeout Duration `json:"timeout"`
 LeaseEpoch int `json:"leaseEpoch"`
 LeaseExpiresAt *string `json:"leaseExpiresAt"`
 LeaseTTL Duration `json:"leaseTtl"`
 EffectiveLeaseTTL Duration `json:"effectiveLeaseTtl"`
 EvictCount int `json:"evictCount"`
 Resources resource.Set `json:"resources"`
 ResourceLimits resource.Set `json:"resourceLimits"`
 ResourceClass *string `json:"resourceClass"`
 InputBytes int64 `json:"inputBytes"`
 PrimaryInputHash *string `json:"primaryInputHash"`
 ArtifactBindings Payload `json:"artifactBindings"`
 Artifacts JobArtifactLinks `json:"artifacts"`
 DLQEntryID *string `json:"dlqEntryId"`
 AsOf string `json:"asOf"`
}

func resourceValues(values resource.Set) resource.Set {
 if values == nil { return resource.Set{} }
 return values.Clone()
}
```

`extension/contract/jobs.go`

```go
package contract

import (
 "context"
 "errors"
 "time"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/artifact"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
)

var jobStates = []job.State{job.StatePending,job.StateRunning,job.StateCompleted,job.StateFailed,job.StateRetrying,job.StateCancelled}

type IDInput struct { ID string `json:"id"` }

type JobsListInput struct {
 States []job.State `json:"states"`
 Queue string `json:"queue"`
 NamePrefix string `json:"namePrefix"`
 ScopeAppID string `json:"scopeAppId"`
 ScopeOrgID string `json:"scopeOrgId"`
 Cursor string `json:"cursor"`
 Limit int `json:"limit"`
}

type QueueInput struct { Queue string `json:"queue"` }

type JobCounts struct {
 Counts map[job.State]int64 `json:"counts"`
 Total int64 `json:"total"`
 AsOf string `json:"asOf"`
}

func validJobState(state job.State) bool {
 for _, value := range jobStates { if value == state { return true } }
 return false
}

func jobsListHandler(deps Deps) func(context.Context,JobsListInput,fc.Principal)(Page[JobRow],error) {
 return handle(deps,"jobs.list",false,func(ctx context.Context,input JobsListInput,_ fc.Principal)(Page[JobRow],error) {
  limit,err := pageLimit(input.Limit)
  if err != nil { return Page[JobRow]{},err }
  for _, state := range input.States { if !validJobState(state) { return Page[JobRow]{},badRequest("unknown job state") } }
  page,err := deps.Store.ListJobs(ctx,job.ListJobsOpts{States:input.States,Queue:input.Queue,NamePrefix:input.NamePrefix,
   ScopeAppID:input.ScopeAppID,ScopeOrgID:input.ScopeOrgID,Cursor:input.Cursor,Limit:limit})
  if err != nil { return Page[JobRow]{},err }
  items := make([]JobRow,0,len(page.Jobs))
  for _, j := range page.Jobs { items = append(items,projectJob(j)) }
  return newPage(items,page.NextCursor,page.Complete,time.Now()),nil
 })
}

func countJobs(ctx context.Context,deps Deps,queue string)(JobCounts,error) {
 out := JobCounts{Counts:make(map[job.State]int64,len(jobStates))}
 for _, state := range jobStates {
  n,err := deps.Store.CountJobs(ctx,job.CountOpts{Queue:queue,State:state})
  if err != nil { return JobCounts{},err }
  out.Counts[state] = n; out.Total += n
 }
 out.AsOf = time.Now().UTC().Format(time.RFC3339Nano)
 return out,nil
}

func jobsCountsHandler(deps Deps) func(context.Context,QueueInput,fc.Principal)(JobCounts,error) {
 return handle(deps,"jobs.counts",false,func(ctx context.Context,input QueueInput,_ fc.Principal)(JobCounts,error) {
  return countJobs(ctx,deps,input.Queue)
 })
}

func parseJobID(raw string)(id.JobID,error) {
 parsed,err := id.ParseJobID(raw)
 if err != nil || parsed.IsNil() { return id.JobID{},badRequest("id must be a job ID") }
 return parsed,nil
}

func jobLinks(ctx context.Context,deps Deps,jobID id.JobID)(JobArtifactLinks,error) {
 svc := deps.Engine.Artifacts()
 out := JobArtifactLinks{Enabled:svc.Enabled(),Links:[]ArtifactLinkRow{}}
 if !out.Enabled { return out,nil }
 links,err := svc.Store().ListLinks(ctx,artifact.OwnerRef{Kind:artifact.OwnerJob,ID:jobID.String()})
 if err != nil { return out,err }
 for _, link := range links {
  out.Links = append(out.Links,ArtifactLinkRow{ArtifactID:link.ArtifactID.String(),Role:string(link.Role),
   Name:link.Name,Attempt:link.Attempt,CreatedAt:timestamp(link.CreatedAt)})
 }
 return out,nil
}

func jobsGetHandler(deps Deps) func(context.Context,IDInput,fc.Principal)(JobDetail,error) {
 return handle(deps,"jobs.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(JobDetail,error) {
  jobID,err := parseJobID(input.ID); if err != nil { return JobDetail{},err }
  j,err := deps.Store.GetJob(ctx,jobID); if err != nil { return JobDetail{},err }
  links,err := jobLinks(ctx,deps,jobID); if err != nil { return JobDetail{},err }
  var deadLetterID *string
  entry,err := deps.Store.GetDLQByJobID(ctx,jobID)
  if err != nil && !errors.Is(err,dispatch.ErrDLQNotFound) { return JobDetail{},err }
  if err == nil { raw := entry.ID.String(); deadLetterID = &raw }
  effectiveTTL := j.LeaseTTL
  if effectiveTTL <= 0 { effectiveTTL = deps.Engine.Inspect().Pool.DefaultLeaseTTL }
  return JobDetail{JobRow:projectJob(j),Payload:projectPayload(j.Payload,false),LastError:nullable(j.LastError),
   HeartbeatAt:timestampPtr(j.HeartbeatAt),Timeout:duration(j.Timeout),LeaseEpoch:j.LeaseEpoch,
   LeaseExpiresAt:timestampPtr(j.LeaseExpiresAt),LeaseTTL:duration(j.LeaseTTL),EffectiveLeaseTTL:duration(effectiveTTL),
   EvictCount:j.EvictCount,Resources:resourceValues(j.Resources),ResourceLimits:resourceValues(j.ResourceLimits),
   ResourceClass:nullable(j.ResourceClass),InputBytes:j.InputBytes,PrimaryInputHash:nullable(j.PrimaryInputHash),
   ArtifactBindings:projectPayload(j.ArtifactBindings,false),Artifacts:links,DLQEntryID:deadLetterID,
   AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}

type JobAction struct {
 Job JobRow `json:"job"`
 AsOf string `json:"asOf"`
}

func jobActionHandler(deps Deps,intent string,action func(context.Context,id.JobID)(*job.Job,error)) func(context.Context,IDInput,fc.Principal)(JobAction,error) {
 return handle(deps,intent,true,func(ctx context.Context,input IDInput,_ fc.Principal)(JobAction,error) {
  jobID,err := parseJobID(input.ID); if err != nil { return JobAction{},err }
  j,err := action(ctx,jobID)
  if errors.Is(err,dispatch.ErrInvalidState) || errors.Is(err,dispatch.ErrDLQAlreadyReplayed) {
   current,readErr := deps.Store.GetJob(ctx,jobID)
   if readErr != nil { return JobAction{},readErr }
   conflict := stateConflict(string(current.State))
   if errors.Is(err,dispatch.ErrDLQAlreadyReplayed) {
    conflict = &fc.Error{Code:fc.CodeConflict,Message:"the dead letter has already been replayed",Details:map[string]any{"state":string(current.State)}}
   }
   return JobAction{},conflict
  }
  if err != nil { return JobAction{},err }
  return JobAction{Job:projectJob(j),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
```

- [ ] Format with `goimports -local github.com/xraph/dispatch -w extension/contract/jobs_test.go extension/contract/project_job.go extension/contract/jobs.go`.
- [ ] Run `go test -race ./extension/contract -run 'TestJob' -count=1`. All named cases must pass; skips are missing evidence.
- [ ] Run scoped lint; record any unrelated integration-tag lint blocker. Inspect branch, status, staged diff and diff whitespace, then commit exactly:

```sh
git add extension/contract/jobs_test.go extension/contract/project_job.go extension/contract/jobs.go
git commit --only -m 'feat(contract): serve job reads and operator actions' -- extension/contract/jobs_test.go extension/contract/project_job.go extension/contract/jobs.go
git show --stat HEAD
```

### Task 2: Manifest, transport and extension discovery

**Files (create):** `extension/contract/manifest_test.go`, `extension/contract_registration_test.go`, `extension/contract/manifest.yaml`, `extension/contract/contract.go`, `extension/contract_registration.go`.

- [ ] Write the tests:

`extension/contract/manifest_test.go`

```go
package contract

import (
 "bytes"
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "reflect"
 "strings"
 "testing"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 "github.com/xraph/forge/extensions/dashboard/contract/loader"
 "github.com/xraph/forge/extensions/dashboard/contract/transport"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store/memory"
)

func loadManifest(t *testing.T) *fc.ContractManifest {
 t.Helper()
 m,err := loader.Load(bytes.NewReader(manifestYAML),"dispatch/contract/manifest.yaml")
 if err != nil { t.Fatal(err) }
 return m
}

func TestEveryDeclaredIntentIsBound(t *testing.T) {
 deps := contractDeps(t,memory.New())
 manifest := loadManifest(t)
 if manifest.Contributor.Name!=ContributorName { t.Fatal("contributor mismatch") }
 bound := map[string]bool{}
 for _, b := range bindings(deps) { if bound[b.intent] { t.Fatalf("duplicate %s",b.intent) }; bound[b.intent]=true }
 if len(bound)!=len(manifest.Intents) { t.Fatal("manifest/binding count mismatch") }
 for _, in := range manifest.Intents { if !bound[in.Name] { t.Fatalf("unbound %s",in.Name) } }
 if err := Register(dispatcher.New(nil),fc.NewRegistry(),fc.NewWardenRegistry(),deps); err != nil { t.Fatal(err) }
}

func TestManifestCommandInvalidations(t *testing.T) {
 want := map[string][]string{
  "jobs.cancel":{"jobs.list","jobs.get","jobs.counts","queues.list","queues.get","overview.summary"},
  "jobs.retry":{"jobs.list","jobs.get","jobs.counts","queues.list","queues.get","overview.summary","dlq.list","dlq.get"},
 }
 found:=0
 for _, intent := range loadManifest(t).Intents {
  if intent.Kind!=fc.IntentKindCommand { if len(intent.Invalidates)!=0 { t.Fatalf("query invalidates: %s",intent.Name) }; continue }
  found++
  if !reflect.DeepEqual(intent.Invalidates,want[intent.Name]) { t.Fatalf("%s invalidates=%v",intent.Name,intent.Invalidates) }
 }
 if found!=len(want) { t.Fatalf("commands = %d",found) }
}

func TestCommandInvalidatesReachTheClient(t *testing.T) {
 for _, intent := range []string{"jobs.cancel","jobs.retry"} {
  t.Run(intent,func(t *testing.T) {
   deps := contractDeps(t,memory.New())
   state := job.StatePending; if intent=="jobs.retry" { state=job.StateFailed }
   j := seedJob(t,deps,"transport",state,"","","mail")
   reg:=fc.NewRegistry(); wreg:=fc.NewWardenRegistry(); d:=dispatcher.New(nil)
   if err:=Register(d,reg,wreg,deps);err!=nil {t.Fatal(err)}
   payload := `{"envelope":"v1","kind":"command","contributor":"dispatch","intent":"`+intent+`","csrf":"test","idempotencyKey":"test-`+intent+`","payload":{"id":"`+j.ID.String()+`"}}`
   req:=httptest.NewRequestWithContext(context.Background(),http.MethodPost,"/api/dashboard/v1",strings.NewReader(payload))
   recorder:=httptest.NewRecorder()
   transport.NewHandler(reg,wreg,d,nil).ServeHTTP(recorder,req)
   var response fc.Response
   if err:=json.Unmarshal(recorder.Body.Bytes(),&response);err!=nil||!response.OK {t.Fatalf("response=%s, %v",recorder.Body,err)}
   var want []string
   for _, declared:=range loadManifest(t).Intents {if declared.Name==intent {want=declared.Invalidates}}
   if !reflect.DeepEqual(response.Meta.Invalidates,want) {t.Fatalf("invalidates=%v, want %v",response.Meta.Invalidates,want)}
   stored,err:=deps.Store.GetJob(context.Background(),j.ID);if err!=nil {t.Fatal(err)}
   expected:=job.StateCancelled;if intent=="jobs.retry" {expected=job.StatePending}
   if stored.State!=expected {t.Fatalf("stored state=%s, want %s",stored.State,expected)}
  })
 }
}

func TestRegisterRejectsMissingDependencies(t *testing.T) {
 if err:=Register(dispatcher.New(nil),fc.NewRegistry(),fc.NewWardenRegistry(),Deps{});err==nil {t.Fatal("accepted missing engine")}
 deps:=contractDeps(t,memory.New())
 if err:=Register(nil,fc.NewRegistry(),fc.NewWardenRegistry(),deps);err==nil {t.Fatal("accepted missing dispatcher")}
}
```

`extension/contract_registration_test.go`

```go
package extension_test

import (
 "testing"

 "github.com/xraph/forge/extensions/dashboard"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 forgetesting "github.com/xraph/forge/testing"
 "github.com/xraph/dispatch/extension"
 "github.com/xraph/dispatch/store/memory"
)

func TestContractContributorDiscoveredThroughRuntimeInterface(t *testing.T) {
 e:=extension.New(extension.WithStore(memory.New()))
 app:=forgetesting.NewTestApp("contract-app","0.1.0")
 if err:=e.Register(app);err!=nil {t.Fatal(err)}
 contributor,ok:=any(e).(dashboard.ContractContributorAware)
 if !ok {t.Fatal("dashboard cannot discover Dispatch")}
 reg:=fc.NewRegistry()
 if err:=contributor.RegisterContractContributor(dispatcher.New(nil),reg,fc.NewWardenRegistry());err!=nil {t.Fatal(err)}
 if _,ok:=reg.Contributor("dispatch");!ok {t.Fatal("contributor missing after runtime registration")}
}

func TestUninitializedContractContributorSkipsRegistration(t *testing.T) {
 e:=extension.New()
 contributor,ok:=any(e).(dashboard.ContractContributorAware)
 if !ok {t.Fatal("runtime interface missing")}
 reg:=fc.NewRegistry()
 if err:=contributor.RegisterContractContributor(dispatcher.New(nil),reg,fc.NewWardenRegistry());err!=nil {t.Fatal(err)}
 if _,ok:=reg.Contributor("dispatch");ok {t.Fatal("uninitialized engine registered")}
}
```

- [ ] Run `go test -race ./extension/... -count=1`. Expect missing handler or registration symbols.
- [ ] Add the implementations:

`extension/contract/manifest.yaml`

```yaml
schemaVersion: 1
contributor:
  name: dispatch
  envelope: { supports: [v1], preferred: v1 }
  capabilities: [dispatch.read, dispatch.write]

# Operator-wide. Scope fields are explicit filters, never principal claims.
intents:
  - { name: jobs.list, kind: query, version: 1, capability: read }
  - { name: jobs.get, kind: query, version: 1, capability: read }
  - { name: jobs.counts, kind: query, version: 1, capability: read }
  - { name: jobs.cancel, kind: command, version: 1, capability: write, invalidates: [jobs.list, jobs.get, jobs.counts, queues.list, queues.get, overview.summary] }
  - { name: jobs.retry, kind: command, version: 1, capability: write, invalidates: [jobs.list, jobs.get, jobs.counts, queues.list, queues.get, overview.summary, dlq.list, dlq.get] }
```

`extension/contract/contract.go`

```go
package contract

import (
 "bytes"
 "context"
 _ "embed"
 "fmt"

 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 "github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// ContributorName joins the Go contributor and the React plugin.
const ContributorName = "dispatch"

//go:embed manifest.yaml
var manifestYAML []byte

type binding struct {
 intent string
 bind func(*dispatcher.Dispatcher) error
}

func query[I,O any](intent string,fn func(context.Context,I,fc.Principal)(O,error)) binding {
 return binding{intent:intent,bind:func(d *dispatcher.Dispatcher)error {
  return dispatcher.RegisterQuery(d,ContributorName,intent,1,fn)
 }}
}
func command[I,O any](intent string,fn func(context.Context,I,fc.Principal)(O,error)) binding {
 return binding{intent:intent,bind:func(d *dispatcher.Dispatcher)error {
  return dispatcher.RegisterCommand(d,ContributorName,intent,1,fn)
 }}
}

func bindings(deps Deps) []binding {
 return []binding{
  query("jobs.list",jobsListHandler(deps)),
  query("jobs.get",jobsGetHandler(deps)),
  query("jobs.counts",jobsCountsHandler(deps)),
  command("jobs.cancel",jobActionHandler(deps,"jobs.cancel",deps.Engine.CancelJob)),
  command("jobs.retry",jobActionHandler(deps,"jobs.retry",deps.Engine.RetryJob)),
 }
}

// Register validates the manifest and binds only implemented intents.
func Register(d *dispatcher.Dispatcher,reg fc.Registry,wreg fc.WardenRegistry,deps Deps) error {
 if err := deps.validate(); err != nil { return err }
 if d==nil || reg==nil || wreg==nil { return fmt.Errorf("dispatch/contract: dispatcher and registries are required") }
 manifest,err := loader.Load(bytes.NewReader(manifestYAML),"dispatch/contract/manifest.yaml")
 if err != nil { return fmt.Errorf("dispatch/contract: load manifest: %w",err) }
 if err := loader.Validate(manifest,wreg); err != nil { return fmt.Errorf("dispatch/contract: validate manifest: %w",err) }
 declared := make(map[string]bool,len(manifest.Intents))
 for _, intent := range manifest.Intents { declared[intent.Name] = true }
 handlers := bindings(deps)
 seen := make(map[string]bool,len(handlers))
 for _, binding := range handlers {
  if !declared[binding.intent] || seen[binding.intent] { return fmt.Errorf("dispatch/contract: undeclared or repeated binding %s",binding.intent) }
  seen[binding.intent] = true
 }
 for intent := range declared { if !seen[intent] { return fmt.Errorf("dispatch/contract: intent %s has no binding",intent) } }
 if err := reg.Register(manifest); err != nil { return fmt.Errorf("dispatch/contract: register manifest: %w",err) }
 for _, binding := range handlers {
  if err := binding.bind(d); err != nil { return fmt.Errorf("dispatch/contract: bind %s: %w",binding.intent,err) }
 }
 return nil
}
```

`extension/contract_registration.go`

```go
package extension

import (
 "fmt"

 "github.com/xraph/forge"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 dispatchcontract "github.com/xraph/dispatch/extension/contract"
 "github.com/xraph/dispatch/store"
)

// RegisterContractContributor exposes the initialized engine to the dashboard.
func (e *Extension) RegisterContractContributor(d *dispatcher.Dispatcher,reg fc.Registry,wreg fc.WardenRegistry) error {
 logger := e.Logger()
 if logger==nil { logger = forge.NewNoopLogger() }
 if e.eng==nil {
  logger.Warn("dispatch: engine not initialized; skipping contract contributor registration")
  return nil
 }
 s,ok := e.eng.Dispatcher().Store().(store.Store)
 if !ok { return fmt.Errorf("dispatch: dashboard requires cursor-capable stores") }
 return dispatchcontract.Register(d,reg,wreg,dispatchcontract.Deps{Engine:e.eng,Store:s,Logger:logger})
}
```

- [ ] Format with `goimports -local github.com/xraph/dispatch -w extension/contract/manifest_test.go extension/contract_registration_test.go extension/contract/contract.go extension/contract_registration.go`.
- [ ] Run `go test -race ./extension/... -count=1`. All named cases must pass; skips are missing evidence.
- [ ] Run scoped lint; record any unrelated integration-tag lint blocker. Inspect branch, status, staged diff and diff whitespace, then commit exactly:

```sh
git add extension/contract/manifest_test.go extension/contract_registration_test.go extension/contract/manifest.yaml extension/contract/contract.go extension/contract_registration.go
git commit --only -m 'feat(extension): register the Dispatch dashboard contract' -- extension/contract/manifest_test.go extension/contract_registration_test.go extension/contract/manifest.yaml extension/contract/contract.go extension/contract_registration.go
git show --stat HEAD
```

### Task 3: Qualify the job contract on the durable backends

**Files (create):** `extension/contract/jobs_integration_test.go`.

- [ ] Write the tests:

`extension/contract/jobs_integration_test.go`

```go
//go:build integration

package contract

import (
 "context"
 "testing"
 "time"

 "github.com/testcontainers/testcontainers-go"
 tcmongo "github.com/testcontainers/testcontainers-go/modules/mongodb"
 tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"
 tcredis "github.com/testcontainers/testcontainers-go/modules/redis"
 "github.com/testcontainers/testcontainers-go/wait"
 "github.com/xraph/grove"
 "github.com/xraph/grove/drivers/mongodriver"
 "github.com/xraph/grove/drivers/pgdriver"
 "github.com/xraph/grove/kv"
 "github.com/xraph/grove/kv/drivers/redisdriver"
 "github.com/xraph/dispatch/store"
 mongostore "github.com/xraph/dispatch/store/mongo"
 pgstore "github.com/xraph/dispatch/store/postgres"
 redisstore "github.com/xraph/dispatch/store/redis"
)

func postgresContractStore(t *testing.T) store.Store {
 t.Helper()
 ctx:=context.Background()
 ctr,err:=tcpg.Run(ctx,"postgres:16-alpine",tcpg.WithDatabase("dispatch_contract"),tcpg.WithUsername("test"),tcpg.WithPassword("test"),
  testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(60*time.Second)))
 if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){if err:=ctr.Terminate(ctx);err!=nil {t.Error(err)}})
 uri,err:=ctr.ConnectionString(ctx,"sslmode=disable");if err!=nil {t.Fatal(err)}
 drv:=pgdriver.New();if err:=drv.Open(ctx,uri);err!=nil {t.Fatal(err)}
 db,err:=grove.Open(drv);if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){_ = db.Close()})
 return pgstore.New(db)
}

func redisContractStore(t *testing.T) store.Store {
 t.Helper()
 ctx:=context.Background()
 ctr,err:=tcredis.Run(ctx,"redis:7-alpine");if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){if err:=ctr.Terminate(ctx);err!=nil {t.Error(err)}})
 uri,err:=ctr.ConnectionString(ctx);if err!=nil {t.Fatal(err)}
 drv:=redisdriver.New();if openErr:=drv.Open(ctx,uri);openErr!=nil {t.Fatal(openErr)}
 db,err:=kv.Open(drv);if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){_ = db.Close()})
 return redisstore.New(db)
}

func mongoContractStore(t *testing.T) store.Store {
 t.Helper()
 ctx:=context.Background()
 ctr,err:=tcmongo.Run(ctx,"mongo:7");if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){if err:=ctr.Terminate(ctx);err!=nil {t.Error(err)}})
 uri,err:=ctr.ConnectionString(ctx);if err!=nil {t.Fatal(err)}
 drv:=mongodriver.New();if openErr:=drv.Open(ctx,uri,mongodriver.WithDatabase("dispatch_contract"));openErr!=nil {t.Fatal(openErr)}
 db,err:=grove.Open(drv);if err!=nil {t.Fatal(err)}
 t.Cleanup(func(){_ = db.Close()})
 return mongostore.New(db)
}

func TestJobDomainOtherBackends(t *testing.T) {
 t.Run("postgres",func(t *testing.T){runJobDomain(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runJobDomain(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runJobDomain(t,mongoContractStore(t))})
}
```

- [ ] These are integration qualifications of existing code, so no artificial failure is required.

- [ ] Format with `goimports -local github.com/xraph/dispatch -w extension/contract/jobs_integration_test.go`.
- [ ] Run `go test -tags integration -race ./extension/contract -run TestJobDomainOtherBackends -count=1 -v`. All named cases must pass; skips are missing evidence.
- [ ] Run scoped lint; record any unrelated integration-tag lint blocker. Inspect branch, status, staged diff and diff whitespace, then commit exactly:

```sh
git add extension/contract/jobs_integration_test.go
git commit --only -m 'test(contract): verify job reads across all storage backends' -- extension/contract/jobs_integration_test.go
git show --stat HEAD
```

## Final verification and review

- [ ] Full build, full unit suite and fresh-cache ordinary lint pass.
- [ ] Integration-tag lint of extension/contract passes independently of the known Redis test shadow.
- [ ] A fresh native-workflow reviewer assesses the complete slice, including concrete transport and durable-backend evidence.
- [ ] Record findings and commit IDs. Continue with other domains; no full dashboard parity is claimed here.

## Self-review

All five review concerns have concrete tests. Every manifest intent has an implemented binding, and
invalidations name the approved downstream queries even while later domain commits are pending.
The manifest validator does not require invalidation targets to be registered in the same slice.
This plan deliberately leaves queues, handlers, DLQ, cron, workflow, worker, artifact, config and
overview intents to their domain plans. It does not remove any old source or register UI routes.
