# Dispatch Slice 3e: cron contract implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose stored cron state, timezone-aware fire previews and all four operator controls through the dashboard contract.

**Architecture:** A projection preserves stored timestamps separately from calculated future fires. Handlers use the existing engine methods for writes and share the foundation's deadlines, error mapping and actor context.

**Tech Stack:** Go, Forge contract transport, memory and SQLite fixtures.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Main primary checkouts only. Preserve concurrent edits, especially module files. Focused local commits, no branches, worktrees or push.
- Operator-wide data with explicit nullable scope fields. Cron lists stay unpaged and include every stored entry.
- Wire data uses camelCase, UTC RFC 3339 instants, nullable absent fields and payload envelopes.
- Next fires are calculated from one response timestamp through cron.NextFires. The IANA evaluation location is returned separately.
- Enable, disable, delete and run-now call the engine so cache invalidation, enqueue validation and operator events stay intact.
- Request bounds are inherited: reads 10 seconds, commands 30 seconds.
- Only implemented intents are registered. Invalidations are pinned against literals and verified through HTTP.
- Use rex-voice and humanizer. No em dashes or attribution. No browser or retirement claim yet.

## Rulings

- Preserve invalid stored schedules as readable rows with scheduleError and an empty nextFires array. Operators must still be able to disable or delete them; one bad record must not hide the whole list.
- Refuse enabling an invalid or never-firing stored schedule with CONFLICT and its current enabled/disabled state. Registration already rejects these schedules, but persisted legacy rows may exist.
- Return queue as null when unset and effectiveQueue from job.DefaultOptions, matching the actual engine enqueue path.
- Existing engine tests cover cache invalidation and concurrent scheduler writes. This slice verifies contract projection and transport with memory and SQLite; it does not claim live scheduler browser qualification.

## Review focus

1. A named timezone spanning a DST change must preserve the correct UTC instants and evaluation location (Task 1).
2. Enabling a row with a past nextRunAt must compute a future next fire without catch-up (Task 1).
3. Run-now on a disabled entry must enqueue its original payload and queue without changing stored schedule state (Tasks 1 and 2).
4. Malformed and never-firing stored schedules must remain inspectable/removable while enable reports a state conflict (Task 1).
5. Store read failure must remain a redacted error with a request deadline, not an empty schedule list (Task 1).

## File structure and interfaces

Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
crons.go owns CronRow/CronDetail projections and query/action factories. It
consumes the existing IDInput, Page, DeletedResult, JobRow, payload/time helpers
and engine controls. Task 2 binds those factories into contract.go and
manifest.yaml and extends the literal manifest test. Transport tests reuse
callContract from the dead-letter slice. EmptyInput is reusable by later domains.

### Task 1: Cron projections and engine-backed operations

**Files:** `extension/contract/crons_test.go`, `extension/contract/crons.go`.

- [ ] Write these tests:

`extension/contract/crons_test.go`

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
 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/cron"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
)

