import { CORE_PATTERNS } from './content/core';
import { DATA_PATTERNS } from './content/data';
import { IDENTITY_PATTERNS } from './content/identity';
import { LOCAL_PATTERNS } from './content/local';
import { ORCHESTRATION_PATTERNS } from './content/orchestration';
import { PLATFORM_PATTERNS } from './content/platform';
import { SECURITY_PATTERNS } from './content/security';
import type { Pattern } from './types';

/** Every pattern in library order: the core loop first, then by category. */
export const PATTERNS: Pattern[] = [
  ...CORE_PATTERNS,
  ...ORCHESTRATION_PATTERNS,
  ...IDENTITY_PATTERNS,
  ...DATA_PATTERNS,
  ...SECURITY_PATTERNS,
  ...PLATFORM_PATTERNS,
  ...LOCAL_PATTERNS,
];
