// Core types for the simulated agent path. Nothing here talks to a real service.

export type Column = 'trigger' | 'channel' | 'runtime' | 'model' | 'tool' | 'platform' | 'gateway';

/** AI gateway in front of model providers. forward = proxy the caller's credential; swap = gateway calls with its own identity. */
export type AiGatewayMode = 'off' | 'forward' | 'swap';
/** API gateway in front of tool / data backends. exchange = the gateway does the OBO exchange itself. */
export type ApiGatewayMode = 'off' | 'forward' | 'swap' | 'exchange';

export type IdentityMode =
  | 'api_key'
  | 'm2m'
  | 'managed_identity'
  | 'federation'
  | 'obo'
  | 'stored_consent'
  | 'passthrough';

/** Whose identity a credential carries, as the receiving service sees it. */
export type Principal = 'user' | 'agent' | 'key' | 'none';

/** ok = works; caveat = works with a real risk or cost; fail = will not work; unreached = an earlier hop failed. */
export type Severity = 'ok' | 'caveat' | 'fail' | 'unreached';

export type Cloud = 'azure' | 'aws';

export interface Source {
  title: string;
  url: string;
}

export interface MapNode {
  id: string;
  column: Column;
  label: string;
  sub: string;
  cloud?: Cloud;
}

export interface IdentityInfo {
  id: IdentityMode;
  label: string;
  short: string;
  /** True when the mode carries the end user's identity downstream. */
  carriesUser: boolean;
}

export interface Selection {
  trigger: string;
  channel: string;
  runtime: string;
  model: string;
  tool: string;
  platform: string;
  identity: IdentityMode;
  /** Absent means 'off'. */
  aiGateway?: AiGatewayMode;
  /** Absent means 'off'. */
  apiGateway?: ApiGatewayMode;
}

/** Everything the inspector shows for one hop. */
export interface HopDetail {
  /** One plain-language line for scanning. */
  caption: string;
  /** What is on the wire, e.g. "Bearer JWT (Entra, delegated)". */
  credential: string;
  /** Sample request line and headers. */
  wire?: string;
  /** Sample token acquisition / exchange request, when one happens at this hop. */
  exchange?: string;
  /** Sample decoded token claims. */
  claims?: Record<string, unknown>;
  principal: Principal;
  /** Who the receiving service records, e.g. "jane@example.com". */
  principalLabel: string;
  permission: string;
  /** What the call actually returns or does, when the identity changes the outcome. */
  result?: string;
  audit: string;
  blastRadius: string;
  failures: string[];
  severity: Severity;
  /** Statements in this hop that have not been checked against current vendor docs. */
  verify?: string[];
  sources: Source[];
}

export interface Hop extends HopDetail {
  id: string;
  from: string;
  to: string;
  /** Hop ids that must succeed for this hop to be reached. */
  dependsOn: string[];
}

/** Context passed to hop resolvers. */
export interface HopContext {
  sel: Selection;
  cloud: Cloud;
  /** True when a user token for the agent API arrived at the runtime. */
  hasUserToken: boolean;
  /** Who is making the call at this hop. */
  caller: 'agent' | 'mcp';
}
