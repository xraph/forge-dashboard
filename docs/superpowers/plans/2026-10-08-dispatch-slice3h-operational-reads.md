# Dispatch Slice 3h: operational read prerequisites implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Redis outages visible in operational summaries and expose the engine's actual worker liveness timing.

**Architecture:** Direct worker and cron reads validate their storage identity; list and leader reads reuse them and skip only genuine missing rows. Job counts propagate read/decode errors and validate the counted ID. Engine inspection reports its existing row heartbeat and fleet staleness methods without duplicating those rules in the dashboard.

**Tech Stack:** Go, Redis testcontainers, existing engine inspection API.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Primary main checkouts only; preserve concurrent module and dashboard changes. Focused local commits, no branches, worktrees or pushes.
- Store read failures stay errors. Do not invent empty counts, a healthy fleet, or a dead-worker state.
- Preserve missing-row behavior and existing worker/job heartbeat semantics.
- No schema changes or credentials in inspection.
- This prerequisite supports the remaining operational contract domains. Browser verification and templ retirement remain pending.
- Use rex-voice and humanizer for shipped prose. No em dashes or attribution.

## Review focus

1. A job-count GET outage or malformed JSON must fail the count, not report zero (Task 1).
2. An unavailable leader record must remain an error; a genuinely absent leader row returns nil (Task 1).
3. A valid but different worker or cron ID in a Redis record must not become another resource in direct/list/leader reads (Task 1).
4. Dangling valid index members must remain skippable without hiding transport or decode failures (Task 1).
5. Zero or negative job heartbeat settings must keep the worker row's 10-second fallback, with the existing five-minute stale minimum (Task 2).

## Rulings

- Reuse the existing max(5 times configured heartbeat, five minutes) stale threshold. It describes this engine's fleet-capacity cutoff, not proof that a remote process died.
- Expose job and worker row heartbeat timings separately. Job heartbeat zero can disable job renewal while worker registration still needs a heartbeat.
- Remote workers do not persist a heartbeat interval. The later UI will show their recorded age and the serving process's comparison threshold; only the serving worker has a known configured interval.
- Job counts decode identity and filter fields only, preserving their existing lightweight payload treatment.
- Identity checks cover the worker and cron reads needed by the remaining summaries. The completed workflow slice already validates workflow keys and records.

## File structure and interfaces

Paths are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
Task 1 modifies existing Redis methods only; its test reuses the committed
workflowReadFault hook. Task 2 adds WorkerHeartbeatInterval and
WorkerStaleThreshold (both time.Duration) to engine.Inspection. Later contract
projections consume these fields; no existing signature changes.

### Task 1: Reject incomplete Redis summary reads

**Files:** `store/redis/summary_reads_test.go`, `store/redis/cluster.go`, `store/redis/cron.go`, `store/redis/job.go`.

- [ ] Write these tests:

`store/redis/summary_reads_test.go`

