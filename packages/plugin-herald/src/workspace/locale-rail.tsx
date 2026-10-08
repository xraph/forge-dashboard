import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useRef, useState } from "react"
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
import { answerText, answersFor, explainLocale, versionName, withActive, without } from "./resolve"
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

const ANY_OTHER = "A send in any locale no other live version takes"

/** The `L-*` tag a bare language's regional requests stand for: it matches no version, so resolution walks language then fallback. */
const regionsOf = (locale: string) => (locale === "" || locale.includes("-") ? null : `${locale}-*`)

/** What requests for a version's locale, and for its regions when it's a bare language, get among `after`. */
function afterText(v: VersionWire, after: VersionWire[]) {
  const regions = regionsOf(v.locale)
  const own = `A request for ${v.locale} will then get ${answerText(after, v.locale)}.`
  return regions === null ? own : `${own} Requests for ${regions} with no live version of their own will then get ${answerText(after, regions)}.`
}

/** True when the version's own locale, or its regional requests, would be left with nothing to answer them. */
function leavesNothing(v: VersionWire, after: VersionWire[]) {
  const regions = regionsOf(v.locale)
  return explainLocale(after, v.locale).versionId === null || (regions !== null && explainLocale(after, regions).versionId === null)
}

function toggleCopy(v: VersionWire, versions: VersionWire[]) {
  const goingLive = !v.active
  if (v.locale === "") {
    return goingLive
      ? { title: "Put the fallback version live?", description: `${ANY_OTHER} will then get the fallback version.`, confirmLabel: "Put live", destructive: false }
      : { title: "Take the fallback version offline?", description: `${ANY_OTHER} will then fail.`, confirmLabel: "Take offline", destructive: true }
  }
  const after = withActive(versions, v.id, goingLive)
  return goingLive
    ? { title: `Put ${v.locale} live?`, description: afterText(v, after), confirmLabel: "Put live", destructive: false }
    : { title: `Take ${v.locale} offline?`, description: afterText(v, after), confirmLabel: "Take offline", destructive: leavesNothing(v, after) }
}

function deleteCopy(v: VersionWire, versions: VersionWire[], dirty: boolean) {
  const effect = !v.active ? "Nothing changes for sends, since it isn't live." : v.locale === "" ? `${ANY_OTHER} will then fail.` : afterText(v, without(versions, v.id))
  return {
    title: v.locale === "" ? "Delete the fallback version?" : `Delete the ${v.locale} version?`,
    description: `${effect} Its content is deleted and can't be brought back.${dirty ? " Its unsaved edits go with it." : ""}`,
    confirmLabel: "Delete version",
    destructive: true,
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

/**
 * Focuses once the confirm dialog has left the page. While it is open the rest
 * of the page is inert, and as it closes it hands focus back to the element
 * that opened it, so an earlier focus() would be lost either way.
 */
function focusWhenDialogGone(target: () => HTMLElement | null) {
  let frames = 0
  const tick = () => {
    if (document.querySelector('[role="alertdialog"]') === null || frames++ > 120) target()?.focus()
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** Everything a dialog words itself from, taken when it opens so a refetch can't reword it. */
type Pending = { kind: "toggle" | "delete"; version: VersionWire; versions: VersionWire[]; dirty: boolean }

export function LocaleRail({ template, selectedId, onSelect, dirtyIds, copyFrom, copyName, onCreated }: LocaleRailProps) {
  const update = useCommand<VersionResponse>("versions.update")
  const remove = useCommand<DeleteResponse>("versions.delete")
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const addButton = useRef<HTMLButtonElement>(null)
  const versions = template.versions
  const cmd = pending?.kind === "delete" ? remove : update

  function open(kind: Pending["kind"], version: VersionWire) {
    update.reset()
    remove.reset()
    // A snapshot: the dialog keeps naming this version while templates.detail refetches.
    setPending({ kind, version, versions, dirty: dirtyIds.has(version.id) })
    setConfirming(true)
  }

  async function confirm() {
    if (!pending) return
    const v = pending.version
    const result = pending.kind === "toggle" ? await update.execute({ templateId: template.id, versionId: v.id, active: !v.active }) : await remove.execute({ templateId: template.id, versionId: v.id })
    if (result === undefined) return
    setConfirming(false)
    // The delete button is gone with its version, so focus would fall to the page. Add locale is the next thing a person does here.
    if (pending.kind === "delete") focusWhenDialogGone(() => addButton.current)
  }

  const copy = pending === null ? { title: "", description: "", confirmLabel: "Confirm", destructive: false } : pending.kind === "toggle" ? toggleCopy(pending.version, pending.versions) : deleteCopy(pending.version, pending.versions, pending.dirty)

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
                    <IconButton type="button" variant="ghost" onClick={() => open("delete", v)} label={`Delete ${labelOf(v)}`} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Button
          ref={addButton}
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
        destructive={copy.destructive}
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

  // Nothing typed and a fallback exists: the button is disabled, but the field isn't wrong yet, so no red until there is a value to blame.
  const untouchedTaken = taken && value === ""
  const hint = bad ? "A locale is a tag like en or pt-BR." : untouchedTaken ? "A tag like fr or pt-BR." : taken ? `This template already has a ${value} version.` : hasFallback ? "A tag like fr or pt-BR." : "A tag like fr or pt-BR. Leave it empty to add the fallback version, which answers any locale without one."

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
              aria-invalid={bad || (taken && !untouchedTaken) || undefined}
              aria-describedby="new-locale-hint"
              onChange={(e) => {
                create.reset()
                setLocale(e.target.value)
              }}
            />
            <p id="new-locale-hint" className={bad || (taken && !untouchedTaken) ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {hint}
            </p>
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
  // The server's answer decides answered or failed. The rail's list only names the version, and may lag a refetch behind.
  const answered = answer.versionId !== null
  const hit = answered ? versions.find((v) => v.id === answer.versionId) : undefined
  const named = hit ? hit.locale : answer.steps.filter((s) => s.found).at(-1)?.try ?? ""
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
          <>Answered by {named === "" ? versionName("") : <>the <span className="font-mono">{named}</span> version</>}.</>
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
      <Input id="locale-test" className="font-mono text-xs" placeholder="fr-CA" autoComplete="off" spellCheck={false} value={typed} aria-invalid={(locale !== "" && !valid) || undefined} aria-describedby={locale !== "" && !valid ? "locale-test-problem" : undefined} onChange={(e) => setTyped(e.target.value)} />
      {locale !== "" && !valid && (
        <p id="locale-test-problem" className="text-xs text-destructive">
          A locale is a tag like en or pt-BR.
        </p>
      )}
      {/* Always mounted, content set later: a live region announces what changes inside it. */}
      <div aria-live="polite">
        {valid && answer.error && (
          <p className="text-xs text-destructive">
            {answer.error.code}: {answer.error.message}
          </p>
        )}
        {valid && answer.data && <Ladder answer={answer.data} versions={versions} />}
      </div>
    </div>
  )
}
