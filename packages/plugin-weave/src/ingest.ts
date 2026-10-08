import { formatBytes, utf8Length } from "./format"

/** Weave's own cap on ingest content, in bytes. */
export const CONTENT_CAP = 1024 * 1024
/** Forge's default cap on a whole request envelope, in bytes. */
export const ENVELOPE_CAP = 1024 * 1024

const TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  csv: "text/csv",
  json: "application/json",
}

/** The source type Weave's loader is chosen by, from a file's extension. */
export function sourceTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ""
  return TYPES[ext] ?? "text/plain"
}

/** Spare bytes kept under the transport limit, so an envelope field added later doesn't reopen the gap. */
export const ENVELOPE_HEADROOM = 512

/**
 * The size of the envelope the transport will refuse past its limit. This
 * mirrors, field for field and in order, what packages/plugin/src/client.ts
 * sends for a command: the empty context, a 75 character CSRF token (Forge's
 * 64 hex characters, a ".", and a 10 digit timestamp) and a UUID idempotency
 * key. JSON escaping is what makes this larger than the content: each quote,
 * backslash and newline takes two bytes.
 */
export function requestBytes(payload: unknown): number {
  return utf8Length(
    JSON.stringify({
      envelope: "v1",
      kind: "command",
      contributor: "weave",
      intent: "documents.ingest",
      payload,
      context: {},
      csrf: "x".repeat(75),
      idempotencyKey: "00000000-0000-0000-0000-000000000000",
    })
  )
}

export interface SizeProblem {
  /** content: Weave's own cap, which nobody can raise. envelope: the dashboard's default request limit, which an operator can. */
  kind: "content" | "envelope"
  message: string
}

/** Why this content can't be sent, or might not be, naming the limit it hit; null when it fits. */
export function sizeProblem(
  content: string,
  payload: unknown
): SizeProblem | null {
  const size = utf8Length(content)
  if (size > CONTENT_CAP) {
    return {
      kind: "content",
      message: `Weave ingests up to 1 MiB of text (${formatBytes(CONTENT_CAP)}). This is ${formatBytes(size)}.`,
    }
  }
  const request = requestBytes(payload)
  if (request + ENVELOPE_HEADROOM > ENVELOPE_CAP) {
    return {
      kind: "envelope",
      message: `The encoded request would be about ${formatBytes(request)}, over the dashboard's default 1 MiB request limit. Unless your operator raised contract_max_body_bytes, the server will refuse it.`,
    }
  }
  return null
}

/** Said under a command error when the transport's body limit refused the request. */
export function isBodyLimitError(
  error: { code: string; message: string } | null | undefined
): boolean {
  return (
    error?.code === "BAD_REQUEST" &&
    error.message.startsWith("request body exceeds")
  )
}

/** A picked file's text. Blob.text where the browser has it, FileReader where it doesn't. */
export function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
