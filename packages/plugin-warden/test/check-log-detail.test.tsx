import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { formatTimestamp } from "@forge-go/dashboard-kit/lib/format"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { CheckDetail } from "../src/components/check-log"
import { WardenCheckLogDetailPage } from "../src/pages/check-log-detail"
import { failingClient, recordingQueryClient, renderPage } from "./harness"

const LINKS_NOTE =
  "Each link opens the rule as it is now, which may have changed or been deleted since this check ran."
const CACHED_SENTENCE =
  "Served from the result cache. The engine reused a decision made earlier and evaluated no rule for this check."
const ERROR_SENTENCE =
  "The check failed with this error, so no decision was returned."
const NO_RULE = "No rule is recorded for this decision."

const BASE: CheckDetail = {
  id: "chk_01a",
  namespacePath: "",
  subjectKind: "user",
  subjectId: "alice",
  action: "read",
  resourceType: "document",
  resourceId: "readme",
  decision: "allow",
  evalTimeNs: 412_000,
  cached: false,
  createdAt: "2026-09-23T10:00:00Z",
  matchedBy: [],
  obligations: [],
}

const RBAC_ALLOW: CheckDetail = {
  ...BASE,
  matchedBy: [
    {
      source: "rbac",
      ruleId: "role_01hx",
      detail: "role grants document:read",
    },
  ],
}

function page(detail: CheckDetail) {
  const { client, sent } = recordingQueryClient({ "checkLogs.detail": detail })
  const view = renderPage(WardenCheckLogDetailPage, client, { id: detail.id })
  return { ...view, sent }
}

/** The labelled row whose term reads `term`, as its value cell. */
function row(term: string): HTMLElement {
  const dt = screen.getAllByText(term).find((el) => el.tagName === "DT")!
  return dt.nextElementSibling as HTMLElement
}

async function settled() {
  await screen.findByText("Check")
}

