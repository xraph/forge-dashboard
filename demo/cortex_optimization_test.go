package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/id"
	opt "github.com/xraph/cortex/optimization"
)

// These responses test the installed host's mechanics. They are not model evidence.
func cortexOptimizationFixture(t *testing.T) (*cortexDemoOptimizationHost, context.Context, *int) {
	t.Helper()
	return cortexOptimizationFixtureProposal(t, "")
}
func cortexOptimizationFixtureProposal(t *testing.T, proposal string) (*cortexDemoOptimizationHost, context.Context, *int) {
	t.Helper()
	verification, _, _, _, _, file := cortexVerificationFixture(t, "fixture")
	calls := new(int)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		var request struct {
			Messages []struct{ Role, Content string } `json:"messages"`
			Format   json.RawMessage                  `json:"format"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			return
		}
		system, input := "", ""
		for _, m := range request.Messages {
			if m.Role == "system" {
				system += m.Content
			}
			if m.Role == "user" {
				input = m.Content
			}
		}
		if len(request.Format) == 0 || !json.Valid(request.Format) {
			t.Error("installed host omitted structured format")
		}
		output := ""
		switch {
		case strings.Contains(system, "JSON for the propose operation"):
			output = `{"proposals":[{"edits":[{"kind":"section_body","target":"record-guidance","text":"CHECK-EXACT: Compute the exact sum and output the requested JSON only."}],"rationale":"Check the sum","evidence_ids":[]}]}`
			if proposal != "" {
				output = proposal
			}
		case strings.Contains(system, "JSON for the reflect operation"):
			output = `{"lessons":[]}`
		default:
			var name, revision string
			var a, b int
			if _, err := fmt.Sscanf(input, "Synthetic benchmark record %s has bins with %d and %d units. Add them for units. Status is reviewed; revision is %s", &name, &a, &b, &revision); err != nil {
				t.Errorf("unexpected fixture prompt %q: %v", input, err)
			}
			value := cortexVerificationRecord{Record: name, Units: a + b, Status: "reviewed", Revision: strings.TrimSuffix(revision, ".")}
			if !strings.Contains(system, "CHECK-EXACT") {
				value.Units++
			}
			body, err := json.Marshal(value)
			if err != nil {
				t.Error(err)
			}
			output = string(body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"model": "qwen3:4b", "done": true, "done_reason": "stop", "message": map[string]any{"role": "assistant", "content": output}, "prompt_eval_count": 100, "eval_count": 100})
	}))
	t.Cleanup(server.Close)
	model := &cortexOptimizationModel{endpoint: server.URL, client: server.Client(), check: func(context.Context) error { return nil }}
	host, err := newCortexDemoOptimization(verification, filepath.Join(filepath.Dir(file), "optimization-host"), model)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := host.Stop(context.Background()); err != nil {
			t.Error(err)
		}
	})
	ctx := cortex.WithPrincipal(cortex.WithScope(context.Background(), verification.scope), dc.Principal{User: &dashauth.UserInfo{Subject: cortexOptimizationOperator, ProviderName: "local-development", Scopes: []string{"cortex.read", "cortex.run", "cortex.manage", "cortex.approve"}}, Claims: map[string]any{"cortex_demo_scope": verification.scope.Canonical()}})
	return host, ctx, calls
}
func cortexOptimizationSelection(h *cortexDemoOptimizationHost) opt.CreationSelection {
	var s opt.CreationSelection
	for _, choice := range h.frozen.Choices {
		switch choice.Kind {
		case opt.CatalogAgent:
			s.Agent = choice.Ref
		case opt.CatalogController:
			s.Controller = choice.Ref
		case opt.CatalogEvaluation:
			s.Evaluation = choice.Ref
		case opt.CatalogEnvironment:
			s.Environment = choice.Ref
		}
	}
	s.Mode = opt.ModeSequential
	return s
}
func TestCortexOptimizationInstalledHostLifecycle(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixture(t)
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "create-one"})
	if err != nil {
		t.Fatal(err)
	}
	retry, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "create-one"})
	if err != nil || retry.ID != experiment.ID {
		t.Fatal("creation retry changed identity", err)
	}
	if *calls != 0 {
		t.Fatal("catalog or creation executed model")
	}
	experiment, err = h.Optimizer.Start(ctx, experiment.ID, experiment.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err != nil {
		t.Fatal(err)
	}
	experiment, err = h.repository.GetExperiment(ctx, experiment.ID)
	if err != nil {
		t.Fatal(err)
	}
	paused, pauseErr := h.Optimizer.Pause(ctx, experiment.ID, experiment.Revision)
	if pauseErr != nil {
		t.Fatal(pauseErr)
	}
	if err = h.Optimizer.WorkOnce(h.serviceContext(ctx), experiment.ID); err == nil {
		t.Fatal("paused experiment executed")
	}
	if *calls != 0 {
		t.Fatal("paused work called provider")
	}
	experiment, err = h.Optimizer.Resume(ctx, experiment.ID, paused.Revision)
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
	if experiment.State != opt.StateReviewRequired {
		t.Fatalf("did not reach review: %+v", experiment)
	}
	decision, err := h.repository.GetDecision(ctx, experiment.DecisionID)
	if err != nil {
		t.Fatal(err)
	}
	if decision.Outcome != opt.DecisionRecommend || decision.EvidenceClass != opt.EvidenceValidated {
		t.Fatalf("fixture did not create real validated comparison: %+v", decision)
	}
	reservations, err := h.repository.ListReservations(ctx, experiment.ID, opt.PageQuery{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	controllerReceipts := 0
	for _, reservation := range reservations.Items {
		if !strings.HasPrefix(reservation.Request.CallKey, "controller/") {
			continue
		}
		controllerReceipts++
		if reservation.State != opt.ReservationSettled || reservation.DebitedTokens != 200 {
			t.Fatalf("controller usage not settled: %+v", reservation)
		}
		recovered, recoverErr := h.Recover(ctx, reservation)
		if recoverErr != nil || recovered.RequestDigest != reservation.Call.RequestDigest || recovered.Settlement.Usage.Tokens != 200 {
			t.Fatal("durable usage receipt", recoverErr)
		}
		altered := reservation
		altered.Request.CallKey += "/forged"
		if _, recoverErr = h.Recover(ctx, altered); recoverErr == nil {
			t.Fatal("forged dispatch binding recovered")
		}
	}
	if controllerReceipts != 2 {
		t.Fatalf("controller receipts=%d", controllerReceipts)
	}
	activation, err := h.Optimizer.Activate(ctx, opt.ActivationRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, Version: decision.Candidate, DecisionID: decision.ID, Reason: "Review fixture's captured comparison"})
	if err != nil {
		t.Fatal(err)
	}
	request := opt.ActiveRunRequest{AgentID: h.frozen.AgentID, Input: h.frozen.Binding.Cases[0].Task.Input}
	active, err := h.Optimizer.RunActive(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if active.Provenance.HarnessVersion != decision.Candidate.ID.String() {
		t.Fatal("next run did not pin reviewed version")
	}
	deactivated, err := h.Optimizer.Deactivate(ctx, opt.DeactivationRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, ExpectedGeneration: activation.Generation, Reason: "Test withdrawal"})
	if err != nil {
		t.Fatal(err)
	}
	before := *calls
	if _, err = h.Optimizer.RunActive(ctx, request); !errors.Is(err, opt.ErrInactiveActivation) {
		t.Fatalf("withdrawn route ran: %v", err)
	}
	if *calls != before {
		t.Fatal("inactive route dispatched")
	}
	rolled, err := h.Optimizer.Rollback(ctx, opt.RollbackRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, TargetID: activation.ID, ExpectedGeneration: deactivated.Generation, Reason: "Restore reviewed fixture route"})
	if err != nil || rolled.Version != activation.Version {
		t.Fatal("rollback", err)
	}
	t.Setenv("DEMO_CORTEX_ROLE", "reader")
	if _, err = h.Optimizer.RunActive(ctx, request); err == nil {
		t.Fatal("revoked original requester ran")
	}
	if *calls != before {
		t.Fatal("revoked route dispatched")
	}
	t.Setenv("DEMO_CORTEX_ROLE", "operator")
	currentAgent, err := h.runtime.GetAgent(ctx, h.frozen.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	currentAgent.Description = "Changed source after review"
	if err = h.runtime.UpdateAgent(ctx, currentAgent); err != nil {
		t.Fatal(err)
	}
	if _, err = h.Optimizer.RunActive(ctx, request); !errors.Is(err, opt.ErrStaleVersion) {
		t.Fatalf("stale source dispatched: %v", err)
	}
	if *calls != before {
		t.Fatal("stale route dispatched")
	}
	t.Logf("captured model calls=%d state=%s decision=%s", *calls, experiment.State, experiment.DecisionID)
}
