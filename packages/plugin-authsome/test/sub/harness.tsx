import type { ComponentType } from "react"
import { vi } from "vitest"
import { render } from "@testing-library/react"
import {
  HostAccessProvider,
  PluginProvider,
  PluginSlot,
  SubPluginProvider,
  defineSubPlugin,
} from "@forge-go/dashboard-plugin"
import type {
  ScopedClient,
  SlotContribution,
  SlotName,
} from "@forge-go/dashboard-plugin"
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

/**
 * Renders one slot contribution the way the running dashboard renders it.
 *
 * `renderSubPage` is for a sub-plugin's ROUTE, and it hands the component a
 * single `params` prop, which is what `PluginHost` does for a route. A slot
 * contribution is wired differently: `PluginSlot` SPREADS the slot's params
 * onto the contribution, so `<PluginSlot name="org.detail.tabs" params={{ orgId }} />`
 * renders `<Contribution orgId="o1" />` and never `<Contribution params={...} />`.
 *
 * Those two shapes are easy to confuse and the confusion is invisible until
 * production: a contribution written to read `props.params.orgId` and tested
 * through `renderSubPage` passes its test and renders nothing on a real page,
 * because the prop it reads does not exist there. Use this for a contribution
 * and `renderSubPage` for a route, and the test tree matches the real one.
 *
 * It goes through a real `SubPluginProvider` and a real `PluginSlot` rather
 * than approximating them, so the error boundary, the per-contribution client
 * and the host-access allowlist are all the production ones.
 */
export function renderContribution(
  contribution: SlotContribution,
  opts: RenderContributionOptions,
) {
  const subPlugin = defineSubPlugin({
    extension: opts.extension ?? "test-sub",
    host: opts.host ?? "auth",
    hostIntents: opts.allowed ?? [],
    contributions: { [opts.slot]: [contribution] },
  })

  return render(
    <SubPluginProvider
      entries={[{ subPlugin, client: opts.client, hostClient: opts.hostClient }]}
    >
      <PluginSlot name={opts.slot} params={opts.params} />
    </SubPluginProvider>,
  )
}

export interface RenderContributionOptions {
  slot: SlotName
  /** Bound to the sub-plugin's OWN extension. */
  client: ScopedClient
  /** Bound to the HOST's extension. What `hostIntents` reaches. */
  hostClient: ScopedClient
  /** Spread onto the contribution, exactly as `PluginSlot` does. */
  params?: Record<string, unknown>
  allowed?: string[]
  extension?: string
  host?: string
}
