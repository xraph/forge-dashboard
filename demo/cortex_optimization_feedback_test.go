package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
)

func TestCortexOptimizationBoundedFeedbackPreservesOriginalEvidence(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	nativeRecorder := h.model.record
	h.model.record = func(callCtx context.Context, request *llm.Request, response *llm.Response) error {
		item, ok := callCtx.Value(cortexOptimizationWorkKey{}).(opt.WorkItem)
		if ok && item.Experiment.Phase == opt.PhaseBaseline {
			response.Content = strings.Repeat("思", 2000)
			response.FinishReason = "length"
			response.Usage = llm.Usage{PromptTokens: 92, CompletionTokens: 1024, TotalTokens: 1116}
			return nil
		}
		return nativeRecorder(callCtx, request, response)
	}
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "bounded-feedback"})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err = h.Optimizer.Start(ctx, experiment.ID, experiment.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for range 20 {
		if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
			t.Fatal(err)
		}
		experiment, err = h.repository.GetExperiment(ctx, experiment.ID)
		if err != nil {
			t.Fatal(err)
		}
		if experiment.Phase == opt.PhasePropose {
			break
		}
	}
	if experiment.Phase != opt.PhasePropose || *calls != 2 {
		t.Fatalf("discovery phase=%s calls=%d", experiment.Phase, *calls)
	}
	page, err := h.repository.ListTrials(ctx, experiment.ID, opt.TrialQuery{PageQuery: opt.PageQuery{Limit: 100}})
	if err != nil {
		t.Fatal(err)
	}
	input := opt.ProposalInput{Baseline: h.frozen.Baseline, Round: experiment.Round, Policy: h.frozen.Baseline.Policy, Lessons: []opt.Lesson{}, Evidence: []opt.DiscoveryEvidence{}}
	for _, trial := range page.Items {
		evaluation, readErr := h.repository.GetEvaluation(ctx, trial.EvaluationID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		input.Evidence = append(input.Evidence, opt.DiscoveryEvidence{Trial: trial, Evaluation: evaluation})
	}
	original, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request := &llm.Request{Model: "demo-local", System: "Return only JSON for the propose operation.", MaxTokens: 1024, Messages: []llm.Message{{Role: "user", Content: string(original)}}}
	if _, err = cortexOptimizationRequest(request); err == nil {
		t.Fatal("fixture did not exceed original context bytebound")
	}
	projectionCtx := context.WithValue(ctx, cortexOptimizationWorkKey{}, opt.WorkItem{Experiment: experiment, Lease: experiment.Lease})
	projected, err := h.projectController(projectionCtx, request)
	if err != nil {
		t.Fatal(err)
	}
	var result cortexOptimizationFeedbackInput
	if err = json.Unmarshal([]byte(projected.Messages[0].Content), &result); err != nil {
		t.Fatal(err)
	}
	if len(projected.Messages[0].Content) > cortexOptimizationFeedbackBytes || result.OriginalBytes != len(original) || len(result.Evidence) != 2 || result.Revision != cortexOptimizationFeedbackRevision {
		t.Fatal("projection bounds or identity changed")
	}
	for i, feedback := range result.Evidence {
		expected := input.Evidence[i]
		if feedback.ExecutionDigest != expected.Trial.Execution.Digest || feedback.Output.OriginalBytes != 6000 || !feedback.Output.Truncated || len(feedback.Output.Text) > 512 || !utf8.ValidString(feedback.Output.Text) || feedback.State != opt.TrialFailed || feedback.Evaluation.Complete || feedback.Evaluation.Score != nil || feedback.StopReason != "token_limit" {
			t.Fatalf("dishonest feedback: %+v", feedback)
		}
	}
	after, err := json.Marshal(input)
	if err != nil || string(after) != string(original) || request.Messages[0].Content != string(original) {
		t.Fatal("projection altered retained originals")
	}
	malformed := *request
	malformed.Messages = []llm.Message{{Role: "user", Content: strings.Replace(string(original), `"complete":false,`, "", 1)}}
	if _, err = h.projectController(projectionCtx, &malformed); err == nil {
		t.Fatal("missing required incomplete status accepted")
	}
	input.Evidence[0].Trial.Split = opt.SplitValidation
	heldout, _ := json.Marshal(input)
	malformed.Messages[0].Content = string(heldout)
	if _, err = h.projectController(projectionCtx, &malformed); !errors.Is(err, opt.ErrPolicyDenied) {
		t.Fatalf("heldout projection admitted: %v", err)
	}
	// The installed factory must meter the original request and dispatch the small
	// projection. Its receipt must reject a different projection revision.
	if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
		t.Fatal(err)
	}
	if *calls != 3 {
		t.Fatal("controller dispatch count")
	}
	reservation, err := h.repository.GetReservation(ctx, experiment.ID, "controller/propose/1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = h.Recover(ctx, reservation); err != nil {
		t.Fatal(err)
	}
	var receipt cortexOptimizationUsageReceipt
	if err = h.journal.read("controller-result", reservation.Call.RequestDigest, &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt.Response == nil || receipt.Response.FinishReason != "stop" || !json.Valid([]byte(receipt.Response.Content)) || receipt.Response.Usage != receipt.Usage {
		t.Fatal("controller response metadata was not retained")
	}
	var wire cortexOptimizationWireIntent
	if err = h.journal.read("controller-wire", reservation.Call.RequestDigest, &wire); err != nil {
		t.Fatal(err)
	}

	originalWire := wire
	for _, field := range []string{"domain", "operation", "format"} {
		modified := originalWire
		switch field {
		case "domain":
			modified.Domain = "record-guidance"
		case "operation":
			modified.Operation = "reflect"
		case "format":
			modified.FormatDigest = strings.Repeat("0", 64)
		}
		data, marshalErr := json.Marshal(modified)
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if writeErr := os.WriteFile(filepath.Join(h.journal.directory, cortexOptimizationJournalName("controller-wire", reservation.Call.RequestDigest)), data, 0600); writeErr != nil {
			t.Fatal(writeErr)
		}
		if _, recoverErr := h.Recover(ctx, reservation); !errors.Is(recoverErr, opt.ErrIncompleteEvidence) {
			t.Fatalf("%s wire substitution admitted: %v", field, recoverErr)
		}
	}
	wire.Revision = "retired-projection"
	tampered, err := json.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(h.journal.directory, cortexOptimizationJournalName("controller-wire", reservation.Call.RequestDigest)), tampered, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = h.Recover(ctx, reservation); !errors.Is(err, opt.ErrIncompleteEvidence) {
		t.Fatalf("stale wire receipt accepted: %v", err)
	}
	t.Logf("original=%d projected=%d bytes, full evidence retained", len(original), len(projected.Messages[0].Content))
}
