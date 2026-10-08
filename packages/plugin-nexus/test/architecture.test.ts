import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { expect, it } from "vitest"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src")
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : []
  })
}
const files = new Map(
  sources(root).map((path) => [
    path,
    ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true
    ),
  ])
)
it("keeps numeric decimal coercion inside chart adapters", () => {
  const failures: string[] = []
  for (const [path, source] of files) {
    if (path.includes("/charts/")) continue
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        /^(Number|parseFloat)$/.test(node.expression.getText(source))
      )
        failures.push(path)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(failures).toEqual([])
})
function imports(path: string): string[] {
  return (
    files.get(path)?.statements.flatMap((node) => {
      if (
        !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
        !node.moduleSpecifier ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        return []
      if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly)
        return []
      const specifier = node.moduleSpecifier.text
      if (!specifier.startsWith(".")) return [specifier]
      const base = resolve(dirname(path), specifier)
      return [
        [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          `${base}/index.ts`,
          `${base}/index.tsx`,
        ].find((candidate) => files.has(candidate)) ?? base,
      ]
    }) ?? []
  )
}
function reachesCharts(path: string, visited = new Set<string>()): boolean {
  if (visited.has(path)) return false
  visited.add(path)
  return imports(path).some(
    (target) =>
      target.includes("/charts/") ||
      target.endsWith("/components/chart") ||
      target === "recharts" ||
      reachesCharts(target, visited)
  )
}
it("loads charts only through the lazy usage route", () => {
  expect(reachesCharts(join(root, "pages/usage.tsx"))).toBe(true)
  expect(reachesCharts(join(root, "index.tsx"))).toBe(false)
  for (const path of files.keys())
    if (path.includes("/pages/") && !path.endsWith("/usage.tsx"))
      expect(reachesCharts(path)).toBe(false)
})
