import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import type { PolicySummary } from "../types"
import { DurationField } from "../components/duration-field"
import { categoryProblem, durationProblem, goDuration } from "../policy"
import type { DurationUnit } from "../policy"

export { categoryProblem }

export const PolicyCreatePage: ComponentType<PluginPageProps> = () => {
  const save = useCommand<PolicySummary>("retention.savePolicy")
  const navigateTo = useNavigateTo()
  const [category, setCategory] = useState("")
  const [amount, setAmount] = useState("")
  const [unit, setUnit] = useState<DurationUnit>("days")
  const [archive, setArchive] = useState(false)

  // Not shown while the field is empty: a red "required" on a form nobody has touched is noise.
  const cProblem = category === "" ? null : categoryProblem(category)
  const ready =
    !save.loading &&
    category !== "" &&
    cProblem === null &&
    amount !== "" &&
    durationProblem(amount, unit) === null

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter in a field submits the form whatever the button says.
    if (!ready) return
    const result = await save.execute({
      category,
      duration: goDuration(amount, unit),
      archive,
    })
    // execute resolves undefined only when the command failed, and the error is already on `save`.
    if (result === undefined) return
    navigateTo(`/retention/${encodeURIComponent(result.id)}`)
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New retention policy"
        description="Events in the category are removed once they are older than the duration."
      />
      <CommandAlert
        title="Could not save the policy"
        error={
          save.error?.code === "CONFLICT"
            ? {
                code: save.error.code,
                message:
                  "A policy for this category already exists in your scope.",
              }
            : save.error
        }
      />
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-w-lg min-w-0 flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="policy-category">Category</Label>
          <Input
            id="policy-category"
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
            value={category}
            aria-invalid={cProblem !== null}
            onChange={(e) => setCategory(e.target.value)}
          />
          {cProblem && <p className="text-sm text-destructive">{cProblem}</p>}
          <p className="text-xs text-muted-foreground">
            A category of * means every category, not a default: it removes
            events of every category, and a short wildcard overrides a longer
            specific policy for its category.
          </p>
        </div>
        <DurationField
          amount={amount}
          unit={unit}
          onChange={(a, u) => {
            setAmount(a)
            setUnit(u)
          }}
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id="policy-archive"
            checked={archive}
            onCheckedChange={(checked) => setArchive(checked === true)}
          />
          <Label htmlFor="policy-archive">
            Archive events before removing them
          </Label>
        </div>
        <p className="text-sm">
          A policy saved by an app-wide operator has no tenant, so it removes
          events from every tenant in the app.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={!ready}>
            {save.loading ? "Saving…" : "Save policy"}
          </Button>
          <PluginLink
            to="/retention"
            className="self-center text-sm underline underline-offset-4"
          >
            Cancel
          </PluginLink>
        </div>
      </form>
    </section>
  )
}
