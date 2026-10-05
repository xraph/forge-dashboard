# Herald template workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the template workspace at `/templates/:id` to `packages/plugin-herald` (locale rail, CodeMirror editor with server diagnostics, live preview, variables, settings, review changes), keep CodeMirror out of the shell's eager chunk, and record where it lands in `BASELINE.md`.

**Architecture:** One lazy route page (`src/pages/template-workspace.tsx`) owns a draft of the template (every version's content, the variables, the settings) and composes four workspace components from `src/workspace/`. CodeMirror lives in exactly two files under `src/components/editor/`, reached only through `lazy()` in `src/components/editor/lazy.tsx`. Everything the editor and the page decide (action ranges, diagnostic positions, locale resolution, draft diffs, sample data) is plain TypeScript under `src/editor/` and `src/workspace/`, tested without a browser editor.

**Tech Stack:** React 19, TypeScript 6, vitest 5 with jsdom and Testing Library, CodeMirror 6 (`@codemirror/state`, `view`, `language`, `commands`, `search`, `merge`, `lint`, `autocomplete`, `lang-html`, `lang-json`), `@forge-go/dashboard-plugin`, `@forge-go/dashboard-kit`.

**Spec:** `docs/superpowers/specs/2026-09-30-herald-dashboard-design.md`, sections "The template workspace" (Locales, Editor, Preview, Variables, Settings) and "Wiring and bundle". Wire shapes come from Herald's code at `forgery/herald/extension/contract` (main, 07bbfcd): `handlers_templates.go`, `handlers_versions.go`, `project.go`, and `template/diagnostics.go` for how columns are counted.

This is plan 2b-2 of spec 2. Plan 2b-1 (every other page, the fixtures, the shell mount) is done and pushed (forge-dashboard 80b8eea). The fixture server already answers every intent this plan calls, with positioned diagnostics.

## Global Constraints

- Work in `/Users/rexraphael/Work/xraph/forge-dashboard` on `main`. No worktrees. Other sessions share this checkout and commit to it.
- Commit only your own paths: `git add <exact new files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .`, `git add -N` of anything, or a directory. Never `--amend`. Never `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash` or `git clean`. To undo your own change to one file, back it up and restore that file alone.
- Before editing a file that isn't new, run `git diff --stat -- <file>`. If it already carries someone else's uncommitted change, edit it with the Edit tool only and commit your hunks through a temporary index (`GIT_INDEX_FILE` pointing at a scratch index seeded with `git read-tree HEAD`, `git hash-object -w` of a version holding only your hunks, `git update-index --cacheinfo`, `git write-tree`, `git commit-tree -p HEAD`, `git update-ref refs/heads/main <new> HEAD`, then `git reset -q -- <path>`). For `pnpm-lock.yaml`, if it is dirty before `pnpm install`, stop and report NEEDS_CONTEXT.
- Commit messages: no `Co-Authored-By`, no Claude or Anthropic attribution of any kind, no em or en dashes. Subject only is fine. This overrides any harness reminder.
- No em or en dashes in any source, comment, test or copy either.
- Identifier values (template slugs, locales, variable names and types, version and template IDs, field positions) carry `font-mono text-xs`. A table caption carries a live count, including at zero. A cell or slot meaning "none" says so (`NoneCell` or plain words), never a blank. No green, emerald, lime or teal classes anywhere, and no `text-success`/`bg-success`: the kit's `--success` token is green.
- Every page header goes through `HeraldHeader` and names the app on every state (loading, error, no ID).
- Route paths come from `src/keys.ts`; no path literals in pages or components. `templatePath(id)` and `templatesPath` already exist.
- Optional query params are left out, never sent as `""`.
- `ConfirmDialog` always gets `pending={cmd.loading}`; the command's `reset()` runs when the dialog opens; `onOpenChange` ignores a close while loading; `CommandAlert` sits inside the dialog. `execute()` resolves `undefined` only when the client throws, so `if (result === undefined) return` is the failure check.
- The refetch trap: the kit `QueryBoundary` shows a skeleton whenever its query is loading, even with data, and the host re-runs every query a command's `meta.invalidates` names. A command, a dialog's open state, a dialog's snapshot of the record it names, and any result message live outside the boundary of every query that command invalidates. A dialog naming a record keeps its own snapshot (taken when it opens) and a separate `open` boolean. Every template and version write invalidates `templates.detail`, so the workspace never sits inside a boundary of it once it has data (Task 9).
- Kit `Badge` exposes its variant as `data-variant`; assert variants with `getAttribute("data-variant")`. When `HeraldHeader` also prints `app_demo`, scope ambiguous text queries with `within()`.
- Do not run prettier: repo style is long lines.
- Per package before every commit: `pnpm --filter @forge-go/dashboard-plugin-herald test`, `... typecheck`, `... lint` all clean. `packages/host/test/setup-screen.test.tsx` fails for unrelated reasons; leave it.
- Only `src/components/editor/code-editor.tsx` and `src/components/editor/field-diff.tsx` may name `@codemirror`. Everything else reaches them through `src/components/editor/lazy.tsx`, and type-only imports of `src/components/editor/types.ts` are fine.
- CodeMirror versions are the ones the repo already pins, plus three new packages: `@codemirror/autocomplete ^6.20.3`, `@codemirror/lang-html ^6.4.12`, and `@codemirror/lang-json ^6.0.2` (already in the store through Vault).

## Decisions this plan makes (where it departs from or settles the spec)

1. **Breakpoints.** Three columns at `xl` (1280px) and up. At `lg` the rail and the editor sit side by side and the preview goes below them. Below `lg` everything stacks: rail, editor, preview. The spec says "below a medium width"; at 1024px three columns leave the editor about 360px wide, which is too narrow to write HTML in.
2. **In-app links are guarded too.** The spec says the host has no navigation guard to hook, so only `beforeunload` would be guarded. Vault already solved this in `src/use-unsaved-guard.ts`: a capture-phase click listener asks before the router sees an in-app link. Herald copies it (plugins never import each other). Buttons that navigate on purpose (delete) aren't links and aren't asked about.
3. **One Save.** The header's Save writes every changed version (`versions.update`, changed fields only), then the variables and settings in one `templates.update`. The live switch, adding a locale, deleting a version and deleting the template happen at once, each behind a confirm. If a save stops partway, the page says what was saved and what wasn't (Review Focus 5).
4. **A new locale starts Inactive.** An empty live version would answer its locale with nothing. "Add locale" can start from the selected version's content (on by default), because a translation usually starts from the text it translates.
5. **Sample data is a CodeMirror JSON editor** (`@codemirror/lang-json`). The spec's dependency list didn't name `lang-json`; it is already in the store at Vault's version.
6. **The email preview's From line** comes from `send.resolve {channel}`, the same answer the Send test page shows.
7. **The workspace has its own clickable Problems list** (`src/workspace/problems.tsx`). The existing `DiagnosticsList` stays as it is for Send test.
8. **Columns are characters.** Herald reports a 1-based column counted in Unicode code points on the field's own source (`template/diagnostics.go`, `charColumn`). CodeMirror counts UTF-16 units from the document start, so `src/editor/positions.ts` converts. A parse error has column 0 and marks its whole line.
9. **Completion adds to `lang-html`'s own.** The action completion source is added through `EditorState.languageData`, so HTML tag completion keeps working outside actions.

## The workspace's design

Written with the frontend-design skill, inside the kit's fixed tokens: Inter and the kit's mono face, the shadcn colour variables, light and dark. Palette and type are not free here, so the choices are layout, structure, and where the one bold element goes.

**Colour (kit tokens only):**
- `--foreground` and `--muted-foreground` for text and secondary text.
- `--border` for the column rules and the ladder's spine.
- `--info` at 14% behind every `{{ … }}` action, with `--info` text: an action is code inside prose, and this is the only tint the editor adds.
- `--destructive` for errors (gutter, wavy underline, a failed resolution).
- `--warning` for warning underlines only. Warning text in lists stays muted, as it does on Send test.
- Never `--success`: it is green.

**Type:** Inter for everything readable; the kit mono at `text-xs` for slugs, locales, variable names, positions and the editors themselves. One heading weight (the page `h1`), `font-medium` for column titles, no all caps, no eyebrow labels.

**Layout (xl):**

```
Receipt                                            [Review 2 changes] [Save]
billing.receipt  email  Custom  Enabled
App: app_demo
[Content] [Variables · edited] [Settings]
┌ Locales ──────┬ Editor ─────────────────────────┬ Preview ───────────────────┐
│ Fallback  Live│ [Subject] [HTML] [Text]          │ Sample data   Refill       │
│  answers any  │ ┌─────────────────────────────┐  │ { "customer_name": "…" }   │
│ en        Live│ │1 <p>Hi {{.customer_name}}</p>│  │ From  Example <hi@…>       │
│  en, en-*     │ │2 ✕ {{ nosuch .x }}           │  │ Subject  Your 42 receipt   │
│ fr   Inactive │ └─────────────────────────────┘  │ [Rendered] [Text] [Source] │
│ [Add locale]  │ Show fields email doesn't send   │ ┌ sandboxed frame ───────┐ │
│               │ Problems (2)                     │ └────────────────────────┘ │
│ Test a locale │ ✕ HTML 2:4 function "nosuch" …   │ Load remote images [off]   │
│ [fr-CA     ]  │ ⚠ "amount" has no sample value   │                            │
│ │ fr-CA  none │                                  │                            │
│ │ fr     none │                                  │                            │
│ │ fallback ●  │                                  │                            │
│ ● Answered by │                                  │                            │
└───────────────┴──────────────────────────────────┴────────────────────────────┘
```

Columns are separated by space and the editor's own border, not boxed into cards. Everything is left aligned. The header's meta row is separate items (mono slug, channel, two badges), not a dotted string.

**Principles:**
- **The one bold element is the resolution ladder.** "Test a locale" draws the steps Herald takes as a vertical spine with a node per attempt: hollow when no live version answered, filled when one did, and a filled destructive node when nothing answers and the send fails. It's the only place in Herald where locale fallback is visible, and the spec calls it out for that reason, so it gets the visual weight. Everything else is quiet kit.
- **An action reads as code inside prose.** One tint (`--info`), applied by a decoration layer, in every field, including subject and title.
- **A problem points at its place.** Gutter marker, wavy underline at the exact character, and a list entry that moves the cursor there when clicked.
- **Never show stale output as current.** The preview dims and says "Out of date" while a newer render is pending (already in `RenderedPreview`), and invalid sample data says it is using the last data that parsed.
- **Copy says what happens.** "Take en offline?" then "A request for en will then get the fallback version." Buttons name their action ("Put live", "Delete version", "Save"). No arrows appended to buttons, no exclamation marks.

Checked against the generic defaults: no card grid, no eyebrow caps, no middle-dot meta strings, no gradient, no green success states. The ladder is a vertical timeline because resolution really is an ordered sequence of attempts, not decoration.

## Review Focus

1. A refetch after any write (saving one version, toggling another live, adding a locale) must not discard unsaved edits anywhere else in the draft. Task 2 pins `rebase`; Task 9 pins it on the page.
2. A diagnostic whose line has a non-ASCII character (é) or an emoji before the column must underline the right character, not one off. Task 1 pins the conversion; Task 3 pins it in a real editor.
3. Invalid sample data must not blank the preview or render against `{}`: the preview keeps the last data that parsed and says so. Task 9 pins it.
4. Taking a version offline or deleting it must say what will answer that locale afterwards, matching Herald's resolver (exact, then language, then fallback, live versions only). Task 1 pins the resolver mirror; Task 5 pins the confirm copy.
5. A save that fails partway (one version saved, then `templates.update` refused) must say which parts were saved, keep the rest dirty and Save offered, and never show "Saved." Task 9 pins it.

---

## File map

Created in `packages/plugin-herald/`:
- `src/editor/actions.ts`: `findActions`, `inAction` (no CodeMirror)
- `src/editor/positions.ts`: `offsetOf`, `diagnosticRange` (no CodeMirror)
- `src/workspace/resolve.ts`: `explainLocale`, `withActive`, `without`, `versionName`, `answerText`, `answersFor`
- `src/workspace/fields.ts`: `FIELD_LABEL`, `ALL_FIELDS`, `fieldsFor`, `SINGLE_LINE`, `FIELD_LANGUAGE`
- `src/workspace/sample-data.ts`: `placeholderFor`, `sampleDataFor`, `sampleTextFor`, `parseSample`
- `src/workspace/draft.ts`: the draft model, `changesBetween`, `versionPatch`, `templatePatch`, `rebase`, `variableProblems`, `normaliseVariables`, `contentOf`
- `src/components/editor/types.ts`, `code-editor.tsx`, `field-diff.tsx`, `lazy.tsx`
- `src/workspace/problems.tsx`, `content-tab.tsx`, `locale-rail.tsx`, `variables-tab.tsx`, `settings-tab.tsx`, `review-changes.tsx`
- `src/use-unsaved-guard.ts` (copied from plugin-vault)
- `src/pages/template-workspace.tsx`
- Tests: `test/editor-helpers.test.ts`, `test/workspace-helpers.test.ts`, `test/draft.test.ts`, `test/code-editor.test.tsx`, `test/editor-stand-in.tsx`, `test/lazy-editor.test.ts`, `test/content-tab.test.tsx`, `test/locale-rail.test.tsx`, `test/variables-tab.test.tsx`, `test/settings-tab.test.tsx`, `test/review-changes.test.tsx`, `test/template-workspace.test.tsx`

Modified: `src/format.ts` (shared patterns), `src/pages/template-create.tsx` (uses them), `src/wire.ts` (write intents), `src/components/herald-header.tsx` (`meta` slot), `src/index.tsx` (lazy route), `test/setup.ts` (Range polyfill), `test/herald-header.test.tsx`, `test/plugin.test.tsx`, `test/routes.test.tsx`, `package.json`, `pnpm-lock.yaml`, and `BASELINE.md` (a dated Herald section appended, nothing else touched).

---

### Task 1: Pure helpers for actions, positions, resolution, fields and sample data

Everything the editor and the workspace decide that doesn't need a browser editor. No CodeMirror import anywhere in this task, so pages can import these statically.

**Files:**
- Create: `packages/plugin-herald/src/editor/actions.ts`, `src/editor/positions.ts`, `src/workspace/resolve.ts`, `src/workspace/fields.ts`, `src/workspace/sample-data.ts`
- Modify: `src/format.ts` (append the shared patterns), `src/pages/template-create.tsx` (import them)
- Test: `test/editor-helpers.test.ts`, `test/workspace-helpers.test.ts`

**Interfaces:**
- Produces:
  - `findActions(text: string): ActionRange[]` with `ActionRange { from: number; to: number; closed: boolean }`, sorted and non-overlapping.
  - `inAction(text: string, pos: number): boolean`
  - `offsetOf(text: string, line: number, column: number): number`
  - `diagnosticRange(text: string, line: number, column: number): { from: number; to: number }`
  - `VersionState { id: string; locale: string; active: boolean }`, `LocaleStep { try: string; match: ResolveMatch; found: boolean; versionId?: string }`
  - `explainLocale(versions: VersionState[], locale: string): { steps: LocaleStep[]; versionId: string | null }`
  - `withActive(versions, id, active)`, `without(versions, id)`, `versionName(locale): string`, `answerText(versions, locale): string`
  - `Answers = { kind: "fallback" } | { kind: "locale"; locale: string; wildcard: string | null } | null`, `answersFor(version: VersionState): Answers`
  - `FIELD_LABEL: Record<TemplateField, string>`, `ALL_FIELDS`, `fieldsFor(channel): { primary: TemplateField[]; other: TemplateField[] }`, `SINGLE_LINE: ReadonlySet<TemplateField>`, `FIELD_LANGUAGE: Record<TemplateField, "html" | "text">`
  - `placeholderFor(v: VariableWire): string | number | boolean`, `sampleDataFor(vars): Record<string, unknown>`, `sampleTextFor(vars): string`, `SampleParse`, `parseSample(text): SampleParse`
  - `SLUG_PATTERN`, `LOCALE_PATTERN`, `VARIABLE_PATTERN` in `src/format.ts`

- [ ] **Step 1: Write the failing tests**

`packages/plugin-herald/test/editor-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { findActions, inAction } from "../src/editor/actions"
import { diagnosticRange, offsetOf } from "../src/editor/positions"

const actionsIn = (text: string) => findActions(text).map((a) => text.slice(a.from, a.to))

describe("findActions", () => {
  it("finds each action from {{ to its }}", () => {
    expect(actionsIn("Hi {{.name}}, {{ upper .x }}!")).toEqual(["{{.name}}", "{{ upper .x }}"])
  })

  it("keeps trim markers inside the action", () => {
    expect(actionsIn("a {{- .x -}} b")).toEqual(["{{- .x -}}"])
  })

  it("doesn't end an action at a }} inside a string, a raw string or a comment", () => {
    expect(actionsIn('{{ printf "}}" .x }} tail')).toEqual(['{{ printf "}}" .x }}'])
    expect(actionsIn("{{ printf `}}` }} tail")).toEqual(["{{ printf `}}` }}"])
    expect(actionsIn("{{/* }} */}} tail")).toEqual(["{{/* }} */}}"])
    expect(actionsIn('{{ printf "a\\"}}" }}')).toEqual(['{{ printf "a\\"}}" }}'])
  })

  it("runs an unclosed action to the end of the text", () => {
    const text = "Hi {{ .name"
    expect(findActions(text)).toEqual([{ from: 3, to: text.length, closed: false }])
  })

  it("finds nothing in text without actions", () => {
    expect(findActions("Hello { not } an action")).toEqual([])
  })
})

describe("inAction", () => {
  it("is true between {{ and }} and false outside", () => {
    const text = "Hi {{ .na }} there"
    expect(inAction(text, 0)).toBe(false)
    expect(inAction(text, 3)).toBe(false)
    expect(inAction(text, 5)).toBe(true)
    expect(inAction(text, 9)).toBe(true)
    expect(inAction(text, text.length)).toBe(false)
  })

  it("is true at the end of an unclosed action", () => {
    const text = "Hi {{ .cu"
    expect(inAction(text, text.length)).toBe(true)
  })
})

describe("offsetOf", () => {
  it("counts a 1-based line and column into a document offset", () => {
    expect(offsetOf("ab\nhello world", 2, 7)).toBe(9)
    expect(offsetOf("ab\nhello world", 1, 1)).toBe(0)
  })

  it("counts columns in characters, so an emoji before the column is one column but two units", () => {
    // "👋" is 2 UTF-16 units. Column 6 is the "." after "👋 {{ ".
    expect(offsetOf("👋 {{ .x }}", 1, 6)).toBe(6)
  })

  it("clamps a line past the end to the last line, and a column past the end to the line's end", () => {
    expect(offsetOf("one\ntwo", 9, 1)).toBe(4)
    expect(offsetOf("abc", 1, 10)).toBe(3)
  })
})

describe("diagnosticRange", () => {
  it("underlines the token at the column", () => {
    const text = "ab\nhello world"
    const r = diagnosticRange(text, 2, 7)
    expect(text.slice(r.from, r.to)).toBe("world")
  })

  it("lands on the right character after a non-ASCII one", () => {
    const text = "line one\né {{ nosuch }}"
    // é is column 1, so "nosuch" starts at column 6 on line 2.
    const r = diagnosticRange(text, 2, 6)
    expect(text.slice(r.from, r.to)).toBe("nosuch")
  })

  it("lands on the right character after an emoji", () => {
    const text = "👋 {{ .x }}"
    const r = diagnosticRange(text, 1, 6)
    expect(text.slice(r.from, r.to)).toBe(".x")
  })

  it("marks the whole line when there is no column, as for a parse error", () => {
    const text = "a\nbad {{ line\nc"
    const r = diagnosticRange(text, 2, 0)
    expect(text.slice(r.from, r.to)).toBe("bad {{ line")
  })

  it("marks one character when no token starts at the column", () => {
    const text = "x {{ }}"
    const r = diagnosticRange(text, 1, 3)
    expect(text.slice(r.from, r.to)).toBe("{")
  })

  it("marks the character before the end when the column is past the line", () => {
    const text = "abc"
    const r = diagnosticRange(text, 1, 10)
    expect(text.slice(r.from, r.to)).toBe("c")
  })
})
```

