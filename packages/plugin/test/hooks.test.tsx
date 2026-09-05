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
      // without touching src/hooks.ts.
      if (init === 0) capturedRefs.push(ref as { current: number })
      return ref
    },
  }
})

const { PluginProvider } = await import("../src/context")
const { useQuery } = await import("../src/hooks")
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
