# Herald dashboard contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `herald` contract contributor to `forgery/herald` so the React shell can read and drive Herald through 32 intents, with app scoping, ownership checks and write-only credentials enforced on every one.

**Architecture:** A new package `herald/extension/contract` copies Vault's shape: an embedded `manifest.yaml` declaring intents and their `invalidates`, a `Register` that binds typed handlers through forge's dispatcher, one `handlers_*.go` per area, and camelCase wire types in `project.go`. Every handler first resolves the app from the session principal (`scope.go`), then calls Herald's engine methods; nothing writes to the store directly where an engine method exists. Two engine additions keep logic in one place: `CheckRouting` (moved out of the REST API) and `PreviewSend`.

**Tech Stack:** Go 1.26, forge v1.11.2 (`extensions/dashboard/contract`, `dispatcher`, `loader`, `transport`), Herald v1.7.0 engine as pushed at `1d20e81`.

**Spec:** `docs/superpowers/specs/2026-09-30-herald-dashboard-design.md` (the contract section), with `2026-09-30-herald-hardening-design.md` for the engine it builds on. This is plan 1 of 3 for spec 2; the React plugin and the templ retirement are separate plans.

## Global Constraints

- All code lives in `/Users/rexraphael/Work/xraph/forgery/herald` on `main`. No worktrees.
- Other sessions share this checkout. Commit only your own paths: `git add <exact new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a bare directory. Never `--amend`. Never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`.
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution, no em or en dashes. Subject-only is fine.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. Root module stays at 0 issues. If another session's lint run collides ("parallel golangci-lint is running"), retry.
- `go build ./... && go test ./...` passes at the end of every task.
- Contributor name is exactly `herald` (the join key with `packages/plugin-herald`'s `extension`).
- Wire JSON is camelCase. Every request and response type lives in this package; never return a domain struct (`provider.Provider`, `message.Message`, ...) directly.
- Every handler resolves the app with `resolveApp(p, deps)` before anything else. No request field names an app.
- Every by-ID handler loads the row and compares its app; a row from another app answers `NOT_FOUND`, never `PERMISSION_DENIED`.
- Credential values never appear in a response, an error, a log line or an audit event. Key names may.
- Errors go through `deps.mapError(intent, err)`. Anything without a domain meaning becomes `INTERNAL` with a fixed message, logged server-side.
- Commands write an audit event through `h.Audit` with the operator from `actorFrom(p)`. Queries never audit.
- Every command's `invalidates` in `manifest.yaml` follows the spec's command table exactly.
- Messages and inbox use cursor paging (opaque cursor, `limit+1` probe, no total). Providers, templates and scopes come back whole.
- Driver modules under `drivers/` are separate Go modules with `replace github.com/xraph/herald => ../../`; run their commands from inside each module.

## Review Focus

1. A session whose `app_id` claim is present but unusable (`""`, a number, `nil`) must get `PERMISSION_DENIED` from every intent, never a default app's data. Test in Task 13 across all intents.
2. Asking for another app's row by ID must answer `NOT_FOUND` for every by-ID intent (providers, templates, versions, messages, inbox items, scopes). Test in Task 13, asserted per intent.
3. A provider's credential value must never appear in any query response, keyed or unkeyed, nor any `enc:v1:` ciphertext. Test in Task 13.
4. A `send.test` whose provider fails must come back as a normal response with status `failed` and the provider's error, not as a contract error. Test in Task 9.
5. `preferences.optOut` must never make a preference less restrictive: there is no input that sets a channel back on, and repeating it changes nothing. Test in Task 11.

---

## File map

Created in `herald/extension/contract/`: `contract.go`, `manifest.yaml`, `errors.go`, `scope.go`, `operator.go`, `cursor.go`, `project.go`, `handlers_engine.go`, `handlers_providers.go`, `handlers_templates.go`, `handlers_versions.go`, `handlers_messages.go`, `handlers_send.go`, `handlers_inbox.go`, `handlers_preferences.go`, `handlers_scopes.go`, and tests: `helpers_test.go`, `contract_test.go`, `scope_test.go`, `cursor_test.go`, one `handlers_*_test.go` per handlers file, `transport_test.go`, `isolation_test.go`, `canary_test.go`, `sqlite_test.go`.

Created in the root package: `routing.go`, `routing_test.go`, `sendpreview.go`, `sendpreview_test.go`.
Created in `extension/`: `dashboard_aware_test.go`, `contract_wiring_test.go`.

Modified: `go.mod`, `go.sum` (and each `drivers/*/go.mod`/`go.sum` if tidy changes them), `extension/extension.go`, `extension/config.go`, `api/api.go` (routing check moves to the engine), `CHANGELOG.md`, `docs/content/docs/concepts/configuration.mdx`.

---

### Task 1: Move Herald to forge v1.11.2

forge v1.10.0's dashboard transport does not merge a manifest's `invalidates` into the response meta, so against it no dashboard write would refresh any read (Vault's `TestCommandInvalidatesReachTheClient` pins exactly this). Vault runs on v1.11.2. This task moves Herald there before any contract code exists, so anything the bump breaks shows up on its own.

**Files:**
- Modify: `go.mod`, `go.sum`; `drivers/*/go.mod` and `go.sum` only if `go mod tidy` changes them.

- [ ] **Step 1: Record the baseline**

```bash
go build ./... && go test ./... 2>&1 | grep -v "no test files" | tail -20
grep -n "xraph/forge" go.mod
```

Expected: all `ok`; `github.com/xraph/forge v1.10.0`.

- [ ] **Step 2: Bump and tidy**

```bash
go get github.com/xraph/forge@v1.11.2
go mod tidy
grep -n "xraph/forge" go.mod
```

Expected: `github.com/xraph/forge v1.11.2`.

- [ ] **Step 3: Build and test everything, including the API mount test**

```bash
go build ./... && go test -race ./... 2>&1 | grep -v "no test files" | tail -30
```

Expected: all `ok`. Pay attention to `extension/mount_test.go` (`TestMiddlewareGuardsEveryRoute`). It proves host middleware runs on every REST route, and it was written against v1.10.0's router, where only `group.Use` reached sub-groups. If it fails on v1.11.2, the router's group semantics changed: read `internal/router/router_impl.go` in the v1.11.2 module cache (`Group` and `register`), adjust `extension/mount.go` so the middleware reaches every route again, keep the test unchanged, and explain the change in the commit and the report. Never weaken or delete that test.

- [ ] **Step 4: Tidy and test every driver module**

```bash
for m in apns cloudflare discord mailgun messagebird postmark sendgrid ses slack vonage webhook; do
  (cd drivers/$m && go mod tidy && go build ./... && go test ./... 2>&1 | tail -1 | sed "s/^/$m: /")
done
git status --short
```

Expected: eleven `ok` lines. `git status` shows only `go.mod`/`go.sum` files.

- [ ] **Step 5: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git commit --only -m "build: move to forge v1.11.2 so dashboard writes carry their invalidates" -- go.mod go.sum $(git status --short | awk '{print $2}' | grep '^drivers/.*/go\.\(mod\|sum\)$')
git show --stat HEAD
```

Expected: `0 issues`; the commit lists only go.mod/go.sum files.

---

### Task 2: Contract skeleton, app resolution, errors, wiring and `engine.info`

This task creates everything later tasks plug into, and the first intent, `engine.info`, which the React shell needs before any page renders.

**Files:**
- Create: `extension/contract/contract.go`, `manifest.yaml`, `errors.go`, `scope.go`, `operator.go`, `cursor.go`, `project.go`, `handlers_engine.go`
- Create: `extension/contract/helpers_test.go`, `contract_test.go`, `scope_test.go`, `cursor_test.go`, `handlers_engine_test.go`
- Create: `extension/dashboard_aware_test.go`, `extension/contract_wiring_test.go`
- Modify: `extension/extension.go`, `extension/config.go`

**Interfaces:**
- Produces (used by every later task):
  - `type Deps struct { Herald *herald.Herald; Logger forge.Logger; DefaultAppID string; APIProtected func() bool }`
  - `Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error`
  - `var registrars []func(*dispatcher.Dispatcher, Deps) error`: each later task appends its `registerX`
  - `query[I, O any](d, intent string, fn)` and `command[I, O any](d, intent string, fn)` binding helpers
  - `resolveApp(p contract.Principal, deps Deps) (string, error)`
  - `actorFrom(p contract.Principal) string`
  - `(Deps).mapError(intent string, err error) error`, `badRequest(msg string) error`, `notFound(msg string) error`, `conflict(msg string) error`
  - `encodeCursor(offset int) string`, `decodeCursor(s string) (int, error)`, `pageLimit(requested, def, max int) int`
  - `appLabel(appID string) string` ("Default app" for `""`)
  - Test helpers in `helpers_test.go` (package `contract`): `appA`, `appB`, `canary`, `fakeDriver`, `env`, `newEnv(t, opts ...herald.Option) *env`, `withKey() herald.Option`, `as(appID string) contract.Principal`, `codeOf(err) contract.ErrorCode`, `(*env).provider(t, appID, name string) *provider.Provider`, `(*env).template(t, appID, slug, channel string, locales ...string) *template.Template`
  - Extension: `Config.DashboardAppID string` (`dashboard_app_id`), `(*Extension).RegisterContractContributor(disp, reg, wreg) error`

- [ ] **Step 1: Write the failing tests**

`extension/contract/helpers_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"errors"
	"maps"
	"sync"
	"testing"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/herald"
	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/store/memory"
	"github.com/xraph/herald/template"
)

const (
	appA = "app_a"
	appB = "app_b"
	// canary is a credential value that must never leave the server.
	canary = "sk_canary_contract_value"
)

var bg = context.Background()

// fakeDriver is an email driver with a schema: a required secret api_key and
// a base_url setting. It records what it was asked to send.
type fakeDriver struct {
	mu       sync.Mutex
	sent     []*driver.OutboundMessage
	vendorID string
	err      error
}

func (d *fakeDriver) Name() string    { return "fake" }
func (d *fakeDriver) Channel() string { return "email" }

func (d *fakeDriver) Validate(creds, _ map[string]string) error {
	if creds["api_key"] == "" {
		return errors.New("fake: api_key is required")
	}
	return nil
}

func (d *fakeDriver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "api_key", Label: "API key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
		{Key: "from", Label: "From address", Placement: driver.PlacementSetting},
	}
}

func (d *fakeDriver) Send(_ context.Context, m *driver.OutboundMessage) (*driver.DeliveryResult, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	c := *m
	c.Data = maps.Clone(m.Data)
	d.sent = append(d.sent, &c)
	if d.err != nil {
		return nil, d.err
	}
	return &driver.DeliveryResult{ProviderMessageID: d.vendorID, Status: message.StatusSent}, nil
}

type env struct {
	h    *herald.Herald
	st   *memory.Store
	drv  *fakeDriver
	deps Deps
}

func newEnv(t *testing.T, opts ...herald.Option) *env {
	t.Helper()
	st := memory.New()
	drv := &fakeDriver{vendorID: "vendor-1"}
	h, err := herald.New(append([]herald.Option{herald.WithStore(st), herald.WithDriver(drv)}, opts...)...)
	if err != nil {
		t.Fatalf("herald.New: %v", err)
	}
	return &env{h: h, st: st, drv: drv, deps: Deps{Herald: h}}
}

func withKey() herald.Option {
	return herald.WithCredentialKey("k1", bytes.Repeat([]byte{3}, 32))
}

// as is a session for appID with an operator subject.
func as(appID string) dashcontract.Principal {
	return dashcontract.Principal{
		User:   &dashauth.UserInfo{Subject: "operator-1"},
		Claims: map[string]any{"app_id": appID},
	}
}

