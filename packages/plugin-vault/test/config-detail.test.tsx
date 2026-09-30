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
import ConfigDetailPage from "../src/pages/config-detail"
import { stubClient } from "./harness"

// CodeMirror measures layout that jsdom does not have, and typing into it is
// not something a test can do by firing events. The page is tested against
// stand-ins that keep the editor's contract: the same props, and the real
// parser behind onChange. The real editor and the real diff each have their
// own test, in json-editor.test.tsx and json-diff.test.tsx.
vi.mock("../src/components/json-editor", async () => {
  const { createElement } = await import("react")
  const { parseJsonText } = await import("../src/json-text")
  return {
    default: ({
      label,
      initial,
      onChange,
    }: {
      label: string
      initial: string
      onChange: (edit: unknown) => void
    }) =>
      createElement("textarea", {
        "aria-label": label,
        defaultValue: initial,
        onChange: (e: { target: { value: string } }) =>
          onChange({ text: e.target.value, result: parseJsonText(e.target.value) }),
      }),
  }
})
vi.mock("../src/components/json-diff", async () => {
  const { createElement } = await import("react")
  return {
    default: ({ was, now, label }: { was: string; now: string; label: string }) =>
      createElement(
        "div",
        { "aria-label": label },
        createElement("pre", { "data-side": "was" }, was),
        createElement("pre", { "data-side": "now" }, now),
      ),
  }
})

const KEY = "app/http.timeout"

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "cfg_01",
    key: KEY,
    value: "30s",
    valueType: "duration",
    knownType: true,
    valueMatchesType: true,
    version: 3,
    description: "How long a request may take",
    metadata: { owner: "platform" } as Record<string, string>,
    createdAt: "2026-09-20T10:00:00Z",
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  }
}

function override(tenantId: string) {
  return {
    key: KEY,
    tenantId,
    value: "5s",
    valueMatchesType: true,
    keyExists: true,
    updatedAt: "2026-09-22T10:00:00Z",
  }
}

function detail(over: Record<string, unknown> = {}) {
  return {
    entry: entry(),
    overrides: [] as unknown[],
    recentAudit: [] as unknown[],
    ...over,
  }
}

function version(n: number, value: unknown, over: Record<string, unknown> = {}) {
  return {
    version: n,
    value,
    valueMatchesType: true,
    createdAt: `2026-09-2${n}T10:00:00Z`,
    current: false,
    ...over,
  }
}

/** Newest first, as the contract answers. */
const VERSIONS = {
  versions: [
    version(3, "30s", { current: true }),
    version(2, "20s"),
    version(1, "oops", { valueMatchesType: false }),
  ],
}

interface Harness {
  client: ScopedClient
  queries: { intent: string; params?: unknown }[]
  commands: { intent: string; payload?: unknown }[]
}

