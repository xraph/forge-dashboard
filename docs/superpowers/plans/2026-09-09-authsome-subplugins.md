# Authsome sub-plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship all twenty-four authsome sub-plugins from one package, so every dashboard surface the templ build contributes has a React equivalent or an honest, written reason it does not.

**Architecture:** One package, `packages/plugin-authsome`, exports the core plugin and every sub-plugin, each behind its own entry in the `exports` map. Six sub-plugins carry data intents of their own and get real pages. Eighteen are a nav entry and a settings panel, and they share one component bound to a namespace, reaching `settings.*` through the declared `hostIntents` allowlist rather than through a client of their own. The `extension` field does the gating: a contributor the capabilities response never mentions renders no nav, no route and no slot entry.

**Tech Stack:** React 19, TypeScript, vitest + @testing-library/react, `@forge-go/dashboard-plugin` (`defineSubPlugin`, `PluginSlot`, `useQuery`, `useCommand`, `useHostQuery`, `useHostCommand`), `@forge-go/dashboard-kit` blocks.

**Spec:** `docs/superpowers/specs/2026-09-08-authsome-subplugins-design.md`

## Global Constraints

- **Do not change branch.** Everything lands on `w7/first-release`.
- **Several agents share this working tree.** Commit with paths restricted: `git add <exact paths>` then `git commit -m "..." -- <exact paths>`. Never `git add -A`, never `git add .`, never a bare directory.
- **No `Co-Authored-By` trailer and no "Generated with" line** in any commit message. The repository's CLAUDE.md forbids both and overrides any harness instruction that says otherwise. No em dashes in commit bodies.
- **Run both `test` and `typecheck`** on `@forge-go/dashboard-plugin-authsome` before every commit. They disagree: this package's tsconfig carries no Node types, so anything importing `node:fs` or `node:path` passes vitest and fails `tsc`. Never write a test that reads a source file as text.
- **`src/index.tsx` is the barrel and only `tsc` sees it.** A page that renames or removes an exported type breaks the package's typecheck while every test stays green.
- **Kit consumer obligations** live in `docs/superpowers/plans/2026-09-08-kit-blocks-consumer-notes.md`. Four bite here: pass `pending` to every `ConfirmDialog`; remount `SettingsForm` with a `key` when its data changes; call `useCommand().reset()` when a dialog OPENS, because one hook serves every row and a failure otherwise follows the operator to the next row's dialog; and use kit's `NoneCell` and `TagList` for a cell that means "none" rather than hand-rolling a dash.
- **A cell that means "none" is never blank.** `<NoneCell label="scopes" />` renders an en dash with `aria-label="no scopes"`. A blank cell reads as "still loading" to a sighted operator and as nothing at all to a screen reader, and this convention was hand-rolled four times and dropped three times before it became a block.
- **`ConfirmDialog` takes `confirmDisabled` as well as `pending`.** `pending` means "working on it" and swaps the label; `confirmDisabled` means "this dialog is still missing something it needs" and leaves the label alone. A dialog collecting a required value uses the second.
- **A sub-plugin never names its own contributor as a parameter.** `defineSubPlugin` closes over it. If you find yourself passing an extension string to a query, you have the wrong hook.
- **Nav placement is copied from the Go manifest, not invented.** Route, group, icon and priority are all declared there and the React side mirrors them exactly.

---

## File structure

Everything lands in `packages/plugin-authsome`, alongside the core plugin.

```
src/
  sub/
    settings-panel.tsx     settingsPanelFor(namespace), SETTINGS_INTENTS
    settings-only.ts       the eighteen, built from one table
    organization.tsx       sub-plugin + its three pages
    apikey.tsx             sub-plugin + its three pages
    waitlist.tsx           sub-plugin + its page and widget
    consent.tsx            sub-plugin + its page, user section and widget
    subscription.tsx       sub-plugin + plans, plan detail, org tab, user section
    password.tsx           sub-plugin + the policy page
    index.ts               authsomeSubPlugins: every first-party sub-plugin
test/
  sub/
    settings-only.test.tsx    one parameterised suite for all eighteen
    organization.test.tsx     apikey.test.tsx  waitlist.test.tsx
    consent.test.tsx          subscription.test.tsx  password.test.tsx
    isolation.test.tsx        the three cross-cutting tests
```

One file per sub-plugin, holding its declaration and its pages together. Six
files of a few hundred lines each beats one file of two thousand, and a
sub-plugin is the unit somebody actually reasons about: its declaration, its
routes and its slot contributions belong in one place because changing any of
them usually means changing the others.

`src/sub/index.ts` exports the array. `src/index.tsx` re-exports it, so a
consumer taking the default import gets everything, and the `exports` map lets a
consumer who wants Organizations but not Waitlist reach in for one.

## The exports map

The spec asks for an entry per sub-plugin. One wildcard gives the same property
with no maintenance:

```json
"exports": {
  ".": "./src/index.tsx",
  "./sub": "./src/sub/index.ts",
  "./sub/*": "./src/sub/*.tsx"
}
```

`import { organizationSubPlugin } from "@forge-go/dashboard-plugin-authsome/sub/organization"` resolves,
and nothing else in that file's module graph loads. Twenty-four hand-written
entries would say the same thing and go stale the first time somebody adds one.

---

### Task 0: The settings panel, and the harness that can render a sub-plugin

**Files:**
- Create: `packages/plugin-authsome/src/sub/settings-panel.tsx`
- Create: `packages/plugin-authsome/test/sub/harness.tsx`
- Test: `packages/plugin-authsome/test/sub/settings-panel.test.tsx`
- Modify: `packages/plugin-authsome/package.json` (the `exports` map)

**Interfaces:**
- Consumes: `flattenCategories`, `toDescriptors`, and the types `SettingField`, `SettingsNamespaceResponse` from `src/settings-fields.ts` (authsome core Task 8). `useHostQuery`, `useHostCommand` from `@forge-go/dashboard-plugin`. `SettingsForm`, `QueryBoundary`, `CommandAlert` from kit.
- Produces: `SETTINGS_INTENTS`, `settingsPanelFor(namespace: string): ComponentType`, and from the harness `renderSubPage(Page, { client, hostClient, allowed, params? })`.

**Do not start until authsome core Task 8 has landed.** This task imports
`flattenCategories` and `toDescriptors` from it and reimplementing either would
give the product two settings mappings that drift.

This is the highest-leverage task in the plan. Eighteen sub-plugins are this one
component with a different string. If the panel is wrong, it is wrong eighteen
times and every one of them looks plausible.

**Why this cannot just reuse the core's settings page.** `AuthSettingsNamespacePage`
reads through `useQuery`, which is bound to the plugin's own extension. A
sub-plugin's own extension is `mfa`, and `mfa` answers no intents at all. The
panel has to read through `useHostQuery`, which resolves the host's client and
checks the intent against the sub-plugin's declared `hostIntents`. Same store,
same shapes, different client. That is the entire difference and it is why this
is a separate component rather than a prop.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin-authsome/test/sub/settings-panel.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { SETTINGS_INTENTS, settingsPanelFor } from "../../src/sub/settings-panel"
import { renderSubPage, subStubClient } from "./harness"

const namespaceAnswer = {
  namespace: "mfa",
  displayName: "Multi-Factor Auth",
  scope: "app",
  categories: [
    {
      name: "Enforcement",
      settings: [
        {
          key: "require_mfa", displayName: "Require MFA", type: "bool",
          effectiveValue: false, isOverridden: false, isEnforced: false,
          canOverride: true, order: 1,
        },
      ],
    },
    {
      name: "Codes",
      settings: [
        {
          key: "code_length", displayName: "Code length", type: "int",
          effectiveValue: 6, default: 6, isOverridden: false,
          isEnforced: false, canOverride: true, order: 2,
        },
      ],
    },
  ],
}