func codeOf(err error) dashcontract.ErrorCode {
	var ce *dashcontract.Error
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func (e *env) provider(t *testing.T, appID, name string) *provider.Provider {
	t.Helper()
	p := &provider.Provider{
		AppID: appID, Name: name, Channel: "email", Driver: "fake",
		Credentials: map[string]string{"api_key": canary},
		Settings:    map[string]string{"from": "no-reply@example.com"},
		Enabled:     true,
	}
	if err := e.h.CreateProvider(bg, p); err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	return p
}

func (e *env) template(t *testing.T, appID, slug, channel string, locales ...string) *template.Template {
	t.Helper()
	tmpl := &template.Template{
		ID: id.NewTemplateID(), AppID: appID, Slug: slug, Name: "Template " + slug,
		Channel: channel, Category: template.CategoryTransactional, Enabled: true,
		Variables: []template.Variable{{Name: "user_name", Type: "string", Required: true}},
	}
	if err := e.st.CreateTemplate(bg, tmpl); err != nil {
		t.Fatalf("CreateTemplate: %v", err)
	}
	for _, loc := range locales {
		v := &template.Version{
			ID: id.NewTemplateVersionID(), TemplateID: tmpl.ID, Locale: loc,
			Subject: "Hello {{.user_name}}", Text: "Hi {{.user_name}}", Active: true,
		}
		if err := e.st.CreateVersion(bg, v); err != nil {
			t.Fatalf("CreateVersion: %v", err)
		}
	}
	got, err := e.st.GetTemplate(bg, tmpl.ID)
	if err != nil {
		t.Fatalf("GetTemplate: %v", err)
	}
	return got
}
```

`extension/contract/scope_test.go`:

```go
package contract

import (
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestResolveApp(t *testing.T) {
	deps := Deps{DefaultAppID: "configured"}
	cases := []struct {
		name   string
		claims map[string]any
		want   string
		denied bool
	}{
		{"a usable claim wins", map[string]any{"app_id": "app_x"}, "app_x", false},
		{"no claims uses the configured app", nil, "configured", false},
		{"other claims only uses the configured app", map[string]any{"org_id": "o"}, "configured", false},
		{"an empty claim is refused", map[string]any{"app_id": ""}, "", true},
		{"a blank claim is refused", map[string]any{"app_id": "  "}, "", true},
		{"a number is refused", map[string]any{"app_id": 42}, "", true},
		{"nil is refused", map[string]any{"app_id": nil}, "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := resolveApp(dashcontract.Principal{Claims: c.claims}, deps)
			if c.denied {
				if codeOf(err) != dashcontract.CodePermissionDenied || got != "" {
					t.Fatalf("got %q, %v; want PERMISSION_DENIED and no app", got, err)
				}
				return
			}
			if err != nil || got != c.want {
				t.Fatalf("got %q, %v; want %q", got, err, c.want)
			}
		})
	}

	// With nothing configured, an absent claim means the "" app, which is an
	// exact match in every store (pinned by the store conformance suite).
	got, err := resolveApp(dashcontract.Principal{}, Deps{})
	if err != nil || got != "" {
		t.Fatalf("no claim, no config: got %q, %v; want the \"\" app", got, err)
	}
}

func TestActorFrom(t *testing.T) {
	if actorFrom(as(appA)) != "operator-1" {
		t.Error("the subject should be the actor")
	}
	if actorFrom(dashcontract.Principal{}) != "" {
		t.Error("no user means no actor")
	}
}
```

`extension/contract/cursor_test.go`:

```go
package contract

import "testing"

func TestCursorRoundTrip(t *testing.T) {
	for _, n := range []int{0, 1, 25, 10000} {
		got, err := decodeCursor(encodeCursor(n))
		if err != nil || got != n {
			t.Errorf("round trip %d: got %d, %v", n, got, err)
		}
	}
	if got, err := decodeCursor(""); err != nil || got != 0 {
		t.Errorf("empty cursor: got %d, %v; want 0", got, err)
	}
	for _, bad := range []string{"not-base64!", encodeRaw("x:5"), encodeRaw("o:-1"), encodeRaw("o:abc")} {
		if _, err := decodeCursor(bad); codeOf(err) != "BAD_REQUEST" {
			t.Errorf("decodeCursor(%q) = %v, want BAD_REQUEST", bad, err)
		}
	}
}

func TestPageLimit(t *testing.T) {
	cases := []struct{ in, want int }{{0, 25}, {-3, 25}, {10, 10}, {500, 100}}
	for _, c := range cases {
		if got := pageLimit(c.in, 25, 100); got != c.want {
			t.Errorf("pageLimit(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}
```

`extension/contract/handlers_engine_test.go`:

```go
package contract

import (
	"slices"
	"testing"
)

func TestEngineInfo(t *testing.T) {
	e := newEnv(t, withKey())
	e.deps.DefaultAppID = appA
	e.deps.APIProtected = func() bool { return true }

	got, err := engineInfoHandler(e.deps)(bg, engineInfoRequest{}, as(appA))
	if err != nil {
		t.Fatalf("engine.info: %v", err)
	}
	if got.App.ID != appA || got.App.Label != appA {
		t.Errorf("app = %+v", got.App)
	}
	if !got.Encryption.Configured || got.Encryption.KeyID != "k1" || !got.APIProtected {
		t.Errorf("encryption = %+v apiProtected = %v", got.Encryption, got.APIProtected)
	}
	if got.DefaultLocale != "en" || !slices.Contains(got.Channels, "email") {
		t.Errorf("defaultLocale = %q channels = %v", got.DefaultLocale, got.Channels)
	}
	if !slices.Contains(got.TemplateFuncs, "upper") {
		t.Errorf("templateFuncs = %v", got.TemplateFuncs)
	}
	var fake *DriverInfo
	for i := range got.Drivers {
		if got.Drivers[i].Name == "fake" {
			fake = &got.Drivers[i]
		}
	}
	if fake == nil || fake.Channel != "email" || len(fake.Fields) != 3 || !fake.Fields[0].Secret {
		t.Fatalf("fake driver = %+v", fake)
	}
}

func TestEngineInfoLabelsTheDefaultApp(t *testing.T) {
	e := newEnv(t)
	got, err := engineInfoHandler(e.deps)(bg, engineInfoRequest{}, as(""))
	// as("") carries an empty claim, which is refused; use a principal with
	// no claims to reach the "" app.
	if codeOf(err) != "PERMISSION_DENIED" {
		t.Fatalf("an empty claim must be refused, got %+v, %v", got, err)
	}
	got, err = engineInfoHandler(e.deps)(bg, engineInfoRequest{}, noClaims())
	if err != nil || got.App.ID != "" || got.App.Label != "Default app" || got.Encryption.Configured || got.APIProtected {
		t.Fatalf("got %+v, %v", got, err)
	}
}
```

Add to `helpers_test.go`:

```go
// noClaims is a session with an operator and no app claim at all.
func noClaims() dashcontract.Principal {
	return dashcontract.Principal{User: &dashauth.UserInfo{Subject: "operator-1"}}
}

// encodeRaw base64url-encodes s without padding, for building bad cursors.
func encodeRaw(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
```

(and `"encoding/base64"` in its imports).

`extension/contract/contract_test.go`:

```go
package contract

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

func TestRegisterNeedsHerald(t *testing.T) {
	if err := Register(dispatcher.New(nil), dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), Deps{}); err == nil {
		t.Fatal("Register with no Herald: want an error")
	}
}

// TestEveryDeclaredIntentIsRegistered dispatches every intent the manifest
// declares and fails if the dispatcher doesn't know one. A handler's own
// NOT_FOUND or BAD_REQUEST is fine; "not registered" never is, because in the
// browser it only shows up as a 404.
func TestEveryDeclaredIntentIsRegistered(t *testing.T) {
	e := newEnv(t)
	d := dispatcher.New(nil)
	if err := Register(d, dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), e.deps); err != nil {
		t.Fatalf("Register: %v", err)
	}
	m, err := loader.Load(bytes.NewReader(manifestYAML), "herald/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	if len(m.Intents) == 0 {
		t.Fatal("manifest declares no intents")
	}
	for _, intent := range m.Intents {
		req := dashcontract.Request{
			Envelope: "v1", Contributor: ContributorName, Intent: intent.Name, IntentVersion: 1,
			Kind: dashcontract.KindQuery, Params: map[string]any{},
		}
		if intent.Kind == dashcontract.IntentKindCommand {
			req.Kind = dashcontract.KindCommand
			req.Params = nil
			req.Payload = json.RawMessage(`{}`)
		}
		_, _, err := d.Dispatch(bg, req, noClaims())
		if err != nil && strings.Contains(strings.ToLower(err.Error()), "not registered") {
			t.Errorf("%s is declared but not registered: %v", intent.Name, err)
		}
	}
}

// TestEveryCommandDeclaresInvalidates catches a command added without
// telling the client what to refetch, which reads in the browser as a write
// that silently failed.
func TestEveryCommandDeclaresInvalidates(t *testing.T) {
	m, err := loader.Load(bytes.NewReader(manifestYAML), "herald/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	for _, intent := range m.Intents {
		if intent.Kind == dashcontract.IntentKindCommand && len(intent.Invalidates) == 0 {
			t.Errorf("command %s declares no invalidates", intent.Name)
		}
	}
}
```

`extension/dashboard_aware_test.go`:

```go
package extension

import (
	dashboard "github.com/xraph/forge/extensions/dashboard"
)

// The dashboard finds Herald's contract contributor at runtime, so the
// shipped package never imports forge's dashboard root (which drags in its
// templ pages). This keeps the method signature checked against the real
// interface anyway.
var _ dashboard.ContractContributorAware = (*Extension)(nil)
```

`extension/contract_wiring_test.go`:

```go
package extension

import (
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
)

func TestContractContributorNeedsAnInitialisedHerald(t *testing.T) {
	// An extension that was never initialised skips registration quietly
	// rather than panicking the dashboard.
	var e Extension
	if err := e.RegisterContractContributor(dispatcher.New(nil), dashcontract.NewRegistry(), dashcontract.NewWardenRegistry()); err != nil {
		t.Fatalf("uninitialised extension: %v", err)
	}
}
```

Run: `go test ./extension/... 2>&1 | head -20`
Expected: FAIL to compile (package `contract` is empty; `RegisterContractContributor` undefined).

- [ ] **Step 2: The contract package core**

`extension/contract/contract.go`:

```go
// Package contract wires Herald into the Forge dashboard's contract path. It
// registers the `herald` contributor with the dashboard's contract registry
// and answers its intents from the live Herald engine.
//
// This package is the surface the React dashboard shell reads. Every handler
// resolves the app from the session (scope.go) before it reads or writes
// anything, and no request field ever names an app.
package contract

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"

	"github.com/xraph/herald"
)

//go:embed manifest.yaml
var manifestYAML []byte

// ContributorName is the join key with packages/plugin-herald's `extension`
// field. A mismatch hides the React plugin with no error anywhere, because
// that is what an uninstalled extension looks like.
const ContributorName = "herald"

// Deps bundles what the handlers need.
type Deps struct {
	// Herald is the engine. Required.
	Herald *herald.Herald

	// Logger receives an Error-level entry for every error a handler maps to
	// INTERNAL. Optional.
	Logger forge.Logger

	// DefaultAppID is the app a session with no app_id claim reads and
	// writes. Empty means the "" app, where standalone installs keep their
	// data. It is never used for a session whose claim is present but
	// unusable: that session is refused.
	DefaultAppID string

	// APIProtected reports whether the REST API was mounted behind host
	// middleware. Optional; nil reads as false. It's a func because the API is
	// mounted after the contract may be registered.
	APIProtected func() bool
}

// registrars binds each group of intents. Each handlers_*.go file contributes
// one; Register runs them all.
var registrars = []func(*dispatcher.Dispatcher, Deps) error{
	registerEngine,
}

// Register loads and validates the embedded manifest, registers the `herald`
// contributor with reg, and binds every handler against deps.
func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error {
	if deps.Herald == nil {
		return fmt.Errorf("herald/contract: Herald is required")
	}
	m, err := loader.Load(bytes.NewReader(manifestYAML), "herald/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("herald/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("herald/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("herald/contract: register manifest: %w", err)
	}
	for _, bind := range registrars {
		if err := bind(d, deps); err != nil {
			return fmt.Errorf("herald/contract: %w", err)
		}
	}
	return nil
}

// query binds a typed query handler for intent version 1.
func query[I, O any](d *dispatcher.Dispatcher, intent string, fn func(ctx context.Context, in I, p contract.Principal) (O, error)) error {
	if err := dispatcher.RegisterQuery(d, ContributorName, intent, 1, fn); err != nil {
		return fmt.Errorf("register %s: %w", intent, err)
	}
	return nil
}

// command binds a typed command handler for intent version 1.
func command[I, O any](d *dispatcher.Dispatcher, intent string, fn func(ctx context.Context, in I, p contract.Principal) (O, error)) error {
	if err := dispatcher.RegisterCommand(d, ContributorName, intent, 1, fn); err != nil {
		return fmt.Errorf("register %s: %w", intent, err)
	}
	return nil
}
```

`extension/contract/manifest.yaml`:

```yaml
schemaVersion: 1
contributor:
  name: herald
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [herald.read, herald.write]

# No intent below takes an app id. Every handler resolves the app from the
# session principal (scope.go): a usable app_id claim, else the configured
# dashboard_app_id, else the "" app. A claim that is present but unusable is
# refused with PERMISSION_DENIED.
#
# Each command's invalidates follows the spec's command table; the React
# client refreshes through these and nothing else.
intents:
  - { name: engine.info, kind: query, version: 1, capability: read }
```

`extension/contract/scope.go`:

```go
package contract

import (
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

// resolveApp decides which Herald app a dashboard request reads and writes.
//
// Three rules, kept separate on purpose. A usable app_id claim wins. A claim
// that is present but unusable (empty, blank, not a string, nil) is refused:
// that session belongs to some tenant whose claim failed to resolve, and
// answering it with the default app's data is the cross-tenant bug this rule
// exists to stop. Only a session with no claim at all falls back, to the
// configured DefaultAppID, which is "" unless set. "" is a real app in
// Herald (an exact match in every store), not a wildcard.
//
// Nothing on the dashboard path populates Principal.Claims today, so the
// fallback is the behaviour every deployment actually runs.
func resolveApp(p contract.Principal, deps Deps) (string, error) {
	if raw, present := p.Claims["app_id"]; present {
		s, ok := raw.(string)
		if !ok || strings.TrimSpace(s) == "" {
			return "", &contract.Error{Code: contract.CodePermissionDenied, Message: "the app on this session can't be read"}
		}
		return s, nil
	}
	return deps.DefaultAppID, nil
}

// appLabel is how the dashboard names an app in headers.
func appLabel(appID string) string {
	if appID == "" {
		return "Default app"
	}
	return appID
}
```

`extension/contract/operator.go`:

```go
package contract

import (
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

// actorFrom is the operator a command's audit event names: the session's
// subject, trimmed, or "" when there is none. An unattributed write shows no
// actor rather than a wrong one. Only commands call it.
func actorFrom(p contract.Principal) string {
	if p.User == nil {
		return ""
	}
	return strings.TrimSpace(p.User.Subject)
}
```

`extension/contract/cursor.go`:

```go
package contract

import (
	"encoding/base64"
	"strconv"
	"strings"
)

// Cursors are opaque to the client and wrap an offset. Lists that grow
// (messages, inbox) page with them; the handler asks the store for limit+1
// rows to know whether there is a next page, and never computes a total.

func encodeCursor(offset int) string {
	return base64.RawURLEncoding.EncodeToString([]byte("o:" + strconv.Itoa(offset)))
}

func decodeCursor(s string) (int, error) {
	if s == "" {
		return 0, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return 0, badRequest("cursor is not valid")
	}
	n, ok := strings.CutPrefix(string(raw), "o:")
	if !ok {
		return 0, badRequest("cursor is not valid")
	}
	offset, err := strconv.Atoi(n)
	if err != nil || offset < 0 {
		return 0, badRequest("cursor is not valid")
	}
	return offset, nil
}

// pageLimit applies a default to a missing or non-positive limit and caps a
// large one. A page size is a preference, so an oversized one is capped, not
// refused.
func pageLimit(requested, def, maxLimit int) int {
	if requested <= 0 {
		return def
	}
	if requested > maxLimit {
		return maxLimit
	}
	return requested
}

// nextCursor returns the cursor for the page after one that started at offset
// and asked for limit rows, given how many rows came back from a limit+1
// read. It returns "" when there is no next page.
func nextCursor(offset, limit, got int) string {
	if got <= limit {
		return ""
	}
	return encodeCursor(offset + limit)
}
```

`extension/contract/errors.go`:

```go
package contract

import (
	"errors"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/herald"
	"github.com/xraph/herald/credential"
	"github.com/xraph/herald/store"
)

// mapError translates a Herald error into a *contract.Error. An error with no
// domain meaning becomes INTERNAL with a fixed message: its own text never
// reaches the client, because a store or driver error can carry a connection
// string. The domain errors passed through as BAD_REQUEST below name keys and
// IDs only, never a credential value (Herald's hardening pins that).
func mapError(err error) error {
	if err == nil {
		return nil
	}
	var ce *contract.Error
	if errors.As(err, &ce) {
		return ce
	}
	switch {
	case errors.Is(err, store.ErrProviderNotFound):
		return notFound("provider not found")
	case errors.Is(err, store.ErrTemplateNotFound):
		return notFound("template not found")
	case errors.Is(err, store.ErrVersionNotFound):
		return notFound("template version not found")
	case errors.Is(err, store.ErrMessageNotFound):
		return notFound("message not found")
	case errors.Is(err, store.ErrNotificationNotFound):
		return notFound("notification not found")
	case errors.Is(err, store.ErrScopedConfigNotFound):
		return notFound("routing rule not found")
	case errors.Is(err, store.ErrDuplicateSlug):
		return conflict("a template with this slug already exists on this channel")
	case errors.Is(err, store.ErrDuplicateLocale):
		return conflict("this template already has a version for that locale")
	case errors.Is(err, herald.ErrCredentialKeyUnavailable):
		return &contract.Error{Code: contract.CodeUnavailable, Message: "this provider's credentials are encrypted under a key this server doesn't have"}
	case isAny(err, herald.ErrInvalidProvider, herald.ErrInvalidChannel, herald.ErrDriverNotFound,
		herald.ErrNoProviderConfigured, herald.ErrTemplateDisabled, herald.ErrNoVersionForLocale,
		herald.ErrMissingRequiredVariable, herald.ErrTemplateRenderFailed, herald.ErrNoCredentialKey,
		credential.ErrMalformed):
		return badRequest(err.Error())
	default:
		return &contract.Error{Code: contract.CodeInternal, Message: "an internal error occurred"}
	}
}

// mapError maps err and, when the result is INTERNAL and a logger is set,
// logs the underlying error with the intent that hit it, the one case an
// operator can't diagnose from what the client sees.
func (d Deps) mapError(intent string, err error) error {
	mapped := mapError(err)
	if mapped == nil || d.Logger == nil {
		return mapped
	}
	var ce *contract.Error
	if errors.As(mapped, &ce) && ce.Code == contract.CodeInternal {
		d.Logger.Error("herald/contract: internal error answering intent",
			forge.F("intent", intent),
			forge.F("error", err),
		)
	}
	return mapped
}

func isAny(err error, targets ...error) bool {
	for _, t := range targets {
		if errors.Is(err, t) {
			return true
		}
	}
	return false
}

func badRequest(msg string) error {
	return &contract.Error{Code: contract.CodeBadRequest, Message: msg}
}

func notFound(msg string) error {
	return &contract.Error{Code: contract.CodeNotFound, Message: msg}
}

func conflict(msg string) error {
	return &contract.Error{Code: contract.CodeConflict, Message: msg}
}
```

`extension/contract/project.go` (wire types are added here by later tasks; this task starts it):

```go
package contract

// Wire types are camelCase and live in this package. Handlers never return
// a Herald domain struct, so a field added to one can't leak by accident.

// AppRef names the app a session is looking at.
type AppRef struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// FieldInfo describes one value a driver reads.
type FieldInfo struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	Help      string `json:"help,omitempty"`
	Required  bool   `json:"required"`
	Secret    bool   `json:"secret"`
	Placement string `json:"placement"`
}

// DriverInfo is a registered driver. Fields is null for a driver that
// doesn't describe itself, so the form falls back to key/value rows, and
// an empty list for one that needs nothing.
type DriverInfo struct {
	Name    string      `json:"name"`
	Channel string      `json:"channel"`
	Fields  []FieldInfo `json:"fields"`
}
```

- [ ] **Step 3: `engine.info`**

`extension/contract/handlers_engine.go`:

```go
package contract

import (
	"context"
	"sort"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald"
	"github.com/xraph/herald/template"
)

func registerEngine(d *dispatcher.Dispatcher, deps Deps) error {
	return query(d, "engine.info", engineInfoHandler(deps))
}

type engineInfoRequest struct{}

type encryptionInfo struct {
	Configured bool   `json:"configured"`
	KeyID      string `json:"keyId,omitempty"`
}

type engineInfoResponse struct {
	App            AppRef         `json:"app"`
	DefaultLocale  string         `json:"defaultLocale"`
	MaxBatchSize   int            `json:"maxBatchSize"`
	TruncateBodyAt int            `json:"truncateBodyAt"`
	Channels       []string       `json:"channels"`
	Drivers        []DriverInfo   `json:"drivers"`
	TemplateFuncs  []string       `json:"templateFuncs"`
	Encryption     encryptionInfo `json:"encryption"`
	APIProtected   bool           `json:"apiProtected"`
}

// engineInfoHandler answers engine.info: the app in view, engine settings,
// drivers with their field schemas, the template functions, and whether
// credentials are encrypted and the REST API is protected. It replaces the
// templ settings panel and feeds every page header.
func engineInfoHandler(deps Deps) func(context.Context, engineInfoRequest, contract.Principal) (engineInfoResponse, error) {
	return func(_ context.Context, _ engineInfoRequest, p contract.Principal) (engineInfoResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return engineInfoResponse{}, err
		}
		h := deps.Herald
		cfg := h.Config()

		channels := make([]string, 0, len(herald.ValidChannels()))
		for _, c := range herald.ValidChannels() {
			channels = append(channels, c.String())
		}

		names := h.Drivers().Names()
		sort.Strings(names)
		drivers := make([]DriverInfo, 0, len(names))
		for _, name := range names {
			drv, err := h.Drivers().Get(name)
			if err != nil {
				continue
			}
			info := DriverInfo{Name: name, Channel: drv.Channel()}
			if fields, ok := h.Drivers().Describe(name); ok {
				info.Fields = make([]FieldInfo, 0, len(fields))
				for _, f := range fields {
					info.Fields = append(info.Fields, FieldInfo{
						Key: f.Key, Label: f.Label, Help: f.Help,
						Required: f.Required, Secret: f.Secret, Placement: string(f.Placement),
					})
				}
			}
			drivers = append(drivers, info)
		}

		keyID := h.CredentialKeyID()
		protected := false
		if deps.APIProtected != nil {
			protected = deps.APIProtected()
		}
		return engineInfoResponse{
			App:            AppRef{ID: appID, Label: appLabel(appID)},
			DefaultLocale:  cfg.DefaultLocale,
			MaxBatchSize:   cfg.MaxBatchSize,
			TruncateBodyAt: cfg.TruncateBodyAt,
			Channels:       channels,
			Drivers:        drivers,
			TemplateFuncs:  template.NewRenderer().FuncNames(),
			Encryption:     encryptionInfo{Configured: keyID != "", KeyID: keyID},
			APIProtected:   protected,
		}, nil
	}
}
```

- [ ] **Step 4: Wire the extension**

In `extension/config.go`, add to `Config` after `PreviousCredentialsKeys`:

```go
	// DashboardAppID is the app the dashboard shows to a session that carries
	// no app_id claim. Empty means the "" app, where standalone installs keep
	// their data. A session whose claim is present but unusable is refused,
	// never shown this app.
	DashboardAppID string `json:"dashboard_app_id" yaml:"dashboard_app_id" mapstructure:"dashboard_app_id"`
```

In `mergeConfigurations` (extension/extension.go), before the final return:

```go
	if yamlConfig.DashboardAppID == "" && programmaticConfig.DashboardAppID != "" {
		yamlConfig.DashboardAppID = programmaticConfig.DashboardAppID
	}
```

Add to `extension/extension.go` (imports: `dashcontract "github.com/xraph/forge/extensions/dashboard/contract"`, `"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"`, `heraldcontract "github.com/xraph/herald/extension/contract"`):

```go
// RegisterContractContributor implements dashboard.ContractContributorAware.
// It registers the herald contract contributor, which is what the React
// shell reads.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.h == nil {
		// Not initialised: skip quietly rather than take the dashboard down.
		if logger := e.Logger(); logger != nil {
			logger.Warn("herald: not initialised; skipping contract contributor registration")
		}
		return nil
	}
	deps := heraldcontract.Deps{
		Herald:       e.h,
		DefaultAppID: e.config.DashboardAppID,
		APIProtected: e.APIProtected,
	}
	if logger := e.Logger(); logger != nil {
		deps.Logger = logger
	}
	if err := heraldcontract.Register(disp, reg, wreg, deps); err != nil {
		return fmt.Errorf("herald: register contract contributor: %w", err)
	}
	return nil
}
```

`e.Logger()` on a zero `Extension` may panic if `BaseExtension` is nil. If `TestContractContributorNeedsAnInitialisedHerald` panics there, guard with `if e.BaseExtension != nil` before calling `e.Logger()`.

- [ ] **Step 5: Run, lint, commit**

```bash
go test ./extension/... && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/contract.go extension/contract/manifest.yaml extension/contract/errors.go extension/contract/scope.go \
  extension/contract/operator.go extension/contract/cursor.go extension/contract/project.go extension/contract/handlers_engine.go \
  extension/contract/helpers_test.go extension/contract/contract_test.go extension/contract/scope_test.go \
  extension/contract/cursor_test.go extension/contract/handlers_engine_test.go \
  extension/dashboard_aware_test.go extension/contract_wiring_test.go
git commit --only -m "feat(contract): register a herald dashboard contributor and answer engine.info" -- \
  extension/contract extension/dashboard_aware_test.go extension/contract_wiring_test.go extension/extension.go extension/config.go
git show --stat HEAD
```

`extension/contract` is a new directory containing only this task's files, so naming it in `--only` is safe here; check `git show --stat` lists exactly the files above plus `extension.go` and `config.go`. Expected: all `ok`, `0 issues`.

---
### Task 3: `overview.stats`

**Files:**
- Create: `extension/contract/handlers_overview.go`, `extension/contract/handlers_overview_test.go`
- Modify: `extension/contract/contract.go` (append `registerOverview` to `registrars`), `extension/contract/manifest.yaml`

**Interfaces:**
- Consumes: `resolveApp`, `query`, `deps.mapError`; engine `h.Store().CountMessages`, `ListAllProviders`, `ListTemplates`, `h.CredentialStatus`.
- Produces: intent `overview.stats {window}`.

- [ ] **Step 1: Write the failing test**

`extension/contract/handlers_overview_test.go`:

```go
package contract

import (
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
)

func TestOverviewStats(t *testing.T) {
	e := newEnv(t, withKey())
	e.provider(t, appA, "keyed")
	e.template(t, appA, "auth.welcome", "email", "en")      // no fallback
	e.template(t, appA, "auth.goodbye", "email", "en", "") // has a fallback
	e.template(t, appB, "elsewhere", "email", "en")         // another app

	now := time.Now().UTC()
	for _, m := range []*message.Message{
		{ID: id.NewMessageID(), AppID: appA, Channel: "email", Status: message.StatusSent, CreatedAt: now.Add(-time.Hour)},
		{ID: id.NewMessageID(), AppID: appA, Channel: "email", Status: message.StatusFailed, CreatedAt: now.Add(-time.Hour)},
		{ID: id.NewMessageID(), AppID: appA, Channel: "email", Status: message.StatusSent, CreatedAt: now.Add(-48 * time.Hour)},
		{ID: id.NewMessageID(), AppID: appB, Channel: "email", Status: message.StatusSent, CreatedAt: now.Add(-time.Hour)},
	} {
		if err := e.st.CreateMessage(bg, m); err != nil {
			t.Fatal(err)
		}
	}

	got, err := overviewStatsHandler(e.deps)(bg, overviewStatsRequest{Window: "24h"}, as(appA))
	if err != nil {
		t.Fatalf("overview.stats: %v", err)
	}
	total := 0
	for _, c := range got.Counts {
		total += c.N
	}
	if total != 2 {
		t.Errorf("24h window counted %d messages, want 2 (not the 48h-old one, not app_b's): %+v", total, got.Counts)
	}
	if got.Providers.Total != 1 || got.Providers.Enabled != 1 {
		t.Errorf("providers = %+v", got.Providers)
	}
	if got.Credentials.Encrypted != 1 || got.Credentials.Plaintext != 0 {
		t.Errorf("credentials = %+v", got.Credentials)
	}
	if len(got.TemplatesWithoutFallback) != 1 || got.TemplatesWithoutFallback[0].Slug != "auth.welcome" {
		t.Errorf("templatesWithoutFallback = %+v", got.TemplatesWithoutFallback)
	}
	if got.Since.After(now.Add(-23*time.Hour)) || got.Since.Before(now.Add(-25*time.Hour)) {
		t.Errorf("since = %v, want about 24h ago", got.Since)
	}
}

func TestOverviewStatsWindow(t *testing.T) {
	e := newEnv(t)
	if _, err := overviewStatsHandler(e.deps)(bg, overviewStatsRequest{}, as(appA)); err != nil {
		t.Errorf("an empty window should default to 7d: %v", err)
	}
	if _, err := overviewStatsHandler(e.deps)(bg, overviewStatsRequest{Window: "1y"}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("an unknown window: %v, want BAD_REQUEST", err)
	}
}
```

Run: `go test ./extension/contract/ -run OverviewStats` and expect a compile failure.

- [ ] **Step 2: Implement**

`extension/contract/handlers_overview.go`:

```go
package contract

import (
	"context"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald"
)

func registerOverview(d *dispatcher.Dispatcher, deps Deps) error {
	return query(d, "overview.stats", overviewStatsHandler(deps))
}

var overviewWindows = map[string]time.Duration{
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
	"30d": 30 * 24 * time.Hour,
}

type overviewStatsRequest struct {
	Window string `json:"window"`
}

// MessageCount is the number of messages with one status on one channel.
type MessageCount struct {
	Status  string `json:"status"`
	Channel string `json:"channel"`
	N       int    `json:"n"`
}

// TemplateRef points at a template.
type TemplateRef struct {
	ID      string `json:"id"`
	Slug    string `json:"slug"`
	Channel string `json:"channel,omitempty"`
}

type providerTotals struct {
	Total   int `json:"total"`
	Enabled int `json:"enabled"`
}

type credentialTotals struct {
	Plaintext int `json:"plaintext"`
	Encrypted int `json:"encrypted"`
}

type overviewStatsResponse struct {
	Since                    time.Time        `json:"since"`
	Counts                   []MessageCount   `json:"counts"`
	Providers                providerTotals   `json:"providers"`
	Credentials              credentialTotals `json:"credentials"`
	TemplatesWithoutFallback []TemplateRef    `json:"templatesWithoutFallback"`
}

// overviewStatsHandler answers overview.stats: message counts by status and
// channel over a window, provider and credential-protection totals (counted
// per credential value, because protection is a property of each value), and
// the templates with no fallback ("") version, which fail for any locale they
// don't list.
func overviewStatsHandler(deps Deps) func(context.Context, overviewStatsRequest, contract.Principal) (overviewStatsResponse, error) {
	return func(ctx context.Context, in overviewStatsRequest, p contract.Principal) (overviewStatsResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return overviewStatsResponse{}, err
		}
		window := in.Window
		if window == "" {
			window = "7d"
		}
		span, ok := overviewWindows[window]
		if !ok {
			return overviewStatsResponse{}, badRequest("window must be 24h, 7d or 30d")
		}
		since := time.Now().UTC().Add(-span)
		st := deps.Herald.Store()

		counts, err := st.CountMessages(ctx, appID, since)
		if err != nil {
			return overviewStatsResponse{}, deps.mapError("overview.stats", err)
		}
		out := overviewStatsResponse{Since: since, Counts: make([]MessageCount, 0, len(counts)), TemplatesWithoutFallback: []TemplateRef{}}
		for _, c := range counts {
			out.Counts = append(out.Counts, MessageCount{Status: string(c.Status), Channel: c.Channel, N: c.N})
		}

		providers, err := st.ListAllProviders(ctx, appID)
		if err != nil {
			return overviewStatsResponse{}, deps.mapError("overview.stats", err)
		}
		for _, prov := range providers {
			out.Providers.Total++
			if prov.Enabled {
				out.Providers.Enabled++
			}
			for _, s := range deps.Herald.CredentialStatus(prov) {
				if s.Protection == herald.ProtectionAESGCM {
					out.Credentials.Encrypted++
				} else {
					out.Credentials.Plaintext++
				}
			}
		}

		templates, err := st.ListTemplates(ctx, appID)
		if err != nil {
			return overviewStatsResponse{}, deps.mapError("overview.stats", err)
		}
		for _, t := range templates {
			if !hasFallback(t) {
				out.TemplatesWithoutFallback = append(out.TemplatesWithoutFallback, TemplateRef{ID: t.ID.String(), Slug: t.Slug, Channel: t.Channel})
			}
		}
		return out, nil
	}
}
```

Add to `project.go`:

```go
// hasFallback reports whether a template has an active "" version, which
// answers any locale it doesn't list.
func hasFallback(t *template.Template) bool {
	for _, v := range t.Versions {
		if v.Active && v.Locale == "" {
			return true
		}
	}
	return false
}
```

(import `"github.com/xraph/herald/template"` in project.go).

Append `registerOverview` to `registrars` in contract.go, and to manifest.yaml:

```yaml
  - { name: overview.stats, kind: query, version: 1, capability: read }
```

- [ ] **Step 3: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_overview.go extension/contract/handlers_overview_test.go
git commit --only -m "feat(contract): answer overview.stats with counts, protection and fallback coverage" -- \
  extension/contract/handlers_overview.go extension/contract/handlers_overview_test.go extension/contract/project.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---

### Task 4: Provider queries

**Files:**
- Create: `extension/contract/handlers_providers.go`, `extension/contract/handlers_providers_test.go`
- Modify: `contract.go` (append `registerProviders`), `manifest.yaml`, `project.go`

**Interfaces:**
- Consumes: engine `h.GetProvider(ctx, appID, id)`, `h.CredentialStatus`, `h.Drivers().Describe`, store `ListProviders`/`ListAllProviders`/`ListScopedConfigs`.
- Produces: intents `providers.list {channel?}`, `providers.detail {id}`; wire types `CredentialStatus`, `ProviderSummary`, `SettingEntry`, `RouteUse`, `ProviderDetail`; helpers `projectProvider(h, p) ProviderSummary`, `parseProviderID(raw string) (id.ProviderID, error)`, `ownedProvider(ctx, deps, appID, raw) (*provider.Provider, error)`. Task 5 appends commands to `registerProviders`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_providers_test.go`:

```go
package contract

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/scope"
)

func TestProvidersListAndDetail(t *testing.T) {
	e := newEnv(t, withKey())
	mine := e.provider(t, appA, "primary")
	e.provider(t, appB, "theirs")

	list, err := providersListHandler(e.deps)(bg, providersListRequest{}, as(appA))
	if err != nil {
		t.Fatalf("providers.list: %v", err)
	}
	if len(list.Providers) != 1 || list.Providers[0].ID != mine.ID.String() {
		t.Fatalf("list = %+v, want only app_a's provider", list.Providers)
	}
	cred := list.Providers[0].Credentials
	if len(cred) != 1 || cred[0].Key != "api_key" || cred[0].Protection != "aes-256-gcm" || cred[0].KeyID != "k1" {
		t.Errorf("credentials = %+v", cred)
	}

	if err := e.st.SetScopedConfig(bg, &scope.Config{
		ID: id.NewScopedConfigID(), AppID: appA, Scope: scope.ScopeOrg, ScopeID: "org_1", EmailProviderID: mine.ID.String(),
	}); err != nil {
		t.Fatal(err)
	}
	detail, err := providersDetailHandler(e.deps)(bg, providersDetailRequest{ID: mine.ID.String()}, as(appA))
	if err != nil {
		t.Fatalf("providers.detail: %v", err)
	}
	if len(detail.Provider.UsedBy) != 1 || detail.Provider.UsedBy[0].ScopeID != "org_1" || detail.Provider.UsedBy[0].Channel != "email" {
		t.Errorf("usedBy = %+v", detail.Provider.UsedBy)
	}
	if len(detail.Provider.Settings) != 1 || detail.Provider.Settings[0].Key != "from" || detail.Provider.Settings[0].Value == nil {
		t.Errorf("settings = %+v", detail.Provider.Settings)
	}

	raw, _ := json.Marshal(detail)
	if strings.Contains(string(raw), canary) || strings.Contains(string(raw), "enc:v1:") {
		t.Fatalf("providers.detail leaked a credential: %s", raw)
	}
}

func TestProvidersDetailOwnership(t *testing.T) {
	e := newEnv(t)
	theirs := e.provider(t, appB, "theirs")
	_, err := providersDetailHandler(e.deps)(bg, providersDetailRequest{ID: theirs.ID.String()}, as(appA))
	if codeOf(err) != "NOT_FOUND" {
		t.Errorf("another app's provider: %v, want NOT_FOUND", err)
	}
	_, err = providersDetailHandler(e.deps)(bg, providersDetailRequest{ID: "nope"}, as(appA))
	if codeOf(err) != "BAD_REQUEST" {
		t.Errorf("malformed id: %v, want BAD_REQUEST", err)
	}
}

func TestProvidersDetailHidesLegacySecretSettings(t *testing.T) {
	e := newEnv(t)
	p := e.provider(t, appA, "legacy")
	// A row written before placement rules existed, with a secret-schema key
	// in settings, straight into the store.
	stored, _ := e.st.GetProvider(bg, p.ID)
	stored.Settings["api_key"] = canary
	if err := e.st.UpdateProvider(bg, stored); err != nil {
		t.Fatal(err)
	}
	detail, err := providersDetailHandler(e.deps)(bg, providersDetailRequest{ID: p.ID.String()}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range detail.Provider.Settings {
		if s.Key == "api_key" && (s.Value != nil || !s.Secret) {
			t.Errorf("a secret setting came back with its value: %+v", s)
		}
	}
}
```

Run: `go test ./extension/contract/ -run Providers` and expect a compile failure.

- [ ] **Step 2: Wire types**

Add to `project.go` (imports `"maps"`, `"slices"`, `"time"`, `"github.com/xraph/herald"`, `"github.com/xraph/herald/provider"`):

```go
// CredentialStatus is how one stored credential is protected. It never
// carries the value.
type CredentialStatus struct {
	Key        string `json:"key"`
	Protection string `json:"protection"`
	KeyID      string `json:"keyId,omitempty"`
}

// ProviderSummary is a provider as list pages show it.
type ProviderSummary struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Channel     string             `json:"channel"`
	Driver      string             `json:"driver"`
	Priority    int                `json:"priority"`
	Enabled     bool               `json:"enabled"`
	Credentials []CredentialStatus `json:"credentials"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

// SettingEntry is one setting. Value is omitted for a key the driver marks
// secret, which only a row written before placement rules can hold.
type SettingEntry struct {
	Key    string  `json:"key"`
	Value  *string `json:"value,omitempty"`
	Secret bool    `json:"secret"`
}

// RouteUse is a routing rule that sends one channel through a provider.
type RouteUse struct {
	Scope   string `json:"scope"`
	ScopeID string `json:"scopeId"`
	Channel string `json:"channel"`
}

// ProviderDetail is a provider with its settings and the routing rules that
// point at it, so deleting it can warn about what will dangle.
type ProviderDetail struct {
	ProviderSummary
	Settings []SettingEntry `json:"settings"`
	UsedBy   []RouteUse     `json:"usedBy"`
}

func projectProvider(h *herald.Herald, p *provider.Provider) ProviderSummary {
	states := h.CredentialStatus(p)
	creds := make([]CredentialStatus, 0, len(states))
	for _, s := range states {
		creds = append(creds, CredentialStatus{Key: s.Key, Protection: s.Protection, KeyID: s.KeyID})
	}
	return ProviderSummary{
		ID: p.ID.String(), Name: p.Name, Channel: p.Channel, Driver: p.Driver,
		Priority: p.Priority, Enabled: p.Enabled, Credentials: creds,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

func projectSettings(h *herald.Herald, p *provider.Provider) []SettingEntry {
	secret := map[string]bool{}
	if fields, ok := h.Drivers().Describe(p.Driver); ok {
		for _, f := range fields {
			if f.Secret {
				secret[f.Key] = true
			}
		}
	}
	keys := slices.Sorted(maps.Keys(p.Settings))
	out := make([]SettingEntry, 0, len(keys))
	for _, k := range keys {
		entry := SettingEntry{Key: k, Secret: secret[k]}
		if !entry.Secret {
			v := p.Settings[k]
			entry.Value = &v
		}
		out = append(out, entry)
	}
	return out
}
```

- [ ] **Step 3: Handlers**

`extension/contract/handlers_providers.go`:

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/provider"
)

func registerProviders(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "providers.list", providersListHandler(deps)); err != nil {
		return err
	}
	return query(d, "providers.detail", providersDetailHandler(deps))
}

// routedChannels are the scoped-config slots that can name a provider.
var routedChannels = []string{"email", "sms", "push", "webhook", "chat"}

func parseProviderID(raw string) (id.ProviderID, error) {
	pid, err := id.ParseProviderID(strings.TrimSpace(raw))
	if err != nil {
		return id.Nil, badRequest("id is not a provider id")
	}
	return pid, nil
}

// ownedProvider loads a provider of appID. Another app's provider answers
// NOT_FOUND exactly like a missing one.
func ownedProvider(ctx context.Context, deps Deps, appID, raw string) (*provider.Provider, error) {
	pid, err := parseProviderID(raw)
	if err != nil {
		return nil, err
	}
	p, err := deps.Herald.GetProvider(ctx, appID, pid)
	if err != nil {
		return nil, mapError(err)
	}
	return p, nil
}

type providersListRequest struct {
	Channel string `json:"channel"`
}

type providersListResponse struct {
	Providers []ProviderSummary `json:"providers"`
}

func providersListHandler(deps Deps) func(context.Context, providersListRequest, contract.Principal) (providersListResponse, error) {
	return func(ctx context.Context, in providersListRequest, p contract.Principal) (providersListResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return providersListResponse{}, err
		}
		var list []*provider.Provider
		if ch := strings.TrimSpace(in.Channel); ch != "" {
			list, err = deps.Herald.Store().ListProviders(ctx, appID, ch)
		} else {
			list, err = deps.Herald.Store().ListAllProviders(ctx, appID)
		}
		if err != nil {
			return providersListResponse{}, deps.mapError("providers.list", err)
		}
		out := providersListResponse{Providers: make([]ProviderSummary, 0, len(list))}
		for _, prov := range list {
			out.Providers = append(out.Providers, projectProvider(deps.Herald, prov))
		}
		return out, nil
	}
}

type providersDetailRequest struct {
	ID string `json:"id"`
}

type providersDetailResponse struct {
	Provider ProviderDetail `json:"provider"`
}

func providersDetailHandler(deps Deps) func(context.Context, providersDetailRequest, contract.Principal) (providersDetailResponse, error) {
	return func(ctx context.Context, in providersDetailRequest, p contract.Principal) (providersDetailResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return providersDetailResponse{}, err
		}
		prov, err := ownedProvider(ctx, deps, appID, in.ID)
		if err != nil {
			return providersDetailResponse{}, err
		}
		usedBy, err := routesUsing(ctx, deps.Herald, appID, prov.ID.String())
		if err != nil {
			return providersDetailResponse{}, deps.mapError("providers.detail", err)
		}
		return providersDetailResponse{Provider: ProviderDetail{
			ProviderSummary: projectProvider(deps.Herald, prov),
			Settings:        projectSettings(deps.Herald, prov),
			UsedBy:          usedBy,
		}}, nil
	}
}

// routesUsing lists the routing rules in appID that send a channel through
// the provider with providerID.
func routesUsing(ctx context.Context, h *herald.Herald, appID, providerID string) ([]RouteUse, error) {
	cfgs, err := h.Store().ListScopedConfigs(ctx, appID)
	if err != nil {
		return nil, err
	}
	out := []RouteUse{}
	for _, c := range cfgs {
		for _, ch := range routedChannels {
			if c.ProviderIDFor(ch) == providerID {
				out = append(out, RouteUse{Scope: string(c.Scope), ScopeID: c.ScopeID, Channel: ch})
			}
		}
	}
	return out, nil
}
```

Append `registerProviders` to `registrars`; add to manifest.yaml:

```yaml
  - { name: providers.list,   kind: query, version: 1, capability: read }
  - { name: providers.detail, kind: query, version: 1, capability: read }
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_providers.go extension/contract/handlers_providers_test.go
git commit --only -m "feat(contract): list and show providers with credential protection and no values" -- \
  extension/contract/handlers_providers.go extension/contract/handlers_providers_test.go extension/contract/project.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---

### Task 5: Provider commands

**Files:**
- Modify: `extension/contract/handlers_providers.go`, `handlers_providers_test.go`, `manifest.yaml`

**Interfaces:**
- Consumes: Task 4 helpers; engine `h.CreateProvider`, `h.UpdateProvider(ctx, appID, id, herald.ProviderUpdate)`, `h.DeleteProvider`, `h.EncryptStoredCredentials`, `h.Audit`.
- Produces: commands `providers.create`, `providers.update`, `providers.delete`, `providers.encryptStored`; helper `audit(ctx, deps, p, appID, action, resource, resourceID string, meta map[string]string)` in `operator.go`, used by every later command.

- [ ] **Step 1: Write the failing tests**

Append to `handlers_providers_test.go`:

```go
func TestProvidersCreateUpdateDelete(t *testing.T) {
	e := newEnv(t, withKey())

	created, err := providersCreateHandler(e.deps)(bg, providersCreateRequest{
		Name: "primary", Channel: "email", Driver: "fake", Enabled: true,
		Credentials: map[string]string{"api_key": canary},
		Settings:    map[string]string{"from": "no-reply@example.com"},
	}, as(appA))
	if err != nil {
		t.Fatalf("providers.create: %v", err)
	}
	if created.Provider.Credentials[0].Protection != "aes-256-gcm" {
		t.Errorf("created credentials = %+v", created.Provider.Credentials)
	}
	stored, _ := e.st.GetProvider(bg, mustProviderID(t, created.Provider.ID))
	if stored.AppID != appA || !strings.HasPrefix(stored.Credentials["api_key"], "enc:v1:k1:") {
		t.Fatalf("stored = app %q, api_key encrypted %v", stored.AppID, strings.HasPrefix(stored.Credentials["api_key"], "enc:v1:"))
	}

	off := false
	updated, err := providersUpdateHandler(e.deps)(bg, providersUpdateRequest{ID: created.Provider.ID, Enabled: &off}, as(appA))
	if err != nil || updated.Provider.Enabled {
		t.Fatalf("providers.update: %+v, %v", updated, err)
	}
	if again, _ := e.st.GetProvider(bg, stored.ID); again.Credentials["api_key"] != stored.Credentials["api_key"] {
		t.Error("an update that didn't name the credential rewrote it")
	}

	if _, err := providersDeleteHandler(e.deps)(bg, providersDeleteRequest{ID: created.Provider.ID}, as(appB)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("delete from another app: %v, want NOT_FOUND", err)
	}
	del, err := providersDeleteHandler(e.deps)(bg, providersDeleteRequest{ID: created.Provider.ID}, as(appA))
	if err != nil || !del.OK || del.ID != created.Provider.ID {
		t.Fatalf("providers.delete: %+v, %v", del, err)
	}
}

func TestProvidersCreateRefusesBadInputWithoutEchoingValues(t *testing.T) {
	e := newEnv(t)
	cases := []providersCreateRequest{
		{Name: "x", Channel: "sms", Driver: "fake", Credentials: map[string]string{"api_key": canary}},     // wrong channel
		{Name: "x", Channel: "email", Driver: "nope", Credentials: map[string]string{"api_key": canary}},   // unknown driver
		{Name: "x", Channel: "email", Driver: "fake", Credentials: map[string]string{"base_url": canary}}, // target in credentials
		{Name: "x", Channel: "email", Driver: "fake", Settings: map[string]string{"api_key": canary}},     // secret in settings
		{Name: " ", Channel: "email", Driver: "fake", Credentials: map[string]string{"api_key": canary}},   // no name
	}
	for i, c := range cases {
		_, err := providersCreateHandler(e.deps)(bg, c, as(appA))
		if codeOf(err) != "BAD_REQUEST" || strings.Contains(err.Error(), canary) {
			t.Errorf("case %d: %v, want BAD_REQUEST without the value", i, err)
		}
	}
}

func TestProvidersUpdateRetargetNeedsSecrets(t *testing.T) {
	e := newEnv(t, withKey())
	p := e.provider(t, appA, "primary")
	_, err := providersUpdateHandler(e.deps)(bg, providersUpdateRequest{
		ID: p.ID.String(), SetSettings: map[string]string{"base_url": "https://attacker.example"},
	}, as(appA))
	if codeOf(err) != "BAD_REQUEST" {
		t.Fatalf("moving base_url without re-entering secrets: %v, want BAD_REQUEST", err)
	}
	_, err = providersUpdateHandler(e.deps)(bg, providersUpdateRequest{
		ID:             p.ID.String(),
		SetSettings:    map[string]string{"base_url": "https://new.example"},
		SetCredentials: map[string]string{"api_key": "sk_new_value"},
	}, as(appA))
	if err != nil {
		t.Fatalf("moving base_url with the secret re-entered: %v", err)
	}
}

func TestProvidersEncryptStored(t *testing.T) {
	plain := newEnv(t)
	if _, err := providersEncryptStoredHandler(plain.deps)(bg, providersEncryptStoredRequest{}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("no key configured: %v, want BAD_REQUEST", err)
	}
	e := newEnv(t, withKey())
	// A plaintext row written before the key existed.
	p := e.provider(t, appA, "legacy")
	stored, _ := e.st.GetProvider(bg, p.ID)
	stored.Credentials["api_key"] = canary
	_ = e.st.UpdateProvider(bg, stored)

	rep, err := providersEncryptStoredHandler(e.deps)(bg, providersEncryptStoredRequest{}, as(appA))
	if err != nil || rep.Providers != 1 || rep.ValuesEncrypted != 1 {
		t.Fatalf("providers.encryptStored = %+v, %v", rep, err)
	}
}

func mustProviderID(t *testing.T, raw string) id.ProviderID {
	t.Helper()
	pid, err := id.ParseProviderID(raw)
	if err != nil {
		t.Fatal(err)
	}
	return pid
}
```

Run: `go test ./extension/contract/ -run Providers` and expect a compile failure.

- [ ] **Step 2: An audit helper every command uses**

Append to `operator.go` (imports `"context"` and `"github.com/xraph/herald/bridge"`):

```go
// audit records a dashboard command with the operator as actor and the
// resolved app as tenant. meta must never carry a credential value.
func audit(ctx context.Context, deps Deps, p contract.Principal, appID, action, resource, resourceID string, meta map[string]string) {
	deps.Herald.Audit(ctx, bridge.SeverityInfo, bridge.OutcomeSuccess, "dashboard."+action, resource, resourceID, actorFrom(p), appID, "dashboard", meta)
}
```

- [ ] **Step 3: The commands**

Append to `handlers_providers.go`, and extend `registerProviders` so it also binds the four commands with `command(d, "providers.create", providersCreateHandler(deps))` and likewise for `providers.update`, `providers.delete`, `providers.encryptStored`:

```go
type providersCreateRequest struct {
	Name        string            `json:"name"`
	Channel     string            `json:"channel"`
	Driver      string            `json:"driver"`
	Priority    int               `json:"priority"`
	Enabled     bool              `json:"enabled"`
	Credentials map[string]string `json:"credentials"`
	Settings    map[string]string `json:"settings"`
}

type providerResponse struct {
	Provider ProviderSummary `json:"provider"`
}

// providersCreateHandler creates a provider through the engine, which
// validates it and encrypts its credentials when a key is configured.
func providersCreateHandler(deps Deps) func(context.Context, providersCreateRequest, contract.Principal) (providerResponse, error) {
	return func(ctx context.Context, in providersCreateRequest, p contract.Principal) (providerResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return providerResponse{}, err
		}
		prov := &provider.Provider{
			AppID: appID, Name: in.Name, Channel: strings.TrimSpace(in.Channel), Driver: strings.TrimSpace(in.Driver),
			Priority: in.Priority, Enabled: in.Enabled, Credentials: in.Credentials, Settings: in.Settings,
		}
		if err := deps.Herald.CreateProvider(ctx, prov); err != nil {
			return providerResponse{}, deps.mapError("providers.create", err)
		}
		audit(ctx, deps, p, appID, "providers.create", "provider", prov.ID.String(), map[string]string{
			"name": prov.Name, "channel": prov.Channel, "driver": prov.Driver,
		})
		return providerResponse{Provider: projectProvider(deps.Herald, prov)}, nil
	}
}

type providersUpdateRequest struct {
	ID                string            `json:"id"`
	Name              *string           `json:"name"`
	Priority          *int              `json:"priority"`
	Enabled           *bool             `json:"enabled"`
	SetCredentials    map[string]string `json:"setCredentials"`
	RemoveCredentials []string          `json:"removeCredentials"`
	SetSettings       map[string]string `json:"setSettings"`
	RemoveSettings    []string          `json:"removeSettings"`
}

// providersUpdateHandler changes only what the request names. Moving
// base_url or host to a new server requires re-entering the provider's
// secrets in the same request (the engine enforces it).
func providersUpdateHandler(deps Deps) func(context.Context, providersUpdateRequest, contract.Principal) (providerResponse, error) {
	return func(ctx context.Context, in providersUpdateRequest, p contract.Principal) (providerResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return providerResponse{}, err
		}
		pid, err := parseProviderID(in.ID)
		if err != nil {
			return providerResponse{}, err
		}
		prov, err := deps.Herald.UpdateProvider(ctx, appID, pid, herald.ProviderUpdate{
			Name: in.Name, Priority: in.Priority, Enabled: in.Enabled,
			SetCredentials: in.SetCredentials, RemoveCredentials: in.RemoveCredentials,
			SetSettings: in.SetSettings, RemoveSettings: in.RemoveSettings,
		})
		if err != nil {
			return providerResponse{}, deps.mapError("providers.update", err)
		}
		audit(ctx, deps, p, appID, "providers.update", "provider", prov.ID.String(), map[string]string{"name": prov.Name})
		return providerResponse{Provider: projectProvider(deps.Herald, prov)}, nil
	}
}

type providersDeleteRequest struct {
	ID string `json:"id"`
}

type deleteResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id"`
}

