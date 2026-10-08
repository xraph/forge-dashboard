# Dispatch Slice 3g: workflow contract implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators inspect persisted workflow runs and confirm replay against the exact run generation they reviewed.

**Architecture:** Redis read failures propagate before replay can prune checkpoints. A new generation-aware runner and engine method preserve existing callers while the dashboard contract requires a preview generation. Typed handlers project persisted runs, checkpoints and immediate children, with registered version information.

**Tech Stack:** Go, Forge contract transport, five Dispatch stores, testcontainers.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Work directly on main in both primary checkouts. Preserve concurrent module and dashboard edits. Focused local commits, no branches, worktrees or push.
- Operator-wide reads with explicit scope filters. Never infer scope from principal claims.
- CamelCase wire fields, UTC RFC 3339 timestamps, null absent fields, JSON or opaque payload envelopes. Default list limit 50, maximum 200; negative values are BAD_REQUEST.
- Reads have a 10-second request bound; commands have 30 seconds. Preserve error redaction and actor context.
- Replay uses the recorded definition version and the shared checkpoint timestamp/ID order. The target checkpoint stays.
- No templ retirement or browser parity claim in this backend slice.
- Use rex-voice and humanizer for shipped prose. No em dashes or attribution.

## Review focus

1. A stale confirmation submitted after another replay completes must conflict without another execution or audit action (Tasks 2 and 3).
2. A claim racing after a valid generation comparison must still lose atomically (Task 2).
3. Redis GET failures and corrupt checkpoint/run records must surface as errors, while genuine dangling index members can be skipped (Task 1).
4. An unversioned historical run must replay version 1 even when version 2 is registered; a missing definition must stay inspectable and refuse replay (Task 3).
5. Empty incomplete pages must keep their continuation cursor, and checkpoint/child read failures must not become empty detail sections (Task 3).

## Rulings

- Add workflows.replayPreview as a query and invalidate it after replay. A confirmation needs server-calculated affected checkpoints even though the design's query table listed only list/get.
- Require expectedGeneration on the contract command. The existing engine API remains compatible; the new API compares the generation used to build the plan and the existing atomic claim compares it again.
- Redis pruning reads and validates its complete checkpoint list before any deletion. It can still fail during writes, but cannot silently preserve an unreadable checkpoint while reporting success.
- Return recordedVersion separately from effective version. Legacy zero executes version 1.
- Return immediate children and a parent link. You can expand descendants by reading each child; this avoids fabricating a dependency graph.
- Preserve the foundation's opaque checkpoint envelope, whose kind is gob. The viewer must describe it as opaque checkpoint data because some engine checkpoints also contain raw IDs or zero bytes.
- Return a null duration for missing or inconsistent times. Running duration uses the response time; completed duration uses the stored completion time.
- This slice does not change startup ResumeAll ownership or ordinary caller-owned workflow execution.

## File structure and interfaces

Paths below are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
Task 1 changes Redis workflow reads. Task 2 adds Runner.ReplayFromGeneration and
Engine.ReplayWorkflowFromGeneration(ctx, runID, fromStep, generation), returning
the same ReplayPlan as existing methods. Task 3 consumes that engine method and
the existing Page, Payload, Duration, handle, error helpers and contractDeps test
fixture. Task 4 binds the four factories in contract.go and manifest.yaml, reuses
callContract for HTTP transport, and runs the shared domain fixture on PostgreSQL,
Redis and MongoDB as well as memory and SQLite.

### Task 1: Propagate Redis workflow read failures

**Files:** `store/redis/workflow_errors_test.go`, `store/redis/workflow.go`.

- [ ] Write these tests:

`store/redis/workflow_errors_test.go`

```go
//go:build integration

package redis_test

import (
 "context"
 "encoding/json"
 "errors"
 "fmt"
 "net"
 "sync/atomic"
 "testing"

 goredis "github.com/redis/go-redis/v9"
 "github.com/xraph/grove/kv/drivers/redisdriver"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/id"
 redisstore "github.com/xraph/dispatch/store/redis"
 "github.com/xraph/dispatch/workflow"
)

type workflowReadFault struct{ key atomic.Value }
func (h *workflowReadFault) DialHook(next goredis.DialHook) goredis.DialHook { return func(ctx context.Context,n,a string)(net.Conn,error){return next(ctx,n,a)} }
func (h *workflowReadFault) ProcessPipelineHook(next goredis.ProcessPipelineHook) goredis.ProcessPipelineHook {return next}
func (h *workflowReadFault) ProcessHook(next goredis.ProcessHook) goredis.ProcessHook {
 return func(ctx context.Context,cmd goredis.Cmder)error{
  if cmd.Name()=="get" && fmt.Sprint(cmd.Args()[1])==h.key.Load().(string){
   err:=errors.New("injected workflow read outage")
   cmd.SetErr(err)
   return err
  }
  return next(ctx,cmd)
 }
}

func TestWorkflowReadsRejectPartialResults(t *testing.T){
 ctx:=context.Background()
 kvStore:=setupTestKV(t);s:=redisstore.New(kvStore);client:=redisdriver.UnwrapClient(kvStore)
 hook:=&workflowReadFault{};hook.key.Store("");client.AddHook(hook)
 parent:=id.NewRunID()
 run:=&workflow.Run{Entity:dispatch.NewEntity(),ID:id.NewRunID(),Name:"child",State:workflow.RunStateCompleted,ParentRunID:&parent}
 if err:=s.CreateRun(ctx,run);err!=nil{t.Fatal(err)}
 for _,step:=range []string{"target","later"}{if err:=s.SaveCheckpoint(ctx,run.ID,step,[]byte("{}"));err!=nil{t.Fatal(err)}}
 runKey:="dispatch:run:"+run.ID.String()
 cpKey:="dispatch:checkpoint:"+run.ID.String()+":later"
 reads:=map[string]struct{key string;call func()error}{
  "runs":{runKey,func()error{_,err:=s.ListRuns(ctx,workflow.ListOpts{});return err}},
  "children":{runKey,func()error{_,err:=s.ListChildRuns(ctx,parent);return err}},
  "checkpoints":{cpKey,func()error{_,err:=s.ListCheckpoints(ctx,run.ID);return err}},
  "pruning":{cpKey,func()error{return s.DeleteCheckpointsAfter(ctx,run.ID,"target")}},
 }
 for name,read:=range reads{
  t.Run(name,func(t *testing.T){
   original,err:=client.Get(ctx,read.key).Bytes();if err!=nil{t.Fatal(err)}
   for _,mode:=range []string{"outage","json","id","parent-or-run-id"}{
    t.Run(mode,func(t *testing.T){
     t.Cleanup(func(){hook.key.Store("");if err:=client.Set(ctx,read.key,original,0).Err();err!=nil{t.Error(err)}})
     if mode=="outage"{hook.key.Store(read.key)} else {
      raw:=[]byte("{broken")
      if mode!="json"{
       var record map[string]json.RawMessage
       if err:=json.Unmarshal(original,&record);err!=nil{t.Fatal(err)}
       field:="id"
       if mode=="parent-or-run-id"{field="parent_run_id";if read.key==cpKey{field="run_id"}}
       record[field]=json.RawMessage(`"invalid"`)
       raw,err=json.Marshal(record);if err!=nil{t.Fatal(err)}
      }
      if err:=client.Set(ctx,read.key,raw,0).Err();err!=nil{t.Fatal(err)}
     }
     if err:=read.call();err==nil{t.Fatal("read failure became a successful partial result")}
    })
   }
  })
 }
 // Preflight pruning must leave the valid target and unreadable later entry intact.
 for _,step:=range []string{"target","later"}{
  data,err:=s.GetCheckpoint(ctx,run.ID,step);if err!=nil||data==nil{t.Fatalf("checkpoint %s lost: %s, %v",step,data,err)}
 }
 // A dangling set member is different from an outage or a corrupt record.
 if err:=client.SAdd(ctx,"dispatch:run_ids",id.NewRunID().String()).Err();err!=nil{t.Fatal(err)}
 if err:=client.SAdd(ctx,"dispatch:checkpoint_idx:"+run.ID.String(),"missing").Err();err!=nil{t.Fatal(err)}
 runs,err:=s.ListChildRuns(ctx,parent);if err!=nil||len(runs)!=1||runs[0].ID!=run.ID{t.Fatalf("dangling run index: %v, %v",runs,err)}
 cps,err:=s.ListCheckpoints(ctx,run.ID);if err!=nil||len(cps)!=2{t.Fatalf("dangling checkpoint index: %v, %v",cps,err)}
}
```

