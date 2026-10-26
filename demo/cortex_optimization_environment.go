package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"reflect"
	"sync"
	"sync/atomic"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/run"
)

type cortexOptimizationCallKey struct{}
type cortexOptimizationCall struct{ used atomic.Bool }
type cortexOptimizationTrialModel struct{ provider llm.Client }

func (m cortexOptimizationTrialModel) Complete(ctx context.Context, r *llm.Request) (*llm.Response, error) {
	call, ok := ctx.Value(cortexOptimizationCallKey{}).(*cortexOptimizationCall)
	if !ok || call == nil || !call.used.CompareAndSwap(false, true) {
		return nil, opt.ErrPolicyDenied
	}
	return m.provider.Complete(ctx, r)
}
func (cortexOptimizationTrialModel) CompleteStream(context.Context, *llm.Request) (llm.Stream, error) {
	return nil, opt.ErrUnavailable
}

type cortexOptimizationEnvironments struct {
	gate       sync.Mutex
	journal    *cortexOptimizationJournal
	repository opt.Repository
	artifacts  opt.ArtifactReader
	runtime    *engine.Engine
	authorize  func(context.Context) error
	scope      cortex.Scope
	agentID    id.AgentID
	snapshot   opt.ContentRef
}
type cortexOptimizationEnvironment struct {
	factory *cortexOptimizationEnvironments
	request opt.TrialRequest
	receipt opt.EnvironmentReceipt
}
type cortexOptimizationProvision struct {
	Request opt.TrialRequest
	Receipt opt.EnvironmentReceipt
}

