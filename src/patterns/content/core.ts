import type { Pattern } from '../types';

// Reference example of the pattern format. Other content files follow this shape.

export const CORE_PATTERNS: Pattern[] = [
  {
    id: 'agent-loop',
    category: 'orchestration',
    title: 'The agent loop',
    tagline: 'Model decides, runtime executes, results feed back until done.',
    summary:
      'An agent is a loop: the runtime sends the conversation plus tool definitions to the model; the model either answers or asks for a tool call; the runtime executes the tool and appends the result; repeat. The model never executes anything itself. Every tool call is made by the runtime, with the runtime\'s credentials, which is why identity lives in the runtime and not in the model.',
    whenToUse: [
      'Open-ended tasks where the number of steps is not known in advance.',
      'When the model must choose between tools based on intermediate results.',
    ],
    risks: [
      'Unbounded loops: always cap iterations, tokens and wall-clock time.',
      'Tool results are untrusted input to the next model call (indirect prompt injection).',
      'Cost grows with every turn because the whole transcript is resent.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'agent', label: 'Agent runtime', kind: 'agent', sub: 'loop + tool executor' },
      { id: 'llm', label: 'Model', kind: 'llm', sub: 'messages API' },
      { id: 'tool', label: 'Tool', kind: 'tool', sub: 'get_sales(region)' },
    ],
    variants: [
      {
        id: 'loop',
        label: 'Two-turn loop',
        tone: 'neutral',
        outcome: 'The model asks for one tool call, sees the result, then answers. The runtime did all the I/O.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: '"Q3 sales for EMEA?"', detail: 'The user message arrives at the runtime, which owns the conversation state.' },
          {
            from: 'agent', to: 'llm', kind: 'call', label: 'messages + tool schemas',
            detail: 'The runtime sends the system prompt, history and JSON schemas of the available tools. The model sees descriptions, not credentials.',
            payload: '{"model": "…", "tools": [{"name": "get_sales", "input_schema": {"type": "object", "properties": {"region": {"type": "string"}}}}],\n "messages": [{"role": "user", "content": "Q3 sales for EMEA?"}]}',
          },
          { from: 'llm', to: 'llm', kind: 'think', label: 'decide: need data', detail: 'The model decides it cannot answer from context and emits a structured tool-use request instead of text.' },
          {
            from: 'llm', to: 'agent', kind: 'return', label: 'tool_use get_sales(EMEA)',
            detail: 'Stop reason is tool_use. This is a request, not an action. The runtime may validate, refuse, or ask a human before executing it.',
            payload: '{"stop_reason": "tool_use", "content": [{"type": "tool_use", "id": "tu_1", "name": "get_sales", "input": {"region": "EMEA"}}]}',
          },
          { from: 'agent', to: 'tool', kind: 'call', label: 'GET /sales?region=EMEA', detail: 'The runtime executes the call with its own credential (see the identity map: OBO, M2M, managed identity…).' },
          { from: 'tool', to: 'agent', kind: 'data', label: '{"q3": 4.2M}', detail: 'The tool result is untrusted data. If it contained instructions, the model would read them on the next turn.' },
          {
            from: 'agent', to: 'llm', kind: 'call', label: 'history + tool_result',
            detail: 'The runtime appends the tool result and calls the model again. The full transcript is resent each turn, so cost grows with every iteration.',
            payload: '{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "{\\"q3\\": 4.2M}"}]}',
          },
          { from: 'llm', to: 'agent', kind: 'return', label: 'final answer (end_turn)', detail: 'Stop reason end_turn: the loop exits. A production runtime would also stop on max iterations or budget.' },
          { from: 'agent', to: 'user', kind: 'return', label: '"EMEA Q3 was 4.2M"', detail: 'The answer goes back to the user, ideally with a trace ID linking every model and tool call.' },
        ],
      },
    ],
    sources: [
      { title: 'Anthropic: Building effective agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' },
      { title: 'Anthropic: Tool use overview', url: 'https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview' },
    ],
    tags: ['loop', 'tool use', 'ReAct'],
  },
];
