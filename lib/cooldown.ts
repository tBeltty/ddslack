// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** How long a person waits between two rolls, in milliseconds: enough to stop a flood of clicks, short enough not to notice in play. */
export const ROLL_COOLDOWN_MS = 3000;

/**
 * The time each person last rolled, wherever they rolled. `take` either starts a new wait
 * and lets the roll through, or says how long is left. Kept in memory: a restart clears it.
 */
export class Cooldown {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly ms: number = ROLL_COOLDOWN_MS,
    private readonly now: () => number = Date.now
  ) {}

  take(userId: string): { ok: true } | { ok: false; waitMs: number } {
    const now = this.now();
    const since = now - (this.last.get(userId) ?? Number.NEGATIVE_INFINITY);
    if (since < this.ms) return { ok: false, waitMs: this.ms - since };
    this.last.set(userId, now);
    this.forgetOld(now);
    return { ok: true };
  }

  /** People whose wait is over need no entry, so the map holds only recent rollers. */
  private forgetOld(now: number): void {
    if (this.last.size < 1000) return;
    for (const [userId, at] of this.last) if (now - at >= this.ms) this.last.delete(userId);
  }
}

export function cooldownMessage(waitMs: number): string {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return `You can roll again in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}.`;
}
