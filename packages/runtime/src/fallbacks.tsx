import { Component } from "react"
import type { ErrorInfo, ReactNode } from "react"

interface IntentBoundaryProps {
  intent: string
  children: ReactNode
}

interface IntentBoundaryState {
  failed: boolean
}

/**
 * Catches a throw from one intent's component so it takes down its own box
 * instead of the dashboard.
 *
 * The unresolved-intent case already degrades rather than blanking; this is
 * the same promise for the case where the component resolved and then threw.
 * From W2 those components arrive from third-party bundles, and one extension
 * with a bad render must not be able to blank a page it shares with five
 * others.
 *
 * A class, because React error boundaries have no hook equivalent.
 */
export class IntentErrorBoundary extends Component<
  IntentBoundaryProps,
  IntentBoundaryState
> {
  state: IntentBoundaryState = { failed: false }

  static getDerivedStateFromError(): IntentBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`intent "${this.props.intent}" failed to render`, error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div
        role="status"
        className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
      >
        Intent failed to render: {this.props.intent}
      </div>
    )
  }
}
