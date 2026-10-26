package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/event"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/learning"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/store"
	"github.com/xraph/cortex/verification"
)

const cortexVerificationRevision = "local-record-check-v1"
const cortexVerificationPositive = "/no_think Warehouse record warehouse-7 has two bins containing 11 units and 6 units. Add both counts (11 + 6) for units. Its status is reviewed and its revision is demo-record-v1. Return only a JSON object with record, units, status and revision. Use no tools. /no_think"
const cortexVerificationNegative = "/no_think For a negative validation test, return only this JSON: {\"record\":\"warehouse-7\",\"units\":18,\"status\":\"reviewed\",\"revision\":\"demo-record-v1\"}. Use no tools. /no_think"

type cortexVerificationStore interface {
	store.Store
	evidence.Storage
	verification.Store
	verification.CaptureIntentStore
	verification.JobStore
	verification.ResultContentStore
	coordination.VerificationJobDiscoveryStore
	learning.Repository
}

type cortexVerificationRecord struct {
	Record   string `json:"record"`
	Units    int    `json:"units"`
	Status   string `json:"status"`
	Revision string `json:"revision"`
}
type cortexVerificationAuthority struct {
	Version           int                      `json:"version"`
	Scope             cortex.Scope             `json:"scope"`
	Record            cortexVerificationRecord `json:"record"`
	AuthorityRevision string                   `json:"authority_revision"`
	PolicyRevision    string                   `json:"policy_revision"`
	ModelRevision     string                   `json:"model_revision"`
}
type cortexVerificationServiceKey struct{}

type cortexDemoVerificationHost struct {
	Options        []engine.Option
	Learning       *learning.Guard
	AdaptiveReview *engine.AdaptiveReviewer
	storage        cortexVerificationStore
	repository     evidence.Repository
	scope          cortex.Scope
	authority      cortexVerificationAuthority
	authorityFile  string
	contract       verification.Contract
}

