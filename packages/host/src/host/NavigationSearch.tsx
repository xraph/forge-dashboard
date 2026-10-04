import { useEffect, useState } from "react"
import { Link } from "react-router"
import { SearchIcon } from "@forge-go/dashboard-kit/icons"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@forge-go/dashboard-kit/components/dialog"
import type { NavGroup } from "@forge-go/dashboard-kit/components/nav-tree"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"

export function NavigationSearch({ groups, search, scopes }: { groups: NavGroup[]; search: string; scopes: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen(value => !value)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const choices = [
    ...groups.flatMap(group => group.items.flatMap(item => [item, ...(item.children ?? [])]).map(item => ({ ...item, group: group.label ?? "Pages" }))),
    ...scopes.map(scope => ({ ...scope, group: "Applications" })),
  ].filter(item => `${item.label} ${item.group}`.toLowerCase().includes(query.toLowerCase()))
  return <><Button variant="outline" className="mx-2 justify-start text-muted-foreground group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:size-8" onClick={() => setOpen(true)} aria-label="Search pages"><SearchIcon /><span className="group-data-[collapsible=icon]:hidden">Search pages...</span><kbd className="ml-auto text-[10px] group-data-[collapsible=icon]:hidden">⌘ K</kbd></Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery("") }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Search pages</DialogTitle><DialogDescription>Find a page in this application or switch applications.</DialogDescription></DialogHeader><Input autoFocus aria-label="Search dashboard pages" placeholder="Search pages..." value={query} onChange={event => setQuery(event.target.value)} /><div className="max-h-80 overflow-y-auto">
      {choices.length === 0 && <p role="status" className="py-6 text-center text-sm text-muted-foreground">No matching pages.</p>}
      {choices.map((item, index) => <Link key={`${item.href}:${index}`} to={`${item.href}${search}`} onClick={() => { setOpen(false); setQuery(""); setOpenMobile(false) }} className="flex items-center justify-between gap-4 rounded px-3 py-2 text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><span>{item.label}</span><span className="text-xs text-muted-foreground">{item.group}</span></Link>)}
    </div></DialogContent></Dialog></>
}