- [ ] Run `go test -tags integration -race ./store/redis -run 'TestWorkflowReadsRejectPartialResults|TestCheckpointOrderConformance|TestWorkflowConformance' -count=1 -v` before implementation. Expected: FAIL. The new Redis test fails because read outages and corrupt records become successful partial results.

- [ ] Apply this implementation:

```diff
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-if getErr := s.getEntity(ctx, s.keys.run(rID), &e); getErr != nil {
-			continue
-		}
+if getErr := s.getEntity(ctx, s.keys.run(rID), &e); getErr != nil {
+			if isNotFound(getErr) { continue }
+			return nil, fmt.Errorf("dispatch/redis: list runs read: %w", getErr)
+		}
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-if convErr != nil {
-			continue
-		}
+if convErr != nil {
+			return nil, fmt.Errorf("dispatch/redis: list runs convert: %w", convErr)
+		}
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-		if getErr := s.getEntity(ctx, key, &e); getErr != nil {
-			continue
-		}
-
-		cpID, _ := id.ParseCheckpointID(e.ID)  //nolint:errcheck // best-effort
-		rIDParsed, _ := id.ParseRunID(e.RunID) //nolint:errcheck // best-effort
-
+		if getErr := s.getEntity(ctx, key, &e); getErr != nil {
+			if isNotFound(getErr) { continue }
+			return nil, fmt.Errorf("dispatch/redis: list checkpoints read: %w", getErr)
+		}
+
+		cpID, parseErr := id.ParseCheckpointID(e.ID)
+		if parseErr != nil || cpID.IsNil() {
+			return nil, fmt.Errorf("dispatch/redis: invalid checkpoint ID %q", e.ID)
+		}
+		rIDParsed, parseErr := id.ParseRunID(e.RunID)
+		if parseErr != nil || rIDParsed != runID || e.StepName != step {
+			return nil, fmt.Errorf("dispatch/redis: checkpoint identity mismatch for run %s step %q", runID, step)
+		}
+
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-func (s *Store) DeleteCheckpointsAfter(ctx context.Context, runID id.RunID, afterStep string) error {
-	rID := runID.String()
-
-	// Get the target checkpoint's time.
-	var target checkpointEntity
-	if err := s.getEntity(ctx, s.keys.checkpoint(rID, afterStep), &target); err != nil {
-		if isNotFound(err) {
-			return nil // step not found; nothing to delete
-		}
-		return fmt.Errorf("dispatch/redis: get target checkpoint: %w", err)
-	}
-
-	// List all step names for this run.
-	steps, err := s.rdb.SMembers(ctx, s.keys.checkpointIndex(rID)).Result()
-	if err != nil {
-		return fmt.Errorf("dispatch/redis: list checkpoint steps: %w", err)
-	}
-
-	for _, step := range steps {
-		key := s.keys.checkpoint(rID, step)
-		var e checkpointEntity
-		if getErr := s.getEntity(ctx, key, &e); getErr != nil {
-			continue
-		}
-		if e.CreatedAt.After(target.CreatedAt) || (e.CreatedAt.Equal(target.CreatedAt) && e.ID > target.ID) {
-			if delErr := s.rdb.Del(ctx, key).Err(); delErr != nil {
-				return fmt.Errorf("delete checkpoint %s: %w", key, delErr)
-			}
-			if remErr := s.rdb.SRem(ctx, s.keys.checkpointIndex(rID), step).Err(); remErr != nil {
-				return fmt.Errorf("remove checkpoint index %s: %w", step, remErr)
-			}
-		}
-	}
-	return nil
-}
-
+func (s *Store) DeleteCheckpointsAfter(ctx context.Context, runID id.RunID, afterStep string) error {
+	// Resolve the whole boundary before deleting anything. A failed read
+	// cannot turn into a replay that silently keeps a later checkpoint.
+	checkpoints, err := s.ListCheckpoints(ctx, runID)
+	if err != nil { return err }
+	var target *workflow.Checkpoint
+	for _, cp := range checkpoints {
+		if cp.StepName == afterStep { target = cp; break }
+	}
+	if target == nil { return nil }
+	rID := runID.String()
+	for _, cp := range checkpoints {
+		if workflow.CompareCheckpoints(cp, target) <= 0 { continue }
+		key := s.keys.checkpoint(rID, cp.StepName)
+		if err := s.rdb.Del(ctx, key).Err(); err != nil {
+			return fmt.Errorf("delete checkpoint %s: %w", key, err)
+		}
+		if err := s.rdb.SRem(ctx, s.keys.checkpointIndex(rID), cp.StepName).Err(); err != nil {
+			return fmt.Errorf("remove checkpoint index %s: %w", cp.StepName, err)
+		}
+	}
+	return nil
+}
+
```

- [ ] Format owned Go files with goimports. Run `go test -tags integration -race ./store/redis -run 'TestWorkflowReadsRejectPartialResults|TestCheckpointOrderConformance|TestWorkflowConformance' -count=1 -v`. Expected: PASS; inspect JSON or verbose output for skips before claiming backend verification.
- [ ] Run scoped lint with --allow-serial-runners. Integration-tag Redis lint may report only the documented pre-existing store_test.go:54 shadow.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'fix(redis): preserve workflow read failures before replay' -- store/redis/workflow_errors_test.go store/redis/workflow.go`. Inspect the commit stat and record evidence.

### Task 2: Bind replay execution to the reviewed generation

**Files:** `workflow/replay_generation_test.go`, `engine/ops_workflow_generation_test.go`, `workflow/replay.go`, `engine/ops_workflow.go`.

- [ ] Write these tests:

`workflow/replay_generation_test.go`

```go
package workflow_test

