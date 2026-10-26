package main

import (
	"context"
	"errors"
	"testing"

	"github.com/xraph/cortex"
	opt "github.com/xraph/cortex/optimization"
)

func TestCortexOptimizationCapabilitiesMatchCurrentTarget(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "capabilities"})
	if err != nil {
		t.Fatal(err)
	}
	target := opt.CapabilityTarget{Scope: experiment.Spec.Scope, ExperimentID: experiment.ID, AgentID: experiment.Spec.AgentID, Mode: experiment.Spec.Mode, Baseline: experiment.Spec.Baseline, Controller: experiment.Spec.Controller, Evaluation: experiment.Spec.Evaluation}
	ready, err := h.Inspect(ctx, target)
	if err != nil {
		t.Fatal(err)
	}
	if ready.Checks[opt.CapabilityWorker] != opt.ReadinessUnavailable || ready.Checks[opt.CapabilityEnvironment] != opt.ReadinessReady || ready.Checks[opt.CapabilityLessons] != opt.ReadinessUnavailable || ready.Checks[opt.CapabilityPublication] != opt.ReadinessUnavailable {
		t.Fatalf("unsupported readiness claim: %+v", ready)
	}
	changed := target
	changed.Baseline.Digest = "changed"
	if _, err = h.Inspect(ctx, changed); !errors.Is(err, opt.ErrConflict) {
		t.Fatalf("mismatched target admitted: %v", err)
	}
	changed = target
	changed.Scope = cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "other"}}}
	if _, err = h.Inspect(ctx, changed); err == nil {
		t.Fatal("cross-scope readiness admitted")
	}
	h.model.check = func(context.Context) error { return opt.ErrUnavailable }
	unavailable, err := h.Inspect(ctx, target)
	if err != nil || unavailable.Checks[opt.CapabilityAccounting] != opt.ReadinessUnknown || unavailable.Checks[opt.CapabilityEnvironment] != opt.ReadinessUnknown {
		t.Fatalf("unverified model reported ready: %+v %v", unavailable, err)
	}
	if *calls != 0 {
		t.Fatal("capability probe dispatched inference")
	}
}
