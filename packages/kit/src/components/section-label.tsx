import {
  SidebarGroupLabel,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"

/**
 * A section heading in the secondary sidebar, copied from TwinOS Studio's
 * SidebarSectionLabel. Open, it is an ordinary label. Collapsed to icons, it
 * stays on screen as vertical text reading bottom to top, so you can still
 * see which section an icon belongs to. Either way it is a button that
 * toggles the sidebar.
 */
export function SectionLabel({ children }: { children: string }) {
  const { isMobile, openMobile, state, toggleSidebar } = useSidebar()
  const expanded = isMobile ? openMobile : state === "expanded"
  const action = `${expanded ? "Collapse" : "Expand"} ${children}`

  return (
    <SidebarGroupLabel
      aria-expanded={expanded}
      aria-label={action}
      className="w-full cursor-pointer justify-start text-start hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:max-h-48 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:truncate group-data-[collapsible=icon]:rotate-180 group-data-[collapsible=icon]:py-2 group-data-[collapsible=icon]:opacity-100 group-data-[collapsible=icon]:[writing-mode:vertical-rl]"
      onClick={toggleSidebar}
      render={<button type="button" />}
      title={action}
    >
      {children}
    </SidebarGroupLabel>
  )
}
