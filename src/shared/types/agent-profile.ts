/** Structured soul definition — the 6 pillars. */
export interface AgentSoul {
  schema_version: '1.0';
  soul_language?: string;

  identity: {
    role: string;
    core_values: string[];
    worldview?: string;
    opinions?: string[];
  };

  voice: {
    tone: string;
    style_rules: string[];
    greeting?: string;
    example_phrases?: string[];
    anti_patterns?: string[];
  };

  cognition: {
    reasoning_style: string;
    expertise?: string[];
    operating_modes?: Record<string, string>;
    approach_preferences?: string[];
    skill_bundles?: Array<{
      name: string;
      description: string;
      approach: string;
      trigger?: string;
    }>;
  };

  boundaries: {
    red_lines: string[];
    escalation_rules?: string[];
    privacy_rules?: string[];
    action_limits?: string[];
  };

  continuity?: {
    session_notes?: string[];
  };

  evolution?: {
    self_improving: boolean;
    max_corrections: number;
    max_learnings: number;
    last_evolved_at?: string;
  };
}

/** Keep in sync with SoulOrigin in src-api/src/shared/db/types.ts */
export type SoulOrigin = 'predefined' | 'user' | 'evolved' | 'imported';

/** Agent profile as returned by the backend API (GET /db/agent-profiles). */
export interface AgentProfile {
  id: string;
  name: string;
  role: string | null;
  description: string | null;
  avatar_color: string | null;
  avatar_icon: string | null;
  runtime_id: string | null;
  default_model: string | null;
  default_mcp_servers: string | null;
  default_skills: string | null;
  system_prompt: string | null;
  soul: string | null;
  soul_version: number;
  soul_origin: SoulOrigin;
  max_concurrent_tasks: number;
  default_thinking_config: string | null;
  routing_hints: string | null;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
  updated_at: string;
  /** Enriched by the list endpoint — not a stored column. */
  task_count?: number;
}