func seedCron(t *testing.T,d Deps,name,schedule string,enabled bool)*cron.Entry{
 t.Helper()
 next:=time.Now().UTC().Add(-time.Hour)
 entry:=&cron.Entry{Entity:dispatch.NewEntity(),ID:id.NewCronID(),Name:name,Schedule:schedule,JobName:"mail.send",Queue:"mail",
  Payload:[]byte(`{"n":9007199254740993}`),NextRunAt:&next,Enabled:enabled}
 if err:=d.Store.RegisterCron(context.Background(),entry);err!=nil{t.Fatal(err)}
 return entry
}
func TestCronProjectionKeepsUTCInstantsAndScheduleZone(t *testing.T){
 entry:=&cron.Entry{ID:id.NewCronID(),Schedule:"CRON_TZ=America/New_York 0 9 * * *"}
 at:=time.Date(2026,3,7,13,0,0,0,time.UTC)
 row:=projectCron(entry,at)
 if row.Location==nil||*row.Location!="America/New_York"||len(row.NextFires)!=5||
  row.NextFires[0]!="2026-03-07T14:00:00Z"||row.NextFires[1]!="2026-03-08T13:00:00Z"{t.Fatalf("DST projection = %+v",row)}
 if row.Queue!=nil||row.EffectiveQueue!="default"||row.LockedBy!=nil||row.ScopeAppID!=nil||row.ScopeOrgID!=nil{t.Fatalf("nulls/defaults = %+v",row)}
}
func runCronDomain(t *testing.T,s store.Store){
 t.Helper()
 recorder:=&actionRecorder{}
 d:=contractDeps(t,s,engine.WithExtension(recorder))
 ctx:=context.Background();p:=fc.Principal{User:&dashauth.UserInfo{Subject:"operator"}}
 first:=seedCron(t,d,"alpha","CRON_TZ=America/New_York 0 9 * * *",false)
 second:=seedCron(t,d,"beta","@every 1h",true)
 page,err:=cronsListHandler(d)(ctx,EmptyInput{},p)
 if err!=nil||len(page.Items)!=2||page.Items[0].ID!=first.ID.String()||page.Items[1].ID!=second.ID.String()||!page.Complete||page.NextCursor!=nil{t.Fatalf("list = %+v, %v",page,err)}
 detail,err:=cronsGetHandler(d)(ctx,IDInput{ID:first.ID.String()},p);if err!=nil{t.Fatal(err)}
 raw,_:=json.Marshal(detail)
 if !strings.Contains(string(raw),"9007199254740993")||strings.Contains(string(raw),"job_name")||len(detail.NextFires)!=5{t.Fatalf("detail = %s",raw)}
 now:=time.Now()
 enabled,err:=cronToggleHandler(d,true)(ctx,IDInput{ID:first.ID.String()},p)
 if err!=nil||!enabled.Enabled||enabled.NextRunAt==nil{t.Fatalf("enable = %+v, %v",enabled,err)}
 next,err:=time.Parse(time.RFC3339Nano,*enabled.NextRunAt)
 if err!=nil||!next.After(now){t.Fatalf("enable caught up: %s, %v",*enabled.NextRunAt,err)}
 disabled,err:=cronToggleHandler(d,false)(ctx,IDInput{ID:second.ID.String()},p)
 if err!=nil||disabled.Enabled{t.Fatalf("disable = %+v, %v",disabled,err)}
 before,err:=d.Store.GetCron(ctx,second.ID);if err!=nil{t.Fatal(err)}
 fired,err:=cronsRunNowHandler(d)(ctx,IDInput{ID:second.ID.String()},p)
 if err!=nil||fired.Job.Queue!="mail"||fired.Job.State!=job.StatePending{t.Fatalf("run now = %+v, %v",fired,err)}
 after,err:=d.Store.GetCron(ctx,second.ID)
 if err!=nil||after.Enabled||!reflect.DeepEqual(before.NextRunAt,after.NextRunAt)||!reflect.DeepEqual(before.LastRunAt,after.LastRunAt){t.Fatalf("schedule changed: before=%+v, after=%+v, %v",before,after,err)}
 jobID,err:=id.ParseJobID(fired.Job.ID);if err!=nil{t.Fatal(err)}
 storedJob,err:=d.Store.GetJob(ctx,jobID)
 if err!=nil||string(storedJob.Payload)!=string(second.Payload){t.Fatalf("payload = %+v, %v",storedJob,err)}
 if _,deleteErr:=cronsDeleteHandler(d)(ctx,IDInput{ID:second.ID.String()},p);deleteErr!=nil{t.Fatal(deleteErr)}
 if _,getErr:=cronsGetHandler(d)(ctx,IDInput{ID:second.ID.String()},p);!errors.Is(getErr,fc.ErrNotFound){t.Fatalf("deleted = %v",getErr)}
 if _,getErr:=cronsGetHandler(d)(ctx,IDInput{ID:id.NewJobID().String()},p);!errors.Is(getErr,fc.ErrBadRequest){t.Fatalf("invalid = %v",getErr)}
 if len(recorder.actions)!=4{t.Fatalf("actions = %+v",recorder.actions)}
 for _,a:=range recorder.actions{if a.Actor!="operator"{t.Fatalf("actor = %+v",a)}}
}
func TestCronDomainMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runCronDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runCronDomain(t,sqliteContractStore(t))})
}
func TestCronInvalidStoredScheduleRemainsInspectableAndRemovable(t *testing.T){
 for _,schedule:=range []string{"not a schedule","0 0 30 2 *"}{
  t.Run(schedule,func(t *testing.T){
   d:=contractDeps(t,memory.New())
   e:=seedCron(t,d,"invalid",schedule,false)
   detail,err:=cronsGetHandler(d)(context.Background(),IDInput{ID:e.ID.String()},fc.Principal{})
   if err!=nil||detail.ScheduleError==nil||detail.NextFires==nil||len(detail.NextFires)!=0{t.Fatalf("invalid record = %+v, %v",detail,err)}
   _,err=cronToggleHandler(d,true)(context.Background(),IDInput{ID:e.ID.String()},fc.Principal{})
   var ce *fc.Error
   if !errors.As(err,&ce)||ce.Code!=fc.CodeConflict||ce.Details["state"]!="disabled"{t.Fatalf("enable refusal = %v",err)}
   if _,deleteErr:=cronsDeleteHandler(d)(context.Background(),IDInput{ID:e.ID.String()},fc.Principal{});deleteErr!=nil{t.Fatal(deleteErr)}
  })
 }
}
type failingCronStore struct{store.Store}
func(s failingCronStore)ListCrons(ctx context.Context)([]*cron.Entry,error){
 if _,ok:=ctx.Deadline();!ok{panic("missing cron query deadline")}
 return nil,errors.New("private database diagnostics")
}
func TestCronReadFailureIsRedacted(t *testing.T){
 d:=contractDeps(t,failingCronStore{Store:memory.New()})
 _,err:=cronsListHandler(d)(context.Background(),EmptyInput{},fc.Principal{})
 if !errors.Is(err,fc.ErrInternal)||strings.Contains(err.Error(),"private"){t.Fatalf("read failure = %v",err)}
}
```

- [ ] Run `go test -race ./extension/contract -run TestCron -count=1`. Expected before implementation: missing cron projections and handler factories.

- [ ] Implement these files:

`extension/contract/crons.go`

```go
package contract

