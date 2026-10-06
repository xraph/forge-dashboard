import { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { FieldDiff } from "../components/editor/lazy"
import { plural } from "../format"
import type { TemplateDetail } from "../wire"
import type { Change, Draft, Settings } from "./draft"
import { normaliseVariables } from "./draft"
import { FIELD_LABEL, FIELD_LANGUAGE } from "./fields"
import { versionName } from "./resolve"

export interface ReviewChangesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: TemplateDetail
  saved: Draft
  draft: Draft
  changes: Change[]
  saving: boolean
  canSave: boolean
  onSave: () => void
  /** A save that stopped, shown where the operator started it. */
  error?: ContractError
  errorTitle?: string
}

const SETTING_LABEL: Record<keyof Settings, string> = { name: "Name", category: "Category", enabled: "Enabled" }

const settingText = (key: keyof Settings, value: Settings[keyof Settings]) => (key === "enabled" ? (value ? "on" : "off") : String(value) === "" ? "empty" : String(value))

const variablesText = (draft: Draft["variables"]) => JSON.stringify(normaliseVariables(draft), null, 2)

/** One section per change, so the operator reads exactly what Save will write. */
export function ReviewChanges({ open, onOpenChange, template, saved, draft, changes, saving, canSave, onSave, error, errorTitle }: ReviewChangesProps) {
  const titleOf = (c: Change) => {
    if (c.kind === "variables") return "Variables"
    if (c.kind === "setting") return SETTING_LABEL[c.key]
    const locale = template.versions.find((v) => v.id === c.versionId)?.locale ?? ""
    return `${FIELD_LABEL[c.field]}, ${versionName(locale)}`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>{changes.length === 0 ? "Nothing to review: the page matches what's saved." : `${plural(changes.length, "change")} against what's saved.`}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {changes.map((c) => {
            const title = titleOf(c)
            return (
              <section key={title} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{title}</h3>
                {c.kind === "field" ? (
                  <FieldDiff was={saved.versions[c.versionId][c.field]} now={draft.versions[c.versionId][c.field]} label={title} language={FIELD_LANGUAGE[c.field]} />
                ) : c.kind === "variables" ? (
                  <FieldDiff was={variablesText(saved.variables)} now={variablesText(draft.variables)} label={title} language="json" />
                ) : (
                  <p className="text-sm">
                    Was {settingText(c.key, saved.settings[c.key])}, now {settingText(c.key, draft.settings[c.key])}.
                  </p>
                )}
              </section>
            )
          })}
        </div>
        <CommandAlert error={error} title={errorTitle ?? ""} />
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!canSave || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
