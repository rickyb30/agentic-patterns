import type { AiGatewayMode, ApiGatewayMode, Column, IdentityInfo, IdentityMode, MapNode, Selection } from './types';

export const COLUMNS: { id: Column; label: string }[] = [
  { id: 'trigger', label: 'Trigger' },
  { id: 'channel', label: 'Channel' },
  { id: 'runtime', label: 'Agent runtime' },
  { id: 'model', label: 'Model backend' },
  { id: 'tool', label: 'Tool layer' },
  { id: 'platform', label: 'Data / action platform' },
];

export const NODES: MapNode[] = [
  { id: 'user', column: 'trigger', label: 'Interactive user', sub: 'a person asks' },
  { id: 'cron', column: 'trigger', label: 'Schedule', sub: 'nightly job, no person' },

  { id: 'web', column: 'channel', label: 'Web app', sub: 'SPA, Entra sign-in' },
  { id: 'teams', column: 'channel', label: 'Teams bot', sub: 'Bot Framework + SSO' },
  { id: 'scheduler', column: 'channel', label: 'Scheduler', sub: 'timer / EventBridge' },

  { id: 'azure-container', column: 'runtime', label: 'Container on Azure', sub: 'AKS / Container Apps', cloud: 'azure' },
  { id: 'aws-lambda', column: 'runtime', label: 'Function on AWS', sub: 'Lambda', cloud: 'aws' },

  { id: 'foundry', column: 'model', label: 'Microsoft Foundry', sub: 'Azure OpenAI endpoint' },
  { id: 'bedrock', column: 'model', label: 'AWS Bedrock', sub: 'InvokeModel / Converse' },
  { id: 'anthropic', column: 'model', label: 'Anthropic API', sub: 'direct' },

  { id: 'direct', column: 'tool', label: 'Direct SDK call', sub: 'agent calls the API' },
  { id: 'mcp', column: 'tool', label: 'MCP server', sub: 'remote, OAuth-protected' },

  { id: 'ai-gw', column: 'gateway', label: 'AI gateway', sub: 'in front of model providers' },
  { id: 'api-gw', column: 'gateway', label: 'API gateway', sub: 'in front of tools / data' },

  { id: 'snowflake', column: 'platform', label: 'Snowflake', sub: 'SQL API, row access policy' },
  { id: 'databricks', column: 'platform', label: 'Databricks', sub: 'Unity Catalog, row filter' },
  { id: 'graph', column: 'platform', label: 'Microsoft Graph', sub: 'Mail.Read' },
];

export const IDENTITIES: IdentityInfo[] = [
  { id: 'api_key', label: 'API key / PAT', short: 'A static shared secret identifies the caller.', carriesUser: false },
  { id: 'm2m', label: 'M2M (SPN secret)', short: 'Client-credentials flow with a service principal secret or cert.', carriesUser: false },
  { id: 'managed_identity', label: 'Managed identity / role', short: 'The platform hands the workload a token. No secret in config.', carriesUser: false },
  { id: 'federation', label: 'Workload federation', short: 'One platform\'s OIDC token is exchanged for another\'s. No secret.', carriesUser: false },
  { id: 'obo', label: 'OBO', short: 'The user\'s incoming token is exchanged for a downstream token that still names the user.', carriesUser: true },
  { id: 'stored_consent', label: 'Stored consent', short: 'The user consented once; the agent keeps a refresh token in a vault.', carriesUser: true },
  { id: 'passthrough', label: 'Token passthrough', short: 'Anti-pattern: the user\'s token is forwarded unchanged.', carriesUser: true },
];

export const AI_GATEWAY_MODES: { id: AiGatewayMode; label: string; short: string }[] = [
  { id: 'off', label: 'Off', short: 'The runtime calls the model provider directly.' },
  { id: 'forward', label: 'Forward', short: 'The gateway validates, meters and proxies the caller\'s own model credential.' },
  { id: 'swap', label: 'Credential swap', short: 'The caller authenticates to the gateway; the gateway calls the model with its own identity.' },
];

export const API_GATEWAY_MODES: { id: ApiGatewayMode; label: string; short: string }[] = [
  { id: 'off', label: 'Off', short: 'The caller reaches the data platform directly.' },
  { id: 'forward', label: 'Forward', short: 'The gateway validates a platform-audience token and proxies it unchanged.' },
  { id: 'swap', label: 'Credential swap', short: 'The gateway calls the platform as itself. Every caller collapses into one principal.' },
  { id: 'exchange', label: 'Gateway OBO', short: 'The gateway exchanges the user token it received for a platform token. The user survives.' },
];

export const nodeById = (id: string): MapNode => {
  const n = NODES.find((x) => x.id === id);
  if (!n) throw new Error(`Unknown node: ${id}`);
  return n;
};

export const identityById = (id: IdentityMode): IdentityInfo => {
  const i = IDENTITIES.find((x) => x.id === id);
  if (!i) throw new Error(`Unknown identity mode: ${id}`);
  return i;
};

export const DEFAULT_SELECTION: Selection = {
  trigger: 'user',
  channel: 'teams',
  runtime: 'azure-container',
  model: 'foundry',
  tool: 'direct',
  platform: 'snowflake',
  identity: 'obo',
};
