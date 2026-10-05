import { describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { KeyDetailPage } from "../src/pages/key-detail"
import { policyPath } from "../src/format"
import type { KeyDetail, KeyRotated, KeySummary, PolicyRef } from "../src/types"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

function key(over: Partial<KeySummary> = {}): KeySummary {
  return {
    id: "akey_billing",
    name: "Billing service",
    prefix: "sk",
    hint: "a3f8",
    environment: "live",
    state: "active",
    effectiveState: "active",
    expiryPending: false,
    expiresSoon: false,
    policyId: "kpol_standard",
    scopes: ["billing:read", "billing:write"],
    createdBy: "usr_rex",
    expiresAt: "2027-01-01T00:00:00Z",
    lastUsedAt: "2026-09-29T10:00:00Z",
    rotatedAt: "2026-09-25T10:00:00Z",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-09-25T10:00:00Z",
    ...over,
  }
}

const POLICY: PolicyRef = {
  id: "kpol_standard",
  name: "Standard",
  maxKeyLifetimeSeconds: 90 * 86400,
  graceSeconds: 36 * 3600,
}

const DETAIL: KeyDetail = {
  key: key(),
  policy: POLICY,
  metadata: { team: "billing" },
  previousKeys: [
    {
      rotationId: "krot_1",
      hint: "7c1e",
      reason: "scheduled",
      rotatedAt: "2026-09-25T10:00:00Z",
      graceEnds: "2026-09-30T10:00:00Z",
    },
  ],
}

function detail(over: Partial<KeyDetail> = {}): KeyDetail {
  return { ...DETAIL, ...over }
}

async function render(d: KeyDetail = DETAIL) {
  renderPage(KeyDetailPage, stubClient({ "keys.detail": d }), {
    id: "akey_billing",
  })
  await screen.findByRole("heading", { level: 1, name: d.key.name })
}

function section(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name })
  const el = heading.closest("section")
  if (!el) throw new Error(`no section for ${name}`)
  return el
}

describe("KeyDetailPage header", () => {
  it("shows the name, the masked key in mono and the state badge", async () => {
    await render()
    const masked = screen.getByText("sk_live_…a3f8")
    expect(masked.className).toContain("font-mono")
    expect(screen.getByText("Active")).toBeTruthy()
  })

  it("sends keys.detail with the route id", async () => {
    const { client, sent } = recordingQueryClient({ "keys.detail": DETAIL })
    renderPage(KeyDetailPage, client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1 })
    const first = sent.find((s) => s.intent === "keys.detail")
    expect(first?.params).toEqual({ id: "akey_billing" })
  })

  it("explains an expired key that is not yet marked", async () => {
    await render(
      detail({
        key: key({
          effectiveState: "expired",
          expiryPending: true,
          expiresAt: "2026-09-01T00:00:00Z",
        }),
        previousKeys: [],
      }),
    )
    expect(
      screen.getByText(
        /^Expired on .*2026.*\. Keysmith marks expiry when the key is next used, so its recorded state is still active\.$/,
      ),
    ).toBeTruthy()
  })

  it("has no state explanation for an ordinary active key", async () => {
    await render()
    expect(screen.queryByText(/Keysmith marks expiry/)).toBeNull()
  })
})

describe("KeyDetailPage validity", () => {
  it("lists an open previous key with its cutoff and the both-accepted sentence", async () => {
    await render()
    const s = section("Validity")
    const prev = within(s).getByText("sk_live_…7c1e")
    expect(prev.className).toContain("font-mono")
    expect(within(s).getByText(/keeps working until/)).toBeTruthy()
    expect(
      within(s).getByText(
        "Both the current key and this previous key are accepted until then.",
      ),
    ).toBeTruthy()
  })

  it("says each previous key has its own cutoff when there are several", async () => {
    await render(
      detail({
        previousKeys: [
          ...DETAIL.previousKeys,
          {
            rotationId: "krot_2",
            hint: "19d4",
            reason: "manual",
            rotatedAt: "2026-09-28T10:00:00Z",
            graceEnds: "2026-10-01T10:00:00Z",
          },
        ],
      }),
    )
    const s = section("Validity")
    expect(within(s).getByText("sk_live_…19d4")).toBeTruthy()
    expect(
      within(s).getByText(
        "The current key and each previous key are accepted until the time shown next to it.",
      ),
    ).toBeTruthy()
    expect(within(s).queryByText(/^Both the current key/)).toBeNull()
  })

  it.each(["suspended", "expired", "revoked"] as const)(
    "says neither key is accepted while the key is %s",
    async (state) => {
      await render(detail({ key: key({ state, effectiveState: state }) }))
      const s = section("Validity")
      expect(within(s).getByText("sk_live_…7c1e")).toBeTruthy()
      expect(
        within(s).getByText(
          `Neither the current key nor a previous key is accepted while this key is ${state}. The window keeps running and ends at the time shown.`,
        ),
      ).toBeTruthy()
      expect(within(s).queryByText(/accepted until/)).toBeNull()
    },
  )

  it.each(["suspended", "expired", "revoked"] as const)(
    "says the window ends on a key that is %s, not that the previous key keeps working",
    async (state) => {
      await render(detail({ key: key({ state, effectiveState: state }) }))
      const item = within(section("Validity")).getByText("sk_live_…7c1e").closest("li")
      expect(item?.textContent).toContain("window ends")
      expect(item?.textContent).not.toContain("keeps working until")
    },
  )

  it("uses the current key's prefix and environment for the previous key", async () => {
    await render(
      detail({
        key: key({ prefix: "whk", environment: "staging", hint: "e5c2" }),
      }),
    )
    expect(within(section("Validity")).getByText("whk_staging_…7c1e")).toBeTruthy()
  })

  it("says so when no previous key is still accepted", async () => {
    await render(detail({ previousKeys: [] }))
    const s = section("Validity")
    expect(within(s).getByText("No previous key is still accepted.")).toBeTruthy()
    expect(within(s).queryByText(/keeps working until/)).toBeNull()
  })
})