`packages/plugin-herald/test/workspace-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { LOCALE_PATTERN, SLUG_PATTERN, VARIABLE_PATTERN } from "../src/format"
import { FIELD_LABEL, SINGLE_LINE, fieldsFor } from "../src/workspace/fields"
import { answerText, answersFor, explainLocale, versionName, withActive, without } from "../src/workspace/resolve"
import type { VersionState } from "../src/workspace/resolve"
import { parseSample, placeholderFor, sampleDataFor, sampleTextFor } from "../src/workspace/sample-data"

const V: VersionState[] = [
  { id: "v-fallback", locale: "", active: true },
  { id: "v-en", locale: "en", active: true },
  { id: "v-fr", locale: "fr", active: false },
  { id: "v-ptbr", locale: "pt-BR", active: true },
]

describe("explainLocale mirrors Herald's template.Explain", () => {
  it("answers an exact live locale on the first step", () => {
    expect(explainLocale(V, "en")).toEqual({ steps: [{ try: "en", match: "exact", found: true, versionId: "v-en" }], versionId: "v-en" })
  })

  it("tries the language, then the fallback, and skips an inactive version", () => {
    expect(explainLocale(V, "fr-CA")).toEqual({
      steps: [
        { try: "fr-CA", match: "exact", found: false },
        { try: "fr", match: "language", found: false },
        { try: "", match: "default", found: true, versionId: "v-fallback" },
      ],
      versionId: "v-fallback",
    })
  })

  it("answers en-GB with en through the language step", () => {
    expect(explainLocale(V, "en-GB").versionId).toBe("v-en")
    expect(explainLocale(V, "en-GB").steps.map((s) => s.match)).toEqual(["exact", "language"])
  })

  it("fails when nothing live answers", () => {
    const none = withActive(V, "v-fallback", false)
    expect(explainLocale(none, "de")).toEqual({
      steps: [
        { try: "de", match: "exact", found: false },
        { try: "", match: "default", found: false },
      ],
      versionId: null,
    })
  })

  it("tries only the fallback itself for the empty locale", () => {
    expect(explainLocale(V, "").steps).toEqual([{ try: "", match: "exact", found: true, versionId: "v-fallback" }])
  })
})

describe("answerText and versionName", () => {
  it("names the version a locale would get, in words", () => {
    expect(versionName("")).toBe("the fallback version")
    expect(versionName("en")).toBe("the en version")
    expect(answerText(V, "en")).toBe("the en version")
    expect(answerText(withActive(V, "v-en", false), "en")).toBe("the fallback version")
    expect(answerText(without(without(V, "v-en"), "v-fallback"), "en")).toBe("nothing, so a send in that locale fails")
  })
})

describe("answersFor", () => {
  it("says what each live version answers and nothing for an inactive one", () => {
    expect(answersFor(V[0])).toEqual({ kind: "fallback" })
    expect(answersFor(V[1])).toEqual({ kind: "locale", locale: "en", wildcard: "en-*" })
    expect(answersFor(V[2])).toBeNull()
    expect(answersFor(V[3])).toEqual({ kind: "locale", locale: "pt-BR", wildcard: null })
  })
})

describe("fieldsFor", () => {
  it("orders each channel's fields the way they're read, and folds the rest", () => {
    expect(fieldsFor("email")).toEqual({ primary: ["subject", "html", "text"], other: ["title"] })
    expect(fieldsFor("sms")).toEqual({ primary: ["text"], other: ["subject", "html", "title"] })
    expect(fieldsFor("push")).toEqual({ primary: ["title", "text"], other: ["subject", "html"] })
    expect(fieldsFor("inapp")).toEqual({ primary: ["title", "text"], other: ["subject", "html"] })
    expect(fieldsFor("webhook")).toEqual({ primary: ["subject", "text"], other: ["html", "title"] })
    expect(fieldsFor("chat")).toEqual({ primary: ["subject", "text"], other: ["html", "title"] })
  })

  it("shows every field for a channel it doesn't know", () => {
    expect(fieldsFor("pager")).toEqual({ primary: ["subject", "html", "text", "title"], other: [] })
  })

  it("labels fields and keeps subject and title on one line", () => {
    expect(FIELD_LABEL.html).toBe("HTML")
    expect([...SINGLE_LINE].sort()).toEqual(["subject", "title"])
  })
})

describe("sample data", () => {
  it("prefills from each variable's default, else a placeholder for its type", () => {
    expect(placeholderFor({ name: "expires_in", type: "string", required: false, default: "1 hour" })).toBe("1 hour")
    expect(placeholderFor({ name: "customer_name", type: "string", required: true })).toBe("example customer name")
    expect(placeholderFor({ name: "invoice_url", type: "url", required: false })).toBe("https://example.com/")
    expect(placeholderFor({ name: "count", type: "number", required: false })).toBe(1)
    expect(placeholderFor({ name: "vip", type: "boolean", required: false })).toBe(true)
  })

  it("builds an object and its pretty JSON, skipping unnamed rows", () => {
    const vars = [
      { name: "customer_name", type: "string", required: true },
      { name: " ", type: "string", required: false },
    ]
    expect(sampleDataFor(vars)).toEqual({ customer_name: "example customer name" })
    expect(sampleTextFor(vars)).toBe('{\n  "customer_name": "example customer name"\n}')
  })

  it("parses an object, treats empty text as no data, and refuses anything else", () => {
    expect(parseSample('{"a": 1}')).toEqual({ ok: true, data: { a: 1 } })
    expect(parseSample("  ")).toEqual({ ok: true, data: {} })
    expect(parseSample("[1]")).toEqual({ ok: false, message: 'Sample data must be a JSON object, like {"name": "Ada"}.' })
    expect(parseSample("null")).toEqual({ ok: false, message: 'Sample data must be a JSON object, like {"name": "Ada"}.' })
    const bad = parseSample("{nope")
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toMatch(/^Not valid JSON: /)
  })
})

describe("shared patterns match Herald's handlers_templates.go", () => {
  it("accepts and refuses what the server does", () => {
    expect(SLUG_PATTERN.test("billing.receipt")).toBe(true)
    expect(SLUG_PATTERN.test("Billing")).toBe(false)
    expect(LOCALE_PATTERN.test("pt-BR")).toBe(true)
    expect(LOCALE_PATTERN.test("e")).toBe(false)
    expect(VARIABLE_PATTERN.test("customer_name")).toBe(true)
    expect(VARIABLE_PATTERN.test("1st")).toBe(false)
    expect(VARIABLE_PATTERN.test("a".repeat(65))).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/plugin-herald && npx vitest run test/editor-helpers.test.ts test/workspace-helpers.test.ts`
Expected: FAIL, the modules don't exist yet.

- [ ] **Step 3: Write the helpers**

`packages/plugin-herald/src/editor/actions.ts`:

```ts
/**
 * Where Go template actions sit in a field's source.
 *
 * An action runs from "{{" to the next "}}" that isn't inside a quoted string,
 * a raw string or a comment. The editor tints each one so an action reads as
 * code inside prose or markup, and completion offers variables and functions
 * only inside one. Nothing here touches CodeMirror, so pages and tests import
 * it without pulling the editor into the entry chunk.
 */
export interface ActionRange {
  from: number
  /** Exclusive. The end of the text when the action never closes. */
  to: number
  closed: boolean
}

/** Past a quoted string starting at `start`. Go strings can't span lines, so an unterminated one ends at the line. */
function skipQuoted(text: string, start: number, quote: string): number {
  let j = start + 1
  while (j < text.length) {
    const c = text[j]
    if (c === "\\") {
      j += 2
      continue
    }
    if (c === quote) return j + 1
    if (c === "\n") return j
    j++
  }
  return text.length
}

export function findActions(text: string): ActionRange[] {
  const out: ActionRange[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf("{{", i)
    if (open === -1) break
    let j = open + 2
    let closed = false
    while (j < text.length) {
      const c = text[j]
      if (c === '"' || c === "'") {
        j = skipQuoted(text, j, c)
        continue
      }
      if (c === "`") {
        const end = text.indexOf("`", j + 1)
        j = end === -1 ? text.length : end + 1
        continue
      }
      if (c === "/" && text[j + 1] === "*") {
        const end = text.indexOf("*/", j + 2)
        j = end === -1 ? text.length : end + 2
        continue
      }
      if (c === "}" && text[j + 1] === "}") {
        j += 2
        closed = true
        break
      }
      j++
    }
    out.push({ from: open, to: closed ? j : text.length, closed })
    i = closed ? j : text.length
  }
  return out
}

/** Whether `pos` is inside an action's body: after its "{{", and before its "}}" when it has one. */
export function inAction(text: string, pos: number): boolean {
  return findActions(text).some((a) => pos >= a.from + 2 && (a.closed ? pos <= a.to - 2 : pos <= a.to))
}
```

`packages/plugin-herald/src/editor/positions.ts`:

```ts
/**
 * Where a server diagnostic points, in the editor's terms.
 *
 * Herald reports a 1-based line and a 1-based column counted in characters
 * (Unicode code points) on the field's own source, converting Go's byte
 * column first (template/diagnostics.go, charColumn). The editor counts UTF-16
 * units from the start of the document, so an emoji is one column to Herald
 * and two units here. Column 0 means Herald had none, which is how a parse
 * error arrives. No CodeMirror import: the page and tests use this directly.
 */
interface Line {
  start: number
  text: string
}

function lineOf(text: string, line: number): Line {
  const lines = text.split("\n")
  const index = Math.min(Math.max(line, 1), lines.length) - 1
  let start = 0
  for (let i = 0; i < index; i++) start += lines[i].length + 1
  return { start, text: lines[index] }
}

/** The document offset of a 1-based line and character column. Column 0 or 1 is the line's start; past the end clamps to it. */
export function offsetOf(text: string, line: number, column: number): number {
  const l = lineOf(text, line)
  if (column <= 1) return l.start
  let units = 0
  let chars = 1
  for (const ch of l.text) {
    if (chars === column) break
    units += ch.length
    chars++
  }
  return l.start + units
}

const TOKEN = /^[A-Za-z0-9_.$]+/

/**
 * What a diagnostic underlines: the token starting at its column, one
 * character when no token starts there, the character before the end when
 * the column is past the line, or the whole line when it has no column.
 */