func providersDeleteHandler(deps Deps) func(context.Context, providersDeleteRequest, contract.Principal) (deleteResponse, error) {
	return func(ctx context.Context, in providersDeleteRequest, p contract.Principal) (deleteResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return deleteResponse{}, err
		}
		pid, err := parseProviderID(in.ID)
		if err != nil {
			return deleteResponse{}, err
		}
		if err := deps.Herald.DeleteProvider(ctx, appID, pid); err != nil {
			return deleteResponse{}, deps.mapError("providers.delete", err)
		}
		audit(ctx, deps, p, appID, "providers.delete", "provider", pid.String(), nil)
		return deleteResponse{OK: true, ID: pid.String()}, nil
	}
}

type providersEncryptStoredRequest struct{}

type providersEncryptStoredResponse struct {
	Providers        int `json:"providers"`
	ValuesEncrypted  int `json:"valuesEncrypted"`
	AlreadyEncrypted int `json:"alreadyEncrypted"`
}

func providersEncryptStoredHandler(deps Deps) func(context.Context, providersEncryptStoredRequest, contract.Principal) (providersEncryptStoredResponse, error) {
	return func(ctx context.Context, _ providersEncryptStoredRequest, p contract.Principal) (providersEncryptStoredResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return providersEncryptStoredResponse{}, err
		}
		rep, err := deps.Herald.EncryptStoredCredentials(ctx, appID)
		if err != nil {
			return providersEncryptStoredResponse{}, deps.mapError("providers.encryptStored", err)
		}
		audit(ctx, deps, p, appID, "providers.encryptStored", "provider", "", map[string]string{
			"providers": strconv.Itoa(rep.Providers), "values_encrypted": strconv.Itoa(rep.ValuesEncrypted),
		})
		return providersEncryptStoredResponse{Providers: rep.Providers, ValuesEncrypted: rep.ValuesEncrypted, AlreadyEncrypted: rep.AlreadyEncrypted}, nil
	}
}
```

(add `"strconv"` to the imports). Manifest additions, with the spec's invalidates:

```yaml
  - { name: providers.create,        kind: command, version: 1, capability: write, invalidates: [providers.list, providers.detail, overview.stats, send.resolve, scopes.list] }
  - { name: providers.update,        kind: command, version: 1, capability: write, invalidates: [providers.list, providers.detail, overview.stats, send.resolve, scopes.list] }
  - { name: providers.delete,        kind: command, version: 1, capability: write, invalidates: [providers.list, providers.detail, overview.stats, send.resolve, scopes.list] }
  - { name: providers.encryptStored, kind: command, version: 1, capability: write, invalidates: [providers.list, providers.detail, overview.stats] }
```

`send.resolve` and `scopes.list` are declared by later tasks; `loader.Validate` may reject an `invalidates` entry naming an intent the manifest doesn't declare yet. If it does, add those two names in the task that declares them (Tasks 9 and 12) and leave a one-line note in the manifest comment until then. Check by running the tests.

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git commit --only -m "feat(contract): create, update, delete providers and encrypt stored credentials" -- \
  extension/contract/handlers_providers.go extension/contract/handlers_providers_test.go extension/contract/operator.go extension/contract/manifest.yaml
git show --stat HEAD
```

---
### Task 6: Template queries, resolution and preview

**Files:**
- Create: `extension/contract/handlers_templates.go`, `extension/contract/handlers_templates_test.go`
- Modify: `contract.go` (append `registerTemplates`), `manifest.yaml`, `project.go`

**Interfaces:**
- Consumes: `template.Explain`, `template.Resolve`, `(*template.Renderer).Preview`, store `ListTemplates`/`ListTemplatesByChannel`/`GetTemplate`.
- Produces: intents `templates.list {channel?, category?, noFallback?}`, `templates.detail {id}`, `templates.resolve {id, locale}`, `templates.render {templateId?, content, variables?, data}`; wire types `LocaleState`, `TemplateSummary`, `VariableWire`, `VersionWire`, `ResolutionEntry`, `TemplateDetail`; helpers `projectTemplate`, `projectTemplateDetail`, `variablesFromWire`, `parseTemplateID`, `ownedTemplate(ctx, deps, appID, raw) (*template.Template, error)`. Task 7 appends commands.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_templates_test.go`:

```go
package contract

import (
	"strings"
	"testing"

	"github.com/xraph/herald/template"
)

func TestTemplatesListAndDetail(t *testing.T) {
	e := newEnv(t)
	welcome := e.template(t, appA, "auth.welcome", "email", "en")
	e.template(t, appA, "auth.goodbye", "sms", "en", "")
	e.template(t, appB, "theirs", "email", "en")

	list, err := templatesListHandler(e.deps)(bg, templatesListRequest{}, as(appA))
	if err != nil || len(list.Templates) != 2 {
		t.Fatalf("templates.list = %+v, %v", list, err)
	}
	onlyMissing, _ := templatesListHandler(e.deps)(bg, templatesListRequest{NoFallback: true}, as(appA))
	if len(onlyMissing.Templates) != 1 || onlyMissing.Templates[0].Slug != "auth.welcome" || onlyMissing.Templates[0].HasFallback {
		t.Errorf("noFallback filter = %+v", onlyMissing.Templates)
	}
	sms, _ := templatesListHandler(e.deps)(bg, templatesListRequest{Channel: "sms"}, as(appA))
	if len(sms.Templates) != 1 || sms.Templates[0].Slug != "auth.goodbye" {
		t.Errorf("channel filter = %+v", sms.Templates)
	}

	detail, err := templatesDetailHandler(e.deps)(bg, templatesDetailRequest{ID: welcome.ID.String()}, as(appA))
	if err != nil {
		t.Fatalf("templates.detail: %v", err)
	}
	if len(detail.Template.Versions) != 1 || len(detail.Template.Variables) != 1 {
		t.Errorf("detail = %+v", detail.Template)
	}
	// Resolution covers each version's locale, "" and the default locale.
	byLocale := map[string]ResolutionEntry{}
	for _, r := range detail.Resolution {
		byLocale[r.Locale] = r
	}
	if r := byLocale["en"]; r.Match != "exact" || r.VersionID == nil {
		t.Errorf("en resolves %+v", r)
	}
	if r := byLocale[""]; r.Match != "none" || r.VersionID != nil {
		t.Errorf("\"\" resolves %+v, want none: this template has no fallback", r)
	}
}

func TestTemplatesOwnership(t *testing.T) {
	e := newEnv(t)
	theirs := e.template(t, appB, "theirs", "email", "en")
	if _, err := templatesDetailHandler(e.deps)(bg, templatesDetailRequest{ID: theirs.ID.String()}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("templates.detail of another app's template: %v", err)
	}
	if _, err := templatesResolveHandler(e.deps)(bg, templatesResolveRequest{ID: theirs.ID.String(), Locale: "en"}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("templates.resolve of another app's template: %v", err)
	}
	if _, err := templatesRenderHandler(e.deps)(bg, templatesRenderRequest{TemplateID: theirs.ID.String()}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("templates.render of another app's template: %v", err)
	}
}

