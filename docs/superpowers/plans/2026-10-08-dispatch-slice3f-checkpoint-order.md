# Dispatch Slice 3f: checkpoint replay ordering implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make replay previews and checkpoint pruning agree when timestamps tie, before exposing replay confirmations in the dashboard.

**Architecture:** Checkpoint order is creation time followed by checkpoint ID. Timeline and replay preview share a comparator; SQL, MongoDB, Redis and memory apply that same strict boundary. The selected checkpoint and all earlier ties remain.

**Tech Stack:** Go, Grove SQL/Mongo/Redis stores, shared conformance fixtures and testcontainers.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Work on main in primary checkouts. Preserve concurrent module edits and unrelated dashboard changes. Focused local commits only.
- Replay remains pinned to the run's version and generation. No changes to claim ownership or background execution.
- The preview lists exactly the checkpoints pruning removes. The target is kept.
- Changes apply to all five storage backends, with deterministic persisted timestamp ties.
- No schema migration is needed: checkpoint IDs and timestamps already exist.
- Keep missing-target deletion a no-op and preserve other runs' checkpoints.
- Use rex-voice and humanizer. No em dashes, tool attribution or co-author trailers.
- This prerequisite establishes checkpoint ordering, not React/browser readiness.

## Rulings

- Resolve the timestamp-tie limitation deferred during Slice 2 now, because the workflow confirmation must accurately name discarded checkpoints.
- Keep the existing timeline order, creation time then ID. Memory previously removed earlier ties while durable stores retained later ties; both differ from this total order.
- Force persisted fixture timestamps through test-only storage access. Sleeping cannot reliably prove ties across backend precisions.
- Existing Redis integration lint has one unrelated err shadow in store/redis/store_test.go. Report it separately; new findings in owned files must be fixed.

## Review focus

1. Three checkpoints with exactly equal persisted times must prune only IDs after the selected checkpoint (Task 2).
2. A checkpoint with a newer ID but an earlier timestamp must stay before the target (Task 2).
3. Deletion for one run must not touch a different run with later checkpoints (Task 2).
4. An absent step remains a no-op, preserving every checkpoint (Task 2).
5. An unordered store result with tied timestamps must produce the same ordered timeline and replay preview (Task 1).

## File structure and interfaces

All source paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
workflow.CompareCheckpoints(*Checkpoint,*Checkpoint) int is the shared comparator.
Task 1 consumes it in GetTimeline and planReplay. Task 2 consumes it in memory
and Redis list ordering and matches it with SQL tuple comparison and MongoDB's
timestamp/ID predicates. storetest.RunCheckpointOrderSuite accepts a workflow.Store
and a test-only timestamp setter for deterministic storage qualification.

### Task 1: Share checkpoint ordering between timeline and replay preview

**Files:** `workflow/checkpoint_order_test.go`, `workflow/checkpoint.go`, `workflow/replay.go`, `workflow/debug.go`, `workflow/store.go`, `workflow/replay_test.go`.

- [ ] Write these test files:

`workflow/checkpoint_order_test.go`

