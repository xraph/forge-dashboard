package main

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/agent"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/run"
	sqlitestore "github.com/xraph/cortex/store/sqlite"
	dc "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
)

func cortexTestEngine(t *testing.T, file string) *engine.Engine {
	t.Helper()
	drv := sqlitedriver.New()
	if err := drv.Open(context.Background(), file); err != nil {
		t.Fatal(err)
	}
	db, err := grove.Open(drv)
	if err != nil {
		t.Fatal(err)
	}
	st := sqlitestore.New(db)
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	eng, err := engine.New(engine.WithStore(st), engine.WithLLM(cortexDemoLLM{}))
	if err != nil {
		t.Fatal(err)
	}
	if err := seedCortexDemo(eng); err != nil {
		t.Fatal(err)
	}
	return eng
}
func TestCortexSeedAndRunSurviveRestart(t *testing.T) {
	file := filepath.Join(t.TempDir(), "cortex.db")
	eng := cortexTestEngine(t, file)
	ctx := cortex.WithScope(context.Background(), cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-northwind"}, {Key: "app", Value: "cortex"}}})
	ag, err := eng.GetAgentByName(ctx, "demo-reviewer")
	if err != nil {
		t.Fatal(err)
	}
	if ag.ID.IsNil() || len(ag.Sections) != 1 || ag.PersonaRef != "demo-operator" {
		t.Fatalf("incomplete seed: %+v", ag)
	}
	per, err := eng.GetPersonaByName(ctx, ag.PersonaRef)
	if err != nil || len(per.Skills) != 1 || per.Perception.DetailOrientation != 0.9 {
		t.Fatalf("nested seed: %+v %v", per, err)
	}
	result, err := eng.RunAgent(ctx, ag.Name, "persistent evidence", nil)
	if err != nil || result.State != run.StateCompleted {
		t.Fatalf("run: %+v %v", result, err)
	}
	if err := eng.Store().Close(); err != nil {
		t.Fatal(err)
	}
	eng = cortexTestEngine(t, file)
	rows, err := eng.ListAgents(ctx, &agent.ListFilter{Exact: true})
	if err != nil || len(rows) != 2 {
		t.Fatalf("duplicate seeds: %v %v", rows, err)
	}
	again, err := eng.GetAgentByName(ctx, "demo-reviewer")
	if err != nil || again.ID != ag.ID {
		t.Fatalf("identity changed: %+v %v", again, err)
	}
	if saved, err := eng.GetRun(ctx, result.ID); err != nil || saved.Output != result.Output {
		t.Fatalf("run lost: %+v %v", saved, err)
	}
	foreign := cortex.WithScope(ctx, cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-isolated"}, {Key: "app", Value: "cortex"}}})
	if _, err := eng.GetAgent(foreign, ag.ID); !errors.Is(err, cortex.ErrAgentNotFound) {
		t.Fatalf("foreign resource visible: %v", err)
	}
	if _, err := eng.GetRun(foreign, result.ID); !errors.Is(err, cortex.ErrRunNotFound) {
		t.Fatalf("foreign run visible: %v", err)
	}
}
func TestCortexDemoProviderUsesLatestTurn(t *testing.T) {
	response, err := (cortexDemoLLM{}).Complete(context.Background(), &llm.Request{Messages: []llm.Message{{Role: "tool", Content: "old lookup"}, {Role: "user", Content: "new question"}}})
	if err != nil || response.Content == "Local demonstration: the approved lookup returned old lookup" {
		t.Fatalf("stale tool response: %+v %v", response, err)
	}
	if _, err := cortexDemoModels(context.Background(), map[string]any{"id": "missing"}); !errors.Is(err, dc.ErrNotFound) {
		t.Fatal(err)
	}
	page, err := cortexDemoModels(context.Background(), map[string]any{"search": "no-match"})
	if err != nil || page.(map[string]any)["total"] != 0 {
		t.Fatalf("filter: %+v %v", page, err)
	}
}
