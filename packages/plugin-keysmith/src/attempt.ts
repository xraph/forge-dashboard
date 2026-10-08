import { useMemo, useRef } from "react"
import type { ContractError } from "@forge-go/dashboard-plugin"

/**
 * One idempotency key per filled form, for the two commands that answer a raw
 * key once: keys.create and keys.rotate.
 *
 * Without it the client mints a fresh key on every press, so a retry after a
 * lost answer is a second command and mints a second key. With it, pressing
 * again with the form unchanged is the same command: the server either runs
 * it (the first never arrived) or answers CONFLICT (it ran, see `alreadyRan`).
 *
 * The key belongs to the payload it was minted for. `keyFor` hands back the
 * same key while the payload is unchanged and mints a new one the moment it
 * differs, so any edit that changes what would be sent starts a new command.
 * `end` forgets it: after a reveal, after the server said the command already
 * ran, and after a context switch, when the same payload means another
 * tenant. Closing the dialog unmounts the form, which forgets it too.
 *
 * The ref is read and written only from event handlers and effects.
 */
export function useAttemptKey(): {
  keyFor: (payload: unknown) => string
  end: () => void
} {
  const attempt = useRef<{ key: string; payload: string } | null>(null)

  // One object for the life of the form, so effects can depend on it.
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
 * Mints one idempotency key, the way the plugin client does when a caller
 * passes none. `crypto.randomUUID` exists only in a secure context, and a
 * dashboard served over plain http to anything but localhost has none, so the
 * fallback is needed. The key is a deduplication handle the server compares
 * for equality, not a secret.
 */
function newIdempotencyKey(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === "function") return c.randomUUID()
  fallbackSequence += 1
  return `ik-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

// The start of the dispatcher's answer to a replayed command whose response
// held a secret (forge v1.12.1). Matched with the code: keysmith also answers
// CONFLICT when a key changed while you were acting on it.
const ALREADY_RAN = "command already ran"

/**
 * The server says this idempotency key already ran a command whose answer held
 * a raw key, and that answer is gone. The key was created or rotated; nothing
 * can show its secret now.
 */
export function alreadyRan(error: ContractError | undefined): boolean {
  return (
    error?.code === "CONFLICT" &&
    typeof error.message === "string" &&
    error.message.startsWith(ALREADY_RAN)
  )
}

// forge v1.12.2 holds the idempotency key while a command runs. A repeat in
// that time answers CONFLICT with this, and the key stays the right one to
// send again.
const STILL_RUNNING = "the same command is still running"
// What v1.12.2 answers when a custom store could not take the claim at all.
const CLAIM_FAILED = "could not claim the idempotency key"

/**
 * An earlier send under this idempotency key is still running. Nothing is
 * known yet, so the key stays: the next press either waits its turn or hears
 * that the command already ran.
 */
export function stillRunning(error: ContractError | undefined): boolean {
  return (
    error?.code === "CONFLICT" &&
    typeof error.message === "string" &&
    error.message.startsWith(STILL_RUNNING)
  )
}

/** The server could not claim the idempotency key, so nothing ran. */
export function claimFailed(error: ContractError | undefined): boolean {
  return (
    error?.code === "UNAVAILABLE" &&
    typeof error.message === "string" &&
    error.message.startsWith(CLAIM_FAILED)
  )
}

/**
 * The answer never arrived, so nobody knows whether the command ran. A network
 * failure reaches `useCommand` as a plain Error with no code, and anything the
 * client could not read as an envelope is TRANSPORT.
 */
export function lostAnswer(error: ContractError | undefined): boolean {
  return (
    error !== undefined &&
    (error.code === undefined || error.code === "TRANSPORT")
  )
}
