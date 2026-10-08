import type { Resource } from "./types"
export interface Field {
  key: string
  label: string
  kind?:
    | "text"
    | "prompt"
    | "number"
    | "boolean"
    | "select"
    | "array"
    | "object"
    | "json"
    | "map"
    | "value"
  required?: boolean
  options?: string[]
  ref?: Resource
  fields?: Field[]
  item?: Field
  min?: number
  max?: number
  step?: number
  help?: string
  default?: unknown
}
const text = (
  key: string,
  label: string,
  extra: Partial<Field> = {}
): Field => ({ key, label, ...extra })
const number = (
  key: string,
  label: string,
  min = 0,
  max?: number,
  step = 1
): Field => ({ key, label, kind: "number", min, max, step })
const select = (key: string, label: string, options: string[]): Field => ({
  key,
  label,
  kind: "select",
  options,
})
const ref = (key: string, label: string, resource: Resource): Field => ({
  key,
  label,
  ref: resource,
})
const strings = (key: string, label: string, resource?: Resource): Field => ({
  key,
  label,
  kind: "array",
  item: text("value", label, resource ? { ref: resource } : {}),
})
const rows = (
  key: string,
  label: string,
  fields: Field[],
  help?: string
): Field => ({
  key,
  label,
  kind: "array",
  item: { key: "row", label, kind: "object", fields },
  help,
})
const object = (
  key: string,
  label: string,
  fields: Field[],
  help?: string
): Field => ({ key, label, kind: "object", fields, help })
const unit = (key: string, label: string) => number(key, label, 0, 1, 0.05)
const proficiency = [
  "novice",
  "apprentice",
  "competent",
  "proficient",
  "expert",
]
const common = [
  text("name", "Name", {
    required: true,
    help: "Stable reference name. Use letters, digits, dots, hyphens or underscores.",
  }),
  text("description", "Description"),
]
const metadata: Field = {
  key: "metadata",
  label: "Metadata",
  kind: "json",
  default: {},
}
export const schemas: Record<
  Resource,
  { singular: string; description: string; fields: Field[] }
