import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ContractError } from "@forge-go/dashboard-plugin"
import { KeyDialog } from "../src/components/key-dialog"
import { OneTimeKey } from "../src/components/one-time-key"
import { KeyActions } from "../src/components/key-actions"
import { KeyDetailPage } from "../src/pages/key-detail"
import { TenantDetailPage } from "../src/pages/tenant-detail"
import { useAttemptKey, commandOutcome } from "../src/attempt"
import type { APIKey, SecretKeyResult } from "../src/types"
import { answer, commandClient } from "./fixtures"
import { renderWithClient } from "./harness"
const tenantId = "tenant_00000000000000000000000001"
const key = () =>
  answer<APIKey>("keys.get", { id: "key_00000000000000000000000001" })
const result = (): SecretKeyResult => ({
  key: key(),
  rawKey: "test-only-unusable-secret",
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it.each(["pending", "uncertain", "revealed"])(
  "protects navigation in the %s state",
  async (state) => {
    const navigation = new EventTarget()
    vi.stubGlobal("navigation", navigation)
    const { client } = commandClient({
      "keys.create": () => {
        if (state === "pending") return new Promise(() => {})
        if (state === "uncertain")
          throw new ContractError("TRANSPORT", "Connection lost")
        return result()
      },
    })
    renderWithClient(
      <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
      client
    )
    fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
      target: { value: "Protected" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create key" }))
    if (state === "uncertain")
      await screen.findByRole("button", { name: "Retry same request" })
    if (state === "revealed")
      await waitFor(() =>
        expect(document.querySelector("[data-key-done]")).not.toBeNull()
      )
    const event = new Event("navigate", { cancelable: true })
    navigation.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    if (state === "revealed") {
      fireEvent.click(document.querySelector("[data-key-stored]")!)
      fireEvent.click(document.querySelector("[data-key-done]")!)
      const after = new Event("navigate", { cancelable: true })
      navigation.dispatchEvent(after)
      expect(after.defaultPrevented).toBe(false)
    }
  }
)
it("restores indexed Back before the router observes it without the Navigation API", async () => {
  vi.stubGlobal("navigation", undefined)
  window.history.replaceState({ idx: 2 }, "", "/keys")
  const router = vi.fn()
  window.addEventListener("popstate", router)
  const go = vi.spyOn(window.history, "go").mockImplementation(() => {})
  const view = renderWithClient(
    <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
    commandClient({ "keys.create": result }).client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Protected" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  await waitFor(() =>
    expect(document.querySelector("[data-key-done]")).not.toBeNull()
  )
  window.dispatchEvent(new PopStateEvent("popstate", { state: { idx: 1 } }))
  expect(router).not.toHaveBeenCalled()
  expect(go).toHaveBeenCalledWith(1)
  window.dispatchEvent(new PopStateEvent("popstate", { state: { idx: 2 } }))
  expect(router).not.toHaveBeenCalled()
  view.unmount()
  window.removeEventListener("popstate", router)
})
it("keeps the rotation reveal mounted while its detail refetches as revoked", async () => {
  const { client, commands } = commandClient({
    "keys.rotate": (payload) => ({
      ...answer<SecretKeyResult>("keys.rotate", payload),
      rawKey: result().rawKey,
    }),
  })
  renderWithClient(<KeyDetailPage params={{ id: key().id }} />, client)
  fireEvent.click(await screen.findByRole("button", { name: "Rotate key" }))
  const dialog = await screen.findByRole("dialog")
  expect(
    within(dialog).getByText(/old key stops working immediately/)
  ).toBeTruthy()
  fireEvent.click(within(dialog).getByRole("button", { name: "Rotate key" }))
  await waitFor(() =>
    expect(document.body.textContent?.includes("Save your key")).toBe(true)
  )
  await waitFor(() =>
    expect(document.body.textContent?.includes("revoked")).toBe(true)
  )
  expect(commands.map((c) => c.intent)).toEqual(["keys.rotate"])
  expect(document.querySelector("[data-key-done]")).not.toBeNull()
  expect(
    (document.querySelector("[data-key-done]") as HTMLButtonElement).disabled
  ).toBe(true)
})
it("opens tenant-scoped creation and retains the reveal across tenant invalidation", async () => {
  const { client } = commandClient({ "keys.create": result })
  renderWithClient(<TenantDetailPage params={{ id: tenantId }} />, client)
  fireEvent.click(await screen.findByRole("button", { name: "Create API key" }))
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Tenant key" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  await waitFor(() =>
    expect(document.body.textContent?.includes("Save your key")).toBe(true)
  )
  expect(document.querySelector("[data-key-done]")).not.toBeNull()
})
it("rejects a past custom expiry before sending a create command", async () => {
  const { client, commands } = commandClient()
  renderWithClient(
    <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
    client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Old" },
  })
  fireEvent.change(screen.getByRole("combobox", { name: "Expiry" }), {
    target: { value: "custom" },
  })
  fireEvent.change(screen.getByLabelText("Expires at (local time)"), {
    target: { value: "2020-01-01T00:00" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  expect(
    await screen.findByText("Choose an expiry in the future.")
  ).toBeTruthy()
  expect(commands).toHaveLength(0)
})
it("retains an attempt ID for retries and replaces it for a changed payload", () => {
  const { result: hook } = renderHook(useAttemptKey)
  const first = hook.current.keyFor({ name: "one" })
  expect(hook.current.keyFor({ name: "one" })).toBe(first)
  expect(hook.current.keyFor({ name: "two" })).not.toBe(first)
  hook.current.end()
  expect(hook.current.keyFor({ name: "one" })).not.toBe(first)
  expect(
    commandOutcome(
      new ContractError("CONFLICT", "Changed wording", {
        reason: "idempotency.still_running",
      })
    )
  ).toBe("running")
  expect(
    commandOutcome(
      new ContractError("CONFLICT", "Changed wording", {
        reason: "idempotency.already_ran",
      })
    )
  ).toBe("spent")
  expect(
    commandOutcome(
      new ContractError("TRANSPORT", "Request failed with HTTP 403")
    )
  ).toBe("failed")
})
it("submits all checked scopes and an absolute expiry, then guards the reveal", async () => {
  const onOpenChange = vi.fn(),
    { client, commands } = commandClient({ "keys.create": result })
  renderWithClient(
    <KeyDialog open onOpenChange={onOpenChange} tenantId={tenantId} />,
    client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Production" },
  })
  fireEvent.click(screen.getByRole("checkbox", { name: "admin" }))
  fireEvent.change(screen.getByRole("combobox", { name: "Expiry" }), {
    target: { value: "30" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  await waitFor(() =>
    expect(document.body.textContent?.includes("Save your key")).toBe(true)
  )
  expect(commands[0].payload).toMatchObject({
    tenantId,
    name: "Production",
    scopes: ["completions", "embeddings", "models", "admin"],
  })
  expect(typeof commands[0].payload.expiresAt).toBe("string")
  const done = document.querySelector<HTMLButtonElement>("[data-key-done]")!
  expect(done.disabled).toBe(true)
  fireEvent.keyDown(document, { key: "Escape" })
  expect(onOpenChange).not.toHaveBeenCalled()
  expect(
    [...document.querySelectorAll("[aria-live]")].every(
      (el) => !el.textContent?.includes(result().rawKey)
    )
  ).toBe(true)
  fireEvent.click(document.querySelector("[data-key-stored]")!)
  fireEvent.click(done)
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
it("retries an uncertain command with the same payload and identity", async () => {
  let attempts = 0
  const { client, commands } = commandClient({
    "keys.create": () => {
      if (++attempts === 1)
        throw new ContractError("TRANSPORT", "Connection lost")
      return result()
    },
  })
  renderWithClient(
    <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
    client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Retry test" },
  })
  fireEvent.change(screen.getByRole("combobox", { name: "Expiry" }), {
    target: { value: "30" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry same request" })
  )
  await waitFor(() => expect(commands).toHaveLength(2))
  expect(commands[1]).toEqual(commands[0])
})
it("shows spent-secret recovery instead of issuing another key", async () => {
  const { client, commands } = commandClient({
    "keys.create": () => {
      throw new ContractError("CONFLICT", "done", {
        reason: "idempotency.already_ran",
      })
    },
  })
  renderWithClient(
    <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
    client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Lost result" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create key" }))
  expect(await screen.findByText(/already completed/)).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Create key" })).toBeNull()
  expect(commands).toHaveLength(1)
})
it("does not submit twice while the command is pending", async () => {
  let resolve!: (value: SecretKeyResult) => void
  const pending = new Promise<SecretKeyResult>((r) => {
    resolve = r
  })
  const { client, commands } = commandClient({ "keys.create": () => pending })
  renderWithClient(
    <KeyDialog open onOpenChange={() => {}} tenantId={tenantId} />,
    client
  )
  fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), {
    target: { value: "Once" },
  })
  const button = screen.getByRole("button", { name: "Create key" })
  fireEvent.click(button)
  fireEvent.click(button)
  expect(commands).toHaveLength(1)
  await act(async () => resolve(result()))
})
it("announces copy fallback without reading the key and requires acknowledgement", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  })
  const onDone = vi.fn()
  renderWithClient(
    <OneTimeKey result={result()} onDone={onDone} />,
    commandClient().client
  )
  fireEvent.click(document.querySelector("[data-key-copy]")!)
  await waitFor(() =>
    expect(
      document.querySelector("[aria-live]")?.textContent?.includes("selected")
    ).toBe(true)
  )
  expect(
    document
      .querySelector("[aria-live]")
      ?.textContent?.includes(result().rawKey)
  ).toBe(false)
  const event = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  fireEvent.click(document.querySelector("[data-key-hide]")!)
  expect(document.body.textContent?.includes(result().rawKey)).toBe(false)
})
it("explains immediate rotation and keeps revoke errors in its dialog", async () => {
  const { client, commands } = commandClient({
    "keys.revoke": () => {
      throw new ContractError("UNAVAILABLE", "Revoke unavailable")
    },
  })
  renderWithClient(<KeyActions apiKey={key()} />, client)
  fireEvent.click(screen.getByRole("button", { name: "Revoke key" }))
  const dialog = await screen.findByRole("alertdialog")
  fireEvent.click(within(dialog).getByRole("button", { name: "Revoke key" }))
  expect(await within(dialog).findByText(/Revoke unavailable/)).toBeTruthy()
  expect(commands[0].payload).toEqual({ id: key().id })
})
