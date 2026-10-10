import { useEffect, useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bell,
  Blocks,
  Box,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  FileText,
  Gauge,
  Hexagon,
  Layers,
  Mail,
  Moon,
  Network,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Terminal,
  X,
} from "lucide-react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from "@forge-go/dashboard-kit/components/card"
import { DashboardShell } from "@forge-go/dashboard-kit/components/dashboard-shell"
import type { NavNode } from "@forge-go/dashboard-kit/components/nav-tree"
import { useSidebar } from "@forge-go/dashboard-kit/components/sidebar"
import { TooltipProvider } from "@forge-go/dashboard-kit/components/tooltip"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@forge-go/dashboard-kit/components/tabs"
import { ScopePage } from "./ScopePages"
import { scopePages, previewScopes } from "./scope-data"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Switch } from "@forge-go/dashboard-kit/components/switch"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@forge-go/dashboard-kit/components/table"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@forge-go/dashboard-kit/components/sheet"
import { services, extensions, activity, routes, traces } from "./data"

const pages = [
  {
    id: "overview",
    label: "Overview",
    icon: Gauge,
    group: "Workspace",
    description: "The health and performance of your application, at a glance.",
  },
  {
    id: "services",
    label: "Services & health",
    icon: Server,
    group: "Workspace",
    description: "Inspect service health, dependencies, and resource usage.",
  },
  {
    id: "routes",
    label: "Routes",
    icon: Network,
    group: "Workspace",
    description:
      "Explore registered endpoints and the extensions that own them.",
  },
  {
    id: "metrics",
    label: "Metrics",
    icon: ChartNoAxesCombined,
    group: "Observe",
    description: "Request throughput, latency, and runtime performance.",
  },
  {
    id: "traces",
    label: "Traces",
    icon: Layers,
    group: "Observe",
    description: "Follow a request through your application.",
  },
  {
    id: "logs",
    label: "Logs & activity",
    icon: Terminal,
    group: "Observe",
    description: "Application logs and a record of administrative actions.",
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Blocks,
    group: "Manage",
    description: "The capabilities installed in your Forge application.",
  },
  {
    id: "configuration",
    label: "Configuration",
    icon: Settings2,
    group: "Manage",
    description: "Application settings and runtime configuration.",
  },
  {
    id: "kit",
    label: "Component library",
    icon: SlidersHorizontal,
    group: "Design preview",
    description:
      "Shared components, spacing, and states for the dashboard kit.",
  },
] as const

