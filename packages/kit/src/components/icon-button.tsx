"use client"

import type { ComponentProps } from "react"
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCheck,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clipboard,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FileUp,
  FilterX,
  GitCompareArrows,
  History,
  KeyRound,
  Link,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  Network,
  Pause,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Table2,
  Trash2,
  UnlockKeyhole,
  Upload,
  X,
  type LucideIcon,
} from "@forge-go/dashboard-kit/icons"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@forge-go/dashboard-kit/components/tooltip"

const actionIcons: [RegExp, LucideIcon][] = [
  [/^previous|^newer|^back.*page/i, ChevronLeft],
  [/^next|^older|^load more/i, ChevronRight],
  [/^back|^return/i, ArrowLeft],
  [/^move.* up$|^up$/i, ArrowUp],
  [/^move.* down$|^down$/i, ArrowDown],
  [/^swap/i, ArrowUpDown],
  [/^unpin/i, PinOff],
  [/^pin/i, Pin],
  [/^mark all.*read/i, CheckCheck],
  [/^mark.*read/i, MailCheck],
  [/^copied|^done|^make.* current$|^make default/i, Check],
  [/^copy|^clone|^duplicate|^select and copy/i, Copy],
  [/^paste|^refill/i, Clipboard],
  [/^download|^export/i, Download],
  [/^import/i, FileUp],
  [/^upload/i, Upload],
  [/^refresh|^retry|^try again|^reindex|^sync/i, RefreshCw],
  [/^reset|^undo|^revert|^roll ?back|^restore/i, RotateCcw],
  [/^clear.*filter|^all keys|^all tenants/i, FilterX],
  [/^clear|^close|^dismiss|^skip|^cancel|^end now/i, X],
  [/^delete|^remove|^purge|^discard|^forget/i, Trash2],
  [/^edit|^change|^replace/i, Pencil],
  [/^add|^new|^create|^attach|^assign/i, Plus],
  [/^compare|^review/i, GitCompareArrows],
  [/^hide key/i, EyeOff],
  [/^show.* as a chart$/i, ChartNoAxesCombined],
  [/^show.* as a table$/i, Table2],
  [/^show graph/i, Network],
  [/^show|^view/i, Eye],
  [/^hide|^collapse/i, ChevronUp],
  [/^expand/i, ChevronDown],
  [/^rotate/i, KeyRound],
  [/^disable|^deactivate/i, PowerOff],
  [/^enable|^activate|^reactivate/i, Power],
  [/^archive|^deprecate/i, Archive],
  [/^suspend|^pause/i, Pause],
  [/^revoke/i, LockKeyhole],
  [/^resume|^trust/i, UnlockKeyhole],
  [/^stop/i, Square],
  [/^replay|^run|^send test/i, Play],
  [/^resolve|^approve/i, ShieldCheck],
  [/^share|^link/i, Link],
  [/^history/i, History],
  [/^search|^look up/i, Search],
  [/^table/i, Table2],
  [/^configure|^settings/i, Settings2],
  [/^working|^loading/i, LoaderCircle],
  [/^go|^open/i, ArrowRight],
]

export type IconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "size"
> & {
  label: string
  icon?: LucideIcon
}

export function IconButton({ label, icon, ...props }: IconButtonProps) {
  const Icon =
    icon ??
    actionIcons.find(([pattern]) => pattern.test(label))?.[1] ??
    Ellipsis
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={label}
              {...props}
            />
          }
        >
          <Icon aria-hidden="true" className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
