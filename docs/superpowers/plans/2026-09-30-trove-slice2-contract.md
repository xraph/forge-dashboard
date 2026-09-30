# Trove slice 2: the dashboard contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Trove extension a forge dashboard contract contributor that answers the 20 intents in the spec, mints signed tickets for object content, and serves that content through its own routes, so the React plugin in slices 3 and 4 has something to call.

**Architecture:** A new package `trove/extension/contract` holds the manifest, a store resolver over one or many `*trove.Trove`, error mapping, cursor wrapping, HMAC tickets, the handlers, and the content `http.Handler`. Every read goes to the drivers, never to `extension/store`. The extension builds the resolver and the ticket signer in `Register`, mounts the content route on the forge router there, and registers the contract when the dashboard calls `RegisterContractContributor`.

**Tech Stack:** Go 1.26 (extension module), forge v1.11.2 dashboard contract (`contract`, `contract/dispatcher`, `contract/loader`, `contract/transport`), Trove root module (drivers, middleware, cas, stream), stdlib `testing` only (the extension module has no testify; do not add it).

**Spec:** `docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md` in forge-dashboard, sections "The extension", "The contract package", "The 20 intents", "Content routes and tickets", "Testing", and "What slice 1 found that slice 2 must know".

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forgery/trove`, branch `main`. The extension is its own module at `trove/extension` (`replace github.com/xraph/trove => ..`). Run Go commands for this slice from `/Users/rexraphael/Work/xraph/forgery/trove/extension`. Work on `main` directly. No worktrees.
- Commit only your own paths: `git add <new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo, back up and restore the single file.
- Commit messages carry NO `Co-Authored-By` trailer and no AI attribution. No em dashes or en dashes anywhere: code comments, test names, commit text.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C` from the extension directory. Pre-existing issues in lines you did not touch are expected; list them, do not fix them.
- `ContributorName = "trove"`. It is the join key with `packages/plugin-trove`'s `extension` field.
- Production code must never import `github.com/xraph/forge/extensions/dashboard` (the root package). Only `.../dashboard/contract`, `.../contract/dispatcher`, `.../contract/loader` and `.../dashboard/auth` in production; the `ContractContributorAware` assertion lives in a `_test.go` file.
- The contract never reads `extension/store`. Every answer comes from `*trove.Trove` and its drivers.
- Wire types: camelCase JSON; times UTC RFC3339 via `formatTime`; an absent value is JSON `null`, never `0` or `""`; a list is `[]`, never `null`, except `prefixes` on a flat listing, which is `null` on purpose.
- Error mapping (spec table): not found sentinels and unknown store are `NOT_FOUND`; bucket exists and key exists without overwrite are `CONFLICT`; `trove.ErrContentBlocked` is `BAD_REQUEST`; a refused precondition (non-empty bucket, CAS bucket delete, copy across middleware) is `CONFLICT` with the reason; a missing or malformed field is `BAD_REQUEST`; anything else is `INTERNAL` with the generic message "an internal error occurred", logged with the intent name.
- Store resolution: an absent or empty `store` means the default store. A `store` that is present but blank after trimming is `BAD_REQUEST` ("present and unusable must refuse", playbook). An unknown name is `NOT_FOUND`, never a fall back to the default.
- Paging: `cursor` in, `nextCursor` out, base64url (no padding) of the driver's raw `NextToken`. A cursor that fails to decode is `BAD_REQUEST`. `nextCursor` is `null` when the driver's token is empty. No list returns a total.
- Tickets: HMAC-SHA256, `base64url(json payload) + "." + base64url(mac)`. Download and preview tickets live 60 seconds, upload tickets 15 minutes. A configured secret must be at least 32 bytes.
- Config defaults: `dashboard_content_path` `/dashboard/trove/content`; `dashboard_max_upload_bytes` 67108864 (64 MiB); `dashboard_content_secret` empty (random per-process key).
- Content GET always sends `Content-Disposition: attachment; filename*=UTF-8''<escaped last key segment>`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: no-store`. `Content-Length` only when no read middleware matches the key and the ticket is a download.
- Test backends: every handler test runs against memdriver and localdriver (real temp dir) through `forEachBackend`.

## Review Focus

1. A key carrying spaces, non-ASCII, `#`, `?` or `%` must download with its bytes intact and a correctly escaped filename, because the key travels only inside the signed ticket. Pinned in Task 6 (`TestContentGet_KeyWithAwkwardCharacters`).
2. A client that declares a small upload and sends a large body must get 413 and leave nothing stored. Pinned in Task 6 (`TestContentPut_BodyLargerThanTicketIsRefused`).
3. A blank `store` ("  ") must be refused rather than silently resolving to the default store. Pinned in Task 2 (`TestStores_ResolveBlankIsBadRequest`).
4. Deleting a non-empty bucket on localdriver must refuse and leave every file on disk, even though localdriver itself would delete recursively. Pinned in Task 4 (`TestBucketsDelete_RefusesNonEmptyAndKeepsFiles`).
5. Copying an object from a key compress applies to into a key it does not must refuse, because copy moves stored zstd bytes into a scope that will not decode them. Pinned in Task 5 (`TestObjectsCopy_RefusesAcrossDifferentMiddleware`).

---

### Task 1: Require forge v1.11.2 and add signed content tickets

**Files:**
- Modify: `extension/go.mod`, `extension/go.sum`
- Create: `extension/contract/tickets.go`
- Test: `extension/contract/tickets_test.go`

**Interfaces:**
- Produces:
  - constants `OpDownload = "download"`, `OpPreview = "preview"`, `OpUpload = "upload"`, `DownloadTicketTTL = 60 * time.Second`, `UploadTicketTTL = 15 * time.Minute`
  - `var ErrTicketInvalid, ErrTicketExpired error`
  - `type Ticket struct { Store, Bucket, Key, Op string; Expires int64; Subject string; Size int64; ContentType string; Overwrite bool; Limit int64 }`
  - `func NewSigner(key []byte) (*Signer, error)` (key at least 32 bytes), `func NewRandomSigner() (*Signer, error)`
  - `func (s *Signer) Issue(t Ticket, ttl time.Duration) (token string, expires time.Time, err error)`
  - `func (s *Signer) Verify(token string) (Ticket, error)`

Why forge v1.11.2: forge v1.10.0's transport did not merge a manifest's `invalidates` into command responses, so no dashboard write refreshed any read. Vault pinned v1.11.2 for exactly this. v1.11.2 still has `DashboardAware`, so the templ dashboard keeps compiling until slice 5 deletes it (checked on a scratch copy: `go build ./...` passes).

- [ ] **Step 1: Bump forge**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
go get github.com/xraph/forge@v1.11.2
go build ./... && go test ./...
```
Expected: `go get` also upgrades `github.com/xraph/confy` and `github.com/xraph/go-utils` to what forge v1.11.2 requires. Build and tests pass, the templ dashboard included.

- [ ] **Step 2: Write the failing ticket tests**

Create `extension/contract/tickets_test.go`:

```go
package contract

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"
)

func newTestSigner(t *testing.T) *Signer {
	t.Helper()
	s, err := NewSigner(bytes.Repeat([]byte("s"), 32))
	if err != nil {
		t.Fatalf("NewSigner: %v", err)
	}
	return s
}

func TestNewSigner_RejectsShortKey(t *testing.T) {
	if _, err := NewSigner(bytes.Repeat([]byte("s"), 31)); err == nil {
		t.Fatal("a 31-byte key was accepted")
	}
}