```go
package workflow_test

import (
 "context"
 "reflect"
 "slices"
 "strings"
 "testing"
 "time"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store/memory"
 "github.com/xraph/dispatch/workflow"
)

type tiedCheckpointStore struct{
 *memory.Store
 checkpoints []*workflow.Checkpoint
}
func(s *tiedCheckpointStore)ListCheckpoints(context.Context,id.RunID)([]*workflow.Checkpoint,error){
 return append([]*workflow.Checkpoint(nil),s.checkpoints...),nil
}
func TestReplayPlanAndTimelineShareTieOrder(t *testing.T){
 ctx:=context.Background()
 at:=time.Date(2026,1,1,0,0,0,0,time.UTC)
 run:=&workflow.Run{Entity:dispatch.NewEntity(),ID:id.NewRunID(),Name:"tied-steps",State:workflow.RunStateCompleted,StartedAt:at,Version:3}
 s:=&tiedCheckpointStore{Store:memory.New()}
 if err:=s.CreateRun(ctx,run);err!=nil{t.Fatal(err)}
 ordered:=make([]*workflow.Checkpoint,0,3)
 for range 3{ordered=append(ordered,&workflow.Checkpoint{ID:id.NewCheckpointID(),RunID:run.ID,CreatedAt:at})}
 slices.SortFunc(ordered,func(a,b *workflow.Checkpoint)int{return strings.Compare(a.ID.String(),b.ID.String())})
 for i,name:=range []string{"before","target","after"}{ordered[i].StepName=name}
 s.checkpoints=[]*workflow.Checkpoint{ordered[2],ordered[0],ordered[1]}
 runner,reg,_:=newReplayRunner(t,s,s.Store)
 workflow.RegisterDefinition(reg,workflow.NewWorkflowV("tied-steps",3,func(*workflow.Workflow,struct{})error{return nil}))
 plan,err:=runner.PlanReplay(ctx,run.ID,"target")
 if err!=nil||!reflect.DeepEqual(plan.Reruns,[]string{"after"}){t.Fatalf("plan = %+v, %v",plan,err)}
 timeline,err:=runner.GetTimeline(ctx,run.ID);if err!=nil{t.Fatal(err)}
 got:=make([]string,0,len(timeline));for _,cp:=range timeline{got=append(got,cp.StepName)}
 if !reflect.DeepEqual(got,[]string{"before","target","after"}){t.Fatalf("timeline = %v",got)}
}
```

- [ ] Run `go test ./workflow -run TestReplayPlanAndTimelineShareTieOrder -count=1`.

Expected: FAIL because the current preview or pruning omits later ties or removes earlier ties. Verify every backend actually ran.

- [ ] Apply these exact changes:

```diff
--- a/workflow/checkpoint.go
+++ b/workflow/checkpoint.go
@@
-	"time"
+	"time"
+	"strings"
--- a/workflow/checkpoint.go
+++ b/workflow/checkpoint.go
@@
-	CreatedAt time.Time       `json:"created_at"`
-}
+	CreatedAt time.Time       `json:"created_at"`
+}
+
+// CompareCheckpoints orders checkpoints by creation time, then ID. Timeline,
+// replay preview and storage pruning use the same tie boundary.
+func CompareCheckpoints(a, b *Checkpoint) int {
+ if order := a.CreatedAt.Compare(b.CreatedAt); order != 0 { return order }
+ return strings.Compare(a.ID.String(), b.ID.String())
+}
--- a/workflow/replay.go
+++ b/workflow/replay.go
@@
-	// Reruns is what DeleteCheckpointsAfter removes on the durable
-	// backends: every checkpoint created strictly after fromStep's, in
-	// creation order, with the ID breaking a tie as GetTimeline does.
+	// Preview the same creation-time/ID boundary every store prunes.
--- a/workflow/replay.go
+++ b/workflow/replay.go
@@
-if cp.CreatedAt.After(target.CreatedAt) {
+if CompareCheckpoints(cp, target) > 0 {
--- a/workflow/replay.go
+++ b/workflow/replay.go
@@
-		if later[i].CreatedAt.Equal(later[j].CreatedAt) {
-			return later[i].ID.String() < later[j].ID.String()
-		}
-		return later[i].CreatedAt.Before(later[j].CreatedAt)
+		return CompareCheckpoints(later[i], later[j]) < 0
--- a/workflow/debug.go
+++ b/workflow/debug.go
@@
-		if checkpoints[i].CreatedAt.Equal(checkpoints[j].CreatedAt) {
-			return checkpoints[i].ID.String() < checkpoints[j].ID.String()
-		}
-		return checkpoints[i].CreatedAt.Before(checkpoints[j].CreatedAt)
+		return CompareCheckpoints(checkpoints[i], checkpoints[j]) < 0
--- a/workflow/store.go
+++ b/workflow/store.go
@@
-// ListCheckpoints returns all checkpoints for a workflow run.
+// ListCheckpoints returns checkpoints in ascending creation-time/ID order.
--- a/workflow/store.go
+++ b/workflow/store.go
@@
-// DeleteCheckpointsAfter removes all checkpoints created after the
-	// given step name (by creation order). Used for workflow replay.
+// DeleteCheckpointsAfter removes checkpoints strictly after the named
+	// step in creation-time/ID order, preserving the target and earlier ties.
--- a/workflow/replay_test.go
+++ b/workflow/replay_test.go
@@
-// tick spaces checkpoints apart. Checkpoint order is creation time, and
-// a step this trivial can save in the same clock tick as the one before
-// it on a coarse clock. DeleteCheckpointsAfter cannot order a tie (the
-// memory store deletes it, the durable stores keep it), and real steps
-// are never this close, so the pause keeps the test about replay rather
-// than clock resolution.
+// tick spaces the lifecycle fixture's checkpoints apart. Deterministic
+// timestamp ties are covered by the checkpoint ordering suites.
```

