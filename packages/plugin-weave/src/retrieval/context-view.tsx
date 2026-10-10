import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { formatCount, plural } from "../format"
import type { AssembledContext, Hit } from "../types"
import { assembleHitsFrom, contextParts, hitForMarker } from "./model"

/**
 * Why the context holds nothing. Only a hit with text can be over budget: the
 * engine skips a hit with no chunk before the budget is counted.
 */
function nothingAssembled(hits: Hit[]): string {
  if (hits.length === 0) return "No hits came back, so nothing was assembled."
  if (hits.every((h) => h.chunk === null))
    return "None of the hits had a chunk, so nothing was assembled."
  return "Nothing fit in the budget, so a model would get only the template's header."
}

/**
 * The assembled text exactly as built, read-only. Each [n] marker is a button
 * back to its hit. Re-assemble sends the run's own hits with a new budget,
 * so it embeds nothing and reads no store. `disabled` holds Re-assemble back
 * while a new run is in flight, since its answer would belong to the old one.
 */
export function ContextView({
  hits,
  context,
  onContext,
  onMarker,
  disabled = false,
}: {
  hits: Hit[]
  context: AssembledContext
  disabled?: boolean
  onContext: (next: AssembledContext) => void
  onMarker: (hitIndex: number) => void
}) {
  const assemble = useCommand<AssembledContext>("retrieval.assemble")
  const [budget, setBudget] = useState(String(context.max_tokens))
  const parsed = /^\d+$/.test(budget.trim())
    ? Number(budget.trim())
    : Number.NaN

  async function reassemble() {
    if (Number.isNaN(parsed)) return
    const answer = await assemble.execute({
      hits: assembleHitsFrom(hits),
      max_tokens: parsed,
    })
    if (answer !== undefined) onContext(answer)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Built by Weave's default assembler (token counts are estimates:
        characters ÷ 4). Your app may assemble its own way.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="context-budget">Token budget</Label>
          <Input
            id="context-budget"
            inputMode="numeric"
            className="w-32 font-mono"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || assemble.loading || Number.isNaN(parsed)}
          onClick={() => void reassemble()}
        >
          {assemble.loading ? "Re-assembling…" : "Re-assemble"}
        </Button>
        <span className="text-sm tabular-nums">
          {formatCount(context.total_tokens)} of{" "}
          {formatCount(context.max_tokens)} tokens used,{" "}
          {plural(context.included.length, "hit", "hits")} of{" "}
          {formatCount(hits.length)}
        </span>
      </div>
      <CommandAlert title="Could not re-assemble" error={assemble.error} />
      {context.included.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {nothingAssembled(hits)}
        </p>
      ) : (
        <pre className="rounded-md border p-3 text-sm whitespace-pre-wrap">
          {contextParts(context.context).map((part, i) =>
            part.kind === "marker" ? (
              <button
                key={i}
                type="button"
                className="font-mono text-xs underline"
                aria-label={`Show hit ${hitForMarker(context, part.n) + 1}`}
                onClick={() => {
                  const target = hitForMarker(context, part.n)
                  if (target >= 0) onMarker(target)
                }}
              >
                [{part.n}]
              </button>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
        </pre>
      )}
    </div>
  )
}
