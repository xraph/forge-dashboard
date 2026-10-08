import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import type { ContractError } from "@forge-go/dashboard-plugin"

/**
 * Says a refresh failed while the page keeps what it last read, with a way to
 * try again. A polled page also tries again on its own.
 */
export function StaleNotice({
  what,
  error,
  onRetry,
}: {
  what: string
  error?: ContractError
  onRetry: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm"
    >
      <span>
        {`Couldn't refresh ${what}${error ? `: ${error.message}` : ""}. Showing what was last read.`}
      </span>
      <IconButton variant="outline" onClick={onRetry} label="Try again" />
    </div>
  )
}