- [ ] Format owned Go files with goimports and run `go test -race ./workflow -count=1`. Expected: PASS, no backend skips.
- [ ] Run scoped ordinary lint. For Task 2 also inspect integration-tag lint; only the documented pre-existing Redis test shadow may remain.
- [ ] Inspect status, branch, staged scope and diff-check. Stage only the listed files.
- [ ] Commit with `git commit --only -m 'fix(workflow): align replay preview with checkpoint tie order' -- workflow/checkpoint_order_test.go workflow/checkpoint.go workflow/replay.go workflow/debug.go workflow/store.go workflow/replay_test.go`. Inspect the commit stat.

### Task 2: Use the same boundary on every storage backend

**Files:** `store/storetest/checkpoint_order.go`, `store/memory/checkpoint_order_test.go`, `store/sqlite/checkpoint_order_test.go`, `store/postgres/checkpoint_order_test.go`, `store/mongo/checkpoint_order_test.go`, `store/redis/checkpoint_order_test.go`, `store/memory/store.go`, `store/postgres/workflow.go`, `store/sqlite/workflow.go`, `store/mongo/workflow.go`, `store/redis/workflow.go`.

- [ ] Write these test files:

`store/storetest/checkpoint_order.go`

```go
package storetest

import (
 "context"
 "reflect"
 "slices"
 "strings"
 "testing"
 "time"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/workflow"
)

// RunCheckpointOrderSuite checks the shared timestamp/ID order against actual
// persisted rows. setTime forces ties without depending on a backend's clock.
func RunCheckpointOrderSuite(t *testing.T,s workflow.Store,setTime func(context.Context,id.RunID,string,time.Time)error){
 t.Helper()
 ctx:=context.Background()
 at:=time.Date(2026,1,1,0,0,0,0,time.UTC)
 run:=&workflow.Run{Entity:dispatch.NewEntity(),ID:id.NewRunID(),Name:"checkpoint-order",State:workflow.RunStateCompleted,StartedAt:at}
 other:=&workflow.Run{Entity:dispatch.NewEntity(),ID:id.NewRunID(),Name:"other-run",State:workflow.RunStateCompleted,StartedAt:at}
 for _,r:=range []*workflow.Run{run,other}{if err:=s.CreateRun(ctx,r);err!=nil{t.Fatal(err)}}
 names:=[]string{"tie-a","tie-b","tie-c","earlier","later"}
 for _,name:=range names{
  if err:=s.SaveCheckpoint(ctx,run.ID,name,[]byte(name));err!=nil{t.Fatal(err)}
  when:=at
  if name=="earlier"{when=at.Add(-time.Hour)}
  if name=="later"{when=at.Add(time.Hour)}
  if err:=setTime(ctx,run.ID,name,when);err!=nil{t.Fatal(err)}
 }
 if err:=s.SaveCheckpoint(ctx,other.ID,"untouched",[]byte("other"));err!=nil{t.Fatal(err)}
 if err:=setTime(ctx,other.ID,"untouched",at.Add(2*time.Hour));err!=nil{t.Fatal(err)}
 rows,err:=s.ListCheckpoints(ctx,run.ID);if err!=nil{t.Fatal(err)}
 if len(rows)!=5{t.Fatalf("fixture rows = %d",len(rows))}
 tied:=make([]*workflow.Checkpoint,0,3)
 for _,cp:=range rows{
  if strings.HasPrefix(cp.StepName,"tie-"){
   if !cp.CreatedAt.Equal(at){t.Fatalf("fixture did not persist a tie: %+v",cp)}
   tied=append(tied,cp)
  }
 }
 if len(tied)!=3{t.Fatalf("fixture ties = %d",len(tied))}
 slices.SortFunc(tied,func(a,b *workflow.Checkpoint)int{return strings.Compare(a.ID.String(),b.ID.String())})
 want:=[]string{"earlier",tied[0].StepName,tied[1].StepName,tied[2].StepName,"later"}
 actual:=make([]string,0,len(rows));for _,cp:=range rows{actual=append(actual,cp.StepName)}
 if !reflect.DeepEqual(actual,want){t.Errorf("list order = %v, want %v",actual,want)}
 if err:=s.DeleteCheckpointsAfter(ctx,run.ID,"missing");err!=nil{t.Fatal(err)}
 unchanged,err:=s.ListCheckpoints(ctx,run.ID);if err!=nil||len(unchanged)!=5{t.Fatalf("missing target changed rows: %v, %v",unchanged,err)}
 if err:=s.DeleteCheckpointsAfter(ctx,run.ID,tied[1].StepName);err!=nil{t.Fatal(err)}
 remaining,err:=s.ListCheckpoints(ctx,run.ID);if err!=nil{t.Fatal(err)}
 actual=make([]string,0,len(remaining));for _,cp:=range remaining{actual=append(actual,cp.StepName)}
 if !reflect.DeepEqual(actual,want[:3]){t.Fatalf("remaining = %v, want %v",actual,want[:3])}
 untouched,err:=s.ListCheckpoints(ctx,other.ID)
 if err!=nil||len(untouched)!=1||untouched[0].StepName!="untouched"{t.Fatalf("other run changed: %v, %v",untouched,err)}
}
```