func configureCortexDemoVerification(storage store.Store, scope cortex.Scope, databasePath string) (*cortexDemoVerificationHost, error) {
	if !envBool("DEMO_CORTEX_VERIFICATION", false) {
		return nil, nil
	}
	if os.Getenv("DEMO_CORTEX_PROVIDER") != "ollama" || cortex.ValidateScope(scope) != nil || databasePath == "" {
		return nil, errors.New("verified demo requires the installed Ollama provider, exact scope and disk store")
	}
	durable, ok := storage.(cortexVerificationStore)
	if !ok {
		return nil, errors.New("verified demo store capabilities unavailable")
	}
	absolute, err := filepath.Abs(databasePath)
	if err != nil {
		return nil, err
	}
	directory, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if err != nil {
		return nil, err
	}
	if checkErr := validateCortexVerificationDirectory(directory); checkErr != nil {
		return nil, checkErr
	}
	revision := os.Getenv("DEMO_CORTEX_RECORD_REVISION")
	if revision == "" {
		revision = "demo-record-v1"
	}
	if len(revision) > 128 || strings.TrimSpace(revision) != revision || strings.ContainsAny(revision, "\x00\r\n") {
		return nil, errors.New("invalid local record revision")
	}
	authorityRevision := os.Getenv("DEMO_CORTEX_AUTHORITY_REVISION")
	if authorityRevision == "" {
		authorityRevision = "local-demo-operator-v1"
	}
	if len(authorityRevision) > 128 || strings.TrimSpace(authorityRevision) != authorityRevision || strings.ContainsAny(authorityRevision, "\x00\r\n") {
		return nil, errors.New("invalid local authority revision")
	}
	scope.Levels = append([]cortex.Level(nil), scope.Levels...)
	h := &cortexDemoVerificationHost{storage: durable, scope: scope, authorityFile: filepath.Join(directory, filepath.Base(absolute)+".verification-authority.json")}
	h.authority = cortexVerificationAuthority{Version: 1, Scope: scope, Record: cortexVerificationRecord{Record: "warehouse-7", Units: 17, Status: "reviewed", Revision: revision}, AuthorityRevision: authorityRevision, PolicyRevision: "local-publication-1", ModelRevision: "ollama/qwen3:4b/" + cortexLocalDigest}
	h.contract, err = verification.SealContract(verification.Contract{SchemaVersion: 1, ID: id.MustParse("vcontract_00000000000000000000000001"), Scope: scope, Revision: cortexVerificationRevision, Objective: "Return the exact current structured warehouse record", Criteria: []verification.Criterion{
		{ID: "schema", Kind: verification.KindSchema, Required: true, Verifier: "local-record", VerifierRevision: cortexVerificationRevision, Parameters: verification.Parameters{ManifestRevision: "record-schema-v1"}, MaxAge: 15 * time.Minute, MinEvidence: 1},
		{ID: "expected-record", Kind: verification.KindSemantic, Required: true, Verifier: "local-record", VerifierRevision: cortexVerificationRevision, Parameters: verification.Parameters{ManifestRevision: "record-value-v1"}, MaxAge: 15 * time.Minute, MinEvidence: 1},
		{ID: "captured-context", Kind: verification.KindPolicy, Required: true, Verifier: "local-record", VerifierRevision: cortexVerificationRevision, Parameters: verification.Parameters{ManifestRevision: "record-context-v1"}, MaxAge: 15 * time.Minute, MinEvidence: 1},
	}})
	if err != nil {
		return nil, err
	}
	setupCtx := cortex.WithScope(context.Background(), scope)
	if checkErr := durable.CreateContract(setupCtx, h.contract); checkErr != nil {
		return nil, checkErr
	}
	h.repository, err = evidence.NewRepository(durable, h, 1<<20)
	if err != nil {
		return nil, err
	}
	h.Learning, err = learning.NewGuard(learning.GuardConfig{Repository: durable, Results: durable, ContentAuthority: h, Authority: h, Fence: h, Clock: h})
	if err != nil {
		return nil, err
	}
	h.AdaptiveReview, err = engine.NewAdaptiveReviewer(engine.AdaptiveReviewConfig{Store: storage, Evidence: h.repository, Authority: h})
	if err != nil {
		return nil, err
	}
	source, err := coordination.NewScopedVerificationSource(durable, []cortex.Scope{scope}, func(ctx context.Context, s cortex.Scope) error {
		if s.Canonical() != h.scope.Canonical() {
			return evidence.ErrDenied
		}
		return h.authorizeService(ctx)
	})
	if err != nil {
		return nil, err
	}
	h.Options = []engine.Option{
		engine.WithToolAuthorizer(cortexVerificationTools{h}),
		engine.WithPublicEventReplay(h),
		engine.WithVerificationWorker(engine.VerificationWorkerConfig{Adapter: h, Authorizer: h, Fence: h, Clock: h}),
		engine.WithRequiredVerification(engine.RequiredVerificationConfig{Revision: h.authority.PolicyRevision, ContractID: h.contract.ID, EvaluationBudget: verification.EvaluationBudget{MaxCalls: 1, TokenOnly: true}, Builder: h, CaptureAuthorizer: h, HandoffAuthorizer: h, WorkerOwner: "local-record-worker", LeaseDuration: time.Minute}),
		engine.WithResultContent(engine.ResultContentConfig{Authorizer: h, Fence: h, Clock: h}),
		engine.WithVerificationRecovery(engine.VerificationRecoveryConfig{Service: coordination.VerificationRecoveryConfig{Discovery: source, Interval: time.Second, DiscoveryTimeout: 5 * time.Second, AttemptTimeout: 10 * time.Second, MaxInFlight: 1, MaxPerScope: 1}, Authorize: func(ctx context.Context, _ id.ID) error { return h.authorizeService(ctx) }, Owner: "local-record-recovery", LeaseDuration: time.Minute}),
	}
	return h, nil
}

