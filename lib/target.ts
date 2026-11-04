// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Where a roll result is published: a channel, optionally a thread, or a slash command response URL. */
export interface RollTarget {
  channel: string;
  threadTs?: string;
  responseUrl?: string;
}

const TS_PATTERN = /^\d+\.\d+$/;
const RESPONSE_URL_PREFIX = 'https://hooks.slack.com/';

export function encodeTarget(target: RollTarget): string {
  return JSON.stringify(target);
}

export function decodeTarget(raw: string | undefined): RollTarget | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { channel, threadTs, responseUrl } = value as Record<string, unknown>;
  if (typeof channel !== 'string' || !channel) return null;

  const target: RollTarget = { channel };
  if (threadTs !== undefined) {
    if (typeof threadTs !== 'string' || !TS_PATTERN.test(threadTs)) return null;
    target.threadTs = threadTs;
  }
  if (responseUrl !== undefined) {
    if (typeof responseUrl !== 'string' || !responseUrl.startsWith(RESPONSE_URL_PREFIX)) return null;
    target.responseUrl = responseUrl;
  }
  return target;
}
