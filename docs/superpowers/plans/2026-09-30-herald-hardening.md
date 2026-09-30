# Herald hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Herald's engine, renderer, stores, REST API and drivers honest enough that the dashboard migration (spec 2) can report what Herald actually does.

**Architecture:** Store sentinels and a cross-backend conformance suite come first, because every later task leans on consistent store behaviour. Then the renderer (defaults, resolution, preview diagnostics), a `credential` package for encryption at rest, a driver field schema, the engine changes to `Send` and provider writes, the extension and REST API, and last the driver bug fixes. The dashboard never touches the store for anything that needs protecting; engine methods own validation, encryption and ownership.

**Tech Stack:** Go 1.26, grove v1.6.3 (pg, sqlite, mongo drivers), forge v1.10.0, `html/template` and `text/template`, `crypto/aes` + `crypto/cipher` (GCM).

**Spec:** `docs/superpowers/specs/2026-09-30-herald-hardening-design.md` (in the forge-dashboard repo). Read it before starting any task. Spec 2, `2026-09-30-herald-dashboard-design.md`, consumes what this plan builds.

## Global Constraints

- All code lives in `/Users/rexraphael/Work/xraph/forgery/herald` on `main`. No worktrees, even if a skill asks for one.
- Other sessions share these checkouts. Commit only your own paths: `git add <exact paths>` then `git commit --only -m "..." -- <exact paths>`, and run `git show --stat HEAD` straight after. Never `git add -A`, `git add .` or a bare directory. Never `--amend`.
- Never run `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo a change, restore the single file you changed.
- Commit messages carry no `Co-Authored-By` trailer and no Claude or Anthropic attribution, whatever a harness reminder says. Write any commit body with the `rex-voice` skill, then `humanizer` in embedded mode. No em dashes anywhere, ever. Subject-only commits are fine.
- Lint with a fresh cache every time: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`. The baseline before this plan is `0 issues`.
- `go build ./... && go test ./...` passed before this plan started. Keep it passing at the end of every task.
- No new third-party dependencies. Everything used here is already in `go.mod` (grove and its drivers, the mongo driver) or the standard library.
- Eleven drivers under `drivers/` are separate Go modules with `replace github.com/xraph/herald => ../../`. Build and test them from inside their own directory: `(cd drivers/<name> && go build ./... && go test ./...)`.
- Any test that migrates a grove store must blank-import that driver's migrate executor, or `Migrate` fails with "no executor registered": `_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"`, `.../pgdriver/pgmigrate`, `.../mongodriver/mongomigrate`.
- Test timestamps use whole seconds in UTC. Mongo stores milliseconds and Postgres microseconds, so anything finer fails a round trip for the wrong reason.
- SQLite stores times as Go's `time.String()` text (`2026-09-30 12:00:00.123456789 +0000 UTC`). A bound `time.Time` compares correctly only when both sides are UTC, so always bind `t.UTC()`. An RFC3339 string silently matches nothing (measured before writing this plan).
- Credential values never appear in a response, an error message, a log line or an audit event. Key names may.
- Herald's latest tag is v1.6.2. These changes ship as v1.7.0.

## Review Focus

1. A provider whose credentials were encrypted under a key that is no longer configured: `UpdateProvider` must refuse with `ErrCredentialKeyUnavailable` and leave the stored row untouched, never write a half-decrypted map. Test in Task 12.
2. A template line containing non-ASCII text before an error: the diagnostic column must count characters, not bytes. Test in Task 7.
3. An empty app ID must match only rows stored with `app_id = ''` on every backend, never every app. Test in Task 2, pinned per backend.
4. `SendRequest.ProviderID` naming a provider in another app must fail with `ErrProviderNotFound` and send nothing. Test in Task 11.
5. A REST `PUT /v1/providers/:id` that leaves out `enabled` must leave the provider enabled. Test in Task 14.

---

## File map

Created:
- `store/errors.go`: shared sentinels every backend returns.
- `store/storetest/storetest.go`, `fixtures.go`, `notfound.go`, `roundtrip.go`, `listing.go`, `delivery.go`, `upsert.go`: the conformance suite.
- `store/memory/clone.go`, `store/memory/store_test.go`, `store/sqlite/store_test.go`, `store/postgres/store_test.go`, `store/mongo/store_test.go`.
- `template/resolve.go`, `template/preview.go`, `template/diagnostics.go`, `template/renderer_test.go`, `template/preview_test.go`.
- `credential/credential.go`, `credential/credential_test.go`.
- `driver/fields.go`, `driver/fields_test.go`, plus `fields.go` in each driver package and a test in each.
- `providers.go`, `providers_test.go`, `send_test.go` in the root package.
- `extension/mount.go`, `extension/mount_test.go`, `extension/credentials.go`, `extension/credentials_test.go`.
- `api/responses.go`, `api/errors.go`, `api/ownership.go`, `api/api_test.go`.
- `CHANGELOG.md`.

Modified: `errors.go`, `herald.go`, `options.go`, `message/message.go`, `message/store.go`, all four `store/*/store.go`, `store/postgres/models.go`, `store/sqlite/models.go`, `store/mongo/models.go`, both SQL `migrations.go`, `template/renderer.go`, `scope/resolver.go`, `driver/driver.go`, `extension/extension.go`, `extension/config.go`, `extension/options.go`, `api/api.go`, the five changed drivers, and `docs/content/docs/subsystems/providers.mdx`.

---

### Task 1: Store sentinels, not-found and duplicate parity

Every backend reports "not found" differently today: memory with an ad-hoc error type, SQL and Mongo with `fmt.Errorf` strings, and `GetPreference` / `GetScopedConfig` with `nil, nil` everywhere except memory. `ErrDuplicateSlug` and `ErrDuplicateLocale` exist and are never returned. This task makes every backend return the same sentinels and starts the conformance suite that proves it.

The sentinels live in `store`, not the root package, because `seed_providers_test.go` is `package herald` and imports `store/memory`; if memory imported the root package that test would be an import cycle. The root package aliases them so `errors.Is(err, herald.ErrProviderNotFound)` keeps working.

**Files:**
- Create: `store/errors.go`
- Create: `store/storetest/storetest.go`, `store/storetest/fixtures.go`, `store/storetest/notfound.go`
- Create: `store/memory/store_test.go`, `store/sqlite/store_test.go`
- Modify: `errors.go`
- Modify: `store/memory/store.go`, `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`
- Modify: `api/api.go` (`getPreferences` only)

**Interfaces:**
- Produces: `store.ErrProviderNotFound`, `store.ErrTemplateNotFound`, `store.ErrVersionNotFound`, `store.ErrMessageNotFound`, `store.ErrNotificationNotFound`, `store.ErrPreferenceNotFound`, `store.ErrScopedConfigNotFound`, `store.ErrDuplicateSlug`, `store.ErrDuplicateLocale`; root aliases of each plus the new `herald.ErrVersionNotFound`; `storetest.Run(t *testing.T, open storetest.Opener)` with `type Opener func(t *testing.T) store.Store`; fixtures `storetest.Base`, `newProvider`, `newTemplate`, `newVersion`, `newMessage`, `newNotification` (unexported, used by later suite files).

- [ ] **Step 1: Create the sentinels**

`store/errors.go`:

```go
package store

import "errors"

// Sentinel errors every Store implementation returns. The root herald package
// re-exports them, so callers can match either name with errors.Is.
var (
	ErrProviderNotFound     = errors.New("herald: provider not found")
	ErrTemplateNotFound     = errors.New("herald: template not found")
	ErrVersionNotFound      = errors.New("herald: template version not found")
	ErrMessageNotFound      = errors.New("herald: message not found")
	ErrNotificationNotFound = errors.New("herald: in-app notification not found")
	ErrPreferenceNotFound   = errors.New("herald: user preference not found")
	ErrScopedConfigNotFound = errors.New("herald: scoped config not found")

	// ErrDuplicateSlug is returned when (app, slug, channel) already exists.
	ErrDuplicateSlug = errors.New("herald: duplicate template slug")
	// ErrDuplicateLocale is returned when (template, locale) already exists.
	ErrDuplicateLocale = errors.New("herald: duplicate locale version")
)
```

- [ ] **Step 2: Alias them from the root package**

In `errors.go`, change the import to `import ("errors"; "github.com/xraph/herald/store")` and replace these seven declarations inside the `var (...)` block:

```go
	// ErrProviderNotFound is returned when a provider cannot be found.
	ErrProviderNotFound = store.ErrProviderNotFound

	// ErrTemplateNotFound is returned when a template cannot be found.
	ErrTemplateNotFound = store.ErrTemplateNotFound

	// ErrVersionNotFound is returned when a template version cannot be found.
	ErrVersionNotFound = store.ErrVersionNotFound

	// ErrMessageNotFound is returned when a message cannot be found.
	ErrMessageNotFound = store.ErrMessageNotFound

	// ErrInboxNotFound is returned when an in-app notification cannot be found.
	ErrInboxNotFound = store.ErrNotificationNotFound

	// ErrPreferenceNotFound is returned when user preferences cannot be found.
	ErrPreferenceNotFound = store.ErrPreferenceNotFound

	// ErrScopedConfigNotFound is returned when no scoped config is found.
	ErrScopedConfigNotFound = store.ErrScopedConfigNotFound
```

and the two duplicate errors at the bottom of the block:

```go
	// ErrDuplicateSlug is returned when a template slug+channel+app combination already exists.
	ErrDuplicateSlug = store.ErrDuplicateSlug

	// ErrDuplicateLocale is returned when a template version for the same locale already exists.
	ErrDuplicateLocale = store.ErrDuplicateLocale
```

`ErrVersionNotFound` is new; add it after `ErrTemplateNotFound`. Leave every other error as it is.

- [ ] **Step 3: Write the suite skeleton and fixtures**

`store/storetest/storetest.go`:

```go
// Package storetest is the conformance suite every herald store backend runs.
//
// Each backend's own test file calls Run with a function that opens a fresh,
// empty, migrated store. The suite populates every map and JSON field on
// purpose: a suite that only builds empty structs tests the absence of those
// fields, which is how serialization bugs survive on one backend and not
// another.
package storetest

import (
	"testing"

	"github.com/xraph/herald/store"
)

// Opener returns a fresh, empty, migrated store. It is called once per
// subtest, so subtests never see each other's rows.
type Opener func(t *testing.T) store.Store

// Run executes every conformance check against the backend open returns.
func Run(t *testing.T, open Opener) {
	t.Helper()
	t.Run("NotFound", func(t *testing.T) { testNotFound(t, open(t)) })
	t.Run("Duplicates", func(t *testing.T) { testDuplicates(t, open(t)) })
}
```

`store/storetest/fixtures.go`:

```go
package storetest

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/inbox"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/template"
)

// Base is the reference instant for fixtures. Whole seconds in UTC, because
// Mongo keeps milliseconds and Postgres microseconds.
var Base = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

var ctx = context.Background()

func newProvider(appID, name, channel string, priority int, created time.Time) *provider.Provider {
	return &provider.Provider{
		ID:          id.NewProviderID(),
		AppID:       appID,
		Name:        name,
		Channel:     channel,
		Driver:      "smtp",
		Credentials: map[string]string{"password": "pw-" + name, "username": "user-" + name},
		Settings:    map[string]string{"host": "smtp.example.com", "port": "587"},
		Priority:    priority,
		Enabled:     true,
		CreatedAt:   created,
		UpdatedAt:   created,
	}
}

func newTemplate(appID, slug, channel string, created time.Time) *template.Template {
	return &template.Template{
		ID:       id.NewTemplateID(),
		AppID:    appID,
		Slug:     slug,
		Name:     "Template " + slug,
		Channel:  channel,
		Category: template.CategoryTransactional,
		Variables: []template.Variable{
			{Name: "user_name", Type: "string", Required: true, Description: "who it is for"},
			{Name: "expires_in", Type: "string", Default: "1 hour"},
		},
		Enabled:   true,
		CreatedAt: created,
		UpdatedAt: created,
	}
}

func newVersion(templateID id.TemplateID, locale string) *template.Version {
	return &template.Version{
		ID:         id.NewTemplateVersionID(),
		TemplateID: templateID,
		Locale:     locale,
		Subject:    "Hello {{.user_name}}",
		HTML:       "<p>Hello {{.user_name}}</p>",
		Text:       "Hello {{.user_name}}",
		Title:      "Hi",
		Active:     true,
		CreatedAt:  Base,
		UpdatedAt:  Base,
	}
}

func newMessage(appID, channel string, status message.Status, created time.Time) *message.Message {
	return &message.Message{
		ID:         id.NewMessageID(),
		AppID:      appID,
		EnvID:      "env_1",
		TemplateID: "auth.welcome",
		ProviderID: "hpvd_fixture",
		Channel:    channel,
		Recipient:  "ada@example.com",
		Subject:    "Welcome",
		Body:       "Hello Ada",
		Status:     status,
		Metadata:   map[string]string{"trace": "t-1", "source": "suite"},
		Attempts:   1,
		CreatedAt:  created,
	}
}

func newNotification(appID, userID string, created time.Time) *inbox.Notification {
	return &inbox.Notification{
		ID:        id.NewInboxID(),
		AppID:     appID,
		UserID:    userID,
		Type:      "auth.welcome",
		Title:     "Welcome",
		Body:      "Hello",
		ActionURL: "https://example.com/a",
		Metadata:  map[string]string{"k": "v"},
		CreatedAt: created,
	}
}

func must(t *testing.T, what string, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", what, err)
	}
}

func expectIs(t *testing.T, what string, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Errorf("%s: got error %v, want errors.Is(%v)", what, err, want)
	}
}
```

- [ ] **Step 4: Write the failing not-found and duplicate checks**

`store/storetest/notfound.go`:

```go
package storetest

import (
	"testing"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
)

func testNotFound(t *testing.T, s store.Store) {
	_, err := s.GetProvider(ctx, id.NewProviderID())
	expectIs(t, "GetProvider", err, store.ErrProviderNotFound)
	expectIs(t, "UpdateProvider", s.UpdateProvider(ctx, newProvider("a", "ghost", "email", 0, Base)), store.ErrProviderNotFound)
	expectIs(t, "DeleteProvider", s.DeleteProvider(ctx, id.NewProviderID()), store.ErrProviderNotFound)

	_, err = s.GetTemplate(ctx, id.NewTemplateID())
	expectIs(t, "GetTemplate", err, store.ErrTemplateNotFound)
	_, err = s.GetTemplateBySlug(ctx, "a", "nope", "email")
	expectIs(t, "GetTemplateBySlug", err, store.ErrTemplateNotFound)
	expectIs(t, "UpdateTemplate", s.UpdateTemplate(ctx, newTemplate("a", "ghost", "email", Base)), store.ErrTemplateNotFound)
	expectIs(t, "DeleteTemplate", s.DeleteTemplate(ctx, id.NewTemplateID()), store.ErrTemplateNotFound)

	_, err = s.GetVersion(ctx, id.NewTemplateVersionID())
	expectIs(t, "GetVersion", err, store.ErrVersionNotFound)
	expectIs(t, "UpdateVersion", s.UpdateVersion(ctx, newVersion(id.NewTemplateID(), "en")), store.ErrVersionNotFound)
	expectIs(t, "DeleteVersion", s.DeleteVersion(ctx, id.NewTemplateVersionID()), store.ErrVersionNotFound)

	_, err = s.GetMessage(ctx, id.NewMessageID())
	expectIs(t, "GetMessage", err, store.ErrMessageNotFound)
	expectIs(t, "UpdateMessageStatus", s.UpdateMessageStatus(ctx, id.NewMessageID(), message.StatusSent, ""), store.ErrMessageNotFound)

	_, err = s.GetNotification(ctx, id.NewInboxID())
	expectIs(t, "GetNotification", err, store.ErrNotificationNotFound)
	expectIs(t, "DeleteNotification", s.DeleteNotification(ctx, id.NewInboxID()), store.ErrNotificationNotFound)
	expectIs(t, "MarkRead", s.MarkRead(ctx, id.NewInboxID()), store.ErrNotificationNotFound)

	_, err = s.GetPreference(ctx, "a", "nobody")
	expectIs(t, "GetPreference", err, store.ErrPreferenceNotFound)
	// Deleting a preference that isn't there is not an error on any backend.
	// Recorded as a fact, so a backend that starts refusing it shows up here.
	if err := s.DeletePreference(ctx, "a", "nobody"); err != nil {
		t.Errorf("DeletePreference of a missing row: got %v, want nil", err)
	}

	_, err = s.GetScopedConfig(ctx, "a", scope.ScopeApp, "a")
	expectIs(t, "GetScopedConfig", err, store.ErrScopedConfigNotFound)
	expectIs(t, "DeleteScopedConfig", s.DeleteScopedConfig(ctx, id.NewScopedConfigID()), store.ErrScopedConfigNotFound)
}

func testDuplicates(t *testing.T, s store.Store) {
	welcome := newTemplate("app_a", "welcome", "email", Base)
	must(t, "create welcome", s.CreateTemplate(ctx, welcome))

	expectIs(t, "same app, slug and channel",
		s.CreateTemplate(ctx, newTemplate("app_a", "welcome", "email", Base)), store.ErrDuplicateSlug)
	must(t, "same slug on another channel", s.CreateTemplate(ctx, newTemplate("app_a", "welcome", "sms", Base)))
	must(t, "same slug in another app", s.CreateTemplate(ctx, newTemplate("app_b", "welcome", "email", Base)))

	other := newTemplate("app_a", "other", "email", Base)
	must(t, "create other", s.CreateTemplate(ctx, other))
	other.Slug = "welcome"
	expectIs(t, "renaming onto a taken slug", s.UpdateTemplate(ctx, other), store.ErrDuplicateSlug)

	must(t, "create en", s.CreateVersion(ctx, newVersion(welcome.ID, "en")))
	expectIs(t, "second en version", s.CreateVersion(ctx, newVersion(welcome.ID, "en")), store.ErrDuplicateLocale)

	fr := newVersion(welcome.ID, "fr")
	must(t, "create fr", s.CreateVersion(ctx, fr))
	fr.Locale = "en"
	expectIs(t, "moving fr onto en", s.UpdateVersion(ctx, fr), store.ErrDuplicateLocale)
}
```

- [ ] **Step 5: Add the memory and SQLite runners**

`store/memory/store_test.go`:

```go
package memory_test

import (
	"testing"

	"github.com/xraph/herald/store"
	"github.com/xraph/herald/store/memory"
	"github.com/xraph/herald/store/storetest"
)

func TestConformance(t *testing.T) {
	storetest.Run(t, func(*testing.T) store.Store { return memory.New() })
}
```

`store/sqlite/store_test.go`:

```go
package sqlite_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate"

	"github.com/xraph/herald/store"
	sqlitestore "github.com/xraph/herald/store/sqlite"
	"github.com/xraph/herald/store/storetest"
)

func TestConformance(t *testing.T) {
	storetest.Run(t, openSQLite)
}

func openSQLite(t *testing.T) store.Store {
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
	return s
}
```

- [ ] **Step 6: Run the suite and watch it fail**

Run: `go test ./store/... -run TestConformance -v 2>&1 | grep -E "^(=== RUN|--- FAIL|    )" | head -60`
Expected: FAIL on both backends. Memory fails every "not found" case with its own error type, never fails `UpdateProvider` / `DeleteProvider` / `UpdateTemplate` / `DeleteVersion` on a missing row, and accepts duplicates. SQLite fails the not-found cases with `fmt.Errorf` strings, returns `nil` for `GetPreference` and `GetScopedConfig`, and returns raw `UNIQUE constraint failed` errors.

- [ ] **Step 7: Fix the memory store**

In `store/memory/store.go`, delete the `notFoundError` type and `errNotFound` at the bottom, and replace every `errNotFound("provider")` with `store.ErrProviderNotFound`, `errNotFound("template")` with `store.ErrTemplateNotFound`, `errNotFound("template version")` with `store.ErrVersionNotFound`, `errNotFound("message")` with `store.ErrMessageNotFound`, `errNotFound("notification")` with `store.ErrNotificationNotFound`, `errNotFound("preference")` with `store.ErrPreferenceNotFound` and `errNotFound("scoped config")` with `store.ErrScopedConfigNotFound`.

Then make updates and deletes of missing rows report it, and enforce the two unique keys. Replace these methods:

```go
func (s *Store) CreateTemplate(_ context.Context, t *template.Template) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.slugTaken(t) {
		return store.ErrDuplicateSlug
	}
	s.templates[t.ID.String()] = t
	return nil
}

func (s *Store) UpdateTemplate(_ context.Context, t *template.Template) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.templates[t.ID.String()]; !ok {
		return store.ErrTemplateNotFound
	}
	if s.slugTaken(t) {
		return store.ErrDuplicateSlug
	}
	s.templates[t.ID.String()] = t
	return nil
}

func (s *Store) DeleteTemplate(_ context.Context, templateID id.TemplateID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.templates[templateID.String()]; !ok {
		return store.ErrTemplateNotFound
	}
	delete(s.templates, templateID.String())
	for k, v := range s.versions {
		if v.TemplateID.String() == templateID.String() {
			delete(s.versions, k)
		}
	}
	return nil
}

// slugTaken reports whether another template already holds t's (app, slug,
// channel), the key SQL and Mongo enforce with a unique index.
func (s *Store) slugTaken(t *template.Template) bool {
	for _, o := range s.templates {
		if o.ID.String() != t.ID.String() && o.AppID == t.AppID && o.Slug == t.Slug && o.Channel == t.Channel {
			return true
		}
	}
	return false
}

func (s *Store) CreateVersion(_ context.Context, v *template.Version) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.localeTaken(v) {
		return store.ErrDuplicateLocale
	}
	s.versions[v.ID.String()] = v
	return nil
}

func (s *Store) UpdateVersion(_ context.Context, v *template.Version) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.versions[v.ID.String()]; !ok {
		return store.ErrVersionNotFound
	}
	if s.localeTaken(v) {
		return store.ErrDuplicateLocale
	}
	s.versions[v.ID.String()] = v
	return nil
}

func (s *Store) DeleteVersion(_ context.Context, versionID id.TemplateVersionID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.versions[versionID.String()]; !ok {
		return store.ErrVersionNotFound
	}
	delete(s.versions, versionID.String())
	return nil
}

// localeTaken reports whether another version of the same template already
// holds v's locale.
func (s *Store) localeTaken(v *template.Version) bool {
	for _, o := range s.versions {
		if o.ID.String() != v.ID.String() && o.TemplateID.String() == v.TemplateID.String() && o.Locale == v.Locale {
			return true
		}
	}
	return false
}

func (s *Store) UpdateProvider(_ context.Context, p *provider.Provider) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.providers[p.ID.String()]; !ok {
		return store.ErrProviderNotFound
	}
	s.providers[p.ID.String()] = p
	return nil
}

func (s *Store) DeleteProvider(_ context.Context, providerID id.ProviderID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.providers[providerID.String()]; !ok {
		return store.ErrProviderNotFound
	}
	delete(s.providers, providerID.String())
	return nil
}

func (s *Store) DeleteNotification(_ context.Context, notifID id.InboxID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.notifications[notifID.String()]; !ok {
		return store.ErrNotificationNotFound
	}
	delete(s.notifications, notifID.String())
	return nil
}

func (s *Store) DeleteScopedConfig(_ context.Context, configID id.ScopedConfigID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for k, v := range s.scopedConfigs {
		if v.ID.String() == configID.String() {
			delete(s.scopedConfigs, k)
			return nil
		}
	}
	return store.ErrScopedConfigNotFound
}
```

The `DeleteTemplate` loop previously compared `v.TemplateID == templateID`; comparing strings is the safe form for a struct wrapping a typeid.

- [ ] **Step 8: Fix the SQL and Mongo stores**

Apply the same string-to-sentinel mapping in all three files:

```bash
for f in store/postgres/store.go store/sqlite/store.go store/mongo/store.go; do
  sed -i '' \
    -e 's/fmt.Errorf("herald: provider not found")/store.ErrProviderNotFound/' \
    -e 's/fmt.Errorf("herald: template version not found")/store.ErrVersionNotFound/' \
    -e 's/fmt.Errorf("herald: template not found")/store.ErrTemplateNotFound/' \
    -e 's/fmt.Errorf("herald: message not found")/store.ErrMessageNotFound/' \
    -e 's/fmt.Errorf("herald: notification not found")/store.ErrNotificationNotFound/' \
    -e 's/fmt.Errorf("herald: scoped config not found")/store.ErrScopedConfigNotFound/' \
    -e 's#return nil, nil // no preference = use defaults#return nil, store.ErrPreferenceNotFound#' \
    -e 's#return nil, nil // no config = use parent scope#return nil, store.ErrScopedConfigNotFound#' \
    "$f"
done
grep -n 'not found")\|return nil, nil //' store/postgres/store.go store/sqlite/store.go store/mongo/store.go
```

Expected: the final `grep` prints nothing. The `template version` rule runs before `template` so the longer string is matched first.

Now translate unique violations. In `store/postgres/store.go`, add at the bottom (and `"strings"` to the imports):

```go
// isUniqueViolation reports a Postgres unique_violation. pgx formats its
// errors as "... (SQLSTATE 23505)"; matching the code in the text keeps
// pgconn out of herald's direct dependencies.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
```

In `store/sqlite/store.go`, add (and `"strings"`):

```go
// isUniqueViolation reports a SQLite UNIQUE constraint failure. modernc's
// message is "constraint failed: UNIQUE constraint failed: <table>.<cols>".
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
```

In both SQL stores, change `CreateTemplate` and `CreateVersion` so the insert error is checked first (Postgres shown; SQLite is identical with `s.sdb`):

```go
func (s *Store) CreateTemplate(ctx context.Context, t *template.Template) error {
	m := toTemplateModel(t)
	_, err := s.pg.NewInsert(m).Exec(ctx)
	if isUniqueViolation(err) {
		return store.ErrDuplicateSlug
	}
	return err
}

func (s *Store) CreateVersion(ctx context.Context, v *template.Version) error {
	m := toVersionModel(v)
	_, err := s.pg.NewInsert(m).Exec(ctx)
	if isUniqueViolation(err) {
		return store.ErrDuplicateLocale
	}
	return err
}
```

and in `UpdateTemplate` and `UpdateVersion`, replace the first `if err != nil { return err }` after `Exec` with:

```go
	if isUniqueViolation(err) {
		return store.ErrDuplicateSlug // ErrDuplicateLocale in UpdateVersion
	}
	if err != nil {
		return err
	}
```

In `store/mongo/store.go`, in `CreateTemplate`, `UpdateTemplate`, `CreateVersion` and `UpdateVersion`, add before the existing `if err != nil` wrap:

```go
	if mongo.IsDuplicateKeyError(err) {
		return store.ErrDuplicateSlug // ErrDuplicateLocale in the two version methods
	}
```

`go build ./...` may now report `"fmt" imported and not used` in `store/sqlite/store.go`; if it does, delete that import line.

- [ ] **Step 9: Keep the REST API's "no preference" answer the same**

`getPreferences` in `api/api.go` answered `200 null` when a user had no preference, because the SQL stores returned `nil, nil`. Keep that until Task 14:

```go
func (a *ForgeAPI) getPreferences(ctx forge.Context, req *GetPreferencesRequest) (*preference.Preference, error) {
	pref, err := a.store.GetPreference(ctx.Context(), req.AppID, req.UserID)
	if errors.Is(err, store.ErrPreferenceNotFound) {
		return nil, nil //nolint:nilnil // no preference means defaults, answered as null
	}
	if err != nil {
		return nil, mapError(err)
	}
	return pref, nil
}
```

Add `"errors"` to the imports of `api/api.go`.

- [ ] **Step 10: Run the suite, the whole module and lint**

Run: `go test ./store/... -run TestConformance -v 2>&1 | tail -20 && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: `--- PASS: TestConformance` for memory and sqlite, all packages `ok`, `0 issues`.

- [ ] **Step 11: Commit**

```bash
git add store/errors.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/notfound.go store/memory/store_test.go store/sqlite/store_test.go
git commit --only -m "fix(store): return the same not-found and duplicate sentinels from every backend" -- \
  errors.go store/errors.go store/storetest/storetest.go store/storetest/fixtures.go store/storetest/notfound.go \
  store/memory/store.go store/memory/store_test.go store/postgres/store.go store/sqlite/store.go store/sqlite/store_test.go \
  store/mongo/store.go api/api.go
git show --stat HEAD
```

---

### Task 2: Round trips, ordering, empty-app isolation and memory copies

The memory store hands out the pointers it keeps, so a caller that mutates a returned provider changes the store, and `GetTemplate` writes `Versions` onto shared state under a read lock (a data race). Its lists come back in map order, so offset paging is random. This task adds suite checks for every map and JSON field, list ordering, paging and the empty app ID, then fixes memory to match SQL.

**Files:**
- Create: `store/storetest/roundtrip.go`, `store/storetest/listing.go`, `store/memory/clone.go`
- Modify: `store/storetest/storetest.go`, `store/memory/store.go`

**Interfaces:**
- Consumes: Task 1's fixtures and sentinels.
- Produces: memory store that copies on read and write and sorts like SQL.

- [ ] **Step 1: Write the round-trip checks**

`store/storetest/roundtrip.go`:

```go
package storetest

import (
	"reflect"
	"testing"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/preference"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
)

func testRoundTrips(t *testing.T, s store.Store) {
	p := newProvider("app_a", "primary", "email", 2, Base)
	must(t, "create provider", s.CreateProvider(ctx, p))
	gotP, err := s.GetProvider(ctx, p.ID)
	must(t, "get provider", err)
	if !reflect.DeepEqual(gotP.Credentials, p.Credentials) {
		t.Errorf("provider credentials: got %v, want %v", gotP.Credentials, p.Credentials)
	}
	if !reflect.DeepEqual(gotP.Settings, p.Settings) {
		t.Errorf("provider settings: got %v, want %v", gotP.Settings, p.Settings)
	}
	if gotP.Priority != 2 || !gotP.Enabled || !gotP.CreatedAt.Equal(Base) {
		t.Errorf("provider scalars: got priority=%d enabled=%v created=%v", gotP.Priority, gotP.Enabled, gotP.CreatedAt)
	}

	tmpl := newTemplate("app_a", "welcome", "email", Base)
	must(t, "create template", s.CreateTemplate(ctx, tmpl))
	en := newVersion(tmpl.ID, "en")
	must(t, "create version", s.CreateVersion(ctx, en))
	gotT, err := s.GetTemplate(ctx, tmpl.ID)
	must(t, "get template", err)
	if !reflect.DeepEqual(gotT.Variables, tmpl.Variables) {
		t.Errorf("template variables: got %+v, want %+v", gotT.Variables, tmpl.Variables)
	}
	if len(gotT.Versions) != 1 || gotT.Versions[0].HTML != en.HTML || gotT.Versions[0].Title != en.Title || !gotT.Versions[0].Active {
		t.Errorf("template versions: got %+v", gotT.Versions)
	}

	m := newMessage("app_a", "email", "sent", Base)
	must(t, "create message", s.CreateMessage(ctx, m))
	gotM, err := s.GetMessage(ctx, m.ID)
	must(t, "get message", err)
	if !reflect.DeepEqual(gotM.Metadata, m.Metadata) || gotM.EnvID != "env_1" || gotM.Attempts != 1 {
		t.Errorf("message: got metadata=%v env=%q attempts=%d", gotM.Metadata, gotM.EnvID, gotM.Attempts)
	}

	n := newNotification("app_a", "user_1", Base)
	must(t, "create notification", s.CreateNotification(ctx, n))
	gotN, err := s.GetNotification(ctx, n.ID)
	must(t, "get notification", err)
	if !reflect.DeepEqual(gotN.Metadata, n.Metadata) || gotN.ActionURL != n.ActionURL {
		t.Errorf("notification: got metadata=%v action=%q", gotN.Metadata, gotN.ActionURL)
	}

	off, on := false, true
	pref := &preference.Preference{
		ID: id.NewPreferenceID(), AppID: "app_a", UserID: "user_1",
		Overrides: map[string]preference.ChannelPreference{
			"auth.welcome":  {Email: &off, SMS: &on},
			"billing.alert": {Push: &off},
		},
		CreatedAt: Base, UpdatedAt: Base,
	}
	must(t, "set preference", s.SetPreference(ctx, pref))
	gotPref, err := s.GetPreference(ctx, "app_a", "user_1")
	must(t, "get preference", err)
	if !gotPref.IsOptedOut("auth.welcome", "email") || gotPref.IsOptedOut("auth.welcome", "sms") ||
		!gotPref.IsOptedOut("billing.alert", "push") || gotPref.Overrides["auth.welcome"].Push != nil {
		t.Errorf("preference overrides did not survive: %+v", gotPref.Overrides)
	}

	cfg := &scope.Config{
		ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeOrg, ScopeID: "org_1",
		EmailProviderID: "hpvd_e", SMSProviderID: "hpvd_s", PushProviderID: "hpvd_p",
		WebhookProviderID: "hpvd_w", ChatProviderID: "hpvd_c",
		FromEmail: "no-reply@example.com", FromName: "Example", FromPhone: "+15550100", DefaultLocale: "fr",
		CreatedAt: Base, UpdatedAt: Base,
	}
	must(t, "set scoped config", s.SetScopedConfig(ctx, cfg))
	gotCfg, err := s.GetScopedConfig(ctx, "app_a", scope.ScopeOrg, "org_1")
	must(t, "get scoped config", err)
	for _, ch := range []string{"email", "sms", "push", "webhook", "chat"} {
		if gotCfg.ProviderIDFor(ch) != cfg.ProviderIDFor(ch) {
			t.Errorf("scoped config %s provider: got %q, want %q", ch, gotCfg.ProviderIDFor(ch), cfg.ProviderIDFor(ch))
		}
	}
	if gotCfg.FromPhone != cfg.FromPhone || gotCfg.DefaultLocale != "fr" {
		t.Errorf("scoped config from fields: got %+v", gotCfg)
	}
}

