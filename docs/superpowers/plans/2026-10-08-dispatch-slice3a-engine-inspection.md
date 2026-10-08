# Dispatch Slice 3a: engine inspection implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the read-only engine data needed by the Handler and Engine contract intents.

**Architecture:** Keep inspection beside the subsystem that owns each setting. The engine aggregates detached values; the contract will project them to camelCase wire DTOs. No inspection call starts work or reads executor environment values.

**Tech Stack:** Go, existing Dispatch registries and subsystem types.

**Spec:** ../specs/2026-10-07-dispatch-dashboard-migration-design.md

## Global constraints

- Work on main in the current primary checkouts. Preserve concurrent changes and use exact-path local commits.
- No push, branch, worktree, clone or memory-file update.
- This plan implements the inspection prerequisite of Slice 3. Contract bindings and UI remain separate plans.
- The contributor is operator-wide. These settings describe the serving process.
- Never import the root Forge dashboard package in production code.
- Dependency floors are Forge v1.12.0 and Grove v1.7.0. Preserve the separate in-progress dependency upgrade.
- Write shipped prose with rex-voice and embedded humanizer. No em dashes or attribution.
- Native execution is already authorized by the migration handoff. Continue after saving and checking the plan.

## Review focus

1. Version zero must appear as registered version one, and replacement must not duplicate it (Task 1).
2. A caller must not mutate registry versions, worker queues or engine resource maps through inspection (Tasks 1-3).
3. Disabled heartbeats and unbounded store calls must retain their meanings (Task 2).
4. Subprocess environment and argument secrets must never enter inspection output (Task 2).
5. An ignored scratch-root option must not be reported as effective with the artifact plane off (Task 3).

## File structure

Paths below are relative to /Users/rexraphael/Work/xraph/forgery/dispatch.
New inspection files keep these APIs separate from execution paths.
Each task lists its full source and tests. The contract consumes `Registry.Versions(name)`,
`Engine.Inspect()`, and `subprocess.Executor.Settings()`.

### Task 1: Expose every registered workflow version

**Files:** `workflow/inspection_test.go`, `workflow/inspection.go` (create).

**Interfaces:** Consumes the locked workflow registry. Produces `Versions(name string) []int`.

- [ ] Write these failing tests:

`workflow/inspection_test.go`

```go
package workflow_test

import (
 "reflect"
 "testing"
 "github.com/xraph/dispatch/workflow"
)

func TestRegistryVersions(t *testing.T) {
 r := workflow.NewRegistry()
 for _, version := range []int{3, 0, 2, 3} {
  def := workflow.NewWorkflow("versions", func(*workflow.Workflow, struct{}) error { return nil })
  def.Version = version
  workflow.RegisterDefinition(r, def)
 }
 got := r.Versions("versions")
 if !reflect.DeepEqual(got, []int{1, 2, 3}) { t.Fatalf("versions = %v", got) }
 got[0] = 999
 if !reflect.DeepEqual(r.Versions("versions"), []int{1, 2, 3}) { t.Fatal("caller changed registry") }
 if got := r.Versions("missing"); len(got) != 0 { t.Fatalf("unknown workflow = %v", got) }
}
```

- [ ] Run `go test -race ./workflow -run TestRegistryVersions`. Expect missing inspection methods.

- [ ] Add the implementations:

`workflow/inspection.go`

```go
package workflow

import "sort"

// Versions returns the registered versions in ascending order.
func (r *Registry) Versions(name string) []int {
 r.mu.RLock()
 defer r.mu.RUnlock()
 versions := make([]int, 0, len(r.versions[name]))
 for _, entry := range r.versions[name] { versions = append(versions, entry.version) }
 sort.Ints(versions)
 return versions
}
```

- [ ] Run `gofmt -w workflow/inspection_test.go workflow/inspection.go`, then `go test -race ./workflow -run TestRegistryVersions`. Expect success.
- [ ] Inspect branch, status, staged diff and `git diff --check`. Stage only these paths and commit:

```sh
git add workflow/inspection_test.go workflow/inspection.go
git commit --only -m 'feat(workflow): expose registered definition versions' -- workflow/inspection_test.go workflow/inspection.go
git show --stat HEAD
```

### Task 2: Expose effective subsystem settings

**Files:** `worker/settings_test.go`, `cron/settings_test.go`, `exec/subprocess/settings_test.go`, `worker/settings.go`, `cron/settings.go`, `exec/subprocess/settings.go` (create).

