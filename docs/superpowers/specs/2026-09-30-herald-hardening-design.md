# Herald hardening

Spec 1 of 2. The dashboard migration (`2026-09-30-herald-dashboard-design.md`)
is spec 2, and it depends on everything here. This one lands first, in
`forgery/herald`, on `main`.

## Why this exists

We set out to move Herald's dashboard onto the React shell and found that the
dashboard could not be honest about what sits underneath it. A few examples,
all confirmed by reading the code and, for the renderer, by running it:

- Provider credentials are plaintext at rest in all four backends, and the REST
  API returns them in full from create, list, get and update.
- `Variable.Default` is never applied, so the shipped SMS template for MFA codes
  renders "Expires in <no value>." whenever the caller leaves `expires_in` out.
- The only statuses ever written are `sending`, `sent` and `failed`. `sent_at`
  is persisted by the memory store and nowhere else.
- An opted-out user comes back from `Send` as status `sent`, with no message row.
- There is no conformance suite. The memory, SQLite and Mongo stores have no
  tests at all.

You can't build a page that says "encrypted" per provider until a row can carry
that fact, and you can't put template errors in an editor gutter while the
renderer reports a flat string for the first field that failed. So the fixes
come first.

Scope was agreed as broad hardening: everything the dashboard's honesty needs,
plus credential encryption, the REST API's leaks and missing auth hook, and the
driver bugs we tripped over. Anything we found and are not fixing is listed at
the end, and goes into `herald/MIGRATION.md` under "Still open".

## A. Renderer (`template/`)

### Defaults

Before validation and rendering, copy the caller's data and fill every declared
variable that is missing from it with its `Default`. The caller's map is never
mutated. A required variable with a default then passes validation and renders
its default, which is what the declaration always claimed.

### One resolution function

Export the version lookup so the dashboard and `Send` can't disagree about which
version answers a locale:

```go
type Match string

const (
	MatchExact    Match = "exact"    // an active version for the locale itself
	MatchLanguage Match = "language" // "fr" answering "fr-CA"
	MatchDefault  Match = "default"  // the active version with locale ""
	MatchNone     Match = "none"
)

func Resolve(tmpl *Template, locale string) (*Version, Match)
```

The rule is today's `findVersion`, unchanged: exact, then language only, then
the `""` locale, active versions only. It does not fall back to the configured
default locale, and that stays true. Every shipped template has only an `en`
version, so a request in `fr` fails today, and the dashboard's job is to show
you that rather than paper over it.

`Render` becomes `Resolve` plus a new `RenderVersion(v *Version, vars []Variable,
data map[string]any)`, and keeps its fail-on-first-error behaviour for `Send`.

### Preview with diagnostics

```go
type Content struct {
	Subject, HTML, Text, Title string
}

type Diagnostic struct {
	Field    string `json:"field"`    // "subject" | "html" | "text" | "title" | "" for template-wide
	Line     int    `json:"line"`     // 1-based; 0 when unknown
	Column   int    `json:"column"`   // 1-based, in characters; 0 when unknown
	Severity string `json:"severity"` // "error" | "warning"
	Kind     string `json:"kind"`     // "parse" | "exec" | "escape" | "missing" | "undeclared" | "unprovided"
	Message  string `json:"message"`
}

type FieldOutput struct {
	Field    string `json:"field"`
	Output   string `json:"output"`
	Rendered bool   `json:"rendered"` // false when this field failed or was empty
}

type PreviewResult struct {
	Fields      []FieldOutput `json:"fields"`
	Diagnostics []Diagnostic  `json:"diagnostics"`
}

func (r *Renderer) Preview(c Content, vars []Variable, data map[string]any) *PreviewResult
```

`Preview` renders every non-empty field independently, so a broken HTML body
does not hide a broken subject. It never returns an error; everything wrong is a
diagnostic.

Each field's template is named after the field, which makes Go's messages
parseable and tells us where they came from. We measured the three formats by
running the renderer:

