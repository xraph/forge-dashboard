#!/usr/bin/env node
// Prints a JSON array of every package under packages/ that goes to npm, each
// one after the workspace packages it depends on. release.yml hands this
// straight to xraph/workflows' npm-publish.yml, so a new package ships with
// the next release without anyone adding it to a list.
//
// A package is published unless its package.json says "private": true.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const sections = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
]

const packages = new Map()
for (const entry of readdirSync(join(root, "packages"), {
  withFileTypes: true,
})) {
  const dir = `packages/${entry.name}`
  const file = join(root, dir, "package.json")
  if (!entry.isDirectory() || !existsSync(file)) continue
  const manifest = JSON.parse(readFileSync(file, "utf8"))
  if (manifest.private || !manifest.name) continue
  packages.set(manifest.name, { dir, manifest })
}

const order = []
const state = new Map()

function visit(name, trail) {
  if (state.get(name) === "done") return
  if (state.get(name) === "visiting") {
    throw new Error(`dependency cycle: ${[...trail, name].join(" -> ")}`)
  }
  state.set(name, "visiting")
  const { dir, manifest } = packages.get(name)
  for (const section of sections) {
    for (const dep of Object.keys(manifest[section] ?? {}).sort()) {
      if (dep !== name && packages.has(dep)) visit(dep, [...trail, name])
    }
  }
  state.set(name, "done")
  order.push(dir)
}

for (const name of [...packages.keys()].sort()) visit(name, [])

process.stdout.write(`${JSON.stringify(order)}\n`)
