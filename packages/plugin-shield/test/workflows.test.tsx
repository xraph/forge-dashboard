import { expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError, type ScopedClient } from "@forge-go/dashboard-plugin"
import EditorPage from "../src/pages/editor"
import { DetailPage, CollectionPage } from "../src/pages/read"
import { PrivacyPage } from "../src/pages/privacy"
import {
  renderPage,
  stubClient,
  recordingQueryClient,
  recordingCommandClient,
} from "./harness"
const page = { items: [], total: 0, limit: 25, offset: 0, has_more: false }
const caps = {
  engine: { evaluation: false, unavailable_layers: [] },
  scope: { tenant_id: "tenant", app_id: "app" },
  can_manage: true,
  can_manage_privacy: true,
  schemas: {},
}
it("reuses a command key on a retry, then changes it when the payload changes", async () => {
  const attempts: { payload: unknown; opts: unknown }[] = []
  const client = {
    ...stubClient({ capabilities: caps }),
    command: async (_intent: string, payload: unknown, opts: unknown) => {
      attempts.push({ payload, opts })
      throw new ContractError("INTERNAL", "Response interrupted")
    },
  } as ScopedClient
  renderPage((p) => <EditorPage {...p} collection="boundaries" />, client)
  fireEvent.change(await screen.findByLabelText("Name *"), {
    target: { value: "retry" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create configuration" }))
  await screen.findByText("Response interrupted")
  fireEvent.click(screen.getByRole("button", { name: "Create configuration" }))
  await waitFor(() => expect(attempts).toHaveLength(2))
  expect(attempts[0].opts).toEqual(attempts[1].opts)
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "updated" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Create configuration" }))
  await waitFor(() => expect(attempts).toHaveLength(3))
  expect(attempts[2].opts).not.toEqual(attempts[0].opts)
})
it("does not expose write controls to a reader", async () => {
  renderPage(
    (p) => <EditorPage {...p} collection="profiles" />,
    stubClient({ capabilities: { ...caps, can_manage: false } })
  )
  await screen.findByText("Read access only")
  expect(
    screen.queryByRole("button", { name: "Create configuration" })
  ).toBeNull()
})
it("returns paging to the first page when a filter changes", async () => {
  const { client, sent } = recordingQueryClient({
    capabilities: caps,
    "instincts.list": {
      ...page,
      items: [{ id: "x", name: "x" }],
      total: 60,
      has_more: true,
    },
  })
  renderPage((p) => <CollectionPage {...p} collection="instincts" />, client)
  fireEvent.click(await screen.findByRole("button", { name: "Next" }))
  await waitFor(() =>
    expect(
      sent.some(
        (s) =>
          s.intent === "instincts.list" &&
          (s.params as { offset: number }).offset === 25
      )
    ).toBe(true)
  )
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search instincts" }),
    {
      target: { value: "new-search" },
    }
  )
  await waitFor(() =>
    expect(
      sent.some(
        (s) =>
          s.intent === "instincts.list" &&
          (s.params as { offset: number; search: string }).offset === 0 &&
          (s.params as { search: string }).search === "new-search"
      )
    ).toBe(true)
  )
})
it("keeps a failed delete inside its confirmation dialog", async () => {
  const inner = stubClient({
    capabilities: caps,
    "instincts.detail": { id: "x", name: "guard", enabled: true },
    "profiles.references": [],
  })
  const client = {
    ...inner,
    command: async () => {
      throw new ContractError("CONFLICT", "Update profile alpha first")
    },
  } as ScopedClient
  renderPage((p) => <DetailPage {...p} collection="instincts" />, client, {
    id: "x",
  })
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
  expect(
    await within(screen.getByRole("alertdialog")).findByText(
      "Update profile alpha first"
    )
  ).toBeTruthy()
})
it("cancels retention without sending a deletion command", async () => {
  const { client, sent } = recordingCommandClient(
    { capabilities: caps, "pii.stats": page },
    {
      "pii.retentionPreview": {
        id: "preview",
        cutoff: "2026-10-08T12:00:00Z",
        expires_at: "2026-10-08T12:05:00Z",
        token_ids: ["token-one"],
        total: 1,
        has_more: false,
      },
    }
  )
  renderPage(PrivacyPage, client)
  fireEvent.click(
    await screen.findByRole("button", { name: "Review expired tokens" })
  )
  await screen.findByRole("alertdialog")
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
  expect(sent.map((s) => s.intent)).toEqual(["pii.retentionPreview"])
})
it("keeps the reviewed selection and stable key when retention fails", async () => {
  const opts: unknown[] = []
  const inner = stubClient(
    { capabilities: caps, "pii.stats": page },
    {
      "pii.retentionPreview": {
        id: "fixed",
        cutoff: "2026-10-08T12:00:00Z",
        expires_at: "2026-10-08T12:05:00Z",
        token_ids: ["token-one"],
        total: 1,
        has_more: false,
      },
    }
  )
  const client = {
    ...inner,
    command: async (intent: string, payload: unknown, options: unknown) => {
      if (intent === "pii.purge") {
        expect(payload).toEqual({ preview_id: "fixed" })
        opts.push(options)
        throw new ContractError("INTERNAL", "Audit unavailable")
      }
      return inner.command(intent, payload)
    },
  } as ScopedClient
  renderPage(PrivacyPage, client)
  fireEvent.click(
    await screen.findByRole("button", { name: "Review expired tokens" })
  )
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete reviewed tokens" })
  )
  await within(screen.getByRole("alertdialog")).findByText("Audit unavailable")
  fireEvent.click(
    screen.getByRole("button", { name: "Delete reviewed tokens" })
  )
  await waitFor(() => expect(opts).toHaveLength(2))
  expect(opts[0]).toEqual(opts[1])
  expect(screen.getByText("token-one")).toBeTruthy()
})