type Detail = {
  title: string
  description: string
  fields: [string, string][]
  kind?: "trace" | "service"
}
function initialPage(): string {
  const id = window.location.hash.slice(1)
  return (
    [...pages, ...scopePages].find((page) => page.id === id)?.id ?? "overview"
  )
}
function Status({ children }: { children: string }) {
  const tone = /degraded|warning|setup/i.test(children)
    ? "warn"
    : /denied|error/i.test(children)
      ? "bad"
      : "good"
  return (
    <Badge variant="outline" className={`status status-${tone}`}>
      <span className="status-dot" />
      {children}
    </Badge>
  )
}
function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={`preview-panel ${className}`}>
      <CardHeader className="panel-heading">
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      {children}
    </Card>
  )
}
function Sparkline({
  offset = 0,
  muted = false,
}: {
  offset?: number
  muted?: boolean
}) {
  const points = Array.from(
    { length: 25 },
    (_, i) =>
      `${i * 4},${24 - Math.sin(i * 1.8 + offset) * 6 - Math.cos(i * 0.7 + offset) * 5 - i * 0.4}`
  ).join(" ")
  return (
    <svg
      className={`sparkline ${muted ? "muted" : ""}`}
      viewBox="0 0 96 40"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}
function MetricStrip({ runtime = false }: { runtime?: boolean }) {
  const stats = runtime
    ? [
        ["CPU utilization", "28.4", "%", "4.2% lower", "down"],
        ["Memory in use", "384", "MB", "of 1 GB allocated", "neutral"],
        ["Goroutines", "128", "", "12 fewer", "down"],
        ["GC pause p99", "1.8", "ms", "0.4 ms lower", "down"],
      ]
    : [
        ["Total requests", "128,430", "", "12.8% higher", "up"],
        ["Response time p95", "42", "ms", "8.2% lower", "down"],
        ["Error rate", "0.08", "%", "0.02% lower", "down"],
        ["Uptime", "99.98", "%", "Over the last 30 days", "neutral"],
      ]
  return (
    <div className="metric-strip">
      {stats.map(([label, value, unit, hint, trend], index) => (
        <div className="metric" key={label}>
          <div className="metric-label">
            {label}
            <CircleHelp size={13} aria-hidden="true" />
          </div>
          <div className="metric-value">
            {value}
            <span>{unit}</span>
            <Sparkline offset={index} muted={index === 3} />
          </div>
          <div
            className={`metric-hint ${trend !== "neutral" ? "positive" : ""}`}
          >
            {trend === "up" ? (
              <ArrowUpRight size={13} />
            ) : trend === "down" ? (
              <ArrowDownRight size={13} />
            ) : null}
            {hint}
            {trend !== "neutral" && <span>vs. previous period</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
function TrafficChart({
  range,
  mode = "requests",
}: {
  range: string
  mode?: "requests" | "latency"
}) {
  const series = Array.from({ length: 81 }, (_, i) => {
    const spike = i > 47 && i < 54 ? 34 : 0
    const y =
      112 -
      Math.sin(i * 0.17) * 19 -
      Math.sin(i * 1.9) * 11 -
      (i / 80) * 48 -
      spike +
      (range === "24h" ? Math.cos(i * 0.5) * 20 : 0)
    return `${i * 8},${y}`
  }).join(" ")
  return (
    <div className="traffic-chart">
      <div className="chart-axis">
        <span>{mode === "requests" ? "1.5k" : "150 ms"}</span>
        <span>{mode === "requests" ? "1k" : "100 ms"}</span>
        <span>{mode === "requests" ? "500" : "50 ms"}</span>
        <span>0</span>
      </div>
      <div className="chart-plot">
        <svg
          viewBox="0 0 640 180"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${mode === "requests" ? "Request throughput" : "Response latency"} over ${range}, illustrative sample data`}
        >
          <defs>
            <linearGradient id={`area-${mode}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity=".17" />
              <stop
                offset="100%"
                stopColor="var(--chart-1)"
                stopOpacity=".01"
              />
            </linearGradient>
          </defs>
          {[10, 60, 110, 160].map((y) => (
            <line
              key={y}
              x1="0"
              x2="640"
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 4"
            />
          ))}
          <polyline
            points={`0,180 ${series} 640,180`}
            fill={`url(#area-${mode})`}
            stroke="none"
          />
          <polyline
            points={series}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={Array.from(
              { length: 81 },
              (_, i) =>
                `${i * 8},${145 - Math.sin(i * 0.14) * 12 - Math.cos(i * 1.2) * 4}`
            ).join(" ")}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth="1.4"
            strokeDasharray="4 4"
          />
        </svg>
        <div className="chart-times">
          {(range === "24h"
            ? ["12:00", "16:00", "20:00", "00:00", "04:00", "08:00"]
            : ["10:00", "10:10", "10:20", "10:30", "10:40", "10:50"]
          ).map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
function ServiceTable({
  compact = false,
  query = "",
  filter = "",
  onDetail,
  onClear,
}: {
  compact?: boolean
  query?: string
  filter?: string
  onDetail: (detail: Detail) => void
  onClear?: () => void
}) {
  const rows = services.filter(
    (service) =>
      `${service.name} ${service.type}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter !== "Needs attention" || service.status === "Degraded")
  )
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Latency</TableHead>
          {!compact && <TableHead>Resource usage</TableHead>}
          <TableHead>Uptime</TableHead>
          <TableHead>
            <span className="sr-only">Details</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((service) => (
          <TableRow key={service.id}>
            <TableCell>
              <button
                className="service-name"
                onClick={() =>
                  onDetail({
                    title: service.name,
                    description: service.description,
                    fields: [
                      ["Status", service.status],
                      ["Service ID", service.id],
                      ["Latency", service.latency],
                      ["Uptime", service.uptime],
                      ["Last check", "10:48:32"],
                      ["Diagnosis", service.detail],
                    ],
                    kind: "service",
                  })
                }
              >
                <span
                  className={`service-icon ${service.status === "Degraded" ? "amber" : ""}`}
                >
                  {service.type === "Database" ? (
                    <Database size={15} />
                  ) : (
                    <Box size={15} />
                  )}
                </span>
                <span>
                  {service.name}
                  <small>{service.type}</small>
                </span>
              </button>
            </TableCell>
            <TableCell>
              <Status>{service.status}</Status>
            </TableCell>
            <TableCell className="numeric">{service.latency}</TableCell>
            {!compact && (
              <TableCell>
                <div className="resource-meter">
                  <span style={{ width: `${service.load}%` }} />
                </div>
                <small>{service.load}%</small>
              </TableCell>
            )}
            <TableCell className="numeric text-muted-foreground">
              {service.uptime}
            </TableCell>
            <TableCell>
              <ChevronRight
                size={14}
                className="text-muted-foreground"
                aria-hidden="true"
              />
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={6}>
              <ZeroState
                title="No services match your filters"
                body="Try another service name or choose all services."
                illustration={<Search className="size-6" />}
                action={
                  onClear ? (
                    <Button variant="outline" onClick={onClear}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
function Filters({
  query,
  setQuery,
  placeholder,
  filter,
  setFilter,
  options,
}: {
  query: string
  setQuery: (value: string) => void
  placeholder: string
  filter: string
  setFilter: (value: string) => void
  options: string[]
}) {
  return (
    <div className="table-toolbar">
      <div className="search-field">
        <Search size={15} />
        <Input
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button aria-label="Clear search" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </div>
      <NativeSelect
        aria-label="Filter records"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      >
        {options.map((option, index) => (
          <NativeSelectOption key={option} value={index === 0 ? "" : option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
function ConfigPage({ notify }: { notify: (text: string) => void }) {
  const [name, setName] = useState("Acme API")
  const [logging, setLogging] = useState(true)
  const [tracing, setTracing] = useState(true)
  return (
    <div className="settings-layout">
      <div className="settings-intro">
        <Settings2 size={22} />
        <h2>Application</h2>
        <p>
          Review the identity and observability settings for this environment.
        </p>
        <Badge variant="outline">Proposed core page</Badge>
      </div>
      <Panel
        title="General settings"
        subtitle="Changes in this preview stay in this tab."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            notify("Preview settings saved for this tab.")
          }}
        >
          <div className="settings-row">
            <label htmlFor="app-name">
              Application name
              <small>Shown in navigation and system reports.</small>
            </label>
            <Input
              id="app-name"
              value={name}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="settings-row">
            <label htmlFor="environment">
              Environment<small>The deployment you are inspecting.</small>
            </label>
            <Input id="environment" value="production" readOnly />
          </div>
          <div className="settings-row">
            <label htmlFor="logging">
              Structured logging
              <small>Include request context in application logs.</small>
            </label>
            <Switch
              id="logging"
              checked={logging}
              onCheckedChange={setLogging}
            />
          </div>
          <div className="settings-row">
            <label htmlFor="tracing">
              Request tracing
              <small>Capture timing across services and extensions.</small>
            </label>
            <Switch
              id="tracing"
              checked={tracing}
              onCheckedChange={setTracing}
            />
          </div>
          <div className="settings-row">
            <label htmlFor="level">
              Log level<small>Minimum severity to collect.</small>
            </label>
            <NativeSelect id="level" defaultValue="Info">
              <NativeSelectOption>Debug</NativeSelectOption>
              <NativeSelectOption>Info</NativeSelectOption>
              <NativeSelectOption>Warning</NativeSelectOption>
              <NativeSelectOption>Error</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="panel-footer">
            <span>Sample configuration</span>
            <Button type="submit">Save preview changes</Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
function KitPage({ notify }: { notify: (text: string) => void }) {
  const [enabled, setEnabled] = useState(true)
  return (
    <div className="kit-grid">
      <Panel
        title="Actions"
        subtitle="Compact controls with a clear primary action."
      >
        <div className="kit-samples">
          <Button onClick={() => notify("Primary action selected.")}>
            Primary action
            <ArrowRight />
          </Button>
          <Button
            variant="outline"
            onClick={() => notify("Secondary action selected.")}
          >
            Secondary
          </Button>
          <Button
            variant="ghost"
            onClick={() => notify("Ghost action selected.")}
          >
            Ghost
          </Button>
          <Button disabled>Disabled</Button>
          <Button
            variant="destructive"
            onClick={() =>
              notify("Destructive style sample. No data was deleted.")
            }
          >
            Delete
          </Button>
        </div>
      </Panel>
      <Panel
        title="Status & metadata"
        subtitle="Color indicates state; text explains it."
      >
        <div className="kit-samples">
          <Status>Healthy</Status>
          <Status>Degraded</Status>
          <Status>Error</Status>
          <Badge variant="secondary">v0.8.2</Badge>
          <Badge variant="outline">Production</Badge>
        </div>
      </Panel>
      <Panel
        title="Inputs & preferences"
        subtitle="Visible labels and clear focus states."
      >
        <div className="kit-inputs">
          <label htmlFor="kit-input">Service name</label>
          <Input id="kit-input" placeholder="Search your services" />
          <label htmlFor="kit-invalid">Endpoint URL</label>
          <Input
            id="kit-invalid"
            aria-invalid="true"
            aria-describedby="kit-error"
            defaultValue="not-a-url"
          />
          <small id="kit-error" className="text-destructive">
            Enter a URL starting with https://.
          </small>
          <label className="switch-label" htmlFor="kit-switch">
            Enable notifications
            <Switch
              id="kit-switch"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </label>
        </div>
      </Panel>
      <Panel
        title="Type & color"
        subtitle="Inter for the interface. Monospace for identifiers."
      >
        <div className="type-samples">
          <h3>Application overview</h3>
          <p>Check system health and inspect your services.</p>
          <code>core-contract / services.list</code>
          <div className="swatches">
            {[
              "--foreground",
              "--muted-foreground",
              "--chart-1",
              "--success",
              "--warning",
              "--destructive",
            ].map((color) => (
              <span
                key={color}
                title={color}
                style={{ background: `var(${color})` }}
              />
            ))}
          </div>
        </div>
      </Panel>
      <Panel
        title="Empty state"
        subtitle="A useful next step when there is no data."
      >
        <ZeroState
          title="No matching traces"
          body="Widen the time range or remove a filter."
          illustration={<Search className="size-6" />}
          action={
            <Button
              variant="outline"
              onClick={() =>
                notify("Filters cleared in this component sample.")
              }
            >
              Clear filters
            </Button>
          }
        />
      </Panel>
      <Panel
        title="Service row"
        subtitle="A shared table pattern with a detail drawer."
      >
        <ServiceTable
          compact
          query="postgres"
          onDetail={() =>
            notify("PostgreSQL is healthy. Sample response time: 4 ms.")
          }
        />
      </Panel>
    </div>
  )
}

export function DashboardPreview() {
  return (
    <TooltipProvider>
      <div className="preview-shell">
        <PreviewContent />
      </div>
    </TooltipProvider>
  )
}

function PreviewLink({
  node,
  href,
  page,
  navigate,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  node: NavNode
  href: string
  page: string
  navigate: (href: string) => void
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <a
      {...props}
      href={`#${href}`}
      aria-current={href === page ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault()
        navigate(href)
        setOpenMobile(false)
      }}
    >
      {node.icon}
      <span>{node.label}</span>
    </a>
  )
}

function PreviewContent() {
  const [page, setPage] = useState(initialPage)
  const [dark, setDark] = useState(false)
  const [range, setRange] = useState("1h")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("")
  const [tab, setTab] = useState("Application logs")
  const [detail, setDetail] = useState<Detail | null>(null)
  const [toast, setToast] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [globalQuery, setGlobalQuery] = useState("")
  const activeScope = page.startsWith("/@auth/")
    ? "auth"
    : page.startsWith("/@streaming/")
      ? "streaming"
      : undefined
  const scopePage = scopePages.find((item) => item.id === page)
  const current =
    scopePage ?? pages.find((item) => item.id === page) ?? pages[0]
  const scopeLabel =
    previewScopes.find((scope) => scope.id === activeScope)?.label ?? "Forge"
  const visiblePages = activeScope
    ? scopePages.filter((item) => item.id.startsWith(`/@${activeScope}/`))
    : pages
  const sections = [...new Set(visiblePages.map((item) => item.group))].filter(
    (group) => group !== "Design preview"
  )
  const groups = [
    ...sections.map((group) => ({
      label: group,
      items: visiblePages
        .filter((item) => item.group === group)
        .map((item) => ({
          label: item.label,
          href: item.id,
          icon: <item.icon />,
        })),
    })),
    {
      label: "Developer tools",
      items: [
        {
          label: "Component library",
          href: "kit",
          icon: <SlidersHorizontal />,
        },
      ],
    },
  ]
  useEffect(() => {
    const onHash = () => {
      setPage(initialPage())
      setQuery("")
      setFilter("")
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(""), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  function navigate(id: string) {
    window.location.assign(`#${id}`)
    setPage(id)
    setQuery("")
    setFilter("")
    setSearchOpen(false)
  }
  function exportSnapshot() {
    const blob = new Blob(
      [JSON.stringify({ sample: true, page, services, extensions }, null, 2)],
      { type: "application/json" }
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "forge-preview-snapshot.json"
    link.click()
    URL.revokeObjectURL(url)
    setToast("Sample snapshot exported.")
  }
  const matched = (text: string) =>
    text.toLowerCase().includes(query.toLowerCase())
  const rangePicker = (
    <Tabs value={range} onValueChange={(value) => setRange(String(value))}>
      <TabsList aria-label="Chart time range">
        <TabsTrigger value="1h">1h</TabsTrigger>
        <TabsTrigger value="24h">24h</TabsTrigger>
      </TabsList>
    </Tabs>
  )
  const extensionIcons = {
    auth: ShieldCheck,
    stream: AudioLines,
    audit: FileText,
    shield: ShieldCheck,
    box: Box,
    mail: Mail,
  }
  return (
    <>
      <a
        className="skip-link"
        href="#preview-main"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById("preview-main")?.focus()
        }}
      >
        Skip to content
      </a>
      <DashboardShell
        scopes={previewScopes}
        scopeHome={{
          label: "Forge",
          icon: <Hexagon />,
          onSelect: () => navigate("overview"),
        }}
        activeScopeId={activeScope}
        onScopeSelect={(id) => navigate(`/@${id}/`)}
        groups={groups}
        currentPath={page}
        renderLink={(node, href) => (
          <PreviewLink
            node={node}
            href={href}
            page={page}
            navigate={navigate}
          />
        )}
        user={{ name: "Rex Raphael", email: "rex@example.com" }}
        title={current.label}
        scope={scopeLabel}
        context={
          <Badge
            variant="outline"
            className="group-data-[collapsible=icon]:hidden"
          >
            Acme API
          </Badge>
        }
        searchControl={
          <Button
            variant="outline"
            className="w-full justify-start text-muted-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 [&>kbd]:group-data-[collapsible=icon]:hidden [&>span]:group-data-[collapsible=icon]:sr-only"
            onClick={() => setSearchOpen(true)}
          >
            <Search />
            <span className="flex-1 text-left">Search pages...</span>
            <kbd className="text-xs">⌘ K</kbd>
          </Button>
        }
        actions={
          <div className="topbar-actions">
            <Badge variant="outline" className="sample-badge">
              Design preview
            </Badge>
            <span className="environment">
              <span className="status-dot" />
              Production
            </span>
            <span className="topbar-divider" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="View notifications"
              onClick={() =>
                setDetail({
                  title: "Notifications",
                  description: "One service needs attention.",
                  fields: [
                    [
                      "Redis",
                      "Latency exceeded 100 ms at 10:42. Inspect Services & health for details.",
                    ],
                  ],
                })
              }
            >
              <Bell />
            </Button>
            <span className="topbar-avatar">R</span>
          </div>
        }
      >
        <section
          id="preview-main"
          tabIndex={-1}
          className="preview-main @container/main"
        >
          <div className="page-heading">
            <PageHeader
              title={current.label}
              description={current.description}
              actions={
                <>
                  <Button variant="outline" onClick={exportSnapshot}>
                    <Download />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setDetail({
                        title: "Preview time window",
                        description:
                          "All values are illustrative. Use the chart controls to compare sample time windows.",
                        fields: [
                          ["Date", "September 22, 2026"],
                          [
                            "Window",
                            range === "1h"
                              ? "10:00 to 11:00"
                              : "Previous 24 hours",
                          ],
                          ["Timezone", "UTC"],
                        ],
                      })
                    }
                  >
                    <Clock3 />
                    Last {range === "1h" ? "hour" : "24 hours"}
                    <ChevronDown />
                  </Button>
                </>
              }
            />
          </div>
          {scopePage && (
            <ScopePage key={page} page={scopePage} navigate={navigate} />
          )}
          {page === "overview" && (
            <>
              <div className="health-banner">
                <div>
                  <span className="health-symbol">
                    <Activity size={17} />
                  </span>
                  <strong>Application is operational</strong>
                  <span className="banner-subtitle">
                    5 of 6 services are healthy.
                  </span>
                </div>
                <button onClick={() => navigate("services")}>
                  <span className="warning-dot" />1 needs attention
                  <ArrowRight size={14} />
                </button>
              </div>
              <MetricStrip />
              <div className="overview-charts">
                <Panel
                  title="Request traffic"
                  subtitle="Throughput across your application"
                  action={rangePicker}
                >
                  <div className="chart-summary">
                    <strong>
                      1,284<span>req / min</span>
                    </strong>
                    <span className="chart-legend">
                      <i />
                      Requests
                      <i className="previous" />
                      Previous period
                    </span>
                  </div>
                  <TrafficChart range={range} />
                  <div className="chart-note">
                    <span className="status-dot" />
                    Traffic is within the expected range
                    <span>Sampled every 60s</span>
                  </div>
                </Panel>
                <Panel
                  title="System health"
                  action={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Inspect system health"
                      onClick={() => navigate("services")}
                    >
                      <ArrowUpRight />
                    </Button>
                  }
                >
                  <div className="health-score">
                    <strong>
                      99.98<span>%</span>
                    </strong>
                    <Status>Operational</Status>
                  </div>
                  <p className="health-description">
                    Availability over the last 30 days
                  </p>
                  <div
                    className="uptime-bars"
                    role="img"
                    aria-label="30 days of availability, two brief degraded periods"
                  >
                    {Array.from({ length: 40 }, (_, i) => (
                      <span
                        key={i}
                        className={i === 27 || i === 28 ? "degraded" : ""}
                      />
                    ))}
                  </div>
                  <div className="uptime-labels">
                    <span>30 days ago</span>
                    <span>Today</span>
                  </div>
                  <div className="health-resources">
                    {[
                      ["CPU", "28%", 28],
                      ["Memory", "384 MB / 1 GB", 38],
                      ["Connections", "18 / 100", 18],
                    ].map(([label, value, width]) => (
                      <div key={label}>
                        <div>
                          <span>{label}</span>
                          <strong>{value}</strong>
                        </div>
                        <div className="resource-meter">
                          <span style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
              <div className="overview-bottom">
                <Panel
                  title="Services"
                  subtitle="Health checks from your application"
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("services")}
                    >
                      View all
                      <ArrowRight />
                    </Button>
                  }
                >
                  <ServiceTable compact onDetail={setDetail} />
                </Panel>
                <Panel
                  title="Recent activity"
                  action={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="View all activity"
                      onClick={() => {
                        setTab("Audit trail")
                        navigate("logs")
                      }}
                    >
                      <ArrowUpRight />
                    </Button>
                  }
                >
                  <div className="activity-list">
                    {activity.slice(0, 5).map((item, index) => (
                      <button
                        key={item.id}
                        onClick={() =>
                          setDetail({
                            title: item.event,
                            description: `Event from ${item.source}.`,
                            fields: [
                              ["Event ID", item.id],
                              ["Actor", item.actor],
                              ["Result", item.status],
                              ["Time", item.time],
                            ],
                          })
                        }
                      >
                        <span
                          className={`activity-icon ${item.status === "Warning" ? "amber" : ""}`}
                        >
                          {index === 3 ? (
                            <Activity size={14} />
                          ) : (
                            <Check size={14} />
                          )}
                        </span>
                        <span>
                          <strong>{item.event}</strong>
                          <small>
                            {item.source}
                            <span>{item.time}</span>
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="activity-link"
                    onClick={() => {
                      setTab("Audit trail")
                      navigate("logs")
                    }}
                  >
                    Open audit trail
                    <ArrowRight size={13} />
                  </button>
                </Panel>
              </div>
            </>
          )}
          {page === "services" && (
            <>
              <div className="summary-line">
                <Status>5 healthy</Status>
                <Status>1 degraded</Status>
                <span>6 registered services</span>
                <span>Last checked at 10:48:32 UTC</span>
              </div>
              <Panel
                title="Registered services"
                subtitle="Open a service to inspect its latest check."
              >
                <Filters
                  query={query}
                  setQuery={setQuery}
                  placeholder="Search services..."
                  filter={filter}
                  setFilter={setFilter}
                  options={["All services", "Needs attention"]}
                />
                <ServiceTable
                  query={query}
                  filter={filter}
                  onClear={() => {
                    setQuery("")
                    setFilter("")
                  }}
                  onDetail={setDetail}
                />
                <div className="panel-footer">
                  Health checks run every 30 seconds.
                  <span>Illustrative sample</span>
                </div>
              </Panel>
            </>
          )}
          {page === "metrics" && (
            <>
              <MetricStrip runtime />
              <div className="metrics-grid">
                <Panel
                  title="Request throughput"
                  subtitle="Requests per minute"
                  action={rangePicker}
                >
                  <TrafficChart range={range} />
                </Panel>
                <Panel
                  title="Response latency"
                  subtitle="95th percentile across all routes"
                  action={rangePicker}
                >
                  <TrafficChart range={range} mode="latency" />
                </Panel>
              </div>
              <Panel
                title="Runtime metrics"
                subtitle="Sample measurements from the current instance."
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      {["Metric", "Value", "Type", "Source"].map((text) => (
                        <TableHead key={text}>{text}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      ["go_goroutines", "128", "Gauge", "Go runtime"],
                      [
                        "go_memstats_alloc_bytes",
                        "402,653,184",
                        "Gauge",
                        "Go runtime",
                      ],
                      [
                        "http_requests_total",
                        "128,430",
                        "Counter",
                        "HTTP server",
                      ],
                      [
                        "http_request_duration_seconds",
                        "0.042",
                        "Histogram",
                        "HTTP server",
                      ],
                    ].map((row) => (
                      <TableRow key={row[0]}>
                        {row.map((value, index) => (
                          <TableCell
                            key={index}
                            className={index === 0 ? "code" : ""}
                          >
                            {value}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            </>
          )}
          {page === "routes" && (
            <>
              <div className="proposal-note">
                <Code2 size={16} />
                <span>
                  Proposed route explorer. Route inventory and per-route metrics
                  need a core contract.
                </span>
              </div>
              <Panel
                title="Registered routes"
                subtitle="6 endpoints across 4 extensions"
              >
                <Filters
                  query={query}
                  setQuery={setQuery}
                  placeholder="Search routes or extensions..."
                  filter={filter}
                  setFilter={setFilter}
                  options={["All methods", "GET", "POST"]}
                />
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Method",
                        "Route",
                        "Extension",
                        "Requests",
                        "p95 latency",
                        "Status",
                      ].map((text) => (
                        <TableHead key={text}>{text}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {routes
                      .filter(
                        (route) =>
                          matched(route.path + route.owner) &&
                          (filter === "" || route.method === filter)
                      )
                      .map((route) => (
                        <TableRow key={route.path}>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={`method method-${route.method.toLowerCase()}`}
                            >
                              {route.method}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <button
                              className="code row-link"
                              onClick={() =>
                                setDetail({
                                  title: `${route.method} ${route.path}`,
                                  description: `Registered by ${route.owner}.`,
                                  fields: [
                                    [
                                      "Middleware",
                                      "Request ID, CORS, Authentication",
                                    ],
                                    ["Requests", route.requests],
                                    ["p95 latency", route.latency],
                                    [
                                      "Access",
                                      route.path === "/health"
                                        ? "Public"
                                        : "Authenticated",
                                    ],
                                  ],
                                })
                              }
                            >
                              {route.path}
                            </button>
                          </TableCell>
                          <TableCell>{route.owner}</TableCell>
                          <TableCell className="numeric">
                            {route.requests}
                          </TableCell>
                          <TableCell className="numeric">
                            {route.latency}
                          </TableCell>
                          <TableCell>
                            <Status>{route.status}</Status>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
                {!routes.some(
                  (route) =>
                    matched(route.path + route.owner) &&
                    (filter === "" || route.method === filter)
                ) && (
                  <ZeroState
                    title="No routes match your filters"
                    body="Try another search or clear your filters."
                    illustration={<Search className="size-6" />}
                    action={
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery("")
                          setFilter("")
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                )}
              </Panel>
            </>
          )}
          {page === "traces" && (
            <Panel
              title="Recent traces"
              subtitle="Select a request to explore its span waterfall."
            >
              <Filters
                query={query}
                setQuery={setQuery}
                placeholder="Search traces or endpoints..."
                filter={filter}
                setFilter={setFilter}
                options={["All traces", "Slow requests"]}
              />
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      "Request",
                      "Trace ID",
                      "Started",
                      "Duration",
                      "Spans",
                      "Status",
                    ].map((text) => (
                      <TableHead key={text}>{text}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traces
                    .filter(
                      (trace) =>
                        matched(trace.path + trace.id) &&
                        (filter !== "Slow requests" || trace.duration > 100)
                    )
                    .map((trace) => (
                      <TableRow key={trace.id}>
                        <TableCell>
                          <button
                            className="row-link code"
                            onClick={() =>
                              setDetail({
                                title: `${trace.method} ${trace.path}`,
                                description:
                                  "Request trace with an illustrative span waterfall.",
                                fields: [
                                  ["Trace ID", trace.id],
                                  ["Duration", trace.latency],
                                  ["Spans", `${trace.spans}`],
                                  ["Started", trace.time],
                                ],
                                kind: "trace",
                              })
                            }
                          >
                            {trace.method} {trace.path}
                          </button>
                        </TableCell>
                        <TableCell className="code text-muted-foreground">
                          {trace.id}
                        </TableCell>
                        <TableCell className="numeric">{trace.time}</TableCell>
                        <TableCell>
                          <div className="duration-cell">
                            <span
                              style={{
                                width: `${Math.max(trace.duration, 4)}px`,
                              }}
                            />
                            {trace.latency}
                          </div>
                        </TableCell>
                        <TableCell>{trace.spans}</TableCell>
                        <TableCell>
                          <Status>{trace.status}</Status>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {!traces.some(
                (trace) =>
                  matched(trace.path + trace.id) &&
                  (filter !== "Slow requests" || trace.duration > 100)
              ) && (
                <ZeroState
                  title="No traces match your filters"
                  body="Try another search or clear your filters."
                  illustration={<Search className="size-6" />}
                  action={
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("")
                        setFilter("")
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )}
            </Panel>
          )}
          {page === "logs" && (
            <>
              <Tabs
                className="mb-6"
                value={tab}
                onValueChange={(value) => {
                  setTab(String(value))
                  setQuery("")
                  setFilter("")
                }}
              >
                <TabsList variant="line" aria-label="Log source">
                  <TabsTrigger value="Application logs">
                    Application logs
                  </TabsTrigger>
                  <TabsTrigger value="Audit trail">Audit trail</TabsTrigger>
                </TabsList>
              </Tabs>
              {tab === "Application logs" && (
                <div className="proposal-note">
                  <Terminal size={16} />
                  <span>
                    Sample application logs. The existing core contract exposes
                    audit events; application log collection needs its own
                    provider.
                  </span>
                </div>
              )}
              <Panel
                title={
                  tab === "Application logs"
                    ? "Application logs"
                    : "Audit events"
                }
                action={<Badge variant="outline">Snapshot</Badge>}
              >
                <Filters
                  query={query}
                  setQuery={setQuery}
                  placeholder="Search events, actors, or sources..."
                  filter={filter}
                  setFilter={setFilter}
                  options={["All levels", "Warnings & errors"]}
                />
                {tab === "Application logs" ? (
                  <div className="log-lines">
                    {activity
                      .filter(
                        (item) =>
                          matched(
                            `${item.event} ${item.source} ${item.actor}`
                          ) &&
                          (filter !== "Warnings & errors" ||
                            item.status !== "Success")
                      )
                      .map((item) => (
                        <button
                          key={item.id}
                          onClick={() =>
                            setDetail({
                              title: item.event,
                              description: "Structured sample log record.",
                              fields: [
                                ["Timestamp", `2026-09-22T${item.time}Z`],
                                ["Source", item.source],
                                ["Actor", item.actor],
                                [
                                  "Level",
                                  item.status === "Success" ? "INFO" : "WARN",
                                ],
                              ],
                            })
                          }
                        >
                          <time>{item.time}.042</time>
                          <span
                            className={
                              item.status === "Success"
                                ? "log-info"
                                : "log-warn"
                            }
                          >
                            {item.status === "Success" ? "INFO" : "WARN"}
                          </span>
                          <span>{item.source.toLowerCase()}</span>
                          <strong>{item.event}</strong>
                          <ChevronRight size={13} />
                        </button>
                      ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {["Time", "Event", "Source", "Actor", "Result"].map(
                          (text) => (
                            <TableHead key={text}>{text}</TableHead>
                          )
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activity
                        .filter(
                          (item) =>
                            matched(
                              `${item.event} ${item.source} ${item.actor}`
                            ) &&
                            (filter !== "Warnings & errors" ||
                              item.status !== "Success")
                        )
                        .map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="numeric">
                              {item.time}
                            </TableCell>
                            <TableCell>
                              <button
                                className="row-link"
                                onClick={() =>
                                  setDetail({
                                    title: item.event,
                                    description: `Audit event from ${item.source}.`,
                                    fields: [
                                      ["Event ID", item.id],
                                      ["Actor", item.actor],
                                      ["Result", item.status],
                                      ["Time", item.time],
                                    ],
                                  })
                                }
                              >
                                {item.event}
                              </button>
                            </TableCell>
                            <TableCell>{item.source}</TableCell>
                            <TableCell>{item.actor}</TableCell>
                            <TableCell>
                              <Status>{item.status}</Status>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
                {!activity.some(
                  (item) =>
                    matched(`${item.event} ${item.source} ${item.actor}`) &&
                    (filter !== "Warnings & errors" ||
                      item.status !== "Success")
                ) && (
                  <ZeroState
                    title="No events match your filters"
                    body="Try another search or clear your filters."
                    illustration={<Search className="size-6" />}
                    action={
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery("")
                          setFilter("")
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                )}
                <div className="panel-footer">
                  September 22, 2026<span>All timestamps in UTC</span>
                </div>
              </Panel>
            </>
          )}
          {page === "extensions" && (
            <>
              <Filters
                query={query}
                setQuery={setQuery}
                placeholder="Search extensions..."
                filter={filter}
                setFilter={setFilter}
                options={["All extensions", "Setup required"]}
              />
              <div className="extensions-grid">
                {extensions
                  .filter(
                    (extension) =>
                      matched(extension.name + extension.description) &&
                      (filter !== "Setup required" ||
                        extension.status === filter)
                  )
                  .map((extension) => {
                    const Icon =
                      extensionIcons[
                        extension.icon as keyof typeof extensionIcons
                      ]
                    return (
                      <Card className="extension-card" key={extension.name}>
                        <div className="extension-heading">
                          <span className="extension-icon">
                            <Icon size={24} />
                          </span>
                          <Badge variant="outline">v{extension.version}</Badge>
                        </div>
                        <div>
                          <h2>{extension.name}</h2>
                          <span className="extension-category">
                            {extension.category}
                          </span>
                          <p>{extension.description}</p>
                        </div>
                        <div className="extension-footer">
                          <Status>{extension.status}</Status>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDetail({
                                title: extension.name,
                                description: extension.description,
                                fields: [
                                  ["Version", extension.version],
                                  ["Status", extension.status],
                                  ["Category", extension.category],
                                  [
                                    "Next step",
                                    extension.status === "Ready"
                                      ? "Open this extension's scoped dashboard when connected to your server."
                                      : "Configure a delivery provider to enable notifications.",
                                  ],
                                ],
                              })
                            }
                          >
                            Inspect
                            <ArrowRight />
                          </Button>
                        </div>
                      </Card>
                    )
                  })}
              </div>
              {!extensions.some(
                (extension) =>
                  matched(extension.name + extension.description) &&
                  (filter !== "Setup required" || extension.status === filter)
              ) && (
                <ZeroState
                  title="No extensions match your filters"
                  body="Try another search or clear your filters."
                  illustration={<Search className="size-6" />}
                  action={
                    <Button
                      variant="outline"
                      onClick={() => {
                        setQuery("")
                        setFilter("")
                      }}
                    >
                      Clear filters
                    </Button>
                  }
                />
              )}
            </>
          )}
          {page === "configuration" && <ConfigPage notify={setToast} />}
          {page === "kit" && <KitPage notify={setToast} />}
          <footer className="preview-footer">
            <span>
              <Hexagon size={12} />
              Forge dashboard<span className="footer-separator">/</span>Acme API
            </span>
            <span>
              Interactive React mock<span className="footer-separator">/</span>
              Sample data
            </span>
          </footer>
        </section>
      </DashboardShell>
      <Sheet
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      >
        <SheetContent className="preview-detail">
          <SheetHeader>
            <div className="detail-eyebrow">
              <Hexagon size={16} />
              Inspect
            </div>
            <SheetTitle>{detail?.title}</SheetTitle>
            <SheetDescription>{detail?.description}</SheetDescription>
          </SheetHeader>
          <div className="detail-body">
            <dl>
              {detail?.fields.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {label === "Status" || label === "Result" ? (
                      <Status>{value}</Status>
                    ) : (
                      value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {detail?.kind === "trace" && (
              <div className="waterfall">
                <h3>Span waterfall</h3>
                {[
                  "HTTP request",
                  "Authentication",
                  "Resolve handler",
                  "Database query",
                  "Serialize response",
                ].map((label, index) => (
                  <div key={label}>
                    <span>{label}</span>
                    <div>
                      <i
                        style={{
                          marginLeft: `${index * 9}%`,
                          width: `${92 - index * 17}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {detail?.kind === "service" && (
              <>
                <h3>Recent check history</h3>
                <div className="uptime-bars">
                  {Array.from({ length: 30 }, (_, i) => (
                    <span
                      key={i}
                      className={
                        detail.title === "Redis" && i > 24 ? "degraded" : ""
                      }
                    />
                  ))}
                </div>
                <p className="text-muted-foreground">
                  Sample health checks over the last 15 minutes.
                </p>
              </>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(detail, null, 2)
                  )
                  setToast("Sample details copied.")
                } catch {
                  setToast(
                    "Clipboard unavailable. You can select and copy the details."
                  )
                }
              }}
            >
              <Copy />
              Copy details
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
        <SheetContent className="preview-detail">
          <SheetHeader>
            <SheetTitle>Search the dashboard</SheetTitle>
            <SheetDescription>Jump to a core page.</SheetDescription>
          </SheetHeader>
          <div className="detail-body">
            <Input
              aria-label="Search dashboard pages"
              placeholder="Search pages..."
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
            />
            <div className="search-results">
              {[...pages, ...scopePages]
                .filter((item) =>
                  `${item.label} ${item.description}`
                    .toLowerCase()
                    .includes(globalQuery.toLowerCase())
                )
                .map((item) => (
                  <button key={item.id} onClick={() => navigate(item.id)}>
                    <item.icon size={18} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              {![...pages, ...scopePages].some((item) =>
                `${item.label} ${item.description}`
                  .toLowerCase()
                  .includes(globalQuery.toLowerCase())
              ) && <p>No pages match. Try “services” or “metrics”.</p>}
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {toast && (
        <div className="preview-toast" role="status">
          <Check size={16} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  )
}