// testReadsAreCopies pins that a caller mutating what a store returned does
// not change what the store holds. SQL and Mongo get this for free; memory
// used to hand out its own pointers.
func testReadsAreCopies(t *testing.T, s store.Store) {
	p := newProvider("app_a", "primary", "email", 0, Base)
	must(t, "create provider", s.CreateProvider(ctx, p))
	p.Credentials["password"] = "changed-after-create"

	got, err := s.GetProvider(ctx, p.ID)
	must(t, "get provider", err)
	if got.Credentials["password"] != "pw-primary" {
		t.Errorf("mutating the created struct changed the store: %q", got.Credentials["password"])
	}
	got.Credentials["password"] = "changed-after-read"
	again, err := s.GetProvider(ctx, p.ID)
	must(t, "get provider again", err)
	if again.Credentials["password"] != "pw-primary" {
		t.Errorf("mutating a read changed the store: %q", again.Credentials["password"])
	}
}
```

- [ ] **Step 2: Write the listing checks**

`store/storetest/listing.go`. The entities share no interface, so each check collects IDs inline:

```go
package storetest

import (
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
)

func sameOrder(t *testing.T, what string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("%s: got %d rows %v, want %d rows %v", what, len(got), got, len(want), want)
		return
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%s: position %d is %s, want %s (got %v, want %v)", what, i, got[i], want[i], got, want)
			return
		}
	}
}

// testEmptyAppIsExact records what an empty app ID means on this backend.
// Every backend treats it as an exact match on app_id = '', never as "every
// app". If a backend ever starts returning other apps' rows for "", this is
// where it shows up, before a dashboard renders one tenant's data to another.
func testEmptyAppIsExact(t *testing.T, s store.Store) {
	blank := newProvider("", "blank", "inapp", 0, Base)
	other := newProvider("app_b", "other", "inapp", 0, Base)
	must(t, "create blank", s.CreateProvider(ctx, blank))
	must(t, "create other", s.CreateProvider(ctx, other))

	got, err := s.ListAllProviders(ctx, "")
	must(t, "list providers for empty app", err)
	var gotIDs []string
	for _, p := range got {
		gotIDs = append(gotIDs, p.ID.String())
	}
	sameOrder(t, `ListAllProviders("") is an exact match`, gotIDs, []string{blank.ID.String()})

	msgBlank := newMessage("", "email", message.StatusSent, Base)
	msgOther := newMessage("app_b", "email", message.StatusSent, Base)
	must(t, "create blank message", s.CreateMessage(ctx, msgBlank))
	must(t, "create other message", s.CreateMessage(ctx, msgOther))
	msgs, err := s.ListMessages(ctx, "", message.ListOptions{})
	must(t, "list messages for empty app", err)
	var msgIDs []string
	for _, m := range msgs {
		msgIDs = append(msgIDs, m.ID.String())
	}
	sameOrder(t, `ListMessages("") is an exact match`, msgIDs, []string{msgBlank.ID.String()})
}

func testOrdering(t *testing.T, s store.Store) {
	// Providers: priority ascending, then oldest first.
	late := newProvider("app_a", "late", "email", 1, Base.Add(2*time.Minute))
	early := newProvider("app_a", "early", "email", 1, Base.Add(1*time.Minute))
	first := newProvider("app_a", "first", "email", 0, Base.Add(3*time.Minute))
	must(t, "create late", s.CreateProvider(ctx, late))
	must(t, "create early", s.CreateProvider(ctx, early))
	must(t, "create first", s.CreateProvider(ctx, first))
	ps, err := s.ListAllProviders(ctx, "app_a")
	must(t, "list providers", err)
	var pIDs []string
	for _, p := range ps {
		pIDs = append(pIDs, p.ID.String())
	}
	sameOrder(t, "providers by priority then created_at", pIDs,
		[]string{first.ID.String(), early.ID.String(), late.ID.String()})

	// Templates: oldest first.
	t2 := newTemplate("app_a", "second", "email", Base.Add(2*time.Minute))
	t1 := newTemplate("app_a", "first", "email", Base.Add(1*time.Minute))
	must(t, "create t2", s.CreateTemplate(ctx, t2))
	must(t, "create t1", s.CreateTemplate(ctx, t1))
	ts, err := s.ListTemplates(ctx, "app_a")
	must(t, "list templates", err)
	var tIDs []string
	for _, x := range ts {
		tIDs = append(tIDs, x.ID.String())
	}
	sameOrder(t, "templates by created_at", tIDs, []string{t1.ID.String(), t2.ID.String()})

	// Versions: locale ascending.
	fr := newVersion(t1.ID, "fr")
	en := newVersion(t1.ID, "en")
	must(t, "create fr", s.CreateVersion(ctx, fr))
	must(t, "create en", s.CreateVersion(ctx, en))
	vs, err := s.ListVersions(ctx, t1.ID)
	must(t, "list versions", err)
	var vIDs []string
	for _, v := range vs {
		vIDs = append(vIDs, v.ID.String())
	}
	sameOrder(t, "versions by locale", vIDs, []string{en.ID.String(), fr.ID.String()})

	// Notifications: newest first.
	n1 := newNotification("app_a", "u1", Base.Add(1*time.Minute))
	n2 := newNotification("app_a", "u1", Base.Add(2*time.Minute))
	must(t, "create n1", s.CreateNotification(ctx, n1))
	must(t, "create n2", s.CreateNotification(ctx, n2))
	ns, err := s.ListNotifications(ctx, "app_a", "u1", 0, 0)
	must(t, "list notifications", err)
	var nIDs []string
	for _, n := range ns {
		nIDs = append(nIDs, n.ID.String())
	}
	sameOrder(t, "notifications newest first", nIDs, []string{n2.ID.String(), n1.ID.String()})

	// Scoped configs: scope ascending ("app" < "org" < "user"), then oldest first.
	user := &scope.Config{ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeUser, ScopeID: "u1", CreatedAt: Base, UpdatedAt: Base}
	app := &scope.Config{ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeApp, ScopeID: "app_a", CreatedAt: Base, UpdatedAt: Base}
	must(t, "set user scope", s.SetScopedConfig(ctx, user))
	must(t, "set app scope", s.SetScopedConfig(ctx, app))
	cs, err := s.ListScopedConfigs(ctx, "app_a")
	must(t, "list scoped configs", err)
	var scopes []string
	for _, c := range cs {
		scopes = append(scopes, string(c.Scope))
	}
	sameOrder(t, "scoped configs by scope", scopes, []string{"app", "user"})
}

func testMessagePaging(t *testing.T, s store.Store) {
	var created []*message.Message
	for i := range 5 {
		m := newMessage("app_a", "email", message.StatusSent, Base.Add(time.Duration(i)*time.Minute))
		must(t, "create message", s.CreateMessage(ctx, m))
		created = append(created, m)
	}
	// Newest first, skip one, take two: created[3], created[2].
	page, err := s.ListMessages(ctx, "app_a", message.ListOptions{Offset: 1, Limit: 2})
	must(t, "list page", err)
	var got []string
	for _, m := range page {
		got = append(got, m.ID.String())
	}
	sameOrder(t, "messages offset 1 limit 2", got, []string{created[3].ID.String(), created[2].ID.String()})

	past, err := s.ListMessages(ctx, "app_a", message.ListOptions{Offset: 10, Limit: 2})
	must(t, "list past the end", err)
	if len(past) != 0 {
		t.Errorf("offset past the end: got %d rows, want 0", len(past))
	}
}
```

- [ ] **Step 3: Register the new checks**

In `store/storetest/storetest.go`, add to `Run` after the existing two lines:

```go
	t.Run("RoundTrips", func(t *testing.T) { testRoundTrips(t, open(t)) })
	t.Run("ReadsAreCopies", func(t *testing.T) { testReadsAreCopies(t, open(t)) })
	t.Run("EmptyAppIsExact", func(t *testing.T) { testEmptyAppIsExact(t, open(t)) })
	t.Run("Ordering", func(t *testing.T) { testOrdering(t, open(t)) })
	t.Run("MessagePaging", func(t *testing.T) { testMessagePaging(t, open(t)) })
```

- [ ] **Step 4: Run and watch memory fail**

Run: `go test ./store/... -run TestConformance -race 2>&1 | grep -E "FAIL|race|ok" | head -30`
Expected: memory fails `ReadsAreCopies`, `Ordering` and `MessagePaging` (map order), and `-race` may report the `GetTemplate` write under `RLock`. SQLite passes all of them. If SQLite fails a round trip, stop: that's a real serialization bug to report, not something to paper over in the suite.

- [ ] **Step 5: Add copy helpers to memory**

`store/memory/clone.go`:

```go
package memory

import (
	"maps"
	"slices"

	"github.com/xraph/herald/inbox"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/preference"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/template"
)

// The memory store copies on the way in and on the way out, so neither a
// caller mutating what it passed nor one mutating what it read can change
// stored state. SQL and Mongo behave this way by construction.

func cloneProvider(p *provider.Provider) *provider.Provider {
	c := *p
	c.Credentials = maps.Clone(p.Credentials)
	c.Settings = maps.Clone(p.Settings)
	return &c
}

func cloneTemplate(t *template.Template) *template.Template {
	c := *t
	c.Variables = slices.Clone(t.Variables)
	c.Versions = nil // attached per read from the versions map
	return &c
}

func cloneVersion(v *template.Version) *template.Version {
	c := *v
	return &c
}

func cloneMessage(m *message.Message) *message.Message {
	c := *m
	c.Metadata = maps.Clone(m.Metadata)
	if m.SentAt != nil {
		t := *m.SentAt
		c.SentAt = &t
	}
	if m.DeliveredAt != nil {
		t := *m.DeliveredAt
		c.DeliveredAt = &t
	}
	return &c
}

func cloneNotification(n *inbox.Notification) *inbox.Notification {
	c := *n
	c.Metadata = maps.Clone(n.Metadata)
	if n.ReadAt != nil {
		t := *n.ReadAt
		c.ReadAt = &t
	}
	if n.ExpiresAt != nil {
		t := *n.ExpiresAt
		c.ExpiresAt = &t
	}
	return &c
}

func clonePreference(p *preference.Preference) *preference.Preference {
	c := *p
	if p.Overrides != nil {
		c.Overrides = make(map[string]preference.ChannelPreference, len(p.Overrides))
		for k, v := range p.Overrides {
			c.Overrides[k] = preference.ChannelPreference{
				Email: cloneBool(v.Email), SMS: cloneBool(v.SMS), Push: cloneBool(v.Push), InApp: cloneBool(v.InApp),
			}
		}
	}
	return &c
}

func cloneBool(b *bool) *bool {
	if b == nil {
		return nil
	}
	v := *b
	return &v
}

func cloneScopedConfig(c *scope.Config) *scope.Config {
	x := *c
	return &x
}

// page applies offset and limit the way the SQL stores do: an offset past the
// end is an empty page, and a limit of zero means no limit.
func page[T any](xs []T, limit, offset int) []T {
	if offset >= len(xs) {
		return nil
	}
	if offset > 0 {
		xs = xs[offset:]
	}
	if limit > 0 && limit < len(xs) {
		xs = xs[:limit]
	}
	return xs
}
```

- [ ] **Step 6: Use them in the memory store**

In `store/memory/store.go`, add `"sort"` to the imports and apply these changes.

Every create and update stores a clone: `s.providers[p.ID.String()] = cloneProvider(p)`, `s.templates[...] = cloneTemplate(t)`, `s.versions[...] = cloneVersion(v)`, `s.messages[...] = cloneMessage(m)`, `s.notifications[...] = cloneNotification(n)`, `s.preferences[...] = clonePreference(p)`, `s.scopedConfigs[key] = cloneScopedConfig(cfg)`.

Every single-row read returns a clone: `return cloneProvider(p), nil`, `return cloneVersion(v), nil`, `return cloneMessage(m), nil`, `return cloneNotification(n), nil`, `return clonePreference(p), nil`, `return cloneScopedConfig(cfg), nil`.

Templates no longer write onto shared state. Replace `GetTemplate`, `GetTemplateBySlug`, `ListTemplates`, `ListTemplatesByChannel` and `versionsForTemplate`:

```go
func (s *Store) GetTemplate(_ context.Context, templateID id.TemplateID) (*template.Template, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.templates[templateID.String()]
	if !ok {
		return nil, store.ErrTemplateNotFound
	}
	return s.withVersions(t), nil
}

func (s *Store) GetTemplateBySlug(_ context.Context, appID, slug, channel string) (*template.Template, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, t := range s.templates {
		if t.AppID == appID && t.Slug == slug && t.Channel == channel {
			return s.withVersions(t), nil
		}
	}
	return nil, store.ErrTemplateNotFound
}

func (s *Store) ListTemplates(_ context.Context, appID string) ([]*template.Template, error) {
	return s.listTemplates(func(t *template.Template) bool { return t.AppID == appID }), nil
}

func (s *Store) ListTemplatesByChannel(_ context.Context, appID, channel string) ([]*template.Template, error) {
	return s.listTemplates(func(t *template.Template) bool { return t.AppID == appID && t.Channel == channel }), nil
}

func (s *Store) listTemplates(keep func(*template.Template) bool) []*template.Template {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*template.Template
	for _, t := range s.templates {
		if keep(t) {
			result = append(result, s.withVersions(t))
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		return result[i].ID.String() < result[j].ID.String()
	})
	return result
}

// withVersions returns a copy of t carrying its versions, in locale order.
// The caller must hold s.mu.
func (s *Store) withVersions(t *template.Template) *template.Template {
	c := cloneTemplate(t)
	for _, v := range s.sortedVersions(t.ID) {
		c.Versions = append(c.Versions, *v)
	}
	return c
}

// sortedVersions returns copies of a template's versions, locale ascending.
// The caller must hold s.mu.
func (s *Store) sortedVersions(templateID id.TemplateID) []*template.Version {
	var result []*template.Version
	for _, v := range s.versions {
		if v.TemplateID.String() == templateID.String() {
			result = append(result, cloneVersion(v))
		}
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].Locale < result[j].Locale })
	return result
}

func (s *Store) ListVersions(_ context.Context, templateID id.TemplateID) ([]*template.Version, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sortedVersions(templateID), nil
}
```

Delete the old `versionsForTemplate`.

Lists sort the way SQL does. Replace `ListProviders`:

```go
func (s *Store) ListProviders(_ context.Context, appID string, channel string) ([]*provider.Provider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*provider.Provider
	for _, p := range s.providers {
		if p.AppID == appID && (channel == "" || p.Channel == channel) {
			result = append(result, cloneProvider(p))
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Priority != result[j].Priority {
			return result[i].Priority < result[j].Priority
		}
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		return result[i].ID.String() < result[j].ID.String()
	})
	return result, nil
}
```

`ListMessages` (newest first, then `page`):

```go
func (s *Store) ListMessages(_ context.Context, appID string, opts message.ListOptions) ([]*message.Message, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*message.Message
	for _, m := range s.messages {
		if m.AppID != appID || (opts.Channel != "" && m.Channel != opts.Channel) || (opts.Status != "" && m.Status != opts.Status) {
			continue
		}
		result = append(result, cloneMessage(m))
	}
	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.After(result[j].CreatedAt)
		}
		return result[i].ID.String() > result[j].ID.String()
	})
	return page(result, opts.Limit, opts.Offset), nil
}
```

`ListNotifications` (newest first, then `page`):

```go
func (s *Store) ListNotifications(_ context.Context, appID, userID string, limit, offset int) ([]*inbox.Notification, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*inbox.Notification
	for _, n := range s.notifications {
		if n.AppID == appID && n.UserID == userID {
			result = append(result, cloneNotification(n))
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.After(result[j].CreatedAt)
		}
		return result[i].ID.String() > result[j].ID.String()
	})
	return page(result, limit, offset), nil
}
```

`ListScopedConfigs` (scope ascending, then oldest first):

```go
func (s *Store) ListScopedConfigs(_ context.Context, appID string) ([]*scope.Config, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*scope.Config
	for _, cfg := range s.scopedConfigs {
		if cfg.AppID == appID {
			result = append(result, cloneScopedConfig(cfg))
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Scope != result[j].Scope {
			return result[i].Scope < result[j].Scope
		}
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})
	return result, nil
}
```

`UpdateMessageStatus` and `MarkRead` keep mutating the stored copy in place; that's fine because nothing outside the store holds that pointer any more.

- [ ] **Step 7: Run with the race detector**

Run: `go test -race ./store/... && go build ./... && go test ./...`
Expected: all `ok`, no race reports.

- [ ] **Step 8: Lint and commit**

```bash
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/storetest/roundtrip.go store/storetest/listing.go store/memory/clone.go
git commit --only -m "fix(store/memory): copy on read and write and sort like the SQL stores" -- \
  store/storetest/storetest.go store/storetest/roundtrip.go store/storetest/listing.go \
  store/memory/clone.go store/memory/store.go
