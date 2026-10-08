# Dispatch Slice 3d: dead-letter contract implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose dead-letter inspection, exact counts, replay, deletion and cutoff purge through the dashboard contract.

**Architecture:** Bounded domain handlers project store records into camelCase DTOs and call the existing engine for every mutation. Bulk replay reports committed progress and a safe interruption reason without suppressing invalidations.

**Tech Stack:** Go, Forge contract transport, memory/SQLite fixtures, PostgreSQL/Redis/MongoDB testcontainers.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Work on main in the primary checkouts. Preserve concurrent module and dashboard edits. Exact-path local commits only; no push, branch or worktree.
- Operator-wide reads use explicit app/org filters and ignore principal claims. Wire scopes are null when absent.
- Cursor lists have limit 50 by default and cap 200, with negative values rejected. Complete means search coverage; nextCursor ends paging.
- Commands use engine actor context and events. Conflicts carry current replay state. No internal diagnostic reaches the client.
- Read and command deadlines remain 10 and 30 seconds. A cutoff must be a non-zero RFC 3339 timestamp and is normalized to UTC.
- Bulk replay defaults and caps at 1000 attempts. Negative limits are invalid. It is nontransactional.
- No production import of the root dashboard package. No browser parity or retirement claim in this slice.
- Use rex-voice and humanizer for shipped prose. No em dashes or attribution.

## Rulings required by the UI contract

- Add dlq.counts, with optional queue and replayed filters. A page length cannot provide the replay-all confirmation count required by the design. Add count invalidations to jobs.retry and all DLQ mutations; deletion also invalidates purgePreview because it changes that count.
- Return bulk progress with interrupted and a safe failure object when a later read fails. Earlier mutations remain committed, so this successful result envelope must still carry invalidations. Entry failures are an errors count; raw diagnostics are logged only.
- Reuse backend helpers from Slice 3c, with fresh storage per domain test. Root dependency files remain concurrent work and are not part of these commits.

## Review focus

1. Every explicit filter, conflicting scopes and empty scope must return the correct identities on all five backends, without using principal claims (Task 1 and Task 3).
2. The purge preview and mutation must use the same strict before boundary; invalid or zero cutoffs cannot mutate data (Task 1).
3. An entry replayed twice must return a state conflict, preserve scope on the created job and emit the operator actor once (Task 1).
4. Entry failures and a later-page failure must retain accurate partial counts, redact diagnostics and invalidate views through the actual HTTP envelope (Tasks 1 and 2).
5. Complete=false with an empty page and a cursor must remain distinguishable from an exhausted result; the handler must have a deadline (Task 1).

## File structure and interfaces

All source paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
Task 1 creates project_dlq.go for record projection and dlq.go for typed request,
response and handler factories. It consumes Deps, handle, payload/time helpers and
the existing engine DLQ methods. Task 2 consumes these factories in bindings and
the manifest, and extends the literal invalidation test. Task 3 consumes
runDLQDomain and the existing durable backend constructors.

### Task 1: Dead-letter reads, previews and engine actions

**Files:** `extension/contract/dlq_test.go`, `extension/contract/project_dlq.go`, `extension/contract/dlq.go`.

- [ ] Write these tests:

