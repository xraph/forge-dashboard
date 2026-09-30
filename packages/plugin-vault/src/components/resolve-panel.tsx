import { useState } from "react"
import type { FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { WrongTypeBadge } from "../badges"
import { ConfigValue } from "./config-value"

/**
 * Mirrors the Go `configResolveResponse`.
 *
 * `overrideValue` is present exactly when an override answered, and it may be
 * "", false, 0 or null, so it is never tested for truthiness. `source` is what
 * says who answered; this panel does not infer it from the values.
 */
interface ResolveResult {
  value: unknown
  valueMatchesType: boolean
  source: string
  appValue: unknown
  overrideValue?: unknown
  tenantId?: string
}

/**
 * "Resolve for tenant": what one tenant actually gets for this key, and which
 * source answered.
 *
 * Nothing is asked until Resolve is pressed, and what was typed is not what
 * was asked: the answer stays put while the box is edited, and names the
 * tenant it was for. Pressing Resolve again for the same question asks again,
 * since the manifest gives this read no cache. An empty box asks with no
 * tenant, which is a real question with its own answer (the app default).
 */
export function ResolvePanel({
  entryKey,
  valueType,
}: {
  entryKey: string
  valueType: string
}) {
  const [text, setText] = useState("")
  // null is "not asked yet". `{}` is "asked with no tenant".
  const [asked, setAsked] = useState<{ tenantId?: string } | null>(null)

  const result = useQuery<ResolveResult>(
    "config.resolve",
    { key: entryKey, ...(asked?.tenantId === undefined ? {} : { tenantId: asked.tenantId }) },
    { enabled: asked !== null },
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    if (result.loading) return
    const tenant = text.trim()
    const next = tenant === "" ? {} : { tenantId: tenant }
    if (asked !== null && asked.tenantId === next.tenantId) {
      result.refetch()
      return
    }
    setAsked(next)
  }

  function clear() {
    setText("")
    setAsked(null)
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Resolve</h2>
      <form
        aria-label="Resolve"
        onSubmit={submit}
        className="flex flex-wrap items-end gap-x-3 gap-y-2"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="resolve-tenant" className="text-xs text-muted-foreground">
            Resolve for tenant
          </Label>
          <Input
            id="resolve-tenant"
            className="w-56 font-mono"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={result.loading}>
            Resolve
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={asked === null && text === ""}
            onClick={clear}
          >
            Clear
          </Button>
        </div>
      </form>
      {asked === null ? null : (
        <QueryBoundary title="Resolve" query={result} skeletonRows={1}>
          {(data) => <Answer data={data} tenantId={data.tenantId ?? asked.tenantId} valueType={valueType} />}
        </QueryBoundary>
      )}
    </section>
  )
}

function Answer({
  data,
  tenantId,
  valueType,
}: {
  data: ResolveResult
  tenantId: string | undefined
  valueType: string
}) {
  const value = (
    <>
      <ConfigValue value={data.value} valueType={valueType} />
      {data.valueMatchesType ? null : (
        <>
          {" "}
          <WrongTypeBadge />
        </>
      )}
    </>
  )

  if (tenantId === undefined) {
    return (
      <div role="status" className="flex flex-col gap-1 text-sm">
        <p>
          {"Without a tenant, the app default is "}
          {value}
          {"."}
        </p>
      </div>
    )
  }

  const overridden = data.source === "override"
  return (
    <div role="status" className="flex flex-col gap-1 text-sm">
      <p>
        {`Tenant ${tenantId} gets `}
        {value}
        {overridden
          ? ", from its override."
          : data.source === "appDefault"
            ? ", the app default."
            : `, from ${data.source}.`}
      </p>
      {overridden ? (
        <p>
          {"The app default is "}
          <ConfigValue value={data.appValue} valueType={valueType} />
          {"."}
        </p>
      ) : null}
    </div>
  )
}
