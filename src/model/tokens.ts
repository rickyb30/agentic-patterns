// Sample identifiers and token builders. All values are fictional.

export const TENANT = '11111111-1111-1111-1111-111111111111';
export const USER = { upn: 'jane@example.com', oid: 'u0000000-0000-0000-0000-00000000jane' };
export const AGENT_APP = { appId: 'a0000000-0000-0000-0000-0000000agent', spnOid: 's0000000-0000-0000-0000-0000000agent', name: 'agent-api' };
export const MCP_APP = { appId: 'm0000000-0000-0000-0000-00000000mcp', spnOid: 's0000000-0000-0000-0000-00000000mcp', name: 'mcp-server' };
export const GATEWAY_APP = { appId: 'g0000000-0000-0000-0000-000000gateway', name: 'api-gateway' };
export const GATEWAY_MI = { oid: 'i0000000-0000-0000-0000-0000000gw-mi', name: 'id-gateway (gateway MI)' };
export const MI = { oid: 'i0000000-0000-0000-0000-000000000mi', name: 'id-agent (user-assigned MI)' };

export const AUD = {
  agentApi: `api://${AGENT_APP.appId}`,
  mcp: `api://${MCP_APP.appId}`,
  cognitive: 'https://cognitiveservices.azure.com',
  graph: '00000003-0000-0000-c000-000000000000',
  databricks: '2ff814a6-3304-4ab8-85cb-cd0e6f879c1d',
  snowflake: 'api://snowflake-external-oauth',
  gateway: 'api://g0000000-0000-0000-0000-000000gateway',
};

const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const EXP = 1795000000;

/** A delegated (user) Entra access token. `azp` is the client that requested it. */
export function userToken(aud: string, scp: string, azp: string): Record<string, unknown> {
  return { iss: ISS, aud, tid: TENANT, oid: USER.oid, upn: USER.upn, scp, azp, exp: EXP };
}

/** An application-only Entra access token (client credentials, MI, or federated). */
export function appToken(aud: string, oid: string, azp: string, roles?: string[]): Record<string, unknown> {
  const t: Record<string, unknown> = { iss: ISS, aud, tid: TENANT, oid, sub: oid, azp, idtyp: 'app', exp: EXP };
  if (roles) t.roles = roles;
  return t;
}

/** Caller-dependent bits: the agent and the MCP server are separate Entra apps. */
export function callerApp(caller: 'agent' | 'mcp') {
  return caller === 'mcp' ? MCP_APP : AGENT_APP;
}

/** The audience of the user token the caller received. */
export function inboundAud(caller: 'agent' | 'mcp') {
  return caller === 'mcp' ? AUD.mcp : AUD.agentApi;
}

export const OBO_REQUEST = (scope: string, caller: 'agent' | 'mcp') => `POST https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token
grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
&client_id=${callerApp(caller).appId}
&client_assertion=<signed JWT or federated MI token>   (or client_secret)
&assertion=<incoming user token, aud=${inboundAud(caller)}>
&scope=${scope}
&requested_token_use=on_behalf_of`;

export const CLIENT_CREDS_REQUEST = (scope: string, caller: 'agent' | 'mcp') => `POST https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token
grant_type=client_credentials
&client_id=${callerApp(caller).appId}
&client_secret=<secret from vault>      (or client_assertion with a cert)
&scope=${scope}`;

export const IMDS_REQUEST = (resource: string) => `GET http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=${resource}
Metadata: true
(Container Apps / App Service use IDENTITY_ENDPOINT + X-IDENTITY-HEADER instead)`;
