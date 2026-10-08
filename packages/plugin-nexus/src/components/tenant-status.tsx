import { useRef, useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { CheckIcon, PauseIcon, BanIcon } from "@forge-go/dashboard-kit/icons"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import type { Tenant, TenantStatus } from "../types"
const actions = {
  active: { label: "Activate tenant", icon: CheckIcon },
  disabled: { label: "Disable tenant", icon: BanIcon },
  suspended: { label: "Suspend tenant", icon: PauseIcon },
}
export function TenantStatusActions({ tenant }: { tenant: Tenant }) {
  const [target, setTarget] = useState<TenantStatus>()
  const command = useCommand<Tenant>("tenants.setStatus")
  const sending = useRef(false)
  async function confirm() {
    if (!target || sending.current) return
    sending.current = true
    try {
      if (await command.execute({ id: tenant.id, status: target }))
        setTarget(undefined)
    } finally {
      sending.current = false
    }
  }
  return (
    <>
      {(Object.keys(actions) as TenantStatus[])
        .filter((status) => status !== tenant.status)
        .map((status) => (
          <IconButton
            key={status}
            label={actions[status].label}
            icon={actions[status].icon}
            onClick={() => {
              command.reset()
              setTarget(status)
            }}
          />
        ))}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => {
          if (!open && !sending.current) setTarget(undefined)
        }}
        title={`${target ? actions[target].label : "Change status"}: ${tenant.name}?`}
        description={
          target === "active"
            ? "This customer can resume gateway requests with valid keys."
            : "Gateway requests from this customer will be refused until access is restored."
        }
        confirmLabel={target ? actions[target].label : "Confirm"}
        destructive={target !== "active"}
        pending={command.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert
          title="Status could not be changed"
          error={command.error}
        />
      </ConfirmDialog>
    </>
  )
}