func TestNewRandomSigner_SignsAndVerifies(t *testing.T) {
	s, err := NewRandomSigner()
	if err != nil {
		t.Fatalf("NewRandomSigner: %v", err)
	}
	tok, _, err := s.Issue(Ticket{Store: "default", Bucket: "b", Key: "k", Op: OpDownload}, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := s.Verify(tok); err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

func TestSigner_RoundTrip(t *testing.T) {
	s := newTestSigner(t)
	in := Ticket{
		Store: "default", Bucket: "reports", Key: "2026/q3 résumé #1.pdf", Op: OpUpload,
		Subject: "user_1", Size: 42, ContentType: "application/pdf", Overwrite: true, Limit: 7,
	}
	tok, expires, err := s.Issue(in, UploadTicketTTL)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	got, err := s.Verify(tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	in.Expires = expires.Unix()
	if got != in {
		t.Fatalf("ticket = %+v, want %+v", got, in)
	}
}

func TestSigner_Expired(t *testing.T) {
	s := newTestSigner(t)
	now := time.Date(2026, 9, 30, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	tok, _, err := s.Issue(Ticket{Store: "default", Bucket: "b", Key: "k", Op: OpDownload}, DownloadTicketTTL)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	now = now.Add(DownloadTicketTTL)
	if _, err := s.Verify(tok); !errors.Is(err, ErrTicketExpired) {
		t.Fatalf("Verify at expiry = %v, want ErrTicketExpired", err)
	}
}

func TestSigner_TamperedPayloadIsInvalid(t *testing.T) {
	s := newTestSigner(t)
	tok, _, err := s.Issue(Ticket{Store: "default", Bucket: "b", Key: "k", Op: OpDownload}, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	_, sig, _ := strings.Cut(tok, ".")
	forged := base64.RawURLEncoding.EncodeToString([]byte(`{"s":"default","b":"b","k":"other","o":"download","e":9999999999}`))
	if _, err := s.Verify(forged + "." + sig); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("Verify of a forged payload = %v, want ErrTicketInvalid", err)
	}
}

func TestSigner_TamperedSignatureIsInvalid(t *testing.T) {
	s := newTestSigner(t)
	tok, _, err := s.Issue(Ticket{Store: "default", Bucket: "b", Key: "k", Op: OpDownload}, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	body, _, _ := strings.Cut(tok, ".")
	bad := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0}, 32))
	if _, err := s.Verify(body + "." + bad); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("Verify of a bad signature = %v, want ErrTicketInvalid", err)
	}
}

func TestSigner_OtherKeyIsInvalid(t *testing.T) {
	a := newTestSigner(t)
	b, err := NewSigner(bytes.Repeat([]byte("x"), 32))
	if err != nil {
		t.Fatalf("NewSigner: %v", err)
	}
	tok, _, err := a.Issue(Ticket{Store: "default", Bucket: "b", Key: "k", Op: OpDownload}, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := b.Verify(tok); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("Verify under another key = %v, want ErrTicketInvalid", err)
	}
}

func TestSigner_MalformedTokensAreInvalid(t *testing.T) {
	s := newTestSigner(t)
	for _, tok := range []string{"", "abc", "abc.", ".abc", "!!!.!!!", "a.b.c"} {
		if _, err := s.Verify(tok); !errors.Is(err, ErrTicketInvalid) {
			t.Errorf("Verify(%q) = %v, want ErrTicketInvalid", tok, err)
		}
	}
}

func TestSigner_TicketWithoutOperationIsInvalid(t *testing.T) {
	s := newTestSigner(t)
	tok, _, err := s.Issue(Ticket{Store: "default", Bucket: "b", Key: "k"}, time.Minute)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := s.Verify(tok); !errors.Is(err, ErrTicketInvalid) {
		t.Fatalf("Verify of a ticket with no op = %v, want ErrTicketInvalid", err)
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile, `undefined: NewSigner`, `undefined: Ticket`.

- [ ] **Step 4: Write the signer**

Create `extension/contract/tickets.go`:

```go
package contract

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Ticket operations. A ticket authorises exactly one of these against one
// object, so a download ticket cannot be replayed as an upload.
const (
	OpDownload = "download"
	OpPreview  = "preview"
	OpUpload   = "upload"
)

// Ticket lifetimes. The browser follows a download or preview link at
// once. An upload of the largest allowed file on a slow link takes a while.
const (
	DownloadTicketTTL = 60 * time.Second
	UploadTicketTTL   = 15 * time.Minute
)

// minSecretBytes is the shortest HMAC key a Signer accepts.
const minSecretBytes = 32

var (
	// ErrTicketInvalid reports a ticket that is malformed or whose
	// signature does not match.
	ErrTicketInvalid = errors.New("trove/contract: ticket is invalid")

	// ErrTicketExpired reports a correctly signed ticket past its expiry.
	ErrTicketExpired = errors.New("trove/contract: ticket has expired")
)

// Ticket says what one content request may do. A contract intent signs it
// and the content route checks it, so the route needs nothing from the
// dashboard's session. Field names are short because the ticket travels in
// a URL.
type Ticket struct {
	Store       string `json:"s"`
	Bucket      string `json:"b"`
	Key         string `json:"k"`
	Op          string `json:"o"`
	Expires     int64  `json:"e"`
	Subject     string `json:"sub,omitempty"`
	Size        int64  `json:"n,omitempty"`
	ContentType string `json:"ct,omitempty"`
	Overwrite   bool   `json:"ow,omitempty"`
	Limit       int64  `json:"l,omitempty"`
}

// Signer mints and checks tickets with one HMAC-SHA256 key.
type Signer struct {
	key []byte
	now func() time.Time
}

// NewSigner returns a Signer over key, which must be at least 32 bytes.
func NewSigner(key []byte) (*Signer, error) {
	if len(key) < minSecretBytes {
		return nil, fmt.Errorf("trove/contract: ticket key must be at least %d bytes, got %d", minSecretBytes, len(key))
	}
	k := make([]byte, len(key))
	copy(k, key)
	return &Signer{key: k, now: time.Now}, nil
}

// NewRandomSigner returns a Signer over a fresh random key. Its tickets
// verify only in this process, so a deployment with more than one instance
// needs a configured key instead.
func NewRandomSigner() (*Signer, error) {
	key := make([]byte, minSecretBytes)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("trove/contract: generate ticket key: %w", err)
	}
	return NewSigner(key)
}

// Issue signs t with an expiry ttl from now, and returns the token and that
// expiry. Expiry is kept to the second, because that is what the token
// carries.
func (s *Signer) Issue(t Ticket, ttl time.Duration) (string, time.Time, error) {
	expires := s.now().Add(ttl).Truncate(time.Second)
	t.Expires = expires.Unix()
	payload, err := json.Marshal(t)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("trove/contract: encode ticket: %w", err)
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.mac(body)), expires, nil
}

// Verify checks token's signature and expiry and returns the ticket it
// carries. A ticket is expired from its expiry second onwards.
func (s *Signer) Verify(token string) (Ticket, error) {
	body, sig, ok := strings.Cut(token, ".")
	if !ok || body == "" || sig == "" {
		return Ticket{}, ErrTicketInvalid
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(body)) {
		return Ticket{}, ErrTicketInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return Ticket{}, ErrTicketInvalid
	}
	var t Ticket
	if err := json.Unmarshal(payload, &t); err != nil || t.Op == "" || t.Bucket == "" || t.Key == "" {
		return Ticket{}, ErrTicketInvalid
	}
	if s.now().Unix() >= t.Expires {
		return Ticket{}, ErrTicketExpired
	}
	return t, nil
}

func (s *Signer) mac(body string) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(body))
	return h.Sum(nil)
}
```

Note on `"a.b.c"`: `strings.Cut` splits at the first dot, so the signature part is `"b.c"`, which is not valid base64url (a dot is not in the alphabet), so it is invalid. Good.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/ && go build ./...`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
git add extension/contract/tickets.go extension/contract/tickets_test.go
git commit --only -m "feat(extension): require forge v1.11.2 and sign content tickets" -- extension/go.mod extension/go.sum extension/contract/tickets.go extension/contract/tickets_test.go
git show --stat HEAD
```

Body: forge v1.10.0 never merged a manifest's invalidates into command responses, so the bump is what makes a dashboard write refresh its reads. Tickets let a contract intent authorise one content request that the content route can check with nothing but the key.

---

### Task 2: Contract foundation: stores, errors, cursors, projections, manifest, Register

**Files:**
- Create: `extension/contract/stores.go`, `extension/contract/errors.go`, `extension/contract/cursor.go`, `extension/contract/project.go`, `extension/contract/content.go`, `extension/contract/contract.go`, `extension/contract/manifest.yaml`
- Test: `extension/contract/helpers_test.go`, `extension/contract/stores_test.go`, `extension/contract/errors_test.go`, `extension/contract/cursor_test.go`, `extension/contract/manifest_test.go`

**Interfaces:**
- Consumes: `Signer` from Task 1.
- Produces (later tasks rely on every one of these names):
  - `const ContributorName = "trove"`, `const SingleStoreName = "default"`
  - `type Flags struct { Encryption, Compression, CAS bool }`
  - `type Store struct { Name string; Trove *trove.Trove; Configured Flags }`
  - `type Stores struct` with `NewSingleStore(t *trove.Trove, configured Flags) *Stores`, `NewStores(defaultName string, list []Store) (*Stores, error)`, `(*Stores).Multi() bool`, `(*Stores).DefaultName() string`, `(*Stores).All() []Store`, `(*Stores).Resolve(name string) (*Store, error)`
  - `type Content struct { Signer *Signer; Path string; MaxUploadBytes int64; PerProcessSecret bool }`, `(*Content).URL(token string) string`
  - `type Deps struct { Stores *Stores; Content *Content; Logger forge.Logger }`
  - `func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error`
  - `type binding struct{...}`, `func query[I, O any](intent string, fn func(context.Context, I, contract.Principal) (O, error)) binding`, `func command[I, O any](...) binding`, and `func bindings(deps Deps) []binding` (Task 2 returns an empty list; Tasks 3 to 7 append)
  - `func mapError(err error) error`, `func (d Deps) mapError(intent string, err error) error`, `func badRequest(msg string) error`, `func conflict(msg string) error`, `func notFound(msg string) error`, `func unavailable(msg string) error`, `func requireName(field, value string) error`
  - `func encodeCursor(token string) *string`, `func decodeCursor(cursor string) (string, error)`
  - `func formatTime(t time.Time) *string`, `func optString(s string) *string`
  - `type objectRow struct` (`key`, `storedSize`, `etag`, `lastModified`, `contentType`, `storageClass`), `func projectObjectRow(o driver.ObjectInfo) objectRow`
  - `type objectDetail struct` (objectRow fields plus `versionId`, `metadata`), `func projectObjectDetail(o *driver.ObjectInfo) objectDetail`
  - driver facts: `func driverFolds(name string) bool`, `func etagIsContentHash(name string) bool`, `func createdAtIsCreation(name string) bool`
  - test helpers in `helpers_test.go`: `forEachBackend`, `newStores`, `testContent`, `testDeps`, `codeOf`, `put`, `principalFor`, `mustBucket`

- [ ] **Step 1: Write the test helpers**

Create `extension/contract/helpers_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/driver"
	"github.com/xraph/trove/drivers/localdriver"
	"github.com/xraph/trove/drivers/memdriver"
)

// opener builds a fresh Trove over one driver, with opts applied.
type opener func(t *testing.T, opts ...trove.Option) *trove.Trove

func openMem(t *testing.T, opts ...trove.Option) *trove.Trove {
	t.Helper()
	drv := memdriver.New()
	if err := drv.Open(context.Background(), ""); err != nil {
		t.Fatalf("open memdriver: %v", err)
	}
	return openTrove(t, drv, opts...)
}

func openLocal(t *testing.T, opts ...trove.Option) *trove.Trove {
	t.Helper()
	drv := localdriver.New()
	if err := drv.Open(context.Background(), "file://"+t.TempDir()); err != nil {
		t.Fatalf("open localdriver: %v", err)
	}
	return openTrove(t, drv, opts...)
}

func openTrove(t *testing.T, drv driver.Driver, opts ...trove.Option) *trove.Trove {
	t.Helper()
	tv, err := trove.Open(drv, opts...)
	if err != nil {
		t.Fatalf("trove.Open: %v", err)
	}
	t.Cleanup(func() { _ = tv.Close(context.Background()) })
	return tv
}

// forEachBackend runs fn once per backend CI can run: memdriver and
// localdriver on a real temp directory.
func forEachBackend(t *testing.T, fn func(t *testing.T, open opener)) {
	t.Helper()
	for _, b := range []struct {
		name string
		open opener
	}{{"mem", openMem}, {"local", openLocal}} {
		t.Run(b.name, func(t *testing.T) { fn(t, b.open) })
	}
}

func newStores(tv *trove.Trove) *Stores {
	return NewSingleStore(tv, Flags{})
}

func testContent(t *testing.T) *Content {
	t.Helper()
	s, err := NewSigner(bytes.Repeat([]byte("s"), 32))
	if err != nil {
		t.Fatalf("NewSigner: %v", err)
	}
	return &Content{Signer: s, Path: "/dashboard/trove/content", MaxUploadBytes: 1 << 20}
}

func testDeps(t *testing.T, stores *Stores) Deps {
	t.Helper()
	return Deps{Stores: stores, Content: testContent(t)}
}

func codeOf(err error) dashcontract.ErrorCode {
	var ce *dashcontract.Error
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func mustBucket(t *testing.T, tv *trove.Trove, name string) {
	t.Helper()
	if err := tv.CreateBucket(context.Background(), name); err != nil {
		t.Fatalf("CreateBucket(%q): %v", name, err)
	}
}

func put(t *testing.T, tv *trove.Trove, bucket, key, body string, opts ...driver.PutOption) {
	t.Helper()
	if _, err := tv.Put(context.Background(), bucket, key, strings.NewReader(body), opts...); err != nil {
		t.Fatalf("Put(%q, %q): %v", bucket, key, err)
	}
}

func principalFor(subject string) dashcontract.Principal {
	return dashcontract.Principal{User: &dashauth.UserInfo{Subject: subject}}
}
```

If `dashauth.UserInfo` has no `Subject` field in forge v1.11.2, open `$(go env GOMODCACHE)/github.com/xraph/forge@v1.11.2/extensions/dashboard/auth/` and use the field Vault's `operator.go` reads (`p.User.Subject`); it is `Subject`.

- [ ] **Step 2: Write the failing foundation tests**

Create `extension/contract/stores_test.go`:

```go
package contract

import (
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestStores_SingleResolvesEmptyAndDefault(t *testing.T) {
	tv := openMem(t)
	s := NewSingleStore(tv, Flags{CAS: true})
	for _, name := range []string{"", SingleStoreName} {
		st, err := s.Resolve(name)
		if err != nil {
			t.Fatalf("Resolve(%q): %v", name, err)
		}
		if st.Trove != tv || st.Name != SingleStoreName || !st.Configured.CAS {
			t.Fatalf("Resolve(%q) = %+v", name, st)
		}
	}
	if s.Multi() {
		t.Error("a single store reports multi mode")
	}
}

func TestStores_ResolveUnknownIsNotFound(t *testing.T) {
	s := NewSingleStore(openMem(t), Flags{})
	if _, err := s.Resolve("archive"); codeOf(err) != dashcontract.CodeNotFound {
		t.Fatalf("Resolve(archive) = %v, want NOT_FOUND", err)
	}
}

func TestStores_ResolveBlankIsBadRequest(t *testing.T) {
	s := NewSingleStore(openMem(t), Flags{})
	for _, name := range []string{" ", "\t", "  \n"} {
		if _, err := s.Resolve(name); codeOf(err) != dashcontract.CodeBadRequest {
			t.Errorf("Resolve(%q) = %v, want BAD_REQUEST", name, err)
		}
	}
}

func TestStores_MultiResolvesByIdentity(t *testing.T) {
	a, b := openMem(t), openMem(t)
	s, err := NewStores("b", []Store{{Name: "a", Trove: a}, {Name: "b", Trove: b}})
	if err != nil {
		t.Fatalf("NewStores: %v", err)
	}
	if !s.Multi() || s.DefaultName() != "b" {
		t.Fatalf("Multi=%v DefaultName=%q", s.Multi(), s.DefaultName())
	}
	got, err := s.Resolve("a")
	if err != nil || got.Trove != a {
		t.Fatalf("Resolve(a) = %+v, %v", got, err)
	}
	def, err := s.Resolve("")
	if err != nil || def.Trove != b {
		t.Fatalf("Resolve(\"\") = %+v, %v; want the default store b", def, err)
	}
	names := []string{}
	for _, st := range s.All() {
		names = append(names, st.Name)
	}
	if len(names) != 2 || names[0] != "a" || names[1] != "b" {
		t.Fatalf("All() = %v, want [a b] in declared order", names)
	}
}

func TestNewStores_Validates(t *testing.T) {
	tv := openMem(t)
	cases := map[string]struct {
		def  string
		list []Store
	}{
		"empty list":      {"", nil},
		"blank name":      {"", []Store{{Name: " ", Trove: tv}}},
		"duplicate name":  {"", []Store{{Name: "a", Trove: tv}, {Name: "a", Trove: tv}}},
		"missing default": {"z", []Store{{Name: "a", Trove: tv}}},
		"nil trove":       {"", []Store{{Name: "a"}}},
	}
	for name, c := range cases {
		if _, err := NewStores(c.def, c.list); err == nil {
			t.Errorf("%s: NewStores accepted it", name)
		}
	}
}

func TestNewStores_EmptyDefaultIsFirst(t *testing.T) {
	a, b := openMem(t), openMem(t)
	s, err := NewStores("", []Store{{Name: "a", Trove: a}, {Name: "b", Trove: b}})
	if err != nil {
		t.Fatalf("NewStores: %v", err)
	}
	if s.DefaultName() != "a" {
		t.Fatalf("DefaultName = %q, want a", s.DefaultName())
	}
}
```

Create `extension/contract/errors_test.go`:

```go
package contract

import (
	"errors"
	"fmt"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
	"github.com/xraph/trove/driver"
)

func TestMapError_Sentinels(t *testing.T) {
	wrap := func(err error) error { return fmt.Errorf("somedriver: thing: %w", err) }
	cases := []struct {
		err  error
		want dashcontract.ErrorCode
	}{
		{wrap(driver.ErrObjectNotFound), dashcontract.CodeNotFound},
		{wrap(driver.ErrBucketNotFound), dashcontract.CodeNotFound},
		{wrap(cas.ErrNotFound), dashcontract.CodeNotFound},
		{wrap(driver.ErrNotFound), dashcontract.CodeNotFound},
		{wrap(driver.ErrBucketExists), dashcontract.CodeConflict},
		{wrap(trove.ErrContentBlocked), dashcontract.CodeBadRequest},
		{wrap(driver.ErrPermissionDenied), dashcontract.CodePermissionDenied},
		{wrap(driver.ErrQuotaExceeded), dashcontract.CodeUnavailable},
		{wrap(driver.ErrInvalidPath), dashcontract.CodeBadRequest},
		{trove.ErrKeyEmpty, dashcontract.CodeBadRequest},
		{trove.ErrBucketEmpty, dashcontract.CodeBadRequest},
		{errors.New("dial tcp 10.0.0.5:9000: connection refused"), dashcontract.CodeInternal},
	}
	for _, c := range cases {
		if got := codeOf(mapError(c.err)); got != c.want {
			t.Errorf("mapError(%v) = %s, want %s", c.err, got, c.want)
		}
	}
}

func TestMapError_InternalHidesTheCause(t *testing.T) {
	err := mapError(errors.New("s3: secret=abc123 refused"))
	var ce *dashcontract.Error
	if !errors.As(err, &ce) || ce.Message != "an internal error occurred" {
		t.Fatalf("mapError leaked the cause: %v", err)
	}
}

func TestMapError_PassesContractErrorsThrough(t *testing.T) {
	in := conflict("bucket still holds objects")
	if got := mapError(in); got != in {
		t.Fatalf("mapError replaced a contract error: %v", got)
	}
	if mapError(nil) != nil {
		t.Fatal("mapError(nil) is not nil")
	}
}

func TestMapError_BucketBeforeObject(t *testing.T) {
	var ce *dashcontract.Error
	if !errors.As(mapError(driver.ErrBucketNotFound), &ce) || ce.Message != "bucket not found" {
		t.Fatalf("bucket not found mapped to %v", ce)
	}
	if !errors.As(mapError(driver.ErrObjectNotFound), &ce) || ce.Message != "object not found" {
		t.Fatalf("object not found mapped to %v", ce)
	}
}

func TestRequireName(t *testing.T) {
	if err := requireName("bucket", "reports"); err != nil {
		t.Fatalf("requireName(reports) = %v", err)
	}
	for _, v := range []string{"", " ", "\t"} {
		if codeOf(requireName("bucket", v)) != dashcontract.CodeBadRequest {
			t.Errorf("requireName(%q) accepted it", v)
		}
	}
}
```

Create `extension/contract/cursor_test.go`:

```go
package contract

import (
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestCursor_RoundTrip(t *testing.T) {
	for _, raw := range []string{"a/", "logs/2026/x.json", "opaque-token-2", "bad\xffutf8"} {
		enc := encodeCursor(raw)
		if enc == nil {
			t.Fatalf("encodeCursor(%q) = nil", raw)
		}
		got, err := decodeCursor(*enc)
		if err != nil || got != raw {
			t.Fatalf("decodeCursor(encodeCursor(%q)) = %q, %v", raw, got, err)
		}
	}
}

func TestCursor_EmptyTokenIsNull(t *testing.T) {
	if encodeCursor("") != nil {
		t.Fatal("an empty token produced a cursor")
	}
	got, err := decodeCursor("")
	if err != nil || got != "" {
		t.Fatalf("decodeCursor(\"\") = %q, %v", got, err)
	}
}

func TestCursor_MalformedIsBadRequest(t *testing.T) {
	for _, c := range []string{"!!!", "a b", "abc=="} {
		if _, err := decodeCursor(c); codeOf(err) != dashcontract.CodeBadRequest {
			t.Errorf("decodeCursor(%q) = %v, want BAD_REQUEST", c, err)
		}
	}
}
```

Create `extension/contract/manifest_test.go`:

```go
package contract

import (
	"bytes"
	"reflect"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

func loadManifest(t *testing.T) *dashcontract.ContributorManifest {
	t.Helper()
	m, err := loader.Load(bytes.NewReader(manifestYAML), "trove/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	return m
}

func TestManifest_Loads(t *testing.T) {
	m := loadManifest(t)
	if m.Contributor.Name != ContributorName {
		t.Errorf("contributor = %q, want %q", m.Contributor.Name, ContributorName)
	}
	if got := len(m.Intents); got != 20 {
		t.Errorf("intents = %d, want 20", got)
	}
}

func TestManifest_CommandInvalidates(t *testing.T) {
	want := map[string][]string{
		"buckets.create":         {"buckets.list"},
		"buckets.delete":         {"buckets.list", "objects.list"},
		"objects.delete":         {"objects.list", "objects.head", "cas.list"},
		"objects.copy":           {"objects.list", "objects.head"},
		"objects.beginUpload":    nil,
		"objects.completeUpload": {"objects.list", "objects.head"},
		"objects.presign":        nil,
		"cas.pin":                {"cas.list"},
		"cas.unpin":              {"cas.list"},
		"cas.gc":                 {"cas.list", "cas.status"},
	}
	seen := 0
	for _, in := range loadManifest(t).Intents {
		if in.Kind != dashcontract.IntentKindCommand {
			if len(in.Invalidates) != 0 {
				t.Errorf("query %s declares invalidates %v", in.Name, in.Invalidates)
			}
			continue
		}
		w, ok := want[in.Name]
		if !ok {
			t.Errorf("unexpected command %s", in.Name)
			continue
		}
		seen++
		if len(w) == 0 && len(in.Invalidates) == 0 {
			continue
		}
		if !reflect.DeepEqual(in.Invalidates, w) {
			t.Errorf("%s invalidates = %v, want %v", in.Name, in.Invalidates, w)
		}
	}
	if seen != len(want) {
		t.Errorf("found %d of %d commands", seen, len(want))
	}
}

func TestRegister_RequiresStoresAndContent(t *testing.T) {
	reg := dashcontract.NewRegistry()
	wreg := dashcontract.NewWardenRegistry()
	if err := Register(dispatcher.New(nil), reg, wreg, Deps{Content: testContent(t)}); err == nil {
		t.Error("Register accepted nil Stores")
	}
	if err := Register(dispatcher.New(nil), reg, wreg, Deps{Stores: newStores(openMem(t))}); err == nil {
		t.Error("Register accepted nil Content")
	}
}

func TestRegister_Succeeds(t *testing.T) {
	err := Register(dispatcher.New(nil), dashcontract.NewRegistry(), dashcontract.NewWardenRegistry(),
		testDeps(t, newStores(openMem(t))))
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
}
```

The manifest type name (`dashcontract.ContributorManifest`) and the intent kind constant (`dashcontract.IntentKindCommand`) are what Vault's `manifest_test.go` uses against v1.11.2. If `loader.Load` returns a different type name, use whatever it returns (check `$(go env GOMODCACHE)/github.com/xraph/forge@v1.11.2/extensions/dashboard/contract/loader/`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile (`undefined: NewSingleStore`, `mapError`, `encodeCursor`, `manifestYAML`, `Register`, ...).

- [ ] **Step 4: Write `stores.go`**

```go
package contract

import (
	"fmt"
	"strings"

	"github.com/xraph/trove"
)

// SingleStoreName is the name the only store answers to in single-store mode.
const SingleStoreName = "default"

// Flags records which protections a store's configuration asked for. It is
// what an operator configured, not what is applied: system.status compares
// the two.
type Flags struct {
	Encryption  bool
	Compression bool
	CAS         bool
}

// Store is one named Trove the dashboard can address.
type Store struct {
	Name       string
	Trove      *trove.Trove
	Configured Flags
}

// Stores resolves the optional `store` field every intent takes.
type Stores struct {
	multi  bool
	def    string
	list   []Store
	byName map[string]int
}

// NewSingleStore wraps the one Trove of a single-store deployment. It
// answers to "" and to SingleStoreName.
func NewSingleStore(t *trove.Trove, configured Flags) *Stores {
	return &Stores{
		def:    SingleStoreName,
		list:   []Store{{Name: SingleStoreName, Trove: t, Configured: configured}},
		byName: map[string]int{SingleStoreName: 0},
	}
}

// NewStores wraps the named Troves of a multi-store deployment, in the
// order given. An empty defaultName makes the first store the default.
func NewStores(defaultName string, list []Store) (*Stores, error) {
	if len(list) == 0 {
		return nil, fmt.Errorf("trove/contract: no stores")
	}
	s := &Stores{multi: true, list: make([]Store, 0, len(list)), byName: map[string]int{}}
	for _, st := range list {
		if strings.TrimSpace(st.Name) == "" {
			return nil, fmt.Errorf("trove/contract: a store has a blank name")
		}
		if st.Trove == nil {
			return nil, fmt.Errorf("trove/contract: store %q has no trove", st.Name)
		}
		if _, dup := s.byName[st.Name]; dup {
			return nil, fmt.Errorf("trove/contract: duplicate store %q", st.Name)
		}
		s.byName[st.Name] = len(s.list)
		s.list = append(s.list, st)
	}
	s.def = defaultName
	if s.def == "" {
		s.def = list[0].Name
	}
	if _, ok := s.byName[s.def]; !ok {
		return nil, fmt.Errorf("trove/contract: default store %q is not in the list", s.def)
	}
	return s, nil
}

// Multi reports whether this deployment runs more than one named store.
func (s *Stores) Multi() bool { return s.multi }

// DefaultName is the store an absent `store` field resolves to.
func (s *Stores) DefaultName() string { return s.def }

// All returns every store in declared order.
func (s *Stores) All() []Store {
	out := make([]Store, len(s.list))
	copy(out, s.list)
	return out
}

// Resolve maps a request's `store` field to a store. Empty means the
// default. A value that is blank once trimmed is a bad request: it was sent
// and cannot be used, and treating it as absent would answer with the
// default store's objects. An unknown name is not found, never the default.
func (s *Stores) Resolve(name string) (*Store, error) {
	if name == "" {
		name = s.def
	} else if strings.TrimSpace(name) == "" {
		return nil, badRequest("store is blank")
	}
	i, ok := s.byName[name]
	if !ok {
		return nil, notFound(fmt.Sprintf("no store named %q", name))
	}
	return &s.list[i], nil
}
```

- [ ] **Step 5: Write `errors.go`**

```go
package contract

import (
	"errors"
	"strings"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
	"github.com/xraph/trove/driver"
)

// mapError turns a Trove or driver error into a *contract.Error the client
// can branch on. Anything unrecognised becomes CodeInternal with a generic
// message: a driver error can carry a host, a bucket URL or a credential,
// so its text never reaches the client. Handlers call it through
// Deps.mapError, which logs the CodeInternal case.
func mapError(err error) error {
	if err == nil {
		return nil
	}
	var ce *contract.Error
	switch {
	case errors.As(err, &ce):
		return ce
	case errors.Is(err, driver.ErrBucketNotFound):
		return notFound("bucket not found")
	case errors.Is(err, driver.ErrObjectNotFound):
		return notFound("object not found")
	case errors.Is(err, cas.ErrNotFound):
		return notFound("this hash is not in the CAS index. The index is kept in memory and forgets every entry on restart.")
	case errors.Is(err, driver.ErrNotFound):
		return notFound("not found")
	case errors.Is(err, driver.ErrBucketExists):
		return conflict("a bucket with this name already exists")
	case errors.Is(err, trove.ErrContentBlocked):
		return badRequest("a content scan blocked this upload")
	case errors.Is(err, driver.ErrPermissionDenied):
		return &contract.Error{Code: contract.CodePermissionDenied, Message: "the storage backend refused this operation"}
	case errors.Is(err, driver.ErrQuotaExceeded):
		return &contract.Error{Code: contract.CodeUnavailable, Message: "the storage backend is rate limiting or out of quota", Retryable: true}
	case errors.Is(err, driver.ErrInvalidPath):
		return badRequest("the key is not a valid path for this driver")
	case errors.Is(err, trove.ErrKeyEmpty):
		return badRequest("key is required")
	case errors.Is(err, trove.ErrBucketEmpty):
		return badRequest("bucket is required")
	default:
		return &contract.Error{Code: contract.CodeInternal, Message: "an internal error occurred"}
	}
}

// mapError maps err and, for CodeInternal with a logger set, logs the real
// error with the intent that hit it. That is the one case an operator
// cannot diagnose from what the client sees.
func (d Deps) mapError(intent string, err error) error {
	mapped := mapError(err)
	if d.Logger == nil || mapped == nil {
		return mapped
	}
	var ce *contract.Error
	if errors.As(mapped, &ce) && ce.Code == contract.CodeInternal {
		d.Logger.Error("trove/contract: internal error answering intent",
			forge.F("intent", intent),
			forge.F("error", err),
		)
	}
	return mapped
}

func badRequest(msg string) error {
	return &contract.Error{Code: contract.CodeBadRequest, Message: msg}
}

func conflict(msg string) error {
	return &contract.Error{Code: contract.CodeConflict, Message: msg}
}

func notFound(msg string) error {
	return &contract.Error{Code: contract.CodeNotFound, Message: msg}
}

func unavailable(msg string) error {
	return &contract.Error{Code: contract.CodeUnavailable, Message: msg}
}

// requireName checks a bucket or store name is present. It does not trim
// what it returns: the caller uses the value as sent. Object keys do not go
// through here, because a key made of spaces is a valid key.
func requireName(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return badRequest(field + " is required")
	}
	return nil
}
```

The bucket case precedes the object case, and `cas.ErrNotFound` precedes the generic `driver.ErrNotFound`, because `cas.ErrNotFound` wraps it.

- [ ] **Step 6: Write `cursor.go`**

```go
package contract

import "encoding/base64"

// encodeCursor wraps a driver's NextToken for the wire. On mem, local and
// sftp the token is a raw key, and JSON would mangle a key that is not
// valid UTF-8; base64url survives. It also keeps anyone from hand-editing a
// key into a URL. An empty token means the listing is complete: null.
func encodeCursor(token string) *string {
	if token == "" {
		return nil
	}
	s := base64.RawURLEncoding.EncodeToString([]byte(token))
	return &s
}

// decodeCursor unwraps a cursor the client passed back. A cursor that does
// not decode was not one this package issued, and is refused here, before
// it reaches a backend that would answer with an untyped error.
func decodeCursor(cursor string) (string, error) {
	if cursor == "" {
		return "", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return "", badRequest("cursor is malformed. Pass back nextCursor exactly as you received it.")
	}
	return string(raw), nil
}
```

- [ ] **Step 7: Write `project.go`**

```go
package contract

import (
	"time"

	"github.com/xraph/trove/driver"
)

// formatTime renders t as UTC RFC3339, and a zero time as null.
func formatTime(t time.Time) *string {
	if t.IsZero() {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// optString is null for an empty string.
func optString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// objectRow is one object in a listing. storedSize is named for what it is:
// compress shrinks it and encrypt grows it, so it is not the size of what a
// download returns.
type objectRow struct {
	Key          string  `json:"key"`
	StoredSize   int64   `json:"storedSize"`
	ETag         *string `json:"etag"`
	LastModified *string `json:"lastModified"`
	ContentType  *string `json:"contentType"`
	StorageClass *string `json:"storageClass"`
}

func projectObjectRow(o driver.ObjectInfo) objectRow {
	return objectRow{
		Key:          o.Key,
		StoredSize:   o.Size,
		ETag:         optString(o.ETag),
		LastModified: formatTime(o.LastModified),
		ContentType:  optString(o.ContentType),
		StorageClass: optString(o.StorageClass),
	}
}

// objectDetail is what Head returns for one object.
type objectDetail struct {
	objectRow
	VersionID *string           `json:"versionId"`
	Metadata  map[string]string `json:"metadata"`
}

func projectObjectDetail(o *driver.ObjectInfo) objectDetail {
	var meta map[string]string
	if len(o.Metadata) > 0 {
		meta = make(map[string]string, len(o.Metadata))
		for k, v := range o.Metadata {
			meta[k] = v
		}
	}
	return objectDetail{
		objectRow: projectObjectRow(*o),
		VersionID: optString(o.VersionID),
		Metadata:  meta,
	}
}

// Facts about the six drivers, keyed by Driver.Name(). They come from
// reading each driver, recorded in the spec's findings.

// driverFolds reports whether a driver reports common prefixes when a
// listing sets a delimiter. All six do since trove slice 1.
func driverFolds(name string) bool {
	switch name {
	case "mem", "local", "sftp", "s3", "gcs", "azure":
		return true
	}
	return false
}

// etagIsContentHash reports whether a driver's ETag changes with content.
// mem's is the length in hex; local and sftp derive it from size and mtime.
func etagIsContentHash(name string) bool {
	switch name {
	case "s3", "gcs", "azure":
		return true
	}
	return false
}

// createdAtIsCreation reports whether ListBuckets returns a creation time.
// local and sftp return the directory's mtime, azure the container's
// last-modified time.
func createdAtIsCreation(name string) bool {
	switch name {
	case "mem", "s3", "gcs":
		return true
	}
	return false
}
```

- [ ] **Step 8: Write `content.go` (the service; the HTTP handler lands in Task 6)**

```go
package contract

import "net/url"

// Content is what the content intents and the content route share: the
// ticket signer, where the route is mounted, and the upload cap.
type Content struct {
	// Signer mints and checks tickets. Required.
	Signer *Signer

	// Path is where the content route is mounted, for example
	// "/dashboard/trove/content".
	Path string

	// MaxUploadBytes is the largest upload a ticket will allow. Every
	// Trove middleware buffers a whole object in memory, which is why this
	// is small by default.
	MaxUploadBytes int64

	// PerProcessSecret is true when Signer's key was generated at start
	// rather than configured, so a ticket verifies only in this process.
	PerProcessSecret bool
}

// URL is the content route with token attached.
func (c *Content) URL(token string) string {
	return c.Path + "?t=" + url.QueryEscape(token)
}
```

- [ ] **Step 9: Write `manifest.yaml`**

```yaml
schemaVersion: 1
contributor:
  name: trove
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [trove.read, trove.write]

# Every intent takes an optional `store`. Trove has no tenancy on the
# driver path, so no intent takes a tenant or an app id: this dashboard is
# operator-wide. Object content never travels in this envelope. The content
# intents mint signed tickets and the bytes go through the content route.
intents:
  - { name: system.status,      kind: query, version: 1, capability: read }
  - { name: stores.list,        kind: query, version: 1, capability: read }
  - { name: buckets.list,       kind: query, version: 1, capability: read }
  - { name: objects.list,       kind: query, version: 1, capability: read }
  - { name: objects.head,       kind: query, version: 1, capability: read }
  - { name: objects.contentUrl, kind: query, version: 1, capability: read }
  - { name: middleware.list,    kind: query, version: 1, capability: read }
  - { name: cas.status,         kind: query, version: 1, capability: read }
  - { name: cas.list,           kind: query, version: 1, capability: read }
  - { name: streams.list,       kind: query, version: 1, capability: read }
  - { name: buckets.create,         kind: command, version: 1, capability: write, invalidates: [buckets.list] }
  - { name: buckets.delete,         kind: command, version: 1, capability: write, invalidates: [buckets.list, objects.list] }
  - { name: objects.delete,         kind: command, version: 1, capability: write, invalidates: [objects.list, objects.head, cas.list] }
  - { name: objects.copy,           kind: command, version: 1, capability: write, invalidates: [objects.list, objects.head] }
  # beginUpload writes nothing: it mints an upload ticket. The listing
  # refreshes when completeUpload runs after the bytes have landed.
  - { name: objects.beginUpload,    kind: command, version: 1, capability: write }
  - { name: objects.completeUpload, kind: command, version: 1, capability: write, invalidates: [objects.list, objects.head] }
  # presign writes nothing: it mints a share link.
  - { name: objects.presign,        kind: command, version: 1, capability: write }
  - { name: cas.pin,                kind: command, version: 1, capability: write, invalidates: [cas.list] }
  - { name: cas.unpin,              kind: command, version: 1, capability: write, invalidates: [cas.list] }
  - { name: cas.gc,                 kind: command, version: 1, capability: write, invalidates: [cas.list, cas.status] }
```

If `loader.Validate` rejects a command with no `invalidates`, that is a finding: record the exact error in your report, and give `objects.beginUpload` and `objects.presign` `invalidates: [objects.head]` (harmless: head does not change), then update `TestManifest_CommandInvalidates` to match. Do not guess at this before running it.

- [ ] **Step 10: Write `contract.go`**

```go
// Package contract wires Trove into the Forge dashboard's contract path. It
// registers the `trove` contributor and answers its intents from the live
// Trove stores and their drivers, never from the extension's metadata
// store, which normal operation does not write.
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
)

//go:embed manifest.yaml
var manifestYAML []byte

// ContributorName is the join key with packages/plugin-trove's `extension`
// field and matches the extension's name. A mismatch hides the React
// plugin with no error anywhere.
const ContributorName = "trove"

// Deps bundles what the handlers need.
type Deps struct {
	// Stores resolves each intent's `store` field. Required.
	Stores *Stores

	// Content mints the tickets the content intents return. Required.
	Content *Content

	// Logger receives an Error entry for every error mapped to
	// CodeInternal. Optional.
	Logger forge.Logger
}

// binding registers one intent with the dispatcher.
type binding struct {
	intent string
	bind   func(d *dispatcher.Dispatcher) error
}

func query[I, O any](intent string, fn func(context.Context, I, contract.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterQuery(d, ContributorName, intent, 1, fn)
	}}
}

func command[I, O any](intent string, fn func(context.Context, I, contract.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterCommand(d, ContributorName, intent, 1, fn)
	}}
}

// bindings lists every intent this package answers.
func bindings(deps Deps) []binding {
	return []binding{}
}

// Register loads and validates the embedded manifest, registers the
// `trove` contributor with reg, and binds every handler. A handler bound to
// an intent the manifest does not declare is a build mistake and fails
// here rather than at the first request.
func Register(
	d *dispatcher.Dispatcher,
	reg contract.Registry,
	wreg contract.WardenRegistry,
	deps Deps,
) error {
	if deps.Stores == nil {
		return fmt.Errorf("trove/contract: Stores is required")
	}
	if deps.Content == nil || deps.Content.Signer == nil {
		return fmt.Errorf("trove/contract: Content with a Signer is required")
	}

	m, err := loader.Load(bytes.NewReader(manifestYAML), "trove/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("trove/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("trove/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("trove/contract: register manifest: %w", err)
	}

	declared := make(map[string]bool, len(m.Intents))
	for _, in := range m.Intents {
		declared[in.Name] = true
	}
	for _, b := range bindings(deps) {
		if !declared[b.intent] {
			return fmt.Errorf("trove/contract: %s is bound but the manifest does not declare it", b.intent)
		}
		if err := b.bind(d); err != nil {
			return fmt.Errorf("trove/contract: register %s: %w", b.intent, err)
		}
	}
	return nil
}
```

`bindings` takes `deps` so later tasks can close handlers over it. Lint may flag the unused parameter in this task only; that is expected and goes away in Task 3.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS.

- [ ] **Step 12: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/contract/stores.go extension/contract/errors.go extension/contract/cursor.go extension/contract/project.go extension/contract/content.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/helpers_test.go extension/contract/stores_test.go extension/contract/errors_test.go extension/contract/cursor_test.go extension/contract/manifest_test.go"
git add $F
git commit --only -m "feat(extension): lay the trove contract's foundation" -- $F
git show --stat HEAD
```

Body: the manifest declares the 20 intents, stores resolve with a blank name refused and an unknown one never falling back, driver errors map to contract codes without leaking their text, and cursors are wrapped for the wire.

---

### Task 3: system.status, stores.list and middleware.list

**Files:**
- Create: `extension/contract/middleware.go`, `extension/contract/handlers_system.go`, `extension/contract/handlers_middleware.go`
- Modify: `extension/contract/contract.go` (`bindings`)
- Test: `extension/contract/handlers_system_test.go`, `extension/contract/handlers_middleware_test.go`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces:
  - `type middlewareRow struct { Name, Direction, Scope string; Priority int }` (JSON `name`, `direction`, `scope`, `priority`)
  - `func matching(ctx context.Context, t *trove.Trove, bucket, key string, dir middleware.Direction) []middlewareRow` (the registrations that run for that direction, in run order)
  - `func matchingAny(ctx context.Context, t *trove.Trove, bucket, key string) []middlewareRow` (either direction, each registration once, in run order)
  - `type storeInput struct { Store string `json:"store"` }`

- [ ] **Step 1: Write the failing tests**

Create `extension/contract/handlers_system_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"testing"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
	"github.com/xraph/trove/middleware/compress"
	"github.com/xraph/trove/middleware/encrypt"
)

func flagByName(t *testing.T, s systemStatus, name string) flagStatus {
	t.Helper()
	for _, f := range s.Flags {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("no flag %q in %+v", name, s.Flags)
	return flagStatus{}
}

func TestSystemStatus_EncryptionConfiguredButNotApplied(t *testing.T) {
	tv := openMem(t)
	deps := testDeps(t, NewSingleStore(tv, Flags{Encryption: true}))
	s, err := systemStatusHandler(deps)(context.Background(), storeInput{}, principalFor("u"))
	if err != nil {
		t.Fatalf("system.status: %v", err)
	}
	f := flagByName(t, s, "encryption")
	if !f.Configured || f.Applied {
		t.Fatalf("encryption = %+v, want configured and not applied", f)
	}
	if f.Note == nil || !bytes.Contains([]byte(*f.Note), []byte("Nothing is encrypted")) {
		t.Fatalf("encryption note = %v, want it to say nothing is encrypted", f.Note)
	}
}

func TestSystemStatus_AppliedComesFromTheResolver(t *testing.T) {
	key := bytes.Repeat([]byte("k"), 32)
	tv := openMem(t,
		trove.WithMiddleware(compress.New()),
		trove.WithMiddleware(encrypt.New(encrypt.WithKeyProvider(encrypt.NewStaticKeyProvider(key)))),
		trove.WithCAS(cas.AlgSHA256),
	)
	deps := testDeps(t, NewSingleStore(tv, Flags{Compression: true, CAS: true}))
	s, err := systemStatusHandler(deps)(context.Background(), storeInput{}, principalFor("u"))
	if err != nil {
		t.Fatalf("system.status: %v", err)
	}
	if f := flagByName(t, s, "compression"); !f.Configured || !f.Applied {
		t.Errorf("compression = %+v", f)
	}
	if f := flagByName(t, s, "encryption"); f.Configured || !f.Applied {
		t.Errorf("encryption registered in code = %+v, want applied and not configured", f)
	}
	if f := flagByName(t, s, "cas"); !f.Configured || !f.Applied {
		t.Errorf("cas = %+v", f)
	}
	if f := flagByName(t, s, "scanning"); f.Applied {
		t.Errorf("scanning = %+v, want not applied", f)
	}
}

func TestSystemStatus_DriverFacts(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t)
		content := testContent(t)
		content.PerProcessSecret = true
		deps := Deps{Stores: newStores(tv), Content: content}
		s, err := systemStatusHandler(deps)(context.Background(), storeInput{}, principalFor("u"))
		if err != nil {
			t.Fatalf("system.status: %v", err)
		}
		if s.Driver != tv.Driver().Name() || s.Store != SingleStoreName {
			t.Errorf("driver=%q store=%q", s.Driver, s.Store)
		}
		if !s.Health.OK || s.Health.Error != nil {
			t.Errorf("health = %+v", s.Health)
		}
		if s.Capabilities.Presign || s.Capabilities.Multipart || !s.Capabilities.Folders {
			t.Errorf("capabilities = %+v", s.Capabilities)
		}
		if s.EtagIsContentHash {
			t.Error("mem and local ETags are not content hashes")
		}
		if s.ContentSecret != "per-process" {
			t.Errorf("contentSecret = %q", s.ContentSecret)
		}
		if s.Config.MaxUploadBytes != content.MaxUploadBytes || s.Config.PoolSize != tv.Config().PoolSize {
			t.Errorf("config = %+v", s.Config)
		}
	})
}