```go
//go:build integration

package redis_test

import (
 "context"
 "encoding/json"
 "testing"
 "time"

 "github.com/xraph/grove/kv/drivers/redisdriver"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/cluster"
 "github.com/xraph/dispatch/cron"
 "github.com/xraph/dispatch/id"
 "github.com/xraph/dispatch/job"
 redisstore "github.com/xraph/dispatch/store/redis"
)

func TestSummaryReadsPropagateOutagesAndCorruptRecords(t *testing.T){
 ctx:=context.Background();kvStore:=setupTestKV(t);s:=redisstore.New(kvStore);client:=redisdriver.UnwrapClient(kvStore)
 hook:=&workflowReadFault{};hook.key.Store("");client.AddHook(hook)
 worker:=&cluster.Worker{ID:id.NewWorkerID(),State:cluster.WorkerActive,LastSeen:time.Now(),CreatedAt:time.Now()}
 if err:=s.RegisterWorker(ctx,worker);err!=nil{t.Fatal(err)}
 if ok,err:=s.AcquireLeadership(ctx,worker.ID,time.Minute);err!=nil||!ok{t.Fatalf("leader=%v, %v",ok,err)}
 entry:=&cron.Entry{Entity:dispatch.NewEntity(),ID:id.NewCronID(),Name:"summary",Schedule:"@every 1h",JobName:"summary",Enabled:true}
 if err:=s.RegisterCron(ctx,entry);err!=nil{t.Fatal(err)}
 j:=&job.Job{Entity:dispatch.NewEntity(),ID:id.NewJobID(),Name:"summary",Queue:"default",State:job.StatePending,RunAt:time.Now()}
 if err:=s.EnqueueJob(ctx,j);err!=nil{t.Fatal(err)}
 reads:=map[string]struct{key,otherID string;call func()error}{
  "workers":{ "dispatch:worker:"+worker.ID.String(),id.NewWorkerID().String(),func()error{_,err:=s.ListWorkers(ctx);return err}},
  "worker":{ "dispatch:worker:"+worker.ID.String(),id.NewWorkerID().String(),func()error{_,err:=s.GetWorker(ctx,worker.ID);return err}},
  "leader":{ "dispatch:worker:"+worker.ID.String(),id.NewWorkerID().String(),func()error{_,err:=s.GetLeader(ctx);return err}},
  "crons":{ "dispatch:cron:"+entry.ID.String(),id.NewCronID().String(),func()error{_,err:=s.ListCrons(ctx);return err}},
  "cron":{ "dispatch:cron:"+entry.ID.String(),id.NewCronID().String(),func()error{_,err:=s.GetCron(ctx,entry.ID);return err}},
  "job-count":{ "dispatch:job:"+j.ID.String(),id.NewJobID().String(),func()error{_,err:=s.CountJobs(ctx,job.CountOpts{});return err}},
 }
 for name,read:=range reads{t.Run(name,func(t *testing.T){
  original,readErr:=client.Get(ctx,read.key).Bytes();if readErr!=nil{t.Fatal(readErr)}
  for _,mode:=range []string{"outage","json","invalid-id","mismatched-id"}{t.Run(mode,func(t *testing.T){
   t.Cleanup(func(){hook.key.Store("");if restoreErr:=client.Set(ctx,read.key,original,0).Err();restoreErr!=nil{t.Error(restoreErr)}})
   if mode=="outage"{hook.key.Store(read.key)}else{
    data:=[]byte("{broken")
    if mode!="json"{
     var record map[string]json.RawMessage
     if decodeErr:=json.Unmarshal(original,&record);decodeErr!=nil{t.Fatal(decodeErr)}
     identity:="broken";if mode=="mismatched-id"{identity=read.otherID}
     record["id"],_=json.Marshal(identity)
     var encodeErr error;data,encodeErr=json.Marshal(record);if encodeErr!=nil{t.Fatal(encodeErr)}
    }
    if setErr:=client.Set(ctx,read.key,data,0).Err();setErr!=nil{t.Fatal(setErr)}
   }
   if callErr:=read.call();callErr==nil{t.Fatal("unreadable or mismatched row became a successful summary")}
  })}
 })}
 // Dangling valid members still represent absent rows, not read failures.
 for key,member:=range map[string]string{"dispatch:worker_ids":id.NewWorkerID().String(),"dispatch:cron_ids":id.NewCronID().String(),"dispatch:job_ids":id.NewJobID().String()}{
  if err:=client.SAdd(ctx,key,member).Err();err!=nil{t.Fatal(err)}
 }
 workers,err:=s.ListWorkers(ctx);if err!=nil||len(workers)!=1{t.Fatalf("workers=%v, %v",workers,err)}
 entries,err:=s.ListCrons(ctx);if err!=nil||len(entries)!=1{t.Fatalf("crons=%v, %v",entries,err)}
 count,err:=s.CountJobs(ctx,job.CountOpts{});if err!=nil||count!=1{t.Fatalf("count=%v, %v",count,err)}
 if err:=client.Del(ctx,"dispatch:worker:"+worker.ID.String()).Err();err!=nil{t.Fatal(err)}
 leader,err:=s.GetLeader(ctx);if err!=nil||leader!=nil{t.Fatalf("missing leader row=%+v, %v",leader,err)}
}
```

- [ ] Run `go test -tags integration -race ./store/redis -run 'TestSummaryReads|TestJobStore_CountJobs|TestClusterStore|TestCronStore' -count=1 -v` before implementation. Expected: FAIL. Unreadable worker/cron/job rows are silently skipped, and different valid record IDs are accepted.

