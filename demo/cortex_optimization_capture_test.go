package main

import (
	"context"
	"testing"

	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/run"
)

func TestCortexOptimizationTotalBudgetIncludesPromptUsage(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	h.model.record = func(_ context.Context, _ *llm.Request, response *llm.Response) error {
		response.Usage = llm.Usage{PromptTokens: 1100, CompletionTokens: 100, TotalTokens: 1200}
		return nil
	}
	_, trial := cortexOptimizationCapturedTrial(ctx, t, h)
	if trial.State != opt.TrialCompleted || trial.Execution.State != run.StateCompleted || trial.Execution.Usage.Tokens != 1200 || *calls != 1 {
		t.Fatalf("input usage incorrectly exhausted output cap: %+v", trial)
	}
	view, err := h.frozen.Baseline.Prepared.Inspect()
	if err != nil || view.Config.MaxTokens != 1024 || view.Config.Budget.MaxTokens != 33792 {
		t.Fatal("budget/output boundary changed", err)
	}
}
func TestCortexOptimizationKnownTruncationRetainsFailedCapture(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	h.model.record = func(_ context.Context, _ *llm.Request, response *llm.Response) error {
		response.FinishReason = "length"
		response.Usage = llm.Usage{PromptTokens: 92, CompletionTokens: 1024, TotalTokens: 1116}
		return nil
	}
	experiment, trial := cortexOptimizationCapturedTrial(ctx, t, h)
	capture := trial.Execution
	if trial.State != opt.TrialFailed || capture.State != run.StateIncomplete || capture.Outcome.StopReason != run.StopTokenLimit || capture.Outcome.FinishReason != "length" || capture.Usage.Tokens != 1116 || capture.Usage.TokenQuality != opt.UsageKnown || *calls != 1 {
		t.Fatalf("known truncation was not retained honestly: %+v", trial)
	}
	environment, err := h.environment.Recover(ctx, capture.Environment)
	if err != nil {
		t.Fatal(err)
	}
	status, err := environment.Inspect(ctx, capture.Environment.AttemptID)
	if err != nil || status.State != opt.TrialFailed || status.Execution.Digest != capture.Digest {
		t.Fatal("incomplete recovery", err)
	}
	if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
		t.Fatal(err)
	}
	evaluation, err := h.repository.ListEvaluations(ctx, experiment.ID, opt.PageQuery{Limit: 100})
	if err != nil || len(evaluation.Items) != 1 || evaluation.Items[0].Complete || evaluation.Items[0].Score != nil {
		t.Fatalf("incomplete capture became scored: %+v %v", evaluation, err)
	}
	if *calls != 1 {
		t.Fatal("incomplete capture replayed")
	}
}
