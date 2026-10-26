package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/xraph/cortex/engine"
	"github.com/xraph/cortex/llm"
	nexusadapter "github.com/xraph/cortex/llm/nexus"
	"github.com/xraph/cortex/safety"
	"github.com/xraph/cortex/safety/rules"
	"github.com/xraph/nexus"
	"github.com/xraph/nexus/providers/ollama"
)

// The installed local model is opt-in. A failed real provider never falls back
// to deterministic output. The endpoint is fixed to loopback for this host.
func cortexDemoProvider() (llm.Client, string, []engine.Option, func(context.Context) error, error) {
	switch os.Getenv("DEMO_CORTEX_PROVIDER") {
	case "", "deterministic":
		return cortexDemoLLM{}, "Deterministic local demo provider, no remote LLM", nil, nil, nil
	case "ollama":
		if err := checkCortexLocalModel(context.Background()); err != nil {
			return nil, "", nil, nil, err
		}
		scanner, err := rules.New(rules.Config{Revision: "local-publication-1", MaxBytes: 1 << 20, Rules: []rules.Rule{
			{ID: "private-key", Pattern: `-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----`, Decision: safety.DecisionBlock},
			{ID: "credential", Pattern: `(?i)(?:sk-[a-z0-9_-]{20,}|(?:api[_ -]?key|password|secret)\s*[:=]\s*[a-z0-9_+/=-]{12,})`, Decision: safety.DecisionBlock},
			{ID: "email", Pattern: `[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`, Decision: safety.DecisionRedact, Replacement: "[email]"},
		}})
		if err != nil {
			return nil, "", nil, nil, err
		}
		cfg := nexus.DefaultConfig()
		cfg.DefaultTimeout = 60 * time.Second
		cfg.DefaultMaxRetries = 0
		cfg.EnableUsage = false
		cfg.RequireAPIKey = false
		gateway := nexus.New(nexus.WithConfig(cfg), nexus.WithProvider(ollama.New(ollama.WithBaseURL("http://127.0.0.1:11434/v1"))))
		if err = gateway.Initialize(context.Background()); err != nil {
			return nil, "", nil, nil, err
		}
		client := cortexLocalModel{Client: nexusadapter.New(gateway)}
		return client, "Local Ollama qwen3:4b; credential/email rules local-publication-1", []engine.Option{engine.WithSafety(scanner), engine.WithPublicationGate(safety.ScannerGate{Scanner: scanner}), engine.WithPublicationPolicy(safety.Policy{Version: 1, Mode: safety.ModeBuffered, Required: true}), engine.WithModelRevision("demo-local", "ollama/qwen3:4b/"+cortexLocalDigest)}, gateway.Shutdown, nil
	default:
		return nil, "", nil, nil, errors.New("invalid DEMO_CORTEX_PROVIDER")
	}
}

type cortexLocalModel struct{ llm.Client }

func (c cortexLocalModel) request(ctx context.Context, r *llm.Request) (*llm.Request, error) {
	if r == nil || (r.Model != "demo-local" && r.Model != "qwen3:4b") {
		return nil, errors.New("local qualification model unavailable")
	}
	if err := checkCortexLocalModel(ctx); err != nil {
		return nil, err
	}
	copy := *r
	copy.Model = "qwen3:4b"
	return &copy, nil
}
func (c cortexLocalModel) Complete(ctx context.Context, r *llm.Request) (*llm.Response, error) {
	copy, err := c.request(ctx, r)
	if err != nil {
		return nil, err
	}
	return c.Client.Complete(ctx, copy)
}
func (c cortexLocalModel) CompleteStream(ctx context.Context, r *llm.Request) (llm.Stream, error) {
	copy, err := c.request(ctx, r)
	if err != nil {
		return nil, err
	}
	return c.Client.CompleteStream(ctx, copy)
}

const cortexLocalDigest = "359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7"

func checkCortexLocalModel(ctx context.Context) error {
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(bounded, http.MethodGet, "http://127.0.0.1:11434/api/tags", nil)
	if err != nil {
		return errors.New("local model identity unavailable")
	}
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return errors.New("local model identity unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("local model identity unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return errors.New("local model identity unavailable")
	}
	var inventory struct {
		Models []struct {
			Name   string `json:"name"`
			Digest string `json:"digest"`
		} `json:"models"`
	}
	if json.Unmarshal(data, &inventory) != nil {
		return errors.New("local model identity unavailable")
	}
	for _, model := range inventory.Models {
		if model.Name == "qwen3:4b" && model.Digest == cortexLocalDigest {
			return nil
		}
	}
	return errors.New("local model revision changed or absent")
}
