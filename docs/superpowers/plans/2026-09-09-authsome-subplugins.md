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
- **Kit consumer obligations** live in `docs/superpowers/plans/2026-09-08-kit-blocks-consumer-notes.md`. The two that bite here: pass `pending` to every `ConfirmDialog`, and remount `SettingsForm` with a `key` when its data changes.
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