`extension/contract/dlq_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "errors"
 "reflect"
 "slices"
 "strings"
 "testing"
 "time"
 "github.com/xraph/forge"
 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
)

func seedDLQ(t *testing.T,d Deps,name,queue,app,org string,failed time.Time,replayed bool)*dlq.Entry{
 t.Helper()
 e:=&dlq.Entry{ID:id.NewDLQID(),JobID:id.NewJobID(),JobName:name,Queue:queue,Payload:[]byte(`{"n":9007199254740993}`),
  Error:"handler failed",RetryCount:3,MaxRetries:3,ScopeAppID:app,ScopeOrgID:org,FailedAt:failed,CreatedAt:failed,
  Priority:7,Timeout:time.Minute,LeaseTTL:time.Hour,Resources:resource.Set{"cpu":1}}
 if replayed{at:=failed.Add(time.Minute);e.ReplayedAt=&at}
 if err:=d.Store.PushDLQ(context.Background(),e);err!=nil{t.Fatal(err)}
 return e
}
func runDLQDomain(t *testing.T,s store.Store){
 t.Helper()
 recorder:=&actionRecorder{}
 d:=contractDeps(t,s,engine.WithExtension(recorder))
 p:=fc.Principal{User:&dashauth.UserInfo{Subject:"operator"},Claims:map[string]any{"scope_app_id":"app-a","scope_org_id":"org-a"}}
 ctx:=context.Background()
 base:=time.Date(2026,1,1,0,0,0,0,time.UTC)
 rows:=[]*dlq.Entry{
  seedDLQ(t,d,"mail.a","mail","app-a","org-a",base,false),
  seedDLQ(t,d,"mail.b","mail","app-b","org-b",base.Add(time.Hour),true),
  seedDLQ(t,d,"report.a","reports","app-a","org-a",base.Add(2*time.Hour),false),
  seedDLQ(t,d,"mail.c","mail","","",base.Add(3*time.Hour),false),
 }
 var got []string
 cursor:=""
 for {
  page,err:=dlqListHandler(d)(ctx,DLQListInput{Limit:2,Cursor:cursor},p);if err!=nil{t.Fatal(err)}
  for _,row:=range page.Items{got=append(got,row.ID)}
  if page.NextCursor==nil{break};cursor=*page.NextCursor
  if len(got)>len(rows){t.Fatal("cursor repeated entries")}
 }
 want:=[]string{};for _,row:=range rows{want=append(want,row.ID.String())};slices.Sort(want);slices.Reverse(want)
 if !reflect.DeepEqual(got,want){t.Fatalf("all scopes/order = %v, want %v",got,want)}
 replayed:=true
 page,err:=dlqListHandler(d)(ctx,DLQListInput{Queue:"mail",NamePrefix:"mail.",ScopeAppID:"app-b",ScopeOrgID:"org-b",Replayed:&replayed},p)
 if err!=nil||len(page.Items)!=1||page.Items[0].ID!=rows[1].ID.String(){t.Fatalf("filtered = %+v, %v",page,err)}
 unreplayed:=false
 for _,tc:=range []struct{input DLQListInput;ids []string}{
  {DLQListInput{Queue:"reports"},[]string{rows[2].ID.String()}},
  {DLQListInput{NamePrefix:"report."},[]string{rows[2].ID.String()}},
  {DLQListInput{ScopeAppID:"app-a"},[]string{rows[2].ID.String(),rows[0].ID.String()}},
  {DLQListInput{ScopeOrgID:"org-b"},[]string{rows[1].ID.String()}},
  {DLQListInput{ScopeAppID:"app-a",ScopeOrgID:"org-b"},[]string{}},
  {DLQListInput{Replayed:&unreplayed},[]string{rows[3].ID.String(),rows[2].ID.String(),rows[0].ID.String()}},
 }{
  filtered,filterErr:=dlqListHandler(d)(ctx,tc.input,p);if filterErr!=nil{t.Fatal(filterErr)}
  actual:=[]string{};for _,row:=range filtered.Items{actual=append(actual,row.ID)}
  if !reflect.DeepEqual(actual,tc.ids){t.Fatalf("filter %+v = %v, want %v",tc.input,actual,tc.ids)}
 }
 counts,err:=dlqCountsHandler(d)(ctx,DLQCountsInput{Queue:"mail",Replayed:&unreplayed},p)
 if err!=nil||counts.Count!=2{t.Fatalf("counts = %+v, %v",counts,err)}
 detail,err:=dlqGetHandler(d)(ctx,IDInput{ID:rows[3].ID.String()},p);if err!=nil{t.Fatal(err)}
 raw,_:=json.Marshal(detail)
 if detail.ScopeAppID!=nil||detail.ScopeOrgID!=nil||detail.ReplayedJobID!=nil||detail.LeaseTTL.MS!=3600000||
  !strings.Contains(string(raw),"9007199254740993")||strings.Contains(string(raw),"job_id"){t.Fatalf("detail = %s",raw)}
 preview,err:=dlqPurgeHandler(d,true)(ctx,BeforeInput{Before:rows[1].FailedAt.Format(time.RFC3339Nano)},p)
 if err!=nil||preview.Count!=1{t.Fatalf("strict cutoff = %+v, %v",preview,err)}
 for _,input:=range []DLQListInput{{Limit:-1},{Cursor:"invalid"}}{
  if _,listErr:=dlqListHandler(d)(ctx,input,p);!errors.Is(listErr,fc.ErrBadRequest){t.Fatalf("input=%+v: %v",input,listErr)}
 }
 if _,getErr:=dlqGetHandler(d)(ctx,IDInput{ID:id.NewJobID().String()},p);!errors.Is(getErr,fc.ErrBadRequest){t.Fatalf("wrong kind = %v",getErr)}
 if _,getErr:=dlqGetHandler(d)(ctx,IDInput{ID:id.NewDLQID().String()},p);!errors.Is(getErr,fc.ErrNotFound){t.Fatalf("missing = %v",getErr)}
 for _,before:=range []string{"","invalid","0001-01-01T00:00:00Z"}{
  if _,purgeErr:=dlqPurgeHandler(d,false)(ctx,BeforeInput{Before:before},p);!errors.Is(purgeErr,fc.ErrBadRequest){t.Fatalf("before=%q: %v",before,purgeErr)}
 }
 replay,err:=dlqReplayHandler(d)(ctx,IDInput{ID:rows[0].ID.String()},p)
 if err!=nil||replay.Job.ID==rows[0].JobID.String()||replay.Job.State!=job.StatePending||*replay.Job.ScopeAppID!="app-a"{t.Fatalf("replay = %+v, %v",replay,err)}
 stored,err:=d.Store.GetDLQ(ctx,rows[0].ID)
 if err!=nil||stored.ReplayedJobID==nil||stored.ReplayedJobID.String()!=replay.Job.ID{t.Fatalf("claim = %+v, %v",stored,err)}
 _,err=dlqReplayHandler(d)(ctx,IDInput{ID:rows[0].ID.String()},p)
 var ce *fc.Error
 if !errors.As(err,&ce)||ce.Code!=fc.CodeConflict{t.Fatalf("duplicate = %v",err)}
 detailsJSON,_:=json.Marshal(ce.Details)
 if !strings.Contains(string(detailsJSON),`"state":"replayed"`){t.Fatalf("conflict details = %s",detailsJSON)}
 if _,deleteErr:=dlqDeleteHandler(d)(ctx,IDInput{ID:rows[1].ID.String()},p);deleteErr!=nil{t.Fatal(deleteErr)}
 if _,getErr:=d.Store.GetDLQ(ctx,rows[1].ID);!errors.Is(getErr,dispatch.ErrDLQNotFound){t.Fatal(getErr)}
 bulk,err:=dlqReplayAllHandler(d)(ctx,DLQReplayAllInput{Queue:"mail",Limit:1},p)
 if err!=nil||bulk.Replayed!=1||bulk.Conflicts!=0||bulk.Errors!=0||bulk.Interrupted||bulk.Failure!=nil||bulk.Limit!=1{t.Fatalf("bulk = %+v, %v",bulk,err)}
 if _,bulkErr:=dlqReplayAllHandler(d)(ctx,DLQReplayAllInput{Limit:-1},p);!errors.Is(bulkErr,fc.ErrBadRequest){t.Fatalf("negative bulk limit = %v",bulkErr)}
 before:=BeforeInput{Before:base.Add(48*time.Hour).Format(time.RFC3339Nano)}
 preview,err=dlqPurgeHandler(d,true)(ctx,before,p);if err!=nil||preview.Count!=3{t.Fatalf("preview = %+v, %v",preview,err)}
 purged,err:=dlqPurgeHandler(d,false)(ctx,before,p);if err!=nil||purged.Count!=preview.Count{t.Fatalf("purge = %+v, %v",purged,err)}
 if len(recorder.actions)!=4{t.Fatalf("actions = %+v",recorder.actions)}
 for _,action:=range recorder.actions{if action.Actor!="operator"{t.Fatalf("actor = %+v",action)}}
}
func TestDLQDomainMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runDLQDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runDLQDomain(t,sqliteContractStore(t))})
}

type replayFailureStore struct {
 store.Store
 failEnqueue bool
 interruptListing bool
 pages int
}
func(s *replayFailureStore)EnqueueJob(ctx context.Context,j *job.Job)error{
 if s.failEnqueue{return errors.New("private backend password")}
 return s.Store.EnqueueJob(ctx,j)
}
func(s *replayFailureStore)ListDLQPage(ctx context.Context,o dlq.PageOpts)(dlq.Page,error){
 if s.interruptListing{
  s.pages++
  if s.pages>1{return dlq.Page{},errors.New("private backend address")}
  o.Limit=1
 }
 return s.Store.ListDLQPage(ctx,o)
}
func TestDLQBulkKeepsPartialProgressAndRedactsFailures(t *testing.T){
 for _,interrupt:=range []bool{false,true}{
  t.Run(map[bool]string{false:"entry failure",true:"later page failure"}[interrupt],func(t *testing.T){
   s:=&replayFailureStore{Store:memory.New(),failEnqueue:!interrupt,interruptListing:interrupt}
   d:=contractDeps(t,s)
   logger:=&errorRecorder{Logger:forge.NewNoopLogger()};d.Logger=logger
   seedDLQ(t,d,"one","mail","","",time.Now(),false)
   seedDLQ(t,d,"two","mail","","",time.Now(),false)
   result,err:=dlqReplayAllHandler(d)(context.Background(),DLQReplayAllInput{},fc.Principal{})
   if err!=nil{t.Fatal(err)}
   raw,_:=json.Marshal(result)
   if strings.Contains(string(raw),"private")||logger.calls!=1{t.Fatalf("result = %s, logs=%d",raw,logger.calls)}
   if interrupt{
    if result.Replayed!=1||!result.Interrupted||result.Failure==nil||result.Failure.Code!=fc.CodeInternal{t.Fatalf("partial = %+v",result)}
   }else if result.Errors!=2||result.Replayed!=0||result.Interrupted||result.Failure!=nil{t.Fatalf("failures = %+v",result)}
  })
 }
}
type incompleteDLQStore struct{store.Store}
func(s incompleteDLQStore)ListDLQPage(ctx context.Context,_ dlq.PageOpts)(dlq.Page,error){
 if _,ok:=ctx.Deadline();!ok{return dlq.Page{},errors.New("missing deadline")}
 return dlq.Page{NextCursor:"next-window",Complete:false},nil
}
func TestDLQListPreservesIncompleteSearch(t *testing.T){
 d:=contractDeps(t,incompleteDLQStore{Store:memory.New()})
 page,err:=dlqListHandler(d)(context.Background(),DLQListInput{},fc.Principal{})
 if err!=nil||page.Items==nil||page.Complete||page.NextCursor==nil||*page.NextCursor!="next-window"{t.Fatalf("page = %+v, %v",page,err)}
}
```

