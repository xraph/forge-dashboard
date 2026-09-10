import { useId, useState } from "react"
import type { FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@forge-go/dashboard-kit/components/card"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"

/** One OAuth button the deployment has configured, from `auth.config`. */
export interface SocialProvider {
  id: string
  label: string
  authStartURL: string
}

/**
 * What `auth.config` answers: the shape of the sign-in form this particular
 * deployment supports.
 *
 * Every field except `passwordEnabled` is optional, and that asymmetry is the
 * point of reading the config at all. A deployment with password login turned
 * off and one OAuth provider configured must not be shown an email and
 * password box it will reject, and a deployment with no terms URL must not be
 * shown a link to a page that does not exist. `passwordEnabled` is required
 * because a config that does not answer it has told us nothing, and the safe
 * reading of nothing is "no password form" rather than "guess".
 */
export interface AuthConfig {
  passwordEnabled: boolean
  brand?: string
  signupURL?: string
  signupLabel?: string
  termsURL?: string
  privacyURL?: string
  socialProviders?: SocialProvider[]
}

/** What `auth.login` answers. `subject` is the id of whoever just signed in. */
export interface LoginResult {
  ok: boolean
  subject?: string
}

/** What `auth.logout` answers. */
export interface LogoutResult {
  ok: boolean
}

/**
 * The signed-in half of the page.
 *
 * Session state lives here, in the one page that can change it, rather than in
 * a plugin-wide store. The host mounts each route inside its own
 * `PluginProvider` and renders exactly one at a time (see
 * `apps/shell/src/host/PluginHost.tsx`), so a plugin has no subtree of its own
 * to hang a context on; a cross-page session would have to be a module-level
 * singleton. That is a real thing to build once something else needs to read
 * it - the users page gating its ban buttons on who you are, say - and
 * inventing it now would mean shipping a global whose only reader is the
 * component that writes it.
 *
 * `auth.logout` therefore lives here, next to the state it clears.
 */
function SignedIn({
  subject,
  onSignOut,
}: {
  subject: string
  onSignOut: () => void
}) {
  const logout = useCommand<LogoutResult>("auth.logout")

  async function handleSignOut() {
    // `execute` resolves with `undefined` on failure and never rejects, so the
    // resolved value is the success signal. Reading `logout.error` here would
    // read the render-before-last's state, which is still empty.
    const result = await logout.execute()
    if (result !== undefined) onSignOut()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed in</CardTitle>
        <CardDescription>
          Signed in as <span className="font-mono">{subject}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <CommandAlert error={logout.error} title="Sign out failed" />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={logout.loading}
          className={buttonVariants({ variant: "outline" })}
        >
          {logout.loading ? "Signing out…" : "Sign out"}
        </button>
      </CardContent>
    </Card>
  )
}

/** The form itself, once `auth.config` has said what it should contain. */
function LoginForm({ config }: { config: AuthConfig }) {
  const login = useCommand<LoginResult>("auth.login")
  const [subject, setSubject] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const emailId = useId()
  const passwordId = useId()

  const providers = config.socialProviders ?? []

  // LoginForm never unmounts across a sign-in/sign-out cycle (see the
  // module doc above), so clearing `subject` alone leaves whatever was typed
  // still sitting in state. The password box would then re-render on the
  // next visit pre-filled with the previous operator's password - the exact
  // thing a shared terminal must not do. The email is cleared for the same
  // reason, even though it is not a credential: a sign-out should hand back
  // a genuinely blank form.
  function handleSignOut() {
    setSubject(null)
    setEmail("")
    setPassword("")
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Without this the browser navigates away on submit and the command never
    // finishes. jsdom does not navigate, so a missing preventDefault would
    // pass every test in this package and fail on the first real click.
    event.preventDefault()

    const result = await login.execute({ email, password })
    if (result !== undefined) {
      // A deployment that answers no subject still signed us in; fall back to
      // what the operator typed rather than rendering "Signed in as
      // undefined".
      setSubject(result.subject ?? email)
    }
  }

  if (subject) {
    return <SignedIn subject={subject} onSignOut={handleSignOut} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{config.brand ?? "Sign in"}</CardTitle>
        <CardDescription>
          {config.passwordEnabled
            ? "Sign in with your email and password."
            : "This deployment does not accept password sign-in."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex max-w-sm flex-col gap-4">
        <CommandAlert error={login.error} title="Sign in failed" />

        {config.passwordEnabled && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId}>Email</Label>
              <Input
                id={emailId}
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {/*
              A native submit button, not the kit's <Button>. Base UI's button
              hard-codes type="button" on the element it renders, which is
              right for a menu trigger and wrong for the only control in a
              form: the form would never submit and Enter in either field
              would do nothing. The kit's variants still supply the styling.
            */}
            <button
              type="submit"
              disabled={login.loading}
              className={buttonVariants({ className: "w-full" })}
            >
              {login.loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {providers.length > 0 && (
          <div className="flex flex-col gap-2">
            {/*
              Anchors, not commands. An OAuth handshake is a full-page
              redirect to the provider; the contract envelope has no part in
              it, and posting a command here would start a flow the SPA cannot
              finish.
            */}
            {providers.map((provider) => (
              <a
                key={provider.id}
                href={provider.authStartURL}
                className={buttonVariants({ variant: "outline" })}
              >
                {provider.label}
              </a>
            ))}
          </div>
        )}

        {!config.passwordEnabled && providers.length === 0 && (
          <p role="status" className="text-sm text-muted-foreground">
            No sign-in method is configured for this deployment.
          </p>
        )}

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {config.signupURL && (
            <a href={config.signupURL} className="underline underline-offset-4">
              {config.signupLabel ?? "Create an account"}
            </a>
          )}
          {config.termsURL && (
            <a href={config.termsURL} className="underline underline-offset-4">
              Terms
            </a>
          )}
          {config.privacyURL && (
            <a
              href={config.privacyURL}
              className="underline underline-offset-4"
            >
              Privacy
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The sign-in page.
 *
 * The form is gated on `auth.config` rather than falling back to email and
 * password when the read fails, which is a deliberate trade. A hardcoded
 * fallback is exactly the thing the config exists to replace: it would offer
 * a password box to a deployment that has password login switched off, and
 * the operator would type credentials into a form whose command is going to
 * be refused. `QueryBoundary`'s error card carries the server's own reason
 * and a Retry button, which is the honest thing to show when we do not know
 * what this deployment accepts.
 */
export function AuthLoginPage() {
  const config = useQuery<AuthConfig>("auth.config")

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-medium">Sign in</h1>
      <QueryBoundary title="Sign-in options" query={config} skeletonRows={3}>
        {(data) => <LoginForm config={data} />}
      </QueryBoundary>
    </section>
  )
}
