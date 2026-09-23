# First-run platform setup

**Date:** 2026-09-22

**Status:** Approved in conversation, pending written review

## Goal

When a Forge installation has no users, opening the sign-in route sends you to a guided setup page. The setup collects the platform identity, the initial default environment, and the first administrator account. Completing it signs the administrator in and returns them to the destination that originally opened the auth flow.

The dashboard owns the setup UI. Auth providers expose named intents and implement the persistence behind them. Authsome remains the first provider to support the full platform setup contract.

## Existing behavior

The host already checks `auth.setupStatus` from the sign-in screen. If it returns `{ pending: true }` and the provider also declares `completeSetup`, the router replaces `/login` with `/setup`.

Authsome reports setup as pending when its platform app has no users. It bootstraps the platform app, Development, Staging, and Production environments, and the platform roles when the engine starts. The current setup command accepts an email, password, optional name, and an unused organization name. It signs up the first user and writes a session cookie. Authsome promotes the first platform user to `platform-owner` during signup.

The current dashboard setup screen asks only for email and password. It does not let you name the platform, configure its logo or metadata, or customize the default environment.

## Decisions

- Keep Authsome's technical bootstrap. Authentication, RBAC, and signup already require a platform app and its seeded roles.
- Customize the bootstrapped platform app and its current default environment. Do not create duplicate records.
- Configure one initial default environment during onboarding. Staging and Production remain available for later editing.
- Keep the auth UI provider neutral. Providers that only return `{ pending }` keep the existing administrator-only setup form.
- Submit the complete setup once, after the user reviews all three steps.
- Update platform and environment records before creating the first user. If an update fails, no user exists and the same request can be retried.
- Preserve the existing `organizationName` input for wire compatibility, but do not add an organization step.
- Keep passwords in React state only. Do not write setup drafts or credentials to browser storage.

## User flow

The route remains `/setup` under the dashboard basename. In TwinOS Office this resolves to `/forge/setup`. The `next` query parameter survives the redirect from sign-in and every setup step.

The page uses the shared Forge auth layout, Forge mark, server host display, and theme switcher. A compact progress row shows Platform, Environment, and Administrator. The layout uses one column on narrow screens and keeps the form and current step visible without unnecessary vertical space on desktop.

### Platform

The first step asks for:

- Display name
- Slug
- Logo URL, with a preview and a clear invalid-image fallback
- Optional key/value metadata inside a collapsed Advanced section

The name and slug start with values returned by Authsome. Changing the name updates an untouched generated slug. Once the user edits the slug directly, later name changes leave it alone.

### Environment

The second step edits the environment that Authsome currently marks as default:

- Name
- Slug
- Type: Development, Staging, or Production
- Color
- Description
- Optional key/value metadata inside a collapsed Advanced section

The type starts as Development for a normal bootstrap. Selecting a type may suggest its standard color until the color has been edited directly.

### Administrator

The final step asks for:

- Full name
- Email
- Password
- Password confirmation

A compact review shows the platform and environment values. Edit actions return to the relevant step without clearing the administrator fields.

The primary action reads `Create platform`. While the command runs, all navigation and submission controls are disabled and the button shows progress. A successful response refreshes auth state and navigates to the validated local `next` destination, or `/` when `next` is missing or unsafe.

## Dashboard contract

The shared plugin package adds setup types alongside the existing auth types.

```ts
export interface SetupPlatformDefaults {
  name: string
  slug: string
  logo?: string
}

export interface SetupEnvironmentDefaults {
  name: string
  slug: string
  type: "development" | "staging" | "production"
  color?: string
  description?: string
}

export interface SetupStatus {
  pending: boolean
  platform?: SetupPlatformDefaults
  environment?: SetupEnvironmentDefaults
}

export interface SetupMetadata {
  [key: string]: string
}

export interface CompleteSetupInput {
  email: string
  password: string
  name?: string
  organizationName?: string
  platform?: SetupPlatformDefaults & { metadata?: SetupMetadata }
  environment?: SetupEnvironmentDefaults & { metadata?: SetupMetadata }
}
```

These fields are additive. A provider can continue returning `{ pending: boolean }`, and an older client can continue sending only `email` and `password`.

Stored metadata is deliberately absent from `SetupStatus`. This query is anonymous, and existing metadata may contain deployment information that should never be exposed before authentication. Metadata supplied to `auth.setup` is merged into the stored map. Omitting metadata preserves the stored values.

The full wizard appears only when both `platform` and `environment` defaults are present. If either object is absent, the host renders the administrator-only form. This keeps other providers compatible and prevents a half-configured wizard.

## Authsome behavior

### Setup status

`auth.setupStatus` keeps its current fail-closed user count behavior. If the count query fails, it returns `pending: false` and does not expose setup.

When no users exist, the handler loads the platform app and its default environment. It returns only fields needed to initialize the form. It never returns the publishable key, stored metadata, environment settings, role data, or other internal configuration.

If the platform app or default environment cannot be loaded, the query returns an unavailable error. The sign-in screen shows a retryable configuration error. It must not render an empty setup form that could create a second app or environment.

### Setup command

The command accepts both the old administrator-only payload and the extended payload. It performs these operations in order:

1. Normalize the email and trim user-visible text fields.
2. Validate the administrator, platform, environment, and metadata input before writing anything.
3. Enter the setup critical section and count platform users again.
4. Reject the command with `permission_denied` if setup has already completed.
5. Load the existing platform app and default environment.
6. Merge the submitted platform values and metadata, then update the app.
7. Merge the submitted environment values and metadata, then update the environment.
8. Sign up the first user through the existing engine path.
9. Write the returned session cookie.
10. Return the user subject and `ok: true`.

