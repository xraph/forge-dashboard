import { useState } from "react"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { NativeSelect } from "@forge-go/dashboard-kit/components/native-select"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { KeyDialog } from "../components/key-dialog"
import { KeyList } from "../components/key-list"
import { TenantFilter } from "../components/tenant-filter"

export function KeysPage() {
  const [tenantId, setTenantId] = useState<string>(),
    [status, setStatus] = useState("active"),
    [creating, setCreating] = useState(false)
  return (
    <div className="space-y-3">
      <PageHeader
        title="API keys"
        description="Tenant access, scopes and effective key status."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            Create API key
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <TenantFilter value={tenantId} onChange={setTenantId} />
        <NativeSelect
          aria-label="Key status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="">All statuses</option>
          <option value="revoked">Revoked</option>
          <option value="expired">Expired</option>
        </NativeSelect>
      </div>
      <KeyList
        key={`${tenantId}:${status}`}
        tenantId={tenantId}
        status={status}
        onClear={() => {
          setTenantId(undefined)
          setStatus("")
        }}
      />
      <KeyDialog
        open={creating}
        onOpenChange={setCreating}
        tenantId={tenantId}
      />
    </div>
  )
}
