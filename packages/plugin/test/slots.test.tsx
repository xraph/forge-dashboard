import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { defineSubPlugin } from "../src/subplugin"
import {
  HostAccessProvider,
  PluginSlot,
  SubPluginProvider,
  useSlotCount,
} from "../src/slots"
import { usePluginClient } from "../src/context"
import { useHostQuery } from "../src/hooks"
import type { ScopedClient } from "../src/client"

function client(extension: string): ScopedClient {
  return {
    extension,
    // Generic to match ScopedClient. A non-generic `Promise.resolve({})`
    // fails tsc even though vitest never typechecks it, so the suite would
    // pass while `pnpm typecheck` broke.
    query: <T,>() => Promise.resolve({} as T),
    command: <T,>() => Promise.resolve({} as T),
  }
}

function entry(sub: ReturnType<typeof defineSubPlugin>) {
  return { subPlugin: sub, client: client(sub.extension), hostClient: client(sub.host) }
}

const Widget = () => <p>org count</p>

describe("PluginSlot", () => {
  it("renders nothing, and no wrapper, when nobody contributes", () => {
    const { container } = render(
      <SubPluginProvider entries={[]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders a contribution from a sub-plugin", () => {
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Widget }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(screen.getByText("org count")).toBeTruthy()
  })

  it("passes slot params to the contribution", () => {
    const Section = ({ userId }: { userId?: string }) => <p>user {userId}</p>
    const sub = defineSubPlugin({
      extension: "mfa",
      host: "auth",
      contributions: { "user.detail.sections": [{ id: "factors", render: Section }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="user.detail.sections" params={{ userId: "u1" }} />
      </SubPluginProvider>,
    )
    expect(screen.getByText("user u1")).toBeTruthy()
  })

  it("gives each contribution its own extension's client, not the host's", () => {
    const Probe = () => <p>{usePluginClient().extension}</p>
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Probe }] },
    })
    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(screen.getByText("organization")).toBeTruthy()
  })

  it("orders by priority, then by id so ties are stable", () => {
    const A = () => <p>a</p>
    const B = () => <p>b</p>
    const C = () => <p>c</p>
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: {
        "overview.widgets": [
          { id: "zeta", priority: 10, render: C },
          { id: "alpha", priority: 10, render: A },
          { id: "first", priority: 1, render: B },
        ],
      },
    })
    const { container } = render(
      <SubPluginProvider entries={[entry(sub)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    expect(container.textContent).toBe("bac")
  })

  it("loses only the throwing contribution, keeping its siblings on screen", () => {
    const Boom = () => {
      throw new Error("sub-plugin exploded")
    }
    const Fine = () => <p>still here</p>
    const bad = defineSubPlugin({
      extension: "broken",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "boom", render: Boom }] },
    })
    const good = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "ok", render: Fine }] },
    })

    // React logs the caught error. Silence it so the run stays readable.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <SubPluginProvider entries={[entry(bad), entry(good)]}>
        <PluginSlot name="overview.widgets" />
      </SubPluginProvider>,
    )
    spy.mockRestore()

    expect(screen.getByText("still here")).toBeTruthy()
  })

  it("lets a contribution read a host intent it declared", async () => {
    const hostQuery = vi.fn().mockResolvedValue({ fields: [] })
    const Panel = () => {
      const { data, loading } = useHostQuery<{ fields: unknown[] }>("settings.namespace")
      if (loading) return <p>loading</p>
      return <p>fields {data?.fields.length}</p>
    }
    const sub = defineSubPlugin({
      extension: "mfa",
      host: "auth",
      hostIntents: ["settings.namespace"],
      contributions: { "settings.tabs": [{ id: "mfa", render: Panel }] },
    })

    render(
      <SubPluginProvider
        entries={[
          {
            subPlugin: sub,
            client: client("mfa"),
            hostClient: { extension: "auth", query: hostQuery, command: vi.fn() },
          },
        ]}
      >
        <PluginSlot name="settings.tabs" />
      </SubPluginProvider>,
    )

    await waitFor(() => expect(screen.getByText("fields 0")).toBeTruthy())
    expect(hostQuery).toHaveBeenCalled()
  })

  it("gives each contribution its own allowlist rather than an ambient one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const Probe = () => {
      useHostQuery("users.list")
      return <p>panel rendered</p>
    }
    const sub = defineSubPlugin({
      extension: "mfa",
      host: "auth",
      hostIntents: ["settings.namespace"],
      contributions: { "settings.tabs": [{ id: "mfa", render: Probe }] },
    })

    // The ambient provider's allowlist is WIDER and would permit this read.
    // The contribution must still be held to its own declaration.
    render(
      <HostAccessProvider
        value={{ client: client("auth"), allowed: ["users.list"], subExtension: "other" }}
      >
        <SubPluginProvider
          entries={[{ subPlugin: sub, client: client("mfa"), hostClient: client("auth") }]}
        >
          <PluginSlot name="settings.tabs" />
        </SubPluginProvider>
      </HostAccessProvider>,
    )

    // If the ambient allowlist won, the hook would not throw and this would
    // render. Its absence is the whole assertion.
    expect(screen.queryByText("panel rendered")).toBeNull()
    // And the contribution's own boundary caught it, rather than the throw
    // escaping to blank the tree.
    expect(screen.getByText(/failed to render: mfa/)).toBeTruthy()
    // Failed for the right reason, not any reason.
    const logged = spy.mock.calls.flat().map(String).join(" ")
    expect(logged).toContain("mfa")
    spy.mockRestore()
  })
})

describe("useSlotCount", () => {
  it("counts what would render so a page can decide about its heading", () => {
    const sub = defineSubPlugin({
      extension: "organization",
      host: "auth",
      contributions: { "overview.widgets": [{ id: "count", render: Widget }] },
    })
    const Probe = () => <p>count {useSlotCount("overview.widgets")}</p>

    render(
      <SubPluginProvider entries={[entry(sub)]}>
        <Probe />
      </SubPluginProvider>,
    )
    expect(screen.getByText("count 1")).toBeTruthy()
  })

  it("counts zero outside any provider, so a host page renders standalone", () => {
    const Probe = () => <p>count {useSlotCount("overview.widgets")}</p>
    render(<Probe />)
    expect(screen.getByText("count 0")).toBeTruthy()
  })
})
