import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import type { Text } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language"
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { lintGutter, setDiagnostics } from "@codemirror/lint"
import type { Diagnostic } from "@codemirror/lint"
import { wardenLanguage } from "./warden-language"

/** One problem with the source, as schema.plan reports it. */
export interface SchemaDiagnostic {
  /** 1-based. */
  line: number
  /** 1-based, and a column in bytes: warden's `dsl.Pos`. */
  col: number
  message: string
}

/** The UTF-8 length of one code point. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * The document offset of a line and a byte column.
 *
 * Warden counts columns in bytes of UTF-8 and the document counts UTF-16
 * units, so for a line with a non-ASCII character before the position the two
 * differ: walk the line by code point, adding each one's UTF-8 length, and
 * stop before the one that would pass the column. A column inside a character
 * lands on that character's start. A line past the document clamps to the
 * last line, and a column past the line clamps to its end.
 */
export function diagnosticOffset(doc: Text, line: number, col: number): number {
  const at = doc.line(Math.min(Math.max(Math.trunc(line), 1), doc.lines))
  const target = Math.max(Math.trunc(col) - 1, 0)
  let bytes = 0
  let units = 0
  for (const ch of at.text) {
    const length = utf8Length(ch.codePointAt(0) as number)
    if (bytes + length > target) break
    bytes += length
    units += ch.length
  }
  return at.from + units
}

// What the marker covers from its position: the word, the string or the one
// character there. Warden reports a position, not a span.
const TOKEN =
  /^(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"?|[\uD800-\uDBFF][\uDC00-\uDFFF]|.)/

/**
 * The marker for each diagnostic. A position at the end of its line, where an
 * unexpected end of input is usually reported, marks the last character
 * instead, so the marker can be seen.
 */
export function lintDiagnostics(
  doc: Text,
  diagnostics: SchemaDiagnostic[]
): Diagnostic[] {
  return diagnostics.map((d) => {
    const at = diagnosticOffset(doc, d.line, d.col)
    const line = doc.lineAt(at)
    let from = at
    let to = at
    const rest = doc.sliceString(at, line.to)
    const token = TOKEN.exec(rest)
    if (token) {
      to = at + token[0].length
    } else if (at > line.from) {
      const before = doc.sliceString(Math.max(line.from, at - 2), at)
      from = at - (/[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(before) ? 2 : 1)
    }
    return { from, to, severity: "error", message: d.message, source: "warden" }
  })
}

// The kit's tokens, so the editor follows light and dark with the shell.
const theme = EditorView.theme({
  "&": {
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    lineHeight: "1.55",
    minHeight: "16rem",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
})

export interface SchemaEditorProps {
  /** Names the editing area for a screen reader. */
  label: string
  /**
   * The text to start from. Read once, when the editor mounts: after that the
   * editor owns what is on screen. To start it over, mount it again with a
   * different `key`.
   */
  initial: string
  /** Every change, with the whole text. */
  onChange: (text: string) => void
  /** The plan's problems, marked in the gutter and in the text. */
  diagnostics: SchemaDiagnostic[]
}

/**
 * An editable CodeMirror editor for Warden source. Chronicle's JSON viewer
 * with history and editing, `wardenLanguage`, and the plan's diagnostics as
 * lint markers. Reached only through the lazy schema page, so none of it is
 * in the shell's entry chunk.
 */
export default function SchemaEditor({
  label,
  initial,
  onChange,
  diagnostics,
}: SchemaEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)

  // The listener lives as long as the editor, so it reads the latest callback
  // through a ref instead of being rebuilt with each render.
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  }, [onChange])

  // What to mark when the editor is built, and whenever it changes after.
  const marks = useRef(diagnostics)
  useEffect(() => {
    marks.current = diagnostics
    const v = view.current
    if (v)
      v.dispatch(
        setDiagnostics(v.state, lintDiagnostics(v.state.doc, diagnostics))
      )
  }, [diagnostics])

  useEffect(() => {
    if (!host.current) return
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          syntaxHighlighting(defaultHighlightStyle),
          wardenLanguage,
          lintGutter(),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.contentAttributes.of({
            "aria-label": label,
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current(update.state.doc.toString())
          }),
          theme,
        ],
      }),
    })
    view.current = created
    if (marks.current.length > 0) {
      created.dispatch(
        setDiagnostics(
          created.state,
          lintDiagnostics(created.state.doc, marks.current)
        )
      )
    }
    return () => {
      view.current = null
      created.destroy()
    }
    // `initial` is read once by design: a new starting text means a new editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label])

  return (
    <div ref={host} className="max-h-[70vh] overflow-auto rounded-md border" />
  )
}
