package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
)

type cortexOptimizationWorkKey struct{}
type cortexOptimizationPhases struct{ next opt.PhaseHandler }

func (p cortexOptimizationPhases) Execute(ctx context.Context, item opt.WorkItem) (opt.Transition, error) {
	return p.next.Execute(context.WithValue(ctx, cortexOptimizationWorkKey{}, item), item)
}

type cortexOptimizationUsageReceipt struct {
	Scope              cortex.Scope
	Reservation        opt.UsageReservation
	RequestDigest      string
	Usage              llm.Usage
	WireDigest         string
	ProjectionRevision string
	Response           *llm.Response
}

// The receipt is written by the native transport before it acknowledges completion.
// A missing receipt retains the original debit and never permits another dispatch.
func (h *cortexDemoOptimizationHost) recordController(ctx context.Context, request *llm.Request, response *llm.Response) error {
	item, ok := ctx.Value(cortexOptimizationWorkKey{}).(opt.WorkItem)
	if !ok {
		return nil
	}
	if item.Experiment.Phase != opt.PhasePropose && item.Experiment.Phase != opt.PhaseCompose && item.Experiment.Phase != opt.PhaseReflect {
		return nil
	}
	projected, ok := ctx.Value(cortexOptimizationProjectionKey{}).(cortexOptimizationProjection)
	if !ok || projected.Original == nil {
		return opt.ErrIncompleteEvidence
	}
	wireDigest, _, err := cortexOptimizationDigest(request)
	if err != nil || wireDigest != projected.WireDigest {
		return opt.ErrIncompleteEvidence
	}
	saved, digest, err := h.controllerDispatch(ctx, projected.Original)
	if err != nil {
		return err
	}
	_, err = h.journal.put("controller-result", digest, cortexOptimizationUsageReceipt{Scope: h.verification.scope, Reservation: saved.Request, RequestDigest: digest, Usage: response.Usage, WireDigest: wireDigest, ProjectionRevision: cortexOptimizationFeedbackRevision, Response: response})
	return err
}
func cortexOptimizationDispatchDigest(scope cortex.Scope, reservation opt.UsageReservation, request *llm.Request) (string, error) {
	encoded, err := json.Marshal(struct {
		Schema        int
		Scope         cortex.Scope
		ExperimentID  id.ID
		AttemptID     id.ID
		Operation     opt.OperationClass
		CallKey       string
		ModelRevision string
		Streaming     bool
		Request       *llm.Request
	}{1, scope, reservation.ExperimentID, reservation.AttemptID, reservation.Operation, reservation.CallKey, cortexOptimizationModelRevision, false, request})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func (h *cortexDemoOptimizationHost) controllerReceipt(ctx context.Context, saved opt.Reservation) (cortexOptimizationUsageReceipt, error) {
	var receipt cortexOptimizationUsageReceipt
	if err := h.Authorize(ctx, opt.ActionReconcileUsage, opt.Resource{Scope: h.verification.scope, AgentID: h.frozen.AgentID}); err != nil {
		return receipt, err
	}
	if saved.Call == nil || saved.Call.Validate() != nil {
		return receipt, opt.ErrUnknownAttempt
	}
	if err := h.journal.read("controller-result", saved.Call.RequestDigest, &receipt); err != nil {
		return receipt, opt.ErrUnknownAttempt
	}
	if receipt.Response == nil || receipt.Response.Usage != receipt.Usage || (receipt.Response.FinishReason != "stop" && receipt.Response.FinishReason != "length") {
		return receipt, opt.ErrIncompleteEvidence
	}
	if receipt.Scope.Canonical() != h.verification.scope.Canonical() || !reflect.DeepEqual(receipt.Reservation, saved.Request) || receipt.RequestDigest != saved.Call.RequestDigest || receipt.Usage.PromptTokens <= 0 || receipt.Usage.CompletionTokens < 0 || receipt.Usage.TotalTokens != receipt.Usage.PromptTokens+receipt.Usage.CompletionTokens || int64(receipt.Usage.TotalTokens) > saved.Request.MaxTokens {
		return receipt, opt.ErrIncompleteEvidence
	}
	var wire cortexOptimizationWireIntent
	if err := h.journal.read("controller-wire", saved.Call.RequestDigest, &wire); err != nil {
		return receipt, opt.ErrIncompleteEvidence
	}
	operation, domain, routeErr := cortexOptimizationControllerRoute(wire.Request)
	format, formatErr := cortexOptimizationResponseFormat(wire.Request)
	formatDigest, _, digestErr := cortexOptimizationDigest(format)
	if routeErr != nil || formatErr != nil || digestErr != nil || wire.Operation != operation || wire.Domain != domain || wire.FormatDigest != formatDigest {
		return receipt, opt.ErrIncompleteEvidence
	}
	actual, _, err := cortexOptimizationDigest(wire.Request)
	if err != nil || wire.Revision != cortexOptimizationFeedbackRevision || receipt.ProjectionRevision != wire.Revision || wire.RequestDigest != receipt.RequestDigest || wire.WireDigest != receipt.WireDigest || actual != wire.WireDigest {
		return receipt, opt.ErrIncompleteEvidence
	}
	return receipt, h.Authorize(ctx, opt.ActionReconcileUsage, opt.Resource{Scope: h.verification.scope, AgentID: h.frozen.AgentID})
}
func cortexOptimizationUsage(receipt cortexOptimizationUsageReceipt) opt.Usage {
	return opt.Usage{Tokens: int64(receipt.Usage.TotalTokens), TokenQuality: opt.UsageKnown, MoneyQuality: opt.UsageUnknown, Receipt: "ollama/" + receipt.RequestDigest}
}
func (h *cortexDemoOptimizationHost) Observe(ctx context.Context, observation opt.ModelObservation) (opt.ModelUsageReport, error) {
	if !observation.Completed || !observation.UsagePresent || observation.Streaming || observation.Err != nil || observation.Model != "demo-local" || observation.ReportedModel != "demo-local" || observation.ModelRevision != cortexOptimizationModelRevision {
		return opt.ModelUsageReport{}, opt.ErrUnknownAttempt
	}
	saved, err := h.repository.GetReservation(ctx, observation.Reservation.ExperimentID, observation.Reservation.CallKey)
	if err != nil {
		return opt.ModelUsageReport{}, err
	}
	receipt, err := h.controllerReceipt(ctx, saved)
	if err != nil {
		return opt.ModelUsageReport{}, err
	}
	if receipt.RequestDigest != observation.RequestDigest || !reflect.DeepEqual(receipt.Reservation, observation.Reservation) || receipt.Usage != observation.Usage {
		return opt.ModelUsageReport{}, opt.ErrIncompleteEvidence
	}
	return opt.ModelUsageReport{Usage: cortexOptimizationUsage(receipt), Complete: true}, nil
}
func (h *cortexDemoOptimizationHost) Recover(ctx context.Context, saved opt.Reservation) (opt.VerifiedUsageReceipt, error) {
	receipt, err := h.controllerReceipt(ctx, saved)
	if err != nil {
		return opt.VerifiedUsageReceipt{}, err
	}
	usage := cortexOptimizationUsage(receipt)
	return opt.VerifiedUsageReceipt{RequestDigest: receipt.RequestDigest, Settlement: opt.UsageSettlement{ExperimentID: saved.Request.ExperimentID, AttemptID: saved.Request.AttemptID, CallKey: saved.Request.CallKey, Receipt: usage.Receipt, Usage: usage, Complete: true}}, nil
}