export function diagnosticRange(text: string, line: number, column: number): { from: number; to: number } {
  const l = lineOf(text, line)
  if (column <= 0) return { from: l.start, to: l.start + l.text.length }
  const at = offsetOf(text, line, column)
  const rest = l.text.slice(at - l.start)
  const token = TOKEN.exec(rest)
  if (token) return { from: at, to: at + token[0].length }
  const next = [...rest][0]
  if (next !== undefined) return { from: at, to: at + next.length }
  const before = [...l.text.slice(0, at - l.start)]
  const last = before[before.length - 1]
  return last === undefined ? { from: at, to: at } : { from: at - last.length, to: at }
}
```

`packages/plugin-herald/src/workspace/resolve.ts`:

```ts
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
export function explainLocale(versions: VersionState[], locale: string): { steps: LocaleStep[]; versionId: string | null } {
  const steps: LocaleStep[] = []
  const attempt = (want: string, match: ResolveMatch): string | null => {
    const v = versions.find((x) => x.active && x.locale === want)
    steps.push(v ? { try: want, match, found: true, versionId: v.id } : { try: want, match, found: false })
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

export function withActive<T extends VersionState>(versions: T[], id: string, active: boolean): T[] {
  return versions.map((v) => (v.id === id ? { ...v, active } : v))
}

export function without<T extends VersionState>(versions: T[], id: string): T[] {
  return versions.filter((v) => v.id !== id)
}

/** A version as people say it. "" is the fallback version. */
export function versionName(locale: string): string {
  return locale === "" ? "the fallback version" : `the ${locale} version`
}

/** What a request for `locale` gets among `versions`, in words. */
export function answerText(versions: VersionState[], locale: string): string {
  const { versionId } = explainLocale(versions, locale)
  const v = versionId === null ? undefined : versions.find((x) => x.id === versionId)
  return v ? versionName(v.locale) : "nothing, so a send in that locale fails"
}

export type Answers = { kind: "fallback" } | { kind: "locale"; locale: string; wildcard: string | null } | null

/** Which requested locales a live version answers. A bare language also answers its regions that have no live version of their own. */
export function answersFor(version: VersionState): Answers {
  if (!version.active) return null
  if (version.locale === "") return { kind: "fallback" }
  return { kind: "locale", locale: version.locale, wildcard: version.locale.includes("-") ? null : `${version.locale}-*` }
}
```

`packages/plugin-herald/src/workspace/fields.ts`:

```ts
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
```

`packages/plugin-herald/src/workspace/sample-data.ts`:

```ts
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

export type SampleParse = { ok: true; data: Record<string, unknown> } | { ok: false; message: string }

export function parseSample(text: string): SampleParse {
  if (text.trim() === "") return { ok: true, data: {} }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return { ok: false, message: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: 'Sample data must be a JSON object, like {"name": "Ada"}.' }
  }
  return { ok: true, data: value as Record<string, unknown> }
}
```

Append to `packages/plugin-herald/src/format.ts`:

```ts
/** Herald's own patterns (extension/contract/handlers_templates.go), so a refusal shows before the round trip. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
export const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
export const VARIABLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
```

In `packages/plugin-herald/src/pages/template-create.tsx`, replace the import `import { CATEGORIES } from "../format"` with `import { CATEGORIES, LOCALE_PATTERN as LOCALE, SLUG_PATTERN as SLUG } from "../format"`, and delete these three lines (the comment and the two constants):

```ts
/** The server's own patterns, so a refusal shows before the round trip. */
const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd packages/plugin-herald && npx vitest run test/editor-helpers.test.ts test/workspace-helpers.test.ts test/template-create.test.tsx`
Expected: PASS. `template-create.test.tsx` is in the run to prove the shared patterns changed nothing there.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/editor/actions.ts packages/plugin-herald/src/editor/positions.ts packages/plugin-herald/src/workspace/resolve.ts packages/plugin-herald/src/workspace/fields.ts packages/plugin-herald/src/workspace/sample-data.ts packages/plugin-herald/test/editor-helpers.test.ts packages/plugin-herald/test/workspace-helpers.test.ts
git commit --only -m "feat(plugin-herald): find template actions, place diagnostics, and mirror locale resolution for the workspace" -- packages/plugin-herald/src/editor/actions.ts packages/plugin-herald/src/editor/positions.ts packages/plugin-herald/src/workspace/resolve.ts packages/plugin-herald/src/workspace/fields.ts packages/plugin-herald/src/workspace/sample-data.ts packages/plugin-herald/src/format.ts packages/plugin-herald/src/pages/template-create.tsx packages/plugin-herald/test/editor-helpers.test.ts packages/plugin-herald/test/workspace-helpers.test.ts
git show --stat HEAD
```

---

### Task 2: Write-intent wire types and the draft model

The workspace edits a draft of the whole template and saves only what changed. This task adds the wire types for the template and version writes, and the pure functions that compare, patch and rebase a draft.

**Files:**
- Modify: `packages/plugin-herald/src/wire.ts` (append)
- Create: `src/workspace/draft.ts`
- Test: `test/draft.test.ts`

**Interfaces:**
- Consumes: `VARIABLE_PATTERN` (Task 1), `Content`, `TemplateDetail`, `TemplateField`, `VariableWire`, `VersionWire` from `wire.ts`.
- Produces:
  - Wire: `TemplatesUpdateRequest`, `TemplatesDeleteRequest`, `VersionsCreateRequest`, `VersionsUpdateRequest`, `VersionsDeleteRequest`, `VersionResponse`.
  - `Settings { name: string; category: string; enabled: boolean }`, `Draft { settings: Settings; variables: VariableWire[]; versions: Record<string, Content> }`
  - `Change = { kind: "field"; versionId: string; field: TemplateField } | { kind: "variables" } | { kind: "setting"; key: keyof Settings }`
  - `contentOf(v: Content): Content`, `draftOf(t: TemplateDetail): Draft`, `normaliseVariables(vars): VariableWire[]`, `sameVariables(a, b): boolean`
  - `changesBetween(saved: Draft, draft: Draft): Change[]`
  - `versionPatch(saved: Content, draft: Content): Partial<Content> | null`
  - `TemplatePatch = { name?: string; category?: string; enabled?: boolean; variables?: VariableWire[] }`, `templatePatch(saved: Draft, draft: Draft): TemplatePatch | null`
  - `rebase(prev: Draft, next: Draft, draft: Draft): Draft`
  - `variableProblems(vars: VariableWire[]): Map<number, string>`

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/draft.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { changesBetween, draftOf, normaliseVariables, rebase, sameVariables, templatePatch, variableProblems, versionPatch } from "../src/workspace/draft"
import type { Draft } from "../src/workspace/draft"
import { templateDetail } from "./data"

const FALLBACK = "htpv_01j00000000000000000000025"
const EN = "htpv_01j00000000000000000000026"

const base = (): Draft => draftOf(templateDetail())
const edit = (d: Draft, id: string, field: "subject" | "html" | "text" | "title", value: string): Draft => ({ ...d, versions: { ...d.versions, [id]: { ...d.versions[id], [field]: value } } })

describe("draftOf", () => {
  it("copies settings, variables and each version's content, keyed by version ID", () => {
    const d = base()
    expect(d.settings).toEqual({ name: "Receipt", category: "transactional", enabled: true })
    expect(d.variables.map((v) => v.name)).toEqual(["customer_name", "amount", "invoice_url"])
    expect(Object.keys(d.versions)).toEqual([FALLBACK, EN])
    expect(d.versions[EN]).toEqual({ subject: "Your {{.amount}} receipt", html: "<p>Thanks {{.customer_name}}</p>", text: "Thanks {{.customer_name}}", title: "" })
  })
})

describe("changesBetween", () => {
  it("finds nothing in an untouched draft", () => {
    expect(changesBetween(base(), base())).toEqual([])
  })

  it("names each changed field, the variables, and each changed setting", () => {
    const saved = base()
    let d = edit(saved, EN, "html", "<p>New</p>")
    d = { ...d, settings: { ...d.settings, name: "Receipts" }, variables: [...d.variables].reverse() }
    expect(changesBetween(saved, d)).toEqual([
      { kind: "field", versionId: EN, field: "html" },
      { kind: "variables" },
      { kind: "setting", key: "name" },
    ])
  })

  it("treats an absent default and an empty one as the same", () => {
    const saved = base()
    const d = { ...saved, variables: saved.variables.map((v) => ({ ...v, default: "", description: "" })) }
    expect(changesBetween(saved, d)).toEqual([])
    expect(sameVariables(saved.variables, d.variables)).toBe(true)
  })
})

describe("versionPatch", () => {
  it("sends only the fields that changed", () => {
    const saved = base()
    const d = edit(saved, EN, "text", "Hello")
    expect(versionPatch(saved.versions[EN], d.versions[EN])).toEqual({ text: "Hello" })
    expect(versionPatch(saved.versions[EN], saved.versions[EN])).toBeNull()
  })
})

describe("templatePatch", () => {
  it("sends changed settings, the name trimmed, and the whole variable list when it changed", () => {
    const saved = base()
    const d: Draft = { ...saved, settings: { ...saved.settings, name: "  Receipts ", enabled: false }, variables: saved.variables.slice(0, 1) }
    expect(templatePatch(saved, d)).toEqual({ name: "Receipts", enabled: false, variables: [{ name: "customer_name", type: "string", required: true, default: "", description: "" }] })
  })

  it("is null when nothing at template level changed", () => {
    const saved = base()
    expect(templatePatch(saved, edit(saved, EN, "html", "x"))).toBeNull()
  })
})

describe("rebase", () => {
  it("keeps every edit and takes the server's answer for everything not edited", () => {
    const prev = base()
    const draft = edit(prev, EN, "html", "<p>Mine</p>")
    // Someone else changed the fallback's text and the en subject.
    const next = edit(edit(prev, FALLBACK, "text", "Theirs"), EN, "subject", "Their subject")
    const out = rebase(prev, next, draft)
    expect(out.versions[EN].html).toBe("<p>Mine</p>")
    expect(out.versions[EN].subject).toBe("Their subject")
    expect(out.versions[FALLBACK].text).toBe("Theirs")
  })

  it("adds a version that's new on the server and drops one that's gone", () => {
    const prev = base()
    const next: Draft = { ...prev, versions: { [EN]: prev.versions[EN], v_new: { subject: "", html: "", text: "", title: "" } } }
    const out = rebase(prev, next, edit(prev, EN, "text", "Mine"))
    expect(Object.keys(out.versions).sort()).toEqual([EN, "v_new"].sort())
    expect(out.versions[EN].text).toBe("Mine")
  })

  it("keeps edited settings and variables and follows the server for the rest", () => {
    const prev = base()
    const draft: Draft = { ...prev, settings: { ...prev.settings, name: "Mine" } }
    const next: Draft = { ...prev, settings: { ...prev.settings, category: "marketing" }, variables: prev.variables.slice(1) }
    const out = rebase(prev, next, draft)
    expect(out.settings).toEqual({ name: "Mine", category: "marketing", enabled: true })
    expect(out.variables.map((v) => v.name)).toEqual(["amount", "invoice_url"])
  })
})

describe("variableProblems", () => {
  it("flags empty, malformed and duplicate names by row", () => {
    const problems = variableProblems([
      { name: "ok_name", type: "string", required: false },
      { name: "", type: "string", required: false },
      { name: "1st", type: "string", required: false },
      { name: "ok_name", type: "string", required: false },
    ])
    expect([...problems.entries()]).toEqual([
      [1, "A variable needs a name."],
      [2, "Use letters, digits and underscores, starting with a letter or an underscore."],
      [3, "ok_name is declared twice."],
    ])
  })
})

describe("normaliseVariables", () => {
  it("trims names and fills absent strings, the shape Save sends", () => {
    expect(normaliseVariables([{ name: " a ", type: "url", required: true }])).toEqual([{ name: "a", type: "url", required: true, default: "", description: "" }])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/draft.test.ts`
Expected: FAIL, `../src/workspace/draft` doesn't exist.

- [ ] **Step 3: Add the wire types and the draft model**

Append to `packages/plugin-herald/src/wire.ts`:

```ts
/** templates.update: pointers in Go, so an absent field is left alone. Slug and channel can't change. */
export interface TemplatesUpdateRequest {
  id: string
  name?: string
  category?: string
  enabled?: boolean
  variables?: VariableWire[]
}
export interface TemplatesDeleteRequest {
  id: string
}
/** versions.create. `active` defaults to true on the server, so the workspace always sends it. */
export interface VersionsCreateRequest {
  templateId: string
  locale: string
  subject: string
  html: string
  text: string
  title: string
  active?: boolean
}
/** versions.update: pointers, so only the changed fields travel. A version's locale can't change. */
export interface VersionsUpdateRequest {
  templateId: string
  versionId: string
  subject?: string
  html?: string
  text?: string
  title?: string
  active?: boolean
}
export interface VersionsDeleteRequest {
  templateId: string
  versionId: string
}
export interface VersionResponse {
  version: VersionWire
}
```

`packages/plugin-herald/src/workspace/draft.ts`:

```ts
import { VARIABLE_PATTERN } from "../format"
import type { Content, TemplateDetail, TemplateField, VariableWire } from "../wire"

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

export type Change = { kind: "field"; versionId: string; field: TemplateField } | { kind: "variables" } | { kind: "setting"; key: keyof Settings }

export type TemplatePatch = { name?: string; category?: string; enabled?: boolean; variables?: VariableWire[] }

const FIELDS: TemplateField[] = ["subject", "html", "text", "title"]

export const contentOf = (v: Content): Content => ({ subject: v.subject, html: v.html, text: v.text, title: v.title })

export function draftOf(t: TemplateDetail): Draft {
  return {
    settings: { name: t.name, category: t.category, enabled: t.enabled },
    variables: t.variables.map((v) => ({ ...v })),
    versions: Object.fromEntries(t.versions.map((v) => [v.id, contentOf(v)])),
  }
}

/** The shape Save sends: names trimmed, absent strings filled, so "" and absent compare equal. */
export function normaliseVariables(vars: VariableWire[]): VariableWire[] {
  return vars.map((v) => ({ name: v.name.trim(), type: v.type.trim(), required: v.required, default: v.default ?? "", description: v.description ?? "" }))
}

/** Compared as sent, so a reorder is a change and an edit put back isn't. */
export function sameVariables(a: VariableWire[], b: VariableWire[]): boolean {
  return JSON.stringify(normaliseVariables(a)) === JSON.stringify(normaliseVariables(b))
}

export function changesBetween(saved: Draft, draft: Draft): Change[] {
  const out: Change[] = []
  for (const [id, now] of Object.entries(draft.versions)) {
    const was = saved.versions[id]
    if (!was) continue
    for (const field of FIELDS) if (now[field] !== was[field]) out.push({ kind: "field", versionId: id, field })
  }
  if (!sameVariables(saved.variables, draft.variables)) out.push({ kind: "variables" })
  for (const key of ["name", "category", "enabled"] as const) if (draft.settings[key] !== saved.settings[key]) out.push({ kind: "setting", key })
  return out
}

export function versionPatch(saved: Content, draft: Content): Partial<Content> | null {
  const patch: Partial<Content> = {}
  for (const field of FIELDS) if (draft[field] !== saved[field]) patch[field] = draft[field]
  return Object.keys(patch).length === 0 ? null : patch
}

export function templatePatch(saved: Draft, draft: Draft): TemplatePatch | null {
  const patch: TemplatePatch = {}
  if (draft.settings.name !== saved.settings.name) patch.name = draft.settings.name.trim()
  if (draft.settings.category !== saved.settings.category) patch.category = draft.settings.category
  if (draft.settings.enabled !== saved.settings.enabled) patch.enabled = draft.settings.enabled
  if (!sameVariables(saved.variables, draft.variables)) patch.variables = normaliseVariables(draft.variables)
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
  const pick = <K extends keyof Settings>(key: K): Settings[K] => (draft.settings[key] === prev.settings[key] ? next.settings[key] : draft.settings[key])
  const versions: Record<string, Content> = {}
  for (const [id, theirs] of Object.entries(next.versions)) {
    const mine = draft.versions[id]
    const was = prev.versions[id]
    if (!mine || !was) {
      versions[id] = theirs
      continue
    }
    const merged = { ...mine }
    for (const field of FIELDS) if (mine[field] === was[field]) merged[field] = theirs[field]
    versions[id] = merged
  }
  return {
    settings: { name: pick("name"), category: pick("category"), enabled: pick("enabled") },
    variables: sameVariables(draft.variables, prev.variables) ? next.variables : draft.variables,
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
    else if (!VARIABLE_PATTERN.test(name)) out.set(i, "Use letters, digits and underscores, starting with a letter or an underscore.")
    else if (seen.has(name)) out.set(i, `${name} is declared twice.`)
    else seen.add(name)
  })
  return out
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/draft.ts packages/plugin-herald/test/draft.test.ts
git commit --only -m "feat(plugin-herald): model a template draft that saves only what changed and survives refetches" -- packages/plugin-herald/src/wire.ts packages/plugin-herald/src/workspace/draft.ts packages/plugin-herald/test/draft.test.ts
git show --stat HEAD
```

---
### Task 3: The CodeMirror editor, the field diff, and the lazy boundary

The only two files that may name `@codemirror`, the wrapper that reaches them through `lazy()`, and the tests that pin both the editor's behaviour (in a real editor under jsdom) and the boundary.

**Files:**
- Modify: `packages/plugin-herald/package.json` (a `dependencies` block), `pnpm-lock.yaml` (by `pnpm install`), `test/setup.ts` (Range polyfill)
- Create: `src/components/editor/types.ts`, `src/components/editor/code-editor.tsx`, `src/components/editor/field-diff.tsx`, `src/components/editor/lazy.tsx`
- Test: `test/code-editor.test.tsx`, `test/lazy-editor.test.ts`, and the shared stand-in later tasks mock the editor with: `test/editor-stand-in.tsx`

**Interfaces:**
- Consumes: `findActions`, `inAction` (Task 1, `src/editor/actions.ts`), `diagnosticRange`, `offsetOf` (Task 1, `src/editor/positions.ts`).
- Produces:
  - `src/components/editor/types.ts`: `EditorLanguage = "html" | "text" | "json"`, `EditorDiagnostic { line: number; column: number; severity: "error" | "warning"; message: string }`, `FocusRequest { line: number; column: number; seq: number }`, `CodeEditorProps { label: string; initial: string; language: EditorLanguage; singleLine?: boolean; diagnostics?: EditorDiagnostic[]; variables?: string[]; funcs?: string[]; focus?: FocusRequest; onChange: (text: string) => void }`, `FieldDiffProps { was: string; now: string; label: string; language: EditorLanguage }`
  - `src/components/editor/lazy.tsx`: `CodeEditor(props: CodeEditorProps)` and `FieldDiff(props: FieldDiffProps)`, each a `Suspense` around a `lazy()` chunk. **Every other file imports these two, never the chunks.**
  - `src/components/editor/code-editor.tsx`: default export the editor; named exports `templateActions` (the decoration `ViewPlugin`), `actionCompletions(variables: () => string[], funcs: () => string[]): CompletionSource`, `lintDiagnostics(doc: string, items: EditorDiagnostic[])`.
  - `test/editor-stand-in.tsx`: `EditorStandIn` (a `<textarea>` with the editor's props; diagnostics land on `data-diagnostics` as JSON and a focus request on `data-focus` as `line:column:seq`) and `DiffStandIn` (a `<pre aria-label={label}>` holding `- was` and `+ now`).

`initial` is read once, when the editor mounts: after that the editor owns what's on screen. A caller starts it over by changing its `key`.

- [ ] **Step 1: Add the dependencies**

Check the lockfile is clean first: `git diff --stat -- pnpm-lock.yaml packages/plugin-herald/package.json` must print nothing. If it prints anything, stop and report NEEDS_CONTEXT.

In `packages/plugin-herald/package.json`, add this block after `"peerDependencies"`:

```json
  "dependencies": {
    "@codemirror/autocomplete": "^6.20.3",
    "@codemirror/commands": "^6.11.1",
    "@codemirror/lang-html": "^6.4.12",
    "@codemirror/lang-json": "^6.0.2",
    "@codemirror/language": "^6.12.4",
    "@codemirror/lint": "^6.9.7",
    "@codemirror/merge": "^6.12.2",
    "@codemirror/search": "^6.7.2",
    "@codemirror/state": "^6.7.6",
    "@codemirror/view": "^6.43.13"
  },
```

Run: `cd /Users/rexraphael/Work/xraph/forge-dashboard && pnpm install`
Expected: the lockfile gains the herald importer's ten entries and the new packages (`@codemirror/autocomplete`, `@codemirror/lang-html` and what it pulls in: `lang-css`, `lang-javascript`, `@lezer/html`, `@lezer/css`, `@lezer/javascript`). `git diff --stat -- pnpm-lock.yaml` shows only that.

Append to `packages/plugin-herald/test/setup.ts`:

```ts
// jsdom 25 has no layout, so Range has no geometry. CodeMirror measures a
// range when it scrolls a selection into view, which the workspace does when
// a problem is clicked. Empty geometry is what a hidden element reports.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
```

- [ ] **Step 2: Write the failing tests**

`packages/plugin-herald/test/editor-stand-in.tsx`:

```tsx
import type { CodeEditorProps, FieldDiffProps } from "../src/components/editor/types"

/**
 * The editor's props on a textarea, so workspace tests drive it with
 * fireEvent.change. What the real editor would draw lands on data attributes:
 * diagnostics as JSON, a focus request as line:column:seq. The real editor is
 * tested on its own in code-editor.test.tsx.
 */
export function EditorStandIn({ label, initial, onChange, diagnostics, focus, singleLine, language }: CodeEditorProps) {
  return (
    <textarea
      aria-label={label}
      defaultValue={initial}
      data-language={language}
      data-single-line={singleLine ? "true" : "false"}
      data-diagnostics={JSON.stringify(diagnostics ?? [])}
      data-focus={focus ? `${focus.line}:${focus.column}:${focus.seq}` : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export function DiffStandIn({ label, was, now }: FieldDiffProps) {
  return <pre aria-label={label}>{`- ${was}\n+ ${now}`}</pre>
}
```

`packages/plugin-herald/test/code-editor.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { CompletionContext } from "@codemirror/autocomplete"
import type { CompletionResult } from "@codemirror/autocomplete"
import { forEachDiagnostic } from "@codemirror/lint"
import CodeEditor, { actionCompletions, templateActions } from "../src/components/editor/code-editor"
import type { CodeEditorProps } from "../src/components/editor/types"

afterEach(cleanup)

function mount(props: Partial<CodeEditorProps> = {}) {
  const onChange = vi.fn()
  const all: CodeEditorProps = { label: "HTML (en)", initial: "<p>Hi</p>", language: "html", onChange, ...props }
  const utils = render(<CodeEditor {...all} />)
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement) as EditorView
  return { ...utils, view, onChange, props: all }
}

const marked = (view: EditorView) => {
  const out: string[] = []
  view.plugin(templateActions)!.decorations.between(0, view.state.doc.length, (from, to) => {
    out.push(view.state.doc.sliceString(from, to))
  })
  return out
}

const lintRanges = (view: EditorView) => {
  const out: { text: string; severity: string; message: string }[] = []
  forEachDiagnostic(view.state, (d, from, to) => out.push({ text: view.state.doc.sliceString(from, to), severity: d.severity, message: d.message }))
  return out
}

describe("CodeEditor", () => {
  it("names its editing area and reports every change", () => {
    const { view, onChange } = mount()
    expect(screen.getByLabelText("HTML (en)")).toBeTruthy()
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "<p>Bye</p>" } }))
    expect(onChange).toHaveBeenLastCalledWith("<p>Bye</p>")
  })

  it("tints every action and follows edits", () => {
    const { view } = mount({ initial: "Hi {{.name}} and {{ upper .x }}", language: "text" })
    expect(marked(view)).toEqual(["{{.name}}", "{{ upper .x }}"])
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " {{.y}}" } }))
    expect(marked(view)).toEqual(["{{.name}}", "{{ upper .x }}", "{{.y}}"])
  })

  it("underlines a server diagnostic at the character Herald named, after a non-ASCII one", () => {
    const { view, rerender, props } = mount({ initial: "line one\né {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} diagnostics={[{ line: 2, column: 6, severity: "error", message: 'function "nosuch" not defined' }]} />)
    expect(lintRanges(view)).toEqual([{ text: "nosuch", severity: "error", message: 'function "nosuch" not defined' }])
  })

  it("marks a parse error's whole line, since it has no column", () => {
    const { view, rerender, props } = mount({ initial: "fine\nbad {{ here\nfine", language: "text" })
    rerender(<CodeEditor {...props} diagnostics={[{ line: 2, column: 0, severity: "error", message: "unclosed action" }]} />)
    expect(lintRanges(view).map((d) => d.text)).toEqual(["bad {{ here"])
  })

  it("clears its marks when the diagnostics go away", () => {
    const { view, rerender, props } = mount({ initial: "a {{ x }}", language: "text", diagnostics: [{ line: 1, column: 6, severity: "warning", message: "x" }] })
    expect(lintRanges(view)).toHaveLength(1)
    rerender(<CodeEditor {...props} diagnostics={[]} />)
    expect(lintRanges(view)).toHaveLength(0)
  })

  it("moves the cursor to a requested position, counted in characters", () => {
    const { view, rerender, props } = mount({ initial: "line one\né {{ nosuch }}", language: "text" })
    rerender(<CodeEditor {...props} focus={{ line: 2, column: 6, seq: 1 }} />)
    // "line one\n" is 9 units; é, space, {, {, space are 5 more.
    expect(view.state.selection.main.head).toBe(14)
  })

  it("keeps a single-line field on one line", () => {
    const { view, onChange } = mount({ initial: "Your receipt", language: "text", singleLine: true, label: "Subject (en)" })
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\nsecond line" } }))
    expect(view.state.doc.toString()).toBe("Your receipt")
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe("actionCompletions", () => {
  const source = actionCompletions(
    () => ["customer_name", "amount"],
    () => ["upper", "lower"],
  )
  const complete = (doc: string, pos = doc.length, explicit = false) => source(new CompletionContext(EditorState.create({ doc }), pos, explicit)) as CompletionResult | null

  it("offers variables with their dot and function names inside an action", () => {
    const result = complete("Hi {{ .cu")
    expect(result?.from).toBe(6)
    expect(result?.options.map((o) => o.label)).toEqual([".customer_name", ".amount", "upper", "lower"])
  })

  it("offers nothing outside an action", () => {
    expect(complete("Hi .cu")).toBeNull()
  })

  it("offers everything on an explicit request inside an empty action", () => {
    const result = complete("{{  }}", 3, true)
    expect(result?.from).toBe(3)
    expect(result?.options).toHaveLength(4)
  })
})
```

`packages/plugin-herald/test/lazy-editor.test.ts`:

```ts
import { describe, expect, it } from "vitest"

/**
 * CodeMirror is heavy, so the shell's entry chunk must not hold it. Only two
 * files may name the editor packages, and every other file reaches them
 * through lazy() in components/editor/lazy.tsx. A static import of either from
 * anywhere the entry can reach would fold CodeMirror into the entry chunk and
 * every page test would still pass.
 *
 * Read through import.meta.glob, not node:fs: this package's tsconfig has no
 * Node types, so fs passes vitest and fails tsc.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })
const source = (mod: { default: string } | string) => (typeof mod === "string" ? mod : mod.default)
const files = Object.entries(modules).map(([path, mod]) => [path, source(mod)] as const)

const EDITORS = ["../src/components/editor/code-editor.tsx", "../src/components/editor/field-diff.tsx"]

describe("CodeMirror loads only on demand", () => {
  it("found the sources and both editor files", () => {
    expect(files.length).toBeGreaterThan(30)
    for (const path of EDITORS) expect(modules[path]).toBeDefined()
  })

  it("is named by no file except the editor and the diff", () => {
    expect(files.filter(([, text]) => text.includes("@codemirror")).map(([path]) => path).sort()).toEqual([...EDITORS].sort())
  })

  it("reaches the editor and the diff only through lazy() in components/editor/lazy.tsx", () => {
    const wrapper = source(modules["../src/components/editor/lazy.tsx"])
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/code-editor"\)\)/)
    expect(wrapper).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/field-diff"\)\)/)
    const staticImports = files.filter(([, text]) => /^import (?!type)[^\n]*["'][^"']*\/(code-editor|field-diff)["']/m.test(text)).map(([path]) => path)
    expect(staticImports).toEqual([])
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd packages/plugin-herald && npx vitest run test/code-editor.test.tsx test/lazy-editor.test.ts`
Expected: FAIL, the editor modules don't exist yet.

- [ ] **Step 4: Write the editor, the diff and the boundary**

`packages/plugin-herald/src/components/editor/types.ts`:

```ts
/*
 * The editor's props, in a module with no CodeMirror in it, so the lazy
 * wrapper, the workspace and the tests' stand-in can share them with a
 * type-only import.
 */
export type EditorLanguage = "html" | "text" | "json"

/** A server diagnostic for one field: Herald's 1-based line and character column, column 0 for none. */
export interface EditorDiagnostic {
  line: number
  column: number
  severity: "error" | "warning"
  message: string
}

/** Where to put the cursor. A new `seq` asks again for the same place. */
export interface FocusRequest {
  line: number
  column: number
  seq: number
}

export interface CodeEditorProps {
  /** Names the editing area for a screen reader, and for tests. */
  label: string
  /** Read once, at mount. Change the component's key to start over. */
  initial: string
  language: EditorLanguage
  /** Subject and title: no line numbers, and a typed or pasted newline is dropped. */
  singleLine?: boolean
  diagnostics?: EditorDiagnostic[]
  /** Declared variable names, offered as `.name` inside an action. */
  variables?: string[]
  /** Herald's template functions, from engine.info. */
  funcs?: string[]
  focus?: FocusRequest
  onChange: (text: string) => void
}

export interface FieldDiffProps {
  /** What's saved. Lines only here are drawn as removed. */
  was: string
  /** The draft. Lines only here are drawn as added. */
  now: string
  label: string
  language: EditorLanguage
}
```

`packages/plugin-herald/src/components/editor/code-editor.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { EditorState, RangeSetBuilder } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, keymap, lineNumbers } from "@codemirror/view"
import type { DecorationSet, ViewUpdate } from "@codemirror/view"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import type { CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete"
import { lintGutter, setDiagnostics } from "@codemirror/lint"
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import { findActions, inAction } from "../../editor/actions"
import { diagnosticRange, offsetOf } from "../../editor/positions"
import type { CodeEditorProps, EditorDiagnostic } from "./types"

const actionMark = Decoration.mark({ class: "cm-herald-action" })

function actionDecorations(doc: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const a of findActions(doc)) if (a.to > a.from) builder.add(a.from, a.to, actionMark)
  return builder.finish()
}

/** Tints every {{ … }} so an action reads as code inside prose or markup. Templates are small, so the whole document is scanned on each change. */
export const templateActions = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = actionDecorations(view.state.doc.toString())
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = actionDecorations(update.state.doc.toString())
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

/** Inside an action only: `.name` for each declared variable, and Herald's function names. */
export function actionCompletions(variables: () => string[], funcs: () => string[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!inAction(context.state.doc.toString(), context.pos)) return null
    const word = context.matchBefore(/\.?[A-Za-z_][A-Za-z0-9_]*|\./)
    if (!word && !context.explicit) return null
    return {
      from: word ? word.from : context.pos,
      options: [...variables().map((name) => ({ label: `.${name}`, type: "variable" })), ...funcs().map((name) => ({ label: name, type: "function" }))],
      validFor: /^\.?[A-Za-z0-9_]*$/,
    }
  }
}

export function lintDiagnostics(doc: string, items: EditorDiagnostic[]): LintDiagnostic[] {
  return items.map((d) => {
    const { from, to } = diagnosticRange(doc, d.line, d.column)
    return { from, to, severity: d.severity, message: d.message, source: "herald" }
  })
}

/** A typed or pasted newline is dropped. Text that already had lines keeps them. */
const oneLine = EditorState.transactionFilter.of((tr) => (tr.docChanged && tr.newDoc.lines > Math.max(1, tr.startState.doc.lines) ? [] : tr))

// The kit's tokens, so the editor follows light and dark with the shell. An
// action takes the info tint and nothing else; problems take destructive and
// warning. Never the success token: it's green.
const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
  ".cm-herald-action": { backgroundColor: "color-mix(in oklab, var(--info) 14%, transparent)", color: "var(--info)", borderRadius: "3px" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--destructive)", textUnderlineOffset: "3px" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--warning)", textUnderlineOffset: "3px" },
  ".cm-tooltip": { backgroundColor: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" },
})

const NONE: EditorDiagnostic[] = []
const NO_NAMES: string[] = []

/**
 * One template field, or the preview's sample data.
 *
 * Server diagnostics are pushed in, never computed here: Herald's renderer is
 * the only judge of a template. They're placed from Herald's 1-based line and
 * character column. Loaded lazily through ./lazy, so none of this is in the
 * shell's entry chunk.
 */
export default function CodeEditor({ label, initial, language, singleLine = false, diagnostics = NONE, variables = NO_NAMES, funcs = NO_NAMES, focus, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // The listeners live as long as the editor, so they read the latest props through a ref.
  const latest = useRef({ onChange, variables, funcs })
  useEffect(() => {
    latest.current = { onChange, variables, funcs }
  }, [onChange, variables, funcs])

  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      history(),
      syntaxHighlighting(defaultHighlightStyle),
      templateActions,
      highlightSelectionMatches(),
      autocompletion(),
      EditorState.languageData.of(() => [{ autocomplete: actionCompletions(() => latest.current.variables, () => latest.current.funcs) }]),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) latest.current.onChange(update.state.doc.toString())
      }),
      theme,
    ]
    if (singleLine) extensions.push(oneLine)
    else extensions.push(lineNumbers(), lintGutter(), search({ top: true }), EditorView.lineWrapping)
    if (language === "html") extensions.push(html())
    if (language === "json") extensions.push(json())
    const v = new EditorView({ parent: host.current, state: EditorState.create({ doc: initial, extensions }) })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
    // `initial` is read once by design: a new starting text means a new editor, through a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, language, singleLine])

  // Declared after the mount effect, so on the first render it runs once the view exists.
  useEffect(() => {
    const v = view.current
    if (v) v.dispatch(setDiagnostics(v.state, lintDiagnostics(v.state.doc.toString(), diagnostics)))
  }, [diagnostics])

  useEffect(() => {
    const v = view.current
    if (!v || !focus) return
    const at = offsetOf(v.state.doc.toString(), focus.line, focus.column)
    v.dispatch({ selection: { anchor: at }, scrollIntoView: true })
    v.focus()
  }, [focus])

  return <div ref={host} className={singleLine ? "rounded-md border px-1" : "max-h-[28rem] min-h-40 overflow-auto rounded-md border"} />
}
```

`packages/plugin-herald/src/components/editor/field-diff.tsx`:

```tsx
import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import type { Extension } from "@codemirror/state"
import { EditorView, lineNumbers } from "@codemirror/view"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { unifiedMergeView } from "@codemirror/merge"
import { html } from "@codemirror/lang-html"
import { json } from "@codemirror/lang-json"
import type { FieldDiffProps } from "./types"

