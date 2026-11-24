import type { Pattern, Step, Variant } from '../patterns/types';
import { iconSvg } from './icons';
import { esc } from './util';

/** Layout constants for the sequence diagram. Everything is computed; no layout library. */
const COL_W = 156;
const PAD_X = 84;
const HEAD_H = 92;
const ROW_H = 46;
const MIN_W = 720;

export interface SeqLayout {
  width: number;
  height: number;
  x: Record<string, number>;
  rowY: (i: number) => number;
}

export function layoutFor(pattern: Pattern, variant: Variant): SeqLayout {
  const n = pattern.actors.length;
  const inner = Math.max(MIN_W - 2 * PAD_X, (n - 1) * COL_W);
  const gap = n > 1 ? inner / (n - 1) : 0;
  const x: Record<string, number> = {};
  pattern.actors.forEach((a, i) => { x[a.id] = PAD_X + i * gap; });
  return {
    width: inner + 2 * PAD_X,
    height: HEAD_H + variant.steps.length * ROW_H + 28,
    x,
    rowY: (i) => HEAD_H + 26 + i * ROW_H,
  };
}

/**
 * Beats are what one press of "next" reveals. Consecutive steps that share a `group`
 * fire together (parallel fan-out); every other step is its own beat.
 */
export function beatsOf(steps: Step[]): number[][] {
  const beats: number[][] = [];
  steps.forEach((s, i) => {
    const last = beats[beats.length - 1];
    const prev = i > 0 ? steps[i - 1] : undefined;
    if (last && s.group !== undefined && prev?.group === s.group) last.push(i);
    else beats.push([i]);
  });
  return beats;
}

function arrowHead(x: number, y: number, dir: 1 | -1): string {
  return `<path class="head" d="M${x},${y} l${-9 * dir},-5 l0,10 z"/>`;
}

function stepSvg(s: Step, i: number, L: SeqLayout, state: 'future' | 'past' | 'active'): string {
  const y = L.rowY(i);
  const x1 = L.x[s.from]!;
  const x2 = L.x[s.to]!;
  const cls = `step k-${s.kind} ${state}`;
  const num = `<text class="step-num" x="14" y="${y + 4}">${i + 1}</text>`;
  const hit = (x: number, w: number) => `<rect class="step-hit" x="${x}" y="${y - ROW_H / 2}" width="${w}" height="${ROW_H}"/>`;

  if (s.kind === 'think' || s.from === s.to) {
    const w = 34;
    return `<g class="${cls}" data-step="${i}" tabindex="0" role="button" aria-label="Step ${i + 1}: ${esc(s.label)}">
      ${hit(x1 - 20, 220)}${num}
      <path id="seq-path-${i}" class="line" d="M${x1},${y - 10} h${w} v20 h${-w + 8}"/>
      ${arrowHead(x1 + 1, y + 10, -1)}
      <text class="step-label" x="${x1 + w + 8}" y="${y + 4}">${esc(s.label)}</text>
    </g>`;
  }

  const dir: 1 | -1 = x2 > x1 ? 1 : -1;
  const pad = 14;
  const sx = x1 + pad * dir;
  let ex = x2 - pad * dir;
  let end = arrowHead(ex, y, dir);
  if (s.kind === 'block') {
    // A blocked call stops two-thirds of the way and ends in a stop mark.
    ex = sx + (ex - sx) * 0.62;
    end = `<g class="stop"><circle cx="${ex}" cy="${y}" r="9"/><path d="M${ex - 4.5},${y - 4.5} l9,9 M${ex + 4.5},${y - 4.5} l-9,9"/></g>`;
  }
  const lx = (x1 + x2) / 2;
  const left = Math.min(x1, x2);
  return `<g class="${cls}" data-step="${i}" tabindex="0" role="button" aria-label="Step ${i + 1}: ${esc(s.label)}">
    ${hit(left, Math.abs(x2 - x1))}${num}
    <path id="seq-path-${i}" class="line" d="M${sx},${y} L${ex},${y}"/>
    ${end}
    <text class="step-label" x="${lx}" y="${y - 8}" text-anchor="middle">${esc(s.label)}</text>
  </g>`;
}

/**
 * Draw the diagram. `revealed` = index of the last revealed step (-1 = none),
 * `active` = steps in the current beat.
 */
export function renderSequence(svg: SVGSVGElement, pattern: Pattern, variant: Variant, revealed: number, active: number[]): void {
  const L = layoutFor(pattern, variant);
  svg.setAttribute('viewBox', `0 0 ${L.width} ${L.height}`);
  svg.style.minWidth = `${Math.min(L.width, 980)}px`;
  const busy = new Set<string>();
  for (const i of active) { const s = variant.steps[i]; if (s) { busy.add(s.from); busy.add(s.to); } }

  const actors = pattern.actors.map((a) => {
    const x = L.x[a.id]!;
    return `<g class="actor a-${a.kind} ${busy.has(a.id) ? 'busy' : ''}" data-actor="${a.id}">
      <line class="lifeline" x1="${x}" y1="${HEAD_H - 4}" x2="${x}" y2="${L.height - 10}"/>
      <circle class="actor-disc" cx="${x}" cy="28" r="22"/>
      ${iconSvg(a.kind, 24, { x: x - 12, y: 16 })}
      <text class="actor-label" x="${x}" y="66" text-anchor="middle">${esc(a.label)}</text>
      ${a.sub ? `<text class="actor-sub" x="${x}" y="80" text-anchor="middle">${esc(a.sub)}</text>` : ''}
    </g>`;
  }).join('');

  const activeSet = new Set(active);
  const steps = variant.steps.map((s, i) =>
    stepSvg(s, i, L, activeSet.has(i) ? 'active' : i <= revealed ? 'past' : 'future')).join('');

  svg.innerHTML = `<g class="actors">${actors}</g><g class="steps">${steps}</g><g id="seq-packets"></g>`;
}

/** Move one packet along each active step at the same time. */
export function animateBeat(svg: SVGSVGElement, steps: Step[], beat: number[], ms: number): Promise<void> {
  const layer = svg.querySelector('#seq-packets');
  if (!layer) return Promise.resolve();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = beat.map((i) => {
    const path = svg.querySelector<SVGPathElement>(`#seq-path-${i}`);
    const kind = steps[i]?.kind ?? 'call';
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', kind === 'token' ? '7' : '6');
    dot.setAttribute('class', `packet k-${kind}`);
    layer.appendChild(dot);
    return { path, dot, len: path?.getTotalLength() ?? 0 };
  });
  const duration = reduce ? 1 : ms;
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      for (const it of items) {
        if (!it.path) continue;
        const p = it.path.getPointAtLength(it.len * e);
        it.dot.setAttribute('cx', String(p.x));
        it.dot.setAttribute('cy', String(p.y));
      }
      if (k < 1) requestAnimationFrame(tick);
      else { items.forEach((it) => it.dot.remove()); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}

export const KIND_LABEL: Record<Step['kind'], string> = {
  call: 'request', return: 'response', token: 'credential', think: 'reasoning', event: 'async event',
  approval: 'human decision', attack: 'attack', block: 'blocked', data: 'data',
};
