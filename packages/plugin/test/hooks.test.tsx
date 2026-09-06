import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"

// This file mocks "react" itself (wrapping, not replacing, the real
// implementation) so the unmount test below can observe useQuery's private
// generation ref. See that test for why: React 19 turns a post-unmount
// setState into a silent no-op, so there is no externally visible signal
// (no warning, no re-render, no thrown error) to assert on from outside the
// component. The generation ref is the one real, internal fact that
// discriminates "the request was superseded" from "it was not" — capturing
// it via a wrapped useRef is the least invasive way to observe it without
// adding test-only exports to src/hooks.ts.
const capturedRefs: { current: number }[] = []

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()
  return {
    ...actual,
    useRef: (init?: unknown) => {
      const ref = actual.useRef(init)
      // useQuery has exactly one useRef(0) call (the generation counter), so
      // matching on the literal initial value is enough to single it out
      // without touching src/hooks.ts. useCommand has one too, so take the
      // last captured ref after rendering the hook under test rather than
      // assuming the array holds only useQuery's.
      if (init === 0) capturedRefs.push(ref as { current: number })
      return ref
    },
  }
})

const { PluginProvider } = await import("../src/context")
const { useQuery, useCommand } = await import("../src/hooks")
const { ContractError } = await import("../src/client")
type ScopedClientT = import("../src/client").ScopedClient

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("useQuery", () => {
  // The automatic request fired on mount and a manual refetch() can overlap.
  // If the first one issued happens to be the last one to settle, its result
  // must not clobber the newer request's result: state has to reflect
  // whichever request was issued most recently, not whichever happened to
  // resolve most recently.
  it("keeps the later request's result when the earlier request resolves after it", async () => {
    const first = deferred<{ n: number }>()
    const second = deferred<{ n: number }>()
    const queryMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const client: ScopedClientT = {
      extension: "billing",
      query: queryMock,
      command: vi.fn(),
    }

    const wrapper = ({ children }: { children: ReactNode }) => (
      <PluginProvider client={client}>{children}</PluginProvider>
    )

    const { result } = renderHook(() => useQuery<{ n: number }>("x.y"), { wrapper })

    // A second, overlapping request: issued while the first is still in flight.
    await act(async () => {
      result.current.refetch()
    })

    expect(queryMock).toHaveBeenCalledTimes(2)

    // The later request (second) settles first...
    await act(async () => {
      second.resolve({ n: 2 })
    })

    // ...then the earlier request (first) settles after it.
    await act(async () => {
      first.resolve({ n: 1 })
    })

    expect(result.current.data).toEqual({ n: 2 })
    expect(result.current.loading).toBe(false)
  })

  // A request can still be in flight when the component unmounts (the user
  // navigated away, the plugin's route changed). Nothing else will ever call
  // run() again for this hook instance, so unless the effect's own cleanup
  // supersedes the in-flight request, there is nothing to stop its eventual
  // settlement from trying to update state that no longer has anywhere to go.
  //
  // We cannot observe "no state update was attempted" directly: React 19
  // silently drops a setState aimed at an unmounted fiber, with no warning
  // and no re-render either way, so a black-box assertion on visible
  // behavior would pass whether or not the fix exists (see the module mock
  // above). What we *can* observe honestly is the one fact the fix actually
  // changes: whether the hook's private generation counter advances past the
  // in-flight request's generation when the component unmounts, with no
  // further run() or refetch() call involved. This is a weaker test than
  // "and therefore nothing bad happens" would be, but it is the strongest
  // one available against this observable surface, and it is real: run
  // without the unmount cleanup, it fails (see the fix report's
  // discriminator for the verbatim failure).
  it("advances the generation counter on unmount, superseding an in-flight request", async () => {
    const pending = deferred<{ n: number }>()
    const queryMock = vi.fn().mockReturnValue(pending.promise)
    const client: ScopedClientT = {
      extension: "billing",
      query: queryMock,
      command: vi.fn(),
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PluginProvider client={client}>{children}</PluginProvider>
    )

    const before = capturedRefs.length
    const { unmount } = renderHook(() => useQuery<{ n: number }>("x.y"), { wrapper })
    const ref = capturedRefs[capturedRefs.length - 1]
    expect(capturedRefs.length).toBeGreaterThan(before)

    const generationAtMount = ref.current
    unmount()
    expect(ref.current).toBeGreaterThan(generationAtMount)

    // Resolving after unmount must not regress or otherwise touch the
    // generation the cleanup already advanced past.
    await act(async () => {
      pending.resolve({ n: 1 })
    })
    expect(ref.current).toBeGreaterThan(generationAtMount)
  })
})

