import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useRef, useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { CustomReportSection, GenerateReportResponse } from "../types"
import { LIMITS } from "../types"
import { PeriodFields, periodPayload, periodProblem } from "../components/period-fields"
import type { PeriodDraft } from "../components/period-fields"

type FilterName = "categories" | "actions" | "severity"
const FILTERS: { name: FilterName; label: string }[] = [
  { name: "categories", label: "Categories" },
  { name: "actions", label: "Actions" },
  { name: "severity", label: "Severity" },
]

interface SectionDraft {
  key: number
  title: string
  notes: string
  categories: string
  actions: string
  severity: string
}

const blank = (key: number): SectionDraft => ({ key, title: "", notes: "", categories: "", actions: "", severity: "" })

/** Counted in characters, as the server counts: an emoji is one, not two. */
const length = (s: string) => [...s].length

/** A comma list as its values: trimmed, with the empty ones dropped. */
export function listOf(text: string): string[] {
  return text
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "")
}

function filterProblem(name: FilterName, text: string): string | null {
  const values = listOf(text)
  if (values.length > LIMITS.customFilterValues) return `Filter on at most ${LIMITS.customFilterValues} ${name}.`
  if (values.some((v) => length(v) > LIMITS.customFilterValue)) return `Each ${name === "categories" ? "category" : name === "actions" ? "action" : "severity"} can be at most ${LIMITS.customFilterValue} characters.`
  return null
}

/** Every problem in one section, keyed by the field it belongs to. */
function sectionProblems(s: SectionDraft): Partial<Record<"title" | "notes" | FilterName, string>> {
  const out: Partial<Record<"title" | "notes" | FilterName, string>> = {}
  if (length(s.title.trim()) > LIMITS.customSectionTitle) out.title = `A section title is at most ${LIMITS.customSectionTitle} characters.`
  if (length(s.notes) > LIMITS.customSectionNotes) out.notes = `Notes are at most ${LIMITS.customSectionNotes} characters.`
  for (const f of FILTERS) {
    const p = filterProblem(f.name, s[f.name])
    if (p) out[f.name] = p
  }
  return out
}

function payloadSection(s: SectionDraft): CustomReportSection {
  const out: CustomReportSection = { title: s.title.trim() }
  for (const f of FILTERS) {
    const values = listOf(s[f.name])
    if (values.length > 0) out[f.name] = values
  }
  const notes = s.notes.trim()
  if (notes !== "") out.notes = notes
  return out
}

export const CustomReportCreatePage: ComponentType<PluginPageProps> = () => {
  const generate = useCommand<GenerateReportResponse>("reports.generateCustom")
  const navigateTo = useNavigateTo()
  const nextKey = useRef(1)
  const [title, setTitle] = useState("")
  const [period, setPeriod] = useState<PeriodDraft>({ from: "", to: "" })
  const [sections, setSections] = useState<SectionDraft[]>([blank(0)])

  // Not shown while a field is empty: a red "required" on a form nobody has touched is noise.
  const titleProblem = length(title.trim()) > LIMITS.customReportTitle ? `A title is at most ${LIMITS.customReportTitle} characters.` : null
  const problems = sections.map(sectionProblems)
  const ready =
    !generate.loading &&
    title.trim() !== "" &&
    titleProblem === null &&
    periodProblem(period) === null &&
    sections.every((s, i) => s.title.trim() !== "" && Object.keys(problems[i]).length === 0)

  function update(key: number, patch: Partial<SectionDraft>) {
    setSections((all) => all.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits the form whatever the button says.
    if (!ready) return
    const p = periodPayload(period)
    const result = await generate.execute({
      title: title.trim(),
      ...(p ? { period: p } : {}),
      sections: sections.map(payloadSection),
    })
    // execute resolves undefined only when the command failed, and the error is already on `generate`.
    if (result === undefined) return
    navigateTo(`/reports/${encodeURIComponent(result.id)}`)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Build a custom report"
        description="Each section lists the events that match its filters. An empty filter matches everything."
      />
      <CommandAlert title="Could not generate the report" error={generate.error} />
      <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="custom-title">Title</Label>
          <Input id="custom-title" autoComplete="off" value={title} aria-invalid={titleProblem !== null} onChange={(e) => setTitle(e.target.value)} />
          {titleProblem && <p className="text-sm text-destructive">{titleProblem}</p>}
        </div>
        <PeriodFields value={period} onChange={setPeriod} idPrefix="custom-period" />
        {sections.map((s, i) => {
          const n = i + 1
          const p = problems[i]
          return (
            <fieldset key={s.key} className="flex flex-col gap-3 rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">{`Section ${n}`}</legend>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`section-${s.key}-title`}>{`Section ${n} title`}</Label>
                <Input id={`section-${s.key}-title`} autoComplete="off" value={s.title} aria-invalid={p.title !== undefined} onChange={(e) => update(s.key, { title: e.target.value })} />
                {p.title && <p className="text-sm text-destructive">{p.title}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`section-${s.key}-notes`}>{`Section ${n} notes`}</Label>
                <Textarea id={`section-${s.key}-notes`} rows={3} value={s.notes} aria-invalid={p.notes !== undefined} onChange={(e) => update(s.key, { notes: e.target.value })} />
                {p.notes && <p className="text-sm text-destructive">{p.notes}</p>}
              </div>
              {FILTERS.map((f) => (
                <div key={f.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={`section-${s.key}-${f.name}`}>{`Section ${n} ${f.label.toLowerCase()}`}</Label>
                  <Input
                    id={`section-${s.key}-${f.name}`}
                    className="font-mono text-xs"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Comma separated, empty for all"
                    value={s[f.name]}
                    aria-invalid={p[f.name] !== undefined}
                    onChange={(e) => update(s.key, { [f.name]: e.target.value })}
                  />
                  {p[f.name] && <p className="text-sm text-destructive">{p[f.name]}</p>}
                </div>
              ))}
              <div>
                <IconButton type="button" variant="outline" disabled={sections.length === 1} onClick={() => setSections((all) => all.filter((x) => x.key !== s.key))} label={`Remove section ${n}`} />
              </div>
            </fieldset>
          )
        })}
        <div className="flex flex-col gap-1.5">
          <div>
            <IconButton type="button" variant="outline" disabled={sections.length >= LIMITS.customReportSections} onClick={() => setSections((all) => [...all, blank(nextKey.current++)])} label="Add section" />
          </div>
          <p className="text-xs text-muted-foreground">{`${sections.length} of ${LIMITS.customReportSections} sections.`}</p>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={!ready}>
            {generate.loading ? "Generating…" : "Generate report"}
          </Button>
          <PluginLink to="/reports" className="self-center text-sm underline underline-offset-4">
            Cancel
          </PluginLink>
        </div>
      </form>
    </section>
  )
}
