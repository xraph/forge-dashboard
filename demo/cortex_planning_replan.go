package main

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/planning"
)

type cortexPlanningProposal struct {
	Request  coordination.PlanReplanRequest `json:"request"`
	Prepared *engine.PreparedAgent          `json:"prepared"`
	Input    string                         `json:"input"`
}

func (h *cortexDemoPlanningHost) proposal(ctx context.Context, key id.ID, create bool) (cortexPlanningProposal, error) {
	return cortexPlanningRecord(ctx, h.directory, "replan-"+key.String(), func() (cortexPlanningProposal, error) {
		var result cortexPlanningProposal
		if !create {
			return result, planning.ErrNotFound
		}
		p, err := h.plan(ctx)
		if err != nil {
			return result, err
		}
		if p.Revision != 1 {
			return result, evidence.ErrDenied
		}
		if _, err = h.storage.GetTaskClaim(ctx, p.ID, p.Tasks[0].ID); !errors.Is(err, coordination.ErrClaimNotFound) {
			return result, evidence.ErrDenied
		}
		account, err := h.storage.GetBudgetSnapshot(ctx, p.ID)
		if err != nil {
			return result, err
		}
		budget := execution.Budget{MaxSteps: 1, MaxTokens: cortexPlanningCallTokens, Deadline: p.Budget.Deadline}
		prepared, err := h.evaluator.PrepareAgent(ctx, h.root.Planner.ID, &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, Budget: &budget})
		if err != nil {
			return result, err
		}
		proposal := p
		proposal.Tasks = append([]planning.Task(nil), p.Tasks...)
		proposal.Tasks[0].Instruction = cortexVerificationPositive
		proposal.Digest = ""
		body, err := json.Marshal(proposal)
		if err != nil {
			return result, err
		}
		input := "/no_think Prepare the bounded warehouse task plan. Return ONLY the following complete JSON document, copying every identifier, criterion, source and budget exactly. The task instruction provides the approved arithmetic and output shape. Do not invent identifiers, tools or permissions. Document: " + string(body) + " /no_think"
		now := time.Now().UTC()
		request := coordination.PlanReplanRequest{SchemaVersion: 1, ID: key, Progress: planning.ProgressSnapshot{SchemaVersion: 1, Plan: p, At: now, StartedAt: h.root.CreatedAt, LastProgressAt: h.root.CreatedAt, Account: account}, Policy: planning.ReplanPolicy{MaxIdle: time.Millisecond, MaxReplans: 2}, Reservation: execution.ReservationRequest{SchemaVersion: 1, ID: id.New(execution.PrefixReservation), PlanID: p.ID, PlanDigest: p.Digest, Scope: p.Scope, TaskID: p.Tasks[0].ID, OwnerRef: key.String(), Kind: execution.ReservationLeaf, Allocation: execution.Resources{Steps: 1, Tokens: cortexPlanningCallTokens, FanOut: 1, Replans: 1}, Deadline: p.Budget.Deadline}, RunID: id.NewAgentRunID(), SessionID: id.NewSessionID(), AgentID: h.root.Planner.ID, PreparedDigest: prepared.Digest(), InputDigest: evidence.Digest([]byte(input)), Actor: cortexPlanningCoordinator, Reason: "Prepare warehouse task for explicit operator review"}
		request, _, err = request.Freeze()
		return cortexPlanningProposal{Request: request, Prepared: prepared, Input: input}, err
	})
}
func (h *cortexDemoPlanningHost) ResolvePlanningReplan(ctx context.Context, c coordination.PlanningCommand) (coordination.PlanReplanControl, error) {
	if err := h.authorize(ctx, "manage"); err != nil {
		return coordination.PlanReplanControl{}, err
	}
	saved, err := h.proposal(ctx, c.OperationID, c.Operation == "propose_revision")
	if err != nil {
		return coordination.PlanReplanControl{}, err
	}
	operation := map[string]string{"propose_revision": "dispatch", "observe_revision": "observe", "accept_revision": "commit"}[c.Operation]
	return coordination.PlanReplanControl{Request: saved.Request, Operation: operation}, nil
}
func (h *cortexDemoPlanningHost) ResolvePlanReplanInput(ctx context.Context, r coordination.PlanReplanRequest) (*engine.PreparedAgent, string, error) {
	saved, err := h.proposal(ctx, r.ID, false)
	if err != nil {
		return nil, "", err
	}
	_, wanted, err := saved.Request.Freeze()
	if err != nil {
		return nil, "", err
	}
	_, got, err := r.Freeze()
	if err != nil {
		return nil, "", err
	}
	if wanted != got {
		return nil, "", evidence.ErrDenied
	}
	return saved.Prepared, saved.Input, nil
}
func (h *cortexDemoPlanningHost) WithPlanReplanFence(ctx context.Context, c coordination.PlanReplanControl, next func(coordination.PlanReplanControl) error) error {
	return h.fence(ctx, c.Operation == "commit", func() error { return next(c) })
}
func (h *cortexDemoPlanningHost) AuthorizePlanReplan(ctx context.Context, c coordination.PlanReplanControl) error {
	if err := h.authorize(ctx, "manage"); err != nil {
		return err
	}
	saved, err := h.proposal(ctx, c.Request.ID, false)
	if err != nil {
		return err
	}
	_, wanted, err := saved.Request.Freeze()
	if err != nil {
		return err
	}
	_, got, err := c.Request.Freeze()
	if err != nil {
		return err
	}
	if wanted != got || len(c.Claims) != 0 || c.Abandonment != nil {
		return evidence.ErrDenied
	}
	current, err := h.plan(ctx)
	if err != nil {
		return err
	}
	historical := false
	if current.Digest != c.Request.Progress.Plan.Digest {
		committed, readErr := h.storage.GetPlanReplanCommit(ctx, c.Request.ID)
		if c.Operation != "commit" || readErr != nil || committed == nil || committed.Digest != current.Digest {
			return evidence.ErrDenied
		}
		historical = true
	}
	if _, err = h.storage.GetTaskClaim(ctx, current.ID, current.Tasks[0].ID); !historical && !errors.Is(err, coordination.ErrClaimNotFound) {
		return evidence.ErrDenied
	}
	if c.Operation == "commit" {
		outcome, readErr := h.storage.GetPlanReplanOutcome(ctx, c.Request.ID)
		if readErr != nil {
			return readErr
		}
		if outcome == nil || outcome.Proposed == nil || len(outcome.Proposed.Tasks) != 1 {
			return evidence.ErrDenied
		}
		expected := c.Request.Progress.Plan.Tasks[0]
		expected.Instruction = cortexVerificationPositive
		if !reflect.DeepEqual(expected, outcome.Proposed.Tasks[0]) {
			return evidence.ErrDenied
		}
	}
	return nil
}