func cortexOptimizationIsolation() opt.IsolationCapabilities {
	return opt.IsolationCapabilities{Isolated: true, ReadOnly: true, Resettable: true, Recoverable: true, Stoppable: true, FrozenRetrieval: true, AtomicSources: true, DeterministicApproval: true}
}
func (f *cortexOptimizationEnvironments) check(ctx context.Context) error {
	if f.authorize == nil || f.runtime == nil || f.journal == nil || cortex.ScopeFromContext(ctx).Canonical() != f.scope.Canonical() {
		return opt.ErrPolicyDenied
	}
	return f.authorize(ctx)
}
func (f *cortexOptimizationEnvironments) Open(ctx context.Context, r opt.TrialRequest) (opt.TrialEnvironment, error) {
	if err := f.check(ctx); err != nil {
		return nil, err
	}
	if r.Scope.Canonical() != f.scope.Canonical() || r.Task.EnvironmentSnapshot != f.snapshot || r.Allowance.MaxTokens != cortexOptimizationContext+cortexOptimizationOutput || r.Allowance.MaxUSDMicros != 0 || r.Allowance.PricingRevision != "" || r.Limits.Concurrency != 1 || r.Limits.MaxSteps != 1 || r.Limits.MaxOutputTokens > cortexOptimizationOutput || !time.Now().Before(r.Deadline) {
		return nil, opt.ErrInvalidSpec
	}
	receipt := opt.EnvironmentReceipt{ID: r.AttemptID.String(), Provider: "local-record-ollama-v1", EnvironmentID: r.AttemptID.String(), Scope: r.Scope, AttemptID: r.AttemptID, Snapshot: r.Task.EnvironmentSnapshot, Capabilities: cortexOptimizationIsolation(), Fence: r.Fence, CreatedAt: time.Now().UTC()}
	if err := receipt.Validate(); err != nil {
		return nil, err
	}
	var prior cortexOptimizationProvision
	err := f.journal.read("environment", r.AttemptID.String(), &prior)
	if err == nil {
		if !reflect.DeepEqual(prior.Request, r) {
			return nil, opt.ErrConflict
		}
		receipt = prior.Receipt
	} else if !errors.Is(err, opt.ErrNotFound) {
		return nil, err
	} else if _, err = f.journal.put("environment", r.AttemptID.String(), cortexOptimizationProvision{r, receipt}); err != nil {
		return nil, err
	}
	if operationErr := f.check(ctx); operationErr != nil {
		return nil, operationErr
	}
	return &cortexOptimizationEnvironment{f, r, receipt}, nil
}
func (f *cortexOptimizationEnvironments) Recover(ctx context.Context, r opt.EnvironmentReceipt) (opt.TrialEnvironment, error) {
	if err := f.check(ctx); err != nil {
		return nil, err
	}
	var prior cortexOptimizationProvision
	if err := f.journal.read("environment", r.AttemptID.String(), &prior); err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(prior.Receipt, r) || prior.Request.Scope.Canonical() != f.scope.Canonical() || prior.Request.Task.EnvironmentSnapshot != f.snapshot {
		return nil, opt.ErrConflict
	}
	if err := f.check(ctx); err != nil {
		return nil, err
	}
	return &cortexOptimizationEnvironment{f, prior.Request, prior.Receipt}, nil
}
func (f *cortexOptimizationEnvironments) Stop(ctx context.Context, r opt.EnvironmentReceipt, fence opt.Fence) (opt.StopReceipt, error) {
	if err := f.lock(ctx); err != nil {
		return opt.StopReceipt{}, err
	}
	defer f.gate.Unlock()
	if _, err := f.Recover(ctx, r); err != nil {
		return opt.StopReceipt{}, err
	}
	if fence.Owner == "" || fence.Generation < r.Fence.Generation {
		return opt.StopReceipt{}, opt.ErrConflict
	}
	// This fence quarantines future dispatch. It does not claim Ollama stopped a
	// remote calculation. The one bounded call has no tools or external effects.
	marker := struct {
		Attempt id.ID
		Scope   string
	}{r.AttemptID, f.scope.Canonical()}
	if _, err := f.journal.put("quarantine", r.AttemptID.String(), marker); err != nil {
		return opt.StopReceipt{}, err
	}
	digest, _, err := cortexOptimizationDigest(marker)
	if err != nil {
		return opt.StopReceipt{}, err
	}
	return opt.StopReceipt{EnvironmentReceiptID: r.ID, AttemptID: r.AttemptID, Fence: fence, State: opt.StopQuarantined, Evidence: opt.ContentRef{Ref: "local-quarantine/" + r.AttemptID.String(), Revision: "1", Digest: digest}, ObservedAt: time.Now().UTC()}, f.check(ctx)
}
func (e *cortexOptimizationEnvironment) Receipt() opt.EnvironmentReceipt { return e.receipt }
func (*cortexOptimizationEnvironment) Close(context.Context) error       { return nil }
func (e *cortexOptimizationEnvironment) Inspect(ctx context.Context, attempt id.ID) (opt.AttemptStatus, error) {
	if attempt != e.receipt.AttemptID {
		return opt.AttemptStatus{}, opt.ErrConflict
	}
	if err := e.factory.check(ctx); err != nil {
		return opt.AttemptStatus{}, err
	}
	var record opt.ExecutionRecord
	if err := e.factory.journal.read("result", attempt.String(), &record); err != nil {
		return opt.AttemptStatus{}, errors.Join(opt.ErrUnknownAttempt, err)
	}
	sealed, err := opt.SealExecution(record)
	if err != nil || sealed.Digest != record.Digest || !reflect.DeepEqual(record.Environment, e.receipt) || record.InputDigest != e.request.Task.InputDigest {
		return opt.AttemptStatus{}, opt.ErrIncompleteEvidence
	}
	if e.factory.artifacts == nil {
		return opt.AttemptStatus{}, opt.ErrUnavailable
	}
	for _, ref := range record.Artifacts {
		if _, readErr := e.factory.artifacts.Get(ctx, ref); readErr != nil {
			return opt.AttemptStatus{}, readErr
		}
	}

	if operationErr := e.factory.check(ctx); operationErr != nil {
		return opt.AttemptStatus{}, operationErr
	}
	return opt.AttemptStatus{AttemptID: attempt, State: cortexOptimizationTrialState(record.State), Execution: &record, ObservedAt: time.Now().UTC()}, nil
}
func (e *cortexOptimizationEnvironment) Execute(ctx context.Context, p *engine.PreparedAgent, input string, options engine.PreparedRunOptions) (*opt.ExecutionRecord, error) {
	f := e.factory
	if err := f.lock(ctx); err != nil {
		return nil, err
	}
	defer f.gate.Unlock()
	if err := f.check(ctx); err != nil {
		return nil, err
	}
	view, err := p.Inspect()
	if err != nil {
		return nil, err
	}
	if view.AgentID != f.agentID || view.Scope.Canonical() != f.scope.Canonical() || view.Config.Model != "demo-local" || view.Config.MaxSteps != 1 || view.Config.MaxTokens < 1 || view.Config.MaxTokens > cortexOptimizationOutput || !view.Config.Budget.Equal(cortexOptimizationExecutionBudget()) || len(view.Tools) != 0 || len(view.Config.Tools) != 0 || view.Config.Verification != nil || view.Config.PersonaRef != "" || len(view.Provenance.RecalledLessons) != 0 || view.Provenance.UnattributedHistory || input != e.request.Task.Input || options.Purpose != run.PurposeOptimizationTrial || options.SessionID.IsNil() {
		return nil, opt.ErrPolicyDenied
	}
	var quarantine struct {
		Attempt id.ID
		Scope   string
	}
	if err = f.journal.read("quarantine", e.receipt.AttemptID.String(), &quarantine); err == nil {
		return nil, opt.ErrUnknownAttempt
	} else if !errors.Is(err, opt.ErrNotFound) {
		return nil, err
	}
	dispatch := struct {
		Prepared string
		Input    string
		Options  engine.PreparedRunOptions
	}{p.Digest(), e.request.Task.InputDigest, options}
	first, err := f.journal.put("dispatch", e.receipt.AttemptID.String(), dispatch)
	if err != nil {
		return nil, err
	}
	if !first {
		status, inspectErr := e.Inspect(ctx, e.receipt.AttemptID)
		return status.Execution, inspectErr
	}
	if operationErr := f.check(ctx); operationErr != nil {
		return nil, operationErr
	}
	callCtx, cancel := context.WithDeadline(ctx, e.request.Deadline)
	defer cancel()
	callCtx = context.WithValue(callCtx, cortexOptimizationCallKey{}, &cortexOptimizationCall{})
	captured, err := f.runtime.RunPrepared(callCtx, p, input, options)
	if err != nil || captured == nil || captured.StartedAt == nil || captured.CompletedAt == nil || (captured.State != run.StateCompleted && captured.State != run.StateIncomplete) {
		return nil, errors.Join(opt.ErrUnknownAttempt, err)
	}
	if operationErr := f.check(ctx); operationErr != nil {
		return nil, operationErr
	}
	artifactBody := []byte(captured.Output)
	sum := sha256.Sum256(artifactBody)
	artifact := opt.Artifact{Ref: opt.ArtifactRef{ExperimentID: e.request.ExperimentID, Scope: f.scope, Digest: hex.EncodeToString(sum[:]), MediaType: "text/plain", Size: int64(len(artifactBody)), AccessPolicy: cortexOptimizationRevision, Kind: "captured-output"}, Data: artifactBody, CreatedAt: *captured.CompletedAt, ExpiresAt: captured.CompletedAt.Add(24 * time.Hour)}
	if operationErr := artifact.Validate(); operationErr != nil {
		return nil, operationErr
	}
	artifactKey, err := artifact.Ref.BindingDigest()
	if err != nil {
		return nil, err
	}
	var existing opt.Artifact
	if readErr := f.journal.read("artifact", artifactKey, &existing); readErr == nil {
		if !reflect.DeepEqual(existing.Ref, artifact.Ref) {
			return nil, opt.ErrConflict
		}
		artifact = existing
	} else if !errors.Is(readErr, opt.ErrNotFound) {
		return nil, readErr
	} else if _, err = f.journal.put("artifact", artifactKey, artifact); err != nil {
		return nil, err
	}
	experiment, err := f.repository.GetExperiment(ctx, e.request.ExperimentID)
	if err != nil {
		return nil, err
	}
	if operationErr := f.repository.Transact(ctx, func(tx opt.Transaction) error {
		return tx.RegisterArtifact(opt.ArtifactRegistration{Ref: artifact.Ref, CreatedAt: artifact.CreatedAt, ExpiresAt: artifact.ExpiresAt, Actor: experiment.Spec.Requester, Lease: experiment.Lease})
	}); operationErr != nil {
		return nil, operationErr
	}
	record, err := opt.SealExecution(opt.ExecutionRecord{Artifacts: []opt.ArtifactRef{artifact.Ref}, RunID: captured.ID, PreparedDigest: p.Digest(), InputDigest: e.request.Task.InputDigest, State: captured.State, Outcome: run.Outcome{StopReason: captured.StopReason, Output: captured.Output, FinishReason: captured.FinishReason, StepCount: captured.StepCount, TokensUsed: captured.TokensUsed, CompletedAt: *captured.CompletedAt}, StartedAt: *captured.StartedAt, CompletedAt: *captured.CompletedAt, Duration: captured.CompletedAt.Sub(*captured.StartedAt), Environment: e.receipt, Usage: opt.Usage{Tokens: int64(captured.TokensUsed), TokenQuality: opt.UsageKnown, MoneyQuality: opt.UsageUnknown}})
	if err != nil {
		return nil, err
	}
	if _, err = f.journal.put("result", e.receipt.AttemptID.String(), record); err != nil {
		return nil, err
	}
	return &record, f.check(ctx)
}

func (f *cortexOptimizationEnvironments) lock(ctx context.Context) error {
	for !f.gate.TryLock() {
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	if err := ctx.Err(); err != nil {
		f.gate.Unlock()
		return err
	}
	return nil
}

func cortexOptimizationTrialState(state run.State) opt.TrialState {
	if state == run.StateCompleted {
		return opt.TrialCompleted
	}
	return opt.TrialFailed
}
