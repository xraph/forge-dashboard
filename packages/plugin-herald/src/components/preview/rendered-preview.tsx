import { useState } from "react"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { plural } from "../../format"
import type { Diagnostic, PreviewResult, TemplateField } from "../../wire"
import { countSms } from "./sms"
import { buildSrcdoc } from "./srcdoc"

const output = (result: PreviewResult | undefined, field: TemplateField) => result?.fields.find((f) => f.field === field)?.output ?? ""

/** Lengths platforms usually cut at. Typical, not exact. */
const PUSH_TITLE = 65
const PUSH_BODY = 240

export function DiagnosticsList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Problems">
      {diagnostics.map((d, i) => (
        <li key={i} className={d.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
          <span aria-hidden="true">{d.severity === "error" ? "✕ " : "⚠ "}</span>
          <span className="sr-only">{d.severity === "error" ? "Error: " : "Warning: "}</span>
          {d.field && (
            <span className="font-mono text-xs">
              {d.field}
              {d.line > 0 ? ` ${d.line}${d.column > 0 ? `:${d.column}` : ""}` : ""}{" "}
            </span>
          )}
          {d.message}
        </li>
      ))}
    </ul>
  )
}

function EmailPreview({ result, from }: { result?: PreviewResult; from?: { email?: string; name?: string } }) {
  const [remote, setRemote] = useState(false)
  const html = output(result, "html")
  const text = output(result, "text")
  const subject = output(result, "subject")
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
        <dt className="text-muted-foreground">From</dt>
        <dd>{from?.email ? `${from.name ? `${from.name} ` : ""}<${from.email}>` : <NoneCell label="sender" />}</dd>
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="font-medium">{subject || <NoneCell label="subject" />}</dd>
      </dl>
      <Tabs defaultValue="rendered">
        <TabsList>
          <TabsTrigger value="rendered">Rendered</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="source">Source</TabsTrigger>
        </TabsList>
        <TabsContent value="rendered" className="flex flex-col gap-2">
          {html === "" ? (
            <p className="text-sm text-muted-foreground">No HTML part. Mail clients show the text part.</p>
          ) : (
            <iframe title="Rendered email" sandbox="" srcDoc={buildSrcdoc(html, remote)} className="h-80 w-full rounded-md border bg-white" />
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch aria-label="Load remote images" checked={remote} onCheckedChange={setRemote} />
            <span aria-hidden="true">Load remote images</span>
          </label>
          {!remote && <p className="text-xs text-muted-foreground">Remote images are off, so a tracking pixel in the template can't fire from your browser.</p>}
        </TabsContent>
        <TabsContent value="text">
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{text || "(no text part)"}</pre>
        </TabsContent>
        <TabsContent value="source">
          <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{html || "(no HTML part)"}</pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SmsPreview({ result, from }: { result?: PreviewResult; from?: { phone?: string } }) {
  const text = output(result, "text")
  const count = countSms(text)
  return (
    <div className="flex flex-col gap-2 text-sm">
      {from?.phone && (
        <p>
          From <span className="font-mono text-xs">{from.phone}</span>
        </p>
      )}
      <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{text || "(empty)"}</pre>
      <p className="text-muted-foreground">
        {plural(count.segments, "segment")}, {count.encoding}, {plural(count.units, "unit")} (up to {count.perSegment} per segment)
      </p>
    </div>
  )
}

function ShortPreview({ result }: { result?: PreviewResult }) {
  const title = output(result, "title")
  const text = output(result, "text")
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <p className="font-medium">{title || <NoneCell label="title" />}</p>
      <p className="whitespace-pre-wrap">{text || <NoneCell label="body" />}</p>
      <p className="text-xs text-muted-foreground">
        Title {title.length} / about {PUSH_TITLE}, body {text.length} / about {PUSH_BODY}. Typical cut-offs, not exact ones.
      </p>
    </div>
  )
}

function PlainPreview({ result }: { result?: PreviewResult }) {
  const subject = output(result, "subject")
  return (
    <div className="flex flex-col gap-2 text-sm">
      {subject && <p className="font-medium">{subject}</p>}
      <pre className="overflow-x-auto rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">{output(result, "text") || "(empty)"}</pre>
    </div>
  )
}

export function RenderedPreview({ channel, result, from, stale }: { channel: string; result?: PreviewResult; from?: { email?: string; name?: string; phone?: string }; stale: boolean }) {
  return (
    <div className="relative flex flex-col gap-2">
      {stale && (
        <p role="status" className="text-xs text-muted-foreground">
          Out of date: rendering your latest change…
        </p>
      )}
      <div className={stale ? "opacity-60" : undefined}>
        {channel === "email" ? (
          <EmailPreview result={result} from={from} />
        ) : channel === "sms" ? (
          <SmsPreview result={result} from={from} />
        ) : channel === "push" || channel === "inapp" ? (
          <ShortPreview result={result} />
        ) : (
          <PlainPreview result={result} />
        )}
      </div>
    </div>
  )
}
