package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/planning"
	"github.com/xraph/cortex/run"
	"github.com/xraph/cortex/verification"
)

const cortexPlanningCallTokens = cortexOptimizationContext + 4096

const cortexPlanningGrant = "local-warehouse-team/v2"
const cortexPlanningCoordinator = "local-team-coordinator"
const cortexPlanningProducer = "local-team-producer"
const cortexPlanningReviewer = "local-team-reviewer"

type cortexPlanningStore interface {
	cortexVerificationStore
	coordination.PlanningOperatorStore
	coordination.ReadyTaskClaimStore
	coordination.TaskRunStore
	coordination.TaskCompletionServiceStore
}
type cortexPlanningRoot struct {
	Version                     int                         `json:"version"`
	Authority                   cortexVerificationAuthority `json:"authority"`
	CreatedAt                   time.Time                   `json:"created_at"`
	Plan                        planning.Plan               `json:"plan"`
	Planner, Producer, Reviewer agent.Config
	ParentRunID                 id.AgentRunID `json:"parent_run_id"`
}
type cortexDemoPlanningHost struct {
	Operator            *coordination.PlanningOperator
	lifecycle           sync.Mutex
	active              atomic.Bool
	closed              bool
	verification        *cortexDemoVerificationHost
	storage             cortexPlanningStore
	directory           string
	root                cortexPlanningRoot
	producer, evaluator *engine.Engine
	worker              coordination.ClaimedTaskWorker
}

func configureCortexDemoPlanning(verified *cortexDemoVerificationHost, client llm.Client, databasePath string, safetyOptions []engine.Option) (*cortexDemoPlanningHost, error) {
	if !envBool("DEMO_CORTEX_PLANNING", false) {
		return nil, nil
	}
	if verified == nil || client == nil || databasePath == "" {
		return nil, errors.New("planning demo requires the verified local model host")
	}
	return configureCortexDemoPlanningWithModel(verified, newCortexPlanningModel(), databasePath, safetyOptions)
}

