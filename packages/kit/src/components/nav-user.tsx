import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@forge-go/dashboard-kit/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@forge-go/dashboard-kit/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@forge-go/dashboard-kit/components/sidebar"
import { EllipsisVerticalIcon, CircleUserRoundIcon, CreditCardIcon, BellIcon, LogOutIcon } from "lucide-react"

/**
 * Initials for the avatar fallback, derived from the name rather than
 * hardcoded. The shadcn template shipped a literal "CN" here, which is the
 * template author's initials and wrong for every user of this library.
 *
 * `[...part][0]` and not `part[0]`: string indexing returns a UTF-16 code
 * unit, so a name whose first character is astral yields half a surrogate
 * pair and renders as the replacement glyph. Spreading iterates by code
 * point. Names are the last place to assume one character is one unit.
 */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => [...part][0]!.toUpperCase())
    .join("")
}

/**
 * The avatar, which renders an image only when there is one to render.
 *
 * `avatar` is optional and an absent one draws the fallback, no request made.
 * This is not a cosmetic default: an <AvatarImage> with an empty or missing
 * src still puts a request on the wire, and this component ships in a library
 * whose consumers mount it under a path it cannot predict, so any URL it
 * invents itself is a 404 waiting to happen at somebody else's base path.
 * Pass an absolute URL, or one your own server resolves.
 */
function UserAvatar({
  user,
  className,
}: {
  user: { name: string; avatar?: string }
  className?: string
}) {
  return (
    <Avatar className={className}>
      {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
      <AvatarFallback className="rounded-lg">
        {initials(user.name)}
      </AvatarFallback>
    </Avatar>
  )
}

export function NavUser({
  user,
  onSignOut,
}: {
  user: {
    name: string
    email: string
    avatar?: string
  }
  /**
   * Runs when the sign-out item is chosen. Omit it and no sign-out item
   * renders: the dashboard may have no auth provider, and a menu item that
   * looks clickable and does nothing is worse than one that is not there.
   */
  onSignOut?: () => void
}) {
  const { isMobile } = useSidebar()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <UserAvatar user={user} className="size-8 rounded-lg grayscale" />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs text-foreground/70">
                {user.email}
              </span>
            </div>
            <EllipsisVerticalIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <UserAvatar user={user} className="size-8" />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <CircleUserRoundIcon
                />
                Account
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CreditCardIcon
                />
                Billing
              </DropdownMenuItem>
              <DropdownMenuItem>
                <BellIcon
                />
                Notifications
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {onSignOut ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSignOut}>
                  <LogOutIcon
                  />
                  Log out
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