- [ ] Apply these changes:

```diff
--- a/store/redis/cluster.go
+++ b/store/redis/cluster.go
@@
-	"context"
+	"context"
+	"errors"
--- a/store/redis/cluster.go
+++ b/store/redis/cluster.go
@@
-	return fromWorkerEntity(&e)
-}
-
-// ListWorkers
+	if e.ID != workerID.String() { return nil, fmt.Errorf("dispatch/redis: worker identity mismatch for key %s", workerID) }
+	return fromWorkerEntity(&e)
+}
+
+// ListWorkers
--- a/store/redis/cluster.go
+++ b/store/redis/cluster.go
@@
-		var e workerEntity
-		if getErr := s.getEntity(ctx, s.keys.worker(wID), &e); getErr != nil {
-			continue
-		}
-		w, convErr := fromWorkerEntity(&e)
-		if convErr != nil {
-			continue
-		}
-		workers = append(workers, w)
+		workerID, parseErr := id.ParseWorkerID(wID)
+		if parseErr != nil { return nil, fmt.Errorf("dispatch/redis: parse worker index ID: %w", parseErr) }
+		w, readErr := s.GetWorker(ctx, workerID)
+		if errors.Is(readErr, dispatch.ErrWorkerNotFound) { continue }
+		if readErr != nil { return nil, readErr }
+		workers = append(workers, w)
--- a/store/redis/cluster.go
+++ b/store/redis/cluster.go
@@
-	var e workerEntity
-	if getErr := s.getEntity(ctx, s.keys.worker(wID), &e); getErr != nil {
-		return nil, nil // leader key exists but worker gone
-	}
-	return fromWorkerEntity(&e)
-}
+	workerID, parseErr := id.ParseWorkerID(wID)
+	if parseErr != nil { return nil, fmt.Errorf("dispatch/redis: parse leader ID: %w", parseErr) }
+	worker, readErr := s.GetWorker(ctx, workerID)
+	if errors.Is(readErr, dispatch.ErrWorkerNotFound) { return nil, nil }
+	return worker, readErr
+}
--- a/store/redis/cron.go
+++ b/store/redis/cron.go
@@
-	return fromCronEntity(&e)
-}
-
-// ListCrons
+	if e.ID != entryID.String() { return nil, fmt.Errorf("dispatch/redis: cron identity mismatch for key %s", entryID) }
+	return fromCronEntity(&e)
+}
+
+// ListCrons
--- a/store/redis/cron.go
+++ b/store/redis/cron.go
@@
-		var e cronEntity
-		if getErr := s.getEntity(ctx, s.keys.cron(eID), &e); getErr != nil {
-			continue
-		}
-		entry, convErr := fromCronEntity(&e)
-		if convErr != nil {
-			continue
-		}
-		entries = append(entries, entry)
+		entryID, parseErr := id.ParseCronID(eID)
+		if parseErr != nil { return nil, fmt.Errorf("dispatch/redis: parse cron index ID: %w", parseErr) }
+		entry, readErr := s.GetCron(ctx, entryID)
+		if errors.Is(readErr, dispatch.ErrCronNotFound) { continue }
+		if readErr != nil { return nil, readErr }
+		entries = append(entries, entry)
--- a/store/redis/job.go
+++ b/store/redis/job.go
@@
-		raw, getErr := s.kv.GetRaw(ctx, s.keys.job(jID))
-		if getErr != nil {
-			continue
-		}
-		// Quick check state/queue from JSON without full decode.
-		var partial struct {
-			State string `json:"state"`
-			Queue string `json:"queue"`
-		}
-		if json.Unmarshal(raw, &partial) != nil {
-			continue
-		}
+		raw, getErr := s.kv.GetRaw(ctx, s.keys.job(jID))
+		if getErr != nil {
+			if isNotFound(getErr) { continue }
+			return 0, fmt.Errorf("dispatch/redis: count job read: %w", getErr)
+		}
+		// Counts need identity and filter fields, without decoding payloads.
+		var partial struct {
+			ID string `json:"id"`
+			State string `json:"state"`
+			Queue string `json:"queue"`
+		}
+		if decodeErr := json.Unmarshal(raw, &partial); decodeErr != nil {
+			return 0, fmt.Errorf("dispatch/redis: count job decode: %w", decodeErr)
+		}
+		parsed, parseErr := id.ParseJobID(partial.ID)
+		if parseErr != nil || parsed.IsNil() || parsed.String() != jID {
+			return 0, fmt.Errorf("dispatch/redis: count job identity mismatch for key %s", jID)
+		}
```

