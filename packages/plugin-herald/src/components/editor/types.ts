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
  /**
   * Names the editing area for a screen reader, and for tests. Changing
   * `label`, `language` or `singleLine` builds a new editor from `initial`, so
   * a caller that changes one of them also changes the component's `key`.
   */
  label: string
  /** Read once, when an editor is built. Change the component's key to start over. */
  initial: string
  language: EditorLanguage
  /** Subject and title: no line numbers, Enter does nothing, and a pasted newline becomes a space. */
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
