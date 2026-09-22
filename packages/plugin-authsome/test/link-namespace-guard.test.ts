import { describe, expect, it } from "vitest"

/**
 * Every `PluginLink`/`useNavigateTo` call site in this package was migrated
 * off a hardcoded `/@auth/...` path in Task 5, in favour of a scope-relative
 * one the host resolves against the app segment actually in the URL. A
 * leftover `/@auth` literal is the one mistake nothing else catches: it
 * still resolves, the page still renders, and it silently answers about
 * whichever app happens to be in the cookie rather than the one in the URL.
 *
 * Reading the sources through `fs`/`path` would be simpler, but this
 * package's own `tsconfig.json` carries no Node types (see its `lib` and the
 * absence of `@types/node`), so `fs` passes `vitest run` and fails
 * `tsc --noEmit`, and this package's own `typecheck` script must stay green.
 * `import.meta.glob` is a Vite build-time construct that vitest implements
 * at test-run time, so it works under both commands, but this package's own
 * `tsconfig.json` also carries no `vite/client` types (nothing else here
 * needs them), so `ImportMeta` is widened locally rather than globally -
 * a local cast is a smaller change than adding a `types` entry that every
 * other file in this package would then be typechecked against too.
 */
interface GlobbingImportMeta {
  glob: (
    pattern: string,
    options: { query?: string; eager?: boolean },
  ) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob(
  "../src/**/*.{ts,tsx}",
  { query: "?raw", eager: true },
)

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

describe("PluginLink call sites carry no hardcoded /@auth prefix", () => {
  const files = Object.entries(modules)

  it("actually found this package's source files", () => {
    // A guard that globbed zero files would pass forever and prove nothing.
    // Twenty-some source files live under src/ today; a low floor keeps this
    // from breaking on an unrelated reorganisation while still catching an
    // empty match.
    expect(files.length).toBeGreaterThan(10)
  })

  it("contains no /@auth literal anywhere in src", () => {
    const offenders = files
      .filter(([, mod]) => sourceOf(mod).includes("/@auth"))
      .map(([path]) => path)

    expect(
      offenders,
      `hardcoded "/@auth" literal found in: ${offenders.join(", ")}. ` +
        `PluginLink and useNavigateTo now take a scope-relative path ` +
        `("/users/u1", not "/@auth/users/u1") and the host resolves it ` +
        `against whichever app is actually in the URL.`,
    ).toEqual([])
  })
})
