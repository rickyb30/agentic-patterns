import { SRC } from '../sources';
import { AGENT_APP, AUD, CLIENT_CREDS_REQUEST, MI, OBO_REQUEST, USER, appToken, userToken } from '../tokens';
import type { HopContext, HopDetail } from '../types';
import { passthroughHop, requireUserToken } from './common';

const MCP_WIRE = `POST https://mcp.example.com/mcp\nAuthorization: Bearer eyJ…\nContent-Type: application/json\n\n{"jsonrpc":"2.0","method":"tools/call","params":{"name":"run_query", …}}`;

/** Agent → remote MCP server. The MCP server is its own OAuth protected resource. */
export function agentToMcp(ctx: HopContext): HopDetail {
  const src = [SRC.mcpAuth, SRC.mcpSecurity];
  const mode = ctx.sel.identity;

  if (mode === 'passthrough') {
    return passthroughHop(ctx, AUD.mcp, 'the MCP server', src);
  }

  if (mode === 'obo' || mode === 'stored_consent') {
    if (mode === 'obo') {
      const missing = requireUserToken(ctx, [SRC.entraObo, ...src]);
      if (missing) return missing;
    }
    return {
      caption: 'The agent gets a token for the MCP server that still names Jane. The MCP server will do its own exchange for the platform.',
      credential: 'Bearer JWT (delegated, aud = MCP server)',
      exchange: mode === 'obo'
        ? OBO_REQUEST(`${AUD.mcp}/tools.invoke`, 'agent')
        : 'refresh_token grant with Jane\'s vaulted refresh token, scope = MCP server',
      wire: MCP_WIRE,
      claims: userToken(AUD.mcp, 'tools.invoke', AGENT_APP.appId),
      principal: 'user', principalLabel: `${USER.upn} via ${AGENT_APP.name}`,
      permission: 'The MCP server validates aud = itself (RFC 8707 resource indicator) and the tools.invoke scope.',
      audit: 'MCP server log: tool run_query called by Jane, client app = agent-api.',
      blastRadius: 'The token works only at this MCP server.',
      failures: ['401 with WWW-Authenticate pointing to protected resource metadata, when the token is missing or has the wrong audience.'],
      severity: 'ok',
      verify: ['Entra does not add an RFC 8693 act claim. The chain is visible only via azp/appid at each hop.'],
      sources: [SRC.entraObo, ...src],
    };
  }

  // Agent-identity modes: the MCP server learns which agent called, not which user.
  const viaSecret = mode === 'api_key' || mode === 'm2m';
  return {
    caption: 'The agent authenticates to the MCP server as itself. From here on, nothing downstream knows Jane asked.',
    credential: mode === 'api_key' ? 'Static API key header' : 'Bearer JWT (app-only, aud = MCP server)',
    ...(mode === 'm2m' ? { exchange: CLIENT_CREDS_REQUEST(`${AUD.mcp}/.default`, 'agent') } : {}),
    wire: MCP_WIRE,
    ...(mode === 'api_key' ? {} : { claims: appToken(AUD.mcp, mode === 'managed_identity' ? MI.oid : AGENT_APP.spnOid, AGENT_APP.appId, ['Tools.Invoke.All']) }),
    principal: mode === 'api_key' ? 'key' : 'agent',
    principalLabel: mode === 'api_key' ? 'MCP API key' : AGENT_APP.name,
    permission: 'The MCP server checks the caller is an allowed client app. It has no user to authorize.',
    audit: `MCP server log: called by ${AGENT_APP.name}.`,
    blastRadius: viaSecret ? 'Anyone with the secret can call every tool the MCP server exposes.' : 'Limited to the agent workload.',
    failures: ['Confused deputy: the MCP server will use its own identity downstream for whatever any allowed agent asks.'],
    severity: 'caveat',
    sources: src,
  };
}
