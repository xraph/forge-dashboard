package main

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	ctrlplane "github.com/xraph/ctrlplane"
	"github.com/xraph/ctrlplane/admin"
	"github.com/xraph/ctrlplane/id"
	"github.com/xraph/ctrlplane/provider"
	"github.com/xraph/ctrlplane/store"
)

// ctrlplaneDemoProvider simulates infrastructure while the real services own
// lifecycle records, releases and audit entries in the persistent store.
type ctrlplaneDemoProvider struct{ store store.Store }

func (*ctrlplaneDemoProvider) Info() provider.ProviderInfo {
	return provider.ProviderInfo{Name: "demo-local", Version: "1", Region: "us-central-demo"}
}
func (*ctrlplaneDemoProvider) Capabilities() []provider.Capability {
	return []provider.Capability{provider.CapProvision, provider.CapDeploy, provider.CapRolling, provider.CapScale}
}
func (*ctrlplaneDemoProvider) Provision(ctx context.Context, req provider.ProvisionRequest) (*provider.ProvisionResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, service := range req.Services {
		if strings.Contains(service.Image, "fail-demo") {
			return nil, fmt.Errorf("demo provision failure for %s", service.Name)
		}
	}
	refs := make(map[string]string)
	for _, service := range req.Services {
		refs[service.Name] = "demo/" + req.InstanceID.String() + "/" + service.Name
	}
	return &provider.ProvisionResult{ProviderRef: "demo/" + req.InstanceID.String(), ServiceRefs: refs, Metadata: map[string]string{"simulated": "true"}}, nil
}
func (*ctrlplaneDemoProvider) Deprovision(ctx context.Context, _ id.ID) error { return ctx.Err() }
func (*ctrlplaneDemoProvider) Start(ctx context.Context, _ id.ID) error       { return ctx.Err() }
func (*ctrlplaneDemoProvider) Stop(ctx context.Context, _ id.ID) error        { return ctx.Err() }
func (*ctrlplaneDemoProvider) Restart(ctx context.Context, _ id.ID) error     { return ctx.Err() }
func (p *ctrlplaneDemoProvider) Status(ctx context.Context, target id.ID) (*provider.InstanceStatus, error) {
	tenants, err := p.store.ListTenants(ctx, admin.ListTenantsOptions{Limit: 200})
	if err != nil {
		return nil, err
	}
	for _, tenant := range tenants.Items {
		inst, err := p.store.GetByID(ctx, tenant.ID.String(), target)
		if err != nil {
			continue
		}
		return &provider.InstanceStatus{State: inst.State, Ready: inst.State == provider.StateRunning, Message: "Simulated local provider"}, nil
	}
	return nil, fmt.Errorf("%w: demo instance %s", ctrlplane.ErrNotFound, target)
}
func (*ctrlplaneDemoProvider) Deploy(ctx context.Context, req provider.DeployRequest) (*provider.DeployResult, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	for _, service := range req.Services {
		if strings.Contains(service.Image, "fail-demo") {
			return nil, fmt.Errorf("demo rollout failure for %s", service.Name)
		}
	}
	return &provider.DeployResult{ProviderRef: "demo/" + req.InstanceID.String(), Status: "succeeded"}, nil
}
func (*ctrlplaneDemoProvider) Rollback(ctx context.Context, _, _ id.ID) error { return ctx.Err() }
func (*ctrlplaneDemoProvider) Scale(ctx context.Context, _ id.ID, _ provider.ResourceSpec) error {
	return ctx.Err()
}
func (*ctrlplaneDemoProvider) Resources(context.Context, id.ID) (*provider.ResourceUsage, error) {
	return nil, fmt.Errorf("%w: simulated provider has no live resource measurements", ctrlplane.ErrNotImplemented)
}
func (*ctrlplaneDemoProvider) Logs(context.Context, id.ID, provider.LogOptions) (io.ReadCloser, error) {
	return nil, fmt.Errorf("%w: simulated provider has no runtime logs", ctrlplane.ErrNotImplemented)
}
func (*ctrlplaneDemoProvider) Exec(context.Context, id.ID, provider.ExecRequest) (*provider.ExecResult, error) {
	return nil, fmt.Errorf("%w: simulated provider cannot execute commands", ctrlplane.ErrNotImplemented)
}
func (*ctrlplaneDemoProvider) HealthCheck(ctx context.Context) (*provider.HealthStatus, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &provider.HealthStatus{Healthy: true, Message: "Local simulation available. No cloud connectivity checked.", CheckedAt: time.Now().UTC()}, nil
}
