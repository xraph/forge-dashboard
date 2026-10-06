import { useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { VersionBadge } from "../badges"
import { LOCALE_PATTERN } from "../format"
import { useDebounced } from "../use-debounced"
import type { Content, DeleteResponse, TemplateDetail, TemplatesResolveResponse, VersionResponse, VersionsCreateRequest, VersionWire } from "../wire"
import { answerText, answersFor, versionName, withActive, without } from "./resolve"
import type { Answers } from "./resolve"

export interface LocaleRailProps {
  /** The template as saved: versions with their live switches. */
  template: TemplateDetail
  selectedId: string
  onSelect: (versionId: string) => void
  /** Versions with unsaved edits. */
  dirtyIds: ReadonlySet<string>
  /** The selected version's draft content, offered as a new locale's starting text. */
  copyFrom?: Content
  /** How the selected version is said: "the en version". */
  copyName: string
  onCreated: (version: VersionWire) => void
}

/** How a version is named in a control's label: "en version", "fallback version". */
const labelOf = (v: VersionWire) => (v.locale === "" ? "fallback version" : `${v.locale} version`)

const NOWHERE = "A send in a locale with no live version of its own"

function toggleCopy(v: VersionWire, versions: VersionWire[]) {
  const goingLive = !v.active
  if (v.locale === "") {
    return goingLive
      ? { title: "Put the fallback version live?", description: `${NOWHERE} will then get the fallback version.`, confirmLabel: "Put live" }
      : { title: "Take the fallback version offline?", description: `${NOWHERE} will then fail.`, confirmLabel: "Take offline" }
  }
  const after = answerText(withActive(versions, v.id, goingLive), v.locale)
  return goingLive
    ? { title: `Put ${v.locale} live?`, description: `A request for ${v.locale} will then get ${after}.`, confirmLabel: "Put live" }
    : { title: `Take ${v.locale} offline?`, description: `A request for ${v.locale} will then get ${after}.`, confirmLabel: "Take offline" }
}

function deleteCopy(v: VersionWire, versions: VersionWire[], dirty: boolean) {
  const after = v.locale === "" ? `${NOWHERE} will then fail.` : `A request for ${v.locale} will then get ${answerText(without(versions, v.id), v.locale)}.`
  return {
    title: v.locale === "" ? "Delete the fallback version?" : `Delete the ${v.locale} version?`,
    description: `${after} Its content is deleted and can't be brought back.${dirty ? " Its unsaved edits go with it." : ""}`,
    confirmLabel: "Delete version",
  }
}

function AnswersLine({ answers }: { answers: NonNullable<Answers> }) {
  if (answers.kind === "fallback") return <>Answers any locale no other live version takes</>
  return (
    <>
      Answers <span className="font-mono">{answers.locale}</span>
      {answers.wildcard && (
        <>
          , and <span className="font-mono">{answers.wildcard}</span> without a live version of its own
        </>
      )}
    </>
  )
}

type Pending = { kind: "toggle" | "delete"; version: VersionWire; dirty: boolean }

export function LocaleRail({ template, selectedId, onSelect, dirtyIds, copyFrom, copyName, onCreated }: LocaleRailProps) {
  const update = useCommand<VersionResponse>("versions.update")
  const remove = useCommand<DeleteResponse>("versions.delete")
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const versions = template.versions
  const cmd = pending?.kind === "delete" ? remove : update

  function open(kind: Pending["kind"], version: VersionWire) {
    update.reset()
    remove.reset()
    // A snapshot: the dialog keeps naming this version while templates.detail refetches.
    setPending({ kind, version, dirty: dirtyIds.has(version.id) })
    setConfirming(true)
  }

  async function confirm() {
    if (!pending) return
    const v = pending.version
    const result = pending.kind === "toggle" ? await update.execute({ templateId: template.id, versionId: v.id, active: !v.active }) : await remove.execute({ templateId: template.id, versionId: v.id })
    if (result === undefined) return
    setConfirming(false)
  }

  const copy = pending === null ? { title: "", description: "", confirmLabel: "Confirm" } : pending.kind === "toggle" ? toggleCopy(pending.version, versions) : deleteCopy(pending.version, versions, pending.dirty)

  return (
    <aside aria-label="Locales" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Locales</p>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet. Add a locale to start writing.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions.map((v) => {
              const answers = answersFor(v)
              const selected = v.id === selectedId
              return (
                <li key={v.id} className={cn("flex flex-col gap-1.5 rounded-md px-2 py-1.5", selected && "bg-muted")}>
                  <button type="button" aria-current={selected ? "true" : undefined} onClick={() => onSelect(v.id)} className="flex items-center justify-between gap-2 text-left text-sm">
                    <span>
                      {v.locale === "" ? "Fallback" : <span className="font-mono text-xs">{v.locale}</span>}
                      {dirtyIds.has(v.id) && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
                    </span>
                    <VersionBadge active={v.active} />
                  </button>
                  {answers && (
                    <p className="text-xs text-muted-foreground">
                      <AnswersLine answers={answers} />
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch size="sm" aria-label={`Live: ${labelOf(v)}`} checked={v.active} onCheckedChange={() => open("toggle", v)} />
                    <Button type="button" size="xs" variant="ghost" aria-label={`Delete ${labelOf(v)}`} onClick={() => open("delete", v)}>
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setAddKey((k) => k + 1)
            setAdding(true)
          }}
        >
          Add locale
        </Button>
      </div>
      <LocaleTester templateId={template.id} versions={versions} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && cmd.loading) return
          setConfirming(next)
        }}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        destructive={pending?.kind === "delete" || (pending?.kind === "toggle" && pending.version.active)}
        pending={cmd.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={cmd.error} title={pending?.kind === "delete" ? "Could not delete the version" : "Could not change the version"} />
      </ConfirmDialog>
      <AddLocaleDialog
        key={addKey}
        open={adding}
        onOpenChange={setAdding}
        template={template}
        copyFrom={copyFrom}
        copyName={copyName}
        onCreated={(v) => {
          setAdding(false)
          onCreated(v)
        }}
      />
    </aside>
  )
}

function AddLocaleDialog({ open, onOpenChange, template, copyFrom, copyName, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; template: TemplateDetail; copyFrom?: Content; copyName: string; onCreated: (v: VersionWire) => void }) {
  const create = useCommand<VersionResponse>("versions.create")
  const [locale, setLocale] = useState("")
  const [copy, setCopy] = useState(true)
  const value = locale.trim()
  const bad = value !== "" && !LOCALE_PATTERN.test(value)
  const taken = template.versions.some((v) => v.locale === value)
  const hasFallback = template.versions.some((v) => v.locale === "")
  const canCreate = !create.loading && !bad && !taken

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return
    const from = copy && copyFrom ? copyFrom : { subject: "", html: "", text: "", title: "" }
    const request: VersionsCreateRequest = { templateId: template.id, locale: value, subject: from.subject, html: from.html, text: from.text, title: from.title, active: false }
    const result = await create.execute(request)
    if (result === undefined) return
    onCreated(result.version)
  }

  const hint = bad ? "A locale is a tag like en or pt-BR." : taken ? (value === "" ? "This template already has a fallback version." : `This template already has a ${value} version.`) : hasFallback ? "A tag like fr or pt-BR." : "A tag like fr or pt-BR. Leave it empty to add the fallback version, which answers any locale without one."

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.loading) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a locale</DialogTitle>
            <DialogDescription>The new version starts inactive, so it answers nothing until you put it live.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-locale">Locale</Label>
            <Input
              id="new-locale"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              value={locale}
              aria-invalid={bad || taken || undefined}
              onChange={(e) => {
                create.reset()
                setLocale(e.target.value)
              }}
            />
            <p className={bad || taken ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint}</p>
          </div>
          {copyFrom && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={copy} onCheckedChange={(checked) => setCopy(checked === true)} aria-label={`Start from ${copyName}'s content`} />
              <span aria-hidden="true">Start from {copyName}'s content</span>
            </label>
          )}
          <CommandAlert error={create.error} title="Could not add the locale" />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.loading} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {create.loading ? "Adding…" : "Add locale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The resolution ladder: the steps Herald takes for a locale, as a spine with
 * a node per attempt. Hollow where no live version answered, filled where one
 * did, destructive where nothing did and the send fails. It's the only place
 * locale fallback is visible, so it's the one bold element on the page.
 */
function Ladder({ answer, versions }: { answer: TemplatesResolveResponse; versions: VersionWire[] }) {
  const answered = answer.versionId === null ? undefined : versions.find((v) => v.id === answer.versionId)
  const node = "absolute top-1 -left-[1.4rem] size-2.5 rounded-full border-2"
  return (
    <ol aria-label={`How ${answer.locale} resolves`} className="ml-1.5 flex flex-col gap-3 border-l pl-4 text-xs">
      {answer.steps.map((s, i) => (
        <li key={i} className="relative">
          <span aria-hidden="true" className={cn(node, s.found ? "border-foreground bg-foreground" : "border-muted-foreground bg-background")} />
          <p>
            Tries {s.try === "" ? "the fallback" : <span className="font-mono">{s.try}</span>}
            {s.match === "language" && <span className="text-muted-foreground"> (its language)</span>}
          </p>
          <p className="text-muted-foreground">{s.found ? "A live version answers." : "No live version."}</p>
        </li>
      ))}
      <li className="relative font-medium">
        <span aria-hidden="true" className={cn(node, answered ? "border-foreground bg-foreground" : "border-destructive bg-destructive")} />
        {answered ? (
          <>Answered by {versionName(answered.locale)}.</>
        ) : (
          <span className="text-destructive">
            Nothing answers it, so a send in <span className="font-mono">{answer.locale}</span> fails.
          </span>
        )}
      </li>
    </ol>
  )
}

/** templates.resolve, 300ms after typing stops. The ladder names the answering version from the rail's own list. */
function LocaleTester({ templateId, versions }: { templateId: string; versions: VersionWire[] }) {
  const [typed, setTyped] = useState("")
  const locale = useDebounced(typed.trim(), 300)
  const valid = LOCALE_PATTERN.test(locale)
  const answer = useQuery<TemplatesResolveResponse>("templates.resolve", { id: templateId, locale }, { enabled: valid })
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="locale-test">Test a locale</Label>
      <Input id="locale-test" className="font-mono text-xs" placeholder="fr-CA" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      {locale !== "" && !valid && <p className="text-xs text-destructive">A locale is a tag like en or pt-BR.</p>}
      {valid && answer.error && (
        <p className="text-xs text-destructive">
          {answer.error.code}: {answer.error.message}
        </p>
      )}
      {valid && answer.data && <Ladder answer={answer.data} versions={versions} />}
    </div>
  )
}