| source | shape | position |
|---|---|---|
| parse | `template: html:3: unexpected EOF` | line only |
| exec | `template: html:2:5: executing "html" at <index .name 5>: ...` | line, 0-based byte column |
| html escaper | `html/template:html:2:5: {{if}} branches end in different contexts: ...` | line, 0-based byte column |

The parser strips the prefix, keeps the message, and converts the byte column
into a 1-based character column using the field's own source line, so a
non-ASCII line still puts the marker in the right place. A parse error has no
column, and the editor marks the whole line for it.

Warnings come from walking the parse tree. A top-level `.name` (or `$.name`)
that isn't declared in `vars` is `undeclared`. A declared variable with no value
in the sample data and no default is `unprovided` when optional, and a `missing`
error when required, because `Render` would refuse it. References inside
`range` and `with` are skipped, since the dot has moved.

`Renderer.FuncNames() []string` lists the helper functions (`upper`, `lower`,
`title`, `truncate`, `default`, `now`, `formatDate`), sorted, so an editor can
offer the functions Herald actually has rather than a hardcoded copy.

We also record, in a test, that a missing optional variable renders `<no value>`
in text fields and nothing in HTML fields. That's Go's behaviour, not ours, and
the preview shows it rather than hiding it.

## B. Engine (`herald.go`)

### Sending through a chosen provider

`SendRequest` gains `ProviderID string json:"provider_id,omitempty"`. When it's
set, `Send` skips the scope resolver and uses that provider, after checking it
belongs to `req.AppID` and handles `req.Channel` (`ErrProviderNotFound` and
`ErrInvalidChannel` otherwise). A disabled provider is allowed, because naming
it is the explicit act; that's what lets you test a provider before you enable
it. From fields come from the app-level scoped config if one exists, then the
provider's `from` and `from_name` settings, which is what a resolver-picked send
through the same provider would use.

`scope.ResolveResult` gains `Via string`: `"user"`, `"org"`, `"app"` or
`"fallback"` (first enabled provider by priority), and `Send` sets `"chosen"`
when `ProviderID` was given. A caller can then say why a provider was picked,
and a confirmation dialog needs that before a real send. The
resolver also gets `(*Herald).ResolveProvider(ctx, appID, orgID, userID,
channel string)` as a public engine method, so nothing needs to reach into the
scope package to ask.

### An honest result

```go
type SendResult struct {
	MessageID         id.MessageID   `json:"message_id"`
	Status            message.Status `json:"status"`
	ProviderID        string         `json:"provider_id,omitempty"`         // always Herald's provider ID
	ProviderMessageID string         `json:"provider_message_id,omitempty"` // the vendor's ID, when it gave one
	Error             string         `json:"error,omitempty"`
	Logged            bool           `json:"logged"`
}
```

`ProviderID` stops being overwritten with the vendor's message ID. That is a
behaviour change for any caller that read `provider_id` expecting the vendor
ID, and the changelog says so.

### Recording what happened

`message.Message` gains `ProviderMessageID string json:"provider_message_id,omitempty"`.
`UpdateMessageStatus` is replaced by:

```go
type Delivery struct {
	Status            Status
	Error             string
	ProviderMessageID string
	SentAt            *time.Time
}

RecordDelivery(ctx context.Context, messageID id.MessageID, d Delivery) error
```

Every backend writes all four fields, so `sent_at` and the vendor ID persist
everywhere, not just in memory.

A new status, `StatusSuppressed = "suppressed"`, replaces the opted-out lie. An
opted-out send now writes a message row with that status and the error "user
opted out", returns its message ID, and is audited. The opt-out check still only
runs when both `UserID` and `Template` are set.

If `CreateMessage` fails, the send still goes ahead (a broken log must not stop
an OTP), `RecordDelivery` is skipped, and the result carries `Logged: false`.

Body truncation becomes rune-safe, so `TruncateBodyAt` no longer splits a UTF-8
character.

### Provider methods that own the rules

Today the API and the templ dashboard both write providers straight into the
store, which is how validation got skipped and credentials leaked. The engine
gets methods that everything else calls:

```go
func (h *Herald) CreateProvider(ctx context.Context, p *provider.Provider) error
func (h *Herald) UpdateProvider(ctx context.Context, appID string, id id.ProviderID, u ProviderUpdate) (*provider.Provider, error)
func (h *Herald) DeleteProvider(ctx context.Context, appID string, id id.ProviderID) error
func (h *Herald) ValidateProvider(p *provider.Provider) error
func (h *Herald) CredentialStatus(p *provider.Provider) []CredentialState
func (h *Herald) EncryptStoredCredentials(ctx context.Context, appID string) (EncryptReport, error)
```

Update and delete take the app ID and return `ErrProviderNotFound` for a provider in another app, so the ownership rule lives in the engine and every caller gets it.
`ProviderUpdate` uses pointers for every scalar and carries
`SetCredentials map[string]string` and `RemoveCredentials []string`, so you can
replace one secret without resending the others and without ever reading them
back. Settings get the same pair.

`ValidateProvider` checks that the driver is registered, that its channel
matches the provider's, that no field the driver marks secret has been put in
settings, and then calls the driver's `Validate` with credentials and settings
merged the same way `Send` merges them. Today `Validate` only sees credentials,
so a host placed in settings fails validation and works at send time. Create and
update both validate.

## C. Driver field schema (`driver/`)

```go
type Placement string

const (
	PlacementCredential Placement = "credential"
	PlacementSetting    Placement = "setting"
)

type Field struct {
	Key       string    `json:"key"`
	Label     string    `json:"label"`
	Help      string    `json:"help,omitempty"`
	Required  bool      `json:"required"`
	Secret    bool      `json:"secret"`
	Placement Placement `json:"placement"`
}

// Describer is optional. A driver without it gets free-form key/value editing.
type Describer interface {
	Fields() []Field
}

func (r *Registry) Describe(name string) ([]Field, bool)
```

All sixteen built-in drivers implement it. Secret fields are the obvious ones
(passwords, API keys, tokens, private keys, signing secrets, webhook URLs that
embed a token). Non-secret connection details (host, port, region, account IDs,
from numbers) are settings. Email drivers also declare `from` and `from_name`,
which Herald reads itself. Where a driver needs one of two fields (Slack's
`webhook_url` or `bot_token` plus `channel`, FCM's `server_key` or
`access_token`), neither is marked required and the help text says which pairs
work; `Validate` still enforces it.

## D. Credential encryption

A new package, `credential`, owns the format:

```
enc:v1:<keyID>:<base64url(nonce || AES-256-GCM ciphertext)>
```

The additional authenticated data is the provider ID and the credential key,
joined with a zero byte, so a ciphertext copied into another provider or under
another key name fails to decrypt.

Keys are optional. `herald.WithCredentialKey(keyID string, key []byte)` sets the
key that encrypts; `herald.WithPreviousCredentialKey(keyID string, key []byte)`
may be given any number of times, and those keys only decrypt, which is enough
to rotate. The extension reads `credentials_key` and `credentials_key_id`
(default `k1`) and `previous_credentials_keys` from config, and all of them
accept `${ENV}` interpolation like the provider seeds do. The key is 32 bytes,
base64 encoded; anything else fails startup with a message naming the setting.

With a key, `CreateProvider` and `UpdateProvider` encrypt every credential value
they write. Without one, they store plaintext, which is today's behaviour, and
nothing pretends otherwise. Decryption happens in exactly one place, inside
`Send`, just before the driver sees the map. A value encrypted under a key ID
that isn't configured fails the send with `ErrCredentialKeyUnavailable`, and the
message row records "credential key k0 is not configured", which is the fact an
operator needs.

Protection is a property of each value, never of the config:

```go
type CredentialState struct {
	Key        string `json:"key"`
	Protection string `json:"protection"`        // "aes-256-gcm" | "plaintext"
	KeyID      string `json:"key_id,omitempty"`
}
```

