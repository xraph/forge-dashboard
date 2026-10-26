package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"time"

	"github.com/xraph/sentinel"
	se "github.com/xraph/sentinel/engine"
	sid "github.com/xraph/sentinel/id"
	"github.com/xraph/sentinel/suite"
	"github.com/xraph/sentinel/testcase"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/prompt"
	sadapter "github.com/xraph/cortex/sentinel/optimization"
)

type cortexOptimizationCatalog struct {
	AuthorityDigest string
	AgentID         id.AgentID
	Baseline        opt.HarnessVersion
	Controller      opt.HarnessVersion
	Binding         sadapter.Binding
	Environment     opt.ContentRef
	Choices         []opt.CatalogChoice
}

func (h *cortexDemoOptimizationHost) loadCatalog(ctx context.Context, scoring *se.Engine) error {
	digest, _, err := cortexOptimizationDigest(h.verification.authority)
	if err != nil {
		return err
	}
	if err = h.journal.read("catalog", "fixed", &h.frozen); err == nil {
		if h.frozen.AuthorityDigest != digest || h.frozen.Baseline.RuntimeVersion != cortexOptimizationRevision {
			return opt.ErrStaleVersion
		}
		return nil
	} else if !errors.Is(err, opt.ErrNotFound) {
		return err
	}
	ag, err := h.runtime.GetAgentByName(ctx, "local-synthetic-record")
	if errors.Is(err, cortex.ErrAgentNotFound) {
		ag = &agent.Config{ID: id.NewAgentID(), Entity: cortex.NewEntity(), Name: "local-synthetic-record", Description: "Synthetic record benchmark, no production quality claim", Model: "demo-local", Enabled: true, MaxSteps: 1, MaxTokens: cortexOptimizationOutput, ReasoningLoop: "react", Sections: []prompt.Section{{ID: "record-guidance", Body: "Return only the requested JSON object. Use the supplied record facts and do not add fields.", Order: 1000, Source: "host"}, {ID: "record-output-contract", Body: "Return the JSON object directly without reasoning or commentary. /no_think", Order: 1100, Source: "host", Locked: true}}}
		if operationErr := h.runtime.CreateAgent(ctx, ag); operationErr != nil {
			return operationErr
		}
	} else if err != nil {
		return err
	}
	budget := cortexOptimizationExecutionBudget()
	prepared, err := h.runtime.PrepareAgent(ctx, ag.ID, &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, Budget: &budget})
	if err != nil {
		return err
	}
	view, err := prepared.Inspect()
	if err != nil || len(view.Tools) != 0 || view.Config.MaxSteps != 1 || view.Config.MaxTokens != cortexOptimizationOutput || !view.Config.Budget.Equal(cortexOptimizationExecutionBudget()) || view.Config.Model != "demo-local" || view.Config.Verification != nil || view.Config.PersonaRef != "" {
		return opt.ErrStaleVersion
	}
	policy := opt.EditPolicy{MutableSections: []string{"record-guidance"}, MaxBodyBytes: 512, MaxPatchBytes: 1024, MaxEdits: 1}
	base, err := opt.SealVersion(opt.HarnessVersion{ID: id.New(opt.PrefixVersion), HarnessID: id.New(opt.PrefixHarness), SchemaVersion: 1, Kind: opt.HarnessExecution, Scope: h.verification.scope, AgentID: ag.ID, Prepared: prepared, RuntimeVersion: cortexOptimizationRevision, Policy: policy, CreatedAt: time.Now().UTC(), CreatedBy: cortexOptimizationWorker})
	if err != nil {
		return err
	}
	controller, err := opt.SealVersion(opt.HarnessVersion{ID: id.New(opt.PrefixVersion), HarnessID: id.New(opt.PrefixHarness), SchemaVersion: 1, Kind: opt.HarnessImprovement, RuntimeVersion: cortexOptimizationRevision, Scope: h.verification.scope, AgentID: ag.ID, Controller: &opt.ControllerSpec{Tools: []string{}, Model: "demo-local", ModelRevision: cortexOptimizationModelRevision, Sections: []prompt.Section{{ID: "controller-role", Body: "Improve the record-guidance section using discovery outcomes. Propose at most one short edit. Never invent evidence or expose evaluation answers. Return the requested JSON only. Return one proposal with an empty edits array when no change is warranted. For reflection, copy the supplied domain exactly. Empty lessons are valid when no supported lesson is warranted. /no_think", Order: 1000, Source: "host", Locked: true}}}, Policy: policy, CreatedAt: time.Now().UTC(), CreatedBy: cortexOptimizationWorker})
	if err != nil {
		return err
	}
	environmentDigest, _, err := cortexOptimizationDigest(struct {
		Authority       string
		Revision        string
		Context, Output int
	}{digest, cortexOptimizationRevision, cortexOptimizationContext, cortexOptimizationOutput})
	if err != nil {
		return err
	}
	environment := opt.ContentRef{Ref: "local-record-environment", Revision: cortexOptimizationRevision, Digest: environmentDigest}
	mapped := sentinel.WithApp(sentinel.WithTenant(ctx, h.verification.scope.Levels[0].Value), "cortex-optimization")
	su := &suite.Suite{ID: sid.NewSuiteID(), AppID: "cortex-optimization", Name: "Synthetic record benchmark v1"}
	if operationErr := h.sentinel.CreateSuite(mapped, su); operationErr != nil {
		return operationErr
	}
	binding := sadapter.Binding{Scope: h.verification.scope, AppID: "cortex-optimization", TenantID: h.verification.scope.Levels[0].Value}
	for index := range 22 {
		split := opt.SplitValidation
		if index < 2 {
			split = opt.SplitDiscovery
		}
		a, b := 3+index*2, 7+index*3
		record := cortexVerificationRecord{Record: fmt.Sprintf("synthetic-bin-%02d", index), Units: a + b, Status: "reviewed", Revision: cortexOptimizationCorpusRevision}
		input := fmt.Sprintf("Synthetic benchmark record %s has bins with %d and %d units. Add them for units. Status is reviewed; revision is %s. Return JSON with exactly these fields in this order: record, units, status, revision. No markdown.", record.Record, a, b, record.Revision)
		task, taskErr := opt.SealTaskCase(opt.TaskCase{ID: fmt.Sprintf("synthetic-record-%02d", index), Input: input, Split: split, EnvironmentSnapshot: environment})
		if taskErr != nil {
			return taskErr
		}
		expected, encodeErr := json.Marshal(record)
		if encodeErr != nil {
			return encodeErr
		}
		tc := &testcase.Case{ID: sid.NewCaseID(), SuiteID: su.ID, Name: task.ID, Input: input, Expected: string(expected), Scorers: []testcase.ScorerConfig{{Name: "regex", Config: map[string]any{"pattern": fmt.Sprintf(`^\s*\{\s*"record"\s*:\s*%q\s*,\s*"units"\s*:\s*%d\s*,\s*"status"\s*:\s*"reviewed"\s*,\s*"revision"\s*:\s*%q\s*\}\s*$`, regexp.QuoteMeta(record.Record), record.Units, regexp.QuoteMeta(record.Revision))}}}}
		if operationErr := h.sentinel.CreateCase(mapped, tc); operationErr != nil {
			return operationErr
		}
		binding.Cases = append(binding.Cases, sadapter.CaseBinding{Task: task, CaseID: tc.ID})
	}
	plan, err := scoring.FreezeEvaluation(mapped, se.FreezeRequest{SuiteID: su.ID})
	if err != nil {
		return err
	}
	binding.Plan = opt.ContentRef{Ref: plan.ID.String(), Revision: "1", Digest: plan.Digest}
	choices := []opt.CatalogChoice{
		{Scope: h.verification.scope, Kind: opt.CatalogAgent, Ref: opt.ContentRef{Ref: ag.ID.String(), Revision: cortexOptimizationRevision, Digest: prepared.Digest()}, Name: "Synthetic record agent", Description: "Tool-less bounded local Ollama record benchmark"},
		{Scope: h.verification.scope, Kind: opt.CatalogController, Ref: opt.ContentRef{Ref: controller.ID.String(), Revision: "1", Digest: controller.Digest}, Name: "Local record controller"},
		{Scope: h.verification.scope, Kind: opt.CatalogEvaluation, Ref: binding.Plan, Name: "Synthetic record benchmark", Description: "Two discovery and twenty distinct synthetic held-out records; no production quality qualification"},
		{Scope: h.verification.scope, Kind: opt.CatalogEnvironment, Ref: environment, Name: "Bounded local Ollama", Description: "One tool-less call, fixed context/output limits, durable capture and no replay"},
	}
	h.frozen = cortexOptimizationCatalog{digest, ag.ID, base, controller, binding, environment, choices}
	_, err = h.journal.put("catalog", "fixed", h.frozen)
	return err
}
func (h *cortexDemoOptimizationHost) authorizeChoice(ctx context.Context, choice opt.CatalogChoice) error {
	if err := h.Authorize(ctx, opt.ActionRead, opt.Resource{Scope: choice.Scope, AgentID: h.frozen.AgentID, Kind: "catalog"}); err != nil {
		return err
	}
	if choice.Kind == opt.CatalogEvaluation {
		return h.access.Authorize(ctx, choice)
	}
	if err := h.model.check(ctx); err != nil {
		return err
	}
	_, err := h.runtime.CheckPreparedSources(ctx, h.frozen.Baseline.Prepared)
	return err
}
func cortexOptimizationLimits() opt.Limits {
	return opt.Limits{MaxRounds: 1, MaxCandidates: 1, MaxTrials: 44, Concurrency: 1, ExperimentTimeout: 15 * time.Minute, TrialTimeout: 90 * time.Second, MaxSteps: 1, MaxOutputTokens: cortexOptimizationOutput, Repetitions: 1}
}
func (h *cortexDemoOptimizationHost) prepare(ctx context.Context, target opt.CreationTarget) (opt.ExperimentBundle, error) {
	if err := h.Authorize(ctx, opt.ActionCreate, opt.Resource{Scope: target.Scope, AgentID: h.frozen.AgentID, Kind: "experiment"}); err != nil {
		return opt.ExperimentBundle{}, err
	}
	limits := cortexOptimizationLimits()
	budget := opt.Budget{MaxTokens: 50 * (cortexOptimizationContext + cortexOptimizationOutput), TokenOnly: true}
	objective := opt.DefaultObjective()
	objective.RequiredCriteria = []string{"case:regex:0"}
	objective.ProtectedCriteria = []string{"case:regex:0"}
	objective.BootstrapSeed = 42
	if target.Selection.Mode != "" && target.Selection.Mode != opt.ModeSequential {
		return opt.ExperimentBundle{}, opt.ErrInvalidSpec
	}
	if target.Selection.Limits != nil && !reflect.DeepEqual(*target.Selection.Limits, limits) || target.Selection.Budget != nil && !reflect.DeepEqual(*target.Selection.Budget, budget) || target.Selection.Objective != nil && !reflect.DeepEqual(*target.Selection.Objective, objective) {
		return opt.ExperimentBundle{}, opt.ErrPolicyDenied
	}
	tasks := make([]opt.TaskCase, 0, len(h.frozen.Binding.Cases))
	for _, binding := range h.frozen.Binding.Cases {
		tasks = append(tasks, binding.Task)
	}
	plan, err := h.access.Freeze(ctx, opt.EvaluationSpec{Source: h.frozen.Binding.Plan, Tasks: tasks, RequiredCriteria: []string{"case:regex:0"}})
	if err != nil {
		return opt.ExperimentBundle{}, err
	}
	spec := opt.ExperimentSpec{SchemaVersion: 1, Scope: target.Scope, AgentID: h.frozen.AgentID, Baseline: opt.VersionRef{ID: h.frozen.Baseline.ID, Digest: h.frozen.Baseline.Digest}, Controller: opt.VersionRef{ID: h.frozen.Controller.ID, Digest: h.frozen.Controller.Digest}, Mode: opt.ModeSequential, Tasks: tasks, Evaluation: plan.Ref, Limits: limits, Budget: budget, Objective: objective, Requester: target.Actor, LessonCutoff: time.Now().UTC()}
	return opt.ExperimentBundle{Experiment: opt.Experiment{ID: target.ExperimentID, Spec: spec, EvaluationPlan: plan}, Versions: []opt.HarnessVersion{h.frozen.Baseline, h.frozen.Controller}}, nil
}
func (h *cortexDemoOptimizationHost) Check(ctx context.Context, version opt.HarnessVersion) (opt.CompatibilityReport, error) {
	if err := h.current(ctx); err != nil {
		return opt.CompatibilityReport{}, err
	}
	if version.Scope.Canonical() != h.verification.scope.Canonical() || version.AgentID != h.frozen.AgentID || version.PolicyDigest != h.frozen.Baseline.PolicyDigest {
		return opt.CompatibilityReport{}, opt.ErrStaleVersion
	}
	if version.Kind == opt.HarnessExecution && version.HarnessID != h.frozen.Baseline.HarnessID || version.Kind == opt.HarnessImprovement && version.HarnessID != h.frozen.Controller.HarnessID {
		return opt.CompatibilityReport{}, opt.ErrStaleVersion
	}
	if err := h.model.check(ctx); err != nil {
		return opt.CompatibilityReport{}, err
	}
	return opt.CompatibilityReport{Version: opt.VersionRef{ID: version.ID, Digest: version.Digest}, PolicyDigest: version.PolicyDigest, Compatible: true}, nil
}
func (h *cortexDemoOptimizationHost) Inspect(ctx context.Context, target opt.CapabilityTarget) (opt.HostCapabilities, error) {
	result := opt.HostCapabilities{Target: target, Checks: map[opt.Capability]opt.ReadinessState{}, PricingQuality: opt.UsageUnknown}
	for _, name := range opt.CapabilityNames() {
		result.Checks[name] = opt.ReadinessUnavailable
	}
	if err := h.Authorize(ctx, opt.ActionRead, opt.Resource{Scope: target.Scope, AgentID: target.AgentID, ID: target.ExperimentID, Kind: "capabilities"}); err != nil {
		return result, err
	}
	if !target.AgentID.IsNil() && target.AgentID != h.frozen.AgentID {
		return result, opt.ErrPolicyDenied
	}
	if err := h.repository.Ping(ctx); err != nil {
		return result, err
	}
	result.Checks[opt.CapabilityStorage] = opt.ReadinessReady
	result.Checks[opt.CapabilityDurableStorage] = opt.ReadinessReady
	result.Checks[opt.CapabilityScopeMapping] = opt.ReadinessReady
	if h.started.Load() && !h.workerFailed.Load() {
		result.Checks[opt.CapabilityWorker] = opt.ReadinessReady
	}
	if err := h.model.check(ctx); err != nil {
		result.Checks[opt.CapabilityAccounting] = opt.ReadinessUnknown
		result.Checks[opt.CapabilityEnvironment] = opt.ReadinessUnknown
		return result, h.current(ctx)
	}
	if err := h.journal.check(); err != nil {
		return result, err
	}
	if _, err := h.runtime.CheckPreparedSources(ctx, h.frozen.Baseline.Prepared); err != nil {
		return result, err
	}
	if !target.ExperimentID.IsNil() {
		experiment, err := h.repository.GetExperiment(ctx, target.ExperimentID)
		if err != nil {
			return result, err
		}
		if target.AgentID != experiment.Spec.AgentID || target.Mode != experiment.Spec.Mode || target.Baseline != experiment.Spec.Baseline || target.Controller != experiment.Spec.Controller || target.Evaluation != experiment.Spec.Evaluation {
			return result, opt.ErrConflict
		}
	}
	if err := h.access.Authorize(ctx, h.frozen.Choices[2]); err != nil {
		return result, err
	}
	for _, name := range []opt.Capability{opt.CapabilityController, opt.CapabilityEnvironment, opt.CapabilityEvaluation, opt.CapabilityAccounting, opt.CapabilityProductionRouting, opt.CapabilityControllerRouting} {
		result.Checks[name] = opt.ReadinessReady
	}
	result.Environment = cortexOptimizationIsolation()
	return result, h.current(ctx)
}

func cortexOptimizationExecutionBudget() execution.Budget {
	return execution.Budget{MaxSteps: 1, MaxTokens: cortexOptimizationContext + cortexOptimizationOutput}
}
