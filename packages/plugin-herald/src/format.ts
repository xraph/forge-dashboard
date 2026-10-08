import type { CredentialStatus, MessageStatus } from "./wire"

/** "1 provider", "0 providers", "2 categories". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * "3 encrypted", "2 plaintext, 1 encrypted", or null for none. Plaintext comes
 * first because it is the part somebody has to act on.
 */
export function credentialSummary(creds: CredentialStatus[]): string | null {
  if (creds.length === 0) return null
  const plaintext = creds.filter((c) => c.protection !== "aes-256-gcm").length
  const encrypted = creds.length - plaintext
  const parts: string[] = []
  if (plaintext > 0) parts.push(`${plaintext} plaintext`)
  if (encrypted > 0) parts.push(`${encrypted} encrypted`)
  return parts.join(", ")
}

/** Column and filter order: the common outcome first, then what needs a look. */
export const STATUS_ORDER: MessageStatus[] = [
  "sent",
  "sending",
  "suppressed",
  "failed",
  "queued",
  "delivered",
  "bounced",
]

/** The four statuses Herald writes today. The other three never occur. */
export const WRITTEN_STATUSES: MessageStatus[] = [
  "sending",
  "sent",
  "failed",
  "suppressed",
]

const STATUS_LABELS: Record<MessageStatus, string> = {
  sent: "Accepted by provider",
  sending: "Sending",
  suppressed: "Suppressed",
  failed: "Failed",
  queued: "Queued",
  delivered: "Delivered",
  bounced: "Bounced",
}

/** Never "delivered" for sent: a provider accepting a message is all Herald knows. */
export function statusLabel(status: MessageStatus): string {
  return STATUS_LABELS[status] ?? status
}

/** Said wherever a single send is shown. */
export const NO_RECEIPTS =
  "Herald doesn't receive delivery receipts, so delivery isn't confirmed."

export const PREF_CHANNELS = ["email", "sms", "push", "inapp"] as const
export const ROUTED_CHANNELS = [
  "email",
  "sms",
  "push",
  "webhook",
  "chat",
] as const
export const CATEGORIES = [
  "auth",
  "transactional",
  "marketing",
  "system",
] as const

/** Herald's own patterns (extension/contract/handlers_templates.go), so a refusal shows before the round trip. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
export const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
