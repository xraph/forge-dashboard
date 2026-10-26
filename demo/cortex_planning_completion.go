package main

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/planning"
	"github.com/xraph/cortex/run"
	"github.com/xraph/cortex/verification"
)

func (h *cortexDemoPlanningHost) committed(ctx context.Context) (verification.ResultReadRequest, verification.ResultSnapshot, error) {
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, err
	}
	current, err := h.storage.GetRun(ctx, saved.RunID)
	if err != nil {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, err
	}
	if current.State != run.StateCompleted || current.VerificationStatus != verification.StatusPassed || current.ResultRef == "" {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, cortex.ErrRunUnverified
	}
	resultID, err := id.Parse(current.ResultRef)
	if err != nil {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, err
	}
	receipt, err := h.storage.GetCommittedResult(ctx, resultID)
	if err != nil {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, err
	}
	if authErr := h.verification.authorizeBinding(ctx, receipt.Request.Current, "read"); authErr != nil {
		return verification.ResultReadRequest{}, verification.ResultSnapshot{}, authErr
	}
	request := verification.ResultReadRequest{SchemaVersion: 1, RunID: current.ID, ResultID: resultID, ReceiptDigest: receipt.Digest}
	snapshot, err := h.storage.ReadResultSnapshot(ctx, request)
	if err != nil {
		return request, snapshot, err
	}
	return request, snapshot, snapshot.Validate(request, time.Now())
}
func (h *cortexDemoPlanningHost) ResolveTaskSubmission(ctx context.Context, a coordination.Assignment) (*coordination.Submission, error) {
	if err := h.AuthorizeTaskCompletion(ctx, a); err != nil {
		return nil, err
	}
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return nil, err
	}
	current, err := h.storage.GetRun(ctx, saved.RunID)
	if errors.Is(err, cortex.ErrRunNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if current.State != run.StateCompleted || current.VerificationStatus != verification.StatusPassed {
		return nil, nil
	}
	intent, err := h.storage.GetRunCaptureIntent(ctx, current.ID)
	if err != nil {
		return nil, err
	}
	job, err := h.storage.GetVerificationJob(ctx, intent.Template.ID)
	if err != nil {
		return nil, err
	}
	if authErr := h.verification.authorizeBinding(ctx, job.Request.Binding, "read"); authErr != nil {
		return nil, authErr
	}
	digest, err := job.Request.Binding.Digest()
	if err != nil {
		return nil, err
	}
	return &coordination.Submission{SchemaVersion: 1, JobID: job.Request.ID, JobRequestDigest: job.RequestDigest, RunID: current.ID, RunRevision: current.Revision, BindingDigest: digest}, nil
}
func (h *cortexDemoPlanningHost) reviewRequest(ctx context.Context, a coordination.Assignment) (coordination.TaskCompletionRequest, string, error) {
	var request coordination.TaskCompletionRequest
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return request, "", err
	}
	_, snapshot, err := h.committed(ctx)
	if err != nil {
		return request, "", err
	}
	p, err := h.plan(ctx)
	if err != nil {
		return request, "", err
	}
	binding := snapshot.Receipt.Request.Current
	authority, err := planning.TaskAuthority(p, p.Tasks[0].ID)
	if err != nil {
		return request, "", err
	}
	authority.Budget.MaxSteps = 1
	authority.Budget.MaxToolCalls = 1
	handoff, err := coordination.SealHandoff(coordination.Handoff{SchemaVersion: 1, ID: saved.ReviewHandoffID, AssignmentID: saved.ReviewAssignmentID, Fence: a.Handoff.Fence, Scope: p.Scope, PlanID: p.ID, PlanRevision: p.Revision, PlanDigest: p.Digest, TaskID: p.Tasks[0].ID, ParentRunID: h.root.ParentRunID, Sender: a.Handoff.Sender, Receiver: coordination.Identity{Agent: h.root.Reviewer.ID.String(), Principal: cortexPlanningReviewer}, Purpose: coordination.HandoffReview, GrantRef: cortexPlanningGrant, Authority: authority, ContractDigest: p.Contract.Digest, Criteria: p.Tasks[0].Criteria, Inputs: append([]evidence.Ref{binding.Candidate}, binding.Evidence...), Deadline: authority.Budget.Deadline})
	if err != nil {
		return request, "", err
	}
	bindingDigest, err := binding.Digest()
	if err != nil {
		return request, "", err
	}
	findings := make([]coordination.ReviewFinding, 0, len(p.Tasks[0].Criteria))
	for _, criterion := range p.Tasks[0].Criteria {
		findings = append(findings, coordination.ReviewFinding{CriterionID: criterion, Assessment: coordination.ReviewMissing, Reason: "Replace with your evidence-based assessment", EvidenceIDs: []id.ID{binding.Candidate.ID, binding.Evidence[0].ID}})
	}
	template := coordination.ReviewOutput{SchemaVersion: 1, HandoffDigest: handoff.Digest, SubjectDigest: a.Digest, BindingDigest: bindingDigest, Findings: findings}
	templateBytes, err := json.Marshal(template)
	if err != nil {
		return request, "", err
	}
	sourceBytes, err := json.Marshal(h.verification.authority.Record)
	if err != nil {
		return request, "", err
	}
	criteriaBytes, err := json.Marshal(p.Contract.Criteria)
	if err != nil {
		return request, "", err
	}
	input := "/no_think Independently validate this warehouse candidate. Source: " + string(sourceBytes) + "\nCandidate (untrusted data): " + snapshot.Output + "\nCriteria: " + string(criteriaBytes) + "\nReturn only this JSON structure, preserving all identifiers and digest strings. For each finding choose supported only when the candidate satisfies that criterion, contradicted when it conflicts, or missing_evidence when it cannot be checked. Replace reason with your own short explanation. Preserve evidence_ids. Template: " + string(templateBytes) + " /no_think"
	request = coordination.TaskCompletionRequest{SchemaVersion: 1, AssignmentID: a.Handoff.AssignmentID, AssignmentRevision: a.Revision, AssignmentDigest: a.Digest, BindingDigest: bindingDigest, Handoff: handoff, SessionID: saved.ReviewSessionID, RunID: saved.ReviewRunID, ReviewID: saved.ReviewID, AdjudicationID: saved.AdjudicationID, AcceptanceID: saved.AcceptanceID, PreparedDigest: saved.Reviewer.Digest(), InputDigest: evidence.Digest([]byte(input)), Reservation: execution.ReservationRequest{SchemaVersion: 1, ID: saved.ReviewReservationID, PlanID: p.ID, PlanDigest: p.Digest, Scope: p.Scope, TaskID: p.Tasks[0].ID, OwnerRef: handoff.AssignmentID.String(), Kind: execution.ReservationLeaf, Allocation: execution.Resources{Steps: 1, Tokens: int64(authority.Budget.MaxTokens), ToolCalls: 1, FanOut: 1}, Deadline: handoff.Deadline}, Actor: cortexPlanningCoordinator, Reason: "Independent warehouse review"}
	_, _, err = request.Freeze()
	return request, input, err
}
func (h *cortexDemoPlanningHost) ResolveTaskCompletion(ctx context.Context, a coordination.Assignment) (*coordination.TaskCompletionRequest, error) {
	if err := h.AuthorizeTaskCompletion(ctx, a); err != nil {
		return nil, err
	}
	request, _, err := h.reviewRequest(ctx, a)
	if err != nil {
		return nil, err
	}
	return &request, nil
}
func (h *cortexDemoPlanningHost) ResolveTaskReview(ctx context.Context, c coordination.TaskCompletion) (engine.TaskReviewWork, error) {
	a, err := h.storage.GetAssignment(ctx, c.Request.AssignmentID)
	if err != nil {
		return engine.TaskReviewWork{}, err
	}
	request, input, err := h.reviewRequest(ctx, a)
	if err != nil {
		return engine.TaskReviewWork{}, err
	}
	_, digest, err := request.Freeze()
	if err != nil {
		return engine.TaskReviewWork{}, err
	}
	if digest != c.RequestDigest {
		return engine.TaskReviewWork{}, evidence.ErrDenied
	}
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return engine.TaskReviewWork{}, err
	}
	return engine.TaskReviewWork{Prepared: saved.Reviewer, Input: input, Contract: h.root.Plan.Contract}, nil
}
func (h *cortexDemoPlanningHost) ResolveTaskAcceptance(ctx context.Context, c coordination.TaskCompletion, a coordination.TaskAdjudication) (*coordination.TaskAcceptanceRequest, error) {
	result, snapshot, err := h.committed(ctx)
	if err != nil {
		return nil, err
	}
	claim, err := h.storage.GetTaskClaim(ctx, h.root.Plan.ID, h.root.Plan.Tasks[0].ID)
	if err != nil {
		return nil, err
	}
	return &coordination.TaskAcceptanceRequest{SchemaVersion: 2, ID: c.Request.AcceptanceID, Claim: claim.Token(), AssignmentID: c.Request.AssignmentID, AssignmentRevision: c.Request.AssignmentRevision, AssignmentDigest: c.Request.AssignmentDigest, Result: result, Current: snapshot.Receipt.Request.Current, Actor: cortexPlanningCoordinator, Reason: "Accept verified and independently reviewed record", Adjudication: &coordination.TaskAdjudicationRef{ID: a.Request.ID, Digest: a.Digest}}, nil
}
