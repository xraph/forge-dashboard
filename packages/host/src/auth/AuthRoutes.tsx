import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router"
import type { AuthIntents } from "@forge-go/dashboard-plugin"
import { authRoutesFor } from "./routes"
import type { AuthScreens } from "./routes"
import { defaultAuthScreens } from "./screens"
import { safeNext } from "./next-param"

export interface AuthRoutesProps {
  intents: AuthIntents
  basename: string
  screens?: AuthScreens
  onAuthenticated: () => void
}

/**
 * Every screen a signed-out visitor can reach, and the rule that catches
 * everything else.
 *
 * Mounted outside HostShell, so there is no sidebar and no header here. The
 * catch-all carries the attempted path forward as `next`, which is what puts
 * somebody back where they were headed once they sign in.
 */
export function AuthRoutes({
  intents,
  basename,
  screens = {},
  onAuthenticated,
}: AuthRoutesProps) {
  const location = useLocation()
  const [params] = useSearchParams()
  const routes = authRoutesFor(intents, screens, defaultAuthScreens)

  // Two different values, and conflating them is the easy bug. `attempted` is
  // where this visitor was heading when they got bounced, and it only means
  // anything on the catch-all below. `next` is what a screen navigates to
  // after signing in, and it comes off the query string the catch-all wrote.
  // Compute `next` from the current location and standing on /login gives you
  // /login.
  const attempted = safeNext(`${location.pathname}${location.search}`, "/")
  const next = safeNext(params.get("next"), "/")

  return (
    <Routes>
      {routes.map(({ path, element: Screen }) => (
        <Route
          element={
            <Screen
              basename={basename}
              intents={intents}
              next={next}
              onAuthenticated={onAuthenticated}
            />
          }
          key={path}
          path={path}
        />
      ))}
      <Route
        element={
          <Navigate
            replace
            to={`/login?next=${encodeURIComponent(attempted)}`}
          />
        }
        path="*"
      />
    </Routes>
  )
}

/**
 * Sends a signed-in visitor off an auth URL and back where they were headed.
 *
 * Rendered by PluginHost before the shell, because signing in does not change
 * the address bar: the session flips to signedIn while the browser is still on
 * /login, and the shell has no route for that.
 */
// basename is part of the shared shape callers pass alongside AuthRoutes's
// own basename prop; this redirect has no link to prefix with it, but
// keeping the field here means PluginHost does not need a special case for
// this one screen.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SignedInRedirect(_props: { basename: string }) {
  const [params] = useSearchParams()
  return <Navigate replace to={safeNext(params.get("next"), "/")} />
}
