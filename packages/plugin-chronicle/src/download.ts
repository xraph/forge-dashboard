/**
 * Saves text as a file. Report exports go out this way and no other: the
 * HTML export is never injected into the page, and the markdown export, whose
 * event fields chronicle does not escape, is never rendered as markdown.
 */
export function saveFile(filename: string, contentType: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: contentType }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.rel = "noopener"
  a.click()
  // Revoked on the next turn, not this one: some browsers start the download
  // after click() returns and would find the URL already gone.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