> = {
  agents: {
    singular: "Agent",
    description: "Saved instructions, composition and execution limits.",
    fields: [
      ...common,
      text("model", "Model"),
      { key: "enabled", label: "Enabled", kind: "boolean", default: true },
      {
        key: "system_prompt",
        label: "System prompt",
        kind: "prompt",
        help: "Sections take precedence when present.",
      },
      number("max_steps", "Maximum steps", 0, 1000),
      number("max_tokens", "Maximum tokens", 0, 1000000),
      number("temperature", "Temperature", 0, 2, 0.05),
      select("reasoning_loop", "Reasoning loop", ["react"]),
      ref("persona_ref", "Persona", "personas"),
      strings("inline_skills", "Inline skills", "skills"),
      strings("inline_traits", "Inline traits", "traits"),
      strings("inline_behaviors", "Inline behaviors (stored)", "behaviors"),
      strings("tools", "Tool allowlist"),
      rows(
        "sections",
        "Prompt sections",
        [
          text("id", "Section ID", { required: true }),
          text("title", "Title"),
          { key: "body", label: "Body", kind: "prompt" },
          number("order", "Order", -1000000, 1000000),
          select("source", "Source", [
            "host",
            "persona",
            "skill",
            "trait",
            "knowledge",
          ]),
          { key: "locked", label: "Locked", kind: "boolean" },
        ],
        "Ordered sections are authoritative. Locked sections accept append overlays only."
      ),
      { key: "guardrails", label: "Guardrails", kind: "json", default: {} },
      metadata,
    ],
  },
  personas: {
    singular: "Persona",
    description: "Identity plus saved skill, trait and behavior assignments.",
    fields: [
      ...common,
      { key: "identity", label: "Identity", kind: "prompt" },
      rows("skills", "Skill assignments", [
        ref("skill_name", "Skill", "skills"),
        select("proficiency", "Proficiency", proficiency),
      ]),
      rows("traits", "Trait assignments", [
        ref("trait_name", "Trait", "traits"),
        {
          key: "dimension_values",
          label: "Dimension overrides",
          kind: "map",
          min: 0,
          max: 1,
          step: 0.05,
        },
      ]),
      strings("behaviors", "Behaviors", "behaviors"),
      object("cognitive_style", "Cognitive style (stored)", [
        rows("phases", "Phases", [
          select("strategy", "Strategy", [
            "analytical",
            "creative",
            "methodical",
            "reactive",
            "reflective",
            "collaborative",
          ]),
          number("max_steps", "Maximum steps"),
          select("transition", "Transition", [
            "after_steps",
            "on_stuck",
            "on_plan_complete",
            "on_error",
          ]),
        ]),
        unit("depth_preference", "Depth preference"),
        unit("focus_preference", "Focus preference"),
        unit("reflection_frequency", "Reflection frequency"),
      ]),
      object("communication_style", "Communication style (stored)", [
        text("tone", "Tone"),
        unit("formality", "Formality"),
        unit("verbosity", "Verbosity"),
        unit("technical_level", "Technical level"),
        { key: "emoji_usage", label: "Emoji usage", kind: "boolean" },
        text("preferred_format", "Preferred format"),
        { key: "adapt_to_user", label: "Adapt to user", kind: "boolean" },
      ]),
      object("perception", "Perception (stored)", [
        unit("context_window", "Context window"),
        unit("detail_orientation", "Detail orientation"),
        rows("attention_filters", "Attention filters", [
          text("name", "Filter name"),
          strings("keywords", "Keywords"),
          strings("patterns", "Patterns"),
          { key: "prompt", label: "Prompt", kind: "prompt" },
        ]),
      ]),
      metadata,
    ],
  },
  skills: {
    singular: "Skill",
    description: "Tool guidance, knowledge sources and prompt fragments.",
    fields: [
      ...common,
      select("default_proficiency", "Default proficiency", proficiency),
      {
        key: "system_prompt_fragment",
        label: "Prompt fragment",
        kind: "prompt",
      },
      rows("tools", "Tool bindings", [
        text("tool_name", "Tool name", { required: true }),
        select("mastery", "Mastery", proficiency),
        text("guidance", "Guidance"),
        text("prefer_when", "Prefer when"),
      ]),
      rows("knowledge", "Knowledge sources", [
        text("source", "Source", { required: true }),
        select("inject_mode", "Injection mode", ["prompt", "tool"]),
        number("priority", "Priority", -1000000, 1000000),
      ]),
      strings("dependencies", "Dependencies", "skills"),
      metadata,
    ],
  },
  traits: {
    singular: "Trait",
    description:
      "Dimensions and declared influences. Prompt injections apply at runtime.",
    fields: [
      ...common,
      select("category", "Category", [
        "personality",
        "workstyle",
        "communication",
        "risk",
      ]),
      rows("dimensions", "Dimensions", [
        text("name", "Dimension name", { required: true }),
        text("low_label", "Low label"),
        text("high_label", "High label"),
        unit("value", "Value"),
      ]),
      rows("influences", "Influences", [
        select("target", "Target", [
          "prompt_injection",
          "temperature",
          "max_steps",
          "tool_selection",
          "response_style",
        ]),
        { key: "value", label: "Value", kind: "value" },
        text("condition", "Condition"),
        unit("weight", "Weight"),
      ]),
      metadata,
    ],
  },
  behaviors: {
    singular: "Behavior",
    description:
      "Saved trigger and action rules. ReAct does not apply these rules yet.",
    fields: [
      ...common,
      number("priority", "Priority", -1000000, 1000000),
      ref("requires_skill", "Required skill", "skills"),
      ref("requires_trait", "Required trait", "traits"),
      rows("triggers", "Triggers", [
        select("type", "Type", [
          "on_input",
          "on_tool_result",
          "on_error",
          "on_step_count",
          "on_context",
          "always",
        ]),
        text("pattern", "Pattern"),
      ]),
      rows("actions", "Actions", [
        select("type", "Type", [
          "inject_prompt",
          "prefer_skill",
          "require_tool",
          "modify_param",
          "switch_cognitive",
          "add_guardrail",
        ]),
        text("target", "Target"),
        { key: "value", label: "Value", kind: "value" },
      ]),
      metadata,
    ],
  },
  orchestrations: {
    singular: "Orchestration",
    description: "Saved multi-agent strategy, participants and settings.",
    fields: [
      ...common,
      select("strategy", "Strategy", [
        "sequential",
        "parallel",
        "hierarchical",
        "debate",
        "router",
      ]),
      rows("participants", "Participants", [
        ref("agent_name", "Agent", "agents"),
        text("role", "Role"),
        strings("skills", "Skills (advisory)", "skills"),
      ]),
      object("settings", "Settings", [
        number("max_concurrency", "Maximum concurrency"),
        number("rounds", "Rounds"),
        ref("manager", "Manager", "agents"),
        ref("judge", "Judge", "agents"),
        ref("aggregator", "Aggregator", "agents"),
        ref("router_agent", "Router agent", "agents"),
        {
          key: "router_rules",
          label: "Router rules",
          kind: "json",
          default: {},
        },
        text("model", "Decision model"),
      ]),
      metadata,
    ],
  },
}
export const overlayFields: Field[] = [
  rows("patches", "Patches", [
    text("id", "Section ID", { required: true }),
    select("mode", "Mode", ["append", "replace"]),
    { key: "body", label: "Body", kind: "prompt" },
  ]),
  strings("tools_added", "Tools added"),
  strings("tools_removed", "Tools removed"),
  text("model", "Model"),
  number("temperature", "Temperature", 0, 2, 0.05),
  number("max_tokens", "Maximum tokens", 0, 1000000),
]
export function initialFields(fields: Field[]): Record<string, unknown> {
  return Object.fromEntries(
    fields
      .filter((f) => f.default !== undefined)
      .map((f) => [f.key, structuredClone(f.default)])
  )
}
