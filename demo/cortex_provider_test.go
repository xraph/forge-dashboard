package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/run"
	"github.com/xraph/cortex/safety"
)

func TestCortexProviderSelectionRejectsUnknown(t *testing.T) {
	t.Setenv("DEMO_CORTEX_PROVIDER", "unknown")
	_, _, _, _, err := cortexDemoProvider()
	if err == nil {
		t.Fatal("unknown provider accepted")
	}
	_, err = (cortexLocalModel{}).request(context.Background(), &llm.Request{Model: "unapproved"})
	if err == nil {
		t.Fatal("unknown model accepted")
	}
}

// This test makes real local inference calls and must be selected explicitly.
// It retains no user content, uses a disposable database and never falls back.
func TestCortexInstalledOllama(t *testing.T) {
	if os.Getenv("CORTEX_QUALIFY_OLLAMA") != "1" {
		t.Skip("explicit installed-provider qualification required")
	}
	t.Setenv("DEMO_CORTEX_PROVIDER", "ollama")
	client, _, options, shutdown, err := cortexDemoProvider()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := shutdown(context.Background()); err != nil {
			t.Error(err)
		}
	})
	options = append(options, engine.WithLLM(client))
	eng := cortexTestEngine(t, filepath.Join(t.TempDir(), "qualification.db"), options...)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	ctx = cortex.WithScope(ctx, cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-northwind"}, {Key: "app", Value: "cortex"}}})
	temperature := 0.0
	overrides := &engine.RunOverrides{ToolsRestricted: true, Tools: []string{}, MaxTokens: 4096, MaxSteps: 2, Temperature: &temperature}
	result, err := eng.RunAgent(ctx, "demo-reviewer", "/no_think Reply exactly CORTEX_LIVE_OK. Do not use tools.", overrides)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != run.StateCompleted || !strings.Contains(result.Output, "CORTEX_LIVE_OK") || result.Provenance.PublicationStatus != safety.StatusApproved {
		t.Fatalf("unexpected live result: state=%s publication=%s", result.State, result.Provenance.PublicationStatus)
	}
	events := make(chan engine.StreamEvent, 16)
	done := make(chan error, 1)
	go func() {
		done <- eng.StreamAgent(ctx, "demo-reviewer", "/no_think Reply exactly CORTEX_STREAM_OK. Do not use tools.", overrides, events)
	}()
	var text strings.Builder
	completed := false
	for event := range events {
		if event.Type == engine.EventToken {
			value, _ := event.Data["content"].(string)
			text.WriteString(value)
		}
		if event.Type == engine.EventDone {
			completed = true
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !completed || !strings.Contains(text.String(), "CORTEX_STREAM_OK") {
		t.Fatal("live stream did not publish checked terminal answer")
	}
	_, err = eng.RunAgent(ctx, "demo-reviewer", "password=qualification_secret_123456789", overrides)
	if !errors.Is(err, safety.ErrBlocked) {
		t.Fatalf("credential input was not blocked: %T", err)
	}
	t.Log("qualified local pinned model: sync, streamed final marker, buffered publication, credential denial")
}
