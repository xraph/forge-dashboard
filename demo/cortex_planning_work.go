package main

import (
	"context"
	"errors"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/coordination"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/evidence"
	"github.com/xraph/cortex/execution"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/planning"
	"github.com/xraph/cortex/session"
	"github.com/xraph/cortex/verification"
)

type cortexPlanningClaim struct {
	Request                                                                                                                        coordination.ReadyTaskClaimRequest `json:"request"`
	Prepared                                                                                                                       *engine.PreparedAgent              `json:"prepared"`
	Reviewer                                                                                                                       *engine.PreparedAgent              `json:"reviewer"`
	AssignmentID, HandoffID, RunID, SessionID                                                                                      id.ID
	ReviewAssignmentID, ReviewHandoffID, ReviewRunID, ReviewSessionID, ReviewID, AdjudicationID, AcceptanceID, ReviewReservationID id.ID
}

func (h *cortexDemoPlanningHost) claimRecord(ctx context.Context, command *coordination.PlanningCommand) (cortexPlanningClaim, error) {
	return cortexPlanningRecord(ctx, h.directory, "claim", func() (cortexPlanningClaim, error) {
		var result cortexPlanningClaim
		if command == nil {
			return result, coordination.ErrClaimNotFound
		}
		p, err := h.plan(ctx)
		if err != nil {
			return result, err
		}
		if p.Revision < 2 || len(p.Tasks) != 1 || command.Operation != "claim" || command.TaskID != p.Tasks[0].ID || command.ExpectedClaimRevision != 0 || command.ExpectedDigest != p.Digest {
			return result, evidence.ErrDenied
		}
		task := p.Tasks[0]
		if task.Instruction != cortexVerificationPositive || task.Owner != h.root.Producer.ID.String() {
			return result, evidence.ErrDenied
		}
		prepared, err := h.producer.PrepareAgent(h.actor(ctx, cortexPlanningProducer), h.root.Producer.ID, &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, Budget: &task.Budget})
		if err != nil {
			return result, err
		}
		reviewBudget := task.Budget
		reviewBudget.MaxSteps = 1
		reviewBudget.MaxToolCalls = 1
		reviewer, err := h.evaluator.PrepareAgent(ctx, h.root.Reviewer.ID, &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, Budget: &reviewBudget})
		if err != nil {
			return result, err
		}
		result = cortexPlanningClaim{Prepared: prepared, Reviewer: reviewer, AssignmentID: id.New(coordination.PrefixAssignment), HandoffID: id.New(coordination.PrefixHandoff), RunID: id.NewAgentRunID(), SessionID: id.NewSessionID(), ReviewAssignmentID: id.New(coordination.PrefixAssignment), ReviewHandoffID: id.New(coordination.PrefixHandoff), ReviewRunID: id.NewAgentRunID(), ReviewSessionID: id.NewSessionID(), ReviewID: id.New(coordination.PrefixReview), AdjudicationID: id.New(coordination.PrefixTaskAdjudication), AcceptanceID: id.New(coordination.PrefixTaskAcceptance), ReviewReservationID: id.New(execution.PrefixReservation)}
		result.Request = coordination.ReadyTaskClaimRequest{SchemaVersion: 1, Acquisition: coordination.BudgetedClaimRequest{Claim: coordination.ClaimRequest{SchemaVersion: 1, ID: command.OperationID, PlanID: p.ID, PlanRevision: p.Revision, PlanDigest: p.Digest, TaskID: task.ID, Worker: coordination.Identity{Agent: h.root.Producer.ID.String(), Principal: cortexPlanningProducer}, GrantRef: cortexPlanningGrant, Duration: 15 * time.Minute}, Reservation: execution.ReservationRequest{SchemaVersion: 1, ID: id.New(execution.PrefixReservation), PlanID: p.ID, PlanDigest: p.Digest, Scope: p.Scope, TaskID: task.ID, OwnerRef: command.OperationID.String(), Kind: execution.ReservationLeaf, Allocation: execution.Resources{Steps: int64(task.Budget.MaxSteps), Tokens: int64(task.Budget.MaxTokens), ToolCalls: 1, FanOut: 1}, Deadline: task.Budget.Deadline}}}
		_, _, err = result.Request.Freeze()
		return result, err
	})
}
func (h *cortexDemoPlanningHost) ResolvePlanningClaim(ctx context.Context, c coordination.PlanningCommand) (coordination.ReadyTaskClaimRequest, error) {
	if err := h.authorize(ctx, "manage"); err != nil {
		return coordination.ReadyTaskClaimRequest{}, err
	}
	record, err := h.claimRecord(ctx, &c)
	if err != nil {
		return coordination.ReadyTaskClaimRequest{}, err
	}
	if record.Request.Acquisition.Claim.ID != c.OperationID {
		return coordination.ReadyTaskClaimRequest{}, coordination.ErrClaimConflict
	}
	return record.Request, nil
}
func (h *cortexDemoPlanningHost) RunClaimedTask(ctx context.Context, r coordination.ReadyTaskClaimRequest, a coordination.ReadyTaskClaim) error {
	if err := h.AuthorizeTaskClaim(ctx, r); err != nil {
		return err
	}
	return h.worker.RunClaimedTask(h.actor(ctx, cortexPlanningProducer), r, a)
}
func (h *cortexDemoPlanningHost) ResolveTaskWork(ctx context.Context, r coordination.ReadyTaskClaimRequest, a coordination.ReadyTaskClaim) (engine.TaskWork, error) {
	saved, err := h.claimRecord(ctx, nil)
	if err != nil {
		return engine.TaskWork{}, err
	}
	if a.Acquisition.Claim.ID != saved.Request.Acquisition.Claim.ID || !a.Fresh {
		return engine.TaskWork{}, evidence.ErrDenied
	}
	p, err := h.plan(ctx)
	if err != nil {
		return engine.TaskWork{}, err
	}
	authority, err := planning.TaskAuthority(p, p.Tasks[0].ID)
	if err != nil {
		return engine.TaskWork{}, err
	}
	handoff, err := coordination.SealHandoff(coordination.Handoff{SchemaVersion: 1, ID: saved.HandoffID, AssignmentID: saved.AssignmentID, Fence: a.Acquisition.Claim.Fence, Scope: p.Scope, PlanID: p.ID, PlanRevision: p.Revision, PlanDigest: p.Digest, TaskID: p.Tasks[0].ID, ParentRunID: h.root.ParentRunID, Sender: coordination.Identity{Agent: h.root.Planner.ID.String(), Principal: cortexPlanningCoordinator}, Receiver: r.Acquisition.Claim.Worker, Purpose: coordination.HandoffWork, GrantRef: cortexPlanningGrant, Authority: authority, ContractDigest: p.Contract.Digest, Criteria: p.Tasks[0].Criteria, Deadline: authority.Budget.Deadline})
	if err != nil {
		return engine.TaskWork{}, err
	}
	assignment, err := h.storage.ProposeAssignment(ctx, handoff)
	if err != nil {
		return engine.TaskWork{}, err
	}
	assignment, err = h.storage.AdvanceAssignment(ctx, coordination.AssignmentChange{AssignmentID: saved.AssignmentID, ExpectedRevision: assignment.Revision, HandoffDigest: handoff.Digest, Fence: handoff.Fence, State: coordination.AssignmentAccepted, Actor: cortexPlanningProducer, Reason: "Accept warehouse work"})
	if err != nil {
		return engine.TaskWork{}, err
	}
	parent, err := h.storage.GetRun(ctx, h.root.ParentRunID)
	if err != nil {
		return engine.TaskWork{}, err
	}
	if err := h.storage.CreateSession(ctx, &session.Session{ID: saved.SessionID, AgentID: h.root.Producer.ID, Title: "Warehouse production"}); err != nil {
		return engine.TaskWork{}, err
	}
	return engine.TaskWork{Prepared: saved.Prepared, SessionID: saved.SessionID, Input: p.Tasks[0].Instruction, Reason: "Execute admitted warehouse task", Dispatch: coordination.TaskDispatchRequest{SchemaVersion: 1, Scope: p.Scope, Claim: a.Acquisition.Claim.Token(), ClaimDigest: a.Acquisition.Claim.Digest, AdmissionDigest: a.RequestDigest, AssignmentID: saved.AssignmentID, AssignmentRevision: assignment.Revision, AssignmentDigest: assignment.Digest, ParentRunRevision: parent.Revision, RunID: saved.RunID, Actor: cortexPlanningProducer, Reason: "Dispatch warehouse task"}}, nil
}
func (h *cortexDemoPlanningHost) LoadSchedulingState(ctx context.Context, key id.ID) (planning.Plan, []planning.TaskState, error) {
	if err := h.authorize(ctx, "read"); err != nil {
		return planning.Plan{}, nil, err
	}
	if key != h.root.Plan.ID {
		return planning.Plan{}, nil, evidence.ErrDenied
	}
	p, err := h.plan(ctx)
	if err != nil {
		return p, nil, err
	}
	state := planning.TaskState{TaskID: p.Tasks[0].ID, PlanDigest: p.Digest, Status: planning.StatusPending}
	if p.Revision < 2 {
		state.Status = planning.StatusWaiting
		return p, []planning.TaskState{state}, nil
	}
	claim, err := h.storage.GetTaskClaim(ctx, p.ID, p.Tasks[0].ID)
	if errors.Is(err, coordination.ErrClaimNotFound) {
		return p, []planning.TaskState{state}, nil
	}
	if err != nil {
		return p, nil, err
	}
	state.Status = planning.StatusRunning
	if !claim.RunID.IsNil() {
		current, getErr := h.storage.GetRun(ctx, claim.RunID)
		if getErr != nil && !errors.Is(getErr, cortex.ErrRunNotFound) {
			return p, nil, getErr
		}
		if current != nil && current.ResultRef != "" {
			receipt, readErr := h.storage.GetCommittedResult(ctx, id.MustParse(current.ResultRef))
			if readErr != nil {
				return p, nil, readErr
			}
			state.Current = receipt.Request.Current
			if authErr := h.verification.authorizeBinding(ctx, state.Current, "read"); authErr != nil {
				return p, nil, authErr
			}
			state.Current.Context.AuthorityRevision = h.verification.authority.AuthorityRevision
			state.Current.Context.PolicyRevision = h.verification.authority.PolicyRevision
			state.Current.Context.EnvironmentRevision = h.verification.authority.ModelRevision
			state.Current.Context.DatasetRevision = h.verification.authority.Record.Revision
			state.Current.Context.Sources = append([]verification.Source(nil), p.Sources...)
		}
	}
	return p, []planning.TaskState{state}, nil
}