**Interfaces:** Consumes immutable construction options. Produces `Pool.Settings() worker.Settings`, `Scheduler.Settings() cron.Settings` and `subprocess.Executor.Settings() subprocess.Settings`.

- [ ] Write these failing tests:

`worker/settings_test.go`

```go
package worker

import (
 "testing"
 "time"
 log "github.com/xraph/go-utils/log"
)

func TestSettingsResolveDefaultsAndCopyQueues(t *testing.T) {
 p := NewPool(nil, nil, nil, log.NewNoopLogger(), WithPollInterval(time.Minute),
  WithPoolQueues([]string{"mail"}), WithStaleJobThreshold(45*time.Second),
  WithHeartbeatInterval(0), WithStoreCallTimeout(-1))
 got := p.Settings()
 if got.MaxPollInterval != time.Minute || got.DefaultLeaseTTL != 45*time.Second ||
  got.ReapInterval != DefaultReapInterval || got.HeartbeatInterval != 0 || got.StoreCallsBounded {
  t.Fatalf("settings = %+v", got)
 }
 got.Queues[0] = "changed"
 if p.Settings().Queues[0] != "mail" { t.Fatal("caller changed queues") }
 if d := NewPool(nil, nil, nil, log.NewNoopLogger()).Settings(); d.StoreCallTimeout != defaultStoreCallTimeout || !d.StoreCallsBounded {
  t.Fatalf("default timeout = %+v", d)
 }
}
```

`cron/settings_test.go`

```go
package cron

import (
 "testing"
 "time"
 "github.com/xraph/dispatch/id"
 log "github.com/xraph/go-utils/log"
)

func TestSettingsMatchSchedulerDefaultsAndOverrides(t *testing.T) {
 s := NewScheduler(nil, nil, nil, nil, id.NewWorkerID(), log.NewNoopLogger())
 got := s.Settings()
 if got.TickInterval != time.Second || got.LeaderTTL != time.Minute ||
  got.RefreshInterval != 30*time.Second || got.LockTTL != 30*time.Second ||
  got.StoreCallTimeout != defaultStoreCallTimeout || !got.StoreCallsBounded { t.Fatalf("defaults = %+v", got) }
 s = NewScheduler(nil, nil, nil, nil, id.NewWorkerID(), log.NewNoopLogger(), WithSchedulerStoreCallTimeout(-1))
 if s.Settings().StoreCallsBounded { t.Fatal("negative timeout should be unbounded") }
}
```

`exec/subprocess/settings_test.go`

```go
package subprocess

import (
 "encoding/json"
 "strings"
 "testing"
)

func TestSettingsExcludeEnvironmentAndReportCoreLimit(t *testing.T) {
 e := New(WithEnv(map[string]string{"API_KEY": "private-value"}), WithArgs("secret-arg"),
  WithUser(123, 456), WithRlimits(Rlimits{AddressSpace: 1024, Core: 100}),
  WithStrictRlimits(), WithScratchDir("/scratch"))
 got := e.Settings()
 if !got.UserConfigured || got.UID != 123 || got.GID != 456 || !got.HasRlimits ||
  got.Rlimits.AddressSpace != 1024 || got.Rlimits.Core != 0 || !got.StrictRlimits || got.ScratchDir != "/scratch" {
  t.Fatalf("settings = %+v", got)
 }
 data, err := json.Marshal(got)
 if err != nil { t.Fatal(err) }
 if strings.Contains(string(data), "private-value") || strings.Contains(string(data), "secret-arg") { t.Fatal("settings exposed secrets") }
 got.Rlimits.AddressSpace = 999
 if e.Settings().Rlimits.AddressSpace != 1024 { t.Fatal("caller changed limits") }
}
```

- [ ] Run `go test -race ./worker ./cron ./exec/subprocess -run TestSettings`. Expect missing inspection methods.

- [ ] Add the implementations:

`worker/settings.go`

