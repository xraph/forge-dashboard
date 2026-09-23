# Relay endpoints slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take one Relay surface end to end, from a Go contract contributor that does not exist yet through to a working endpoints page in the React shell, so the pipeline is proven before twenty more intents are written against assumptions about it.

**Architecture:** A new `relay/extension/contract` package registers the `relay` contributor and eight endpoint intents, modelled on `authsome/extension/contract`. A new `packages/plugin-relay` declares the routes and reads those intents. The fixture server gains `relay` handlers so the pages can be developed and clicked through without a live Go server.

**Tech Stack:** Go with `forge/extensions/dashboard/contract` and its `dispatcher`, React 19, `@forge-go/dashboard-kit`, `@forge-go/dashboard-plugin`, vitest, and the zero-dependency node fixture server.

**Spec:** `docs/superpowers/specs/2026-09-23-relay-dashboard-design.md`, sections "The contract" and "The React plugin".

**Repositories:** Tasks 1 to 4 are in `/Users/rexraphael/Work/xraph/forgery/relay`. Tasks 5 to 9 are in `/Users/rexraphael/Work/xraph/forge-dashboard`.

## Global Constraints

- The contributor name is `relay`, matching `extension.ExtensionName` at `extension/extension.go:31`. Get this wrong and the plugin renders nothing, logs nothing, and shows no error, because that is what an uninstalled extension looks like.
- Capabilities are `relay.read` and `relay.write`.
- Intent field names come from the Go struct JSON tags in `endpoint/endpoint.go` and `endpoint/input.go`. Not from this plan, and not from the spec.
- Every command declares `invalidates`. It is the only refresh mechanism the React client has.
- `PluginLink` paths are scope-relative: `/endpoints/ep_1`, never `/@relay/endpoints/ep_1`.
- Identifier values carry `font-mono text-xs`. The column an operator reads carries `font-medium`. Every table caption carries a live row count including at zero rows. A cell meaning "none" uses `NoneCell` or `TagList`, never a blank and never a bare dash.
- Badge variants ramp by proportion, not meaning: the majority state takes `outline` and `destructive` is reserved for what somebody came to the page to find.
- No plugin package may import `react-router`.
- Verify with `pnpm -r test` and per-package `typecheck` and `lint`. Only `tsc` sees the barrel, so a renamed export breaks the build while every test stays green.

## Review Focus

Five conditions the spec implies that no obvious task covers:

1. An endpoint whose `Secret` is empty still gets a valid-looking `X-Relay-Signature` header, because `signature.Sign` HMACs with the empty string and returns `v1=` plus 64 hex characters that verify. The endpoints list must not show such an endpoint as healthy. Covered in Task 3 and Task 7.
2. `endpoints.update` must distinguish "leave this alone" from "set this to empty", or clearing a description silently keeps the old one. Covered in Task 3.
3. `endpoints.rotateSecret` returns a value the server will never repeat. The response type must say so and no read path may return it. Covered in Task 3.
4. A command failing must render its error where a person can see it. Base UI marks everything outside an open dialog inert, so an error on the page body during an open dialog is invisible. Covered in Task 8.
5. `endpoints.list` with a `tenantId` that matches nothing must be distinguishable from an installation with no endpoints at all. Covered in Task 7.

---

### Task 1: The contract package skeleton

**Files:**
- Create: `extension/contract/contract.go`
- Create: `extension/contract/manifest.yaml`
- Create: `extension/contract/manifest_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `contract.Deps{Relay *relay.Relay}` and `contract.Register(d *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry, deps Deps) error`. Task 4 calls `Register` from the extension.

- [ ] **Step 1: Write the manifest**

Create `extension/contract/manifest.yaml`. This declares the eight endpoint intents only; later phases add the rest.

```yaml
schemaVersion: 1
contributor:
  name: relay
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [relay.read, relay.write]

# Endpoints are the webhook delivery targets a tenant registers. This is the
# first Relay surface on the React shell and deliberately the simplest: it
# needs no change to the Go domain, so it proves the pipeline rather than the
# storage layer.
intents:
  - { name: endpoints.list,         kind: query,   version: 1, capability: read  }
  - { name: endpoints.detail,       kind: query,   version: 1, capability: read  }
  - { name: endpoints.resolve,      kind: query,   version: 1, capability: read  }
  - { name: endpoints.create,       kind: command, version: 1, capability: write, invalidates: [endpoints.list] }
  - { name: endpoints.update,       kind: command, version: 1, capability: write, invalidates: [endpoints.list, endpoints.detail] }
  - { name: endpoints.delete,       kind: command, version: 1, capability: write, invalidates: [endpoints.list] }
  - { name: endpoints.setEnabled,   kind: command, version: 1, capability: write, invalidates: [endpoints.list, endpoints.detail] }
  - { name: endpoints.rotateSecret, kind: command, version: 1, capability: write, invalidates: [endpoints.detail] }

queries:
  endpointList:
    intent: endpoints.list
    cache: { staleTime: 30s }
  endpointDetail:
    intent: endpoints.detail
    cache: { staleTime: 30s }
