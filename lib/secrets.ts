import { hkdfSync } from 'node:crypto';

/** One secret in the environment, a separate key for each use, so no key does two jobs. */
export function deriveKey(appSecret: string, purpose: 'installations' | 'oauth state' | 'dice strips'): Buffer {
  return Buffer.from(hkdfSync('sha256', appSecret, 'dice-companion', purpose, 32));
}
