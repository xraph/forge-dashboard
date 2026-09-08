import { Component } from "react"
import type { ErrorInfo, ReactNode } from "react"

interface PluginBoundaryProps {
  plugin: string
  children: ReactNode
  /**
   * Rendered instead of the default message when the child throws. The auth
   * gate supplies FallbackAuthGate here, because a plugin gate that throws
   * must not be able to lock somebody out of their own dashboard.
   */
  fallback?: ReactNode
}

interface PluginBoundaryState {
  failed: boolean
}

/**
 * Catches a throw from a plugin's component so it takes down its own box
 * instead of the dashboard.
 *
 * Plugins are third-party bundles the host has no control over, and one
 * extension with a bad render must not be able to blank a page it shares
 * with five others. This wraps a plugin's routes and its setup component so
 * that a throw during render is contained to that plugin's own space.
 *
 * A class, because React error boundaries have no hook equivalent.
 */
export class PluginErrorBoundary extends Component<
  PluginBoundaryProps,
  PluginBoundaryState
> {
  state: PluginBoundaryState = { failed: false }

  static getDerivedStateFromError(): PluginBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`plugin "${this.props.plugin}" failed to render`, error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      this.props.fallback ?? (
        <div
          role="status"
          className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        >
          This plugin failed to render: {this.props.plugin}
        </div>
      )
    )
  }
}

/**
 * The sign-in screen used when no plugin declares one.
 *
 * Also the error-boundary fallback for a plugin gate that throws, which is
 * why it cannot import from the kit or from any plugin: it has to be the
 * thing that still renders when the styled one did not.
 *
 * It links rather than posting a form. A gate with no provider behind it has
 * no login intent to call, so the only honest thing it can do is send you to
 * the path the server named.
 */
export function FallbackAuthGate({
  loginPath,
  requiredRoles,
}: {
  loginPath: string
  requiredRoles?: string[]
  onAuthenticated: () => void
}) {
  const denied = (requiredRoles?.length ?? 0) > 0

  return (
    <div
      role="status"
      className="mx-auto flex max-w-sm flex-col gap-3 rounded-md border p-6 text-sm"
    >
      {denied ? (
        <>
          <p className="font-medium">You do not have access to this dashboard.</p>
          <p className="text-muted-foreground">
            It needs one of these roles: {requiredRoles?.join(", ")}.
          </p>
          <a className="underline" href={loginPath}>
            Sign in as someone else
          </a>
        </>
      ) : (
        <>
          <p className="font-medium">Sign in to continue.</p>
          <a className="underline" href={loginPath}>
            Sign in
          </a>
        </>
      )}
    </div>
  )
}
