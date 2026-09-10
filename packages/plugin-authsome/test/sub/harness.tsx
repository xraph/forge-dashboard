import type { ComponentType } from "react"
import { vi } from "vitest"
import { render } from "@testing-library/react"
import { HostAccessProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { stubClient } from "../harness"

/**
 * The same recording stub the core pages use, re-exported so a sub-plugin test
 * does not grow a second one that drifts.
 *
 * `stubClient` answers queries from its first argument and commands from its
 * second, and returns `{ client, intents, payloads }` rather than `{ client,
 * commands }`: `payloads` carries `{ intent, payload }` pairs for every
 * command sent, in order, which is what a settings-panel test reads instead
 * of a bare `commands` array.
 */
export const subStubClient = stubClient

export interface RenderSubOptions {
  /** Bound to the sub-plugin's OWN extension. */
  client: ScopedClient
  /** Bound to the HOST's extension. What `hostIntents` reaches. */
  hostClient: ScopedClient
  allowed: string[]
  params?: Record<string, string | undefined>
  /**
   * `useHostAccess` throws during render for an intent outside the allowlist,
   * and in the real app a `PluginErrorBoundary` catches it. A test asserting
   * the throw wants it to escape, so no boundary is rendered here at all and
   * this flag only silences React's error logging, which otherwise prints the
   * expected error to the console on every run of that one test.
   */
  catchErrors?: boolean
}

export function renderSubPage(
  Page: ComponentType<{ params: Record<string, string | undefined> }>,
  opts: RenderSubOptions,
) {
  const spy = opts.catchErrors
    ? vi.spyOn(console, "error").mockImplementation(() => {})
    : undefined

  try {
    return render(
      <HostAccessProvider
        value={{ client: opts.hostClient, allowed: opts.allowed, subExtension: "test-sub" }}
      >
        <PluginProvider client={opts.client}>
          <Page params={opts.params ?? {}} />
        </PluginProvider>
      </HostAccessProvider>,
    )
  } finally {
    spy?.mockRestore()
  }
}
