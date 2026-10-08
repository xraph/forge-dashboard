import { useMemo, useRef } from "react"
import type { ContractError } from "@forge-go/dashboard-plugin"
let sequence = 0
export function useAttemptKey() {
  const current = useRef<{ payload: string; key: string } | null>(null)
  return useMemo(
    () => ({
      keyFor(payload: unknown) {
        const text = JSON.stringify(payload)
        if (!current.current || current.current.payload !== text)
          current.current = {
            payload: text,
            key:
              globalThis.crypto?.randomUUID?.() ??
              `nexus-${Date.now()}-${++sequence}-${Math.random().toString(36).slice(2)}`,
          }
        return current.current.key
      },
      end() {
        current.current = null
      },
    }),
    []
  )
}
export function commandOutcome(
  error?: ContractError
): "unknown" | "running" | "spent" | "failed" {
  if (!error) return "failed"
  const reason = error.details?.reason
  if (reason === "idempotency.already_ran") return "spent"
  if (reason === "idempotency.still_running") return "running"
  if (!reason && error.code === "CONFLICT") {
    if (error.message.startsWith("command already ran")) return "spent"
    if (error.message.startsWith("the same command is still running"))
      return "running"
  }
  if (
    !error.code ||
    (error.code === "TRANSPORT" && !/HTTP 40[13]$/.test(error.message))
  )
    return "unknown"
  return "failed"
}
