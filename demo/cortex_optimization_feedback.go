package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"unicode/utf8"

	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
	"github.com/xraph/cortex/prompt"
	"github.com/xraph/cortex/run"
)

const cortexOptimizationFeedbackRevision = "local-discovery-excerpt-v3"
const cortexOptimizationFeedbackBytes = 16384

type cortexOptimizationControllerModel struct{ host *cortexDemoOptimizationHost }
type cortexOptimizationProjectionKey struct{}
type cortexOptimizationProjection struct {
	Original   *llm.Request
	WireDigest string
}
type cortexOptimizationWireIntent struct {
	Revision, RequestDigest, WireDigest string
	Operation, Domain, FormatDigest     string
	Request                             *llm.Request
}
type cortexOptimizationExcerpt struct {
	Text          string `json:"text"`
	OriginalBytes int    `json:"original_bytes"`
	Digest        string `json:"digest"`
	Truncated     bool   `json:"truncated"`
}
type cortexOptimizationFeedback struct {
	TrialID         id.ID                     `json:"trial_id"`
	CaseID          string                    `json:"case_id"`
	CaseDigest      string                    `json:"case_digest"`
	Split           opt.Split                 `json:"split"`
	State           opt.TrialState            `json:"state"`
	Version         opt.VersionRef            `json:"version"`
	RunID           id.AgentRunID             `json:"run_id"`
	RunState        run.State                 `json:"run_state"`
	StopReason      run.StopReason            `json:"stop_reason"`
	FinishReason    string                    `json:"finish_reason"`
	ExecutionDigest string                    `json:"execution_digest"`
	Usage           opt.Usage                 `json:"usage"`
	Output          cortexOptimizationExcerpt `json:"output_excerpt"`
	Artifacts       []opt.ArtifactRef         `json:"original_artifacts"`
	Evaluation      opt.Evaluation            `json:"evaluation"`
}
type cortexOptimizationFeedbackInput struct {
	Revision         string                       `json:"projection_revision"`
	Operation        string                       `json:"operation"`
	OriginalDigest   string                       `json:"original_input_digest"`
	OriginalBytes    int                          `json:"original_input_bytes"`
	Baseline         opt.VersionRef               `json:"baseline"`
	EditableSections []prompt.Section             `json:"editable_sections"`
	Policy           opt.EditPolicy               `json:"policy"`
	Round            int                          `json:"round"`
	Evidence         []cortexOptimizationFeedback `json:"evidence"`
	Candidates       []opt.Candidate              `json:"candidates,omitempty"`
	Domain           string                       `json:"domain,omitempty"`
}

