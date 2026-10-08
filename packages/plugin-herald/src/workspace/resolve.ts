import type { ResolveMatch } from "../wire"

/** What resolution reads from a version: its locale and its live switch. VersionWire fits. */
export interface VersionState {
  id: string
  locale: string
  active: boolean
}

export interface LocaleStep {
  try: string
  match: ResolveMatch
  found: boolean
  versionId?: string
}

/**
 * Herald's template.Explain, mirrored: the exact locale, then its language
 * ("fr" for "fr-CA"), then the "" fallback, each taking only a live version.
 * The workspace uses it to say, before a switch flips or a version goes, what
 * will answer a locale afterwards. The locale tester asks the server
 * (templates.resolve) instead, so the two can be compared if they drift.
 */
export function explainLocale(
  versions: VersionState[],
  locale: string
): { steps: LocaleStep[]; versionId: string | null } {
  const steps: LocaleStep[] = []
  const attempt = (want: string, match: ResolveMatch): string | null => {
    const v = versions.find((x) => x.active && x.locale === want)
    steps.push(
      v
        ? { try: want, match, found: true, versionId: v.id }
        : { try: want, match, found: false }
    )
    return v ? v.id : null
  }
  let id = attempt(locale, "exact")
  if (id) return { steps, versionId: id }
  const dash = locale.indexOf("-")
  if (dash > 0) {
    id = attempt(locale.slice(0, dash), "language")
    if (id) return { steps, versionId: id }
  }
  if (locale !== "") {
    id = attempt("", "default")
    if (id) return { steps, versionId: id }
  }
  return { steps, versionId: null }
}

export function withActive<T extends VersionState>(
  versions: T[],
  id: string,
  active: boolean
): T[] {
  return versions.map((v) => (v.id === id ? { ...v, active } : v))
}

export function without<T extends VersionState>(
  versions: T[],
  id: string
): T[] {
  return versions.filter((v) => v.id !== id)
}

/** A version as people say it. "" is the fallback version. */
export function versionName(locale: string): string {
  return locale === "" ? "the fallback version" : `the ${locale} version`
}

/** What a request for `locale` gets among `versions`, in words. */
export function answerText(versions: VersionState[], locale: string): string {
  const { versionId } = explainLocale(versions, locale)
  const v =
    versionId === null ? undefined : versions.find((x) => x.id === versionId)
  return v ? versionName(v.locale) : "nothing, so a send in that locale fails"
}

export type Answers =
  | { kind: "fallback" }
  | { kind: "locale"; locale: string; wildcard: string | null }
  | null

/** Which requested locales a live version answers. A bare language also answers its regions that have no live version of their own. */
export function answersFor(version: VersionState): Answers {
  if (!version.active) return null
  if (version.locale === "") return { kind: "fallback" }
  return {
    kind: "locale",
    locale: version.locale,
    wildcard: version.locale.includes("-") ? null : `${version.locale}-*`,
  }
}