import (
 "context"
 "errors"
 "sync/atomic"
 "testing"
 "time"

 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func TestReplayFromGenerationRejectsStalePreview(t *testing.T){
 ctx:=context.Background();s:=memory.New();r,reg,ends:=newReplayRunner(t,s,s)
 var calls atomic.Int32
 workflow.RegisterDefinition(reg,workflow.NewWorkflow("preview",func(wf *workflow.Workflow,_ struct{})error{
  if err:=wf.Step("target",func(context.Context)error{return nil});err!=nil{return err}
  calls.Add(1);return nil
 }))
 run,err:=r.StartRaw(ctx,"preview",[]byte("{}"));if err!=nil{t.Fatal(err)};waitEnd(t,ends)
 plan,err:=r.PlanReplay(ctx,run.ID,"target");if err!=nil{t.Fatal(err)}
 if _,err:=r.ReplayFromGeneration(ctx,run.ID,"target",plan.Generation);err!=nil{t.Fatal(err)};waitEnd(t,ends)
 for _,generation:=range []int64{plan.Generation,-1,plan.Generation+2}{
  if _,err:=r.ReplayFromGeneration(ctx,run.ID,"target",generation);!errors.Is(err,dispatch.ErrInvalidState){t.Fatalf("generation %d accepted: %v",generation,err)}
 }
 if calls.Load()!=2{t.Fatalf("stale preview executed: %d",calls.Load())}
 fresh,err:=r.PlanReplay(ctx,run.ID,"target");if err!=nil{t.Fatal(err)}
 if _,err:=r.ReplayFromGeneration(ctx,run.ID,"target",fresh.Generation);err!=nil{t.Fatal(err)};waitEnd(t,ends)
 if calls.Load()!=3{t.Fatalf("fresh preview did not execute: %d",calls.Load())}
}

func TestReplayFromGenerationStillFencesTheClaim(t *testing.T){
 ctx,cancel:=context.WithTimeout(context.Background(),5*time.Second);defer cancel()
 s:=&delayedReopen{Store:memory.New(),entered:make(chan struct{}),release:make(chan struct{})}
 r,reg,ends:=newReplayRunner(t,s,s.Store)
 workflow.RegisterDefinition(reg,workflow.NewWorkflow("claim",func(wf *workflow.Workflow,_ struct{})error{return wf.Step("target",func(context.Context)error{return nil})}))
 run,err:=r.StartRaw(ctx,"claim",[]byte("{}"));if err!=nil{t.Fatal(err)};waitEnd(t,ends)
 result:=make(chan error,1)
 go func(){_,err:=r.ReplayFromGeneration(ctx,run.ID,"target",0);result<-err}()
 select{case <-s.entered:case <-ctx.Done():t.Fatal("claim not reached")}
 if _,err:=r.ReplayFromGeneration(ctx,run.ID,"target",0);err!=nil{close(s.release);t.Fatal(err)}
 waitEnd(t,ends);close(s.release)
 if err:=<-result;!errors.Is(err,dispatch.ErrInvalidState){t.Fatalf("overlap accepted: %v",err)}
}
```

`engine/ops_workflow_generation_test.go`

```go
package engine_test

import (
 "context"
 "errors"
 "sync/atomic"
 "testing"

 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/ext"
)

func TestEngineReplayFromGenerationEmitsOnlyForAcceptedPreview(t *testing.T){
 var fail atomic.Bool;var calls atomic.Int32
 eng,_,rec:=replayEngine(t,&fail,nil,&calls)
 t.Cleanup(func(){_ = eng.Stop(context.Background())})
 run,err:=engine.StartWorkflow(context.Background(),eng,"eng-replay",struct{}{});if err!=nil{t.Fatal(err)};rec.waitEnd(t)
 ctx:=ext.WithActor(context.Background(),"preview-operator")
 if _,err:=eng.ReplayWorkflowFromGeneration(ctx,run.ID,"step-1",0);err!=nil{t.Fatal(err)};rec.waitEnd(t)
 if _,err:=eng.ReplayWorkflowFromGeneration(ctx,run.ID,"step-1",0);!errors.Is(err,dispatch.ErrInvalidState){t.Fatalf("stale preview: %v",err)}
 actions:=rec.recorded()
 if len(actions)!=1||actions[0].Actor!="preview-operator"||actions[0].Kind!=ext.ActionWorkflowReplayed{t.Fatalf("actions = %+v",actions)}
}
```

- [ ] Run `go test -race ./workflow ./engine -run 'TestReplay|TestEngine.*Replay' -count=1` before implementation. Expected: FAIL. The new generation-aware methods do not exist.

- [ ] Apply this implementation:

```diff
--- a/workflow/replay.go
+++ b/workflow/replay.go
@@
-func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error) {
-	plan, runner, err := r.planReplay(ctx, runID, fromStep)
+func (r *Runner) ReplayFrom(ctx context.Context, runID id.RunID, fromStep string) (*ReplayPlan, error) {
+	return r.replayFrom(ctx, runID, fromStep, nil)
+}
+
+// ReplayFromGeneration requires the generation returned by PlanReplay.
+// A stale confirmation is refused before claiming or pruning the run.
+func (r *Runner) ReplayFromGeneration(ctx context.Context, runID id.RunID, fromStep string, generation int64) (*ReplayPlan, error) {
+	return r.replayFrom(ctx, runID, fromStep, &generation)
+}
+
+func (r *Runner) replayFrom(ctx context.Context, runID id.RunID, fromStep string, generation *int64) (*ReplayPlan, error) {
+	plan, runner, err := r.planReplay(ctx, runID, fromStep)
--- a/workflow/replay.go
+++ b/workflow/replay.go
@@
-	if plan.State == RunStateRunning {
+	if generation != nil && (*generation < 0 || *generation != plan.Generation) {
+		return nil, fmt.Errorf("%w: run %s replay generation changed", dispatch.ErrInvalidState, runID)
+	}
+	if plan.State == RunStateRunning {
--- a/engine/ops_workflow.go
+++ b/engine/ops_workflow.go
@@
-	eng.extensions.EmitOperatorAction(ctx, ext.Action{
-		Kind:  ext.ActionWorkflowReplayed,
-		RunID: runID,
-		Step:  fromStep,
-	})
-	return plan, nil
-}
+	eng.emitWorkflowReplay(ctx, runID, fromStep)
+	return plan, nil
+}
+
+// ReplayWorkflowFromGeneration starts replay only if the reviewed generation
+// still matches. It emits an operator action only after a successful launch.
+func (eng *Engine) ReplayWorkflowFromGeneration(ctx context.Context, runID id.RunID, fromStep string, generation int64) (*workflow.ReplayPlan, error) {
+	plan, err := eng.wfRunner.ReplayFromGeneration(ctx, runID, fromStep, generation)
+	if err != nil { return nil, err }
+	eng.emitWorkflowReplay(ctx, runID, fromStep)
+	return plan, nil
+}
+
+func (eng *Engine) emitWorkflowReplay(ctx context.Context, runID id.RunID, fromStep string) {
+	eng.extensions.EmitOperatorAction(ctx, ext.Action{
+		Kind: ext.ActionWorkflowReplayed, RunID: runID, Step: fromStep,
+	})
+}
```

- [ ] Format owned Go files with goimports. Run `go test -race ./workflow ./engine -run 'TestReplay|TestEngine.*Replay' -count=1`. Expected: PASS; inspect JSON or verbose output for skips before claiming backend verification.
- [ ] Run scoped lint with --allow-serial-runners. Integration-tag Redis lint may report only the documented pre-existing store_test.go:54 shadow.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'feat(workflow): reject replay confirmations from stale generations' -- workflow/replay_generation_test.go engine/ops_workflow_generation_test.go workflow/replay.go engine/ops_workflow.go`. Inspect the commit stat and record evidence.

### Task 3: Expose workflow projections and engine-backed replay handlers

**Files:** `extension/contract/workflows_test.go`, `extension/contract/project_workflow.go`, `extension/contract/workflows.go`.

- [ ] Write these tests:

`extension/contract/workflows_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "errors"
 "reflect"
 "slices"
 "strings"
 "sync/atomic"
 "testing"
 "time"

 dashauth "github.com/xraph/forge/extensions/dashboard/auth"
 fc "github.com/xraph/forge/extensions/dashboard/contract"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/ext"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func seedWorkflow(t *testing.T,d Deps,name string,state workflow.RunState,app,org string,parent *id.RunID)*workflow.Run{
 t.Helper()
 now:=time.Now().UTC();started:=now.Add(-90*time.Second)
 run:=&workflow.Run{Entity:dispatch.NewEntity(),ID:id.NewRunID(),Name:name,State:state,Input:[]byte(`{"n":9007199254740993}`),
  ScopeAppID:app,ScopeOrgID:org,StartedAt:started,ParentRunID:parent}
 if state!=workflow.RunStateRunning{run.CompletedAt=&now}
 if err:=d.Store.CreateRun(context.Background(),run);err!=nil{t.Fatal(err)}
 return run
}
func runWorkflowDomain(t *testing.T,s store.Store){
 t.Helper();d:=contractDeps(t,s);ctx:=context.Background()
 runs:=[]*workflow.Run{
  seedWorkflow(t,d,"order.a",workflow.RunStateCompleted,"app-a","org-a",nil),
  seedWorkflow(t,d,"order.b",workflow.RunStateFailed,"app-b","org-b",nil),
  seedWorkflow(t,d,"report",workflow.RunStateRunning,"app-a","org-a",nil),
  seedWorkflow(t,d,"order.c",workflow.RunStateCompleted,"","",nil),
 }
 p:=fc.Principal{Claims:map[string]any{"scope_app_id":"app-a","scope_org_id":"org-a"}}
 var got []string;cursor:=""
 for pages:=0;;pages++{
  if pages>len(runs){t.Fatal("cursor loop")}
  page,err:=workflowsListHandler(d)(ctx,WorkflowsListInput{Limit:2,Cursor:cursor},p);if err!=nil{t.Fatal(err)}
  if page.Items==nil||page.AsOf==""{t.Fatal("missing page metadata")}
  for _,row:=range page.Items{got=append(got,row.ID)}
  if page.NextCursor==nil{break};cursor=*page.NextCursor
 }
 want:=[]string{};for _,run:=range runs{want=append(want,run.ID.String())};slices.Sort(want);slices.Reverse(want)
 if !reflect.DeepEqual(got,want){t.Fatalf("operator-wide identities/order=%v want=%v",got,want)}
 page,err:=workflowsListHandler(d)(ctx,WorkflowsListInput{State:workflow.RunStateFailed,NamePrefix:"order.",ScopeAppID:"app-b",ScopeOrgID:"org-b"},p)
 if err!=nil||len(page.Items)!=1||page.Items[0].ID!=runs[1].ID.String(){t.Fatalf("filtered=%+v, %v",page,err)}
 for _,input:=range []WorkflowsListInput{{State:"unknown"},{Limit:-1},{Cursor:"broken"}}{
  if _,err:=workflowsListHandler(d)(ctx,input,p);!errors.Is(err,fc.ErrBadRequest){t.Fatalf("bad filter %+v: %v",input,err)}
 }
 parent:=runs[0]
 child:=seedWorkflow(t,d,"child",workflow.RunStateCompleted,"app-a","org-a",&parent.ID)
 grandchild:=seedWorkflow(t,d,"grandchild",workflow.RunStateCompleted,"app-a","org-a",&child.ID)
 _=grandchild
 engine.RegisterWorkflow(d.Engine,workflow.NewWorkflowV("order.a",1,func(*workflow.Workflow,struct{})error{return nil}))
 for step,data:=range map[string][]byte{"json":[]byte(`{"n":9007199254740993}`),"opaque":{0,255},"empty":{}}{
  if err:=s.SaveCheckpoint(ctx,parent.ID,step,data);err!=nil{t.Fatal(err)}
 }
 detail,err:=workflowsGetHandler(d)(ctx,IDInput{ID:parent.ID.String()},p);if err!=nil{t.Fatal(err)}
 if !detail.VersionRegistered||detail.Version!=1||detail.RecordedVersion!=0||detail.Duration==nil||detail.Duration.MS!=90000||
  len(detail.Children)!=1||detail.Children[0].ID!=child.ID.String()||detail.Children[0].ParentRunID==nil||*detail.Children[0].ParentRunID!=parent.ID.String(){t.Fatalf("detail=%+v",detail)}
 cps,err:=s.ListCheckpoints(ctx,parent.ID);if err!=nil{t.Fatal(err)}
 for i,cp:=range detail.Checkpoints{
  if cp.ID!=cps[i].ID.String(){t.Fatalf("checkpoint order=%+v",detail.Checkpoints)}
  switch cp.StepName{
  case "json":if cp.Payload.Kind!="json"{t.Fatalf("JSON=%+v",cp.Payload)}
  case "opaque":if cp.Payload.Kind!="gob"||cp.Payload.Bytes==nil||*cp.Payload.Bytes!=2{t.Fatalf("opaque=%+v",cp.Payload)}
  case "empty":if cp.Payload.Bytes==nil||*cp.Payload.Bytes!=0{t.Fatalf("empty=%+v",cp.Payload)}
  }
 }
 raw,err:=json.Marshal(detail);if err!=nil{t.Fatal(err)}
 if !strings.Contains(string(raw),"9007199254740993")||strings.Contains(string(raw),"parent_run_id"){t.Fatalf("wire=%s",raw)}
 empty,err:=workflowsGetHandler(d)(ctx,IDInput{ID:runs[3].ID.String()},p)
 if err!=nil||empty.Checkpoints==nil||empty.Children==nil||empty.ScopeAppID!=nil||empty.ParentRunID!=nil||empty.VersionRegistered{t.Fatalf("empty=%+v, %v",empty,err)}
 for _,rawID:=range []string{"broken",id.NewJobID().String()}{
  if _,err:=workflowsGetHandler(d)(ctx,IDInput{ID:rawID},p);!errors.Is(err,fc.ErrBadRequest){t.Fatalf("ID=%s: %v",rawID,err)}
 }
 if _,err:=workflowsGetHandler(d)(ctx,IDInput{ID:id.NewRunID().String()},p);!errors.Is(err,fc.ErrNotFound){t.Fatalf("missing=%v",err)}
}
func TestWorkflowDomainMemoryAndSQLite(t *testing.T){
 t.Run("memory",func(t *testing.T){runWorkflowDomain(t,memory.New())})
 t.Run("sqlite",func(t *testing.T){runWorkflowDomain(t,sqliteContractStore(t))})
}
func TestWorkflowDurationDoesNotInventMissingTimes(t *testing.T){
 now:=time.Now();run:=&workflow.Run{State:workflow.RunStateCompleted,StartedAt:now}
 if projectWorkflow(run,now).Duration!=nil{t.Fatal("terminal missing completion got a duration")}
 run.State=workflow.RunStateRunning
 if got:=projectWorkflow(run,now.Add(2*time.Second));got.Duration==nil||got.Duration.MS!=2000{t.Fatalf("running duration=%+v",got)}
 run.StartedAt=time.Time{}
 if projectWorkflow(run,now).Duration!=nil{t.Fatal("missing start got a duration")}
}

type workflowContractEnds struct{ends chan struct{}}
func (*workflowContractEnds)Name()string{return "workflow-contract-ends"}
func (r *workflowContractEnds)OnWorkflowCompleted(context.Context,*workflow.Run,time.Duration)error{r.ends<-struct{}{};return nil}
func (r *workflowContractEnds)OnWorkflowFailed(context.Context,*workflow.Run,error)error{r.ends<-struct{}{};return nil}
func (r *workflowContractEnds)wait(t *testing.T){t.Helper();select{case <-r.ends:case <-time.After(5*time.Second):t.Fatal("workflow did not finish")}}
func TestWorkflowReplayContractUsesPreviewVersionGenerationAndActor(t *testing.T){
 for _,backend:=range []string{"memory","sqlite"}{t.Run(backend,func(t *testing.T){
  var s store.Store=memory.New();if backend=="sqlite"{s=sqliteContractStore(t)}
  actions:=&actionRecorder{};ends:=&workflowContractEnds{ends:make(chan struct{},4)}
  d:=contractDeps(t,s,engine.WithExtension(actions),engine.WithExtension(ends));ctx:=context.Background()
  gate:=make(chan struct{});released:=false
  t.Cleanup(func(){if !released{close(gate)}})
  var wrongVersion atomic.Int32
  engine.RegisterWorkflow(d.Engine,workflow.NewWorkflowV("replay",1,func(wf *workflow.Workflow,_ struct{})error{
   if err:=wf.Step("target",func(context.Context)error{return errors.New("kept checkpoint reran")});err!=nil{return err}
   return wf.Step("later",func(ctx context.Context)error{select{case <-gate:return nil;case <-ctx.Done():return ctx.Err()}})
  }))
  engine.RegisterWorkflow(d.Engine,workflow.NewWorkflowV("replay",2,func(*workflow.Workflow,struct{})error{wrongVersion.Add(1);return nil}))
  run:=seedWorkflow(t,d,"replay",workflow.RunStateCompleted,"","",nil)
  for _,step:=range []string{"target","later"}{if err:=s.SaveCheckpoint(ctx,run.ID,step,[]byte("{}"));err!=nil{t.Fatal(err)};time.Sleep(time.Millisecond)}
  input:=WorkflowReplayInput{ID:run.ID.String(),FromStep:"target"}
  principal:=fc.Principal{User:&dashauth.UserInfo{Subject:"workflow-operator"}}
  preview,err:=workflowsReplayPreviewHandler(d)(ctx,input,principal)
  if err!=nil||preview.Version!=1||preview.Generation!=0||!reflect.DeepEqual(preview.Reruns,[]string{"later"})||len(actions.actions)!=0{t.Fatalf("preview=%+v, %v",preview,err)}
  for _,generation:=range []*int64{nil,new(int64(-1))}{
   if _,err:=workflowsReplayFromHandler(d)(ctx,WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:generation},principal);!errors.Is(err,fc.ErrBadRequest){t.Fatalf("invalid generation=%v",err)}
  }
  result,err:=workflowsReplayFromHandler(d)(ctx,WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:&preview.Generation},principal)
  if err!=nil||result.AcceptedGeneration!=1||result.Plan.Version!=1{t.Fatalf("replay=%+v, %v",result,err)}
  current,err:=s.GetRun(ctx,run.ID);if err!=nil||current.State!=workflow.RunStateRunning{t.Fatalf("async replay=%+v, %v",current,err)}
  if len(actions.actions)!=1||actions.actions[0].Actor!="workflow-operator"||actions.actions[0].Kind!=ext.ActionWorkflowReplayed{t.Fatalf("actions=%+v",actions.actions)}
  close(gate);released=true;ends.wait(t)
  if wrongVersion.Load()!=0{t.Fatal("used latest version")}
  _,err=workflowsReplayFromHandler(d)(ctx,WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:&preview.Generation},principal)
  var conflict *fc.Error
  if !errors.As(err,&conflict)||conflict.Code!=fc.CodeConflict||conflict.Details["state"]!=workflow.RunStateCompleted||conflict.Details["generation"]!=int64(1){t.Fatalf("stale preview=%+v",err)}
  if len(actions.actions)!=1{t.Fatal("stale replay emitted action")}
 })}
}

type workflowReadFailure struct{store.Store;operation string;bounded bool}
func (s *workflowReadFailure)ListCheckpoints(ctx context.Context,runID id.RunID)([]*workflow.Checkpoint,error){
 if s.operation!="checkpoints"{return s.Store.ListCheckpoints(ctx,runID)}
 _,s.bounded=ctx.Deadline();return nil,errors.New("private-store-secret")
}
func (s *workflowReadFailure)ListChildRuns(ctx context.Context,runID id.RunID)([]*workflow.Run,error){
 if s.operation!="children"{return s.Store.ListChildRuns(ctx,runID)}
 _,s.bounded=ctx.Deadline();return nil,errors.New("private-store-secret")
}
func (s *workflowReadFailure)ListRunsPage(ctx context.Context,opts workflow.ListRunsPageOpts)(workflow.RunPage,error){
 if s.operation=="page"{return workflow.RunPage{Runs:[]*workflow.Run{},NextCursor:"continue",Complete:false},nil}
 return s.Store.ListRunsPage(ctx,opts)
}
func TestWorkflowContractPreservesIncompletePagesAndReadFailures(t *testing.T){
 for _,operation:=range []string{"checkpoints","children","page"}{t.Run(operation,func(t *testing.T){
  s:=&workflowReadFailure{Store:memory.New(),operation:operation};d:=contractDeps(t,s)
  run:=seedWorkflow(t,d,"inspect",workflow.RunStateFailed,"","",nil)
  if operation=="page"{
   page,err:=workflowsListHandler(d)(context.Background(),WorkflowsListInput{},fc.Principal{})
   if err!=nil||page.Complete||page.NextCursor==nil||*page.NextCursor!="continue"||page.Items==nil{t.Fatalf("page=%+v, %v",page,err)}
   return
  }
  _,err:=workflowsGetHandler(d)(context.Background(),IDInput{ID:run.ID.String()},fc.Principal{})
  if !errors.Is(err,fc.ErrInternal)||strings.Contains(err.Error(),"private-store-secret")||!s.bounded{t.Fatalf("read failure=%v, bounded=%v",err,s.bounded)}
 })}
}
func TestWorkflowReplayRefusals(t *testing.T){
 d:=contractDeps(t,memory.New());ctx:=context.Background()
 run:=seedWorkflow(t,d,"missing-definition",workflow.RunStateFailed,"","",nil)
 if err:=d.Store.SaveCheckpoint(ctx,run.ID,"target",[]byte("{}"));err!=nil{t.Fatal(err)}
 input:=WorkflowReplayInput{ID:run.ID.String(),FromStep:"target"};generation:=int64(0)
 for _,step:=range []string{"target","unreached"}{
  input.FromStep=step
  if _,err:=workflowsReplayPreviewHandler(d)(ctx,input,fc.Principal{});!errors.Is(err,fc.ErrConflict){t.Fatalf("preview refusal=%v",err)}
 }
 input.FromStep="target"
 engine.RegisterWorkflow(d.Engine,workflow.NewWorkflow("missing-definition",func(*workflow.Workflow,struct{})error{return nil}))
 run.State=workflow.RunStateRunning
 if err:=d.Store.UpdateRun(ctx,run);err!=nil{t.Fatal(err)}
 if _,err:=workflowsReplayFromHandler(d)(ctx,WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:&generation},fc.Principal{});!errors.Is(err,fc.ErrConflict){t.Fatalf("running=%v",err)}
 run.State=workflow.RunStateFailed;if err:=d.Store.UpdateRun(ctx,run);err!=nil{t.Fatal(err)}
 if err:=d.Engine.Stop(ctx);err!=nil{t.Fatal(err)}
 if _,err:=workflowsReplayFromHandler(d)(ctx,WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:&generation},fc.Principal{});!errors.Is(err,fc.ErrUnavailable){t.Fatalf("stopped=%v",err)}
}
```

- [ ] Run `go test -race ./extension/contract -count=1` before implementation. Expected: FAIL. The workflow projections, input types and handlers do not exist.

- [ ] Apply this implementation:

`extension/contract/project_workflow.go`

```go
package contract

import (
 "time"
 "github.com/xraph/dispatch/workflow"
)

type WorkflowRow struct {
 ID string `json:"id"`
 Name string `json:"name"`
 State workflow.RunState `json:"state"`
 Version int `json:"version"`
 RecordedVersion int `json:"recordedVersion"`
 ReplayGeneration int64 `json:"replayGeneration"`
 ParentRunID *string `json:"parentRunId"`
 ScopeAppID *string `json:"scopeAppId"`
 ScopeOrgID *string `json:"scopeOrgId"`
 CreatedAt *string `json:"createdAt"`
 UpdatedAt *string `json:"updatedAt"`
 StartedAt *string `json:"startedAt"`
 CompletedAt *string `json:"completedAt"`
 Duration *Duration `json:"duration"`
}
type WorkflowCheckpoint struct {
 ID string `json:"id"`
 StepName string `json:"stepName"`
 CreatedAt *string `json:"createdAt"`
 Payload Payload `json:"payload"`
}
type WorkflowDetail struct {
 WorkflowRow
 Input Payload `json:"input"`
 Output Payload `json:"output"`
 Error *string `json:"error"`
 Checkpoints []WorkflowCheckpoint `json:"checkpoints"`
 Children []WorkflowRow `json:"children"`
 VersionRegistered bool `json:"versionRegistered"`
 AsOf string `json:"asOf"`
}
type WorkflowReplayPreview struct {
 RunID string `json:"runId"`
 FromStep string `json:"fromStep"`
 Version int `json:"version"`
 Generation int64 `json:"generation"`
 State workflow.RunState `json:"state"`
 Reruns []string `json:"reruns"`
 AsOf string `json:"asOf"`
}
type WorkflowReplayResult struct {
 Plan WorkflowReplayPreview `json:"plan"`
 AcceptedGeneration int64 `json:"acceptedGeneration"`
 AsOf string `json:"asOf"`
}
func projectWorkflow(run *workflow.Run, at time.Time)WorkflowRow{
 version:=run.Version;if version<=0{version=1}
 row:=WorkflowRow{ID:run.ID.String(),Name:run.Name,State:run.State,Version:version,RecordedVersion:run.Version,
  ReplayGeneration:run.ReplayGeneration,ScopeAppID:nullable(run.ScopeAppID),ScopeOrgID:nullable(run.ScopeOrgID),
  CreatedAt:timestamp(run.CreatedAt),UpdatedAt:timestamp(run.UpdatedAt),StartedAt:timestamp(run.StartedAt),CompletedAt:timestampPtr(run.CompletedAt)}
 if run.ParentRunID!=nil{row.ParentRunID=nullable(run.ParentRunID.String())}
 var end time.Time
 if run.CompletedAt!=nil{end=*run.CompletedAt}else if run.State==workflow.RunStateRunning{end=at}
 if !run.StartedAt.IsZero()&&!end.IsZero()&&!end.Before(run.StartedAt){d:=duration(end.Sub(run.StartedAt));row.Duration=&d}
 return row
}
func projectWorkflowReplay(plan *workflow.ReplayPlan,at time.Time)WorkflowReplayPreview{
 reruns:=append([]string{},plan.Reruns...)
 return WorkflowReplayPreview{RunID:plan.RunID.String(),FromStep:plan.FromStep,Version:plan.Version,Generation:plan.Generation,
  State:plan.State,Reruns:reruns,AsOf:at.UTC().Format(time.RFC3339Nano)}
}
```

`extension/contract/workflows.go`

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
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/workflow"
)

type WorkflowsListInput struct {
 State workflow.RunState `json:"state"`
 NamePrefix string `json:"namePrefix"`
 ScopeAppID string `json:"scopeAppId"`
 ScopeOrgID string `json:"scopeOrgId"`
 Cursor string `json:"cursor"`
 Limit int `json:"limit"`
}
type WorkflowReplayInput struct {
 ID string `json:"id"`
 FromStep string `json:"fromStep"`
}
type WorkflowReplayCommandInput struct {
 WorkflowReplayInput
 ExpectedGeneration *int64 `json:"expectedGeneration"`
}
func parseRunID(raw string)(id.RunID,error){
 parsed,err:=id.ParseRunID(raw)
 if err!=nil||parsed.IsNil(){return id.RunID{},badRequest("id must be a workflow run ID")}
 return parsed,nil
}
func workflowsListHandler(deps Deps)func(context.Context,WorkflowsListInput,fc.Principal)(Page[WorkflowRow],error){
 return handle(deps,"workflows.list",false,func(ctx context.Context,input WorkflowsListInput,_ fc.Principal)(Page[WorkflowRow],error){
  limit,err:=pageLimit(input.Limit);if err!=nil{return Page[WorkflowRow]{},err}
  switch input.State{case "",workflow.RunStateRunning,workflow.RunStateCompleted,workflow.RunStateFailed:
  default:return Page[WorkflowRow]{},badRequest("unknown workflow state")}
  page,err:=deps.Store.ListRunsPage(ctx,workflow.ListRunsPageOpts{State:input.State,NamePrefix:input.NamePrefix,ScopeAppID:input.ScopeAppID,
   ScopeOrgID:input.ScopeOrgID,Cursor:input.Cursor,Limit:limit})
  if err!=nil{return Page[WorkflowRow]{},err}
  at:=time.Now();rows:=make([]WorkflowRow,0,len(page.Runs))
  for _,run:=range page.Runs{rows=append(rows,projectWorkflow(run,at))}
  return newPage(rows,page.NextCursor,page.Complete,at),nil
 })
}
func workflowsGetHandler(deps Deps)func(context.Context,IDInput,fc.Principal)(WorkflowDetail,error){
 return handle(deps,"workflows.get",false,func(ctx context.Context,input IDInput,_ fc.Principal)(WorkflowDetail,error){
  runID,err:=parseRunID(input.ID);if err!=nil{return WorkflowDetail{},err}
  run,err:=deps.Store.GetRun(ctx,runID);if err!=nil{return WorkflowDetail{},err}
  checkpoints,err:=deps.Store.ListCheckpoints(ctx,runID);if err!=nil{return WorkflowDetail{},err}
  children,err:=deps.Store.ListChildRuns(ctx,runID);if err!=nil{return WorkflowDetail{},err}
  // Detach before sorting: custom stores may share their slice containers.
  checkpoints=slices.Clone(checkpoints);slices.SortFunc(checkpoints,workflow.CompareCheckpoints)
  children=slices.Clone(children);slices.SortFunc(children,func(a,b *workflow.Run)int{
   if c:=a.CreatedAt.Compare(b.CreatedAt);c!=0{return c};return strings.Compare(a.ID.String(),b.ID.String())
  })
  at:=time.Now();row:=projectWorkflow(run,at)
  _,registered:=deps.Engine.WorkflowRunner().Registry().GetVersion(run.Name,row.Version)
  out:=WorkflowDetail{WorkflowRow:row,Input:projectPayload(run.Input,false),Output:projectPayload(run.Output,false),Error:nullable(run.Error),
   Checkpoints:[]WorkflowCheckpoint{},Children:[]WorkflowRow{},VersionRegistered:registered,AsOf:at.UTC().Format(time.RFC3339Nano)}
  for _,cp:=range checkpoints{out.Checkpoints=append(out.Checkpoints,WorkflowCheckpoint{ID:cp.ID.String(),StepName:cp.StepName,
   CreatedAt:timestamp(cp.CreatedAt),Payload:projectPayload(cp.Data,true)})}
  for _,child:=range children{out.Children=append(out.Children,projectWorkflow(child,at))}
  return out,nil
 })
}
func workflowConflict(ctx context.Context,deps Deps,runID id.RunID)error{
 current,err:=deps.Store.GetRun(ctx,runID);if err!=nil{return err}
 return &fc.Error{Code:fc.CodeConflict,Message:"the run changed or cannot replay from this checkpoint",
  Details:map[string]any{"state":current.State,"generation":current.ReplayGeneration}}
}
func validateReplayInput(input WorkflowReplayInput)(id.RunID,error){
 runID,err:=parseRunID(input.ID);if err!=nil{return id.RunID{},err}
 if strings.TrimSpace(input.FromStep)==""{return id.RunID{},badRequest("fromStep must name a checkpointed step")}
 return runID,nil
}
func workflowsReplayPreviewHandler(deps Deps)func(context.Context,WorkflowReplayInput,fc.Principal)(WorkflowReplayPreview,error){
 return handle(deps,"workflows.replayPreview",false,func(ctx context.Context,input WorkflowReplayInput,_ fc.Principal)(WorkflowReplayPreview,error){
  runID,err:=validateReplayInput(input);if err!=nil{return WorkflowReplayPreview{},err}
  plan,err:=deps.Engine.PlanWorkflowReplay(ctx,runID,input.FromStep)
  if errors.Is(err,dispatch.ErrInvalidState){return WorkflowReplayPreview{},workflowConflict(ctx,deps,runID)}
  if err!=nil{return WorkflowReplayPreview{},err}
  return projectWorkflowReplay(plan,time.Now()),nil
 })
}
func workflowsReplayFromHandler(deps Deps)func(context.Context,WorkflowReplayCommandInput,fc.Principal)(WorkflowReplayResult,error){
 return handle(deps,"workflows.replayFrom",true,func(ctx context.Context,input WorkflowReplayCommandInput,_ fc.Principal)(WorkflowReplayResult,error){
  runID,err:=validateReplayInput(input.WorkflowReplayInput);if err!=nil{return WorkflowReplayResult{},err}
  if input.ExpectedGeneration==nil||*input.ExpectedGeneration<0{return WorkflowReplayResult{},badRequest("expectedGeneration is required and must not be negative")}
  plan,err:=deps.Engine.ReplayWorkflowFromGeneration(ctx,runID,input.FromStep,*input.ExpectedGeneration)
  if errors.Is(err,dispatch.ErrInvalidState){return WorkflowReplayResult{},workflowConflict(ctx,deps,runID)}
  if err!=nil{return WorkflowReplayResult{},err}
  at:=time.Now();return WorkflowReplayResult{Plan:projectWorkflowReplay(plan,at),AcceptedGeneration:plan.Generation+1,AsOf:at.UTC().Format(time.RFC3339Nano)},nil
 })
}
```

- [ ] Format owned Go files with goimports. Run `go test -race ./extension/contract -count=1`. Expected: PASS; inspect JSON or verbose output for skips before claiming backend verification.
- [ ] Run scoped lint with --allow-serial-runners. Integration-tag Redis lint may report only the documented pre-existing store_test.go:54 shadow.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'feat(dispatch): add workflow dashboard contract handlers' -- extension/contract/workflows_test.go extension/contract/project_workflow.go extension/contract/workflows.go`. Inspect the commit stat and record evidence.

### Task 4: Register workflow intents and verify transport and durable stores

**Files:** `extension/contract/workflows_integration_test.go`, `extension/contract/workflows_transport_test.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`, `extension/contract/manifest_test.go`.

- [ ] Write these tests:

`extension/contract/workflows_integration_test.go`

```go
//go:build integration

package contract

import "testing"

func TestWorkflowDomainOtherBackends(t *testing.T){
 t.Run("postgres",func(t *testing.T){runWorkflowDomain(t,postgresContractStore(t))})
 t.Run("redis",func(t *testing.T){runWorkflowDomain(t,redisContractStore(t))})
 t.Run("mongo",func(t *testing.T){runWorkflowDomain(t,mongoContractStore(t))})
}
```

`extension/contract/workflows_transport_test.go`

```go
package contract

import (
 "context"
 "encoding/json"
 "reflect"
 "testing"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

func TestWorkflowTransportQueriesReplayAndInvalidations(t *testing.T){
 ends:=&workflowContractEnds{ends:make(chan struct{},1)}
 d:=contractDeps(t,memory.New(),engine.WithExtension(ends))
 engine.RegisterWorkflow(d.Engine,workflow.NewWorkflow("transport",func(*workflow.Workflow,struct{})error{return nil}))
 run:=seedWorkflow(t,d,"transport",workflow.RunStateCompleted,"","",nil)
 if err:=d.Store.SaveCheckpoint(context.Background(),run.ID,"target",[]byte("{}"));err!=nil{t.Fatal(err)}
 callContract(t,d,"query","workflows.list",WorkflowsListInput{})
 callContract(t,d,"query","workflows.get",IDInput{ID:run.ID.String()})
 input:=WorkflowReplayInput{ID:run.ID.String(),FromStep:"target"}
 response:=callContract(t,d,"query","workflows.replayPreview",input)
 var preview WorkflowReplayPreview
 if err:=json.Unmarshal(response.Data,&preview);err!=nil{t.Fatal(err)}
 response=callContract(t,d,"command","workflows.replayFrom",WorkflowReplayCommandInput{WorkflowReplayInput:input,ExpectedGeneration:&preview.Generation})
 want:=[]string{"workflows.list","workflows.get","workflows.replayPreview","overview.summary"}
 if !reflect.DeepEqual(response.Meta.Invalidates,want){t.Fatalf("invalidations=%v",response.Meta.Invalidates)}
 var result WorkflowReplayResult
 if err:=json.Unmarshal(response.Data,&result);err!=nil||result.AcceptedGeneration!=1{t.Fatalf("result=%+v, %v",result,err)}
 ends.wait(t)
 current,err:=d.Store.GetRun(context.Background(),run.ID)
 if err!=nil||current.ReplayGeneration!=1||current.State!=workflow.RunStateCompleted{t.Fatalf("stored=%+v, %v",current,err)}
}
```

- [ ] Run `go test ./extension/contract -run TestWorkflowTransportQueriesReplayAndInvalidations -count=1` before implementation. Expected: FAIL. The HTTP test fails because workflows.list is not registered.

- [ ] Apply this implementation:

```diff
--- a/extension/contract/contract.go
+++ b/extension/contract/contract.go
@@
-return []binding{
-
+return []binding{
+		query("workflows.list", workflowsListHandler(deps)),
+		query("workflows.get", workflowsGetHandler(deps)),
+		query("workflows.replayPreview", workflowsReplayPreviewHandler(deps)),
+		command("workflows.replayFrom", workflowsReplayFromHandler(deps)),
+
--- a/extension/contract/manifest.yaml
+++ b/extension/contract/manifest.yaml
@@
-intents:
-
+intents:
+  - { name: workflows.list, kind: query, version: 1, capability: read }
+  - { name: workflows.get, kind: query, version: 1, capability: read }
+  - { name: workflows.replayPreview, kind: query, version: 1, capability: read }
+  - { name: workflows.replayFrom, kind: command, version: 1, capability: write, invalidates: [workflows.list, workflows.get, workflows.replayPreview, overview.summary] }
+
--- a/extension/contract/manifest_test.go
+++ b/extension/contract/manifest_test.go
@@
-want := map[string][]string{
-
+want := map[string][]string{
+		"workflows.replayFrom": {"workflows.list", "workflows.get", "workflows.replayPreview", "overview.summary"},
+
```

- [ ] Format owned Go files with goimports. Run `go test -race ./extension/... -count=1 && go test -tags integration -race ./extension/contract -run TestWorkflowDomainOtherBackends -count=1 -v`. Expected: PASS; inspect JSON or verbose output for skips before claiming backend verification.
- [ ] Run scoped lint with --allow-serial-runners. Integration-tag Redis lint may report only the documented pre-existing store_test.go:54 shadow.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'feat(dispatch): register and verify workflow contract intents' -- extension/contract/workflows_integration_test.go extension/contract/workflows_transport_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/manifest_test.go`. Inspect the commit stat and record evidence.

## Final checks

- [ ] Full build/unit, workflow and extension race suites, and ordinary lint pass.
- [ ] One fresh final reviewer checks the complete slice and every review-focus item.
- [ ] Fix consequential findings with observed red/green regressions, then run relevant suites. No second review.
- [ ] Record commits, evidence, rulings and remaining browser/dependency limits in this plan and MIGRATION.md.

## Execution result

All four tasks are complete: Redis read propagation (`e85c1e1`), generation-aware
replay (`0902d2d`), typed handlers (`59e5bd0`) and registration/transport checks
(`3370432`). Missing methods and handlers, then unregistered HTTP intents, failed
before their implementations. All 16 Redis outage/corruption cases also failed
before read errors were propagated.

The final reviewer found one P2: a Redis record under run A could contain another
valid run ID, B. The regression reproduced five incorrect reads and a replay that
claimed and pruned A. The fix checks key/entity identity in direct reads, legacy
lists, cursor pages and counts. The regression then passed without mutation,
execution or audit events. There was no second review.

After the fix, 37 focused Redis workflow tests/subtests and 44 Redis list/identity
tests/subtests pass under race with no skips. The shared workflow domain fixture
passes on memory, SQLite, PostgreSQL, Redis and MongoDB. Full build passes; full
unit results are 45 passing packages and 2,024 passing tests/subtests. The Trove
memory driver's unsupported range-read test skips, and two packages have no tests.
Full workflow/engine/extension race suites and ordinary lint pass. Integration-tag
Redis lint retains only the pre-existing `store_test.go:54` shadow warning.

Rulings from review: startup ResumeAll ownership and ordinary caller-owned starts
retain their documented boundaries. Redis pruning is not transactional after the
write phase begins, so an interrupted deletion may need another inspected recovery
attempt. Browser and deployment qualification remain pending. Concurrent module
edits were preserved and remain outside these commits.