func TestSystemStatus_UnknownStore(t *testing.T) {
	deps := testDeps(t, newStores(openMem(t)))
	if _, err := systemStatusHandler(deps)(context.Background(), storeInput{Store: "nope"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Fatalf("system.status on an unknown store = %v", err)
	}
}

func TestStoresList_SingleAndMulti(t *testing.T) {
	single := testDeps(t, newStores(openMem(t)))
	out, err := storesListHandler(single)(context.Background(), struct{}{}, principalFor("u"))
	if err != nil || out.Mode != "single" || len(out.Stores) != 1 || !out.Stores[0].IsDefault || out.Stores[0].Driver != "mem" {
		t.Fatalf("single = %+v, %v", out, err)
	}

	multi, err := NewStores("b", []Store{{Name: "a", Trove: openMem(t)}, {Name: "b", Trove: openLocal(t)}})
	if err != nil {
		t.Fatalf("NewStores: %v", err)
	}
	out, err = storesListHandler(testDeps(t, multi))(context.Background(), struct{}{}, principalFor("u"))
	if err != nil || out.Mode != "multi" || len(out.Stores) != 2 {
		t.Fatalf("multi = %+v, %v", out, err)
	}
	if out.Stores[0].IsDefault || !out.Stores[1].IsDefault || out.Stores[1].Driver != "local" {
		t.Fatalf("multi stores = %+v", out.Stores)
	}
}
```

Create `extension/contract/handlers_middleware_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"testing"

	"github.com/xraph/trove"
	"github.com/xraph/trove/middleware"
	"github.com/xraph/trove/middleware/compress"
	"github.com/xraph/trove/middleware/encrypt"
)

func hasWarning(out middlewareListOutput, code string) bool {
	for _, w := range out.Warnings {
		if w.Code == code {
			return true
		}
	}
	return false
}

func TestMiddlewareList_NoneRegistered(t *testing.T) {
	deps := testDeps(t, newStores(openMem(t)))
	out, err := middlewareListHandler(deps)(context.Background(), middlewareListInput{}, principalFor("u"))
	if err != nil {
		t.Fatalf("middleware.list: %v", err)
	}
	if out.Registrations == nil || len(out.Registrations) != 0 || len(out.Warnings) != 0 {
		t.Fatalf("out = %+v, want empty registrations as [] and no warnings", out)
	}
}

func TestMiddlewareList_MatchesAKeyAndWarns(t *testing.T) {
	key := bytes.Repeat([]byte("k"), 32)
	tv := openMem(t,
		trove.WithScopedMiddleware(middleware.ForBuckets("reports"), compress.New()),
		trove.WithMiddleware(encrypt.New(encrypt.WithKeyProvider(encrypt.NewStaticKeyProvider(key)))),
	)
	deps := testDeps(t, newStores(tv))
	out, err := middlewareListHandler(deps)(context.Background(),
		middlewareListInput{Bucket: "logs", Key: "a.txt"}, principalFor("u"))
	if err != nil {
		t.Fatalf("middleware.list: %v", err)
	}
	if len(out.Registrations) != 2 {
		t.Fatalf("registrations = %+v", out.Registrations)
	}
	for _, r := range out.Registrations {
		if r.MatchesWrite == nil || r.MatchesRead == nil {
			t.Fatalf("%s: matches not computed for a bucket and key", r.Name)
		}
		wantMatch := r.Name == "encrypt"
		if *r.MatchesWrite != wantMatch || *r.MatchesRead != wantMatch {
			t.Errorf("%s matches logs/a.txt: write=%v read=%v, want %v", r.Name, *r.MatchesWrite, *r.MatchesRead, wantMatch)
		}
	}
	for _, code := range []string{"read-order", "bypass"} {
		if !hasWarning(out, code) {
			t.Errorf("missing warning %q in %+v", code, out.Warnings)
		}
	}
}

func TestMiddlewareList_WithoutKeyLeavesMatchesNull(t *testing.T) {
	tv := openMem(t, trove.WithMiddleware(compress.New()))
	out, err := middlewareListHandler(testDeps(t, newStores(tv)))(context.Background(),
		middlewareListInput{Bucket: "logs"}, principalFor("u"))
	if err != nil {
		t.Fatalf("middleware.list: %v", err)
	}
	if out.Registrations[0].MatchesWrite != nil || out.Registrations[0].MatchesRead != nil {
		t.Fatalf("matches computed without a key: %+v", out.Registrations[0])
	}
}

func TestMatching_RunOrderAndDirection(t *testing.T) {
	tv := openMem(t,
		trove.WithMiddlewareAt(10, compress.New()),
		trove.WithWriteMiddleware(compress.New()),
	)
	ctx := context.Background()
	write := matching(ctx, tv, "b", "k", middleware.DirectionWrite)
	read := matching(ctx, tv, "b", "k", middleware.DirectionRead)
	if len(write) != 2 || write[0].Priority != 0 || write[1].Priority != 10 {
		t.Fatalf("write pipeline = %+v, want priority 0 then 10", write)
	}
	if len(read) != 1 || read[0].Priority != 10 {
		t.Fatalf("read pipeline = %+v, want only the read-write one", read)
	}
	if got := matchingAny(ctx, tv, "b", "k"); len(got) != 2 {
		t.Fatalf("matchingAny = %+v, want each registration once", got)
	}
}
```

If `middleware.ForBuckets` has a different signature (it is in `middleware/helpers.go`), use what it takes; it returns a `Scope` for exact bucket names.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile (`undefined: systemStatusHandler`, `matching`, ...).

- [ ] **Step 3: Write `middleware.go`**

```go
package contract

import (
	"context"
	"sort"

	"github.com/xraph/trove"
	"github.com/xraph/trove/middleware"
)

// middlewareRow is one middleware registration as the dashboard sees it.
// Trove keeps each middleware's own settings unexported, so this is all
// there is to show.
type middlewareRow struct {
	Name      string `json:"name"`
	Direction string `json:"direction"`
	Scope     string `json:"scope"`
	Priority  int    `json:"priority"`
}

func effectiveDirection(r middleware.Registration) middleware.Direction {
	if r.Direction != 0 {
		return r.Direction
	}
	return r.Middleware.Direction()
}

func scopeOf(r middleware.Registration) middleware.Scope {
	if r.Scope == nil {
		return middleware.ScopeGlobal{}
	}
	return r.Scope
}

func rowOf(r middleware.Registration) middlewareRow {
	return middlewareRow{
		Name:      r.Middleware.Name(),
		Direction: effectiveDirection(r).String(),
		Scope:     scopeOf(r).String(),
		Priority:  r.Priority,
	}
}

// ordered returns the registrations in the order Trove runs them: by
// priority, then in registration order.
func ordered(t *trove.Trove) []middleware.Registration {
	regs := t.Resolver().Registrations()
	sort.SliceStable(regs, func(i, j int) bool { return regs[i].Priority < regs[j].Priority })
	return regs
}

// matching returns the registrations that run for bucket and key in
// direction dir, in run order. It evaluates scopes now, so it describes
// the current configuration, never how an existing object was written:
// Trove records nothing per object.
func matching(ctx context.Context, t *trove.Trove, bucket, key string, dir middleware.Direction) []middlewareRow {
	rows := []middlewareRow{}
	for _, r := range ordered(t) {
		if effectiveDirection(r)&dir == 0 {
			continue
		}
		if scopeOf(r).Match(ctx, bucket, key) {
			rows = append(rows, rowOf(r))
		}
	}
	return rows
}

// matchingAny returns every registration that runs for bucket and key in
// either direction, once each, in run order.
func matchingAny(ctx context.Context, t *trove.Trove, bucket, key string) []middlewareRow {
	return matching(ctx, t, bucket, key, middleware.DirectionReadWrite)
}
```

- [ ] **Step 4: Write `handlers_system.go`**

```go
package contract

import (
	"context"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/driver"
)

// storeInput is the input of every intent that takes only a store.
type storeInput struct {
	Store string `json:"store"`
}

type health struct {
	OK    bool    `json:"ok"`
	Error *string `json:"error"`
}

type capabilities struct {
	Multipart    bool `json:"multipart"`
	Presign      bool `json:"presign"`
	Range        bool `json:"range"`
	ServerCopy   bool `json:"serverCopy"`
	Versioning   bool `json:"versioning"`
	Notification bool `json:"notification"`
	Lifecycle    bool `json:"lifecycle"`
	Folders      bool `json:"folders"`
}

type statusConfig struct {
	DefaultBucket  string `json:"defaultBucket"`
	ChunkSize      int64  `json:"chunkSize"`
	PoolSize       int    `json:"poolSize"`
	MaxUploadBytes int64  `json:"maxUploadBytes"`
}

// flagStatus compares what an operator configured with what the resolver
// actually has registered. A config flag describes the system now; it says
// nothing about objects written before it changed.
type flagStatus struct {
	Name       string  `json:"name"`
	Configured bool    `json:"configured"`
	Applied    bool    `json:"applied"`
	Note       *string `json:"note"`
}

type systemStatus struct {
	Store             string       `json:"store"`
	Driver            string       `json:"driver"`
	Health            health       `json:"health"`
	Capabilities      capabilities `json:"capabilities"`
	Config            statusConfig `json:"config"`
	Flags             []flagStatus `json:"flags"`
	EtagIsContentHash bool         `json:"etagIsContentHash"`
	ContentSecret     string       `json:"contentSecret"`
}

