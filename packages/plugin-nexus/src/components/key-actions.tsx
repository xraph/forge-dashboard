import { useRef, useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { RotateCwIcon, BanIcon } from "@forge-go/dashboard-kit/icons"
import type { APIKey } from "../types"
import { KeyDialog } from "./key-dialog"
export function KeyActions({ apiKey }: { apiKey?: APIKey }) {
  const [rotating, setRotating] = useState<APIKey>(),
    [revoking, setRevoking] = useState<APIKey>()
  const command = useCommand<APIKey>("keys.revoke"),
    sending = useRef(false)
  async function revoke() {
    if (!revoking || sending.current) return
    sending.current = true
    try {
      if (await command.execute({ id: revoking.id })) setRevoking(undefined)
    } finally {
      sending.current = false
    }
  }
  return (
    <>
      {apiKey?.status === "active" && (
        <IconButton
          icon={RotateCwIcon}
          label="Rotate key"
          onClick={() => setRotating(apiKey)}
        />
      )}
      {apiKey && apiKey.status !== "revoked" && (
        <IconButton
          icon={BanIcon}
          label="Revoke key"
          onClick={() => {
            command.reset()
            setRevoking(apiKey)
          }}
        />
      )}
      <KeyDialog
        open={!!rotating}
        rotating={rotating}
        onOpenChange={(open) => {
          if (!open) setRotating(undefined)
        }}
      />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open && !sending.current) setRevoking(undefined)
        }}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        description="This key stops working immediately. Revocation cannot be undone."
        confirmLabel="Revoke key"
        pending={command.loading}
        onConfirm={() => void revoke()}
      >
        <CommandAlert title="Key could not be revoked" error={command.error} />
      </ConfirmDialog>
    </>
  )
}