function harness(
  answers: Record<string, unknown> = {},
  commands: Record<string, unknown> = {},
): Harness {
  const queries: Harness["queries"] = []
  const sent: Harness["commands"] = []
  const inner = stubClient(
    { "config.detail": detail(), "config.versions": VERSIONS, ...answers },
    commands,
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

function failingCommands(error: ContractError, answers: Record<string, unknown> = {}): Harness {
  const h = harness(answers)
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

function neverSettles(answers: Record<string, unknown> = {}): Harness {
  const h = harness(answers)
  return {
    ...h,
    client: {
      ...h.client,
      command: (intent: string, payload?: unknown) => {
        h.commands.push({ intent, payload })
        return new Promise<never>(() => {})
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
        <ConfigDetailPage params={params} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return { navigate }
}

const ready = () => screen.findByRole("heading", { name: KEY })
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole("button", { name }))
const saveButton = () => screen.getByRole("button", { name: "Save value" }) as HTMLButtonElement
const rowOf = (n: number) => screen.getByText(`v${n}`).closest("tr") as HTMLElement

describe("ConfigDetailPage reads", () => {
  it("sends the decoded key with config.detail and config.versions", async () => {
    const h = harness()
    renderDetail(h.client)
    await ready()
    await screen.findByText("v3")
    expect(h.queries.find((q) => q.intent === "config.detail")?.params).toEqual({ key: KEY })
    expect(h.queries.find((q) => q.intent === "config.versions")?.params).toEqual({ key: KEY })
  })

  it("renders a status line and asks nothing when the key is missing", async () => {
    const h = harness()
    renderDetail(h.client, {})
    expect(screen.getByRole("status").textContent).toMatch(/no config key/i)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.queries).toHaveLength(0)
  })

  it("says there is no entry with that name, and links back, on NOT_FOUND", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", "config entry not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect(await screen.findByText(`No config entry named ${KEY}.`)).toBeTruthy()
    expect(screen.getByRole("link", { name: /config/i }).getAttribute("href")).toBe("/config")
  })

  it("does not call a wrong intent name a missing entry", async () => {
    const client = {
      extension: "vault",
      query: async () => {
        throw new ContractError("NOT_FOUND", 'no handler for intent "config.detail"')
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderDetail(client)
    expect((await screen.findAllByText(/no handler for intent/)).length).toBeGreaterThan(0)
    expect(screen.queryByText(`No config entry named ${KEY}.`)).toBeNull()
  })
})

describe("ConfigDetailPage header and definition", () => {
  it("shows the key in mono, the type, the description and the metadata", async () => {
    renderDetail(harness().client)
    const heading = await ready()
    expect(heading.closest('[data-slot="page-header"]')?.className).toContain("[&_h1]:font-mono")
    expect(screen.getAllByText("duration").length).toBeGreaterThan(0)
    expect(screen.getByText("How long a request may take")).toBeTruthy()
    expect(screen.getByText("owner: platform")).toBeTruthy()
  })

  it("says so when there is no description or metadata", async () => {
    renderDetail(
      harness({ "config.detail": detail({ entry: entry({ description: "", metadata: {} }) }) }).client,
    )
    await ready()
    expect(screen.getByLabelText("no description")).toBeTruthy()
    expect(screen.getByLabelText("no metadata")).toBeTruthy()
  })
})

describe("ConfigDetailPage value editing", () => {
  it("sends only the value, and says which version it became", async () => {
    const h = harness({}, { "config.update": { entry: entry({ value: "45s", version: 4 }) } })
    renderDetail(h.client)
    await ready()
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "45s" } })
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await screen.findByText("Saved as version 4.")
    expect(h.commands).toEqual([{ intent: "config.update", payload: { key: KEY, value: "45s" } }])
  })

  it("starts with Save disabled, and disables it again when the text goes back to what is stored", async () => {
    renderDetail(harness().client)
    await ready()
    expect(saveButton().disabled).toBe(true)
    const input = screen.getByLabelText("Value")
    fireEvent.change(input, { target: { value: "45s" } })
    expect(saveButton().disabled).toBe(false)
    fireEvent.change(input, { target: { value: "30s" } })
    expect(saveButton().disabled).toBe(true)
  })

  it("keeps Save disabled for text that is not a value of the type", async () => {
    renderDetail(harness().client)
    await ready()
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "soon" } })
    expect(saveButton().disabled).toBe(true)
  })

  it("never sends a save that changes nothing, even from Enter", async () => {
    const h = harness()
    renderDetail(h.client)
    await ready()
    fireEvent.submit(saveButton().closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.commands).toHaveLength(0)
  })

  it("shows a failed save under the editor and keeps what was typed", async () => {
    const h = failingCommands(new ContractError("BAD_REQUEST", "config: value: not a duration"))
    renderDetail(h.client)
    await ready()
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "45s" } })
    fireEvent.click(saveButton())
    expect((await screen.findAllByText(/config: value: not a duration/)).length).toBeGreaterThan(0)
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("45s")
  })

  it("uses a typed control for an int and sends a number", async () => {
    const h = harness(
      { "config.detail": detail({ entry: entry({ valueType: "int", value: 8080 }) }) },
      { "config.update": { entry: entry({ valueType: "int", value: 9090, version: 4 }) } },
    )
    renderDetail(h.client)
    await ready()
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "9090" } })
    fireEvent.click(saveButton())
    await screen.findByText("Saved as version 4.")
    expect(h.commands[0]?.payload).toEqual({ key: KEY, value: 9090 })
  })

  it("does not offer a stored value that is not a value of the type as if it were one", async () => {
    renderDetail(
      harness({
        "config.detail": detail({
          entry: entry({ valueType: "int", value: "abc", valueMatchesType: false }),
        }),
      }).client,
    )
    await ready()
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("")
    expect(saveButton().disabled).toBe(true)
    expect(screen.getAllByText("Wrong type").length).toBeGreaterThan(0)
  })
})

