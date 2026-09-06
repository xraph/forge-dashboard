# Serving the shell HTML: bootstrap config and the asset rewrite

Recorded 2026-09-05, during W3, right after `extensions/dashboard/contract/shell/`
was deleted in forge commit `69255662`. The Go handler that served that bundle's
`index.html` went with it, and it held two things W4 has to build again. Recover the
implementation from `69255662^` (the parent, `7d5b2962`), in
`extensions/dashboard/extension.go`, functions `makeShellSPAHandler` and
`makeShellStaticHandler`.

Read this before you write the W4 handler. Both pieces look like small details you
could skip, and skipping either produces a shell that loads on the default mount, is
broken on any other, and gives you no error message worth reading while you work out
why.

## 1. The `window.__FORGE_DASHBOARD__` bootstrap

The shell cannot know at build time where it is mounted. A deployment can call
`WithBasePath("/_forge/dashboard")` or sit behind a reverse proxy, and the bundle
has to work either way. So the Go handler injected an inline script just before
`</head>`:

    <script>window.__FORGE_DASHBOARD__={...};</script>

The object was built server-side and marshalled through `encoding/json`, so the
values are string-escaped even if a base path ever contains something odd. Fields
the deleted handler set:

| key | value |
|---|---|
| `basePath` | `config.BasePath` |
| `contractBase` | `config.BasePath + "/api/dashboard/v1"` |
| `shellBase` | `config.BasePath + "/ui"` |
| `authEnabled` | `config.EnableAuth` |
| `loginPath` | `config.BasePath + config.LoginPath` |
| `loginContributor` | hardcoded `"auth"` |
| `loginOp` | hardcoded `"auth.login"` |

The client read `contractBase` for its endpoint and `basePath` for the router
basename. If `</head>` was missing, and Vite output always has one, the handler
prepended the script to the whole document instead so that it still ran ahead of any
module script.

Two of those you should not copy without thinking. `loginContributor` and `loginOp`
were hardcoded to authsome's values with a comment saying deployments could override
them later, and later never came. W5 builds the login UI. Decide there whether those
belong in the bootstrap at all.

`shellBase` is a W3 casualty. Nothing serves `{base}/ui` any more, so whatever prefix
W4 picks for the artifact is the one that goes in this field.

## 2. The `"./assets/` rewrite, which cannot be deferred to the bootstrap

This is the part that will bite you.

`shell/vite.config.ts` set `base: "./"` deliberately. An absolute base gets baked
into two places, the asset URLs in `index.html` and Vite's preload resolver for
lazy chunks, and both are then correct only at the default `/dashboard` mount. A
deployment on `WithBasePath("/_forge/dashboard")` served its HTML from the new path
while the browser kept asking for `/dashboard/ui/static/assets/*`, and got a 404
for every script and stylesheet. Relative base fixes the chunks: the preload
resolver becomes importer-relative, `new URL(dep, importerUrl)`, so code-split
chunks resolve from wherever the shell actually lives.

Relative base does not fix `index.html`. The same HTML is served for every path
under the shell prefix, so `"./assets/"` resolves against `/_forge/dashboard/ui` on
the entry page and against `/_forge/dashboard/ui/metrics` on a deep link. The Go
handler rewrote it to one absolute URL:

    out := bytes.ReplaceAll(raw,
        []byte(`"./assets/`),
        []byte(`"`+e.config.BasePath+`/ui/static/assets/`))

You cannot move this into the bootstrap script. The browser resolves `src` and
`href` while parsing the document, long before any script of ours runs. By the time
your bootstrap executes, the requests are already out and already 404ing. It has to
happen in Go, on the bytes, before the response is written.

## 3. The static handler that the rewritten URLs point at

The rewrite is only half of it. Something has to serve
`{base}/<shellPrefix>/static/assets/*`. The deleted `makeShellStaticHandler` wrapped
`http.FileServer(http.FS(shellFS))`, trimmed the mount prefix off `r.URL.Path`, and
set cache headers by path: `public, max-age=31536000, immutable` for anything under
`/assets/`, because those filenames are content-hashed, and `no-cache` for
everything else so a deploy lands immediately. It cloned the request and its URL
rather than mutating the original.

Route ordering mattered. The concrete `static` segment was registered so that it won
over the SPA catch-all in the router trie, and if you get that backwards the SPA
handler cheerfully answers every asset request with `index.html`, which the browser
then tries to parse as JavaScript. You will see it in the console. It will not tell
you the routes are in the wrong order.

## What W4 owes this file

When the prebuilt shell artifact lands and a handler serves it again, come back and
either fold this into real documentation or delete it. A note describing something
that exists is worse than no note.