func systemStatusHandler(deps Deps) func(context.Context, storeInput, contract.Principal) (systemStatus, error) {
	return func(ctx context.Context, in storeInput, _ contract.Principal) (systemStatus, error) {
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return systemStatus{}, err
		}
		t := st.Trove
		drv := t.Driver()
		name := drv.Name()

		h := health{OK: true}
		if err := t.Health(ctx); err != nil {
			h = health{OK: false, Error: optString("The driver did not answer a ping.")}
			if deps.Logger != nil {
				deps.Logger.Warn("trove/contract: store failed its health check",
					forge.F("store", st.Name), forge.F("error", err))
			}
		}

		_, multipart := drv.(driver.MultipartDriver)
		_, presign := drv.(driver.PresignDriver)
		_, rng := drv.(driver.RangeDriver)
		_, serverCopy := drv.(driver.ServerCopyDriver)
		_, versioning := drv.(driver.VersioningDriver)
		_, notification := drv.(driver.NotificationDriver)
		_, lifecycle := drv.(driver.LifecycleDriver)

		cfg := t.Config()
		secret := "configured"
		if deps.Content.PerProcessSecret {
			secret = "per-process"
		}

		return systemStatus{
			Store:  st.Name,
			Driver: name,
			Health: h,
			Capabilities: capabilities{
				Multipart: multipart, Presign: presign, Range: rng, ServerCopy: serverCopy,
				Versioning: versioning, Notification: notification, Lifecycle: lifecycle,
				Folders: driverFolds(name),
			},
			Config: statusConfig{
				DefaultBucket:  cfg.DefaultBucket,
				ChunkSize:      cfg.ChunkSize,
				PoolSize:       cfg.PoolSize,
				MaxUploadBytes: deps.Content.MaxUploadBytes,
			},
			Flags:             protectionFlags(t, st.Configured),
			EtagIsContentHash: etagIsContentHash(name),
			ContentSecret:     secret,
		}, nil
	}
}

// protectionFlags reports each protection configured against applied.
func protectionFlags(t *trove.Trove, configured Flags) []flagStatus {
	registered := map[string]bool{}
	for _, r := range t.Resolver().Registrations() {
		registered[r.Middleware.Name()] = true
	}

	encryption := flagStatus{Name: "encryption", Configured: configured.Encryption, Applied: registered["encrypt"]}
	switch {
	case encryption.Configured && !encryption.Applied:
		encryption.Note = optString("enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted.")
	case !encryption.Configured && encryption.Applied:
		encryption.Note = optString("Registered in code rather than by a config switch.")
	}

	compression := flagStatus{Name: "compression", Configured: configured.Compression, Applied: registered["compress"]}
	switch {
	case compression.Configured && !compression.Applied:
		compression.Note = optString("enable_compression is set, but no compress middleware is registered.")
	case !compression.Configured && compression.Applied:
		compression.Note = optString("Registered in code rather than by a config switch.")
	}

	// Scanning has no config switch: it is on only when code registers it.
	scanning := flagStatus{Name: "scanning", Configured: registered["scan"], Applied: registered["scan"]}
	if scanning.Applied {
		scanning.Note = optString("Registered in code. A scan with no provider, an excluded extension or an object over its size limit passes through unscanned, and nothing records which objects were scanned.")
	} else {
		scanning.Note = optString("No scan middleware is registered, so uploads are not scanned.")
	}

	casFlag := flagStatus{Name: "cas", Configured: configured.CAS, Applied: t.CAS() != nil}
	if casFlag.Configured && !casFlag.Applied {
		casFlag.Note = optString("enable_cas is set, but this store has no CAS engine.")
	}

	return []flagStatus{encryption, compression, scanning, casFlag}
}

type storeRow struct {
	Name      string `json:"name"`
	Driver    string `json:"driver"`
	IsDefault bool   `json:"isDefault"`
}

type storesListOutput struct {
	Mode   string     `json:"mode"`
	Stores []storeRow `json:"stores"`
}

func storesListHandler(deps Deps) func(context.Context, struct{}, contract.Principal) (storesListOutput, error) {
	return func(_ context.Context, _ struct{}, _ contract.Principal) (storesListOutput, error) {
		out := storesListOutput{Mode: "single", Stores: []storeRow{}}
		if deps.Stores.Multi() {
			out.Mode = "multi"
		}
		for _, st := range deps.Stores.All() {
			out.Stores = append(out.Stores, storeRow{
				Name:      st.Name,
				Driver:    st.Trove.Driver().Name(),
				IsDefault: st.Name == deps.Stores.DefaultName(),
			})
		}
		return out, nil
	}
}
```

If `forge.Logger` has no `Warn` method in v1.11.2, use `Error` (Vault uses `Error` and `Warn` both; check the interface).

- [ ] **Step 5: Write `handlers_middleware.go`**

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"
)

type middlewareListInput struct {
	Store  string `json:"store"`
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
}

type middlewareRegistration struct {
	middlewareRow
	MatchesWrite *bool `json:"matchesWrite"`
	MatchesRead  *bool `json:"matchesRead"`
}

type middlewareWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type middlewareListOutput struct {
	Registrations []middlewareRegistration `json:"registrations"`
	Warnings      []middlewareWarning      `json:"warnings"`
}

func middlewareListHandler(deps Deps) func(context.Context, middlewareListInput, contract.Principal) (middlewareListOutput, error) {
	return func(ctx context.Context, in middlewareListInput, _ contract.Principal) (middlewareListOutput, error) {
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return middlewareListOutput{}, err
		}
		test := in.Bucket != "" && in.Key != ""

		out := middlewareListOutput{Registrations: []middlewareRegistration{}, Warnings: []middlewareWarning{}}
		names := map[string]bool{}
		contentTypeScope, customScope := false, false
		for _, r := range ordered(st.Trove) {
			row := middlewareRegistration{middlewareRow: rowOf(r)}
			names[row.Name] = true
			if strings.HasPrefix(row.Scope, "content-type(") || strings.Contains(row.Scope, "content-type(") {
				contentTypeScope = true
			}
			if row.Scope == "func" || strings.Contains(row.Scope, "custom") {
				customScope = true
			}
			if test {
				dir := effectiveDirection(r)
				match := scopeOf(r).Match(ctx, in.Bucket, in.Key)
				w := match && dir&middlewareWrite != 0
				rd := match && dir&middlewareRead != 0
				row.MatchesWrite, row.MatchesRead = &w, &rd
			}
			out.Registrations = append(out.Registrations, row)
		}

		if names["compress"] && names["encrypt"] {
			out.Warnings = append(out.Warnings, middlewareWarning{
				Code:    "read-order",
				Message: "Reads run middleware in the same order as writes instead of reversed. With compress and encrypt both registered, a download can return compressed bytes without an error.",
			})
		}
		if contentTypeScope {
			out.Warnings = append(out.Warnings, middlewareWarning{
				Code:    "content-type-scope",
				Message: "A content-type scope matches the key's file extension, not the object's content type, and only for type/* entries.",
			})
		}
		if customScope {
			out.Warnings = append(out.Warnings, middlewareWarning{
				Code:    "cached-custom-scope",
				Message: "A custom scope is evaluated once per bucket and key and then cached, so it cannot depend on who is asking.",
			})
		}
		if len(out.Registrations) > 0 {
			out.Warnings = append(out.Warnings, middlewareWarning{
				Code:    "bypass",
				Message: "CAS, copy and streams move stored bytes without running any middleware.",
			})
		}
		return out, nil
	}
}
```

Add to `middleware.go` two aliases used above, so the handler reads cleanly:

```go
const (
	middlewareRead  = middleware.DirectionRead
	middlewareWrite = middleware.DirectionWrite
)
```

Before writing the custom-scope check, read `middleware/helpers.go` and `middleware/scope.go` for what a `ScopeFunc` or `When`/`WhenDesc` scope's `String()` returns (the slice 0 finding says `"custom"` or its description; `ScopeFunc.String()` returns `"func"` when it has no description). Match whatever the code actually returns and say so in your report.

- [ ] **Step 6: Bind the three intents**

In `contract.go`, replace the body of `bindings`:

```go
func bindings(deps Deps) []binding {
	return []binding{
		query("system.status", systemStatusHandler(deps)),
		query("stores.list", storesListHandler(deps)),
		query("middleware.list", middlewareListHandler(deps)),
	}
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS, including `TestRegister_Succeeds` (the three bound intents are declared).

- [ ] **Step 8: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/contract/middleware.go extension/contract/handlers_system.go extension/contract/handlers_middleware.go extension/contract/handlers_system_test.go extension/contract/handlers_middleware_test.go"
git add $F
git commit --only -m "feat(extension): answer system.status, stores.list and middleware.list" -- $F extension/contract/contract.go
git show --stat HEAD
```

Body: system.status compares each protection configured against what the resolver has registered, so a deployment with enable_encryption set says plainly that nothing is encrypted. middleware.list shows what runs for a key now and warns about the read-order and bypass behaviour.

---

### Task 4: Buckets, objects.list and objects.head

**Files:**
- Create: `extension/contract/handlers_buckets.go`, `extension/contract/handlers_objects.go`
- Modify: `extension/contract/contract.go` (`bindings`)
- Test: `extension/contract/handlers_buckets_test.go`, `extension/contract/handlers_objects_test.go`

**Interfaces:**
- Consumes: Task 2 and Task 3 names, notably `matchingAny`.
- Produces:
  - `func casBucket(t *trove.Trove) (string, bool)`: the CAS bucket name when CAS is enabled
  - `type presignStatus struct { Available bool; Reason *string }` (JSON `available`, `reason`), `func presignAvailability(t *trove.Trove, rows []middlewareRow) presignStatus`
  - `type objectKeyInput struct { Store, Bucket, Key string }` (JSON `store`, `bucket`, `key`)

- [ ] **Step 1: Write the failing tests**

Create `extension/contract/handlers_buckets_test.go`:

```go
package contract

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/xraph/trove/drivers/localdriver"
)

func TestBucketsCreateListDelete(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		deps := testDeps(t, newStores(open(t)))
		ctx := context.Background()
		p := principalFor("u")

		if _, err := bucketsCreateHandler(deps)(ctx, bucketInput{Name: "reports"}, p); err != nil {
			t.Fatalf("create: %v", err)
		}
		if _, err := bucketsCreateHandler(deps)(ctx, bucketInput{Name: "reports"}, p); codeOf(err) != "CONFLICT" {
			t.Fatalf("second create = %v, want CONFLICT", err)
		}
		list, err := bucketsListHandler(deps)(ctx, storeInput{}, p)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		found := false
		for _, b := range list.Buckets {
			if b.Name == "reports" {
				found = true
			}
		}
		if !found {
			t.Fatalf("list = %+v, missing reports", list.Buckets)
		}
		if _, err := bucketsDeleteHandler(deps)(ctx, bucketInput{Name: "reports"}, p); err != nil {
			t.Fatalf("delete empty bucket: %v", err)
		}
	})
}

func TestBucketsCreate_BlankNameIsBadRequest(t *testing.T) {
	deps := testDeps(t, newStores(openMem(t)))
	if _, err := bucketsCreateHandler(deps)(context.Background(), bucketInput{Name: "  "}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Fatalf("create blank = %v", err)
	}
}

func TestBucketsList_CreatedAtMeaning(t *testing.T) {
	mem, err := bucketsListHandler(testDeps(t, newStores(openMem(t))))(context.Background(), storeInput{}, principalFor("u"))
	if err != nil || mem.CreatedAtMeaning != "created" || mem.Buckets == nil {
		t.Fatalf("mem = %+v, %v", mem, err)
	}
	local, err := bucketsListHandler(testDeps(t, newStores(openLocal(t))))(context.Background(), storeInput{}, principalFor("u"))
	if err != nil || local.CreatedAtMeaning != "modified" {
		t.Fatalf("local = %+v, %v", local, err)
	}
}

func TestBucketsDelete_RefusesNonEmptyAndKeepsFiles(t *testing.T) {
	root := t.TempDir()
	drv := localdriver.New()
	if err := drv.Open(context.Background(), "file://"+root); err != nil {
		t.Fatalf("open: %v", err)
	}
	tv := openTrove(t, drv)
	mustBucket(t, tv, "reports")
	put(t, tv, "reports", "2026/q3.csv", "a,b")
	deps := testDeps(t, newStores(tv))

	_, err := bucketsDeleteHandler(deps)(context.Background(), bucketInput{Name: "reports"}, principalFor("u"))
	if codeOf(err) != "CONFLICT" {
		t.Fatalf("delete non-empty = %v, want CONFLICT", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "reports", "2026", "q3.csv")); statErr != nil {
		t.Fatalf("the file is gone after a refused delete: %v", statErr)
	}
}

func TestBucketsDelete_MissingIsNotFound(t *testing.T) {
	deps := testDeps(t, newStores(openMem(t)))
	if _, err := bucketsDeleteHandler(deps)(context.Background(), bucketInput{Name: "nope"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Fatalf("delete missing = %v", err)
	}
}
```

Create `extension/contract/handlers_objects_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/trove"
	"github.com/xraph/trove/driver"
	"github.com/xraph/trove/middleware/compress"
)

func seedListing(t *testing.T, tv *trove.Trove) {
	t.Helper()
	mustBucket(t, tv, "data")
	for _, k := range []string{"a/1.txt", "a/2.txt", "b/c/d.txt", "top.txt", "zed.txt"} {
		put(t, tv, "data", k, "x")
	}
}

func strPtr(s string) *string { return &s }

func TestObjectsList_FoldsAndPages(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t)
		seedListing(t, tv)
		deps := testDeps(t, newStores(tv))
		ctx := context.Background()

		var items []string
		cursor := ""
		pages := 0
		for {
			out, err := objectsListHandler(deps)(ctx, objectsListInput{Bucket: "data", Cursor: cursor, Limit: 2}, principalFor("u"))
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			if !out.FoldersSupported {
				t.Fatal("foldersSupported is false on a folding driver")
			}
			items = append(items, out.Prefixes...)
			for _, o := range out.Objects {
				items = append(items, o.Key)
			}
			pages++
			if out.NextCursor == nil {
				break
			}
			cursor = *out.NextCursor
			if pages > 10 {
				t.Fatal("listing never finished")
			}
		}
		got := strings.Join(items, ",")
		for _, want := range []string{"a/", "b/", "top.txt", "zed.txt"} {
			if !strings.Contains(got, want) {
				t.Errorf("items %q missing %q", got, want)
			}
		}
		if strings.Contains(got, "a/1.txt") {
			t.Errorf("items %q contains a key that should have folded", got)
		}
		if pages != 2 {
			t.Errorf("pages = %d, want 2 for 4 items at limit 2", pages)
		}
	})
}

func TestObjectsList_FlatListingHasNullPrefixes(t *testing.T) {
	tv := openMem(t)
	seedListing(t, tv)
	out, err := objectsListHandler(testDeps(t, newStores(tv)))(context.Background(),
		objectsListInput{Bucket: "data", Delimiter: strPtr("")}, principalFor("u"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if out.Prefixes != nil || len(out.Objects) != 5 || out.FoldersSupported {
		t.Fatalf("flat = %+v", out)
	}
	b, _ := json.Marshal(out)
	if !strings.Contains(string(b), `"prefixes":null`) {
		t.Fatalf("flat listing JSON = %s, want prefixes null", b)
	}
}

func TestObjectsList_EmptyIsArrayNotNull(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "empty")
	out, err := objectsListHandler(testDeps(t, newStores(tv)))(context.Background(), objectsListInput{Bucket: "empty"}, principalFor("u"))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	b, _ := json.Marshal(out)
	if !strings.Contains(string(b), `"objects":[]`) || !strings.Contains(string(b), `"nextCursor":null`) {
		t.Fatalf("empty listing JSON = %s", b)
	}
}

func TestObjectsList_BadInput(t *testing.T) {
	tv := openMem(t)
	seedListing(t, tv)
	deps := testDeps(t, newStores(tv))
	ctx := context.Background()
	if _, err := objectsListHandler(deps)(ctx, objectsListInput{}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("no bucket = %v", err)
	}
	if _, err := objectsListHandler(deps)(ctx, objectsListInput{Bucket: "data", Cursor: "!!!"}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("bad cursor = %v", err)
	}
	if _, err := objectsListHandler(deps)(ctx, objectsListInput{Bucket: "nope"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Errorf("missing bucket = %v", err)
	}
}

func TestObjectsList_LimitClamps(t *testing.T) {
	tv := openMem(t)
	seedListing(t, tv)
	deps := testDeps(t, newStores(tv))
	out, err := objectsListHandler(deps)(context.Background(), objectsListInput{Bucket: "data", Limit: 5000, Delimiter: strPtr("")}, principalFor("u"))
	if err != nil || len(out.Objects) != 5 {
		t.Fatalf("limit 5000 = %+v, %v", out, err)
	}
	out, err = objectsListHandler(deps)(context.Background(), objectsListInput{Bucket: "data", Limit: -3, Delimiter: strPtr("")}, principalFor("u"))
	if err != nil || len(out.Objects) != 5 {
		t.Fatalf("limit -3 = %+v, %v; want the default of 100", out, err)
	}
}

// TestObjectsList_StoresAreIsolated writes to store a and lists store b,
// asserting on identity: a count check would pass if the wrong store's rows
// came back in the right number.
func TestObjectsList_StoresAreIsolated(t *testing.T) {
	a, b := openMem(t), openMem(t)
	mustBucket(t, a, "data")
	mustBucket(t, b, "data")
	put(t, a, "data", "only-in-a.txt", "x")
	put(t, b, "data", "only-in-b.txt", "y")
	stores, err := NewStores("a", []Store{{Name: "a", Trove: a}, {Name: "b", Trove: b}})
	if err != nil {
		t.Fatalf("NewStores: %v", err)
	}
	deps := testDeps(t, stores)
	for store, want := range map[string]string{"a": "only-in-a.txt", "b": "only-in-b.txt", "": "only-in-a.txt"} {
		out, err := objectsListHandler(deps)(context.Background(), objectsListInput{Store: store, Bucket: "data"}, principalFor("u"))
		if err != nil {
			t.Fatalf("list store %q: %v", store, err)
		}
		if len(out.Objects) != 1 || out.Objects[0].Key != want {
			t.Fatalf("store %q listed %+v, want only %s", store, out.Objects, want)
		}
	}
}

func TestObjectsHead_DetailAndMiddleware(t *testing.T) {
	tv := openMem(t, trove.WithMiddleware(compress.New()))
	mustBucket(t, tv, "data")
	put(t, tv, "data", "notes.txt", strings.Repeat("hello ", 400),
		driver.WithContentType("text/plain"), driver.WithMetadata(map[string]string{"owner": "ops"}))
	out, err := objectsHeadHandler(testDeps(t, newStores(tv)))(context.Background(),
		objectKeyInput{Bucket: "data", Key: "notes.txt"}, principalFor("u"))
	if err != nil {
		t.Fatalf("head: %v", err)
	}
	if out.Object.Key != "notes.txt" || out.Object.Metadata["owner"] != "ops" || out.Object.ContentType == nil || *out.Object.ContentType != "text/plain" {
		t.Fatalf("object = %+v", out.Object)
	}
	if out.Object.StoredSize >= int64(len(strings.Repeat("hello ", 400))) {
		t.Errorf("storedSize %d is not the compressed size", out.Object.StoredSize)
	}
	if len(out.Middleware) != 1 || out.Middleware[0].Name != "compress" {
		t.Fatalf("middleware = %+v", out.Middleware)
	}
	if out.Presign.Available || out.Presign.Reason == nil {
		t.Fatalf("presign on memdriver = %+v, want unavailable with a reason", out.Presign)
	}
}

func TestObjectsHead_Missing(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	deps := testDeps(t, newStores(tv))
	if _, err := objectsHeadHandler(deps)(context.Background(), objectKeyInput{Bucket: "data", Key: "nope"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Fatalf("head missing = %v", err)
	}
	if _, err := objectsHeadHandler(deps)(context.Background(), objectKeyInput{Bucket: "data"}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Fatalf("head without key = %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile.

- [ ] **Step 3: Write `handlers_buckets.go`**

```go
package contract

import (
	"context"
	"sort"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove/driver"
)

type bucketInput struct {
	Store string `json:"store"`
	Name  string `json:"name"`
}

type bucketRow struct {
	Name      string  `json:"name"`
	CreatedAt *string `json:"createdAt"`
}

type bucketsListOutput struct {
	Buckets []bucketRow `json:"buckets"`
	// CreatedAtMeaning is "created" where the driver returns a creation
	// time and "modified" where it returns a last-modified time (local,
	// sftp and azure), so the column header can say which.
	CreatedAtMeaning string `json:"createdAtMeaning"`
}

type bucketNameOutput struct {
	Name string `json:"name"`
}