func newCortexPlanningModel() *cortexOptimizationModel {
	model := newCortexOptimizationModel()
	model.outputLimit = 4096
	model.format = cortexPlanningResponseFormat
	model.callTimeout = 5 * time.Minute
	model.client.Timeout = 5 * time.Minute
	model.client.Transport = &http.Transport{ResponseHeaderTimeout: 5 * time.Minute, DisableKeepAlives: true}
	return model
}
func configureCortexDemoPlanningWithModel(verified *cortexDemoVerificationHost, client llm.Client, databasePath string, safetyOptions []engine.Option) (*cortexDemoPlanningHost, error) {
	storage, ok := verified.storage.(cortexPlanningStore)
	if !ok {
		return nil, coordination.ErrPlanningUnavailable
	}
	directory := databasePath + ".team"
	// #nosec G703 -- directory comes from the trusted host database configuration and is validated below.
	if err := os.Mkdir(directory, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	if err := validateCortexVerificationDirectory(directory); err != nil {
		return nil, err
	}
	h := &cortexDemoPlanningHost{verification: verified, storage: storage, directory: directory}
	ctx := cortex.WithScope(context.Background(), verified.scope)
	root, err := cortexPlanningRecord(ctx, directory, "root", func() (cortexPlanningRoot, error) { return h.newRoot() })
	if err != nil {
		return nil, err
	}
	if root.Version != 2 || !reflect.DeepEqual(root.Authority, verified.authority) || planning.Validate(root.Plan, planning.Limits{}) != nil || root.Plan.Scope.Canonical() != verified.scope.Canonical() {
		return nil, evidence.ErrDenied
	}
	h.root = root
	for _, config := range []agent.Config{root.Planner, root.Producer, root.Reviewer} {
		existing, getErr := storage.Get(ctx, config.ID)
		switch {
		case errors.Is(getErr, cortex.ErrAgentNotFound):
			copyConfig := config
			if createErr := storage.Create(ctx, &copyConfig); createErr != nil {
				return nil, createErr
			}
		case getErr != nil:
			return nil, getErr
		case existing == nil || existing.Name != config.Name || existing.SystemPrompt != config.SystemPrompt || existing.Model != config.Model || !existing.Enabled:
			return nil, evidence.ErrDenied
		}
	}
	if _, err = storage.GetPlan(ctx, root.Plan.ID); errors.Is(err, planning.ErrNotFound) {
		err = storage.CreatePlan(ctx, root.Plan)
	}
	if err != nil {
		return nil, err
	}
	if policyErr := storage.CreateReservationPolicy(ctx, execution.ReservationPolicy{SchemaVersion: 1, PlanID: root.Plan.ID, Scope: root.Plan.Scope, Limits: execution.Resources{Steps: 12, Tokens: 4 * cortexPlanningCallTokens, ToolCalls: 3, FanOut: 8, Replans: 2}, Deadline: root.Plan.Budget.Deadline, TokenOnly: true}); policyErr != nil {
		return nil, policyErr
	}
	if _, err = storage.GetRun(ctx, root.ParentRunID); errors.Is(err, cortex.ErrRunNotFound) {
		err = storage.CreateRun(ctx, &run.Run{ID: root.ParentRunID, AgentID: root.Planner.ID, State: run.StateRunning})
	}
	if err != nil {
		return nil, err
	}
	base := make([]engine.Option, 0, 4+len(safetyOptions))
	base = append(base, engine.WithStore(storage), engine.WithLLM(client), engine.WithSuspensionTTL(0), engine.WithToolAuthorizer(cortexVerificationTools{verified}))
	base = append(base, safetyOptions...)
	h.evaluator, err = engine.New(base...)
	if err != nil {
		return nil, err
	}
	clone := *verified
	clone.repository, err = evidence.NewRepository(storage, h, 1<<20)
	if err != nil {
		return nil, err
	}
	h.verification = &clone
	runAdmission, err := coordination.NewTaskRunAdmitter(storage, h, h)
	if err != nil {
		return nil, err
	}
	producerOptions := append([]engine.Option{}, base...)
	producerOptions = append(producerOptions, engine.WithTaskRunAdmitter(runAdmission), engine.WithTaskCallGuard(h), engine.WithVerificationWorker(engine.VerificationWorkerConfig{Adapter: &clone, Authorizer: &clone, Fence: &clone, Clock: &clone}), engine.WithRequiredVerification(engine.RequiredVerificationConfig{Revision: clone.authority.PolicyRevision, ContractID: clone.contract.ID, EvaluationBudget: verification.EvaluationBudget{MaxCalls: 1, TokenOnly: true}, Builder: h, CaptureAuthorizer: h, HandoffAuthorizer: &clone, WorkerOwner: "local-team-verification", LeaseDuration: time.Minute}), engine.WithResultContent(engine.ResultContentConfig{Authorizer: &clone, Fence: &clone, Clock: &clone}))
	h.producer, err = engine.New(producerOptions...)
	if err != nil {
		return nil, err
	}
	dispatch, err := coordination.NewTaskDispatchAdmitter(storage, h, h)
	if err != nil {
		return nil, err
	}
	h.worker, err = h.producer.NewTaskWorker(engine.TaskWorkerConfig{Resolver: h, Dispatch: dispatch})
	if err != nil {
		return nil, err
	}
	claims, err := coordination.NewTaskClaimAdmitter(storage, h, h)
	if err != nil {
		return nil, err
	}
	reviewer, err := h.evaluator.NewTaskReviewRuntime(engine.TaskReviewRuntimeConfig{ExecutionTimeout: 5 * time.Minute, Resolver: h, Fence: h, Authorizer: h, EvidenceAuthorizer: h})
	if err != nil {
		return nil, err
	}
	acceptor, err := coordination.NewTaskAcceptor(storage, h, h)
	if err != nil {
		return nil, err
	}
	completion := coordination.TaskCompletionServiceConfig{Store: storage, Resolver: h, Authority: h, Reviewer: cortexPlanningReviewerRuntime{h, reviewer}, Acceptor: acceptor}
	runtime, err := h.evaluator.NewPlanReplanRuntime(h)
	if err != nil {
		return nil, err
	}
	replanner, err := coordination.NewPlanReplanner(storage, h, h, cortexPlanningProposalRuntime{h, runtime}, coordination.PlanReplannerConfig{ExecutionTimeout: 5 * time.Minute})
	if err != nil {
		return nil, err
	}
	h.Operator, err = coordination.NewPlanningOperator(coordination.PlanningOperatorConfig{Store: storage, Source: h, Authority: h, Clock: verified, Claims: h, Admitter: claims, Worker: h, Replans: h, Replanner: replanner, Completion: &completion})
	if err != nil {
		return nil, err
	}
	return h, nil
}
func (h *cortexDemoPlanningHost) newRoot() (cortexPlanningRoot, error) {
	now := time.Now().UTC().Truncate(time.Millisecond)
	makeAgent := func(name, instruction string) agent.Config {
		return agent.Config{ID: id.NewAgentID(), Name: name, SystemPrompt: instruction, Model: "demo-local", MaxSteps: 1, MaxTokens: 4096, Enabled: true, Scope: h.verification.scope}
	}
	root := cortexPlanningRoot{Version: 2, Authority: h.verification.authority, CreatedAt: now, ParentRunID: id.NewAgentRunID(), Planner: makeAgent("Warehouse planner", cortexPlanningPlannerRole+" Return the exact requested plan JSON. Preserve every identifier and authority bound. /no_think"), Producer: makeAgent("Warehouse producer", cortexPlanningProducerRole+" Calculate from the provided record. Return only the requested JSON object. /no_think"), Reviewer: makeAgent("Warehouse independent reviewer", cortexPlanningReviewerRole+" Review the supplied candidate against the source and criteria. Return only the required review JSON. Unsupported or contradictory claims must not be marked supported. /no_think")}
	deadline := now.Add(15 * time.Minute)
	taskBudget := execution.Budget{MaxSteps: 1, MaxTokens: cortexPlanningCallTokens, MaxToolCalls: 1, Deadline: deadline}
	body, err := json.Marshal(h.verification.authority.Record)
	if err != nil {
		return root, err
	}
	criteria := make([]string, 0, len(h.verification.contract.Criteria))
	for _, criterion := range h.verification.contract.Criteria {
		criteria = append(criteria, criterion.ID)
	}
	root.Plan, err = planning.Seal(planning.Plan{SchemaVersion: 2, ID: id.New(planning.PrefixPlan), Scope: h.verification.scope, Revision: 1, Objective: h.verification.contract.Objective, Contract: h.verification.contract, Budget: execution.Budget{MaxSteps: 12, MaxTokens: 4 * cortexPlanningCallTokens, MaxToolCalls: 3, Deadline: deadline}, Owners: []string{root.Producer.ID.String(), root.Reviewer.ID.String()}, Tasks: []planning.Task{{ID: id.New(planning.PrefixTask), Instruction: "Await the planner to prepare the warehouse arithmetic task", Owner: root.Producer.ID.String(), Criteria: criteria, Budget: taskBudget, Output: planning.ArtifactRequirement{Name: "warehouse record", MediaType: "text/plain", MaxBytes: 4096}, Resources: []planning.ResourceGrant{{Resource: "demo:warehouse-7", Revision: h.verification.authority.Record.Revision, Access: planning.AccessRead}}, Sources: []string{"demo:warehouse-7"}, Review: &planning.ReviewRequirement{ReviewerAgent: root.Reviewer.ID.String(), ReviewerPrincipal: cortexPlanningReviewer, PolicyRevision: cortexPlanningGrant}}}, Resources: []planning.ResourceGrant{{Resource: "demo:warehouse-7", Revision: h.verification.authority.Record.Revision, Access: planning.AccessRead}}, Sources: []verification.Source{{Resource: "demo:warehouse-7", Revision: h.verification.authority.Record.Revision, Digest: evidence.Digest(body), RetrievedAt: now}}, Actor: cortexPlanningCoordinator, Reason: "Create bounded warehouse team"}, planning.Limits{})
	return root, err
}
func (h *cortexDemoPlanningHost) Start(ctx context.Context) error {
	h.lifecycle.Lock()
	defer h.lifecycle.Unlock()
	if h.closed {
		return coordination.ErrPlanningUnavailable
	}
	if h.active.Load() {
		return nil
	}
	if err := h.verification.currentAuthority(cortex.WithScope(ctx, h.root.Plan.Scope)); err != nil {
		return err
	}
	if err := h.evaluator.Start(ctx); err != nil {
		return err
	}
	if err := h.producer.Start(ctx); err != nil {
		return errors.Join(err, h.evaluator.Stop(ctx))
	}
	h.active.Store(true)
	return nil
}
func (h *cortexDemoPlanningHost) Stop(ctx context.Context) error {
	h.lifecycle.Lock()
	h.closed = true
	h.active.Store(false)
	h.lifecycle.Unlock()
	// Every admitted model call holds the shared execution lock. An elapsed stop
	// deadline reports failure to drain; it never claims the provider terminated.
	unlock, err := lockCortexVerification(ctx, filepath.Join(h.directory, "execution.lock"), true)
	if err != nil {
		return err
	}
	return errors.Join(h.producer.Stop(ctx), h.evaluator.Stop(ctx), unlock())
}
func (h *cortexDemoPlanningHost) plan(ctx context.Context) (planning.Plan, error) {
	return h.storage.GetPlan(ctx, h.root.Plan.ID)
}
func (h *cortexDemoPlanningHost) fence(ctx context.Context, exclusive bool, next func() error) (resultErr error) {
	unlock, err := lockCortexVerification(ctx, h.verification.authorityFile+".lock", false)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	planUnlock, err := lockCortexVerification(ctx, filepath.Join(h.directory, "execution.lock"), exclusive)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, planUnlock()) }()
	if err := h.verification.currentAuthority(ctx); err != nil {
		return err
	}
	return next()
}
