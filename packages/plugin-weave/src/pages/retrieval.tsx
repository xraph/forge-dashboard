import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@forge-go/dashboard-kit/components/sheet"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { TenantFilter } from "../components/tenant-filter"
import { formatMs, formatScore, plural, utf8Length } from "../format"
import { ContextView } from "../retrieval/context-view"
import { Inspector } from "../retrieval/inspector"
import { emptiness, emptinessCopy, noReorderingCopy } from "../retrieval/model"
import { RankingTable, SourceCell } from "../retrieval/ranking-table"
import { retrieverSentence, scoreHeader } from "../score"
import { withTenant } from "../tenant"
import { useCollectionOptions } from "../collection-options"
import type {
  AssembledContext,
  ComponentsOutput,
  Hit,
  RunOutput,
} from "../types"
import { useWide } from "../use-wide"

const QUERY_CAP = 8192

type Tab = "ranking" | "context" | "left-out"

/** A run as the page keeps it: what came back, plus the min score it was asked with. */
interface Shown {
  run: RunOutput
  context: AssembledContext
  minScore: number
}

const leftOutColumns: Column<Hit>[] = [
  {
    id: "vector_rank",
    header: "Vector rank",
    cell: (h) => <span className="tabular-nums">{h.vector_rank}</span>,
  },
  {
    id: "score",
    header: "Vector score",
    cell: (h) => (
      <span className="font-mono text-xs tabular-nums">
        {formatScore(h.vector_score)}
      </span>
    ),
  },
  {
    id: "chunk",
    header: "Chunk",
    className: "font-medium",
    cell: (h) =>
      h.chunk ? (
        <span className="line-clamp-2">{h.chunk.content}</span>
      ) : (
        <span className="text-muted-foreground">no chunk</span>
      ),
  },
  { id: "source", header: "Source", cell: (h) => <SourceCell hit={h} /> },
]