func bucketsListHandler(deps Deps) func(context.Context, storeInput, contract.Principal) (bucketsListOutput, error) {
	return func(ctx context.Context, in storeInput, _ contract.Principal) (bucketsListOutput, error) {
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return bucketsListOutput{}, err
		}
		list, err := st.Trove.ListBuckets(ctx)
		if err != nil {
			return bucketsListOutput{}, deps.mapError("buckets.list", err)
		}
		out := bucketsListOutput{Buckets: make([]bucketRow, 0, len(list)), CreatedAtMeaning: "modified"}
		if createdAtIsCreation(st.Trove.Driver().Name()) {
			out.CreatedAtMeaning = "created"
		}
		for _, b := range list {
			out.Buckets = append(out.Buckets, bucketRow{Name: b.Name, CreatedAt: formatTime(b.CreatedAt)})
		}
		sort.Slice(out.Buckets, func(i, j int) bool { return out.Buckets[i].Name < out.Buckets[j].Name })
		return out, nil
	}
}

func bucketsCreateHandler(deps Deps) func(context.Context, bucketInput, contract.Principal) (bucketNameOutput, error) {
	return func(ctx context.Context, in bucketInput, _ contract.Principal) (bucketNameOutput, error) {
		if err := requireName("name", in.Name); err != nil {
			return bucketNameOutput{}, err
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return bucketNameOutput{}, err
		}
		if err := st.Trove.CreateBucket(ctx, in.Name); err != nil {
			return bucketNameOutput{}, deps.mapError("buckets.create", err)
		}
		return bucketNameOutput{Name: in.Name}, nil
	}
}

// bucketsDeleteHandler refuses a bucket that still holds anything, on every
// driver. local, mem, sftp and azure would delete it recursively and s3 and
// gcs would refuse with an unclassified error, so the check here is what
// makes the behaviour the same everywhere. Something written between the
// check and the delete can still be lost on the recursive drivers.
func bucketsDeleteHandler(deps Deps) func(context.Context, bucketInput, contract.Principal) (bucketNameOutput, error) {
	return func(ctx context.Context, in bucketInput, _ contract.Principal) (bucketNameOutput, error) {
		if err := requireName("name", in.Name); err != nil {
			return bucketNameOutput{}, err
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return bucketNameOutput{}, err
		}
		it, err := st.Trove.List(ctx, in.Name, driver.WithMaxKeys(1), driver.WithDelimiter("/"))
		if err != nil {
			return bucketNameOutput{}, deps.mapError("buckets.delete", err)
		}
		objects, err := it.All(ctx)
		if err != nil {
			return bucketNameOutput{}, deps.mapError("buckets.delete", err)
		}
		if len(objects) > 0 || len(it.CommonPrefixes()) > 0 {
			return bucketNameOutput{}, conflict("This bucket still holds objects. Delete them first.")
		}
		if err := st.Trove.DeleteBucket(ctx, in.Name); err != nil {
			return bucketNameOutput{}, deps.mapError("buckets.delete", err)
		}
		return bucketNameOutput{Name: in.Name}, nil
	}
}
```

- [ ] **Step 4: Write `handlers_objects.go` (list, head, and the helpers Task 5 uses)**

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/driver"
)

const (
	defaultListLimit = 100
	maxListLimit     = 1000
)

type objectKeyInput struct {
	Store  string `json:"store"`
	Bucket string `json:"bucket"`
	Key    string `json:"key"`
}

type objectsListInput struct {
	Store  string `json:"store"`
	Bucket string `json:"bucket"`
	Prefix string `json:"prefix"`
	// Delimiter defaults to "/" when absent. An empty string asks for a
	// flat listing.
	Delimiter *string `json:"delimiter"`
	Cursor    string  `json:"cursor"`
	Limit     int     `json:"limit"`
}

type objectsListOutput struct {
	Objects []objectRow `json:"objects"`
	// Prefixes is null on a flat listing and a list otherwise. Objects and
	// prefixes are each sorted; the page merges them.
	Prefixes   []string `json:"prefixes"`
	NextCursor *string  `json:"nextCursor"`
	// FoldersSupported is true when this listing set a delimiter and the
	// driver folded keys into prefixes. It is false for a flat listing,
	// and false if a driver returned keys it should have folded.
	FoldersSupported bool `json:"foldersSupported"`
}

func objectsListHandler(deps Deps) func(context.Context, objectsListInput, contract.Principal) (objectsListOutput, error) {
	return func(ctx context.Context, in objectsListInput, _ contract.Principal) (objectsListOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return objectsListOutput{}, err
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return objectsListOutput{}, err
		}
		token, err := decodeCursor(in.Cursor)
		if err != nil {
			return objectsListOutput{}, err
		}
		delim := "/"
		if in.Delimiter != nil {
			delim = *in.Delimiter
		}
		limit := in.Limit
		if limit <= 0 {
			limit = defaultListLimit
		}
		if limit > maxListLimit {
			limit = maxListLimit
		}

		opts := []driver.ListOption{driver.WithMaxKeys(limit)}
		if in.Prefix != "" {
			opts = append(opts, driver.WithPrefix(in.Prefix))
		}
		if delim != "" {
			opts = append(opts, driver.WithDelimiter(delim))
		}
		if token != "" {
			opts = append(opts, driver.WithCursor(token))
		}

		it, err := st.Trove.List(ctx, in.Bucket, opts...)
		if err != nil {
			return objectsListOutput{}, deps.mapError("objects.list", err)
		}
		objects, err := it.All(ctx)
		if err != nil {
			return objectsListOutput{}, deps.mapError("objects.list", err)
		}

		out := objectsListOutput{
			Objects:    make([]objectRow, 0, len(objects)),
			NextCursor: encodeCursor(it.NextToken()),
		}
		folded := delim != ""
		for _, o := range objects {
			out.Objects = append(out.Objects, projectObjectRow(o))
			if delim != "" && strings.Contains(strings.TrimPrefix(o.Key, in.Prefix), delim) {
				folded = false
			}
		}
		if delim != "" {
			out.Prefixes = append([]string{}, it.CommonPrefixes()...)
		}
		out.FoldersSupported = folded
		return out, nil
	}
}

// presignStatus says whether a share link can be offered for a key, and why
// not when it cannot.
type presignStatus struct {
	Available bool    `json:"available"`
	Reason    *string `json:"reason"`
}

// presignAvailability offers a presigned link only when the driver can sign
// one and no middleware applies to the key. A presigned link talks to the
// backend directly, so it would skip encrypt, compress and scan on the way
// in and return stored bytes on the way out.
func presignAvailability(t *trove.Trove, rows []middlewareRow) presignStatus {
	if _, ok := t.Driver().(driver.PresignDriver); !ok {
		return presignStatus{Reason: optString("This driver cannot create presigned links.")}
	}
	if len(rows) > 0 {
		names := make([]string, 0, len(rows))
		for _, r := range rows {
			names = append(names, r.Name)
		}
		return presignStatus{Reason: optString("Middleware applies to this key (" + strings.Join(names, ", ") +
			"). A presigned link would skip it and return the stored bytes.")}
	}
	return presignStatus{Available: true}
}

// casBucket returns the CAS bucket when this Trove has CAS enabled.
func casBucket(t *trove.Trove) (string, bool) {
	c := t.CAS()
	if c == nil {
		return "", false
	}
	return c.Bucket(), true
}

type objectsHeadOutput struct {
	Object     objectDetail    `json:"object"`
	Middleware []middlewareRow `json:"middleware"`
	Presign    presignStatus   `json:"presign"`
}

func objectsHeadHandler(deps Deps) func(context.Context, objectKeyInput, contract.Principal) (objectsHeadOutput, error) {
	return func(ctx context.Context, in objectKeyInput, _ contract.Principal) (objectsHeadOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return objectsHeadOutput{}, err
		}
		if in.Key == "" {
			return objectsHeadOutput{}, badRequest("key is required")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return objectsHeadOutput{}, err
		}
		info, err := st.Trove.Head(ctx, in.Bucket, in.Key)
		if err != nil {
			return objectsHeadOutput{}, deps.mapError("objects.head", err)
		}
		rows := matchingAny(ctx, st.Trove, in.Bucket, in.Key)
		return objectsHeadOutput{
			Object:     projectObjectDetail(info),
			Middleware: rows,
			Presign:    presignAvailability(st.Trove, rows),
		}, nil
	}
}
```

- [ ] **Step 5: Bind the five intents**

Append to the list in `bindings`:

```go
		query("buckets.list", bucketsListHandler(deps)),
		command("buckets.create", bucketsCreateHandler(deps)),
		command("buckets.delete", bucketsDeleteHandler(deps)),
		query("objects.list", objectsListHandler(deps)),
		query("objects.head", objectsHeadHandler(deps)),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS on both backends. If `TestObjectsHead_DetailAndMiddleware`'s compressed-size check fails because compress skipped the object (it skips data under 1024 bytes and output that is not smaller), make the body longer; 2400 bytes of repeated text should compress.

- [ ] **Step 7: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/contract/handlers_buckets.go extension/contract/handlers_objects.go extension/contract/handlers_buckets_test.go extension/contract/handlers_objects_test.go"
git add $F
git commit --only -m "feat(extension): answer bucket intents, objects.list and objects.head" -- $F extension/contract/contract.go
git show --stat HEAD
```

Body: buckets come from the driver and a bucket that still holds objects is refused on every driver, where four of them would otherwise delete it recursively. objects.list pages with wrapped cursors and reports folders, and objects.head says which middleware applies to the key now.

---

### Task 5: objects.delete, objects.copy and objects.presign

**Files:**
- Modify: `extension/contract/handlers_objects.go`, `extension/contract/contract.go` (`bindings`)
- Test: `extension/contract/handlers_objects_write_test.go`

**Interfaces:**
- Consumes: `objectKeyInput`, `casBucket`, `presignAvailability`, `matching`, `matchingAny`, `projectObjectRow`, `projectObjectDetail` from Tasks 2 to 4.
- Produces: `objectsDeleteHandler`, `objectsCopyHandler`, `objectsPresignHandler`; `func refuseCASBucket(t *trove.Trove, bucket string) error` (Task 6 uses it for uploads).

- [ ] **Step 1: Write the failing tests**

Create `extension/contract/handlers_objects_write_test.go`:

```go
package contract

import (
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
	"github.com/xraph/trove/driver"
	"github.com/xraph/trove/drivers/memdriver"
	"github.com/xraph/trove/middleware"
	"github.com/xraph/trove/middleware/compress"
)

func TestObjectsDelete_RemovesTheBytes(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t)
		mustBucket(t, tv, "data")
		put(t, tv, "data", "a.txt", "x")
		deps := testDeps(t, newStores(tv))
		if _, err := objectsDeleteHandler(deps)(context.Background(), objectKeyInput{Bucket: "data", Key: "a.txt"}, principalFor("u")); err != nil {
			t.Fatalf("delete: %v", err)
		}
		if _, err := tv.Head(context.Background(), "data", "a.txt"); err == nil {
			t.Fatal("the object is still there")
		}
	})
}

func TestObjectsDelete_RefusesTheCASBucket(t *testing.T) {
	tv := openMem(t, trove.WithCAS(cas.AlgSHA256))
	mustBucket(t, tv, "cas")
	hash, _, err := tv.CAS().Store(context.Background(), strings.NewReader("blob"))
	if err != nil {
		t.Fatalf("cas store: %v", err)
	}
	deps := testDeps(t, newStores(tv))
	_, err = objectsDeleteHandler(deps)(context.Background(), objectKeyInput{Bucket: "cas", Key: hash}, principalFor("u"))
	if codeOf(err) != "CONFLICT" {
		t.Fatalf("delete in the CAS bucket = %v, want CONFLICT", err)
	}
	if ok, _ := tv.CAS().Exists(context.Background(), hash); !ok {
		t.Fatal("the CAS entry is gone")
	}
}

func TestObjectsCopy_CopiesAndRespectsOverwrite(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t)
		mustBucket(t, tv, "src")
		mustBucket(t, tv, "dst")
		put(t, tv, "src", "a.txt", "hello")
		put(t, tv, "dst", "taken.txt", "old")
		deps := testDeps(t, newStores(tv))
		ctx := context.Background()
		h := objectsCopyHandler(deps)

		out, err := h(ctx, objectsCopyInput{SrcBucket: "src", SrcKey: "a.txt", DstBucket: "dst", DstKey: "b.txt"}, principalFor("u"))
		if err != nil || out.Key != "b.txt" {
			t.Fatalf("copy = %+v, %v", out, err)
		}
		if _, err := h(ctx, objectsCopyInput{SrcBucket: "src", SrcKey: "a.txt", DstBucket: "dst", DstKey: "taken.txt"}, principalFor("u")); codeOf(err) != "CONFLICT" {
			t.Fatalf("copy onto an existing key = %v, want CONFLICT", err)
		}
		if _, err := h(ctx, objectsCopyInput{SrcBucket: "src", SrcKey: "a.txt", DstBucket: "dst", DstKey: "taken.txt", Overwrite: true}, principalFor("u")); err != nil {
			t.Fatalf("copy with overwrite: %v", err)
		}
		if _, err := h(ctx, objectsCopyInput{SrcBucket: "src", SrcKey: "a.txt", DstBucket: "src", DstKey: "a.txt"}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
			t.Fatalf("copy onto itself = %v, want BAD_REQUEST", err)
		}
		if _, err := h(ctx, objectsCopyInput{SrcBucket: "src", SrcKey: "nope", DstBucket: "dst", DstKey: "n.txt"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
			t.Fatalf("copy of a missing source = %v, want NOT_FOUND", err)
		}
	})
}

func TestObjectsCopy_RefusesAcrossDifferentMiddleware(t *testing.T) {
	tv := openMem(t, trove.WithScopedMiddleware(middleware.ForBuckets("zipped"), compress.New()))
	mustBucket(t, tv, "zipped")
	mustBucket(t, tv, "plain")
	put(t, tv, "zipped", "big.txt", strings.Repeat("hello ", 400))
	deps := testDeps(t, newStores(tv))
	_, err := objectsCopyHandler(deps)(context.Background(),
		objectsCopyInput{SrcBucket: "zipped", SrcKey: "big.txt", DstBucket: "plain", DstKey: "big.txt"}, principalFor("u"))
	if codeOf(err) != "CONFLICT" {
		t.Fatalf("copy across middleware = %v, want CONFLICT", err)
	}
	if _, headErr := tv.Head(context.Background(), "plain", "big.txt"); headErr == nil {
		t.Fatal("the refused copy wrote the object anyway")
	}
}

// presignMem is memdriver plus a PresignDriver, so a test can reach the
// available branch without a cloud backend.
type presignMem struct{ *memdriver.MemDriver }

func (p presignMem) PresignGet(_ context.Context, bucket, key string, _ time.Duration) (string, error) {
	return "https://signed.example/" + bucket + "/" + key, nil
}

func (p presignMem) PresignPut(_ context.Context, bucket, key string, _ time.Duration) (string, error) {
	return "https://signed.example/put/" + bucket + "/" + key, nil
}

var _ driver.PresignDriver = presignMem{}

func openPresign(t *testing.T, opts ...trove.Option) *trove.Trove {
	t.Helper()
	m := memdriver.New()
	if err := m.Open(context.Background(), ""); err != nil {
		t.Fatalf("open: %v", err)
	}
	return openTrove(t, presignMem{m}, opts...)
}

func TestObjectsPresign(t *testing.T) {
	tv := openPresign(t)
	mustBucket(t, tv, "data")
	put(t, tv, "data", "a.txt", "x")
	deps := testDeps(t, newStores(tv))
	out, err := objectsPresignHandler(deps)(context.Background(), objectsPresignInput{Bucket: "data", Key: "a.txt"}, principalFor("u"))
	if err != nil || out.URL != "https://signed.example/data/a.txt" || out.ExpiresAt == "" {
		t.Fatalf("presign = %+v, %v", out, err)
	}
}

func TestObjectsPresign_RefusedWithReason(t *testing.T) {
	tv := openPresign(t, trove.WithMiddleware(compress.New()))
	mustBucket(t, tv, "data")
	put(t, tv, "data", "a.txt", "x")
	_, err := objectsPresignHandler(testDeps(t, newStores(tv)))(context.Background(), objectsPresignInput{Bucket: "data", Key: "a.txt"}, principalFor("u"))
	if codeOf(err) != "UNAVAILABLE" || !strings.Contains(err.Error(), "compress") {
		t.Fatalf("presign with middleware = %v, want UNAVAILABLE naming compress", err)
	}

	plain := openMem(t)
	mustBucket(t, plain, "data")
	put(t, plain, "data", "a.txt", "x")
	if _, err := objectsPresignHandler(testDeps(t, newStores(plain)))(context.Background(), objectsPresignInput{Bucket: "data", Key: "a.txt"}, principalFor("u")); codeOf(err) != "UNAVAILABLE" {
		t.Fatalf("presign on memdriver = %v, want UNAVAILABLE", err)
	}
}

var _ = io.EOF
```

`presignMem` embeds `*memdriver.MemDriver`. If `memdriver.New()` returns a different concrete type name, use it (check `drivers/memdriver/mem.go`). Delete the trailing `var _ = io.EOF` line if `io` is otherwise unused.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile.

- [ ] **Step 3: Add the three handlers to `handlers_objects.go`**

Add `"time"` and `"errors"` to the imports if missing, then append:

```go
// refuseCASBucket refuses a write or delete in the CAS bucket. CAS owns
// that bucket's keys and its index points at them: deleting one leaves the
// index pointing at nothing, and writing one plants content the index
// never heard of.
func refuseCASBucket(t *trove.Trove, bucket string) error {
	if b, ok := casBucket(t); ok && b == bucket {
		return conflict("CAS manages the " + b + " bucket. Changing its objects here would leave the CAS index pointing at the wrong content.")
	}
	return nil
}

type keyOutput struct {
	Key string `json:"key"`
}

func objectsDeleteHandler(deps Deps) func(context.Context, objectKeyInput, contract.Principal) (keyOutput, error) {
	return func(ctx context.Context, in objectKeyInput, _ contract.Principal) (keyOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return keyOutput{}, err
		}
		if in.Key == "" {
			return keyOutput{}, badRequest("key is required")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return keyOutput{}, err
		}
		if err := refuseCASBucket(st.Trove, in.Bucket); err != nil {
			return keyOutput{}, err
		}
		if err := st.Trove.Delete(ctx, in.Bucket, in.Key); err != nil {
			return keyOutput{}, deps.mapError("objects.delete", err)
		}
		return keyOutput{Key: in.Key}, nil
	}
}

type objectsCopyInput struct {
	Store     string `json:"store"`
	SrcBucket string `json:"srcBucket"`
	SrcKey    string `json:"srcKey"`
	DstBucket string `json:"dstBucket"`
	DstKey    string `json:"dstKey"`
	Overwrite bool   `json:"overwrite"`
}

// pipelineSignature describes the middleware that runs for a key in both
// directions, in order, so two keys can be compared.
func pipelineSignature(ctx context.Context, t *trove.Trove, bucket, key string) string {
	var b strings.Builder
	for _, dir := range []struct {
		label string
		rows  []middlewareRow
	}{
		{"write:", matching(ctx, t, bucket, key, middlewareWrite)},
		{"read:", matching(ctx, t, bucket, key, middlewareRead)},
	} {
		b.WriteString(dir.label)
		for _, r := range dir.rows {
			b.WriteString(r.Name)
			b.WriteByte(',')
		}
		b.WriteByte(';')
	}
	return b.String()
}

// objectsCopyHandler copies stored bytes. Copy runs no middleware, so it
// refuses when the destination would run different middleware from the
// source: compressed or encrypted bytes would land where nothing decodes
// them.
func objectsCopyHandler(deps Deps) func(context.Context, objectsCopyInput, contract.Principal) (objectRow, error) {
	return func(ctx context.Context, in objectsCopyInput, _ contract.Principal) (objectRow, error) {
		for field, v := range map[string]string{"srcBucket": in.SrcBucket, "dstBucket": in.DstBucket} {
			if err := requireName(field, v); err != nil {
				return objectRow{}, err
			}
		}
		if in.SrcKey == "" || in.DstKey == "" {
			return objectRow{}, badRequest("srcKey and dstKey are required")
		}
		if in.SrcBucket == in.DstBucket && in.SrcKey == in.DstKey {
			return objectRow{}, badRequest("the source and the destination are the same object")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return objectRow{}, err
		}
		t := st.Trove
		if err := refuseCASBucket(t, in.DstBucket); err != nil {
			return objectRow{}, err
		}
		if _, err := t.Head(ctx, in.SrcBucket, in.SrcKey); err != nil {
			return objectRow{}, deps.mapError("objects.copy", err)
		}
		if !in.Overwrite {
			_, err := t.Head(ctx, in.DstBucket, in.DstKey)
			if err == nil {
				return objectRow{}, &contract.Error{
					Code: contract.CodeConflict, Message: "an object with this key already exists",
					Details: map[string]any{"exists": true},
				}
			}
			if !errors.Is(err, driver.ErrObjectNotFound) {
				return objectRow{}, deps.mapError("objects.copy", err)
			}
		}
		if pipelineSignature(ctx, t, in.SrcBucket, in.SrcKey) != pipelineSignature(ctx, t, in.DstBucket, in.DstKey) {
			return objectRow{}, conflict("Different middleware applies to the destination. Copy moves stored bytes without running middleware, so the copy would not read back correctly.")
		}
		info, err := t.Copy(ctx, in.SrcBucket, in.SrcKey, in.DstBucket, in.DstKey)
		if err != nil {
			return objectRow{}, deps.mapError("objects.copy", err)
		}
		return projectObjectRow(*info), nil
	}
}

const (
	defaultPresignSeconds = 3600
	minPresignSeconds     = 60
	maxPresignSeconds     = 7 * 24 * 3600
)

type objectsPresignInput struct {
	Store          string `json:"store"`
	Bucket         string `json:"bucket"`
	Key            string `json:"key"`
	ExpiresSeconds int    `json:"expiresSeconds"`
}

type linkOutput struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expiresAt"`
}