describe("ConfigDetailPage json editing", () => {
  const JSON_ENTRY = entry({ valueType: "json", value: { retries: 3 } })
  const jsonDetail = { "config.detail": detail({ entry: JSON_ENTRY }) }

  it("shows the stored value as pretty JSON in the editor", async () => {
    renderDetail(harness(jsonDetail).client)
    await ready()
    const editor = (await screen.findByRole("textbox", { name: "Value" })) as HTMLTextAreaElement
    expect(editor.defaultValue).toBe('{\n  "retries": 3\n}')
  })

  it("keeps Save disabled while the text does not parse", async () => {
    renderDetail(harness(jsonDetail).client)
    await ready()
    fireEvent.change(await screen.findByRole("textbox", { name: "Value" }), { target: { value: '{"retries": ' } })
    expect(saveButton().disabled).toBe(true)
  })

  it("keeps Save disabled when the text parses to the stored value, however it is laid out", async () => {
    renderDetail(harness(jsonDetail).client)
    await ready()
    fireEvent.change(await screen.findByRole("textbox", { name: "Value" }), { target: { value: '{ "retries":3 }' } })
    expect(saveButton().disabled).toBe(true)
  })

  it("sends the parsed value, not the text", async () => {
    const h = harness(jsonDetail, {
      "config.update": { entry: { ...JSON_ENTRY, value: { retries: 5 }, version: 4 } },
    })
    renderDetail(h.client)
    await ready()
    fireEvent.change(await screen.findByRole("textbox", { name: "Value" }), { target: { value: '{"retries": 5}' } })
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await screen.findByText("Saved as version 4.")
    expect(h.commands).toEqual([
      { intent: "config.update", payload: { key: KEY, value: { retries: 5 } } },
    ])
  })

  it("can save null, which is a value", async () => {
    const h = harness(jsonDetail, {
      "config.update": { entry: { ...JSON_ENTRY, value: null, version: 4 } },
    })
    renderDetail(h.client)
    await ready()
    fireEvent.change(await screen.findByRole("textbox", { name: "Value" }), { target: { value: "null" } })
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await screen.findByText("Saved as version 4.")
    expect(h.commands[0]?.payload).toEqual({ key: KEY, value: null })
  })
})

