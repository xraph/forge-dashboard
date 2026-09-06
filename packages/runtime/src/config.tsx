import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"

/** Everything the runtime needs to reach a contract server. */
export interface DashboardConfig {
  basePath: string
  contractBase: string
  streamBase: string
  /**
   * The URL prefix the shell itself is served from, which is the router's
   * basename.
   *
   * This is NOT basePath. basePath is the contract's prefix (the Go
   * extension's mount, where /api/dashboard/v1 lives); shellBase is where the
   * SPA's own HTML answers, which Forge mounts one level deeper at
   * `{basePath}/ui`. Routing on basePath would put every page one directory
   * above the pages that exist.
   *
   * The Go handler injects this already computed, so nothing on the client
   * derives it. Consuming the injected value rather than appending "/ui" here
   * is what keeps the two sides from drifting if the mount ever moves.
   */
  shellBase: string
  authEnabled: boolean
  loginPath: string
  loginOp: string
  loginContributor: string
}

/** The subset a caller must supply. Everything else is derived from basePath. */
export interface DashboardConfigInput extends Partial<DashboardConfig> {
  basePath: string
}

type InjectedConfig = Partial<DashboardConfig>

declare global {
  interface Window {
    __FORGE_DASHBOARD__?: InjectedConfig
  }
}

/**
 * Reads the config the Go SPA handler inlines before the bundle loads.
 *
 * Returns an empty object during server rendering. Callers must supply a real
 * basePath in that case; this deliberately does not guess one, because
 * guessing is how the previous design failed silently under Next.js.
 */
export function configFromWindow(): InjectedConfig {
  if (typeof window === "undefined") return {}
  return window.__FORGE_DASHBOARD__ ?? {}
}

function resolve(input: DashboardConfigInput): DashboardConfig {
  const base = input.basePath
  return {
    basePath: base,
    contractBase: input.contractBase ?? `${base}/api/dashboard/v1`,
    streamBase: input.streamBase ?? `${base}/api/dashboard/v1/stream`,
    // "/" and not `${base}/ui`, deliberately. Every other field here is
    // derived from basePath because it addresses the contract server, which
    // does live under basePath. shellBase addresses the page's own URL, and
    // nothing in this process knows that unless it was told: under `pnpm dev`
    // Vite serves the SPA from the site root and proxies /dashboard onward,
    // and an externally hosted build sits wherever its operator put it.
    // Guessing `${base}/ui` would break both, and would also duplicate a
    // value the Go handler already computes and injects. Falling back to the
    // site root is the honest reading of "nobody told me where I am mounted",
    // and it is what a <BrowserRouter> with no basename does anyway.
    shellBase: input.shellBase ?? "/",
    authEnabled: input.authEnabled ?? false,
    loginPath: input.loginPath ?? `${base}/login`,
    loginOp: input.loginOp ?? "auth.login",
    loginContributor: input.loginContributor ?? "auth",
  }
}

const ConfigContext = createContext<DashboardConfig | null>(null)

export function ForgeDashboardProvider({
  config,
  children,
}: {
  config: DashboardConfigInput
  children: ReactNode
}) {
  const value = useMemo(() => resolve(config), [config])
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  )
}

export function useDashboardConfig(): DashboardConfig {
  const cfg = useContext(ConfigContext)
  if (!cfg) {
    throw new Error(
      "useDashboardConfig was called outside a ForgeDashboardProvider. " +
        "Wrap the dashboard in <ForgeDashboardProvider config={{ basePath }}>."
    )
  }
  return cfg
}
