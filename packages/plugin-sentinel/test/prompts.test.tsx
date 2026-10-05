import { describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { PromptsTab } from "../src/components/prompts-tab"
import PromptVersionPage from "../src/pages/prompt-version"
import { suite, SUITE_ID, version, VERSION_1, VERSION_2, versionDetail } from "./fixtures"
import { recordingCommandClient, renderNavPage, stubClient } from "./harness"

const v1 = version({
  id: VERSION_1,
  version: 1,
  systemPrompt: "You are Nimbus.",
  changelog: undefined,
  isCurrent: false,
  runCount: 0,
  latestPassRate: undefined,
})

function renderTab(client: ScopedClient) {
  return render(
    <PluginProvider client={client}>
      <PromptsTab suiteId={SUITE_ID} />
    </PluginProvider>,
  )
}

describe("PromptsTab", () => {
  it("lists versions with the current one marked, and none for what a version lacks", async () => {
    renderTab(stubClient({ "prompts.list": { items: [v1, version()] }, "suites.detail": suite() }))
    const table = await screen.findByRole("region", { name: "2 versions" })
    const rows = within(table).getAllByRole("row")
    expect(within(rows[1]).getByLabelText("no changelog")).toBeTruthy()
    expect(within(rows[1]).getByLabelText("no completed run")).toBeTruthy()
    expect(within(rows[1]).getByRole("button", { name: "Make version 1 current" })).toBeTruthy()
    expect(within(rows[2]).getByText("Current")).toBeTruthy()
    expect(within(rows[2]).getByText("0.75")).toBeTruthy()
    expect(within(rows[2]).queryByRole("button")).toBeNull()
  })

  it("says runs use the suite's own prompt when there is no version", async () => {
    renderTab(stubClient({ "prompts.list": { items: [] }, "suites.detail": suite() }))
    expect(await screen.findByText("No prompt versions yet. Runs use the suite's own prompt.")).toBeTruthy()
  })

  it("says so when versions exist but none is current", async () => {
    renderTab(stubClient({ "prompts.list": { items: [v1] }, "suites.detail": suite() }))
    expect(await screen.findByText("No version is current, so runs use the suite's own prompt.")).toBeTruthy()
  })

  it("makes a version current after saying runs already started keep theirs", async () => {
    const { client, sent } = recordingCommandClient(
      { "prompts.list": { items: [v1, version()] }, "suites.detail": suite() },
      { "prompts.setCurrent": { ...v1, isCurrent: true } },
    )
    renderTab(client)
    fireEvent.click(await screen.findByRole("button", { name: "Make version 1 current" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(/Runs already started keep the prompt they recorded/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Make current" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toEqual({ intent: "prompts.setCurrent", payload: { suiteId: SUITE_ID, versionId: VERSION_1 } })
  })

  it("starts a new version from the current prompt and makes it current by default", async () => {
    const { client, sent } = recordingCommandClient(
      { "prompts.list": { items: [v1, version()] }, "suites.detail": suite() },
      { "prompts.create": version({ id: "pver_new", version: 3 }) },
    )
    renderTab(client)
    fireEvent.click(await screen.findByRole("button", { name: "New version" }))
    const dialog = screen.getByRole("dialog")
    const prompt = within(dialog).getByLabelText("System prompt") as HTMLTextAreaElement
    expect(prompt.value).toBe("You are Nimbus. Ask for the account email first.")
    fireEvent.change(prompt, { target: { value: "You are Nimbus. Be brief." } })
    fireEvent.change(within(dialog).getByLabelText("Changelog"), { target: { value: "  Shorter  " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create version" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect(sent[0]).toEqual({
      intent: "prompts.create",
      payload: { suiteId: SUITE_ID, systemPrompt: "You are Nimbus. Be brief.", changelog: "Shorter", makeCurrent: true },
    })
  })

  it("can create a version without making it current", async () => {
    const { client, sent } = recordingCommandClient(
      { "prompts.list": { items: [] }, "suites.detail": suite() },
      { "prompts.create": v1 },
    )
    renderTab(client)
    fireEvent.click((await screen.findAllByRole("button", { name: "New version" }))[0])
    const dialog = screen.getByRole("dialog")
    expect((within(dialog).getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe("You are Nimbus.")
    fireEvent.click(within(dialog).getByRole("checkbox"))
    fireEvent.click(within(dialog).getByRole("button", { name: "Create version" }))
    await waitFor(() => expect(sent.length).toBe(1))
    expect((sent[0].payload as { makeCurrent: boolean }).makeCurrent).toBe(false)
  })

  it("refuses an empty prompt before sending", async () => {
    const { client, sent } = recordingCommandClient({ "prompts.list": { items: [] }, "suites.detail": suite() })
    renderTab(client)
    fireEvent.click((await screen.findAllByRole("button", { name: "New version" }))[0])
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("System prompt"), { target: { value: "  " } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create version" }))
    expect(within(dialog).getByRole("alert").textContent).toBe("a prompt version needs a system prompt")
    expect(sent).toEqual([])
  })
})

describe("PromptVersionPage", () => {
  it("shows the version, its prompt and the diff against the one before", async () => {
    renderNavPage(PromptVersionPage, stubClient({ "prompts.detail": versionDetail(), "suites.detail": suite() }), {
      id: SUITE_ID,
      versionId: VERSION_2,
    })
    expect(await screen.findByRole("heading", { level: 1, name: "Version 2" })).toBeTruthy()
    expect(screen.getByText("Runs started now use this prompt.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Support assistant" })).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Changes from version 1" })).toBeTruthy()
    const diff = await screen.findByRole("region", { name: "Version 1 against version 2" })
    expect(within(diff).getByTestId("diff-was").textContent).toBe("You are Nimbus.")
    expect(within(diff).getByTestId("diff-now").textContent).toBe("You are Nimbus. Ask for the account email first.")
    expect(screen.queryByRole("button", { name: "Make current" })).toBeNull()
  })

  it("says there is nothing to compare for the first version", async () => {
    renderNavPage(
      PromptVersionPage,
      stubClient({ "prompts.detail": versionDetail({ ...v1, previous: undefined }), "suites.detail": suite() }),
      { id: SUITE_ID, versionId: VERSION_1 },
    )
    expect(await screen.findByText("This is the first version, so there is nothing to compare it with.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Make current" })).toBeTruthy()
  })

  it("says so when the prompt did not change", async () => {
    const same = versionDetail({ systemPrompt: "You are Nimbus." })
    renderNavPage(PromptVersionPage, stubClient({ "prompts.detail": same, "suites.detail": suite() }), {
      id: SUITE_ID,
      versionId: VERSION_2,
    })
    expect(await screen.findByText("The prompt is the same as version 1's.")).toBeTruthy()
    expect(screen.queryByRole("region", { name: "Version 1 against version 2" })).toBeNull()
  })

  it("shows a missing version as an error with its code", async () => {
    const client: ScopedClient = {
      ...stubClient({ "suites.detail": suite() }),
      query: async (intent: string) => {
        if (intent === "prompts.detail") throw new ContractError("NOT_FOUND", "prompt version not found")
        return suite()
      },
    } as ScopedClient
    renderNavPage(PromptVersionPage, client, { id: SUITE_ID, versionId: "pver_x" })
    expect(await screen.findByText("NOT_FOUND: prompt version not found")).toBeTruthy()
  })
})
