import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { NavigationProvider, PluginLink } from "@forge-go/dashboard-plugin"
import type {
  NavigateOptions,
  Navigation,
  PluginLinkProps,
} from "@forge-go/dashboard-plugin"

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

function searchOf(path: string): string {
  const at = path.indexOf("?")
  return at < 0 ? "" : path.slice(at)
}

/** One navigate call, as the stand-in router received it. */
export interface Navigated {
  to: string
  replace: boolean
}

/**
 * A stand-in for the shell's router, just enough of it to matter here.
 *
 * Like react-router it pushes a history entry per navigate, or replaces the
 * current one when asked to, follows back and forward through popstate, and
 * re-renders the page on every change. Like the host it carries only context
 * params into the links it builds, and keysmith routes no context dimension,
 * so a scope-relative link is the plugin's mount plus the path and nothing
 * of the page's own query. "Sidebar rotations" is such a link.
 */
export function FakeHost({
  onNavigate,
  onSearch,
  children,
}: {
  onNavigate: (navigated: Navigated) => void
  onSearch: (search: string) => void
  children: ReactNode
}) {
  const [path, setPath] = useState(currentPath)
  useEffect(() => {
    const onPop = () => setPath(currentPath())
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const search = searchOf(path)
  useEffect(() => onSearch(search), [onSearch, search])
  const nav = useMemo<Navigation>(
    () => ({
      Link: ({ to, children: content, ...rest }: PluginLinkProps) => (
        <a href={to} {...rest}>
          {content}
        </a>
      ),
      navigate: (to: string, options?: NavigateOptions) => {
        const replace = options?.replace === true
        onNavigate({ to, replace })
        if (replace) window.history.replaceState(null, "", to)
        else window.history.pushState(null, "", to)
        setPath(to)
      },
      resolve: (to: string) => `/@keysmith${to}`,
    }),
    [onNavigate],
  )
  return (
    <NavigationProvider value={nav}>
      <nav aria-label="Sidebar">
        <PluginLink to="/rotations">Sidebar rotations</PluginLink>
      </nav>
      {children}
    </NavigationProvider>
  )
}