- [ ] Format owned Go files with goimports. Run `go test -tags integration -race ./store/redis -run 'TestSummaryReads|TestJobStore_CountJobs|TestClusterStore|TestCronStore' -count=1 -v`; expected PASS. Inspect every backend skip.
- [ ] Run scoped lint using --allow-serial-runners. Only the existing integration-tag store/redis/store_test.go:54 shadow may remain.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'fix(redis): surface failures in operational summary reads' -- store/redis/summary_reads_test.go store/redis/cluster.go store/redis/cron.go store/redis/job.go`. Inspect the stat and record results.

### Task 2: Report effective worker row heartbeat timings

**Files:** `engine/inspection_heartbeat_test.go`, `engine/inspection.go`.

- [ ] Write these tests:

`engine/inspection_heartbeat_test.go`

```go
package engine_test

import (
 "context"
 "testing"
 "time"

 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/store/memory"
)

func TestInspectionReportsEffectiveWorkerHeartbeatAndStaleThreshold(t *testing.T){
 for _,configured:=range []time.Duration{0,-time.Second,10*time.Second,2*time.Minute}{
  t.Run(configured.String(),func(t *testing.T){
   d,err:=dispatch.New(dispatch.WithStore(memory.New()),dispatch.WithHeartbeatInterval(configured));if err!=nil{t.Fatal(err)}
   eng,err:=engine.Build(d);if err!=nil{t.Fatal(err)};t.Cleanup(func(){_ = eng.Stop(context.Background())})
   got:=eng.Inspect();want:=configured;if want<=0{want=10*time.Second}
   if got.WorkerHeartbeatInterval!=want||got.WorkerStaleThreshold!=max(5*configured,5*time.Minute){t.Fatalf("timings=%+v",got)}
   if got.Pool.HeartbeatInterval!=configured{t.Fatal("job heartbeat setting was replaced by the row heartbeat fallback")}
  })
 }
}
```

- [ ] Run `go test -race ./engine -run 'TestInspection|TestEngine.*Heartbeat' -count=1` before implementation. Expected: FAIL. Inspection has no worker row heartbeat interval or stale threshold.

- [ ] Apply these changes:

```diff
--- a/engine/inspection.go
+++ b/engine/inspection.go
@@
-	"slices"
+	"slices"
+	"time"
--- a/engine/inspection.go
+++ b/engine/inspection.go
@@
-	WakeNotifierSupported                       bool
+	WakeNotifierSupported                       bool
+	WorkerHeartbeatInterval, WorkerStaleThreshold time.Duration
--- a/engine/inspection.go
+++ b/engine/inspection.go
@@
-		ScratchRoot: scratch, WakeNotifierSupported: wakeSupported,
+		ScratchRoot: scratch, WakeNotifierSupported: wakeSupported,
+		WorkerHeartbeatInterval: eng.workerHeartbeatInterval(), WorkerStaleThreshold: eng.staleWorkerThreshold(),
```

- [ ] Format owned Go files with goimports. Run `go test -race ./engine -run 'TestInspection|TestEngine.*Heartbeat' -count=1`; expected PASS. Inspect every backend skip.
- [ ] Run scoped lint using --allow-serial-runners. Only the existing integration-tag store/redis/store_test.go:54 shadow may remain.
- [ ] Inspect branch, status, staged scope and diff-check. Stage exactly the listed paths, then commit with `git commit --only -m 'feat(engine): expose worker heartbeat inspection timings' -- engine/inspection_heartbeat_test.go engine/inspection.go`. Inspect the stat and record results.

## Final checks

- [ ] Full build/unit, affected race suites and ordinary lint pass.
- [ ] One fresh final reviewer checks this slice and all five focus cases.
- [ ] Fix consequential findings with failing regressions and verified results. No second review.
- [ ] Record evidence and remaining contract/browser work in this plan and MIGRATION.md.
