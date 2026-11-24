import { AI_GATEWAY_MODES, API_GATEWAY_MODES, COLUMNS, NODES } from '../model/catalog';
import type { Column, Hop, Selection } from '../model/types';
import { NODE_ICON, iconSvg } from './icons';
import { esc } from './util';

export const NODE_W = 172;
export const NODE_H = 50;
export const MAP_W = 1400;
export const MAP_H = 630;

/**
 * Fixed layout: the topology is known, so no graph-layout library is needed.
 * The gateways sit off the direct lines (above the models, below the tools) so a path
 * visibly detours through them when they are switched on.
 */
const POS: Record<string, { x: number; y: number }> = {
  user: { x: 100, y: 250 }, cron: { x: 100, y: 340 },
  web: { x: 315, y: 210 }, teams: { x: 315, y: 290 }, scheduler: { x: 315, y: 370 },
  'azure-container': { x: 530, y: 250 }, 'aws-lambda': { x: 530, y: 340 },
  'ai-gw': { x: 760, y: 52 },
  foundry: { x: 1000, y: 120 }, bedrock: { x: 1000, y: 185 }, anthropic: { x: 1000, y: 250 },
  direct: { x: 760, y: 400 }, mcp: { x: 760, y: 475 },
  'api-gw': { x: 1010, y: 585 },
  snowflake: { x: 1270, y: 370 }, databricks: { x: 1270, y: 445 }, graph: { x: 1270, y: 520 },
};
const HEADER: Record<Exclude<Column, 'gateway'>, { x: number; y: number }> = {
  trigger: { x: 100, y: 168 }, channel: { x: 315, y: 168 }, runtime: { x: 530, y: 168 },
  model: { x: 1000, y: 78 }, tool: { x: 760, y: 360 }, platform: { x: 1270, y: 330 },
};

export function nodePos(id: string): { x: number; y: number } {
  const p = POS[id];
  if (!p) throw new Error(`No layout for ${id}`);
  return p;
}

const columnOf = (id: string) => NODES.find((n) => n.id === id)?.column;

/** Node ids an edge passes through. A direct tool call is drawn through the "Direct SDK call" node. */
export function edgeRoute(hop: Hop): string[] {
  const to = columnOf(hop.to);
  if (columnOf(hop.from) === 'runtime' && (to === 'platform' || hop.to === 'api-gw')) return [hop.from, 'direct', hop.to];
  return [hop.from, hop.to];
}

function segment(a: string, b: string): string {
  const p = nodePos(a);
  const q = nodePos(b);
  const x1 = p.x + NODE_W / 2;
  const x2 = q.x - NODE_W / 2;
  const mx = (x1 + x2) / 2;
  return `M${x1},${p.y} C${mx},${p.y} ${mx},${q.y} ${x2},${q.y}`;
}

export function edgePath(hop: Hop): string {
  const r = edgeRoute(hop);
  const parts: string[] = [];
  for (let i = 0; i < r.length - 1; i++) {
    const seg = segment(r[i]!, r[i + 1]!);
    parts.push(i === 0 ? seg : seg.replace(/^M/, 'L'));
  }
  return parts.join(' ');
}

function shortCred(c: string): string {
  return c.length > 30 ? `${c.slice(0, 28)}…` : c;
}

function gatewaySub(id: string, sel: Selection): string {
  if (id === 'ai-gw') return AI_GATEWAY_MODES.find((m) => m.id === (sel.aiGateway ?? 'off'))?.label ?? 'Off';
  return API_GATEWAY_MODES.find((m) => m.id === (sel.apiGateway ?? 'off'))?.label ?? 'Off';
}

