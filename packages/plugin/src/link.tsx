import { createContext, useContext } from "react"
import type { ComponentType, ReactNode } from "react"

export interface PluginLinkProps {
  /** An absolute in-app path, namespace prefix included: "/@auth/users/u1". */
  to: string
  children: ReactNode
  className?: string
  "aria-label"?: string
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
  navigate: (to: string) => void
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
export function PluginLink({ to, children, className, ...rest }: PluginLinkProps) {
  const nav = useContext(NavigationContext)
  if (nav) {
    const Link = nav.Link
    return (
      <Link to={to} className={className} {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <a href={to} className={className} {...rest}>
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
 * Outside a host this assigns `location.href`, which is correct rather than
 * merely tolerable: a standalone render has no router to ask.
 */
export function useNavigateTo(): (to: string) => void {
  const nav = useContext(NavigationContext)
  if (nav) return nav.navigate
  return (to: string) => {
    window.location.href = to
  }
}
