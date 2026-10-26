package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/id"
	opt "github.com/xraph/cortex/optimization"
)

// This exercises the exact installed host with real Ollama inference. The fixed
// synthetic corpus measures this record task only, not general model quality.
func TestCortexOptimizationInstalledOllama(t *testing.T) {
	if os.Getenv("CORTEX_QUALIFY_OPTIMIZATION") != "1" {
		t.Skip("explicit installed optimizer qualification required")
	}
	t.Setenv("DEMO_CORTEX_PROVIDER", "ollama")
	t.Setenv("DEMO_CORTEX_VERIFICATION", "true")
	t.Setenv("DEMO_CORTEX_OPTIMIZATION", "true")
	t.Setenv("DEMO_CORTEX_ROLE", "operator")
	path := os.Getenv("CORTEX_QUALIFY_OPTIMIZATION_DB")
	if path == "" {
		path = filepath.Join(t.TempDir(), "qualification.db")
	} else {
		if !filepath.IsAbs(path) || filepath.Clean(path) != path {
			t.Fatal("qualification database must be an absolute clean path")
		}
		for _, candidate := range []string{path, path + ".optimization"} {
			if _, statErr := os.Lstat(candidate); !os.IsNotExist(statErr) {
				t.Fatal("qualification database and journal must be fresh")
			}
		}
	}
	t.Logf("synthetic qualification database: %s", path)
	base := cortexTestEngine(t, path)
	scope := cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-northwind"}, {Key: "app", Value: "cortex"}}}
	v, err := configureCortexDemoVerification(base.Store(), scope, path)
	if err != nil {
		t.Fatal(err)
	}
	if err = v.Activate(context.Background()); err != nil {
		t.Fatal(err)
	}
	h, err := configureCortexDemoOptimization(v, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if closeErr := h.Stop(context.Background()); closeErr != nil {
			t.Error(closeErr)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 16*time.Minute)
	defer cancel()
	ctx = cortex.WithPrincipal(cortex.WithScope(ctx, scope), dc.Principal{User: &dashauth.UserInfo{Subject: cortexOptimizationOperator, ProviderName: "local-development", Scopes: []string{"cortex.read", "cortex.run", "cortex.manage", "cortex.approve"}}, Claims: map[string]any{"cortex_demo_scope": scope.Canonical()}})
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "installed-synthetic-record-v1"})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err = h.Optimizer.Start(ctx, experiment.ID, experiment.Revision)
	if err != nil {
		t.Fatal(err)
	}
	for step := range 300 {
		if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
			t.Fatalf("step %d phase %s: %v", step, experiment.Phase, err)
		}
		experiment, err = h.repository.GetExperiment(ctx, experiment.ID)
		if err != nil {
			t.Fatal(err)
		}
		if experiment.State == opt.StateReviewRequired || experiment.State == opt.StateCompleted {
			break
		}
	}
	if experiment.DecisionID.IsNil() {
		t.Fatalf("comparison did not produce a retained decision: state=%s phase=%s", experiment.State, experiment.Phase)
	}
	decision, err := h.repository.GetDecision(ctx, experiment.DecisionID)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("synthetic record comparison: experiment=%s decision=%s outcome=%s evidence=%s baseline=%s candidate=%s", experiment.ID, decision.ID, decision.Outcome, decision.EvidenceClass, experiment.Spec.Baseline.ID, decision.Candidate.ID)
	request := opt.ActivationRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, Version: decision.Candidate, DecisionID: decision.ID, Reason: "Explicit installed synthetic record qualification"}
	if decision.Outcome != opt.DecisionRecommend || decision.EvidenceClass != opt.EvidenceValidated {
		if _, err = h.Optimizer.Activate(ctx, request); err == nil {
			t.Fatal("nonqualifying comparison activated")
		}
		current, readErr := h.repository.GetActivation(ctx, h.frozen.AgentID, "")
		if readErr != nil && !errors.Is(readErr, opt.ErrNotFound) {
			t.Fatal(readErr)
		}
		if readErr == nil && current.Version != experiment.Spec.Baseline {
			t.Fatal("nonqualifying comparison changed active version")
		}
		t.Log("No qualified winner. Baseline is unchanged; activation remains blocked.")
		return
	}
	activation, err := h.Optimizer.Activate(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	next, err := h.Optimizer.RunActive(ctx, opt.ActiveRunRequest{AgentID: h.frozen.AgentID, Input: h.frozen.Binding.Cases[0].Task.Input})
	if err != nil {
		t.Fatal(err)
	}
	if next.Provenance.HarnessVersion != decision.Candidate.ID.String() {
		t.Fatal("next installed run omitted reviewed harness pin")
	}
	if _, err = h.Optimizer.Deactivate(ctx, opt.DeactivationRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, ExpectedGeneration: activation.Generation, Reason: "End synthetic qualification"}); err != nil {
		t.Fatal(err)
	}
	t.Logf("Explicit next-run invocation retained reviewed version %s", next.Provenance.HarnessVersion)
}
