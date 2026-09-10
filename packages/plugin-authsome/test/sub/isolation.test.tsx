import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import {
  PluginSlot,
  SubPluginProvider,
  defineSubPlugin,
  useHostQuery,
} from "@forge-go/dashboard-plugin"
import type { ForgeSubPlugin, SlotContribution, SlotName } from "@forge-go/dashboard-plugin"
import { organizationSubPlugin } from "../../src/sub/organization"
import { SETTINGS_INTENTS } from "../../src/sub/settings-panel"
import { renderSubPage, subStubClient } from "./harness"

/**
 * Three properties of the SET of sub-plugins, not of any one of them. A
 * per-sub-plugin suite cannot see a leak between two of them, which is why
 * these live here instead of in organization.test.tsx or settings-only.test.tsx.
 *
 * No source changes belong in this file. If one of these three fails, the fix
 * is in the sub-plugin that broke it.
 */

describe("a sub-plugin's query carries its own contributor", () => {
  it("queries under its own extension, never its host's", async () => {
    const own = subStubClient({
      "orgs.list": {
        organizations: [{ id: "o1", name: "Acme", slug: "acme", createdAt: "2026-01-01T00:00:00Z" }],
      },
    })
    const host = subStubClient({
      "orgs.list": {
        organizations: [{ id: "x", name: "WRONG", slug: "wrong", createdAt: "2026-01-01T00:00:00Z" }],
      },
    })

    renderSubPage(organizationSubPlugin.routes[0].element, {
      client: own.client,
      hostClient: host.client,
      allowed: [],
    })

    // Both stubs answer orgs.list, and they answer DIFFERENTLY. If the page
    // reached through the host client it would render "WRONG" and every
    // other assertion in this file would still pass.
    await waitFor(() => expect(screen.getByText("Acme")).toBeTruthy())
    expect(screen.queryByText("WRONG")).toBeNull()
    expect(host.intents).toEqual([])
  })
})

describe("a host intent outside the allowlist throws at render", () => {
  it("throws when a sub-plugin reaches a host intent it did not declare", () => {
    function Overreacher() {
      // users.list belongs to auth. A settings-only sub-plugin declaring the
      // four settings intents must not be able to reach it through its host.
      useHostQuery("users.list")
      return <p>should never render</p>
    }

    expect(() =>
      renderSubPage(Overreacher, {
        client: subStubClient({}).client,
        hostClient: subStubClient({ "users.list": { users: [] } }).client,
        allowed: [...SETTINGS_INTENTS],
        catchErrors: true,
      }),
    ).toThrow(/users\.list/)

    // And the component genuinely did not render, rather than throwing after
    // painting something. Without this assertion the test would also pass if
    // the hook threw on the request instead of during render, which is a
    // materially different (and worse) behaviour.
    expect(screen.queryByText("should never render")).toBeNull()
  })
})

describe("one sub-plugin throwing loses only its own slot entry", () => {
  /**
   * A small local sub-plugin, deliberately not a real one: this test is
   * about the slot machinery (PluginSlot's per-contribution error boundary),
   * and a real sub-plugin would couple it to whatever that sub-plugin
   * happens to render this month.
   */
  function fakeSub(
    extension: string,
    contributions: Partial<Record<SlotName, SlotContribution[]>>,
  ): ForgeSubPlugin {
    return defineSubPlugin({ extension, host: "auth", contributions })
  }

  it("loses only the contribution that threw", () => {
    function Boom(): never {
      throw new Error("contribution exploded")
    }
    function Fine() {
      return <p>sibling survived</p>
    }

    const { client } = subStubClient({})
    const { client: hostClient } = subStubClient({})

    const entries = [
      {
        subPlugin: fakeSub("alpha", { "user.detail.sections": [{ id: "a", render: Boom }] }),
        client,
        hostClient,
      },
      {
        subPlugin: fakeSub("beta", { "user.detail.sections": [{ id: "b", render: Fine }] }),
        client,
        hostClient,
      },
    ]

    // A boundary catching a deliberate throw prints a stack that reads like a
    // failure in an otherwise green run. Silenced here, and only here.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      render(
        <SubPluginProvider entries={entries}>
          <h1>host page</h1>
          <PluginSlot name="user.detail.sections" params={{ userId: "u1" }} />
        </SubPluginProvider>,
      )

      // Three separate claims, and the middle one is the one that usually
      // breaks: an unkeyed boundary swallows the whole slot.
      expect(screen.getByRole("heading", { name: "host page" })).toBeTruthy()
      expect(screen.getByText("sibling survived")).toBeTruthy()
      expect(screen.getByText(/alpha/)).toBeTruthy() // the boundary names it
    } finally {
      consoleSpy.mockRestore()
    }
  })
})
