export interface Scope {
  levels: { key: string; value: string }[]
}
export interface Entity {
  id: string
  name: string
  description?: string
  scope: Scope
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
}
export interface Section {
  id: string
  source?: string
  title?: string
  body: string
  order: number
  locked?: boolean
}
export interface Agent extends Entity {
  system_prompt: string
  model?: string
  tools?: string[]
  max_steps?: number
  max_tokens?: number
  temperature?: number
  reasoning_loop?: string
  guardrails?: Record<string, unknown>
  enabled: boolean
  persona_ref?: string
  inline_skills?: string[]
  inline_traits?: string[]
  inline_behaviors?: string[]
  sections?: Section[]
}
export interface Persona extends Entity {
  identity: string
  skills?: { skill_name: string; proficiency?: string }[]
  traits?: { trait_name: string; dimension_values?: Record<string, number> }[]
  behaviors?: string[]
  cognitive_style?: {
    phases?: { strategy: string; max_steps?: number; transition?: string }[]
    depth_preference?: number
    focus_preference?: number
    reflection_frequency?: number
  }
  communication_style?: {
    tone?: string
    formality?: number
    verbosity?: number
    technical_level?: number
    emoji_usage?: boolean
    preferred_format?: string
    adapt_to_user?: boolean
  }
  perception?: {
    attention_filters?: {
      name: string
      keywords?: string[]
      patterns?: string[]
      prompt?: string
    }[]
    context_window?: number
    detail_orientation?: number
  }
}
export interface Skill extends Entity {
  tools?: {
    tool_name: string
    mastery?: string
    guidance?: string
    prefer_when?: string
  }[]
  knowledge?: { source: string; inject_mode?: string; priority?: number }[]
  system_prompt_fragment?: string
  dependencies?: string[]
  default_proficiency?: string
}
export interface Trait extends Entity {
  category?: string
  dimensions?: {
    name: string
    low_label: string
    high_label: string
    value: number
  }[]
  influences?: {
    target: string
    value: unknown
    condition?: string
    weight?: number
  }[]
}
export interface Behavior extends Entity {
  priority?: number
  requires_skill?: string
  requires_trait?: string
  triggers?: { type: string; pattern?: string }[]
  actions?: { type: string; target?: string; value?: unknown }[]
}
export interface Orchestration extends Entity {
  strategy: string
  participants: { agent_name: string; role?: string; skills?: string[] }[]
  settings?: Record<string, unknown>
}
export type ConfigRecord =
  Agent | Persona | Skill | Trait | Behavior | Orchestration
export type Resource =
  "agents" | "personas" | "skills" | "traits" | "behaviors" | "orchestrations"
export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
export interface MorePage<T> {
  items: T[]
  has_more: boolean
  limit: number
  offset: number
}
export interface Run {
  id: string
  agent_id: string
  session_id?: string
  scope: Scope
  state: string
  input: string
  output?: string
  error?: string
  step_count: number
  tokens_used: number
  started_at?: string
  completed_at?: string
  created_at: string
  persona_ref?: string
  metadata?: Record<string, unknown>
}
export interface Step {
  id: string
  run_id: string
  index: number
  type: string
  input?: string
  output?: string
  tokens_used: number
  started_at?: string
  completed_at?: string
  created_at: string
}
export interface ToolCall {
  id: string
  tool_name: string
  arguments: string
  result?: string
  error?: string
  duration_ms?: number
  state?: string
}
export interface RunDetail {
  run: Run
  steps: Step[]
  tool_calls: Record<string, ToolCall[]>
  suspension?: {
    reason: string
    pending: { id: string; name: string; arguments: string }[]
  }
}
export interface Checkpoint {
  id: string
  run_id: string
  agent_id: string
  scope: Scope
  reason: string
  step_index: number
  state: string
  created_at: string
  decision?: {
    approved: boolean
    decided_by?: string
    reason?: string
    decided_at: string
  }
}
export interface Session {
  id: string
  agent_id: string
  title: string
  is_default: boolean
  message_count: number
  token_count: number
  scope: Scope
  created_at: string
  updated_at: string
  metadata?: Record<string, unknown>
}
export interface Message {
  role: string
  content: string
  timestamp: string
  tool_calls?: unknown[]
  tool_call_id?: string
}
export interface Memory {
  session: Session
  messages: Message[]
  complete: boolean
}
export interface Runtime {
  scope: Scope
  llm: boolean
  execution_label: string
  safety: boolean
  knowledge: boolean
  tool_authorizer: boolean
  audit: boolean
  a2a: boolean
  plugins: string[]
  limitations: string[]
}
export interface ToolDefinition {
  Name: string
  Description: string
  Parameters: unknown
}
export interface LiveEvent {
  event: string
  data: Record<string, unknown>
}
export interface LiveFeed {
  events: LiveEvent[]
  next: number
  lost: boolean
  done: boolean
  available: boolean
}
export interface Catalog {
  available: boolean
  reason?: string
  items: Record<string, unknown>[]
  total?: number
  complete?: boolean
  [key: string]: unknown
}
export interface Conversation {
  id: string
  scope: Scope
  status: string
  topic?: string
  participants?: { agent: string; node?: string }[]
  hops_used: number
  hop_ceiling: number
  created_at: string
}
export interface Envelope {
  id: string
  sender: { agent: string; node?: string }
  receivers: { agent: string; node?: string }[]
  content: string
  performative: string
  created_at: string
  in_reply_to?: string
  reply_with?: string
}
export interface Overlay {
  id: string
  agent_id: string
  scope: Scope
  patches?: {
    id: string
    body: string
    mode?: string
    title?: string
    order?: number
  }[]
  tools_added?: string[]
  tools_removed?: string[]
  model?: string
  temperature?: number
  max_tokens?: number
}
