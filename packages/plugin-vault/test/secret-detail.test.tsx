import { describe, expect, it, vi } from "vitest"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { SecretDetailPage } from "../src/pages/secret-detail"
import { rotationPath } from "../src/keys"
import { stubClient } from "./harness"

/**
 * jsdom 25 has no PointerEvent, and Base UI's radio dispatches one when it is
 * clicked. A MouseEvent subclass is what a click is, so the radios work.
 */
if (typeof window.PointerEvent === "undefined") {
  class PointerEventShim extends MouseEvent {}
  Object.defineProperty(window, "PointerEvent", { value: PointerEventShim })
}

const CANARY = "hunter2-canary"
const KEY = "db/primary.password"

const SECRET = {
  id: "sec_01",
  key: KEY,
  version: 3,
  encryptionAlg: "AES-256-GCM",
  appId: "app_1",
  metadata: { team: "payments", env: "prod" },
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-23T10:00:00Z",
}

const POLICY = {
  id: "pol_01",
  secretKey: KEY,
  intervalSeconds: 86400,
  enabled: true,
  rotatable: true,
  nextRotationAt: "2026-10-01T04:00:00Z",
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-20T10:00:00Z",
}

const DETAIL = {
  secret: SECRET,
  rotation: null as unknown,
  recentAudit: [] as unknown[],
}

const VERSIONS = {
  versions: [
    { id: "v3", version: 3, createdBy: "usr_1", createdAt: "2026-09-23T10:00:00Z" },
    { id: "v2", version: 2, createdAt: "2026-09-21T10:00:00Z" },
    { id: "v1", version: 1, createdBy: "usr_2", createdAt: "2026-09-20T10:00:00Z" },
  ],
}

const UPDATED = { secret: { ...SECRET, version: 4 } }

interface Harness {
  client: ScopedClient
  queries: { intent: string; params?: unknown }[]
  commands: { intent: string; payload?: unknown }[]
}

/** One client that records both the reads and the writes a page sends. */
function harness(
  detail: unknown = DETAIL,
  commands: Record<string, unknown> = {},
  versions: unknown = VERSIONS
): Harness {
  const queries: Harness["queries"] = []
  const sent: Harness["commands"] = []
  const inner = stubClient(
    { "secrets.detail": detail, "secrets.versions": versions },
    commands
  )
  return {
    queries,
    commands: sent,
    client: {
      extension: inner.extension,
      query: (intent: string, params?: Record<string, unknown>) => {
        queries.push({ intent, params })
        return inner.query(intent, params)
      },
      command: (intent: string, payload?: unknown) => {
        sent.push({ intent, payload })
        return inner.command(intent, payload)
      },
    } as ScopedClient,
  }
}

/** A client whose commands throw, for the failure path. */
function failingCommands(error: ContractError): Harness {
  const h = harness()
  return {
    ...h,
    client: {
      ...h.client,
      command: async (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        throw error
      },
    } as ScopedClient,
  }
}

function renderDetail(client: ScopedClient, params: Record<string, string> = { key: KEY }) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children, className }) => (
            <a href={to} className={className}>
              {children}
            </a>
          ),
          navigate,
        }}
      >
        <SecretDetailPage params={params} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { navigate }
}

async function openReplace() {
  fireEvent.click(await screen.findByRole("button", { name: "Replace value" }))
  return await screen.findByRole("dialog")
}

const valueInput = () => screen.getByLabelText("Value") as HTMLInputElement
function submitInDialog(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Replace value" }) as HTMLButtonElement
}

function expectValueNotInMarkup() {
  expect(document.body.innerHTML).not.toContain(CANARY)
  expect(document.body.outerHTML).not.toContain(CANARY)
  expect(valueInput().hasAttribute("value")).toBe(false)
}

