package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard"
	dashauth "github.com/xraph/forge/extensions/dashboard/auth"

	ctrlplane "github.com/xraph/ctrlplane"
	"github.com/xraph/ctrlplane/admin"
	"github.com/xraph/ctrlplane/app"
	"github.com/xraph/ctrlplane/auth"
	"github.com/xraph/ctrlplane/bootstrap"
	"github.com/xraph/ctrlplane/datacenter"
	cpext "github.com/xraph/ctrlplane/extension"
	"github.com/xraph/ctrlplane/health"
	"github.com/xraph/ctrlplane/id"
	"github.com/xraph/ctrlplane/network"
	"github.com/xraph/ctrlplane/provider"
	"github.com/xraph/ctrlplane/secrets"
	"github.com/xraph/ctrlplane/store/badger"
	"github.com/xraph/ctrlplane/template"
	"github.com/xraph/ctrlplane/workload"
)

// registerCtrlplaneDemo opts into a persistent control plane with a local
// development identity. Run this demo on a loopback interface for UI review.
func registerCtrlplaneDemo(fapp forge.App, dash *dashboard.Extension) error {
	if !envBool("DEMO_CTRLPLANE", false) {
		return nil
	}
	path := os.Getenv("DEMO_CTRLPLANE_PATH")
	if path == "" {
		path = filepath.Join(os.TempDir(), "forge-dashboard-ctrlplane")
	}
	store, err := badger.New(badger.Config{Path: path, SyncWrites: true})
	if err != nil {
		return err
	}
	cfg := cpext.DefaultConfig()
	cfg.DefaultProvider = "demo-local"
	cfg.AuditEnabled = true
	ext := cpext.New(cpext.WithConfig(cfg), cpext.WithStore(store), cpext.WithAuthProvider(ctrlplaneDemoPolicy{}), cpext.WithProvider("demo-local", &ctrlplaneDemoProvider{store: store}), cpext.WithDisableRoutes())

	return fapp.RegisterExtension(&ctrlplaneDemoExtension{Extension: ext, dash: dash, path: path})
}

type ctrlplaneDemoExtension struct {
	*cpext.Extension
	dash   *dashboard.Extension
	path   string
	cancel context.CancelFunc
}

func (e *ctrlplaneDemoExtension) Register(fapp forge.App) error {
	if err := e.Extension.Register(fapp); err != nil {
		return err
	}
	ext := e.Extension
	dash := e.dash
	path := e.path

	cp := ext.CtrlPlane()
	tenant, err := seedCtrlplaneDemo(cp)
	if err != nil {
		return fmt.Errorf("seed ctrlplane: %w", err)
	}
	role := os.Getenv("DEMO_CTRLPLANE_ROLE")
	if role == "" {
		role = "admin"
	}
	if role != "admin" && role != "tenant" && role != "reader" && role != "denied" {
		return fmt.Errorf("invalid DEMO_CTRLPLANE_ROLE %q", role)
	}
	// Fixed server configuration is deliberate. Request headers and bodies cannot
	// select a different tenant or elevate the development identity.
	dash.SetAuthChecker(dashauth.AuthCheckerFunc(func(_ context.Context, _ *http.Request) (*dashauth.UserInfo, error) {
		scopes := []string{"ctrlplane:read"}
		var roles []string
		if role == "admin" {
			roles = []string{"system:admin"}
		}
		if role == "tenant" {
			scopes = append(scopes, "ctrlplane:write")
		}
		if role == "denied" {
			scopes = nil
		}
		return &dashauth.UserInfo{Subject: "ctrlplane-demo-" + role, DisplayName: "Ctrlplane demo " + role, Roles: roles, Scopes: scopes, Claims: map[string]any{"tenant_id": tenant}, ProviderName: "local-development"}, nil
	}))
	dash.EnableAuth()
	cp.Health.RegisterChecker(ctrlplaneDemoChecker{})
	log.Printf("[ctrlplane] local demo tenant=%s role=%s store=%s; provider operations are simulated", tenant, role, path)
	return nil
}

type ctrlplaneDemoPolicy struct{}

