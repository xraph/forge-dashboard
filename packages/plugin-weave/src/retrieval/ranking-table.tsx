import { Fragment } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Id } from "../components/id"
import { formatCount, formatScore, plural } from "../format"
import { documentPath } from "../links"
import type { AssembledContext, Hit } from "../types"
import { documentOf, hitState, movement } from "./model"

export function MovementCell({ hit }: { hit: Hit }) {
  const m = movement(hit)
  if (m.kind === "outside")
    return <NoneCell label="place in the vector window" />
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span>{hit.vector_rank}</span>
      {m.kind === "up" ? (
        <span
          className="text-xs text-muted-foreground"
          aria-label={`up ${m.by} from the vector ranking`}
        >
          ↑{m.by}
        </span>
      ) : null}
      {m.kind === "down" ? (
        <span
          className="text-xs text-muted-foreground"
          aria-label={`down ${m.by} from the vector ranking`}
        >
          ↓{m.by}
        </span>
      ) : null}
    </span>
  )
}

export function HitStateBadge({ hit }: { hit: Hit }) {
  const state = hitState(hit)
  if (state === "orphaned")
    return <Badge variant="destructive">no chunk row</Badge>
  if (state === "unidentified" && hit.chunk)
    return <Badge variant="secondary">no chunk ID</Badge>
  return null
}

export function SourceCell({ hit }: { hit: Hit }) {
  const doc = documentOf(hit)
  if (doc.id === "") return <NoneCell label="source" />
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {doc.linkable ? (
        <PluginLink
          to={documentPath(doc.id)}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {doc.id}
        </PluginLink>
      ) : (
        <Id value={doc.id} />
      )}
      {hit.hydrated && hit.chunk ? (
        <span className="text-xs text-muted-foreground">
          #{hit.chunk.index}
        </span>
      ) : null}
    </span>
  )
}

/**
 * The final ranking, one row per hit, with the context budget as a full-width
 * row above the first hit that didn't make it in. Assembly skips a hit that
 * doesn't fit and carries on, so rows below the line can still be in the
 * context; each row is dimmed by `included`, not by its position.
 */
export function RankingTable({
  hits,
  context,
  scoreLabel,
  selected,
  onSelect,
}: {
  hits: Hit[]
  context: AssembledContext
  scoreLabel: string
  selected: number
  onSelect: (index: number) => void
}) {
  const included = new Set(context.included)
  return (
    <Table>
      <TableCaption>
        {plural(hits.length, "hit", "hits")},{" "}
        {formatCount(context.included.length)} in the context
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>{scoreLabel}</TableHead>
          <TableHead>Vector rank</TableHead>
          <TableHead>Chunk</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hits.map((hit, i) => (
          <Fragment key={`${hit.rank}-${hit.chunk?.id ?? i}`}>
            {i === context.first_excluded ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="border-y-2 border-dashed text-xs text-muted-foreground"
                >
                  Context budget {formatCount(context.max_tokens)} tokens:{" "}
                  {plural(context.included.length, "hit", "hits")},{" "}
                  {formatCount(context.total_tokens)} used. Dimmed rows below
                  were retrieved and not sent.
                </TableCell>
              </TableRow>
            ) : null}
            <TableRow
              data-rank={hit.rank}
              data-in-context={included.has(i) ? "true" : "false"}
              aria-selected={selected === i}
              className={cn(
                selected === i && "bg-muted",
                !included.has(i) && "opacity-60"
              )}
            >
              <TableCell className="tabular-nums">{hit.rank}</TableCell>
              <TableCell>
                <span className="font-mono text-xs tabular-nums">
                  {formatScore(hit.score)}
                </span>
              </TableCell>
              <TableCell>
                <MovementCell hit={hit} />
              </TableCell>
              <TableCell className="max-w-xl">
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 text-left"
                  aria-label={`Inspect hit ${hit.rank}`}
                  onClick={() => onSelect(i)}
                >
                  {hit.chunk ? (
                    <span className="line-clamp-2 text-sm">
                      {hit.chunk.content}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      no chunk
                    </span>
                  )}
                  <span className="flex flex-wrap gap-1">
                    <HitStateBadge hit={hit} />
                    {!included.has(i) && hit.chunk ? (
                      <span className="text-xs text-muted-foreground">
                        retrieved, over budget
                      </span>
                    ) : null}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <SourceCell hit={hit} />
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}
