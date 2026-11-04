// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The bot only reacts to explicit invocations. Mentions arrive solely through the
 * `app_mention` event (Slack filters them to this bot's user ID); the app never
 * subscribes to `message.*` events and never matches keywords in message text.
 */

export interface MentionLike {
  type: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

/** Slack encodes a user mention as `<@U123>` or `<@U123|label>`. */
export function mentionsUser(text: string, userId: string): boolean {
  return text.includes(`<@${userId}>`) || text.includes(`<@${userId}|`);
}

export function isExplicitMention(event: MentionLike, botUserId: string | undefined): boolean {
  if (event.type !== 'app_mention') return false;
  if (!botUserId) return false;
  // Other bots and our own messages never trigger a reply, which rules out loops.
  if (event.bot_id || event.subtype === 'bot_message') return false;
  if (!event.user || event.user === botUserId) return false;
  // Defensive check: the text must carry this bot's own mention, not just any user's.
  return mentionsUser(event.text ?? '', botUserId);
}

/** Replies stay in the thread that invoked the bot (a Huddle chat is a thread too). */
export function replyThreadTs(event: { ts?: string; thread_ts?: string }): string | undefined {
  return event.thread_ts ?? event.ts;
}

/** Remembers keys for a while so Slack retries do not produce duplicate replies. */
export class RecentKeys {
  private readonly seenAt = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 10 * 60_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  /** True when the key was already recorded within the TTL; records it otherwise. */
  seen(key: string): boolean {
    const t = this.now();
    for (const [k, at] of this.seenAt) {
      if (t - at > this.ttlMs) this.seenAt.delete(k);
    }
    if (this.seenAt.has(key)) return true;
    this.seenAt.set(key, t);
    return false;
  }
}
