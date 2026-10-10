import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@forge-go/dashboard-kit/components/popover"
import type { APIKey, Page } from "../types"
import { Empty, Refresh } from "./read"
import { tenantParams } from "./tenant-filter"

function KeyOptions({
  tenantId,
  cursor,
  choose,
}: {
  tenantId?: string
  cursor?: string
  choose: (id: string) => void
}) {
  const [more, setMore] = useState(false)
  const query = useQuery<Page<APIKey>>("keys.list", {
    ...tenantParams(tenantId),
    ...(cursor ? { cursor } : {}),
    limit: 25,
  })
  if (query.error)
    return (
      <div role="alert">
        {query.error.code}: {query.error.message}
        <Refresh onClick={query.refetch} />
      </div>
    )
  if (!query.data) return <p role="status">Loading keys…</p>
  return (
    <>
      {!query.data.items.length && !cursor && (
        <Empty
          title="No keys for this selection"
          body="Select another tenant or clear the tenant filter."
          action={<Refresh onClick={query.refetch} />}
        />
      )}
      {query.data.items.map((k) => (
        <Button
          key={k.id}
          variant="ghost"
          size="sm"
          className="h-auto justify-start text-left whitespace-normal"
          onClick={() => choose(k.id)}
        >
          {k.name} · {k.prefix}… · {k.status}
        </Button>
      ))}
      {query.data.nextCursor &&
        (more ? (
          <KeyOptions
            key={query.data.nextCursor}
            tenantId={tenantId}
            cursor={query.data.nextCursor}
            choose={choose}
          />
        ) : (
          <IconButton
            variant="outline"
            onClick={() => setMore(true)}
            label="Load more keys"
          />
        ))}
    </>
  )
}
export function KeyFilter({
  value,
  tenantId,
  onChange,
}: {
  value?: string
  tenantId?: string
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = useQuery<APIKey>(
    "keys.get",
    { id: value },
    { enabled: value !== undefined }
  )
  const label = value ? (selected.data?.name ?? value) : "All keys"
  const choose = (id?: string) => {
    onChange(id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="sm" variant="outline" />}
        aria-label={`Key: ${label}`}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2">
        <PopoverTitle>API key</PopoverTitle>
        <div className="flex max-h-72 min-w-0 flex-col gap-1 overflow-y-auto">
          <IconButton
            variant="ghost"
            onClick={() => choose()}
            label="All keys"
          />
          {open && (
            <KeyOptions key={tenantId} tenantId={tenantId} choose={choose} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