func objectsPresignHandler(deps Deps) func(context.Context, objectsPresignInput, contract.Principal) (linkOutput, error) {
	return func(ctx context.Context, in objectsPresignInput, _ contract.Principal) (linkOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return linkOutput{}, err
		}
		if in.Key == "" {
			return linkOutput{}, badRequest("key is required")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return linkOutput{}, err
		}
		if _, err := st.Trove.Head(ctx, in.Bucket, in.Key); err != nil {
			return linkOutput{}, deps.mapError("objects.presign", err)
		}
		status := presignAvailability(st.Trove, matchingAny(ctx, st.Trove, in.Bucket, in.Key))
		if !status.Available {
			return linkOutput{}, unavailable(*status.Reason)
		}
		secs := in.ExpiresSeconds
		if secs == 0 {
			secs = defaultPresignSeconds
		}
		if secs < minPresignSeconds {
			secs = minPresignSeconds
		}
		if secs > maxPresignSeconds {
			secs = maxPresignSeconds
		}
		ttl := time.Duration(secs) * time.Second
		expires := time.Now().Add(ttl)
		link, err := st.Trove.Driver().(driver.PresignDriver).PresignGet(ctx, in.Bucket, in.Key, ttl)
		if err != nil {
			if deps.Logger != nil {
				deps.Logger.Error("trove/contract: presign failed", forge.F("store", st.Name), forge.F("error", err))
			}
			return linkOutput{}, unavailable("The driver could not sign a link. GCS needs a service account key and Azure a shared key.")
		}
		return linkOutput{URL: link, ExpiresAt: expires.UTC().Format(time.RFC3339)}, nil
	}
}
```

Add `"github.com/xraph/forge"` to the imports for `forge.F`.

- [ ] **Step 4: Bind the three intents**

Append to `bindings`:

```go
		command("objects.delete", objectsDeleteHandler(deps)),
		command("objects.copy", objectsCopyHandler(deps)),
		command("objects.presign", objectsPresignHandler(deps)),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS. If `tv.CAS().Store` fails with bucket not found, the test's `mustBucket(t, tv, "cas")` must run before it (it does); the extension never creates that bucket, which is a recorded finding.

- [ ] **Step 6: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
git add extension/contract/handlers_objects_write_test.go
git commit --only -m "feat(extension): delete, copy and presign objects through the contract" -- extension/contract/handlers_objects.go extension/contract/handlers_objects_write_test.go extension/contract/contract.go
git show --stat HEAD
```

Body: delete removes the bytes (the templ page only soft-deleted a row) and refuses the CAS bucket. Copy refuses when the destination runs different middleware, because it moves stored bytes. Presign is offered only where the driver can sign and no middleware would be skipped.

---

### Task 6: Content intents and the content route

**Files:**
- Create: `extension/contract/handlers_content.go`, `extension/contract/content_http.go`
- Modify: `extension/contract/contract.go` (`bindings`)
- Test: `extension/contract/handlers_content_test.go`, `extension/contract/content_http_test.go`

**Interfaces:**
- Consumes: `Content`, `Signer`, `Ticket`, `Op*`, TTLs (Task 1-2), `objectKeyInput`, `refuseCASBucket`, `matching`, `projectObjectRow` (Tasks 3-5).
- Produces:
  - `func (c *Content) Handler(stores *Stores, logger forge.Logger) http.Handler` (Task 8 mounts it)
  - `objectsContentURLHandler`, `objectsBeginUploadHandler`, `objectsCompleteUploadHandler`

- [ ] **Step 1: Write the failing intent tests**

Create `extension/contract/handlers_content_test.go`:

```go
package contract

import (
	"context"
	"net/url"
	"strings"
	"testing"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
)

func ticketFrom(t *testing.T, deps Deps, link string) Ticket {
	t.Helper()
	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse %q: %v", link, err)
	}
	if u.Path != deps.Content.Path {
		t.Fatalf("link path = %q, want %q", u.Path, deps.Content.Path)
	}
	tk, err := deps.Content.Signer.Verify(u.Query().Get("t"))
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	return tk
}

func TestContentURL_DownloadAndPreview(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	put(t, tv, "data", "a.txt", "x")
	deps := testDeps(t, newStores(tv))
	ctx := context.Background()
	h := objectsContentURLHandler(deps)

	out, err := h(ctx, contentURLInput{Bucket: "data", Key: "a.txt"}, principalFor("user_1"))
	if err != nil {
		t.Fatalf("contentUrl: %v", err)
	}
	tk := ticketFrom(t, deps, out.URL)
	if tk.Op != OpDownload || tk.Key != "a.txt" || tk.Store != SingleStoreName || tk.Subject != "user_1" || out.ExpiresAt == "" {
		t.Fatalf("download ticket = %+v, out = %+v", tk, out)
	}

	out, err = h(ctx, contentURLInput{Bucket: "data", Key: "a.txt", Purpose: "preview"}, principalFor("u"))
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if tk := ticketFrom(t, deps, out.URL); tk.Op != OpPreview || tk.Limit != maxPreviewBytes {
		t.Fatalf("preview ticket = %+v", tk)
	}
	out, err = h(ctx, contentURLInput{Bucket: "data", Key: "a.txt", Purpose: "preview", Limit: 1 << 30}, principalFor("u"))
	if err != nil || ticketFrom(t, deps, out.URL).Limit != maxPreviewBytes {
		t.Fatalf("preview over the cap = %+v, %v", out, err)
	}
}

func TestContentURL_BadInput(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	deps := testDeps(t, newStores(tv))
	h := objectsContentURLHandler(deps)
	ctx := context.Background()
	if _, err := h(ctx, contentURLInput{Bucket: "data", Key: "nope"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Errorf("missing object = %v", err)
	}
	put(t, tv, "data", "a.txt", "x")
	if _, err := h(ctx, contentURLInput{Bucket: "data", Key: "a.txt", Purpose: "stream"}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("unknown purpose = %v", err)
	}
	if _, err := h(ctx, contentURLInput{Bucket: "data", Key: "a.txt", Purpose: "preview", Limit: -1}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("negative limit = %v", err)
	}
}

func TestBeginUpload(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	put(t, tv, "data", "taken.txt", "x")
	deps := testDeps(t, newStores(tv))
	h := objectsBeginUploadHandler(deps)
	ctx := context.Background()

	out, err := h(ctx, beginUploadInput{Bucket: "data", Key: "new.csv", Size: 10, ContentType: "text/csv"}, principalFor("u"))
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	tk := ticketFrom(t, deps, out.URL)
	if tk.Op != OpUpload || tk.Size != 10 || tk.ContentType != "text/csv" || tk.Overwrite {
		t.Fatalf("upload ticket = %+v", tk)
	}

	if _, err := h(ctx, beginUploadInput{Bucket: "data", Key: "taken.txt", Size: 1}, principalFor("u")); codeOf(err) != "CONFLICT" {
		t.Errorf("existing key without overwrite = %v", err)
	}
	if _, err := h(ctx, beginUploadInput{Bucket: "data", Key: "taken.txt", Size: 1, Overwrite: true}, principalFor("u")); err != nil {
		t.Errorf("existing key with overwrite = %v", err)
	}
	if _, err := h(ctx, beginUploadInput{Bucket: "data", Key: "big.bin", Size: deps.Content.MaxUploadBytes + 1}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("over the cap = %v", err)
	}
	if _, err := h(ctx, beginUploadInput{Bucket: "data", Key: "neg.bin", Size: -1}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("negative size = %v", err)
	}
	if _, err := h(ctx, beginUploadInput{Bucket: "data", Size: 1}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Errorf("no key = %v", err)
	}
}

func TestBeginUpload_RefusesTheCASBucket(t *testing.T) {
	tv := openMem(t, trove.WithCAS(cas.AlgSHA256))
	mustBucket(t, tv, "cas")
	_, err := objectsBeginUploadHandler(testDeps(t, newStores(tv)))(context.Background(),
		beginUploadInput{Bucket: "cas", Key: "sha256:abc", Size: 1}, principalFor("u"))
	if codeOf(err) != "CONFLICT" {
		t.Fatalf("upload into the CAS bucket = %v", err)
	}
}

func TestCompleteUpload(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	deps := testDeps(t, newStores(tv))
	h := objectsCompleteUploadHandler(deps)
	if _, err := h(context.Background(), objectKeyInput{Bucket: "data", Key: "late.txt"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Fatalf("complete before the bytes landed = %v", err)
	}
	put(t, tv, "data", "late.txt", strings.Repeat("z", 5))
	out, err := h(context.Background(), objectKeyInput{Bucket: "data", Key: "late.txt"}, principalFor("u"))
	if err != nil || out.Key != "late.txt" || out.StoredSize != 5 {
		t.Fatalf("complete = %+v, %v", out, err)
	}
}
```

- [ ] **Step 2: Write the failing HTTP tests**

Create `extension/contract/content_http_test.go`:

```go
package contract

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/xraph/trove"
	"github.com/xraph/trove/middleware/compress"
)

// serve runs one request against the content handler.
func serve(t *testing.T, deps Deps, method, link string, body io.Reader, contentLength int64) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, link, body)
	// Always set: -1 is how a test sends a body whose length is hidden,
	// which is how a client that lies about its size looks to the server.
	req.ContentLength = contentLength
	rec := httptest.NewRecorder()
	deps.Content.Handler(deps.Stores, nil).ServeHTTP(rec, req)
	return rec
}

func issue(t *testing.T, deps Deps, tk Ticket, ttl time.Duration) string {
	t.Helper()
	tok, _, err := deps.Content.Signer.Issue(tk, ttl)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	return deps.Content.URL(tok)
}

func TestContentGet_DownloadHeaders(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t)
		mustBucket(t, tv, "data")
		put(t, tv, "data", "docs/page.html", "<script>alert(1)</script>")
		deps := testDeps(t, newStores(tv))
		link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "docs/page.html", Op: OpDownload}, time.Minute)
		rec := serve(t, deps, http.MethodGet, link, nil, -1)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		h := rec.Header()
		if got := h.Get("Content-Disposition"); got != "attachment; filename*=UTF-8''page.html" {
			t.Errorf("Content-Disposition = %q", got)
		}
		if h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Security-Policy") != "sandbox" || h.Get("Cache-Control") != "no-store" {
			t.Errorf("headers = %v", h)
		}
		if h.Get("Content-Length") != "25" {
			t.Errorf("Content-Length = %q, want 25 with no middleware", h.Get("Content-Length"))
		}
		if rec.Body.String() != "<script>alert(1)</script>" {
			t.Errorf("body = %q", rec.Body)
		}
	})
}

func TestContentGet_KeyWithAwkwardCharacters(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	key := "reports/q3 résumé #1 ?x=%20.txt"
	put(t, tv, "data", key, "bytes")
	deps := testDeps(t, newStores(tv))
	link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: key, Op: OpDownload}, time.Minute)
	rec := serve(t, deps, http.MethodGet, link, nil, -1)
	if rec.Code != http.StatusOK || rec.Body.String() != "bytes" {
		t.Fatalf("status %d body %q", rec.Code, rec.Body)
	}
	want := "attachment; filename*=UTF-8''" + url.PathEscape("q3 résumé #1 ?x=%20.txt")
	if got := rec.Header().Get("Content-Disposition"); got != want {
		t.Fatalf("Content-Disposition = %q, want %q", got, want)
	}
}

func TestContentGet_CompressedRoundTripOmitsLength(t *testing.T) {
	tv := openMem(t, trove.WithMiddleware(compress.New()))
	mustBucket(t, tv, "data")
	body := strings.Repeat("hello ", 400)
	put(t, tv, "data", "big.txt", body)
	deps := testDeps(t, newStores(tv))
	link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "big.txt", Op: OpDownload}, time.Minute)
	rec := serve(t, deps, http.MethodGet, link, nil, -1)
	if rec.Code != http.StatusOK || rec.Body.String() != body {
		t.Fatalf("status %d, body length %d, want the original %d bytes", rec.Code, rec.Body.Len(), len(body))
	}
	if rec.Header().Get("Content-Length") != "" {
		t.Fatalf("Content-Length = %q with read middleware; the stored size is not what is served", rec.Header().Get("Content-Length"))
	}
}

func TestContentGet_PreviewStopsAtTheLimit(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	put(t, tv, "data", "a.txt", "0123456789")
	deps := testDeps(t, newStores(tv))
	link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "a.txt", Op: OpPreview, Limit: 4}, time.Minute)
	rec := serve(t, deps, http.MethodGet, link, nil, -1)
	if rec.Code != http.StatusOK || rec.Body.String() != "0123" {
		t.Fatalf("preview = %d %q", rec.Code, rec.Body)
	}
}

func TestContentGet_RefusesBadTickets(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	put(t, tv, "data", "a.txt", "x")
	deps := testDeps(t, newStores(tv))

	expired := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "a.txt", Op: OpDownload}, -time.Second)
	if rec := serve(t, deps, http.MethodGet, expired, nil, -1); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "expired") {
		t.Errorf("expired = %d %s", rec.Code, rec.Body)
	}
	if rec := serve(t, deps, http.MethodGet, deps.Content.Path+"?t=garbage", nil, -1); rec.Code != http.StatusForbidden {
		t.Errorf("garbage = %d", rec.Code)
	}
	upload := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "a.txt", Op: OpUpload, Size: 1}, time.Minute)
	if rec := serve(t, deps, http.MethodGet, upload, nil, -1); rec.Code != http.StatusForbidden {
		t.Errorf("upload ticket used for GET = %d", rec.Code)
	}
	missing := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "gone.txt", Op: OpDownload}, time.Minute)
	if rec := serve(t, deps, http.MethodGet, missing, nil, -1); rec.Code != http.StatusNotFound {
		t.Errorf("missing object = %d", rec.Code)
	}
	if rec := serve(t, deps, http.MethodDelete, missing, nil, -1); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE = %d", rec.Code)
	}
}

func TestContentPut_StoresThroughMiddleware(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := open(t, trove.WithMiddleware(compress.New()))
		mustBucket(t, tv, "data")
		deps := testDeps(t, newStores(tv))
		body := strings.Repeat("abc ", 1000)
		link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "up.txt", Op: OpUpload,
			Size: int64(len(body)), ContentType: "text/plain"}, time.Minute)
		rec := serve(t, deps, http.MethodPut, link, strings.NewReader(body), int64(len(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("put = %d %s", rec.Code, rec.Body)
		}
		obj, err := tv.Get(context.Background(), "data", "up.txt")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		defer obj.Close()
		got, _ := io.ReadAll(obj)
		if string(got) != body {
			t.Fatal("read back differs from the upload")
		}
		info, _ := tv.Head(context.Background(), "data", "up.txt")
		if info.Size >= int64(len(body)) || info.ContentType != "text/plain" {
			t.Fatalf("stored = %+v, want compressed and text/plain", info)
		}
	})
}

func TestContentPut_BodyLargerThanTicketIsRefused(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	deps := testDeps(t, newStores(tv))
	link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "lie.bin", Op: OpUpload, Size: 4}, time.Minute)

	if rec := serve(t, deps, http.MethodPut, link, bytes.NewReader(make([]byte, 64)), 64); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("declared 64 against a 4-byte ticket = %d", rec.Code)
	}
	// A client that hides the length: the body itself must be capped.
	if rec := serve(t, deps, http.MethodPut, link, bytes.NewReader(make([]byte, 64)), -1); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("undeclared 64 against a 4-byte ticket = %d", rec.Code)
	}
	if _, err := tv.Head(context.Background(), "data", "lie.bin"); err == nil {
		t.Fatal("an oversized upload was stored")
	}
}