`store/memory/checkpoint_order_test.go`

```go
package memory

import (
 "context"
 "testing"
 "time"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store/storetest"
)
func TestCheckpointOrderConformance(t *testing.T){
 s:=New()
 storetest.RunCheckpointOrderSuite(t,s,func(_ context.Context,runID id.RunID,step string,at time.Time)error{
  s.mu.Lock();defer s.mu.Unlock()
  s.checkpoints[checkpointKey(runID,step)].CreatedAt=at
  return nil
 })
}
```

`store/sqlite/checkpoint_order_test.go`

```go
package sqlite_test

import (
 "context"
 "testing"
 "time"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store/storetest"
)
func TestCheckpointOrderConformance(t *testing.T){
 s,drv,_:=openMigratedWithDriver(t)
 storetest.RunCheckpointOrderSuite(t,s,func(ctx context.Context,runID id.RunID,step string,at time.Time)error{
  _,err:=drv.Exec(ctx,"UPDATE dispatch_checkpoints SET created_at = ? WHERE run_id = ? AND step_name = ?",at,runID.String(),step)
  return err
 })
}
```

`store/postgres/checkpoint_order_test.go`

```go
//go:build integration

package postgres_test

import (
 "context"
 "testing"
 "time"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store/storetest"
)
func TestCheckpointOrderConformance(t *testing.T){
 s:=setupTestStore(t)
 conn:=dedicatedConn(t,s)
 storetest.RunCheckpointOrderSuite(t,s,func(ctx context.Context,runID id.RunID,step string,at time.Time)error{
  _,err:=conn.Exec(ctx,"UPDATE dispatch_checkpoints SET created_at = $1 WHERE run_id = $2 AND step_name = $3",at,runID.String(),step)
  return err
 })
}
```

`store/mongo/checkpoint_order_test.go`

