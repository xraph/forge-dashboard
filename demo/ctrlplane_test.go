package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	ctrlplane "github.com/xraph/ctrlplane"
	"github.com/xraph/ctrlplane/admin"
	"github.com/xraph/ctrlplane/app"
	"github.com/xraph/ctrlplane/auth"
	"github.com/xraph/ctrlplane/datacenter"
	"github.com/xraph/ctrlplane/managed"
	"github.com/xraph/ctrlplane/store/postgres"
	"github.com/xraph/ctrlplane/template"
	"github.com/xraph/ctrlplane/workload"
)

func TestCtrlplaneDemoRestartPreservesEditsAndTenantIsolation(t *testing.T) {
	testcontainers.SkipIfProviderIsNotHealthy(t)
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	container, err := tcpostgres.Run(ctx, "postgres:16-alpine", tcpostgres.WithDatabase("ctrlplane_demo"), tcpostgres.BasicWaitStrategies())
	if err != nil {
		t.Fatal(err)
	}
	testcontainers.CleanupContainer(t, container)
	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	open := func() (*app.CtrlPlane, *postgres.Store) {
		t.Helper()
		s, err := openCtrlplaneDemoStore(ctx, dsn)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = s.Close() })
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
		cp, err := app.New(app.WithStore(s), app.WithConfig(ctrlplane.DefaultCtrlPlaneConfig()), app.WithAuth(&ctrlplaneDemoPolicy{}), app.WithProvider("demo-local", &ctrlplaneDemoProvider{store: s}), app.WithDefaultProvider("demo-local"))
		if err != nil {
			t.Fatal(err)
		}
		return cp, s
	}
	cp, s := open()
	tenantID, err := seedCtrlplaneDemo(cp)
	if err != nil {
		t.Fatal(err)
	}
	ctx = auth.WithClaims(ctx, &auth.Claims{SubjectID: "test", TenantID: tenantID, Roles: []string{"system:admin"}})
	list, err := cp.Workloads.List(ctx, workload.ListOptions{Limit: 20})
	if err != nil || len(list.Items) != 1 {
		t.Fatalf("workloads = %+v, %v", list, err)
	}
	saved := list.Items[0]
	saved.Name = "Edited orders"
	if err := s.UpdateWorkload(ctx, saved); err != nil {
		t.Fatal(err)
	}
	templates, err := cp.Templates.List(ctx, template.ListOptions{Limit: 20})
	if err != nil || len(templates.Items) != 1 {
		t.Fatalf("templates = %+v, %v", templates, err)
	}
	tmpl := templates.Items[0]
	tmpl.Services[0].Image = "demo:edited"
	if err := s.UpdateTemplate(ctx, tmpl); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	cp, s = open()
	again, err := seedCtrlplaneDemo(cp)
	if err != nil || again != tenantID {
		t.Fatalf("seed = %q, %v", again, err)
	}
	list, err = cp.Workloads.List(ctx, workload.ListOptions{Limit: 20})
	if err != nil || len(list.Items) != 1 || list.Items[0].ID != saved.ID || list.Items[0].Name != saved.Name {
		t.Fatalf("saved workload changed: %+v, %v", list, err)
	}
	templates, err = cp.Templates.List(ctx, template.ListOptions{Limit: 20})
	if err != nil || len(templates.Items) != 1 || templates.Items[0].Services[0].Image != "demo:edited" || len(templates.Items[0].Services) != 2 {
		t.Fatalf("template changed: %+v, %v", templates, err)
	}
	tenants, err := cp.Admin.ListTenants(ctx, admin.ListTenantsOptions{Limit: 20})
	if err != nil || len(tenants.Items) != 2 {
		t.Fatalf("tenants = %+v, %v", tenants, err)
	}
	for _, tenant := range tenants.Items {
		scoped := auth.WithClaims(ctx, &auth.Claims{SubjectID: "test", TenantID: tenant.ID.String()})
		own, err := cp.Workloads.List(scoped, workload.ListOptions{Limit: 20})
		if err != nil || len(own.Items) != 1 || own.Items[0].TenantID != tenant.ID.String() {
			t.Fatalf("tenant workloads = %+v, %v", own, err)
		}
		if tenant.ID.String() != tenantID {
			if _, err := cp.Workloads.Get(scoped, saved.ID); err == nil {
				t.Fatal("foreign workload was readable")
			}
		}
		dcs, err := cp.Datacenters.List(scoped, datacenter.ListOptions{Limit: 20})
		if err != nil || len(dcs.Items) != 1 {
			t.Fatalf("datacenters = %+v, %v", dcs, err)
		}
		bootstraps, err := s.ListBootstraps(scoped, dcs.Items[0].ID)
		if err != nil || len(bootstraps) != 1 {
			t.Fatalf("bootstrap seed = %+v, %v", bootstraps, err)
		}
		replicas, err := cp.Workloads.ListInstances(scoped, own.Items[0].ID)
		if err != nil || len(replicas) != 2 {
			t.Fatalf("replicas = %+v, %v", replicas, err)
		}
		metadata, err := cp.Secrets.List(scoped, replicas[0].ID)
		if err != nil || len(metadata) != 1 || metadata[0].Key != "DEMO_TOKEN" {
			t.Fatalf("secret metadata = %+v, %v", metadata, err)
		}
	}
}

func TestCtrlplaneDemoPolicyIdentity(t *testing.T) {
	policy := &ctrlplaneDemoPolicy{}
	if !managed.SameAuthority(policy, policy) {
		t.Fatal("shared demo policy has no stable identity")
	}
	if managed.SameAuthority(policy, &ctrlplaneDemoPolicy{}) {
		t.Fatal("different demo policies share an identity")
	}
	ctx := auth.WithClaims(t.Context(), &auth.Claims{SubjectID: "operator", TenantID: "tenant"})
	for _, req := range []auth.AuthzRequest{
		{SubjectID: "other", TenantID: "tenant"},
		{SubjectID: "operator", TenantID: "foreign"},
	} {
		if allowed, err := policy.Authorize(ctx, req); err != nil || allowed {
			t.Fatalf("mismatched authority allowed: %v, %v", allowed, err)
		}
	}
}

func TestCtrlplaneDemoDatabaseConfiguration(t *testing.T) {
	t.Setenv("DEMO_CTRLPLANE_PATH", "")
	t.Setenv("DEMO_CTRLPLANE_DATABASE_URL", "")
	if _, err := ctrlplaneDemoDatabaseURL(); err == nil {
		t.Fatal("missing PostgreSQL configuration accepted")
	}
	t.Setenv("DEMO_CTRLPLANE_DATABASE_URL", "postgres://demo:private@localhost/demo")
	t.Setenv("DEMO_CTRLPLANE_PATH", t.TempDir())
	if _, err := ctrlplaneDemoDatabaseURL(); err == nil || !strings.Contains(err.Error(), "Badger") || strings.Contains(err.Error(), "private") {
		t.Fatalf("legacy storage configuration error: %v", err)
	}
	t.Setenv("DEMO_CTRLPLANE_PATH", "")
	if dsn, err := ctrlplaneDemoDatabaseURL(); err != nil || dsn != "postgres://demo:private@localhost/demo" {
		t.Fatalf("database configuration = %q, %v", dsn, err)
	}
}