func TestTemplatesResolveExplainsEveryStep(t *testing.T) {
	e := newEnv(t)
	tmpl := e.template(t, appA, "auth.welcome", "email", "en")
	got, err := templatesResolveHandler(e.deps)(bg, templatesResolveRequest{ID: tmpl.ID.String(), Locale: "fr-CA"}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	if got.Match != "none" || got.VersionID != nil || len(got.Steps) != 3 {
		t.Fatalf("fr-CA on an en-only template = %+v", got)
	}
	if got.Steps[0].Try != "fr-CA" || got.Steps[1].Try != "fr" || got.Steps[2].Try != "" {
		t.Errorf("steps = %+v", got.Steps)
	}
}

func TestTemplatesRender(t *testing.T) {
	e := newEnv(t)
	tmpl := e.template(t, appA, "auth.welcome", "email", "en")

	// Stored variables are used when the request sends none.
	got, err := templatesRenderHandler(e.deps)(bg, templatesRenderRequest{
		TemplateID: tmpl.ID.String(),
		Content:    template.Content{Subject: "Hi {{.user_name}}", Text: "x\n  {{ index .user_name 99 }}"},
		Data:       map[string]any{"user_name": "Ada"},
	}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	if got.Fields[0].Output != "Hi Ada" || !got.Fields[0].Rendered {
		t.Errorf("subject = %+v", got.Fields[0])
	}
	var exec *template.Diagnostic
	for i := range got.Diagnostics {
		if got.Diagnostics[i].Kind == template.KindExec {
			exec = &got.Diagnostics[i]
		}
	}
	if exec == nil || exec.Field != "text" || exec.Line != 2 {
		t.Errorf("exec diagnostic = %+v", exec)
	}

	// Unsaved variable edits are honoured over the stored ones.
	unsaved := []VariableWire{{Name: "code", Type: "string", Required: true}}
	got, err = templatesRenderHandler(e.deps)(bg, templatesRenderRequest{
		TemplateID: tmpl.ID.String(),
		Content:    template.Content{Text: "{{.code}}"},
		Variables:  &unsaved,
	}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	missing := false
	for _, d := range got.Diagnostics {
		if d.Kind == template.KindMissing && strings.Contains(d.Message, `"code"`) {
			missing = true
		}
	}
	if !missing {
		t.Errorf("diagnostics = %+v, want a missing-required error for code", got.Diagnostics)
	}

	// A preview with no template at all still works (the create page uses it).
	if _, err := templatesRenderHandler(e.deps)(bg, templatesRenderRequest{Content: template.Content{Text: "plain"}}, as(appA)); err != nil {
		t.Errorf("render without a template: %v", err)
	}

	big := strings.Repeat("x", maxRenderBytes+1)
	if _, err := templatesRenderHandler(e.deps)(bg, templatesRenderRequest{Content: template.Content{HTML: big}}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("an oversized buffer: %v, want BAD_REQUEST", err)
	}
}
```

Run: `go test ./extension/contract/ -run Templates` and expect a compile failure.

- [ ] **Step 2: Wire types**

Add to `project.go`:

```go
// LocaleState is one version's locale and whether it's live.
type LocaleState struct {
	Locale string `json:"locale"`
	Active bool   `json:"active"`
}

// TemplateSummary is a template as list pages show it.
type TemplateSummary struct {
	ID          string        `json:"id"`
	Slug        string        `json:"slug"`
	Name        string        `json:"name"`
	Channel     string        `json:"channel"`
	Category    string        `json:"category"`
	IsSystem    bool          `json:"isSystem"`
	Enabled     bool          `json:"enabled"`
	Locales     []LocaleState `json:"locales"`
	HasFallback bool          `json:"hasFallback"`
	UpdatedAt   time.Time     `json:"updatedAt"`
}

// VariableWire is a declared template variable.
type VariableWire struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Required    bool   `json:"required"`
	Default     string `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
}

// VersionWire is one locale's content.
type VersionWire struct {
	ID        string    `json:"id"`
	Locale    string    `json:"locale"`
	Subject   string    `json:"subject"`
	HTML      string    `json:"html"`
	Text      string    `json:"text"`
	Title     string    `json:"title"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ResolutionEntry says which version answers a locale and how.
type ResolutionEntry struct {
	Locale    string  `json:"locale"`
	VersionID *string `json:"versionId"`
	Match     string  `json:"match"`
}

// TemplateDetail is a template with its variables and versions.
type TemplateDetail struct {
	TemplateSummary
	Variables []VariableWire `json:"variables"`
	Versions  []VersionWire  `json:"versions"`
}

func projectTemplate(t *template.Template) TemplateSummary {
	locales := make([]LocaleState, 0, len(t.Versions))
	for _, v := range t.Versions {
		locales = append(locales, LocaleState{Locale: v.Locale, Active: v.Active})
	}
	return TemplateSummary{
		ID: t.ID.String(), Slug: t.Slug, Name: t.Name, Channel: t.Channel, Category: t.Category,
		IsSystem: t.IsSystem, Enabled: t.Enabled, Locales: locales, HasFallback: hasFallback(t), UpdatedAt: t.UpdatedAt,
	}
}

func projectVersion(v *template.Version) VersionWire {
	return VersionWire{
		ID: v.ID.String(), Locale: v.Locale, Subject: v.Subject, HTML: v.HTML, Text: v.Text, Title: v.Title,
		Active: v.Active, CreatedAt: v.CreatedAt, UpdatedAt: v.UpdatedAt,
	}
}

func projectTemplateDetail(t *template.Template) TemplateDetail {
	vars := make([]VariableWire, 0, len(t.Variables))
	for _, v := range t.Variables {
		vars = append(vars, VariableWire{Name: v.Name, Type: v.Type, Required: v.Required, Default: v.Default, Description: v.Description})
	}
	versions := make([]VersionWire, 0, len(t.Versions))
	for i := range t.Versions {
		versions = append(versions, projectVersion(&t.Versions[i]))
	}
	return TemplateDetail{TemplateSummary: projectTemplate(t), Variables: vars, Versions: versions}
}

func variablesFromWire(in []VariableWire) []template.Variable {
	out := make([]template.Variable, 0, len(in))
	for _, v := range in {
		typ := strings.TrimSpace(v.Type)
		if typ == "" {
			typ = "string"
		}
		out = append(out, template.Variable{
			Name: strings.TrimSpace(v.Name), Type: typ, Required: v.Required, Default: v.Default, Description: v.Description,
		})
	}
	return out
}
```

(add `"strings"` to project.go's imports).

- [ ] **Step 3: Handlers**

`extension/contract/handlers_templates.go`:

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/template"
)

// maxRenderBytes bounds the editor buffer a preview accepts. Previews run
// on every pause in typing; a template larger than this is not a template.
const maxRenderBytes = 256 << 10

func registerTemplates(d *dispatcher.Dispatcher, deps Deps) error {
	for _, bind := range []func() error{
		func() error { return query(d, "templates.list", templatesListHandler(deps)) },
		func() error { return query(d, "templates.detail", templatesDetailHandler(deps)) },
		func() error { return query(d, "templates.resolve", templatesResolveHandler(deps)) },
		func() error { return query(d, "templates.render", templatesRenderHandler(deps)) },
	} {
		if err := bind(); err != nil {
			return err
		}
	}
	return nil
}

func parseTemplateID(raw string) (id.TemplateID, error) {
	tid, err := id.ParseTemplateID(strings.TrimSpace(raw))
	if err != nil {
		return id.Nil, badRequest("id is not a template id")
	}
	return tid, nil
}

// ownedTemplate loads a template of appID, with its versions. Another app's
// template answers NOT_FOUND exactly like a missing one.
func ownedTemplate(ctx context.Context, deps Deps, appID, raw string) (*template.Template, error) {
	tid, err := parseTemplateID(raw)
	if err != nil {
		return nil, err
	}
	t, err := deps.Herald.Store().GetTemplate(ctx, tid)
	if err != nil {
		return nil, mapError(err)
	}
	if t.AppID != appID {
		return nil, notFound("template not found")
	}
	return t, nil
}

type templatesListRequest struct {
	Channel    string `json:"channel"`
	Category   string `json:"category"`
	NoFallback bool   `json:"noFallback"`
}

type templatesListResponse struct {
	Templates []TemplateSummary `json:"templates"`
}

func templatesListHandler(deps Deps) func(context.Context, templatesListRequest, contract.Principal) (templatesListResponse, error) {
	return func(ctx context.Context, in templatesListRequest, p contract.Principal) (templatesListResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templatesListResponse{}, err
		}
		var list []*template.Template
		if ch := strings.TrimSpace(in.Channel); ch != "" {
			list, err = deps.Herald.Store().ListTemplatesByChannel(ctx, appID, ch)
		} else {
			list, err = deps.Herald.Store().ListTemplates(ctx, appID)
		}
		if err != nil {
			return templatesListResponse{}, deps.mapError("templates.list", err)
		}
		out := templatesListResponse{Templates: make([]TemplateSummary, 0, len(list))}
		for _, t := range list {
			if in.Category != "" && t.Category != in.Category {
				continue
			}
			if in.NoFallback && hasFallback(t) {
				continue
			}
			out.Templates = append(out.Templates, projectTemplate(t))
		}
		return out, nil
	}
}

type templatesDetailRequest struct {
	ID string `json:"id"`
}

type templatesDetailResponse struct {
	Template   TemplateDetail    `json:"template"`
	Resolution []ResolutionEntry `json:"resolution"`
}

// templatesDetailHandler answers templates.detail with the template, its
// variables and versions, and which version answers each locale it has, the
// "" fallback, and the configured default locale.
func templatesDetailHandler(deps Deps) func(context.Context, templatesDetailRequest, contract.Principal) (templatesDetailResponse, error) {
	return func(ctx context.Context, in templatesDetailRequest, p contract.Principal) (templatesDetailResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templatesDetailResponse{}, err
		}
		t, err := ownedTemplate(ctx, deps, appID, in.ID)
		if err != nil {
			return templatesDetailResponse{}, err
		}
		seen := map[string]bool{}
		locales := []string{}
		add := func(l string) {
			if !seen[l] {
				seen[l] = true
				locales = append(locales, l)
			}
		}
		for _, v := range t.Versions {
			add(v.Locale)
		}
		add("")
		add(deps.Herald.Config().DefaultLocale)

		resolution := make([]ResolutionEntry, 0, len(locales))
		for _, l := range locales {
			v, match := template.Resolve(t, l)
			entry := ResolutionEntry{Locale: l, Match: string(match)}
			if v != nil {
				vid := v.ID.String()
				entry.VersionID = &vid
			}
			resolution = append(resolution, entry)
		}
		return templatesDetailResponse{Template: projectTemplateDetail(t), Resolution: resolution}, nil
	}
}

type templatesResolveRequest struct {
	ID     string `json:"id"`
	Locale string `json:"locale"`
}

type resolveStep struct {
	Try       string  `json:"try"`
	Match     string  `json:"match"`
	Found     bool    `json:"found"`
	VersionID *string `json:"versionId,omitempty"`
}

type templatesResolveResponse struct {
	Locale    string        `json:"locale"`
	Steps     []resolveStep `json:"steps"`
	VersionID *string       `json:"versionId"`
	Match     string        `json:"match"`
}

// templatesResolveHandler explains, step by step, which version answers any
// locale, so the locale tester doesn't refetch the whole template per key.
func templatesResolveHandler(deps Deps) func(context.Context, templatesResolveRequest, contract.Principal) (templatesResolveResponse, error) {
	return func(ctx context.Context, in templatesResolveRequest, p contract.Principal) (templatesResolveResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templatesResolveResponse{}, err
		}
		t, err := ownedTemplate(ctx, deps, appID, in.ID)
		if err != nil {
			return templatesResolveResponse{}, err
		}
		locale := strings.TrimSpace(in.Locale)
		steps, v := template.Explain(t, locale)
		out := templatesResolveResponse{Locale: locale, Steps: make([]resolveStep, 0, len(steps)), Match: string(template.MatchNone)}
		for _, s := range steps {
			step := resolveStep{Try: s.Try, Match: string(s.Match), Found: s.Found}
			if s.VersionID != "" {
				vid := s.VersionID
				step.VersionID = &vid
			}
			out.Steps = append(out.Steps, step)
		}
		if v != nil {
			vid := v.ID.String()
			out.VersionID = &vid
			out.Match = string(steps[len(steps)-1].Match)
		}
		return out, nil
	}
}

type templatesRenderRequest struct {
	TemplateID string           `json:"templateId"`
	Content    template.Content `json:"content"`
	Variables  *[]VariableWire  `json:"variables"`
	Data       map[string]any   `json:"data"`
}

// templatesRenderHandler previews an editor buffer with Herald's own
// renderer against sample data. Nothing is sent. Every field renders on its
// own and every problem comes back as a positioned diagnostic. With a
// templateId, its stored variables apply unless the request sends unsaved
// ones.
func templatesRenderHandler(deps Deps) func(context.Context, templatesRenderRequest, contract.Principal) (template.PreviewResult, error) {
	return func(ctx context.Context, in templatesRenderRequest, p contract.Principal) (template.PreviewResult, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return template.PreviewResult{}, err
		}
		c := in.Content
		if len(c.Subject)+len(c.HTML)+len(c.Text)+len(c.Title) > maxRenderBytes {
			return template.PreviewResult{}, badRequest("the template is too large to preview")
		}
		var vars []template.Variable
		if in.TemplateID != "" {
			t, err := ownedTemplate(ctx, deps, appID, in.TemplateID)
			if err != nil {
				return template.PreviewResult{}, err
			}
			vars = t.Variables
		}
		if in.Variables != nil {
			vars = variablesFromWire(*in.Variables)
		}
		return *template.NewRenderer().Preview(c, vars, in.Data), nil
	}
}
```

Append `registerTemplates` to `registrars`; manifest:

```yaml
  - { name: templates.list,    kind: query, version: 1, capability: read }
  - { name: templates.detail,  kind: query, version: 1, capability: read }
  - { name: templates.resolve, kind: query, version: 1, capability: read }
  - { name: templates.render,  kind: query, version: 1, capability: read }
```

Give `templates.render` no `queries:` cache entry: its params carry the whole editor buffer, and a cached preview of an older buffer is exactly what the page must never show.

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_templates.go extension/contract/handlers_templates_test.go
git commit --only -m "feat(contract): list, show, resolve and preview templates" -- \
  extension/contract/handlers_templates.go extension/contract/handlers_templates_test.go extension/contract/project.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---

### Task 7: Template and version commands

**Files:**
- Create: `extension/contract/handlers_versions.go`, `extension/contract/handlers_versions_test.go`
- Modify: `handlers_templates.go`, `handlers_templates_test.go`, `contract.go` (append `registerVersions`), `manifest.yaml`

**Interfaces:**
- Consumes: Task 6 helpers; store `CreateTemplate`, `UpdateTemplate`, `DeleteTemplate`, `CreateVersion`, `UpdateVersion`, `DeleteVersion`, `GetVersion`; engine `ResetDefaultTemplates`.
- Produces: commands `templates.create`, `templates.update`, `templates.delete`, `templates.resetDefaults`, `versions.create`, `versions.update`, `versions.delete`; validators `validSlug`, `validLocale`, `validVariables`, `validChannel`, `validCategory`.

- [ ] **Step 1: Write the failing tests**

Append to `handlers_templates_test.go`:

```go
func TestTemplatesCreateUpdateDelete(t *testing.T) {
	e := newEnv(t)
	created, err := templatesCreateHandler(e.deps)(bg, templatesCreateRequest{
		Slug: "auth.welcome", Name: "Welcome", Channel: "email", Category: "auth",
		Variables: []VariableWire{{Name: "user_name", Required: true}},
		Version:   &versionContent{Locale: "en", Subject: "Hi {{.user_name}}", Text: "Hello"},
	}, as(appA))
	if err != nil {
		t.Fatalf("templates.create: %v", err)
	}
	if len(created.Template.Locales) != 1 || !created.Template.Locales[0].Active {
		t.Errorf("created = %+v", created.Template)
	}
	if _, err := templatesCreateHandler(e.deps)(bg, templatesCreateRequest{Slug: "auth.welcome", Name: "Again", Channel: "email"}, as(appA)); codeOf(err) != "CONFLICT" {
		t.Errorf("duplicate slug: %v, want CONFLICT", err)
	}
	if _, err := templatesCreateHandler(e.deps)(bg, templatesCreateRequest{Slug: "auth.welcome", Name: "Theirs", Channel: "email"}, as(appB)); err != nil {
		t.Errorf("the same slug in another app: %v", err)
	}

	name, off := "Renamed", false
	updated, err := templatesUpdateHandler(e.deps)(bg, templatesUpdateRequest{ID: created.Template.ID, Name: &name, Enabled: &off}, as(appA))
	if err != nil || updated.Template.Name != "Renamed" || updated.Template.Enabled {
		t.Fatalf("templates.update = %+v, %v", updated, err)
	}
	if updated.Template.Slug != "auth.welcome" || updated.Template.Channel != "email" {
		t.Error("slug and channel must not change through update")
	}

	if _, err := templatesDeleteHandler(e.deps)(bg, templatesDeleteRequest{ID: created.Template.ID}, as(appB)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("delete from another app: %v", err)
	}
	if _, err := templatesDeleteHandler(e.deps)(bg, templatesDeleteRequest{ID: created.Template.ID}, as(appA)); err != nil {
		t.Fatalf("templates.delete: %v", err)
	}
}

func TestTemplatesCreateValidates(t *testing.T) {
	e := newEnv(t)
	for i, in := range []templatesCreateRequest{
		{Slug: "", Name: "x", Channel: "email"},
		{Slug: "Has Space", Name: "x", Channel: "email"},
		{Slug: "ok", Name: " ", Channel: "email"},
		{Slug: "ok", Name: "x", Channel: "carrier-pigeon"},
		{Slug: "ok", Name: "x", Channel: "email", Category: "spam"},
		{Slug: "ok", Name: "x", Channel: "email", Variables: []VariableWire{{Name: "a"}, {Name: "a"}}},
		{Slug: "ok", Name: "x", Channel: "email", Variables: []VariableWire{{Name: "not valid"}}},
		{Slug: "ok", Name: "x", Channel: "email", Version: &versionContent{Locale: "not a locale!"}},
	} {
		if _, err := templatesCreateHandler(e.deps)(bg, in, as(appA)); codeOf(err) != "BAD_REQUEST" {
			t.Errorf("case %d: %v, want BAD_REQUEST", i, err)
		}
	}
}

func TestTemplatesResetDefaults(t *testing.T) {
	e := newEnv(t)
	got, err := templatesResetDefaultsHandler(e.deps)(bg, templatesResetDefaultsRequest{}, as(appA))
	if err != nil || got.Seeded == 0 || got.Deleted != 0 {
		t.Fatalf("first reset = %+v, %v", got, err)
	}
	again, err := templatesResetDefaultsHandler(e.deps)(bg, templatesResetDefaultsRequest{}, as(appA))
	if err != nil || again.Deleted != got.Seeded || again.Seeded != got.Seeded {
		t.Fatalf("second reset = %+v, %v; want it to replace the %d system templates", again, err, got.Seeded)
	}
}
```

`extension/contract/handlers_versions_test.go`:

```go
package contract

import "testing"

func TestVersionsLifecycle(t *testing.T) {
	e := newEnv(t)
	tmpl := e.template(t, appA, "auth.welcome", "email", "en")

	fr, err := versionsCreateHandler(e.deps)(bg, versionsCreateRequest{TemplateID: tmpl.ID.String(), Locale: "fr", Text: "Bonjour"}, as(appA))
	if err != nil || !fr.Version.Active {
		t.Fatalf("versions.create = %+v, %v", fr, err)
	}
	if _, err := versionsCreateHandler(e.deps)(bg, versionsCreateRequest{TemplateID: tmpl.ID.String(), Locale: "fr"}, as(appA)); codeOf(err) != "CONFLICT" {
		t.Errorf("duplicate locale: %v, want CONFLICT", err)
	}

	off, text := false, "Salut"
	upd, err := versionsUpdateHandler(e.deps)(bg, versionsUpdateRequest{TemplateID: tmpl.ID.String(), VersionID: fr.Version.ID, Active: &off, Text: &text}, as(appA))
	if err != nil || upd.Version.Active || upd.Version.Text != "Salut" || upd.Version.Locale != "fr" {
		t.Fatalf("versions.update = %+v, %v", upd, err)
	}

	other := e.template(t, appA, "auth.goodbye", "email", "en")
	if _, err := versionsUpdateHandler(e.deps)(bg, versionsUpdateRequest{TemplateID: other.ID.String(), VersionID: fr.Version.ID, Text: &text}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("a version through the wrong template: %v, want NOT_FOUND", err)
	}
	if _, err := versionsDeleteHandler(e.deps)(bg, versionsDeleteRequest{TemplateID: tmpl.ID.String(), VersionID: fr.Version.ID}, as(appB)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("delete from another app: %v, want NOT_FOUND", err)
	}
	if _, err := versionsDeleteHandler(e.deps)(bg, versionsDeleteRequest{TemplateID: tmpl.ID.String(), VersionID: fr.Version.ID}, as(appA)); err != nil {
		t.Fatalf("versions.delete: %v", err)
	}
}
```

Run: `go test ./extension/contract/ -run 'Templates|Versions'` and expect a compile failure.

- [ ] **Step 2: Template commands**

Append to `handlers_templates.go` (imports add `"regexp"`, `"slices"`, `"time"`, `"github.com/xraph/herald"`), and extend `registerTemplates`' bind list with `templates.create`, `templates.update`, `templates.delete` and `templates.resetDefaults` via `command(...)`:

```go
var (
	slugPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,127}$`)
	localePattern   = regexp.MustCompile(`^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$`)
	variablePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,63}$`)
	categories      = []string{template.CategoryAuth, template.CategoryTransactional, template.CategoryMarketing, template.CategorySystem}
)

func validChannel(ch string) bool {
	return herald.ChannelType(ch).IsValid()
}

func validCategory(c string) bool { return slices.Contains(categories, c) }

// validLocale accepts "" (the fallback version) or a BCP 47 style tag.
func validLocale(l string) bool { return l == "" || localePattern.MatchString(l) }

func validVariables(vars []VariableWire) error {
	seen := map[string]bool{}
	for _, v := range vars {
		name := strings.TrimSpace(v.Name)
		if !variablePattern.MatchString(name) {
			return badRequest("variable names must be Go template field names (letters, digits, underscores)")
		}
		if seen[name] {
			return badRequest("variable " + name + " is declared twice")
		}
		seen[name] = true
	}
	return nil
}

// versionContent is one locale's content in a create request.
type versionContent struct {
	Locale  string `json:"locale"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
	Title   string `json:"title"`
}

type templatesCreateRequest struct {
	Slug      string          `json:"slug"`
	Name      string          `json:"name"`
	Channel   string          `json:"channel"`
	Category  string          `json:"category"`
	Variables []VariableWire  `json:"variables"`
	Version   *versionContent `json:"version"`
}

type templateResponse struct {
	Template TemplateSummary `json:"template"`
}

// templatesCreateHandler creates a template and, optionally, its first
// version. If the version can't be created the template is removed again,
// so a create either lands whole or not at all.
func templatesCreateHandler(deps Deps) func(context.Context, templatesCreateRequest, contract.Principal) (templateResponse, error) {
	return func(ctx context.Context, in templatesCreateRequest, p contract.Principal) (templateResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templateResponse{}, err
		}
		slug, name, channel := strings.TrimSpace(in.Slug), strings.TrimSpace(in.Name), strings.TrimSpace(in.Channel)
		category := strings.TrimSpace(in.Category)
		if category == "" {
			category = template.CategoryTransactional
		}
		switch {
		case !slugPattern.MatchString(slug):
			return templateResponse{}, badRequest("slug must be lower-case letters, digits, dots, dashes or underscores")
		case name == "":
			return templateResponse{}, badRequest("name is required")
		case !validChannel(channel):
			return templateResponse{}, badRequest("channel is not one Herald supports")
		case !validCategory(category):
			return templateResponse{}, badRequest("category must be auth, transactional, marketing or system")
		case in.Version != nil && !validLocale(strings.TrimSpace(in.Version.Locale)):
			return templateResponse{}, badRequest("locale must be empty (the fallback) or a tag like en or pt-BR")
		}
		if err := validVariables(in.Variables); err != nil {
			return templateResponse{}, err
		}

		now := time.Now().UTC()
		t := &template.Template{
			ID: id.NewTemplateID(), AppID: appID, Slug: slug, Name: name, Channel: channel, Category: category,
			Variables: variablesFromWire(in.Variables), Enabled: true, CreatedAt: now, UpdatedAt: now,
		}
		st := deps.Herald.Store()
		if err := st.CreateTemplate(ctx, t); err != nil {
			return templateResponse{}, deps.mapError("templates.create", err)
		}
		if in.Version != nil {
			v := &template.Version{
				ID: id.NewTemplateVersionID(), TemplateID: t.ID, Locale: strings.TrimSpace(in.Version.Locale),
				Subject: in.Version.Subject, HTML: in.Version.HTML, Text: in.Version.Text, Title: in.Version.Title,
				Active: true, CreatedAt: now, UpdatedAt: now,
			}
			if err := st.CreateVersion(ctx, v); err != nil {
				_ = st.DeleteTemplate(ctx, t.ID) //nolint:errcheck // best-effort rollback; the version error is what the caller needs
				return templateResponse{}, deps.mapError("templates.create", err)
			}
		}
		saved, err := st.GetTemplate(ctx, t.ID)
		if err != nil {
			return templateResponse{}, deps.mapError("templates.create", err)
		}
		audit(ctx, deps, p, appID, "templates.create", "template", t.ID.String(), map[string]string{"slug": slug, "channel": channel})
		return templateResponse{Template: projectTemplate(saved)}, nil
	}
}

type templatesUpdateRequest struct {
	ID        string          `json:"id"`
	Name      *string         `json:"name"`
	Category  *string         `json:"category"`
	Enabled   *bool           `json:"enabled"`
	Variables *[]VariableWire `json:"variables"`
}