describe("settingsPanelFor", () => {
  it("reads its namespace through the HOST client, not its own", async () => {
    const host = subStubClient({ "settings.namespace": namespaceAnswer })
    const own = subStubClient({})
    const Panel = settingsPanelFor("mfa")

    renderSubPage(Panel, { client: own.client, hostClient: host.client, allowed: SETTINGS_INTENTS })

    await waitFor(() => expect(screen.getByText("Require MFA")).toBeTruthy())
    // The whole point of hostIntents: the read went to auth, not to mfa.
    expect(host.intents).toEqual(["settings.namespace"])
    expect(own.intents).toEqual([])
    expect(host.payloads[0]).toEqual({ namespace: "mfa", scope: "app" })
  })

  it("shows fields from every category, grouped by category name", async () => {
    const host = subStubClient({ "settings.namespace": namespaceAnswer })
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: SETTINGS_INTENTS })

    await waitFor(() => expect(screen.getByText("Require MFA")).toBeTruthy())
    // A namespace whose second category is dropped renders a panel that looks
    // complete and is missing half its settings, which is why this asserts on
    // both.
    expect(screen.getByText("Code length")).toBeTruthy()
    expect(screen.getByText("Enforcement")).toBeTruthy()
    expect(screen.getByText("Codes")).toBeTruthy()
  })

  it("sends one settings.update per changed key, through the host", async () => {
    const host = subStubClient(
      { "settings.namespace": namespaceAnswer },
      { "settings.update": { ok: true } },
    )
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: SETTINGS_INTENTS })

    await waitFor(() => expect(screen.getByText("Code length")).toBeTruthy())
    fireEvent.change(screen.getByLabelText("Code length"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))

    await waitFor(() => expect(host.commands).toHaveLength(1))
    expect(host.commands[0]).toEqual({
      intent: "settings.update",
      payload: { key: "code_length", value: 8, scope: "app" },
    })
  })

  it("throws when it reaches an intent outside its allowlist", () => {
    const Panel = settingsPanelFor("mfa")
    // An allowlist that does not carry settings.namespace is a mistake in the
    // sub-plugin's own declaration, and it should be as loud as definePlugin's
    // import-time validation rather than a quiet empty panel.
    expect(() =>
      renderSubPage(Panel, {
        client: subStubClient({}).client,
        hostClient: subStubClient({}).client,
        allowed: ["settings.update"],
        catchErrors: true,
      }),
    ).toThrow(/settings\.namespace/)
  })

  it("offers no reset-to-default control", async () => {
    const host = subStubClient({ "settings.namespace": namespaceAnswer })
    const Panel = settingsPanelFor("mfa")
    renderSubPage(Panel, { client: subStubClient({}).client, hostClient: host.client, allowed: SETTINGS_INTENTS })

    await waitFor(() => expect(screen.getByText("Code length")).toBeTruthy())
    // settings.update passes its value straight to Manager.Set, so a reset
    // button would write a literal null rather than clearing the override.
    // The intent that clears one is not exposed. See the platform decisions doc.
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/settings-panel`
Expected: FAIL, cannot resolve `../../src/sub/settings-panel`.

- [ ] **Step 3: Write the harness**

```tsx
// packages/plugin-authsome/test/sub/harness.tsx
import type { ComponentType } from "react"
import { render } from "@testing-library/react"
import { HostAccessProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { stubClient } from "../harness"

/**
 * The same recording stub the core pages use, re-exported so a sub-plugin test
 * does not grow a second one that drifts. It answers queries from `answers`
 * and commands from `commands`, and records what it was asked.
 */
export const subStubClient = stubClient

export interface RenderSubOptions {
  /** Bound to the sub-plugin's OWN extension. */
  client: ScopedClient
  /** Bound to the HOST's extension. What `hostIntents` reaches. */
  hostClient: ScopedClient
  allowed: string[]
  params?: Record<string, string | undefined>
  /**
   * `useHostAccess` throws during render for an intent outside the allowlist,
   * and in the real app a `PluginErrorBoundary` catches it. A test asserting
   * the throw wants it to escape, so no boundary is rendered here at all and
   * this flag only silences React's error logging.
   */
  catchErrors?: boolean
}

export function renderSubPage(
  Page: ComponentType<{ params: Record<string, string | undefined> }>,
  opts: RenderSubOptions,
) {
  return render(
    <HostAccessProvider
      value={{ client: opts.hostClient, allowed: opts.allowed, subExtension: "test-sub" }}
    >
      <PluginProvider client={opts.client}>
        <Page params={opts.params ?? {}} />
      </PluginProvider>
    </HostAccessProvider>,
  )
}
```

The nesting order matters and is not arbitrary: it is the order `PluginSlot`
and `PluginHost` both use, host access outside the plugin provider. Write it the
other way and the test passes while the real mount is a different tree.

- [ ] **Step 4: Write the panel**

```tsx
// packages/plugin-authsome/src/sub/settings-panel.tsx
import type { ComponentType } from "react"
import { useHostCommand, useHostQuery } from "@forge-go/dashboard-plugin"
import { QueryBoundary, CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { SettingsForm } from "@forge-go/dashboard-kit/components/settings-form"
import { flattenCategories, toDescriptors } from "../settings-fields"
import type { SettingsNamespaceResponse } from "../settings-fields"

/**
 * Every host intent a settings-only sub-plugin may reach, and no others.
 *
 * Four strings is the whole of the exception to "a plugin queries its own
 * extension and nothing else". It is declared per sub-plugin rather than
 * granted by having a host, so the widening is readable at the call site
 * instead of implied.
 */
export const SETTINGS_INTENTS = [
  "settings.namespace",
  "settings.update",
  "settings.enforce",
  "settings.unenforce",
] as const

/**
 * A settings panel bound to one namespace.
 *
 * Call this ONCE per sub-plugin, at module scope, and reuse the component for
 * both the route and the settings tab. Calling it inside a render would mint a
 * new component type on every pass and remount the form under the operator's
 * cursor, discarding whatever they had typed.
 */
export function settingsPanelFor(namespace: string): ComponentType {
  function SettingsPanel() {
    const query = useHostQuery<SettingsNamespaceResponse>("settings.namespace", {
      namespace,
      scope: "app",
    })
    const update = useHostCommand<{ ok: boolean }>("settings.update")

    async function save(changed: Record<string, unknown>) {
      for (const [key, value] of Object.entries(changed)) {
        const result = await update.execute({ key, value, scope: "app" })
        // Stop at the first failure rather than firing the rest blind. The
        // operator sees which key failed and the ones after it are untouched
        // rather than half-applied.
        if (result === undefined) return
      }
    }

    return (
      <>
        <CommandAlert title="Could not save" error={update.error} />
        <QueryBoundary title={namespace} query={query}>
          {(data) => {
            const fields = flattenCategories(data)
            return (
              <SettingsForm
                // Remount when the data changes, per the kit consumer notes:
                // the form seeds its draft once on mount and does not re-seed.
                key={`${namespace}:${fields.length}`}
                fields={toDescriptors(fields)}
                saving={update.loading}
                onSave={(changed) => void save(changed)}
                emptyMessage="This plugin has nothing to configure."
              />
            )
          }}
        </QueryBoundary>
      </>
    )
  }

  SettingsPanel.displayName = `SettingsPanel(${namespace})`
  return SettingsPanel
}
```

Do NOT wrap the form in a `<form>` element. Its blank-numeric guard lives on the
Save button's disabled state, and a form gives you a submit-on-Enter path
straight past it.

- [ ] **Step 5: Add the exports map entries**

In `packages/plugin-authsome/package.json`:

```json
"exports": {
  ".": "./src/index.tsx",
  "./sub": "./src/sub/index.ts",
  "./sub/*": "./src/sub/*.tsx"
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/settings-panel`
Expected: PASS, five tests.

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome typecheck`
Expected: clean. `tsc` is stricter than vitest in this package and sees the barrel.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin-authsome/src/sub/settings-panel.tsx packages/plugin-authsome/test/sub/harness.tsx packages/plugin-authsome/test/sub/settings-panel.test.tsx packages/plugin-authsome/package.json
git commit -m "feat(authsome): the settings panel every settings-only sub-plugin renders" -- packages/plugin-authsome/src/sub/settings-panel.tsx packages/plugin-authsome/test/sub/harness.tsx packages/plugin-authsome/test/sub/settings-panel.test.tsx packages/plugin-authsome/package.json
```

---

### Task 1: The eighteen settings-only sub-plugins

**Files:**
- Create: `packages/plugin-authsome/src/sub/settings-only.ts`
- Test: `packages/plugin-authsome/test/sub/settings-only.test.tsx`

**Interfaces:**
- Consumes: `SETTINGS_INTENTS`, `settingsPanelFor` from Task 0. `defineSubPlugin` from `@forge-go/dashboard-plugin`. Icons from `@forge-go/dashboard-kit/icons`.
- Produces: `settingsOnlySubPlugins: ForgeSubPlugin[]`, and `SETTINGS_ONLY` (the table itself, exported so the test can iterate it).

Eighteen sub-plugins, one component, one table. The manifests below are copied
verbatim from `plugins/<name>/contract/manifest.yaml` in the authsome
repository. Every field was checked. Do not adjust one because it looks wrong:
if `notification` sits under Configuration while everything else security-shaped
sits under Security, that is what Go declares and the two dashboards should
agree.

**Every one of the eighteen declares `intents: []`.** That was verified across
all eighteen, and each plugin's own `handlers_test.go` asserts it. So none of
them can query anything under its own name, and the four host intents are the
whole of what they can reach.

**The namespace equals the contributor name in all eighteen cases**, also
verified. It is still written out per row rather than derived, because that is
manifest convention rather than a schema invariant, and a derived binding would
break silently the first time somebody in the Go repo names one differently.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/plugin-authsome/test/sub/settings-only.test.tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import { SETTINGS_ONLY, settingsOnlySubPlugins } from "../../src/sub/settings-only"
import { renderSubPage, subStubClient } from "./harness"

const capabilities = (names: string[]) => ({
  contributors: names.map((name) => ({ name, intents: [] })),
})

describe("the eighteen settings-only sub-plugins", () => {
  it("declares all eighteen, with unique routes and unique extensions", () => {
    expect(settingsOnlySubPlugins).toHaveLength(18)
    const routes = settingsOnlySubPlugins.flatMap((s) => s.routes.map((r) => r.path))
    expect(new Set(routes).size).toBe(routes.length)
    const extensions = settingsOnlySubPlugins.map((s) => s.extension)
    expect(new Set(extensions).size).toBe(18)
  })

  it("mounts every one inside auth, and never inside itself", () => {
    for (const sub of settingsOnlySubPlugins) {
      expect(sub.host).toBe("auth")
      expect(sub.extension).not.toBe(sub.host)
    }
  })

  it("declares exactly the four settings intents and nothing else", () => {
    for (const sub of settingsOnlySubPlugins) {
      // The allowlist is the entire scoping guarantee for these eighteen. A
      // fifth intent here is a sub-plugin quietly reading users.list through
      // its host.
      expect([...sub.hostIntents].sort()).toEqual([
        "settings.enforce", "settings.namespace", "settings.unenforce", "settings.update",
      ])
    }
  })

  it("renders nothing when its contributor is absent", () => {
    const mfa = settingsOnlySubPlugins.find((s) => s.extension === "mfa")!
    // The gating is presence, not configuration: a deployment without the mfa
    // plugin has no MFA nav entry and no MFA settings tab, which is what an
    // admin expects when a plugin is not installed.
    expect(resolvePluginState(mfa as never, capabilities(["auth"])).kind).toBe("hidden")
    expect(resolvePluginState(mfa as never, capabilities(["auth", "mfa"])).kind).toBe("ready")
  })

  it.each(SETTINGS_ONLY)(
    "$extension renders its own namespace through the host",
    async (row) => {
      const host = subStubClient({
        "settings.namespace": {
          namespace: row.namespace, scope: "app",
          categories: [{ name: "General", settings: [{
            key: "enabled", displayName: `${row.label} enabled`, type: "bool",
            effectiveValue: true, isOverridden: false, isEnforced: false,
            canOverride: true, order: 1,
          }] }],
        },
      })
      const sub = settingsOnlySubPlugins.find((s) => s.extension === row.extension)!
      const Page = sub.routes[0].element

      renderSubPage(Page, {
        client: subStubClient({}).client,
        hostClient: host.client,
        allowed: sub.hostIntents,
      })

      await waitFor(() => expect(screen.getByText(`${row.label} enabled`)).toBeTruthy())
      // The namespace on the wire is this sub-plugin's own, not the previous
      // row's. A shared component bound to the wrong string is exactly the bug
      // a parameterised suite exists to catch.
      expect(host.payloads[0]).toEqual({ namespace: row.namespace, scope: "app" })
    },
  )

  it("contributes one settings tab each, keyed by its own extension", () => {
    for (const sub of settingsOnlySubPlugins) {
      const tabs = sub.contributions["settings.tabs"] ?? []
      expect(tabs).toHaveLength(1)
      expect(tabs[0].id).toBe(sub.extension)
      expect(tabs[0].label).toBeTruthy()
      // The route and the tab must be the SAME component instance. Two
      // instances means two mounts of the same panel and two identical
      // requests, and the second one is invisible.
      expect(tabs[0].render).toBe(sub.routes[0].element)
    }
  })
})
```

`it.each` over the table is the whole point. Eighteen near-identical suites
would be volume rather than coverage, and the one thing that actually differs
between them, the namespace string on the wire, is precisely what the
parameterised assertion pins.

- [ ] **Step 2: Run and confirm it fails**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/settings-only`
Expected: FAIL, cannot resolve `../../src/sub/settings-only`.

- [ ] **Step 3: Write the table and the declarations**

```ts
// packages/plugin-authsome/src/sub/settings-only.ts
import { defineSubPlugin } from "@forge-go/dashboard-plugin"
import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import { SETTINGS_INTENTS, settingsPanelFor } from "./settings-panel"

interface SettingsOnlyRow {
  /** The Go contributor name. Decides whether any of this renders. */
  extension: string
  /** The settings namespace. Equal to `extension` in all eighteen today. */
  namespace: string
  label: string
  route: string
  group: string
  priority: number
  /** Short label for the settings tab, where the full name does not fit. */
  tab: string
}

/**
 * Copied from `plugins/<name>/contract/manifest.yaml` in the authsome
 * repository. Route, group and priority are Go's to decide, not this file's.
 *
 * The legacy `dashboard.go` nav disagrees with several of these. Where it does,
 * the manifest wins: it is the contributor system's own declaration and it is
 * what the capabilities response is built from.
 */
export const SETTINGS_ONLY: SettingsOnlyRow[] = [
  { extension: "riskengine", namespace: "riskengine", label: "Risk Engine", route: "/security/risk", group: "Security", priority: 0, tab: "Risk" },
  { extension: "anomaly", namespace: "anomaly", label: "Anomaly Detection", route: "/security/anomaly", group: "Security", priority: 1, tab: "Anomaly" },
  { extension: "geoip", namespace: "geoip", label: "Geo IP", route: "/security/geoip", group: "Security", priority: 2, tab: "Geo IP" },
  { extension: "geofence", namespace: "geofence", label: "Geofencing", route: "/security/geofence", group: "Security", priority: 3, tab: "Geofencing" },
  { extension: "impossibletravel", namespace: "impossibletravel", label: "Impossible Travel", route: "/security/impossible-travel", group: "Security", priority: 4, tab: "Impossible Travel" },
  { extension: "ipreputation", namespace: "ipreputation", label: "IP Reputation", route: "/security/ip-reputation", group: "Security", priority: 5, tab: "IP Reputation" },
  { extension: "vpndetect", namespace: "vpndetect", label: "VPN Detect", route: "/security/vpn-detect", group: "Security", priority: 6, tab: "VPN" },
  { extension: "deviceverify", namespace: "deviceverify", label: "Device Verify", route: "/security/device-verify", group: "Security", priority: 7, tab: "Devices" },
  { extension: "email", namespace: "email", label: "Email", route: "/auth/email", group: "Auth", priority: 1, tab: "Email" },
  { extension: "phone", namespace: "phone", label: "Phone", route: "/auth/phone", group: "Auth", priority: 2, tab: "Phone" },
  { extension: "magiclink", namespace: "magiclink", label: "Magic Link", route: "/auth/magiclink", group: "Auth", priority: 3, tab: "Magic Link" },
  { extension: "mfa", namespace: "mfa", label: "Multi-Factor Auth", route: "/auth/mfa", group: "Auth", priority: 4, tab: "MFA" },
  { extension: "passkey", namespace: "passkey", label: "Passkeys", route: "/auth/passkeys", group: "Auth", priority: 5, tab: "Passkeys" },
  { extension: "social", namespace: "social", label: "Social Login", route: "/auth/social", group: "Auth", priority: 6, tab: "Social" },
  { extension: "oauth2provider", namespace: "oauth2provider", label: "OAuth2 Provider", route: "/auth/oauth2", group: "Auth", priority: 7, tab: "OAuth2" },
  { extension: "scim", namespace: "scim", label: "SCIM", route: "/enterprise/scim", group: "Enterprise", priority: 0, tab: "SCIM" },
  { extension: "sso", namespace: "sso", label: "SSO", route: "/enterprise/sso", group: "Enterprise", priority: 1, tab: "SSO" },
  { extension: "notification", namespace: "notification", label: "Notifications", route: "/notifications", group: "Configuration", priority: 3, tab: "Notifications" },
]

/**
 * Eighteen declarations, one component each.
 *
 * `settingsPanelFor` is called once per row and the SAME component instance is
 * used for the route and for the settings tab. Two calls would give two
 * component types rendering identical panels, and React would treat them as
 * unrelated: two mounts, two identical requests, and no way to tell from the
 * screen that it happened.
 */
export const settingsOnlySubPlugins: ForgeSubPlugin[] = SETTINGS_ONLY.map((row) => {
  const Panel = settingsPanelFor(row.namespace)
  return defineSubPlugin({
    extension: row.extension,
    host: "auth",
    label: row.label,
    nav: [{ label: row.label, to: row.route, group: row.group, priority: row.priority }],
    routes: [{ path: row.route, element: Panel }],
    hostIntents: [...SETTINGS_INTENTS],
    contributions: {
      "settings.tabs": [{ id: row.extension, label: row.tab, render: Panel }],
    },
  })
})
```

**No icons.** The manifests declare icon names as strings (`shield-check`,
`map-pin`), and `PluginNavItem.icon` takes a `ReactNode`. Mapping eighteen
strings onto kit icons is a lookup table that has to be kept in step with two
repositories, and a wrong icon is the kind of thing nobody notices for a year.
Nav renders fine without one. If icons are wanted later, that is its own change
with its own test, not a thing to guess at here.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/settings-only`
Expected: PASS. Six suites plus eighteen parameterised cases.

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/settings-only.ts packages/plugin-authsome/test/sub/settings-only.test.tsx
git commit -m "feat(authsome): the eighteen settings-only sub-plugins" -- packages/plugin-authsome/src/sub/settings-only.ts packages/plugin-authsome/test/sub/settings-only.test.tsx
```

---

### Task 2: Organization

**Files:**
- Create: `packages/plugin-authsome/src/sub/organization.tsx`
- Test: `packages/plugin-authsome/test/sub/organization.test.tsx`

**Interfaces:**
- Consumes: `defineSubPlugin`, `useQuery`, `useCommand`, `PluginSlot`, `useSlotCount` from `@forge-go/dashboard-plugin`; `PluginPageProps`; kit blocks.
- Produces: `organizationSubPlugin`, `OrgSummary`, `OrgDetail`, `MemberSummary`, and the three page components.

This is the sub-plugin that proves the slot API is not a special case for the
core plugin. It CONSUMES `overview.widgets` on the auth overview, and it HOSTS
three slots of its own: `org.detail.sections`, `org.detail.tabs` and
`org.create.fields`. Get the hosting right here and the same shape works for
anyone.

**The contract, verified against `plugins/organization/contract/`:**

```ts
// orgs.list    -> { organizations: OrgSummary[] }        no input, NO PAGING
// orgs.detail({ id })    -> OrgDetail
// orgs.create({ name, slug, logo? })      -> { ok, id? }
// orgs.update({ id, name?, logo? })       -> { ok }      name/logo are *string
// orgs.delete({ id })                     -> { ok }
// orgs.members({ orgId }) -> { members: MemberSummary[] }  NO PAGING
// orgs.removeMember({ id })               -> { ok }      id is the MEMBER id
interface OrgSummary { id: string; name: string; slug: string; createdAt: string }
interface OrgDetail extends OrgSummary {
  appId?: string; logo?: string; metadata?: Record<string, string>; updatedAt: string
}
interface MemberSummary { id: string; userId: string; role: string; createdAt: string }
```

**Neither list pages.** `orgs.list` takes no input at all and answers the whole
array; `orgs.members` is the same. So this is the one page in the package that
gets no `CursorPager` and no pagination props, and adding them would be
inventing a server behaviour that does not exist. If the org count grows past
what one response should carry, that is a Go change, not a UI change.

**`orgs.removeMember` takes the MEMBER id, not the user id.** `MemberSummary`
carries both and they are different values. Send the wrong one and the call
fails, or worse, matches something else.

**`orgs.update` pointer semantics.** `name` and `logo` are `*string`: absent
means leave alone, and an empty string is a real value that clears the field. So
an untouched field must be ABSENT from the payload, and a field the operator
deliberately cleared must be present as `""`. Those are two different outcomes
and the edit panel has to be able to produce both.

**What the legacy page shows, so nothing is lost.** The templ org list has a
four-card stat row (Organizations, Members, Teams, Invitations) computed from
in-process aggregates that no intent answers, so it does not survive; say so in
the migration note rather than faking it from `organizations.length`. Its table
is Name (with the logo image when set, a building icon otherwise), Slug in
monospace, and Created. Its detail page has exactly two built-in tabs, Overview
and Members, with contributed tabs after them; Overview shows Organization ID,
Slug, Created, Updated and a metadata list when non-empty; Members is a table of
Name, Email, Role and Joined, with the role badge reading Owner as `default`,
Admin as `secondary` and everything else as `outline` labelled "Member".

**What is blocked and must be said out loud in the page, not silently omitted:**
invitations and member role changes. `CreateInvitation`, `ListInvitations` and
`UpdateMemberRole` all exist in `organization/service.go` and none is registered
with the dispatcher. The legacy detail page shows a pending-invitations table.
This one cannot, so the Members tab carries one line of copy saying invitations
are managed in the legacy dashboard until the intents exist. An operator who
sees nothing assumes there are none.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/organization.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { organizationSubPlugin } from "../../src/sub/organization"
import { renderSubPage, subStubClient } from "./harness"

const orgs = {
  organizations: [
    { id: "o1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z" },
    { id: "o2", name: "Globex", slug: "globex", createdAt: "2026-02-01T00:00:00Z" },
  ],
}
const detail = {
  id: "o1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-03-01T00:00:00Z", logo: "https://example.test/a.png",
  metadata: { tier: "gold" },
}
const members = {
  members: [
    { id: "m1", userId: "u1", role: "owner", createdAt: "2026-01-02T00:00:00Z" },
    { id: "m2", userId: "u2", role: "member", createdAt: "2026-01-03T00:00:00Z" },
  ],
}

function pageAt(path: string) {
  return organizationSubPlugin.routes.find((r) => r.path === path)!.element
}

describe("organization list", () => {
  it("lists organizations with their slug", async () => {
    const own = subStubClient(orgs)
    renderSubPage(pageAt("/organizations"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
    expect(screen.getByText("globex")).toBeTruthy()
    // Its OWN contributor answered, not its host's. This is the property the
    // whole extension/host split exists for.
    expect(own.intents).toContain("orgs.list")
  })

  it("counts its rows in the caption, with no paging controls at all", async () => {
    renderSubPage(pageAt("/organizations"), {
      client: subStubClient(orgs).client, hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
    expect(screen.getByText(/2 organizations/i)).toBeTruthy()
    // orgs.list takes no cursor and no limit. A Next button here would be a
    // control for a server behaviour that does not exist.
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull()
  })

  it("says so when there are none", async () => {
    renderSubPage(pageAt("/organizations"), {
      client: subStubClient({ "orgs.list": { organizations: [] } }).client,
      hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText(/no organizations/i)).toBeTruthy())
  })
})

describe("organization detail", () => {
  it("shows the org, its members, and the two built-in tabs", async () => {
    renderSubPage(pageAt("/organizations/:id"), {
      client: subStubClient({ "orgs.detail": detail, "orgs.members": members }).client,
      hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Members" })).toBeTruthy()
    expect(screen.getByText("gold")).toBeTruthy()
  })

  it("asks orgs.members for the org id it was routed with", async () => {
    const own = subStubClient({ "orgs.detail": detail, "orgs.members": members })
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    const membersCall = own.payloads[own.intents.indexOf("orgs.members")]
    // The param is orgId, not id. A detail page that sends `id` here gets
    // somebody else's members or none at all.
    expect(membersCall).toEqual({ orgId: "o1" })
  })

  it("removes a member by the MEMBER id, not the user id", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.removeMember": { ok: true } },
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    fireEvent.click(screen.getByRole("button", { name: /remove u2/i }))
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    // m2, not u2. MemberSummary carries both and they are different values.
    expect(own.commands[0].payload).toEqual({ id: "m2" })
  })

  it("says where invitations live rather than showing an empty section", async () => {
    renderSubPage(pageAt("/organizations/:id"), {
      client: subStubClient({ "orgs.detail": detail, "orgs.members": members }).client,
      hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    fireEvent.click(screen.getByRole("tab", { name: "Members" }))
    // The legacy page shows pending invitations. There is no intent for them.
    // An operator who sees nothing concludes there are none.
    expect(screen.getByText(/invitations are managed in the legacy dashboard/i)).toBeTruthy()
  })

  it("sends only the fields the operator changed", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.update": { ok: true } },
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /edit/i }))
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Acme Inc" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    const payload = own.commands[0].payload as Record<string, unknown>
    expect(payload.name).toBe("Acme Inc")
    // Absent, not "". orgs.update takes *string: an empty string is a real
    // value that clears the logo, and the operator did not ask for that.
    expect("logo" in payload).toBe(false)
  })

  it("sends an empty string for a field the operator deliberately cleared", async () => {
    const own = subStubClient(
      { "orgs.detail": detail, "orgs.members": members },
      { "orgs.update": { ok: true } },
    )
    renderSubPage(pageAt("/organizations/:id"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { id: "o1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Acme" })).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /edit/i }))
    fireEvent.change(screen.getByLabelText("Logo URL"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: /save/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    const payload = own.commands[0].payload as Record<string, unknown>
    // Present and empty. This is the other half of pointer semantics and the
    // half that is usually missing: "clear it" has to be expressible.
    expect("logo" in payload).toBe(true)
    expect(payload.logo).toBe("")
  })
})

describe("organization create", () => {
  it("fills the slug from the name until the operator edits the slug", async () => {
    const own = subStubClient({}, { "orgs.create": { ok: true, id: "o9" } })
    renderSubPage(pageAt("/organizations/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wayne Enterprises" } })
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("wayne-enterprises")
    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "wayne" } })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wayne Corp" } })
    // Once touched, the slug is the operator's. Overwriting it here loses the
    // value they just typed and they may not notice before submitting.
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("wayne")
  })

  it("omits the logo when it is blank", async () => {
    const own = subStubClient({}, { "orgs.create": { ok: true, id: "o9" } })
    renderSubPage(pageAt("/organizations/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wayne" } })
    fireEvent.click(screen.getByRole("button", { name: /create/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    const payload = own.commands[0].payload as Record<string, unknown>
    expect(payload).toEqual({ name: "Wayne", slug: "wayne" })
    expect("logo" in payload).toBe(false)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/organization`
Expected: FAIL, cannot resolve `../../src/sub/organization`.

- [ ] **Step 3: Write the slug helper and its test**

```ts
/**
 * The slug the create form offers for a name.
 *
 * Lowercase, non-alphanumerics collapsed to single hyphens, no leading or
 * trailing hyphen. The Go side validates the slug and rejects anything else,
 * so a form that offers an invalid default is a form that fails on submit for
 * a reason the operator did not cause.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
```

Add to the test file: `slugify("Wayne Enterprises")` is `"wayne-enterprises"`,
`slugify("  Acme!! ")` is `"acme"`, `slugify("")` is `""`.

- [ ] **Step 4: Write the three pages and the declaration**

The list page: `useQuery<OrgList>("orgs.list")` with no params, a `PageHeader`
with a "New organization" link to `/@auth/organizations/create`, a
`ResourceTable<OrgSummary>` with columns

- **Name**, `className="font-medium"`, cell is a link to
  `/@auth/organizations/${org.id}`
- **Slug**, `className="font-mono text-xs"`
- **Created**, `formatTimestamp(org.createdAt)`

caption `` `${rows.length} organizations` ``, `emptyMessage` "No organizations
yet." and no pagination props. Below it, the auth overview widget contribution
is not here; that goes in Task 8.

The detail page takes `PluginPageProps`, guards a missing `params.id` with "No
organization selected.", and reads `orgs.detail({ id })` and
`orgs.members({ orgId: id })` in TWO separate `QueryBoundary`s inside two child
components, so a slow member list does not blank out the org's own fields.

Its tab strip is Overview, Members, then `<PluginSlot name="org.detail.tabs"
params={{ orgId: id }} />`. Use kit's tabs primitive; the contributed tabs are
rendered after the built-ins, matching the templ page. Guard the contributed
group with `useSlotCount("org.detail.tabs")` so no empty tab strip section is
drawn.

Overview renders a `DescriptionList` of Organization ID (`font-mono text-xs`),
Slug (`font-mono text-xs`), Created, Updated, and a metadata list only when
`metadata` is non-empty. Then `<PluginSlot name="org.detail.sections"
params={{ orgId: id }} />`.

Members renders a `ResourceTable<MemberSummary>` with columns User ID
(`font-mono text-xs`), Role (a `Badge`: `owner` is `default`, `admin` is
`secondary`, anything else is `outline` reading "Member") and Joined, a row
action "Remove" opening a `ConfirmDialog` with `pending={removeMember.loading}`
and `aria-label={`Remove ${member.userId}`}`, and below the table the single
line of copy about invitations.

**The remove dialog's error must render INSIDE the dialog.** Base UI marks
everything outside an open dialog inert and `aria-hidden`, so a `CommandAlert`
on the page body is invisible to a real operator, not just to a test. Put a
`<span role="alert">` in the dialog description, as `plugin-streaming`'s
`rooms.tsx` does.

The create page has Name (required), Slug (required, help text "Lowercase
letters, numbers and hyphens only. Filled in from the name until you edit it.")
and Logo URL (optional), a `<PluginSlot name="org.create.fields" />` above the
submit, and sends `{ name, slug }` plus `logo` only when non-empty.

The declaration:

```tsx
export const organizationSubPlugin = defineSubPlugin({
  extension: "organization",
  host: "auth",
  label: "Organizations",
  nav: [{ label: "Organizations", to: "/organizations", group: "Identity", priority: 2 }],
  routes: [
    { path: "/organizations", element: OrgListPage },
    { path: "/organizations/create", element: OrgCreatePage },
    { path: "/organizations/:id", element: OrgDetailPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
})
```

Note that only `/organizations` carries nav. Create and detail are reached from
the list, exactly as the Go manifest declares them.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/organization`
Expected: PASS.

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-authsome/src/sub/organization.tsx packages/plugin-authsome/test/sub/organization.test.tsx
git commit -m "feat(authsome): the organization sub-plugin, and the slots it hosts" -- packages/plugin-authsome/src/sub/organization.tsx packages/plugin-authsome/test/sub/organization.test.tsx
```

---

### Task 3: API keys, and the secret you see once

**Files:**
- Create: `packages/plugin-authsome/src/sub/apikey.tsx`
- Test: `packages/plugin-authsome/test/sub/apikey.test.tsx`

**Interfaces:**
- Produces: `apikeySubPlugin`, `APIKeySummary`, `APIKeyDetail`, `CreatedKey`, and the three page components.

**The contract, verified against `plugins/apikey/contract/`:**

```ts
// apikeys.list                 -> { apiKeys: APIKeySummary[] }   NO input, NO paging
// apikeys.detail({ id })       -> APIKeyDetail
// apikeys.create({ name, userId, scopes? }) -> { ok, id, keyPrefix, secret }
// apikeys.revoke({ id })       -> { ok, id? }
interface APIKeySummary {
  id: string; name: string; keyPrefix: string; scopes?: string[]
  revoked: boolean; expiresAt?: string; lastUsedAt?: string; createdAt: string
}
interface APIKeyDetail extends APIKeySummary {
  appId?: string; envId?: string; userId?: string
  serviceAccountId?: string; publicKey?: string; updatedAt: string
}
```

**There is no delete.** Only revoke, which sets a flag. The templ UI drops the
action entirely once a key is revoked, and this page does the same: a revoked
key keeps its row and loses its button. Do not add a delete control and do not
add a filter that hides revoked keys by default, because "where did my key go"
is a worse question than "why is this one greyed out".

**`apikeys.create` requires a `userId`.** A key belongs to a user, so the create
form asks for one rather than defaulting to whoever is signed in. There is no
user-picker intent inside this sub-plugin's own contributor, and reaching
`users.list` through the host would be exactly the widening `hostIntents` exists
to prevent. So the field is a plain text input for a user id, with help text
saying where to find one. That is worse UX than a picker and it is the honest
shape of what this sub-plugin is allowed to see.

#### The one-shot reveal

`CreateAPIKeyResponse` is `{ ok, id, keyPrefix, secret }`. The stored row keeps
only a hash, `KeyHash` is tagged `json:"-"`, and neither `APIKeySummary` nor
`APIKeyDetail` has a secret field. So the value is genuinely gone after this
render. This is not a UI convention being polite about something it could
refetch.

That makes the reveal panel a correctness surface, not a decoration:

- It renders after a successful create and stays until the operator dismisses it.
- Dismissing asks for confirmation, and the confirmation says the key cannot be
  recovered. An operator who closes it by reflex has to mint a new key.
- It does NOT unmount when the list refreshes underneath it. Put it in state
  that a query settling cannot clear.
- The secret is `font-mono break-all select-all` with a copy button, matching
  the legacy panel.
- Navigating away is not something this page can prevent and should not try to.

The legacy panel also shows a Public Key. That lives on `APIKeyDetail`, not on
the create response, so showing it means a follow-up `apikeys.detail({ id })`
using the id the create returned. Do that, and render the public key row only
once it arrives, clearly labelled as safe to share. Never let a slow detail read
delay or block the secret row.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/apikey.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { apikeySubPlugin } from "../../src/sub/apikey"
import { renderSubPage, subStubClient } from "./harness"

const keys = {
  apiKeys: [
    { id: "k1", name: "CI", keyPrefix: "ask_abc", revoked: false, createdAt: "2026-01-01T00:00:00Z", lastUsedAt: "2026-02-01T00:00:00Z" },
    { id: "k2", name: "Old", keyPrefix: "ask_def", revoked: true, createdAt: "2025-01-01T00:00:00Z" },
  ],
}

function pageAt(path: string) {
  return apikeySubPlugin.routes.find((r) => r.path === path)!.element
}

describe("api key list", () => {
  it("shows revoked and active keys apart, and keeps revoked ones on screen", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient(keys).client, hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText("CI")).toBeTruthy())
    // A revoked key keeps its row. Hiding it turns "why is this greyed out"
    // into "where did my key go", which is the worse question.
    expect(screen.getByText("Old")).toBeTruthy()
    expect(screen.getByText("revoked").getAttribute("data-variant")).toBe("destructive")
    expect(screen.getByText("active").getAttribute("data-variant")).toBe("default")
  })

  it("offers Revoke on an active key and not on a revoked one", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient(keys).client, hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText("CI")).toBeTruthy())
    expect(screen.getByRole("button", { name: /revoke ci/i })).toBeTruthy()
    // There is no delete intent at all, so there is no second action to offer
    // once a key is revoked.
    expect(screen.queryByRole("button", { name: /revoke old/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
  })

  it("says never rather than leaving the last-used cell blank", async () => {
    renderSubPage(pageAt("/apikeys"), {
      client: subStubClient(keys).client, hostClient: subStubClient({}).client, allowed: [],
    })
    await waitFor(() => expect(screen.getByText("Old")).toBeTruthy())
    // A blank cell reads as "loading" or "broken". "Never" is a fact.
    expect(screen.getByText("Never")).toBeTruthy()
  })
})

describe("api key create", () => {
  it("shows the secret once, and will not offer to show it again", async () => {
    const own = subStubClient(
      { "apikeys.detail": { id: "k9", name: "CI2", keyPrefix: "ask_xyz", revoked: false, createdAt: "2026-03-01T00:00:00Z", publicKey: "pk_live_1" } },
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))

    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())
    expect(screen.getByText(/only time you will see/i)).toBeTruthy()
    expect(own.commands[0].payload).toEqual({ name: "CI2", userId: "u1" })
  })

  it("fetches the public key afterwards without holding up the secret", async () => {
    const own = subStubClient(
      { "apikeys.detail": { id: "k9", name: "CI2", keyPrefix: "ask_xyz", revoked: false, createdAt: "2026-03-01T00:00:00Z", publicKey: "pk_live_1" } },
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))
    // The secret is on screen before the detail read settles. A public key
    // that arrives late must never gate the one value that cannot be refetched.
    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())
    await waitFor(() => expect(screen.getByText("pk_live_1")).toBeTruthy())
    expect(own.payloads[own.intents.indexOf("apikeys.detail")]).toEqual({ id: "k9" })
  })

  it("confirms before dismissing the panel", async () => {
    const own = subStubClient(
      {},
      { "apikeys.create": { ok: true, id: "k9", keyPrefix: "ask_xyz", secret: "ask_xyz_THE_SECRET" } },
    )
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    fireEvent.change(screen.getByLabelText("User ID"), { target: { value: "u1" } })
    fireEvent.click(screen.getByRole("button", { name: /create key/i }))
    await waitFor(() => expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /done/i }))
    // Reflex-closing this panel costs a new key. The confirm step is the whole
    // reason the panel is not just dismissible.
    expect(screen.getByText(/cannot be recovered/i)).toBeTruthy()
    expect(screen.getByText("ask_xyz_THE_SECRET")).toBeTruthy()
  })

  it("refuses to submit without a user id", async () => {
    const own = subStubClient({}, { "apikeys.create": { ok: true, id: "k9", keyPrefix: "p", secret: "s" } })
    renderSubPage(pageAt("/apikeys/create"), {
      client: own.client, hostClient: subStubClient({}).client, allowed: [],
    })
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CI2" } })
    // userId is required by the contract. Sending an empty one produces a
    // key attached to nobody, which is worse than a disabled button.
    expect((screen.getByRole("button", { name: /create key/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(own.commands).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-authsome test sub/apikey`

- [ ] **Step 3: Write the pages and the declaration**

List columns, matching the legacy table: **Name** (`font-medium`, linking to
`/@auth/apikeys/${id}`), **Prefix** (`font-mono text-xs`, rendered as
`` `${keyPrefix}...` ``), **Scopes** (`<TagList values={key.scopes ?? []} label="scopes" />`), **Status** (a `Badge`: revoked is
`destructive` reading "revoked", otherwise `default` reading "active"),
**Created**, **Last used** (`formatTimestamp` or the literal "Never"). Caption
carries the row count. Row action: Revoke, only when `!key.revoked`, behind a
`ConfirmDialog` with `pending={revoke.loading}` and its error inside the dialog.

Detail page: `apikeys.detail({ id })` in a `DescriptionList` of Key ID, Prefix,
Public key (with a copy control, labelled safe to share), User, App,
Environment, Scopes, Status, Expires, Last used, Created, Updated. Identifier
rows are `font-mono text-xs`. No secret anywhere, because there is none.

Create page: Name, User ID (required, help text), Scopes (comma separated,
omitted when blank), and the reveal panel described above.

```tsx
export const apikeySubPlugin = defineSubPlugin({
  extension: "apikey",
  host: "auth",
  label: "API Keys",
  nav: [{ label: "API Keys", to: "/apikeys", group: "Security", priority: 1 }],
  routes: [
    { path: "/apikeys", element: APIKeyListPage },
    { path: "/apikeys/create", element: APIKeyCreatePage },
    { path: "/apikeys/:id", element: APIKeyDetailPage },
  ],
  hostIntents: [],
})
```

Note the route is `/apikeys`, no hyphen. The legacy `dashboard.go` registers
`/api-keys` under a group called "Developer", and both are wrong here: the
manifest is the contributor system's own declaration. A route typed from memory
off the old dashboard will 404.

**No `user.detail.sections` contribution.** The spec originally promised one and
it is blocked: `apikeys.list` takes no input at all, and `APIKeySummary` carries
no `userId` to filter on. Finding one user's keys means an `apikeys.detail` call
per key in the account. That goes on the migration notes, not into this file.

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/apikey.tsx packages/plugin-authsome/test/sub/apikey.test.tsx
git commit -m "feat(authsome): api keys, and the secret the server will not repeat" -- packages/plugin-authsome/src/sub/apikey.tsx packages/plugin-authsome/test/sub/apikey.test.tsx
```

---

### Task 4: Waitlist

**Files:**
- Create: `packages/plugin-authsome/src/sub/waitlist.tsx`
- Test: `packages/plugin-authsome/test/sub/waitlist.test.tsx`

**Interfaces:**
- Consumes: `CursorPager`, `useCursorStack` from `../components/cursor-pager` (authsome core Task 1).
- Produces: `waitlistSubPlugin`, `EntrySummary`, `EntryList`, `WaitlistCounts`, `WaitlistPage`, `WaitlistCountsWidget`.

**The contract, verified against `plugins/waitlist/contract/`:**

```ts
// waitlist.list({ email?, status?, cursor?, limit? })
//   -> { entries: EntrySummary[], total?, nextCursor? }      limit <= 0 defaults to 100
// waitlist.detail({ id })   -> EntrySummary
// waitlist.approve({ id, note? })  -> { ok }
// waitlist.reject({ id, note? })   -> { ok }
// waitlist.delete({ id })          -> { ok }
// waitlist.counts                  -> { pending, approved, rejected }
interface EntrySummary {
  id: string; email: string; name?: string; status: string; userId?: string
  ipAddress?: string; note?: string; createdAt: string; updatedAt?: string
}
```

`waitlist.counts` answers exactly those three numbers. There is no total, so do
not render one, and do not sum the three into one: an entry could be in a state
none of them counts and a made-up total would hide it.

**This page is a superset of the legacy one, deliberately.** The templ page has
no delete button and no note field, but both exist in the contract and in the
newer manifest's action menu. Approve and reject take an optional `note`, and
the note is what an operator writes down for the next person, so the dialog
offers it. Blank is fine and must be OMITTED rather than sent as `""`.

**Cursor paging, not page numbers.** Use `CursorPager` and `useCursorStack`, the
same pair the users list uses. The bug they exist to prevent: a cursor points
into the previous result set, so changing the search text or the status filter
must reset it first. Carry a stale cursor across a new filter and you get page
two of a result set the operator is no longer looking at, which looks like data
rather than like an error.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/waitlist.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { waitlistSubPlugin, WaitlistCountsWidget } from "../../src/sub/waitlist"
import { renderSubPage, subStubClient } from "./harness"

const entries = {
  entries: [
    { id: "w1", email: "ada@example.com", name: "Ada", status: "pending", createdAt: "2026-01-01T00:00:00Z" },
    { id: "w2", email: "bob@example.com", status: "approved", createdAt: "2026-01-02T00:00:00Z" },
  ],
  total: 2,
}

const page = waitlistSubPlugin.routes[0].element

describe("waitlist", () => {
  it("colours each status apart", async () => {
    renderSubPage(page, { client: subStubClient(entries).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    // The status is what an operator scans for. The word alone is not the
    // signal; the colour is.
    expect(screen.getByText("pending").getAttribute("data-variant")).toBe("outline")
    expect(screen.getByText("approved").getAttribute("data-variant")).toBe("default")
  })

  it("offers approve and reject only on a pending entry", async () => {
    renderSubPage(page, { client: subStubClient(entries).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    expect(screen.getByRole("button", { name: /approve ada@example.com/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /approve bob@example.com/i })).toBeNull()
    // Delete is offered on every entry, pending or not. It is how a mistake
    // gets cleaned up.
    expect(screen.getByRole("button", { name: /delete bob@example.com/i })).toBeTruthy()
  })

  it("omits a blank note rather than sending an empty string", async () => {
    const own = subStubClient(entries, { "waitlist.approve": { ok: true } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /approve ada@example.com/i }))
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    const payload = own.commands[0].payload as Record<string, unknown>
    expect(payload.id).toBe("w1")
    expect("note" in payload).toBe(false)
  })

  it("sends the note when there is one", async () => {
    const own = subStubClient(entries, { "waitlist.reject": { ok: true } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /reject ada@example.com/i }))
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: "duplicate" } })
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    expect(own.commands[0].payload).toEqual({ id: "w1", note: "duplicate" })
  })

  it("drops the cursor when the status filter changes", async () => {
    const own = subStubClient({ "waitlist.list": { ...entries, nextCursor: "c2" } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("ada@example.com")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(own.payloads.at(-1)).toMatchObject({ cursor: "c2" }))
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: "approved" } })
    await waitFor(() => expect(own.payloads.at(-1)).toMatchObject({ status: "approved" }))
    // A cursor points into the PREVIOUS result set. Carried across a new
    // filter it returns page two of an answer nobody asked for, and it looks
    // like data rather than like an error.
    expect((own.payloads.at(-1) as Record<string, unknown>).cursor).toBeUndefined()
  })
})

describe("WaitlistCountsWidget", () => {
  it("shows the three counts the server actually answers", async () => {
    const own = subStubClient({ "waitlist.counts": { pending: 3, approved: 10, rejected: 1 } })
    renderSubPage(WaitlistCountsWidget, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("3")).toBeTruthy())
    expect(screen.getByText("10")).toBeTruthy()
    expect(screen.getByText("1")).toBeTruthy()
    // No total. The server answers three numbers and an entry could be in a
    // state none of them counts, so a computed total would hide it.
    expect(screen.queryByText("14")).toBeNull()
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Write the page, the widget and the declaration**

Columns: **Email** (`font-mono text-xs`, matching the legacy table), **Name** (or
a dash with `aria-label="no name"`), **Status** (`Badge`: pending `outline`,
approved `default`, rejected `destructive`, anything else `secondary`),
**Created**. A `FilterBar` with a debounced email search and a status select of
All / Pending / Approved / Rejected. Row actions: Approve and Reject on pending
entries only, each opening a `ConfirmDialog` carrying an optional note field and
`pending` off its command hook, and Delete on every entry behind a destructive
confirm. Every dialog's error renders inside the dialog.

The widget is a `StatGrid` of Pending, Approved, Rejected.

```tsx
export const waitlistSubPlugin = defineSubPlugin({
  extension: "waitlist",
  host: "auth",
  label: "Waitlist",
  nav: [{ label: "Waitlist", to: "/waitlist", group: "Compliance", priority: 1 }],
  routes: [{ path: "/waitlist", element: WaitlistPage }],
  hostIntents: [],
  contributions: {
    "overview.widgets": [{ id: "waitlist-counts", priority: 20, render: WaitlistCountsWidget }],
  },
})
```

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/waitlist.tsx packages/plugin-authsome/test/sub/waitlist.test.tsx
git commit -m "feat(authsome): the waitlist review queue and its counts widget" -- packages/plugin-authsome/src/sub/waitlist.tsx packages/plugin-authsome/test/sub/waitlist.test.tsx
```

---

### Task 5: Consent

**Files:**
- Create: `packages/plugin-authsome/src/sub/consent.tsx`
- Test: `packages/plugin-authsome/test/sub/consent.test.tsx`

**Interfaces:**
- Produces: `consentSubPlugin`, `ConsentRecord`, `ConsentList`, `ConsentsPage`, `ConsentUserSection`, `ConsentWidget`.

**The contract, verified against `plugins/consent/contract/`:**

```ts
// consent.list({ userId?, purpose?, cursor?, limit? })
//   -> { items: ConsentRecord[], nextCursor? }
// consent.userConsents(...)  same input, SAME HANDLER, wire-identical
// consent.grant({ userId, purpose, version?, ipAddress? })  -> { ok, id }
// consent.revoke({ userId, purpose })                       -> { ok }
interface ConsentRecord {
  id: string; userId: string; appId?: string; purpose: string; granted: boolean
  version?: string; ipAddress?: string; grantedAt?: string; revokedAt?: string
  createdAt: string; updatedAt?: string
}
```

**`consent.revoke` does not take the record id.** It takes `{ userId, purpose }`
and matches on that composite, scoped to the caller's app server-side. Every row
carries an `id`, and sending it is the obvious wrong thing to do. Write the test
that pins the payload shape before you write the button.

**`consent.list` and `consent.userConsents` are the same handler.** They are
registered to one function and differ only in name. Use `consent.list` for the
app-wide page and `consent.userConsents` for the user section anyway: they are
separate cache entries under separate names, and a future Go change that makes
them differ should not require finding every call site. Do not "simplify" this
into one intent.

**The page is new functionality, and that is fine.** The legacy
`/compliance/consent` templ page is a card reading "Consent data is available on
individual user detail pages" with no table at all. So this is a gain over the
legacy dashboard rather than a port of it, and the retirement checklist should
say so rather than implying parity.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/consent.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { consentSubPlugin, ConsentUserSection } from "../../src/sub/consent"
import { renderSubPage, subStubClient } from "./harness"

const items = {
  items: [
    { id: "c1", userId: "u1", purpose: "marketing", granted: true, version: "v2", grantedAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    { id: "c2", userId: "u2", purpose: "analytics", granted: false, revokedAt: "2026-02-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
  ],
}
const page = consentSubPlugin.routes[0].element

describe("consent list", () => {
  it("shows granted and revoked apart", async () => {
    renderSubPage(page, { client: subStubClient({ "consent.list": items }).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(screen.getByText("granted").getAttribute("data-variant")).toBe("default")
    expect(screen.getByText("revoked").getAttribute("data-variant")).toBe("destructive")
  })

  it("revokes by user and purpose, never by the record id", async () => {
    const own = subStubClient({ "consent.list": items }, { "consent.revoke": { ok: true } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }))
    await waitFor(() => expect(own.commands).toHaveLength(1))
    // The row carries an id and the intent does not take one. It matches on
    // the (userId, purpose) composite.
    expect(own.commands[0].payload).toEqual({ userId: "u1", purpose: "marketing" })
  })

  it("offers revoke only on a granted record", async () => {
    renderSubPage(page, { client: subStubClient({ "consent.list": items }).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /revoke analytics for u2/i })).toBeNull()
  })

  it("forgets a failed revoke before the next row's dialog opens", async () => {
    const own = subStubClient({ "consent.list": items }, { "consent.revoke": new Error("nope") })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }))
    fireEvent.click(screen.getByRole("button", { name: /revoke marketing for u1/i }))
    // One command hook serves every row, so without reset() the previous
    // failure follows the operator to the next dialog and reads as this row's.
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("drops the cursor when the purpose filter changes", async () => {
    const own = subStubClient({ "consent.list": { ...items, nextCursor: "c9" } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /next/i }))
    await waitFor(() => expect(own.payloads.at(-1)).toMatchObject({ cursor: "c9" }))
    fireEvent.change(screen.getByLabelText(/purpose/i), { target: { value: "analytics" } })
    await waitFor(() => expect(own.payloads.at(-1)).toMatchObject({ purpose: "analytics" }))
    expect((own.payloads.at(-1) as Record<string, unknown>).cursor).toBeUndefined()
  })
})

describe("ConsentUserSection", () => {
  it("asks the userConsents intent for the user it was given", async () => {
    const own = subStubClient({ "consent.userConsents": items })
    renderSubPage(
      (props: { userId?: string }) => <ConsentUserSection {...props} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { userId: "u1" } },
    )
    await waitFor(() => expect(screen.getByText("marketing")).toBeTruthy())
    expect(own.intents).toEqual(["consent.userConsents"])
    expect(own.payloads[0]).toEqual({ userId: "u1" })
  })

  it("renders nothing at all when the user has no consents", async () => {
    const own = subStubClient({ "consent.userConsents": { items: [] } })
    const { container } = renderSubPage(
      (props: { userId?: string }) => <ConsentUserSection {...props} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { userId: "u1" } },
    )
    await waitFor(() => expect(own.intents).toHaveLength(1))
    // A section on somebody else's page is a guest. An empty card headed
    // "Consent" on every user with no consent records is clutter, not
    // information, and the host page has no way to suppress it.
    expect(container.textContent).toBe("")
  })
})
```

Note the last one. A slot contribution renders inside a host page that cannot
see it and cannot lay out around it, so a contribution with nothing to say
renders nothing rather than an empty box. That is different from a full page,
where an empty state IS the information.

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Write the page, the section, the widget and the declaration**

The page: a `FilterBar` with a debounced user-id search and a purpose select
(All plus whatever purposes are in the current page of results, since there is
no purposes intent), a `ResourceTable<ConsentRecord>` with columns **User**
(`font-mono text-xs`), **Purpose** (`font-medium`), **Status** (`Badge`:
`granted` reads "granted" as `default`, otherwise "revoked" as `destructive`),
**Version** (`font-mono text-xs`, dash with `aria-label="no version"` when
absent), **Granted**, **Revoked** (dash with an `aria-label` when absent), and a
`CursorPager`. Row action Revoke on granted records only, behind a
`ConfirmDialog` with `pending`, `remove.reset()` on open, and its error inside
the dialog.

The user section: `consent.userConsents({ userId })`, columns Purpose, Status,
Version, Granted, Revoked, matching the legacy `user_section.templ`. Returns
`null` when the list is empty.

The widget: the legacy one is a static card reading "Consent / Active" with no
live count. Do not port it. A tile that always says the same thing is furniture.
Contribute a real one instead: `consent.list({ limit: 1 })` is not a count and
there is no counts intent, so the honest answer is to contribute NO overview
widget for consent and say so in the migration notes.

```tsx
export const consentSubPlugin = defineSubPlugin({
  extension: "consent",
  host: "auth",
  label: "Consent",
  nav: [{ label: "Consent", to: "/compliance/consent", group: "Compliance", priority: 0 }],
  routes: [{ path: "/compliance/consent", element: ConsentsPage }],
  hostIntents: [],
  contributions: {
    "user.detail.sections": [{ id: "consent", priority: 30, render: ConsentUserSection }],
  },
})
```

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/consent.tsx packages/plugin-authsome/test/sub/consent.test.tsx
git commit -m "feat(authsome): consent records, revoked by user and purpose" -- packages/plugin-authsome/src/sub/consent.tsx packages/plugin-authsome/test/sub/consent.test.tsx
```

---

### Task 6: Subscription, and the billing it cannot reach

**Files:**
- Create: `packages/plugin-authsome/src/sub/subscription.tsx`
- Test: `packages/plugin-authsome/test/sub/subscription.test.tsx`

**Interfaces:**
- Produces: `subscriptionSubPlugin`, `PlanSummary`, `PlanDetail`, `PlanFeature`, `SubscriptionSummary`, `PlansPage`, `PlanDetailPage`, `SubscriptionOrgTab`, `SubscriptionUserSection`.

**The contract, verified against `plugins/subscription/contract/`. Five intents:**

```ts
// plans.list                 -> { plans: PlanSummary[] }        no input, no paging
// plans.detail({ id })       -> PlanDetail                      PlanSummary + features?
// plans.archive({ id })      -> { ok }
// plans.activate({ id })     -> { ok }
// subscriptions.list({ tenantId })  -> { subscriptions: SubscriptionSummary[] }
interface PlanSummary {
  id: string; name: string; slug: string; description?: string
  currency?: string; status: string; trialDays?: number
}
interface PlanFeature { key: string; name: string; type: string; limit: number; period: string }
interface SubscriptionSummary {
  id: string; tenantId: string; planId: string; status: string
  currentPeriodStart?: string; currentPeriodEnd?: string
}
```

**This task is mostly an exercise in not building things.** The legacy
subscription dashboard is a whole billing product: five nav entries, invoices,
coupons, a feature catalog, subscription lifecycle, plan pricing and tier
editing. Every one of those is an HTMX form post handled directly in
`dashboard.go` and none of them reaches the dispatcher. There are five intents
and two of them are commands.

So `/plans` lists and `/plans/:id` reads, with archive and activate as the only
writes on the page. **Do not build an editor.** A plan detail page with a
pricing form that has nothing to submit to would be worse than not having one.

**`subscriptions.list` requires a `tenantId`** and answers an empty list when
given none, without an error. So a page that forgets the parameter shows "no
subscriptions" and looks correct. That is the failure mode to test for: assert
the org tab sends the org id it was handed, and never renders a list built from
an empty tenant.

**What must be said on screen, not just in a doc.** The plans page carries a
single line pointing at the legacy dashboard for invoices, coupons, features and
subscription changes. An operator who finds Plans in the new dashboard and
concludes billing has moved will go looking for invoices and find nothing.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/subscription.test.tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { subscriptionSubPlugin, SubscriptionOrgTab } from "../../src/sub/subscription"
import { renderSubPage, subStubClient } from "./harness"

const plans = {
  plans: [
    { id: "p1", name: "Pro", slug: "pro", status: "active", currency: "usd", trialDays: 14 },
    { id: "p2", name: "Legacy", slug: "legacy", status: "archived" },
    { id: "p3", name: "Draft", slug: "draft", status: "draft" },
  ],
}
function pageAt(path: string) {
  return subscriptionSubPlugin.routes.find((r) => r.path === path)!.element
}

describe("plans", () => {
  it("colours the three statuses apart", async () => {
    renderSubPage(pageAt("/plans"), { client: subStubClient(plans).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByText("active").getAttribute("data-variant")).toBe("default")
    expect(screen.getByText("draft").getAttribute("data-variant")).toBe("secondary")
    expect(screen.getByText("archived").getAttribute("data-variant")).toBe("outline")
  })

  it("offers archive on active plans and activate on draft ones, and neither on archived", async () => {
    renderSubPage(pageAt("/plans"), { client: subStubClient(plans).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    expect(screen.getByRole("button", { name: /archive pro/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /activate draft/i })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /archive legacy/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /activate legacy/i })).toBeNull()
  })

  it("offers no create, and no editing of any kind", async () => {
    renderSubPage(pageAt("/plans"), { client: subStubClient(plans).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    // There is no plans.create intent, no pricing intent and no feature
    // intent. A form with nothing to submit to is worse than no form.
    expect(screen.queryByRole("button", { name: /create plan/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /add feature/i })).toBeNull()
  })

  it("says where the rest of billing lives", async () => {
    renderSubPage(pageAt("/plans"), { client: subStubClient(plans).client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
    // An operator who finds Plans here and concludes billing has moved will
    // go looking for invoices and find nothing.
    expect(screen.getByText(/invoices, coupons and subscription changes/i)).toBeTruthy()
  })

  it("shows a plan's features read-only", async () => {
    const detail = {
      id: "p1", name: "Pro", slug: "pro", status: "active", currency: "usd",
      features: [{ key: "seats", name: "Seats", type: "seat", limit: 10, period: "monthly" }],
    }
    renderSubPage(pageAt("/plans/:id"), {
      client: subStubClient({ "plans.detail": detail }).client,
      hostClient: subStubClient({}).client, allowed: [], params: { id: "p1" },
    })
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pro" })).toBeTruthy())
    expect(screen.getByText("seats")).toBeTruthy()
    expect(screen.getByText("10")).toBeTruthy()
  })
})

describe("SubscriptionOrgTab", () => {
  it("sends the org id it was handed as the tenant", async () => {
    const own = subStubClient({
      "subscriptions.list": { subscriptions: [{ id: "s1", tenantId: "o1", planId: "p1", status: "active", currentPeriodEnd: "2026-04-01T00:00:00Z" }] },
      "plans.list": plans,
    })
    renderSubPage(
      (props: { orgId?: string }) => <SubscriptionOrgTab {...props} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { orgId: "o1" } },
    )
    await waitFor(() => expect(screen.getByText("active")).toBeTruthy())
    // subscriptions.list answers an EMPTY LIST for an empty tenantId, with no
    // error. A tab that forgets this parameter renders "no subscriptions" and
    // looks entirely correct doing it.
    expect(own.payloads[own.intents.indexOf("subscriptions.list")]).toEqual({ tenantId: "o1" })
  })

  it("renders nothing when it has no org id at all", async () => {
    const own = subStubClient({})
    const { container } = renderSubPage(
      (props: { orgId?: string }) => <SubscriptionOrgTab {...props} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [] },
    )
    // Never send an empty tenantId. The answer would be indistinguishable
    // from a real one.
    expect(own.intents).toEqual([])
    expect(container.textContent).toBe("")
  })

  it("names the plan rather than showing its id", async () => {
    const own = subStubClient({
      "subscriptions.list": { subscriptions: [{ id: "s1", tenantId: "o1", planId: "p1", status: "active" }] },
      "plans.list": plans,
    })
    renderSubPage(
      (props: { orgId?: string }) => <SubscriptionOrgTab {...props} />,
      { client: own.client, hostClient: subStubClient({}).client, allowed: [], params: { orgId: "o1" } },
    )
    // SubscriptionSummary carries planId and no plan name. plans.list is the
    // only way to turn one into the other, and "p1" tells an operator nothing.
    await waitFor(() => expect(screen.getByText("Pro")).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Write the pages, the contributions and the declaration**

Plans list columns: **Name** (`font-medium`, linking to `/@auth/plans/${id}`),
**Slug** (`font-mono text-xs`), **Currency** (uppercased, dash with an
`aria-label` when absent), **Trial** (`` `${trialDays}d` `` or a dash),
**Status** (`Badge`: active `default`, draft `secondary`, archived `outline`).
Row actions: Archive when active, Activate when draft, each behind a
`ConfirmDialog` with `pending`, `reset()` on open and its error inside. Caption
carries the row count. Below the table, the one line about the legacy dashboard.

Plan detail: `plans.detail({ id })` into a `DescriptionList` of Plan ID, Slug,
Currency, Status, Trial days and Description, then a read-only
`ResourceTable<PlanFeature>` of Key (`font-mono text-xs`), Name, Type (a
`Badge`), Limit (the number, or "Unlimited" when it is zero or negative) and
Period. No edit controls anywhere.

Org tab and user section: both read `subscriptions.list({ tenantId })`, both
return `null` without one, and both render Plan (resolved through `plans.list`),
Status and Period end. Match the legacy `org_section.templ`: plan name, status
badge, period end, and a "No active subscription." empty state.

```tsx
export const subscriptionSubPlugin = defineSubPlugin({
  extension: "subscription",
  host: "auth",
  label: "Plans",
  nav: [{ label: "Plans", to: "/plans", group: "Configuration", priority: 2 }],
  routes: [
    { path: "/plans", element: PlansPage },
    { path: "/plans/:id", element: PlanDetailPage },
  ],
  hostIntents: [],
  contributions: {
    "org.detail.tabs": [{ id: "billing", label: "Billing", priority: 10, render: SubscriptionOrgTab }],
    "user.detail.sections": [{ id: "subscription", priority: 20, render: SubscriptionUserSection }],
  },
})
```

The `org.detail.tabs` contribution lands on the organization sub-plugin's detail
page from Task 2. That is one sub-plugin contributing into another sub-plugin's
host slot, which is the arrangement the whole extension point was designed
around, and it is worth confirming by hand once in the running app.

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/subscription.tsx packages/plugin-authsome/test/sub/subscription.test.tsx
git commit -m "feat(authsome): plans, and an honest line about the billing that stayed behind" -- packages/plugin-authsome/src/sub/subscription.tsx packages/plugin-authsome/test/sub/subscription.test.tsx
```

---

### Task 7: Password policy

**Files:**
- Create: `packages/plugin-authsome/src/sub/password.tsx`
- Test: `packages/plugin-authsome/test/sub/password.test.tsx`

**Interfaces:**
- Consumes: `SETTINGS_INTENTS`, `settingsPanelFor` from Task 0.
- Produces: `passwordSubPlugin`, `PasswordPolicy`, `PasswordPolicyPage`.

The smallest of the six, and the only one that mixes its own intent with the
shared settings panel.

```ts
// password.policy -> { minLength: number, requireSpecial: boolean, hashAlgorithm: string }
```

One query, no commands. The actual policy VALUES are written through the auth
contributor's `settings.update`, not through this plugin, so the page is a
read-only summary above the standard settings panel: an admin sees the effective
hash algorithm next to the policy they are editing.

**Two things about `hashAlgorithm`.** It is hardcoded to the literal string
`"argon2id"` server-side and does not read engine config. So label it "as
compiled" rather than "in effect", because presenting a constant as a live
reading is the kind of thing somebody makes a decision on.

**The legacy page shows an allowed-domains list that the intent does not
return.** It comes straight from settings in the templ render path. So it is
either read from the settings namespace or not shown at all. Read it from the
namespace: this sub-plugin already declares the settings host intents for its
panel, so nothing widens.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/plugin-authsome/test/sub/password.test.tsx
import { describe, expect, it } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { passwordSubPlugin } from "../../src/sub/password"
import { renderSubPage, subStubClient } from "./harness"

const page = passwordSubPlugin.routes[0].element

describe("password policy", () => {
  it("shows the policy from its own contributor and the panel from the host", async () => {
    const own = subStubClient({ "password.policy": { minLength: 12, requireSpecial: true, hashAlgorithm: "argon2id" } })
    const host = subStubClient({
      "settings.namespace": {
        namespace: "password", scope: "app",
        categories: [{ name: "Strength", settings: [{
          key: "min_length", displayName: "Minimum length", type: "int",
          effectiveValue: 12, isOverridden: true, isEnforced: false, canOverride: true, order: 1,
        }] }],
      },
    })
    renderSubPage(page, { client: own.client, hostClient: host.client, allowed: passwordSubPlugin.hostIntents })

    await waitFor(() => expect(screen.getByText("argon2id")).toBeTruthy())
    // Two clients on one page: password.policy is this sub-plugin's own, and
    // settings.namespace belongs to auth and is reached through hostIntents.
    expect(own.intents).toEqual(["password.policy"])
    expect(host.intents).toEqual(["settings.namespace"])
    await waitFor(() => expect(screen.getByText("Minimum length")).toBeTruthy())
  })

  it("labels the hash algorithm as compiled rather than as a live reading", async () => {
    const own = subStubClient({ "password.policy": { minLength: 12, requireSpecial: true, hashAlgorithm: "argon2id" } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: passwordSubPlugin.hostIntents })
    await waitFor(() => expect(screen.getByText("argon2id")).toBeTruthy())
    // The server hardcodes this and never reads engine config. Presenting a
    // constant as a live reading is how somebody ends up deciding on it.
    expect(screen.getByText(/as compiled/i)).toBeTruthy()
  })

  it("says engine default rather than zero when no minimum is set", async () => {
    const own = subStubClient({ "password.policy": { minLength: 0, requireSpecial: false, hashAlgorithm: "argon2id" } })
    renderSubPage(page, { client: own.client, hostClient: subStubClient({}).client, allowed: passwordSubPlugin.hostIntents })
    // "0 characters" reads as a policy allowing empty passwords. It is not one.
    await waitFor(() => expect(screen.getByText(/engine default/i)).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run and confirm they fail**

- [ ] **Step 3: Write the page and the declaration**

```tsx
export const passwordSubPlugin = defineSubPlugin({
  extension: "password",
  host: "auth",
  label: "Password",
  nav: [{ label: "Password", to: "/auth/password", group: "Auth", priority: 0 }],
  routes: [{ path: "/auth/password", element: PasswordPolicyPage }],
  // Its own policy read needs nothing from the host. The panel below it does.
  hostIntents: [...SETTINGS_INTENTS],
  contributions: {
    "settings.tabs": [{ id: "password", label: "Password", render: settingsPanelFor("password") }],
  },
})
```

`PasswordPolicyPage` renders a `DescriptionList` of Minimum length ("`N`
characters" or "Engine default"), Require special character (a `Badge` reading
Required or Optional) and Hash algorithm (the value with "as compiled" beside
it), then the shared settings panel underneath. Bind the panel once at module
scope and use the same instance for the tab, exactly as Task 1 does.

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/password.tsx packages/plugin-authsome/test/sub/password.test.tsx
git commit -m "feat(authsome): the password policy, above the settings that set it" -- packages/plugin-authsome/src/sub/password.tsx packages/plugin-authsome/test/sub/password.test.tsx
```

---

### Task 8: Overview widgets, and wiring every sub-plugin in

**Files:**
- Modify: `packages/plugin-authsome/src/sub/organization.tsx` (add its widget)
- Create: `packages/plugin-authsome/src/sub/index.ts`
- Modify: `packages/plugin-authsome/src/index.tsx`
- Test: `packages/plugin-authsome/test/sub/index.test.tsx`

**Interfaces:**
- Produces: `authsomeSubPlugins: ForgeSubPlugin[]`, re-exported from the package root.

#### The widgets, and the ones that are not worth building

The legacy dashboard has an overview widget per plugin. Most of them are static
cards. Going through them honestly:

| widget | what the templ card actually does | decision |
|---|---|---|
| organization | a count of organizations | **build it.** `orgs.list` answers the whole array, so its length IS the count |
| waitlist | pending count | **built in Task 4** from `waitlist.counts` |
| apikey | a card reading "API Keys / Active", no number | skip |
| consent | a card reading "Consent / Active", no number | skip |
| mfa, passkey, oauth2provider | static cards with no parameters | skip |
| subscription | active, trialing and past-due counts computed server-side | skip: `subscriptions.list` needs a `tenantId` and there is no app-wide count |
| social, sso | a count of configured providers, from settings | skip for now, see below |

Skipping is the decision, not an omission. A tile that always says the same
thing is furniture, and an overview made mostly of furniture is worse than a
short one. The social and sso provider counts are reachable through the settings
namespace these sub-plugins already read, but only if the provider list is a
settings field. Check the namespace response before building either, and if it
is not there, say so in the migration notes rather than inventing a number.

- [ ] **Step 1: Write the failing test for the org widget**

```tsx
// in packages/plugin-authsome/test/sub/organization.test.tsx
describe("OrgCountWidget", () => {
  it("counts the organizations the list intent answered", async () => {
    const own = subStubClient(orgs)
    renderSubPage(OrgCountWidget, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    await waitFor(() => expect(screen.getByText("2")).toBeTruthy())
    expect(screen.getByText(/organizations/i)).toBeTruthy()
    // Same intent the list page reads, same params, so the store serves both
    // from one request. That is the query store working, not a coincidence
    // worth avoiding.
    expect(own.intents).toEqual(["orgs.list"])
  })

  it("shows nothing rather than a zero while the count is loading", () => {
    const own = subStubClient(orgs)
    renderSubPage(OrgCountWidget, { client: own.client, hostClient: subStubClient({}).client, allowed: [] })
    // A widget that renders 0 before its data arrives tells an operator
    // something false for as long as the request takes.
    expect(screen.queryByText("0")).toBeNull()
  })
})
```

Add `OrgCountWidget` to the organization sub-plugin's `overview.widgets`
contributions with `priority: 10`.

- [ ] **Step 2: Write the barrel**

```ts
// packages/plugin-authsome/src/sub/index.ts
import type { ForgeSubPlugin } from "@forge-go/dashboard-plugin"
import { organizationSubPlugin } from "./organization"
import { apikeySubPlugin } from "./apikey"
import { waitlistSubPlugin } from "./waitlist"
import { consentSubPlugin } from "./consent"
import { subscriptionSubPlugin } from "./subscription"
import { passwordSubPlugin } from "./password"
import { settingsOnlySubPlugins } from "./settings-only"

export {
  organizationSubPlugin, apikeySubPlugin, waitlistSubPlugin,
  consentSubPlugin, subscriptionSubPlugin, passwordSubPlugin,
  settingsOnlySubPlugins,
}

/**
 * Every first-party authsome sub-plugin.
 *
 * Order does not decide anything. Nav sorts by group then priority, slot
 * contributions sort by priority then id, and routes are keyed by path. This
 * array is just the set, and it is ordered by hand for readability rather than
 * by any rule a reader has to learn.
 */
export const authsomeSubPlugins: ForgeSubPlugin[] = [
  organizationSubPlugin,
  apikeySubPlugin,
  waitlistSubPlugin,
  consentSubPlugin,
  subscriptionSubPlugin,
  passwordSubPlugin,
  ...settingsOnlySubPlugins,
]
```

Re-export `authsomeSubPlugins` from `src/index.tsx`, next to `authsomePlugin`.

- [ ] **Step 3: Write the wiring test**

```tsx
// packages/plugin-authsome/test/sub/index.test.tsx
import { describe, expect, it } from "vitest"
import { authsomeSubPlugins } from "../../src/sub"

describe("authsomeSubPlugins", () => {
  it("is all twenty-four", () => {
    expect(authsomeSubPlugins).toHaveLength(24)
  })

  it("declares every route exactly once across the whole set", () => {
    const paths = authsomeSubPlugins.flatMap((s) => s.routes.map((r) => r.path))
    const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i)
    // Two sub-plugins claiming one path is decided by the host's collision
    // rule, which drops one of them along with its nav entry. That is a
    // correct recovery from a mistake, not a design, and it should never fire
    // for first-party plugins.
    expect(duplicates).toEqual([])
  })

  it("declares every nav target exactly once", () => {
    const targets = authsomeSubPlugins.flatMap((s) => s.nav.map((n) => n.to))
    const duplicates = targets.filter((t, i) => targets.indexOf(t) !== i)
    expect(duplicates).toEqual([])
  })

  it("mounts every one inside auth", () => {
    for (const sub of authsomeSubPlugins) expect(sub.host).toBe("auth")
  })

  it("gives every nav item a route to land on", () => {
    for (const sub of authsomeSubPlugins) {
      const paths = new Set(sub.routes.map((r) => r.path))
      for (const item of sub.nav) {
        // A nav entry pointing at a path nobody declared is a link to the
        // host's fallback, and it looks exactly like a broken page.
        expect(paths.has(item.to)).toBe(true)
      }
    }
  })

  it("declares host intents only where a sub-plugin actually reads the host", () => {
    for (const sub of authsomeSubPlugins) {
      for (const intent of sub.hostIntents) {
        // The allowlist is the whole scoping guarantee. Anything outside the
        // settings four is a sub-plugin reaching into auth for something else.
        expect(intent.startsWith("settings.")).toBe(true)
      }
    }
  })

  it("uses a slot name the platform knows for every contribution", () => {
    const known = new Set([
      "overview.widgets", "user.detail.sections", "org.detail.sections",
      "org.detail.tabs", "org.create.fields", "settings.tabs",
    ])
    for (const sub of authsomeSubPlugins) {
      for (const slot of Object.keys(sub.contributions)) {
        // defineSubPlugin already throws on an unknown slot at import time.
        // This asserts the set itself has not drifted from the platform's.
        expect(known.has(slot)).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 4: Run the tests and typecheck**

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/src/sub/index.ts packages/plugin-authsome/src/sub/organization.tsx packages/plugin-authsome/src/index.tsx packages/plugin-authsome/test/sub/index.test.tsx packages/plugin-authsome/test/sub/organization.test.tsx
git commit -m "feat(authsome): export all twenty-four sub-plugins, and the two widgets worth having" -- packages/plugin-authsome/src/sub packages/plugin-authsome/src/index.tsx packages/plugin-authsome/test/sub
```

---

### Task 9: The three tests that matter more than the rest

**Files:**
- Test: `packages/plugin-authsome/test/sub/isolation.test.tsx`

No source changes. If any of these three fails, the fix is in the sub-plugin
that broke it, not here.

The spec names three properties as mattering more than the per-sub-plugin
suites, and every one of them is a property of the SET rather than of any member
of it. That is why they live in their own file: a per-sub-plugin test cannot see
a leak between two of them.

**A vacuous test is worse than no test here.** One of the platform's own
isolation tests was found to assert that a string never rendered by anything was
absent from the screen, which passes forever and proves nothing. Every assertion
below has to fail if the property breaks. Check that by breaking it on purpose
once, locally, before you commit.

- [ ] **Step 1: A sub-plugin's query carries its own contributor**

```tsx
it("queries under its own extension, never its host's", async () => {
  const own = subStubClient({ "orgs.list": { organizations: [{ id: "o1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z" }] } })
  const host = subStubClient({ "orgs.list": { organizations: [{ id: "x", name: "WRONG", slug: "wrong", createdAt: "2026-01-01T00:00:00Z" }] } })

  renderSubPage(organizationSubPlugin.routes[0].element, {
    client: own.client, hostClient: host.client, allowed: [],
  })

  // Both stubs answer orgs.list, and they answer DIFFERENTLY. If the page
  // reached through the host client it would render "WRONG" and every other
  // assertion in this file would still pass.
  await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
  expect(screen.queryByText("WRONG")).toBeNull()
  expect(host.intents).toEqual([])
})
```

The two stubs answering the same intent with different data is the whole design
of this test. A stub that answers nothing on the host side would let a page
reaching the wrong way fail with an error, which is a different bug and an
easier one.

- [ ] **Step 2: A host intent outside the allowlist throws at render**

```tsx
it("throws when a sub-plugin reaches a host intent it did not declare", () => {
  function Overreacher() {
    // users.list belongs to auth. A settings-only sub-plugin declaring the
    // four settings intents must not be able to reach it through its host.
    useHostQuery("users.list")
    return <p>should never render</p>
  }

  expect(() =>
    renderSubPage(Overreacher, {
      client: subStubClient({}).client,
      hostClient: subStubClient({ "users.list": { users: [] } }).client,
      allowed: [...SETTINGS_INTENTS],
    }),
  ).toThrow(/users\.list/)

  // And the component genuinely did not render, rather than throwing after
  // painting something.
  expect(screen.queryByText("should never render")).toBeNull()
})
```

Note the second assertion. Without it this test passes if the hook throws on the
request instead of during render, which is a materially different behaviour: an
overreaching sub-plugin would paint its UI, send the request and then fail.

- [ ] **Step 3: One sub-plugin throwing loses only its own slot entry**

```tsx
it("loses only the contribution that threw", async () => {
  function Boom(): never { throw new Error("contribution exploded") }
  function Fine() { return <p>sibling survived</p> }

  const entries = [
    { subPlugin: fakeSub("alpha", { "user.detail.sections": [{ id: "a", render: Boom }] }), client, hostClient },
    { subPlugin: fakeSub("beta", { "user.detail.sections": [{ id: "b", render: Fine }] }), client, hostClient },
  ]

  render(
    <SubPluginProvider entries={entries}>
      <h1>host page</h1>
      <PluginSlot name="user.detail.sections" params={{ userId: "u1" }} />
    </SubPluginProvider>,
  )

  // Three separate claims, and the middle one is the one that usually breaks:
  // an unkeyed boundary swallows the whole slot.
  expect(screen.getByRole("heading", { name: "host page" })).toBeTruthy()
  expect(screen.getByText("sibling survived")).toBeTruthy()
  expect(screen.getByText(/alpha/)).toBeTruthy()   // the boundary names it
})
```

Write `fakeSub(extension, contributions)` as a small local helper calling
`defineSubPlugin` with `host: "auth"`. Do not reach for a real sub-plugin here:
this test is about the slot machinery and a real one would couple it to whatever
that sub-plugin happens to render this month.

Silence React's error logging for this one test only. A boundary catching a
deliberate throw prints a stack that reads like a failure in an otherwise green
run, and somebody will eventually spend twenty minutes on it.

- [ ] **Step 4: Break each property on purpose and watch the test fail**

This is a step, not a suggestion. For each of the three:
1. Change the source so the property no longer holds (point the page at the host
   client; widen the allowlist to everything; drop the key off the boundary).
2. Run the test and confirm it FAILS, with a message that points at the right
   thing.
3. Revert.

Three tests that pass against broken code are three tests that will be trusted
and should not be.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-authsome/test/sub/isolation.test.tsx
git commit -m "test(authsome): pin the three properties that hold the sub-plugins apart" -- packages/plugin-authsome/test/sub/isolation.test.tsx
```

---

### Task 10: Verify the set, and write down what stayed behind

**Files:**
- Create: `docs/superpowers/plans/2026-09-09-authsome-migration-notes.md`
- Test: whole-package and whole-workspace runs

No new features. This task is the difference between "the code is written" and
"the legacy dashboard can be retired", and those are not the same claim.

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @forge-go/dashboard-plugin-authsome test
pnpm --filter @forge-go/dashboard-plugin-authsome typecheck
pnpm -r typecheck
pnpm -r test
```

All green. Record the test count.

- [ ] **Step 2: Check every intent the package uses against the manifests**

Take every intent string in `src/`, and check each against the contributor that
should answer it. The exact-name check catches typos that no test finds, because
a page querying a misspelled intent renders an error state and a test asserting
"shows an error when the server fails" passes.

```bash
grep -rhoE '"(orgs|apikeys|waitlist|consent|plans|subscriptions|password|settings)\.[a-zA-Z]+"' \
  packages/plugin-authsome/src | sort -u
```

Every line must appear in the contract reference at
`.superpowers/sdd/authsome-subplugins-contract.md`, and nothing may appear that
belongs to a contributor other than the one querying it. `settings.*` appears
only inside `sub/settings-panel.tsx` and only through `useHostQuery` or
`useHostCommand`; anywhere else it is a scoping breach.

- [ ] **Step 3: Mount the whole set in the playground and look at it**

Run the playground against the fixture server and click through. Automated tests
do not catch a nav group with one item in it, an org detail tab strip that wraps,
or a settings panel whose fields are all enforced and therefore all disabled with
no explanation of why.

Specifically confirm by hand, because none of this is unit-testable:
- the six data sub-plugins appear under Identity, Security, Compliance and Configuration, and the eighteen under Security, Auth, Enterprise and Configuration
- the subscription Billing tab renders inside the organization detail page, which is one sub-plugin contributing into another sub-plugin's host slot
- turning a contributor off in the capabilities fixture removes its nav entry, its route AND its settings tab together
- the settings index page lists namespaces AND shows the contributed tabs below

- [ ] **Step 4: Re-measure the bundle**

The kit consumer notes require this at the first page that statically imports
`ConfirmDialog` or `SettingsForm`, and this package now does both many times
over. Run `pnpm build`, compare the eager entry set against `BASELINE.md`, and
write the new number in whichever way it goes.

- [ ] **Step 5: Write the migration notes**

`docs/superpowers/plans/2026-09-09-authsome-migration-notes.md`, and it has one
job: somebody deciding whether to switch the templ dashboard off can read it and
know what they lose. Written for that reader, not for us.

It must contain, each with the reason and not just the fact:

- **The fourteen blocked surfaces** from the spec, grouped by how much Go work
  each needs. Say plainly that SCIM directory management and subscription
  billing stay in the templ dashboard, because those two are the reason this is
  not yet a clean retirement.
- **The three surfaces that are cheap**: organization invitations and member
  role changes are already implemented in `organization/service.go` and only
  need dispatcher registration; the three per-user sections (MFA factors,
  passkeys, linked social accounts) are one query each.
- **What this dashboard has that the legacy one does not**: an app-wide consent
  list, a waitlist delete and approval notes, and a settings panel over every
  namespace rather than a hand-written panel per plugin.
- **The nav divergences.** The legacy `dashboard.go` puts organization and
  waitlist under "Authentication" and apikey under "Developer" at `/api-keys`
  with a hyphen. The manifests say Identity, Compliance and `/apikeys`. Anyone
  going by muscle memory will look in the wrong place, and one of the paths is
  genuinely different.
- **The stat rows that did not survive.** The legacy organization list shows
  Organizations, Members, Teams and Invitations computed in-process. Only the
  first is reachable. Say so rather than letting somebody notice.
- **`hashAlgorithm` is a constant**, not a live reading.
- **There is no reset-to-default anywhere in settings**, and why: `settings.update`
  passes its value to `Manager.Set` unchanged, so null stores null, and the
  intent that would clear an override is not exposed.

Run the draft through the `rex-voice` skill and then `humanizer` in embedded
mode, as the repository's CLAUDE.md requires for prose that ships. No em dashes.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-09-09-authsome-migration-notes.md
git commit -m "docs: what the react dashboard covers, and what stays in templ" -- docs/superpowers/plans/2026-09-09-authsome-migration-notes.md
```

---

## Self-review

Checked against the spec at
`docs/superpowers/specs/2026-09-08-authsome-subplugins-design.md`, after the
spec was itself corrected against the Go source.

**Coverage.** Twenty-four sub-plugins: eighteen in Task 1, six in Tasks 2 to 7.
Every slot the spec names has a contributor: `overview.widgets` (Tasks 4 and 8),
`user.detail.sections` (Tasks 5 and 6), `org.detail.tabs` (Task 6),
`settings.tabs` (Tasks 1 and 7), and `org.detail.sections` plus
`org.create.fields` are HOSTED by Task 2. The three cross-cutting tests the spec
asks for are Task 9. The blocked list is Task 10.

**One slot has no first-party contributor**: `org.detail.sections`. The
organization page hosts it and nothing fills it, which is correct rather than
missing. The sso org section would have filled it and `sso` declares no intents.
Task 2's page must therefore render that slot without drawing an empty heading,
which `useSlotCount` is for, and Task 2 says so.

**Two things the spec asked for that this plan deliberately does not build**,
both recorded in Task 10's notes: the apikey user section, because
`apikeys.list` has nothing to filter on, and an overview widget for four of the
six, because the legacy cards carry no data.

**Type consistency.** `AckResponse` comes from the core plugin's `users.tsx`.
`flattenCategories`, `toDescriptors`, `SettingField` and
`SettingsNamespaceResponse` come from the core's `settings-fields.ts` and are
named identically in both plans. `CursorPager` and `useCursorStack` come from
`src/components/cursor-pager.tsx`. `settingsPanelFor` and `SETTINGS_INTENTS` are
defined in Task 0 and consumed in Tasks 1 and 7 under those exact names.

**Ordering.** Task 0 blocks on authsome core Task 8. Everything else in this
plan blocks on Task 0. Tasks 2 through 7 are independent of each other and can
run in parallel; Task 8 needs all of them; Tasks 9 and 10 need Task 8.
