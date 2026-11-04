// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { webApi } from '@slack/bolt';
import type { RollMessage } from './roll.js';
import type { RollTarget } from './target.js';

/** Posts a roll to its target: a response URL (slash command or ephemeral picker), or a channel/thread. */
export async function publish(
  client: webApi.WebClient,
  target: RollTarget,
  userId: string,
  message: RollMessage,
  secret: boolean
): Promise<void> {
  if (target.responseUrl) {
    await postToResponseUrl(target.responseUrl, message, secret);
    return;
  }
  const thread = target.threadTs ? { thread_ts: target.threadTs } : {};
  if (secret) {
    await client.chat.postEphemeral({ channel: target.channel, user: userId, ...message, ...thread });
  } else {
    await client.chat.postMessage({ channel: target.channel, ...message, ...thread });
  }
}

const RESPONSE_URL_TIMEOUT_MS = 5000;

/** Answers through a slash command or interaction response URL, which works without channel membership. */
export async function postToResponseUrl(url: string, message: RollMessage, ephemeral: boolean): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response_type: ephemeral ? 'ephemeral' : 'in_channel', replace_original: false, ...message }),
    signal: AbortSignal.timeout(RESPONSE_URL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`response_url returned ${res.status}`);
}

export function slackErrorCode(err: unknown): string | undefined {
  return (err as { data?: { error?: string } })?.data?.error;
}

/** True when Slack refused a call for going over its rate limit, even after the client's retries. */
export function isRateLimited(err: unknown): boolean {
  const e = err as { code?: string; message?: string; data?: { error?: string } } | undefined;
  return (
    e?.code === 'slack_webapi_rate_limited_error' ||
    e?.data?.error === 'ratelimited' ||
    /rate limit was exceeded/i.test(e?.message ?? '')
  );
}

/** What to tell someone whose roll could not be posted. */
export function rollFailedMessage(err: unknown): string {
  return isRateLimited(err)
    ? 'Slack is busy right now. Please roll again in a few seconds.'
    : "Couldn't post the roll. Please try again.";
}
