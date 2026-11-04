// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BlockAction } from '@slack/bolt';
import { decodeTarget, type RollTarget } from '../../lib/target.js';

/**
 * Where a picker's roll goes. Its buttons and menu carry the encoded channel and thread;
 * without them the clicked message gives the place. Pickers that are ephemeral (from `/roll`)
 * answer through the click's response URL, which posts even when the bot is not a member.
 */
export function targetFromAction(body: BlockAction, encoded: string | undefined): RollTarget | null {
  const target =
    decodeTarget(encoded) ??
    (body.channel && body.message
      ? { channel: body.channel.id, threadTs: body.message.thread_ts ?? body.message.ts }
      : null);
  if (!target) return null;
  // A picker rolls only where it sits; a copy elsewhere must not post into another conversation.
  if (body.channel && body.channel.id !== target.channel) return null;
  if (body.container?.is_ephemeral === true && body.response_url) {
    return { channel: target.channel, responseUrl: body.response_url };
  }
  return target;
}
