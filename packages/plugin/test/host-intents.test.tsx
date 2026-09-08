import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { defineSubPlugin } from "../src/subplugin"
import { HostAccessProvider } from "../src/slots"
import { PluginProvider } from "../src/context"
import { useHostQuery } from "../src/hooks"
import { queryStore } from "../src/store"
import type { ScopedClient } from "../src/client"

const SETTINGS = ["settings.namespace", "settings.update"]

function hostClient(query = vi.fn().mockResolvedValue({ fields: [] })): ScopedClient {
  return { extension: "auth", query, command: vi.fn().mockResolvedValue({ ok: true }) }
}

function renderIn(intent: string, allowed: string[], client = hostClient()) {
  const Probe = () => {
    const { data, error, loading } = useHostQuery<{ fields: unknown[] }>(intent)
    if (loading) return <p>loading</p>
    if (error) return <p>error</p>
    return <p>fields {data?.fields.length}</p>
  }
  return render(
    <HostAccessProvider value={{ client, allowed, subExtension: "mfa" }}>
      <Probe />
    </HostAccessProvider>,
  )
}

describe("useHostQuery", () => {
  it("reads a host intent the sub-plugin declared", async () => {
    queryStore.clear()
    renderIn("settings.namespace", SETTINGS)
    await waitFor(() => expect(screen.getByText("fields 0")).toBeTruthy())
  })

  it("reads through the host's client, never the sub-plugin's own", async () => {
    queryStore.clear()
    const hostQuery = vi.fn().mockResolvedValue({ fields: [] })
    const subQuery = vi.fn().mockResolvedValue({ fields: [] })
    const subClient: ScopedClient = { extension: "mfa", query: subQuery, command: vi.fn() }

    const Probe = () => {
      useHostQuery("settings.namespace")
      return null
    }
    render(
      <PluginProvider client={subClient}>
        <HostAccessProvider
          value={{ client: hostClient(hostQuery), allowed: SETTINGS, subExtension: "mfa" }}
        >
          <Probe />
        </HostAccessProvider>
      </PluginProvider>,
    )

    await waitFor(() => expect(hostQuery).toHaveBeenCalledWith("settings.namespace", undefined))
    // The sub-plugin's own client must not have seen this read. Without the
    // assertion below the test passes even if useHostQuery silently falls back
    // to whatever PluginProvider supplies, which is the exact bug it exists
    // to catch.
    expect(subQuery).not.toHaveBeenCalled()
  })

  it("throws when the intent is not on the allowlist, naming both", () => {
    queryStore.clear()
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderIn("users.list", SETTINGS)).toThrow(/users\.list/)
    spy.mockRestore()
  })

  it("throws outside a HostAccessProvider rather than falling back to the sub-plugin's client", () => {
    const Probe = () => {
      useHostQuery("settings.namespace")
      return null
    }
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/HostAccessProvider/)
    spy.mockRestore()
  })
})

describe("defineSubPlugin hostIntents", () => {
  it("defaults to an empty allowlist, so a sub-plugin reaches nothing of its host's", () => {
    const sub = defineSubPlugin({ extension: "waitlist", host: "auth" })
    expect(sub.hostIntents).toEqual([])
  })
})
