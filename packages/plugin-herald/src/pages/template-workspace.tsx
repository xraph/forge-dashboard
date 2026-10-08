import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { ContractError, usePluginClient, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { plural } from "../format"
import { useUnsavedGuard } from "../use-unsaved-guard"
import type { SendResolveResponse, TemplateResponse, TemplatesDetailResponse, VersionResponse, VersionWire } from "../wire"
import { ContentTab, revisionKey } from "../workspace/content-tab"
import { changesBetween, draftOf, rebase, templatePatch, variableProblems, versionPatch } from "../workspace/draft"
import type { Draft } from "../workspace/draft"
import { ALL_FIELDS } from "../workspace/fields"
import { LocaleRail } from "../workspace/locale-rail"
import { versionName } from "../workspace/resolve"
import { ReviewChanges } from "../workspace/review-changes"
import { parseSample, sampleDataFor, sampleTextFor } from "../workspace/sample-data"
import { SettingsTab } from "../workspace/settings-tab"
import { VariablesTab } from "../workspace/variables-tab"

interface Snapshot {
  /** The last templates.detail answer adopted. */
  answer: TemplatesDetailResponse
  /** What the server holds, as far as this page knows. */
  saved: Draft
  draft: Draft
  /**
   * Per version and field (`versionId:field`), how many times the server's text
   * replaced a field the page hadn't edited. An editor keyed on it starts over
   * on that text; without it the open editor would keep the old text and the
   * next keystroke would send it back.
   */
  revisions: Record<string, number>
}

interface SaveState {
  saving: boolean
  /** What this save wrote before it stopped or finished, in words. */
  wrote: string[]
  error?: ContractError
  done: boolean
}

const NO_FUNCS: string[] = []
const UNSAVED = "This template has edits that aren't saved. Leave the page and lose them?"

/**
 * The version to show: the selected one; while that isn't in the list yet (a new
 * locale on its way in with the refetch), the one already on screen; else the
 * one the default locale gets, else the live fallback, else any live one, else the first.
 */
function pick(versions: VersionWire[], selectedId: string | null, shownId: string | null, defaultLocale: string | undefined): VersionWire | undefined {
  return versions.find((v) => v.id === selectedId) ?? versions.find((v) => v.id === shownId) ?? versions.find((v) => v.active && v.locale === defaultLocale) ?? versions.find((v) => v.active && v.locale === "") ?? versions.find((v) => v.active) ?? versions[0]
}

/** The revisions after a rebase: one more for every field whose text the rebase changed under the page. */
function bumpRevisions(revisions: Record<string, number>, before: Draft, after: Draft): Record<string, number> {
  const out = { ...revisions }
  for (const [versionId, content] of Object.entries(after.versions)) {
    const was = before.versions[versionId]
    if (!was) continue
    for (const field of ALL_FIELDS) if (content[field] !== was[field]) out[revisionKey(versionId, field)] = (out[revisionKey(versionId, field)] ?? 0) + 1
  }
  return out
}

const listOf = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`)

export function TemplateWorkspacePage({ params }: PluginPageProps) {
  const id = params.id ?? ""
  if (id === "") {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Template" />
        <p className="text-sm text-muted-foreground">No template ID in the address, so there is nothing to show.</p>
      </section>
    )
  }
  return <Workspace key={id} id={id} />
}

export default TemplateWorkspacePage

function Workspace({ id }: { id: string }) {
  const detail = useQuery<TemplatesDetailResponse>("templates.detail", { id })
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [adopted, setAdopted] = useState<TemplatesDetailResponse | undefined>(undefined)

  // Each new answer is adopted once: the first seeds the draft, later ones are
  // rebased under it so no edit is lost. Adjusted while rendering, guarded on
  // the answer's identity, so it can't loop.
  if (detail.data && detail.data !== adopted) {
    const answer = detail.data
    setAdopted(answer)
    setSnap((prev) => {
      const next = draftOf(answer.template)
      if (prev === null) return { answer, saved: next, draft: next, revisions: {} }
      const draft = rebase(prev.saved, next, prev.draft)
      return { answer, saved: next, draft, revisions: bumpRevisions(prev.revisions, prev.draft, draft) }
    })
  }

  if (snap === null) {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Template" />
        <QueryBoundary title="Template" query={detail} skeletonRows={6}>
          {() => null}
        </QueryBoundary>
      </section>
    )
  }
  return <Editor id={id} snap={snap} setSnap={setSnap} reloadError={detail.error} onRetry={detail.refetch} />
}

function Editor({ id, snap, setSnap, reloadError, onRetry }: { id: string; snap: Snapshot; setSnap: Dispatch<SetStateAction<Snapshot | null>>; reloadError?: ContractError; onRetry: () => void }) {
  const client = usePluginClient()
  const engine = useEngineInfo()
  const template = snap.answer.template
  const { saved, draft } = snap
  const [tab, setTab] = useState("content")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [save, setSave] = useState<SaveState>({ saving: false, wrote: [], done: false })
  const inFlight = useRef(false)
  const [sample, setSample] = useState(() => ({ text: sampleTextFor(draft.variables), data: sampleDataFor(draft.variables), error: undefined as string | undefined, key: 0 }))
  const sender = useQuery<SendResolveResponse>("send.resolve", { channel: template.channel })

  const saveTitle = save.wrote.length > 0 ? `Saved ${listOf(save.wrote)}. The rest is still unsaved.` : "Nothing was saved."
  const changes = changesBetween(saved, draft)
  const blocked = variableProblems(draft.variables).size > 0 ? "Fix the variables before saving." : draft.settings.name.trim() === "" ? "A template needs a name before it can be saved." : null
  const canSave = changes.length > 0 && blocked === null && !save.saving
  useUnsavedGuard(changes.length > 0, UNSAVED)

  const [shownId, setShownId] = useState<string | null>(null)
  // Before anything is selected the default pick may still move (engine.info), so only a real selection falls back to what is on screen.
  const current = pick(template.versions, selectedId, selectedId === null ? null : shownId, engine.data?.defaultLocale)
  if (current && current.id !== shownId) setShownId(current.id)
  // The default pick depends on engine.info, which can land after the template.
  // Pin the choice once both have settled so a late answer can't move the editor
  // to another version in the middle of an edit.
  if (selectedId === null && current && (engine.data || engine.error)) setSelectedId(current.id)
  const dirtyIds = new Set(changes.flatMap((c) => (c.kind === "field" ? [c.versionId] : [])))
  const variablesEdited = changes.some((c) => c.kind === "variables")
  const settingsEdited = changes.some((c) => c.kind === "setting")
  const setDraft = (update: (d: Draft) => Draft) => {
    setSnap((s) => (s === null ? s : { ...s, draft: update(s.draft) }))
    // "Saved." describes the page as it was; the next edit makes it stale.
    setSave((s) => (s.done ? { ...s, done: false } : s))
  }

  function changeSample(text: string) {
    const parsed = parseSample(text)
    setSample((s) => ({ ...s, text, data: parsed.ok ? parsed.data : s.data, error: parsed.ok ? undefined : parsed.message }))
  }

  function refillSample() {
    setSample((s) => ({ text: sampleTextFor(draft.variables), data: sampleDataFor(draft.variables), error: undefined, key: s.key + 1 }))
  }

  /**
   * Every changed version, changed fields only, then the variables and
   * settings in one templates.update. Stops at the first refusal and says what
   * it had written. The patches come from the snapshot at the click; anything
   * typed while saving stays a change.
   */
  async function saveAll() {
    if (!canSave || inFlight.current) return
    inFlight.current = true
    const start = snap
    const wrote: string[] = []
    setSave({ saving: true, wrote: [], done: false })
    try {
      for (const v of template.versions) {
        const was = start.saved.versions[v.id]
        const now = start.draft.versions[v.id]
        if (!was || !now) continue
        const patch = versionPatch(was, now)
        if (!patch) continue
        await client.command<VersionResponse>("versions.update", { templateId: id, versionId: v.id, ...patch })
        // Advance only the fields that were sent: another field may have changed elsewhere, and the refetch brings that through rebase.
        setSnap((s) => (s === null ? s : { ...s, saved: { ...s.saved, versions: { ...s.saved.versions, [v.id]: { ...s.saved.versions[v.id], ...patch } } } }))
        wrote.push(versionName(v.locale))
      }
      const patch = templatePatch(start.saved, start.draft)
      if (patch) {
        await client.command<TemplateResponse>("templates.update", { id, ...patch })
        const sent = start.draft
        setSnap((s) =>
          s === null
            ? s
            : {
                ...s,
                saved: {
                  ...s.saved,
                  settings: {
                    name: patch.name !== undefined ? sent.settings.name : s.saved.settings.name,
                    category: patch.category !== undefined ? sent.settings.category : s.saved.settings.category,
                    enabled: patch.enabled !== undefined ? sent.settings.enabled : s.saved.settings.enabled,
                  },
                  variables: patch.variables !== undefined ? sent.variables : s.saved.variables,
                },
              },
        )
        if (patch.variables) wrote.push("the variables")
        if (patch.name !== undefined || patch.category !== undefined || patch.enabled !== undefined) wrote.push("the settings")
      }
      setSave({ saving: false, wrote, done: true })
      setReviewing(false)
    } catch (err) {
      const error = err instanceof ContractError ? err : new ContractError("TRANSPORT", String(err))
      setSave({ saving: false, wrote, error, done: false })
    } finally {
      inFlight.current = false
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <HeraldHeader
        title={draft.settings.name.trim() || template.name}
        meta={
          <>
            <span className="font-mono text-xs">{template.slug}</span>
            <span>{template.channel}</span>
            <Badge variant="outline">{template.isSystem ? "System" : "Custom"}</Badge>
            <EnabledBadge enabled={template.enabled} />
          </>
        }
        actions={
          <>
            <IconButton type="button" variant="outline" disabled={changes.length === 0} onClick={() => setReviewing(true)} label={changes.length === 0 ? "Review changes" : `Review ${plural(changes.length, "change")}`} />
            <Button type="button" disabled={!canSave} onClick={() => void saveAll()}>
              {save.saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      {changes.length > 0 && blocked && <p className="text-sm text-destructive">{blocked}</p>}
      {/* Always mounted, text set later: a live region announces what changes inside it. */}
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {save.done && changes.length === 0 ? "Saved." : ""}
      </p>
      {!reviewing && <CommandAlert error={save.error} title={saveTitle} />}
      {reloadError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          <span>
            This template didn't reload: {reloadError.code}: {reloadError.message}. Your edits are still on the page.
          </span>
          <IconButton type="button" variant="outline" onClick={onRetry} label="Try again" />
        </div>
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="variables">
            Variables{variablesEdited && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
          </TabsTrigger>
          <TabsTrigger value="settings">
            Settings{settingsEdited && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_minmax(0,24rem)]">
            <LocaleRail
              template={template}
              selectedId={current?.id ?? ""}
              onSelect={setSelectedId}
              dirtyIds={dirtyIds}
              copyFrom={current ? draft.versions[current.id] : undefined}
              copyName={current ? versionName(current.locale) : ""}
              onCreated={(v) => setSelectedId(v.id)}
            />
            {current && draft.versions[current.id] ? (
              <ContentTab
                key={current.id}
                templateId={id}
                channel={template.channel}
                version={current}
                content={draft.versions[current.id]}
                revisions={snap.revisions}
                onFieldChange={(field, text) => {
                  // Typing into the shown version fixes the choice, whatever engine.info says later.
                  setSelectedId(current.id)
                  setDraft((d) => ({ ...d, versions: { ...d.versions, [current.id]: { ...d.versions[current.id], [field]: text } } }))
                }}
                variables={draft.variables}
                variablesEdited={variablesEdited}
                funcs={engine.data?.templateFuncs ?? NO_FUNCS}
                sampleText={sample.text}
                sampleData={sample.data}
                sampleError={sample.error}
                sampleKey={sample.key}
                onSampleChange={changeSample}
                onSampleRefill={refillSample}
                from={sender.data?.from}
              />
            ) : (
              <p className="text-sm text-muted-foreground xl:col-span-2">This template has no versions yet. Add a locale to start writing.</p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="variables" className="mt-4">
          <VariablesTab variables={draft.variables} onChange={(variables) => setDraft((d) => ({ ...d, variables }))} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab template={template} settings={draft.settings} onChange={(settings) => setDraft((d) => ({ ...d, settings }))} />
        </TabsContent>
      </Tabs>
      <ReviewChanges open={reviewing} onOpenChange={setReviewing} template={template} saved={saved} draft={draft} changes={changes} saving={save.saving} canSave={canSave} onSave={() => void saveAll()} error={save.error} errorTitle={saveTitle} />
    </section>
  )
}
