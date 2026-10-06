import type { TemplateField } from "../wire"

export const FIELD_LABEL: Record<TemplateField, string> = { subject: "Subject", html: "HTML", text: "Text", title: "Title" }

export const ALL_FIELDS: TemplateField[] = ["subject", "html", "text", "title"]

/** The fields each channel sends, in the order a person reads them. */
const PRIMARY: Record<string, TemplateField[]> = {
  email: ["subject", "html", "text"],
  sms: ["text"],
  push: ["title", "text"],
  inapp: ["title", "text"],
  webhook: ["subject", "text"],
  chat: ["subject", "text"],
}

/** A channel's own fields first; the rest fold under "Other fields" and stay editable. An unknown channel shows them all. */
export function fieldsFor(channel: string): { primary: TemplateField[]; other: TemplateField[] } {
  const primary = PRIMARY[channel] ?? ALL_FIELDS
  return { primary, other: ALL_FIELDS.filter((f) => !primary.includes(f)) }
}

/** Every client shows a subject or a title on one line. */
export const SINGLE_LINE: ReadonlySet<TemplateField> = new Set<TemplateField>(["subject", "title"])

export const FIELD_LANGUAGE: Record<TemplateField, "html" | "text"> = { subject: "text", html: "html", text: "text", title: "text" }
