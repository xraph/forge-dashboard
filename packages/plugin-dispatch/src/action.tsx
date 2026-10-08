import { useRef, useState } from "react"
import type { ReactNode } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"

interface ActionProps<T> {
  intent: string
  payload: unknown
  label: string
  title: string
  description: ReactNode
  destructive?: boolean
  disabled?: boolean
  onSuccess?: (result: T) => void
}
export function Action<T>(props: ActionProps<T>) {
  return <ActionState key={props.intent} {...props} />
}
function ActionState<T>({
  intent,
  payload,
  label,
  title,
  description,
  destructive = true,
  disabled = false,
  onSuccess,
}: ActionProps<T>) {
  const command = useCommand<T>(intent)
  const [confirmation, setConfirmation] = useState<{
    payload: unknown
    label: string
    title: string
    description: ReactNode
  } | null>(null)
  const inFlight = useRef(false)
  async function confirm() {
    if (inFlight.current || !confirmation) return
    inFlight.current = true
    try {
      const result = await command.execute(confirmation.payload)
      if (result !== undefined) {
        setConfirmation(null)
        onSuccess?.(result)
      }
    } finally {
      inFlight.current = false
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled || command.loading}
        onClick={() => {
          command.reset()
          setConfirmation({ payload, label, title, description })
        }}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(next) => {
          if (!next && !inFlight.current) setConfirmation(null)
        }}
        title={confirmation?.title ?? title}
        description={confirmation?.description}
        pending={command.loading}
        destructive={destructive}
        confirmLabel={confirmation?.label ?? label}
        onConfirm={() => {
          void confirm()
        }}
      >
        <CommandAlert
          title={(confirmation?.label ?? label) + " failed"}
          error={command.error}
        />
      </ConfirmDialog>
    </>
  )
}
