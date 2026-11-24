import { AI_GATEWAY_MODES, API_GATEWAY_MODES, DEFAULT_SELECTION, IDENTITIES, NODES } from '../model/catalog';
import type { AiGatewayMode, ApiGatewayMode, IdentityMode, Selection } from '../model/types';

type NodeKey = 'trigger' | 'channel' | 'runtime' | 'model' | 'tool' | 'platform';
const NODE_KEYS: Record<NodeKey, string> = { trigger: 't', channel: 'c', runtime: 'r', model: 'm', tool: 'x', platform: 'p' };

/** Extra hash parameters owned by other parts of the page, e.g. the pattern library. */
export type Extra = Record<string, string | undefined>;

/** Serialise the selection into the URL hash so a path can be linked. Works on a static host. */
export function toHash(sel: Selection, extra: Extra = {}): string {
  const p = new URLSearchParams();
  (Object.keys(NODE_KEYS) as NodeKey[]).forEach((k) => p.set(NODE_KEYS[k], sel[k]));
  p.set('i', sel.identity);
  if (sel.aiGateway && sel.aiGateway !== 'off') p.set('ag', sel.aiGateway);
  if (sel.apiGateway && sel.apiGateway !== 'off') p.set('pg', sel.apiGateway);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return `#${p.toString()}`;
}

/** Parse the hash, ignoring anything unknown so a hand-edited link cannot break the page. */
export function fromHash(hash: string): Selection {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const sel: Selection = { ...DEFAULT_SELECTION };
  (Object.keys(NODE_KEYS) as NodeKey[]).forEach((k) => {
    const v = p.get(NODE_KEYS[k]);
    if (v && NODES.some((n) => n.id === v && n.column === k)) sel[k] = v;
  });
  const i = p.get('i');
  if (i && IDENTITIES.some((x) => x.id === i)) sel.identity = i as IdentityMode;
  const ag = p.get('ag');
  if (ag && AI_GATEWAY_MODES.some((x) => x.id === ag)) sel.aiGateway = ag as AiGatewayMode;
  const pg = p.get('pg');
  if (pg && API_GATEWAY_MODES.some((x) => x.id === pg)) sel.apiGateway = pg as ApiGatewayMode;
  return sel;
}

/** Read one extra parameter from the hash. */
export function hashParam(hash: string, key: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(key);
}
