import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { collectionPath } from "../links"
import type { Collection, ComponentsOutput, EngineConfig } from "../types"

/** "" is 0 (the default). Anything but a whole number is NaN. */
function parseTokens(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

/**
 * The overlap rule as the server applies it: 0 means the default, and the
 * effective overlap must be smaller than the effective size. The message is
 * the server's, so the form and a refusal read the same.
 */
export function overlapProblem(
  size: number,
  overlap: number,
  config: EngineConfig | undefined
): string | null {
  if (!config || Number.isNaN(size) || Number.isNaN(overlap)) return null
  const effSize = size === 0 ? config.default_chunk_size : size
  const effOverlap = overlap === 0 ? config.default_chunk_overlap : overlap
  if (effOverlap < effSize) return null
  const from = (given: number) => (given === 0 ? " (the default)" : "")
  return `chunk overlap ${effOverlap}${from(overlap)} must be smaller than chunk size ${effSize}${from(size)}`
}

export const CollectionCreatePage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})
  const create = useCommand<Collection>("collections.create")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [size, setSize] = useState("")
  const [overlap, setOverlap] = useState("")
  const [rows, setRows] = useState<MetadataRow[]>([])

  const config = report.data?.config
  const sizeN = parseTokens(size)
  const overlapN = parseTokens(overlap)
  const problem = overlapProblem(sizeN, overlapN, config)
  const meta = metadataOf(rows)
  const canSubmit =
    !create.loading &&
    name.trim() !== "" &&
    !Number.isNaN(sizeN) &&
    !Number.isNaN(overlapN) &&
    problem === null &&
    "metadata" in meta

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !("metadata" in meta)) return
    const result = await create.execute({
      name: name.trim(),
      description,
      chunk_size: sizeN,
      chunk_overlap: overlapN,
      metadata: meta.metadata,
    })
    if (result === undefined) return
    navigateTo(collectionPath(result.id))
  }

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="New collection"
        description="A collection groups documents that are chunked and embedded the same way."
      />
      <CommandAlert
        title="Could not create the collection"
        error={create.error}
      />
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-w-2xl min-w-0 flex-col gap-4"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="collection-name">Name</Label>
          <Input
            id="collection-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Unique within its tenant. The dashboard creates collections with no
            tenant.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="collection-description">Description</Label>
          <Textarea
            id="collection-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="collection-size">Chunk size</Label>
            <Input
              id="collection-size"
              inputMode="numeric"
              className="font-mono"
              placeholder={config ? String(config.default_chunk_size) : ""}
              value={size}
              aria-invalid={Number.isNaN(sizeN) || undefined}
              onChange={(e) => setSize(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              In tokens (characters ÷ 4).{" "}
              {config
                ? `Leave it empty for the default (${config.default_chunk_size} tokens).`
                : null}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="collection-overlap">Chunk overlap</Label>
            <Input
              id="collection-overlap"
              inputMode="numeric"
              className="font-mono"
              placeholder={config ? String(config.default_chunk_overlap) : ""}
              value={overlap}
              aria-invalid={
                Number.isNaN(overlapN) || problem !== null || undefined
              }
              onChange={(e) => setOverlap(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {config
                ? `Leave it empty or 0 for the default (${config.default_chunk_overlap} tokens). `
                : null}
              Weave reads 0 as the default, so a collection can't be created
              with no overlap.
            </p>
          </div>
        </div>
        {Number.isNaN(sizeN) || Number.isNaN(overlapN) ? (
          <p role="alert" className="text-sm text-destructive">
            Use a whole number of tokens.
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm text-destructive">
            {problem}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-sm font-medium">Metadata</span>
          <MetadataEditor rows={rows} onChange={setRows} />
          {"error" in meta ? (
            <p role="alert" className="text-sm text-destructive">
              {meta.error}
            </p>
          ) : null}
        </div>
        <section className="flex min-w-0 flex-col gap-1 rounded-md border p-3 text-sm">
          <h2 className="font-medium">Recorded, not used</h2>
          <QueryBoundary
            title="What this deployment runs"
            query={report}
            skeletonRows={2}
          >
            {(data) => (
              <p className="text-muted-foreground">
                A new collection records the model{" "}
                <span className="font-mono text-xs">
                  {data.config.default_embedding_model}
                </span>
                , {data.components.embedder.dimensions ?? 0} dimensions and the
                strategy{" "}
                <span className="font-mono text-xs">
                  {data.config.default_chunk_strategy}
                </span>
                . Weave never reads them back: this deployment embeds with{" "}
                <span className="font-mono text-xs">
                  {data.components.embedder.kind || "no embedder"}
                </span>{" "}
                and chunks with{" "}
                <span className="font-mono text-xs">
                  {data.components.chunker.kind || "no chunker"}
                </span>{" "}
                for every collection.
              </p>
            )}
          </QueryBoundary>
        </section>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {create.loading ? "Creating…" : "Create collection"}
          </Button>
          <PluginLink
            to="/collections"
            className="self-center text-sm underline"
          >
            Cancel
          </PluginLink>
        </div>
      </form>
    </section>
  )
}