```

- [ ] **Step 2: Write the registration**

Create `extension/contract/contract.go`:

```go
// Package contract wires relay into the Forge dashboard's contract path.
// It registers the `relay` contributor with the dashboard's contract
// registry and answers its intents from the live Relay instance.
//
// Relay's templ dashboard continues to render server-side for now. This
// package is the parallel surface the React shell consumes, and it will
// outlive the templ one.
package contract

import (
	"bytes"
	_ "embed"
	"fmt"

	"github.com/xraph/relay"

	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

//go:embed manifest.yaml
var manifestYAML []byte

// ContributorName is the join key between this contract and
// packages/plugin-relay's `extension` field. It matches
// extension.ExtensionName. A mismatch hides the plugin with no error
// anywhere, because that is what an uninstalled extension looks like.
const ContributorName = "relay"

// Deps bundles what the contract handlers need at registration time.
type Deps struct {
	// Relay is the live Relay instance. Required.
	Relay *relay.Relay
}

// Register loads the embedded manifest, validates it, registers the `relay`
// contributor with reg, and binds the handlers against deps.
func Register(
	d *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
	deps Deps,
) error {
	if deps.Relay == nil {
		return fmt.Errorf("relay/contract: Relay is required")
	}

	m, err := loader.Load(bytes.NewReader(manifestYAML), "relay/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("relay/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("relay/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("relay/contract: register manifest: %w", err)
	}

	const c = ContributorName

	if err := dispatcher.RegisterQuery(d, c, "endpoints.list", 1, endpointsListHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.list: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, c, "endpoints.detail", 1, endpointsDetailHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.detail: %w", err)
	}
	if err := dispatcher.RegisterQuery(d, c, "endpoints.resolve", 1, endpointsResolveHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.resolve: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, c, "endpoints.create", 1, endpointsCreateHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.create: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, c, "endpoints.update", 1, endpointsUpdateHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.update: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, c, "endpoints.delete", 1, endpointsDeleteHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.delete: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, c, "endpoints.setEnabled", 1, endpointsSetEnabledHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.setEnabled: %w", err)
	}
	if err := dispatcher.RegisterCommand(d, c, "endpoints.rotateSecret", 1, endpointsRotateSecretHandler(deps)); err != nil {
		return fmt.Errorf("relay/contract: register endpoints.rotateSecret: %w", err)
	}

	return nil
}
```

- [ ] **Step 3: Write the manifest test**

Create `extension/contract/manifest_test.go`. Model it on `authsome/extension/contract/manifest_test.go`; read that file first and copy its loader and assertion style rather than inventing one.

```go
package contract_test

import (
	"testing"

	relaycontract "github.com/xraph/relay/extension/contract"
)

func TestContributorNameMatchesExtension(t *testing.T) {
	// The join key. A mismatch hides the React plugin silently.
	if relaycontract.ContributorName != "relay" {
		t.Fatalf("ContributorName = %q, want \"relay\"", relaycontract.ContributorName)
	}
}
```

Add an assertion that every intent named in `manifest.yaml` has a registered handler, following whatever mechanism authsome's `manifest_test.go` uses for the same check. If authsome has no such test, write one that loads the manifest and asserts the intent list matches a literal slice in the test, so adding an intent to the yaml without a handler fails here rather than at runtime.

- [ ] **Step 4: Run and watch it fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go build ./extension/contract/`
Expected: failure, `undefined: endpointsListHandler` and seven more. That is Task 2 and 3.

- [ ] **Step 5: Commit after Task 3 makes it build.** This task's files do not compile alone.

---

### Task 2: Shared handler helpers

**Files:**
- Create: `extension/contract/handlers.go`

**Interfaces:**
- Consumes: `Deps` from Task 1.
- Produces: `AckResponse{OK bool, ID string}`, `parseEndpointID(string) (id.ID, error)`, and `mapRelayError(error) error`. Task 3 uses all three.

- [ ] **Step 1: Write it**

```go
package contract

import (
	"errors"
	"strings"

	"github.com/xraph/relay"
	"github.com/xraph/relay/endpoint"
	"github.com/xraph/relay/id"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

// AckResponse is the shape every command that has nothing else to say
// returns. ID names the record acted on so the client can key an
// optimistic update or a toast without a second read.
type AckResponse struct {
	OK bool   `json:"ok"`
	ID string `json:"id,omitempty"`
}

// parseEndpointID turns a wire string into an endpoint TypeID, answering a
// contract error rather than a Go error so the client sees a code it can
// branch on.
func parseEndpointID(raw string) (id.ID, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return id.ID{}, &contract.Error{
			Code:    contract.CodeInvalidArgument,
			Message: "endpoint id is required",
		}
	}
	parsed, err := id.ParseEndpointID(trimmed)
	if err != nil {
		return id.ID{}, &contract.Error{
			Code:    contract.CodeInvalidArgument,
			Message: "malformed endpoint id",
		}
	}
	return parsed, nil
}

// mapRelayError turns a domain error into a contract error. Anything
// unrecognised becomes Internal, which is the safe direction: a leaked
// internal message is worse than a vague one.
func mapRelayError(err error) error {
	if err == nil {
		return nil
	}
	var verr *endpoint.ValidationError
	if errors.As(err, &verr) {
		return &contract.Error{
			Code:    contract.CodeInvalidArgument,
			Message: verr.Message,
			Field:   verr.Field,
		}
	}
	switch {
	case errors.Is(err, relay.ErrEndpointNotFound):
		return &contract.Error{Code: contract.CodeNotFound, Message: "endpoint not found"}
	default:
		return &contract.Error{Code: contract.CodeInternal, Message: err.Error()}
	}
}
```

Check `errors.go` in the relay root for the exact not-found error name before writing that switch; if `ErrEndpointNotFound` does not exist, use whatever `GetEndpoint` actually returns. Check `contract.Error` for whether it carries a `Field`; drop that line if not.

- [ ] **Step 2: Commit after Task 3.** This file does not compile alone either.

---

### Task 3: The eight endpoint handlers

**Files:**
- Create: `extension/contract/handlers_endpoints.go`
- Create: `extension/contract/handlers_endpoints_test.go`

**Interfaces:**
- Consumes: `Deps`, `AckResponse`, `parseEndpointID`, `mapRelayError`.
- Produces: `EndpointSummary`, `EndpointDetail`, `RotateSecretResponse`, and the eight handler constructors named in Task 1's `Register`.

- [ ] **Step 1: Write the failing tests**

```go
package contract_test

import (
	"testing"
	// plus whatever harness authsome/extension/contract/handlers_test.go uses
)

// An endpoint with an empty secret still gets a signature header, because
// signature.Sign HMACs with the empty string and returns a well-formed
// "v1=<64 hex>" that verifies. The list has to say so rather than render
// the endpoint as ordinary.
func TestEndpointSummaryReportsAMissingSecret(t *testing.T) {
	ep := &endpoint.Endpoint{
		Entity:     entity.New(),
		ID:         id.NewEndpointID(),
		TenantID:   "tenant-1",
		URL:        "https://receiver.example/hook",
		EventTypes: []string{"invoice.*"},
		Enabled:    true,
		Secret:     "",
	}
	got := contract.ProjectEndpointForTest(ep)
	if got.Signed {
		t.Fatal("Signed is true for an endpoint with no secret")
	}
}

func TestEndpointSummaryNeverCarriesTheSecret(t *testing.T) {
	ep := &endpoint.Endpoint{
		Entity: entity.New(),
		ID:     id.NewEndpointID(),
		Secret: "whsec_deadbeef",
	}
	blob, err := json.Marshal(contract.ProjectEndpointForTest(ep))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if bytes.Contains(blob, []byte("whsec_")) {
		t.Fatalf("the secret reached the wire: %s", blob)
	}
}

// A nil pointer means leave the field alone. An empty string means clear it.
// A non-pointer field cannot express the difference and the UI silently
// keeps values the operator cleared.
func TestUpdateClearsWithAnEmptyStringAndSkipsOnNil(t *testing.T) {
	// Build an endpoint with a description, call the update handler with
	// Description pointing at "", assert the stored description is now "".
	// Then call again with Description nil and assert it is unchanged.
}
```

Fill in the third test body against the harness the other tests use. Read `authsome/extension/contract/handlers_test.go` first for how it constructs a `Deps` with a real in-memory backend, and mirror it with `relay.New(...)` over `store/memory`.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./extension/contract/`
Expected: compile failure, undefined symbols.

- [ ] **Step 3: Write the types and handlers**

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/relay/endpoint"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

// EndpointSummary is the list row. It never carries the signing secret:
// endpoint.Endpoint tags Secret as json:"-" and this type has no field for
// it at all, so there is no read path that could leak one.
type EndpointSummary struct {
	ID          string   `json:"id"`
	TenantID    string   `json:"tenantId"`
	URL         string   `json:"url"`
	Description string   `json:"description,omitempty"`
	EventTypes  []string `json:"eventTypes"`
	Enabled     bool     `json:"enabled"`
	RateLimit   int      `json:"rateLimit"`

	// Signed reports whether this endpoint has a signing secret at all.
	// An endpoint without one still sends an X-Relay-Signature header,
	// because signature.Sign HMACs with the empty string and produces a
	// well-formed signature anybody can forge. Nothing else distinguishes
	// it, so the dashboard has to.
	Signed bool `json:"signed"`

	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// EndpointDetail adds the fields only the detail page needs.
type EndpointDetail struct {
	EndpointSummary
	Headers    map[string]string `json:"headers,omitempty"`
	Metadata   map[string]string `json:"metadata,omitempty"`
	ScopeAppID string            `json:"scopeAppId,omitempty"`
	ScopeOrgID string            `json:"scopeOrgId,omitempty"`
}

type ListEndpointsInput struct {
	TenantID string `json:"tenantId,omitempty"`
	Enabled  *bool  `json:"enabled,omitempty"`
}

type ListEndpointsResponse struct {
	Endpoints []EndpointSummary `json:"endpoints"`
}

type GetEndpointInput struct {
	ID string `json:"id"`
}

type CreateEndpointInput struct {
	TenantID    string            `json:"tenantId"`
	URL         string            `json:"url"`
	Description string            `json:"description,omitempty"`
	EventTypes  []string          `json:"eventTypes"`
	Headers     map[string]string `json:"headers,omitempty"`
	RateLimit   int               `json:"rateLimit,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// UpdateEndpointInput uses pointers for every optional field so the handler
// can tell "leave this alone" from "set it to empty". endpoint.Service.Update
// guards each field with `if in.X != ""` and physically cannot clear one, so
// this handler writes the store directly.
type UpdateEndpointInput struct {
	ID          string             `json:"id"`
	URL         *string            `json:"url,omitempty"`
	Description *string            `json:"description,omitempty"`
	EventTypes  *[]string          `json:"eventTypes,omitempty"`
	Headers     *map[string]string `json:"headers,omitempty"`
	RateLimit   *int               `json:"rateLimit,omitempty"`
	Metadata    *map[string]string `json:"metadata,omitempty"`
}

type SetEnabledInput struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// RotateSecretResponse carries the new signing secret. The server will never
// repeat this value: the stored endpoint tags Secret as json:"-" and no read
// intent returns it. Show it once and tell the operator so.
type RotateSecretResponse struct {
	ID string `json:"id"`
	// Secret is shown once and never again.
	Secret string `json:"secret"`
}

type ResolveEndpointsInput struct {
	TenantID  string `json:"tenantId"`
	EventType string `json:"eventType"`
}

type ResolveEndpointsResponse struct {
	Endpoints []EndpointSummary `json:"endpoints"`
}

func projectEndpoint(ep *endpoint.Endpoint) EndpointSummary {
	return EndpointSummary{
		ID:          ep.ID.String(),
		TenantID:    ep.TenantID,
		URL:         ep.URL,
		Description: ep.Description,
		EventTypes:  ep.EventTypes,
		Enabled:     ep.Enabled,
		RateLimit:   ep.RateLimit,
		Signed:      strings.TrimSpace(ep.Secret) != "",
		CreatedAt:   ep.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:   ep.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
```

Export a test seam beside it so the tests above compile:

```go
// ProjectEndpointForTest exposes projectEndpoint to the package's external
// tests. Not part of the contract surface.
func ProjectEndpointForTest(ep *endpoint.Endpoint) EndpointSummary {
	return projectEndpoint(ep)
}
```

Then the handlers. All eight follow this shape:

```go
func endpointsListHandler(deps Deps) func(context.Context, ListEndpointsInput, contract.Principal) (ListEndpointsResponse, error) {
	return func(ctx context.Context, in ListEndpointsInput, _ contract.Principal) (ListEndpointsResponse, error) {
		opts := endpoint.ListOpts{Limit: 500, Enabled: in.Enabled}
		eps, err := deps.Relay.Store().ListEndpoints(ctx, in.TenantID, opts)
		if err != nil {
			return ListEndpointsResponse{}, mapRelayError(err)
		}
		out := ListEndpointsResponse{Endpoints: make([]EndpointSummary, 0, len(eps))}
		for _, ep := range eps {
			out.Endpoints = append(out.Endpoints, projectEndpoint(ep))
		}
		return out, nil
	}
}
```

**Correction, found while executing the signature plan.** An earlier draft of
this step said an empty `TenantID` lists every tenant. It does not, on any
backend. `ListEndpoints` compares `tenant_id` for equality on all five
(postgres and sqlite `WHERE tenant_id = ?`, mongo `{"tenant_id": tenantID}`,
redis a per-tenant sorted set, memory `!=`), so `""` returns only endpoints
whose tenant is literally the empty string, which in practice is none. This is
pinned in relay by `TestListEndpointsTreatsAnEmptyTenantLiterally`.

`dashboard/data.go:fetchAllEndpoints` passes `""` with a comment claiming it
returns every tenant. That is why the templ overview count, endpoints page,
both widgets and the whole deliveries page render empty. `ListDLQ` does the
opposite and treats `""` as every tenant, on all five backends, so the two
list methods disagree with each other. That disagreement is the likely root
cause.

Do not write a handler that relies on `""` meaning "all".

**RESOLVED: option 1.** Rex chose to fix `ListEndpoints` first, and it landed in
relay as its own plan (`2026-09-23-relay-list-endpoints.md`). An empty tenant now
lists every tenant on all five backends, pinned by a conformance suite against real
databases, and postgres and sqlite now honour `ListOpts.Enabled`, which they used to
ignore. So `endpoints.list` passes `in.TenantID` straight through, and an empty one
means every endpoint. The options as they were, kept for the record:

1. Fix `ListEndpoints` so `""` means every tenant, matching `ListDLQ`. A
   cross-backend semantic change, so it gets its own plan and a conformance
   subtest like the replay one, and it lands before this slice.
2. Make `endpoints.list` require a `tenantId`, and have the page pick a tenant
   first. There is no list-tenants capability anywhere in relay, so the page
   would need one too, or a free-text tenant field.

`endpoints.list` passes `in.TenantID` straight through. Do not re-derive "all
tenants" in the handler: the store answers it now, and a second implementation is
how the two drifted apart in the first place.

`endpointsUpdateHandler` reads the endpoint, applies only the non-nil fields, and calls `deps.Relay.Store().UpdateEndpoint`. Do not route through `endpoint.Service.Update`.

`endpointsRotateSecretHandler` calls `deps.Relay.Endpoints().RotateSecret(ctx, epID)` and returns `RotateSecretResponse{ID: ..., Secret: newSecret}`.

`endpointsResolveHandler` calls `deps.Relay.Store().Resolve(ctx, in.TenantID, in.EventType)`.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./extension/contract/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add extension/contract/
git commit -m "feat(contract): a relay contract contributor with the endpoint intents

First surface on the React shell. Update takes pointers so clearing a
field works, rotate returns the secret once, and the list reports
whether an endpoint has a signing secret at all: one without still
sends a well-formed signature that anybody can forge."
```

---

### Task 4: Register the contributor from the extension

**Files:**
- Modify: `extension/extension.go` (add the method and the interface assertion at line 39-42)

**Interfaces:**
- Consumes: `contract.Register` and `contract.Deps` from Task 1.
- Produces: `(*Extension).RegisterContractContributor`, which the dashboard's auto-discovery calls.

- [ ] **Step 1: Read the reference implementation**

Read `authsome/extension/extension.go:1028-1090`. Copy its signature and its logging style exactly; the dashboard discovers this method by interface so the signature must match.

- [ ] **Step 2: Add the method**

```go
// RegisterContractContributor implements dashboard.ContractContributorAware.
// It registers the `relay` contract contributor against the dashboard's
// contract registry and dispatcher, which is what the React shell reads.
//
// Relay's templ LocalContributor is unaffected and both run side by side
// until the templ dashboard is retired.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.relay == nil {
		e.Logger().Warn("relay: instance not initialised; skipping contract contributor registration")
		return nil
	}
	if err := relaycontract.Register(disp, reg, wreg, relaycontract.Deps{Relay: e.relay}); err != nil {
		return fmt.Errorf("relay: register contract contributor: %w", err)
	}
	return nil
}
```

Check the field name for the Relay instance on `Extension` before writing `e.relay`, and add the compile-time assertion next to the existing ones at line 39-42:

```go
	_ dashboard.ContractContributorAware = (*Extension)(nil)
```

- [ ] **Step 3: Build and test**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go build ./... && make test`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add extension/extension.go
git commit -m "feat(extension): register the relay contract contributor"
```

---

### Task 5: Fixture handlers for the endpoint intents

The fixture is what the React pages are developed against, and a bad one hides the bug it should expose. Four rules from the playbook apply: a write must visibly change the next read, model the contract being shipped rather than what is deployed, preserve the server's unhelpful behaviours, and exercise every handler over HTTP.

**Files:**
- Modify: `packages/fixture-server/server.mjs`
- Modify: `packages/fixture-server/verify.mjs`
- Modify: `packages/fixture-server/README.md`

**Interfaces:**
- Consumes: the intent names and response shapes from Task 3.
- Produces: a `relay` contributor in the fixture's capabilities response, answering all eight intents.

- [ ] **Step 1: Seed state**

Beside `seedStreamingState`, add:

```js
function seedRelayState() {
  return {
    endpoints: [
      {
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2x",
        tenantId: "acme",
        url: "https://acme.example/webhooks/relay",
        description: "Production receiver",
        eventTypes: ["invoice.*", "customer.created"],
        enabled: true,
        rateLimit: 0,
        signed: true,
        createdAt: "2026-08-14T09:12:00Z",
        updatedAt: "2026-09-02T16:40:00Z",
      },
      {
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2y",
        tenantId: "acme",
        url: "https://acme.example/webhooks/staging",
        description: "",
        eventTypes: ["*"],
        enabled: false,
        rateLimit: 10,
        signed: true,
        createdAt: "2026-09-01T11:05:00Z",
        updatedAt: "2026-09-01T11:05:00Z",
      },
      {
        // Deliberate: an endpoint with no signing secret. It still receives
        // a well-formed X-Relay-Signature from the real server, which is
        // exactly the state the list has to surface rather than smooth over.
        id: "ep_01hq2k3m4n5p6q7r8s9t0v1w2z",
        tenantId: "globex",
        url: "https://globex.example/hooks",
        description: "Imported, no secret",
        eventTypes: ["deployment.completed"],
        enabled: true,
        rateLimit: 0,
        signed: false,
        createdAt: "2026-09-18T08:00:00Z",
        updatedAt: "2026-09-18T08:00:00Z",
      },
    ],
  }
}

let relayState = seedRelayState()
```

- [ ] **Step 2: Add the handlers**

```js
const relayHandlers = {
  "endpoints.list": {
    kind: "query",
    handler: (payload) => {
      // Models the fixed server: an empty or missing tenantId lists every
      // tenant, as ListEndpoints does on all five backends since the
      // list-endpoints plan landed. A non-empty one matches exactly.
      //
      // This is the playbook's rule to model the contract being shipped. Keep
      // the two branches in step with the server. If this ever disagrees with
      // ListEndpoints, the fixture is the one that is wrong.
      const tenantId = payload?.tenantId ?? ""
      let rows = tenantId === ""
        ? relayState.endpoints
        : relayState.endpoints.filter((e) => e.tenantId === tenantId)
      if (typeof payload?.enabled === "boolean") {
        rows = rows.filter((e) => e.enabled === payload.enabled)
      }
      return { endpoints: rows }
    },
  },
  "endpoints.detail": {
    kind: "query",
    handler: (payload) => {
      const ep = relayState.endpoints.find((e) => e.id === payload?.id)
      if (!ep) throw notFound("endpoint", payload?.id)
      return { ...ep, headers: {}, metadata: {} }
    },
  },
  "endpoints.resolve": {
    kind: "query",
    handler: (payload) => {
      const type = payload?.eventType ?? ""
      const matches = relayState.endpoints.filter(
        (e) =>
          e.enabled &&
          e.tenantId === payload?.tenantId &&
          e.eventTypes.some((p) => globMatches(p, type)),
      )
      return { endpoints: matches }
    },
  },
  "endpoints.create": {
    kind: "command",
    invalidates: ["endpoints.list"],
    handler: (payload) => {
      const ep = {
        id: `ep_${randomBytes(13).toString("hex")}`,
        tenantId: payload?.tenantId ?? "",
        url: payload?.url ?? "",
        description: payload?.description ?? "",
        eventTypes: payload?.eventTypes ?? [],
        enabled: true,
        rateLimit: payload?.rateLimit ?? 0,
        signed: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      relayState.endpoints.push(ep)
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.update": {
    kind: "command",
    invalidates: ["endpoints.list", "endpoints.detail"],
    handler: (payload) => {
      const ep = relayState.endpoints.find((e) => e.id === payload?.id)
      if (!ep) throw notFound("endpoint", payload?.id)
      // Only fields actually present are applied. An explicit "" clears.
      for (const k of ["url", "description", "eventTypes", "rateLimit"]) {
        if (payload?.[k] !== undefined && payload[k] !== null) ep[k] = payload[k]
      }
      ep.updatedAt = new Date().toISOString()
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.delete": {
    kind: "command",
    invalidates: ["endpoints.list"],
    handler: (payload) => {
      const idx = relayState.endpoints.findIndex((e) => e.id === payload?.id)
      if (idx === -1) throw notFound("endpoint", payload?.id)
      relayState.endpoints.splice(idx, 1)
      return { ok: true, id: payload.id }
    },
  },
  "endpoints.setEnabled": {
    kind: "command",
    invalidates: ["endpoints.list", "endpoints.detail"],
    handler: (payload) => {
      const ep = relayState.endpoints.find((e) => e.id === payload?.id)
      if (!ep) throw notFound("endpoint", payload?.id)
      ep.enabled = Boolean(payload?.enabled)
      ep.updatedAt = new Date().toISOString()
      return { ok: true, id: ep.id }
    },
  },
  "endpoints.rotateSecret": {
    kind: "command",
    invalidates: ["endpoints.detail"],
    handler: (payload) => {
      const ep = relayState.endpoints.find((e) => e.id === payload?.id)
      if (!ep) throw notFound("endpoint", payload?.id)
      // Rotating gives an unsigned endpoint a secret: the next read must
      // show it as signed, or invalidation cannot be demonstrated.
      ep.signed = true
      ep.updatedAt = new Date().toISOString()
      return { id: ep.id, secret: `whsec_${randomBytes(32).toString("hex")}` }
    },
  },
}
```

Add a small `globMatches(pattern, value)` helper next to it, supporting only `*` and a trailing `.*`, which is what `catalog/matcher.go` implements. Read that file and match its semantics rather than guessing.

- [ ] **Step 3: Register the contributor**

Find where `streamingHandlers` is attached to the contributor table and add `relay` alongside it, with capabilities `["relay.read", "relay.write"]`. Follow the existing shape exactly.

- [ ] **Step 4: Exercise every intent over HTTP**

Add the eight intents to `verify.mjs`, following its existing pattern. A handler that exists and throws on its first call is worse than a missing one, because the missing one is obvious.

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && node packages/fixture-server/server.mjs & sleep 1 && node packages/fixture-server/verify.mjs; kill %1`
Expected: every relay intent reported as answering.

- [ ] **Step 5: Update the README's contributor inventory**

The header comment at `server.mjs:20-28` lists the contributors. Add relay with its intent counts, and add relay to `README.md`'s mapping back to the Go source.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/fixture-server/
git commit -m "feat(fixture): relay endpoint intents

Seeds an endpoint with no signing secret on purpose, because that state
is invisible from the wire otherwise and the list has to surface it."
```

---

### Task 6: The plugin package skeleton

**Files:**
- Create: `packages/plugin-relay/package.json`
- Create: `packages/plugin-relay/tsconfig.json`
- Create: `packages/plugin-relay/eslint.config.js`
- Create: `packages/plugin-relay/vitest.config.ts`
- Create: `packages/plugin-relay/src/index.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `relayPlugin`, the default and named export of `@forge-go/dashboard-plugin-relay`. Task 9 registers it in the shell.

- [ ] **Step 1: Copy the scaffolding**

Copy `packages/plugin-streaming`'s `package.json`, `tsconfig.json`, `eslint.config.js` and `vitest.config.ts` rather than authsome's, because streaming is a single-surface plugin with no `sub/` export and that is the shape this one starts in. Change the name to `@forge-go/dashboard-plugin-relay` and drop any export map entry for `./sub`.

- [ ] **Step 2: Write the plugin definition**

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"
import { WebhookIcon } from "@forge-go/dashboard-kit/icons"
import { RelayEndpointsPage } from "./pages/endpoints"
import { RelayEndpointDetailPage } from "./pages/endpoint-detail"
import { RelayEndpointCreatePage } from "./pages/endpoint-create"

export type { EndpointSummary, EndpointsList } from "./pages/endpoints"
export type { EndpointDetail } from "./pages/endpoint-detail"

/**
 * Relay is the webhook delivery engine: endpoints subscribe to event types
 * with glob patterns, events fan out to whatever matches, and deliveries
 * retry on a backoff schedule.
 *
 * `extension` is the Go contributor name from extension.ExtensionName. It
 * is the join key, and a typo here hides the plugin with no error anywhere,
 * because that is what an uninstalled extension is supposed to look like.
 */
export const relayPlugin = definePlugin({
  extension: "relay",
  namespace: "relay",
  label: "Relay",
  icon: <WebhookIcon />,
  nav: [
    {
      label: "Endpoints",
      to: "/endpoints",
      priority: 10,
      icon: <WebhookIcon />,
      group: "Webhooks",
    },
  ],
  routes: [
    { path: "/endpoints", element: RelayEndpointsPage },
    { path: "/endpoints/new", element: RelayEndpointCreatePage },
    { path: "/endpoints/:id", element: RelayEndpointDetailPage },
  ],
})

export default relayPlugin
```

Confirm `WebhookIcon` is exported from the kit's icons barrel before using it; `plugin-authsome/src/index.tsx:17` imports it, so it exists.

- [ ] **Step 3: Add to the workspace**

Confirm `pnpm-workspace.yaml` globs `packages/*`. If it lists packages explicitly, add this one.

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm install`

- [ ] **Step 4: Commit after Task 7.** The package does not typecheck until the pages exist.

---

### Task 7: The endpoints list page

**Files:**
- Create: `packages/plugin-relay/src/pages/endpoints.tsx`
- Create: `packages/plugin-relay/test/endpoints.test.tsx`

**Interfaces:**
- Consumes: `endpoints.list` and `endpoints.setEnabled` from Task 3.
- Produces: `RelayEndpointsPage`, and the exported types `EndpointSummary` and `EndpointsList`.

- [ ] **Step 1: Write the failing tests**

Model the harness on `packages/plugin-authsome/test/`. Read one of those files first for how it stubs the contract client.

```tsx
it("marks an endpoint with no signing secret", async () => {
  renderPage({
    endpoints: [
      { id: "ep_1", tenantId: "acme", url: "https://a.example", eventTypes: ["*"],
        enabled: true, rateLimit: 0, signed: false, createdAt: "...", updatedAt: "..." },
    ],
  })
  expect(await screen.findByText("Unsigned")).toBeInTheDocument()
})

it("says which kind of empty it is", async () => {
  renderPage({ endpoints: [] })
  expect(await screen.findByText(/No endpoints yet/i)).toBeInTheDocument()
})

it("distinguishes a filter that matched nothing", async () => {
  renderPage({ endpoints: [] }, { tenantId: "nobody" })
  expect(await screen.findByText(/No endpoints match/i)).toBeInTheDocument()
})

it("counts rows in the caption at zero", async () => {
  renderPage({ endpoints: [] })
  expect(await screen.findByText(/0 endpoints/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-relay test`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the page**

Build it on `PageHeader`, `QueryBoundary`, `FilterBar`, `ResourceTable` and `EmptyState`. Columns: URL (`font-medium`, it is the column an operator reads), tenant, event types via `TagList`, state badge, signing badge, rate limit via `NoneCell` when zero, created via `Timestamp`.

Badges, ramping by proportion:

```tsx
// Most endpoints are enabled, so enabled is the quiet one. Disabled is
// notable. Unsigned is what somebody came to this page to find, because
// an unsigned endpoint still sends a well-formed signature that anybody
// can forge, and nothing else on the row would tell you.
const stateBadge = (e: EndpointSummary) =>
  e.enabled
    ? <Badge variant="outline">Enabled</Badge>
    : <Badge variant="secondary">Disabled</Badge>

const signingBadge = (e: EndpointSummary) =>
  e.signed
    ? <Badge variant="outline">Signed</Badge>
    : <Badge variant="destructive">Unsigned</Badge>
```

Two empty states, distinguished by whether a filter is active:

```tsx
emptyMessage={
  tenantFilter || enabledFilter !== "all"
    ? "No endpoints match these filters."
    : "No endpoints yet. Create one to start delivering webhooks."
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm --filter @forge-go/dashboard-plugin-relay test`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-relay typecheck && pnpm --filter @forge-go/dashboard-plugin-relay lint`
Expected: clean. Only `tsc` sees the barrel, so run it even when tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-relay/
git commit -m "feat(relay): endpoints list

Flags an endpoint with no signing secret as Unsigned in destructive,
because it still sends a well-formed X-Relay-Signature and nothing else
on the row would tell you."
```

---

### Task 8: Endpoint detail and create

**Files:**
- Create: `packages/plugin-relay/src/pages/endpoint-detail.tsx`
- Create: `packages/plugin-relay/src/pages/endpoint-create.tsx`
- Create: `packages/plugin-relay/test/endpoint-detail.test.tsx`

**Interfaces:**
- Consumes: `endpoints.detail`, `endpoints.update`, `endpoints.delete`, `endpoints.setEnabled`, `endpoints.rotateSecret`, `endpoints.create`.
- Produces: `RelayEndpointDetailPage`, `RelayEndpointCreatePage`, `EndpointDetail`.

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows a rotated secret once, with a warning", async () => {
  // rotate, then assert the secret is on screen and labelled as
  // unrepeatable.
})

it("renders a failed rotate inside the dialog", async () => {
  // Base UI marks everything outside an open dialog inert and
  // aria-hidden, so an error on the page body is invisible to the person
  // who caused it. If this test needs `hidden: true` to find the error,
  // the markup is wrong and not the test.
  renderDetail({ rotateFails: true })
  await userEvent.click(screen.getByRole("button", { name: /rotate/i }))
  await userEvent.click(screen.getByRole("button", { name: /^rotate$/i }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText(/failed/i)).toBeInTheDocument()
})

it("resets the command state when the dialog opens", async () => {
  // One useCommand serves several actions, so a stale error from a
  // previous action must not greet the next one.
})
```

Build the failure stub so the client THROWS a `ContractError`. `execute()` resolves `undefined` only on a throw; a stub answering `{ ok: false }` resolves normally and the failure path never runs, so the test passes for the wrong reason.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @forge-go/dashboard-plugin-relay test`
Expected: FAIL.

- [ ] **Step 3: Write the pages**

Detail uses `DetailLayout` with `DescriptionList`. Destructive actions go through `ConfirmDialog`, every one with `pending` bound to the command's pending state, because it does not debounce and a double click sends twice. Call `reset()` when each dialog opens.

Rotate's dialog copy names the consequence:

> Rotating replaces this endpoint's signing secret. Deliveries signed with the old secret will start failing verification at the receiver until you update it there. The new secret is shown once and cannot be retrieved again.

Delete's copy:

> Deleting this endpoint stops all deliveries to it. Events matching its patterns will no longer be sent anywhere unless another endpoint matches them.

Create uses `SettingsForm`. Its event-types field takes glob patterns, so label it with an example rather than leaving the operator to guess the syntax.

- [ ] **Step 4: Run, typecheck, lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-relay test && pnpm --filter @forge-go/dashboard-plugin-relay typecheck && pnpm --filter @forge-go/dashboard-plugin-relay lint`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-relay/
git commit -m "feat(relay): endpoint detail and create

Errors render inside their dialogs, every confirm carries pending, and
rotate says plainly what breaks at the receiver."
```

---

### Task 9: Register the plugin and run the thing

This is the task that finds the bugs. Every serious problem in the authsome migration was found here and not by a test.

**Files:**
- Modify: `apps/shell/src/App.tsx:6-24`
- Modify: `apps/shell/package.json`

**Interfaces:**
- Consumes: `relayPlugin` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Add the dependency and register it**

In `apps/shell/package.json`, add `"@forge-go/dashboard-plugin-relay": "workspace:*"`.

In `App.tsx`:

```tsx
import relayPlugin from "@forge-go/dashboard-plugin-relay"

const plugins = [corePlugin, streamingPlugin, authsomePlugin, relayPlugin]
```

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm install`

- [ ] **Step 2: Start the fixture and the shell**

Run the fixture server and the shell dev server, then open the dashboard.

- [ ] **Step 3: Click through every one of these**

- [ ] The Relay nav group appears, with Endpoints under it.
- [ ] `/endpoints` with no tenant selected lists all three seeded endpoints,
      across `acme` and `globex`, with a live count in the caption. Filtering to
      `acme` lists two.
- [ ] The globex endpoint shows **Unsigned** in destructive.
- [ ] Filtering to tenant `nobody` shows "No endpoints match", not "No endpoints yet".
- [ ] Clicking a row navigates without a full page reload. Watch the network tab: a reload here means a plain `<a>` slipped in instead of `PluginLink`.
- [ ] Disabling an endpoint updates the list immediately. If it does not, `invalidates` is wrong, and that is the single most likely thing to be wrong in this whole plan.
- [ ] Creating an endpoint makes it appear in the list.
- [ ] Rotating a secret shows it once and flips the endpoint to Signed on the next read.
- [ ] Rotating the globex endpoint clears its Unsigned badge.
- [ ] A failing command shows its error inside the open dialog, not behind it.
- [ ] Deleting an endpoint removes it from the list.
- [ ] Every page works at a narrow viewport.

- [ ] **Step 4: Full workspace check**

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm -r test && pnpm -r typecheck && pnpm -r lint`
Expected: all clean. Run the whole workspace, not just this package: scoping to one package has twice let a stale assertion in another sit unnoticed for days.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add apps/shell/
git commit -m "feat(shell): register the relay plugin"
```

- [ ] **Step 6: Write down what the slice taught us**

Before planning the remaining twenty intents, record in `relay/MIGRATION.md` anything that turned out differently from what the spec assumed: envelope shape, how `invalidates` actually behaved, fixture fidelity gaps, kit components that did not fit. That record is the reason this slice went first.