// templatesUpdateHandler changes name, category, enabled and variables. A
// template's slug and channel can't change: callers send by slug, and the
// pair is the template's identity.
func templatesUpdateHandler(deps Deps) func(context.Context, templatesUpdateRequest, contract.Principal) (templateResponse, error) {
	return func(ctx context.Context, in templatesUpdateRequest, p contract.Principal) (templateResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templateResponse{}, err
		}
		t, err := ownedTemplate(ctx, deps, appID, in.ID)
		if err != nil {
			return templateResponse{}, err
		}
		if in.Name != nil {
			if strings.TrimSpace(*in.Name) == "" {
				return templateResponse{}, badRequest("name is required")
			}
			t.Name = strings.TrimSpace(*in.Name)
		}
		if in.Category != nil {
			if !validCategory(*in.Category) {
				return templateResponse{}, badRequest("category must be auth, transactional, marketing or system")
			}
			t.Category = *in.Category
		}
		if in.Enabled != nil {
			t.Enabled = *in.Enabled
		}
		if in.Variables != nil {
			if err := validVariables(*in.Variables); err != nil {
				return templateResponse{}, err
			}
			t.Variables = variablesFromWire(*in.Variables)
		}
		t.UpdatedAt = time.Now().UTC()
		if err := deps.Herald.Store().UpdateTemplate(ctx, t); err != nil {
			return templateResponse{}, deps.mapError("templates.update", err)
		}
		audit(ctx, deps, p, appID, "templates.update", "template", t.ID.String(), map[string]string{"slug": t.Slug})
		return templateResponse{Template: projectTemplate(t)}, nil
	}
}

type templatesDeleteRequest struct {
	ID string `json:"id"`
}

func templatesDeleteHandler(deps Deps) func(context.Context, templatesDeleteRequest, contract.Principal) (deleteResponse, error) {
	return func(ctx context.Context, in templatesDeleteRequest, p contract.Principal) (deleteResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return deleteResponse{}, err
		}
		t, err := ownedTemplate(ctx, deps, appID, in.ID)
		if err != nil {
			return deleteResponse{}, err
		}
		if err := deps.Herald.Store().DeleteTemplate(ctx, t.ID); err != nil {
			return deleteResponse{}, deps.mapError("templates.delete", err)
		}
		audit(ctx, deps, p, appID, "templates.delete", "template", t.ID.String(), map[string]string{"slug": t.Slug})
		return deleteResponse{OK: true, ID: t.ID.String()}, nil
	}
}

type templatesResetDefaultsRequest struct{}

type templatesResetDefaultsResponse struct {
	Deleted int `json:"deleted"`
	Seeded  int `json:"seeded"`
}

// templatesResetDefaultsHandler replaces the app's system templates with the
// factory defaults. Custom templates are kept; edits to system ones are lost.
func templatesResetDefaultsHandler(deps Deps) func(context.Context, templatesResetDefaultsRequest, contract.Principal) (templatesResetDefaultsResponse, error) {
	return func(ctx context.Context, _ templatesResetDefaultsRequest, p contract.Principal) (templatesResetDefaultsResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return templatesResetDefaultsResponse{}, err
		}
		countSystem := func() (int, error) {
			list, err := deps.Herald.Store().ListTemplates(ctx, appID)
			if err != nil {
				return 0, err
			}
			n := 0
			for _, t := range list {
				if t.IsSystem {
					n++
				}
			}
			return n, nil
		}
		before, err := countSystem()
		if err != nil {
			return templatesResetDefaultsResponse{}, deps.mapError("templates.resetDefaults", err)
		}
		if err := deps.Herald.ResetDefaultTemplates(ctx, appID); err != nil {
			return templatesResetDefaultsResponse{}, deps.mapError("templates.resetDefaults", err)
		}
		after, err := countSystem()
		if err != nil {
			return templatesResetDefaultsResponse{}, deps.mapError("templates.resetDefaults", err)
		}
		audit(ctx, deps, p, appID, "templates.resetDefaults", "template", "", map[string]string{
			"deleted": strconv.Itoa(before), "seeded": strconv.Itoa(after),
		})
		return templatesResetDefaultsResponse{Deleted: before, Seeded: after}, nil
	}
}
```

(add `"strconv"` to the imports).

- [ ] **Step 3: Version commands**

`extension/contract/handlers_versions.go`:

```go
package contract

import (
	"context"
	"strings"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/template"
)

func registerVersions(d *dispatcher.Dispatcher, deps Deps) error {
	for _, bind := range []func() error{
		func() error { return command(d, "versions.create", versionsCreateHandler(deps)) },
		func() error { return command(d, "versions.update", versionsUpdateHandler(deps)) },
		func() error { return command(d, "versions.delete", versionsDeleteHandler(deps)) },
	} {
		if err := bind(); err != nil {
			return err
		}
	}
	return nil
}

// ownedVersion loads a version through its template: the template must be
// appID's and the version must be that template's. Anything else answers
// NOT_FOUND.
func ownedVersion(ctx context.Context, deps Deps, appID, templateRaw, versionRaw string) (*template.Template, *template.Version, error) {
	t, err := ownedTemplate(ctx, deps, appID, templateRaw)
	if err != nil {
		return nil, nil, err
	}
	vid, err := id.ParseTemplateVersionID(strings.TrimSpace(versionRaw))
	if err != nil {
		return nil, nil, badRequest("versionId is not a version id")
	}
	v, err := deps.Herald.Store().GetVersion(ctx, vid)
	if err != nil {
		return nil, nil, mapError(err)
	}
	if v.TemplateID.String() != t.ID.String() {
		return nil, nil, notFound("template version not found")
	}
	return t, v, nil
}

type versionsCreateRequest struct {
	TemplateID string `json:"templateId"`
	Locale     string `json:"locale"`
	Subject    string `json:"subject"`
	HTML       string `json:"html"`
	Text       string `json:"text"`
	Title      string `json:"title"`
	Active     *bool  `json:"active"`
}

type versionResponse struct {
	Version VersionWire `json:"version"`
}

func versionsCreateHandler(deps Deps) func(context.Context, versionsCreateRequest, contract.Principal) (versionResponse, error) {
	return func(ctx context.Context, in versionsCreateRequest, p contract.Principal) (versionResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return versionResponse{}, err
		}
		t, err := ownedTemplate(ctx, deps, appID, in.TemplateID)
		if err != nil {
			return versionResponse{}, err
		}
		locale := strings.TrimSpace(in.Locale)
		if !validLocale(locale) {
			return versionResponse{}, badRequest("locale must be empty (the fallback) or a tag like en or pt-BR")
		}
		active := true
		if in.Active != nil {
			active = *in.Active
		}
		now := time.Now().UTC()
		v := &template.Version{
			ID: id.NewTemplateVersionID(), TemplateID: t.ID, Locale: locale,
			Subject: in.Subject, HTML: in.HTML, Text: in.Text, Title: in.Title,
			Active: active, CreatedAt: now, UpdatedAt: now,
		}
		if err := deps.Herald.Store().CreateVersion(ctx, v); err != nil {
			return versionResponse{}, deps.mapError("versions.create", err)
		}
		audit(ctx, deps, p, appID, "versions.create", "template_version", v.ID.String(), map[string]string{"template": t.Slug, "locale": locale})
		return versionResponse{Version: projectVersion(v)}, nil
	}
}

type versionsUpdateRequest struct {
	TemplateID string  `json:"templateId"`
	VersionID  string  `json:"versionId"`
	Subject    *string `json:"subject"`
	HTML       *string `json:"html"`
	Text       *string `json:"text"`
	Title      *string `json:"title"`
	Active     *bool   `json:"active"`
}

// versionsUpdateHandler changes content and the live switch. A version's
// locale can't change: it's part of the (template, locale) unique key.
func versionsUpdateHandler(deps Deps) func(context.Context, versionsUpdateRequest, contract.Principal) (versionResponse, error) {
	return func(ctx context.Context, in versionsUpdateRequest, p contract.Principal) (versionResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return versionResponse{}, err
		}
		t, v, err := ownedVersion(ctx, deps, appID, in.TemplateID, in.VersionID)
		if err != nil {
			return versionResponse{}, err
		}
		if in.Subject != nil {
			v.Subject = *in.Subject
		}
		if in.HTML != nil {
			v.HTML = *in.HTML
		}
		if in.Text != nil {
			v.Text = *in.Text
		}
		if in.Title != nil {
			v.Title = *in.Title
		}
		if in.Active != nil {
			v.Active = *in.Active
		}
		v.UpdatedAt = time.Now().UTC()
		if err := deps.Herald.Store().UpdateVersion(ctx, v); err != nil {
			return versionResponse{}, deps.mapError("versions.update", err)
		}
		audit(ctx, deps, p, appID, "versions.update", "template_version", v.ID.String(), map[string]string{"template": t.Slug, "locale": v.Locale})
		return versionResponse{Version: projectVersion(v)}, nil
	}
}

type versionsDeleteRequest struct {
	TemplateID string `json:"templateId"`
	VersionID  string `json:"versionId"`
}

func versionsDeleteHandler(deps Deps) func(context.Context, versionsDeleteRequest, contract.Principal) (deleteResponse, error) {
	return func(ctx context.Context, in versionsDeleteRequest, p contract.Principal) (deleteResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return deleteResponse{}, err
		}
		t, v, err := ownedVersion(ctx, deps, appID, in.TemplateID, in.VersionID)
		if err != nil {
			return deleteResponse{}, err
		}
		if err := deps.Herald.Store().DeleteVersion(ctx, v.ID); err != nil {
			return deleteResponse{}, deps.mapError("versions.delete", err)
		}
		audit(ctx, deps, p, appID, "versions.delete", "template_version", v.ID.String(), map[string]string{"template": t.Slug, "locale": v.Locale})
		return deleteResponse{OK: true, ID: v.ID.String()}, nil
	}
}
```

Append `registerVersions` to `registrars`; manifest additions (preferences.get is declared in Task 11; see the note in Task 5 if the loader rejects a forward reference):

```yaml
  - { name: templates.create,        kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats, preferences.get] }
  - { name: templates.update,        kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats, preferences.get] }
  - { name: templates.delete,        kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats, preferences.get] }
  - { name: templates.resetDefaults, kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats, preferences.get] }
  - { name: versions.create,         kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats] }
  - { name: versions.update,         kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats] }
  - { name: versions.delete,         kind: command, version: 1, capability: write, invalidates: [templates.list, templates.detail, templates.resolve, overview.stats] }
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_versions.go extension/contract/handlers_versions_test.go
git commit --only -m "feat(contract): create, update, delete and reset templates, and manage locale versions" -- \
  extension/contract/handlers_templates.go extension/contract/handlers_templates_test.go \
  extension/contract/handlers_versions.go extension/contract/handlers_versions_test.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---
### Task 8: Message queries

**Files:**
- Create: `extension/contract/handlers_messages.go`, `extension/contract/handlers_messages_test.go`
- Modify: `contract.go` (append `registerMessages`), `manifest.yaml`, `project.go`

**Interfaces:**
- Consumes: cursor helpers (Task 2); store `ListMessages`, `GetMessage`, `ListAllProviders`, `GetTemplateBySlug`.
- Produces: intents `messages.list {channel?, status?, cursor?, limit?}`, `messages.detail {id}`; wire types `ProviderRef`, `MessageSummary`, `MessageDetail`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_messages_test.go`:

```go
package contract

import (
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
)

func seedMessages(t *testing.T, e *env, appID string, n int, providerID string) []*message.Message {
	t.Helper()
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	out := make([]*message.Message, 0, n)
	for i := range n {
		m := &message.Message{
			ID: id.NewMessageID(), AppID: appID, Channel: "email", Recipient: "ada@example.com",
			TemplateID: "auth.welcome", ProviderID: providerID, Status: message.StatusSent,
			Body: "Hello", Metadata: map[string]string{"k": "v"}, Attempts: 1,
			CreatedAt: base.Add(time.Duration(i) * time.Minute),
		}
		if err := e.st.CreateMessage(bg, m); err != nil {
			t.Fatal(err)
		}
		out = append(out, m)
	}
	return out
}

func TestMessagesListPagesWithACursor(t *testing.T) {
	e := newEnv(t)
	prov := e.provider(t, appA, "primary")
	seedMessages(t, e, appA, 5, prov.ID.String())
	seedMessages(t, e, appB, 3, "")

	first, err := messagesListHandler(e.deps)(bg, messagesListRequest{Limit: 2}, as(appA))
	if err != nil || len(first.Messages) != 2 || first.NextCursor == "" {
		t.Fatalf("page 1 = %+v, %v", first, err)
	}
	if first.Messages[0].Provider == nil || first.Messages[0].Provider.Name != "primary" {
		t.Errorf("provider ref = %+v", first.Messages[0].Provider)
	}
	seen := map[string]bool{}
	cursor := first.NextCursor
	for _, m := range first.Messages {
		seen[m.ID] = true
	}
	for cursor != "" {
		page, err := messagesListHandler(e.deps)(bg, messagesListRequest{Limit: 2, Cursor: cursor}, as(appA))
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range page.Messages {
			seen[m.ID] = true
		}
		cursor = page.NextCursor
	}
	if len(seen) != 5 {
		t.Errorf("paged through %d messages, want app_a's 5", len(seen))
	}
	if _, err := messagesListHandler(e.deps)(bg, messagesListRequest{Cursor: "garbage!"}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("bad cursor: %v", err)
	}
}

func TestMessagesDetail(t *testing.T) {
	e := newEnv(t)
	prov := e.provider(t, appA, "primary")
	tmpl := e.template(t, appA, "auth.welcome", "email", "en")
	msgs := seedMessages(t, e, appA, 1, prov.ID.String())

	got, err := messagesDetailHandler(e.deps)(bg, messagesDetailRequest{ID: msgs[0].ID.String()}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	if got.Message.Body != "Hello" || got.Message.Metadata["k"] != "v" {
		t.Errorf("message = %+v", got.Message)
	}
	if got.Message.Template == nil || got.Message.Template.ID != tmpl.ID.String() {
		t.Errorf("template = %+v, want it resolved from the stored slug", got.Message.Template)
	}
	if got.Message.Provider == nil || got.Message.Provider.Driver != "fake" {
		t.Errorf("provider = %+v", got.Message.Provider)
	}

	theirs := seedMessages(t, e, appB, 1, "")
	if _, err := messagesDetailHandler(e.deps)(bg, messagesDetailRequest{ID: theirs[0].ID.String()}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("another app's message: %v", err)
	}
}
```

Run: `go test ./extension/contract/ -run Messages` and expect a compile failure.

- [ ] **Step 2: Wire types**

Add to `project.go`:

```go
// ProviderRef points at a provider. Driver and Enabled are set where a page
// needs them.
type ProviderRef struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Driver  string `json:"driver,omitempty"`
	Enabled *bool  `json:"enabled,omitempty"`
}

// MessageSummary is a delivery-log row.
type MessageSummary struct {
	ID           string       `json:"id"`
	Recipient    string       `json:"recipient"`
	Channel      string       `json:"channel"`
	Status       string       `json:"status"`
	TemplateSlug string       `json:"templateSlug,omitempty"`
	Provider     *ProviderRef `json:"provider"`
	Error        string       `json:"error,omitempty"`
	CreatedAt    time.Time    `json:"createdAt"`
	SentAt       *time.Time   `json:"sentAt,omitempty"`
}

// MessageDetail is every logged field of a message. Body holds the text part
// only, truncated at the engine's truncateBodyAt; HTML bodies aren't logged.
type MessageDetail struct {
	MessageSummary
	Subject           string            `json:"subject,omitempty"`
	Body              string            `json:"body"`
	Metadata          map[string]string `json:"metadata"`
	Attempts          int               `json:"attempts"`
	Async             bool              `json:"async"`
	EnvID             string            `json:"envId,omitempty"`
	ProviderMessageID string            `json:"providerMessageId,omitempty"`
	Template          *TemplateRef      `json:"template"`
}
```

- [ ] **Step 3: Handlers**

`extension/contract/handlers_messages.go`:

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/provider"
)

const (
	defaultPageLimit = 25
	maxPageLimit     = 100
)

func registerMessages(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "messages.list", messagesListHandler(deps)); err != nil {
		return err
	}
	return query(d, "messages.detail", messagesDetailHandler(deps))
}

type messagesListRequest struct {
	Channel string `json:"channel"`
	Status  string `json:"status"`
	Cursor  string `json:"cursor"`
	Limit   int    `json:"limit"`
}

type messagesListResponse struct {
	Messages   []MessageSummary `json:"messages"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

// providerNames maps every provider of appID by ID, so a page of messages
// resolves provider names with one read.
func providerNames(ctx context.Context, deps Deps, appID string) (map[string]*provider.Provider, error) {
	list, err := deps.Herald.Store().ListAllProviders(ctx, appID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]*provider.Provider, len(list))
	for _, p := range list {
		out[p.ID.String()] = p
	}
	return out, nil
}

func summarizeMessage(m *message.Message, providers map[string]*provider.Provider) MessageSummary {
	s := MessageSummary{
		ID: m.ID.String(), Recipient: m.Recipient, Channel: m.Channel, Status: string(m.Status),
		TemplateSlug: m.TemplateID, Error: m.Error, CreatedAt: m.CreatedAt, SentAt: m.SentAt,
	}
	if p, ok := providers[m.ProviderID]; ok {
		s.Provider = &ProviderRef{ID: p.ID.String(), Name: p.Name, Driver: p.Driver}
	}
	return s
}

// messagesListHandler pages the delivery log newest first with an opaque
// cursor. It reads limit+1 rows to know whether there is a next page and
// never computes a total.
func messagesListHandler(deps Deps) func(context.Context, messagesListRequest, contract.Principal) (messagesListResponse, error) {
	return func(ctx context.Context, in messagesListRequest, p contract.Principal) (messagesListResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return messagesListResponse{}, err
		}
		offset, err := decodeCursor(in.Cursor)
		if err != nil {
			return messagesListResponse{}, err
		}
		limit := pageLimit(in.Limit, defaultPageLimit, maxPageLimit)
		rows, err := deps.Herald.Store().ListMessages(ctx, appID, message.ListOptions{
			Channel: strings.TrimSpace(in.Channel), Status: message.Status(strings.TrimSpace(in.Status)),
			Limit: limit + 1, Offset: offset,
		})
		if err != nil {
			return messagesListResponse{}, deps.mapError("messages.list", err)
		}
		providers, err := providerNames(ctx, deps, appID)
		if err != nil {
			return messagesListResponse{}, deps.mapError("messages.list", err)
		}
		out := messagesListResponse{Messages: make([]MessageSummary, 0, limit), NextCursor: nextCursor(offset, limit, len(rows))}
		for i, m := range rows {
			if i == limit {
				break
			}
			out.Messages = append(out.Messages, summarizeMessage(m, providers))
		}
		return out, nil
	}
}

type messagesDetailRequest struct {
	ID string `json:"id"`
}

type messagesDetailResponse struct {
	Message MessageDetail `json:"message"`
}

// messagesDetailHandler shows one message. Its template is found from the
// stored slug and channel (Herald logs the slug where the ID would go), and
// is null when that template is gone.
func messagesDetailHandler(deps Deps) func(context.Context, messagesDetailRequest, contract.Principal) (messagesDetailResponse, error) {
	return func(ctx context.Context, in messagesDetailRequest, p contract.Principal) (messagesDetailResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return messagesDetailResponse{}, err
		}
		mid, err := id.ParseMessageID(strings.TrimSpace(in.ID))
		if err != nil {
			return messagesDetailResponse{}, badRequest("id is not a message id")
		}
		m, err := deps.Herald.Store().GetMessage(ctx, mid)
		if err != nil {
			return messagesDetailResponse{}, deps.mapError("messages.detail", err)
		}
		if m.AppID != appID {
			return messagesDetailResponse{}, notFound("message not found")
		}
		providers, err := providerNames(ctx, deps, appID)
		if err != nil {
			return messagesDetailResponse{}, deps.mapError("messages.detail", err)
		}
		detail := MessageDetail{
			MessageSummary: summarizeMessage(m, providers),
			Subject:        m.Subject, Body: m.Body, Metadata: m.Metadata, Attempts: m.Attempts,
			Async: m.Async, EnvID: m.EnvID, ProviderMessageID: m.ProviderMessageID,
		}
		if detail.Metadata == nil {
			detail.Metadata = map[string]string{}
		}
		if m.TemplateID != "" {
			if t, err := deps.Herald.Store().GetTemplateBySlug(ctx, appID, m.TemplateID, m.Channel); err == nil {
				detail.Template = &TemplateRef{ID: t.ID.String(), Slug: t.Slug, Channel: t.Channel}
			}
		}
		return messagesDetailResponse{Message: detail}, nil
	}
}
```

Append `registerMessages`; manifest:

```yaml
  - { name: messages.list,   kind: query, version: 1, capability: read }
  - { name: messages.detail, kind: query, version: 1, capability: read }
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_messages.go extension/contract/handlers_messages_test.go
git commit --only -m "feat(contract): page the delivery log with a cursor and show one message" -- \
  extension/contract/handlers_messages.go extension/contract/handlers_messages_test.go extension/contract/project.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---

### Task 9: `PreviewSend`, `send.resolve` and `send.test`

`send.resolve` must report exactly the provider, step and sender a real send would use, so the confirmation dialog can name them. Rather than re-implement `Send`'s resolution in the contract, the engine gets `PreviewSend`, built from the same `resolveForSend` and `applyFrom` that `Send` uses.

**Files:**
- Create: `sendpreview.go`, `sendpreview_test.go` (root package)
- Create: `extension/contract/handlers_send.go`, `extension/contract/handlers_send_test.go`
- Modify: `contract.go` (append `registerSend`), `manifest.yaml`

**Interfaces:**
- Produces (engine): `type SendPreview struct { Provider *provider.Provider; Via, From, FromName string }`, `(*Herald).PreviewSend(ctx, req *SendRequest) (*SendPreview, error)`: returns `ErrNoProviderConfigured` (wrapped) when nothing handles the channel, and the same errors `Send` returns for a chosen provider that's missing, foreign or on the wrong channel.
- Produces (contract): intents `send.resolve {channel, providerId?, orgId?, userId?}`, `send.test {...}`.

- [ ] **Step 1: Engine test first**

`sendpreview_test.go`:

```go
package herald

import (
	"errors"
	"testing"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store/memory"
)

func TestPreviewSendMatchesSend(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(&recordingDriver{name: "rec", channel: "email"}))
	fallback := seedProvider(t, h, "app_a", "fallback", "rec", 0, true)

	got, err := h.PreviewSend(bg, &SendRequest{AppID: "app_a", Channel: "email"})
	if err != nil || got.Provider.ID.String() != fallback.ID.String() || got.Via != scope.ViaFallback {
		t.Fatalf("fallback = %+v, %v", got, err)
	}
	if got.From != "no-reply@example.com" {
		t.Errorf("from = %q, want the provider's from setting", got.From)
	}

	if err := st.SetScopedConfig(bg, &scope.Config{
		ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeApp, ScopeID: "app_a",
		EmailProviderID: fallback.ID.String(), FromEmail: "routed@example.com", FromName: "Routed",
	}); err != nil {
		t.Fatal(err)
	}
	got, err = h.PreviewSend(bg, &SendRequest{AppID: "app_a", Channel: "email"})
	if err != nil || got.Via != scope.ViaApp || got.From != "routed@example.com" || got.FromName != "Routed" {
		t.Fatalf("routed = %+v, %v", got, err)
	}

	if _, err := h.PreviewSend(bg, &SendRequest{AppID: "app_a", Channel: "sms"}); !errors.Is(err, ErrNoProviderConfigured) {
		t.Errorf("nothing handles sms: %v", err)
	}
	other := seedProvider(t, h, "app_b", "theirs", "rec", 0, true)
	if _, err := h.PreviewSend(bg, &SendRequest{AppID: "app_a", Channel: "email", ProviderID: other.ID.String()}); !errors.Is(err, ErrProviderNotFound) {
		t.Errorf("a chosen provider from another app: %v", err)
	}
}
```

Run: `go test . -run PreviewSend` and expect a compile failure. Then `sendpreview.go`:

```go
package herald

import (
	"context"

	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/provider"
)

// SendPreview is what a send would use, without sending: the provider, why
// it was picked, and the sender it would go out as.
type SendPreview struct {
	Provider *provider.Provider
	Via      string
	From     string
	FromName string
}

// PreviewSend resolves the provider and sender for req exactly as Send would,
// through the same code, and sends nothing. It returns ErrNoProviderConfigured
// (wrapped) when nothing handles the channel, and Send's own errors for a
// chosen provider that's missing, in another app or on another channel.
func (h *Herald) PreviewSend(ctx context.Context, req *SendRequest) (*SendPreview, error) {
	res, err := h.resolveForSend(ctx, req)
	if err != nil {
		return nil, err
	}
	out := &driver.OutboundMessage{}
	applyFrom(out, res, req.Channel, res.Provider)
	return &SendPreview{Provider: res.Provider, Via: res.Via, From: out.From, FromName: out.FromName}, nil
}
```

