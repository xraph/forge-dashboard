import { describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { KeyDetailPage } from "../src/pages/key-detail"
import type { KeyDetail, KeySummary, PolicyRef } from "../src/types"
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
    expect(within(s).getByText(/valid until/)).toBeTruthy()
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
    expect(within(s).queryByText(/valid until/)).toBeNull()
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
