# forge-dashboard

The frontend half of the Forge admin dashboard. The Go half lives in the `forge`
repo and it serves data only. Nothing on the server decides what the UI looks
like any more, so an extension that wants a page in the dashboard ships its own
React code, declares it with `definePlugin`, and reaches its own Go intents
through a client permanently scoped to its extension name, which means it cannot
read another extension's data by typo.

pnpm workspaces, Turborepo on top.

## Packages

- `packages/kit`: the component library, vendored from the shadcn registry.
  Keep it close to upstream and do not hand-edit `src/components`.
- `packages/runtime`: `ForgeDashboardProvider` and `useDashboardConfig`, which
  read the injected config without breaking SSR, plus `PluginErrorBoundary`.
  Small on purpose.
- `packages/plugin`: `definePlugin`, `createScopedClient`, the `useQuery` hook,
  `resolvePluginState` and the panels it renders. This is the one you import
  from an extension.
- `apps/playground`: a Vite host that mounts a real plugin against a real Go
  server. Not a demo harness with fake data.

## Running it

```bash
pnpm install
pnpm dev      # playground on http://localhost:5173
pnpm test
pnpm build
```

You also get `pnpm lint`, `pnpm format` and `pnpm typecheck`, and CI runs the
same gates on every push and pull request.

The playground needs a Forge server on `http://localhost:8099` with the dashboard
extension enabled. Vite proxies `/dashboard` to it, so every request stays
same-origin, which means there is no CORS to configure and no cookie you have to
mark `SameSite=None` just to get a dev loop working. Start the Go side first.
Without it you'll get the host's error state, which is correct behaviour and not
much to look at.

## How a plugin works

`definePlugin` takes an `extension` name, a route table and an optional nav
list. The extension name is the join key: it has to match the Go contributor
the plugin belongs to, because that is how the host finds you in the server's
capabilities response.

Validation runs at import time, not at render: a route path that does not start
with `/`, or a missing `extension`, throws while the module is still loading, so
a plugin with a bad shape breaks the build that includes it instead of producing
a blank panel in somebody's dashboard three deploys later. Break the build. That
is the whole rule.

The host then resolves each plugin into one of four states, and this is the
part worth understanding before you write one:

- **hidden**: the server does not report your extension at all. Render nothing.
  No nav entry, no route, no error. An extension that is not installed is a
  normal state.
- **mismatch**: the extension is there but its version falls outside your
  `requires` range. You get `MismatchPanel` naming both versions.
- **setup**: the extension is there and the version is fine, but it reports
  `configured: false`. Your own `setup` component renders if you gave one,
  otherwise `SetupPanel`.
- **ready**: your routes mount.

Only the last one renders your code. `requires` accepts caret ranges and exact
versions and nothing else. Anything it cannot parse counts as "cannot check",
never as a mismatch, because refusing to render over an unreadable version
string is worse than rendering.

`ScopedClient` has `query()` and no `command()`. That is deliberate. See
[`packages/plugin/docs/command-handshake.md`](./packages/plugin/docs/command-handshake.md)
for what a working `command()` has to do and why the half-working one was
removed.

### Auth is an intent, not a component

An auth plugin declares intents, nothing else:

```ts
auth: {
  intents: {
    config: "auth.config",
    signIn: "auth.login",
    signOut: "auth.logout",
    forgotPassword: "auth.forgotPassword",
    resetPassword: "auth.resetPassword",
    signUp: "auth.signup",
    setupStatus: "auth.setupStatus",
    completeSetup: "auth.setup",
  },
},
```

That's the whole contract. The plugin ships no `SignIn` component, no form, no
pixel of its own. It names the Go intents that carry out sign-in, and the host
is the one that calls them. A plugin never provides auth UI, full stop.

The host owns `/login`, `/forgot-password`, `/reset-password`, `/signup` and
`/setup`. Which of those actually exist depends on which intents the provider
declared. Leave `signUp` off the intents object and there is no `/signup`
route, and no link anywhere that points at one. An undeclared capability
produces silence, not a broken page.

A host application, and only a host application, can swap in its own screens,
through `authScreens` on `defineForgeDashboard`:

```ts
export const forge = defineForgeDashboard({
  mountPath: "/forge",
  plugins: [corePlugin, streamingPlugin, authsomePlugin],
  authScreens: {
    signIn: AuthsomeSignIn,
    forgotPassword: AuthsomeForgot,
    resetPassword: AuthsomeReset,
  },
})
```

Name three slots and the other two fall back to the built-in defaults, each
one independently. The distinction underneath this option is the whole point
of the rule above. An application choosing what its own sign-in page looks
like is ordinary product work. A plugin forcing one on every dashboard that
installs it is exactly what "plugins declare intents, never UI" exists to
stop.

Password reset is why the host has to own the routing at all. A reset link
arrives by email and gets opened on a browser that has never held a session,
so it lands cold on `/reset-password?token=...` with nobody signed in and
nothing to ask. A gate component that swaps out the whole shell has no page to
put that on. A route does.

## Bundle budget

Read [BASELINE.md](./BASELINE.md) before you add a dependency. It records the
budget and how the chunks split, measured against the architecture as it stood
at the time. The eager entry chunk is what the budget governs.
