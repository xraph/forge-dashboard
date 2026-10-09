import { useState } from "react"
import type { CSSProperties } from "react"
import {
  Activity,
  ArrowRight,
  Bell,
  Blocks,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  Clock3,
  Cpu,
  Gauge,
  KeyRound,
  Layers,
  ListFilter,
  Minus,
  Monitor,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
} from "lucide-react"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { Card } from "@forge-go/dashboard-kit/components/card"
import { ForgeMark } from "@forge-go/dashboard-kit/components/brand-marks"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@forge-go/dashboard-kit/components/sheet"
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@forge-go/dashboard-kit/components/sidebar"
import { TooltipProvider } from "@forge-go/dashboard-kit/components/tooltip"

const navigation = [
  {
    label: "Workspace",
    items: [
      { name: "Overview", icon: Gauge, page: "overview" },
      { name: "Services", icon: Server, page: "services" },
      { name: "Request processing", icon: Network, page: "reference" },
      { name: "Extensions", icon: Blocks, page: "extensions" },
    ],
  },
  {
    label: "Observe",
    items: [
      { name: "Metrics", icon: Activity, page: "metrics" },
      { name: "Traces", icon: Layers, page: "traces" },
      { name: "Logs & activity", icon: Terminal, page: "logs" },
    ],
  },
  {
    label: "Manage",
    items: [
      { name: "Configuration", icon: Settings2, page: "configuration" },
      { name: "Access & secrets", icon: KeyRound, page: "/@authsome/roles" },
      { name: "Component library", icon: Box, page: "kit" },
    ],
  },
]
const demand = [
  5, 6, 7, 8, 9, 8, 7, 6, 5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 12, 11, 10, 9, 8,
  7, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 16, 15, 14, 13, 12, 11, 10, 9,
  10, 11, 12,
]

function CapacityChart({ fixed = false }: { fixed?: boolean }) {
  return (
    <div className="reference-capacity">
      <div className="reference-chart-key">
        <Badge
          variant="outline"
          className={fixed ? "" : "reference-green-label"}
        >
          {fixed ? "Predictable concurrency" : "Capacity follows demand"}
        </Badge>
        <span>
          <i className={fixed ? "amber" : "green"} /> Requests{" "}
          <i className="gray" /> Capacity
        </span>
      </div>
      <svg
        viewBox="0 0 576 170"
        role="img"
        aria-label={
          fixed
            ? "Fixed worker capacity with peaks above and below demand"
            : "Request capacity scales with incoming demand"
        }
        preserveAspectRatio="none"
      >
        <defs>
          <pattern
            id="reference-hatch"
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M-1 1L1-1M0 5L5 0M4 6L6 4"
              stroke="#e2e2e2"
              strokeWidth=".7"
            />
          </pattern>
        </defs>
        {fixed
          ? Array.from({ length: 16 }, (_, i) => {
              const heights = [
                85, 65, 54, 90, 114, 40, 104, 78, 132, 122, 98, 84, 111, 88, 66,
                54,
              ]
              const h = heights[i]
              return (
                <g key={i}>
                  <rect
                    x={i * 36 + 1}
                    y={160 - h}
                    width="34"
                    height={h}
                    fill="url(#reference-hatch)"
                  />
                  <path
                    d={`M${i * 36 + 1} ${160 - h}h34`}
                    stroke={h > 100 ? "#df634c" : "#d69a52"}
                    strokeWidth="2"
                  />
                  <path
                    d={`M${i * 36 + 1} ${160 - h}V160`}
                    stroke="#e9e9e9"
                    strokeDasharray="2 2"
                  />
                </g>
              )
            })
          : demand.flatMap((height, column) =>
              Array.from({ length: height }, (_, row) => (
                <rect
                  key={`${column}-${row}`}
                  x={column * 12 + 1}
                  y={158 - row * 8.5}
                  width="8"
                  height="6.5"
                  rx=".5"
                  fill={row >= height - 3 ? "#bed1c2" : "#58be69"}
                />
              ))
            )}
      </svg>
      <div className="reference-chart-caption">
        {fixed ? (
          <>
            <span className="reference-hatch-key" /> Available capacity{" "}
            <span className="reference-demand-key" /> Incoming requests
          </>
        ) : (
          "Services scale to handle incoming requests"
        )}
      </div>
    </div>
  )
}

