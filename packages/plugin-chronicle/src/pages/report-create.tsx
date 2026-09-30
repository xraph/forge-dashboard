import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { PluginLink, useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { GenerateReportResponse } from "../types"
import { PeriodFields, periodPayload, periodProblem } from "../components/period-fields"
import type { PeriodDraft } from "../components/period-fields"

// The wire names, exactly: the stored type for the third is eu_ai_act, but generation takes euaiact.
const TYPES = [
  { value: "soc2", label: "SOC 2" },
  { value: "hipaa", label: "HIPAA" },
  { value: "euaiact", label: "EU AI Act" },
] as const

export const ReportCreatePage: ComponentType<PluginPageProps> = () => {
  const generate = useCommand<GenerateReportResponse>("reports.generate")
  const navigateTo = useNavigateTo()
  const [type, setType] = useState<string>("soc2")
  const [period, setPeriod] = useState<PeriodDraft>({ from: "", to: "" })

  const ready = !generate.loading && periodProblem(period) === null

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits the form whatever the button says.
    if (!ready) return
    const p = periodPayload(period)
    const result = await generate.execute(p ? { type, period: p } : { type })
    // execute resolves undefined only when the command failed, and the error is already on `generate`.
    if (result === undefined) return
    navigateTo(`/reports/${encodeURIComponent(result.id)}`)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Generate a report"
        description="The report reads this scope's events for the period and runs an integrity check over the chain when it is generated."
      />
      <CommandAlert title="Could not generate the report" error={generate.error} />
      <form onSubmit={(e) => void submit(e)} className="flex max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-type">Report type</Label>
          <NativeSelect id="report-type" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <NativeSelectOption key={t.value} value={t.value}>
                {t.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <PeriodFields value={period} onChange={setPeriod} idPrefix="report-period" />
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
