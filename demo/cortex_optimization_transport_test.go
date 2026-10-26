package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xraph/cortex/llm"
)

func TestCortexOptimizationNativeBounds(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var wire struct {
			Model   string `json:"model"`
			Stream  bool   `json:"stream"`
			Think   bool   `json:"think"`
			Options struct {
				Context int `json:"num_ctx"`
				Predict int `json:"num_predict"`
			} `json:"options"`
		}
		if json.NewDecoder(r.Body).Decode(&wire) != nil || wire.Model != "qwen3:4b" || wire.Stream || wire.Think || wire.Options.Context != cortexOptimizationContext || wire.Options.Predict != 128 {
			t.Error("missing native inference limits")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"model":"qwen3:4b","done":true,"done_reason":"stop","message":{"role":"assistant","content":"captured"},"prompt_eval_count":10,"eval_count":4}`))
	}))
	defer server.Close()
	checks := 0
	client := cortexOptimizationModel{endpoint: server.URL + "/api/chat", client: server.Client(), check: func(context.Context) error { checks++; return nil }}
	response, err := client.Complete(context.Background(), &llm.Request{Model: "demo-local", MaxTokens: 128, Messages: []llm.Message{{Role: "user", Content: "record"}}})
	if err != nil || response.Content != "captured" || response.Usage.TotalTokens != 14 || checks != 2 || calls != 1 {
		t.Fatalf("bounded native capture failed: %+v %v", response, err)
	}
	for _, request := range []*llm.Request{{Model: "other", MaxTokens: 128}, {Model: "demo-local", MaxTokens: 1025}, {Model: "demo-local", MaxTokens: 128, Tools: []llm.Tool{{Name: "write"}}}, {Model: "demo-local", MaxTokens: 128, System: strings.Repeat("a", 70000)}} {
		if _, err = client.Complete(context.Background(), request); err == nil {
			t.Fatal("unbounded request accepted")
		}
	}
	if calls != 1 {
		t.Fatal("invalid requests reached provider")
	}
}

func TestCortexOptimizationNativeRejectsUncertainReply(t *testing.T) {
	for _, reply := range []string{`{"model":"qwen3:4b","done":false}`, `{"model":"other","done":true}`, `{"model":"qwen3:4b","done":true,"done_reason":"stop","message":{"role":"assistant","content":"x"},"prompt_eval_count":40000,"eval_count":1}`} {
		t.Run(reply, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { calls++; _, _ = w.Write([]byte(reply)) }))
			defer server.Close()
			client := cortexOptimizationModel{endpoint: server.URL, client: server.Client(), check: func(context.Context) error { return nil }}
			if _, err := client.Complete(context.Background(), &llm.Request{Model: "demo-local", MaxTokens: 128}); err == nil || calls != 1 {
				t.Fatal("unqualified response or implicit retry")
			}
		})
	}
}
