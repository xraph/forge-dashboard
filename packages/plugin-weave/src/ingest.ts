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

/**
 * The size of the envelope the transport will refuse past 1 MiB, close
 * enough to decide on: the same fields the client sends, a 64 character CSRF
 * token and a UUID idempotency key. JSON escaping is what makes this larger
 * than the content: each quote, backslash and newline takes two bytes.
 */
export function requestBytes(payload: unknown): number {
  return utf8Length(
    JSON.stringify({
      envelope: "v1",
      kind: "command",
      contributor: "weave",
      intent: "documents.ingest",
      payload,
      csrf: "x".repeat(64),
      idempotencyKey: "00000000-0000-0000-0000-000000000000",
    }),
  )
}

/** Why this content can't be sent, naming the limit it hit, or null. */
export function sizeProblem(content: string, payload: unknown): string | null {
  const size = utf8Length(content)
  if (size > CONTENT_CAP) {
    return `Weave ingests up to 1 MiB of text (${formatBytes(CONTENT_CAP)}). This is ${formatBytes(size)}.`
  }
  const request = requestBytes(payload)
  if (request > ENVELOPE_CAP) {
    return `This is under Weave's 1 MiB cap, but the request would be ${formatBytes(request)} once JSON-encoded, which is over the dashboard's 1 MiB request limit. Your operator can raise contract_max_body_bytes in the dashboard's config; about 3 MiB covers files near Weave's cap.`
  }
  return null
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
