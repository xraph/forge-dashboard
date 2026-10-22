import { useMemo, useRef } from "react"
import type { ContractError } from "@forge-go/dashboard-plugin"

/**
 * One idempotency key per filled form, for the two commands that answer a
 * password once: devices.provision and devices.rotate.
 *
 * Without it the client mints a fresh key on every press, so a retry after a
 * lost answer is a second command and makes a second key. With it, pressing
 * again with the form unchanged is the same command: the server either runs it
 * (the first never arrived) or answers CONFLICT (it ran, see `alreadyRan`).
 *
 * The key belongs to the payload it was minted for: an edit that changes what
 * would be sent starts a new command. Closing the dialog unmounts the form,
 * which forgets it too. Same shape as plugin-keysmith's `useAttemptKey`.
 */
export function useAttemptKey(): {
  keyFor: (payload: unknown) => string
  end: () => void
} {
  const attempt = useRef<{ key: string; payload: string } | null>(null)

  return useMemo(
    () => ({
      keyFor(payload: unknown): string {
        const filled = JSON.stringify(payload)
        if (attempt.current === null || attempt.current.payload !== filled) {
          attempt.current = { key: newIdempotencyKey(), payload: filled }
        }
        return attempt.current.key
      },
      end(): void {
        attempt.current = null
      },
    }),
    []
  )
}

let fallbackSequence = 0

/**
 * `crypto.randomUUID` exists only in a secure context, and a dashboard served
 * over plain http to anything but localhost has none. The key is a
 * deduplication handle the server compares for equality, not a secret.
 */
function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === "function") return c.randomUUID()
  fallbackSequence += 1
  return `ik-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

/**
 * The server says this idempotency key already ran a command whose answer held
 * a password, and that answer is gone. The device was made or its key rotated;
 * nothing can show the secret now. forge's dispatcher names the reason in
 * `details.reason`; a server that sends none is read by code and message.
 */
export function alreadyRan(error: ContractError | undefined): boolean {
  if (error === undefined) return false
  const reason = error.details?.reason
  if (typeof reason === "string") return reason === "idempotency.already_ran"
  return (
    error.code === "CONFLICT" &&
    typeof error.message === "string" &&
    error.message.startsWith("command already ran")
  )
}
