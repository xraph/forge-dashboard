package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"encoding/json"
	"strings"

	"github.com/xraph/cortex/event"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/run"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/learning"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/safety"
	"github.com/xraph/cortex/safety/rules"
	"github.com/xraph/cortex/verification"

	"github.com/xraph/cortex"
)

func TestCortexVerificationOptIn(t *testing.T) {
	t.Setenv("DEMO_CORTEX_VERIFICATION", "false")
	host, err := configureCortexDemoVerification(nil, cortex.Scope{}, "")
	if err != nil || host != nil {
		t.Fatalf("disabled verification changed host: %v", err)
	}
	t.Setenv("DEMO_CORTEX_VERIFICATION", "true")
	t.Setenv("DEMO_CORTEX_PROVIDER", "deterministic")
	if _, err = configureCortexDemoVerification(nil, cortex.Scope{}, ""); err == nil {
		t.Fatal("deterministic provider admitted as local model qualification")
	}
}

// This client tests host mechanics only. The installed qualification uses Ollama.
type cortexVerificationFixtureLLM struct {
	output string
	calls  int
}

func (c *cortexVerificationFixtureLLM) Complete(context.Context, *llm.Request) (*llm.Response, error) {
	c.calls++
	return &llm.Response{Content: c.output, FinishReason: "stop", Usage: llm.Usage{TotalTokens: 21}}, nil
}
func (c *cortexVerificationFixtureLLM) CompleteStream(ctx context.Context, r *llm.Request) (llm.Stream, error) {
	response, err := c.Complete(ctx, r)
	if err != nil {
		return nil, err
	}
	return &cortexDemoStream{response: response, words: []string{response.Content}}, nil
}
func cortexVerificationFixture(t *testing.T, output string, adapt ...func(*cortexDemoVerificationHost) verification.EvaluationAdapter) (*cortexDemoVerificationHost, *engine.Engine, context.Context, *agent.Config, *cortexVerificationFixtureLLM, string) {
	t.Helper()
	t.Setenv("DEMO_CORTEX_VERIFICATION", "true")
	t.Setenv("DEMO_CORTEX_PROVIDER", "ollama")
	t.Setenv("DEMO_CORTEX_RECORD_REVISION", "")
	t.Setenv("DEMO_CORTEX_AUTHORITY_REVISION", "")
	file := filepath.Join(t.TempDir(), "verified.db")
	base := cortexTestEngine(t, file)
	scope := cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-northwind"}, {Key: "app", Value: "cortex"}}}
	host, err := configureCortexDemoVerification(base.Store(), scope, file)
	if err != nil {
		t.Fatal(err)
	}
	if err = host.Activate(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx := cortex.WithPrincipal(cortex.WithScope(context.Background(), scope), dc.Principal{User: &dashauth.UserInfo{Subject: "operator", ProviderName: "local-development", Scopes: []string{"cortex.read", "cortex.run", "cortex.manage", "cortex.approve"}}, Claims: map[string]any{"cortex_demo_scope": scope.Canonical()}})
	client := &cortexVerificationFixtureLLM{output: output}
	scanner, err := rules.New(rules.Config{Revision: "local-publication-1", MaxBytes: 1 << 20, Rules: []rules.Rule{{ID: "credential", Pattern: "SECRET", Decision: safety.DecisionBlock}}})
	if err != nil {
		t.Fatal(err)
	}
	options := []engine.Option{engine.WithStore(base.Store()), engine.WithLLM(client), engine.WithModelRevision("demo-local", host.authority.ModelRevision), engine.WithSafety(scanner), engine.WithPublicationGate(safety.ScannerGate{Scanner: scanner}), engine.WithPublicationPolicy(safety.Policy{Version: 1, Required: true, Mode: safety.ModeBuffered})}
	options = append(options, host.Options...)
	if len(adapt) > 0 {
		options = append(options, engine.WithVerificationWorker(engine.VerificationWorkerConfig{Adapter: adapt[0](host), Authorizer: host, Fence: host, Clock: host}))
	}
	eng, err := engine.New(options...)
	if err != nil {
		t.Fatal(err)
	}
	ag := &agent.Config{ID: id.NewAgentID(), Name: "verified-record", Model: "demo-local", MaxSteps: 2, MaxTokens: 1024}
	if err = eng.CreateAgent(ctx, ag); err != nil {
		t.Fatal(err)
	}
	return host, eng, ctx, ag, client, file
}
func TestCortexVerificationRealStorePublication(t *testing.T) {
	output := `{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1"}`
	host, eng, ctx, ag, client, _ := cortexVerificationFixture(t, output)
	budget, err := host.Budget(ctx, ag)
	if err != nil {
		t.Fatal(err)
	}
	result, err := eng.RunAgent(ctx, ag.Name, cortexVerificationPositive, &engine.RunOverrides{Budget: &budget})
	if err != nil {
		t.Fatalf("run failed: %v result=%+v calls=%d", err, result, client.calls)
	}
	if result.VerificationStatus != verification.StatusPassed || result.ResultRef == "" || client.calls != 1 {
		t.Fatalf("verification: %+v calls %d", result, client.calls)
	}
	published, err := eng.ReadResultContent(ctx, verification.ResultContentRequest{SchemaVersion: 1, RunID: result.ID, ResultID: id.MustParse(result.ResultRef)})
	if err != nil {
		t.Fatal(err)
	}
	if published.Content != output || published.VerificationStatus != verification.StatusPassed {
		t.Fatalf("publication: %+v", published)
	}
	page, err := eng.ReadPublicEvents(ctx, event.ReadRequest{After: event.Cursor{SchemaVersion: 1, RunID: result.ID}, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(page)
	if err != nil || strings.Contains(string(body), output) || len(page.Events) == 0 {
		t.Fatalf("invalid metadata replay: %s %v", body, err)
	}
	if _, err = eng.ReadPublicEvents(cortex.WithPrincipal(ctx, nil), event.ReadRequest{After: event.Cursor{SchemaVersion: 1, RunID: result.ID}, Limit: 100}); !errors.Is(err, event.ErrAccessDenied) {
		t.Fatalf("anonymous replay: %v", err)
	}
}

func TestCortexVerificationRejectsWrongAndAmbiguousRecords(t *testing.T) {
	for _, output := range []string{
		`{"record":"warehouse-7","units":18,"status":"reviewed","revision":"demo-record-v1"}`,
		`{"record":"warehouse-7","units":18,"units":17,"status":"reviewed","revision":"demo-record-v1"}`,
		`{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1","extra":true}`,
	} {
		t.Run(output, func(t *testing.T) {
			host, eng, ctx, ag, client, _ := cortexVerificationFixture(t, output)
			budget, err := host.Budget(ctx, ag)
			if err != nil {
				t.Fatal(err)
			}
			result, err := eng.RunAgent(ctx, ag.Name, cortexVerificationNegative, &engine.RunOverrides{Budget: &budget})
			if !errors.Is(err, cortex.ErrRunUnverified) || result == nil || result.Output != "" || result.ResultRef != "" || result.VerificationStatus != verification.StatusFailed || client.calls != 1 {
				t.Fatalf("invalid candidate published: %+v %v", result, err)
			}
		})
	}
}

type cortexLostEvaluation struct {
	host  *cortexDemoVerificationHost
	calls int
}

func (a *cortexLostEvaluation) Estimate(ctx context.Context, in verification.EvaluationInput) (verification.EvaluationAllowance, error) {
	return a.host.Estimate(ctx, in)
}
func (a *cortexLostEvaluation) Evaluate(ctx context.Context, d verification.EvaluationDispatch) (verification.CallResult, error) {
	a.calls++
	if _, err := a.host.Evaluate(ctx, d); err != nil {
		return verification.CallResult{}, err
	}
	return verification.CallResult{}, errors.New("lost acknowledgement")
}
func (a *cortexLostEvaluation) Reconcile(ctx context.Context, d verification.EvaluationDispatch) (verification.CallResult, error) {
	return a.host.Reconcile(ctx, d)
}
func TestCortexVerificationLostAcknowledgementAcrossRestart(t *testing.T) {
	output := `{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1"}`
	var adapter *cortexLostEvaluation
	host, eng, ctx, ag, client, file := cortexVerificationFixture(t, output, func(h *cortexDemoVerificationHost) verification.EvaluationAdapter {
		adapter = &cortexLostEvaluation{host: h}
		return adapter
	})
	budget, err := host.Budget(ctx, ag)
	if err != nil {
		t.Fatal(err)
	}
	result, err := eng.RunAgent(ctx, ag.Name, cortexVerificationPositive, &engine.RunOverrides{Budget: &budget})
	if !errors.Is(err, cortex.ErrVerificationUnavailable) || result == nil || result.Output != "" {
		t.Fatalf("lost acknowledgement: %+v %v", result, err)
	}
	intent, err := host.storage.GetRunCaptureIntent(ctx, result.ID)
	if err != nil {
		t.Fatal(err)
	}
	job, err := host.storage.GetVerificationJob(ctx, intent.Template.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(job.Calls) != 1 || job.Calls[0].Completion != nil || job.Lease == nil {
		t.Fatalf("missing unresolved dispatch: %+v", job)
	}
	key, err := cortexVerificationReportID(job.Request.ID)
	if err != nil {
		t.Fatal(err)
	}
	report, err := host.storage.GetReport(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if err = host.storage.Close(); err != nil {
		t.Fatal(err)
	}
	reopened := cortexTestEngine(t, file)
	fresh, err := configureCortexDemoVerification(reopened.Store(), host.scope, file)
	if err != nil {
		t.Fatal(err)
	}
	if err = fresh.Activate(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovery, err := engine.New(engine.WithStore(reopened.Store()), engine.WithVerificationWorker(engine.VerificationWorkerConfig{Adapter: fresh, Authorizer: fresh, Fence: fresh, Clock: fresh}))
	if err != nil {
		t.Fatal(err)
	}
	committed, err := recovery.VerifyRun(fresh.ServiceContext(context.Background()), engine.VerifyRunRequest{Job: job.Request, ResultID: intent.ResultID, Claim: verification.JobClaim{JobID: job.Request.ID, ClaimID: job.Lease.ClaimID, Owner: job.Lease.Owner, Duration: time.Minute}})
	if err != nil {
		t.Fatal(err)
	}
	if committed.Receipt == nil || client.calls != 1 || adapter.calls != 1 {
		t.Fatalf("recovery reran work or failed: %+v", committed)
	}
	saved, err := fresh.storage.GetVerificationJob(ctx, job.Request.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Calls) != 1 || saved.Calls[0].Completion.ReportDigest != report.Digest || saved.Calls[0].Request.ID != job.Calls[0].Request.ID {
		t.Fatalf("dispatch identity changed: %+v", saved)
	}
	again, err := fresh.storage.GetReport(ctx, key)
	if err != nil || again.Digest != report.Digest {
		t.Fatalf("report replaced: %+v %v", again, err)
	}
	savedRun, err := fresh.storage.GetRun(ctx, result.ID)
	if err != nil || savedRun.State != run.StateCompleted || savedRun.VerificationStatus != verification.StatusPassed {
		t.Fatalf("missing verified run: %+v %v", savedRun, err)
	}
}

func TestCortexVerificationAuthorityRotationAndReader(t *testing.T) {
	output := `{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1"}`
	host, eng, ctx, ag, _, file := cortexVerificationFixture(t, output)
	budget, err := host.Budget(ctx, ag)
	if err != nil {
		t.Fatal(err)
	}
	result, err := eng.RunAgent(ctx, ag.Name, cortexVerificationPositive, &engine.RunOverrides{Budget: &budget})
	if err != nil {
		t.Fatal(err)
	}
	request := verification.ResultContentRequest{SchemaVersion: 1, RunID: result.ID, ResultID: id.MustParse(result.ResultRef)}
	reader := cortex.WithPrincipal(ctx, dc.Principal{User: &dashauth.UserInfo{Subject: "reader", ProviderName: "local-development", Scopes: []string{"cortex.read"}}, Claims: map[string]any{"cortex_demo_scope": host.scope.Canonical()}})
	if _, err = eng.ReadResultContent(reader, request); err != nil {
		t.Fatal(err)
	}
	if _, err = host.Budget(reader, ag); !errors.Is(err, evidence.ErrDenied) {
		t.Fatalf("reader can run: %v", err)
	}
	if _, err = eng.ReadResultContent(cortex.WithPrincipal(ctx, nil), request); err == nil {
		t.Fatal("anonymous content read")
	}
	if err = host.authorizeService(cortex.WithScope(context.Background(), host.scope)); !errors.Is(err, evidence.ErrDenied) {
		t.Fatal("ordinary context became recovery authority")
	}
	t.Setenv("DEMO_CORTEX_RECORD_REVISION", "demo-record-v2")
	fresh, err := configureCortexDemoVerification(host.storage, host.scope, file)
	if err != nil {
		t.Fatal(err)
	}
	// Constructing a host cannot rotate authority before its engine starts.
	if _, err = eng.ReadResultContent(ctx, request); err != nil {
		t.Fatal(err)
	}
	intent, err := host.storage.GetRunCaptureIntent(ctx, result.ID)
	if err != nil {
		t.Fatal(err)
	}
	inside := make(chan struct{})
	release := make(chan struct{})
	fenced := make(chan error, 1)
	go func() {
		fenced <- host.WithCommitFence(ctx, intent.Template.Binding, func(verification.Binding) error { close(inside); <-release; return nil })
	}()
	<-inside
	short, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if err = fresh.Activate(short); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("rotation crossed active read fence: %v", err)
	}
	close(release)
	if err = <-fenced; err != nil {
		t.Fatal(err)
	}
	if err = fresh.Activate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err = eng.ReadResultContent(ctx, request); err == nil {
		t.Fatal("old source revision still published")
	}
	freshEngine, err := engine.New(engine.WithStore(host.storage), engine.WithPublicationGate(safety.ScannerGate{Scanner: cortexReplayScanner(t)}), engine.WithPublicationPolicy(safety.Policy{Version: 1, Required: true, Mode: safety.ModeBuffered}), engine.WithResultContent(engine.ResultContentConfig{Authorizer: fresh, Fence: fresh, Clock: fresh}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = freshEngine.ReadResultContent(ctx, request); !errors.Is(err, verification.ErrResultAccessDenied) {
		t.Fatalf("rotated source read lost access-denied classification: %v", err)
	}
	if err = host.authorizeService(host.ServiceContext(context.Background())); err == nil {
		t.Fatal("old process recovery still authorized")
	}
	if err = os.Chmod(host.authorityFile, 0644); err != nil {
		t.Fatal(err)
	}
	if err = fresh.currentAuthority(ctx); err == nil {
		t.Fatal("public authority file accepted")
	}
}

func TestCortexVerificationGovernedLesson(t *testing.T) {
	output := `{"record":"warehouse-7","units":17,"status":"reviewed","revision":"demo-record-v1"}`
	host, eng, ctx, ag, _, _ := cortexVerificationFixture(t, output)
	budget, err := host.Budget(ctx, ag)
	if err != nil {
		t.Fatal(err)
	}
	result, err := eng.RunAgent(ctx, ag.Name, cortexVerificationPositive, &engine.RunOverrides{Budget: &budget})
	if err != nil {
		t.Fatal(err)
	}
	source := verification.ResultContentRequest{SchemaVersion: 1, RunID: result.ID, ResultID: id.MustParse(result.ResultRef)}
	request := learning.AcceptRequest{ID: id.New(learning.PrefixLesson), Domain: "demo-record", Applicability: []string{"warehouse-7 at demo-record-v1"}, Contraindications: []string{"different revision"}, ExpiresAt: time.Now().Add(time.Minute), Actor: "operator"}
	accepted, err := host.Learning.AcceptResult(ctx, request, source)
	if err != nil {
		t.Fatal(err)
	}
	detail, err := host.Learning.Review(ctx, accepted.LessonID)
	if err != nil {
		t.Fatal(err)
	}
	lesson, err := host.Learning.Resolve(ctx, detail.Ref)
	if err != nil || lesson.Statement != output {
		t.Fatalf("governed resolve: %+v %v", lesson, err)
	}
	reader := cortex.WithPrincipal(ctx, dc.Principal{User: &dashauth.UserInfo{Subject: "reader", ProviderName: "local-development", Scopes: []string{"cortex.read"}}, Claims: map[string]any{"cortex_demo_scope": host.scope.Canonical()}})
	if _, err = host.Learning.AcceptResult(reader, request, source); !errors.Is(err, evidence.ErrDenied) {
		t.Fatalf("reader promoted a lesson: %v", err)
	}
	if _, err = host.Learning.Revoke(ctx, learning.RevokeRequest{ID: accepted.LessonID, ExpectedRevision: accepted.Revision, Actor: "operator", Reason: "withdrawn"}); err != nil {
		t.Fatal(err)
	}
	if _, err = host.Learning.Resolve(ctx, detail.Ref); err == nil {
		t.Fatal("revoked lesson resolved")
	}
}

func TestCortexVerificationFileRefusesAliasWithoutTruncating(t *testing.T) {
	directory := t.TempDir()
	source := filepath.Join(directory, "source")
	alias := filepath.Join(directory, "alias")
	if err := os.WriteFile(source, []byte("retained"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(source, alias); err != nil {
		t.Fatal(err)
	}
	if f, err := openCortexVerificationFile(alias, os.O_WRONLY|os.O_TRUNC); err == nil {
		_ = f.Close()
		t.Fatal("hardlink accepted")
	}
	body, err := os.ReadFile(source)
	if err != nil || string(body) != "retained" {
		t.Fatalf("denied open changed bytes: %q %v", body, err)
	}
	link := filepath.Join(directory, "symlink")
	if err = os.Symlink(source, link); err != nil {
		t.Fatal(err)
	}
	if f, err := openCortexVerificationFile(link, os.O_RDONLY); err == nil {
		_ = f.Close()
		t.Fatal("symlink accepted")
	}
}

func cortexReplayScanner(t *testing.T) safety.Scanner {
	t.Helper()
	scanner, err := rules.New(rules.Config{Revision: "local-publication-1", MaxBytes: 1 << 20, Rules: []rules.Rule{{ID: "credential", Pattern: "SECRET", Decision: safety.DecisionBlock}}})
	if err != nil {
		t.Fatal(err)
	}
	return scanner
}