func (h *cortexDemoVerificationHost) Now() time.Time { return time.Now().UTC() }
func (h *cortexDemoVerificationHost) ServiceContext(ctx context.Context) context.Context {
	return context.WithValue(cortex.WithScope(ctx, h.scope), cortexVerificationServiceKey{}, h)
}
func (h *cortexDemoVerificationHost) Budget(ctx context.Context, ag *agent.Config) (execution.Budget, error) {
	if _, err := h.authorizeUser(ctx, "run"); err != nil {
		return execution.Budget{}, err
	}
	steps, tokens := ag.MaxSteps, ag.MaxTokens
	if steps <= 0 {
		steps = 3
	}
	if tokens <= 0 {
		tokens = 4096
	}
	return execution.Budget{MaxSteps: min(steps, 3), MaxTokens: min(tokens, 4096), MaxToolCalls: 1, Deadline: h.Now().Add(5 * time.Minute)}, nil
}

func (h *cortexDemoVerificationHost) Activate(ctx context.Context) (resultErr error) {
	unlock, err := lockCortexVerification(ctx, h.authorityFile+".lock", true)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	body, err := json.Marshal(h.authority)
	if err != nil {
		return err
	}
	existing, err := h.readAuthority()
	if err == nil && reflect.DeepEqual(existing, h.authority) {
		return nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := openCortexVerificationFile(h.authorityFile, os.O_CREATE|os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, f.Close()) }()
	if _, err = f.Write(body); err != nil {
		return err
	}
	return f.Sync()
}
func (h *cortexDemoVerificationHost) readAuthority() (cortexVerificationAuthority, error) {
	var zero cortexVerificationAuthority
	f, err := openCortexVerificationFile(h.authorityFile, os.O_RDONLY)
	if err != nil {
		return zero, err
	}
	body, readErr := io.ReadAll(io.LimitReader(f, 16385))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil {
		return zero, errors.Join(readErr, closeErr)
	}
	var a cortexVerificationAuthority
	if len(body) > 16384 || json.Unmarshal(body, &a) != nil || a.Version != 1 || a.Scope.Canonical() != h.scope.Canonical() {
		return zero, evidence.ErrDenied
	}
	canonical, err := json.Marshal(a)
	if err != nil || !bytes.Equal(canonical, body) {
		return zero, evidence.ErrDenied
	}
	return a, nil
}
func (h *cortexDemoVerificationHost) currentAuthority(ctx context.Context) (resultErr error) {
	unlock, err := lockCortexVerification(ctx, h.authorityFile+".lock", false)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	current, err := h.readAuthority()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, h.authority) {
		return evidence.ErrDenied
	}
	return ctx.Err()
}
func (h *cortexDemoVerificationHost) authorizeUser(ctx context.Context, permission string) (string, error) {
	if cortex.ScopeFromContext(ctx).Canonical() != h.scope.Canonical() {
		return "", evidence.ErrDenied
	}
	principal, ok := cortex.PrincipalFromContext(ctx).(dc.Principal)
	if !ok || principal.User == nil || !principal.User.Authenticated() || !principal.User.HasScope("cortex."+permission) || principal.Claims["cortex_demo_scope"] != h.scope.Canonical() {
		return "", evidence.ErrDenied
	}
	if err := h.currentAuthority(ctx); err != nil {
		return "", err
	}
	return principal.User.Subject, nil
}
func (h *cortexDemoVerificationHost) authorizeService(ctx context.Context) error {
	if ctx.Value(cortexVerificationServiceKey{}) != h || cortex.ScopeFromContext(ctx).Canonical() != h.scope.Canonical() {
		return evidence.ErrDenied
	}
	return h.currentAuthority(ctx)
}
func (h *cortexDemoVerificationHost) AuthorizeEvidence(ctx context.Context, action evidence.Action, ref evidence.Ref) error {
	if ref.Validate() != nil || ref.Scope.Canonical() != h.scope.Canonical() || ref.Producer != "local-record-host/v1" || !h.Now().Before(ref.RetainUntil) {
		return evidence.ErrDenied
	}
	if action == evidence.ActionRead && ctx.Value(cortexVerificationServiceKey{}) == h {
		return h.authorizeService(ctx)
	}
	permission := "read"
	if action == evidence.ActionPut {
		permission = "run"
	} else if action != evidence.ActionRead {
		return evidence.ErrDenied
	}
	_, err := h.authorizeUser(ctx, permission)
	return err
}
func (h *cortexDemoVerificationHost) authorizeBinding(ctx context.Context, b verification.Binding, permission string) error {
	if b.Validate() != nil || b.Scope.Canonical() != h.scope.Canonical() || b.ContractDigest != h.contract.Digest || b.Context.AuthorityRevision != h.authority.AuthorityRevision || b.Context.PolicyRevision != h.authority.PolicyRevision || b.Context.EnvironmentRevision != h.authority.ModelRevision || b.Context.DatasetRevision != h.authority.Record.Revision || b.Context.ExecutionInputs == nil || len(b.Context.Sources) != 1 || len(b.Context.Tools) != 0 {
		return evidence.ErrDenied
	}
	source := b.Context.Sources[0]
	body, err := json.Marshal(h.authority.Record)
	if err != nil {
		return err
	}
	if source.Resource != "demo:warehouse-7" || source.Revision != h.authority.Record.Revision || source.Digest != evidence.Digest(body) {
		return evidence.ErrDenied
	}
	if ctx.Value(cortexVerificationServiceKey{}) == h {
		return h.authorizeService(ctx)
	}
	_, err = h.authorizeUser(ctx, permission)
	return err
}
func (h *cortexDemoVerificationHost) AuthorizeVerification(ctx context.Context, b verification.Binding) error {
	if err := h.authorizeBinding(ctx, b, "run"); err != nil {
		return err
	}
	if ctx.Value(cortexVerificationServiceKey{}) == h {
		return nil
	}
	actor, err := h.authorizeUser(ctx, "run")
	if err != nil {
		return err
	}
	if actor != b.Context.PrincipalRef {
		return evidence.ErrDenied
	}
	return nil
}
func (h *cortexDemoVerificationHost) AgentMutationFence(ctx context.Context, apply func(context.Context) error) (resultErr error) {
	unlock, err := lockCortexVerification(ctx, h.authorityFile+".lock", true)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	// Avoid taking a second shared flock while this writer owns the exclusive lock.
	current, err := h.readAuthority()
	if err != nil {
		return err
	}
	if !reflect.DeepEqual(current, h.authority) {
		return evidence.ErrDenied
	}
	principal, ok := cortex.PrincipalFromContext(ctx).(dc.Principal)
	if !ok || principal.User == nil || !principal.User.Authenticated() || !principal.User.HasScope("cortex.manage") || principal.Claims["cortex_demo_scope"] != h.scope.Canonical() || cortex.ScopeFromContext(ctx).Canonical() != h.scope.Canonical() {
		return evidence.ErrDenied
	}
	if checkErr := ctx.Err(); checkErr != nil {
		return checkErr
	}
	return apply(ctx)
}
func (h *cortexDemoVerificationHost) WithCommitFence(ctx context.Context, b verification.Binding, apply func(verification.Binding) error) (resultErr error) {
	unlock, err := lockCortexVerification(ctx, h.authorityFile+".lock", false)
	if err != nil {
		return err
	}
	defer func() { resultErr = errors.Join(resultErr, unlock()) }()
	if checkErr := h.authorizeBinding(ctx, b, "read"); checkErr != nil {
		if errors.Is(checkErr, evidence.ErrDenied) {
			return errors.Join(verification.ErrResultAccessDenied, checkErr)
		}
		return checkErr
	}
	return apply(b)
}
func (h *cortexDemoVerificationHost) AuthorizeToolHandoff(ctx context.Context, _ cortex.Subject) error {
	_, err := h.authorizeUser(ctx, "approve")
	return err
}
func (h *cortexDemoVerificationHost) AuthorizePublicReplay(ctx context.Context, runID id.AgentRunID) error {
	if runID.IsNil() || runID.Prefix() != id.PrefixAgentRun {
		return event.ErrInvalid
	}
	if _, err := h.authorizeUser(ctx, "read"); err != nil {
		return errors.Join(event.ErrAccessDenied, err)
	}
	saved, err := h.storage.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	if saved == nil || saved.ID != runID || saved.Scope.Canonical() != h.scope.Canonical() {
		return event.ErrAccessDenied
	}
	if _, err = h.authorizeUser(ctx, "read"); err != nil {
		return errors.Join(event.ErrAccessDenied, err)
	}
	return nil
}
func (h *cortexDemoVerificationHost) AuthorizeResultContent(ctx context.Context, r verification.ResultContentRequest) error {
	if r.Validate() != nil {
		return verification.ErrInvalid
	}
	_, err := h.authorizeUser(ctx, "read")
	return err
}
func (h *cortexDemoVerificationHost) AuthorizeLesson(ctx context.Context, action learning.Action, r learning.Resource) error {
	if r.Scope.Canonical() != h.scope.Canonical() || (r.Domain != "" && r.Domain != "demo-record") {
		return evidence.ErrDenied
	}
	permission := "read"
	if action != learning.ActionRead {
		permission = "manage"
	}
	_, err := h.authorizeUser(ctx, permission)
	return err
}
func (h *cortexDemoVerificationHost) AuthorizeAdaptiveReview(ctx context.Context, r engine.AdaptiveReviewResource) error {
	if r.Scope.Canonical() != h.scope.Canonical() {
		return evidence.ErrDenied
	}
	if _, err := h.authorizeUser(ctx, "read"); err != nil {
		return err
	}
	for _, ref := range r.References {
		if err := h.AuthorizeEvidence(ctx, evidence.ActionRead, ref); err != nil {
			return err
		}
	}
	return nil
}