import (
 "context"
 "errors"
 "slices"
 "strings"
 "time"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/cron"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
)

type EmptyInput struct{}
type CronRow struct {
 ID string `json:"id"`
 Name string `json:"name"`
 Schedule string `json:"schedule"`
 JobName string `json:"jobName"`
 Queue *string `json:"queue"`
 EffectiveQueue string `json:"effectiveQueue"`
 ScopeAppID *string `json:"scopeAppId"`
 ScopeOrgID *string `json:"scopeOrgId"`
 Enabled bool `json:"enabled"`
 CreatedAt *string `json:"createdAt"`
 UpdatedAt *string `json:"updatedAt"`
 LastRunAt *string `json:"lastRunAt"`
 NextRunAt *string `json:"nextRunAt"`
 LockedBy *string `json:"lockedBy"`
 LockedUntil *string `json:"lockedUntil"`
 NextFires []string `json:"nextFires"`
 Location *string `json:"location"`
 ScheduleError *string `json:"scheduleError"`
}
type CronDetail struct {
 CronRow
 Payload Payload `json:"payload"`
 AsOf string `json:"asOf"`
}
type CronRunResult struct {
 CronID string `json:"cronId"`
 Job JobRow `json:"job"`
 AsOf string `json:"asOf"`
}
func projectCron(entry *cron.Entry,at time.Time)CronRow{
 queue:=entry.Queue;if queue==""{queue=job.DefaultOptions().Queue}
 row:=CronRow{ID:entry.ID.String(),Name:entry.Name,Schedule:entry.Schedule,JobName:entry.JobName,Queue:nullable(entry.Queue),
  EffectiveQueue:queue,ScopeAppID:nullable(entry.ScopeAppID),ScopeOrgID:nullable(entry.ScopeOrgID),Enabled:entry.Enabled,
  CreatedAt:timestamp(entry.CreatedAt),UpdatedAt:timestamp(entry.UpdatedAt),LastRunAt:timestampPtr(entry.LastRunAt),
  NextRunAt:timestampPtr(entry.NextRunAt),LockedBy:nullable(entry.LockedBy),LockedUntil:timestampPtr(entry.LockedUntil),NextFires:[]string{}}
 fires,location,err:=cron.NextFires(entry.Schedule,at,5)
 if err!=nil {row.ScheduleError=nullable("Stored schedule cannot be evaluated.");return row}
 row.Location=nullable(location.String())
 for _,fire:=range fires{row.NextFires=append(row.NextFires,fire.UTC().Format(time.RFC3339Nano))}
 if len(fires)==0{row.ScheduleError=nullable("Schedule has no fire time in the next five years.")}
 return row
}
func projectCronDetail(entry *cron.Entry,at time.Time)CronDetail{
 return CronDetail{CronRow:projectCron(entry,at),Payload:projectPayload(entry.Payload,false),AsOf:at.UTC().Format(time.RFC3339Nano)}
}
func parseCronID(raw string)(id.CronID,error){
 parsed,err:=id.ParseCronID(raw)
 if err!=nil||parsed.IsNil(){return id.CronID{},badRequest("id must be a cron ID")}
 return parsed,nil
}
func cronsListHandler(deps Deps)func(context.Context,EmptyInput,fc.Principal)(Page[CronRow],error){
 return handle(deps,"crons.list",false,func(ctx context.Context,_ EmptyInput,_ fc.Principal)(Page[CronRow],error){
  entries,err:=deps.Store.ListCrons(ctx);if err!=nil{return Page[CronRow]{},err}
  at:=time.Now();rows:=make([]CronRow,0,len(entries))
  for _,entry:=range entries{rows=append(rows,projectCron(entry,at))}
  slices.SortFunc(rows,func(a,b CronRow)int{if c:=strings.Compare(a.Name,b.Name);c!=0{return c};return strings.Compare(a.ID,b.ID)})
  return newPage(rows,"",true,at),nil
 })
}
func cronsGetHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(CronDetail,error){
 return handle(deps,"crons.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(CronDetail,error){
  cronID,err:=parseCronID(input.ID);if err!=nil{return CronDetail{},err}
  entry,err:=deps.Store.GetCron(ctx,cronID);if err!=nil{return CronDetail{},err}
  return projectCronDetail(entry,time.Now()),nil
 })
}
func cronToggleHandler(deps Deps,enabled bool)func(context.Context,IDInput,fc.Principal)(CronDetail,error){
 intent:="crons.disable";if enabled{intent="crons.enable"}
 return handle(deps,intent,true,func(ctx context.Context,input IDInput,_ fc.Principal)(CronDetail,error){
  cronID,err:=parseCronID(input.ID);if err!=nil{return CronDetail{},err}
  var entry *cron.Entry
  if enabled{
   current,readErr:=deps.Store.GetCron(ctx,cronID);if readErr!=nil{return CronDetail{},readErr}
   if projectCron(current,time.Now()).ScheduleError!=nil{return CronDetail{},cronStateConflict(current)}
   entry,err=deps.Engine.EnableCron(ctx,cronID)
  }else{entry,err=deps.Engine.DisableCron(ctx,cronID)}
  if errors.Is(err,dispatch.ErrInvalidState){
   current,readErr:=deps.Store.GetCron(ctx,cronID);if readErr!=nil{return CronDetail{},readErr}
   return CronDetail{},cronStateConflict(current)
  }
  if err!=nil{return CronDetail{},err}
  return projectCronDetail(entry,time.Now()),nil
 })
}
func cronStateConflict(entry *cron.Entry)error{
 state:="disabled";if entry.Enabled{state="enabled"}
 return &fc.Error{Code:fc.CodeConflict,Message:"the stored cron schedule cannot be enabled",Details:map[string]any{"state":state}}
}
func cronsDeleteHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(DeletedResult,error){
 return handle(deps,"crons.delete",true,func(ctx context.Context,input IDInput,_ fc.Principal)(DeletedResult,error){
  cronID,err:=parseCronID(input.ID);if err!=nil{return DeletedResult{},err}
  if err:=deps.Engine.DeleteCron(ctx,cronID);err!=nil{return DeletedResult{},err}
  return DeletedResult{ID:cronID.String(),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func cronsRunNowHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(CronRunResult,error){
 return handle(deps,"crons.runNow",true,func(ctx context.Context,input IDInput,_ fc.Principal)(CronRunResult,error){
  cronID,err:=parseCronID(input.ID);if err!=nil{return CronRunResult{},err}
  j,err:=deps.Engine.TriggerCron(ctx,cronID);if err!=nil{return CronRunResult{},err}
  return CronRunResult{CronID:cronID.String(),Job:projectJob(j),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
```

- [ ] Format owned Go files and rerun `go test -race ./extension/contract -run TestCron -count=1`. Expected: PASS.
- [ ] Run `golangci-lint run ./extension/...`. Expected: zero issues.
- [ ] Inspect branch, status, staged diff and diff-check; stage only the owned paths.
- [ ] Commit with `git commit --only -m 'feat(contract): expose cron schedules and operator actions' -- extension/contract/crons_test.go extension/contract/crons.go`. Inspect the resulting stat.

### Task 2: Register cron intents and verify the transport

**Files:** `extension/contract/crons_transport_test.go`, `extension/contract/manifest_test.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`.

- [ ] Write these tests:

`extension/contract/crons_transport_test.go`

```go
package contract

import (
 "context"
 "errors"
 "reflect"
 "testing"
 "time"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/store/memory"
)

func TestCronTransportPersistsCommandsAndInvalidates(t *testing.T){
 for _,intent:=range []string{"crons.enable","crons.disable","crons.runNow","crons.delete"}{
  t.Run(intent,func(t *testing.T){
   d:=contractDeps(t,memory.New())
   e:=seedCron(t,d,"daily","0 9 * * *",intent=="crons.disable")
   response:=callContract(t,d,"command",intent,IDInput{ID:e.ID.String()})
   var want []string
   for _,declared:=range loadManifest(t).Intents{if declared.Name==intent{want=declared.Invalidates}}
   if !reflect.DeepEqual(response.Meta.Invalidates,want){t.Fatalf("invalidates=%v, want %v",response.Meta.Invalidates,want)}
   stored,err:=d.Store.GetCron(context.Background(),e.ID)
   switch intent{
   case "crons.delete":
    if !errors.Is(err,dispatch.ErrCronNotFound){t.Fatalf("delete = %v",err)}
   case "crons.runNow":
    if err!=nil||stored.Enabled||!reflect.DeepEqual(stored.NextRunAt,e.NextRunAt){t.Fatalf("run now schedule = %+v, %v",stored,err)}
    counts,countErr:=countJobs(context.Background(),d,"mail")
    if countErr!=nil||counts.Total!=1{t.Fatalf("run now count = %+v, %v",counts,countErr)}
   default:
    if err!=nil||stored.Enabled!=(intent=="crons.enable"){t.Fatalf("toggle = %+v, %v",stored,err)}
   }
  })
 }
}
func TestCronQueriesAreRegistered(t *testing.T){
 d:=contractDeps(t,memory.New())
 e:=seedCron(t,d,"daily","0 9 * * *",true)
 callContract(t,d,"query","crons.list",EmptyInput{})
 callContract(t,d,"query","crons.get",IDInput{ID:e.ID.String()})
 // A preview is a read: it does not move the stored schedule.
 stored,err:=d.Store.GetCron(context.Background(),e.ID)
 if err!=nil||!stored.NextRunAt.Equal(*e.NextRunAt)||!stored.NextRunAt.Before(time.Now()){t.Fatalf("read changed schedule = %+v, %v",stored,err)}
}
```

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
	m, err := loader.Load(bytes.NewReader(manifestYAML), "dispatch/contract/manifest.yaml")
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestEveryDeclaredIntentIsBound(t *testing.T) {
	deps := contractDeps(t, memory.New())
	manifest := loadManifest(t)
	if manifest.Contributor.Name != ContributorName {
		t.Fatal("contributor mismatch")
	}
	bound := map[string]bool{}
	for _, b := range bindings(deps) {
		if bound[b.intent] {
			t.Fatalf("duplicate %s", b.intent)
		}
		bound[b.intent] = true
	}
	if len(bound) != len(manifest.Intents) {
		t.Fatal("manifest/binding count mismatch")
	}
	for _, in := range manifest.Intents {
		if !bound[in.Name] {
			t.Fatalf("unbound %s", in.Name)
		}
	}
	if err := Register(dispatcher.New(nil), fc.NewRegistry(), fc.NewWardenRegistry(), deps); err != nil {
		t.Fatal(err)
	}
}

func TestManifestCommandInvalidations(t *testing.T) {
	want := map[string][]string{
        "crons.enable": {"crons.list", "crons.get", "overview.summary"},
        "crons.disable": {"crons.list", "crons.get", "overview.summary"},
        "crons.delete": {"crons.list", "crons.get", "overview.summary"},
        "crons.runNow": {"crons.get", "jobs.list", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"dlq.replay":    {"dlq.list", "dlq.get", "dlq.counts", "jobs.list", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"dlq.replayAll": {"dlq.list", "dlq.get", "dlq.counts", "jobs.list", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"dlq.delete":    {"dlq.list", "dlq.get", "dlq.counts", "dlq.purgePreview", "overview.summary"},
		"dlq.purge":     {"dlq.list", "dlq.get", "dlq.counts", "dlq.purgePreview", "overview.summary"},
		"jobs.cancel":   {"jobs.list", "jobs.get", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"jobs.retry":    {"jobs.list", "jobs.get", "jobs.counts", "queues.list", "queues.get", "overview.summary", "dlq.list", "dlq.get", "dlq.counts"},
	}
	found := 0
	for _, intent := range loadManifest(t).Intents {
		if intent.Kind != fc.IntentKindCommand {
			if len(intent.Invalidates) != 0 {
				t.Fatalf("query invalidates: %s", intent.Name)
			}
			continue
		}
		found++
		if !reflect.DeepEqual(intent.Invalidates, want[intent.Name]) {
			t.Fatalf("%s invalidates=%v", intent.Name, intent.Invalidates)
		}
	}
	if found != len(want) {
		t.Fatalf("commands = %d", found)
	}
}

func TestCommandInvalidatesReachTheClient(t *testing.T) {
	for _, intent := range []string{"jobs.cancel", "jobs.retry"} {
		t.Run(intent, func(t *testing.T) {
			deps := contractDeps(t, memory.New())
			state := job.StatePending
			if intent == "jobs.retry" {
				state = job.StateFailed
			}
			j := seedJob(t, deps, "transport", state, "", "", "mail")
			reg := fc.NewRegistry()
			wreg := fc.NewWardenRegistry()
			d := dispatcher.New(nil)
			if err := Register(d, reg, wreg, deps); err != nil {
				t.Fatal(err)
			}
			payload := `{"envelope":"v1","kind":"command","contributor":"dispatch","intent":"` + intent + `","csrf":"test","idempotencyKey":"test-` + intent + `","payload":{"id":"` + j.ID.String() + `"}}`
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(payload))
			recorder := httptest.NewRecorder()
			transport.NewHandler(reg, wreg, d, nil).ServeHTTP(recorder, req)
			var response fc.Response
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || !response.OK {
				t.Fatalf("response=%s, %v", recorder.Body, err)
			}
			var want []string
			for _, declared := range loadManifest(t).Intents {
				if declared.Name == intent {
					want = declared.Invalidates
				}
			}
			if !reflect.DeepEqual(response.Meta.Invalidates, want) {
				t.Fatalf("invalidates=%v, want %v", response.Meta.Invalidates, want)
			}
			stored, err := deps.Store.GetJob(context.Background(), j.ID)
			if err != nil {
				t.Fatal(err)
			}
			expected := job.StateCancelled
			if intent == "jobs.retry" {
				expected = job.StatePending
			}
			if stored.State != expected {
				t.Fatalf("stored state=%s, want %s", stored.State, expected)
			}
		})
	}
}

func TestRegisterRejectsMissingDependencies(t *testing.T) {
	if err := Register(dispatcher.New(nil), fc.NewRegistry(), fc.NewWardenRegistry(), Deps{}); err == nil {
		t.Fatal("accepted missing engine")
	}
	deps := contractDeps(t, memory.New())
	if err := Register(nil, fc.NewRegistry(), fc.NewWardenRegistry(), deps); err == nil {
		t.Fatal("accepted missing dispatcher")
	}
}
```

- [ ] Run `go test -race ./extension/... -count=1`. Expected before implementation: unregistered cron intents and missing literal invalidation entries.

- [ ] Implement these files:

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
	bind   func(*dispatcher.Dispatcher) error
}

func query[I, O any](intent string, fn func(context.Context, I, fc.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterQuery(d, ContributorName, intent, 1, fn)
	}}
}
func command[I, O any](intent string, fn func(context.Context, I, fc.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterCommand(d, ContributorName, intent, 1, fn)
	}}
}

func bindings(deps Deps) []binding {
	return []binding{
		query("crons.list", cronsListHandler(deps)),
		query("crons.get", cronsGetHandler(deps)),
		command("crons.enable", cronToggleHandler(deps, true)),
		command("crons.disable", cronToggleHandler(deps, false)),
		command("crons.delete", cronsDeleteHandler(deps)),
		command("crons.runNow", cronsRunNowHandler(deps)),
		query("dlq.list", dlqListHandler(deps)),
		query("dlq.get", dlqGetHandler(deps)),
		query("dlq.counts", dlqCountsHandler(deps)),
		query("dlq.purgePreview", dlqPurgeHandler(deps, true)),
		command("dlq.replay", dlqReplayHandler(deps)),
		command("dlq.replayAll", dlqReplayAllHandler(deps)),
		command("dlq.delete", dlqDeleteHandler(deps)),
		command("dlq.purge", dlqPurgeHandler(deps, false)),
		query("jobs.list", jobsListHandler(deps)),
		query("jobs.get", jobsGetHandler(deps)),
		query("jobs.counts", jobsCountsHandler(deps)),
		command("jobs.cancel", jobActionHandler(deps, "jobs.cancel", deps.Engine.CancelJob)),
		command("jobs.retry", jobActionHandler(deps, "jobs.retry", deps.Engine.RetryJob)),
	}
}

// Register validates the manifest and binds only implemented intents.
func Register(d *dispatcher.Dispatcher, reg fc.Registry, wreg fc.WardenRegistry, deps Deps) error {
	if err := deps.validate(); err != nil {
		return err
	}
	if d == nil || reg == nil || wreg == nil {
		return fmt.Errorf("dispatch/contract: dispatcher and registries are required")
	}
	manifest, err := loader.Load(bytes.NewReader(manifestYAML), "dispatch/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("dispatch/contract: load manifest: %w", err)
	}
	if err := loader.Validate(manifest, wreg); err != nil {
		return fmt.Errorf("dispatch/contract: validate manifest: %w", err)
	}
	declared := make(map[string]bool, len(manifest.Intents))
	for _, intent := range manifest.Intents {
		declared[intent.Name] = true
	}
	handlers := bindings(deps)
	seen := make(map[string]bool, len(handlers))
	for _, binding := range handlers {
		if !declared[binding.intent] || seen[binding.intent] {
			return fmt.Errorf("dispatch/contract: undeclared or repeated binding %s", binding.intent)
		}
		seen[binding.intent] = true
	}
	for intent := range declared {
		if !seen[intent] {
			return fmt.Errorf("dispatch/contract: intent %s has no binding", intent)
		}
	}
	if err := reg.Register(manifest); err != nil {
		return fmt.Errorf("dispatch/contract: register manifest: %w", err)
	}
	for _, binding := range handlers {
		if err := binding.bind(d); err != nil {
			return fmt.Errorf("dispatch/contract: bind %s: %w", binding.intent, err)
		}
	}
	return nil
}
```

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
  - { name: jobs.retry, kind: command, version: 1, capability: write, invalidates: [jobs.list, jobs.get, jobs.counts, queues.list, queues.get, overview.summary, dlq.list, dlq.get, dlq.counts] }
  - { name: dlq.list, kind: query, version: 1, capability: read }
  - { name: dlq.get, kind: query, version: 1, capability: read }
  - { name: dlq.counts, kind: query, version: 1, capability: read }
  - { name: dlq.purgePreview, kind: query, version: 1, capability: read }
  - { name: dlq.replay, kind: command, version: 1, capability: write, invalidates: [dlq.list, dlq.get, dlq.counts, jobs.list, jobs.counts, queues.list, queues.get, overview.summary] }
  - { name: dlq.replayAll, kind: command, version: 1, capability: write, invalidates: [dlq.list, dlq.get, dlq.counts, jobs.list, jobs.counts, queues.list, queues.get, overview.summary] }
  - { name: dlq.delete, kind: command, version: 1, capability: write, invalidates: [dlq.list, dlq.get, dlq.counts, dlq.purgePreview, overview.summary] }
  - { name: dlq.purge, kind: command, version: 1, capability: write, invalidates: [dlq.list, dlq.get, dlq.counts, dlq.purgePreview, overview.summary] }
  - { name: crons.list, kind: query, version: 1, capability: read }
  - { name: crons.get, kind: query, version: 1, capability: read }
  - { name: crons.enable, kind: command, version: 1, capability: write, invalidates: [crons.list, crons.get, overview.summary] }
  - { name: crons.disable, kind: command, version: 1, capability: write, invalidates: [crons.list, crons.get, overview.summary] }
  - { name: crons.delete, kind: command, version: 1, capability: write, invalidates: [crons.list, crons.get, overview.summary] }
  - { name: crons.runNow, kind: command, version: 1, capability: write, invalidates: [crons.get, jobs.list, jobs.counts, queues.list, queues.get, overview.summary] }
```

- [ ] Format owned Go files and rerun `go test -race ./extension/... -count=1`. Expected: PASS.
- [ ] Run `golangci-lint run ./extension/...`. Expected: zero issues.
- [ ] Inspect branch, status, staged diff and diff-check; stage only the owned paths.
- [ ] Commit with `git commit --only -m 'feat(contract): register cron dashboard intents' -- extension/contract/crons_transport_test.go extension/contract/manifest_test.go extension/contract/contract.go extension/contract/manifest.yaml`. Inspect the resulting stat.

## Final checks

- [ ] Run go build ./..., go test ./... and ordinary golangci-lint run.
- [ ] Request one fresh final review of the whole slice.
- [ ] Reproduce and fix consequential findings before recording completion.
- [ ] Update MIGRATION.md and this plan with exact verification and remaining scope.
