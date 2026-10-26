package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"errors"
	"reflect"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/planning"
	"github.com/xraph/cortex/safety"
)

// This provider exercises durable host mechanics, not local-model accuracy.
type cortexPlanningFixtureLLM struct {
	mu         sync.Mutex
	calls      int
	contradict bool
}

func (c *cortexPlanningFixtureLLM) Complete(_ context.Context, r *llm.Request) (*llm.Response, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	if _, err := cortexPlanningResponseFormat(r); err != nil {
		return nil, err
	}
	input := r.Messages[len(r.Messages)-1].Content
	output := `{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1"}`
	if at := strings.Index(input, "Document: "); at >= 0 {
		output = strings.TrimSuffix(input[at+len("Document: "):], " /no_think")
	}
	if at := strings.Index(input, "Template: "); at >= 0 {
		var review coordination.ReviewOutput
		if err := json.Unmarshal([]byte(strings.TrimSuffix(input[at+len("Template: "):], " /no_think")), &review); err != nil {
			return nil, err
		}
		for i := range review.Findings {
			review.Findings[i].Assessment = coordination.ReviewSupported
			review.Findings[i].Reason = "Candidate agrees with retained source"
			if c.contradict {
				review.Findings[i].Assessment = coordination.ReviewContradicted
				review.Findings[i].Reason = "Fixture reviewer contradicts candidate"
			}
		}
		body, err := json.Marshal(review)
		if err != nil {
			return nil, err
		}
		output = string(body)
	}
	return &llm.Response{Content: output, FinishReason: "stop", Usage: llm.Usage{TotalTokens: 100}}, nil
}
func (c *cortexPlanningFixtureLLM) CompleteStream(ctx context.Context, r *llm.Request) (llm.Stream, error) {
	response, err := c.Complete(ctx, r)
	if err != nil {
		return nil, err
	}
	return &cortexDemoStream{response: response, words: []string{response.Content}}, nil
}
func TestCortexPlanningThreeAgentsAndRestart(t *testing.T) {
	for _, contradict := range []bool{false, true} {
		name := "supported"
		if contradict {
			name = "contradicted"
		}
		t.Run(name, func(t *testing.T) { cortexPlanningJourney(t, contradict) })
	}
}
func cortexPlanningJourney(t *testing.T, contradict bool) {
	t.Setenv("DEMO_CORTEX_PLANNING", "true")
	verified, _, ctx, _, _, path := cortexVerificationFixture(t, "")
	scanner := cortexReplayScanner(t)
	options := []engine.Option{engine.WithModelRevision("demo-local", verified.authority.ModelRevision), engine.WithSafety(scanner), engine.WithPublicationGate(safety.ScannerGate{Scanner: scanner}), engine.WithPublicationPolicy(safety.Policy{Version: 1, Mode: safety.ModeBuffered, Required: true})}
	client := &cortexPlanningFixtureLLM{contradict: contradict}
	host, err := configureCortexDemoPlanningWithModel(verified, client, path, options)
	cortexPlanningNoError(t, err)
	prestart := coordination.PlanningCommand{Operation: "propose_revision", OperationID: id.New(coordination.PrefixPlanReplan), PlanID: host.root.Plan.ID, ExpectedRevision: 1, ExpectedDigest: host.root.Plan.Digest, Reason: "prestart denied"}
	_, err = host.Operator.Command(ctx, prestart)
	cortexPlanningErrorIs(t, err, coordination.ErrPlanningUnavailable)
	cortexPlanningEqual(t, 0, client.calls)
	cortexPlanningNoError(t, host.Start(ctx))
	defer func() { cortexPlanningNoError(t, host.Stop(context.Background())) }()
	detail, err := host.Operator.Detail(ctx, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	cortexPlanningFalse(t, detail.Complete)
	cortexPlanningFalse(t, detail.Tasks[0].Ready)
	command := coordination.PlanningCommand{Operation: "propose_revision", OperationID: id.New(coordination.PrefixPlanReplan), PlanID: host.root.Plan.ID, ExpectedRevision: 1, ExpectedDigest: host.root.Plan.Digest, Reason: "Prepare bounded plan"}
	_, err = host.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	command.Operation = "observe_revision"
	_, err = host.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	command.Operation = "accept_revision"
	acceptedPlan, err := host.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	cortexPlanningEqualValues(t, 2, acceptedPlan.PlanRevision)
	_, err = host.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	detail, err = host.Operator.Detail(ctx, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	cortexPlanningTrue(t, detail.Tasks[0].Ready)
	claim := coordination.PlanningCommand{Operation: "claim", OperationID: id.New(coordination.PrefixClaim), PlanID: host.root.Plan.ID, TaskID: host.root.Plan.Tasks[0].ID, ExpectedRevision: acceptedPlan.PlanRevision, ExpectedDigest: acceptedPlan.PlanDigest, Reason: "Execute reviewed plan"}
	_, err = host.Operator.Command(ctx, claim)
	cortexPlanningNoError(t, err)
	_, err = host.Operator.Command(ctx, claim)
	cortexPlanningNoError(t, err)
	detail, err = host.Operator.Detail(ctx, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	task := detail.Tasks[0]
	reconcile := coordination.PlanningCommand{Operation: "reconcile", OperationID: task.AssignmentID, PlanID: host.root.Plan.ID, TaskID: task.ID, ExpectedRevision: acceptedPlan.PlanRevision, ExpectedDigest: acceptedPlan.PlanDigest, ExpectedClaimRevision: task.ClaimRevision, ExpectedAssignmentRevision: task.AssignmentRevision, Reason: "Review committed producer result"}
	_, err = host.Operator.Command(ctx, reconcile)
	cortexPlanningNoError(t, err)
	detail, err = host.Operator.Detail(ctx, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	if contradict {
		cortexPlanningFalse(t, detail.Complete)
		cortexPlanningFalse(t, detail.Tasks[0].CurrentlyAccepted)
		cortexPlanningEqual(t, 3, client.calls)
		reconcile.ExpectedAssignmentRevision = detail.Tasks[0].AssignmentRevision
		_, err = host.Operator.Command(ctx, reconcile)
		cortexPlanningNoError(t, err)
		cortexPlanningEqual(t, 3, client.calls)
		return
	}
	cortexPlanningTrue(t, detail.Complete)
	cortexPlanningTrue(t, detail.Tasks[0].CurrentlyAccepted)
	cortexPlanningNotNil(t, detail.Tasks[0].AcceptedArtifact)
	_, err = host.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	cortexPlanningEqual(t, 3, client.calls)
	cortexPlanningNoError(t, host.Stop(context.Background()))
	_, err = host.Operator.Command(ctx, command)
	cortexPlanningErrorIs(t, err, coordination.ErrPlanningUnavailable)
	cortexPlanningEqual(t, 3, client.calls)
	restarted, err := configureCortexDemoPlanningWithModel(verified, client, path, options)
	cortexPlanningNoError(t, err)
	cortexPlanningNoError(t, restarted.Start(ctx))
	defer func() { cortexPlanningNoError(t, restarted.Stop(context.Background())) }()
	current, err := restarted.Operator.Detail(ctx, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	cortexPlanningTrue(t, current.Complete)
	cortexPlanningEqual(t, 3, client.calls)
	_, err = restarted.Operator.Command(ctx, command)
	cortexPlanningNoError(t, err)
	cortexPlanningEqual(t, 3, client.calls)
	reader := cortex.WithPrincipal(ctx, dc.Principal{User: &dashauth.UserInfo{Subject: "reader", ProviderName: "local-development", Scopes: []string{"cortex.read"}}, Claims: map[string]any{"cortex_demo_scope": host.root.Plan.Scope.Canonical()}})
	_, err = restarted.Operator.List(reader, planning.ListRequest{Limit: 10})
	cortexPlanningNoError(t, err)
	_, err = restarted.Operator.Detail(reader, host.root.Plan.ID)
	cortexPlanningNoError(t, err)
	_, err = restarted.Operator.Command(reader, claim)
	cortexPlanningErrorIs(t, err, coordination.ErrPlanningDenied)
	_, err = restarted.Operator.Detail(cortex.WithPrincipal(ctx, nil), host.root.Plan.ID)
	cortexPlanningErrorIs(t, err, coordination.ErrPlanningDenied)
}

func cortexPlanningNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
func cortexPlanningTrue(t *testing.T, value bool) {
	t.Helper()
	if !value {
		t.Fatal("expected true")
	}
}
func cortexPlanningFalse(t *testing.T, value bool) {
	t.Helper()
	if value {
		t.Fatal("expected false")
	}
}
func cortexPlanningEqual(t *testing.T, expected, actual any) {
	t.Helper()
	if !reflect.DeepEqual(expected, actual) {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
func cortexPlanningEqualValues(t *testing.T, expected int, actual int64) {
	t.Helper()
	if int64(expected) != actual {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
func cortexPlanningNotNil(t *testing.T, value any) {
	t.Helper()
	if value == nil || reflect.ValueOf(value).IsNil() {
		t.Fatal("expected non-nil")
	}
}
func cortexPlanningErrorIs(t *testing.T, actual, expected error) {
	t.Helper()
	if !errors.Is(actual, expected) {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}

func TestCortexPlanningNativeBudgetIncludesInputAndOutput(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var input struct {
			Options map[string]int `json:"options"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if input.Options["num_ctx"] != cortexOptimizationContext || input.Options["num_predict"] != 4096 {
			t.Errorf("unbounded request: %+v", input.Options)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"qwen3:4b","done":true,"done_reason":"stop","message":{"role":"assistant","content":"checked"},"prompt_eval_count":32768,"eval_count":4096}`))
	}))
	defer server.Close()
	model := newCortexPlanningModel()
	model.endpoint = server.URL
	model.check = func(context.Context) error { return nil }
	request := &llm.Request{Model: "demo-local", System: cortexPlanningProducerRole + " Bounded host instructions", Messages: []llm.Message{{Role: "user", Content: "record"}}, MaxTokens: 4096}
	response, err := model.Complete(t.Context(), request)
	cortexPlanningNoError(t, err)
	cortexPlanningEqual(t, cortexPlanningCallTokens, response.Usage.TotalTokens)
	request.System = strings.Repeat("x", cortexOptimizationContext)
	_, err = model.Complete(t.Context(), request)
	if err == nil {
		t.Fatal("oversized prompt admitted")
	}
	cortexPlanningEqual(t, 1, calls)
}
