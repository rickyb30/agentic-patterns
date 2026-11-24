import type { Source } from '../model/types';

/**
 * A pattern is an animated sequence diagram: actors across the top, steps flowing between them.
 * Patterns are pure content; one player renders all of them.
 */

export type ActorKind =
  | 'user'          // a person using the system
  | 'client'        // UI, chat surface, MCP client host
  | 'agent'         // agent runtime / orchestrator
  | 'llm'           // model endpoint
  | 'tool'          // API or function the agent calls
  | 'mcp'           // MCP server
  | 'gateway'       // API / AI / MCP gateway
  | 'idp'           // identity provider / authorization server
  | 'data'          // database, warehouse, document store
  | 'search'        // search / vector index
  | 'vault'         // secret or token vault
  | 'human'         // approver / reviewer
  | 'attacker'      // adversary or attacker-controlled content
  | 'guard'         // guardrail / policy engine / content filter
  | 'observability' // tracing / logging backend
  | 'sandbox'       // isolated code execution
  | 'queue'         // queue / scheduler / durable store
  | 'memory';       // agent memory store

export interface Actor {
  id: string;
  label: string;
  kind: ActorKind;
  /** Short second line, e.g. "Entra ID" or "Azure AI Search". */
  sub?: string;
}

/**
 * call = request; return = response; token = credential issued or exchanged;
 * think = actor reasons internally (use from === to); event = async notification / callback;
 * approval = a human decision; attack = adversarial content or action;
 * block = a control stops something; data = data read or written.
 */
export type StepKind = 'call' | 'return' | 'token' | 'think' | 'event' | 'approval' | 'attack' | 'block' | 'data';

export interface Step {
  from: string;
  to: string;
  /** Arrow label. Keep it at or under 42 characters. */
  label: string;
  kind: StepKind;
  /** Expert-level explanation shown in the step inspector: 1–3 sentences. */
  detail: string;
  /** Optional sample request, token, JSON or log line. Fictional values only. */
  payload?: string;
  /** Steps with the same group number animate at the same time (parallel fan-out). */
  group?: number;
}

export interface Variant {
  id: string;
  /** Button label, e.g. "Without trimming". */
  label: string;
  steps: Step[];
  /** One sentence: what this variant demonstrates. */
  outcome: string;
  tone: 'good' | 'bad' | 'neutral';
}

export type Category = 'orchestration' | 'identity' | 'data' | 'security' | 'platform';

export interface Pattern {
  id: string;
  category: Category;
  title: string;
  /** One line under the title on the library card. */
  tagline: string;
  /** 2–4 sentences, expert level. */
  summary: string;
  whenToUse: string[];
  risks: string[];
  /** 3–7 actors, left to right in reading order. */
  actors: Actor[];
  /** At least one. Use two or three when a toggle teaches something (e.g. with / without a control). */
  variants: Variant[];
  /** Public documents only. */
  sources: Source[];
  /** Statements not yet checked against current primary docs. */
  verify?: string[];
  tags: string[];
}

export const CATEGORY_LABEL: Record<Category, string> = {
  orchestration: 'Orchestration',
  identity: 'Identity & authorization',
  data: 'Data & retrieval',
  security: 'Security & threats',
  platform: 'Platform & operations',
};