- [ ] Run `go test -race ./extension/contract -run TestDLQ -count=1`.

Expected before implementation: missing DLQ handler factories and projection types.

- [ ] Implement these files:

`extension/contract/project_dlq.go`

```go
package contract

import (
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/resource"
)

type DLQRow struct {
 ID string `json:"id"`
 JobID string `json:"jobId"`
 JobName string `json:"jobName"`
 Queue string `json:"queue"`
 Error *string `json:"error"`
 RetryCount int `json:"retryCount"`
 MaxRetries int `json:"maxRetries"`
 ScopeAppID *string `json:"scopeAppId"`
 ScopeOrgID *string `json:"scopeOrgId"`
 FailedAt *string `json:"failedAt"`
 CreatedAt *string `json:"createdAt"`
 ReplayedAt *string `json:"replayedAt"`
 ReplayedJobID *string `json:"replayedJobId"`
}
func projectDLQ(e *dlq.Entry) DLQRow {
 var replayedID *string
 if e.ReplayedJobID != nil && !e.ReplayedJobID.IsNil() { raw:=e.ReplayedJobID.String(); replayedID=&raw }
 return DLQRow{ID:e.ID.String(),JobID:e.JobID.String(),JobName:e.JobName,Queue:e.Queue,Error:nullable(e.Error),
  RetryCount:e.RetryCount,MaxRetries:e.MaxRetries,ScopeAppID:nullable(e.ScopeAppID),ScopeOrgID:nullable(e.ScopeOrgID),
  FailedAt:timestamp(e.FailedAt),CreatedAt:timestamp(e.CreatedAt),ReplayedAt:timestampPtr(e.ReplayedAt),ReplayedJobID:replayedID}
}
type DLQDetail struct {
 DLQRow
 Payload Payload `json:"payload"`
 Priority int `json:"priority"`
 Timeout Duration `json:"timeout"`
 LeaseTTL Duration `json:"leaseTtl"`
 ArtifactBindings Payload `json:"artifactBindings"`
 Resources resource.Set `json:"resources"`
 ResourceLimits resource.Set `json:"resourceLimits"`
 ResourceClass *string `json:"resourceClass"`
 InputBytes int64 `json:"inputBytes"`
 PrimaryInputHash *string `json:"primaryInputHash"`
 AsOf string `json:"asOf"`
}
```

