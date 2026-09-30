import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ContractError,
  NavigationProvider,
  PluginProvider,
} from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { WardenPoliciesPage } from "../src/pages/policies"
import {
  failingClient,
  recordingCommandClient,
  recordingQueryClient,
  renderPage,
  stubClient,
} from "./harness"

const base = {
  namespacePath: "",
  description: "",
  priority: 0,
  isActive: true,
  state: "active",
  failsClosed: false,
  neverApplies: false,
  matchesEverything: false,
  version: 1,
  updatedAt: "2026-09-01T00:00:00Z",
}

// One row per state the status column has to tell apart. `healthy` is the
// common case and must show no badge at all. `messy` carries three flags at
// once, because several can apply to one policy.
const HEALTHY = "healthy-allow"
const POLICIES = {
  items: [
    { ...base, id: "pol_healthy", name: HEALTHY, effect: "allow", priority: 10 },
    { ...base, id: "pol_off", name: "switched-off", effect: "deny", isActive: false, state: "inactive" },
    { ...base, id: "pol_soon", name: "opens-later", effect: "allow", state: "scheduled" },
    { ...base, id: "pol_lapsed", name: "closed-window", effect: "allow", state: "expired" },
    { ...base, id: "pol_never", name: "backwards-window", effect: "allow", state: "never" },
    { ...base, id: "pol_closed", name: "throws-on-check", effect: "allow", failsClosed: true },
    { ...base, id: "pol_dead", name: "cannot-match", effect: "deny", neverApplies: true },
    { ...base, id: "pol_wide", name: "no-matchers", effect: "allow", matchesEverything: true, namespacePath: "eng/platform" },
    {
      ...base,
      id: "pol_messy",
      name: "everything-wrong",
      effect: "deny",
      isActive: false,
      state: "inactive",
      failsClosed: true,
      matchesEverything: true,
    },
  ],
  total: 9,
  limit: 25,
  offset: 0,
}

const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }
const NAMESPACES = { namespaces: ["", "eng/platform"] }
const CONFIG_ON = { abacEnabled: true }

function answers(extra = {}) {
  return {
    "policies.list": POLICIES,
    "namespaces.list": NAMESPACES,
    "config.detail": CONFIG_ON,
    ...extra,
  }
}

function client(extra = {}, commands = {}) {
  return stubClient(answers(extra), commands)
}

/** Renders inside a NavigationProvider so the navigate call can be observed. */
function renderPolicies(c: ScopedClient) {
  const navigate = vi.fn()
  render(
    <PluginProvider client={c}>
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
        <WardenPoliciesPage />
      </NavigationProvider>
    </PluginProvider>
  )
  return navigate
}

async function rowOf(name: string) {
  return (await screen.findByText(name)).closest("tr")!
}

function badgesIn(el: HTMLElement) {
  return Array.from(el.querySelectorAll('[data-slot="badge"]')) as HTMLElement[]
}

function refusingCommands(error: ContractError): ScopedClient {
  return { ...client(), command: async () => { throw error } } as ScopedClient
}

const ABAC_OFF =
  "Policy evaluation is turned off in this deployment, so none of these policies take effect."

function lastList(sent: { intent: string; params?: unknown }[]) {
  return sent.filter((q) => q.intent === "policies.list").at(-1)?.params as
    | Record<string, unknown>
    | undefined
}

async function openCreate() {
  await screen.findByText(HEALTHY)
  fireEvent.click(screen.getByRole("button", { name: "New policy" }))
  return within(await screen.findByRole("alertdialog"))
}

const CREATE = "Create policy"

function fillCreate(dialog: ReturnType<typeof within>, name = "block-all", effect = "deny") {
  fireEvent.change(dialog.getByLabelText("Name"), { target: { value: name } })
  fireEvent.change(dialog.getByLabelText("Effect"), { target: { value: effect } })
}

