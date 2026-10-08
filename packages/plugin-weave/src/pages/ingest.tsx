import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { formatBytes, plural, utf8Length } from "../format"
import { readText, sizeProblem, sourceTypeFor } from "../ingest"
import { collectionPath, documentPath, documentsHref } from "../links"
import type { CollectionDetail, ComponentsOutput, IngestOutput } from "../types"

const FALLBACK_TYPES = ["text/plain", "text/markdown", "text/html", "text/csv", "application/json"]

export const IngestPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const collection = useQuery<CollectionDetail>("collections.get", { id })
  const report = useQuery<ComponentsOutput>("system.components", {})
  const ingest = useCommand<IngestOutput>("documents.ingest")
  const [title, setTitle] = useState("")
  const [source, setSource] = useState("")
  const [sourceType, setSourceType] = useState("text/plain")
  const [content, setContent] = useState("")
  const [rows, setRows] = useState<MetadataRow[]>([])
  const [result, setResult] = useState<IngestOutput | null>(null)

  const supported = report.data?.components.loader.content_types ?? []
  const types = Array.from(new Set([...(supported.length > 0 ? supported : FALLBACK_TYPES), sourceType]))
  const meta = metadataOf(rows)
  const payload = {
    collection_id: id,
    title,
    source,
    source_type: sourceType,
    content,
    metadata: "metadata" in meta ? meta.metadata : {},
  }
  const problem = content === "" ? null : sizeProblem(content, payload)
  const canSubmit = !ingest.loading && content.trim() !== "" && problem === null && "metadata" in meta

  async function pick(file: File | undefined) {
    if (!file) return
    const text = await readText(file)
    setContent(text)
    setSourceType(sourceTypeFor(file.name))
    if (title === "") setTitle(file.name)
    if (source === "") setSource(file.name)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setResult(null)
    const answer = await ingest.execute(payload)
    if (answer === undefined) return
    setResult(answer)
    // A failed ingest keeps the text, so you can fix the cause and delete the
    // failed copy; a ready one is done with it.
    if (answer.state === "ready") setContent("")
  }

  const conflict = ingest.error?.code === "CONFLICT"

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Collection" query={collection} skeletonRows={1}>
        {(c) => (
          <PageHeader
            title="Ingest"
            description={`Paste text or pick a text file, and Weave chunks and embeds it into ${c.name} inside this request.`}
            actions={
              <PluginLink to={collectionPath(c.id)} className="text-sm underline">
                Back to {c.name}
              </PluginLink>
            }
          />
        )}
      </QueryBoundary>

      {result?.state === "ready" ? (
        <Alert>
          <AlertTitle>Ready: {plural(result.chunk_count, "chunk", "chunks")}.</AlertTitle>
          <AlertDescription>
            <PluginLink to={documentPath(result.document_id)} className="underline">
              Open the document
            </PluginLink>
          </AlertDescription>
        </Alert>
      ) : null}
      {result?.state === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>Ingest failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            <span className="font-mono text-xs break-all">{result.error ?? "Weave stored no reason."}</span>
            <span>The document row exists in state failed. Delete it before you ingest the same text again.</span>
            <PluginLink to={documentPath(result.document_id)} className="underline">
              Open the document
            </PluginLink>
          </AlertDescription>
        </Alert>
      ) : null}

      <CommandAlert title="Could not ingest" error={ingest.error} />
      {conflict ? (
        <div className="flex gap-4 text-sm">
          <PluginLink to={documentsHref({ collection_id: id, state: "failed" })} className="underline">
            Failed documents in this collection
          </PluginLink>
          <PluginLink to={documentsHref({ collection_id: id, state: "processing" })} className="underline">
            Processing documents in this collection
          </PluginLink>
        </div>
      ) : null}

      <form onSubmit={(e) => void submit(e)} className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-file">Pick a text file</Label>
          <Input id="ingest-file" type="file" accept=".txt,.md,.markdown,.html,.htm,.csv,.json" onChange={(e) => void pick(e.target.files?.[0])} />
          <p className="text-xs text-muted-foreground">The browser reads it as text. Nothing is uploaded until you press Ingest.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-content">Content</Label>
          <Textarea id="ingest-content" rows={12} className="font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{formatBytes(utf8Length(content))}</span> of 1 MiB.
          </p>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-title">Title</Label>
            <Input id="ingest-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-source">Source</Label>
            <Input id="ingest-source" className="font-mono text-xs" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-type">Content type</Label>
          <NativeSelect id="ingest-type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            {types.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>This deployment's loader reads</span>
            <TagList values={supported} label="content types" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Metadata</span>
          <MetadataEditor rows={rows} onChange={setRows} />
          {"error" in meta ? <p role="alert" className="text-sm text-destructive">{meta.error}</p> : null}
        </div>
        <div>
          <Button type="submit" disabled={!canSubmit}>
            {ingest.loading ? "Ingesting…" : "Ingest"}
          </Button>
        </div>
      </form>
    </section>
  )
}
