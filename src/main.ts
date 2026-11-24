import './style.css';
import { AI_GATEWAY_MODES, API_GATEWAY_MODES, IDENTITIES, nodeById } from './model/catalog';
import { resolvePath } from './model/engine';
import { TOURS } from './model/tours';
import type { AiGatewayMode, ApiGatewayMode, Hop, IdentityMode, Selection } from './model/types';
import { PATTERNS } from './patterns';
import { renderTokenCard } from './ui/extras';
import { renderInspector } from './ui/inspector';
import { mountLibrary } from './ui/library';
import { animatePacket, renderMap } from './ui/map';
import { fromHash, hashParam, toHash } from './ui/state';
import { esc } from './ui/util';

const $ = <T extends Element>(sel: string) => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const svg = $<SVGSVGElement>('#map');
const inspector = $<HTMLElement>('#inspector');
const identityBar = $<HTMLElement>('#identity-bar');
const gatewayBar = $<HTMLElement>('#gateway-bar');
const tourSelect = $<HTMLSelectElement>('#tour-select');
const tourPanel = $<HTMLElement>('#tour-panel');
const legend = $<HTMLElement>('#legend');
const tokenCard = $<HTMLElement>('#token-card');

let sel: Selection = fromHash(location.hash);
let hops: Hop[] = [];
let activeHop: string | null = null;
let stepIndex = -1;
let running = false;
let runToken = 0;
let tourId = '';

const library = mountLibrary(
  $<HTMLElement>('#library'),
  PATTERNS,
  { pattern: hashParam(location.hash, 'pat') ?? undefined, variant: Number(hashParam(location.hash, 'pv') ?? 0) || 0 },
  () => writeHash(),
  [{
    id: 'identity-paths',
    category: 'identity',
    title: 'Identity paths',
    tagline: 'Trigger → channel → runtime → model → tools → data, with the identity and gateways you choose.',
    tags: ['obo', 'm2m', 'managed identity', 'federation', 'api key', 'gateway', 'snowflake', 'databricks', 'graph', 'bedrock', 'foundry'],
    icons: ['user', 'agent', 'gateway', 'llm', 'warehouse'],
    el: $<HTMLElement>('#identity-explorer'),
    onShow: () => { activeHop = null; renderActive(); void runAll(); },
  }],
);

function writeHash(): void {
  const lib = library?.current();
  // The first interactive card is the default view, so it is left out of the URL like other defaults.
  const pat = lib && lib.pattern !== 'identity-paths' ? lib.pattern : undefined;
  const hash = toHash(sel, lib ? { pat, pv: lib.variant ? String(lib.variant) : undefined } : {});
  if (hash !== location.hash) history.replaceState(null, '', hash || location.pathname + location.search);
}

/** Redraw the parts that depend on the active hop only. Cheap; called on every animation step. */
function renderActive(): void {
  renderMap(svg, sel, hops, activeHop);
  renderInspector(inspector, hops, activeHop);
  renderTokenCard(tokenCard, hops, activeHop);
}

function render(): void {
  hops = resolvePath(sel);
  if (activeHop && !hops.some((h) => h.id === activeHop)) activeHop = null;
  renderActive();
  renderIdentityBar();
  renderGatewayBar();
  renderTourPanel();
  writeHash();
}

function renderIdentityBar(): void {
  identityBar.innerHTML = `<span class="bar-label">Identity</span>` + IDENTITIES.map((i) => `<button type="button" class="id-btn ${i.id === sel.identity ? 'on' : ''} ${i.carriesUser ? 'user' : 'agent'}"
      data-identity="${i.id}" aria-pressed="${i.id === sel.identity}" title="${esc(i.short)}">${esc(i.label)}</button>`).join('')
    + `<p class="id-desc">${esc(IDENTITIES.find((i) => i.id === sel.identity)?.short ?? '')}</p>`;
}

function renderGatewayBar(): void {
  const ai = sel.aiGateway ?? 'off';
  const api = sel.apiGateway ?? 'off';
  const group = (name: string, key: 'ai' | 'api', modes: { id: string; label: string; short: string }[], cur: string) => `
    <div class="gw-group" role="radiogroup" aria-label="${esc(name)}">
      <span class="bar-label">${esc(name)}</span>
      ${modes.map((m) => `<button type="button" role="radio" class="gw-btn ${m.id === cur ? 'on' : ''} m-${m.id}" aria-checked="${m.id === cur}" data-gw="${key}" data-mode="${m.id}" title="${esc(m.short)}">${esc(m.label)}</button>`).join('')}
      <span class="gw-desc">${esc(modes.find((m) => m.id === cur)?.short ?? '')}</span>
    </div>`;
  gatewayBar.innerHTML = group('AI gateway → models', 'ai', AI_GATEWAY_MODES, ai) + group('API gateway → tools / data', 'api', API_GATEWAY_MODES, api);
}

function renderTourPanel(): void {
  const tour = TOURS.find((t) => t.id === tourId);
  if (!tour) { tourPanel.hidden = true; return; }
  tourPanel.hidden = false;
  const current = tour.variants.find((v) => same(v.sel, sel));
  tourPanel.innerHTML = `
    <h2>${esc(tour.title)}</h2>
    <p><strong>${esc(tour.question)}</strong> ${esc(tour.narrative)}</p>
    <div class="variants">${tour.variants.map((v, i) => `<button type="button" class="variant ${v === current ? 'on' : ''}" data-variant="${i}">${esc(v.label)}</button>`).join('')}</div>
    <p class="takeaway">${current ? esc(current.takeaway) : 'You have changed the path. Pick a variant to return to the tour.'}</p>`;
}