`extension/contract/dlq.go`

```go
package contract

import (
 "context"
 "errors"
 "time"
 "github.com/xraph/forge"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/id"
)

type DLQListInput struct {
 Queue string `json:"queue"`
 NamePrefix string `json:"namePrefix"`
 ScopeAppID string `json:"scopeAppId"`
 ScopeOrgID string `json:"scopeOrgId"`
 Replayed *bool `json:"replayed"`
 Cursor string `json:"cursor"`
 Limit int `json:"limit"`
}
type DLQCountsInput struct {
 Queue string `json:"queue"`
 Replayed *bool `json:"replayed"`
}
type CountResult struct {
 Count int64 `json:"count"`
 AsOf string `json:"asOf"`
}
type BeforeInput struct { Before string `json:"before"` }
type DLQPurgeResult struct {
 Before string `json:"before"`
 Count int64 `json:"count"`
 AsOf string `json:"asOf"`
}
type DeletedResult struct {
 ID string `json:"id"`
 AsOf string `json:"asOf"`
}
type DLQReplayResult struct {
 EntryID string `json:"entryId"`
 Job JobRow `json:"job"`
 AsOf string `json:"asOf"`
}
type DLQReplayAllInput struct {
 Queue string `json:"queue"`
 Limit int `json:"limit"`
}
type DLQBulkResult struct {
 Replayed int `json:"replayed"`
 Conflicts int `json:"conflicts"`
 Errors int `json:"errors"`
 Limit int `json:"limit"`
 Interrupted bool `json:"interrupted"`
 Failure *fc.Error `json:"failure"`
 AsOf string `json:"asOf"`
}
func parseDLQID(raw string) (id.DLQID,error) {
 parsed,err:=id.ParseDLQID(raw)
 if err!=nil || parsed.IsNil() {return id.DLQID{},badRequest("id must be a dead letter ID")}
 return parsed,nil
}
func parseBefore(raw string) (time.Time,error) {
 parsed,err:=time.Parse(time.RFC3339Nano,raw)
 if err!=nil || parsed.IsZero() {return time.Time{},badRequest("before must be a non-zero RFC 3339 timestamp")}
 return parsed.UTC(),nil
}
func dlqListHandler(deps Deps) func(context.Context,DLQListInput,fc.Principal)(Page[DLQRow],error) {
 return handle(deps,"dlq.list",false,func(ctx context.Context,input DLQListInput,_ fc.Principal)(Page[DLQRow],error) {
  limit,err:=pageLimit(input.Limit);if err!=nil{return Page[DLQRow]{},err}
  page,err:=deps.Store.ListDLQPage(ctx,dlq.PageOpts{Queue:input.Queue,NamePrefix:input.NamePrefix,ScopeAppID:input.ScopeAppID,
   ScopeOrgID:input.ScopeOrgID,Replayed:input.Replayed,Cursor:input.Cursor,Limit:limit})
  if err!=nil{return Page[DLQRow]{},err}
  items:=make([]DLQRow,0,len(page.Entries));for _,e:=range page.Entries{items=append(items,projectDLQ(e))}
  return newPage(items,page.NextCursor,page.Complete,time.Now()),nil
 })
}
func dlqGetHandler(deps Deps) func(context.Context,IDInput,fc.Principal)(DLQDetail,error) {
 return handle(deps,"dlq.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(DLQDetail,error){
  entryID,err:=parseDLQID(input.ID);if err!=nil{return DLQDetail{},err}
  e,err:=deps.Store.GetDLQ(ctx,entryID);if err!=nil{return DLQDetail{},err}
  return DLQDetail{DLQRow:projectDLQ(e),Payload:projectPayload(e.Payload,false),Priority:e.Priority,Timeout:duration(e.Timeout),
   LeaseTTL:duration(e.LeaseTTL),ArtifactBindings:projectPayload(e.ArtifactBindings,false),Resources:resourceValues(e.Resources),
   ResourceLimits:resourceValues(e.ResourceLimits),ResourceClass:nullable(e.ResourceClass),InputBytes:e.InputBytes,
   PrimaryInputHash:nullable(e.PrimaryInputHash),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func dlqCountsHandler(deps Deps) func(context.Context,DLQCountsInput,fc.Principal)(CountResult,error) {
 return handle(deps,"dlq.counts",false,func(ctx context.Context,input DLQCountsInput,_ fc.Principal)(CountResult,error){
  n,err:=deps.Store.CountDLQEntries(ctx,dlq.CountOpts{Queue:input.Queue,Replayed:input.Replayed})
  if err!=nil{return CountResult{},err}
  return CountResult{Count:n,AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func dlqPurgeHandler(deps Deps,preview bool) func(context.Context,BeforeInput,fc.Principal)(DLQPurgeResult,error) {
 intent:="dlq.purge";if preview{intent="dlq.purgePreview"}
 return handle(deps,intent,!preview,func(ctx context.Context,input BeforeInput,_ fc.Principal)(DLQPurgeResult,error){
  before,err:=parseBefore(input.Before);if err!=nil{return DLQPurgeResult{},err}
  var n int64
  if preview {n,err=deps.Engine.CountDLQPurge(ctx,before)} else {n,err=deps.Engine.PurgeDLQ(ctx,before)}
  if err!=nil{return DLQPurgeResult{},err}
  return DLQPurgeResult{Before:before.Format(time.RFC3339Nano),Count:n,AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func dlqReplayHandler(deps Deps) func(context.Context,IDInput,fc.Principal)(DLQReplayResult,error) {
 return handle(deps,"dlq.replay",true,func(ctx context.Context,input IDInput,_ fc.Principal)(DLQReplayResult,error){
  entryID,err:=parseDLQID(input.ID);if err!=nil{return DLQReplayResult{},err}
  j,err:=deps.Engine.ReplayDLQ(ctx,entryID)
  if errors.Is(err,dispatch.ErrDLQAlreadyReplayed){return DLQReplayResult{},stateConflict("replayed")}
  if err!=nil{return DLQReplayResult{},err}
  return DLQReplayResult{EntryID:entryID.String(),Job:projectJob(j),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func dlqDeleteHandler(deps Deps) func(context.Context,IDInput,fc.Principal)(DeletedResult,error) {
 return handle(deps,"dlq.delete",true,func(ctx context.Context,input IDInput,_ fc.Principal)(DeletedResult,error){
  entryID,err:=parseDLQID(input.ID);if err!=nil{return DeletedResult{},err}
  if err:=deps.Engine.DeleteDLQ(ctx,entryID);err!=nil{return DeletedResult{},err}
  return DeletedResult{ID:entryID.String(),AsOf:time.Now().UTC().Format(time.RFC3339Nano)},nil
 })
}
func dlqReplayAllHandler(deps Deps) func(context.Context,DLQReplayAllInput,fc.Principal)(DLQBulkResult,error) {
 return handle(deps,"dlq.replayAll",true,func(ctx context.Context,input DLQReplayAllInput,_ fc.Principal)(DLQBulkResult,error){
  if input.Limit<0{return DLQBulkResult{},badRequest("limit must not be negative")}
  limit:=input.Limit;if limit==0 || limit>1000{limit=1000}
  result,err:=deps.Engine.ReplayAllDLQ(ctx,engine.ReplayAllOpts{Queue:input.Queue,Limit:limit})
  out:=DLQBulkResult{Replayed:result.Replayed,Conflicts:result.Conflicts,Errors:result.Failed,Limit:limit,
   Interrupted:err!=nil,AsOf:time.Now().UTC().Format(time.RFC3339Nano)}
  if len(result.Errors)>0 && deps.Logger!=nil{
   deps.Logger.Error("dispatch/contract: bulk replay entries failed",forge.F("intent","dlq.replayAll"),forge.F("errors",result.Errors))
  }
  if err!=nil{
   mapped:=deps.mapError("dlq.replayAll",err)
   var failure *fc.Error
   if errors.As(mapped,&failure){out.Failure=failure}
  }
  // Earlier writes remain committed when a later read fails. Return their counts
  // with a safe failure so the transport still invalidates the affected views.
  return out,nil
 })
}
```

