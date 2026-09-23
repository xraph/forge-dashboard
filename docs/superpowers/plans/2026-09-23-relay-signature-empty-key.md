# Relay signature empty-key refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Relay producing a valid-looking HMAC signature from an empty signing secret, so an endpoint without a secret fails loudly instead of sending deliveries anybody can forge.

**Architecture:** The refusal goes in the `signature` package, not in its callers. A primitive that accepts a null key makes every caller responsible for a check they will forget, and there are already two call sites plus a public store interface that bypasses the service which would normally guarantee the secret exists.

**Tech Stack:** Go, `crypto/hmac`, `crypto/sha256`.

**Spec:** Not covered by the dashboard spec. This is an independent correctness fix found while reading the domain for `docs/superpowers/specs/2026-09-23-relay-dashboard-design.md`.

**Repository:** `/Users/rexraphael/Work/xraph/forgery/relay`.

## The finding

`signature.Sign` HMACs the payload with whatever key it is handed. Given an empty secret it returns a well-formed `v1=` plus 64 hex characters, and `signature.Verify` returns true for it. Measured, not inferred:

```
real secret : v1=ceb03692a4eaee5cbc398d60185a6ae52936df62c3c2b854a00fe036bc1093ac
empty secret: v1=2d66c5cfd147d2e05967af171d8a75826b6e92e028acaa80e206df7a527091d0
verify empty-secret sig with empty secret: true
```

Nothing in the header distinguishes the two. `delivery/sender.go:53` signs unconditionally, so an endpoint that reached the store without a secret sends deliveries carrying a signature that anyone who knows the payload and timestamp can reproduce. A receiver doing verification correctly still accepts them.

`endpoint.Service.Create` always generates a secret, so the ordinary path is safe. `endpoint.Store.CreateEndpoint` is public and `dashboard/data.go` already reaches past the service to the store, so the unsafe path is not exotic.

## Global Constraints

- The refusal lives in `signature`. Callers must not be able to opt out by forgetting.
- `Verify` must never return true for an empty secret, whatever signature it is given.
- A delivery to an endpoint with no secret fails with a readable error and goes to the DLQ. It must not send unsigned, and it must not send a forgeable signature.
- This changes behaviour for any deployment currently running an endpoint with no secret: its deliveries start failing. That is correct, those deliveries were never authenticated, but it needs the operator-facing note in Task 4.
- Run `make test` and `make vet` from the relay root.

## Review Focus

1. A whitespace-only secret must be refused exactly like an empty one, or the check is trivially bypassed. Task 1.
2. `Verify` given an empty secret and the signature that empty secret would produce must return false, not true. Task 1.
3. The sender must fail the delivery rather than sending it unsigned when the secret is missing. Task 2.
4. The failure must be distinguishable in the DLQ from a network error, or an operator cannot tell a misconfigured endpoint from an unreachable one. Task 2.
5. An operator needs a way to find endpoints already in this state before the change starts failing their deliveries. Task 3.

---

### Task 1: The signature package refuses an absent key

**Files:**
- Modify: `signature/signer.go`
- Modify: `signature/verifier.go`
- Modify: `signature/signer_test.go`
- Modify: `errors.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `signature.ErrNoSecret`, `Sign(payload []byte, secret string, timestamp int64) (string, error)`, `(*Signer).Sign` with the same new signature, and `Verify` unchanged in shape but returning false for an empty secret. Task 2 consumes all of these.

- [ ] **Step 1: Write the failing tests**

Add to `signature/signer_test.go`:

```go
func TestSignRefusesAnEmptySecret(t *testing.T) {
	_, err := signature.Sign([]byte(`{"a":1}`), "", 1750000000)
	if !errors.Is(err, signature.ErrNoSecret) {
		t.Fatalf("error = %v, want ErrNoSecret", err)
	}
}

func TestSignRefusesAWhitespaceSecret(t *testing.T) {
	// A secret of spaces is an absent secret wearing a disguise. Refusing
	// only "" leaves the check trivially bypassable by a bad import.
	_, err := signature.Sign([]byte(`{"a":1}`), "   ", 1750000000)
	if !errors.Is(err, signature.ErrNoSecret) {
		t.Fatalf("error = %v, want ErrNoSecret", err)
	}
}

func TestVerifyIsFalseForAnEmptySecret(t *testing.T) {
	// Before this change, Sign("") produced a signature that verified
	// against "" and looked exactly like a real one on the wire.
	payload := []byte(`{"a":1}`)
	ts := int64(1750000000)
	forged := "v1=2d66c5cfd147d2e05967af171d8a75826b6e92e028acaa80e206df7a527091d0"
	if signature.Verify(payload, "", ts, forged) {
		t.Fatal("Verify returned true for an empty secret")
	}
}

