package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/xraph/cortex/llm"
	opt "github.com/xraph/cortex/optimization"
)

const cortexOptimizationContext = 32768
const cortexOptimizationOutput = 1024
const cortexOptimizationRequestBytes = 65536
const cortexOptimizationModelRevision = "ollama/qwen3:4b/" + cortexLocalDigest

// This transport is confined to the local record host. Native options bound the
// entire context, including provider framing, and every generated token.
type cortexOptimizationModel struct {
	outputLimit int
	format      func(*llm.Request) (json.RawMessage, error)
	callTimeout time.Duration
	endpoint    string
	client      *http.Client
	check       func(context.Context) error
	record      func(context.Context, *llm.Request, *llm.Response) error
}

func newCortexOptimizationModel() *cortexOptimizationModel {
	transport := &http.Transport{ResponseHeaderTimeout: 60 * time.Second, DisableKeepAlives: true}
	return &cortexOptimizationModel{endpoint: "http://127.0.0.1:11434/api/chat", client: &http.Client{Transport: transport, Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, check: checkCortexOptimizationModel}
}
func cortexOptimizationRequest(request *llm.Request) ([]byte, error) {
	return cortexOptimizationRequestWithLimit(request, cortexOptimizationOutput)
}
func cortexOptimizationRequestWithLimit(request *llm.Request, outputLimit int) ([]byte, error) {
	if outputLimit != cortexOptimizationOutput && outputLimit != 4096 {
		return nil, opt.ErrInvalidSpec
	}
	if request == nil || request.Model != "demo-local" || request.MaxTokens < 1 || request.MaxTokens > outputLimit || len(request.Tools) != 0 || len(request.Messages) > 32 || !utf8.ValidString(request.System) {
		return nil, opt.ErrInvalidSpec
	}
	type message struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	framingBound := len(request.System) + 512 + (len(request.Messages)+1)*128
	messages := make([]message, 0, len(request.Messages)+1)
	if request.System != "" {
		messages = append(messages, message{"system", request.System})
	}
	for _, m := range request.Messages {
		if (m.Role != "user" && m.Role != "assistant") || len(m.ToolCalls) != 0 || m.ToolCallID != "" || !utf8.ValidString(m.Content) {
			return nil, opt.ErrInvalidSpec
		}
		framingBound += len(m.Content)
		messages = append(messages, message{m.Role, m.Content})
	}
	if framingBound+request.MaxTokens > cortexOptimizationContext {
		return nil, fmt.Errorf("%w: bounded prompt requires %d tokens", opt.ErrInvalidSpec, framingBound+request.MaxTokens)
	}
	temperature := 0.0
	if request.Temperature != nil {
		temperature = *request.Temperature
	}
	if math.IsNaN(temperature) || math.IsInf(temperature, 0) || temperature < 0 || temperature > 1 {
		return nil, opt.ErrInvalidSpec
	}
	body, err := json.Marshal(struct {
		Model    string         `json:"model"`
		Messages []message      `json:"messages"`
		Stream   bool           `json:"stream"`
		Think    bool           `json:"think"`
		Options  map[string]any `json:"options"`
	}{"qwen3:4b", messages, false, false, map[string]any{"num_ctx": cortexOptimizationContext, "num_predict": request.MaxTokens, "temperature": temperature, "seed": 42}})
	if err != nil || len(body) > cortexOptimizationRequestBytes {
		return nil, opt.ErrInvalidSpec
	}
	return body, nil
}
func (c *cortexOptimizationModel) Complete(ctx context.Context, request *llm.Request) (*llm.Response, error) {
	outputLimit := c.outputLimit
	if outputLimit == 0 {
		outputLimit = cortexOptimizationOutput
	}
	timeout := c.callTimeout
	if timeout == 0 {
		timeout = 60 * time.Second
	}
	if timeout < time.Second || timeout > 5*time.Minute {
		return nil, opt.ErrInvalidSpec
	}
	body, err := cortexOptimizationRequestWithLimit(request, outputLimit)
	if err != nil {
		return nil, err
	}
	if c.format != nil {
		format, formatErr := c.format(request)
		if formatErr != nil {
			return nil, formatErr
		}
		var payload map[string]json.RawMessage
		if decodeErr := json.Unmarshal(body, &payload); decodeErr != nil {
			return nil, opt.ErrInvalidSpec
		}
		payload["format"] = format
		framing := len(request.System) + 512 + (len(request.Messages)+1)*128 + len(format) + request.MaxTokens
		for _, message := range request.Messages {
			framing += len(message.Content)
		}
		if len(format) == 0 || !json.Valid(format) || framing > cortexOptimizationContext {
			return nil, opt.ErrInvalidSpec
		}
		body, err = json.Marshal(payload)
		if err != nil || len(body) > cortexOptimizationRequestBytes {
			return nil, opt.ErrInvalidSpec
		}
	}
	if c.check == nil || c.client == nil {
		return nil, opt.ErrUnavailable
	}
	if err = c.check(ctx); err != nil {
		return nil, opt.ErrStaleVersion
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, opt.ErrUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(req)
	if err != nil {
		return nil, opt.ErrUnknownAttempt
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, opt.ErrUnknownAttempt
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 {
		return nil, opt.ErrUnknownAttempt
	}
	var captured struct {
		Model   string `json:"model"`
		Done    bool   `json:"done"`
		Reason  string `json:"done_reason"`
		Error   string `json:"error"`
		Message struct {
			Role    string            `json:"role"`
			Content string            `json:"content"`
			Tools   []json.RawMessage `json:"tool_calls"`
		} `json:"message"`
		Input  int `json:"prompt_eval_count"`
		Output int `json:"eval_count"`
	}
	if json.Unmarshal(data, &captured) != nil || captured.Error != "" || captured.Model != "qwen3:4b" || !captured.Done || captured.Message.Role != "assistant" || len(captured.Message.Tools) != 0 || !utf8.ValidString(captured.Message.Content) || captured.Input <= 0 || captured.Input > cortexOptimizationContext || captured.Output < 0 || captured.Output > request.MaxTokens || (captured.Reason != "stop" && captured.Reason != "length") {
		return nil, opt.ErrUnknownAttempt
	}
	if err = c.check(callCtx); err != nil {
		return nil, opt.ErrStaleVersion
	}
	if operationErr := callCtx.Err(); operationErr != nil {
		return nil, operationErr
	}
	result := &llm.Response{Content: captured.Message.Content, Model: "demo-local", FinishReason: captured.Reason, Usage: llm.Usage{PromptTokens: captured.Input, CompletionTokens: captured.Output, TotalTokens: captured.Input + captured.Output}}
	if c.record != nil {
		if operationErr := c.record(callCtx, request, result); operationErr != nil {
			return nil, operationErr
		}
	}
	return result, nil
}
func (c *cortexOptimizationModel) CompleteStream(context.Context, *llm.Request) (llm.Stream, error) {
	return nil, opt.ErrUnavailable
}
func (c *cortexOptimizationModel) Bound(ctx context.Context, request *llm.Request) (opt.InputTokenBound, error) {
	if _, err := cortexOptimizationRequest(request); err != nil {
		return opt.InputTokenBound{}, err
	}
	if c.check == nil {
		return opt.InputTokenBound{}, opt.ErrUnavailable
	}
	if err := c.check(ctx); err != nil {
		return opt.InputTokenBound{}, errors.Join(opt.ErrStaleVersion, err)
	}
	return opt.InputTokenBound{Model: "demo-local", ModelRevision: cortexOptimizationModelRevision, Tokens: cortexOptimizationContext, Bounded: true}, nil
}

// The pinned Qwen byte-level BPE cannot emit more tokens than input bytes.
// The fixed template's no-tool/no-thinking branches add less than 128 bytes per
// message and 512 fixed bytes. Unknown template or tokenizer metadata fails closed.
func checkCortexOptimizationModel(ctx context.Context) error {
	if err := checkCortexLocalModel(ctx); err != nil {
		return err
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(bounded, http.MethodPost, "http://127.0.0.1:11434/api/show", bytes.NewBufferString(`{"model":"qwen3:4b"}`))
	if err != nil {
		return opt.ErrUnavailable
	}
	request.Header.Set("Content-Type", "application/json")
	transport := &http.Transport{ResponseHeaderTimeout: 5 * time.Second, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		return opt.ErrUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return opt.ErrUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
	if err != nil || len(body) > 4<<20 {
		return opt.ErrUnavailable
	}
	var metadata struct {
		Template string         `json:"template"`
		Info     map[string]any `json:"model_info"`
	}
	if json.Unmarshal(body, &metadata) != nil {
		return opt.ErrUnavailable
	}
	sum := sha256.Sum256([]byte(metadata.Template))
	if hex.EncodeToString(sum[:]) != "2d54db2b9bb29ce7db54fea63a891f5859603813c555b1f88b5e0994652897f9" || metadata.Info["tokenizer.ggml.model"] != "gpt2" || metadata.Info["tokenizer.ggml.pre"] != "qwen2" || metadata.Info["tokenizer.ggml.add_bos_token"] != false {
		return opt.ErrStaleVersion
	}
	return bounded.Err()
}
