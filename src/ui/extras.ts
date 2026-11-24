import { nodeById } from '../model/catalog';
import type { Hop } from '../model/types';
import { PRINCIPAL_LABEL, esc } from './util';

const CLAIM_KEYS = ['aud', 'upn', 'oid', 'sub', 'azp', 'scp', 'roles', 'idtyp'] as const;

/** The last hop before `index` that carried decoded claims, so the card can show what changed. */
function previousClaims(hops: Hop[], index: number): Record<string, unknown> | undefined {
  for (let i = index - 1; i >= 0; i--) if (hops[i]?.claims) return hops[i]!.claims;
  return undefined;
}

const show = (v: unknown) => (Array.isArray(v) ? `[${v.join(', ')}]` : String(v));

/**
 * A compact "token in flight" card under the map. Claims that differ from the previous token on the
 * path are highlighted, which makes OBO (same user, new aud/azp) and swaps (user gone) easy to see.
 */
export function renderTokenCard(el: HTMLElement, hops: Hop[], activeHop: string | null): void {
  const index = hops.findIndex((h) => h.id === activeHop);
  const hop = hops[index];
  if (!hop) {
    el.innerHTML = '<div class="token-empty">Token in flight: press <strong>▶ Run</strong> or click a hop to see the credential, and how its claims change hop by hop.</div>';
    return;
  }
  const prev = previousClaims(hops, index);
  const rows = hop.claims ? CLAIM_KEYS.filter((k) => hop.claims![k] !== undefined || prev?.[k] !== undefined).map((k) => {
    const now = hop.claims![k];
    const before = prev?.[k];
    const changed = prev !== undefined && show(now) !== show(before);
    const gone = now === undefined;
    return `<div class="claim ${changed ? 'changed' : ''} ${gone ? 'gone' : ''}"><span class="ck">${k}</span>
      <span class="cv">${gone ? '<s>' + esc(show(before)) + '</s>' : esc(show(now))}</span>
      ${changed && !gone && before !== undefined ? `<span class="was">was ${esc(show(before))}</span>` : ''}</div>`;
  }).join('') : '<div class="claim"><span class="cv muted">No JWT on this hop: the credential is opaque, signed per request, or a key.</span></div>';
  el.innerHTML = `<div class="token p-${hop.principal} s-${hop.severity}" data-hop="${hop.id}">
    <div class="token-head"><span class="token-route">${esc(nodeById(hop.from).label)} → ${esc(nodeById(hop.to).label)}</span>
      <span class="badge p-${hop.principal}">${esc(PRINCIPAL_LABEL[hop.principal])}</span></div>
    <div class="token-cred">${esc(hop.credential)}</div>
    <div class="claims">${rows}</div>
  </div>`;
}
