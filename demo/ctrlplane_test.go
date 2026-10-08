package main

import (
	"context"
	"path/filepath"
	"testing"

	ctrlplane "github.com/xraph/ctrlplane"
	"github.com/xraph/ctrlplane/admin"
	"github.com/xraph/ctrlplane/app"
	"github.com/xraph/ctrlplane/auth"
	"github.com/xraph/ctrlplane/datacenter"
	"github.com/xraph/ctrlplane/store/badger"
	"github.com/xraph/ctrlplane/template"
	"github.com/xraph/ctrlplane/workload"
)

func TestCtrlplaneDemoRestartPreservesEditsAndTenantIsolation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ctrlplane")
	open := func() (*app.CtrlPlane, *badger.Store) {
		t.Helper()
		s, err := badger.New(badger.Config{Path: path, SyncWrites: true})
		if err != nil {
			t.Fatal(err)
		}
		cp, err := app.New(app.WithStore(s), app.WithConfig(ctrlplane.DefaultCtrlPlaneConfig()), app.WithAuth(ctrlplaneDemoPolicy{}), app.WithProvider("demo-local", &ctrlplaneDemoProvider{store: s}), app.WithDefaultProvider("demo-local"))
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
	ctx := auth.WithClaims(context.Background(), &auth.Claims{SubjectID: "test", TenantID: tenantID, Roles: []string{"system:admin"}})
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
	t.Cleanup(func() {
		if err := s.Close(); err != nil {
			t.Error(err)
		}
	})
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
