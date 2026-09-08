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
      expect(command).toHaveBeenCalledWith("apps.switch", { appId: "a2" }, undefined),
    )
    await waitFor(() => expect(queryStore.snapshot(stale).data).toBeUndefined())
  })
})
