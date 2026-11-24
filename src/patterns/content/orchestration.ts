import type { Pattern } from '../types';

const ANTHROPIC_BEA = { title: 'Anthropic: Building effective agents', url: 'https://www.anthropic.com/engineering/building-effective-agents' };
const AZURE_PATTERNS = {
  title: 'Azure Architecture Center: AI agent orchestration patterns',
  url: 'https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns',
};
const LANGGRAPH_HITL = {
  title: 'LangGraph: Human-in-the-loop concepts',
  url: 'https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/',
};

export const ORCHESTRATION_PATTERNS: Pattern[] = [
  // 1. Prompt chaining
  {
    id: 'prompt-chaining',
    category: 'orchestration',
    title: 'Prompt chaining with a gate',
    tagline: 'Fixed sequence of model calls; code checks each output before the next step.',
    summary:
      'Prompt chaining decomposes a task into a fixed sequence of model calls, where each call consumes the previous output. The value comes from the programmatic gate between steps: plain code (schema validation, length checks, regex, a unit test) decides whether the intermediate result is good enough to continue. You trade extra latency and calls for higher accuracy per step and a cheap, deterministic place to stop early before spending tokens on downstream steps.',
    whenToUse: [
      'The task splits cleanly into fixed subtasks known at design time (outline, then draft, then translate).',
      'An intermediate output can be checked by code, so failures are caught before they compound.',
      'Each step is easier for the model than the whole task in one prompt.',
    ],
    risks: [
      'Latency is the sum of all steps; chains of 4+ calls are noticeable in interactive UIs.',
      'Errors compound: a subtly wrong step 1 that passes the gate poisons every later step.',
      'Gates that call another model are no longer deterministic; prefer code checks where possible.',
      'Rigid: if inputs vary widely, a fixed chain wastes calls on steps that do not apply.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'app', label: 'Workflow code', kind: 'agent', sub: 'fixed chain' },
      { id: 'llm', label: 'Model', kind: 'llm', sub: 'messages API' },
      { id: 'gate', label: 'Gate', kind: 'guard', sub: 'JSON schema + rules' },
    ],
    variants: [
      {
        id: 'gate-passes',
        label: 'Gate passes',
        tone: 'good',
        outcome: 'The outline passes the code check, so the chain continues to the draft step and returns a result.',
        steps: [
          { from: 'user', to: 'app', kind: 'call', label: 'Write release notes for v2.4', detail: 'The request enters a hard-coded workflow. The sequence of steps is decided by the developer, not by the model.' },
          {
            from: 'app', to: 'llm', kind: 'call', label: 'Step 1: extract changes as JSON',
            detail: 'The first prompt is narrow: produce a structured list of changes. Narrow prompts are easier to get right and easier to check.',
            payload: '{"system": "Return JSON: {\\"changes\\": [{\\"type\\": \\"feat|fix\\", \\"summary\\": string}]}", "messages": [{"role": "user", "content": "<commit log for v2.4>"}]}',
          },
          { from: 'llm', to: 'app', kind: 'return', label: 'changes[] (7 items)', detail: 'The output is an intermediate artefact, not something the user sees yet.' },
          {
            from: 'app', to: 'gate', kind: 'call', label: 'validate schema + rules',
            detail: 'The gate is plain code: parse JSON, validate against a schema, check 1 to 30 items and no empty summaries. It costs microseconds and no tokens.',
            payload: 'gate.check(step1) -> schema_ok=true items=7 empty_summaries=0 verdict=PASS',
          },
          { from: 'gate', to: 'app', kind: 'return', label: 'PASS', detail: 'Only a passing artefact is fed forward. This is the main reason chaining beats one big prompt: you get a checkpoint you can trust.' },
          { from: 'app', to: 'llm', kind: 'call', label: 'Step 2: draft notes from changes[]', detail: 'The second call sees only the validated JSON, not the raw commit log, which keeps its context small and focused.' },
          { from: 'llm', to: 'app', kind: 'return', label: 'markdown draft', detail: 'A further gate (length, required headings) could run here; each gate is a place to stop cheaply.' },
          { from: 'app', to: 'user', kind: 'return', label: 'Release notes', detail: 'Total latency is roughly the sum of both model calls plus negligible gate time.' },
        ],
      },
      {
        id: 'gate-fails',
        label: 'Gate fails, stop early',
        tone: 'neutral',
        outcome: 'The gate rejects malformed output, so the chain stops before spending tokens on downstream steps.',
        steps: [
          { from: 'user', to: 'app', kind: 'call', label: 'Write release notes for v2.4', detail: 'Same request, same fixed workflow.' },
          { from: 'app', to: 'llm', kind: 'call', label: 'Step 1: extract changes as JSON', detail: 'Same narrow extraction prompt as before.' },
          { from: 'llm', to: 'app', kind: 'return', label: 'prose, not JSON', detail: 'The model ignored the format instruction, for example because the commit log was empty or unusual. Structured-output modes reduce this but do not remove semantic failures.' },
          {
            from: 'app', to: 'gate', kind: 'call', label: 'validate schema + rules',
            detail: 'The deterministic check catches the problem immediately instead of letting step 2 hallucinate notes from garbage.',
            payload: 'gate.check(step1) -> error="JSONDecodeError at pos 0" verdict=FAIL',
          },
          { from: 'gate', to: 'app', kind: 'block', label: 'FAIL: not valid JSON', detail: 'The workflow decides the policy: retry step 1 once, fall back, or stop. Retrying blindly can double cost for the same failure.' },
          { from: 'app', to: 'app', kind: 'think', label: 'stop: skip step 2', detail: 'Stopping early saves the downstream call and avoids returning confident but wrong output. Log the failing input so the prompt can be fixed.' },
          { from: 'app', to: 'user', kind: 'return', label: 'Could not parse changes; retry?', detail: 'A clear failure is better than a fluent wrong answer. The user or an operator can inspect the logged input.' },
        ],
      },
    ],
    sources: [ANTHROPIC_BEA],
    tags: ['workflow', 'chaining', 'gate', 'sequential'],
  },

  // 2. Routing
  {
    id: 'routing',
    category: 'orchestration',
    title: 'Routing',
    tagline: 'Classify the input first, then send it to the prompt or model built for it.',
    summary:
      'Routing puts a cheap classification step in front of several specialised handlers. The classifier (a small model, a fine-tuned classifier, or rules) labels the input; code then dispatches to a prompt and model tuned for that class. This separates concerns, so optimising the handler for one class does not regress another, and it lets you send easy traffic to a fast, cheap model while reserving a stronger model for hard cases.',
    whenToUse: [
      'Inputs fall into distinct categories that need different prompts, tools or models.',
      'Most traffic is easy and a minority is hard, so model tiering saves meaningful cost.',
      'Classification can be done accurately (measure it; it is the single point of failure).',
    ],
    risks: [
      'Misrouting is silent: a hard question sent to the cheap model gets a confident shallow answer.',
      'The classifier adds a round trip; use the smallest model or a non-LLM classifier where possible.',
      'Routes drift as traffic changes; keep labelled samples and re-evaluate the router regularly.',
      'Users can try to steer the classifier ("this is a simple question") to reach a different handler.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'router', label: 'Router', kind: 'agent', sub: 'dispatch code' },
      { id: 'classifier', label: 'Classifier', kind: 'llm', sub: 'small, fast model' },
      { id: 'faq', label: 'FAQ handler', kind: 'llm', sub: 'small model + FAQ prompt' },
      { id: 'expert', label: 'Expert handler', kind: 'llm', sub: 'large model + tools' },
    ],
    variants: [
      {
        id: 'easy',
        label: 'Easy question',
        tone: 'good',
        outcome: 'An FAQ is classified as simple and answered by the cheap model at a fraction of the cost.',
        steps: [
          { from: 'user', to: 'router', kind: 'call', label: '"How do I reset my password?"', detail: 'All traffic enters through the router; handlers are never called directly.' },
          {
            from: 'router', to: 'classifier', kind: 'call', label: 'classify: faq | billing | complex',
            detail: 'A short prompt with a closed label set and structured output. Keep it small: it runs on every request, so its latency is added to everything.',
            payload: '{"system": "Classify the request. Reply with {\\"route\\": \\"faq|billing|complex\\", \\"confidence\\": 0-1}.", "messages": [{"role": "user", "content": "How do I reset my password?"}]}',
          },
          { from: 'classifier', to: 'router', kind: 'return', label: '{"route":"faq","confidence":0.97}', detail: 'A confidence threshold lets code send low-confidence cases to the stronger route by default, trading cost for safety.' },
          { from: 'router', to: 'faq', kind: 'call', label: 'FAQ prompt + help-centre snippets', detail: 'The FAQ handler has its own prompt tuned only for this class, so changing it cannot regress billing or complex answers.' },
          { from: 'faq', to: 'router', kind: 'return', label: 'answer + link', detail: 'Small models answer well-scoped FAQs adequately with much lower latency and cost per token.' },
          {
            from: 'router', to: 'user', kind: 'return', label: 'Reset steps', detail: 'Log the route with the trace so misroutes can be found later from user feedback.',
            payload: 'route=faq model=small in_tok=410 out_tok=96 latency_ms=620',
          },
        ],
      },
      {
        id: 'hard',
        label: 'Hard question',
        tone: 'neutral',
        outcome: 'A multi-part question is classified as complex and escalated to the stronger, slower model with tools.',
        steps: [
          { from: 'user', to: 'router', kind: 'call', label: '"Why was I charged twice in May?"', detail: 'Same entry point. The router does not know yet how hard the question is.' },
          { from: 'router', to: 'classifier', kind: 'call', label: 'classify: faq | billing | complex', detail: 'Same classifier, same cost per request regardless of the eventual route.' },
          { from: 'classifier', to: 'router', kind: 'return', label: '{"route":"complex","confidence":0.71}', detail: 'Moderate confidence. A sensible policy escalates when unsure: the cost of an extra strong-model call is lower than a wrong billing answer.' },
          { from: 'router', to: 'expert', kind: 'call', label: 'expert prompt + billing tools', detail: 'The expert route gets a larger model and access to account tools that the FAQ route deliberately lacks.' },
          { from: 'expert', to: 'expert', kind: 'think', label: 'plan: look up invoices, compare', detail: 'The stronger model can reason over multiple tool results. It is slower and more expensive per token, which is why only some traffic should land here.' },
          {
            from: 'expert', to: 'router', kind: 'return', label: 'explanation + refund option', detail: 'The answer quality justifies the cost on this class of request.',
            payload: 'route=complex model=large in_tok=5120 out_tok=640 tool_calls=2 latency_ms=7400',
          },
          { from: 'router', to: 'user', kind: 'return', label: 'Duplicate charge explained', detail: 'Compare per-route cost and satisfaction to tune the threshold between cheap and strong routes.' },
        ],
      },
    ],
    sources: [ANTHROPIC_BEA],
    tags: ['workflow', 'routing', 'classification', 'model tiering', 'cost'],
  },

  // 3. Parallelization
  {
    id: 'parallelization',
    category: 'orchestration',
    title: 'Parallelization: sectioning and voting',
    tagline: 'Run independent calls at once, then aggregate in code.',
    summary:
      'Parallelization runs several model calls concurrently and combines the results programmatically. Sectioning splits a task into independent parts (for example, answer the user while a separate call screens for policy violations) so each call has one focus and wall-clock latency is the slowest branch, not the sum. Voting runs the same task several times, possibly with different prompts, and aggregates the answers to gain confidence; you pay N times the tokens to reduce variance.',
    whenToUse: [
      'Subtasks are truly independent and can run without seeing each other\'s output (sectioning).',
      'A guardrail check can run alongside the main call instead of before it, hiding its latency.',
      'You need higher confidence on a judgement call and can afford N times the tokens (voting).',
    ],
    risks: [
      'Rate limits: fan-out multiplies concurrent requests and can trigger 429s that serialise you anyway.',
      'Voting does not fix systematic bias: N samples of the same wrong belief still agree.',
      'Aggregation logic (thresholds, tie-breaks) is a design decision with real false-positive/negative trade-offs.',
      'Partial failure: decide whether one failed branch fails the whole request or degrades gracefully.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'app', label: 'Workflow code', kind: 'agent', sub: 'fan-out + aggregate' },
      { id: 'llm-a', label: 'Model call A', kind: 'llm' },
      { id: 'llm-b', label: 'Model call B', kind: 'llm' },
      { id: 'llm-c', label: 'Model call C', kind: 'llm' },
    ],
    variants: [
      {
        id: 'sectioning',
        label: 'Sectioning',
        tone: 'good',
        outcome: 'Answering and guardrail screening run concurrently; latency is the slowest branch and the guard can still veto.',
        steps: [
          { from: 'user', to: 'app', kind: 'call', label: 'Question about a contract clause', detail: 'The workflow splits the work into independent sections decided in code, not by the model.' },
          { from: 'app', to: 'llm-a', kind: 'call', label: 'A: answer the question', detail: 'Branch A only answers. It does not also have to police itself, which tends to degrade both jobs.', group: 1 },
          { from: 'app', to: 'llm-b', kind: 'call', label: 'B: screen input for policy issues', detail: 'Branch B is a guardrail running in parallel. Running it first would add its full latency to every request.', group: 1 },
          { from: 'app', to: 'llm-c', kind: 'call', label: 'C: extract cited clause numbers', detail: 'Branch C produces structured metadata for the UI. It needs nothing from A or B, so it can run at the same time.', group: 1 },
          { from: 'llm-b', to: 'app', kind: 'return', label: '{"allowed": true}', detail: 'Results arrive in any order. Code waits for all branches (or a timeout) before assembling.', group: 2 },
          { from: 'llm-c', to: 'app', kind: 'return', label: '{"clauses": ["4.2", "7.1"]}', detail: 'Small structured outputs come back quickly.', group: 2 },
          { from: 'llm-a', to: 'app', kind: 'return', label: 'answer text', detail: 'The longest branch determines wall-clock latency.', group: 2 },
          {
            from: 'app', to: 'app', kind: 'think', label: 'aggregate: guard allows, merge',
            detail: 'Aggregation is deterministic code. If the guard had said no, the answer from A would be discarded, so you pay for A even when it is thrown away.',
            payload: 'fanout=3 wall_ms=2300 (A=2300 B=900 C=700) sum_ms=3900 guard=allowed',
          },
          { from: 'app', to: 'user', kind: 'return', label: 'Answer + clause links', detail: 'The user sees one response; the three calls are an implementation detail visible only in the trace.' },
        ],
      },
      {
        id: 'voting',
        label: 'Voting',
        tone: 'neutral',
        outcome: 'Three independent reviews of the same code are aggregated by threshold; cost triples for a more stable verdict.',
        steps: [
          { from: 'user', to: 'app', kind: 'call', label: 'Review this diff for vulnerabilities', detail: 'A judgement task where a single sample can be noisy. Voting trades tokens for variance reduction.' },
          { from: 'app', to: 'llm-a', kind: 'call', label: 'Review prompt v1', detail: 'Same task, possibly with varied prompts or temperature so the samples are not identical.', group: 1 },
          { from: 'app', to: 'llm-b', kind: 'call', label: 'Review prompt v2', detail: 'Prompt diversity helps more than repeated identical samples, which tend to agree on the same mistakes.', group: 1 },
          { from: 'app', to: 'llm-c', kind: 'call', label: 'Review prompt v3', detail: 'N = 3 here. More voters give diminishing returns relative to cost.', group: 1 },
          { from: 'llm-a', to: 'app', kind: 'return', label: 'vulnerable: SQL injection', detail: 'Each voter returns a structured verdict so code can count them.', group: 2 },
          { from: 'llm-b', to: 'app', kind: 'return', label: 'vulnerable: SQL injection', detail: 'Agreement across differently phrased prompts is a stronger signal than agreement across identical ones.', group: 2 },
          { from: 'llm-c', to: 'app', kind: 'return', label: 'not vulnerable', detail: 'Disagreement is information: it marks the case as borderline and worth a human look.', group: 2 },
          {
            from: 'app', to: 'app', kind: 'think', label: 'aggregate: 2 of 3 flag it',
            detail: 'The threshold is a product decision. "Any one flags" maximises recall for security; "majority" reduces false positives for content moderation.',
            payload: '{"votes": {"vulnerable": 2, "clean": 1}, "policy": "flag_if_any", "result": "FLAG", "cost_multiplier": 3}',
          },
          { from: 'app', to: 'user', kind: 'return', label: 'Flagged: likely SQL injection', detail: 'Report the vote split, not just the verdict, so reviewers can see how confident the system was.' },
        ],
      },
    ],
    sources: [ANTHROPIC_BEA, AZURE_PATTERNS],
    tags: ['workflow', 'parallel', 'sectioning', 'voting', 'concurrent', 'fan-out'],
  },

  // 4. Orchestrator-workers
  {
    id: 'orchestrator-workers',
    category: 'orchestration',
    title: 'Orchestrator-workers',
    tagline: 'A lead model plans subtasks at runtime, delegates them, and synthesises.',
    summary:
      'In orchestrator-workers, a central model breaks the task into subtasks that are not known in advance, delegates each to a worker call, and synthesises the results. It looks like sectioning, but the split is decided by the model per input rather than hard-coded, which is what makes it suitable for tasks like multi-file code changes or research across an unknown number of sources. The price is less predictability: the number of calls, cost and latency now depend on the plan the model produces.',
    whenToUse: [
      'The subtasks depend on the input and cannot be enumerated at design time.',
      'Each subtask benefits from a fresh, focused context rather than one long shared transcript.',
      'A final synthesis step can reconcile partial results into one answer.',
    ],
    risks: [
      'Unbounded fan-out: cap the number of subtasks and total tokens, or one prompt can spawn dozens of workers.',
      'Lossy handoffs: workers see only the brief the orchestrator writes, so vague briefs cause duplicated or missed work.',
      'Synthesis can paper over conflicting worker results; ask workers for evidence, not just conclusions.',
      'Harder to test and debug than fixed workflows; trace every worker call under one parent span.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'orch', label: 'Orchestrator', kind: 'agent', sub: 'plans + synthesises' },
      { id: 'llm', label: 'Lead model', kind: 'llm' },
      { id: 'w1', label: 'Worker 1', kind: 'agent', sub: 'own context' },
      { id: 'w2', label: 'Worker 2', kind: 'agent', sub: 'own context' },
      { id: 'repo', label: 'Code repository', kind: 'data' },
    ],
    variants: [
      {
        id: 'dynamic-plan',
        label: 'Dynamic plan',
        tone: 'neutral',
        outcome: 'The lead model decides at runtime that two files need changes, delegates them, and merges the results.',
        steps: [
          { from: 'user', to: 'orch', kind: 'call', label: 'Rename field user_id to account_id', detail: 'The number of files affected is unknown until the code is inspected, which rules out a fixed workflow.' },
          { from: 'orch', to: 'repo', kind: 'call', label: 'search "user_id"', detail: 'The orchestrator gathers enough context to plan. It does not read every file in full, which would blow its context.' },
          { from: 'repo', to: 'orch', kind: 'data', label: '2 files, 14 matches', detail: 'Search results feed the planning prompt.' },
          {
            from: 'orch', to: 'llm', kind: 'call', label: 'plan subtasks (max 5)',
            detail: 'The plan is model-generated but bounded by code: a cap on subtasks and a required structured format.',
            payload: '{"system": "Split into at most 5 independent subtasks. Return JSON.", "messages": [{"role": "user", "content": "Rename user_id -> account_id. Matches: models/user.py (6), api/routes.py (8)"}]}',
          },
          {
            from: 'llm', to: 'orch', kind: 'return', label: '2 subtasks with briefs',
            detail: 'Each brief must be self-contained: objective, files, constraints, expected output format. Workers do not see the orchestrator\'s history.',
            payload: '{"subtasks": [{"id": "s1", "file": "models/user.py", "brief": "Rename field and update ORM column mapping; keep DB column name."}, {"id": "s2", "file": "api/routes.py", "brief": "Rename in handlers and response schema; keep old key as deprecated alias."}]}',
          },
          { from: 'orch', to: 'w1', kind: 'call', label: 's1: models/user.py', detail: 'Workers run concurrently when subtasks are independent. Each starts with a fresh context containing only its brief and file.', group: 1 },
          { from: 'orch', to: 'w2', kind: 'call', label: 's2: api/routes.py', detail: 'Separate contexts keep each worker focused and avoid one long transcript that degrades quality.', group: 1 },
          { from: 'w1', to: 'orch', kind: 'return', label: 'diff for models/user.py', detail: 'Workers return artefacts (diffs, findings with evidence), not just prose claims of success.', group: 2 },
          { from: 'w2', to: 'orch', kind: 'return', label: 'diff for api/routes.py', detail: 'If a worker fails or times out, the orchestrator can re-plan or report a partial result.', group: 2 },
          { from: 'orch', to: 'llm', kind: 'call', label: 'synthesise + check consistency', detail: 'The synthesis call sees both diffs and checks they agree, for example that the deprecated alias in s2 matches the model in s1.' },
          { from: 'llm', to: 'orch', kind: 'return', label: 'combined change summary', detail: 'Running the test suite here, in code, is a stronger check than asking the model whether it worked.' },
          {
            from: 'orch', to: 'user', kind: 'return', label: 'PR with 2 files changed', detail: 'Cost depends on the plan: two workers here, but the same prompt on a larger repo might produce five.',
            payload: 'run=r-1042 subtasks=2 model_calls=4 total_tokens=18400 wall_ms=21000',
          },
        ],
      },
    ],
    sources: [ANTHROPIC_BEA, AZURE_PATTERNS],
    tags: ['orchestrator', 'workers', 'delegation', 'dynamic planning', 'multi-agent'],
  },

  // 5. Evaluator-optimizer
  {
    id: 'evaluator-optimizer',
    category: 'orchestration',
    title: 'Evaluator-optimizer loop',
    tagline: 'One call generates, another critiques against criteria, repeat until pass or cap.',
    summary:
      'A generator produces a candidate and an evaluator scores it against explicit criteria, returning actionable feedback; the generator revises and the loop repeats. It works when clear criteria exist and feedback measurably improves the output, much like a human editor. Every iteration adds two calls and grows the context, so a hard iteration cap and a defined fallback are part of the pattern, not an afterthought.',
    whenToUse: [
      'Evaluation criteria are explicit and checkable (style guide, test cases, required facts).',
      'A first draft is usually close and specific feedback fixes it.',
      'Quality matters more than latency, for example translation or long-form drafting.',
    ],
    risks: [
      'Non-convergence: feedback can oscillate between two drafts forever without a cap.',
      'Self-agreement: the same model evaluating its own output tends to be lenient; use a different prompt, model or a code check.',
      'Evaluator drift: vague criteria let the evaluator invent new objections each round.',
      'Cost and latency scale linearly with iterations, and context grows each round.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'loop', label: 'Loop controller', kind: 'agent', sub: 'max_iterations = 3' },
      { id: 'gen', label: 'Generator', kind: 'llm' },
      { id: 'eval', label: 'Evaluator', kind: 'llm', sub: 'rubric prompt' },
    ],
    variants: [
      {
        id: 'converges',
        label: 'Converges',
        tone: 'good',
        outcome: 'The second draft meets every criterion and the loop exits well before the cap.',
        steps: [
          { from: 'user', to: 'loop', kind: 'call', label: 'Translate notice to French, formal', detail: 'The controller is code. It owns the iteration count and the exit conditions, not the models.' },
          { from: 'loop', to: 'gen', kind: 'call', label: 'iter 1: generate draft', detail: 'The generator gets the task and, on later rounds, the previous draft plus feedback.' },
          { from: 'gen', to: 'loop', kind: 'return', label: 'draft v1', detail: 'A first attempt; good enough to critique, not necessarily to ship.' },
          {
            from: 'loop', to: 'eval', kind: 'call', label: 'score v1 against rubric',
            detail: 'The evaluator uses explicit criteria and must return structured pass/fail per criterion with specific fixes. Free-form critique is hard to act on and hard to stop.',
            payload: '{"criteria": ["formal register (vous)", "no anglicisms", "dates in DD/MM/YYYY", "meaning preserved"], "draft": "<v1>"}',
          },
          {
            from: 'eval', to: 'loop', kind: 'return', label: 'FAIL: 2 of 4 criteria',
            detail: 'Actionable feedback names the exact problem. The controller checks the structured verdict, not the tone of the critique.',
            payload: '{"pass": false, "failed": [{"criterion": "formal register", "fix": "line 2 uses tu; use vous"}, {"criterion": "dates", "fix": "11/23/2026 -> 23/11/2026"}]}',
          },
          { from: 'loop', to: 'gen', kind: 'call', label: 'iter 2: revise with feedback', detail: 'Only the feedback and the last draft are passed, not the whole history, to keep context and cost from growing every round.' },
          { from: 'gen', to: 'loop', kind: 'return', label: 'draft v2', detail: 'The revision targets the named failures.' },
          { from: 'loop', to: 'eval', kind: 'call', label: 'score v2 against rubric', detail: 'Same rubric each round. Changing criteria mid-loop is a common cause of non-convergence.' },
          { from: 'eval', to: 'loop', kind: 'return', label: 'PASS: 4 of 4', detail: 'All criteria pass, so the controller exits.' },
          {
            from: 'loop', to: 'user', kind: 'return', label: 'Final translation (2 iterations)', detail: 'Four model calls in total. Record the iteration count; a rising average signals a prompt or criteria problem.',
            payload: 'loop=translate iterations=2 exit=criteria_passed calls=4',
          },
        ],
      },
      {
        id: 'hits-cap',
        label: 'Hits the cap',
        tone: 'bad',
        outcome: 'Feedback oscillates between two fixes; the iteration cap stops the loop and returns the best draft flagged for review.',
        steps: [
          { from: 'user', to: 'loop', kind: 'call', label: 'Summarise in 50 words, keep all 6 facts', detail: 'The criteria conflict: six facts may not fit in 50 words. Loops with conflicting criteria cannot converge.' },
          { from: 'loop', to: 'gen', kind: 'call', label: 'iter 1: generate', detail: 'First draft.' },
          { from: 'gen', to: 'loop', kind: 'return', label: 'draft v1 (71 words)', detail: 'All six facts, but too long.' },
          { from: 'loop', to: 'eval', kind: 'call', label: 'score v1', detail: 'Same rubric every round: length <= 50 words, all 6 facts present.' },
          { from: 'eval', to: 'loop', kind: 'return', label: 'FAIL: 71 words', detail: 'The evaluator asks for a shorter draft.' },
          { from: 'loop', to: 'gen', kind: 'call', label: 'iter 2: shorten', detail: 'The generator cuts words and drops facts to comply.' },
          { from: 'gen', to: 'loop', kind: 'return', label: 'draft v2 (48 words)', detail: 'Short enough, but two facts are gone.' },
          { from: 'loop', to: 'eval', kind: 'call', label: 'score v2', detail: 'Context grows each round if the controller passes full history; here it passes only the last draft and feedback.' },
          { from: 'eval', to: 'loop', kind: 'return', label: 'FAIL: missing 2 facts', detail: 'Now the other criterion fails. This is oscillation: each fix breaks the other constraint.' },
          { from: 'loop', to: 'gen', kind: 'call', label: 'iter 3: restore facts', detail: 'The generator adds the facts back and the draft grows again.' },
          { from: 'gen', to: 'loop', kind: 'return', label: 'draft v3 (64 words)', detail: 'Closer, still over the limit.' },
          { from: 'loop', to: 'eval', kind: 'call', label: 'score v3', detail: 'Third evaluation, sixth model call.' },
          {
            from: 'eval', to: 'loop', kind: 'return', label: 'FAIL: 64 words',
            detail: 'Third failure. Without a cap this would continue, burning tokens on each round with no progress.',
            payload: 'iter=1 fail=[length:71] | iter=2 fail=[facts:4/6] | iter=3 fail=[length:64]',
          },
          { from: 'loop', to: 'loop', kind: 'block', label: 'max_iterations=3 reached', detail: 'The cap is enforced in code. Pick the draft with the fewest failed criteria rather than the last one.' },
          {
            from: 'loop', to: 'user', kind: 'return', label: 'Best draft + "needs review" flag',
            detail: 'Surface the unresolved criteria so a human can relax one. Repeated cap hits on a task type usually mean the criteria, not the model, need fixing.',
            payload: '{"status": "max_iterations", "best_iteration": 3, "unmet": ["length <= 50 words"], "calls": 6}',
          },
        ],
      },
    ],
    sources: [ANTHROPIC_BEA],
    tags: ['workflow', 'evaluator', 'reflection', 'critique', 'iteration cap'],
  },

  // 6. Handoff
  {
    id: 'handoff',
    category: 'orchestration',
    title: 'Handoff',
    tagline: 'A triage agent transfers control and context to a specialist with different tools.',
    summary:
      'In a handoff, one agent decides it is not the right one to continue and transfers control, and an explicit context package, to a specialist agent; only one agent is active at a time. Unlike orchestrator-workers, control does not come back to a coordinator by default. Each agent has its own instructions and tool permissions, so the triage agent can be broadly reachable with read-only tools while the specialist holds narrow write access. What crosses the handoff boundary is a design decision: too little and the user repeats themselves, too much and you leak data or prompt-injected content into a more privileged agent.',
    whenToUse: [
      'Requests span domains where each domain needs different instructions, tools or permissions.',
      'The right specialist only becomes clear during the conversation.',
      'You want least privilege per agent instead of one agent holding every tool.',
    ],
    risks: [
      'Context loss: if the summary omits key facts, the specialist re-asks the user or acts on wrong assumptions.',
      'Privilege escalation: untrusted content forwarded in the handoff can steer the more privileged specialist.',
      'Handoff loops: agents bouncing a request between each other; cap the number of handoffs.',
      'Accountability: log which agent held control and which identity executed each tool call.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane' },
      { id: 'triage', label: 'Triage agent', kind: 'agent', sub: 'tools: read-only' },
      { id: 'specialist', label: 'Billing specialist', kind: 'agent', sub: 'tools: refund (write)' },
      { id: 'kb', label: 'Order lookup', kind: 'tool', sub: 'read scope' },
      { id: 'billing', label: 'Billing API', kind: 'tool', sub: 'refund scope' },
    ],
    variants: [
      {
        id: 'handoff-with-context',
        label: 'Handoff with context',
        tone: 'good',
        outcome: 'Triage gathers facts with read-only tools, then hands control plus a scoped summary to the specialist, who alone can issue the refund.',
        steps: [
          { from: 'user', to: 'triage', kind: 'call', label: '"Order 5521 arrived broken"', detail: 'The triage agent is the default entry point. It has broad instructions and narrow, read-only tools.' },
          { from: 'triage', to: 'kb', kind: 'call', label: 'get_order(5521)', detail: 'Triage can look things up but cannot change anything. A prompt-injected triage agent therefore cannot issue refunds.' },
          { from: 'kb', to: 'triage', kind: 'data', label: 'order: 89.00, delivered', detail: 'Facts gathered here go into the handoff so the specialist does not repeat the lookup or re-ask the user.' },
          { from: 'triage', to: 'triage', kind: 'think', label: 'needs refund: not my tools', detail: 'Triage recognises the request needs a capability it lacks. In many SDKs the handoff is itself exposed to the model as a tool call such as transfer_to_billing.' },
          {
            from: 'triage', to: 'specialist', kind: 'event', label: 'handoff: control + context package',
            detail: 'Pass a structured summary, not the raw transcript. Raw transcripts can carry injected instructions into a more privileged agent and waste tokens.',
            payload: '{"handoff_to": "billing_specialist", "reason": "damaged item, refund requested", "context": {"user": "jane", "order_id": "5521", "amount": 89.00, "status": "delivered", "user_claim": "arrived broken"}, "handoff_count": 1}',
          },
          {
            from: 'specialist', to: 'specialist', kind: 'think', label: 'policy: refund up to 100.00',
            detail: 'The specialist runs with its own system prompt and tool set. Its tool permissions differ from triage: it can write, but only within its own policy limits.',
            payload: 'agent=billing_specialist tools=[get_order, issue_refund(max=100.00)] inherited_from_triage=[]',
          },
          { from: 'specialist', to: 'user', kind: 'call', label: 'Confirm refund of 89.00?', detail: 'Control now sits with the specialist; the user talks to it directly. Confirming before a write is cheap insurance.' },
          { from: 'user', to: 'specialist', kind: 'return', label: 'Yes', detail: 'Explicit user confirmation for a money-moving action.' },
          {
            from: 'specialist', to: 'billing', kind: 'call', label: 'issue_refund(5521, 89.00)',
            detail: 'The write uses the specialist\'s credential, scoped to refunds. Audit logs show which agent and identity performed it.',
            payload: 'POST https://billing.example.com/refunds {"order_id": "5521", "amount": 89.00, "actor": "agent:billing_specialist", "on_behalf_of": "jane"}',
          },
          { from: 'billing', to: 'specialist', kind: 'return', label: 'refund r-778 created', detail: 'The deterministic billing system applies the change and enforces its own limits independently of the agent.' },
          { from: 'specialist', to: 'user', kind: 'return', label: 'Refund issued, ref r-778', detail: 'The conversation can end here or hand back to triage if the user raises an unrelated topic.' },
        ],
      },
      {
        id: 'agent-as-tool',
        label: 'Agent as tool',
        tone: 'neutral',
        outcome: 'Triage keeps the conversation and calls the specialist like a function; the user never talks to the specialist, and triage stays responsible for the reply.',
        steps: [
          { from: 'user', to: 'triage', kind: 'call', label: '"Refund my duplicate charge"', detail: 'Same request as the handoff variant.' },
          { from: 'triage', to: 'kb', kind: 'call', label: 'lookup orders (read)', detail: 'Triage gathers the facts it can read itself.' },
          { from: 'kb', to: 'triage', kind: 'data', label: '2 charges, same order', detail: 'Evidence of the duplicate.' },
          {
            from: 'triage', to: 'specialist', kind: 'call', label: 'tool call: billing_specialist(…)',
            detail: 'The specialist is exposed to triage as a tool with a typed input. It gets only the arguments, not the whole conversation.',
            payload: 'billing_specialist({\n  "action": "refund_duplicate",\n  "order_id": "ord-5521",\n  "charge_id": "ch-2"\n})',
          },
          { from: 'specialist', to: 'billing', kind: 'call', label: 'refund ch-2 (write scope)', detail: 'The write permission still lives only with the specialist.' },
          { from: 'billing', to: 'specialist', kind: 'return', label: 'refunded', detail: 'Billing confirms.' },
          { from: 'specialist', to: 'triage', kind: 'return', label: '{status: refunded, ref}', detail: 'A structured result returns to the caller, which decides what to say.' },
          { from: 'triage', to: 'user', kind: 'return', label: 'refund confirmed', detail: 'One voice for the user. Trade-off: triage\'s context grows with every specialist result, and a follow-up billing question goes through triage again instead of straight to the specialist.' },
        ],
      },
    ],
    sources: [AZURE_PATTERNS],
    verify: [
      'Azure Architecture Center lists handoff as a named orchestration pattern alongside sequential, concurrent, group chat and magentic.',
    ],
    tags: ['multi-agent', 'handoff', 'triage', 'least privilege', 'routing'],
  },

  // 7. Group chat / magentic
  {
    id: 'group-chat-magentic',
    category: 'orchestration',
    title: 'Group chat and magentic orchestration',
    tagline: 'A manager keeps a task ledger and picks who speaks next, within a turn limit.',
    summary:
      'In group chat orchestration, several agents share one conversation thread and a manager decides which agent speaks next. The magentic variant gives the manager an explicit task ledger (facts, plan, open items) that it updates after each turn and uses to select the next speaker or re-plan. Because agents react to each other, the main failure mode is ping-pong: two agents trading objections indefinitely. A hard turn limit and a stall detector in the manager are what keep cost bounded.',
    whenToUse: [
      'Open-ended problems where the plan must be discovered as you go (incident investigation, research).',
      'Tasks that benefit from agents with different roles critiquing each other (maker and checker).',
      'When you need an auditable record of who contributed what, via the shared thread and ledger.',
    ],
    risks: [
      'Agent ping-pong: two agents loop on the same disagreement without new information.',
      'Shared thread grows every turn; each agent call resends it, so cost grows roughly quadratically with turns.',
      'Manager selection errors waste turns on agents with nothing to add.',
      'Harder to reason about than fixed workflows; prefer simpler patterns unless the task really needs it.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'manager', label: 'Manager agent', kind: 'agent', sub: 'task ledger + speaker selection' },
      { id: 'ledger', label: 'Task ledger', kind: 'memory' },
      { id: 'writer', label: 'Writer agent', kind: 'agent' },
      { id: 'reviewer', label: 'Reviewer agent', kind: 'agent' },
    ],
    variants: [
      {
        id: 'with-limit',
        label: 'With turn limit',
        tone: 'good',
        outcome: 'The manager detects a stalled writer/reviewer exchange and the turn limit ends the chat with a summary of open items.',
        steps: [
          { from: 'user', to: 'manager', kind: 'call', label: 'Draft a rollback runbook', detail: 'The manager owns the conversation and the stop conditions. Individual agents cannot end or extend the chat.' },
          {
            from: 'manager', to: 'ledger', kind: 'data', label: 'write plan + facts',
            detail: 'The ledger is the manager\'s structured state, separate from the chat transcript. It survives summarisation of the thread and makes progress measurable.',
            payload: '{"goal": "rollback runbook", "facts": ["service: orders-api", "deploy tool: helm"], "plan": ["writer drafts", "reviewer checks"], "open": [], "turn": 0, "max_turns": 6}',
          },
          { from: 'manager', to: 'writer', kind: 'call', label: 'turn 1: writer, draft it', detail: 'The manager selects the next speaker based on the ledger, not round-robin.' },
          { from: 'writer', to: 'manager', kind: 'return', label: 'draft v1', detail: 'Each contribution goes into the shared thread that all agents see.' },
          { from: 'manager', to: 'reviewer', kind: 'call', label: 'turn 2: reviewer, check it', detail: 'The reviewer sees the full shared thread. Every turn resends it, so turns are expensive.' },
          { from: 'reviewer', to: 'manager', kind: 'return', label: 'add DB migration rollback', detail: 'Valid feedback; the manager adds it to open items in the ledger.' },
          { from: 'manager', to: 'writer', kind: 'call', label: 'turn 3: writer, revise', detail: 'Turns 3 to 5 alternate as the writer revises and the reviewer objects again.' },
          { from: 'reviewer', to: 'manager', kind: 'return', label: 'turn 5: same objection, reworded', detail: 'No new facts entered the ledger in two turns. This is the ping-pong signature.' },
          {
            from: 'manager', to: 'manager', kind: 'think', label: 'stall: no ledger progress',
            detail: 'The manager compares ledger state across turns. Stalls trigger a re-plan, a different speaker, or escalation instead of another identical round.',
            payload: 'turn=5/6 ledger_delta(last 2 turns)=0 open=["migration rollback order"] action=stop_and_escalate',
          },
          { from: 'manager', to: 'manager', kind: 'block', label: 'turn limit: stop chat', detail: 'Even without stall detection, max_turns bounds cost. The limit belongs in the manager\'s code, not in a prompt asking agents to be brief.' },
          { from: 'manager', to: 'user', kind: 'return', label: 'Draft + 1 unresolved item', detail: 'A clean stop returns the best artefact and the specific open question, so a human can settle it in one step.' },
        ],
      },
      {
        id: 'without-limit',
        label: 'Without turn limit',
        tone: 'bad',
        outcome: 'Writer and reviewer trade the same objection indefinitely; tokens and latency grow until an external timeout kills the run.',
        steps: [
          { from: 'user', to: 'manager', kind: 'call', label: 'Draft a rollback runbook', detail: 'Same task, but the manager has no max_turns and no stall check.' },
          { from: 'manager', to: 'writer', kind: 'call', label: 'turn 1: writer, draft it', detail: 'Starts the same way.' },
          { from: 'manager', to: 'reviewer', kind: 'call', label: 'turn 2: reviewer, check it', detail: 'Reviewer raises the migration-order concern.' },
          { from: 'manager', to: 'writer', kind: 'call', label: 'turn 3: writer, revise', detail: 'The writer changes wording but not the substance the reviewer cares about.' },
          { from: 'reviewer', to: 'manager', kind: 'return', label: 'same objection', detail: 'The manager sees an unresolved item and, with no other policy, asks the writer again.' },
          { from: 'manager', to: 'writer', kind: 'call', label: 'turn 9: writer, revise', detail: 'Each turn resends a longer thread. Turn 9 costs several times what turn 1 did.' },
          {
            from: 'reviewer', to: 'manager', kind: 'return', label: 'turn 20: same objection',
            detail: 'Nothing adversarial is required for this failure: two well-behaved agents with conflicting goals are enough to loop.',
            payload: 'turn=20 thread_tokens=61200 cumulative_tokens=704000 ledger_delta(last 15 turns)=0',
          },
          { from: 'manager', to: 'user', kind: 'block', label: 'gateway timeout after 15 min', detail: 'An outer timeout finally kills the run. The user gets nothing, and the spend is already incurred.' },
        ],
      },
    ],
    sources: [AZURE_PATTERNS],
    verify: [
      'Azure Architecture Center describes magentic orchestration with a manager that maintains a task ledger, derived from Microsoft Research Magentic-One.',
    ],
    tags: ['multi-agent', 'group chat', 'magentic', 'task ledger', 'turn limit', 'loops'],
  },

  // 8. Human-in-the-loop checkpoint
  {
    id: 'hitl-checkpoint',
    category: 'orchestration',
    title: 'Human-in-the-loop with checkpoint and resume',
    tagline: 'Agent proposes, state is persisted, a human decides later, the run resumes.',
    summary:
      'For consequential writes the agent should produce a proposal, not perform the action. The runtime checkpoints the full run state (messages, pending action, step pointer) to a durable store and releases all compute, so the approval can take hours without holding a process open. When a human decides, the run is reloaded from the checkpoint and resumed; on approval a deterministic executor applies exactly the proposed change, re-validating it first. Agents propose, deterministic systems apply.',
    whenToUse: [
      'Writes that are costly or hard to reverse: production changes, payments, external email, access grants.',
      'Approvals that take longer than any reasonable request timeout.',
      'When audit requires a record of who approved exactly what, and when.',
    ],
    risks: [
      'Stale approvals: the world changes between proposal and approval; re-check preconditions on resume.',
      'Approval fatigue: too many low-risk prompts train reviewers to click approve without reading.',
      'Proposal/execution mismatch: the executor must apply the approved payload, not ask the model again.',
      'Checkpoints contain conversation data and possibly secrets; encrypt them and set retention.',
    ],
    actors: [
      { id: 'user', label: 'Requester', kind: 'user', sub: 'jane' },
      { id: 'agent', label: 'Agent runtime', kind: 'agent' },
      { id: 'store', label: 'Checkpoint store', kind: 'queue', sub: 'durable, keyed by thread' },
      { id: 'human', label: 'Approver', kind: 'human', sub: 'on-call lead' },
      { id: 'executor', label: 'Executor', kind: 'tool', sub: 'deterministic apply' },
    ],
    variants: [
      {
        id: 'approved',
        label: 'Approved',
        tone: 'good',
        outcome: 'The run pauses for hours with no compute held, resumes from the checkpoint on approval, and the executor applies the exact approved change.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: 'Scale orders-api to 6 replicas', detail: 'The agent can plan and inspect, but by design has no permission to change infrastructure directly.' },
          { from: 'agent', to: 'agent', kind: 'think', label: 'propose: replicas 3 -> 6', detail: 'The output of the agent is a structured proposal, including the precondition it observed (current replicas = 3).' },
          {
            from: 'agent', to: 'store', kind: 'data', label: 'checkpoint: state + pending action',
            detail: 'The whole run state is serialised under a thread ID. The process can now exit; nothing is held in memory while waiting.',
            payload: '{"thread_id": "t-9f31", "step": "await_approval", "pending_action": {"op": "scale", "target": "orders-api", "from": 3, "to": 6}, "requested_by": "jane", "created_at": "2026-11-23T09:02:11Z"}',
          },
          { from: 'agent', to: 'human', kind: 'event', label: 'approval request (t-9f31)', detail: 'The request shows the exact diff to be applied, not a model-written paraphrase, so the approver judges the real action.' },
          { from: 'agent', to: 'user', kind: 'return', label: 'Pending approval', detail: 'The requester gets an immediate response. No connection is kept open for the hours the approval might take.' },
          { from: 'human', to: 'human', kind: 'think', label: '3 hours later: review diff', detail: 'Long waits are why checkpointing matters: in-memory pauses do not survive deploys, restarts or autoscaling.' },
          {
            from: 'human', to: 'agent', kind: 'approval', label: 'approve t-9f31',
            detail: 'The decision is bound to the thread ID and to a hash of the proposed action, so a changed proposal would need a new approval.',
            payload: '{"thread_id": "t-9f31", "decision": "approve", "approver": "lead-oncall", "action_sha256": "<hash of pending_action>", "at": "2026-11-23T12:07:40Z"}',
          },
          { from: 'agent', to: 'store', kind: 'call', label: 'load checkpoint t-9f31', detail: 'Any worker can resume the run; it does not need to be the process that paused it.' },
          { from: 'store', to: 'agent', kind: 'data', label: 'state at await_approval', detail: 'Execution continues from the saved step rather than re-running earlier model calls, which would cost tokens and might produce a different proposal.' },
          {
            from: 'agent', to: 'executor', kind: 'call', label: 'apply approved action', detail: 'The executor checks preconditions again (still 3 replicas?) and applies the exact approved payload. The model is not consulted at this point.',
            payload: 'executor: verify current=3 (ok) hash=match -> scale orders-api 3->6 actor=agent-runtime approved_by=lead-oncall',
          },
          { from: 'executor', to: 'agent', kind: 'return', label: 'applied', detail: 'The result is written back to the run state and the audit log.' },
          { from: 'agent', to: 'user', kind: 'event', label: 'Done: orders-api at 6 replicas', detail: 'The requester is notified asynchronously when the run completes.' },
        ],
      },
      {
        id: 'rejected',
        label: 'Rejected',
        tone: 'neutral',
        outcome: 'The approver rejects with a reason; the run resumes only to record the decision and nothing is applied.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: 'Scale orders-api to 6 replicas', detail: 'Same request and same proposal flow.' },
          { from: 'agent', to: 'store', kind: 'data', label: 'checkpoint: state + pending action', detail: 'Same checkpoint. The pending action is inert data until a decision arrives.' },
          { from: 'agent', to: 'human', kind: 'event', label: 'approval request (t-9f31)', detail: 'Same request with the exact diff.' },
          {
            from: 'human', to: 'agent', kind: 'approval', label: 'reject: freeze window',
            detail: 'Rejections carry a reason. The reason is useful context if the agent is allowed to propose an alternative.',
            payload: '{"thread_id": "t-9f31", "decision": "reject", "approver": "lead-oncall", "reason": "change freeze until 2026-11-24 06:00Z"}',
          },
          { from: 'agent', to: 'store', kind: 'call', label: 'load checkpoint t-9f31', detail: 'The run resumes so it can terminate cleanly and record the outcome, rather than being left paused forever.' },
          { from: 'agent', to: 'executor', kind: 'block', label: 'no apply: rejected', detail: 'The executor is never called. Because the agent itself lacks write permission, there is no path to apply the change without an approval.' },
          {
            from: 'agent', to: 'store', kind: 'data', label: 'mark run closed: rejected',
            detail: 'Close the thread so the stale proposal cannot be approved later by mistake. Set retention on checkpoint data.',
            payload: '{"thread_id": "t-9f31", "status": "closed", "outcome": "rejected", "applied": false}',
          },
          { from: 'agent', to: 'user', kind: 'event', label: 'Rejected: change freeze', detail: 'The requester learns the outcome and the reason without anyone re-explaining it.' },
        ],
      },
    ],
    sources: [LANGGRAPH_HITL, ANTHROPIC_BEA],
    verify: [
      'LangGraph implements pauses via interrupt() with a checkpointer and resumes with Command(resume=...) on the same thread_id.',
      'The LangGraph human-in-the-loop concepts URL may have moved to a newer docs site.',
    ],
    tags: ['human-in-the-loop', 'approval', 'checkpoint', 'durable execution', 'resume'],
  },
  // ---------------------------------------------------------------------------
  {
    id: 'context-management',
    category: 'orchestration',
    title: 'Context management: compaction and isolation',
    tagline: 'A long task fills the window; decide what the model keeps seeing.',
    summary:
      'Every tool result, file and intermediate thought an agent sees stays in its context window unless something removes it. On long tasks the window fills with stale material, cost and latency climb, and the model starts to lose early instructions or confuse old results with new ones. Two techniques keep it usable: compaction (summarise or drop old turns and tool outputs, keeping decisions and open items) and isolation (send a noisy subtask to a subagent with a fresh context and take back only its summary).',
    whenToUse: [
      'Agents that run for many turns or read large tool outputs (logs, files, search results).',
      'Research or coding tasks where exploration produces far more text than the final answer needs.',
    ],
    risks: [
      'Summaries lose detail; a fact dropped during compaction is gone unless it was written somewhere durable (notes file, memory).',
      'Subagents only know what the parent tells them; a vague brief produces a confident but irrelevant summary.',
      'Isolation costs extra model calls; it pays off when the subtask\'s raw output is much larger than its result.',
    ],
    actors: [
      { id: 'user', label: 'Engineer', kind: 'user' },
      { id: 'agent', label: 'Lead agent', kind: 'agent' },
      { id: 'llm', label: 'Model', kind: 'llm', sub: 'context window' },
      { id: 'sub', label: 'Subagent', kind: 'agent', sub: 'fresh context' },
      { id: 'logs', label: 'Log search', kind: 'tool' },
      { id: 'notes', label: 'Notes file', kind: 'memory', sub: 'durable scratchpad' },
    ],
    variants: [
      {
        id: 'managed',
        label: 'Isolate + compact',
        tone: 'good',
        outcome: 'The lead agent\'s context holds the goal, the decisions and a 200-token summary of 40k tokens of logs, so it still follows the original constraints at turn 30.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: '"Find why checkout fails; no prod writes"', detail: 'The constraint at the start of the task is exactly what tends to get lost late in a long context.' },
          {
            from: 'agent', to: 'sub', kind: 'call', label: 'brief: find error pattern in logs',
            detail: 'The noisy part goes to a subagent with a clear, self-contained brief and an expected output shape.',
            payload: 'Task: search checkout-service logs 09:00-11:00 for 5xx.\nReturn: top 3 error signatures with counts and one example trace id each. Max 200 words.',
          },
          { from: 'sub', to: 'logs', kind: 'call', label: 'search (x12 queries)', detail: 'The subagent iterates freely; its context fills with raw log lines.' },
          { from: 'logs', to: 'sub', kind: 'data', label: '~40k tokens of log lines', detail: 'This bulk never reaches the lead agent.' },
          { from: 'sub', to: 'agent', kind: 'return', label: 'summary: 3 signatures, ~200 tokens', detail: 'Only the distilled result returns. The parent can ask a follow-up if something is unclear.' },
          { from: 'agent', to: 'notes', kind: 'data', label: 'write: findings + open questions', detail: 'Key facts go to a durable notes file, so they survive compaction and restarts.' },
          { from: 'agent', to: 'agent', kind: 'think', label: 'compact old turns', detail: 'Older tool outputs are replaced by short summaries; the system prompt, user constraints and recent turns stay verbatim.' },
          { from: 'agent', to: 'llm', kind: 'call', label: 'goal + constraints + summaries', detail: 'Each later call carries a small, current context instead of the full history.' },
          { from: 'llm', to: 'agent', kind: 'return', label: 'next step: read-only DB check', detail: 'The model still respects "no prod writes" because that instruction was never buried.' },
        ],
      },
      {
        id: 'unbounded',
        label: 'Everything in one context',
        tone: 'bad',
        outcome: 'After many large tool results the early constraint is effectively lost and the agent proposes a production write.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: '"Find why checkout fails; no prod writes"', detail: 'Same task.' },
          { from: 'agent', to: 'logs', kind: 'call', label: 'search (x12 queries)', detail: 'The lead agent searches logs itself.' },
          { from: 'logs', to: 'agent', kind: 'data', label: '~40k tokens appended', detail: 'Every raw result is appended to the conversation.' },
          { from: 'agent', to: 'llm', kind: 'call', label: 'full history, 150k tokens', detail: 'Every call resends everything: slower, more expensive, and the constraint is now one line among thousands.' },
          { from: 'llm', to: 'llm', kind: 'think', label: 'attends to recent logs', detail: 'Long-context models recall details less reliably from the middle of very long inputs.' },
          { from: 'llm', to: 'agent', kind: 'return', label: '"restart pods + clear prod cache"', detail: 'A plausible fix that violates the original instruction.' },
        ],
      },
    ],
    sources: [
      { title: 'Anthropic: Effective context engineering for AI agents', url: 'https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents' },
      { title: 'Anthropic: How we built our multi-agent research system', url: 'https://www.anthropic.com/engineering/multi-agent-research-system' },
      { title: 'Liu et al., Lost in the middle: how language models use long contexts (arXiv)', url: 'https://arxiv.org/abs/2307.03172' },
    ],
    verify: [
      'How much recall degrades in long contexts varies a lot by model and has improved in newer models; the bad variant illustrates the risk, not a measured rate.',
    ],
    tags: ['context engineering', 'compaction', 'subagent', 'isolation', 'long context', 'notes'],
  },
  // ---------------------------------------------------------------------------
  {
    id: 'many-tools',
    category: 'orchestration',
    title: 'Scaling to many tools: tool search, code mode, skills',
    tagline: 'Load tool definitions and instructions when they are needed, not on every turn.',
    summary:
      'Every tool schema and every page of instructions sent to the model costs tokens on every call and competes for its attention. With a handful of tools that does not matter; with several MCP servers it can be tens of thousands of tokens before the user says anything, and tool selection gets worse. Three techniques defer the load: tool search (the model searches a catalogue and only the matching definitions are loaded), code mode (tools are exposed as a code API the model writes a short program against, so intermediate results stay in the sandbox), and skills (folders of instructions where only a one-line description is always loaded and the body is read when the task matches).',
    whenToUse: [
      'Agents connected to many MCP servers or large APIs (dozens to thousands of operations).',
      'Workflows that pass large intermediate results between tools, where routing them through the model wastes context.',
      'Specialised procedures (report formats, deployment runbooks) that only some tasks need.',
    ],
    risks: [
      'Search adds a round trip and can miss the right tool if descriptions are poor; keep the few most-used tools always loaded.',
      'Code mode runs model-written code: it needs a sandbox, resource limits and the same tool permissions as before.',
      'Skills and tool descriptions are instructions to the model; a third-party skill is a supply-chain risk like any MCP server.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user' },
      { id: 'agent', label: 'Agent', kind: 'agent' },
      { id: 'llm', label: 'Model', kind: 'llm' },
      { id: 'catalog', label: 'Tool catalogue', kind: 'search', sub: '120 tools, 6 servers' },
      { id: 'sandbox', label: 'Code sandbox', kind: 'sandbox', sub: 'tools as a code API' },
      { id: 'crm', label: 'CRM + sheets', kind: 'mcp' },
    ],
    variants: [
      {
        id: 'search-and-code',
        label: 'Tool search + code mode',
        tone: 'good',
        outcome: 'The model sees two tool definitions and a 40-line program instead of 120 schemas and 10,000 rows, and the rows never pass through its context.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: '"Flag Q3 deals missing a close date"', detail: 'The answer needs a large CRM export filtered and written to a sheet.' },
          { from: 'agent', to: 'llm', kind: 'call', label: 'prompt + search tool + 3 core tools', detail: 'Only the search tool and the most-used tools are loaded up front; the other definitions are deferred.' },
          { from: 'llm', to: 'catalog', kind: 'call', label: 'search: "crm deals", "sheet write"', detail: 'The model looks up what it needs by keyword or embedding.' },
          { from: 'catalog', to: 'llm', kind: 'return', label: '2 tool definitions loaded', detail: 'Only matching schemas are added to the context.' },
          {
            from: 'llm', to: 'sandbox', kind: 'call', label: 'run program against the tool API',
            detail: 'Instead of one tool call per step with results returned to the model, the model writes code that calls the tools and filters in the sandbox.',
            payload: 'const deals = await crm.listDeals({ quarter: "2026-Q3" });\nconst missing = deals.filter(d => !d.closeDate);\nawait sheets.append("Q3 gaps", missing.map(d => [d.id, d.owner]));\nconsole.log(missing.length);',
          },
          { from: 'sandbox', to: 'crm', kind: 'call', label: 'listDeals, append (10,412 rows)', detail: 'The bulk data moves between tools inside the sandbox.' },
          { from: 'sandbox', to: 'llm', kind: 'return', label: 'stdout: 37', detail: 'Only the printed result returns to the model.' },
          { from: 'agent', to: 'user', kind: 'return', label: '37 deals flagged, sheet updated', detail: 'Anthropic reported a drop from about 150,000 to 2,000 tokens for a similar workflow in its own example.' },
        ],
      },
      {
        id: 'skills',
        label: 'Skills (progressive disclosure)',
        tone: 'neutral',
        outcome: 'Twenty skills cost about 2,000 tokens of descriptions; the one that matches is read in full only when the task needs it.',
        steps: [
          { from: 'agent', to: 'llm', kind: 'call', label: 'system prompt + 20 skill one-liners', detail: 'At start-up only each skill\'s name and description (around 100 tokens each) are loaded.' },
          { from: 'user', to: 'agent', kind: 'call', label: '"Write the quarterly deal review"', detail: 'This matches the description of a "deal-review" skill.' },
          { from: 'llm', to: 'catalog', kind: 'call', label: 'read deal-review/SKILL.md', detail: 'The model opens the skill\'s full instructions only now.' },
          { from: 'catalog', to: 'llm', kind: 'return', label: 'instructions + template path', detail: 'Further files (templates, scripts) are read only if the instructions point to them.' },
          { from: 'llm', to: 'sandbox', kind: 'call', label: 'run skill script on the data', detail: 'Skills can bundle scripts, so a fixed procedure runs as code instead of being re-derived each time.' },
          { from: 'agent', to: 'user', kind: 'return', label: 'review in the house format', detail: 'Review third-party skills like code: instructions and bundled scripts both run with the agent\'s permissions.' },
        ],
      },
      {
        id: 'load-everything',
        label: 'Every schema, every turn',
        tone: 'bad',
        outcome: 'About 45,000 tokens of tool schemas are resent on every call, the model picks a similar-sounding wrong tool, and 10,000 rows flow through its context.',
        steps: [
          { from: 'user', to: 'agent', kind: 'call', label: '"Flag Q3 deals missing a close date"', detail: 'Same task.' },
          { from: 'agent', to: 'llm', kind: 'call', label: 'prompt + 120 tool schemas', detail: 'Every server\'s full tool list is in the context on every call.' },
          { from: 'llm', to: 'crm', kind: 'call', label: 'crm_search_opportunities (wrong)', detail: 'With many overlapping names, selection errors go up.' },
          { from: 'crm', to: 'llm', kind: 'data', label: '10,412 rows into the context', detail: 'Every intermediate result passes through the model, costing tokens and sometimes exceeding the window.' },
          { from: 'llm', to: 'agent', kind: 'return', label: 'truncated, partial answer', detail: 'The task fails or silently misses rows.' },
        ],
      },
    ],
    sources: [
      { title: 'Anthropic: Code execution with MCP', url: 'https://www.anthropic.com/engineering/code-execution-with-mcp' },
      { title: 'Claude docs: Tool search tool', url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool' },
      { title: 'OpenAI docs: Tool search', url: 'https://developers.openai.com/api/docs/guides/tools-tool-search' },
      { title: 'Anthropic: Equipping agents for the real world with Agent Skills', url: 'https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills' },
    ],
    verify: [
      'Token figures are from vendor examples and vary widely with the number and size of tools.',
      'The Agent Skills engineering post URL is cited from memory.',
    ],
    tags: ['tool search', 'code mode', 'skills', 'progressive disclosure', 'MCP', 'context', 'defer_loading'],
  },
];
