package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/xraph/cortex"
	"github.com/xraph/cortex/a2a"
	"github.com/xraph/cortex/agent"
	audithook "github.com/xraph/cortex/audit_hook"
	"github.com/xraph/cortex/behavior"
	"github.com/xraph/cortex/engine"
	cext "github.com/xraph/cortex/extension"
	ccontract "github.com/xraph/cortex/extension/contract"
	"github.com/xraph/cortex/id"
	"github.com/xraph/cortex/llm"
	"github.com/xraph/cortex/orchestration"
	"github.com/xraph/cortex/persona"
	"github.com/xraph/cortex/skill"
	sqlitestore "github.com/xraph/cortex/store/sqlite"
	"github.com/xraph/cortex/trait"
	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard"
	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dc "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"
)

// Cortex uses the real engine and disk store. Its local completion provider is
// deterministic demonstration code, never a claim of remote model availability.
func registerCortexDemo(app forge.App, dash *dashboard.Extension) error {
	if !envBool("DEMO_CORTEX", false) {
		return nil
	}
	path := os.Getenv("DEMO_CORTEX_DB")
	if path == "" {
		path = filepath.Join(os.TempDir(), "forge-dashboard-cortex", "cortex.db")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	drv := sqlitedriver.New()
	if err := drv.Open(context.Background(), path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"); err != nil {
		return err
	}
	db, err := grove.Open(drv)
	if err != nil {
		return err
	}
	store := sqlitestore.New(db)
	if err = store.Migrate(context.Background()); err != nil {
		return err
	}
	audit := &cortexDemoAudit{path: path + ".audit.jsonl"}
	tenant := os.Getenv("DEMO_CORTEX_TENANT")
	if tenant == "" {
		tenant = "northwind"
	}
	if tenant != "northwind" && tenant != "isolated" {
		return fmt.Errorf("invalid DEMO_CORTEX_TENANT")
	}
	scope := cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-" + tenant}, {Key: "app", Value: "cortex"}}}
	deps := ccontract.Deps{Audit: func(ctx context.Context, event ccontract.AuditEvent) error { return audit.append(event) }, ExecutionLabel: "Deterministic local demo provider, no remote LLM", ResolveScope: func(_ context.Context, p dc.Principal) (cortex.Scope, error) {
		if p.Claims["cortex_demo_scope"] != scope.Canonical() {
			return cortex.Scope{}, &dc.Error{Code: dc.CodePermissionDenied, Message: "Cortex demo scope is invalid"}
		}
		return scope, nil
	}, Catalogs: map[string]ccontract.CatalogQuery{}}
	deps.Catalogs["models.list"] = cortexDemoModels
	deps.Catalogs["models.detail"] = cortexDemoModels
	cfg := cext.DefaultConfig()
	cfg.DefaultModel = "demo-local"
	cfg.DefaultMaxSteps = 8
	ext := cext.New(cext.WithConfig(cfg), cext.WithStore(store), cext.WithDisableRoutes(), cext.WithDashboard(deps), cext.WithEngineOption(engine.WithLLM(cortexDemoLLM{})), cext.WithEngineOption(engine.WithToolAuthorizer(cortexDemoAuthorizer{})), cext.WithEngineOption(engine.WithA2A(a2a.Options{})), cext.WithEngineOption(engine.WithTool(llm.Tool{Name: "demo_lookup", Description: "Read the local demo record", Parameters: map[string]any{"type": "object", "properties": map[string]any{}}}, func(_ context.Context, inv cortex.Invocation) (string, error) {
		if inv.Principal == nil {
			return "", errors.New("principal required")
		}
		return `{"source":"local-demo","status":"reviewed"}`, nil
	})), cext.WithExtension(audithook.New(audithook.RecorderFunc(func(ctx context.Context, event *audithook.AuditEvent) error {
		return audit.append(map[string]any{"at": time.Now().UTC(), "scope": cortex.ScopeFromContext(ctx), "event": event})
	}))))
	return app.RegisterExtension(&cortexDemoExtension{Extension: ext, dash: dash, path: path, scope: scope})
}

func cortexDemoModels(_ context.Context, raw map[string]any) (any, error) {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var in struct {
		ID       string `json:"id"`
		Search   string `json:"search"`
		Provider string `json:"provider"`
		Limit    int    `json:"limit"`
		Offset   int    `json:"offset"`
	}
	if err := json.Unmarshal(encoded, &in); err != nil {
		return nil, err
	}
	if in.Limit < 0 || in.Limit > 100 || in.Offset < 0 {
		return nil, &dc.Error{Code: dc.CodeBadRequest, Message: "Invalid pagination"}
	}
	if in.Limit == 0 {
		in.Limit = 25
	}
	if in.ID != "" && in.ID != "demo-local" {
		return nil, &dc.Error{Code: dc.CodeNotFound, Message: "Model was not found"}
	}
	total := 1
	if (in.Provider != "" && in.Provider != "local-demo") || (in.Search != "" && !strings.Contains(strings.ToLower("demo-local Deterministic local demo"), strings.ToLower(in.Search))) {
		total = 0
	}
	items := []map[string]any{}
	if total == 1 && in.Offset == 0 {
		items = append(items, map[string]any{"id": "demo-local", "name": "Deterministic local demo", "provider": "local-demo", "context_window": 0, "max_output": 0, "pricing": map[string]any{"free": true}, "capabilities": map[string]bool{"chat": true, "streaming": true, "tools": true}, "availability": "Local simulation. No remote provider is configured."})
	}
	return map[string]any{"available": true, "complete": true, "total": total, "limit": in.Limit, "offset": in.Offset, "items": items}, nil
}

type cortexDemoExtension struct {
	*cext.Extension
	dash  *dashboard.Extension
	path  string
	scope cortex.Scope
}

func (e *cortexDemoExtension) Register(app forge.App) error {
	if err := e.Extension.Register(app); err != nil {
		return err
	}
	if err := seedCortexDemo(e.Engine()); err != nil {
		return err
	}
	role := os.Getenv("DEMO_CORTEX_ROLE")
	if role == "" {
		role = "operator"
	}
	if role != "operator" && role != "reader" && role != "denied" {
		return fmt.Errorf("invalid DEMO_CORTEX_ROLE")
	}
	previous := e.dash.AuthChecker()
	e.dash.SetAuthChecker(dashauth.AuthCheckerFunc(func(ctx context.Context, r *http.Request) (*dashauth.UserInfo, error) {
		var user *dashauth.UserInfo
		if previous != nil {
			var err error
			user, err = previous.CheckAuth(ctx, r)
			if err != nil {
				return nil, err
			}
		}
		if user == nil || !user.Authenticated() {
			user = &dashauth.UserInfo{Subject: "cortex-demo-" + role, DisplayName: "Cortex demo " + role, ProviderName: "local-development"}
		} else {
			copy := *user
			user = &copy
		}
		scopes := []string{}
		for _, scope := range user.Scopes {
			if !strings.HasPrefix(scope, "cortex.") {
				scopes = append(scopes, scope)
			}
		}
		if role != "denied" {
			scopes = append(scopes, "cortex.read")
		}
		if role == "operator" {
			scopes = append(scopes, "cortex.manage", "cortex.run", "cortex.approve", "cortex.overlay")
		}
		user.Scopes = scopes
		claims := map[string]any{}
		for k, v := range user.Claims {
			claims[k] = v
		}
		claims["cortex_demo_scope"] = e.scope.Canonical()
		user.Claims = claims
		return user, nil
	}))
	e.dash.EnableAuth()
	log.Printf("[cortex] real SQLite engine=%s role=%s scope=%s; local completion provider is simulated", e.path, role, e.scope.Canonical())
	return nil
}

type cortexDemoAudit struct {
	mu   sync.Mutex
	path string
}

func (a *cortexDemoAudit) append(event any) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	f, err := os.OpenFile(a.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err = json.NewEncoder(f).Encode(event); err != nil {
		return err
	}
	return f.Sync()
}

type cortexDemoAuthorizer struct{}

func (cortexDemoAuthorizer) Visible(_ context.Context, _ cortex.Subject, tools []llm.Tool) []llm.Tool {
	return tools
}
func (cortexDemoAuthorizer) Authorize(_ context.Context, s cortex.Subject, call llm.ToolCall) error {
	if s.Principal == nil {
		return errors.New("principal required")
	}
	if call.Name == "demo_lookup" {
		return fmt.Errorf("Review the local lookup before execution: %w", cortex.ErrRequiresApproval)
	}
	return nil
}

type cortexDemoLLM struct{}

func (cortexDemoLLM) Complete(_ context.Context, req *llm.Request) (*llm.Response, error) {
	if i := len(req.Messages) - 1; i >= 0 {
		if req.Messages[i].Role == "tool" {
			return &llm.Response{Content: "Local demonstration: the approved lookup returned " + req.Messages[i].Content, FinishReason: "stop", Usage: llm.Usage{TotalTokens: 24}}, nil
		}
	}
	input := ""
	if len(req.Messages) > 0 {
		input = req.Messages[len(req.Messages)-1].Content
	}
	if strings.Contains(strings.ToLower(input), "approval") {
		return &llm.Response{ToolCalls: []llm.ToolCall{{ID: "demo-lookup-1", Name: "demo_lookup", Arguments: "{}"}}, FinishReason: "tool_calls"}, nil
	}
	if strings.Contains(strings.ToLower(input), "fail-demo") {
		return nil, errors.New("requested local demonstration failure")
	}
	return &llm.Response{Content: "Local demonstration response: " + input + "\n\nThis deterministic provider exercises the real Cortex engine and persistence. It does not call a remote model.", FinishReason: "stop", Usage: llm.Usage{PromptTokens: 12, CompletionTokens: 24, TotalTokens: 36}}, nil
}
func (c cortexDemoLLM) CompleteStream(ctx context.Context, req *llm.Request) (llm.Stream, error) {
	response, err := c.Complete(ctx, req)
	if err != nil {
		return nil, err
	}
	return &cortexDemoStream{response: response, words: strings.SplitAfter(response.Content, " ")}, nil
}

type cortexDemoStream struct {
	response *llm.Response
	words    []string
	index    int
	sentTool bool
}

func (s *cortexDemoStream) Next(ctx context.Context) (*llm.Chunk, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(30 * time.Millisecond):
	}
	if len(s.response.ToolCalls) > 0 && !s.sentTool {
		s.sentTool = true
		return &llm.Chunk{ToolCalls: s.response.ToolCalls, FinishReason: "tool_calls"}, nil
	}
	if s.index >= len(s.words) {
		return nil, io.EOF
	}
	word := s.words[s.index]
	s.index++
	return &llm.Chunk{Content: word}, nil
}
func (*cortexDemoStream) Close() error        { return nil }
func (s *cortexDemoStream) Usage() *llm.Usage { return &s.response.Usage }
func seedCortexDemo(eng *engine.Engine) error {
	for _, tenant := range []string{"northwind", "isolated"} {
		ctx := cortex.WithScope(context.Background(), cortex.Scope{Levels: []cortex.Level{{Key: "tenant", Value: "cortex-demo-" + tenant}, {Key: "app", Value: "cortex"}}})
		sk := &skill.Skill{ID: id.NewSkillID(), Entity: cortex.NewEntity()}
		_ = json.Unmarshal([]byte(`{"name":"demo-analysis","description":"Demo seed: evidence review","default_proficiency":"expert","system_prompt_fragment":"Identify sources and separate observations from assumptions.","tools":[{"tool_name":"demo_lookup","mastery":"expert","guidance":"Requires human approval","prefer_when":"An operator requests a lookup"}],"knowledge":[{"source":"demo-manual","inject_mode":"tool","priority":1}],"metadata":{"demo_seed":true}}`), sk)
		if _, err := eng.GetSkillByName(ctx, sk.Name); errors.Is(err, cortex.ErrSkillNotFound) {
			if err = eng.CreateSkill(ctx, sk); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		tr := &trait.Trait{ID: id.NewTraitID(), Entity: cortex.NewEntity()}
		_ = json.Unmarshal([]byte(`{"name":"demo-careful","description":"Demo seed: careful review","category":"workstyle","dimensions":[{"name":"thoroughness","low_label":"Brief","high_label":"Detailed","value":0.8}],"influences":[{"target":"prompt_injection","value":"Check evidence before making a claim.","weight":1}],"metadata":{"demo_seed":true}}`), tr)
		if _, err := eng.GetTraitByName(ctx, tr.Name); errors.Is(err, cortex.ErrTraitNotFound) {
			if err = eng.CreateTrait(ctx, tr); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		bh := &behavior.Behavior{ID: id.NewBehaviorID(), Entity: cortex.NewEntity()}
		_ = json.Unmarshal([]byte(`{"name":"demo-review","description":"Demo seed: stored behavior rule","priority":10,"requires_skill":"demo-analysis","requires_trait":"demo-careful","triggers":[{"type":"on_input","pattern":"review"}],"actions":[{"type":"inject_prompt","value":"Review the source"}],"metadata":{"demo_seed":true}}`), bh)
		if _, err := eng.GetBehaviorByName(ctx, bh.Name); errors.Is(err, cortex.ErrBehaviorNotFound) {
			if err = eng.CreateBehavior(ctx, bh); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		per := &persona.Persona{ID: id.NewPersonaID(), Entity: cortex.NewEntity()}
		_ = json.Unmarshal([]byte(`{"name":"demo-operator","description":"Demo seed: operator identity","identity":"You review agent runs and their evidence.","skills":[{"skill_name":"demo-analysis","proficiency":"expert"}],"traits":[{"trait_name":"demo-careful","dimension_values":{"thoroughness":0.9}}],"behaviors":["demo-review"],"cognitive_style":{"phases":[{"strategy":"analytical","max_steps":3,"transition":"after_steps"}],"depth_preference":0.8},"communication_style":{"tone":"direct","formality":0.4,"verbosity":0.5,"technical_level":0.7,"adapt_to_user":true},"perception":{"context_window":0.8,"detail_orientation":0.9,"attention_filters":[{"name":"sources","keywords":["source"],"prompt":"Check provenance"}]},"metadata":{"demo_seed":true}}`), per)
		if _, err := eng.GetPersonaByName(ctx, per.Name); errors.Is(err, cortex.ErrPersonaNotFound) {
			if err = eng.CreatePersona(ctx, per); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		for _, name := range []string{"demo-reviewer", "demo-worker"} {
			ag := &agent.Config{ID: id.NewAgentID(), Entity: cortex.NewEntity()}
			_ = json.Unmarshal([]byte(`{"description":"Demo seed: persistent local review agent","model":"demo-local","enabled":true,"max_steps":8,"max_tokens":4096,"temperature":0.3,"reasoning_loop":"react","persona_ref":"demo-operator","inline_skills":["demo-analysis"],"inline_traits":["demo-careful"],"inline_behaviors":["demo-review"],"tools":["demo_lookup"],"sections":[{"id":"role","body":"Review the input and state the supporting evidence.","order":1000,"source":"host","locked":true}],"metadata":{"demo_seed":true}}`), ag)
			ag.Name = name
			if _, err := eng.GetAgentByName(ctx, name); errors.Is(err, cortex.ErrAgentNotFound) {
				if err = eng.CreateAgent(ctx, ag); err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		orch := &orchestration.Config{ID: id.NewOrchestrationConfigID(), Entity: cortex.NewEntity(), Name: "demo-sequential", Description: "Demo seed: two agents in sequence", Strategy: "sequential", Participants: []orchestration.Participant{{AgentName: "demo-reviewer", Role: "reviewer", Skills: []string{"demo-analysis"}}, {AgentName: "demo-worker", Role: "worker"}}, Metadata: map[string]any{"demo_seed": true}}
		if _, err := eng.GetOrchestrationByName(ctx, orch.Name); errors.Is(err, cortex.ErrOrchestrationNotFound) {
			if err = eng.CreateOrchestration(ctx, orch); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	return nil
}
