import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { SubPluginProvider, useSlotEntries } from "../src/slots"
import { defineSubPlugin } from "../src/subplugin"
import type { ScopedClient } from "../src/client"

const client = { extension: "test", query: async () => ({}), command: async () => ({}) } as unknown as ScopedClient

function subWithTab(extension: string, label: string) {
  return {
    subPlugin: defineSubPlugin({
      extension,
      host: "auth",
      contributions: {
        "org.detail.tabs": [
          {
            id: "billing",
            label,
            render: ({ orgId }: { orgId?: string }) => <p>panel for {orgId}</p>,
          },
        ],
      },
    }),
    client,
    hostClient: client,
  }
}

/**
 * A tab is a trigger in one place and a panel in another. A contribution is
 * one component rendered in one place, so it cannot be a tab on its own, and
 * a host page that drops `PluginSlot` into its tab strip renders the
 * contribution's content into the strip with no tab ever appearing.
 *
 * That shipped. It survived every test because a slot with no contributor
 * renders nothing either way, so "no tab appeared" and "nothing contributed"
 * look identical until something actually contributes.
 */
function TabStrip() {
  const tabs = useSlotEntries("org.detail.tabs", { orgId: "o1" })
  return (
    <>
      <div role="tablist">
        <button role="tab">Overview</button>
        {tabs.map((t) => (
          <button role="tab" key={t.key}>
            {t.label ?? t.id}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div role="tabpanel" key={t.key}>
          {t.node}
        </div>
      ))}
    </>
  )
}

describe("useSlotEntries", () => {
  it("hands back a label for the trigger and a node for the panel, separately", () => {
    render(
      <SubPluginProvider entries={[subWithTab("subscription", "Billing")]}>
        <TabStrip />
      </SubPluginProvider>,
    )

    const tabs = screen.getAllByRole("tab").map((t) => t.textContent)
    expect(tabs).toEqual(["Overview", "Billing"])

    // The content is in the panel, NOT in the tab strip. That is the whole
    // defect: rendering it inline put "No active subscription." between the
    // tabs and left the contribution with no tab of its own.
    const strip = screen.getByRole("tablist")
    expect(strip.textContent).toBe("OverviewBilling")
    expect(screen.getByRole("tabpanel").textContent).toBe("panel for o1")
  })

  it("spreads the slot params onto the contribution, as PluginSlot does", () => {
    render(
      <SubPluginProvider entries={[subWithTab("subscription", "Billing")]}>
        <TabStrip />
      </SubPluginProvider>,
    )
    expect(screen.getByText(/panel for o1/)).toBeTruthy()
  })

  it("keys entries per contributing extension, so two contributors both get a tab", () => {
    render(
      <SubPluginProvider
        entries={[subWithTab("subscription", "Billing"), subWithTab("scim", "Provisioning")]}
      >
        <TabStrip />
      </SubPluginProvider>,
    )
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Overview",
      "Billing",
      "Provisioning",
    ])
  })

  it("answers an empty list outside any provider, so a page renders standalone", () => {
    render(<TabStrip />)
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview"])
    expect(screen.queryByRole("tabpanel")).toBeNull()
  })
})