function FlowChart({ sent }: { sent: number }) {
  const points = [
    4, 4, 2, 2, 6, 6, 6, 8, 8, 8, 10, 6, 6, 8, 8, 4, 4, 6, 6, 6, 6, 6, 6, 6, 2,
    2, 2, 4, 4, 2, 2, 2, 6, 6, 6, 6, 6, 6, 6, 4, 4, 4, 8, 8, 4, 4, 4, 8, 8, 8,
  ]
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${i * 20} ${144 - Math.min(11, p + (sent > 0 && i > 43 ? 2 : 0)) * 11}`
    )
    .join(" ")
  const lower = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${i * 20} ${144 - Math.max(0, p - (i % 7 < 3 ? 0 : 4)) * 11}`
    )
    .join(" ")
  return (
    <div className="reference-flow-chart">
      <svg
        viewBox="0 0 1010 178"
        preserveAspectRatio="none"
        role="img"
        aria-label={
          sent
            ? `Sample worker activity after ${sent} test requests`
            : "Sample worker activity over forty minutes"
        }
      >
        <defs>
          <linearGradient id="reference-area" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#cec4f8" stopOpacity=".4" />
            <stop offset="1" stopColor="#cec4f8" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform="translate(28 4)">
          {Array.from({ length: 21 }, (_, i) => (
            <line
              key={i}
              x1={i * 49}
              x2={i * 49}
              y1="6"
              y2="144"
              stroke="#dedede"
              strokeDasharray="2 2"
            />
          ))}
          {[0, 2, 4, 6, 8, 10].map((n) => (
            <g key={n}>
              <text x="-15" y={148 - n * 11} textAnchor="end">
                {n}
              </text>
              <line
                x1="0"
                x2="980"
                y1={144 - n * 11}
                y2={144 - n * 11}
                stroke="#eeeeee"
                strokeDasharray="2 2"
              />
            </g>
          ))}
          <path d={`${lower}L980 144L0 144Z`} fill="url(#reference-area)" />
          <path
            d={lower}
            fill="none"
            stroke="#d3c8fa"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d={path}
            fill="none"
            stroke="#7057e5"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <line x1="0" x2="980" y1="144" y2="144" stroke="#b9c8e5" />
          {Array.from({ length: 9 }, (_, i) => (
            <text
              key={i}
              x={i * 122.5}
              y="170"
              textAnchor={i === 0 ? "start" : i === 8 ? "end" : "middle"}
            >
              09:{String(i * 5).padStart(2, "0")}
            </text>
          ))}
        </g>
      </svg>
      <div className="reference-mobile-ticks" aria-hidden="true">
        <span>09:00</span>
        <span>09:20</span>
        <span>09:40</span>
      </div>
      <div className="reference-legend">
        <span>
          <i className="violet-line" /> Active workers
        </span>
        <span>
          <i className="blue" /> Queued requests
        </span>
        <span>
          <i className="violet" /> Processing requests
        </span>
      </div>
    </div>
  )
}