- [ ] Format owned Go files with goimports and rerun `go test -race ./extension/contract -run TestDLQ -count=1`. Expected: PASS without backend skips.
- [ ] Run scoped golangci-lint (with integration tags for Task 3). Expected: zero issues.
- [ ] Inspect branch, status, staged diff and diff-check. Stage only the task's paths and commit with `git commit --only -m 'feat(contract): expose dead-letter reads and operator actions' -- <the exact paths listed above>`. Inspect the resulting stat.

### Task 2: Bind dead-letter intents and verify HTTP effects

**Files:** `extension/contract/dlq_transport_test.go`, `extension/contract/manifest_test.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`.

- [ ] Write these tests:

`extension/contract/dlq_transport_test.go`

```go
package contract

import (
 "bytes"
 "context"
 "encoding/json"
 "net/http"
 "net/http/httptest"
 "reflect"
 "testing"
 "time"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
 "github.com/xraph/forge/extensions/dashboard/contract/transport"
 "github.com/xraph/dispatch/dlq"
 "github.com/xraph/dispatch/store/memory"
)

func callContract(t *testing.T,deps Deps,kind,intent string,payload any)fc.Response{
 t.Helper()
 reg:=fc.NewRegistry();wreg:=fc.NewWardenRegistry();d:=dispatcher.New(nil)
 if err:=Register(d,reg,wreg,deps);err!=nil{t.Fatal(err)}
 body,err:=json.Marshal(map[string]any{"envelope":"v1","kind":kind,"contributor":"dispatch","intent":intent,"csrf":"test","idempotencyKey":"test-"+intent,"payload":payload})
 if err!=nil{t.Fatal(err)}
 recorder:=httptest.NewRecorder()
 req:=httptest.NewRequestWithContext(context.Background(),http.MethodPost,"/api/dashboard/v1",bytes.NewReader(body))
 transport.NewHandler(reg,wreg,d,nil).ServeHTTP(recorder,req)
 var response fc.Response
 if decodeErr:=json.Unmarshal(recorder.Body.Bytes(),&response);decodeErr!=nil||!response.OK{t.Fatalf("response=%s, error=%v",recorder.Body,decodeErr)}
 return response
}
func TestDLQTransportPersistsEveryCommandAndInvalidates(t *testing.T){
 for _,intent:=range []string{"dlq.replay","dlq.replayAll","dlq.delete","dlq.purge"}{
  t.Run(intent,func(t *testing.T){
   d:=contractDeps(t,memory.New())
   entry:=seedDLQ(t,d,"mail","mail","","",time.Now().Add(-time.Hour),false)
   var payload any=IDInput{ID:entry.ID.String()}
   if intent=="dlq.replayAll"{payload=DLQReplayAllInput{Queue:"mail",Limit:1}}
   if intent=="dlq.purge"{payload=BeforeInput{Before:time.Now().UTC().Format(time.RFC3339Nano)}}
   response:=callContract(t,d,"command",intent,payload)
   var want []string
   for _,declared:=range loadManifest(t).Intents{if declared.Name==intent{want=declared.Invalidates}}
   if !reflect.DeepEqual(response.Meta.Invalidates,want){t.Fatalf("invalidates=%v, want %v",response.Meta.Invalidates,want)}
   if intent=="dlq.replay"||intent=="dlq.replayAll"{
    stored,err:=d.Store.GetDLQ(context.Background(),entry.ID)
    if err!=nil||stored.ReplayedAt==nil||stored.ReplayedJobID==nil{t.Fatalf("entry=%+v, %v",stored,err)}
   }else{
    count,err:=d.Store.CountDLQEntries(context.Background(),dlq.CountOpts{})
    if err!=nil||count!=0{t.Fatalf("remaining=%d, %v",count,err)}
   }
  })
 }
}
func TestDLQPartialTransportKeepsInvalidations(t *testing.T){
 s:=&replayFailureStore{Store:memory.New(),interruptListing:true}
 d:=contractDeps(t,s)
 seedDLQ(t,d,"one","mail","","",time.Now(),false);seedDLQ(t,d,"two","mail","","",time.Now(),false)
 response:=callContract(t,d,"command","dlq.replayAll",DLQReplayAllInput{})
 var result DLQBulkResult
 if err:=json.Unmarshal(response.Data,&result);err!=nil{t.Fatal(err)}
 if result.Replayed!=1||!result.Interrupted||len(response.Meta.Invalidates)==0{t.Fatalf("response=%+v, result=%+v",response,result)}
}
func TestDLQQueriesAreRegistered(t *testing.T){
 d:=contractDeps(t,memory.New())
 e:=seedDLQ(t,d,"one","mail","","",time.Now().Add(-time.Hour),false)
 for intent,payload:=range map[string]any{"dlq.list":DLQListInput{},"dlq.get":IDInput{ID:e.ID.String()},
  "dlq.counts":DLQCountsInput{},"dlq.purgePreview":BeforeInput{Before:time.Now().UTC().Format(time.RFC3339Nano)}}{
  t.Run(intent,func(t *testing.T){callContract(t,d,"query",intent,payload)})
 }
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
		"dlq.replay": {"dlq.list", "dlq.get", "dlq.counts", "jobs.list", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"dlq.replayAll": {"dlq.list", "dlq.get", "dlq.counts", "jobs.list", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"dlq.delete": {"dlq.list", "dlq.get", "dlq.counts", "dlq.purgePreview", "overview.summary"},
		"dlq.purge": {"dlq.list", "dlq.get", "dlq.counts", "dlq.purgePreview", "overview.summary"},
		"jobs.cancel": {"jobs.list", "jobs.get", "jobs.counts", "queues.list", "queues.get", "overview.summary"},
		"jobs.retry":  {"jobs.list", "jobs.get", "jobs.counts", "queues.list", "queues.get", "overview.summary", "dlq.list", "dlq.get", "dlq.counts"},
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

- [ ] Run `go test -race ./extension/... -count=1`.

Expected before implementation: manifest invalidation count and unregistered DLQ transport intents.

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
```