```go
package mongo_test

import (
 "context"
 "testing"
 "time"
 "go.mongodb.org/mongo-driver/v2/bson"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/store/storetest"
)
func TestCheckpointOrderConformance(t *testing.T){
 uri:=startMongo(t)
 s:=openStore(t,uri)
 if err:=s.Migrate(context.Background());err!=nil{t.Fatal(err)}
 col:=rawDatabase(t,uri).Collection("dispatch_checkpoints")
 storetest.RunCheckpointOrderSuite(t,s,func(ctx context.Context,runID id.RunID,step string,at time.Time)error{
  _,err:=col.UpdateOne(ctx,bson.M{"run_id":runID.String(),"step_name":step},bson.M{"$set":bson.M{"created_at":at}})
  return err
 })
}
```

`store/redis/checkpoint_order_test.go`

```go
//go:build integration

package redis_test

import (
 "context"
 "encoding/json"
 "testing"
 "time"
 "github.com/xraph/grove/kv/drivers/redisdriver"
 "github.com/xraph/dispatch/id"
 redisstore "github.com/xraph/dispatch/store/redis"
 "github.com/xraph/dispatch/store/storetest"
)
func TestCheckpointOrderConformance(t *testing.T){
 kvStore:=setupTestKV(t)
 s:=redisstore.New(kvStore)
 client:=redisdriver.UnwrapClient(kvStore)
 storetest.RunCheckpointOrderSuite(t,s,func(ctx context.Context,runID id.RunID,step string,at time.Time)error{
  key:="dispatch:checkpoint:"+runID.String()+":"+step
  raw,err:=client.Get(ctx,key).Bytes();if err!=nil{return err}
  var record map[string]json.RawMessage
  if err:=json.Unmarshal(raw,&record);err!=nil{return err}
  encodedTime,err:=json.Marshal(at);if err!=nil{return err}
  record["created_at"]=encodedTime
  updated,err:=json.Marshal(record);if err!=nil{return err}
  return client.Set(ctx,key,updated,0).Err()
 })
}
```

- [ ] Run `go test -tags integration -race -p 1 ./store/memory ./store/sqlite ./store/postgres ./store/mongo ./store/redis -run TestCheckpointOrderConformance -count=1 -v`.

Expected: FAIL because the current preview or pruning omits later ties or removes earlier ties. Verify every backend actually ran.

- [ ] Apply these exact changes:

```diff
--- a/store/memory/store.go
+++ b/store/memory/store.go
@@
-func (m *Store) ListCheckpoints(_ context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
-	m.mu.RLock()
-	defer m.mu.RUnlock()
-
-	prefix := runID.String() + ":"
-	var result []*workflow.Checkpoint
-	for k, cp := range m.checkpoints {
-		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
-			result = append(result, cp)
-		}
-	}
-
-	sort.Slice(result, func(i, k int) bool {
-		return result[i].CreatedAt.Before(result[k].CreatedAt)
-	})
-
-	return result, nil
-}
-
-
+func (m *Store) ListCheckpoints(_ context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
+	m.mu.RLock()
+	defer m.mu.RUnlock()
+
+	prefix := runID.String() + ":"
+	var result []*workflow.Checkpoint
+	for k, cp := range m.checkpoints {
+		if len(k) > len(prefix) && k[:len(prefix)] == prefix {
+			result = append(result, cp)
+		}
+	}
+
+	sort.Slice(result, func(i, k int) bool {
+		return workflow.CompareCheckpoints(result[i], result[k]) < 0
+	})
+
+	return result, nil
+}
+
+
--- a/store/memory/store.go
+++ b/store/memory/store.go
@@
-	// Delete all checkpoints for this run created at or after the target,
-	// except the target itself. Using !Before covers the case where
-	// multiple checkpoints share the exact same timestamp.
+	// Keep the target and earlier IDs when creation times tie.
--- a/store/memory/store.go
+++ b/store/memory/store.go
@@
-if !cp.CreatedAt.Before(target.CreatedAt) {
+if workflow.CompareCheckpoints(cp, target) > 0 {
--- a/store/postgres/workflow.go
+++ b/store/postgres/workflow.go
@@
-func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
-	var models []checkpointModel
-	err := s.pgdb.NewSelect(&models).
-		Where("run_id = ?", runID.String()).
-		OrderExpr("created_at ASC").
-		Scan(ctx)
-	if err != nil {
-		return nil, fmt.Errorf(errPrefix+"list checkpoints: %w", err)
-	}
-
-	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
-	for i := range models {
-		cp, convErr := fromCheckpointModel(&models[i])
-		if convErr != nil {
-			return nil, fmt.Errorf(errPrefix+"list checkpoints convert: %w", convErr)
-		}
-		checkpoints = append(checkpoints, cp)
-	}
-	return checkpoints, nil
-}
-
-
+func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
+	var models []checkpointModel
+	err := s.pgdb.NewSelect(&models).
+		Where("run_id = ?", runID.String()).
+		OrderExpr("created_at ASC, id ASC").
+		Scan(ctx)
+	if err != nil {
+		return nil, fmt.Errorf(errPrefix+"list checkpoints: %w", err)
+	}
+
+	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
+	for i := range models {
+		cp, convErr := fromCheckpointModel(&models[i])
+		if convErr != nil {
+			return nil, fmt.Errorf(errPrefix+"list checkpoints convert: %w", convErr)
+		}
+		checkpoints = append(checkpoints, cp)
+	}
+	return checkpoints, nil
+}
+
+
--- a/store/postgres/workflow.go
+++ b/store/postgres/workflow.go
@@
-Where("created_at > (SELECT created_at FROM dispatch_checkpoints WHERE run_id = ? AND step_name = ?)", runID.String(), afterStep).
+Where("(created_at, id) > (SELECT created_at, id FROM dispatch_checkpoints WHERE run_id = ? AND step_name = ?)", runID.String(), afterStep).
--- a/store/sqlite/workflow.go
+++ b/store/sqlite/workflow.go
@@
-func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
-	var models []checkpointModel
-	err := s.sdb.NewSelect(&models).
-		Where("run_id = ?", runID.String()).
-		OrderExpr("created_at ASC").
-		Scan(ctx)
-	if err != nil {
-		return nil, fmt.Errorf("dispatch/sqlite: list checkpoints: %w", err)
-	}
-
-	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
-	for i := range models {
-		cp, convErr := fromCheckpointModel(&models[i])
-		if convErr != nil {
-			return nil, fmt.Errorf("dispatch/sqlite: list checkpoints convert: %w", convErr)
-		}
-		checkpoints = append(checkpoints, cp)
-	}
-	return checkpoints, nil
-}
-
-
+func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
+	var models []checkpointModel
+	err := s.sdb.NewSelect(&models).
+		Where("run_id = ?", runID.String()).
+		OrderExpr("created_at ASC, id ASC").
+		Scan(ctx)
+	if err != nil {
+		return nil, fmt.Errorf("dispatch/sqlite: list checkpoints: %w", err)
+	}
+
+	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
+	for i := range models {
+		cp, convErr := fromCheckpointModel(&models[i])
+		if convErr != nil {
+			return nil, fmt.Errorf("dispatch/sqlite: list checkpoints convert: %w", convErr)
+		}
+		checkpoints = append(checkpoints, cp)
+	}
+	return checkpoints, nil
+}
+
+
--- a/store/sqlite/workflow.go
+++ b/store/sqlite/workflow.go
@@
-Where("created_at > (SELECT created_at FROM dispatch_checkpoints WHERE run_id = ? AND step_name = ?)", runID.String(), afterStep).
+Where("(created_at, id) > (SELECT created_at, id FROM dispatch_checkpoints WHERE run_id = ? AND step_name = ?)", runID.String(), afterStep).
--- a/store/mongo/workflow.go
+++ b/store/mongo/workflow.go
@@
-func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
-	col := s.mdb.Collection(colCheckpoints)
-
-	findOpts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})
-	cursor, err := col.Find(ctx, bson.M{"run_id": runID.String()}, findOpts)
-	if err != nil {
-		return nil, fmt.Errorf("dispatch/mongo: list checkpoints: %w", err)
-	}
-	defer cursor.Close(ctx)
-
-	var models []checkpointModel
-	if err := cursor.All(ctx, &models); err != nil {
-		return nil, fmt.Errorf("dispatch/mongo: list checkpoints decode: %w", err)
-	}
-
-	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
-	for i := range models {
-		cp, convErr := fromCheckpointModel(&models[i])
-		if convErr != nil {
-			return nil, fmt.Errorf("dispatch/mongo: list checkpoints convert: %w", convErr)
-		}
-		checkpoints = append(checkpoints, cp)
-	}
-	return checkpoints, nil
-}
-
-
+func (s *Store) ListCheckpoints(ctx context.Context, runID id.RunID) ([]*workflow.Checkpoint, error) {
+	col := s.mdb.Collection(colCheckpoints)
+
+	findOpts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}, {Key: "_id", Value: 1}})
+	cursor, err := col.Find(ctx, bson.M{"run_id": runID.String()}, findOpts)
+	if err != nil {
+		return nil, fmt.Errorf("dispatch/mongo: list checkpoints: %w", err)
+	}
+	defer cursor.Close(ctx)
+
+	var models []checkpointModel
+	if err := cursor.All(ctx, &models); err != nil {
+		return nil, fmt.Errorf("dispatch/mongo: list checkpoints decode: %w", err)
+	}
+
+	checkpoints := make([]*workflow.Checkpoint, 0, len(models))
+	for i := range models {
+		cp, convErr := fromCheckpointModel(&models[i])
+		if convErr != nil {
+			return nil, fmt.Errorf("dispatch/mongo: list checkpoints convert: %w", convErr)
+		}
+		checkpoints = append(checkpoints, cp)
+	}
+	return checkpoints, nil
+}
+
+
--- a/store/mongo/workflow.go
+++ b/store/mongo/workflow.go
@@
-		"created_at": bson.M{
-			"$gt": target.CreatedAt,
-		},
+		"$or": bson.A{
+			bson.M{"created_at": bson.M{"$gt": target.CreatedAt}},
+			bson.M{"created_at": target.CreatedAt, "_id": bson.M{"$gt": target.ID}},
+		},
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-	"fmt"
+	"fmt"
+	"sort"
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-	return checkpoints, nil
+	sort.Slice(checkpoints, func(i, j int) bool {
+		return workflow.CompareCheckpoints(checkpoints[i], checkpoints[j]) < 0
+	})
+	return checkpoints, nil
--- a/store/redis/workflow.go
+++ b/store/redis/workflow.go
@@
-if e.CreatedAt.After(target.CreatedAt) {
+if e.CreatedAt.After(target.CreatedAt) || (e.CreatedAt.Equal(target.CreatedAt) && e.ID > target.ID) {
```

