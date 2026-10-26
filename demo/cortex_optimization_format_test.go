package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
)

func TestCortexOptimizationStructuredFormats(t *testing.T) {
	for _, operation := range []string{"record", "propose", "compose", "reflect"} {
		t.Run(operation, func(t *testing.T) {
			system := "record output /no_think"
			if operation != "record" {
				system = "Return only JSON for the " + operation + " operation. /no_think"
			}
			content := "facts"
			if operation != "record" {
				projection := cortexOptimizationFeedbackInput{Revision: cortexOptimizationFeedbackRevision, Operation: operation}
				if operation == "reflect" {
					projection.Domain = cortexOptimizationDomain
				}
				body, marshalErr := json.Marshal(projection)
				if marshalErr != nil {
					t.Fatal(marshalErr)
				}
				content = string(body)
			}
			schema, err := cortexOptimizationResponseFormat(&llm.Request{Model: "demo-local", System: system, Messages: []llm.Message{{Role: "user", Content: content}}})
			if err != nil || !json.Valid(schema) {
				t.Fatalf("format: %s %v", schema, err)
			}
			if strings.Contains(string(schema), "synthetic-bin") || strings.Contains(string(schema), "reviewed") || strings.Contains(string(schema), "const") {
				t.Fatal("schema contains an answer")
			}
			if operation == "record" && (strings.Index(string(schema), `"record":`) >= strings.Index(string(schema), `"units":`) || strings.Index(string(schema), `"units":`) >= strings.Index(string(schema), `"status":`)) {
				t.Fatal("record schema changed required output order")
			}
			if operation == "reflect" && !strings.Contains(string(schema), `"domain":{"type":"string","enum":["local-synthetic-record"]}`) {
				t.Fatal("reflection schema does not pin the configured domain")
			}
			if operation == "propose" && !strings.Contains(string(schema), `"minItems":0`) {
				t.Fatal("no-edit proposal forbidden")
			}
		})
	}
	if _, err := cortexOptimizationResponseFormat(nil); err == nil {
		t.Fatal("nil request accepted")
	}
	if _, err := cortexOptimizationResponseFormat(&llm.Request{Model: "demo-local", System: "JSON for the propose operation JSON for the reflect operation"}); err == nil {
		t.Fatal("ambiguous operation accepted")
	}
}

func TestCortexOptimizationNoEditProposalRetainsBaseline(t *testing.T) {
	h, ctx, calls := cortexOptimizationFixtureProposal(t, `{"proposals":[{"edits":[],"rationale":"No supported change","evidence_ids":[]}]}`)
	experiment, err := h.Optimizer.CreateCommand(ctx, opt.CreationRequest{Selection: cortexOptimizationSelection(h), IdempotencyKey: "no-edit-proposal"})
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
	decision, err := h.repository.GetDecision(ctx, experiment.DecisionID)
	if err != nil {
		t.Fatal(err)
	}
	if decision.Outcome != opt.DecisionRetain || decision.Candidate != experiment.Spec.Baseline {
		t.Fatalf("empty proposal changed baseline: %+v", decision)
	}
	candidates, err := h.repository.ListCandidates(ctx, experiment.ID, opt.PageQuery{Limit: 10})
	if err != nil || len(candidates.Items) != 1 || candidates.Items[0].Accepted {
		t.Fatalf("accepted a no-edit candidate: %+v %v", candidates, err)
	}
	if _, err = h.Optimizer.Activate(ctx, opt.ActivationRequest{ID: id.New(opt.PrefixActivation), AgentID: h.frozen.AgentID, Version: decision.Candidate, DecisionID: decision.ID, Reason: "No change"}); err == nil {
		t.Fatal("unchanged baseline comparison activated")
	}
	if *calls != 24 {
		t.Fatalf("calls=%d, expected 22 baseline records and two controller calls", *calls)
	}
}

func TestCortexOptimizationControllerFormatRejectsRoutingMismatch(t *testing.T) {
	for _, bad := range []struct{ operation, domain, system string }{
		{"reflect", "record-guidance", "reflect"},
		{"reflect", cortexOptimizationDomain, "propose"},
		{"propose", cortexOptimizationDomain, "propose"},
	} {
		projection := cortexOptimizationFeedbackInput{Revision: cortexOptimizationFeedbackRevision, Operation: bad.operation, Domain: bad.domain}
		data, err := json.Marshal(projection)
		if err != nil {
			t.Fatal(err)
		}
		request := &llm.Request{Model: "demo-local", System: "Return only JSON for the " + bad.system + " operation.", Messages: []llm.Message{{Role: "user", Content: string(data)}}}
		if _, err = cortexOptimizationResponseFormat(request); err == nil {
			t.Fatalf("routing mismatch admitted: %+v", bad)
		}
	}
}
