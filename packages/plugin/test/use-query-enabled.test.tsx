import { act, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import {
  HostAccessProvider,
  PluginProvider,
  queryStore,
  useHostQuery,
  useQuery,
} from "../src"
import type { ScopedClient } from "../src"

beforeEach(() => queryStore.clear())

function countingClient(extension = "chronicle") {
  const calls: { intent: string; params?: Record<string, unknown> }[] = []
  const client = {
    extension,
    query: async (intent: string, params?: Record<string, unknown>) => {
      calls.push({ intent, params })
      return { answer: intent }
    },
    command: async () => undefined,
  } as unknown as ScopedClient
  return { client, calls }
}

function Probe({ enabled }: { enabled: boolean }) {
  const q = useQuery<{ answer: string }>(
    "verify.run",
    { fromSeq: 1 },
    { enabled }
  )
  return (
    <div>
      <span data-testid="loading">{String(q.loading)}</span>
      <span data-testid="data">{q.data?.answer ?? "none"}</span>
      <button onClick={q.refetch}>refetch</button>
    </div>
  )
}

describe("useQuery with enabled", () => {
  it("sends nothing and reports idle, not loading, while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>
    )
    // Give any stray effect a chance to fire.
    await act(async () => {})
    expect(calls).toHaveLength(0)
    expect(screen.getByTestId("loading").textContent).toBe("false")
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("does nothing on refetch while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>
    )
    await act(async () => screen.getByText("refetch").click())
    expect(calls).toHaveLength(0)
  })

  it("reads once when it turns enabled", async () => {
    const { client, calls } = countingClient()
    function Toggle() {
      const [on, setOn] = useState(false)
      return (
        <>
          <button onClick={() => setOn(true)}>run</button>
          <Probe enabled={on} />
        </>
      )
    }
    render(
      <PluginProvider client={client}>
        <Toggle />
      </PluginProvider>
    )
    await act(async () => screen.getByText("run").click())
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("verify.run")
    )
    expect(calls).toEqual([{ intent: "verify.run", params: { fromSeq: 1 } }])
  })

  it("ignores a cached entry for the same key while disabled", async () => {
    const { client } = countingClient()
    // Another reader filled the key first.
    const key = queryStore.keyOf("chronicle", "verify.run", { fromSeq: 1 })
    queryStore.read(key, async () => ({ answer: "cached" }), 0)
    await act(async () => {})
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>
    )
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("is not re-issued by an invalidation while disabled", async () => {
    const { client, calls } = countingClient()
    render(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>
    )
    await act(async () => queryStore.invalidate("chronicle", ["verify.run"]))
    expect(calls).toHaveLength(0)
  })

  it("stops watching when it turns disabled, so an invalidation issues nothing", async () => {
    const { client, calls } = countingClient()
    const view = render(
      <PluginProvider client={client}>
        <Probe enabled />
      </PluginProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("verify.run")
    )
    view.rerender(
      <PluginProvider client={client}>
        <Probe enabled={false} />
      </PluginProvider>
    )
    await act(async () => queryStore.invalidate("chronicle", ["verify.run"]))
    expect(calls).toHaveLength(1)
  })

  it("keeps today's behaviour when the option is omitted", async () => {
    const { client, calls } = countingClient()
    function Plain() {
      const q = useQuery<{ answer: string }>("streams.mine")
      return <span data-testid="plain">{q.data?.answer ?? "none"}</span>
    }
    render(
      <PluginProvider client={client}>
        <Plain />
      </PluginProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId("plain").textContent).toBe("streams.mine")
    )
    expect(calls).toHaveLength(1)
  })
})

describe("useHostQuery with enabled", () => {
  function HostProbe({ enabled }: { enabled: boolean }) {
    const q = useHostQuery<{ answer: string }>(
      "settings.namespace",
      { a: 1 },
      { enabled }
    )
    return (
      <div>
        <span data-testid="loading">{String(q.loading)}</span>
        <span data-testid="data">{q.data?.answer ?? "none"}</span>
        <button onClick={q.refetch}>refetch</button>
      </div>
    )
  }

  function renderHost(client: ScopedClient, enabled: boolean) {
    return render(
      <HostAccessProvider
        value={{ client, allowed: ["settings.namespace"], subExtension: "mfa" }}
      >
        <HostProbe enabled={enabled} />
      </HostAccessProvider>
    )
  }

  it("sends nothing, reports idle and ignores refetch while disabled", async () => {
    const { client, calls } = countingClient("auth")
    renderHost(client, false)
    await act(async () => screen.getByText("refetch").click())
    expect(calls).toHaveLength(0)
    expect(screen.getByTestId("loading").textContent).toBe("false")
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("ignores a cached entry for the same key while disabled", async () => {
    const { client } = countingClient("auth")
    const key = queryStore.keyOf("auth", "settings.namespace", { a: 1 })
    queryStore.read(key, async () => ({ answer: "cached" }), 0)
    await act(async () => {})
    renderHost(client, false)
    expect(screen.getByTestId("data").textContent).toBe("none")
  })

  it("is not re-issued by an invalidation while disabled", async () => {
    const { client, calls } = countingClient("auth")
    renderHost(client, false)
    await act(async () => queryStore.invalidate("auth", ["settings.namespace"]))
    expect(calls).toHaveLength(0)
  })

  it("reads once when it turns enabled", async () => {
    const { client, calls } = countingClient("auth")
    const view = renderHost(client, false)
    view.rerender(
      <HostAccessProvider
        value={{ client, allowed: ["settings.namespace"], subExtension: "mfa" }}
      >
        <HostProbe enabled />
      </HostAccessProvider>
    )
    await waitFor(() =>
      expect(screen.getByTestId("data").textContent).toBe("settings.namespace")
    )
    expect(calls).toEqual([{ intent: "settings.namespace", params: { a: 1 } }])
  })
})
