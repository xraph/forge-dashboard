import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ContextDimension, ScopedClient } from "@forge-go/dashboard-plugin"
import { ContextSwitchers } from "../src/host/ContextSwitchers"

interface AppsContext {
  currentApp?: { id: string; name: string }
  availableApps: { id: string; name: string }[]
}

const appDimension: ContextDimension = {
  id: "app",
  label: "App",
  query: "apps.context",
  switchCommand: "apps.switch",
  select: (data) => {
    const d = data as AppsContext
    return {
      current: d.currentApp ? { id: d.currentApp.id, label: d.currentApp.name } : undefined,
      options: (d.availableApps ?? []).map((a) => ({ id: a.id, label: a.name })),
    }
  },
  payload: (appId) => ({ appId }),
}

function client(command = vi.fn().mockResolvedValue({ ok: true })): ScopedClient {
  return {
    extension: "auth",
    query: vi.fn().mockResolvedValue({
      currentApp: { id: "a1", name: "Platform" },
      availableApps: [
        { id: "a1", name: "Platform" },
        { id: "a2", name: "Acme" },
      ],
    } satisfies AppsContext),
    command,
  }
}

describe("ContextSwitchers", () => {
  it("renders nothing for a plugin that declares no dimensions", () => {
    queryStore.clear()
    const { container } = render(
      <PluginProvider client={client()}>
        <ContextSwitchers dimensions={[]} />
      </PluginProvider>,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders one labelled select per dimension, showing the current value", async () => {
    queryStore.clear()
    render(
      <PluginProvider client={client()}>
        <ContextSwitchers dimensions={[appDimension]} />
      </PluginProvider>,
    )
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: "App" }) as HTMLSelectElement).value).toBe("a1"),
    )
  })

  it("sends the switch command and clears every cached read", async () => {
    queryStore.clear()
    const stale = queryStore.keyOf("auth", "users.list")
    queryStore.read(stale, () => Promise.resolve({ total: 2 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeTruthy())

    const command = vi.fn().mockResolvedValue({ ok: true })
    render(
      <PluginProvider client={client(command)}>
        <ContextSwitchers dimensions={[appDimension]} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("combobox", { name: "App" })).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "App" }), { target: { value: "a2" } })

    await waitFor(() =>
      expect(command.mock.calls[0].slice(0, 2)).toEqual(["apps.switch", { appId: "a2" }]),
    )
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeUndefined())
  })

  it("issues one request when two dimensions read the same query", async () => {
    queryStore.clear()
    const query = vi.fn().mockResolvedValue({
      currentApp: { id: "a1", name: "Platform" },
      availableApps: [{ id: "a1", name: "Platform" }],
      currentEnv: { id: "e1", name: "Development" },
      availableEnvs: [{ id: "e1", name: "Development" }],
    })
    const envDimension: ContextDimension = {
      id: "environment",
      label: "Environment",
      query: "apps.context",
      switchCommand: "environments.switch",
      select: (d) => {
        const data = d as { currentEnv?: { id: string; name: string }; availableEnvs: { id: string; name: string }[] }
        return {
          current: data.currentEnv ? { id: data.currentEnv.id, label: data.currentEnv.name } : undefined,
          options: (data.availableEnvs ?? []).map((e) => ({ id: e.id, label: e.name })),
        }
      },
      payload: (envId) => ({ envId }),
    }

    render(
      <PluginProvider client={{ extension: "auth", query, command: vi.fn() }}>
        <ContextSwitchers dimensions={[appDimension, envDimension]} />
      </PluginProvider>,
    )

    await waitFor(() => expect(screen.getByRole("combobox", { name: "App" })).toBeTruthy())
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Environment" })).toBeTruthy())

    // Both dimensions read apps.context. The store dedups on the key, so the
    // two switchers share one request rather than each issuing their own.
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("keeps the cache when the switch command fails", async () => {
    queryStore.clear()
    const stale = queryStore.keyOf("auth", "users.list")
    queryStore.read(stale, () => Promise.resolve({ total: 2 }), 60_000)
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeTruthy())

    // execute resolves with undefined on failure and never rejects, which is
    // the signal the component gates on.
    const command = vi.fn().mockRejectedValue(new Error("nope"))
    render(
      <PluginProvider client={client(command)}>
        <ContextSwitchers dimensions={[appDimension]} />
      </PluginProvider>,
    )
    await waitFor(() => expect(screen.getByRole("combobox", { name: "App" })).toBeTruthy())

    fireEvent.change(screen.getByRole("combobox", { name: "App" }), { target: { value: "a2" } })
    await waitFor(() => expect(command).toHaveBeenCalled())

    // A failed switch means the cookie did not change, so the cache is still
    // about the right app. Clearing it here would blank the dashboard for
    // nothing.
    expect(queryStore.snapshot(stale).data).toEqual({ total: 2 })
  })
})
