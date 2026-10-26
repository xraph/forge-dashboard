package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	"github.com/xraph/sentinel"
	se "github.com/xraph/sentinel/engine"
	ssqlite "github.com/xraph/sentinel/store/sqlite"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/optimization/artifacts"
	osqlite "github.com/xraph/cortex/optimization/store/sqlite"
	sadapter "github.com/xraph/cortex/sentinel/optimization"
)

const cortexOptimizationRevision = "local-synthetic-record-host-v5"
const cortexOptimizationCorpusRevision = "local-synthetic-record-v1"
const cortexOptimizationOperator = "cortex-demo-operator"
const cortexOptimizationWorker = "cortex-demo-optimization-worker"

type cortexOptimizationIdentityKey struct{}
type cortexOptimizationIdentity struct {
	host    *cortexDemoOptimizationHost
	subject string
}
type cortexDemoOptimizationHost struct {
	Optimizer    *opt.Optimizer
	verification *cortexDemoVerificationHost
	repository   *osqlite.Store
	sentinel     *ssqlite.Store
	evaluator    *sadapter.Evaluator
	access       *sadapter.CatalogAccess
	runtime      *engine.Engine
	trialRuntime *engine.Engine
	model        *cortexOptimizationModel
	journal      *cortexOptimizationJournal
	environment  *cortexOptimizationEnvironments
	frozen       cortexOptimizationCatalog
	mu           sync.Mutex
	cancel       context.CancelFunc
	done         chan struct{}
	started      atomic.Bool
	workerFailed atomic.Bool
	stopped      atomic.Bool
	closed       bool
}

