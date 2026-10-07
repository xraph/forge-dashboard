import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, useNavigationType } from "react-router"
import { ForgeDashboardProvider, SessionProvider } from "@forge-go/dashboard-runtime"
import { PluginLink, definePlugin, queryStore, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { ContextDimension, ForgePlugin } from "@forge-go/dashboard-plugin"
import { PluginHost } from "../src/host/PluginHost"
import { contextSearch, withContext } from "../src/host/context-search"

window.matchMedia ??= ((query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener: () => {}, removeEventListener: () => {},
  addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const config = { basePath: "/dashboard" }

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response
}

const envDimension: ContextDimension = {
  id: "environment",
  label: "Environment",
  query: "apps.context",
  switchCommand: "environments.switch",
  select: (data) => {
    const d = data as { currentEnv?: { id: string; name: string; slug: string }; availableEnvs: { id: string; name: string; slug: string }[] }
    return {
      current: d.currentEnv ? { id: d.currentEnv.id, label: d.currentEnv.name, slug: d.currentEnv.slug } : undefined,
      options: d.availableEnvs.map((e) => ({ id: e.id, label: e.name, slug: e.slug })),
    }
  },
  payload: (envId) => ({ envId }),
  routed: { placement: "query", param: "env", by: "slug" },
}

/** Where a navigation landed, and whether it pushed an entry or replaced one. */
function AuditPage() {
  return <p>audit page, arrived by {useNavigationType()}</p>
}

/**
 * A page holding its own filter in the query, the shape keysmith's key list
 * has: `?keyId=` narrows this page and means nothing anywhere else.
 */
function KeysPage() {
  const navigateTo = useNavigateTo()
  return (
    <div>
      <PluginLink to="/audit">Open audit</PluginLink>
      <PluginLink to="/audit?page=2">Audit page two</PluginLink>
      <PluginLink to="/audit?env=dev">Audit in dev</PluginLink>
      <button onClick={() => navigateTo("/audit", { replace: true })}>Replace to audit</button>
      <button onClick={() => navigateTo("/audit")}>Push to audit</button>
    </div>
  )
}

function pluginFor(extension: string, context: ContextDimension[] = []): ForgePlugin {
  return definePlugin({
    extension,
    namespace: extension,
    label: extension,
    nav: [
      { label: "Keys", to: "/keys" },
      { label: "Audit", to: "/audit" },
    ],
    routes: [
      { path: "/keys", element: KeysPage },
      { path: "/audit", element: AuditPage },
    ],
    context,
  })
}

function fetchFor(extensions: string[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/principal")) {
      return jsonOk({ authenticated: true, subject: "usr_test", email: "t@example.com" })
    }
    if (url.endsWith("/capabilities")) {
      return jsonOk({
        shellEnvelopes: ["v1"],
        contributors: extensions.map((name) => ({ name, envelopes: ["v1"], configured: true })),
      })
    }
    if (url.endsWith("/csrf")) return jsonOk({ token: "t" })
    const body = JSON.parse(String(init?.body ?? "{}")) as { intent?: string }
    if (body.intent === "apps.context") {
      const prod = { id: "env_prod", name: "Production", slug: "prod" }
      const dev = { id: "env_dev", name: "Development", slug: "dev" }
      return jsonOk({ ok: true, data: { currentEnv: prod, availableEnvs: [prod, dev] } })
    }
    throw new Error(`unexpected request to ${url} (${body.intent ?? "no intent"})`)
  }) as unknown as typeof fetch
}

function renderAt(plugins: ForgePlugin[], path: string) {
  queryStore.clear()
  const fetchImpl = fetchFor(plugins.map((p) => p.extension))
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ForgeDashboardProvider config={config}>
        <SessionProvider fetchImpl={fetchImpl}>
          <PluginHost plugins={plugins} fetchImpl={fetchImpl} />
        </SessionProvider>
      </ForgeDashboardProvider>
    </MemoryRouter>,
  )
}

/** Every href the sidebar renders for one nav label. */
async function sidebarHrefs(label: string): Promise<string[]> {
  const links = await screen.findAllByRole("link", { name: label })
  return links.map((link) => link.getAttribute("href") ?? "")
}

