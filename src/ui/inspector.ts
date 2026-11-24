import { nodeById } from '../model/catalog';
import { overallSeverity, platformPrincipal } from '../model/engine';
import type { Hop } from '../model/types';
import { PRINCIPAL_LABEL, esc } from './util';

const SEV_TEXT = { ok: 'works', caveat: 'works, with caveats', fail: 'fails', unreached: 'not reached' } as const;

function pre(title: string, body: string | undefined): string {
  return body ? `<section><h3>${esc(title)}</h3><pre>${esc(body)}</pre></section>` : '';
}

function para(title: string, body: string | undefined, cls = ''): string {
  return body ? `<section class="${cls}"><h3>${esc(title)}</h3><p>${esc(body)}</p></section>` : '';
}

function list(title: string, items: string[] | undefined, cls = ''): string {
  if (!items || items.length === 0) return '';
  return `<section class="${cls}"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`;
}

export function renderInspector(el: HTMLElement, hops: Hop[], activeHop: string | null): void {
  const overall = overallSeverity(hops);
  const sees = platformPrincipal(hops);
  const chips = hops.map((h) => `<button type="button" class="chip s-${h.severity} ${h.id === activeHop ? 'active' : ''}" data-hop="${h.id}">
      ${esc(nodeById(h.from).label)} → ${esc(nodeById(h.to).label)}</button>`).join('');

  const hop = hops.find((h) => h.id === activeHop);
  const detail = hop ? `
    <div class="hop-head">
      <span class="badge s-${hop.severity}">${SEV_TEXT[hop.severity]}</span>
      <span class="badge p-${hop.principal}">carries ${PRINCIPAL_LABEL[hop.principal]}</span>
    </div>
    <p class="caption">${esc(hop.caption)}</p>
    ${hop.severity === 'unreached' ? '<p class="note">An earlier hop failed, so this call never happens. The detail below shows what it would look like.</p>' : ''}
    ${para('Credential on the wire', hop.credential)}
    ${pre('Token acquisition / exchange', hop.exchange)}
    ${pre('Request', hop.wire)}
    ${hop.claims ? pre('Decoded token claims (sample)', JSON.stringify(hop.claims, null, 2)) : ''}
    ${para('Principal the receiver records', hop.principalLabel)}
    ${para('Permission check', hop.permission)}
    ${para('Result', hop.result, 'result')}
    ${para('Audit trail', hop.audit)}
    ${para('Blast radius if this credential leaks', hop.blastRadius)}
    ${list('Failure modes', hop.failures)}
    ${list('Unverified', hop.verify, 'verify-list')}
    <section><h3>Sources</h3><ul class="sources">${hop.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ul></section>
  ` : '<p class="hint">Click a hop on the map, or a step above, to inspect it.</p>';

  el.innerHTML = `
    <div class="summary">
      <span class="badge s-${overall}">Path ${SEV_TEXT[overall]}</span>
      <span class="badge p-${sees}">Platform sees ${PRINCIPAL_LABEL[sees]}</span>
    </div>
    <div class="chips" role="tablist">${chips}</div>
    <div class="detail">${detail}</div>`;
}
