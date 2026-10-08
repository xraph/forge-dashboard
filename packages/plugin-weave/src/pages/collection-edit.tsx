import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf, rowsOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { formatCount } from "../format"
import { collectionPath } from "../links"
import type { Collection, CollectionDetail } from "../types"

const FIXED =
  "Fixed at creation. Weave can't re-chunk existing documents, so a change would only apply to new ones. Reindex re-embeds the existing chunks with the current embedder; it doesn't re-chunk."

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

function EditForm({ collection }: { collection: CollectionDetail }) {
  const update = useCommand<Collection>("collections.update")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState(collection.name)
  const [description, setDescription] = useState(collection.description ?? "")
  const [rows, setRows] = useState<MetadataRow[]>(rowsOf(collection.metadata))

  const meta = metadataOf(rows)
  // Only what changed goes out: every field but id is a pointer on the Go
  // side, and an absent one is left alone. Metadata replaces the whole map.
  const payload: Record<string, unknown> = { id: collection.id }
  if (name.trim() !== collection.name) payload.name = name.trim()
  if (description !== (collection.description ?? "")) payload.description = description
  if ("metadata" in meta && !sameMap(meta.metadata, collection.metadata)) payload.metadata = meta.metadata
  const changed = Object.keys(payload).length > 1
  const canSubmit = !update.loading && changed && name.trim() !== "" && "metadata" in meta

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const result = await update.execute(payload)
    if (result === undefined) return
    navigateTo(collectionPath(collection.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-4">
      <CommandAlert title="Could not save the collection" error={update.error} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="collection-name">Name</Label>
        <Input id="collection-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="collection-description">Description</Label>
        <Textarea id="collection-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Metadata</span>
        <MetadataEditor rows={rows} onChange={setRows} />
        {"error" in meta ? <p role="alert" className="text-sm text-destructive">{meta.error}</p> : null}
      </div>
      <section className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <h2 className="font-medium">Chunk settings</h2>
        <DescriptionList
          items={[
            { term: "Chunk size", value: <span className="font-mono text-xs">{formatCount(collection.chunk_size)} tokens</span> },
            { term: "Chunk overlap", value: <span className="font-mono text-xs">{formatCount(collection.chunk_overlap)} tokens</span> },
          ]}
        />
        <p className="text-muted-foreground">{FIXED}</p>
      </section>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <PluginLink to={collectionPath(collection.id)} className="text-sm underline">
          Cancel
        </PluginLink>
        {!changed ? <span className="text-sm text-muted-foreground">Nothing to save yet.</span> : null}
      </div>
    </form>
  )
}

export const CollectionEditPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<CollectionDetail>("collections.get", { id })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Edit collection" description="Name, description and metadata. Chunk settings are fixed when a collection is made." />
      <QueryBoundary title="Collection" query={detail} skeletonRows={4}>
        {(data) => <EditForm key={data.id} collection={data} />}
      </QueryBoundary>
    </section>
  )
}