describe("KeyDetailPage details", () => {
  function term(name: string): HTMLElement {
    const dt = within(section("Details")).getByText(name, { selector: "dt" })
    const dd = dt.nextElementSibling as HTMLElement | null
    if (!dd) throw new Error(`no value for ${name}`)
    return dd
  }

  it("lists the fields, with id and prefix in mono", async () => {
    await render()
    expect(within(term("ID")).getByText("akey_billing").className).toContain("font-mono")
    expect(within(term("Prefix")).getByText("sk").className).toContain("font-mono")
    expect(term("Environment").textContent).toBe("live")
    expect(term("Created by").textContent).toBe("usr_rex")
    const creator = within(term("Created by")).getByText("usr_rex")
    expect(creator.className).toContain("font-mono")
    expect(creator.className).toContain("text-xs")
    for (const t of ["Created", "Updated", "Last used", "Expires", "Rotated"]) {
      expect(term(t).textContent).toMatch(/2026|2027/)
    }
  })

  it("shows when a revoked key was revoked", async () => {
    await render(
      detail({
        key: key({
          state: "revoked",
          effectiveState: "revoked",
          revokedAt: "2026-09-20T10:00:00Z",
        }),
        previousKeys: [],
      }),
    )
    expect(term("Revoked").textContent).toMatch(/2026/)
  })

  it("labels each absent value", async () => {
    await render(
      detail({
        key: key({
          createdBy: undefined,
          lastUsedAt: undefined,
          expiresAt: undefined,
          rotatedAt: undefined,
          revokedAt: undefined,
        }),
        previousKeys: [],
      }),
    )
    const d = section("Details")
    for (const label of ["no creator", "no recorded use", "no expiry", "no rotation", "no revocation"]) {
      expect(within(d).getByLabelText(label)).toBeTruthy()
    }
  })
})

describe("KeyDetailPage policy", () => {
  it("shows the name with max lifetime and grace as durations", async () => {
    await render()
    const s = section("Policy")
    expect(within(s).getByText("Standard")).toBeTruthy()
    expect(within(s).getByText("90 days")).toBeTruthy()
    expect(within(s).getByText("36 hours")).toBeTruthy()
  })

  it("links the policy's name to the policy's page", async () => {
    await render()
    const link = within(section("Policy")).getByRole("link", { name: "Standard" })
    expect(link.getAttribute("href")).toBe(policyPath("kpol_standard"))
  })

  it("reads a null max lifetime as no maximum", async () => {
    await render(
      detail({ policy: { ...POLICY, maxKeyLifetimeSeconds: null } }),
    )
    const s = section("Policy")
    expect(within(s).getByText("No maximum")).toBeTruthy()
    expect(within(s).queryByText(/0 seconds/)).toBeNull()
  })

  it("reads a null grace as not set, with the engine's 24 hour default", async () => {
    await render(detail({ policy: { ...POLICY, graceSeconds: null } }))
    const s = section("Policy")
    expect(within(s).getByText("Not set (24 hours by default)")).toBeTruthy()
    expect(within(s).queryByText(/0 seconds/)).toBeNull()
  })

  it("says there is no policy when the key has none", async () => {
    await render(detail({ key: key({ policyId: undefined }), policy: null }))
    expect(within(section("Policy")).getByLabelText("no policy")).toBeTruthy()
  })

  it("says the policy could not be found when the key points at one the server did not return", async () => {
    await render(
      detail({ key: key({ policyId: "kpol_01j9k4m1zyb1c2d3e4f5g6h7j8" }), policy: null }),
    )
    const s = section("Policy")
    expect(
      within(s).getByText(
        /^The policy this key points at could not be found, so the key validates without one\.$/,
      ),
    ).toBeTruthy()
    expect(
      within(s).getByText("kpol_01j9k4m1zyb1c2d3e4f5g6h7j8").className,
    ).toContain("font-mono")
    expect(within(s).queryByLabelText("no policy")).toBeNull()
    expect(within(s).queryByText(/no longer exists/)).toBeNull()
  })

  it("says a revoked key's missing policy no longer exists, not that the key validates", async () => {
    await render(
      detail({
        key: key({
          state: "revoked",
          effectiveState: "revoked",
          revokedAt: "2026-09-20T10:00:00Z",
          policyId: "kpol_01j9k4m1zyb1c2d3e4f5g6h7j8",
        }),
        policy: null,
      }),
    )
    const s = section("Policy")
    expect(
      within(s).getByText(/^The policy this key used no longer exists\.$/),
    ).toBeTruthy()
    expect(within(s).queryByText(/validates/)).toBeNull()
    const id = within(s).getByText("kpol_01j9k4m1zyb1c2d3e4f5g6h7j8")
    expect(id.className).toContain("font-mono")
    expect(id.className).toContain("text-xs")
    expect(within(s).queryByLabelText("no policy")).toBeNull()
  })

  it("names the warden subject for the key in mono, with nothing after it", async () => {
    await render()
    const subject = screen.getByText("api_key:akey_billing")
    expect(subject.className).toContain("font-mono")
    const warden = within(section("Warden"))
    expect(
      warden.getByText(
        "If the Warden hook is installed, it grants this key's permissions to this subject:",
      ),
    ).toBeTruthy()
    // The subject gets copied with the id, so no period rides along with it.
    expect(section("Warden").textContent?.trim().endsWith("api_key:akey_billing")).toBe(true)
  })
})

