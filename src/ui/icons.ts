import type { ActorKind } from '../patterns/types';

/**
 * Small line icons drawn on a 24x24 grid, stroke only, so they inherit currentColor.
 * Hand-drawn shapes, not taken from any icon set or vendor logo.
 */
export const ICON: Record<ActorKind | 'cron' | 'web' | 'teams' | 'container' | 'lambda' | 'cloud' | 'warehouse' | 'lakehouse' | 'mail' | 'direct', string> = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  human: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M15.5 4.5l2 2 3.5-3.5"/>',
  client: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  agent: '<rect x="5" y="7" width="14" height="12" rx="3"/><path d="M12 3v4"/><circle cx="12" cy="3" r="1"/><circle cx="9.5" cy="12.5" r="1.3"/><circle cx="14.5" cy="12.5" r="1.3"/><path d="M9.5 16h5"/>',
  llm: '<path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 19l-5-3-5 3 1.4-6.2L4 9l5.8-.7z"/>',
  tool: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16v4h4l5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-3-3z"/>',
  mcp: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 12h8M8 15h5"/><circle cx="20" cy="12" r="1.5"/><circle cx="4" cy="12" r="1.5"/>',
  gateway: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/><path d="M4 9h16"/>',
  idp: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><circle cx="12" cy="11" r="2.2"/><path d="M12 13.2V16"/>',
  data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/><path d="M8 10.5h5M10.5 8v5"/>',
  vault: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M12 9v1.5M12 14.5V16M8.5 12.5H10M14 12.5h1.5"/>',
  attacker: '<path d="M12 3c-4.4 0-8 3.1-8 7.5 0 2.6 1.3 4.5 3 5.6V20h10v-3.9c1.7-1.1 3-3 3-5.6C20 6.1 16.4 3 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10 20v-2M14 20v-2"/>',
  guard: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  observability: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  sandbox: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2.5"/><path d="M8 10l-2 2 2 2M16 10l2 2-2 2M13.5 8.5l-3 7"/>',
  queue: '<rect x="3" y="6" width="5" height="12" rx="1"/><rect x="9.5" y="6" width="5" height="12" rx="1"/><rect x="16" y="6" width="5" height="12" rx="1"/>',
  memory: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z"/>',
  cron: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  web: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  teams: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  container: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  lambda: '<path d="M6 20l6-11M9 4h2.5L18 20"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.3 1.5A3.8 3.8 0 0 1 17.5 18z"/>',
  warehouse: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  lakehouse: '<path d="M3 17l5-8 4 5 3-4 6 7z"/><path d="M3 20h18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6l8.5 7 8.5-7"/>',
  direct: '<path d="M4 12h14M14 7l5 5-5 5"/>',
};

/** Icon for a node on the identity map. */
export const NODE_ICON: Record<string, keyof typeof ICON> = {
  user: 'user', cron: 'cron',
  web: 'web', teams: 'teams', scheduler: 'queue',
  'azure-container': 'container', 'aws-lambda': 'lambda',
  foundry: 'llm', bedrock: 'llm', anthropic: 'llm',
  direct: 'direct', mcp: 'mcp',
  snowflake: 'warehouse', databricks: 'lakehouse', graph: 'mail',
};

/** An <svg> or <g> icon. `x`/`y` are the top-left corner when used inside an outer SVG. */
export function iconSvg(name: keyof typeof ICON, size = 20, at?: { x: number; y: number }): string {
  const body = ICON[name];
  if (at) {
    const k = size / 24;
    return `<g class="icon" transform="translate(${at.x},${at.y}) scale(${k})" fill="none" stroke="currentColor" stroke-width="${1.7 / Math.max(k, 0.6)}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
  }
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}
