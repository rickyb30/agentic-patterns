import { describe, expect, it } from 'vitest';
import { AI_GATEWAY_MODES, API_GATEWAY_MODES, IDENTITIES, NODES } from '../src/model/catalog';
import { platformPrincipal, resolvePath } from '../src/model/engine';
import type { Selection } from '../src/model/types';
import { PATTERNS } from '../src/patterns';
import { validatePattern } from '../src/patterns/validate';
import { fromHash, toHash } from '../src/ui/state';

const ids = (col: string) => NODES.filter((n) => n.column === col).map((n) => n.id);
const base: Selection = { trigger: 'user', channel: 'teams', runtime: 'azure-container', model: 'foundry', tool: 'direct', platform: 'snowflake', identity: 'obo' };

describe('gateways', () => {
  it('every gateway mode resolves on every path with a caption and https sources', () => {
    const problems: string[] = [];
    for (const runtime of ids('runtime'))
      for (const model of ids('model'))
        for (const tool of ids('tool'))
          for (const platform of ids('platform'))
            for (const { id: identity } of IDENTITIES)
              for (const { id: aiGateway } of AI_GATEWAY_MODES)
                for (const { id: apiGateway } of API_GATEWAY_MODES) {
                  const sel: Selection = { ...base, runtime, model, tool, platform, identity, aiGateway, apiGateway };
                  const hops = resolvePath(sel);
                  const key = JSON.stringify(sel);
                  if (/AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9]{20,}|dapi[0-9a-f]{32}/.test(JSON.stringify(hops))) problems.push(`secret-like value: ${key}`);
                  for (const h of hops) {
                    if (!h.caption) problems.push(`no caption ${h.id}: ${key}`);
                    if (!h.sources.length || h.sources.some((s) => !s.url.startsWith('https://'))) problems.push(`bad sources ${h.id}: ${key}`);
                  }
                }
    expect(problems.slice(0, 10)).toEqual([]);
  }, 30_000);

  it('gateways off adds no gateway hops', () => {
    expect(resolvePath(base).some((h) => h.to.endsWith('-gw') || h.from.endsWith('-gw'))).toBe(false);
  });

  it('an AI gateway adds a hop through ai-gw', () => {
    for (const aiGateway of ['forward', 'swap'] as const) {
      const hops = resolvePath({ ...base, aiGateway });
      expect(hops.some((h) => h.to === 'ai-gw')).toBe(true);
      expect(hops.some((h) => h.from === 'ai-gw')).toBe(true);
    }
  });

  it('API gateway swap hides the user even with OBO; exchange keeps the user', () => {
    expect(platformPrincipal(resolvePath({ ...base, apiGateway: 'swap' }))).toBe('agent');
    expect(platformPrincipal(resolvePath({ ...base, apiGateway: 'exchange' }))).toBe('user');
    expect(platformPrincipal(resolvePath({ ...base, apiGateway: 'forward' }))).toBe('user');
  });

  it('passthrough through a forwarding API gateway fails at the gateway', () => {
    const hops = resolvePath({ ...base, identity: 'passthrough', apiGateway: 'forward' });
    expect(hops.find((h) => h.to === 'api-gw')?.severity).toBe('fail');
  });

  it('round-trips gateway modes through the URL hash and omits them when off', () => {
    const sel: Selection = { ...base, aiGateway: 'swap', apiGateway: 'exchange' };
    const back = fromHash(toHash(sel));
    expect(back.aiGateway).toBe('swap');
    expect(back.apiGateway).toBe('exchange');
    expect(toHash(base)).not.toMatch(/[&#]ag=|[&#]pg=/);
    expect(fromHash('#ag=bogus&pg=nope').aiGateway ?? 'off').toBe('off');
    expect(toHash(fromHash(''))).toBe('');
    expect(toHash({ ...fromHash(''), identity: 'm2m' })).toBe('#i=m2m');
  });
});

describe('pattern library', () => {
  it('every pattern passes validation', () => {
    for (const p of PATTERNS) expect(validatePattern(p), p.id).toEqual([]);
  });

  it('pattern ids are unique and every category is populated', () => {
    const seen = new Set(PATTERNS.map((p) => p.id));
    expect(seen.size).toBe(PATTERNS.length);
    for (const c of ['orchestration', 'identity', 'data', 'security', 'platform']) expect(PATTERNS.some((p) => p.category === c), c).toBe(true);
  });

  it('contains no real-looking secrets or sample-company names', () => {
    const text = JSON.stringify(PATTERNS);
    expect(text).not.toMatch(/AKIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9]{20,}|dapi[0-9a-f]{32}|ghp_[A-Za-z0-9]{36}/);
    expect(text.toLowerCase()).not.toMatch(/contoso/);
  });
});