export function ReferencePreview() {
  const [count, setCount] = useState(5)
  const [sent, setSent] = useState(0)
  const [route, setRoute] = useState("/api/v1/orders")
  const [panel, setPanel] = useState<
    "tutorial" | "configuration" | "notifications" | null
  >(null)
  return (
    <TooltipProvider>
      <SidebarProvider
        className="reference-shell"
        style={{ "--sidebar-width": "232px" } as CSSProperties}
      >
        <Sidebar className="reference-sidebar">
          <SidebarHeader className="reference-brand">
            <ForgeMark />
            <span>forge</span>
            <SidebarTrigger aria-label="Toggle sidebar" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<a href="/design-preview.html#kit" />}
                  >
                    <Search />
                    <span>Explore the kit</span>
                    <ChevronRight />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            {navigation.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>
                  {group.label}
                  <ChevronDown />
                </SidebarGroupLabel>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.page}>
                      <SidebarMenuButton
                        isActive={item.page === "reference"}
                        render={
                          <a
                            href={
                              item.page === "reference"
                                ? "/reference-preview.html"
                                : `/design-preview.html#${item.page}`
                            }
                            aria-current={
                              item.page === "reference" ? "page" : undefined
                            }
                          />
                        }
                      >
                        <item.icon />
                        <span>{item.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={() => setPanel("tutorial")}>
                  <CircleHelp />
                  <span>Help & resources</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={<a href="/design-preview.html#kit" />}
                >
                  <ListFilter />
                  <span>Design system</span>
                  <Badge variant="outline">Preview</Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="reference-topbar">
            <div className="reference-breadcrumb">
              <SidebarTrigger className="reference-mobile-trigger" />
              <span>Workspace</span>
              <ChevronRight />
              <strong>Request processing</strong>
            </div>
            <div className="reference-top-actions">
              <Badge variant="outline">Sample data</Badge>
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Notifications"
                onClick={() => setPanel("notifications")}
              >
                <Bell />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPanel("configuration")}
              >
                <ShieldCheck /> Production
                <ChevronDown />
              </Button>
              <span className="reference-avatar" aria-label="Preview workspace">
                F
              </span>
            </div>
          </header>
          <main className="reference-main">
            <section className="reference-banner">
              <div>
                <h1>Keep your services responsive at any scale</h1>
                <p>
                  Route requests to your services and process longer jobs in the
                  background.
                  <br className="reference-desktop-break" /> Explore how your
                  application handles changing demand.
                </p>
              </div>
              <div className="reference-banner-actions">
                <Button
                  size="sm"
                  onClick={() =>
                    document.getElementById("reference-flow")?.scrollIntoView({
                      behavior: window.matchMedia(
                        "(prefers-reduced-motion: reduce)"
                      ).matches
                        ? "instant"
                        : "smooth",
                      block: "center",
                    })
                  }
                >
                  Try a request
                  <ArrowRight />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPanel("tutorial")}
                >
                  View guide
                </Button>
              </div>
              <svg
                className="reference-globe"
                viewBox="0 0 460 190"
                aria-hidden="true"
              >
                <g fill="none" stroke="#e5e5e5" strokeWidth=".8">
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <ellipse
                      key={i}
                      cx="290"
                      cy="245"
                      rx={210 - i * 20}
                      ry="228"
                      transform={`rotate(${i * 12 - 35} 290 245)`}
                    />
                  ))}
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <ellipse
                      key={i}
                      cx="290"
                      cy={80 + i * 30}
                      rx="210"
                      ry={18 + i * 10}
                      transform="rotate(-22 290 245)"
                    />
                  ))}
                </g>
              </svg>
            </section>
            <div className="reference-comparison">
              <Card size="sm" className="reference-model">
                <div className="reference-model-heading">
                  <span className="reference-model-icon">
                    <Network />
                  </span>
                  <div>
                    <h2>HTTP services</h2>
                    <p>Respond immediately, scale with traffic</p>
                  </div>
                  <Badge variant="outline">Request / response</Badge>
                </div>
                <CapacityChart />
                <ul className="reference-benefits">
                  <li>
                    <CircleCheck /> Handle bursts of incoming requests
                  </li>
                  <li>
                    <CircleCheck /> Route traffic to healthy services
                  </li>
                  <li>
                    <CircleCheck /> Track latency for every endpoint
                  </li>
                </ul>
                <footer>
                  <div>
                    <strong>
                      42 ms <small>p95 latency</small>
                    </strong>
                    <p>Across 1,420 requests in the last hour.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    render={<a href="/design-preview.html#services" />}
                  >
                    View services
                    <ArrowRight />
                  </Button>
                </footer>
              </Card>
              <Card size="sm" className="reference-model">
                <div className="reference-model-heading">
                  <span className="reference-model-icon">
                    <Box />
                  </span>
                  <div>
                    <h2>Background workers</h2>
                    <p>Queue longer jobs, control concurrency</p>
                  </div>
                </div>
                <CapacityChart fixed />
                <ul className="reference-benefits">
                  <li>
                    <CircleCheck /> Process jobs outside the request lifecycle
                  </li>
                  <li>
                    <CircleCheck /> Retry failed jobs with a backoff policy
                  </li>
                  <li>
                    <CircleCheck /> Set capacity for predictable workloads
                  </li>
                </ul>
                <footer>
                  <div>
                    <strong>
                      5 workers <small>available</small>
                    </strong>
                    <p>Sample queue configuration, with 1 worker idle.</p>
                  </div>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setPanel("configuration")}
                  >
                    View configuration
                    <ArrowRight />
                  </Button>
                </footer>
              </Card>
            </div>
            <Card size="sm" className="reference-flow" id="reference-flow">
              <div className="reference-flow-heading">
                <div>
                  <h2>How requests move through your application</h2>
                  <p>
                    Send sample requests and follow them from your endpoint to a
                    worker.
                  </p>
                </div>
                <div className="reference-request-actions">
                  <div className="reference-stepper">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Fewer requests"
                      disabled={count === 1}
                      onClick={() => setCount((c) => c - 1)}
                    >
                      <Minus />
                    </Button>
                    <output aria-label="Request count">{count}</output>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="More requests"
                      disabled={count === 10}
                      onClick={() => setCount((c) => c + 1)}
                    >
                      <Plus />
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSent((s) => s + count)}
                  >
                    <Send /> Send {count === 1 ? "request" : "requests"}
                  </Button>
                </div>
              </div>
              <div className="reference-flow-surface">
                <div className="reference-pipeline">
                  <div className="reference-node">
                    <div>
                      <Monitor />
                    </div>
                    <span>Client</span>
                  </div>
                  <div className="reference-connector">
                    <ArrowRight />
                    <ArrowRight />
                  </div>
                  <div className="reference-endpoint">
                    <NativeSelect
                      aria-label="Sample endpoint"
                      value={route}
                      onChange={(e) => {
                        setRoute(e.target.value)
                        setSent(0)
                      }}
                    >
                      <NativeSelectOption value="/api/v1/orders">
                        /api/v1/orders
                      </NativeSelectOption>
                      <NativeSelectOption value="/api/v1/events">
                        /api/v1/events
                      </NativeSelectOption>
                    </NativeSelect>
                    <span>HTTP endpoint</span>
                  </div>
                  <div className="reference-connector">
                    <ArrowRight />
                    <ArrowRight />
                  </div>
                  <div className="reference-node">
                    <div>
                      <MoreHorizontal />
                    </div>
                    <span>Queue</span>
                  </div>
                  <div className="reference-connector">
                    <ArrowRight />
                    <ArrowRight />
                  </div>
                  <div className="reference-workers">
                    {["Ready", "Run", "Run", "Ready", "Idle"].map(
                      (state, i) => (
                        <div
                          key={i}
                          className={`reference-worker ${sent > 0 && i === 3 ? "run" : state.toLowerCase()}`}
                        >
                          <Cpu />
                          <span>{sent > 0 && i === 3 ? "Run" : state}</span>
                        </div>
                      )
                    )}
                    <span>Background workers</span>
                  </div>
                </div>
                <FlowChart sent={sent} />
              </div>
              <div className="reference-simulation-note" role="status">
                {sent > 0 ? (
                  <>
                    <Check /> {sent} sample requests processed through {route}.
                    No server requests were sent.
                  </>
                ) : (
                  <>
                    <Clock3 /> Interactive preview. All metrics and request
                    activity are illustrative.
                  </>
                )}
              </div>
            </Card>
          </main>
        </SidebarInset>
        <Sheet
          open={panel !== null}
          onOpenChange={(open) => {
            if (!open) setPanel(null)
          }}
        >
          <SheetContent>
            <SheetHeader>
              <SheetTitle>
                {panel === "tutorial"
                  ? "Follow a sample request"
                  : panel === "configuration"
                    ? "Worker configuration"
                    : "Notifications"}
              </SheetTitle>
              <SheetDescription>
                This design preview uses sample data.
              </SheetDescription>
            </SheetHeader>
            <div className="reference-sheet-content">
              {panel === "tutorial" ? (
                <>
                  <p>
                    Choose an endpoint, set the number of requests, then select
                    Send requests.
                  </p>
                  <ol>
                    <li>The client sends a request to your HTTP endpoint.</li>
                    <li>The service queues background work.</li>
                    <li>An available worker picks up the job.</li>
                  </ol>
                  <p>
                    The worker states and activity chart update when you send a
                    sample request.
                  </p>
                  <Button onClick={() => setPanel(null)}>
                    Try it
                    <ArrowRight />
                  </Button>
                </>
              ) : panel === "configuration" ? (
                <>
                  <p>
                    You can review the sample configuration here. This preview
                    cannot change your running application.
                  </p>
                  <dl>
                    <div>
                      <dt>Environment</dt>
                      <dd>Production (sample)</dd>
                    </div>
                    <div>
                      <dt>Queue</dt>
                      <dd>orders.default</dd>
                    </div>
                    <div>
                      <dt>Worker capacity</dt>
                      <dd>5</dd>
                    </div>
                    <div>
                      <dt>Retry policy</dt>
                      <dd>3 attempts, exponential backoff</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <ZeroState
                  title="No new notifications"
                  body="You have no new notifications in this sample workspace."
                  illustration={<Bell />}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPanel(null)}
                    >
                      Return to requests
                    </Button>
                  }
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      </SidebarProvider>
    </TooltipProvider>
  )
}
