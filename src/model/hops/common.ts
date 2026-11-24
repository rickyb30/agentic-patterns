import type { HopContext, HopDetail, Source } from '../types';
import { inboundAud } from '../tokens';

/** A hop that cannot work, with a reason and a fix. */
export function failHop(caption: string, failures: string[], sources: Source[], verify?: string[]): HopDetail {
  return {
    caption, credential: '—', principal: 'none', principalLabel: '—',
    permission: '—', audit: 'Rejected request (if it is sent at all).', blastRadius: '—',
    failures, severity: 'fail', sources, ...(verify ? { verify } : {}),
  };
}

/** OBO and passthrough need a live user token. Returns a failing hop when there is none. */
export function requireUserToken(ctx: HopContext, sources: Source[]): HopDetail | null {
  if (ctx.hasUserToken) return null;
  return failHop(
    'There is no user token to use. A scheduled run has no person behind it.',
    ['No incoming user assertion to exchange or forward.', 'Fix: use a workload identity (M2M, managed identity, federation) with tightly scoped grants, or stored consent with a refresh token.'],
    sources,
  );
}

/** Passthrough is the same failure at every Entra-protected resource: the audience is wrong. */
export function passthroughHop(ctx: HopContext, targetAud: string, targetName: string, sources: Source[]): HopDetail {
  const missing = requireUserToken(ctx, sources);
  if (missing) return missing;
  return {
    ...failHop(
      `The ${ctx.caller === 'mcp' ? 'MCP server' : 'agent'} forwards the token it received. ${targetName} rejects it because the audience is not ${targetName}.`,
      [
        `401 invalid audience: token aud=${inboundAud(ctx.caller)}, expected ${targetAud}.`,
        'If a service did accept it, the service could not tell the agent was involved, and any service holding the token could replay it (confused deputy).',
        'Fix: exchange the token (OBO / RFC 8693) for one issued to the downstream audience.',
      ],
      sources,
    ),
    credential: `Bearer JWT, aud=${inboundAud(ctx.caller)} (wrong audience)`,
  };
}