describe("ConfigDetailPage unknown type", () => {
  const UNKNOWN = {
    "config.detail": detail({
      entry: entry({ valueType: "yaml", knownType: false, value: "a: 1" }),
    }),
  }

  it("shows the value read-only, with the sentence that says why", async () => {
    renderDetail(harness(UNKNOWN).client)
    await ready()
    expect(
      screen.getByText(
        "This entry's type, yaml, is not one the vault validates, so its value cannot be edited here.",
      ),
    ).toBeTruthy()
    expect(screen.queryByLabelText("Value")).toBeNull()
    expect(screen.queryByRole("button", { name: "Save value" })).toBeNull()
    expect(screen.getAllByText('"a: 1"').length).toBeGreaterThan(0)
    expect(screen.getByText("Unsupported type")).toBeTruthy()
  })

  it("still lets the description be edited", async () => {
    renderDetail(harness(UNKNOWN).client)
    await ready()
    expect((screen.getByRole("button", { name: "Edit description" }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe("ConfigDetailPage description", () => {
  async function open() {
    await ready()
    click("Edit description")
    return await screen.findByRole("dialog")
  }

  it("sends only the description", async () => {
    const h = harness({}, { "config.update": { entry: entry({ description: "New words" }) } })
    renderDetail(h.client)
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText("Description"), {
      target: { value: "  New words " },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(h.commands).toEqual([
      { intent: "config.update", payload: { key: KEY, description: "New words" } },
    ])
  })

  it("can clear the description by sending an empty one", async () => {
    const h = harness({}, { "config.update": { entry: entry({ description: "" }) } })
    renderDetail(h.client)
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await waitFor(() => expect(h.commands).toHaveLength(1))
    expect(h.commands[0]?.payload).toEqual({ key: KEY, description: "" })
  })

  it("does not send a description that has not changed", async () => {
    const h = harness()
    renderDetail(h.client)
    const dialog = await open()
    const save = within(dialog).getByRole("button", { name: "Save description" }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(save.closest("form") as HTMLFormElement)
    await new Promise((r) => setTimeout(r, 20))
    expect(h.commands).toHaveLength(0)
  })

  it("shows a failure inside the dialog, and forgets it when the dialog opens again", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "store is down"))
    renderDetail(h.client)
    let dialog = await open()
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "x" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    expect((await within(dialog).findAllByText(/store is down/)).length).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    click("Edit description")
    dialog = await screen.findByRole("dialog")
    expect(within(dialog).queryByText(/store is down/)).toBeNull()
    expect((within(dialog).getByLabelText("Description") as HTMLInputElement).value).toBe(
      "How long a request may take",
    )
  })

  it("stays open on Escape while the save is in flight", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    const dialog = await open()
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "x" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Save description" }))
    await within(dialog).findByRole("button", { name: "Saving…" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    fireEvent.keyDown(document.body, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole("dialog")).not.toBeNull()
  })
})

describe("ConfigDetailPage versions", () => {
  it("lists them newest first, with the current one marked", async () => {
    renderDetail(harness().client)
    await ready()
    await screen.findByText("v3")
    const order = screen.getAllByText(/^v\d$/).map((n) => n.textContent)
    expect(order).toEqual(["v3", "v2", "v1"])
    expect(screen.getByText("v3").className).toMatch(/font-mono/)
    expect(within(rowOf(3)).getByText("Current")).toBeTruthy()
    expect(within(rowOf(2)).queryByText("Current")).toBeNull()
    expect(within(rowOf(2)).getByText("20s")).toBeTruthy()
  })

  it("shows scalars as Was and Now against the current value", async () => {
    renderDetail(harness().client)
    await ready()
    await screen.findByText("v2")
    fireEvent.click(within(rowOf(2)).getByRole("button", { name: /Compare/ }))
    const diff = await screen.findByText(/^Was/)
    expect(diff.textContent).toBe("Was 20s. Now 30s.")
  })

  it("says so when the chosen version is the same as the current value", async () => {
    const same = {
      versions: [version(3, "30s", { current: true }), version(2, "30s"), version(1, "10s")],
    }
    renderDetail(harness({ "config.versions": same }).client)
    await ready()
    await screen.findByText("v2")
    fireEvent.click(within(rowOf(2)).getByRole("button", { name: /Compare/ }))
    expect(await screen.findByText(/same as the current value/i)).toBeTruthy()
    expect(screen.queryByText(/^Was/)).toBeNull()
  })

  it("shows json as a diff of the two texts, older against newer", async () => {
    const versions = {
      versions: [
        version(2, { retries: 5 }, { current: true }),
        version(1, { retries: 3 }),
      ],
    }
    renderDetail(
      harness({
        "config.detail": detail({ entry: entry({ valueType: "json", value: { retries: 5 }, version: 2 }) }),
        "config.versions": versions,
      }).client,
    )
    await ready()
    await screen.findByText("v1")
    fireEvent.click(within(rowOf(1)).getByRole("button", { name: /Compare/ }))
    const diff = await screen.findByLabelText(/^Version 1 against the current value/)
    expect(diff.querySelector('[data-side="was"]')?.textContent).toBe('{\n  "retries": 3\n}')
    expect(diff.querySelector('[data-side="now"]')?.textContent).toBe('{\n  "retries": 5\n}')
    expect(screen.queryByText(/^Was/)).toBeNull()
  })

  it("marks a version whose value is not valid for the type and refuses to roll back to it", async () => {
    renderDetail(harness().client)
    await ready()
    await screen.findByText("v1")
    const row = rowOf(1)
    expect(within(row).getByText("Wrong type")).toBeTruthy()
    const roll = within(row).getByRole("button", { name: /Roll back/ }) as HTMLButtonElement
    expect(roll.disabled).toBe(true)
    // The reason is text on the page, and the button points at it.
    const reasonId = roll.getAttribute("aria-describedby") as string
    expect(document.getElementById(reasonId)?.textContent).toMatch(/not a valid duration/i)
    fireEvent.click(roll)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("shows a read failure of the versions without taking the page down", async () => {
    const h = harness()
    const client = {
      ...h.client,
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent === "config.versions") throw new ContractError("INTERNAL", "versions are down")
        return h.client.query(intent, params)
      },
    } as ScopedClient
    renderDetail(client)
    await ready()
    expect((await screen.findAllByText(/versions are down/)).length).toBeGreaterThan(0)
    expect(saveButton()).toBeTruthy()
  })
})

describe("ConfigDetailPage rollback", () => {
  async function open(n = 2) {
    await ready()
    await screen.findByText(`v${n}`)
    fireEvent.click(within(rowOf(n)).getByRole("button", { name: /Roll back/ }))
    return await screen.findByRole("alertdialog")
  }

  it("asks with the promised words, and sends the key and the version", async () => {
    const h = harness({}, { "config.rollback": { entry: entry({ value: "20s", version: 4 }) } })
    renderDetail(h.client)
    const dialog = await open()
    expect(within(dialog).getByText(`Roll back ${KEY} to version 2?`)).toBeTruthy()
    expect(
      within(dialog).getByText(
        "This saves its value as a new version. The type and description stay as they are.",
      ),
    ).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(h.commands).toEqual([
      { intent: "config.rollback", payload: { key: KEY, version: 2 } },
    ])
    expect(await screen.findByText("Saved as version 4.")).toBeTruthy()
  })

  it("does not offer to roll back to the version that is current", async () => {
    renderDetail(harness().client)
    await ready()
    await screen.findByText("v3")
    expect(within(rowOf(3)).queryByRole("button", { name: /Roll back/ })).toBeNull()
  })

  it("shows the server's refusal inside the dialog, and forgets it when it opens again", async () => {
    const h = failingCommands(
      new ContractError("BAD_REQUEST", "config: version: version 2 holds abc, not a duration"),
    )
    renderDetail(h.client)
    let dialog = await open()
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }))
    expect(
      (await within(dialog).findAllByText(/version 2 holds abc, not a duration/)).length,
    ).toBeGreaterThan(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    dialog = await open()
    expect(within(dialog).queryByText(/holds abc/)).toBeNull()
  })

  it("cannot be closed, and cannot be confirmed twice, while the command is in flight", async () => {
    const h = neverSettles()
    renderDetail(h.client)
    const dialog = await open()
    fireEvent.click(within(dialog).getByRole("button", { name: "Roll back" }))
    const working = (await within(dialog).findByRole("button", { name: "Working…" })) as HTMLButtonElement
    expect(working.disabled).toBe(true)
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole("alertdialog")).not.toBeNull()
    expect(h.commands).toHaveLength(1)
  })
})

describe("ConfigDetailPage delete", () => {
  async function open(h: Harness) {
    const { navigate } = renderDetail(h.client)
    await ready()
    await screen.findByText("v3")
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    return { navigate, dialog: await screen.findByRole("alertdialog") }
  }

  it("says how many versions and overrides go with it", async () => {
    const h = harness({
      "config.detail": detail({ overrides: [override("t-acme"), override("t-globex")] }),
    })
    const { dialog } = await open(h)
    expect(within(dialog).getByText(`Delete ${KEY}?`)).toBeTruthy()
    expect(
      within(dialog).getByText(
        `This deletes ${KEY}, its 3 versions and 2 tenant overrides. Applications fall back to their own default.`,
      ),
    ).toBeTruthy()
  })

  it("uses the singular for one of each", async () => {
    const h = harness({
      "config.detail": detail({ overrides: [override("t-acme")] }),
      "config.versions": { versions: [version(1, "30s", { current: true })] },
    })
    renderDetail(h.client)
    await ready()
    await screen.findByText("v1")
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(
      within(dialog).getByText(
        `This deletes ${KEY}, its 1 version and 1 tenant override. Applications fall back to their own default.`,
      ),
    ).toBeTruthy()
  })

  it("sends the key, then goes back to the list", async () => {
    const h = harness({}, { "config.delete": { ok: true, key: KEY } })
    const { navigate, dialog } = await open(h)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/config"))
    expect(h.commands).toEqual([{ intent: "config.delete", payload: { key: KEY } }])
  })

  it("shows a failure inside the dialog and stays on the page", async () => {
    const h = failingCommands(new ContractError("INTERNAL", "store is down"))
    const { navigate, dialog } = await open(h)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect((await within(dialog).findAllByText(/store is down/)).length).toBeGreaterThan(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("cannot be closed while the command is in flight", async () => {
    const h = neverSettles()
    const { dialog } = await open(h)
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await within(dialog).findByRole("button", { name: "Working…" })
    fireEvent.keyDown(dialog, { key: "Escape" })
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole("alertdialog")).not.toBeNull()
  })
})
