package main

import (
	"context"
	"encoding/json"
	"github.com/xraph/forge"
	"github.com/xraph/shield/admin"
	shieldext "github.com/xraph/shield/extension"
	"github.com/xraph/shield/store"
	"os"
	"path/filepath"
	"testing"
)

func TestShieldSeedAndRestartPersistence(t *testing.T) {
	ctx := context.Background()
	file := filepath.Join(t.TempDir(), "shield.db")
	t.Setenv("DEMO_SHIELD_DB", file)
	t.Setenv("DEMO_SHIELD_AUDIT", file+".audit.jsonl")
	ext, close, err := registeredShield(t, ctx)
	if err != nil {
		t.Fatal(err)
	}
	s := ext.Engine().Store().(interface {
		store.Store
		store.DashboardStore
	})
	scope := store.Scope{TenantID: "shield-demo", AppID: "shield-console"}
	page, err := s.DashboardList(ctx, scope, "profiles", store.Filter{})
	if err != nil || page.Total != 1 {
		t.Fatal(page, err)
	}
	svc := admin.New(s, ext.Engine(), nil)
	actor := admin.Actor{Subject: "test", Scope: scope, Read: true, Manage: true}
	created, err := svc.Create(ctx, actor, "boundaries", json.RawMessage(`{"name":"persisted-review","enabled":false,"limits":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	var row struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(created, &row)
	if err = close(); err != nil {
		t.Fatal(err)
	}
	ext, close, err = registeredShield(t, ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer close()
	s = ext.Engine().Store().(interface {
		store.Store
		store.DashboardStore
	})
	page, err = s.DashboardList(ctx, scope, "profiles", store.Filter{})
	if err != nil || page.Total != 1 {
		t.Fatal("duplicate seed", page, err)
	}
	if _, err = s.DashboardGet(ctx, scope, "boundaries", row.ID); err != nil {
		t.Fatal("write lost on restart", err)
	}
	if _, err = s.DashboardGet(ctx, store.Scope{TenantID: "foreign", AppID: "foreign"}, "boundaries", row.ID); err == nil {
		t.Fatal("foreign resource readable")
	}
	if ext.Engine().Capabilities().Evaluation {
		t.Fatal("example data masquerades as evaluation")
	}
	if _, err = os.Stat(file); err != nil {
		t.Fatal(err)
	}
}

func registeredShield(t *testing.T, ctx context.Context) (*shieldext.Extension, func() error, error) {
	t.Helper()
	ext, close, err := newRealShieldExtension(ctx)
	if err != nil {
		return nil, nil, err
	}
	if err = ext.Register(forge.New(forge.WithEnableConfigAutoDiscovery(false))); err != nil {
		_ = close()
		return nil, nil, err
	}
	return ext, close, nil
}