```go
package worker

import (
 "slices"
 "time"
)

// Settings is the effective configuration of this process's worker pool.
type Settings struct {
 Concurrency int
 Queues []string
 PollInterval, MaxPollInterval, HeartbeatInterval, StaleJobThreshold time.Duration
 ReapInterval, DefaultLeaseTTL, StoreCallTimeout time.Duration
 StoreCallsBounded, ReapingEnabled, LeasesEnabled bool
}

// Settings returns a detached view, without worker state or credentials.
func (p *Pool) Settings() Settings {
 timeout := p.storeCallTimeout
 if timeout == 0 { timeout = defaultStoreCallTimeout }
 return Settings{
  Concurrency: p.concurrency, Queues: slices.Clone(p.queues),
  PollInterval: p.pollInterval, MaxPollInterval: p.maxPollInterval,
  HeartbeatInterval: p.heartbeatInterval, StaleJobThreshold: p.staleJobThreshold,
  ReapInterval: p.resolvedReapInterval(), DefaultLeaseTTL: p.leaseTTLFor(nil),
  StoreCallTimeout: timeout, StoreCallsBounded: timeout > 0,
  ReapingEnabled: p.staleJobThreshold > 0, LeasesEnabled: p.leaseStore != nil,
 }
}
```

`cron/settings.go`

```go
package cron

import "time"

// Settings is the configuration of this process's scheduler.
type Settings struct {
 TickInterval, LeaderTTL, RefreshInterval, LockTTL, StoreCallTimeout time.Duration
 StoreCallsBounded bool
}

// Settings reports the effective scheduler timings.
func (s *Scheduler) Settings() Settings {
 timeout := s.storeCallTimeout
 if timeout == 0 { timeout = defaultStoreCallTimeout }
 return Settings{
  TickInterval: s.tickInterval, LeaderTTL: s.leaderTTL,
  RefreshInterval: s.cronRefreshInterval, LockTTL: s.lockTTL,
  StoreCallTimeout: timeout, StoreCallsBounded: timeout > 0,
 }
}
```

`exec/subprocess/settings.go`

```go
package subprocess

// Settings describes process isolation without exposing its environment or arguments.
// Rlimits are requested ceilings. Kernel support still determines enforcement.
type Settings struct {
 UserConfigured bool
 UID, GID int
 AllowSameUser, HasRlimits, StrictRlimits bool
 Rlimits Rlimits
 ScratchDir string
}

// Settings returns safe inspection fields. The subprocess requests a zero core-dump limit.
func (e *Executor) Settings() Settings {
 limits := e.opts.rlimits
 limits.Core = 0
 return Settings{
  UserConfigured: e.opts.hasUser, UID: e.opts.uid, GID: e.opts.gid,
  AllowSameUser: e.opts.allowSameUser, HasRlimits: e.opts.hasRlimits,
  StrictRlimits: e.opts.strictRlimits, Rlimits: limits, ScratchDir: e.opts.scratchDir,
 }
}
```

- [ ] Run `gofmt -w worker/settings_test.go cron/settings_test.go exec/subprocess/settings_test.go worker/settings.go cron/settings.go exec/subprocess/settings.go`, then `go test -race ./worker ./cron ./exec/subprocess -run TestSettings`. Expect success.
- [ ] Inspect branch, status, staged diff and `git diff --check`. Stage only these paths and commit:

```sh
git add worker/settings_test.go cron/settings_test.go exec/subprocess/settings_test.go worker/settings.go cron/settings.go exec/subprocess/settings.go
git commit --only -m 'feat: expose worker, cron and subprocess settings' -- worker/settings_test.go cron/settings_test.go exec/subprocess/settings_test.go worker/settings.go cron/settings.go exec/subprocess/settings.go
git show --stat HEAD
```

### Task 3: Aggregate process inspection without leaking mutable engine configuration

**Files:** `engine/inspection_test.go`, `engine/inspection.go` (create).

**Interfaces:** Consumes subsystem Settings from Task 2 and Engine's configuration. Produces `Engine.Inspect() Inspection`.

- [ ] Write these failing tests:

`engine/inspection_test.go`