An absent marker means plaintext, not unknown. Nothing re-encrypts on read. Rows
written before a key existed stay plaintext until you run
`EncryptStoredCredentials` for an app, which rewrites plaintext values only and
reports `{Providers, ValuesEncrypted, AlreadyEncrypted}`. It's per app because
the store can only list providers by app.

A plaintext value that happens to begin with `enc:v1:` will be treated as
ciphertext and fail to decrypt. We accept that and document it; no real
credential starts that way.

## E. Stores

### New and changed methods

- `CountMessages(ctx, appID string, since time.Time) ([]message.Count, error)`,
  where `Count` is `{Status, Channel string; N int}`. SQL uses `GROUP BY`, Mongo
  an aggregate, memory a scan. This replaces the dashboard's habit of counting a
  1,000-row list, which is why the templ widget could only ever show 0 or 1.
- `RecordDelivery`, above. A new migration adds `provider_message_id` (Postgres
  and SQLite `TEXT NOT NULL DEFAULT ''`, a plain field in Mongo).
- `ListTemplates` and `ListTemplatesByChannel` populate `Versions` on every
  backend, with one batched query per call rather than one per template. Today
  only memory does.

### Parity

- Uniqueness returns the sentinels that exist and are currently dead:
  `ErrDuplicateSlug` for (app, slug, channel) and `ErrDuplicateLocale` for
  (template, locale). SQL and Mongo translate their constraint violations;
  memory enforces both itself, which it doesn't today.
- Not-found is a sentinel everywhere. `GetPreference` returns
  `ErrPreferenceNotFound` and `GetScopedConfig` returns `ErrScopedConfigNotFound`
  on all four backends (memory errors today, the others return `nil, nil`), and
  updates and deletes of a missing row say so. Callers are updated, which also
  removes the API's nil dereference.
- Memory lists sort the way SQL does, so offset paging is deterministic, and
  memory reads return copies, which removes the data race where a read under
  `RLock` wrote `Versions` onto shared state.
- The SQL scoped-config upsert updates `webhook_provider_id` and
  `chat_provider_id`, as Mongo and memory already do.

### Empty app ID

Every backend treats an empty app ID as an exact match on `app_id = ''`, not as
a wildcard. We checked all four. The suite pins it per backend as a recorded
fact, so if a future backend treats empty as "everything" the tests say so.

### Conformance suite

A new `store/storetest` package exports `Run(t *testing.T, open func(t *testing.T) store.Store)`.
Memory and SQLite always run it. Postgres runs when `HERALD_TEST_POSTGRES_DSN`
is set and Mongo when `HERALD_TEST_MONGO_URI` is set; otherwise they skip with a
message saying which variable to set.

It populates every map and JSON field (credentials, settings, variables,
versions, metadata on messages and inbox rows, preference overrides) and checks
the full round trip, because a suite that only builds empty structs is testing
the absence of those fields. It also covers uniqueness, ordering, offset paging,
empty-app isolation asserted on row identity, `CountMessages`, `RecordDelivery`,
the scoped-config upsert for all five channels, the preference upsert, and the
not-found sentinels.

## F. REST API (`api/`)

- Herald can't know the host's auth scheme, so it doesn't pick one.
  `extension.WithAPIMiddleware(mw ...forge.Middleware)` wraps the route group
  with `forge.WithGroupMiddleware`, and that's the only way offered. We looked at
  forge's `WithGroupAuth(providerNames...)` too, and it doesn't enforce anything:
  at v1.10.0 and v1.11.2 it only writes `auth.providers` into route metadata,
  which the OpenAPI generator and the client introspector read and no middleware
  checks. A config setting built on it would make the API document auth while
  serving every request unauthenticated, so there isn't one. When routes are
  mounted with no middleware, startup logs a warning saying the Herald API is
  unauthenticated and naming the option, and a test proves the middleware runs
  on every route.
- Provider responses never carry credential values. They carry
  `credentials: [{key, protection, key_id}]`. Create and update accept
  `credentials` (keys to set) and `remove_credentials`, and go through the engine
  methods, so they're validated and, with a key, encrypted.