func TestSignStillWorksWithARealSecret(t *testing.T) {
	sig, err := signature.Sign([]byte(`{"a":1}`), "whsec_test", 1750000000)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !signature.Verify([]byte(`{"a":1}`), "whsec_test", 1750000000, sig) {
		t.Fatal("a real secret no longer round-trips")
	}
}
```

The existing tests in this file call `Sign` with one return value and will stop compiling. Update each to take `(sig, err)` and fail on a non-nil error. `TestSignKnownVector` is the important one: its vector must not change, because a changed vector means every deployed receiver starts rejecting.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./signature/`
Expected: compile failure on the arity change, then `TestVerifyIsFalseForAnEmptySecret` failing.

- [ ] **Step 3: Implement**

In `signature/signer.go`:

```go
// ErrNoSecret is returned when signing is attempted without a secret.
//
// An empty key is not a weak key, it is an absent one. HMAC will happily
// produce a well-formed digest from it, and that digest verifies against the
// same empty key, so the result is indistinguishable on the wire from a real
// signature and anybody who knows the payload and timestamp can reproduce it.
// Refusing here rather than in each caller is deliberate: a primitive that
// accepts a null key makes every caller responsible for a check they forget.
var ErrNoSecret = errors.New("relay/signature: signing secret is empty")

// Sign generates the HMAC-SHA256 signature for the given payload.
// The content to sign is "{timestamp}.{payload}".
// Returns a versioned signature in the format "v1=<hex>".
func Sign(payload []byte, secret string, timestamp int64) (string, error) {
	if strings.TrimSpace(secret) == "" {
		return "", ErrNoSecret
	}
	content := fmt.Sprintf("%d.%s", timestamp, payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(content))
	return "v1=" + hex.EncodeToString(mac.Sum(nil)), nil
}

// Sign generates the HMAC-SHA256 signature for the given payload.
func (s *Signer) Sign(payload []byte, secret string, timestamp int64) (string, error) {
	return Sign(payload, secret, timestamp)
}
```

In `signature/verifier.go`:

```go
// Verify reports whether sig is the correct signature for payload under
// secret. An empty secret is always false: there is no signature that can
// be correct under a key that does not exist.
func Verify(payload []byte, secret string, timestamp int64, sig string) bool {
	expected, err := Sign(payload, secret, timestamp)
	if err != nil {
		return false
	}
	return hmac.Equal([]byte(expected), []byte(sig))
}
```

Keep whatever constant-time comparison the current implementation uses; read it before replacing it rather than assuming `hmac.Equal`.

Add to `errors.go` in the relay root, so callers outside the package have one place to check:

```go
	// ErrEndpointNotSigned is returned when a delivery is attempted to an
	// endpoint with no signing secret.
	ErrEndpointNotSigned = errors.New("relay: endpoint has no signing secret")
```

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./signature/ -v`
Expected: PASS, with `TestSignKnownVector` producing the same vector it always did.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add signature/ errors.go
git commit -m "fix(signature): refuse to sign with an absent key

An empty secret produced a well-formed v1= signature that verified
against the same empty secret, indistinguishable on the wire from a
real one and reproducible by anyone who knows the payload and
timestamp. Refusing in the primitive rather than in each caller,
because a caller-side check is one somebody forgets."
```

---

### Task 2: The sender fails rather than forging

**Files:**
- Modify: `delivery/sender.go:45-60`
- Modify: `delivery/sender_test.go`

**Interfaces:**
- Consumes: `signature.Sign` returning `(string, error)` and `relay.ErrEndpointNotSigned` from Task 1.
- Produces: nothing new. `Sender.Send` keeps its signature and returns a `Result` with a descriptive `Error`.

- [ ] **Step 1: Write the failing test**

```go
func TestSendRefusesAnEndpointWithNoSecret(t *testing.T) {
	var reached bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(200)
	}))
	defer srv.Close()

	ep := &endpoint.Endpoint{ID: id.NewEndpointID(), URL: srv.URL, Secret: ""}
	res := newSender(t).Send(context.Background(), ep, testEvent(), testDelivery())

	if reached {
		t.Fatal("the request was sent to the receiver despite having no secret")
	}
	if res.StatusCode != 0 {
		t.Fatalf("StatusCode = %d, want 0", res.StatusCode)
	}
	if !strings.Contains(res.Error, "signing secret") {
		t.Fatalf("Error = %q, want something naming the missing secret", res.Error)
	}
}
```

The error text matters. It lands in `LastError` and then in the DLQ entry, and it is the only thing telling an operator that this endpoint is misconfigured rather than unreachable.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./delivery/ -run TestSendRefuses`
Expected: FAIL, the request reaches the server.

- [ ] **Step 3: Implement**

In `delivery/sender.go`, before the request is built:

```go
	sig, sigErr := signature.Sign(body, ep.Secret, ts)
	if sigErr != nil {
		// Do not send. An unsigned delivery is one the receiver cannot
		// authenticate, and a delivery signed with an empty key is worse:
		// it looks authentic and is not.
		return Result{
			StatusCode: 0,
			Error:      fmt.Sprintf("endpoint has no signing secret: %v", sigErr),
		}
	}
	req.Header.Set("X-Relay-Signature", sig)