```go
package engine_test

import (
 "os"
 "testing"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/engine"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store/memory"
)

func TestInspectionCopiesConfigurationAndReportsEffectiveScratch(t *testing.T) {
 d, err := dispatch.New(dispatch.WithStore(memory.New()), dispatch.WithQueues([]string{"mail"}))
 if err != nil { t.Fatal(err) }
 eng, err := engine.Build(d,
  engine.WithResourceDefaults(resource.Set{resource.Memory: 100}, map[string]resource.Set{"mail": {resource.CPU: 2}}),
  engine.WithWorkerCapacity(resource.Set{resource.Memory: 1000}),
  engine.WithWorkerCustomKeys([]string{"gpu"}), engine.WithScratchRoot("/ignored-without-artifacts"))
 if err != nil { t.Fatal(err) }
 got := eng.Inspect()
 if got.ScratchRoot != os.TempDir() || got.ResourceManagerEnabled || got.EstimatorConfigured {
  t.Fatalf("inspection = %+v", got)
 }
 got.Config.Queues[0] = "changed"
 got.ResourceDefaults[resource.Memory] = 0
 got.QueueResources["mail"][resource.CPU] = 0
 got.WorkerCapacity[resource.Memory] = 0
 got.WorkerCustomKeys[0] = "changed"
 after := eng.Inspect()
 if after.Config.Queues[0] != "mail" || after.ResourceDefaults[resource.Memory] != 100 ||
  after.QueueResources["mail"][resource.CPU] != 2 || after.WorkerCapacity[resource.Memory] != 1000 ||
  after.WorkerCustomKeys[0] != "gpu" { t.Fatal("caller changed engine configuration") }
}
```

- [ ] Run `go test -race ./engine -run TestInspection`. Expect missing inspection methods.

- [ ] Add the implementations:

`engine/inspection.go`

```go
package engine

import (
 "os"
 "slices"
 "github.com/xraph/dispatch"
 "github.com/xraph/dispatch/cron"
 "github.com/xraph/dispatch/resource"
 "github.com/xraph/dispatch/store"
 "github.com/xraph/dispatch/worker"
)

// Inspection describes the serving process. It makes no fleet-wide health claim.
type Inspection struct {
 Config dispatch.Config
 Pool worker.Settings
 Cron cron.Settings
 ResourceDefaults resource.Set
 QueueResources map[string]resource.Set
 WorkerCapacity resource.Set
 WorkerCustomKeys []string
 ResourceManagerEnabled, EstimatorConfigured bool
 ScratchRoot string
 WakeNotifierSupported bool
}

// Inspect returns detached configuration and effective subsystem settings.
func (eng *Engine) Inspect() Inspection {
 cfg := eng.d.Config()
 cfg.Queues = slices.Clone(cfg.Queues)
 queues := make(map[string]resource.Set, len(eng.queueResources))
 for name, resources := range eng.queueResources { queues[name] = resources.Clone() }
 scratch := os.TempDir()
 if eng.artifacts != nil && eng.scratchRoot != "" { scratch = eng.scratchRoot }
 _, wakeSupported := eng.jobStore.(store.WakeNotifier)
 return Inspection{
  Config: cfg, Pool: eng.pool.Settings(), Cron: eng.scheduler.Settings(),
  ResourceDefaults: eng.resourceDefault.Clone(), QueueResources: queues,
  WorkerCapacity: eng.workerCapacity.Clone(), WorkerCustomKeys: slices.Clone(eng.workerCustomKeys),
  ResourceManagerEnabled: eng.resources != nil, EstimatorConfigured: eng.estimator != nil,
  ScratchRoot: scratch, WakeNotifierSupported: wakeSupported,
 }
}
```

- [ ] Run `gofmt -w engine/inspection_test.go engine/inspection.go`, then `go test -race ./engine -run TestInspection`. Expect success.
- [ ] Inspect branch, status, staged diff and `git diff --check`. Stage only these paths and commit:

```sh
git add engine/inspection_test.go engine/inspection.go
git commit --only -m 'feat(engine): expose read-only process inspection' -- engine/inspection_test.go engine/inspection.go
git show --stat HEAD
```

## Final verification

- [ ] Run `go build ./...`, `go test ./...` and fresh-cache `golangci-lint run ./...`.
- [ ] Request the native execution workflow's fresh final review. Fix actionable findings before contract implementation.
- [ ] Record actual results and commit IDs. Passing inspection tests establishes no browser parity.

## Self-review

Completed 2026-10-08 on Dispatch main: Task 1 `faf6710`, Task 2 `e323893`,
Task 3 `6de5530`. Each task failed for its missing method before implementation,
then passed focused race tests. Full build/unit and fresh-cache ordinary lint
passed. The independent final reviewer repeated focused race tests across all
five affected packages and approved the result, with the subprocess comment
correction reflected above. Contract and browser work remain outstanding.

The five failure modes above have concrete tests. The API names match their consumers. No
source file adds a dashboard dependency. Broader contract, plugin, fixture, browser and
retirement requirements remain in the approved migration spec and are not claimed complete here.