func (ctrlplaneDemoPolicy) Authenticate(context.Context, string) (*auth.Claims, error) {
	return nil, auth.ErrUnauthorized
}
func (ctrlplaneDemoPolicy) GetTenantID(ctx context.Context) string {
	if c := auth.ClaimsFrom(ctx); c != nil {
		return c.TenantID
	}
	return ""
}
func (ctrlplaneDemoPolicy) Authorize(ctx context.Context, req auth.AuthzRequest) (bool, error) {
	c := auth.ClaimsFrom(ctx)
	return c != nil && c.SubjectID != "" && c.SubjectID == req.SubjectID && c.TenantID == req.TenantID, nil
}

func seedCtrlplaneDemo(cp *app.CtrlPlane) (string, error) {
	ctx := auth.WithClaims(context.Background(), &auth.Claims{SubjectID: "ctrlplane-demo-seed", Roles: []string{"system:admin"}})
	tenants, err := cp.Admin.ListTenants(ctx, admin.ListTenantsOptions{Limit: 200})
	if err != nil {
		return "", err
	}
	tenantID := ""
	for _, name := range []string{"Northwind demo", "Isolated demo tenant"} {
		var tenant *admin.Tenant
		for _, row := range tenants.Items {
			if row.ExternalID == "ctrlplane-demo:"+name || row.Name == name {
				tenant = row
				break
			}
		}
		if tenant == nil {
			tenant, err = cp.Admin.CreateTenant(ctx, admin.CreateTenantRequest{Name: name, Plan: "demo", ExternalID: "ctrlplane-demo:" + name})
			if err != nil {
				return "", err
			}
		}
		if tenant.ExternalID == "" {
			tenant.ExternalID = "ctrlplane-demo:" + name
			if err := cp.Store().UpdateTenant(ctx, tenant); err != nil {
				return "", err
			}
		}
		if tenantID == "" {
			tenantID = tenant.ID.String()
		}
		scoped := auth.WithClaims(ctx, &auth.Claims{SubjectID: "ctrlplane-demo-seed", TenantID: tenant.ID.String(), Roles: []string{"system:admin"}})
		if err := seedCtrlplaneTenant(scoped, cp, name); err != nil {
			return "", err
		}
	}
	return tenantID, nil
}