func TestContentPut_OverwriteIsCheckedAgain(t *testing.T) {
	tv := openMem(t)
	mustBucket(t, tv, "data")
	deps := testDeps(t, newStores(tv))
	link := issue(t, deps, Ticket{Store: SingleStoreName, Bucket: "data", Key: "race.txt", Op: OpUpload, Size: 3}, time.Minute)
	put(t, tv, "data", "race.txt", "old")
	if rec := serve(t, deps, http.MethodPut, link, strings.NewReader("new"), 3); rec.Code != http.StatusConflict {
		t.Fatalf("put onto a key that appeared after begin = %d", rec.Code)
	}
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile.

- [ ] **Step 4: Write `handlers_content.go`**

```go
package contract

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove/driver"
)

// maxPreviewBytes caps a preview at 256 KiB, the most the page shows.
const maxPreviewBytes = 256 * 1024

type contentURLInput struct {
	Store   string `json:"store"`
	Bucket  string `json:"bucket"`
	Key     string `json:"key"`
	Purpose string `json:"purpose"`
	Limit   int64  `json:"limit"`
}

func subjectOf(p contract.Principal) string {
	if p.User == nil {
		return ""
	}
	return strings.TrimSpace(p.User.Subject)
}

func objectsContentURLHandler(deps Deps) func(context.Context, contentURLInput, contract.Principal) (linkOutput, error) {
	return func(ctx context.Context, in contentURLInput, p contract.Principal) (linkOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return linkOutput{}, err
		}
		if in.Key == "" {
			return linkOutput{}, badRequest("key is required")
		}
		op := OpDownload
		switch in.Purpose {
		case "", "download":
		case "preview":
			op = OpPreview
		default:
			return linkOutput{}, badRequest(`purpose must be "download" or "preview"`)
		}
		if in.Limit < 0 {
			return linkOutput{}, badRequest("limit cannot be negative")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return linkOutput{}, err
		}
		if _, err := st.Trove.Head(ctx, in.Bucket, in.Key); err != nil {
			return linkOutput{}, deps.mapError("objects.contentUrl", err)
		}
		tk := Ticket{Store: st.Name, Bucket: in.Bucket, Key: in.Key, Op: op, Subject: subjectOf(p)}
		if op == OpPreview {
			tk.Limit = in.Limit
			if tk.Limit == 0 || tk.Limit > maxPreviewBytes {
				tk.Limit = maxPreviewBytes
			}
		}
		tok, expires, err := deps.Content.Signer.Issue(tk, DownloadTicketTTL)
		if err != nil {
			return linkOutput{}, deps.mapError("objects.contentUrl", err)
		}
		return linkOutput{URL: deps.Content.URL(tok), ExpiresAt: expires.UTC().Format(time.RFC3339)}, nil
	}
}

type beginUploadInput struct {
	Store       string `json:"store"`
	Bucket      string `json:"bucket"`
	Key         string `json:"key"`
	Size        int64  `json:"size"`
	ContentType string `json:"contentType"`
	Overwrite   bool   `json:"overwrite"`
}

func objectsBeginUploadHandler(deps Deps) func(context.Context, beginUploadInput, contract.Principal) (linkOutput, error) {
	return func(ctx context.Context, in beginUploadInput, p contract.Principal) (linkOutput, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return linkOutput{}, err
		}
		if in.Key == "" {
			return linkOutput{}, badRequest("key is required")
		}
		if in.Size < 0 {
			return linkOutput{}, badRequest("size cannot be negative")
		}
		if in.Size > deps.Content.MaxUploadBytes {
			return linkOutput{}, &contract.Error{
				Code:    contract.CodeBadRequest,
				Message: fmt.Sprintf("This file is larger than the upload limit of %d bytes.", deps.Content.MaxUploadBytes),
				Details: map[string]any{"maxUploadBytes": deps.Content.MaxUploadBytes},
			}
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return linkOutput{}, err
		}
		if err := refuseCASBucket(st.Trove, in.Bucket); err != nil {
			return linkOutput{}, err
		}
		if !in.Overwrite {
			_, err := st.Trove.Head(ctx, in.Bucket, in.Key)
			if err == nil {
				return linkOutput{}, &contract.Error{
					Code: contract.CodeConflict, Message: "an object with this key already exists",
					Details: map[string]any{"exists": true},
				}
			}
			if !errors.Is(err, driver.ErrObjectNotFound) {
				return linkOutput{}, deps.mapError("objects.beginUpload", err)
			}
		}
		tk := Ticket{
			Store: st.Name, Bucket: in.Bucket, Key: in.Key, Op: OpUpload, Subject: subjectOf(p),
			Size: in.Size, ContentType: in.ContentType, Overwrite: in.Overwrite,
		}
		tok, expires, err := deps.Content.Signer.Issue(tk, UploadTicketTTL)
		if err != nil {
			return linkOutput{}, deps.mapError("objects.beginUpload", err)
		}
		return linkOutput{URL: deps.Content.URL(tok), ExpiresAt: expires.UTC().Format(time.RFC3339)}, nil
	}
}

// objectsCompleteUploadHandler confirms what the content route stored. It
// exists so the upload ends in a command, which is what carries
// meta.invalidates to the client: the React shell refreshes through that
// and nothing else.
func objectsCompleteUploadHandler(deps Deps) func(context.Context, objectKeyInput, contract.Principal) (objectRow, error) {
	return func(ctx context.Context, in objectKeyInput, _ contract.Principal) (objectRow, error) {
		if err := requireName("bucket", in.Bucket); err != nil {
			return objectRow{}, err
		}
		if in.Key == "" {
			return objectRow{}, badRequest("key is required")
		}
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return objectRow{}, err
		}
		info, err := st.Trove.Head(ctx, in.Bucket, in.Key)
		if err != nil {
			return objectRow{}, deps.mapError("objects.completeUpload", err)
		}
		return projectObjectRow(*info), nil
	}
}
```

Note: a missing bucket on beginUpload's Head surfaces as `ErrBucketNotFound`, which is not `ErrObjectNotFound`, so it maps to `NOT_FOUND` "bucket not found". That is the right answer.

- [ ] **Step 5: Write `content_http.go`**

```go
package contract

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove"
	"github.com/xraph/trove/driver"
)

// Handler serves object content for tickets minted by the content intents.
// It authorises by ticket signature alone, which is what lets a plain
// download link work, and it never serves content inline: an uploaded HTML
// or SVG file would otherwise run on the dashboard's origin as the
// operator.
func (c *Content) Handler(stores *Stores, logger forge.Logger) http.Handler {
	return &contentHandler{content: c, stores: stores, logger: logger}
}

type contentHandler struct {
	content *Content
	stores  *Stores
	logger  forge.Logger
}

func (h *contentHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.serveGet(w, r)
	case http.MethodPut:
		h.servePut(w, r)
	default:
		w.Header().Set("Allow", "GET, PUT")
		writeContentError(w, http.StatusMethodNotAllowed, "only GET and PUT are allowed")
	}
}

func (h *contentHandler) ticket(w http.ResponseWriter, r *http.Request, ops ...string) (Ticket, *Store, bool) {
	tk, err := h.content.Signer.Verify(r.URL.Query().Get("t"))
	switch {
	case errors.Is(err, ErrTicketExpired):
		writeContentError(w, http.StatusForbidden, "This link has expired. Request a new one.")
		return Ticket{}, nil, false
	case err != nil:
		writeContentError(w, http.StatusForbidden, "This link is not valid.")
		return Ticket{}, nil, false
	}
	allowed := false
	for _, op := range ops {
		if tk.Op == op {
			allowed = true
		}
	}
	if !allowed {
		writeContentError(w, http.StatusForbidden, "This link is not valid for this request.")
		return Ticket{}, nil, false
	}
	st, err := h.stores.Resolve(tk.Store)
	if err != nil {
		writeContentError(w, http.StatusNotFound, "This store no longer exists.")
		return Ticket{}, nil, false
	}
	return tk, st, true
}

func (h *contentHandler) serveGet(w http.ResponseWriter, r *http.Request) {
	tk, st, ok := h.ticket(w, r, OpDownload, OpPreview)
	if !ok {
		return
	}
	obj, err := st.Trove.Get(r.Context(), tk.Bucket, tk.Key)
	if err != nil {
		h.writeMapped(w, err)
		return
	}
	defer obj.Close()

	hdr := w.Header()
	hdr.Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(path.Base(tk.Key)))
	hdr.Set("X-Content-Type-Options", "nosniff")
	hdr.Set("Content-Security-Policy", "sandbox")
	hdr.Set("Cache-Control", "no-store")
	ct := "application/octet-stream"
	if obj.Info != nil && obj.Info.ContentType != "" {
		ct = obj.Info.ContentType
	}
	hdr.Set("Content-Type", ct)

	var body io.Reader = obj
	if tk.Op == OpPreview {
		body = io.LimitReader(obj, tk.Limit)
	} else if obj.Info != nil && len(matching(r.Context(), st.Trove, tk.Bucket, tk.Key, middlewareRead)) == 0 {
		// The stored size is what is served only when nothing transforms
		// it on the way out.
		hdr.Set("Content-Length", strconv.FormatInt(obj.Info.Size, 10))
	}
	w.WriteHeader(http.StatusOK)
	if _, err := io.Copy(w, body); err != nil && h.logger != nil {
		// Headers are gone; all that is left is to say so in the log.
		h.logger.Error("trove/contract: content download failed mid-stream",
			forge.F("store", st.Name), forge.F("bucket", tk.Bucket), forge.F("error", err))
	}
}

func (h *contentHandler) servePut(w http.ResponseWriter, r *http.Request) {
	tk, st, ok := h.ticket(w, r, OpUpload)
	if !ok {
		return
	}
	if r.ContentLength > tk.Size {
		writeContentError(w, http.StatusRequestEntityTooLarge, "This body is larger than the upload was declared.")
		return
	}
	if !tk.Overwrite {
		_, err := st.Trove.Head(r.Context(), tk.Bucket, tk.Key)
		if err == nil {
			writeContentError(w, http.StatusConflict, "An object with this key already exists.")
			return
		}
		if !errors.Is(err, driver.ErrObjectNotFound) {
			h.writeMapped(w, err)
			return
		}
	}
	body := http.MaxBytesReader(w, r.Body, tk.Size)
	var opts []driver.PutOption
	if tk.ContentType != "" {
		opts = append(opts, driver.WithContentType(tk.ContentType))
	}
	info, err := st.Trove.Put(r.Context(), tk.Bucket, tk.Key, body, opts...)
	if err != nil {
		var tooLarge *http.MaxBytesError
		switch {
		case errors.As(err, &tooLarge):
			writeContentError(w, http.StatusRequestEntityTooLarge, "This body is larger than the upload was declared.")
		case errors.Is(err, trove.ErrContentBlocked):
			writeContentError(w, http.StatusUnprocessableEntity, "A content scan blocked this upload.")
		default:
			h.writeMapped(w, err)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"key": tk.Key, "storedSize": info.Size, "etag": optString(info.ETag)})
}

// writeMapped answers with the HTTP status for err's contract code.
func (h *contentHandler) writeMapped(w http.ResponseWriter, err error) {
	mapped := mapError(err)
	var ce *contract.Error
	status, msg := http.StatusInternalServerError, "an internal error occurred"
	if errors.As(mapped, &ce) {
		msg = ce.Message
		switch ce.Code {
		case contract.CodeNotFound:
			status = http.StatusNotFound
		case contract.CodeBadRequest:
			status = http.StatusBadRequest
		case contract.CodeConflict:
			status = http.StatusConflict
		case contract.CodePermissionDenied:
			status = http.StatusForbidden
		case contract.CodeUnavailable:
			status = http.StatusServiceUnavailable
		}
	}
	if status == http.StatusInternalServerError && h.logger != nil {
		h.logger.Error("trove/contract: content request failed", forge.F("error", err))
	}
	writeContentError(w, status, msg)
}

func writeContentError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

var _ = context.Background
```

Delete the last line if `context` is unused. The `*http.MaxBytesError` survives only if every layer between the body and `Put`'s return wraps with `%w`. If `TestContentPut_BodyLargerThanTicketIsRefused`'s undeclared case gets 500 instead of 413, find where the error loses its chain (trove's write pipeline closes the pipe with the reader's error; a driver may wrap with `%v`), and add a second check: `if strings.Contains(err.Error(), "http: request body too large")` is NOT acceptable; instead wrap the body in a small reader that records it hit the cap (`capReader{r: body, hit: &bool}`) and test that flag after `Put` returns an error. Report which path you needed.

- [ ] **Step 6: Bind the three intents**

Append to `bindings`:

```go
		query("objects.contentUrl", objectsContentURLHandler(deps)),
		command("objects.beginUpload", objectsBeginUploadHandler(deps)),
		command("objects.completeUpload", objectsCompleteUploadHandler(deps)),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/contract/handlers_content.go extension/contract/content_http.go extension/contract/handlers_content_test.go extension/contract/content_http_test.go"
git add $F
git commit --only -m "feat(extension): move object content through ticketed routes" -- $F extension/contract/contract.go
git show --stat HEAD
```

Body: the content intents mint short-lived signed tickets and the route checks them, so a download is a plain link and an upload is a raw PUT with real progress. Content is never served inline, the declared upload size is enforced on the body itself, and uploads go through Trove's middleware on every driver.

---

### Task 7: CAS and stream intents

**Files:**
- Create: `extension/contract/handlers_cas.go`, `extension/contract/handlers_streams.go`
- Modify: `extension/contract/contract.go` (`bindings`)
- Test: `extension/contract/handlers_cas_test.go`, `extension/contract/handlers_streams_test.go`

**Interfaces:**
- Consumes: `storeInput`, cursor helpers, `formatTime`, `mapError` (Tasks 2-3); `cas.CAS.Bucket`, `cas.CAS.Stat`, `stream.Stream.TotalSize` (trove slice 1).
- Produces: `casStatusHandler`, `casListHandler`, `casPinHandler`, `casUnpinHandler`, `casGCHandler`, `streamsListHandler`.

- [ ] **Step 1: Write the failing tests**

Create `extension/contract/handlers_cas_test.go`:

```go
package contract

import (
	"context"
	"strings"
	"testing"

	"github.com/xraph/trove"
	"github.com/xraph/trove/cas"
)

func casTrove(t *testing.T, open opener) *trove.Trove {
	t.Helper()
	tv := open(t, trove.WithCAS(cas.AlgSHA256))
	mustBucket(t, tv, "cas")
	return tv
}

func TestCASStatus(t *testing.T) {
	off, err := casStatusHandler(testDeps(t, newStores(openMem(t))))(context.Background(), storeInput{}, principalFor("u"))
	if err != nil || off.Enabled || off.Bucket != nil {
		t.Fatalf("disabled = %+v, %v", off, err)
	}
	on, err := casStatusHandler(testDeps(t, newStores(casTrove(t, openMem))))(context.Background(), storeInput{}, principalFor("u"))
	if err != nil || !on.Enabled || on.Bucket == nil || *on.Bucket != "cas" || on.Algorithm == nil || !on.ResetsOnRestart || on.ReleaseSupported {
		t.Fatalf("enabled = %+v, %v", on, err)
	}
}

func TestCASList_JoinsBucketAndIndex(t *testing.T) {
	forEachBackend(t, func(t *testing.T, open opener) {
		tv := casTrove(t, open)
		ctx := context.Background()
		hash, _, err := tv.CAS().Store(ctx, strings.NewReader("indexed"))
		if err != nil {
			t.Fatalf("store: %v", err)
		}
		if _, _, err := tv.CAS().Store(ctx, strings.NewReader("indexed")); err != nil {
			t.Fatalf("store again: %v", err)
		}
		// A blob in the bucket the index never saw, which is what every
		// blob looks like after a restart.
		put(t, tv, "cas", "sha256:orphan", "lost")

		out, err := casListHandler(testDeps(t, newStores(tv)))(ctx, casListInput{}, principalFor("u"))
		if err != nil {
			t.Fatalf("cas.list: %v", err)
		}
		byHash := map[string]casEntryRow{}
		for _, e := range out.Entries {
			byHash[e.Hash] = e
		}
		if e := byHash[hash]; !e.Indexed || e.RefCount == nil || *e.RefCount != 2 || e.Pinned == nil || *e.Pinned {
			t.Errorf("indexed entry = %+v", e)
		}
		if e := byHash["sha256:orphan"]; e.Indexed || e.RefCount != nil || e.Pinned != nil {
			t.Errorf("orphan = %+v, want not indexed with null refs and pin", e)
		}
	})
}

func TestCASList_MissingBucketIsEmpty(t *testing.T) {
	tv := openMem(t, trove.WithCAS(cas.AlgSHA256))
	out, err := casListHandler(testDeps(t, newStores(tv)))(context.Background(), casListInput{}, principalFor("u"))
	if err != nil || out.Entries == nil || len(out.Entries) != 0 {
		t.Fatalf("no cas bucket = %+v, %v", out, err)
	}
}

func TestCAS_DisabledIsUnavailable(t *testing.T) {
	deps := testDeps(t, newStores(openMem(t)))
	ctx := context.Background()
	if _, err := casListHandler(deps)(ctx, casListInput{}, principalFor("u")); codeOf(err) != "UNAVAILABLE" {
		t.Errorf("list = %v", err)
	}
	if _, err := casPinHandler(deps)(ctx, casHashInput{Hash: "x"}, principalFor("u")); codeOf(err) != "UNAVAILABLE" {
		t.Errorf("pin = %v", err)
	}
	if _, err := casGCHandler(deps)(ctx, storeInput{}, principalFor("u")); codeOf(err) != "UNAVAILABLE" {
		t.Errorf("gc = %v", err)
	}
}

func TestCASPinUnpin(t *testing.T) {
	tv := casTrove(t, openMem)
	ctx := context.Background()
	hash, _, err := tv.CAS().Store(ctx, strings.NewReader("pin me"))
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	deps := testDeps(t, newStores(tv))
	out, err := casPinHandler(deps)(ctx, casHashInput{Hash: hash}, principalFor("u"))
	if err != nil || out.Pinned == nil || !*out.Pinned {
		t.Fatalf("pin = %+v, %v", out, err)
	}
	out, err = casUnpinHandler(deps)(ctx, casHashInput{Hash: hash}, principalFor("u"))
	if err != nil || out.Pinned == nil || *out.Pinned {
		t.Fatalf("unpin = %+v, %v", out, err)
	}
	if _, err := casPinHandler(deps)(ctx, casHashInput{Hash: "sha256:none"}, principalFor("u")); codeOf(err) != "NOT_FOUND" {
		t.Fatalf("pin of an unknown hash = %v", err)
	}
	if _, err := casPinHandler(deps)(ctx, casHashInput{}, principalFor("u")); codeOf(err) != "BAD_REQUEST" {
		t.Fatalf("pin without a hash = %v", err)
	}
}

func TestCASGC_ReportsWhatItDid(t *testing.T) {
	tv := casTrove(t, openMem)
	if _, _, err := tv.CAS().Store(context.Background(), strings.NewReader("kept")); err != nil {
		t.Fatalf("store: %v", err)
	}
	out, err := casGCHandler(testDeps(t, newStores(tv)))(context.Background(), storeInput{}, principalFor("u"))
	if err != nil || out.Deleted != 0 {
		t.Fatalf("gc = %+v, %v; nothing can reach refcount 0, so nothing is deleted", out, err)
	}
}
```

Create `extension/contract/handlers_streams_test.go`:

```go
package contract

import (
	"context"
	"testing"

	"github.com/xraph/trove/stream"
)

func TestStreamsList(t *testing.T) {
	tv := openMem(t)
	deps := testDeps(t, newStores(tv))
	ctx := context.Background()

	empty, err := streamsListHandler(deps)(ctx, storeInput{}, principalFor("u"))
	if err != nil || empty.Streams == nil || len(empty.Streams) != 0 || empty.Max != tv.Config().PoolSize {
		t.Fatalf("empty = %+v, %v", empty, err)
	}

	s, err := tv.Stream(ctx, "data", "big.bin", stream.DirectionUpload)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	defer tv.Pool().Release(s)
	s.SetTotalSize(2048)

	out, err := streamsListHandler(deps)(ctx, storeInput{}, principalFor("u"))
	if err != nil || len(out.Streams) != 1 || out.Active != 1 {
		t.Fatalf("one stream = %+v, %v", out, err)
	}
	row := out.Streams[0]
	if row.Direction != "upload" || row.Bucket != "data" || row.Key != "big.bin" || row.TotalSize == nil || *row.TotalSize != 2048 || row.ID == "" {
		t.Fatalf("row = %+v", row)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/`
Expected: FAIL to compile.

- [ ] **Step 3: Write `handlers_cas.go`**

```go
package contract

import (
	"context"
	"errors"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove/cas"
	"github.com/xraph/trove/driver"
)

type casStatusOutput struct {
	Enabled   bool    `json:"enabled"`
	Algorithm *string `json:"algorithm"`
	Bucket    *string `json:"bucket"`
	// Index is "memory": the extension never gives CAS a persistent index.
	Index *string `json:"index"`
	// ResetsOnRestart is true for the memory index: every refcount and pin
	// is lost, and existing blobs stop being found.
	ResetsOnRestart bool `json:"resetsOnRestart"`
	// ReleaseSupported is false: nothing in CAS lowers a refcount, so GC
	// never finds anything to collect.
	ReleaseSupported bool `json:"releaseSupported"`
}

func casStatusHandler(deps Deps) func(context.Context, storeInput, contract.Principal) (casStatusOutput, error) {
	return func(_ context.Context, in storeInput, _ contract.Principal) (casStatusOutput, error) {
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return casStatusOutput{}, err
		}
		c := st.Trove.CAS()
		if c == nil {
			return casStatusOutput{}, nil
		}
		return casStatusOutput{
			Enabled:          true,
			Algorithm:        optString(c.Algorithm().String()),
			Bucket:           optString(c.Bucket()),
			Index:            optString("memory"),
			ResetsOnRestart:  true,
			ReleaseSupported: false,
		}, nil
	}
}

func requireCAS(deps Deps, store string) (*cas.CAS, *Store, error) {
	st, err := deps.Stores.Resolve(store)
	if err != nil {
		return nil, nil, err
	}
	c := st.Trove.CAS()
	if c == nil {
		return nil, nil, unavailable("CAS is not enabled on this store.")
	}
	return c, st, nil
}

type casListInput struct {
	Store  string `json:"store"`
	Cursor string `json:"cursor"`
	Limit  int    `json:"limit"`
}

type casEntryRow struct {
	Hash         string  `json:"hash"`
	StoredSize   int64   `json:"storedSize"`
	LastModified *string `json:"lastModified"`
	Indexed      bool    `json:"indexed"`
	RefCount     *int    `json:"refCount"`
	Pinned       *bool   `json:"pinned"`
}

type casListOutput struct {
	Entries    []casEntryRow `json:"entries"`
	NextCursor *string       `json:"nextCursor"`
}

// casListHandler lists the CAS bucket through the driver and joins each
// blob to the index. A blob the index does not know is `indexed: false`,
// which is how a restart shows up.
func casListHandler(deps Deps) func(context.Context, casListInput, contract.Principal) (casListOutput, error) {
	return func(ctx context.Context, in casListInput, _ contract.Principal) (casListOutput, error) {
		c, st, err := requireCAS(deps, in.Store)
		if err != nil {
			return casListOutput{}, err
		}
		token, err := decodeCursor(in.Cursor)
		if err != nil {
			return casListOutput{}, err
		}
		limit := in.Limit
		if limit <= 0 {
			limit = defaultListLimit
		}
		if limit > maxListLimit {
			limit = maxListLimit
		}
		opts := []driver.ListOption{driver.WithMaxKeys(limit)}
		if token != "" {
			opts = append(opts, driver.WithCursor(token))
		}
		out := casListOutput{Entries: []casEntryRow{}}
		it, err := st.Trove.List(ctx, c.Bucket(), opts...)
		if errors.Is(err, driver.ErrBucketNotFound) {
			// The extension never creates the CAS bucket; until something
			// is stored there is nothing to list.
			return out, nil
		}
		if err != nil {
			return casListOutput{}, deps.mapError("cas.list", err)
		}
		objects, err := it.All(ctx)
		if err != nil {
			return casListOutput{}, deps.mapError("cas.list", err)
		}
		for _, o := range objects {
			row := casEntryRow{Hash: o.Key, StoredSize: o.Size, LastModified: formatTime(o.LastModified)}
			entry, statErr := c.Stat(ctx, o.Key)
			switch {
			case statErr == nil:
				refs, pinned := entry.RefCount, entry.Pinned
				row.Indexed, row.RefCount, row.Pinned = true, &refs, &pinned
			case errors.Is(statErr, cas.ErrNotFound):
			default:
				return casListOutput{}, deps.mapError("cas.list", statErr)
			}
			out.Entries = append(out.Entries, row)
		}
		out.NextCursor = encodeCursor(it.NextToken())
		return out, nil
	}
}

type casHashInput struct {
	Store string `json:"store"`
	Hash  string `json:"hash"`
}

func casPinHandlerFor(deps Deps, intent string, pin bool) func(context.Context, casHashInput, contract.Principal) (casEntryRow, error) {
	return func(ctx context.Context, in casHashInput, _ contract.Principal) (casEntryRow, error) {
		if in.Hash == "" {
			return casEntryRow{}, badRequest("hash is required")
		}
		c, _, err := requireCAS(deps, in.Store)
		if err != nil {
			return casEntryRow{}, err
		}
		if pin {
			err = c.Pin(ctx, in.Hash)
		} else {
			err = c.Unpin(ctx, in.Hash)
		}
		if err != nil {
			return casEntryRow{}, deps.mapError(intent, err)
		}
		entry, err := c.Stat(ctx, in.Hash)
		if err != nil {
			return casEntryRow{}, deps.mapError(intent, err)
		}
		refs, pinned := entry.RefCount, entry.Pinned
		return casEntryRow{Hash: entry.Hash, StoredSize: entry.Size, Indexed: true, RefCount: &refs, Pinned: &pinned}, nil
	}
}

func casPinHandler(deps Deps) func(context.Context, casHashInput, contract.Principal) (casEntryRow, error) {
	return casPinHandlerFor(deps, "cas.pin", true)
}

func casUnpinHandler(deps Deps) func(context.Context, casHashInput, contract.Principal) (casEntryRow, error) {
	return casPinHandlerFor(deps, "cas.unpin", false)
}

type casGCOutput struct {
	Scanned    int   `json:"scanned"`
	Deleted    int   `json:"deleted"`
	FreedBytes int64 `json:"freedBytes"`
	Errors     int   `json:"errors"`
}

func casGCHandler(deps Deps) func(context.Context, storeInput, contract.Principal) (casGCOutput, error) {
	return func(ctx context.Context, in storeInput, _ contract.Principal) (casGCOutput, error) {
		c, _, err := requireCAS(deps, in.Store)
		if err != nil {
			return casGCOutput{}, err
		}
		res, err := c.GC(ctx)
		if err != nil {
			return casGCOutput{}, deps.mapError("cas.gc", err)
		}
		return casGCOutput{Scanned: res.Scanned, Deleted: res.Deleted, FreedBytes: res.FreedBytes, Errors: res.Errors}, nil
	}
}
```

If `MemoryIndex.Pin` on a missing hash returns an error that does not wrap `cas.ErrNotFound`, `TestCASPinUnpin`'s unknown-hash case will map to INTERNAL: check `cas/index.go` `Pin`, and if it returns a bare error, test `c.Stat` first and return `NOT_FOUND` before pinning. Report which you did.

- [ ] **Step 4: Write `handlers_streams.go`**

```go
package contract

import (
	"context"
	"sort"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/trove/stream"
)

type streamRow struct {
	ID        string `json:"id"`
	Direction string `json:"direction"`
	Bucket    string `json:"bucket"`
	Key       string `json:"key"`
	State     string `json:"state"`
	Offset    int64  `json:"offset"`
	TotalSize *int64 `json:"totalSize"`
}

type streamsListOutput struct {
	Streams []streamRow `json:"streams"`
	Active  int         `json:"active"`
	Max     int         `json:"max"`
}

// streamsListHandler lists the streams open in this process's pool. They
// are not persisted: a restart loses every one, and none can be resumed.
func streamsListHandler(deps Deps) func(context.Context, storeInput, contract.Principal) (streamsListOutput, error) {
	return func(_ context.Context, in storeInput, _ contract.Principal) (streamsListOutput, error) {
		st, err := deps.Stores.Resolve(in.Store)
		if err != nil {
			return streamsListOutput{}, err
		}
		out := streamsListOutput{Streams: []streamRow{}, Max: st.Trove.Config().PoolSize}
		pool := st.Trove.Pool()
		if pool == nil {
			return out, nil
		}
		pool.Range(func(s *stream.Stream) bool {
			row := streamRow{
				ID: s.ID.String(), Direction: s.Direction.String(), Bucket: s.Bucket, Key: s.Key,
				State: string(s.State()), Offset: s.Offset(),
			}
			if total := s.TotalSize(); total >= 0 {
				row.TotalSize = &total
			}
			out.Streams = append(out.Streams, row)
			return true
		})
		sort.Slice(out.Streams, func(i, j int) bool { return out.Streams[i].ID < out.Streams[j].ID })
		out.Active = pool.ActiveCount()
		return out, nil
	}
}
```

- [ ] **Step 5: Bind the six intents**

Append to `bindings`:

```go
		query("cas.status", casStatusHandler(deps)),
		query("cas.list", casListHandler(deps)),
		command("cas.pin", casPinHandler(deps)),
		command("cas.unpin", casUnpinHandler(deps)),
		command("cas.gc", casGCHandler(deps)),
		query("streams.list", streamsListHandler(deps)),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ && go vet ./contract/`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./contract/...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/contract/handlers_cas.go extension/contract/handlers_streams.go extension/contract/handlers_cas_test.go extension/contract/handlers_streams_test.go"
git add $F
git commit --only -m "feat(extension): answer CAS and stream intents from the live engine" -- $F extension/contract/contract.go
git show --stat HEAD
```

Body: CAS reads the engine's own index, not the table the templ page listed, and says plainly that the index resets on restart and nothing can release content. cas.list joins the bucket to the index so blobs a restart orphaned show up. Streams are the pool's live state, labelled as lost on restart.

---

### Task 8: Wire the extension: config, content route, contract registration

**Files:**
- Modify: `extension/config.go`, `extension/extension.go`
- Create: `extension/dashboard_contract.go`
- Test: `extension/dashboard_contract_test.go`, `extension/dashboard_aware_test.go`, `extension/contract/transport_test.go`, `extension/contract/bindings_test.go`

**Interfaces:**
- Consumes: `contract.NewSingleStore`, `contract.NewStores`, `contract.Store`, `contract.Flags`, `contract.Content`, `contract.NewSigner`, `contract.NewRandomSigner`, `contract.Register`, `contract.Deps`, `(*contract.Content).Handler`.
- Produces: `func (e *Extension) RegisterContractContributor(disp *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry) error`; config keys `dashboard_content_path`, `dashboard_max_upload_bytes`, `dashboard_content_secret`; `func buildDashboardContent(cfg Config) (*trovecontract.Content, error)`.

- [ ] **Step 1: Write the failing tests**

Create `extension/contract/bindings_test.go`:

```go
package contract

import (
	"sort"
	"testing"
)

// Every intent the manifest declares must have a handler. Register checks
// the other direction; this closes the loop, so a declared intent can never
// answer "no handler" in production.
func TestEveryDeclaredIntentIsBound(t *testing.T) {
	bound := map[string]bool{}
	for _, b := range bindings(testDeps(t, newStores(openMem(t)))) {
		if bound[b.intent] {
			t.Errorf("%s is bound twice", b.intent)
		}
		bound[b.intent] = true
	}
	var missing []string
	for _, in := range loadManifest(t).Intents {
		if !bound[in.Name] {
			missing = append(missing, in.Name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("declared but not bound: %v", missing)
	}
}
```

Create `extension/contract/transport_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"
)

// TestCommandInvalidatesReachTheClient sends real commands through forge's
// HTTP transport and checks the response carries the manifest's
// invalidates. The React shell refreshes through that and nothing else;
// forge v1.10.0 dropped it.
func TestCommandInvalidatesReachTheClient(t *testing.T) {
	tests := []struct {
		intent  string
		payload string
	}{
		{"buckets.create", `{"name":"fresh"}`},
		{"objects.delete", `{"bucket":"data","key":"a.txt"}`},
		{"objects.completeUpload", `{"bucket":"data","key":"b.txt"}`},
	}
	for _, tt := range tests {
		t.Run(tt.intent, func(t *testing.T) {
			tv := openMem(t)
			mustBucket(t, tv, "data")
			put(t, tv, "data", "a.txt", "x")
			put(t, tv, "data", "b.txt", "y")

			reg := dashcontract.NewRegistry()
			wreg := dashcontract.NewWardenRegistry()
			d := dispatcher.New(nil)
			if err := Register(d, reg, wreg, testDeps(t, newStores(tv))); err != nil {
				t.Fatalf("Register: %v", err)
			}
			var want []string
			for _, in := range loadManifest(t).Intents {
				if in.Name == tt.intent {
					want = in.Invalidates
				}
			}

			body := `{"envelope":"v1","kind":"command","contributor":"trove","intent":"` + tt.intent + `",` +
				`"csrf":"test","idempotencyKey":"test-` + tt.intent + `","payload":` + tt.payload + `}`
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(body))
			rec := httptest.NewRecorder()
			transport.NewHandler(reg, wreg, d, nil).ServeHTTP(rec, req)

			var resp dashcontract.Response
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode: %v (%s)", err, rec.Body)
			}
			if !resp.OK {
				t.Fatalf("%s failed: %s", tt.intent, rec.Body)
			}
			if !reflect.DeepEqual(resp.Meta.Invalidates, want) {
				t.Fatalf("meta.invalidates = %v, want %v", resp.Meta.Invalidates, want)
			}
		})
	}
}
```

Create `extension/dashboard_aware_test.go`:

```go
package extension