describe("KeyDetailPage scopes and metadata", () => {
  it("shows scopes as mono tags", async () => {
    await render()
    const s = section("Scopes")
    expect(within(s).getByText("billing:read").className).toContain("font-mono")
    expect(within(s).getByText("billing:write")).toBeTruthy()
  })

  it("says there are no scopes", async () => {
    await render(detail({ key: key({ scopes: [] }) }))
    expect(within(section("Scopes")).getByLabelText("no scopes")).toBeTruthy()
  })

  it("lists metadata, stringifying values that are not strings", async () => {
    await render(detail({ metadata: { team: "billing", tier: 2, tags: ["a", "b"] } }))
    const s = section("Metadata")
    for (const text of ["team", "billing", "tier", "2", "tags", '["a","b"]']) {
      const el = within(s).getByText(text)
      expect(el.className, text).toContain("font-mono")
      expect(el.className, text).toContain("text-xs")
    }
  })

  it("says there is no metadata", async () => {
    await render(detail({ metadata: {} }))
    expect(within(section("Metadata")).getByLabelText("no metadata")).toBeTruthy()
  })

  it("treats a null metadata like an empty one", async () => {
    await render(detail({ metadata: null as unknown as Record<string, unknown> }))
    expect(within(section("Metadata")).getByLabelText("no metadata")).toBeTruthy()
  })
})

