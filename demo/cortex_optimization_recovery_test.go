package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/run"
)

func TestCortexOptimizationLostAcknowledgmentSurvivesRestart(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "lost-ack"})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err = h.Optimizer.Start(ctx, experiment.ID, experiment.Revision)
	if err != nil {
		t.Fatal(err)
	}
	// The server completes, but no trusted completion is acknowledged to the caller.
	h.model.record = func(context.Context, *llm.Request, *llm.Response) error { return opt.ErrUnknownAttempt }
	for range 12 {
		err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID)
		if *calls > 0 {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	if !errors.Is(err, opt.ErrUnknownAttempt) || *calls != 1 {
		t.Fatalf("unknown completion: calls=%d err=%v", *calls, err)
	}
	trials, err := h.repository.ListTrials(ctx, experiment.ID, opt.TrialQuery{PageQuery: opt.PageQuery{Limit: 100}})
	if err != nil {
		t.Fatal(err)
	}
	var attempt opt.Attempt
	var trialID id.ID
	for _, trial := range trials.Items {
		for _, candidate := range trial.Attempts {
			if candidate.Receipt != nil {
				attempt = candidate
				trialID = trial.ID
			}
		}
	}
	if attempt.Receipt == nil {
		t.Fatal("missing retained environment intent")
	}
	key := "trial/" + trialID.String() + "/" + attempt.ID.String()
	reservation, err := h.repository.GetReservation(ctx, experiment.ID, key)
	if err != nil || reservation.DebitedTokens != cortexOptimizationContext+cortexOptimizationOutput {
		t.Fatalf("uncertain usage released debit: %+v %v", reservation, err)
	}
	path := strings.TrimSuffix(h.journal.directory, ".optimization")
	model := h.model
	if err = h.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	restarted, err := newCortexDemoOptimization(h.verification, path, model)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Stop(context.Background())
	environment, err := restarted.environment.Recover(ctx, *attempt.Receipt)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = environment.Inspect(ctx, attempt.ID); !errors.Is(err, opt.ErrUnknownAttempt) {
		t.Fatalf("missing result became complete: %v", err)
	}
	native, ok := environment.(*cortexOptimizationEnvironment)
	if !ok {
		t.Fatal("unexpected installed environment")
	}
	budget := cortexOptimizationExecutionBudget()
	prepared, err := restarted.trialRuntime.PrepareAgent(ctx, restarted.frozen.AgentID, &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, Budget: &budget})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = native.Execute(ctx, prepared, native.request.Task.Input, engine.PreparedRunOptions{Purpose: run.PurposeOptimizationTrial, SessionID: id.NewSessionID()}); err == nil {
		t.Fatal("unknown quarantined attempt executed")
	}
	if *calls != 1 {
		t.Fatal("restart redispatched unknown call")
	}
}

func cortexOptimizationCapturedTrial(ctx context.Context, t *testing.T, h *cortexDemoOptimizationHost) (opt.Experiment, opt.Trial) {
	t.Helper()
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "captured-trial"})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err = h.Optimizer.Start(ctx, experiment.ID, experiment.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for range 12 {
		if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
			t.Fatal(err)
		}
		trials, readErr := h.repository.ListTrials(ctx, experiment.ID, opt.TrialQuery{PageQuery: opt.PageQuery{Limit: 100}})
		if readErr != nil {
			t.Fatal(readErr)
		}
		for _, trial := range trials.Items {
			if trial.Execution != nil {
				return experiment, trial
			}
		}
	}
	t.Fatal("no captured trial")
	return opt.Experiment{}, opt.Trial{}
}
func TestCortexOptimizationCapturedResultRestartAndDeletion(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	experiment, trial := cortexOptimizationCapturedTrial(ctx, t, h)
	before := *calls
	path := strings.TrimSuffix(h.journal.directory, ".optimization")
	if err := h.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	restarted, err := newCortexDemoOptimization(h.verification, path, h.model)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Stop(context.Background())
	attempt := trial.Attempts[len(trial.Attempts)-1]
	environment, err := restarted.environment.Recover(ctx, *attempt.Receipt)
	if err != nil {
		t.Fatal(err)
	}
	status, err := environment.Inspect(ctx, attempt.ID)
	if err != nil || status.Execution.Digest != trial.Execution.Digest {
		t.Fatal("capture restart", err)
	}
	ref := status.Execution.Artifacts[0]
	if _, err = restarted.Get(ctx, ref); err != nil {
		t.Fatal(err)
	}
	if err = restarted.repository.Transact(ctx, func(tx opt.Transaction) error {
		return tx.BeginArtifactDeletion(opt.ArtifactDeletion{Ref: ref, RequestID: "withdraw-evidence", Actor: experiment.Spec.Requester, Reason: "Test current evidence eligibility"})
	}); err != nil {
		t.Fatal(err)
	}
	value, err := restarted.Get(ctx, ref)
	if !errors.Is(err, opt.ErrIncompleteEvidence) || len(value.Data) != 0 {
		t.Fatalf("withdrawn content returned: %v", err)
	}
	if _, err = environment.Inspect(ctx, attempt.ID); !errors.Is(err, opt.ErrIncompleteEvidence) {
		t.Fatalf("withdrawn result recovered: %v", err)
	}
	if *calls != before {
		t.Fatal("recovery or deletion replayed inference")
	}
}
func TestCortexOptimizationStopRacesCurrentReads(t *testing.T) {
	h, ctx, _ := cortexOptimizationFixture(t)
	experiment, trial := cortexOptimizationCapturedTrial(ctx, t, h)
	ref := trial.Execution.Artifacts[0]
	target := opt.CapabilityTarget{Scope: experiment.Spec.Scope, ExperimentID: experiment.ID, AgentID: experiment.Spec.AgentID, Mode: experiment.Spec.Mode, Baseline: experiment.Spec.Baseline, Controller: experiment.Spec.Controller, Evaluation: experiment.Spec.Evaluation}
	entered, release := make(chan struct{}), make(chan struct{})
	h.model.check = func(context.Context) error { close(entered); <-release; return nil }
	inspected := make(chan error, 1)
	go func() { _, err := h.Inspect(ctx, target); inspected <- err }()
	<-entered
	reads := make(chan struct{})
	go func() {
		defer close(reads)
		for range 20 {
			_, _ = h.Get(ctx, ref)
		}
	}()
	if err := h.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	close(release)
	if err := <-inspected; !errors.Is(err, opt.ErrUnavailable) {
		t.Fatalf("stopped probe returned readiness: %v", err)
	}
	<-reads
	if _, err := h.Inspect(ctx, target); !errors.Is(err, opt.ErrUnavailable) {
		t.Fatalf("post-stop probe: %v", err)
	}
	if _, err := h.Get(ctx, ref); !errors.Is(err, opt.ErrUnavailable) {
		t.Fatalf("post-stop artifact: %v", err)
	}
	if err := h.Start(ctx); !errors.Is(err, opt.ErrUnavailable) {
		t.Fatalf("closed host restarted: %v", err)
	}
}