describe("SecretDetailPage reads", () => {
  it("sends the decoded key with both reads", async () => {
    const h = harness()
    renderDetail(h.client)
    await screen.findByRole("heading", { name: KEY })
    await screen.findByText(/Versions \(3\)/)
    const detail = h.queries.filter((q) => q.intent === "secrets.detail")
    const versions = h.queries.filter((q) => q.intent === "secrets.versions")
    expect(detail.length).toBeGreaterThan(0)
    expect(versions.length).toBeGreaterThan(0)
    expect(detail[0]?.params).toEqual({ key: KEY })
    expect(versions[0]?.params).toEqual({ key: KEY })
  })

  it("renders a status line and sends no query when the key is missing", async () => {
    const h = harness()
    renderDetail(h.client, {})
    expect(screen.getByRole("status").textContent).toMatch(/no secret key/i)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.queries).toHaveLength(0)
  })

  it("surfaces a read failure instead of a blank page", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", "secret not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect((await screen.findAllByText(/secret not found/)).length).toBeGreaterThan(0)
  })
})

describe("SecretDetailPage metadata", () => {
  it("shows the fields, the badge and the metadata as k=v tags", async () => {
    renderDetail(harness().client)
    await screen.findByRole("heading", { name: KEY })
    expect(screen.getByText("sec_01")).toBeTruthy()
    expect(screen.getByText("AES-256-GCM")).toBeTruthy()
    expect(screen.getByText("team=payments")).toBeTruthy()
    expect(screen.getByText("env=prod")).toBeTruthy()
    expect(screen.getByLabelText("no expiry")).toBeTruthy()
  })

  it("labels an absent metadata map", async () => {
    renderDetail(harness({ ...DETAIL, secret: { ...SECRET, metadata: undefined } }).client)
    await screen.findByRole("heading", { name: KEY })
    expect(screen.getByLabelText("no metadata")).toBeTruthy()
  })

  it("says plainly that an unencrypted secret is unencrypted, and never calls it secure", async () => {
    renderDetail(
      harness({ ...DETAIL, secret: { ...SECRET, encryptionAlg: "" } }).client
    )
    await screen.findByRole("heading", { name: KEY })
    expect(screen.getByText("Not encrypted")).toBeTruthy()
    const sentence =
      "Stored unencrypted. Replacing the value while a key is configured stores it encrypted."
    expect(screen.getByText(sentence)).toBeTruthy()
    const rest = (document.body.textContent ?? "")
      .replace(sentence, "")
      .replace("Not encrypted", "")
    expect(rest).not.toMatch(/encrypted|secure|protected/i)
  })

  it("does not show the unencrypted sentence for an encrypted secret", async () => {
    renderDetail(harness().client)
    await screen.findByRole("heading", { name: KEY })
    expect(screen.queryByText(/Stored unencrypted/)).toBeNull()
  })

  it("offers no way to view a value or compare versions", async () => {
    renderDetail(harness().client)
    await screen.findByText(/Versions \(3\)/)
    expect(screen.queryByText(/view value|show value|reveal|diff|compare/i)).toBeNull()
  })
})

describe("SecretDetailPage versions", () => {
  it("lists versions newest first and marks only the newest Current", async () => {
    renderDetail(harness().client)
    await screen.findByText(/Versions \(3\)/)
    const items = screen.getAllByRole("listitem")
    const versionItems = items.filter((li) => /^v\d/.test(li.textContent ?? ""))
    expect(versionItems.map((li) => (li.textContent ?? "").slice(0, 2))).toEqual([
      "v3",
      "v2",
      "v1",
    ])
    expect(screen.getAllByText("Current")).toHaveLength(1)
    expect(within(versionItems[0] as HTMLElement).getByText("Current")).toBeTruthy()
    expect(within(versionItems[1] as HTMLElement).queryByText("Current")).toBeNull()
  })

  it("labels a version with no author", async () => {
    renderDetail(harness().client)
    await screen.findByText(/Versions \(3\)/)
    expect(screen.getAllByLabelText("no author")).toHaveLength(1)
    expect(screen.getByText("usr_1")).toBeTruthy()
  })

  it("keeps the count live for a single version", async () => {
    renderDetail(harness(DETAIL, {}, { versions: [VERSIONS.versions[0]] }).client)
    await screen.findByText(/Versions \(1\)/)
  })
})

