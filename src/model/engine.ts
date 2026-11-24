import { nodeById } from './catalog';
import { channelToRuntime, triggerToChannel } from './hops/inbound';
import { aiGatewayOut, apiGatewaySwapOut, forwardIn, forwardOut, gatewayIn, rebrandAsGateway } from './hops/gateways';
import { agentToMcp } from './hops/mcp';
import { MODEL_RESOLVERS } from './hops/models';
import { PLATFORM_RESOLVERS } from './hops/platforms';
import type { Hop, HopContext, HopDetail, Principal, Selection, Severity } from './types';

/**
 * Resolve every hop on the selected path.
 * Two chains leave the runtime: one to the model backend, one through the tool layer to the platform.
 * A hop whose upstream hop failed is marked "unreached" but keeps its detail so the user can still read it.
 */
export function resolvePath(sel: Selection): Hop[] {
  const runtime = nodeById(sel.runtime);
  const hops: Hop[] = [];
  const add = (id: string, from: string, to: string, dependsOn: string[], d: HopDetail) =>
    hops.push({ id, from, to, dependsOn, ...d });

  add('h1', sel.trigger, sel.channel, [], triggerToChannel(sel));
  add('h2', sel.channel, sel.runtime, ['h1'], channelToRuntime(sel));

  const hasUserToken = sel.trigger === 'user' && sel.channel !== 'scheduler';
  const base: HopContext = { sel, cloud: runtime.cloud ?? 'azure', hasUserToken, caller: 'agent' };

  const model = MODEL_RESOLVERS[sel.model];
  if (!model) throw new Error(`No resolver for model ${sel.model}`);
  const modelHop = model(sel.identity, base);
  const aiGw = sel.aiGateway ?? 'off';
  if (aiGw === 'off') {
    add('h3', sel.runtime, sel.model, ['h2'], modelHop);
  } else if (aiGw === 'forward') {
    add('h3', sel.runtime, 'ai-gw', ['h2'], forwardIn('ai', modelHop, nodeById(sel.model).label));
    add('h3g', 'ai-gw', sel.model, ['h3'], forwardOut('ai', modelHop));
  } else {
    add('h3', sel.runtime, 'ai-gw', ['h2'], gatewayIn('ai', sel.identity, base));
    add('h3g', 'ai-gw', sel.model, ['h3'], aiGatewayOut(sel.model));
  }

  const platform = PLATFORM_RESOLVERS[sel.platform];
  if (!platform) throw new Error(`No resolver for platform ${sel.platform}`);

  // The tool layer: either the runtime calls the platform, or it calls an MCP server which does.
  let caller = sel.runtime;
  let ctx = base;
  let prev = 'h2';
  if (sel.tool === 'mcp') {
    add('h4', sel.runtime, 'mcp', ['h2'], agentToMcp(base));
    ctx = {
      ...base,
      caller: 'mcp',
      // The MCP server only has a user token if the agent sent one it could exchange.
      hasUserToken: hasUserToken && (sel.identity === 'obo' || sel.identity === 'passthrough'),
    };
    caller = 'mcp';
    prev = 'h4';
  }
  const next = sel.tool === 'mcp' ? 'h5' : 'h4';
  const direct = sel.tool === 'mcp' ? withMcpNote(platform(sel.identity, ctx), sel.identity) : platform(sel.identity, ctx);
  const apiGw = sel.apiGateway ?? 'off';
  const platformName = nodeById(sel.platform).label;
  if (apiGw === 'off') {
    add(next, caller, sel.platform, [prev], direct);
  } else if (apiGw === 'forward') {
    add(next, caller, 'api-gw', [prev], forwardIn('api', direct, platformName));
    add(`${next}g`, 'api-gw', sel.platform, [next], forwardOut('api', direct));
  } else {
    const inbound = gatewayIn('api', sel.identity, ctx);
    add(next, caller, 'api-gw', [prev], inbound);
    const exchange = apiGw === 'exchange' && inbound.principal === 'user';
    add(`${next}g`, 'api-gw', sel.platform, [next], exchange
      ? rebrandAsGateway(platform('obo', { ...ctx, hasUserToken: true }), ctx)
      : apiGatewaySwapOut(sel.platform, apiGw === 'exchange'
        ? 'Nothing to exchange: the caller sent an app credential, so the gateway falls back to its own identity. '
        : ''));
  }

  return markUnreached(hops);
}

function withMcpNote(d: HopDetail, mode: Selection['identity']): HopDetail {
  if (mode === 'obo') {
    return { ...d, caption: `${d.caption} This is the second OBO exchange on the path: the MCP server's own app is now the azp.` };
  }
  if (d.principal === 'agent' || d.principal === 'key') {
    return { ...d, caption: `${d.caption} The credential belongs to the MCP server, so every agent that can reach it shares this access.` };
  }
  return d;
}

function markUnreached(hops: Hop[]): Hop[] {
  const failed = new Set<string>();
  for (const h of hops) {
    const blocked = h.dependsOn.some((d) => failed.has(d));
    if (blocked) h.severity = 'unreached';
    if (blocked || h.severity === 'fail') failed.add(h.id);
  }
  return hops;
}

const RANK: Record<Severity, number> = { ok: 0, caveat: 1, unreached: 2, fail: 3 };

/** Worst severity on the path, for the headline badge. */
export function overallSeverity(hops: Hop[]): Severity {
  return hops.reduce<Severity>((w, h) => (RANK[h.severity] > RANK[w] ? h.severity : w), 'ok');
}

/** Who the final data platform sees: the core teaching point. */
export function platformPrincipal(hops: Hop[]): Principal {
  return hops[hops.length - 1]?.principal ?? 'none';
}
