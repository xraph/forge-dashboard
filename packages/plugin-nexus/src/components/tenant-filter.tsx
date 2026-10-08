import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@forge-go/dashboard-kit/components/popover"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import type { Page, Tenant } from "../types"

export function tenantParams(value: string | undefined): { tenantId?: string } {
  return value === undefined ? {} : { tenantId: value }
}

function TenantOptions({
  search,
  cursor,
  choose,
}: {
  search: string
  cursor?: string
  choose: (tenant: Tenant) => void
}) {
  const [more, setMore] = useState(false)
  const query = useQuery<Page<Tenant>>("tenants.list", {
    search,
    ...(cursor ? { cursor } : {}),
    limit: 25,
  })
  if (query.error)
    return (
      <div role="alert">
        {query.error.message}{" "}
        <IconButton variant="outline" onClick={() => void query.refetch()} label="Retry tenants" />
      </div>
    )
  if (!query.data) return <p role="status">Loading tenants…</p>
  return (
    <>
      {!query.data.items.length && !cursor && (
        <ZeroState
          title="No matching tenants"
          body="Try another name or slug."
        />
      )}
      {query.data.items.map((tenant) => (
        <Button
          key={tenant.id}
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => choose(tenant)}
        >
          {tenant.name}
        </Button>
      ))}
      {query.data.nextCursor &&
        (more ? (
          <TenantOptions
            key={query.data.nextCursor}
            search={search}
            cursor={query.data.nextCursor}
            choose={choose}
          />
        ) : (
          <IconButton variant="outline" onClick={() => setMore(true)} label="Load more tenants" />
        ))}
    </>
  )
}

export function TenantFilter({
  value,
  onChange,
}: {
  value?: string
  onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const selected = useQuery<Tenant>(
    "tenants.get",
    { id: value },
    { enabled: value !== undefined }
  )
  const label =
    value === undefined ? "All tenants" : (selected.data?.name ?? value)
  const choose = (tenant?: Tenant) => {
    onChange(tenant?.id)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
        aria-label={`Tenant: ${label}`}
      >
        {label}
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-2">
        <PopoverTitle>Tenant</PopoverTitle>
        <Input
          aria-label="Search tenants"
          placeholder="Search name or slug"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          <IconButton variant="ghost" onClick={() => choose()} label="All tenants" />
          {open && (
            <TenantOptions key={search} search={search} choose={choose} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