- [ ] Format owned Go files with goimports and rerun `go test -race ./extension/... -count=1`. Expected: PASS without backend skips.
- [ ] Run scoped golangci-lint (with integration tags for Task 3). Expected: zero issues.
- [ ] Inspect branch, status, staged diff and diff-check. Stage only the task's paths and commit with `git commit --only -m 'feat(contract): register dead-letter intents and count invalidations' -- <the exact paths listed above>`. Inspect the resulting stat.

### Task 3: Qualify dead-letter behavior on durable backends

**Files:** `extension/contract/dlq_integration_test.go`.

- [ ] Write these tests:

`extension/contract/dlq_integration_test.go`

```go
//go:build integration

package contract

import "testing"

func TestDLQDomainOtherBackends(t *testing.T){
 t.Run("postgres",func(t *testing.T){runDLQDomain(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runDLQDomain(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runDLQDomain(t,mongoContractStore(t))})
}
```

- [ ] Run `go test -tags integration -race ./extension/contract -run TestDLQDomainOtherBackends -count=1 -v`.

Expected before implementation: qualification of existing behavior; no artificial failing step.

- [ ] Format owned Go files with goimports and rerun `go test -tags integration -race ./extension/contract -run TestDLQDomainOtherBackends -count=1 -v`. Expected: PASS without backend skips.
- [ ] Run scoped golangci-lint (with integration tags for Task 3). Expected: zero issues.
- [ ] Inspect branch, status, staged diff and diff-check. Stage only the task's paths and commit with `git commit --only -m 'test(contract): qualify dead letters on durable backends' -- <the exact paths listed above>`. Inspect the resulting stat.

## Final checks

- [ ] Run go build ./..., go test ./... and ordinary golangci-lint run.
- [ ] Request one fresh review of this slice after all tasks pass.
- [ ] Fix consequential findings with a failing regression test first.
- [ ] Record verified scope and remaining domains in MIGRATION.md and this plan.
