# First-run Platform Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing first-user setup route into a guided Forge onboarding flow that configures the bootstrapped platform app, its default environment, and the first platform owner.

**Architecture:** Authsome extends its existing anonymous setup intents with safe app and environment defaults plus optional nested completion input. The dashboard keeps provider ownership at the intent boundary, preserves the legacy administrator-only form for other providers, and renders a three-step wizard when both default objects are available. Authsome updates the existing records, creates the user last, and serializes setup requests within one Forge process.

**Tech Stack:** Go, Authsome engine and memory store, Forge dashboard contracts, TypeScript 6, React 19, react-router 8, Vitest, Testing Library, Tailwind v4, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-22-first-run-platform-setup-design.md`

## Global Constraints

- Keep Authsome's bootstrapped platform app and environments. Setup edits them and never creates duplicates.
- Configure one initial default environment. Do not add environment creation or deletion to onboarding.
- Keep `auth.setupStatus` and `auth.setup` version 1 wire compatible with `{ pending }` and the old email/password payload.
- Never return stored metadata, publishable keys, settings, roles, or credentials from the anonymous setup status query.
- Merge submitted metadata into stored metadata. Omitted metadata preserves existing values.
- Keep the Authsome plugin UI-free. The dashboard host owns the provider-neutral setup screen.
- Keep passwords in component memory. Do not write setup drafts to storage or query parameters.
- Preserve and validate the local `next` path from login through setup completion.
- Use the existing Forge auth layout, mark, theme switcher, and design tokens.
- Do not change TwinOS Office gateway rules in this delivery.
- Do not add dependencies. Use the kit components and Testing Library already installed.
- No em dashes in code comments, docs, commit messages, or published prose.
- Never stage concurrent edits. Before each commit, inspect status and add only the exact files owned by that task.
- The Authsome worktree already has unrelated `ui/packages/*` changes. Leave them untouched.
- The forge-dashboard worktree has broad concurrent changes. Re-read every target before editing and preserve current content.

## Review Focus

- A direct visit to `/setup` after another tab creates the first user must leave setup and offer sign-in or continue safely.
- Two setup commands reaching the same process together must create one user; the loser receives `permission_denied`.
- Whitespace-only, duplicate, oversized, or excessive metadata entries must fail before any app, environment, or user write.
- `/login?next=%2F` must become `/setup?next=%2F`; protocol-relative, backslash, scheme, and control-character destinations must still fall back to `/`.
- A provider returning only one of `platform` or `environment` must get the legacy administrator form, never a partial wizard.

---

### Task 1: Return safe Authsome setup defaults

**Repository:** `/Users/rexraphael/Work/xraph/forgery/authsome`

**Files:**
- Modify: `extension/contract/handlers_auth_pages.go`
- Create: `extension/contract/handlers_auth_pages_test.go`

**Interfaces:**
- Consumes: `Engine.PlatformAppID()`, `Engine.GetApp`, `Engine.GetDefaultEnvironment`, and `Engine.AdminListUsers`.
- Produces: `SetupStatusResponse{Pending, Platform, Environment}`, where metadata and credentials are structurally impossible to serialize.

- [ ] **Step 1: Add an integration-test engine helper and failing safe-default tests**

Create `extension/contract/handlers_auth_pages_test.go` with the package-local test harness:

```go
package contract

import (
    "context"
    "testing"

    "github.com/stretchr/testify/require"
    authsome "github.com/xraph/authsome"
    "github.com/xraph/authsome/internal/secutil"

    dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
    "golang.org/x/crypto/bcrypt"
)

func newSetupEngine(t *testing.T) *authsome.Engine {
    t.Helper()
    cfg := authsome.DefaultConfig()
    cfg.Password.BcryptCost = bcrypt.MinCost
    return secutil.NewTestEngine(t,
        authsome.WithConfig(cfg),
        authsome.WithBootstrap(),
    )
}

func TestSetupStatusReturnsSafeBootstrapDefaults(t *testing.T) {
    eng := newSetupEngine(t)
    got, err := setupStatusHandler(Deps{Engine: eng})(
        context.Background(), struct{}{}, dashcontract.Principal{},
    )
    require.NoError(t, err)
    require.True(t, got.Pending)
    require.NotNil(t, got.Platform)
    require.Equal(t, "Platform", got.Platform.Name)
    require.Equal(t, "platform", got.Platform.Slug)
    require.NotNil(t, got.Environment)
    require.True(t, got.Environment.IsDefault)
    require.Equal(t, "development", got.Environment.Type)
}
```

Add a reflection assertion that the two response default structs have no `Metadata`, `PublishableKey`, `Settings`, or credential fields. Add a nil-engine test expecting `CodeUnavailable`.

Stop a started test engine before calling the status handler and assert the existing user-count failure path returns `{ Pending: false }` without app or environment defaults. This pins the fail-closed behavior without adding a production test hook.

- [ ] **Step 2: Run the focused test and confirm the contract is missing**

Run:

```bash
cd /Users/rexraphael/Work/xraph/forgery/authsome
go test ./extension/contract -run 'TestSetupStatus' -count=1
```

Expected: FAIL because `SetupStatusResponse` has no platform or environment defaults.

- [ ] **Step 3: Add response types and load the existing bootstrap records**

Add these wire shapes beside `SetupStatusResponse`:

```go
type SetupPlatformDefaults struct {
    Name string `json:"name"`
    Slug string `json:"slug"`
    Logo string `json:"logo,omitempty"`
}

type SetupEnvironmentDefaults struct {
    Name        string `json:"name"`
    Slug        string `json:"slug"`
    Type        string `json:"type"`
    IsDefault   bool   `json:"isDefault"`
    Color       string `json:"color,omitempty"`
    Description string `json:"description,omitempty"`
}

type SetupStatusResponse struct {
    Pending     bool                      `json:"pending"`
    Platform    *SetupPlatformDefaults    `json:"platform,omitempty"`
    Environment *SetupEnvironmentDefaults `json:"environment,omitempty"`
}
```

Keep the current user-count fail-closed branch. When `list.Total == 0`, load `eng.GetApp(ctx, defaultAppID(eng))` and `eng.GetDefaultEnvironment(ctx, defaultAppID(eng))`. Map load failures with `mapEngineError`. Project only the declared fields.

- [ ] **Step 4: Add the existing-user test**

Sign up one user through `eng.SignUp`, call the status handler, and assert exactly `SetupStatusResponse{Pending: false}` with nil defaults.

- [ ] **Step 5: Run the contract tests**

Run:

```bash
go test ./extension/contract -run 'TestSetupStatus' -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit the safe status response**

```bash
git status --short
git add extension/contract/handlers_auth_pages.go extension/contract/handlers_auth_pages_test.go
git diff --cached --check
git commit -m "feat(contract): return first-run setup defaults"
```

---

### Task 2: Apply setup configuration and serialize first-user creation

**Repository:** `/Users/rexraphael/Work/xraph/forgery/authsome`

**Files:**
- Modify: `extension/contract/handlers_auth_pages.go`
- Modify: `extension/contract/handlers_auth_pages_test.go`
- Modify: `extension/contract/manifest.yaml`

**Interfaces:**
- Consumes: Task 1 default structs and the existing `SetupInput` administrator fields.
- Produces: optional `platform` and `environment` input objects, metadata validation and merge helpers, and a setup command closure with one process-local critical section.

- [ ] **Step 1: Write failing extended-payload and retry tests**

Add a test that calls the handler with:

```go
in := SetupInput{
    Email: "owner@example.com",
    Password: "SecureP@ss1",
    Name: "Ada Lovelace",
    Platform: &SetupPlatformInput{
        Name: "TwinOS Office",
        Slug: "twinos-office",
        Logo: "https://example.test/forge.svg",
        Metadata: map[string]string{"region": "us-central"},
    },
    Environment: &SetupEnvironmentInput{
        Name: "Local Development",
        Slug: "local-development",
        Type: "development",
        Color: "#2563eb",
        Description: "Local plugin development",
        Metadata: map[string]string{"purpose": "plugins"},
    },
}
```

Use `withHTTPCtx`, call one `setupHandler(Deps{Engine: eng})` closure, then assert:

- response is OK and has a subject
- the app name, slug, logo, and existing plus submitted metadata are present
- the default environment fields and merged metadata are present
- the response recorder has the dashboard session cookie
- `eng.ListUserRoles` includes `rbac.PlatformOwnerSlug`
- calling the same handler again returns `CodePermissionDenied`

Add a legacy test using only email and password, which must preserve bootstrap app and environment values.

Add a partial-update retry test by creating a second environment whose slug matches the submitted default-environment slug. The app update should land, the environment update should fail on uniqueness, and no user should exist. Delete the conflicting environment and submit the same payload again. The retry must complete with one app, the same default environment ID, and one user.

- [ ] **Step 2: Run the focused tests and confirm the input types are missing**

Run:

```bash
go test ./extension/contract -run 'TestSetupHandler' -count=1
```

Expected: FAIL because the nested inputs do not exist and setup does not update either record.

- [ ] **Step 3: Add nested input types and bounded validation**

Add optional pointers to `SetupInput`:

```go
type SetupPlatformInput struct {
    Name     string            `json:"name"`
    Slug     string            `json:"slug"`
    Logo     string            `json:"logo,omitempty"`
    Metadata map[string]string `json:"metadata,omitempty"`
}

type SetupEnvironmentInput struct {
    Name        string            `json:"name"`
    Slug        string            `json:"slug"`
    Type        string            `json:"type"`
    Color       string            `json:"color,omitempty"`
    Description string            `json:"description,omitempty"`
    Metadata    map[string]string `json:"metadata,omitempty"`
}
```

Implement pure validators used before the lock or any write:

```go
const (
    setupNameMax        = 80
    setupSlugMax        = 63
    setupDescriptionMax = 240
    setupMetadataMax    = 20
    setupMetadataKeyMax = 64
    setupMetadataValMax = 512
)

var setupSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
```

Require nonempty names and slugs when the containing object is present. Accept only `development`, `staging`, and `production`. Metadata keys and values must be nonempty after trimming and stay within the declared limits. A logo may be empty, an absolute `http` or `https` URL, or a root-relative path. Return `CodeBadRequest` before any mutation.

- [ ] **Step 4: Implement idempotent updates and the setup critical section**

Create one mutex when `setupHandler` is registered:

```go
func setupHandler(deps Deps) func(context.Context, SetupInput, contract.Principal) (SetupResponse, error) {
    var setupMu sync.Mutex
    return func(ctx context.Context, in SetupInput, _ contract.Principal) (SetupResponse, error) {
        normalized, err := validateSetupInput(in)
        if err != nil {
            return SetupResponse{}, err
        }

        setupMu.Lock()
        defer setupMu.Unlock()

        // Recount users, load existing app and default environment, apply
        // optional updates, then call the existing SignUp path last.
    }
}
```

Clone metadata maps before merging so a failed request cannot mutate a store-owned map by alias. Set `Environment.Type` from the validated enum and preserve `IsDefault`, IDs, publishable key, settings, timestamps, and all omitted fields.

- [ ] **Step 5: Add validation and concurrency tests**

Use table tests for blank names, malformed slugs, unsupported environment types, metadata entry count, blank key/value, oversized key/value, and invalid logo schemes. Snapshot app and environment values before each call and assert validation failures leave them unchanged and create no user.

For concurrency, reuse one handler closure, release two goroutines from the same channel, and collect both results. Assert one success, one `CodePermissionDenied`, and one stored user.

- [ ] **Step 6: Add setup invalidation metadata**

Change the manifest entry to:

```yaml
- { name: auth.setup, kind: command, version: 1, capability: write, invalidates: [auth.config, auth.setupStatus, apps.context, apps.list, environments.list] }
```

- [ ] **Step 7: Run backend gates**

Run:

```bash
go test ./extension/contract -run 'TestSetup' -count=1
go test ./extension/contract -count=1
go test -race ./extension/contract -run 'TestSetupHandlerConcurrent' -count=1
go test ./... -count=1
```

Expected: all pass. If the whole repository has a baseline failure, record the exact package and rerun the focused setup suite after confirming the failure is unrelated.

- [ ] **Step 8: Commit backend completion**

```bash
git status --short
git add extension/contract/handlers_auth_pages.go extension/contract/handlers_auth_pages_test.go extension/contract/manifest.yaml
git diff --cached --check
git commit -m "feat(contract): configure the platform during setup"
```

---

### Task 3: Add shared setup types and preserve the login destination

**Repository:** `/Users/rexraphael/Work/xraph/forge-dashboard`

**Files:**
- Modify: `packages/plugin/src/auth.ts`
- Modify: `packages/host/src/auth/screens/sign-in.tsx`
- Modify: `packages/host/test/auth-setup-precedence.test.tsx`
- Create: `packages/plugin/test/auth-setup-types.test.ts`

**Interfaces:**
- Consumes: the Authsome wire structures from Tasks 1 and 2.
- Produces: `SetupStatus`, `SetupPlatformDefaults`, `SetupEnvironmentDefaults`, `CompleteSetupInput`, and a setup-aware login boundary that preserves `next`.

- [ ] **Step 1: Write the failing plugin contract test**

Create a compile-time and runtime shape test:

```ts
import { describe, expect, it } from "vitest"
import type { CompleteSetupInput, SetupStatus } from "../src/auth"

describe("setup auth contract", () => {
  it("keeps minimal providers and old completion payloads valid", () => {
    const status: SetupStatus = { pending: true }
    const input: CompleteSetupInput = { email: "owner@example.com", password: "secret" }
    expect(status.pending).toBe(true)
    expect(input.email).toBe("owner@example.com")
  })
})
```

- [ ] **Step 2: Add the shared types to `packages/plugin/src/auth.ts`**

Use the exact TypeScript interfaces from the approved spec. Include `isDefault?: boolean` on `SetupEnvironmentDefaults` so the Go status field is accepted without making it a completion requirement. Keep all nested objects optional.

- [ ] **Step 3: Write a failing redirect preservation test**

Extend `auth-setup-precedence.test.tsx` so the setup route renders its current search string. Start at `/login?next=%2Fprojects%3Ftab%3Drecent`, return `{ pending: true }`, and expect the setup location to retain `?next=%2Fprojects%3Ftab%3Drecent`.

Add a status-error case with a mocked `refetch` function. The screen must show `Setup status unavailable`, a Retry button, and no password form.

Run the existing `next-param.test.ts` in this task. It already pins protocol-relative URLs, backslashes, explicit schemes, relative paths, and control characters to the `/` fallback.

- [ ] **Step 4: Refactor sign-in into a setup status boundary**

Keep hooks unconditional by splitting components:

```tsx
export function SignInScreen(props: AuthScreenProps) {
  return hasSetupFlow(props.intents)
    ? <SetupAwareSignInScreen {...props} />
    : <SignInForm {...props} />
}

function SetupAwareSignInScreen(props: AuthScreenProps) {
  const status = useQuery<SetupStatus>(props.intents.setupStatus!)
  if (status.loading && !status.data) return <SetupStatusLoading />
  if (status.error) return <SetupStatusError error={status.error} onRetry={status.refetch} />
  if (status.data?.pending) {
    return <Navigate replace to={`/setup?next=${encodeURIComponent(props.next)}`} />
  }
  return <SignInForm {...props} />
}
```

Render loading and errors in the shared `AuthLayout`. Do not render credential fields until setup status is known.

- [ ] **Step 5: Run package checks**

```bash
pnpm --filter @forge-go/dashboard-plugin test -- auth-setup-types.test.ts
pnpm --filter @forge-go/dashboard-plugin typecheck
pnpm --filter @forge-go/dashboard-host test -- auth-setup-precedence.test.tsx
pnpm --filter @forge-go/dashboard-host typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit the shared contract and redirect fix**

```bash
git status --short
git add packages/plugin/src/auth.ts packages/plugin/test/auth-setup-types.test.ts packages/host/src/auth/screens/sign-in.tsx packages/host/test/auth-setup-precedence.test.tsx
git diff --cached --check
git commit -m "feat(auth): carry setup context into onboarding"
```

---

### Task 4: Build tested setup form primitives

**Repository:** `/Users/rexraphael/Work/xraph/forge-dashboard`

**Files:**
- Create: `packages/host/src/auth/screens/setup-model.ts`
- Create: `packages/host/src/auth/screens/setup-metadata.tsx`
- Create: `packages/host/test/setup-model.test.ts`
- Create: `packages/host/test/setup-metadata.test.tsx`
- Modify: `packages/kit/src/components/auth-layout.tsx`
- Modify: `packages/kit/test/auth-layout.test.tsx`

**Interfaces:**
- Consumes: Task 3 setup types.
- Produces: `SetupDraft`, `MetadataRow`, `createSetupDraft`, `slugifySetupName`, `validateSetupStep`, `buildCompleteSetupInput`, `MetadataEditor`, and `AuthLayout` size `"default" | "wide"`.

- [ ] **Step 1: Write failing pure-model tests**

Pin these behaviors in `setup-model.test.ts`:

```ts
expect(slugifySetupName("  TwinOS Office  ")).toBe("twinos-office")
expect(slugifySetupName("R&D / Local")).toBe("r-d-local")
```

Create a draft from safe status defaults and assert no password is synthesized. Assert platform name changes regenerate an untouched slug, while a manually edited slug remains unchanged. Assert `buildCompleteSetupInput` trims values, omits empty metadata, and returns the nested wire payload.

Test each validation branch: required names and slugs, slug syntax, environment type, administrator email, password mismatch, blank metadata cells, duplicate keys after trimming, 20-entry limit, 64-character keys, and 512-character values.

- [ ] **Step 2: Implement the pure setup model**

Use serializable draft data only:

```ts
export interface MetadataRow { id: string; key: string; value: string }
export interface SetupDraft {
  platform: SetupPlatformDefaults & { metadata: MetadataRow[]; slugTouched: boolean }
  environment: SetupEnvironmentDefaults & { metadata: MetadataRow[]; slugTouched: boolean }
  administrator: { name: string; email: string; password: string; confirmPassword: string }
}
```

Return field errors as `Record<string, string>`, using stable paths such as `platform.name`, `environment.metadata.0.key`, and `administrator.password`.

- [ ] **Step 3: Write failing metadata editor tests**

Render two rows and assert Add metadata appends one blank row, Remove deletes only its row, labels remain associated with inputs, and duplicate keys expose the supplied error text. Use `fireEvent`; do not add `@testing-library/user-event`.

- [ ] **Step 4: Implement `MetadataEditor` with kit controls**

Use `Input`, `Label`, and `Button`. Keep row IDs separate from keys so editing a key does not remount its inputs. The Add button is an outline button, each Remove button has an accessible label containing the row number, and the editor stops adding rows at 20.

- [ ] **Step 5: Add a wide auth content size**

Add this prop without changing existing screens:

```ts
size?: "default" | "wide"
```

Map default to `max-w-[25rem]` and wide to `max-w-[42rem]`. Extend the existing layout test to assert the default class remains and the wide class is opt-in.

- [ ] **Step 6: Run focused tests and package gates**

```bash
pnpm --filter @forge-go/dashboard-host test -- setup-model.test.ts setup-metadata.test.tsx
pnpm --filter @forge-go/dashboard-host typecheck
pnpm --filter @forge-go/dashboard-kit test -- auth-layout.test.tsx
pnpm --filter @forge-go/dashboard-kit typecheck
pnpm --filter @forge-go/dashboard-kit lint
```

Expected: all pass.

- [ ] **Step 7: Commit the reusable form pieces**

```bash
git status --short
git add packages/host/src/auth/screens/setup-model.ts packages/host/src/auth/screens/setup-metadata.tsx packages/host/test/setup-model.test.ts packages/host/test/setup-metadata.test.tsx packages/kit/src/components/auth-layout.tsx packages/kit/test/auth-layout.test.tsx
git diff --cached --check
git commit -m "feat(auth): add setup form primitives"
```

---

### Task 5: Replace the setup screen with the three-step wizard

**Repository:** `/Users/rexraphael/Work/xraph/forge-dashboard`

**Files:**
- Modify: `packages/host/src/auth/screens/setup.tsx`
- Create: `packages/host/test/setup-screen.test.tsx`

**Interfaces:**
- Consumes: Task 3 setup types and Task 4 model, editor, and wide layout.
- Produces: the full wizard, legacy administrator fallback, direct-route completion guard, and exact `auth.setup` command payload.

- [ ] **Step 1: Write a test harness with mutable query and command results**

Mock `useQuery` by intent name and capture the payload passed to `useCommand().execute`. Render `SetupScreen` under a memory router at `/setup?next=%2F`. The status fixture must include both defaults.

- [ ] **Step 2: Write failing flow tests**

Cover these user-visible cases:

- Platform, Environment, and Administrator progress labels render.
- Defaults prefill platform and environment fields.
- A valid logo URL renders a preview, and an image load error replaces it with the Forge fallback without clearing the entered URL.
- Next validates the current step and focuses the first invalid field.
- Back preserves all values.
- Editing a review item returns to its step.
- Enter advances a valid Platform or Environment step and submits only on Administrator.
- The final command receives the exact `CompleteSetupInput` payload.
- Password and confirmation never appear in `window.localStorage`, `window.sessionStorage`, or the URL.
- `{ pending: true }` without both defaults renders the administrator-only form.
- `{ pending: false }` redirects to `/login?next=%2F`.
- A wire error with code `PERMISSION_DENIED` replaces the form with `Setup already completed` and a sign-in action.
- Other command errors retain all entered values.
- A status error renders a retry action and no form.

- [ ] **Step 3: Implement status gating and draft initialization**

Query `intents.setupStatus` from the setup route itself. Use `AuthLayout size="wide"`. Initialize once from `status.data` after it arrives; do not reset the draft when the query cache refreshes.

If setup is complete, navigate to `/login?next=${encodeURIComponent(next)}`. If both default objects are absent or incomplete, render the legacy administrator form and send the old flat payload.

- [ ] **Step 4: Implement the compact wizard**

Use a three-item ordered list with `aria-current="step"`, one `<form>` for the active step, and concise copy. Use the kit `NativeSelect` for environment type, `Textarea` for description, `Input type="color"` plus a text value for color, and `MetadataEditor` inside a kit `Collapsible` labeled Advanced.

Render the logo URL through an `<img>` preview after basic URL validation. Track load failure separately from the field value, show the shared Forge mark as the fallback, and reset only the preview failure state when the URL changes.

The final review uses compact rows with Edit buttons. The submit button reads `Create platform`, becomes disabled while pending, and calls `onAuthenticated()` only after an `{ ok: true }` result.

- [ ] **Step 5: Implement error focus and already-completed recovery**

Keep a map from field paths to input IDs. After validation, call `document.getElementById(firstErrorId)?.focus()`. On step changes, focus the step heading through a ref with `tabIndex={-1}`.

Detect permission denial from the command error code. Show `Setup already completed` with a `Link` to `/login?next=${encodeURIComponent(next)}`. Other failures use `CommandAlert` above the active form.

- [ ] **Step 6: Run host tests and static checks**

```bash
pnpm --filter @forge-go/dashboard-host test -- setup-screen.test.tsx auth-setup-precedence.test.tsx auth-routes.test.ts
pnpm --filter @forge-go/dashboard-host typecheck
pnpm --filter @forge-go/dashboard-host lint
```

Expected: all pass.

- [ ] **Step 7: Commit the wizard**

```bash
git status --short
git add packages/host/src/auth/screens/setup.tsx packages/host/test/setup-screen.test.tsx
git diff --cached --check
git commit -m "feat(auth): guide first-run platform setup"
```

---

### Task 6: Add a repeatable setup fixture

**Repository:** `/Users/rexraphael/Work/xraph/forge-dashboard`

**Files:**
- Modify: `packages/fixture-server/server.mjs`
- Modify: `packages/fixture-server/verify.mjs`

**Interfaces:**
- Consumes: the final setup wire contract.
- Produces: `FIXTURE_SETUP_PENDING=1`, `auth.setupStatus`, and `auth.setup` behavior for browser testing without deleting a real administrator.

- [ ] **Step 1: Add failing fixture verification**

Start the fixture with `FIXTURE_SETUP_PENDING=1`. Verify that `auth.setupStatus` returns pending platform and environment defaults with no metadata. Send the extended setup command, then verify status returns `{ pending: false }` and `auth.config.brand` returns the submitted platform name.

- [ ] **Step 2: Implement isolated setup fixture state**

Seed state from the environment flag:

```js
setup: {
  pending: envBool("FIXTURE_SETUP_PENDING", false),
  platform: { name: "Forge Fixture", slug: "forge-fixture", logo: "" },
  environment: {
    name: "Development",
    slug: "development",
    type: "development",
    isDefault: true,
    color: "#22c55e",
    description: "",
  },
},
```

Add query and command handlers. The command updates those values, changes pending to false, and returns `{ ok: true, subject: "usr_setup_owner" }`. Keep metadata internal and absent from status responses. Add invalidations matching the Authsome manifest.

- [ ] **Step 3: Run fixture verification**

```bash
FIXTURE_SETUP_PENDING=1 pnpm --filter @forge-go/fixture-server start
```

In a second terminal:

```bash
pnpm --filter @forge-go/fixture-server exec node verify.mjs
```

Expected: verification reports every contributor and setup check passing.

- [ ] **Step 4: Commit only the fixture hunks owned by this task**

`server.mjs` and `verify.mjs` already contain concurrent edits. Inspect the complete diff, then use patch staging if needed:

```bash
git diff -- packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
git add -p packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
git diff --cached --check
git commit -m "test(fixture): model first-run platform setup"
```

Do not include unrelated core fixture or settings work.

---

### Task 7: Run full verification and test through TwinOS Office

**Repositories:** forge-dashboard, Authsome, and the existing TwinOS Office checkout

**Files:**
- No planned source changes.
- Update implementation files only if a failing focused test or browser check proves a defect in this delivery.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: package, backend, and browser evidence tied to the final commits.

- [ ] **Step 1: Run final Authsome verification**

```bash
cd /Users/rexraphael/Work/xraph/forgery/authsome
go test ./extension/contract -count=1
go test -race ./extension/contract -run 'TestSetup' -count=1
go test ./... -count=1
git status --short
```

- [ ] **Step 2: Run final dashboard verification**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin test
pnpm --filter @forge-go/dashboard-plugin typecheck
pnpm --filter @forge-go/dashboard-host test
pnpm --filter @forge-go/dashboard-host typecheck
pnpm --filter @forge-go/dashboard-host lint
pnpm --filter @forge-go/dashboard-kit test
pnpm --filter @forge-go/dashboard-kit typecheck
pnpm --filter @forge-go/dashboard-kit lint
pnpm typecheck
pnpm test
git status --short
```

Record unrelated baseline failures separately. Never describe a focused pass as a whole-workspace pass.

- [ ] **Step 3: Start the repeatable first-run preview without disturbing persistent servers**

Check listening processes first. Reuse the current fixture and shell processes when their environment is correct. Do not kill the user's long-running Office or Forge servers and do not run `pnpm install` beneath them.

Run the fixture with `FIXTURE_SETUP_PENDING=1`, then run the linked shell or Office configuration against that fixture. Confirm the page is reachable before opening the browser.

- [ ] **Step 4: Verify the browser flow**

Open:

```text
http://localhost:3350/forge/login?next=%2F
```

Confirm:

- login redirects to `/forge/setup?next=%2F`
- Forge logo and server host render
- theme selection works and persists across setup steps
- all three steps fit cleanly at desktop width
- the narrow layout wraps controls without clipping
- metadata add, edit, duplicate validation, and remove work
- Back and review Edit preserve values
- completion updates the visible platform brand
- the session refresh leaves setup and reaches `/`
- revisiting `/forge/setup` after completion cannot reopen onboarding

- [ ] **Step 5: Inspect final scope and commits**

For both repositories, record the branch, HEAD, upstream divergence, exact changed files, and test results. Confirm TwinOS Office source did not change. Leave all pre-existing unrelated modifications untouched.

---

## Execution order

Implement Tasks 1 and 2 in Authsome first. Tasks 3 through 5 consume that contract and stay within the shared dashboard packages. Task 6 provides a safe empty-installation preview. Task 7 is the release gate and live proof.

The plan should be executed natively in the current session. The backend and frontend tasks share wire types and the worktrees already contain concurrent changes, so one executor keeping exact path ownership in context is safer and faster than handing each task to a fresh worker.