describe("SecretDetailPage rotation pane", () => {
  it("offers to set up rotation when there is no policy", async () => {
    renderDetail(harness().client)
    expect(await screen.findByText("No rotation policy.")).toBeTruthy()
    const link = screen.getByRole("link", { name: "Set up rotation" })
    expect(link.getAttribute("href")).toBe(rotationPath(KEY))
    expect(screen.queryByText(/will not rotate it/)).toBeNull()
  })

  it("shows interval, status, rotator, next rotation and a link for an enabled policy", async () => {
    renderDetail(harness({ ...DETAIL, rotation: POLICY }).client)
    await screen.findByText("Enabled")
    expect(screen.getByText("Rotator registered")).toBeTruthy()
    expect(screen.getByText(/every 1 day/i)).toBeTruthy()
    expect(screen.queryByLabelText("no next rotation")).toBeNull()
    expect(screen.queryByText("No rotation policy.")).toBeNull()
    expect(screen.queryByText(/will not rotate it/)).toBeNull()
    const link = screen.getByRole("link", { name: /rotation page|Manage rotation/i })
    expect(link.getAttribute("href")).toBe(rotationPath(KEY))
  })

  it("says the policy will not rotate when no rotator is registered", async () => {
    renderDetail(
      harness({ ...DETAIL, rotation: { ...POLICY, rotatable: false } }).client
    )
    expect(
      await screen.findByText(
        "No rotator is registered for this secret, so this policy will not rotate it."
      )
    ).toBeTruthy()
    expect(screen.getByText("No rotator")).toBeTruthy()
  })

  it("shows no next-rotation time for a disabled policy", async () => {
    renderDetail(
      harness({
        ...DETAIL,
        rotation: { ...POLICY, enabled: false, nextRotationAt: undefined },
      }).client
    )
    await screen.findByText("Disabled")
    expect(screen.getByLabelText("no next rotation")).toBeTruthy()
  })
})

describe("SecretDetailPage recent activity", () => {
  it("lists the recent audit entries", async () => {
    renderDetail(
      harness({
        ...DETAIL,
        recentAudit: [
          { id: "a1", action: "secret.update", outcome: "success", createdAt: "2026-09-23T10:00:00Z" },
        ],
      }).client
    )
    expect(await screen.findByText("secret.update")).toBeTruthy()
    expect(screen.queryByText("No recorded activity yet.")).toBeNull()
  })

  it("says so when there is no activity", async () => {
    renderDetail(harness().client)
    expect(await screen.findByText("No recorded activity yet.")).toBeTruthy()
  })
})