describe("withContext", () => {
  it("merges into a query the path already has instead of starting a second one", () => {
    // The bug: "/x?a=1" + "?b=2" was "/x?a=1?b=2", whose `a` reads as "1?b=2".
    expect(withContext("/x?a=1", "?b=2")).toBe("/x?a=1&b=2")
  })

  it("lets the path's own params win and fills only the keys it leaves unset", () => {
    expect(withContext("/x?env=dev", "?env=prod")).toBe("/x?env=dev")
    expect(withContext("/x?env=dev", "?env=prod&tenant=t1")).toBe("/x?env=dev&tenant=t1")
  })

  it("keeps the fragment last and the path untouched when there is nothing to carry", () => {
    expect(withContext("/x#top", "?env=prod")).toBe("/x?env=prod#top")
    expect(withContext("/x?a=1#top", "?env=prod")).toBe("/x?a=1&env=prod#top")
    expect(withContext("/x?a=b%20c", "")).toBe("/x?a=b%20c")
  })
})

describe("contextSearch", () => {
  it("keeps only the keys a plugin routes into the query", () => {
    expect(contextSearch("?keyId=k1&env=prod", pluginFor("auth", [envDimension]))).toBe("?env=prod")
  })

  it("is empty for a plugin that routes nothing into the query", () => {
    expect(contextSearch("?keyId=k1&env=prod", pluginFor("keys"))).toBe("")
    expect(contextSearch("?keyId=k1", undefined)).toBe("")
  })
})

describe("a page's own query param", () => {
  it("does not follow a sidebar link or a resolved link to another page", async () => {
    renderAt([pluginFor("keys")], "/@keys/keys?keyId=k1")

    await screen.findByRole("link", { name: "Open audit" })
    for (const href of await sidebarHrefs("Audit")) {
      expect(href).toBe("/@keys/audit")
    }
    expect(screen.getByRole("link", { name: "Open audit" }).getAttribute("href")).toBe("/@keys/audit")
    expect(screen.getByRole("link", { name: "Audit page two" }).getAttribute("href")).toBe(
      "/@keys/audit?page=2",
    )
  })
})

describe("a declared context param", () => {
  it("follows sidebar links and resolved links, without the page's own params", async () => {
    renderAt([pluginFor("auth", [envDimension])], "/@auth/keys?keyId=k1&env=prod")

    await screen.findByRole("link", { name: "Open audit" })
    for (const href of await sidebarHrefs("Audit")) {
      expect(href).toBe("/@auth/audit?env=prod")
    }
    expect(screen.getByRole("link", { name: "Open audit" }).getAttribute("href")).toBe(
      "/@auth/audit?env=prod",
    )
    // Merged into the link's own query rather than glued on as a second one.
    expect(screen.getByRole("link", { name: "Audit page two" }).getAttribute("href")).toBe(
      "/@auth/audit?page=2&env=prod",
    )
    // A link that names its own environment means that environment.
    expect(screen.getByRole("link", { name: "Audit in dev" }).getAttribute("href")).toBe(
      "/@auth/audit?env=dev",
    )
  })

  it("does not follow a switch to a scope that never declared it", async () => {
    renderAt([pluginFor("auth", [envDimension]), pluginFor("keys")], "/@auth/keys?keyId=k1&env=prod")

    await screen.findByRole("link", { name: "Open audit" })
    fireEvent.click(screen.getByRole("button", { name: /search pages/i }))
    const entry = await screen.findByRole("link", { name: /^keys\s*Applications$/ })
    expect(entry.getAttribute("href")).toBe("/@keys/keys")
  })
})

describe("useNavigateTo inside the host", () => {
  it("replaces the current entry when asked to", async () => {
    renderAt([pluginFor("keys")], "/@keys/keys?keyId=k1")

    fireEvent.click(await screen.findByRole("button", { name: "Replace to audit" }))
    await waitFor(() => expect(screen.getByText("audit page, arrived by REPLACE")).toBeTruthy())
  })

  it("still pushes for a one-argument call", async () => {
    renderAt([pluginFor("keys")], "/@keys/keys?keyId=k1")

    fireEvent.click(await screen.findByRole("button", { name: "Push to audit" }))
    await waitFor(() => expect(screen.getByText("audit page, arrived by PUSH")).toBeTruthy())
  })
})