describe("KeyDetailPage failure", () => {
  it("says plainly when the key does not exist, with a link back", async () => {
    renderPage(
      KeyDetailPage,
      failingClient(new ContractError("NOT_FOUND", "key not found")),
      { id: "akey_missing" },
    )
    expect(await screen.findByText("No key with this id.")).toBeTruthy()
    expect(
      screen.getByText(
        "It may have been deleted, or the address may be mistyped.",
      ),
    ).toBeTruthy()
    const back = screen.getByRole("link", { name: "Back to keys" })
    expect(back.getAttribute("href")).toBe("/keys")
    // No raw code and no retry: neither helps someone whose key is gone.
    expect(screen.queryByText(/NOT_FOUND/)).toBeNull()
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it.each(["id is not a key id", "id is required"])(
    "treats a BAD_REQUEST saying %s like a missing key",
    async (message) => {
      renderPage(
        KeyDetailPage,
        failingClient(new ContractError("BAD_REQUEST", message)),
        { id: "not-a-key" },
      )
      expect(await screen.findByText("No key with this id.")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Back to keys" })).toBeTruthy()
      expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
    },
  )

  it("keeps the error card for a BAD_REQUEST about something else", async () => {
    renderPage(
      KeyDetailPage,
      failingClient(new ContractError("BAD_REQUEST", "malformed request body")),
      { id: "akey_billing" },
    )
    expect(await screen.findByText(/malformed request body/)).toBeTruthy()
    expect(screen.queryByText("No key with this id.")).toBeNull()
  })

  it("keeps the error card for a NOT_FOUND that is not about the key", async () => {
    renderPage(
      KeyDetailPage,
      failingClient(new ContractError("NOT_FOUND", 'no handler for intent "keys.detail"')),
      { id: "akey_billing" },
    )
    expect(await screen.findByText(/no handler for intent/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy()
    expect(screen.queryByText("No key with this id.")).toBeNull()
    expect(screen.queryByRole("link", { name: "Back to keys" })).toBeNull()
  })

  it("offers no back link for other failures", async () => {
    renderPage(
      KeyDetailPage,
      failingClient(new ContractError("TRANSPORT", "network down")),
      { id: "akey_billing" },
    )
    expect(await screen.findByText(/network down/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Back to keys" })).toBeNull()
  })

  it("says so when the address has no id", () => {
    renderPage(KeyDetailPage, stubClient({}), {})
    expect(screen.getByRole("status").textContent).toMatch(/no key id/i)
  })
})

describe("KeyDetailPage rotate", () => {
  it("offers Rotate key on an active key and on a suspended one", async () => {
    await render()
    expect(screen.getByRole("button", { name: "Rotate key" })).toBeTruthy()
    expect(screen.queryByText("A revoked or expired key cannot be rotated.")).toBeNull()
    cleanup()

    await render(
      detail({ key: key({ state: "suspended", effectiveState: "suspended" }) }),
    )
    expect(screen.getByRole("button", { name: "Rotate key" })).toBeTruthy()
  })

  it("has no Rotate on a revoked key, and says why", async () => {
    await render(
      detail({
        key: key({
          state: "revoked",
          effectiveState: "revoked",
          revokedAt: "2026-09-20T10:00:00Z",
        }),
        previousKeys: [],
      }),
    )
    expect(screen.queryByRole("button", { name: "Rotate key" })).toBeNull()
    expect(screen.getByText("A revoked or expired key cannot be rotated.")).toBeTruthy()
  })

  it("has no Rotate on an expired key that is not yet marked", async () => {
    await render(
      detail({
        key: key({
          effectiveState: "expired",
          expiryPending: true,
          expiresAt: "2026-09-01T00:00:00Z",
        }),
        previousKeys: [],
      }),
    )
    expect(screen.queryByRole("button", { name: "Rotate key" })).toBeNull()
    expect(screen.getByText("A revoked or expired key cannot be rotated.")).toBeTruthy()
  })

  it("has no Rotate on a suspended key past its expiry, and says why", async () => {
    // A suspended key keeps its state past expiry, and RotateKey refuses it.
    await render(
      detail({
        key: key({
          state: "suspended",
          effectiveState: "suspended",
          expiresAt: "2020-01-01T00:00:00Z",
        }),
        previousKeys: [],
      }),
    )
    expect(screen.queryByRole("button", { name: "Rotate key" })).toBeNull()
    expect(screen.getByText("A revoked or expired key cannot be rotated.")).toBeTruthy()
    // Reactivate and Revoke are still offered: the server decides those.
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy()
  })

  it("offers Rotate on a suspended key with no expiry", async () => {
    await render(
      detail({
        key: key({ state: "suspended", effectiveState: "suspended", expiresAt: undefined }),
      }),
    )
    expect(screen.getByRole("button", { name: "Rotate key" })).toBeTruthy()
  })

  it("opens the dialog with the grace from the key's policy", async () => {
    await render()
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }))
    const d = await screen.findByRole("dialog", { name: "Rotate key" })
    expect((within(d).getByLabelText("Grace period") as HTMLInputElement).value).toBe("36")
  })
})

describe("KeyDetailPage End now", () => {
  const SECOND = {
    rotationId: "krot_2",
    hint: "19d4",
    reason: "manual",
    rotatedAt: "2026-09-28T10:00:00Z",
    graceEnds: "2026-10-01T10:00:00Z",
  }

  async function renderWithCommands(d: KeyDetail) {
    const { client, sent } = recordingCommandClient(
      { "keys.detail": d },
      { "keys.endGrace": { key: d.key, closed: d.previousKeys.length } },
    )
    renderPage(KeyDetailPage, client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: d.key.name })
    return sent
  }

  it("asks about the one previous key, then sends keys.endGrace once on a double click", async () => {
    const sent = await renderWithCommands(DETAIL)
    fireEvent.click(
      within(section("Validity")).getByRole("button", { name: "End now" }),
    )
    const confirm = await screen.findByRole("alertdialog", {
      name: "Stop accepting sk_live_…7c1e?",
    })
    expect(
      within(confirm).getByText(
        "Requests using it fail from now on. This cannot be undone.",
      ),
    ).toBeTruthy()
    expect(sent).toHaveLength(0)

    const go = within(confirm).getByRole("button", { name: "End now" })
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([
      { intent: "keys.endGrace", payload: { id: "akey_billing" } },
    ])
  })

  it("asks about every previous key when there are several", async () => {
    await renderWithCommands(
      detail({ previousKeys: [...DETAIL.previousKeys, SECOND] }),
    )
    const buttons = within(section("Validity")).getAllByRole("button", {
      name: "End now",
    })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(
      await screen.findByRole("alertdialog", {
        name: "Stop accepting every previous key?",
      }),
    ).toBeTruthy()
  })

  it("has no End now when no previous key is accepted", async () => {
    await render(detail({ previousKeys: [] }))
    expect(screen.queryByRole("button", { name: "End now" })).toBeNull()
  })
})

describe("KeyDetailPage state actions", () => {
  const SUSPENDED = detail({
    key: key({ state: "suspended", effectiveState: "suspended" }),
    previousKeys: [],
  })

  function headerButtons(): string[] {
    const header = screen.getByRole("heading", { level: 1 }).closest("[data-slot=page-header]")
    if (!header) throw new Error("no header")
    return within(header as HTMLElement)
      .queryAllByRole("button")
      .map((b) => b.textContent ?? "")
  }

  it("offers Rotate, Suspend and Revoke on an active key", async () => {
    await render()
    expect(headerButtons()).toEqual(["Rotate key", "Suspend", "Revoke"])
  })

  it("offers Rotate, Reactivate and Revoke on a suspended key", async () => {
    await render(SUSPENDED)
    expect(headerButtons()).toEqual(["Rotate key", "Reactivate", "Revoke"])
  })

  it("offers nothing on a revoked key", async () => {
    await render(
      detail({
        key: key({ state: "revoked", effectiveState: "revoked", revokedAt: "2026-09-20T10:00:00Z" }),
        previousKeys: [],
      }),
    )
    expect(headerButtons()).toEqual([])
  })

  it("offers only Revoke on an expired key that is not yet marked, beside the explanation", async () => {
    await render(
      detail({
        key: key({ effectiveState: "expired", expiryPending: true, expiresAt: "2026-09-01T00:00:00Z" }),
        previousKeys: [],
      }),
    )
    expect(headerButtons()).toEqual(["Revoke"])
    expect(screen.getByText(/^Expired on .*Keysmith marks expiry when the key is next used/)).toBeTruthy()
  })

  it("asks before suspending, naming the key, and sends keys.suspend with the id", async () => {
    const { client, sent } = recordingCommandClient(
      { "keys.detail": DETAIL },
      { "keys.suspend": { key: SUSPENDED.key } },
    )
    renderPage(KeyDetailPage, client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }))
    const d = await screen.findByRole("alertdialog", { name: "Suspend sk_live_…a3f8?" })
    fireEvent.click(within(d).getByRole("button", { name: "Suspend" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(sent).toEqual([{ intent: "keys.suspend", payload: { id: "akey_billing" } }])
  })

  it("asks before revoking, naming the key", async () => {
    await render()
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    expect(
      await screen.findByRole("alertdialog", { name: "Revoke sk_live_…a3f8?" }),
    ).toBeTruthy()
  })

  it("reactivates straight from the button, once on a double click", async () => {
    const { client, sent } = recordingCommandClient(
      { "keys.detail": SUSPENDED },
      { "keys.reactivate": { key: DETAIL.key } },
    )
    renderPage(KeyDetailPage, client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1 })
    const go = screen.getByRole("button", { name: "Reactivate" })
    fireEvent.click(go)
    fireEvent.click(go)
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(sent).toEqual([{ intent: "keys.reactivate", payload: { id: "akey_billing" } }])
  })

  it("shows a refused reactivate on the page", async () => {
    const client = {
      extension: "keysmith",
      query: stubClient({ "keys.detail": SUSPENDED }).query,
      command: async () => {
        throw new ContractError("CONFLICT", "only a suspended key can be reactivated")
      },
    } as unknown as ScopedClient
    renderPage(KeyDetailPage, client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    // No `hidden`: nothing is open, so a person can see it.
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe("only a suspended key can be reactivated")
  })

  it.each(["Rotate key", "Revoke"])(
    "drops a refused reactivate's error when %s starts",
    async (button) => {
      const client = {
        extension: "keysmith",
        query: stubClient({ "keys.detail": SUSPENDED }).query,
        command: async () => {
          throw new ContractError("CONFLICT", "only a suspended key can be reactivated")
        },
      } as unknown as ScopedClient
      renderPage(KeyDetailPage, client, { id: "akey_billing" })
      await screen.findByRole("heading", { level: 1 })
      fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
      await screen.findByRole("alert")

      fireEvent.click(screen.getByRole("button", { name: button }))
      await screen.findByRole(button === "Revoke" ? "alertdialog" : "dialog")
      expect(
        screen.queryByText("only a suspended key can be reactivated"),
      ).toBeNull()
    },
  )
})

/**
 * A client that answers like the host: a command's `invalidates` reaches
 * `queryStore.invalidate` for this extension before the command's answer
 * comes back (PluginHost's meta listener runs inside the client's send).
 * A refusal throws and invalidates nothing, as the client only reports meta
 * on success. Each keys.detail read after the first waits for the test to
 * release it, so the test can look at the page while the refetch is in
 * flight, and a `held` command waits the same way for `releaseCommands`.
 *
 * An intent can be given a list of outcomes, used one per call in order.
 */
type HostOutcome = { held?: boolean } & (
  | { answer: unknown; invalidates: string[]; next: KeyDetail }
  | { error: ContractError }
)

function hostLikeClient(
  first: KeyDetail,
  commands: Record<string, HostOutcome | HostOutcome[]>,
  options: { refetchError?: ContractError } = {},
) {
  let current = first
  let reads = 0
  const sent: { intent: string; payload: unknown }[] = []
  const held: (() => void)[] = []
  const heldCommands: (() => void)[] = []
  const client = {
    extension: "keysmith",
    query: (intent: string) => {
      if (intent !== "keys.detail") {
        return Promise.reject(new ContractError("NOT_FOUND", `no handler for intent "${intent}"`))
      }
      reads += 1
      const answer = current
      if (reads === 1) return Promise.resolve(answer)
      const { refetchError } = options
      return new Promise((resolve, reject) =>
        held.push(() => (refetchError ? reject(refetchError) : resolve(answer))),
      )
    },
    command: async (intent: string, payload?: unknown) => {
      sent.push({ intent, payload })
      const plan = commands[intent]
      const c = Array.isArray(plan) ? plan.shift() : plan
      if (!c) throw new ContractError("NOT_FOUND", `no handler for command "${intent}"`)
      if (c.held) await new Promise<void>((resolve) => heldCommands.push(resolve))
      if ("error" in c) throw c.error
      current = c.next
      queryStore.invalidate("keysmith", c.invalidates)
      return c.answer
    },
  } as unknown as ScopedClient
  return {
    client,
    sent,
    releaseReads: () => {
      for (const release of held.splice(0)) release()
    },
    releaseCommands: () => {
      for (const release of heldCommands.splice(0)) release()
    },
  }
}

describe("KeyDetailPage rotate through the refetch", () => {
  // Obviously fake. A realistic-looking key never goes in a test.
  const RAW_KEY = `sk_live_${"fedcba9876543210".repeat(2)}b7d2`
  const ROTATED_AT = "2026-10-02T10:00:00Z"
  const THIS_WINDOW = {
    rotationId: "krot_now",
    hint: "a3f8",
    reason: "manual",
    rotatedAt: ROTATED_AT,
    graceEnds: "2026-10-03T10:00:00Z",
  }
  const ROTATED_KEY = key({ hint: "b7d2", rotatedAt: ROTATED_AT, updatedAt: ROTATED_AT })
  const ROTATED: KeyRotated = {
    key: ROTATED_KEY,
    rawKey: RAW_KEY,
    previousKeys: [THIS_WINDOW],
  }
  const AFTER = detail({ key: ROTATED_KEY, previousKeys: [THIS_WINDOW] })

  function storeText(): string {
    // Reaches into a private field on purpose: the query store has no public
    // listing, and "the raw key is in no cache" is the property that matters.
    const records = (queryStore as unknown as { records: Map<string, unknown> }).records
    return JSON.stringify([...records.values()])
  }

  it("keeps the new key on screen while keys.detail refetches, and forgets it after Done", async () => {
    const host = hostLikeClient(detail({ previousKeys: [] }), {
      "keys.rotate": {
        answer: ROTATED,
        invalidates: ["keys.list", "keys.detail", "rotations.list", "overview"],
        next: AFTER,
      },
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }))
    const form = await screen.findByRole("dialog", { name: "Rotate key" })
    fireEvent.click(within(form).getByRole("button", { name: "Rotate key" }))

    // The refetch is out: the page is a skeleton, and the key is still up.
    // The open dialog hides the page from the accessibility tree, hence
    // `hidden` for anything outside it.
    await screen.findByRole("status", { name: "Loading Key", hidden: true })
    const shown = await screen.findByRole("dialog", { name: "Save your new key" })
    expect(shown.textContent).toContain(RAW_KEY)
    expect(host.sent.map((s) => s.intent)).toEqual(["keys.rotate"])

    // And after it settles, with the page now showing the rotated key.
    host.releaseReads()
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading Key", hidden: true })).toBeNull(),
    )
    const page = screen.getByRole("heading", { level: 1, hidden: true }).closest("section")
    expect(page?.textContent).toContain("sk_live_…b7d2")
    const after = screen.getByRole("dialog", { name: "Save your new key" })
    expect(after.textContent).toContain(RAW_KEY)
    // A routine rotation with its one window: nothing earlier is open, even
    // though the page's key now carries the new hint.
    expect(within(after).getByText("sk_live_…a3f8")).toBeTruthy()
    expect(within(after).queryByText(/An earlier previous key/)).toBeNull()

    fireEvent.click(within(after).getByRole("checkbox"))
    fireEvent.click(within(after).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.body.textContent).not.toContain(RAW_KEY)
    expect(storeText()).not.toContain(RAW_KEY)
  })

  it("keeps the new key on screen when the refetch after the rotation fails", async () => {
    const host = hostLikeClient(
      detail({ previousKeys: [] }),
      {
        "keys.rotate": {
          answer: ROTATED,
          invalidates: ["keys.list", "keys.detail", "rotations.list", "overview"],
          next: AFTER,
        },
      },
      { refetchError: new ContractError("TRANSPORT", "contract request failed with HTTP 502") },
    )
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }))
    const form = await screen.findByRole("dialog", { name: "Rotate key" })
    fireEvent.click(within(form).getByRole("button", { name: "Rotate key" }))
    await screen.findByRole("dialog", { name: "Save your new key" })

    // The read after the rotation fails: the page drops its data and shows
    // its error card, and the dialog with the only copy of the key stays.
    host.releaseReads()
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading Key", hidden: true })).toBeNull(),
    )
    expect(screen.queryByRole("heading", { level: 1, hidden: true })).toBeNull()
    const shown = screen.getByRole("dialog", { name: "Save your new key" })
    expect(shown.textContent).toContain(RAW_KEY)
    expect(within(shown).getByText("sk_live_…a3f8")).toBeTruthy()

    fireEvent.click(within(shown).getByRole("checkbox"))
    fireEvent.click(within(shown).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(document.body.textContent).not.toContain(RAW_KEY)
  })

  it("closes End now cleanly through its refetch and shows the window gone", async () => {
    const host = hostLikeClient(DETAIL, {
      "keys.endGrace": {
        answer: { key: DETAIL.key, closed: 1 },
        invalidates: ["keys.detail", "rotations.list", "overview"],
        next: detail({ previousKeys: [] }),
      },
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(within(section("Validity")).getByRole("button", { name: "End now" }))
    const confirm = await screen.findByRole("alertdialog", {
      name: "Stop accepting sk_live_…7c1e?",
    })
    fireEvent.click(within(confirm).getByRole("button", { name: "End now" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

    host.releaseReads()
    await waitFor(() =>
      expect(
        within(section("Validity")).getByText("No previous key is still accepted."),
      ).toBeTruthy(),
    )
    expect(host.sent).toEqual([{ intent: "keys.endGrace", payload: { id: "akey_billing" } }])
  })
})

describe("KeyDetailPage revoke and scopes through the refetch", () => {
  const SUSPENDED = detail({
    key: key({ state: "suspended", effectiveState: "suspended" }),
    previousKeys: [],
  })
  const ACTIVE = detail({ previousKeys: [] })
  const REVOKED_KEY = key({
    state: "revoked",
    effectiveState: "revoked",
    revokedAt: "2026-10-02T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
  })
  const REVOKED = detail({ key: REVOKED_KEY, previousKeys: [] })
  const STATE_INVALIDATES = ["keys.list", "keys.detail", "overview"]
  const REVOKE_INVALIDATES = ["keys.list", "keys.detail", "rotations.list", "overview"]

  function loading() {
    return screen.queryByRole("status", { name: "Loading Key", hidden: true })
  }

  // Reactivate has no dialog, so its refetch can start while the revoke
  // dialog is already open. That is the page refetching under a dialog with
  // nothing faked: a real host does exactly this.
  it("keeps the revoke dialog, its reason and a later attempt's error through a refetch, then closes on success", async () => {
    const host = hostLikeClient(SUSPENDED, {
      "keys.reactivate": {
        answer: { key: ACTIVE.key },
        invalidates: STATE_INVALIDATES,
        next: ACTIVE,
        held: true,
      },
      "keys.revoke": [
        { error: new ContractError("TRANSPORT", "contract request failed with HTTP 502") },
        { answer: { key: REVOKED_KEY }, invalidates: REVOKE_INVALIDATES, next: REVOKED },
      ],
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const d = await screen.findByRole("alertdialog", { name: "Revoke sk_live_…a3f8?" })
    fireEvent.change(within(d).getByLabelText("Reason"), {
      target: { value: "Leaked in a support ticket" },
    })

    // Reactivate lands and the page refetches under the open dialog.
    host.releaseCommands()
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("alertdialog", { name: "Revoke sk_live_…a3f8?" })
    expect((within(during).getByLabelText("Reason") as HTMLTextAreaElement).value).toBe(
      "Leaked in a support ticket",
    )

    // The revoke is refused while the refetch is still out.
    fireEvent.click(within(during).getByRole("button", { name: "Revoke" }))
    expect((await within(during).findByRole("alert")).textContent).toBe(
      "contract request failed with HTTP 502",
    )

    // The refetch settles, and the error is still where the person is looking.
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("alertdialog", { name: "Revoke sk_live_…a3f8?" })
    expect(within(after).getByRole("alert").textContent).toBe(
      "contract request failed with HTTP 502",
    )

    // A retry succeeds, the dialog closes, and the page shows the key revoked.
    fireEvent.click(within(after).getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const page = screen.getByRole("heading", { level: 1 }).closest("section") as HTMLElement
    expect(within(page).getByText("Revoked", { selector: "[data-slot=badge]" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull()
    expect(within(section("Scopes")).getByText("A revoked key's scopes cannot be changed.")).toBeTruthy()

    const reason = "Leaked in a support ticket"
    expect(host.sent).toEqual([
      { intent: "keys.reactivate", payload: { id: "akey_billing" } },
      { intent: "keys.revoke", payload: { id: "akey_billing", reason } },
      { intent: "keys.revoke", payload: { id: "akey_billing", reason } },
    ])
  })

  // Suspend needs an active key, which offers no Reactivate, so a scope
  // removal (no dialog either) is what refetches under the open dialog.
  it("keeps the suspend dialog and a later attempt's error through a refetch, then closes on success", async () => {
    const WITHOUT_READ = key({ scopes: ["billing:write"] })
    const SUSPENDED_KEY = key({
      state: "suspended",
      effectiveState: "suspended",
      scopes: ["billing:write"],
    })
    const host = hostLikeClient(ACTIVE, {
      "keys.scopes.remove": {
        answer: { key: WITHOUT_READ },
        invalidates: ["keys.list", "keys.detail"],
        next: detail({ key: WITHOUT_READ, previousKeys: [] }),
        held: true,
      },
      "keys.suspend": [
        { error: new ContractError("TRANSPORT", "contract request failed with HTTP 502") },
        {
          answer: { key: SUSPENDED_KEY },
          invalidates: STATE_INVALIDATES,
          next: detail({ key: SUSPENDED_KEY, previousKeys: [] }),
        },
      ],
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }))
    await screen.findByRole("alertdialog", { name: "Suspend sk_live_…a3f8?" })

    // The removal lands and the page refetches under the open dialog.
    host.releaseCommands()
    await waitFor(() => expect(loading()).not.toBeNull())
    const during = screen.getByRole("alertdialog", { name: "Suspend sk_live_…a3f8?" })

    // The suspend is refused while the refetch is still out.
    fireEvent.click(within(during).getByRole("button", { name: "Suspend" }))
    expect((await within(during).findByRole("alert")).textContent).toBe(
      "contract request failed with HTTP 502",
    )

    // The refetch settles, and the error is still in the dialog.
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const after = screen.getByRole("alertdialog", { name: "Suspend sk_live_…a3f8?" })
    expect(within(after).getByRole("alert").textContent).toBe(
      "contract request failed with HTTP 502",
    )

    // A retry succeeds, the dialog closes, and the page shows the key suspended.
    fireEvent.click(within(after).getByRole("button", { name: "Suspend" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const page = screen.getByRole("heading", { level: 1 }).closest("section") as HTMLElement
    expect(within(page).getByText("Suspended", { selector: "[data-slot=badge]" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull()

    expect(host.sent).toEqual([
      { intent: "keys.scopes.remove", payload: { id: "akey_billing", scopes: ["billing:read"] } },
      { intent: "keys.suspend", payload: { id: "akey_billing" } },
      { intent: "keys.suspend", payload: { id: "akey_billing" } },
    ])
  })

  it("keeps a reactivate's refusal that lands after Rotate starts", async () => {
    const REFUSED = "only a suspended key can be reactivated"
    const host = hostLikeClient(SUSPENDED, {
      "keys.reactivate": { error: new ContractError("CONFLICT", REFUSED), held: true },
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    fireEvent.click(screen.getByRole("button", { name: "Rotate key" }))
    await screen.findByRole("dialog", { name: "Rotate key" })
    // Still out, so its button still waits. The open dialog hides the page
    // from the accessibility tree, hence `hidden`.
    const reactivate = screen.getByRole("button", { name: "Reactivate", hidden: true })
    expect((reactivate as HTMLButtonElement).disabled).toBe(true)

    // The refusal lands while the rotate dialog is open, and is not dropped.
    act(() => host.releaseCommands())
    await waitFor(() =>
      expect(screen.getByText(REFUSED).getAttribute("role")).toBe("alert"),
    )
    expect(host.sent).toEqual([{ intent: "keys.reactivate", payload: { id: "akey_billing" } }])
  })

  it("drops a late reactivate refusal once the revoke started beside it succeeds", async () => {
    const REFUSED = "only a suspended key can be reactivated"
    const host = hostLikeClient(SUSPENDED, {
      "keys.reactivate": { error: new ContractError("CONFLICT", REFUSED), held: true },
      "keys.revoke": { answer: { key: REVOKED_KEY }, invalidates: REVOKE_INVALIDATES, next: REVOKED },
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    const d = await screen.findByRole("alertdialog", { name: "Revoke sk_live_…a3f8?" })
    fireEvent.change(within(d).getByLabelText("Reason"), {
      target: { value: "Leaked in a support ticket" },
    })

    // The refusal lands under the open dialog, and shows.
    act(() => host.releaseCommands())
    await waitFor(() =>
      expect(screen.getByText(REFUSED).getAttribute("role")).toBe("alert"),
    )

    // The revoke succeeds: the refusal is about an attempt nobody is looking
    // at any more, and a revoked key offers nothing that would clear it later.
    fireEvent.click(within(d).getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    const page = screen.getByRole("heading", { level: 1 }).closest("section") as HTMLElement
    expect(within(page).getByText("Revoked", { selector: "[data-slot=badge]" })).toBeTruthy()
    expect(screen.queryByText(REFUSED)).toBeNull()
  })

  it("keeps a refused scope change on screen through another action's refetch", async () => {
    const host = hostLikeClient(SUSPENDED, {
      "keys.reactivate": {
        answer: { key: ACTIVE.key },
        invalidates: STATE_INVALIDATES,
        next: ACTIVE,
        held: true,
      },
      "keys.scopes.remove": {
        error: new ContractError("TRANSPORT", "contract request failed with HTTP 502"),
      },
    })
    renderPage(KeyDetailPage, host.client, { id: "akey_billing" })
    await screen.findByRole("heading", { level: 1, name: "Billing service" })

    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove billing:read" }))
    expect((await within(section("Scopes")).findByRole("alert")).textContent).toBe(
      "contract request failed with HTTP 502",
    )

    host.releaseCommands()
    await waitFor(() => expect(loading()).not.toBeNull())
    host.releaseReads()
    await waitFor(() => expect(loading()).toBeNull())
    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy()
    expect(within(section("Scopes")).getByRole("alert").textContent).toBe(
      "contract request failed with HTTP 502",
    )
  })
})