func seedCtrlplaneTenant(ctx context.Context, cp *app.CtrlPlane, tenantName string) error {
	workloads, err := cp.Workloads.List(ctx, workload.ListOptions{Limit: 200})
	if err != nil {
		return err
	}
	// Preserve all saved edits across restarts. Seed each tenant only when its
	// representative workload does not already exist.
	for _, row := range workloads.Items {
		if row.Slug == "orders-api" {
			return nil
		}
	}
	dc, err := cp.Datacenters.GetBySlug(ctx, "chicago-demo")
	if errors.Is(err, ctrlplane.ErrNotFound) {
		dc, err = cp.Datacenters.Create(ctx, datacenter.CreateRequest{Name: "Chicago demo", ProviderName: "demo-local", Region: "us-central-demo", Zone: "local", Location: &datacenter.Location{Country: "US", City: "Chicago", Latitude: 41.88, Longitude: -87.63}, Capacity: &datacenter.Capacity{MaxInstances: 20, MaxCPUMillis: 16000, MaxMemoryMB: 32768}})
	}
	if err != nil {
		return err
	}
	services := []provider.ServiceSpec{
		{Name: "api", Image: "ghcr.io/example/orders:1.0.0", Role: provider.RoleMain, Resources: provider.ResourceSpec{CPUMillis: 500, MemoryMB: 512}, Env: map[string]string{"APP_MODE": "demo", "TENANT_NAME": tenantName}, Ports: []provider.PortSpec{{Container: 8080, Protocol: "http"}}},
		{Name: "metrics", Image: "prom/statsd-exporter:v0.28.0", Role: provider.RoleSidecar, Resources: provider.ResourceSpec{CPUMillis: 100, MemoryMB: 64}},
	}
	templates, err := cp.Templates.List(ctx, template.ListOptions{Limit: 200})
	if err != nil {
		return err
	}
	var tmpl *template.Template
	for _, row := range templates.Items {
		if row.Labels["demo.seed"] == "orders" || row.Name == "Orders with metrics" {
			tmpl = row
			break
		}
	}
	if tmpl == nil {
		tmpl, err = cp.Templates.Create(ctx, template.CreateRequest{Name: "Orders with metrics", Description: "Two-service development blueprint", Services: services, DefaultKind: provider.KindDeployment, DefaultStrategy: "rolling", Labels: map[string]string{"demo.seed": "orders"}, Notes: "Local provider. No containers are started."})
	}
	if err != nil {
		return err
	}
	wl, err := cp.Workloads.Create(ctx, workload.CreateRequest{Name: "Orders API", DatacenterID: dc.ID, ProviderName: "demo-local", Region: dc.Region, FromTemplateID: tmpl.ID, Replicas: 2, Labels: map[string]string{"environment": "demo"}})
	if err != nil {
		return err
	}
	instances, err := cp.Workloads.ListInstances(ctx, wl.ID)
	if err != nil {
		return err
	}
	for index, inst := range instances {
		check, err := cp.Health.Configure(ctx, health.ConfigureRequest{InstanceID: inst.ID, ServiceName: "api", Name: "Demo readiness", Type: health.CheckCustom, Target: "healthy", Interval: time.Minute, Timeout: time.Second})
		if err != nil {
			return err
		}
		result := &health.HealthResult{Entity: ctrlplane.NewEntity(id.PrefixHealthResult), TenantID: inst.TenantID, InstanceID: inst.ID, CheckID: check.ID, Status: health.StatusHealthy, CheckedAt: time.Now().UTC(), Message: "Simulated readiness result"}
		if index == 1 {
			result.Status = health.StatusDegraded
			result.Message = "Simulated degraded replica for review"
		}
		if err := cp.Store().InsertResult(ctx, result); err != nil {
			return err
		}
	}
	if len(instances) != 0 {
		inst := instances[0]
		if _, err := cp.Secrets.Set(ctx, secrets.SetRequest{InstanceID: inst.ID, Key: "DEMO_TOKEN", Value: "local-placeholder", Type: secrets.SecretEnvVar}); err != nil {
			return err
		}
		if _, err := cp.Network.AddDomain(ctx, network.AddDomainRequest{InstanceID: inst.ID, Hostname: strings.ToLower(strings.ReplaceAll(tenantName, " ", "-")) + ".example.test", TLSEnabled: true}); err != nil {
			return err
		}
		if _, err := cp.Network.AddRoute(ctx, network.AddRouteRequest{InstanceID: inst.ID, ServiceName: "api", Path: "/orders", Port: 8080, Protocol: "http", Weight: 100, StripPrefix: true, TLSVerify: boolPointer(true)}); err != nil {
			return err
		}
	}
	bw := bootstrap.NewBootstrapWorkload()
	bw.DatacenterID = dc.ID
	bw.Name = "Demo queue"
	bw.Kind = provider.KindDeployment
	bw.Services = []provider.ServiceSpec{{Name: "queue", Image: "demo:fail-demo", Role: provider.RoleMain}}
	bw.State = bootstrap.StateFailed
	bw.Attempts = 2
	bw.LastError = "Simulated bootstrap failure. Retry requeues the persisted record."
	if err := cp.Store().InsertBootstrap(ctx, bw); err != nil {
		return err
	}
	return nil
}

type ctrlplaneDemoChecker struct{}

func (ctrlplaneDemoChecker) Type() health.CheckType { return health.CheckCustom }
func (ctrlplaneDemoChecker) Check(_ context.Context, check *health.HealthCheck) (*health.HealthResult, error) {
	if check.Target == "error" {
		return nil, errors.New("simulated checker failure")
	}
	status := health.StatusHealthy
	if check.Target == "unhealthy" {
		status = health.StatusUnhealthy
	}
	return &health.HealthResult{Status: status, CheckedAt: time.Now().UTC(), Message: "Simulated local check"}, nil
}

func boolPointer(value bool) *bool { return &value }

func (e *ctrlplaneDemoExtension) Start(ctx context.Context) error {
	runCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	e.cancel = cancel
	return e.Extension.Start(runCtx)
}
func (e *ctrlplaneDemoExtension) Stop(ctx context.Context) error {
	if e.cancel != nil {
		e.cancel()
	}
	return e.Extension.Stop(ctx)
}
