/** "a, b ,, c" becomes ["a", "b", "c"]. */
export function parseTags(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "")
}