/** "" is 0, the server's default. Anything but a whole number is NaN. */
function wholeOrZero(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

function scoreOrZero(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

export const RetrievalPage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})
  const run = useCommand<RunOutput>("retrieval.run")
  const wide = useWide()

  const [query, setQuery] = useState("")
  const [collectionId, setCollectionId] = useState("")
  const picker = useCollectionOptions(collectionId, "All collections")
  const [tenant, setTenant] = useState<string | null>(null)
  const [topK, setTopK] = useState("")
  const [minScore, setMinScore] = useState("")
  const [maxTokens, setMaxTokens] = useState("")
  const [shown, setShown] = useState<Shown | null>(null)
  const [tab, setTab] = useState<Tab>("ranking")
  const [selected, setSelected] = useState(-1)

  const topKN = wholeOrZero(topK)
  const minScoreN = scoreOrZero(minScore)
  const maxTokensN = wholeOrZero(maxTokens)
  const tooLong = utf8Length(query) > QUERY_CAP
  const badNumber =
    Number.isNaN(topKN) || Number.isNaN(minScoreN) || Number.isNaN(maxTokensN)
  const canRun = !run.loading && query.trim() !== "" && !tooLong && !badNumber
  const components = report.data?.components
  const config = report.data?.config

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter submits the form, so this checks again rather than trusting the
    // disabled button.
    if (!canRun) return
    const payload = withTenant(
      {
        query,
        ...(collectionId !== "" ? { collection_id: collectionId } : {}),
      },
      tenant
    )
    const answer = await run.execute({
      ...payload,
      top_k: topKN,
      min_score: minScoreN,
      max_tokens: maxTokensN,
    })
    // A failed run leaves the last result on screen; its error shows above.
    if (answer === undefined) return
    setShown({ run: answer, context: answer.context, minScore: minScoreN })
    setSelected(-1)
    setTab("ranking")
  }

  const result = shown?.run.result
  const empty = result ? emptiness(result, shown.minScore) : null
  const selectedHit =
    result && selected >= 0 ? result.hits[selected] : undefined
  const inspector = selectedHit ? (
    <Inspector hit={selectedHit} label={`Hit ${selectedHit.rank}`} />
  ) : null

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Retrieval"
        description="Ask what your app would ask, and see what the retriever ranked and what a model would be handed."
      />

      <form
        onSubmit={(e) => void submit(e)}
        className="flex min-w-0 flex-col gap-3 rounded-md border p-3"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="retrieval-query">Query</Label>
          <Input
            id="retrieval-query"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What did the user ask?"
          />
          {tooLong ? (
            <p role="alert" className="text-sm text-destructive">
              Queries are capped at 8 KiB. This one is {utf8Length(query)}{" "}
              bytes.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="retrieval-collection">Collection</Label>
            <NativeSelect
              id="retrieval-collection"
              value={collectionId}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              {picker.options.map((o) => (
                <NativeSelectOption key={o.value} value={o.value}>
                  {o.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {picker.note ? (
              <p
                className={
                  picker.error
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
                role={picker.error ? "alert" : "status"}
              >
                {picker.note}
              </p>
            ) : null}
          </div>
          <TenantFilter value={tenant} onChange={setTenant} />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="retrieval-topk">Top K</Label>
            <Input
              id="retrieval-topk"
              inputMode="numeric"
              className="w-20 font-mono"
              placeholder={config ? String(config.default_top_k) : ""}
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="retrieval-min">Min score</Label>
            <Input
              id="retrieval-min"
              inputMode="decimal"
              className="w-20 font-mono"
              placeholder="0"
              value={minScore}
              onChange={(e) => setMinScore(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="retrieval-budget">Budget</Label>
            <Input
              id="retrieval-budget"
              inputMode="numeric"
              className="w-24 font-mono"
              placeholder="4096"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canRun}>
            {run.loading ? "Running…" : "Run query"}
          </Button>
        </div>
        {badNumber ? (
          <p role="alert" className="text-sm text-destructive">
            Top K and the budget take whole numbers; min score takes a number of
            0 or more.
          </p>
        ) : null}
      </form>

      <CommandAlert title="The query did not run" error={run.error} />

      {!shown || !result ? (
        <EmptyState
          title="Ask Weave a question"
          description="Run a query to see the ranking the retriever produced, the raw vector ranking beside it, and the context a model would read."
        />
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            {components ? <p>{retrieverSentence(components)}</p> : null}
            <p className="tabular-nums">
              {plural(result.hits.length, "hit", "hits")} in{" "}
              {formatMs(result.retriever_ms)}. Vector search returned{" "}
              {result.vector_matches} of a {result.window} window in{" "}
              {formatMs(result.vector_ms)}.
              {result.same_search
                ? " Both sides are the same vector search, so they can't disagree."
                : ""}
            </p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(String(v) as Tab)}>
            <TabsList variant="line">
              <TabsTrigger value="ranking">Ranking</TabsTrigger>
              <TabsTrigger value="context">
                Context sent to the model
              </TabsTrigger>
              <TabsTrigger value="left-out">
                Left out ({result.left_out.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ranking">
              {empty ? (
                <p className="py-4 text-sm">{emptinessCopy(empty)}</p>
              ) : (
                <div
                  className={
                    wide
                      ? "grid min-w-0 grid-cols-[minmax(0,1fr)_22rem] gap-4"
                      : "flex min-w-0 flex-col"
                  }
                >
                  <RankingTable
                    hits={result.hits}
                    context={shown.context}
                    scoreLabel={scoreHeader(
                      result.score,
                      components?.vector_store.score
                    )}
                    selected={selected}
                    onSelect={setSelected}
                  />
                  {wide ? (
                    <aside className="rounded-md border p-3">
                      {inspector ?? (
                        <p className="text-sm text-muted-foreground">
                          Pick a hit to see its full text, where it came from
                          and its metadata.
                        </p>
                      )}
                    </aside>
                  ) : (
                    <Sheet
                      open={selectedHit !== undefined}
                      onOpenChange={(open) => (open ? null : setSelected(-1))}
                    >
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>
                            {selectedHit ? `Hit ${selectedHit.rank}` : "Hit"}
                          </SheetTitle>
                        </SheetHeader>
                        {inspector}
                      </SheetContent>
                    </Sheet>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="context">
              <ContextView
                key={shown.run.context.context}
                hits={result.hits}
                context={shown.context}
                disabled={run.loading}
                onContext={(next) => {
                  // This closure belongs to the render Re-assemble was clicked
                  // in. If a newer run has landed since, the answer is stale.
                  const forRun = shown.run
                  setShown((s) =>
                    s && s.run === forRun ? { ...s, context: next } : s
                  )
                }}
                onMarker={(index) => {
                  setSelected(index)
                  setTab("ranking")
                }}
              />
            </TabsContent>

            <TabsContent value="left-out">
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Strong vector matches inside the scanned window that the
                  retriever didn't return. Their scores are vector scores.
                </p>
                {result.hits.length === 0 ? (
                  // Go answers left_out [] and reordered false whenever there
                  // are no final hits, so "no reordering" would be untrue here.
                  <p className="text-sm">
                    The retriever returned nothing, so nothing was left out.
                  </p>
                ) : result.left_out.length === 0 ? (
                  <p className="text-sm">
                    {noReorderingCopy(result, components) ??
                      "Nothing above the retriever's weakest hit was left out."}
                  </p>
                ) : (
                  <ResourceTable<Hit>
                    columns={leftOutColumns}
                    rows={result.left_out}
                    rowKey={(h) => `${h.vector_rank}`}
                    caption={plural(
                      result.left_out.length,
                      "match left out",
                      "matches left out"
                    )}
                    emptyMessage="Nothing was left out."
                  />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  )
}
