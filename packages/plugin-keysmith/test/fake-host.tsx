import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { NavigationProvider, PluginLink } from "@forge-go/dashboard-plugin"
import type { Navigation, PluginLinkProps } from "@forge-go/dashboard-plugin"

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`
}

function searchOf(path: string): string {
  const at = path.indexOf("?")
  return at < 0 ? "" : path.slice(at)
}

/**
 * A stand-in for the shell's router, just enough of it to matter here.
 *
 * Like react-router it pushes a history entry per navigate, follows back and
 * forward through popstate, and re-renders the page on every change. Like the
 * host it builds every scope-relative link as the plugin's mount plus the
 * path plus the CURRENT search, and so does the sidebar: "Sidebar rotations"
 * is that sidebar link. A URL written behind the router's back (a bare
 * history.replaceState) leaves its search, and so that link, stale.
 */
export function FakeHost({
  onNavigate,
  onSearch,
  children,
}: {
  onNavigate: (to: string) => void
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
      navigate: (to: string) => {
        onNavigate(to)
        window.history.pushState(null, "", to)
        setPath(to)
      },
      resolve: (to: string) => `/@keysmith${to}${search}`,
    }),
    [onNavigate, search],
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
