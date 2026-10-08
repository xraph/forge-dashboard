import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useMemo, useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@forge-go/dashboard-kit/components/collapsible"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { CodeEditor } from "../components/editor/lazy"
import type { EditorDiagnostic, FocusRequest } from "../components/editor/types"
import { RenderedPreview } from "../components/preview/rendered-preview"
import { useRenderPreview } from "../components/preview/use-render-preview"
import type { Content, Diagnostic, TemplateField, TemplatesRenderRequest, VariableWire, VersionWire } from "../wire"
import { ALL_FIELDS, FIELD_LABEL, FIELD_LANGUAGE, SINGLE_LINE, fieldsFor } from "./fields"
import { ProblemsList } from "./problems"

export interface ContentTabProps {
  templateId: string
  channel: string
  /** The selected version as saved: its ID, locale and live switch. */
  version: VersionWire
  /** Its draft content. */
  content: Content
  /** How often the server's text replaced each field under the page, by `revisionKey`. An editor starts over on its field's text when this moves. */
  revisions?: Record<string, number>
  onFieldChange: (field: TemplateField, text: string) => void
  /** The draft's variables. */
  variables: VariableWire[]
  /** Whether they differ from what's saved, so the render sends them. */
  variablesEdited: boolean
  funcs: string[]
  sampleText: string
  /** The last sample data that parsed. */
  sampleData: Record<string, unknown>
  sampleError?: string
  /** Bumped to start the sample data editor over. */
  sampleKey: number
  onSampleChange: (text: string) => void
  onSampleRefill: () => void
  from?: { email?: string; name?: string; phone?: string }
}

const NO_DIAGNOSTICS: Diagnostic[] = []

export const revisionKey = (versionId: string, field: TemplateField) => `${versionId}:${field}`

/** A field's problems in the editor's terms. A missing or unprovided variable has no field and no line, so it only goes in the list. */
function byField(diagnostics: Diagnostic[]): Record<TemplateField, EditorDiagnostic[]> {
  const out = Object.fromEntries(ALL_FIELDS.map((f) => [f, [] as EditorDiagnostic[]])) as Record<TemplateField, EditorDiagnostic[]>
  for (const d of diagnostics) {
    if (d.field === "" || d.line === 0) continue
    out[d.field].push({ line: d.line, column: d.column, severity: d.severity, message: d.message })
  }
  return out
}

/** A small dot on a tab or trigger whose field has problems: destructive when any is an error, muted when only warnings. */
function Cue({ marks }: { marks: EditorDiagnostic[] }) {
  if (marks.length === 0) return null
  return (
    <span aria-hidden="true" className={marks.some((m) => m.severity === "error") ? "ml-1 text-destructive" : "ml-1 text-muted-foreground"}>
      •
    </span>
  )
}

export function ContentTab(props: ContentTabProps) {
  const { primary, other } = fieldsFor(props.channel)
  const [active, setActive] = useState<TemplateField>(primary[0])
  const [otherOpen, setOtherOpen] = useState(false)
  const [focus, setFocus] = useState<{ field: TemplateField; request: FocusRequest } | null>(null)
  // A request belongs to the version it was made on: a round trip through another version must not replay it into rebuilt editors.
  const [focusVersion, setFocusVersion] = useState(props.version.id)
  if (props.version.id !== focusVersion) {
    setFocusVersion(props.version.id)
    setFocus(null)
  }

  const request: TemplatesRenderRequest = {
    templateId: props.templateId,
    content: props.content,
    data: props.sampleData,
    // A row still being named has a blank name, which Herald would report as a missing or unprovided variable that was never declared.
    ...(props.variablesEdited ? { variables: props.variables.filter((v) => v.name.trim() !== "") } : {}),
  }
  const preview = useRenderPreview(request)
  const diagnostics = preview.result?.diagnostics ?? NO_DIAGNOSTICS
  // Keyed on the answer, so typing doesn't re-place the marks between renders.
  const marks = useMemo(() => byField(diagnostics), [diagnostics])
  const names = useMemo(() => props.variables.map((v) => v.name.trim()).filter((n) => n !== ""), [props.variables])
  const otherMarks = other.flatMap((f) => marks[f])
  const locale = props.version.locale === "" ? "fallback" : props.version.locale

  function select(d: Diagnostic) {
    if (d.field === "" || d.line === 0) return
    const field = d.field
    if (primary.includes(field)) setActive(field)
    else setOtherOpen(true)
    setFocus((prev) => ({ field, request: { line: d.line, column: d.column, seq: (prev?.request.seq ?? 0) + 1 } }))
  }

  const editor = (field: TemplateField) => (
    <CodeEditor
      key={`${revisionKey(props.version.id, field)}:${props.revisions?.[revisionKey(props.version.id, field)] ?? 0}`}
      label={`${FIELD_LABEL[field]} (${locale})`}
      initial={props.content[field]}
      language={FIELD_LANGUAGE[field]}
      singleLine={SINGLE_LINE.has(field)}
      diagnostics={marks[field]}
      variables={names}
      funcs={props.funcs}
      focus={focus?.field === field ? focus.request : undefined}
      onChange={(text) => props.onFieldChange(field, text)}
    />
  )

  return (
    <>
      <section aria-label="Editor" className="flex min-w-0 flex-col gap-4">
        <Tabs value={active} onValueChange={(value) => {
            setActive(value as TemplateField)
            setFocus(null)
          }}>
          <TabsList>
            {primary.map((field) => (
              <TabsTrigger key={field} value={field}>
                {FIELD_LABEL[field]}
                {marks[field].length > 0 && <span className="sr-only">, has problems</span>}
                <Cue marks={marks[field]} />
              </TabsTrigger>
            ))}
          </TabsList>
          {primary.map((field) => (
            <TabsContent key={field} value={field} className="mt-2">
              {editor(field)}
            </TabsContent>
          ))}
        </Tabs>
        {other.length > 0 && (
          <Collapsible open={otherOpen} onOpenChange={(open) => {
            setOtherOpen(open)
            if (!open) setFocus(null)
          }}>
            <CollapsibleTrigger className="text-left text-sm text-muted-foreground hover:underline focus-visible:underline">
              {`Fields ${props.channel} doesn't send (${other.map((f) => FIELD_LABEL[f]).join(", ")})`}
              {otherMarks.length > 0 && <span className="sr-only">, has problems</span>}
              <Cue marks={otherMarks} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-4">
              {other.map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">{FIELD_LABEL[field]}</p>
                  {editor(field)}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        <ProblemsList diagnostics={diagnostics} rendered={preview.result !== undefined} onSelect={select} />
      </section>
      <section aria-label="Preview" className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Sample data</p>
            <IconButton type="button" variant="ghost" onClick={props.onSampleRefill} label="Refill from variables" />
          </div>
          <CodeEditor key={`sample:${props.sampleKey}`} label="Sample data" initial={props.sampleText} language="json" onChange={props.onSampleChange} />
          {/* Always mounted, text set later: a live region announces what changes inside it. */}
          <p role="status" className="text-xs text-destructive empty:sr-only">
            {props.sampleError ? `${/[.!?]$/.test(props.sampleError) ? props.sampleError : `${props.sampleError}.`} The preview uses the last sample data that parsed.` : ""}
          </p>
        </div>
        <CommandAlert error={preview.error} title="The preview didn't render" />
        <RenderedPreview channel={props.channel} result={preview.result} from={props.from} stale={preview.stale} />
      </section>
    </>
  )
}