- [ ] Format owned Go files with goimports and run `go test -tags integration -race -p 1 ./store/memory ./store/sqlite ./store/postgres ./store/mongo ./store/redis -run 'TestCheckpointOrderConformance|TestWorkflowConformance' -count=1 -v`. Expected: PASS, no backend skips.
- [ ] Run scoped ordinary lint. For Task 2 also inspect integration-tag lint; only the documented pre-existing Redis test shadow may remain.
- [ ] Inspect status, branch, staged scope and diff-check. Stage only the listed files.
- [ ] Commit with `git commit --only -m 'fix(store): prune checkpoints by a consistent time and ID boundary' -- store/storetest/checkpoint_order.go store/memory/checkpoint_order_test.go store/sqlite/checkpoint_order_test.go store/postgres/checkpoint_order_test.go store/mongo/checkpoint_order_test.go store/redis/checkpoint_order_test.go store/memory/store.go store/postgres/workflow.go store/sqlite/workflow.go store/mongo/workflow.go store/redis/workflow.go`. Inspect the commit stat.

## Final checks

- [ ] Full build/unit suite and ordinary lint pass.
- [ ] One fresh final reviewer checks the whole slice and the five focus cases.
- [ ] Consequential findings get a failing regression and verified fix.
- [ ] Record evidence in MIGRATION.md and this plan, then implement the workflow contract.