- Every by-ID route checks ownership against `app_id` from the query string.
  An absent `app_id` means the `""` app, consistent with how every list already
  behaves, and a row from another app is a 404.
- Update bodies use pointers. Today a PUT that leaves out `"enabled": true`
  disables the provider or template, and priority can never go back to 0.
- Version routes check the version belongs to `:id`.
- Errors map properly: not-found sentinels to 404, duplicate sentinels to 409,
  validation and bad input to 400, and only the rest to 500.
- Scoped-config writes return the stored row, re-read after the upsert, instead
  of a freshly minted ID that doesn't exist. The request bodies gain the webhook
  and chat provider IDs.
- A new `POST /v1/providers/encrypt?app_id=` runs `EncryptStoredCredentials`.

## G. Drivers

- APNs keys its cached JWT by key ID and team ID. Today a second APNs provider
  reuses the first provider's token for up to fifty minutes.
- FCM and webhook stop forwarding the merged credential map into the payload
  they send. They forward only settings whose key starts with `data.`, with the
  prefix removed. This is a behaviour change. Today an
  FCM provider sends its other credential keys to every device.
- SMTP's plain path dials with the send context and sets a 30 second deadline.
  Today it has neither and can hang a send indefinitely.
- Discord adds `wait=true` with `net/url`, so a webhook URL that already has a
  query string keeps working.

## Tests

Pure functions get table tests: the error parser against each measured format
and a non-ASCII line, `Resolve` against every match kind, defaults, the tree
walk, the credential format including a tampered AAD and an unknown key ID.
The engine gets tests against the memory store and the SQLite store for
suppressed sends, `Logged: false`, chosen-provider sends, validation and
encryption round trips through `Send` with a recording driver. The API gets
`httptest` coverage for redaction (a canary credential must never appear in any
response body), ownership, pointer updates and error codes.

Lint runs with a fresh cache every time:
`C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.

## Breaking changes

Herald's latest tag is v1.6.2 (the `ExtensionVersion` constant saying 0.1.0 is stale, and gets corrected). These ship as v1.7.0. The repo has no changelog file, so we add `CHANGELOG.md` with an entry for each. We checked the two downstream modules, `authsome` and `authsome-dash-identity`: they call `Send`, `Notify`, the renderer and the template store methods, none of which change signature, and they ignore `SendResult`, so neither stops compiling. Eleven drivers under `drivers/` are their own modules with a `replace` pointing at `../../`, so they build against these changes and their tests run from inside each module.

- `message.Store`: `UpdateMessageStatus` is replaced by `RecordDelivery`, and
  `CountMessages` is added. Any out-of-tree store implementation stops compiling,
  and the compile error tells you what to add.
- `SendResult.ProviderID` means Herald's provider, always.
- Opted-out sends return `suppressed` with a message ID.
- The REST API no longer returns credential values, updates are partial, and
  by-ID routes are scoped by `app_id`.
- FCM and webhook payloads only carry `data.` settings.

## Found and not fixed

These go into `herald/MIGRATION.md` under "Still open":

- Mongo stores template variables and preference overrides as BSON binary
  (`json.RawMessage`), where Postgres uses JSONB. Changing it needs a data
  migration for existing documents.
- `Send` returns only the first recipient's result on a multi-recipient send,
  and audits only that one.
- No driver learns about delivery or bounces afterwards. There are no receipt
  webhooks, no Twilio status callback, no Vonage DLR. `delivered` and `bounced`
  exist as statuses and are never written.
- Only the text body is logged; HTML is not.
- `Message.TemplateID` holds the template slug, not its ID. Changing it would
  break every existing row, so the dashboard resolves the slug instead.
- `Async` is stored and ignored; delivery is always synchronous. A crash
  mid-send leaves a row at `sending`.
- A scoped config's `default_locale` is stored and never used by `Send`.
- SES has no session-token support, and FCM's `access_token` is a static token
  that is never refreshed.
