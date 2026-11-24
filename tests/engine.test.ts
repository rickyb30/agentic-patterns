import { describe, expect, it } from 'vitest';
import { IDENTITIES, NODES } from '../src/model/catalog';
import { overallSeverity, platformPrincipal, resolvePath } from '../src/model/engine';
import { TOURS } from '../src/model/tours';
import type { Selection } from '../src/model/types';
import { fromHash, toHash } from '../src/ui/state';

const ids = (col: string) => NODES.filter((n) => n.column === col).map((n) => n.id);

/** Every combination the UI can produce. */
function allSelections(): Selection[] {
  const out: Selection[] = [];
  for (const trigger of ids('trigger'))
    for (const channel of ids('channel'))
      for (const runtime of ids('runtime'))
        for (const model of ids('model'))
          for (const tool of ids('tool'))
            for (const platform of ids('platform'))
              for (const { id: identity } of IDENTITIES)
                out.push({ trigger, channel, runtime, model, tool, platform, identity });
  return out;
}

describe('content completeness', () => {
  it('resolves every combination without throwing, with sources and a caption on every hop', () => {
    for (const sel of allSelections()) {
      const hops = resolvePath(sel);
      for (const h of hops) {
        expect(h.caption, `${h.id} ${JSON.stringify(sel)}`).not.toBe('');
        expect(h.sources.length, `${h.id} ${JSON.stringify(sel)}`).toBeGreaterThan(0);
        for (const s of h.sources) expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });

  it('never leaks a real-looking secret format into samples', () => {
    for (const sel of allSelections()) {
      const text = JSON.stringify(resolvePath(sel));
      expect(text).not.toMatch(/AKIA[0-9A-Z]{16}/);
      expect(text).not.toMatch(/sk-ant-[A-Za-z0-9]{20,}/);
      expect(text).not.toMatch(/dapi[0-9a-f]{32}/);
    }
  });
});

describe('the core lessons', () => {
  const base: Selection = { trigger: 'user', channel: 'teams', runtime: 'azure-container', model: 'foundry', tool: 'direct', platform: 'snowflake', identity: 'obo' };

  it('OBO to Snowflake carries the user; key-pair carries the agent', () => {
    expect(platformPrincipal(resolvePath(base))).toBe('user');
    expect(platformPrincipal(resolvePath({ ...base, identity: 'm2m' }))).toBe('agent');
  });

  it('OBO fails when nobody is signed in', () => {
    const hops = resolvePath({ ...base, trigger: 'cron', channel: 'scheduler', platform: 'databricks' });
    expect(hops.find((h) => h.to === 'databricks')?.severity).toBe('fail');
  });

  it('token passthrough always fails at the data hop', () => {
    for (const platform of ids('platform')) {
      const hops = resolvePath({ ...base, platform, identity: 'passthrough' });
      expect(hops.at(-1)?.severity).toBe('fail');
    }
  });

  it('passthrough to an MCP server fails there, and the platform hop is not reached', () => {
    const hops = resolvePath({ ...base, tool: 'mcp', identity: 'passthrough' });
    expect(hops.find((h) => h.to === 'mcp')?.severity).toBe('fail');
    expect(hops.at(-1)?.severity).toBe('unreached');
  });

  it('OBO through MCP keeps the user end to end', () => {
    const hops = resolvePath({ ...base, tool: 'mcp' });
    expect(hops.find((h) => h.to === 'mcp')?.principal).toBe('user');
    expect(platformPrincipal(hops)).toBe('user');
  });

  it('an Azure managed identity cannot call Bedrock, but federation can', () => {
    const mi = resolvePath({ ...base, model: 'bedrock', identity: 'managed_identity' });
    expect(mi.find((h) => h.to === 'bedrock')?.severity).toBe('fail');
    const fed = resolvePath({ ...base, model: 'bedrock', identity: 'federation' });
    expect(fed.find((h) => h.to === 'bedrock')?.severity).toBe('ok');
  });

  it('application Mail.Read is flagged as tenant-wide', () => {
    const hops = resolvePath({ ...base, platform: 'graph', identity: 'managed_identity' });
    expect(hops.at(-1)?.blastRadius).toMatch(/Every mailbox/);
  });
});

describe('tours', () => {
  it('each variant resolves, and the variants of a tour differ in outcome', () => {
    for (const t of TOURS) {
      const outcomes = t.variants.map((v) => {
        const hops = resolvePath(v.sel);
        return `${overallSeverity(hops)}/${platformPrincipal(hops)}`;
      });
      expect(new Set(outcomes).size, t.id).toBeGreaterThan(1);
    }
  });
});

describe('URL hash', () => {
  it('round-trips a selection and ignores junk', () => {
    const sel: Selection = { trigger: 'cron', channel: 'scheduler', runtime: 'aws-lambda', model: 'bedrock', tool: 'mcp', platform: 'graph', identity: 'federation' };
    expect(fromHash(toHash(sel))).toEqual(sel);
    expect(fromHash('#t=<script>&i=nope&p=foundry').platform).toBe('snowflake');
  });
});