func cortexOptimizationExcerptOf(value string) cortexOptimizationExcerpt {
	hash := sha256.Sum256([]byte(value))
	size := min(len(value), 512)
	for !utf8.ValidString(value[:size]) {
		size--
	}
	return cortexOptimizationExcerpt{Text: value[:size], OriginalBytes: len(value), Digest: hex.EncodeToString(hash[:]), Truncated: size < len(value)}
}
func cortexOptimizationDecodeExact(data []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return opt.ErrInvalidSpec
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return opt.ErrInvalidSpec
	}
	encoded, err := json.Marshal(value)
	if err != nil || !bytes.Equal(encoded, data) {
		return opt.ErrInvalidSpec
	}
	return nil
}
func (h *cortexDemoOptimizationHost) projectController(ctx context.Context, request *llm.Request) (*llm.Request, error) {
	if err := h.current(ctx); err != nil {
		return nil, err
	}
	item, ok := ctx.Value(cortexOptimizationWorkKey{}).(opt.WorkItem)
	if !ok || item.Experiment.Spec.Scope.Canonical() != h.verification.scope.Canonical() || request == nil || request.Model != "demo-local" || len(request.Tools) != 0 || len(request.Messages) != 1 || request.Messages[0].Role != "user" || len(request.Messages[0].ToolCalls) != 0 || request.Messages[0].ToolCallID != "" {
		return nil, opt.ErrPolicyDenied
	}
	raw := []byte(request.Messages[0].Content)
	var evidence []opt.DiscoveryEvidence
	var candidates []opt.Candidate
	var baseline opt.HarnessVersion
	var policy opt.EditPolicy
	var round int
	var domain string
	switch item.Experiment.Phase {
	case opt.PhasePropose:
		var input opt.ProposalInput
		if err := cortexOptimizationDecodeExact(raw, &input); err != nil {
			return nil, err
		}
		if len(input.Lessons) != 0 || len(input.Discoveries) != 0 {
			return nil, opt.ErrUnavailable
		}
		evidence, baseline, policy, round = input.Evidence, input.Baseline, input.Policy, input.Round
	case opt.PhaseCompose:
		var input opt.CompositionInput
		if err := cortexOptimizationDecodeExact(raw, &input); err != nil {
			return nil, err
		}
		if len(input.Lessons) != 0 || len(input.Discoveries) != 0 {
			return nil, opt.ErrUnavailable
		}
		evidence, baseline, policy, round, candidates = input.Evidence, input.Baseline, input.Policy, input.Round, input.Candidates
	case opt.PhaseReflect:
		var input opt.ReflectionInput
		if err := cortexOptimizationDecodeExact(raw, &input); err != nil {
			return nil, err
		}
		evidence, candidates, domain = input.Evidence, input.Candidates, input.Domain
		baseline, policy, round = h.frozen.Baseline, h.frozen.Baseline.Policy, item.Experiment.Round
	default:
		return nil, opt.ErrPolicyDenied
	}
	if baseline.ID != item.Experiment.Spec.Baseline.ID || baseline.Digest != item.Experiment.Spec.Baseline.Digest || baseline.Prepared == nil || round != item.Experiment.Round || !reflect.DeepEqual(policy, h.frozen.Baseline.Policy) || evidence == nil || len(evidence) > 4 || len(candidates) > 1 {
		return nil, opt.ErrIncompleteEvidence
	}
	view, err := baseline.Prepared.Inspect()
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(raw)
	projection := cortexOptimizationFeedbackInput{Revision: cortexOptimizationFeedbackRevision, Operation: string(item.Experiment.Phase), OriginalDigest: hex.EncodeToString(hash[:]), OriginalBytes: len(raw), Baseline: item.Experiment.Spec.Baseline, Policy: policy, Round: round, Candidates: candidates, Domain: domain, Evidence: make([]cortexOptimizationFeedback, 0, len(evidence))}
	for _, editable := range policy.MutableSections {
		found := false
		for _, section := range view.Sections {
			if section.ID == editable {
				projection.EditableSections = append(projection.EditableSections, section)
				found = true
			}
		}
		if !found {
			return nil, opt.ErrIncompleteEvidence
		}
	}
	for _, entry := range evidence {
		trial, evaluation := entry.Trial, entry.Evaluation
		execution := trial.Execution
		if trial.Split != opt.SplitDiscovery || trial.ExperimentID != item.Experiment.ID || evaluation.ExperimentID != item.Experiment.ID || evaluation.TrialID != trial.ID || evaluation.ID == "" || trial.EvaluationID != evaluation.ID || evaluation.CaseID != trial.CaseID || evaluation.CaseDigest != trial.CaseDigest || execution == nil || evaluation.ExecutionDigest != execution.Digest || execution.Environment.Scope.Canonical() != h.verification.scope.Canonical() || !utf8.ValidString(execution.Outcome.Output) {
			return nil, opt.ErrPolicyDenied
		}
		sealed, sealErr := opt.SealExecution(*execution)
		if sealErr != nil || sealed.Digest != execution.Digest {
			return nil, opt.ErrIncompleteEvidence
		}
		for _, ref := range execution.Artifacts {
			if _, readErr := h.Get(ctx, ref); readErr != nil {
				return nil, readErr
			}
		}
		projection.Evidence = append(projection.Evidence, cortexOptimizationFeedback{TrialID: trial.ID, CaseID: trial.CaseID, CaseDigest: trial.CaseDigest, Split: trial.Split, State: trial.State, Version: trial.Version, RunID: execution.RunID, RunState: execution.State, StopReason: execution.Outcome.StopReason, FinishReason: execution.Outcome.FinishReason, ExecutionDigest: execution.Digest, Usage: execution.Usage, Output: cortexOptimizationExcerptOf(execution.Outcome.Output), Artifacts: execution.Artifacts, Evaluation: evaluation})
	}
	body, err := json.Marshal(projection)
	if err != nil || len(body) > cortexOptimizationFeedbackBytes {
		return nil, opt.ErrInvalidSpec
	}
	detached := *request
	detached.System += "\nReturn concise JSON directly. /no_think"
	detached.Messages = []llm.Message{{Role: "user", Content: string(body)}}
	if _, err = cortexOptimizationRequest(&detached); err != nil {
		return nil, err
	}
	if _, _, err = cortexOptimizationControllerRoute(&detached); err != nil {
		return nil, err
	}
	return &detached, h.current(ctx)
}
func (m cortexOptimizationControllerModel) Bound(ctx context.Context, request *llm.Request) (opt.InputTokenBound, error) {
	projected, err := m.host.projectController(ctx, request)
	if err != nil {
		return opt.InputTokenBound{}, err
	}
	return m.host.model.Bound(ctx, projected)
}
func (m cortexOptimizationControllerModel) Complete(ctx context.Context, request *llm.Request) (*llm.Response, error) {
	projected, err := m.host.projectController(ctx, request)
	if err != nil {
		return nil, err
	}
	_, digest, err := m.host.controllerDispatch(ctx, request)
	if err != nil {
		return nil, err
	}
	wireDigest, _, err := cortexOptimizationDigest(projected)
	if err != nil {
		return nil, err
	}
	operation, domain, err := cortexOptimizationControllerRoute(projected)
	if err != nil {
		return nil, err
	}
	format, err := cortexOptimizationResponseFormat(projected)
	if err != nil {
		return nil, err
	}
	formatDigest, _, err := cortexOptimizationDigest(format)
	if err != nil {
		return nil, err
	}
	if _, err = m.host.journal.put("controller-wire", digest, cortexOptimizationWireIntent{Revision: cortexOptimizationFeedbackRevision, RequestDigest: digest, WireDigest: wireDigest, Operation: operation, Domain: domain, FormatDigest: formatDigest, Request: projected}); err != nil {
		return nil, err
	}
	return m.host.model.Complete(context.WithValue(ctx, cortexOptimizationProjectionKey{}, cortexOptimizationProjection{request, wireDigest}), projected)
}
func (cortexOptimizationControllerModel) CompleteStream(context.Context, *llm.Request) (llm.Stream, error) {
	return nil, opt.ErrUnavailable
}
func (h *cortexDemoOptimizationHost) controllerDispatch(ctx context.Context, request *llm.Request) (opt.Reservation, string, error) {
	var empty opt.Reservation
	item, ok := ctx.Value(cortexOptimizationWorkKey{}).(opt.WorkItem)
	if !ok {
		return empty, "", opt.ErrPolicyDenied
	}
	name := string(item.Experiment.Phase)
	if name != "propose" && name != "compose" && name != "reflect" {
		return empty, "", opt.ErrPolicyDenied
	}
	saved, err := h.repository.GetReservation(ctx, item.Experiment.ID, fmt.Sprintf("controller/%s/%d", name, item.Experiment.Round))
	if err != nil {
		return empty, "", err
	}
	if saved.Call == nil || saved.Call.Validate() != nil || saved.State != opt.ReservationHeld || saved.Call.Lease.Generation != item.Lease.Generation {
		return empty, "", opt.ErrConflict
	}
	digest, err := cortexOptimizationDispatchDigest(h.verification.scope, saved.Request, request)
	if err != nil || digest != saved.Call.RequestDigest {
		return empty, "", opt.ErrIncompleteEvidence
	}
	return saved, digest, h.current(ctx)
}
