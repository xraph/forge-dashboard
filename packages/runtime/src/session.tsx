import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"

import { useDashboardConfig } from "./config"

/** What `/principal` answers with when somebody is signed in. */
export interface Principal {
  authenticated: boolean
  subject?: string
  displayName?: string
  email?: string
  roles?: string[]
  scopes?: string[]
}

/**
 * The principal the Go shell handler inlines, if it inlined one.
 *
 * Three return values, not two, and the difference is load-bearing:
 *
 *   undefined  no `principal` key at all. Nobody told us. The session starts
 *              `unknown` and renders loading chrome.
 *   null       the key is present and explicitly null. The server rendered
 *              this page, looked, and found no session, so the session starts
 *              `signedOut` and the gate paints on the first frame.
 *   Principal  a session, used as the first frame's answer.
 *
 * The Go handler always writes the key. A Next.js host hand-writes its config
 * object and never does, which is why `undefined` is a real case rather than a
 * defensive branch.
 *
 * The cast is deliberate. `config.tsx` types that global as the config it
 * cares about and knows nothing about principals, and widening its declaration
 * would need the `Principal` type from this file, which is the import cycle
 * this arrangement avoids.
 */
export function injectedPrincipal(): Principal | null | undefined {
  if (typeof window === "undefined") return undefined
  const injected = (window as unknown as {
    __FORGE_DASHBOARD__?: { principal?: Principal | null }
  }).__FORGE_DASHBOARD__
  if (!injected || !("principal" in injected)) return undefined
  return injected.principal ?? null
}

/**
 * Six states, and only four of them come from an endpoint answer.
 *
 * `unknown` and `unreachable` exist because "we have not been told" and "we
 * asked and could not find out" are not the same as any answer the server
 * gives, and folding either into `anonymous` paints a sign-in screen at a
 * signed-in person while folding either into `signedIn` shows the dashboard
 * to a stranger.
 */
export type SessionState =
  | { status: "unknown" }
  | { status: "anonymous" }
  | { status: "signedOut"; loginPath: string }
  | { status: "signedIn"; principal: Principal }
  | { status: "denied"; requiredRoles: string[] }
  | { status: "unreachable"; message: string }

export interface Session {
  state: SessionState
  /**
   * Incremented once per resolved fetch, starting from 0.
   *
   * The host puts this in its capabilities effect's dependency array. A
   * freshly signed-in user may be shown contributors that were hidden from
   * them while anonymous, and without this the effect keys on
   * `[contractBase, doFetch]` alone and never re-runs.
   */
  epoch: number
  /**
   * True once the session's own `/principal` fetch has completed at least
   * once. False on every first render, seeded or not.
   *
   * This is not the same question as `state.status === "unknown"`. A page
   * whose principal was inlined by the Go handler starts its first render
   * already `signedIn` or `signedOut` (see `seed()` below), before the real
   * `/principal` fetch behind it has ever landed. Something that gates on a
   * seeded-looking state rather than on this flag runs once against the seed
   * and once again the instant the real fetch resolves and downgrades or
   * confirms it, firing whatever it gates twice on every load that carries an
   * inlined principal.
   */
  resolved: boolean
  refresh: () => void
}

const SessionContext = createContext<Session | null>(null)

/**
 * Reads the seed the Go handler inlined and decides frame one's state.
 *
 * `authEnabled` is what tells apart the two plausible ways a Go handler
 * marks "auth is off": an explicit `principal: null`, and an
 * `authenticated: false` principal. When auth is disabled the middleware that
 * would set an identity never runs, so `UserFromContext` is nil and the
 * handler writes `null` either way. Reading that as `signedOut` on an
 * auth-disabled dashboard flashes the sign-in gate on every load, and the
 * shell only arrives once `/principal` answers back. `authEnabled` is already
 * in the injected config, so this needs no new server field to tell the two
 * cases apart.
 */
function seed(authEnabled: boolean): SessionState {
  const injected = injectedPrincipal()
  if (injected === undefined) return { status: "unknown" }
  if (injected === null || !injected.authenticated) {
    if (!authEnabled) return { status: "anonymous" }
    // loginPath is filled in by the provider, which can read the config.
    return { status: "signedOut", loginPath: "" }
  }
  return { status: "signedIn", principal: injected }
}

export function SessionProvider({
  children,
  fetchImpl,
}: {
  children: ReactNode
  fetchImpl?: typeof fetch
}) {
  const { contractBase, loginPath, authEnabled } = useDashboardConfig()

  const [state, setState] = useState<SessionState>(() => {
    const s = seed(authEnabled)
    return s.status === "signedOut" ? { status: "signedOut", loginPath } : s
  })
  const [epoch, setEpoch] = useState(0)
  const [resolved, setResolved] = useState(false)
  const [nonce, setNonce] = useState(0)

  // Bound on purpose. An unbound `fetch` called as a plain function throws
  // "Illegal invocation" in a browser, because it wants `window` as its
  // receiver. Same reasoning as PluginHost's doFetch.
  const doFetch = useMemo(() => fetchImpl ?? fetch.bind(globalThis), [fetchImpl])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      let next: SessionState
      try {
        const res = await doFetch(`${contractBase}/principal`, {
          credentials: "same-origin",
        })
        const body = (await res.json().catch(() => null)) as
          | (Principal & { code?: string; loginPath?: string; requiredRoles?: string[] })
          | null

        if (res.status === 401) {
          next = { status: "signedOut", loginPath: body?.loginPath ?? loginPath }
        } else if (res.status === 403) {
          next = { status: "denied", requiredRoles: body?.requiredRoles ?? [] }
        } else if (!res.ok || body === null) {
          next = {
            status: "unreachable",
            message: `principal request failed with HTTP ${res.status}`,
          }
        } else if (body.authenticated) {
          next = { status: "signedIn", principal: body }
        } else {
          next = { status: "anonymous" }
        }
      } catch (error) {
        next = {
          status: "unreachable",
          message: error instanceof Error ? error.message : String(error),
        }
      }

      if (cancelled) return
      // Unconditional, downgrades included. The injected principal only ever
      // seeded the first frame; it never outranks the endpoint.
      setState(next)
      setEpoch((e) => e + 1)
      setResolved(true)
    })()

    return () => {
      cancelled = true
    }
  }, [contractBase, doFetch, loginPath, nonce])

  const value = useMemo<Session>(
    () => ({ state, epoch, resolved, refresh }),
    [state, epoch, resolved, refresh],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) {
    throw new Error(
      "useSession was called outside a SessionProvider. " +
        "Wrap the dashboard in <SessionProvider>, which ForgeDashboard does for you.",
    )
  }
  return session
}