import (
	dashboard "github.com/xraph/forge/extensions/dashboard"
)

// The dashboard finds contract contributors by type assertion at runtime,
// so production code never imports forge's dashboard root. This keeps the
// method checked against the real interface anyway.
var _ dashboard.ContractContributorAware = (*Extension)(nil)
```

Create `extension/dashboard_contract_test.go`:

```go
package extension

import (
	"strings"
	"testing"
)

func TestBuildDashboardContent_Defaults(t *testing.T) {
	cfg := DefaultConfig()
	c, err := buildDashboardContent(cfg)
	if err != nil {
		t.Fatalf("buildDashboardContent: %v", err)
	}
	if c.Path != "/dashboard/trove/content" || c.MaxUploadBytes != 64<<20 || !c.PerProcessSecret || c.Signer == nil {
		t.Fatalf("content = %+v", c)
	}
}

func TestBuildDashboardContent_ConfiguredSecret(t *testing.T) {
	cfg := DefaultConfig()
	cfg.DashboardContentSecret = strings.Repeat("s", 32)
	c, err := buildDashboardContent(cfg)
	if err != nil || c.PerProcessSecret {
		t.Fatalf("content = %+v, %v", c, err)
	}
}

func TestConfigValidate_DashboardContent(t *testing.T) {
	bad := []func(*Config){
		func(c *Config) { c.DashboardContentSecret = "short" },
		func(c *Config) { c.DashboardMaxUploadBytes = -1 },
		func(c *Config) { c.DashboardContentPath = "dashboard/no-slash" },
	}
	for i, mutate := range bad {
		cfg := DefaultConfig()
		mutate(&cfg)
		if err := cfg.Validate(); err == nil {
			t.Errorf("case %d: Validate accepted it", i)
		}
	}
	cfg := DefaultConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("defaults do not validate: %v", err)
	}
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go test ./contract/ . 2>&1 | tail -20`
Expected: `TestEveryDeclaredIntentIsBound` passes already if Tasks 3 to 7 bound all 20 (it is here to keep it that way; if it fails, a task missed one: bind it). The extension package fails to compile (`buildDashboardContent`, `DashboardContentSecret`, `RegisterContractContributor` undefined). `TestCommandInvalidatesReachTheClient` should pass already.

- [ ] **Step 3: Add the config keys**

In `extension/config.go`, add to `Config` after `Default`:

```go
	// DashboardContentPath is where the dashboard's content route mounts.
	// It sits under the dashboard's own base path so the proxy that
	// forwards the dashboard forwards this too.
	DashboardContentPath string `json:"dashboard_content_path" yaml:"dashboard_content_path" mapstructure:"dashboard_content_path"`

	// DashboardMaxUploadBytes is the largest upload the dashboard accepts.
	// Every Trove middleware buffers a whole object in memory, which is why
	// the default is 64 MiB.
	DashboardMaxUploadBytes int64 `json:"dashboard_max_upload_bytes" yaml:"dashboard_max_upload_bytes" mapstructure:"dashboard_max_upload_bytes"`

	// DashboardContentSecret signs content tickets, at least 32 bytes. When
	// empty, a random key is generated at start, which works only while
	// every request reaches the same instance.
	DashboardContentSecret string `json:"dashboard_content_secret" yaml:"dashboard_content_secret" mapstructure:"dashboard_content_secret"`
```

In `DefaultConfig`:

```go
	return Config{
		BasePath:                "/trove",
		DefaultBucket:           "default",
		DashboardContentPath:    "/dashboard/trove/content",
		DashboardMaxUploadBytes: 64 << 20,
	}
```

At the end of `Validate`, before `return nil`:

```go
	if c.DashboardContentSecret != "" && len(c.DashboardContentSecret) < 32 {
		return fmt.Errorf("trove: dashboard_content_secret must be at least 32 bytes")
	}
	if c.DashboardMaxUploadBytes < 0 {
		return fmt.Errorf("trove: dashboard_max_upload_bytes cannot be negative")
	}
	if c.DashboardContentPath != "" && !strings.HasPrefix(c.DashboardContentPath, "/") {
		return fmt.Errorf("trove: dashboard_content_path must start with /")
	}
```

Add `"strings"` to `config.go`'s imports. In `extension.go`, `mergeWithDefaults` must fill the two new defaults when they are zero:

```go
	if cfg.DashboardContentPath == "" {
		cfg.DashboardContentPath = defaults.DashboardContentPath
	}
	if cfg.DashboardMaxUploadBytes == 0 {
		cfg.DashboardMaxUploadBytes = defaults.DashboardMaxUploadBytes
	}
```

and `mergeConfigurations` must let programmatic values fill YAML gaps for the three keys, the same way it does for `BasePath`:

```go
	if yamlConfig.DashboardContentPath == "" && programmaticConfig.DashboardContentPath != "" {
		yamlConfig.DashboardContentPath = programmaticConfig.DashboardContentPath
	}
	if yamlConfig.DashboardMaxUploadBytes == 0 && programmaticConfig.DashboardMaxUploadBytes != 0 {
		yamlConfig.DashboardMaxUploadBytes = programmaticConfig.DashboardMaxUploadBytes
	}
	if yamlConfig.DashboardContentSecret == "" && programmaticConfig.DashboardContentSecret != "" {
		yamlConfig.DashboardContentSecret = programmaticConfig.DashboardContentSecret
	}
```

- [ ] **Step 4: Write `dashboard_contract.go`**

```go
package extension

import (
	"fmt"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/forge"

	trovecontract "github.com/xraph/trove/extension/contract"
)

// buildDashboardContent builds the content service from config: the ticket
// signer, the route path and the upload cap.
func buildDashboardContent(cfg Config) (*trovecontract.Content, error) {
	c := &trovecontract.Content{Path: cfg.DashboardContentPath, MaxUploadBytes: cfg.DashboardMaxUploadBytes}
	if cfg.DashboardContentSecret != "" {
		s, err := trovecontract.NewSigner([]byte(cfg.DashboardContentSecret))
		if err != nil {
			return nil, err
		}
		c.Signer = s
		return c, nil
	}
	s, err := trovecontract.NewRandomSigner()
	if err != nil {
		return nil, err
	}
	c.Signer, c.PerProcessSecret = s, true
	return c, nil
}

// setupDashboard builds the store resolver and the content service, and
// mounts the content route. It runs at the end of Register, once every
// store is open.
func (e *Extension) setupDashboard(fapp forge.App, stores *trovecontract.Stores) error {
	content, err := buildDashboardContent(e.config)
	if err != nil {
		return fmt.Errorf("trove: dashboard content: %w", err)
	}
	e.dashStores, e.dashContent = stores, content
	if content.PerProcessSecret && e.Logger() != nil {
		e.Logger().Warn("trove: dashboard_content_secret is not set; content links work only while every request reaches this instance")
	}
	if router := fapp.Router(); router != nil {
		if err := router.Handle(content.Path, content.Handler(stores, e.Logger())); err != nil {
			return fmt.Errorf("trove: mount dashboard content route at %s: %w", content.Path, err)
		}
	}
	return nil
}

// RegisterContractContributor registers the trove contract contributor,
// which is what the React dashboard reads.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.dashStores == nil || e.dashContent == nil {
		if logger := e.Logger(); logger != nil {
			logger.Warn("trove: not initialised; skipping contract contributor registration")
		}
		return nil
	}
	deps := trovecontract.Deps{Stores: e.dashStores, Content: e.dashContent}
	if logger := e.Logger(); logger != nil {
		deps.Logger = logger
	}
	if err := trovecontract.Register(disp, reg, wreg, deps); err != nil {
		return fmt.Errorf("trove: register contract contributor: %w", err)
	}
	return nil
}
```

If `forge.Logger` has no `Warn`, use `Info`. Check `e.Logger()` can be nil before `Register` (it can; guard it as above).

- [ ] **Step 5: Call `setupDashboard` from both registration paths**

In `extension.go`, add two fields to `Extension`:

```go
	// Dashboard contract state, built at the end of Register.
	dashStores  *trovecontract.Stores
	dashContent *trovecontract.Content
```

and import `trovecontract "github.com/xraph/trove/extension/contract"`.

In `registerSingleStore`, after `e.Init(fapp)` succeeds and before `vessel.Provide`:

```go
	if err := e.setupDashboard(fapp, trovecontract.NewSingleStore(e.t, trovecontract.Flags{
		Encryption:  e.config.EnableEncryption,
		Compression: e.config.EnableCompression,
		CAS:         e.config.EnableCAS,
	})); err != nil {
		return err
	}
```

In `registerMultiStore`, keep a `[]trovecontract.Store` while opening stores: inside the loop, after `mgr.Add(entry.name, t, metaStore)`, append

```go
		dashStores = append(dashStores, trovecontract.Store{
			Name:  entry.name,
			Trove: t,
			Configured: trovecontract.Flags{
				Encryption:  entry.enableEncrypt,
				Compression: entry.enableCompress,
				CAS:         entry.enableCAS,
			},
		})
```

(declare `var dashStores []trovecontract.Store` before the loop). After `defaultName` is resolved and `mgr.SetDefault` succeeds:

```go
	resolver, err := trovecontract.NewStores(defaultName, dashStores)
	if err != nil {
		return fmt.Errorf("trove: dashboard stores: %w", err)
	}
	if err := e.setupDashboard(fapp, resolver); err != nil {
		return err
	}
```

Note the existing `err` in scope; use a fresh name if the compiler complains about shadowing (`dashErr`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /Users/rexraphael/Work/xraph/forgery/trove/extension && go build ./... && go vet ./... && go test ./...`
Expected: PASS across the extension module, the templ dashboard included.

Then confirm production code does not import the dashboard root:

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
go list -deps . | grep -x 'github.com/xraph/forge/extensions/dashboard' && echo "ROOT IMPORTED" || echo "root not imported by contract path"
```

Expected at this point: the root IS still imported, by `extension.go`'s templ `DashboardContributor` and `dashboard.DashboardAware` assertion. That goes in slice 5. Confirm the new files add no import of it: `grep -n '"github.com/xraph/forge/extensions/dashboard"' extension/*.go extension/contract/*.go` lists only `extension.go` and `dashboard_aware_test.go`.

- [ ] **Step 7: Lint and commit**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
F="extension/dashboard_contract.go extension/dashboard_contract_test.go extension/dashboard_aware_test.go extension/contract/transport_test.go extension/contract/bindings_test.go"
git add $F
git commit --only -m "feat(extension): register the trove contract and mount the content route" -- $F extension/config.go extension/extension.go
git show --stat HEAD
```

Body: the extension builds the store resolver and the ticket signer in Register, mounts the content route there, and registers the contract when the dashboard asks. Three config keys set the route, the upload cap and the ticket secret, and without a secret the content links work only on the instance that minted them.

---

### Task 9: Verify the slice and record what it found

**Files:** the spec in forge-dashboard (`docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md`).

- [ ] **Step 1: Build, vet, test and lint every module this slice touched**

```bash
cd /Users/rexraphael/Work/xraph/forgery/trove/extension
go build ./... && go vet ./... && go test -race -count=1 ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
cd /Users/rexraphael/Work/xraph/forgery/trove
go build ./... && go test -count=1 ./...
git status --short && git log --oneline -9
```
Expected: every command passes. Lint issues only in lines this slice did not touch. `git status` shows none of your changes uncommitted.

- [ ] **Step 2: Exercise the contract over HTTP once**

The playbook asks for every intent to be walked over HTTP. Write a throwaway program in the session's scratchpad (NOT in either repo) that builds a memdriver Trove with CAS, registers the contract with `transport.NewHandler`, and POSTs each of the 20 intents with a minimal valid payload, printing `ok` or the error code. Every intent must answer a well-formed envelope; `NOT_FOUND` for a deliberately missing object is fine, a panic or a transport error is not. Paste the table into your report.

- [ ] **Step 3: Record what slice 2 found for slice 3**

Append `## What slice 2 found that slice 3 must know` to the spec: the exact wire shapes that differ from the spec's tables (field names you had to choose, the empty-invalidates outcome from Task 2 Step 9, `ErrContentBlocked` carrying no threat name so the page cannot show one), the content route path and its status codes (403 bad or expired ticket, 404, 405, 409, 413, 422), the upload flow (begin, PUT with XHR, complete), and anything from the HTTP walk. Plain prose, "you" for the reader, no em or en dashes. Commit it from forge-dashboard with `git commit --only -m "docs: record what trove slice 2 found for slice 3" -- docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md`.