describe("WardenPoliciesPage", () => {
  describe("rows", () => {
    it("lists every policy and links each name to its own page", async () => {
      renderPolicies(client())
      const link = within(await rowOf(HEALTHY)).getByRole("link", { name: HEALTHY })
      expect(link.getAttribute("href")).toBe("/policies/pol_healthy")
      expect(
        within(await rowOf("cannot-match")).getByRole("link", { name: "cannot-match" }).getAttribute("href")
      ).toBe("/policies/pol_dead")
    })

    it("marks the name as the column an operator reads, and identifiers as mono", async () => {
      renderPolicies(client())
      const cells = (await rowOf("no-matchers")).querySelectorAll("td")
      expect(cells[0]?.className).toContain("font-medium")
      // namespace is an identifier
      expect(cells[3]?.querySelector(".font-mono.text-xs")?.textContent).toBe("eng/platform")
    })

    it("renders the tenant root as / and shows priority", async () => {
      renderPolicies(client())
      const cells = (await rowOf(HEALTHY)).querySelectorAll("td")
      expect(cells[3]?.textContent).toBe("/")
      expect(cells[4]?.textContent).toBe("10")
    })

    it("surfaces a list failure instead of rendering an empty table", async () => {
      renderPage(
        WardenPoliciesPage,
        failingClient(new ContractError("PERMISSION_DENIED", "no tenant in scope"))
      )
      expect(await screen.findAllByText(/no tenant in scope/i)).toBeTruthy()
      expect(screen.queryByText(HEALTHY)).toBeNull()
    })
  })

  describe("effect", () => {
    it("is plain lowercase text, with no badge and no colour", async () => {
      renderPolicies(client())
      const allow = (await rowOf(HEALTHY)).querySelectorAll("td")[1] as HTMLElement
      const deny = (await rowOf("switched-off")).querySelectorAll("td")[1] as HTMLElement
      expect(allow.textContent).toBe("allow")
      expect(deny.textContent).toBe("deny")
      for (const cell of [allow, deny]) {
        expect(badgesIn(cell)).toHaveLength(0)
        expect(cell.outerHTML).not.toMatch(/destructive|green|red|amber|yellow|blue|emerald|orange|bg-/)
      }
      // Allow and deny are styled identically, so neither one shouts.
      expect(allow.className).toBe(deny.className)
      expect(allow.innerHTML.replace("allow", "")).toBe(deny.innerHTML.replace("deny", ""))
    })
  })

  describe("status", () => {
    it("shows no badge for an active policy that behaves as written", async () => {
      renderPolicies(client())
      const row = await rowOf(HEALTHY)
      expect(badgesIn(row)).toHaveLength(0)
      // Not blank to a screen reader.
      expect((row.querySelectorAll("td")[2] as HTMLElement).textContent).toBe("Active")
    })

    const CASES: [name: string, badge: string, tone: "bg-secondary" | "bg-destructive"][] = [
      ["switched-off", "inactive", "bg-secondary"],
      ["opens-later", "not yet in effect", "bg-secondary"],
      ["closed-window", "expired", "bg-secondary"],
      ["no-matchers", "matches every check", "bg-secondary"],
      ["backwards-window", "never in effect", "bg-destructive"],
      ["throws-on-check", "fails closed", "bg-destructive"],
      ["cannot-match", "never applies", "bg-destructive"],
    ]

    it.each(CASES)("%s shows exactly one badge, %s", async (name, badge, tone) => {
      renderPolicies(client())
      const badges = badgesIn(await rowOf(name))
      expect(badges.map((b) => b.textContent)).toEqual([badge])
      expect(badges[0]?.className).toContain(tone)
    })

    it("uses secondary for the deliberate states and destructive for the broken ones, never the other way", async () => {
      renderPolicies(client())
      await screen.findByText(HEALTHY)
      const tone = async (name: string) => badgesIn(await rowOf(name))[0]!.className
      for (const deliberate of ["switched-off", "opens-later", "closed-window", "no-matchers"]) {
        const c = await tone(deliberate)
        expect(c).toContain("bg-secondary")
        expect(c).not.toMatch(/(^| )(bg|text)-destructive/)
      }
      for (const broken of ["backwards-window", "throws-on-check", "cannot-match"]) {
        const c = await tone(broken)
        expect(c).toContain("text-destructive")
        expect(c).not.toContain("bg-secondary")
      }
    })

    it("titles fails closed and matches every check with what is true of every such policy", async () => {
      // "the check is refused" is false for a deny whose earlier conditions
      // depend on the check, and "no matcher narrowing it" left out the
      // conditions the flag now also depends on.
      renderPolicies(client())
      const titleOf = async (name: string) => badgesIn(await rowOf(name))[0]!.getAttribute("title")
      expect(await titleOf("throws-on-check")).toBe(
        "A condition cannot be evaluated, so warden treats it, and every condition after it, as met"
      )
      expect(await titleOf("no-matchers")).toBe(
        "No matcher or condition narrows it, so while it is in effect it matches every check in its namespace and below"
      )
    })

    it("shows every badge that applies when several do", async () => {
      renderPolicies(client())
      const badges = badgesIn(await rowOf("everything-wrong"))
      expect(badges.map((b) => b.textContent)).toEqual([
        "inactive",
        "fails closed",
        "matches every check",
      ])
    })
  })

  describe("policy evaluation switched off", () => {
    it("leads with the alert when abacEnabled is false", async () => {
      renderPolicies(client({ "config.detail": { abacEnabled: false } }))
      await screen.findByText(HEALTHY)
      const alert = await screen.findByRole("alert")
      expect(alert.textContent).toBe(ABAC_OFF)
    })

    it("does not show it when abacEnabled is true", async () => {
      renderPolicies(client())
      await screen.findByText(HEALTHY)
      // Let the config query settle before asserting an absence.
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByText(ABAC_OFF)).toBeNull()
      expect(screen.queryByRole("alert")).toBeNull()
    })

    it("does not claim evaluation is off when the config could not be read", async () => {
      const answered = answers()
      delete (answered as Record<string, unknown>)["config.detail"]
      renderPolicies(stubClient(answered))
      await screen.findByText(HEALTHY)
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByText(ABAC_OFF)).toBeNull()
    })
  })

  describe("caption and empty states", () => {
    it("counts the server's total, not the rows on the page", async () => {
      renderPolicies(client({ "policies.list": { ...POLICIES, total: 60 } }))
      await screen.findByText(HEALTHY)
      expect(screen.getAllByText("60 policies").length).toBeGreaterThan(0)
      expect(screen.queryByText("9 policies")).toBeNull()
    })

    it("says one policy in the singular", async () => {
      renderPolicies(
        client({ "policies.list": { ...POLICIES, items: [POLICIES.items[0]], total: 1 } })
      )
      await screen.findByText(HEALTHY)
      expect(screen.getAllByText("1 policy").length).toBeGreaterThan(0)
    })

    it("counts zero at zero rows and says nothing exists yet", async () => {
      renderPolicies(client({ "policies.list": EMPTY }))
      expect(await screen.findByText("No policies yet.")).toBeTruthy()
      expect(screen.getByText("0 policies")).toBeTruthy()
    })

    it("says which kind of empty it is", async () => {
      renderPolicies(client({ "policies.list": EMPTY }))
      await screen.findByText("No policies yet.")

      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      expect(await screen.findByText("No policies in eng/platform.")).toBeTruthy()
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
      expect(await screen.findByText("No policies in the tenant root.")).toBeTruthy()
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "all" } })
      await screen.findByText("No policies yet.")

      fireEvent.change(screen.getByLabelText("Effect"), { target: { value: "deny" } })
      expect(await screen.findByText("No deny policies found.")).toBeTruthy()
      expect(screen.queryByText("No policies yet.")).toBeNull()

      fireEvent.change(screen.getByLabelText("Active"), { target: { value: "false" } })
      expect(await screen.findByText("No inactive deny policies found.")).toBeTruthy()

      fireEvent.change(screen.getByLabelText("Search policies"), { target: { value: "zzz" } })
      expect(await screen.findByText(/No inactive deny policies match .zzz./)).toBeTruthy()
    })
  })

  describe("filtering", () => {
    it("sends no filter field at all until one is set", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPolicies(c)
      await screen.findByText(HEALTHY)
      const params = lastList(sent)
      expect(params).toEqual({ limit: 25, offset: 0 })
      // toEqual ignores undefined-valued keys, so assert the keys too.
      expect(Object.keys(params ?? {}).sort()).toEqual(["limit", "offset"])
    })

    /** Each filter: how to set it, what reaches the wire, how to clear it. */
    const FILTERS: [
      name: string,
      label: string,
      set: string,
      wire: Record<string, unknown>,
      clear: string,
    ][] = [
      ["namespace", "Namespace", "eng/platform", { namespacePath: "eng/platform" }, "all"],
      ["effect", "Effect", "deny", { effect: "deny" }, ""],
      ["active", "Active", "true", { isActive: true }, ""],
      ["inactive", "Active", "false", { isActive: false }, ""],
      // Padded, to pin that the wire carries the trimmed value.
      ["search", "Search policies", "  admin  ", { search: "admin" }, "   "],
    ]

    it.each(FILTERS)(
      "sends the %s filter, goes back to the first page, and drops it when cleared",
      async (_name, label, set, wire, clear) => {
        const { client: c, sent } = recordingQueryClient(
          answers({ "policies.list": { ...POLICIES, total: 60 } })
        )
        renderPolicies(c)
        await screen.findByText(HEALTHY)
        fireEvent.click(screen.getByRole("button", { name: /next page/i }))
        await waitFor(() => expect(lastList(sent)?.offset).toBe(25))

        fireEvent.change(screen.getByLabelText(label), { target: { value: set } })
        await waitFor(() => expect(lastList(sent)).toEqual({ ...wire, limit: 25, offset: 0 }))
        expect(Object.keys(lastList(sent) ?? {}).sort()).toEqual(
          [...Object.keys(wire), "limit", "offset"].sort()
        )

        // Clearing it takes the field back off the wire rather than sending "".
        fireEvent.change(screen.getByLabelText(label), { target: { value: clear } })
        await waitFor(() =>
          expect(Object.keys(lastList(sent) ?? {}).sort()).toEqual(["limit", "offset"])
        )
      }
    )

    it("sends the tenant root as an empty namespace, which is not all of them", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPolicies(c)
      await screen.findByText(HEALTHY)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "" } })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({ namespacePath: "", limit: 25, offset: 0 })
      )
    })

    it("sends every filter together", async () => {
      const { client: c, sent } = recordingQueryClient(answers())
      renderPolicies(c)
      await screen.findByText(HEALTHY)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      fireEvent.change(screen.getByLabelText("Effect"), { target: { value: "allow" } })
      fireEvent.change(screen.getByLabelText("Active"), { target: { value: "true" } })
      fireEvent.change(screen.getByLabelText("Search policies"), { target: { value: "doc" } })
      await waitFor(() =>
        expect(lastList(sent)).toEqual({
          namespacePath: "eng/platform",
          effect: "allow",
          isActive: true,
          search: "doc",
          limit: 25,
          offset: 0,
        })
      )
    })
  })

  describe("creating", () => {
    it("says a new policy starts inactive", async () => {
      renderPolicies(client())
      const dialog = await openCreate()
      expect(
        dialog.getByText("It starts inactive, so it takes no effect until you activate it.")
      ).toBeTruthy()
    })

    it("waits for a name and an effect before it can be confirmed", async () => {
      renderPolicies(client())
      const dialog = await openCreate()
      const confirm = () => dialog.getByRole("button", { name: CREATE }) as HTMLButtonElement
      expect(confirm().disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "  " } })
      fireEvent.change(dialog.getByLabelText("Effect"), { target: { value: "deny" } })
      expect(confirm().disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "block-all" } })
      expect(confirm().disabled).toBe(false)
      fireEvent.change(dialog.getByLabelText("Effect"), { target: { value: "" } })
      expect(confirm().disabled).toBe(true)
    })

    it("offers only the two effects the server accepts", async () => {
      renderPolicies(client())
      const dialog = await openCreate()
      const options = Array.from(
        (dialog.getByLabelText("Effect") as HTMLSelectElement).options
      ).map((o) => o.value)
      expect(options).toEqual(["", "allow", "deny"])
    })

    it("sends exactly name, effect and namespacePath, trimmed", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "policies.create": { id: "pol_new" },
      })
      renderPolicies(c)
      const dialog = await openCreate()
      fillCreate(dialog, "  block-all  ", "deny")
      fireEvent.change(dialog.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.intent).toBe("policies.create")
      const payload = sent[0]?.payload as Record<string, unknown>
      expect(payload).toEqual({
        name: "block-all",
        effect: "deny",
        namespacePath: "eng/platform",
      })
      // toEqual ignores undefined-valued keys, so assert the keys themselves.
      expect(Object.keys(payload).sort()).toEqual(["effect", "name", "namespacePath"])
    })

    it("writes into the tenant root by default, sending an empty namespace", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "policies.create": { id: "pol_new" },
      })
      renderPolicies(c)
      const dialog = await openCreate()
      const select = dialog.getByLabelText("Namespace") as HTMLSelectElement
      expect(select.value).toBe("")
      expect(select.selectedOptions[0]?.textContent).toBe("Tenant root")
      fillCreate(dialog)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      expect(sent[0]?.payload).toEqual({ name: "block-all", effect: "deny", namespacePath: "" })
    })

    it("starts from the namespace already selected on the page", async () => {
      renderPolicies(client())
      await screen.findByText(HEALTHY)
      fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "eng/platform" } })
      const dialog = await openCreate()
      expect((dialog.getByLabelText("Namespace") as HTMLSelectElement).value).toBe("eng/platform")
    })

    it("navigates to the new policy's edit route once it is created", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), {
        "policies.create": { id: "pol_new" },
      })
      const navigate = renderPolicies(c)
      const dialog = await openCreate()
      fillCreate(dialog)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
      // Exactly the edit route, not the detail page and not a query string.
      expect(navigate).toHaveBeenCalledWith("/policies/pol_new/edit")
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    })

    it("does not navigate when the create is refused, and keeps what was typed", async () => {
      const c = refusingCommands(new ContractError("BAD_REQUEST", "A policy needs a name."))
      const navigate = renderPolicies(c)
      const dialog = await openCreate()
      fillCreate(dialog, "block-all", "deny")
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))

      // The refusal renders inside the dialog: Base UI makes everything
      // outside an open dialog inert.
      const alert = await dialog.findByRole("alert")
      expect(alert.textContent).toContain("A policy needs a name.")
      expect(screen.getByRole("alertdialog")).toBeTruthy()
      expect((dialog.getByLabelText("Name") as HTMLInputElement).value).toBe("block-all")
      expect((dialog.getByLabelText("Effect") as HTMLSelectElement).value).toBe("deny")
      expect(navigate).not.toHaveBeenCalled()
    })

    it("clears an earlier refusal and the typed form when the dialog is opened again", async () => {
      renderPolicies(refusingCommands(new ContractError("BAD_REQUEST", "A policy needs a name.")))
      const first = await openCreate()
      fillCreate(first)
      fireEvent.click(first.getByRole("button", { name: CREATE }))
      await first.findByRole("alert")

      fireEvent.click(first.getByRole("button", { name: /^cancel$/i }))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())

      const second = await openCreate()
      expect(second.queryByRole("alert")).toBeNull()
      expect((second.getByLabelText("Name") as HTMLInputElement).value).toBe("")
      expect((second.getByLabelText("Effect") as HTMLSelectElement).value).toBe("")
    })

    it("shows the create as pending while the command is in flight", async () => {
      const pending = {
        ...client(),
        command: () => new Promise<never>(() => {}),
      } as ScopedClient
      renderPolicies(pending)
      const dialog = await openCreate()
      fillCreate(dialog)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      const working = (await dialog.findByRole("button", { name: /working/i })) as HTMLButtonElement
      expect(working.disabled).toBe(true)
      expect((dialog.getByRole("button", { name: /^cancel$/i }) as HTMLButtonElement).disabled).toBe(true)
    })

    it("stays on the list when the server acknowledges without an id", async () => {
      const { client: c, sent } = recordingCommandClient(answers(), { "policies.create": {} })
      const navigate = renderPolicies(c)
      const dialog = await openCreate()
      fillCreate(dialog)
      fireEvent.click(dialog.getByRole("button", { name: CREATE }))
      await waitFor(() => expect(sent).toHaveLength(1))
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
      expect(navigate).not.toHaveBeenCalled()
    })
  })
})
