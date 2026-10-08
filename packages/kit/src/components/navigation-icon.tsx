import {
  Activity,
  Archive,
  Bell,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Braces,
  Building2,
  CheckCheck,
  CircleUserRound,
  ClipboardCheck,
  Code,
  Columns2,
  Database,
  FileText,
  Fingerprint,
  Flag,
  GitBranch,
  Globe,
  Grid2X2,
  HeartPulse,
  History,
  House,
  KeyRound,
  Layers,
  Library,
  ListChecks,
  ListOrdered,
  LockKeyhole,
  Mail,
  MessagesSquare,
  Monitor,
  Network,
  Package,
  Play,
  Plug,
  Rocket,
  ScanSearch,
  ScrollText,
  Search,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Tags,
  Terminal,
  Users,
  Wallet,
  Webhook,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"

const icons: Record<string, LucideIcon> = {}
for (const [names, icon] of [
  ["overview|home|dashboard", House],
  ["agents|agent|cortex|workers", Bot],
  ["personas|persona|profile|profiles", CircleUserRound],
  ["skills|skill|capabilities", Sparkles],
  ["traits|trait|models|model", Brain],
  ["behaviors|behavior|triggers", Zap],
  ["chat|agent messaging|conversations|messages", MessagesSquare],
  ["playground|compare|comparison", Columns2],
  ["runs|orchestration runs|executions", Play],
  ["pending approvals|approvals|checkpoints", ClipboardCheck],
  ["sessions and memory|memory|sessions", Database],
  ["orchestrations|workflows|pipelines", Workflow],
  ["tools|tool", Wrench],
  ["knowledge|collections|library", Library],
  ["safety profiles|policies|shield|warden|security", ShieldCheck],
  ["safety scans|scans|retrieval", ScanSearch],
  ["settings|runtime settings|config|configuration|setup", Settings2],
  ["workloads|instances|servers|upstreams", Server],
  ["templates|documents|reports|forms|signup forms", FileText],
  ["datacenters|tenants|organizations", Building2],
  ["providers|plugins|extensions|integrations|connections", Plug],
  ["deployments|releases", Rocket],
  ["network|routes|relations|topology", Network],
  ["secrets|credentials|keys|api keys|keysmith", KeyRound],
  ["events|audit log|audit|logs|logs & activity|chronicle", ScrollText],
  ["health|services & health", HeartPulse],
  ["users|members|teams|roles|app roles", Users],
  ["permissions|grants|access|authsome|identity", Fingerprint],
  ["devices", Monitor],
  ["apps|applications|resource types|resources|services", Boxes],
  ["environments|environments & regions|regions", Globe],
  ["webhooks", Webhook],
  ["features|flags", Flag],
  ["billing|plans|subscriptions|invoices|payments|ledger", Wallet],
  ["notifications|alerts|herald", Bell],
  ["email|mail|dispatch", Mail],
  ["suites|tests|evaluations|sentinel", ListChecks],
  ["baselines|history|activity log", History],
  ["metrics|usage|activity|traffic|observe", Activity],
  ["traces|chunks|overlays|prompt overlays", Layers],
  ["schema|schemas|api explorer", Code],
  ["assignments|check log|decisions", CheckCheck],
  ["archives|erasures|retention", Archive],
  ["packages|artifacts|trove", Package],
  ["jobs|queue|queues|tasks", ListOrdered],
  ["tags|labels", Tags],
  ["search", Search],
  ["versions|branches|repositories", GitBranch],
  ["console|terminal", Terminal],
  ["guides|documentation|weave", BookOpen],
  ["bastion|firewall", Shield],
  ["locks|lock", LockKeyhole],
  ["forge|ctrlplane", Braces],
] as [string, LucideIcon][]) {
  for (const name of names.split("|")) icons[name] = icon
}

/** Default navigation glyphs for destinations whose plugin does not supply one. */
export function NavigationIcon({
  label,
  href = "",
}: {
  label: string
  href?: string
}) {
  const name = label.trim().toLowerCase()
  const destination =
    href
      .split(/[?#]/)[0]
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/^@/, "")
      .replaceAll("-", " ") ?? ""
  const Icon = icons[name] ?? icons[destination] ?? Grid2X2
  return <Icon aria-hidden="true" className="size-4 shrink-0" />
}

/** Keep explicit plugin icons, including those on nested destinations. */
export function withNavigationIcons(node: NavNode): NavNode {
  return {
    ...node,
    icon: node.icon ?? <NavigationIcon label={node.label} href={node.href} />,
    children: node.children?.map(withNavigationIcons),
  }
}