const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
})

/**
 * What's saved against the draft, in one read-only view: removed lines,
 * added lines, and unchanged stretches folded away. Nothing here is accepted
 * or rejected; it's a comparison. Loaded lazily through ./lazy.
 */
export default function FieldDiff({ was, now, label, language }: FieldDiffProps) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const extensions: Extension[] = [
      lineNumbers(),
      syntaxHighlighting(defaultHighlightStyle),
      unifiedMergeView({ original: was, mergeControls: false, collapseUnchanged: { margin: 2, minSize: 4 } }),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": label }),
      theme,
    ]
    if (language === "html") extensions.push(html())
    if (language === "json") extensions.push(json())
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: now, extensions }) })
    return () => view.destroy()
  }, [was, now, label, language])
  return <div ref={host} className="max-h-80 overflow-auto rounded-md border" />
}
```

`packages/plugin-herald/src/components/editor/lazy.tsx`:

```tsx
import { Suspense, lazy } from "react"
import type { CodeEditorProps, FieldDiffProps } from "./types"

// The only way into CodeMirror: one chunk for the editor, one for the diff,
// fetched the first time a page draws them.
const CodeEditorChunk = lazy(() => import("./code-editor"))
const FieldDiffChunk = lazy(() => import("./field-diff"))

/** The editor, loaded on first use. Until its chunk arrives the text shows as it is, so nothing on the page waits on it or jumps. */
export function CodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<pre aria-busy="true" className="min-h-9 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">{props.initial}</pre>}>
      <CodeEditorChunk {...props} />
    </Suspense>
  )
}

export function FieldDiff(props: FieldDiffProps) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground" aria-busy="true">Loading the comparison…</p>}>
      <FieldDiffChunk {...props} />
    </Suspense>
  )
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd packages/plugin-herald && npx vitest run test/code-editor.test.tsx test/lazy-editor.test.ts`
Expected: PASS. If a jsdom geometry error appears ("getClientRects is not a function" or similar), the Range polyfill from Step 1 didn't load: check `vitest.config.ts` lists `./test/setup.ts` in `setupFiles`, and say what you found in the report.

- [ ] **Step 6: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/components/editor/types.ts packages/plugin-herald/src/components/editor/code-editor.tsx packages/plugin-herald/src/components/editor/field-diff.tsx packages/plugin-herald/src/components/editor/lazy.tsx packages/plugin-herald/test/code-editor.test.tsx packages/plugin-herald/test/lazy-editor.test.ts packages/plugin-herald/test/editor-stand-in.tsx
git commit --only -m "feat(plugin-herald): edit templates in a lazy CodeMirror editor that marks actions and server diagnostics" -- packages/plugin-herald/package.json pnpm-lock.yaml packages/plugin-herald/test/setup.ts packages/plugin-herald/src/components/editor/types.ts packages/plugin-herald/src/components/editor/code-editor.tsx packages/plugin-herald/src/components/editor/field-diff.tsx packages/plugin-herald/src/components/editor/lazy.tsx packages/plugin-herald/test/code-editor.test.tsx packages/plugin-herald/test/lazy-editor.test.ts packages/plugin-herald/test/editor-stand-in.tsx
git show --stat HEAD
```

---

### Task 4: The Content tab: field editors, Problems, and the live preview

The middle and right columns of the workspace for one version: the channel's fields as tabs, the fields it doesn't send folded away, a clickable Problems list, and the preview with its sample data. It owns no draft: the page passes the version's draft content and takes edits back.

**Files:**
- Create: `packages/plugin-herald/src/workspace/problems.tsx`, `src/workspace/content-tab.tsx`
- Test: `test/content-tab.test.tsx`

**Interfaces:**
- Consumes: `CodeEditor` (Task 3, from `../components/editor/lazy`), `EditorDiagnostic`, `FocusRequest` (Task 3 types), `FIELD_LABEL`, `ALL_FIELDS`, `FIELD_LANGUAGE`, `SINGLE_LINE`, `fieldsFor` (Task 1), `useRenderPreview`, `RenderedPreview` (2b-1, `src/components/preview/`), `plural`.
- Produces:
  - `ProblemsList({ diagnostics: Diagnostic[]; rendered: boolean; onSelect: (d: Diagnostic) => void })`
  - `ContentTabProps { templateId: string; channel: string; version: VersionWire; content: Content; onFieldChange: (field: TemplateField, text: string) => void; variables: VariableWire[]; variablesEdited: boolean; funcs: string[]; sampleText: string; sampleData: Record<string, unknown>; sampleError?: string; sampleKey: number; onSampleChange: (text: string) => void; onSampleRefill: () => void; from?: { email?: string; name?: string; phone?: string } }`
  - `ContentTab(props)`: renders two sibling sections, `aria-label="Editor"` and `aria-label="Preview"`, for the page's grid to place. The preview section carries `lg:col-span-2 xl:col-span-1`.
  - Editor labels are `${FIELD_LABEL[field]} (${locale})`, with `fallback` for the `""` version: `"HTML (en)"`, `"Subject (fallback)"`. The sample data editor's label is `"Sample data"`.

The render request is `{ templateId, content, data: sampleData }`, plus `variables` only when `variablesEdited`: without them Herald uses the stored variables, which is right when they haven't changed. `useRenderPreview` already debounces it (400 ms), keeps the last result marked stale, and drops late answers.

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/content-tab.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { ContentTab } from "../src/workspace/content-tab"
import type { ContentTabProps } from "../src/workspace/content-tab"
import type { PreviewResult } from "../src/wire"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

vi.mock("../src/components/editor/code-editor", async () => ({ default: (await import("./editor-stand-in")).EditorStandIn }))

afterEach(cleanup)

const detail = templateDetail()
const EN = detail.versions[1]
const CONTENT = { subject: EN.subject, html: EN.html, text: EN.text, title: EN.title }

const RESULT: PreviewResult = {
  fields: [
    { field: "subject", output: "Your 42 receipt", rendered: true },
    { field: "html", output: "<p>Thanks Ada</p>", rendered: true },
    { field: "text", output: "Thanks Ada", rendered: true },
    { field: "title", output: "", rendered: true },
  ],
  diagnostics: [],
}

type Answer = PreviewResult | ContractError | ((params: Record<string, unknown>) => PreviewResult | ContractError)

function setup(over: Partial<ContentTabProps> = {}, answer: Answer = RESULT) {
  const onFieldChange = vi.fn()
  const onSampleRefill = vi.fn()
  const { client, queried } = scriptedClient({ "templates.render": answer })
  const props: ContentTabProps = {
    templateId: detail.id,
    channel: "email",
    version: EN,
    content: CONTENT,
    onFieldChange,
    variables: detail.variables,
    variablesEdited: false,
    funcs: ["upper"],
    sampleText: '{"customer_name": "Ada"}',
    sampleData: { customer_name: "Ada" },
    sampleKey: 0,
    onSampleChange: vi.fn(),
    onSampleRefill,
    ...over,
  }
  render(
    <PluginProvider client={client}>
      <div>
        <ContentTab {...props} />
      </div>
    </PluginProvider>
  )
  const renders = () => queried.filter((q) => q.intent === "templates.render").map((q) => q.params)
  return { onFieldChange, onSampleRefill, renders }
}

const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent)

