package main

import (
	"context"

	"github.com/xraph/cortex/coordination"
)

type cortexPlanningReviewerRuntime struct {
	host    *cortexDemoPlanningHost
	runtime coordination.TaskCompletionReviewer
}

func (r cortexPlanningReviewerRuntime) Execute(ctx context.Context, c coordination.TaskCompletion) error {
	if err := r.host.authorize(ctx, "manage"); err != nil {
		return err
	}
	return r.runtime.Execute(r.host.actor(ctx, cortexPlanningReviewer), c)
}
func (r cortexPlanningReviewerRuntime) Observe(ctx context.Context, c coordination.TaskCompletion) (*coordination.Review, error) {
	if err := r.host.authorize(ctx, "manage"); err != nil {
		return nil, err
	}
	return r.runtime.Observe(r.host.actor(ctx, cortexPlanningReviewer), c)
}

type cortexPlanningProposalRuntime struct {
	host    *cortexDemoPlanningHost
	runtime coordination.PlanReplanRuntime
}

func (r cortexPlanningProposalRuntime) ExecutePlanReplan(ctx context.Context, a coordination.PlanReplanAdmission) error {
	if err := r.host.authorize(ctx, "manage"); err != nil {
		return err
	}
	return r.runtime.ExecutePlanReplan(r.host.actor(ctx, cortexPlanningCoordinator), a)
}
