import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import {
  PluginProvider,
  NavigationProvider,
  createScopedClient,
  type ContractEnvelopeRequest,
} from "@forge-go/dashboard-plugin"
import { layoutViolations } from "@forge-go/dashboard-kit/lib/layout-check"
import { ChatPage } from "../src/pages/chat"
import {
  ConfigDetail,
  ConfigEdit,
  ConfigList,
} from "../src/pages/configuration"
import {
  CatalogDetail,
  CatalogPage,
  ConversationsPage,
  OrchestrationExecute,
  OrchestrationRunsPage,
  OverlaysPage,
  SettingsPage,
  ToolPage,
  ToolsPage,
} from "../src/pages/integrations"
import {
  CheckpointPage,
  CheckpointsPage,
  OverviewPage,
  RunPage,
  RunsPage,
  SessionPage,
  SessionsPage,
} from "../src/pages/operations"

// The code editor needs a layout engine jsdom does not have.
vi.mock("../src/editor", () => ({
  default: ({
    text,
    label,
    onChange,
  }: {
    text: string
    label: string
    onChange?: (v: string) => void
  }) => (
    <textarea
      aria-label={label}
      value={text}
      readOnly={!onChange}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

const scope = { levels: [{ key: "tenant", value: "a" }] }
const NOW = "2026-10-08T12:00:00Z"
const agent = {
  id: "agt_review",
  name: "reviewer",
  description: "Keeps the review queue moving",
  scope,
  enabled: true,
  model: "model",
  tools: ["read"],
  persona_ref: "operator",
  inline_skills: ["analysis"],
  inline_traits: [],
  inline_behaviors: [],
  system_prompt: "Review every change",
  sections: [
    { id: "role", body: "Original", order: 1, source: "host", locked: true },
  ],
  metadata: { owner: "operator" },
  created_at: NOW,
  updated_at: NOW,
}
const persona = {
  id: "per_ops",
  name: "operator",
  description: "The on-call voice",
  scope,
  identity: "A careful operator",
  skills: [{ skill_name: "analysis" }],
  traits: [],
  behaviors: [],
  created_at: NOW,
  updated_at: NOW,
}
const run = {
  id: "run_01",
  agent_id: agent.id,
  session_id: "ses_01",
  scope,
  state: "completed",
  input: "Summarise the queue",
  output: "Three items are waiting",
  step_count: 2,
  tokens_used: 480,
  created_at: NOW,
}
const session = {
  id: "ses_01",
  agent_id: agent.id,
  title: "Morning triage",
  is_default: false,
  message_count: 2,
  token_count: 120,
  scope,
  created_at: NOW,
  updated_at: NOW,
}
const checkpoint = {
  id: "chk_01",
  run_id: run.id,
  agent_id: agent.id,
  scope,
  reason: "Tool call needs approval",
  step_index: 1,
  state: "pending",
  created_at: NOW,
}
const runtime = {
  scope,
  llm: true,
  execution_label: "Anthropic runtime",
  safety: true,
  knowledge: true,
  tool_authorizer: true,
  audit: true,
  a2a: true,
  plugins: ["weave"],
  limitations: ["Behavior rules are stored, not executed"],
  permissions: {
    read: true,
    manage: true,
    run: true,
    approve: true,
    overlay: true,
  },
}
const tool = {
  Name: "read_file",
  Description: "Reads a file from the workspace",
  Parameters: { type: "object", properties: { path: { type: "string" } } },
}
const overlay = {
  id: "ovl_01",
  agent_id: agent.id,
  scope,
  patches: [{ id: "p1", body: "Be brief" }],
  model: "small-model",
}
const conversation = {
  id: "cnv_01",
  scope,
  status: "open",
  hops_used: 1,
  hop_ceiling: 8,
  created_at: NOW,
}
const orchestrationRun = {
  id: "orn_01",
  config_id: "orc_01",
  strategy: "sequential",
  status: "completed",
  input: "Plan the release",
  output: "Done",
  agent_run_ids: ["run_01"],
  started_at: NOW,
}

const data: Record<string, unknown> = {
  "runtime.detail": runtime,
  "agents.list": { items: [agent], total: 1, limit: 25, offset: 0 },
  "agents.detail": agent,
  "agents.stats": {
    total: 4,
    completed: 3,
    success_rate: 0.75,
    last_run: run,
  },
  "personas.detail": persona,
  "references.list": { items: [], total: 0, limit: 100, offset: 0 },
  "runs.list": { items: [run], total: 1, limit: 25, offset: 0 },
  "runs.detail": {
    run: { ...run, error: "The tool timed out" },
    steps: [
      {
        id: "stp_01",
        run_id: run.id,
        index: 0,
        type: "tool",
        input: "list the queue",
        output: "three items",
        tokens_used: 200,
        created_at: NOW,
      },
    ],
    tool_calls: {
      stp_01: [
        {
          id: "tc_01",
          tool_name: "read_file",
          arguments: '{"path":"queue.txt"}',
          result: "three items",
        },
      ],
    },
    suspension: {
      reason: "external_tool",
      pending: [{ id: "tc_02", name: "deploy", arguments: "{}" }],
    },
  },
  "checkpoints.list": { items: [checkpoint], total: 1, limit: 25, offset: 0 },
  "checkpoints.detail": checkpoint,
  "sessions.list": { items: [session], total: 1, limit: 25, offset: 0 },
  "memory.detail": {
    session,
    complete: true,
    messages: [
      { role: "user", content: "Hello there", timestamp: NOW },
      { role: "assistant", content: "Hi, how can I help", timestamp: NOW },
    ],
  },
  "overview.stats": { agents: 3, runs: 5, checkpoints: 1 },
  "knowledge.list": {
    available: true,
    total: 1,
    summary: { collections: 1, documents: 4, chunks: 12 },
    items: [
      {
        id: "kb_01",
        name: "Runbooks",
        document_count: 4,
        chunk_count: 12,
        embedding_model: "embed",
        chunk_strategy: "fixed",
      },
    ],
  },
  "knowledge.detail": {
    available: true,
    items: [{ id: "kb_01", name: "Runbooks", document_count: 4 }],
  },
  "models.list": {
    available: true,
    total: 1,
    items: [
      {
        id: "mdl_01",
        name: "large-model",
        provider: "anthropic",
        context_window: 200000,
        max_output: 8000,
        pricing: "metered",
        capabilities: "tools",
      },
    ],
  },
  "models.detail": {
    available: true,
    items: [{ id: "mdl_01", name: "large-model", provider: "anthropic" }],
  },
  "safety.scans": {
    available: true,
    total: 1,
    summary: { total: 6, blocked: 1, allowed: 4, flagged: 1 },
    items: [
      {
        id: "scn_01",
        direction: "input",
        decision: "allow",
        findings: 0,
        pii_count: 0,
        profile_used: "default",
        duration_ms: 12,
        created_at: NOW,
      },
    ],
  },
  "tools.list": { items: [tool], total: 1 },
  "tools.usage": {
    calls: 7,
    errors: 1,
    error_rate: 0.1,
    agents: [{ id: agent.id, name: "reviewer" }],
    skills: [{ name: "analysis", mastery: "expert" }],
  },
  "settings.detail": { default_model: "large-model", max_steps: 12 },
  "overlays.list": { items: [overlay], has_more: false, limit: 25, offset: 0 },
  "conversations.list": {
    items: [conversation],
    has_more: false,
    limit: 25,
    offset: 0,
  },
  "conversations.detail": {
    conversation,
    complete: true,
    messages: [
      {
        id: "env_01",
        sender: { agent: "planner" },
        receivers: [{ agent: "reviewer" }],
        content: "Please review the plan",
        performative: "request",
        created_at: NOW,
        reply_with: "tok_1",
      },
    ],
  },
  "orchestrationRuns.list": {
    items: [orchestrationRun],
    total: 1,
    limit: 25,
    offset: 0,
  },
  "orchestrationRuns.detail": orchestrationRun,
}

function mount(node: React.ReactNode) {
  const client = createScopedClient(
    "/dashboard/api/dashboard/v1",
    "cortex",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.body)
        return {
          ok: true,
          status: 200,
          json: async () => ({ token: "test" }),
        } as Response
      const req = JSON.parse(String(init.body)) as ContractEnvelopeRequest
      const value =
        req.intent in data
          ? { envelope: "v1", ok: true, data: data[req.intent] }
          : {
              envelope: "v1",
              ok: false,
              error: { code: "UNEXPECTED", message: req.intent },
            }
      return { ok: true, status: 200, json: async () => value } as Response
    })
  )
  return render(
    <NavigationProvider
      value={{
        Link: ({ to, children }) => <a href={to}>{children}</a>,
        navigate: vi.fn(),
      }}
    >
      <PluginProvider client={client}>{node}</PluginProvider>
    </NavigationProvider>
  ).container
}

function expectLayout(container: HTMLElement, ...regions: string[]) {
  expect(layoutViolations(container)).toEqual([])
  // Pages with no h2 or table cannot fail the guard on those, so they also
  // name the section regions they are expected to have.
  for (const name of regions)
    expect(screen.getByRole("region", { name })).toBeTruthy()
}

describe("Cortex pages follow the shared layout", () => {
  it("Configuration list follows the shared layout", async () => {
    const container = mount(<ConfigList resource="agents" />)
    await screen.findByText("reviewer")
    expectLayout(container, "Agents list")
  })

  it("Configuration detail follows the shared layout", async () => {
    const container = mount(<ConfigDetail resource="agents" id={agent.id} />)
    await screen.findByRole("heading", { level: 1, name: "reviewer" })
    // The two queries behind the agent's activity block arrive on their own.
    await screen.findByText("run_01")
    await screen.findByText(/75\.0% completed/)
    expectLayout(container, "Execution", "Details")
  })

  it("Persona detail follows the shared layout", async () => {
    const container = mount(<ConfigDetail resource="personas" id="per_ops" />)
    await screen.findByRole("heading", { level: 1, name: "operator" })
    await screen.findByText("A careful operator")
    expectLayout(container, "Details")
  })

  it("Configuration edit follows the shared layout", async () => {
    const container = mount(<ConfigEdit resource="agents" id={agent.id} />)
    await screen.findByDisplayValue("Keeps the review queue moving")
    expectLayout(container, "Agent fields")
  })

  it("Configuration create follows the shared layout", async () => {
    const container = mount(<ConfigEdit resource="agents" />)
    await screen.findByRole("heading", { level: 1, name: "New agent" })
    expectLayout(container, "Agent fields")
  })

  it("Chat follows the shared layout", async () => {
    const container = mount(<ChatPage agentId={agent.id} />)
    await screen.findByRole("link", { name: "reviewer" })
    await screen.findByRole("combobox", { name: "Session" })
    expectLayout(container, "Conversation")
  })

  it("Chat with a saved session follows the shared layout", async () => {
    const container = mount(
      <ChatPage agentId={agent.id} sessionId={session.id} />
    )
    await screen.findByRole("link", { name: "reviewer" })
    await screen.findByText("Hi, how can I help")
    expectLayout(container)
  })

  it("Playground comparison follows the shared layout", async () => {
    const container = mount(<ChatPage agentId={agent.id} playground />)
    await screen.findByRole("link", { name: "reviewer" })
    fireEvent.click(screen.getByRole("button", { name: "Compare sessions" }))
    await screen.findByRole("heading", { level: 2, name: "Comparison B" })
    expect(
      await screen.findAllByRole("link", { name: "reviewer" })
    ).toHaveLength(2)
    expectLayout(container)
  })

  it("Runs follows the shared layout", async () => {
    const container = mount(<RunsPage />)
    await screen.findByRole("link", { name: "run_01" })
    expectLayout(container, "Run list")
  })

  it("Run review follows the shared layout", async () => {
    const container = mount(<RunPage id={run.id} />)
    await screen.findByText("The tool timed out")
    await screen.findByText("read_file")
    await screen.findByRole("button", { name: "Submit results and resume" })
    expectLayout(
      container,
      "Input",
      "Output",
      "External tool results",
      "Steps and tool calls"
    )
  })

  it("Pending approvals follows the shared layout", async () => {
    const container = mount(<CheckpointsPage />)
    await screen.findByRole("link", { name: "Tool call needs approval" })
    expectLayout(container, "Approval list")
  })

  it("Checkpoint review follows the shared layout", async () => {
    const container = mount(<CheckpointPage id={checkpoint.id} />)
    await screen.findByRole("button", { name: "Approve" })
    expectLayout(container, "Details", "Decision")
  })

  it("Sessions follows the shared layout", async () => {
    const container = mount(<SessionsPage />)
    await screen.findByRole("link", { name: "Morning triage" })
    await screen.findByRole("combobox", { name: "Agent" })
    expectLayout(container, "Session controls", "Session list")
  })

  it("Session memory follows the shared layout", async () => {
    const container = mount(<SessionPage id={session.id} />)
    await screen.findByRole("heading", { level: 1, name: "Morning triage" })
    await screen.findByRole("textbox", { name: "user message 1" })
    expectLayout(container, "Messages")
  })

  it("Overview follows the shared layout", async () => {
    const container = mount(<OverviewPage />)
    await screen.findByText("Anthropic runtime", { exact: false })
    await screen.findByText("agents")
    await screen.findByRole("link", { name: "Tool call needs approval" })
    await screen.findAllByRole("link", { name: "run_01" })
    await screen.findByText(/1 collections/)
    await screen.findByText(/6 scans/)
    expectLayout(container, "Integrations", "Pending approvals", "Recent runs")
  })

  it("Models catalog follows the shared layout", async () => {
    const container = mount(<CatalogPage kind="models" />)
    await screen.findByRole("link", { name: "large-model" })
    expectLayout(container, "Models list")
  })

  it("Safety scans catalog follows the shared layout", async () => {
    const container = mount(<CatalogPage kind="scans" runId={run.id} />)
    await screen.findByText("scn_01")
    expectLayout(container)
  })

  it("Catalog detail follows the shared layout", async () => {
    const container = mount(<CatalogDetail kind="models" id="mdl_01" />)
    await screen.findByText("large-model")
    expectLayout(container, "Details")
  })

  it("Tools follows the shared layout", async () => {
    const container = mount(<ToolsPage agentId={agent.id} />)
    await screen.findByRole("link", { name: "read_file" })
    expectLayout(container, "Tool list")
  })

  it("Tool detail follows the shared layout", async () => {
    const container = mount(<ToolPage agentId={agent.id} name="read_file" />)
    await screen.findByText("Reads a file from the workspace")
    await screen.findByText(/7 recorded calls/)
    expectLayout(
      container,
      "Definition",
      "Usage",
      "Agent references",
      "Skill bindings"
    )
  })

  it("Runtime settings follows the shared layout", async () => {
    const container = mount(<SettingsPage />)
    await screen.findByText("Behavior rules are stored, not executed")
    await screen.findByText("large-model")
    expectLayout(container, "Runtime capabilities", "Runtime defaults")
  })

  it("Prompt overlays follows the shared layout", async () => {
    const container = mount(<OverlaysPage agentId={agent.id} />)
    await screen.findByText("small-model")
    expectLayout(container, "Overlay list")
  })

  it("Prompt overlay editor follows the shared layout", async () => {
    const container = mount(<OverlaysPage agentId={agent.id} />)
    await screen.findByText("small-model")
    fireEvent.click(screen.getByRole("button", { name: "New overlay" }))
    await screen.findByRole("heading", { level: 2, name: "New host overlay" })
    expectLayout(container, "New host overlay")
  })

  it("Agent messaging list follows the shared layout", async () => {
    const container = mount(<ConversationsPage />)
    await screen.findByRole("link", { name: "cnv_01" })
    expectLayout(container, "Conversation list", "Send an operator message")
  })

  it("Agent messaging conversation follows the shared layout", async () => {
    const container = mount(<ConversationsPage id="cnv_01" />)
    await screen.findByRole("textbox", { name: "Message content" })
    expectLayout(
      container,
      "Conversation",
      "Messages",
      "Send an operator message"
    )
  })

  it("Orchestration runs follows the shared layout", async () => {
    const container = mount(<OrchestrationRunsPage />)
    await screen.findByRole("link", { name: "orn_01" })
    expectLayout(container, "Orchestration run list")
  })

  it("Orchestration run detail follows the shared layout", async () => {
    const container = mount(<OrchestrationRunsPage id="orn_01" />)
    await screen.findByRole("link", { name: "Saved configuration" })
    expectLayout(container, "Details")
  })

  it("Orchestration execute follows the shared layout", async () => {
    const container = mount(<OrchestrationExecute id="orc_01" />)
    await screen.findByRole("textbox", { name: "Orchestration input" })
    expectLayout(container, "Execution")
  })
})