type cortexVerificationTools struct{ host *cortexDemoVerificationHost }

func (cortexVerificationTools) Visible(context.Context, cortex.Subject, []llm.Tool) []llm.Tool {
	return nil
}
func (cortexVerificationTools) Authorize(context.Context, cortex.Subject, llm.ToolCall) error {
	return evidence.ErrDenied
}

func (h *cortexDemoVerificationHost) newRef(media string) evidence.Ref {
	now := h.Now()
	return evidence.Ref{SchemaVersion: 1, ID: id.New(evidence.PrefixArtifact), SHA256: evidence.Digest(nil), MediaType: media, Scope: h.scope, Version: "1", Producer: "local-record-host/v1", Sensitivity: evidence.SensitivityRestricted, CreatedAt: now, RetainUntil: now.Add(24 * time.Hour)}
}
func (h *cortexDemoVerificationHost) BuildVerificationIntent(ctx context.Context, in engine.VerificationIntentInput) (verification.CaptureIntent, error) {
	var zero verification.CaptureIntent
	actor, err := h.authorizeUser(ctx, "run")
	if err != nil {
		return zero, err
	}
	if in.Scope.Canonical() != h.scope.Canonical() || in.Inputs.Model != "demo-local" || in.Inputs.ModelRevision != h.authority.ModelRevision || len(in.Inputs.Tools) != 0 || len(in.Inputs.History) != 0 || (in.Inputs.Input != cortexVerificationPositive && in.Inputs.Input != cortexVerificationNegative) {
		return zero, verification.ErrInvalid
	}
	body, err := json.Marshal(h.authority.Record)
	if err != nil {
		return zero, err
	}
	source, err := evidence.Seal(evidence.Artifact{Ref: h.newRef("application/json"), Data: body})
	if err != nil {
		return zero, err
	}
	source.Ref.SourceURI = "demo:warehouse-7"
	if _, err = h.repository.Put(ctx, source); err != nil {
		return zero, err
	}
	inputs, err := in.Inputs.Encode()
	if err != nil {
		return zero, err
	}
	captured, err := evidence.Seal(evidence.Artifact{Ref: h.newRef("application/json"), Data: inputs})
	if err != nil {
		return zero, err
	}
	candidate, transcript := h.newRef("text/plain"), h.newRef("application/json")
	binding := verification.Binding{Scope: h.scope, RunID: in.RunID, ContractDigest: h.contract.Digest, Candidate: candidate, Evidence: []evidence.Ref{source.Ref, captured.Ref}, Context: verification.ContextSnapshot{ExecutionInputs: &captured.Ref, PrincipalRef: actor, AuthorityRevision: h.authority.AuthorityRevision, PreparedDigest: in.PreparedDigest, PolicyRevision: h.authority.PolicyRevision, EnvironmentRevision: h.authority.ModelRevision, DatasetRevision: h.authority.Record.Revision, Sources: []verification.Source{{Resource: "demo:warehouse-7", Revision: h.authority.Record.Revision, Digest: source.Ref.SHA256, RetrievedAt: source.Ref.CreatedAt}}}}
	return verification.SealCaptureIntent(verification.CaptureIntent{SchemaVersion: 2, ID: id.New(verification.PrefixCaptureIntent), Template: verification.JobRequest{SchemaVersion: 1, ID: id.New(verification.PrefixJob), ContractID: h.contract.ID, Binding: binding, ExpectedRunRevision: 1, MaxAttempts: 3, Deadline: in.Deadline, EvaluationBudget: &verification.EvaluationBudget{MaxCalls: 1, TokenOnly: true}}, ResultID: id.New(verification.PrefixResult), MaxCandidateBytes: 4096, Transcript: &transcript, MaxTranscriptBytes: 1 << 20})
}

