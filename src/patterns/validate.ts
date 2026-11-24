import type { Pattern } from './types';

/** Returns a list of problems with a pattern. Empty means valid. Used by tests and by content authors. */
export function validatePattern(p: Pattern): string[] {
  const errs: string[] = [];
  const where = (s: string) => `${p.id}: ${s}`;
  const actorIds = new Set(p.actors.map((a) => a.id));
  if (!/^[a-z0-9-]+$/.test(p.id)) errs.push(where('id must be kebab-case'));
  if (p.actors.length < 2 || p.actors.length > 7) errs.push(where(`needs 2–7 actors, has ${p.actors.length}`));
  if (actorIds.size !== p.actors.length) errs.push(where('duplicate actor ids'));
  if (p.variants.length === 0) errs.push(where('needs at least one variant'));
  if (p.sources.length === 0) errs.push(where('needs at least one source'));
  for (const s of p.sources) if (!s.url.startsWith('https://')) errs.push(where(`source not https: ${s.url}`));
  const variantIds = new Set<string>();
  for (const v of p.variants) {
    if (variantIds.has(v.id)) errs.push(where(`duplicate variant id ${v.id}`));
    variantIds.add(v.id);
    if (v.steps.length === 0 || v.steps.length > 16) errs.push(where(`${v.id}: needs 1–16 steps, has ${v.steps.length}`));
    v.steps.forEach((s, i) => {
      if (!actorIds.has(s.from)) errs.push(where(`${v.id}[${i}]: unknown from "${s.from}"`));
      if (!actorIds.has(s.to)) errs.push(where(`${v.id}[${i}]: unknown to "${s.to}"`));
      if (s.label.length > 42) errs.push(where(`${v.id}[${i}]: label over 42 chars`));
      if (!s.detail.trim()) errs.push(where(`${v.id}[${i}]: empty detail`));
      if (s.kind === 'think' && s.from !== s.to) errs.push(where(`${v.id}[${i}]: think step must have from === to`));
    });
  }
  return errs;
}
