import { useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@forge-go/dashboard-kit/components/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"
import type {
  NavNode,
  NavTreeProps,
} from "@forge-go/dashboard-kit/components/nav-tree"

function NavigationBranch({
  item,
  currentPath,
  search = "",
  renderLink,
}: Pick<NavTreeProps, "currentPath" | "search" | "renderLink"> & {
  item: NavNode
}) {
  const { state, isMobile } = useSidebar()
  const active =
    item.href === currentPath ||
    !!item.children?.some((child) => child.href === currentPath)
  const [choice, setChoice] = useState<{ path: string; open: boolean } | null>(
    null
  )
  const open = choice?.path === currentPath ? choice.open : active

  if (!item.children?.length) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          tooltip={item.label}
          isActive={active}
          render={renderLink(item, `${item.href}${search}`)}
        >
          {item.icon}
          <span>{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  const destinations = item.children.some((child) => child.href === item.href)
    ? item.children
    : [{ ...item, children: undefined }, ...item.children]

  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton aria-label={item.label} isActive={active} />
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="min-w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
              {destinations.map((child, index) => (
                <DropdownMenuItem
                  key={`${index}:${child.href}`}
                  render={renderLink(child, `${child.href}${search}`)}
                  aria-current={child.href === currentPath ? "page" : undefined}
                >
                  {child.icon}
                  <span>{child.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    )
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => setChoice({ path: currentPath, open: value })}
      render={<SidebarMenuItem />}
    >
      <CollapsibleTrigger
        render={<SidebarMenuButton aria-label={item.label} isActive={active} />}
      >
        {item.icon}
        <span>{item.label}</span>
        <ChevronRightIcon
          className={`ml-auto transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-closed:hidden">
        <SidebarMenuSub>
          {destinations.map((child, index) => (
            <SidebarMenuSubItem key={`${index}:${child.href}`}>
              <SidebarMenuSubButton
                isActive={child.href === currentPath}
                render={renderLink(child, `${child.href}${search}`)}
              >
                <span>{child.label}</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Nested navigation with flyout destinations when the sidebar is an icon rail. */
export function NavMain({ groups, ...props }: NavTreeProps) {
  const activePath =
    groups
      .flatMap((group) =>
        group.items.flatMap((item) => [item, ...(item.children ?? [])])
      )
      .filter(
        (item) =>
          item.href === props.currentPath ||
          (item.href !== "/" && props.currentPath.startsWith(`${item.href}/`))
      )
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ??
    props.currentPath

  return (
    <>
      {groups.map((group, index) => (
        <SidebarGroup key={group.label ?? index}>
          {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
          <SidebarMenu>
            {group.items.map((item, itemIndex) => (
              <NavigationBranch
                key={`${itemIndex}:${item.href}`}
                item={item}
                {...props}
                currentPath={activePath}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  )
}
