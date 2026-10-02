import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { MiddlewareList, MiddlewareRegistration } from "../types"

type Row = MiddlewareRegistration & { order: number }

function runs(value: boolean | null, what: string) {
  if (value === null) return <NoneCell label={what} />
  return value ? "Runs" : "Skipped"
}

function columnsFor(tested: boolean): Column<Row>[] {
  const base: Column<Row>[] = [
    { id: "order", header: "Order", className: "font-mono text-xs", cell: (r) => r.order },
    { id: "name", header: "Middleware", className: "font-mono text-xs font-medium", cell: (r) => r.name },
    { id: "direction", header: "Direction", cell: (r) => r.direction },
    { id: "scope", header: "Scope", className: "font-mono text-xs", cell: (r) => r.scope },
    { id: "priority", header: "Priority", className: "font-mono text-xs", cell: (r) => r.priority },
  ]
  if (!tested) return base
  return [
    ...base,
    { id: "write", header: "On write", cell: (r) => runs(r.matchesWrite, "write result") },
    { id: "read", header: "On read", cell: (r) => runs(r.matchesRead, "read result") },
  ]
}

function caption(n: number, tested: { bucket: string; key: string } | null): string {
  const count = `${n} ${n === 1 ? "registration" : "registrations"}`
  return tested ? `${count}, tested against ${tested.bucket}/${tested.key}` : count
}

export const MiddlewarePage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const [bucket, setBucket] = useState("")
  const [key, setKey] = useState("")
  const [tested, setTested] = useState<{ bucket: string; key: string } | null>(null)
  const list = useQuery<MiddlewareList>("middleware.list", withStore(store, tested ? { ...tested } : {}))

  const canTest = bucket.trim() !== "" && key !== ""

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canTest) return
    setTested({ bucket: bucket.trim(), key })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Middleware"
        description="Every middleware registered on this store, in the order it runs. This is the configuration now. Trove records nothing about how an existing object was written."
        actions={<StorePicker />}
      />

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mw-bucket">Bucket</Label>
          <Input id="mw-bucket" className="font-mono" autoComplete="off" spellCheck={false} value={bucket} onChange={(e) => setBucket(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mw-key">Key</Label>
          <Input id="mw-key" className="font-mono" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <Button type="submit" disabled={!canTest}>
          Test
        </Button>
        {tested ? (
          <Button type="button" variant="outline" onClick={() => setTested(null)}>
            Clear test
          </Button>
        ) : null}
      </form>

      <QueryBoundary title="Middleware" query={list} skeletonRows={4}>
        {(data) => (
          <>
            {data.warnings.map((w) => (
              <Alert key={w.code}>
                <AlertDescription>{w.message}</AlertDescription>
              </Alert>
            ))}
            <ResourceTable<Row>
              columns={columnsFor(tested !== null)}
              rows={data.registrations.map((r, i) => ({ ...r, order: i + 1 }))}
              rowKey={(r) => `${r.order}`}
              caption={caption(data.registrations.length, tested)}
              emptyMessage="No middleware is registered for this store. Objects are stored as they arrive."
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