```

Check where `body` and `ts` are defined relative to the request construction and place the block so nothing is sent on the error path.

Note the consequence for the retrier: `StatusCode: 0` is currently treated as a network error and retried. A missing secret will never fix itself by retrying, so it burns the whole retry budget before reaching the DLQ. Leave that for now and record it in Task 4; changing the decision matrix is a separate question from this fix.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./delivery/ -v`
Expected: PASS.

- [ ] **Step 5: Full build and test**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go build ./... && make test && make vet`
Expected: clean. The build catches any other `signature.Sign` caller missed by the arity change.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add delivery/
git commit -m "fix(delivery): do not deliver to an endpoint with no secret

Sending a signature derived from an empty key is worse than sending
none: it looks authentic to a receiver doing everything right."
```

---

### Task 3: Let an operator find endpoints already in this state

Before the change starts failing deliveries, somebody needs to know which endpoints it will affect.

**Files:**
- Modify: `endpoint/service.go`
- Test: `endpoint/service_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `(*endpoint.Service).ListUnsigned(ctx context.Context, tenantID string) ([]*Endpoint, error)`.

- [ ] **Step 1: Write the failing test**

```go
func TestListUnsignedFindsEndpointsWithNoSecret(t *testing.T) {
	store := memory.New()
	svc := endpoint.NewService(store, nil)

	signed := &endpoint.Endpoint{Entity: entity.New(), ID: id.NewEndpointID(),
		TenantID: "t1", URL: "https://a.example", Secret: "whsec_x", Enabled: true}
	unsigned := &endpoint.Endpoint{Entity: entity.New(), ID: id.NewEndpointID(),
		TenantID: "t1", URL: "https://b.example", Secret: "", Enabled: true}
	for _, ep := range []*endpoint.Endpoint{signed, unsigned} {
		if err := store.CreateEndpoint(context.Background(), ep); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	got, err := svc.ListUnsigned(context.Background(), "")
	if err != nil {
		t.Fatalf("list unsigned: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d unsigned endpoints, want 1", len(got))
	}
	if got[0].ID != unsigned.ID {
		t.Fatalf("found the wrong endpoint: %s", got[0].ID)
	}
}
```

Assert on identity, not on count. A count assertion passes when the wrong rows come back in the right quantity.

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./endpoint/ -run TestListUnsigned`
Expected: FAIL, undefined method.

- [ ] **Step 3: Implement**

```go
// ListUnsigned returns endpoints that have no signing secret. Deliveries to
// these fail rather than being sent, because a signature derived from an
// empty key looks authentic and is not. An empty tenantID scans every tenant.
//
// This exists to be run before upgrading: it names what the change will
// start failing.
func (svc *Service) ListUnsigned(ctx context.Context, tenantID string) ([]*Endpoint, error) {
	eps, err := svc.store.ListEndpoints(ctx, tenantID, ListOpts{Limit: 10000})
	if err != nil {
		return nil, err
	}
	out := make([]*Endpoint, 0)
	for _, ep := range eps {
		if strings.TrimSpace(ep.Secret) == "" {
			out = append(out, ep)
		}
	}
	return out, nil
}
```

Add `"strings"` to the imports.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/rexraphael/Work/xraph/forgery/relay && go test ./endpoint/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add endpoint/
git commit -m "feat(endpoint): ListUnsigned names what the signing fix will break"
```

---

### Task 4: Write down the behaviour change

**Files:**
- Modify: `README.md` in the relay root, or the relevant page under `docs/`. Check both.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the note**

```markdown
### Endpoints must have a signing secret

Relay refuses to sign with an empty secret, and refuses to deliver to an
endpoint that has one. Before this, an endpoint with no secret received
deliveries carrying a well-formed `X-Relay-Signature` computed with the empty
string as the key. That signature verified against the same empty key, so a
receiver doing verification correctly still accepted it, and anybody who knew
the payload and timestamp could reproduce it.

`Endpoints().Create` has always generated a secret when none is supplied. An
endpoint can only reach this state through the store interface directly.

Run `Endpoints().ListUnsigned(ctx, "")` before upgrading to see which
endpoints, if any, will start failing. Rotate a secret onto each one with
`Endpoints().RotateSecret`.

Deliveries to an unsigned endpoint fail with "endpoint has no signing secret"
and land in the dead letter queue after exhausting the retry schedule. The
retries are wasted, since a missing secret does not fix itself, but the DLQ
entry names the cause.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/relay
git add -A
git commit -m "docs: endpoints must have a signing secret"
```
