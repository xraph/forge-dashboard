package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/planning"
)

func TestCortexPlanningStructuredFormatIsExplicit(t *testing.T) {
	var captured []map[string]json.RawMessage
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		captured = append(captured, input)
		_, _ = w.Write([]byte(`{"model":"qwen3:4b","done":true,"done_reason":"stop","message":{"role":"assistant","content":"{}"},"prompt_eval_count":100,"eval_count":2}`))
	}))
	defer server.Close()
	team := newCortexPlanningModel()
	plain := newCortexOptimizationModel()
	for _, model := range []*cortexOptimizationModel{team, plain} {
		model.endpoint = server.URL
		model.check = func(context.Context) error { return nil }
	}
	req := &llm.Request{Model: "demo-local", System: cortexPlanningProducerRole, Messages: []llm.Message{{Role: "user", Content: "Calculate the record"}}, MaxTokens: 1024}
	_, err := team.Complete(t.Context(), req)
	cortexPlanningNoError(t, err)
	_, err = plain.Complete(t.Context(), req)
	cortexPlanningNoError(t, err)
	cortexPlanningEqual(t, 2, len(captured))
	if len(captured[0]["format"]) == 0 || len(captured[1]["format"]) != 0 {
		t.Fatal("team schema missing or optimizer default changed")
	}
	var schema struct {
		Properties map[string]map[string]any `json:"properties"`
		Required   []string                  `json:"required"`
		Additional bool                      `json:"additionalProperties"`
	}
	cortexPlanningNoError(t, json.Unmarshal(captured[0]["format"], &schema))
	cortexPlanningEqual(t, []string{"record", "revision", "status", "units"}, schema.Required)
	cortexPlanningEqual(t, "integer", schema.Properties["units"]["type"])
	cortexPlanningFalse(t, schema.Additional)
	if strings.Contains(string(captured[0]["format"]), `"const"`) || strings.Contains(string(captured[0]["format"]), "warehouse-7") {
		t.Fatal("schema forces the expected answer")
	}
	req.System = "unknown role"
	_, err = team.Complete(t.Context(), req)
	cortexPlanningErrorIs(t, err, planning.ErrInvalid)
	cortexPlanningEqual(t, 2, len(captured))
}
func TestCortexPlanningReviewerFormatAllowsDisagreement(t *testing.T) {
	review := coordination.ReviewOutput{SchemaVersion: 1, HandoffDigest: "handoff", SubjectDigest: "subject", BindingDigest: "binding", Findings: []coordination.ReviewFinding{{CriterionID: "criterion", Assessment: coordination.ReviewMissing, Reason: "unassessed"}}}
	body, err := json.Marshal(review)
	cortexPlanningNoError(t, err)
	schema, err := cortexPlanningResponseFormat(&llm.Request{System: cortexPlanningReviewerRole, Messages: []llm.Message{{Role: "user", Content: "Template: " + string(body) + " /no_think"}}})
	cortexPlanningNoError(t, err)
	for _, assessment := range []string{"supported", "contradicted", "missing_evidence"} {
		if !strings.Contains(string(schema), assessment) {
			t.Fatalf("missing independent assessment %s", assessment)
		}
	}
	if strings.Contains(string(schema), "unassessed") || strings.Contains(string(schema), `"const"`) {
		t.Fatal("review schema imposes a finding")
	}
}

func TestCortexPlanningNativeTimeoutIncludesResponseHeaders(t *testing.T) {
	team := newCortexPlanningModel()
	plain := newCortexOptimizationModel()
	for _, pair := range []struct {
		model    *cortexOptimizationModel
		expected time.Duration
	}{{team, 5 * time.Minute}, {plain, time.Minute}} {
		transport, ok := pair.model.client.Transport.(*http.Transport)
		if !ok {
			t.Fatal("native HTTP transport missing")
		}
		cortexPlanningEqual(t, pair.expected, transport.ResponseHeaderTimeout)
		cortexPlanningEqual(t, pair.expected, pair.model.client.Timeout)
	}
}