`seedProvider` (send_test.go) sets `Settings: {"from": "no-reply@example.com"}`; if it doesn't in your checkout, set the expectation from what it does set.

Run: `go test . -run PreviewSend` and expect PASS.

- [ ] **Step 2: Contract tests**

`extension/contract/handlers_send_test.go`:

```go
package contract

import (
	"errors"
	"strings"
	"testing"
)

func TestSendResolve(t *testing.T) {
	e := newEnv(t)
	p := e.provider(t, appA, "primary")

	got, err := sendResolveHandler(e.deps)(bg, sendResolveRequest{Channel: "email"}, as(appA))
	if err != nil || got.Provider == nil || got.Provider.ID != p.ID.String() || got.Via != "fallback" {
		t.Fatalf("send.resolve = %+v, %v", got, err)
	}
	if got.From.Email != "no-reply@example.com" {
		t.Errorf("from = %+v", got.From)
	}
	none, err := sendResolveHandler(e.deps)(bg, sendResolveRequest{Channel: "sms"}, as(appA))
	if err != nil || none.Provider != nil || none.Via != "none" {
		t.Errorf("nothing handles sms = %+v, %v; want a null provider, not an error", none, err)
	}
	theirs := e.provider(t, appB, "theirs")
	if _, err := sendResolveHandler(e.deps)(bg, sendResolveRequest{Channel: "email", ProviderID: theirs.ID.String()}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("a chosen provider from another app: %v", err)
	}
}

func TestSendTestReportsEachOutcomeHonestly(t *testing.T) {
	e := newEnv(t)
	p := e.provider(t, appA, "primary")

	sent, err := sendTestHandler(e.deps)(bg, sendTestRequest{Channel: "email", Recipient: "ada@example.com", Subject: "Hi", Body: "Hello"}, as(appA))
	if err != nil {
		t.Fatalf("send.test: %v", err)
	}
	if sent.Status != "sent" || sent.ProviderMessageID != "vendor-1" || sent.Provider == nil || sent.Provider.ID != p.ID.String() || !sent.Logged {
		t.Errorf("sent = %+v", sent)
	}
	if len(e.drv.sent) != 1 || e.drv.sent[0].To != "ada@example.com" {
		t.Errorf("driver saw %d sends", len(e.drv.sent))
	}

	// A provider failure is a normal response, so the page can show exactly
	// what the provider said.
	e.drv.err = errors.New("fake: API error 401: bad key")
	failed, err := sendTestHandler(e.deps)(bg, sendTestRequest{Channel: "email", Recipient: "ada@example.com", Body: "Hello"}, as(appA))
	if err != nil {
		t.Fatalf("a provider failure must not be a contract error: %v", err)
	}
	if failed.Status != "failed" || !strings.Contains(failed.Error, "401") {
		t.Errorf("failed = %+v", failed)
	}
}

func TestSendTestRefusals(t *testing.T) {
	e := newEnv(t)
	e.provider(t, appA, "primary")
	cases := []struct {
		name string
		in   sendTestRequest
		code string
	}{
		{"no recipient", sendTestRequest{Channel: "email", Body: "x"}, "BAD_REQUEST"},
		{"unknown channel", sendTestRequest{Channel: "fax", Recipient: "a", Body: "x"}, "BAD_REQUEST"},
		{"nothing to send", sendTestRequest{Channel: "email", Recipient: "a"}, "BAD_REQUEST"},
		{"no provider for the channel", sendTestRequest{Channel: "sms", Recipient: "+1", Body: "x"}, "BAD_REQUEST"},
		{"template that doesn't exist", sendTestRequest{Channel: "email", Recipient: "a", Template: "nope"}, "NOT_FOUND"},
	}
	for _, c := range cases {
		if _, err := sendTestHandler(e.deps)(bg, c.in, as(appA)); string(codeOf(err)) != c.code {
			t.Errorf("%s: %v, want %s", c.name, err, c.code)
		}
	}
	if len(e.drv.sent) != 0 {
		t.Errorf("a refused test reached the driver %d times", len(e.drv.sent))
	}
}
```

Run: `go test ./extension/contract/ -run Send` and expect a compile failure.

- [ ] **Step 3: Handlers**

`extension/contract/handlers_send.go`:

```go
package contract

import (
	"context"
	"errors"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald"
	"github.com/xraph/herald/id"
)

func registerSend(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "send.resolve", sendResolveHandler(deps)); err != nil {
		return err
	}
	return command(d, "send.test", sendTestHandler(deps))
}

type sendResolveRequest struct {
	Channel    string `json:"channel"`
	ProviderID string `json:"providerId"`
	OrgID      string `json:"orgId"`
	UserID     string `json:"userId"`
}

type senderInfo struct {
	Email string `json:"email,omitempty"`
	Name  string `json:"name,omitempty"`
	Phone string `json:"phone,omitempty"`
}

type sendResolveResponse struct {
	Provider *ProviderRef `json:"provider"`
	Via      string       `json:"via"`
	From     senderInfo   `json:"from"`
}

// sendResolveHandler reports which provider a send would use and why,
// through the engine's PreviewSend, so the confirmation dialog names what
// Send will actually do. Nothing handling the channel is an answer (via
// "none"), not an error.
func sendResolveHandler(deps Deps) func(context.Context, sendResolveRequest, contract.Principal) (sendResolveResponse, error) {
	return func(ctx context.Context, in sendResolveRequest, p contract.Principal) (sendResolveResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return sendResolveResponse{}, err
		}
		channel := strings.TrimSpace(in.Channel)
		if !validChannel(channel) {
			return sendResolveResponse{}, badRequest("channel is not one Herald supports")
		}
		if in.ProviderID != "" {
			if _, err := parseProviderID(in.ProviderID); err != nil {
				return sendResolveResponse{}, err
			}
		}
		preview, err := deps.Herald.PreviewSend(ctx, &herald.SendRequest{
			AppID: appID, Channel: channel, ProviderID: strings.TrimSpace(in.ProviderID),
			OrgID: strings.TrimSpace(in.OrgID), UserID: strings.TrimSpace(in.UserID),
		})
		if errors.Is(err, herald.ErrNoProviderConfigured) {
			return sendResolveResponse{Via: "none"}, nil
		}
		if err != nil {
			return sendResolveResponse{}, deps.mapError("send.resolve", err)
		}
		enabled := preview.Provider.Enabled
		out := sendResolveResponse{
			Provider: &ProviderRef{ID: preview.Provider.ID.String(), Name: preview.Provider.Name, Driver: preview.Provider.Driver, Enabled: &enabled},
			Via:      preview.Via,
		}
		if channel == string(herald.ChannelSMS) {
			out.From.Phone = preview.From
		} else {
			out.From.Email, out.From.Name = preview.From, preview.FromName
		}
		return out, nil
	}
}

type sendTestRequest struct {
	Channel    string         `json:"channel"`
	Recipient  string         `json:"recipient"`
	ProviderID string         `json:"providerId"`
	Template   string         `json:"template"`
	Locale     string         `json:"locale"`
	Data       map[string]any `json:"data"`
	Subject    string         `json:"subject"`
	Body       string         `json:"body"`
	UserID     string         `json:"userId"`
}

type sendTestResponse struct {
	MessageID         string       `json:"messageId,omitempty"`
	Status            string       `json:"status"`
	Provider          *ProviderRef `json:"provider"`
	ProviderMessageID string       `json:"providerMessageId,omitempty"`
	Error             string       `json:"error,omitempty"`
	Logged            bool         `json:"logged"`
}

// sendTestHandler sends one real message to one real recipient. A provider
// failure comes back as a normal response with status "failed" and the
// provider's own error, so the page can show exactly what happened. Contract
// errors are for requests that never reached a provider: bad input, no
// provider for the channel, a missing template, a render failure.
func sendTestHandler(deps Deps) func(context.Context, sendTestRequest, contract.Principal) (sendTestResponse, error) {
	return func(ctx context.Context, in sendTestRequest, p contract.Principal) (sendTestResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return sendTestResponse{}, err
		}
		channel, recipient := strings.TrimSpace(in.Channel), strings.TrimSpace(in.Recipient)
		switch {
		case !validChannel(channel):
			return sendTestResponse{}, badRequest("channel is not one Herald supports")
		case recipient == "":
			return sendTestResponse{}, badRequest("recipient is required")
		case strings.TrimSpace(in.Template) == "" && strings.TrimSpace(in.Body) == "":
			return sendTestResponse{}, badRequest("give a template or a body")
		}
		if in.ProviderID != "" {
			if _, err := parseProviderID(in.ProviderID); err != nil {
				return sendTestResponse{}, err
			}
		}
		res, err := deps.Herald.Send(ctx, &herald.SendRequest{
			AppID: appID, Channel: channel, To: []string{recipient}, ProviderID: strings.TrimSpace(in.ProviderID),
			Template: strings.TrimSpace(in.Template), Locale: strings.TrimSpace(in.Locale), Data: in.Data,
			Subject: in.Subject, Body: in.Body, UserID: strings.TrimSpace(in.UserID),
			Metadata: map[string]string{"source": "dashboard.send.test"},
		})
		if err != nil {
			return sendTestResponse{}, deps.mapError("send.test", err)
		}
		out := sendTestResponse{
			Status: string(res.Status), ProviderMessageID: res.ProviderMessageID, Error: res.Error, Logged: res.Logged,
		}
		if !res.MessageID.IsNil() {
			out.MessageID = res.MessageID.String()
		}
		if res.ProviderID != "" {
			if pid, err := id.ParseProviderID(res.ProviderID); err == nil {
				if prov, err := deps.Herald.GetProvider(ctx, appID, pid); err == nil {
					out.Provider = &ProviderRef{ID: prov.ID.String(), Name: prov.Name, Driver: prov.Driver}
				}
			}
		}
		audit(ctx, deps, p, appID, "send.test", "message", out.MessageID, map[string]string{
			"channel": channel, "status": out.Status, "provider": res.ProviderID,
		})
		return out, nil
	}
}
```

`ErrNoProviderConfigured` maps to BAD_REQUEST and `ErrTemplateNotFound` (store sentinel) to NOT_FOUND through `mapError`, which is what the refusal test expects.

Append `registerSend`; manifest (and add `send.resolve` to the provider commands' invalidates now if Task 5 deferred it):

```yaml
  - { name: send.resolve, kind: query,   version: 1, capability: read }
  - { name: send.test,    kind: command, version: 1, capability: write, invalidates: [messages.list, messages.detail, overview.stats, inbox.list] }
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test . ./extension/contract/ && go build ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add sendpreview.go sendpreview_test.go extension/contract/handlers_send.go extension/contract/handlers_send_test.go
git commit --only -m "feat(contract): preview which provider would send and send a real test message" -- \
  sendpreview.go sendpreview_test.go extension/contract/handlers_send.go extension/contract/handlers_send_test.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---
### Task 10: Inbox

**Files:**
- Create: `extension/contract/handlers_inbox.go`, `extension/contract/handlers_inbox_test.go`
- Modify: `contract.go` (append `registerInbox`), `manifest.yaml`

**Interfaces:**
- Consumes: cursor helpers and `defaultPageLimit`/`maxPageLimit` (Task 8), `audit` (Task 5), `deleteResponse` (Task 5).
- Produces: `inbox.list {userId, cursor?, limit?}`, commands `inbox.markRead {id}`, `inbox.markAllRead {userId}`, `inbox.delete {id}`; wire type `NotificationWire`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_inbox_test.go`:

```go
package contract

import (
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/inbox"
)

func seedInbox(t *testing.T, e *env, appID, userID string, n int) []*inbox.Notification {
	t.Helper()
	base := time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)
	out := make([]*inbox.Notification, 0, n)
	for i := range n {
		note := &inbox.Notification{
			ID: id.NewInboxID(), AppID: appID, UserID: userID, Type: "auth.welcome",
			Title: "Welcome", Body: "Hi", CreatedAt: base.Add(time.Duration(i) * time.Minute),
		}
		if err := e.st.CreateNotification(bg, note); err != nil {
			t.Fatal(err)
		}
		out = append(out, note)
	}
	return out
}

func TestInboxListAndMarkRead(t *testing.T) {
	e := newEnv(t)
	notes := seedInbox(t, e, appA, "user-1", 3)
	seedInbox(t, e, appB, "user-1", 2)

	got, err := inboxListHandler(e.deps)(bg, inboxListRequest{UserID: "user-1"}, as(appA))
	if err != nil || len(got.Notifications) != 3 || got.Unread != 3 || got.NextCursor != "" {
		t.Fatalf("inbox.list = %+v, %v", got, err)
	}
	if _, err := inboxListHandler(e.deps)(bg, inboxListRequest{}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("no userId: %v", err)
	}

	if _, err := inboxMarkReadHandler(e.deps)(bg, inboxIDRequest{ID: notes[0].ID.String()}, as(appA)); err != nil {
		t.Fatal(err)
	}
	got, _ = inboxListHandler(e.deps)(bg, inboxListRequest{UserID: "user-1"}, as(appA))
	if got.Unread != 2 {
		t.Errorf("unread after markRead = %d, want 2", got.Unread)
	}

	if _, err := inboxMarkAllReadHandler(e.deps)(bg, inboxUserRequest{UserID: "user-1"}, as(appA)); err != nil {
		t.Fatal(err)
	}
	got, _ = inboxListHandler(e.deps)(bg, inboxListRequest{UserID: "user-1"}, as(appA))
	if got.Unread != 0 {
		t.Errorf("unread after markAllRead = %d, want 0", got.Unread)
	}
	theirs, _ := inboxListHandler(e.deps)(bg, inboxListRequest{UserID: "user-1"}, as(appB))
	if theirs.Unread != 2 {
		t.Errorf("markAllRead in app_a touched app_b's inbox: unread = %d", theirs.Unread)
	}
}

func TestInboxWritesStayInTheirApp(t *testing.T) {
	e := newEnv(t)
	theirs := seedInbox(t, e, appB, "user-1", 1)
	ref := inboxIDRequest{ID: theirs[0].ID.String()}
	if _, err := inboxMarkReadHandler(e.deps)(bg, ref, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("markRead on another app's notification: %v", err)
	}
	if _, err := inboxDeleteHandler(e.deps)(bg, ref, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("delete on another app's notification: %v", err)
	}
	if n, err := e.st.GetNotification(bg, theirs[0].ID); err != nil || n.Read {
		t.Errorf("app_b's notification after app_a's attempts: %+v, %v", n, err)
	}
	if _, err := inboxDeleteHandler(e.deps)(bg, inboxIDRequest{ID: "not-an-id"}, as(appA)); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("malformed id: %v", err)
	}
}
```

Run: `go test ./extension/contract/ -run Inbox` and expect a compile failure.

- [ ] **Step 2: Handlers**

`extension/contract/handlers_inbox.go`:

```go
package contract

import (
	"context"
	"strings"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/inbox"
)

func registerInbox(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "inbox.list", inboxListHandler(deps)); err != nil {
		return err
	}
	if err := command(d, "inbox.markRead", inboxMarkReadHandler(deps)); err != nil {
		return err
	}
	if err := command(d, "inbox.markAllRead", inboxMarkAllReadHandler(deps)); err != nil {
		return err
	}
	return command(d, "inbox.delete", inboxDeleteHandler(deps))
}

// NotificationWire is one in-app notification.
type NotificationWire struct {
	ID        string            `json:"id"`
	UserID    string            `json:"userId"`
	Type      string            `json:"type"`
	Title     string            `json:"title"`
	Body      string            `json:"body,omitempty"`
	ActionURL string            `json:"actionUrl,omitempty"`
	ImageURL  string            `json:"imageUrl,omitempty"`
	Read      bool              `json:"read"`
	ReadAt    *time.Time        `json:"readAt,omitempty"`
	Metadata  map[string]string `json:"metadata"`
	ExpiresAt *time.Time        `json:"expiresAt,omitempty"`
	CreatedAt time.Time         `json:"createdAt"`
}

func projectNotification(n *inbox.Notification) NotificationWire {
	md := n.Metadata
	if md == nil {
		md = map[string]string{}
	}
	return NotificationWire{
		ID: n.ID.String(), UserID: n.UserID, Type: n.Type, Title: n.Title, Body: n.Body,
		ActionURL: n.ActionURL, ImageURL: n.ImageURL, Read: n.Read, ReadAt: n.ReadAt,
		Metadata: md, ExpiresAt: n.ExpiresAt, CreatedAt: n.CreatedAt,
	}
}

func requireUser(raw string) (string, error) {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "", badRequest("userId is required")
	}
	return u, nil
}

type inboxListRequest struct {
	UserID string `json:"userId"`
	Cursor string `json:"cursor"`
	Limit  int    `json:"limit"`
}

type inboxListResponse struct {
	Notifications []NotificationWire `json:"notifications"`
	Unread        int                `json:"unread"`
	NextCursor    string             `json:"nextCursor,omitempty"`
}

// inboxListHandler pages one user's in-app notifications in this app, with
// the user's unread count across all pages.
func inboxListHandler(deps Deps) func(context.Context, inboxListRequest, contract.Principal) (inboxListResponse, error) {
	return func(ctx context.Context, in inboxListRequest, p contract.Principal) (inboxListResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return inboxListResponse{}, err
		}
		userID, err := requireUser(in.UserID)
		if err != nil {
			return inboxListResponse{}, err
		}
		offset, err := decodeCursor(in.Cursor)
		if err != nil {
			return inboxListResponse{}, err
		}
		limit := pageLimit(in.Limit, defaultPageLimit, maxPageLimit)
		rows, err := deps.Herald.Store().ListNotifications(ctx, appID, userID, limit+1, offset)
		if err != nil {
			return inboxListResponse{}, deps.mapError("inbox.list", err)
		}
		unread, err := deps.Herald.Store().UnreadCount(ctx, appID, userID)
		if err != nil {
			return inboxListResponse{}, deps.mapError("inbox.list", err)
		}
		out := inboxListResponse{Notifications: make([]NotificationWire, 0, limit), Unread: unread, NextCursor: nextCursor(offset, limit, len(rows))}
		for i, n := range rows {
			if i == limit {
				break
			}
			out.Notifications = append(out.Notifications, projectNotification(n))
		}
		return out, nil
	}
}

type inboxIDRequest struct {
	ID string `json:"id"`
}

type inboxUserRequest struct {
	UserID string `json:"userId"`
}

type inboxOKResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id,omitempty"`
}

// ownedNotification loads a notification and answers NOT_FOUND for one in
// another app, the same answer as for one that doesn't exist.
func ownedNotification(ctx context.Context, deps Deps, appID, raw, intent string) (*inbox.Notification, error) {
	nid, err := id.ParseInboxID(strings.TrimSpace(raw))
	if err != nil {
		return nil, badRequest("id is not a notification id")
	}
	n, err := deps.Herald.Store().GetNotification(ctx, nid)
	if err != nil {
		return nil, deps.mapError(intent, err)
	}
	if n.AppID != appID {
		return nil, notFound("notification not found")
	}
	return n, nil
}

func inboxMarkReadHandler(deps Deps) func(context.Context, inboxIDRequest, contract.Principal) (inboxOKResponse, error) {
	return func(ctx context.Context, in inboxIDRequest, p contract.Principal) (inboxOKResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return inboxOKResponse{}, err
		}
		n, err := ownedNotification(ctx, deps, appID, in.ID, "inbox.markRead")
		if err != nil {
			return inboxOKResponse{}, err
		}
		if err := deps.Herald.Store().MarkRead(ctx, n.ID); err != nil {
			return inboxOKResponse{}, deps.mapError("inbox.markRead", err)
		}
		audit(ctx, deps, p, appID, "inbox.markRead", "notification", n.ID.String(), map[string]string{"user_id": n.UserID})
		return inboxOKResponse{OK: true, ID: n.ID.String()}, nil
	}
}

func inboxMarkAllReadHandler(deps Deps) func(context.Context, inboxUserRequest, contract.Principal) (inboxOKResponse, error) {
	return func(ctx context.Context, in inboxUserRequest, p contract.Principal) (inboxOKResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return inboxOKResponse{}, err
		}
		userID, err := requireUser(in.UserID)
		if err != nil {
			return inboxOKResponse{}, err
		}
		if err := deps.Herald.Store().MarkAllRead(ctx, appID, userID); err != nil {
			return inboxOKResponse{}, deps.mapError("inbox.markAllRead", err)
		}
		audit(ctx, deps, p, appID, "inbox.markAllRead", "inbox", userID, nil)
		return inboxOKResponse{OK: true}, nil
	}
}

func inboxDeleteHandler(deps Deps) func(context.Context, inboxIDRequest, contract.Principal) (deleteResponse, error) {
	return func(ctx context.Context, in inboxIDRequest, p contract.Principal) (deleteResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return deleteResponse{}, err
		}
		n, err := ownedNotification(ctx, deps, appID, in.ID, "inbox.delete")
		if err != nil {
			return deleteResponse{}, err
		}
		if err := deps.Herald.Store().DeleteNotification(ctx, n.ID); err != nil {
			return deleteResponse{}, deps.mapError("inbox.delete", err)
		}
		audit(ctx, deps, p, appID, "inbox.delete", "notification", n.ID.String(), map[string]string{"user_id": n.UserID})
		return deleteResponse{OK: true, ID: n.ID.String()}, nil
	}
}
```

Append `registerInbox`; manifest:

```yaml
  - { name: inbox.list,        kind: query,   version: 1, capability: read }
  - { name: inbox.markRead,    kind: command, version: 1, capability: write, invalidates: [inbox.list] }
  - { name: inbox.markAllRead, kind: command, version: 1, capability: write, invalidates: [inbox.list] }
  - { name: inbox.delete,      kind: command, version: 1, capability: write, invalidates: [inbox.list] }
```

If `send.test` was registered in Task 9 without `inbox.list` in its invalidates because the loader refused a forward reference, add it now.

- [ ] **Step 3: Run, lint, commit**

```bash
go test ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_inbox.go extension/contract/handlers_inbox_test.go
git commit --only -m "feat(contract): read a user's inbox and mark or delete notifications" -- \
  extension/contract/handlers_inbox.go extension/contract/handlers_inbox_test.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---

### Task 11: Preferences, opt-out only

An operator can turn a channel off for a user and never back on. A missing preference record means "opted in to everything", so there's no delete either: deleting a record would quietly re-subscribe the user to every channel they declined.

**Files:**
- Create: `extension/contract/handlers_preferences.go`, `extension/contract/handlers_preferences_test.go`
- Modify: `contract.go` (append `registerPreferences`), `manifest.yaml`

**Interfaces:**
- Consumes: `requireUser` (Task 10), `slugPattern` (Task 7), `audit`.
- Produces: `preferences.get {userId}`, `preferences.optOut {userId, type, channel}`; wire type `PreferenceWire`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_preferences_test.go`:

```go
package contract

import (
	"reflect"
	"sync"
	"testing"

	"github.com/xraph/herald/preference"
)

