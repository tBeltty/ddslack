// SPDX-FileCopyrightText: 2026 tBeltty
//
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AllMiddlewareArgs, SlackViewMiddlewareArgs, ViewSubmitAction } from '@slack/bolt';
import { cooldownMessage } from '../../lib/cooldown.js';
import { type FormValues, readRollForm } from '../../lib/messages.js';
import { publish, slackErrorCode } from '../../lib/publish.js';
import { performRoll } from '../../lib/roll.js';
import { decodeTarget } from '../../lib/target.js';
import { type ListenerOptions, tokenOf } from '../options.js';

const ACK_DEADLINE_MS = 2000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function rollModalSubmit({ table, publicBaseUrl, preferences, cooldown }: ListenerOptions) {
  return async ({
    ack,
    view,
    body,
    client,
    logger,
    context,
  }: AllMiddlewareArgs & SlackViewMiddlewareArgs<ViewSubmitAction>): Promise<void> => {
    const form = readRollForm(view.state.values as FormValues);
    if (!form.ok) {
      await ack({ response_action: 'errors', errors: form.errors });
      return;
    }
    // The form stays open, so pressing Roll again after the wait just works.
    const turn = cooldown.take(body.user.id);
    if (!turn.ok) {
      await ack({ response_action: 'errors', errors: { die: cooldownMessage(turn.waitMs) } });
      return;
    }
    const target = decodeTarget(view.private_metadata);
    if (!target) {
      logger.error('[roll_modal] the form carries no valid destination');
      await ack({ response_action: 'errors', errors: { die: "Couldn't prepare the roll. Please try again." } });
      return;
    }

    const posting = (async () => {
      if (form.secret) {
        // Secret rolls stay instant and private: no suspense, nothing to tidy.
        const roll = performRoll({
          expression: form.expression,
          userId: body.user.id,
          reason: form.reason,
          secret: true,
          style: preferences.style(body.user.id),
          critical: form.critical,
          ...(form.dc !== undefined ? { dc: form.dc } : {}),
          ...(publicBaseUrl ? { publicBaseUrl } : {}),
        });
        if (!roll.ok) throw new Error(roll.error);
        await publish(client, target, body.user.id, roll.message, true);
      } else {
        await table.roll({
          ...tokenOf(context),
          target,
          userId: body.user.id,
          expression: form.expression,
          reason: form.reason,
          critical: form.critical,
          ...(form.dc !== undefined ? { dc: form.dc } : {}),
          ...(target.responseUrl ? { fallbackResponseUrl: target.responseUrl } : {}),
        });
      }
    })().then(
      () => null,
      (err: unknown) => err
    );

    // Slack wants the answer within 3 seconds. A post that is still going by then is left to
    // finish: closing the form now keeps a second press from rolling twice.
    const outcome = await Promise.race([posting, sleep(ACK_DEADLINE_MS).then(() => 'late' as const)]);
    if (outcome === 'late') {
      await ack();
      const err = await posting;
      if (err) logger.error(`[roll_modal] late publish failed: ${slackErrorCode(err) ?? String(err)}`);
      return;
    }
    if (!outcome) {
      await ack();
      return;
    }
    const code = slackErrorCode(outcome);
    logger.error(`[roll_modal] publish failed: ${code ?? String(outcome)}`);
    const message =
      code === 'not_in_channel' || code === 'channel_not_found'
        ? 'The bot is not in this channel. Invite it with /invite and roll again.'
        : "Couldn't post the roll. Please try again.";
    await ack({ response_action: 'errors', errors: { die: message } });
  };
}