describe("SecretDetailPage replace value", () => {
  it("renders a password value input that is not autofilled or spellchecked", async () => {
    renderDetail(harness(DETAIL, { "secrets.update": UPDATED }).client)
    await openReplace()
    const input = valueInput()
    expect(input.type).toBe("password")
    expect(input.getAttribute("autocomplete")).toBe("new-password")
    expect(input.getAttribute("spellcheck")).toBe("false")
  })

  it("disables submit until a value is typed", async () => {
    renderDetail(harness(DETAIL, { "secrets.update": UPDATED }).client)
    const dialog = await openReplace()
    expect(submitInDialog(dialog).disabled).toBe(true)
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    expect(submitInDialog(dialog).disabled).toBe(false)
  })

  it("keeps the current expiry by default: sends key and value only", async () => {
    const h = harness(DETAIL, { "secrets.update": UPDATED })
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.intent).toBe("secrets.update")
    expect(h.commands[0]?.payload).toEqual({ key: KEY, value: CANARY })
    expect(Object.keys(h.commands[0]?.payload as object).sort()).toEqual(["key", "value"])
  })

  it("sends an empty expiresAt to remove the expiry", async () => {
    const h = harness(DETAIL, { "secrets.update": UPDATED })
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.click(within(dialog).getByRole("radio", { name: /Remove/ }))
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, value: CANARY, expiresAt: "" })
  })

  it("sends the RFC3339 UTC timestamp when a new expiry is set", async () => {
    const h = harness(DETAIL, { "secrets.update": UPDATED })
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.click(within(dialog).getByRole("radio", { name: /Set a new expiry/ }))
    const local = "2099-01-02T03:04"
    fireEvent.change(screen.getByLabelText("New expiry"), { target: { value: local } })
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    const payload = h.commands[0]?.payload as Record<string, unknown>
    expect(payload.expiresAt).toBe(new Date(local).toISOString())
    expect(String(payload.expiresAt)).toMatch(/Z$/)
    expect(Object.keys(payload).sort()).toEqual(["expiresAt", "key", "value"])
  })

  it("blocks submit while a new expiry is chosen but empty or in the past", async () => {
    const h = harness(DETAIL, { "secrets.update": UPDATED })
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.click(within(dialog).getByRole("radio", { name: /Set a new expiry/ }))
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    expect(submitInDialog(dialog).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("New expiry"), {
      target: { value: "2001-01-01T00:00" },
    })
    expect(screen.getByText(/expiry is in the past/)).toBeTruthy()
    expect(submitInDialog(dialog).disabled).toBe(true)
    fireEvent.submit(dialog.querySelector("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.commands).toHaveLength(0)
  })

  it("keeps the value out of the markup while typing", async () => {
    renderDetail(harness(DETAIL, { "secrets.update": UPDATED }).client)
    await openReplace()
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    expect(valueInput().value).toBe(CANARY)
    expectValueNotInMarkup()
  })

  it("shows a failure inside the dialog and keeps the value out of the markup", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "vault is unavailable"))
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("vault is unavailable")
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(valueInput().value).toBe(CANARY)
    expectValueNotInMarkup()
    expect(submitInDialog(dialog).disabled).toBe(false)
  })

  it("clears the value and closes on success", async () => {
    const h = harness(DETAIL, { "secrets.update": UPDATED })
    renderDetail(h.client)
    const dialog = await openReplace()
    const input = valueInput()
    fireEvent.change(input, { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(input.value).toBe("")
    expect(document.body.innerHTML).not.toContain(CANARY)
    expect(JSON.stringify(h.queries)).not.toContain(CANARY)
  })

  it("shows no stale error and an empty value when reopened after a failure", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "vault is unavailable"))
    renderDetail(h.client)
    const dialog = await openReplace()
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await openReplace()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(valueInput().value).toBe("")
    expect(submitInDialog(screen.getByRole("dialog")).disabled).toBe(true)
    expectValueNotInMarkup()
  })

  it("resets the expiry choice when reopened", async () => {
    renderDetail(harness(DETAIL, { "secrets.update": UPDATED }).client)
    let dialog = await openReplace()
    fireEvent.click(within(dialog).getByRole("radio", { name: /Remove/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    dialog = await openReplace()
    expect(
      within(dialog).getByRole("radio", { name: /Keep/ }).getAttribute("aria-checked")
    ).toBe("true")
  })

  it("disables submit while the command is in flight", async () => {
    const client = {
      ...harness().client,
      command: () => new Promise<never>(() => {}),
    } as ScopedClient
    renderDetail(client)
    const dialog = await openReplace()
    fireEvent.change(valueInput(), { target: { value: CANARY } })
    fireEvent.click(submitInDialog(dialog))
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("button", { name: /Replacing/ }) as HTMLButtonElement).disabled
      ).toBe(true)
    )
  })
})

describe("SecretDetailPage delete", () => {
  async function openDelete() {
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    return await screen.findByRole("alertdialog")
  }

  it("names the key and says the rotation policy goes too", async () => {
    renderDetail(harness().client)
    const dialog = await openDelete()
    expect(dialog.textContent).toContain(KEY)
    expect(dialog.textContent).toMatch(/rotation policy is deleted too/i)
  })

  it("sends the key and navigates to the list on success", async () => {
    const h = harness(DETAIL, { "secrets.delete": { ok: true, key: KEY } })
    const { navigate } = renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/secrets"))
    expect(h.commands).toHaveLength(1)
    expect(h.commands[0]).toEqual({ intent: "secrets.delete", payload: { key: KEY } })
  })

  it("shows a failure inside the dialog and does not navigate", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "delete refused"))
    const { navigate } = renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    const alert = await within(dialog).findByRole("alert")
    expect(alert.textContent).toContain("delete refused")
    expect(navigate).not.toHaveBeenCalled()
  })

  it("shows no stale error when the dialog is reopened", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "delete refused"))
    renderDetail(h.client)
    const dialog = await openDelete()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await within(dialog).findByRole("alert")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    await openDelete()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