describe("WardenCheckLogDetailPage", () => {
  it("asks for the check named in the route", async () => {
    const t = page(RBAC_ALLOW)
    await settled()
    expect(t.sent.find((s) => s.intent === "checkLogs.detail")?.params).toEqual(
      { id: "chk_01a" }
    )
  })

  it("shows the request line, the namespace and an outline allow, decided by a linked role", async () => {
    const { container } = page(RBAC_ALLOW)
    await settled()
    const header = container.querySelector(
      "[data-slot='page-header']"
    )!.parentElement!
    expect(header.textContent).toContain("user:alice")
    expect(header.textContent).toContain("read")
    expect(header.textContent).toContain("document:readme")
    expect(header.textContent).toContain("in /")
    const badge = screen.getByText("allow", { selector: "[data-slot='badge']" })
    expect(badge.getAttribute("data-variant")).toBe("outline")

    const decided = row("decided by")
    expect(within(decided).getByText("role")).toBeTruthy()
    const link = within(decided).getByRole("link", {
      name: "role grants document:read",
    })
    expect(link.getAttribute("href")).toBe("/roles/role_01hx")
  })

  it("links the request line's subject to its access page, encoded", async () => {
    page({ ...BASE, subjectKind: "api key", subjectId: "a/b" })
    await settled()
    const link = screen.getByRole("link", { name: "api key:a/b" })
    expect(link.getAttribute("href")).toBe("/subjects/api%20key/a%2Fb")
  })

  it("leaves a subject with no kind as plain text in the request line", async () => {
    page({ ...BASE, subjectKind: "" })
    await settled()
    expect(screen.getByText(":alice").closest("a")).toBeNull()
  })

  it("shows a deny_explicit's reason, links its policy, and lists obligations in mono", async () => {
    page({
      ...BASE,
      decision: "deny_explicit",
      reason: 'denied by policy "contractor-lockout"',
      matchedBy: [
        {
          source: "abac",
          ruleId: "pol_01",
          detail: 'policy "contractor-lockout" (deny)',
        },
      ],
      obligations: ["notify-security", "audit-high"],
    })
    await settled()
    const badge = screen.getByText("deny_explicit", {
      selector: "[data-slot='badge']",
    })
    expect(badge.getAttribute("data-variant")).toBe("secondary")
    expect(
      screen.getByText('denied by policy "contractor-lockout"')
    ).toBeTruthy()

    const decided = row("decided by")
    expect(within(decided).getByText("policy")).toBeTruthy()
    const link = within(decided).getByRole("link", {
      name: 'policy "contractor-lockout" (deny)',
    })
    expect(link.getAttribute("href")).toBe("/policies/pol_01")

    const emits = row("emits")
    for (const ob of ["notify-security", "audit-high"]) {
      expect(within(emits).getByText(ob).className).toContain("font-mono")
    }
  })

  it("shows no emits row when there are no obligations", async () => {
    page(RBAC_ALLOW)
    await settled()
    expect(screen.queryByText("emits")).toBeNull()
  })

  it("names a rebac match a relation, with its detail as plain text and no link", async () => {
    page({
      ...BASE,
      matchedBy: [{ source: "rebac", detail: "direct relation" }],
    })
    await settled()
    const decided = row("decided by")
    expect(within(decided).getByText("relation")).toBeTruthy()
    expect(within(decided).getByText("direct relation")).toBeTruthy()
    expect(within(decided).queryByRole("link")).toBeNull()
    expect(screen.queryByText(LINKS_NOTE)).toBeNull()
  })

  it("shows an unknown source raw in mono, never linked, even with a rule id", async () => {
    page({
      ...BASE,
      matchedBy: [{ source: "mystery", ruleId: "x_1", detail: "something" }],
    })
    await settled()
    const decided = row("decided by")
    expect(within(decided).getByText("mystery").className).toContain(
      "font-mono"
    )
    expect(within(decided).queryByRole("link")).toBeNull()
    // No link is rendered, so there is nothing for the note to be about.
    expect(screen.queryByText(LINKS_NOTE)).toBeNull()
  })

  it("says no rule is recorded, and lists nothing, when nothing decided the check", async () => {
    page({
      ...BASE,
      decision: "deny_no_roles",
      reason: 'subject user:alice has no assigned roles in tenant "t"',
    })
    await settled()
    expect(screen.getByText(NO_RULE)).toBeTruthy()
    expect(screen.queryByText("decided by")).toBeNull()
  })

  it("says a cached check evaluated no rule, and labels the time a lookup", async () => {
    page({ ...RBAC_ALLOW, cached: true, evalTimeNs: 1_800 })
    await settled()
    expect(screen.getByText(CACHED_SENTENCE)).toBeTruthy()
    expect(screen.getByText("lookup time")).toBeTruthy()
    expect(screen.queryByText("evaluation time")).toBeNull()
    expect(within(row("lookup time")).getByText("1.8 µs")).toBeTruthy()
  })

  it("puts the cached sentence above decided by, so the matches read as the earlier decision's", async () => {
    page({ ...RBAC_ALLOW, cached: true })
    await settled()
    const sentence = screen.getByText(CACHED_SENTENCE)
    const decidedBy = screen
      .getAllByText("decided by")
      .find((el) => el.tagName === "DT")!
    // DOCUMENT_POSITION_FOLLOWING: decided by comes after the sentence in the document.
    expect(
      sentence.compareDocumentPosition(decidedBy) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("labels an evaluated check's time evaluation time, in milliseconds", async () => {
    page(RBAC_ALLOW)
    await settled()
    expect(screen.queryByText(CACHED_SENTENCE)).toBeNull()
    expect(screen.queryByText("lookup time")).toBeNull()
    expect(within(row("evaluation time")).getByText("0.41 ms")).toBeTruthy()
  })

  it("shows an error check as a destructive badge with its error, and no rule or time", async () => {
    page({
      ...BASE,
      decision: "error",
      error: "warden rbac: store unavailable",
      evalTimeNs: 0,
    })
    await settled()
    const badge = screen.getByText("error", { selector: "[data-slot='badge']" })
    expect(badge.getAttribute("data-variant")).toBe("destructive")
    expect(
      screen.getByText("warden rbac: store unavailable").className
    ).toContain("text-destructive")
    expect(screen.getByText(ERROR_SENTENCE)).toBeTruthy()
    expect(screen.queryByText("decided by")).toBeNull()
    expect(screen.queryByText(NO_RULE)).toBeNull()
    expect(screen.queryByText("evaluation time")).toBeNull()
    expect(screen.queryByText("lookup time")).toBeNull()
  })

  it("says nothing of an error sentence on a check that decided", async () => {
    page(RBAC_ALLOW)
    await settled()
    expect(screen.queryByText(ERROR_SENTENCE)).toBeNull()
  })

  it("shows the links note whenever a link is shown, and not otherwise", async () => {
    const withLink = page(RBAC_ALLOW)
    await settled()
    expect(screen.getByText(LINKS_NOTE)).toBeTruthy()
    withLink.unmount()

    page({
      ...BASE,
      matchedBy: [{ source: "rebac", detail: "direct relation" }],
    })
    await settled()
    expect(screen.queryByText(LINKS_NOTE)).toBeNull()
  })

  it("lists the correlation fields in the aside, the root namespace as a slash", async () => {
    const { container } = page({
      ...RBAC_ALLOW,
      appId: "app_9",
      requestIp: "203.0.113.7",
      requestId: "req_42",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    })
    await settled()
    const aside = within(container.querySelector("aside")!)
    const value = (term: string) =>
      aside.getByText(term).nextElementSibling as HTMLElement
    expect(value("Check id").textContent).toBe("chk_01a")
    expect(value("Namespace").textContent).toBe("/")
    expect(value("App id").textContent).toBe("app_9")
    expect(value("Request IP").textContent).toBe("203.0.113.7")
    expect(value("Request id").textContent).toBe("req_42")
    expect(value("Trace id").textContent).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736"
    )
    expect(value("When").textContent).toBe(
      formatTimestamp("2026-09-23T10:00:00Z")
    )
  })

  it("says none for an absent correlation field, never a blank", async () => {
    const { container } = page(RBAC_ALLOW)
    await settled()
    const aside = within(container.querySelector("aside")!)
    for (const [term, label] of [
      ["App id", "no app id"],
      ["Request IP", "no request ip"],
      ["Request id", "no request id"],
      ["Trace id", "no trace id"],
    ]) {
      const cell = aside.getByText(term).nextElementSibling as HTMLElement
      expect(cell.textContent?.trim()).not.toBe("")
      expect(within(cell).getByLabelText(label)).toBeTruthy()
    }
  })

  it("names a namespace that is not the root in the header and the aside", async () => {
    const { container } = page({ ...RBAC_ALLOW, namespacePath: "eng/platform" })
    await settled()
    expect(container.textContent).toContain("in eng/platform")
    const aside = within(container.querySelector("aside")!)
    expect(
      (aside.getByText("Namespace").nextElementSibling as HTMLElement)
        .textContent
    ).toBe("eng/platform")
  })

  it("renders the query error card, not an empty layout, when the check is not found", async () => {
    renderPage(
      WardenCheckLogDetailPage,
      failingClient(new ContractError("NOT_FOUND", "check log not found")),
      { id: "chk_missing" }
    )
    expect(
      await screen.findByText(/NOT_FOUND: check log not found/)
    ).toBeTruthy()
    expect(screen.getByText("Check unavailable")).toBeTruthy()
    expect(screen.queryByText("decided by")).toBeNull()
    expect(screen.queryByRole("complementary")).toBeNull()
  })

  it("links every check, an error row included, to the playground", async () => {
    for (const check of [
      RBAC_ALLOW,
      { ...BASE, id: "chk_02", decision: "deny_no_roles", reason: "no roles" },
      { ...BASE, id: "chk_03", decision: "error", error: "store unavailable" },
    ]) {
      const { unmount } = page(check)
      await settled()
      const link = screen.getByRole("link", { name: "Open in playground" })
      expect(link.getAttribute("href")).toBe(`/playground/check/${check.id}`)
      unmount()
    }
  })
})