describe("useCommand", () => {
  function mount(commandMock: ReturnType<typeof vi.fn>) {
    const client: ScopedClientT = {
      extension: "billing",
      query: vi.fn(),
      // vi.fn()'s type is a union that includes a constructor signature, so it
      // does not narrow to the generic command signature on its own. The cast
      // is about the mock's declared type, not about what it does.
      command: commandMock as unknown as ScopedClientT["command"],
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <PluginProvider client={client}>{children}</PluginProvider>
    )
    return renderHook(() => useCommand<{ n: number }>("session.login"), { wrapper })
  }

  // The whole reason this is not useQuery. A command writes; firing one
  // because a component rendered would submit the form the user has not
  // filled in yet.
  it("sends nothing on mount", () => {
    const commandMock = vi.fn()
    const { result } = mount(commandMock)

    expect(commandMock).not.toHaveBeenCalled()
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeUndefined()
  })

  it("passes the intent, the payload and the options straight through", async () => {
    const commandMock = vi.fn().mockResolvedValue({ n: 1 })
    const { result } = mount(commandMock)

    await act(async () => {
      await result.current.execute({ user: "rex" }, { idempotencyKey: "caller-key" })
    })

    expect(commandMock).toHaveBeenCalledWith(
      "session.login",
      { user: "rex" },
      { idempotencyKey: "caller-key" },
    )
    expect(result.current.data).toEqual({ n: 1 })
    expect(result.current.loading).toBe(false)
  })

  // useQuery's lesson, restated for commands: a user who double-clicks a
  // button has two commands in flight, and the state must end up showing the
  // one they issued last, whichever one the server happens to answer last.
  it("keeps the later command's result when the earlier one settles after it", async () => {
    const first = deferred<{ n: number }>()
    const second = deferred<{ n: number }>()
    const commandMock = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = mount(commandMock)

    let firstCall!: Promise<{ n: number } | undefined>
    let secondCall!: Promise<{ n: number } | undefined>
    await act(async () => {
      firstCall = result.current.execute({ a: 1 })
      secondCall = result.current.execute({ a: 2 })
    })

    expect(commandMock).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(true)

    // The later command settles first...
    await act(async () => {
      second.resolve({ n: 2 })
    })
    // ...then the earlier one settles after it.
    await act(async () => {
      first.resolve({ n: 1 })
    })

    // Each caller still gets its own answer back...
    await expect(firstCall).resolves.toEqual({ n: 1 })
    await expect(secondCall).resolves.toEqual({ n: 2 })
    // ...but the shared state belongs to the command issued last.
    expect(result.current.data).toEqual({ n: 2 })
    expect(result.current.loading).toBe(false)
  })

  // execute() resolves rather than rejects on failure, on purpose. The error
  // is already captured in state, and a rejected promise nobody awaited is an
  // unhandled rejection in the browser console for a failure the hook has
  // already handled. Callers that need the value check the result.
  it("captures the failure in state and resolves undefined instead of rejecting", async () => {
    const boom = new ContractError("PERMISSION_DENIED", "not yours")
    const commandMock = vi.fn().mockRejectedValue(boom)
    const { result } = mount(commandMock)

    let outcome: { n: number } | undefined = { n: 0 }
    await act(async () => {
      outcome = await result.current.execute({ a: 1 })
    })

    expect(outcome).toBeUndefined()
    expect(result.current.error).toBe(boom)
    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  // Same argument as useQuery's unmount test, and the same limits on what is
  // observable: React 19 drops a post-unmount setState silently, so the
  // honest assertion is on the generation counter the cleanup advances.
  it("advances the generation counter on unmount, superseding an in-flight command", async () => {
    const pending = deferred<{ n: number }>()
    const commandMock = vi.fn().mockReturnValue(pending.promise)

    const before = capturedRefs.length
    const { result, unmount } = mount(commandMock)
    expect(capturedRefs.length).toBeGreaterThan(before)
    const ref = capturedRefs[capturedRefs.length - 1]

    let call!: Promise<{ n: number } | undefined>
    await act(async () => {
      call = result.current.execute({ a: 1 })
    })

    const generationInFlight = ref.current
    unmount()
    expect(ref.current).toBeGreaterThan(generationInFlight)

    await act(async () => {
      pending.resolve({ n: 1 })
    })
    await expect(call).resolves.toEqual({ n: 1 })
    expect(ref.current).toBeGreaterThan(generationInFlight)
  })
})
