/** Escape text for safe insertion into innerHTML. Content contains placeholders like <key>. */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const PRINCIPAL_LABEL = {
  user: 'the user',
  agent: 'the agent / workload',
  key: 'a shared secret',
  none: 'nobody',
} as const;