git show --stat HEAD
```

---
### Task 3: Record deliveries and count messages

`UpdateMessageStatus` writes status and error only, so `sent_at` never persists on SQL or Mongo and the vendor's message ID is thrown away. There's no count method, so the old dashboard counted a 1,000-row list. This task replaces the status update with `RecordDelivery`, adds `CountMessages`, and adds the `provider_message_id` column.

**Files:**
- Create: `store/storetest/delivery.go`
- Modify: `message/message.go`, `message/store.go`
- Modify: all four `store/*/store.go`; `store/postgres/models.go`, `store/sqlite/models.go`, `store/mongo/models.go`; `store/postgres/migrations.go`, `store/sqlite/migrations.go`
- Modify: `herald.go` (the two call sites only)
- Modify: `store/storetest/notfound.go`, `store/storetest/storetest.go`

**Interfaces:**
- Produces:
  - `message.Message.ProviderMessageID string` (`json:"provider_message_id,omitempty"`)
  - `message.StatusSuppressed Status = "suppressed"` (used by Task 11; declared here so the status list lives in one place)
  - `type message.Delivery struct { Status Status; Error string; ProviderMessageID string; SentAt *time.Time }`
  - `type message.Count struct { Status Status; Channel string; N int }` with JSON tags `status`, `channel`, `n`
  - `message.Store.RecordDelivery(ctx context.Context, messageID id.MessageID, d Delivery) error`
  - `message.Store.CountMessages(ctx context.Context, appID string, since time.Time) ([]Count, error)`, sorted by status then channel.
  - `UpdateMessageStatus` is removed from the interface and every backend.

- [ ] **Step 1: Extend the message package**

In `message/message.go`, add `StatusSuppressed` to the status block with a comment, the field to `Message` after `ProviderID`, and the two types at the bottom:

```go
	// StatusSuppressed is a send Herald chose not to make, because the
	// recipient opted out of this notification type on this channel.
	StatusSuppressed Status = "suppressed"
```

```go
	ProviderMessageID string          `json:"provider_message_id,omitempty"`
```

```go
// Delivery is the outcome of one send attempt, written by RecordDelivery.
type Delivery struct {
	Status            Status
	Error             string
	ProviderMessageID string
	SentAt            *time.Time
}

// Count is the number of messages with one status on one channel.
type Count struct {
	Status  Status `json:"status"`
	Channel string `json:"channel"`
	N       int    `json:"n"`
}
```

`message/store.go`:

```go
package message

import (
	"context"
	"time"

	"github.com/xraph/herald/id"
)

// Store defines persistence operations for the message delivery log.
type Store interface {
	CreateMessage(ctx context.Context, m *Message) error
	GetMessage(ctx context.Context, messageID id.MessageID) (*Message, error)
	// RecordDelivery writes the outcome of a send: status, error, the vendor's
	// message ID and when it was sent. Every field is written, so an empty
	// value clears what was there.
	RecordDelivery(ctx context.Context, messageID id.MessageID, d Delivery) error
	ListMessages(ctx context.Context, appID string, opts ListOptions) ([]*Message, error)
	// CountMessages groups the messages created at or after since by status
	// and channel, sorted by status then channel.
	CountMessages(ctx context.Context, appID string, since time.Time) ([]Count, error)
}
```

- [ ] **Step 2: Write the failing suite checks**

`store/storetest/delivery.go`:

```go
package storetest

import (
	"reflect"
	"testing"
	"time"

	"github.com/xraph/herald/message"
	"github.com/xraph/herald/store"
)

func testRecordDelivery(t *testing.T, s store.Store) {
	m := newMessage("app_a", "sms", message.StatusSending, Base)
	must(t, "create message", s.CreateMessage(ctx, m))

	sentAt := Base.Add(3 * time.Second)
	must(t, "record delivery", s.RecordDelivery(ctx, m.ID, message.Delivery{
		Status: message.StatusSent, ProviderMessageID: "SM123", SentAt: &sentAt,
	}))
	got, err := s.GetMessage(ctx, m.ID)
	must(t, "get message", err)
	if got.Status != message.StatusSent || got.ProviderMessageID != "SM123" || got.Error != "" {
		t.Errorf("after sent: status=%q vendor=%q error=%q", got.Status, got.ProviderMessageID, got.Error)
	}
	if got.SentAt == nil || !got.SentAt.Equal(sentAt) {
		t.Errorf("sent_at: got %v, want %v", got.SentAt, sentAt)
	}

	failed := newMessage("app_a", "sms", message.StatusSending, Base)
	must(t, "create failing message", s.CreateMessage(ctx, failed))
	must(t, "record failure", s.RecordDelivery(ctx, failed.ID, message.Delivery{
		Status: message.StatusFailed, Error: "twilio: API error 400: bad number",
	}))
	gotF, err := s.GetMessage(ctx, failed.ID)
	must(t, "get failed message", err)
	if gotF.Status != message.StatusFailed || gotF.Error != "twilio: API error 400: bad number" || gotF.SentAt != nil {
		t.Errorf("after failed: status=%q error=%q sent_at=%v", gotF.Status, gotF.Error, gotF.SentAt)
	}
}

func testCountMessages(t *testing.T, s store.Store) {
	since := Base
	rows := []struct {
		app     string
		channel string
		status  message.Status
		at      time.Time
	}{
		{"app_a", "email", message.StatusSent, Base.Add(-time.Hour)}, // before the window
		{"app_a", "email", message.StatusSent, Base},                 // on the boundary: counted
		{"app_a", "email", message.StatusSent, Base.Add(time.Minute)},
		{"app_a", "email", message.StatusFailed, Base.Add(time.Minute)},
		{"app_a", "sms", message.StatusSent, Base.Add(2 * time.Minute)},
		{"app_b", "email", message.StatusSent, Base.Add(time.Minute)}, // another app
	}
	for _, r := range rows {
		must(t, "create message", s.CreateMessage(ctx, newMessage(r.app, r.channel, r.status, r.at)))
	}

	got, err := s.CountMessages(ctx, "app_a", since)
	must(t, "count messages", err)
	want := []message.Count{
		{Status: message.StatusFailed, Channel: "email", N: 1},
		{Status: message.StatusSent, Channel: "email", N: 2},
		{Status: message.StatusSent, Channel: "sms", N: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("CountMessages: got %+v, want %+v", got, want)
	}

	empty, err := s.CountMessages(ctx, "app_a", Base.Add(time.Hour))
	must(t, "count an empty window", err)
	if len(empty) != 0 {
		t.Errorf("empty window: got %+v, want no rows", empty)
	}
}
```

In `store/storetest/notfound.go`, replace the `UpdateMessageStatus` line with:

```go
	expectIs(t, "RecordDelivery", s.RecordDelivery(ctx, id.NewMessageID(), message.Delivery{Status: message.StatusSent}), store.ErrMessageNotFound)
```

In `Run`, add:

```go
	t.Run("RecordDelivery", func(t *testing.T) { testRecordDelivery(t, open(t)) })
	t.Run("CountMessages", func(t *testing.T) { testCountMessages(t, open(t)) })
```

Run: `go build ./...`
Expected: FAIL to compile. Every backend is missing `RecordDelivery` and `CountMessages`, and `herald.go` still calls `UpdateMessageStatus`. The remaining steps fix each.

- [ ] **Step 3: Memory**

In `store/memory/store.go`, replace `UpdateMessageStatus` with:

```go
func (s *Store) RecordDelivery(_ context.Context, messageID id.MessageID, d message.Delivery) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.messages[messageID.String()]
	if !ok {
		return store.ErrMessageNotFound
	}
	m.Status = d.Status
	m.Error = d.Error
	m.ProviderMessageID = d.ProviderMessageID
	m.SentAt = nil
	if d.SentAt != nil {
		t := *d.SentAt
		m.SentAt = &t
	}
	return nil
}

func (s *Store) CountMessages(_ context.Context, appID string, since time.Time) ([]message.Count, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	type key struct {
		status  message.Status
		channel string
	}
	counts := map[key]int{}
	for _, m := range s.messages {
		if m.AppID == appID && !m.CreatedAt.Before(since) {
			counts[key{m.Status, m.Channel}]++
		}
	}
	result := make([]message.Count, 0, len(counts))
	for k, n := range counts {
		result = append(result, message.Count{Status: k.status, Channel: k.channel, N: n})
	}
	sortCounts(result)
	return result, nil
}

func sortCounts(cs []message.Count) {
	sort.Slice(cs, func(i, j int) bool {
		if cs[i].Status != cs[j].Status {
			return cs[i].Status < cs[j].Status
		}
		return cs[i].Channel < cs[j].Channel
	})
}
```

- [ ] **Step 4: Postgres**

In `store/postgres/models.go`, add to `messageModel` after `ProviderID`:

```go
	ProviderMessageID string            `grove:"provider_message_id"`
```

and copy it in both `toMessageModel` (`ProviderMessageID: m.ProviderMessageID,`) and `fromMessageModel` (`ProviderMessageID: m.ProviderMessageID,`).

In `store/postgres/migrations.go`, register a new migration after `add_webhook_chat_provider_ids`:

```go
		&migrate.Migration{
			Name:    "add_message_provider_message_id",
			Version: "20260930000001",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `ALTER TABLE herald_messages ADD COLUMN IF NOT EXISTS provider_message_id TEXT NOT NULL DEFAULT ''`)
				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `ALTER TABLE herald_messages DROP COLUMN IF EXISTS provider_message_id`)
				return err
			},
		},
```

In `store/postgres/store.go`, replace `UpdateMessageStatus` with:

```go
func (s *Store) RecordDelivery(ctx context.Context, messageID id.MessageID, d message.Delivery) error {
	res, err := s.pg.NewUpdate((*messageModel)(nil)).
		Set("status = $1", string(d.Status)).
		Set("error = $2", d.Error).
		Set("provider_message_id = $3", d.ProviderMessageID).
		Set("sent_at = $4", d.SentAt).
		Where("id = $5", messageID.String()).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return store.ErrMessageNotFound
	}
	return nil
}

func (s *Store) CountMessages(ctx context.Context, appID string, since time.Time) ([]message.Count, error) {
	rows, err := s.pg.Query(ctx, `
SELECT status, channel, COUNT(*)
FROM herald_messages
WHERE app_id = $1 AND created_at >= $2
GROUP BY status, channel
ORDER BY status, channel`, appID, since.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []message.Count{}
	for rows.Next() {
		var c message.Count
		var status string
		if err := rows.Scan(&status, &c.Channel, &c.N); err != nil {
			return nil, err
		}
		c.Status = message.Status(status)
		result = append(result, c)
	}
	return result, rows.Err()
}
```

- [ ] **Step 5: SQLite**

In `store/sqlite/models.go`, add the same `ProviderMessageID string grove:"provider_message_id"` field to `messageModel` and copy it both ways.

In `store/sqlite/migrations.go`, register after `add_webhook_chat_provider_ids`:

```go
		&migrate.Migration{
			Name:    "add_message_provider_message_id",
			Version: "20260930000001",
			Up: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `ALTER TABLE herald_messages ADD COLUMN provider_message_id TEXT NOT NULL DEFAULT ''`)
				return err
			},
			Down: func(ctx context.Context, exec migrate.Executor) error {
				_, err := exec.Exec(ctx, `ALTER TABLE herald_messages DROP COLUMN provider_message_id`)
				return err
			},
		},
```

In `store/sqlite/store.go`, replace `UpdateMessageStatus` with the same two methods as Postgres, using `s.sdb`, `?` placeholders, and this query for the count:

```go
	// created_at is TEXT holding Go's time.String() form. A bound time.Time
	// in UTC compares correctly against it; an RFC3339 string matches nothing.
	rows, err := s.sdb.Query(ctx, `
SELECT status, channel, COUNT(*)
FROM herald_messages
WHERE app_id = ? AND created_at >= ?
GROUP BY status, channel
ORDER BY status, channel`, appID, since.UTC())
```

- [ ] **Step 6: Mongo**

In `store/mongo/models.go`, add to `messageModel`:

```go
	ProviderMessageID string            `grove:"provider_message_id" bson:"provider_message_id"`
```

and copy it both ways. No migration is needed: a document without the field reads as `""`.

In `store/mongo/store.go`, replace `UpdateMessageStatus` with:

```go
func (s *Store) RecordDelivery(ctx context.Context, messageID id.MessageID, d message.Delivery) error {
	res, err := s.mdb.NewUpdate((*messageModel)(nil)).
		Filter(bson.M{"_id": messageID.String()}).
		Set("status", string(d.Status)).
		Set("error", d.Error).
		Set("provider_message_id", d.ProviderMessageID).
		Set("sent_at", d.SentAt).
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("herald/mongo: record delivery: %w", err)
	}
	if res.MatchedCount() == 0 {
		return store.ErrMessageNotFound
	}
	return nil
}

func (s *Store) CountMessages(ctx context.Context, appID string, since time.Time) ([]message.Count, error) {
	pipeline := mongo.Pipeline{
		{{Key: "$match", Value: bson.M{"app_id": appID, "created_at": bson.M{"$gte": since.UTC()}}}},
		{{Key: "$group", Value: bson.M{
			"_id": bson.M{"status": "$status", "channel": "$channel"},
			"n":   bson.M{"$sum": 1},
		}}},
		{{Key: "$sort", Value: bson.D{{Key: "_id.status", Value: 1}, {Key: "_id.channel", Value: 1}}}},
	}
	cur, err := s.mdb.Collection(colMessages).Aggregate(ctx, pipeline)
	if err != nil {
		return nil, fmt.Errorf("herald/mongo: count messages: %w", err)
	}
	defer cur.Close(ctx)
	result := []message.Count{}
	for cur.Next(ctx) {
		var row struct {
			ID struct {
				Status  string `bson:"status"`
				Channel string `bson:"channel"`
			} `bson:"_id"`
			N int `bson:"n"`
		}
		if err := cur.Decode(&row); err != nil {
			return nil, fmt.Errorf("herald/mongo: decode count: %w", err)
		}
		result = append(result, message.Count{Status: message.Status(row.ID.Status), Channel: row.ID.Channel, N: row.N})
	}
	return result, cur.Err()
}
```

- [ ] **Step 7: Update the engine's two call sites**

`herald.go` calls `UpdateMessageStatus` twice. Task 11 rewrites `Send`; for now keep behaviour and switch to the new method. Replace the failure call:

```go
			_ = h.store.RecordDelivery(ctx, msg.ID, message.Delivery{ //nolint:errcheck // best-effort status update
				Status: message.StatusFailed, Error: sendErr.Error(),
			})
```

and the success call:

```go
		providerMessageID := ""
		if result != nil {
			providerMessageID = result.ProviderMessageID
		}
		_ = h.store.RecordDelivery(ctx, msg.ID, message.Delivery{ //nolint:errcheck // best-effort status update
			Status: message.StatusSent, ProviderMessageID: providerMessageID, SentAt: &sentAt,
		})
```

Then check nothing else calls the old method: `grep -rn "UpdateMessageStatus" --include='*.go' .` should print nothing. (`dashboard/` doesn't call it; if it does in your checkout, switch it the same way.)

- [ ] **Step 8: Build, test, lint**

Run: `go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`
Expected: all `ok` (memory and SQLite conformance now include `RecordDelivery` and `CountMessages`), `0 issues`.

- [ ] **Step 9: Commit**

```bash
git add store/storetest/delivery.go
git commit --only -m "feat(store): record the whole delivery and count messages by status and channel" -- \
  message/message.go message/store.go store/storetest/delivery.go store/storetest/notfound.go store/storetest/storetest.go \
  store/memory/store.go store/postgres/store.go store/postgres/models.go store/postgres/migrations.go \
  store/sqlite/store.go store/sqlite/models.go store/sqlite/migrations.go \
  store/mongo/store.go store/mongo/models.go herald.go
git show --stat HEAD
```

---

### Task 4: Versions on list reads, and upserts that keep their identity

`ListTemplates` populates `Versions` in memory only; the three database backends return none, which is why the templ templates list could never show locales. The SQL scoped-config upsert never updates `webhook_provider_id` or `chat_provider_id`. Memory's upserts replace the whole row, including its ID and `CreatedAt`, where SQL and Mongo keep them.

**Files:**
- Create: `store/storetest/upsert.go`
- Modify: `store/storetest/storetest.go`, `store/postgres/store.go`, `store/sqlite/store.go`, `store/mongo/store.go`, `store/memory/store.go`

**Interfaces:**
- Consumes: Task 2's memory helpers.
- Produces: `ListTemplates` / `ListTemplatesByChannel` return versions (locale ascending) on every backend; upserts preserve `ID` and `CreatedAt` of an existing row.

- [ ] **Step 1: Write the failing checks**

`store/storetest/upsert.go`:

```go
package storetest

import (
	"testing"
	"time"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/preference"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
)

func testListTemplatesCarryVersions(t *testing.T, s store.Store) {
	tmpl := newTemplate("app_a", "welcome", "email", Base)
	must(t, "create template", s.CreateTemplate(ctx, tmpl))
	must(t, "create fr", s.CreateVersion(ctx, newVersion(tmpl.ID, "fr")))
	must(t, "create en", s.CreateVersion(ctx, newVersion(tmpl.ID, "en")))
	bare := newTemplate("app_a", "bare", "sms", Base.Add(time.Minute))
	must(t, "create bare", s.CreateTemplate(ctx, bare))

	all, err := s.ListTemplates(ctx, "app_a")
	must(t, "list templates", err)
	byChannel, err := s.ListTemplatesByChannel(ctx, "app_a", "email")
	must(t, "list templates by channel", err)

	check := func(what string, got []string) {
		t.Helper()
		sameOrder(t, what, got, []string{"en", "fr"})
	}
	for _, x := range all {
		if x.ID.String() == tmpl.ID.String() {
			var locales []string
			for _, v := range x.Versions {
				locales = append(locales, v.Locale)
			}
			check("ListTemplates versions", locales)
		}
		if x.ID.String() == bare.ID.String() && len(x.Versions) != 0 {
			t.Errorf("template with no versions came back with %d", len(x.Versions))
		}
	}
	if len(byChannel) != 1 {
		t.Fatalf("ListTemplatesByChannel: got %d templates, want 1", len(byChannel))
	}
	var locales []string
	for _, v := range byChannel[0].Versions {
		locales = append(locales, v.Locale)
	}
	check("ListTemplatesByChannel versions", locales)
}

func testScopedConfigUpsert(t *testing.T, s store.Store) {
	first := &scope.Config{
		ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeApp, ScopeID: "app_a",
		EmailProviderID: "hpvd_e1", WebhookProviderID: "hpvd_w1", ChatProviderID: "hpvd_c1",
		CreatedAt: Base, UpdatedAt: Base,
	}
	must(t, "insert", s.SetScopedConfig(ctx, first))

	second := &scope.Config{
		ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeApp, ScopeID: "app_a",
		EmailProviderID: "hpvd_e2", WebhookProviderID: "hpvd_w2", ChatProviderID: "hpvd_c2",
		CreatedAt: Base.Add(time.Hour), UpdatedAt: Base.Add(time.Hour),
	}
	must(t, "upsert", s.SetScopedConfig(ctx, second))

	got, err := s.GetScopedConfig(ctx, "app_a", scope.ScopeApp, "app_a")
	must(t, "get", err)
	if got.EmailProviderID != "hpvd_e2" || got.WebhookProviderID != "hpvd_w2" || got.ChatProviderID != "hpvd_c2" {
		t.Errorf("upsert did not update every channel: email=%q webhook=%q chat=%q",
			got.EmailProviderID, got.WebhookProviderID, got.ChatProviderID)
	}
	if got.ID.String() != first.ID.String() {
		t.Errorf("upsert replaced the row's ID: got %s, want %s", got.ID, first.ID)
	}
	if !got.CreatedAt.Equal(Base) {
		t.Errorf("upsert replaced created_at: got %v, want %v", got.CreatedAt, Base)
	}
}

func testPreferenceUpsert(t *testing.T, s store.Store) {
	off := false
	first := &preference.Preference{
		ID: id.NewPreferenceID(), AppID: "app_a", UserID: "u1",
		Overrides: map[string]preference.ChannelPreference{"a": {Email: &off}},
		CreatedAt: Base, UpdatedAt: Base,
	}
	must(t, "insert", s.SetPreference(ctx, first))
	second := &preference.Preference{
		ID: id.NewPreferenceID(), AppID: "app_a", UserID: "u1",
		Overrides: map[string]preference.ChannelPreference{"b": {SMS: &off}},
		CreatedAt: Base.Add(time.Hour), UpdatedAt: Base.Add(time.Hour),
	}
	must(t, "upsert", s.SetPreference(ctx, second))

	got, err := s.GetPreference(ctx, "app_a", "u1")
	must(t, "get", err)
	if _, ok := got.Overrides["b"]; !ok || len(got.Overrides) != 1 {
		t.Errorf("upsert should replace overrides with the new set: got %+v", got.Overrides)
	}
	if got.ID.String() != first.ID.String() || !got.CreatedAt.Equal(Base) {
		t.Errorf("upsert replaced identity: id=%s created=%v", got.ID, got.CreatedAt)
	}
}
```

In `Run`, add:

```go
	t.Run("ListTemplatesCarryVersions", func(t *testing.T) { testListTemplatesCarryVersions(t, open(t)) })
	t.Run("ScopedConfigUpsert", func(t *testing.T) { testScopedConfigUpsert(t, open(t)) })
	t.Run("PreferenceUpsert", func(t *testing.T) { testPreferenceUpsert(t, open(t)) })
```

- [ ] **Step 2: Run and watch it fail**

Run: `go test ./store/... -run TestConformance 2>&1 | grep -E "FAIL|want" | head`
Expected: SQLite fails `ListTemplatesCarryVersions` (no versions) and `ScopedConfigUpsert` (webhook and chat unchanged). Memory fails both upsert identity checks.

- [ ] **Step 3: Attach versions in Postgres and SQLite**

In `store/postgres/store.go`, change the two list methods to `return s.attachVersions(ctx, mapTemplates(models))`, which needs `mapTemplates`' error handled first:

```go
func (s *Store) ListTemplates(ctx context.Context, appID string) ([]*template.Template, error) {
	var models []templateModel
	err := s.pg.NewSelect(&models).
		Where("app_id = $1", appID).
		OrderExpr("created_at ASC").
		Scan(ctx)
	if err != nil {
		return nil, err
	}
	templates, err := mapTemplates(models)
	if err != nil {
		return nil, err
	}
	return templates, s.attachVersions(ctx, templates)
}
```

(`ListTemplatesByChannel` the same way.) Add:

```go
// attachVersions loads the versions of every template in one query and hangs
// them on their templates, locale ascending.
func (s *Store) attachVersions(ctx context.Context, templates []*template.Template) error {
	if len(templates) == 0 {
		return nil
	}
	ids := make([]string, len(templates))
	byID := make(map[string]*template.Template, len(templates))
	for i, t := range templates {
		ids[i] = t.ID.String()
		byID[ids[i]] = t
	}
	var models []templateVersionModel
	err := s.pg.NewSelect(&models).
		Where("template_id = ANY($1)", ids).
		OrderExpr("template_id ASC, locale ASC").
		Scan(ctx)
	if err != nil {
		return err
	}
	for i := range models {
		v, err := fromVersionModel(&models[i])
		if err != nil {
			return err
		}
		if t := byID[v.TemplateID.String()]; t != nil {
			t.Versions = append(t.Versions, *v)
		}
	}
	return nil
}
```

In `store/sqlite/store.go`, the same two list changes and an `attachVersions` whose query builds one placeholder per ID:

```go
	args := make([]any, len(ids))
	for i, x := range ids {
		args[i] = x
	}
	var models []templateVersionModel
	err := s.sdb.NewSelect(&models).
		Where("template_id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+")", args...).
		OrderExpr("template_id ASC, locale ASC").
		Scan(ctx)
```

The rest of the SQLite `attachVersions` body is identical to Postgres.

- [ ] **Step 4: Attach versions in Mongo**

In `store/mongo/store.go`, the same list changes, and:

```go
func (s *Store) attachVersions(ctx context.Context, templates []*template.Template) error {
	if len(templates) == 0 {
		return nil
	}
	ids := make([]string, len(templates))
	byID := make(map[string]*template.Template, len(templates))
	for i, t := range templates {
		ids[i] = t.ID.String()
		byID[ids[i]] = t
	}
	var models []templateVersionModel
	err := s.mdb.NewFind(&models).
		Filter(bson.M{"template_id": bson.M{"$in": ids}}).
		Sort(bson.D{{Key: "template_id", Value: 1}, {Key: "locale", Value: 1}}).
		Scan(ctx)
	if err != nil {
		return fmt.Errorf("herald/mongo: attach versions: %w", err)
	}
	for i := range models {
		v, err := fromVersionModel(&models[i])
		if err != nil {
			return err
		}
		if t := byID[v.TemplateID.String()]; t != nil {
			t.Versions = append(t.Versions, *v)
		}
	}
	return nil
}
```

- [ ] **Step 5: Fix the SQL scoped-config upsert**

In both `store/postgres/store.go` and `store/sqlite/store.go`, add two lines to `SetScopedConfig` after `Set("push_provider_id = EXCLUDED.push_provider_id")`:

```go
		Set("webhook_provider_id = EXCLUDED.webhook_provider_id").
		Set("chat_provider_id = EXCLUDED.chat_provider_id").
```

- [ ] **Step 6: Make memory upserts keep identity**

In `store/memory/store.go`:

```go
func (s *Store) SetPreference(_ context.Context, p *preference.Preference) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := p.AppID + ":" + p.UserID
	c := clonePreference(p)
	if existing, ok := s.preferences[key]; ok {
		c.ID = existing.ID
		c.CreatedAt = existing.CreatedAt
	}
	s.preferences[key] = c
	return nil
}

func (s *Store) SetScopedConfig(_ context.Context, cfg *scope.Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := cfg.AppID + ":" + string(cfg.Scope) + ":" + cfg.ScopeID
	c := cloneScopedConfig(cfg)
	if existing, ok := s.scopedConfigs[key]; ok {
		c.ID = existing.ID
		c.CreatedAt = existing.CreatedAt
	}
	s.scopedConfigs[key] = c
	return nil
}
```

- [ ] **Step 7: Test, lint, commit**

```bash
go build ./... && go test -race ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/storetest/upsert.go
git commit --only -m "fix(store): load versions on template lists and keep row identity on upsert" -- \
  store/storetest/upsert.go store/storetest/storetest.go store/memory/store.go \
  store/postgres/store.go store/sqlite/store.go store/mongo/store.go
git show --stat HEAD
```

Expected before committing: all `ok`, no races, `0 issues`.

---

### Task 5: Run the suite on Postgres and Mongo

Tasks 1 to 4 changed all four backends but only proved memory and SQLite. This adds runners for the other two, gated on environment variables so `go test ./...` still passes on a machine with no databases.

A Postgres 16 container listens on `localhost:55432` and a Mongo 7 container on `localhost:57017` on the development machine. Other sessions own them. Use a dedicated database on each (`herald_conformance` on Postgres, a fresh `herald_conformance_<nanos>` per run on Mongo) and never touch anything else in those servers.

**Files:**
- Create: `store/postgres/store_test.go`, `store/mongo/store_test.go`

- [ ] **Step 1: Postgres runner**

`store/postgres/store_test.go`. It is `package postgres`, like `models_test.go` beside it, because it truncates through the unexported `s.pg`:

```go
package postgres

import (
	"context"
	"os"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/pgdriver"
	_ "github.com/xraph/grove/drivers/pgdriver/pgmigrate"

	"github.com/xraph/herald/store"
	"github.com/xraph/herald/store/storetest"
)

// TestConformance runs the shared suite against a real Postgres. It needs a
// DSN for a database it may truncate, e.g.
// HERALD_TEST_POSTGRES_DSN=postgres://user:pass@localhost:55432/herald_conformance?sslmode=disable
func TestConformance(t *testing.T) {
	dsn := os.Getenv("HERALD_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set HERALD_TEST_POSTGRES_DSN to run the postgres conformance suite")
	}
	storetest.Run(t, func(t *testing.T) store.Store {
		t.Helper()
		ctx := context.Background()
		pdb := pgdriver.New()
		if err := pdb.Open(ctx, dsn); err != nil {
			t.Fatalf("postgres open: %v", err)
		}
		db, err := grove.Open(pdb)
		if err != nil {
			t.Fatalf("grove open: %v", err)
		}
		t.Cleanup(func() { _ = db.Close() })
		s := New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		if _, err := s.pg.Exec(ctx, `TRUNCATE herald_providers, herald_templates, herald_template_versions,
herald_messages, herald_inbox, herald_preferences, herald_scoped_configs`); err != nil {
			t.Fatalf("truncate: %v", err)
		}
		return s
	})
}
```

- [ ] **Step 2: Mongo runner**

`store/mongo/store_test.go`:

```go
package mongo

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/mongodriver"
	_ "github.com/xraph/grove/drivers/mongodriver/mongomigrate"

	"github.com/xraph/herald/store"
	"github.com/xraph/herald/store/storetest"
)

// TestConformance runs the shared suite against a real MongoDB, each subtest
// in a fresh database that is dropped afterwards, e.g.
// HERALD_TEST_MONGO_URI=mongodb://localhost:57017
func TestConformance(t *testing.T) {
	uri := os.Getenv("HERALD_TEST_MONGO_URI")
	if uri == "" {
		t.Skip("set HERALD_TEST_MONGO_URI to run the mongo conformance suite")
	}
	storetest.Run(t, func(t *testing.T) store.Store {
		t.Helper()
		ctx := context.Background()
		name := "herald_conformance_" + strconv.FormatInt(time.Now().UnixNano(), 36)
		mdb := mongodriver.New()
		if err := mdb.Open(ctx, uri, mongodriver.WithDatabase(name)); err != nil {
			t.Fatalf("mongo open: %v", err)
		}
		db, err := grove.Open(mdb)
		if err != nil {
			t.Fatalf("grove open: %v", err)
		}
		t.Cleanup(func() {
			_ = mdb.Database().Drop(context.Background())
			_ = db.Close()
		})
		s := New(db)
		if err := s.Migrate(ctx); err != nil {
			t.Fatalf("migrate: %v", err)
		}
		return s
	})
}
```

- [ ] **Step 3: Find the Postgres credentials and create the database**

```bash
docker ps --format '{{.ID}} {{.Image}} {{.Ports}}' | grep postgres
docker inspect <container-id> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'POSTGRES_(USER|PASSWORD|DB)'
PGPASSWORD=<password> psql -h localhost -p 55432 -U <user> -d <db> -c 'CREATE DATABASE herald_conformance'
```

Creating a new database is the only change to that server. If `CREATE DATABASE` fails because it exists, that's fine: the runner truncates Herald's own tables and nothing else.

- [ ] **Step 4: Run all four backends**

```bash
HERALD_TEST_POSTGRES_DSN='postgres://<user>:<password>@localhost:55432/herald_conformance?sslmode=disable' \
HERALD_TEST_MONGO_URI='mongodb://localhost:57017' \
go test ./store/... -run TestConformance -v 2>&1 | grep -E "^(--- |ok|FAIL)"
```

Expected: `--- PASS: TestConformance` four times. A failure here is a real backend disagreement. Fix the backend, not the suite, and if the right behaviour isn't obvious, stop and report it. If a container isn't running, say so in the task report and record that backend as compile-checked only; don't start or restart other sessions' containers.

- [ ] **Step 5: Confirm the default run skips cleanly, lint, commit**

```bash
go test ./store/postgres/ ./store/mongo/ -run TestConformance -v 2>&1 | grep -E "SKIP|ok"
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add store/postgres/store_test.go store/mongo/store_test.go
git commit --only -m "test(store): run the conformance suite on postgres and mongo when a database is configured" -- \
  store/postgres/store_test.go store/mongo/store_test.go
git show --stat HEAD
```

Expected: both `--- SKIP` with the message naming the variable, `0 issues`.

---
### Task 6: Renderer defaults, one resolution function, and render-by-version

`Variable.Default` is never applied, so the shipped SMS template for MFA codes renders "Expires in <no value>." whenever the caller leaves `expires_in` out. The version lookup is private, so nothing outside the renderer can say which version answers a locale. And `Render` only renders active versions, so a draft can't be previewed. The root package also declares its own `ErrNoVersionForLocale`, `ErrTemplateRenderFailed` and `ErrMissingRequiredVariable`, separate values with the same text as the renderer's, so `errors.Is(err, herald.ErrNoVersionForLocale)` is false for an error the renderer returned.

**Files:**
- Create: `template/resolve.go`, `template/renderer_test.go`, `errors_test.go`
- Modify: `template/renderer.go`, `errors.go`

**Interfaces:**
- Produces:
  - `type template.Match string` with `MatchExact`, `MatchLanguage`, `MatchDefault`, `MatchNone`
  - `type template.Step struct { Try string; Match Match; Found bool; VersionID string }` (JSON `try`, `match`, `found`, `version_id`)
  - `template.Explain(tmpl *Template, locale string) ([]Step, *Version)`: consumed by spec 2's `templates.resolve`
  - `template.Resolve(tmpl *Template, locale string) (*Version, Match)`
  - `(*Renderer).RenderVersion(v *Version, vars []Variable, data map[string]any) (*RenderedContent, error)`
  - `(*Renderer).FuncNames() []string`
  - unexported `withDefaults(vars []Variable, data map[string]any) map[string]any`, used by Task 7

- [ ] **Step 1: Write the failing tests**

`template/renderer_test.go`:

```go
package template

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestDefaultsFillMissingVariables(t *testing.T) {
	tmpl := &Template{
		Slug:      "otp",
		Variables: []Variable{{Name: "expires_in", Required: true, Default: "5 minutes"}},
		Versions:  []Version{{Locale: "", Active: true, Text: "Expires in {{.expires_in}}."}},
	}
	out, err := NewRenderer().Render(tmpl, "en", map[string]any{})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if out.Text != "Expires in 5 minutes." {
		t.Errorf("Text = %q", out.Text)
	}
}

func TestShippedMFATemplateNoLongerSaysNoValue(t *testing.T) {
	var mfa *Template
	for _, tmpl := range DefaultTemplates("app") {
		if tmpl.Slug == "auth.mfa-code" && tmpl.Channel == "sms" {
			mfa = tmpl
		}
	}
	if mfa == nil {
		t.Fatal("auth.mfa-code sms is not among the default templates")
	}
	out, err := NewRenderer().Render(mfa, "en", map[string]any{"code": "123456", "app_name": "Acme"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if strings.Contains(out.Text, "<no value>") || !strings.Contains(out.Text, "5 minutes") {
		t.Errorf("Text = %q, want the declared default and no <no value>", out.Text)
	}
}

func TestDefaultsNeverOverrideOrMutateCallerData(t *testing.T) {
	vars := []Variable{{Name: "role", Default: "member"}}
	data := map[string]any{"role": "admin"}
	got := withDefaults(vars, data)
	if got["role"] != "admin" {
		t.Errorf("default overrode a caller value: %v", got["role"])
	}
	empty := map[string]any{}
	_ = withDefaults(vars, empty)
	if len(empty) != 0 {
		t.Errorf("withDefaults mutated the caller's map: %v", empty)
	}
}

func TestResolve(t *testing.T) {
	tmpl := &Template{Versions: []Version{
		{Locale: "fr", Active: true, Text: "fr"},
		{Locale: "", Active: true, Text: "default"},
		{Locale: "en", Active: true, Text: "en"},
		{Locale: "de", Active: false, Text: "de"},
	}}
	cases := []struct {
		locale string
		text   string
		match  Match
	}{
		{"fr", "fr", MatchExact},
		{"fr-CA", "fr", MatchLanguage},
		{"en-US", "en", MatchLanguage},
		{"de", "default", MatchDefault}, // inactive versions never answer
		{"ja", "default", MatchDefault},
		{"", "default", MatchExact},
	}
	for _, c := range cases {
		v, m := Resolve(tmpl, c.locale)
		if v == nil || v.Text != c.text || m != c.match {
			t.Errorf("Resolve(%q) = %+v, %s; want %s by %s", c.locale, v, m, c.text, c.match)
		}
	}

	enOnly := &Template{Versions: []Version{{Locale: "en", Active: true}}}
	if v, m := Resolve(enOnly, "fr"); v != nil || m != MatchNone {
		t.Errorf("fr on an en-only template = %+v, %s; want none", v, m)
	}
}

func TestExplainListsEveryStep(t *testing.T) {
	enOnly := &Template{Versions: []Version{{Locale: "en", Active: true}}}
	steps, v := Explain(enOnly, "fr-CA")
	if v != nil {
		t.Fatalf("fr-CA answered by %+v", v)
	}
	want := []Step{
		{Try: "fr-CA", Match: MatchExact},
		{Try: "fr", Match: MatchLanguage},
		{Try: "", Match: MatchDefault},
	}
	if !reflect.DeepEqual(steps, want) {
		t.Errorf("steps = %+v, want %+v", steps, want)
	}
}

func TestRenderVersionRendersInactiveVersions(t *testing.T) {
	v := &Version{Locale: "fr", Active: false, Subject: "Bonjour {{.name}}"}
	out, err := NewRenderer().RenderVersion(v, nil, map[string]any{"name": "Ada"})
	if err != nil || out.Subject != "Bonjour Ada" {
		t.Fatalf("RenderVersion = %+v, %v", out, err)
	}
}

func TestRenderStillRefusesMissingRequired(t *testing.T) {
	tmpl := &Template{
		Variables: []Variable{{Name: "code", Required: true}},
		Versions:  []Version{{Active: true, Text: "{{.code}}"}},
	}
	_, err := NewRenderer().Render(tmpl, "en", nil)
	if !errors.Is(err, ErrMissingRequiredVariable) {
		t.Errorf("err = %v, want ErrMissingRequiredVariable", err)
	}
}

func TestFuncNames(t *testing.T) {
	want := []string{"default", "formatDate", "lower", "now", "title", "truncate", "upper"}
	if got := NewRenderer().FuncNames(); !reflect.DeepEqual(got, want) {
		t.Errorf("FuncNames = %v, want %v", got, want)
	}
}
```

`errors_test.go` (root package):

```go
package herald

import (
	"errors"
	"testing"

	"github.com/xraph/herald/template"
)

// The root package's renderer errors must be the renderer's own values, or
// errors.Is against the root name never matches what Render returns.
func TestRendererErrorsAreTheSameValues(t *testing.T) {
	_, err := template.NewRenderer().Render(&template.Template{Slug: "x"}, "en", nil)
	if !errors.Is(err, ErrNoVersionForLocale) {
		t.Errorf("errors.Is(%v, herald.ErrNoVersionForLocale) = false", err)
	}
	if ErrTemplateRenderFailed != template.ErrTemplateRenderFailed ||
		ErrMissingRequiredVariable != template.ErrMissingRequiredVariable {
		t.Error("root renderer errors are separate values from the renderer's")
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./template/ . 2>&1 | head -20`
Expected: FAIL to compile (`Resolve`, `Explain`, `RenderVersion`, `FuncNames`, `withDefaults` undefined).

- [ ] **Step 3: Add resolution**

`template/resolve.go`:

```go
package template

import "strings"

// Match says how a version was chosen for a requested locale.
type Match string

// The ways Resolve can answer a locale, in the order it tries them.
const (
	MatchExact    Match = "exact"    // an active version for the locale itself
	MatchLanguage Match = "language" // "fr" answering "fr-CA"
	MatchDefault  Match = "default"  // the active version with locale ""
	MatchNone     Match = "none"
)

// Step is one lookup Resolve made: the locale it tried, which rule that was,
// and whether an active version answered.
type Step struct {
	Try       string `json:"try"`
	Match     Match  `json:"match"`
	Found     bool   `json:"found"`
	VersionID string `json:"version_id,omitempty"`
}

// Explain returns every lookup Resolve makes for locale, in order, and the
// version that answered (nil when none did). Only active versions count, and
// the configured default locale is never consulted: a locale with no exact,
// language or "" version fails.
func Explain(tmpl *Template, locale string) ([]Step, *Version) {
	var steps []Step
	try := func(want string, m Match) *Version {
		v := firstActive(tmpl, want)
		s := Step{Try: want, Match: m, Found: v != nil}
		if v != nil {
			s.VersionID = v.ID.String()
		}
		steps = append(steps, s)
		return v
	}
	if v := try(locale, MatchExact); v != nil {
		return steps, v
	}
	if lang, _, ok := strings.Cut(locale, "-"); ok && lang != "" {
		if v := try(lang, MatchLanguage); v != nil {
			return steps, v
		}
	}
	if locale != "" {
		if v := try("", MatchDefault); v != nil {
			return steps, v
		}
	}
	return steps, nil
}

// Resolve returns the version that answers locale and how it matched, or
// (nil, MatchNone).
func Resolve(tmpl *Template, locale string) (*Version, Match) {
	steps, v := Explain(tmpl, locale)
	if v == nil {
		return nil, MatchNone
	}
	return v, steps[len(steps)-1].Match
}

func firstActive(tmpl *Template, locale string) *Version {
	for i := range tmpl.Versions {
		if v := &tmpl.Versions[i]; v.Active && v.Locale == locale {
			return v
		}
	}
	return nil
}
```

- [ ] **Step 4: Rework the renderer around it**

In `template/renderer.go`, add `"maps"` and `"sort"` to the imports, delete `findVersion`, and replace `Render` with `Render` plus `RenderVersion`:

```go
// Render renders the version that answers locale (see Resolve) with data,
// after filling declared defaults. It stops at the first field that fails,
// which is what Send wants; Preview is the forgiving variant.
func (r *Renderer) Render(tmpl *Template, locale string, data map[string]any) (*RenderedContent, error) {
	version, match := Resolve(tmpl, locale)
	if match == MatchNone {
		return nil, fmt.Errorf("%w: template=%q locale=%q", ErrNoVersionForLocale, tmpl.Slug, locale)
	}
	return r.RenderVersion(version, tmpl.Variables, data)
}

// RenderVersion renders one version, active or not.
func (r *Renderer) RenderVersion(version *Version, vars []Variable, data map[string]any) (*RenderedContent, error) {
	data = withDefaults(vars, data)
	if err := r.validateVariables(vars, data); err != nil {
		return nil, err
	}

	var result RenderedContent
	var err error
	if version.Subject != "" {
		if result.Subject, err = r.renderText(version.Subject, data); err != nil {
			return nil, fmt.Errorf("%w: subject: %w", ErrTemplateRenderFailed, err)
		}
	}
	if version.HTML != "" {
		if result.HTML, err = r.renderHTML(version.HTML, data); err != nil {
			return nil, fmt.Errorf("%w: html: %w", ErrTemplateRenderFailed, err)
		}
	}
	if version.Text != "" {
		if result.Text, err = r.renderText(version.Text, data); err != nil {
			return nil, fmt.Errorf("%w: text: %w", ErrTemplateRenderFailed, err)
		}
	}
	if version.Title != "" {
		if result.Title, err = r.renderText(version.Title, data); err != nil {
			return nil, fmt.Errorf("%w: title: %w", ErrTemplateRenderFailed, err)
		}
	}
	return &result, nil
}

// FuncNames lists the helper functions templates can call, sorted.
func (r *Renderer) FuncNames() []string {
	names := make([]string, 0, len(r.funcMap))
	for name := range r.funcMap {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// withDefaults returns a copy of data with every declared variable that data
// lacks filled from its Default. The caller's map is never changed, and a
// value the caller supplied always wins.
func withDefaults(vars []Variable, data map[string]any) map[string]any {
	out := make(map[string]any, len(data)+len(vars))
	maps.Copy(out, data)
	for _, v := range vars {
		if v.Default == "" {
			continue
		}
		if _, ok := out[v.Name]; !ok {
			out[v.Name] = v.Default
		}
	}
	return out
}
```

`validateVariables` stays as it is. With defaults applied first, its `v.Default != ""` branch no longer matters, but it's harmless.

- [ ] **Step 5: Make the root errors the renderer's values**

In `errors.go`, add `"github.com/xraph/herald/template"` to the imports and replace the three declarations:

```go
	// ErrNoVersionForLocale is returned when no template version matches the requested locale.
	ErrNoVersionForLocale = template.ErrNoVersionForLocale

	// ErrTemplateRenderFailed is returned when template rendering fails.
	ErrTemplateRenderFailed = template.ErrTemplateRenderFailed

	// ErrMissingRequiredVariable is returned when a required template variable is not provided.
	ErrMissingRequiredVariable = template.ErrMissingRequiredVariable
```

- [ ] **Step 6: Run, lint, commit**

```bash
go test ./template/ . && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add template/resolve.go template/renderer_test.go errors_test.go
git commit --only -m "fix(template): apply variable defaults and resolve versions in one place" -- \
  template/resolve.go template/renderer.go template/renderer_test.go errors.go errors_test.go
git show --stat HEAD
```

Expected: all `ok`, `0 issues`.

---

### Task 7: Preview with positioned diagnostics

The dashboard's editor needs every problem in every field, with a line and column it can put in the gutter, without sending anything. `Render` stops at the first failing field and reports a flat string. `Preview` renders each field on its own and turns Go's three error shapes into structured diagnostics. Every expected position in the tests below was measured by running this exact code before the plan was written.

**Files:**
- Create: `template/diagnostics.go`, `template/preview.go`, `template/preview_test.go`

**Interfaces:**
- Consumes: Task 6's `withDefaults`, the renderer's `funcMap`.
- Produces:
  - `type template.Content struct { Subject, HTML, Text, Title string }` (JSON lower-case names)
  - `type template.Diagnostic struct { Field string; Line, Column int; Severity, Kind, Message string }`
  - constants `SeverityError`, `SeverityWarning`, `KindParse`, `KindExec`, `KindEscape`, `KindMissing`, `KindUndeclared`, `KindUnprovided`
  - `type template.FieldOutput struct { Field, Output string; Rendered bool }`
  - `type template.PreviewResult struct { Fields []FieldOutput; Diagnostics []Diagnostic }`
  - `(*Renderer).Preview(c Content, vars []Variable, data map[string]any) *PreviewResult`

- [ ] **Step 1: Write the failing tests**

`template/preview_test.go`:

```go
package template

import (
	"strings"
	"testing"
)

func only(t *testing.T, res *PreviewResult, want Diagnostic) {
	t.Helper()
	for _, d := range res.Diagnostics {
		if d.Field == want.Field && d.Kind == want.Kind {
			if d.Line != want.Line || d.Column != want.Column || d.Severity != want.Severity {
				t.Errorf("%s/%s at %d:%d (%s), want %d:%d (%s): %s",
					d.Field, d.Kind, d.Line, d.Column, d.Severity, want.Line, want.Column, want.Severity, d.Message)
			}
			if want.Message != "" && d.Message != want.Message {
				t.Errorf("message = %q, want %q", d.Message, want.Message)
			}
			return
		}
	}
	t.Errorf("no %s diagnostic on %q; got %+v", want.Kind, want.Field, res.Diagnostics)
}

func output(res *PreviewResult, field string) (string, bool) {
	for _, f := range res.Fields {
		if f.Field == field {
			return f.Output, f.Rendered
		}
	}
	return "", false
}

var name = []Variable{{Name: "name"}}

func TestParseErrorHasALineAndNoColumn(t *testing.T) {
	res := NewRenderer().Preview(Content{Subject: "Hi {{.name}}", HTML: "<p>\nline2\n{{if .name}}unclosed"}, name, map[string]any{"name": "Ada"})
	only(t, res, Diagnostic{Field: "html", Kind: KindParse, Severity: SeverityError, Line: 3, Column: 0, Message: "unexpected EOF"})
	if out, ok := output(res, "subject"); !ok || out != "Hi Ada" {
		t.Errorf("a broken html field stopped the subject rendering: %q %v", out, ok)
	}
}

func TestExecErrorHasAColumn(t *testing.T) {
	res := NewRenderer().Preview(Content{Text: "x\n  {{ index .name 5 }}"}, name, map[string]any{"name": "Ada"})
	only(t, res, Diagnostic{Field: "text", Kind: KindExec, Severity: SeverityError, Line: 2, Column: 6,
		Message: "<index .name 5>: error calling index: index out of range: 5"})
}

func TestColumnsCountCharactersNotBytes(t *testing.T) {
	// "Ünïcödé " is 12 bytes and 8 characters; "index" starts at character 12.
	res := NewRenderer().Preview(Content{Text: "Ünïcödé {{ index .name 5 }}"}, name, map[string]any{"name": "Ada"})
	only(t, res, Diagnostic{Field: "text", Kind: KindExec, Severity: SeverityError, Line: 1, Column: 12})
}

func TestEscaperErrorsAreTheirOwnKind(t *testing.T) {
	res := NewRenderer().Preview(Content{HTML: "<p>\n{{if .c}}<a href=\"{{else}}<b>{{end}}\">"}, []Variable{{Name: "c"}}, map[string]any{"c": true})
	only(t, res, Diagnostic{Field: "html", Kind: KindEscape, Severity: SeverityError, Line: 2, Column: 6})
}

func TestUnknownFunctionIsAParseError(t *testing.T) {
	res := NewRenderer().Preview(Content{Subject: "{{ nosuch }}", Text: "fine"}, nil, nil)
	only(t, res, Diagnostic{Field: "subject", Kind: KindParse, Severity: SeverityError, Line: 1, Message: `function "nosuch" not defined`})
	if out, ok := output(res, "text"); !ok || out != "fine" {
		t.Errorf("text should still render: %q %v", out, ok)
	}
}

func TestUndeclaredFieldsWarnOncePerName(t *testing.T) {
	res := NewRenderer().Preview(
		Content{Text: "Hi {{.user_name}} {{.missing}} {{.missing}} {{$.other}}"},
		[]Variable{{Name: "user_name"}}, map[string]any{"user_name": "Ada"})
	var got []string
	for _, d := range res.Diagnostics {
		if d.Kind == KindUndeclared {
			got = append(got, d.Message)
		}
	}
	if len(got) != 2 {
		t.Fatalf("undeclared warnings = %v, want one for .missing and one for .other", got)
	}
	only(t, res, Diagnostic{Field: "text", Kind: KindUndeclared, Severity: SeverityWarning, Line: 1, Column: 21,
		Message: ".missing is used but not declared as a variable"})
}

func TestFieldsInsideRangeAreNotUndeclared(t *testing.T) {
	res := NewRenderer().Preview(Content{Text: "{{range .items}}{{.name}}{{end}}"},
		[]Variable{{Name: "items"}}, map[string]any{"items": []map[string]any{{"name": "a"}}})
	if len(res.Diagnostics) != 0 {
		t.Errorf("diagnostics = %+v, want none", res.Diagnostics)
	}
}

func TestMissingAndUnprovidedValues(t *testing.T) {
	res := NewRenderer().Preview(Content{Text: "{{.a}} {{.b}} {{.c}}"},
		[]Variable{{Name: "a", Required: true}, {Name: "b"}, {Name: "c", Default: "dflt"}}, map[string]any{})
	only(t, res, Diagnostic{Kind: KindMissing, Severity: SeverityError,
		Message: `required variable "a" has no value and no default`})
	only(t, res, Diagnostic{Kind: KindUnprovided, Severity: SeverityWarning})
	// Go's own behaviour, shown rather than hidden: a missing value is
	// "<no value>" in text and nothing in HTML.
	if out, _ := output(res, "text"); out != "<no value> <no value> dflt" {
		t.Errorf("text = %q", out)
	}
}

func TestHTMLIsEscaped(t *testing.T) {
	res := NewRenderer().Preview(Content{HTML: "<p>{{.v}}</p>"}, []Variable{{Name: "v"}}, map[string]any{"v": "<b>x</b>"})
	if out, _ := output(res, "html"); out != "<p>&lt;b&gt;x&lt;/b&gt;</p>" {
		t.Errorf("html = %q", out)
	}
}

func TestEveryFieldIsListedInOrder(t *testing.T) {
	res := NewRenderer().Preview(Content{Text: "t"}, nil, nil)
	var fields []string
	for _, f := range res.Fields {
		fields = append(fields, f.Field)
	}
	if strings.Join(fields, ",") != "subject,html,text,title" {
		t.Errorf("fields = %v", fields)
	}
	if _, ok := output(res, "subject"); ok {
		t.Error("an empty field reported Rendered")
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./template/ -run 'Preview|Error|Column|Undeclared|Range|Missing|HTMLIs|EveryField|Unknown' 2>&1 | head`
Expected: FAIL to compile (`Preview`, `Content`, `Diagnostic` undefined).

- [ ] **Step 3: Add the diagnostics parser**

`template/diagnostics.go`:

```go
package template

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Diagnostic is one problem found while previewing a template. Positions are
// 1-based; a zero Line or Column means Go did not report one.
type Diagnostic struct {
	Field    string `json:"field"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Severity string `json:"severity"`
	Kind     string `json:"kind"`
	Message  string `json:"message"`
}

// Diagnostic severities and kinds.
const (
	SeverityError   = "error"
	SeverityWarning = "warning"

	KindParse      = "parse"
	KindExec       = "exec"
	KindEscape     = "escape"
	KindMissing    = "missing"
	KindUndeclared = "undeclared"
	KindUnprovided = "unprovided"
)

// goError matches the three shapes Go's template packages produce when the
// template is named after its field:
//
//	template: html:3: unexpected EOF                        (parse: line only)
//	template: html:2:5: executing "html" at <.x>: ...       (exec: line, byte column)
//	html/template:html:2:5: {{if}} branches end in ...      (escaper: line, byte column)
var goError = regexp.MustCompile(`^(html/template:|template: )([a-z]*)(?::(\d+))?(?::(\d+))?: (.*)$`)

var execPrefix = regexp.MustCompile(`^executing "[^"]*" at (<.*?>): (.*)$`)

// diagnose turns an error from parsing or executing one field into a
// Diagnostic, converting Go's 0-based byte column into a 1-based character
// column on the field's own source line.
func diagnose(field, src string, err error) Diagnostic {
	d := Diagnostic{Field: field, Severity: SeverityError, Kind: KindParse, Message: err.Error()}
	m := goError.FindStringSubmatch(err.Error())
	if m == nil {
		return d
	}
	d.Message = m[5]
	if m[1] == "html/template:" {
		d.Kind = KindEscape
	} else if x := execPrefix.FindStringSubmatch(d.Message); x != nil {
		d.Kind = KindExec
		d.Message = x[1] + ": " + x[2]
	}
	if m[3] != "" {
		d.Line, _ = strconv.Atoi(m[3])
	}
	if m[4] != "" {
		byteCol, _ := strconv.Atoi(m[4])
		d.Column = charColumn(src, d.Line, byteCol)
	}
	return d
}

// charColumn converts a 0-based byte offset within a 1-based line of src into
// a 1-based character column.
func charColumn(src string, line, byteCol int) int {
	lines := strings.Split(src, "\n")
	if line < 1 || line > len(lines) {
		return 0
	}
	l := lines[line-1]
	if byteCol > len(l) {
		byteCol = len(l)
	}
	return utf8.RuneCountInString(l[:byteCol]) + 1
}

var location = regexp.MustCompile(`:(\d+):(\d+)$`)

// position returns the 1-based line and character column of a parse-tree
// location string ("name:line:byteCol").
func position(src, loc string) (int, int) {
	m := location.FindStringSubmatch(loc)
	if m == nil {
		return 0, 0
	}
	line, _ := strconv.Atoi(m[1])
	byteCol, _ := strconv.Atoi(m[2])
	return line, charColumn(src, line, byteCol)
}
```

- [ ] **Step 4: Add Preview**

`template/preview.go`:

```go
package template

import (
	"bytes"
	"fmt"
	htmltpl "html/template"
	texttpl "text/template"
	"text/template/parse"
)

// Content is the editable text of one version: a saved version or an unsaved
// editor buffer.
type Content struct {
	Subject string `json:"subject"`
	HTML    string `json:"html"`
	Text    string `json:"text"`
	Title   string `json:"title"`
}

// FieldOutput is one field's rendered text. Rendered is false when the field
// was empty or failed.
type FieldOutput struct {
	Field    string `json:"field"`
	Output   string `json:"output"`
	Rendered bool   `json:"rendered"`
}

// PreviewResult is every field's output and every problem found.
type PreviewResult struct {
	Fields      []FieldOutput `json:"fields"`
	Diagnostics []Diagnostic  `json:"diagnostics"`
}

// Preview renders every field of c independently against data, with variable
// defaults applied, and reports every problem as a Diagnostic. It never
// returns an error and never stops at the first failure, so a broken HTML body
// doesn't hide a broken subject. Nothing is sent.
func (r *Renderer) Preview(c Content, vars []Variable, data map[string]any) *PreviewResult {
	data = withDefaults(vars, data)
	declared := make(map[string]bool, len(vars))
	for _, v := range vars {
		declared[v.Name] = true
	}

	res := &PreviewResult{Fields: []FieldOutput{}, Diagnostics: []Diagnostic{}}
	for _, f := range []struct {
		name, src string
		html      bool
	}{
		{"subject", c.Subject, false},
		{"html", c.HTML, true},
		{"text", c.Text, false},
		{"title", c.Title, false},
	} {
		out := FieldOutput{Field: f.name}
		if f.src != "" {
			rendered, tree, err := r.renderField(f.name, f.src, f.html, data)
			if err != nil {
				res.Diagnostics = append(res.Diagnostics, diagnose(f.name, f.src, err))
			} else {
				out.Output, out.Rendered = rendered, true
			}
			if tree != nil {
				res.Diagnostics = append(res.Diagnostics, undeclared(f.name, f.src, tree, declared)...)
			}
		}
		res.Fields = append(res.Fields, out)
	}
	res.Diagnostics = append(res.Diagnostics, missingValues(vars, data)...)
	return res
}

// renderField parses and executes one field. The template is named after the
// field so Go's error messages say where they came from. The parse tree is
// returned whenever parsing succeeded, even if execution failed.
func (r *Renderer) renderField(name, src string, html bool, data map[string]any) (string, *parse.Tree, error) {
	var buf bytes.Buffer
	if html {
		t, err := htmltpl.New(name).Funcs(htmltpl.FuncMap(r.funcMap)).Parse(src)
		if err != nil {
			return "", nil, err
		}
		if err := t.Execute(&buf, data); err != nil {
			return "", t.Tree, err
		}
		return buf.String(), t.Tree, nil
	}
	t, err := texttpl.New(name).Funcs(r.funcMap).Parse(src)
	if err != nil {
		return "", nil, err
	}
	if err := t.Execute(&buf, data); err != nil {
		return "", t.Tree, err
	}
	return buf.String(), t.Tree, nil
}

// undeclared warns once per name about a top-level field (.name or $.name)
// that no declared variable covers. Fields inside range and with bodies are
// skipped, because the dot has moved there.
func undeclared(field, src string, tree *parse.Tree, declared map[string]bool) []Diagnostic {
	var out []Diagnostic
	seen := map[string]bool{}
	walk(tree.Root, func(name string, n parse.Node) {
		if declared[name] || seen[name] {
			return
		}
		seen[name] = true
		loc, _ := tree.ErrorContext(n)
		line, col := position(src, loc)
		out = append(out, Diagnostic{
			Field: field, Line: line, Column: col,
			Severity: SeverityWarning, Kind: KindUndeclared,
			Message: fmt.Sprintf(".%s is used but not declared as a variable", name),
		})
	})
	return out
}

func walk(node parse.Node, visit func(name string, n parse.Node)) {
	switch n := node.(type) {
	case *parse.ListNode:
		if n == nil {
			return
		}
		for _, c := range n.Nodes {
			walk(c, visit)
		}
	case *parse.ActionNode:
		walk(n.Pipe, visit)
	case *parse.PipeNode:
		if n == nil {
			return
		}
		for _, c := range n.Cmds {
			walk(c, visit)
		}
	case *parse.CommandNode:
		for _, a := range n.Args {
			walk(a, visit)
		}
	case *parse.FieldNode:
		visit(n.Ident[0], n)
	case *parse.VariableNode:
		if len(n.Ident) > 1 && n.Ident[0] == "$" {
			visit(n.Ident[1], n)
		}
	case *parse.ChainNode:
		walk(n.Node, visit)
	case *parse.IfNode:
		walk(n.Pipe, visit)
		walk(n.List, visit)
		walk(n.ElseList, visit)
	case *parse.RangeNode:
		walk(n.Pipe, visit)
		walk(n.ElseList, visit)
	case *parse.WithNode:
		walk(n.Pipe, visit)
		walk(n.ElseList, visit)
	case *parse.TemplateNode:
		walk(n.Pipe, visit)
	}
}

// missingValues reports declared variables with no value in data after
// defaults were applied: an error for a required one, because Render would
// refuse it, and a warning for an optional one.
func missingValues(vars []Variable, data map[string]any) []Diagnostic {
	var out []Diagnostic
	for _, v := range vars {
		if _, ok := data[v.Name]; ok {
			continue
		}
		if v.Required {
			out = append(out, Diagnostic{
				Severity: SeverityError, Kind: KindMissing,
				Message: fmt.Sprintf("required variable %q has no value and no default", v.Name),
			})
			continue
		}
		out = append(out, Diagnostic{
			Severity: SeverityWarning, Kind: KindUnprovided,
			Message: fmt.Sprintf("%q has no sample value, so it renders as <no value> in text and nothing in HTML", v.Name),
		})
	}
	return out
}
```

- [ ] **Step 5: Run, lint, commit**

```bash
go test ./template/ && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add template/diagnostics.go template/preview.go template/preview_test.go
git commit --only -m "feat(template): preview every field and report problems with their position" -- \
  template/diagnostics.go template/preview.go template/preview_test.go
git show --stat HEAD
```

Expected: all `ok`, `0 issues`. If lint flags `htmltpl.FuncMap(r.funcMap)` as an unnecessary conversion, keep it: `html/template` and `text/template` have distinct `FuncMap` types and the conversion is required.

---

### Task 8: The credential package

Credentials are plaintext at rest in all four backends. This task adds the format and the cipher; Task 12 wires it into provider writes and `Send`. The package was built and its tests run before this plan was written.

**Files:**
- Create: `credential/credential.go`, `credential/credential_test.go`

**Interfaces:**
- Produces:
  - `credential.KeySize = 32`, `credential.ProtectionAESGCM = "aes-256-gcm"`, `credential.ProtectionPlaintext = "plaintext"`
  - `credential.ErrKeyUnavailable`, `credential.ErrMalformed`
  - `type credential.Key struct { ID string; Bytes []byte }`
  - `credential.NewCipher(primary Key, previous ...Key) (*Cipher, error)`
  - `credential.ParseKey(encoded string) ([]byte, error)` (standard base64, 32 bytes)
  - `(*Cipher).KeyID() string`, `(*Cipher).Encrypt(providerID, name, plaintext string) (string, error)`, `(*Cipher).Decrypt(providerID, name, value string) (string, error)`; a nil `*Cipher` passes plaintext through and refuses ciphertext
  - `credential.IsEncrypted(value string) bool`, `credential.Describe(value string) (protection, keyID string)`

- [ ] **Step 1: Write the failing tests**

`credential/credential_test.go`:

```go
package credential

import (
	"bytes"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

func key(id string, b byte) Key { return Key{ID: id, Bytes: bytes.Repeat([]byte{b}, KeySize)} }

func TestRoundTrip(t *testing.T) {
	c, err := NewCipher(key("k1", 1))
	if err != nil {
		t.Fatal(err)
	}
	enc, err := c.Encrypt("hpvd_1", "api_key", "sk_live_canary")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enc, "enc:v1:k1:") || strings.Contains(enc, "canary") {
		t.Fatalf("unexpected ciphertext %q", enc)
	}
	got, err := c.Decrypt("hpvd_1", "api_key", enc)
	if err != nil || got != "sk_live_canary" {
		t.Fatalf("Decrypt = %q, %v", got, err)
	}
	if p, k := Describe(enc); p != ProtectionAESGCM || k != "k1" {
		t.Errorf("Describe = %q, %q", p, k)
	}
}

func TestNonceIsFreshEachTime(t *testing.T) {
	c, _ := NewCipher(key("k1", 1))
	a, _ := c.Encrypt("p", "k", "same")
	b, _ := c.Encrypt("p", "k", "same")
	if a == b {
		t.Error("two encryptions of the same value produced the same ciphertext")
	}
}

func TestAADBindsProviderAndName(t *testing.T) {
	c, _ := NewCipher(key("k1", 1))
	enc, _ := c.Encrypt("hpvd_1", "api_key", "secret")
	if _, err := c.Decrypt("hpvd_2", "api_key", enc); !errors.Is(err, ErrMalformed) {
		t.Errorf("copied to another provider: err = %v, want ErrMalformed", err)
	}
	if _, err := c.Decrypt("hpvd_1", "password", enc); !errors.Is(err, ErrMalformed) {
		t.Errorf("moved to another key name: err = %v, want ErrMalformed", err)
	}
}

func TestPlaintextPassesThrough(t *testing.T) {
	var c *Cipher
	got, err := c.Decrypt("p", "k", "plain-value")
	if err != nil || got != "plain-value" {
		t.Fatalf("nil cipher on plaintext = %q, %v", got, err)
	}
	if p, k := Describe("plain-value"); p != ProtectionPlaintext || k != "" {
		t.Errorf("Describe(plaintext) = %q, %q", p, k)
	}
}

func TestUnknownKeyIsNamed(t *testing.T) {
	old, _ := NewCipher(key("k0", 9))
	enc, _ := old.Encrypt("p", "k", "secret")

	current, _ := NewCipher(key("k1", 1))
	_, err := current.Decrypt("p", "k", enc)
	if !errors.Is(err, ErrKeyUnavailable) || !strings.Contains(err.Error(), "k0") {
		t.Errorf("err = %v, want ErrKeyUnavailable naming k0", err)
	}
	var none *Cipher
	if _, err := none.Decrypt("p", "k", enc); !errors.Is(err, ErrKeyUnavailable) {
		t.Errorf("nil cipher on ciphertext: err = %v", err)
	}
}

func TestPreviousKeysDecryptOnly(t *testing.T) {
	old, _ := NewCipher(key("k0", 9))
	enc, _ := old.Encrypt("p", "k", "secret")
	rotated, err := NewCipher(key("k1", 1), key("k0", 9))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := rotated.Decrypt("p", "k", enc); err != nil || got != "secret" {
		t.Fatalf("previous key decrypt = %q, %v", got, err)
	}
	fresh, _ := rotated.Encrypt("p", "k", "secret")
	if _, k := Describe(fresh); k != "k1" {
		t.Errorf("new values must use the primary key, got %q", k)
	}
}

func TestTamperedPayloadIsRefused(t *testing.T) {
	c, _ := NewCipher(key("k1", 1))
	enc, _ := c.Encrypt("p", "k", "secret")
	i := len(enc) - 2
	flipped := enc[:i] + string(rune(enc[i]^1)) + enc[i+1:]
	if _, err := c.Decrypt("p", "k", flipped); err == nil {
		t.Error("a tampered value decrypted")
	}
	for _, bad := range []string{"enc:v1:", "enc:v1:k1", "enc:v1::abc", "enc:v1:k1:!!!"} {
		if _, err := c.Decrypt("p", "k", bad); err == nil {
			t.Errorf("Decrypt(%q) succeeded", bad)
		}
	}
}

func TestKeyValidation(t *testing.T) {
	for name, k := range map[string]Key{
		"short":    {ID: "k1", Bytes: make([]byte, 16)},
		"empty id": {ID: "", Bytes: make([]byte, KeySize)},
		"colon id": {ID: "k:1", Bytes: make([]byte, KeySize)},
	} {
		if _, err := NewCipher(k); err == nil {
			t.Errorf("%s: NewCipher accepted it", name)
		}
	}
	if _, err := NewCipher(key("k1", 1), key("k1", 2)); err == nil {
		t.Error("duplicate key IDs accepted")
	}
	if _, err := ParseKey(base64.StdEncoding.EncodeToString(make([]byte, 16))); err == nil {
		t.Error("ParseKey accepted a 16-byte key")
	}
	if b, err := ParseKey(base64.StdEncoding.EncodeToString(make([]byte, KeySize))); err != nil || len(b) != KeySize {
		t.Errorf("ParseKey(valid) = %d bytes, %v", len(b), err)
	}
}
```

- [ ] **Step 2: Run them and watch them fail**

Run: `go test ./credential/`
Expected: FAIL to compile (package has no non-test files).

- [ ] **Step 3: Implement the package**

`credential/credential.go`:

```go
// Package credential encrypts provider credential values at rest.
//
// An encrypted value is self-describing:
//
//	enc:v1:<keyID>:<base64url(nonce || AES-256-GCM ciphertext)>
//
// so protection is a property of each stored value, never of the config.
// Anything without the prefix is plaintext. The additional authenticated data
// is the provider ID and the credential's key joined by a zero byte, so a
// ciphertext copied into another provider, or under another key name, fails
// to decrypt instead of quietly becoming someone else's secret.
package credential

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const prefix = "enc:v1:"

// KeySize is the only key length accepted: AES-256.
const KeySize = 32

// Protection values reported per credential value.
const (
	ProtectionAESGCM    = "aes-256-gcm"
	ProtectionPlaintext = "plaintext"
)

var (
	// ErrKeyUnavailable means a value was encrypted under a key ID that isn't
	// configured, or no key is configured at all.
	ErrKeyUnavailable = errors.New("credential key is not configured")
	// ErrMalformed means a value has the encrypted prefix but can't be read.
	ErrMalformed = errors.New("credential value is malformed")
)

// Key is one AES-256 key and the ID stored beside every value it encrypts.
type Key struct {
	ID    string
	Bytes []byte
}

// Cipher encrypts with its primary key and decrypts with any configured key.
// A nil *Cipher is valid: it passes plaintext through and refuses ciphertext.
type Cipher struct {
	primary string
	aeads   map[string]cipher.AEAD
}

// NewCipher builds a Cipher that encrypts with primary and can also decrypt
// values written under any of previous.
func NewCipher(primary Key, previous ...Key) (*Cipher, error) {
	c := &Cipher{primary: primary.ID, aeads: map[string]cipher.AEAD{}}
	for _, k := range append([]Key{primary}, previous...) {
		if k.ID == "" || strings.Contains(k.ID, ":") {
			return nil, fmt.Errorf("credential: key ID %q must be non-empty and contain no colon", k.ID)
		}
		if len(k.Bytes) != KeySize {
			return nil, fmt.Errorf("credential: key %q is %d bytes, want %d", k.ID, len(k.Bytes), KeySize)
		}
		if _, dup := c.aeads[k.ID]; dup {
			return nil, fmt.Errorf("credential: key ID %q is configured twice", k.ID)
		}
		block, err := aes.NewCipher(k.Bytes)
		if err != nil {
			return nil, fmt.Errorf("credential: key %q: %w", k.ID, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("credential: key %q: %w", k.ID, err)
		}
		c.aeads[k.ID] = aead
	}
	return c, nil
}

// ParseKey decodes a standard base64 key and checks its length.
func ParseKey(encoded string) ([]byte, error) {
	b, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("credential: key is not valid base64: %w", err)
	}
	if len(b) != KeySize {
		return nil, fmt.Errorf("credential: key is %d bytes, want %d", len(b), KeySize)
	}
	return b, nil
}

// KeyID is the ID of the key new values are encrypted under, or "" for a nil
// Cipher.
func (c *Cipher) KeyID() string {
	if c == nil {
		return ""
	}
	return c.primary
}

// Encrypt seals plaintext for one credential of one provider.
func (c *Cipher) Encrypt(providerID, name, plaintext string) (string, error) {
	if c == nil {
		return "", ErrKeyUnavailable
	}
	aead := c.aeads[c.primary]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("credential: nonce: %w", err)
	}
	sealed := aead.Seal(nonce, nonce, []byte(plaintext), aad(providerID, name))
	return prefix + c.primary + ":" + base64.RawURLEncoding.EncodeToString(sealed), nil
}

// Decrypt opens a stored value. Plaintext passes through unchanged, so callers
// can decrypt a map without checking each value first.
func (c *Cipher) Decrypt(providerID, name, value string) (string, error) {
	if !IsEncrypted(value) {
		return value, nil
	}
	keyID, payload, ok := strings.Cut(strings.TrimPrefix(value, prefix), ":")
	if !ok || keyID == "" {
		return "", ErrMalformed
	}
	if c == nil {
		return "", fmt.Errorf("%w: %s", ErrKeyUnavailable, keyID)
	}
	aead, ok := c.aeads[keyID]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrKeyUnavailable, keyID)
	}
	sealed, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || len(sealed) < aead.NonceSize() {
		return "", ErrMalformed
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], aad(providerID, name))
	if err != nil {
		return "", fmt.Errorf("%w: authentication failed", ErrMalformed)
	}
	return string(plain), nil
}

// IsEncrypted reports whether a stored value carries the encrypted prefix.
func IsEncrypted(value string) bool { return strings.HasPrefix(value, prefix) }

// Describe reports how one stored value is protected, and under which key.
// An absent marker means plaintext, never "unknown".
func Describe(value string) (protection, keyID string) {
	if !IsEncrypted(value) {
		return ProtectionPlaintext, ""
	}
	keyID, _, _ = strings.Cut(strings.TrimPrefix(value, prefix), ":")
	return ProtectionAESGCM, keyID
}

func aad(providerID, name string) []byte {
	return []byte(providerID + "\x00" + name)
}
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./credential/ && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add credential/credential.go credential/credential_test.go
git commit --only -m "feat(credential): encrypt provider credential values with self-describing markers" -- \
  credential/credential.go credential/credential_test.go
git show --stat HEAD
```

Expected: `ok`, `0 issues`. If `gosec` flags the random nonce read or the AAD construction, read the finding before silencing it; the nonce comes from `crypto/rand` and is the GCM standard size.

---
### Task 9: Driver field schema, and the five built-in drivers

No driver says which fields it needs, which are secret, or whether a field belongs in credentials or settings. The templ form offered three free-form rows. This task adds an optional `Describer` interface and implements it for the five drivers in the main module. Task 10 does the eleven driver modules.

Two rules the tests enforce for every driver: a secret field always has `PlacementCredential` (so it is encrypted and never echoed as a setting), and filling every required field with a plausible value passes the driver's own `Validate` against the merged map, which is exactly what `ValidateProvider` will do in Task 12.

**Files:**
- Create: `driver/fields.go`, `driver/fields_test.go`
- Create: `driver/email/fields.go`, `driver/sms/fields.go`, `driver/push/fields.go`, `driver/inapp/fields.go`

**Interfaces:**
- Produces:
  - `type driver.Placement string`, `driver.PlacementCredential = "credential"`, `driver.PlacementSetting = "setting"`
  - `type driver.Field struct { Key, Label, Help string; Required, Secret bool; Placement Placement }` (JSON `key`, `label`, `help`, `required`, `secret`, `placement`)
  - `type driver.Describer interface { Fields() []Field }`
  - `(*driver.Registry).Describe(name string) ([]Field, bool)`: `false` for an unknown driver or one without `Describer`; `([]Field{}, true)` for a driver that needs nothing (inapp)
  - `driver.SenderFields() []Field`: the `from` and `from_name` settings Herald itself reads for email

- [ ] **Step 1: Write the failing tests**

`driver/fields_test.go`:

```go
package driver_test

import (
	"context"
	"testing"

	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/driver/email"
	"github.com/xraph/herald/driver/inapp"
	"github.com/xraph/herald/driver/push"
	"github.com/xraph/herald/driver/sms"
)

type describedDriver interface {
	driver.Driver
	driver.Describer
}

// checkFields is the rule every driver's schema must satisfy. extra adds
// values for either/or requirements the schema can't mark as required.
func checkFields(t *testing.T, d describedDriver, extra map[string]string) {
	t.Helper()
	seen := map[string]bool{}
	merged := map[string]string{}
	for _, f := range d.Fields() {
		if seen[f.Key] {
			t.Errorf("%s: field %q declared twice", d.Name(), f.Key)
		}
		seen[f.Key] = true
		if f.Label == "" {
			t.Errorf("%s: field %q has no label", d.Name(), f.Key)
		}
		if f.Secret && f.Placement != driver.PlacementCredential {
			t.Errorf("%s: secret field %q must be a credential", d.Name(), f.Key)
		}
		if f.Placement != driver.PlacementCredential && f.Placement != driver.PlacementSetting {
			t.Errorf("%s: field %q has placement %q", d.Name(), f.Key, f.Placement)
		}
		if f.Required {
			merged[f.Key] = "x"
		}
	}
	for k, v := range extra {
		merged[k] = v
	}
	if err := d.Validate(merged, nil); err != nil {
		t.Errorf("%s: required fields filled, Validate still says: %v", d.Name(), err)
	}
}

func TestBuiltInSchemas(t *testing.T) {
	checkFields(t, &email.SMTPDriver{}, nil)
	checkFields(t, &email.ResendDriver{}, nil)
	checkFields(t, &sms.TwilioDriver{}, nil)
	checkFields(t, &push.FCMDriver{}, map[string]string{"access_token": "x"})
	checkFields(t, &inapp.Driver{}, nil)
}

type bare struct{}

func (bare) Name() string                                  { return "bare" }
func (bare) Channel() string                               { return "email" }
func (bare) Validate(_, _ map[string]string) error         { return nil }
func (bare) Send(context.Context, *driver.OutboundMessage) (*driver.DeliveryResult, error) {
	return &driver.DeliveryResult{}, nil
}

func TestDescribe(t *testing.T) {
	r := driver.NewRegistry()
	r.Register(&email.SMTPDriver{})
	r.Register(&inapp.Driver{})
	r.Register(bare{})

	if fields, ok := r.Describe("smtp"); !ok || len(fields) == 0 {
		t.Errorf("smtp: %v %v", fields, ok)
	}
	if fields, ok := r.Describe("inapp"); !ok || fields == nil || len(fields) != 0 {
		t.Errorf("inapp needs nothing, and says so: %v %v", fields, ok)
	}
	if _, ok := r.Describe("bare"); ok {
		t.Error("a driver without Describer must report false, so the form falls back to key/value rows")
	}
	if _, ok := r.Describe("nope"); ok {
		t.Error("an unknown driver must report false")
	}
}
```

Run: `go test ./driver/`
Expected: FAIL to compile (`driver.Describer`, `Fields`, `Describe` undefined).

- [ ] **Step 2: Add the schema types**

`driver/fields.go`:

```go
package driver

// Placement says which provider map a field lives in. Credentials are
// encrypted at rest when a key is configured and never echoed back; settings
// are plain configuration.
type Placement string

// Placements.
const (
	PlacementCredential Placement = "credential"
	PlacementSetting    Placement = "setting"
)

// Field describes one value a driver reads from a provider.
type Field struct {
	Key       string    `json:"key"`
	Label     string    `json:"label"`
	Help      string    `json:"help,omitempty"`
	Required  bool      `json:"required"`
	Secret    bool      `json:"secret"`
	Placement Placement `json:"placement"`
}

// Describer is optional. A driver that implements it gets a form built from
// its fields; one that doesn't gets free-form key/value editing.
type Describer interface {
	Fields() []Field
}

// Describe returns a registered driver's fields. The bool is false for an
// unknown driver and for one that doesn't implement Describer.
func (r *Registry) Describe(name string) ([]Field, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	d, ok := r.drivers[name]
	if !ok {
		return nil, false
	}
	desc, ok := d.(Describer)
	if !ok {
		return nil, false
	}
	fields := desc.Fields()
	if fields == nil {
		fields = []Field{}
	}
	return fields, true
}

// SenderFields are the settings Herald reads itself for email: the from
// address and display name, used when no scoped config supplies them.
func SenderFields() []Field {
	return []Field{
		{Key: "from", Label: "From address", Help: "Used when no routing rule sets one.", Placement: PlacementSetting},
		{Key: "from_name", Label: "From name", Placement: PlacementSetting},
	}
}
```

- [ ] **Step 3: Describe the five built-in drivers**

`driver/email/fields.go`:

```go
package email

import "github.com/xraph/herald/driver"

var (
	_ driver.Describer = (*SMTPDriver)(nil)
	_ driver.Describer = (*ResendDriver)(nil)
)

// Fields describes what the SMTP driver reads.
func (d *SMTPDriver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "host", Label: "Host", Required: true, Placement: driver.PlacementSetting},
		{Key: "port", Label: "Port", Required: true, Help: "Usually 587, or 465 with implicit TLS.", Placement: driver.PlacementSetting},
		{Key: "use_tls", Label: "Implicit TLS", Help: `"true" to connect over TLS from the start (port 465).`, Placement: driver.PlacementSetting},
		{Key: "username", Label: "Username", Placement: driver.PlacementCredential},
		{Key: "password", Label: "Password", Secret: true, Placement: driver.PlacementCredential},
	}, driver.SenderFields()...)
}

// Fields describes what the Resend driver reads.
func (d *ResendDriver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "api_key", Label: "API key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "base_url", Label: "API base URL", Help: "Leave empty for Resend's own API.", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`driver/sms/fields.go`:

```go
package sms

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*TwilioDriver)(nil)

// Fields describes what the Twilio driver reads.
func (d *TwilioDriver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "account_sid", Label: "Account SID", Required: true, Placement: driver.PlacementCredential},
		{Key: "auth_token", Label: "Auth token", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "from_number", Label: "From number", Required: true, Help: "E.164, e.g. +15550100. A routing rule's from phone overrides it.", Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Help: "Leave empty for Twilio's own API.", Placement: driver.PlacementSetting},
	}
}
```

`driver/push/fields.go`:

```go
package push

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*FCMDriver)(nil)

// Fields describes what the FCM driver reads. It needs one of access_token or
// server_key; the schema can't express "one of", so neither is required here
// and Validate enforces it.
func (d *FCMDriver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "project_id", Label: "Project ID", Required: true, Placement: driver.PlacementSetting},
		{Key: "access_token", Label: "OAuth access token", Help: "Set this or a server key. Tokens are short-lived and Herald does not refresh them.", Secret: true, Placement: driver.PlacementCredential},
		{Key: "server_key", Label: "Server key", Help: "Legacy key. Set this or an access token.", Secret: true, Placement: driver.PlacementCredential},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}
}
```

`driver/inapp/fields.go`:

```go
package inapp

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields is empty: the in-app driver needs no configuration. That's a
// different answer from a driver that doesn't describe itself at all.
func (d *Driver) Fields() []driver.Field { return []driver.Field{} }
```

- [ ] **Step 4: Run, lint, commit**

```bash
go test ./driver/... && go build ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add driver/fields.go driver/fields_test.go driver/email/fields.go driver/sms/fields.go driver/push/fields.go driver/inapp/fields.go
git commit --only -m "feat(driver): let drivers describe their fields and which ones are secret" -- \
  driver/fields.go driver/fields_test.go driver/email/fields.go driver/sms/fields.go driver/push/fields.go driver/inapp/fields.go
git show --stat HEAD
```

Expected: `ok`, `0 issues`.

---

### Task 10: Field schemas for the eleven driver modules

Each driver under `drivers/` is its own Go module with `replace github.com/xraph/herald => ../../`, so it sees Task 9's types straight away. Every step below runs from inside the module directory. Each module gets a `fields.go` and a `fields_test.go` with the same two rules as Task 9.

**Files (per module `<m>` in apns, cloudflare, discord, mailgun, messagebird, postmark, sendgrid, ses, slack, vonage, webhook):**
- Create: `drivers/<m>/fields.go`, `drivers/<m>/fields_test.go`

**Interfaces:**
- Consumes: `driver.Field`, `driver.Describer`, `driver.SenderFields()` from Task 9.
- Produces: `(*Driver).Fields() []driver.Field` in each module.

- [ ] **Step 1: The shared test shape**

Every module's `fields_test.go` uses this body, with the driver-specific `extra` map shown in Step 2:

```go
package <m>

import (
	"testing"

	"github.com/xraph/herald/driver"
)

func TestFieldsCoverValidate(t *testing.T) {
	d := &Driver{}
	merged := map[string]string{}
	seen := map[string]bool{}
	for _, f := range d.Fields() {
		if seen[f.Key] {
			t.Errorf("field %q declared twice", f.Key)
		}
		seen[f.Key] = true
		if f.Secret && f.Placement != driver.PlacementCredential {
			t.Errorf("secret field %q must be a credential", f.Key)
		}
		if f.Required {
			merged[f.Key] = "x"
		}
	}
	for k, v := range extra(t) {
		merged[k] = v
	}
	if err := d.Validate(merged, nil); err != nil {
		t.Fatalf("required fields filled, Validate still says: %v", err)
	}
}
```

For every module except apns and slack, add below it:

```go
func extra(*testing.T) map[string]string { return nil }
```

Run for one module to see the failure shape: `(cd drivers/mailgun && go test ./...)`
Expected: FAIL to compile (`d.Fields` undefined, and `extra` undefined until you add it).

- [ ] **Step 2: Write each module's fields**

`drivers/apns/fields.go`:

```go
package apns

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the APNs driver reads.
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "key_id", Label: "Key ID", Required: true, Placement: driver.PlacementSetting},
		{Key: "team_id", Label: "Team ID", Required: true, Placement: driver.PlacementSetting},
		{Key: "bundle_id", Label: "Bundle ID", Required: true, Help: "Sent as the apns-topic header.", Placement: driver.PlacementSetting},
		{Key: "private_key", Label: "Private key (.p8)", Required: true, Secret: true, Help: "The PKCS#8 PEM from Apple.", Placement: driver.PlacementCredential},
		{Key: "sandbox", Label: "Sandbox", Help: `"true" to use Apple's development servers.`, Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}
}
```

APNs' `Validate` parses the key, so its test supplies a real one. Its `extra`:

```go
import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
)

func extra(t *testing.T) map[string]string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))}
}
```

(Merge those imports into the test file's import block.)

`drivers/cloudflare/fields.go`:

```go
package cloudflare

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Cloudflare email driver reads.
func (d *Driver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "api_token", Label: "API token", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "account_id", Label: "Account ID", Required: true, Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`drivers/discord/fields.go`:

```go
package discord

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Discord driver reads. The webhook URL embeds its
// own token, so it is a secret.
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "webhook_url", Label: "Webhook URL", Required: true, Secret: true, Help: "Contains Discord's token, so treat it like a password.", Placement: driver.PlacementCredential},
	}
}
```

`drivers/mailgun/fields.go`:

```go
package mailgun

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Mailgun driver reads.
func (d *Driver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "api_key", Label: "API key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "domain", Label: "Sending domain", Required: true, Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Help: "Set to the EU endpoint for EU domains.", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`drivers/messagebird/fields.go`:

```go
package messagebird

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the MessageBird driver reads.
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "access_key", Label: "Access key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "originator", Label: "Originator", Required: true, Help: "Sender number or name. A routing rule's from phone overrides it.", Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}
}
```

`drivers/postmark/fields.go`:

```go
package postmark

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Postmark driver reads.
func (d *Driver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "server_token", Label: "Server token", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`drivers/sendgrid/fields.go`:

```go
package sendgrid

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the SendGrid driver reads.
func (d *Driver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "api_key", Label: "API key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`drivers/ses/fields.go`:

```go
package ses

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the SES driver reads. Session tokens aren't
// supported, so temporary credentials won't work.
func (d *Driver) Fields() []driver.Field {
	return append([]driver.Field{
		{Key: "access_key_id", Label: "Access key ID", Required: true, Placement: driver.PlacementCredential},
		{Key: "secret_access_key", Label: "Secret access key", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "region", Label: "Region", Required: true, Help: "e.g. us-east-1", Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}, driver.SenderFields()...)
}
```

`drivers/slack/fields.go`:

```go
package slack

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Slack driver reads. It posts either through an
// incoming webhook or through the API with a bot token and a channel; the
// schema can't express "one of", so nothing is required here and Validate
// enforces the pairing.
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "webhook_url", Label: "Incoming webhook URL", Secret: true, Help: "Use this, or a bot token and a channel.", Placement: driver.PlacementCredential},
		{Key: "bot_token", Label: "Bot token", Secret: true, Help: "Needs a channel too.", Placement: driver.PlacementCredential},
		{Key: "channel", Label: "Channel", Help: "Channel ID or name, used with a bot token.", Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}
}
```

Slack's `extra`:

```go
func extra(*testing.T) map[string]string { return map[string]string{"webhook_url": "https://hooks.slack.test/x"} }
```

`drivers/vonage/fields.go`:

```go
package vonage

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the Vonage driver reads.
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "api_key", Label: "API key", Required: true, Placement: driver.PlacementCredential},
		{Key: "api_secret", Label: "API secret", Required: true, Secret: true, Placement: driver.PlacementCredential},
		{Key: "from_number", Label: "From number", Required: true, Help: "A routing rule's from phone overrides it.", Placement: driver.PlacementSetting},
		{Key: "base_url", Label: "API base URL", Placement: driver.PlacementSetting},
	}
}
```

`drivers/webhook/fields.go`:

```go
package webhook

import "github.com/xraph/herald/driver"

var _ driver.Describer = (*Driver)(nil)

// Fields describes what the webhook driver reads. Settings starting with
// "data." are forwarded in the payload's data object (see Task 15).
func (d *Driver) Fields() []driver.Field {
	return []driver.Field{
		{Key: "url", Label: "Endpoint URL", Required: true, Secret: true, Help: "Often carries a token, so it's kept with the credentials.", Placement: driver.PlacementCredential},
		{Key: "signing_secret", Label: "Signing secret", Secret: true, Help: "Signs each request with HMAC-SHA256 in X-Webhook-Signature.", Placement: driver.PlacementCredential},
		{Key: "event_type", Label: "Event type", Help: `Defaults to "notification".`, Placement: driver.PlacementSetting},
	}
}
```

- [ ] **Step 3: Run every module**

```bash
for m in apns cloudflare discord mailgun messagebird postmark sendgrid ses slack vonage webhook; do
  (cd drivers/$m && go vet ./... && go test ./... 2>&1 | tail -1) || echo "FAILED: $m"
done
```

Expected: eleven `ok` lines and no `FAILED`. If a module's `Validate` rejects the filled map, the schema is wrong: read that driver's `Validate` and fix the `Required` flags, never the test.

- [ ] **Step 4: Lint each module and commit**

```bash
for m in apns cloudflare discord mailgun messagebird postmark sendgrid ses slack vonage webhook; do
  (cd drivers/$m && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C)
done
paths=""; for m in apns cloudflare discord mailgun messagebird postmark sendgrid ses slack vonage webhook; do paths="$paths drivers/$m/fields.go drivers/$m/fields_test.go"; done
git add $paths
git commit --only -m "feat(drivers): describe the fields every optional driver reads" -- $paths
git show --stat HEAD
```

Expected: `0 issues` per module; the commit lists exactly 22 files.

---
### Task 11: An honest `Send`

`Send` reports an opted-out user as `sent`, overwrites `SendResult.ProviderID` with the vendor's message ID, ignores a failed log write, can't target a chosen provider, and byte-truncates bodies mid-character. The resolver doesn't say why it picked a provider. This task fixes all of that. Credential decryption comes in Task 12; here `driverData` just merges the maps the way `Send` always did.

**Files:**
- Modify: `herald.go`, `scope/resolver.go`
- Create: `send_test.go`

**Interfaces:**
- Consumes: `message.Delivery`, `message.StatusSuppressed`, `store.RecordDelivery` (Task 3); sentinels (Task 1).
- Produces:
  - `SendRequest.ProviderID string` (`json:"provider_id,omitempty"`)
  - `SendResult` gains `ProviderMessageID string` (`json:"provider_message_id,omitempty"`) and `Logged bool` (`json:"logged"`); `ProviderID` always means Herald's provider
  - `scope.ResolveResult.Via string` with constants `scope.ViaUser = "user"`, `ViaOrg = "org"`, `ViaApp = "app"`, `ViaFallback = "fallback"`, `ViaChosen = "chosen"`
  - `(*Herald).ResolveProvider(ctx context.Context, appID, orgID, userID, channel string) (*scope.ResolveResult, error)`: `nil, nil` when nothing handles the channel
  - unexported `(*Herald).driverData(p *provider.Provider) (map[string]string, error)`, replaced in Task 12
  - test helpers in `send_test.go`, reused by Task 12: `recordingDriver`, `newHerald(t, st store.Store, opts ...Option) *Herald`, `seedProvider(t, h, appID, name, driverName string, priority int, enabled bool) *provider.Provider`

- [ ] **Step 1: Write the failing tests**

`send_test.go`:

```go
package herald

import (
	"context"
	"errors"
	"maps"
	"testing"
	"unicode/utf8"

	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/preference"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/scope"
	"github.com/xraph/herald/store"
	"github.com/xraph/herald/store/memory"
)

var bg = context.Background()

// recordingDriver captures every outbound message. It copies Data so a test
// can check exactly what the driver was handed.
type recordingDriver struct {
	name, channel string
	vendorID      string
	err           error
	sent          []*driver.OutboundMessage
}

func (d *recordingDriver) Name() string                          { return d.name }
func (d *recordingDriver) Channel() string                       { return d.channel }
func (d *recordingDriver) Validate(_, _ map[string]string) error { return nil }
func (d *recordingDriver) Send(_ context.Context, m *driver.OutboundMessage) (*driver.DeliveryResult, error) {
	c := *m
	c.Data = maps.Clone(m.Data)
	d.sent = append(d.sent, &c)
	if d.err != nil {
		return nil, d.err
	}
	return &driver.DeliveryResult{ProviderMessageID: d.vendorID, Status: message.StatusSent}, nil
}

func newHerald(t *testing.T, st store.Store, opts ...Option) *Herald {
	t.Helper()
	h, err := New(append([]Option{WithStore(st)}, opts...)...)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return h
}

func seedProvider(t *testing.T, h *Herald, appID, name, driverName string, priority int, enabled bool) *provider.Provider {
	t.Helper()
	p := &provider.Provider{
		ID: id.NewProviderID(), AppID: appID, Name: name, Channel: "email", Driver: driverName,
		Credentials: map[string]string{"api_key": "secret-" + name},
		Settings:    map[string]string{"from": "no-reply@example.com"},
		Priority:    priority, Enabled: enabled,
	}
	if err := h.Store().CreateProvider(bg, p); err != nil {
		t.Fatalf("create provider: %v", err)
	}
	return p
}

func TestSendRecordsTheWholeDelivery(t *testing.T) {
	st := memory.New()
	rec := &recordingDriver{name: "rec", channel: "email", vendorID: "pm_1"}
	h := newHerald(t, st, WithDriver(rec))
	p := seedProvider(t, h, "app_a", "primary", "rec", 0, true)

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"ada@example.com"}, Subject: "Hi", Body: "Hello"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Status != message.StatusSent || res.ProviderID != p.ID.String() || res.ProviderMessageID != "pm_1" || !res.Logged {
		t.Errorf("result = %+v", res)
	}
	got, err := st.GetMessage(bg, res.MessageID)
	if err != nil {
		t.Fatalf("GetMessage: %v", err)
	}
	if got.Status != message.StatusSent || got.ProviderMessageID != "pm_1" || got.SentAt == nil || got.ProviderID != p.ID.String() {
		t.Errorf("stored message = %+v", got)
	}
}

func TestSendFailureIsRecordedNotReturned(t *testing.T) {
	st := memory.New()
	rec := &recordingDriver{name: "rec", channel: "email", err: errors.New("rec: API error 401: bad key")}
	h := newHerald(t, st, WithDriver(rec))
	seedProvider(t, h, "app_a", "primary", "rec", 0, true)

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"ada@example.com"}, Body: "Hello"})
	if err != nil {
		t.Fatalf("a provider failure is a result, not a Go error: %v", err)
	}
	if res.Status != message.StatusFailed || res.Error != "rec: API error 401: bad key" {
		t.Errorf("result = %+v", res)
	}
	got, _ := st.GetMessage(bg, res.MessageID)
	if got.Status != message.StatusFailed || got.SentAt != nil {
		t.Errorf("stored = %+v", got)
	}
}

func TestOptedOutIsSuppressedAndLogged(t *testing.T) {
	st := memory.New()
	rec := &recordingDriver{name: "rec", channel: "email"}
	h := newHerald(t, st, WithDriver(rec))
	seedProvider(t, h, "app_a", "primary", "rec", 0, true)
	off := false
	if err := st.SetPreference(bg, &preference.Preference{
		ID: id.NewPreferenceID(), AppID: "app_a", UserID: "u1",
		Overrides: map[string]preference.ChannelPreference{"auth.welcome": {Email: &off}},
	}); err != nil {
		t.Fatal(err)
	}

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", UserID: "u1", Channel: "email", Template: "auth.welcome", To: []string{"ada@example.com"}})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Status != message.StatusSuppressed || res.MessageID.IsNil() || res.Error != "user opted out" {
		t.Errorf("result = %+v, want suppressed with a message ID", res)
	}
	if len(rec.sent) != 0 {
		t.Errorf("driver was called %d times for an opted-out user", len(rec.sent))
	}
	got, err := st.GetMessage(bg, res.MessageID)
	if err != nil || got.Status != message.StatusSuppressed {
		t.Errorf("stored = %+v, %v", got, err)
	}
}

func TestChosenProviderSkipsTheResolver(t *testing.T) {
	st := memory.New()
	rec := &recordingDriver{name: "rec", channel: "email"}
	h := newHerald(t, st, WithDriver(rec))
	seedProvider(t, h, "app_a", "preferred", "rec", 0, true)
	chosen := seedProvider(t, h, "app_a", "disabled-one", "rec", 5, false)

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", ProviderID: chosen.ID.String(), To: []string{"a@x"}, Body: "b"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ProviderID != chosen.ID.String() {
		t.Errorf("sent through %s, want the chosen (disabled) provider %s", res.ProviderID, chosen.ID)
	}
}

func TestChosenProviderFromAnotherAppIsRefused(t *testing.T) {
	st := memory.New()
	rec := &recordingDriver{name: "rec", channel: "email"}
	h := newHerald(t, st, WithDriver(rec))
	seedProvider(t, h, "app_a", "mine", "rec", 0, true)
	theirs := seedProvider(t, h, "app_b", "theirs", "rec", 0, true)

	_, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", ProviderID: theirs.ID.String(), To: []string{"a@x"}, Body: "b"})
	if !errors.Is(err, ErrProviderNotFound) {
		t.Errorf("err = %v, want ErrProviderNotFound", err)
	}
	if len(rec.sent) != 0 {
		t.Error("a provider from another app was used")
	}
	if msgs, _ := st.ListMessages(bg, "app_a", message.ListOptions{}); len(msgs) != 0 {
		t.Errorf("a refused send left %d message rows", len(msgs))
	}
}

func TestChosenProviderOnTheWrongChannelIsRefused(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(&recordingDriver{name: "rec", channel: "email"}))
	p := seedProvider(t, h, "app_a", "mail", "rec", 0, true)
	_, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "sms", ProviderID: p.ID.String(), To: []string{"+1"}, Body: "b"})
	if !errors.Is(err, ErrInvalidChannel) {
		t.Errorf("err = %v, want ErrInvalidChannel", err)
	}
}

// brokenLog fails every CreateMessage, to prove a broken log never blocks a send.
type brokenLog struct{ *memory.Store }

func (brokenLog) CreateMessage(context.Context, *message.Message) error { return errors.New("disk full") }

func TestLogFailureStillSends(t *testing.T) {
	st := brokenLog{memory.New()}
	rec := &recordingDriver{name: "rec", channel: "email"}
	h := newHerald(t, st, WithDriver(rec))
	seedProvider(t, h, "app_a", "primary", "rec", 0, true)

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"a@x"}, Body: "b"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Status != message.StatusSent || res.Logged || len(rec.sent) != 1 {
		t.Errorf("result = %+v, sends = %d; want sent, not logged, one send", res, len(rec.sent))
	}
}

func TestResolveProviderSaysWhy(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(&recordingDriver{name: "rec", channel: "email"}))
	fallback := seedProvider(t, h, "app_a", "fallback", "rec", 0, true)
	routed := seedProvider(t, h, "app_a", "routed", "rec", 9, true)

	res, err := h.ResolveProvider(bg, "app_a", "", "", "email")
	if err != nil || res.Provider.ID.String() != fallback.ID.String() || res.Via != scope.ViaFallback {
		t.Fatalf("no routing: %+v, %v", res, err)
	}
	if err := st.SetScopedConfig(bg, &scope.Config{
		ID: id.NewScopedConfigID(), AppID: "app_a", Scope: scope.ScopeApp, ScopeID: "app_a", EmailProviderID: routed.ID.String(),
	}); err != nil {
		t.Fatal(err)
	}
	res, err = h.ResolveProvider(bg, "app_a", "", "", "email")
	if err != nil || res.Provider.ID.String() != routed.ID.String() || res.Via != scope.ViaApp {
		t.Fatalf("app routing: %+v, %v", res, err)
	}
	none, err := h.ResolveProvider(bg, "app_a", "", "", "sms")
	if err != nil || none != nil {
		t.Errorf("nothing handles sms: got %+v, %v", none, err)
	}
}

func TestTruncateIsRuneSafe(t *testing.T) {
	got := truncate("héllo", 2) // é is bytes 1 and 2
	if got != "h" || !utf8.ValidString(got) {
		t.Errorf("truncate = %q", got)
	}
	if truncate("abc", 0) != "abc" || truncate("abc", 5) != "abc" {
		t.Error("truncate changed a string it should leave alone")
	}
}
```

Run: `go test . -run 'Send|OptedOut|Chosen|LogFailure|ResolveProvider|Truncate' 2>&1 | head`
Expected: FAIL to compile (`ProviderID` on `SendRequest`, `ProviderMessageID`, `Logged`, `scope.ViaFallback`, `h.ResolveProvider` undefined).

- [ ] **Step 2: Teach the resolver to say why**

In `scope/resolver.go`, add the constants and the field, and set `Via` everywhere a result is built:

```go
// How a provider was chosen, reported in ResolveResult.Via.
const (
	ViaUser     = "user"     // a user-level routing rule
	ViaOrg      = "org"      // an org-level routing rule
	ViaApp      = "app"      // the app-level routing rule
	ViaFallback = "fallback" // no rule: the first enabled provider by priority
	ViaChosen   = "chosen"   // the caller named the provider
)

// ResolveResult holds the resolved provider and scoped configuration.
type ResolveResult struct {
	Provider *provider.Provider
	Config   *Config
	Via      string
}
```

In the fallback return: `return &ResolveResult{Provider: p, Via: ViaFallback}, nil`. In `tryScope`: `return &ResolveResult{Provider: prov, Config: cfg, Via: string(scopeType)}` (the three `ScopeType` values are exactly `user`, `org`, `app`).

- [ ] **Step 3: Rewrite Send**

In `herald.go`, add `ProviderID string json:"provider_id,omitempty"` to `SendRequest` with the comment `// ProviderID sends through this provider instead of resolving one. It must belong to AppID and handle Channel; a disabled provider is allowed, because naming it is the explicit act.`, and replace `SendResult`:

```go
// SendResult contains the outcome of a send operation.
type SendResult struct {
	MessageID id.MessageID   `json:"message_id"`
	Status    message.Status `json:"status"`
	// ProviderID is always Herald's provider ID.
	ProviderID string `json:"provider_id,omitempty"`
	// ProviderMessageID is the vendor's ID for the message, when it gave one.
	ProviderMessageID string `json:"provider_message_id,omitempty"`
	Error             string `json:"error,omitempty"`
	// Logged is false when the message log couldn't be written. The send
	// still happened; it just won't appear in the log.
	Logged bool `json:"logged"`
}
```

Replace the whole `Send` function with `Send` and its helpers (imports need `"errors"`, `"maps"`, `"unicode/utf8"` and `"github.com/xraph/herald/scope"` added):

```go
// Send delivers a notification on a single channel.
func (h *Herald) Send(ctx context.Context, req *SendRequest) (*SendResult, error) {
	if req.UserID != "" && req.Template != "" {
		pref, _ := h.store.GetPreference(ctx, req.AppID, req.UserID) //nolint:errcheck // no preference means opted in
		if pref != nil && pref.IsOptedOut(req.Template, req.Channel) {
			return h.suppress(ctx, req), nil
		}
	}

	rendered, err := h.renderRequest(ctx, req)
	if err != nil {
		return nil, err
	}

	resolved, err := h.resolveForSend(ctx, req)
	if err != nil {
		return nil, err
	}
	prov := resolved.Provider

	drv, err := h.drivers.Get(prov.Driver)
	if err != nil {
		return nil, fmt.Errorf("%w: driver=%s", ErrDriverNotFound, prov.Driver)
	}

	// A decryption failure is recorded on every message row below rather than
	// returned, so the log says why nothing was delivered.
	data, dataErr := h.driverData(prov)
	outbound := &driver.OutboundMessage{
		Subject: rendered.Subject,
		HTML:    rendered.HTML,
		Text:    rendered.Text,
		Title:   rendered.Title,
		Data:    data,
	}
	applyFrom(outbound, resolved, req.Channel, prov)

	now := time.Now().UTC()
	results := make([]*SendResult, 0, len(req.To))
	for _, recipient := range req.To {
		msg := &message.Message{
			ID:         id.NewMessageID(),
			AppID:      req.AppID,
			EnvID:      req.EnvID,
			TemplateID: req.Template,
			ProviderID: prov.ID.String(),
			Channel:    req.Channel,
			Recipient:  recipient,
			Subject:    rendered.Subject,
			Body:       truncate(rendered.Text, h.config.TruncateBodyAt),
			Status:     message.StatusSending,
			Metadata:   req.Metadata,
			Async:      req.Async,
			Attempts:   1,
			CreatedAt:  now,
		}
		logged := h.logMessage(ctx, msg)

		var d message.Delivery
		if dataErr != nil {
			d = message.Delivery{Status: message.StatusFailed, Error: dataErr.Error()}
		} else {
			outbound.To = recipient
			result, sendErr := drv.Send(ctx, outbound)
			if sendErr != nil {
				d = message.Delivery{Status: message.StatusFailed, Error: sendErr.Error()}
			} else {
				sentAt := time.Now().UTC()
				d = message.Delivery{Status: message.StatusSent, SentAt: &sentAt}
				if result != nil {
					d.ProviderMessageID = result.ProviderMessageID
				}
			}
		}
		if logged {
			if err := h.store.RecordDelivery(ctx, msg.ID, d); err != nil {
				h.logger.Warn("herald: failed to record delivery", "message_id", msg.ID.String(), "error", err)
			}
		}

		if d.Status == message.StatusSent && req.Channel == string(ChannelInApp) && req.UserID != "" {
			_ = h.store.CreateNotification(ctx, &inbox.Notification{ //nolint:errcheck // best-effort inbox entry
				ID:        id.NewInboxID(),
				AppID:     req.AppID,
				EnvID:     req.EnvID,
				UserID:    req.UserID,
				Type:      req.Template,
				Title:     rendered.Title,
				Body:      rendered.Text,
				Metadata:  req.Metadata,
				CreatedAt: now,
			})
		}

		results = append(results, &SendResult{
			MessageID:         msg.ID,
			Status:            d.Status,
			ProviderID:        prov.ID.String(),
			ProviderMessageID: d.ProviderMessageID,
			Error:             d.Error,
			Logged:            logged,
		})
	}

	if len(results) == 0 {
		return &SendResult{Status: message.StatusFailed, Error: "no recipients"}, nil
	}

	r := results[0]
	outcome := bridge.OutcomeSuccess
	if r.Status == message.StatusFailed {
		outcome = bridge.OutcomeFailure
	}
	h.Audit(ctx, bridge.SeverityInfo, outcome, "notification.send", "message", r.MessageID.String(), req.UserID, req.AppID, "notification", map[string]string{
		"channel":  req.Channel,
		"provider": prov.ID.String(),
		"via":      resolved.Via,
		"template": req.Template,
		"status":   string(r.Status),
	})
	return r, nil
}

// ResolveProvider reports which provider would send on channel for this
// app, org and user, and why. It returns nil, nil when nothing handles it.
func (h *Herald) ResolveProvider(ctx context.Context, appID, orgID, userID, channel string) (*scope.ResolveResult, error) {
	return h.resolver.ResolveProvider(ctx, appID, orgID, userID, channel)
}

// suppress records an opted-out send without calling any driver.
func (h *Herald) suppress(ctx context.Context, req *SendRequest) *SendResult {
	const reason = "user opted out"
	now := time.Now().UTC()
	var first *SendResult
	for _, recipient := range req.To {
		msg := &message.Message{
			ID:         id.NewMessageID(),
			AppID:      req.AppID,
			EnvID:      req.EnvID,
			TemplateID: req.Template,
			Channel:    req.Channel,
			Recipient:  recipient,
			Status:     message.StatusSuppressed,
			Error:      reason,
			Metadata:   req.Metadata,
			Async:      req.Async,
			CreatedAt:  now,
		}
		logged := h.logMessage(ctx, msg)
		if first == nil {
			first = &SendResult{MessageID: msg.ID, Status: message.StatusSuppressed, Error: reason, Logged: logged}
		}
	}
	if first == nil {
		first = &SendResult{Status: message.StatusSuppressed, Error: reason}
	}
	h.Audit(ctx, bridge.SeverityInfo, bridge.OutcomeSuccess, "notification.suppressed", "message", first.MessageID.String(), req.UserID, req.AppID, "notification", map[string]string{
		"channel": req.Channel, "template": req.Template,
	})
	return first
}

// logMessage writes the message row and reports whether it worked. A failed
// write never blocks the send.
func (h *Herald) logMessage(ctx context.Context, msg *message.Message) bool {
	if err := h.store.CreateMessage(ctx, msg); err != nil {
		h.logger.Warn("herald: could not write the message log; sending anyway",
			"channel", msg.Channel, "status", string(msg.Status), "error", err)
		return false
	}
	return true
}

// renderRequest renders the template, or uses the raw subject and body. A
// template is used only when Template is set and Body is empty.
func (h *Herald) renderRequest(ctx context.Context, req *SendRequest) (*template.RenderedContent, error) {
	if req.Template == "" || req.Body != "" {
		return &template.RenderedContent{Subject: req.Subject, Text: req.Body}, nil
	}
	tmpl, err := h.store.GetTemplateBySlug(ctx, req.AppID, req.Template, req.Channel)
	if err != nil {
		if errors.Is(err, ErrTemplateNotFound) {
			return nil, fmt.Errorf("%w: %s on %s", ErrTemplateNotFound, req.Template, req.Channel)
		}
		return nil, fmt.Errorf("herald: load template %q: %w", req.Template, err)
	}
	if !tmpl.Enabled {
		return nil, ErrTemplateDisabled
	}
	locale := req.Locale
	if locale == "" {
		locale = h.config.DefaultLocale
	}
	return h.renderer.Render(tmpl, locale, req.Data)
}

// resolveForSend returns the chosen provider when the request names one, and
// otherwise runs the scope resolver.
func (h *Herald) resolveForSend(ctx context.Context, req *SendRequest) (*scope.ResolveResult, error) {
	if req.ProviderID == "" {
		res, err := h.resolver.ResolveProvider(ctx, req.AppID, req.OrgID, req.UserID, req.Channel)
		if err != nil {
			return nil, err
		}
		if res == nil {
			return nil, fmt.Errorf("%w: channel=%s", ErrNoProviderConfigured, req.Channel)
		}
		return res, nil
	}
	pid, err := id.ParseProviderID(req.ProviderID)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrProviderNotFound, req.ProviderID)
	}
	p, err := h.store.GetProvider(ctx, pid)
	if err != nil {
		return nil, err
	}
	if p.AppID != req.AppID {
		return nil, ErrProviderNotFound
	}
	if p.Channel != req.Channel {
		return nil, fmt.Errorf("%w: provider %s sends %s, not %s", ErrInvalidChannel, p.ID, p.Channel, req.Channel)
	}
	cfg, _ := h.store.GetScopedConfig(ctx, req.AppID, scope.ScopeApp, req.AppID) //nolint:errcheck // no app rule means provider settings supply From
	return &scope.ResolveResult{Provider: p, Config: cfg, Via: scope.ViaChosen}, nil
}

// driverData is the map a driver reads: credentials, then settings, with
// settings winning a key collision, which is how Send has always merged them.
func (h *Herald) driverData(p *provider.Provider) (map[string]string, error) {
	data := make(map[string]string, len(p.Credentials)+len(p.Settings))
	maps.Copy(data, p.Credentials)
	maps.Copy(data, p.Settings)
	return data, nil
}

// applyFrom sets the sender from the routing rule, falling back to the
// provider's own from settings.
func applyFrom(out *driver.OutboundMessage, res *scope.ResolveResult, channel string, prov *provider.Provider) {
	if res.Config != nil {
		out.From = res.Config.FromEmail
		out.FromName = res.Config.FromName
		if channel == string(ChannelSMS) {
			out.From = res.Config.FromPhone
		}
	}
	if out.From == "" {
		out.From = prov.Settings["from"]
	}
	if out.FromName == "" {
		out.FromName = prov.Settings["from_name"]
	}
}
```

Replace `truncate` at the bottom of the file:

```go
// truncate shortens s to at most maxLen bytes without splitting a UTF-8
// character. maxLen <= 0 means no limit.
func truncate(s string, maxLen int) string {
	if maxLen <= 0 || len(s) <= maxLen {
		return s
	}
	cut := maxLen
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut]
}
```

`Notify` needs no change: it calls `Send` and still reports `failed` results for channels that error.

- [ ] **Step 4: Check the callers that read `SendResult`**

Run: `grep -rn "\.ProviderID\b" --include='*.go' . | grep -v _test | grep -iv "provider\.Provider\|msg\.\|m\.\|cfg\.\|req\." `
Expected: nothing outside `herald.go` treats `SendResult.ProviderID` as a vendor ID. (`dashboard/pages` prints it on the send-test page; that page is deleted by spec 2 and needs no change here.)

- [ ] **Step 5: Run, lint, commit**

```bash
go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add send_test.go
git commit --only -m "fix(herald): report suppressed sends, keep the vendor's message ID separate, and send through a chosen provider" -- \
  herald.go send_test.go scope/resolver.go
git show --stat HEAD
```

Expected: all `ok` (including the three existing seed tests), `0 issues`.

---

### Task 12: Provider writes that validate and encrypt

The REST API and the templ dashboard write providers straight into the store, which is how validation got skipped and credentials leaked. This task gives the engine the provider methods everything else must call, wires the credential cipher into them and into `Send`, and adds `EncryptStoredCredentials`.

**Files:**
- Create: `providers.go`, `providers_test.go`
- Modify: `options.go`, `herald.go` (`driverData`, `SeedConfiguredProviders`), `errors.go`

**Interfaces:**
- Consumes: `credential` (Task 8), `driver.Describe` (Task 9), test helpers from `send_test.go` (Task 11).
- Produces:
  - Options `WithCredentialKey(keyID string, key []byte) Option` and `WithPreviousCredentialKey(keyID string, key []byte) Option`
  - `(*Herald).CredentialKeyID() string` (`""` when no key)
  - errors `ErrInvalidProvider`, `ErrNoCredentialKey`, and `ErrCredentialKeyUnavailable` (= `credential.ErrKeyUnavailable`)
  - `ProtectionAESGCM`, `ProtectionPlaintext` (re-exported from `credential`)
  - `type CredentialState struct { Key string; Protection string; KeyID string }` (JSON `key`, `protection`, `key_id,omitempty`)
  - `type ProviderUpdate struct { Name *string; Priority *int; Enabled *bool; SetCredentials map[string]string; RemoveCredentials []string; SetSettings map[string]string; RemoveSettings []string }`
  - `type EncryptReport struct { Providers, ValuesEncrypted, AlreadyEncrypted int }` (JSON `providers`, `values_encrypted`, `already_encrypted`)
  - `(*Herald).CreateProvider(ctx context.Context, p *provider.Provider) error`: assigns ID and timestamps when missing, validates, encrypts, stores; `p` is left holding what was stored
  - `(*Herald).UpdateProvider(ctx context.Context, appID string, providerID id.ProviderID, u ProviderUpdate) (*provider.Provider, error)`
  - `(*Herald).DeleteProvider(ctx context.Context, appID string, providerID id.ProviderID) error`
  - `(*Herald).GetProvider(ctx context.Context, appID string, providerID id.ProviderID) (*provider.Provider, error)`: ownership checked, credentials still as stored
  - `(*Herald).ValidateProvider(p *provider.Provider) error`
  - `(*Herald).CredentialStatus(p *provider.Provider) []CredentialState`, sorted by key
  - `(*Herald).EncryptStoredCredentials(ctx context.Context, appID string) (EncryptReport, error)`

- [ ] **Step 1: Write the failing tests**

`providers_test.go`:

```go
package herald

import (
	"bytes"
	"errors"
	"maps"
	"strings"
	"testing"

	"github.com/xraph/herald/credential"
	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/store/memory"
)

func testKey(b byte) []byte { return bytes.Repeat([]byte{b}, credential.KeySize) }

// describedDriver declares api_key as a required secret and refuses a
// missing one, like a real API-key driver.
type describedDriver struct{ recordingDriver }

func (d *describedDriver) Fields() []driver.Field {
	return []driver.Field{{Key: "api_key", Label: "API key", Required: true, Secret: true, Placement: driver.PlacementCredential}}
}

func (d *describedDriver) Validate(creds, _ map[string]string) error {
	if creds["api_key"] == "" {
		return errors.New("described: missing api_key")
	}
	return nil
}

func newDescribed(vendorID string) *describedDriver {
	return &describedDriver{recordingDriver{name: "described", channel: "email", vendorID: vendorID}}
}

func newProviderInput(appID string) *provider.Provider {
	return &provider.Provider{
		AppID: appID, Name: "primary", Channel: "email", Driver: "described",
		Credentials: map[string]string{"api_key": "sk_canary_value", "username": "ops"},
		Settings:    map[string]string{"from": "no-reply@example.com"},
		Enabled:     true,
	}
}

func TestCreateEncryptsWithAKeyAndSendDecrypts(t *testing.T) {
	st := memory.New()
	drv := newDescribed("pm_9")
	h := newHerald(t, st, WithDriver(drv), WithCredentialKey("k1", testKey(1)))

	p := newProviderInput("app_a")
	if err := h.CreateProvider(bg, p); err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	stored, _ := st.GetProvider(bg, p.ID)
	for k, v := range stored.Credentials {
		if !strings.HasPrefix(v, "enc:v1:k1:") {
			t.Errorf("credential %q stored as %q", k, v)
		}
	}
	for _, s := range h.CredentialStatus(stored) {
		if s.Protection != ProtectionAESGCM || s.KeyID != "k1" {
			t.Errorf("status = %+v", s)
		}
	}

	res, err := h.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"a@x"}, Body: "b"})
	if err != nil || res.Status != message.StatusSent {
		t.Fatalf("Send = %+v, %v", res, err)
	}
	if got := drv.sent[0].Data["api_key"]; got != "sk_canary_value" {
		t.Errorf("driver received %q, want the decrypted value", got)
	}
}

func TestCreateWithoutAKeyStoresPlaintextAndSaysSo(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(newDescribed("")))
	p := newProviderInput("app_a")
	if err := h.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}
	stored, _ := st.GetProvider(bg, p.ID)
	if stored.Credentials["api_key"] != "sk_canary_value" {
		t.Errorf("stored = %q", stored.Credentials["api_key"])
	}
	for _, s := range h.CredentialStatus(stored) {
		if s.Protection != ProtectionPlaintext || s.KeyID != "" {
			t.Errorf("status = %+v, want plaintext", s)
		}
	}
}

func TestValidateProvider(t *testing.T) {
	h := newHerald(t, memory.New(), WithDriver(newDescribed("")))

	wrongChannel := newProviderInput("a")
	wrongChannel.Channel = "sms"
	if err := h.ValidateProvider(wrongChannel); !errors.Is(err, ErrInvalidChannel) {
		t.Errorf("wrong channel: %v", err)
	}
	unknown := newProviderInput("a")
	unknown.Driver = "nope"
	if err := h.ValidateProvider(unknown); !errors.Is(err, ErrDriverNotFound) {
		t.Errorf("unknown driver: %v", err)
	}
	secretInSettings := newProviderInput("a")
	delete(secretInSettings.Credentials, "api_key")
	secretInSettings.Settings["api_key"] = "sk_canary_value"
	err := h.ValidateProvider(secretInSettings)
	if !errors.Is(err, ErrInvalidProvider) || strings.Contains(err.Error(), "sk_canary_value") {
		t.Errorf("secret in settings: %v", err)
	}
	missing := newProviderInput("a")
	delete(missing.Credentials, "api_key")
	if err := h.ValidateProvider(missing); !errors.Is(err, ErrInvalidProvider) {
		t.Errorf("driver refusal: %v", err)
	}
	noName := newProviderInput("a")
	noName.Name = "  "
	if err := h.ValidateProvider(noName); !errors.Is(err, ErrInvalidProvider) {
		t.Errorf("blank name: %v", err)
	}
}

func TestUpdateTouchesOnlyWhatItNames(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(newDescribed("")), WithCredentialKey("k1", testKey(1)))
	p := newProviderInput("app_a")
	if err := h.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}
	before, _ := st.GetProvider(bg, p.ID)

	name := "renamed"
	got, err := h.UpdateProvider(bg, "app_a", p.ID, ProviderUpdate{
		Name:           &name,
		SetCredentials: map[string]string{"username": "new-ops"},
	})
	if err != nil {
		t.Fatalf("UpdateProvider: %v", err)
	}
	if got.Name != "renamed" || !got.Enabled {
		t.Errorf("name=%q enabled=%v; leaving Enabled nil must not disable", got.Name, got.Enabled)
	}
	if got.Credentials["api_key"] != before.Credentials["api_key"] {
		t.Error("an untouched credential was rewritten")
	}
	if got.Credentials["username"] == before.Credentials["username"] || !strings.HasPrefix(got.Credentials["username"], "enc:v1:k1:") {
		t.Errorf("a replaced credential must be re-encrypted: %q", got.Credentials["username"])
	}

	got, err = h.UpdateProvider(bg, "app_a", p.ID, ProviderUpdate{RemoveCredentials: []string{"username"}})
	if err != nil || len(got.Credentials) != 1 {
		t.Errorf("remove: %v, %v", got.Credentials, err)
	}
}

func TestUpdateRefusesWhenTheKeyIsGone(t *testing.T) {
	st := memory.New()
	old := newHerald(t, st, WithDriver(newDescribed("")), WithCredentialKey("k0", testKey(9)))
	p := newProviderInput("app_a")
	if err := old.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}
	before, _ := st.GetProvider(bg, p.ID)

	rotated := newHerald(t, st, WithDriver(newDescribed("")), WithCredentialKey("k1", testKey(1)))
	name := "x"
	_, err := rotated.UpdateProvider(bg, "app_a", p.ID, ProviderUpdate{Name: &name})
	if !errors.Is(err, ErrCredentialKeyUnavailable) {
		t.Fatalf("err = %v, want ErrCredentialKeyUnavailable", err)
	}
	after, _ := st.GetProvider(bg, p.ID)
	if after.Name != before.Name || !maps.Equal(after.Credentials, before.Credentials) {
		t.Error("a refused update changed the stored row")
	}
}

func TestProviderOwnership(t *testing.T) {
	h := newHerald(t, memory.New(), WithDriver(newDescribed("")))
	p := newProviderInput("app_a")
	if err := h.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}
	name := "x"
	if _, err := h.UpdateProvider(bg, "app_b", p.ID, ProviderUpdate{Name: &name}); !errors.Is(err, ErrProviderNotFound) {
		t.Errorf("update from another app: %v", err)
	}
	if err := h.DeleteProvider(bg, "app_b", p.ID); !errors.Is(err, ErrProviderNotFound) {
		t.Errorf("delete from another app: %v", err)
	}
	if _, err := h.GetProvider(bg, "app_b", p.ID); !errors.Is(err, ErrProviderNotFound) {
		t.Errorf("get from another app: %v", err)
	}
	if err := h.DeleteProvider(bg, "app_a", p.ID); err != nil {
		t.Errorf("delete from its own app: %v", err)
	}
}

func TestEncryptStoredCredentials(t *testing.T) {
	st := memory.New()
	plain := newHerald(t, st, WithDriver(newDescribed("")))
	p := newProviderInput("app_a")
	if err := plain.CreateProvider(bg, p); err != nil {
		t.Fatal(err)
	}
	if _, err := plain.EncryptStoredCredentials(bg, "app_a"); !errors.Is(err, ErrNoCredentialKey) {
		t.Errorf("no key: %v", err)
	}

	drv := newDescribed("")
	keyed := newHerald(t, st, WithDriver(drv), WithCredentialKey("k1", testKey(1)))
	rep, err := keyed.EncryptStoredCredentials(bg, "app_a")
	if err != nil || rep != (EncryptReport{Providers: 1, ValuesEncrypted: 2}) {
		t.Fatalf("first run = %+v, %v", rep, err)
	}
	rep, err = keyed.EncryptStoredCredentials(bg, "app_a")
	if err != nil || rep != (EncryptReport{AlreadyEncrypted: 2}) {
		t.Fatalf("second run = %+v, %v; it must be idempotent", rep, err)
	}
	if _, err := keyed.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"a@x"}, Body: "b"}); err != nil {
		t.Fatal(err)
	}
	if drv.sent[0].Data["api_key"] != "sk_canary_value" {
		t.Error("send after encrypting did not decrypt")
	}
}

func TestSendWithAMissingKeyFailsOnTheRecord(t *testing.T) {
	st := memory.New()
	old := newHerald(t, st, WithDriver(newDescribed("")), WithCredentialKey("k0", testKey(9)))
	if err := old.CreateProvider(bg, newProviderInput("app_a")); err != nil {
		t.Fatal(err)
	}
	drv := newDescribed("")
	rotated := newHerald(t, st, WithDriver(drv))
	res, err := rotated.Send(bg, &SendRequest{AppID: "app_a", Channel: "email", To: []string{"a@x"}, Body: "b"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Status != message.StatusFailed || !strings.Contains(res.Error, "k0") || len(drv.sent) != 0 {
		t.Errorf("result = %+v, sends = %d", res, len(drv.sent))
	}
	stored, _ := st.GetMessage(bg, res.MessageID)
	if !strings.Contains(stored.Error, "k0") {
		t.Errorf("the log must say which key is missing: %q", stored.Error)
	}
}

func TestSeededProvidersAreEncryptedToo(t *testing.T) {
	st := memory.New()
	h := newHerald(t, st, WithDriver(newDescribed("")), WithCredentialKey("k1", testKey(1)))
	p := provider.Provider{ID: id.NewProviderID(), AppID: "app_a", Name: "seeded", Channel: "email", Driver: "described",
		Credentials: map[string]string{"api_key": "sk_canary_value"}, Enabled: true}
	if err := h.SeedConfiguredProviders(bg, []provider.Provider{p}); err != nil {
		t.Fatal(err)
	}
	got, _ := st.GetProvider(bg, p.ID)
	if !credential.IsEncrypted(got.Credentials["api_key"]) {
		t.Errorf("seeded credential stored as %q", got.Credentials["api_key"])
	}
}

func TestPreviousKeysNeedACurrentOne(t *testing.T) {
	_, err := New(WithStore(memory.New()), WithPreviousCredentialKey("k0", testKey(9)))
	if err == nil {
		t.Error("a previous key with no current key was accepted")
	}
	_, err = New(WithStore(memory.New()), WithCredentialKey("k1", make([]byte, 16)))
	if err == nil {
		t.Error("a 16-byte key was accepted")
	}
}
```

Run: `go test . 2>&1 | head`
Expected: FAIL to compile (`WithCredentialKey`, `CreateProvider`, `ProviderUpdate`, `CredentialStatus` and the rest undefined).

- [ ] **Step 2: Add the options**

In `options.go`, add fields to `Herald` and the options, and build the cipher in `New`:

```go
	// credential encryption, built in New from the options below
	cipher       *credential.Cipher
	currentKey   *credential.Key
	previousKeys []credential.Key
```

```go
// WithCredentialKey sets the AES-256 key that encrypts provider credentials
// written from now on. keyID is stored beside every value it encrypts.
func WithCredentialKey(keyID string, key []byte) Option {
	return func(h *Herald) error {
		h.currentKey = &credential.Key{ID: keyID, Bytes: key}
		return nil
	}
}

// WithPreviousCredentialKey adds a key that only decrypts, so values written
// under a rotated-out key keep working. Give it once per old key.
func WithPreviousCredentialKey(keyID string, key []byte) Option {
	return func(h *Herald) error {
		h.previousKeys = append(h.previousKeys, credential.Key{ID: keyID, Bytes: key})
		return nil
	}
}

// CredentialKeyID is the ID of the key new credentials are encrypted under,
// or "" when none is configured and credentials are stored in plaintext.
func (h *Herald) CredentialKeyID() string { return h.cipher.KeyID() }
```

In `New`, after the `h.store == nil` check and before `h.wireServices()`:

```go
	if h.currentKey == nil && len(h.previousKeys) > 0 {
		return nil, errors.New("herald: previous credential keys need a current key to encrypt with")
	}
	if h.currentKey != nil {
		c, err := credential.NewCipher(*h.currentKey, h.previousKeys...)
		if err != nil {
			return nil, err
		}
		h.cipher = c
	}
```

Imports: `"errors"`, `"github.com/xraph/herald/credential"`.

- [ ] **Step 3: Add the errors**

In `errors.go`, add `"github.com/xraph/herald/credential"` to the imports and, in the `var` block:

```go
	// ErrInvalidProvider wraps a provider that failed validation. The message
	// names the problem and never a credential value.
	ErrInvalidProvider = errors.New("herald: invalid provider")

	// ErrNoCredentialKey is returned by operations that need a credential key
	// when none is configured.
	ErrNoCredentialKey = errors.New("herald: no credential key is configured")

	// ErrCredentialKeyUnavailable means a credential was encrypted under a key
	// that isn't configured. The message names the key ID.
	ErrCredentialKeyUnavailable = credential.ErrKeyUnavailable
```

- [ ] **Step 4: Add the provider methods**

`providers.go`:

```go
package herald

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/xraph/herald/credential"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/provider"
)

// Protection values reported per credential.
const (
	ProtectionAESGCM    = credential.ProtectionAESGCM
	ProtectionPlaintext = credential.ProtectionPlaintext
)

// CredentialState is how one stored credential is protected. It never
// carries the value.
type CredentialState struct {
	Key        string `json:"key"`
	Protection string `json:"protection"`
	KeyID      string `json:"key_id,omitempty"`
}

// ProviderUpdate changes only what it names. Nil pointers and absent keys
// leave the stored value alone, so a caller can replace one secret without
// ever reading the others. A provider's channel and driver can't change.
type ProviderUpdate struct {
	Name              *string
	Priority          *int
	Enabled           *bool
	SetCredentials    map[string]string
	RemoveCredentials []string
	SetSettings       map[string]string
	RemoveSettings    []string
}

// EncryptReport says what EncryptStoredCredentials changed.
type EncryptReport struct {
	Providers        int `json:"providers"`
	ValuesEncrypted  int `json:"values_encrypted"`
	AlreadyEncrypted int `json:"already_encrypted"`
}

// CreateProvider validates p, encrypts its credentials when a key is
// configured, and stores it. p is left holding what was stored.
func (h *Herald) CreateProvider(ctx context.Context, p *provider.Provider) error {
	if p.ID.IsNil() {
		p.ID = id.NewProviderID()
	}
	now := time.Now().UTC()
	if p.CreatedAt.IsZero() {
		p.CreatedAt = now
	}
	p.UpdatedAt = now
	p.Name = strings.TrimSpace(p.Name)
	if err := h.ValidateProvider(p); err != nil {
		return err
	}
	sealed, err := h.seal(p.ID.String(), p.Credentials, slices.Collect(maps.Keys(p.Credentials)))
	if err != nil {
		return err
	}
	p.Credentials = sealed
	return h.store.CreateProvider(ctx, p)
}

// GetProvider returns a provider of appID, with credentials as stored.
func (h *Herald) GetProvider(ctx context.Context, appID string, providerID id.ProviderID) (*provider.Provider, error) {
	p, err := h.store.GetProvider(ctx, providerID)
	if err != nil {
		return nil, err
	}
	if p.AppID != appID {
		return nil, ErrProviderNotFound
	}
	return p, nil
}

// UpdateProvider applies u to a provider of appID. Credentials it sets are
// encrypted; credentials it doesn't touch keep their stored form exactly. It
// refuses, and writes nothing, when an existing credential can't be decrypted
// for validation.
func (h *Herald) UpdateProvider(ctx context.Context, appID string, providerID id.ProviderID, u ProviderUpdate) (*provider.Provider, error) {
	existing, err := h.GetProvider(ctx, appID, providerID)
	if err != nil {
		return nil, err
	}

	next := *existing
	next.Settings = applyChanges(existing.Settings, u.SetSettings, u.RemoveSettings)
	if u.Name != nil {
		next.Name = strings.TrimSpace(*u.Name)
	}
	if u.Priority != nil {
		next.Priority = *u.Priority
	}
	if u.Enabled != nil {
		next.Enabled = *u.Enabled
	}

	// Validate against plaintext: what's stored, decrypted, with the changes.
	plain, err := h.open(existing)
	if err != nil {
		return nil, err
	}
	candidate := next
	candidate.Credentials = applyChanges(plain, u.SetCredentials, u.RemoveCredentials)
	if err := h.ValidateProvider(&candidate); err != nil {
		return nil, err
	}

	stored := applyChanges(existing.Credentials, u.SetCredentials, u.RemoveCredentials)
	if next.Credentials, err = h.seal(next.ID.String(), stored, slices.Collect(maps.Keys(u.SetCredentials))); err != nil {
		return nil, err
	}
	next.UpdatedAt = time.Now().UTC()
	if err := h.store.UpdateProvider(ctx, &next); err != nil {
		return nil, err
	}
	return &next, nil
}

// DeleteProvider removes a provider of appID.
func (h *Herald) DeleteProvider(ctx context.Context, appID string, providerID id.ProviderID) error {
	if _, err := h.GetProvider(ctx, appID, providerID); err != nil {
		return err
	}
	return h.store.DeleteProvider(ctx, providerID)
}

// ValidateProvider checks p the way Send will use it: the driver exists and
// handles p's channel, no secret sits in settings, and the driver's own
// Validate accepts credentials and settings merged as Send merges them.
// Encrypted credentials are decrypted first. Errors never contain a value.
func (h *Herald) ValidateProvider(p *provider.Provider) error {
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidProvider)
	}
	drv, err := h.drivers.Get(p.Driver)
	if err != nil {
		return fmt.Errorf("%w: %s", ErrDriverNotFound, p.Driver)
	}
	if drv.Channel() != p.Channel {
		return fmt.Errorf("%w: driver %s sends %s, not %s", ErrInvalidChannel, p.Driver, drv.Channel(), p.Channel)
	}
	if fields, ok := h.drivers.Describe(p.Driver); ok {
		for _, f := range fields {
			if f.Secret && p.Settings[f.Key] != "" {
				return fmt.Errorf("%w: %s is a secret and belongs in credentials, not settings", ErrInvalidProvider, f.Key)
			}
		}
	}
	plain, err := h.open(p)
	if err != nil {
		return err
	}
	merged := make(map[string]string, len(plain)+len(p.Settings))
	maps.Copy(merged, plain)
	maps.Copy(merged, p.Settings)
	if err := drv.Validate(merged, p.Settings); err != nil {
		return fmt.Errorf("%w: %w", ErrInvalidProvider, err)
	}
	return nil
}

// CredentialStatus reports how each stored credential of p is protected.
func (h *Herald) CredentialStatus(p *provider.Provider) []CredentialState {
	keys := slices.Sorted(maps.Keys(p.Credentials))
	out := make([]CredentialState, 0, len(keys))
	for _, k := range keys {
		protection, keyID := credential.Describe(p.Credentials[k])
		out = append(out, CredentialState{Key: k, Protection: protection, KeyID: keyID})
	}
	return out
}

// EncryptStoredCredentials encrypts every plaintext credential of every
// provider in appID. It is explicit and idempotent: nothing re-encrypts on
// read, and a second run changes nothing.
func (h *Herald) EncryptStoredCredentials(ctx context.Context, appID string) (EncryptReport, error) {
	var rep EncryptReport
	if h.cipher == nil {
		return rep, ErrNoCredentialKey
	}
	providers, err := h.store.ListAllProviders(ctx, appID)
	if err != nil {
		return rep, err
	}
	for _, p := range providers {
		var names []string
		for k, v := range p.Credentials {
			if credential.IsEncrypted(v) {
				rep.AlreadyEncrypted++
			} else {
				names = append(names, k)
			}
		}
		if len(names) == 0 {
			continue
		}
		if p.Credentials, err = h.seal(p.ID.String(), p.Credentials, names); err != nil {
			return rep, err
		}
		p.UpdatedAt = time.Now().UTC()
		if err := h.store.UpdateProvider(ctx, p); err != nil {
			return rep, fmt.Errorf("herald: encrypt credentials of provider %s: %w", p.ID, err)
		}
		rep.Providers++
		rep.ValuesEncrypted += len(names)
	}
	return rep, nil
}

// seal returns a copy of creds with the named values encrypted, when a key is
// configured. Values already encrypted are left alone.
func (h *Herald) seal(providerID string, creds map[string]string, names []string) (map[string]string, error) {
	out := maps.Clone(creds)
	if h.cipher == nil || out == nil {
		return out, nil
	}
	sort.Strings(names)
	for _, name := range names {
		v, ok := out[name]
		if !ok || credential.IsEncrypted(v) {
			continue
		}
		enc, err := h.cipher.Encrypt(providerID, name, v)
		if err != nil {
			return nil, fmt.Errorf("herald: encrypt credential %q: %w", name, err)
		}
		out[name] = enc
	}
	return out, nil
}

// open returns p's credentials decrypted. Plaintext passes through.
func (h *Herald) open(p *provider.Provider) (map[string]string, error) {
	out := make(map[string]string, len(p.Credentials))
	for k, v := range p.Credentials {
		plain, err := h.cipher.Decrypt(p.ID.String(), k, v)
		if err != nil {
			return nil, fmt.Errorf("herald: credential %q of provider %s: %w", k, p.ID, err)
		}
		out[k] = plain
	}
	return out, nil
}

// applyChanges returns a copy of m with remove deleted and set applied.
func applyChanges(m, set map[string]string, remove []string) map[string]string {
	out := make(map[string]string, len(m)+len(set))
	maps.Copy(out, m)
	for _, k := range remove {
		delete(out, k)
	}
	maps.Copy(out, set)
	return out
}
```

- [ ] **Step 5: Decrypt in Send and encrypt seeded providers**

In `herald.go`, replace `driverData`:

```go
// driverData is the map a driver reads: credentials decrypted, then settings,
// with settings winning a key collision, which is how Send has always merged
// them. A credential encrypted under a key that isn't configured fails here.
func (h *Herald) driverData(p *provider.Provider) (map[string]string, error) {
	creds, err := h.open(p)
	if err != nil {
		return nil, err
	}
	data := make(map[string]string, len(creds)+len(p.Settings))
	maps.Copy(data, creds)
	maps.Copy(data, p.Settings)
	return data, nil
}
```

In `SeedConfiguredProviders`, replace the validation `if drv, err := ...` block and the `CreateProvider` call with:

```go
		if vErr := h.ValidateProvider(&p); vErr != nil {
			h.logger.Warn("herald: configured provider failed validation; seeding it anyway",
				"name", p.Name, "driver", p.Driver, "error", vErr)
		}
		sealed, err := h.seal(p.ID.String(), p.Credentials, slices.Collect(maps.Keys(p.Credentials)))
		if err != nil {
			h.logger.Warn("herald: failed to encrypt configured provider credentials", "name", p.Name, "error", err)
			continue
		}
		p.Credentials = sealed

		if err := h.store.CreateProvider(ctx, &p); err != nil {
```

Add `"slices"` to `herald.go`'s imports. The three existing seed tests still pass: an unregistered driver is warned about and still created.

- [ ] **Step 6: Run, lint, commit**

```bash
go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add providers.go providers_test.go
git commit --only -m "feat(herald): validate and encrypt provider writes, and decrypt only at send time" -- \
  providers.go providers_test.go options.go herald.go errors.go
git show --stat HEAD
```

Expected: all `ok`, `0 issues`.

---
### Task 13: Extension config for keys, and an API that says when it's unprotected

The extension can't configure a credential key yet, and it mounts the REST API with nothing in front of it. forge's `WithGroupAuth` looks like the fix and isn't: at v1.10.0 and v1.11.2 it only writes route metadata that the OpenAPI generator reads, and no middleware enforces it. So the only protection offered is real middleware, and startup warns loudly when there is none.

**Files:**
- Create: `extension/credentials.go`, `extension/credentials_test.go`, `extension/mount.go`, `extension/mount_test.go`
- Modify: `extension/config.go`, `extension/options.go`, `extension/extension.go`

**Interfaces:**
- Consumes: `herald.WithCredentialKey`, `herald.WithPreviousCredentialKey`, `credential.ParseKey` (Tasks 8 and 12).
- Produces:
  - `Config.CredentialsKey` (`credentials_key`), `Config.CredentialsKeyID` (`credentials_key_id`, default `k1`), `Config.PreviousCredentialsKeys []CredentialKeyConfig` (`previous_credentials_keys`), with `type CredentialKeyConfig struct { ID, Key string }` (`id`, `key`)
  - `extension.WithAPIMiddleware(mw ...forge.Middleware) ExtOption`
  - `(*Extension).APIProtected() bool`: consumed by spec 2's `engine.info`
  - `ExtensionVersion = "1.7.0"`

- [ ] **Step 1: Write the failing tests**

`extension/credentials_test.go`:

```go
package extension

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/xraph/herald"
	"github.com/xraph/herald/store/memory"
)

func b64(n int) string { return base64.StdEncoding.EncodeToString(make([]byte, n)) }

func TestNoKeyMeansNoOptions(t *testing.T) {
	opts, err := Config{}.credentialOptions()
	if err != nil || opts != nil {
		t.Errorf("got %v, %v", opts, err)
	}
}

func TestKeyBecomesACipher(t *testing.T) {
	for _, c := range []struct {
		id, want string
	}{{"", "k1"}, {"prod-2", "prod-2"}} {
		opts, err := Config{CredentialsKey: b64(32), CredentialsKeyID: c.id}.credentialOptions()
		if err != nil {
			t.Fatal(err)
		}
		h, err := herald.New(append([]herald.Option{herald.WithStore(memory.New())}, opts...)...)
		if err != nil {
			t.Fatal(err)
		}
		if h.CredentialKeyID() != c.want {
			t.Errorf("key ID = %q, want %q", h.CredentialKeyID(), c.want)
		}
	}
}

func TestBadKeysNameTheSettingNotTheValue(t *testing.T) {
	const secretish = "not-base64-but-maybe-a-real-secret"
	_, err := Config{CredentialsKey: secretish}.credentialOptions()
	if err == nil || !strings.Contains(err.Error(), "credentials_key") || strings.Contains(err.Error(), secretish) {
		t.Errorf("err = %v", err)
	}
	_, err = Config{CredentialsKey: b64(16)}.credentialOptions()
	if err == nil || !strings.Contains(err.Error(), "credentials_key") {
		t.Errorf("short key: %v", err)
	}
	_, err = Config{CredentialsKey: b64(32), PreviousCredentialsKeys: []CredentialKeyConfig{{ID: "k0", Key: b64(8)}}}.credentialOptions()
	if err == nil || !strings.Contains(err.Error(), "previous_credentials_keys[0]") {
		t.Errorf("bad previous key: %v", err)
	}
	_, err = Config{PreviousCredentialsKeys: []CredentialKeyConfig{{ID: "k0", Key: b64(32)}}}.credentialOptions()
	if err == nil {
		t.Error("previous keys with no current key were accepted")
	}
}
```

`extension/mount_test.go`:

```go
package extension

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xraph/forge"

	"github.com/xraph/herald"
	"github.com/xraph/herald/api"
	"github.com/xraph/herald/store/memory"
)

// TestMiddlewareGuardsEveryRoute proves the middleware runs, on a route from
// every group. A metadata-only option would pass a test that only checked
// the option was set.
func TestMiddlewareGuardsEveryRoute(t *testing.T) {
	h, err := herald.New(herald.WithStore(memory.New()))
	if err != nil {
		t.Fatal(err)
	}
	router := forge.NewRouter()
	deny := func(forge.Handler) forge.Handler {
		return func(forge.Context) error { return forge.NewHTTPError(http.StatusUnauthorized, "denied") }
	}
	if !mountAPI(router, api.NewForgeAPI(h.Store(), h, forge.NewNoopLogger()), "/herald", []forge.Middleware{deny}, nil) {
		t.Fatal("mountAPI reported unprotected with middleware given")
	}
	for _, r := range []struct{ method, path string }{
		{http.MethodGet, "/herald/v1/providers"},
		{http.MethodGet, "/herald/v1/templates"},
		{http.MethodPost, "/herald/v1/send"},
		{http.MethodGet, "/herald/v1/messages"},
		{http.MethodGet, "/herald/v1/inbox"},
		{http.MethodPut, "/herald/v1/preferences"},
		{http.MethodGet, "/herald/v1/config"},
	} {
		rec := httptest.NewRecorder()
		router.Handler().ServeHTTP(rec, httptest.NewRequest(r.method, r.path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d, want 401", r.method, r.path, rec.Code)
		}
	}
}

func TestNoMiddlewareIsReportedAsUnprotected(t *testing.T) {
	h, _ := herald.New(herald.WithStore(memory.New()))
	if mountAPI(forge.NewRouter(), api.NewForgeAPI(h.Store(), h, forge.NewNoopLogger()), "/herald", nil, nil) {
		t.Error("no middleware must report unprotected")
	}
}
```

Run: `go test ./extension/ 2>&1 | head`
Expected: FAIL to compile (`credentialOptions`, `CredentialKeyConfig`, `mountAPI` undefined).

- [ ] **Step 2: Add the config fields**

In `extension/config.go`, add to `Config` after `Providers`:

```go
	// CredentialsKey encrypts provider credentials at rest: 32 bytes,
	// standard base64. Without it credentials are stored in plaintext, and
	// the dashboard says so. Supports ${ENV} interpolation.
	CredentialsKey string `json:"credentials_key" yaml:"credentials_key" mapstructure:"credentials_key"`

	// CredentialsKeyID is stored beside every value the key encrypts
	// (default "k1"). Change it when you rotate to a new key.
	CredentialsKeyID string `json:"credentials_key_id" yaml:"credentials_key_id" mapstructure:"credentials_key_id"`

	// PreviousCredentialsKeys only decrypt, so values written under an older
	// key keep working after a rotation.
	PreviousCredentialsKeys []CredentialKeyConfig `json:"previous_credentials_keys" yaml:"previous_credentials_keys" mapstructure:"previous_credentials_keys"`
```

In `mergeConfigurations` in `extension/extension.go`, before the final `return`:

```go
	if yamlConfig.CredentialsKey == "" && programmaticConfig.CredentialsKey != "" {
		yamlConfig.CredentialsKey = programmaticConfig.CredentialsKey
		yamlConfig.CredentialsKeyID = programmaticConfig.CredentialsKeyID
	}
	if len(yamlConfig.PreviousCredentialsKeys) == 0 {
		yamlConfig.PreviousCredentialsKeys = programmaticConfig.PreviousCredentialsKeys
	}
```

- [ ] **Step 3: Turn config into options**

`extension/credentials.go`:

```go
package extension

import (
	"errors"
	"fmt"

	"github.com/xraph/herald"
	"github.com/xraph/herald/credential"
)

// CredentialKeyConfig is one previous credential key.
type CredentialKeyConfig struct {
	ID  string `json:"id" yaml:"id" mapstructure:"id"`
	Key string `json:"key" yaml:"key" mapstructure:"key"`
}

// credentialOptions turns the key settings into herald options. Errors name
// the setting and never echo its value.
func (c Config) credentialOptions() ([]herald.Option, error) {
	if c.CredentialsKey == "" {
		if len(c.PreviousCredentialsKeys) > 0 {
			return nil, errors.New("herald: previous_credentials_keys is set but credentials_key is not")
		}
		return nil, nil
	}
	key, err := credential.ParseKey(c.CredentialsKey)
	if err != nil {
		return nil, fmt.Errorf("herald: credentials_key: %w", err)
	}
	keyID := c.CredentialsKeyID
	if keyID == "" {
		keyID = "k1"
	}
	opts := []herald.Option{herald.WithCredentialKey(keyID, key)}
	for i, pk := range c.PreviousCredentialsKeys {
		b, err := credential.ParseKey(pk.Key)
		if err != nil {
			return nil, fmt.Errorf("herald: previous_credentials_keys[%d]: %w", i, err)
		}
		opts = append(opts, herald.WithPreviousCredentialKey(pk.ID, b))
	}
	return opts, nil
}
```

`credential.ParseKey`'s errors describe length and encoding only, never the input.

- [ ] **Step 4: Mount the API with the host's middleware**

`extension/mount.go`:

```go
package extension

import (
	"github.com/xraph/forge"

	"github.com/xraph/herald/api"
)

// mountAPI registers the REST API under basePath behind the host's
// middleware and reports whether anything protects it.
//
// This deliberately doesn't offer forge's WithGroupAuth: at forge v1.10.0 and
// v1.11.2 it only writes auth metadata for the OpenAPI generator, and nothing
// enforces it, so it would make the API document auth while serving every
// request. Middleware is the only thing that actually runs.
func mountAPI(router forge.Router, a *api.ForgeAPI, basePath string, mw []forge.Middleware, logger forge.Logger) bool {
	var opts []forge.GroupOption
	if len(mw) > 0 {
		opts = append(opts, forge.WithGroupMiddleware(mw...))
	}
	a.RegisterRoutes(router.Group(basePath, opts...))
	if len(mw) == 0 && logger != nil {
		logger.Warn("herald: the REST API is mounted with no authentication; anyone who can reach it can read and change notification data. Protect it with extension.WithAPIMiddleware.",
			forge.F("base_path", basePath))
	}
	return len(mw) > 0
}
```

In `extension/options.go`, add (with `"github.com/xraph/forge"` imported):

```go
// WithAPIMiddleware runs mw in front of every Herald REST route. Herald can't
// know your auth scheme, so this is where you put it. Without it, startup
// warns that the API is unauthenticated.
func WithAPIMiddleware(mw ...forge.Middleware) ExtOption {
	return func(e *Extension) {
		e.apiMiddleware = append(e.apiMiddleware, mw...)
	}
}
```

In `extension/extension.go`:
- add fields `apiMiddleware []forge.Middleware` and `apiProtected bool` to `Extension`;
- set `const ExtensionVersion = "1.7.0"`;
- in `Init`, right after `heraldOpts = append(heraldOpts, e.config.ToHeraldOptions()...)`, add:

```go
	credOpts, err := e.config.credentialOptions()
	if err != nil {
		return err
	}
	heraldOpts = append(heraldOpts, credOpts...)
```

  and rename the later `var err error` before `herald.New` to plain assignment (`e.h, err = herald.New(...)`) since `err` now exists;
- replace `e.api.RegisterRoutes(fapp.Router().Group(basePath))` with `e.apiProtected = mountAPI(fapp.Router(), e.api, basePath, e.apiMiddleware, e.Logger())`;
- add:

```go
// APIProtected reports whether the REST API was mounted behind middleware.
// False also when routes are disabled and the host mounts them itself.
func (e *Extension) APIProtected() bool { return e.apiProtected }
```

- [ ] **Step 5: Prove `${ENV}` reaches the key**

The config comment already promises `${ENV}` for provider credentials, and nothing in `extension/` expands it, so forge's config loader must. Prove it for the new key rather than assume it: in a scratch program (not in the repo) or a temporary test you delete afterwards, load a YAML config through the same `cm.Bind("extensions.herald", &cfg)` path with `credentials_key: ${HERALD_TEST_KEY}` and `HERALD_TEST_KEY` set, and print `cfg.CredentialsKey != "${HERALD_TEST_KEY}"`. If it prints `false`, interpolation doesn't happen for this field: add `os.ExpandEnv` to `CredentialsKey` and each `PreviousCredentialsKeys[i].Key` at the top of `credentialOptions`, with a test, and say so in the task report. Either way, record what you found in the report.

- [ ] **Step 6: Run, lint, commit**

```bash
go test ./extension/ && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add extension/credentials.go extension/credentials_test.go extension/mount.go extension/mount_test.go
git commit --only -m "feat(extension): configure a credential key and put real middleware in front of the API" -- \
  extension/credentials.go extension/credentials_test.go extension/mount.go extension/mount_test.go \
  extension/config.go extension/options.go extension/extension.go
git show --stat HEAD
```

Expected: all `ok`, `0 issues`.

---

### Task 14: A REST API that doesn't leak, checks ownership, and says what went wrong

Every provider route returns credentials in full. By-ID routes never check which app a row belongs to. Every error, not-found included, is a 500. A `PUT` that leaves out `"enabled": true` disables the record, and priority can never go back to 0. Version routes don't check the version belongs to the template in the path. This task fixes each.

**Files:**
- Create: `api/errors.go`, `api/responses.go`, `api/ownership.go`, `api/api_test.go`
- Modify: `api/api.go`

**Interfaces:**
- Consumes: engine provider methods (Task 12), sentinels (Task 1).
- Produces: `api.ProviderResponse` (JSON `id`, `app_id`, `name`, `channel`, `driver`, `credentials`, `settings`, `priority`, `enabled`, `created_at`, `updated_at`), `api.EncryptProvidersRequest`, route `POST /v1/providers/encrypt?app_id=`.

- [ ] **Step 1: Write the failing tests**

`api/api_test.go`:

```go
package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/xraph/forge"

	"github.com/xraph/herald"
	"github.com/xraph/herald/api"
	"github.com/xraph/herald/driver/email"
	"github.com/xraph/herald/id"
	"github.com/xraph/herald/provider"
	"github.com/xraph/herald/store/memory"
)

const canary = "sk_canary_api_value"

type harness struct {
	handler http.Handler
	st      *memory.Store
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	st := memory.New()
	h, err := herald.New(herald.WithStore(st), herald.WithDriver(&email.ResendDriver{}),
		herald.WithCredentialKey("k1", bytes.Repeat([]byte{7}, 32)))
	if err != nil {
		t.Fatal(err)
	}
	router := forge.NewRouter()
	api.NewForgeAPI(st, h, forge.NewNoopLogger()).RegisterRoutes(router)
	return &harness{handler: router.Handler(), st: st}
}

func (x *harness) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(method, path, nil)
	} else {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	x.handler.ServeHTTP(rec, r)
	if strings.Contains(rec.Body.String(), canary) {
		t.Fatalf("%s %s leaked a credential value: %s", method, path, rec.Body)
	}
	return rec
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func (x *harness) createProvider(t *testing.T, appID string) api.ProviderResponse {
	t.Helper()
	rec := x.do(t, http.MethodPost, "/v1/providers", map[string]any{
		"app_id": appID, "name": "resend", "channel": "email", "driver": "resend",
		"credentials": map[string]string{"api_key": canary}, "enabled": true,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create provider: %d %s", rec.Code, rec.Body)
	}
	return decode[api.ProviderResponse](t, rec)
}

func TestCredentialValuesNeverLeave(t *testing.T) {
	x := newHarness(t)
	p := x.createProvider(t, "app_a")
	if len(p.Credentials) != 1 || p.Credentials[0].Key != "api_key" ||
		p.Credentials[0].Protection != herald.ProtectionAESGCM || p.Credentials[0].KeyID != "k1" {
		t.Errorf("credentials = %+v", p.Credentials)
	}
	// do() fails the test on any response containing the canary.
	x.do(t, http.MethodGet, "/v1/providers?app_id=app_a", nil)
	x.do(t, http.MethodGet, "/v1/providers/"+p.ID+"?app_id=app_a", nil)
	x.do(t, http.MethodPut, "/v1/providers/"+p.ID+"?app_id=app_a", map[string]any{"name": "renamed"})
}

func TestUpdateWithoutEnabledKeepsItEnabled(t *testing.T) {
	x := newHarness(t)
	p := x.createProvider(t, "app_a")
	rec := x.do(t, http.MethodPut, "/v1/providers/"+p.ID+"?app_id=app_a", map[string]any{"name": "renamed"})
	if rec.Code != http.StatusOK {
		t.Fatalf("update: %d %s", rec.Code, rec.Body)
	}
	got := decode[api.ProviderResponse](t, x.do(t, http.MethodGet, "/v1/providers/"+p.ID+"?app_id=app_a", nil))
	if !got.Enabled || got.Name != "renamed" {
		t.Errorf("after a PUT without enabled: %+v", got)
	}
	rec = x.do(t, http.MethodPut, "/v1/providers/"+p.ID+"?app_id=app_a", map[string]any{"priority": 0, "enabled": false})
	got = decode[api.ProviderResponse](t, rec)
	if got.Enabled || got.Priority != 0 {
		t.Errorf("explicit enabled=false and priority=0 must apply: %+v", got)
	}
}

func TestByIDRoutesCheckTheApp(t *testing.T) {
	x := newHarness(t)
	p := x.createProvider(t, "app_a")
	for _, q := range []string{"?app_id=app_b", ""} {
		if rec := x.do(t, http.MethodGet, "/v1/providers/"+p.ID+q, nil); rec.Code != http.StatusNotFound {
			t.Errorf("GET provider%s = %d, want 404", q, rec.Code)
		}
	}
	if rec := x.do(t, http.MethodDelete, "/v1/providers/"+p.ID+"?app_id=app_b", nil); rec.Code != http.StatusNotFound {
		t.Errorf("DELETE from another app = %d, want 404", rec.Code)
	}
	if rec := x.do(t, http.MethodGet, "/v1/providers/"+p.ID+"?app_id=app_a", nil); rec.Code != http.StatusOK {
		t.Errorf("GET from its own app = %d", rec.Code)
	}
}

func TestErrorCodes(t *testing.T) {
	x := newHarness(t)
	if rec := x.do(t, http.MethodGet, "/v1/providers/"+id.NewProviderID().String(), nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing provider = %d, want 404", rec.Code)
	}
	if rec := x.do(t, http.MethodGet, "/v1/providers/not-an-id", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("bad ID = %d, want 400", rec.Code)
	}
	rec := x.do(t, http.MethodPost, "/v1/providers", map[string]any{
		"app_id": "app_a", "name": "x", "channel": "sms", "driver": "resend", "credentials": map[string]string{"api_key": canary},
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("driver on the wrong channel = %d, want 400", rec.Code)
	}
	tmpl := map[string]any{"app_id": "app_a", "slug": "welcome", "name": "W", "channel": "email", "enabled": true}
	if rec := x.do(t, http.MethodPost, "/v1/templates", tmpl); rec.Code != http.StatusCreated {
		t.Fatalf("create template: %d %s", rec.Code, rec.Body)
	}
	if rec := x.do(t, http.MethodPost, "/v1/templates", tmpl); rec.Code != http.StatusConflict {
		t.Errorf("duplicate slug = %d, want 409", rec.Code)
	}
	if rec := x.do(t, http.MethodDelete, "/v1/config/org/org_1?app_id=app_a", nil); rec.Code != http.StatusNotFound {
		t.Errorf("deleting a missing org config = %d, want 404 (it used to panic)", rec.Code)
	}
}

func TestVersionMustBelongToTheTemplateInThePath(t *testing.T) {
	x := newHarness(t)
	mk := func(slug string) string {
		rec := x.do(t, http.MethodPost, "/v1/templates", map[string]any{"app_id": "app_a", "slug": slug, "name": slug, "channel": "email", "enabled": true})
		return decode[map[string]any](t, rec)["id"].(string)
	}
	t1, t2 := mk("one"), mk("two")
	rec := x.do(t, http.MethodPost, "/v1/templates/"+t1+"/versions?app_id=app_a", map[string]any{"locale": "en", "text": "hi"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create version: %d %s", rec.Code, rec.Body)
	}
	v := decode[map[string]any](t, rec)["id"].(string)
	if rec := x.do(t, http.MethodPut, "/v1/templates/"+t2+"/versions/"+v+"?app_id=app_a", map[string]any{"text": "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("version through the wrong template = %d, want 404", rec.Code)
	}
	if rec := x.do(t, http.MethodPost, "/v1/templates/"+t1+"/versions?app_id=app_a", map[string]any{"locale": "en"}); rec.Code != http.StatusConflict {
		t.Errorf("duplicate locale = %d, want 409", rec.Code)
	}
}

func TestScopedConfigReturnsTheStoredRow(t *testing.T) {
	x := newHarness(t)
	body := map[string]any{"app_id": "app_a", "webhook_provider_id": "hpvd_w", "chat_provider_id": "hpvd_c"}
	first := decode[map[string]any](t, x.do(t, http.MethodPut, "/v1/config/app", body))
	second := decode[map[string]any](t, x.do(t, http.MethodPut, "/v1/config/app", body))
	if first["id"] != second["id"] {
		t.Errorf("upsert answered two different IDs: %v, %v", first["id"], second["id"])
	}
	if second["webhook_provider_id"] != "hpvd_w" || second["chat_provider_id"] != "hpvd_c" {
		t.Errorf("webhook/chat not stored: %+v", second)
	}
}

func TestEncryptRoute(t *testing.T) {
	x := newHarness(t)
	if err := x.st.CreateProvider(t.Context(), &provider.Provider{
		ID: id.NewProviderID(), AppID: "app_a", Name: "legacy", Channel: "email", Driver: "resend",
		Credentials: map[string]string{"api_key": canary}, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}
	rec := x.do(t, http.MethodPost, "/v1/providers/encrypt?app_id=app_a", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("encrypt: %d %s", rec.Code, rec.Body)
	}
	if rep := decode[herald.EncryptReport](t, rec); rep.Providers != 1 || rep.ValuesEncrypted != 1 {
		t.Errorf("report = %+v", rep)
	}
}
```

Run: `go test ./api/ 2>&1 | head -30`
Expected: FAIL. It compiles (`api.ProviderResponse` is the one new name; if it doesn't, that's the first failure), then the canary check fails on the first create because credentials are echoed.

- [ ] **Step 2: Error mapping**

`api/errors.go` (and delete the old `mapError` at the bottom of `api/api.go`):

```go
package api

import (
	"errors"
	"net/http"

	"github.com/xraph/forge"

	"github.com/xraph/herald"
	"github.com/xraph/herald/store"
)

// mapError turns a domain error into its HTTP status. Only errors with no
// domain meaning become a 500.
func mapError(err error) error {
	switch {
	case err == nil:
		return nil
	case isAny(err, store.ErrProviderNotFound, store.ErrTemplateNotFound, store.ErrVersionNotFound,
		store.ErrMessageNotFound, store.ErrNotificationNotFound, store.ErrPreferenceNotFound, store.ErrScopedConfigNotFound):
		return forge.NotFound(err.Error())
	case isAny(err, store.ErrDuplicateSlug, store.ErrDuplicateLocale):
		return forge.NewHTTPError(http.StatusConflict, err.Error())
	case isAny(err, herald.ErrInvalidProvider, herald.ErrInvalidChannel, herald.ErrDriverNotFound,
		herald.ErrNoProviderConfigured, herald.ErrTemplateDisabled, herald.ErrNoVersionForLocale,
		herald.ErrMissingRequiredVariable, herald.ErrTemplateRenderFailed,
		herald.ErrNoCredentialKey, herald.ErrCredentialKeyUnavailable):
		return forge.BadRequest(err.Error())
	default:
		return forge.InternalError(err)
	}
}

func isAny(err error, targets ...error) bool {
	for _, t := range targets {
		if errors.Is(err, t) {
			return true
		}
	}
	return false
}
```

- [ ] **Step 3: A provider response with no values**

`api/responses.go`:

```go
package api

import (
	"maps"
	"time"

	"github.com/xraph/herald"
	"github.com/xraph/herald/provider"
)

// ProviderResponse is a provider as the API shows it. Credentials are key
// names and how each is stored, never values. Settings the driver marks as
// secret are left out too, for rows written before that rule existed.
type ProviderResponse struct {
	ID          string                   `json:"id"`
	AppID       string                   `json:"app_id"`
	Name        string                   `json:"name"`
	Channel     string                   `json:"channel"`
	Driver      string                   `json:"driver"`
	Credentials []herald.CredentialState `json:"credentials"`
	Settings    map[string]string        `json:"settings,omitempty"`
	Priority    int                      `json:"priority"`
	Enabled     bool                     `json:"enabled"`
	CreatedAt   time.Time                `json:"created_at"`
	UpdatedAt   time.Time                `json:"updated_at"`
}

// EncryptProvidersRequest names the app whose credentials to encrypt.
type EncryptProvidersRequest struct {
	AppID string `description:"Application ID" query:"app_id"`
}

func (a *ForgeAPI) providerResponse(p *provider.Provider) *ProviderResponse {
	settings := maps.Clone(p.Settings)
	if fields, ok := a.herald.Drivers().Describe(p.Driver); ok {
		for _, f := range fields {
			if f.Secret {
				delete(settings, f.Key)
			}
		}
	}
	return &ProviderResponse{
		ID: p.ID.String(), AppID: p.AppID, Name: p.Name, Channel: p.Channel, Driver: p.Driver,
		Credentials: a.herald.CredentialStatus(p), Settings: settings,
		Priority: p.Priority, Enabled: p.Enabled, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}
```

- [ ] **Step 4: Ownership helpers**

`api/ownership.go`:

```go
package api

import (
	"context"

	"github.com/xraph/forge"

	"github.com/xraph/herald/id"
	"github.com/xraph/herald/inbox"
	"github.com/xraph/herald/message"
	"github.com/xraph/herald/store"
	"github.com/xraph/herald/template"
)

// Every by-ID route loads the row and compares its app to app_id. A row from
// another app is a 404, exactly like a row that doesn't exist, so a response
// never confirms that an ID exists elsewhere. An absent app_id means the ""
// app, the same exact match every list route already uses.

func parseProviderID(raw string) (id.ProviderID, error) {
	pid, err := id.ParseProviderID(raw)
	if err != nil {
		return id.Nil, forge.BadRequest("invalid provider ID")
	}
	return pid, nil
}

func (a *ForgeAPI) ownedTemplate(ctx context.Context, appID, raw string) (*template.Template, error) {
	tid, err := id.ParseTemplateID(raw)
	if err != nil {
		return nil, forge.BadRequest("invalid template ID")
	}
	t, err := a.store.GetTemplate(ctx, tid)
	if err != nil {
		return nil, mapError(err)
	}
	if t.AppID != appID {
		return nil, mapError(store.ErrTemplateNotFound)
	}
	return t, nil
}

func (a *ForgeAPI) ownedVersion(ctx context.Context, appID, templateRaw, versionRaw string) (*template.Version, error) {
	t, err := a.ownedTemplate(ctx, appID, templateRaw)
	if err != nil {
		return nil, err
	}
	vid, err := id.ParseTemplateVersionID(versionRaw)
	if err != nil {
		return nil, forge.BadRequest("invalid version ID")
	}
	v, err := a.store.GetVersion(ctx, vid)
	if err != nil {
		return nil, mapError(err)
	}
	if v.TemplateID.String() != t.ID.String() {
		return nil, mapError(store.ErrVersionNotFound)
	}
	return v, nil
}

func (a *ForgeAPI) ownedMessage(ctx context.Context, appID, raw string) (*message.Message, error) {
	mid, err := id.ParseMessageID(raw)
	if err != nil {
		return nil, forge.BadRequest("invalid message ID")
	}
	m, err := a.store.GetMessage(ctx, mid)
	if err != nil {
		return nil, mapError(err)
	}
	if m.AppID != appID {
		return nil, mapError(store.ErrMessageNotFound)
	}
	return m, nil
}

func (a *ForgeAPI) ownedNotification(ctx context.Context, appID, raw string) (*inbox.Notification, error) {
	nid, err := id.ParseInboxID(raw)
	if err != nil {
		return nil, forge.BadRequest("invalid notification ID")
	}
	n, err := a.store.GetNotification(ctx, nid)
	if err != nil {
		return nil, mapError(err)
	}
	if n.AppID != appID {
		return nil, mapError(store.ErrNotificationNotFound)
	}
	return n, nil
}
```

- [ ] **Step 5: Request types**

In `api/api.go`, add this field to `GetProviderRequest`, `DeleteProviderRequest`, `GetTemplateRequest`, `DeleteTemplateRequest`, `CreateVersionRequest`, `ListVersionsRequest`, `DeleteVersionRequest`, `GetMessageRequest`, `MarkReadRequest` and `DeleteInboxRequest`:

```go
	AppID string `description:"Application ID" query:"app_id"`
```

Replace `UpdateProviderRequest`, `UpdateTemplateRequest` and `UpdateVersionRequest`:

```go
// UpdateProviderRequest changes only what it sends. Credentials and settings
// merge: keys sent are set, keys in the remove lists are deleted, and
// everything else is kept. A provider's channel and driver can't change;
// create a new provider instead.
type UpdateProviderRequest struct {
	ID                string            `description:"Provider ID"                path:"id"`
	AppID             string            `description:"Application ID"             query:"app_id"`
	Name              *string           `description:"Provider name"              json:"name,omitempty"`
	Priority          *int              `description:"Priority order"             json:"priority,omitempty"`
	Enabled           *bool             `description:"Is enabled"                 json:"enabled,omitempty"`
	Credentials       map[string]string `description:"Credentials to set"         json:"credentials,omitempty"`
	RemoveCredentials []string          `description:"Credential keys to remove"  json:"remove_credentials,omitempty"`
	Settings          map[string]string `description:"Settings to set"            json:"settings,omitempty"`
	RemoveSettings    []string          `description:"Setting keys to remove"     json:"remove_settings,omitempty"`
}

type UpdateTemplateRequest struct {
	ID        string               `description:"Template ID"        path:"id"`
	AppID     string               `description:"Application ID"     query:"app_id"`
	Slug      *string              `description:"Template slug"      json:"slug,omitempty"`
	Name      *string              `description:"Template name"      json:"name,omitempty"`
	Channel   *string              `description:"Channel type"       json:"channel,omitempty"`
	Category  *string              `description:"Template category"  json:"category,omitempty"`
	Variables *[]template.Variable `description:"Template variables" json:"variables,omitempty"`
	Enabled   *bool                `description:"Is enabled"         json:"enabled,omitempty"`
}

type UpdateVersionRequest struct {
	TemplateID string  `description:"Template ID"    path:"id"`
	VersionID  string  `description:"Version ID"     path:"versionId"`
	AppID      string  `description:"Application ID" query:"app_id"`
	Locale     *string `description:"Locale code"    json:"locale,omitempty"`
	Subject    *string `description:"Subject"        json:"subject,omitempty"`
	HTML       *string `description:"HTML body"      json:"html,omitempty"`
	Text       *string `description:"Text body"      json:"text,omitempty"`
	Title      *string `description:"Title"          json:"title,omitempty"`
	Active     *bool   `description:"Is active"      json:"active,omitempty"`
}
```

Add to `SetAppConfigRequest`, `SetOrgConfigRequest` and `SetUserConfigRequest`:

```go
	WebhookProviderID string `description:"Webhook provider ID" json:"webhook_provider_id,omitempty"`
	ChatProviderID    string `description:"Chat provider ID"    json:"chat_provider_id,omitempty"`
```

- [ ] **Step 6: Handlers**

In `registerProviderRoutes`, change the response schema of the four provider routes from `provider.Provider{}` to `ProviderResponse{}` (`WithCreatedResponse`, `WithListResponse`, and both `WithResponseSchema`), and register the encrypt route after the create route:

```go
	if err := g.POST("/encrypt", a.encryptProviders,
		forge.WithSummary("Encrypt stored credentials"),
		forge.WithDescription("Encrypts every plaintext credential of every provider in the app. Needs a credential key."),
		forge.WithOperationID("encryptProviderCredentials"),
		forge.WithRequestSchema(EncryptProvidersRequest{}),
		forge.WithResponseSchema(http.StatusOK, "What changed", herald.EncryptReport{}),
		forge.WithErrorResponses(),
	); err != nil {
		a.logger.Error("failed to register encryptProviderCredentials route", forge.Error(err))
	}
```

Replace the provider handlers:

```go
func (a *ForgeAPI) createProvider(ctx forge.Context, req *CreateProviderRequest) (*ProviderResponse, error) {
	p := &provider.Provider{
		AppID: req.AppID, Name: req.Name, Channel: req.Channel, Driver: req.Driver,
		Credentials: req.Credentials, Settings: req.Settings, Priority: req.Priority, Enabled: req.Enabled,
	}
	if err := a.herald.CreateProvider(ctx.Context(), p); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityInfo, bridge.OutcomeSuccess, "provider.create", "provider", p.ID.String(), "", req.AppID, "provider", map[string]string{
		"name": p.Name, "channel": p.Channel, "driver": p.Driver,
	})
	if err := ctx.JSON(http.StatusCreated, a.providerResponse(p)); err != nil {
		return nil, err
	}
	return nil, nil //nolint:nilnil // response already sent via ctx
}

func (a *ForgeAPI) listProviders(ctx forge.Context, req *ListProvidersRequest) (*struct{}, error) {
	var providers []*provider.Provider
	var err error
	if req.Channel != "" {
		providers, err = a.store.ListProviders(ctx.Context(), req.AppID, req.Channel)
	} else {
		providers, err = a.store.ListAllProviders(ctx.Context(), req.AppID)
	}
	if err != nil {
		return nil, mapError(err)
	}
	out := make([]*ProviderResponse, 0, len(providers))
	for _, p := range providers {
		out = append(out, a.providerResponse(p))
	}
	if err := ctx.JSON(http.StatusOK, out); err != nil {
		return nil, err
	}
	return nil, nil //nolint:nilnil // response already sent via ctx
}

func (a *ForgeAPI) getProvider(ctx forge.Context, req *GetProviderRequest) (*ProviderResponse, error) {
	pid, err := parseProviderID(req.ID)
	if err != nil {
		return nil, err
	}
	p, err := a.herald.GetProvider(ctx.Context(), req.AppID, pid)
	if err != nil {
		return nil, mapError(err)
	}
	return a.providerResponse(p), nil
}

func (a *ForgeAPI) updateProvider(ctx forge.Context, req *UpdateProviderRequest) (*ProviderResponse, error) {
	pid, err := parseProviderID(req.ID)
	if err != nil {
		return nil, err
	}
	p, err := a.herald.UpdateProvider(ctx.Context(), req.AppID, pid, herald.ProviderUpdate{
		Name: req.Name, Priority: req.Priority, Enabled: req.Enabled,
		SetCredentials: req.Credentials, RemoveCredentials: req.RemoveCredentials,
		SetSettings: req.Settings, RemoveSettings: req.RemoveSettings,
	})
	if err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityInfo, bridge.OutcomeSuccess, "provider.update", "provider", p.ID.String(), "", p.AppID, "provider", map[string]string{
		"name": p.Name, "channel": p.Channel,
	})
	return a.providerResponse(p), nil
}

func (a *ForgeAPI) deleteProvider(ctx forge.Context, req *DeleteProviderRequest) (*ProviderResponse, error) {
	pid, err := parseProviderID(req.ID)
	if err != nil {
		return nil, err
	}
	if err := a.herald.DeleteProvider(ctx.Context(), req.AppID, pid); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityWarning, bridge.OutcomeSuccess, "provider.delete", "provider", pid.String(), "", req.AppID, "provider", nil)
	if err := ctx.NoContent(http.StatusNoContent); err != nil {
		return nil, err
	}
	return nil, nil //nolint:nilnil // response already sent via ctx
}

func (a *ForgeAPI) encryptProviders(ctx forge.Context, req *EncryptProvidersRequest) (*herald.EncryptReport, error) {
	rep, err := a.herald.EncryptStoredCredentials(ctx.Context(), req.AppID)
	if err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityWarning, bridge.OutcomeSuccess, "provider.encrypt_credentials", "provider", "", "", req.AppID, "provider", map[string]string{
		"providers": strconv.Itoa(rep.Providers), "values_encrypted": strconv.Itoa(rep.ValuesEncrypted),
	})
	return &rep, nil
}
```

Replace the by-ID template, version, message and inbox handlers so they go through the ownership helpers. The changes, handler by handler:

```go
func (a *ForgeAPI) getTemplate(ctx forge.Context, req *GetTemplateRequest) (*template.Template, error) {
	return a.ownedTemplate(ctx.Context(), req.AppID, req.ID)
}

func (a *ForgeAPI) updateTemplate(ctx forge.Context, req *UpdateTemplateRequest) (*template.Template, error) {
	existing, err := a.ownedTemplate(ctx.Context(), req.AppID, req.ID)
	if err != nil {
		return nil, err
	}
	if req.Slug != nil {
		existing.Slug = *req.Slug
	}
	if req.Name != nil {
		existing.Name = *req.Name
	}
	if req.Channel != nil {
		existing.Channel = *req.Channel
	}
	if req.Category != nil {
		existing.Category = *req.Category
	}
	if req.Variables != nil {
		existing.Variables = *req.Variables
	}
	if req.Enabled != nil {
		existing.Enabled = *req.Enabled
	}
	existing.UpdatedAt = time.Now().UTC()
	if err := a.store.UpdateTemplate(ctx.Context(), existing); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityInfo, bridge.OutcomeSuccess, "template.update", "template", existing.ID.String(), "", existing.AppID, "template", map[string]string{
		"slug": existing.Slug, "channel": existing.Channel,
	})
	return existing, nil
}

func (a *ForgeAPI) deleteTemplate(ctx forge.Context, req *DeleteTemplateRequest) (*template.Template, error) {
	t, err := a.ownedTemplate(ctx.Context(), req.AppID, req.ID)
	if err != nil {
		return nil, err
	}
	if err := a.store.DeleteTemplate(ctx.Context(), t.ID); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityWarning, bridge.OutcomeSuccess, "template.delete", "template", t.ID.String(), "", t.AppID, "template", nil)
	if err := ctx.NoContent(http.StatusNoContent); err != nil {
		return nil, err
	}
	return nil, nil //nolint:nilnil // response already sent via ctx
}
```

In `createVersion`, replace the `id.ParseTemplateID` block with `t, err := a.ownedTemplate(ctx.Context(), req.AppID, req.TemplateID); if err != nil { return nil, err }` and use `t.ID` as `TemplateID`; the `CreateVersion` error already goes through `mapError`, which now answers 409 for a duplicate locale. In `listVersions`, the same `ownedTemplate` call replaces the parse, and `ListVersions` uses `t.ID`.

```go
func (a *ForgeAPI) updateVersion(ctx forge.Context, req *UpdateVersionRequest) (*template.Version, error) {
	existing, err := a.ownedVersion(ctx.Context(), req.AppID, req.TemplateID, req.VersionID)
	if err != nil {
		return nil, err
	}
	if req.Locale != nil {
		existing.Locale = *req.Locale
	}
	if req.Subject != nil {
		existing.Subject = *req.Subject
	}
	if req.HTML != nil {
		existing.HTML = *req.HTML
	}
	if req.Text != nil {
		existing.Text = *req.Text
	}
	if req.Title != nil {
		existing.Title = *req.Title
	}
	if req.Active != nil {
		existing.Active = *req.Active
	}
	existing.UpdatedAt = time.Now().UTC()
	if err := a.store.UpdateVersion(ctx.Context(), existing); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityInfo, bridge.OutcomeSuccess, "template_version.update", "template_version", existing.ID.String(), "", req.AppID, "template", map[string]string{
		"locale": existing.Locale,
	})
	return existing, nil
}

func (a *ForgeAPI) deleteVersion(ctx forge.Context, req *DeleteVersionRequest) (*template.Version, error) {
	v, err := a.ownedVersion(ctx.Context(), req.AppID, req.TemplateID, req.VersionID)
	if err != nil {
		return nil, err
	}
	if err := a.store.DeleteVersion(ctx.Context(), v.ID); err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityWarning, bridge.OutcomeSuccess, "template_version.delete", "template_version", v.ID.String(), "", req.AppID, "template", nil)
	if err := ctx.NoContent(http.StatusNoContent); err != nil {
		return nil, err
	}
	return nil, nil //nolint:nilnil // response already sent via ctx
}

func (a *ForgeAPI) getMessage(ctx forge.Context, req *GetMessageRequest) (*message.Message, error) {
	return a.ownedMessage(ctx.Context(), req.AppID, req.ID)
}
```

In `markRead` and `deleteInboxItem`, replace the `id.ParseInboxID` block with `n, err := a.ownedNotification(ctx.Context(), req.AppID, req.ID); if err != nil { return nil, err }` and pass `n.ID` to the store.

Replace the scoped-config writers so they return the row the store holds:

```go
func (a *ForgeAPI) setAppConfig(ctx forge.Context, req *SetAppConfigRequest) (*scope.Config, error) {
	return a.saveScopedConfig(ctx, &scope.Config{
		AppID: req.AppID, Scope: scope.ScopeApp, ScopeID: req.AppID,
		EmailProviderID: req.EmailProviderID, SMSProviderID: req.SMSProviderID, PushProviderID: req.PushProviderID,
		WebhookProviderID: req.WebhookProviderID, ChatProviderID: req.ChatProviderID,
		FromEmail: req.FromEmail, FromName: req.FromName, FromPhone: req.FromPhone, DefaultLocale: req.DefaultLocale,
	})
}

func (a *ForgeAPI) setOrgConfig(ctx forge.Context, req *SetOrgConfigRequest) (*scope.Config, error) {
	return a.saveScopedConfig(ctx, &scope.Config{
		AppID: req.AppID, Scope: scope.ScopeOrg, ScopeID: req.OrgID,
		EmailProviderID: req.EmailProviderID, SMSProviderID: req.SMSProviderID, PushProviderID: req.PushProviderID,
		WebhookProviderID: req.WebhookProviderID, ChatProviderID: req.ChatProviderID,
		FromEmail: req.FromEmail, FromName: req.FromName, FromPhone: req.FromPhone, DefaultLocale: req.DefaultLocale,
	})
}

func (a *ForgeAPI) setUserConfig(ctx forge.Context, req *SetUserConfigRequest) (*scope.Config, error) {
	return a.saveScopedConfig(ctx, &scope.Config{
		AppID: req.AppID, Scope: scope.ScopeUser, ScopeID: req.UserID,
		EmailProviderID: req.EmailProviderID, SMSProviderID: req.SMSProviderID, PushProviderID: req.PushProviderID,
		WebhookProviderID: req.WebhookProviderID, ChatProviderID: req.ChatProviderID,
		FromEmail: req.FromEmail, FromName: req.FromName, FromPhone: req.FromPhone, DefaultLocale: req.DefaultLocale,
	})
}

// saveScopedConfig upserts cfg and answers with the stored row. The store
// keeps an existing row's ID on upsert, so the freshly minted ID below is
// only used when the row is new.
func (a *ForgeAPI) saveScopedConfig(ctx forge.Context, cfg *scope.Config) (*scope.Config, error) {
	now := time.Now().UTC()
	cfg.ID = id.NewScopedConfigID()
	cfg.CreatedAt, cfg.UpdatedAt = now, now
	if err := a.store.SetScopedConfig(ctx.Context(), cfg); err != nil {
		return nil, mapError(err)
	}
	saved, err := a.store.GetScopedConfig(ctx.Context(), cfg.AppID, cfg.Scope, cfg.ScopeID)
	if err != nil {
		return nil, mapError(err)
	}
	a.herald.Audit(ctx.Context(), bridge.SeverityInfo, bridge.OutcomeSuccess, "config.set", "scoped_config", saved.ID.String(), "", saved.AppID, "config", map[string]string{
		"scope": string(saved.Scope), "scope_id": saved.ScopeID,
	})
	return saved, nil
}
```

`deleteOrgConfig` and `deleteUserConfig` need no edit: `GetScopedConfig` now returns `ErrScopedConfigNotFound`, which `mapError` answers with 404, where it used to dereference `nil`.

Imports for `api/api.go`: add `"strconv"`; drop any that `go build` reports unused.

- [ ] **Step 7: Run, lint, commit**

```bash
go test ./api/ && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
git add api/errors.go api/responses.go api/ownership.go api/api_test.go
git commit --only -m "fix(api): stop returning credentials, check which app a row belongs to, and answer with real status codes" -- \
  api/api.go api/errors.go api/responses.go api/ownership.go api/api_test.go
git show --stat HEAD
```

Expected: all `ok`, `0 issues`. If a test fails because forge doesn't bind `query:"app_id"` on a request that also has a JSON body, confirm it with a one-line print of `req.AppID`, then read forge's binder (`go doc github.com/xraph/forge Context`) rather than working around it; report what you find.

---
### Task 15: Driver fixes

Four bugs found while reading the drivers, each small and each with a test that fails first:

- APNs caches one JWT on the driver, not keyed by key or team, so a second APNs provider sends with the first provider's token for up to fifty minutes.
- FCM and webhook forward the whole merged credential map, minus a short exclude list, into the payload. An FCM provider sends its other credentials, and the from address, to every device.
- SMTP's plain path calls `smtp.SendMail`, which takes no context and sets no deadline, so a server that stops answering hangs the send.
- Discord appends `?wait=true` to the webhook URL as a string, which breaks a URL that already has a query (a `thread_id`, say).

**Files:**
- Create: `driver/payload.go`, `driver/payload_test.go`, `driver/email/smtp_timeout_test.go`, `drivers/apns/token_cache_test.go`
- Modify: `drivers/apns/apns.go`, `driver/push/fcm.go`, `driver/push/fcm_test.go`, `drivers/webhook/webhook.go`, `drivers/webhook/webhook_test.go`, `driver/email/smtp.go`, `drivers/discord/discord.go`, `drivers/discord/discord_test.go`

**Interfaces:**
- Produces: `driver.DataPayload(data map[string]string) map[string]string`: the settings whose key starts with `data.`, prefix removed; `nil` when there are none.

- [ ] **Step 1: The payload helper, test first**

`driver/payload_test.go`:

```go
package driver

import (
	"reflect"
	"testing"
)

func TestDataPayloadForwardsOnlyDataSettings(t *testing.T) {
	got := DataPayload(map[string]string{
		"access_token":  "tok",
		"server_key":    "sk",
		"from":          "no-reply@example.com",
		"data.order_id": "42",
		"data.":         "no name, dropped",
		"data.deep_link": "app://orders/42",
	})
	want := map[string]string{"order_id": "42", "deep_link": "app://orders/42"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("DataPayload = %v, want %v", got, want)
	}
	if DataPayload(map[string]string{"api_key": "x"}) != nil {
		t.Error("no data settings must give nil, so the payload omits data entirely")
	}
}
```

Run: `go test ./driver/ -run DataPayload` and expect a compile failure. Then `driver/payload.go`:

```go
package driver

import "strings"

// DataPayload returns the provider settings meant for the recipient's
// payload: keys starting with "data.", with the prefix removed. Nothing else
// in the merged credentials-and-settings map (API keys, tokens, from
// addresses) is ever forwarded. It returns nil when there are none.
func DataPayload(data map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range data {
		if name, ok := strings.CutPrefix(k, "data."); ok && name != "" {
			out[name] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
```

- [ ] **Step 2: FCM**

In `driver/push/fcm.go`, replace `fcmMsg.Message.Data = filterData(msg.Data)` with `fcmMsg.Message.Data = driver.DataPayload(msg.Data)` and delete `filterData`.

`TestFCMSendFiltersCredentials` in `driver/push/fcm_test.go` asserted the old rule, that any unknown key reaches the device. Replace its `Data` map and assertions so it pins the new one:

```go
		Data: map[string]string{
			"project_id":     "p",
			"access_token":   "tok",
			"server_key":     "sk",
			"base_url":       srv.URL,
			"from":           "no-reply@example.com",
			"username":       "leaks-if-forwarded",
			"data.order_id":  "42",
			"data.deep_link": "app://orders/42",
		},
```

```go
	want := map[string]string{"order_id": "42", "deep_link": "app://orders/42"}
	if !reflect.DeepEqual(body.Message.Data, want) {
		t.Errorf("message.data = %v, want only the data. settings %v", body.Message.Data, want)
	}
```

(Add `"reflect"` to that file's imports and delete the old per-key loops.) Run `go test ./driver/push/` and expect PASS.

- [ ] **Step 3: Webhook**

In `drivers/webhook/webhook.go`, replace `Data: filterData(msg.Data),` with `Data: driver.DataPayload(msg.Data),` and delete `filterData`. Add to `drivers/webhook/webhook_test.go`:

```go
func TestWebhookForwardsOnlyDataSettings(t *testing.T) {
	srv := drivertest.NewServer(t, http.StatusOK, `{}`)
	_, err := webhook.New(nil).Send(context.Background(), &driver.OutboundMessage{
		To: "u1", Text: "hi",
		Data: map[string]string{
			"url": srv.URL, "signing_secret": "s", "event_type": "order.paid",
			"from": "x@example.com", "api_key": "leaks-if-forwarded", "data.order": "1",
		},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	var body struct {
		Data map[string]string `json:"data"`
	}
	srv.Captured.DecodeJSON(t, &body)
	if len(body.Data) != 1 || body.Data["order"] != "1" {
		t.Errorf("payload data = %v, want only order=1", body.Data)
	}
}
```

Use the imports the file already has for `drivertest`, `driver`, `http` and `context`; add any that are missing. Run: `(cd drivers/webhook && go test ./...)` and expect PASS.

- [ ] **Step 4: APNs token cache, test first**

`drivers/apns/token_cache_test.go`:

```go
package apns

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"testing"
)

func TestTokenCacheIsPerKey(t *testing.T) {
	d := &Driver{}
	k1, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	k2, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)

	first, err := d.getOrRefreshToken("KEY1", "TEAM", k1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := d.getOrRefreshToken("KEY2", "TEAM", k2)
	if err != nil {
		t.Fatal(err)
	}
	if !verifyJWT(second, &k2.PublicKey) {
		t.Error("the second provider got a token signed with the first provider's key")
	}
	again, _ := d.getOrRefreshToken("KEY1", "TEAM", k1)
	if again != first {
		t.Error("the same key should reuse its cached token")
	}
}
```

Run: `(cd drivers/apns && go test ./... -run TokenCache)`. Expected: FAIL, because the second call returns the first token.

Then in `drivers/apns/apns.go`, replace the `Driver` struct and `getOrRefreshToken`:

```go
// Driver delivers push notifications via the Apple Push Notification service (APNs) HTTP/2 API.
type Driver struct {
	mu     sync.Mutex
	tokens map[string]cachedToken // keyed by team ID and key ID
}

type cachedToken struct {
	token string
	exp   time.Time
}

func (d *Driver) getOrRefreshToken(keyID, teamID string, key *ecdsa.PrivateKey) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// APNs tokens are valid for up to 60 minutes; refresh at 50. One driver
	// serves every APNs provider, so the cache is per key, never shared.
	cacheKey := teamID + "/" + keyID
	if c, ok := d.tokens[cacheKey]; ok && time.Now().Before(c.exp) {
		return c.token, nil
	}
	token, err := generateJWT(keyID, teamID, key)
	if err != nil {
		return "", err
	}
	if d.tokens == nil {
		d.tokens = map[string]cachedToken{}
	}
	d.tokens[cacheKey] = cachedToken{token: token, exp: time.Now().Add(50 * time.Minute)}
	return token, nil
}
```

Run: `(cd drivers/apns && go test ./...)` and expect PASS.

- [ ] **Step 5: SMTP, test first**

`driver/email/smtp_timeout_test.go`:

```go
package email_test

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/xraph/herald/driver"
	"github.com/xraph/herald/driver/email"
)

// A server that accepts the connection and never greets must not hang Send
// past the caller's deadline.
func TestSMTPPlainSendHonoursTheContext(t *testing.T) {
	lc := &net.ListenConfig{}
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		time.Sleep(5 * time.Second)
	}()
	host, port, _ := net.SplitHostPort(ln.Addr().String())

	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err = (&email.SMTPDriver{}).Send(ctx, &driver.OutboundMessage{
		To: "a@example.com", From: "b@example.com", Text: "hi",
		Data: map[string]string{"host": host, "port": port},
	})
	if err == nil {
		t.Fatal("a server that never answers produced no error")
	}
	if took := time.Since(start); took > 3*time.Second {
		t.Errorf("Send took %v; the context allowed 300ms", took)
	}
}
```

Run: `go test ./driver/email/ -run HonoursTheContext`. Expected: FAIL after about five seconds (`smtp.SendMail` waits until the fake server closes the connection).

In `driver/email/smtp.go`, replace the `else` branch's `smtp.SendMail` call with `sendPlain`, and restructure `sendWithTLS` so both paths share the conversation and both have a deadline (add `"time"` to the imports):

```go
	if useTLS {
		if err := sendWithTLS(ctx, addr, host, from, []string{msg.To}, body.String(), auth); err != nil {
			return nil, err
		}
	} else {
		if err := sendPlain(ctx, addr, host, from, []string{msg.To}, body.String(), auth); err != nil {
			return nil, err
		}
	}
```

```go
// sendTimeout bounds a whole SMTP conversation when the caller's context has
// no earlier deadline.
const sendTimeout = 30 * time.Second

// sendPlain does what smtp.SendMail does (STARTTLS when the server offers it,
// then auth and delivery), but dials with ctx and bounds the conversation
// with a deadline, so a server that stops answering can't hang a send.
func sendPlain(ctx context.Context, addr, host, from string, to []string, body string, auth smtp.Auth) error {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp: dial: %w", err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline(ctx)); err != nil {
		return fmt.Errorf("smtp: set deadline: %w", err)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp: new client: %w", err)
	}
	defer client.Close()
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("smtp: starttls: %w", err)
		}
	}
	return deliver(client, from, to, body, auth)
}

func sendWithTLS(ctx context.Context, addr, host, from string, to []string, body string, auth smtp.Auth) error {
	dialer := &tls.Dialer{Config: &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("smtp: tls dial: %w", err)
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline(ctx)); err != nil {
		return fmt.Errorf("smtp: set deadline: %w", err)
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp: new client: %w", err)
	}
	defer client.Close()
	return deliver(client, from, to, body, auth)
}

// deliver runs auth, MAIL, RCPT, DATA and QUIT on an open client.
func deliver(client *smtp.Client, from string, to []string, body string, auth smtp.Auth) error {
	if auth != nil {
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp: auth: %w", err)
		}
	}
	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp: mail from: %w", err)
	}
	for _, recipient := range to {
		if err := client.Rcpt(recipient); err != nil {
			return fmt.Errorf("smtp: rcpt to %s: %w", recipient, err)
		}
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp: data: %w", err)
	}
	if _, err := w.Write([]byte(body)); err != nil {
		return fmt.Errorf("smtp: write body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: close data: %w", err)
	}
	return client.Quit()
}

// deadline is the earlier of ctx's deadline and sendTimeout from now.
func deadline(ctx context.Context) time.Time {
	d := time.Now().Add(sendTimeout)
	if c, ok := ctx.Deadline(); ok && c.Before(d) {
		return c
	}
	return d
}
```

Run: `go test ./driver/email/`. Expected: PASS, including the existing `TestSMTPSend` against the mock server (it offers no STARTTLS, so the plain path is exercised end to end).

- [ ] **Step 6: Discord, test first**

Add to `drivers/discord/discord_test.go`:

```go
func TestDiscordKeepsTheWebhookQuery(t *testing.T) {
	srv := drivertest.NewServer(t, http.StatusOK, `{"id":"m1"}`)
	d := &discord.Driver{}
	_, err := d.Send(context.Background(), &driver.OutboundMessage{
		Text: "hi",
		Data: map[string]string{"webhook_url": srv.URL + "/api/webhooks/1/tok?thread_id=9"},
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	q, _ := url.ParseQuery(srv.Captured.Query)
	if q.Get("thread_id") != "9" || q.Get("wait") != "true" {
		t.Errorf("query = %q, want thread_id=9 and wait=true", srv.Captured.Query)
	}
}
```

(Add `"net/url"` to the imports.) Run `(cd drivers/discord && go test ./... -run KeepsTheWebhookQuery)` and expect FAIL: the server sees `thread_id=9?wait=true`.

In `drivers/discord/discord.go`, replace the request construction:

```go
	endpoint, err := withWait(webhookURL)
	if err != nil {
		// The URL embeds Discord's token, so the error must not repeat it.
		return nil, fmt.Errorf("discord: webhook_url is not a valid URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
```

and add (with `"net/url"` imported):

```go
// withWait adds wait=true, which makes Discord answer with the message it
// created, keeping any query the webhook URL already has.
func withWait(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("wait", "true")
	u.RawQuery = q.Encode()
	return u.String(), nil
}
```

Run: `(cd drivers/discord && go test ./...)` and expect PASS.

- [ ] **Step 7: Lint everything touched and commit**

```bash
go test ./driver/... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
for m in apns webhook discord; do (cd drivers/$m && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C); done
git add driver/payload.go driver/payload_test.go driver/email/smtp_timeout_test.go drivers/apns/token_cache_test.go
git commit --only -m "fix(drivers): key the APNs token by key, forward only data settings, bound SMTP, keep Discord's query" -- \
  driver/payload.go driver/payload_test.go driver/push/fcm.go driver/push/fcm_test.go \
  driver/email/smtp.go driver/email/smtp_timeout_test.go \
  drivers/apns/apns.go drivers/apns/token_cache_test.go \
  drivers/webhook/webhook.go drivers/webhook/webhook_test.go \
  drivers/discord/discord.go drivers/discord/discord_test.go
git show --stat HEAD
```

Expected: every module `ok`, `0 issues` everywhere.

---

### Task 16: Changelog, docs, and the whole-repo check

**Files:**
- Create: `CHANGELOG.md`
- Modify: `docs/content/docs/subsystems/providers.mdx`

- [ ] **Step 1: Correct the docs**

In `docs/content/docs/subsystems/providers.mdx`, under "## Driver Validation", replace the sentence that says `Validate` checks credentials "before the provider is used" with:

```markdown
Herald calls `Validate` when a provider is created or updated through the engine (`CreateProvider`, `UpdateProvider`, and the REST API, which uses them), with credentials and settings merged the way `Send` merges them. Providers seeded from configuration are validated too, but a failure there is logged and the provider is still created, so a typo in `config.yaml` never stops your app from booting.
```

- [ ] **Step 2: Write the changelog**

Invoke the `rex-voice` skill, then write `CHANGELOG.md` and run it through `humanizer` in embedded mode. No em dashes. It must cover, as a `## v1.7.0` section with the breaking changes first:

- Breaking: `message.Store` replaces `UpdateMessageStatus` with `RecordDelivery` and adds `CountMessages`; out-of-tree stores stop compiling.
- Breaking: `SendResult.ProviderID` is always Herald's provider; the vendor's ID moved to `ProviderMessageID`.
- Breaking: opted-out sends return `suppressed` with a message ID instead of `sent`.
- Breaking: REST provider responses carry `credentials: [{key, protection, key_id}]` and never values; `PUT` bodies are partial (pointers), credentials merge with `remove_credentials`, and a provider's channel and driver can no longer change; by-ID routes are scoped by `app_id` and answer 404 for other apps' rows; errors answer 400, 404 and 409 where they used to answer 500.
- Breaking: FCM and webhook payloads carry only settings prefixed `data.`.
- Every store returns the same not-found and duplicate sentinels; `ErrDuplicateSlug` and `ErrDuplicateLocale` are real now.
- `sent_at` and the vendor's message ID persist on every backend.
- Credential encryption at rest (`credentials_key`), per value, with `EncryptStoredCredentials` and `POST /v1/providers/encrypt`.
- `Variable.Default` is applied; the MFA SMS template no longer says "<no value>".
- `template.Resolve`, `Explain`, `RenderVersion` and `Preview` with positioned diagnostics.
- Driver field schemas.
- `extension.WithAPIMiddleware`, and why there is no `api_auth_providers` (forge's `WithGroupAuth` doesn't enforce).
- The driver fixes from Task 15.
- A "Still open" list copied from the spec's "Found and not fixed" section.

- [ ] **Step 3: Whole-repo verification**

```bash
go build ./... && go test -race ./...
C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C
for m in apns cloudflare discord mailgun messagebird postmark sendgrid ses slack vonage webhook; do
  (cd drivers/$m && go build ./... && go test ./... && C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C) || echo "FAILED: $m"
done
HERALD_TEST_POSTGRES_DSN='<the DSN you built in Task 5, Step 4>' HERALD_TEST_MONGO_URI='mongodb://localhost:57017' \
  go test ./store/... -run TestConformance -v 2>&1 | grep -E "^(--- |ok|FAIL)"
```

Expected: every root package `ok` with no race reports; `0 issues` in the root and every driver module; no `FAILED` line; four conformance passes (or the backends Task 5 recorded as unavailable, named). (Credential leaks are covered by the canary check every API test request runs through.)

Then check the two downstream modules still compile against these changes, without touching those repos. Neither replaces Herald today, so a temporary modfile with one `replace` is enough:

```bash
for repo in authsome authsome-dash-identity; do
  T=$(mktemp -d)
  cp ../$repo/go.mod "$T/go.mod"; cp ../$repo/go.sum "$T/go.sum"
  echo 'replace github.com/xraph/herald => /Users/rexraphael/Work/xraph/forgery/herald' >> "$T/go.mod"
  (cd ../$repo && go build -modfile="$T/go.mod" ./bridge/heraldadapter/ ./extension/) && echo "$repo: ok" || echo "$repo: BROKEN"
  rm -rf "$T"
done
```

Expected: `authsome: ok` and `authsome-dash-identity: ok`. Never edit either repo's own `go.mod`. If one is broken, report the compile error; don't fix it from here.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit --only -m "docs: changelog for v1.7.0 and correct when drivers validate" -- \
  CHANGELOG.md docs/content/docs/subsystems/providers.mdx
git show --stat HEAD
```

Tagging and pushing v1.7.0 is Rex's call. Don't tag or push.
