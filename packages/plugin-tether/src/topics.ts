/**
 * Checks of a role's topic filters, mirroring `topic.Valid` in the tether repo
 * for the filters a grant may hold. The server stays the authority: this only
 * lets an operator see a mistake before the round trip.
 */

const SHARE = "$share"

/**
 * What is wrong with one filter, or null. Levels are split on "/" and read
 * left to right, as the broker does: `+` and `#` each occupy a whole level, and
 * `#` is only the last one. A shared subscription ("$share/group/filter") is
 * checked against its plain filter, so a grant is never written that way.
 */
export function filterProblem(filter: string): string | null {
  const levels = filter.split("/")
  if (levels[0].toLowerCase() === SHARE) {
    return "$share grants are not allowed. Grant the plain filter instead."
  }
  for (const [i, level] of levels.entries()) {
    if (level.includes("#")) {
      if (level !== "#") return "# must occupy a whole level."
      if (i < levels.length - 1) return "# must be the last level."
    } else if (level.includes("+") && level !== "+") {
      return "+ must occupy a whole level."
    }
  }
  return null
}

export interface CheckedFilters {
  /** One entry per non-blank line, trimmed. What would be sent. */
  filters: string[]
  /** "Line N: ..." for each filter that is wrong. N counts blank lines. */
  problems: string[]
}

/** Reads a textarea of filters, one per line. */
export function checkFilters(text: string): CheckedFilters {
  const filters: string[] = []
  const problems: string[] = []
  for (const [i, raw] of text.split("\n").entries()) {
    const filter = raw.trim()
    if (filter === "") continue
    filters.push(filter)
    const problem = filterProblem(filter)
    if (problem) problems.push(`Line ${i + 1}: ${problem}`)
  }
  return { filters, problems }
}

/** A filter list as the textarea shows it. */
export function joinFilters(filters: string[]): string {
  return filters.join("\n")
}

const SLUG = /^[a-z0-9][a-z0-9_-]*$/
export const MAX_SLUG = 63

/** What is wrong with a role slug, or null. Mirrors `perm.Roles.Create`. */
export function slugProblem(slug: string): string | null {
  if (slug === "") return "Slug is required."
  if (slug.length > MAX_SLUG || !SLUG.test(slug)) {
    return `Slug must be 1 to ${MAX_SLUG} characters of lower case letters, digits, _ and -, starting with a letter or digit.`
  }
  return null
}
