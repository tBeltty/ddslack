// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AllMiddlewareArgs, MessageShortcut, SlackShortcutMiddlewareArgs } from '@slack/bolt';
import { rollModal } from '../../lib/messages.js';

/** Fallback for any thread, Huddle chat included: message menu > "Roll dice here". */
export async function rollHere({
  ack,
  shortcut,
  client,
  logger,
}: AllMiddlewareArgs & SlackShortcutMiddlewareArgs<MessageShortcut>): Promise<void> {
  await ack();
  const threadTs: string = shortcut.message.thread_ts ?? shortcut.message.ts;
  logger.info(`[interaction] shortcut channel=${shortcut.channel.id} in_thread=${Boolean(shortcut.message.thread_ts)}`);
  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: rollModal({ channel: shortcut.channel.id, threadTs }),
  });
}
