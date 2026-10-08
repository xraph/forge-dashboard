import type { VariableWire } from "../wire"

/**
 * The preview's sample data: prefilled from each declared variable's default,
 * or a placeholder for its type, and parsed as the operator edits it. Herald
 * doesn't check variable types, so an unknown type gets a string.
 */
export function placeholderFor(v: VariableWire): string | number | boolean {
  if (v.default !== undefined && v.default !== "") return v.default
  switch (v.type.trim().toLowerCase()) {
    case "url":
      return "https://example.com/"
    case "number":
    case "int":
    case "float":
      return 1
    case "bool":
    case "boolean":
      return true
    default:
      return `example ${v.name.trim().replaceAll("_", " ")}`
  }
}

export function sampleDataFor(vars: VariableWire[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const v of vars) {
    const name = v.name.trim()
    if (name !== "") out[name] = placeholderFor(v)
  }
  return out
}

export function sampleTextFor(vars: VariableWire[]): string {
  return JSON.stringify(sampleDataFor(vars), null, 2)
}

export type SampleParse =
  { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

export function parseSample(text: string): SampleParse {
  if (text.trim() === "") return { ok: true, data: {} }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      message: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      message: 'Sample data must be a JSON object, like {"name": "Ada"}.',
    }
  }
  return { ok: true, data: value as Record<string, unknown> }
}
