import { useState } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { CATEGORIES } from "../format"
import { templatesPath } from "../keys"
import type { DeleteResponse, TemplateDetail } from "../wire"
import type { Settings } from "./draft"

/** What happens to the versions, in words that agree with the count. */
function versionsLine(count: number) {
  if (count === 0) return "It has no versions"
  if (count === 1) return "Its one version goes with it"
  return `Its ${count} versions go with it`
}

export function SettingsTab({ template, settings, onChange }: { template: TemplateDetail; settings: Settings; onChange: (next: Settings) => void }) {
  const remove = useCommand<DeleteResponse>("templates.delete")
  const navigateTo = useNavigateTo()
  const [confirming, setConfirming] = useState(false)
  // A snapshot, so the dialog keeps naming this template while templates.detail refetches into NOT_FOUND.
  const [target, setTarget] = useState<TemplateDetail>(template)

  function openDelete() {
    remove.reset()
    setTarget(template)
    setConfirming(true)
  }

  async function confirm() {
    const result = await remove.execute({ id: target.id })
    if (result === undefined) return
    setConfirming(false)
    navigateTo(templatesPath)
  }

  const nameMissing = settings.name.trim() === ""

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input id="template-name" value={settings.name} aria-invalid={nameMissing || undefined} aria-describedby={nameMissing ? "template-name-problem" : undefined} onChange={(e) => onChange({ ...settings, name: e.target.value })} />
        {nameMissing && <p id="template-name-problem" className="text-xs text-destructive">A template needs a name.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-category">Category</Label>
        <NativeSelect id="template-category" value={settings.category} onChange={(e) => onChange({ ...settings, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch aria-label="Enabled" checked={settings.enabled} onCheckedChange={(checked) => onChange({ ...settings, enabled: checked })} />
          <span aria-hidden="true">Enabled</span>
        </label>
        <p className="text-xs text-muted-foreground">A disabled template refuses every send that names it.</p>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Slug</dt>
        <dd className="font-mono text-xs">{template.slug}</dd>
        <dt className="text-muted-foreground">Channel</dt>
        <dd>{template.channel}</dd>
        <dt className="text-muted-foreground">Origin</dt>
        <dd>{template.isSystem ? "System" : "Custom"}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">Slug and channel can't change: callers send by slug, and the pair is the template's identity. To change either, create a new template.</p>
      <div className="flex flex-col gap-2 border-t pt-4">
        <Button type="button" variant="destructive" className="w-fit" onClick={openDelete}>
          Delete template
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && remove.loading) return
          setConfirming(next)
        }}
        title={`Delete ${target.name}?`}
        description={`Sends that name ${target.slug} on ${target.channel} will fail. ${versionsLine(target.versions.length)}, and this can't be undone.${target.isSystem ? " Resetting system templates brings it back." : ""}`}
        confirmLabel="Delete template"
        pending={remove.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={remove.error} title="Could not delete the template" />
      </ConfirmDialog>
    </div>
  )
}
