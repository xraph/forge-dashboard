import { VARIABLE_PATTERN } from "../format"
import type {
  Content,
  TemplateDetail,
  TemplateField,
  VariableWire,
} from "../wire"

export interface Settings {
  name: string
  category: string
  enabled: boolean
}

/** Everything the header's Save writes: each version's content, the variables, and the settings. */
export interface Draft {
  settings: Settings
  variables: VariableWire[]
  /** Keyed by version ID. */
  versions: Record<string, Content>
}

export type Change =
  | { kind: "field"; versionId: string; field: TemplateField }
  | { kind: "variables" }
  | { kind: "setting"; key: keyof Settings }

export type TemplatePatch = {
  name?: string
  category?: string
  enabled?: boolean
  variables?: VariableWire[]
}

const FIELDS: TemplateField[] = ["subject", "html", "text", "title"]

const contentOf = (v: Content): Content => ({
  subject: v.subject,
  html: v.html,
  text: v.text,
  title: v.title,
})

export function draftOf(t: TemplateDetail): Draft {
  return {
    settings: { name: t.name, category: t.category, enabled: t.enabled },
    variables: t.variables.map((v) => ({ ...v })),
    versions: Object.fromEntries(t.versions.map((v) => [v.id, contentOf(v)])),
  }
}

/** The shape Save sends: names trimmed, absent strings filled, so "" and absent compare equal. */
export function normaliseVariables(vars: VariableWire[]): VariableWire[] {
  return vars.map((v) => ({
    name: v.name.trim(),
    type: v.type.trim(),
    required: v.required,
    default: v.default ?? "",
    description: v.description ?? "",
  }))
}

/** Compared as sent, so a reorder is a change and an edit put back isn't. */
export function sameVariables(a: VariableWire[], b: VariableWire[]): boolean {
  return (
    JSON.stringify(normaliseVariables(a)) ===
    JSON.stringify(normaliseVariables(b))
  )
}

export function changesBetween(saved: Draft, draft: Draft): Change[] {
  const out: Change[] = []
  for (const [id, now] of Object.entries(draft.versions)) {
    const was = saved.versions[id]
    if (!was) continue
    for (const field of FIELDS)
      if (now[field] !== was[field])
        out.push({ kind: "field", versionId: id, field })
  }
  if (!sameVariables(saved.variables, draft.variables))
    out.push({ kind: "variables" })
  for (const key of ["name", "category", "enabled"] as const)
    if (draft.settings[key] !== saved.settings[key])
      out.push({ kind: "setting", key })
  return out
}

export function versionPatch(
  saved: Content,
  draft: Content
): Partial<Content> | null {
  const patch: Partial<Content> = {}
  for (const field of FIELDS)
    if (draft[field] !== saved[field]) patch[field] = draft[field]
  return Object.keys(patch).length === 0 ? null : patch
}

export function templatePatch(
  saved: Draft,
  draft: Draft
): TemplatePatch | null {
  const patch: TemplatePatch = {}
  if (draft.settings.name !== saved.settings.name)
    patch.name = draft.settings.name.trim()
  if (draft.settings.category !== saved.settings.category)
    patch.category = draft.settings.category
  if (draft.settings.enabled !== saved.settings.enabled)
    patch.enabled = draft.settings.enabled
  if (!sameVariables(saved.variables, draft.variables))
    patch.variables = normaliseVariables(draft.variables)
  return Object.keys(patch).length === 0 ? null : patch
}

/**
 * Takes a fresh server answer without losing edits.
 *
 * Every write invalidates templates.detail, so the page gets a new answer
 * after each save, switch or new locale, and someone else's edits arrive the
 * same way. Anything the draft hasn't changed since `prev` follows `next`;
 * anything it has changed stays. A version new on the server joins the draft,
 * and one that's gone leaves it.
 */
export function rebase(prev: Draft, next: Draft, draft: Draft): Draft {
  const pick = <K extends keyof Settings>(key: K): Settings[K] =>
    draft.settings[key] === prev.settings[key]
      ? next.settings[key]
      : draft.settings[key]
  const versions: Record<string, Content> = {}
  for (const [id, theirs] of Object.entries(next.versions)) {
    const mine = draft.versions[id]
    const was = prev.versions[id]
    if (!mine || !was) {
      versions[id] = theirs
      continue
    }
    const merged = { ...mine }
    for (const field of FIELDS)
      if (mine[field] === was[field]) merged[field] = theirs[field]
    versions[id] = merged
  }
  return {
    settings: {
      name: pick("name"),
      category: pick("category"),
      enabled: pick("enabled"),
    },
    variables: sameVariables(draft.variables, prev.variables)
      ? next.variables
      : draft.variables,
    versions,
  }
}

/** Herald's own variable rules (handlers_templates.go, validVariables), by row, so Save can wait instead of being refused. */
export function variableProblems(vars: VariableWire[]): Map<number, string> {
  const out = new Map<number, string>()
  const seen = new Set<string>()
  vars.forEach((v, i) => {
    const name = v.name.trim()
    if (name === "") out.set(i, "A variable needs a name.")
    else if (!VARIABLE_PATTERN.test(name))
      out.set(
        i,
        "Use up to 64 letters, digits and underscores, starting with a letter or an underscore."
      )
    else if (seen.has(name)) out.set(i, `${name} is declared twice.`)
    else seen.add(name)
  })
  return out
}
