import { Component } from "react"
import type { ErrorInfo, ReactNode } from "react"

interface PluginBoundaryProps {
  plugin: string
  children: ReactNode
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
      <div
        role="status"
        className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
      >
        This plugin failed to render: {this.props.plugin}
      </div>
    )
  }
}