describe("ContentTab", () => {
  it("shows an email's fields in reading order and folds the one it doesn't send", async () => {
    setup()
    expect(await screen.findByLabelText("Subject (en)")).toBeTruthy()
    expect(tabNames()).toEqual(["Subject", "HTML", "Text"])
    expect(screen.queryByLabelText("Title (en)")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Show fields email doesn't send (Title)" }))
    expect(await screen.findByLabelText("Title (en)")).toBeTruthy()
  })

  it("shows an SMS's one field and folds the rest", async () => {
    setup({ channel: "sms" })
    expect(await screen.findByLabelText("Text (en)")).toBeTruthy()
    expect(tabNames()).toEqual(["Text"])
    expect(screen.getByRole("button", { name: "Show fields sms doesn't send (Subject, HTML, Title)" })).toBeTruthy()
  })

  it("names the fallback version's fields as fallback", async () => {
    setup({ version: detail.versions[0], content: { subject: "Your receipt", html: "", text: "", title: "" } })
    expect(await screen.findByLabelText("Subject (fallback)")).toBeTruthy()
  })

  it("keeps the subject on one line and the HTML as HTML", async () => {
    setup()
    expect((await screen.findByLabelText("Subject (en)")).getAttribute("data-single-line")).toBe("true")
    fireEvent.click(screen.getByRole("tab", { name: "HTML" }))
    const htmlEditor = await screen.findByLabelText("HTML (en)")
    expect(htmlEditor.getAttribute("data-language")).toBe("html")
    expect(htmlEditor.getAttribute("data-single-line")).toBe("false")
  })

  it("hands each edit to the draft", async () => {
    const { onFieldChange } = setup()
    fireEvent.change(await screen.findByLabelText("Subject (en)"), { target: { value: "New subject" } })
    expect(onFieldChange).toHaveBeenLastCalledWith("subject", "New subject")
  })

  it("renders the draft against the sample data, leaving the stored variables to the server", async () => {
    const { renders } = setup()
    await waitFor(() => expect(renders()).toHaveLength(1))
    expect(renders()[0]).toEqual({ templateId: detail.id, content: CONTENT, data: { customer_name: "Ada" } })
  })

  it("sends unsaved variables so the preview uses them straight away", async () => {
    const variables = [{ name: "customer_name", type: "string", required: true }]
    const { renders } = setup({ variables, variablesEdited: true })
    await waitFor(() => expect(renders()).toHaveLength(1))
    expect(renders()[0]).toEqual({ templateId: detail.id, content: CONTENT, data: { customer_name: "Ada" }, variables })
  })

  it("puts a field's problems on its own editor and lists every problem", async () => {
    setup({}, {
      ...RESULT,
      diagnostics: [
        { field: "html", line: 1, column: 4, severity: "error", kind: "exec", message: "boom" },
        { field: "", line: 0, column: 0, severity: "warning", kind: "unprovided", message: '"amount" has no sample value' },
      ],
    })
    const problems = await screen.findByRole("region", { name: "Problems" })
    expect(await within(problems).findByText("Problems (2)")).toBeTruthy()
    expect(within(problems).getByRole("button", { name: /HTML 1:4.*boom/ })).toBeTruthy()
    expect(within(problems).queryByRole("button", { name: /no sample value/ })).toBeNull()
    expect(within(problems).getByText(/"amount" has no sample value/)).toBeTruthy()
    expect(JSON.parse((await screen.findByLabelText("Subject (en)")).getAttribute("data-diagnostics")!)).toEqual([])
    fireEvent.click(screen.getByRole("tab", { name: /HTML/ }))
    expect(JSON.parse((await screen.findByLabelText("HTML (en)")).getAttribute("data-diagnostics")!)).toEqual([{ line: 1, column: 4, severity: "error", message: "boom" }])
  })

  it("opens a folded field and moves the cursor there when its problem is clicked", async () => {
    setup({}, { ...RESULT, diagnostics: [{ field: "title", line: 1, column: 2, severity: "error", kind: "parse", message: "bad title" }] })
    fireEvent.click(await screen.findByRole("button", { name: /bad title/ }))
    expect((await screen.findByLabelText("Title (en)")).getAttribute("data-focus")).toBe("1:2:1")
  })

  it("asks again for the same place when the same problem is clicked twice", async () => {
    setup({}, { ...RESULT, diagnostics: [{ field: "subject", line: 1, column: 3, severity: "warning", kind: "undeclared", message: ".x is used but not declared" }] })
    const problem = await screen.findByRole("button", { name: /not declared/ })
    fireEvent.click(problem)
    fireEvent.click(problem)
    expect((await screen.findByLabelText("Subject (en)")).getAttribute("data-focus")).toBe("1:3:2")
  })

  it("says nothing is wrong only after a render has answered", async () => {
    setup()
    const problems = await screen.findByRole("region", { name: "Problems" })
    expect(await within(problems).findByText("None in the last render.")).toBeTruthy()
  })

  it("says when the sample data doesn't parse, and offers to refill it", async () => {
    const { onSampleRefill } = setup({ sampleError: "Not valid JSON: Unexpected token" })
    expect(await screen.findByText("Not valid JSON: Unexpected token The preview uses the last sample data that parsed.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Refill from variables" }))
    expect(onSampleRefill).toHaveBeenCalled()
  })

  it("says when the preview didn't render", async () => {
    setup({}, new ContractError("BAD_REQUEST", "the template and its sample data are too large to preview"))
    expect(await screen.findByText("The preview didn't render")).toBeTruthy()
    expect(screen.getByText(/too large to preview/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/content-tab.test.tsx`
Expected: FAIL, `../src/workspace/content-tab` doesn't exist.

- [ ] **Step 3: Write the Problems list and the Content tab**

`packages/plugin-herald/src/workspace/problems.tsx`:

```tsx
import type { Diagnostic } from "../wire"
import { FIELD_LABEL } from "./fields"

function Problem({ d }: { d: Diagnostic }) {
  return (
    <span className={d.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
      <span aria-hidden="true">{d.severity === "error" ? "✕ " : "⚠ "}</span>
      <span className="sr-only">{d.severity === "error" ? "Error: " : "Warning: "}</span>
      {d.field !== "" && (
        <span className="font-mono text-xs">
          {FIELD_LABEL[d.field]}
          {d.line > 0 ? ` ${d.line}${d.column > 0 ? `:${d.column}` : ""}` : ""}{" "}
        </span>
      )}
      {d.message}
    </span>
  )
}

/**
 * Every problem in the last render. One with a field and a line is a button
 * that takes you there; a missing or unprovided variable belongs to no field
 * and is plain text.
 */
export function ProblemsList({ diagnostics, rendered, onSelect }: { diagnostics: Diagnostic[]; rendered: boolean; onSelect: (d: Diagnostic) => void }) {
  return (
    <section aria-label="Problems" className="flex flex-col gap-1.5">
      <p className="text-sm font-medium">{rendered ? `Problems (${diagnostics.length})` : "Problems"}</p>
      {!rendered ? (
        <p className="text-sm text-muted-foreground">Checked on the first render.</p>
      ) : diagnostics.length === 0 ? (
        <p className="text-sm text-muted-foreground">None in the last render.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {diagnostics.map((d, i) => (
            <li key={i}>
              {d.field !== "" && d.line > 0 ? (
                <button type="button" className="text-left hover:underline focus-visible:underline" onClick={() => onSelect(d)}>
                  <Problem d={d} />
                </button>
              ) : (
                <Problem d={d} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

`packages/plugin-herald/src/workspace/content-tab.tsx`:

```tsx
import { useMemo, useState } from "react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@forge-go/dashboard-kit/components/collapsible"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { CodeEditor } from "../components/editor/lazy"
import type { EditorDiagnostic, FocusRequest } from "../components/editor/types"
import { RenderedPreview } from "../components/preview/rendered-preview"
import { useRenderPreview } from "../components/preview/use-render-preview"
import type { Content, Diagnostic, TemplateField, TemplatesRenderRequest, VariableWire, VersionWire } from "../wire"
import { ALL_FIELDS, FIELD_LABEL, FIELD_LANGUAGE, SINGLE_LINE, fieldsFor } from "./fields"
import { ProblemsList } from "./problems"

export interface ContentTabProps {
  templateId: string
  channel: string
  /** The selected version as saved: its ID, locale and live switch. */
  version: VersionWire
  /** Its draft content. */
  content: Content
  onFieldChange: (field: TemplateField, text: string) => void
  /** The draft's variables. */
  variables: VariableWire[]
  /** Whether they differ from what's saved, so the render sends them. */
  variablesEdited: boolean
  funcs: string[]
  sampleText: string
  /** The last sample data that parsed. */
  sampleData: Record<string, unknown>
  sampleError?: string
  /** Bumped to start the sample data editor over. */
  sampleKey: number
  onSampleChange: (text: string) => void
  onSampleRefill: () => void
  from?: { email?: string; name?: string; phone?: string }
}

const NO_DIAGNOSTICS: Diagnostic[] = []

/** A field's problems in the editor's terms. A missing or unprovided variable has no field and no line, so it only goes in the list. */
function byField(diagnostics: Diagnostic[]): Record<TemplateField, EditorDiagnostic[]> {
  const out = Object.fromEntries(ALL_FIELDS.map((f) => [f, [] as EditorDiagnostic[]])) as Record<TemplateField, EditorDiagnostic[]>
  for (const d of diagnostics) {
    if (d.field === "" || d.line === 0) continue
    out[d.field].push({ line: d.line, column: d.column, severity: d.severity, message: d.message })
  }
  return out
}

export function ContentTab(props: ContentTabProps) {
  const { primary, other } = fieldsFor(props.channel)
  const [active, setActive] = useState<TemplateField>(primary[0])
  const [otherOpen, setOtherOpen] = useState(false)
  const [focus, setFocus] = useState<{ field: TemplateField; request: FocusRequest } | null>(null)

  const request: TemplatesRenderRequest = {
    templateId: props.templateId,
    content: props.content,
    data: props.sampleData,
    ...(props.variablesEdited ? { variables: props.variables } : {}),
  }
  const preview = useRenderPreview(request)
  const diagnostics = preview.result?.diagnostics ?? NO_DIAGNOSTICS
  // Keyed on the answer, so typing doesn't re-place the marks between renders.
  const marks = useMemo(() => byField(diagnostics), [diagnostics])
  const names = useMemo(() => props.variables.map((v) => v.name.trim()).filter((n) => n !== ""), [props.variables])
  const locale = props.version.locale === "" ? "fallback" : props.version.locale

  function select(d: Diagnostic) {
    if (d.field === "" || d.line === 0) return
    const field = d.field
    if (primary.includes(field)) setActive(field)
    else setOtherOpen(true)
    setFocus((prev) => ({ field, request: { line: d.line, column: d.column, seq: (prev?.request.seq ?? 0) + 1 } }))
  }

  const editor = (field: TemplateField) => (
    <CodeEditor
      key={`${props.version.id}:${field}`}
      label={`${FIELD_LABEL[field]} (${locale})`}
      initial={props.content[field]}
      language={FIELD_LANGUAGE[field]}
      singleLine={SINGLE_LINE.has(field)}
      diagnostics={marks[field]}
      variables={names}
      funcs={props.funcs}
      focus={focus?.field === field ? focus.request : undefined}
      onChange={(text) => props.onFieldChange(field, text)}
    />
  )

  return (
    <>
      <section aria-label="Editor" className="flex min-w-0 flex-col gap-4">
        <Tabs value={active} onValueChange={(value) => setActive(value as TemplateField)}>
          <TabsList>
            {primary.map((field) => (
              <TabsTrigger key={field} value={field}>
                {FIELD_LABEL[field]}
                {marks[field].length > 0 && <span className="sr-only">, has problems</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          {primary.map((field) => (
            <TabsContent key={field} value={field} className="mt-2">
              {editor(field)}
            </TabsContent>
          ))}
        </Tabs>
        {other.length > 0 && (
          <Collapsible open={otherOpen} onOpenChange={(open) => setOtherOpen(open)}>
            <CollapsibleTrigger className="text-left text-sm text-muted-foreground hover:underline focus-visible:underline">
              {`${otherOpen ? "Hide" : "Show"} fields ${props.channel} doesn't send (${other.map((f) => FIELD_LABEL[f]).join(", ")})`}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-4">
              {other.map((field) => (
                <div key={field} className="flex flex-col gap-1.5">
                  <p className="text-sm font-medium">{FIELD_LABEL[field]}</p>
                  {editor(field)}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
        <ProblemsList diagnostics={diagnostics} rendered={preview.result !== undefined} onSelect={select} />
      </section>
      <section aria-label="Preview" className="flex min-w-0 flex-col gap-4 lg:col-span-2 xl:col-span-1">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Sample data</p>
            <Button type="button" size="xs" variant="ghost" onClick={props.onSampleRefill}>
              Refill from variables
            </Button>
          </div>
          <CodeEditor key={`sample:${props.sampleKey}`} label="Sample data" initial={props.sampleText} language="json" onChange={props.onSampleChange} />
          {/* Always mounted, text set later: a live region announces what changes inside it. */}
          <p role="status" className="text-xs text-destructive empty:sr-only">
            {props.sampleError ? `${props.sampleError} The preview uses the last sample data that parsed.` : ""}
          </p>
        </div>
        <CommandAlert error={preview.error} title="The preview didn't render" />
        <RenderedPreview channel={props.channel} result={preview.result} from={props.from} stale={preview.stale} />
      </section>
    </>
  )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/content-tab.test.tsx`
Expected: PASS. If `CollapsibleTrigger`'s accessible name doesn't match because Base UI renders it as something other than a button, keep the visible text exactly as written and adjust only the query, and say so in the report.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/problems.tsx packages/plugin-herald/src/workspace/content-tab.tsx packages/plugin-herald/test/content-tab.test.tsx
git commit --only -m "feat(plugin-herald): edit a version's fields beside a live preview and a list of problems that takes you to each one" -- packages/plugin-herald/src/workspace/problems.tsx packages/plugin-herald/src/workspace/content-tab.tsx packages/plugin-herald/test/content-tab.test.tsx
git show --stat HEAD
```

---

### Task 5: The locale rail and "Test a locale"

The left column. Each version with Live or Inactive and what it answers; a live switch, delete and "Add locale", each behind a dialog that says what will answer afterwards; and "Test a locale", which draws `templates.resolve`'s steps as the resolution ladder, the workspace's one bold element.

**Files:**
- Create: `packages/plugin-herald/src/workspace/locale-rail.tsx`
- Test: `test/locale-rail.test.tsx`

**Interfaces:**
- Consumes: `answerText`, `answersFor`, `versionName`, `withActive`, `without`, `Answers` (Task 1), `LOCALE_PATTERN` (Task 1), `VersionsCreateRequest`, `VersionResponse` (Task 2), `VersionBadge` (2b-1 `src/badges.tsx`), `useDebounced` (2b-1).
- Produces: `LocaleRailProps { template: TemplateDetail; selectedId: string; onSelect: (versionId: string) => void; dirtyIds: ReadonlySet<string>; copyFrom?: Content; copyName: string; onCreated: (version: VersionWire) => void }` and `LocaleRail(props)`, rendering `<aside aria-label="Locales">`.

The rail calls `versions.update` (only `active`), `versions.create` and `versions.delete`. Each invalidates `templates.detail`; the page keeps the rail mounted through that refetch (Task 9), and each dialog keeps its own snapshot of the version it names.

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/locale-rail.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import { LocaleRail } from "../src/workspace/locale-rail"
import type { LocaleRailProps } from "../src/workspace/locale-rail"
import type { TemplatesResolveResponse, VersionWire } from "../src/wire"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const FR: VersionWire = { id: "htpv_01j00000000000000000000027", locale: "fr", subject: "Votre reçu", html: "", text: "Bonjour", title: "", active: false, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" }
const base = templateDetail()
const detail = templateDetail({ versions: [...base.versions, FR] })
const [FALLBACK, EN] = detail.versions

function setup(over: Partial<LocaleRailProps> = {}, commands: Record<string, unknown> = {}, queries: Record<string, unknown> = {}) {
  const onSelect = vi.fn()
  const onCreated = vi.fn()
  const { client, sent, queried } = scriptedClient(
    { ...queries },
    { "versions.update": { version: EN }, "versions.delete": { ok: true, id: EN.id }, "versions.create": { version: { ...FR, id: "htpv_new", locale: "de" } }, ...commands },
  )
  render(
    <PluginProvider client={client}>
      <LocaleRail template={detail} selectedId={EN.id} onSelect={onSelect} dirtyIds={new Set()} copyFrom={{ subject: "S", html: "H", text: "T", title: "" }} copyName="the en version" onCreated={onCreated} {...over} />
    </PluginProvider>
  )
  return { onSelect, onCreated, sent, queried }
}

const rail = () => screen.getByRole("complementary", { name: "Locales" })
const dialog = () => screen.getByRole("alertdialog")

describe("LocaleRail", () => {
  it("lists each version with its state and what a live one answers", () => {
    setup()
    const items = within(rail()).getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText("Fallback")).toBeTruthy()
    expect(within(items[0]).getByText("Live").getAttribute("data-variant")).toBe("outline")
    expect(within(items[0]).getByText("Answers any locale no other live version takes")).toBeTruthy()
    expect(items[1].textContent).toContain("Answers en, and en-* without a live version of its own")
    expect(within(items[2]).getByText("Inactive").getAttribute("data-variant")).toBe("secondary")
    expect(items[2].textContent).not.toContain("Answers")
  })

  it("marks the selected version and selects another on click", () => {
    const { onSelect } = setup()
    expect(within(rail()).getByRole("button", { name: /^en/ }).getAttribute("aria-current")).toBe("true")
    fireEvent.click(within(rail()).getByRole("button", { name: /^fr/ }))
    expect(onSelect).toHaveBeenCalledWith(FR.id)
  })

  it("marks a version with unsaved edits", () => {
    setup({ dirtyIds: new Set([EN.id]) })
    expect(within(rail()).getByRole("button", { name: /^en/ }).textContent).toContain("edited")
  })

  it("says what will answer en before taking it offline, then sends only the switch", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: en version" }))
    expect(within(dialog()).getByText("Take en offline?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for en will then get the fallback version.")).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Take offline" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: detail.id, versionId: EN.id, active: false } }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("puts a version live without painting the confirm as destructive", () => {
    setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    expect(within(dialog()).getByText("Put fr live?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for fr will then get the fr version.")).toBeTruthy()
    expect(within(dialog()).getByRole("button", { name: "Put live" }).getAttribute("data-variant")).not.toBe("destructive")
  })

  it("says sends will fail before taking the fallback offline", () => {
    setup()
    fireEvent.click(screen.getByRole("switch", { name: "Live: fallback version" }))
    expect(within(dialog()).getByText("A send in a locale with no live version of its own will then fail.")).toBeTruthy()
  })

  it("names what answers after a delete and that unsaved edits go too", async () => {
    const { sent } = setup({ dirtyIds: new Set([EN.id]) })
    fireEvent.click(screen.getByRole("button", { name: "Delete en version" }))
    expect(within(dialog()).getByText("Delete the en version?")).toBeTruthy()
    expect(within(dialog()).getByText("A request for en will then get the fallback version. Its content is deleted and can't be brought back. Its unsaved edits go with it.")).toBeTruthy()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete version" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.delete", payload: { templateId: detail.id, versionId: EN.id } }]))
  })

  it("keeps the dialog open with the refusal when a delete fails", async () => {
    setup({}, { "versions.delete": new ContractError("NOT_FOUND", "template version not found") })
    fireEvent.click(screen.getByRole("button", { name: "Delete en version" }))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Delete version" }))
    expect(await within(dialog()).findByText("template version not found")).toBeTruthy()
  })

  it("adds an inactive locale from the selected version's content", async () => {
    const { sent, onCreated } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.create", payload: { templateId: detail.id, locale: "de", subject: "S", html: "H", text: "T", title: "", active: false } }]))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "htpv_new", locale: "de" })))
  })

  it("starts a new locale empty when asked to", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.click(within(form).getByRole("checkbox", { name: "Start from the en version's content" }))
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    await waitFor(() => expect(sent[0]?.payload).toEqual({ templateId: detail.id, locale: "de", subject: "", html: "", text: "", title: "", active: false }))
  })

  it("refuses a malformed or taken locale before the round trip", async () => {
    const { sent } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "e" } })
    expect(within(form).getByText("A locale is a tag like en or pt-BR.")).toBeTruthy()
    expect((within(form).getByRole("button", { name: "Add locale" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "fr" } })
    expect(within(form).getByText("This template already has a fr version.")).toBeTruthy()
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "" } })
    expect(within(form).getByText("This template already has a fallback version.")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("shows the server's refusal inside the add dialog", async () => {
    setup({}, { "versions.create": new ContractError("CONFLICT", "this template already has a version for that locale") })
    fireEvent.click(screen.getByRole("button", { name: "Add locale" }))
    const form = await screen.findByRole("dialog")
    fireEvent.change(within(form).getByLabelText("Locale"), { target: { value: "de" } })
    fireEvent.click(within(form).getByRole("button", { name: "Add locale" }))
    expect(await within(form).findByText("this template already has a version for that locale")).toBeTruthy()
  })
})

describe("Test a locale", () => {
  const FALLS_BACK: TemplatesResolveResponse = {
    locale: "fr-CA",
    steps: [
      { try: "fr-CA", match: "exact", found: false },
      { try: "fr", match: "language", found: false },
      { try: "", match: "default", found: true, versionId: FALLBACK.id },
    ],
    versionId: FALLBACK.id,
    match: "default",
  }

  it("asks the server 300ms after typing stops and draws each step", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { queried } = setup({}, {}, { "templates.resolve": FALLS_BACK })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "fr-CA" } })
    await act(async () => {
      vi.advanceTimersByTime(299)
    })
    expect(queried.filter((q) => q.intent === "templates.resolve")).toEqual([])
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    await waitFor(() => expect(queried.filter((q) => q.intent === "templates.resolve").map((q) => q.params)).toEqual([{ id: detail.id, locale: "fr-CA" }]))
    const ladder = await screen.findByRole("list", { name: "How fr-CA resolves" })
    const steps = within(ladder).getAllByRole("listitem")
    expect(steps.map((s) => s.textContent)).toEqual([
      "Tries fr-CANo live version.",
      "Tries fr (its language)No live version.",
      "Tries the fallbackA live version answers.",
      "Answered by the fallback version.",
    ])
  })

  it("ends in a failure when nothing answers", async () => {
    setup({}, {}, { "templates.resolve": { locale: "de", steps: [{ try: "de", match: "exact", found: false }, { try: "", match: "default", found: false }], versionId: null, match: "none" } })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "de" } })
    expect(await screen.findByText(/Nothing answers it, so a send in/)).toBeTruthy()
  })

  it("says a malformed locale is malformed and asks nothing", async () => {
    const { queried } = setup({}, {}, { "templates.resolve": FALLS_BACK })
    fireEvent.change(screen.getByLabelText("Test a locale"), { target: { value: "f" } })
    expect(await screen.findByText("A locale is a tag like en or pt-BR.")).toBeTruthy()
    expect(queried.filter((q) => q.intent === "templates.resolve")).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/locale-rail.test.tsx`
Expected: FAIL, `../src/workspace/locale-rail` doesn't exist.

- [ ] **Step 3: Write the rail**

`packages/plugin-herald/src/workspace/locale-rail.tsx`:

```tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { VersionBadge } from "../badges"
import { LOCALE_PATTERN } from "../format"
import { useDebounced } from "../use-debounced"
import type { Content, DeleteResponse, TemplateDetail, TemplatesResolveResponse, VersionResponse, VersionsCreateRequest, VersionWire } from "../wire"
import { answerText, answersFor, versionName, withActive, without } from "./resolve"
import type { Answers } from "./resolve"

export interface LocaleRailProps {
  /** The template as saved: versions with their live switches. */
  template: TemplateDetail
  selectedId: string
  onSelect: (versionId: string) => void
  /** Versions with unsaved edits. */
  dirtyIds: ReadonlySet<string>
  /** The selected version's draft content, offered as a new locale's starting text. */
  copyFrom?: Content
  /** How the selected version is said: "the en version". */
  copyName: string
  onCreated: (version: VersionWire) => void
}

/** How a version is named in a control's label: "en version", "fallback version". */
const labelOf = (v: VersionWire) => (v.locale === "" ? "fallback version" : `${v.locale} version`)

const NOWHERE = "A send in a locale with no live version of its own"

function toggleCopy(v: VersionWire, versions: VersionWire[]) {
  const goingLive = !v.active
  if (v.locale === "") {
    return goingLive
      ? { title: "Put the fallback version live?", description: `${NOWHERE} will then get the fallback version.`, confirmLabel: "Put live" }
      : { title: "Take the fallback version offline?", description: `${NOWHERE} will then fail.`, confirmLabel: "Take offline" }
  }
  const after = answerText(withActive(versions, v.id, goingLive), v.locale)
  return goingLive
    ? { title: `Put ${v.locale} live?`, description: `A request for ${v.locale} will then get ${after}.`, confirmLabel: "Put live" }
    : { title: `Take ${v.locale} offline?`, description: `A request for ${v.locale} will then get ${after}.`, confirmLabel: "Take offline" }
}

function deleteCopy(v: VersionWire, versions: VersionWire[], dirty: boolean) {
  const after = v.locale === "" ? `${NOWHERE} will then fail.` : `A request for ${v.locale} will then get ${answerText(without(versions, v.id), v.locale)}.`
  return {
    title: v.locale === "" ? "Delete the fallback version?" : `Delete the ${v.locale} version?`,
    description: `${after} Its content is deleted and can't be brought back.${dirty ? " Its unsaved edits go with it." : ""}`,
    confirmLabel: "Delete version",
  }
}

function AnswersLine({ answers }: { answers: NonNullable<Answers> }) {
  if (answers.kind === "fallback") return <>Answers any locale no other live version takes</>
  return (
    <>
      Answers <span className="font-mono">{answers.locale}</span>
      {answers.wildcard && (
        <>
          , and <span className="font-mono">{answers.wildcard}</span> without a live version of its own
        </>
      )}
    </>
  )
}

type Pending = { kind: "toggle" | "delete"; version: VersionWire; dirty: boolean }

export function LocaleRail({ template, selectedId, onSelect, dirtyIds, copyFrom, copyName, onCreated }: LocaleRailProps) {
  const update = useCommand<VersionResponse>("versions.update")
  const remove = useCommand<DeleteResponse>("versions.delete")
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addKey, setAddKey] = useState(0)
  const versions = template.versions
  const cmd = pending?.kind === "delete" ? remove : update

  function open(kind: Pending["kind"], version: VersionWire) {
    update.reset()
    remove.reset()
    // A snapshot: the dialog keeps naming this version while templates.detail refetches.
    setPending({ kind, version, dirty: dirtyIds.has(version.id) })
    setConfirming(true)
  }

  async function confirm() {
    if (!pending) return
    const v = pending.version
    const result = pending.kind === "toggle" ? await update.execute({ templateId: template.id, versionId: v.id, active: !v.active }) : await remove.execute({ templateId: template.id, versionId: v.id })
    if (result === undefined) return
    setConfirming(false)
  }

  const copy = pending === null ? { title: "", description: "", confirmLabel: "Confirm" } : pending.kind === "toggle" ? toggleCopy(pending.version, versions) : deleteCopy(pending.version, versions, pending.dirty)

  return (
    <aside aria-label="Locales" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Locales</p>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No versions yet. Add a locale to start writing.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions.map((v) => {
              const answers = answersFor(v)
              const selected = v.id === selectedId
              return (
                <li key={v.id} className={cn("flex flex-col gap-1.5 rounded-md px-2 py-1.5", selected && "bg-muted")}>
                  <button type="button" aria-current={selected ? "true" : undefined} onClick={() => onSelect(v.id)} className="flex items-center justify-between gap-2 text-left text-sm">
                    <span>
                      {v.locale === "" ? "Fallback" : <span className="font-mono text-xs">{v.locale}</span>}
                      {dirtyIds.has(v.id) && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
                    </span>
                    <VersionBadge active={v.active} />
                  </button>
                  {answers && (
                    <p className="text-xs text-muted-foreground">
                      <AnswersLine answers={answers} />
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Switch size="sm" aria-label={`Live: ${labelOf(v)}`} checked={v.active} onCheckedChange={() => open("toggle", v)} />
                    <Button type="button" size="xs" variant="ghost" aria-label={`Delete ${labelOf(v)}`} onClick={() => open("delete", v)}>
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          onClick={() => {
            setAddKey((k) => k + 1)
            setAdding(true)
          }}
        >
          Add locale
        </Button>
      </div>
      <LocaleTester templateId={template.id} versions={versions} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && cmd.loading) return
          setConfirming(next)
        }}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        destructive={pending?.kind === "delete" || (pending?.kind === "toggle" && pending.version.active)}
        pending={cmd.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={cmd.error} title={pending?.kind === "delete" ? "Could not delete the version" : "Could not change the version"} />
      </ConfirmDialog>
      <AddLocaleDialog
        key={addKey}
        open={adding}
        onOpenChange={setAdding}
        template={template}
        copyFrom={copyFrom}
        copyName={copyName}
        onCreated={(v) => {
          setAdding(false)
          onCreated(v)
        }}
      />
    </aside>
  )
}

function AddLocaleDialog({ open, onOpenChange, template, copyFrom, copyName, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; template: TemplateDetail; copyFrom?: Content; copyName: string; onCreated: (v: VersionWire) => void }) {
  const create = useCommand<VersionResponse>("versions.create")
  const [locale, setLocale] = useState("")
  const [copy, setCopy] = useState(true)
  const value = locale.trim()
  const bad = value !== "" && !LOCALE_PATTERN.test(value)
  const taken = template.versions.some((v) => v.locale === value)
  const hasFallback = template.versions.some((v) => v.locale === "")
  const canCreate = !create.loading && !bad && !taken

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canCreate) return
    const from = copy && copyFrom ? copyFrom : { subject: "", html: "", text: "", title: "" }
    const request: VersionsCreateRequest = { templateId: template.id, locale: value, subject: from.subject, html: from.html, text: from.text, title: from.title, active: false }
    const result = await create.execute(request)
    if (result === undefined) return
    onCreated(result.version)
  }

  const hint = bad ? "A locale is a tag like en or pt-BR." : taken ? (value === "" ? "This template already has a fallback version." : `This template already has a ${value} version.`) : hasFallback ? "A tag like fr or pt-BR." : "A tag like fr or pt-BR. Leave it empty to add the fallback version, which answers any locale without one."

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.loading) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a locale</DialogTitle>
            <DialogDescription>The new version starts inactive, so it answers nothing until you put it live.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-locale">Locale</Label>
            <Input
              id="new-locale"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
              value={locale}
              aria-invalid={bad || taken || undefined}
              onChange={(e) => {
                create.reset()
                setLocale(e.target.value)
              }}
            />
            <p className={bad || taken ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{hint}</p>
          </div>
          {copyFrom && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={copy} onCheckedChange={(checked) => setCopy(checked === true)} aria-label={`Start from ${copyName}'s content`} />
              <span aria-hidden="true">Start from {copyName}'s content</span>
            </label>
          )}
          <CommandAlert error={create.error} title="Could not add the locale" />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.loading} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {create.loading ? "Adding…" : "Add locale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The resolution ladder: the steps Herald takes for a locale, as a spine with
 * a node per attempt. Hollow where no live version answered, filled where one
 * did, destructive where nothing did and the send fails. It's the only place
 * locale fallback is visible, so it's the one bold element on the page.
 */
function Ladder({ answer, versions }: { answer: TemplatesResolveResponse; versions: VersionWire[] }) {
  const answered = answer.versionId === null ? undefined : versions.find((v) => v.id === answer.versionId)
  const node = "absolute top-1 -left-[1.4rem] size-2.5 rounded-full border-2"
  return (
    <ol aria-label={`How ${answer.locale} resolves`} className="ml-1.5 flex flex-col gap-3 border-l pl-4 text-xs">
      {answer.steps.map((s, i) => (
        <li key={i} className="relative">
          <span aria-hidden="true" className={cn(node, s.found ? "border-foreground bg-foreground" : "border-muted-foreground bg-background")} />
          <p>
            Tries {s.try === "" ? "the fallback" : <span className="font-mono">{s.try}</span>}
            {s.match === "language" && <span className="text-muted-foreground"> (its language)</span>}
          </p>
          <p className="text-muted-foreground">{s.found ? "A live version answers." : "No live version."}</p>
        </li>
      ))}
      <li className="relative font-medium">
        <span aria-hidden="true" className={cn(node, answered ? "border-foreground bg-foreground" : "border-destructive bg-destructive")} />
        {answered ? (
          <>Answered by {versionName(answered.locale)}.</>
        ) : (
          <span className="text-destructive">
            Nothing answers it, so a send in <span className="font-mono">{answer.locale}</span> fails.
          </span>
        )}
      </li>
    </ol>
  )
}

/** templates.resolve, 300ms after typing stops. The ladder names the answering version from the rail's own list. */
function LocaleTester({ templateId, versions }: { templateId: string; versions: VersionWire[] }) {
  const [typed, setTyped] = useState("")
  const locale = useDebounced(typed.trim(), 300)
  const valid = LOCALE_PATTERN.test(locale)
  const answer = useQuery<TemplatesResolveResponse>("templates.resolve", { id: templateId, locale }, { enabled: valid })
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="locale-test">Test a locale</Label>
      <Input id="locale-test" className="font-mono text-xs" placeholder="fr-CA" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
      {locale !== "" && !valid && <p className="text-xs text-destructive">A locale is a tag like en or pt-BR.</p>}
      {valid && answer.error && (
        <p className="text-xs text-destructive">
          {answer.error.code}: {answer.error.message}
        </p>
      )}
      {valid && answer.data && <Ladder answer={answer.data} versions={versions} />}
    </div>
  )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/locale-rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/locale-rail.tsx packages/plugin-herald/test/locale-rail.test.tsx
git commit --only -m "feat(plugin-herald): list a template's locales, say what answers each before it changes, and trace any locale's resolution" -- packages/plugin-herald/src/workspace/locale-rail.tsx packages/plugin-herald/test/locale-rail.test.tsx
git show --stat HEAD
```

---

### Task 6: The Variables tab

An editable table of the draft's variables: name, type, required, default, description, with add, remove and reorder. Edits go straight into the draft, so the preview picks them up at once (Task 4 sends them when they differ from what's saved). The header's Save writes them.

**Files:**
- Create: `packages/plugin-herald/src/workspace/variables-tab.tsx`
- Test: `test/variables-tab.test.tsx`

**Interfaces:**
- Consumes: `variableProblems` (Task 2), `plural`.
- Produces: `VariablesTab({ variables: VariableWire[]; onChange: (next: VariableWire[]) => void })`.

Herald doesn't check a variable's type; it only affects the sample data placeholder. So the type is a free text field with suggestions, not a fixed list.

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/variables-tab.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { VariablesTab } from "../src/workspace/variables-tab"
import type { VariableWire } from "../src/wire"

afterEach(cleanup)

const VARS: VariableWire[] = [
  { name: "customer_name", type: "string", required: true },
  { name: "amount", type: "string", required: true, default: "0" },
  { name: "invoice_url", type: "url", required: false, description: "Where the invoice lives" },
]

function setup(variables: VariableWire[] = VARS) {
  const onChange = vi.fn()
  render(<VariablesTab variables={variables} onChange={onChange} />)
  return { onChange, last: () => onChange.mock.calls.at(-1)?.[0] as VariableWire[] }
}

describe("VariablesTab", () => {
  it("shows one row per variable under a counted caption, names in mono", () => {
    setup()
    const table = screen.getByRole("table", { name: "3 variables" })
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect((screen.getByLabelText("Name of variable 1") as HTMLInputElement).value).toBe("customer_name")
    expect(screen.getByLabelText("Name of variable 1").className).toContain("font-mono")
    expect((screen.getByLabelText("Default for amount") as HTMLInputElement).value).toBe("0")
    expect((screen.getByLabelText("Description of invoice_url") as HTMLInputElement).value).toBe("Where the invoice lives")
  })

  it("counts zero and says what having none means", () => {
    setup([])
    expect(screen.getByRole("table", { name: "0 variables" })).toBeTruthy()
    expect(screen.getByText("No variables. Every send of this template renders the same text.")).toBeTruthy()
  })

  it("edits a field of one row and leaves the others alone", () => {
    const { last } = setup()
    fireEvent.change(screen.getByLabelText("Name of variable 2"), { target: { value: "total" } })
    expect(last().map((v) => v.name)).toEqual(["customer_name", "total", "invoice_url"])
    fireEvent.click(screen.getByRole("checkbox", { name: "invoice_url is required" }))
    expect(last()[2].required).toBe(true)
  })

  it("adds an empty string variable at the end", () => {
    const { last } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Add variable" }))
    expect(last()).toHaveLength(4)
    expect(last()[3]).toEqual({ name: "", type: "string", required: false })
  })

  it("moves and removes rows", () => {
    const { last } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Move amount up" }))
    expect(last().map((v) => v.name)).toEqual(["amount", "customer_name", "invoice_url"])
    fireEvent.click(screen.getByRole("button", { name: "Move amount down" }))
    expect(last().map((v) => v.name)).toEqual(["customer_name", "invoice_url", "amount"])
    fireEvent.click(screen.getByRole("button", { name: "Remove customer_name" }))
    expect(last().map((v) => v.name)).toEqual(["amount", "invoice_url"])
    expect((screen.getByRole("button", { name: "Move customer_name up" }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole("button", { name: "Move invoice_url down" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("says what's wrong with a name on its own row", () => {
    setup([...VARS, { name: "1st", type: "string", required: false }, { name: "amount", type: "string", required: false }])
    expect(screen.getByText("Use letters, digits and underscores, starting with a letter or an underscore.")).toBeTruthy()
    expect(screen.getByText("amount is declared twice.")).toBeTruthy()
    expect(screen.getByLabelText("Name of variable 4").getAttribute("aria-invalid")).toBe("true")
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/variables-tab.test.tsx`
Expected: FAIL, `../src/workspace/variables-tab` doesn't exist.

- [ ] **Step 3: Write the tab**

`packages/plugin-herald/src/workspace/variables-tab.tsx`:

```tsx
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { plural } from "../format"
import type { VariableWire } from "../wire"
import { variableProblems } from "./draft"

/** Types the sample data knows a placeholder for. Herald itself accepts any string. */
const TYPES = ["string", "url", "number", "boolean"]

/** How a row is named in its controls' labels: its name, or its position while it has none. */
const nameOf = (v: VariableWire, i: number) => v.name.trim() || `variable ${i + 1}`

export function VariablesTab({ variables, onChange }: { variables: VariableWire[]; onChange: (next: VariableWire[]) => void }) {
  const problems = variableProblems(variables)
  const set = (i: number, patch: Partial<VariableWire>) => onChange(variables.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  const move = (i: number, by: -1 | 1) => {
    const next = [...variables]
    const [row] = next.splice(i, 1)
    next.splice(i + by, 0, row)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <caption className="mb-2 text-left text-sm text-muted-foreground">{plural(variables.length, "variable")}</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Name</th>
            <th className="py-1 pr-2 font-medium">Type</th>
            <th className="py-1 pr-2 font-medium">Required</th>
            <th className="py-1 pr-2 font-medium">Default</th>
            <th className="py-1 pr-2 font-medium">Description</th>
            <th className="py-1">
              <span className="sr-only">Order and removal</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v, i) => (
            <tr key={i} className="border-t align-top">
              <td className="py-2 pr-2">
                <Input aria-label={`Name of variable ${i + 1}`} className="font-mono text-xs" autoComplete="off" spellCheck={false} value={v.name} aria-invalid={problems.has(i) || undefined} onChange={(e) => set(i, { name: e.target.value })} />
                {problems.has(i) && <p className="mt-1 text-xs text-destructive">{problems.get(i)}</p>}
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Type of ${nameOf(v, i)}`} list="herald-variable-types" className="font-mono text-xs" autoComplete="off" spellCheck={false} value={v.type} onChange={(e) => set(i, { type: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Checkbox aria-label={`${nameOf(v, i)} is required`} checked={v.required} onCheckedChange={(checked) => set(i, { required: checked === true })} />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Default for ${nameOf(v, i)}`} value={v.default ?? ""} onChange={(e) => set(i, { default: e.target.value })} />
              </td>
              <td className="py-2 pr-2">
                <Input aria-label={`Description of ${nameOf(v, i)}`} value={v.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} />
              </td>
              <td className="py-2 whitespace-nowrap">
                <Button type="button" size="xs" variant="ghost" aria-label={`Move ${nameOf(v, i)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  Up
                </Button>
                <Button type="button" size="xs" variant="ghost" aria-label={`Move ${nameOf(v, i)} down`} disabled={i === variables.length - 1} onClick={() => move(i, 1)}>
                  Down
                </Button>
                <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${nameOf(v, i)}`} onClick={() => onChange(variables.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {variables.length === 0 && <p className="text-sm text-muted-foreground">No variables. Every send of this template renders the same text.</p>}
      <datalist id="herald-variable-types">
        {TYPES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange([...variables, { name: "", type: "string", required: false }])}>
          Add variable
        </Button>
        <p className="text-xs text-muted-foreground">Edits here reach the preview straight away. Save writes them.</p>
      </div>
    </div>
  )
}
```

The "moves and removes rows" test renders once with `VARS` and the component doesn't hold the list, so each click acts on `VARS`, not on the previous click's result. That's why the second expectation is `["customer_name", "invoice_url", "amount"]` (amount moved down from its original place) and the third removes `customer_name` from `VARS`. The disabled checks read the original order too: `customer_name` is first and `invoice_url` last.

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/variables-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/variables-tab.tsx packages/plugin-herald/test/variables-tab.test.tsx
git commit --only -m "feat(plugin-herald): edit a template's variables in a table that flags bad and duplicate names" -- packages/plugin-herald/src/workspace/variables-tab.tsx packages/plugin-herald/test/variables-tab.test.tsx
git show --stat HEAD
```

---

### Task 7: The Settings tab and deleting a template

Name, category and enabled go into the draft. Slug and channel are shown read only, with the reason. Delete happens at once, behind a confirm that says what stops working.

**Files:**
- Create: `packages/plugin-herald/src/workspace/settings-tab.tsx`
- Test: `test/settings-tab.test.tsx`

**Interfaces:**
- Consumes: `Settings` (Task 2), `CATEGORIES`, `plural` (`src/format.ts`), `templatesPath` (`src/keys.ts`), `DeleteResponse` (`wire.ts`).
- Produces: `SettingsTab({ template: TemplateDetail; settings: Settings; onChange: (next: Settings) => void })`.

`templates.delete` invalidates `templates.detail`, whose refetch then answers NOT_FOUND. The confirm keeps its own snapshot of the template it names and navigates to the templates list on success; the page (Task 9) keeps the tab mounted through the refetch.

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/settings-tab.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ReactNode } from "react"
import { SettingsTab } from "../src/workspace/settings-tab"
import type { Settings } from "../src/workspace/draft"
import { templateDetail } from "./data"
import { scriptedClient } from "./harness"

afterEach(cleanup)

const detail = templateDetail()
const SETTINGS: Settings = { name: "Receipt", category: "transactional", enabled: true }

function setup(over: { settings?: Settings; isSystem?: boolean; deleteAnswer?: unknown } = {}) {
  const onChange = vi.fn()
  const navigate = vi.fn()
  const { client, sent } = scriptedClient({}, { "templates.delete": over.deleteAnswer ?? { ok: true, id: detail.id } })
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={{ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>, navigate }}>
        <SettingsTab template={{ ...detail, isSystem: over.isSystem ?? false }} settings={over.settings ?? SETTINGS} onChange={onChange} />
      </NavigationProvider>
    </PluginProvider>
  )
  return { onChange, navigate, sent }
}

describe("SettingsTab", () => {
  it("edits name, category and enabled into the draft", () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Receipts" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, name: "Receipts" })
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "marketing" } })
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, category: "marketing" })
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }))
    expect(onChange).toHaveBeenLastCalledWith({ ...SETTINGS, enabled: false })
  })

  it("says a template needs a name", () => {
    setup({ settings: { ...SETTINGS, name: "  " } })
    expect(screen.getByText("A template needs a name.")).toBeTruthy()
  })

  it("shows slug and channel read only and says why", () => {
    setup()
    const slug = screen.getByText("billing.receipt")
    expect(slug.className).toContain("font-mono")
    expect(screen.getByText(/Slug and channel can't change: callers send by slug, and the pair is the template's identity\./)).toBeTruthy()
  })

  it("names what a delete stops and sends only the ID, then goes to the list", async () => {
    const { sent, navigate } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText("Delete Receipt?")).toBeTruthy()
    expect(within(dialog).getByText("Sends that name billing.receipt on email will fail. Its 2 versions go with it, and this can't be undone.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "templates.delete", payload: { id: detail.id } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/templates"))
  })

  it("says a reset brings a system template back", () => {
    setup({ isSystem: true })
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    expect(within(screen.getByRole("alertdialog")).getByText(/Resetting system templates brings it back\./)).toBeTruthy()
  })

  it("keeps the dialog open with the refusal when a delete fails", async () => {
    const { navigate } = setup({ deleteAnswer: new ContractError("NOT_FOUND", "template not found") })
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }))
    const dialog = screen.getByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete template" }))
    expect(await within(dialog).findByText("template not found")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/settings-tab.test.tsx`
Expected: FAIL, `../src/workspace/settings-tab` doesn't exist.

- [ ] **Step 3: Write the tab**

`packages/plugin-herald/src/workspace/settings-tab.tsx`:

```tsx
import { useState } from "react"
import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { CATEGORIES, plural } from "../format"
import { templatesPath } from "../keys"
import type { DeleteResponse, TemplateDetail } from "../wire"
import type { Settings } from "./draft"

export function SettingsTab({ template, settings, onChange }: { template: TemplateDetail; settings: Settings; onChange: (next: Settings) => void }) {
  const remove = useCommand<DeleteResponse>("templates.delete")
  const navigateTo = useNavigateTo()
  const [confirming, setConfirming] = useState(false)
  // A snapshot, so the dialog keeps naming this template while templates.detail refetches into NOT_FOUND.
  const [target, setTarget] = useState<TemplateDetail>(template)

  function openDelete() {
    remove.reset()
    setTarget(template)
    setConfirming(true)
  }

  async function confirm() {
    const result = await remove.execute({ id: target.id })
    if (result === undefined) return
    setConfirming(false)
    navigateTo(templatesPath)
  }

  const nameMissing = settings.name.trim() === ""

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-name">Name</Label>
        <Input id="template-name" value={settings.name} aria-invalid={nameMissing || undefined} onChange={(e) => onChange({ ...settings, name: e.target.value })} />
        {nameMissing && <p className="text-xs text-destructive">A template needs a name.</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-category">Category</Label>
        <NativeSelect id="template-category" value={settings.category} onChange={(e) => onChange({ ...settings, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch aria-label="Enabled" checked={settings.enabled} onCheckedChange={(checked) => onChange({ ...settings, enabled: checked })} />
          <span aria-hidden="true">Enabled</span>
        </label>
        <p className="text-xs text-muted-foreground">A disabled template refuses every send that names it.</p>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Slug</dt>
        <dd className="font-mono text-xs">{template.slug}</dd>
        <dt className="text-muted-foreground">Channel</dt>
        <dd>{template.channel}</dd>
        <dt className="text-muted-foreground">Origin</dt>
        <dd>{template.isSystem ? "System" : "Custom"}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">Slug and channel can't change: callers send by slug, and the pair is the template's identity. To change either, create a new template.</p>
      <div className="flex flex-col gap-2 border-t pt-4">
        <Button type="button" variant="destructive" className="w-fit" onClick={openDelete}>
          Delete template
        </Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!next && remove.loading) return
          setConfirming(next)
        }}
        title={`Delete ${target.name}?`}
        description={`Sends that name ${target.slug} on ${target.channel} will fail. Its ${plural(target.versions.length, "version")} go with it, and this can't be undone.${target.isSystem ? " Resetting system templates brings it back." : ""}`}
        confirmLabel="Delete template"
        pending={remove.loading}
        onConfirm={() => void confirm()}
      >
        <CommandAlert error={remove.error} title="Could not delete the template" />
      </ConfirmDialog>
    </div>
  )
}
```

`Switch`'s `onCheckedChange` hands the new boolean first; `checked` is that boolean. If the kit's `Switch` passes anything else first, adapt the handler to read the boolean and say so in the report.

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/settings-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/settings-tab.tsx packages/plugin-herald/test/settings-tab.test.tsx
git commit --only -m "feat(plugin-herald): change a template's name, category and switch, and delete it behind a confirm that says what breaks" -- packages/plugin-herald/src/workspace/settings-tab.tsx packages/plugin-herald/test/settings-tab.test.tsx
git show --stat HEAD
```

---

### Task 8: Review changes

"Review changes" opens a dialog with one section per change against what's saved: a diff for each changed field and for the variables, and a before-and-after line for each setting. It can save from there.

**Files:**
- Create: `packages/plugin-herald/src/workspace/review-changes.tsx`
- Test: `test/review-changes.test.tsx`

**Interfaces:**
- Consumes: `FieldDiff` (Task 3, from `../components/editor/lazy`), `Change`, `Draft`, `normaliseVariables` (Task 2), `FIELD_LABEL`, `FIELD_LANGUAGE` (Task 1), `versionName` (Task 1).
- Produces: `ReviewChangesProps { open: boolean; onOpenChange: (open: boolean) => void; template: TemplateDetail; saved: Draft; draft: Draft; changes: Change[]; saving: boolean; canSave: boolean; onSave: () => void }` and `ReviewChanges(props)`. Section headings: `"HTML, the en version"`, `"Variables"`, `"Name"`, `"Category"`, `"Enabled"`. Each diff's label is its section heading.

- [ ] **Step 1: Write the failing test**

`packages/plugin-herald/test/review-changes.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { ReviewChanges } from "../src/workspace/review-changes"
import type { ReviewChangesProps } from "../src/workspace/review-changes"
import { changesBetween, draftOf } from "../src/workspace/draft"
import type { Draft } from "../src/workspace/draft"
import { templateDetail } from "./data"

vi.mock("../src/components/editor/field-diff", async () => ({ default: (await import("./editor-stand-in")).DiffStandIn }))

afterEach(cleanup)

const detail = templateDetail()
const EN = detail.versions[1].id

function setup(draftOver: (d: Draft) => Draft, over: Partial<ReviewChangesProps> = {}) {
  const saved = draftOf(detail)
  const draft = draftOver(saved)
  const onSave = vi.fn()
  render(<ReviewChanges open onOpenChange={vi.fn()} template={detail} saved={saved} draft={draft} changes={changesBetween(saved, draft)} saving={false} canSave onSave={onSave} {...over} />)
  return { onSave }
}

describe("ReviewChanges", () => {
  it("diffs each changed field against what's saved, named by field and version", async () => {
    setup((d) => ({ ...d, versions: { ...d.versions, [EN]: { ...d.versions[EN], html: "<p>New</p>" } } }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "HTML, the en version" })).toBeTruthy()
    expect((await within(dialog).findByLabelText("HTML, the en version")).textContent).toBe("- <p>Thanks {{.customer_name}}</p>\n+ <p>New</p>")
  })

  it("diffs the variables as JSON and states each changed setting", async () => {
    setup((d) => ({ ...d, variables: d.variables.slice(0, 1), settings: { ...d.settings, name: "Receipts", enabled: false } }))
    const dialog = screen.getByRole("dialog")
    expect((await within(dialog).findByLabelText("Variables")).textContent).toContain('"name": "amount"')
    expect(within(dialog).getByText("Was Receipt, now Receipts.")).toBeTruthy()
    expect(within(dialog).getByText("Was on, now off.")).toBeTruthy()
  })

  it("counts the changes and saves from the dialog", () => {
    const { onSave } = setup((d) => ({ ...d, settings: { ...d.settings, category: "marketing" } }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("1 change against what's saved.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }))
    expect(onSave).toHaveBeenCalled()
  })

  it("holds Save while saving or blocked", () => {
    setup((d) => ({ ...d, settings: { ...d.settings, category: "marketing" } }), { saving: true })
    expect((within(screen.getByRole("dialog")).getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/plugin-herald && npx vitest run test/review-changes.test.tsx`
Expected: FAIL, `../src/workspace/review-changes` doesn't exist.

- [ ] **Step 3: Write the dialog**

`packages/plugin-herald/src/workspace/review-changes.tsx`:

```tsx
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@forge-go/dashboard-kit/components/dialog"
import { FieldDiff } from "../components/editor/lazy"
import { plural } from "../format"
import type { TemplateDetail } from "../wire"
import type { Change, Draft, Settings } from "./draft"
import { normaliseVariables } from "./draft"
import { FIELD_LABEL, FIELD_LANGUAGE } from "./fields"
import { versionName } from "./resolve"

export interface ReviewChangesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: TemplateDetail
  saved: Draft
  draft: Draft
  changes: Change[]
  saving: boolean
  canSave: boolean
  onSave: () => void
}

const SETTING_LABEL: Record<keyof Settings, string> = { name: "Name", category: "Category", enabled: "Enabled" }

const settingText = (key: keyof Settings, value: Settings[keyof Settings]) => (key === "enabled" ? (value ? "on" : "off") : String(value) === "" ? "empty" : String(value))

const variablesText = (draft: Draft["variables"]) => JSON.stringify(normaliseVariables(draft), null, 2)

/** One section per change, so the operator reads exactly what Save will write. */
export function ReviewChanges({ open, onOpenChange, template, saved, draft, changes, saving, canSave, onSave }: ReviewChangesProps) {
  const titleOf = (c: Change) => {
    if (c.kind === "variables") return "Variables"
    if (c.kind === "setting") return SETTING_LABEL[c.key]
    const locale = template.versions.find((v) => v.id === c.versionId)?.locale ?? ""
    return `${FIELD_LABEL[c.field]}, ${versionName(locale)}`
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>{changes.length === 0 ? "Nothing to review: the page matches what's saved." : `${plural(changes.length, "change")} against what's saved.`}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {changes.map((c) => {
            const title = titleOf(c)
            return (
              <section key={title} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{title}</h3>
                {c.kind === "field" ? (
                  <FieldDiff was={saved.versions[c.versionId][c.field]} now={draft.versions[c.versionId][c.field]} label={title} language={FIELD_LANGUAGE[c.field]} />
                ) : c.kind === "variables" ? (
                  <FieldDiff was={variablesText(saved.variables)} now={variablesText(draft.variables)} label={title} language="json" />
                ) : (
                  <p className="text-sm">
                    Was {settingText(c.key, saved.settings[c.key])}, now {settingText(c.key, draft.settings[c.key])}.
                  </p>
                )}
              </section>
            )
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" disabled={!canSave || saving} onClick={onSave}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/plugin-herald && npx vitest run test/review-changes.test.tsx`
Expected: PASS.

- [ ] **Step 5: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/workspace/review-changes.tsx packages/plugin-herald/test/review-changes.test.tsx
git commit --only -m "feat(plugin-herald): review a template's unsaved changes field by field before saving" -- packages/plugin-herald/src/workspace/review-changes.tsx packages/plugin-herald/test/review-changes.test.tsx
git show --stat HEAD
```

---

### Task 9: The workspace page, its route, and the unsaved guard

The page that owns the draft and puts the pieces together: header with Review changes and Save, the Content, Variables and Settings tabs, the save sequence, and the guard against leaving with unsaved edits. It's a lazy route at `/templates/:id`, which the templates list and template create already link to.

**Files:**
- Create: `packages/plugin-herald/src/use-unsaved-guard.ts` (copied from plugin-vault), `src/pages/template-workspace.tsx`
- Modify: `src/components/herald-header.tsx` (`meta` slot), `src/index.tsx` (lazy route), `test/herald-header.test.tsx`, `test/plugin.test.tsx`, `test/routes.test.tsx`, `test/lazy-editor.test.ts`
- Test: `test/template-workspace.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 to 8; `useEngineInfo`, `HeraldHeader` (2b-1); `EnabledBadge` (2b-1).
- Produces: `TemplateWorkspacePage` (named and default export) at route `/templates/:id`; `HeraldHeader` gains `meta?: ReactNode`, rendered between the title row and the app line; `useUnsavedGuard(active: boolean, message: string): void`.

How the page survives its own writes. Every template and version write invalidates `templates.detail`, and the host re-runs it, so a `QueryBoundary` around the workspace would swap it for a skeleton on every save and throw the draft away. The page shows the boundary only until the first answer. From then on it keeps a snapshot `{ answer, saved, draft }` and adopts each new answer with `rebase` (Task 2), so edits survive. A later answer that fails shows a banner over the still-editable page. After each successful command the page moves `saved` forward itself, from the command's answer, so the draft compares clean even before the refetch lands, and in whichever order the two arrive.

- [ ] **Step 1: Copy the unsaved guard and add the header slot**

`packages/plugin-herald/src/use-unsaved-guard.ts` (from `packages/plugin-vault/src/use-unsaved-guard.ts`; plugins never import each other):

```ts
import { useEffect } from "react"

/**
 * Asks before the page is left with changes nobody saved.
 *
 * Two doors need watching. Closing the tab, reloading or typing another
 * address fires `beforeunload`, where the browser draws its own prompt. A link
 * inside the dashboard never reaches that: the router changes the URL without
 * unloading anything, so a click on the sidebar would throw the draft away
 * silently. A capture listener on the document sees the click before the
 * router's own handler and can stop it.
 *
 * Links that leave nothing behind are left alone: a modified click (new tab),
 * a link that opens elsewhere, a download, and a bare `#` anchor.
 */
export function useUnsavedGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Older browsers read this rather than the call above.
      event.returnValue = ""
    }

    function click(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      const link = target?.closest("a[href]")
      if (!link) return
      const href = link.getAttribute("href") ?? ""
      if (href === "" || href.startsWith("#")) return
      const to = link.getAttribute("target")
      if ((to !== null && to !== "_self") || link.hasAttribute("download")) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", click, true)
    }
  }, [active, message])
}
```

In `packages/plugin-herald/src/components/herald-header.tsx`, replace `HeraldHeader` with:

```tsx
/** `meta` is a row of facts about the thing the page shows (a slug, a channel, badges), between the title and the app line. */
export function HeraldHeader({ title, description, actions, meta }: { title: string; description?: string; actions?: ReactNode; meta?: ReactNode }) {
  const info = useEngineInfo()
  return (
    <div className="flex flex-col gap-1">
      <PageHeader title={title} description={description} actions={actions} />
      {meta && <div className="flex flex-wrap items-center gap-2 text-sm">{meta}</div>}
      <AppLine info={info} />
    </div>
  )
}
```

Append to `packages/plugin-herald/test/herald-header.test.tsx`, inside its existing `describe` (use the same render helper and client the file's other tests use):

```tsx
  it("puts a meta row between the title and the app line", async () => {
    renderPage(() => <HeraldHeader title="Receipt" meta={<span className="font-mono text-xs">billing.receipt</span>} />, stubClient({ "engine.info": engine() }))
    const slug = await screen.findByText("billing.receipt")
    const app = await screen.findByText("app_demo")
    expect(slug.compareDocumentPosition(app) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
```

If the file doesn't import `renderPage`, `stubClient` or `engine` yet, add them from `./harness` and `./data`.

- [ ] **Step 2: Write the failing page test**

`packages/plugin-herald/test/template-workspace.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { TemplateWorkspacePage } from "../src/pages/template-workspace"
import type { TemplatesDetailResponse, VariableWire, VersionWire } from "../src/wire"
import { engine, templateDetail } from "./data"
import { invalidatingClient, renderPage, stubClient } from "./harness"

vi.mock("../src/components/editor/code-editor", async () => ({ default: (await import("./editor-stand-in")).EditorStandIn }))
vi.mock("../src/components/editor/field-diff", async () => ({ default: (await import("./editor-stand-in")).DiffStandIn }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const base = templateDetail()
const FR: VersionWire = { id: "htpv_01j00000000000000000000027", locale: "fr", subject: "Votre reçu", html: "", text: "Bonjour", title: "", active: false, createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z" }
const TEMPLATE = templateDetail({ versions: [...base.versions, FR] })
const EN = TEMPLATE.versions[1]
const DETAIL: TemplatesDetailResponse = { template: TEMPLATE, resolution: [] }
const VERSION_WRITE = ["templates.list", "templates.detail", "templates.resolve", "overview.stats"]
const TEMPLATE_WRITE = [...VERSION_WRITE, "preferences.get"]
const SENDER = { provider: { id: "hpvd_01j00000000000000000000001", name: "Primary SMTP", driver: "smtp", enabled: true }, via: "app", from: { email: "hello@example.com", name: "Example" } }

const withVersion = (d: TemplatesDetailResponse, v: VersionWire): TemplatesDetailResponse => ({ ...d, template: { ...d.template, versions: d.template.versions.map((x) => (x.id === v.id ? v : x)) } })
const withVariables = (d: TemplatesDetailResponse, variables: VariableWire[]): TemplatesDetailResponse => ({ ...d, template: { ...d.template, variables } })

type Detail = (input: Record<string, unknown>, call: number) => unknown

function open(detail: Detail = () => DETAIL, commands: Parameters<typeof invalidatingClient>[1] = {}) {
  const harness = invalidatingClient({ "engine.info": engine(), "templates.detail": detail, "templates.render": { fields: [], diagnostics: [] }, "send.resolve": SENDER }, commands)
  renderPage(TemplateWorkspacePage, harness.client, { id: TEMPLATE.id })
  return harness
}

const review = () => screen.getByRole("button", { name: /^Review/ })
const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement
async function htmlEditor() {
  fireEvent.click(await screen.findByRole("tab", { name: "HTML" }))
  return screen.findByLabelText("HTML (en)")
}
const renders = (queried: { intent: string; params: Record<string, unknown> }[]) => queried.filter((q) => q.intent === "templates.render")

describe("TemplateWorkspacePage", () => {
  it("says there's nothing to show without an ID, under the app line", async () => {
    renderPage(TemplateWorkspacePage, stubClient({ "engine.info": engine() }), {})
    expect(screen.getByText("No template ID in the address, so there is nothing to show.")).toBeTruthy()
    expect(await screen.findByText("app_demo")).toBeTruthy()
  })

  it("names the template, its slug, channel and origin, and opens on the default locale's version", async () => {
    open()
    expect(await screen.findByRole("heading", { name: "Receipt" })).toBeTruthy()
    expect(screen.getByText("billing.receipt").className).toContain("font-mono")
    expect(screen.getByText("Custom")).toBeTruthy()
    expect(await screen.findByLabelText("Subject (en)")).toBeTruthy()
    expect(within(screen.getByRole("complementary", { name: "Locales" })).getByRole("button", { name: /^en/ }).getAttribute("aria-current")).toBe("true")
  })

  it("shows the sender the routing rules pick above the rendered email", async () => {
    open()
    expect(await screen.findByText("Example <hello@example.com>")).toBeTruthy()
  })

  it("saves only the changed field of the changed version, then says so", async () => {
    const saved = { ...EN, html: "<p>New</p>" }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, saved)), { "versions.update": { answer: { version: saved }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>New</p>" } })
    expect(review().textContent).toBe("Review 1 change")
    fireEvent.click(save())
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: TEMPLATE.id, versionId: EN.id, html: "<p>New</p>" } }]))
    expect(await screen.findByText("Saved.")).toBeTruthy()
    expect((review() as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps an unsaved edit when another version goes live and the template reloads", async () => {
    const live = { ...FR, active: true }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, live)), { "versions.update": { answer: { version: live }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>Mine</p>" } })
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put live" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "versions.update", payload: { templateId: TEMPLATE.id, versionId: FR.id, active: true } }]))
    await waitFor(() => expect(within(screen.getByRole("complementary", { name: "Locales" })).getAllByText("Live")).toHaveLength(3))
    expect((screen.getByLabelText("HTML (en)") as HTMLTextAreaElement).value).toBe("<p>Mine</p>")
    expect(review().textContent).toBe("Review 1 change")
  })

  it("says what was saved when a save stops partway, and keeps the rest unsaved", async () => {
    const saved = { ...EN, html: "<p>New</p>" }
    const { sent } = open((_i, call) => (call === 0 ? DETAIL : withVersion(DETAIL, saved)), {
      "versions.update": { answer: { version: saved }, invalidates: VERSION_WRITE },
      "templates.update": new ContractError("BAD_REQUEST", "category must be auth, transactional, marketing or system"),
    })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>New</p>" } })
    fireEvent.click(screen.getByRole("tab", { name: /Settings/ }))
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Receipts" } })
    fireEvent.click(save())
    expect(await screen.findByText("Saved the en version. The rest is still unsaved.")).toBeTruthy()
    expect(screen.getByText(/category must be auth/)).toBeTruthy()
    expect(screen.queryByText("Saved.")).toBeNull()
    expect(sent.map((s) => s.intent)).toEqual(["versions.update", "templates.update"])
    await waitFor(() => expect(review().textContent).toBe("Review 1 change"))
    expect(save().disabled).toBe(false)
  })

  it("keeps rendering with the last sample data that parsed", async () => {
    const { queried } = open()
    fireEvent.change(await screen.findByLabelText("Sample data"), { target: { value: "{nope" } })
    expect(await screen.findByText(/^Not valid JSON: .* The preview uses the last sample data that parsed\.$/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Subject (en)"), { target: { value: "Changed" } })
    await waitFor(() => expect((renders(queried).at(-1)?.params.content as { subject: string }).subject).toBe("Changed"))
    expect(renders(queried).at(-1)?.params.data).toEqual({ customer_name: "example customer name", amount: "example amount", invoice_url: "https://example.com/" })
  })

  it("sends edited variables to the preview at once and saves them", async () => {
    const edited: VariableWire[] = [
      { name: "customer_name", type: "string", required: true, default: "", description: "" },
      { name: "total", type: "string", required: true, default: "", description: "" },
      { name: "invoice_url", type: "url", required: false, default: "", description: "" },
    ]
    const { sent, queried } = open((_i, call) => (call === 0 ? DETAIL : withVariables(DETAIL, edited)), { "templates.update": { answer: { template: TEMPLATE }, invalidates: TEMPLATE_WRITE } })
    await screen.findByLabelText("Subject (en)")
    fireEvent.click(screen.getByRole("tab", { name: /Variables/ }))
    fireEvent.change(await screen.findByLabelText("Name of variable 2"), { target: { value: "total" } })
    expect(screen.getByRole("tab", { name: /Variables/ }).textContent).toContain("edited")
    fireEvent.click(screen.getByRole("tab", { name: /Content/ }))
    await waitFor(() => expect(renders(queried).at(-1)?.params.variables).toEqual(expect.arrayContaining([expect.objectContaining({ name: "total" })])))
    fireEvent.click(save())
    await waitFor(() => expect(sent).toEqual([{ intent: "templates.update", payload: { id: TEMPLATE.id, variables: edited } }]))
    expect(await screen.findByText("Saved.")).toBeTruthy()
  })

  it("holds Save while a variable name is invalid and says why", async () => {
    open()
    await screen.findByLabelText("Subject (en)")
    fireEvent.click(screen.getByRole("tab", { name: /Variables/ }))
    fireEvent.change(await screen.findByLabelText("Name of variable 1"), { target: { value: "1st" } })
    expect(save().disabled).toBe(true)
    expect(screen.getByText("Fix the variables before saving.")).toBeTruthy()
  })

  it("asks before leaving only while there are unsaved edits", async () => {
    open()
    const editor = await htmlEditor()
    const clean = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    fireEvent.change(editor, { target: { value: "<p>Unsaved</p>" } })
    const dirty = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const link = document.createElement("a")
    link.href = "/elsewhere"
    document.body.appendChild(link)
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(confirm).toHaveBeenCalledWith("This template has edits that aren't saved. Leave the page and lose them?")
    link.remove()
  })

  it("keeps the page and its edits when a reload fails, and says so", async () => {
    open((_i, call) => (call === 0 ? DETAIL : new ContractError("UNAVAILABLE", "store is down")), { "versions.update": { answer: { version: { ...FR, active: true } }, invalidates: VERSION_WRITE } })
    fireEvent.change(await htmlEditor(), { target: { value: "<p>Mine</p>" } })
    fireEvent.click(screen.getByRole("switch", { name: "Live: fr version" }))
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Put live" }))
    expect(await screen.findByText(/This template didn't reload: UNAVAILABLE: store is down\. Your edits are still on the page\./)).toBeTruthy()
    expect((screen.getByLabelText("HTML (en)") as HTMLTextAreaElement).value).toBe("<p>Mine</p>")
    expect(review().textContent).toBe("Review 1 change")
  })
})
```

Add to `packages/plugin-herald/test/lazy-editor.test.ts`, inside its `describe`:

```ts
  it("reaches the template workspace from the plugin entry through lazy(), and from nowhere else", () => {
    const entry = source(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/template-workspace"\)\)/)
    expect(files.filter(([, text]) => /from\s+["'][./]*pages\/template-workspace["']/.test(text)).map(([path]) => path)).toEqual([])
  })
```

In `packages/plugin-herald/test/plugin.test.tsx`, insert `"/templates/:id"` into `ROUTES` right after `"/new-template"`. In `packages/plugin-herald/test/routes.test.tsx`, add `"/templates/:id": /No template ID in the address, so there is nothing to show/,` to `EXPECTED`.

- [ ] **Step 3: Run them to see them fail**

Run: `cd packages/plugin-herald && npx vitest run test/template-workspace.test.tsx test/plugin.test.tsx test/routes.test.tsx test/lazy-editor.test.ts test/herald-header.test.tsx`
Expected: FAIL: the page doesn't exist, the route isn't registered, and `HeraldHeader` ignores `meta` until Step 1's edit is in. (If you made Step 1's edits already, only the page, route and lazy tests fail.)

- [ ] **Step 4: Write the page and register the route**

`packages/plugin-herald/src/pages/template-workspace.tsx`:

```tsx
import { useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { ContractError, usePluginClient, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { EnabledBadge } from "../badges"
import { HeraldHeader, useEngineInfo } from "../components/herald-header"
import { plural } from "../format"
import { useUnsavedGuard } from "../use-unsaved-guard"
import type { SendResolveResponse, TemplateResponse, TemplatesDetailResponse, VersionResponse, VersionWire } from "../wire"
import { ContentTab } from "../workspace/content-tab"
import { changesBetween, contentOf, draftOf, rebase, templatePatch, variableProblems, versionPatch } from "../workspace/draft"
import type { Draft } from "../workspace/draft"
import { LocaleRail } from "../workspace/locale-rail"
import { versionName } from "../workspace/resolve"
import { ReviewChanges } from "../workspace/review-changes"
import { parseSample, sampleDataFor, sampleTextFor } from "../workspace/sample-data"
import { SettingsTab } from "../workspace/settings-tab"
import { VariablesTab } from "../workspace/variables-tab"

interface Snapshot {
  /** The last templates.detail answer adopted. */
  answer: TemplatesDetailResponse
  /** What the server holds, as far as this page knows. */
  saved: Draft
  draft: Draft
}

interface SaveState {
  saving: boolean
  /** What this save wrote before it stopped or finished, in words. */
  wrote: string[]
  error?: ContractError
  done: boolean
}

const NO_FUNCS: string[] = []
const UNSAVED = "This template has edits that aren't saved. Leave the page and lose them?"

/** The version shown first: the one the default locale gets, else the live fallback, else any live one, else the first. */
function pick(versions: VersionWire[], selectedId: string | null, defaultLocale: string | undefined): VersionWire | undefined {
  return versions.find((v) => v.id === selectedId) ?? versions.find((v) => v.active && v.locale === defaultLocale) ?? versions.find((v) => v.active && v.locale === "") ?? versions.find((v) => v.active) ?? versions[0]
}

const listOf = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`)

export function TemplateWorkspacePage({ params }: PluginPageProps) {
  const id = params.id ?? ""
  if (id === "") {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Template" />
        <p className="text-sm text-muted-foreground">No template ID in the address, so there is nothing to show.</p>
      </section>
    )
  }
  return <Workspace key={id} id={id} />
}

export default TemplateWorkspacePage

function Workspace({ id }: { id: string }) {
  const detail = useQuery<TemplatesDetailResponse>("templates.detail", { id })
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [adopted, setAdopted] = useState<TemplatesDetailResponse | undefined>(undefined)

  // Each new answer is adopted once: the first seeds the draft, later ones are
  // rebased under it so no edit is lost. Adjusted while rendering, guarded on
  // the answer's identity, so it can't loop.
  if (detail.data && detail.data !== adopted) {
    const answer = detail.data
    setAdopted(answer)
    setSnap((prev) => {
      const next = draftOf(answer.template)
      return prev === null ? { answer, saved: next, draft: next } : { answer, saved: next, draft: rebase(prev.saved, next, prev.draft) }
    })
  }

  if (snap === null) {
    return (
      <section className="flex flex-col gap-6">
        <HeraldHeader title="Template" />
        <QueryBoundary title="Template" query={detail} skeletonRows={6}>
          {() => null}
        </QueryBoundary>
      </section>
    )
  }
  return <Editor id={id} snap={snap} setSnap={setSnap} reloadError={detail.error} onRetry={detail.refetch} />
}

function Editor({ id, snap, setSnap, reloadError, onRetry }: { id: string; snap: Snapshot; setSnap: Dispatch<SetStateAction<Snapshot | null>>; reloadError?: ContractError; onRetry: () => void }) {
  const client = usePluginClient()
  const engine = useEngineInfo()
  const template = snap.answer.template
  const { saved, draft } = snap
  const [tab, setTab] = useState("content")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [save, setSave] = useState<SaveState>({ saving: false, wrote: [], done: false })
  const [sample, setSample] = useState(() => ({ text: sampleTextFor(draft.variables), data: sampleDataFor(draft.variables), error: undefined as string | undefined, key: 0 }))
  const sender = useQuery<SendResolveResponse>("send.resolve", { channel: template.channel })

  const changes = changesBetween(saved, draft)
  const blocked = variableProblems(draft.variables).size > 0 ? "Fix the variables before saving." : draft.settings.name.trim() === "" ? "A template needs a name before it can be saved." : null
  const canSave = changes.length > 0 && blocked === null && !save.saving
  useUnsavedGuard(changes.length > 0, UNSAVED)

  const current = pick(template.versions, selectedId, engine.data?.defaultLocale)
  const dirtyIds = new Set(changes.flatMap((c) => (c.kind === "field" ? [c.versionId] : [])))
  const variablesEdited = changes.some((c) => c.kind === "variables")
  const settingsEdited = changes.some((c) => c.kind === "setting")
  const setDraft = (update: (d: Draft) => Draft) => setSnap((s) => (s === null ? s : { ...s, draft: update(s.draft) }))

  function changeSample(text: string) {
    const parsed = parseSample(text)
    setSample((s) => ({ ...s, text, data: parsed.ok ? parsed.data : s.data, error: parsed.ok ? undefined : parsed.message }))
  }

  function refillSample() {
    setSample((s) => ({ text: sampleTextFor(draft.variables), data: sampleDataFor(draft.variables), error: undefined, key: s.key + 1 }))
  }

  /**
   * Every changed version, changed fields only, then the variables and
   * settings in one templates.update. Stops at the first refusal and says what
   * it had written. The patches come from the snapshot at the click; anything
   * typed while saving stays a change.
   */
  async function saveAll() {
    if (!canSave) return
    const start = snap
    const wrote: string[] = []
    setSave({ saving: true, wrote: [], done: false })
    try {
      for (const v of template.versions) {
        const was = start.saved.versions[v.id]
        const now = start.draft.versions[v.id]
        if (!was || !now) continue
        const patch = versionPatch(was, now)
        if (!patch) continue
        const res = await client.command<VersionResponse>("versions.update", { templateId: id, versionId: v.id, ...patch })
        setSnap((s) => (s === null ? s : { ...s, saved: { ...s.saved, versions: { ...s.saved.versions, [v.id]: contentOf(res.version) } } }))
        wrote.push(versionName(v.locale))
      }
      const patch = templatePatch(start.saved, start.draft)
      if (patch) {
        await client.command<TemplateResponse>("templates.update", { id, ...patch })
        const sent = start.draft
        setSnap((s) =>
          s === null
            ? s
            : {
                ...s,
                saved: {
                  ...s.saved,
                  settings: {
                    name: patch.name !== undefined ? sent.settings.name : s.saved.settings.name,
                    category: patch.category !== undefined ? sent.settings.category : s.saved.settings.category,
                    enabled: patch.enabled !== undefined ? sent.settings.enabled : s.saved.settings.enabled,
                  },
                  variables: patch.variables !== undefined ? sent.variables : s.saved.variables,
                },
              },
        )
        if (patch.variables) wrote.push("the variables")
        if (patch.name !== undefined || patch.category !== undefined || patch.enabled !== undefined) wrote.push("the settings")
      }
      setSave({ saving: false, wrote, done: true })
      setReviewing(false)
    } catch (err) {
      const error = err instanceof ContractError ? err : new ContractError("TRANSPORT", String(err))
      setSave({ saving: false, wrote, error, done: false })
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <HeraldHeader
        title={draft.settings.name.trim() || template.name}
        meta={
          <>
            <span className="font-mono text-xs">{template.slug}</span>
            <span>{template.channel}</span>
            <Badge variant="outline">{template.isSystem ? "System" : "Custom"}</Badge>
            <EnabledBadge enabled={template.enabled} />
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" disabled={changes.length === 0} onClick={() => setReviewing(true)}>
              {changes.length === 0 ? "Review changes" : `Review ${plural(changes.length, "change")}`}
            </Button>
            <Button type="button" disabled={!canSave} onClick={() => void saveAll()}>
              {save.saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      />
      {changes.length > 0 && blocked && <p className="text-sm text-destructive">{blocked}</p>}
      {/* Always mounted, text set later: a live region announces what changes inside it. */}
      <p role="status" className="text-sm text-muted-foreground empty:sr-only">
        {save.done && changes.length === 0 ? "Saved." : ""}
      </p>
      <CommandAlert error={save.error} title={save.wrote.length > 0 ? `Saved ${listOf(save.wrote)}. The rest is still unsaved.` : "Nothing was saved."} />
      {reloadError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          <span>
            This template didn't reload: {reloadError.code}: {reloadError.message}. Your edits are still on the page.
          </span>
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="variables">
            Variables{variablesEdited && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
          </TabsTrigger>
          <TabsTrigger value="settings">
            Settings{settingsEdited && <span className="ml-1.5 text-xs text-muted-foreground">edited</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="content" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[12rem_minmax(0,1fr)_minmax(0,24rem)]">
            <LocaleRail
              template={template}
              selectedId={current?.id ?? ""}
              onSelect={setSelectedId}
              dirtyIds={dirtyIds}
              copyFrom={current ? draft.versions[current.id] : undefined}
              copyName={current ? versionName(current.locale) : ""}
              onCreated={(v) => setSelectedId(v.id)}
            />
            {current && draft.versions[current.id] ? (
              <ContentTab
                templateId={id}
                channel={template.channel}
                version={current}
                content={draft.versions[current.id]}
                onFieldChange={(field, text) => setDraft((d) => ({ ...d, versions: { ...d.versions, [current.id]: { ...d.versions[current.id], [field]: text } } }))}
                variables={draft.variables}
                variablesEdited={variablesEdited}
                funcs={engine.data?.templateFuncs ?? NO_FUNCS}
                sampleText={sample.text}
                sampleData={sample.data}
                sampleError={sample.error}
                sampleKey={sample.key}
                onSampleChange={changeSample}
                onSampleRefill={refillSample}
                from={sender.data?.from}
              />
            ) : (
              <p className="text-sm text-muted-foreground xl:col-span-2">This template has no versions yet. Add a locale to start writing.</p>
            )}
          </div>
        </TabsContent>
        <TabsContent value="variables" className="mt-4">
          <VariablesTab variables={draft.variables} onChange={(variables) => setDraft((d) => ({ ...d, variables }))} />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab template={template} settings={draft.settings} onChange={(settings) => setDraft((d) => ({ ...d, settings }))} />
        </TabsContent>
      </Tabs>
      <ReviewChanges open={reviewing} onOpenChange={setReviewing} template={template} saved={saved} draft={draft} changes={changes} saving={save.saving} canSave={canSave} onSave={() => void saveAll()} />
    </section>
  )
}
```

In `packages/plugin-herald/src/index.tsx`, add the lazy import below the provider forms':

```tsx
/** The template workspace is its own chunk, and CodeMirror is further chunks below it. */
const TemplateWorkspacePage = lazy(() => import("./pages/template-workspace"))
```

and its route right after `{ path: newTemplatePath, element: TemplateCreatePage },`:

```tsx
    { path: "/templates/:id", element: TemplateWorkspacePage },
```

`/templates/:id` and `/templates-without-fallback` don't collide: the second is its own first segment.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd packages/plugin-herald && npx vitest run test/template-workspace.test.tsx test/plugin.test.tsx test/routes.test.tsx test/lazy-editor.test.ts test/herald-header.test.tsx test/structure.test.ts`
Expected: PASS. If a test finds the draft reverted after a refetch, the adopt step ran `rebase` against a stale `saved`: check that the command-answer `setSnap` and the adopt `setSnap` both use the updater form, and say what you found.

- [ ] **Step 6: Package checks and commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
git add packages/plugin-herald/src/use-unsaved-guard.ts packages/plugin-herald/src/pages/template-workspace.tsx packages/plugin-herald/test/template-workspace.test.tsx
git commit --only -m "feat(plugin-herald): open a template in a workspace that keeps edits through reloads and saves only what changed" -- packages/plugin-herald/src/use-unsaved-guard.ts packages/plugin-herald/src/pages/template-workspace.tsx packages/plugin-herald/src/components/herald-header.tsx packages/plugin-herald/src/index.tsx packages/plugin-herald/test/template-workspace.test.tsx packages/plugin-herald/test/herald-header.test.tsx packages/plugin-herald/test/plugin.test.tsx packages/plugin-herald/test/routes.test.tsx packages/plugin-herald/test/lazy-editor.test.ts
git show --stat HEAD
```

---

### Task 10: Where it lands: the shell build and the BASELINE.md section

The spec's bundle check. Build the shell with and without Herald into scratch directories, prove the eager chunks carry no CodeMirror, and append a dated Herald section to `BASELINE.md` in the same shape as the Sentinel section (2026-10-05), touching nothing else in that file.

**Files:**
- Modify: `BASELINE.md` (append one section at the end)
- Temporarily modify, then restore byte for byte: `apps/shell/src/App.tsx`

**Interfaces:**
- Consumes: the whole plugin as built by Tasks 1 to 9.

- [ ] **Step 1: The whole package and the monorepo, before measuring**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-herald test
pnpm --filter @forge-go/dashboard-plugin-herald typecheck
pnpm --filter @forge-go/dashboard-plugin-herald lint
pnpm -r --no-bail test 2>&1 | grep -E "Test Files|FAIL" | head -40
```

Expected: herald clean on all three. `pnpm -r` fails only in `packages/host/test/setup-screen.test.tsx`. Other sessions commit here too, so name any other failure in the report with its package and test, rerun that one file on its own, and say whether it also fails alone; don't touch other packages.

- [ ] **Step 2: Build with Herald**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard/apps/shell
SCRATCH=$(mktemp -d)
echo "$SCRATCH"
npx vite build --outDir "$SCRATCH/with-herald" --emptyOutDir 2>&1 | tail -80 > "$SCRATCH/with-herald.txt"
cat "$SCRATCH/with-herald.txt"
```

Vite prints each chunk with its raw and gzip size. Keep that output: the section's tables come from it. `tsc -b` is skipped on purpose, as in the earlier sections.

- [ ] **Step 3: Build without Herald, then put App.tsx back exactly**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git diff --stat -- apps/shell/src/App.tsx
cp apps/shell/src/App.tsx "$SCRATCH/App.tsx.backup"
```

With the Edit tool (another session may have edits in this file), remove the `heraldPlugin` import line and the `heraldPlugin` entry in the plugins array from `apps/shell/src/App.tsx`. The spec asks for the import to go too: with the import left in, Vite still bundles the plugin. Then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard/apps/shell
npx vite build --outDir "$SCRATCH/without-herald" --emptyOutDir 2>&1 | tail -80 > "$SCRATCH/without-herald.txt"
cd /Users/rexraphael/Work/xraph/forge-dashboard
cp "$SCRATCH/App.tsx.backup" apps/shell/src/App.tsx
cmp apps/shell/src/App.tsx "$SCRATCH/App.tsx.backup" && echo "App.tsx restored"
git diff --stat -- apps/shell/src/App.tsx
```

Expected: `App.tsx restored`, and the final `git diff --stat` prints exactly what it printed before the backup (nothing, if the file was clean).

- [ ] **Step 4: Count what the entry carries**

```bash
cd "$SCRATCH/with-herald/assets"
ENTRY=$(ls index-*.js)
for s in EditorView @codemirror cm-editor lang-html unifiedMergeView htmlLanguage; do printf '%s %s\n' "$s" "$(grep -o "$s" "$ENTRY" | wc -l | tr -d ' ')"; done
grep -o 'template-workspace-[A-Za-z0-9_-]*\.js' "$ENTRY" | sort | uniq -c
grep -c 'template-workspace' ../index.html
ls *.js | grep -E 'template-workspace|code-editor|field-diff|provider-create|provider-edit|dist-'
for f in template-workspace-*.js code-editor-*.js field-diff-*.js; do echo "== $f"; grep -o 'from"\./[^"]*"' "$f" | sort -u; grep -o 'import("\./[^"]*")' "$f" | sort -u; done
```

Expected: every count in the first loop is 0. The entry names the workspace chunk only in `__vite__mapDeps` and the `import()` its `lazy()` compiles to. `index.html` doesn't preload it (0). The workspace chunk reaches `code-editor` and `field-diff` only through `import()`. The `from` lines show which `dist-*` CodeMirror chunks each editor chunk loads: name them and their sizes, and say which are new (shared chunks from earlier sections keep their hash: `dist-C1o7dCB9` is the core, `dist-v479ndfu` holds `@codemirror/merge`).

- [ ] **Step 5: Append the section**

Append to the end of `BASELINE.md`, after the Sentinel section and a blank line, a section in this shape. Every number comes from Steps 2 to 4; the sentences say what the numbers mean, as the Sentinel section does. Use the date the build ran.

```markdown
## Herald's template workspace, and where it lands (YYYY-MM-DD)

Measured with `vite build` in `apps/shell` on YYYY-MM-DD, written to scratch
directories with `--outDir`, the same way as the sentinel section: `tsc -b`
skipped, sizes in Vite's own kB. This time the shell was built twice, with
Herald and without it (its import and its array entry removed from `App.tsx`
for the second build, then put back), so the difference is Herald's own.

(One sentence: how many JS chunks, how many more than the sentinel section,
and which are Herald's.)

| chunk | raw | gzip | loaded |
|---|---|---|---|
(One row per eager chunk, as in the sentinel table, then one row per Herald
lazy chunk: `template-workspace`, `code-editor`, `field-diff`,
`provider-create`, `provider-edit`, each with when it loads.)

(Paragraph: the eager set's raw and gzip total with Herald, without Herald,
and the difference. That difference is what every operator pays for Herald
before opening any of its pages: its plugin entry and the pages the entry
imports statically.)

### What the workspace carries

(What `template-workspace` imports statically and that it reaches the two
editor chunks only through `import()`. What opening a template costs before
any editor loads.)

### CodeMirror

(Which `dist-*` chunks `code-editor` and `field-diff` import, which are shared
with vault, warden, trove and sentinel and which are new for `lang-html`,
`lang-json`, `lint` and `autocomplete`. What the first template open costs
cold, and what it costs when another editor already loaded the shared core.)

### The entry does not carry any of it

Counts in the built entry chunk (`index-<hash>.js`):

| string | matches |
|---|---|
| `EditorView` | 0 |
| `@codemirror` | 0 |
| `cm-editor` | 0 |
| `lang-html` | 0 |
| `unifiedMergeView` | 0 |
| `htmlLanguage` | 0 |

(Where the entry names the workspace chunk, that `index.html` doesn't preload
it, and the CSS size against the sentinel section.)

The chunk hashes named in this section are from this build. Any edit to the
entry changes them, so search by chunk name if you repeat the counts.
```

Replace every parenthesised instruction with the measured prose and figures, and `YYYY-MM-DD` with the date. No em or en dashes. If any count in the last table isn't 0, stop: CodeMirror reached the entry, and that is a defect in an earlier task to find and fix before writing the section.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git diff --stat -- BASELINE.md
```

If that shows only your appended lines, commit normally:

```bash
git commit --only -m "docs(baseline): measure where herald's template workspace lands, with and without herald" -- BASELINE.md
git show --stat HEAD
```

If it shows anyone else's changes too, commit only your section through a temporary index (Global Constraints), then confirm their changes are still in the working tree. Remove the scratch directory: `rm -rf "$SCRATCH"`.

---

## After the last task: run it

The controller's job, after the final review, in the browser pane. Start `fixture-server` (port 8099) and `dashboard-shell` (port 5173) from `.claude/launch.json`, then:

1. Templates: open "Receipt" (`billing.receipt`). The workspace opens on the `en` version; the rail shows Fallback and `en` live, `fr` inactive, each with what it answers.
2. Break it: in HTML, type `{{ nosuch .x }}` on line 2. Within a moment the preview dims, then the gutter and the wavy underline land on `nosuch`, and Problems lists `HTML 2:4`. Click the problem: the cursor moves there.
3. Preview: the email shows From and the subject; remote images are off and the note says why; Text and Source tabs read back.
4. Sample data: type invalid JSON and see the message, and that the preview still renders. Refill from variables.
5. Variables: add `due_date`, see the preview pick it up straight away, give one a bad name and see Save held.
6. Locales: test `fr-CA` and read the ladder end at the fallback. Put `fr` live and read the confirm. Test `fr-CA` again: it now ends at `fr`. Add `de` from the `en` content; it appears inactive.
7. Review changes: read each diff, then Save. "Saved." appears, Review and Save go quiet, and the rail still shows the edits gone from "edited".
8. Leave with an unsaved edit: click Messages in the sidebar and see the prompt.
9. Settings: create a throwaway template first (New template), open it, delete it from Settings, and land on the list.

Screenshots of each go in the final report. Anything that misbehaves is a finding for a fix task, not a note.