func (h *cortexDemoVerificationHost) readEvidence(ctx context.Context, ref evidence.Ref) ([]byte, error) {
	reader, err := h.repository.Open(ctx, ref)
	if err != nil {
		return nil, err
	}
	body, readErr := io.ReadAll(io.LimitReader(reader, (1<<20)+1))
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil {
		return nil, errors.Join(readErr, closeErr)
	}
	if len(body) > 1<<20 {
		return nil, evidence.ErrTooLarge
	}
	return body, nil
}
func cortexVerificationReportID(job id.ID) (id.ID, error) {
	if job.Prefix() != verification.PrefixJob {
		return id.ID{}, verification.ErrInvalid
	}
	return id.Parse("vreport_" + strings.SplitN(job.String(), "_", 2)[1])
}

func (h *cortexDemoVerificationHost) validateEvaluationInput(ctx context.Context, in verification.EvaluationInput) error {
	if err := h.AuthorizeVerification(ctx, in.Request.Binding); err != nil {
		return err
	}
	if in.Request.Contract.Validate() != nil || in.Request.Contract.Digest != h.contract.Digest || in.Budget.Validate() != nil || !h.Now().Before(in.Request.Deadline) {
		return verification.ErrInvalid
	}
	job, err := h.storage.GetVerificationJob(ctx, in.JobID)
	if err != nil {
		return err
	}
	actual, err := in.Request.Binding.Digest()
	if err != nil {
		return err
	}
	expected, err := job.Request.Binding.Digest()
	if err != nil {
		return err
	}
	if actual != expected || job.Request.ContractID != h.contract.ID || !job.Request.Deadline.Equal(in.Request.Deadline) || job.Request.EvaluationBudget == nil || *job.Request.EvaluationBudget != in.Budget {
		return verification.ErrInvalid
	}
	return nil
}

