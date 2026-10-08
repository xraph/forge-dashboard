import { useState } from "react"
import { Bell } from "lucide-react"
import type { ScopePageDefinition } from "./scope-data"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@forge-go/dashboard-kit/components/card"
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@forge-go/dashboard-kit/components/table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"

const datasets: Record<string, { columns: string[]; rows: string[][] }> = {
  users: {
    columns: ["Name", "Email", "Role", "Status"],
    rows: [
      ["Alex Morgan", "alex@example.com", "Member", "Active"],
      ["Rex Raphael", "rex@example.com", "Administrator", "Active"],
      ["Sam Chen", "sam@example.com", "Developer", "Invited"],
    ],
  },
  sessions: {
    columns: ["User", "Device", "Last active", "Status"],
    rows: [
      ["Alex Morgan", "Chrome · macOS", "2 minutes ago", "Active"],
      ["Rex Raphael", "Safari · macOS", "Just now", "Active"],
    ],
  },
  devices: {
    columns: ["Device", "User", "Last seen", "Status"],
    rows: [
      ["MacBook Pro", "Alex Morgan", "2 minutes ago", "Trusted"],
      ["iPhone", "Sam Chen", "Yesterday", "Trusted"],
    ],
  },
  roles: {
    columns: ["Role", "Description", "Members", "Type"],
    rows: [
      ["Administrator", "Full application access", "2", "Built-in"],
      ["Developer", "Development and diagnostics", "8", "Custom"],
      ["Member", "Standard application access", "1,274", "Built-in"],
    ],
  },
  apps: {
    columns: ["Application", "ID", "Environments", "Status"],
    rows: [
      ["Acme API", "app_acme", "3", "Active"],
      ["Customer portal", "app_portal", "2", "Active"],
    ],
  },
  environments: {
    columns: ["Environment", "Application", "Created", "Status"],
    rows: [
      ["Production", "Acme API", "Sep 8, 2026", "Active"],
      ["Staging", "Acme API", "Sep 8, 2026", "Active"],
    ],
  },
  webhooks: {
    columns: ["Endpoint", "Events", "Last delivery", "Status"],
    rows: [
      [
        "https://api.example.com/hooks/identity",
        "user.created, session.created",
        "10:48:32",
        "Enabled",
      ],
    ],
  },
  "signup-forms": {
    columns: ["Form", "Application", "Fields", "Status"],
    rows: [["Default signup", "Customer portal", "4", "Published"]],
  },
  settings: {
    columns: ["Setting", "Value", "Source"],
    rows: [
      ["Session lifetime", "24 hours", "Application"],
      ["Email verification", "Required", "Application"],
      ["Password minimum length", "12 characters", "Policy"],
    ],
  },
  credentials: {
    columns: ["Credential", "Prefix", "Last used", "Status"],
    rows: [["Backend integration", "sk_preview_…", "Today", "Active"]],
  },
  features: {
    columns: ["Feature", "Description", "Status"],
    rows: [
      [
        "Multi-factor authentication",
        "Additional sign-in verification",
        "Enabled",
      ],
      ["Passkeys", "Passwordless authentication", "Enabled"],
    ],
  },
  plugins: {
    columns: ["Plugin", "Purpose", "Status"],
    rows: [
      ["Multi-factor", "Additional authentication factors", "Enabled"],
      ["SSO", "Enterprise identity providers", "Enabled"],
      ["Waitlist", "Early access signups", "Enabled"],
    ],
  },
  rooms: {
    columns: ["Room", "ID", "Members", "Status"],
    rows: [
      ["Engineering", "room_eng", "24", "Active"],
      ["Product", "room_product", "12", "Active"],
      ["Support", "room_support", "8", "Active"],
    ],
  },
  connections: {
    columns: ["Connection", "Transport", "Connected", "Status"],
    rows: [
      ["conn_a82f", "WebSocket", "12 minutes ago", "Connected"],
      ["conn_b93e", "Server-sent events", "8 minutes ago", "Connected"],
    ],
  },
  channels: {
    columns: ["Channel", "Subscribers", "Messages today", "Status"],
    rows: [
      ["app.notifications", "128", "8,204", "Active"],
      ["workspace.updates", "64", "2,812", "Active"],
    ],
  },
  presence: {
    columns: ["User", "Room", "Last active", "Status"],
    rows: [
      ["Alex Morgan", "Engineering", "Just now", "Online"],
      ["Sam Chen", "Product", "Just now", "Online"],
    ],
  },
  config: {
    columns: ["Setting", "Value", "Source"],
    rows: [
      ["Heartbeat interval", "30 seconds", "Application"],
      ["Max connections", "10,000", "Application"],
      ["Message retention", "24 hours", "Application"],
    ],
  },
}
export function ScopePage({
  page,
  navigate,
}: {
  page: ScopePageDefinition
  navigate: (path: string) => void
}) {
  const [search, setSearch] = useState("")
  const isAuth = page.id.startsWith("/@auth/")
  const leaf = page.id.split("/").at(-1) ?? ""
  const data = datasets[leaf || (isAuth ? "users" : "rooms")]!
  const filtered = data.rows.filter((row) =>
    row.join(" ").toLowerCase().includes(search.toLowerCase())
  )
  return (
    <div className="scope-page space-y-6">
      {!leaf && (
        <StatGrid
          items={
            isAuth
              ? [
                  {
                    label: "Total users",
                    value: "1,284",
                    hint: "86 joined this month",
                  },
                  {
                    label: "Active sessions",
                    value: "248",
                    hint: "Across 3 applications",
                  },
                  {
                    label: "Sign-in success",
                    value: "99.6%",
                    hint: "Over the last 24 hours",
                  },
                  {
                    label: "MFA adoption",
                    value: "82%",
                    hint: "1,053 enrolled users",
                  },
                ]
              : [
                  {
                    label: "Connections",
                    value: "1,024",
                    hint: "WebSocket and SSE",
                  },
                  {
                    label: "Active rooms",
                    value: "48",
                    hint: "Across your application",
                  },
                  {
                    label: "Messages today",
                    value: "82,412",
                    hint: "99.98% delivered",
                  },
                  {
                    label: "Delivery p95",
                    value: "24 ms",
                    hint: "Over the last hour",
                  },
                ]
          }
        />
      )}
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>
                {leaf ? page.label : isAuth ? "Recent users" : "Active rooms"}
              </CardTitle>
              <CardDescription className="mt-1">
                {leaf ? page.description : "Sample records from this scope."}
              </CardDescription>
            </div>
            {!leaf && (
              <Button
                variant="outline"
                onClick={() =>
                  navigate(isAuth ? "/@auth/users" : "/@streaming/rooms")
                }
              >
                View all
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Input
            className="max-w-sm"
            aria-label="Search scope records"
            placeholder={`Search ${leaf || (isAuth ? "users" : "rooms")}...`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Table>
            <TableHeader>
              <TableRow>
                {data.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row[0]}>
                  {row.map((value, index) => (
                    <TableCell key={index}>
                      {data.columns[index] === "Status" ? (
                        <Badge variant="secondary">{value}</Badge>
                      ) : (
                        value
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <EmptyState
              title="No matching records"
              description="Try another name or clear your search."
            />
          )}
        </CardContent>
      </Card>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Bell size={14} />
        <span>
          Sample data. This scope has its own navigation and application
          context.
        </span>
      </div>
    </div>
  )
}
