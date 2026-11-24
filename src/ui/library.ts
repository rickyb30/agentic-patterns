import { CATEGORY_LABEL, type Category, type Pattern } from '../patterns/types';
import { type ICON, iconSvg } from './icons';
import { KIND_LABEL, animateBeat, beatsOf, renderSequence } from './sequence';
import { esc } from './util';

export interface LibraryState { pattern: string; variant: number }

/** A library entry that is a full interactive view rather than a sequence diagram (e.g. the identity paths map). */
export interface InteractiveCard {
  id: string;
  category: Category;
  title: string;
  tagline: string;
  tags: string[];
  icons: (keyof typeof ICON)[];
  el: HTMLElement;
  /** Called after the card's view becomes visible. */
  onShow?: () => void;
}

/**
 * The pattern library: filterable cards, and a stage that plays one pattern as an animated sequence diagram.
 * Owns its own DOM under `root`; reports state changes through `onChange` so main can update the URL.
 */
export function mountLibrary(root: HTMLElement, patterns: Pattern[], initial: Partial<LibraryState>, onChange: (s: LibraryState) => void, interactive: InteractiveCard[] = []) {
  let filter: Category | 'all' = 'all';
  let query = '';
  let extra: InteractiveCard | null = interactive.find((x) => x.id === initial.pattern) ?? (initial.pattern && patterns.some((p) => p.id === initial.pattern) ? null : interactive[0] ?? null);
  let pattern = patterns.find((p) => p.id === initial.pattern) ?? patterns[0]!;
  let variantIdx = Math.min(initial.variant ?? 0, pattern.variants.length - 1);
  let beat = -1;
  let playing = false;
  let speed = 1;
  let runToken = 0;

  root.innerHTML = `
    <div class="lib-bar">
      <div class="cat-filter" role="tablist" aria-label="Pattern category"></div>
      <input class="lib-search" type="search" placeholder="Filter patterns: oauth, mcp, rag, hitl…" aria-label="Filter patterns"/>
    </div>
    <div class="cards" role="list"></div>
    <div class="stage" id="stage">
      <div class="stage-main">
        <div class="stage-head"></div>
        <div class="player-controls">
          <button type="button" data-act="first" title="Restart (Home)" aria-label="Restart">⏮</button>
          <button type="button" data-act="prev" title="Previous step (←)" aria-label="Previous step">◀</button>
          <button type="button" data-act="play" class="play" title="Play / pause (space)" aria-label="Play">▶ Play</button>
          <button type="button" data-act="next" title="Next step (→)" aria-label="Next step">▶|</button>
          <input type="range" class="scrub" min="-1" value="-1" aria-label="Scrub through steps"/>
          <label class="speed">Speed <select aria-label="Playback speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
          <span class="counter" aria-live="polite"></span>
        </div>
        <div class="seq-wrap" tabindex="0" aria-label="Sequence diagram. Use arrow keys to step."><svg class="seq" role="group"></svg></div>
        <div class="outcome"></div>
      </div>
      <aside class="stage-panel" aria-live="polite"></aside>
    </div>`;

  const q = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const catBar = q<HTMLElement>('.cat-filter');
  const search = q<HTMLInputElement>('.lib-search');
  const cards = q<HTMLElement>('.cards');
  const head = q<HTMLElement>('.stage-head');
  const svg = q<SVGSVGElement>('svg.seq');
  const panel = q<HTMLElement>('.stage-panel');
  const scrub = q<HTMLInputElement>('.scrub');
  const counter = q<HTMLElement>('.counter');
  const playBtn = q<HTMLButtonElement>('[data-act="play"]');
  const outcome = q<HTMLElement>('.outcome');
  const seqWrap = q<HTMLElement>('.seq-wrap');

  const variant = () => pattern.variants[variantIdx]!;
  const beats = () => beatsOf(variant().steps);

  function renderFilters(): void {
    const counts = new Map<string, number>();
    [...interactive, ...patterns].forEach((p) => counts.set(p.category, (counts.get(p.category) ?? 0) + 1));
    const cats: (Category | 'all')[] = ['all', ...(Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => counts.has(c))];
    catBar.innerHTML = cats.map((c) => `<button type="button" role="tab" class="cat c-${c} ${c === filter ? 'on' : ''}" aria-selected="${c === filter}" data-cat="${c}">
      ${c === 'all' ? 'All' : esc(CATEGORY_LABEL[c])} <span class="n">${c === 'all' ? patterns.length + interactive.length : counts.get(c)}</span></button>`).join('');
  }

  function matchesText(category: Category, hay: string): boolean {
    if (filter !== 'all' && category !== filter) return false;
    if (!query) return true;
    return query.toLowerCase().split(/\s+/).every((w) => hay.toLowerCase().includes(w));
  }
  const matches = (p: Pattern) => matchesText(p.category, `${p.title} ${p.tagline} ${p.tags.join(' ')} ${p.actors.map((a) => a.label).join(' ')}`);

  function renderCards(): void {
    const xs = interactive.filter((x) => matchesText(x.category, `${x.title} ${x.tagline} ${x.tags.join(' ')}`));
    const list = patterns.filter(matches);
    const xCards = xs.map((x) => `<button type="button" role="listitem" class="card interactive c-${x.category} ${x === extra ? 'on' : ''}" data-pattern="${x.id}">
        <span class="card-cat">${esc(CATEGORY_LABEL[x.category])} <span class="live-badge">interactive</span></span>
        <span class="card-title">${esc(x.title)}</span>
        <span class="card-tag">${esc(x.tagline)}</span>
        <span class="card-foot"><span class="card-icons">${x.icons.map((k) => iconSvg(k, 16)).join('')}</span></span>
      </button>`).join('');
    cards.innerHTML = xs.length + list.length === 0 ? '<p class="hint">No pattern matches that filter.</p>' : xCards + list.map((p) => {
      const kinds = [...new Set(p.actors.map((a) => a.kind))].slice(0, 6);
      const tones = p.variants.map((v) => `<i class="tone t-${v.tone}" title="${esc(v.label)}"></i>`).join('');
      return `<button type="button" role="listitem" class="card c-${p.category} ${!extra && p.id === pattern.id ? 'on' : ''}" data-pattern="${p.id}">
        <span class="card-cat">${esc(CATEGORY_LABEL[p.category])}</span>
        <span class="card-title">${esc(p.title)}</span>
        <span class="card-tag">${esc(p.tagline)}</span>
        <span class="card-foot"><span class="card-icons">${kinds.map((k) => iconSvg(k, 16)).join('')}</span><span class="tones">${tones}</span></span>
      </button>`;
    }).join('');
  }

  function renderStage(animateActive = false): void {
    const v = variant();
    const bs = beats();
    const current = beat >= 0 ? bs[beat]! : [];
    const revealed = beat >= 0 ? Math.max(...current) : -1;
    renderSequence(svg, pattern, v, revealed, current);

    head.innerHTML = `
      <div class="stage-title"><span class="card-cat c-${pattern.category}">${esc(CATEGORY_LABEL[pattern.category])}</span><h3>${esc(pattern.title)}</h3></div>
      <p class="stage-summary">${esc(pattern.summary)}</p>
      <div class="variants">${pattern.variants.map((x, i) => `<button type="button" class="variant t-${x.tone} ${i === variantIdx ? 'on' : ''}" data-variant="${i}" aria-pressed="${i === variantIdx}">${esc(x.label)}</button>`).join('')}</div>`;

    scrub.max = String(bs.length - 1);
    scrub.value = String(beat);
    counter.textContent = beat < 0 ? `${v.steps.length} steps` : `step ${revealed + 1} / ${v.steps.length}`;
    playBtn.textContent = playing ? '⏸ Pause' : beat >= bs.length - 1 ? '↻ Replay' : '▶ Play';
    const done = beat >= bs.length - 1;
    outcome.className = `outcome t-${v.tone} ${done ? 'shown' : ''}`;
    outcome.innerHTML = `<strong>${v.tone === 'bad' ? 'Outcome ✗' : v.tone === 'good' ? 'Outcome ✓' : 'Outcome'}</strong> ${esc(v.outcome)}`;

    renderPanel(current);
    if (animateActive && current.length) void animateBeat(svg, v.steps, current, 650 / speed);
  }

  function renderPanel(current: number[]): void {
    const v = variant();
    const stepCards = current.map((i) => {
      const s = v.steps[i]!;
      const from = pattern.actors.find((a) => a.id === s.from)!;
      const to = pattern.actors.find((a) => a.id === s.to)!;
      return `<div class="step-card k-${s.kind}">
        <div class="step-meta"><span class="kind-badge k-${s.kind}">${esc(KIND_LABEL[s.kind])}</span><span>#${i + 1}</span>
        <span class="who">${esc(from.label)}${s.from === s.to ? '' : ` → ${esc(to.label)}`}</span></div>
        <p class="step-title">${esc(s.label)}</p>
        <p>${esc(s.detail)}</p>
        ${s.payload ? `<pre>${esc(s.payload)}</pre>` : ''}
      </div>`;
    }).join('');
    const listItems = v.steps.map((s, i) => {
      const state = current.includes(i) ? 'active' : beat >= 0 && i <= Math.max(...(beats()[beat] ?? [-1])) ? 'past' : 'future';
      return `<li class="${state} k-${s.kind}"><button type="button" data-step="${i}"><i class="dot k-${s.kind}"></i>${esc(s.label)}</button></li>`;
    }).join('');
    const section = (title: string, items: string[] | undefined, cls = '') => items?.length
      ? `<details class="${cls}" ${cls === 'verify-list' ? '' : 'open'}><summary>${esc(title)}</summary><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : '';
    panel.innerHTML = `
      ${stepCards || '<p class="hint">Press <kbd>▶ Play</kbd>, or click any arrow or step to inspect it. Use ← → in the diagram.</p>'}
      <h4>Steps</h4><ol class="step-list">${listItems}</ol>
      ${section('When to use', pattern.whenToUse)}
      ${section('Risks and failure modes', pattern.risks)}
      ${section('Unverified', pattern.verify, 'verify-list')}
      <details open><summary>Sources</summary><ul class="sources">${pattern.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ul></details>`;
  }

  function goTo(b: number, animate = true): void {
    beat = Math.max(-1, Math.min(b, beats().length - 1));
    renderStage(animate);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function play(): Promise<void> {
    if (playing) { playing = false; runToken++; renderStage(); return; }
    const token = ++runToken;
    playing = true;
    if (beat >= beats().length - 1) beat = -1;
    while (playing && token === runToken && beat < beats().length - 1) {
      beat++;
      renderStage();
      const current = beats()[beat]!;
      await animateBeat(svg, variant().steps, current, 650 / speed);
      if (token !== runToken) return;
      await sleep(450 / speed);
    }
    if (token === runToken) { playing = false; renderStage(); }
  }

  function stop(): void { playing = false; runToken++; }

  const stage = q<HTMLElement>('#stage');
  function showView(): void {
    stage.hidden = extra !== null;
    for (const x of interactive) x.el.hidden = x !== extra;
  }

  function select(id: string, v = 0, autoplay = true): void {
    const x = interactive.find((c) => c.id === id);
    if (x) {
      stop();
      extra = x;
      showView();
      renderCards();
      onChange({ pattern: x.id, variant: 0 });
      x.onShow?.();
      return;
    }
    const p = patterns.find((c) => c.id === id);
    if (!p) return;
    stop();
    extra = null;
    showView();
    pattern = p;
    variantIdx = Math.min(v, p.variants.length - 1);
    beat = -1;
    renderCards();
    renderStage();
    onChange({ pattern: pattern.id, variant: variantIdx });
    if (autoplay) void play();
  }

  catBar.addEventListener('click', (e) => {
    const c = (e.target as Element).closest('[data-cat]')?.getAttribute('data-cat');
    if (!c) return;
    filter = c as Category | 'all';
    renderFilters(); renderCards();
  });
  search.addEventListener('input', () => { query = search.value.trim(); renderCards(); });
  cards.addEventListener('click', (e) => {
    const id = (e.target as Element).closest('[data-pattern]')?.getAttribute('data-pattern');
    if (!id) return;
    select(id);
    (extra?.el ?? stage).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  head.addEventListener('click', (e) => {
    const v = (e.target as Element).closest('[data-variant]')?.getAttribute('data-variant');
    if (v !== null && v !== undefined) select(pattern.id, Number(v));
  });
  root.querySelector('.player-controls')!.addEventListener('click', (e) => {
    const act = (e.target as Element).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'play') void play();
    else if (act === 'first') { stop(); goTo(-1, false); }
    else if (act === 'prev') { stop(); goTo(beat - 1); }
    else if (act === 'next') { stop(); goTo(beat + 1); }
  });
  scrub.addEventListener('input', () => { stop(); goTo(Number(scrub.value), false); });
  root.querySelector<HTMLSelectElement>('.speed select')!.addEventListener('change', (e) => { speed = Number((e.target as HTMLSelectElement).value); });

  const stepIndexToBeat = (i: number) => beats().findIndex((b) => b.includes(i));
  const onStep = (e: Event) => {
    const s = (e.target as Element).closest('[data-step]')?.getAttribute('data-step');
    if (s !== null && s !== undefined) { stop(); goTo(stepIndexToBeat(Number(s))); }
  };
  svg.addEventListener('click', onStep);
  panel.addEventListener('click', onStep);
  seqWrap.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); goTo(beat + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); goTo(beat - 1); }
    else if (e.key === ' ') { e.preventDefault(); void play(); }
    else if (e.key === 'Home') { e.preventDefault(); stop(); goTo(-1, false); }
    else if (e.key === 'Enter') { const t = (e.target as Element).closest('[data-step]'); if (t) onStep(e); }
  });

  for (const x of interactive) cards.after(x.el);
  renderFilters();
  renderCards();
  renderStage();
  showView();

  return { select, current: (): LibraryState => (extra ? { pattern: extra.id, variant: 0 } : { pattern: pattern.id, variant: variantIdx }) };
}