// Estimate performs bounded local byte validation and retains its report before
// dispatch admission. It calls no provider or tool and consumes no model tokens.
func (h *cortexDemoVerificationHost) Estimate(ctx context.Context, in verification.EvaluationInput) (verification.EvaluationAllowance, error) {
	if err := h.validateEvaluationInput(ctx, in); err != nil {
		return verification.EvaluationAllowance{}, err
	}
	if in.Request.Contract.Digest != h.contract.Digest || in.Request.Verifier != "local-record" || in.Request.VerifierRevision != cortexVerificationRevision {
		return verification.EvaluationAllowance{}, verification.ErrInvalid
	}
	key, err := cortexVerificationReportID(in.JobID)
	if err != nil {
		return verification.EvaluationAllowance{}, err
	}
	existing, err := h.storage.GetReport(ctx, key)
	if err == nil {
		if checkErr := h.validateReport(in, existing); checkErr != nil {
			return verification.EvaluationAllowance{}, checkErr
		}
		return verification.EvaluationAllowance{}, nil
	}
	if !errors.Is(err, verification.ErrNotFound) {
		return verification.EvaluationAllowance{}, err
	}
	report, err := h.checkCapturedRecord(ctx, in, key)
	if err != nil {
		return verification.EvaluationAllowance{}, err
	}
	if checkErr := h.storage.SaveReport(ctx, report); checkErr != nil {
		return verification.EvaluationAllowance{}, checkErr
	}
	return verification.EvaluationAllowance{}, nil
}
func (h *cortexDemoVerificationHost) validateReport(in verification.EvaluationInput, r verification.Report) error {
	key, keyErr := cortexVerificationReportID(in.JobID)
	if keyErr != nil || r.ID != key || in.Request.Contract.Validate() != nil || in.Request.Contract.Digest != h.contract.Digest || in.Request.Verifier != "local-record" || in.Request.VerifierRevision != cortexVerificationRevision {
		return verification.ErrInvalid
	}
	actual, err := r.Binding.Digest()
	if err != nil {
		return err
	}
	expected, err := in.Request.Binding.Digest()
	if err != nil {
		return err
	}
	if verification.ValidateReportForContract(h.contract, r) != nil || actual != expected || !h.Now().Before(r.ExpiresAt) || !r.ExpiresAt.Equal(in.Request.Deadline) || len(r.Outcomes) != 3 {
		return verification.ErrInvalid
	}
	for _, outcome := range r.Outcomes {
		if outcome.Verifier != "local-record" || outcome.VerifierRevision != cortexVerificationRevision {
			return verification.ErrInvalid
		}
	}
	return nil
}
func (h *cortexDemoVerificationHost) Evaluate(ctx context.Context, d verification.EvaluationDispatch) (verification.CallResult, error) {
	return h.Reconcile(ctx, d)
}
func (h *cortexDemoVerificationHost) Reconcile(ctx context.Context, d verification.EvaluationDispatch) (verification.CallResult, error) {
	if err := h.validateEvaluationInput(ctx, d.Input); err != nil {
		return verification.CallResult{}, err
	}
	job, err := h.storage.GetVerificationJob(ctx, d.Input.JobID)
	if err != nil {
		return verification.CallResult{}, err
	}
	admitted := false
	for _, call := range job.Calls {
		if call.Request == d.Call.Request && call.Generation == d.Call.Generation && reflect.DeepEqual(call.CriterionIDs, d.Call.CriterionIDs) && call.StartedAt.Equal(d.Call.StartedAt) {
			admitted = true
			break
		}
	}
	if !admitted {
		return verification.CallResult{}, verification.ErrInvalid
	}
	key, err := cortexVerificationReportID(d.Input.JobID)
	if err != nil {
		return verification.CallResult{}, err
	}
	report, err := h.storage.GetReport(ctx, key)
	if errors.Is(err, verification.ErrNotFound) {
		return verification.CallResult{}, verification.ErrCallUncertain
	}
	if err != nil {
		return verification.CallResult{}, err
	}
	if checkErr := h.validateReport(d.Input, report); checkErr != nil {
		return verification.CallResult{}, checkErr
	}
	if d.Call.Request.Validate() != nil || !reflect.DeepEqual(d.Call.CriterionIDs, []string{"schema", "expected-record", "captured-context"}) || d.Call.Request.Verifier != "local-record" || d.Call.Request.VerifierRevision != cortexVerificationRevision || d.Call.Request.MaxTokens != 0 || d.Call.Request.MaxUSDMicros != 0 {
		return verification.CallResult{}, verification.ErrInvalid
	}
	return verification.CallResult{CallID: d.Call.Request.ID, Report: &report, Usage: verification.EvaluationUsage{TokensKnown: true, MoneyKnown: true, Receipt: "local-byte-validation:" + d.Call.Request.ID.String() + ":" + report.Digest}}, nil
}
func (h *cortexDemoVerificationHost) checkCapturedRecord(ctx context.Context, in verification.EvaluationInput, key id.ID) (verification.Report, error) {
	var zero verification.Report
	b := in.Request.Binding
	candidate, err := h.readEvidence(ctx, b.Candidate)
	if err != nil {
		return zero, err
	}
	parsed, schemaOK := decodeCortexVerificationRecord(candidate)
	expected := schemaOK && parsed == h.authority.Record
	contextOK := false
	if b.Context.ExecutionInputs != nil {
		body, readErr := h.readEvidence(ctx, *b.Context.ExecutionInputs)
		if readErr != nil {
			return zero, readErr
		}
		inputs, decodeErr := verification.DecodeExecutionInputs(body)
		contextOK = decodeErr == nil && inputs.RunID == b.RunID && inputs.PreparedDigest == b.Context.PreparedDigest && inputs.Model == "demo-local" && inputs.ModelRevision == h.authority.ModelRevision && len(inputs.History) == 0 && len(inputs.Tools) == 0 && (inputs.Input == cortexVerificationPositive || inputs.Input == cortexVerificationNegative)
	}
	sourceFound := false
	for _, ref := range b.Evidence {
		if ref.SourceURI == "demo:warehouse-7" {
			body, readErr := h.readEvidence(ctx, ref)
			if readErr != nil {
				return zero, readErr
			}
			source, valid := decodeCortexVerificationRecord(body)
			sourceFound = valid && source == h.authority.Record && ref.SHA256 == b.Context.Sources[0].Digest
		}
	}
	contextOK = contextOK && sourceFound
	outcomes := []verification.Outcome{}
	for i, ok := range []bool{schemaOK, expected, contextOK} {
		status := verification.StatusFailed
		if ok {
			status = verification.StatusPassed
		}
		outcomes = append(outcomes, verification.Outcome{CriterionID: h.contract.Criteria[i].ID, Verifier: "local-record", VerifierRevision: cortexVerificationRevision, Status: status, EvidenceIDs: []id.ID{b.Candidate.ID, b.Context.ExecutionInputs.ID}, Reason: "deterministic local record check"})
	}
	if checkErr := h.AuthorizeVerification(ctx, b); checkErr != nil {
		return zero, checkErr
	}
	return verification.SealReport(verification.Report{SchemaVersion: 1, ID: key, Binding: b, CheckedAt: h.Now(), ExpiresAt: in.Request.Deadline, Outcomes: outcomes})
}
func decodeCortexVerificationRecord(body []byte) (cortexVerificationRecord, bool) {
	var out cortexVerificationRecord
	decoder := json.NewDecoder(bytes.NewReader(body))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return out, false
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, tokenErr := decoder.Token()
		name, ok := token.(string)
		if tokenErr != nil || !ok || fields[name] != nil {
			return out, false
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return out, false
		}
		fields[name] = value
	}
	last, err := decoder.Token()
	if err != nil || last != json.Delim('}') || len(fields) != 4 {
		return out, false
	}
	if _, err = decoder.Token(); err != io.EOF {
		return out, false
	}
	for name, target := range map[string]any{"record": &out.Record, "units": &out.Units, "status": &out.Status, "revision": &out.Revision} {
		if json.Unmarshal(fields[name], target) != nil {
			return cortexVerificationRecord{}, false
		}
	}
	return out, out.Record != "" && out.Status != "" && out.Revision != ""
}