func cortexOptimizationDB(ctx context.Context, path string) (*grove.DB, error) {
	driver := sqlitedriver.New()
	if err := driver.Open(ctx, path+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)"); err != nil {
		return nil, err
	}
	db, err := grove.Open(driver)
	if err != nil {
		return nil, err
	}
	return db, nil
}
func configureCortexDemoOptimization(v *cortexDemoVerificationHost, path string) (host *cortexDemoOptimizationHost, resultErr error) {
	if !envBool("DEMO_CORTEX_OPTIMIZATION", false) {
		return nil, nil
	}
	if v == nil || path == "" || os.Getenv("DEMO_CORTEX_PROVIDER") != "ollama" {
		return nil, opt.ErrUnavailable
	}
	return newCortexDemoOptimization(v, path, newCortexOptimizationModel())
}
func newCortexDemoOptimization(v *cortexDemoVerificationHost, path string, model *cortexOptimizationModel) (host *cortexDemoOptimizationHost, resultErr error) {
	h := &cortexDemoOptimizationHost{verification: v, model: model}
	defer func() {
		if resultErr != nil {
			resultErr = errors.Join(resultErr, h.Stop(context.Background()))
		}
	}()
	ctx := h.serviceContext(context.Background())
	if err := v.currentAuthority(ctx); err != nil {
		return nil, err
	}
	if err := h.model.check(ctx); err != nil {
		return nil, err
	}
	directory := filepath.Clean(path) + ".optimization"
	var err error
	h.journal, err = openCortexOptimizationJournal(ctx, directory)
	if err != nil {
		return nil, err
	}
	db, err := cortexOptimizationDB(ctx, filepath.Join(directory, "optimizer.db"))
	if err != nil {
		return nil, err
	}
	h.repository = osqlite.New(db)
	h.model.record = h.recordController
	h.model.format = cortexOptimizationResponseFormat
	if operationErr := h.repository.Migrate(ctx); operationErr != nil {
		return nil, operationErr
	}
	evaluationDB, err := cortexOptimizationDB(ctx, filepath.Join(directory, "evaluation.db"))
	if err != nil {
		return nil, err
	}
	h.sentinel = ssqlite.New(evaluationDB)
	if operationErr := h.sentinel.Migrate(ctx); operationErr != nil {
		return nil, operationErr
	}
	options := []engine.Option{engine.WithStore(v.storage), engine.WithModelRevision("demo-local", cortexOptimizationModelRevision)}
	h.runtime, err = engine.New(append(options, engine.WithLLM(h.model))...)
	if err != nil {
		return nil, err
	}
	h.trialRuntime, err = engine.New(append(options, engine.WithLLM(cortexOptimizationTrialModel{provider: h.model}))...)
	if err != nil {
		return nil, err
	}
	scoring, err := se.New(se.WithStore(h.sentinel))
	if err != nil {
		return nil, err
	}
	if operationErr := h.loadCatalog(ctx, scoring); operationErr != nil {
		return nil, operationErr
	}
	h.evaluator, err = sadapter.NewEvaluator(sadapter.Config{Engine: scoring, Mapper: h, Bindings: []sadapter.Binding{h.frozen.Binding}, Repository: h.repository})
	if err != nil {
		return nil, err
	}
	h.access, err = sadapter.NewCatalogAccess(h.evaluator, h)
	if err != nil {
		return nil, err
	}
	h.environment = &cortexOptimizationEnvironments{journal: h.journal, repository: h.repository, runtime: h.trialRuntime, authorize: h.current, scope: v.scope, agentID: h.frozen.AgentID, snapshot: h.frozen.Environment, artifacts: h}
	trials, err := opt.NewTrialPhaseHandler(opt.TrialConfig{Repository: h.repository, Authorizer: h, IdentityResolver: h, Environments: h.environment, Evaluator: h.evaluator, Allowance: opt.TrialAllowance{MaxTokens: cortexOptimizationContext + cortexOptimizationOutput}})
	if err != nil {
		return nil, err
	}
	controllers, err := opt.NewControllerFactory(h.repository, h, h, []opt.ModelBinding{{Model: "demo-local", Revision: cortexOptimizationModelRevision, Provider: cortexOptimizationControllerModel{h}, Counter: cortexOptimizationControllerModel{h}, Reporter: h}}, opt.ControllerLimits{MaxInputBytes: cortexOptimizationRequestBytes, MaxResponseBytes: 8192, MaxOutputTokens: cortexOptimizationOutput, MaxProposals: 1, MaxLessons: 2})
	if err != nil {
		return nil, err
	}
	handler, err := opt.NewControllerPhaseHandler(h.repository, controllers, trials, cortexOptimizationDomain)
	if err != nil {
		return nil, err
	}
	compatibility, err := opt.NewEngineCompatibility(opt.EngineCompatibilityConfig{Engine: h.runtime, Host: h, RuntimeVersion: cortexOptimizationRevision})
	if err != nil {
		return nil, err
	}
	controllerCompatibility, err := opt.NewControllerCompatibility(opt.ControllerCompatibilityConfig{Controllers: controllers, Host: h})
	if err != nil {
		return nil, err
	}
	artifactVerifier, err := opt.NewArtifactVerifier(h, 4<<20, time.Now)
	if err != nil {
		return nil, err
	}
	catalog, err := opt.NewApprovedCatalog(opt.ApprovedCatalogConfig{Choices: h.frozen.Choices, Authorize: h.authorizeChoice, Prepare: h.prepare})
	if err != nil {
		return nil, err
	}
	recovery, err := opt.NewUsageRecovery(h.repository, h, h, h)
	if err != nil {
		return nil, err
	}
	h.Optimizer, err = opt.NewOptimizer(opt.OptimizerConfig{Repository: h.repository, Authorizer: h, IdentityResolver: h, Caller: h, Handler: cortexOptimizationPhases{next: handler}, UsageRecovery: recovery, Worker: opt.DefaultWorkerConfig(), Catalog: catalog, CreationCatalog: catalog, Capabilities: h, Compatibility: compatibility, ControllerCompatibility: controllerCompatibility, ArtifactVerifier: artifactVerifier}, opt.WithActiveEngine(h.runtime))
	if err != nil {
		return nil, err
	}
	return h, nil
}
func (h *cortexDemoOptimizationHost) serviceContext(ctx context.Context) context.Context {
	return cortex.WithScope(context.WithValue(ctx, cortexOptimizationIdentityKey{}, cortexOptimizationIdentity{h, cortexOptimizationWorker}), h.verification.scope)
}
func (h *cortexDemoOptimizationHost) current(ctx context.Context) error {
	if h.stopped.Load() {
		return opt.ErrUnavailable
	}
	if cortex.ScopeFromContext(ctx).Canonical() != h.verification.scope.Canonical() {
		return opt.ErrPolicyDenied
	}
	return h.verification.currentAuthority(ctx)
}
func (h *cortexDemoOptimizationHost) Current(ctx context.Context) (opt.IdentityRef, error) {
	if err := h.current(ctx); err != nil {
		return opt.IdentityRef{}, err
	}
	if identity, ok := ctx.Value(cortexOptimizationIdentityKey{}).(cortexOptimizationIdentity); ok && identity.host == h && (identity.subject == cortexOptimizationWorker || identity.subject == cortexOptimizationOperator) {
		return opt.IdentityRef{Subject: identity.subject}, nil
	}
	subject, err := h.verification.authorizeUser(ctx, "read")
	if err != nil {
		return opt.IdentityRef{}, err
	}
	return opt.IdentityRef{Subject: subject}, nil
}
func (h *cortexDemoOptimizationHost) Resolve(ctx context.Context, identity opt.IdentityRef, scope cortex.Scope) (context.Context, error) {
	if err := h.current(ctx); err != nil {
		return nil, err
	}
	if scope.Canonical() != h.verification.scope.Canonical() || identity.Subject != cortexOptimizationOperator {
		return nil, opt.ErrPolicyDenied
	}
	if role := os.Getenv("DEMO_CORTEX_ROLE"); role != "" && role != "operator" {
		return nil, opt.ErrPolicyDenied
	}
	return context.WithValue(ctx, cortexOptimizationIdentityKey{}, cortexOptimizationIdentity{h, identity.Subject}), nil
}
func (h *cortexDemoOptimizationHost) Authorize(ctx context.Context, action opt.Action, resource opt.Resource) error {
	if err := h.current(ctx); err != nil {
		return err
	}
	if resource.Scope.Canonical() != h.verification.scope.Canonical() || (!resource.AgentID.IsNil() && resource.AgentID != h.frozen.AgentID) {
		return opt.ErrPolicyDenied
	}
	permission := ""
	switch action {
	case opt.ActionRead, opt.ActionReadArtifact:
		permission = "read"
	case opt.ActionRunActive:
		permission = "run"
	case opt.ActionActivate, opt.ActionRollback, opt.ActionDeactivate:
		permission = "approve"
	case opt.ActionCreate, opt.ActionStart, opt.ActionCancel, opt.ActionResume, opt.ActionRetain, opt.ActionResolveController, opt.ActionReconcileUsage:
		permission = "manage"
	default:
		return opt.ErrPolicyDenied
	}
	if identity, ok := ctx.Value(cortexOptimizationIdentityKey{}).(cortexOptimizationIdentity); ok && identity.host == h {
		if role := os.Getenv("DEMO_CORTEX_ROLE"); role != "" && role != "operator" {
			return opt.ErrPolicyDenied
		}
		if identity.subject == cortexOptimizationOperator {
			return nil
		}
		if identity.subject == cortexOptimizationWorker && (action == opt.ActionRead || action == opt.ActionStart || action == opt.ActionReadArtifact || action == opt.ActionReconcileUsage) {
			return nil
		}
		return opt.ErrPolicyDenied
	}
	subject, err := h.verification.authorizeUser(ctx, permission)
	if err != nil {
		return err
	}
	if permission != "read" && subject != cortexOptimizationOperator {
		return opt.ErrPolicyDenied
	}
	return nil
}
func (h *cortexDemoOptimizationHost) Map(ctx context.Context, scope cortex.Scope) (context.Context, error) {
	if err := h.current(ctx); err != nil {
		return nil, err
	}
	if scope.Canonical() != h.verification.scope.Canonical() {
		return nil, opt.ErrPolicyDenied
	}
	return sentinel.WithApp(sentinel.WithTenant(ctx, h.verification.scope.Levels[0].Value), "cortex-optimization"), nil
}
func (h *cortexDemoOptimizationHost) AuthorizeEvaluation(ctx context.Context, ref opt.ContentRef) error {
	if ref != h.frozen.Binding.Plan {
		return opt.ErrStaleVersion
	}
	return h.Authorize(ctx, opt.ActionRead, opt.Resource{Scope: h.verification.scope, AgentID: h.frozen.AgentID, Kind: "evaluation"})
}
func (h *cortexDemoOptimizationHost) Start(ctx context.Context) error {
	if h.stopped.Load() {
		return opt.ErrUnavailable
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.cancel != nil {
		return nil
	}
	if h.Optimizer == nil {
		return opt.ErrUnavailable
	}
	if err := h.current(h.serviceContext(ctx)); err != nil {
		return err
	}
	workerCtx, cancel := context.WithCancel(h.serviceContext(context.WithoutCancel(ctx)))
	h.cancel = cancel
	h.done = make(chan struct{})
	h.started.Store(true)
	go func() {
		defer close(h.done)
		defer h.started.Store(false)
		for {
			err := h.Optimizer.Work(workerCtx)
			if workerCtx.Err() != nil {
				return
			}
			h.workerFailed.Store(err != nil)
			timer := time.NewTimer(time.Second)
			select {
			case <-workerCtx.Done():
				timer.Stop()
				return
			case <-timer.C:
			}
		}
	}()
	return nil
}
func (h *cortexDemoOptimizationHost) Stop(ctx context.Context) error {
	h.stopped.Store(true)
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	if h.cancel != nil {
		h.cancel()
		select {
		case <-h.done:
		case <-ctx.Done():
			return ctx.Err()
		}
		h.cancel = nil
	}
	var result error
	if h.repository != nil {
		result = errors.Join(result, h.repository.Close())
	}
	if h.sentinel != nil {
		result = errors.Join(result, h.sentinel.Close())
	}
	if h.journal != nil {
		result = errors.Join(result, h.journal.close())
	}
	h.closed = true
	return result
}

type cortexOptimizationJournalReader struct{ host *cortexDemoOptimizationHost }

func (r cortexOptimizationJournalReader) Get(ctx context.Context, ref opt.ArtifactRef) (opt.Artifact, error) {
	return r.host.readArtifact(ctx, ref)
}
func (h *cortexDemoOptimizationHost) Get(ctx context.Context, ref opt.ArtifactRef) (opt.Artifact, error) {
	if err := h.Authorize(ctx, opt.ActionReadArtifact, opt.Resource{Scope: ref.Scope, ID: ref.ExperimentID, Kind: "artifact"}); err != nil {
		return opt.Artifact{}, err
	}
	reader, err := artifacts.NewRetainedReader(h.repository, cortexOptimizationJournalReader{h}, 4<<20, time.Now)
	if err != nil {
		return opt.Artifact{}, err
	}
	value, err := reader.Get(ctx, ref)
	if err != nil {
		return opt.Artifact{}, err
	}
	if currentErr := h.current(ctx); currentErr != nil {
		return opt.Artifact{}, currentErr
	}
	return value, nil
}
func (h *cortexDemoOptimizationHost) readArtifact(ctx context.Context, ref opt.ArtifactRef) (opt.Artifact, error) {
	if err := h.Authorize(ctx, opt.ActionReadArtifact, opt.Resource{Scope: ref.Scope, ID: ref.ExperimentID, Kind: "artifact"}); err != nil {
		return opt.Artifact{}, err
	}
	key, err := ref.BindingDigest()
	if err != nil {
		return opt.Artifact{}, err
	}
	if ref.Size > 1<<20 || ref.AccessPolicy != cortexOptimizationRevision || ref.Kind != "captured-output" {
		return opt.Artifact{}, opt.ErrPolicyDenied
	}
	var artifact opt.Artifact
	if operationErr := h.journal.read("artifact", key, &artifact); operationErr != nil {
		return opt.Artifact{}, operationErr
	}
	if artifact.Validate() != nil || !reflect.DeepEqual(artifact.Ref, ref) || !time.Now().Before(artifact.ExpiresAt) {
		return opt.Artifact{}, opt.ErrIncompleteEvidence
	}
	return artifact, h.Authorize(ctx, opt.ActionReadArtifact, opt.Resource{Scope: ref.Scope, ID: ref.ExperimentID, Kind: "artifact"})
}

var _ llm.Client = (*cortexOptimizationModel)(nil)
