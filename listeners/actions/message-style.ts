// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AllMiddlewareArgs, BlockAction, RadioButtonsAction, SlackActionMiddlewareArgs } from '@slack/bolt';
import { homeView } from '../../lib/home.js';
import { slackErrorCode } from '../../lib/publish.js';
import type { ListenerOptions } from '../options.js';

/** The Home tab's style choice: saves it for this person and republishes their Home tab. */
export function messageStyle({ preferences }: ListenerOptions) {
  return async ({
    ack,
    body,
    action,
    client,
    logger,
  }: AllMiddlewareArgs & SlackActionMiddlewareArgs<BlockAction<RadioButtonsAction>>): Promise<void> => {
    await ack();
    const style = action.selected_option?.value;
    if (style !== 'beginner' && style !== 'expert') return;
    await preferences.setStyle(body.user.id, style);
    try {
      await client.views.publish({ user_id: body.user.id, view: homeView(body.user.id, style) });
    } catch (err) {
      logger.error(`[message_style] publish failed: ${slackErrorCode(err) ?? String(err)}`);
    }
  };
}
