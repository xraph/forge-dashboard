import { createContext, useContext } from "react"
import type { ComponentType, ReactNode } from "react"

export interface PluginLinkProps {
  /** An absolute in-app path, namespace prefix included: "/@auth/users/u1". */
  to: string
  children: ReactNode
  className?: string
  "aria-label"?: string
}

/** How a navigation lands. */
export interface NavigateOptions {
  /**
   * Replace the current history entry instead of adding one.
   *
   * For a navigation that corrects where you are rather than taking you
   * somewhere new: a page whose subject was just deleted, or one tidying its
   * own URL. Back should skip the page you were moved off, not return to it.
   */
  replace?: boolean
}

/**
 * How the host turns an in-app path into a link, and how it navigates to one.
 *
 * The shell owns a router and no plugin package depends on one, which is the
 * same split `NavTree`'s `renderLink` prop already uses for the sidebar. This
 * is that split applied to links inside a page.
 */
export interface Navigation {
  Link: ComponentType<PluginLinkProps>
  navigate: (to: string, options?: NavigateOptions) => void
  /**
   * Turns a scope-relative path into a real one.
   *
   * A page writes `/users/u1` and the host decides that means
   * `/@auth/acme/users/u1?env=prod`, because only the host knows which scope
   * is mounted, which app the URL names and which of the current query
   * params are context worth carrying. A page's own params are not.
   *
   * Optional so a host predating routed context still satisfies this
   * interface; `PluginLink` falls back to using the path as written.
   */
  resolve?: (to: string) => string
}

/**
 * Whether a path is already fully addressed.
 *
 * A path starting with the scope sigil names its scope outright, so it is
 * left alone: that is how a page links ACROSS scopes, which is rare and has
 * to stay possible. Everything else is read as scope-relative, which is what
 * a page should be writing, because a page cannot know its own mount point.
 */
function isAbsolute(to: string): boolean {
  return to.startsWith("/@") || /^[a-z]+:/i.test(to)
}

const NavigationContext = createContext<Navigation | null>(null)

export function NavigationProvider({
  value,
  children,
}: {
  value: Navigation
  children: ReactNode
}) {
  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  )
}

/**
 * A link to somewhere else in the dashboard.
 *
 * `to` is SCOPE-RELATIVE: write `/users/u1`, not `/@auth/users/u1`. A page
 * cannot know its own mount point, and once an app slug sits in the path a
 * hardcoded `/@auth/...` is wrong in the worst way available: it resolves,
 * it renders, and it is about a different app than the one you were reading.
 * A path that starts with the sigil is taken as already addressed and passed
 * through, which is how a page links across scopes.
 *
 * Falls back to a plain anchor when no host has provided a router, which is
 * what happens in a unit test and in any standalone render. The fallback is
 * deliberate rather than a stub: the href is correct, the element is a real
 * link, and a test asserting on `href` reads the same either way.
 *
 * Inside the shell it resolves to the host's router link, and that is the whole
 * point. A plain anchor in a single-page app is a full document load: it
 * refetches capabilities, remounts every plugin and throws away the query
 * store, which for a "Details" link on a table row is an enormous amount of
 * work to look at one user. Twenty-one call sites across two plugins were doing
 * exactly that before this existed.
 */
export function PluginLink({
  to,
  children,
  className,
  ...rest
}: Omit<PluginLinkProps, "children"> & { children?: ReactNode }) {
  const nav = useContext(NavigationContext)
  const href = nav?.resolve && !isAbsolute(to) ? nav.resolve(to) : to

  if (nav) {
    const Link = nav.Link
    return (
      <Link to={href} className={className} {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  )
}

/**
 * Navigate imperatively, for the cases a link cannot express.
 *
 * There is one honest use for this and it is narrow: a page whose subject has
 * just been deleted has nowhere to stay. Everything else should be a link, so
 * that middle-clicking it opens a tab and hovering it shows a destination.
 *
 * Pass `{ replace: true }` when the move corrects where you are rather than
 * taking you somewhere new, so Back skips the page you were moved off.
 *
 * Outside a host this assigns `location.href`, or calls `location.replace`
 * for a replace, which is correct rather than merely tolerable: a standalone
 * render has no router to ask.
 */
export function useNavigateTo(): (
  to: string,
  options?: NavigateOptions
) => void {
  const nav = useContext(NavigationContext)
  if (nav) {
    const { navigate, resolve } = nav
    return (to: string, options?: NavigateOptions) => {
      const target = resolve && !isAbsolute(to) ? resolve(to) : to
      // A one-argument call reaches the host as one, exactly as it did before
      // options existed, so nothing watching `navigate` sees a new shape.
      if (options) navigate(target, options)
      else navigate(target)
    }
  }
  return (to: string, options?: NavigateOptions) => {
    if (options?.replace) {
      window.location.replace(to)
      return
    }
    window.location.href = to
  }
}