const SEL_KEYS: (keyof Selection)[] = ['trigger', 'channel', 'runtime', 'model', 'tool', 'platform', 'identity', 'aiGateway', 'apiGateway'];
function same(a: Selection, b: Selection): boolean {
  const norm = (s: Selection, k: keyof Selection) => s[k] ?? 'off';
  return SEL_KEYS.every((k) => norm(a, k) === norm(b, k));
}

function renderLegend(): void {
  legend.innerHTML = `
    <span><i class="sw p-user"></i>carries the user</span>
    <span><i class="sw p-agent"></i>carries the agent / workload</span>
    <span><i class="sw p-key"></i>shared secret</span>
    <span><i class="sw s-fail"></i>fails</span>
    <span><i class="sw s-unreached"></i>not reached</span>`;
}

function setSel(next: Partial<Selection>): void {
  runToken++;
  running = false;
  sel = { ...sel, ...next };
  stepIndex = -1;
  render();
}

async function runAll(): Promise<void> {
  const token = ++runToken;
  running = true;
  for (let i = 0; i < hops.length; i++) {
    if (token !== runToken) return;
    stepIndex = i;
    const h = hops[i]!;
    activeHop = h.id;
    renderActive();
    await animatePacket(svg, h.id, h.severity === 'fail' || h.severity === 'unreached', h.principal);
    if (h.severity === 'fail') break;
  }
  if (token === runToken) running = false;
}

async function step(): Promise<void> {
  if (running) return;
  stepIndex = (stepIndex + 1) % hops.length;
  const h = hops[stepIndex]!;
  activeHop = h.id;
  renderActive();
  running = true;
  await animatePacket(svg, h.id, h.severity === 'fail', h.principal);
  running = false;
}

function selectHop(id: string): void {
  runToken++;
  running = false;
  activeHop = id;
  stepIndex = hops.findIndex((h) => h.id === id);
  renderActive();
}

function cycleGateway(id: string): void {
  if (id === 'ai-gw') {
    const i = AI_GATEWAY_MODES.findIndex((m) => m.id === (sel.aiGateway ?? 'off'));
    setSel({ aiGateway: AI_GATEWAY_MODES[(i + 1) % AI_GATEWAY_MODES.length]!.id });
  } else {
    const i = API_GATEWAY_MODES.findIndex((m) => m.id === (sel.apiGateway ?? 'off'));
    setSel({ apiGateway: API_GATEWAY_MODES[(i + 1) % API_GATEWAY_MODES.length]!.id });
  }
}

function onActivate(target: Element): void {
  const node = target.closest('[data-node]')?.getAttribute('data-node');
  if (node) {
    const col = nodeById(node).column;
    if (col === 'gateway') cycleGateway(node);
    else setSel({ [col]: node } as Partial<Selection>);
    return;
  }
  const hop = target.closest('[data-hop]')?.getAttribute('data-hop');
  if (hop) selectHop(hop);
}

svg.addEventListener('click', (e) => onActivate(e.target as Element));
svg.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(e.target as Element); }
});
inspector.addEventListener('click', (e) => {
  const hop = (e.target as Element).closest('[data-hop]')?.getAttribute('data-hop');
  if (hop) selectHop(hop);
});
identityBar.addEventListener('click', (e) => {
  const id = (e.target as Element).closest('[data-identity]')?.getAttribute('data-identity');
  if (id) setSel({ identity: id as IdentityMode });
});
gatewayBar.addEventListener('click', (e) => {
  const b = (e.target as Element).closest('[data-gw]');
  if (!b) return;
  const mode = b.getAttribute('data-mode')!;
  if (b.getAttribute('data-gw') === 'ai') setSel({ aiGateway: mode as AiGatewayMode });
  else setSel({ apiGateway: mode as ApiGatewayMode });
});
tourPanel.addEventListener('click', (e) => {
  const v = (e.target as Element).closest('[data-variant]')?.getAttribute('data-variant');
  const tour = TOURS.find((t) => t.id === tourId);
  const variant = v !== null && v !== undefined ? tour?.variants[Number(v)] : undefined;
  if (variant) { sel = { ...variant.sel }; activeHop = null; render(); void runAll(); }
});
tourSelect.innerHTML += TOURS.map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
tourSelect.addEventListener('change', () => {
  tourId = tourSelect.value;
  const tour = TOURS.find((t) => t.id === tourId);
  if (tour?.variants[0]) { sel = { ...tour.variants[0].sel }; activeHop = null; }
  render();
  if (tour) void runAll();
});
$('#run-btn').addEventListener('click', () => void runAll());
$('#step-btn').addEventListener('click', () => void step());
window.addEventListener('hashchange', () => { sel = fromHash(location.hash); render(); });

// Theme: follows the OS by default; the button pins light or dark for this visit and remembers it.
const themeBtn = $<HTMLButtonElement>('#theme-btn');
function applyTheme(t: string | null): void {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
try { applyTheme(localStorage.getItem('theme')); } catch { /* storage unavailable */ }
themeBtn.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('theme', next); } catch { /* storage unavailable */ }
});

renderLegend();
render();