export function renderMap(svg: SVGSVGElement, sel: Selection, hops: Hop[], activeHop: string | null): void {
  svg.setAttribute('viewBox', `0 0 ${MAP_W} ${MAP_H}`);
  const onPath = new Set<string>();
  for (const h of hops) edgeRoute(h).forEach((id) => onPath.add(id));

  const headers = COLUMNS.map((c) => {
    const p = HEADER[c.id as Exclude<Column, 'gateway'>];
    return p ? `<text class="col-head" x="${p.x}" y="${p.y}" text-anchor="middle">${esc(c.label)}</text>` : '';
  }).join('');

  const edges = hops.map((h) => {
    const cls = ['edge', `p-${h.principal}`, `s-${h.severity}`, h.id === activeHop ? 'active' : ''].join(' ');
    const d = edgePath(h);
    const r = edgeRoute(h);
    const a = nodePos(r[r.length - 2]!);
    const b = nodePos(r[r.length - 1]!);
    const lx = (a.x + NODE_W / 2 + b.x - NODE_W / 2) / 2;
    const ly = (a.y + b.y) / 2 - 8;
    return `<g class="${cls}" data-hop="${h.id}" tabindex="0" role="button" aria-label="Hop ${esc(h.from)} to ${esc(h.to)}: ${esc(h.credential)}">
      <path class="edge-hit" d="${d}"/>
      <path class="edge-line" id="path-${h.id}" d="${d}"/>
      <path class="edge-flow" d="${d}"/>
      <text class="edge-label" x="${lx}" y="${ly}" text-anchor="middle">${esc(shortCred(h.credential))}</text>
    </g>`;
  }).join('');

  const selected = new Set(Object.values(sel));
  const nodes = NODES.map((n) => {
    const { x, y } = nodePos(n.id);
    const isGw = n.column === 'gateway';
    const gwOn = isGw && onPath.has(n.id);
    const cls = ['node', `col-${n.column}`, (selected.has(n.id) || gwOn) ? 'selected' : '', onPath.has(n.id) ? 'on-path' : 'dim'].join(' ');
    const sub = isGw ? `${gatewaySub(n.id, sel)} · click to change` : n.sub;
    const icon = NODE_ICON[n.id] ?? (isGw ? 'gateway' : 'tool');
    const hint = isGw ? 'gateway mode, click to cycle' : n.column;
    return `<g class="${cls}" data-node="${n.id}" tabindex="0" role="button" aria-pressed="${selected.has(n.id) || gwOn}" aria-label="${esc(n.label)} (${esc(hint)})">
      <rect x="${x - NODE_W / 2}" y="${y - NODE_H / 2}" width="${NODE_W}" height="${NODE_H}" rx="10"/>
      ${iconSvg(icon, 20, { x: x - NODE_W / 2 + 10, y: y - 10 })}
      <text class="node-label" x="${x + 14}" y="${y - 3}" text-anchor="middle">${esc(n.label)}</text>
      <text class="node-sub" x="${x + 14}" y="${y + 14}" text-anchor="middle">${esc(sub)}</text>
    </g>`;
  }).join('');

  svg.innerHTML = `<defs><filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${headers}<g class="edges">${edges}</g><g class="nodes">${nodes}</g>
    <g id="packet" class="packet" transform="translate(-40,-40)"><circle r="12" class="packet-halo"/><circle r="7" class="packet-core"/></g>`;
}

/** Animate the packet along one hop. Resolves when done. */
export function animatePacket(svg: SVGSVGElement, hopId: string, failed: boolean, principal = 'agent', ms = 900): Promise<void> {
  const path = svg.querySelector<SVGPathElement>(`#path-${hopId}`);
  const packet = svg.querySelector<SVGGElement>('#packet');
  if (!path || !packet) return Promise.resolve();
  const len = path.getTotalLength();
  const stopAt = failed ? 0.55 : 1;
  packet.setAttribute('class', `packet p-${principal}`);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduce ? 1 : ms * Math.max(0.7, Math.min(1.6, len / 420));
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration) * stopAt;
      const pt = path.getPointAtLength(len * k);
      packet.setAttribute('transform', `translate(${pt.x},${pt.y})`);
      if (k < stopAt) requestAnimationFrame(tick);
      else {
        if (failed) packet.classList.add('failed');
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}
