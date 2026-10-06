import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ReviewChanges } from "../src/workspace/review-changes"
import type { ReviewChangesProps } from "../src/workspace/review-changes"
import { changesBetween, draftOf } from "../src/workspace/draft"
import type { Draft } from "../src/workspace/draft"
import { templateDetail } from "./data"

vi.mock("../src/components/editor/field-diff", async () => ({ default: (await import("./editor-stand-in")).DiffStandIn }))

afterEach(cleanup)

const detail = templateDetail()
const EN = detail.versions[1].id

function setup(draftOver: (d: Draft) => Draft, over: Partial<ReviewChangesProps> = {}) {
  const saved = draftOf(detail)
  const draft = draftOver(saved)
  const onSave = vi.fn()
  render(<ReviewChanges open onOpenChange={vi.fn()} template={detail} saved={saved} draft={draft} changes={changesBetween(saved, draft)} saving={false} canSave onSave={onSave} {...over} />)
  return { onSave }
}

describe("ReviewChanges", () => {
  it("diffs each changed field against what's saved, named by field and version", async () => {
    setup((d) => ({ ...d, versions: { ...d.versions, [EN]: { ...d.versions[EN], html: "<p>New</p>" } } }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "HTML, the en version" })).toBeTruthy()
    expect((await within(dialog).findByLabelText("HTML, the en version")).textContent).toBe("- <p>Thanks {{.customer_name}}</p>\n+ <p>New</p>")
  })

  it("diffs the variables as JSON and states each changed setting", async () => {
    setup((d) => ({ ...d, variables: d.variables.slice(0, 1), settings: { ...d.settings, name: "Receipts", enabled: false } }))
    const dialog = screen.getByRole("dialog")
    expect((await within(dialog).findByLabelText("Variables")).textContent).toContain('"name": "amount"')
    expect(within(dialog).getByText("Was Receipt, now Receipts.")).toBeTruthy()
    expect(within(dialog).getByText("Was on, now off.")).toBeTruthy()
  })

  it("counts the changes and saves from the dialog", () => {
    const { onSave } = setup((d) => ({ ...d, settings: { ...d.settings, category: "marketing" } }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("1 change against what's saved.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))
    expect(onSave).toHaveBeenCalled()
  })

  it("holds Save while saving or blocked", () => {
    setup((d) => ({ ...d, settings: { ...d.settings, category: "marketing" } }), { saving: true })
    expect((within(screen.getByRole("dialog")).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
