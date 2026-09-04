# forge-dashboard

The frontend half of the Forge admin dashboard. The Go half lives in the
`forge` repo and it owns the contract. It sends you a graph of nodes, each one
naming an `intent`, and this repo decides what an intent looks like on screen.

## Packages

- `packages/runtime`: the intent registry, the graph renderer, the config
  provider and the fallbacks. No UI of its own. This is the one you'll import
  from an extension.
- `packages/kit`: the component library, vendored from the shadcn registry.
  Keep it close to upstream and do not hand-edit `src/components`.
- `apps/playground`: a Vite app that renders a hardcoded graph through the
  runtime, so you can see the thing work without a Go server running.

## How it works

The server sends a graph. Every node names an intent, a string like
`page.shell` or `organism.data-grid`, and the registry maps that string to a
React component. That's the whole mechanism. A parent invites children into a
named slot and renders them wherever it likes by calling `SlotRenderer`, so
the runtime itself never decides placement.

Extensions register their own intents at runtime under their own contributor
name, and the registry refuses anything outside that namespace, which is what
stops an extension you didn't write and didn't audit from quietly replacing a
core intent for everybody else sharing the page with it. An intent nobody has
registered yet draws a small placeholder. It does not blank the
page, because a contributor module that has not loaded yet is a normal state
and not a crash. A component that throws gets the same treatment: that one
box degrades and its siblings stay up.

## Running it

```bash
pnpm install
pnpm dev      # playground on http://localhost:5173
pnpm test
pnpm build
```

You also get `pnpm lint`, `pnpm format` and `pnpm typecheck`. All of them run
across every package, and CI runs the same four gates on every push and pull
request.

## Scope

W1 is deliberately small. There is no HTTP client, no SSE, no router and no
auth yet. `apps/playground/src/App.tsx` holds a graph literal, and W2 is what
replaces it with a real contract response. `GraphNode.data` and the
`visibleWhen` and `enabledWhen` predicates are already on the wire shape, but
nothing evaluates them yet, so do not build against them.

Read [BASELINE.md](./BASELINE.md) before you add a dependency. It records the
bundle budget and how the chunks split. The short version: the eager entry
chunk is what the budget governs, the chart and the data grid load lazily,
and the data table on its own costs more than everything eager put together.
