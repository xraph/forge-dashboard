import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { tags } from "@lezer/highlight"

// What the editor and the diff share, in the kit's tokens so both follow light
// and dark with the shell. CodeMirror's own default highlight style paints
// literals and type names green, and --success is the kit's green, so neither
// is used: keywords and tags carry weight, strings and type names take info,
// numbers and literals take warning, and comments and attribute names recede.
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.tagName], color: "var(--foreground)", fontWeight: "bold" },
  { tag: tags.string, color: "var(--info)" },
  { tag: [tags.number, tags.literal, tags.bool, tags.null], color: "var(--warning)" },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.attributeName, color: "var(--muted-foreground)" },
  { tag: tags.typeName, color: "var(--info)" },
])

const baseTheme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
})

/** Highlighting plus the type, colour and gutter rules both editors start from. */
export const sharedTheme: Extension = [syntaxHighlighting(highlightStyle), baseTheme]