The first-user signup path remains responsible for assigning `platform-owner`. The setup handler does not duplicate role assignment logic.

Names and slugs are required when their containing object is supplied. Environment type must be one of the three existing Authsome values. Metadata keys and values must be nonempty after trimming, duplicate keys are rejected in the UI, and the backend applies bounded entry and string lengths. The backend remains the authority for slug uniqueness and password policy.

### Concurrency and retries

The setup handler serializes setup commands for the lifetime of the Authsome contract registration and repeats the user count inside that critical section. This closes the current same-process count-then-create race.

App and environment updates are idempotent. If signup fails, setup remains pending and a retry applies the same values again. If the app update succeeds and the environment update fails, the user can retry without creating another app. If signup succeeds but the response is lost, the next setup status call reports `pending: false`; the browser proceeds to the authenticated destination when the session cookie arrived, or sign-in when it did not.

The process lock covers the supported single Forge process deployment. A future multi-process Authsome deployment needs a durable store-level setup claim or transaction. That store contract is outside this change.

## Errors and recovery

Client validation runs when you leave a field and when you press Next or Create platform. The first invalid field receives focus. The steps remain keyboard accessible, and Enter advances or submits only when the current step is valid.

Backend validation errors appear at the matching field when the contract supplies a field path. Other errors use the shared command alert above the active form. Entered values remain in memory after an error.

If another request completes setup first, the command returns `permission_denied`. The page replaces the form with `Setup already completed` and a button to continue to sign-in or the validated destination.

The app and environment may have been updated when account creation fails. The error copy tells you to correct the administrator details and retry. It does not claim the configuration was rolled back.

## Cache and navigation

Completing setup invalidates or clears cached values for:

- `auth.config`
- `auth.setupStatus`
- Auth principal and session state
- App context
- Environment context

The next render therefore uses the new platform name and logo. The host validates `next` as a local path before navigation. External URLs and malformed values fall back to `/`.

## Accessibility and presentation

- Every field has a persistent label and associated description or error text.
- Step state is conveyed by text and `aria-current`, not color alone.
- Error summaries link to their fields.
- Focus moves to the new step heading after Next or Back.
- The logo preview has useful alternative text, while decorative Forge marks remain hidden from assistive technology.
- Light and dark themes use the existing dashboard tokens.
- Controls wrap on narrow screens without clipping content or shrinking text.

## Ownership and files

The dashboard changes belong in:

- `packages/plugin/src/auth.ts` for shared setup types
- `packages/host/src/auth/screens/setup.tsx` and small colocated setup components
- `packages/host/test/` for route and screen behavior
- `packages/fixture-server/` for a full setup fixture used by the shell and local preview

Authsome changes belong in the sibling repository:

- `extension/contract/handlers_auth_pages.go` for status and completion
- Focused contract tests beside that handler

The Authsome plugin still contributes intent names only. It does not ship its own setup screen. TwinOS Office gateway rules do not change for this feature because `/forge`, `/forge/*`, and `/api/forge/*` are already excluded from the main application auth guard.

## Verification

### Dashboard tests

- Login redirects to setup when both setup intents exist and status is pending.
- Providers with incomplete setup intents do not enter a redirect loop.
- A status response with platform and environment defaults renders all three steps.
- A status response with only `pending` renders the administrator-only form.
- Defaults populate the fields, generated slugs stop changing after manual edits, and metadata rows reject empty or duplicate keys.
- Next, Back, review edits, keyboard submission, focus movement, and narrow layouts work.
- The command receives the exact nested payload.
- Field errors, command errors, already-completed setup, and retry state render correctly.
- Password and confirmation never enter storage or query parameters.
- Successful setup refreshes auth state and preserves a safe `next` destination.

### Authsome tests

- Setup status is false when users exist and fails closed when user counting fails.
- Pending status returns safe platform and default environment values without metadata or credentials.
- The old email/password payload still creates the first user.
- The extended payload updates app and environment fields and merges metadata.
- Validation failures do not write app, environment, or user records.
- Update failures leave setup pending and can be retried.
- A successful setup writes the session cookie and the first user receives `platform-owner` through the existing signup behavior.
- Concurrent setup commands in one process create one first user; the loser receives `permission_denied`.

### Live check

Run the Authsome-backed dashboard through TwinOS Office and open:

```text
http://localhost:3350/forge/login?next=%2F
```

With an empty platform user store, the browser must land on `/forge/setup?next=%2F`. Complete the wizard, confirm the platform branding updates, confirm the selected environment is active, and verify the browser reaches `/`. Repeat the presentation check in light and dark themes at desktop and narrow widths.

## Out of scope

- Creating or deleting additional environments during setup
- Creating an organization
- Uploading logo files
- Editing auth methods, OAuth providers, SMTP, or password policy
- Resuming setup drafts after a page reload
- Distributed setup locking across multiple Forge processes
- Changing TwinOS Office gateway ownership of `/forge`

## Acceptance criteria

- A deployment with no platform users reaches setup from the Forge sign-in route.
- The setup customizes the existing platform app and default environment.
- The first administrator becomes `platform-owner` and receives a session.
- Existing auth providers and administrator-only setup payloads continue to work.
- Anonymous responses expose no stored metadata or credentials.
- Retrying a failed setup does not create duplicate platform apps or environments.
- Two same-process setup requests cannot both create a first administrator.
- The completed flow works from the TwinOS Office `/forge` mount and preserves its safe destination.