func TestPreferencesGetOffersEveryKnownType(t *testing.T) {
	e := newEnv(t)
	e.template(t, appA, "auth.welcome", "email", "en")
	e.template(t, appA, "auth.welcome", "sms", "en")
	e.template(t, appA, "billing.receipt", "email", "en")
	e.template(t, appB, "theirs.only", "email", "en")

	got, err := preferencesGetHandler(e.deps)(bg, preferencesGetRequest{UserID: "user-1"}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	if got.Preference != nil {
		t.Errorf("a user with no record has preference %+v, want null", got.Preference)
	}
	if want := []string{"auth.welcome", "billing.receipt"}; !reflect.DeepEqual(got.KnownTypes, want) {
		t.Errorf("knownTypes = %v, want %v (sorted, unique, this app only)", got.KnownTypes, want)
	}
}

func TestOptOutOnlyEverTurnsChannelsOff(t *testing.T) {
	e := newEnv(t)
	optOut := func(typ, channel string) {
		t.Helper()
		if _, err := preferencesOptOutHandler(e.deps)(bg, preferencesOptOutRequest{UserID: "user-1", Type: typ, Channel: channel}, as(appA)); err != nil {
			t.Fatalf("optOut %s/%s: %v", typ, channel, err)
		}
	}
	optOut("auth.welcome", "email")
	optOut("auth.welcome", "email") // idempotent
	optOut("auth.welcome", "sms")

	p, err := e.st.GetPreference(bg, appA, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if !p.IsOptedOut("auth.welcome", "email") || !p.IsOptedOut("auth.welcome", "sms") || p.IsOptedOut("auth.welcome", "push") {
		t.Errorf("overrides = %+v", p.Overrides)
	}

	// A record the user set through the API, with a channel explicitly on,
	// keeps that channel on; opting out of another channel doesn't touch it.
	on := true
	if err := e.st.SetPreference(bg, &preference.Preference{
		ID: p.ID, AppID: appA, UserID: "user-1",
		Overrides: map[string]preference.ChannelPreference{"billing.receipt": {Push: &on}},
	}); err != nil {
		t.Fatal(err)
	}
	optOut("billing.receipt", "email")
	p, _ = e.st.GetPreference(bg, appA, "user-1")
	if got := p.Overrides["billing.receipt"]; got.Push == nil || !*got.Push || !p.IsOptedOut("billing.receipt", "email") {
		t.Errorf("billing.receipt = %+v", got)
	}
}

func TestOptOutRefusals(t *testing.T) {
	e := newEnv(t)
	for name, in := range map[string]preferencesOptOutRequest{
		"no user":      {Type: "auth.welcome", Channel: "email"},
		"no type":      {UserID: "u", Channel: "email"},
		"bad type":     {UserID: "u", Type: "Has Spaces", Channel: "email"},
		"chat channel": {UserID: "u", Type: "auth.welcome", Channel: "chat"},
	} {
		if _, err := preferencesOptOutHandler(e.deps)(bg, in, as(appA)); codeOf(err) != "BAD_REQUEST" {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestConcurrentOptOutsAreAllKept(t *testing.T) {
	e := newEnv(t)
	var wg sync.WaitGroup
	for _, ch := range []string{"email", "sms", "push", "inapp"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = preferencesOptOutHandler(e.deps)(bg, preferencesOptOutRequest{UserID: "user-1", Type: "auth.welcome", Channel: ch}, as(appA))
		}()
	}
	wg.Wait()
	p, err := e.st.GetPreference(bg, appA, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, ch := range []string{"email", "sms", "push", "inapp"} {
		if !p.IsOptedOut("auth.welcome", ch) {
			t.Errorf("concurrent opt-out of %s was lost", ch)
		}
	}
}
```

Run: `go test ./extension/contract/ -run 'Preferences|OptOut'` and expect a compile failure.

- [ ] **Step 2: Handlers**

`extension/contract/handlers_preferences.go`:

```go
package contract

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/preference"
	"github.com/xraph/herald/store"
)

func registerPreferences(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "preferences.get", preferencesGetHandler(deps)); err != nil {
		return err
	}
	return command(d, "preferences.optOut", preferencesOptOutHandler(deps))
}

// ChannelPreferenceWire is one type's per-channel settings. A null channel
// is "never set", which Herald treats as opted in.
type ChannelPreferenceWire struct {
	Email *bool `json:"email"`
	SMS   *bool `json:"sms"`
	Push  *bool `json:"push"`
	InApp *bool `json:"inapp"`
}

// PreferenceWire is a user's stored preference record.
type PreferenceWire struct {
	ID        string                           `json:"id"`
	UserID    string                           `json:"userId"`
	Overrides map[string]ChannelPreferenceWire `json:"overrides"`
	UpdatedAt time.Time                        `json:"updatedAt"`
}

func projectPreference(p *preference.Preference) *PreferenceWire {
	out := &PreferenceWire{ID: p.ID.String(), UserID: p.UserID, UpdatedAt: p.UpdatedAt, Overrides: map[string]ChannelPreferenceWire{}}
	for typ, cp := range p.Overrides {
		out.Overrides[typ] = ChannelPreferenceWire(cp)
	}
	return out
}

type preferencesGetRequest struct {
	UserID string `json:"userId"`
}

type preferencesGetResponse struct {
	Preference *PreferenceWire `json:"preference"`
	KnownTypes []string        `json:"knownTypes"`
}

// preferencesGetHandler answers a user's record, or null when there is none,
// and the template slugs in this app so the page can offer an opt-out on a
// type the user has never touched.
func preferencesGetHandler(deps Deps) func(context.Context, preferencesGetRequest, contract.Principal) (preferencesGetResponse, error) {
	return func(ctx context.Context, in preferencesGetRequest, p contract.Principal) (preferencesGetResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return preferencesGetResponse{}, err
		}
		userID, err := requireUser(in.UserID)
		if err != nil {
			return preferencesGetResponse{}, err
		}
		out := preferencesGetResponse{KnownTypes: []string{}}
		pref, err := deps.Herald.Store().GetPreference(ctx, appID, userID)
		switch {
		case errors.Is(err, store.ErrPreferenceNotFound):
		case err != nil:
			return preferencesGetResponse{}, deps.mapError("preferences.get", err)
		default:
			out.Preference = projectPreference(pref)
		}
		templates, err := deps.Herald.Store().ListTemplates(ctx, appID)
		if err != nil {
			return preferencesGetResponse{}, deps.mapError("preferences.get", err)
		}
		for _, t := range templates {
			out.KnownTypes = append(out.KnownTypes, t.Slug)
		}
		slices.Sort(out.KnownTypes)
		out.KnownTypes = slices.Compact(out.KnownTypes)
		return out, nil
	}
}

type preferencesOptOutRequest struct {
	UserID  string `json:"userId"`
	Type    string `json:"type"`
	Channel string `json:"channel"`
}

type preferencesOptOutResponse struct {
	Preference *PreferenceWire `json:"preference"`
}

// optOutMu serialises opt-outs in this process. Preferences are stored as one
// record per user, so two opt-outs racing a read-modify-write would drop one
// of them, and a dropped opt-out sends the user mail they declined. Replicas
// can still race each other; the stores have no compare-and-set to close that.
var optOutMu sync.Mutex

// preferencesOptOutHandler turns one channel of one type off for a user,
// creating the record when there isn't one. It never turns anything on and
// leaves every other override as it was. Opting out twice is a no-op.
func preferencesOptOutHandler(deps Deps) func(context.Context, preferencesOptOutRequest, contract.Principal) (preferencesOptOutResponse, error) {
	return func(ctx context.Context, in preferencesOptOutRequest, p contract.Principal) (preferencesOptOutResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return preferencesOptOutResponse{}, err
		}
		userID, err := requireUser(in.UserID)
		if err != nil {
			return preferencesOptOutResponse{}, err
		}
		typ := strings.TrimSpace(in.Type)
		if !slugPattern.MatchString(typ) {
			return preferencesOptOutResponse{}, badRequest("type must be a template slug")
		}
		channel := strings.TrimSpace(in.Channel)
		off := false
		set := map[string]func(*preference.ChannelPreference){
			"email": func(c *preference.ChannelPreference) { c.Email = &off },
			"sms":   func(c *preference.ChannelPreference) { c.SMS = &off },
			"push":  func(c *preference.ChannelPreference) { c.Push = &off },
			"inapp": func(c *preference.ChannelPreference) { c.InApp = &off },
		}[channel]
		if set == nil {
			return preferencesOptOutResponse{}, badRequest("channel must be email, sms, push or inapp")
		}

		optOutMu.Lock()
		defer optOutMu.Unlock()
		now := time.Now().UTC()
		pref, err := deps.Herald.Store().GetPreference(ctx, appID, userID)
		switch {
		case errors.Is(err, store.ErrPreferenceNotFound):
			pref = &preference.Preference{ID: id.NewPreferenceID(), AppID: appID, UserID: userID, CreatedAt: now}
		case err != nil:
			return preferencesOptOutResponse{}, deps.mapError("preferences.optOut", err)
		}
		if pref.Overrides == nil {
			pref.Overrides = map[string]preference.ChannelPreference{}
		}
		cp := pref.Overrides[typ]
		set(&cp)
		pref.Overrides[typ] = cp
		pref.UpdatedAt = now
		if err := deps.Herald.Store().SetPreference(ctx, pref); err != nil {
			return preferencesOptOutResponse{}, deps.mapError("preferences.optOut", err)
		}
		audit(ctx, deps, p, appID, "preferences.optOut", "preference", userID, map[string]string{"type": typ, "channel": channel})
		return preferencesOptOutResponse{Preference: projectPreference(pref)}, nil
	}
}
```

`ChannelPreferenceWire(cp)` is a plain conversion: the two structs have the same fields in the same order and differ only in tags.

Append `registerPreferences`; manifest:

```yaml
  - { name: preferences.get,    kind: query,   version: 1, capability: read }
  - { name: preferences.optOut, kind: command, version: 1, capability: write, invalidates: [preferences.get] }
```

Add `preferences.get` to the `templates.*` invalidates now if Task 7 deferred it.

- [ ] **Step 3: Run, lint, commit**

```bash
go test -race ./extension/contract/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/handlers_preferences.go extension/contract/handlers_preferences_test.go
git commit --only -m "feat(contract): show a user's preferences and let operators opt them out" -- \
  extension/contract/handlers_preferences.go extension/contract/handlers_preferences_test.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---
### Task 12: Routing rules and `CheckRouting`

The REST API refuses a routing rule that names another app's provider, or a provider on the wrong channel, in an unexported `checkRoutedProviders` on `api.ForgeAPI`. The contract needs the same check, so it moves into the engine as `(*Herald).CheckRouting` and both callers use it. The behaviour and the error text don't change.

**Files:**
- Create: `routing.go`, `routing_test.go` (root package)
- Modify: `api/api.go` (`saveScopedConfig` calls `a.herald.CheckRouting`; delete `checkRoutedProviders`; drop `"fmt"` or `"errors"` from its imports only if nothing else in the file uses them, which `go build` will tell you)
- Create: `extension/contract/handlers_scopes.go`, `extension/contract/handlers_scopes_test.go`
- Modify: `contract.go` (append `registerScopes`), `manifest.yaml`

**Interfaces:**
- Produces (engine): `(*Herald).CheckRouting(ctx context.Context, cfg *scope.Config) error`, which returns an error wrapping `ErrInvalidProvider` for a provider ID that's malformed, missing, in another app or on another channel, all with the same text.
- Produces (contract): `scopes.list {}`, `scopes.set {scope, scopeId, emailProviderId?, smsProviderId?, pushProviderId?, webhookProviderId?, chatProviderId?, fromEmail?, fromName?, fromPhone?}`, `scopes.delete {scope, scopeId}`; wire types `RoutedProvider`, `ScopeRule`.
- Consumes: `providerNames` (Task 8), `deleteResponse`, `audit`.

- [ ] **Step 1: Engine test first**

`routing_test.go`:

```go
package herald

import (
	"errors"
	"strings"
	"testing"

	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store/memory"
)

func TestCheckRouting(t *testing.T) {
	h := newHerald(t, memory.New(), WithDriver(&recordingDriver{name: "rec", channel: "email"}))
	mine := seedProvider(t, h, "app_a", "mine", "rec", 0, true)
	theirs := seedProvider(t, h, "app_b", "theirs", "rec", 0, true)

	if err := h.CheckRouting(bg, &scope.Config{AppID: "app_a", EmailProviderID: mine.ID.String()}); err != nil {
		t.Errorf("own email provider on the email slot: %v", err)
	}
	if err := h.CheckRouting(bg, &scope.Config{AppID: "app_a"}); err != nil {
		t.Errorf("empty rule: %v", err)
	}
	cases := map[string]*scope.Config{
		"another app's provider": {AppID: "app_a", EmailProviderID: theirs.ID.String()},
		"wrong channel":          {AppID: "app_a", SMSProviderID: mine.ID.String()},
		"malformed id":           {AppID: "app_a", EmailProviderID: "nope"},
	}
	var msgs []string
	for name, cfg := range cases {
		err := h.CheckRouting(bg, cfg)
		if !errors.Is(err, ErrInvalidProvider) {
			t.Errorf("%s: %v, want ErrInvalidProvider", name, err)
			continue
		}
		msgs = append(msgs, err.Error())
	}
	// The foreign ID and the malformed one read alike apart from the ID
	// itself, so the error never confirms an ID exists in another app.
	for _, m := range msgs {
		if !strings.Contains(m, "is not a") || !strings.Contains(m, "provider of this app") {
			t.Errorf("message %q", m)
		}
	}
}
```

Run: `go test . -run CheckRouting` and expect a compile failure.

- [ ] **Step 2: Move the check**

`routing.go`, the body of `checkRoutedProviders` moved verbatim with `a.herald.` dropped:

```go
package herald

import (
	"context"
	"errors"
	"fmt"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/scope"
)

// CheckRouting refuses a routing rule that names a provider outside cfg's
// app or on another channel. The error reads the same whether the ID is
// malformed, missing or another app's, so it never confirms that an ID exists
// elsewhere. Every writer of scoped configs calls it before saving.
func (h *Herald) CheckRouting(ctx context.Context, cfg *scope.Config) error {
	slots := []struct{ field, channel, raw string }{
		{"email_provider_id", "email", cfg.EmailProviderID},
		{"sms_provider_id", "sms", cfg.SMSProviderID},
		{"push_provider_id", "push", cfg.PushProviderID},
		{"webhook_provider_id", "webhook", cfg.WebhookProviderID},
		{"chat_provider_id", "chat", cfg.ChatProviderID},
	}
	for _, s := range slots {
		if s.raw == "" {
			continue
		}
		unusable := fmt.Errorf("%w: %s %q is not a %s provider of this app", ErrInvalidProvider, s.field, s.raw, s.channel)
		pid, err := id.ParseProviderID(s.raw)
		if err != nil {
			return unusable
		}
		p, err := h.GetProvider(ctx, cfg.AppID, pid)
		if errors.Is(err, ErrProviderNotFound) {
			return unusable
		}
		if err != nil {
			return err
		}
		if p.Channel != s.channel {
			return unusable
		}
	}
	return nil
}
```

In `api/api.go`, `saveScopedConfig` becomes `if err := a.herald.CheckRouting(ctx.Context(), cfg); err != nil {` and the `checkRoutedProviders` method and its comment go.

Run: `go test . ./api/` and expect PASS; the API's existing routing tests now exercise the moved code.

- [ ] **Step 3: Contract tests**

`extension/contract/handlers_scopes_test.go`:

```go
package contract

import "testing"

func ptr[T any](v T) *T { return &v }

func TestScopesSetMergesAndList(t *testing.T) {
	e := newEnv(t)
	p := e.provider(t, appA, "primary")

	if _, err := scopesSetHandler(e.deps)(bg, scopesSetRequest{
		Scope: "org", ScopeID: "org-1", EmailProviderID: ptr(p.ID.String()), FromEmail: ptr("org@example.com"),
	}, as(appA)); err != nil {
		t.Fatal(err)
	}
	// A second write sends only fromName; the provider and fromEmail stay.
	got, err := scopesSetHandler(e.deps)(bg, scopesSetRequest{Scope: "org", ScopeID: "org-1", FromName: ptr("Org")}, as(appA))
	if err != nil {
		t.Fatal(err)
	}
	if got.Rule.Providers["email"] == nil || got.Rule.Providers["email"].ID != p.ID.String() || got.Rule.FromEmail != "org@example.com" || got.Rule.FromName != "Org" {
		t.Errorf("merged rule = %+v", got.Rule)
	}
	// An empty string clears a slot.
	got, _ = scopesSetHandler(e.deps)(bg, scopesSetRequest{Scope: "org", ScopeID: "org-1", EmailProviderID: ptr("")}, as(appA))
	if got.Rule.Providers["email"] != nil {
		t.Errorf("cleared slot = %+v", got.Rule.Providers["email"])
	}

	// The app rule's scopeId is always the app, whatever the client sends.
	app, err := scopesSetHandler(e.deps)(bg, scopesSetRequest{Scope: "app", ScopeID: "something-else", EmailProviderID: ptr(p.ID.String())}, as(appA))
	if err != nil || app.Rule.ScopeID != appA {
		t.Errorf("app rule = %+v, %v", app.Rule, err)
	}

	if err := e.h.DeleteProvider(bg, appA, p.ID); err != nil {
		t.Fatal(err)
	}
	list, err := scopesListHandler(e.deps)(bg, scopesListRequest{}, as(appA))
	if err != nil || len(list.Rules) != 2 {
		t.Fatalf("scopes.list = %+v, %v", list, err)
	}
	for _, r := range list.Rules {
		if r.Scope == "app" && (r.Providers["email"] == nil || !r.Providers["email"].Dangling) {
			t.Errorf("a deleted provider must show as dangling: %+v", r.Providers["email"])
		}
		if !r.DefaultLocaleUnused {
			t.Error("defaultLocaleUnused must be true: Send never reads a rule's default locale")
		}
	}
	if theirs, _ := scopesListHandler(e.deps)(bg, scopesListRequest{}, as(appB)); len(theirs.Rules) != 0 {
		t.Errorf("app_b sees %d of app_a's rules", len(theirs.Rules))
	}
}

func TestScopesRefusals(t *testing.T) {
	e := newEnv(t)
	theirs := e.provider(t, appB, "theirs")
	mine := e.provider(t, appA, "mine")
	cases := map[string]scopesSetRequest{
		"unknown scope":          {Scope: "team", ScopeID: "t"},
		"org with no id":         {Scope: "org"},
		"another app's provider": {Scope: "org", ScopeID: "o", EmailProviderID: ptr(theirs.ID.String())},
		"email provider on sms":  {Scope: "org", ScopeID: "o", SMSProviderID: ptr(mine.ID.String())},
	}
	for name, in := range cases {
		if _, err := scopesSetHandler(e.deps)(bg, in, as(appA)); codeOf(err) != "BAD_REQUEST" {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := scopesDeleteHandler(e.deps)(bg, scopesDeleteRequest{Scope: "org", ScopeID: "nobody"}, as(appA)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("delete a rule that isn't there: %v", err)
	}
}

func TestScopesDelete(t *testing.T) {
	e := newEnv(t)
	if _, err := scopesSetHandler(e.deps)(bg, scopesSetRequest{Scope: "user", ScopeID: "u-1", FromName: ptr("U")}, as(appA)); err != nil {
		t.Fatal(err)
	}
	if _, err := scopesDeleteHandler(e.deps)(bg, scopesDeleteRequest{Scope: "user", ScopeID: "u-1"}, as(appB)); codeOf(err) != "NOT_FOUND" {
		t.Errorf("app_b deleting app_a's rule: %v", err)
	}
	if _, err := scopesDeleteHandler(e.deps)(bg, scopesDeleteRequest{Scope: "user", ScopeID: "u-1"}, as(appA)); err != nil {
		t.Fatal(err)
	}
	if list, _ := scopesListHandler(e.deps)(bg, scopesListRequest{}, as(appA)); len(list.Rules) != 0 {
		t.Errorf("rules after delete = %+v", list.Rules)
	}
}
```

Run: `go test ./extension/contract/ -run Scopes` and expect a compile failure.

- [ ] **Step 4: Handlers**

`extension/contract/handlers_scopes.go`:

```go
package contract

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
)

func registerScopes(d *dispatcher.Dispatcher, deps Deps) error {
	if err := query(d, "scopes.list", scopesListHandler(deps)); err != nil {
		return err
	}
	if err := command(d, "scopes.set", scopesSetHandler(deps)); err != nil {
		return err
	}
	return command(d, "scopes.delete", scopesDeleteHandler(deps))
}

// RoutedProvider is a provider a rule points at. Dangling means the rule
// names an ID this app no longer has, so a send on that channel fails
// instead of falling back.
type RoutedProvider struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Dangling bool   `json:"dangling"`
}

// ScopeRule is one routing rule. Providers is keyed by channel and holds
// only the channels the rule sets.
type ScopeRule struct {
	ID                  string                     `json:"id"`
	Scope               string                     `json:"scope"`
	ScopeID             string                     `json:"scopeId"`
	Providers           map[string]*RoutedProvider `json:"providers"`
	FromEmail           string                     `json:"fromEmail,omitempty"`
	FromName            string                     `json:"fromName,omitempty"`
	FromPhone           string                     `json:"fromPhone,omitempty"`
	DefaultLocale       string                     `json:"defaultLocale,omitempty"`
	DefaultLocaleUnused bool                       `json:"defaultLocaleUnused"`
	UpdatedAt           time.Time                  `json:"updatedAt"`
}

func projectRule(c *scope.Config, providers map[string]*provider.Provider) ScopeRule {
	r := ScopeRule{
		ID: c.ID.String(), Scope: string(c.Scope), ScopeID: c.ScopeID, Providers: map[string]*RoutedProvider{},
		FromEmail: c.FromEmail, FromName: c.FromName, FromPhone: c.FromPhone,
		// Stored and shown, but Send uses the engine's default locale; the
		// page says so rather than let an operator think this does something.
		DefaultLocale: c.DefaultLocale, DefaultLocaleUnused: true, UpdatedAt: c.UpdatedAt,
	}
	for _, ch := range []string{"email", "sms", "push", "webhook", "chat"} {
		raw := c.ProviderIDFor(ch)
		if raw == "" {
			continue
		}
		if p, ok := providers[raw]; ok {
			r.Providers[ch] = &RoutedProvider{ID: raw, Name: p.Name}
		} else {
			r.Providers[ch] = &RoutedProvider{ID: raw, Dangling: true}
		}
	}
	return r
}

type scopesListRequest struct{}

type scopesListResponse struct {
	Rules []ScopeRule `json:"rules"`
}

func scopesListHandler(deps Deps) func(context.Context, scopesListRequest, contract.Principal) (scopesListResponse, error) {
	return func(ctx context.Context, _ scopesListRequest, p contract.Principal) (scopesListResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return scopesListResponse{}, err
		}
		configs, err := deps.Herald.Store().ListScopedConfigs(ctx, appID)
		if err != nil {
			return scopesListResponse{}, deps.mapError("scopes.list", err)
		}
		providers, err := providerNames(ctx, deps, appID)
		if err != nil {
			return scopesListResponse{}, deps.mapError("scopes.list", err)
		}
		out := scopesListResponse{Rules: make([]ScopeRule, 0, len(configs))}
		for _, c := range configs {
			out.Rules = append(out.Rules, projectRule(c, providers))
		}
		return out, nil
	}
}

// scopeKey validates a scope and its ID. The app rule's ID is always the app
// itself, so a client can't write a rule under another app's name.
func scopeKey(appID, rawScope, rawID string) (scope.ScopeType, string, error) {
	switch st := scope.ScopeType(strings.TrimSpace(rawScope)); st {
	case scope.ScopeApp:
		return st, appID, nil
	case scope.ScopeOrg, scope.ScopeUser:
		sid := strings.TrimSpace(rawID)
		if sid == "" {
			return "", "", badRequest("scopeId is required for an org or user rule")
		}
		return st, sid, nil
	default:
		return "", "", badRequest("scope must be app, org or user")
	}
}

type scopesSetRequest struct {
	Scope             string  `json:"scope"`
	ScopeID           string  `json:"scopeId"`
	EmailProviderID   *string `json:"emailProviderId"`
	SMSProviderID     *string `json:"smsProviderId"`
	PushProviderID    *string `json:"pushProviderId"`
	WebhookProviderID *string `json:"webhookProviderId"`
	ChatProviderID    *string `json:"chatProviderId"`
	FromEmail         *string `json:"fromEmail"`
	FromName          *string `json:"fromName"`
	FromPhone         *string `json:"fromPhone"`
}

type scopesSetResponse struct {
	Rule ScopeRule `json:"rule"`
}

// scopesSetHandler applies only the fields sent to the existing rule, or to
// a new one, checks every provider it names through the engine's
// CheckRouting, and saves. An empty string clears a field.
func scopesSetHandler(deps Deps) func(context.Context, scopesSetRequest, contract.Principal) (scopesSetResponse, error) {
	return func(ctx context.Context, in scopesSetRequest, p contract.Principal) (scopesSetResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return scopesSetResponse{}, err
		}
		st, sid, err := scopeKey(appID, in.Scope, in.ScopeID)
		if err != nil {
			return scopesSetResponse{}, err
		}
		now := time.Now().UTC()
		cfg, err := deps.Herald.Store().GetScopedConfig(ctx, appID, st, sid)
		switch {
		case errors.Is(err, store.ErrScopedConfigNotFound):
			cfg = &scope.Config{ID: id.NewScopedConfigID(), AppID: appID, Scope: st, ScopeID: sid, CreatedAt: now}
		case err != nil:
			return scopesSetResponse{}, deps.mapError("scopes.set", err)
		}
		for _, f := range []struct {
			in  *string
			dst *string
		}{
			{in.EmailProviderID, &cfg.EmailProviderID}, {in.SMSProviderID, &cfg.SMSProviderID},
			{in.PushProviderID, &cfg.PushProviderID}, {in.WebhookProviderID, &cfg.WebhookProviderID},
			{in.ChatProviderID, &cfg.ChatProviderID}, {in.FromEmail, &cfg.FromEmail},
			{in.FromName, &cfg.FromName}, {in.FromPhone, &cfg.FromPhone},
		} {
			if f.in != nil {
				*f.dst = strings.TrimSpace(*f.in)
			}
		}
		cfg.UpdatedAt = now
		if err := deps.Herald.CheckRouting(ctx, cfg); err != nil {
			return scopesSetResponse{}, deps.mapError("scopes.set", err)
		}
		if err := deps.Herald.Store().SetScopedConfig(ctx, cfg); err != nil {
			return scopesSetResponse{}, deps.mapError("scopes.set", err)
		}
		saved, err := deps.Herald.Store().GetScopedConfig(ctx, appID, st, sid)
		if err != nil {
			return scopesSetResponse{}, deps.mapError("scopes.set", err)
		}
		providers, err := providerNames(ctx, deps, appID)
		if err != nil {
			return scopesSetResponse{}, deps.mapError("scopes.set", err)
		}
		audit(ctx, deps, p, appID, "scopes.set", "scoped_config", saved.ID.String(), map[string]string{"scope": string(st), "scope_id": sid})
		return scopesSetResponse{Rule: projectRule(saved, providers)}, nil
	}
}

type scopesDeleteRequest struct {
	Scope   string `json:"scope"`
	ScopeID string `json:"scopeId"`
}

func scopesDeleteHandler(deps Deps) func(context.Context, scopesDeleteRequest, contract.Principal) (deleteResponse, error) {
	return func(ctx context.Context, in scopesDeleteRequest, p contract.Principal) (deleteResponse, error) {
		appID, err := resolveApp(p, deps)
		if err != nil {
			return deleteResponse{}, err
		}
		st, sid, err := scopeKey(appID, in.Scope, in.ScopeID)
		if err != nil {
			return deleteResponse{}, err
		}
		cfg, err := deps.Herald.Store().GetScopedConfig(ctx, appID, st, sid)
		if err != nil {
			return deleteResponse{}, deps.mapError("scopes.delete", err)
		}
		if err := deps.Herald.Store().DeleteScopedConfig(ctx, cfg.ID); err != nil {
			return deleteResponse{}, deps.mapError("scopes.delete", err)
		}
		audit(ctx, deps, p, appID, "scopes.delete", "scoped_config", cfg.ID.String(), map[string]string{"scope": string(st), "scope_id": sid})
		return deleteResponse{OK: true, ID: cfg.ID.String()}, nil
	}
}
```

`GetScopedConfig` takes the app ID, so app_b can't read or delete app_a's rule: it gets `ErrScopedConfigNotFound`, which `mapError` answers as NOT_FOUND.

Append `registerScopes`; manifest:

```yaml
  - { name: scopes.list,   kind: query,   version: 1, capability: read }
  - { name: scopes.set,    kind: command, version: 1, capability: write, invalidates: [scopes.list, send.resolve, providers.detail] }
  - { name: scopes.delete, kind: command, version: 1, capability: write, invalidates: [scopes.list, send.resolve, providers.detail] }
```

Add `scopes.list` to the `providers.*` invalidates now if Task 5 deferred it.

- [ ] **Step 5: Run, lint, commit**

```bash
go test . ./api/ ./extension/... && go build ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add routing.go routing_test.go extension/contract/handlers_scopes.go extension/contract/handlers_scopes_test.go
git commit --only -m "feat(contract): list and edit routing rules through the engine's routing check" -- \
  routing.go routing_test.go api/api.go extension/contract/handlers_scopes.go extension/contract/handlers_scopes_test.go \
  extension/contract/contract.go extension/contract/manifest.yaml
git show --stat HEAD
```

---
### Task 13: Structural tests

These tests hold the contract to its promises as a whole: the transport delivers what the manifest declares, no by-ID intent crosses an app, a bad claim is refused everywhere, no response ever carries a credential, and the writes that only break on a real database are run on one. Each table is driven by the manifest where it can be, so an intent added later without a row fails the test instead of slipping past it.

**Files:**
- Create: `extension/contract/transport_test.go`, `isolation_test.go`, `canary_test.go`, `sqlite_test.go` (all in `extension/contract/`)

**Interfaces:**
- Consumes: every handler and wire type from Tasks 2 to 12; `newEnv`, `withKey`, `as`, `noClaims`, `codeOf`, `env.provider`, `env.template`, `seedMessages` (Task 8), `seedInbox` (Task 10).
- Produces: test helpers `harness(t, deps) (*dispatcher.Dispatcher, map[string]bool)` (the second value maps each declared intent to "is a command") and `call(d, p, intent, cmd, body) (json.RawMessage, error)`, both in `isolation_test.go`.

- [ ] **Step 1: Harness and isolation**

`extension/contract/isolation_test.go`:

```go
package contract

import (
	"bytes"
	"encoding/json"
	"testing"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

// harness registers the contributor and returns the dispatcher plus every
// declared intent, mapped to whether it's a command.
func harness(t *testing.T, deps Deps) (*dispatcher.Dispatcher, map[string]bool) {
	t.Helper()
	d := dispatcher.New(nil)
	if err := Register(d, dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), deps); err != nil {
		t.Fatalf("Register: %v", err)
	}
	m, err := loader.Load(bytes.NewReader(manifestYAML), "herald/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	intents := map[string]bool{}
	for _, in := range m.Intents {
		intents[in.Name] = in.Kind == dashcontract.IntentKindCommand
	}
	return d, intents
}

// call dispatches one intent the way the transport would: params for a
// query, a JSON payload for a command.
func call(d *dispatcher.Dispatcher, p dashcontract.Principal, intent string, cmd bool, body map[string]any) (json.RawMessage, error) {
	if body == nil {
		body = map[string]any{}
	}
	req := dashcontract.Request{
		Envelope: "v1", Contributor: ContributorName, Intent: intent, IntentVersion: 1,
		Kind: dashcontract.KindQuery, Params: body,
	}
	if cmd {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		req.Kind, req.Params, req.Payload = dashcontract.KindCommand, nil, raw
	}
	data, _, err := d.Dispatch(bg, req, p)
	return data, err
}

// TestByIDIntentsNeverCrossApps aims every by-ID intent at app_b's rows from
// an app_a session. Each must answer NOT_FOUND, the same as for a row that
// doesn't exist, and leave app_b's data as it was.
func TestByIDIntentsNeverCrossApps(t *testing.T) {
	e := newEnv(t)
	d, intents := harness(t, e.deps)
	prov := e.provider(t, appB, "theirs")
	tmpl := e.template(t, appB, "auth.welcome", "email", "en")
	versions, err := e.st.ListVersions(bg, tmpl.ID)
	if err != nil || len(versions) != 1 {
		t.Fatalf("versions: %v, %v", versions, err)
	}
	msg := seedMessages(t, e, appB, 1, prov.ID.String())[0]
	note := seedInbox(t, e, appB, "user-1", 1)[0]
	pid, tid, vid := prov.ID.String(), tmpl.ID.String(), versions[0].ID.String()

	cases := []struct {
		intent string
		body   map[string]any
	}{
		{"providers.detail", map[string]any{"id": pid}},
		{"providers.update", map[string]any{"id": pid, "name": "renamed"}},
		{"providers.delete", map[string]any{"id": pid}},
		{"templates.detail", map[string]any{"id": tid}},
		{"templates.resolve", map[string]any{"id": tid, "locale": "en"}},
		{"templates.render", map[string]any{"templateId": tid, "content": map[string]any{"subject": "x"}}},
		{"templates.update", map[string]any{"id": tid, "name": "renamed"}},
		{"templates.delete", map[string]any{"id": tid}},
		{"versions.create", map[string]any{"templateId": tid, "locale": "fr", "text": "x"}},
		{"versions.update", map[string]any{"templateId": tid, "versionId": vid, "text": "x"}},
		{"versions.delete", map[string]any{"templateId": tid, "versionId": vid}},
		{"messages.detail", map[string]any{"id": msg.ID.String()}},
		{"inbox.markRead", map[string]any{"id": note.ID.String()}},
		{"inbox.delete", map[string]any{"id": note.ID.String()}},
		{"send.resolve", map[string]any{"channel": "email", "providerId": pid}},
		{"send.test", map[string]any{"channel": "email", "recipient": "a@example.com", "body": "x", "providerId": pid}},
	}
	for _, c := range cases {
		cmd, declared := intents[c.intent]
		if !declared {
			t.Errorf("%s is in this table but not in the manifest", c.intent)
			continue
		}
		if _, err := call(d, as(appA), c.intent, cmd, c.body); codeOf(err) != dashcontract.CodeNotFound {
			t.Errorf("%s on app_b's row from app_a: %v, want NOT_FOUND", c.intent, err)
		}
	}

	if got, err := e.st.GetProvider(bg, prov.ID); err != nil || got.Name != "theirs" {
		t.Errorf("app_b's provider afterwards: %+v, %v", got, err)
	}
	if got, err := e.st.GetTemplate(bg, tmpl.ID); err != nil || got.Name != tmpl.Name {
		t.Errorf("app_b's template afterwards: %+v, %v", got, err)
	}
	if got, err := e.st.ListVersions(bg, tmpl.ID); err != nil || len(got) != 1 || got[0].Text != versions[0].Text {
		t.Errorf("app_b's versions afterwards: %+v, %v", got, err)
	}
	if got, err := e.st.GetNotification(bg, note.ID); err != nil || got.Read {
		t.Errorf("app_b's notification afterwards: %+v, %v", got, err)
	}
	if len(e.drv.sent) != 0 {
		t.Errorf("send.test through app_b's provider reached the driver %d times", len(e.drv.sent))
	}
}

// TestUnusableClaimIsRefusedEverywhere sends each malformed app claim to
// every declared intent. A claim that is present but unusable must never
// fall back to the configured or "" app.
func TestUnusableClaimIsRefusedEverywhere(t *testing.T) {
	e := newEnv(t)
	e.deps.DefaultAppID = appA
	d, intents := harness(t, e.deps)
	for name, claim := range map[string]any{"empty": "", "blank": "   ", "number": 42, "null": nil, "list": []string{appA}} {
		p := dashcontract.Principal{User: &dashauth.UserInfo{Subject: "operator-1"}, Claims: map[string]any{"app_id": claim}}
		for intent, cmd := range intents {
			if _, err := call(d, p, intent, cmd, nil); codeOf(err) != dashcontract.CodePermissionDenied {
				t.Errorf("%s claim on %s: %v, want PERMISSION_DENIED", name, intent, err)
			}
		}
	}
}
```

Run: `go test ./extension/contract/ -run 'Cross|Claim' -v` and expect PASS (these test code that already exists; a failure here is a real bug in an earlier task, so fix the handler, not the test).

- [ ] **Step 2: Transport**

`extension/contract/transport_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"
)

// TestCommandsOverTheWireCarryTheirInvalidates posts one real command per
// area through forge's transport and checks the response tells the client
// exactly what the manifest says to refetch. forge v1.10.0 dropped these on
// the floor, which is why Task 1 moves to v1.11.2.
func TestCommandsOverTheWireCarryTheirInvalidates(t *testing.T) {
	e := newEnv(t, withKey())
	e.deps.DefaultAppID = appA // the transport passes no claims
	e.provider(t, appA, "primary")

	reg, wreg, d := dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(), dispatcher.New(nil)
	if err := Register(d, reg, wreg, e.deps); err != nil {
		t.Fatal(err)
	}
	h := transport.NewHandler(reg, wreg, d, nil)
	m, err := loader.Load(bytes.NewReader(manifestYAML), "herald/contract/manifest.yaml")
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string][]string{}
	for _, in := range m.Intents {
		declared[in.Name] = in.Invalidates
	}

	commands := []struct {
		intent  string
		payload string
	}{
		{"providers.create", `{"name":"second","channel":"email","driver":"fake","enabled":true,"credentials":{"api_key":"k"},"settings":{}}`},
		{"providers.encryptStored", `{}`},
		{"templates.create", `{"slug":"wire.test","name":"Wire","channel":"email","category":"transactional"}`},
		{"send.test", `{"channel":"email","recipient":"ada@example.com","body":"Hello"}`},
		{"inbox.markAllRead", `{"userId":"user-1"}`},
		{"preferences.optOut", `{"userId":"user-1","type":"auth.welcome","channel":"email"}`},
		{"scopes.set", `{"scope":"app","fromName":"Wire"}`},
	}
	for _, c := range commands {
		body := `{"envelope":"v1","kind":"command","contributor":"herald","intent":"` + c.intent +
			`","intentVersion":1,"csrf":"test","idempotencyKey":"` + c.intent + `","payload":` + c.payload + `}`
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		var resp dashcontract.Response
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil || !resp.OK {
			t.Errorf("%s: %s", c.intent, rec.Body)
			continue
		}
		if !reflect.DeepEqual(resp.Meta.Invalidates, declared[c.intent]) {
			t.Errorf("%s: meta.invalidates = %v, manifest says %v", c.intent, resp.Meta.Invalidates, declared[c.intent])
		}
	}
}
```

Run: `go test ./extension/contract/ -run OverTheWire -v` and expect PASS. If a command answers `ok:false`, print `rec.Body` and fix the payload against that command's request type, not the handler.

- [ ] **Step 3: Credential canary**

`extension/contract/canary_test.go`:

```go
package contract

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/herald"
)

