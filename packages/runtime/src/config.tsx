import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"

/** Everything the runtime needs to reach a contract server. */
export interface DashboardConfig {
  basePath: string
  contractBase: string
  streamBase: string
  authEnabled: boolean
  loginPath: string
  loginOp: string
  loginContributor: string
}

/** The subset a caller must supply. Everything else is derived from basePath. */
export interface DashboardConfigInput extends Partial<DashboardConfig> {
  basePath: string
}

interface InjectedConfig extends Partial<DashboardConfig> {}

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
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useDashboardConfig(): DashboardConfig {
  const cfg = useContext(ConfigContext)
  if (!cfg) {
    throw new Error(
      "useDashboardConfig was called outside a ForgeDashboardProvider. " +
        "Wrap the dashboard in <ForgeDashboardProvider config={{ basePath }}>.",
    )
  }
  return cfg
}
