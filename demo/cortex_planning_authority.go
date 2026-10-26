package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"time"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/planning"
	"github.com/xraph/cortex/run"
	"github.com/xraph/cortex/verification"
)

type cortexPlanningActorKey struct{}

func (h *cortexDemoPlanningHost) actor(ctx context.Context, subject string) context.Context {
	principal := dc.Principal{User: &dashauth.UserInfo{Subject: subject, ProviderName: "local-development", Scopes: []string{"cortex.read", "cortex.run", "cortex.manage", "cortex.approve"}}, Claims: map[string]any{"cortex_demo_scope": h.root.Plan.Scope.Canonical()}}
	return context.WithValue(cortex.WithPrincipal(cortex.WithScope(ctx, h.root.Plan.Scope), principal), cortexPlanningActorKey{}, h)
}
func (h *cortexDemoPlanningHost) authorize(ctx context.Context, permission string) error {
	if permission != "read" && !h.active.Load() {
		return coordination.ErrPlanningUnavailable
	}
	_, err := h.verification.authorizeUser(ctx, permission)
	if err != nil {
		return err
	}
	for _, expected := range []agent.Config{h.root.Planner, h.root.Producer, h.root.Reviewer} {
		current, readErr := h.storage.Get(ctx, expected.ID)
		if readErr != nil {
			return readErr
		}
		if current == nil {
			return evidence.ErrDenied
		}
		detached := *current
		detached.Entity = cortex.Entity{}
		expected.Entity = cortex.Entity{}
		expectedBytes, encodeErr := json.Marshal(expected)
		if encodeErr != nil {
			return encodeErr
		}
		actualBytes, encodeErr := json.Marshal(detached)
		if encodeErr != nil {
			return encodeErr
		}
		if !bytes.Equal(expectedBytes, actualBytes) {
			return evidence.ErrDenied
		}
	}
	return nil
}
func (h *cortexDemoPlanningHost) AuthorizePlanning(ctx context.Context, access coordination.PlanningAccess) error {
	permission := "read"
	if access.Operation != "list" && access.Operation != "read" {
		permission = "manage"
	}
	if !access.PlanID.IsNil() && access.PlanID != h.root.Plan.ID {
		return evidence.ErrDenied
	}
	return h.authorize(ctx, permission)
}
func (h *cortexDemoPlanningHost) WithPlanningReadFence(ctx context.Context, a coordination.PlanningAccess, next func() error) error {
	return h.fence(ctx, false, func() error {
		if err := h.AuthorizePlanning(ctx, a); err != nil {
			return err
		}
		return next()
	})
}
func (h *cortexDemoPlanningHost) AuthorizeEvidence(ctx context.Context, action evidence.Action, ref evidence.Ref) error {
	if ref.Producer == "local-record-host/v1" {
		return h.verification.AuthorizeEvidence(ctx, action, ref)
	}
	p, err := h.plan(ctx)
	if err != nil {
		return err
	}
	if ref.Producer != planning.ArtifactProducer(p, p.Tasks[0].ID) || ref.Validate() != nil || ref.Scope.Canonical() != p.Scope.Canonical() || !time.Now().Before(ref.RetainUntil) {
		return evidence.ErrDenied
	}
	permission := "read"
	if action == evidence.ActionPut {
		permission = "run"
	} else if action != evidence.ActionRead {
		return evidence.ErrDenied
	}
	return h.authorize(ctx, permission)
}
func (h *cortexDemoPlanningHost) BuildVerificationIntent(ctx context.Context, in engine.VerificationIntentInput) (verification.CaptureIntent, error) {
	if ctx.Value(cortexPlanningActorKey{}) != h {
		return verification.CaptureIntent{}, evidence.ErrDenied
	}
	intent, err := h.verification.BuildVerificationIntent(ctx, in)
	if err != nil {
		return intent, err
	}
	p, err := h.plan(ctx)
	if err != nil {
		return intent, err
	}
	intent.Template.Binding.Candidate.Producer = planning.ArtifactProducer(p, p.Tasks[0].ID)
	intent.Template.Binding.Context.Sources = append([]verification.Source(nil), p.Sources...)
	return verification.SealCaptureIntent(intent)
}
func (h *cortexDemoPlanningHost) WithTaskClaimFence(ctx context.Context, r coordination.ReadyTaskClaimRequest, next func(coordination.ReadyTaskClaimRequest) error) error {
	return h.fence(ctx, false, func() error { return next(r) })
}
func (h *cortexDemoPlanningHost) AuthorizeTaskClaim(ctx context.Context, r coordination.ReadyTaskClaimRequest) error {
	if err := h.authorize(ctx, "manage"); err != nil {
		return err
	}
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return err
	}
	_, wanted, err := saved.Request.Freeze()
	if err != nil {
		return err
	}
	_, got, err := r.Freeze()
	if err != nil {
		return err
	}
	if wanted != got {
		return evidence.ErrDenied
	}
	return h.currentPlan(ctx, r.Acquisition.Claim.PlanDigest)
}
func (h *cortexDemoPlanningHost) currentPlan(ctx context.Context, digest string) error {
	p, err := h.plan(ctx)
	if err != nil {
		return err
	}
	if p.Digest != digest || !time.Now().Before(p.Budget.Deadline) {
		return evidence.ErrDenied
	}
	return h.authorize(ctx, "run")
}
func (h *cortexDemoPlanningHost) WithTaskDispatchFence(ctx context.Context, r coordination.TaskDispatchRequest, next func(coordination.TaskDispatchRequest) error) error {
	return h.fence(ctx, false, func() error { return next(r) })
}
func (h *cortexDemoPlanningHost) AuthorizeTaskDispatch(ctx context.Context, r coordination.TaskDispatchRequest) error {
	if ctx.Value(cortexPlanningActorKey{}) != h || r.Actor != cortexPlanningProducer {
		return evidence.ErrDenied
	}
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return err
	}
	if r.Claim.ClaimID != saved.Request.Acquisition.Claim.ID || r.RunID != saved.RunID || r.AssignmentID != saved.AssignmentID {
		return evidence.ErrDenied
	}
	return h.currentPlan(ctx, saved.Request.Acquisition.Claim.PlanDigest)
}
func (h *cortexDemoPlanningHost) WithTaskRunFence(ctx context.Context, r coordination.TaskRunRequest, next func(coordination.TaskRunRequest) error) error {
	return h.fence(ctx, false, func() error { return next(r) })
}
func (h *cortexDemoPlanningHost) AuthorizeTaskRun(ctx context.Context, r coordination.TaskRunRequest) error {
	if ctx.Value(cortexPlanningActorKey{}) != h || r.Actor != cortexPlanningProducer {
		return evidence.ErrDenied
	}
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return err
	}
	if r.Run.ID != saved.RunID || r.Run.AgentID != h.root.Producer.ID || r.Run.SessionID != saved.SessionID || r.Run.Input != cortexVerificationPositive || r.Run.Provenance.PreparedDigest != saved.Prepared.Digest() || r.Claim.ClaimID != saved.Request.Acquisition.Claim.ID {
		return evidence.ErrDenied
	}
	return h.currentPlan(ctx, saved.Request.Acquisition.Claim.PlanDigest)
}
func (h *cortexDemoPlanningHost) AcquireTaskCall(ctx context.Context, r engine.TaskCallRequest) (lease engine.TaskCallLease, resultErr error) {
	if ctx.Value(cortexPlanningActorKey{}) != h || r.Kind == engine.TaskCallTool {
		return lease, evidence.ErrDenied
	}
	unlock, err := lockCortexVerification(ctx, h.verification.authorityFile+".lock", false)
	if err != nil {
		return lease, err
	}
	planUnlock, err := lockCortexVerification(ctx, filepath.Join(h.directory, "execution.lock"), false)
	if err != nil {
		return lease, errors.Join(err, unlock())
	}
	transferred := false
	defer func() {
		if !transferred {
			resultErr = errors.Join(resultErr, planUnlock(), unlock())
		}
	}()
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return lease, err
	}
	if planErr := h.currentPlan(ctx, saved.Request.Acquisition.Claim.PlanDigest); planErr != nil {
		return lease, planErr
	}
	claim, err := h.storage.GetTaskClaim(ctx, h.root.Plan.ID, h.root.Plan.Tasks[0].ID)
	if err != nil {
		return lease, err
	}
	dispatch, err := h.storage.GetTaskDispatch(ctx, claim.ID)
	if err != nil {
		return lease, err
	}
	assignment, err := h.storage.GetAssignment(ctx, saved.AssignmentID)
	if err != nil {
		return lease, err
	}
	parent, err := h.storage.GetRun(ctx, h.root.ParentRunID)
	if err != nil {
		return lease, err
	}
	child, err := h.storage.GetRun(ctx, r.RunID)
	if err != nil {
		return lease, err
	}
	if claim.State != coordination.ClaimDispatching || claim.ID != r.ClaimID || claim.RunID != r.RunID || r.RunID != saved.RunID || r.AgentID != h.root.Producer.ID || r.ParentRunID != parent.ID || parent.State != run.StateRunning || child.State != run.StateRunning || child.Provenance.PreparedDigest != r.PreparedDigest || r.PreparedDigest != saved.Prepared.Digest() || assignment.State != coordination.AssignmentWorking || assignment.Handoff.Digest != r.AssignmentDigest || dispatch.Assignment.Digest != assignment.Digest || !time.Now().Before(claim.ExpiresAt) {
		return lease, evidence.ErrDenied
	}
	_, digest, err := r.Freeze()
	if err != nil {
		return lease, err
	}
	deadline := r.Deadline
	if claim.ExpiresAt.Before(deadline) {
		deadline = claim.ExpiresAt
	}
	revoked := make(chan struct{})
	var once sync.Once
	var releaseErr error
	lease = engine.TaskCallLease{RequestDigest: digest, ExpiresAt: deadline, Revoked: revoked, Release: func() error {
		once.Do(func() { close(revoked); releaseErr = errors.Join(planUnlock(), unlock()) })
		return releaseErr
	}}
	transferred = true
	return lease, nil
}
func (h *cortexDemoPlanningHost) WithTaskCompletionFence(ctx context.Context, a coordination.Assignment, next func(coordination.Assignment) error) error {
	return h.fence(ctx, false, func() error { return next(a) })
}
func (h *cortexDemoPlanningHost) AuthorizeTaskCompletion(ctx context.Context, a coordination.Assignment) error {
	if err := h.authorize(ctx, "manage"); err != nil {
		return err
	}
	if a.Handoff.PlanID != h.root.Plan.ID || a.Handoff.Receiver.Principal != cortexPlanningProducer || a.Handoff.Sender.Principal != cortexPlanningCoordinator {
		return evidence.ErrDenied
	}
	return h.currentPlan(ctx, a.Handoff.PlanDigest)
}
func (h *cortexDemoPlanningHost) WithTaskReviewFence(ctx context.Context, _ engine.TaskReviewAction, c coordination.TaskCompletion, next func(coordination.TaskCompletion) error) error {
	return h.fence(ctx, false, func() (resultErr error) {
		unlock, err := lockCortexVerification(ctx, filepath.Join(h.directory, c.Request.RunID.String()+".execution.lock"), true)
		if err != nil {
			return err
		}
		defer func() { resultErr = errors.Join(resultErr, unlock()) }()
		return next(c)
	})
}
func (h *cortexDemoPlanningHost) AuthorizeTaskReview(ctx context.Context, _ engine.TaskReviewAction, c coordination.TaskCompletion) error {
	if err := h.authorize(ctx, "manage"); err != nil {
		return err
	}
	if c.Request.Handoff.Receiver.Agent != h.root.Reviewer.ID.String() || c.Request.Handoff.Receiver.Principal != cortexPlanningReviewer {
		return evidence.ErrDenied
	}
	assignment, err := h.storage.GetAssignment(ctx, c.Request.AssignmentID)
	if err != nil {
		return err
	}
	if assignment.Digest != c.Request.AssignmentDigest || assignment.State != coordination.AssignmentSubmitted {
		return evidence.ErrDenied
	}
	return h.currentPlan(ctx, c.Request.Handoff.PlanDigest)
}
func (h *cortexDemoPlanningHost) WithTaskAcceptanceFence(ctx context.Context, r coordination.TaskAcceptanceRequest, next func(coordination.TaskAcceptanceRequest) error) error {
	return h.fence(ctx, false, func() error { return next(r) })
}
func (h *cortexDemoPlanningHost) AuthorizeTaskAcceptance(ctx context.Context, r coordination.TaskAcceptanceRequest) error {
	if err := h.authorize(ctx, "manage"); err != nil {
		return err
	}
	if r.Actor != cortexPlanningCoordinator || r.Recovery != nil {
		return evidence.ErrDenied
	}
	if err := h.verification.authorizeBinding(ctx, r.Current, "read"); err != nil {
		return err
	}
	p, err := h.plan(ctx)
	if err != nil {
		return err
	}
	if r.Claim.PlanID != p.ID || r.Claim.TaskID != p.Tasks[0].ID || !reflect.DeepEqual(r.Current.Context.Sources, p.Sources) {
		return evidence.ErrDenied
	}
	return nil
}