// TestNoResponseCarriesACredential runs every declared query, and the
// commands that answer with a provider, with and without a credential key,
// and fails if a response or an error ever contains the canary credential or
// an encrypted value. A query added later without a row here fails too.
func TestNoResponseCarriesACredential(t *testing.T) {
	for name, opts := range map[string][]herald.Option{"plaintext": nil, "keyed": {withKey()}} {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t, opts...)
			d, intents := harness(t, e.deps)
			prov := e.provider(t, appA, "primary")
			tmpl := e.template(t, appA, "auth.welcome", "email", "en")
			pid, tid := prov.ID.String(), tmpl.ID.String()

			check := func(label string, data json.RawMessage, err error) {
				t.Helper()
				for _, s := range []string{string(data), errText(err)} {
					if strings.Contains(s, canary) || strings.Contains(s, "enc:v1:") {
						t.Errorf("%s leaked a credential: %s", label, s)
					}
				}
			}

			sent, err := call(d, as(appA), "send.test", true, map[string]any{"channel": "email", "recipient": "ada@example.com", "body": "Hello"})
			check("send.test", sent, err)
			var st struct {
				MessageID string `json:"messageId"`
			}
			if err := json.Unmarshal(sent, &st); err != nil || st.MessageID == "" {
				t.Fatalf("send.test: %s, %v", sent, err)
			}
			data, err := call(d, as(appA), "scopes.set", true, map[string]any{"scope": "app", "emailProviderId": pid})
			check("scopes.set", data, err)

			queries := map[string]map[string]any{
				"engine.info":       {},
				"overview.stats":    {"window": "30d"},
				"providers.list":    {},
				"providers.detail":  {"id": pid},
				"templates.list":    {},
				"templates.detail":  {"id": tid},
				"templates.resolve": {"id": tid, "locale": "en"},
				"templates.render":  {"templateId": tid, "content": map[string]any{"subject": "Hi {{.user_name}}"}, "data": map[string]any{"user_name": "Ada"}},
				"messages.list":     {},
				"messages.detail":   {"id": st.MessageID},
				"inbox.list":        {"userId": "user-1"},
				"preferences.get":   {"userId": "user-1"},
				"scopes.list":       {},
				"send.resolve":      {"channel": "email"},
			}
			for intent, cmd := range intents {
				if cmd {
					continue
				}
				params, ok := queries[intent]
				if !ok {
					t.Errorf("query %s has no row in the canary table", intent)
					continue
				}
				data, err := call(d, as(appA), intent, false, params)
				if err != nil {
					t.Errorf("%s: %v", intent, err)
				}
				check(intent, data, err)
			}

			commands := []struct {
				intent string
				body   map[string]any
			}{
				{"providers.create", map[string]any{"name": "second", "channel": "email", "driver": "fake", "enabled": true, "credentials": map[string]any{"api_key": canary}}},
				{"providers.update", map[string]any{"id": pid, "setCredentials": map[string]any{"api_key": canary}}},
				// Refused writes must not echo the value they refused.
				{"providers.update", map[string]any{"id": pid, "setCredentials": map[string]any{"base_url": canary}}},
				{"providers.create", map[string]any{"name": "bad", "channel": "email", "driver": "fake", "credentials": map[string]any{"host": canary, "api_key": canary}}},
			}
			if name == "keyed" {
				commands = append(commands, struct {
					intent string
					body   map[string]any
				}{"providers.encryptStored", map[string]any{}})
			}
			for _, c := range commands {
				data, err := call(d, as(appA), c.intent, true, c.body)
				check(c.intent, data, err)
			}
		})
	}
}

func errText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
```

Run: `go test ./extension/contract/ -run Canary -v` and expect PASS.

- [ ] **Step 4: SQLite suite**

The memory store is a map. JSON columns, upserts and time handling only fail on a real database, so the writes that depend on them run again on SQLite.

`extension/contract/sqlite_test.go`:

```go
package contract

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"

	"github.com/xraph/herald"
	"github.com/xraph/herald/provider"
	sqlitestore "github.com/xraph/herald/store/sqlite"
)

func sqliteDeps(t *testing.T) Deps {
	t.Helper()
	ctx := context.Background()
	sdb := sqlitedriver.New()
	if err := sdb.Open(ctx, filepath.Join(t.TempDir(), "herald.db")); err != nil {
		t.Fatalf("sqlite open: %v", err)
	}
	db, err := grove.Open(sdb)
	if err != nil {
		t.Fatalf("grove open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := sqlitestore.New(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	h, err := herald.New(herald.WithStore(s), herald.WithDriver(&fakeDriver{vendorID: "vendor-1"}))
	if err != nil {
		t.Fatal(err)
	}
	return Deps{Herald: h}
}

func TestSQLiteWrites(t *testing.T) {
	deps := sqliteDeps(t)
	p := &provider.Provider{
		AppID: appA, Name: "primary", Channel: "email", Driver: "fake",
		Credentials: map[string]string{"api_key": canary}, Settings: map[string]string{"from": "a@example.com"}, Enabled: true,
	}
	if err := deps.Herald.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}

	t.Run("provider settings round-trip", func(t *testing.T) {
		if _, err := providersUpdateHandler(deps)(bg, providersUpdateRequest{
			ID: p.ID.String(), SetSettings: map[string]string{"from_name": "Ops"}, RemoveSettings: []string{"from"},
		}, as(appA)); err != nil {
			t.Fatal(err)
		}
		got, err := providersDetailHandler(deps)(bg, providersDetailRequest{ID: p.ID.String()}, as(appA))
		if err != nil {
			t.Fatal(err)
		}
		keys := map[string]bool{}
		for _, s := range got.Provider.Settings {
			keys[s.Key] = true
		}
		if !keys["from_name"] || keys["from"] {
			t.Errorf("settings = %+v", got.Provider.Settings)
		}
	})

	t.Run("opt-outs accumulate in one record", func(t *testing.T) {
		for _, ch := range []string{"email", "sms"} {
			if _, err := preferencesOptOutHandler(deps)(bg, preferencesOptOutRequest{UserID: "user-1", Type: "auth.welcome", Channel: ch}, as(appA)); err != nil {
				t.Fatal(err)
			}
		}
		got, err := preferencesGetHandler(deps)(bg, preferencesGetRequest{UserID: "user-1"}, as(appA))
		if err != nil || got.Preference == nil {
			t.Fatalf("preferences.get = %+v, %v", got, err)
		}
		cp := got.Preference.Overrides["auth.welcome"]
		if cp.Email == nil || *cp.Email || cp.SMS == nil || *cp.SMS {
			t.Errorf("overrides = %+v", got.Preference.Overrides)
		}
	})

	t.Run("a merged rule keeps its id", func(t *testing.T) {
		first, err := scopesSetHandler(deps)(bg, scopesSetRequest{Scope: "org", ScopeID: "org-1", EmailProviderID: ptr(p.ID.String())}, as(appA))
		if err != nil {
			t.Fatal(err)
		}
		second, err := scopesSetHandler(deps)(bg, scopesSetRequest{Scope: "org", ScopeID: "org-1", FromName: ptr("Org")}, as(appA))
		if err != nil {
			t.Fatal(err)
		}
		if second.Rule.ID != first.Rule.ID || second.Rule.Providers["email"] == nil {
			t.Errorf("first %+v, second %+v", first.Rule, second.Rule)
		}
		list, _ := scopesListHandler(deps)(bg, scopesListRequest{}, as(appA))
		if len(list.Rules) != 1 {
			t.Errorf("rules = %d, want 1", len(list.Rules))
		}
	})

	t.Run("template variables and duplicate locales", func(t *testing.T) {
		created, err := templatesCreateHandler(deps)(bg, templatesCreateRequest{
			Slug: "sqlite.test", Name: "SQLite", Channel: "email", Category: "transactional",
			Variables: []VariableWire{{Name: "user_name", Type: "string", Required: true}},
			Version:   &versionContent{Locale: "en", Subject: "Hi", Text: "Hi"},
		}, as(appA))
		if err != nil {
			t.Fatal(err)
		}
		detail, err := templatesDetailHandler(deps)(bg, templatesDetailRequest{ID: created.Template.ID}, as(appA))
		if err != nil || len(detail.Template.Variables) != 1 || !detail.Template.Variables[0].Required {
			t.Errorf("variables after a round-trip = %+v, %v", detail.Template.Variables, err)
		}
		if _, err := versionsCreateHandler(deps)(bg, versionsCreateRequest{TemplateID: created.Template.ID, Locale: "en", Text: "again"}, as(appA)); codeOf(err) != "CONFLICT" {
			t.Errorf("duplicate locale on SQLite: %v, want CONFLICT", err)
		}
	})

	t.Run("the delivery log pages newest first", func(t *testing.T) {
		for range 3 {
			if _, err := sendTestHandler(deps)(bg, sendTestRequest{Channel: "email", Recipient: "ada@example.com", Body: "Hello"}, as(appA)); err != nil {
				t.Fatal(err)
			}
		}
		first, err := messagesListHandler(deps)(bg, messagesListRequest{Limit: 2}, as(appA))
		if err != nil || len(first.Messages) != 2 || first.NextCursor == "" {
			t.Fatalf("page 1 = %+v, %v", first, err)
		}
		if first.Messages[0].CreatedAt.Before(first.Messages[1].CreatedAt) {
			t.Error("messages are not newest first")
		}
		second, err := messagesListHandler(deps)(bg, messagesListRequest{Limit: 2, Cursor: first.NextCursor}, as(appA))
		if err != nil || len(second.Messages) != 1 || second.NextCursor != "" {
			t.Errorf("page 2 = %+v, %v", second, err)
		}
	})
}
```

The field names used here (`TemplateDetail.Variables`, `TemplateSummary.ID`, `VariableWire.Required`, `ProviderDetail.Settings` as `[]SettingEntry`) are the ones Tasks 4 and 6 define. If one differs in the code you have, follow the code.

Run: `go test ./extension/contract/ -run SQLite -v` and expect PASS. A failure here is the kind of bug this suite exists for: fix the store or the handler, and if it's the store, add the case to `store/storetest` so every backend is held to it.

- [ ] **Step 5: Whole package, race detector, lint, commit**

```bash
go test -race ./extension/contract/ && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/contract/transport_test.go extension/contract/isolation_test.go extension/contract/canary_test.go extension/contract/sqlite_test.go
git commit --only -m "test(contract): hold the whole contract to isolation, claims, invalidates and the canary" -- \
  extension/contract/transport_test.go extension/contract/isolation_test.go extension/contract/canary_test.go extension/contract/sqlite_test.go
git show --stat HEAD
```

---

### Task 14: CHANGELOG and configuration docs

**Files:**
- Modify: `CHANGELOG.md` (a `### Dashboard contract` section in v1.7.0, above `### Still open`), `docs/content/docs/concepts/configuration.mdx` (one row in the extension config table)

- [ ] **Step 1: CHANGELOG**

Insert above `### Still open`:

```markdown
### Dashboard contract

The extension registers a `herald` contributor with forge's dashboard contract, so the React dashboard can manage Herald: providers, templates and their versions, the delivery log, a real test send, in-app inboxes, user preferences and routing rules. It needs forge v1.11.2 or later.

The dashboard works on one app per session. It takes the `app_id` claim from the session when there is one, then `dashboard_app_id` from the extension config, then the `""` app. A session whose `app_id` claim is present but empty or not a string is refused, never moved to another app.

Operators can opt a user out of a notification type on a channel. They can't opt a user back in, and the dashboard never deletes a preference record, because a missing record means the user gets everything.

`api.ForgeAPI` no longer has its own routing check. `(*Herald).CheckRouting` is the same check, and the REST API and the dashboard both call it. `(*Herald).PreviewSend` tells you which provider and sender a send would use without sending anything.
```

- [ ] **Step 2: Configuration docs**

Add after the `GroveDatabase` row:

```markdown
| `DashboardAppID` | `string` | `""` | `dashboard_app_id`: the app the dashboard manages when a session carries no `app_id` claim. A claim always wins. |
```

and the field to the Go block above the table, after `GroveDatabase`:

```go
    // DashboardAppID is the app the dashboard manages when the session has
    // no app_id claim.
    DashboardAppID string `json:"dashboard_app_id" yaml:"dashboard_app_id" mapstructure:"dashboard_app_id"`
```

- [ ] **Step 3: Check and commit**

```bash
grep -c "$(printf '\342\200\224')" CHANGELOG.md docs/content/docs/concepts/configuration.mdx
git commit --only -m "docs: describe the dashboard contract and dashboard_app_id" -- CHANGELOG.md docs/content/docs/concepts/configuration.mdx
git show --stat HEAD
```

The grep should print `0` for both files (no em dashes).
