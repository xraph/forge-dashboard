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
 * What renders when the dashboard cannot show a sign-in screen at all.
 *
 * Both cases are wiring mistakes and not states a visitor can act on, so this
 * says what is wrong and offers nothing to click. It imports from neither the
 * kit nor any plugin on purpose: it has to be the thing that still renders
 * when the styled one did not.
 */
export function FallbackAuthGate({
  reason,
}: {
  reason: "no-provider" | "screen-failed"
}) {
  return (
    <div className="mx-auto flex max-w-sm min-w-0 flex-col gap-3 rounded-md border p-4 text-sm">
      <p className="font-medium" role="alert">
        {reason === "no-provider"
          ? "This dashboard cannot sign anybody in: no plugin declares auth."
          : "The sign-in screen failed to render."}
      </p>
      <p className="text-muted-foreground">
        {reason === "no-provider"
          ? "Add an auth provider to the plugins array, or turn authEnabled off."
          : "Check the browser console for the error the screen threw."}
      </p>
    </div>
  )
}
