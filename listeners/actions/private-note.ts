// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { BlockAction, Logger } from '@slack/bolt';
import { postToResponseUrl } from '../../lib/publish.js';

/** Tells only the person who clicked, in the conversation where they clicked. */
export async function privateNote(body: BlockAction, text: string, logger: Logger): Promise<void> {
  if (!body.response_url) return;
  try {
    await postToResponseUrl(body.response_url, { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] }, true);
  } catch (err) {
    logger.warn(`[private_note] failed: ${String(err)}`);
  }
}
