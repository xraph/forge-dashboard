# How the shell gets its mount path

The Go handler that serves this shell lives in the forge repo, at
`extensions/dashboard/shell_handlers.go`. Read its doc comments for the whole
story. What follows is only the part this repo has to keep its end of.

This file used to carry the full description, written in W3 when the handler
was deleted and there was nowhere else for it to live. The handler exists
again, so the description belongs beside the code and not here.

## What the handler does to index.html

Two rewrites, on the bytes, before the response is written.

It injects `window.__FORGE_DASHBOARD__` just before `</head>`, or prepends it
when there is no `</head>`. `packages/runtime/src/config.tsx` reads it through
`configFromWindow()`. The Go side sets `basePath`, `contractBase`, `shellBase`,
`authEnabled` and `loginPath`. Everything else in `DashboardConfig`, including
`streamBase`, `loginOp` and `loginContributor`, is defaulted client-side from
`basePath`, so the bootstrap staying small is fine and intended.

It rewrites `"./assets/` to `"{basePath}/ui/static/assets/`.

## What this repo owes it

Keep `base: "./"` in `apps/shell/vite.config.ts`.

An absolute base bakes the default mount into two places, the asset URLs in
`index.html` and Vite's preload resolver for lazy chunks, and both are then
correct only at `/dashboard`. Relative base fixes the chunks, because the
preload resolver becomes importer-relative and resolves against wherever the
shell actually lives.

Relative base does not fix `index.html`, which is why the Go rewrite exists.
The same HTML answers every path under the shell prefix, so `"./assets/"` would
resolve against `/_forge/dashboard/ui` on the entry page and against
`/_forge/dashboard/ui/metrics` on a deep link.

That rewrite cannot be moved into the bootstrap script, and you will be tempted
to try. The browser resolves `src` and `href` while parsing the document, long
before any script of ours runs. By the time a bootstrap executes, the requests
are already out and already 404ing.
